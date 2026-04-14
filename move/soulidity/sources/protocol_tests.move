#[test_only]
module soulidity::protocol_tests;

use std::string;
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use soulidity::collection::{Self as collection, SoulCollection, SoulCollectionRight};
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::market::{Self as market, CollectionListing, KioskRegistry, MarketConfig, MarketUpgradeState, SoulListing};
use soulidity::memory::{Self as memory, SoulMemory};
use soulidity::skills::{Self as skills, SoulSkills};
use soulidity::assets::{Self as assets, SoulAssets};
use soulidity::content_access::{Self as content_access, ContentAccessList};
use soulidity::seal_policy;
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::clock::{Self as clock, Clock};
use sui::coin::{Self as coin, TreasuryCap};
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::package::{Self as package};
use sui::test_scenario::{Self as ts};
use sui::transfer_policy::TransferPolicy;
use usdc::usdc::{Self as test_usdc, USDC};
use walrus::{blob, encoding, system, test_utils};

const BLOB_ROOT_HASH_A: u256 = 0xABC;
const BLOB_ROOT_HASH_B: u256 = 0xABD;
const BLOB_SIZE: u64 = 5_000_000;
const BLOB_ENCODING: u8 = 1;
const BLOB_EPOCHS_AHEAD: u32 = 3;
const PAYMENT_FROST: u64 = 1_000_000_000;

const SOUL_PRICE: u64 = 1_000_000;
const SOUL_RESALE_PRICE: u64 = 2_000_000;
const COLLECTION_PRICE: u64 = 300_000;
const CREATOR_ROYALTY_BPS: u16 = 1_000;
const COLLECTION_ROYALTY_BPS: u16 = 500;
const BLOB_ROOT_HASH_C: u256 = 0xABE;
const BLOB_ROOT_HASH_D: u256 = 0xABF;
const BLOB_ROOT_HASH_E: u256 = 0xAC0;

public struct SourceNft has key, store {
    id: UID,
    serial: u64,
}

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
    let registered_blob = walrus_system.register_blob(
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
    registered_blob
}

fun mint_test_blobs_to_recipients(
    first_recipient: address,
    first_root_hash: u256,
    second_recipient: address,
    second_root_hash: u256,
    ctx: &mut TxContext,
) {
    let mut walrus_system = system::new_for_testing(ctx);
    let first_blob = register_test_blob_with_root(&mut walrus_system, first_root_hash, ctx);
    let second_blob = register_test_blob_with_root(&mut walrus_system, second_root_hash, ctx);
    std::unit_test::destroy(walrus_system);
    transfer::public_transfer(first_blob, first_recipient);
    transfer::public_transfer(second_blob, second_recipient);
}

fun mint_test_blobs_to_three_recipients(
    first_recipient: address,
    first_root_hash: u256,
    second_recipient: address,
    second_root_hash: u256,
    third_recipient: address,
    third_root_hash: u256,
    ctx: &mut TxContext,
) {
    let mut walrus_system = system::new_for_testing(ctx);
    let first_blob = register_test_blob_with_root(&mut walrus_system, first_root_hash, ctx);
    let second_blob = register_test_blob_with_root(&mut walrus_system, second_root_hash, ctx);
    let third_blob = register_test_blob_with_root(&mut walrus_system, third_root_hash, ctx);
    std::unit_test::destroy(walrus_system);
    transfer::public_transfer(first_blob, first_recipient);
    transfer::public_transfer(second_blob, second_recipient);
    transfer::public_transfer(third_blob, third_recipient);
}

fun mint_test_blobs_to_four_recipients(
    first_recipient: address,
    first_root_hash: u256,
    second_recipient: address,
    second_root_hash: u256,
    third_recipient: address,
    third_root_hash: u256,
    fourth_recipient: address,
    fourth_root_hash: u256,
    ctx: &mut TxContext,
) {
    let mut walrus_system = system::new_for_testing(ctx);
    let first_blob = register_test_blob_with_root(&mut walrus_system, first_root_hash, ctx);
    let second_blob = register_test_blob_with_root(&mut walrus_system, second_root_hash, ctx);
    let third_blob = register_test_blob_with_root(&mut walrus_system, third_root_hash, ctx);
    let fourth_blob = register_test_blob_with_root(&mut walrus_system, fourth_root_hash, ctx);
    std::unit_test::destroy(walrus_system);
    transfer::public_transfer(first_blob, first_recipient);
    transfer::public_transfer(second_blob, second_recipient);
    transfer::public_transfer(third_blob, third_recipient);
    transfer::public_transfer(fourth_blob, fourth_recipient);
}

fun mint_test_blobs_to_five_recipients(
    first_recipient: address,
    first_root_hash: u256,
    second_recipient: address,
    second_root_hash: u256,
    third_recipient: address,
    third_root_hash: u256,
    fourth_recipient: address,
    fourth_root_hash: u256,
    fifth_recipient: address,
    fifth_root_hash: u256,
    ctx: &mut TxContext,
) {
    let mut walrus_system = system::new_for_testing(ctx);
    let first_blob = register_test_blob_with_root(&mut walrus_system, first_root_hash, ctx);
    let second_blob = register_test_blob_with_root(&mut walrus_system, second_root_hash, ctx);
    let third_blob = register_test_blob_with_root(&mut walrus_system, third_root_hash, ctx);
    let fourth_blob = register_test_blob_with_root(&mut walrus_system, fourth_root_hash, ctx);
    let fifth_blob = register_test_blob_with_root(&mut walrus_system, fifth_root_hash, ctx);
    std::unit_test::destroy(walrus_system);
    transfer::public_transfer(first_blob, first_recipient);
    transfer::public_transfer(second_blob, second_recipient);
    transfer::public_transfer(third_blob, third_recipient);
    transfer::public_transfer(fourth_blob, fourth_recipient);
    transfer::public_transfer(fifth_blob, fifth_recipient);
}

fun mint_test_blob_to_recipient(recipient: address, root_hash: u256, ctx: &mut TxContext) {
    let mut walrus_system = system::new_for_testing(ctx);
    let test_blob = register_test_blob_with_root(&mut walrus_system, root_hash, ctx);
    std::unit_test::destroy(walrus_system);
    transfer::public_transfer(test_blob, recipient);
}

fun soul_document_id_with_version(soul_id: ID, version: u8): vector<u8> {
    let mut id = b"soul-seal:";
    let soul_id_bytes = soul_id.to_bytes();
    let mut soul_id_index: u64 = 0;
    id.push_back(version);
    while (soul_id_index < soul_id_bytes.length()) {
        id.push_back(soul_id_bytes[soul_id_index]);
        soul_id_index = soul_id_index + 1;
    };
    let mut i: u64 = 0;
    while (i < 16) {
        id.push_back(0x7A);
        i = i + 1;
    };
    id
}

fun soul_document_id(soul_id: ID): vector<u8> {
    soul_document_id_with_version(soul_id, 0x01)
}

fun append_u64_be_bytes(id: &mut vector<u8>, value: u64) {
    let mut shift = 56u8;
    let mut index = 0u64;
    while (index < 8u64) {
        id.push_back(((value >> shift) & 0xFF) as u8);
        shift = if (shift >= 8u8) shift - 8u8 else 0u8;
        index = index + 1u64;
    };
}

fun memory_document_id(memory_id: ID, timestamp_key: u64): vector<u8> {
    let mut id = b"soul-memory:";
    let memory_id_bytes = memory_id.to_bytes();
    let mut memory_id_index = 0;
    id.push_back(0x01);
    while (memory_id_index < memory_id_bytes.length()) {
        id.push_back(memory_id_bytes[memory_id_index]);
        memory_id_index = memory_id_index + 1;
    };
    append_u64_be_bytes(&mut id, timestamp_key);
    let mut i = 0u64;
    while (i < 16u64) {
        id.push_back(0x4D);
        i = i + 1u64;
    };
    id
}

fun skill_document_id(skills_id: ID, skill_name: std::string::String, version_index: u64): vector<u8> {
    let mut id = b"soul-skill:";
    let skills_id_bytes = skills_id.to_bytes();
    let skill_name_bytes = string::as_bytes(&skill_name);
    let mut skills_id_index = 0;
    let mut skill_name_index = 0;
    id.push_back(0x01);
    while (skills_id_index < skills_id_bytes.length()) {
        id.push_back(skills_id_bytes[skills_id_index]);
        skills_id_index = skills_id_index + 1;
    };
    while (skill_name_index < skill_name_bytes.length()) {
        id.push_back(skill_name_bytes[skill_name_index]);
        skill_name_index = skill_name_index + 1;
    };
    id.push_back(0x00);
    append_u64_be_bytes(&mut id, version_index);
    let mut i = 0u64;
    while (i < 16u64) {
        id.push_back(0x5A);
        i = i + 1u64;
    };
    id
}

fun default_skill_name(): std::string::String {
    string::utf8(b"default")
}

fun default_asset_name(): std::string::String {
    string::utf8(b"persona-sprite")
}

fun asset_document_id(assets_id: ID, asset_name: std::string::String, version_index: u64): vector<u8> {
    let mut id = b"soul-asset:";
    let assets_id_bytes = assets_id.to_bytes();
    let asset_name_bytes = string::as_bytes(&asset_name);
    let mut assets_id_index = 0;
    let mut asset_name_index = 0;
    id.push_back(0x01);
    while (assets_id_index < assets_id_bytes.length()) {
        id.push_back(assets_id_bytes[assets_id_index]);
        assets_id_index = assets_id_index + 1;
    };
    while (asset_name_index < asset_name_bytes.length()) {
        id.push_back(asset_name_bytes[asset_name_index]);
        asset_name_index = asset_name_index + 1;
    };
    id.push_back(0x00);
    append_u64_be_bytes(&mut id, version_index);
    let mut i = 0u64;
    while (i < 16u64) {
        id.push_back(0x6A);
        i = i + 1u64;
    };
    id
}

fun init_protocol_for_testing(scenario: &mut ts::Scenario, admin: address) {
    ts::next_tx(scenario, admin);
    {
        soul::init_for_testing(admin, ts::ctx(scenario));
        collection::init_for_testing(admin, ts::ctx(scenario));
        market::init_for_testing(admin, ts::ctx(scenario));
        test_usdc::init_for_testing(admin, ts::ctx(scenario));
        let clock_obj = clock::create_for_testing(ts::ctx(scenario));
        clock::share_for_testing(clock_obj);
    };
}

fun init_personal_kiosk_for_sender(scenario: &mut ts::Scenario, sender: address): ID {
    let kiosk_id: ID;
    ts::next_tx(scenario, sender);
    {
        let config: MarketConfig = ts::take_shared(scenario);
        let mut registry: KioskRegistry = ts::take_shared(scenario);
        kiosk_id = market::init_personal_kiosk(&config, &mut registry, ts::ctx(scenario));
        ts::return_shared(config);
        ts::return_shared(registry);
    };
    kiosk_id
}

fun mint_usdc_to_recipient(
    scenario: &mut ts::Scenario,
    admin: address,
    recipient: address,
    amount: u64,
) {
    ts::next_tx(scenario, admin);
    {
        let mut treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(scenario);
        test_usdc::mint(&mut treasury_cap, amount, recipient, ts::ctx(scenario));
        transfer::public_transfer(treasury_cap, admin);
    };
}

fun mint_native_in_personal_kiosk_no_skills(
    config: &MarketConfig,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    metadata_ref: Option<std::string::String>,
    protected_blob: blob::Blob,
    founding_memory_blob: Option<blob::Blob>,
    creator_royalty_bps: u16,
    scenario: &mut ts::Scenario,
): ID {
    let clock_obj: Clock = ts::take_shared(scenario);
    let soul_id = market::mint_native_in_personal_kiosk(
        config,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        metadata_ref,
        protected_blob,
        founding_memory_blob,
        option::none(),
        string::utf8(b"default"),
        false,
        option::none(),
        string::utf8(b"default"),
        false,
        0,
        0,
        0,
        creator_royalty_bps,
        &clock_obj,
        ts::ctx(scenario),
    );
    ts::return_shared(clock_obj);
    soul_id
}

fun mint_imported_in_personal_kiosk_no_skills(
    config: &MarketConfig,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    metadata_ref: Option<std::string::String>,
    protected_blob: blob::Blob,
    founding_memory_blob: Option<blob::Blob>,
    origin_ref: std::string::String,
    creator_royalty_bps: u16,
    scenario: &mut ts::Scenario,
): ID {
    let clock_obj: Clock = ts::take_shared(scenario);
    let soul_id = market::mint_imported_in_personal_kiosk(
        config,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        metadata_ref,
        protected_blob,
        founding_memory_blob,
        option::none(),
        string::utf8(b"default"),
        false,
        option::none(),
        string::utf8(b"default"),
        false,
        0,
        0,
        0,
        origin_ref,
        creator_royalty_bps,
        &clock_obj,
        ts::ctx(scenario),
    );
    ts::return_shared(clock_obj);
    soul_id
}

fun mint_joined_in_personal_kiosk_no_skills<T: key + store>(
    config: &MarketConfig,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    source_object_id: ID,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    metadata_ref: Option<std::string::String>,
    protected_blob: blob::Blob,
    founding_memory_blob: Option<blob::Blob>,
    origin_ref: std::string::String,
    creator_royalty_bps: u16,
    scenario: &mut ts::Scenario,
): ID {
    let clock_obj: Clock = ts::take_shared(scenario);
    let soul_id = market::mint_joined_in_personal_kiosk<T>(
        config,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        source_object_id,
        name,
        description,
        image_url,
        metadata_ref,
        protected_blob,
        founding_memory_blob,
        option::none(),
        string::utf8(b"default"),
        false,
        option::none(),
        string::utf8(b"default"),
        false,
        0,
        0,
        0,
        origin_ref,
        creator_royalty_bps,
        &clock_obj,
        ts::ctx(scenario),
    );
    ts::return_shared(clock_obj);
    soul_id
}

fun issue_default_grant(
    state: &mut SoulState,
    grantee: address,
    expires_at_ms: Option<u64>,
    scenario: &mut ts::Scenario,
): SoulGrant {
    let clock_obj: Clock = ts::take_shared(scenario);
    let soul_grant = grant::issue(
        state,
        grantee,
        grant::scope_seal() | grant::scope_memory(),
        expires_at_ms,
        &clock_obj,
        ts::ctx(scenario),
    );
    ts::return_shared(clock_obj);
    soul_grant
}

fun revoke_grant_for_grantee(
    state: &mut SoulState,
    grantee: address,
    scenario: &mut ts::Scenario,
) {
    let clock_obj: Clock = ts::take_shared(scenario);
    grant::revoke(state, grantee, &clock_obj, ts::ctx(scenario));
    ts::return_shared(clock_obj);
}

fun has_active_grant_id(state: &SoulState, grant_id: ID): bool {
    let mut i = 0;
    while (i < soul::active_grant_count(state)) {
        if (soul::active_grant_slot_grant_id(soul::active_grant_slot_at(state, i)) == grant_id) {
            return true
        };
        i = i + 1;
    };
    false
}

