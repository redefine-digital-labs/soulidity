module soulidity::animacraft_v8_binding;

use soulidity::soul::{Self, SoulState};
use animacraft_v8_core::maker_v8::MakerRootV8;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_output::output_v8::{Self as output,
    NativeSoulBindingV8, CompleteOutputV8, CompleteReceiptV8, NativeCompleteDecryptProofV8};
#[test_only]
use std::bcs;

const ENotInitialOwner: u64 = 0;
const ESoulListed: u64 = 1;
const EInvalidCommitment: u64 = 2;
const EBindingMismatch: u64 = 3;

/// Exact BCS witness consumed by the authenticated V8 Output mint boundary.
/// Only native mint code can construct it from a newly created live state.
public struct MintBindingWitnessV8 has drop {
    soul_id: ID,
    soul_state_id: ID,
    holder: address,
    ownership_epoch: u64,
    authorization_commitment: vector<u8>,
}

public struct SoulOwnerWitnessV8 has drop {
    soul_id: ID,
    soul_state_id: ID,
    holder: address,
    ownership_epoch: u64,
}

public(package) fun mint_witness(
    state: &SoulState,
    authorization_commitment: vector<u8>,
    ctx: &TxContext,
): MintBindingWitnessV8 {
    soul::assert_owner(state, ctx.sender());
    assert!(soul::ownership_epoch(state) == 0, ENotInitialOwner);
    assert!(!soul::is_listed(state), ESoulListed);
    assert!(authorization_commitment.length() == 32, EInvalidCommitment);
    MintBindingWitnessV8 {
        soul_id: soul::soul_id(state),
        soul_state_id: object::id(state),
        holder: soul::current_owner(state),
        ownership_epoch: soul::ownership_epoch(state),
        authorization_commitment,
    }
}

/// Live-state proof, never a caller-asserted Soul ID or cached owner.
public(package) fun owner_witness(state: &SoulState, ctx: &TxContext): SoulOwnerWitnessV8 {
    let witness = read_owner_witness(state, ctx);
    assert!(!soul::is_listed(state), ESoulListed);
    witness
}

/// Reading completed works does not mutate equipment or prohibit listed Souls.
/// Construction stays package-private: public callers receive only a proof of
/// one exact native Complete, never a general-purpose owner witness.
public(package) fun read_owner_witness(state: &SoulState, ctx: &TxContext): SoulOwnerWitnessV8 {
    soul::assert_owner(state, ctx.sender());
    SoulOwnerWitnessV8 {
        soul_id: soul::soul_id(state),
        soul_state_id: object::id(state),
        holder: soul::current_owner(state),
        ownership_epoch: soul::ownership_epoch(state),
    }
}

public fun certify_native_complete_read_v8<PaymentCoin>(
    state: &SoulState,
    provenance: &NativeSoulBindingV8,
    complete: &CompleteOutputV8,
    receipt: &CompleteReceiptV8,
    root: &MakerRootV8<PaymentCoin>,
    protocol_config: &ProtocolConfigV8,
    ctx: &TxContext,
): NativeCompleteDecryptProofV8 {
    assert!(soul::animacraft_native_v8_binding_id(state) == object::id(provenance)
        && output::native_soul_binding_soul_id_v8(provenance) == soul::soul_id(state)
        && output::native_soul_binding_state_id_v8(provenance) == object::id(state)
        && output::native_soul_binding_root_id_v8(provenance) == object::id(root)
        && output::native_soul_binding_protocol_id_v8(provenance) == object::id(protocol_config)
        && output::native_soul_binding_output_id_v8(provenance) == object::id(complete)
        && output::native_soul_binding_receipt_id_v8(provenance) == object::id(receipt), EBindingMismatch);
    output::certify_native_complete_decrypt_v8(provenance, complete, receipt,
        root, protocol_config, soul::current_owner(state), soul::ownership_epoch(state),
        read_owner_witness(state, ctx), ctx)
}

