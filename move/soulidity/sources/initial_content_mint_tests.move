#[test_only]
module soulidity::initial_content_mint_tests;

use std::{bcs, string};
use kiosk::personal_kiosk::PersonalKioskCap;
use soulidity::content::{Self as content, SoulContent};
use soulidity::kind_registry::{Self as kinds, KindRegistry};
use soulidity::market::{Self as market, InitialContentEntry, KioskRegistry, MarketConfigV2, MarketAdminCapV2};
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::clock;
use sui::event;
use sui::kiosk::Kiosk;
use sui::test_scenario::{Self as ts, Scenario};
use sui::transfer_policy::TransferPolicy;
use walrus::{blob, encoding, system, test_utils};

const AUTHOR: address = @0xA11;
const OTHER: address = @0xB22;

fun nonce(): vector<u8> { b"0123456789abcdef" }

fun registered_blob(walrus: &mut system::System, root: u256, ctx: &mut TxContext): blob::Blob {
    let mut payment = test_utils::mint_frost(1_000_000_000, ctx);
    let size = 5_000_000;
    let encoded_size = encoding::encoded_blob_length(size, 1, walrus.n_shards());
    let storage = walrus.reserve_space(encoded_size, 3, &mut payment, ctx);
    let result = walrus.register_blob(storage, blob::derive_blob_id(root, 1, size), root, size, 1, false, &mut payment, ctx);
    payment.burn_for_testing();
    result
}

public struct ManifestEvent has drop { author: address, manifest_hash: vector<u8> }

/// Real shared registry from production initializer, with paid Blob objects in
/// prior transactions. No fabricated Content identity or alternate mint helper.
fun prepare(): (Scenario, ID, ID, ID) {
    let mut s = ts::begin(AUTHOR);
    market::init_fresh_for_testing(AUTHOR, s.ctx()); kinds::init_for_testing(s.ctx());
    let mut walrus = system::new_for_testing(s.ctx());
    let mut i: u64 = 0;
    while (i < 9) {
        transfer::public_transfer(registered_blob(&mut walrus, 100 + (i as u256), s.ctx()), if (i < 6) AUTHOR else OTHER);
        i = i + 1;
    };
    std::unit_test::destroy(walrus);
    s.next_tx(AUTHOR);
    let mut config = s.take_shared<MarketConfigV2>(); let admin = s.take_from_sender<MarketAdminCapV2>();
    market::update_config_v2_primary_enabled(&mut config, &admin, true);
    let mut registry = s.take_shared<KioskRegistry>();
    let first_kiosk = market::init_personal_kiosk_v2(&config, &mut registry, s.ctx());
    let future_content = market::derive_mint_content_id(&registry, AUTHOR, nonce());
    ts::return_shared(config); ts::return_shared(registry); s.return_to_sender(admin);
    s.next_tx(OTHER);
    let config = s.take_shared<MarketConfigV2>(); let mut registry = s.take_shared<KioskRegistry>();
    let second_kiosk = market::init_personal_kiosk_v2(&config, &mut registry, s.ctx());
    assert!(market::derive_mint_content_id(&registry, OTHER, nonce()) != future_content, 99);
    ts::return_shared(config); ts::return_shared(registry);
    s.next_tx(AUTHOR);
    let hash = vector::tabulate!(32, |i| (i + 1) as u8);
    market::commit_mint_manifest(hash, s.ctx());
    let events = event::events_by_type<market::MintManifestCommittedV1>();
    assert!(events.length() == 1 && bcs::to_bytes(&events[0]) == bcs::to_bytes(&ManifestEvent { author: AUTHOR, manifest_hash: hash }), 99);
    // Pre-mint commitment neither creates a Soul nor grants decryption rights.
    assert!(event::events_by_type<market::SoulMintedToKiosk>().is_empty(), 99);
    s.next_tx(AUTHOR);
    (s, first_kiosk, second_kiosk, future_content)
}

fun entries(s: &Scenario, mode: u8): vector<InitialContentEntry> {
    let doc = s.take_from_sender<blob::Blob>();
    let memory0 = s.take_from_sender<blob::Blob>();
    let memory1 = s.take_from_sender<blob::Blob>();
    let envelope = if (mode == 3) vector[]
        else if (mode == 4) vector::tabulate!(65_537, |i| (i % 256) as u8)
        else if (mode == 5) vector::tabulate!(65_536, |i| (i % 256) as u8)
        else b"doc-envelope";
    vector[
        market::new_initial_content_entry(0, content::soul_doc_name(), 3, 0, false, doc, 0, envelope),
        market::new_initial_content_entry(1, content::memory_name(), 3, 0, false, memory0, 0, b"memory-0-envelope"),
        market::new_initial_content_entry(1, content::memory_name(), 3, 0, false, memory1, if (mode == 6) 0 else 1, b"memory-1-envelope"),
    ]
}

