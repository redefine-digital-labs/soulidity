#[test_only]
module soulidity::access_mutation_snapshot_tests;

use std::bcs;
use sui::{clock::{Self as clock, Clock}, event, test_scenario::{Self as ts, Scenario}};
use soulidity::{soul::{Self as soul, SoulState}, grant, paid_access::{Self as paid, SoulPaidAccessList},
    kind_registry::{Self as kinds, KindRegistry}, market::{Self as market, MarketConfigV2, MarketAdminCapV2}};

const OWNER: address = @0xA11;
const BUYER: address = @0xB22;
const OTHER: address = @0xC33;
fun id(a: address): ID { object::id_from_address(a) }
fun setup(s: &mut Scenario): (SoulState, SoulPaidAccessList, KindRegistry, Clock) {
    kinds::init_for_testing(s.ctx()); s.next_tx(OWNER);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    soul::set_content_id(&mut state, id(@0x45));
    let list = paid::create(soul::soul_id(&state), OWNER, s.ctx());
    soul::set_access_list_id(&mut state, object::id(&list));
    let clock = clock::create_for_testing(s.ctx());
    grant::set_grant_capacity(&mut state, 3, &clock, s.ctx());
    (state, list, s.take_shared<KindRegistry>(), clock)
}
fun finish(s: Scenario, state: SoulState, list: SoulPaidAccessList, registry: KindRegistry, clock: Clock) {
    soul::share_state(state); paid::share_paid_access_list(list); ts::return_shared(registry); clock.destroy_for_testing(); s.end();
}
fun slot(state: &SoulState): Option<vector<u8>> {
    if (soul::active_grant_has_grantee_row(state, BUYER)) {
        option::some(bcs::to_bytes(soul::active_grant_slot_for_grantee(state, BUYER)))
    } else { option::none() }
}
fun grant_guard(state: &SoulState, expected: Option<vector<u8>>, live: bool, clock: &Clock) {
    grant::assert_mutation_snapshot(state, id(@0x42), BUYER, soul::ownership_epoch(state),
        soul::grant_capacity(state), soul::active_grant_count(state), expected, live, clock);
}
fun issue(state: &mut SoulState, clock: &Clock, ctx: &mut TxContext) {
    grant::issue_to_grantee(state, BUYER, 3, option::some(10), clock, ctx);
}
fun configure(list: &mut SoulPaidAccessList, state: &SoulState, registry: &KindRegistry, ctx: &TxContext) {
    paid::configure_paid_access_kind(list, state, registry, kinds::kind_sprite(), 100, 8, option::some(10), ctx);
}
fun add(list: &mut SoulPaidAccessList, state: &SoulState, registry: &KindRegistry, kind: u32, expiry: u64, clock: &Clock, ctx: &mut TxContext) {
    paid::add_access(list, state, registry, BUYER, kind, 8, option::some(expiry), clock, ctx);
}
fun paid_guard(list: &SoulPaidAccessList, state: &SoulState, config: Option<vector<u8>>, table: Option<vector<u8>>, entry: Option<vector<u8>>) {
    paid::assert_mutation_snapshot(list, state, id(@0x42), kinds::kind_sprite(), option::some(BUYER),
        soul::ownership_epoch(state), config, table, entry);
}

