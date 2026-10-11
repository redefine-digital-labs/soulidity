#[test_only]
module soulidity::collection_command_snapshot_tests;

use std::{bcs, string};
use sui::{event, kiosk::Kiosk, test_scenario::{Self as ts, Scenario}, transfer_policy::TransferPolicy};
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use soulidity::{collection::{Self as collection, SoulCollection, SoulCollectionRight}, soul,
    market::{Self as market, MarketConfigV2, MarketAdminCapV2, KioskRegistry, CollectionListing}};

const OWNER: address = @0xA11;
const OTHER: address = @0xB22;
fun id(a: address): ID { object::id_from_address(a) }

// Real native-backed Kiosk custody and the actual fresh V2 initialization.
// No guard changes a production permission or opens the default market gates.
fun setup(s: &mut Scenario, listed: bool) {
    market::init_fresh_for_testing(OWNER, s.ctx()); s.next_tx(OWNER);
    let mut config = s.take_shared<MarketConfigV2>();
    let admin = s.take_from_sender<MarketAdminCapV2>();
    let mut registry = s.take_shared<KioskRegistry>();
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    market::init_personal_kiosk_v2(&config, &mut registry, s.ctx());
    ts::return_shared(config); ts::return_shared(registry); ts::return_to_sender(s, admin);
    s.next_tx(OWNER);
    let config = s.take_shared<MarketConfigV2>(); let registry = s.take_shared<KioskRegistry>();
    let policy = s.take_shared<TransferPolicy<SoulCollectionRight>>(); let mut shop = s.take_shared<Kiosk>();
    let cap = s.take_from_sender<PersonalKioskCap>();
    let root = market::create_collection_in_personal_kiosk_v2(&config, &registry, &policy, &mut shop, &cap,
        string::utf8(b"Collection"), string::utf8(b"Right"), string::utf8(b"https://example.com/right"),
        500, true, option::none(), option::none(), s.ctx());
    if (listed) {
        let listing = market::list_collection_right_fixed_price_v2(&config, &registry, &root, &mut shop, &cap, 1_000_001, s.ctx());
        market::finalize_collection_listing(listing);
    };
    collection::share_collection(root); ts::return_shared(config); ts::return_shared(registry); ts::return_shared(policy);
    ts::return_shared(shop); ts::return_to_sender(s, cap); s.next_tx(OWNER);
}

#[test]
fun exact_guards_are_read_only_and_do_not_emit() {
    let mut s = ts::begin(OWNER); setup(&mut s, true);
    let root = s.take_shared<SoulCollection>(); let listing = s.take_shared<CollectionListing>(); let config = s.take_shared<MarketConfigV2>();
    let root_bytes = bcs::to_bytes(&root); let listing_bytes = bcs::to_bytes(&listing); let config_bytes = bcs::to_bytes(&config);
    let count = event::num_events();
    market::assert_collection_command_snapshot(&root, root_bytes);
    market::assert_collection_listing_snapshot(&listing, listing_bytes);
    market::assert_collection_market_snapshot_v2(&config, config_bytes);
    assert!(event::num_events() == count && bcs::to_bytes(&root) == root_bytes
        && bcs::to_bytes(&listing) == listing_bytes && bcs::to_bytes(&config) == config_bytes, 99);
    ts::return_shared(root); ts::return_shared(listing); ts::return_shared(config); s.end();
}

#[test]
fun guarded_atomic_reprice_closes_old_listing_and_preserves_right_custody() {
    let mut s = ts::begin(OWNER); setup(&mut s, true);
    let root = s.take_shared<SoulCollection>(); let mut old = s.take_shared<CollectionListing>();
    let config = s.take_shared<MarketConfigV2>(); let mut registry = s.take_shared<KioskRegistry>();
    let mut shop = s.take_shared<Kiosk>(); let cap = s.take_from_sender<PersonalKioskCap>();
    let old_id = object::id(&old); let right_id = collection::right_id(&root); let old_bytes = bcs::to_bytes(&old);
    market::assert_collection_command_snapshot(&root, bcs::to_bytes(&root));
    market::assert_collection_listing_snapshot(&old, old_bytes);
    market::assert_collection_market_snapshot_v2(&config, bcs::to_bytes(&config));
    market::cancel_collection_listing(&mut shop, &cap, &mut old);
    assert!(bcs::to_bytes(&old) != old_bytes && !shop.is_listed(right_id), 99);
    market::ensure_personal_kiosk_registered_v2(&config, &mut registry, &cap, s.ctx());
    let listing = market::list_collection_right_fixed_price_v2(&config, &registry, &root, &mut shop, &cap, 2_000_001, s.ctx());
    let new_id = object::id(&listing); assert!(new_id != old_id && shop.is_listed(right_id), 99);
    assert!(object::id(shop.borrow<SoulCollectionRight>(personal_kiosk::borrow(&cap), right_id)) == right_id, 99);
    market::finalize_collection_listing(listing);
    ts::return_shared(root); ts::return_shared(old); ts::return_shared(config); ts::return_shared(registry);
    ts::return_shared(shop); ts::return_to_sender(&s, cap); s.next_tx(OWNER);
    let old = s.take_shared_by_id<CollectionListing>(old_id); let listing = s.take_shared_by_id<CollectionListing>(new_id);
    let shop = s.take_shared<Kiosk>(); let cap = s.take_from_sender<PersonalKioskCap>();
    assert!(shop.is_listed(right_id) && object::id(shop.borrow<SoulCollectionRight>(personal_kiosk::borrow(&cap), right_id)) == right_id, 99);
    ts::return_shared(old); ts::return_shared(listing); ts::return_shared(shop); ts::return_to_sender(&s, cap); s.end();
}

