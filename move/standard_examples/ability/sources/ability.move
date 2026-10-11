/// Third-party namespace with application-checked feedback and semantic hash.
module independent_ability::ability;
use std::bcs;
use std::hash;
use soulidity_standard::soul::{Self, Soul, Edit};

const ETarget: u64 = 1;
const EScore: u64 = 2;
public struct Witness has drop {}
public struct Ability has key, store { id: UID, soul: ID, score: u64 }
public struct State has copy, drop, store { domain: vector<u8>, soul: ID, score: u64 }

fun semantic(a: &Ability): vector<u8> {
    hash::sha3_256(bcs::to_bytes(&State { domain: b"independent-ability/state/v1", soul: a.soul, score: a.score }))
}
public fun install(s: &mut Soul, score: u64, permanent: bool, expected: u64, ctx: &mut TxContext) {
    assert!(score <= 100, EScore);
    let a = Ability { id: object::new(ctx), soul: object::id(s), score };
    let commitment = semantic(&a);
    soul::install(s, Witness {}, b"ability", a, 1, !permanent, commitment, expected)
}
public fun update(s: &mut Soul, score: u64, expected: u64) {
    assert!(score <= 100, EScore);
    let (a, edit) = start_update(s, expected);
    finish_update(s, edit, a, score)
}
public fun start_update(s: &mut Soul, expected: u64): (Ability, Edit<Witness, Ability>) {
    soul::begin_update<Witness, Ability>(s, Witness {}, b"ability", expected)
}
public fun finish_update(s: &mut Soul, edit: Edit<Witness, Ability>, mut a: Ability, score: u64) {
    assert!(score <= 100, EScore);
    assert!(a.soul == object::id(s), ETarget);
    a.score = score;
    let commitment = semantic(&a);
    soul::commit_update(s, edit, Witness {}, a, 1, commitment)
}
public fun remove(s: &mut Soul, expected: u64): Ability {
    soul::uninstall<Witness, Ability>(s, b"ability", expected)
}
public fun reattach(s: &mut Soul, a: Ability, expected: u64) {
    assert!(a.soul == object::id(s), ETarget);
    let commitment = semantic(&a);
    soul::install(s, Witness {}, b"ability", a, 1, true, commitment, expected)
}
public fun score(s: &Soul): u64 { soul::borrow_module<Witness, Ability>(s, b"ability").score }
public fun descriptor(s: &Soul): soul::Descriptor { soul::descriptor<Witness>(s, b"ability").destroy_some() }
public fun score_of(a: &Ability): u64 { a.score }
public fun target(a: &Ability): ID { a.soul }
