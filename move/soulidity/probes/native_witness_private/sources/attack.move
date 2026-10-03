module native_witness_private::attack;

use soulidity::animacraft_v8_binding::{Self as binding,
    MintBindingWitnessV8, SoulOwnerWitnessV8};
use soulidity::soul::SoulState;

/// A caller cannot turn an arbitrary SoulState/reference into a transferable
/// mint/owner proof. The trusted native wrappers must derive and consume it.
public fun steal_owner(state: &SoulState, ctx: &TxContext): SoulOwnerWitnessV8 {
    binding::owner_witness(state, ctx)
}

public fun steal_read_owner(state: &SoulState, ctx: &TxContext): SoulOwnerWitnessV8 {
    binding::read_owner_witness(state, ctx)
}

public fun steal_mint(
    state: &SoulState, commitment: vector<u8>, ctx: &TxContext,
): MintBindingWitnessV8 {
    binding::mint_witness(state, commitment, ctx)
}
