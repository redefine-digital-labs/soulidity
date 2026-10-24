#[test_only]
module soulidity::protocol_gate_tests;

use std::string::{Self as string, String};
use sui::{clock::{Self as clock, Clock}, event, test_scenario::{Self as ts, Scenario}};
use soulidity::{content::{Self as content, SoulContent}, grant, kind_registry::{Self as kinds, KindRegistry},
    named_loadout_v1, paid_access::{Self as paid_access, SoulPaidAccessList},
    protocol_gate::{Self as gate, ProtocolGate, ProtocolGateCap}, soul::{Self as soul, SoulState}};
use walrus::{blob::{Self as blob, Blob}, encoding, system, test_utils};

const OWNER: address = @0xA11;
const OTHER: address = @0xB22;

fun id(value: address): ID { object::id_from_address(value) }
fun name(): String { string::utf8(b"sprite") }

// ── Gate object semantics ─────────────────────────────────────────────

#[test]
fun init_creates_live_gate_and_matching_cap() {
    let mut s = ts::begin(OWNER);
    gate::init_for_testing(s.ctx()); s.next_tx(OWNER);
    let g = s.take_shared<ProtocolGate>(); let cap = s.take_from_sender<ProtocolGateCap>();
    assert!(gate::version(&g) == gate::protocol_version() && gate::version(&g) == 1 && !gate::is_paused(&g), 99);
    assert!(gate::cap_gate_id(&cap) == object::id(&g), 99);
    gate::assert_live(&g);
    ts::return_shared(g); ts::return_to_sender(&s, cap); s.end();
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun paused_gate_fails_assert_live() {
    let mut s = ts::begin(OWNER);
    gate::init_for_testing(s.ctx()); s.next_tx(OWNER);
    let mut g = s.take_shared<ProtocolGate>(); let cap = s.take_from_sender<ProtocolGateCap>();
    let before = event::num_events();
    gate::set_paused(&mut g, &cap, true);
    assert!(gate::is_paused(&g) && event::num_events() == before + 1, 99);
    gate::assert_live(&g); abort 99
}

#[test]
fun unpausing_restores_liveness() {
    let mut s = ts::begin(OWNER);
    gate::init_for_testing(s.ctx()); s.next_tx(OWNER);
    let mut g = s.take_shared<ProtocolGate>(); let cap = s.take_from_sender<ProtocolGateCap>();
    gate::set_paused(&mut g, &cap, true);
    gate::set_paused(&mut g, &cap, false);
    assert!(!gate::is_paused(&g), 99);
    gate::assert_live(&g);
    ts::return_shared(g); ts::return_to_sender(&s, cap); s.end();
}

#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)]
fun stale_version_fails_assert_live() {
    let mut s = ts::begin(OWNER);
    let mut g = gate::new_for_testing(s.ctx());
    gate::set_version_for_testing(&mut g, 2);
    gate::assert_live(&g); abort 99
}

#[test, expected_failure(abort_code = 2, location = soulidity::protocol_gate)]
fun foreign_cap_cannot_pause() {
    let mut s = ts::begin(OWNER);
    let mut g = gate::new_for_testing(s.ctx());
    let other = gate::new_for_testing(s.ctx());
    let cap = gate::new_cap_for_testing(&other, s.ctx());
    gate::set_paused(&mut g, &cap, true); abort 99
}

#[test, expected_failure(abort_code = 3, location = soulidity::protocol_gate)]
fun migrate_aborts_when_gate_is_already_current() {
    let mut s = ts::begin(OWNER);
    gate::init_for_testing(s.ctx()); s.next_tx(OWNER);
    let mut g = s.take_shared<ProtocolGate>(); let cap = s.take_from_sender<ProtocolGateCap>();
    gate::migrate(&mut g, &cap); abort 99
}

#[test]
fun migrate_bumps_stale_gate_to_current_version() {
    let mut s = ts::begin(OWNER);
    let mut g = gate::new_for_testing(s.ctx()); let cap = gate::new_cap_for_testing(&g, s.ctx());
    gate::set_version_for_testing(&mut g, 0);
    gate::migrate(&mut g, &cap);
    assert!(gate::version(&g) == gate::protocol_version(), 99);
    gate::assert_live(&g);
    gate::destroy_for_testing(g); gate::destroy_cap_for_testing(cap); s.end();
}

#[test, expected_failure(abort_code = 2, location = soulidity::protocol_gate)]
fun foreign_cap_cannot_migrate() {
    let mut s = ts::begin(OWNER);
    let mut g = gate::new_for_testing(s.ctx());
    let other = gate::new_for_testing(s.ctx());
    let cap = gate::new_cap_for_testing(&other, s.ctx());
    gate::set_version_for_testing(&mut g, 0);
    gate::migrate(&mut g, &cap); abort 99
}

// ── Gate consulted before any other check on every gated entry ────────

fun make_blob(walrus: &mut system::System, root: u256, ctx: &mut TxContext): Blob {
    let mut payment = test_utils::mint_frost(1_000_000_000, ctx);
    let size = 1024;
    let storage_size = encoding::encoded_blob_length(size, 1, walrus.n_shards());
    let storage = walrus.reserve_space(storage_size, 3, &mut payment, ctx);
    let result = walrus.register_blob(storage, blob::derive_blob_id(root, 1, size), root, size, 1, false, &mut payment, ctx);
    payment.burn_for_testing(); result
}

fun fixture(s: &mut Scenario): (SoulState, SoulContent, KindRegistry, Clock, ProtocolGate, Blob) {
    kinds::init_for_testing(s.ctx());
    let mut walrus = system::new_for_testing(s.ctx());
    let spare = make_blob(&mut walrus, 100, s.ctx()); let spare_id = object::id(&spare);
    transfer::public_transfer(spare, OWNER);
    std::unit_test::destroy(walrus); s.next_tx(OWNER);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    let mut content = content::create(soul::soul_id(&state), s.ctx());
    soul::set_content_id(&mut state, object::id(&content));
    let clock = clock::create_for_testing(s.ctx()); let registry = s.take_shared<KindRegistry>();
    let spare = ts::take_from_address_by_id<Blob>(s, OWNER, spare_id);
    (state, content, registry, clock, gate::new_for_testing(s.ctx()), spare)
}

fun paused(s: &mut Scenario): ProtocolGate {
    let mut g = gate::new_for_testing(s.ctx()); let cap = gate::new_cap_for_testing(&g, s.ctx());
    gate::set_paused(&mut g, &cap, true); gate::destroy_cap_for_testing(cap); g
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun paused_gate_blocks_grant_issue() {
    let mut s = ts::begin(OWNER);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    let clock = clock::create_for_testing(s.ctx()); let g = paused(&mut s);
    let _grant = grant::issue(&g, &mut state, OTHER, grant::scope_skills(), option::none(), &clock, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)]
fun stale_gate_blocks_grant_issue() {
    let mut s = ts::begin(OWNER);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    let clock = clock::create_for_testing(s.ctx());
    let mut g = gate::new_for_testing(s.ctx()); gate::set_version_for_testing(&mut g, 2);
    let _grant = grant::issue(&g, &mut state, OTHER, grant::scope_skills(), option::none(), &clock, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun paused_gate_blocks_owner_append() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, _live, spare) = fixture(&mut s);
    let g = paused(&mut s);
    content::append_version_as_owner(&g, &mut content, &mut state, &registry, kinds::kind_sprite(), name(), 3, 1,
        0, b"envelope0", spare, &clock, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun paused_gate_blocks_owner_seal_approve_before_document_id_parsing() {
    let mut s = ts::begin(OWNER); let (state, content, _registry, _clock, _live, _spare) = fixture(&mut s);
    let g = paused(&mut s);
    content::seal_approve_content_owner(vector[], &g, &state, &content, kinds::kind_sprite(), name(), 0, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun paused_gate_blocks_upload_recovery_approval() {
    let mut s = ts::begin(OWNER); let g = paused(&mut s);
    content::seal_approve_upload_recovery(vector[], &g, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun paused_gate_blocks_paid_access_add() {
    let mut s = ts::begin(OWNER); let (mut state, _content, registry, clock, _live, _spare) = fixture(&mut s);
    let mut list = paid_access::create(soul::soul_id(&state), OWNER, s.ctx());
    soul::set_access_list_id(&mut state, object::id(&list));
    let g = paused(&mut s);
    paid_access::add_access(&g, &mut list, &state, &registry, OTHER, kinds::kind_sprite(), grant::scope_assets(),
        option::none(), &clock, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun paused_gate_blocks_paid_seal_approve() {
    let mut s = ts::begin(OWNER); let (mut state, content, _registry, clock, _live, _spare) = fixture(&mut s);
    let list = paid_access::create(soul::soul_id(&state), OWNER, s.ctx());
    soul::set_access_list_id(&mut state, object::id(&list));
    let g = paused(&mut s);
    paid_access::seal_approve_content_paid_access(vector[], &g, &state, &list, &content, kinds::kind_sprite(), name(), 0,
        &clock, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun paused_gate_blocks_named_loadout_update() {
    let mut s = ts::begin(OWNER);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    let g = paused(&mut s);
    named_loadout_v1::update(&g, &mut state, 0, 0, vector[], id(@0x1), string::utf8(b"x"), vector[], 1, s.ctx()); abort 99
}

#[test]
fun live_gate_allows_grant_issue_and_owner_append() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, live, spare) = fixture(&mut s);
    let issued = grant::issue(&live, &mut state, OTHER, grant::scope_assets(), option::none(), &clock, s.ctx());
    let version = content::append_version_as_owner(&live, &mut content, &mut state, &registry, kinds::kind_sprite(), name(),
        3, 1, 0, b"envelope0", spare, &clock, s.ctx());
    assert!(version == 0 && content::version_count(&content, kinds::kind_sprite(), name()) == 1, 99);
    grant::destroy_for_testing(issued); gate::destroy_for_testing(live);
    soul::share_state(state); content::share_content(content); ts::return_shared(registry); clock.destroy_for_testing(); s.end();
}

// ── Entry matrix: every gated entry aborts on a paused or stale gate ─────
// paused → abort 1; stale (newer package version) → abort 0. The gate check
// runs before any identity / slot / id parsing, so garbage ids are fine.

fun blocked_gate(s: &mut Scenario, stale: bool): ProtocolGate {
    let mut g = gate::new_for_testing(s.ctx());
    if (stale) {
        gate::set_version_for_testing(&mut g, 2);
    } else {
        let cap = gate::new_cap_for_testing(&g, s.ctx());
        gate::set_paused(&mut g, &cap, true);
        gate::destroy_cap_for_testing(cap);
    };
    g
}

fun make_two_blobs(s: &mut Scenario): (Blob, Blob) {
    let mut walrus = system::new_for_testing(s.ctx());
    let first = make_blob(&mut walrus, 200, s.ctx()); let first_id = object::id(&first);
    let second = make_blob(&mut walrus, 201, s.ctx()); let second_id = object::id(&second);
    transfer::public_transfer(first, OWNER); transfer::public_transfer(second, OWNER);
    std::unit_test::destroy(walrus); s.next_tx(OWNER);
    (ts::take_from_address_by_id<Blob>(s, OWNER, first_id), ts::take_from_address_by_id<Blob>(s, OWNER, second_id))
}

/// Live fixtures (one sprite version, one agent grant, one paid-access list)
/// built with a live gate; then entry `case` is invoked with a blocked gate.
fun blocked_entry(case: u8, stale: bool) {
    let mut s = ts::begin(OWNER);
    kinds::init_for_testing(s.ctx());
    let (first, second) = make_two_blobs(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    let mut content = content::create(soul::soul_id(&state), s.ctx());
    soul::set_content_id(&mut state, object::id(&content));
    let clock = clock::create_for_testing(s.ctx()); let registry = s.take_shared<KindRegistry>();
    let live = gate::new_for_testing(s.ctx());
    content::append_version_as_owner(&live, &mut content, &mut state, &registry, kinds::kind_sprite(), name(), 3, 1,
        0, b"envelope0", first, &clock, s.ctx());
    let agent_grant = grant::issue(&live, &mut state, OTHER, grant::scope_assets(), option::none(), &clock, s.ctx());
    let mut list = paid_access::create(soul::soul_id(&state), OWNER, s.ctx());
    soul::set_access_list_id(&mut state, object::id(&list));
    let blocked = blocked_gate(&mut s, stale);
    if (case == 0) grant::revoke(&blocked, &mut state, OTHER, &clock, s.ctx());
    if (case == 1) { let _g = grant::revoke_scope(&blocked, &mut state, OTHER, grant::scope_seal(), &clock, s.ctx()); };
    if (case == 2) grant::revoke_scope_to_grantee(&blocked, &mut state, OTHER, grant::scope_seal(), &clock, s.ctx());
    if (case == 3) grant::cleanup_inactive_grants(&blocked, &mut state, vector[OTHER], &clock);
    if (case == 4) grant::set_grant_capacity(&blocked, &mut state, 5, &clock, s.ctx());
    if (case == 5) grant::issue_to_grantee(&blocked, &mut state, @0xC33, grant::scope_skills(), option::none(), &clock, s.ctx());
    if (case == 6) content::delete_version_as_owner(&blocked, &mut content, &state, &registry, kinds::kind_sprite(), name(), 0, s.ctx());
    if (case == 7) {
        s.next_tx(OTHER);
        content::delete_version_as_granted_agent(&blocked, &mut content, &state, &registry, &agent_grant, kinds::kind_sprite(),
            name(), 0, &clock, s.ctx());
    };
    if (case == 8) {
        content::delete_version_as_owner(&live, &mut content, &state, &registry, kinds::kind_sprite(), name(), 0, s.ctx());
        content::purge_deleted_version_as_owner(&blocked, &mut content, &state, &registry, kinds::kind_sprite(), name(), 0, s.ctx());
    };
    if (case == 9) {
        s.next_tx(OTHER);
        content::append_version_as_granted_agent(&blocked, &mut content, &mut state, &registry, &agent_grant, kinds::kind_sprite(),
            name(), 3, 1, 1, b"envelope1", second, &clock, s.ctx());
    };
    if (case == 10) content::seal_approve_content_public(vector[], &blocked, &state, &content, kinds::kind_sprite(), name(), 0, s.ctx());
    if (case == 11) {
        s.next_tx(OTHER);
        content::seal_approve_content_granted_agent(vector[], &blocked, &state, &content, &agent_grant, kinds::kind_sprite(), name(), 0,
            &clock, s.ctx());
    };
    if (case == 12) paid_access::revoke_access(&blocked, &mut list, &state, OTHER, kinds::kind_sprite(), s.ctx());
    if (case == 13) paid_access::cleanup_stale_entries(&blocked, &mut list, &state, vector[OTHER], vector[kinds::kind_sprite()], s.ctx());
    if (case == 14) named_loadout_v1::seal_approve(vector[], &blocked, &state, 0, s.ctx());
    if (case == 15) {
        let _r = named_loadout_v1::update(&blocked, &mut state, 0, 0, vector[], id(@0x1), string::utf8(b"x"), vector[], 1, s.ctx());
    };
    if (case == 16) grant::destroy_invalidated_grant(&blocked, agent_grant, &mut state, &clock, s.ctx());
    if (case == 17) {
        let (config, _admin) = animacraft_v8_core::protocol_config_v8::new_protocol_for_testing<u64>(true, s.ctx());
        let equipment = animacraft_v8_runtime::runtime_v8::soul_equipment_read_fixture_for_testing(soul::soul_id(&state),
            object::id(&state), OWNER, 0, object::id(&config), s.ctx());
        let _r = named_loadout_v1::save(&blocked, &mut state, &equipment, &config, 0, 0, vector[], id(@0x1), string::utf8(b"x"),
            vector[], 1, 0, vector[], s.ctx());
    };
    abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_grant_revoke() { blocked_entry(0, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_grant_revoke() { blocked_entry(0, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_grant_revoke_scope() { blocked_entry(1, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_grant_revoke_scope() { blocked_entry(1, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_grant_revoke_scope_to_grantee() { blocked_entry(2, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_grant_revoke_scope_to_grantee() { blocked_entry(2, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_grant_cleanup() { blocked_entry(3, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_grant_cleanup() { blocked_entry(3, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_grant_capacity() { blocked_entry(4, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_grant_capacity() { blocked_entry(4, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_grant_issue_to_grantee() { blocked_entry(5, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_grant_issue_to_grantee() { blocked_entry(5, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_owner_delete() { blocked_entry(6, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_owner_delete() { blocked_entry(6, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_agent_delete() { blocked_entry(7, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_agent_delete() { blocked_entry(7, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_owner_purge() { blocked_entry(8, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_owner_purge() { blocked_entry(8, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_agent_append() { blocked_entry(9, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_agent_append() { blocked_entry(9, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_public_seal_approve() { blocked_entry(10, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_public_seal_approve() { blocked_entry(10, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_granted_seal_approve() { blocked_entry(11, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_granted_seal_approve() { blocked_entry(11, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_paid_revoke() { blocked_entry(12, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_paid_revoke() { blocked_entry(12, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_paid_cleanup() { blocked_entry(13, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_paid_cleanup() { blocked_entry(13, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_named_seal_approve() { blocked_entry(14, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_named_seal_approve() { blocked_entry(14, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_named_update_matrix() { blocked_entry(15, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_named_update() { blocked_entry(15, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_grant_destroy() { blocked_entry(16, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_grant_destroy() { blocked_entry(16, true); }
#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)] fun paused_blocks_named_save() { blocked_entry(17, false); }
#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)] fun stale_blocks_named_save() { blocked_entry(17, true); }

// ── Version ordering and migration edges ──────────────────────────────

#[test, expected_failure(abort_code = 0, location = soulidity::protocol_gate)]
fun stale_and_paused_gate_reports_version_mismatch_first() {
    let mut s = ts::begin(OWNER);
    let mut g = gate::new_for_testing(s.ctx()); let cap = gate::new_cap_for_testing(&g, s.ctx());
    gate::set_paused(&mut g, &cap, true);
    gate::set_version_for_testing(&mut g, 2);
    gate::assert_live(&g); abort 99
}

#[test, expected_failure(abort_code = 3, location = soulidity::protocol_gate)]
fun migrate_rejects_gate_newer_than_this_package() {
    let mut s = ts::begin(OWNER);
    let mut g = gate::new_for_testing(s.ctx()); let cap = gate::new_cap_for_testing(&g, s.ctx());
    gate::set_version_for_testing(&mut g, 2);
    gate::migrate(&mut g, &cap); abort 99
}

#[test, expected_failure(abort_code = 1, location = soulidity::protocol_gate)]
fun migrate_preserves_pause() {
    let mut s = ts::begin(OWNER);
    let mut g = gate::new_for_testing(s.ctx()); let cap = gate::new_cap_for_testing(&g, s.ctx());
    gate::set_version_for_testing(&mut g, 0);
    gate::set_paused(&mut g, &cap, true);
    gate::migrate(&mut g, &cap);
    assert!(gate::version(&g) == gate::protocol_version() && gate::is_paused(&g), 99);
    gate::assert_live(&g); abort 99
}
