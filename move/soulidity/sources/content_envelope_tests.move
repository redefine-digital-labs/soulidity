#[test_only]
module soulidity::content_envelope_tests;

use std::{bcs, string::{Self as string, String}};
use sui::{clock::{Self as clock, Clock}, event, test_scenario::{Self as ts, Scenario}};
use soulidity::{content::{Self as content, SoulContent}, soul::{Self as soul, SoulState},
    grant::{Self as grant, SoulGrant}, kind_registry::{Self as kinds, KindRegistry}};
use walrus::{blob::{Self as blob, Blob}, encoding, system, test_utils};

const OWNER: address = @0xA11;
const AGENT: address = @0xB22;
const OTHER: address = @0xC33;

fun id(value: address): ID { object::id_from_address(value) }
fun name(): String { string::utf8(b"skill_intro") }
fun envelope(): vector<u8> { b"opaque-public-encrypted-envelope" }
fun make_blob(walrus: &mut system::System, root: u256, ctx: &mut TxContext): Blob {
    let mut payment = test_utils::mint_frost(1_000_000_000, ctx);
    let size = 1024;
    let storage_size = encoding::encoded_blob_length(size, 1, walrus.n_shards());
    let storage = walrus.reserve_space(storage_size, 3, &mut payment, ctx);
    let result = walrus.register_blob(storage, blob::derive_blob_id(root, 1, size), root, size, 1, false, &mut payment, ctx);
    payment.burn_for_testing(); result
}
fun setup(s: &mut Scenario): (SoulState, SoulContent, KindRegistry, Clock, Blob, Blob) {
    kinds::init_for_testing(s.ctx());
    let mut walrus = system::new_for_testing(s.ctx());
    let first = make_blob(&mut walrus, 100, s.ctx()); let first_id = object::id(&first);
    let second = make_blob(&mut walrus, 101, s.ctx()); let second_id = object::id(&second);
    transfer::public_transfer(first, OWNER); transfer::public_transfer(second, OWNER);
    std::unit_test::destroy(walrus);
    s.next_tx(OWNER);
    let mut state = soul::create_state(id(@0x42), OWNER, 250, OWNER, id(@0x43), s.ctx());
    let content = content::create(soul::soul_id(&state), s.ctx());
    soul::set_content_id(&mut state, object::id(&content));
    let clock = clock::create_for_testing(s.ctx());
    (state, content, s.take_shared<KindRegistry>(), clock,
        ts::take_from_address_by_id<Blob>(s, OWNER, first_id), ts::take_from_address_by_id<Blob>(s, OWNER, second_id))
}
fun append(content: &mut SoulContent, state: &mut SoulState, registry: &KindRegistry, expected: u64,
    bytes: vector<u8>, blob: Blob, clock: &Clock, ctx: &mut TxContext): u64 {
    content::append_version_as_owner(content, state, registry, kinds::kind_skill(), name(), 3, 0, expected, bytes, blob, clock, ctx)
}
public struct ExpectedConfigEvent has drop { state_id: ID, soul_id: ID, updater: address, key: String }
fun assert_config_event(state: &SoulState, key: String, updater: address) {
    let emitted = event::events_by_type<soul::SoulStateConfigUpserted>();
    assert!(bcs::to_bytes(emitted.borrow(emitted.length() - 1)) == bcs::to_bytes(&ExpectedConfigEvent {
        state_id: object::id(state), soul_id: soul::soul_id(state), updater, key,
    }), 99);
}
fun finish(s: Scenario, state: SoulState, content: SoulContent, registry: KindRegistry, clock: Clock, spare: Blob) {
    soul::share_state(state); content::share_content(content); ts::return_shared(registry);
    clock.destroy_for_testing(); transfer::public_transfer(spare, OWNER); s.end();
}

