#[test_only]
module soul_market_adapter::market_tests;

use std::string;
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use soul_market_adapter::market;
use soul_object::allowlist::{Self as allowlist, AllowlistRegistry};
use soul_object::market::{Self as core_market, FixedPriceListing, MarketAdminCap, MarketConfig};
use soul_object::soul::{Self as soul, SoulPackageAuthority};
use sui::coin::TreasuryCap;
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::test_scenario::{Self as ts};
use sui::transfer_policy;
use unft_standard::unft_standard::{Self as unft, NftCollection, NftRegistry};
use usdc::usdc::{Self as test_usdc, USDC};
use walrus::{blob, encoding, system, test_utils};

const BLOB_ROOT_HASH: u256 = 0xABC;
const BLOB_SIZE: u64 = 5_000_000;
const BLOB_ENCODING: u8 = 1;
const BLOB_EPOCHS_AHEAD: u32 = 3;
const PAYMENT_FROST: u64 = 1_000_000_000;
const SALE_PRICE: u64 = 1_000_000;
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

fun init_adapter_market_for_testing(scenario: &mut ts::Scenario, admin: address) {
    ts::next_tx(scenario, admin);
    {
        soul::init_for_testing(admin, ts::ctx(scenario));
        core_market::init_for_testing(admin, ts::ctx(scenario));
        allowlist::init_for_testing(ts::ctx(scenario));
        test_usdc::init_for_testing(admin, ts::ctx(scenario));
        unft::test_init(ts::ctx(scenario));
    };

    ts::next_tx(scenario, admin);
    {
        let mut registry: NftRegistry = ts::take_shared(scenario);
        let authority: SoulPackageAuthority = ts::take_from_sender(scenario);
        let (mint_cap, burn_cap_opt, metadata_cap) =
            market::bootstrap(authority, &mut registry, ts::ctx(scenario));

        burn_cap_opt.destroy_none();
        ts::return_shared(registry);
        transfer::public_transfer(mint_cap, admin);
        transfer::public_transfer(metadata_cap, admin);
    };
}

#[test]
#[expected_failure]
fun bootstrap_cannot_run_twice_after_consuming_package_authority() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    init_adapter_market_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let mut registry: NftRegistry = ts::take_shared(&scenario);
        let authority: SoulPackageAuthority = ts::take_from_sender(&scenario);
        let (mint_cap, burn_cap_opt, metadata_cap) =
            market::bootstrap(authority, &mut registry, ts::ctx(&mut scenario));

        burn_cap_opt.destroy_none();
        ts::return_shared(registry);
        transfer::public_transfer(mint_cap, admin);
        transfer::public_transfer(metadata_cap, admin);
        abort 0
    }
}

#[test]
fun mint_and_list_fixed_price_places_new_soul_into_seller_personal_kiosk() {
    let admin = @0xA11CE;
    let seller = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let soul_id: ID;

    init_adapter_market_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, seller);
    {
        let collection: NftCollection<soul::Soul> = ts::take_shared(&scenario);
        let config: MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let (walrus_system, content_blob) = register_test_blob(ts::ctx(&mut scenario));

        soul_id = market::mint_and_list_fixed_price(
            &collection,
            &config,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            content_blob,
            SALE_PRICE,
            CREATOR_ROYALTY_BPS,
            ts::ctx(&mut scenario),
        );

        std::unit_test::destroy(walrus_system);
        ts::return_shared(collection);
        ts::return_shared(config);
        ts::return_shared(policy);
    };

    ts::next_tx(&mut scenario, seller);
    {
        let collection: NftCollection<soul::Soul> = ts::take_shared(&scenario);
        let config: MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let listing: FixedPriceListing = ts::take_shared(&scenario);
        let seller_kiosk: Kiosk = ts::take_shared(&scenario);

        assert!(core_market::listing_is_active(&listing), 0);
        assert!(core_market::listing_soul_id(&listing) == soul_id, 1);
        assert!(core_market::listing_price(&listing) == SALE_PRICE, 2);
        assert!(core_market::listing_creator_royalty_bps(&listing) == CREATOR_ROYALTY_BPS, 3);
        assert!(kiosk::has_item(&seller_kiosk, soul_id), 4);
        assert!(kiosk::is_listed_exclusively(&seller_kiosk, soul_id), 5);

        ts::return_shared(collection);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_shared(listing);
        ts::return_shared(seller_kiosk);
    };

    ts::end(scenario);
}

