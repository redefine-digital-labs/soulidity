#[test_only]
module soulidity::collection_buy_snapshot_tests;

use std::bcs;
use sui::{coin::{Self as coin, Coin}, kiosk::{Self as kiosk, Kiosk}, test_scenario::{Self as ts}, transfer_policy::TransferPolicy};
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use soulidity::{collection::{Self as collection, SoulCollection, SoulCollectionRight},
    market::{Self as market, MarketConfigV2, MarketAdminCapV2, KioskRegistry, CollectionListing}};
use usdc::usdc::USDC;

const SELLER: address = @0xA11;
const BUYER: address = @0xB22;
const FEE: address = @0xF33;

// Actual Move settlement with the same three readonly preconditions and
// existing/new personal-Kiosk branches as the browser purchase PTB. Test coins
// are not real wallet payment, gas accounting or checkpoint/effects evidence.
fun purchase(new_buyer: bool, price: u64, fee_bps: u16, mode: u8) {
    let mut s = ts::begin(SELLER); market::init_fresh_for_testing(SELLER, s.ctx()); s.next_tx(SELLER);
    let mut config = s.take_shared<MarketConfigV2>(); let admin = s.take_from_sender<MarketAdminCapV2>();
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    market::update_config_v2_platform_fee_bps(&mut config, &admin, fee_bps);
    market::update_config_v2_fee_recipient(&mut config, &admin, FEE);
    let mut registry = s.take_shared<KioskRegistry>();
    let seller_id = market::init_personal_kiosk_v2(&config, &mut registry, s.ctx());
    ts::return_shared(registry); s.next_tx(SELLER);
    let registry = s.take_shared<KioskRegistry>(); let policy = s.take_shared<TransferPolicy<SoulCollectionRight>>();
    let mut seller = s.take_shared_by_id<Kiosk>(seller_id); let cap = s.take_from_sender<PersonalKioskCap>();
    let root = market::create_collection_in_personal_kiosk_v2(&config, &registry, &policy, &mut seller, &cap,
        b"Collection".to_string(), b"Right".to_string(), b"".to_string(), 123, true,
        option::some(18446744073709551615), option::some(99_999_999_999_999_999_999), s.ctx());
    let right_id = collection::right_id(&root);
    let listing = market::list_collection_right_fixed_price_v2(&config, &registry, &root, &mut seller, &cap, price, s.ctx());
    market::finalize_collection(root); market::finalize_collection_listing(listing);
    ts::return_shared(seller); ts::return_shared(registry); ts::return_shared(policy); ts::return_to_sender(&s, cap);
    s.next_tx(BUYER);
    let mut registry = s.take_shared<KioskRegistry>();
    let existing_id = if (!new_buyer) option::some(market::init_personal_kiosk_v2(&config, &mut registry, s.ctx())) else option::none();
    ts::return_shared(registry); s.next_tx(BUYER);
    let mut root = s.take_shared<SoulCollection>(); let mut listing = s.take_shared<CollectionListing>();
    let mut registry = s.take_shared<KioskRegistry>(); let policy = s.take_shared<TransferPolicy<SoulCollectionRight>>();
    let mut seller = s.take_shared_by_id<Kiosk>(seller_id);
    let root_bytes = bcs::to_bytes(&root); let listing_bytes = bcs::to_bytes(&listing); let config_bytes = bcs::to_bytes(&config);
    if (mode == 2) market::update_config_v2_platform_fee_bps(&mut config, &admin, fee_bps + 1);
    market::assert_collection_command_snapshot(&root, root_bytes);
    market::assert_collection_listing_snapshot(&listing, listing_bytes);
    market::assert_collection_market_snapshot_v2(&config, config_bytes);
    let (mut buyer, buyer_cap) = if (new_buyer) {
        let (mut shop, owner_cap) = kiosk::new(s.ctx());
        let personal = personal_kiosk::new(&mut shop, owner_cap, s.ctx());
        (shop, personal)
    } else (s.take_shared_by_id<Kiosk>(existing_id.destroy_some()), s.take_from_sender<PersonalKioskCap>());
    market::ensure_personal_kiosk_registered_v2(&config, &mut registry, &buyer_cap, s.ctx());
    let buyer_id = object::id(&buyer);
    let (fee, quoted_price, total) = market::quote_collection_purchase_v2(&config, price);
    assert!(quoted_price == price && (total as u128) == (price as u128) + (fee as u128), 99);
    let payment = coin::mint_for_testing<USDC>(if (mode == 1) total - 1 else total, s.ctx());
    market::buy_collection_right_fixed_price_v2(&config, &registry, &policy, &mut root,
        &mut seller, &mut buyer, &buyer_cap, &mut listing, payment, s.ctx());
    assert!(collection::current_holder(&root) == BUYER && collection::current_holder_kiosk_id(&root) == buyer_id, 99);
    assert!(collection::current_supply(&root) == 0 && collection::max_supply(&root) == option::some(18446744073709551615)
        && collection::floor_price_atomic(&root) == option::some(99_999_999_999_999_999_999), 99);
    assert!(!seller.has_item(right_id) && !seller.is_listed(right_id) && !seller.is_locked(right_id) && seller.item_count() == 0, 99);
    assert!(buyer.has_item(right_id) && buyer.is_locked(right_id) && !buyer.is_listed(right_id) && buyer.item_count() == 1, 99);
    assert!(object::id(buyer.borrow<SoulCollectionRight>(personal_kiosk::borrow(&buyer_cap), right_id)) == right_id, 99);
    assert!(bcs::to_bytes(&listing) != listing_bytes, 99);
    ts::return_shared(root); ts::return_shared(listing); ts::return_shared(registry); ts::return_shared(policy); ts::return_shared(seller);
    if (new_buyer) { transfer::public_share_object(buyer); personal_kiosk::transfer_to_sender(buyer_cap, s.ctx()); }
    else { ts::return_shared(buyer); ts::return_to_sender(&s, buyer_cap); };
    s.next_tx(BUYER);
    let buyer = s.take_shared_by_id<Kiosk>(buyer_id); let buyer_cap = s.take_from_sender<PersonalKioskCap>();
    assert!(object::id(buyer.borrow<SoulCollectionRight>(personal_kiosk::borrow(&buyer_cap), right_id)) == right_id, 99);
    let seller_payment = s.take_from_address<Coin<USDC>>(SELLER); assert!(seller_payment.value() == price, 99); seller_payment.burn_for_testing();
    if (fee > 0) { let fee_payment = s.take_from_address<Coin<USDC>>(FEE); assert!(fee_payment.value() == fee, 99); fee_payment.burn_for_testing(); };
    ts::return_shared(buyer); ts::return_to_sender(&s, buyer_cap); ts::return_shared(config); ts::return_to_address(SELLER, admin); s.end();
}

#[test] fun existing_personal_kiosk_exact_additive_payment_and_custody() { purchase(false, 1_000_001, 250, 0); }
#[test] fun new_personal_kiosk_register_buy_and_finalize_in_one_transaction() { purchase(true, 1_000_001, 250, 0); }
#[test] fun zero_fee_creates_only_seller_payment() { purchase(true, 1, 0, 0); }
#[test] fun one_atomic_price_rounds_fee_up() { purchase(false, 1, 250, 0); }
#[test, expected_failure(abort_code = 6, location = soulidity::market)]
fun underpayment_never_transfers_the_right() { purchase(true, 1_000_001, 250, 1); }
#[test, expected_failure(abort_code = 78, location = soulidity::market)]
fun changed_fee_rejects_frozen_purchase_before_settlement() { purchase(false, 1_000_001, 250, 2); }
