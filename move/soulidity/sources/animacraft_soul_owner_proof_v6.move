module soulidity::animacraft_soul_owner_proof_v6;

use soulidity::soul::{Self as soul, SoulState};

const ESoulListed: u64 = 0;

/// Exact Soulidity-owned witness whose defining TypeName is governance-bound
/// in Animacraft's v6 protocol config. Animacraft intentionally knows nothing
/// about Soulidity objects; only this package can construct the proof, and it
/// does so after checking the live Soul owner and listing state.
public struct AnimacraftSoulOwnerProofV6 has drop {
    soul_id: ID,
    soul_state_id: ID,
    owner: address,
    ownership_epoch: u64,
}

public(package) fun new(
    state: &SoulState,
    ctx: &TxContext,
): AnimacraftSoulOwnerProofV6 {
    soul::assert_owner(state, ctx.sender());
    assert!(!soul::is_listed(state), ESoulListed);
    AnimacraftSoulOwnerProofV6 {
        soul_id: soul::soul_id(state),
        soul_state_id: object::id(state),
        owner: ctx.sender(),
        ownership_epoch: soul::ownership_epoch(state),
    }
}

public fun soul_id(self: &AnimacraftSoulOwnerProofV6): ID { self.soul_id }
public fun soul_state_id(self: &AnimacraftSoulOwnerProofV6): ID { self.soul_state_id }
public fun owner(self: &AnimacraftSoulOwnerProofV6): address { self.owner }
public fun ownership_epoch(self: &AnimacraftSoulOwnerProofV6): u64 {
    self.ownership_epoch
}
