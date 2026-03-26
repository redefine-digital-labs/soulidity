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

fun subscription_document_id(series: &soul_market::series::SoulSeries): vector<u8> {
    let mut document_id = object::id(series).to_bytes();
    append_test_nonce(&mut document_id);
    document_id
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
        subscription_document_id(&series),
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
        subscription_document_id(&series),
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
#[expected_failure(abort_code = seal_policy::EIdPrefixMismatch)]
fun subscription_rejects_invalid_document_prefix() {
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
        vector[1],
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
#[expected_failure(abort_code = seal_policy::EDocumentReleaseMismatch)]
fun subscription_rejects_document_id_without_nonce_suffix() {
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
        subscription_document_id(&series),
        &pass,
        &series,
        &clock,
        &ctx,
    );

    clock.destroy_for_testing();
    soul_market::pass::destroy_subscription_for_testing(pass);
    soul_market::series::destroy_series_for_testing(series);
}

// === L5: Previously untested seal_policy branches ===

#[test]
#[expected_failure(abort_code = seal_policy::ESeriesMismatch)]
fun perpetual_rejects_pass_from_different_series() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series_a = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let series_b = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let release_a = soul_market::series::new_release_for_testing(&series_a, b"v1", &mut ctx);
    let pass = soul_market::pass::mint_perpetual(
        object::id(&series_a), object::id(&release_a), caller, &mut ctx,
    );
    let document_id = document_id_for_release(&series_b, &release_a);

    seal_policy::seal_approve_perpetual_for_testing(
        document_id, &pass, &release_a, &series_b, &ctx,
    );

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(release_a);
    soul_market::series::destroy_series_for_testing(series_a);
    soul_market::series::destroy_series_for_testing(series_b);
}

#[test]
#[expected_failure(abort_code = seal_policy::ESeriesMismatch)]
fun subscription_rejects_pass_from_different_series() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series_a = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let series_b = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let pass = soul_market::pass::mint_subscription(
        object::id(&series_a), caller, 100, 10, &mut ctx,
    );
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(50);

    seal_policy::seal_approve_subscription_for_testing(
        subscription_document_id(&series_b), &pass, &series_b, &clock, &ctx,
    );

    clock.destroy_for_testing();
    soul_market::pass::destroy_subscription_for_testing(pass);
    soul_market::series::destroy_series_for_testing(series_a);
    soul_market::series::destroy_series_for_testing(series_b);
}

#[test]
#[expected_failure(abort_code = seal_policy::EReleaseMismatch)]
fun perpetual_rejects_pass_locked_to_different_release() {
    let mut ctx = sui::tx_context::dummy();
    let caller = ctx.sender();
    let series = soul_market::series::new_series_for_testing(caller, &mut ctx);
    let release_a = soul_market::series::new_release_for_testing(&series, b"v1", &mut ctx);
    let release_b = soul_market::series::new_release_for_testing(&series, b"v2", &mut ctx);
    let pass = soul_market::pass::mint_perpetual(
        object::id(&series), object::id(&release_a), caller, &mut ctx,
    );
    let document_id = document_id_for_release(&series, &release_b);

    seal_policy::seal_approve_perpetual_for_testing(
        document_id, &pass, &release_b, &series, &ctx,
    );

    soul_market::pass::destroy_perpetual_for_testing(pass);
    soul_market::series::destroy_release_for_testing(release_a);
    soul_market::series::destroy_release_for_testing(release_b);
    soul_market::series::destroy_series_for_testing(series);
}
