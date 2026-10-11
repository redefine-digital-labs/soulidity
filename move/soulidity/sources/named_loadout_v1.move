/// Private owner-epoch library metadata only. Move verifies scope/CAS/capture,
/// not encrypted names, entry counts, document schemas or Walrus availability.
module soulidity::named_loadout_v1;

use std::{bcs, string::{Self as string, String}};
use std::hash;
use soulidity::soul::{Self as soul, SoulState};
use soulidity::animacraft_equipment_adapter_v8 as equipment_adapter;
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_runtime::runtime_v8::{Self as runtime, MakerLoadoutV8};

const VERSION: u8 = 1;
const MAX_CIPHERTEXT_BYTES: u64 = 16_777_216;
const MAX_RECEIPTS: u64 = 32;
const EWrongEpoch: u64 = 0;
const EInvalidHead: u64 = 1;
const EStaleRevision: u64 = 2;
const EInvalidReference: u64 = 3;
const ERequestConflict: u64 = 4;
const ECaptureMismatch: u64 = 5;
const ESealIdMismatch: u64 = 6;

public struct CipherRefV1 has copy, drop, store {
    blob_object_id: ID,
    blob_id: String,
    sha256: vector<u8>,
    byte_length: u64,
}

public struct CaptureV1 has copy, drop, store {
    equipment_id: ID,
    revision: u64,
    commitment: vector<u8>,
}

public struct ReceiptV1 has copy, drop, store {
    request_id: vector<u8>,
    revision: u64,
    ciphertext: CipherRefV1,
    capture: Option<CaptureV1>,
}

public struct HeadV1 has copy, drop, store {
    version: u8,
    soul_id: ID,
    state_id: ID,
    owner: address,
    ownership_epoch: u64,
    revision: u64,
    ciphertext: CipherRefV1,
    receipts: vector<ReceiptV1>,
}

/// Exact BCS preimage for the dedicated Seal approval namespace. No head hash,
/// revision or Blob ID: same-scope paid/uncommitted ciphertext remains readable.
public struct SealScopeV1 has drop {
    domain: String,
    version: u8,
    soul_id: ID,
    state_id: ID,
    owner: address,
    ownership_epoch: u64,
}

public fun seal_id(state: &SoulState, owner: address, ownership_epoch: u64): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&SealScopeV1 {
        domain: string::utf8(b"soulidity/private-named-loadouts/seal-id/v1"), version: VERSION,
        soul_id: soul::soul_id(state), state_id: object::id(state), owner, ownership_epoch,
    }))
}

public fun seal_approve(id: vector<u8>, state: &SoulState, expected_epoch: u64, ctx: &TxContext) {
    assert_scope(state, expected_epoch, ctx);
    assert!(id == seal_id(state, ctx.sender(), expected_epoch), ESealIdMismatch);
}

fun assert_scope(state: &SoulState, expected_epoch: u64, ctx: &TxContext) {
    soul::assert_owner(state, ctx.sender());
    assert!(soul::ownership_epoch(state) == expected_epoch, EWrongEpoch);
}

/// Absent/older epoch is empty only after validating the stored scope identity.
/// An impossible future epoch or same-epoch different owner is not an empty head.
public fun current_head(state: &SoulState): Option<HeadV1> {
    if (!soul::has_named_loadout_head_v1(state)) return option::none();
    let head = soul::named_loadout_head_v1<HeadV1>(state);
    assert!(head.version == VERSION && head.soul_id == soul::soul_id(state)
        && head.state_id == object::id(state) && head.revision > 0
        && head.receipts.length() > 0 && head.receipts.length() <= MAX_RECEIPTS
        && head.ownership_epoch <= soul::ownership_epoch(state), EInvalidHead);
    if (head.ownership_epoch < soul::ownership_epoch(state)) return option::none();
    assert!(head.owner == soul::current_owner(state), EInvalidHead);
    option::some(*head)
}

public fun current_revision(state: &SoulState): u64 {
    let head = current_head(state);
    if (head.is_some()) head.borrow().revision else 0
}

/// Read-only recovery does not need equipment, its existence, or live gates.
public fun receipt(state: &SoulState, request_id: vector<u8>): Option<ReceiptV1> {
    let head = current_head(state);
    if (head.is_none()) return option::none();
    let rows = &head.borrow().receipts;
    let mut i = 0;
    while (i < rows.length()) {
        if (rows[i].request_id == request_id) return option::some(rows[i]);
        i = i + 1;
    };
    option::none()
}

public fun receipt_revision(receipt: &ReceiptV1): u64 { receipt.revision }

