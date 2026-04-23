module soulidity::soul;

use std::string::String;
use sui::display::{Self as display, Display};
use sui::event;
use sui::package::{Self as package, Publisher};
use walrus::blob::{Self as blob, Blob};

const MAX_BPS: u16 = 10_000;
const DEFAULT_GRANT_CAPACITY: u64 = 1;

const ECreatorRoyaltyTooHigh: u64 = 0;
const ENotSoulOwner: u64 = 1;
const ECollectionAlreadyBound: u64 = 2;
const EInvalidOwner: u64 = 3;
const ESkillsAlreadyBound: u64 = 4;
const EMemoryAlreadyBound: u64 = 5;
const EMetadataAlreadyBound: u64 = 6;
const EAssetsAlreadyBound: u64 = 12;
const EAccessListAlreadyBound: u64 = 13;
const ESoulStateMismatch: u64 = 14;

const PROVENANCE_NATIVE: u8 = 0;
const PROVENANCE_IMPORTED: u8 = 1;
const PROVENANCE_PERSONAL_JOIN: u8 = 2;

public struct SOUL has drop {}

public struct Soul has key, store {
    id: UID,
    name: String,
    description: String,
    image_url: String,
    protected_blob: Blob,
    provenance_kind: u8,
    origin_ref: Option<String>,
    creator: address,
}

public struct ActiveGrantSlot has copy, drop, store {
    grant_id: ID,
    grantee: address,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
}

public struct SoulState has key {
    id: UID,
    soul_id: ID,
    creator: address,
    creator_royalty_bps: u16,
    current_owner: address,
    current_kiosk_id: ID,
    ownership_epoch: u64,
    grant_capacity: u64,
    active_grants: vector<ActiveGrantSlot>,
    memory_id: Option<ID>,
    metadata_id: Option<ID>,
    skills_id: Option<ID>,
    assets_id: Option<ID>,
    collection_id: Option<ID>,
    access_list_id: Option<ID>,
}

