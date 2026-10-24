#[test_only]
module soulidity::listing_freeze_tests;

use std::string::{Self as string, String};
use sui::{clock::{Self as clock, Clock}, test_scenario::{Self as ts, Scenario}};
use soulidity::{content::{Self as content, SoulContent}, grant, kind_registry::{Self as kinds, KindRegistry},
    market::{Self as market, MarketConfig, MarketConfigV2, MarketAdminCapV2}, paid_access,
    protocol_gate::{Self as gate, ProtocolGate}, soul::{Self as soul, SoulState}};
use walrus::{blob::{Self as blob, Blob}, encoding, system, test_utils};

const OWNER: address = @0xA11;
const AGENT: address = @0xB22;

fun id(value: address): ID { object::id_from_address(value) }
fun name(): String { string::utf8(b"sprite") }
fun kind(): u32 { kinds::kind_sprite() }

fun make_blob(walrus: &mut system::System, root: u256, ctx: &mut TxContext): Blob {
    let mut payment = test_utils::mint_frost(1_000_000_000, ctx);
    let size = 1024;
    let storage_size = encoding::encoded_blob_length(size, 1, walrus.n_shards());
    let storage = walrus.reserve_space(storage_size, 3, &mut payment, ctx);
    let result = walrus.register_blob(storage, blob::derive_blob_id(root, 1, size), root, size, 1, false, &mut payment, ctx);
    payment.burn_for_testing(); result
}

/// Two sprite versions appended by the owner; one spare Blob for a later append.
fun setup(s: &mut Scenario): (SoulState, SoulContent, KindRegistry, Clock, ProtocolGate, Blob) {
    kinds::init_for_testing(s.ctx());
    let mut walrus = system::new_for_testing(s.ctx());
    let first = make_blob(&mut walrus, 100, s.ctx()); let first_id = object::id(&first);
    let second = make_blob(&mut walrus, 101, s.ctx()); let second_id = object::id(&second);
    let spare = make_blob(&mut walrus, 102, s.ctx()); let spare_id = object::id(&spare);
    transfer::public_transfer(first, OWNER); transfer::public_transfer(second, OWNER); transfer::public_transfer(spare, OWNER);
    std::unit_test::destroy(walrus); s.next_tx(OWNER);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    let mut content = content::create(soul::soul_id(&state), s.ctx());
    soul::set_content_id(&mut state, object::id(&content));
    let clock = clock::create_for_testing(s.ctx()); let registry = s.take_shared<KindRegistry>();
    let g = gate::new_for_testing(s.ctx());
    let first = ts::take_from_address_by_id<Blob>(s, OWNER, first_id);
    let second = ts::take_from_address_by_id<Blob>(s, OWNER, second_id);
    let spare = ts::take_from_address_by_id<Blob>(s, OWNER, spare_id);
    content::append_version_as_owner(&g, &mut content, &mut state, &registry, kind(), name(), 3, 1, 0, b"envelope0", first, &clock, s.ctx());
    content::append_version_as_owner(&g, &mut content, &mut state, &registry, kind(), name(), 3, 1, 1, b"envelope1", second, &clock, s.ctx());
    (state, content, registry, clock, g, spare)
}

fun finish(s: Scenario, state: SoulState, content: SoulContent, registry: KindRegistry, clock: Clock, g: ProtocolGate) {
    soul::share_state(state); content::share_content(content); ts::return_shared(registry); clock.destroy_for_testing();
    gate::destroy_for_testing(g); s.end();
}

fun be_u32(value: u32): vector<u8> {
    vector[((value >> 24) & 0xFF) as u8, ((value >> 16) & 0xFF) as u8, ((value >> 8) & 0xFF) as u8, (value & 0xFF) as u8]
}

fun be_u64(value: u64): vector<u8> {
    let mut out: vector<u8> = vector[]; let mut shift: u8 = 56; let mut i: u64 = 0;
    while (i < 8) { out.push_back(((value >> shift) & 0xFF) as u8); if (shift >= 8) shift = shift - 8; i = i + 1; };
    out
}

