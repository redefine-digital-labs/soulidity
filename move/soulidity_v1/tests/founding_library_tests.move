#[test_only]
module soulidity_v1::founding_library_tests;
use std::string;
use sui::clock::{Self,Clock};
use sui::test_scenario::{Self,Scenario};
use soulidity_standard::soul::{Self,Soul};
use soulidity_content::founding_library::{Self as library,Founding,Library};
use soulidity_content::document;
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry,KindAdminCap};
use soulidity_transport::storage_transport as storage;
use soulidity_v1::storage_fixture;
use walrus::system::System;
public struct Parent has key,store {id:UID}
public struct SoulProducer has drop {}
public struct ContentOperator has drop {}
public struct Impostor has drop {}
fun h(n:u8):vector<u8>{vector::tabulate!(32,|_|n)}
fun nonce(n:u8):vector<u8>{vector::tabulate!(16,|_|n)}
/// Independent producer and actual dependency System; no Maker fixture.
/// This exercises the reusable content carrier, not completed native issuance.
fun setup():(Scenario,Parent,Soul,KindRegistry,System,Clock,Founding){
    let mut sc=test_scenario::begin(@0xb);kind_registry::init_for_testing(sc.ctx());storage_fixture::initialize(&mut sc);
    let registry:KindRegistry=sc.take_shared();let system:System=sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let parent=Parent{id:object::new(sc.ctx())};let root=soul::creation_raw_for_testing(soul::new(SoulProducer{},&parent,1,h(99),string::utf8(b"Independent OC"),sc.ctx()));
    let f=library::begin(ContentOperator{},&parent,&root,sc.ctx());(sc,parent,root,registry,system,clock,f)
}
fun append(sc:&mut Scenario,f:&mut Founding,r:&KindRegistry,sys:&mut System,c:&Clock,kind:u32,name:vector<u8>,read:u64,expected:u64,active:bool,n:u8):u64{
    let blob=storage_fixture::blob(sys,n as u256,false,true,sc.ctx());
    library::append_initial(ContentOperator{},f,r,kind,string::utf8(name),read,0,blob,sys,h(n),nonce(n),b"opaque-envelope",expected,active,c,sc.ctx())
}
fun complete(sc:&mut Scenario,f:Founding,r:&KindRegistry,sys:&mut System,c:&Clock):Library{
    let mut f=f;append(sc,&mut f,r,sys,c,0,b"soul",3,0,false,1);append(sc,&mut f,r,sys,c,1,b"default",3,0,false,2);library::finish(ContentOperator{},f,sys,sc.ctx())
}
fun end(mut sc:Scenario,parent:Parent,root:Soul,r:KindRegistry,sys:System,c:Clock,l:Library){
    assert!(library::root(&l)==object::id(&root),90);library::assert_binding(&l,object::id(&parent),object::id(&root));
    transfer::public_transfer(l,@0xb);transfer::public_transfer(parent,@0xb);transfer::public_transfer(root,@0xb);
    test_scenario::return_shared(r);storage_fixture::return_system(sys);clock::destroy_for_testing(c);sc.end();
}
#[test]
fun complete_content_keeps_actual_blobs_versions_envelopes_and_namespace(){
    let(mut sc,p,s,r,mut sys,c,mut f)=setup();let id=library::pending_id(&f);
    append(&mut sc,&mut f,&r,&mut sys,&c,0,b"soul",3,0,false,1);
    append(&mut sc,&mut f,&r,&mut sys,&c,1,b"default",3,0,false,2);
    append(&mut sc,&mut f,&r,&mut sys,&c,1,b"default",3,1,false,3);
    append(&mut sc,&mut f,&r,&mut sys,&c,3,b"main",9,0,true,4);
    let mut l=library::finish(ContentOperator{},f,&sys,sc.ctx());
    assert!(object::id(&l)==id && library::count(&l)==4 && library::version_count(&l,1,document::memory_name())==2,0);
    assert!(library::index(&l,1,document::memory_name(),1)==option::some(2) && library::active(&l,3)==option::some(3),1);
    let rec=library::record(&l,2);assert!(document::envelope(rec)==&b"opaque-envelope" && storage::object_id(document::reference(rec))==library::blob_id(&l,2),2);
    assert!(library::seal_id(&l,2)==document::namespace(id,1,document::memory_name(),1,nonce(3)),3);
    let before=library::commitment(&l);let blob=storage_fixture::blob(&mut sys,5,false,true,sc.ctx());
    let i=library::append(ContentOperator{},&mut l,&r,1,document::memory_name(),3,0,blob,&sys,h(5),nonce(5),b"later",2,false,&c);
    assert!(i==4 && library::revision(&l)==5 && before!=library::commitment(&l),4);end(sc,p,s,r,sys,c,l)
}
#[test,expected_failure(abort_code=2,location=soulidity_content::founding_library)]
fun cannot_finish_without_memory(){let(mut sc,p,s,r,mut sys,c,mut f)=setup();append(&mut sc,&mut f,&r,&mut sys,&c,0,b"soul",3,0,false,1);let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)}
#[test,expected_failure(abort_code=2,location=soulidity_content::founding_library)]
fun cannot_finish_without_soul_document(){let(mut sc,p,s,r,mut sys,c,mut f)=setup();append(&mut sc,&mut f,&r,&mut sys,&c,1,b"default",3,0,false,1);let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)}
#[test,expected_failure(abort_code=2,location=soulidity_content::founding_library)]
fun second_soul_document_is_never_a_version(){let(mut sc,p,s,r,mut sys,c,mut f)=setup();append(&mut sc,&mut f,&r,&mut sys,&c,0,b"soul",3,0,false,1);append(&mut sc,&mut f,&r,&mut sys,&c,0,b"soul",3,1,false,2);let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)}
#[test,expected_failure(abort_code=2,location=soulidity_content::document)]
fun invariant_read_mode_cannot_be_downgraded_to_owner_only(){let(mut sc,p,s,r,mut sys,c,mut f)=setup();append(&mut sc,&mut f,&r,&mut sys,&c,1,b"default",1,0,false,1);let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)}
#[test,expected_failure(abort_code=1,location=soulidity_content::founding_library)]
fun stale_expected_version_rejected_before_consumption(){let(mut sc,p,s,r,mut sys,c,mut f)=setup();append(&mut sc,&mut f,&r,&mut sys,&c,1,b"default",3,1,false,1);let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)}
#[test,expected_failure(abort_code=3,location=soulidity_content::founding_library)]
fun invariant_document_does_not_gain_active_binding(){let(mut sc,p,s,r,mut sys,c,mut f)=setup();append(&mut sc,&mut f,&r,&mut sys,&c,0,b"soul",3,0,true,1);let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)}
#[test,expected_failure(abort_code=3,location=soulidity_content::document)]
fun custom_kind_cannot_use_the_invariant_bypass(){
    let(mut sc,p,s,mut r,mut sys,c,mut f)=setup();let mut cap:KindAdminCap=sc.take_from_sender();let kind=kind_registry::register_kind(&mut r,&mut cap,string::utf8(b"no_append"),0,1,false,false,0,sc.ctx());sc.return_to_sender(cap);
    append(&mut sc,&mut f,&r,&mut sys,&c,kind,b"main",1,0,false,1);let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)
}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun unverified_blob_cannot_enter_foundation(){
    let(mut sc,p,s,r,mut sys,c,mut f)=setup();let blob=storage_fixture::blob(&mut sys,1,false,false,sc.ctx());library::append_initial(ContentOperator{},&mut f,&r,0,document::soul_doc_name(),3,0,blob,&sys,h(1),nonce(1),b"envelope",0,false,&c,sc.ctx());let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)
}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun deletable_blob_cannot_enter_foundation(){
    let(mut sc,p,s,r,mut sys,c,mut f)=setup();let blob=storage_fixture::blob(&mut sys,1,true,true,sc.ctx());library::append_initial(ContentOperator{},&mut f,&r,0,document::soul_doc_name(),3,0,blob,&sys,h(1),nonce(1),b"envelope",0,false,&c,sc.ctx());let l=library::finish(ContentOperator{},f,&sys,sc.ctx());end(sc,p,s,r,sys,c,l)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun same_package_impostor_cannot_finish_library(){let(mut sc,p,s,r,mut sys,c,f)=setup();let l=complete(&mut sc,f,&r,&mut sys,&c);let blob=storage_fixture::blob(&mut sys,5,false,true,sc.ctx());let mut l=l;library::append(Impostor{},&mut l,&r,1,document::memory_name(),3,0,blob,&sys,h(5),nonce(5),b"envelope",1,false,&c);end(sc,p,s,r,sys,c,l)}
#[test,expected_failure(abort_code=3,location=soulidity_content::document)]
fun ordinary_append_cannot_reopen_immutable_document(){let(mut sc,p,s,r,mut sys,c,f)=setup();let mut l=complete(&mut sc,f,&r,&mut sys,&c);let blob=storage_fixture::blob(&mut sys,5,false,true,sc.ctx());library::append(ContentOperator{},&mut l,&r,0,document::soul_doc_name(),3,0,blob,&sys,h(5),nonce(5),b"envelope",1,false,&c);end(sc,p,s,r,sys,c,l)}