#[test]
fun exact_guards_read_only_empty_live_expired_stale_and_zero_capacity() {
    let mut s = ts::begin(OWNER); let (mut state, list, registry, mut clock) = setup(&mut s);
    let before = bcs::to_bytes(&state); let events = event::num_events();
    grant_guard(&state, option::none(), false, &clock); grant::assert_capacity(&state, 3);
    grant::assert_preserves_active_scopes(&state, BUYER, 1, &clock);
    assert!(before == bcs::to_bytes(&state) && events == event::num_events(), 99);
    grant::set_grant_capacity(&mut state, 0, &clock, s.ctx()); grant::assert_capacity(&state, 0);
    grant::set_grant_capacity(&mut state, 3, &clock, s.ctx()); issue(&mut state, &clock, s.ctx());
    let raw = slot(&state); grant_guard(&state, raw, true, &clock);
    grant::assert_preserves_active_scopes(&state, BUYER, 7, &clock);
    clock.increment_for_testing(10); grant_guard(&state, raw, false, &clock);
    grant::assert_preserves_active_scopes(&state, BUYER, 1, &clock);
    soul::rotate_owner(&mut state, OTHER, id(@0x44)); grant_guard(&state, raw, false, &clock);
    finish(s, state, list, registry, clock);
}
#[test]
fun guards_compose_with_existing_issue_partial_revoke_config_and_manual_access() {
    let mut s = ts::begin(OWNER); let (mut state, mut list, registry, clock) = setup(&mut s);
    grant_guard(&state, option::none(), false, &clock); issue(&mut state, &clock, s.ctx());
    grant_guard(&state, slot(&state), true, &clock);
    grant::revoke_scope_to_grantee(&mut state, BUYER, 1, &clock, s.ctx());
    assert!(soul::active_grant_slot_scope_mask(soul::active_grant_slot_for_grantee(&state, BUYER)) == 2, 99);
    grant_guard(&state, slot(&state), true, &clock); grant::revoke(&mut state, BUYER, &clock, s.ctx());
    grant_guard(&state, option::none(), false, &clock); assert!(soul::active_grant_count(&state) == 0, 99);
    paid_guard(&list, &state, option::none(), option::none(), option::none()); configure(&mut list, &state, &registry, s.ctx());
    let (cfg, table, entry) = paid::mutation_rows_for_testing(&list, kinds::kind_sprite(), BUYER);
    paid_guard(&list, &state, cfg, table, entry); add(&mut list, &state, &registry, kinds::kind_sprite(), 10, &clock, s.ctx());
    let (cfg, table, entry) = paid::mutation_rows_for_testing(&list, kinds::kind_sprite(), BUYER);
    paid_guard(&list, &state, cfg, table, entry); paid::revoke_access(&mut list, &state, BUYER, kinds::kind_sprite(), s.ctx());
    paid_guard(&list, &state, cfg, option::none(), option::none()); assert!(!paid::has_buyer_row(&list, BUYER), 99);
    paid::delete_paid_access_kind(&mut list, &state, kinds::kind_sprite(), s.ctx());
    paid_guard(&list, &state, option::none(), option::none(), option::none());
    finish(s, state, list, registry, clock);
}
#[test, expected_failure(abort_code = 1, location = soulidity::soul)]
fun grant_guard_does_not_authorize_non_owner() {
    let mut s = ts::begin(OWNER); let (mut state, _list, _registry, clock) = setup(&mut s); s.next_tx(OTHER);
    grant_guard(&state, option::none(), false, &clock); issue(&mut state, &clock, s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 1, location = soulidity::paid_access)]
fun paid_guard_does_not_authorize_non_owner() {
    let mut s = ts::begin(OWNER); let (state, mut list, registry, _clock) = setup(&mut s); s.next_tx(OTHER);
    paid_guard(&list, &state, option::none(), option::none(), option::none()); configure(&mut list, &state, &registry, s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 6, location = soulidity::grant)]
