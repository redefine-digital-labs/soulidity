#[test_only]
module soul_market::purchase_tests;

use sui::coin;
use sui::test_scenario::{Self as ts};
use soul_market::pass;
use soul_market::purchase;
use soul_market::series;
use usdc::usdc::USDC;

#[test]
fun fee_amount_rounds_down_fractional_basis_points() {
    assert!(purchase::fee_amount_for_price_for_testing(1_000_001, 333) == 33_300, 0);
}

#[test]
fun buy_perpetual_splits_fee_and_transfers_pass_to_buyer() {
    let author = @0xA11CE;
    let fee_recipient = @0xFEE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, buyer);
        let ctx = ts::ctx(&mut scenario);
        let mut series = series::new_series_for_testing(author, ctx);
        let plan = purchase::new_pricing_plan_for_testing(&series, 0, 1_000_000, 0, true, ctx);
        let config = purchase::new_platform_config_for_testing(author, fee_recipient, 250, ctx);
        let release = series::new_release_for_testing(&series, b"1.0.0", ctx);
        let payment = coin::mint_for_testing<USDC>(1_000_000, ctx);

        series::set_active_plan(&mut series, 0, object::id(&plan));
        purchase::buy_perpetual(&config, &plan, &series, &release, payment, ctx);

        series::destroy_release_for_testing(release);
        purchase::destroy_pricing_plan_for_testing(plan);
        purchase::destroy_platform_config_for_testing(config);
        series::destroy_series_for_testing(series);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let pass: pass::PerpetualPass = ts::take_from_sender(&scenario);
        assert!(pass::perpetual_owner(&pass) == buyer, 0);
        pass::destroy_perpetual_for_testing(pass);
    };

    ts::next_tx(&mut scenario, fee_recipient);
    {
        let fee_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(fee_coin.value() == 25_000, 1);
        assert!(coin::burn_for_testing(fee_coin) == 25_000, 2);
    };

    ts::next_tx(&mut scenario, author);
    {
        let payout_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(payout_coin.value() == 975_000, 3);
        assert!(coin::burn_for_testing(payout_coin) == 975_000, 4);
    };

    ts::end(scenario);
}

#[test]
fun buy_subscription_splits_fee_and_transfers_pass_to_buyer() {
    let author = @0xA11CE;
    let fee_recipient = @0xFEE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, buyer);
        let ctx = ts::ctx(&mut scenario);
        let mut series = series::new_series_for_testing(author, ctx);
        let plan = purchase::new_pricing_plan_for_testing(&series, 1, 1_000_000, 10, true, ctx);
        let config = purchase::new_platform_config_for_testing(author, fee_recipient, 250, ctx);
        let payment = coin::mint_for_testing<USDC>(1_000_000, ctx);
        let mut clock = sui::clock::create_for_testing(ctx);
        clock.set_for_testing(100);

        series::set_active_plan(&mut series, 1, object::id(&plan));
        purchase::buy_subscription(&config, &plan, &series, payment, &clock, ctx);

        clock.destroy_for_testing();
        purchase::destroy_pricing_plan_for_testing(plan);
        purchase::destroy_platform_config_for_testing(config);
        series::destroy_series_for_testing(series);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let pass: pass::SubscriptionPass = ts::take_from_sender(&scenario);
        assert!(pass::subscription_owner(&pass) == buyer, 0);
        assert!(pass::subscription_expires_at(&pass) == 110, 1);
        pass::destroy_subscription_for_testing(pass);
    };

    ts::next_tx(&mut scenario, fee_recipient);
    {
        let fee_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(fee_coin.value() == 25_000, 2);
        assert!(coin::burn_for_testing(fee_coin) == 25_000, 3);
    };

    ts::next_tx(&mut scenario, author);
    {
        let payout_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(payout_coin.value() == 975_000, 4);
        assert!(coin::burn_for_testing(payout_coin) == 975_000, 5);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = purchase::E_INVALID_PERIOD)]
