#[test_only]
module soulidity::content_mutation_snapshot_tests;

use std::{bcs, string::{Self as string, String}};
use sui::{clock::{Self as clock, Clock}, event, test_scenario::{Self as ts, Scenario}};
use soulidity::{content::{Self as content, SoulContent}, soul::{Self as soul, SoulState},
    grant, kind_registry::{Self as kinds, KindRegistry}};
use walrus::{blob::{Self as blob, Blob}, encoding, system, test_utils};

const OWNER: address = @0xA11;
const OTHER: address = @0xB22;
fun id(value: address): ID { object::id_from_address(value) }
fun name(): String { string::utf8(b"sprite") }
fun make_blob(walrus: &mut system::System, root: u256, ctx: &mut TxContext): Blob {
    let mut payment = test_utils::mint_frost(1_000_000_000, ctx);
    let size = 1024;
    let storage_size = encoding::encoded_blob_length(size, 1, walrus.n_shards());
    let storage = walrus.reserve_space(storage_size, 3, &mut payment, ctx);
    let result = walrus.register_blob(storage, blob::derive_blob_id(root, 1, size), root, size, 1, false, &mut payment, ctx);
    payment.burn_for_testing(); result
}
fun setup(s: &mut Scenario): (SoulState, SoulContent, KindRegistry, Clock) {
    kinds::init_for_testing(s.ctx());
    let mut walrus = system::new_for_testing(s.ctx());
    let first = make_blob(&mut walrus, 100, s.ctx()); let first_id = object::id(&first);
    let second = make_blob(&mut walrus, 101, s.ctx()); let second_id = object::id(&second);
    transfer::public_transfer(first, OWNER); transfer::public_transfer(second, OWNER);
    std::unit_test::destroy(walrus); s.next_tx(OWNER);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    let mut content = content::create(soul::soul_id(&state), s.ctx());
    soul::set_content_id(&mut state, object::id(&content));
    let clock = clock::create_for_testing(s.ctx()); let registry = s.take_shared<KindRegistry>();
    let first = ts::take_from_address_by_id<Blob>(s, OWNER, first_id);
    let second = ts::take_from_address_by_id<Blob>(s, OWNER, second_id);
    content::append_version_as_owner(&mut content, &mut state, &registry, kinds::kind_sprite(), name(), 3, 1,
        0, b"envelope0", first, &clock, s.ctx());
    content::append_version_as_owner(&mut content, &mut state, &registry, kinds::kind_sprite(), name(), 3, 1,
        1, b"envelope1", second, &clock, s.ctx());
    (state, content, registry, clock)
}
fun finish(s: Scenario, state: SoulState, content: SoulContent, registry: KindRegistry, clock: Clock) {
    soul::share_state(state); content::share_content(content); ts::return_shared(registry); clock.destroy_for_testing(); s.end();
}
fun assert_none(content: &SoulContent) { content::assert_active_binding(content, kinds::kind_sprite(), option::none(), option::none()); }
fun assert_some(content: &SoulContent, version: u64) {
    content::assert_active_binding(content, kinds::kind_sprite(), option::some(name()), option::some(version));
}
fun set(content: &mut SoulContent, state: &SoulState, registry: &KindRegistry, version: u64, ctx: &TxContext) {
    content::set_active(content, state, registry, kinds::kind_sprite(), name(), version, ctx);
}
fun delete(content: &mut SoulContent, state: &SoulState, registry: &KindRegistry, ctx: &TxContext) {
    content::delete_version_as_owner(content, state, registry, kinds::kind_sprite(), name(), 0, ctx);
}
fun purge(content: &mut SoulContent, state: &SoulState, registry: &KindRegistry, ctx: &mut TxContext) {
    content::purge_deleted_version_as_owner(content, state, registry, kinds::kind_sprite(), name(), 0, ctx);
}

#[test]
fun guards_are_read_only_and_allow_exact_set_clear_delete_purge() {
    let mut s = ts::begin(OWNER); let (state, mut content, registry, clock) = setup(&mut s);
    let before_state = bcs::to_bytes(&state); let before_content = bcs::to_bytes(&content); let before_events = event::num_events();
    content::assert_mutation_scope(&content, &state, 0); assert_none(&content);
    assert!(before_state == bcs::to_bytes(&state) && before_content == bcs::to_bytes(&content) && before_events == event::num_events(), 99);
    set(&mut content, &state, &registry, 0, s.ctx()); assert_some(&content, 0);
    set(&mut content, &state, &registry, 1, s.ctx()); assert_some(&content, 1);
    content::clear_active(&mut content, &state, &registry, kinds::kind_sprite(), s.ctx()); assert_none(&content);
    delete(&mut content, &state, &registry, s.ctx());
    assert!(content::version_is_deleted(&content, kinds::kind_sprite(), name(), 0), 99);
    content::assert_mutation_scope(&content, &state, 0); assert_none(&content);
    purge(&mut content, &state, &registry, s.ctx());
    assert!(content::version_is_purged(&content, kinds::kind_sprite(), name(), 0), 99);
    finish(s, state, content, registry, clock);
}
#[test]
fun current_epoch_after_round_trip_is_accepted() {
    let mut s = ts::begin(OWNER); let (mut state, content, registry, clock) = setup(&mut s);
    soul::rotate_owner(&mut state, OTHER, id(@0x44)); soul::rotate_owner(&mut state, OWNER, id(@0x43));
    content::assert_mutation_scope(&content, &state, 2);
    finish(s, state, content, registry, clock);
}
#[test, expected_failure(abort_code = 35, location = soulidity::content)]
fun owner_round_trip_rejects_old_signed_epoch_even_with_same_slot_count() {
    let mut s = ts::begin(OWNER); let (mut state, content, _registry, _clock) = setup(&mut s);
    soul::rotate_owner(&mut state, OTHER, id(@0x44)); soul::rotate_owner(&mut state, OWNER, id(@0x43));
    assert!(soul::current_owner(&state) == OWNER && content::version_count(&content, kinds::kind_sprite(), name()) == 2, 99);
    content::assert_mutation_scope(&content, &state, 0); abort 99
}
#[test, expected_failure(abort_code = 35, location = soulidity::content)]
fun full_u64_epoch_is_not_truncated() {
    let mut s = ts::begin(OWNER); let (state, content, _registry, _clock) = setup(&mut s);
    content::assert_mutation_scope(&content, &state, 18_446_744_073_709_551_615); abort 99
}
fun wrong_root(same_soul: bool) {
    let mut s = ts::begin(OWNER); let (_state, content, _registry, _clock) = setup(&mut s);
    let mut other = soul::create_state(id(if (same_soul) @0x42 else @0x99), OWNER, 0, OWNER, id(@0x43), s.ctx());
    soul::set_content_id(&mut other, if (same_soul) id(@0x999) else object::id(&content));
    content::assert_mutation_scope(&content, &other, 0); abort 99
}
#[test, expected_failure(abort_code = 3, location = soulidity::content)] fun different_soul_rejected() { wrong_root(false); }
#[test, expected_failure(abort_code = 3, location = soulidity::content)] fun different_bound_content_rejected() { wrong_root(true); }