fun mint(s: &mut Scenario, kiosk_id: ID, expected: ID, mint_nonce: vector<u8>, mode: u8): ID {
    let config = s.take_shared<MarketConfigV2>(); let mut registry = s.take_shared<KioskRegistry>();
    let kinds = s.take_shared<KindRegistry>(); let policy = s.take_shared<TransferPolicy<Soul>>();
    let mut kiosk = s.take_shared_by_id<Kiosk>(kiosk_id); let cap = s.take_from_sender<PersonalKioskCap>();
    let initial = entries(s, mode); let clock = clock::create_for_testing(s.ctx());
    let mut config_entries = vector[market::new_state_config_entry(string::utf8(b"sprite_config_json"), b"preserved")];
    if (mode == 7) config_entries.push_back(market::new_state_config_entry(
        content::envelope_config_key(expected, 0, content::soul_doc_name(), 0), b"substitute"));
    if (mode == 8) config_entries.push_back(market::new_state_config_entry(string::utf8(b"content_seal_envelope_v1:anything"), b"substitute"));
    let state = market::mint_native_in_personal_kiosk_v2(&config, &kinds, &mut registry, &policy,
        &mut kiosk, &cap, string::utf8(b"Soul"), string::utf8(b"description"), string::utf8(b"walrus://image"),
        initial, config_entries, 250, mint_nonce, expected, &clock, s.ctx());
    assert!(soul::require_content_id(&state) == expected, 99);
    assert!(*soul::state_config(&state, string::utf8(b"sprite_config_json")) == b"preserved", 99);
    assert!(*soul::state_config(&state, content::envelope_config_key(expected, 1, content::memory_name(), 0)) == b"memory-0-envelope", 99);
    assert!(*soul::state_config(&state, content::envelope_config_key(expected, 1, content::memory_name(), 1)) == b"memory-1-envelope", 99);
    let state_id = object::id(&state);
    market::finalize_soul_state(state); clock.destroy_for_testing();
    ts::return_shared(config); ts::return_shared(registry); ts::return_shared(kinds); ts::return_shared(policy);
    ts::return_shared(kiosk); s.return_to_sender(cap);
    state_id
}

fun successful(mode: u8) {
    let (mut s, kiosk_id, _, expected) = prepare();
    let state_id = mint(&mut s, kiosk_id, expected, nonce(), mode);
    s.next_tx(AUTHOR);
    // Read back actual shared Content after finalization, proving claim creates
    // a new object in the mint transaction, not a re-shared old UID.
    let content = s.take_shared_by_id<SoulContent>(expected);
    let state = s.take_shared_by_id<SoulState>(state_id);
    assert!(content::soul_id(&content) == soul::soul_id(&state), 99);
    assert!(content::version_count(&content, 1, content::memory_name()) == 2, 99);
    let doc = soul::state_config(&state, content::envelope_config_key(expected, 0, content::soul_doc_name(), 0));
    assert!(doc.length() == if (mode == 5) 65_536 else 12, 99);
    ts::return_shared(content); ts::return_shared(state); s.end();
}

#[test] fun precommitted_derived_content_is_shared_with_all_initial_envelopes() { successful(0); }
#[test] fun initial_envelope_accepts_exact_65536_bytes() { successful(5); }

#[test, expected_failure(abort_code = sui::derived_object::EObjectAlreadyExists)]
fun same_author_nonce_cannot_create_second_soul() {
    let (mut s, kiosk, _, expected) = prepare();
    mint(&mut s, kiosk, expected, nonce(), 0); s.next_tx(AUTHOR);
    mint(&mut s, kiosk, expected, nonce(), 0); abort 99
}

#[test]
fun same_nonce_different_sender_has_independent_identity_not_authority() {
    let (mut s, first_kiosk, second_kiosk, first) = prepare();
    mint(&mut s, first_kiosk, first, nonce(), 0); s.next_tx(OTHER);
    let registry = s.take_shared<KioskRegistry>();
    let second = market::derive_mint_content_id(&registry, OTHER, nonce()); ts::return_shared(registry);
    assert!(first != second, 99);
    s.next_tx(OTHER);
    mint(&mut s, second_kiosk, second, nonce(), 0); s.end();
}

#[test, expected_failure(abort_code = 80, location = soulidity::market)]
fun other_sender_cannot_claim_author_expected_content_id() {
    let (mut s, _, second_kiosk, first) = prepare(); s.next_tx(OTHER);
    mint(&mut s, second_kiosk, first, nonce(), 0); abort 99
}

#[test, expected_failure(abort_code = 80, location = soulidity::market)]
fun incorrect_expected_content_id_aborts_mint() {
    let (mut s, kiosk, _, _) = prepare(); mint(&mut s, kiosk, object::id_from_address(@0x42), nonce(), 0); abort 99
}

#[test, expected_failure(abort_code = 79, location = soulidity::market)]
fun short_nonce_cannot_claim() {
    let (mut s, kiosk, _, expected) = prepare(); mint(&mut s, kiosk, expected, b"short", 0); abort 99
}

fun rejected_initial(mode: u8) {
    let (mut s, kiosk, _, expected) = prepare(); mint(&mut s, kiosk, expected, nonce(), mode); abort 99
}
#[test, expected_failure(abort_code = 31, location = soulidity::content)] fun empty_initial_envelope_aborts_mint() { rejected_initial(3); }
#[test, expected_failure(abort_code = 31, location = soulidity::content)] fun oversized_initial_envelope_aborts_mint() { rejected_initial(4); }
#[test, expected_failure(abort_code = 30, location = soulidity::content)] fun initial_memory_versions_cannot_all_use_zero() { rejected_initial(6); }
#[test, expected_failure(abort_code = 82, location = soulidity::market)] fun config_cannot_supply_same_initial_envelope() { rejected_initial(7); }
#[test, expected_failure(abort_code = 82, location = soulidity::market)] fun config_cannot_preseed_other_reserved_envelopes() { rejected_initial(8); }

#[test, expected_failure(abort_code = 81, location = soulidity::market)]
fun malformed_manifest_hash_is_not_committed() {
    let mut s = ts::begin(AUTHOR); market::commit_mint_manifest(b"short", s.ctx()); abort 99
}
