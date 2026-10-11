#[test_only]
module soulidity::community_votes_tests;

use std::string;
use soulidity::community_votes::{Self as votes, VoteRegistryV1, VoteChangedV1};
use soulidity::community_posts::{Self as posts, CommunityRegistryV1, PostV1};
use soulidity::profile::{Self as profile, ProfileRegistryV1};
use sui::clock::{Self as clock, Clock};
use sui::event;
use sui::test_scenario as ts;

const ALICE: address = @0xA11;
const BOB: address = @0xB0B;
const MAX: u64 = 18446744073709551615;
fun bytes(): vector<u8> { let mut v = vector[]; while (v.length() < 32) v.push_back(1); v }
fun blob(): ID { object::id_from_address(@0xB10B) }
fun register(s: &mut ts::Scenario, owner: address): ID {
    s.next_tx(owner);
    let mut profiles = s.take_shared<ProfileRegistryV1>();
    let clock = s.take_shared<Clock>();
    let id = profile::create_profile(&mut profiles, string::utf8(b""), blob(), bytes(), bytes(), 1, &clock, s.ctx());
    ts::return_shared(profiles); ts::return_shared(clock); id
}
fun create(s: &mut ts::Scenario, actor: ID): ID {
    let mut community = s.take_shared<CommunityRegistryV1>();
    let profiles = s.take_shared<ProfileRegistryV1>();
    let clock = s.take_shared<Clock>();
    let id = posts::create_post(&mut community, &profiles, actor, 0, 0, blob(), bytes(), bytes(), 1, &clock, s.ctx());
    ts::return_shared(community); ts::return_shared(profiles); ts::return_shared(clock); id
}
fun start(): (ts::Scenario, ID, ID, ID) {
    let mut s = ts::begin(ALICE);
    profile::init_for_testing(s.ctx()); posts::init_for_testing(s.ctx()); votes::init_for_testing(s.ctx());
    let mut clock = clock::create_for_testing(s.ctx()); clock.set_for_testing(123);
    clock::share_for_testing(clock);
    let alice = register(&mut s, ALICE); let bob = register(&mut s, BOB);
    s.next_tx(ALICE); let post = create(&mut s, alice); s.next_tx(ALICE);
    (s, alice, bob, post)
}
fun change(s: &mut ts::Scenario, post_id: ID, actor: ID, revision: u64, desired: u8): (u8, u64) {
    let mut registry = s.take_shared<VoteRegistryV1>();
    let community = s.take_shared<CommunityRegistryV1>();
    let profiles = s.take_shared<ProfileRegistryV1>();
    let post = s.take_shared_by_id<PostV1>(post_id);
    let (state, next_revision) = votes::set_vote(&mut registry, &community, &profiles, &post, actor, revision, desired, s.ctx());
    ts::return_shared(registry); ts::return_shared(community); ts::return_shared(profiles); ts::return_shared(post);
    (state, next_revision)
}
fun checked_change(s: &mut ts::Scenario, post: ID, actor: ID, before: u64, desired: u8, after: u64) {
    let (state, revision) = change(s, post, actor, before, desired);
    assert!(state == desired && revision == after, 99);
}
fun inspect(s: &mut ts::Scenario, post_id: ID, actor: ID, owner: address,
    up: u64, down: u64, state: u8, revision: u64, rows: bool) {
    let registry = s.take_shared<VoteRegistryV1>(); let community = s.take_shared<CommunityRegistryV1>();
    let profiles = s.take_shared<ProfileRegistryV1>(); let post = s.take_shared_by_id<PostV1>(post_id);
    let (actual_up, actual_down) = votes::counts(&registry, &community, &profiles, &post);
    assert!(actual_up == up && actual_down == down, 99);
    let (actual_state, actual_revision) = votes::edge(&registry, &community, &profiles, &post, actor, owner);
    assert!(actual_state == state && actual_revision == revision, 99);
    let (count_row, edge_row) = votes::has_rows_for_testing(&registry, actor, post_id);
    assert!(count_row == rows && edge_row == rows, 99);
    assert!(posts::created_at_ms(&post) == 123 && posts::updated_at_ms(&post) == 123, 99);
    ts::return_shared(registry); ts::return_shared(community); ts::return_shared(profiles); ts::return_shared(post);
}

