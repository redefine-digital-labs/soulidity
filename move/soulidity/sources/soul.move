module soulidity::soul;

use std::string::{Self as string, String};
use sui::display::{Self as display, Display};
use sui::dynamic_field as df;
use sui::event;
use sui::package::{Self as package, Publisher};
use sui::table::{Self as table, Table};

const MAX_BPS: u16 = 10_000;
const DEFAULT_GRANT_CAPACITY: u64 = 1;

const ECreatorRoyaltyTooHigh: u64 = 0;
const ENotSoulOwner: u64 = 1;
const ECollectionAlreadyBound: u64 = 2;
const EInvalidOwner: u64 = 3;
const EAccessListAlreadyBound: u64 = 13;
const ESoulStateMismatch: u64 = 14;
const EContentRootMissing: u64 = 15;
const EContentAlreadyBound: u64 = 16;
const EStateConfigKeyEmpty: u64 = 17;
const EStateConfigKeyMissing: u64 = 18;
const EAnimacraftProvenanceAlreadyBound: u64 = 19;
const EAnimacraftProvenanceMissing: u64 = 20;

const PROVENANCE_NATIVE: u8 = 0;
const PROVENANCE_IMPORTED: u8 = 1;
const PROVENANCE_PERSONAL_JOIN: u8 = 2;
const PROVENANCE_ANIMACRAFT: u8 = 3;
/// Protocol-reserved dynamic-field key. Using a framework primitive keeps the
/// binding queryable after future package upgrades; a package-defined key type
/// would remain pinned to the version that first introduced it.
const ANIMACRAFT_PROVENANCE_KEY: u8 = 1;
/// Commerce-v5 companion provenance. This deliberately uses a second
/// primitive dynamic-field key instead of changing `SoulState` or the already
/// deployed `AnimacraftProvenance` layout.
const ANIMACRAFT_OUTPUT_PROVENANCE_V5_KEY: u8 = 2;
const VERSION: u64 = 1;

public struct SOUL has drop {}

/// Phase 2 hard cut: `protected_blob` (soul.md) lives in `SoulContent` as
/// `(kind=KIND_SOUL_DOC, name="soul", version=0)`. It is no longer a Soul
/// field. `memory_id` is gone for the same reason: `(kind=KIND_MEMORY,
/// name="default", version=N)` covers the memory timeline.
public struct Soul has key, store {
    id: UID,
    version: u64,
    name: String,
    description: String,
    image_url: String,
    provenance_kind: u8,
    origin_ref: Option<String>,
    creator: address,
}

public struct ActiveGrantSlot has copy, drop, store {
    version: u64,
    grant_id: ID,
    grantee: address,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}

public struct SoulState has key {
    id: UID,
    version: u64,
    soul_id: ID,
    creator: address,
    creator_royalty_bps: u16,
    current_owner: address,
    current_kiosk_id: ID,
    ownership_epoch: u64,
    grant_capacity: u64,
    active_grants: Table<address, ActiveGrantSlot>,
    active_grant_ids: Table<ID, address>,
    active_grant_count: u64,
    /// Single typed-content root. Bound once during mint, never re-bound.
    /// Replaces former `metadata_id` / `skills_id` / `assets_id` /
    /// `memory_id` quartet.
    content_id: Option<ID>,
    /// Free-form config blobs owned by the Soul (sprite_config_json,
    /// sprite_mood_map_json, etc). Absorbs the former `metadata::ext`
    /// channel. Mutated via market `set_state_config` / `delete_state_config`.
    config_ext: Table<String, vector<u8>>,
    collection_id: Option<ID>,
    access_list_id: Option<ID>,
    /// True iff a `market::SoulListing` is currently holding this Soul's
    /// `PurchaseCap` in active state. Flipped via `set_listed` from market
    /// list / cancel / buy flows. `collection::add_soul` aborts when set so
    /// solo listings cannot be silently reframed into collection sales.
    is_listed: bool,
}

public struct SoulCreated has copy, drop {
    soul_id: ID,
    state_id: ID,
    content_id: ID,
    creator: address,
    owner: address,
    provenance_kind: u8,
}