/// Exact Seal document id layout from `content::assert_matching_document_id`.
fun document_id(content: &SoulContent, kind: u32, name: String, version: u64): vector<u8> {
    let mut doc = b"soul-content:"; doc.push_back(1);
    doc.append(be_u32(kind)); doc.append(object::id(content).to_bytes()); doc.append(*name.as_bytes());
    doc.push_back(0); doc.append(be_u64(version));
    doc.append(vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    doc
}

// ── content mutators freeze while the Soul is listed ──────────────────

#[test, expected_failure(abort_code = 37, location = soulidity::content)]
fun listed_soul_rejects_owner_append() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, g, spare) = setup(&mut s);
    soul::set_listed(&mut state, true);
    content::append_version_as_owner(&g, &mut content, &mut state, &registry, kind(), name(), 3, 1, 2, b"envelope2", spare, &clock, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 37, location = soulidity::content)]
fun listed_soul_rejects_owner_delete() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, _clock, g, _spare) = setup(&mut s);
    soul::set_listed(&mut state, true);
    content::delete_version_as_owner(&g, &mut content, &state, &registry, kind(), name(), 0, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 37, location = soulidity::content)]
fun listed_soul_rejects_owner_purge() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, _clock, g, _spare) = setup(&mut s);
    content::delete_version_as_owner(&g, &mut content, &state, &registry, kind(), name(), 0, s.ctx());
    soul::set_listed(&mut state, true);
    content::purge_deleted_version_as_owner(&g, &mut content, &state, &registry, kind(), name(), 0, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 37, location = soulidity::content)]
fun listed_soul_rejects_agent_append() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, g, spare) = setup(&mut s);
    let agent_grant = grant::issue(&g, &mut state, AGENT, grant::scope_assets(), option::none(), &clock, s.ctx());
    soul::set_listed(&mut state, true);
    s.next_tx(AGENT);
    content::append_version_as_granted_agent(&g, &mut content, &mut state, &registry, &agent_grant, kind(), name(), 3, 1, 2,
        b"envelope2", spare, &clock, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 37, location = soulidity::content)]
fun listed_soul_rejects_agent_delete() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, g, _spare) = setup(&mut s);
    let agent_grant = grant::issue(&g, &mut state, AGENT, grant::scope_assets(), option::none(), &clock, s.ctx());
    soul::set_listed(&mut state, true);
    s.next_tx(AGENT);
    content::delete_version_as_granted_agent(&g, &mut content, &state, &registry, &agent_grant, kind(), name(), 0, &clock, s.ctx()); abort 99
}

#[test]
fun cancelled_listing_restores_owner_mutations() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, g, spare) = setup(&mut s);
    soul::set_listed(&mut state, true); soul::set_listed(&mut state, false);
    let version = content::append_version_as_owner(&g, &mut content, &mut state, &registry, kind(), name(), 3, 1, 2, b"envelope2", spare, &clock, s.ctx());
    content::delete_version_as_owner(&g, &mut content, &state, &registry, kind(), name(), 0, s.ctx());
    assert!(version == 2 && content::version_count(&content, kind(), name()) == 3 && content::version_is_deleted(&content, kind(), name(), 0), 99);
    finish(s, state, content, registry, clock, g);
}

#[test]
fun listed_soul_still_allows_owner_seal_read() {
    let mut s = ts::begin(OWNER); let (mut state, content, registry, clock, g, spare) = setup(&mut s);
    soul::set_listed(&mut state, true);
    content::seal_approve_content_owner(document_id(&content, kind(), name(), 1), &g, &state, &content, kind(), name(), 1, s.ctx());
    std::unit_test::destroy(spare);
    finish(s, state, content, registry, clock, g);
}

// ── market config / active-binding wrappers ───────────────────────────

fun market_fixture(s: &mut Scenario): MarketConfigV2 {
    market::init_fresh_for_testing(OWNER, s.ctx()); s.next_tx(OWNER);
    let mut config = s.take_shared<MarketConfigV2>(); let admin = s.take_from_sender<MarketAdminCapV2>();
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    ts::return_to_sender(s, admin);
    config
}

fun key(bytes: vector<u8>): String { string::utf8(bytes) }

#[test, expected_failure(abort_code = 83, location = soulidity::market)]
fun listed_soul_rejects_set_state_config_v2() {
    let mut s = ts::begin(OWNER); let config = market_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    soul::set_listed(&mut state, true);
    market::set_state_config_v2(&config, &mut state, key(b"sprite_config_json"), b"{}", s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 83, location = soulidity::market)]
