#[test_only]
module soulidity::private_bookmarks_tests;

use std::{bcs, hash, string};
use soulidity::profile::{Self as profile, ProfileRegistryV1};
use sui::test_scenario as ts;

const ALICE: address = @0xA11;
const BOB: address = @0xB0B;

fun start(): ts::Scenario {
    let mut scenario = ts::begin(ALICE);
    profile::init_for_testing(scenario.ctx());
    scenario.next_tx(ALICE);
    scenario
}
fun digest(byte: u8): vector<u8> {
    let mut out = vector[];
    while (out.length() < 32) out.push_back(byte);
    out
}
fun blob_id(): vector<u8> { b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }
fun commit(registry: &mut ProfileRegistryV1, expected: u64, request: u8, ctx: &TxContext): u64 {
    profile::commit_bookmarks(registry, expected, digest(request), object::id_from_address(@0xB10B),
        string::utf8(blob_id()), digest(7), 256, ctx)
}

#[test]
fun absent_wallet_can_approve_and_commit_without_profile_or_assets() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let before = bcs::to_bytes(&registry);
    assert!(profile::bookmarks_head(&registry, ALICE).is_none()
        && profile::bookmarks_revision(&registry, ALICE) == 0
        && profile::bookmarks_receipt(&registry, ALICE, digest(1)).is_none(), 99);
    let seal_id = profile::bookmarks_seal_id(&registry, ALICE);
    profile::seal_approve_bookmarks(seal_id, &registry, scenario.ctx());
    assert!(commit(&mut registry, 0, 1, scenario.ctx()) == 1, 99);
    assert!(profile::bookmarks_revision(&registry, ALICE) == 1
        && profile::bookmarks_revision(&registry, BOB) == 0
        && !profile::contains_owner(&registry, ALICE) && profile::profile_count(&registry) == 0,
        99);
    assert!(bcs::to_bytes(&registry) == before, 99);
    assert!(profile::bookmarks_seal_id(&registry, ALICE) == seal_id, 99);
    profile::seal_approve_bookmarks(seal_id, &registry, scenario.ctx());
    let receipt = profile::bookmarks_receipt(&registry, ALICE, digest(1)).destroy_some();
    assert!(profile::bookmarks_receipt_revision(&receipt) == 1, 99);
    ts::return_shared(registry);
    scenario.end();
}

#[test]
fun same_request_is_idempotent_before_cas_and_after_later_commit() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    assert!(commit(&mut registry, 0, 1, scenario.ctx()) == 1, 99);
    assert!(commit(&mut registry, 999, 1, scenario.ctx()) == 1, 99);
    assert!(commit(&mut registry, 1, 2, scenario.ctx()) == 2, 99);
    let before = bcs::to_bytes(&profile::bookmarks_head(&registry, ALICE));
    assert!(commit(&mut registry, 0, 1, scenario.ctx()) == 1, 99);
    assert!(bcs::to_bytes(&profile::bookmarks_head(&registry, ALICE)) == before, 99);
    ts::return_shared(registry);
    scenario.end();
}

#[test]
fun wallet_switch_and_return_preserve_two_independent_heads() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let alice_seal = profile::bookmarks_seal_id(&registry, ALICE);
    assert!(commit(&mut registry, 0, 1, scenario.ctx()) == 1, 99);
    ts::return_shared(registry);
    scenario.next_tx(BOB);
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let bob_seal = profile::bookmarks_seal_id(&registry, BOB);
    assert!(alice_seal != bob_seal, 99);
    profile::seal_approve_bookmarks(bob_seal, &registry, scenario.ctx());
    assert!(commit(&mut registry, 0, 1, scenario.ctx()) == 1, 99);
    assert!(commit(&mut registry, 1, 2, scenario.ctx()) == 2, 99);
    assert!(profile::bookmarks_revision(&registry, ALICE) == 1, 99);
    ts::return_shared(registry);
    scenario.next_tx(ALICE);
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    profile::seal_approve_bookmarks(alice_seal, &registry, scenario.ctx());
    assert!(commit(&mut registry, 0, 1, scenario.ctx()) == 1, 99);
    assert!(profile::bookmarks_revision(&registry, BOB) == 2, 99);
    ts::return_shared(registry);
    scenario.end();
}

#[test]
fun receipt_window_has_exact_last_32_and_no_bookmark_count_quota() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let mut i: u64 = 0;
    while (i < 40) {
        assert!(commit(&mut registry, i, ((i + 1) as u8), scenario.ctx()) == i + 1, 99);
        i = i + 1;
    };
    i = 1;
    while (i <= 40) {
        let receipt = profile::bookmarks_receipt(&registry, ALICE, digest((i as u8)));
        if (i <= 8) assert!(receipt.is_none(), 99)
        else assert!(profile::bookmarks_receipt_revision(receipt.borrow()) == i, 99);
        i = i + 1;
    };
    // An evicted request has no idempotency promise; the encrypted client
    // document/recovery workflow must reconstruct intent before a new write.
    assert!(commit(&mut registry, 40, 1, scenario.ctx()) == 41, 99);
    assert!(profile::profile_count(&registry) == 0, 99);
    ts::return_shared(registry);
    scenario.end();
}

