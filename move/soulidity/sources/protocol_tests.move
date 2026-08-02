#[test_only]
module soulidity::protocol_tests;

use animacraft::animacraft::{Self as animacraft, MakerTreasury, OCMaker};
use animacraft::commerce_v5::{
    Self as animacraft_commerce_v5,
    CommerceProtocolConfigV5,
    CommerceV5SoulMintAuthorization,
    MakerRootV5,
};
use std::hash;
use std::string::{Self as string, String};
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use soulidity::collection::{Self as collection, SoulCollection, SoulCollectionRight};
use soulidity::animacraft_soul_binding_v5::AnimacraftSoulBindingProofV5;
use soulidity::animacraft_output_provenance_v5::AnimacraftOutputProvenanceV5;
use soulidity::animacraft_output_seal;
use soulidity::animacraft_provenance::{Self as animacraft_provenance, AnimacraftProvenance};
use soulidity::appearance_v6::{
    Self as appearance_v6,
    GenesisAppearanceV6,
    SoulAppearanceStateV6,
};
use soulidity::content::{Self as content, SoulContent};
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::kind_registry::{Self as kind_registry, KindAdminCap, KindRegistry};
use soulidity::market::{
    Self as market,
    MarketAdminCapV6,
    MarketConfigV2,
    MarketConfigV6,
    InitialContentEntry,
    CollectionListing,
    KioskRegistry,
    MarketAdminCap,
    MarketConfig,
    AnimacraftV6SoulListing,
    SoulListing,
    StateConfigEntry,
};
use soulidity::paid_access::{Self as paid_access, SoulPaidAccessList};
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::clock::{Self as clock, Clock};
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