public struct SoulOwnershipRotated has copy, drop {
    soul_id: ID,
    previous_owner: address,
    new_owner: address,
    ownership_epoch: u64,
}

public struct SoulStateConfigUpserted has copy, drop {
    state_id: ID,
    soul_id: ID,
    updater: address,
    key: String,
}

public struct SoulStateConfigDeleted has copy, drop {
    state_id: ID,
    soul_id: ID,
    updater: address,
    key: String,
}

fun init(otw: SOUL, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let soul_display = create_display(&publisher, ctx);

    transfer::public_transfer(soul_display, ctx.sender());
    publisher.burn();
}

public fun protocol_version(): u64 {
    VERSION
}

public fun soul_version(self: &Soul): u64 {
    self.version
}

public fun state_version(self: &SoulState): u64 {
    self.version
}

public fun creator(self: &Soul): address {
    self.creator
}

public fun name(self: &Soul): &String {
    &self.name
}

public fun description(self: &Soul): &String {
    &self.description
}

public fun image_url(self: &Soul): &String {
    &self.image_url
}

public fun provenance_kind(self: &Soul): u8 {
    self.provenance_kind
}

public fun origin_ref(self: &Soul): &Option<String> {
    &self.origin_ref
}

public fun soul_id(self: &SoulState): ID {
    self.soul_id
}

public fun state_id(self: &SoulState): ID {
    object::id(self)
}

public fun creator_royalty_bps(self: &SoulState): u16 {
    self.creator_royalty_bps
}

public fun state_creator(self: &SoulState): address {
    self.creator
}

public fun current_owner(self: &SoulState): address {
    self.current_owner
}

public fun current_kiosk_id(self: &SoulState): ID {
    self.current_kiosk_id
}

public fun ownership_epoch(self: &SoulState): u64 {
    self.ownership_epoch
}

public fun grant_capacity(self: &SoulState): u64 {
    self.grant_capacity
}

public fun active_grant_count(self: &SoulState): u64 {
    self.active_grant_count
}

public fun content_id(self: &SoulState): &Option<ID> {
    &self.content_id
}

public fun has_content_id(self: &SoulState): bool {
    self.content_id.is_some()
}

public fun require_content_id(self: &SoulState): ID {
    assert!(self.content_id.is_some(), EContentRootMissing);
    *self.content_id.borrow()
}

public fun collection_id(self: &SoulState): &Option<ID> {
    &self.collection_id
}

public fun access_list_id(self: &SoulState): &Option<ID> {
    &self.access_list_id
}

public fun is_listed(self: &SoulState): bool {
    self.is_listed
}

public fun has_animacraft_provenance(self: &SoulState): bool {
    df::exists_with_type<u8, ID>(&self.id, ANIMACRAFT_PROVENANCE_KEY)
}

public fun animacraft_provenance_id(self: &SoulState): ID {
    assert!(
        df::exists_with_type<u8, ID>(&self.id, ANIMACRAFT_PROVENANCE_KEY),
        EAnimacraftProvenanceMissing,
    );
    *df::borrow<u8, ID>(&self.id, ANIMACRAFT_PROVENANCE_KEY)
}

public fun has_animacraft_output_provenance_v5(self: &SoulState): bool {
    df::exists_with_type<u8, ID>(
        &self.id,
        ANIMACRAFT_OUTPUT_PROVENANCE_V5_KEY,
    )
}

public fun animacraft_output_provenance_v5_id(self: &SoulState): ID {
    assert!(
        df::exists_with_type<u8, ID>(
            &self.id,
            ANIMACRAFT_OUTPUT_PROVENANCE_V5_KEY,
        ),
        EAnimacraftProvenanceMissing,
    );
    *df::borrow<u8, ID>(
        &self.id,
        ANIMACRAFT_OUTPUT_PROVENANCE_V5_KEY,
    )
}

public fun has_state_config(self: &SoulState, key: String): bool {
    self.config_ext.contains(key)
}

public fun state_config(self: &SoulState, key: String): &vector<u8> {
    assert!(self.config_ext.contains(key), EStateConfigKeyMissing);
    self.config_ext.borrow(key)
}

