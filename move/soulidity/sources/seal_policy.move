module soulidity::seal_policy;

use sui::clock::Clock;
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::memory::{Self as memory, SoulMemory};
use soulidity::soul::{Self as soul, SoulState};

const EIdPrefixMismatch: u64 = 0;
const EDocumentIdTooShort: u64 = 1;
const EStateSoulMismatch: u64 = 2;
const EStateMemoryMismatch: u64 = 3;
const EMemoryEntryMissing: u64 = 4;

const DOCUMENT_ID_VERSION: u8 = 1;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;

fun assert_matching_soul_document_id(id: vector<u8>, soul_id: ID) {
    let domain = b"soul-seal:";
    let domain_len = domain.length();
    let soul_id_bytes = soul_id.to_bytes();
    let soul_id_len = soul_id_bytes.length();
    assert!(
        id.length() >= domain_len + 1 + soul_id_len + DOCUMENT_ID_NONCE_BYTES,
        EDocumentIdTooShort,
    );

    let mut i = 0;
    while (i < domain_len) {
        assert!(id[i] == domain[i], EIdPrefixMismatch);
        i = i + 1;
    };

    assert!(id[domain_len] == DOCUMENT_ID_VERSION, EIdPrefixMismatch);

    let soul_id_offset = domain_len + 1;
    i = 0;
    while (i < soul_id_len) {
        assert!(id[soul_id_offset + i] == soul_id_bytes[i], EIdPrefixMismatch);
        i = i + 1;
    };
}

fun assert_matching_memory_document_id(id: vector<u8>, memory_id: ID, timestamp_key: u64) {
    let domain = b"soul-memory:";
    let domain_len = domain.length();
    let memory_id_bytes = memory_id.to_bytes();
    let memory_id_len = memory_id_bytes.length();
    assert!(
        id.length() >= domain_len + 1 + memory_id_len + 8 + DOCUMENT_ID_NONCE_BYTES,
        EDocumentIdTooShort,
    );

    let mut i = 0;
    while (i < domain_len) {
        assert!(id[i] == domain[i], EIdPrefixMismatch);
        i = i + 1;
    };

    assert!(id[domain_len] == DOCUMENT_ID_VERSION, EIdPrefixMismatch);

    let memory_id_offset = domain_len + 1;
    i = 0;
    while (i < memory_id_len) {
        assert!(id[memory_id_offset + i] == memory_id_bytes[i], EIdPrefixMismatch);
        i = i + 1;
    };

    assert_u64_segment(&id, memory_id_offset + memory_id_len, timestamp_key);
}

fun assert_u64_segment(id: &vector<u8>, start: u64, value: u64) {
    let mut shift = 56;
    let mut index = 0;
    while (index < 8) {
        let expected = ((value >> shift) & 0xFF) as u8;
        assert!(id[start + index] == expected, EIdPrefixMismatch);
        shift = if (shift >= 8) shift - 8 else 0;
        index = index + 1;
    };
}

entry fun seal_approve_owner(
    id: vector<u8>,
    state: &SoulState,
    soul_id: ID,
    ctx: &TxContext,
) {
    assert_matching_soul_document_id(id, soul_id);
    assert!(soul::soul_id(state) == soul_id, EStateSoulMismatch);
    soul::assert_owner(state, ctx.sender());
}

entry fun seal_approve_granted_agent(
    id: vector<u8>,
    state: &SoulState,
    soul_id: ID,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_matching_soul_document_id(id, soul_id);
    assert!(soul::soul_id(state) == soul_id, EStateSoulMismatch);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_seal(), clock, ctx);
}

entry fun seal_approve_memory_owner(
    id: vector<u8>,
    state: &SoulState,
    memory: &SoulMemory,
    timestamp_key: u64,
    ctx: &TxContext,
) {
    let memory_id = object::id(memory);
    assert_matching_memory_document_id(id, memory_id, timestamp_key);
    assert!(memory::soul_id(memory) == soul::soul_id(state), EStateSoulMismatch);
    assert!(soul::memory_id(state).contains(&memory_id), EStateMemoryMismatch);
    assert!(memory::contains_entry(memory, timestamp_key), EMemoryEntryMissing);
    soul::assert_owner(state, ctx.sender());
}

entry fun seal_approve_memory_granted_agent(
    id: vector<u8>,
    state: &SoulState,
    memory: &SoulMemory,
    timestamp_key: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    let memory_id = object::id(memory);
    assert_matching_memory_document_id(id, memory_id, timestamp_key);
    assert!(memory::soul_id(memory) == soul::soul_id(state), EStateSoulMismatch);
    assert!(soul::memory_id(state).contains(&memory_id), EStateMemoryMismatch);
    assert!(memory::contains_entry(memory, timestamp_key), EMemoryEntryMissing);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_memory(), clock, ctx);
}

#[test_only]
public(package) fun seal_approve_owner_for_testing(
    id: vector<u8>,
    state: &SoulState,
    soul_id: ID,
    ctx: &TxContext,
) {
    seal_approve_owner(id, state, soul_id, ctx)
}

#[test_only]
public(package) fun seal_approve_granted_agent_for_testing(
    id: vector<u8>,
    state: &SoulState,
    soul_id: ID,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    seal_approve_granted_agent(id, state, soul_id, soul_grant, clock, ctx)
}

#[test_only]
public(package) fun seal_approve_memory_owner_for_testing(
    id: vector<u8>,
    state: &SoulState,
    memory: &SoulMemory,
    timestamp_key: u64,
    ctx: &TxContext,
) {
    seal_approve_memory_owner(id, state, memory, timestamp_key, ctx)
}

#[test_only]
public(package) fun seal_approve_memory_granted_agent_for_testing(
    id: vector<u8>,
    state: &SoulState,
    memory: &SoulMemory,
    timestamp_key: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    seal_approve_memory_granted_agent(id, state, memory, timestamp_key, soul_grant, clock, ctx)
}