fun has_active_grantee(state: &SoulState, grantee: address): bool {
    let mut i = 0;
    while (i < soul::active_grant_count(state)) {
        if (soul::active_grant_slot_grantee(soul::active_grant_slot_at(state, i)) == grantee) {
            return true
        };
        i = i + 1;
    };
    false
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantOwnerEpochMismatch)]
fun stale_grant_cannot_be_used_after_soul_sale() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let buyer_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        creator_kiosk_id = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));
        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            agent,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Genesis Soul"),
            string::utf8(b"Soul with one active grant"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::none(), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let mut memory_book: SoulMemory = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = memory::append_as_granted_agent(
            &mut memory_book,
            &state,
            &soul_grant,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        assert!(memory::entry_count(&memory_book) == 1, 0);

        ts::return_shared(state);
        ts::return_shared(memory_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        buyer_kiosk_id = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));
        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(&scenario);
        test_usdc::mint(
            &mut treasury_cap,
            SOUL_PRICE + ((SOUL_PRICE as u128 * (CREATOR_ROYALTY_BPS as u128) / 10_000) as u64),
            buyer,
            ts::ctx(&mut scenario),
        );
        transfer::public_transfer(treasury_cap, admin);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        let mut listing: SoulListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_soul_fixed_price(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut state,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        assert!(soul::current_owner(&state) == buyer, 0);
        assert!(soul::current_kiosk_id(&state) == buyer_kiosk_id, 1);
        assert!(soul::ownership_epoch(&state) == 1, 2);
        assert!(soul::active_grant_count(&state) == 0, 3);
        assert!(!has_active_grantee(&state, agent), 4);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(state);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(buyer_kiosk);
        personal_kiosk::transfer_to_sender(buyer_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let document_id = soul_document_id(soul_id);
        seal_policy::seal_approve_granted_agent_for_testing(
            document_id,
            &state,
            soul_id,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 1
    }
}

#[test]
fun collection_holder_receives_extra_royalty_on_soul_resale() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let holder = @0xBEEF;
    let buyer = @0xF00D;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let holder_kiosk_id: ID;
    let buyer_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        creator_kiosk_id = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));
        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Royalty Soul"),
            string::utf8(b"Soul backed by one collection"),
            string::utf8(b"https://example.com/royalty.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let _collection_id = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Founders Circle"),
            string::utf8(b"Extra royalty stream"),
            string::utf8(b"https://example.com/collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&collection_obj, &mut state, ts::ctx(&mut scenario));
        ts::return_shared(collection_obj);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, holder);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        holder_kiosk_id = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));
        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let right_id = collection::right_id(&collection_obj);
        let _listing_id = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            right_id,
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(&scenario);
        test_usdc::mint(&mut treasury_cap, COLLECTION_PRICE, holder, ts::ctx(&mut scenario));
        transfer::public_transfer(treasury_cap, admin);
    };

    ts::next_tx(&mut scenario, holder);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let mut collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut listing: CollectionListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut holder_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, holder_kiosk_id);
        let holder_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_collection_right_fixed_price(
            &config,
            &registry,
            &collection_policy,
            &mut collection_obj,
            &mut creator_kiosk,
            &mut holder_kiosk,
            &holder_cap,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        assert!(collection::current_holder(&collection_obj) == holder, 0);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(collection_obj);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(holder_kiosk);
        personal_kiosk::transfer_to_sender(holder_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        buyer_kiosk_id = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));
        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let _listing_id = market::list_soul_fixed_price_with_collection(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut treasury_cap: TreasuryCap<USDC> = ts::take_from_sender(&scenario);
        let creator_royalty = ((SOUL_PRICE as u128 * (CREATOR_ROYALTY_BPS as u128)) / 10_000) as u64;
        let collection_royalty = ((SOUL_PRICE as u128 * (COLLECTION_ROYALTY_BPS as u128)) / 10_000) as u64;
        test_usdc::mint(
            &mut treasury_cap,
            SOUL_PRICE + creator_royalty + collection_royalty,
            buyer,
            ts::ctx(&mut scenario),
        );
        transfer::public_transfer(treasury_cap, admin);
    };

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let mut collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        let mut listing: SoulListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_soul_fixed_price_with_collection(
            &config,
            &registry,
            &soul_policy,
            &mut collection_obj,
            &mut creator_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut state,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(collection_obj);
        ts::return_shared(state);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(buyer_kiosk);
        personal_kiosk::transfer_to_sender(buyer_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, holder);
    {
        let royalty_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(coin::value(&royalty_coin) == 50_000, 1);
        transfer::public_transfer(royalty_coin, holder);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::soul::ENotSoulOwner)]
fun creator_cannot_bind_collection_after_soul_sale() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let buyer_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, buyer);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Sold Soul"),
            string::utf8(b"Cannot be rebound after sale"),
            string::utf8(b"https://example.com/sold-soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(
        &mut scenario,
        admin,
        buyer,
        SOUL_PRICE + (((SOUL_PRICE as u128 * (CREATOR_ROYALTY_BPS as u128)) / 10_000) as u64),
    );

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        let mut listing: SoulListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_soul_fixed_price(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut state,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(state);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(buyer_kiosk);
        personal_kiosk::transfer_to_sender(buyer_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let creator_payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        transfer::public_transfer(creator_payment, creator);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Late Collection"),
            string::utf8(b"Post-sale bind should fail"),
            string::utf8(b"https://example.com/late-collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&collection_obj, &mut state, ts::ctx(&mut scenario));

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::ECombinedFeesTooHigh)]
fun bound_soul_listing_rejects_unbuyable_combined_fees() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;
    let high_creator_royalty_bps = 6_000;
    let high_collection_royalty_bps = 5_000;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"High Fee Soul"),
            string::utf8(b"Bound listing must fail before creating dead listing"),
            string::utf8(b"https://example.com/high-fee-soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            high_creator_royalty_bps,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"High Fee Collection"),
            string::utf8(b"Combined fees should be rejected at listing time"),
            string::utf8(b"https://example.com/high-fee-collection.png"),
            high_collection_royalty_bps,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&collection_obj, &mut state, ts::ctx(&mut scenario));
        ts::return_shared(collection_obj);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_soul_fixed_price_with_collection(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
fun import_and_personal_join_set_expected_provenance() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let source_id: ID;
    let imported_id: ID;

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        creator_kiosk_id = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));
        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let source = SourceNft {
            id: object::new(ts::ctx(&mut scenario)),
            serial: 7,
        };
        source_id = object::id(&source);
        let imported_blob: blob::Blob = ts::take_from_sender(&scenario);

        kiosk::place(&mut creator_kiosk, personal_kiosk::borrow(&personal_cap), source);

        imported_id = mint_imported_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Imported Soul"),
            string::utf8(b"Imported from elsewhere"),
            string::utf8(b"https://example.com/imported.png"),
            option::none(),
            imported_blob,
            option::none(),
            string::utf8(b"import://alpha"),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let imported_grant = issue_default_grant(&mut state, admin, option::none(), &mut scenario);
        assert!(grant::soul_id(&imported_grant) == imported_id, 4);
        assert!(grant::issued_by(&imported_grant) == creator, 5);
        transfer::public_transfer(imported_grant, admin);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let joined_blob: blob::Blob = ts::take_from_sender(&scenario);

        let joined_id = mint_joined_in_personal_kiosk_no_skills<SourceNft>(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            source_id,
            string::utf8(b"Joined Soul"),
            string::utf8(b"Soul layer on top of existing NFT"),
            string::utf8(b"https://example.com/joined.png"),
            option::none(),
            joined_blob,
            option::none(),
            string::utf8(b"join://source-7"),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        let imported_ref = kiosk::borrow<Soul>(&creator_kiosk, personal_kiosk::borrow(&personal_cap), imported_id);
        let joined_ref = kiosk::borrow<Soul>(&creator_kiosk, personal_kiosk::borrow(&personal_cap), joined_id);

        assert!(soul::provenance_kind(imported_ref) == soul::provenance_imported_for_testing(), 0);
        assert!(soul::provenance_kind(joined_ref) == soul::provenance_personal_join_for_testing(), 1);
        assert!(soul::origin_ref(imported_ref).contains(&string::utf8(b"import://alpha")), 2);
        assert!(soul::origin_ref(joined_ref).contains(&string::utf8(b"join://source-7")), 3);
        assert!(kiosk::has_item_with_type<SourceNft>(&creator_kiosk, source_id), 6);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::end(scenario);
}

#[test]
fun native_soul_mint_creates_state_memory_and_founding_entry() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Founding Soul"),
            string::utf8(b"Native soul with founding memory"),
            string::utf8(b"https://example.com/founding.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        let soul_ref = kiosk::borrow<Soul>(&creator_kiosk, personal_kiosk::borrow(&personal_cap), soul_id);
        assert!(soul::provenance_kind(soul_ref) == soul::provenance_native_for_testing(), 0);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let memory_book: SoulMemory = ts::take_shared(&scenario);

        assert!(soul::soul_id(&state) == soul_id, 1);
        assert!(soul::current_owner(&state) == creator, 2);
        assert!(soul::current_kiosk_id(&state) == creator_kiosk_id, 3);
        let memory_id = object::id(&memory_book);

        assert!(memory::soul_id(&memory_book) == soul_id, 4);
        assert!(soul::memory_id(&state).contains(&memory_id), 5);
        assert!(memory::entry_count(&memory_book) == 1, 6);
        assert!(memory::contains_entry(&memory_book, 0), 7);

        ts::return_shared(state);
        ts::return_shared(memory_book);
    };

    ts::end(scenario);
}

#[test]
fun collection_creation_and_binding_track_current_holder_and_state() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let collection_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Collection Soul"),
            string::utf8(b"Collection binding"),
            string::utf8(b"https://example.com/collection-soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        collection_id = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Genesis Collection"),
            string::utf8(b"Tradeable collection"),
            string::utf8(b"https://example.com/collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);

        collection::add_soul(&collection_obj, &mut state, ts::ctx(&mut scenario));

        assert!(collection::current_holder(&collection_obj) == creator, 7);
        assert!(collection::tradeable(&collection_obj), 8);
        assert!(soul::soul_id(&state) == soul_id, 9);
        assert!(soul::collection_id(&state).contains(&collection_id), 10);

        ts::return_shared(collection_obj);
        ts::return_shared(state);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::collection::ECollectionLocked)]
fun non_tradeable_collection_cannot_be_listed() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Locked Collection"),
            string::utf8(b"Not tradeable"),
            string::utf8(b"https://example.com/locked.png"),
            COLLECTION_ROYALTY_BPS,
            false,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let right_id = collection::right_id(&collection_obj);

        market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            right_id,
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
fun grant_issue_sets_active_grantee_and_metadata() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Grant Soul"),
            string::utf8(b"Grant issue"),
            string::utf8(b"https://example.com/grant.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::none(), &mut scenario);
        let grant_id = object::id(&soul_grant);

        assert!(grant::soul_id(&soul_grant) == soul_id, 11);
        assert!(grant::grantee(&soul_grant) == agent, 12);
        assert!(grant::issued_by(&soul_grant) == creator, 13);
        assert!(grant::expires_at_ms(&soul_grant).is_none(), 14);
        assert!(soul::active_grant_count(&state) == 1, 15);
        assert!(has_active_grant_id(&state, grant_id), 16);
        assert!(has_active_grantee(&state, agent), 17);

        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantNotActive)]
