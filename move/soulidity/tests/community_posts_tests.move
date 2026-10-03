#[test_only]
module soulidity::community_posts_tests;

use std::string;
use soulidity::community_posts::{Self as posts, CommunityRegistryV1, PostV1, CommentV1, AnswerAcceptedV1};
use soulidity::profile::{Self as profile, ProfileRegistryV1};
use sui::clock::{Self as clock, Clock};
use sui::event;
use sui::test_scenario as ts;

const ALICE: address = @0xA11;
const BOB: address = @0xB0B;
const MAX: u64 = 18446744073709551615;

fun bytes(n: u64): vector<u8> {
    let mut value = vector[];
    while (value.length() < n) value.push_back(1);
    value
}
fun blob(): ID { object::id_from_address(@0xB10B) }
fun register(s: &mut ts::Scenario, owner: address): ID {
    s.next_tx(owner);
    let mut profiles = s.take_shared<ProfileRegistryV1>();
    let clock = s.take_shared<Clock>();
    let id = profile::create_profile(&mut profiles, string::utf8(b""), blob(), bytes(32), bytes(32), 1, &clock, s.ctx());
    ts::return_shared(profiles); ts::return_shared(clock);
    id
}
fun start(): (ts::Scenario, ID, ID) {
    let mut s = ts::begin(ALICE);
    profile::init_for_testing(s.ctx()); posts::init_for_testing(s.ctx());
    let mut clock = clock::create_for_testing(s.ctx());
    clock.set_for_testing(100);
    clock::share_for_testing(clock);
    let alice = register(&mut s, ALICE);
    let bob = register(&mut s, BOB);
    s.next_tx(ALICE);
    (s, alice, bob)
}
fun create(s: &mut ts::Scenario, actor: ID, kind: u8, channel: u8, object_id: ID,
    blob_bytes: u64, hash_bytes: u64, length: u64): ID {
    let mut registry = s.take_shared<CommunityRegistryV1>();
    let profiles = s.take_shared<ProfileRegistryV1>();
    let clock = s.take_shared<Clock>();
    let id = posts::create_post(&mut registry, &profiles, actor, kind, channel,
        object_id, bytes(blob_bytes), bytes(hash_bytes), length, &clock, s.ctx());
    ts::return_shared(registry); ts::return_shared(profiles); ts::return_shared(clock);
    id
}
fun comment(s: &mut ts::Scenario, post_id: ID, actor: ID): ID {
    let registry = s.take_shared<CommunityRegistryV1>();
    let profiles = s.take_shared<ProfileRegistryV1>();
    let mut post = s.take_shared_by_id<PostV1>(post_id);
    let mut clock = s.take_shared<Clock>();
    clock.set_for_testing(200);
    let id = posts::create_comment(&registry, &profiles, &mut post, actor, blob(), bytes(32), bytes(32), 1, &clock, s.ctx());
    ts::return_shared(registry); ts::return_shared(profiles); ts::return_shared(post); ts::return_shared(clock);
    id
}
fun accept(s: &mut ts::Scenario, post_id: ID, comment_id: ID, actor: ID, revision: u64): u64 {
    let registry = s.take_shared<CommunityRegistryV1>();
    let profiles = s.take_shared<ProfileRegistryV1>();
    let mut post = s.take_shared_by_id<PostV1>(post_id);
    let comment = s.take_immutable_by_id<CommentV1>(comment_id);
    let result = posts::accept_answer(&registry, &profiles, &mut post, &comment, actor, revision, s.ctx());
    ts::return_shared(registry); ts::return_shared(profiles); ts::return_shared(post); ts::return_immutable(comment);
    result
}
fun question(s: &mut ts::Scenario, alice: ID): ID { create(s, alice, 1, 1, blob(), 32, 32, 1) }
fun answered(): (ts::Scenario, ID, ID, ID, ID) {
    let (mut s, alice, bob) = start();
    let post = question(&mut s, alice);
    s.next_tx(BOB);
    let answer = comment(&mut s, post, bob);
    s.next_tx(ALICE);
    (s, alice, bob, post, answer)
}

