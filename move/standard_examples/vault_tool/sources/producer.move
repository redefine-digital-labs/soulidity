module vault_tool_probe::producer;
use soulidity_standard::soul::{Self,Soul};
public struct SoulProducer has drop {}
public struct Source has key,store {id:UID}
public fun create(ctx:&mut TxContext):soul::Creation{let p=Source{id:object::new(ctx)};let s=soul::new(SoulProducer{},&p,1,std::hash::sha3_256(b"independent-vault-tool"),std::string::utf8(b"OC"),ctx);transfer::public_transfer(p,ctx.sender());s}

/// Fixture obtains the actual public terminal's owned root in a later
/// transaction; it neither unpacks Creation nor grants raw fresh authority.
#[test_only]
public fun create_owned_for_testing(sc:&mut sui::test_scenario::Scenario):Soul {
    let c=create(sc.ctx());let id=soul::creation_id(&c);
    soul::creation_deliver_sender(c,sc.ctx());let actor=sc.sender();sc.next_tx(actor);
    sc.take_from_sender_by_id(id)
}