public struct SoulCreated has copy, drop {
    soul_id: ID,
    state_id: ID,
    metadata_id: ID,
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

fun init(otw: SOUL, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let soul_display = create_display(&publisher, ctx);

    transfer::public_transfer(soul_display, ctx.sender());
    publisher.burn();
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

public fun protected_blob_object_id(self: &Soul): ID {
    blob::object_id(&self.protected_blob)
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

public fun active_grants(self: &SoulState): &vector<ActiveGrantSlot> {
    &self.active_grants
}

public fun active_grant_count(self: &SoulState): u64 {
    self.active_grants.length()
}

public fun memory_id(self: &SoulState): &Option<ID> {
    &self.memory_id
}

public fun metadata_id(self: &SoulState): &Option<ID> {
    &self.metadata_id
}

public fun skills_id(self: &SoulState): &Option<ID> {
    &self.skills_id
}

public fun assets_id(self: &SoulState): &Option<ID> {
    &self.assets_id
}

public fun collection_id(self: &SoulState): &Option<ID> {
    &self.collection_id
}

public fun access_list_id(self: &SoulState): &Option<ID> {
    &self.access_list_id
}

public fun active_grant_slot_grant_id(self: &ActiveGrantSlot): ID {
    self.grant_id
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

public(package) fun mint(
    name: String,
    description: String,
    image_url: String,
    protected_blob: Blob,
    creator: address,
    creator_royalty_bps: u16,
    provenance_kind: u8,
    origin_ref: Option<String>,
    ctx: &mut TxContext,
): Soul {
    assert!(creator_royalty_bps <= MAX_BPS, ECreatorRoyaltyTooHigh);

    Soul {
        id: object::new(ctx),
        name,
        description,
        image_url,
        protected_blob,
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
    memory_id: Option<ID>,
    ctx: &mut TxContext,
): SoulState {
    assert!(owner != @0x0, EInvalidOwner);
    assert!(creator_royalty_bps <= MAX_BPS, ECreatorRoyaltyTooHigh);

    SoulState {
        id: object::new(ctx),
        soul_id,
        creator,
        creator_royalty_bps,
        current_owner: owner,
        current_kiosk_id: kiosk_id,
        ownership_epoch: 0,
        grant_capacity: DEFAULT_GRANT_CAPACITY,
        active_grants: vector[],
        memory_id,
        metadata_id: option::none(),
        skills_id: option::none(),
        assets_id: option::none(),
        collection_id: option::none(),
        access_list_id: option::none(),
    }
}

public(package) fun emit_created(state: &SoulState, provenance_kind: u8) {
    let metadata_id = *state.metadata_id.borrow();
    event::emit(SoulCreated {
        soul_id: state.soul_id,
        state_id: object::id(state),
        metadata_id,
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

public(package) fun set_memory_id(state: &mut SoulState, memory_id: ID) {
    assert!(state.memory_id.is_none(), EMemoryAlreadyBound);
    state.memory_id = option::some(memory_id);
}

public(package) fun set_metadata_id(state: &mut SoulState, metadata_id: ID) {
    assert!(state.metadata_id.is_none(), EMetadataAlreadyBound);
    state.metadata_id = option::some(metadata_id);
}

public(package) fun set_skills_id(state: &mut SoulState, skills_id: ID) {
    assert!(state.skills_id.is_none(), ESkillsAlreadyBound);
    state.skills_id = option::some(skills_id);
}

public(package) fun set_assets_id(state: &mut SoulState, assets_id: ID) {
    assert!(state.assets_id.is_none(), EAssetsAlreadyBound);
    state.assets_id = option::some(assets_id);
}

public(package) fun set_access_list_id(state: &mut SoulState, id: ID) {
    assert!(state.access_list_id.is_none(), EAccessListAlreadyBound);
    state.access_list_id = option::some(id);
}

public(package) fun set_grant_capacity(state: &mut SoulState, cap: u64) {
    state.grant_capacity = cap;
}

public(package) fun active_grant_index_by_grantee(
    state: &SoulState,
    grantee: address,
): Option<u64> {
    let mut i = 0;
    while (i < state.active_grants.length()) {
        if (state.active_grants.borrow(i).grantee == grantee) {
            return option::some(i)
        };
        i = i + 1;
    };
    option::none()
}

public(package) fun active_grant_index_by_id(state: &SoulState, grant_id: ID): Option<u64> {
    let mut i = 0;
    while (i < state.active_grants.length()) {
        if (state.active_grants.borrow(i).grant_id == grant_id) {
            return option::some(i)
        };
        i = i + 1;
    };
    option::none()
}

public(package) fun active_grant_slot_at(state: &SoulState, index: u64): &ActiveGrantSlot {
    state.active_grants.borrow(index)
}

public(package) fun push_active_grant(
    state: &mut SoulState,
    grant_id: ID,
    grantee: address,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
) {
    state.active_grants.push_back(ActiveGrantSlot {
        grant_id,
        grantee,
        scope_mask,
        expires_at_ms,
    });
}

public(package) fun remove_active_grant_at(state: &mut SoulState, index: u64): ActiveGrantSlot {
    state.active_grants.swap_remove(index)
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

public(package) fun share_state(state: SoulState) {
    transfer::share_object(state);
}

fun create_display(publisher: &Publisher, ctx: &mut TxContext): Display<Soul> {
    let mut soul_display = display::new<Soul>(publisher, ctx);
    soul_display.add(b"name".to_string(), b"{name}".to_string());
    soul_display.add(b"description".to_string(), b"{description}".to_string());
    soul_display.add(b"image_url".to_string(), b"{image_url}".to_string());
    soul_display.add(b"creator".to_string(), b"{creator}".to_string());
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
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    let publisher = package::claim(SOUL {}, ctx);
    let soul_display = create_display(&publisher, ctx);
    transfer::public_transfer(soul_display, recipient);
    publisher.burn();
}

#[test_only]
public fun destroy_for_testing(self: Soul): Blob {
    let Soul {
        id,
        name: _,
        description: _,
        image_url: _,
        protected_blob,
        provenance_kind: _,
        origin_ref: _,
        creator: _,
    } = self;
    id.delete();
    protected_blob
}

#[test_only]
public fun destroy_state_for_testing(self: SoulState) {
    let SoulState {
        id,
        soul_id: _,
        creator: _,
        creator_royalty_bps: _,
        current_owner: _,
        current_kiosk_id: _,
        ownership_epoch: _,
        grant_capacity: _,
        active_grants: _,
        memory_id: _,
        metadata_id: _,
        skills_id: _,
        assets_id: _,
        collection_id: _,
        access_list_id: _,
    } = self;
    id.delete();
}
