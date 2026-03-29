#[test_only]
module soul_object::market_tests;

use std::string;
use kiosk::kiosk_lock_rule;
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use kiosk::personal_kiosk_rule;
use soul_object::allowlist::{Self as allowlist, AllowlistRegistry};
use soul_object::market;
use soul_object::soul::{Self as soul};
use sui::coin::TreasuryCap;
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::test_scenario::{Self as ts};
use sui::transfer_policy;
use usdc::usdc::{Self as test_usdc, USDC};
use walrus::{blob, encoding, system, test_utils};

const BLOB_ROOT_HASH: u256 = 0xABC;
const BLOB_SIZE: u64 = 5_000_000;
const BLOB_ENCODING: u8 = 1;
const BLOB_EPOCHS_AHEAD: u32 = 3;
const PAYMENT_FROST: u64 = 1_000_000_000;
const SALE_PRICE: u64 = 1_000_000;
const RELIST_PRICE: u64 = 2_000_000;
const PLATFORM_FEE_BPS: u16 = 250;
const CREATOR_ROYALTY_BPS: u16 = 1_000;

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

fun init_market_for_testing(scenario: &mut ts::Scenario, admin: address) {
    ts::next_tx(scenario, admin);
    {
        market::init_for_testing(admin, ts::ctx(scenario));
        allowlist::init_for_testing(ts::ctx(scenario));
        test_usdc::init_for_testing(admin, ts::ctx(scenario));
    };
}

#[test]
fun init_for_testing_adds_lock_and_personal_kiosk_rules() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    init_market_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        let treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(&scenario);

        assert!(transfer_policy::has_rule<soul::Soul, kiosk_lock_rule::Rule>(&policy), 0);
        assert!(transfer_policy::has_rule<soul::Soul, personal_kiosk_rule::Rule>(&policy), 1);

        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, admin);
        transfer::public_transfer(policy_cap, admin);
        transfer::public_transfer(treasury_cap, admin);
    };

    ts::end(scenario);
}

#[test]
fun admin_can_update_platform_fee_and_quote_purchase() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    init_market_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        let treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(&scenario);

        market::update_platform_fee_bps(&mut config, &admin_cap, PLATFORM_FEE_BPS);
        assert!(market::platform_fee_bps(&config) == PLATFORM_FEE_BPS, 0);

        let (platform_fee, price, creator_royalty, total) =
            market::quote_purchase(&config, 1_000, CREATOR_ROYALTY_BPS);
        assert!(platform_fee == 25, 1);
        assert!(price == 1_000, 2);
        assert!(creator_royalty == 100, 3);
        assert!(total == 1_125, 4);

        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, admin);
        transfer::public_transfer(policy_cap, admin);
        transfer::public_transfer(treasury_cap, admin);
    };

    ts::end(scenario);
}

