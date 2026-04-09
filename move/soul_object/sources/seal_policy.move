module soul_object::seal_policy;

use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use sui::kiosk::{Self as kiosk, Kiosk};
use soul_object::allowlist::{Self as allowlist, AllowlistRegistry, SoulAllowlistCap};
use soul_object::soul::Soul;

const EIdPrefixMismatch: u64 = 0;
const EDocumentIdTooShort: u64 = 1;
const EAccessCapSoulMismatch: u64 = 2;
const EAccessCapAllowlistedMismatch: u64 = 3;
const EAllowlistVersionMismatch: u64 = 4;
const ESoulNotInKiosk: u64 = 5;
const EPersonalKioskOwnerMismatch: u64 = 6;
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

entry fun seal_approve_owner_in_personal_kiosk(
    id: vector<u8>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    soul_id: ID,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, soul_id);
    // Upstream kiosk ownership checks are still `&mut Kiosk`, so owner approvals intentionally
    // take a shared-object write lock today. Concurrent approvals against the same kiosk therefore
    // serialize until the vendored kiosk package exposes a readonly access check.
    // Seal evaluates approval PTBs as the session-key user rather than as the key server, so
    // ctx.sender() remains the requester address that owns the personal kiosk.
    // The vendored personal-kiosk flow sets the kiosk owner to that same requester address.
    assert!(kiosk_obj.owner() == ctx.sender(), EPersonalKioskOwnerMismatch);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EPersonalKioskOwnerMismatch);
    assert!(kiosk::has_item_with_type<Soul>(kiosk_obj, soul_id), ESoulNotInKiosk);
}

entry fun seal_approve_allowlisted(
    id: vector<u8>,
    registry: &AllowlistRegistry,
    soul_id: ID,
    access_cap: &SoulAllowlistCap,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, soul_id);
    assert!(allowlist::soul_id(access_cap) == soul_id, EAccessCapSoulMismatch);
    assert!(allowlist::allowlisted(access_cap) == ctx.sender(), EAccessCapAllowlistedMismatch);
    assert!(
        allowlist::allowlist_version(access_cap) == allowlist::registry_version(registry, soul_id),
        EAllowlistVersionMismatch,
    );
}

#[test_only]
public(package) fun seal_approve_owner_for_testing(
    id: vector<u8>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    soul_id: ID,
    ctx: &TxContext,
) {
    seal_approve_owner_in_personal_kiosk(id, kiosk_obj, personal_kiosk_cap, soul_id, ctx)
}

#[test_only]
public(package) fun seal_approve_allowlisted_for_testing(
    id: vector<u8>,
    registry: &AllowlistRegistry,
    soul_id: ID,
    access_cap: &SoulAllowlistCap,
    ctx: &TxContext,
) {
    seal_approve_allowlisted(id, registry, soul_id, access_cap, ctx)
}