#[test]
fun creation_comment_acceptance_replacement_and_noop() {
    let (mut s, alice, bob, post_id, first) = answered();
    let registry = s.take_shared<CommunityRegistryV1>();
    let post = s.take_shared_by_id<PostV1>(post_id);
    let answer = s.take_immutable_by_id<CommentV1>(first);
    assert!(posts::post_count(&registry) == 1 && posts::post_at_index(&registry, 0) == post_id, 99);
    assert!(posts::comment_count(&post) == 1 && posts::comment_at_index(&post, 0) == first, 99);
    assert!(posts::post_author(&post) == alice && posts::comment_author(&answer) == bob, 99);
    assert!(posts::comment_post_id(&answer) == post_id && posts::comment_created_at_ms(&answer) == 200, 99);
    assert!(posts::created_at_ms(&post) == 100 && posts::updated_at_ms(&post) == 200, 99);
    assert!(posts::accepted_comment_id(&post).is_none() && posts::acceptance_revision(&post) == 0, 99);
    assert!(*posts::post_document(&post) == *posts::comment_document(&answer), 99);
    ts::return_shared(registry); ts::return_shared(post); ts::return_immutable(answer);
    s.next_tx(ALICE);
    assert!(accept(&mut s, post_id, first, alice, 0) == 1, 99);
    s.next_tx(ALICE);
    assert!(accept(&mut s, post_id, first, alice, 1) == 1, 99);
    assert!(event::events_by_type<AnswerAcceptedV1>().is_empty(), 99);
    s.next_tx(ALICE);
    let second = comment(&mut s, post_id, alice);
    s.next_tx(ALICE);
    assert!(accept(&mut s, post_id, second, alice, 1) == 2, 99);
    s.next_tx(ALICE);
    let post = s.take_shared_by_id<PostV1>(post_id);
    assert!(posts::accepted_comment_id(&post) == option::some(second), 99);
    assert!(posts::updated_at_ms(&post) == 200 && posts::comment_count(&post) == 2, 99);
    assert!(posts::comment_at_index(&post, 0) == first && posts::comment_at_index(&post, 1) == second, 99);
    ts::return_shared(post); s.end();
}

#[test]
fun all_types_channels_creation_order_and_no_move_document_budget() {
    let (mut s, alice, _) = start();
    let a = create(&mut s, alice, 0, 0, blob(), 32, 32, MAX);
    s.next_tx(ALICE);
    let b = create(&mut s, alice, 1, 0, blob(), 32, 32, 1);
    s.next_tx(ALICE);
    let c = create(&mut s, alice, 2, 1, blob(), 32, 32, 1);
    s.next_tx(ALICE);
    let registry = s.take_shared<CommunityRegistryV1>();
    assert!(posts::post_count(&registry) == 3, 99);
    assert!(posts::post_at_index(&registry, 0) == a && posts::post_at_index(&registry, 1) == b
        && posts::post_at_index(&registry, 2) == c, 99);
    ts::return_shared(registry); s.end();
}

