module soulidity::animacraft_output_provenance_v5;

use animacraft::commerce_v5::{Self as animacraft_commerce_v5, MakerRootV5};
use soulidity::soul::{Self as soul, SoulState};
use sui::event;

const VERSION: u64 = 1;
const SEAL_ID_BYTES: u64 = 32;

const ESoulMismatch: u64 = 0;
const ERootMismatch: u64 = 1;
const EBaseProvenanceMismatch: u64 = 2;
const ESealIdMismatch: u64 = 3;

/// Immutable commerce-v5 companion to the already deployed
/// `AnimacraftProvenance` type. Keeping this as a separate frozen object
/// preserves v4 object-layout compatibility while giving Seal key servers an
/// exact on-chain binding from a completed output to its Soul.
public struct AnimacraftOutputProvenanceV5 has key {
    id: UID,
    version: u64,
    soul_id: ID,
    base_provenance_id: ID,
    maker_root_id: ID,
    complete_output_seal_id: vector<u8>,
}

public struct AnimacraftOutputProvenanceV5Created has copy, drop {
    output_provenance_id: ID,
    base_provenance_id: ID,
    soul_id: ID,
    state_id: ID,
    maker_root_id: ID,
    complete_output_seal_id: vector<u8>,
}

public(package) fun new_bind_and_freeze(
    state: &mut SoulState,
    root: &MakerRootV5,
    complete_output_seal_id: vector<u8>,
    ctx: &mut TxContext,
) {
    assert!(
        complete_output_seal_id.length() == SEAL_ID_BYTES,
        ESealIdMismatch,
    );
    let soul_id = soul::soul_id(state);
    let base_provenance_id = soul::animacraft_provenance_id(state);
    let maker_root_id = animacraft_commerce_v5::root_id_v5(root);
    let provenance = AnimacraftOutputProvenanceV5 {
        id: object::new(ctx),
        version: VERSION,
        soul_id,
        base_provenance_id,
        maker_root_id,
        complete_output_seal_id,
    };
    let output_provenance_id = object::id(&provenance);
    soul::bind_animacraft_output_provenance_v5(
        state,
        output_provenance_id,
    );
    event::emit(AnimacraftOutputProvenanceV5Created {
        output_provenance_id,
        base_provenance_id,
        soul_id,
        state_id: object::id(state),
        maker_root_id,
        complete_output_seal_id:
            *output_seal_id(&provenance),
    });
    transfer::freeze_object(provenance);
}

public fun assert_matches_soul(
    self: &AnimacraftOutputProvenanceV5,
    state: &SoulState,
) {
    assert!(self.soul_id == soul::soul_id(state), ESoulMismatch);
    assert!(
        object::id(self)
            == soul::animacraft_output_provenance_v5_id(state),
        ESoulMismatch,
    );
    assert!(
        self.base_provenance_id == soul::animacraft_provenance_id(state),
        EBaseProvenanceMismatch,
    );
}

public fun assert_matches_root(
    self: &AnimacraftOutputProvenanceV5,
    root: &MakerRootV5,
) {
    assert!(
        self.maker_root_id == animacraft_commerce_v5::root_id_v5(root),
        ERootMismatch,
    );
}

public fun provenance_id(self: &AnimacraftOutputProvenanceV5): ID {
    object::id(self)
}

public fun version(self: &AnimacraftOutputProvenanceV5): u64 {
    self.version
}

public fun soul_id(self: &AnimacraftOutputProvenanceV5): ID {
    self.soul_id
}

public fun base_provenance_id(
    self: &AnimacraftOutputProvenanceV5,
): ID {
    self.base_provenance_id
}

public fun maker_root_id(self: &AnimacraftOutputProvenanceV5): ID {
    self.maker_root_id
}

public fun output_seal_id(
    self: &AnimacraftOutputProvenanceV5,
): &vector<u8> {
    &self.complete_output_seal_id
}