fun reissued_grant_for_same_grantee_invalidates_old_grant() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let first_agent = @0xA63E;
    let second_agent = @0xBEEF;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            first_agent,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Reissue Soul"),
            string::utf8(b"Grant reissue"),
            string::utf8(b"https://example.com/reissue.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let first_grant = issue_default_grant(&mut state, first_agent, option::none(), &mut scenario);
        transfer::public_transfer(first_grant, first_agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let second_grant = issue_default_grant(&mut state, first_agent, option::none(), &mut scenario);
        assert!(soul::active_grant_count(&state) == 1, 17);
        assert!(has_active_grantee(&state, first_agent), 18);
        transfer::public_transfer(second_grant, second_agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, first_agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let mut memory_book: SoulMemory = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let stale_grant: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = memory::append_as_granted_agent(
            &mut memory_book,
            &state,
            &stale_grant,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantNotActive)]
fun revoked_grant_cannot_be_used_for_seal() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Revoked Soul"),
            string::utf8(b"Grant revoke"),
            string::utf8(b"https://example.com/revoke.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::none(), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        revoke_grant_for_grantee(&mut state, agent, &mut scenario);
        assert!(soul::active_grant_count(&state) == 0, 18);
        assert!(!has_active_grantee(&state, agent), 19);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);

        seal_policy::seal_approve_granted_agent_for_testing(
            soul_document_id(soul_id),
            &state,
            soul_id,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantExpired)]
fun expired_grant_cannot_append_memory() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            agent,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Expiry Soul"),
            string::utf8(b"Grant expiry"),
            string::utf8(b"https://example.com/expiry.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::some(100), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut clock_obj: Clock = ts::take_shared(&scenario);
        clock::set_for_testing(&mut clock_obj, 101);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let mut memory_book: SoulMemory = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = memory::append_as_granted_agent(
            &mut memory_book,
            &state,
            &soul_grant,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
fun listing_keeps_grant_active_before_and_after_cancel() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Listed Soul"),
            string::utf8(b"Grant survives listing"),
            string::utf8(b"https://example.com/listed.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::none(), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        assert!(soul::current_owner(&state) == creator, 20);
        assert!(soul::ownership_epoch(&state) == 0, 21);
        assert!(has_active_grantee(&state, agent), 22);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);

        seal_policy::seal_approve_granted_agent_for_testing(
            soul_document_id(soul_id),
            &state,
            soul_id,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut listing: SoulListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        market::cancel_soul_listing(&mut creator_kiosk, &personal_cap, &mut listing);

        assert!(soul::current_owner(&state) == creator, 23);
        assert!(soul::ownership_epoch(&state) == 0, 24);
        assert!(has_active_grantee(&state, agent), 25);

        ts::return_shared(state);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);

        seal_policy::seal_approve_granted_agent_for_testing(
            soul_document_id(soul_id),
            &state,
            soul_id,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    ts::end(scenario);
}

#[test]
fun memory_append_by_owner_and_granted_agent_is_monotonic() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            agent,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Memory Soul"),
            string::utf8(b"Append only"),
            string::utf8(b"https://example.com/memory.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::none(), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let mut memory_book: SoulMemory = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let owner_blob: blob::Blob = ts::take_from_sender(&scenario);

        let owner_timestamp = clock::timestamp_ms(&clock_obj);
        let owner_blob_id = blob::object_id(&owner_blob);

        let _ = memory::append_as_owner(
            &mut memory_book,
            &state,
            owner_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(memory::entry_count(&memory_book) == 1, 26);
        assert!(memory::contains_entry(&memory_book, owner_timestamp), 27);
        assert!(memory::blob_object_id_for(&memory_book, owner_timestamp) == owner_blob_id, 28);

        ts::return_shared(state);
        ts::return_shared(memory_book);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut clock_obj: Clock = ts::take_shared(&scenario);
        clock::set_for_testing(&mut clock_obj, 1);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let mut memory_book: SoulMemory = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        let agent_timestamp = clock::timestamp_ms(&clock_obj);
        let agent_blob_id = blob::object_id(&agent_blob);

        let _ = memory::append_as_granted_agent(
            &mut memory_book,
            &state,
            &soul_grant,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(memory::entry_count(&memory_book) == 2, 29);
        assert!(memory::contains_entry(&memory_book, agent_timestamp), 30);
        assert!(memory::blob_object_id_for(&memory_book, agent_timestamp) == agent_blob_id, 31);

        ts::return_shared(state);
        ts::return_shared(memory_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::soul::ENotSoulOwner)]
fun unauthorized_memory_append_as_owner_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let outsider = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            outsider,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Protected Soul"),
            string::utf8(b"Owner only"),
            string::utf8(b"https://example.com/protected.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, outsider);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let mut memory_book: SoulMemory = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let outsider_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = memory::append_as_owner(
            &mut memory_book,
            &state,
            outsider_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::seal_policy::EIdPrefixMismatch)]
fun owner_seal_approval_rejects_invalid_document_id() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Seal Soul"),
            string::utf8(b"Document id check"),
            string::utf8(b"https://example.com/seal.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);

        seal_policy::seal_approve_owner_for_testing(
            soul_document_id(soul_id),
            &state,
            soul_id,
            ts::ctx(&mut scenario),
        );
        seal_policy::seal_approve_owner_for_testing(
            soul_document_id_with_version(soul_id, 0x02),
            &state,
            soul_id,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
fun primary_sale_quote_and_purchase_include_creator_royalty_in_total() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xF00D;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let buyer_kiosk_id: ID;
    let soul_id: ID;
    let creator_royalty = ((SOUL_PRICE as u128 * (CREATOR_ROYALTY_BPS as u128)) / 10_000) as u64;
    let total = SOUL_PRICE + creator_royalty;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, buyer);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Primary Sale Soul"),
            string::utf8(b"Primary sale includes creator surcharge"),
            string::utf8(b"https://example.com/primary-sale.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let (platform_fee, quoted_price, quoted_creator_royalty, quoted_collection_royalty, quoted_total) =
            market::quote_soul_purchase(
                &config,
                SOUL_PRICE,
                soul::creator_royalty_bps(&state),
                0,
            );

        assert!(platform_fee == 0, 30);
        assert!(quoted_price == SOUL_PRICE, 31);
        assert!(quoted_creator_royalty == creator_royalty, 32);
        assert!(quoted_collection_royalty == 0, 33);
        assert!(quoted_total == total, 34);

        let _ = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(&mut scenario, admin, buyer, total);

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        let mut listing: SoulListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_soul_fixed_price(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut state,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        assert!(soul::current_owner(&state) == buyer, 35);
        assert!(soul::current_kiosk_id(&state) == buyer_kiosk_id, 36);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(state);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(buyer_kiosk);
        personal_kiosk::transfer_to_sender(buyer_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let creator_payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(coin::value(&creator_payment) == total, 37);
        transfer::public_transfer(creator_payment, creator);
    };

    ts::end(scenario);
}

#[test]
fun secondary_sale_pays_creator_royalty() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let seller = @0xBEEF;
    let buyer = @0xF00D;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let seller_kiosk_id: ID;
    let buyer_kiosk_id: ID;
    let soul_id: ID;
    let creator_royalty = ((SOUL_RESALE_PRICE as u128 * (CREATOR_ROYALTY_BPS as u128)) / 10_000) as u64;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    seller_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, seller);
    buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, buyer);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Royalty Flow Soul"),
            string::utf8(b"Secondary sale creator royalty"),
            string::utf8(b"https://example.com/secondary.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(
        &mut scenario,
        admin,
        seller,
        SOUL_PRICE + (((SOUL_PRICE as u128 * (CREATOR_ROYALTY_BPS as u128)) / 10_000) as u64),
    );

    ts::next_tx(&mut scenario, seller);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        let mut listing: SoulListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, seller_kiosk_id);
        let seller_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_soul_fixed_price(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &mut seller_kiosk,
            &seller_cap,
            &mut state,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        assert!(soul::current_owner(&state) == seller, 30);
        assert!(soul::current_kiosk_id(&state) == seller_kiosk_id, 31);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(state);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(seller_kiosk);
        personal_kiosk::transfer_to_sender(seller_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let first_sale_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        transfer::public_transfer(first_sale_coin, admin);
    };

    ts::next_tx(&mut scenario, seller);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, seller_kiosk_id);

        let _ = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut seller_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_RESALE_PRICE,
            ts::ctx(&mut scenario),
        );

        assert!(soul::current_owner(&state) == seller, 32);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(seller_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(
        &mut scenario,
        admin,
        buyer,
        SOUL_RESALE_PRICE + creator_royalty,
    );

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        let mut listing: SoulListing = ts::take_shared(&scenario);
        let mut seller_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, seller_kiosk_id);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_soul_fixed_price(
            &config,
            &registry,
            &soul_policy,
            &mut seller_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut state,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        assert!(soul::current_owner(&state) == buyer, 33);
        assert!(soul::current_kiosk_id(&state) == buyer_kiosk_id, 34);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(state);
        ts::return_shared(listing);
        ts::return_shared(seller_kiosk);
        ts::return_shared(buyer_kiosk);
        personal_kiosk::transfer_to_sender(buyer_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let royalty_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(coin::value(&royalty_coin) == creator_royalty, 35);
        transfer::public_transfer(royalty_coin, creator);
    };

    ts::next_tx(&mut scenario, seller);
    {
        let seller_coin: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        assert!(coin::value(&seller_coin) == SOUL_RESALE_PRICE, 36);
        transfer::public_transfer(seller_coin, seller);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::soul::ENotSoulOwner)]
fun collection_holder_cannot_append_memory_as_owner() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let holder = @0xBEEF;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let holder_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    holder_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, holder);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            holder,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Collection Access Soul"),
            string::utf8(b"Collection holder should not gain owner access"),
            string::utf8(b"https://example.com/access.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Access Collection"),
            string::utf8(b"Collection right only"),
            string::utf8(b"https://example.com/access-collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&collection_obj, &mut state, ts::ctx(&mut scenario));
        ts::return_shared(collection_obj);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&collection_obj),
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(&mut scenario, admin, holder, COLLECTION_PRICE);

    ts::next_tx(&mut scenario, holder);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let mut collection_obj: SoulCollection = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let mut listing: CollectionListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut holder_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, holder_kiosk_id);
        let holder_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_collection_right_fixed_price(
            &config,
            &registry,
            &collection_policy,
            &mut collection_obj,
            &mut creator_kiosk,
            &mut holder_kiosk,
            &holder_cap,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        assert!(collection::current_holder(&collection_obj) == holder, 37);
        assert!(soul::current_owner(&state) == creator, 38);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(collection_obj);
        ts::return_shared(state);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(holder_kiosk);
        personal_kiosk::transfer_to_sender(holder_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, holder);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let mut memory_book: SoulMemory = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let holder_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = memory::append_as_owner(
            &mut memory_book,
            &state,
            holder_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::soul::ENotSoulOwner)]
fun collection_holder_cannot_approve_seal_as_owner() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let holder = @0xBEEF;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let holder_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    holder_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, holder);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Seal Access Soul"),
            string::utf8(b"Collection holder should not approve owner seal"),
            string::utf8(b"https://example.com/seal-access.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Seal Access Collection"),
            string::utf8(b"Right only"),
            string::utf8(b"https://example.com/seal-access-collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&collection_obj, &mut state, ts::ctx(&mut scenario));
        ts::return_shared(collection_obj);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&collection_obj),
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(&mut scenario, admin, holder, COLLECTION_PRICE);

    ts::next_tx(&mut scenario, holder);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let mut collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut listing: CollectionListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut holder_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, holder_kiosk_id);
        let holder_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_collection_right_fixed_price(
            &config,
            &registry,
            &collection_policy,
            &mut collection_obj,
            &mut creator_kiosk,
            &mut holder_kiosk,
            &holder_cap,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        assert!(collection::current_holder(&collection_obj) == holder, 39);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(collection_obj);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(holder_kiosk);
        personal_kiosk::transfer_to_sender(holder_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, holder);
    {
        let state: SoulState = ts::take_shared(&scenario);
        seal_policy::seal_approve_owner_for_testing(
            soul_document_id(soul_id),
            &state,
            soul_id,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::collection::ENotCollectionCreator)]
fun non_creator_cannot_add_soul_to_collection() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let intruder = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Protected Collection Soul"),
            string::utf8(b"Only creator can add"),
            string::utf8(b"https://example.com/protected-collection.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Strict Collection"),
            string::utf8(b"Creator only"),
            string::utf8(b"https://example.com/strict.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, intruder);
    {
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&collection_obj, &mut state, ts::ctx(&mut scenario));

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::collection::ECreatorMismatch)]
fun collection_creator_cannot_add_soul_from_other_creator() {
    let admin = @0xA11CE;
    let collection_creator = @0xC0DE;
    let soul_creator = @0xBEEF;
    let mut scenario = ts::begin(@0x0);
    let collection_creator_kiosk_id: ID;
    let soul_creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    collection_creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, collection_creator);
    soul_creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, soul_creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(soul_creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, collection_creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, collection_creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Creator Match Collection"),
            string::utf8(b"Soul creator must match"),
            string::utf8(b"https://example.com/match.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, soul_creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, soul_creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Foreign Soul"),
            string::utf8(b"Wrong creator"),
            string::utf8(b"https://example.com/foreign.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, collection_creator);
    {
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&collection_obj, &mut state, ts::ctx(&mut scenario));

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::soul::ECollectionAlreadyBound)]
fun soul_cannot_bind_collection_twice() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let first_collection_id: ID;
    let second_collection_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Single Collection Soul"),
            string::utf8(b"Cannot bind twice"),
            string::utf8(b"https://example.com/single.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        first_collection_id = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"First Collection"),
            string::utf8(b"First bind"),
            string::utf8(b"https://example.com/first.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        second_collection_id = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Second Collection"),
            string::utf8(b"Second bind"),
            string::utf8(b"https://example.com/second.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let first_collection: SoulCollection = ts::take_shared_by_id(&scenario, first_collection_id);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&first_collection, &mut state, ts::ctx(&mut scenario));
        ts::return_shared(first_collection);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let second_collection: SoulCollection = ts::take_shared_by_id(&scenario, second_collection_id);
        let mut state: SoulState = ts::take_shared(&scenario);
        collection::add_soul(&second_collection, &mut state, ts::ctx(&mut scenario));

        abort 0
    }
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantCapacityExceeded)]
fun multiple_active_grants_respect_capacity() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let first_agent = @0xA63E;
    let second_agent = @0xBEEF;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Scoped Soul"),
            string::utf8(b"Supports multiple active grants"),
            string::utf8(b"https://example.com/scoped.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let first_grant = grant::issue(
            &mut state,
            first_agent,
            grant::scope_seal() | grant::scope_memory(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        assert!(soul::active_grant_count(&state) == 1, 100);
        transfer::public_transfer(first_grant, first_agent);
        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let second_grant = grant::issue(
            &mut state,
            second_agent,
            grant::scope_skills(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        transfer::public_transfer(second_grant, second_agent);

        abort 101
    }
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantInvalidScopeMask)]
fun grant_issue_rejects_unknown_scope_bits() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Scoped Soul"),
            string::utf8(b"Rejects undefined scope bits"),
            string::utf8(b"https://example.com/scoped.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let scope_mask = grant::scope_seal() | 16;
        let invalid_grant = grant::issue(
            &mut state,
            agent,
            scope_mask,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        transfer::public_transfer(invalid_grant, agent);

        abort 106
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::ECollectionRightMismatch)]
fun collection_listing_rejects_mismatched_right_id() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let first_collection_id: ID;
    let second_collection_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        first_collection_id = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"First Collection"),
            string::utf8(b"First listing target"),
            string::utf8(b"https://example.com/first-listing.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        second_collection_id = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Second Collection"),
            string::utf8(b"Wrong right id source"),
            string::utf8(b"https://example.com/second-listing.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let first_collection: SoulCollection = ts::take_shared_by_id(&scenario, first_collection_id);
        let second_collection: SoulCollection = ts::take_shared_by_id(&scenario, second_collection_id);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &first_collection,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&second_collection),
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        abort 0
    }
}

#[test]
fun founding_memory_uses_real_clock_timestamp_and_optional_skills_init() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
        let mut clock_obj: Clock = ts::take_shared(&scenario);
        clock::set_for_testing(&mut clock_obj, 777);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Skill Soul"),
            string::utf8(b"Founding memory keeps clock timestamp"),
            string::utf8(b"https://example.com/skills.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let memory_book: SoulMemory = ts::take_shared(&scenario);
        let memory_id = object::id(&memory_book);
        let skills_id = *soul::skills_id(&state).borrow();
        let skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        assert!(soul::memory_id(&state).contains(&memory_id), 102);
        assert!(memory::contains_entry(&memory_book, 777), 103);
        assert!(skills::skill_count(&skills_book) == 1, 104);
        assert!(skills::version_count(&skills_book, default_skill_name()) == 1, 105);
        assert!(!skills::version_is_public(&skills_book, default_skill_name(), 0), 106);

        ts::return_shared(state);
        ts::return_shared(memory_book);
        ts::return_shared(skills_book);
    };

    ts::end(scenario);
}

#[test]
fun skills_versions_are_indexed_by_skill_name_and_version_index() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Indexed Soul"),
            string::utf8(b"Skills stay addressable by version number"),
            string::utf8(b"https://example.com/indexed-skills.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(initial_skill_blob),
            default_skill_name(),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let mut skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let second_skill_blob: blob::Blob = ts::take_from_sender(&scenario);
        let first_blob_id = skills::blob_object_id_for(&skills_book, default_skill_name(), 0);

        let second_version_index = skills::append_version_as_owner(
            &mut skills_book,
            &state,
            default_skill_name(),
            true,
            second_skill_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(second_version_index == 1, 106);
        assert!(skills::skill_count(&skills_book) == 1, 107);
        assert!(skills::version_count(&skills_book, default_skill_name()) == 2, 108);
        assert!(skills::blob_object_id_for(&skills_book, default_skill_name(), 0) == first_blob_id, 109);

        ts::return_shared(state);
        ts::return_shared(skills_book);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        assert!(!skills::version_is_deleted(&skills_book, default_skill_name(), 0), 110);
        assert!(skills::version_is_public(&skills_book, default_skill_name(), 1), 111);
        assert!(skills::version_created_at_ms(&skills_book, default_skill_name(), 1) == 0, 112);

        ts::return_shared(state);
        ts::return_shared(skills_book);
    };

    ts::end(scenario);
}

#[test]
fun owner_memory_seal_approval_uses_memory_id_and_timestamp_key() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
        let mut clock_obj: Clock = ts::take_shared(&scenario);
        clock::set_for_testing(&mut clock_obj, 777);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Memory Seal Soul"),
            string::utf8(b"Memory seal binding"),
            string::utf8(b"https://example.com/memory-seal.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let memory_book: SoulMemory = ts::take_shared(&scenario);

        seal_policy::seal_approve_memory_owner_for_testing(
            memory_document_id(object::id(&memory_book), 777),
            &state,
            &memory_book,
            777,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(memory_book);
    };

    ts::end(scenario);
}

#[test]
fun skills_private_read_and_delete_use_skill_name_and_version_index() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Private Skill Soul"),
            string::utf8(b"Private skill access"),
            string::utf8(b"https://example.com/private-skill.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(initial_skill_blob),
            default_skill_name(),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        skills::seal_approve_private_read_as_owner_for_testing(
            skill_document_id(skills_id, default_skill_name(), 0),
            &state,
            &skills_book,
            default_skill_name(),
            0,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(skills_book);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let mut skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        skills::delete_version_as_owner(
            &mut skills_book,
            &state,
            default_skill_name(),
            0,
            ts::ctx(&mut scenario),
        );

        assert!(skills::version_is_deleted(&skills_book, default_skill_name(), 0), 113);

        ts::return_shared(state);
        ts::return_shared(skills_book);
    };

    ts::end(scenario);
}

#[test]
fun stale_personal_kiosk_registration_can_be_rebound_to_current_cap() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let original_kiosk_id: ID;
    let replacement_kiosk_id: ID;
    let replacement_cap_id: ID;

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        original_kiosk_id = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));
        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let (mut replacement_kiosk, replacement_owner_cap) = kiosk::new(ts::ctx(&mut scenario));
        replacement_kiosk_id = object::id(&replacement_kiosk);
        let replacement_personal_cap = personal_kiosk::new(
            &mut replacement_kiosk,
            replacement_owner_cap,
            ts::ctx(&mut scenario),
        );
        replacement_cap_id = object::id(&replacement_personal_cap);

        transfer::public_share_object(replacement_kiosk);
        personal_kiosk::transfer_to_sender(replacement_personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        let replacement_personal_cap: PersonalKioskCap =
            ts::take_from_sender_by_id(&scenario, replacement_cap_id);

        market::ensure_personal_kiosk_registered(
            &config,
            &mut registry,
            &replacement_personal_cap,
            ts::ctx(&mut scenario),
        );
        let rebound_kiosk_id = market::reuse_personal_kiosk(
            &registry,
            replacement_personal_cap,
            ts::ctx(&mut scenario),
        );

        assert!(rebound_kiosk_id == replacement_kiosk_id, 106);
        assert!(rebound_kiosk_id != original_kiosk_id, 107);

        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::market::EMarketPaused)]