fun buy_subscription_rejects_zero_period_plans() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        1_000_000,
        0,
        true,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 250, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::buy_subscription(&config, &plan, &series, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
fun buy_perpetual_with_zero_platform_fee_transfers_full_payout_to_author() {
    let author = @0xA11CE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, buyer);
        let ctx = ts::ctx(&mut scenario);
        let mut series = series::new_series_for_testing(author, ctx);
        let plan = purchase::new_pricing_plan_for_testing(&series, 0, 1_000_000, 0, true, ctx);
        let config = purchase::new_platform_config_for_testing(author, author, 0, ctx);
        let release = series::new_release_for_testing(&series, b"1.0.0", ctx);
        let payment = coin::mint_for_testing<USDC>(1_000_000, ctx);

        series::set_active_plan(&mut series, 0, object::id(&plan));
        purchase::buy_perpetual(&config, &plan, &series, &release, payment, ctx);

        series::destroy_release_for_testing(release);
        purchase::destroy_pricing_plan_for_testing(plan);
        purchase::destroy_platform_config_for_testing(config);
        series::destroy_series_for_testing(series);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let pass: pass::PerpetualPass = ts::take_from_sender(&scenario);
        assert!(pass::perpetual_owner(&pass) == buyer, 0);
        pass::destroy_perpetual_for_testing(pass);
    };

    ts::next_tx(&mut scenario, author);
    {
        let payout_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(payout_coin.value() == 1_000_000, 1);
        assert!(coin::burn_for_testing(payout_coin) == 1_000_000, 2);
    };

    ts::end(scenario);
}

#[test]
fun accept_platform_admin_transfer_updates_admin() {
    let owner = @0xA11CE;
    let new_admin = @0xB0B;
    let mut scenario = ts::begin(@0x0);

    {
        scenario.next_tx(owner);
        let config = purchase::new_platform_config_for_testing(owner, owner, 250, scenario.ctx());
        purchase::share_platform_config_for_testing(config);
    };

    {
        scenario.next_tx(owner);
        let mut config: purchase::PlatformConfig = scenario.take_shared();
        purchase::propose_platform_admin_transfer(&mut config, new_admin, scenario.ctx());
        ts::return_shared(config);
    };

    {
        scenario.next_tx(new_admin);
        let mut config: purchase::PlatformConfig = scenario.take_shared();
        purchase::accept_platform_admin_transfer(&mut config, scenario.ctx());
        assert!(purchase::platform_admin(&config) == new_admin, 0);
        purchase::destroy_platform_config_for_testing(config);
    };

    ts::end(scenario);
}

#[test]
fun renew_subscription_extends_from_expiry_when_clock_equals_expiry() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
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

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, &mut ctx);

    assert!(pass::subscription_expires_at(&pass) == 110, 1);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
fun renew_subscription_migrates_to_new_plan_period() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    // Pass was minted with period 10; new plan has period 30
    let plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        1_000_000,
        30,
        true,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, &mut ctx);

    // Should extend from current expiry (100) by new period (30)
    assert!(pass::subscription_expires_at(&pass) == 130, 0);
    assert!(pass::subscription_period_ms(&pass) == 30, 1);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_SERIES_MISMATCH)]
fun renew_subscription_rejects_non_current_active_plan() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let stale_plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        1_000_000,
        10,
        true,
        &mut ctx,
    );
    let fresh_plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        2_000_000,
        10,
        true,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 250, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&fresh_plan));
    purchase::renew_subscription(&config, &stale_plan, &series, &mut pass, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(stale_plan);
    purchase::destroy_pricing_plan_for_testing(fresh_plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INVALID_PERIOD)]
