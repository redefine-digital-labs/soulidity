module soulidity::assets;

use std::string::{Self as string, String};
use sui::clock::Clock;
use sui::dynamic_object_field as dof;
use sui::event;
use sui::table;
use soulidity::grant::{Self as grant, SoulGrant};
use soulidity::soul::{Self as soul, SoulState};
use walrus::blob::{Self as blob, Blob};

const EAssetsMismatch: u64 = 1;
const EAssetNotFound: u64 = 2;
const EVersionOutOfBounds: u64 = 3;
const EAssetVersionDeleted: u64 = 4;
const EEmptyAssetName: u64 = 5;

const DOCUMENT_ID_VERSION: u8 = 1;
const DOCUMENT_ID_NONCE_BYTES: u64 = 16;

// ── Asset type constants ──
const ASSET_TYPE_SPRITE: u8 = 0;
const ASSET_TYPE_LIVE2D: u8 = 1;
const ASSET_TYPE_AUDIO: u8 = 2;

// ── Structs ──

public struct AssetSlot has copy, drop, store {
    blob_object_id: ID,
    is_public: bool,
    deleted: bool,
    asset_type: u8,
    created_at_ms: u64,
}

public struct SoulAssets has key {
    id: UID,
    soul_id: ID,
    assets: table::Table<String, vector<AssetSlot>>,
    asset_count: u64,
}

public struct AssetBlobKey has copy, drop, store {
    asset_name: String,
    version_index: u64,
}

// ── Events ──

public struct SoulAssetsCreated has copy, drop {
    assets_id: ID,
    soul_id: ID,
}

public struct AssetVersionAppended has copy, drop {
    assets_id: ID,
    soul_id: ID,
    asset_name: String,
    version_index: u64,
    is_public: bool,
    asset_type: u8,
    created_at_ms: u64,
    blob_object_id: ID,
}

public struct AssetVersionDeleted has copy, drop {
    assets_id: ID,
    soul_id: ID,
    asset_name: String,
    version_index: u64,
    deleted_by: address,
}

// ── Getters ──

public fun soul_id(self: &SoulAssets): ID { self.soul_id }
public fun assets_id(self: &SoulAssets): ID { object::id(self) }
public fun asset_count(self: &SoulAssets): u64 { self.asset_count }

public fun contains_asset(self: &SoulAssets, asset_name: String): bool {
    self.assets.contains(asset_name)
}

public fun version_count(self: &SoulAssets, asset_name: String): u64 {
    if (!table::contains(&self.assets, copy asset_name)) {
        return 0
    };
    table::borrow(&self.assets, asset_name).length()
}

public fun blob_object_id_for(self: &SoulAssets, asset_name: String, version_index: u64): ID {
    borrow_slot(self, asset_name, version_index).blob_object_id
}

public fun version_is_public(self: &SoulAssets, asset_name: String, version_index: u64): bool {
    borrow_slot(self, asset_name, version_index).is_public
}

public fun version_is_deleted(self: &SoulAssets, asset_name: String, version_index: u64): bool {
    borrow_slot(self, asset_name, version_index).deleted
}

public fun version_asset_type(self: &SoulAssets, asset_name: String, version_index: u64): u8 {
    borrow_slot(self, asset_name, version_index).asset_type
}

public fun version_created_at_ms(self: &SoulAssets, asset_name: String, version_index: u64): u64 {
    borrow_slot(self, asset_name, version_index).created_at_ms
}

// ── Creation ──

public(package) fun create(soul_id: ID, ctx: &mut TxContext): SoulAssets {
    let assets = SoulAssets {
        id: object::new(ctx),
        soul_id,
        assets: table::new(ctx),
        asset_count: 0,
    };

    event::emit(SoulAssetsCreated {
        assets_id: object::id(&assets),
        soul_id,
    });

    assets
}

public(package) fun share_assets(assets: SoulAssets) {
    transfer::share_object(assets);
}

public(package) fun append_initial_version(
    assets: &mut SoulAssets,
    asset_name: String,
    is_public: bool,
    asset_type: u8,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    append_version_impl(assets, asset_name, is_public, asset_type, content_blob, clock, ctx)
}

// ── Write as owner ──

