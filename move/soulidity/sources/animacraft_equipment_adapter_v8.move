/// Native Soul owns the persistent equipment pointer. Caller IDs or a Player
/// loadout cannot substitute for its live owner and immutable Maker provenance.
module soulidity::animacraft_equipment_adapter_v8;

use soulidity::soul::{Self, SoulState};
use soulidity::animacraft_v8_binding as native_proof;
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::treasury_v8::MakerAccessPassV8;
use animacraft_v8_core::base_registry_v8::BaseDefinitionRegistryV8;
use animacraft_v8_output::output_v8::{Self as output, NativeSoulBindingV8};
use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8,
    RuntimeDefinitionRegistryV8, PackRegistryV8, OwnedBaseItemV8, OwnedExternalItemV8,
    ExternalItemProductV8, SoulEquipmentUpdateV8, PackReleaseV8, PackPassV8, PackDefinitionProofV8};
use animacraft_v8_runtime::runtime_seal_v8;
use animacraft_v8_seal::seal_v8::{SealRegistryV8, SealPolicyConfigV8};
use std::string::String;

const EBindingMismatch: u64 = 0;

public fun create_equipment_v8<PaymentCoin>(
    state: &mut SoulState, provenance: &NativeSoulBindingV8,
    root: &MakerRootV8<PaymentCoin>, protocol: &ProtocolConfigV8,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    access: &MakerAccessPassV8, ctx: &mut TxContext,
): ID {
    assert!(soul::animacraft_native_v8_binding_id(state) == object::id(provenance)
        && output::native_soul_binding_soul_id_v8(provenance) == soul::soul_id(state)
        && output::native_soul_binding_state_id_v8(provenance) == object::id(state)
        && output::native_soul_binding_root_id_v8(provenance) == object::id(root)
        && output::native_soul_binding_protocol_id_v8(provenance) == object::id(protocol), EBindingMismatch);
    maker::assert_current_protocol_config_v8(root, protocol);
    let witness = native_proof::owner_witness(state, ctx);
    let id = runtime::create_soul_equipment_v8(root, protocol, definitions, packs,
        access, soul::soul_id(state), object::id(state), soul::ownership_epoch(state), witness, ctx);
    soul::bind_animacraft_native_equipment_v8(state, id);
    id
}

/// A completed Soul alone does not grant component keys: Release follows this
/// live DF10/owner guard with the existing exact selected-row entitlement checks.
public fun assert_equipment_read_v8(
    state: &SoulState, equipment: &MakerLoadoutV8,
    protocol: &ProtocolConfigV8, ctx: &TxContext,
) {
    assert!(soul::animacraft_native_equipment_id_v8(state) == object::id(equipment)
        && runtime::soul_equipment_soul_id_v8(equipment) == soul::soul_id(state)
        && runtime::soul_equipment_state_id_v8(equipment) == object::id(state), EBindingMismatch);
    runtime::assert_soul_equipment_read_v8(equipment, protocol,
        native_proof::read_owner_witness(state, ctx), ctx);
}

/// Open once for the whole atomic update, not once per slot. The returned
/// non-droppable guard must be consumed by finish_update_v8 after all mutations.
public fun begin_update_v8(
    state: &SoulState, equipment: &mut MakerLoadoutV8,
    protocol: &ProtocolConfigV8, revision: u64, ctx: &TxContext,
): SoulEquipmentUpdateV8 {
    assert!(soul::animacraft_native_equipment_id_v8(state) == object::id(equipment)
        && runtime::soul_equipment_soul_id_v8(equipment) == soul::soul_id(state)
        && runtime::soul_equipment_state_id_v8(equipment) == object::id(state), EBindingMismatch);
    runtime::begin_soul_equipment_update_v8(equipment, protocol, revision, native_proof::owner_witness(state, ctx), ctx)
}

public fun finish_update_v8(
    equipment: &mut MakerLoadoutV8, definitions: &RuntimeDefinitionRegistryV8,
    base: &BaseDefinitionRegistryV8, pack_definitions: vector<PackDefinitionProofV8>, update: SoulEquipmentUpdateV8,
) {
    runtime::finish_soul_equipment_update_v8(equipment, definitions, base, pack_definitions, update);
}

/// After all components are removed, release the binding before ordinary Market
/// listing/transfer. This does not transfer any of the seller's wallet components.
public fun close_empty_equipment_v8(
    state: &mut SoulState, equipment: MakerLoadoutV8,
    protocol: &ProtocolConfigV8, revision: u64, ctx: &TxContext,
) {
    assert!(soul::animacraft_native_equipment_id_v8(state) == object::id(&equipment)
        && runtime::soul_equipment_soul_id_v8(&equipment) == soul::soul_id(state)
        && runtime::soul_equipment_state_id_v8(&equipment) == object::id(state), EBindingMismatch);
    let id = runtime::close_soul_equipment_v8(equipment, protocol, revision,
        native_proof::owner_witness(state, ctx), ctx);
    soul::unbind_animacraft_native_equipment_v8(state, id);
}