fun renew_subscription_rejects_zero_period_plans() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        1_000_000,
        0,
        true,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 250, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
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
    purchase::deactivate_pricing_plan(&cap, &mut series, &mut stale_plan, &ctx);

    purchase::destroy_pricing_plan_for_testing(stale_plan);
    purchase::destroy_pricing_plan_for_testing(fresh_plan);
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_SERIES_MISMATCH)]
fun deactivate_rejects_missing_active_plan_registry_entries() {
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

    purchase::deactivate_pricing_plan(&cap, &mut series, &mut plan, &ctx);

    purchase::destroy_pricing_plan_for_testing(plan);
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_ALREADY_INACTIVE)]
fun deactivate_pricing_plan_rejects_double_deactivation() {
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
    purchase::deactivate_pricing_plan(&cap, &mut series, &mut plan, &ctx);
    purchase::deactivate_pricing_plan(&cap, &mut series, &mut plan, &ctx);

    purchase::destroy_pricing_plan_for_testing(plan);
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INVALID_PERIOD)]
fun create_pricing_plan_rejects_non_zero_period_for_onetime() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series, &mut ctx);

    purchase::create_pricing_plan(&cap, &mut series, 0, 1_000_000, 1, &mut ctx);

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_NOT_AUTHOR)]
fun create_pricing_plan_rejects_sender_that_is_not_current_series_author() {
    let mut ctx = sui::tx_context::dummy();
    let mut series = series::new_series_for_testing(@0xCAFE, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series, &mut ctx);

    purchase::create_pricing_plan(&cap, &mut series, 0, 1_000_000, 0, &mut ctx);

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_NOT_AUTHOR)]
fun deactivate_pricing_plan_rejects_sender_that_is_not_current_series_author() {
    let mut ctx = sui::tx_context::dummy();
    let mut series = series::new_series_for_testing(@0xCAFE, &mut ctx);
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
    purchase::deactivate_pricing_plan(&cap, &mut series, &mut plan, &ctx);

    purchase::destroy_pricing_plan_for_testing(plan);
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INVALID_RECIPIENT)]
fun update_platform_config_rejects_zero_fee_recipient() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut config = purchase::new_platform_config_for_testing(owner, owner, 250, &mut ctx);

    purchase::update_platform_config(&mut config, @0x0, 250, &ctx);

    purchase::destroy_platform_config_for_testing(config);
}

#[test]
#[expected_failure(abort_code = purchase::E_INVALID_RECIPIENT)]
fun propose_platform_admin_transfer_rejects_zero_admin() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut config = purchase::new_platform_config_for_testing(owner, owner, 250, &mut ctx);

    purchase::propose_platform_admin_transfer(&mut config, @0x0, &ctx);

    purchase::destroy_platform_config_for_testing(config);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_INACTIVE)]
fun buy_perpetual_rejects_inactive_plan() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(
        &series,
        0,
        1_000_000,
        0,
        false,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let release = series::new_release_for_testing(&series, b"1.0.0", &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);

    purchase::buy_perpetual(&config, &plan, &series, &release, payment, &mut ctx);

    series::destroy_release_for_testing(release);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_INACTIVE)]
fun buy_perpetual_rejects_missing_active_plan_registry_entry() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(
        &series,
        0,
        1_000_000,
        0,
        true,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let release = series::new_release_for_testing(&series, b"1.0.0", &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);

    purchase::buy_perpetual(&config, &plan, &series, &release, payment, &mut ctx);

    series::destroy_release_for_testing(release);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_INACTIVE)]
fun buy_subscription_rejects_inactive_plan() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        1_000_000,
        10,
        false,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    purchase::buy_subscription(&config, &plan, &series, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_INACTIVE)]
fun buy_subscription_rejects_missing_active_plan_registry_entry() {
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
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    purchase::buy_subscription(&config, &plan, &series, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_INACTIVE)]
fun renew_subscription_rejects_inactive_plan() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        1_000_000,
        10,
        false,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_INACTIVE)]
fun renew_subscription_rejects_missing_active_plan_registry_entry() {
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
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_SERIES_MISMATCH)]
fun buy_perpetual_rejects_non_current_active_plan() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let stale_plan = purchase::new_pricing_plan_for_testing(
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
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let release = series::new_release_for_testing(&series, b"1.0.0", &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);

    series::set_active_plan(&mut series, 0, object::id(&fresh_plan));
    purchase::buy_perpetual(&config, &stale_plan, &series, &release, payment, &mut ctx);

    series::destroy_release_for_testing(release);
    purchase::destroy_pricing_plan_for_testing(stale_plan);
    purchase::destroy_pricing_plan_for_testing(fresh_plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLAN_SERIES_MISMATCH)]