fun init_personal_kiosk_v2_for_sender(scenario: &mut ts::Scenario, sender: address): ID {
    scenario.next_tx(sender);
    let config = ts::take_shared<MarketConfigV2>(scenario);
    let mut registry = ts::take_shared<KioskRegistry>(scenario);
    let kiosk_id = market::init_personal_kiosk_v2(&config, &mut registry, scenario.ctx());
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

fun setup_and_mint_native_v2(
    scenario: &mut ts::Scenario,
    minter: address,
    minter_kiosk_id: ID,
    spec: MintBlobSpec,
    initial_state_config: vector<StateConfigEntry>,
): ID {
    let reqs = spec_blob_requests(spec, minter);
    mint_test_blobs_then_advance(scenario, reqs, minter);
    let initial_content = build_initial_content_from_address(minter, scenario, spec);
    let config = ts::take_shared<MarketConfigV2>(scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(scenario);
    let registry = ts::take_shared<KioskRegistry>(scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(scenario, minter_kiosk_id);
    let kiosk_cap = ts::take_from_address<PersonalKioskCap>(scenario, minter);
    let test_clock = clock::create_for_testing(scenario.ctx());

    let state = market::mint_native_in_personal_kiosk_v2(
        &config,
        &kind_registry_obj,
        &registry,
        &soul_policy,
        &mut kiosk_obj,
        &kiosk_cap,
        b"Test Soul V2".to_string(),
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

fun setup_and_mint_animacraft(
    scenario: &mut ts::Scenario,
    minter: address,
    minter_kiosk_id: ID,
): ID {
    let reqs = spec_blob_requests(spec_invariant_only(), minter);
    mint_test_blobs_then_advance(scenario, reqs, minter);
    let initial_content = build_initial_content_from_address(
        minter,
        scenario,
        spec_invariant_only(),
    );
    let test_clock = clock::create_for_testing(scenario.ctx());

    let mut creator_profile = animacraft::new_creator_profile(
        b"Animacraft Creator".to_string(),
        b"".to_string(),
        b"".to_string(),
        minter,
        scenario.ctx(),
    );
    let (mut maker, treasury, admin_cap) = animacraft::new_managed_oc_maker<USDC>(
        &mut creator_profile,
        b"Integration Maker".to_string(),
        b"Soulidity integration fixture".to_string(),
        b"https://example.com/cover.png".to_string(),
        b"maker-manifest".to_string(),
        animacraft::license_personal(),
        300,
        false,
        false,
        true,
        true,
        false,
        0,
        &test_clock,
        scenario.ctx(),
    );
    animacraft::admin_add_part(
        &admin_cap,
        &mut maker,
        b"eyes".to_string(),
        b"Eyes".to_string(),
        animacraft::part_standard(),
        0,
        true,
        true,
        &test_clock,
        scenario.ctx(),
    );
    animacraft::admin_add_color(
        &admin_cap,
        &mut maker,
        b"eyes".to_string(),
        b"#2db7a3".to_string(),
        &test_clock,
        scenario.ctx(),
    );
    animacraft::admin_add_item(
        &admin_cap,
        &mut maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"Bright".to_string(),
        b"item-blob".to_string(),
        b"".to_string(),
        animacraft::item_included(),
        &test_clock,
        scenario.ctx(),
    );
    animacraft::admin_publish_maker(
        &admin_cap,
        &mut maker,
        b"maker-manifest".to_string(),
        &test_clock,
        scenario.ctx(),
    );

    let recipe = vector[animacraft::new_recipe_slot(
        b"eyes".to_string(),
        b"bright".to_string(),
        b"#2db7a3".to_string(),
        0,
    )];
    let recipe_hash = animacraft::hash_recipe_slots(&recipe);
    let (protocol_config, protocol_treasury, protocol_admin_cap) =
        animacraft::new_protocol_fee_objects_for_testing<USDC>(
            true,
            scenario.ctx(),
        );
    let authorization = animacraft::authorize_soul_mint_with_protocol_gate(
        &maker,
        &protocol_config,
        b"Animacraft Soul".to_string(),
        b"profile-patch".to_string(),
        b"image-patch".to_string(),
        b"https://example.com/soul.png".to_string(),
        recipe_hash,
        recipe,
        &test_clock,
        scenario.ctx(),
    );

    let config = ts::take_shared<MarketConfig>(scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(scenario);
    let registry = ts::take_shared<KioskRegistry>(scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(scenario, minter_kiosk_id);
    let kiosk_cap = ts::take_from_address<PersonalKioskCap>(scenario, minter);
    let state = market::mint_animacraft_in_personal_kiosk(
        &config,
        &kind_registry_obj,
        &registry,
        &soul_policy,
        &mut kiosk_obj,
        &kiosk_cap,
        authorization,
        b"Verified Animacraft Soul".to_string(),
        initial_content,
        vector::empty(),
        &test_clock,
        scenario.ctx(),
    );
    let state_id = object::id(&state);
    assert!(soul::has_animacraft_provenance(&state), 0);
    assert!(soul::creator_royalty_bps(&state) == 0, 1);
    market::finalize_soul_state(state);

    let admin_cap = animacraft::share_managed_maker(maker, treasury, admin_cap);
    animacraft::destroy_protocol_fee_objects_for_testing(
        protocol_config,
        protocol_treasury,
        protocol_admin_cap,
    );
    animacraft::keep_creator_profile(creator_profile, scenario.ctx());
    transfer::public_transfer(admin_cap, minter);
    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(registry);
    ts::return_shared(soul_policy);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(minter, kiosk_cap);
    state_id
}

/// Build a real commerce-v5 Complete authorization whose MakerRoot freezes a
/// 250-bps Soul creator royalty. All setup objects can be destroyed after the
/// authorization is produced because the value owns the canonical snapshot.
fun new_animacraft_v5_authorization_for_testing(
    ctx: &mut TxContext,
    test_clock: &Clock,
): (
    CommerceV5SoulMintAuthorization,
    MakerRootV5,
    CommerceProtocolConfigV5,
    vector<u8>,
) {
    let mut creator_profile = animacraft::new_creator_profile(
        b"Animacraft v5 Creator".to_string(),
        b"".to_string(),
        b"".to_string(),
        ctx.sender(),
        ctx,
    );
    let (mut maker, legacy_treasury, legacy_cap) =
        animacraft::new_managed_oc_maker<USDC>(
            &mut creator_profile,
            b"Authenticated royalty Maker".to_string(),
            b"".to_string(),
            b"".to_string(),
            b"maker-manifest".to_string(),
            animacraft::license_personal(),
            300,
            false,
            false,
            true,
            true,
            false,
            0,
            test_clock,
            ctx,
        );
    animacraft::admin_add_part(
        &legacy_cap,
        &mut maker,
        b"eyes".to_string(),
        b"Eyes".to_string(),
        animacraft::part_standard(),
        0,
        true,
        true,
        test_clock,
        ctx,
    );
    animacraft::admin_add_color(
        &legacy_cap,
        &mut maker,
        b"eyes".to_string(),
        b"#2db7a3".to_string(),
        test_clock,
        ctx,
    );
    animacraft::admin_add_item(
        &legacy_cap,
        &mut maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"Bright".to_string(),
        b"eyes-blob".to_string(),
        b"".to_string(),
        animacraft::item_included(),
        test_clock,
        ctx,
    );
    animacraft::admin_publish_maker(
        &legacy_cap,
        &mut maker,
        b"maker-manifest".to_string(),
        test_clock,
        ctx,
    );

    let (
        legacy_protocol_config,
        legacy_protocol_treasury,
        mut protocol_admin,
    ) = animacraft::new_protocol_fee_objects_for_testing<USDC>(false, ctx);
    let (mut protocol_config, protocol_treasury) =
        animacraft_commerce_v5::new_commerce_protocol_v5_for_testing<USDC>(
            &legacy_protocol_config,
            &mut protocol_admin,
            ctx,
        );
    animacraft_commerce_v5::bind_logical_auxiliary_blob_v5(
        &mut protocol_config,
        &protocol_admin,
        b"canonical-transparent-png".to_string(),
    );
    animacraft_commerce_v5::bind_soul_binding_proof_type_v5<
        AnimacraftSoulBindingProofV5,
    >(
        &mut protocol_config,
        &protocol_admin,
    );
    let base_policy = animacraft_commerce_v5::new_completion_policy(
        animacraft_commerce_v5::policy_unlimited_free(),
        0,
        0,
    );
    let (
        mut root,
        treasury,
        vault,
        control_cap,
    ) = animacraft_commerce_v5::new_migrated_maker_v5_for_testing<USDC>(
        &mut maker,
        &legacy_treasury,
        legacy_cap,
        &protocol_config,
        animacraft_commerce_v5::rights_onchain_native(),
        base_policy,
        250,
        500,
        test_clock,
        ctx,
    );
    animacraft_commerce_v5::update_protocol_enabled_v5(
        &mut protocol_config,
        &protocol_admin,
        true,
    );
    animacraft_commerce_v5::register_base_style_v5(
        &mut root,
        &control_cap,
        &maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        ctx,
    );
    animacraft_commerce_v5::seal_style_registry_v5(
        &mut root,
        &control_cap,
        ctx,
    );
    animacraft_commerce_v5::activate_maker_v5(&mut root, &control_cap, ctx);

    let recipe = vector[animacraft::new_recipe_slot(
        b"eyes".to_string(),
        b"bright".to_string(),
        b"#2db7a3".to_string(),
        0,
    )];
    let styles = vector[animacraft_commerce_v5::new_style_selection_v5(
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
    )];
    let recipe_hash =
        animacraft_commerce_v5::hash_complete_selection_v5(&recipe, &styles);
    let output_nonce = hash::sha2_256(b"soulidity-v5-output-nonce");
    let output_digest = hash::sha2_256(b"soulidity-v5-output-digest");
    let output_seal_id =
        animacraft_commerce_v5::derive_complete_output_seal_id_v5(
            animacraft_commerce_v5::root_id_v5(&root),
            ctx.sender(),
            copy recipe_hash,
            copy output_nonce,
            copy output_digest,
        );
    let authorization = animacraft_commerce_v5::authorize_complete_free_v5(
        &mut root,
        &maker,
        &protocol_config,
        b"Authenticated v5 Soul".to_string(),
        b"profile".to_string(),
        b"image".to_string(),
        b"https://example.com/image.png".to_string(),
        copy output_seal_id,
        output_nonce,
        output_digest,
        recipe_hash,
        recipe,
        styles,
        test_clock,
        ctx,
    );

    std::unit_test::destroy(creator_profile);
    std::unit_test::destroy(maker);
    std::unit_test::destroy(legacy_treasury);
    std::unit_test::destroy(legacy_protocol_config);
    std::unit_test::destroy(legacy_protocol_treasury);
    std::unit_test::destroy(protocol_admin);
    std::unit_test::destroy(protocol_treasury);
    std::unit_test::destroy(treasury);
    std::unit_test::destroy(vault);
    std::unit_test::destroy(control_cap);
    (authorization, root, protocol_config, output_seal_id)
}

/// Mint a real commerce-v5 Soul and share its MakerRoot so Seal approval can
/// be exercised again after secondary ownership rotation.
fun setup_and_mint_animacraft_v5(
    scenario: &mut ts::Scenario,
    minter: address,
    minter_kiosk_id: ID,
): (ID, vector<u8>) {
    let reqs = spec_blob_requests(spec_invariant_only(), minter);
    mint_test_blobs_then_advance(scenario, reqs, minter);
    let initial_content = build_initial_content_from_address(
        minter,
        scenario,
        spec_invariant_only(),
    );
    let test_clock = clock::create_for_testing(scenario.ctx());
    let (
        authorization,
        mut root,
        protocol_config,
        output_seal_id,
    ) =
        new_animacraft_v5_authorization_for_testing(
            scenario.ctx(),
            &test_clock,
        );

    let config = ts::take_shared<MarketConfigV2>(scenario);
    let kind_registry_obj = ts::take_shared<KindRegistry>(scenario);
    let registry = ts::take_shared<KioskRegistry>(scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(scenario);
    let mut kiosk_obj =
        ts::take_shared_by_id<Kiosk>(scenario, minter_kiosk_id);
    let kiosk_cap =
        ts::take_from_address<PersonalKioskCap>(scenario, minter);
    let state = market::mint_animacraft_v5_in_personal_kiosk_v2(
        &config,
        &kind_registry_obj,
        &registry,
        &soul_policy,
        &mut kiosk_obj,
        &kiosk_cap,
        &mut root,
        &protocol_config,
        authorization,
        b"Verified Animacraft v5 Soul".to_string(),
        initial_content,
        vector::empty(),
        &test_clock,
        scenario.ctx(),
    );
    let state_id = object::id(&state);
    assert!(soul::has_animacraft_provenance(&state), 0);
    assert!(soul::has_animacraft_output_provenance_v5(&state), 1);
    assert!(soul::creator_royalty_bps(&state) == 250, 2);
    market::finalize_soul_state(state);
    animacraft_commerce_v5::share_root_v5_for_testing(root);
    std::unit_test::destroy(protocol_config);

    test_clock.destroy_for_testing();
    ts::return_shared(config);
    ts::return_shared(kind_registry_obj);
    ts::return_shared(registry);
    ts::return_shared(soul_policy);
    ts::return_shared(kiosk_obj);
    ts::return_to_address(minter, kiosk_cap);
    (state_id, output_seal_id)
}

/// Retire the legacy market, then explicitly enable primary minting for tests
/// that exercise v2 mint behavior. Production retirement itself leaves both
/// gates disabled.
fun retire_legacy_market_for_v2_testing(scenario: &mut ts::Scenario) {
    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(scenario);
    let legacy_admin =
        ts::take_from_address<MarketAdminCap>(scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(
        &mut legacy_config,
        legacy_admin,
        scenario.ctx(),
    );
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let mut successor = ts::take_shared<MarketConfigV2>(scenario);
    let successor_v6 = ts::take_shared<MarketConfigV6>(scenario);
    let successor_admin =
        ts::take_from_address<MarketAdminCapV6>(scenario, ADMIN);
    market::update_config_v6_primary_enabled(
        &mut successor,
        &successor_admin,
        true,
    );
    ts::return_shared(successor);
    ts::return_shared(successor_v6);
    ts::return_to_address(ADMIN, successor_admin);
}

fun enable_secondary_market_v6_for_testing(scenario: &mut ts::Scenario) {
    scenario.next_tx(ADMIN);
    let config_v2 = ts::take_shared<MarketConfigV2>(scenario);
    let mut config_v6 = ts::take_shared<MarketConfigV6>(scenario);
    let admin_cap =
        ts::take_from_address<MarketAdminCapV6>(scenario, ADMIN);
    market::update_config_v6_secondary_enabled(
        &config_v2,
        &mut config_v6,
        &admin_cap,
        true,
    );
    ts::return_shared(config_v2);
    ts::return_shared(config_v6);
    ts::return_to_address(ADMIN, admin_cap);
}

/// Exercise one of the two legacy v4 mint ABIs with the canonical inner
/// authorization extracted from a genuine commerce-v5 completion. The
/// production mint implementation must reject it on the authenticated
/// Animacraft version before any Soul can be created.
fun attempt_v5_authorization_through_legacy_mint_for_testing(
    scenario: &mut ts::Scenario,
    minter_kiosk_id: ID,
    use_successor_market: bool,
) {
    let reqs = spec_blob_requests(spec_invariant_only(), MINTER);
    mint_test_blobs_then_advance(scenario, reqs, MINTER);
    let initial_content = build_initial_content_from_address(
        MINTER,
        scenario,
        spec_invariant_only(),
    );
    let test_clock = clock::create_for_testing(scenario.ctx());
    let (
        authorization,
        _root,
        _protocol_config,
        _output_seal_id,
    ) = new_animacraft_v5_authorization_for_testing(
        scenario.ctx(),
        &test_clock,
    );
    let (
        canonical_authorization,
        _creator_royalty_bps,
        _output_binding,
    ) =
        animacraft_commerce_v5::consume_commerce_v5_soul_mint_authorization(
            authorization,
        );

    let kind_registry_obj = ts::take_shared<KindRegistry>(scenario);
    let registry = ts::take_shared<KioskRegistry>(scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(scenario);
    let mut kiosk_obj =
        ts::take_shared_by_id<Kiosk>(scenario, minter_kiosk_id);
    let kiosk_cap =
        ts::take_from_address<PersonalKioskCap>(scenario, MINTER);
    if (use_successor_market) {
        let config = ts::take_shared<MarketConfigV2>(scenario);
        let _state = market::mint_animacraft_in_personal_kiosk_v2(
            &config,
            &kind_registry_obj,
            &registry,
            &soul_policy,
            &mut kiosk_obj,
            &kiosk_cap,
            canonical_authorization,
            b"Must reject v5 authorization on v4 ABI".to_string(),
            initial_content,
            vector[],
            &test_clock,
            scenario.ctx(),
        );
    } else {
        let config = ts::take_shared<MarketConfig>(scenario);
        let _state = market::mint_animacraft_in_personal_kiosk(
            &config,
            &kind_registry_obj,
            &registry,
            &soul_policy,
            &mut kiosk_obj,
            &kiosk_cap,
            canonical_authorization,
            b"Must reject v5 authorization on legacy ABI".to_string(),
            initial_content,
            vector[],
            &test_clock,
            scenario.ctx(),
        );
    };
    abort 42
}

/// Mint a genuine v5 Soul, then attempt to route it through either the generic
/// or v4-only successor listing ABI. Both paths must fail before a kiosk
/// purchase capability or public listing is created.
fun attempt_v5_soul_through_non_v5_listing_for_testing(
    scenario: &mut ts::Scenario,
    minter_kiosk_id: ID,
    use_generic_listing: bool,
) {
    retire_legacy_market_for_v2_testing(scenario);
    let (_state_id, _output_seal_id) = setup_and_mint_animacraft_v5(
        scenario,
        MINTER,
        minter_kiosk_id,
    );
    enable_secondary_market_v6_for_testing(scenario);

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfigV6>(scenario);
    let registry = ts::take_shared<KioskRegistry>(scenario);
    let provenance = ts::take_immutable<AnimacraftProvenance>(scenario);
    let mut kiosk_obj =
        ts::take_shared_by_id<Kiosk>(scenario, minter_kiosk_id);
    let kiosk_cap =
        ts::take_from_address<PersonalKioskCap>(scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(scenario);
    if (use_generic_listing) {
        let _listing = market::list_soul_fixed_price_v6(
            &config,
            &registry,
            &mut kiosk_obj,
            &kiosk_cap,
            &mut state,
            SOUL_PRICE,
            scenario.ctx(),
        );
    } else {
        let _listing = market::list_animacraft_soul_fixed_price_v6(
            &config,
            &registry,
            &provenance,
            &mut kiosk_obj,
            &kiosk_cap,
            &mut state,
            SOUL_PRICE,
            scenario.ctx(),
        );
    };
    abort 42
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

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftProtocolVersion)]
fun animacraft_v5_authorization_cannot_use_legacy_v1_mint() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id =
        init_personal_kiosk_for_sender(&mut scenario, MINTER);
    attempt_v5_authorization_through_legacy_mint_for_testing(
        &mut scenario,
        minter_kiosk_id,
        false,
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftProtocolVersion)]
fun animacraft_v5_authorization_cannot_use_legacy_v2_mint() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id =
        init_personal_kiosk_for_sender(&mut scenario, MINTER);
    retire_legacy_market_for_v2_testing(&mut scenario);
    attempt_v5_authorization_through_legacy_mint_for_testing(
        &mut scenario,
        minter_kiosk_id,
        true,
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftListingPathRequired)]
fun animacraft_v5_soul_cannot_use_generic_v2_listing() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id =
        init_personal_kiosk_for_sender(&mut scenario, MINTER);
    attempt_v5_soul_through_non_v5_listing_for_testing(
        &mut scenario,
        minter_kiosk_id,
        true,
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftV5CommercePathRequired)]
fun animacraft_v5_soul_cannot_use_v4_animacraft_v2_listing() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id =
        init_personal_kiosk_for_sender(&mut scenario, MINTER);
    attempt_v5_soul_through_non_v5_listing_for_testing(
        &mut scenario,
        minter_kiosk_id,
        false,
    );
    abort 42
}

#[test]
fun animacraft_v5_mint_royalty_comes_from_authenticated_authorization() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id =
        init_personal_kiosk_for_sender(&mut scenario, MINTER);
    retire_legacy_market_for_v2_testing(&mut scenario);
    let (_state_id, _output_seal_id) = setup_and_mint_animacraft_v5(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
    );

    // The production mint ABI has no caller-supplied creator bps. The state
    // can only receive the 250-bps value consumed from Animacraft's v5
    // authorization, together with its TypeName-anchored Soul binding proof.
    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    assert!(soul::creator_royalty_bps(&state) == 250, 0);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test]
fun animacraft_v5_output_seal_follows_current_soul_owner() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id =
        init_personal_kiosk_for_sender(&mut scenario, MINTER);
    retire_legacy_market_for_v2_testing(&mut scenario);
    let (state_id, output_seal_id) = setup_and_mint_animacraft_v5(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
    );

    // The payer/current owner can initially decrypt the completed PNG.
    scenario.next_tx(MINTER);
    let root = ts::take_shared<MakerRootV5>(&scenario);
    let provenance =
        ts::take_immutable<AnimacraftProvenance>(&scenario);
    let completed_output =
        ts::take_immutable<AnimacraftOutputProvenanceV5>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    assert!(object::id(&state) == state_id, 0);
    assert!(
        soul::animacraft_output_provenance_v5_id(&state)
            == object::id(&completed_output),
        1,
    );
    animacraft_output_seal::seal_approve_animacraft_complete_output_v5(
        copy output_seal_id,
        &root,
        &provenance,
        &completed_output,
        &state,
        scenario.ctx(),
    );

    // A secondary purchase already calls this same owner rotation. Neither
    // immutable provenance object nor the MakerRoot output record is edited.
    soul::rotate_owner(
        &mut state,
        BUYER,
        sui::object::id_from_address(@0xc501),
    );
    ts::return_shared(root);
    ts::return_immutable(provenance);
    ts::return_immutable(completed_output);
    ts::return_shared(state);

    // The new owner can now obtain the exact same ciphertext key.
    scenario.next_tx(BUYER);
    let root = ts::take_shared<MakerRootV5>(&scenario);
    let provenance =
        ts::take_immutable<AnimacraftProvenance>(&scenario);
    let completed_output =
        ts::take_immutable<AnimacraftOutputProvenanceV5>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    assert!(soul::current_owner(&state) == BUYER, 2);
    assert!(soul::ownership_epoch(&state) == 1, 3);
    animacraft_output_seal::seal_approve_animacraft_complete_output_v5(
        output_seal_id,
        &root,
        &provenance,
        &completed_output,
        &state,
        scenario.ctx(),
    );

    ts::return_shared(root);
    ts::return_immutable(provenance);
    ts::return_immutable(completed_output);
    ts::return_shared(state);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::animacraft_output_seal::ENoAccess)]
fun animacraft_v5_output_seal_rejects_original_payer_after_resale() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id =
        init_personal_kiosk_for_sender(&mut scenario, MINTER);
    retire_legacy_market_for_v2_testing(&mut scenario);
    let (_, output_seal_id) = setup_and_mint_animacraft_v5(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
    );

    scenario.next_tx(MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    soul::rotate_owner(
        &mut state,
        BUYER,
        sui::object::id_from_address(@0xc502),
    );
    ts::return_shared(state);

    // The completion payer is immutable provenance, but no longer an access
    // authority after current ownership moves to the buyer.
    scenario.next_tx(MINTER);
    let root = ts::take_shared<MakerRootV5>(&scenario);
    let provenance =
        ts::take_immutable<AnimacraftProvenance>(&scenario);
    let completed_output =
        ts::take_immutable<AnimacraftOutputProvenanceV5>(&scenario);
    let state = ts::take_shared<SoulState>(&scenario);
    animacraft_output_seal::seal_approve_animacraft_complete_output_v5(
        output_seal_id,
        &root,
        &provenance,
        &completed_output,
        &state,
        scenario.ctx(),
    );
    abort 42
}

#[test]
fun animacraft_v5_quote_uses_the_approved_gross_price_distribution() {
    let (seller, protocol, soul_creator, maker_source) =
        market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 250, 300);
    assert!(seller == 920_000, 0);
    assert!(protocol == 25_000, 1);
    assert!(soul_creator == 25_000, 2);
    assert!(maker_source == 30_000, 3);

    let (seller_at_cap, protocol_at_cap, creator_at_cap, maker_at_cap) =
        market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 250, 500);
    assert!(seller_at_cap == 900_000, 4);
    assert!(protocol_at_cap == 25_000, 5);
    assert!(creator_at_cap == 25_000, 6);
    assert!(maker_at_cap == 50_000, 7);

    let (seller_at_defaults, protocol_at_defaults, creator_at_defaults, maker_at_defaults) =
        market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 250, 250);
    assert!(seller_at_defaults == 925_000, 8);
    assert!(protocol_at_defaults == 25_000, 9);
    assert!(creator_at_defaults == 25_000, 10);
    assert!(maker_at_defaults == 25_000, 11);

    let (
        seller_at_full_rights_cap,
        protocol_at_full_rights_cap,
        creator_at_full_rights_cap,
        maker_at_full_rights_cap,
    ) = market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 500, 500);
    assert!(seller_at_full_rights_cap == 875_000, 12);
    assert!(protocol_at_full_rights_cap == 25_000, 13);
    assert!(creator_at_full_rights_cap == 50_000, 14);
    assert!(maker_at_full_rights_cap == 50_000, 15);

    let (seller_without_source, _, _, maker_without_source) =
        market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 250, 0);
    assert!(seller_without_source == 950_000, 16);
    assert!(maker_without_source == 0, 17);
}

