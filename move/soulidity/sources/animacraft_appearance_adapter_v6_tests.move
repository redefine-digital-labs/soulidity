#[test_only]
module soulidity::animacraft_appearance_adapter_v6_tests;

use animacraft::animacraft::{OCMaker, ProtocolFeeAdminCap};
use animacraft::commerce_v5::{
    Self as commerce_v5,
    CommerceProtocolConfigV5,
    MakerControlCapV5,
    MakerRootV5,
};
use animacraft::composition_v6::{Self as composition_v6};
use soulidity::animacraft_appearance_adapter_v6 as adapter_v6;
use soulidity::animacraft_soul_owner_proof_v6::AnimacraftSoulOwnerProofV6;
use soulidity::soul::{Self as soul};
use std::string::String;
use sui::balance;
use sui::coin;
use sui::sui::SUI;

const SUCCESS: u8 = 0;
const WRONG_OWNER: u8 = 1;
const LISTED: u8 = 2;

fun commitment(value: u8): vector<u8> {
    let mut result = vector[];
    let mut index: u64 = 0;
    while (index < 32) {
        result.push_back(value);
        index = index + 1;
    };
    result
}

fun activate_v5(
    root: &mut MakerRootV5,
    cap: &MakerControlCapV5,
    maker: &OCMaker,
    config: &mut CommerceProtocolConfigV5,
    admin: &ProtocolFeeAdminCap,
    ctx: &TxContext,
) {
    commerce_v5::register_base_style_v5(
        root,
        cap,
        maker,
        b"eyes".to_string(),
        b"bright".to_string(),
        b"default".to_string(),
        ctx,
    );
    commerce_v5::register_base_style_v5(
        root,
        cap,
        maker,
        b"hat".to_string(),
        b"moon".to_string(),
        b"default".to_string(),
        ctx,
    );
    commerce_v5::seal_style_registry_v5(root, cap, ctx);
    commerce_v5::update_protocol_enabled_v5(config, admin, true);
    commerce_v5::activate_maker_v5(root, cap, ctx);
}

