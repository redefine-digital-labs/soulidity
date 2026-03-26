#[test_only]
module soul_object::seal_policy_tests;

use std::string;
use soul_object::grant;
use soul_object::market;
use soul_object::seal_policy;
use soul_object::soul;
use sui::coin::{Self as coin, Coin};
use sui::kiosk;
use sui::sui::SUI;
use sui::test_scenario::{Self as ts};
use sui::transfer_policy;
use walrus::{blob, encoding, system, test_utils};

const BLOB_ROOT_HASH: u256 = 0xABC;
const BLOB_SIZE: u64 = 5_000_000;
const BLOB_ENCODING: u8 = 1;
const BLOB_EPOCHS_AHEAD: u32 = 3;
const PAYMENT_FROST: u64 = 1_000_000_000;
const SALE_PRICE: u64 = 1_000;

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

fun soul_document_id_with_version(soul_obj: &soul::Soul, version: u8): vector<u8> {
    let mut id = b"soul-seal:";
    let soul_id_bytes = object::id(soul_obj).to_bytes();
    let mut soul_id_index: u64 = 0;
    id.push_back(version);
    while (soul_id_index < soul_id_bytes.length()) {
        id.push_back(soul_id_bytes[soul_id_index]);
        soul_id_index = soul_id_index + 1;
    };
    let mut i: u64 = 0;
    while (i < 16) {
        id.push_back(0x7A);
        i = i + 1;
    };
    id
}

fun soul_document_id(soul_obj: &soul::Soul): vector<u8> {
    soul_document_id_with_version(soul_obj, 0x01)
}

#[test]
fun owner_is_authorized_for_matching_document_id() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
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
        let soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let document_id = soul_document_id(&soul_obj);
        seal_policy::seal_approve_for_testing(document_id, &soul_obj, ts::ctx(&mut scenario));

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
    };

    ts::end(scenario);
}

#[test]
fun granted_agent_is_authorized() {
    let owner = @0xBEEF;
    let agent = @0xCAFE;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
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
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        grant::set_agent_grant(&mut soul_obj, agent, ts::ctx(&mut scenario));
        transfer::public_transfer(soul_obj, owner);
    };

    ts::next_tx(&mut scenario, agent);
    {
        let soul_obj: soul::Soul = ts::take_from_address(&scenario, owner);
        let document_id = soul_document_id(&soul_obj);
        seal_policy::seal_approve_for_testing(document_id, &soul_obj, ts::ctx(&mut scenario));

        let blob = soul::destroy_for_testing(soul_obj);
        blob.burn();
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EIdPrefixMismatch)]
fun wrong_document_prefix_is_rejected() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
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
        let soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let mut document_id = b"wrong-seal:";
        let soul_id_bytes = object::id(&soul_obj).to_bytes();
        let mut i: u64 = 0;
        document_id.push_back(0x01);
        while (i < soul_id_bytes.length()) {
            document_id.push_back(soul_id_bytes[i]);
            i = i + 1;
        };
        i = 0;
        while (i < 48) {
            document_id.push_back(0xAA);
            i = i + 1;
        };

        seal_policy::seal_approve_for_testing(document_id, &soul_obj, ts::ctx(&mut scenario));
        abort 9
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EIdPrefixMismatch)]
fun wrong_document_version_is_rejected() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
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
        let soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let document_id = soul_document_id_with_version(&soul_obj, 0x02);

        seal_policy::seal_approve_for_testing(document_id, &soul_obj, ts::ctx(&mut scenario));
        abort 10
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::EDocumentIdTooShort)]
fun document_id_must_include_nonce_suffix() {
    let owner = @0xBEEF;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
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
        let soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        let document_id = object::id(&soul_obj).to_bytes();
        seal_policy::seal_approve_for_testing(document_id, &soul_obj, ts::ctx(&mut scenario));
        abort 7
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::ENotAuthorized)]
fun non_owner_without_grant_is_rejected() {
    let owner = @0xBEEF;
    let attacker = @0xBAD;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
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

    ts::next_tx(&mut scenario, attacker);
    {
        let soul_obj: soul::Soul = ts::take_from_address(&scenario, owner);
        let document_id = soul_document_id(&soul_obj);
        seal_policy::seal_approve_for_testing(document_id, &soul_obj, ts::ctx(&mut scenario));
        abort 6
    }
}

#[test]
#[expected_failure(abort_code = soul_object::seal_policy::ENotAuthorized)]
fun previous_owner_loses_access_after_market_purchase() {
    let seller = @0xA11CE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    {
        ts::next_tx(&mut scenario, seller);
        market::init_for_testing(seller, ts::ctx(&mut scenario));
    };

    {
        ts::next_tx(&mut scenario, seller);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        let (mut seller_kiosk, seller_cap) = kiosk::new(ts::ctx(&mut scenario));
        let (walrus_system, blob) = register_test_blob(ts::ctx(&mut scenario));
        let soul_obj = soul::mint_for_testing(
            seller,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            blob,
            ts::ctx(&mut scenario),
        );
        soul_id = object::id(&soul_obj);

        market::place_and_list(&mut seller_kiosk, &seller_cap, &policy, soul_obj, SALE_PRICE);

        std::unit_test::destroy(walrus_system);
        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(seller_kiosk, seller);
        transfer::public_transfer(seller_cap, seller);
    };

    {
        ts::next_tx(&mut scenario, buyer);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut seller_kiosk: kiosk::Kiosk = ts::take_from_address(&scenario, seller);
        let payment: Coin<SUI> = coin::mint_for_testing(SALE_PRICE, ts::ctx(&mut scenario));
        let fees: Coin<SUI> = coin::mint_for_testing(1, ts::ctx(&mut scenario));
        let (purchased_soul, remainder) = market::purchase(
            &config,
            &policy,
            &mut seller_kiosk,
            soul_id,
            payment,
            fees,
            ts::ctx(&mut scenario),
        );

        coin::burn_for_testing(remainder);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_to_address(seller, seller_kiosk);
        transfer::public_transfer(purchased_soul, buyer);
    };

    ts::next_tx(&mut scenario, seller);
    {
        let soul_obj: soul::Soul = ts::take_from_address(&scenario, buyer);
        let document_id = soul_document_id(&soul_obj);
        seal_policy::seal_approve_for_testing(document_id, &soul_obj, ts::ctx(&mut scenario));
        abort 8
    }
}
