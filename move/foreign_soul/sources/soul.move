#[test_only]
module foreign_soul::soul;
public struct Witness has drop {}
public struct Soul has key,store {id:UID,value:u64}
/// Explicit dev-only source fixture permits nominal generic installation.
/// Returned W is not a production private handover acknowledgment authority.
public fun new(ctx:&mut TxContext):(Witness,Soul) {
 (Witness{},Soul{id:object::new(ctx),value:71})
}
public fun value(s:&Soul):u64{s.value}
