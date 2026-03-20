module soul_market::relayer;

use sui::table::{Self, Table};
use sui::event;
use soul_market::purchase::{Self as purchase, PricingPlan};
use soul_market::series::{SoulSeries, SoulRelease};
use soul_market::pass::{Self, SubscriptionPass};

// === Events ===

public struct SolanaSettlement has copy, drop {
    pass_id: ID,
    nonce: u64,
    payer_solana: vector<u8>,
    amount_usdc: u64,
}

public struct RelayerAdminTransferProposed has copy, drop {
    current_admin: address,
    pending_admin: address,
}

public struct RelayerAdminTransferAccepted has copy, drop {
    old_admin: address,
    new_admin: address,
}

public struct RelayerRegistryPaused has copy, drop {
    admin: address,
}

public struct RelayerRegistryUnpaused has copy, drop {
    admin: address,
}

// === Structs ===

/// Composite key for per-series nonce dedup
public struct NonceKey has copy, drop, store {
    series_id: ID,
    nonce: u64,
}

/// Registry of trusted relayers (shared singleton)
public struct RelayerRegistry has key {
    id: UID,
    admin: address,
    pending_admin: Option<address>,
    relayers: vector<address>,
    paused: bool,
}

/// Settlement log to prevent nonce replay (shared singleton)
public struct SettlementLog has key {
    id: UID,
    processed: Table<NonceKey, bool>,
}

// === Admin Functions ===

/// Initialize relayer registry and settlement log exactly once at publish time.
fun init(ctx: &mut TxContext) {
    let registry = RelayerRegistry {
        id: object::new(ctx),
        admin: ctx.sender(),
        pending_admin: option::none(),
        relayers: vector::empty(),
        paused: false,
    };
    let log = SettlementLog {
        id: object::new(ctx),
        processed: table::new(ctx),
    };
    transfer::share_object(registry);
    transfer::share_object(log);
}

/// Step 1: Current admin proposes a new admin
public entry fun propose_relayer_admin_transfer(
    registry: &mut RelayerRegistry,
    new_admin: address,
    ctx: &TxContext,
) {
    assert!(registry.admin == ctx.sender(), 2); // ENotAdmin
    registry.pending_admin = option::some(new_admin);
    event::emit(RelayerAdminTransferProposed {
        current_admin: registry.admin,
        pending_admin: new_admin,
    });
}

/// Step 2: Pending admin accepts the transfer
public entry fun accept_relayer_admin_transfer(
    registry: &mut RelayerRegistry,
    ctx: &TxContext,
) {
    assert!(registry.pending_admin.is_some(), 23); // ENoPendingAdmin
    let pending = *registry.pending_admin.borrow();
    assert!(pending == ctx.sender(), 24); // ENotPendingAdmin
    let old_admin = registry.admin;
    registry.admin = pending;
    registry.pending_admin = option::none();
    event::emit(RelayerAdminTransferAccepted {
        old_admin,
        new_admin: pending,
    });
}

/// Pause all relayer operations
public entry fun pause_relayer_registry(
    registry: &mut RelayerRegistry,
    ctx: &TxContext,
) {
    assert!(registry.admin == ctx.sender(), 2); // ENotAdmin
    registry.paused = true;
    event::emit(RelayerRegistryPaused { admin: ctx.sender() });
}

/// Unpause relayer operations
public entry fun unpause_relayer_registry(
    registry: &mut RelayerRegistry,
    ctx: &TxContext,
) {
    assert!(registry.admin == ctx.sender(), 2); // ENotAdmin
    registry.paused = false;
    event::emit(RelayerRegistryUnpaused { admin: ctx.sender() });
}

/// Register a new relayer
public entry fun register_relayer(
    registry: &mut RelayerRegistry,
    relayer_address: address,
    ctx: &mut TxContext,
) {
    assert!(registry.admin == ctx.sender(), 2); // ENotAdmin
    let (already_registered, _) = registry.relayers.index_of(&relayer_address);
    assert!(!already_registered, 13); // ERelayerAlreadyRegistered

    registry.relayers.push_back(relayer_address);
}

/// Remove a relayer
public entry fun remove_relayer(
    registry: &mut RelayerRegistry,
    relayer_address: address,
    ctx: &TxContext,
) {
    assert!(registry.admin == ctx.sender(), 2);

    let (found, idx) = registry.relayers.index_of(&relayer_address);
    assert!(found, 10); // ERelayerNotFound
    registry.relayers.remove(idx);
}

// === Relayer Mint Functions ===

