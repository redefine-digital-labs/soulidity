#[test_only]
module soulidity::collection_tradeability_tests;

use std::string;
use sui::test_scenario::{Self as ts, Scenario};
use soulidity::{collection::{Self as collection, SoulCollection},
    market::{Self as market, MarketConfigV2, MarketAdminCapV2}, soul::{Self as soul, SoulState}};

const OWNER: address = @0xA11;

fun id(value: address): ID { object::id_from_address(value) }

/// Fresh V2 market (default platform fee 250 bps) plus an owner-created
/// collection and an owner-created, owner-held Soul state.
fun setup(s: &mut Scenario, creator_bps: u16, extra_bps: u16, primary: bool): (MarketConfigV2, SoulCollection, SoulState) {
    market::init_fresh_for_testing(OWNER, s.ctx()); s.next_tx(OWNER);
    let mut config = s.take_shared<MarketConfigV2>(); let admin = s.take_from_sender<MarketAdminCapV2>();
    market::update_config_v2_primary_enabled(&mut config, &admin, primary);
    ts::return_to_sender(s, admin);
    let (root, right) = collection::create(string::utf8(b"Collection"), string::utf8(b"Right"),
        string::utf8(b"https://example.com/right"), extra_bps, true, option::none(), option::none(), OWNER, id(@0x43), s.ctx());
    collection::destroy_right_for_testing(right);
    let state = soul::create_state(id(@0x42), OWNER, creator_bps, OWNER, id(@0x43), s.ctx());
    (config, root, state)
}

fun finish(s: Scenario, config: MarketConfigV2, root: SoulCollection, state: SoulState) {
    ts::return_shared(config); collection::destroy_collection_for_testing(root); soul::destroy_state_for_testing(state); s.end();
}

#[test]
fun ordinary_soul_joins_collection_through_market_wrapper() {
    let mut s = ts::begin(OWNER); let (config, mut root, mut state) = setup(&mut s, 500, 500, true);
    market::add_soul_to_collection_v2(&config, &mut root, &mut state, s.ctx());
    assert!(collection::current_supply(&root) == 1 && *soul::collection_id(&state) == option::some(object::id(&root)), 99);
    finish(s, config, root, state);
}

#[test, expected_failure(abort_code = 8, location = soulidity::collection)]
fun native_soul_cannot_join_collection() {
    let mut s = ts::begin(OWNER); let (config, mut root, mut state) = setup(&mut s, 500, 500, true);
    soul::bind_animacraft_native_v8(&mut state, id(@0x45));
    market::add_soul_to_collection_v2(&config, &mut root, &mut state, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 8, location = soulidity::collection)]
fun native_soul_is_rejected_by_collection_itself() {
    let mut s = ts::begin(OWNER); let (_config, mut root, mut state) = setup(&mut s, 500, 500, true);
    soul::bind_animacraft_native_v8(&mut state, id(@0x45));
    collection::add_soul(&mut root, &mut state, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 10, location = soulidity::market)]
fun combined_royalty_over_cap_is_rejected() {
    // 250 (platform) + 9750 (creator) + 500 (collection) = 10500 > 10000
    let mut s = ts::begin(OWNER); let (config, mut root, mut state) = setup(&mut s, 9750, 500, true);
    market::add_soul_to_collection_v2(&config, &mut root, &mut state, s.ctx()); abort 99
}

#[test]
fun combined_royalty_at_cap_is_accepted() {
    // 250 + 9250 + 500 = 10000
    let mut s = ts::begin(OWNER); let (config, mut root, mut state) = setup(&mut s, 9250, 500, true);
    market::add_soul_to_collection_v2(&config, &mut root, &mut state, s.ctx());
    assert!(collection::current_supply(&root) == 1, 99);
    finish(s, config, root, state);
}

#[test, expected_failure(abort_code = 60, location = soulidity::market)]
fun closed_primary_gate_rejects_add_soul() {
    let mut s = ts::begin(OWNER); let (config, mut root, mut state) = setup(&mut s, 500, 500, false);
    market::add_soul_to_collection_v2(&config, &mut root, &mut state, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 6, location = soulidity::collection)]
fun listed_soul_is_still_rejected_through_wrapper() {
    let mut s = ts::begin(OWNER); let (config, mut root, mut state) = setup(&mut s, 500, 500, true);
    soul::set_listed(&mut state, true);
    market::add_soul_to_collection_v2(&config, &mut root, &mut state, s.ctx()); abort 99
}
