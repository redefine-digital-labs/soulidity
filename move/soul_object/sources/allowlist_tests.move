#[test_only]
module soul_object::allowlist_tests;

use std::string;
use soul_object::allowlist;
use soul_object::soul;
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
fun current_holder_can_set_and_clear_allowlist_address() {
    let holder = @0xBEEF;
    let allowlisted = @0xCAFE;
    let mut scenario = ts::begin(holder);

    {
        let ctx = ts::ctx(&mut scenario);
        allowlist::init_for_testing(ctx);
        let (walrus_system, blob) = register_test_blob(ctx);
        let soul_obj = soul::mint_for_testing(
            holder,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );
        transfer::public_transfer(soul_obj, holder);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, holder);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let access_cap = allowlist::set_allowlist_address(&mut registry, &mut soul_obj, allowlisted, ts::ctx(&mut scenario));
        let allowlist_address = soul::allowlist_address(&soul_obj);
        assert!(allowlist_address.is_some(), 0);
        assert!(*allowlist_address.borrow() == allowlisted, 1);
        assert!(soul::allowlist_version(&soul_obj) == 1, 2);
        assert!(allowlist::allowlisted(&access_cap) == allowlisted, 3);
        assert!(allowlist::soul_id(&access_cap) == object::id(&soul_obj), 4);
        assert!(allowlist::allowlist_version(&access_cap) == soul::allowlist_version(&soul_obj), 5);

        allowlist::clear_allowlist_address(&mut registry, &mut soul_obj);
        assert!(soul::allowlist_address(&soul_obj).is_none(), 6);
        assert!(soul::allowlist_version(&soul_obj) == 2, 7);

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
        allowlist::destroy_for_testing(access_cap);
        ts::return_shared(registry);
    };

    ts::end(scenario);
}

#[test]
fun current_holder_can_replace_existing_allowlist_address() {
    let creator = @0xBEEF;
    let first_allowlisted = @0xCAFE;
    let second_allowlisted = @0xD00D;
    let mut scenario = ts::begin(creator);

    {
        let ctx = ts::ctx(&mut scenario);
        allowlist::init_for_testing(ctx);
        let (walrus_system, blob) = register_test_blob(ctx);
        let soul_obj = soul::mint_for_testing(
            creator,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );
        transfer::public_transfer(soul_obj, creator);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let first_access_cap =
            allowlist::set_allowlist_address(&mut registry, &mut soul_obj, first_allowlisted, ts::ctx(&mut scenario));
        assert!(soul::allowlist_address(&soul_obj).contains(&first_allowlisted), 3);
        assert!(allowlist::allowlist_version(&first_access_cap) == 1, 4);

        let second_access_cap =
            allowlist::set_allowlist_address(&mut registry, &mut soul_obj, second_allowlisted, ts::ctx(&mut scenario));
        assert!(soul::allowlist_address(&soul_obj).contains(&second_allowlisted), 5);
        assert!(soul::allowlist_version(&soul_obj) == 2, 6);
        assert!(allowlist::allowlist_version(&second_access_cap) == 2, 7);

        allowlist::clear_allowlist_address(&mut registry, &mut soul_obj);
        assert!(soul::allowlist_address(&soul_obj).is_none(), 8);
        assert!(soul::allowlist_version(&soul_obj) == 3, 9);

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
        allowlist::destroy_for_testing(first_access_cap);
        allowlist::destroy_for_testing(second_access_cap);
        ts::return_shared(registry);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soul_object::allowlist::EInvalidAllowlistAddress)]
fun zero_address_cannot_be_allowlisted() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
        allowlist::init_for_testing(ctx);
        let (walrus_system, blob) = register_test_blob(ctx);
        let soul_obj = soul::mint_for_testing(
            owner,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );
        transfer::public_transfer(soul_obj, owner);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let access_cap = allowlist::set_allowlist_address(&mut registry, &mut soul_obj, @0x0, ts::ctx(&mut scenario));
        allowlist::destroy_for_testing(access_cap);
        abort 8
    }
}

#[test]
#[expected_failure(abort_code = soul_object::allowlist::ESelfAllowlistAddress)]
fun current_holder_cannot_allowlist_self() {
    let holder = @0xBEEF;
    let mut scenario = ts::begin(holder);

    {
        let ctx = ts::ctx(&mut scenario);
        allowlist::init_for_testing(ctx);
        let (walrus_system, blob) = register_test_blob(ctx);
        let soul_obj = soul::mint_for_testing(
            holder,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );
        transfer::public_transfer(soul_obj, holder);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, holder);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let access_cap = allowlist::set_allowlist_address(&mut registry, &mut soul_obj, holder, ts::ctx(&mut scenario));
        allowlist::destroy_for_testing(access_cap);
        abort 7
    }
}

#[test]
#[expected_failure(abort_code = soul_object::allowlist::ENoAllowlistAddress)]
fun clear_requires_existing_allowlist_address() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
        allowlist::init_for_testing(ctx);
        let (walrus_system, blob) = register_test_blob(ctx);
        let soul_obj = soul::mint_for_testing(
            owner,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ctx,
        );
        transfer::public_transfer(soul_obj, owner);
        std::unit_test::destroy(walrus_system);
    };

    ts::next_tx(&mut scenario, owner);
    {
        let mut registry: allowlist::AllowlistRegistry = ts::take_shared(&scenario);
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        allowlist::clear_allowlist_address(&mut registry, &mut soul_obj);
        abort 6
    }
}
