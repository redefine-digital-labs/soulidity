/// Fresh-target policy units. Complete mint/read/DF9 market integration lives
/// in the upper graph; the quote fixture below is NOT native mint evidence.
///
/// Retired protocol-case mapping (33 cases, not33 claimed equivalent passes):
/// -14 V5: two old mint ABIs and old V4 listing are removed symbols, not callable
///  failure fixtures. Generic listing rejection now uses real DF9 in upper.
///  Mint rights derive from actual authorization in native_completion; protected
///  current-owner/old-payer reads use the actual upper single-entry/resale tests.
///  Exact gross vectors and four current-rights negatives are below; frozen
///  creator rates and repeated real payments remain in native_market_v8_tests.
/// -3 V4: actual native settlement replaces Maker treasury routing with immutable
///  Maker creator routing; the generic bypass negative is upper. Collection fees
///  are OPEN: upper proves add_soul currently succeeds but native listing rejects.
/// -8 appearance: frozen original and current revision/owned locks map to upper
///  native_equipment/native_external_equipment; owner/listed guards remain in
///  native binding. Fixed-profile replacement semantics and nonempty transfer
///  are OPEN, not equivalent to DF10's current market prohibition. No ACTIVE,
///  appearance snapshot or transferable-equipment flag is manufactured here.
/// -8 retirement: fresh V2 independent gates below and real ordinary Soul plus
///  Collection settlement in native_market_v8_tests replace migration semantics.
/// The3 old wallet-wrapper cases map to actual native equipment owner/lock paths;
/// this inventory must not be used as an assertion of browser appearance parity.
#[test_only]
module soulidity::native_cutover_policy_tests;

use animacraft_v8_core::maker_v8 as maker;
use animacraft_v8_output::output_v8 as output;
use soulidity::market::{Self as market, MarketConfigV2, MarketAdminCapV2, KioskRegistry};
use soulidity::soul;
use sui::test_scenario as ts;

const AUTHOR: address = @0xA11;

fun assert_quote(scenario: &mut ts::Scenario, creator: u16, source: u16, expected_seller: u64) {
    let mut state = soul::create_state(object::id_from_address(@0x101), AUTHOR,
        creator, AUTHOR, object::id_from_address(@0x102), scenario.ctx());
    let binding = output::native_soul_binding_for_testing_v8(soul::soul_id(&state),
        object::id(&state), AUTHOR, AUTHOR, creator, source, scenario.ctx());
    soul::bind_animacraft_native_v8(&mut state, object::id(&binding));
    let (seller, protocol, soul_creator, maker_source) =
        market::quote_animacraft_v8_soul_sale(&state, &binding, 1_000_000);
    assert!(seller == expected_seller && protocol == 25_000
        && soul_creator == (creator as u64) * 100
        && maker_source == (source as u64) * 100
        && seller + protocol + soul_creator + maker_source == 1_000_000, 99);
    output::freeze_native_soul_binding_v8(binding);
    soul::destroy_state_for_testing(state);
    scenario.next_tx(AUTHOR);
}

// Replaces animacraft_v5_quote_uses_the_approved_gross_price_distribution.
// All original exact amounts remain, while Core additionally permits each
// individual royalty up to1000bps (not the retired500bps cap).
#[test] fun native_quote_preserves_all_original_gross_distribution_vectors() {
    let mut scenario = ts::begin(AUTHOR);
    assert_quote(&mut scenario, 250, 300, 920_000);
    assert_quote(&mut scenario, 250, 500, 900_000);
    assert_quote(&mut scenario, 250, 250, 925_000);
    assert_quote(&mut scenario, 500, 500, 875_000);
    assert_quote(&mut scenario, 250, 0, 950_000);
    assert_quote(&mut scenario, 750, 250, 875_000);
    assert_quote(&mut scenario, 1000, 0, 875_000);
    scenario.end();
}