#[test]
fun animacraft_v5_creator_royalty_snapshot_survives_multiple_resales() {
    let mut scenario = ts::begin(ADMIN);
    scenario.next_tx(ADMIN);
    let mut state = soul::create_state(
        sui::object::id_from_address(@0xa11ce),
        MINTER,
        250,
        MINTER,
        sui::object::id_from_address(@0xb001),
        scenario.ctx(),
    );

    let (seller_1, protocol_1, creator_1, source_1) =
        market::quote_animacraft_v5_soul_sale_for_state(&state, SOUL_PRICE, 250);
    soul::rotate_owner(
        &mut state,
        BUYER,
        sui::object::id_from_address(@0xb002),
    );
    let (seller_2, protocol_2, creator_2, source_2) =
        market::quote_animacraft_v5_soul_sale_for_state(&state, SOUL_PRICE, 250);
    soul::rotate_owner(
        &mut state,
        AGENT,
        sui::object::id_from_address(@0xb003),
    );
    let (seller_3, protocol_3, creator_3, source_3) =
        market::quote_animacraft_v5_soul_sale_for_state(&state, SOUL_PRICE, 250);

    assert!(soul::state_creator(&state) == MINTER, 0);
    assert!(soul::creator_royalty_bps(&state) == 250, 1);
    assert!(seller_1 == 925_000 && seller_2 == seller_1 && seller_3 == seller_1, 2);
    assert!(protocol_1 == 25_000 && protocol_2 == protocol_1 && protocol_3 == protocol_1, 3);
    assert!(creator_1 == 25_000 && creator_2 == creator_1 && creator_3 == creator_1, 4);
    assert!(source_1 == 25_000 && source_2 == source_1 && source_3 == source_1, 5);

    soul::destroy_state_for_testing(state);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftV5CreatorRoyaltyMismatch)]