public fun append_version_as_owner(
    assets: &mut SoulAssets,
    state: &SoulState,
    asset_name: String,
    is_public: bool,
    asset_type: u8,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    assert_assets_matches_state(assets, state);
    soul::assert_owner(state, ctx.sender());
    append_version_impl(assets, asset_name, is_public, asset_type, content_blob, clock, ctx)
}

// ── Write as granted agent ──

public fun append_version_as_granted_agent(
    assets: &mut SoulAssets,
    state: &SoulState,
    soul_grant: &SoulGrant,
    asset_name: String,
    is_public: bool,
    asset_type: u8,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): u64 {
    assert_assets_matches_state(assets, state);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_assets(), clock, ctx);
    append_version_impl(assets, asset_name, is_public, asset_type, content_blob, clock, ctx)
}

// ── Delete ──

public fun delete_version_as_owner(
    assets: &mut SoulAssets,
    state: &SoulState,
    asset_name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    assert_assets_matches_state(assets, state);
    soul::assert_owner(state, ctx.sender());
    let slot = borrow_slot_mut(assets, copy asset_name, version_index);
    assert!(!slot.deleted, EAssetVersionDeleted);
    slot.deleted = true;
    event::emit(AssetVersionDeleted {
        assets_id: object::id(assets),
        soul_id: assets.soul_id,
        asset_name,
        version_index,
        deleted_by: ctx.sender(),
    });
}

public fun delete_version_as_granted_agent(
    assets: &mut SoulAssets,
    state: &SoulState,
    asset_name: String,
    version_index: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_assets_matches_state(assets, state);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_assets(), clock, ctx);
    let slot = borrow_slot_mut(assets, copy asset_name, version_index);
    assert!(!slot.deleted, EAssetVersionDeleted);
    slot.deleted = true;
    event::emit(AssetVersionDeleted {
        assets_id: object::id(assets),
        soul_id: assets.soul_id,
        asset_name,
        version_index,
        deleted_by: ctx.sender(),
    });
}

// ── Seal approval (private reads) ──

entry fun seal_approve_asset_read_owner(
    id: vector<u8>,
    state: &SoulState,
    assets: &SoulAssets,
    asset_name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, object::id(assets), copy asset_name, version_index);
    soul::assert_owner(state, ctx.sender());
    assert_assets_matches_state(assets, state);
    let slot = borrow_slot(assets, asset_name, version_index);
    assert!(!slot.deleted, EAssetVersionDeleted);
}

entry fun seal_approve_asset_read_granted_agent(
    id: vector<u8>,
    state: &SoulState,
    assets: &SoulAssets,
    asset_name: String,
    version_index: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_matching_document_id(id, object::id(assets), copy asset_name, version_index);
    assert_assets_matches_state(assets, state);
    let slot = borrow_slot(assets, asset_name, version_index);
    assert!(!slot.deleted, EAssetVersionDeleted);
    grant::assert_active_with_scope(state, soul_grant, grant::scope_assets(), clock, ctx);
}

// ── Internal helpers ──

fun assert_assets_matches_state(assets: &SoulAssets, state: &SoulState) {
    assert!(assets.soul_id == soul::soul_id(state), EAssetsMismatch);
}

fun borrow_slot(assets: &SoulAssets, asset_name: String, version_index: u64): &AssetSlot {
    assert!(table::contains(&assets.assets, copy asset_name), EAssetNotFound);
    let versions = table::borrow(&assets.assets, asset_name);
    assert!(version_index < versions.length(), EVersionOutOfBounds);
    vector::borrow(versions, version_index)
}

fun borrow_slot_mut(assets: &mut SoulAssets, asset_name: String, version_index: u64): &mut AssetSlot {
    assert!(table::contains(&assets.assets, copy asset_name), EAssetNotFound);
    let versions = table::borrow_mut(&mut assets.assets, asset_name);
    assert!(version_index < versions.length(), EVersionOutOfBounds);
    vector::borrow_mut(versions, version_index)
}

