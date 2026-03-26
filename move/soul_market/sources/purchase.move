module soul_market::purchase;

use sui::coin::Coin;
use usdc::usdc::USDC;
use sui::event;
use soul_market::series::{SoulSeries, SoulRelease, AuthorCap};
use soul_market::pass::{Self, SubscriptionPass};

// === Events ===

public struct PricingPlanCreated has copy, drop {
    plan_id: ID,
    series_id: ID,
    plan_type: u8,
    price_usdc: u64,
    period_ms: u64,
}

public struct PricingPlanDeactivated has copy, drop {
    plan_id: ID,
}

public struct PlatformAdminTransferProposed has copy, drop {
    current_admin: address,
    pending_admin: address,
}

public struct PlatformAdminTransferAccepted has copy, drop {
    old_admin: address,
    new_admin: address,
}

public struct PlatformConfigUpdated has copy, drop {
    fee_recipient: address,
    fee_bps: u64,
}

public struct PlatformPaused has copy, drop {}

public struct PlatformUnpaused has copy, drop {}

// === Constants ===

const PLAN_ONETIME: u8 = 0;
const PLAN_SUBSCRIPTION: u8 = 1;
const DEFAULT_PLATFORM_FEE_BPS: u64 = 0;
const MAX_PLATFORM_FEE_BPS: u64 = 1000;
const MAX_PERIOD_MS: u64 = 31_536_000_000; // 1 year
const E_NOT_AUTHOR: u64 = 0;
const E_NOT_PASS_OWNER: u64 = 1;
const E_NOT_ADMIN: u64 = 2;
const E_INVALID_PLAN_TYPE: u64 = 3;
const E_INVALID_PRICE: u64 = 4;
const E_INVALID_PERIOD: u64 = 5;
const E_PLAN_SERIES_MISMATCH: u64 = 6;
const E_WRONG_PLAN_TYPE: u64 = 7;
const E_RELEASE_MISMATCH: u64 = 8;
const E_INCORRECT_PAYMENT_AMOUNT: u64 = 9;
const E_INVALID_FEE_BPS: u64 = 20;
const E_PERIOD_EXCEEDS_MAX: u64 = 21;
const E_PLAN_INACTIVE: u64 = 22;
const E_NO_PENDING_ADMIN: u64 = 23;
const E_NOT_PENDING_ADMIN: u64 = 24;
const E_PLAN_ALREADY_INACTIVE: u64 = 26;
const E_INVALID_RECIPIENT: u64 = 28;
const E_PLATFORM_PAUSED: u64 = 29;

// === Structs ===

/// Platform configuration (shared singleton)
public struct PlatformConfig has key {
    id: UID,
    fee_recipient: address,
    fee_bps: u64, // basis points, e.g. 250 = 2.5%
    admin: address,
    pending_admin: Option<address>,
    paused: bool,
}

/// Pricing plan for a series
public struct PricingPlan has key {
    id: UID,
    series_id: ID,
    plan_type: u8, // 0 = onetime, 1 = subscription
    price_usdc: u64, // in USDC atomic units (6 decimals)
    period_ms: u64, // 0 for onetime
    active: bool,
}

// === Admin Functions ===

/// Initialize platform config exactly once at publish time.
fun init(ctx: &mut TxContext) {
    let admin = ctx.sender();
    let config = PlatformConfig {
        id: object::new(ctx),
        fee_recipient: admin,
        fee_bps: DEFAULT_PLATFORM_FEE_BPS,
        admin,
        pending_admin: option::none(),
        paused: false,
    };
    transfer::share_object(config);
}

public entry fun update_platform_config(
    config: &mut PlatformConfig,
    fee_recipient: address,
    fee_bps: u64,
    ctx: &TxContext,
) {
    assert!(config.admin == ctx.sender(), E_NOT_ADMIN);
    assert!(fee_bps <= MAX_PLATFORM_FEE_BPS, E_INVALID_FEE_BPS);
    assert!(fee_recipient != @0x0, E_INVALID_RECIPIENT);
    config.fee_recipient = fee_recipient;
    config.fee_bps = fee_bps;
    event::emit(PlatformConfigUpdated { fee_recipient, fee_bps });
}

