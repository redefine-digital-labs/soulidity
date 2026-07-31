module soulidity::animacraft_output_seal;

use animacraft::commerce_v5::{Self as commerce, MakerRootV5};
use soulidity::animacraft_output_provenance_v5::{
    Self as output_provenance,
    AnimacraftOutputProvenanceV5,
};
use soulidity::animacraft_provenance::{
    Self as animacraft_provenance,
    AnimacraftProvenance,
};
use soulidity::soul::{Self as soul, SoulState};

const SEAL_ID_BYTES: u64 = 32;

const ENoAccess: u64 = 0;
const ENotCommerceV5: u64 = 1;
const EMakerRootMismatch: u64 = 2;
const EOutputRecordMismatch: u64 = 3;
const EOutputNotSoulBound: u64 = 4;

/// Seal key servers dry-run this function for an Animacraft commerce-v5
/// completed PNG. Access follows `SoulState.current_owner`, not the original
/// payer, so an authenticated Soul secondary sale only needs to rotate the
/// owner already frozen in Soulidity.
///
/// Every immutable edge is rechecked here:
/// - both provenance objects belong to this SoulState;
/// - MakerRootV5 is the one used by the original Complete;
/// - CompleteOutputRecordV5 is bound exactly once to this Soul;
/// - payer, Recipe hash, ciphertext Blob and Seal ID equal the base
///   provenance/companion snapshot;
/// - the requested Seal ID is rederived from the record itself.
public fun seal_approve_animacraft_complete_output_v5(
    id: vector<u8>,
    root: &MakerRootV5,
    provenance: &AnimacraftProvenance,
    completed_output: &AnimacraftOutputProvenanceV5,
    state: &SoulState,
    ctx: &TxContext,
) {
    assert!(id.length() == SEAL_ID_BYTES, ENoAccess);
    assert!(
        animacraft_provenance::is_v5_commerce_compatible(provenance),
        ENotCommerceV5,
    );
    animacraft_provenance::assert_matches_soul(provenance, state);
    output_provenance::assert_matches_soul(completed_output, state);
    output_provenance::assert_matches_root(completed_output, root);
    assert!(
        soul::current_owner(state) == ctx.sender(),
        ENoAccess,
    );
    assert!(
        commerce::root_id_v5(root)
            == animacraft_provenance::maker_id(provenance)
            && commerce::root_treasury_id_v5(root)
                == animacraft_provenance::maker_treasury_id(provenance),
        EMakerRootMismatch,
    );
    assert!(
        output_provenance::output_seal_id(completed_output) == &id
            && commerce::complete_output_exists_v5(root, id),
        EOutputRecordMismatch,
    );

    let output = commerce::complete_output_record_v5(root, id);
    assert!(
        commerce::complete_output_is_soul_bound_v5(output)
            && commerce::complete_output_bound_soul_id_v5(output)
                .contains(&soul::soul_id(state)),
        EOutputNotSoulBound,
    );
    assert!(
        commerce::complete_output_seal_id_v5(output) == &id
            && commerce::complete_output_payer_v5(output)
                == animacraft_provenance::payer(provenance)
            && commerce::complete_output_recipe_hash_v5(output)
                == animacraft_provenance::recipe_hash(provenance)
            && commerce::complete_output_ciphertext_blob_id_v5(output)
                == animacraft_provenance::image_blob_id(provenance)
            && !commerce::complete_output_ciphertext_blob_id_v5(output)
                .is_empty(),
        EOutputRecordMismatch,
    );
    assert!(
        commerce::derive_complete_output_seal_id_v5(
            commerce::root_id_v5(root),
            commerce::complete_output_payer_v5(output),
            *commerce::complete_output_recipe_hash_v5(output),
            *commerce::complete_output_nonce_v5(output),
            *commerce::complete_output_digest_v5(output),
        ) == id,
        EOutputRecordMismatch,
    );
}
