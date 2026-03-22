#[test_only]
module soul_market::purchase_tests;

use sui::coin;
use soul_market::pass;
use soul_market::purchase;
use soul_market::series;
use usdc::usdc::USDC;

#[test]
fun fee_amount_rounds_down_fractional_basis_points() {
    assert!(purchase::fee_amount_for_price_for_testing(1_000_001, 333) == 33_300, 0);
}

#[test]
fun renew_subscription_extends_from_expiry_when_clock_equals_expiry() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        1_000_000,
        10,
        true,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 250, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, &mut ctx);

    assert!(pass::subscription_expires_at(&pass) == 110, 1);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
fun destroy_inactive_pricing_plan_succeeds() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series, &mut ctx);
    let mut plan = purchase::new_pricing_plan_for_testing(
        &series,
        0,
        1_000_000,
        0,
        true,
        &mut ctx,
    );

    series::set_active_plan(&mut series, 0, object::id(&plan));
    purchase::deactivate_pricing_plan(&cap, &mut series, &mut plan);
    purchase::destroy_inactive_pricing_plan(&cap, &series, plan);

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_SERIES_MISMATCH)]
fun deactivate_rejects_stale_active_plan_registry_entries() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series, &mut ctx);
    let mut stale_plan = purchase::new_pricing_plan_for_testing(
        &series,
        0,
        1_000_000,
        0,
        true,
        &mut ctx,
    );
    let fresh_plan = purchase::new_pricing_plan_for_testing(
        &series,
        0,
        2_000_000,
        0,
        true,
        &mut ctx,
    );

    series::set_active_plan(&mut series, 0, object::id(&fresh_plan));
    purchase::deactivate_pricing_plan(&cap, &mut series, &mut stale_plan);

    purchase::destroy_pricing_plan_for_testing(stale_plan);
    purchase::destroy_pricing_plan_for_testing(fresh_plan);
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}
