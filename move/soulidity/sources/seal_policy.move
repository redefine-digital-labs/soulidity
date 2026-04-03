module soulidity::seal_policy;

use sui::clock::Clock;
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::soul::{Self as soul, SoulState};

const EIdPrefixMismatch: u64 = 0;
const EDocumentIdTooShort: u64 = 1;
const EStateSoulMismatch: u64 = 2;

const DOCUMENT_ID_VERSION: u8 = 1;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;

fun assert_matching_document_id(id: vector<u8>, soul_id: ID) {
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

entry fun seal_approve_owner(
    id: vector<u8>,
    state: &SoulState,
    soul_id: ID,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, soul_id);
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
    assert_matching_document_id(id, soul_id);
    assert!(soul::soul_id(state) == soul_id, EStateSoulMismatch);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_seal(), clock, ctx);
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