/// One world exercises the four public adapter calls. Failure stages branch
/// only immediately before lock, so both negative tests prove that no Owned
/// lock can be written with a stale/non-owner Soul state.
fun exercise_wallet_wrappers(stage: u8) {
    let mut ctx = sui::tx_context::new_from_hint(@0xA11, 701, 0, 0, 0);
    let clock = sui::clock::create_for_testing(&mut ctx);
    let (
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        mut v5_config,
        v5_protocol_treasury,
        mut root,
        v5_maker_treasury,
        vault,
        cap,
    ) = commerce_v5::v5_world_for_testing(
        commerce_v5::new_completion_policy(
            commerce_v5::policy_unlimited_free(),
            0,
            0,
        ),
        &mut ctx,
        &clock,
    );
    activate_v5(
        &mut root,
        &cap,
        &maker,
        &mut v5_config,
        &protocol_admin,
        &ctx,
    );

    let (
        mut config,
        mut protocol_treasury,
        mut registry,
        admin,
        validator,
    ) = composition_v6::new_composition_protocol_v6_for_testing<SUI>(
        &v5_config,
        &protocol_admin,
        commitment(90),
        &mut ctx,
    );
    composition_v6::bind_soul_owner_proof_type_v6<
        AnimacraftSoulOwnerProofV6,
    >(
        &mut config,
        &v5_config,
        &protocol_admin,
    );
    composition_v6::update_protocol_enabled_v6(
        &mut config,
        &v5_config,
        &protocol_admin,
        true,
    );
    let mut profile = composition_v6::new_maker_profile_v6_for_testing(
        &root,
        &cap,
        &config,
        &mut registry,
        composition_v6::profile_mode_composable_v6(),
        true,
        composition_v6::third_party_official_only_v6(),
        commitment(1),
        commitment(2),
        b"walrus-adapter-wallet-wrappers-v6".to_string(),
        commitment(3),
        commitment(4),
        &mut ctx,
    );
    composition_v6::seal_maker_profile_v6(
        &mut profile,
        &root,
        &cap,
        &config,
        &v5_config,
        &ctx,
    );

    let free_soul = composition_v6::new_official_item_product_v6_for_testing(
        &profile,
        &root,
        &cap,
        &config,
        commitment(10),
        commitment(11),
        commitment(12),
        b"aura".to_string(),
        composition_v6::access_free_v6(),
        composition_v6::binding_soul_v6(),
        0,
        0,
        false,
        vector[],
        vector[],
        commitment(13),
        &mut ctx,
    );
    let paid_soul = composition_v6::new_official_item_product_v6_for_testing(
        &profile,
        &root,
        &cap,
        &config,
        commitment(20),
        commitment(21),
        commitment(22),
        b"memory".to_string(),
        composition_v6::access_paid_v6(),
        composition_v6::binding_soul_v6(),
        1_000,
        0,
        false,
        vector[],
        vector[],
        commitment(23),
        &mut ctx,
    );
    let owned_product =
        composition_v6::new_official_item_product_v6_for_testing(
            &profile,
            &root,
            &cap,
            &config,
            commitment(30),
            commitment(31),
            commitment(32),
            b"outfit".to_string(),
            composition_v6::access_free_v6(),
            composition_v6::binding_owned_v6(),
            0,
            0,
            true,
            vector[],
            vector[],
            commitment(33),
            &mut ctx,
        );

    let free_attestation =
        composition_v6::new_validator_attestation_v6_for_testing(
            &config,
            &validator,
            &profile,
            &free_soul,
            &clock,
            &mut ctx,
        );
    let paid_attestation =
        composition_v6::new_validator_attestation_v6_for_testing(
            &config,
            &validator,
            &profile,
            &paid_soul,
            &clock,
            &mut ctx,
        );
    let owned_attestation =
        composition_v6::new_validator_attestation_v6_for_testing(
            &config,
            &validator,
            &profile,
            &owned_product,
            &clock,
            &mut ctx,
        );
    composition_v6::admit_official_item_v6(
        &mut profile,
        &free_soul,
        &free_attestation,
        &root,
        &cap,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    composition_v6::admit_official_item_v6(
        &mut profile,
        &paid_soul,
        &paid_attestation,
        &root,
        &cap,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );
    composition_v6::admit_official_item_v6(
        &mut profile,
        &owned_product,
        &owned_attestation,
        &root,
        &cap,
        &config,
        &v5_config,
        &clock,
        &ctx,
    );

    let mut owned = composition_v6::claim_free_wallet_item_v6_for_testing(
        &mut registry,
        &config,
        &profile,
        &owned_product,
        &root,
        &v5_config,
        &clock,
        &mut ctx,
    ).destroy_some();
    let state_owner = if (stage == WRONG_OWNER) @0xB11 else @0xA11;
    let mut state = soul::create_state(
        object::id_from_address(@0x5001),
        @0xA11,
        0,
        state_owner,
        object::id_from_address(@0x6001),
        &mut ctx,
    );
    if (stage == LISTED) soul::set_listed(&mut state, true);

    if (stage != SUCCESS) {
        adapter_v6::lock_owned_item_to_soul_v6(
            &mut registry,
            &config,
            &profile,
            &root,
            &v5_config,
            &mut owned,
            &state,
            &ctx,
        );
        abort 99
    };

    adapter_v6::claim_free_soul_item_v6(
        &mut registry,
        &config,
        &profile,
        &free_soul,
        &root,
        &v5_config,
        &state,
        &clock,
        &ctx,
    );
    let payment = coin::from_balance(
        balance::create_for_testing<SUI>(1_000),
        &mut ctx,
    );
    adapter_v6::purchase_soul_item_v6(
        &mut registry,
        &config,
        &mut protocol_treasury,
        &profile,
        &paid_soul,
        &root,
        &v5_config,
        &state,
        payment,
        &clock,
        &mut ctx,
    );
    assert!(composition_v6::soul_entitlement_exists_v6(
        &registry,
        object::id(&profile),
        object::id(&free_soul),
        soul::soul_id(&state),
    ));
    assert!(composition_v6::soul_entitlement_exists_v6(
        &registry,
        object::id(&profile),
        object::id(&paid_soul),
        soul::soul_id(&state),
    ));
    assert!(composition_v6::protocol_treasury_balance_v6(
        &protocol_treasury,
    ) == 100);

    adapter_v6::lock_owned_item_to_soul_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        &mut owned,
        &state,
        &ctx,
    );
    let locked_soul = composition_v6::owned_item_locked_soul_v6(&owned);
    assert!(locked_soul.is_some());
    assert!(*locked_soul.borrow() == soul::soul_id(&state));
    adapter_v6::unlock_owned_item_from_soul_v6(
        &mut registry,
        &config,
        &profile,
        &root,
        &v5_config,
        &mut owned,
        &state,
        &ctx,
    );
    assert!(composition_v6::owned_item_locked_soul_v6(&owned).is_none());

    soul::destroy_state_for_testing(state);
    composition_v6::destroy_owned_item_v6_for_testing(owned);
    composition_v6::destroy_validator_attestation_v6_for_testing(
        free_attestation,
    );
    composition_v6::destroy_validator_attestation_v6_for_testing(
        paid_attestation,
    );
    composition_v6::destroy_validator_attestation_v6_for_testing(
        owned_attestation,
    );
    composition_v6::destroy_item_product_v6_for_testing(free_soul);
    composition_v6::destroy_item_product_v6_for_testing(paid_soul);
    composition_v6::destroy_item_product_v6_for_testing(owned_product);
    composition_v6::destroy_profile_v6_for_testing(profile);
    composition_v6::destroy_composition_protocol_v6_for_testing(
        config,
        protocol_treasury,
        registry,
        admin,
        validator,
    );
    sui::clock::destroy_for_testing(clock);
    commerce_v5::destroy_v5_world_for_testing(
        legacy_profile,
        maker,
        legacy_treasury,
        legacy_config,
        legacy_protocol_treasury,
        protocol_admin,
        v5_config,
        v5_protocol_treasury,
        root,
        v5_maker_treasury,
        vault,
        cap,
    );
}

#[test]
fun wallet_wrappers_bind_live_soul_entitlements_and_owned_lock() {
    exercise_wallet_wrappers(SUCCESS)
}

#[test, expected_failure(abort_code = 1, location = soulidity::soul)]
fun wallet_wrapper_rejects_wrong_soul_owner_before_lock() {
    exercise_wallet_wrappers(WRONG_OWNER)
}

#[test, expected_failure(
    abort_code = 0,
    location = soulidity::animacraft_soul_owner_proof_v6,
)]
fun wallet_wrapper_rejects_listed_soul_before_lock() {
    exercise_wallet_wrappers(LISTED)
}
