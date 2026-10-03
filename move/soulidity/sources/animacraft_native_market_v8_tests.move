#[test_only]
module soulidity::animacraft_native_market_v8_tests;

use animacraft_v8_output::output_v8::{Self as output, NativeSoulBindingV8};
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use soulidity::content;
use soulidity::collection::{Self as collection, SoulCollection, SoulCollectionRight};
use soulidity::grant;
use soulidity::market::{Self as market, CollectionListing, KioskRegistry, MarketAdminCap, MarketAdminCapV2, MarketConfig, MarketConfigV2, SoulListing};
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::coin::{Self as coin, Coin};
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::test_scenario::{Self as ts};
use sui::transfer_policy::TransferPolicy;
use usdc::usdc::USDC;

const ADMIN: address = @0xA;
const PLAYER: address = @0xB;
const BUYER: address = @0xC;
const MAKER: address = @0xD;
const GRANTEE: address = @0xE;
const PRICE: u64 = 10001;

/// Real Kiosk settlement with a test-only immutable Output provenance fixture.
/// This deliberately does not claim to exercise Complete authorization or mint.
fun exercise_settlement(mode: u8) {
    let price = if (mode == 18) 1 else PRICE;
    let creator_bps = if (mode == 15) 750 else if (mode == 16) 1000 else if (mode == 17) 0 else 250;
    let source_bps = if (mode == 15) 250 else if (mode == 16) 0 else if (mode == 17) 1000 else 500;
    let mut scenario = ts::begin(ADMIN);
    market::init_fresh_for_testing(ADMIN, scenario.ctx());
    scenario.next_tx(ADMIN);
    let mut config = ts::take_shared<MarketConfigV2>(&scenario);
    let admin = ts::take_from_sender<MarketAdminCapV2>(&scenario);
    assert!(!market::config_v2_primary_enabled(&config) && !market::config_v2_secondary_enabled(&config), 110);
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);

    scenario.next_tx(PLAYER);
    let mut registry = ts::take_shared<KioskRegistry>(&scenario);
    let seller_kiosk_id = market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
    ts::return_shared(registry);
    scenario.next_tx(BUYER);
    let mut registry = ts::take_shared<KioskRegistry>(&scenario);
    let buyer_kiosk_id = market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
    ts::return_shared(registry);

    scenario.next_tx(PLAYER);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, seller_kiosk_id);
    let seller_cap = ts::take_from_sender<PersonalKioskCap>(&scenario);
    let policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let soul_obj = soul::mint(b"Native settlement fixture".to_string(), b"".to_string(),
        b"walrus://fixture".to_string(), PLAYER, creator_bps, soul::provenance_animacraft(), option::none(), scenario.ctx());
    let soul_id = object::id(&soul_obj);
    let mut state = soul::create_state(soul_id, PLAYER, creator_bps, PLAYER, seller_kiosk_id, scenario.ctx());
    let content = content::create(soul_id, scenario.ctx());
    soul::set_content_id(&mut state, object::id(&content));
    content::share_content(content);
    let state_id = object::id(&state);
    let clock = sui::clock::create_for_testing(scenario.ctx());
    let grant_obj = grant::issue(&mut state, GRANTEE, grant::scope_seal(), option::none(), &clock, scenario.ctx());
    transfer::public_transfer(grant_obj, GRANTEE);
    clock.destroy_for_testing();
    kiosk::lock(&mut seller_kiosk, personal_kiosk::borrow(&seller_cap), &policy, soul_obj);
    market::finalize_soul_state(state);
    ts::return_shared(policy);
    ts::return_shared(seller_kiosk);
    ts::return_to_sender(&scenario, seller_cap);

    // The original Maker constructs the fixture rights in a real scenario turn;
    // no synthetic TxContext changes the Player's signer or object counters.
    scenario.next_tx(MAKER);
    let mut state = ts::take_shared_by_id<SoulState>(&scenario, state_id);
    let provenance = output::native_soul_binding_for_testing_v8(
        if (mode == 3) object::id_from_address(@0xBAD) else soul_id,
        if (mode == 4) object::id_from_address(@0xBAD) else state_id,
        if (mode == 5) BUYER else PLAYER, MAKER, if (mode == 6) 300 else creator_bps, source_bps, scenario.ctx());
    if (mode != 1) soul::bind_animacraft_native_v8(&mut state,
        if (mode == 2) object::id_from_address(@0xBAD) else object::id(&provenance));
    if (mode == 7) soul::bind_animacraft_native_equipment_v8(&mut state, object::id_from_address(@0xE01));
    output::freeze_native_soul_binding_v8(provenance);
    ts::return_shared(state);

    scenario.next_tx(PLAYER);
    let mut state = ts::take_shared_by_id<SoulState>(&scenario, state_id);
    let provenance = ts::take_immutable<NativeSoulBindingV8>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, seller_kiosk_id);
    let seller_cap = if (mode == 22) ts::take_from_address<PersonalKioskCap>(&scenario, BUYER)
        else ts::take_from_sender<PersonalKioskCap>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    if (mode == 8) market::update_config_v2_secondary_enabled(&mut config, &admin, false);
    if (mode == 9) market::update_config_v2_platform_fee_bps(&mut config, &admin, 300);
    let listing = market::list_animacraft_v8_soul_fixed_price(&config, &registry, &provenance,
        &mut seller_kiosk, &seller_cap, &mut state, if (mode == 10) 0 else price, scenario.ctx());
    assert!(market::soul_listing_version(&listing) == 8 && soul::is_listed(&state), 100);
    assert!(soul::ownership_epoch(&state) == 0 && soul::active_grant_count(&state) == 1, 101);
    let (seller_amount, protocol_amount, creator_amount, source_amount) = market::quote_animacraft_v8_soul_sale(&state, &provenance, price);
    assert!(protocol_amount == price * 250 / 10000 && creator_amount == price * (creator_bps as u64) / 10000
        && source_amount == price * (source_bps as u64) / 10000
        && seller_amount + protocol_amount + creator_amount + source_amount == price, 102);
    let listing_id = object::id(&listing);
    market::finalize_soul_listing(listing);
    ts::return_shared(state);
    ts::return_immutable(provenance);
    ts::return_shared(seller_kiosk);
    ts::return_shared(registry);
    ts::return_to_sender(&scenario, seller_cap);

    scenario.next_tx(if (mode == 11 || mode == 12 || mode == 23) PLAYER else BUYER);
    let mut state = ts::take_shared_by_id<SoulState>(&scenario, state_id);
    let mut listing = ts::take_shared_by_id<SoulListing>(&scenario, listing_id);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, seller_kiosk_id);
    if (mode == 11 || mode == 12 || mode == 23) {
        market::update_config_v2_secondary_enabled(&mut config, &admin, false);
        let cap = if (mode == 23) ts::take_from_address<PersonalKioskCap>(&scenario, BUYER)
            else ts::take_from_sender<PersonalKioskCap>(&scenario);
        market::cancel_animacraft_v8_soul_listing(&mut seller_kiosk, &cap, &mut state, &mut listing);
        assert!(!soul::is_listed(&state) && soul::ownership_epoch(&state) == 0
            && soul::current_owner(&state) == PLAYER && soul::active_grant_count(&state) == 1, 103);
        if (mode == 12) market::cancel_animacraft_v8_soul_listing(&mut seller_kiosk, &cap, &mut state, &mut listing);
        ts::return_to_sender(&scenario, cap);
    } else {
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap = if (mode == 21) ts::take_from_address<PersonalKioskCap>(&scenario, PLAYER)
            else ts::take_from_sender<PersonalKioskCap>(&scenario);
        let registry = ts::take_shared<KioskRegistry>(&scenario);
        let policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
        let provenance = ts::take_immutable<NativeSoulBindingV8>(&scenario);
        if (mode == 13) market::update_config_v2_secondary_enabled(&mut config, &admin, false);
        let alternate = if (mode == 20) option::some(output::native_soul_binding_for_testing_v8(
            soul_id, state_id, PLAYER, BUYER, creator_bps, source_bps, scenario.ctx())) else option::none();
        let selected_provenance = if (alternate.is_some()) alternate.borrow() else &provenance;
        let payment = coin::mint_for_testing<USDC>(if (mode == 14) price - 1 else price, scenario.ctx());
        market::buy_animacraft_v8_soul_fixed_price(&config, &registry, &policy, selected_provenance,
            &mut seller_kiosk, &mut buyer_kiosk, &buyer_cap, &mut state, &mut listing, payment, scenario.ctx());
        alternate.destroy!(|binding| output::freeze_native_soul_binding_v8(binding));
        assert!(soul::current_owner(&state) == BUYER && soul::current_kiosk_id(&state) == buyer_kiosk_id
            && soul::ownership_epoch(&state) == 1 && !soul::is_listed(&state), 104);
        assert!(soul::active_grant_count(&state) == 0 && !soul::active_grant_contains_grantee(&state, GRANTEE), 105);
        let _soul = kiosk::borrow<Soul>(&buyer_kiosk, personal_kiosk::borrow(&buyer_cap), soul_id);
        let (seller_after, protocol_after, creator_after, source_after) = market::quote_animacraft_v8_soul_sale(&state, &provenance, price);
        assert!(seller_after == seller_amount && protocol_after == protocol_amount
            && creator_after == creator_amount && source_after == source_amount, 106);
        ts::return_immutable(provenance);
        ts::return_shared(policy);
        ts::return_shared(registry);
        ts::return_shared(buyer_kiosk);
        ts::return_to_sender(&scenario, buyer_cap);
    };
    ts::return_shared(listing);
    ts::return_shared(state);
    ts::return_shared(seller_kiosk);
    scenario.next_tx(ADMIN);
    if (mode == 0 || mode >= 15) {
        if (protocol_amount > 0) {
            let fee = ts::take_from_address<Coin<USDC>>(&scenario, ADMIN);
            assert!(fee.value() == protocol_amount, 107);
            fee.burn_for_testing();
        };
        if (source_amount > 0) {
            let source = ts::take_from_address<Coin<USDC>>(&scenario, MAKER);
            assert!(source.value() == source_amount, 108);
            source.burn_for_testing();
        };
        let seller_a = ts::take_from_address<Coin<USDC>>(&scenario, PLAYER);
        if (creator_amount > 0) {
            let seller_b = ts::take_from_address<Coin<USDC>>(&scenario, PLAYER);
            assert!(seller_a.value() + seller_b.value() == seller_amount + creator_amount, 109);
            assert!(seller_a.value() == creator_amount || seller_b.value() == creator_amount, 111);
            seller_b.burn_for_testing();
        } else assert!(seller_a.value() == seller_amount, 112);
        seller_a.burn_for_testing();
    };
    if (mode == 19) {
        // A later seller never replaces either original royalty beneficiary.
        scenario.next_tx(BUYER);
        let mut state = ts::take_shared_by_id<SoulState>(&scenario, state_id);
        let provenance = ts::take_immutable<NativeSoulBindingV8>(&scenario);
        let registry = ts::take_shared<KioskRegistry>(&scenario);
        let mut kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let cap = ts::take_from_sender<PersonalKioskCap>(&scenario);
        let resale = market::list_animacraft_v8_soul_fixed_price(&config, &registry, &provenance,
            &mut kiosk, &cap, &mut state, 12345, scenario.ctx());
        let resale_id = object::id(&resale);
        market::finalize_soul_listing(resale);
        ts::return_shared(state); ts::return_shared(registry); ts::return_shared(kiosk);
        ts::return_immutable(provenance); ts::return_to_sender(&scenario, cap);
        scenario.next_tx(PLAYER);
        let mut state = ts::take_shared_by_id<SoulState>(&scenario, state_id);
        let provenance = ts::take_immutable<NativeSoulBindingV8>(&scenario);
        let registry = ts::take_shared<KioskRegistry>(&scenario);
        let policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
        let mut from = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let mut to = ts::take_shared_by_id<Kiosk>(&scenario, seller_kiosk_id);
        let cap = ts::take_from_sender<PersonalKioskCap>(&scenario);
        let mut resale = ts::take_shared_by_id<SoulListing>(&scenario, resale_id);
        let payment = coin::mint_for_testing<USDC>(12345, scenario.ctx());
        market::buy_animacraft_v8_soul_fixed_price(&config, &registry, &policy, &provenance,
            &mut from, &mut to, &cap, &mut state, &mut resale, payment, scenario.ctx());
        assert!(soul::current_owner(&state) == PLAYER && soul::ownership_epoch(&state) == 2
            && soul::state_creator(&state) == PLAYER && soul::creator_royalty_bps(&state) == 250, 113);
        assert!(soul::animacraft_native_v8_binding_id(&state) == object::id(&provenance), 114);
        ts::return_shared(state); ts::return_shared(registry); ts::return_shared(policy);
        ts::return_shared(from); ts::return_shared(to); ts::return_shared(resale);
        ts::return_immutable(provenance); ts::return_to_sender(&scenario, cap);
        scenario.next_tx(ADMIN);
        let protocol = ts::take_from_address<Coin<USDC>>(&scenario, ADMIN);
        let creator = ts::take_from_address<Coin<USDC>>(&scenario, PLAYER);
        let source = ts::take_from_address<Coin<USDC>>(&scenario, MAKER);
        let seller = ts::take_from_address<Coin<USDC>>(&scenario, BUYER);
        assert!(protocol.value() == 308 && creator.value() == 308
            && source.value() == 617 && seller.value() == 11112, 115);
        protocol.burn_for_testing(); creator.burn_for_testing(); source.burn_for_testing(); seller.burn_for_testing();
    };
    ts::return_shared(config);
    ts::return_to_sender(&scenario, admin);
    scenario.end();
}

