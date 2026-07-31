module soulidity::animacraft_appearance_adapter_v6;

use animacraft::commerce_v5::{
    Self as commerce_v5,
    CommerceProtocolConfigV5,
    MakerRootV5,
};
use animacraft::composition_v6::{
    Self as composition_v6,
    CompositionProtocolConfigV6,
    CompositionProtocolTreasuryV6,
    CompositionRegistryV6,
    InitialLoadoutAuthorizationV6,
    ItemProductV6,
    LoadoutAuthorizationV6,
    LoadoutSelectionV6,
    MakerProfileV6,
    OwnedItemV6,
};
use soulidity::animacraft_soul_owner_proof_v6::{
    Self as soul_owner_proof_v6,
};
use soulidity::appearance_v6::{
    Self as appearance_v6,
    AppearanceCommitmentV6,
    SoulAppearanceStateV6,
};
use soulidity::soul::{Self as soul, SoulState};
use sui::clock::Clock;
use sui::coin::Coin;

const EAppearanceAlreadyBound: u64 = 0;
const EProfileRootMismatch: u64 = 1;
const EAuthorizationSoulMismatch: u64 = 2;
const EAuthorizationOwnerMismatch: u64 = 3;
const EAuthorizationProfileMismatch: u64 = 4;
const ESlotSchemaMismatch: u64 = 5;
const EExtensionsMismatch: u64 = 6;
const EAuthorizationVersionMismatch: u64 = 7;
const EWalletBindingCountMismatch: u64 = 8;
const EInvalidSelectionSubject: u64 = 9;
const EOwnedInstanceSubjectMismatch: u64 = 10;

/// Request the one-shot Animacraft authorization used to create a Soul's
/// immutable Genesis appearance and mutable/fixed current companion.  The
/// authorization has no abilities and therefore must be consumed later in
/// the same programmable transaction block.
///
/// Unlike update authorization, this path intentionally accepts either a
/// sealed FIXED profile or a sealed COMPOSABLE profile.  FIXED affects only
/// subsequent revisions; it never permits an unauthenticated Genesis.
public fun authorize_initial_appearance_v6(
    registry: &mut CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    commerce_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    selections: vector<LoadoutSelectionV6>,
    ctx: &TxContext,
): InitialLoadoutAuthorizationV6 {
    assert!(
        !soul::has_animacraft_appearance_v6(state),
        EAppearanceAlreadyBound,
    );
    assert_profile_root(profile, root);
    let proof = soul_owner_proof_v6::new(state, ctx);
    composition_v6::authorize_initial_loadout_v6(
        registry,
        composition_config,
        profile,
        root,
        commerce_config,
        soul::soul_id(state),
        client_nonce,
        loadout_hash,
        selections,
        proof,
        ctx,
    )
}

/// Claim a free Soul-bound Item using the live Soul state as the sole source
/// of both the Soul ID and its exact owner proof. Wallet callers never supply
/// an arbitrary Soul ID or construct the package-only proof themselves.
public fun claim_free_soul_item_v6(
    registry: &mut CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    commerce_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_profile_root(profile, root);
    let proof = soul_owner_proof_v6::new(state, ctx);
    composition_v6::claim_free_soul_item_v6(
        registry,
        composition_config,
        profile,
        product,
        root,
        commerce_config,
        soul::soul_id(state),
        proof,
        clock,
        ctx,
    );
}

/// Purchase a paid Soul-bound Item. The payment and trusted live Soul state
/// are consumed by the same transaction, preventing Soul-ID substitution.
public fun purchase_soul_item_v6<PaymentCoin>(
    registry: &mut CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    treasury: &mut CompositionProtocolTreasuryV6<PaymentCoin>,
    profile: &MakerProfileV6,
    product: &ItemProductV6,
    root: &MakerRootV5,
    commerce_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    payment: Coin<PaymentCoin>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_profile_root(profile, root);
    let proof = soul_owner_proof_v6::new(state, ctx);
    composition_v6::purchase_soul_item_v6(
        registry,
        composition_config,
        treasury,
        profile,
        product,
        root,
        commerce_config,
        soul::soul_id(state),
        proof,
        payment,
        clock,
        ctx,
    );
}