fun paused_market_blocks_kiosk_registration() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);
        market::update_paused(&mut config, &admin_cap, true);
        transfer::public_transfer(admin_cap, admin);
        ts::return_shared(config);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        let _ = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));

        abort 105
    }
}

// ── SoulAssets Tests ──

#[test]
fun asset_version_append_and_seal_approval_by_owner() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 4 blobs for creator: protected, founding memory, initial asset, extra asset
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_four_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            creator,
            BLOB_ROOT_HASH_D,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial asset
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Asset Soul"),
            string::utf8(b"Soul with initial asset"),
            string::utf8(b"https://example.com/asset-soul.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Append a second asset version under a different name
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let mut assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let extra_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let version_index = assets::append_version_as_owner(
            &mut assets_book,
            &state,
            string::utf8(b"persona-hires"),
            false,
            0,
            extra_asset_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(version_index == 0, 100);
        assert!(assets::asset_count(&assets_book) == 2, 101);
        assert!(assets::version_count(&assets_book, default_asset_name()) == 1, 102);
        assert!(assets::version_count(&assets_book, string::utf8(b"persona-hires")) == 1, 103);

        ts::return_shared(state);
        ts::return_shared(assets_book);
        ts::return_shared(clock_obj);
    };

    // Seal approve the initial asset read as owner
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);

        assets::seal_approve_asset_read_as_owner_for_testing(
            asset_document_id(assets_id, default_asset_name(), 0),
            &state,
            &assets_book,
            default_asset_name(),
            0,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(assets_book);
    };

    ts::end(scenario);
}

#[test]
fun granted_agent_can_append_and_seal_approve_asset() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 4 blobs: 3 for creator + 1 for agent
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_four_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            agent,
            BLOB_ROOT_HASH_D,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial asset
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Agent Asset Soul"),
            string::utf8(b"Soul for agent asset test"),
            string::utf8(b"https://example.com/agent-asset.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Issue grant with scope_assets() to agent
    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant = grant::issue(
            &mut state,
            agent,
            grant::scope_assets(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    // Agent appends a new asset version
    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let mut assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        let version_index = assets::append_version_as_granted_agent(
            &mut assets_book,
            &state,
            &soul_grant,
            default_asset_name(),
            false,
            0,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(version_index == 1, 100);
        assert!(assets::asset_count(&assets_book) == 1, 101);
        assert!(assets::version_count(&assets_book, default_asset_name()) == 2, 102);

        ts::return_shared(state);
        ts::return_shared(assets_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    // Agent calls seal approve for the appended asset
    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);

        assets::seal_approve_asset_read_as_granted_agent_for_testing(
            asset_document_id(assets_id, default_asset_name(), 1),
            &state,
            &assets_book,
            default_asset_name(),
            1,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(assets_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    ts::end(scenario);
}

#[test]
fun owner_can_soft_delete_asset_version() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: protected + initial asset
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial asset (no founding memory)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Delete Asset Soul"),
            string::utf8(b"Soul for delete test"),
            string::utf8(b"https://example.com/delete-asset.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Delete the initial asset version
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let mut assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);

        assets::delete_version_as_owner(
            &mut assets_book,
            &state,
            default_asset_name(),
            0,
            ts::ctx(&mut scenario),
        );

        assert!(assets::version_is_deleted(&assets_book, default_asset_name(), 0) == true, 100);

        ts::return_shared(state);
        ts::return_shared(assets_book);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::assets::EAssetVersionDeleted)]
fun seal_approval_fails_on_deleted_asset() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: protected + initial asset
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial asset (no founding memory)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Fail Seal Soul"),
            string::utf8(b"Soul for seal fail test"),
            string::utf8(b"https://example.com/fail-seal.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Delete the initial asset version
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let mut assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);

        assets::delete_version_as_owner(
            &mut assets_book,
            &state,
            default_asset_name(),
            0,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(assets_book);
    };

    // Try to seal approve the deleted asset — should abort
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);

        assets::seal_approve_asset_read_as_owner_for_testing(
            asset_document_id(assets_id, default_asset_name(), 0),
            &state,
            &assets_book,
            default_asset_name(),
            0,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ═══════════════════════════════════════════════════════════════════
// ── ContentAccessList tests ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

const CONTENT_ACCESS_PRICE: u64 = 1_000_000;
const SCOPE_SKILLS: u64 = 4;
const SCOPE_ASSETS: u64 = 8;
const SCOPE_SKILLS_AND_ASSETS: u64 = 12; // SCOPE_SKILLS | SCOPE_ASSETS

#[test]
fun content_access_add_and_has_access() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blob for creator
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    // Mint soul with content access (price > 0, scope = SKILLS|ASSETS)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Content Access Soul"),
            string::utf8(b"Soul with content access list"),
            string::utf8(b"https://example.com/ca.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Add buyer to access list, then assert has_access
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        content_access::add_access(
            &mut access_list,
            &state,
            buyer,
            SCOPE_SKILLS_AND_ASSETS,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        // Buyer has SKILLS scope
        assert!(content_access::has_access(&access_list, buyer, SCOPE_SKILLS, &clock_obj) == true, 0);
        // Buyer has ASSETS scope
        assert!(content_access::has_access(&access_list, buyer, SCOPE_ASSETS, &clock_obj) == true, 1);
        // Random address has no access
        assert!(content_access::has_access(&access_list, @0xDEAD, SCOPE_SKILLS, &clock_obj) == false, 2);
        // Entry count is 1
        assert!(content_access::entry_count(&access_list) == 1, 3);

        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(clock_obj);
    };

    ts::end(scenario);
}

#[test]
fun content_access_revoke_removes_entry() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blob for creator
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    // Mint soul with content access list
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Revoke Test Soul"),
            string::utf8(b"Soul for revoke test"),
            string::utf8(b"https://example.com/revoke.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Add buyer to access list
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        content_access::add_access(
            &mut access_list,
            &state,
            buyer,
            SCOPE_SKILLS_AND_ASSETS,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(content_access::has_access(&access_list, buyer, SCOPE_SKILLS, &clock_obj) == true, 0);

        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(clock_obj);
    };

    // Revoke buyer access
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);

        content_access::revoke_access(
            &mut access_list,
            &state,
            buyer,
            ts::ctx(&mut scenario),
        );

        let clock_obj: Clock = ts::take_shared(&scenario);
        // Buyer should no longer have access
        assert!(content_access::has_access(&access_list, buyer, SCOPE_SKILLS, &clock_obj) == false, 1);
        assert!(content_access::entry_count(&access_list) == 0, 2);

        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(clock_obj);
    };

    ts::end(scenario);
}

#[test]
fun content_access_set_price_updates_price() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blob for creator
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    // Mint soul with content access list (price = 1_000_000)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Price Update Soul"),
            string::utf8(b"Soul for price update test"),
            string::utf8(b"https://example.com/price.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Update price from 1_000_000 to 2_000_000
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);

        // Verify initial price
        assert!(content_access::price_atomic(&access_list) == CONTENT_ACCESS_PRICE, 0);

        content_access::set_content_price(
            &mut access_list,
            &state,
            2_000_000,
            ts::ctx(&mut scenario),
        );

        // Verify updated price
        assert!(content_access::price_atomic(&access_list) == 2_000_000, 1);

        ts::return_shared(state);
        ts::return_shared(access_list);
    };

    ts::end(scenario);
}

#[test]
fun seal_approve_asset_allowlisted_works() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: 1 protected + 1 initial asset
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial asset AND content access list (scope = SCOPE_ASSETS)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Seal Asset Soul"),
            string::utf8(b"Soul for seal approve asset allowlisted test"),
            string::utf8(b"https://example.com/seal-asset.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Add buyer to access list with SCOPE_ASSETS
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        content_access::add_access(
            &mut access_list,
            &state,
            buyer,
            SCOPE_ASSETS,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(clock_obj);
    };

    // Buyer calls seal_approve_asset_allowlisted — should succeed
    ts::next_tx(&mut scenario, buyer);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let assets_id = *soul::assets_id(&state).borrow();
        let assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        let doc_id = asset_document_id(assets_id, default_asset_name(), 0);

        content_access::seal_approve_asset_allowlisted(
            doc_id,
            &state,
            &access_list,
            &assets_book,
            default_asset_name(),
            0,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(assets_book);
        ts::return_shared(clock_obj);
    };

    ts::end(scenario);
}

// ═══════════════════════════════════════════════════════════════════
// ── Phase 1A: content_access error-path tests ───────────────────
// ═══════════════════════════════════════════════════════════════════

#[test]
#[expected_failure(abort_code = soulidity::content_access::ENotCreatorOrOwner)]
fun unauthorized_add_access_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let bad = @0xBAD;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blob for creator
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    // Mint soul with content access
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Unauthorized Add Soul"),
            string::utf8(b"Soul for unauthorized add test"),
            string::utf8(b"https://example.com/unauth-add.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // @0xBAD (not creator or owner) tries to add access — should fail
    ts::next_tx(&mut scenario, bad);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        content_access::add_access(
            &mut access_list,
            &state,
            buyer,
            SCOPE_SKILLS_AND_ASSETS,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::content_access::EAlreadyHasAccess)]
fun duplicate_unexpired_access_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blob for creator
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    // Mint soul with content access
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Duplicate Access Soul"),
            string::utf8(b"Soul for duplicate access test"),
            string::utf8(b"https://example.com/dup-access.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Creator adds buyer (no expiry), then adds buyer again — should fail
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        content_access::add_access(
            &mut access_list,
            &state,
            buyer,
            SCOPE_SKILLS_AND_ASSETS,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        // Second add for same buyer — no expiry means not renewable
        content_access::add_access(
            &mut access_list,
            &state,
            buyer,
            SCOPE_SKILLS_AND_ASSETS,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::content_access::ENoAccessEntry)]
fun revoke_nonexistent_access_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blob for creator
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    // Mint soul with content access
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Revoke Nonexistent Soul"),
            string::utf8(b"Soul for revoke nonexistent test"),
            string::utf8(b"https://example.com/revoke-none.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Creator revokes buyer who was never added — should fail
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);

        content_access::revoke_access(
            &mut access_list,
            &state,
            buyer,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::content_access::EScopeMismatch)]
fun seal_approve_skill_wrong_scope_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: 1 protected + 1 initial asset
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial asset AND content access (scope = SCOPE_SKILLS_AND_ASSETS)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Scope Mismatch Soul"),
            string::utf8(b"Soul for scope mismatch test"),
            string::utf8(b"https://example.com/scope-mm.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Add buyer with SCOPE_SKILLS (4) only
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        content_access::add_access(
            &mut access_list,
            &state,
            buyer,
            SCOPE_SKILLS,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(clock_obj);
    };

    // Buyer calls seal_approve_asset_allowlisted which requires SCOPE_ASSETS (8) — should fail
    ts::next_tx(&mut scenario, buyer);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let assets_id = *soul::assets_id(&state).borrow();
        let assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        let doc_id = asset_document_id(assets_id, default_asset_name(), 0);

        content_access::seal_approve_asset_allowlisted(
            doc_id,
            &state,
            &access_list,
            &assets_book,
            default_asset_name(),
            0,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::content_access::EAccessListMismatch)]