#[test] fun native_market_settlement_preserves_kiosk_royalties_and_invalidates_grants() { exercise_settlement(0); }
#[test, expected_failure(abort_code = 75, location = soulidity::market)] fun native_market_rejects_missing_df9() { exercise_settlement(1); }
#[test, expected_failure(abort_code = 75, location = soulidity::market)] fun native_market_rejects_wrong_df9() { exercise_settlement(2); }
#[test, expected_failure(abort_code = 75, location = soulidity::market)] fun native_market_rejects_wrong_soul() { exercise_settlement(3); }
#[test, expected_failure(abort_code = 75, location = soulidity::market)] fun native_market_rejects_wrong_state() { exercise_settlement(4); }
#[test, expected_failure(abort_code = 75, location = soulidity::market)] fun native_market_rejects_wrong_original_holder() { exercise_settlement(5); }
#[test, expected_failure(abort_code = 67, location = soulidity::market)] fun native_market_rejects_creator_rate_drift() { exercise_settlement(6); }
#[test, expected_failure(abort_code = 29, location = soulidity::soul)] fun native_market_rejects_equipped_components() { exercise_settlement(7); }
#[test, expected_failure(abort_code = 61, location = soulidity::market)] fun native_market_listing_rejects_pause() { exercise_settlement(8); }
#[test, expected_failure(abort_code = 63, location = soulidity::market)] fun native_market_rejects_protocol_fee_drift() { exercise_settlement(9); }
#[test, expected_failure(abort_code = 1, location = soulidity::market)] fun native_market_rejects_zero_price() { exercise_settlement(10); }
#[test] fun native_market_cancel_remains_available_while_paused() { exercise_settlement(11); }
#[test, expected_failure(abort_code = 3, location = soulidity::market)] fun native_market_rejects_double_cancel() { exercise_settlement(12); }
#[test, expected_failure(abort_code = 61, location = soulidity::market)] fun native_market_purchase_rejects_pause() { exercise_settlement(13); }
#[test, expected_failure(abort_code = 6, location = soulidity::market)] fun native_market_rejects_inexact_payment() { exercise_settlement(14); }
#[test] fun native_market_honors_750_creator_plus_250_source() { exercise_settlement(15); }
#[test] fun native_market_honors_1000_creator_plus_zero_source() { exercise_settlement(16); }
#[test] fun native_market_honors_zero_creator_plus_1000_source() { exercise_settlement(17); }
#[test] fun native_market_one_atomic_gross_floors_all_royalties_to_zero() { exercise_settlement(18); }
#[test] fun native_market_repeated_resale_keeps_original_player_and_maker_royalties() { exercise_settlement(19); }
#[test, expected_failure(abort_code = 75, location = soulidity::market)]
fun native_market_purchase_rejects_substitute_provenance() { exercise_settlement(20); }
#[test, expected_failure(abort_code = 8, location = soulidity::market)]
fun native_market_purchase_rejects_wrong_personal_kiosk_cap() { exercise_settlement(21); }
#[test, expected_failure(abort_code = 8, location = soulidity::market)]
fun native_market_listing_rejects_wrong_personal_kiosk_cap() { exercise_settlement(22); }
#[test, expected_failure(abort_code = 8, location = soulidity::market)]
fun native_market_cancel_rejects_wrong_personal_kiosk_cap() { exercise_settlement(23); }

