module soul_object::seal_policy;

use soul_object::soul::Soul;

const ENotAuthorized: u64 = 0;
const EIdPrefixMismatch: u64 = 1;
const EDocumentIdTooShort: u64 = 2;
const DOCUMENT_ID_VERSION: u8 = 1;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;

entry fun seal_approve(id: vector<u8>, soul: &Soul, ctx: &TxContext) {
    let caller = ctx.sender();
    let is_owner = soul.owner() == caller;
    let is_agent = soul.agent_grant().contains(&caller);
    assert!(is_owner || is_agent, ENotAuthorized);

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

#[test_only]
public(package) fun seal_approve_for_testing(id: vector<u8>, soul: &Soul, ctx: &TxContext) {
    seal_approve(id, soul, ctx)
}
