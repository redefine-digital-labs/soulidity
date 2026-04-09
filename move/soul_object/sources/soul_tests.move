#[test_only]
module soul_object::soul_tests;

use std::string;
use soul_object::soul;
use sui::display;
use sui::package;
use sui::test_scenario::{Self as ts};
use walrus::{blob, encoding, system, test_utils};

const BLOB_ROOT_HASH: u256 = 0xABC;
const BLOB_SIZE: u64 = 5_000_000;
const BLOB_ENCODING: u8 = 1;
const BLOB_EPOCHS_AHEAD: u32 = 3;
const PAYMENT_FROST: u64 = 1_000_000_000;

fun register_test_blob(ctx: &mut TxContext): (system::System, blob::Blob) {
    let mut walrus_system = system::new_for_testing(ctx);
    let mut payment = test_utils::mint_frost(PAYMENT_FROST, ctx);
    let storage_size = encoding::encoded_blob_length(
        BLOB_SIZE,
        BLOB_ENCODING,
        walrus_system.n_shards(),
    );
    let storage = walrus_system.reserve_space(
        storage_size,
        BLOB_EPOCHS_AHEAD,
        &mut payment,
        ctx,
    );
    let blob_id = blob::derive_blob_id(BLOB_ROOT_HASH, BLOB_ENCODING, BLOB_SIZE);
    let registered_blob = walrus_system.register_blob(
        storage,
        blob_id,
        BLOB_ROOT_HASH,
        BLOB_SIZE,
        BLOB_ENCODING,
        false,
        &mut payment,
        ctx,
    );
    payment.burn_for_testing();
    (walrus_system, registered_blob)
}

#[test]
fun mint_wraps_blob_and_preserves_metadata() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
        let (walrus_system, blob) = register_test_blob(ctx);
        let blob_object_id = blob.object_id();

        let soul_obj = soul::mint_for_testing(
            owner,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );

        std::unit_test::assert_eq!(soul::creator(&soul_obj), owner);
        assert!(*soul::name(&soul_obj).as_bytes() == b"Genesis Soul", 1);
        assert!(*soul::description(&soul_obj).as_bytes() == b"Single-owner artifact", 2);
        assert!(*soul::image_url(&soul_obj).as_bytes() == b"https://example.com/soul.png", 3);
        assert!(soul::content_blob_object_id(&soul_obj) == blob_object_id, 4);

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
        std::unit_test::destroy(walrus_system);
    };

    ts::end(scenario);
}

#[test]
fun mint_exposes_optional_metadata_ref() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
        let (walrus_system, blob) = register_test_blob(ctx);
        let metadata_ref = string::utf8(b"walrus://metadata/soul-1");

        let soul_obj = soul::mint_for_testing(
            owner,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::some(metadata_ref),
            blob,
            ctx,
        );

        let stored_metadata_ref = soul::metadata_ref(&soul_obj);
        assert!(stored_metadata_ref.is_some(), 0);
        assert!(
            *stored_metadata_ref.borrow().as_bytes() == b"walrus://metadata/soul-1",
            1,
        );

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
        std::unit_test::destroy(walrus_system);
    };

    ts::end(scenario);
}

#[test]
fun init_for_testing_creates_display_without_leaking_raw_publisher() {
    let publisher_owner = @0xCAFE;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, publisher_owner);
        soul::init_for_testing(publisher_owner, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, publisher_owner);
    {
        let soul_display: display::Display<soul::Soul> = ts::take_from_sender(&scenario);
        let fields = display::fields(&soul_display);
        let name_key = string::utf8(b"name");
        let description_key = string::utf8(b"description");
        let image_key = string::utf8(b"image_url");
        let creator_key = string::utf8(b"creator");

        assert!(fields.contains(&name_key), 0);
        assert!(fields.contains(&description_key), 1);
        assert!(fields.contains(&image_key), 2);
        assert!(fields.contains(&creator_key), 3);
        assert!(*fields[&name_key].as_bytes() == b"{name}", 4);
        assert!(*fields[&description_key].as_bytes() == b"{description}", 5);
        assert!(*fields[&image_key].as_bytes() == b"{image_url}", 6);
        assert!(*fields[&creator_key].as_bytes() == b"{creator}", 7);
        assert!(display::version(&soul_display) == 1, 8);
        assert!(!ts::has_most_recent_for_sender<package::Publisher>(&scenario), 9);

        std::unit_test::destroy(soul_display);
    };

    ts::end(scenario);
}

#[test]
fun clear_allowlist_address_if_present_only_bumps_version_when_needed() {
    let owner = @0xBEEF;
    let allowlisted = @0xABCD;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
        let (walrus_system, blob) = register_test_blob(ctx);
        let mut soul_obj = soul::mint_for_testing(
            owner,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );

        assert!(!soul::clear_allowlist_address_if_present(&mut soul_obj), 0);
        assert!(soul::allowlist_version(&soul_obj) == 0, 1);

        let _ = soul::set_allowlist_address(&mut soul_obj, allowlisted);
        assert!(soul::allowlist_version(&soul_obj) == 1, 2);
        assert!(soul::clear_allowlist_address_if_present(&mut soul_obj), 3);
        assert!(soul::allowlist_version(&soul_obj) == 2, 4);
        assert!(soul::allowlist_address(&soul_obj).is_none(), 5);

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
        std::unit_test::destroy(walrus_system);
    };

    ts::end(scenario);
}