#[test, expected_failure(abort_code = 1, location = soulidity::community_posts)]
fun wrong_post_actor() { let (mut s, _, bob) = start(); question(&mut s, bob); abort 99 }
#[test, expected_failure(abort_code = 1, location = soulidity::community_posts)]
fun unregistered_actor() { let (mut s, alice, _) = start(); s.next_tx(@0xBAD); question(&mut s, alice); abort 99 }
#[test, expected_failure(abort_code = 3, location = soulidity::community_posts)]
fun wrong_type() { let (mut s, alice, _) = start(); create(&mut s, alice, 3, 0, blob(), 32, 32, 1); abort 99 }
#[test, expected_failure(abort_code = 4, location = soulidity::community_posts)]
fun wrong_channel() { let (mut s, alice, _) = start(); create(&mut s, alice, 0, 2, blob(), 32, 32, 1); abort 99 }
#[test, expected_failure(abort_code = 5, location = soulidity::community_posts)]
fun zero_blob_object() { let (mut s, alice, _) = start(); create(&mut s, alice, 0, 0, object::id_from_address(@0x0), 32, 32, 1); abort 99 }
#[test, expected_failure(abort_code = 5, location = soulidity::community_posts)]
fun short_blob_id() { let (mut s, alice, _) = start(); create(&mut s, alice, 0, 0, blob(), 31, 32, 1); abort 99 }
#[test, expected_failure(abort_code = 5, location = soulidity::community_posts)]
fun long_blob_id() { let (mut s, alice, _) = start(); create(&mut s, alice, 0, 0, blob(), 33, 32, 1); abort 99 }
#[test, expected_failure(abort_code = 5, location = soulidity::community_posts)]
fun short_hash() { let (mut s, alice, _) = start(); create(&mut s, alice, 0, 0, blob(), 32, 31, 1); abort 99 }
#[test, expected_failure(abort_code = 5, location = soulidity::community_posts)]
fun long_hash() { let (mut s, alice, _) = start(); create(&mut s, alice, 0, 0, blob(), 32, 33, 1); abort 99 }
#[test, expected_failure(abort_code = 5, location = soulidity::community_posts)]
fun zero_length() { let (mut s, alice, _) = start(); create(&mut s, alice, 0, 0, blob(), 32, 32, 0); abort 99 }
#[test, expected_failure(abort_code = 1, location = soulidity::community_posts)]
fun wrong_comment_actor() {
    let (mut s, alice, bob) = start(); let post = question(&mut s, alice);
    s.next_tx(ALICE); comment(&mut s, post, bob); abort 99
}
#[test, expected_failure(abort_code = 7, location = soulidity::community_posts)]
fun only_question_author_accepts() {
    let (mut s, _, bob, post, answer) = answered(); s.next_tx(BOB);
    accept(&mut s, post, answer, bob, 0); abort 99
}
#[test, expected_failure(abort_code = 1, location = soulidity::community_posts)]
fun forged_accept_actor() {
    let (mut s, alice, _, post, answer) = answered(); s.next_tx(BOB);
    accept(&mut s, post, answer, alice, 0); abort 99
}
#[test, expected_failure(abort_code = 8, location = soulidity::community_posts)]
fun non_question_cannot_accept() {
    let (mut s, alice, _) = start(); let post = create(&mut s, alice, 0, 0, blob(), 32, 32, 1);
    s.next_tx(ALICE); let answer = comment(&mut s, post, alice); s.next_tx(ALICE);
    accept(&mut s, post, answer, alice, 0); abort 99
}
#[test, expected_failure(abort_code = 9, location = soulidity::community_posts)]
fun wrong_parent() {
    let (mut s, alice, _, _, answer) = answered(); let other = question(&mut s, alice);
    s.next_tx(ALICE); accept(&mut s, other, answer, alice, 0); abort 99
}
#[test, expected_failure(abort_code = 10, location = soulidity::community_posts)]
fun stale_revision_before_same_answer_noop() {
    let (mut s, alice, _, post, answer) = answered(); accept(&mut s, post, answer, alice, 0);
    s.next_tx(ALICE); accept(&mut s, post, answer, alice, 0); abort 99
}
#[test, expected_failure(abort_code = 10, location = soulidity::community_posts)]
fun future_revision() {
    let (mut s, alice, _, post, answer) = answered(); accept(&mut s, post, answer, alice, 1); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::community_posts)]
fun wrong_community_registry() {
    let (mut s, alice, _, post_id, _) = answered(); let mut post = s.take_shared_by_id<PostV1>(post_id);
    posts::set_registry_for_testing(&mut post, blob()); ts::return_shared(post);
    s.next_tx(ALICE);
    comment(&mut s, post_id, alice); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::community_posts)]
fun wrong_profile_registry() {
    let (mut s, alice, _, post_id, answer) = answered(); let mut post = s.take_shared_by_id<PostV1>(post_id);
    posts::set_profile_registry_for_testing(&mut post, blob()); ts::return_shared(post);
    s.next_tx(ALICE);
    accept(&mut s, post_id, answer, alice, 0); abort 99
}
#[test, expected_failure(abort_code = 6, location = soulidity::community_posts)]
fun post_counter_overflow() {
    let (mut s, alice, _) = start(); let mut registry = s.take_shared<CommunityRegistryV1>();
    posts::set_post_count_for_testing(&mut registry, MAX); ts::return_shared(registry);
    s.next_tx(ALICE);
    question(&mut s, alice); abort 99
}
#[test, expected_failure(abort_code = 6, location = soulidity::community_posts)]
fun comment_counter_overflow() {
    let (mut s, alice, _, post_id, _) = answered(); let mut post = s.take_shared_by_id<PostV1>(post_id);
    posts::set_comment_count_for_testing(&mut post, MAX); ts::return_shared(post);
    s.next_tx(ALICE);
    comment(&mut s, post_id, alice); abort 99
}
#[test, expected_failure(abort_code = 11, location = soulidity::community_posts)]
fun acceptance_revision_overflow() {
    let (mut s, alice, _, post_id, answer) = answered(); let mut post = s.take_shared_by_id<PostV1>(post_id);
    posts::set_acceptance_revision_for_testing(&mut post, MAX); ts::return_shared(post);
    s.next_tx(ALICE);
    accept(&mut s, post_id, answer, alice, MAX); abort 99
}
