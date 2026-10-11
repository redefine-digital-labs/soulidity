#[test_only]
module soulidity::named_loadout_v1_tests;

use std::{bcs, string::{Self as string, String}};
use sui::test_scenario as ts;
use soulidity::soul::{Self as soul, SoulState};
use soulidity::named_loadout_v1 as named;
use animacraft_v8_core::protocol_config_v8 as protocol;
use animacraft_v8_core::soulidity_binding_v8;
use animacraft_v8_runtime::runtime_v8 as runtime;
use soulidity::animacraft_v8_binding as native_proof;

const A: address = @0xA11;
const B: address = @0xB22;

fun id(n: address): ID { object::id_from_address(n) }
fun hash(byte: u8): vector<u8> { vector::tabulate!(32, |_| byte) }
fun blob(): String { string::utf8(b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") }
fun state(ctx: &mut TxContext): SoulState {
    let mut state = soul::create_state(id(@0x42), A, 250, A, id(@0x43), ctx);
    soul::set_content_id(&mut state, id(@0x46));
    state
}
fun update(state: &mut SoulState, epoch: u64, revision: u64, request: u8, ctx: &TxContext): u64 {
    named::update(state, epoch, revision, hash(request), id(@0x44), blob(), hash(7), 1024, ctx)
}

#[test]
fun current_library_is_a_typed_child_not_state_or_public_config() {
    let mut scenario = ts::begin(A);
    let mut state = state(scenario.ctx());
    let before = bcs::to_bytes(&state);
    assert!(named::current_revision(&state) == 0 && named::current_head(&state).is_none(), 99);
    assert!(update(&mut state, 0, 0, 1, scenario.ctx()) == 1, 99);
    assert!(bcs::to_bytes(&state) == before && !soul::has_state_config(&state, string::utf8(b"named_loadout_v1")), 99);
    let first = bcs::to_bytes(named::current_head(&state).borrow());
    assert!(update(&mut state, 0, 0, 1, scenario.ctx()) == 1, 99);
    assert!(bcs::to_bytes(named::current_head(&state).borrow()) == first, 99);
    soul::share_state(state);
    scenario.end();
}

#[test]
fun receipt_precedes_revision_cas_and_does_not_overwrite_newer_head() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    update(&mut state, 0, 0, 1, scenario.ctx());
    update(&mut state, 0, 1, 2, scenario.ctx());
    let before = bcs::to_bytes(named::current_head(&state).borrow());
    assert!(update(&mut state, 0, 999, 1, scenario.ctx()) == 1, 99);
    assert!(named::current_revision(&state) == 2
        && bcs::to_bytes(named::current_head(&state).borrow()) == before, 99);
    soul::share_state(state); scenario.end();
}

#[test]
fun bounded_receipt_window_keeps_the_latest_32_without_resetting_revision() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    let mut i = 0;
    while (i < 33) { update(&mut state, 0, i, (i + 1) as u8, scenario.ctx()); i = i + 1; };
    assert!(named::current_revision(&state) == 33 && named::receipt(&state, hash(1)).is_none(), 99);
    assert!(named::receipt_revision(named::receipt(&state, hash(2)).borrow()) == 2
        && named::receipt_revision(named::receipt(&state, hash(33)).borrow()) == 33, 99);
    soul::share_state(state); scenario.end();
}

#[test]
fun transfer_back_never_reopens_the_old_owner_epoch_library() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    let old_seal_id = named::seal_id(&state, A, 0);
    update(&mut state, 0, 0, 1, scenario.ctx());
    soul::rotate_owner(&mut state, B, id(@0x51));
    soul::share_state(state); scenario.next_tx(B);
    let mut state = scenario.take_shared<SoulState>();
    assert!(named::current_revision(&state) == 0 && named::receipt(&state, hash(1)).is_none(), 99);
    assert!(update(&mut state, 1, 0, 1, scenario.ctx()) == 1, 99);
    soul::rotate_owner(&mut state, A, id(@0x52));
    ts::return_shared(state); scenario.next_tx(A);
    let mut state = scenario.take_shared<SoulState>();
    assert!(named::current_revision(&state) == 0 && named::receipt(&state, hash(1)).is_none(), 99);
    assert!(named::seal_id(&state, A, 2) != old_seal_id, 99);
    assert!(update(&mut state, 2, 0, 1, scenario.ctx()) == 1, 99);
    ts::return_shared(state); scenario.end();
}

#[test]
fun approval_allows_paid_uncommitted_ciphertext_and_listed_owner() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    soul::set_listed(&mut state, true);
    let seal_id = named::seal_id(&state, A, 0);
    named::seal_approve(copy seal_id, &state, 0, scenario.ctx());
    update(&mut state, 0, 0, 1, scenario.ctx());
    update(&mut state, 0, 1, 2, scenario.ctx());
    named::seal_approve(seal_id, &state, 0, scenario.ctx());
    assert!(soul::is_listed(&state), 99);
    soul::share_state(state); scenario.end();
}