fun access_list_soul_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: one for each soul
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A with content access
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul A Mismatch"),
            string::utf8(b"First soul for mismatch test"),
            string::utf8(b"https://example.com/mm-a.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Mint soul B with content access
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul B Mismatch"),
            string::utf8(b"Second soul for mismatch test"),
            string::utf8(b"https://example.com/mm-b.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Use soul A's state + soul B's access_list in add_access — should fail
    ts::next_tx(&mut scenario, creator);
    {
        // There are 2 SoulStates shared. Take them in order:
        // first take = soul A, second take = soul B
        let state_a: SoulState = ts::take_shared(&scenario);
        let state_b: SoulState = ts::take_shared(&scenario);
        // Get soul B's access list
        let access_list_b_id = *soul::access_list_id(&state_b).borrow();
        let mut access_list_b: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_b_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        // Passing soul A's state with soul B's access_list
        content_access::add_access(
            &mut access_list_b,
            &state_a,
            buyer,
            SCOPE_SKILLS_AND_ASSETS,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ═══════════════════════════════════════════════════════════════════
// ── Phase 1B: memory error-path tests ───────────────────────────
// ═══════════════════════════════════════════════════════════════════

#[test]
#[expected_failure(abort_code = soulidity::memory::EMemoryStateMismatch)]
fun memory_state_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 3 blobs: 2 for protected (soul A + B) + 1 for memory append
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A (with memory)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Memory Soul A"),
            string::utf8(b"First soul for memory mismatch"),
            string::utf8(b"https://example.com/mem-a.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Mint soul B (with memory)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Memory Soul B"),
            string::utf8(b"Second soul for memory mismatch"),
            string::utf8(b"https://example.com/mem-b.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Creator calls append_as_owner with soul B's memory + soul A's state — should fail
    ts::next_tx(&mut scenario, creator);
    {
        let state_a: SoulState = ts::take_shared(&scenario);
        let state_b: SoulState = ts::take_shared(&scenario);
        let memory_b_id = *soul::memory_id(&state_b).borrow();
        let mut memory_b: SoulMemory = ts::take_shared_by_id(&scenario, memory_b_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let append_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = memory::append_as_owner(
            &mut memory_b,
            &state_a,
            append_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::memory::EMemoryGrantStateMismatch)]
fun memory_grant_state_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 3 blobs: 2 for protected (soul A + B) + 1 for agent memory append
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            agent,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Grant Mem Soul A"),
            string::utf8(b"First soul for grant memory mismatch"),
            string::utf8(b"https://example.com/gmem-a.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Mint soul B
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Grant Mem Soul B"),
            string::utf8(b"Second soul for grant memory mismatch"),
            string::utf8(b"https://example.com/gmem-b.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Issue grant on soul A to agent
    ts::next_tx(&mut scenario, creator);
    {
        let mut state_a: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state_a, agent, option::none(), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state_a);
    };

    // Agent calls append_as_granted_agent with soul B's memory + soul A's state + grant — should fail
    ts::next_tx(&mut scenario, agent);
    {
        let state_a: SoulState = ts::take_shared(&scenario);
        let state_b: SoulState = ts::take_shared(&scenario);
        let memory_b_id = *soul::memory_id(&state_b).borrow();
        let mut memory_b: SoulMemory = ts::take_shared_by_id(&scenario, memory_b_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = memory::append_as_granted_agent(
            &mut memory_b,
            &state_a,
            &soul_grant,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::memory::EMemoryEntryMissing)]
fun memory_entry_missing_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint blob for creator
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    // Mint soul (with memory)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Memory Missing Soul"),
            string::utf8(b"Soul for memory entry missing test"),
            string::utf8(b"https://example.com/mem-missing.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Call blob_object_id_for with nonexistent timestamp_key — should fail
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let memory_id = *soul::memory_id(&state).borrow();
        let memory_book: SoulMemory = ts::take_shared_by_id(&scenario, memory_id);

        let _ = memory::blob_object_id_for(&memory_book, 999999);

        abort 100
    }
}

// ═══════════════════════════════════════════════════════════════════
// ── Phase 1C: skills error-path tests ───────────────────────────
// ═══════════════════════════════════════════════════════════════════

#[test]
#[expected_failure(abort_code = soulidity::skills::EEmptySkillName)]
fun empty_skill_name_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 3 blobs: 1 protected + 1 initial skill + 1 for empty-name append
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial skill
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Empty Skill Name Soul"),
            string::utf8(b"Soul for empty skill name test"),
            string::utf8(b"https://example.com/empty-skill.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Creator calls append_version_as_owner with empty skill name — should fail
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let mut skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let new_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = skills::append_version_as_owner(
            &mut skills_book,
            &state,
            string::utf8(b""),
            false,
            new_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::skills::ESkillsStateMismatch)]
fun skills_state_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 5 blobs: 2 protected + 2 initial skill + 1 for append
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_five_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            creator,
            BLOB_ROOT_HASH_D,
            creator,
            BLOB_ROOT_HASH_E,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A with skills
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Skills Soul A"),
            string::utf8(b"First soul for skills mismatch"),
            string::utf8(b"https://example.com/sk-a.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Mint soul B with skills
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Skills Soul B"),
            string::utf8(b"Second soul for skills mismatch"),
            string::utf8(b"https://example.com/sk-b.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Creator calls delete_version_as_owner with soul B's skills + soul A's state — should fail
    // assert_owner(state_a, creator) passes, then assert_skills_matches_state fails
    ts::next_tx(&mut scenario, creator);
    {
        let state_a: SoulState = ts::take_shared(&scenario);
        let state_b: SoulState = ts::take_shared(&scenario);
        let skills_b_id = *soul::skills_id(&state_b).borrow();
        let mut skills_b: SoulSkills = ts::take_shared_by_id(&scenario, skills_b_id);

        skills::delete_version_as_owner(
            &mut skills_b,
            &state_a,
            default_skill_name(),
            0,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::skills::ESkillSlotMissing)]
fun skill_slot_missing_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: 1 protected + 1 initial skill
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial skill ("default")
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Slot Missing Soul"),
            string::utf8(b"Soul for skill slot missing test"),
            string::utf8(b"https://example.com/slot-missing.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Call blob_object_id_for with nonexistent skill name — should fail
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        let _ = skills::blob_object_id_for(&skills_book, string::utf8(b"nonexistent"), 0);

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::skills::ESkillVersionDeleted)]
fun skill_version_deleted_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: 1 protected + 1 initial skill
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial skill
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Delete Skill Soul"),
            string::utf8(b"Soul for skill version deleted test"),
            string::utf8(b"https://example.com/del-skill.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Delete version 0
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let mut skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        skills::delete_version_as_owner(
            &mut skills_book,
            &state,
            default_skill_name(),
            0,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(skills_book);
    };

    // Try to delete version 0 again — should fail with ESkillVersionDeleted
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let mut skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        skills::delete_version_as_owner(
            &mut skills_book,
            &state,
            default_skill_name(),
            0,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::skills::EDocumentIdTooShort)]
fun skill_seal_document_too_short_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: 1 protected + 1 initial skill
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial skill
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Short Doc ID Soul"),
            string::utf8(b"Soul for short document ID test"),
            string::utf8(b"https://example.com/short-doc.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Call seal_approve with too-short document ID — should fail
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        skills::seal_approve_private_read_as_owner_for_testing(
            b"short",
            &state,
            &skills_book,
            default_skill_name(),
            0,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::skills::EDocumentIdPrefixMismatch)]
fun skill_seal_prefix_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs: 1 protected + 1 initial skill
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with initial skill
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Prefix Mismatch Soul"),
            string::utf8(b"Soul for prefix mismatch test"),
            string::utf8(b"https://example.com/prefix-mm.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Build a document ID with correct length but wrong prefix
    // Expected minimum: "soul-skill:" (11) + version (1) + skills_id (32) + skill_name + null (1) + version_index (8) + nonce (16)
    // "default" = 7 bytes, so total = 11 + 1 + 32 + 7 + 1 + 8 + 16 = 76 bytes
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);

        // Build wrong-prefix document ID with correct length
        let mut bad_doc_id = b"wrong-seal:";  // 11 bytes, wrong domain
        bad_doc_id.push_back(0x01);           // version byte
        // Fill remaining bytes to reach correct length: 32 + 7 + 1 + 8 + 16 = 64
        let mut i = 0u64;
        while (i < 64) {
            bad_doc_id.push_back(0xAA);
            i = i + 1;
        };

        skills::seal_approve_private_read_as_owner_for_testing(
            bad_doc_id,
            &state,
            &skills_book,
            default_skill_name(),
            0,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}
// ═══════════════════════════════════════════════════════════════════
// ── Phase 2: Error-path coverage ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// 2A  grant.move (10 error codes)
// ───────────────────────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::grant::EInvalidGrantee)]
fun grant_to_zero_address_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Grant Zero Soul"),
            string::utf8(b"Test grant to zero address"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        let bad_grant = grant::issue(
            &mut state,
            @0x0,
            grant::scope_seal() | grant::scope_memory(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        // Should not reach here
        grant::destroy_for_testing(bad_grant);
        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EInvalidGrantee)]
fun grant_to_self_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Grant Self Soul"),
            string::utf8(b"Test grant to self"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        let bad_grant = grant::issue(
            &mut state,
            creator, // granting to self
            grant::scope_seal() | grant::scope_memory(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        grant::destroy_for_testing(bad_grant);
        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantSoulMismatch)]
fun grant_soul_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id_a: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 3 blobs: protected_blob_a, protected_blob_b for two souls, memory_blob for agent
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            agent,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id_a = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul A"),
            string::utf8(b"First soul"),
            string::utf8(b"https://example.com/a.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Issue grant from soul A to agent
    ts::next_tx(&mut scenario, creator);
    {
        let mut state_a: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state_a, agent, option::none(), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state_a);
    };

    // Mint soul B
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul B"),
            string::utf8(b"Second soul"),
            string::utf8(b"https://example.com/b.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Agent tries to use grant from soul A on soul B's memory
    ts::next_tx(&mut scenario, agent);
    {
        // We need to pick state_b (the second one). Since both are shared SoulState,
        // we take them by order — take state_a first, then state_b.
        let state_a: SoulState = ts::take_shared(&scenario);
        let state_b: SoulState = ts::take_shared(&scenario);
        // Identify which is which: state_a should have soul_id_a
        let (used_state_b, returned_state_a) = if (soul::soul_id(&state_a) == soul_id_a) {
            (state_b, state_a)
        } else {
            (state_a, state_b)
        };
        let memory_b_id = *soul::memory_id(&used_state_b).borrow();
        let mut memory_b: SoulMemory = ts::take_shared_by_id(&scenario, memory_b_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let grant_a: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        // Grant from soul A used against soul B's state => EGrantSoulMismatch
        let _ = memory::append_as_granted_agent(
            &mut memory_b,
            &used_state_b,
            &grant_a,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(returned_state_a);
        ts::return_shared(used_state_b);
        ts::return_shared(memory_b);
        ts::return_shared(clock_obj);
        transfer::public_transfer(grant_a, agent);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantTargetMismatch)]
fun grant_target_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            buyer,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Target Mismatch Soul"),
            string::utf8(b"Test wrong sender uses grant"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Issue grant to agent
    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::none(), &mut scenario);
        // Transfer grant to buyer (wrong person) so they have it
        transfer::public_transfer(soul_grant, buyer);
        ts::return_shared(state);
    };

    // buyer (not agent) tries to use agent's grant
    ts::next_tx(&mut scenario, buyer);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let memory_id = *soul::memory_id(&state).borrow();
        let mut memory_book: SoulMemory = ts::take_shared_by_id(&scenario, memory_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let buyer_blob: blob::Blob = ts::take_from_sender(&scenario);

        // buyer is sender but grant.grantee is agent => EGrantTargetMismatch
        let _ = memory::append_as_granted_agent(
            &mut memory_book,
            &state,
            &soul_grant,
            buyer_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(memory_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, buyer);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantScopeMissing)]
fun grant_scope_missing_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Need 3 blobs: protected, skill_blob for minting soul with skills, agent_blob for agent use
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            agent,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with skills
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Scope Missing Soul"),
            string::utf8(b"Test scope mismatch"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(skill_blob),
            default_skill_name(),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Issue grant with seal|memory scope (no skills)
    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::none(), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    // Agent tries skills::append_version_as_granted_agent which requires scope_skills
    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let mut skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        // Grant has seal|memory but skills::append requires scope_skills => EGrantScopeMissing
        let _ = skills::append_version_as_granted_agent(
            &mut skills_book,
            &state,
            &soul_grant,
            default_skill_name(),
            false,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(skills_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantNotFound)]
fun revoke_nonexistent_grant_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Revoke Nonexistent Soul"),
            string::utf8(b"Test revoke missing grant"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        // @0xDEAD was never granted
        grant::revoke(&mut state, @0xDEAD, &clock_obj, ts::ctx(&mut scenario));

        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EEmptyScopeMask)]
fun grant_empty_scope_mask_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Empty Scope Soul"),
            string::utf8(b"Test zero scope mask"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        // scope_mask = 0 => EEmptyScopeMask
        let bad_grant = grant::issue(
            &mut state,
            agent,
            0,
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        grant::destroy_for_testing(bad_grant);
        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantScopeWouldRemoveAll)]
fun revoke_scope_would_remove_all_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Revoke All Scope Soul"),
            string::utf8(b"Test revoke all scopes"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Issue grant with only memory scope
    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        let soul_grant = grant::issue(
            &mut state,
            agent,
            grant::scope_memory(), // only memory
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    // Revoke memory scope => retained = 0 => EGrantScopeWouldRemoveAll
    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        let new_grant = grant::revoke_scope(
            &mut state,
            agent,
            grant::scope_memory(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        grant::destroy_for_testing(new_grant);
        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantCapacityTooLow)]
fun grant_capacity_too_low_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Capacity Low Soul"),
            string::utf8(b"Test capacity below active"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Issue 1 grant
    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let soul_grant = issue_default_grant(&mut state, agent, option::none(), &mut scenario);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    // Try to set capacity to 0 (below active count of 1)
    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        grant::set_grant_capacity(&mut state, 0, &clock_obj, ts::ctx(&mut scenario));

        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::grant::EGrantCapacityTooHigh)]
fun grant_capacity_too_high_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Capacity High Soul"),
            string::utf8(b"Test capacity above max"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Try to set capacity to 10_001 (above MAX_GRANT_CAPACITY)
    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        grant::set_grant_capacity(&mut state, 10_001, &clock_obj, ts::ctx(&mut scenario));

        ts::return_shared(state);
        ts::return_shared(clock_obj);
    };

    abort 100
}

// ───────────────────────────────────────────────────────────────────
// 2B  soul.move (6 error codes)
// ───────────────────────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::soul::ECreatorRoyaltyTooHigh)]
fun creator_royalty_too_high_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        // creator_royalty_bps = 10_001 exceeds MAX_BPS
        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"High Royalty Soul"),
            string::utf8(b"Royalty too high"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            10_001, // exceeds 10_000
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::soul::EInvalidOwner)]
fun invalid_zero_owner_fails() {
    let mut scenario = ts::begin(@0xC0DE);
    ts::next_tx(&mut scenario, @0xC0DE);
    {
        let dummy_soul_id = object::id_from_address(@0x1);
        let dummy_kiosk_id = object::id_from_address(@0x2);
        let state = soul::create_state(
            dummy_soul_id,
            @0xC0DE,
            1000,
            @0x0, // zero owner => EInvalidOwner
            dummy_kiosk_id,
            option::none(),
            ts::ctx(&mut scenario),
        );
        soul::destroy_state_for_testing(state);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::soul::ESkillsAlreadyBound)]
fun skills_already_bound_fails() {
    let mut scenario = ts::begin(@0xC0DE);
    ts::next_tx(&mut scenario, @0xC0DE);
    {
        let dummy_soul_id = object::id_from_address(@0x1);
        let dummy_kiosk_id = object::id_from_address(@0x2);
        let first_skills_id = object::id_from_address(@0x3);
        let second_skills_id = object::id_from_address(@0x4);
        let mut state = soul::create_state(
            dummy_soul_id,
            @0xC0DE,
            1000,
            @0xC0DE,
            dummy_kiosk_id,
            option::none(),
            ts::ctx(&mut scenario),
        );
        soul::set_skills_id(&mut state, first_skills_id);
        soul::set_skills_id(&mut state, second_skills_id); // already bound => ESkillsAlreadyBound
        soul::destroy_state_for_testing(state);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::soul::EMemoryAlreadyBound)]
fun memory_already_bound_fails() {
    let mut scenario = ts::begin(@0xC0DE);
    ts::next_tx(&mut scenario, @0xC0DE);
    {
        let dummy_soul_id = object::id_from_address(@0x1);
        let dummy_kiosk_id = object::id_from_address(@0x2);
        let first_memory_id = object::id_from_address(@0x3);
        let second_memory_id = object::id_from_address(@0x4);
        // Create state with memory already bound
        let mut state = soul::create_state(
            dummy_soul_id,
            @0xC0DE,
            1000,
            @0xC0DE,
            dummy_kiosk_id,
            option::some(first_memory_id), // memory already set during creation
            ts::ctx(&mut scenario),
        );
        soul::set_memory_id(&mut state, second_memory_id); // already bound => EMemoryAlreadyBound
        soul::destroy_state_for_testing(state);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::soul::EAssetsAlreadyBound)]
fun assets_already_bound_fails() {
    let mut scenario = ts::begin(@0xC0DE);
    ts::next_tx(&mut scenario, @0xC0DE);
    {
        let dummy_soul_id = object::id_from_address(@0x1);
        let dummy_kiosk_id = object::id_from_address(@0x2);
        let first_assets_id = object::id_from_address(@0x3);
        let second_assets_id = object::id_from_address(@0x4);
        let mut state = soul::create_state(
            dummy_soul_id,
            @0xC0DE,
            1000,
            @0xC0DE,
            dummy_kiosk_id,
            option::none(),
            ts::ctx(&mut scenario),
        );
        soul::set_assets_id(&mut state, first_assets_id);
        soul::set_assets_id(&mut state, second_assets_id); // already bound => EAssetsAlreadyBound
        soul::destroy_state_for_testing(state);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::soul::EAccessListAlreadyBound)]
fun access_list_already_bound_fails() {
    let mut scenario = ts::begin(@0xC0DE);
    ts::next_tx(&mut scenario, @0xC0DE);
    {
        let dummy_soul_id = object::id_from_address(@0x1);
        let dummy_kiosk_id = object::id_from_address(@0x2);
        let first_access_list_id = object::id_from_address(@0x3);
        let second_access_list_id = object::id_from_address(@0x4);
        let mut state = soul::create_state(
            dummy_soul_id,
            @0xC0DE,
            1000,
            @0xC0DE,
            dummy_kiosk_id,
            option::none(),
            ts::ctx(&mut scenario),
        );
        soul::set_access_list_id(&mut state, first_access_list_id);
        soul::set_access_list_id(&mut state, second_access_list_id); // already bound => EAccessListAlreadyBound
        soul::destroy_state_for_testing(state);
    };

    abort 100
}

// ───────────────────────────────────────────────────────────────────
// 2C  seal_policy.move (4 error codes)
// ───────────────────────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::seal_policy::EDocumentIdTooShort)]
fun seal_document_id_too_short_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Seal Short ID Soul"),
            string::utf8(b"Test document ID too short"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);

        // Too-short document ID
        seal_policy::seal_approve_owner_for_testing(
            b"short",
            &state,
            soul_id,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::seal_policy::EStateSoulMismatch)]
fun seal_state_soul_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Seal Mismatch Soul"),
            string::utf8(b"Test state vs soul_id mismatch"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        // Use a fake soul_id that doesn't match state
        let wrong_soul_id = object::id_from_address(@0xDEAD);
        // Build a valid-length document ID for the WRONG soul_id so it passes the length check
        let doc_id = soul_document_id(wrong_soul_id);

        // state.soul_id != wrong_soul_id => EStateSoulMismatch
        seal_policy::seal_approve_owner_for_testing(
            doc_id,
            &state,
            wrong_soul_id,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::seal_policy::EStateMemoryMismatch)]
fun seal_state_memory_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Need 2 blobs: protected + founding_memory for soul A
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A with founding memory
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Memory Mismatch Soul"),
            string::utf8(b"Test memory not bound to state"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Create a second, standalone SoulState whose soul_id matches the memory's soul_id,
    // but whose memory_id is None. This passes the first check (memory.soul_id == state.soul_id)
    // but fails the second (state.memory_id.contains(&memory_id)).
    ts::next_tx(&mut scenario, creator);
    {
        let real_state: SoulState = ts::take_shared(&scenario);
        let real_soul_id = soul::soul_id(&real_state);
        let real_memory_id = *soul::memory_id(&real_state).borrow();
        let memory_book: SoulMemory = ts::take_shared_by_id(&scenario, real_memory_id);

        // Build a standalone state: same soul_id so memory.soul_id == state.soul_id passes,
        // but memory_id = None so the contains check fails.
        let dummy_kiosk_id = object::id_from_address(@0xBEEF);
        let unbound_state = soul::create_state(
            real_soul_id, // match memory's soul_id
            creator,
            1000,
            creator,
            dummy_kiosk_id,
            option::none(), // no memory bound
            ts::ctx(&mut scenario),
        );

        // Build valid doc_id for the real memory + timestamp_key=0 (the founding entry timestamp)
        let doc_id = memory_document_id(real_memory_id, 0);

        // unbound_state has no memory_id => EStateMemoryMismatch
        seal_policy::seal_approve_memory_owner_for_testing(
            doc_id,
            &unbound_state,
            &memory_book,
            0,
            ts::ctx(&mut scenario),
        );

        soul::destroy_state_for_testing(unbound_state);
        ts::return_shared(real_state);
        ts::return_shared(memory_book);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::seal_policy::EMemoryEntryMissing)]
fun seal_memory_entry_missing_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Need 2 blobs: protected + founding_memory
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with founding memory
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Memory Entry Soul"),
            string::utf8(b"Test nonexistent memory entry"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Try seal_approve_memory_owner with a nonexistent timestamp_key
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let memory_id = *soul::memory_id(&state).borrow();
        let memory_book: SoulMemory = ts::take_shared_by_id(&scenario, memory_id);

        let nonexistent_ts: u64 = 999_999;
        let doc_id = memory_document_id(memory_id, nonexistent_ts);

        // Entry at timestamp 999_999 doesn't exist => EMemoryEntryMissing
        seal_policy::seal_approve_memory_owner_for_testing(
            doc_id,
            &state,
            &memory_book,
            nonexistent_ts,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(memory_book);
    };

    abort 100
}

// ───────────────────────────────────────────────────────────────────
// 2D  assets.move (4 error codes)
// ───────────────────────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::assets::EAssetsMismatch)]
fun assets_state_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id_a: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Need 4 blobs: protected_a, founding_memory_a, initial_asset_a, protected_b
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_four_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            creator,
            BLOB_ROOT_HASH_D,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A with assets
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id_a = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Asset Soul A"),
            string::utf8(b"Soul A with assets"),
            string::utf8(b"https://example.com/a.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Mint soul B (no assets)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul B"),
            string::utf8(b"Second soul without assets"),
            string::utf8(b"https://example.com/b.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Creator tries append on soul A's assets with soul B's state
    // delete_version_as_owner checks assert_assets_matches_state FIRST (fails: soul_id mismatch)
    ts::next_tx(&mut scenario, creator);
    {
        let state_1: SoulState = ts::take_shared(&scenario);
        let state_2: SoulState = ts::take_shared(&scenario);
        let (state_a, state_b) = if (soul::soul_id(&state_1) == soul_id_a) {
            (state_1, state_2)
        } else {
            (state_2, state_1)
        };

        let assets_a_id = *soul::assets_id(&state_a).borrow();
        let mut assets_a: SoulAssets = ts::take_shared_by_id(&scenario, assets_a_id);

        // assets_a.soul_id != soul::soul_id(state_b) => EAssetsMismatch
        assets::delete_version_as_owner(
            &mut assets_a,
            &state_b,
            default_asset_name(),
            0,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::assets::EAssetNotFound)]
fun asset_not_found_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Need 3 blobs: protected, founding_memory, initial_asset
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with assets
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Asset Lookup Soul"),
            string::utf8(b"Test nonexistent asset name"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Try to look up a nonexistent asset name
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);

        // "nonexistent" was never added => EAssetNotFound
        let _ = assets::blob_object_id_for(
            &assets_book,
            string::utf8(b"nonexistent"),
            0,
        );

        ts::return_shared(state);
        ts::return_shared(assets_book);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::assets::EVersionOutOfBounds)]
fun asset_version_out_of_bounds_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with 1 asset version
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Version OOB Soul"),
            string::utf8(b"Test version out of bounds"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Try version_index 99 when only version 0 exists
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);

        // Only version 0 exists, 99 is OOB => EVersionOutOfBounds
        let _ = assets::blob_object_id_for(
            &assets_book,
            default_asset_name(),
            99,
        );

        ts::return_shared(state);
        ts::return_shared(assets_book);
    };

    abort 100
}

#[test]
#[expected_failure(abort_code = soulidity::assets::EEmptyAssetName)]
fun empty_asset_name_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Need 4 blobs: protected, founding_memory, initial_asset, extra_blob for the bad append
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_four_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            creator,
            BLOB_ROOT_HASH_C,
            creator,
            BLOB_ROOT_HASH_D,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul with assets
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Empty Name Soul"),
            string::utf8(b"Test empty asset name"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Try to append with empty asset name
    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let mut assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let extra_blob: blob::Blob = ts::take_from_sender(&scenario);

        // Empty string asset name => EEmptyAssetName
        let _ = assets::append_version_as_owner(
            &mut assets_book,
            &state,
            string::utf8(b""), // empty name
            false,
            0,
            extra_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(assets_book);
        ts::return_shared(clock_obj);
    };

    abort 100
}

// ───────────────────────────────────────────────────────────────────
// 2E  collection.move (1 error code)
// ───────────────────────────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::collection::EExtraRoyaltyTooHigh)]
fun extra_royalty_too_high_fails() {
    let mut scenario = ts::begin(@0xC0DE);
    ts::next_tx(&mut scenario, @0xC0DE);
    {
        let dummy_kiosk_id = object::id_from_address(@0x1);

        // extra_royalty_bps = 10_001 exceeds MAX_BPS => EExtraRoyaltyTooHigh
        let (coll, right) = collection::create(
            string::utf8(b"Bad Royalty Collection"),
            string::utf8(b"Extra royalty too high"),
            string::utf8(b"https://example.com/coll.png"),
            10_001, // exceeds 10_000
            true,
            @0xC0DE,
            dummy_kiosk_id,
            ts::ctx(&mut scenario),
        );

        collection::destroy_collection_for_testing(coll);
        collection::destroy_right_for_testing(right);
    };

    abort 100
}
// ═══════════════════════════════════════════════════════════════════
// ── Phase 3: market.move error-code tests ──────────────────────
// ═══════════════════════════════════════════════════════════════════
//
// Paste these functions into `soulidity::protocol_tests`.
// All imports already exist; only the test functions are provided.

// ── 1. EInvalidRecipient ────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EInvalidRecipient)]
fun update_fee_recipient_zero_fails() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);

        market::update_fee_recipient(&mut config, &admin_cap, @0x0);

        abort 100
    }
}

// ── 2. EInvalidPrice ────────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EInvalidPrice)]
fun list_soul_zero_price_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Price Test Soul"),
            string::utf8(b"Should fail on zero price"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // List with price = 0 → EInvalidPrice
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            0, // zero price
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ── 3. EPlatformFeeTooHigh ──────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EPlatformFeeTooHigh)]
fun platform_fee_too_high_fails() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);

        market::update_platform_fee_bps(&mut config, &admin_cap, 10_001);

        abort 100
    }
}

