#[test_only]
module soulidity::profile_tests;

use std::string;
use soulidity::profile::{Self as profile, ProfileRegistryV1, WalletProfileV1};
use sui::clock::{Self as clock, Clock};
use sui::test_scenario as ts;

const ALICE: address = @0xA11;
const BOB: address = @0xB0B;

fun start(): ts::Scenario {
    let mut scenario = ts::begin(ALICE);
    profile::init_for_testing(scenario.ctx());
    clock::share_for_testing(clock::create_for_testing(scenario.ctx()));
    scenario.next_tx(ALICE);
    scenario
}

fun digest(byte: u8): vector<u8> {
    let mut out = vector[];
    while (out.length() < 32) out.push_back(byte);
    out
}

fun create(registry: &mut ProfileRegistryV1, handle: vector<u8>, clock: &Clock, ctx: &mut TxContext): ID {
    profile::create_profile(registry, string::utf8(handle), object::id_from_address(@0xB10B),
        digest(1), digest(2), 256, clock, ctx)
}

fun update(registry: &mut ProfileRegistryV1, wallet_profile: &mut WalletProfileV1,
    revision: u64, handle: vector<u8>, clock: &Clock, ctx: &TxContext) {
    profile::update_profile(registry, wallet_profile, revision, string::utf8(handle),
        object::id_from_address(@0xB10C), digest(3), digest(4), 300, clock, ctx);
}

#[test]
fun create_and_update_preserve_identity_and_directory() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let id = create(&mut registry, b"alice", &clock, scenario.ctx());
    assert!(profile::profile_count(&registry) == 1
        && profile::profile_for_owner(&registry, ALICE) == id
        && profile::profile_for_handle(&registry, b"alice".to_string()) == id
        && profile::profile_at_index(&registry, 0) == id, 99);
    ts::return_shared(registry);
    ts::return_shared(clock);
    scenario.next_tx(ALICE);
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let mut wallet_profile = scenario.take_from_sender<WalletProfileV1>();
    assert!(object::id(&wallet_profile) == id && profile::owner(&wallet_profile) == ALICE
        && profile::revision(&wallet_profile) == 0, 99);
    update(&mut registry, &mut wallet_profile, 0, b"alice_new", &clock, scenario.ctx());
    assert!(profile::profile_count(&registry) == 1
        && !profile::contains_handle(&registry, b"alice".to_string())
        && profile::profile_for_handle(&registry, b"alice_new".to_string()) == id
        && profile::profile_for_owner(&registry, ALICE) == id
        && profile::revision(&wallet_profile) == 1, 99);
    let metadata = profile::metadata(&wallet_profile);
    assert!(profile::metadata_blob_object_id(metadata) == object::id_from_address(@0xB10C)
        && *profile::metadata_blob_id(metadata) == digest(3)
        && *profile::metadata_sha256(metadata) == digest(4)
        && profile::metadata_byte_length(metadata) == 300, 99);
    update(&mut registry, &mut wallet_profile, 1, b"alice_new", &clock, scenario.ctx());
    assert!(profile::revision(&wallet_profile) == 2, 99);
    update(&mut registry, &mut wallet_profile, 2, b"", &clock, scenario.ctx());
    assert!(!profile::contains_handle(&registry, b"alice_new".to_string())
        && !profile::contains_handle(&registry, b"".to_string())
        && profile::handle(&wallet_profile).is_empty(), 99);
    ts::return_to_sender(&scenario, wallet_profile);
    ts::return_shared(registry);
    ts::return_shared(clock);
    scenario.end();
}

#[test, expected_failure(abort_code = 2, location = soulidity::profile)]
fun duplicate_wallet_rejected() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    create(&mut registry, b"alice", &clock, scenario.ctx());
    create(&mut registry, b"alice2", &clock, scenario.ctx());
    abort 99
}

#[test, expected_failure(abort_code = 5, location = soulidity::profile)]
fun duplicate_handle_rejected() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    create(&mut registry, b"alice", &clock, scenario.ctx());
    ts::return_shared(registry);
    ts::return_shared(clock);
    scenario.next_tx(BOB);
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    create(&mut registry, b"alice", &clock, scenario.ctx());
    abort 99
}

fun invalid_handle(handle: vector<u8>) {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    create(&mut registry, handle, &clock, scenario.ctx());
    abort 99
}

#[test, expected_failure(abort_code = 3, location = soulidity::profile)]
fun uppercase_handle_rejected() { invalid_handle(b"Alice"); }
#[test, expected_failure(abort_code = 3, location = soulidity::profile)]
fun short_handle_rejected() { invalid_handle(b"ab"); }
#[test, expected_failure(abort_code = 3, location = soulidity::profile)]
fun long_handle_rejected() { invalid_handle(b"abcdefghijklmnopqrstuvwxyz12345"); }
#[test, expected_failure(abort_code = 3, location = soulidity::profile)]
fun punctuation_handle_rejected() { invalid_handle(b"alice/bob"); }
#[test, expected_failure(abort_code = 4, location = soulidity::profile)]
fun reserved_handle_rejected() { invalid_handle(b"admin"); }