#[test]
fun native_market_fresh_init_has_no_legacy_authority_and_gates_are_independent() {
    let mut scenario = ts::begin(ADMIN);
    market::init_fresh_for_testing(ADMIN, scenario.ctx());
    scenario.next_tx(ADMIN);
    assert!(!ts::has_most_recent_shared<MarketConfig>(), 120);
    assert!(!ts::has_most_recent_for_address<MarketAdminCap>(ADMIN), 121);
    let mut config = ts::take_shared<MarketConfigV2>(&scenario);
    let admin = ts::take_from_sender<MarketAdminCapV2>(&scenario);
    assert!(market::config_v2_legacy_config_id(&config) == object::id_from_address(@0x0), 122);
    assert!(market::admin_cap_v2_config_id(&admin) == object::id(&config), 123);
    assert!(!market::config_v2_primary_enabled(&config) && !market::config_v2_secondary_enabled(&config), 124);
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    assert!(!market::config_v2_primary_enabled(&config) && market::config_v2_secondary_enabled(&config), 125);
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    market::update_config_v2_secondary_enabled(&mut config, &admin, false);
    assert!(market::config_v2_primary_enabled(&config) && !market::config_v2_secondary_enabled(&config), 126);
    ts::return_shared(config);
    ts::return_to_sender(&scenario, admin);
    scenario.end();
}