// ── 4. EInactiveListing (cancel twice) ──────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EInactiveListing)]
fun cancel_inactive_listing_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Cancel Test Soul"),
            string::utf8(b"Double cancel test"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // List the soul
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // First cancel — succeeds
    ts::next_tx(&mut scenario, creator);
    {
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut listing: SoulListing = ts::take_shared(&scenario);

        market::cancel_soul_listing(
            &mut creator_kiosk,
            &personal_cap,
            &mut listing,
        );

        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Second cancel — EInactiveListing
    ts::next_tx(&mut scenario, creator);
    {
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut listing: SoulListing = ts::take_shared(&scenario);

        market::cancel_soul_listing(
            &mut creator_kiosk,
            &personal_cap,
            &mut listing,
        );

        abort 100
    }
}

// ── 5. EListingKioskMismatch ────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EListingKioskMismatch)]
fun listing_kiosk_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let buyer_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, buyer);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Kiosk Mismatch Soul"),
            string::utf8(b"Cancel from wrong kiosk"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // List the soul from creator's kiosk
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Buyer tries to cancel listing using buyer's kiosk → EListingKioskMismatch
    ts::next_tx(&mut scenario, buyer);
    {
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let mut listing: SoulListing = ts::take_shared(&scenario);

        market::cancel_soul_listing(
            &mut buyer_kiosk,
            &buyer_cap,
            &mut listing,
        );

        abort 100
    }
}

// ── 6. EIncorrectPaymentAmount ──────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EIncorrectPaymentAmount)]
fun buy_soul_wrong_payment_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let buyer_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, buyer);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Payment Test Soul"),
            string::utf8(b"Wrong payment amount test"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // List the soul
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(state);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Mint wrong USDC amount to buyer (1 token instead of SOUL_PRICE + royalty)
    mint_usdc_to_recipient(&mut scenario, admin, buyer, 1);

    // Buyer tries to buy with wrong payment → EIncorrectPaymentAmount
    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let mut state: SoulState = ts::take_shared(&scenario);
        let mut listing: SoulListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_soul_fixed_price(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut state,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ── 7. EUnauthorizedKioskAccess ─────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EUnauthorizedKioskAccess)]
fun unauthorized_kiosk_access_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    let _buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, buyer);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Auth Test Soul"),
            string::utf8(b"Unauthorized access test"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Buyer tries to list from creator's kiosk using buyer's PersonalKioskCap
    // → has_access check fails → EUnauthorizedKioskAccess
    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &buyer_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ── 8. EQuoteOverflow ───────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EQuoteOverflow)]
fun quote_overflow_u64_max_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);

    // Set platform fee to non-zero so that price + fee overflows u64
    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);
        market::update_platform_fee_bps(&mut config, &admin_cap, 1); // 0.01%
        transfer::public_transfer(admin_cap, admin);
        ts::return_shared(config);
    };

    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    // Mint soul with very high creator_royalty_bps to help trigger overflow
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Overflow Soul"),
            string::utf8(b"Quote overflow test"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            5_000, // 50% creator royalty
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // List at u64::MAX → quote_soul_purchase overflow because
    // price + bps_amount(price, creator_royalty_bps) + bps_amount(price, platform_fee_bps) > MAX_U64
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state,
            soul_id,
            18446744073709551615, // u64::MAX
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ── 9. EPersonalKioskAlreadyInitialized ─────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EPersonalKioskAlreadyInitialized)]
fun double_personal_kiosk_init_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    // First init — succeeds
    let _kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Second init — EPersonalKioskAlreadyInitialized
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);

        let _ = market::init_personal_kiosk(&config, &mut registry, ts::ctx(&mut scenario));

        abort 100
    }
}

// ── 10. EPersonalKioskNotInitialized ────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EPersonalKioskNotInitialized)]
fun personal_kiosk_not_initialized_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    // Manually create a kiosk + personal cap without calling init_personal_kiosk
    // (so registry has no entry for creator)
    ts::next_tx(&mut scenario, creator);
    {
        let (mut kiosk_obj, owner_cap) = kiosk::new(ts::ctx(&mut scenario));
        let personal_cap = personal_kiosk::new(
            &mut kiosk_obj,
            owner_cap,
            ts::ctx(&mut scenario),
        );
        transfer::public_share_object(kiosk_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Try to reuse without registration → EPersonalKioskNotInitialized
    ts::next_tx(&mut scenario, creator);
    {
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);

        let _id = market::reuse_personal_kiosk(
            &registry,
            personal_cap,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ── 11. EPersonalKioskMismatch ──────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EPersonalKioskMismatch)]
fun personal_kiosk_mismatch_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Mismatch Soul"),
            string::utf8(b"Kiosk mismatch on list"),
            string::utf8(b"https://example.com/soul.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Update the registry to point to a brand new second kiosk
    // via ensure_personal_kiosk_registered (upsert), then try to
    // list_soul_fixed_price using the new cap against the old kiosk.
    // The state still records the old kiosk, so EPersonalKioskMismatch fires
    // from the assert `soul::current_kiosk_id(state) == object::id(kiosk_obj)`.
    ts::next_tx(&mut scenario, creator);
    {
        let (mut new_kiosk, new_owner_cap) = kiosk::new(ts::ctx(&mut scenario));
        let new_personal_cap = personal_kiosk::new(
            &mut new_kiosk,
            new_owner_cap,
            ts::ctx(&mut scenario),
        );
        transfer::public_share_object(new_kiosk);
        personal_kiosk::transfer_to_sender(new_personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        // Pick the new cap (the one just created)
        let new_personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        market::ensure_personal_kiosk_registered(
            &config,
            &mut registry,
            &new_personal_cap,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(config);
        ts::return_shared(registry);
        personal_kiosk::transfer_to_sender(new_personal_cap, ts::ctx(&mut scenario));
    };

    // Now try to list from the NEW kiosk — but state says soul is in the OLD kiosk
    // → EPersonalKioskMismatch
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let new_personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        // Take the NEW kiosk (not by id — by sender's latest shared kiosk)
        let new_kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(&new_personal_cap));
        let mut new_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, new_kiosk_id);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut new_kiosk,
            &new_personal_cap,
            &state,
            soul_id,
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ── 12. EStateMismatch ──────────────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EStateMismatch)]
fun state_mismatch_on_list_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let soul_id_a: ID;
    let soul_id_b: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs for 2 souls
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id_a = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul A"),
            string::utf8(b"First soul"),
            string::utf8(b"https://example.com/a.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Mint soul B
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        soul_id_b = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul B"),
            string::utf8(b"Second soul"),
            string::utf8(b"https://example.com/b.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Try to list soul_id_a but pass state_b → EStateMismatch
    // (soul::soul_id(state_b) != soul_id_a)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        // Take state for soul B (wrong state for soul A)
        let state_b: SoulState = ts::take_shared(&scenario);
        // Make sure we got state_b (not state_a) by checking soul_id
        assert!(soul::soul_id(&state_b) == soul_id_b, 0);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_soul_fixed_price(
            &config,
            &registry,
            &mut creator_kiosk,
            &personal_cap,
            &state_b,
            soul_id_a, // soul A id with state B
            SOUL_PRICE,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ── 13. ECombinedFeesTooHigh (via quote_soul_purchase) ──────────

#[test]
#[expected_failure(abort_code = soulidity::market::ECombinedFeesTooHigh)]
fun combined_fees_too_high_on_quote_fails() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    // Set platform fee to 9500 bps (95%)
    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);
        market::update_platform_fee_bps(&mut config, &admin_cap, 9_500);
        transfer::public_transfer(admin_cap, admin);
        ts::return_shared(config);
    };

    // Call quote_soul_purchase with creator_royalty_bps=1000 (10%)
    // combined = 9500 + 1000 + 0 = 10500 > 10000 → ECombinedFeesTooHigh
    ts::next_tx(&mut scenario, admin);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let (_, _, _, _, _) = market::quote_soul_purchase(
            &config,
            SOUL_PRICE,
            1_000, // creator royalty 10%
            0,     // no collection royalty
        );

        abort 100
    }
}

