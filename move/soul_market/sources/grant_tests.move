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
#[expected_failure(abort_code = grant::E_SELF_GRANT)]
fun set_agent_grant_perpetual_rejects_self_grant() {
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

    grant::set_agent_grant_perpetual(&mut pass, owner, &ctx);

    pass::destroy_perpetual_for_testing(pass);
    series::destroy_release_for_testing(release);
    series::destroy_series_for_testing(series);
}