/// Pause all purchases and renewals. Only admin can call.
public entry fun pause_platform(
    config: &mut PlatformConfig,
    ctx: &TxContext,
) {
    assert!(config.admin == ctx.sender(), E_NOT_ADMIN);
    config.paused = true;
    event::emit(PlatformPaused {});
}

/// Unpause the platform. Only admin can call.
public entry fun unpause_platform(
    config: &mut PlatformConfig,
    ctx: &TxContext,
) {
    assert!(config.admin == ctx.sender(), E_NOT_ADMIN);
    config.paused = false;
    event::emit(PlatformUnpaused {});
}

/// Step 1: Current admin proposes a new admin
public entry fun propose_platform_admin_transfer(
    config: &mut PlatformConfig,
    new_admin: address,
    ctx: &TxContext,
) {
    assert!(config.admin == ctx.sender(), E_NOT_ADMIN);
    assert!(new_admin != @0x0, E_INVALID_RECIPIENT);
    config.pending_admin = option::some(new_admin);
    event::emit(PlatformAdminTransferProposed {
        current_admin: config.admin,
        pending_admin: new_admin,
    });
}

/// Step 2: Pending admin accepts the transfer
public entry fun accept_platform_admin_transfer(
    config: &mut PlatformConfig,
    ctx: &TxContext,
) {
    assert!(config.pending_admin.is_some(), E_NO_PENDING_ADMIN);
    let pending = *config.pending_admin.borrow();
    assert!(pending == ctx.sender(), E_NOT_PENDING_ADMIN);
    let old_admin = config.admin;
    config.admin = pending;
    config.pending_admin = option::none();
    event::emit(PlatformAdminTransferAccepted {
        old_admin,
        new_admin: pending,
    });
}

fun fee_amount_for_price(price_usdc: u64, fee_bps: u64): u64 {
    (((price_usdc as u128) * (fee_bps as u128)) / 10000) as u64
}

// === Pricing Plan ===

/// Create a pricing plan for a series
public entry fun create_pricing_plan(
    cap: &AuthorCap,
    series: &mut SoulSeries,
    plan_type: u8,
    price_usdc: u64,
    period_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(cap.author_cap_series_id() == series.series_id(), E_NOT_AUTHOR);
    assert!(series.series_author() == ctx.sender(), E_NOT_AUTHOR);
    assert!(plan_type == PLAN_ONETIME || plan_type == PLAN_SUBSCRIPTION, E_INVALID_PLAN_TYPE);
    assert!(price_usdc > 0, E_INVALID_PRICE);
    if (plan_type == PLAN_SUBSCRIPTION) {
        assert!(period_ms > 0, E_INVALID_PERIOD);
        assert!(period_ms <= MAX_PERIOD_MS, E_PERIOD_EXCEEDS_MAX);
    } else {
        assert!(period_ms == 0, E_INVALID_PERIOD);
    };

    let plan = PricingPlan {
        id: object::new(ctx),
        series_id: series.series_id(),
        plan_type,
        price_usdc,
        period_ms,
        active: true,
    };

    let plan_id = object::id(&plan);
    series.set_active_plan(plan_type, plan_id);

    event::emit(PricingPlanCreated {
        plan_id,
        series_id: series.series_id(),
        plan_type,
        price_usdc,
        period_ms,
    });

    transfer::share_object(plan);
}

/// Deactivate a pricing plan. Purchases against this plan will be rejected.
/// Shared pricing plan objects remain on-chain after deactivation on Sui.
public entry fun deactivate_pricing_plan(
    cap: &AuthorCap,
    series: &mut SoulSeries,
    plan: &mut PricingPlan,
    ctx: &TxContext,
) {
    assert!(cap.author_cap_series_id() == plan.series_id, E_NOT_AUTHOR);
    assert!(series.series_id() == plan.series_id, E_PLAN_SERIES_MISMATCH);
    assert!(series.series_author() == ctx.sender(), E_NOT_AUTHOR);
    assert!(plan.active, E_PLAN_ALREADY_INACTIVE);
    assert!(series.has_active_plan(plan.plan_type), E_PLAN_SERIES_MISMATCH);
    assert!(series.active_plan_id(plan.plan_type) == object::id(plan), E_PLAN_SERIES_MISMATCH);
    plan.active = false;
    series.remove_active_plan(plan.plan_type);
    event::emit(PricingPlanDeactivated {
        plan_id: object::id(plan),
    });
}

