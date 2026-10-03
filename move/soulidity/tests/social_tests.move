#[test_only]
module soulidity::social_tests;

use std::string;
use soulidity::profile::{Self as profile, ProfileRegistryV1};
use soulidity::social::{Self as social, SocialRegistryV1, FollowChangedV1};
use sui::clock::{Self as clock, Clock};
use sui::event;
use sui::test_scenario as ts;

const ALICE: address = @0xA11;
const BOB: address = @0xB0B;
const CAROL: address = @0xCA;
const UNKNOWN: address = @0xBAD;
const MAX: u64 = 18446744073709551615;

fun digest(): vector<u8> {
    let mut result = vector[];
    while (result.length() < 32) result.push_back(1);
    result
}

fun register(scenario: &mut ts::Scenario, owner: address, name: vector<u8>): ID {
    scenario.next_tx(owner);
    let mut profiles = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let id = profile::create_profile(&mut profiles, string::utf8(name), object::id_from_address(@0xB10B),
        digest(), digest(), 100, &clock, scenario.ctx());
    ts::return_shared(profiles);
    ts::return_shared(clock);
    id
}

fun start(): (ts::Scenario, ID, ID, ID) {
    let mut scenario = ts::begin(ALICE);
    profile::init_for_testing(scenario.ctx());
    social::init_for_testing(scenario.ctx());
    clock::share_for_testing(clock::create_for_testing(scenario.ctx()));
    let alice = register(&mut scenario, ALICE, b"alice");
    let bob = register(&mut scenario, BOB, b"bob");
    let carol = register(&mut scenario, CAROL, b"carol");
    scenario.next_tx(ALICE);
    (scenario, alice, bob, carol)
}

fun change(scenario: &mut ts::Scenario, actor: ID, target: ID, target_owner: address,
    revision: u64, desired: bool): (bool, u64) {
    let profiles = scenario.take_shared<ProfileRegistryV1>();
    let mut registry = scenario.take_shared<SocialRegistryV1>();
    let (following, revision) = social::set_follow(&mut registry, &profiles, actor, target, target_owner, revision, desired, scenario.ctx());
    ts::return_shared(profiles);
    ts::return_shared(registry);
    (following, revision)
}

fun assert_counts(registry: &SocialRegistryV1, id: ID, expected_followers: u64, expected_following: u64) {
    let (followers, following) = social::counts(registry, id);
    assert!(followers == expected_followers && following == expected_following, 99);
}
fun assert_edge(registry: &SocialRegistryV1, actor: ID, target: ID, expected: bool, expected_revision: u64) {
    let (following, revision) = social::edge(registry, actor, target);
    assert!(following == expected && revision == expected_revision, 99);
}

#[test]
fun fresh_registry_absence_and_noop_do_not_allocate() {
    let (mut scenario, alice, bob, _) = start();
    let profiles = scenario.take_shared<ProfileRegistryV1>();
    let mut registry = scenario.take_shared<SocialRegistryV1>();
    assert_counts(&registry, alice, 0, 0);
    assert_edge(&registry, alice, bob, false, 0);
    let (following, revision) = social::set_follow(&mut registry, &profiles, alice, bob, BOB, 0, false, scenario.ctx());
    assert!(!following && revision == 0, 99);
    assert!(!social::has_counts_for_testing(&registry, alice) && !social::has_counts_for_testing(&registry, bob), 99);
    assert!(!social::has_edge_for_testing(&registry, alice, bob), 99);
    assert!(event::events_by_type<FollowChangedV1>().is_empty(), 99);
    ts::return_shared(profiles); ts::return_shared(registry); scenario.end();
}

