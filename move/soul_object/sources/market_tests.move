#[test_only]
module soul_object::market_tests;

use std::string;
use soul_object::grant;
use soul_object::market;
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
const RESALE_PRICE: u64 = 2_000;
const PLATFORM_FEE_BPS: u16 = 500;
const ROYALTY_BPS: u16 = 1_000;
const PLATFORM_FEE: u64 = 50;
const ROYALTY_FEE: u64 = 100;
const RESALE_PLATFORM_FEE: u64 = 100;
const RESALE_ROYALTY_FEE: u64 = 200;

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
fun init_for_testing_shares_config_and_policy() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, admin);
        market::init_for_testing(admin, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, admin);
    {
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);

        assert!(market::fee_recipient(&config) == admin, 0);
        assert!(market::platform_fee_bps(&config) == 0, 1);
        assert!(market::royalty_bps(&config) == 0, 2);

        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, admin);
        transfer::public_transfer(policy_cap, admin);
    };

    ts::end(scenario);
}

#[test]
fun purchase_transfers_soul_and_routes_fees() {
    let seller = @0xA11CE;
    let buyer = @0xB0B;
    let platform = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    {
        ts::next_tx(&mut scenario, seller);
        market::init_for_testing(seller, ts::ctx(&mut scenario));
    };

    {
        ts::next_tx(&mut scenario, seller);
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let mut policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
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

        market::update_fee_recipient(&mut config, &admin_cap, platform);
        market::update_platform_fee_bps(
            &mut config,
            &mut policy,
            &policy_cap,
            &admin_cap,
            PLATFORM_FEE_BPS,
        );
        market::update_royalty_bps(
            &mut config,
            &mut policy,
            &policy_cap,
            &admin_cap,
            ROYALTY_BPS,
        );
        market::place_and_list(&mut seller_kiosk, &seller_cap, &policy, soul_obj, SALE_PRICE);

        std::unit_test::destroy(walrus_system);
        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(seller_kiosk, seller);
        transfer::public_transfer(seller_cap, seller);
    };

        ts::next_tx(&mut scenario, buyer);
    {
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut seller_kiosk: kiosk::Kiosk = ts::take_from_address(&scenario, seller);
        let payment: Coin<SUI> = coin::mint_for_testing(SALE_PRICE, ts::ctx(&mut scenario));
        let fees: Coin<SUI> = coin::mint_for_testing(PLATFORM_FEE + ROYALTY_FEE, ts::ctx(&mut scenario));
        let (purchased_soul, remainder) = market::purchase(
            &config,
            &policy,
            &mut seller_kiosk,
            soul_id,
            payment,
            fees,
            ts::ctx(&mut scenario),
        );

        assert!(soul::creator(&purchased_soul) == seller, 3);
        assert!(seller_kiosk.profits_amount() == SALE_PRICE, 4);
        assert!(remainder.value() == 0, 7);

        let blob = soul::destroy_for_testing(purchased_soul);
        blob.burn();
        coin::burn_for_testing(remainder);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_to_address(seller, seller_kiosk);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let platform_fee_coin: Coin<SUI> = ts::take_from_address(&scenario, platform);
        let royalty_fee_coin: Coin<SUI> = ts::take_from_address(&scenario, seller);

        assert!(platform_fee_coin.value() == PLATFORM_FEE, 5);
        assert!(royalty_fee_coin.value() == ROYALTY_FEE, 6);

        coin::burn_for_testing(platform_fee_coin);
        coin::burn_for_testing(royalty_fee_coin);
    };

    ts::end(scenario);
}