#[test]
fun seal_exact_domain_version_registry_owner_preimage() {
    let mut scenario = start();
    let registry = scenario.take_shared<ProfileRegistryV1>();
    let mut preimage = bcs::to_bytes(&b"soulidity/private-bookmarks/seal-id/v1".to_string());
    preimage.push_back(1);
    preimage.append(bcs::to_bytes(&profile::registry_id(&registry)));
    let owner = ALICE;
    preimage.append(bcs::to_bytes(&owner));
    assert!(hash::sha2_256(preimage) == profile::bookmarks_seal_id(&registry, ALICE), 99);
    // Stable VM-derived vectors for SDK BCS/Seal parity, not a live release.
    std::debug::print(&profile::registry_id(&registry));
    std::debug::print(&profile::bookmarks_seal_id(&registry, ALICE));
    ts::return_shared(registry);
    scenario.end();
}

#[test]
fun exact_ciphertext_resource_bound_is_accepted() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    assert!(profile::commit_bookmarks(&mut registry, 0, digest(1), object::id_from_address(@0xB10B),
        string::utf8(blob_id()), digest(7), 16_777_216, scenario.ctx()) == 1, 99);
    ts::return_shared(registry);
    scenario.end();
}

#[test, expected_failure(abort_code = 6, location = soulidity::profile)]
fun stale_cas_rejected() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    commit(&mut registry, 0, 1, scenario.ctx());
    commit(&mut registry, 0, 2, scenario.ctx());
    abort 99
}
#[test, expected_failure(abort_code = 6, location = soulidity::profile)]
fun future_cas_rejected_on_absent_head() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    commit(&mut registry, 18_446_744_073_709_551_615, 1, scenario.ctx());
    abort 99
}
#[test, expected_failure(abort_code = 11, location = soulidity::profile)]
fun same_request_different_reference_rejected_before_cas() {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    commit(&mut registry, 0, 1, scenario.ctx());
    profile::commit_bookmarks(&mut registry, 999, digest(1), object::id_from_address(@0xB10C),
        string::utf8(blob_id()), digest(7), 256, scenario.ctx());
    abort 99
}
#[test, expected_failure(abort_code = 12, location = soulidity::profile)]
fun other_wallet_seal_id_rejected_without_head() {
    let mut scenario = start();
    let registry = scenario.take_shared<ProfileRegistryV1>();
    profile::seal_approve_bookmarks(profile::bookmarks_seal_id(&registry, BOB), &registry, scenario.ctx());
    abort 99
}
#[test, expected_failure(abort_code = 12, location = soulidity::profile)]
fun seal_id_from_other_registry_rejected() {
    let mut scenario = start();
    let registry = scenario.take_shared<ProfileRegistryV1>();
    let id = profile::bookmarks_seal_id(&registry, ALICE);
    let registry_id = object::id(&registry);
    ts::return_shared(registry);
    profile::init_for_testing(scenario.ctx());
    scenario.next_tx(ALICE);
    let other_id = ts::most_recent_id_shared<ProfileRegistryV1>().destroy_some();
    assert!(other_id != registry_id, 99);
    let other = scenario.take_shared_by_id<ProfileRegistryV1>(other_id);
    profile::seal_approve_bookmarks(id, &other, scenario.ctx());
    abort 99
}

fun invalid_reference(mode: u8) {
    let mut scenario = start();
    let mut registry = scenario.take_shared<ProfileRegistryV1>();
    let request = if (mode == 1) vector[1] else if (mode == 2) digest(0) else digest(1);
    let hash = if (mode == 3) vector[1] else if (mode == 4) digest(0) else digest(7);
    let object = object::id_from_address(if (mode == 5) @0x0 else @0xB10B);
    let length = if (mode == 6) 0 else if (mode == 7) 16_777_217 else 256;
    let mut blob = if (mode == 8) b"short" else blob_id();
    if (mode == 9) *blob.borrow_mut(0) = 47;
    if (mode == 10) *blob.borrow_mut(42) = 66;
    profile::commit_bookmarks(&mut registry, 0, request, object, string::utf8(blob), hash, length, scenario.ctx());
    abort 99
}
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun short_request_rejected() { invalid_reference(1); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun zero_request_rejected() { invalid_reference(2); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun short_hash_rejected() { invalid_reference(3); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun zero_hash_rejected() { invalid_reference(4); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun zero_blob_object_rejected() { invalid_reference(5); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun empty_ciphertext_rejected() { invalid_reference(6); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun oversized_ciphertext_rejected() { invalid_reference(7); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun short_blob_id_rejected() { invalid_reference(8); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun invalid_blob_id_alphabet_rejected() { invalid_reference(9); }
#[test, expected_failure(abort_code = 10, location = soulidity::profile)]
fun noncanonical_blob_id_tail_rejected() { invalid_reference(10); }