public fun equip_base_v8<PaymentCoin>(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8, item: &mut OwnedBaseItemV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    base: &BaseDefinitionRegistryV8, access: &MakerAccessPassV8,
    revision: u64, target_selection_index: Option<u64>, style_key: String, swatch_key: Option<String>, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime::equip_owned_base_style_v8(equipment, item, root, definitions, packs, base, access,
        revision, target_selection_index, style_key, swatch_key, ctx);
}

/// Maker access is an entitlement, not an independently owned component object.
public fun select_base_v8<PaymentCoin>(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    base: &BaseDefinitionRegistryV8, access: &MakerAccessPassV8,
    revision: u64, target_selection_index: Option<u64>, part_key: String, item_key: String, style_key: String,
    swatch_key: Option<String>, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime::select_base_style_v8(equipment, root, definitions, packs, base, access,
        revision, target_selection_index, part_key, item_key, style_key, swatch_key, ctx);
}

/// Explicit append-only definition attachment stays inside the same equipment guard.
public fun attach_pack_definitions_v8<PaymentCoin>(
    guard: &runtime::SoulEquipmentUpdateV8,
    equipment: &mut MakerLoadoutV8, root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    release: &PackReleaseV8<PaymentCoin>, pass: &PackPassV8,
    maker_access: &MakerAccessPassV8, expected_revision: u64, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, guard, ctx);
    runtime::attach_pack_definitions_v8(equipment, root, definitions, packs,
        release, pass, maker_access, expected_revision, ctx);
}

/// Public/protected Pack styles share the same pre-certified release and pass.
public fun select_pack_v8<PaymentCoin>(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    base: &BaseDefinitionRegistryV8, release: &PackReleaseV8<PaymentCoin>,
    pass: &PackPassV8, access: &MakerAccessPassV8,
    revision: u64, target_selection_index: Option<u64>, part_key: String, item_key: String, style_key: String,
    swatch_key: Option<String>, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime::select_pack_style_v8(equipment, root, definitions, base, packs,
        release, pass, access, revision, target_selection_index, part_key, item_key, style_key, swatch_key, ctx);
}

/// Source-independent recovery for Base/Pack entitlements, never owned instances.
public fun clear_selection_v8(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8,
    revision: u64, selection_index: u64, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime::clear_non_external_selection_v8(equipment, selection_index, revision, ctx);
}

/// Seal verifies the immutable encrypted row; this grants no decrypt authority.
public fun select_protected_base_v8<PaymentCoin>(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    base: &BaseDefinitionRegistryV8, access: &MakerAccessPassV8,
    revision: u64, target_selection_index: Option<u64>, part_key: String, item_key: String, style_key: String,
    swatch_key: Option<String>, seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8,
    ciphertext_blob_commitment: vector<u8>, certification_commitment: vector<u8>, seal_id: vector<u8>, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime_seal_v8::select_protected_base_style_v8(equipment, root, definitions, packs, base, access,
        seal_registry, seal_policy, revision, target_selection_index, part_key, item_key, style_key, swatch_key,
        ciphertext_blob_commitment, certification_commitment, seal_id, ctx);
}

public fun equip_protected_base_v8<PaymentCoin>(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8, item: &mut OwnedBaseItemV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    base: &BaseDefinitionRegistryV8, access: &MakerAccessPassV8,
    revision: u64, target_selection_index: Option<u64>, style_key: String, swatch_key: Option<String>,
    seal_registry: &SealRegistryV8, seal_policy: &SealPolicyConfigV8,
    ciphertext_blob_commitment: vector<u8>, certification_commitment: vector<u8>, seal_id: vector<u8>, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime_seal_v8::equip_protected_owned_base_style_v8(equipment, item, root, definitions, packs, base, access,
        seal_registry, seal_policy, revision, target_selection_index, style_key, swatch_key,
        ciphertext_blob_commitment, certification_commitment, seal_id, ctx);
}

public fun equip_external_v8<PaymentCoin>(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8, item: &mut OwnedExternalItemV8,
    root: &MakerRootV8<PaymentCoin>,
    definitions: &RuntimeDefinitionRegistryV8, packs: &PackRegistryV8,
    product: &ExternalItemProductV8, access: &MakerAccessPassV8,
    revision: u64, target_selection_index: Option<u64>, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime::equip_external_style_v8(equipment, item, root, definitions, packs, product, access, revision, target_selection_index, ctx);
}

