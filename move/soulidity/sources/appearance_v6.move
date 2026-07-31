module soulidity::appearance_v6;

use soulidity::soul::{Self as soul, SoulState};
use sui::event;

const VERSION: u64 = 1;
const HASH_BYTES: u64 = 32;
const NONCE_BYTES: u64 = 32;

const PROFILE_MODE_FIXED: u8 = 0;
const PROFILE_MODE_COMPOSABLE: u8 = 1;

const EStateMismatch: u64 = 0;
const EProfileMismatch: u64 = 1;
const ERootMismatch: u64 = 2;
const EOwnerMismatch: u64 = 3;
const EOwnershipEpochMismatch: u64 = 4;
const EInvalidProfileMode: u64 = 5;
const EFixedAppearance: u64 = 6;
const ELoadoutUpdatesDisabled: u64 = 7;
const ESoulListed: u64 = 8;
const ERevisionMismatch: u64 = 9;
const EInvalidCommitment: u64 = 10;
const ETransferUnsafe: u64 = 11;
const ESoulNotListed: u64 = 12;

/// Immutable v6 appearance chosen when a Soul first opts into composable
/// assets. This object is frozen at creation; it never replaces the v5
/// Genesis image, Recipe or output provenance.
public struct GenesisAppearanceV6 has key {
    id: UID,
    version: u64,
    soul_id: ID,
    soul_state_id: ID,
    maker_root_id: ID,
    profile_id: ID,
    profile_mode: u8,
    loadout_mutable: bool,
    ownership_epoch: u64,
    authorizer: address,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    slot_schema_commitment: vector<u8>,
    extensions_hash: vector<u8>,
    transfer_safe: bool,
}

/// Mutable companion state for the Soul's current v6 appearance. The object
/// is separate from `Soul` and `SoulState`, preserving their deployed layouts.
/// It stores only the latest commitment; immutable Animacraft authorization
/// and Soulidity appearance events provide the revision history.
public struct SoulAppearanceStateV6 has key {
    id: UID,
    version: u64,
    soul_id: ID,
    soul_state_id: ID,
    genesis_appearance_id: ID,
    maker_root_id: ID,
    profile_id: ID,
    profile_mode: u8,
    loadout_mutable: bool,
    revision: u64,
    ownership_epoch_snapshot: u64,
    current_authorizer: address,
    current_client_nonce: vector<u8>,
    current_loadout_hash: vector<u8>,
    slot_schema_commitment: vector<u8>,
    extensions_hash: vector<u8>,
    transfer_safe: bool,
}

/// Package-internal values extracted from a non-storable Animacraft v6
/// authorization. Keeping construction package-only prevents callers from
/// self-attesting a loadout or its transfer safety.
public struct AppearanceCommitmentV6 has drop {
    maker_root_id: ID,
    profile_id: ID,
    authorizer: address,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    slot_schema_commitment: vector<u8>,
    extensions_hash: vector<u8>,
    transfer_safe: bool,
}

public struct GenesisAppearanceV6Created has copy, drop {
    genesis_appearance_id: ID,
    appearance_state_id: ID,
    soul_id: ID,
    soul_state_id: ID,
    maker_root_id: ID,
    profile_id: ID,
    profile_mode: u8,
    loadout_mutable: bool,
    ownership_epoch: u64,
    loadout_hash: vector<u8>,
    extensions_hash: vector<u8>,
    transfer_safe: bool,
}

public struct SoulAppearanceV6Updated has copy, drop {
    appearance_state_id: ID,
    soul_id: ID,
    previous_revision: u64,
    revision: u64,
    ownership_epoch: u64,
    authorizer: address,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    transfer_safe: bool,
}

public struct SoulAppearanceV6OwnershipSynced has copy, drop {
    appearance_state_id: ID,
    soul_id: ID,
    revision: u64,
    previous_ownership_epoch: u64,
    ownership_epoch: u64,
}

public(package) fun new_commitment(
    maker_root_id: ID,
    profile_id: ID,
    authorizer: address,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    slot_schema_commitment: vector<u8>,
    extensions_hash: vector<u8>,
    transfer_safe: bool,
): AppearanceCommitmentV6 {
    assert_commitment_shape(
        &client_nonce,
        &loadout_hash,
        &slot_schema_commitment,
        &extensions_hash,
    );
    AppearanceCommitmentV6 {
        maker_root_id,
        profile_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        extensions_hash,
        transfer_safe,
    }
}