fun wrong_active(case: u8) {
    let mut s = ts::begin(OWNER); let (state, mut content, registry, _clock) = setup(&mut s);
    if (case != 0 && case != 5) set(&mut content, &state, &registry, 0, s.ctx());
    if (case == 0) assert_some(&content, 0);
    if (case == 1) assert_none(&content);
    if (case == 2) assert_some(&content, 1);
    if (case == 3) content::assert_active_binding(&content, kinds::kind_sprite(), option::some(string::utf8(b"other")), option::some(0));
    if (case == 4) content::assert_active_binding(&content, kinds::kind_sprite(), option::some(name()), option::none());
    if (case == 5) content::assert_active_binding(&content, kinds::kind_sprite(), option::none(), option::some(0));
    if (case == 6) assert_some(&content, 9_007_199_254_740_993);
    abort 99
}
#[test, expected_failure(abort_code = 36, location = soulidity::content)] fun active_removed_rejected() { wrong_active(0); }
#[test, expected_failure(abort_code = 36, location = soulidity::content)] fun active_added_rejected() { wrong_active(1); }
#[test, expected_failure(abort_code = 36, location = soulidity::content)] fun active_index_changed_rejected() { wrong_active(2); }
#[test, expected_failure(abort_code = 36, location = soulidity::content)] fun active_name_changed_rejected() { wrong_active(3); }
#[test, expected_failure(abort_code = 36, location = soulidity::content)] fun missing_expected_index_rejected() { wrong_active(4); }
#[test, expected_failure(abort_code = 36, location = soulidity::content)] fun missing_expected_name_rejected() { wrong_active(5); }
#[test, expected_failure(abort_code = 36, location = soulidity::content)] fun active_full_u64_index_not_truncated() { wrong_active(6); }

#[test, expected_failure(abort_code = 1, location = soulidity::soul)]
fun passing_guards_do_not_authorize_another_owner() {
    let mut s = ts::begin(OWNER); let (state, mut content, registry, _clock) = setup(&mut s);
    s.next_tx(OTHER); content::assert_mutation_scope(&content, &state, 0); assert_none(&content);
    delete(&mut content, &state, &registry, s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 7, location = soulidity::grant)]
fun passing_guards_do_not_expand_a_grantees_scope() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock) = setup(&mut s);
    let grant = grant::issue(&mut state, OTHER, grant::scope_skills(), option::none(), &clock, s.ctx());
    s.next_tx(OTHER); content::assert_mutation_scope(&content, &state, 0); assert_none(&content);
    content::delete_version_as_granted_agent(&mut content, &state, &registry, &grant, kinds::kind_sprite(), name(), 0, &clock, s.ctx()); abort 99
}
fun invalid_slot(case: u8) {
    let mut s = ts::begin(OWNER); let (state, mut content, registry, _clock) = setup(&mut s);
    content::assert_mutation_scope(&content, &state, 0); assert_none(&content);
    if (case == 0) { set(&mut content, &state, &registry, 0, s.ctx()); delete(&mut content, &state, &registry, s.ctx()); };
    if (case == 1) { delete(&mut content, &state, &registry, s.ctx()); delete(&mut content, &state, &registry, s.ctx()); };
    if (case == 2) purge(&mut content, &state, &registry, s.ctx());
    if (case == 3) { delete(&mut content, &state, &registry, s.ctx()); purge(&mut content, &state, &registry, s.ctx()); purge(&mut content, &state, &registry, s.ctx()); };
    if (case == 4) { delete(&mut content, &state, &registry, s.ctx()); set(&mut content, &state, &registry, 0, s.ctx()); };
    abort 99
}
#[test, expected_failure(abort_code = 15, location = soulidity::content)] fun active_delete_still_rejected() { invalid_slot(0); }
#[test, expected_failure(abort_code = 6, location = soulidity::content)] fun repeated_delete_still_rejected() { invalid_slot(1); }
#[test, expected_failure(abort_code = 16, location = soulidity::content)] fun purge_before_delete_still_rejected() { invalid_slot(2); }
#[test, expected_failure(abort_code = 7, location = soulidity::content)] fun repeated_purge_still_rejected() { invalid_slot(3); }
#[test, expected_failure(abort_code = 6, location = soulidity::content)] fun deleted_active_target_still_rejected() { invalid_slot(4); }
