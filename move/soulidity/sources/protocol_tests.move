#[test_only]
module soulidity::protocol_tests;

use std::string::{Self as string, String};
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use soulidity::collection::{Self as collection, SoulCollection, SoulCollectionRight};
use soulidity::content::{Self as content, SoulContent};
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::kind_registry::{Self as kind_registry, KindAdminCap, KindRegistry};
use soulidity::market::{
    Self as market,
    InitialContentEntry,
    KioskRegistry,
    MarketConfig,
    SoulListing,
    StateConfigEntry,
};
use soulidity::paid_access::{Self as paid_access, SoulPaidAccessList};
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::clock::{Self as clock};
use sui::coin;
use sui::kiosk::{Self as sui_kiosk, Kiosk};
use sui::test_scenario::{Self as ts};
use sui::transfer_policy::{Self as transfer_policy, TransferPolicy, TransferPolicyCap};
use usdc::usdc::USDC;
use walrus::{blob, encoding, system, test_utils};

// ── Constants ─────────────────────────────────────────────────────────

const BLOB_ROOT_HASH_SOUL_DOC: u256 = 0xA00;
const BLOB_ROOT_HASH_MEMORY: u256 = 0xA01;
const BLOB_ROOT_HASH_SKILL: u256 = 0xA02;
const BLOB_ROOT_HASH_SPRITE: u256 = 0xA03;
const BLOB_ROOT_HASH_AUDIO: u256 = 0xA04;
const BLOB_ROOT_HASH_EXTRA_A: u256 = 0xA05;
const BLOB_SIZE: u64 = 5_000_000;
const BLOB_ENCODING: u8 = 1;
const BLOB_EPOCHS_AHEAD: u32 = 3;
const PAYMENT_FROST: u64 = 1_000_000_000;

const SOUL_PRICE: u64 = 1_000_000;
const PAID_ACCESS_PRICE: u64 = 250_000;
const DEFAULT_PLATFORM_FEE_BPS: u16 = 250;
const CREATOR_ROYALTY_BPS: u16 = 1_000;
const COLLECTION_ROYALTY_BPS: u16 = 500;

const DOC_ID_VERSION: u8 = 1;
const DOC_ID_NONCE_BYTES: u64 = 16;

// ── Test addresses ────────────────────────────────────────────────────

const ADMIN: address = @0xA1;
const MINTER: address = @0xB1;
const BUYER: address = @0xC1;
const AGENT: address = @0xD1;

public struct AdminMutablePolicyRule has drop {}

public struct AdminMutablePolicyConfig has copy, drop, store {}

// ── Blob registration helpers ─────────────────────────────────────────

fun register_test_blob_with_root(
    walrus_system: &mut system::System,
    root_hash: u256,
    ctx: &mut TxContext,
): blob::Blob {
    let mut payment = test_utils::mint_frost(PAYMENT_FROST, ctx);
    let storage_size = encoding::encoded_blob_length(
        BLOB_SIZE,
        BLOB_ENCODING,
        walrus_system.n_shards(),
    );
    let storage = walrus_system.reserve_space(
        storage_size,
        BLOB_EPOCHS_AHEAD,
        &mut payment,
        ctx,
    );
    let blob_id = blob::derive_blob_id(root_hash, BLOB_ENCODING, BLOB_SIZE);
    let registered = walrus_system.register_blob(
        storage,
        blob_id,
        root_hash,
        BLOB_SIZE,
        BLOB_ENCODING,
        false,
        &mut payment,
        ctx,
    );
    payment.burn_for_testing();
    registered
}

public struct BlobMintRequest has copy, drop, store {
    recipient: address,
    root_hash: u256,
}

fun blob_req(recipient: address, root_hash: u256): BlobMintRequest {
    BlobMintRequest { recipient, root_hash }
}

/// Walrus's `system::new_for_testing` may only run once per scenario, so
/// every blob a test needs must be minted in this single call.
fun mint_blobs_for_test(scenario: &mut ts::Scenario, requests: vector<BlobMintRequest>) {
    if (requests.is_empty()) {
        let empty = requests;
        empty.destroy_empty();
        return
    };
    let mut walrus = system::new_for_testing(scenario.ctx());
    let mut reqs = requests;
    reqs.reverse();
    while (!reqs.is_empty()) {
        let req = reqs.pop_back();
        let b = register_test_blob_with_root(&mut walrus, req.root_hash, scenario.ctx());
        transfer::public_transfer(b, req.recipient);
    };
    reqs.destroy_empty();
    std::unit_test::destroy(walrus);
}

fun mint_test_blobs_then_advance(
    scenario: &mut ts::Scenario,
    requests: vector<BlobMintRequest>,
    advance_to: address,
) {
    mint_blobs_for_test(scenario, requests);
    scenario.next_tx(advance_to);
}

// ── Document ID builders ──────────────────────────────────────────────

fun append_u32_be(out: &mut vector<u8>, value: u32) {
    let mut i: u8 = 24;
    let mut count: u64 = 0;
    while (count < 4) {
        out.push_back(((value >> i) & 0xFF) as u8);
        i = if (i >= 8) i - 8 else 0;
        count = count + 1;
    };
}

fun append_u64_be(out: &mut vector<u8>, value: u64) {
    let mut i: u8 = 56;
    let mut count: u64 = 0;
    while (count < 8) {
        out.push_back(((value >> i) & 0xFF) as u8);
        i = if (i >= 8) i - 8 else 0;
        count = count + 1;
    };
}

fun append_id_bytes(out: &mut vector<u8>, id: ID) {
    let bytes = id.to_bytes();
    let mut i = 0;
    while (i < bytes.length()) {
        out.push_back(bytes[i]);
        i = i + 1;
    };
}

fun append_nonce(out: &mut vector<u8>) {
    let mut i = 0;
    while (i < DOC_ID_NONCE_BYTES) {
        out.push_back(0x42);
        i = i + 1;
    };
}

fun content_document_id(
    content_object_id: ID,
    kind: u32,
    name: String,
    version_index: u64,
): vector<u8> {
    let mut out = b"soul-content:";
    out.push_back(DOC_ID_VERSION);
    append_u32_be(&mut out, kind);
    append_id_bytes(&mut out, content_object_id);
    let bytes = string::as_bytes(&name);
    let mut i = 0;
    while (i < bytes.length()) {
        out.push_back(bytes[i]);
        i = i + 1;
    };
    out.push_back(0x00);
    append_u64_be(&mut out, version_index);
    append_nonce(&mut out);
    out
}

// ── Default canonical names ───────────────────────────────────────────

fun default_skill_name(): String { b"skill_intro".to_string() }
fun default_sprite_name(): String { b"sprite_idle".to_string() }
fun default_audio_name(): String { b"audio_voice".to_string() }
fun default_state_config_key(): String { b"sprite_config_json".to_string() }

// ── Read-mode shorthands ──────────────────────────────────────────────

fun read_owner_grant(): u64 {
    kind_registry::read_owner() | kind_registry::read_grant()
}

fun read_owner_only(): u64 { kind_registry::read_owner() }

fun read_grant_only(): u64 { kind_registry::read_grant() }

fun read_owner_grant_paid_public(): u64 {
    kind_registry::read_owner()
        | kind_registry::read_grant()
        | kind_registry::read_paid()
        | kind_registry::read_public()
}

fun read_public_only(): u64 { kind_registry::read_public() }

// ── Protocol init ─────────────────────────────────────────────────────

fun init_protocol_for_testing(scenario: &mut ts::Scenario, admin: address) {
    soul::init_for_testing(admin, scenario.ctx());
    collection::init_for_testing(admin, scenario.ctx());
    market::init_for_testing(admin, scenario.ctx());
    kind_registry::init_for_testing(scenario.ctx());
}

fun init_personal_kiosk_for_sender(scenario: &mut ts::Scenario, sender: address): ID {
    scenario.next_tx(sender);
    let config = ts::take_shared<MarketConfig>(scenario);
    let mut registry = ts::take_shared<KioskRegistry>(scenario);
    let kiosk_id = market::init_personal_kiosk(&config, &mut registry, scenario.ctx());
    ts::return_shared(config);
    ts::return_shared(registry);
    kiosk_id
}

fun mint_usdc_to(recipient: address, amount: u64, scenario: &mut ts::Scenario) {
    let usdc_coin = coin::mint_for_testing<USDC>(amount, scenario.ctx());
    transfer::public_transfer(usdc_coin, recipient);
}

// ── Mint helpers — typed-content (Phase 2 invariant entries always) ───
//
// Phase 2 every mint MUST include exactly one (KIND_SOUL_DOC, "soul")
// and at least one (KIND_MEMORY, "default") entry. The base `MintBlobSpec`
// flag set is for additional non-invariant kinds the test wants seeded.

public struct MintBlobSpec has copy, drop {
    skill: bool,
    sprite_active_public: bool,
    audio_active_public: bool,
}

fun spec_invariant_only(): MintBlobSpec {
    MintBlobSpec { skill: false, sprite_active_public: false, audio_active_public: false }
}

fun spec_with_skill(): MintBlobSpec {
    MintBlobSpec { skill: true, sprite_active_public: false, audio_active_public: false }
}

fun spec_with_sprite_active(): MintBlobSpec {
    MintBlobSpec { skill: false, sprite_active_public: true, audio_active_public: false }
}

fun spec_with_audio_active(): MintBlobSpec {
    MintBlobSpec { skill: false, sprite_active_public: false, audio_active_public: true }
}

fun spec_blob_requests(spec: MintBlobSpec, recipient: address): vector<BlobMintRequest> {
    let mut reqs = vector[
        blob_req(recipient, BLOB_ROOT_HASH_SOUL_DOC),
        blob_req(recipient, BLOB_ROOT_HASH_MEMORY),
    ];
    if (spec.skill) reqs.push_back(blob_req(recipient, BLOB_ROOT_HASH_SKILL));
    if (spec.sprite_active_public) reqs.push_back(blob_req(recipient, BLOB_ROOT_HASH_SPRITE));
    if (spec.audio_active_public) reqs.push_back(blob_req(recipient, BLOB_ROOT_HASH_AUDIO));
    reqs
}

