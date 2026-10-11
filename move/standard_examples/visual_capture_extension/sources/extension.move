/// Independent optional Soul visual snapshot. No native Core, Player, Product,
/// payment, native Physical asset or trusted publisher authority is acquired.
module independent_capture::extension;
use std::bcs;
use std::type_name;
use sui::dynamic_object_field as dof;
use soulidity_standard::soul::{Self,Soul};
use soulidity_model::assembly::{Self,Profile};
use soulidity_model::policy;
use soulidity_visual::visual;
use soulidity_application::output;
use soulidity_application::visual_capture::{Self,Capture};
public struct Seed has key,store {id:UID}
public struct Snapshot has key,store {id:UID,root:ID}
public struct SoulProducer has drop {}
public struct PolicyProducer has drop {}
public struct CaptureProducer has drop {}
public struct ExtensionWitness has drop {}
public struct CaptureKey has copy,drop,store {}
fun h():vector<u8>{vector::tabulate!(32,|_|7)}
public fun seed(ctx:&mut TxContext):Seed{Seed{id:object::new(ctx)}}
public fun mint(p:&Seed,ctx:&mut TxContext):soul::Creation{soul::new(SoulProducer{},p,1,h(),b"Independent OC".to_string(),ctx)}
fun profile(p:&Seed):Profile{
    let scene=visual::scene(32,32,visual::signed(false,0),visual::signed(false,0),0,h(),b"body",b"pose",vector[b"body"],vector[visual::track(b"main",0,false)],vector[],vector[visual::anchor(b"root",vector[],visual::signed(false,0),visual::signed(false,0))],vector[]);
    let scope=assembly::scope(PolicyProducer{},p,object::id_from_address(@0x42),1,h());assembly::profile(PolicyProducer{},p,scope,option::none(),scene,vector[b"body"],vector[])
}
public fun install(s:&mut Soul,p:&Seed,expected:u64,ctx:&mut TxContext):ID{
    let origin=soul::origin(s);assert!(soul::source(&origin)==object::id(p) && soul::source_type(&origin)==type_name::with_defining_ids<Seed>(),1);
    let mut e=Snapshot{id:object::new(ctx),root:object::id(s)};let c=visual_capture::new(CaptureProducer{},&e,object::id(s),soul::revision(s),profile(p),vector[],vector[],vector[],vector[output::scoped_slot(assembly::root_part(b"body"),option::none())],ctx);
    let id=object::id(&c);dof::add(&mut e.id,CaptureKey{},c);let semantic=commitment(&e);soul::install(s,ExtensionWitness{},b"visual-snapshot",e,1,true,semantic,expected);id
}
fun commitment(e:&Snapshot):vector<u8>{let mut bytes=bcs::to_bytes(e);bytes.append(visual_capture::commitment(capture(e)));policy::hash_bytes(bytes)}
public fun capture(e:&Snapshot):&Capture{dof::borrow(&e.id,CaptureKey{})}
public fun installed(s:&Soul):&Snapshot{soul::borrow_module<ExtensionWitness,Snapshot>(s,b"visual-snapshot")}
public fun uninstall(s:&mut Soul,expected:u64):Snapshot{soul::uninstall<ExtensionWitness,Snapshot>(s,b"visual-snapshot",expected)}
public fun destroy(mut e:Snapshot){let c=dof::remove(&mut e.id,CaptureKey{});visual_capture::destroy(CaptureProducer{},&e,c);let Snapshot{id,root:_}=e;id.delete()}

/// Fixture obtains the actual public terminal's owned root in a later
/// transaction; it neither unpacks Creation nor grants raw fresh authority.
#[test_only]
public fun mint_owned_for_testing(p:&Seed,sc:&mut sui::test_scenario::Scenario):Soul {
    let c=mint(p,sc.ctx());let id=soul::creation_id(&c);
    soul::creation_deliver_sender(c,sc.ctx());let actor=sc.sender();sc.next_tx(actor);
    sc.take_from_sender_by_id(id)
}