/// Removal does not depend on Maker access, active source or successful payment.
public fun unequip_base_v8(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8, item: &mut OwnedBaseItemV8,
    revision: u64, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime::unequip_owned_base_style_v8(equipment, item, revision, ctx);
}

public fun unequip_external_v8(
    update: &SoulEquipmentUpdateV8, equipment: &mut MakerLoadoutV8, item: &mut OwnedExternalItemV8,
    revision: u64, ctx: &TxContext,
) {
    runtime::assert_soul_equipment_update_v8(equipment, update, ctx);
    runtime::unequip_external_style_v8(equipment, item, revision, ctx);
}

#[test_only]
fun native_equipment_test_read(case: u8) {
    let mut ctx = tx_context::new_from_hint(@0xA11, 830, 0, 0, 0);
    let (mut config, admin) = animacraft_v8_core::protocol_config_v8::new_protocol_for_testing<u64>(true, &mut ctx);
    animacraft_v8_core::soulidity_binding_v8::install_soulidity_binding_v8<
        soulidity::soul::Soul, native_proof::MintBindingWitnessV8, native_proof::SoulOwnerWitnessV8,
    >(&mut config, &admin);
    animacraft_v8_core::protocol_config_v8::set_protocol_enabled_v8(&mut config, &admin, false);
    let mut state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        ctx.sender(), object::id_from_address(@0x43), &mut ctx);
    if (case == 4 || case == 5) {
        soul::rotate_owner(&mut state, if (case == 5) @0xB22 else ctx.sender(), object::id_from_address(@0x44));
    };
    soul::bind_animacraft_native_v8(&mut state, object::id_from_address(@0x45));
    let equipment = runtime::soul_equipment_read_fixture_for_testing(
        if (case == 2) object::id_from_address(@0x99) else soul::soul_id(&state),
        if (case == 3) object::id_from_address(@0x99) else object::id(&state),
        ctx.sender(), 0,
        if (case == 6) object::id_from_address(@0x99) else object::id(&config), &mut ctx);
    // Isolated read-policy fixture, not a Market listing flow. Production
    // listing still refuses an already equipped Soul; do not weaken that gate.
    soul::set_listed(&mut state, true);
    if (case != 7) {
        soul::bind_animacraft_native_equipment_v8(&mut state,
            if (case == 1) object::id_from_address(@0x99) else object::id(&equipment));
    };
    let state_before = std::bcs::to_bytes(&state);
    let equipment_before = std::bcs::to_bytes(&equipment);
    assert_equipment_read_v8(&state, &equipment, &config, &ctx);
    assert!(case == 0 && soul::is_listed(&state)
        && std::bcs::to_bytes(&state) == state_before
        && std::bcs::to_bytes(&equipment) == equipment_before
        && soul::animacraft_native_equipment_id_v8(&state) == object::id(&equipment), 110);
    soul::unbind_animacraft_native_equipment_v8(&mut state, object::id(&equipment));
    runtime::destroy_soul_equipment_read_fixture_for_testing(equipment);
    soul::destroy_state_for_testing(state);
    animacraft_v8_core::protocol_config_v8::destroy_protocol_for_testing(config, admin);
}

#[test]
fun native_equipment_read_accepts_listed_owner_without_mutation() { native_equipment_test_read(0); }
#[test, expected_failure(abort_code = EBindingMismatch)]
fun native_equipment_read_rejects_different_df10() { native_equipment_test_read(1); }
#[test, expected_failure(abort_code = EBindingMismatch)]
fun native_equipment_read_rejects_different_soul() { native_equipment_test_read(2); }
#[test, expected_failure(abort_code = EBindingMismatch)]
fun native_equipment_read_rejects_different_state() { native_equipment_test_read(3); }
#[test, expected_failure(abort_code = 8, location = animacraft_v8_runtime::runtime_v8)]
fun native_equipment_read_rejects_changed_epoch() { native_equipment_test_read(4); }
#[test, expected_failure(abort_code = 1, location = soulidity::soul)]
fun native_equipment_read_rejects_previous_owner() { native_equipment_test_read(5); }
#[test, expected_failure(abort_code = 0, location = animacraft_v8_runtime::runtime_v8)]
fun native_equipment_read_rejects_different_protocol() { native_equipment_test_read(6); }
#[test, expected_failure(abort_code = 1, location = sui::dynamic_field)]
fun native_equipment_read_rejects_missing_df10() { native_equipment_test_read(7); }