/// Lock an Owned Item to the caller's live Soul. The adapter binds the proof
/// and Soul ID to the same state object before Animacraft records the lock.
public fun lock_owned_item_to_soul_v6(
    registry: &mut CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    commerce_config: &CommerceProtocolConfigV5,
    item: &mut OwnedItemV6,
    state: &SoulState,
    ctx: &TxContext,
) {
    assert_profile_root(profile, root);
    let proof = soul_owner_proof_v6::new(state, ctx);
    composition_v6::lock_owned_item_to_soul_v6(
        registry,
        composition_config,
        profile,
        root,
        commerce_config,
        item,
        soul::soul_id(state),
        proof,
        ctx,
    );
}

/// Unlock an Owned Item from the caller's live Soul using the same exact
/// owner/state proof path as lock.
public fun unlock_owned_item_from_soul_v6(
    registry: &mut CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    commerce_config: &CommerceProtocolConfigV5,
    item: &mut OwnedItemV6,
    state: &SoulState,
    ctx: &TxContext,
) {
    assert_profile_root(profile, root);
    let proof = soul_owner_proof_v6::new(state, ctx);
    composition_v6::unlock_owned_item_from_soul_v6(
        registry,
        composition_config,
        profile,
        root,
        commerce_config,
        item,
        soul::soul_id(state),
        proof,
        ctx,
    );
}

/// Consume the no-ability initial authorization, independently re-check all
/// object links and bind the trusted commitment exactly once.  Genesis is
/// frozen and current appearance is shared by `appearance_v6`.
public fun bind_initial_appearance_v6(
    state: &mut SoulState,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    authorization: InitialLoadoutAuthorizationV6,
    ctx: &mut TxContext,
) {
    assert!(
        !soul::has_animacraft_appearance_v6(state),
        EAppearanceAlreadyBound,
    );
    assert_profile_root(profile, root);
    let (
        profile_id,
        root_id,
        soul_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        selections,
        wallet_bound_count,
        version,
    ) = composition_v6::consume_initial_loadout_authorization_v6(
        authorization,
    );
    let commitment = validate_authorization(
        state,
        profile,
        root,
        profile_id,
        root_id,
        soul_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        selections,
        wallet_bound_count,
        version,
    );
    appearance_v6::new_bind_and_publish(
        state,
        composition_v6::profile_mode_v6(profile),
        composition_v6::profile_loadout_mutable_v6(profile),
        commitment,
        ctx,
    );
}

/// Fail fixed, disabled, listed, stale-revision and ownership-stale updates
/// before Animacraft performs entitlement checks or consumes a nonce.  The
/// same state checks run again when the authorization is consumed.
public fun authorize_appearance_update_v6(
    registry: &mut CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    commerce_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    appearance: &SoulAppearanceStateV6,
    expected_revision: u64,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    selections: vector<LoadoutSelectionV6>,
    ctx: &TxContext,
): LoadoutAuthorizationV6 {
    appearance_v6::assert_can_authorize_update(
        state,
        appearance,
        expected_revision,
    );
    assert_profile_root(profile, root);
    assert_profile_matches_appearance(profile, root, appearance);
    let proof = soul_owner_proof_v6::new(state, ctx);
    composition_v6::authorize_loadout_v6(
        registry,
        composition_config,
        profile,
        root,
        commerce_config,
        soul::soul_id(state),
        client_nonce,
        loadout_hash,
        selections,
        proof,
        ctx,
    )
}

/// Consume an update authorization and advance current appearance by exactly
/// one revision.  A returned Animacraft authorization cannot be stored,
/// copied, dropped or reused, and it cannot cross a transaction boundary.
public fun apply_authorized_appearance_update_v6(
    state: &SoulState,
    appearance: &mut SoulAppearanceStateV6,
    expected_revision: u64,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    authorization: LoadoutAuthorizationV6,
) {
    assert_profile_root(profile, root);
    assert_profile_matches_appearance(profile, root, appearance);
    let (
        profile_id,
        root_id,
        soul_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        selections,
        wallet_bound_count,
        version,
    ) = composition_v6::consume_loadout_authorization_v6(authorization);
    let commitment = validate_authorization(
        state,
        profile,
        root,
        profile_id,
        root_id,
        soul_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        selections,
        wallet_bound_count,
        version,
    );
    appearance_v6::apply_authorized_loadout(
        state,
        appearance,
        expected_revision,
        commitment,
    );
}

