#[test_only]
module soulidity_v1::standard_extension_fixture;
use soulidity_standard::soul::{Self as standard,Soul};
use std::bcs;
use std::hash;
public struct Witness has drop {}
public struct SoulProducer has drop {}
public struct Experience has key,store {id:UID,root:ID,events:u64}
public fun install(s:&mut Soul,ctx:&mut TxContext):ID{
    let value=Experience{id:object::new(ctx),root:object::id(s),events:0};let id=object::id(&value);let hash=hash::sha3_256(bcs::to_bytes(&value));let rev=standard::revision(s);
    standard::install(s,Witness{},b"experience",value,1,true,hash,rev);id
}
public fun events(s:&Soul):u64{let x:&Experience=standard::borrow_module<Witness,Experience>(s,b"experience");x.events}
public fun update(s:&mut Soul){let rev=standard::revision(s);let(mut value,ticket)=standard::begin_update<Witness,Experience>(s,Witness{},b"experience",rev);assert!(value.root==object::id(s),0);value.events=value.events+1;let hash=hash::sha3_256(bcs::to_bytes(&value));standard::commit_update(s,ticket,Witness{},value,1,hash)}
public fun uninstall(s:&mut Soul):Experience{let rev=standard::revision(s);standard::uninstall<Witness,Experience>(s,b"experience",rev)}
public struct Seed has key,store {id:UID}
public fun bare_soul(ctx:&mut TxContext):(Seed,Soul){let seed=Seed{id:object::new(ctx)};let hash=hash::sha3_256(bcs::to_bytes(&seed));let root=standard::creation_raw_for_testing(standard::new(SoulProducer{},&seed,1,hash,std::string::utf8(b"foreign"),ctx));(seed,root)}
