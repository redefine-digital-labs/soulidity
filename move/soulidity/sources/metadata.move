module soulidity::metadata;

use std::string::{Self as string, String};
use sui::event;
use sui::table;
use soulidity::soul::{Self as soul, SoulState};

const EMetadataStateMismatch: u64 = 0;
const EMetadataBlobMissing: u64 = 1;
const EEmptyMetadataBlobKey: u64 = 2;
const EAssetVersionActive: u64 = 3;
const EInvalidDownloadPolicy: u64 = 4;

const DOWNLOAD_POLICY_PUBLIC: u8 = 0;
const DOWNLOAD_POLICY_OWNER_ONLY: u8 = 1;
const DOWNLOAD_POLICY_ALLOWLIST: u8 = 2;

public struct AssetBinding has copy, drop, store {
    asset_name: String,
    version_index: u64,
    download_policy: u8,
}

public struct SoulMetadata has key {
    id: UID,
    soul_id: ID,
    active_sprite: Option<AssetBinding>,
    active_voice: Option<AssetBinding>,
    ext: table::Table<String, vector<u8>>,
}

public struct SoulMetadataCreated has copy, drop {
    metadata_id: ID,
    soul_id: ID,
}

public struct SoulMetadataSpriteUpdated has copy, drop {
    metadata_id: ID,
    soul_id: ID,
    updater: address,
    active_sprite: Option<AssetBinding>,
}

public struct SoulMetadataVoiceUpdated has copy, drop {
    metadata_id: ID,
    soul_id: ID,
    updater: address,
    active_voice: Option<AssetBinding>,
}

public struct SoulMetadataBlobUpserted has copy, drop {
    metadata_id: ID,
    soul_id: ID,
    updater: address,
    key: String,
}

public struct SoulMetadataBlobDeleted has copy, drop {
    metadata_id: ID,
    soul_id: ID,
    updater: address,
    key: String,
}

public fun soul_id(self: &SoulMetadata): ID {
    self.soul_id
}

public fun active_sprite(self: &SoulMetadata): &Option<AssetBinding> {
    &self.active_sprite
}

public fun active_voice(self: &SoulMetadata): &Option<AssetBinding> {
    &self.active_voice
}

public fun asset_name(self: &AssetBinding): &String {
    &self.asset_name
}

public fun version_index(self: &AssetBinding): u64 {
    self.version_index
}

public fun download_policy(self: &AssetBinding): u8 {
    self.download_policy
}

public fun download_policy_public(): u8 {
    DOWNLOAD_POLICY_PUBLIC
}

public fun download_policy_owner_only(): u8 {
    DOWNLOAD_POLICY_OWNER_ONLY
}

public fun download_policy_allowlist(): u8 {
    DOWNLOAD_POLICY_ALLOWLIST
}

public(package) fun create(
    soul_id: ID,
    ctx: &mut TxContext,
): SoulMetadata {
    let metadata = SoulMetadata {
        id: object::new(ctx),
        soul_id,
        active_sprite: option::none(),
        active_voice: option::none(),
        ext: table::new(ctx),
    };

    event::emit(SoulMetadataCreated {
        metadata_id: object::id(&metadata),
        soul_id,
    });

    metadata
}

public(package) fun new_asset_binding(
    asset_name: String,
    version_index: u64,
    download_policy: u8,
): AssetBinding {
    assert_valid_download_policy(download_policy);
    AssetBinding {
        asset_name,
        version_index,
        download_policy,
    }
}

public(package) fun share_metadata(metadata: SoulMetadata) {
    transfer::share_object(metadata);
}

public(package) fun assert_matches_state(
    metadata: &SoulMetadata,
    state: &SoulState,
) {
    assert!(metadata.soul_id == soul::soul_id(state), EMetadataStateMismatch);
    assert!(soul::metadata_id(state).contains(&object::id(metadata)), EMetadataStateMismatch);
}