public fun active_grant_slot_grant_id(self: &ActiveGrantSlot): ID {
    self.grant_id
}

public fun active_grant_slot_version(self: &ActiveGrantSlot): u64 {
    self.version
}

public fun active_grant_slot_grantee(self: &ActiveGrantSlot): address {
    self.grantee
}

public fun active_grant_slot_scope_mask(self: &ActiveGrantSlot): u64 {
    self.scope_mask
}

public fun active_grant_slot_expires_at_ms(self: &ActiveGrantSlot): &Option<u64> {
    &self.expires_at_ms
}

public fun active_grant_slot_ownership_epoch_snapshot(self: &ActiveGrantSlot): u64 {
    self.ownership_epoch_snapshot
}

public(package) fun mint(
    name: String,
    description: String,
    image_url: String,
    creator: address,
    creator_royalty_bps: u16,
    provenance_kind: u8,
    origin_ref: Option<String>,
    ctx: &mut TxContext,
): Soul {
    assert!(creator_royalty_bps <= MAX_BPS, ECreatorRoyaltyTooHigh);

    Soul {
        id: object::new(ctx),
        version: VERSION,
        name,
        description,
        image_url,
        provenance_kind,
        origin_ref,
        creator,
    }
}

public(package) fun create_state(
    soul_id: ID,
    creator: address,
    creator_royalty_bps: u16,
    owner: address,
    kiosk_id: ID,
    ctx: &mut TxContext,
): SoulState {
    assert!(owner != @0x0, EInvalidOwner);
    assert!(creator_royalty_bps <= MAX_BPS, ECreatorRoyaltyTooHigh);

    SoulState {
        id: object::new(ctx),
        version: VERSION,
        soul_id,
        creator,
        creator_royalty_bps,
        current_owner: owner,
        current_kiosk_id: kiosk_id,
        ownership_epoch: 0,
        grant_capacity: DEFAULT_GRANT_CAPACITY,
        active_grants: table::new(ctx),
        active_grant_ids: table::new(ctx),
        active_grant_count: 0,
        content_id: option::none(),
        config_ext: table::new(ctx),
        collection_id: option::none(),
        access_list_id: option::none(),
        is_listed: false,
    }
}

/// Emit `SoulCreated` only after `content_id` has been bound. The market
/// mint flow guarantees this ordering; aborts if called too early.
public(package) fun emit_created_after_content_bound(
    state: &SoulState,
    provenance_kind: u8,
) {
    assert!(state.content_id.is_some(), EContentRootMissing);
    let content_id = *state.content_id.borrow();
    event::emit(SoulCreated {
        soul_id: state.soul_id,
        state_id: object::id(state),
        content_id,
        creator: state.creator,
        owner: state.current_owner,
        provenance_kind,
    });
}

public(package) fun provenance_native(): u8 {
    PROVENANCE_NATIVE
}

public(package) fun provenance_imported(): u8 {
    PROVENANCE_IMPORTED
}

public(package) fun provenance_personal_join(): u8 {
    PROVENANCE_PERSONAL_JOIN
}

public(package) fun provenance_animacraft(): u8 {
    PROVENANCE_ANIMACRAFT
}

public(package) fun bind_animacraft_provenance(
    state: &mut SoulState,
    provenance_id: ID,
) {
    assert!(
        !df::exists_with_type<u8, ID>(&state.id, ANIMACRAFT_PROVENANCE_KEY),
        EAnimacraftProvenanceAlreadyBound,
    );
    df::add(&mut state.id, ANIMACRAFT_PROVENANCE_KEY, provenance_id);
}

public(package) fun bind_animacraft_output_provenance_v5(
    state: &mut SoulState,
    provenance_id: ID,
) {
    assert!(
        !df::exists_with_type<u8, ID>(
            &state.id,
            ANIMACRAFT_OUTPUT_PROVENANCE_V5_KEY,
        ),
        EAnimacraftProvenanceAlreadyBound,
    );
    df::add(
        &mut state.id,
        ANIMACRAFT_OUTPUT_PROVENANCE_V5_KEY,
        provenance_id,
    );
}