#[test]
fun owner_append_writes_only_actual_new_version_key_and_emits_existing_event() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, spare) = setup(&mut s);
    let content_id = object::id(&content);
    let old = content::envelope_config_key(content_id, kinds::kind_skill(), name(), 42);
    soul::upsert_state_config(&mut state, old, b"preserved");
    soul::upsert_state_config(&mut state, string::utf8(b"sprite_config"), b"existing-sprite");
    let before_events = event::num_events();
    assert!(append(&mut content, &mut state, &registry, 0, envelope(), first, &clock, s.ctx()) == 0, 99);
    let key = content::envelope_config_key(content_id, kinds::kind_skill(), name(), 0);
    assert!(*soul::state_config(&state, key) == envelope() && *soul::state_config(&state, old) == b"preserved", 99);
    assert!(*soul::state_config(&state, string::utf8(b"sprite_config")) == b"existing-sprite", 99);
    assert!(!soul::has_state_config(&state, content::envelope_config_key(content_id, kinds::kind_skill(), name(), 1)), 99);
    assert!(event::num_events() == before_events + 2, 99);
    assert_config_event(&state, key, OWNER);
    soul::share_state(state); content::share_content(content); ts::return_shared(registry);
    clock.destroy_for_testing(); transfer::public_transfer(spare, OWNER); s.next_tx(OWNER);
    let state = s.take_shared<SoulState>(); let content = s.take_shared<SoulContent>();
    assert!(*soul::state_config(&state, key) == envelope() && content::version_count(&content, kinds::kind_skill(), name()) == 1, 99);
    ts::return_shared(state); ts::return_shared(content); s.end();
}

#[test]
fun granted_append_preserves_owner_envelope_and_unrelated_config() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, second) = setup(&mut s);
    append(&mut content, &mut state, &registry, 0, b"owner-envelope", first, &clock, s.ctx());
    let grant = grant::issue(&mut state, AGENT, grant::scope_skills(), option::some(1000), &clock, s.ctx());
    soul::upsert_state_config(&mut state, string::utf8(b"private-owner-key"), b"unchanged");
    soul::share_state(state); content::share_content(content); ts::return_shared(registry); clock.destroy_for_testing();
    transfer::public_transfer(grant, AGENT); transfer::public_transfer(second, AGENT); s.next_tx(AGENT);
    let mut state = s.take_shared<SoulState>(); let mut content = s.take_shared<SoulContent>();
    let registry = s.take_shared<KindRegistry>(); let grant = s.take_from_sender<SoulGrant>();
    let blob = s.take_from_sender<Blob>(); let clock = clock::create_for_testing(s.ctx());
    let before_events = event::num_events();
    assert!(content::append_version_as_granted_agent(&mut content, &mut state, &registry, &grant, kinds::kind_skill(), name(),
        3, 0, 1, b"agent-envelope", blob, &clock, s.ctx()) == 1, 99);
    let content_id = object::id(&content);
    let key = content::envelope_config_key(content_id, kinds::kind_skill(), name(), 1);
    assert!(*soul::state_config(&state, key) == b"agent-envelope", 99);
    assert!(*soul::state_config(&state, content::envelope_config_key(content_id, kinds::kind_skill(), name(), 0)) == b"owner-envelope", 99);
    assert!(*soul::state_config(&state, string::utf8(b"private-owner-key")) == b"unchanged", 99);
    assert!(event::num_events() == before_events + 2 && soul::active_grant_count(&state) == 1, 99);
    assert_config_event(&state, key, AGENT);
    ts::return_shared(state); ts::return_shared(content); ts::return_shared(registry);
    clock.destroy_for_testing(); ts::return_to_sender(&s, grant); s.end();
}

#[test]
fun exact_65536_byte_envelope_is_stored_without_truncation() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, spare) = setup(&mut s);
    let bytes = vector::tabulate!(65_536, |i| (i % 256) as u8);
    append(&mut content, &mut state, &registry, 0, bytes, first, &clock, s.ctx());
    assert!(*soul::state_config(&state, content::envelope_config_key(object::id(&content), kinds::kind_skill(), name(), 0)) == bytes, 99);
    finish(s, state, content, registry, clock, spare);
}

#[test]
fun initial_package_only_append_persists_required_envelope() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, spare) = setup(&mut s);
    assert!(content::append_initial_invariant_version(&mut content, &mut state, &registry, 0, string::utf8(b"soul"), 3, 0,
        first, 0, envelope(), &clock, s.ctx()) == 0, 99);
    assert!(*soul::state_config(&state, content::envelope_config_key(object::id(&content), 0, string::utf8(b"soul"), 0)) == envelope(), 99);
    finish(s, state, content, registry, clock, spare);
}

