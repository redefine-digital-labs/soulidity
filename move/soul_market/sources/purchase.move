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

// === Constants ===

const PLAN_ONETIME: u8 = 0;
const PLAN_SUBSCRIPTION: u8 = 1;
const DEFAULT_PLATFORM_FEE_BPS: u64 = 0;
const MAX_PLATFORM_FEE_BPS: u64 = 1000;
const MAX_PERIOD_MS: u64 = 31_536_000_000; // 1 year

// === Structs ===

/// Platform configuration (shared singleton)
public struct PlatformConfig has key {
    id: UID,
    fee_recipient: address,
    fee_bps: u64, // basis points, e.g. 250 = 2.5%
    admin: address,
    pending_admin: Option<address>,
}

/// Pricing plan for a series
public struct PricingPlan has key, store {
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
    };
    transfer::share_object(config);
}

public entry fun update_platform_config(
    config: &mut PlatformConfig,
    fee_recipient: address,
    fee_bps: u64,
    ctx: &TxContext,
) {
    assert!(config.admin == ctx.sender(), 2); // ENotAdmin
    assert!(fee_bps <= MAX_PLATFORM_FEE_BPS, 20); // EInvalidFeeBps
    config.fee_recipient = fee_recipient;
    config.fee_bps = fee_bps;
}

/// Step 1: Current admin proposes a new admin
public entry fun propose_platform_admin_transfer(
    config: &mut PlatformConfig,
    new_admin: address,
    ctx: &TxContext,
) {
    assert!(config.admin == ctx.sender(), 2); // ENotAdmin
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
    assert!(config.pending_admin.is_some(), 23); // ENoPendingAdmin
    let pending = *config.pending_admin.borrow();
    assert!(pending == ctx.sender(), 24); // ENotPendingAdmin
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
    series: &SoulSeries,
    plan_type: u8,
    price_usdc: u64,
    period_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(cap.author_cap_series_id() == series.series_id(), 0); // ENotAuthor
    assert!(plan_type == PLAN_ONETIME || plan_type == PLAN_SUBSCRIPTION, 3); // EInvalidPlanType
    assert!(price_usdc > 0, 4); // EInvalidPrice
    if (plan_type == PLAN_SUBSCRIPTION) {
        assert!(period_ms > 0, 5); // EInvalidPeriod
        assert!(period_ms <= MAX_PERIOD_MS, 21); // EPeriodExceedsMax
    };

    let plan = PricingPlan {
        id: object::new(ctx),
        series_id: series.series_id(),
        plan_type,
        price_usdc,
        period_ms,
        active: true,
    };

    event::emit(PricingPlanCreated {
        plan_id: object::id(&plan),
        series_id: series.series_id(),
        plan_type,
        price_usdc,
        period_ms,
    });

    transfer::share_object(plan);
}

/// Deactivate a pricing plan. Purchases against this plan will be rejected.
public entry fun deactivate_pricing_plan(
    cap: &AuthorCap,
    plan: &mut PricingPlan,
) {
    assert!(cap.author_cap_series_id() == plan.series_id, 0); // ENotAuthor
    plan.active = false;
    event::emit(PricingPlanDeactivated {
        plan_id: object::id(plan),
    });
}

// === Purchase with USDC ===

/// Buy a perpetual pass with USDC.
/// Note: Duplicate purchases for the same release are allowed by design.
/// Frontend and relayer layers should warn users before repeat purchases.
public entry fun buy_perpetual(
    config: &PlatformConfig,
    plan: &PricingPlan,
    series: &SoulSeries,
    release: &SoulRelease,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(plan.active, 22); // EPlanInactive
    assert!(plan.series_id == series.series_id(), 6); // EPlanSeriesMismatch
    assert!(plan.plan_type == PLAN_ONETIME, 7); // EWrongPlanType
    assert!(release.release_series_id() == series.series_id(), 8); // EReleaseMismatch

    // Verify payment amount
    let payment_amount = payment.value();
    assert!(payment_amount == plan.price_usdc, 9); // EIncorrectPaymentAmount

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
    transfer::public_transfer(pass, buyer);
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
    assert!(plan.active, 22); // EPlanInactive
    assert!(plan.series_id == series.series_id(), 6);
    assert!(plan.plan_type == PLAN_SUBSCRIPTION, 7);

    let payment_amount = payment.value();
    assert!(payment_amount == plan.price_usdc, 9);

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
    transfer::public_transfer(pass, buyer);
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
    assert!(plan.active, 22); // EPlanInactive
    assert!(pass.subscription_owner() == ctx.sender(), 1);
    assert!(plan.series_id == series.series_id(), 6);
    assert!(plan.plan_type == PLAN_SUBSCRIPTION, 7);
    assert!(pass.subscription_series_id() == series.series_id(), 8);
    assert!(plan.period_ms == pass.subscription_period_ms(), 25); // EPeriodMismatch

    let payment_amount = payment.value();
    assert!(payment_amount == plan.price_usdc, 9);

    let fee_amount = fee_amount_for_price(plan.price_usdc, config.fee_bps);

    let mut payment_mut = payment;
    if (fee_amount > 0) {
        let fee_coin = payment_mut.split(fee_amount, ctx);
        transfer::public_transfer(fee_coin, config.fee_recipient);
    };
    transfer::public_transfer(payment_mut, series.series_author());

    pass::renew_subscription_internal(pass, clock);
}

// === Accessors ===

public fun plan_series_id(plan: &PricingPlan): ID { plan.series_id }
public fun plan_type(plan: &PricingPlan): u8 { plan.plan_type }
public fun plan_price_usdc(plan: &PricingPlan): u64 { plan.price_usdc }
public fun plan_period_ms(plan: &PricingPlan): u64 { plan.period_ms }
public fun plan_active(plan: &PricingPlan): bool { plan.active }
public fun platform_fee_bps(config: &PlatformConfig): u64 { config.fee_bps }
public fun platform_fee_recipient(config: &PlatformConfig): address { config.fee_recipient }