#[test]
fun list_fixed_price_clears_allowlist_and_marks_listing_active() {
    let admin = @0xA11CE;
    let seller = @0xB0B;
    let allowlisted = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;
    let seller_kiosk_id: ID;

    init_market_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, seller);
    {
        let mut registry: AllowlistRegistry = ts::take_shared(&scenario);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let (mut seller_kiosk, seller_kiosk_cap) = kiosk::new(ts::ctx(&mut scenario));
        seller_kiosk_id = object::id(&seller_kiosk);
        let seller_personal_cap = personal_kiosk::new(&mut seller_kiosk, seller_kiosk_cap, ts::ctx(&mut scenario));
        let (walrus_system, content_blob) = register_test_blob(ts::ctx(&mut scenario));
        let soul_obj = soul::mint_for_testing_with_creator_royalty(
            seller,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            content_blob,
            CREATOR_ROYALTY_BPS,
            ts::ctx(&mut scenario),
        );
        soul_id = object::id(&soul_obj);

        kiosk::place(&mut seller_kiosk, personal_kiosk::borrow(&seller_personal_cap), soul_obj);
        let allowlist_cap = allowlist::set_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut seller_kiosk,
            &seller_personal_cap,
            soul_id,
            allowlisted,
            ts::ctx(&mut scenario),
        );
        allowlist::destroy_for_testing(allowlist_cap);
        market::list_fixed_price(
            &config,
            &mut registry,
            &mut seller_kiosk,
            &seller_personal_cap,
            soul_id,
            SALE_PRICE,
            ts::ctx(&mut scenario),
        );

        std::unit_test::destroy(walrus_system);
        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_share_object(seller_kiosk);
        personal_kiosk::transfer_to_sender(seller_personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, seller);
    {
        let registry: AllowlistRegistry = ts::take_shared(&scenario);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let listing: market::FixedPriceListing = ts::take_shared(&scenario);
        let seller_kiosk: Kiosk = ts::take_shared(&scenario);

        assert!(market::listing_is_active(&listing), 0);
        assert!(market::listing_soul_id(&listing) == soul_id, 1);
        assert!(market::listing_seller_kiosk_id(&listing) == seller_kiosk_id, 2);
        assert!(market::listing_price(&listing) == SALE_PRICE, 3);
        assert!(market::listing_creator_royalty_bps(&listing) == CREATOR_ROYALTY_BPS, 4);
        assert!(allowlist::registry_version(&registry, soul_id) == 2, 5);
        assert!(kiosk::is_listed_exclusively(&seller_kiosk, soul_id), 6);

        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_shared(listing);
        ts::return_shared(seller_kiosk);
    };

    ts::end(scenario);
}

#[test]
fun cancel_listing_keeps_soul_in_seller_personal_kiosk() {
    let admin = @0xA11CE;
    let seller = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    init_market_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, seller);
    {
        let mut registry: AllowlistRegistry = ts::take_shared(&scenario);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let (mut seller_kiosk, seller_kiosk_cap) = kiosk::new(ts::ctx(&mut scenario));
        let seller_personal_cap = personal_kiosk::new(&mut seller_kiosk, seller_kiosk_cap, ts::ctx(&mut scenario));
        let (walrus_system, content_blob) = register_test_blob(ts::ctx(&mut scenario));
        let soul_obj = soul::mint_for_testing(
            seller,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            content_blob,
            ts::ctx(&mut scenario),
        );
        let soul_id = object::id(&soul_obj);

        kiosk::place(&mut seller_kiosk, personal_kiosk::borrow(&seller_personal_cap), soul_obj);
        let mut listing = market::list_fixed_price_for_testing(
            &mut registry,
            &mut seller_kiosk,
            &seller_personal_cap,
            soul_id,
            RELIST_PRICE,
            ts::ctx(&mut scenario),
        );
        market::cancel_listing(&mut seller_kiosk, &seller_personal_cap, &mut listing);

        assert!(!market::listing_is_active(&listing), 0);
        assert!(kiosk::has_item(&seller_kiosk, soul_id), 1);
        assert!(!kiosk::is_listed_exclusively(&seller_kiosk, soul_id), 2);

        std::unit_test::destroy(walrus_system);
        market::destroy_listing_for_testing(listing);
        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_share_object(seller_kiosk);
        personal_kiosk::transfer_to_sender(seller_personal_cap, ts::ctx(&mut scenario));
    };

    ts::end(scenario);
}