/// Fail-closed bridge used by both v6 Soul listing and purchase.  It binds
/// the live Soulidity appearance companion to Animacraft's current v5/v6
/// protocol gates, exact Maker profile/root, canonical selection hash,
/// active admissions, entitlements and composition rules.  The check is
/// read-only and therefore safe to repeat at settlement after a listing was
/// created. Emergency gate or admission changes immediately stop purchases.
public fun assert_secondary_market_appearance_v6(
    registry: &CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    commerce_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    appearance: &SoulAppearanceStateV6,
    selections: &vector<LoadoutSelectionV6>,
) {
    appearance_v6::assert_matches_soul(appearance, state);
    assert_profile_root(profile, root);
    assert_profile_matches_appearance(profile, root, appearance);
    composition_v6::assert_secondary_market_loadout_v6(
        registry,
        composition_config,
        profile,
        root,
        commerce_config,
        soul::soul_id(state),
        appearance_v6::current_loadout_hash(appearance),
        selections,
    );
}

fun validate_authorization(
    state: &SoulState,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    profile_id: ID,
    root_id: ID,
    soul_id: ID,
    authorizer: address,
    client_nonce: vector<u8>,
    loadout_hash: vector<u8>,
    slot_schema_commitment: vector<u8>,
    selections: vector<LoadoutSelectionV6>,
    wallet_bound_count: u64,
    version: u64,
): AppearanceCommitmentV6 {
    assert!(soul_id == soul::soul_id(state), EAuthorizationSoulMismatch);
    assert!(
        authorizer == soul::current_owner(state),
        EAuthorizationOwnerMismatch,
    );
    assert!(
        profile_id == composition_v6::profile_id_v6(profile),
        EAuthorizationProfileMismatch,
    );
    assert!(root_id == commerce_v5::root_id_v5(root), EProfileRootMismatch);
    assert!(
        slot_schema_commitment
            == *composition_v6::profile_slot_schema_commitment_v6(profile),
        ESlotSchemaMismatch,
    );
    assert!(
        version == composition_v6::composition_protocol_version_v6(),
        EAuthorizationVersionMismatch,
    );
    let transfer_safe = transfer_safe_from_selections(
        &selections,
        wallet_bound_count,
    );
    appearance_v6::new_commitment(
        root_id,
        profile_id,
        authorizer,
        client_nonce,
        loadout_hash,
        slot_schema_commitment,
        *composition_v6::profile_extensions_hash_v6(profile),
        transfer_safe,
    )
}

fun assert_profile_root(profile: &MakerProfileV6, root: &MakerRootV5) {
    assert!(
        composition_v6::profile_root_id_v6(profile)
            == commerce_v5::root_id_v5(root),
        EProfileRootMismatch,
    );
}

fun assert_profile_matches_appearance(
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    appearance: &SoulAppearanceStateV6,
) {
    assert!(
        appearance_v6::profile_id(appearance)
            == composition_v6::profile_id_v6(profile),
        EAuthorizationProfileMismatch,
    );
    assert!(
        appearance_v6::maker_root_id(appearance)
            == commerce_v5::root_id_v5(root),
        EProfileRootMismatch,
    );
    assert!(
        appearance_v6::extensions_hash(appearance)
            == composition_v6::profile_extensions_hash_v6(profile),
        EExtensionsMismatch,
    );
}

/// Recompute transfer safety from the consumed selection vector rather than
/// trusting a caller-supplied boolean.  Any wallet-bound selection makes the
/// whole current loadout non-transferable; soul/embedded selections remain
/// safe across an owner rotation.
fun transfer_safe_from_selections(
    selections: &vector<LoadoutSelectionV6>,
    expected_wallet_bound_count: u64,
): bool {
    let mut wallet_bound_count = 0;
    let mut index = 0;
    while (index < selections.length()) {
        let selection = &selections[index];
        let subject_kind =
            composition_v6::loadout_selection_subject_kind_v6(selection);
        if (subject_kind == composition_v6::subject_wallet_v6()) {
            wallet_bound_count = wallet_bound_count + 1;
        } else {
            assert!(
                subject_kind == composition_v6::subject_soul_v6()
                    || subject_kind == composition_v6::subject_embedded_v6(),
                EInvalidSelectionSubject,
            );
        };
        let owned_instance_id =
            composition_v6::loadout_selection_owned_instance_id_v6(selection);
        if (owned_instance_id.is_some()) {
            assert!(
                subject_kind == composition_v6::subject_wallet_v6(),
                EOwnedInstanceSubjectMismatch,
            );
        };
        index = index + 1;
    };
    assert!(
        wallet_bound_count == expected_wallet_bound_count,
        EWalletBindingCountMismatch,
    );
    wallet_bound_count == 0
}