#[test]
fun follow_unfollow_refollow_persist_counts_and_tombstone() {
    let (mut scenario, alice, bob, _) = start();
    let (following, revision) = change(&mut scenario, alice, bob, BOB, 0, true);
    assert!(following && revision == 1, 99);
    scenario.next_tx(ALICE);
    let profiles = scenario.take_shared<ProfileRegistryV1>();
    let mut registry = scenario.take_shared<SocialRegistryV1>();
    assert_counts(&registry, alice, 0, 1); assert_counts(&registry, bob, 1, 0);
    let (following, revision) = social::set_follow(&mut registry, &profiles, alice, bob, BOB, 1, true, scenario.ctx());
    assert!(following && revision == 1, 99);
    assert!(event::events_by_type<FollowChangedV1>().is_empty(), 99);
    let (following, revision) = social::set_follow(&mut registry, &profiles, alice, bob, BOB, 1, false, scenario.ctx());
    assert!(!following && revision == 2, 99);
    assert!(social::has_counts_for_testing(&registry, alice) && social::has_counts_for_testing(&registry, bob), 99);
    assert!(social::has_edge_for_testing(&registry, alice, bob), 99);
    assert_counts(&registry, alice, 0, 0); assert_counts(&registry, bob, 0, 0);
    assert_edge(&registry, alice, bob, false, 2);
    assert!(event::events_by_type<FollowChangedV1>().length() == 1, 99);
    ts::return_shared(profiles); ts::return_shared(registry);
    scenario.next_tx(ALICE);
    let (following, revision) = change(&mut scenario, alice, bob, BOB, 2, true);
    assert!(following && revision == 3, 99);
    scenario.end();
}

#[test]
fun independent_directed_edges_and_multiple_followers() {
    let (mut scenario, alice, bob, carol) = start();
    change(&mut scenario, alice, bob, BOB, 0, true);
    scenario.next_tx(BOB);
    change(&mut scenario, bob, alice, ALICE, 0, true);
    scenario.next_tx(CAROL);
    change(&mut scenario, carol, bob, BOB, 0, true);
    scenario.next_tx(ALICE);
    change(&mut scenario, alice, bob, BOB, 1, false);
    scenario.next_tx(ALICE);
    let registry = scenario.take_shared<SocialRegistryV1>();
    assert_counts(&registry, alice, 1, 0);
    assert_counts(&registry, bob, 1, 1);
    assert_counts(&registry, carol, 0, 1);
    assert_edge(&registry, bob, alice, true, 1);
    assert_edge(&registry, carol, bob, true, 1);
    ts::return_shared(registry); scenario.end();
}

#[test, expected_failure(abort_code = 1, location = soulidity::social)]
fun cannot_claim_another_actor() {
    let (mut scenario, alice, bob, _) = start();
    change(&mut scenario, bob, alice, ALICE, 0, true); abort 99
}
#[test, expected_failure(abort_code = 1, location = soulidity::social)]
fun unregistered_sender_rejected() {
    let (mut scenario, alice, bob, _) = start();
    scenario.next_tx(UNKNOWN);
    change(&mut scenario, alice, bob, BOB, 0, true); abort 99
}
#[test, expected_failure(abort_code = 1, location = soulidity::social)]
fun fake_actor_id_rejected() {
    let (mut scenario, _, bob, _) = start();
    change(&mut scenario, object::id_from_address(@0xFA), bob, BOB, 0, true); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::social)]
fun target_owner_mismatch_rejected() {
    let (mut scenario, alice, bob, _) = start();
    change(&mut scenario, alice, bob, CAROL, 0, true); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::social)]