#[test]
fun buy_fixed_price_moves_soul_into_buyer_personal_kiosk_and_clears_allowlist() {
    let seller = @0xA11CE;
    let buyer = @0xB0B;
    let allowlisted = @0xCAFE;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;
    let seller_kiosk_id: ID;

    init_market_for_testing(&mut scenario, seller);

    ts::next_tx(&mut scenario, seller);
    {
        let mut config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        let treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(&scenario);

        market::update_platform_fee_bps(&mut config, &admin_cap, PLATFORM_FEE_BPS);

        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(treasury_cap, seller);
    };

    ts::next_tx(&mut scenario, seller);
    {
        let mut registry: AllowlistRegistry = ts::take_shared(&scenario);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        let treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(&scenario);
        let (mut seller_kiosk, seller_kiosk_cap) = kiosk::new(ts::ctx(&mut scenario));
        seller_kiosk_id = object::id(&seller_kiosk);
        let seller_personal_cap = personal_kiosk::new(&mut seller_kiosk, seller_kiosk_cap, ts::ctx(&mut scenario));
        let (walrus_system, content_blob) = register_test_blob(ts::ctx(&mut scenario));
        let soul_obj = soul::mint_for_testing_with_creator_royalty(
            seller,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            content_blob,
            CREATOR_ROYALTY_BPS,
            ts::ctx(&mut scenario),
        );
        soul_id = object::id(&soul_obj);

        kiosk::place(&mut seller_kiosk, personal_kiosk::borrow(&seller_personal_cap), soul_obj);
        let allowlist_cap = allowlist::set_allowlist_address_via_personal_kiosk(
            &mut registry,
            &mut seller_kiosk,
            &seller_personal_cap,
            soul_id,
            allowlisted,
            ts::ctx(&mut scenario),
        );
        allowlist::destroy_for_testing(allowlist_cap);
        market::list_fixed_price(
            &config,
            &mut registry,
            &mut seller_kiosk,
            &seller_personal_cap,
            soul_id,
            SALE_PRICE,
            ts::ctx(&mut scenario),
        );

        std::unit_test::destroy(walrus_system);
        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(treasury_cap, seller);
        transfer::public_share_object(seller_kiosk);
        personal_kiosk::transfer_to_sender(seller_personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let mut registry: AllowlistRegistry = ts::take_shared(&scenario);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut listing: market::FixedPriceListing = ts::take_shared(&scenario);
        let mut seller_kiosk: Kiosk = ts::take_shared(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_address(&scenario, seller);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_address(&scenario, seller);
        let mut treasury_cap: TreasuryCap<USDC> = ts::take_from_address(&scenario, seller);
        let (_, _, _, total) = market::quote_fixed_price(&config, &listing);
        let payment = test_usdc::mint_for_testing(&mut treasury_cap, total, ts::ctx(&mut scenario));

        market::buy_fixed_price(
            &config,
            &policy,
            &mut registry,
            &mut seller_kiosk,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_shared(listing);
        ts::return_shared(seller_kiosk);
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(treasury_cap, seller);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let registry: AllowlistRegistry = ts::take_shared(&scenario);
        let config: market::MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let listing: market::FixedPriceListing = ts::take_shared(&scenario);
        let first_kiosk: Kiosk = ts::take_shared(&scenario);
        let second_kiosk: Kiosk = ts::take_shared(&scenario);
        let buyer_personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let admin_cap: market::MarketAdminCap = ts::take_from_address(&scenario, seller);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_address(&scenario, seller);
        let treasury_cap: TreasuryCap<USDC> = ts::take_from_address(&scenario, seller);

        let (seller_kiosk, buyer_kiosk) =
            if (object::id(&first_kiosk) == seller_kiosk_id) {
                (&first_kiosk, &second_kiosk)
            } else {
                (&second_kiosk, &first_kiosk)
            };
        let purchased_soul = kiosk::borrow<soul::Soul>(
            buyer_kiosk,
            personal_kiosk::borrow(&buyer_personal_cap),
            soul_id,
        );

        assert!(!market::listing_is_active(&listing), 0);
        assert!(!kiosk::has_item(seller_kiosk, soul_id), 1);
        assert!(kiosk::has_item(buyer_kiosk, soul_id), 2);
        assert!(kiosk::is_locked(buyer_kiosk, soul_id), 3);
        assert!(personal_kiosk::owner(buyer_kiosk) == buyer, 4);
        assert!(soul::allowlist_address(purchased_soul).is_none(), 5);
        assert!(soul::allowlist_version(purchased_soul) == 2, 6);
        assert!(allowlist::registry_version(&registry, soul_id) == 2, 7);

        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_shared(listing);
        ts::return_shared(first_kiosk);
        ts::return_shared(second_kiosk);
        personal_kiosk::transfer_to_sender(buyer_personal_cap, ts::ctx(&mut scenario));
        transfer::public_transfer(admin_cap, seller);
        transfer::public_transfer(policy_cap, seller);
        transfer::public_transfer(treasury_cap, seller);
    };

    ts::end(scenario);
}