fun build_initial_content_from_address(
    minter: address,
    scenario: &ts::Scenario,
    spec: MintBlobSpec,
): vector<InitialContentEntry> {
    let mut entries = vector::empty<InitialContentEntry>();

    // SOUL_DOC v0: read OWNER|GRANT, no PUBLIC, no download_policy override.
    let soul_doc_blob = ts::take_from_address<blob::Blob>(scenario, minter);
    entries.push_back(market::new_initial_content_entry(
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        read_owner_grant(),
        content::download_policy_public(),
        false,
        soul_doc_blob,
    ));

    // MEMORY v0: read OWNER|GRANT.
    let memory_blob = ts::take_from_address<blob::Blob>(scenario, minter);
    entries.push_back(market::new_initial_content_entry(
        kind_registry::kind_memory(),
        b"default".to_string(),
        read_owner_grant(),
        content::download_policy_public(),
        false,
        memory_blob,
    ));

    if (spec.skill) {
        let b = ts::take_from_address<blob::Blob>(scenario, minter);
        entries.push_back(market::new_initial_content_entry(
            kind_registry::kind_skill(),
            default_skill_name(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            b,
        ));
    };
    if (spec.sprite_active_public) {
        let b = ts::take_from_address<blob::Blob>(scenario, minter);
        entries.push_back(market::new_initial_content_entry(
            kind_registry::kind_sprite(),
            default_sprite_name(),
            read_owner_grant_paid_public(),
            content::download_policy_public(),
            true,
            b,
        ));
    };
    if (spec.audio_active_public) {
        let b = ts::take_from_address<blob::Blob>(scenario, minter);
        entries.push_back(market::new_initial_content_entry(
            kind_registry::kind_audio(),
            default_audio_name(),
            read_owner_grant_paid_public(),
            content::download_policy_public(),
            true,
            b,
        ));
    };
    entries
}

fun mint_native_with_entries(
    scenario: &mut ts::Scenario,
    minter: address,
    minter_kiosk_id: ID,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
): ID {
    scenario.next_tx(minter);
    let config = ts::take_shared<MarketConfig>(scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(scenario);
    let registry = ts::take_shared<KioskRegistry>(scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(scenario, minter_kiosk_id);
    let kiosk_cap = ts::take_from_address<PersonalKioskCap>(scenario, minter);
    let test_clock = clock::create_for_testing(scenario.ctx());

    let state = market::mint_native_in_personal_kiosk(
        &config,
        &kind_registry_obj,
        &registry,
        &soul_policy,
        &mut kiosk_obj,
        &kiosk_cap,
        b"Test Soul".to_string(),
        b"Description".to_string(),
        b"https://example.com".to_string(),
        initial_content,
        initial_state_config,
        CREATOR_ROYALTY_BPS,
        &test_clock,
        scenario.ctx(),
    );
    let state_id = object::id(&state);
    market::finalize_soul_state(state);

    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(registry);
    ts::return_shared(soul_policy);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(minter, kiosk_cap);
    state_id
}

fun setup_and_mint_native(
    scenario: &mut ts::Scenario,
    minter: address,
    minter_kiosk_id: ID,
    spec: MintBlobSpec,
    initial_state_config: vector<StateConfigEntry>,
): ID {
    let reqs = spec_blob_requests(spec, minter);
    mint_test_blobs_then_advance(scenario, reqs, minter);
    let entries = build_initial_content_from_address(minter, scenario, spec);
    mint_native_with_entries(scenario, minter, minter_kiosk_id, entries, initial_state_config)
}

/// Mint with the bare invariant set (SOUL_DOC + MEMORY) and additionally
/// register a list of extra blob recipients (e.g. AGENT) so granted-agent
/// or buyer flows can `take_from_address` them later.
fun setup_and_mint_invariant_with_extras(
    scenario: &mut ts::Scenario,
    minter: address,
    minter_kiosk_id: ID,
    extra_requests: vector<BlobMintRequest>,
): ID {
    let mut reqs = spec_blob_requests(spec_invariant_only(), minter);
    let mut extras = extra_requests;
    extras.reverse();
    while (!extras.is_empty()) {
        reqs.push_back(extras.pop_back());
    };
    extras.destroy_empty();
    mint_test_blobs_then_advance(scenario, reqs, minter);
    let entries = build_initial_content_from_address(minter, scenario, spec_invariant_only());
    mint_native_with_entries(scenario, minter, minter_kiosk_id, entries, vector::empty())
}

// ── Fee math ──────────────────────────────────────────────────────────

fun bps_amount(price: u64, bps: u16): u64 {
    let numerator = (price as u128) * (bps as u128);
    if (numerator == 0) {
        return 0
    };
    (((numerator + 9_999) / 10_000) as u64)
}

fun default_platform_fee(price: u64): u64 {
    bps_amount(price, DEFAULT_PLATFORM_FEE_BPS)
}

fun soul_purchase_total(price: u64, creator_royalty_bps: u16, collection_royalty_bps: u16): u64 {
    price
        + default_platform_fee(price)
        + bps_amount(price, creator_royalty_bps)
        + bps_amount(price, collection_royalty_bps)
}

fun paid_access_total(price: u64): u64 {
    price + default_platform_fee(price)
}

// ── Grant helpers ─────────────────────────────────────────────────────

fun issue_default_grant(
    scenario: &mut ts::Scenario,
    owner: address,
    grantee: address,
    scope_mask: u64,
): ID {
    scenario.next_tx(owner);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let mut state = ts::take_shared<SoulState>(scenario);
    let g = grant::issue(
        &mut state,
        grantee,
        scope_mask,
        option::none(),
        &test_clock,
        scenario.ctx(),
    );
    let grant_id = object::id(&g);
    transfer::public_transfer(g, grantee);
    test_clock.destroy_for_testing();
    ts::return_shared(state);
    grant_id
}

#[test]
fun issue_to_grantee_entry_transfers_grant() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let mut state = ts::take_shared<SoulState>(&scenario);
    grant::issue_to_grantee(
        &mut state,
        AGENT,
        grant::scope_seal(),
        option::none(),
        &test_clock,
        scenario.ctx(),
    );
    test_clock.destroy_for_testing();
    ts::return_shared(state);

    scenario.next_tx(AGENT);
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    assert!(grant::grantee(&g) == AGENT, 0);
    ts::return_to_address(AGENT, g);
    ts::end(scenario);
}

// ── Paid-access kind config helper ────────────────────────────────────

fun configure_paid_kind_for_minter(
    scenario: &mut ts::Scenario,
    minter: address,
    kind: u32,
    scope_mask: u64,
    duration_ms: Option<u64>,
) {
    scenario.next_tx(minter);
    let config = ts::take_shared<MarketConfig>(scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(scenario);
    let state = ts::take_shared<SoulState>(scenario);
    market::configure_paid_access_kind(
        &config,
        &kind_registry_obj,
        &mut paid_list,
        &state,
        kind,
        PAID_ACCESS_PRICE,
        scope_mask,
        duration_ms,
        scenario.ctx(),
    );
    ts::return_shared(config);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(paid_list);
    ts::return_shared(state);
}

// ─────────────────────────────────────────────────────────────────────
// 8.1 Kind registry tests
// ─────────────────────────────────────────────────────────────────────

#[test]
fun builtin_kinds_pre_registered_at_publish() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let registry = ts::take_shared<KindRegistry>(&scenario);
    assert!(kind_registry::contains_kind(&registry, kind_registry::kind_soul_doc()), 0);
    assert!(kind_registry::contains_kind(&registry, kind_registry::kind_memory()), 1);
    assert!(kind_registry::contains_kind(&registry, kind_registry::kind_skill()), 2);
    assert!(kind_registry::contains_kind(&registry, kind_registry::kind_sprite()), 3);
    assert!(kind_registry::contains_kind(&registry, kind_registry::kind_audio()), 4);
    assert!(kind_registry::contains_name(&registry, b"soul_doc".to_string()), 5);
    assert!(kind_registry::contains_name(&registry, b"memory".to_string()), 6);
    assert!(kind_registry::contains_name(&registry, b"skill".to_string()), 7);
    assert!(kind_registry::contains_name(&registry, b"sprite".to_string()), 8);
    assert!(kind_registry::contains_name(&registry, b"audio".to_string()), 9);
    assert!(kind_registry::next_kind(&registry) == kind_registry::first_custom_kind(), 10);
    ts::return_shared(registry);
    ts::end(scenario);
}

#[test]
fun builtin_kind_descriptors_carry_expected_metadata() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let registry = ts::take_shared<KindRegistry>(&scenario);

    // SOUL_DOC: mint-only, OWNER|GRANT, scope=SEAL, no active binding, no download policy.
    let soul_doc = kind_registry::borrow_descriptor(&registry, kind_registry::kind_soul_doc());
    assert!(kind_registry::descriptor_op_mask(soul_doc) == 0, 0);
    assert!(kind_registry::descriptor_read_mode_mask(soul_doc) == read_owner_grant(), 1);
    assert!(!kind_registry::descriptor_has_active_binding(soul_doc), 2);
    assert!(!kind_registry::descriptor_requires_download_policy(soul_doc), 3);
    assert!(
        kind_registry::descriptor_default_grant_scope_mask(soul_doc) == grant::scope_seal(),
        4,
    );

    // MEMORY: APPEND|DELETE|PURGE, OWNER|GRANT, scope=MEMORY.
    let memory = kind_registry::borrow_descriptor(&registry, kind_registry::kind_memory());
    let crud_only = kind_registry::op_append() | kind_registry::op_delete() | kind_registry::op_purge();
    assert!(kind_registry::descriptor_op_mask(memory) == crud_only, 5);
    assert!(kind_registry::descriptor_read_mode_mask(memory) == read_owner_grant(), 6);
    assert!(!kind_registry::descriptor_has_active_binding(memory), 7);
    assert!(!kind_registry::descriptor_requires_download_policy(memory), 8);
    assert!(
        kind_registry::descriptor_default_grant_scope_mask(memory) == grant::scope_memory(),
        9,
    );

    // SKILL: APPEND|DELETE|PURGE, OWNER|GRANT, scope=SKILLS.
    let skill = kind_registry::borrow_descriptor(&registry, kind_registry::kind_skill());
    assert!(kind_registry::descriptor_op_mask(skill) == crud_only, 10);
    assert!(kind_registry::descriptor_read_mode_mask(skill) == read_owner_grant(), 11);
    assert!(
        kind_registry::descriptor_default_grant_scope_mask(skill) == grant::scope_skills(),
        12,
    );

    // SPRITE: full CRUD + ACTIVE_BIND, all four read modes.
    let sprite = kind_registry::borrow_descriptor(&registry, kind_registry::kind_sprite());
    let full_op = crud_only | kind_registry::op_active_bind();
    assert!(kind_registry::descriptor_op_mask(sprite) == full_op, 13);
    assert!(kind_registry::descriptor_read_mode_mask(sprite) == read_owner_grant_paid_public(), 14);
    assert!(kind_registry::descriptor_has_active_binding(sprite), 15);
    assert!(kind_registry::descriptor_requires_download_policy(sprite), 16);
    assert!(
        kind_registry::descriptor_default_grant_scope_mask(sprite) == grant::scope_assets(),
        17,
    );

    // AUDIO: same shape as SPRITE.
    let audio = kind_registry::borrow_descriptor(&registry, kind_registry::kind_audio());
    assert!(kind_registry::descriptor_op_mask(audio) == full_op, 18);
    assert!(kind_registry::descriptor_read_mode_mask(audio) == read_owner_grant_paid_public(), 19);

    ts::return_shared(registry);
    ts::end(scenario);
}

#[test]
fun register_kind_allocates_monotonic_custom_ids() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let video_kind = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append() | kind_registry::op_delete() | kind_registry::op_purge() | kind_registry::op_active_bind(),
        read_owner_grant_paid_public(),
        true,
        true,
        grant::scope_assets(),
        scenario.ctx(),
    );
    assert!(video_kind == kind_registry::first_custom_kind(), 0);

    let prompt_kind = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"prompt".to_string(),
        kind_registry::op_append(),
        read_owner_grant(),
        false,
        false,
        grant::scope_skills(),
        scenario.ctx(),
    );
    assert!(prompt_kind == video_kind + 1, 1);
    assert!(kind_registry::next_kind(&registry) == prompt_kind + 1, 2);

    ts::return_shared(registry);
    ts::return_to_address(ADMIN, cap);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 3, location = sui::test_scenario)]
