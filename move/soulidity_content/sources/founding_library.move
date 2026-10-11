/// Reusable real content custody for non-Maker creation. No canvas, Product,
/// publication artefact, shared reverse pointer or protocol issuance authority.
module soulidity_content::founding_library;
use std::bcs;
use std::hash;
use std::string::String;
use sui::clock::{Self,Clock};
use sui::dynamic_object_field as dof;
use sui::derived_object;
use sui::table::{Self,Table};
use walrus::blob::Blob;
use walrus::system::System;
use soulidity_standard::soul::Soul;
use soulidity_content::authority::{Self,Controller};
use soulidity_content::document::{Self,Record};
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_transport::storage_transport as storage;

const EVersion:u64=1;const EInvariant:u64=2;const EActive:u64=3;
const EBinding:u64=4;const EActor:u64=5;
public struct Name has copy,drop,store {kind:u32,name:String}
public struct Version has copy,drop,store {kind:u32,name:String,version:u64}
public struct BlobKey has copy,drop,store {index:u64}
public struct Entry has copy,drop,store {index:u64,hash:vector<u8>}
public struct Library has key,store {
    id:UID,root:ID,controller:Controller,revision:u64,
    records:Table<u64,Record>,counts:Table<Name,u64>,indices:Table<Version,u64>,
    active:Table<u32,u64>,entries:vector<Entry>,
}
/// Cannot be stored, dropped, transferred or converted to a visible library
/// without the private content operator and complete founding invariants.
public struct Founding {library:Library,actor:address}
public struct Commitment has drop {domain:vector<u8>,library:vector<u8>}

public fun begin<W:drop,P:key>(w:W,parent:&P,root:&Soul,ctx:&mut TxContext):Founding {
    Founding{library:Library{id:object::new(ctx),root:object::id(root),controller:authority::bind(w,parent,root),revision:0,
        records:table::new(ctx),counts:table::new(ctx),indices:table::new(ctx),active:table::new(ctx),entries:vector[]},actor:ctx.sender()}
}
/// The actual producer supplies its private registry UID internally. Allocate
/// directly in this defining module: Sui forbids packing an arbitrary UID
/// received as a function argument, including a UID allocated in another module.
public fun begin_derived<W:drop,P:key,K:copy+drop+store>(w:W,parent:&P,root:&Soul,registry:&mut UID,key:K,ctx:&mut TxContext):Founding {
    Founding{library:Library{id:derived_object::claim(registry,key),root:object::id(root),controller:authority::bind(w,parent,root),revision:0,
        records:table::new(ctx),counts:table::new(ctx),indices:table::new(ctx),active:table::new(ctx),entries:vector[]},actor:ctx.sender()}
}
public fun pending_id(f:&Founding):ID{object::id(&f.library)}
public fun root(l:&Library):ID{l.root}
public fun revision(l:&Library):u64{l.revision}
public fun count(l:&Library):u64{l.entries.length()}
public fun version_count(l:&Library,kind:u32,name:String):u64{let key=Name{kind,name};if(l.counts.contains(key))*l.counts.borrow(key) else 0}
public fun index(l:&Library,kind:u32,name:String,version:u64):Option<u64>{let key=Version{kind,name,version};if(l.indices.contains(key))option::some(*l.indices.borrow(key)) else option::none()}
public fun record(l:&Library,index:u64):&Record{l.records.borrow(index)}
public fun active(l:&Library,kind:u32):Option<u64>{if(l.active.contains(kind))option::some(*l.active.borrow(kind)) else option::none()}
public fun seal_id(l:&Library,index:u64):vector<u8>{document::seal_id(object::id(l),record(l,index))}
public fun blob_id(l:&Library,index:u64):ID{object::id(dof::borrow<BlobKey,Blob>(&l.id,BlobKey{index}))}
public fun assert_binding(l:&Library,parent:ID,root:ID){assert!(l.root==root && authority::root(&l.controller)==root && authority::parent(&l.controller)==parent,EBinding)}
public fun commitment(l:&Library):vector<u8>{hash::sha2_256(bcs::to_bytes(&Commitment{domain:b"soulidity/founding-library/v1",library:bcs::to_bytes(l)}))}
public fun assert_current(l:&Library,index:u64,system:&System){storage::assert_current(document::reference(record(l,index)),dof::borrow<BlobKey,Blob>(&l.id,BlobKey{index}),system)}

