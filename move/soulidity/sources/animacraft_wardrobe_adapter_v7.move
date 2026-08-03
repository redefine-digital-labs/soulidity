/// Soulidity-owned adapter for Animacraft's physical-composition-v7 ABI.
///
/// Wallet callers never supply an OwnerProof or a free-form Soul ID. Every
/// entry derives both from the live SoulState, verifies the exact wardrobe
/// dynamic-field binding, and lets Animacraft re-check all Maker/Profile links.
module soulidity::animacraft_wardrobe_adapter_v7;

use animacraft::commerce_v5::{
    Self as commerce_v5,
    CommerceProtocolConfigV5,
    MakerRootV5,
};
use animacraft::composition_v6::{
    Self as composition_v6,
    CompositionProtocolConfigV6,
    MakerProfileV6,
};
use animacraft::physical_composition_v7::{
    Self as physical_v7,
    MakerPhysicalProfileV7,
    PhysicalProtocolConfigV7,
    PhysicalRegistryV7,
    InitialPhysicalLoadoutAuthorizationV7,
    SoulWardrobeV7,
    StyleAssetV7,
    StyleProductV7,
};
use soulidity::animacraft_soul_owner_proof_v6 as owner_proof_v6;
use soulidity::soul::{Self as soul, SoulState};
use sui::transfer::Receiving;

const EWardrobeStateMismatch: u64 = 0;
const EPhysicalProfileStateMismatch: u64 = 1;

fun assert_canonical_profile_binding(
    state: &SoulState,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
) {
    let root_id = commerce_v5::root_id_v5(root);
    let v6_profile_id = composition_v6::profile_id_v6(v6_profile);
    assert!(
        soul::has_animacraft_provenance(state)
            && soul::has_animacraft_output_provenance_v5(state)
            && soul::has_animacraft_physical_v7_profile(state)
            && soul::animacraft_physical_v7_root_id(state) == root_id
            && soul::animacraft_physical_v7_composition_profile_id(state)
                == v6_profile_id
            && soul::animacraft_physical_v7_profile_id(state)
                == physical_v7::physical_profile_id_v7(profile),
        EPhysicalProfileStateMismatch,
    );
    physical_v7::assert_physical_profile_binding_v7(
        profile,
        root_id,
        v6_profile_id,
        composition_v6::profile_slot_schema_commitment_v6(v6_profile),
        composition_v6::profile_renderer_commitment_v6(v6_profile),
    );
}

fun assert_bound_wardrobe(state: &SoulState, wardrobe: &SoulWardrobeV7) {
    assert!(
        soul::has_animacraft_wardrobe_v7(state)
            && soul::animacraft_wardrobe_v7_id(state)
                == physical_v7::wardrobe_id_v7(wardrobe)
            && soul::soul_id(state) == physical_v7::wardrobe_soul_id_v7(wardrobe),
        EWardrobeStateMismatch,
    );
}

/// Start a canonical wardrobe in the same PTB that created SoulState. The
/// returned key-only value must be populated and finalized before the PTB can
/// succeed. Binding the exact ID first makes all legacy listings fail closed.
public fun create_soul_wardrobe_v7(
    registry: &mut PhysicalRegistryV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    initial_authorization: InitialPhysicalLoadoutAuthorizationV7,
    state: &mut SoulState,
    ctx: &mut TxContext,
): SoulWardrobeV7 {
    assert_canonical_profile_binding(state, profile, v6_profile, root);
    let proof = owner_proof_v6::new(state, ctx);
    let wardrobe = physical_v7::create_soul_wardrobe_v7(
        registry,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul::soul_id(state),
        initial_authorization,
        soul::animacraft_physical_v7_recipe_hash(state),
        proof,
        ctx,
    );
    soul::bind_animacraft_wardrobe_v7(
        state,
        physical_v7::wardrobe_id_v7(&wardrobe),
    );
    wardrobe
}

/// Materialize and equip one exact Included Style during the mint PTB.
public fun claim_initial_included_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    product: &mut StyleProductV7,
    state: &SoulState,
    expected_revision: u64,
    ctx: &mut TxContext,
) {
    assert_bound_wardrobe(state, wardrobe);
    let _owner_check = owner_proof_v6::new(state, ctx);
    physical_v7::claim_initial_included_style_v7(
        wardrobe,
        config,
        profile,
        v6_profile,
        product,
        soul::soul_id(state),
        expected_revision,
        ctx,
    );
}

