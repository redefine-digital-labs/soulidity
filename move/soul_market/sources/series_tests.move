#[test_only]
module soul_market::series_tests;

use std::string;
use soul_market::series;

#[test]
fun publish_release_sets_latest_release() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(123);

    series::publish_release(
        &cap,
        &mut series_obj,
        string::utf8(b"v1"),
        string::utf8(b"encrypted"),
        string::utf8(b"public"),
        b"content-hash",
        &clock,
        &mut ctx,
    );

    assert!(series::series_latest_release_id(&series_obj).is_some(), 0);

    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
fun transfer_author_cap_updates_series_author() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);

    series::transfer_author_cap(cap, &mut series_obj, @0xBEEF);

    assert!(series::series_author(&series_obj) == @0xBEEF, 0);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_TOO_MANY_TAGS)]
fun update_series_metadata_rejects_too_many_tags() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);

    series::update_series_metadata(
        &cap,
        &mut series_obj,
        string::utf8(b"Signal Soul"),
        string::utf8(b"Description"),
        string::utf8(b"Research"),
        vector[
            string::utf8(b"1"),
            string::utf8(b"2"),
            string::utf8(b"3"),
            string::utf8(b"4"),
            string::utf8(b"5"),
            string::utf8(b"6"),
            string::utf8(b"7"),
            string::utf8(b"8"),
            string::utf8(b"9"),
            string::utf8(b"10"),
            string::utf8(b"11"),
        ],
        vector[],
    );

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}