fun animacraft_v5_later_holder_cannot_lower_frozen_creator_royalty() {
    let mut scenario = ts::begin(ADMIN);
    scenario.next_tx(ADMIN);
    let mut state = soul::create_state(
        sui::object::id_from_address(@0xa11ce),
        MINTER,
        250,
        MINTER,
        sui::object::id_from_address(@0xb001),
        scenario.ctx(),
    );
    soul::rotate_owner(
        &mut state,
        BUYER,
        sui::object::id_from_address(@0xb002),
    );
    market::assert_animacraft_v5_creator_royalty_snapshot_for_testing(&state, 0);
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftV5CreatorRoyaltyTooHigh)]
fun animacraft_v5_quote_rejects_creator_royalty_above_five_percent() {
    let (_, _, _, _) = market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 501, 0);
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftV5MakerRoyaltyMismatch)]
fun animacraft_v5_quote_rejects_rights_pool_above_ten_percent() {
    let (_, _, _, _) =
        market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 500, 550);
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftV5MakerRoyaltyMismatch)]
fun animacraft_v5_quote_rejects_maker_source_royalty_outside_half_percent_steps() {
    let (_, _, _, _) = market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 250, 275);
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftV5CreatorRoyaltyTooHigh)]
fun animacraft_v5_quote_rejects_creator_royalty_outside_half_percent_steps() {
    let (_, _, _, _) = market::quote_animacraft_v5_soul_sale(SOUL_PRICE, 275, 250);
    abort 42
}