fun target_id_mismatch_rejected() {
    let (mut scenario, alice, _, _) = start();
    change(&mut scenario, alice, object::id_from_address(@0xFA), BOB, 0, true); abort 99
}
#[test, expected_failure(abort_code = 2, location = soulidity::social)]
fun unregistered_target_rejected_even_for_noop() {
    let (mut scenario, alice, bob, _) = start();
    change(&mut scenario, alice, bob, UNKNOWN, 0, false); abort 99
}
#[test, expected_failure(abort_code = 3, location = soulidity::social)]
fun self_follow_rejected() {
    let (mut scenario, alice, _, _) = start();
    change(&mut scenario, alice, alice, ALICE, 0, true); abort 99
}
#[test, expected_failure(abort_code = 3, location = soulidity::social)]
fun self_noop_rejected() {
    let (mut scenario, alice, _, _) = start();
    change(&mut scenario, alice, alice, ALICE, 0, false); abort 99
}
#[test, expected_failure(abort_code = 4, location = soulidity::social)]
fun absent_edge_stale_noop_rejected() {
    let (mut scenario, alice, bob, _) = start();
    change(&mut scenario, alice, bob, BOB, 1, false); abort 99
}
#[test, expected_failure(abort_code = 4, location = soulidity::social)]
fun stale_noop_after_follow_rejected() {
    let (mut scenario, alice, bob, _) = start();
    change(&mut scenario, alice, bob, BOB, 0, true);
    scenario.next_tx(ALICE);
    change(&mut scenario, alice, bob, BOB, 0, true); abort 99
}
#[test, expected_failure(abort_code = 4, location = soulidity::social)]
fun tombstone_blocks_old_follow() {
    let (mut scenario, alice, bob, _) = start();
    change(&mut scenario, alice, bob, BOB, 0, true);
    scenario.next_tx(ALICE);
    change(&mut scenario, alice, bob, BOB, 1, false);
    scenario.next_tx(ALICE);
    change(&mut scenario, alice, bob, BOB, 0, true); abort 99
}

fun corrupt_counts(followers: u64, following: u64, desired: bool) {
    let (mut scenario, alice, bob, _) = start();
    let profiles = scenario.take_shared<ProfileRegistryV1>();
    let mut registry = scenario.take_shared<SocialRegistryV1>();
    social::set_counts_for_testing(&mut registry, alice, 0, following);
    social::set_counts_for_testing(&mut registry, bob, followers, 0);
    social::set_edge_for_testing(&mut registry, alice, bob, !desired, 1);
    social::set_follow(&mut registry, &profiles, alice, bob, BOB, 1, desired, scenario.ctx()); abort 99
}
#[test, expected_failure(abort_code = 5, location = soulidity::social)]
fun actor_counter_overflow_rejected() { corrupt_counts(0, MAX, true); }
#[test, expected_failure(abort_code = 5, location = soulidity::social)]
fun target_counter_overflow_rejected() { corrupt_counts(MAX, 0, true); }
#[test, expected_failure(abort_code = 6, location = soulidity::social)]
fun actor_counter_underflow_rejected() { corrupt_counts(1, 0, false); }
#[test, expected_failure(abort_code = 6, location = soulidity::social)]
fun target_counter_underflow_rejected() { corrupt_counts(0, 1, false); }
#[test, expected_failure(abort_code = 7, location = soulidity::social)]
fun revision_overflow_rejected() {
    let (mut scenario, alice, bob, _) = start();
    let profiles = scenario.take_shared<ProfileRegistryV1>();
    let mut registry = scenario.take_shared<SocialRegistryV1>();
    social::set_edge_for_testing(&mut registry, alice, bob, false, MAX);
    social::set_follow(&mut registry, &profiles, alice, bob, BOB, MAX, true, scenario.ctx()); abort 99
}
#[test]
fun maximum_revision_noop_remains_unchanged() {
    let (mut scenario, alice, bob, _) = start();
    let profiles = scenario.take_shared<ProfileRegistryV1>();
    let mut registry = scenario.take_shared<SocialRegistryV1>();
    social::set_edge_for_testing(&mut registry, alice, bob, false, MAX);
    let (following, revision) = social::set_follow(&mut registry, &profiles, alice, bob, BOB, MAX, false, scenario.ctx());
    assert!(!following && revision == MAX, 99);
    assert!(!social::has_counts_for_testing(&registry, alice), 99);
    ts::return_shared(profiles); ts::return_shared(registry); scenario.end();
}
#[test, expected_failure(abort_code = 0, location = soulidity::social)]
fun invalid_social_version_rejected() {
    let (mut scenario, alice, bob, _) = start();
    let profiles = scenario.take_shared<ProfileRegistryV1>();
    let mut registry = scenario.take_shared<SocialRegistryV1>();
    social::set_version_for_testing(&mut registry, 2);
    social::set_follow(&mut registry, &profiles, alice, bob, BOB, 0, true, scenario.ctx()); abort 99
}