#[test]
fun native_market_fresh_v2_preserves_ordinary_soul_and_collection_trade() {
    ordinary_trade(false);
}

#[test]
fun native_market_fresh_v2_below_floor_member_can_list_and_buy() {
    ordinary_trade(true);
}

fun ordinary_trade(bind_collection: bool) {
    let mut scenario = ts::begin(ADMIN);
    market::init_fresh_for_testing(ADMIN, scenario.ctx());
    scenario.next_tx(ADMIN);
    let mut config = ts::take_shared<MarketConfigV2>(&scenario);
    let admin = ts::take_from_sender<MarketAdminCapV2>(&scenario);
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    scenario.next_tx(PLAYER);
    let mut registry = ts::take_shared<KioskRegistry>(&scenario);
    let seller_id = market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
    ts::return_shared(registry);
    scenario.next_tx(BUYER);
    let mut registry = ts::take_shared<KioskRegistry>(&scenario);
    let buyer_id = market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
    ts::return_shared(registry);
    scenario.next_tx(PLAYER);
    let mut seller = ts::take_shared_by_id<Kiosk>(&scenario, seller_id);
    let cap = ts::take_from_sender<PersonalKioskCap>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let collection_policy = ts::take_shared<TransferPolicy<SoulCollectionRight>>(&scenario);
    // A package-local ordinary Soul fixture isolates resale from Walrus minting.
    let soul_obj = soul::mint(b"Ordinary".to_string(), b"".to_string(), b"".to_string(),
        PLAYER, 250, soul::provenance_native(), option::none(), scenario.ctx());
    let soul_id = object::id(&soul_obj);
    let mut state = soul::create_state(soul_id, PLAYER, 250, PLAYER, seller_id, scenario.ctx());
    let content = content::create(soul_id, scenario.ctx());
    soul::set_content_id(&mut state, object::id(&content));
    content::share_content(content);
    kiosk::lock(&mut seller, personal_kiosk::borrow(&cap), &soul_policy, soul_obj);
    let mut collection_obj = market::create_collection_in_personal_kiosk_v2(&config, &registry,
        &collection_policy, &mut seller, &cap, b"Ordinary collection".to_string(),
        b"".to_string(), b"".to_string(), 250, true, option::none(), option::some(99_999_999_999_999_999_999), scenario.ctx());
    let state_id = object::id(&state);
    let collection_id = object::id(&collection_obj);
    let right_id = collection::right_id(&collection_obj);
    if (bind_collection) collection::add_soul(&mut collection_obj, &mut state, scenario.ctx());
    let mut soul_listing = if (bind_collection)
        market::list_soul_fixed_price_with_collection_v2(&config, &registry, &collection_obj,
            &mut seller, &cap, &mut state, 10000, scenario.ctx())
        else market::list_soul_fixed_price_v2(&config, &registry, &mut seller, &cap,
            &mut state, 10000, scenario.ctx());
    let mut collection_listing = market::list_collection_right_fixed_price_v2(&config, &registry,
        &collection_obj, &mut seller, &cap, 10000, scenario.ctx());
    assert!(market::soul_listing_version(&soul_listing) == 2, 130);
    // No V6 config/admin is needed. Both existing cancellation paths remain
    // available during secondary pause and return the exact purchase caps.
    market::update_config_v2_secondary_enabled(&mut config, &admin, false);
    market::cancel_soul_listing(&mut seller, &cap, &mut state, &mut soul_listing);
    market::cancel_collection_listing(&mut seller, &cap, &mut collection_listing);
    assert!(!soul::is_listed(&state) && soul::ownership_epoch(&state) == 0, 131);
    let _soul = kiosk::borrow<Soul>(&seller, personal_kiosk::borrow(&cap), soul_id);
    let _right = kiosk::borrow<SoulCollectionRight>(&seller, personal_kiosk::borrow(&cap), right_id);
    market::delete_soul_listing(soul_listing, scenario.ctx());
    market::delete_collection_listing(collection_listing, scenario.ctx());
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    let soul_listing = if (bind_collection)
        market::list_soul_fixed_price_with_collection_v2(&config, &registry, &collection_obj,
            &mut seller, &cap, &mut state, 10000, scenario.ctx())
        else market::list_soul_fixed_price_v2(&config, &registry, &mut seller, &cap,
            &mut state, 10000, scenario.ctx());
    let collection_listing = market::list_collection_right_fixed_price_v2(&config, &registry,
        &collection_obj, &mut seller, &cap, 10000, scenario.ctx());
    let soul_listing_id = object::id(&soul_listing);
    let collection_listing_id = object::id(&collection_listing);
    market::finalize_soul_listing(soul_listing);
    market::finalize_collection_listing(collection_listing);
    market::finalize_soul_state(state);
    market::finalize_collection(collection_obj);
    ts::return_shared(seller); ts::return_shared(registry);
    ts::return_shared(soul_policy); ts::return_shared(collection_policy);
    ts::return_to_sender(&scenario, cap);
    scenario.next_tx(BUYER);
    let mut seller = ts::take_shared_by_id<Kiosk>(&scenario, seller_id);
    let mut buyer = ts::take_shared_by_id<Kiosk>(&scenario, buyer_id);
    let cap = ts::take_from_sender<PersonalKioskCap>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let collection_policy = ts::take_shared<TransferPolicy<SoulCollectionRight>>(&scenario);
    let mut state = ts::take_shared_by_id<SoulState>(&scenario, state_id);
    let mut collection_obj = ts::take_shared_by_id<SoulCollection>(&scenario, collection_id);
    let mut soul_listing = ts::take_shared_by_id<SoulListing>(&scenario, soul_listing_id);
    let mut collection_listing = ts::take_shared_by_id<CollectionListing>(&scenario, collection_listing_id);
    let (soul_fee, soul_price, creator, collection_royalty, soul_total) =
        market::quote_soul_purchase_v2(&config, 10000, 250, if (bind_collection) 250 else 0);
    assert!(soul_fee == 250 && soul_price == 10000 && creator == 250
        && collection_royalty == (if (bind_collection) 250 else 0)
        && soul_total == (if (bind_collection) 10750 else 10500), 132);
    let payment = coin::mint_for_testing<USDC>(soul_total, scenario.ctx());
    if (bind_collection) market::buy_soul_fixed_price_with_collection_v2(&config, &registry,
        &soul_policy, &collection_obj, &mut seller, &mut buyer, &cap, &mut state,
        &mut soul_listing, payment, scenario.ctx())
    else market::buy_soul_fixed_price_v2(&config, &registry, &soul_policy, &mut seller,
        &mut buyer, &cap, &mut state, &mut soul_listing, payment, scenario.ctx());
    let (collection_fee, collection_price, collection_total) = market::quote_collection_purchase_v2(&config, 10000);
    assert!(collection_fee == 250 && collection_price == 10000 && collection_total == 10250, 133);
    let payment = coin::mint_for_testing<USDC>(collection_total, scenario.ctx());
    market::buy_collection_right_fixed_price_v2(&config, &registry, &collection_policy,
        &mut collection_obj, &mut seller, &mut buyer, &cap, &mut collection_listing, payment, scenario.ctx());
    assert!(soul::current_owner(&state) == BUYER && soul::ownership_epoch(&state) == 1
        && soul::current_kiosk_id(&state) == buyer_id && !soul::is_listed(&state), 134);
    assert!(collection::current_holder(&collection_obj) == BUYER
        && collection::current_holder_kiosk_id(&collection_obj) == buyer_id, 135);
    // Right transfer neither enforces nor mutates the Soul listing floor.
    assert!(collection::floor_price_atomic(&collection_obj) == option::some(99_999_999_999_999_999_999), 136);
    let _soul = kiosk::borrow<Soul>(&buyer, personal_kiosk::borrow(&cap), soul_id);
    let _right = kiosk::borrow<SoulCollectionRight>(&buyer, personal_kiosk::borrow(&cap), right_id);
    ts::return_shared(seller); ts::return_shared(buyer); ts::return_shared(registry);
    ts::return_shared(soul_policy); ts::return_shared(collection_policy);
    ts::return_shared(state); ts::return_shared(collection_obj);
    ts::return_shared(soul_listing); ts::return_shared(collection_listing);
    ts::return_to_sender(&scenario, cap);
    scenario.next_tx(ADMIN);
    let fee_a = ts::take_from_address<Coin<USDC>>(&scenario, ADMIN);
    let fee_b = ts::take_from_address<Coin<USDC>>(&scenario, ADMIN);
    let seller_a = ts::take_from_address<Coin<USDC>>(&scenario, PLAYER);
    let seller_b = ts::take_from_address<Coin<USDC>>(&scenario, PLAYER);
    assert!(fee_a.value() == 250 && fee_b.value() == 250
        && seller_a.value() + seller_b.value() == (if (bind_collection) 20500 else 20250), 136);
    fee_a.burn_for_testing(); fee_b.burn_for_testing(); seller_a.burn_for_testing(); seller_b.burn_for_testing();
    ts::return_shared(config); ts::return_to_sender(&scenario, admin);
    scenario.end();
}
