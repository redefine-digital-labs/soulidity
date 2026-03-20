module soul_market::seal_policy;

use soul_market::series::{SoulSeries, SoulRelease};
use soul_market::pass::{PerpetualPass, SubscriptionPass};

/// Seal approval for perpetual pass holders.
/// The `id` parameter is the namespace identity (series_id bytes prefix).
/// This is a pure read function with no side effects - called by Seal protocol.
public entry fun seal_approve_perpetual(
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
    assert!(is_owner || is_agent, 13); // ENotAuthorized

    // Verify id prefix matches series
    let series_id_bytes = object::id(series).to_bytes();
    let id_len = series_id_bytes.length();
    assert!(id.length() >= id_len, 14); // EIdPrefixMismatch
    let mut i = 0;
    while (i < id_len) {
        assert!(id[i] == series_id_bytes[i], 14);
        i = i + 1;
    };

    // Verify pass belongs to this series
    assert!(pass.perpetual_series_id() == object::id(series), 15); // ESeriesMismatch

    // Verify release matches the pass's locked release
    assert!(pass.perpetual_release_id() == object::id(release), 16); // EReleaseMismatch
    assert!(release.release_series_id() == object::id(series), 17); // EReleaseNotInSeries
}

/// Seal approval for subscription pass holders.
/// Verifies the subscription is still active (not expired).
public entry fun seal_approve_subscription(
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
    assert!(is_owner || is_agent, 13); // ENotAuthorized

    // Verify id prefix matches series
    let series_id_bytes = object::id(series).to_bytes();
    let id_len = series_id_bytes.length();
    assert!(id.length() >= id_len, 14);
    let mut i = 0;
    while (i < id_len) {
        assert!(id[i] == series_id_bytes[i], 14);
        i = i + 1;
    };

    // Verify pass belongs to this series
    assert!(pass.subscription_series_id() == object::id(series), 15);

    // Verify subscription is not expired
    assert!(clock.timestamp_ms() <= pass.subscription_expires_at(), 18); // ESubscriptionExpired
}