#[test]
fun absent_noop_does_not_allocate_and_self_vote_flip_remove_refollow() {
    let (mut s, alice, _, post) = start();
    checked_change(&mut s, post, alice, 0, 0, 0);
    assert!(event::events_by_type<VoteChangedV1>().is_empty(), 99);
    s.next_tx(ALICE); inspect(&mut s, post, alice, ALICE, 0, 0, 0, 0, false);
    s.next_tx(ALICE); checked_change(&mut s, post, alice, 0, 1, 1);
    assert!(event::events_by_type<VoteChangedV1>().length() == 1, 99);
    s.next_tx(ALICE); inspect(&mut s, post, alice, ALICE, 1, 0, 1, 1, true);
    s.next_tx(ALICE); checked_change(&mut s, post, alice, 1, 1, 1);
    assert!(event::events_by_type<VoteChangedV1>().is_empty(), 99);
    s.next_tx(ALICE); checked_change(&mut s, post, alice, 1, 2, 2);
    s.next_tx(ALICE); inspect(&mut s, post, alice, ALICE, 0, 1, 2, 2, true);
    s.next_tx(ALICE); checked_change(&mut s, post, alice, 2, 0, 3);
    s.next_tx(ALICE); inspect(&mut s, post, alice, ALICE, 0, 0, 0, 3, true);
    s.next_tx(ALICE); checked_change(&mut s, post, alice, 3, 1, 4);
    s.next_tx(ALICE); inspect(&mut s, post, alice, ALICE, 1, 0, 1, 4, true); s.end();
}
#[test]
fun actors_and_posts_have_independent_edges_and_real_counts() {
    let (mut s, alice, bob, post) = start(); change(&mut s, post, alice, 0, 1);
    s.next_tx(BOB); change(&mut s, post, bob, 0, 2);
    s.next_tx(ALICE); inspect(&mut s, post, alice, ALICE, 1, 1, 1, 1, true);
    s.next_tx(ALICE); let other = create(&mut s, alice);
    s.next_tx(BOB); change(&mut s, other, bob, 0, 1);
    s.next_tx(BOB); change(&mut s, post, bob, 1, 1);
    s.next_tx(ALICE); inspect(&mut s, post, alice, ALICE, 2, 0, 1, 1, true);
    s.next_tx(BOB); inspect(&mut s, other, bob, BOB, 1, 0, 1, 1, true);
    s.next_tx(ALICE); change(&mut s, post, alice, 1, 0);
    s.next_tx(BOB); inspect(&mut s, post, bob, BOB, 1, 0, 1, 2, true); s.end();
}

#[test, expected_failure(abort_code = 1, location = soulidity::community_votes)]
fun forged_actor() { let (mut s, _, bob, post) = start(); change(&mut s, post, bob, 0, 1); abort 99 }
#[test, expected_failure(abort_code = 1, location = soulidity::community_votes)]
fun unregistered_sender() { let (mut s, alice, _, post) = start(); s.next_tx(@0xBAD); change(&mut s, post, alice, 0, 1); abort 99 }
#[test, expected_failure(abort_code = 1, location = soulidity::community_votes)]
fun fake_profile() { let (mut s, _, _, post) = start(); change(&mut s, post, blob(), 0, 1); abort 99 }
#[test, expected_failure(abort_code = 2, location = soulidity::community_votes)]
fun invalid_desired_state() { let (mut s, alice, _, post) = start(); change(&mut s, post, alice, 0, 3); abort 99 }
#[test, expected_failure(abort_code = 3, location = soulidity::community_votes)]
fun future_revision() { let (mut s, alice, _, post) = start(); change(&mut s, post, alice, 1, 1); abort 99 }
#[test, expected_failure(abort_code = 3, location = soulidity::community_votes)]
fun stale_revision_checked_before_same_state_noop() {
    let (mut s, alice, _, post) = start(); change(&mut s, post, alice, 0, 1);
    s.next_tx(ALICE); change(&mut s, post, alice, 0, 1); abort 99
}
#[test, expected_failure(abort_code = 3, location = soulidity::community_votes)]
fun tombstone_prevents_initial_revision_replay() {
    let (mut s, alice, _, post) = start(); change(&mut s, post, alice, 0, 1);
    s.next_tx(ALICE); change(&mut s, post, alice, 1, 0);
    s.next_tx(ALICE); change(&mut s, post, alice, 0, 0); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::community_posts)]