/// Bind a Soul to v6 exactly once, freeze its Genesis snapshot and share its
/// current appearance companion. The trusted commitment must have been
/// extracted from an Animacraft one-shot authorization by the cross-package
/// adapter in the same transaction.
public(package) fun new_bind_and_publish(
    state: &mut SoulState,
    profile_mode: u8,
    loadout_mutable: bool,
    commitment: AppearanceCommitmentV6,
    ctx: &mut TxContext,
) {
    assert!(!soul::is_listed(state), ESoulListed);
    assert!(
        profile_mode == PROFILE_MODE_FIXED
            || profile_mode == PROFILE_MODE_COMPOSABLE,
        EInvalidProfileMode,
    );
    assert!(
        profile_mode != PROFILE_MODE_FIXED || !loadout_mutable,
        EInvalidProfileMode,
    );
    let AppearanceCommitmentV6 {
        maker_root_id,
        profile_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        extensions_hash,
        transfer_safe,
    } = commitment;
    assert!(soul::current_owner(state) == authorizer, EOwnerMismatch);

    let soul_id = soul::soul_id(state);
    let soul_state_id = object::id(state);
    let ownership_epoch = soul::ownership_epoch(state);
    let genesis = GenesisAppearanceV6 {
        id: object::new(ctx),
        version: VERSION,
        soul_id,
        soul_state_id,
        maker_root_id,
        profile_id,
        profile_mode,
        loadout_mutable,
        ownership_epoch,
        authorizer,
        client_nonce: copy client_nonce,
        loadout_hash: copy loadout_hash,
        slot_schema_commitment: copy slot_schema_commitment,
        extensions_hash: copy extensions_hash,
        transfer_safe,
    };
    let genesis_appearance_id = object::id(&genesis);
    let appearance_state = SoulAppearanceStateV6 {
        id: object::new(ctx),
        version: VERSION,
        soul_id,
        soul_state_id,
        genesis_appearance_id,
        maker_root_id,
        profile_id,
        profile_mode,
        loadout_mutable,
        revision: 0,
        ownership_epoch_snapshot: ownership_epoch,
        current_authorizer: authorizer,
        current_client_nonce: client_nonce,
        current_loadout_hash: loadout_hash,
        slot_schema_commitment,
        extensions_hash,
        transfer_safe,
    };
    let appearance_state_id = object::id(&appearance_state);
    soul::bind_animacraft_appearance_v6(state, appearance_state_id);

    event::emit(GenesisAppearanceV6Created {
        genesis_appearance_id,
        appearance_state_id,
        soul_id,
        soul_state_id,
        maker_root_id,
        profile_id,
        profile_mode,
        loadout_mutable,
        ownership_epoch,
        loadout_hash: *loadout_hash(&genesis),
        extensions_hash: *genesis_extensions_hash(&genesis),
        transfer_safe,
    });
    transfer::freeze_object(genesis);
    transfer::share_object(appearance_state);
}

/// Apply one already-authenticated loadout. `expected_revision` is supplied by
/// the client but checked against the shared object; the protocol itself
/// computes the only valid target (`current + 1`).
public(package) fun apply_authorized_loadout(
    state: &SoulState,
    appearance: &mut SoulAppearanceStateV6,
    expected_revision: u64,
    commitment: AppearanceCommitmentV6,
) {
    assert_can_authorize_update(state, appearance, expected_revision);

    let AppearanceCommitmentV6 {
        maker_root_id,
        profile_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        extensions_hash,
        transfer_safe,
    } = commitment;
    assert!(appearance.maker_root_id == maker_root_id, ERootMismatch);
    assert!(appearance.profile_id == profile_id, EProfileMismatch);
    assert!(appearance.extensions_hash == extensions_hash, EProfileMismatch);
    assert!(soul::current_owner(state) == authorizer, EOwnerMismatch);

    let previous_revision = appearance.revision;
    appearance.revision = previous_revision + 1;
    appearance.current_authorizer = authorizer;
    appearance.current_client_nonce = client_nonce;
    appearance.current_loadout_hash = loadout_hash;
    appearance.slot_schema_commitment = slot_schema_commitment;
    appearance.transfer_safe = transfer_safe;

    event::emit(SoulAppearanceV6Updated {
        appearance_state_id: object::id(appearance),
        soul_id: appearance.soul_id,
        previous_revision,
        revision: appearance.revision,
        ownership_epoch: appearance.ownership_epoch_snapshot,
        authorizer,
        client_nonce: *current_client_nonce(appearance),
        loadout_hash: *current_loadout_hash(appearance),
        transfer_safe,
    });
}

