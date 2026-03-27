module soul_object::seal_policy;

use soul_object::grant::{Self as grant, SoulAccessCap};
use soul_object::soul::Soul;

const EIdPrefixMismatch: u64 = 0;
const EDocumentIdTooShort: u64 = 1;
const ENoAgentGrant: u64 = 2;
const EAccessCapSoulMismatch: u64 = 3;
const EAccessCapAgentMismatch: u64 = 4;
const EGrantVersionMismatch: u64 = 5;
const DOCUMENT_ID_VERSION: u8 = 1;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;

fun assert_matching_document_id(id: vector<u8>, soul: &Soul) {
    let domain = b"soul-seal:";
    let domain_len = domain.length();
    let soul_id_bytes = object::id(soul).to_bytes();
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

entry fun seal_approve_owner(id: vector<u8>, soul: &Soul, _ctx: &TxContext) {
    assert_matching_document_id(id, soul)
}

entry fun seal_approve_agent(
    id: vector<u8>,
    soul: &Soul,
    access_cap: &SoulAccessCap,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, soul);
    assert!(grant::soul_id(access_cap) == object::id(soul), EAccessCapSoulMismatch);
    assert!(grant::agent(access_cap) == ctx.sender(), EAccessCapAgentMismatch);

    let current_agent = *soul.agent_grant();
    assert!(current_agent.is_some(), ENoAgentGrant);
    let expected_agent = current_agent.destroy_some();
    assert!(expected_agent == ctx.sender(), EAccessCapAgentMismatch);
    assert!(grant::grant_version(access_cap) == soul.grant_version(), EGrantVersionMismatch);
}

#[test_only]
public(package) fun seal_approve_owner_for_testing(id: vector<u8>, soul: &Soul, ctx: &TxContext) {
    seal_approve_owner(id, soul, ctx)
}

#[test_only]
public(package) fun seal_approve_agent_for_testing(
    id: vector<u8>,
    soul: &Soul,
    access_cap: &SoulAccessCap,
    ctx: &TxContext,
) {
    seal_approve_agent(id, soul, access_cap, ctx)
}