fun stale(expected: u64) {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, second) = setup(&mut s);
    append(&mut content, &mut state, &registry, 0, envelope(), first, &clock, s.ctx());
    // A competing append has consumed version 0; retry cannot redirect its key.
    append(&mut content, &mut state, &registry, expected, b"stale", second, &clock, s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 30, location = soulidity::content)] fun stale_zero_cas_rejected() { stale(0); }
#[test, expected_failure(abort_code = 30, location = soulidity::content)] fun future_cas_rejected() { stale(2); }
#[test, expected_failure(abort_code = 30, location = soulidity::content)] fun full_u64_cas_not_truncated() { stale(18_446_744_073_709_551_615); }

fun invalid_size(size: u64) {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, _spare) = setup(&mut s);
    append(&mut content, &mut state, &registry, 0, vector::tabulate!(size, |_| 1), first, &clock, s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 31, location = soulidity::content)] fun empty_envelope_rejected() { invalid_size(0); }
#[test, expected_failure(abort_code = 31, location = soulidity::content)] fun oversized_envelope_rejected() { invalid_size(65_537); }

#[test, expected_failure(abort_code = soulidity::soul::ENotSoulOwner)]
fun wrong_owner_precedes_cas_and_envelope_checks() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, _spare) = setup(&mut s);
    s.next_tx(OTHER); append(&mut content, &mut state, &registry, 999, vector[], first, &clock, s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 3, location = soulidity::content)]
fun different_soul_state_precedes_cas() {
    let mut s = ts::begin(OWNER); let (_state, mut content, registry, clock, first, _spare) = setup(&mut s);
    let mut other = soul::create_state(id(@0x99), OWNER, 0, OWNER, id(@0x43), s.ctx());
    append(&mut content, &mut other, &registry, 999, vector[], first, &clock, s.ctx()); abort 99
}
fun bad_grant(case: u8) {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, mut clock, first, _spare) = setup(&mut s);
    let grant = grant::issue(&mut state, AGENT, if (case == 1) grant::scope_assets() else grant::scope_skills(), option::some(1000), &clock, s.ctx());
    if (case == 2) clock.increment_for_testing(1000);
    if (case == 3) soul::rotate_owner(&mut state, OTHER, id(@0x44));
    s.next_tx(if (case == 0) OTHER else AGENT);
    content::append_version_as_granted_agent(&mut content, &mut state, &registry, &grant, kinds::kind_skill(), name(),
        3, 0, 999, vector[], first, &clock, s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 5, location = soulidity::grant)] fun wrong_grantee_precedes_new_checks() { bad_grant(0); }
#[test, expected_failure(abort_code = 7, location = soulidity::grant)] fun wrong_scope_precedes_new_checks() { bad_grant(1); }
#[test, expected_failure(abort_code = 6, location = soulidity::grant)] fun expired_grant_precedes_new_checks() { bad_grant(2); }
#[test, expected_failure(abort_code = 3, location = soulidity::grant)] fun rotated_grant_precedes_new_checks() { bad_grant(3); }

#[test, expected_failure(abort_code = 30, location = soulidity::content)]
fun granted_competing_append_cannot_reuse_consumed_version() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, second) = setup(&mut s);
    let grant = grant::issue(&mut state, AGENT, grant::scope_skills(), option::none(), &clock, s.ctx());
    append(&mut content, &mut state, &registry, 0, b"owner-won-version-zero", first, &clock, s.ctx());
    s.next_tx(AGENT);
    content::append_version_as_granted_agent(&mut content, &mut state, &registry, &grant, kinds::kind_skill(), name(),
        3, 0, 0, envelope(), second, &clock, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 3, location = soulidity::content)]
fun same_soul_with_different_bound_content_is_not_authority() {
    let mut s = ts::begin(OWNER); let (_state, mut content, registry, clock, first, _spare) = setup(&mut s);
    let mut other = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    soul::set_content_id(&mut other, id(@0x999));
    append(&mut content, &mut other, &registry, 0, envelope(), first, &clock, s.ctx()); abort 99
}

