#[test_only]
module soulidity_v1::access_security_tests;
use sui::test_scenario::{Self,Scenario};
use sui::kiosk::Kiosk;
use sui::clock;
use sui::coin;
use soulidity_custody::account::{Self as custody,Account};
use soulidity_v1::access;
use soulidity_v1::vault_tests;
use soulidity_v1::paid_access_tests;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_application::vault;
use soulidity_v1::storage_fixture;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::character as soul;
use soulidity_foundation::economics::{Self,Config,Admin};
use walrus::system::System;
fun disable(sc:&mut Scenario){sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared();let mut a:Account=sc.take_from_sender();access::disable(&mut k,&mut a,sc.ctx());sc.return_to_sender(a);test_scenario::return_shared(k);sc.next_tx(@0x8);}
fun finish(sc:Scenario,k:Kiosk,sys:System){test_scenario::return_shared(k);storage_fixture::return_system(sys);sc.end();}
#[test,expected_failure(abort_code=3,location=soulidity_v1::access)]
fun disabled_extension_rejects_delegate_read(){let(mut sc,root,id,sys,kid)=vault_tests::setup(2);disable(&mut sc);let k:Kiosk=sc.take_shared_by_id(kid);let c=clock::create_for_testing(sc.ctx());access::seal_approve_delegate(id,&k,root,3,&sys,&c,sc.ctx());clock::destroy_for_testing(c);finish(sc,k,sys)}
#[test,expected_failure(abort_code=3,location=soulidity_v1::access)]
fun disabled_extension_rejects_delegate_mutation(){let(mut sc,root,_id,sys,kid)=vault_tests::setup(2);disable(&mut sc);let mut k:Kiosk=sc.take_shared_by_id(kid);let c=clock::create_for_testing(sc.ctx());access::delete_content_as_delegate(&mut k,root,3,2,3,&c,sc.ctx());clock::destroy_for_testing(c);finish(sc,k,sys)}
#[test]
fun enable_restores_unexpired_grant_without_new_authority(){let(mut sc,root,id,sys,kid)=vault_tests::setup(2);disable(&mut sc);sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();access::enable(&mut k,&mut a,sc.ctx());assert!(access::revision(&k)==2 && access::soul_revision(&k,root)==3,0);sc.return_to_sender(a);test_scenario::return_shared(k);sc.next_tx(@0x8);let k:Kiosk=sc.take_shared_by_id(kid);let c=clock::create_for_testing(sc.ctx());access::seal_approve_delegate(id,&k,root,3,&sys,&c,sc.ctx());clock::destroy_for_testing(c);finish(sc,k,sys)}
#[test]
fun disabled_and_protocol_paused_owner_can_exit_and_uninstall(){
 let(mut sc,root,_id,sys,kid)=vault_tests::setup(2);disable(&mut sc);sc.next_tx(@0xa);let mut cfg:Config<USD> =sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,0,0,0,@0xf,true);sc.return_to_sender(admin);test_scenario::return_shared(cfg);
 sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();access::withdraw(&mut k,&mut a,root,2,3,sc.ctx());access::uninstall_empty(&mut k,&mut a,sc.ctx());assert!(!access::installed(&k),0);sc.return_to_sender(a);test_scenario::return_shared(k);
 sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);assert!(object::id(&s)==root && soul::grant_count(&s)==0 && vault::privacy_generation(vault::tool(&s))==2,1);sc.return_to_sender(s);storage_fixture::return_system(sys);sc.end();
}
#[test,expected_failure(abort_code=0,location=sui::object_bag)]
fun nonempty_extension_cannot_be_uninstalled(){let(mut sc,_root,_id,sys,kid)=vault_tests::setup(2);sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();access::uninstall_empty(&mut k,&mut a,sc.ctx());sc.return_to_sender(a);finish(sc,k,sys)}
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun original_account_cannot_control_another_native_kiosk(){let(mut sc,_root,_id,sys,_kid)=vault_tests::setup(2);sc.next_tx(@0xb);let mut a:Account=sc.take_from_sender();let other=custody::create(sc.ctx());sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(other);access::disable(&mut k,&mut a,sc.ctx());sc.return_to_sender(a);finish(sc,k,sys)}
#[test,expected_failure(abort_code=1,location=soulidity_custody::account)]
fun stale_account_with_wrong_actor_cannot_withdraw(){let(mut sc,root,_id,sys,kid)=vault_tests::setup(2);sc.next_tx(@0xb);let mut a:Account=sc.take_from_sender();sc.next_tx(@0x8);let mut k:Kiosk=sc.take_shared_by_id(kid);access::withdraw(&mut k,&mut a,root,2,3,sc.ctx());sc.return_to_sender(a);finish(sc,k,sys)}
#[test,expected_failure(abort_code=2,location=soulidity_v1::access)]
fun stale_inventory_revision_cannot_mutate(){let(mut sc,root,_id,sys,kid)=vault_tests::setup(2);let mut k:Kiosk=sc.take_shared_by_id(kid);let c=clock::create_for_testing(sc.ctx());access::delete_content_as_delegate(&mut k,root,3,1,3,&c,sc.ctx());clock::destroy_for_testing(c);finish(sc,k,sys)}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_application_revision_cannot_mutate(){let(mut sc,root,_id,sys,kid)=vault_tests::setup(2);let mut k:Kiosk=sc.take_shared_by_id(kid);let c=clock::create_for_testing(sc.ctx());access::delete_content_as_delegate(&mut k,root,3,2,2,&c,sc.ctx());clock::destroy_for_testing(c);finish(sc,k,sys)}
#[test,expected_failure(abort_code=3,location=soulidity_v1::access)]
fun disabled_extension_rejects_paid_purchase(){let(mut sc,root,_id,sys,c)=paid_access_tests::setup(5,option::some(1000));disable(&mut sc);let mut k:Kiosk=sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let quote=access::paid_quote(&k,root,3);let payment=coin::mint_for_testing<USD>(40,sc.ctx());access::buy_paid(&mut k,root,&mut cfg,3,2,3,quote,option::none(),0,10000,fixtures::h(40),payment,&c,sc.ctx());test_scenario::return_shared(cfg);clock::destroy_for_testing(c);finish(sc,k,sys)}
#[test]
fun funds_and_asset_ids_survive_container_and_owner_can_recover(){
 let(mut sc,root,_id,sys,kid)=vault_tests::setup(2);sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();access::withdraw(&mut k,&mut a,root,2,3,sc.ctx());sc.return_to_sender(a);test_scenario::return_shared(k);
 sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);let tool=object::id(vault::tool(&s));let coin=coin::mint_for_testing<USD>(73,sc.ctx());let r=standard::revision(&s);vault::deposit_coin(&mut s,coin,fixtures::h(70),2,r,sc.ctx());let asset=coin::mint_for_testing<USD>(11,sc.ctx());let asset_id=object::id(&asset);let r=standard::revision(&s);vault::deposit_asset(&mut s,asset,fixtures::h(71),3,r,sc.ctx());
 let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();let cfg:Config<USD> =sc.take_shared();access::deposit(&mut k,&mut a,s,&cfg,3,4,sc.ctx());access::disable(&mut k,&mut a,sc.ctx());access::withdraw(&mut k,&mut a,root,4,5,sc.ctx());access::uninstall_empty(&mut k,&mut a,sc.ctx());sc.return_to_sender(a);test_scenario::return_shared(k);test_scenario::return_shared(cfg);
 sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);assert!(object::id(vault::tool(&s))==tool && vault::coin_balance<USD>(&s)==73 && vault::has_asset<sui::coin::Coin<USD>>(&s,asset_id) && vault::privacy_generation(vault::tool(&s))==4,0);
 let r=standard::revision(&s);let c=vault::withdraw_coin<USD>(&mut s,73,fixtures::h(72),6,r,sc.ctx());assert!(coin::value(&c)==73,1);transfer::public_transfer(c,sc.sender());let r=standard::revision(&s);let a:sui::coin::Coin<USD> =vault::withdraw_asset(&mut s,asset_id,fixtures::h(73),7,r,sc.ctx());assert!(object::id(&a)==asset_id && coin::value(&a)==11,2);transfer::public_transfer(a,sc.sender());sc.return_to_sender(s);storage_fixture::return_system(sys);sc.end();
}