fun non_admin_cannot_register_kind() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(BUYER);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    // `KindAdminCap` is the authority proof. BUYER never received it, so
    // test_scenario aborts with EEmptyInventory before `register_kind` can run.
    let cap = ts::take_from_address<KindAdminCap>(&scenario, BUYER);
    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append(),
        read_owner_only(),
        false,
        false,
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EKindNameTaken)]
fun register_kind_rejects_duplicate_name() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"skill".to_string(),
        kind_registry::op_append(),
        read_owner_grant(),
        false,
        false,
        grant::scope_skills(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EOpMaskUnknownBit)]
fun register_kind_rejects_unknown_op_bit() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append() | (1 << 5), // bit 5 unknown
        read_owner_grant(),
        false,
        false,
        grant::scope_skills(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::ENoReadModeMask)]
fun register_kind_rejects_zero_read_mode() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        0,
        0,
        false,
        false,
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EReadModeOwnerRequired)]
fun register_kind_rejects_missing_owner_read() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append(),
        kind_registry::read_grant(), // missing OWNER
        false,
        false,
        grant::scope_skills(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EActiveBindingMaskInconsistent)]
fun register_kind_rejects_active_op_without_flag() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    // op_mask has ACTIVE_BIND but has_active_binding=false → inconsistent.
    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append() | kind_registry::op_active_bind(),
        read_owner_grant_paid_public(),
        false,
        true,
        grant::scope_assets(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EActiveBindingMaskInconsistent)]
fun register_kind_rejects_active_flag_without_op() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    // has_active_binding=true but op_mask lacks ACTIVE_BIND.
    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append(),
        read_owner_grant(),
        true,
        false,
        grant::scope_skills(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EPublicRequiresDownloadPolicy)]
fun register_kind_rejects_public_without_download_policy() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append(),
        read_owner_only() | kind_registry::read_public(),
        false,
        false, // requires_download_policy=false but PUBLIC included
        grant::scope_skills(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EDownloadPolicyRequiresPublic)]
fun register_kind_rejects_download_policy_without_public_read() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append(),
        read_owner_grant(), // no PUBLIC
        false,
        true, // but requires_download_policy=true
        grant::scope_skills(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EInvalidDefaultGrantScope)]
fun register_kind_rejects_grant_without_scope() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append(),
        read_owner_grant(),
        false,
        false,
        0, // grant readable but scope=0
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EInvalidDefaultGrantScope)]
fun register_kind_rejects_paid_without_scope() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append() | kind_registry::op_active_bind(),
        kind_registry::read_owner() | kind_registry::read_paid() | kind_registry::read_public(),
        true,
        true,
        0, // paid readable but scope=0
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EInvalidDefaultGrantScope)]
fun register_kind_rejects_unscoped_read_with_scope() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append(),
        read_owner_only(), // no GRANT, no PAID
        false,
        false,
        grant::scope_skills(), // but scope is non-zero → inconsistent
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EInvalidDefaultGrantScope)]
fun register_kind_rejects_combined_scope_mask() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"video".to_string(),
        kind_registry::op_append(),
        read_owner_grant(),
        false,
        false,
        grant::scope_skills() | grant::scope_assets(), // multi-bit
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun register_kind_accepts_seal_scope_for_doc_like_kind() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let kind_id = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"manifest".to_string(),
        kind_registry::op_append(),
        read_owner_grant(),
        false,
        false,
        grant::scope_seal(), // Phase 2 allows SEAL scope explicitly.
        scenario.ctx(),
    );
    assert!(kind_id == kind_registry::first_custom_kind(), 0);

    ts::return_shared(registry);
    ts::return_to_address(ADMIN, cap);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::content::EOpNotAllowed)]
fun admin_registered_kind_enforces_configured_ops_and_reads() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);
    let notes_kind = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"notes".to_string(),
        kind_registry::op_append(),
        read_owner_only(),
        false,
        false,
        0,
        scenario.ctx(),
    );
    ts::return_shared(registry);
    ts::return_to_address(ADMIN, cap);

    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let version_index = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        notes_kind,
        b"build-notes".to_string(),
        read_owner_only(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    let slot = content::borrow_slot(&content_obj, notes_kind, b"build-notes".to_string(), version_index);
    assert!(content::slot_op_mask(slot) == kind_registry::op_append(), 0);
    assert!(content::slot_read_mode_mask(slot) == read_owner_only(), 1);

    let id = content_document_id(
        content::content_id(&content_obj),
        notes_kind,
        b"build-notes".to_string(),
        version_index,
    );
    content::seal_approve_content_owner(
        id,
        &state,
        &content_obj,
        notes_kind,
        b"build-notes".to_string(),
        version_index,
        scenario.ctx(),
    );

    content::delete_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        notes_kind,
        b"build-notes".to_string(),
        version_index,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EKindNameInvalidChar)]
fun register_kind_rejects_uppercase_name() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"Video".to_string(),
        kind_registry::op_append() | kind_registry::op_active_bind(),
        read_owner_grant_paid_public(),
        true,
        true,
        grant::scope_assets(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EKindNameInvalidLength)]
fun register_kind_rejects_empty_name() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    let _ = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"".to_string(),
        kind_registry::op_append(),
        read_owner_grant(),
        false,
        false,
        grant::scope_skills(),
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun deprecate_and_reactivate_kind_toggles_flag() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    kind_registry::deprecate_kind(&mut registry, &cap, kind_registry::kind_skill(), scenario.ctx());
    let d = kind_registry::borrow_descriptor(&registry, kind_registry::kind_skill());
    assert!(kind_registry::descriptor_deprecated(d), 0);

    kind_registry::reactivate_kind(&mut registry, &cap, kind_registry::kind_skill(), scenario.ctx());
    let d2 = kind_registry::borrow_descriptor(&registry, kind_registry::kind_skill());
    assert!(!kind_registry::descriptor_deprecated(d2), 1);
    // Op/read masks are immutable across reactivation.
    let crud_only = kind_registry::op_append() | kind_registry::op_delete() | kind_registry::op_purge();
    assert!(kind_registry::descriptor_op_mask(d2) == crud_only, 2);
    assert!(kind_registry::descriptor_read_mode_mask(d2) == read_owner_grant(), 3);

    ts::return_shared(registry);
    ts::return_to_address(ADMIN, cap);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EKindDeprecated)]
fun deprecate_kind_blocks_double_deprecation() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);

    kind_registry::deprecate_kind(&mut registry, &cap, kind_registry::kind_skill(), scenario.ctx());
    kind_registry::deprecate_kind(&mut registry, &cap, kind_registry::kind_skill(), scenario.ctx());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EKindNotFound)]
fun borrow_descriptor_aborts_for_unregistered_kind() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let registry = ts::take_shared<KindRegistry>(&scenario);
    let _ = kind_registry::borrow_descriptor(&registry, 999);
    abort 42
}

// ─────────────────────────────────────────────────────────────────────
// 8.5 Mint flow / invariant entries
// ─────────────────────────────────────────────────────────────────────

#[test]
fun mint_with_invariant_entries_only_succeeds() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    assert!(soul::has_content_id(&state), 0);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    assert!(content::soul_id(&content_obj) == soul::soul_id(&state), 1);
    // SOUL_DOC v0 + MEMORY v0 must be present.
    assert!(
        content::version_count(&content_obj, kind_registry::kind_soul_doc(), b"soul".to_string()) == 1,
        2,
    );
    assert!(
        content::version_count(&content_obj, kind_registry::kind_memory(), b"default".to_string()) == 1,
        3,
    );
    ts::return_shared(state);
    ts::return_shared(content_obj);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::content::EReadModeNotAllowed)]