#[test]
fun secondary_resale_transfers_same_soul_and_preserves_blob() {
    let seller = @0xA11CE;
    let reseller = @0xB0B;
    let final_buyer = @0xC0DE;
    let platform = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;
    let blob_object_id: ID;

    {
        ts::next_tx(&mut scenario, seller);
        market::init_for_testing(seller, ts::ctx(&mut scenario));
    };

    {
        ts::next_tx(&mut scenario, seller);
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let mut policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
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
        blob_object_id = soul::content_blob_object_id(&soul_obj);

        market::update_fee_recipient(&mut config, &admin_cap, platform);
        market::update_platform_fee_bps(
            &mut config,
            &mut policy,
            &policy_cap,
            &admin_cap,
            PLATFORM_FEE_BPS,
        );
        market::update_royalty_bps(
            &mut config,
            &mut policy,
            &policy_cap,
            &admin_cap,
            ROYALTY_BPS,
        );
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
        ts::next_tx(&mut scenario, reseller);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut seller_kiosk: kiosk::Kiosk = ts::take_from_address(&scenario, seller);
        let payment: Coin<SUI> = coin::mint_for_testing(SALE_PRICE, ts::ctx(&mut scenario));
        let fees: Coin<SUI> = coin::mint_for_testing(PLATFORM_FEE + ROYALTY_FEE, ts::ctx(&mut scenario));
        let (purchased_soul, remainder) = market::purchase(
            &config,
            &policy,
            &mut seller_kiosk,
            soul_id,
            payment,
            fees,
            ts::ctx(&mut scenario),
        );
        let (mut reseller_kiosk, reseller_cap) = kiosk::new(ts::ctx(&mut scenario));
        market::place_and_list(&mut reseller_kiosk, &reseller_cap, &policy, purchased_soul, RESALE_PRICE);

        assert!(reseller_kiosk.profits_amount() == 0, 9);
        coin::burn_for_testing(remainder);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_to_address(seller, seller_kiosk);
        transfer::public_transfer(reseller_kiosk, reseller);
        transfer::public_transfer(reseller_cap, reseller);
    };

    ts::next_tx(&mut scenario, final_buyer);
    {
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut reseller_kiosk: kiosk::Kiosk = ts::take_from_address(&scenario, reseller);
        let payment: Coin<SUI> = coin::mint_for_testing(RESALE_PRICE, ts::ctx(&mut scenario));
        let fees: Coin<SUI> = coin::mint_for_testing(
            RESALE_PLATFORM_FEE + RESALE_ROYALTY_FEE,
            ts::ctx(&mut scenario),
        );
        let (resold_soul, remainder) = market::purchase(
            &config,
            &policy,
            &mut reseller_kiosk,
            soul_id,
            payment,
            fees,
            ts::ctx(&mut scenario),
        );

        assert!(soul::creator(&resold_soul) == seller, 10);
        assert!(soul::content_blob_object_id(&resold_soul) == blob_object_id, 11);
        assert!(reseller_kiosk.profits_amount() == RESALE_PRICE, 12);
        assert!(remainder.value() == 0, 13);

        let blob = soul::destroy_for_testing(resold_soul);
        blob.burn();
        coin::burn_for_testing(remainder);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_to_address(reseller, reseller_kiosk);
    };

    ts::next_tx(&mut scenario, final_buyer);
    {
        let platform_fee_coin_1: Coin<SUI> = ts::take_from_address(&scenario, platform);
        let platform_fee_coin_2: Coin<SUI> = ts::take_from_address(&scenario, platform);
        let royalty_fee_coin_1: Coin<SUI> = ts::take_from_address(&scenario, seller);
        let royalty_fee_coin_2: Coin<SUI> = ts::take_from_address(&scenario, seller);

        assert!(platform_fee_coin_1.value() + platform_fee_coin_2.value() == PLATFORM_FEE + RESALE_PLATFORM_FEE, 14);
        assert!(royalty_fee_coin_1.value() + royalty_fee_coin_2.value() == ROYALTY_FEE + RESALE_ROYALTY_FEE, 15);

        coin::burn_for_testing(platform_fee_coin_1);
        coin::burn_for_testing(platform_fee_coin_2);
        coin::burn_for_testing(royalty_fee_coin_1);
        coin::burn_for_testing(royalty_fee_coin_2);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soul_object::market::EInvalidRecipient)]
fun fee_recipient_cannot_be_zero_address() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, admin);
        market::init_for_testing(admin, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        market::update_fee_recipient(&mut config, &admin_cap, @0x0);
        abort 5
    }
}

#[test]
#[expected_failure(abort_code = soul_object::platform_fee_rule::EFeeTooHigh)]
fun platform_fee_bps_cannot_exceed_maximum() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, admin);
        market::init_for_testing(admin, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let mut policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        market::update_platform_fee_bps(&mut config, &mut policy, &policy_cap, &admin_cap, 10_001);
        abort 4
    }
}