// === Purchase with USDC ===

/// Buy a perpetual pass with USDC.
/// Note: Duplicate purchases for the same release are allowed by design.
/// Frontend callers should warn users before repeat purchases.
public entry fun buy_perpetual(
    config: &PlatformConfig,
    plan: &PricingPlan,
    series: &SoulSeries,
    release: &SoulRelease,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(!config.paused, E_PLATFORM_PAUSED);
    assert!(plan.active, E_PLAN_INACTIVE);
    assert!(plan.series_id == series.series_id(), E_PLAN_SERIES_MISMATCH);
    assert!(plan.plan_type == PLAN_ONETIME, E_WRONG_PLAN_TYPE);
    assert!(series.has_active_plan(plan.plan_type), E_PLAN_INACTIVE);
    assert!(series.active_plan_id(plan.plan_type) == object::id(plan), E_PLAN_SERIES_MISMATCH);
    assert!(release.release_series_id() == series.series_id(), E_RELEASE_MISMATCH);

    // Verify payment amount
    let payment_amount = payment.value();
    assert!(payment_amount == plan.price_usdc, E_INCORRECT_PAYMENT_AMOUNT);

    // Calculate fee split
    let fee_amount = fee_amount_for_price(plan.price_usdc, config.fee_bps);

    // Split and transfer
    let mut payment_mut = payment;
    if (fee_amount > 0) {
        let fee_coin = payment_mut.split(fee_amount, ctx);
        transfer::public_transfer(fee_coin, config.fee_recipient);
    };
    transfer::public_transfer(payment_mut, series.series_author());

    // Mint pass
    let buyer = ctx.sender();
    let pass = pass::mint_perpetual(
        series.series_id(),
        object::id(release),
        buyer,
        ctx,
    );
    pass::transfer_perpetual(pass, buyer);
}

/// Buy a subscription pass with USDC
public entry fun buy_subscription(
    config: &PlatformConfig,
    plan: &PricingPlan,
    series: &SoulSeries,
    payment: Coin<USDC>,
    clock: &sui::clock::Clock,
    ctx: &mut TxContext,
) {
    assert!(!config.paused, E_PLATFORM_PAUSED);
    assert!(plan.active, E_PLAN_INACTIVE);
    assert!(plan.series_id == series.series_id(), E_PLAN_SERIES_MISMATCH);
    assert!(plan.plan_type == PLAN_SUBSCRIPTION, E_WRONG_PLAN_TYPE);
    assert!(plan.period_ms > 0, E_INVALID_PERIOD);
    assert!(series.has_active_plan(plan.plan_type), E_PLAN_INACTIVE);
    assert!(series.active_plan_id(plan.plan_type) == object::id(plan), E_PLAN_SERIES_MISMATCH);

    let payment_amount = payment.value();
    assert!(payment_amount == plan.price_usdc, E_INCORRECT_PAYMENT_AMOUNT);

    let fee_amount = fee_amount_for_price(plan.price_usdc, config.fee_bps);

    let mut payment_mut = payment;
    if (fee_amount > 0) {
        let fee_coin = payment_mut.split(fee_amount, ctx);
        transfer::public_transfer(fee_coin, config.fee_recipient);
    };
    transfer::public_transfer(payment_mut, series.series_author());

    let buyer = ctx.sender();
    let expires_at = clock.timestamp_ms() + plan.period_ms;
    let pass = pass::mint_subscription(
        series.series_id(),
        buyer,
        expires_at,
        plan.period_ms,
        ctx,
    );
    pass::transfer_subscription(pass, buyer);
}