fun assert_hash(bytes: &vector<u8>) {
    assert!(bytes.length() == 32, EInvalidReference);
    let mut nonzero = false;
    bytes.do_ref!(|byte| { if (*byte != 0) nonzero = true });
    assert!(nonzero, EInvalidReference);
}

fun assert_reference(reference: &CipherRefV1, request_id: &vector<u8>) {
    assert_hash(request_id);
    assert_hash(&reference.sha256);
    assert!(reference.blob_object_id != object::id_from_address(@0x0)
        && reference.byte_length > 0 && reference.byte_length <= MAX_CIPHERTEXT_BYTES, EInvalidReference);
    let bytes = reference.blob_id.as_bytes();
    assert!(bytes.length() == 43, EInvalidReference);
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut i = 0;
    while (i < bytes.length()) {
        assert!(alphabet.contains(&bytes[i]), EInvalidReference);
        i = i + 1;
    };
    // 32 bytes have two unused low bits in the last Base64URL character.
    assert!(b"AEIMQUYcgkosw048".contains(&bytes[42]), EInvalidReference);
}

fun replay(state: &SoulState, request_id: &vector<u8>, ciphertext: &CipherRefV1,
    capture: &Option<CaptureV1>): Option<u64> {
    let prior = receipt(state, *request_id);
    if (prior.is_none()) return option::none();
    let row = prior.borrow();
    assert!(row.ciphertext == *ciphertext && row.capture == *capture, ERequestConflict);
    option::some(row.revision)
}

fun commit(state: &mut SoulState, expected_revision: u64, request_id: vector<u8>,
    ciphertext: CipherRefV1, capture: Option<CaptureV1>) : u64 {
    let head = current_head(state);
    let revision = if (head.is_some()) head.borrow().revision else 0;
    assert!(revision == expected_revision && revision < 18_446_744_073_709_551_615, EStaleRevision);
    assert_reference(&ciphertext, &request_id);
    let revision = revision + 1;
    let mut receipts = if (head.is_some()) head.borrow().receipts else vector[];
    if (receipts.length() == MAX_RECEIPTS) { receipts.remove(0); };
    receipts.push_back(ReceiptV1 { request_id, revision, ciphertext, capture });
    let next = HeadV1 { version: VERSION, soul_id: soul::soul_id(state), state_id: object::id(state),
        owner: soul::current_owner(state), ownership_epoch: soul::ownership_epoch(state), revision, ciphertext, receipts };
    soul::replace_named_loadout_head_v1(state, next);
    revision
}

/// Save a verified current equipment capture. Replay is resolved before new
/// capture/CAS validation; the receipt stays queryable after equipment closure.
public fun save(state: &mut SoulState, equipment: &MakerLoadoutV8, protocol: &ProtocolConfigV8,
    expected_epoch: u64, expected_revision: u64, request_id: vector<u8>,
    blob_object_id: ID, blob_id: String, cipher_sha256: vector<u8>, cipher_bytes: u64,
    equipment_revision: u64, equipment_commitment: vector<u8>, ctx: &TxContext): u64 {
    assert_scope(state, expected_epoch, ctx);
    let ciphertext = CipherRefV1 { blob_object_id, blob_id, sha256: cipher_sha256, byte_length: cipher_bytes };
    let capture = option::some(CaptureV1 { equipment_id: object::id(equipment),
        revision: equipment_revision, commitment: equipment_commitment });
    let prior = replay(state, &request_id, &ciphertext, &capture);
    if (prior.is_some()) return prior.destroy_some();
    equipment_adapter::assert_equipment_read_v8(state, equipment, protocol, ctx);
    assert!(runtime::loadout_revision_v8(equipment) == equipment_revision
        && *runtime::loadout_commitment_v8(equipment) == equipment_commitment, ECaptureMismatch);
    assert_hash(&equipment_commitment);
    commit(state, expected_revision, request_id, ciphertext, capture)
}

/// Rename/delete modify only encrypted library metadata, not old equipment.
/// No market-primary/listed gate: match the existing owner-only library policy.
public fun update(state: &mut SoulState, expected_epoch: u64, expected_revision: u64, request_id: vector<u8>,
    blob_object_id: ID, blob_id: String, cipher_sha256: vector<u8>, cipher_bytes: u64, ctx: &TxContext): u64 {
    assert_scope(state, expected_epoch, ctx);
    let ciphertext = CipherRefV1 { blob_object_id, blob_id, sha256: cipher_sha256, byte_length: cipher_bytes };
    let capture = option::none();
    let prior = replay(state, &request_id, &ciphertext, &capture);
    if (prior.is_some()) return prior.destroy_some();
    commit(state, expected_revision, request_id, ciphertext, capture)
}