#[test]
fun legacy_market_retirement_is_one_way_and_secondary_defaults_closed() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_config_id = object::id(&legacy_config);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    assert!(market::paused(&legacy_config), 0);
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let successor = ts::take_shared<MarketConfigV2>(&scenario);
    let successor_v6 = ts::take_shared<MarketConfigV6>(&scenario);
    let successor_admin = ts::take_from_address<MarketAdminCapV6>(&scenario, ADMIN);
    assert!(market::config_v2_version(&successor) == 2, 1);
    assert!(market::config_v2_legacy_config_id(&successor) == legacy_config_id, 2);
    assert!(market::admin_cap_v6_config_v2_id(&successor_admin) == object::id(&successor), 3);
    assert!(market::admin_cap_v6_config_v6_id(&successor_admin) == object::id(&successor_v6), 4);
    assert!(!market::config_v2_primary_enabled(&successor), 4);
    assert!(!market::config_v2_secondary_enabled(&successor), 5);
    assert!(!market::config_v6_secondary_enabled(&successor_v6), 6);
    ts::return_shared(successor);
    ts::return_shared(successor_v6);
    ts::return_to_address(ADMIN, successor_admin);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::market::ELegacyMarketMustBePaused)]
fun legacy_market_cannot_retire_before_pause() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::ESecondaryPausedV2)]
fun successor_secondary_market_is_fail_closed_after_retirement() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let successor = ts::take_shared<MarketConfigV2>(&scenario);
    let (_, _, _, _, _) =
        market::quote_animacraft_soul_purchase_v2(&successor, SOUL_PRICE, 300, 0);
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::ESecondaryPausedV2)]
fun enabling_v6_secondary_never_reopens_v2_secondary_entrypoints() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin =
        ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(
        &mut legacy_config,
        legacy_admin,
        scenario.ctx(),
    );
    ts::return_shared(legacy_config);

    enable_secondary_market_v6_for_testing(&mut scenario);

    scenario.next_tx(ADMIN);
    let successor = ts::take_shared<MarketConfigV2>(&scenario);
    let successor_v6 = ts::take_shared<MarketConfigV6>(&scenario);
    assert!(!market::config_v2_secondary_enabled(&successor), 0);
    assert!(market::config_v6_secondary_enabled(&successor_v6), 1);

    // The deployed v2 ABI must remain fail-closed even while the v6 market is
    // live. Otherwise an old TypeOrigin listing could bypass v6 invariants.
    let (_, _, _, _, _) =
        market::quote_animacraft_soul_purchase_v2(
            &successor,
            SOUL_PRICE,
            300,
            0,
        );
    abort 42
}

#[test]
fun v6_secondary_kiosk_works_while_primary_remains_disabled() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin =
        ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(
        &mut legacy_config,
        legacy_admin,
        scenario.ctx(),
    );
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let successor = ts::take_shared<MarketConfigV2>(&scenario);
    let mut successor_v6 = ts::take_shared<MarketConfigV6>(&scenario);
    let successor_admin =
        ts::take_from_address<MarketAdminCapV6>(&scenario, ADMIN);
    assert!(!market::config_v2_primary_enabled(&successor), 0);
    assert!(!market::config_v2_secondary_enabled(&successor), 1);
    market::update_config_v6_secondary_enabled(
        &successor,
        &mut successor_v6,
        &successor_admin,
        true,
    );
    assert!(!market::config_v2_primary_enabled(&successor), 2);
    assert!(!market::config_v2_secondary_enabled(&successor), 3);
    assert!(market::config_v6_secondary_enabled(&successor_v6), 4);
    ts::return_shared(successor);
    ts::return_shared(successor_v6);
    ts::return_to_address(ADMIN, successor_admin);

    scenario.next_tx(BUYER);
    let successor_v6 = ts::take_shared<MarketConfigV6>(&scenario);
    let mut registry = ts::take_shared<KioskRegistry>(&scenario);
    let _kiosk_id = market::init_personal_kiosk_v6(
        &successor_v6,
        &mut registry,
        scenario.ctx(),
    );
    let registration =
        market::personal_kiosk_registration(&registry, BUYER);
    assert!(
        market::personal_kiosk_registration_version(registration)
            == market::protocol_version(),
        5,
    );
    ts::return_shared(successor_v6);
    ts::return_shared(registry);
    ts::end(scenario);
}

#[test]
fun pre_retirement_soul_listing_settles_through_unified_v2() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, BUYER);
    let _ = setup_and_mint_native(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        spec_invariant_only(),
        vector[],
    );

    // A live listing created by v1 remains a valid shared object. Retirement
    // must not strand it: sellers can still cancel without any config, while
    // buyers can settle it through the unified v2 fee policy.
    scenario.next_tx(MINTER);
    let legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let seller_cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let listing = market::list_soul_fixed_price(
        &legacy_config,
        &registry,
        &mut seller_kiosk,
        &seller_cap,
        &mut state,
        SOUL_PRICE,
        scenario.ctx(),
    );
    market::finalize_soul_listing(listing);
    ts::return_shared(legacy_config);
    ts::return_shared(registry);
    ts::return_shared(seller_kiosk);
    ts::return_to_address(MINTER, seller_cap);
    ts::return_shared(state);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let config_v2 = ts::take_shared<MarketConfigV2>(&scenario);
    let mut config = ts::take_shared<MarketConfigV6>(&scenario);
    let admin_cap = ts::take_from_address<MarketAdminCapV6>(&scenario, ADMIN);
    market::update_config_v6_secondary_enabled(&config_v2, &mut config, &admin_cap, true);
    ts::return_shared(config_v2);
    ts::return_shared(config);
    ts::return_to_address(ADMIN, admin_cap);

    let total = soul_purchase_total(SOUL_PRICE, CREATOR_ROYALTY_BPS, 0);
    mint_usdc_to(BUYER, total, &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
    let buyer_cap = ts::take_from_address<PersonalKioskCap>(&scenario, BUYER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let mut listing = ts::take_shared<SoulListing>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    market::buy_soul_fixed_price_v6(
        &config,
        &registry,
        &soul_policy,
        &mut seller_kiosk,
        &mut buyer_kiosk,
        &buyer_cap,
        &mut state,
        &mut listing,
        payment,
        scenario.ctx(),
    );
    assert!(soul::current_owner(&state) == BUYER, 0);
    assert!(soul::ownership_epoch(&state) == 1, 1);

    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(soul_policy);
    ts::return_shared(seller_kiosk);
    ts::return_shared(buyer_kiosk);
    ts::return_to_address(BUYER, buyer_cap);
    ts::return_shared(state);
    ts::return_shared(listing);
    ts::end(scenario);
}

#[test]
fun pre_retirement_collection_listing_settles_through_unified_v2() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, BUYER);

    scenario.next_tx(MINTER);
    let legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let collection_policy =
        ts::take_shared<TransferPolicy<SoulCollectionRight>>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let seller_cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let collection_obj = market::create_collection_in_personal_kiosk(
        &legacy_config,
        &registry,
        &collection_policy,
        &mut seller_kiosk,
        &seller_cap,
        b"Pre-retirement Collection".to_string(),
        b"Migration fixture".to_string(),
        b"https://example.com/collection.png".to_string(),
        COLLECTION_ROYALTY_BPS,
        true,
        option::none(),
        scenario.ctx(),
    );
    let listing = market::list_collection_right_fixed_price(
        &legacy_config,
        &registry,
        &collection_obj,
        &mut seller_kiosk,
        &seller_cap,
        SOUL_PRICE,
        scenario.ctx(),
    );
    market::finalize_collection(collection_obj);
    market::finalize_collection_listing(listing);
    ts::return_shared(legacy_config);
    ts::return_shared(registry);
    ts::return_shared(collection_policy);
    ts::return_shared(seller_kiosk);
    ts::return_to_address(MINTER, seller_cap);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let config_v2 = ts::take_shared<MarketConfigV2>(&scenario);
    let mut config = ts::take_shared<MarketConfigV6>(&scenario);
    let admin_cap = ts::take_from_address<MarketAdminCapV6>(&scenario, ADMIN);
    market::update_config_v6_secondary_enabled(&config_v2, &mut config, &admin_cap, true);
    ts::return_shared(config_v2);
    ts::return_shared(config);
    ts::return_to_address(ADMIN, admin_cap);

    let total = SOUL_PRICE + default_platform_fee(SOUL_PRICE);
    mint_usdc_to(BUYER, total, &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let collection_policy =
        ts::take_shared<TransferPolicy<SoulCollectionRight>>(&scenario);
    let mut collection_obj = ts::take_shared<SoulCollection>(&scenario);
    let mut listing = ts::take_shared<CollectionListing>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
    let buyer_cap = ts::take_from_address<PersonalKioskCap>(&scenario, BUYER);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    market::buy_collection_right_fixed_price_v6(
        &config,
        &registry,
        &collection_policy,
        &mut collection_obj,
        &mut seller_kiosk,
        &mut buyer_kiosk,
        &buyer_cap,
        &mut listing,
        payment,
        scenario.ctx(),
    );
    assert!(collection::current_holder(&collection_obj) == BUYER, 0);
    assert!(collection::current_holder_kiosk_id(&collection_obj) == buyer_kiosk_id, 1);

    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(collection_policy);
    ts::return_shared(collection_obj);
    ts::return_shared(listing);
    ts::return_shared(seller_kiosk);
    ts::return_shared(buyer_kiosk);
    ts::return_to_address(BUYER, buyer_cap);
    ts::end(scenario);
}

