/// Private named libraries are encrypted references, never equipment or licences.
/// Namespace remains stable within a custody scope, including uncommitted upload recovery.
module soulidity_content::loadout;
use sui::table::{Self,Table};
use sui::dynamic_object_field as dof;
use std::bcs;
use std::hash;
use soulidity_transport::storage_transport::{Self as storage,Reference};
use walrus::blob::{Self,Blob};
use walrus::system::{Self,System};
use walrus::storage_resource::Storage;
const ERevision:u64=1;const ERequest:u64=2;const ECapture:u64=3;
const EReference:u64=4;const EHead:u64=5;const ESeal:u64=6;
public struct Library has key,store {id:UID,controller:soulidity_content::authority::Controller,root:ID,version:u16,count:u64,heads:Table<Scope,Head>,receipts:Table<Request,Receipt>}
public struct Scope has copy,drop,store {owner:address,generation:u64}
public struct Request has copy,drop,store {scope:Scope,id:vector<u8>}
public struct BlobKey has copy,drop,store {index:u64}
public struct Capture has copy,drop,store {composition:ID,revision:u64,commitment:vector<u8>}
public struct Receipt has copy,drop,store {index:u64,revision:u64,reference:Reference,capture:Option<Capture>}
public struct Head has copy,drop,store {revision:u64,request:vector<u8>,receipt:Receipt}
public struct Namespace has copy,drop,store {domain:vector<u8>,version:u16,root:ID,library:ID,scope:Scope}
public fun new<W:drop,P:key>(w:W,parent:&P,root:&soulidity_standard::soul::Soul,ctx:&mut TxContext):Library {
    let root_id=object::id(root);
    Library{controller:soulidity_content::authority::bind(w,parent,root),id:object::new(ctx),root:root_id,version:1,count:0,heads:table::new(ctx),receipts:table::new(ctx)}
}
public fun root(l:&Library):ID{l.root}
public fun version(l:&Library):u16{l.version}
public fun capture(composition:ID,revision:u64,commitment:vector<u8>):Capture {
    assert_hash(&commitment);assert!(composition!=object::id_from_address(@0x0),ECapture);Capture{composition,revision,commitment}
}
fun assert_hash(h:&vector<u8>){assert!(h.length()==32,EReference);let mut nonzero=false;h.do_ref!(|byte|{if(*byte!=0)nonzero=true});assert!(nonzero,EReference)}
public fun capture_composition(c:&Capture):ID{c.composition}
public fun capture_revision(c:&Capture):u64{c.revision}
public fun capture_commitment(c:&Capture):vector<u8>{c.commitment}
public fun head(l:&Library,owner:address,generation:u64):Option<Head> {
    let scope=Scope{owner,generation};if(l.heads.contains(scope))option::some(*l.heads.borrow(scope)) else option::none()
}
public fun current_revision(l:&Library,owner:address,generation:u64):u64 {
    let h=head(l,owner,generation);if(h.is_some())h.borrow().revision else 0
}
public fun receipt(l:&Library,owner:address,generation:u64,request:vector<u8>):Option<Receipt> {
    let key=Request{scope:Scope{owner,generation},id:request};
    if(l.receipts.contains(key))option::some(*l.receipts.borrow(key)) else option::none()
}
public fun head_revision(h:&Head):u64{h.revision}
public fun head_request(h:&Head):vector<u8>{h.request}
public fun head_receipt(h:&Head):Receipt{h.receipt}
public fun receipt_revision(r:&Receipt):u64{r.revision}
public fun receipt_reference(r:&Receipt):&Reference{&r.reference}
public fun receipt_capture(r:&Receipt):Option<Capture>{r.capture}
public fun seal_id(l:&Library,owner:address,generation:u64):vector<u8> {
    hash::sha2_256(bcs::to_bytes(&Namespace{domain:b"soulidity/private-named-loadouts/seal-id/v1",version:l.version,root:l.root,library:object::id(l),scope:Scope{owner,generation}}))
}
/// Package callers must obtain owner/generation from actual custody, never from a request.
fun internal_approve(id:vector<u8>,l:&Library,owner:address,generation:u64) {
    assert!(id==seal_id(l,owner,generation),ESeal)
}
/// Exact receipt recovery remains possible after subsequent equipment or library changes.
/// It does not consume another Blob and cannot rewrite a head or repeat a payment.
public fun assert_receipt(l:&Library,owner:address,generation:u64,request:vector<u8>,object_id:ID,sha256:vector<u8>,expected_capture:Option<Capture>):u64 {
    let r=receipt(l,owner,generation,request).destroy_some();
    assert!(storage::object_id(&r.reference)==object_id && storage::hash(&r.reference)==sha256,ERequest);
    assert!(r.capture==expected_capture,ECapture);r.revision
}
fun internal_commit(l:&mut Library,owner:address,generation:u64,expected:u64,request:vector<u8>,blob:Blob,system:&System,sha256:vector<u8>,capture:Option<Capture>):u64 {
    assert_hash(&request);assert_hash(&sha256);let scope=Scope{owner,generation};let key=Request{scope,id:request};
    // Permanent scoped receipts prevent reuse even after the client's 32-receipt window.
    assert!(!l.receipts.contains(key),ERequest);
    assert!(current_revision(l,owner,generation)==expected,ERevision);
    let reference=storage::certified(&blob,system,sha256);
    assert!(storage::bytes(&reference)<=16777216,EReference);
    let index=l.count;let revision=expected+1;let r=Receipt{index,revision,reference,capture};
    dof::add(&mut l.id,BlobKey{index},blob);l.count=index+1;l.receipts.add(key,r);
    let h=Head{revision,request,receipt:r};
    if(l.heads.contains(scope))*l.heads.borrow_mut(scope)=h else l.heads.add(scope,h);
    revision
}
public fun assert_capture(c:&Capture,composition:ID,revision:u64,commitment:vector<u8>) {
    assert!(c.composition==composition && c.revision==revision && c.commitment==commitment,ECapture)
}
fun internal_extend(l:&mut Library,receipt_owner:address,receipt_generation:u64,request:vector<u8>,extension:Storage,system:&System) {
    let r=receipt(l,receipt_owner,receipt_generation,request).destroy_some();
    let b:&mut Blob=dof::borrow_mut(&mut l.id,BlobKey{index:r.index});
    system::extend_blob_with_resource(system,b,extension);
    storage::assert_current(&r.reference,b,system)
}
/// Active heads may not be purged. Historical metadata/receipts remain for recovery.
fun internal_purge(l:&mut Library,owner:address,generation:u64,receipt_owner:address,receipt_generation:u64,request:vector<u8>) {
    let r=receipt(l,receipt_owner,receipt_generation,request).destroy_some();
    let h=head(l,owner,generation);
    assert!(h.is_none() || h.borrow().receipt.index!=r.index,EHead);
    let b:Blob=dof::remove(&mut l.id,BlobKey{index:r.index});blob::burn(b)
}
public fun available(l:&Library,r:&Receipt):bool{dof::exists_with_type<BlobKey,Blob>(&l.id,BlobKey{index:r.index})}
public fun assert_available(l:&Library,r:&Receipt,system:&System) {
    storage::assert_current(&r.reference,dof::borrow(&l.id,BlobKey{index:r.index}),system)
}

/// Cross-package methods require this instance's private application operator.
public fun approve<W:drop>(w:W,id:vector<u8>,l:&Library,owner:address,generation:u64) {
    soulidity_content::authority::assert_operator(w,&l.controller);
    internal_approve(id,l,owner,generation)
}

public fun commit<W:drop>(w:W,l:&mut Library,owner:address,generation:u64,expected:u64,request:vector<u8>,blob:Blob,system:&System,sha256:vector<u8>,capture:Option<Capture>):u64 {
    soulidity_content::authority::assert_operator(w,&l.controller);
    internal_commit(l,owner,generation,expected,request,blob,system,sha256,capture)
}

public fun extend<W:drop>(w:W,l:&mut Library,receipt_owner:address,receipt_generation:u64,request:vector<u8>,extension:Storage,system:&System) {
    soulidity_content::authority::assert_operator(w,&l.controller);
    internal_extend(l,receipt_owner,receipt_generation,request,extension,system)
}

public fun purge<W:drop>(w:W,l:&mut Library,owner:address,generation:u64,receipt_owner:address,receipt_generation:u64,request:vector<u8>) {
    soulidity_content::authority::assert_operator(w,&l.controller);
    internal_purge(l,owner,generation,receipt_owner,receipt_generation,request)
}
