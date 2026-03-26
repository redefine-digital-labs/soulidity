#[test_only]
module soul_market::grant_tests;

use soul_market::grant;
use soul_market::pass;
use soul_market::series;

#[test]
fun revoke_subscription_agent_grant_clears_agent() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);

    grant::set_agent_grant_subscription(&mut pass, @0xA11CE, &ctx);
    grant::revoke_agent_grant_subscription(&mut pass, &ctx);

    assert!(pass::subscription_agent_grant(&pass).is_none(), 0);

    pass::destroy_subscription_for_testing(pass);
    series::destroy_series_for_testing(series);
}

#[test]
fun revoke_perpetual_agent_grant_clears_agent() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let release = series::new_release_for_testing(&series, b"v1", &mut ctx);
    let mut pass = pass::mint_perpetual(
        series::series_id(&series),
        object::id(&release),
        owner,
        &mut ctx,
    );

    grant::set_agent_grant_perpetual(&mut pass, @0xA11CE, &ctx);
    grant::revoke_agent_grant_perpetual(&mut pass, &ctx);

    assert!(pass::perpetual_agent_grant(&pass).is_none(), 0);

    pass::destroy_perpetual_for_testing(pass);
    series::destroy_release_for_testing(release);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_SELF_GRANT)]
fun set_agent_grant_perpetual_rejects_self_grant() {
    let mut ctx = sui::tx_context::new_from_hint(@0xBEEF, 1, 0, 0, 0);
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let release = series::new_release_for_testing(&series, b"v1", &mut ctx);
    let mut pass = pass::mint_perpetual(
        series::series_id(&series),
        object::id(&release),
        owner,
        &mut ctx,
    );

    grant::set_agent_grant_perpetual(&mut pass, owner, &ctx);

    pass::destroy_perpetual_for_testing(pass);
    series::destroy_release_for_testing(release);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_NOT_OWNER)]
fun set_agent_grant_perpetual_rejects_non_owner() {
    let owner = @0xBEEF;
    let attacker = @0xBAD;
    let mut owner_ctx = sui::tx_context::new_from_hint(owner, 2, 0, 0, 0);
    let attacker_ctx = sui::tx_context::new_from_hint(attacker, 3, 0, 0, 0);
    let series = series::new_series_for_testing(owner, &mut owner_ctx);
    let release = series::new_release_for_testing(&series, b"v1", &mut owner_ctx);
    let mut pass = pass::mint_perpetual(
        series::series_id(&series),
        object::id(&release),
        owner,
        &mut owner_ctx,
    );

    grant::set_agent_grant_perpetual(&mut pass, @0xA11CE, &attacker_ctx);

    pass::destroy_perpetual_for_testing(pass);
    series::destroy_release_for_testing(release);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_SELF_GRANT)]
fun set_agent_grant_subscription_rejects_self_grant() {
    let mut ctx = sui::tx_context::new_from_hint(@0xBEEF, 2, 0, 0, 0);
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);

    grant::set_agent_grant_subscription(&mut pass, owner, &ctx);

    pass::destroy_subscription_for_testing(pass);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_NOT_OWNER)]
fun set_agent_grant_subscription_rejects_non_owner() {
    let owner = @0xBEEF;
    let attacker = @0xBAD;
    let mut owner_ctx = sui::tx_context::new_from_hint(owner, 4, 0, 0, 0);
    let attacker_ctx = sui::tx_context::new_from_hint(attacker, 5, 0, 0, 0);
    let series = series::new_series_for_testing(owner, &mut owner_ctx);
    let mut pass = pass::mint_subscription(
        series::series_id(&series),
        owner,
        100,
        10,
        &mut owner_ctx,
    );

    grant::set_agent_grant_subscription(&mut pass, @0xA11CE, &attacker_ctx);

    pass::destroy_subscription_for_testing(pass);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_INVALID_AGENT)]
fun set_agent_grant_perpetual_rejects_zero_agent() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let release = series::new_release_for_testing(&series, b"v1", &mut ctx);
    let mut pass = pass::mint_perpetual(
        series::series_id(&series),
        object::id(&release),
        owner,
        &mut ctx,
    );

    grant::set_agent_grant_perpetual(&mut pass, @0x0, &ctx);

    pass::destroy_perpetual_for_testing(pass);
    series::destroy_release_for_testing(release);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_NO_AGENT_GRANT)]
fun revoke_perpetual_agent_grant_rejects_missing_grant() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let release = series::new_release_for_testing(&series, b"v1", &mut ctx);
    let mut pass = pass::mint_perpetual(
        series::series_id(&series),
        object::id(&release),
        owner,
        &mut ctx,
    );

    grant::revoke_agent_grant_perpetual(&mut pass, &ctx);

    pass::destroy_perpetual_for_testing(pass);
    series::destroy_release_for_testing(release);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_NOT_OWNER)]
fun revoke_perpetual_agent_grant_rejects_non_owner() {
    let owner = @0xBEEF;
    let attacker = @0xBAD;
    let mut owner_ctx = sui::tx_context::new_from_hint(owner, 6, 0, 0, 0);
    let attacker_ctx = sui::tx_context::new_from_hint(attacker, 7, 0, 0, 0);
    let series = series::new_series_for_testing(owner, &mut owner_ctx);
    let release = series::new_release_for_testing(&series, b"v1", &mut owner_ctx);
    let mut pass = pass::mint_perpetual(
        series::series_id(&series),
        object::id(&release),
        owner,
        &mut owner_ctx,
    );
    grant::set_agent_grant_perpetual(&mut pass, @0xA11CE, &owner_ctx);

    grant::revoke_agent_grant_perpetual(&mut pass, &attacker_ctx);

    pass::destroy_perpetual_for_testing(pass);
    series::destroy_release_for_testing(release);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_INVALID_AGENT)]
fun set_agent_grant_subscription_rejects_zero_agent() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);

    grant::set_agent_grant_subscription(&mut pass, @0x0, &ctx);

    pass::destroy_subscription_for_testing(pass);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_NO_AGENT_GRANT)]
fun revoke_subscription_agent_grant_rejects_missing_grant() {
    let mut ctx = sui::tx_context::dummy();
    let owner = ctx.sender();
    let series = series::new_series_for_testing(owner, &mut ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut ctx);

    grant::revoke_agent_grant_subscription(&mut pass, &ctx);

    pass::destroy_subscription_for_testing(pass);
    series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = grant::E_NOT_OWNER)]
fun revoke_subscription_agent_grant_rejects_non_owner() {
    let owner = @0xBEEF;
    let attacker = @0xBAD;
    let mut owner_ctx = sui::tx_context::new_from_hint(owner, 8, 0, 0, 0);
    let attacker_ctx = sui::tx_context::new_from_hint(attacker, 9, 0, 0, 0);
    let series = series::new_series_for_testing(owner, &mut owner_ctx);
    let mut pass = pass::mint_subscription(series::series_id(&series), owner, 100, 10, &mut owner_ctx);
    grant::set_agent_grant_subscription(&mut pass, @0xA11CE, &owner_ctx);

    grant::revoke_agent_grant_subscription(&mut pass, &attacker_ctx);

    pass::destroy_subscription_for_testing(pass);
    series::destroy_series_for_testing(series);
}