fun append_impl(l:&mut Library,registry:&KindRegistry,kind:u32,name:String,read:u64,download:u8,blob:Blob,system:&System,sha256:vector<u8>,nonce:vector<u8>,envelope:vector<u8>,expected:u64,set_active:bool,clock:&Clock,initial:bool):u64 {
    let version=version_count(l,kind,name);assert!(version==expected,EVersion);
    let descriptor=kind_registry::borrow_descriptor(registry,kind);
    let reference=storage::certified(&blob,system,sha256);
    let r=if(initial && (kind==0 || kind==1)) {
        if(kind==0)assert!(version==0,EInvariant);
        document::new_initial_invariant(descriptor,name,version,reference,read,download,nonce,envelope,clock::timestamp_ms(clock))
    } else document::new(descriptor,name,version,reference,read,download,nonce,envelope,clock::timestamp_ms(clock),false);
    if(set_active)assert!(kind_registry::descriptor_has_active_binding(descriptor),EActive);
    let index=count(l);let digest=hash::sha2_256(bcs::to_bytes(&r));
    l.records.add(index,r);l.indices.add(Version{kind,name,version},index);
    let key=Name{kind,name};if(l.counts.contains(key))*l.counts.borrow_mut(key)=version+1 else l.counts.add(key,version+1);
    dof::add(&mut l.id,BlobKey{index},blob);l.entries.push_back(Entry{index,hash:digest});
    if(set_active){if(l.active.contains(kind))*l.active.borrow_mut(kind)=index else l.active.add(kind,index)};
    l.revision=l.revision+1;index
}
public fun append_initial<W:drop>(w:W,f:&mut Founding,registry:&KindRegistry,kind:u32,name:String,read:u64,download:u8,blob:Blob,system:&System,sha256:vector<u8>,nonce:vector<u8>,envelope:vector<u8>,expected:u64,set_active:bool,clock:&Clock,ctx:&TxContext):u64 {
    authority::assert_operator(w,&f.library.controller);assert!(ctx.sender()==f.actor,EActor);
    append_impl(&mut f.library,registry,kind,name,read,download,blob,system,sha256,nonce,envelope,expected,set_active,clock,true)
}
/// Read back actual custody and availability at the final boundary. A copyable
/// Record or precomputed namespace cannot replace the original certified Blob.
public fun finish<W:drop>(w:W,f:Founding,system:&System,ctx:&TxContext):Library {
    let Founding{library,actor}=f;authority::assert_operator(w,&library.controller);assert!(actor==ctx.sender(),EActor);
    assert!(version_count(&library,0,document::soul_doc_name())==1 && version_count(&library,1,document::memory_name())>=1,EInvariant);
    let mut i=0;while(i < count(&library)){assert_current(&library,i,system);i=i+1};library
}
/// Ordinary append never takes the founding bypass, even if the caller builds
/// a copyable Record using new_initial_invariant outside this library.
public fun append<W:drop>(w:W,l:&mut Library,registry:&KindRegistry,kind:u32,name:String,read:u64,download:u8,blob:Blob,system:&System,sha256:vector<u8>,nonce:vector<u8>,envelope:vector<u8>,expected:u64,set_active:bool,clock:&Clock):u64 {
    authority::assert_operator(w,&l.controller);
    append_impl(l,registry,kind,name,read,download,blob,system,sha256,nonce,envelope,expected,set_active,clock,false)
}