fun mint_rejects_owner_only_soul_doc_read_mode() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
        ],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_only(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EReadModeNotAllowed)]
fun mint_rejects_owner_only_memory_read_mode() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
        ],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_only(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test]
fun mint_with_skill_records_version() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    scenario.next_tx(MINTER);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    assert!(content::count_for_kind(&content_obj, kind_registry::kind_skill()) == 1, 0);
    assert!(
        content::version_count(&content_obj, kind_registry::kind_skill(), default_skill_name()) == 1,
        1,
    );
    let slot = content::borrow_slot(
        &content_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
    );
    assert!(!content::slot_is_public(slot), 2);
    assert!(content::slot_grant_scope_mask(slot) == grant::scope_skills(), 3);
    assert!(content::slot_read_mode_mask(slot) == read_owner_grant(), 4);
    assert!(content::slot_seal_encrypted(slot), 5);
    ts::return_shared(content_obj);
    ts::end(scenario);
}

#[test]
fun mint_with_sprite_set_active_binds_active_table() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    scenario.next_tx(MINTER);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    assert!(content::has_active(&content_obj, kind_registry::kind_sprite()), 0);
    assert!(content::is_version_active(
        &content_obj,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
    ), 1);
    let slot = content::borrow_slot(
        &content_obj,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
    );
    assert!(content::slot_is_public(slot), 2);
    assert!(content::slot_seal_encrypted(slot), 3); // mixed-mode slot stays encrypted
    ts::return_shared(content_obj);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::market::EInitialEntryActiveNotSupported)]
fun mint_set_active_for_skill_kind_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
            blob_req(MINTER, BLOB_ROOT_HASH_SKILL),
        ],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let skill_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_skill(),
            default_skill_name(),
            read_owner_grant(),
            content::download_policy_public(),
            true, // set_active=true on a kind without active binding
            skill_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EInitialSoulDocCountMismatch)]
fun mint_aborts_without_soul_doc() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_MEMORY)],
        MINTER,
    );
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EInitialSoulDocCountMismatch)]
fun mint_aborts_with_two_soul_docs() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
            blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A),
        ],
        MINTER,
    );
    let soul_doc_blob_1 = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let soul_doc_blob_2 = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob_1,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob_2,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EInitialMemoryCountMismatch)]
fun mint_aborts_without_memory() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC)],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EInitialSoulDocNameMismatch)]
fun mint_aborts_with_wrong_soul_doc_name() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
        ],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"other".to_string(), // wrong name
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EInitialMemoryNameMismatch)]
fun mint_aborts_with_wrong_memory_name() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
        ],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"custom".to_string(), // wrong
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EInitialKindOpNotAllowedAtMint)]
fun mint_aborts_when_initial_custom_kind_lacks_append_op() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    // Admin registers a kind with op_mask=0 (mint-only, no user APPEND).
    scenario.next_tx(ADMIN);
    let mut registry = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);
    let frozen_kind = kind_registry::register_kind(
        &mut registry,
        &cap,
        b"frozen".to_string(),
        0, // op_mask=0
        read_owner_grant(),
        false,
        false,
        grant::scope_skills(),
        scenario.ctx(),
    );
    ts::return_shared(registry);
    ts::return_to_address(ADMIN, cap);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
            blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A),
        ],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let frozen_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
        market::new_initial_content_entry(
            frozen_kind,
            b"x".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            frozen_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());
    abort 42
}

#[test]
fun mint_with_state_config_emits_upserted_events() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    let configs = vector[
        market::new_state_config_entry(default_state_config_key(), b"{\"k\":1}"),
    ];
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), configs);

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    assert!(soul::has_state_config(&state, default_state_config_key()), 0);
    let value = soul::state_config(&state, default_state_config_key());
    assert!(value == &b"{\"k\":1}", 1);
    ts::return_shared(state);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// 8.2 Content op-mask enforcement
// ─────────────────────────────────────────────────────────────────────

#[test, expected_failure(abort_code = soulidity::content::EOpNotAllowed)]
fun soul_doc_append_as_owner_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let _ = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        read_owner_grant(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EOwnerReadModeRequired)]
fun append_version_rejects_slot_without_owner_read() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let _ = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        read_grant_only(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EOpNotAllowed)]
fun soul_doc_delete_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    content::delete_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EOpNotAllowed)]
fun soul_doc_purge_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    content::purge_deleted_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EKindActiveBindingNotSupported)]
fun soul_doc_set_active_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);

    market::set_active_content(
        &config,
        &kind_registry_obj,
        &mut content_obj,
        &state,
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun memory_append_and_delete_succeed() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let v = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_memory(),
        b"default".to_string(),
        read_owner_grant(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    assert!(v == 1, 0);
    assert!(
        content::version_count(&content_obj, kind_registry::kind_memory(), b"default".to_string()) == 2,
        1,
    );

    content::delete_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_memory(),
        b"default".to_string(),
        1,
        scenario.ctx(),
    );
    assert!(
        content::version_is_deleted(&content_obj, kind_registry::kind_memory(), b"default".to_string(), 1),
        2,
    );

    test_clock.destroy_for_testing();
    ts::return_shared(kind_registry_obj);
    ts::return_shared(content_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::content::EMemoryNameMismatch)]
fun memory_append_wrong_name_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let _ = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_memory(),
        b"other".to_string(),
        read_owner_grant(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun memory_purge_after_delete_succeeds() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let v = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_memory(),
        b"default".to_string(),
        read_owner_grant(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    content::delete_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_memory(),
        b"default".to_string(),
        v,
        scenario.ctx(),
    );
    content::purge_deleted_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_memory(),
        b"default".to_string(),
        v,
        scenario.ctx(),
    );
    assert!(
        content::version_is_purged(&content_obj, kind_registry::kind_memory(), b"default".to_string(), v),
        0,
    );

    test_clock.destroy_for_testing();
    ts::return_shared(kind_registry_obj);
    ts::return_shared(content_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::content::EKindActiveBindingNotSupported)]
fun memory_set_active_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);

    market::set_active_content(
        &config,
        &kind_registry_obj,
        &mut content_obj,
        &state,
        kind_registry::kind_memory(),
        b"default".to_string(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun set_active_content_derives_binding_policy_from_slot() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let version_index = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        read_owner_grant(),
        content::download_policy_owner_only(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    market::set_active_content(
        &config,
        &kind_registry_obj,
        &mut content_obj,
        &state,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        version_index,
        scenario.ctx(),
    );

    let mut binding = content::active_binding(&content_obj, kind_registry::kind_sprite());
    assert!(binding.is_some(), 0);
    let active = option::extract(&mut binding);
    assert!(content::active_binding_download_policy(&active) == content::download_policy_owner_only(), 1);
    binding.destroy_none();

    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(content_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test]
fun skill_full_crud_succeeds() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);

    content::delete_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        scenario.ctx(),
    );
    content::purge_deleted_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        scenario.ctx(),
    );
    assert!(
        content::version_is_purged(&content_obj, kind_registry::kind_skill(), default_skill_name(), 0),
        0,
    );

    ts::return_shared(kind_registry_obj);
    ts::return_shared(content_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::content::EKindActiveBindingNotSupported)]
fun skill_set_active_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);

    market::set_active_content(
        &config,
        &kind_registry_obj,
        &mut content_obj,
        &state,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EActiveVersionDeleted)]
fun delete_active_sprite_version_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    content::delete_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun clear_active_then_delete_sprite_succeeds() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);

    market::clear_active_content(
        &config,
        &kind_registry_obj,
        &mut content_obj,
        &state,
        kind_registry::kind_sprite(),
        scenario.ctx(),
    );
    assert!(!content::has_active(&content_obj, kind_registry::kind_sprite()), 0);

    content::delete_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
        scenario.ctx(),
    );
    assert!(
        content::version_is_deleted(&content_obj, kind_registry::kind_sprite(), default_sprite_name(), 0),
        1,
    );

    ts::return_shared(config);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(content_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// 8.3 Content read-mode enforcement
// ─────────────────────────────────────────────────────────────────────

#[test]
fun soul_doc_owner_seal_reads() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
    );
    content::seal_approve_content_owner(
        id,
        &state,
        &content_obj,
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
        scenario.ctx(),
    );
    ts::return_shared(state);
    ts::return_shared(content_obj);
    ts::end(scenario);
}

#[test]
fun soul_doc_grant_seal_reads_with_seal_scope() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    let _grant_id = issue_default_grant(&mut scenario, MINTER, AGENT, grant::scope_seal());

    scenario.next_tx(AGENT);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
    );
    content::seal_approve_content_granted_agent(
        id,
        &state,
        &content_obj,
        &g,
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
        &test_clock,
        scenario.ctx(),
    );

    test_clock.destroy_for_testing();
    ts::return_to_address(AGENT, g);
    ts::return_shared(state);
    ts::return_shared(content_obj);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::content::EReadModeNotAllowed)]
fun soul_doc_public_seal_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
    );
    content::seal_approve_content_public(
        id,
        &state,
        &content_obj,
        kind_registry::kind_soul_doc(),
        b"soul".to_string(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun memory_owner_and_grant_seal_read() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    let _grant_id = issue_default_grant(&mut scenario, MINTER, AGENT, grant::scope_memory());

    // Owner reads memory v0.
    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id_owner = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_memory(),
        b"default".to_string(),
        0,
    );
    content::seal_approve_content_owner(
        id_owner,
        &state,
        &content_obj,
        kind_registry::kind_memory(),
        b"default".to_string(),
        0,
        scenario.ctx(),
    );
    ts::return_shared(state);
    ts::return_shared(content_obj);

    // Granted agent reads memory v0.
    scenario.next_tx(AGENT);
    let state2 = ts::take_shared<SoulState>(&scenario);
    let content_obj2 = ts::take_shared<SoulContent>(&scenario);
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let id_grant = content_document_id(
        content::content_id(&content_obj2),
        kind_registry::kind_memory(),
        b"default".to_string(),
        0,
    );
    content::seal_approve_content_granted_agent(
        id_grant,
        &state2,
        &content_obj2,
        &g,
        kind_registry::kind_memory(),
        b"default".to_string(),
        0,
        &test_clock,
        scenario.ctx(),
    );
    test_clock.destroy_for_testing();
    ts::return_to_address(AGENT, g);
    ts::return_shared(state2);
    ts::return_shared(content_obj2);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::content::EReadModeNotAllowed)]