#[test]
fun ordinary_soul_full_lifecycle_works_after_legacy_retirement() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let mut config_v2 = ts::take_shared<MarketConfigV2>(&scenario);
    let mut config_v6 = ts::take_shared<MarketConfigV6>(&scenario);
    let admin_cap = ts::take_from_address<MarketAdminCapV6>(&scenario, ADMIN);
    market::update_config_v6_primary_enabled(&mut config_v2, &admin_cap, true);
    market::update_config_v6_secondary_enabled(&config_v2, &mut config_v6, &admin_cap, true);
    ts::return_shared(config_v2);
    ts::return_shared(config_v6);
    ts::return_to_address(ADMIN, admin_cap);

    // Kiosk creation, ordinary mint, list, quote and buy all run exclusively
    // against successor state after the v1 admin capability has been deleted.
    let minter_kiosk_id = init_personal_kiosk_v2_for_sender(&mut scenario, MINTER);
    let buyer_kiosk_id = init_personal_kiosk_v2_for_sender(&mut scenario, BUYER);
    let _ = setup_and_mint_native_v2(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
        spec_invariant_only(),
        vector[],
    );

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let seller_cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let listing = market::list_soul_fixed_price_v6(
        &config,
        &registry,
        &mut seller_kiosk,
        &seller_cap,
        &mut state,
        SOUL_PRICE,
        scenario.ctx(),
    );
    market::finalize_soul_listing(listing);
    let (_, _, _, _, total) =
        market::quote_soul_purchase_v6(&config, SOUL_PRICE, CREATOR_ROYALTY_BPS, 0);
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(seller_kiosk);
    ts::return_to_address(MINTER, seller_cap);
    ts::return_shared(state);

    mint_usdc_to(BUYER, total, &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
    let buyer_cap = ts::take_from_address<PersonalKioskCap>(&scenario, BUYER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let mut listing = ts::take_shared<SoulListing>(&scenario);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    market::buy_soul_fixed_price_v6(
        &config,
        &registry,
        &soul_policy,
        &mut seller_kiosk,
        &mut buyer_kiosk,
        &buyer_cap,
        &mut state,
        &mut listing,
        payment,
        scenario.ctx(),
    );
    assert!(soul::current_owner(&state) == BUYER, 0);
    assert!(soul::ownership_epoch(&state) == 1, 1);

    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(soul_policy);
    ts::return_shared(seller_kiosk);
    ts::return_shared(buyer_kiosk);
    ts::return_to_address(BUYER, buyer_cap);
    ts::return_shared(state);
    ts::return_shared(listing);
    ts::end(scenario);
}

#[test]
fun animacraft_soul_mints_and_routes_maker_royalty() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, BUYER);
    let _state_id = setup_and_mint_animacraft(&mut scenario, MINTER, minter_kiosk_id);

    // Retire the immutable v1 entrypoints before any Animacraft secondary
    // operation. Explicitly enable only the audited successor path.
    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let config_v2 = ts::take_shared<MarketConfigV2>(&scenario);
    let mut config = ts::take_shared<MarketConfigV6>(&scenario);
    let successor_admin = ts::take_from_address<MarketAdminCapV6>(&scenario, ADMIN);
    market::update_config_v6_secondary_enabled(&config_v2, &mut config, &successor_admin, true);
    ts::return_shared(config_v2);
    ts::return_shared(config);
    ts::return_to_address(ADMIN, successor_admin);

    // Listing and purchase both require immutable Animacraft provenance so
    // the Maker royalty is validated before the listing becomes public.
    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let provenance_for_listing = ts::take_immutable<AnimacraftProvenance>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let seller_cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state_for_listing = ts::take_shared<SoulState>(&scenario);
    let listing = market::list_animacraft_soul_fixed_price_v6(
        &config,
        &registry,
        &provenance_for_listing,
        &mut seller_kiosk,
        &seller_cap,
        &mut state_for_listing,
        SOUL_PRICE,
        scenario.ctx(),
    );
    market::finalize_soul_listing(listing);
    let (platform_fee, _, maker_royalty, _, total) =
        market::quote_animacraft_soul_purchase_v6(&config, SOUL_PRICE, 300, 0);
    assert!(platform_fee == 25_000, 2);
    assert!(maker_royalty == 30_000, 3);
    assert!(total == 1_055_000, 4);
    ts::return_shared(state_for_listing);
    ts::return_to_address(MINTER, seller_cap);
    ts::return_shared(seller_kiosk);
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_immutable(provenance_for_listing);

    mint_usdc_to(BUYER, total, &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let provenance = ts::take_immutable<AnimacraftProvenance>(&scenario);
    let maker = ts::take_shared<OCMaker>(&scenario);
    let mut maker_treasury = ts::take_shared<MakerTreasury<USDC>>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let mut listing = ts::take_shared<SoulListing>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
    let buyer_cap = ts::take_from_address<PersonalKioskCap>(&scenario, BUYER);
    let payment = ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);

    assert!(animacraft_provenance::animacraft_version(&provenance) == 4, 5);
    assert!(animacraft_provenance::payer(&provenance) == MINTER, 6);
    assert!(animacraft_provenance::royalty_bps(&provenance) == 300, 7);
    assert!(animacraft_provenance::primary_protocol_fee_bps(&provenance) == 5_000, 8);
    assert!(animacraft_provenance::primary_protocol_fee_atomic(&provenance) == 0, 9);
    assert!(animacraft::treasury_balance(&maker_treasury) == 0, 10);
    market::buy_animacraft_soul_fixed_price_v6(
        &config,
        &registry,
        &soul_policy,
        &provenance,
        &maker,
        &mut maker_treasury,
        &mut seller_kiosk,
        &mut buyer_kiosk,
        &buyer_cap,
        &mut state,
        &mut listing,
        payment,
        scenario.ctx(),
    );

    assert!(soul::current_owner(&state) == BUYER, 9);
    assert!(soul::ownership_epoch(&state) == 1, 10);
    assert!(animacraft::treasury_balance(&maker_treasury) == maker_royalty, 11);
    assert!(animacraft::treasury_total_royalty_collected(&maker_treasury) == maker_royalty, 12);

    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(soul_policy);
    ts::return_immutable(provenance);
    ts::return_shared(maker);
    ts::return_shared(maker_treasury);
    ts::return_shared(state);
    ts::return_shared(listing);
    ts::return_shared(seller_kiosk);
    ts::return_shared(buyer_kiosk);
    ts::return_to_address(BUYER, buyer_cap);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftListingPathRequired)]