#[test]
#[expected_failure(abort_code = soul_object::royalty_rule::ERoyaltyTooHigh)]
fun royalty_bps_cannot_exceed_maximum() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, admin);
        market::init_for_testing(admin, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let mut policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        market::update_royalty_bps(&mut config, &mut policy, &policy_cap, &admin_cap, 10_001);
        abort 6
    }
}

#[test]
#[expected_failure(abort_code = soul_object::market::EPolicyNotConfigured)]
fun place_and_list_requires_configured_policy_rules() {
    let owner = @0xA11CE;
    let mut scenario = ts::begin(owner);

    {
        let ctx = ts::ctx(&mut scenario);
        let (mut seller_kiosk, seller_cap) = kiosk::new(ctx);
        let (raw_policy, policy_cap) = transfer_policy::new_for_testing<soul::Soul>(ctx);
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

        market::place_and_list(&mut seller_kiosk, &seller_cap, &raw_policy, soul_obj, SALE_PRICE);
        std::unit_test::destroy(walrus_system);
        transfer_policy::destroy_and_withdraw(raw_policy, policy_cap, ctx).burn_for_testing();
        abort 3
    }
}

#[test]
#[expected_failure(abort_code = soul_object::market::EInvalidPrice)]
fun zero_price_listing_is_rejected() {
    let seller = @0xA11CE;
    let platform = @0xCAFE;
    let mut scenario = ts::begin(@0x0);

    {
        ts::next_tx(&mut scenario, seller);
        market::init_for_testing(seller, ts::ctx(&mut scenario));
    };

    {
        ts::next_tx(&mut scenario, seller);
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let mut policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
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

        market::update_fee_recipient(&mut config, &admin_cap, platform);
        market::update_platform_fee_bps(&mut config, &mut policy, &policy_cap, &admin_cap, PLATFORM_FEE_BPS);
        market::update_royalty_bps(&mut config, &mut policy, &policy_cap, &admin_cap, ROYALTY_BPS);
        market::place_and_list(&mut seller_kiosk, &seller_cap, &policy, soul_obj, 0);

        std::unit_test::destroy(walrus_system);
        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(seller_kiosk, seller);
        transfer::public_transfer(seller_cap, seller);
        abort 17
    }
}

#[test]
#[expected_failure(abort_code = soul_object::platform_fee_rule::EInsufficientPayment)]
fun purchase_requires_sufficient_fee_coin() {
    let seller = @0xA11CE;
    let buyer = @0xB0B;
    let platform = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    {
        ts::next_tx(&mut scenario, seller);
        market::init_for_testing(seller, ts::ctx(&mut scenario));
    };

    {
        ts::next_tx(&mut scenario, seller);
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let mut policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
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

        market::update_fee_recipient(&mut config, &admin_cap, platform);
        market::update_platform_fee_bps(&mut config, &mut policy, &policy_cap, &admin_cap, PLATFORM_FEE_BPS);
        market::update_royalty_bps(&mut config, &mut policy, &policy_cap, &admin_cap, ROYALTY_BPS);
        market::place_and_list(&mut seller_kiosk, &seller_cap, &policy, soul_obj, SALE_PRICE);

        std::unit_test::destroy(walrus_system);
        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(seller_kiosk, seller);
        transfer::public_transfer(seller_cap, seller);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut seller_kiosk: kiosk::Kiosk = ts::take_from_address(&scenario, seller);
        let payment: Coin<SUI> = coin::mint_for_testing(SALE_PRICE, ts::ctx(&mut scenario));
        let fees: Coin<SUI> = coin::mint_for_testing(10, ts::ctx(&mut scenario));

        let (purchased_soul, remaining_fee_coin) = market::purchase(
            &config,
            &policy,
            &mut seller_kiosk,
            soul_id,
            payment,
            fees,
            ts::ctx(&mut scenario),
        );
        let blob = soul::destroy_for_testing(purchased_soul);
        blob.burn();
        remaining_fee_coin.burn_for_testing();
        abort 2
    }
}