fun memory_public_seal_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_memory(),
        b"default".to_string(),
        0,
    );
    content::seal_approve_content_public(
        id,
        &state,
        &content_obj,
        kind_registry::kind_memory(),
        b"default".to_string(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EReadModeNotAllowed)]
fun skill_public_seal_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
    );
    content::seal_approve_content_public(
        id,
        &state,
        &content_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun skill_owner_and_grant_seal_read() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    let _grant_id = issue_default_grant(&mut scenario, MINTER, AGENT, grant::scope_skills());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id_owner = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
    );
    content::seal_approve_content_owner(
        id_owner,
        &state,
        &content_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        scenario.ctx(),
    );
    ts::return_shared(state);
    ts::return_shared(content_obj);

    scenario.next_tx(AGENT);
    let state2 = ts::take_shared<SoulState>(&scenario);
    let content_obj2 = ts::take_shared<SoulContent>(&scenario);
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let id_grant = content_document_id(
        content::content_id(&content_obj2),
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
    );
    content::seal_approve_content_granted_agent(
        id_grant,
        &state2,
        &content_obj2,
        &g,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        &test_clock,
        scenario.ctx(),
    );
    test_clock.destroy_for_testing();
    ts::return_to_address(AGENT, g);
    ts::return_shared(state2);
    ts::return_shared(content_obj2);
    ts::end(scenario);
}

#[test]
fun sprite_all_four_modes_pass_when_mask_full() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    // Owner reads.
    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id_owner = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
    );
    content::seal_approve_content_owner(
        id_owner,
        &state,
        &content_obj,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
        scenario.ctx(),
    );
    // Public read on the same sprite (it is encrypted because read mode is mixed).
    let id_public = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
    );
    content::seal_approve_content_public(
        id_public,
        &state,
        &content_obj,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
        scenario.ctx(),
    );
    ts::return_shared(state);
    ts::return_shared(content_obj);

    // Grant scope=ASSETS reads sprite slot.
    let _grant_id = issue_default_grant(&mut scenario, MINTER, AGENT, grant::scope_assets());
    scenario.next_tx(AGENT);
    let state2 = ts::take_shared<SoulState>(&scenario);
    let content_obj2 = ts::take_shared<SoulContent>(&scenario);
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let id_grant = content_document_id(
        content::content_id(&content_obj2),
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
    );
    content::seal_approve_content_granted_agent(
        id_grant,
        &state2,
        &content_obj2,
        &g,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
        &test_clock,
        scenario.ctx(),
    );
    test_clock.destroy_for_testing();
    ts::return_to_address(AGENT, g);
    ts::return_shared(state2);
    ts::return_shared(content_obj2);
    ts::end(scenario);
}

#[test]
fun audio_owner_public_paid_and_active_paths() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_audio_active(), vector::empty());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    assert!(content::has_active(&content_obj, kind_registry::kind_audio()), 0);
    assert!(content::is_version_active(
        &content_obj,
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
    ), 1);

    let id_owner = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
    );
    content::seal_approve_content_owner(
        id_owner,
        &state,
        &content_obj,
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
        scenario.ctx(),
    );
    let id_public = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
    );
    content::seal_approve_content_public(
        id_public,
        &state,
        &content_obj,
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
        scenario.ctx(),
    );
    ts::return_shared(state);
    ts::return_shared(content_obj);

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_audio(),
        grant::scope_assets(),
        option::none(),
    );

    mint_usdc_to(BUYER, paid_access_total(PAID_ACCESS_PRICE), &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state2 = ts::take_shared<SoulState>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    let test_clock = clock::create_for_testing(scenario.ctx());
    market::purchase_paid_access(
        &config,
        &mut paid_list,
        &state2,
        kind_registry::kind_audio(),
        payment,
        &test_clock,
        scenario.ctx(),
    );

    let content_obj2 = ts::take_shared<SoulContent>(&scenario);
    let id_paid = content_document_id(
        content::content_id(&content_obj2),
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
    );
    paid_access::seal_approve_content_paid_access(
        id_paid,
        &state2,
        &paid_list,
        &content_obj2,
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
        &test_clock,
        scenario.ctx(),
    );

    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(paid_list);
    ts::return_shared(state2);
    ts::return_shared(content_obj2);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::content::EOwnerReadModeRequired)]
fun sprite_pure_public_slot_append_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    // Build an entry with read_mode_mask = READ_PUBLIC only. Per-slot masks
    // cannot drop READ_OWNER, so this fails at append/mint time.
    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
            blob_req(MINTER, BLOB_ROOT_HASH_SPRITE),
        ],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let sprite_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_sprite(),
            default_sprite_name(),
            read_public_only(),
            content::download_policy_public(),
            false,
            sprite_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());

    abort 42
}

// ─────────────────────────────────────────────────────────────────────
// 8.7 Grant scope coexistence — multi-kind reads with single grant
// ─────────────────────────────────────────────────────────────────────

#[test]
fun grant_scope_assets_reads_sprite_and_audio() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    // Mint with both sprite + audio entries, both active and public.
    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
            blob_req(MINTER, BLOB_ROOT_HASH_SPRITE),
            blob_req(MINTER, BLOB_ROOT_HASH_AUDIO),
        ],
        MINTER,
    );
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let sprite_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let audio_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_sprite(),
            default_sprite_name(),
            read_owner_grant_paid_public(),
            content::download_policy_public(),
            true,
            sprite_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_audio(),
            default_audio_name(),
            read_owner_grant_paid_public(),
            content::download_policy_public(),
            true,
            audio_blob,
        ),
    ];
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());

    let _grant_id = issue_default_grant(&mut scenario, MINTER, AGENT, grant::scope_assets());
    scenario.next_tx(AGENT);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    let test_clock = clock::create_for_testing(scenario.ctx());

    let id_sprite = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
    );
    content::seal_approve_content_granted_agent(
        id_sprite,
        &state,
        &content_obj,
        &g,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
        &test_clock,
        scenario.ctx(),
    );
    let id_audio = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
    );
    content::seal_approve_content_granted_agent(
        id_audio,
        &state,
        &content_obj,
        &g,
        kind_registry::kind_audio(),
        default_audio_name(),
        0,
        &test_clock,
        scenario.ctx(),
    );

    test_clock.destroy_for_testing();
    ts::return_to_address(AGENT, g);
    ts::return_shared(state);
    ts::return_shared(content_obj);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::grant::EGrantScopeMissing)]
fun grant_scope_skills_cannot_read_sprite() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    let _grant_id = issue_default_grant(&mut scenario, MINTER, AGENT, grant::scope_skills());
    scenario.next_tx(AGENT);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
    );
    content::seal_approve_content_granted_agent(
        id,
        &state,
        &content_obj,
        &g,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

// ─────────────────────────────────────────────────────────────────────
// 8.4 Paid-access per-kind
// ─────────────────────────────────────────────────────────────────────

#[test]
fun configure_paid_access_kind_creates_config() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    scenario.next_tx(MINTER);
    let paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    assert!(paid_access::has_kind_config(&paid_list, kind_registry::kind_sprite()), 0);
    assert!(
        paid_access::kind_config_price_atomic(&paid_list, kind_registry::kind_sprite()) == PAID_ACCESS_PRICE,
        1,
    );
    assert!(
        paid_access::kind_config_scope_mask(&paid_list, kind_registry::kind_sprite()) == grant::scope_assets(),
        2,
    );
    ts::return_shared(paid_list);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::paid_access::EKindReadPaidNotAllowed)]
fun soul_doc_paid_access_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_soul_doc(),
        grant::scope_seal(),
        option::none(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::paid_access::EKindReadPaidNotAllowed)]
fun memory_paid_access_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_memory(),
        grant::scope_memory(),
        option::none(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::paid_access::EKindReadPaidNotAllowed)]
fun skill_paid_access_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    // SKILL has no READ_PAID in its descriptor → should reject.
    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_skill(),
        grant::scope_skills(),
        option::none(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::paid_access::EKindScopeMismatch)]
fun configure_paid_access_kind_rejects_scope_mismatch() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    // SPRITE descriptor scope is ASSETS, not SKILLS.
    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_skills(),
        option::none(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::paid_access::EKindAlreadyConfigured)]
fun configure_paid_access_kind_duplicate_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );
    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );
    abort 42
}

#[test]
fun paid_access_purchase_grants_seal_read_for_sprite() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    mint_usdc_to(BUYER, paid_access_total(PAID_ACCESS_PRICE), &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    let test_clock = clock::create_for_testing(scenario.ctx());
    market::purchase_paid_access(
        &config,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        payment,
        &test_clock,
        scenario.ctx(),
    );

    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
    );
    paid_access::seal_approve_content_paid_access(
        id,
        &state,
        &paid_list,
        &content_obj,
        kind_registry::kind_sprite(),
        default_sprite_name(),
        0,
        &test_clock,
        scenario.ctx(),
    );

    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(paid_list);
    ts::return_shared(state);
    ts::return_shared(content_obj);
    ts::end(scenario);
}

#[test]
fun paid_access_quote_rounds_nonzero_bps_fee_up() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let (platform_fee, price, total) = market::quote_paid_access_purchase(&config, 1);
    assert!(price == 1, 0);
    assert!(platform_fee == 1, 1);
    assert!(total == 2, 2);
    ts::return_shared(config);
    ts::end(scenario);
}