fun generic_listing_cannot_bypass_animacraft_royalty() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let _ = setup_and_mint_animacraft(&mut scenario, MINTER, minter_kiosk_id);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let config_v2 = ts::take_shared<MarketConfigV2>(&scenario);
    let mut config = ts::take_shared<MarketConfigV6>(&scenario);
    let admin_cap = ts::take_from_address<MarketAdminCapV6>(&scenario, ADMIN);
    market::update_config_v6_secondary_enabled(&config_v2, &mut config, &admin_cap, true);
    ts::return_shared(config_v2);
    ts::return_shared(config);
    ts::return_to_address(ADMIN, admin_cap);

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let seller_cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let _listing = market::list_soul_fixed_price_v6(
        &config,
        &registry,
        &mut seller_kiosk,
        &seller_cap,
        &mut state,
        SOUL_PRICE,
        scenario.ctx(),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::market::ECombinedFeesTooHigh)]
fun animacraft_collection_listing_rejects_unfillable_fee_stack() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);

    // 95% collection + 3% Maker + 2.5% protocol exceeds 100%. The old generic
    // listing check saw only collection + protocol and created a dead listing.
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
        b"Unfillable".to_string(),
        b"fee stack regression".to_string(),
        b"https://img".to_string(),
        9_500,
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

    let _ = setup_and_mint_animacraft(&mut scenario, MINTER, minter_kiosk_id);

    scenario.next_tx(MINTER);
    let mut collection_obj = ts::take_shared<SoulCollection>(&scenario);
    let mut state = ts::take_shared<SoulState>(&scenario);
    collection::add_soul(&mut collection_obj, &mut state, scenario.ctx());
    ts::return_shared(collection_obj);
    ts::return_shared(state);

    scenario.next_tx(ADMIN);
    let mut legacy_config = ts::take_shared<MarketConfig>(&scenario);
    let legacy_admin = ts::take_from_address<MarketAdminCap>(&scenario, ADMIN);
    market::update_paused(&mut legacy_config, &legacy_admin, true);
    market::retire_legacy_market(&mut legacy_config, legacy_admin, scenario.ctx());
    ts::return_shared(legacy_config);

    scenario.next_tx(ADMIN);
    let config_v2 = ts::take_shared<MarketConfigV2>(&scenario);
    let mut config = ts::take_shared<MarketConfigV6>(&scenario);
    let admin_cap = ts::take_from_address<MarketAdminCapV6>(&scenario, ADMIN);
    market::update_config_v6_secondary_enabled(&config_v2, &mut config, &admin_cap, true);
    ts::return_shared(config_v2);
    ts::return_shared(config);
    ts::return_to_address(ADMIN, admin_cap);

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let provenance = ts::take_immutable<AnimacraftProvenance>(&scenario);
    let collection_obj = ts::take_shared<SoulCollection>(&scenario);
    let mut kiosk_obj = ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let cap = ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let _listing = market::list_animacraft_soul_fixed_price_with_collection_v6(
        &config,
        &registry,
        &provenance,
        &collection_obj,
        &mut kiosk_obj,
        &cap,
        &mut state,
        SOUL_PRICE,
        scenario.ctx(),
    );
    abort 42
}

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

// ─────────────────────────────────────────────────────────────────────
// Animacraft composable-assets v6 companion invariants
// ─────────────────────────────────────────────────────────────────────

fun new_appearance_state_for_testing(
    scenario: &mut ts::Scenario,
    profile_mode: u8,
    loadout_mutable: bool,
    transfer_safe: bool,
) {
    let mut state = soul::create_state(
        object::id_from_address(@0xa661),
        MINTER,
        0,
        MINTER,
        object::id_from_address(@0xb661),
        scenario.ctx(),
    );
    let commitment = appearance_v6::new_commitment(
        object::id_from_address(@0xc661),
        object::id_from_address(@0xd661),
        MINTER,
        b"00000000000000000000000000000000",
        b"11111111111111111111111111111111",
        b"22222222222222222222222222222222",
        b"55555555555555555555555555555555",
        transfer_safe,
    );
    appearance_v6::new_bind_and_publish(
        &mut state,
        profile_mode,
        loadout_mutable,
        commitment,
        scenario.ctx(),
    );
    soul::set_content_id(
        &mut state,
        object::id_from_address(@0xe661),
    );
    soul::share_state(state);
}

fun updated_appearance_commitment(
    authorizer: address,
    transfer_safe: bool,
): appearance_v6::AppearanceCommitmentV6 {
    appearance_v6::new_commitment(
        object::id_from_address(@0xc661),
        object::id_from_address(@0xd661),
        authorizer,
        b"33333333333333333333333333333333",
        b"44444444444444444444444444444444",
        b"22222222222222222222222222222222",
        b"55555555555555555555555555555555",
        transfer_safe,
    )
}

#[test]
fun appearance_v6_freezes_genesis_and_revisions_current_state() {
    let mut scenario = ts::begin(MINTER);
    new_appearance_state_for_testing(
        &mut scenario,
        appearance_v6::profile_mode_composable(),
        true,
        true,
    );

    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let mut appearance = ts::take_shared<SoulAppearanceStateV6>(&scenario);
    let genesis = ts::take_immutable<GenesisAppearanceV6>(&scenario);

    assert!(soul::has_animacraft_appearance_v6(&state), 0);
    assert!(
        soul::animacraft_appearance_v6_id(&state)
            == object::id(&appearance),
        1,
    );
    assert!(appearance_v6::revision(&appearance) == 0, 2);
    assert!(
        appearance_v6::genesis_appearance_id(&appearance)
            == object::id(&genesis),
        3,
    );
    assert!(
        *appearance_v6::current_loadout_hash(&appearance)
            == b"11111111111111111111111111111111",
        4,
    );

    appearance_v6::apply_authorized_loadout(
        &state,
        &mut appearance,
        0,
        updated_appearance_commitment(MINTER, true),
    );
    assert!(appearance_v6::revision(&appearance) == 1, 5);
    assert!(
        *appearance_v6::current_loadout_hash(&appearance)
            == b"44444444444444444444444444444444",
        6,
    );
    assert!(
        *appearance_v6::loadout_hash(&genesis)
            == b"11111111111111111111111111111111",
        7,
    );

    ts::return_shared(state);
    ts::return_shared(appearance);
    ts::return_immutable(genesis);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::appearance_v6::EFixedAppearance)]
fun appearance_v6_fixed_profile_rejects_updates() {
    let mut scenario = ts::begin(MINTER);
    new_appearance_state_for_testing(
        &mut scenario,
        appearance_v6::profile_mode_fixed(),
        false,
        true,
    );
    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let mut appearance = ts::take_shared<SoulAppearanceStateV6>(&scenario);
    appearance_v6::apply_authorized_loadout(
        &state,
        &mut appearance,
        0,
        updated_appearance_commitment(MINTER, true),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::appearance_v6::ESoulListed)]
