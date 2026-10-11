/// Free independent source; one actual seed can issue one standard root.
module independent_output::producer;
use soulidity_standard::soul::{Self,Soul};
public struct SoulProducer has drop {}
public struct Seed has key,store{id:UID,issued:bool}
public fun seed(ctx:&mut TxContext):Seed{Seed{id:object::new(ctx),issued:false}}
public fun mint(seed:&mut Seed,ctx:&mut TxContext):soul::Creation{assert!(!seed.issued,1);seed.issued=true;soul::new(SoulProducer{},seed,1,vector::tabulate!(32,|_|1),b"Independent OC".to_string(),ctx)}

/// Fixture obtains the actual public terminal's owned root in a later
/// transaction; it neither unpacks Creation nor grants raw fresh authority.
#[test_only]
public fun mint_owned_for_testing(seed:&mut Seed,sc:&mut sui::test_scenario::Scenario):Soul {
    let c=mint(seed,sc.ctx());let id=soul::creation_id(&c);
    soul::creation_deliver_sender(c,sc.ctx());let actor=sc.sender();sc.next_tx(actor);
    sc.take_from_sender_by_id(id)
}
