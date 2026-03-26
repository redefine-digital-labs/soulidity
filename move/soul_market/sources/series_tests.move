#[test_only]
module soul_market::series_tests;

use std::string;
use soul_market::series;
use sui::test_scenario::{Self as ts};

#[test]
fun create_series_entry_shares_series_and_transfers_author_cap_to_sender() {
    let author = @0xBEEF;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, author);
        series::create_series_entry(
            string::utf8(b"Signal Soul"),
            string::utf8(b"Description"),
            string::utf8(b"Research"),
            vector[string::utf8(b"alpha"), string::utf8(b"beta")],
            vector[string::utf8(b"https://example.com/cover.png")],
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, author);
    {
        let series_obj: series::SoulSeries = ts::take_shared(&scenario);
        let cap: series::AuthorCap = ts::take_from_sender(&scenario);

        assert!(series::series_author(&series_obj) == author, 0);
        assert!(series::author_cap_series_id(&cap) == series::series_id(&series_obj), 1);

        series::destroy_author_cap_for_testing(cap);
        series::destroy_series_for_testing(series_obj);
    };

    ts::end(scenario);
}

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
#[expected_failure(abort_code = series::E_RELEASE_VERSION_TOO_LONG)]
fun publish_release_rejects_too_long_version() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(123);

    series::publish_release(
        &cap,
        &mut series_obj,
        string::utf8(b"12345678901234567890123456789012345678901234567890123456789012345"),
        string::utf8(b"encrypted"),
        string::utf8(b"public"),
        b"content-hash",
        &clock,
        &mut ctx,
    );

    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_RELEASE_VERSION_EMPTY)]
fun publish_release_rejects_empty_version() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(123);

    series::publish_release(
        &cap,
        &mut series_obj,
        string::utf8(b""),
        string::utf8(b"encrypted"),
        string::utf8(b"public"),
        b"content-hash",
        &clock,
        &mut ctx,
    );

    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_RELEASE_BLOB_ID_EMPTY)]
fun publish_release_rejects_empty_encrypted_blob_id() {
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
        string::utf8(b""),
        string::utf8(b"public"),
        b"content-hash",
        &clock,
        &mut ctx,
    );

    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_RELEASE_PUBLIC_METADATA_ID_EMPTY)]
fun publish_release_rejects_empty_public_metadata_id() {
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
        string::utf8(b""),
        b"content-hash",
        &clock,
        &mut ctx,
    );

    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_RELEASE_CONTENT_HASH_TOO_LONG)]
fun publish_release_rejects_too_long_content_hash() {
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
        b"01234567890123456789012345678901234567890123456789012345678901234",
        &clock,
        &mut ctx,
    );

    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_RELEASE_CONTENT_HASH_EMPTY)]
fun publish_release_rejects_empty_content_hash() {
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
        b"",
        &clock,
        &mut ctx,
    );

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

    series::transfer_author_cap(cap, &mut series_obj, @0xBEEF, &ctx);

    assert!(series::series_author(&series_obj) == @0xBEEF, 0);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_INVALID_RECIPIENT)]
fun transfer_author_cap_rejects_zero_address() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);

    series::transfer_author_cap(cap, &mut series_obj, @0x0, &ctx);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_SELF_TRANSFER)]
fun transfer_author_cap_rejects_self_transfer() {
    let author = @0xBEEF;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, author);
        series::create_series_entry(
            string::utf8(b"Signal Soul"),
            string::utf8(b"Description"),
            string::utf8(b"Research"),
            vector[],
            vector[],
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, author);
    {
        let mut series_obj: series::SoulSeries = ts::take_shared(&scenario);
        let cap: series::AuthorCap = ts::take_from_sender(&scenario);

        series::transfer_author_cap(cap, &mut series_obj, author, ts::ctx(&mut scenario));
        series::destroy_series_for_testing(series_obj);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = series::E_NOT_AUTHOR)]
fun transfer_author_cap_requires_sender_to_match_series_author() {
    let mut ctx = sui::tx_context::dummy();
    let mut series_obj = series::new_series_for_testing(@0xCAFE, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);

    series::transfer_author_cap(cap, &mut series_obj, @0xBEEF, &ctx);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_NOT_AUTHOR)]
fun publish_release_requires_sender_to_match_series_author() {
    let mut ctx = sui::tx_context::dummy();
    let mut series_obj = series::new_series_for_testing(@0xCAFE, &mut ctx);
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

    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_NOT_AUTHOR)]
fun update_series_metadata_requires_sender_to_match_series_author() {
    let mut ctx = sui::tx_context::dummy();
    let mut series_obj = series::new_series_for_testing(@0xCAFE, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);

    series::update_series_metadata(
        &cap,
        &mut series_obj,
        string::utf8(b"Signal Soul"),
        string::utf8(b"Description"),
        string::utf8(b"Research"),
        vector[string::utf8(b"1")],
        vector[],
        &ctx,
    );

    series::destroy_author_cap_for_testing(cap);
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
        &ctx,
    );

    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

// === L5: Previously untested input validation branches ===

#[test]
#[expected_failure(abort_code = series::E_NAME_EMPTY)]
fun create_series_rejects_empty_name() {
    let mut ctx = sui::tx_context::dummy();
    series::create_series_entry(
        string::utf8(b""),
        string::utf8(b"Description"),
        string::utf8(b"Research"),
        vector[], vector[], &mut ctx,
    );
}

#[test]
#[expected_failure(abort_code = series::E_CATEGORY_EMPTY)]
fun create_series_rejects_empty_category() {
    let mut ctx = sui::tx_context::dummy();
    series::create_series_entry(
        string::utf8(b"Name"),
        string::utf8(b"Description"),
        string::utf8(b""),
        vector[], vector[], &mut ctx,
    );
}