fun listed_soul_rejects_delete_state_config_v2() {
    let mut s = ts::begin(OWNER); let config = market_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    market::set_state_config_v2(&config, &mut state, key(b"sprite_config_json"), b"{}", s.ctx());
    soul::set_listed(&mut state, true);
    market::delete_state_config_v2(&config, &mut state, key(b"sprite_config_json"), s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 83, location = soulidity::market)]
fun listed_soul_rejects_set_active_content_v2() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, _clock, _g, _spare) = setup(&mut s);
    let config = market_fixture(&mut s);
    soul::set_listed(&mut state, true);
    market::set_active_content_v2(&config, &registry, &mut content, &state, kind(), name(), 0, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 83, location = soulidity::market)]
fun listed_soul_rejects_clear_active_content_v2() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, _clock, _g, _spare) = setup(&mut s);
    let config = market_fixture(&mut s);
    market::set_active_content_v2(&config, &registry, &mut content, &state, kind(), name(), 0, s.ctx());
    soul::set_listed(&mut state, true);
    market::clear_active_content_v2(&config, &registry, &mut content, &state, kind(), s.ctx()); abort 99
}

// ── reserved envelope namespace is protected after mint too ───────────

#[test, expected_failure(abort_code = 82, location = soulidity::market)]
fun reserved_envelope_key_cannot_be_set_after_mint() {
    let mut s = ts::begin(OWNER); let config = market_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    market::set_state_config_v2(&config, &mut state, key(b"content_seal_envelope_v1:deadbeef"), b"garbage", s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 82, location = soulidity::market)]
fun bare_reserved_prefix_is_rejected() {
    let mut s = ts::begin(OWNER); let config = market_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    market::set_state_config_v2(&config, &mut state, key(b"content_seal_envelope_v1:"), b"garbage", s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 82, location = soulidity::market)]
fun real_envelope_cannot_be_deleted_after_mint() {
    let mut s = ts::begin(OWNER); let (mut state, content, _registry, _clock, _g, _spare) = setup(&mut s);
    let config = market_fixture(&mut s);
    let envelope_key = content::envelope_config_key(object::id(&content), kind(), name(), 0);
    assert!(soul::has_state_config(&state, envelope_key), 99);
    market::delete_state_config_v2(&config, &mut state, envelope_key, s.ctx()); abort 99
}

#[test]
fun unreserved_keys_remain_writable_and_deletable() {
    let mut s = ts::begin(OWNER); let config = market_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    market::set_state_config_v2(&config, &mut state, key(b"content_seal_envelope_v2:future"), b"ok", s.ctx());
    market::set_state_config_v2(&config, &mut state, key(b"sprite_config_json"), b"{}", s.ctx());
    assert!(soul::has_state_config(&state, key(b"content_seal_envelope_v2:future")) && soul::has_state_config(&state, key(b"sprite_config_json")), 99);
    market::delete_state_config_v2(&config, &mut state, key(b"sprite_config_json"), s.ctx());
    assert!(!soul::has_state_config(&state, key(b"sprite_config_json")), 99);
    ts::return_shared(config); soul::destroy_state_for_testing(state); s.end();
}

// ── V1 wrappers carry the same guards (dead on a fresh publish, kept consistent) ──

fun market_v1_fixture(s: &mut Scenario): MarketConfig {
    market::init_for_testing(OWNER, s.ctx()); s.next_tx(OWNER);
    s.take_shared<MarketConfig>()
}

#[test, expected_failure(abort_code = 83, location = soulidity::market)]
fun v1_listed_soul_rejects_set_state_config() {
    let mut s = ts::begin(OWNER); let config = market_v1_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    soul::set_listed(&mut state, true);
    market::set_state_config(&config, &mut state, key(b"sprite_config_json"), b"{}", s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 83, location = soulidity::market)]
fun v1_listed_soul_rejects_delete_state_config() {
    let mut s = ts::begin(OWNER); let config = market_v1_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    market::set_state_config(&config, &mut state, key(b"sprite_config_json"), b"{}", s.ctx());
    soul::set_listed(&mut state, true);
    market::delete_state_config(&config, &mut state, key(b"sprite_config_json"), s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 83, location = soulidity::market)]
fun v1_listed_soul_rejects_set_active_content() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, _clock, _g, _spare) = setup(&mut s);
    let config = market_v1_fixture(&mut s);
    soul::set_listed(&mut state, true);
    market::set_active_content(&config, &registry, &mut content, &state, kind(), name(), 0, s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 83, location = soulidity::market)]