// ── 14. EAccessListStateMismatch ────────────────────────────────

#[test]
#[expected_failure(abort_code = soulidity::market::EAccessListStateMismatch)]
fun access_list_state_mismatch_on_purchase_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let access_list_a_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    // Mint 2 blobs for 2 souls
    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    // Mint soul A (with content access price)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul A"),
            string::utf8(b"Soul with content access"),
            string::utf8(b"https://example.com/a.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            string::utf8(b"default"),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(clock_obj);
        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Capture soul A's access_list_id (only one SoulState exists at this point)
    ts::next_tx(&mut scenario, creator);
    {
        let state_a: SoulState = ts::take_shared(&scenario);
        access_list_a_id = *soul::access_list_id(&state_a).borrow();
        ts::return_shared(state_a);
    };

    // Mint soul B (with content access price)
    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Soul B"),
            string::utf8(b"Another soul with content access"),
            string::utf8(b"https://example.com/b.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            string::utf8(b"default"),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(clock_obj);
        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    // Mint USDC to buyer for content access purchase
    mint_usdc_to_recipient(&mut scenario, admin, buyer, CONTENT_ACCESS_PRICE);

    // Find soul B's state_id — take both states, identify the one that does NOT
    // own access_list_a, that is state_b.
    let state_b_id: ID;
    ts::next_tx(&mut scenario, buyer);
    {
        let state_x: SoulState = ts::take_shared(&scenario);
        let state_y: SoulState = ts::take_shared(&scenario);
        let al_x = soul::access_list_id(&state_x);
        state_b_id = if (al_x.contains(&access_list_a_id)) {
            object::id(&state_y) // state_x is soul A, so state_y is soul B
        } else {
            object::id(&state_x) // state_x is soul B
        };
        ts::return_shared(state_x);
        ts::return_shared(state_y);
    };

    // Buyer tries purchase_content_access with access_list from soul A
    // + state from soul B → EAccessListStateMismatch
    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        let state_b: SoulState = ts::take_shared_by_id(&scenario, state_b_id);
        let mut access_list_a: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_a_id);

        market::purchase_content_access(
            &config,
            &mut access_list_a,
            &state_b,
            payment,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

// ═══════════════════════════════════════════════════════════════════
// ── Phase 4: Protocol init verification ─────────────────────────
// ═══════════════════════════════════════════════════════════════════

#[test]
#[expected_failure(abort_code = soulidity::content_access::EAlreadyHasAccess)]
fun content_access_repeat_purchase_same_tx_fails_after_state_update() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Repeat Purchase Soul"),
            string::utf8(b"Exercise purchase_content_access twice in one tx"),
            string::utf8(b"https://example.com/repeat-purchase.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS_AND_ASSETS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(&mut scenario, admin, buyer, CONTENT_ACCESS_PRICE);
    mint_usdc_to_recipient(&mut scenario, admin, buyer, CONTENT_ACCESS_PRICE);

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let first_payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);
        let second_payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::purchase_content_access(
            &config,
            &mut access_list,
            &state,
            first_payment,
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        market::purchase_content_access(
            &config,
            &mut access_list,
            &state,
            second_payment,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
fun market_upgrade_state_tracks_full_lifecycle() {
    let admin = @0xA11CE;
    let initial_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(initial_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let mut upgrade_cap: package::UpgradeCap = ts::take_from_sender(&scenario);

        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &upgrade_cap);
        assert!(market::has_tracked_upgrade_cap(&upgrade_state), 0);
        assert!(market::upgrade_cap_live(&upgrade_state), 1);
        assert!(market::upgrades_immutable(&upgrade_state) == false, 2);
        assert!(market::upgrade_pending(&upgrade_state) == false, 3);
        assert!(market::tracked_upgrade_version(&upgrade_state) == 1, 4);
        assert!(market::tracked_upgrade_policy(&upgrade_state) == package::compatible_policy(), 5);
        assert!(market::tracked_package_id(&upgrade_state).contains(&initial_package), 6);

        market::restrict_upgrade_policy_additive(&mut upgrade_state, &admin_cap, &mut upgrade_cap);
        assert!(market::tracked_upgrade_policy(&upgrade_state) == package::additive_policy(), 7);

        let ticket = market::authorize_upgrade(
            &mut upgrade_state,
            &admin_cap,
            &mut upgrade_cap,
            package::dep_only_policy(),
            sui::hash::blake2b256(&b"soulidity-upgrade"),
        );
        assert!(market::upgrade_pending(&upgrade_state), 8);
        assert!(package::ticket_policy(&ticket) == package::dep_only_policy(), 9);

        let receipt = package::test_upgrade(ticket);
        market::commit_upgrade(&mut upgrade_state, &admin_cap, &mut upgrade_cap, receipt);
        assert!(market::upgrade_pending(&upgrade_state) == false, 10);
        assert!(market::tracked_upgrade_version(&upgrade_state) == 2, 11);
        assert!(market::tracked_package_id(&upgrade_state).contains(&initial_package) == false, 12);
        assert!(market::upgrade_cap_live(&upgrade_state), 13);

        market::freeze_upgrades(&mut upgrade_state, &admin_cap, upgrade_cap);
        assert!(market::upgrades_immutable(&upgrade_state), 14);
        assert!(market::upgrade_cap_live(&upgrade_state) == false, 15);
        assert!(market::upgrade_pending(&upgrade_state) == false, 16);

        ts::return_to_sender(&scenario, admin_cap);
        ts::return_shared(upgrade_state);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::market::EUpgradeCapMismatch)]
fun market_upgrade_rejects_untracked_cap() {
    let admin = @0xA11CE;
    let tracked_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(tracked_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let tracked_cap: package::UpgradeCap = ts::take_from_sender(&scenario);
        let mut wrong_cap = package::test_publish(@0x43.to_id(), ts::ctx(&mut scenario));

        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &tracked_cap);
        let _ticket = market::authorize_upgrade(
            &mut upgrade_state,
            &admin_cap,
            &mut wrong_cap,
            package::compatible_policy(),
            sui::hash::blake2b256(&b"wrong-upgrade-cap"),
        );

        abort 100
    }
}

#[test]
fun content_access_expired_purchase_renews_and_skill_allowlist_succeeds() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Renewable Access Soul"),
            string::utf8(b"Renewal path for content access purchase"),
            string::utf8(b"https://example.com/renew-access.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(initial_skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let clock_obj: Clock = ts::take_shared(&scenario);

        assert!(content_access::soul_id(&access_list) == soul::soul_id(&state), 0);
        assert!(content_access::creator(&access_list) == creator, 1);
        assert!(content_access::price_atomic(&access_list) == CONTENT_ACCESS_PRICE, 2);

        content_access::add_access(
            &mut access_list,
            &state,
            buyer,
            SCOPE_SKILLS,
            option::some(100),
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut clock_obj: Clock = ts::take_shared(&scenario);
        clock::set_for_testing(&mut clock_obj, 101);
        ts::return_shared(clock_obj);
    };

    mint_usdc_to_recipient(&mut scenario, admin, buyer, CONTENT_ACCESS_PRICE);

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let skills_id = *soul::skills_id(&state).borrow();
        let skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        assert!(content_access::has_access(&access_list, buyer, SCOPE_SKILLS, &clock_obj) == false, 3);

        market::purchase_content_access(
            &config,
            &mut access_list,
            &state,
            payment,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(content_access::has_access(&access_list, buyer, SCOPE_SKILLS, &clock_obj), 4);
        assert!(content_access::entry_count(&access_list) == 1, 5);

        content_access::seal_approve_skill_allowlisted(
            skill_document_id(skills_id, default_skill_name(), 0),
            &state,
            &access_list,
            &skills_book,
            default_skill_name(),
            0,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(skills_book);
        ts::return_shared(clock_obj);
    };

    ts::end(scenario);
}

#[test]
fun skills_granted_agent_append_seal_delete_and_getters_work() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_three_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            agent,
            BLOB_ROOT_HASH_C,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_skill_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Skill Grant Soul"),
            string::utf8(b"Granted agent skill lifecycle"),
            string::utf8(b"https://example.com/skill-grant.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::some(initial_skill_blob),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant = grant::issue(
            &mut state,
            agent,
            grant::scope_skills(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let mut clock_obj: Clock = ts::take_shared(&scenario);
        clock::set_for_testing(&mut clock_obj, 777);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let skills_id = *soul::skills_id(&state).borrow();
        let mut skills_book: SoulSkills = ts::take_shared_by_id(&scenario, skills_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);
        let agent_blob: blob::Blob = ts::take_from_sender(&scenario);

        assert!(skills::soul_id(&skills_book) == soul::soul_id(&state), 0);
        assert!(skills::skills_id(&skills_book) == skills_id, 1);
        assert!(skills::contains_skill(&skills_book, default_skill_name()), 2);
        assert!(grant::scope_mask(&soul_grant) == grant::scope_skills(), 3);
        assert!(grant::has_scope(&soul_grant, grant::scope_skills()), 4);
        assert!(grant::has_scope(&soul_grant, grant::scope_assets()) == false, 5);

        let version_index = skills::append_version_as_granted_agent(
            &mut skills_book,
            &state,
            &soul_grant,
            default_skill_name(),
            true,
            agent_blob,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(version_index == 1, 6);
        assert!(skills::version_count(&skills_book, default_skill_name()) == 2, 7);
        assert!(skills::version_is_public(&skills_book, default_skill_name(), 1), 8);
        assert!(skills::version_created_at_ms(&skills_book, default_skill_name(), 1) == 777, 9);

        skills::seal_approve_private_read_as_granted_agent_for_testing(
            skill_document_id(skills_id, default_skill_name(), 1),
            &state,
            &skills_book,
            default_skill_name(),
            1,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        skills::delete_version_as_granted_agent(
            &mut skills_book,
            &state,
            default_skill_name(),
            1,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(skills::version_is_deleted(&skills_book, default_skill_name(), 1), 10);

        ts::return_shared(state);
        ts::return_shared(skills_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    ts::end(scenario);
}

#[test]
fun assets_granted_agent_delete_and_getters_work() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let initial_asset_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Asset Grant Soul"),
            string::utf8(b"Granted agent asset delete"),
            string::utf8(b"https://example.com/asset-grant.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::some(initial_asset_blob),
            default_asset_name(),
            false,
            2,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant = grant::issue(
            &mut state,
            agent,
            grant::scope_assets(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let assets_id = *soul::assets_id(&state).borrow();
        let mut assets_book: SoulAssets = ts::take_shared_by_id(&scenario, assets_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);

        assert!(assets::soul_id(&assets_book) == soul::soul_id(&state), 0);
        assert!(assets::assets_id(&assets_book) == assets_id, 1);
        assert!(assets::contains_asset(&assets_book, default_asset_name()), 2);
        assert!(assets::version_asset_type(&assets_book, default_asset_name(), 0) == 2, 3);
        assert!(assets::version_is_deleted(&assets_book, default_asset_name(), 0) == false, 4);
        assert!(grant::has_scope(&soul_grant, grant::scope_assets()), 5);

        assets::delete_version_as_granted_agent(
            &mut assets_book,
            &state,
            default_asset_name(),
            0,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(assets::version_is_deleted(&assets_book, default_asset_name(), 0), 6);

        ts::return_shared(state);
        ts::return_shared(assets_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    ts::end(scenario);
}

#[test]
fun market_quote_helpers_and_admin_updates_work() {
    let admin = @0xA11CE;
    let fee_recipient = @0xFEE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);

        market::update_fee_recipient(&mut config, &admin_cap, fee_recipient);
        market::update_platform_fee_bps(&mut config, &admin_cap, 500);
        market::update_paused(&mut config, &admin_cap, true);
        assert!(market::paused(&config), 0);
        market::update_paused(&mut config, &admin_cap, false);

        let (collection_fee, collection_price, collection_total) =
            market::quote_collection_purchase(&config, COLLECTION_PRICE);
        let (access_fee, access_price, access_total) =
            market::quote_content_access_purchase(&config, CONTENT_ACCESS_PRICE);

        assert!(market::fee_recipient(&config) == fee_recipient, 1);
        assert!(market::platform_fee_bps(&config) == 500, 2);
        assert!(market::paused(&config) == false, 3);
        assert!(collection_fee == 15_000, 4);
        assert!(collection_price == COLLECTION_PRICE, 5);
        assert!(collection_total == 315_000, 6);
        assert!(access_fee == 50_000, 7);
        assert!(access_price == CONTENT_ACCESS_PRICE, 8);
        assert!(access_total == 1_050_000, 9);

        ts::return_to_sender(&scenario, admin_cap);
        ts::return_shared(config);
    };

    ts::end(scenario);
}

#[test]
fun register_existing_personal_kiosk_allows_reuse() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, creator);
    {
        let (mut kiosk_obj, owner_cap) = kiosk::new(ts::ctx(&mut scenario));
        kiosk_id = object::id(&kiosk_obj);
        let personal_cap = personal_kiosk::new(&mut kiosk_obj, owner_cap, ts::ctx(&mut scenario));

        transfer::public_share_object(kiosk_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);

        market::register_existing_personal_kiosk(
            &config,
            &mut registry,
            &personal_cap,
            ts::ctx(&mut scenario),
        );

        let reused_kiosk_id = market::reuse_personal_kiosk(
            &registry,
            personal_cap,
            ts::ctx(&mut scenario),
        );

        assert!(reused_kiosk_id == kiosk_id, 0);
        ts::return_shared(config);
        ts::return_shared(registry);
    };

    ts::end(scenario);
}

#[test]
fun cancelled_collection_listing_can_be_relisted() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _collection_id = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Relistable Collection"),
            string::utf8(b"Collection right can be relisted after cancel"),
            string::utf8(b"https://example.com/relist-collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&collection_obj),
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut listing: CollectionListing = ts::take_shared(&scenario);

        market::cancel_collection_listing(
            &mut creator_kiosk,
            &personal_cap,
            &mut listing,
        );

        ts::return_shared(creator_kiosk);
        ts::return_shared(listing);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _listing_id = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&collection_obj),
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::market::EUpgradesImmutable)]
fun market_upgrade_dep_only_policy_and_freeze_block_followup() {
    let admin = @0xA11CE;
    let initial_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(initial_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let mut upgrade_cap: package::UpgradeCap = ts::take_from_sender(&scenario);

        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &upgrade_cap);
        market::restrict_upgrade_policy_dep_only(&mut upgrade_state, &admin_cap, &mut upgrade_cap);
        assert!(market::tracked_upgrade_policy(&upgrade_state) == package::dep_only_policy(), 0);

        market::freeze_upgrades(&mut upgrade_state, &admin_cap, upgrade_cap);
        assert!(market::upgrades_immutable(&upgrade_state), 1);

        let next_cap = package::test_publish(@0x43.to_id(), ts::ctx(&mut scenario));
        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &next_cap);

        abort 100
    }
}

#[test]
fun market_upgrade_dep_only_policy_tracks_state() {
    let admin = @0xA11CE;
    let initial_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(initial_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let mut upgrade_cap: package::UpgradeCap = ts::take_from_sender(&scenario);

        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &upgrade_cap);
        market::restrict_upgrade_policy_dep_only(&mut upgrade_state, &admin_cap, &mut upgrade_cap);

        assert!(market::tracked_upgrade_policy(&upgrade_state) == package::dep_only_policy(), 0);
        assert!(market::tracked_upgrade_version(&upgrade_state) == 1, 1);
        assert!(market::upgrade_pending(&upgrade_state) == false, 2);

        transfer::public_transfer(upgrade_cap, admin);
        ts::return_to_sender(&scenario, admin_cap);
        ts::return_shared(upgrade_state);
    };

    ts::end(scenario);
}

#[test]
#[expected_failure(abort_code = soulidity::market::EUpgradeCapNotTracked)]
fun market_upgrade_dep_only_without_tracking_fails() {
    let admin = @0xA11CE;
    let initial_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(initial_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let mut upgrade_cap: package::UpgradeCap = ts::take_from_sender(&scenario);

        market::restrict_upgrade_policy_dep_only(&mut upgrade_state, &admin_cap, &mut upgrade_cap);

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::EUpgradeAlreadyPending)]
fun market_upgrade_authorize_while_pending_fails() {
    let admin = @0xA11CE;
    let initial_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(initial_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let mut upgrade_cap: package::UpgradeCap = ts::take_from_sender(&scenario);

        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &upgrade_cap);
        let _first_ticket = market::authorize_upgrade(
            &mut upgrade_state,
            &admin_cap,
            &mut upgrade_cap,
            package::compatible_policy(),
            sui::hash::blake2b256(&b"pending-upgrade-a"),
        );
        let _second_ticket = market::authorize_upgrade(
            &mut upgrade_state,
            &admin_cap,
            &mut upgrade_cap,
            package::compatible_policy(),
            sui::hash::blake2b256(&b"pending-upgrade-b"),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::EUpgradeAlreadyPending)]
fun market_upgrade_track_while_pending_fails() {
    let admin = @0xA11CE;
    let initial_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(initial_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let mut upgrade_cap: package::UpgradeCap = ts::take_from_sender(&scenario);

        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &upgrade_cap);
        let _ticket = market::authorize_upgrade(
            &mut upgrade_state,
            &admin_cap,
            &mut upgrade_cap,
            package::compatible_policy(),
            sui::hash::blake2b256(&b"pending-upgrade"),
        );
        // Attempting to re-track while a ticket is outstanding must abort
        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &upgrade_cap);

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::EUpgradeCapNotTracked)]
fun market_upgrade_authorize_without_tracking_fails() {
    let admin = @0xA11CE;
    let initial_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(initial_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let mut upgrade_cap: package::UpgradeCap = ts::take_from_sender(&scenario);

        let _ticket = market::authorize_upgrade(
            &mut upgrade_state,
            &admin_cap,
            &mut upgrade_cap,
            package::compatible_policy(),
            sui::hash::blake2b256(&b"authorize-without-tracking"),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::EUpgradeNotPending)]
fun market_upgrade_commit_without_pending_fails() {
    let admin = @0xA11CE;
    let initial_package = @0x42.to_id();
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, admin);
    {
        let upgrade_cap = package::test_publish(initial_package, ts::ctx(&mut scenario));
        transfer::public_transfer(upgrade_cap, admin);
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let mut upgrade_cap: package::UpgradeCap = ts::take_from_sender(&scenario);

        market::track_upgrade_cap(&mut upgrade_state, &admin_cap, &upgrade_cap);
        let ticket = package::authorize_upgrade(
            &mut upgrade_cap,
            package::compatible_policy(),
            sui::hash::blake2b256(&b"commit-without-pending"),
        );
        let receipt = package::test_upgrade(ticket);
        market::commit_upgrade(&mut upgrade_state, &admin_cap, &mut upgrade_cap, receipt);

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::EInvalidPrice)]
fun list_collection_right_zero_price_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Zero Price Collection"),
            string::utf8(b"Listing with zero price should fail"),
            string::utf8(b"https://example.com/zero-price-collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&collection_obj),
            0,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::EIncorrectPaymentAmount)]