public struct CustodyFakeNamespace has drop{}
#[test]
fun custody_boundary_fake_namespace_cannot_control_actual_access_inventory(){
    let(mut sc,root,_id,sys,kid)=vault_tests::setup(2);sc.next_tx(@0xb);
    let mut k:Kiosk=sc.take_shared_by_id(kid);let a:Account=sc.take_from_sender();
    custody::add_extension(CustodyFakeNamespace{},&mut k,&a,sc.ctx());
    assert!(!sui::kiosk_extension::can_place<access::AccessExtension>(&k) && !sui::kiosk_extension::can_lock<access::AccessExtension>(&k)
        && !sui::kiosk_extension::can_place<CustodyFakeNamespace>(&k) && !sui::kiosk_extension::can_lock<CustodyFakeNamespace>(&k),0);
    custody::disable_extension(CustodyFakeNamespace{},&mut k,&a,sc.ctx());
    assert!(sui::kiosk_extension::is_enabled<access::AccessExtension>(&k) && access::root_present(&k,root) && access::root_count(&k)==1 && access::soul_revision(&k,root)==3,1);
    custody::remove_extension(CustodyFakeNamespace{},&mut k,&a,sc.ctx());
    assert!(access::installed(&k) && !sui::kiosk_extension::is_installed<CustodyFakeNamespace>(&k) && access::root_present(&k,root),2);
    sc.return_to_sender(a);finish(sc,k,sys)
}