/// Validate the non-empty canonical starting look and publish the wardrobe.
public fun finalize_soul_wardrobe_v7(
    wardrobe: SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    profile: &MakerPhysicalProfileV7,
    state: &SoulState,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_bound_wardrobe(state, &wardrobe);
    let proof = owner_proof_v6::new(state, ctx);
    physical_v7::finalize_soul_wardrobe_v7(
        wardrobe,
        config,
        profile,
        soul::soul_id(state),
        proof,
        expected_revision,
    );
}

public fun deposit_and_equip_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    product: &StyleProductV7,
    asset: StyleAssetV7,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_bound_wardrobe(state, wardrobe);
    let proof = owner_proof_v6::new(state, ctx);
    physical_v7::deposit_and_equip_style_v7(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        product,
        root,
        v5_config,
        soul::soul_id(state),
        proof,
        asset,
        expected_revision,
        ctx,
    );
}

public fun deposit_and_swap_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    product: &StyleProductV7,
    new_asset: StyleAssetV7,
    old_receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_bound_wardrobe(state, wardrobe);
    let proof = owner_proof_v6::new(state, ctx);
    physical_v7::deposit_and_swap_style_v7(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        product,
        root,
        v5_config,
        soul::soul_id(state),
        proof,
        new_asset,
        old_receiving,
        expected_revision,
        ctx,
    );
}

public fun equip_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    product: &StyleProductV7,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_bound_wardrobe(state, wardrobe);
    let proof = owner_proof_v6::new(state, ctx);
    physical_v7::equip_style_v7(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        product,
        root,
        v5_config,
        soul::soul_id(state),
        proof,
        receiving,
        expected_revision,
    );
}

public fun swap_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    product: &StyleProductV7,
    new_receiving: Receiving<StyleAssetV7>,
    old_receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_bound_wardrobe(state, wardrobe);
    let proof = owner_proof_v6::new(state, ctx);
    physical_v7::swap_style_v7(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        product,
        root,
        v5_config,
        soul::soul_id(state),
        proof,
        new_receiving,
        old_receiving,
        expected_revision,
    );
}

public fun unequip_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    v6_config: &CompositionProtocolConfigV6,
    profile: &MakerPhysicalProfileV7,
    v6_profile: &MakerProfileV6,
    root: &MakerRootV5,
    v5_config: &CommerceProtocolConfigV5,
    state: &SoulState,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_bound_wardrobe(state, wardrobe);
    let proof = owner_proof_v6::new(state, ctx);
    physical_v7::unequip_style_v7(
        wardrobe,
        config,
        v6_config,
        profile,
        v6_profile,
        root,
        v5_config,
        soul::soul_id(state),
        proof,
        receiving,
        expected_revision,
    );
}

/// Recovery stays available while Maker/composition gates are paused, but it
/// still requires the live owner, exact bound wardrobe and an unlisted Soul.
public fun withdraw_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    state: &SoulState,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_bound_wardrobe(state, wardrobe);
    let proof = owner_proof_v6::new(state, ctx);
    physical_v7::withdraw_style_v7(
        wardrobe,
        config,
        soul::soul_id(state),
        proof,
        receiving,
        expected_revision,
        ctx,
    );
}

/// Recover an equipped wallet-owned Style even while Maker or protocol gates
/// are paused. Listing remains blocked if this leaves a required slot empty.
public fun emergency_unequip_and_withdraw_style_v7(
    wardrobe: &mut SoulWardrobeV7,
    config: &PhysicalProtocolConfigV7,
    state: &SoulState,
    receiving: Receiving<StyleAssetV7>,
    expected_revision: u64,
    ctx: &TxContext,
) {
    assert_bound_wardrobe(state, wardrobe);
    let proof = owner_proof_v6::new(state, ctx);
    physical_v7::emergency_unequip_and_withdraw_style_v7(
        wardrobe,
        config,
        soul::soul_id(state),
        proof,
        receiving,
        expected_revision,
        ctx,
    );
}

/// Read-only market boundary. Current release deliberately blocks v7 listing,
/// but a future reviewed market wrapper must call this before taking custody.
public fun assert_wardrobe_transferable_v7(
    state: &SoulState,
    wardrobe: &SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
) {
    assert_bound_wardrobe(state, wardrobe);
    physical_v7::assert_wardrobe_transferable_v7(wardrobe, profile);
}