fun append_version_impl(
    assets: &mut SoulAssets,
    asset_name: String,
    is_public: bool,
    asset_type: u8,
    content_blob: Blob,
    clock: &Clock,
    _ctx: &mut TxContext,
): u64 {
    assert!(!string::is_empty(&asset_name), EEmptyAssetName);

    let created_at_ms = clock.timestamp_ms();
    let blob_object_id = blob::object_id(&content_blob);
    let slot = AssetSlot {
        blob_object_id,
        is_public,
        deleted: false,
        asset_type,
        created_at_ms,
    };

    let version_index = if (table::contains(&assets.assets, copy asset_name)) {
        let versions = table::borrow_mut(&mut assets.assets, copy asset_name);
        let next_index = versions.length();
        vector::push_back(versions, slot);
        next_index
    } else {
        table::add(&mut assets.assets, copy asset_name, vector[slot]);
        assets.asset_count = assets.asset_count + 1;
        0
    };

    dof::add(
        &mut assets.id,
        AssetBlobKey {
            asset_name: copy asset_name,
            version_index,
        },
        content_blob,
    );
    event::emit(AssetVersionAppended {
        assets_id: object::id(assets),
        soul_id: assets.soul_id,
        asset_name,
        version_index,
        is_public,
        asset_type,
        created_at_ms,
        blob_object_id,
    });

    version_index
}

// ── Document ID matching ──
// Format: [prefix "soul-asset:" ++ version_byte ++ assets_id ++ asset_name ++ 0x00 ++ version_index ++ nonce]

fun assert_matching_document_id(
    id: vector<u8>,
    expected_assets_id: ID,
    expected_asset_name: String,
    expected_version_index: u64,
) {
    let domain = b"soul-asset:";
    let domain_len = domain.length();
    let asset_name_bytes = string::as_bytes(&expected_asset_name);
    let asset_name_len = asset_name_bytes.length();
    let assets_id_bytes = expected_assets_id.to_bytes();
    let assets_id_len = assets_id_bytes.length();
    assert!(
        id.length() >= domain_len + 1 + assets_id_len + asset_name_len + 1 + 8 + DOCUMENT_ID_NONCE_BYTES,
        EAssetsMismatch,
    );

    let mut i = 0;
    while (i < domain_len) {
        assert!(id[i] == domain[i], EAssetsMismatch);
        i = i + 1;
    };

    assert!(id[domain_len] == DOCUMENT_ID_VERSION, EAssetsMismatch);

    let assets_id_offset = domain_len + 1;
    i = 0;
    while (i < assets_id_len) {
        assert!(id[assets_id_offset + i] == assets_id_bytes[i], EAssetsMismatch);
        i = i + 1;
    };

    let asset_name_offset = assets_id_offset + assets_id_len;
    i = 0;
    while (i < asset_name_len) {
        assert!(id[asset_name_offset + i] == asset_name_bytes[i], EAssetsMismatch);
        i = i + 1;
    };
    assert!(id[asset_name_offset + asset_name_len] == 0x00, EAssetsMismatch);

    assert_u64_segment(&id, asset_name_offset + asset_name_len + 1, expected_version_index);
}

fun assert_u64_segment(id: &vector<u8>, start: u64, value: u64) {
    let mut shift = 56;
    let mut index = 0;
    while (index < 8) {
        let expected = ((value >> shift) & 0xFF) as u8;
        assert!(id[start + index] == expected, EAssetsMismatch);
        shift = if (shift >= 8) shift - 8 else 0;
        index = index + 1;
    };
}

// ── Test helpers ──

#[test_only]
public(package) fun seal_approve_asset_read_as_owner_for_testing(
    id: vector<u8>,
    state: &SoulState,
    assets: &SoulAssets,
    asset_name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    seal_approve_asset_read_owner(id, state, assets, asset_name, version_index, ctx)
}

#[test_only]
public(package) fun seal_approve_asset_read_as_granted_agent_for_testing(
    id: vector<u8>,
    state: &SoulState,
    assets: &SoulAssets,
    asset_name: String,
    version_index: u64,
    soul_grant: &SoulGrant,
    clock: &Clock,
    ctx: &TxContext,
) {
    seal_approve_asset_read_granted_agent(id, state, assets, asset_name, version_index, soul_grant, clock, ctx)
}

#[test_only]
public fun destroy_for_testing(self: SoulAssets) {
    let SoulAssets {
        id,
        soul_id: _,
        assets,
        asset_count: _,
    } = self;
    table::drop(assets);
    id.delete();
}