#[test]
fun paid_access_purchase_extends_unexpired_duration() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::some(1_000),
    );

    mint_usdc_to(BUYER, paid_access_total(PAID_ACCESS_PRICE), &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    let test_clock = clock::create_for_testing(scenario.ctx());
    market::purchase_paid_access(
        &config,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        payment,
        &test_clock,
        scenario.ctx(),
    );
    let first_expires = *paid_access::kind_entry_expires_at_ms(
        &paid_list,
        BUYER,
        kind_registry::kind_sprite(),
    ).borrow();
    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(paid_list);
    ts::return_shared(state);

    mint_usdc_to(BUYER, paid_access_total(PAID_ACCESS_PRICE), &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    let test_clock = clock::create_for_testing(scenario.ctx());
    market::purchase_paid_access(
        &config,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        payment,
        &test_clock,
        scenario.ctx(),
    );
    let second_expires = *paid_access::kind_entry_expires_at_ms(
        &paid_list,
        BUYER,
        kind_registry::kind_sprite(),
    ).borrow();
    assert!(second_expires == first_expires + 1_000, 0);

    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(paid_list);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::paid_access::EKindConfigOwnerEpochMismatch)]
fun paid_access_purchase_requires_current_owner_config_epoch() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    scenario.next_tx(MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    soul::rotate_owner(&mut state, BUYER, minter_kiosk_id);
    ts::return_shared(state);

    mint_usdc_to(AGENT, paid_access_total(PAID_ACCESS_PRICE), &mut scenario);
    scenario.next_tx(AGENT);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, AGENT);
    let test_clock = clock::create_for_testing(scenario.ctx());
    market::purchase_paid_access(
        &config,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        payment,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::paid_access::EMismatchedLengths)]
fun cleanup_stale_entries_rejects_mismatched_vectors() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    scenario.next_tx(AGENT);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    paid_access::cleanup_stale_entries(
        &mut paid_list,
        &state,
        vector[BUYER],
        vector::empty<u32>(),
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EPaidAccessKindMismatch)]
fun paid_access_purchase_aborts_for_unconfigured_kind() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    // Don't configure any kind. Try to buy SPRITE → fails.
    mint_usdc_to(BUYER, paid_access_total(PAID_ACCESS_PRICE), &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    let test_clock = clock::create_for_testing(scenario.ctx());
    market::purchase_paid_access(
        &config,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        payment,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EPaidAccessOwnerCannotPurchase)]
fun owner_cannot_purchase_paid_access() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    mint_usdc_to(MINTER, paid_access_total(PAID_ACCESS_PRICE), &mut scenario);
    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, MINTER);
    let test_clock = clock::create_for_testing(scenario.ctx());
    market::purchase_paid_access(
        &config,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        payment,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun add_access_per_kind_free_grants_only_that_kind() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    paid_access::add_access(
        &mut paid_list,
        &state,
        &kind_registry_obj,
        BUYER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
        &test_clock,
        scenario.ctx(),
    );
    assert!(
        paid_access::has_access(&paid_list, &state, BUYER, kind_registry::kind_sprite(), grant::scope_assets(), &test_clock),
        0,
    );
    // Audio entry doesn't exist for BUYER.
    assert!(!paid_access::has_kind_entry(&paid_list, BUYER, kind_registry::kind_audio()), 1);

    test_clock.destroy_for_testing();
    ts::return_shared(kind_registry_obj);
    ts::return_shared(paid_list);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test]
fun revoke_kind_revokes_only_that_kind() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    paid_access::add_access(
        &mut paid_list,
        &state,
        &kind_registry_obj,
        BUYER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
        &test_clock,
        scenario.ctx(),
    );
    paid_access::revoke_access(
        &mut paid_list,
        &state,
        BUYER,
        kind_registry::kind_sprite(),
        scenario.ctx(),
    );
    assert!(!paid_access::has_kind_entry(&paid_list, BUYER, kind_registry::kind_sprite()), 0);

    test_clock.destroy_for_testing();
    ts::return_shared(kind_registry_obj);
    ts::return_shared(paid_list);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test]
fun delete_paid_access_kind_removes_config_only() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    market::delete_paid_access_kind(
        &config,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        scenario.ctx(),
    );
    assert!(!paid_access::has_kind_config(&paid_list, kind_registry::kind_sprite()), 0);

    ts::return_shared(config);
    ts::return_shared(paid_list);
    ts::return_shared(state);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// Existing flows preserved (listing/buy, granted-agent append, doc id)
// ─────────────────────────────────────────────────────────────────────

#[test]
fun owner_can_append_skill_version() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
            blob_req(MINTER, BLOB_ROOT_HASH_SKILL),
            blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A),
        ],
        MINTER,
    );
    let entries = build_initial_content_from_address(MINTER, &scenario, spec_with_skill());
    let _ = mint_native_with_entries(&mut scenario, MINTER, minter_kiosk_id, entries, vector::empty());

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let v = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        read_owner_grant(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    assert!(v == 1, 0);
    assert!(
        content::version_count(&content_obj, kind_registry::kind_skill(), default_skill_name()) == 2,
        1,
    );

    test_clock.destroy_for_testing();
    ts::return_shared(kind_registry_obj);
    ts::return_shared(content_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test]
fun granted_agent_can_append_skill_version() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(AGENT, BLOB_ROOT_HASH_EXTRA_A)],
    );

    let _grant_id = issue_default_grant(&mut scenario, MINTER, AGENT, grant::scope_skills());

    scenario.next_tx(AGENT);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    let b = ts::take_from_address<blob::Blob>(&scenario, AGENT);

    let v = content::append_version_as_granted_agent(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        &g,
        kind_registry::kind_skill(),
        default_skill_name(),
        read_owner_grant(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    assert!(v == 0, 0);
    assert!(content::count_for_kind(&content_obj, kind_registry::kind_skill()) == 1, 1);

    test_clock.destroy_for_testing();
    ts::return_to_address(AGENT, g);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(content_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test]
fun deprecated_kind_blocks_new_append_but_keeps_historical_read() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    scenario.next_tx(ADMIN);
    let mut registry_admin = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);
    kind_registry::deprecate_kind(&mut registry_admin, &cap, kind_registry::kind_skill(), scenario.ctx());
    ts::return_shared(registry_admin);
    ts::return_to_address(ADMIN, cap);

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
    );
    content::seal_approve_content_owner(
        id,
        &state,
        &content_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        scenario.ctx(),
    );

    ts::return_shared(state);
    ts::return_shared(content_obj);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::kind_registry::EKindDeprecated)]
fun deprecated_kind_rejects_new_append() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(ADMIN);
    let mut registry_admin = ts::take_shared<KindRegistry>(&scenario);
    let cap = ts::take_from_address<KindAdminCap>(&scenario, ADMIN);
    kind_registry::deprecate_kind(&mut registry_admin, &cap, kind_registry::kind_skill(), scenario.ctx());
    ts::return_shared(registry_admin);
    ts::return_to_address(ADMIN, cap);

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let _ = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        read_owner_grant(),
        content::download_policy_public(),
        b,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EDocumentIdPrefixMismatch)]
fun seal_approve_rejects_wrong_kind_in_document_id() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    let id = content_document_id(
        content::content_id(&content_obj),
        kind_registry::kind_sprite(), // wrong kind in id bytes
        default_skill_name(),
        0,
    );
    content::seal_approve_content_owner(
        id,
        &state,
        &content_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EDocumentIdInvalidLength)]
fun seal_approve_rejects_short_document_id() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_skill(), vector::empty());

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let content_obj = ts::take_shared<SoulContent>(&scenario);
    content::seal_approve_content_owner(
        b"too-short",
        &state,
        &content_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        0,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::content::EKindRequiresDownloadPolicy)]
fun append_skill_with_nonzero_policy_aborts() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_invariant_with_extras(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        vector[blob_req(MINTER, BLOB_ROOT_HASH_EXTRA_A)],
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut content_obj = ts::take_shared<SoulContent>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let b = ts::take_from_address<blob::Blob>(&scenario, MINTER);

    let _ = content::append_version_as_owner(
        &mut content_obj,
        &state,
        &kind_registry_obj,
        kind_registry::kind_skill(),
        default_skill_name(),
        read_owner_grant(),
        content::download_policy_owner_only(), // nonzero, but skill kind doesn't allow
        b,
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

// ─────────────────────────────────────────────────────────────────────
// State config wallet wrappers
// ─────────────────────────────────────────────────────────────────────

#[test]
fun owner_can_upsert_and_delete_state_config() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    market::set_state_config(&config, &mut state, b"k1".to_string(), b"v1", scenario.ctx());
    assert!(soul::has_state_config(&state, b"k1".to_string()), 0);

    market::delete_state_config(&config, &mut state, b"k1".to_string(), scenario.ctx());
    assert!(!soul::has_state_config(&state, b"k1".to_string()), 1);
    ts::return_shared(config);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::market::ENotSoulOwner)]
fun non_owner_cannot_set_state_config() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    market::set_state_config(&config, &mut state, b"k1".to_string(), b"v1", scenario.ctx());
    abort 42
}

// ─────────────────────────────────────────────────────────────────────
// List / buy soul flow
// ─────────────────────────────────────────────────────────────────────