#[test]
fun envelope_key_matches_browser_fixed_full_id_and_lossless_u64_vectors() {
    let content = id(@0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef);
    let name = string::utf8(b"sprite_test-01");
    assert!(content::envelope_config_key(content, 3, name, 0) == string::utf8(b"content_seal_envelope_v1:0e133af35791e5cbcf842846f40481e538ab6e3b326eaf1dedb1650c401bf0e2"), 99);
    assert!(content::envelope_config_key(content, 3, name, 9_007_199_254_740_993) == string::utf8(b"content_seal_envelope_v1:f6849109fc2335b07be8622193557d1f9c1e1083bc45e6e06a8bfbe0c114d1af"), 99);
    assert!(content::envelope_config_key(content, 3, name, 18_446_744_073_709_551_615) == string::utf8(b"content_seal_envelope_v1:9acff86596ab185342da93c4015a1cdae818c0b45fc7bd680e3703d01bcc1024"), 99);
}

fun recovery_golden(): vector<u8> {
    x"736f756c2d636f6e74656e742d75706c6f61642d7265636f766572793a0100000000000000000000000000000000000000000000000000000000000000110000000000000000000000000000000000000000000000000000000000000022333333333333333333333333333333333333333333333333333333333333333344444444444444444444444444444444"
}
#[test]
fun author_recovery_approves_exact_binary_namespace_without_state_or_events() {
    let mut s = ts::begin(@0x11); let before = event::num_events(); let id = recovery_golden();
    assert!(id.length() == 142, 99);
    content::seal_approve_upload_recovery(id, s.ctx());
    assert!(event::num_events() == before, 99);
    // Opaque content/operation/nonce do not add authority over a live Soul slot.
    let mut different = recovery_golden(); *different.borrow_mut(62) = 1; *different.borrow_mut(94) = 2; *different.borrow_mut(126) = 3;
    content::seal_approve_upload_recovery(different, s.ctx()); s.end();
}
#[test, expected_failure(abort_code = 34, location = soulidity::content)]
fun other_sender_cannot_approve_upload_recovery() {
    let mut s = ts::begin(@0x12); content::seal_approve_upload_recovery(recovery_golden(), s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 8, location = soulidity::content)]
fun upload_recovery_id_does_not_approve_an_existing_content_document() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, first, _spare) = setup(&mut s);
    append(&mut content, &mut state, &registry, 0, envelope(), first, &clock, s.ctx());
    content::seal_approve_content_owner(recovery_golden(), &state, &content, kinds::kind_skill(), name(), 0, s.ctx()); abort 99
}
fun bad_recovery(case: u8) {
    let mut s = ts::begin(@0x11); let mut id = recovery_golden();
    if (case == 0) id = b"soul-content:old-slot-document";
    if (case == 1) id = vector::tabulate!(32, |_| 1);
    if (case == 2) id.push_back(0);
    if (case == 3) { id.pop_back(); };
    if (case == 4) *id.borrow_mut(29) = 2;
    if (case == 5) *id.borrow_mut(0) = 0;
    if (case == 6) {
        let old = b"soul-content:"; let mut i = 0;
        while (i < old.length()) { *id.borrow_mut(i) = old[i]; i = i + 1; };
    };
    if (case == 7) id = vector[];
    content::seal_approve_upload_recovery(id, s.ctx()); abort 99
}
#[test, expected_failure(abort_code = 32, location = soulidity::content)] fun recovery_rejects_old_content_namespace() { bad_recovery(0); }
#[test, expected_failure(abort_code = 32, location = soulidity::content)] fun recovery_rejects_32_byte_loadout_id() { bad_recovery(1); }
#[test, expected_failure(abort_code = 32, location = soulidity::content)] fun recovery_rejects_trailing_byte() { bad_recovery(2); }
#[test, expected_failure(abort_code = 32, location = soulidity::content)] fun recovery_rejects_short_id() { bad_recovery(3); }
#[test, expected_failure(abort_code = 33, location = soulidity::content)] fun recovery_rejects_other_version() { bad_recovery(4); }
#[test, expected_failure(abort_code = 33, location = soulidity::content)] fun recovery_rejects_domain_drift() { bad_recovery(5); }
#[test, expected_failure(abort_code = 33, location = soulidity::content)] fun recovery_rejects_padded_old_content_namespace() { bad_recovery(6); }
#[test, expected_failure(abort_code = 32, location = soulidity::content)] fun recovery_rejects_empty_id() { bad_recovery(7); }