#[test_only]
fun native_equipment_transaction_case(mode: u8) {
    use animacraft_v8_core::base_registry_v8 as base;
    use animacraft_v8_core::protocol_config_v8 as protocol;
    let mut ctx = tx_context::new_from_hint(@0xA11, 860, 0, 0, 0);
    let (mut config, admin) = protocol::new_protocol_for_testing<u64>(true, &mut ctx);
    animacraft_v8_core::soulidity_binding_v8::install_soulidity_binding_v8<
        soulidity::soul::Soul, native_proof::MintBindingWitnessV8, native_proof::SoulOwnerWitnessV8,
    >(&mut config, &admin);
    let mut state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        ctx.sender(), object::id_from_address(@0x43), &mut ctx);
    soul::bind_animacraft_native_v8(&mut state, object::id_from_address(@0x45));
    let mut equipment = runtime::soul_equipment_read_fixture_for_testing(soul::soul_id(&state),
        object::id(&state), ctx.sender(), 0, object::id(&config), &mut ctx);
    soul::bind_animacraft_native_equipment_v8(&mut state, object::id(&equipment));
    let tokens = vector[base::new_visibility_token_v1(0, option::some(base::new_semantic_selector_v2(
        1, option::none(), b"part".to_string(), option::some(b"item".to_string()),
        option::some(b"style".to_string()))), 0)];
    let (definitions, registry) = runtime::equipment_visibility_definitions_for_testing(&mut equipment, tokens, 0, &mut ctx);
    runtime::install_equipment_visibility_selection_for_testing(&mut equipment, 0, 0, true);
    runtime::install_equipment_visibility_selection_for_testing(&mut equipment, 2, 1, true);
    let original = *runtime::loadout_selections_v8(&equipment);
    let original_commitment = *runtime::loadout_commitment_v8(&equipment);
    protocol::set_protocol_enabled_v8(&mut config, &admin, false);
    let guard = begin_update_v8(&state, &mut equipment, &config, if (mode == 4) 1 else 2, &ctx);
    if (mode == 3) {
        let mut other = runtime::soul_equipment_read_fixture_for_testing(soul::soul_id(&state),
            object::id(&state), ctx.sender(), 0, object::id(&config), &mut ctx);
        clear_selection_v8(&guard, &mut other, 0, 0, &ctx);
        runtime::destroy_soul_equipment_read_fixture_for_testing(other);
    };
    if (mode == 5) {
        let second = begin_update_v8(&state, &mut equipment, &config, 2, &ctx);
        finish_update_v8(&mut equipment, &definitions, &registry, vector[], second);
    };
    if (mode != 2) {
        clear_selection_v8(&guard, &mut equipment, 2, 0, &ctx);
        assert!(runtime::loadout_revision_v8(&equipment) == 3
            && runtime::loadout_selection_count_v8(&equipment) == 1, 120);
        if (mode == 0) clear_selection_v8(&guard, &mut equipment, 3, 2, &ctx);
    };
    finish_update_v8(&mut equipment, &definitions, &registry, vector[], guard);
    assert!(runtime::is_soul_equipment_v8(&equipment)
        && runtime::soul_equipment_state_id_v8(&equipment) == object::id(&state)
        && soul::animacraft_native_equipment_id_v8(&state) == object::id(&equipment), 121);
    if (mode == 2) {
        assert!(*runtime::loadout_selections_v8(&equipment) == original
            && *runtime::loadout_commitment_v8(&equipment) == original_commitment, 122);
    } else {
        assert!(runtime::loadout_revision_v8(&equipment) == 4
            && runtime::loadout_selection_count_v8(&equipment) == 0
            && runtime::loadout_selections_v8(&equipment).length() == 3, 123);
    };
    soul::unbind_animacraft_native_equipment_v8(&mut state, object::id(&equipment));
    runtime::destroy_soul_equipment_read_fixture_for_testing(equipment);
    runtime::destroy_equipment_visibility_definitions_for_testing(definitions);
    base::share_base_definition_registry_for_testing(registry);
    soul::destroy_state_for_testing(state);
    protocol::destroy_protocol_for_testing(config, admin);
}

#[test]
fun native_equipment_transaction_two_clears_allow_intermediate_invalid_and_empty_final() { native_equipment_transaction_case(0); }
#[test, expected_failure(abort_code = 30, location = animacraft_v8_runtime::runtime_v8)]
fun native_equipment_transaction_rejects_removing_only_dependency() { native_equipment_transaction_case(1); }
#[test]
fun native_equipment_transaction_keeps_sparse_protected_selection_identity() { native_equipment_transaction_case(2); }
#[test, expected_failure(abort_code = 0, location = animacraft_v8_runtime::runtime_v8)]
fun native_equipment_transaction_rejects_other_equipment_guard() { native_equipment_transaction_case(3); }
#[test, expected_failure(abort_code = 7, location = animacraft_v8_runtime::runtime_v8)]
fun native_equipment_transaction_rejects_stale_initial_revision() { native_equipment_transaction_case(4); }
#[test, expected_failure(abort_code = 1, location = sui::dynamic_field)]
fun native_equipment_transaction_rejects_nested_begin() { native_equipment_transaction_case(5); }
