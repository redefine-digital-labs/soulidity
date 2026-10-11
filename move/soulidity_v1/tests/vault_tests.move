#[test_only]
module soulidity_v1::vault_tests;
/// Original independent access journeys now use actual native Kiosk storage,
/// not a product Vault containing Soul or a supplied-root policy fixture.
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use sui::kiosk::Kiosk;
use walrus::system::System;
use soulidity_v1::storage_fixture;
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_content::document;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_foundation::economics::Config;
use soulidity_custody::account::{Self as custody,Account};
use soulidity_v1::access;
use soulidity_application::vault;
public(package) fun setup(scope:u64):(Scenario,ID,vector<u8>,System,ID){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);
    let mut system:System=sc.take_shared();let registry:KindRegistry=sc.take_shared();let mut s:Soul=sc.take_from_sender_by_id(root);
    let blob=storage_fixture::blob(&mut system,101,false,true,sc.ctx());let clock=clock::create_for_testing(sc.ctx());
    soul::append_content(&mut s,&registry,1,document::memory_name(),3,0,blob,&system,fixtures::h(30),vector::tabulate!(16,|_|31),b"encrypted-envelope",1,0,fixtures::h(32),&clock);
    clock::destroy_for_testing(clock);test_scenario::return_shared(registry);let id=soul::seal_id(&s,3);
    let r=soulidity_standard::soul::revision(&s);vault::install(&mut s,r,sc.ctx());custody::create(sc.ctx());sc.return_to_sender(s);sc.next_tx(@0xb);
    let mut k:Kiosk=sc.take_shared();let kid=object::id(&k);let mut a:Account=sc.take_from_sender();let cfg:Config<USD> =sc.take_shared();
    access::install(&mut k,&mut a,&cfg,sc.ctx());let s:Soul=sc.take_from_sender_by_id(root);access::deposit(&mut k,&mut a,s,&cfg,0,1,sc.ctx());
    let clock=clock::create_for_testing(sc.ctx());access::grant(&mut k,&mut a,root,@0x8,scope,option::some(1000),1,2,option::none(),&clock,sc.ctx());clock::destroy_for_testing(clock);
    sc.return_to_sender(a);test_scenario::return_shared(k);test_scenario::return_shared(cfg);sc.next_tx(@0x8);(sc,root,id,system,kid)
}
fun finish(sc:Scenario,k:Kiosk,system:System){test_scenario::return_shared(k);storage_fixture::return_system(system);sc.end();}
#[test]
fun authorized_delegate_reads_in_certified_custody(){
    let(mut sc,root,id,system,kid)=setup(2);let k:Kiosk=sc.take_shared_by_id(kid);let clock=clock::create_for_testing(sc.ctx());
    access::seal_approve_delegate(id,&k,root,3,&system,&clock,sc.ctx());clock::destroy_for_testing(clock);finish(sc,k,system)
}
#[test,expected_failure(abort_code=9,location=soulidity_application::character)]
fun wrong_scope_does_not_read_memory(){let(mut sc,root,id,system,kid)=setup(4);let k:Kiosk=sc.take_shared_by_id(kid);let clock=clock::create_for_testing(sc.ctx());access::seal_approve_delegate(id,&k,root,3,&system,&clock,sc.ctx());clock::destroy_for_testing(clock);finish(sc,k,system)}
#[test,expected_failure(abort_code=9,location=soulidity_application::character)]
fun expired_delegate_rejected(){let(mut sc,root,id,system,kid)=setup(2);let k:Kiosk=sc.take_shared_by_id(kid);let mut clock=clock::create_for_testing(sc.ctx());clock::increment_for_testing(&mut clock,1000);access::seal_approve_delegate(id,&k,root,3,&system,&clock,sc.ctx());clock::destroy_for_testing(clock);finish(sc,k,system)}
#[test,expected_failure(abort_code=9,location=soulidity_application::character)]
fun handover_and_return_do_not_revive_old_delegate(){
    let(mut sc,root,id,system,kid)=setup(2);sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();access::withdraw(&mut k,&mut a,root,2,3,sc.ctx());sc.return_to_sender(a);test_scenario::return_shared(k);
    sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);transfer::public_transfer(s,@0xc);sc.next_tx(@0xc);let s:Soul=sc.take_from_sender_by_id(root);transfer::public_transfer(s,@0xb);sc.next_tx(@0xb);
    let s:Soul=sc.take_from_sender_by_id(root);let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();let cfg:Config<USD> =sc.take_shared();access::deposit(&mut k,&mut a,s,&cfg,3,4,sc.ctx());sc.return_to_sender(a);test_scenario::return_shared(k);test_scenario::return_shared(cfg);
    sc.next_tx(@0x8);let k:Kiosk=sc.take_shared_by_id(kid);let clock=clock::create_for_testing(sc.ctx());access::seal_approve_delegate(id,&k,root,3,&system,&clock,sc.ctx());clock::destroy_for_testing(clock);finish(sc,k,system)
}
#[test,expected_failure(abort_code=4,location=sui::test_scenario)]
fun cached_old_owner_cannot_read_after_handover(){
    let(mut sc,root,id,system,kid)=setup(2);sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();access::withdraw(&mut k,&mut a,root,2,3,sc.ctx());sc.return_to_sender(a);test_scenario::return_shared(k);
    sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);transfer::public_transfer(s,@0xc);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);soul::seal_approve_owner(id,&mut s,3,&system,sc.ctx());sc.return_to_sender(s);storage_fixture::return_system(system);sc.end();
}
#[test]
fun withdraw_preserves_soul_and_clears_delegations(){
    let(mut sc,root,_id,system,kid)=setup(2);sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();access::withdraw(&mut k,&mut a,root,2,3,sc.ctx());assert!(!access::root_present(&k,root) && access::root_count(&k)==0,0);sc.return_to_sender(a);test_scenario::return_shared(k);
    sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);assert!(soul::grant_count(&s)==0 && soul::bound_count(&s)==1 && vault::root(vault::tool(&s))==root && vault::privacy_generation(vault::tool(&s))==2,1);sc.return_to_sender(s);storage_fixture::return_system(system);sc.end();
}
#[test]
fun granted_agent_appends_then_deletes_memory_with_exact_versions(){
    let(mut sc,root,_id,mut system,kid)=setup(2);let mut k:Kiosk=sc.take_shared_by_id(kid);let r:KindRegistry=sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let blob=storage_fixture::blob(&mut system,33,false,true,sc.ctx());
    let index=access::append_content_as_delegate(&mut k,root,&r,1,document::memory_name(),3,0,blob,&system,fixtures::h(33),vector::tabulate!(16,|_|33),b"new-envelope",2,2,3,fixtures::h(33),&clock,sc.ctx());
    assert!(index==4 && access::revision(&k)==3,0);access::delete_content_as_delegate(&mut k,root,index,3,4,&clock,sc.ctx());assert!(access::soul_revision(&k,root)==5,1);
    clock::destroy_for_testing(clock);test_scenario::return_shared(r);finish(sc,k,system)
}
#[test,expected_failure(abort_code=9,location=soulidity_application::character)]
fun wrong_scope_cannot_mutate_memory(){
    let(mut sc,root,_id,mut system,kid)=setup(4);let mut k:Kiosk=sc.take_shared_by_id(kid);let r:KindRegistry=sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let blob=storage_fixture::blob(&mut system,33,false,true,sc.ctx());
    access::append_content_as_delegate(&mut k,root,&r,1,document::memory_name(),3,0,blob,&system,fixtures::h(33),vector::tabulate!(16,|_|33),b"new-envelope",2,2,3,fixtures::h(33),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(r);finish(sc,k,system)
}
#[test,expected_failure(abort_code=9,location=soulidity_application::character)]
fun expired_delegate_cannot_mutate_memory(){
    let(mut sc,root,_id,mut system,kid)=setup(2);let mut k:Kiosk=sc.take_shared_by_id(kid);let r:KindRegistry=sc.take_shared();let mut clock=clock::create_for_testing(sc.ctx());clock::increment_for_testing(&mut clock,1000);let blob=storage_fixture::blob(&mut system,33,false,true,sc.ctx());
    access::append_content_as_delegate(&mut k,root,&r,1,document::memory_name(),3,0,blob,&system,fixtures::h(33),vector::tabulate!(16,|_|33),b"new-envelope",2,2,3,fixtures::h(33),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(r);finish(sc,k,system)
}