fun buy_subscription_rejects_non_current_active_plan() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let stale_plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        1_000_000,
        10,
        true,
        &mut ctx,
    );
    let fresh_plan = purchase::new_pricing_plan_for_testing(
        &series,
        1,
        2_000_000,
        10,
        true,
        &mut ctx,
    );
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&fresh_plan));
    purchase::buy_subscription(&config, &stale_plan, &series, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    purchase::destroy_pricing_plan_for_testing(stale_plan);
    purchase::destroy_pricing_plan_for_testing(fresh_plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INCORRECT_PAYMENT_AMOUNT)]
fun buy_perpetual_rejects_underpayment() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 0, 1_000_000, 0, true, &mut ctx);
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let release = series::new_release_for_testing(&series, b"1.0.0", &mut ctx);
    let payment = coin::mint_for_testing<USDC>(999_999, &mut ctx);

    series::set_active_plan(&mut series, 0, object::id(&plan));
    purchase::buy_perpetual(&config, &plan, &series, &release, payment, &mut ctx);

    series::destroy_release_for_testing(release);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INCORRECT_PAYMENT_AMOUNT)]
fun buy_perpetual_rejects_overpayment() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 0, 1_000_000, 0, true, &mut ctx);
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let release = series::new_release_for_testing(&series, b"1.0.0", &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_001, &mut ctx);

    series::set_active_plan(&mut series, 0, object::id(&plan));
    purchase::buy_perpetual(&config, &plan, &series, &release, payment, &mut ctx);

    series::destroy_release_for_testing(release);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INCORRECT_PAYMENT_AMOUNT)]
fun buy_subscription_rejects_underpayment() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 1, 1_000_000, 10, true, &mut ctx);
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(999_999, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::buy_subscription(&config, &plan, &series, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INCORRECT_PAYMENT_AMOUNT)]
fun buy_subscription_rejects_overpayment() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 1, 1_000_000, 10, true, &mut ctx);
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_001, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::buy_subscription(&config, &plan, &series, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_NOT_PASS_OWNER)]
fun renew_subscription_rejects_non_owner() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let pass_owner = @0xB0B;
    let mut series = series::new_series_for_testing(author, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 1, 1_000_000, 10, true, &mut ctx);
    let config = purchase::new_platform_config_for_testing(author, author, 0, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), pass_owner, 100, 10, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = series::E_PLAN_TYPE_ALREADY_ACTIVE)]
fun create_pricing_plan_rejects_duplicate_plan_type() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series, &mut ctx);

    purchase::create_pricing_plan(&cap, &mut series, 0, 1_000_000, 0, &mut ctx);
    purchase::create_pricing_plan(&cap, &mut series, 0, 2_000_000, 0, &mut ctx);

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
fun renew_subscription_allows_granted_agent() {
    let owner = @0xBEEF;
    let agent = @0xA11CE;
    let mut scenario = sui::test_scenario::begin(@0x0);

    {
        scenario.next_tx(agent);
        let ctx = scenario.ctx();
        let mut series = series::new_series_for_testing(owner, ctx);
        let plan = purchase::new_pricing_plan_for_testing(&series, 1, 1_000_000, 10, true, ctx);
        let config = purchase::new_platform_config_for_testing(owner, owner, 0, ctx);
        let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, ctx);
        *pass::subscription_agent_grant_mut(&mut pass) = option::some(agent);
        let payment = coin::mint_for_testing<USDC>(1_000_000, ctx);
        let mut clock = sui::clock::create_for_testing(ctx);
        clock.set_for_testing(90);

        series::set_active_plan(&mut series, 1, object::id(&plan));
        purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, ctx);

        assert!(pass::subscription_expires_at(&pass) == 110, 0);

        clock.destroy_for_testing();
        pass::destroy_subscription_for_testing(pass);
        purchase::destroy_pricing_plan_for_testing(plan);
        purchase::destroy_platform_config_for_testing(config);
        series::destroy_series_for_testing(series);
    };

    sui::test_scenario::end(scenario);
}

// === L5: Previously untested error branches ===