fun wrong_community_binding() {
    let (mut s, alice, _, post_id) = start(); let mut post = s.take_shared_by_id<PostV1>(post_id);
    posts::set_registry_for_testing(&mut post, blob()); ts::return_shared(post);
    s.next_tx(ALICE); change(&mut s, post_id, alice, 0, 1); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::community_posts)]
fun wrong_profile_binding() {
    let (mut s, alice, _, post_id) = start(); let mut post = s.take_shared_by_id<PostV1>(post_id);
    posts::set_profile_registry_for_testing(&mut post, blob()); ts::return_shared(post);
    s.next_tx(ALICE); change(&mut s, post_id, alice, 0, 1); abort 99
}
#[test, expected_failure(abort_code = 0, location = soulidity::community_votes)]
fun invalid_registry_version() {
    let (mut s, alice, _, post) = start(); let mut registry = s.take_shared<VoteRegistryV1>();
    votes::set_version_for_testing(&mut registry, 2); ts::return_shared(registry);
    s.next_tx(ALICE); change(&mut s, post, alice, 0, 1); abort 99
}

fun injected(s: &mut ts::Scenario, actor: ID, post: ID, up: u64, down: u64, state: u8, revision: u64) {
    let mut registry = s.take_shared<VoteRegistryV1>();
    votes::set_counts_for_testing(&mut registry, post, up, down);
    votes::set_edge_for_testing(&mut registry, actor, post, state, revision);
    ts::return_shared(registry); s.next_tx(ALICE);
}
#[test, expected_failure(abort_code = 4, location = soulidity::community_votes)]
fun up_counter_overflow() {
    let (mut s, alice, _, post) = start(); injected(&mut s, alice, post, MAX, 1, 2, 1);
    change(&mut s, post, alice, 1, 1); abort 99
}
#[test, expected_failure(abort_code = 4, location = soulidity::community_votes)]
fun down_counter_overflow() {
    let (mut s, alice, _, post) = start(); injected(&mut s, alice, post, 1, MAX, 1, 1);
    change(&mut s, post, alice, 1, 2); abort 99
}
#[test, expected_failure(abort_code = 5, location = soulidity::community_votes)]
fun up_counter_underflow() {
    let (mut s, alice, _, post) = start(); injected(&mut s, alice, post, 0, 0, 1, 1);
    change(&mut s, post, alice, 1, 0); abort 99
}
#[test, expected_failure(abort_code = 5, location = soulidity::community_votes)]
fun down_counter_underflow() {
    let (mut s, alice, _, post) = start(); injected(&mut s, alice, post, 0, 0, 2, 1);
    change(&mut s, post, alice, 1, 0); abort 99
}
#[test, expected_failure(abort_code = 6, location = soulidity::community_votes)]
fun revision_overflow() {
    let (mut s, alice, _, post) = start(); injected(&mut s, alice, post, 1, 0, 1, MAX);
    change(&mut s, post, alice, MAX, 0); abort 99
}
#[test]
fun max_revision_same_state_noop_is_valid() {
    let (mut s, alice, _, post) = start(); injected(&mut s, alice, post, 1, 0, 1, MAX);
    checked_change(&mut s, post, alice, MAX, 1, MAX);
    assert!(event::events_by_type<VoteChangedV1>().is_empty(), 99); s.end();
}
#[test, expected_failure(abort_code = 2, location = soulidity::community_votes)]
fun malformed_stored_state() {
    let (mut s, alice, _, post) = start(); injected(&mut s, alice, post, 0, 0, 3, 1);
    change(&mut s, post, alice, 1, 0); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::community_votes)]
fun malformed_stored_revision() {
    let (mut s, alice, _, post) = start(); injected(&mut s, alice, post, 0, 0, 0, 0);
    change(&mut s, post, alice, 0, 0); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::community_votes)]
fun missing_counts_row_cannot_be_zero_or_noop() {
    let (mut s, alice, _, post) = start(); let mut registry = s.take_shared<VoteRegistryV1>();
    votes::set_edge_for_testing(&mut registry, alice, post, 0, 1); ts::return_shared(registry);
    s.next_tx(ALICE); change(&mut s, post, alice, 1, 0); abort 99
}