fun v1_listed_soul_rejects_clear_active_content() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, _clock, _g, _spare) = setup(&mut s);
    let config = market_v1_fixture(&mut s);
    market::set_active_content(&config, &registry, &mut content, &state, kind(), name(), 0, s.ctx());
    soul::set_listed(&mut state, true);
    market::clear_active_content(&config, &registry, &mut content, &state, kind(), s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 82, location = soulidity::market)]
fun v1_reserved_envelope_key_cannot_be_set() {
    let mut s = ts::begin(OWNER); let config = market_v1_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    market::set_state_config(&config, &mut state, key(b"content_seal_envelope_v1:deadbeef"), b"garbage", s.ctx()); abort 99
}

#[test, expected_failure(abort_code = 82, location = soulidity::market)]
fun v1_reserved_envelope_key_cannot_be_deleted() {
    let mut s = ts::begin(OWNER); let config = market_v1_fixture(&mut s);
    let mut state = soul::create_state(id(@0x42), OWNER, 0, OWNER, id(@0x43), s.ctx());
    market::delete_state_config(&config, &mut state, key(b"content_seal_envelope_v1:deadbeef"), s.ctx()); abort 99
}


/// Objects created in an earlier transaction cannot be shared later
/// (`ESharedNonNewObject`); cross-transaction tests destroy them instead.
fun finish_after_tx(s: Scenario, state: SoulState, content: SoulContent, registry: KindRegistry, clock: Clock, g: ProtocolGate) {
    soul::destroy_state_for_testing(state); content::destroy_for_testing(content); ts::return_shared(registry);
    clock.destroy_for_testing(); gate::destroy_for_testing(g); s.end();
}

// ── Every Seal read path keeps working while the Soul is listed ────────

#[test]
fun listed_soul_still_allows_granted_agent_seal_read() {
    let mut s = ts::begin(OWNER); let (mut state, content, registry, clock, g, spare) = setup(&mut s);
    let agent_grant = grant::issue(&g, &mut state, AGENT, grant::scope_assets(), option::none(), &clock, s.ctx());
    soul::set_listed(&mut state, true);
    s.next_tx(AGENT);
    content::seal_approve_content_granted_agent(document_id(&content, kind(), name(), 1), &g, &state, &content, &agent_grant,
        kind(), name(), 1, &clock, s.ctx());
    grant::destroy_for_testing(agent_grant); std::unit_test::destroy(spare);
    finish_after_tx(s, state, content, registry, clock, g);
}

#[test]
fun listed_soul_still_allows_public_seal_read() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, g, spare) = setup(&mut s);
    // version 2: READ_OWNER | READ_PUBLIC with DOWNLOAD_POLICY_PUBLIC
    content::append_version_as_owner(&g, &mut content, &mut state, &registry, kind(), name(), 9, 0, 2, b"envelope2", spare, &clock, s.ctx());
    soul::set_listed(&mut state, true);
    s.next_tx(AGENT);
    content::seal_approve_content_public(document_id(&content, kind(), name(), 2), &g, &state, &content, kind(), name(), 2, s.ctx());
    finish_after_tx(s, state, content, registry, clock, g);
}

#[test]
fun listed_soul_still_allows_paid_seal_read() {
    let mut s = ts::begin(OWNER); let (mut state, mut content, registry, clock, g, spare) = setup(&mut s);
    // version 2: READ_OWNER | READ_GRANT | READ_PAID
    content::append_version_as_owner(&g, &mut content, &mut state, &registry, kind(), name(), 7, 1, 2, b"envelope2", spare, &clock, s.ctx());
    let mut list = paid_access::create(soul::soul_id(&state), OWNER, s.ctx());
    soul::set_access_list_id(&mut state, object::id(&list));
    paid_access::add_access(&g, &mut list, &state, &registry, AGENT, kind(), grant::scope_assets(), option::none(), &clock, s.ctx());
    soul::set_listed(&mut state, true);
    s.next_tx(AGENT);
    paid_access::seal_approve_content_paid_access(document_id(&content, kind(), name(), 2), &g, &state, &list, &content, kind(), name(), 2,
        &clock, s.ctx());
    std::unit_test::destroy(list);
    finish_after_tx(s, state, content, registry, clock, g);
}