/// Run before requesting an Animacraft authorization so a fixed, stale,
/// listed or ownership-stale Soul fails before entitlement checks or Item
/// locks are attempted. The same checks run again when consuming the
/// authorization, making the adapter safe across multi-command PTBs.
public(package) fun assert_can_authorize_update(
    state: &SoulState,
    appearance: &SoulAppearanceStateV6,
    expected_revision: u64,
) {
    assert_matches_soul(appearance, state);
    assert!(!soul::is_listed(state), ESoulListed);
    assert!(appearance.profile_mode != PROFILE_MODE_FIXED, EFixedAppearance);
    assert!(appearance.loadout_mutable, ELoadoutUpdatesDisabled);
    assert!(appearance.revision == expected_revision, ERevisionMismatch);
    assert!(
        appearance.ownership_epoch_snapshot == soul::ownership_epoch(state),
        EOwnershipEpochMismatch,
    );
}

/// Dedicated v6 market paths call this before taking a purchase capability.
/// A safe listing pins both the current revision and ownership epoch.
public fun assert_transfer_safe_for_listing(
    state: &SoulState,
    appearance: &SoulAppearanceStateV6,
) {
    assert_matches_soul(appearance, state);
    assert!(!soul::is_listed(state), ESoulListed);
    assert!(appearance.transfer_safe, ETransferUnsafe);
    assert!(
        appearance.ownership_epoch_snapshot == soul::ownership_epoch(state),
        EOwnershipEpochMismatch,
    );
}

/// Validate the immutable values pinned by the dedicated v6 listing
/// companion while the underlying Soul listing is active.
public fun assert_active_listing_snapshot(
    state: &SoulState,
    appearance: &SoulAppearanceStateV6,
    appearance_revision: u64,
    ownership_epoch: u64,
    loadout_hash: &vector<u8>,
) {
    assert_matches_soul(appearance, state);
    assert!(soul::is_listed(state), ESoulNotListed);
    assert!(appearance.transfer_safe, ETransferUnsafe);
    assert!(appearance.revision == appearance_revision, ERevisionMismatch);
    assert!(
        appearance.ownership_epoch_snapshot == ownership_epoch
            && soul::ownership_epoch(state) == ownership_epoch,
        EOwnershipEpochMismatch,
    );
    assert!(appearance.current_loadout_hash == *loadout_hash, EStateMismatch);
}

/// Called only by the future dedicated v6 purchase path immediately after
/// Soul ownership rotates. Appearance revision and loadout remain unchanged.
public(package) fun sync_ownership_after_transfer(
    state: &SoulState,
    appearance: &mut SoulAppearanceStateV6,
    listed_revision: u64,
) {
    assert_matches_soul(appearance, state);
    assert!(!soul::is_listed(state), ESoulListed);
    assert!(appearance.transfer_safe, ETransferUnsafe);
    assert!(appearance.revision == listed_revision, ERevisionMismatch);
    assert!(
        soul::ownership_epoch(state)
            == appearance.ownership_epoch_snapshot + 1,
        EOwnershipEpochMismatch,
    );
    let previous_ownership_epoch = appearance.ownership_epoch_snapshot;
    appearance.ownership_epoch_snapshot = soul::ownership_epoch(state);
    appearance.current_authorizer = soul::current_owner(state);
    event::emit(SoulAppearanceV6OwnershipSynced {
        appearance_state_id: object::id(appearance),
        soul_id: appearance.soul_id,
        revision: appearance.revision,
        previous_ownership_epoch,
        ownership_epoch: appearance.ownership_epoch_snapshot,
    });
}