public(package) fun set_active_sprite(
    metadata: &mut SoulMetadata,
    state: &SoulState,
    binding: Option<AssetBinding>,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_matches_state(metadata, state);
    if (binding.is_some()) {
        assert_valid_download_policy(binding.borrow().download_policy);
    };
    metadata.active_sprite = binding;
    event::emit(SoulMetadataSpriteUpdated {
        metadata_id: object::id(metadata),
        soul_id: metadata.soul_id,
        updater: ctx.sender(),
        active_sprite: copy metadata.active_sprite,
    });
}

public(package) fun clear_active_sprite(
    metadata: &mut SoulMetadata,
    state: &SoulState,
    ctx: &TxContext,
) {
    set_active_sprite(metadata, state, option::none(), ctx);
}

public(package) fun set_active_voice(
    metadata: &mut SoulMetadata,
    state: &SoulState,
    binding: Option<AssetBinding>,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_matches_state(metadata, state);
    if (binding.is_some()) {
        assert_valid_download_policy(binding.borrow().download_policy);
    };
    metadata.active_voice = binding;
    event::emit(SoulMetadataVoiceUpdated {
        metadata_id: object::id(metadata),
        soul_id: metadata.soul_id,
        updater: ctx.sender(),
        active_voice: copy metadata.active_voice,
    });
}

public(package) fun clear_active_voice(
    metadata: &mut SoulMetadata,
    state: &SoulState,
    ctx: &TxContext,
) {
    set_active_voice(metadata, state, option::none(), ctx);
}

public fun upsert_metadata_blob(
    metadata: &mut SoulMetadata,
    state: &SoulState,
    key: String,
    value: vector<u8>,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_matches_state(metadata, state);
    assert!(!string::is_empty(&key), EEmptyMetadataBlobKey);

    if (table::contains(&metadata.ext, copy key)) {
        *table::borrow_mut(&mut metadata.ext, copy key) = value;
    } else {
        table::add(&mut metadata.ext, copy key, value);
    };

    event::emit(SoulMetadataBlobUpserted {
        metadata_id: object::id(metadata),
        soul_id: metadata.soul_id,
        updater: ctx.sender(),
        key,
    });
}

public fun delete_metadata_blob(
    metadata: &mut SoulMetadata,
    state: &SoulState,
    key: String,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert_matches_state(metadata, state);
    assert!(!string::is_empty(&key), EEmptyMetadataBlobKey);
    assert!(table::contains(&metadata.ext, copy key), EMetadataBlobMissing);
    table::remove(&mut metadata.ext, copy key);
    event::emit(SoulMetadataBlobDeleted {
        metadata_id: object::id(metadata),
        soul_id: metadata.soul_id,
        updater: ctx.sender(),
        key,
    });
}

public fun is_asset_version_active(
    metadata: &SoulMetadata,
    asset_name: String,
    version_index: u64,
): bool {
    is_binding_active(&metadata.active_sprite, copy asset_name, version_index)
        || is_binding_active(&metadata.active_voice, asset_name, version_index)
}

public fun assert_asset_version_not_active(
    metadata: &SoulMetadata,
    asset_name: String,
    version_index: u64,
) {
    assert!(!is_asset_version_active(metadata, asset_name, version_index), EAssetVersionActive);
}

fun is_binding_active(
    binding: &Option<AssetBinding>,
    asset_name: String,
    version_index: u64,
): bool {
    if (!binding.is_some()) {
        return false
    };

    let resolved = binding.borrow();
    resolved.asset_name == asset_name && resolved.version_index == version_index
}

fun assert_valid_download_policy(download_policy: u8) {
    assert!(
        download_policy == DOWNLOAD_POLICY_PUBLIC
            || download_policy == DOWNLOAD_POLICY_OWNER_ONLY
            || download_policy == DOWNLOAD_POLICY_ALLOWLIST,
        EInvalidDownloadPolicy,
    );
}

#[test_only]
public fun destroy_for_testing(metadata: SoulMetadata) {
    let SoulMetadata {
        id,
        soul_id: _,
        active_sprite: _,
        active_voice: _,
        ext,
    } = metadata;
    table::drop(ext);
    id.delete();
}
