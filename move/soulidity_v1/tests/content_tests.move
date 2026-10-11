#[test_only]
module soulidity_v1::content_tests;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use soulidity_v1::fixtures;
use soulidity_v1::storage_fixture;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_content::document;
use soulidity_transport::storage_transport as storage;
use walrus::system::System;
fun setup():(Scenario,Soul,KindRegistry,System,Clock) {
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);
    let system:System=sc.take_shared();
    let s:Soul=sc.take_from_sender_by_id(root);let registry:KindRegistry=sc.take_shared();let clock=clock::create_for_testing(sc.ctx());(sc,s,registry,system,clock)
}
fun nonce(n:u8):vector<u8>{vector::tabulate!(16,|_|n)}
fun append(sc:&mut Scenario,s:&mut Soul,r:&KindRegistry,sys:&mut System,c:&Clock,kind:u32,name:vector<u8>,read:u64,download:u8,expected_version:u64,expected_soul:u64,attempt:u8):u64 {
    let blob=storage_fixture::blob(sys,attempt as u256,false,true,sc.ctx());
    soul::append_content(s,r,kind,string::utf8(name),read,download,blob,sys,fixtures::h(attempt),nonce(attempt),b"ciphertext-envelope",expected_version,expected_soul,fixtures::h(attempt),c)
}
fun finish(mut sc:Scenario,s:Soul,r:KindRegistry,sys:System,c:Clock) {
    sc.return_to_sender(s);test_scenario::return_shared(r);storage_fixture::return_system(sys);clock::destroy_for_testing(c);sc.end();
}
#[test]
fun certified_content_keeps_names_versions_blob_and_envelope() {
    let(mut sc,mut s,r,mut sys,c)=setup();
    let precomputed=document::namespace(soul::content_id(&s),1,document::memory_name(),1,nonce(30));
    let first=append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,1,0,30);
    let second=append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,2,1,31);
    assert!(first==3 && second==4 && soul::content_version_count(&s,1,document::memory_name())==3 && soul::content_index(&s,1,document::memory_name(),2)==option::some(4) && soul::content_names_for_kind(&s,1)==1,0);
    assert!(precomputed==soul::seal_id(&s,first) && precomputed!=soul::seal_id(&s,second),1);
    let record=soul::content_record(&s,first);assert!(document::envelope(record)==&b"ciphertext-envelope" && storage::bytes(document::reference(record))==1024,2);
    soul::seal_approve_owner(precomputed,&mut s,first,&sys,sc.ctx());
    assert!(soul::content_receipt(&s,fixtures::h(30))==option::some(first),3);
    finish(sc,s,r,sys,c)
}
#[test]
fun active_binding_clear_delete_purge_and_new_version() {
    let(mut sc,mut s,r,mut sys,c)=setup();let index=append(&mut sc,&mut s,&r,&mut sys,&c,3,b"main",9,0,0,0,30);
    soul::set_active_content(&mut s,index,option::none(),1);assert!(soul::active_content(&s,3)==option::some(index),0);
    soul::clear_active_content(&mut s,3,index,2);soul::delete_content(&mut s,index,3);soul::purge_content(&mut s,index,4);
    let record=soul::content_record(&s,index);assert!(document::deleted(record) && document::purged(record) && document::envelope(record).is_empty(),1);
    append(&mut sc,&mut s,&r,&mut sys,&c,3,b"main",1,1,1,5,31);assert!(soul::content_version_count(&s,3,string::utf8(b"main"))==2,2);
    finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun unverified_blob_rejected() {
    let(mut sc,mut s,r,mut sys,c)=setup();let blob=storage_fixture::blob(&mut sys,30,false,false,sc.ctx());
    soul::append_content(&mut s,&r,1,document::memory_name(),3,0,blob,&sys,fixtures::h(30),nonce(30),b"envelope",1,0,fixtures::h(30),&c);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun deletable_blob_rejected() {
    let(mut sc,mut s,r,mut sys,c)=setup();let blob=storage_fixture::blob(&mut sys,30,true,true,sc.ctx());
    soul::append_content(&mut s,&r,1,document::memory_name(),3,0,blob,&sys,fixtures::h(30),nonce(30),b"envelope",1,0,fixtures::h(30),&c);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_content_kinds::document_policy)]
fun memory_canonical_name_cannot_fork() {
    let(mut sc,mut s,r,mut sys,c)=setup();append(&mut sc,&mut s,&r,&mut sys,&c,1,b"other",3,0,0,0,30);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content_kinds::document_policy)]