public fun assert_matches_soul(
    self: &SoulAppearanceStateV6,
    state: &SoulState,
) {
    assert!(self.soul_id == soul::soul_id(state), EStateMismatch);
    assert!(self.soul_state_id == object::id(state), EStateMismatch);
    assert!(
        object::id(self) == soul::animacraft_appearance_v6_id(state),
        EStateMismatch,
    );
}

public fun version(self: &SoulAppearanceStateV6): u64 { self.version }
public fun appearance_state_id(self: &SoulAppearanceStateV6): ID { object::id(self) }
public fun soul_id(self: &SoulAppearanceStateV6): ID { self.soul_id }
public fun soul_state_id(self: &SoulAppearanceStateV6): ID { self.soul_state_id }
public fun genesis_appearance_id(self: &SoulAppearanceStateV6): ID { self.genesis_appearance_id }
public fun maker_root_id(self: &SoulAppearanceStateV6): ID { self.maker_root_id }
public fun profile_id(self: &SoulAppearanceStateV6): ID { self.profile_id }
public fun profile_mode(self: &SoulAppearanceStateV6): u8 { self.profile_mode }
public fun loadout_mutable(self: &SoulAppearanceStateV6): bool { self.loadout_mutable }
public fun revision(self: &SoulAppearanceStateV6): u64 { self.revision }
public fun ownership_epoch_snapshot(self: &SoulAppearanceStateV6): u64 {
    self.ownership_epoch_snapshot
}
public fun current_authorizer(self: &SoulAppearanceStateV6): address {
    self.current_authorizer
}
public fun current_client_nonce(self: &SoulAppearanceStateV6): &vector<u8> {
    &self.current_client_nonce
}
public fun current_loadout_hash(self: &SoulAppearanceStateV6): &vector<u8> {
    &self.current_loadout_hash
}
public fun slot_schema_commitment(self: &SoulAppearanceStateV6): &vector<u8> {
    &self.slot_schema_commitment
}
public fun extensions_hash(self: &SoulAppearanceStateV6): &vector<u8> {
    &self.extensions_hash
}
public fun transfer_safe(self: &SoulAppearanceStateV6): bool { self.transfer_safe }

public fun genesis_version(self: &GenesisAppearanceV6): u64 { self.version }
public fun genesis_soul_id(self: &GenesisAppearanceV6): ID { self.soul_id }
public fun genesis_state_id(self: &GenesisAppearanceV6): ID { self.soul_state_id }
public fun genesis_maker_root_id(self: &GenesisAppearanceV6): ID { self.maker_root_id }
public fun genesis_profile_id(self: &GenesisAppearanceV6): ID { self.profile_id }
public fun genesis_profile_mode(self: &GenesisAppearanceV6): u8 { self.profile_mode }
public fun genesis_loadout_mutable(self: &GenesisAppearanceV6): bool { self.loadout_mutable }
public fun genesis_ownership_epoch(self: &GenesisAppearanceV6): u64 { self.ownership_epoch }
public fun genesis_authorizer(self: &GenesisAppearanceV6): address { self.authorizer }
public fun genesis_client_nonce(self: &GenesisAppearanceV6): &vector<u8> { &self.client_nonce }
public fun loadout_hash(self: &GenesisAppearanceV6): &vector<u8> { &self.loadout_hash }
public fun genesis_slot_schema_commitment(self: &GenesisAppearanceV6): &vector<u8> {
    &self.slot_schema_commitment
}
public fun genesis_extensions_hash(self: &GenesisAppearanceV6): &vector<u8> {
    &self.extensions_hash
}
public fun genesis_transfer_safe(self: &GenesisAppearanceV6): bool { self.transfer_safe }

public fun profile_mode_fixed(): u8 { PROFILE_MODE_FIXED }
public fun profile_mode_composable(): u8 { PROFILE_MODE_COMPOSABLE }

fun assert_commitment_shape(
    client_nonce: &vector<u8>,
    loadout_hash: &vector<u8>,
    slot_schema_commitment: &vector<u8>,
    extensions_hash: &vector<u8>,
) {
    assert!(client_nonce.length() == NONCE_BYTES, EInvalidCommitment);
    assert!(loadout_hash.length() == HASH_BYTES, EInvalidCommitment);
    assert!(slot_schema_commitment.length() == HASH_BYTES, EInvalidCommitment);
    assert!(extensions_hash.length() == HASH_BYTES, EInvalidCommitment);
}
