/// Independent integration fixture, not the Animacraft commerce implementation.
module independent_maker::maker;
use std::bcs;
use std::hash;
use std::string::String;
use soulidity_standard::soul::{Self, Soul};

const ESupply: u64 = 1;
public struct Witness has drop {}
public struct SoulProducer has drop {}
public struct Maker has key, store {
    id: UID,
    version: u64,
    definition: vector<u8>,
    maximum: u64,
    issued: u64,
}
public struct Definition has copy, drop, store {
    domain: vector<u8>, version: u64, definition: vector<u8>, maximum: u64,
}

public fun new(definition: vector<u8>, maximum: u64, ctx: &mut TxContext): Maker {
    assert!(maximum > 0 && definition.length() > 0 && definition.length() <= 1024, ESupply);
    Maker { id: object::new(ctx), version: 1, definition, maximum, issued: 0 }
}

/// The owned Maker input authorizes this example's producer. Its module, not
/// the Soul kernel, checks supply and commits to its own published definition.
public fun mint(m: &mut Maker, name: String, ctx: &mut TxContext):soul::Creation {
    assert!(m.issued < m.maximum, ESupply);
    let s = soul::new(SoulProducer {}, m, m.version, definition_hash(m), name, ctx);
    m.issued = m.issued + 1;
    s
}
public fun definition_hash(m: &Maker): vector<u8> {
    hash::sha3_256(bcs::to_bytes(&Definition {
        domain: b"independent-maker/definition/v1", version: m.version,
        definition: m.definition, maximum: m.maximum,
    }))
}
public fun issued(m: &Maker): u64 { m.issued }
public fun maximum(m: &Maker): u64 { m.maximum }

/// Fixture obtains the actual public terminal's owned root in a later
/// transaction; it neither unpacks Creation nor grants raw fresh authority.
#[test_only]
public fun mint_owned_for_testing(m: &mut Maker, name: String,sc:&mut sui::test_scenario::Scenario):Soul {
    let c=mint(m,name,sc.ctx());let id=soul::creation_id(&c);
    soul::creation_deliver_sender(c,sc.ctx());let actor=sc.sender();sc.next_tx(actor);
    sc.take_from_sender_by_id(id)
}