#[test]
#[expected_failure(abort_code = series::E_NAME_TOO_LONG)]
fun create_series_rejects_name_too_long() {
    let mut ctx = sui::tx_context::dummy();
    let mut name_bytes = vector[];
    let mut i = 0;
    while (i < 257) { name_bytes.push_back(0x61); i = i + 1; };
    series::create_series_entry(
        string::utf8(name_bytes),
        string::utf8(b"Description"),
        string::utf8(b"Research"),
        vector[], vector[], &mut ctx,
    );
}

#[test]
#[expected_failure(abort_code = series::E_DESCRIPTION_TOO_LONG)]
fun create_series_rejects_description_too_long() {
    let mut ctx = sui::tx_context::dummy();
    let mut desc_bytes = vector[];
    let mut i = 0;
    while (i < 4097) { desc_bytes.push_back(0x61); i = i + 1; };
    series::create_series_entry(
        string::utf8(b"Name"),
        string::utf8(desc_bytes),
        string::utf8(b"Research"),
        vector[], vector[], &mut ctx,
    );
}

#[test]
#[expected_failure(abort_code = series::E_CATEGORY_TOO_LONG)]
fun create_series_rejects_category_too_long() {
    let mut ctx = sui::tx_context::dummy();
    let mut cat_bytes = vector[];
    let mut i = 0;
    while (i < 65) { cat_bytes.push_back(0x61); i = i + 1; };
    series::create_series_entry(
        string::utf8(b"Name"),
        string::utf8(b"Description"),
        string::utf8(cat_bytes),
        vector[], vector[], &mut ctx,
    );
}

#[test]
#[expected_failure(abort_code = series::E_TAG_TOO_LONG)]
fun update_series_metadata_rejects_tag_too_long() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);
    let mut tag_bytes = vector[];
    let mut i = 0;
    while (i < 65) { tag_bytes.push_back(0x61); i = i + 1; };
    series::update_series_metadata(
        &cap, &mut series_obj,
        string::utf8(b"Name"), string::utf8(b"Desc"), string::utf8(b"Cat"),
        vector[string::utf8(tag_bytes)], vector[], &ctx,
    );
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_TOO_MANY_PREVIEW_IMAGES)]
fun update_series_metadata_rejects_too_many_preview_images() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);
    series::update_series_metadata(
        &cap, &mut series_obj,
        string::utf8(b"Name"), string::utf8(b"Desc"), string::utf8(b"Cat"),
        vector[],
        vector[
            string::utf8(b"a"), string::utf8(b"b"), string::utf8(b"c"),
            string::utf8(b"d"), string::utf8(b"e"), string::utf8(b"f"),
            string::utf8(b"g"), string::utf8(b"h"), string::utf8(b"i"),
            string::utf8(b"j"), string::utf8(b"k"),
        ],
        &ctx,
    );
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_PREVIEW_IMAGE_TOO_LONG)]
fun update_series_metadata_rejects_preview_image_too_long() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);
    let mut img_bytes = vector[];
    let mut i = 0;
    while (i < 513) { img_bytes.push_back(0x61); i = i + 1; };
    series::update_series_metadata(
        &cap, &mut series_obj,
        string::utf8(b"Name"), string::utf8(b"Desc"), string::utf8(b"Cat"),
        vector[], vector[string::utf8(img_bytes)], &ctx,
    );
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_PLAN_TYPE_NOT_ACTIVE)]
fun remove_active_plan_rejects_when_not_active() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);

    series::remove_active_plan(&mut series_obj, 0);

    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_DESCRIPTION_EMPTY)]
fun create_series_rejects_empty_description() {
    let mut ctx = sui::tx_context::dummy();
    series::create_series_entry(
        string::utf8(b"Name"),
        string::utf8(b""),
        string::utf8(b"Research"),
        vector[], vector[], &mut ctx,
    );
}

#[test]
#[expected_failure(abort_code = series::E_RELEASE_BLOB_ID_TOO_LONG)]
fun publish_release_rejects_too_long_encrypted_blob_id() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(1);
    let mut blob_bytes = vector[];
    let mut i = 0;
    while (i < 257) { blob_bytes.push_back(0x61); i = i + 1; };
    series::publish_release(
        &cap, &mut series_obj,
        string::utf8(b"v1"), string::utf8(blob_bytes),
        string::utf8(b"public"), b"hash", &clock, &mut ctx,
    );
    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}

#[test]
#[expected_failure(abort_code = series::E_RELEASE_PUBLIC_METADATA_ID_TOO_LONG)]
fun publish_release_rejects_too_long_public_metadata_id() {
    let mut ctx = sui::tx_context::dummy();
    let author = ctx.sender();
    let mut series_obj = series::new_series_for_testing(author, &mut ctx);
    let cap = series::new_author_cap_for_testing(&series_obj, &mut ctx);
    let mut clock = sui::clock::create_for_testing(&mut ctx);
    clock.set_for_testing(1);
    let mut meta_bytes = vector[];
    let mut i = 0;
    while (i < 257) { meta_bytes.push_back(0x61); i = i + 1; };
    series::publish_release(
        &cap, &mut series_obj,
        string::utf8(b"v1"), string::utf8(b"encrypted"),
        string::utf8(meta_bytes), b"hash", &clock, &mut ctx,
    );
    clock.destroy_for_testing();
    series::destroy_author_cap_for_testing(cap);
    series::destroy_series_for_testing(series_obj);
}