fun appearance_v6_listed_soul_rejects_updates() {
    let mut scenario = ts::begin(MINTER);
    new_appearance_state_for_testing(
        &mut scenario,
        appearance_v6::profile_mode_composable(),
        true,
        true,
    );
    scenario.next_tx(MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let mut appearance = ts::take_shared<SoulAppearanceStateV6>(&scenario);
    soul::set_listed(&mut state, true);
    appearance_v6::apply_authorized_loadout(
        &state,
        &mut appearance,
        0,
        updated_appearance_commitment(MINTER, true),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::appearance_v6::ERevisionMismatch)]
fun appearance_v6_rejects_stale_revision() {
    let mut scenario = ts::begin(MINTER);
    new_appearance_state_for_testing(
        &mut scenario,
        appearance_v6::profile_mode_composable(),
        true,
        true,
    );
    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let mut appearance = ts::take_shared<SoulAppearanceStateV6>(&scenario);
    appearance_v6::apply_authorized_loadout(
        &state,
        &mut appearance,
        1,
        updated_appearance_commitment(MINTER, true),
    );
    abort 42
}

#[test, expected_failure(abort_code = soulidity::appearance_v6::ETransferUnsafe)]
fun appearance_v6_wallet_bound_loadout_cannot_be_listed() {
    let mut scenario = ts::begin(MINTER);
    new_appearance_state_for_testing(
        &mut scenario,
        appearance_v6::profile_mode_composable(),
        true,
        false,
    );
    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    let appearance = ts::take_shared<SoulAppearanceStateV6>(&scenario);
    appearance_v6::assert_transfer_safe_for_listing(&state, &appearance);
    abort 42
}

#[test]
fun appearance_v6_transfer_safe_loadout_syncs_owner_without_revision_change() {
    let mut scenario = ts::begin(MINTER);
    new_appearance_state_for_testing(
        &mut scenario,
        appearance_v6::profile_mode_composable(),
        true,
        true,
    );
    scenario.next_tx(MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let mut appearance = ts::take_shared<SoulAppearanceStateV6>(&scenario);
    appearance_v6::assert_transfer_safe_for_listing(&state, &appearance);
    soul::rotate_owner(
        &mut state,
        BUYER,
        object::id_from_address(@0xb662),
    );
    appearance_v6::sync_ownership_after_transfer(
        &state,
        &mut appearance,
        0,
    );
    assert!(appearance_v6::revision(&appearance) == 0, 0);
    assert!(appearance_v6::current_authorizer(&appearance) == BUYER, 1);
    assert!(
        appearance_v6::ownership_epoch_snapshot(&appearance)
            == soul::ownership_epoch(&state),
        2,
    );
    ts::return_shared(state);
    ts::return_shared(appearance);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = soulidity::market::EAnimacraftV6ListingPathRequired)]
fun appearance_v6_cannot_enter_legacy_listing_path() {
    let mut scenario = ts::begin(MINTER);
    new_appearance_state_for_testing(
        &mut scenario,
        appearance_v6::profile_mode_composable(),
        true,
        true,
    );
    scenario.next_tx(MINTER);
    let state = ts::take_shared<SoulState>(&scenario);
    market::assert_legacy_listing_has_no_v6_appearance_for_testing(&state);
    abort 42
}

#[test]
fun appearance_v6_dedicated_listing_pins_and_syncs_transfer_safe_loadout() {
    let mut scenario = ts::begin(ADMIN);
    init_protocol_for_testing(&mut scenario, ADMIN);
    let minter_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, MINTER);
    let buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, BUYER);
    retire_legacy_market_for_v2_testing(&mut scenario);
    let (_state_id, _output_seal_id) = setup_and_mint_animacraft_v5(
        &mut scenario,
        MINTER,
        minter_kiosk_id,
    );

    scenario.next_tx(MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    appearance_v6::new_bind_and_publish(
        &mut state,
        appearance_v6::profile_mode_composable(),
        true,
        appearance_v6::new_commitment(
            object::id_from_address(@0xc661),
            object::id_from_address(@0xd661),
            MINTER,
            b"00000000000000000000000000000000",
            b"11111111111111111111111111111111",
            b"22222222222222222222222222222222",
            b"55555555555555555555555555555555",
            true,
        ),
        scenario.ctx(),
    );
    ts::return_shared(state);
    enable_secondary_market_v6_for_testing(&mut scenario);

    scenario.next_tx(MINTER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let provenance = ts::take_immutable<AnimacraftProvenance>(&scenario);
    let mut seller_kiosk =
        ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let seller_cap =
        ts::take_from_address<PersonalKioskCap>(&scenario, MINTER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let appearance = ts::take_shared<SoulAppearanceStateV6>(&scenario);
    let listing =
        market::list_animacraft_v6_soul_fixed_price_for_testing(
        &config,
        &registry,
        &provenance,
        &mut seller_kiosk,
        &seller_cap,
        &mut state,
        &appearance,
        SOUL_PRICE,
        scenario.ctx(),
    );
    assert!(
        market::animacraft_v6_listing_appearance_id(&listing)
            == object::id(&appearance),
        0,
    );
    assert!(
        market::animacraft_v6_listing_revision(&listing) == 0,
        1,
    );
    assert!(
        *market::animacraft_v6_listing_loadout_hash(&listing)
            == b"11111111111111111111111111111111",
        2,
    );
    market::finalize_animacraft_v6_soul_listing(listing);
    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_immutable(provenance);
    ts::return_shared(seller_kiosk);
    ts::return_to_address(MINTER, seller_cap);
    ts::return_shared(state);
    ts::return_shared(appearance);

    mint_usdc_to(BUYER, SOUL_PRICE, &mut scenario);
    scenario.next_tx(BUYER);
    let config = ts::take_shared<MarketConfigV6>(&scenario);
    let registry = ts::take_shared<KioskRegistry>(&scenario);
    let soul_policy = ts::take_shared<TransferPolicy<Soul>>(&scenario);
    let provenance = ts::take_immutable<AnimacraftProvenance>(&scenario);
    let mut seller_kiosk =
        ts::take_shared_by_id<Kiosk>(&scenario, minter_kiosk_id);
    let mut buyer_kiosk =
        ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
    let buyer_cap =
        ts::take_from_address<PersonalKioskCap>(&scenario, BUYER);
    let mut state = ts::take_shared<SoulState>(&scenario);
    let mut appearance = ts::take_shared<SoulAppearanceStateV6>(&scenario);
    let mut listing = ts::take_shared<AnimacraftV6SoulListing>(&scenario);
    let payment =
        ts::take_from_address<coin::Coin<USDC>>(&scenario, BUYER);
    market::buy_animacraft_v6_soul_fixed_price_for_testing(
        &config,
        &registry,
        &soul_policy,
        &provenance,
        &mut seller_kiosk,
        &mut buyer_kiosk,
        &buyer_cap,
        &mut state,
        &mut appearance,
        &mut listing,
        payment,
        scenario.ctx(),
    );
    assert!(soul::current_owner(&state) == BUYER, 3);
    assert!(soul::ownership_epoch(&state) == 1, 4);
    assert!(appearance_v6::revision(&appearance) == 0, 5);
    assert!(appearance_v6::current_authorizer(&appearance) == BUYER, 6);
    assert!(appearance_v6::ownership_epoch_snapshot(&appearance) == 1, 7);
    assert!(
        !market::animacraft_v6_listing_is_active(&listing),
        8,
    );

    ts::return_shared(config);
    ts::return_shared(registry);
    ts::return_shared(soul_policy);
    ts::return_immutable(provenance);
    ts::return_shared(seller_kiosk);
    ts::return_shared(buyer_kiosk);
    ts::return_to_address(BUYER, buyer_cap);
    ts::return_shared(state);
    ts::return_shared(appearance);
    ts::return_shared(listing);
    ts::end(scenario);
}