fun removing_sdk_wall_clock_does_not_allow_expired_new_grant() {
    let mut s = ts::begin(OWNER); let (mut state, _list, _registry, mut clock) = setup(&mut s); clock.increment_for_testing(10);
    grant_guard(&state, option::none(), false, &clock); issue(&mut state, &clock, s.ctx()); abort 99
}
fun changed_grant(mode: u8) {
    let mut s = ts::begin(OWNER); let (mut state, _list, _registry, mut clock) = setup(&mut s);
    issue(&mut state, &clock, s.ctx()); let raw = slot(&state);
    if (mode == 0) { soul::rotate_owner(&mut state, OTHER, id(@0x44)); soul::rotate_owner(&mut state, OWNER, id(@0x43)); };
    if (mode == 1) issue(&mut state, &clock, s.ctx());
    if (mode == 2) grant::set_grant_capacity(&mut state, 100, &clock, s.ctx());
    if (mode == 3) grant::issue_to_grantee(&mut state, OTHER, 1, option::none(), &clock, s.ctx());
    if (mode == 4) clock.increment_for_testing(10);
    grant::assert_mutation_snapshot(&state, id(@0x42), BUYER, 0, 3, 1, raw, true, &clock); abort 99
}
#[test, expected_failure(abort_code = 17, location = soulidity::grant)] fun grant_epoch_round_trip_rejected() { changed_grant(0); }
#[test, expected_failure(abort_code = 17, location = soulidity::grant)] fun replacement_grant_id_rejected() { changed_grant(1); }
#[test, expected_failure(abort_code = 17, location = soulidity::grant)] fun grant_capacity_changed_rejected() { changed_grant(2); }
#[test, expected_failure(abort_code = 17, location = soulidity::grant)] fun grant_count_changed_rejected() { changed_grant(3); }
#[test, expected_failure(abort_code = 17, location = soulidity::grant)] fun grant_clock_expiry_rejected() { changed_grant(4); }
fun physical_grant_not_absent(stale: bool) {
    let mut s = ts::begin(OWNER); let (mut state, _list, _registry, mut clock) = setup(&mut s); issue(&mut state, &clock, s.ctx());
    if (stale) soul::rotate_owner(&mut state, OTHER, id(@0x44)) else clock.increment_for_testing(10);
    grant_guard(&state, option::none(), false, &clock); abort 99
}
#[test, expected_failure(abort_code = 17, location = soulidity::grant)] fun expired_grant_not_absent() { physical_grant_not_absent(false); }
#[test, expected_failure(abort_code = 17, location = soulidity::grant)] fun old_epoch_grant_not_absent() { physical_grant_not_absent(true); }
#[test, expected_failure(abort_code = 17, location = soulidity::grant)]
fun wrong_grant_soul_rejected() {
    let mut s = ts::begin(OWNER); let (state, _list, _registry, clock) = setup(&mut s);
    grant::assert_mutation_snapshot(&state, id(@0x99), BUYER, 0, 3, 0, option::none(), false, &clock); abort 99
}
#[test, expected_failure(abort_code = 17, location = soulidity::grant)]
fun append_cannot_overwrite_new_capacity() {
    let mut s = ts::begin(OWNER); let (mut state, _list, _registry, clock) = setup(&mut s);
    grant::set_grant_capacity(&mut state, 100, &clock, s.ctx()); grant::assert_capacity(&state, 3); abort 99
}
#[test, expected_failure(abort_code = 17, location = soulidity::grant)]
fun append_cannot_narrow_concurrently_widened_live_scope() {
    let mut s = ts::begin(OWNER); let (mut state, _list, _registry, clock) = setup(&mut s);
    issue(&mut state, &clock, s.ctx()); grant::assert_preserves_active_scopes(&state, BUYER, 1, &clock); abort 99
}
#[test]
fun paid_guard_reads_config_entry_table_and_config_only() {
    let mut s = ts::begin(OWNER); let (state, mut list, registry, clock) = setup(&mut s);
    paid_guard(&list, &state, option::none(), option::none(), option::none());
    configure(&mut list, &state, &registry, s.ctx());
    add(&mut list, &state, &registry, kinds::kind_sprite(), 10, &clock, s.ctx());
    let (cfg, table, entry) = paid::mutation_rows_for_testing(&list, kinds::kind_sprite(), BUYER);
    let before = bcs::to_bytes(&list); let before_state = bcs::to_bytes(&state); let events = event::num_events();
    paid_guard(&list, &state, cfg, table, entry);
    paid::assert_mutation_snapshot(&list, &state, id(@0x42), kinds::kind_sprite(), option::none(), 0, cfg, option::none(), option::none());
    assert!(before == bcs::to_bytes(&list) && before_state == bcs::to_bytes(&state) && events == event::num_events(), 99);
    finish(s, state, list, registry, clock);
}
fun changed_paid(mode: u8) {
    let mut s = ts::begin(OWNER); let (mut state, mut list, registry, clock) = setup(&mut s);
    configure(&mut list, &state, &registry, s.ctx()); add(&mut list, &state, &registry, kinds::kind_sprite(), 10, &clock, s.ctx());
    let (cfg, table, entry) = paid::mutation_rows_for_testing(&list, kinds::kind_sprite(), BUYER);
    if (mode == 0) paid::update_paid_access_kind(&mut list, &state, &registry, kinds::kind_sprite(), 101, 8, option::some(10), s.ctx());
    if (mode == 1) paid::update_paid_access_kind(&mut list, &state, &registry, kinds::kind_sprite(), 100, 8, option::some(20), s.ctx());
    if (mode == 2) paid::delete_paid_access_kind(&mut list, &state, kinds::kind_sprite(), s.ctx());
    if (mode == 3) add(&mut list, &state, &registry, kinds::kind_sprite(), 11, &clock, s.ctx());
    if (mode == 4) add(&mut list, &state, &registry, kinds::kind_audio(), 10, &clock, s.ctx());
    if (mode == 5) {
        paid::revoke_access(&mut list, &state, BUYER, kinds::kind_sprite(), s.ctx());
        add(&mut list, &state, &registry, kinds::kind_sprite(), 10, &clock, s.ctx());
    };
    if (mode == 6) { soul::rotate_owner(&mut state, OTHER, id(@0x44)); soul::rotate_owner(&mut state, OWNER, id(@0x43)); };
    if (mode == 7) paid::revoke_access(&mut list, &state, BUYER, kinds::kind_sprite(), s.ctx());
    paid::assert_mutation_snapshot(&list, &state, id(@0x42), kinds::kind_sprite(), option::some(BUYER), 0, cfg, table, entry); abort 99
}
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)] fun config_price_changed_rejected() { changed_paid(0); }
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)] fun config_duration_changed_rejected() { changed_paid(1); }
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)] fun config_deleted_rejected() { changed_paid(2); }
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)] fun entry_replaced_rejected() { changed_paid(3); }
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)] fun other_kind_table_size_changed_rejected() { changed_paid(4); }
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)] fun buyer_table_identity_churn_rejected() { changed_paid(5); }
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)] fun paid_epoch_round_trip_rejected() { changed_paid(6); }
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)] fun paid_entry_and_last_buyer_row_removed_rejected() { changed_paid(7); }
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)]
fun config_inserted_after_absent_snapshot_rejected() {
    let mut s = ts::begin(OWNER); let (state, mut list, registry, _clock) = setup(&mut s);
    configure(&mut list, &state, &registry, s.ctx());
    paid_guard(&list, &state, option::none(), option::none(), option::none()); abort 99
}
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)]
fun paid_stale_physical_config_not_absent() {
    let mut s = ts::begin(OWNER); let (mut state, mut list, registry, _clock) = setup(&mut s);
    configure(&mut list, &state, &registry, s.ctx()); soul::rotate_owner(&mut state, OTHER, id(@0x44));
    paid_guard(&list, &state, option::none(), option::none(), option::none()); abort 99
}
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)]
fun paid_stale_physical_entry_not_absent() {
    let mut s = ts::begin(OWNER); let (mut state, mut list, registry, clock) = setup(&mut s);
    add(&mut list, &state, &registry, kinds::kind_sprite(), 10, &clock, s.ctx()); soul::rotate_owner(&mut state, OTHER, id(@0x44));
    let (cfg, table, _) = paid::mutation_rows_for_testing(&list, kinds::kind_sprite(), BUYER);
    paid_guard(&list, &state, cfg, table, option::none()); abort 99
}
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)]
fun same_soul_wrong_bound_list_rejected() {
    let mut s = ts::begin(OWNER); let (state, _list, _registry, _clock) = setup(&mut s);
    let wrong = paid::create(id(@0x42), OWNER, s.ctx());
    paid_guard(&wrong, &state, option::none(), option::none(), option::none()); abort 99
}
#[test, expected_failure(abort_code = 14, location = soulidity::paid_access)]
fun config_only_cannot_smuggle_buyer_snapshot() {
    let mut s = ts::begin(OWNER); let (state, list, _registry, _clock) = setup(&mut s);
    paid::assert_mutation_snapshot(&list, &state, id(@0x42), kinds::kind_sprite(), option::none(), 0,
        option::none(), option::some(b"not a table"), option::none()); abort 99
}
fun market_change(mode: u8) {
    let mut s = ts::begin(OWNER); market::init_fresh_for_testing(OWNER, s.ctx()); s.next_tx(OWNER);
    let mut config = s.take_shared<MarketConfigV2>(); let admin = s.take_from_sender<MarketAdminCapV2>();
    let raw = bcs::to_bytes(&config); let events = event::num_events();
    market::assert_paid_access_snapshot_v2(&config, raw);
    assert!(events == event::num_events() && raw == bcs::to_bytes(&config), 99);
    if (mode == 0) market::update_config_v2_fee_recipient(&mut config, &admin, OTHER);
    if (mode == 1) market::update_config_v2_platform_fee_bps(&mut config, &admin, 1);
    if (mode == 2) market::update_config_v2_primary_enabled(&mut config, &admin, true);
    if (mode == 3) market::update_config_v2_secondary_enabled(&mut config, &admin, true);
    market::assert_paid_access_snapshot_v2(&config, raw); abort 99
}
#[test, expected_failure(abort_code = 77, location = soulidity::market)] fun market_recipient_changed_rejected() { market_change(0); }
#[test, expected_failure(abort_code = 77, location = soulidity::market)] fun market_fee_changed_rejected() { market_change(1); }
#[test, expected_failure(abort_code = 77, location = soulidity::market)] fun market_primary_changed_rejected() { market_change(2); }
#[test, expected_failure(abort_code = 77, location = soulidity::market)] fun market_secondary_changed_rejected() { market_change(3); }