public struct ExpectedSealScope has drop {
    domain: String, version: u8, soul_id: ID, state_id: ID, owner: address, ownership_epoch: u64,
}
#[test]
fun seal_id_uses_exact_versioned_bcs_and_changes_for_every_scope_field() {
    let mut scenario = ts::begin(A); let state = state(scenario.ctx());
    let other = soul::create_state(id(@0x99), A, 250, A, id(@0x43), scenario.ctx());
    let actual = named::seal_id(&state, A, 0);
    let expected = std::hash::sha2_256(bcs::to_bytes(&ExpectedSealScope {
        domain: string::utf8(b"soulidity/private-named-loadouts/seal-id/v1"), version: 1,
        soul_id: soul::soul_id(&state), state_id: object::id(&state), owner: A, ownership_epoch: 0,
    }));
    assert!(actual == expected && actual != named::seal_id(&state, B, 0)
        && actual != named::seal_id(&state, A, 1) && actual != named::seal_id(&other, A, 0), 99);
    soul::destroy_state_for_testing(state); soul::destroy_state_for_testing(other); scenario.end();
}

#[test, expected_failure(abort_code = 2, location = soulidity::named_loadout_v1)]
fun stale_new_request_cannot_overwrite() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    update(&mut state, 0, 0, 1, scenario.ctx());
    update(&mut state, 0, 0, 2, scenario.ctx()); abort 99
}
#[test, expected_failure(abort_code = 4, location = soulidity::named_loadout_v1)]
fun receipt_replay_cannot_change_ciphertext() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    update(&mut state, 0, 0, 1, scenario.ctx());
    named::update(&mut state, 0, 0, hash(1), id(@0x44), blob(), hash(8), 1024, scenario.ctx()); abort 99
}
fun replay_reference_drift(case: u8) {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    update(&mut state, 0, 0, 1, scenario.ctx());
    named::update(&mut state, 0, 999, hash(1),
        if (case == 0) id(@0x99) else id(@0x44),
        if (case == 1) string::utf8(b"BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") else blob(),
        hash(7), if (case == 2) 1025 else 1024, scenario.ctx()); abort 99
}
#[test, expected_failure(abort_code = 4, location = soulidity::named_loadout_v1)] fun replay_rejects_changed_blob_object() { replay_reference_drift(0); }
#[test, expected_failure(abort_code = 4, location = soulidity::named_loadout_v1)] fun replay_rejects_changed_blob_id() { replay_reference_drift(1); }
#[test, expected_failure(abort_code = 4, location = soulidity::named_loadout_v1)] fun replay_rejects_changed_cipher_length() { replay_reference_drift(2); }

#[test]
fun maximum_cipher_reference_is_accepted_without_truncation() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    assert!(named::update(&mut state, 0, 0, hash(1), id(@0x44), blob(), hash(7),
        16_777_216, scenario.ctx()) == 1, 99);
    soul::share_state(state); scenario.end();
}
#[test, expected_failure(abort_code = 0, location = soulidity::named_loadout_v1)]
fun returning_owner_cannot_write_old_epoch() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    soul::rotate_owner(&mut state, B, id(@0x51)); soul::rotate_owner(&mut state, A, id(@0x52));
    update(&mut state, 0, 0, 1, scenario.ctx()); abort 99
}
#[test, expected_failure(abort_code = 1, location = soulidity::soul)]
fun former_owner_cannot_update() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    soul::rotate_owner(&mut state, B, id(@0x51)); update(&mut state, 1, 0, 1, scenario.ctx()); abort 99
}
#[test, expected_failure(abort_code = 1, location = soulidity::soul)]
fun former_owner_cannot_approve() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    let key = named::seal_id(&state, A, 0);
    soul::rotate_owner(&mut state, B, id(@0x51)); named::seal_approve(key, &state, 1, scenario.ctx()); abort 99
}
#[test, expected_failure(abort_code = 6, location = soulidity::named_loadout_v1)]
fun returning_owner_cannot_approve_old_seal_id() {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    let key = named::seal_id(&state, A, 0);
    soul::rotate_owner(&mut state, B, id(@0x51)); soul::rotate_owner(&mut state, A, id(@0x52));
    named::seal_approve(key, &state, 2, scenario.ctx()); abort 99
}
#[test, expected_failure(abort_code = 6, location = soulidity::named_loadout_v1)]
fun another_state_seal_id_cannot_approve() {
    let mut scenario = ts::begin(A); let state = state(scenario.ctx()); let other = state(scenario.ctx());
    named::seal_approve(named::seal_id(&other, A, 0), &state, 0, scenario.ctx()); abort 99
}