#[test]
fun buy_fixed_price_uses_test_usdc_and_moves_soul_into_buyer_personal_kiosk() {
    let admin = @0xA11CE;
    let seller = @0xB0B;
    let buyer = @0xCAFE;
    let mut scenario = ts::begin(@0x0);

    init_adapter_market_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let mut config: MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let admin_cap: MarketAdminCap = ts::take_from_sender(&scenario);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_sender(&scenario);
        let treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(&scenario);
        let mint_cap = ts::take_from_sender<unft::NftMintCap<soul::Soul>>(&scenario);
        let metadata_cap = ts::take_from_sender<unft::NftCollectionMetadataCap<soul::Soul>>(&scenario);

        core_market::update_platform_fee_bps(&mut config, &admin_cap, PLATFORM_FEE_BPS);

        ts::return_shared(config);
        ts::return_shared(policy);
        transfer::public_transfer(admin_cap, admin);
        transfer::public_transfer(policy_cap, admin);
        transfer::public_transfer(treasury_cap, admin);
        transfer::public_transfer(mint_cap, admin);
        transfer::public_transfer(metadata_cap, admin);
    };

    ts::next_tx(&mut scenario, seller);
    {
        let collection: NftCollection<soul::Soul> = ts::take_shared(&scenario);
        let config: MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let (walrus_system, content_blob) = register_test_blob(ts::ctx(&mut scenario));

        market::mint_and_list_fixed_price(
            &collection,
            &config,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Single-owner artifact"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            content_blob,
            SALE_PRICE,
            CREATOR_ROYALTY_BPS,
            ts::ctx(&mut scenario),
        );

        std::unit_test::destroy(walrus_system);
        ts::return_shared(collection);
        ts::return_shared(config);
        ts::return_shared(policy);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let mut registry: AllowlistRegistry = ts::take_shared(&scenario);
        let config: MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let mut listing: FixedPriceListing = ts::take_shared(&scenario);
        let mut seller_kiosk: Kiosk = ts::take_shared(&scenario);
        let admin_cap: MarketAdminCap = ts::take_from_address(&scenario, admin);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_address(&scenario, admin);
        let mut treasury_cap: TreasuryCap<USDC> = ts::take_from_address(&scenario, admin);
        let mint_cap = ts::take_from_address<unft::NftMintCap<soul::Soul>>(&scenario, admin);
        let metadata_cap = ts::take_from_address<unft::NftCollectionMetadataCap<soul::Soul>>(&scenario, admin);
        let (_, price, creator_royalty, total) = market::quote_fixed_price(&config, &listing);
        let payment = test_usdc::mint_for_testing(&mut treasury_cap, total, ts::ctx(&mut scenario));

        assert!(price == SALE_PRICE, 0);
        assert!(creator_royalty > 0, 1);
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
        transfer::public_transfer(admin_cap, admin);
        transfer::public_transfer(policy_cap, admin);
        transfer::public_transfer(treasury_cap, admin);
        transfer::public_transfer(mint_cap, admin);
        transfer::public_transfer(metadata_cap, admin);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let registry: AllowlistRegistry = ts::take_shared(&scenario);
        let config: MarketConfig = ts::take_shared(&scenario);
        let policy: transfer_policy::TransferPolicy<soul::Soul> = ts::take_shared(&scenario);
        let listing: FixedPriceListing = ts::take_shared(&scenario);
        let first_kiosk: Kiosk = ts::take_shared(&scenario);
        let second_kiosk: Kiosk = ts::take_shared(&scenario);
        let buyer_personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let admin_cap: MarketAdminCap = ts::take_from_address(&scenario, admin);
        let policy_cap: transfer_policy::TransferPolicyCap<soul::Soul> = ts::take_from_address(&scenario, admin);
        let treasury_cap: TreasuryCap<USDC> = ts::take_from_address(&scenario, admin);
        let mint_cap = ts::take_from_address<unft::NftMintCap<soul::Soul>>(&scenario, admin);
        let metadata_cap = ts::take_from_address<unft::NftCollectionMetadataCap<soul::Soul>>(&scenario, admin);
        let buyer_kiosk_id = personal_kiosk::borrow(&buyer_personal_cap).kiosk();
        let (buyer_kiosk, seller_kiosk) =
            if (object::id(&first_kiosk) == buyer_kiosk_id) {
                (&first_kiosk, &second_kiosk)
            } else {
                (&second_kiosk, &first_kiosk)
            };
        let soul_id = core_market::listing_soul_id(&listing);
        let purchased_soul = kiosk::borrow<soul::Soul>(
            buyer_kiosk,
            personal_kiosk::borrow(&buyer_personal_cap),
            soul_id,
        );

        assert!(!core_market::listing_is_active(&listing), 2);
        assert!(!kiosk::has_item(seller_kiosk, soul_id), 3);
        assert!(kiosk::has_item(buyer_kiosk, soul_id), 4);
        assert!(kiosk::is_locked(buyer_kiosk, soul_id), 5);
        assert!(personal_kiosk::owner(buyer_kiosk) == buyer, 6);
        assert!(soul::allowlist_address(purchased_soul).is_none(), 7);
        assert!(allowlist::registry_version(&registry, soul_id) == 0, 8);

        ts::return_shared(registry);
        ts::return_shared(config);
        ts::return_shared(policy);
        ts::return_shared(listing);
        ts::return_shared(first_kiosk);
        ts::return_shared(second_kiosk);
        personal_kiosk::transfer_to_sender(buyer_personal_cap, ts::ctx(&mut scenario));
        transfer::public_transfer(admin_cap, admin);
        transfer::public_transfer(policy_cap, admin);
        transfer::public_transfer(treasury_cap, admin);
        transfer::public_transfer(mint_cap, admin);
        transfer::public_transfer(metadata_cap, admin);
    };

    ts::end(scenario);
}
