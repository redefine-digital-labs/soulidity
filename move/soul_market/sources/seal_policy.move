module soul_market::seal_policy;

use soul_market::series::{SoulSeries, SoulRelease};
use soul_market::pass::{PerpetualPass, SubscriptionPass};

const ENotAuthorized: u64 = 13;
const EIdPrefixMismatch: u64 = 14;
const ESeriesMismatch: u64 = 15;
const EReleaseMismatch: u64 = 16;
const EReleaseNotInSeries: u64 = 17;
const ESubscriptionExpired: u64 = 18;
const EDocumentReleaseMismatch: u64 = 19;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;

/// Seal approval for perpetual pass holders.
/// The `id` parameter must start with the series id bytes followed by the
/// locked release id bytes. Any trailing bytes are treated as caller-chosen entropy.
/// This is a pure read function with no side effects - called by Seal protocol.
entry fun seal_approve_perpetual(
    id: vector<u8>,
    pass: &PerpetualPass,
    release: &SoulRelease,
    series: &SoulSeries,
    ctx: &TxContext,
) {
    // Verify caller is owner or granted agent
    let caller = ctx.sender();
    let is_owner = pass.perpetual_owner() == caller;
    let is_agent = pass.perpetual_agent_grant().contains(&caller);
    assert!(is_owner || is_agent, ENotAuthorized);

    // Verify id prefix matches series
    let series_id_bytes = object::id(series).to_bytes();
    let id_len = series_id_bytes.length();
    assert!(id.length() >= id_len, EIdPrefixMismatch);
    let mut i = 0;
    while (i < id_len) {
        assert!(id[i] == series_id_bytes[i], EIdPrefixMismatch);
        i = i + 1;
    };

    // Verify pass belongs to this series
    assert!(pass.perpetual_series_id() == object::id(series), ESeriesMismatch);

    // Verify release matches the pass's locked release
    assert!(pass.perpetual_release_id() == object::id(release), EReleaseMismatch);
    assert!(release.release_series_id() == object::id(series), EReleaseNotInSeries);

    // Bind the document namespace to the concrete locked release, not just the series.
    let release_id_bytes = object::id(release).to_bytes();
    let release_id_len = release_id_bytes.length();
    assert!(id.length() >= id_len + release_id_len, EDocumentReleaseMismatch);
    let mut release_index = 0;
    while (release_index < release_id_len) {
        assert!(
            id[id_len + release_index] == release_id_bytes[release_index],
            EDocumentReleaseMismatch,
        );
        release_index = release_index + 1;
    };
}

/// Seal approval for subscription pass holders.
/// The `id` parameter must start with the series id bytes and include at least
/// the standard caller-chosen nonce suffix used by Seal document ids.
/// Verifies the subscription is still active (not expired).
entry fun seal_approve_subscription(
    id: vector<u8>,
    pass: &SubscriptionPass,
    series: &SoulSeries,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
) {
    // Verify caller is owner or granted agent
    let caller = ctx.sender();
    let is_owner = pass.subscription_owner() == caller;
    let is_agent = pass.subscription_agent_grant().contains(&caller);
    assert!(is_owner || is_agent, ENotAuthorized);

    // Verify id prefix matches series
    let series_id_bytes = object::id(series).to_bytes();
    let id_len = series_id_bytes.length();
    assert!(id.length() >= id_len, EIdPrefixMismatch);
    let mut i = 0;
    while (i < id_len) {
        assert!(id[i] == series_id_bytes[i], EIdPrefixMismatch);
        i = i + 1;
    };
    assert!(id.length() >= id_len + DOCUMENT_ID_NONCE_BYTES, EDocumentReleaseMismatch);

    // Verify pass belongs to this series
    assert!(pass.subscription_series_id() == object::id(series), ESeriesMismatch);

    // Access remains valid through the exact expiry millisecond.
    assert!(clock.timestamp_ms() <= pass.subscription_expires_at(), ESubscriptionExpired);
}

// === Test Helpers ===

#[test_only]
public(package) fun seal_approve_perpetual_for_testing(
    id: vector<u8>,
    pass: &PerpetualPass,
    release: &SoulRelease,
    series: &SoulSeries,
    ctx: &TxContext,
) {
    seal_approve_perpetual(id, pass, release, series, ctx);
}

#[test_only]
public(package) fun seal_approve_subscription_for_testing(
    id: vector<u8>,
    pass: &SubscriptionPass,
    series: &SoulSeries,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
) {
    seal_approve_subscription(id, pass, series, clock, ctx);
}