#[test]
fun list_and_buy_soul_rotates_owner_and_invalidates_grants() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, BUYER);

    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    let _grant_id = issue_default_grant(&mut scenario, MINTER, AGENT, grant::scope_seal());

    // Seller lists.
    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let seller_cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state_for_listing = ts::take_shared<SoulState>(&scenario);
    let listing = market::list_soul_fixed_price(
        &config,
        &registry,
        &mut seller_kiosk,
        &seller_cap,
        &mut state_for_listing,
        SOUL_PRICE,
        scenario.ctx(),
    );
    market::finalize_soul_listing(listing);
    ts::return_shared(state_for_listing);
    ts::return_to_address(MINTER, seller_cap);
    ts::return_shared(seller_kiosk);

    // Buyer pays exact total.
    let total = soul_purchase_total(SOUL_PRICE, CREATOR_ROYALTY_BPS, 0);
    mint_usdc_to(BUYER, total, &mut scenario);

    scenario.next_tx(BUYER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let mut listing = ts::take_shared<SoulListing>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
    let buyer_cap = ts::take_from_address<PersonalKioskCap>(&scenario, BUYER);

    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    let mut seller_kiosk_again = ts::take_shared_by_id<Kiosk>(&scenario, soul::current_kiosk_id(&state));

    market::buy_soul_fixed_price(
        &config,
        &registry,
        &soul_policy,
        &mut seller_kiosk_again,
        &mut buyer_kiosk,
        &buyer_cap,
        &mut state,
        &mut listing,
        payment,
        scenario.ctx(),
    );

    assert!(soul::current_owner(&state) == BUYER, 0);
    assert!(soul::ownership_epoch(&state) == 1, 1);
    assert!(soul::active_grant_count(&state) == 0, 2);

    ts::return_shared(soul_policy);
    ts::return_shared(state);
    ts::return_shared(listing);
    ts::return_shared(seller_kiosk_again);
    ts::return_shared(buyer_kiosk);
    ts::return_to_address(BUYER, buyer_cap);
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// Collection bind sanity
// ─────────────────────────────────────────────────────────────────────

#[test]
fun collection_creator_can_bind_soul() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let collection_policy = ts::take_shared<TransferPolicy<SoulCollectionRight>>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);

    let collection_obj = market::create_collection_in_personal_kiosk(
        &config,
        &registry,
        &collection_policy,
        &mut kiosk_obj,
        &cap,
        b"Collection One".to_string(),
        b"desc".to_string(),
        b"https://img".to_string(),
        COLLECTION_ROYALTY_BPS,
        true,
        option::some(2),
        scenario.ctx(),
    );
    market::finalize_collection(collection_obj);

    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(collection_policy);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(MINTER, cap);

    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    scenario.next_tx(MINTER);
    let mut collection_obj = ts::take_shared<SoulCollection>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    collection::add_soul(&mut collection_obj, &mut state, scenario.ctx());
    assert!(collection::current_supply(&collection_obj) == 1, 0);
    assert!(soul::collection_id(&state).contains(&object::id(&collection_obj)), 1);
    ts::return_shared(collection_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// Admin governance — Kiosk policy and package upgrade guardrails
// ─────────────────────────────────────────────────────────────────────

#[test]
fun admin_can_adjust_transfer_policy_rules_after_init() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let soul_policy_cap = ts::take_from_address<TransferPolicyCap<Soul>>(&scenario, ADMIN);

    transfer_policy::add_rule<Soul, AdminMutablePolicyRule, AdminMutablePolicyConfig>(
        AdminMutablePolicyRule {},
        &mut soul_policy,
        &soul_policy_cap,
        AdminMutablePolicyConfig {},
    );
    assert!(transfer_policy::has_rule<Soul, AdminMutablePolicyRule>(&soul_policy), 0);

    transfer_policy::remove_rule<Soul, AdminMutablePolicyRule, AdminMutablePolicyConfig>(
        &mut soul_policy,
        &soul_policy_cap,
    );
    assert!(!transfer_policy::has_rule<Soul, AdminMutablePolicyRule>(&soul_policy), 1);

    ts::return_to_address(ADMIN, soul_policy_cap);
    ts::return_shared(soul_policy);
    ts::end(scenario);
}

#[test]
fun version_fields_cover_persistent_objects() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    scenario.next_tx(ADMIN);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let descriptor = kind_registry::borrow_descriptor(&kind_registry_obj, kind_registry::kind_sprite());
    let registration = market::personal_kiosk_registration(&registry, MINTER);

    assert!(market::config_version(&config) == market::protocol_version(), 0);
    assert!(market::kiosk_registry_version(&registry) == market::protocol_version(), 1);
    assert!(market::personal_kiosk_registration_version(registration) == market::protocol_version(), 3);
    assert!(kind_registry::registry_version(&kind_registry_obj) == kind_registry::protocol_version(), 4);
    assert!(kind_registry::descriptor_version(descriptor) == kind_registry::protocol_version(), 5);

    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(kind_registry_obj);

    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let collection_policy = ts::take_shared<TransferPolicy<SoulCollectionRight>>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let kiosk_cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let content_id = *soul::content_id(&state).borrow();
    let access_list_id = *soul::access_list_id(&state).borrow();
    let content_obj = ts::take_shared_by_id<SoulContent>(&scenario, content_id);
    let mut paid_list = ts::take_shared_by_id<SoulPaidAccessList>(&scenario, access_list_id);
    let test_clock = clock::create_for_testing(scenario.ctx());

    let soul_ref = sui_kiosk::borrow<Soul>(
        &kiosk_obj,
        personal_kiosk::borrow(&kiosk_cap),
        soul::soul_id(&state),
    );
    let soul_doc_slot = content::borrow_slot(
        &content_obj,
        kind_registry::kind_soul_doc(),
        content::soul_doc_name(),
        0,
    );
    let mut binding = content::active_binding(&content_obj, kind_registry::kind_sprite());
    assert!(binding.is_some(), 10);
    let active_binding = option::extract(&mut binding);

    assert!(soul::soul_version(soul_ref) == soul::protocol_version(), 6);
    assert!(soul::state_version(&state) == soul::protocol_version(), 7);
    assert!(content::content_version(&content_obj) == content::protocol_version(), 8);
    assert!(content::slot_version(soul_doc_slot) == content::protocol_version(), 9);
    assert!(content::active_binding_version(&active_binding) == content::protocol_version(), 10);
    assert!(paid_access::paid_access_list_version(&paid_list) == paid_access::protocol_version(), 11);
    binding.destroy_none();

    paid_access::configure_paid_access_kind(
        &mut paid_list,
        &state,
        &kind_registry_obj,
        kind_registry::kind_sprite(),
        PAID_ACCESS_PRICE,
        grant::scope_assets(),
        option::none(),
        scenario.ctx(),
    );
    assert!(
        paid_access::kind_config_version(&paid_list, kind_registry::kind_sprite())
            == paid_access::protocol_version(),
        12,
    );
    paid_access::add_access(
        &mut paid_list,
        &state,
        &kind_registry_obj,
        AGENT,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
        &test_clock,
        scenario.ctx(),
    );
    assert!(
        paid_access::kind_entry_version(&paid_list, AGENT, kind_registry::kind_sprite())
            == paid_access::protocol_version(),
        13,
    );

    let grant_obj = grant::issue(
        &mut state,
        AGENT,
        grant::scope_seal(),
        option::none(),
        &test_clock,
        scenario.ctx(),
    );
    let active_grant_slot = soul::active_grant_slot_for_grantee(&state, AGENT);
    assert!(grant::grant_version(&grant_obj) == grant::protocol_version(), 14);
    assert!(soul::active_grant_slot_version(active_grant_slot) == soul::protocol_version(), 15);
    transfer::public_transfer(grant_obj, AGENT);

    let mut soul_listing = market::list_soul_fixed_price(
        &config,
        &registry,
        &mut kiosk_obj,
        &kiosk_cap,
        &mut state,
        SOUL_PRICE,
        scenario.ctx(),
    );
    assert!(market::soul_listing_version(&soul_listing) == market::protocol_version(), 16);
    market::cancel_soul_listing(&mut kiosk_obj, &kiosk_cap, &mut state, &mut soul_listing);
    market::delete_soul_listing(soul_listing, scenario.ctx());

    let collection_obj = market::create_collection_in_personal_kiosk(
        &config,
        &registry,
        &collection_policy,
        &mut kiosk_obj,
        &kiosk_cap,
        b"Versioned Collection".to_string(),
        b"desc".to_string(),
        b"https://img".to_string(),
        COLLECTION_ROYALTY_BPS,
        true,
        option::none(),
        scenario.ctx(),
    );
    let right_ref = sui_kiosk::borrow<SoulCollectionRight>(
        &kiosk_obj,
        personal_kiosk::borrow(&kiosk_cap),
        collection::right_id(&collection_obj),
    );
    assert!(collection::collection_version(&collection_obj) == collection::protocol_version(), 17);
    assert!(collection::collection_right_version(right_ref) == collection::protocol_version(), 18);

    let mut collection_listing = market::list_collection_right_fixed_price(
        &config,
        &registry,
        &collection_obj,
        &mut kiosk_obj,
        &kiosk_cap,
        SOUL_PRICE,
        scenario.ctx(),
    );
    assert!(market::collection_listing_version(&collection_listing) == market::protocol_version(), 19);
    market::cancel_collection_listing(&mut kiosk_obj, &kiosk_cap, &mut collection_listing);
    market::delete_collection_listing(collection_listing, scenario.ctx());
    collection::destroy_collection_for_testing(collection_obj);

    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(soul_policy);
    ts::return_shared(collection_policy);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(MINTER, kiosk_cap);
    ts::return_shared(state);
    ts::return_shared(content_obj);
    ts::return_shared(paid_list);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// Imported provenance — sanity that other mint paths still compile
// ─────────────────────────────────────────────────────────────────────

#[test]
fun mint_imported_records_provenance_and_origin_ref() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    mint_test_blobs_then_advance(
        &mut scenario,
        vector[
            blob_req(MINTER, BLOB_ROOT_HASH_SOUL_DOC),
            blob_req(MINTER, BLOB_ROOT_HASH_MEMORY),
        ],
        MINTER,
    );
    let config = ts::take_shared<MarketConfig>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let kiosk_cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let soul_doc_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let memory_blob = ts::take_from_address<blob::Blob>(&scenario, MINTER);
    let entries = vector[
        market::new_initial_content_entry(
            kind_registry::kind_soul_doc(),
            b"soul".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            soul_doc_blob,
        ),
        market::new_initial_content_entry(
            kind_registry::kind_memory(),
            b"default".to_string(),
            read_owner_grant(),
            content::download_policy_public(),
            false,
            memory_blob,
        ),
    ];

    let state = market::mint_imported_in_personal_kiosk(
        &config,
        &kind_registry_obj,
        &registry,
        &soul_policy,
        &mut kiosk_obj,
        &kiosk_cap,
        b"Imported".to_string(),
        b"desc".to_string(),
        b"https://example.com".to_string(),
        entries,
        vector::empty(),
        b"https://origin.example".to_string(),
        CREATOR_ROYALTY_BPS,
        &test_clock,
        scenario.ctx(),
    );
    market::finalize_soul_state(state);

    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(registry);
    ts::return_shared(soul_policy);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(MINTER, kiosk_cap);

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    assert!(soul::has_content_id(&state), 0);
    ts::return_shared(state);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// Audit 2026-05-04 — Low #3 / Low #4 regressions
