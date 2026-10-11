/// An optional independent output application, not a native Complete producer.
/// No Core dependency. Its private operator controls only its own artifact.
module independent_output::extension;
use std::bcs;
use std::hash;
use sui::dynamic_object_field as dof;
use soulidity_standard::soul::{Self,Soul};
use soulidity_application::output::{Self,Artifact};
use soulidity_maker_publication::output_data::{Intent,Policy,RecipeSlot,Receipt};
use soulidity_visual::visual::{Scene,ColorChoice};
use soulidity_model::assembly::{ProfileSnapshot,Profile};
use walrus::blob::Blob;
use walrus::system::System;
public struct ContentOperator has drop {}
public struct ExtensionWitness has drop {}
public struct Extension has key,store{id:UID,root:ID,artifact:ID,revision:u64,last_change:vector<u8>}
public struct ArtifactKey has copy,drop,store {}
fun commitment(e:&Extension):vector<u8>{
    let a:&Artifact=dof::borrow(&e.id,ArtifactKey{});let mut bytes=bcs::to_bytes(e);
    bytes.append(output::intent_hash(output::artifact_intent(a)));bytes.append(output::original_recipe_hash(a));bytes.append(output::receipt_hash(output::artifact_receipt(a)));bytes.append(bcs::to_bytes(output::render(a)));hash::sha3_256(bytes)
}
public fun install(s:&mut Soul,intent:Intent,policy:Policy,recipe:vector<RecipeSlot>,scene:Scene,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,published:vector<Profile>,blob:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,receipt:Receipt,expected:u64,ctx:&mut TxContext):ID{
    let mut e=Extension{id:object::new(ctx),root:object::id(s),artifact:object::id_from_address(@0x0),revision:0,last_change:vector[]};
    let creation=output::authorize(ContentOperator{},&e,s,&intent);
    let a=output::new(creation,intent,policy,recipe,scene,colors,profiles,published,blob,system,sha256,envelope,receipt,ctx);let id=object::id(&a);e.artifact=id;dof::add(&mut e.id,ArtifactKey{},a);
    let h=commitment(&e);soul::install(s,ExtensionWitness{},b"genesis-output",e,1,false,h,expected);id
}
public fun artifact(s:&Soul):&Artifact{let e=soul::borrow_module<ExtensionWitness,Extension>(s,b"genesis-output");dof::borrow(&e.id,ArtifactKey{})}
public fun reserve(s:&mut Soul,key:vector<u8>,value:vector<u8>,expected:u64){
    let(mut e,ticket)=soul::begin_update<ExtensionWitness,Extension>(s,ExtensionWitness{},b"genesis-output",expected);assert!(e.root==object::id(s),1);
    output::reserve_materialization(ContentOperator{},dof::borrow_mut(&mut e.id,ArtifactKey{}),key,value);let mut change=e.last_change;change.append(bcs::to_bytes(&key));change.append(value);e.last_change=hash::sha3_256(change);e.revision=e.revision+1;
    let h=commitment(&e);soul::commit_update(s,ticket,ExtensionWitness{},e,1,h)
}
/// Requires actual mutable root custody; containers must enforce their own
/// custody policy before exposing it. No universal transfer revocation claim.
public fun approve_owner(id:vector<u8>,s:&mut Soul,system:&System){output::assert_read(ContentOperator{},artifact(s),id,system)}