/// Renew an existing subscription
public entry fun renew_subscription(
    config: &PlatformConfig,
    plan: &PricingPlan,
    series: &SoulSeries,
    pass: &mut SubscriptionPass,
    payment: Coin<USDC>,
    clock: &sui::clock::Clock,
    ctx: &mut TxContext,
) {
    assert!(!config.paused, E_PLATFORM_PAUSED);
    assert!(plan.active, E_PLAN_INACTIVE);
    let caller = ctx.sender();
    let is_owner = pass.subscription_owner() == caller;
    let is_agent = pass.subscription_agent_grant().contains(&caller);
    assert!(is_owner || is_agent, E_NOT_PASS_OWNER);
    assert!(plan.series_id == series.series_id(), E_PLAN_SERIES_MISMATCH);
    assert!(plan.plan_type == PLAN_SUBSCRIPTION, E_WRONG_PLAN_TYPE);
    assert!(pass.subscription_series_id() == series.series_id(), E_PLAN_SERIES_MISMATCH);
    assert!(plan.period_ms > 0, E_INVALID_PERIOD);
    assert!(series.has_active_plan(PLAN_SUBSCRIPTION), E_PLAN_INACTIVE);
    assert!(series.active_plan_id(PLAN_SUBSCRIPTION) == object::id(plan), E_PLAN_SERIES_MISMATCH);

    let payment_amount = payment.value();
    assert!(payment_amount == plan.price_usdc, E_INCORRECT_PAYMENT_AMOUNT);

    let fee_amount = fee_amount_for_price(plan.price_usdc, config.fee_bps);

    let mut payment_mut = payment;
    if (fee_amount > 0) {
        let fee_coin = payment_mut.split(fee_amount, ctx);
        transfer::public_transfer(fee_coin, config.fee_recipient);
    };
    transfer::public_transfer(payment_mut, series.series_author());

    pass::renew_subscription_internal(pass, plan.period_ms, clock);
}

// === Accessors ===

public fun plan_series_id(plan: &PricingPlan): ID { plan.series_id }
public fun plan_type(plan: &PricingPlan): u8 { plan.plan_type }
public fun plan_price_usdc(plan: &PricingPlan): u64 { plan.price_usdc }
public fun plan_period_ms(plan: &PricingPlan): u64 { plan.period_ms }
public fun plan_active(plan: &PricingPlan): bool { plan.active }
public fun platform_fee_bps(config: &PlatformConfig): u64 { config.fee_bps }
public fun platform_fee_recipient(config: &PlatformConfig): address { config.fee_recipient }
public fun platform_admin(config: &PlatformConfig): address { config.admin }
public fun platform_paused(config: &PlatformConfig): bool { config.paused }

// === Test Helpers ===

#[test_only]
public(package) fun fee_amount_for_price_for_testing(price_usdc: u64, fee_bps: u64): u64 {
    fee_amount_for_price(price_usdc, fee_bps)
}

#[test_only]
public(package) fun new_platform_config_for_testing(
    admin: address,
    fee_recipient: address,
    fee_bps: u64,
    ctx: &mut TxContext,
): PlatformConfig {
    PlatformConfig {
        id: object::new(ctx),
        fee_recipient,
        fee_bps,
        admin,
        pending_admin: option::none(),
        paused: false,
    }
}

#[test_only]
public(package) fun new_paused_platform_config_for_testing(
    admin: address,
    fee_recipient: address,
    fee_bps: u64,
    ctx: &mut TxContext,
): PlatformConfig {
    PlatformConfig {
        id: object::new(ctx),
        fee_recipient,
        fee_bps,
        admin,
        pending_admin: option::none(),
        paused: true,
    }
}

#[test_only]
public(package) fun destroy_platform_config_for_testing(config: PlatformConfig) {
    let PlatformConfig {
        id,
        fee_recipient: _,
        fee_bps: _,
        admin: _,
        pending_admin: _,
        paused: _,
    } = config;
    id.delete();
}

#[test_only]
public(package) fun share_platform_config_for_testing(config: PlatformConfig) {
    transfer::share_object(config);
}

#[test_only]
public(package) fun new_pricing_plan_for_testing(
    series: &SoulSeries,
    plan_type: u8,
    price_usdc: u64,
    period_ms: u64,
    active: bool,
    ctx: &mut TxContext,
): PricingPlan {
    PricingPlan {
        id: object::new(ctx),
        series_id: series.series_id(),
        plan_type,
        price_usdc,
        period_ms,
        active,
    }
}

#[test_only]
public(package) fun destroy_pricing_plan_for_testing(plan: PricingPlan) {
    let PricingPlan {
        id,
        series_id: _,
        plan_type: _,
        price_usdc: _,
        period_ms: _,
        active: _,
    } = plan;
    id.delete();
}
