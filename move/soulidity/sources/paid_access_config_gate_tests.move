#[test_only]
module soulidity::paid_access_config_gate_tests;

use sui::test_scenario::{Self as ts, Scenario};
use soulidity::{grant, kind_registry::{Self as kinds, KindRegistry},
    market::{Self as market, MarketConfigV2, MarketAdminCapV2},
    paid_access::{Self as paid, SoulPaidAccessList}, soul::{Self as soul, SoulState}};

const OWNER: address = @0xA11;

fun id(value: address): ID { object::id_from_address(value) }

/// `paid_access::configure/update/delete_paid_access_kind` are package-only;
/// wallets reach them only through the market `_v2` wrappers below.
fun setup(s: &mut Scenario, primary: bool): (MarketConfigV2, MarketAdminCapV2, KindRegistry, SoulPaidAccessList, SoulState) {
    market::init_fresh_for_testing(OWNER, s.ctx()); kinds::init_for_testing(s.ctx()); s.next_tx(OWNER);
    let mut config = s.take_shared<MarketConfigV2>(); let admin = s.take_from_sender<MarketAdminCapV2>();
    market::update_config_v2_primary_enabled(&mut config, &admin, primary);
    let registry = s.take_shared<KindRegistry>();
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    let list = paid::create(soul::soul_id(&state), OWNER, s.ctx());
    soul::set_access_list_id(&mut state, object::id(&list));
    (config, admin, registry, list, state)
}

fun finish(s: Scenario, config: MarketConfigV2, admin: MarketAdminCapV2, registry: KindRegistry, list: SoulPaidAccessList, state: SoulState) {
    ts::return_shared(config); ts::return_to_sender(&s, admin); ts::return_shared(registry);
    std::unit_test::destroy(list); soul::destroy_state_for_testing(state); s.end();
}

#[test]
fun open_primary_gate_allows_configure_update_and_delete() {
    let mut s = ts::begin(OWNER); let (config, admin, registry, mut list, state) = setup(&mut s, true);
    market::configure_paid_access_kind_v2(&config, &registry, &mut list, &state, kinds::kind_sprite(), 100, grant::scope_assets(), option::none(), s.ctx());
    assert!(paid::has_kind_config(&list, kinds::kind_sprite()) && paid::kind_config_price_atomic(&list, kinds::kind_sprite()) == 100, 99);
    market::update_paid_access_kind_v2(&config, &registry, &mut list, &state, kinds::kind_sprite(), 200, grant::scope_assets(), option::some(10), s.ctx());
    assert!(paid::kind_config_price_atomic(&list, kinds::kind_sprite()) == 200, 99);
    market::delete_paid_access_kind_v2(&config, &mut list, &state, kinds::kind_sprite(), s.ctx());
    assert!(!paid::has_kind_config(&list, kinds::kind_sprite()), 99);
    finish(s, config, admin, registry, list, state);
}

#[test, expected_failure(abort_code = 60, location = soulidity::market)]
fun closed_primary_gate_rejects_configure() {
    let mut s = ts::begin(OWNER); let (config, _admin, registry, mut list, state) = setup(&mut s, false);
    market::configure_paid_access_kind_v2(&config, &registry, &mut list, &state, kinds::kind_sprite(), 100, grant::scope_assets(), option::none(), s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 60, location = soulidity::market)]
fun closed_primary_gate_rejects_update() {
    let mut s = ts::begin(OWNER); let (mut config, admin, registry, mut list, state) = setup(&mut s, true);
    market::configure_paid_access_kind_v2(&config, &registry, &mut list, &state, kinds::kind_sprite(), 100, grant::scope_assets(), option::none(), s.ctx());
    market::update_config_v2_primary_enabled(&mut config, &admin, false);
    market::update_paid_access_kind_v2(&config, &registry, &mut list, &state, kinds::kind_sprite(), 200, grant::scope_assets(), option::none(), s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 60, location = soulidity::market)]
fun closed_primary_gate_rejects_delete() {
    let mut s = ts::begin(OWNER); let (mut config, admin, registry, mut list, state) = setup(&mut s, true);
    market::configure_paid_access_kind_v2(&config, &registry, &mut list, &state, kinds::kind_sprite(), 100, grant::scope_assets(), option::none(), s.ctx());
    market::update_config_v2_primary_enabled(&mut config, &admin, false);
    market::delete_paid_access_kind_v2(&config, &mut list, &state, kinds::kind_sprite(), s.ctx()); abort 99
}
