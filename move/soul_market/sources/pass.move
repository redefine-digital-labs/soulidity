module soul_market::pass;

use sui::event;

// === Events ===

public struct PerpetualPassMinted has copy, drop {
    pass_id: ID,
    series_id: ID,
    release_id: ID,
    owner: address,
}

public struct SubscriptionPassMinted has copy, drop {
    pass_id: ID,
    series_id: ID,
    owner: address,
    expires_at: u64,
}

public struct SubscriptionRenewed has copy, drop {
    pass_id: ID,
    new_expires_at: u64,
}

// === Structs ===

/// Permanent access pass, locked to a specific release.
/// `owner` mirrors the Sui object owner so events and off-chain mirrors can
/// read ownership without re-parsing object metadata. Package-level transfer
/// helpers must keep both sources of truth in sync.
public struct PerpetualPass has key {
    id: UID,
    series_id: ID,
    release_id: ID,
    owner: address,
    agent_grant: Option<address>,
}

/// Time-limited subscription pass.
/// `owner` mirrors the Sui object owner for the same reason as
/// `PerpetualPass.owner`, and must only change through package transfer helpers.
public struct SubscriptionPass has key {
    id: UID,
    series_id: ID,
    owner: address,
    expires_at: u64,
    period_ms: u64,
    agent_grant: Option<address>,
}

// === Internal Mint Functions (called by purchase) ===

/// Mint a perpetual pass (package-level visibility)
public(package) fun mint_perpetual(
    series_id: ID,
    release_id: ID,
    owner: address,
    ctx: &mut TxContext,
): PerpetualPass {
    let pass = PerpetualPass {
        id: object::new(ctx),
        series_id,
        release_id,
        owner,
        agent_grant: option::none(),
    };

    event::emit(PerpetualPassMinted {
        pass_id: object::id(&pass),
        series_id,
        release_id,
        owner,
    });

    pass
}

/// Mint a subscription pass (package-level visibility)
public(package) fun mint_subscription(
    series_id: ID,
    owner: address,
    expires_at: u64,
    period_ms: u64,
    ctx: &mut TxContext,
): SubscriptionPass {
    let pass = SubscriptionPass {
        id: object::new(ctx),
        series_id,
        owner,
        expires_at,
        period_ms,
        agent_grant: option::none(),
    };

    event::emit(SubscriptionPassMinted {
        pass_id: object::id(&pass),
        series_id,
        owner,
        expires_at,
    });

    pass
}

/// Renew a subscription pass, adopting the plan's current period.
/// When an author replaces a plan with a different period, existing
/// subscribers naturally migrate to the new period on their next renewal.
public(package) fun renew_subscription_internal(
    pass: &mut SubscriptionPass,
    new_period_ms: u64,
    clock: &sui::clock::Clock,
) {
    let now = clock.timestamp_ms();
    // If expired, renew from now; otherwise extend from current expiry
    let base = if (now > pass.expires_at) { now } else { pass.expires_at };
    pass.period_ms = new_period_ms;
    pass.expires_at = base + new_period_ms;

    event::emit(SubscriptionRenewed {
        pass_id: object::id(pass),
        new_expires_at: pass.expires_at,
    });
}

// === Accessors ===

public fun perpetual_series_id(pass: &PerpetualPass): ID { pass.series_id }
public fun perpetual_release_id(pass: &PerpetualPass): ID { pass.release_id }
public fun perpetual_owner(pass: &PerpetualPass): address { pass.owner }
public fun perpetual_agent_grant(pass: &PerpetualPass): Option<address> { pass.agent_grant }

public fun subscription_series_id(pass: &SubscriptionPass): ID { pass.series_id }
public fun subscription_owner(pass: &SubscriptionPass): address { pass.owner }
public fun subscription_expires_at(pass: &SubscriptionPass): u64 { pass.expires_at }
public fun subscription_period_ms(pass: &SubscriptionPass): u64 { pass.period_ms }
public fun subscription_agent_grant(pass: &SubscriptionPass): Option<address> { pass.agent_grant }

// === Mutable Access (package-level) ===

public(package) fun perpetual_agent_grant_mut(pass: &mut PerpetualPass): &mut Option<address> {
    &mut pass.agent_grant
}

public(package) fun subscription_agent_grant_mut(pass: &mut SubscriptionPass): &mut Option<address> {
    &mut pass.agent_grant
}

public(package) fun transfer_perpetual(mut pass: PerpetualPass, recipient: address) {
    pass.owner = recipient;
    transfer::transfer(pass, recipient);
}

public(package) fun transfer_subscription(mut pass: SubscriptionPass, recipient: address) {
    pass.owner = recipient;
    transfer::transfer(pass, recipient);
}

// === Test Helpers ===

#[test_only]
public(package) fun destroy_perpetual_for_testing(pass: PerpetualPass) {
    let PerpetualPass {
        id,
        series_id: _,
        release_id: _,
        owner: _,
        agent_grant: _,
    } = pass;
    id.delete();
}

#[test_only]
public(package) fun destroy_subscription_for_testing(pass: SubscriptionPass) {
    let SubscriptionPass {
        id,
        series_id: _,
        owner: _,
        expires_at: _,
        period_ms: _,
        agent_grant: _,
    } = pass;
    id.delete();
}