#[test]
#[expected_failure(abort_code = soul_object::royalty_rule::EInsufficientPayment)]
fun purchase_requires_sufficient_royalty_fee_coin() {
    let seller = @0xA11CE;
    let buyer = @0xB0B;
    let platform = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    {
        ts::next_tx(&mut scenario, seller);
        market::init_for_testing(seller, ts::ctx(&mut scenario));
    };

    {
        ts::next_tx(&mut scenario, seller);
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let mut policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
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

        market::update_fee_recipient(&mut config, &admin_cap, platform);
        market::update_platform_fee_bps(&mut config, &mut policy, &policy_cap, &admin_cap, 0);
        market::update_royalty_bps(&mut config, &mut policy, &policy_cap, &admin_cap, ROYALTY_BPS);
        market::place_and_list(&mut seller_kiosk, &seller_cap, &policy, soul_obj, SALE_PRICE);

        std::unit_test::destroy(walrus_system);
        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(seller_kiosk, seller);
        transfer::public_transfer(seller_cap, seller);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut seller_kiosk: kiosk::Kiosk = ts::take_from_address(&scenario, seller);
        let payment: Coin<SUI> = coin::mint_for_testing(SALE_PRICE, ts::ctx(&mut scenario));
        let fees: Coin<SUI> = coin::mint_for_testing(ROYALTY_FEE - 1, ts::ctx(&mut scenario));

        let (purchased_soul, remaining_fee_coin) = market::purchase(
            &config,
            &policy,
            &mut seller_kiosk,
            soul_id,
            payment,
            fees,
            ts::ctx(&mut scenario),
        );
        let blob = soul::destroy_for_testing(purchased_soul);
        blob.burn();
        remaining_fee_coin.burn_for_testing();
        abort 7
    }
}

#[test]
fun purchase_clears_existing_agent_grant() {
    let seller = @0xA11CE;
    let buyer = @0xB0B;
    let platform = @0xCAFE;
    let agent = @0xD00D;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    {
        ts::next_tx(&mut scenario, seller);
        market::init_for_testing(seller, ts::ctx(&mut scenario));
    };

    {
        ts::next_tx(&mut scenario, seller);
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
        transfer::public_transfer(soul_obj, seller);
        std::unit_test::destroy(walrus_system);
    };

    {
        ts::next_tx(&mut scenario, seller);
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let mut policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        let (mut seller_kiosk, seller_cap) = kiosk::new(ts::ctx(&mut scenario));
        let mut soul_obj: soul::Soul = ts::take_from_sender(&scenario);
        grant::set_agent_grant(&mut soul_obj, agent, ts::ctx(&mut scenario));

        market::update_fee_recipient(&mut config, &admin_cap, platform);
        market::update_platform_fee_bps(
            &mut config,
            &mut policy,
            &policy_cap,
            &admin_cap,
            PLATFORM_FEE_BPS,
        );
        market::update_royalty_bps(
            &mut config,
            &mut policy,
            &policy_cap,
            &admin_cap,
            ROYALTY_BPS,
        );
        market::place_and_list(&mut seller_kiosk, &seller_cap, &policy, soul_obj, SALE_PRICE);

        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(seller_kiosk, seller);
        transfer::public_transfer(seller_cap, seller);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut seller_kiosk: kiosk::Kiosk = ts::take_from_address(&scenario, seller);
        let payment: Coin<SUI> = coin::mint_for_testing(SALE_PRICE, ts::ctx(&mut scenario));
        let fees: Coin<SUI> = coin::mint_for_testing(PLATFORM_FEE + ROYALTY_FEE, ts::ctx(&mut scenario));
        let (purchased_soul, remainder) = market::purchase(
            &config,
            &policy,
            &mut seller_kiosk,
            soul_id,
            payment,
            fees,
            ts::ctx(&mut scenario),
        );

        assert!(soul::agent_grant(&purchased_soul).is_none(), 8);

        let blob = soul::destroy_for_testing(purchased_soul);
        blob.burn();
        coin::burn_for_testing(remainder);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_to_address(seller, seller_kiosk);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let platform_fee_coin: Coin<SUI> = ts::take_from_address(&scenario, platform);
        let royalty_fee_coin: Coin<SUI> = ts::take_from_address(&scenario, seller);
        coin::burn_for_testing(platform_fee_coin);
        coin::burn_for_testing(royalty_fee_coin);
    };

    ts::end(scenario);
}