// ─────────────────────────────────────────────────────────────────────

#[test]
fun paid_access_revoke_drops_empty_buyer_row() {
    // After revoking the buyer's only configured kind, the outer
    // `entries[buyer]` row must be reclaimed so long-lived Souls don't
    // accumulate empty `Table<u32, KindPaidEntry>` shells per historical
    // buyer.
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    paid_access::add_access(
        &mut paid_list,
        &state,
        &kind_registry_obj,
        BUYER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
        &test_clock,
        scenario.ctx(),
    );
    assert!(paid_access::has_buyer_row(&paid_list, BUYER), 0);

    paid_access::revoke_access(
        &mut paid_list,
        &state,
        BUYER,
        kind_registry::kind_sprite(),
        scenario.ctx(),
    );
    assert!(!paid_access::has_kind_entry(&paid_list, BUYER, kind_registry::kind_sprite()), 1);
    assert!(!paid_access::has_buyer_row(&paid_list, BUYER), 2);

    test_clock.destroy_for_testing();
    ts::return_shared(kind_registry_obj);
    ts::return_shared(paid_list);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test]
fun paid_access_cleanup_drops_empty_buyer_row_on_rotation() {
    // After ownership rotates, prior paid entries are stale; running
    // `cleanup_stale_entries` for the only configured kind must reclaim the
    // outer row, not just the inner kind entry.
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_with_sprite_active(), vector::empty());

    configure_paid_kind_for_minter(
        &mut scenario,
        MINTER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
    );

    scenario.next_tx(MINTER);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    paid_access::add_access(
        &mut paid_list,
        &state,
        &kind_registry_obj,
        BUYER,
        kind_registry::kind_sprite(),
        grant::scope_assets(),
        option::none(),
        &test_clock,
        scenario.ctx(),
    );
    assert!(paid_access::has_buyer_row(&paid_list, BUYER), 0);

    // Bypass market::buy_soul_impl path — directly rotate so the entry's
    // `ownership_epoch_snapshot` becomes stale.
    soul::rotate_owner(&mut state, BUYER, minter_kiosk_id);

    // Anyone can call cleanup; AGENT is fine.
    paid_access::cleanup_stale_entries(
        &mut paid_list,
        &state,
        vector[BUYER],
        vector[kind_registry::kind_sprite()],
        scenario.ctx(),
    );
    assert!(!paid_access::has_kind_entry(&paid_list, BUYER, kind_registry::kind_sprite()), 1);
    assert!(!paid_access::has_buyer_row(&paid_list, BUYER), 2);

    test_clock.destroy_for_testing();
    ts::return_shared(kind_registry_obj);
    ts::return_shared(paid_list);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::collection::ESoulCurrentlyListed)]
fun add_soul_aborts_when_soul_currently_listed() {
    // Audit Low #4: solo-listed Soul must not be silently bound into a
    // collection — that mid-listing rebind would make the active listing
    // un-purchasable from either solo or with-collection buy paths.
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let collection_policy = ts::take_shared<TransferPolicy<SoulCollectionRight>>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);

    let collection_obj = market::create_collection_in_personal_kiosk(
        &config,
        &registry,
        &collection_policy,
        &mut kiosk_obj,
        &cap,
        b"Listed Conflict".to_string(),
        b"desc".to_string(),
        b"https://img".to_string(),
        COLLECTION_ROYALTY_BPS,
        true,
        option::some(2),
        scenario.ctx(),
    );
    market::finalize_collection(collection_obj);
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(collection_policy);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(MINTER, cap);

    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    // Solo-list the freshly minted Soul.
    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let listing = market::list_soul_fixed_price(
        &config,
        &registry,
        &mut kiosk_obj,
        &cap,
        &mut state,
        SOUL_PRICE,
        scenario.ctx(),
    );
    market::finalize_soul_listing(listing);
    assert!(soul::is_listed(&state), 0);
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(MINTER, cap);
    ts::return_shared(state);

    // add_soul on an active solo listing must abort with ESoulCurrentlyListed.
    scenario.next_tx(MINTER);
    let mut collection_obj = ts::take_shared<SoulCollection>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    collection::add_soul(&mut collection_obj, &mut state, scenario.ctx());
    abort 42
}

#[test]
fun add_soul_succeeds_after_listing_cancelled() {
    // The audit fix must remain reversible: once cancel clears `is_listed`,
    // the seller can bind into a collection in the same session.
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let collection_policy = ts::take_shared<TransferPolicy<SoulCollectionRight>>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);

    let collection_obj = market::create_collection_in_personal_kiosk(
        &config,
        &registry,
        &collection_policy,
        &mut kiosk_obj,
        &cap,
        b"Recoverable".to_string(),
        b"desc".to_string(),
        b"https://img".to_string(),
        COLLECTION_ROYALTY_BPS,
        true,
        option::some(2),
        scenario.ctx(),
    );
    market::finalize_collection(collection_obj);
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(collection_policy);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(MINTER, cap);

    let _ = setup_and_mint_native(&mut scenario, MINTER, minter_kiosk_id, spec_invariant_only(), vector::empty());

    // List → cancel → expect is_listed=false.
    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let mut listing = market::list_soul_fixed_price(
        &config,
        &registry,
        &mut kiosk_obj,
        &cap,
        &mut state,
        SOUL_PRICE,
        scenario.ctx(),
    );
    assert!(soul::is_listed(&state), 0);
    market::cancel_soul_listing(&mut kiosk_obj, &cap, &mut state, &mut listing);
    market::delete_soul_listing(listing, scenario.ctx());
    assert!(!soul::is_listed(&state), 1);
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(MINTER, cap);
    ts::return_shared(state);

    // add_soul now succeeds.
    scenario.next_tx(MINTER);
    let mut collection_obj = ts::take_shared<SoulCollection>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    collection::add_soul(&mut collection_obj, &mut state, scenario.ctx());
    assert!(collection::current_supply(&collection_obj) == 1, 2);
    assert!(soul::collection_id(&state).contains(&object::id(&collection_obj)), 3);
    ts::return_shared(collection_obj);
    ts::return_shared(state);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// SoulState destroy helper smoke (catches schema drift)
// ─────────────────────────────────────────────────────────────────────

#[test]
fun soul_state_destroy_helper_smoke() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let state = soul::create_state(
        sui::object::id_from_address(@0xdead),
        ADMIN,
        100,
        ADMIN,
        sui::object::id_from_address(@0xbeef),
        scenario.ctx(),
    );
    soul::destroy_state_for_testing(state);
    ts::end(scenario);
}

// ─────────────────────────────────────────────────────────────────────
// Negative tests pinned by docs/plans/e2e-test-plan.md (Phase W1.5)
//
// These three tests close the gap that Test 5.8 / 7.10d / 11.0a previously
// asked the e2e executor to grep for and author at runtime. They are now
// fixed entry points that the plan can reference by name.
// ─────────────────────────────────────────────────────────────────────

#[test, expected_failure(abort_code = soulidity::grant::EGrantStillActive)]
fun destroy_invalidated_grant_aborts_when_grant_still_active() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        spec_invariant_only(),
        vector::empty(),
    );

    // Issue a grant that is currently active: epoch matches state, in
    // active_grants, no expiry. destroy_invalidated_grant must abort because
    // none of (epoch_mismatch / not_in_active / expired) holds.
    let _grant_id = issue_default_grant(
        &mut scenario,
        MINTER,
        AGENT,
        grant::scope_seal(),
    );

    scenario.next_tx(AGENT);
    let test_clock = clock::create_for_testing(scenario.ctx());
    let mut state = ts::take_shared<SoulState>(&scenario);
    let g = ts::take_from_address<SoulGrant>(&scenario, AGENT);
    grant::destroy_invalidated_grant(g, &mut state, &test_clock, scenario.ctx());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EPaidAccessNotPurchasable)]
fun purchase_paid_access_aborts_when_price_zero() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        spec_with_sprite_active(),
        vector::empty(),
    );

    // configure_paid_access_kind allows price_atomic = 0; the price-gate that
    // blocks zero-price purchases lives in market::purchase_paid_access.
    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    market::configure_paid_access_kind(
        &config,
        &kind_registry_obj,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        0,
        grant::scope_assets(),
        option::none(),
        scenario.ctx(),
    );
    ts::return_shared(config);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(paid_list);
    ts::return_shared(state);

    // Non-owner buyer attempts purchase — must abort EPaidAccessNotPurchasable.
    // BUYER ≠ MINTER so the owner-self check does not preempt the price check.
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let mut paid_list = ts::take_shared<SoulPaidAccessList>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    let test_clock = clock::create_for_testing(scenario.ctx());
    market::purchase_paid_access(
        &config,
        &mut paid_list,
        &state,
        kind_registry::kind_sprite(),
        coin::zero<USDC>(scenario.ctx()),
        &test_clock,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EListingStillActive)]
fun delete_soul_listing_aborts_when_active() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_native(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        spec_invariant_only(),
        vector::empty(),
    );

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let listing = market::list_soul_fixed_price(
        &config,
        &registry,
        &mut kiosk_obj,
        &cap,
        &mut state,
        SOUL_PRICE,
        scenario.ctx(),
    );
    // listing.is_active = true here — delete_soul_listing must abort.
    market::delete_soul_listing(listing, scenario.ctx());
    abort 42
}