fun invalid_update(mode: u8) {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    create(&mut registry, b"alice", &clock, scenario.ctx());
    ts::return_shared(registry);
    ts::return_shared(clock);
    scenario.next_tx(ALICE);
    let mut wallet_profile = scenario.take_from_sender<WalletProfileV1>();
    // The direct module check is intentional: transaction input ownership is an
    // additional platform boundary, not a reason to omit this internal guard.
    if (mode == 1) { scenario.next_tx(BOB); };
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let expected_revision = if (mode == 2) 1 else 0;
    update(&mut registry, &mut wallet_profile, expected_revision, b"new_name", &clock, scenario.ctx());
    abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::profile)]
fun nonowner_update_rejected() { invalid_update(1); }
#[test, expected_failure(abort_code = 6, location = soulidity::profile)]
fun stale_revision_rejected() { invalid_update(2); }

fun invalid_metadata(mode: u8) {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let blob_object_id = object::id_from_address(if (mode == 1) @0x0 else @0xB10B);
    let blob_id = if (mode == 2) vector[1] else digest(1);
    let hash = if (mode == 3) vector[2] else digest(2);
    let length = if (mode == 4) 0 else if (mode == 5) 65537 else 256;
    profile::create_profile(&mut registry, b"alice".to_string(), blob_object_id, blob_id, hash, length,
        &clock, scenario.ctx());
    abort 99
}
#[test, expected_failure(abort_code = 7, location = soulidity::profile)]
fun zero_object_rejected() { invalid_metadata(1); }
#[test, expected_failure(abort_code = 7, location = soulidity::profile)]
fun bad_blob_id_rejected() { invalid_metadata(2); }
#[test, expected_failure(abort_code = 7, location = soulidity::profile)]
fun bad_hash_rejected() { invalid_metadata(3); }
#[test, expected_failure(abort_code = 7, location = soulidity::profile)]
fun empty_metadata_rejected() { invalid_metadata(4); }
#[test, expected_failure(abort_code = 7, location = soulidity::profile)]
fun oversized_metadata_rejected() { invalid_metadata(5); }

#[test]
fun released_handle_does_not_alias_identity() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let alice = create(&mut registry, b"alice", &clock, scenario.ctx());
    ts::return_shared(registry);
    ts::return_shared(clock);
    scenario.next_tx(ALICE);
    let mut wallet_profile = scenario.take_from_sender<WalletProfileV1>();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    update(&mut registry, &mut wallet_profile, 0, b"", &clock, scenario.ctx());
    ts::return_to_sender(&scenario, wallet_profile);
    ts::return_shared(registry);
    ts::return_shared(clock);
    scenario.next_tx(BOB);
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let bob = create(&mut registry, b"alice", &clock, scenario.ctx());
    assert!(alice != bob && profile::profile_count(&registry) == 2
        && profile::profile_for_owner(&registry, ALICE) == alice
        && profile::profile_for_owner(&registry, BOB) == bob
        && profile::profile_at_index(&registry, 0) == alice
        && profile::profile_at_index(&registry, 1) == bob
        && profile::profile_for_handle(&registry, b"alice".to_string()) == bob, 99);
    ts::return_shared(registry);
    ts::return_shared(clock);
    scenario.end();
}

#[test]
fun two_empty_handles_do_not_collide() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let alice = create(&mut registry, b"", &clock, scenario.ctx());
    ts::return_shared(registry); ts::return_shared(clock);
    scenario.next_tx(BOB);
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    let bob = create(&mut registry, b"", &clock, scenario.ctx());
    assert!(alice != bob && profile::profile_count(&registry) == 2
        && !profile::contains_handle(&registry, b"".to_string()), 99);
    ts::return_shared(registry); ts::return_shared(clock);
    scenario.end();
}

#[test, expected_failure(abort_code = 5, location = soulidity::profile)]
fun update_to_another_wallets_handle_rejected() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    create(&mut registry, b"alice", &clock, scenario.ctx());
    ts::return_shared(registry); ts::return_shared(clock);
    scenario.next_tx(BOB);
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    create(&mut registry, b"bob", &clock, scenario.ctx());
    ts::return_shared(registry); ts::return_shared(clock);
    scenario.next_tx(ALICE);
    let mut wallet_profile = scenario.take_from_sender<WalletProfileV1>();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let clock = scenario.take_shared<Clock>();
    update(&mut registry, &mut wallet_profile, 0, b"bob", &clock, scenario.ctx());
    abort 99
}

#[test, expected_failure(abort_code = 0, location = soulidity::profile)]
fun update_with_another_registry_rejected() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let old_registry_id = object::id(&registry);
    let clock = scenario.take_shared<Clock>();
    create(&mut registry, b"alice", &clock, scenario.ctx());
    ts::return_shared(registry); ts::return_shared(clock);
    // Only the test initializer can manufacture a second registry.
    profile::init_for_testing(scenario.ctx());
    scenario.next_tx(ALICE);
    let mut wallet_profile = scenario.take_from_sender<WalletProfileV1>();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    assert!(object::id(&registry) != old_registry_id, 99);
    let clock = scenario.take_shared<Clock>();
    update(&mut registry, &mut wallet_profile, 0, b"new_name", &clock, scenario.ctx());
    abort 99
}