fun invalid_rights(creator: u16, source: u16) {
    let mut scenario = ts::begin(AUTHOR);
    let _rights = maker::new_onchain_native_rights_snapshot_v8(scenario.ctx(), creator, source, 0);
    abort 99
}
// Replaces the obsolete individual500 cap with the actual Core1000 cap;
// sum1000 and both50bps-step negatives preserve the original invariants.
#[test, expected_failure(abort_code = 6, location = animacraft_v8_core::maker_v8)]
fun native_rights_reject_creator_above_current_ten_percent_cap() { invalid_rights(1050, 0); }
#[test, expected_failure(abort_code = 6, location = animacraft_v8_core::maker_v8)]
fun native_rights_reject_combined_pool_above_ten_percent() { invalid_rights(500, 550); }
#[test, expected_failure(abort_code = 6, location = animacraft_v8_core::maker_v8)]
fun native_rights_reject_maker_source_outside_half_percent_steps() { invalid_rights(250, 275); }
#[test, expected_failure(abort_code = 6, location = animacraft_v8_core::maker_v8)]
fun native_rights_reject_creator_outside_half_percent_steps() { invalid_rights(275, 250); }

fun fresh_gates(mode: u8) {
    let mut scenario = ts::begin(AUTHOR);
    market::init_fresh_for_testing(AUTHOR, scenario.ctx());
    scenario.next_tx(AUTHOR);
    let mut config = scenario.take_shared<MarketConfigV2>();
    let admin = scenario.take_from_sender<MarketAdminCapV2>();
    assert!(market::config_v2_legacy_config_id(&config) == object::id_from_address(@0x0)
        && market::admin_cap_v2_config_id(&admin) == object::id(&config)
        && !market::config_v2_primary_enabled(&config)
        && !market::config_v2_secondary_enabled(&config), 99);
    if (mode == 1) market::update_config_v2_primary_enabled(&mut config, &admin, true);
    if (mode <= 1) {
        let (_, _, _, _, _) = market::quote_soul_purchase_v2(&config, 1_000_000, 1000, 500);
        abort 99
    };
    market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    assert!(!market::config_v2_primary_enabled(&config), 99);
    let mut registry = scenario.take_shared<KioskRegistry>();
    let kiosk = market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
    let registration = market::personal_kiosk_registration(&registry, AUTHOR);
    assert!(market::personal_kiosk_registration_version(registration) == 1, 99);
    let (_, _, _, _, total) = market::quote_soul_purchase_v2(&config, 1_000_000, 1000, 500);
    assert!(total == 1_175_000 && kiosk != object::id_from_address(@0x0), 99);
    if (mode == 3) {
        market::update_config_v2_secondary_enabled(&mut config, &admin, false);
        let (_, _, _, _, _) = market::quote_soul_purchase_v2(&config, 1_000_000, 1000, 500);
        abort 99
    };
    ts::return_shared(registry);
    ts::return_shared(config);
    scenario.return_to_sender(admin);
    scenario.end();
}

// The eight retirement tests now map to fresh init (no predecessor authority),
// these independent/reclosable gate checks, plus the actual ordinary V2 Soul
// and Collection list/cancel/buy lifecycle in native_market_v8_tests. No test
// fabricates a predecessor, retires Market, or reopens an obsolete issuer.
#[test, expected_failure(abort_code = 61, location = soulidity::market)]
fun fresh_secondary_defaults_closed_without_retirement() { fresh_gates(0); }
#[test, expected_failure(abort_code = 61, location = soulidity::market)]
fun fresh_primary_activation_does_not_enable_secondary() { fresh_gates(1); }
#[test] fun fresh_secondary_kiosk_and_ordinary_quote_work_with_primary_closed() { fresh_gates(2); }
#[test, expected_failure(abort_code = 61, location = soulidity::market)]
fun fresh_secondary_can_be_reclosed_without_touching_primary() { fresh_gates(3); }
