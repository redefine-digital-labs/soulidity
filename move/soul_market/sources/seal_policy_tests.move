#[test_only]
module soul_market::seal_policy_tests;

use soul_market::seal_policy;

fun document_id_for_release(series: &soul_market::series::SoulSeries, release: &soul_market::series::SoulRelease): vector<u8> {
    let mut document_id = object::id(series).to_bytes();
    let release_id = object::id(release).to_bytes();
    let mut index = 0;
    while (index < release_id.length()) {
        document_id.push_back(release_id[index]);
        index = index + 1;
    };
    document_id
}

fun append_test_nonce(document_id: &mut vector<u8>) {
    let mut nonce: u64 = 0;
    while (nonce < 16) {
        document_id.push_back((nonce as u8) + 1);
        nonce = nonce + 1;
    };
}

#[test]
fun perpetual_owner_can_approve_matching_release() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let release = soul_market::series::new_release_for_testing(&series, b"v1", &mut ctx);
    let pass = soul_market::pass::mint_perpetual(
        object::id(&series),
        object::id(&release),
        caller,
        &mut ctx,
    );
    let document_id = document_id_for_release(&series, &release);

    seal_policy::seal_approve_perpetual_for_testing(
        document_id,
        &pass,
        &release,
        &series,
        &ctx,
    );

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(release);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
fun perpetual_owner_can_approve_matching_release_with_nonce_suffix() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let release = soul_market::series::new_release_for_testing(&series, b"v1", &mut ctx);
    let pass = soul_market::pass::mint_perpetual(
        object::id(&series),
        object::id(&release),
        caller,
        &mut ctx,
    );
    let mut document_id = document_id_for_release(&series, &release);
    append_test_nonce(&mut document_id);

    seal_policy::seal_approve_perpetual_for_testing(
        document_id,
        &pass,
        &release,
        &series,
        &ctx,
    );

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(release);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
fun perpetual_agent_can_approve_matching_release() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(@0xA11CE, &mut ctx);
    let release = soul_market::series::new_release_for_testing(&series, b"v1", &mut ctx);
    let mut pass = soul_market::pass::mint_perpetual(
        object::id(&series),
        object::id(&release),
        @0xB0B,
        &mut ctx,
    );
    *soul_market::pass::perpetual_agent_grant_mut(&mut pass) = option::some(caller);
    let document_id = document_id_for_release(&series, &release);

    seal_policy::seal_approve_perpetual_for_testing(
        document_id,
        &pass,
        &release,
        &series,
        &ctx,
    );

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(release);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = seal_policy::ENotAuthorized)]
fun perpetual_rejects_unauthorized_caller() {
    let mut ctx = sui::tx_context::dummy();
    let series = soul_market::series::new_series_for_testing(@0xA11CE, &mut ctx);
    let release = soul_market::series::new_release_for_testing(&series, b"v1", &mut ctx);
    let pass = soul_market::pass::mint_perpetual(
        object::id(&series),
        object::id(&release),
        @0xB0B,
        &mut ctx,
    );
    let document_id = document_id_for_release(&series, &release);

    seal_policy::seal_approve_perpetual_for_testing(
        document_id,
        &pass,
        &release,
        &series,
        &ctx,
    );

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(release);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = seal_policy::EIdPrefixMismatch)]
fun perpetual_rejects_invalid_document_prefix() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let release = soul_market::series::new_release_for_testing(&series, b"v1", &mut ctx);
    let pass = soul_market::pass::mint_perpetual(
        object::id(&series),
        object::id(&release),
        caller,
        &mut ctx,
    );

    seal_policy::seal_approve_perpetual_for_testing(vector[1], &pass, &release, &series, &ctx);

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(release);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = seal_policy::EReleaseNotInSeries)]
fun perpetual_rejects_release_from_another_series() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let other_series = soul_market::series::new_series_for_testing(@0xBEEF, &mut ctx);
    let foreign_release = soul_market::series::new_release_for_testing(&other_series, b"v2", &mut ctx);
    let pass = soul_market::pass::mint_perpetual(
        object::id(&series),
        object::id(&foreign_release),
        caller,
        &mut ctx,
    );
    let document_id = document_id_for_release(&series, &foreign_release);

    seal_policy::seal_approve_perpetual_for_testing(
        document_id,
        &pass,
        &foreign_release,
        &series,
        &ctx,
    );

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(foreign_release);
    soul_market::series::destroy_series_for_testing(other_series);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = seal_policy::EDocumentReleaseMismatch)]
fun perpetual_rejects_document_bound_to_another_release() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let locked_release = soul_market::series::new_release_for_testing(&series, b"v1", &mut ctx);
    let newer_release = soul_market::series::new_release_for_testing(&series, b"v2", &mut ctx);
    let pass = soul_market::pass::mint_perpetual(
        object::id(&series),
        object::id(&locked_release),
        caller,
        &mut ctx,
    );
    let mut document_id = document_id_for_release(&series, &newer_release);
    append_test_nonce(&mut document_id);

    seal_policy::seal_approve_perpetual_for_testing(
        document_id,
        &pass,
        &locked_release,
        &series,
        &ctx,
    );

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(newer_release);
    soul_market::series::destroy_release_for_testing(locked_release);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
fun subscription_owner_can_approve_active_pass() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let pass = soul_market::pass::mint_subscription(
        object::id(&series),
        caller,
        100,
        10,
        &mut ctx,
    );
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    seal_policy::seal_approve_subscription_for_testing(
        object::id(&series).to_bytes(),
        &pass,
        &series,
        &clock,
        &ctx,
    );

    clock.destroy_for_testing();
    soul_market::pass::destroy_subscription_for_testing(pass);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
fun subscription_agent_can_approve_active_pass() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(@0xA11CE, &mut ctx);
    let mut pass = soul_market::pass::mint_subscription(
        object::id(&series),
        @0xB0B,
        100,
        10,
        &mut ctx,
    );
    *soul_market::pass::subscription_agent_grant_mut(&mut pass) = option::some(caller);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    seal_policy::seal_approve_subscription_for_testing(
        object::id(&series).to_bytes(),
        &pass,
        &series,
        &clock,
        &ctx,
    );

    clock.destroy_for_testing();
    soul_market::pass::destroy_subscription_for_testing(pass);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = seal_policy::ENotAuthorized)]
fun subscription_rejects_unauthorized_caller() {
    let mut ctx = sui::tx_context::dummy();
    let series = soul_market::series::new_series_for_testing(@0xA11CE, &mut ctx);
    let pass = soul_market::pass::mint_subscription(
        object::id(&series),
        @0xB0B,
        100,
        10,
        &mut ctx,
    );
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(100);

    seal_policy::seal_approve_subscription_for_testing(
        object::id(&series).to_bytes(),
        &pass,
        &series,
        &clock,
        &ctx,
    );

    clock.destroy_for_testing();
    soul_market::pass::destroy_subscription_for_testing(pass);
    soul_market::series::destroy_series_for_testing(series);
}

#[test]
#[expected_failure(abort_code = seal_policy::ESubscriptionExpired)]
fun subscription_rejects_expired_pass() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let pass = soul_market::pass::mint_subscription(
        object::id(&series),
        caller,
        100,
        10,
        &mut ctx,
    );
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(101);

    seal_policy::seal_approve_subscription_for_testing(
        object::id(&series).to_bytes(),
        &pass,
        &series,
        &clock,
        &ctx,
    );

    clock.destroy_for_testing();
    soul_market::pass::destroy_subscription_for_testing(pass);
    soul_market::series::destroy_series_for_testing(series);
}