fun buy_collection_right_wrong_payment_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let buyer_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, buyer);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Wrong Payment Collection"),
            string::utf8(b"Collection purchase wrong payment should fail"),
            string::utf8(b"https://example.com/wrong-payment-collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&collection_obj),
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(&mut scenario, admin, buyer, COLLECTION_PRICE - 1);

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let mut collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut listing: CollectionListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_collection_right_fixed_price(
            &config,
            &registry,
            &collection_policy,
            &mut collection_obj,
            &mut creator_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::EMarketPaused)]
fun register_existing_personal_kiosk_paused_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    ts::next_tx(&mut scenario, creator);
    {
        let (mut kiosk_obj, owner_cap) = kiosk::new(ts::ctx(&mut scenario));
        let personal_cap = personal_kiosk::new(&mut kiosk_obj, owner_cap, ts::ctx(&mut scenario));

        transfer::public_share_object(kiosk_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);

        market::update_paused(&mut config, &admin_cap, true);

        ts::return_to_sender(&scenario, admin_cap);
        ts::return_shared(config);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let mut registry: KioskRegistry = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);

        market::register_existing_personal_kiosk(
            &config,
            &mut registry,
            &personal_cap,
            ts::ctx(&mut scenario),
        );

        abort 100
    }
}

#[test]
#[expected_failure(abort_code = soulidity::market::EInactiveListing)]
fun cancel_collection_listing_inactive_fails() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Cancel Twice Collection"),
            string::utf8(b"Second cancel should fail"),
            string::utf8(b"https://example.com/cancel-twice-collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&collection_obj),
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut listing: CollectionListing = ts::take_shared(&scenario);

        market::cancel_collection_listing(&mut creator_kiosk, &personal_cap, &mut listing);

        ts::return_shared(creator_kiosk);
        ts::return_shared(listing);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut listing: CollectionListing = ts::take_shared(&scenario);

        market::cancel_collection_listing(&mut creator_kiosk, &personal_cap, &mut listing);

        abort 100
    }
}

#[test]
fun collection_purchase_with_platform_fee_branch_works() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;
    let buyer_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);
    buyer_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, buyer);

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);

        market::update_platform_fee_bps(&mut config, &admin_cap, 500);

        ts::return_to_sender(&scenario, admin_cap);
        ts::return_shared(config);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::create_collection_in_personal_kiosk(
            &config,
            &registry,
            &collection_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Fee Split Collection"),
            string::utf8(b"Collection purchase exercises platform fee split"),
            string::utf8(b"https://example.com/fee-split-collection.png"),
            COLLECTION_ROYALTY_BPS,
            true,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_obj: SoulCollection = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);

        let _ = market::list_collection_right_fixed_price(
            &config,
            &registry,
            &collection_obj,
            &mut creator_kiosk,
            &personal_cap,
            collection::right_id(&collection_obj),
            COLLECTION_PRICE,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_obj);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(&mut scenario, admin, buyer, 315_000);

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let collection_policy: TransferPolicy<SoulCollectionRight> = ts::take_shared(&scenario);
        let mut collection_obj: SoulCollection = ts::take_shared(&scenario);
        let mut listing: CollectionListing = ts::take_shared(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let mut buyer_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, buyer_kiosk_id);
        let buyer_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::buy_collection_right_fixed_price(
            &config,
            &registry,
            &collection_policy,
            &mut collection_obj,
            &mut creator_kiosk,
            &mut buyer_kiosk,
            &buyer_cap,
            &mut listing,
            payment,
            ts::ctx(&mut scenario),
        );

        assert!(collection::current_holder(&collection_obj) == buyer, 0);
        assert!(collection::current_holder_kiosk_id(&collection_obj) == buyer_kiosk_id, 1);

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(collection_policy);
        ts::return_shared(collection_obj);
        ts::return_shared(listing);
        ts::return_shared(creator_kiosk);
        ts::return_shared(buyer_kiosk);
        personal_kiosk::transfer_to_sender(buyer_cap, ts::ctx(&mut scenario));
    };

    ts::end(scenario);
}

#[test]
fun grant_owner_rotation_invalidation_clears_active_slots() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let first_agent = @0xA63E;
    let second_agent = @0xBEEF;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _soul_id = mint_native_in_personal_kiosk_no_skills(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Grant Invalidate Soul"),
            string::utf8(b"Invalidate all active grants"),
            string::utf8(b"https://example.com/grant-invalidate.png"),
            option::none(),
            protected_blob,
            option::none(),
            CREATOR_ROYALTY_BPS,
            &mut scenario,
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        grant::set_grant_capacity(&mut state, 2, &clock_obj, ts::ctx(&mut scenario));
        let first_grant = grant::issue(
            &mut state,
            first_agent,
            grant::scope_seal() | grant::scope_memory(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        let second_grant = grant::issue(
            &mut state,
            second_agent,
            grant::scope_assets(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(clock_obj);

        assert!(grant::scope_mask(&first_grant) == (grant::scope_seal() | grant::scope_memory()), 0);
        assert!(grant::has_scope(&first_grant, grant::scope_memory()), 1);
        assert!(grant::has_scope(&second_grant, grant::scope_assets()), 2);
        assert!(soul::active_grant_count(&state) == 2, 3);

        grant::invalidate_all_for_owner_rotation(&mut state, @0xD00D, creator);

        assert!(soul::active_grant_count(&state) == 0, 4);
        assert!(has_active_grantee(&state, first_agent) == false, 5);
        assert!(has_active_grantee(&state, second_agent) == false, 6);

        grant::destroy_for_testing(first_grant);
        grant::destroy_for_testing(second_grant);
        ts::return_shared(state);
    };

    ts::end(scenario);
}

#[test]
fun seal_policy_memory_granted_agent_uses_timestamp_key() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let agent = @0xA63E;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blobs_to_recipients(
            creator,
            BLOB_ROOT_HASH_A,
            creator,
            BLOB_ROOT_HASH_B,
            ts::ctx(&mut scenario),
        );
        let mut clock_obj: Clock = ts::take_shared(&scenario);
        clock::set_for_testing(&mut clock_obj, 777);
        ts::return_shared(clock_obj);
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);
        let founding_memory_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Memory Grant Seal Soul"),
            string::utf8(b"Granted memory seal approval"),
            string::utf8(b"https://example.com/memory-grant-seal.png"),
            option::none(),
            protected_blob,
            option::some(founding_memory_blob),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            string::utf8(b"default"),
            false,
            0,
            0,
            0,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let mut state: SoulState = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant = grant::issue(
            &mut state,
            agent,
            grant::scope_memory(),
            option::none(),
            &clock_obj,
            ts::ctx(&mut scenario),
        );
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
        ts::return_shared(state);
    };

    ts::next_tx(&mut scenario, agent);
    {
        let state: SoulState = ts::take_shared(&scenario);
        let memory_book: SoulMemory = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let soul_grant: SoulGrant = ts::take_from_sender(&scenario);

        seal_policy::seal_approve_memory_granted_agent_for_testing(
            memory_document_id(object::id(&memory_book), 777),
            &state,
            &memory_book,
            777,
            &soul_grant,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(state);
        ts::return_shared(memory_book);
        ts::return_shared(clock_obj);
        transfer::public_transfer(soul_grant, agent);
    };

    ts::end(scenario);
}

#[test]
fun content_access_purchase_with_platform_fee_branch_works() {
    let admin = @0xA11CE;
    let creator = @0xC0DE;
    let buyer = @0xB0B;
    let mut scenario = ts::begin(@0x0);
    let creator_kiosk_id: ID;

    init_protocol_for_testing(&mut scenario, admin);
    creator_kiosk_id = init_personal_kiosk_for_sender(&mut scenario, creator);

    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let mut config: MarketConfig = ts::take_shared(&scenario);
        market::update_platform_fee_bps(&mut config, &admin_cap, 500);
        ts::return_to_sender(&scenario, admin_cap);
        ts::return_shared(config);
    };

    ts::next_tx(&mut scenario, admin);
    {
        mint_test_blob_to_recipient(creator, BLOB_ROOT_HASH_A, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, creator);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let personal_cap: PersonalKioskCap = ts::take_from_sender(&scenario);
        let mut creator_kiosk = ts::take_shared_by_id<Kiosk>(&scenario, creator_kiosk_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let protected_blob: blob::Blob = ts::take_from_sender(&scenario);

        let _ = market::mint_native_in_personal_kiosk(
            &config,
            &registry,
            &soul_policy,
            &mut creator_kiosk,
            &personal_cap,
            string::utf8(b"Fee Split Access Soul"),
            string::utf8(b"Exercise platform fee split on content access"),
            string::utf8(b"https://example.com/fee-split-access.png"),
            option::none(),
            protected_blob,
            option::none(),
            option::none(),
            default_skill_name(),
            false,
            option::none(),
            default_asset_name(),
            false,
            0,
            CONTENT_ACCESS_PRICE,
            SCOPE_SKILLS,
            CREATOR_ROYALTY_BPS,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(soul_policy);
        ts::return_shared(creator_kiosk);
        ts::return_shared(clock_obj);
        personal_kiosk::transfer_to_sender(personal_cap, ts::ctx(&mut scenario));
    };

    mint_usdc_to_recipient(&mut scenario, admin, buyer, 1_050_000);

    ts::next_tx(&mut scenario, buyer);
    {
        let config: MarketConfig = ts::take_shared(&scenario);
        let state: SoulState = ts::take_shared(&scenario);
        let access_list_id = *soul::access_list_id(&state).borrow();
        let mut access_list: ContentAccessList = ts::take_shared_by_id(&scenario, access_list_id);
        let clock_obj: Clock = ts::take_shared(&scenario);
        let payment: coin::Coin<USDC> = ts::take_from_sender(&scenario);

        market::purchase_content_access(
            &config,
            &mut access_list,
            &state,
            payment,
            &clock_obj,
            ts::ctx(&mut scenario),
        );

        assert!(content_access::has_access(&access_list, buyer, SCOPE_SKILLS, &clock_obj), 0);
        ts::return_shared(config);
        ts::return_shared(state);
        ts::return_shared(access_list);
        ts::return_shared(clock_obj);
    };

    ts::end(scenario);
}

#[test]
fun protocol_init_creates_all_expected_objects() {
    let admin = @0xA11CE;
    let mut scenario = ts::begin(@0x0);

    init_protocol_for_testing(&mut scenario, admin);

    // Verify MarketAdminCap is owned by admin
    ts::next_tx(&mut scenario, admin);
    {
        let admin_cap: market::MarketAdminCap = ts::take_from_sender(&scenario);
        let config: MarketConfig = ts::take_shared(&scenario);
        let registry: KioskRegistry = ts::take_shared(&scenario);
        let upgrade_state: MarketUpgradeState = ts::take_shared(&scenario);
        let soul_policy: TransferPolicy<Soul> = ts::take_shared(&scenario);
        let clock_obj: Clock = ts::take_shared(&scenario);

        // MarketConfig defaults
        assert!(market::fee_recipient(&config) == admin, 0);
        assert!(market::platform_fee_bps(&config) == 0, 1);
        assert!(market::paused(&config) == false, 2);
        assert!(market::has_tracked_upgrade_cap(&upgrade_state) == false, 3);
        assert!(market::tracked_upgrade_version(&upgrade_state) == 0, 4);
        assert!(market::tracked_upgrade_policy(&upgrade_state) == package::compatible_policy(), 5);
        assert!(market::upgrade_cap_live(&upgrade_state) == false, 6);
        assert!(market::upgrades_immutable(&upgrade_state) == false, 7);
        assert!(market::upgrade_pending(&upgrade_state) == false, 8);

        ts::return_to_sender(&scenario, admin_cap);
        ts::return_shared(config);
        ts::return_shared(registry);
        ts::return_shared(upgrade_state);
        ts::return_shared(soul_policy);
        ts::return_shared(clock_obj);
    };

    ts::end(scenario);
}