/// Relayer mints a perpetual pass after verifying Solana payment
public entry fun relayer_mint_perpetual(
    registry: &RelayerRegistry,
    log: &mut SettlementLog,
    plan: &PricingPlan,
    series: &SoulSeries,
    release: &SoulRelease,
    owner: address,
    nonce: u64,
    payer_solana: vector<u8>,
    amount_usdc: u64,
    ctx: &mut TxContext,
) {
    assert!(!registry.paused, 15); // EPaused

    let sender = ctx.sender();
    let (is_relayer, _) = registry.relayers.index_of(&sender);
    assert!(is_relayer, 11); // ENotRelayer

    // Per-series nonce replay prevention
    let key = NonceKey { series_id: series.series_id(), nonce };
    assert!(!log.processed.contains(key), 12); // ENonceAlreadyUsed
    log.processed.add(key, true);

    assert!(purchase::plan_active(plan), 17); // EPlanInactive
    assert!(purchase::plan_series_id(plan) == series.series_id(), 6);
    assert!(purchase::plan_type(plan) == 0, 7);
    assert!(purchase::plan_price_usdc(plan) == amount_usdc, 13);
    assert!(release.release_series_id() == series.series_id(), 8);

    let pass = pass::mint_perpetual(
        series.series_id(),
        object::id(release),
        owner,
        ctx,
    );

    event::emit(SolanaSettlement {
        pass_id: object::id(&pass),
        nonce,
        payer_solana,
        amount_usdc,
    });

    transfer::public_transfer(pass, owner);
}

/// Relayer mints a subscription pass after verifying Solana payment
public entry fun relayer_mint_subscription(
    registry: &RelayerRegistry,
    log: &mut SettlementLog,
    plan: &PricingPlan,
    series: &SoulSeries,
    owner: address,
    nonce: u64,
    payer_solana: vector<u8>,
    amount_usdc: u64,
    clock: &sui::clock::Clock,
    ctx: &mut TxContext,
) {
    assert!(!registry.paused, 15); // EPaused

    let sender = ctx.sender();
    let (is_relayer, _) = registry.relayers.index_of(&sender);
    assert!(is_relayer, 11);

    let key = NonceKey { series_id: series.series_id(), nonce };
    assert!(!log.processed.contains(key), 12);
    log.processed.add(key, true);

    assert!(purchase::plan_active(plan), 17); // EPlanInactive
    assert!(purchase::plan_series_id(plan) == series.series_id(), 6);
    assert!(purchase::plan_type(plan) == 1, 7);
    assert!(purchase::plan_price_usdc(plan) == amount_usdc, 13);

    let period_ms = purchase::plan_period_ms(plan);
    let expires_at = clock.timestamp_ms() + period_ms;

    let pass = pass::mint_subscription(
        series.series_id(),
        owner,
        expires_at,
        period_ms,
        ctx,
    );

    event::emit(SolanaSettlement {
        pass_id: object::id(&pass),
        nonce,
        payer_solana,
        amount_usdc,
    });

    transfer::public_transfer(pass, owner);
}

/// Relayer renews a subscription after Solana payment
public entry fun relayer_renew_subscription(
    registry: &RelayerRegistry,
    log: &mut SettlementLog,
    series: &SoulSeries,
    plan: &PricingPlan,
    pass: &mut SubscriptionPass,
    owner: address,
    nonce: u64,
    payer_solana: vector<u8>,
    amount_usdc: u64,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
) {
    assert!(!registry.paused, 15); // EPaused

    let sender = ctx.sender();
    let (is_relayer, _) = registry.relayers.index_of(&sender);
    assert!(is_relayer, 11);

    let key = NonceKey { series_id: series.series_id(), nonce };
    assert!(!log.processed.contains(key), 12);
    log.processed.add(key, true);

    assert!(purchase::plan_active(plan), 17); // EPlanInactive
    assert!(purchase::plan_series_id(plan) == series.series_id(), 6);
    assert!(purchase::plan_type(plan) == 1, 7);
    assert!(pass.subscription_series_id() == series.series_id(), 8);
    assert!(pass.subscription_owner() == owner, 16); // EOwnerMismatch
    assert!(purchase::plan_price_usdc(plan) == amount_usdc, 13);
    assert!(purchase::plan_period_ms(plan) == pass.subscription_period_ms(), 14);

    pass::renew_subscription_internal(pass, clock);

    event::emit(SolanaSettlement {
        pass_id: object::id(pass),
        nonce,
        payer_solana,
        amount_usdc,
    });
}
