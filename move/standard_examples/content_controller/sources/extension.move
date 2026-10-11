/// Independent installed content controller. No Maker/Animacraft/visual import.
/// This prototype manages its own namespace; it never approves native content.
module independent_content::extension;
use std::bcs;
use std::hash;
use sui::clock::Clock;
use sui::dynamic_object_field as dof;
use soulidity_standard::soul::{Self,Soul};
use soulidity_content::authorization::{Self,Authorization,Grant};
use soulidity_content::loadout::{Self,Library};
public struct ContentOperator has drop {}
public struct ExtensionWitness has drop {}
public struct Extension has key,store {id:UID,root:ID,revision:u64,last_change:vector<u8>}
public struct GrantsKey has copy,drop,store {}
public struct LibraryKey has copy,drop,store {}
fun grants(e:&Extension):&Authorization{dof::borrow(&e.id,GrantsKey{})}
fun grants_mut(e:&mut Extension):&mut Authorization{dof::borrow_mut(&mut e.id,GrantsKey{})}
fun library(e:&Extension):&Library{dof::borrow(&e.id,LibraryKey{})}
fun commitment(e:&Extension):vector<u8>{hash::sha2_256(bcs::to_bytes(e))}
public fun install(s:&mut Soul,expected:u64,ctx:&mut TxContext){
    let mut e=Extension{id:object::new(ctx),root:object::id(s),revision:0,last_change:vector[]};
    let a=authorization::new(ContentOperator{},&e,s,ctx);let l=loadout::new(ContentOperator{},&e,s,ctx);
    dof::add(&mut e.id,GrantsKey{},a);dof::add(&mut e.id,LibraryKey{},l);
    let h=commitment(&e);soul::install(s,ExtensionWitness{},b"private-content",e,1,false,h,expected)
}
/// Mutable actual Soul is required. Arbitrary root IDs and copied Grants are
/// not accepted. A container exposing mutable Soul must enforce its custody.
public fun grant(s:&mut Soul,grantee:address,scope:u64,expiry:Option<u64>,expected_slot:Option<vector<u8>>,expected:u64,clock:&Clock,ctx:&TxContext):u64{
    let(mut e,ticket)=soul::begin_update<ExtensionWitness,Extension>(s,ExtensionWitness{},b"private-content",expected);
    assert!(e.root==object::id(s),1);let seq=authorization::issue(ContentOperator{},grants_mut(&mut e),grantee,scope,expiry,expected_slot,clock,ctx);
    e.revision=e.revision+1;e.last_change=authorization::grant_hash(grants(&e),grantee).destroy_some();let h=commitment(&e);
    soul::commit_update(s,ticket,ExtensionWitness{},e,1,h);seq
}
public fun clear(s:&mut Soul,expected:u64){
    let(mut e,ticket)=soul::begin_update<ExtensionWitness,Extension>(s,ExtensionWitness{},b"private-content",expected);assert!(e.root==object::id(s),1);
    authorization::clear(ContentOperator{},grants_mut(&mut e));e.revision=e.revision+1;e.last_change=vector[];let h=commitment(&e);
    soul::commit_update(s,ticket,ExtensionWitness{},e,1,h)
}
/// Owner-context query for this extension only, not a Seal decryption endpoint.
public fun permits(s:&mut Soul,grantee:address,scope:u64,clock:&Clock,ctx:&TxContext):bool{
    let e=soul::borrow_module<ExtensionWitness,Extension>(s,b"private-content");assert!(e.root==object::id(s),1);
    authorization::permits(ContentOperator{},grants(e),ctx.sender(),grantee,scope,clock)
}
public fun record(s:&Soul,grantee:address):Option<Grant>{authorization::grant(grants(soul::borrow_module<ExtensionWitness,Extension>(s,b"private-content")),grantee)}
public fun revision(s:&Soul):u64{soul::borrow_module<ExtensionWitness,Extension>(s,b"private-content").revision}
public fun library_id(s:&Soul):ID{object::id(library(soul::borrow_module<ExtensionWitness,Extension>(s,b"private-content")))}
public fun library_namespace(s:&Soul,owner:address):vector<u8>{let e=soul::borrow_module<ExtensionWitness,Extension>(s,b"private-content");loadout::seal_id(library(e),owner,authorization::generation(grants(e)))}
#[test_only]
public struct SoulProducer has drop {}
#[test_only]
public struct TestSource has key {id:UID}
#[test_only]
public fun mint_for_testing(sc:&mut sui::test_scenario::Scenario):Soul{
    let source=TestSource{id:object::new(sc.ctx())};let s=soul::new(SoulProducer{},&source,1,vector::tabulate!(32,|_|1),b"Independent".to_string(),sc.ctx());let id=soul::creation_id(&s);let TestSource{id:source_id}=source;source_id.delete();soul::creation_deliver_sender(s,sc.ctx());let actor=sc.sender();sc.next_tx(actor);sc.take_from_sender_by_id(id)
}