#[test]
fun witnesses_derive_actual_state() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 701, 0, 0, 0);
    let state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        ctx.sender(), object::id_from_address(@0x43), &mut ctx);
    let commitment = b"12345678901234567890123456789012";
    let mint = mint_witness(&state, commitment, &ctx);
    assert!(mint.soul_id == soul::soul_id(&state)
        && mint.soul_state_id == object::id(&state)
        && mint.holder == ctx.sender() && mint.ownership_epoch == 0
        && mint.authorization_commitment == commitment, 100);
    let owner = owner_witness(&state, &ctx);
    assert!(owner.soul_id == mint.soul_id && owner.soul_state_id == mint.soul_state_id
        && owner.holder == mint.holder && owner.ownership_epoch == 0, 101);
    let mut expected = bcs::to_bytes(&soul::soul_id(&state));
    expected.append(bcs::to_bytes(&object::id(&state)));
    expected.append(bcs::to_bytes(&ctx.sender()));
    expected.append(bcs::to_bytes(&0u64));
    assert!(bcs::to_bytes(&owner) == expected, 103);
    expected.append(bcs::to_bytes(&commitment));
    assert!(bcs::to_bytes(&mint) == expected, 104);
    soul::destroy_state_for_testing(state);
}

#[test]
#[expected_failure(abort_code = 1, location = soulidity::soul)]
fun wrong_owner_rejected() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 702, 0, 0, 0);
    let state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        @0xB22, object::id_from_address(@0x43), &mut ctx);
    let _proof = owner_witness(&state, &ctx);
    soul::destroy_state_for_testing(state);
}

#[test]
#[expected_failure(abort_code = ESoulListed)]
fun listed_owner_rejected() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 703, 0, 0, 0);
    let mut state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        ctx.sender(), object::id_from_address(@0x43), &mut ctx);
    soul::set_listed(&mut state, true);
    let _proof = owner_witness(&state, &ctx);
    soul::destroy_state_for_testing(state);
}

#[test]
#[expected_failure(abort_code = ENotInitialOwner)]
fun rotated_state_cannot_mint() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 704, 0, 0, 0);
    let mut state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        ctx.sender(), object::id_from_address(@0x43), &mut ctx);
    soul::rotate_owner(&mut state, ctx.sender(), object::id_from_address(@0x44));
    let _proof = mint_witness(&state, b"12345678901234567890123456789012", &ctx);
    soul::destroy_state_for_testing(state);
}

#[test]
#[expected_failure(abort_code = 19, location = soulidity::soul)]
fun native_binding_is_one_use() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 705, 0, 0, 0);
    let mut state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        ctx.sender(), object::id_from_address(@0x43), &mut ctx);
    let id = object::id_from_address(@0x45);
    soul::bind_animacraft_native_v8(&mut state, id);
    assert!(soul::has_animacraft_provenance(&state)
        && soul::animacraft_native_v8_binding_id(&state) == id, 102);
    soul::bind_animacraft_native_v8(&mut state, object::id_from_address(@0x46));
    soul::destroy_state_for_testing(state);
}

#[test]
fun native_complete_read_accepts_listed_current_owner_after_transfer() {
    let mut ctx = tx_context::new_from_hint(@0xB22, 706, 0, 0, 0);
    let mut state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        @0xA11, object::id_from_address(@0x43), &mut ctx);
    soul::rotate_owner(&mut state, ctx.sender(), object::id_from_address(@0x44));
    soul::set_listed(&mut state, true);
    let proof = read_owner_witness(&state, &ctx);
    assert!(proof.holder == @0xB22 && proof.ownership_epoch == 1
        && proof.soul_id == soul::soul_id(&state)
        && proof.soul_state_id == object::id(&state), 110);
    soul::destroy_state_for_testing(state);
}

#[test]
#[expected_failure(abort_code = 1, location = soulidity::soul)]
fun native_complete_read_rejects_previous_owner_after_transfer() {
    let mut ctx = tx_context::new_from_hint(@0xA11, 707, 0, 0, 0);
    let mut state = soul::create_state(object::id_from_address(@0x42), @0x1, 50,
        ctx.sender(), object::id_from_address(@0x43), &mut ctx);
    soul::rotate_owner(&mut state, @0xB22, object::id_from_address(@0x44));
    let _proof = read_owner_witness(&state, &ctx);
    soul::destroy_state_for_testing(state);
}