#[test]
#[expected_failure(abort_code = purchase::E_NOT_ADMIN)]
fun update_platform_config_rejects_non_admin() {
    let admin = @0xA11CE;
    let attacker = @0xBAD;
    let mut admin_ctx = sui::tx_context::new_from_hint(admin, 1, 0, 0, 0);
    let attacker_ctx = sui::tx_context::new_from_hint(attacker, 2, 0, 0, 0);
    let mut config = purchase::new_platform_config_for_testing(admin, admin, 250, &mut admin_ctx);

    purchase::update_platform_config(&mut config, admin, 100, &attacker_ctx);

    purchase::destroy_platform_config_for_testing(config);
}

#[test]
#[expected_failure(abort_code = purchase::E_NOT_ADMIN)]
fun propose_platform_admin_transfer_rejects_non_admin() {
    let admin = @0xA11CE;
    let attacker = @0xBAD;
    let mut admin_ctx = sui::tx_context::new_from_hint(admin, 1, 0, 0, 0);
    let attacker_ctx = sui::tx_context::new_from_hint(attacker, 2, 0, 0, 0);
    let mut config = purchase::new_platform_config_for_testing(admin, admin, 250, &mut admin_ctx);

    purchase::propose_platform_admin_transfer(&mut config, @0xB0B, &attacker_ctx);

    purchase::destroy_platform_config_for_testing(config);
}

#[test]
#[expected_failure(abort_code = purchase::E_NO_PENDING_ADMIN)]
fun accept_platform_admin_transfer_rejects_when_no_pending() {
    let admin = @0xA11CE;
    let mut ctx = sui::tx_context::new_from_hint(admin, 1, 0, 0, 0);
    let mut config = purchase::new_platform_config_for_testing(admin, admin, 250, &mut ctx);

    purchase::accept_platform_admin_transfer(&mut config, &ctx);

    purchase::destroy_platform_config_for_testing(config);
}

#[test]
#[expected_failure(abort_code = purchase::E_NOT_PENDING_ADMIN)]
fun accept_platform_admin_transfer_rejects_wrong_sender() {
    let admin = @0xA11CE;
    let wrong = @0xBAD;
    let mut scenario = ts::begin(@0x0);

    {
        scenario.next_tx(admin);
        let config = purchase::new_platform_config_for_testing(admin, admin, 250, scenario.ctx());
        purchase::share_platform_config_for_testing(config);
    };

    {
        scenario.next_tx(admin);
        let mut config: purchase::PlatformConfig = scenario.take_shared();
        purchase::propose_platform_admin_transfer(&mut config, @0xB0B, scenario.ctx());
        ts::return_shared(config);
    };

    {
        scenario.next_tx(wrong);
        let mut config: purchase::PlatformConfig = scenario.take_shared();
        purchase::accept_platform_admin_transfer(&mut config, scenario.ctx());
        purchase::destroy_platform_config_for_testing(config);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = purchase::E_INVALID_PLAN_TYPE)]
fun create_pricing_plan_rejects_invalid_plan_type() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series, &mut ctx);

    purchase::create_pricing_plan(&cap, &mut series, 2, 1_000_000, 0, &mut ctx);

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INVALID_PRICE)]
fun create_pricing_plan_rejects_zero_price() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series, &mut ctx);

    purchase::create_pricing_plan(&cap, &mut series, 0, 0, 0, &mut ctx);

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PERIOD_EXCEEDS_MAX)]
fun create_pricing_plan_rejects_period_exceeds_max() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series, &mut ctx);

    purchase::create_pricing_plan(&cap, &mut series, 1, 1_000_000, 31_536_000_001, &mut ctx);

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_INVALID_FEE_BPS)]
fun update_platform_config_rejects_fee_bps_over_max() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut config = purchase::new_platform_config_for_testing(owner, owner, 250, &mut ctx);

    purchase::update_platform_config(&mut config, owner, 1001, &ctx);

    purchase::destroy_platform_config_for_testing(config);
}