public(package) fun assert_owner(state: &SoulState, owner: address) {
    assert!(state.current_owner == owner, ENotSoulOwner);
}

public(package) fun assert_matches_state(self: &Soul, state: &SoulState) {
    assert!(object::id(self) == state.soul_id, ESoulStateMismatch);
}

public(package) fun bind_collection(state: &mut SoulState, collection_id: ID) {
    assert!(state.collection_id.is_none(), ECollectionAlreadyBound);
    state.collection_id = option::some(collection_id);
}

/// Mirror the listing lifecycle on `SoulState`. Flipped to `true` by market
/// list flows and back to `false` by cancel / buy paths so other modules
/// (currently `collection::add_soul`) can reject conflicting transitions.
public(package) fun set_listed(state: &mut SoulState, listed: bool) {
    state.is_listed = listed;
}

public(package) fun set_content_id(state: &mut SoulState, content_id: ID) {
    assert!(state.content_id.is_none(), EContentAlreadyBound);
    state.content_id = option::some(content_id);
}

public(package) fun set_access_list_id(state: &mut SoulState, id: ID) {
    assert!(state.access_list_id.is_none(), EAccessListAlreadyBound);
    state.access_list_id = option::some(id);
}

public(package) fun set_grant_capacity(state: &mut SoulState, cap: u64) {
    state.grant_capacity = cap;
}

public(package) fun upsert_state_config(state: &mut SoulState, key: String, value: vector<u8>) {
    assert!(!string::is_empty(&key), EStateConfigKeyEmpty);
    if (state.config_ext.contains(copy key)) {
        let existing = state.config_ext.borrow_mut(copy key);
        *existing = value;
    } else {
        state.config_ext.add(key, value);
    };
}

public(package) fun delete_state_config(state: &mut SoulState, key: String) {
    assert!(!string::is_empty(&key), EStateConfigKeyEmpty);
    assert!(state.config_ext.contains(copy key), EStateConfigKeyMissing);
    let _ = state.config_ext.remove(key);
}

public(package) fun emit_state_config_upserted(state: &SoulState, updater: address, key: String) {
    event::emit(SoulStateConfigUpserted {
        state_id: object::id(state),
        soul_id: state.soul_id,
        updater,
        key,
    });
}

public(package) fun emit_state_config_deleted(state: &SoulState, updater: address, key: String) {
    event::emit(SoulStateConfigDeleted {
        state_id: object::id(state),
        soul_id: state.soul_id,
        updater,
        key,
    });
}

public(package) fun push_active_grant(
    state: &mut SoulState,
    grant_id: ID,
    grantee: address,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
) {
    state.active_grants.add(grantee, ActiveGrantSlot {
        version: VERSION,
        grant_id,
        grantee,
        scope_mask,
        expires_at_ms,
        ownership_epoch_snapshot,
    });
    state.active_grant_ids.add(grant_id, grantee);
    state.active_grant_count = state.active_grant_count + 1;
}

public(package) fun active_grant_contains_grantee(
    state: &SoulState,
    grantee: address,
): bool {
    if (!state.active_grants.contains(grantee)) {
        return false
    };
    let slot = &state.active_grants[grantee];
    slot.ownership_epoch_snapshot == state.ownership_epoch && state.active_grant_count > 0
}

public(package) fun active_grant_contains_id(state: &SoulState, grant_id: ID): bool {
    if (!state.active_grant_ids.contains(grant_id)) {
        return false
    };
    let grantee = *state.active_grant_ids.borrow(grant_id);
    if (!state.active_grants.contains(grantee)) {
        return false
    };
    let slot = &state.active_grants[grantee];
    slot.grant_id == grant_id
        && slot.ownership_epoch_snapshot == state.ownership_epoch
        && state.active_grant_count > 0
}

public(package) fun active_grant_has_grantee_row(
    state: &SoulState,
    grantee: address,
): bool {
    state.active_grants.contains(grantee)
}

public(package) fun active_grant_grantee_by_id(state: &SoulState, grant_id: ID): Option<address> {
    if (state.active_grant_ids.contains(grant_id)) {
        option::some(*state.active_grant_ids.borrow(grant_id))
    } else {
        option::none()
    }
}