fun public_read_cannot_be_added_to_private_memory() {
    let(mut sc,mut s,r,mut sys,c)=setup();append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",9,0,1,0,30);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content_kinds::document_policy)]
fun owner_read_cannot_be_removed() {
    let(mut sc,mut s,r,mut sys,c)=setup();append(&mut sc,&mut s,&r,&mut sys,&c,3,b"main",8,0,0,0,30);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content_kinds::document_policy)]
fun public_read_requires_public_download_policy() {
    let(mut sc,mut s,r,mut sys,c)=setup();append(&mut sc,&mut s,&r,&mut sys,&c,3,b"main",9,1,0,0,30);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_content::document)]
fun founding_document_cannot_be_appended_by_owner() {
    let(mut sc,mut s,r,mut sys,c)=setup();append(&mut sc,&mut s,&r,&mut sys,&c,0,b"soul",3,0,1,0,30);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=10,location=soulidity_application::character)]
fun active_version_cannot_be_deleted() {
    let(mut sc,mut s,r,mut sys,c)=setup();let index=append(&mut sc,&mut s,&r,&mut sys,&c,3,b"main",1,1,0,0,30);
    soul::set_active_content(&mut s,index,option::none(),1);soul::delete_content(&mut s,index,2);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=6,location=soulidity_content::document)]
fun live_version_cannot_be_purged() {
    let(mut sc,mut s,r,mut sys,c)=setup();let index=append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,1,0,30);
    soul::purge_content(&mut s,index,1);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::document)]
fun deleted_version_cannot_approve_read() {
    let(mut sc,mut s,r,mut sys,c)=setup();let index=append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,1,0,30);
    let id=soul::seal_id(&s,index);soul::delete_content(&mut s,index,1);soul::seal_approve_owner(id,&mut s,index,&sys,sc.ctx());finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=10,location=soulidity_application::character)]
fun exact_namespace_required() {
    let(mut sc,mut s,r,mut sys,c)=setup();let index=append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,1,0,30);
    let id=document::namespace(soul::content_id(&s),1,document::memory_name(),1,nonce(31));soul::seal_approve_owner(id,&mut s,index,&sys,sc.ctx());finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_per_name_version_rejected() {
    let(mut sc,mut s,r,mut sys,c)=setup();append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,1,0,30);
    append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,1,1,31);finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=10,location=soulidity_application::character)]
fun duplicate_attempt_rejected_after_commit() {
    let(mut sc,mut s,r,mut sys,c)=setup();append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,1,0,30);
    sc.return_to_sender(s);test_scenario::return_shared(r);sc.next_tx(@0xb);
    let mut s:Soul=sc.take_from_sender();let r:KindRegistry=sc.take_shared();append(&mut sc,&mut s,&r,&mut sys,&c,1,b"default",3,0,2,1,30);finish(sc,s,r,sys,c)
}
#[test]
fun founding_document_is_created_only_once_and_readable() {
    let(mut sc,mut s,r,sys,c)=setup();let index=0;
    assert!(soul::content_version_count(&s,0,document::soul_doc_name())==1 && soul::content_version_count(&s,1,document::memory_name())==1,0);
    let id=soul::seal_id(&s,index);soul::seal_approve_owner(id,&mut s,index,&sys,sc.ctx());finish(sc,s,r,sys,c)
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_content::document)]
fun founding_document_cannot_be_deleted() {
    let(sc,mut s,r,sys,c)=setup();soul::delete_content(&mut s,0,0);finish(sc,s,r,sys,c)
}