fun bad_reference(case: u8) {
    let mut scenario = ts::begin(A); let mut state = state(scenario.ctx());
    named::update(&mut state, 0, 0, if (case == 0) hash(0) else hash(1),
        if (case == 1) id(@0x0) else id(@0x44),
        if (case == 2) string::utf8(b"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB") else blob(),
        if (case == 3) hash(0) else if (case == 4) vector[1] else hash(7),
        if (case == 5) 0 else if (case == 6) 16_777_217 else 1024, scenario.ctx()); abort 99
}
#[test, expected_failure(abort_code = 3, location = soulidity::named_loadout_v1)] fun zero_request_rejected() { bad_reference(0); }
#[test, expected_failure(abort_code = 3, location = soulidity::named_loadout_v1)] fun zero_blob_object_rejected() { bad_reference(1); }
#[test, expected_failure(abort_code = 3, location = soulidity::named_loadout_v1)] fun noncanonical_blob_rejected() { bad_reference(2); }
#[test, expected_failure(abort_code = 3, location = soulidity::named_loadout_v1)] fun zero_hash_rejected() { bad_reference(3); }
#[test, expected_failure(abort_code = 3, location = soulidity::named_loadout_v1)] fun short_hash_rejected() { bad_reference(4); }
#[test, expected_failure(abort_code = 3, location = soulidity::named_loadout_v1)] fun empty_cipher_rejected() { bad_reference(5); }
#[test, expected_failure(abort_code = 3, location = soulidity::named_loadout_v1)] fun oversized_cipher_rejected() { bad_reference(6); }

/// Exact existing Runtime read-authority fixture, not a fake production cap or
/// a claim that a new native completion was performed in these focused tests.
fun save_case(case: u8) {
    let mut ctx = tx_context::new_from_hint(A, 993, 0, 0, 0);
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    soulidity_binding_v8::install_soulidity_binding_v8<soul::Soul,
        native_proof::MintBindingWitnessV8, native_proof::SoulOwnerWitnessV8>(&mut config, &admin);
    protocol::set_protocol_enabled_v8(&mut config, &admin, false);
    let mut state = state(&mut ctx);
    soul::bind_animacraft_native_v8(&mut state, id(@0x45));
    let equipment = runtime::soul_equipment_read_fixture_for_testing(soul::soul_id(&state), object::id(&state),
        A, 0, object::id(&config), &mut ctx);
    soul::bind_animacraft_native_equipment_v8(&mut state, if (case == 1) id(@0x99) else object::id(&equipment));
    let revision = runtime::loadout_revision_v8(&equipment);
    let commitment = *runtime::loadout_commitment_v8(&equipment);
    let capture_revision = if (case == 2) revision + 1 else revision;
    let capture_commitment = if (case == 3) hash(99) else commitment;
    let result = named::save(&mut state, &equipment, &config, 0, 0, hash(1), id(@0x44), blob(), hash(7), 1024,
        capture_revision, capture_commitment, &ctx);
    if (case > 0 && case < 4) abort 99;
    assert!(result == 1, 99);
    if (case == 4 || case == 5) {
        named::save(&mut state, &equipment, &config, 0, 999, hash(1), id(@0x44), blob(), hash(7), 1024,
            if (case == 4) revision + 1 else revision,
            if (case == 5) hash(99) else commitment, &ctx);
        abort 99
    };
    if (case == 6) {
        let other = runtime::soul_equipment_read_fixture_for_testing(soul::soul_id(&state), object::id(&state),
            A, 0, object::id(&config), &mut ctx);
        named::save(&mut state, &other, &config, 0, 999, hash(1), id(@0x44), blob(), hash(7), 1024,
            revision, commitment, &ctx);
        abort 99
    };
    if (case == 7) {
        update(&mut state, 0, 999, 1, &ctx); abort 99
    };
    // Removing DF10 makes a fresh capture invalid, but matching replay and a
    // head receipt remain queryable; no new equipment check/CAS is performed.
    soul::unbind_animacraft_native_equipment_v8(&mut state, object::id(&equipment));
    assert!(named::save(&mut state, &equipment, &config, 0, 999, hash(1), id(@0x44), blob(), hash(7), 1024,
        revision, commitment, &ctx) == 1, 99);
    runtime::destroy_soul_equipment_read_fixture_for_testing(equipment);
    assert!(named::receipt_revision(named::receipt(&state, hash(1)).borrow()) == 1, 99);
    assert!(update(&mut state, 0, 1, 2, &ctx) == 2, 99);
    soul::destroy_state_for_testing(state); protocol::destroy_protocol_for_testing(config, admin);
}
#[test] fun verified_capture_and_receipt_survive_equipment_closure() { save_case(0); }
#[test, expected_failure(abort_code = 0, location = soulidity::animacraft_equipment_adapter_v8)] fun capture_rejects_wrong_df10() { save_case(1); }
#[test, expected_failure(abort_code = 5, location = soulidity::named_loadout_v1)] fun capture_rejects_stale_revision() { save_case(2); }
#[test, expected_failure(abort_code = 5, location = soulidity::named_loadout_v1)] fun capture_rejects_wrong_commitment() { save_case(3); }
#[test, expected_failure(abort_code = 4, location = soulidity::named_loadout_v1)] fun replay_rejects_changed_capture_revision() { save_case(4); }
#[test, expected_failure(abort_code = 4, location = soulidity::named_loadout_v1)] fun replay_rejects_changed_capture_commitment() { save_case(5); }
#[test, expected_failure(abort_code = 4, location = soulidity::named_loadout_v1)] fun replay_rejects_changed_capture_equipment() { save_case(6); }
#[test, expected_failure(abort_code = 4, location = soulidity::named_loadout_v1)] fun replay_rejects_save_changed_to_update() { save_case(7); }