public(package) fun active_grant_slot_for_grantee(
    state: &SoulState,
    grantee: address,
): &ActiveGrantSlot {
    &state.active_grants[grantee]
}

public(package) fun remove_active_grant_for_grantee(
    state: &mut SoulState,
    grantee: address,
): ActiveGrantSlot {
    let slot = state.active_grants.remove(grantee);
    state.active_grant_ids.remove(slot.grant_id);
    if (slot.ownership_epoch_snapshot == state.ownership_epoch && state.active_grant_count > 0) {
        state.active_grant_count = state.active_grant_count - 1;
    };
    slot
}

public(package) fun clear_active_grant_count_for_owner_rotation(state: &mut SoulState) {
    state.active_grant_count = 0;
}

public(package) fun rotate_owner(
    state: &mut SoulState,
    new_owner: address,
    new_kiosk_id: ID,
) {
    assert!(new_owner != @0x0, EInvalidOwner);

    let previous_owner = state.current_owner;
    state.current_owner = new_owner;
    state.current_kiosk_id = new_kiosk_id;
    state.ownership_epoch = state.ownership_epoch + 1;

    event::emit(SoulOwnershipRotated {
        soul_id: state.soul_id,
        previous_owner,
        new_owner,
        ownership_epoch: state.ownership_epoch,
    });
}

/// Single sanctioned path for sharing a `SoulState`. Asserts that the
/// content root has already been bound so mirror / API / UI never see a
/// content-less Soul. Any direct `transfer::share_object(state)` call is
/// rejected at compile time because `SoulState` lacks the `store` ability.
public(package) fun share_state(state: SoulState) {
    assert!(state.content_id.is_some(), EContentRootMissing);
    transfer::share_object(state);
}

fun create_display(publisher: &Publisher, ctx: &mut TxContext): Display<Soul> {
    let mut soul_display = display::new<Soul>(publisher, ctx);
    soul_display.add(b"name".to_string(), b"{name}".to_string());
    soul_display.add(b"description".to_string(), b"{description}".to_string());
    soul_display.add(b"image_url".to_string(), b"{image_url}".to_string());
    soul_display.add(b"creator".to_string(), b"{creator}".to_string());
    soul_display.add(b"link".to_string(), b"{origin_ref}".to_string());
    soul_display.add(b"project_url".to_string(), b"{origin_ref}".to_string());
    soul_display.update_version();
    soul_display
}

#[test_only]
public fun provenance_native_for_testing(): u8 {
    PROVENANCE_NATIVE
}

#[test_only]
public fun provenance_imported_for_testing(): u8 {
    PROVENANCE_IMPORTED
}

#[test_only]
public fun provenance_personal_join_for_testing(): u8 {
    PROVENANCE_PERSONAL_JOIN
}

#[test_only]
public fun provenance_animacraft_for_testing(): u8 {
    PROVENANCE_ANIMACRAFT
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    let publisher = package::claim(SOUL {}, ctx);
    let soul_display = create_display(&publisher, ctx);
    transfer::public_transfer(soul_display, recipient);
    publisher.burn();
}

#[test_only]
public fun destroy_for_testing(self: Soul) {
    let Soul {
        id,
        version: _,
        name: _,
        description: _,
        image_url: _,
        provenance_kind: _,
        origin_ref: _,
        creator: _,
    } = self;
    id.delete();
}

#[test_only]
public fun destroy_state_for_testing(self: SoulState) {
    let SoulState {
        id,
        version: _,
        soul_id: _,
        creator: _,
        creator_royalty_bps: _,
        current_owner: _,
        current_kiosk_id: _,
        ownership_epoch: _,
        grant_capacity: _,
        active_grants,
        active_grant_ids,
        active_grant_count: _,
        content_id: _,
        config_ext,
        collection_id: _,
        access_list_id: _,
        is_listed: _,
    } = self;
    table::drop(active_grants);
    table::drop(active_grant_ids);
    table::drop(config_ext);
    id.delete();
}