#[test]
fun delist_releases_reservation_even_when_both_market_gates_are_paused() {
    let mut s = ts::begin(OWNER); setup(&mut s, true);
    let root = s.take_shared<SoulCollection>(); let mut listing = s.take_shared<CollectionListing>();
    let mut config = s.take_shared<MarketConfigV2>(); let admin = s.take_from_sender<MarketAdminCapV2>();
    market::update_config_v2_primary_enabled(&mut config, &admin, false);
    market::update_config_v2_secondary_enabled(&mut config, &admin, false);
    let mut shop = s.take_shared<Kiosk>(); let cap = s.take_from_sender<PersonalKioskCap>();
    market::assert_collection_command_snapshot(&root, bcs::to_bytes(&root));
    market::assert_collection_listing_snapshot(&listing, bcs::to_bytes(&listing));
    market::cancel_collection_listing(&mut shop, &cap, &mut listing);
    let right_id = collection::right_id(&root);
    assert!(!shop.is_listed(right_id) && object::id(shop.borrow<SoulCollectionRight>(personal_kiosk::borrow(&cap), right_id)) == right_id, 99);
    ts::return_shared(root); ts::return_shared(listing); ts::return_shared(config); ts::return_to_sender(&s, admin);
    ts::return_shared(shop); ts::return_to_sender(&s, cap); s.end();
}

#[test]
fun identical_holder_round_trip_is_not_a_fictional_ownership_epoch() {
    let mut s = ts::begin(OWNER); setup(&mut s, false); let mut root = s.take_shared<SoulCollection>();
    let before = bcs::to_bytes(&root); let kiosk_id = collection::current_holder_kiosk_id(&root);
    collection::update_holder(&mut root, OTHER, id(@0x44)); collection::update_holder(&mut root, OWNER, kiosk_id);
    assert!(before == bcs::to_bytes(&root), 99); market::assert_collection_command_snapshot(&root, before);
    ts::return_shared(root); s.end();
}

#[test, expected_failure(abort_code = 78, location = soulidity::market)]
fun different_holder_rejects_original_guard() {
    let mut s = ts::begin(OWNER); setup(&mut s, false); let mut root = s.take_shared<SoulCollection>();
    let before = bcs::to_bytes(&root); collection::update_holder(&mut root, OTHER, id(@0x44));
    market::assert_collection_command_snapshot(&root, before); abort 99
}
#[test, expected_failure(abort_code = 78, location = soulidity::market)]
fun changed_supply_rejects_original_guard() {
    let mut s = ts::begin(OWNER); setup(&mut s, false); let mut root = s.take_shared<SoulCollection>();
    let before = bcs::to_bytes(&root); let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    collection::add_soul(&mut root, &mut state, s.ctx()); market::assert_collection_command_snapshot(&root, before); abort 99
}
#[test, expected_failure(abort_code = 78, location = soulidity::market)]
fun cancelled_old_listing_rejects_stale_approval() {
    let mut s = ts::begin(OWNER); setup(&mut s, true); let mut listing = s.take_shared<CollectionListing>();
    let mut shop = s.take_shared<Kiosk>(); let cap = s.take_from_sender<PersonalKioskCap>(); let before = bcs::to_bytes(&listing);
    market::cancel_collection_listing(&mut shop, &cap, &mut listing); market::assert_collection_listing_snapshot(&listing, before); abort 99
}
fun changed_market(mode: u8) {
    let mut s = ts::begin(OWNER); setup(&mut s, false); let mut config = s.take_shared<MarketConfigV2>();
    let admin = s.take_from_sender<MarketAdminCapV2>(); let before = bcs::to_bytes(&config);
    if (mode == 0) market::update_config_v2_secondary_enabled(&mut config, &admin, false);
    if (mode == 1) market::update_config_v2_platform_fee_bps(&mut config, &admin, 100);
    if (mode == 2) market::update_config_v2_fee_recipient(&mut config, &admin, OTHER);
    market::assert_collection_market_snapshot_v2(&config, before); abort 99
}
#[test, expected_failure(abort_code = 78, location = soulidity::market)] fun secondary_gate_change_rejects_approval() { changed_market(0); }
#[test, expected_failure(abort_code = 78, location = soulidity::market)] fun fee_change_rejects_approval() { changed_market(1); }
#[test, expected_failure(abort_code = 78, location = soulidity::market)] fun fee_recipient_change_rejects_approval() { changed_market(2); }

#[test, expected_failure(abort_code = 39, location = soulidity::market)]
fun matching_guard_does_not_authorize_a_different_sender() {
    let mut s = ts::begin(OWNER); setup(&mut s, false); s.next_tx(OTHER);
    let root = s.take_shared<SoulCollection>(); let config = s.take_shared<MarketConfigV2>(); let registry = s.take_shared<KioskRegistry>();
    let mut shop = s.take_shared<Kiosk>(); let cap = s.take_from_address<PersonalKioskCap>(OWNER);
    market::assert_collection_command_snapshot(&root, bcs::to_bytes(&root));
    let _listing = market::list_collection_right_fixed_price_v2(&config, &registry, &root, &mut shop, &cap, 100, s.ctx()); abort 99
}