#[test]
#[expected_failure(abort_code = purchase::E_WRONG_PLAN_TYPE)]
fun buy_perpetual_rejects_subscription_plan_type() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 1, 1_000_000, 10, true, &mut ctx);
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let release = series::new_release_for_testing(&series, b"1.0.0", &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::buy_perpetual(&config, &plan, &series, &release, payment, &mut ctx);

    series::destroy_release_for_testing(release);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_WRONG_PLAN_TYPE)]
fun buy_subscription_rejects_onetime_plan_type() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 0, 1_000_000, 0, true, &mut ctx);
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 0, object::id(&plan));
    purchase::buy_subscription(&config, &plan, &series, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_RELEASE_MISMATCH)]
fun buy_perpetual_rejects_release_from_different_series() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let other_series = series::new_series_for_testing(@0xBEEF, &mut ctx);
    let foreign_release = series::new_release_for_testing(&other_series, b"v1", &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 0, 1_000_000, 0, true, &mut ctx);
    let config = purchase::new_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);

    series::set_active_plan(&mut series, 0, object::id(&plan));
    purchase::buy_perpetual(&config, &plan, &series, &foreign_release, payment, &mut ctx);

    series::destroy_release_for_testing(foreign_release);
    series::destroy_series_for_testing(other_series);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

// === L4: Pause mechanism tests ===

#[test]
#[expected_failure(abort_code = purchase::E_PLATFORM_PAUSED)]
fun buy_perpetual_rejects_when_paused() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 0, 1_000_000, 0, true, &mut ctx);
    let config = purchase::new_paused_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let release = series::new_release_for_testing(&series, b"1.0.0", &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);

    series::set_active_plan(&mut series, 0, object::id(&plan));
    purchase::buy_perpetual(&config, &plan, &series, &release, payment, &mut ctx);

    series::destroy_release_for_testing(release);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLATFORM_PAUSED)]
fun buy_subscription_rejects_when_paused() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 1, 1_000_000, 10, true, &mut ctx);
    let config = purchase::new_paused_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::buy_subscription(&config, &plan, &series, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = purchase::E_PLATFORM_PAUSED)]
fun renew_subscription_rejects_when_paused() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let mut series = series::new_series_for_testing(owner, &mut ctx);
    let plan = purchase::new_pricing_plan_for_testing(&series, 1, 1_000_000, 10, true, &mut ctx);
    let config = purchase::new_paused_platform_config_for_testing(owner, owner, 0, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);
    let payment = coin::mint_for_testing<USDC>(1_000_000, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    series::set_active_plan(&mut series, 1, object::id(&plan));
    purchase::renew_subscription(&config, &plan, &series, &mut pass, payment, &clock, &mut ctx);

    clock.destroy_for_testing();
    pass::destroy_subscription_for_testing(pass);
    purchase::destroy_pricing_plan_for_testing(plan);
    purchase::destroy_platform_config_for_testing(config);
    series::destroy_series_for_testing(series);
}

#[test]
fun pause_and_unpause_platform_works() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    {
        scenario.next_tx(admin);
        let config = purchase::new_platform_config_for_testing(admin, admin, 0, scenario.ctx());
        purchase::share_platform_config_for_testing(config);
    };

    {
        scenario.next_tx(admin);
        let mut config: purchase::PlatformConfig = scenario.take_shared();
        assert!(!purchase::platform_paused(&config), 0);
        purchase::pause_platform(&mut config, scenario.ctx());
        assert!(purchase::platform_paused(&config), 1);
        purchase::unpause_platform(&mut config, scenario.ctx());
        assert!(!purchase::platform_paused(&config), 2);
        purchase::destroy_platform_config_for_testing(config);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = purchase::E_NOT_ADMIN)]
fun pause_platform_rejects_non_admin() {
    let admin = @0xA11CE;
    let attacker = @0xBAD;
    let mut admin_ctx = sui::tx_context::new_from_hint(admin, 1, 0, 0, 0);
    let attacker_ctx = sui::tx_context::new_from_hint(attacker, 2, 0, 0, 0);
    let mut config = purchase::new_platform_config_for_testing(admin, admin, 0, &mut admin_ctx);

    purchase::pause_platform(&mut config, &attacker_ctx);

    purchase::destroy_platform_config_for_testing(config);
}
