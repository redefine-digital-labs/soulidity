#[test_only]
module soulidity_v1::native_binding_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin;
use std::type_name;
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
use soulidity_v1::native_binding;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_foundation::revenue;
fun setup():Scenario{let mut sc=test_scenario::begin(@0xa);economics::init_for_testing(sc.ctx());sc.next_tx(@0xa);let auth:Authority=sc.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,1000,500,3,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xa);sc}
fun install(sc:&mut Scenario,c:&mut Config<USD>,a:&mut Admin):ID{let rev=economics::revision(c);let hash=economics::commitment(c);native_binding::install(c,a,rev,hash,sc.ctx())}
fun activate(sc:&mut Scenario,c:&mut Config<USD>,a:&mut Admin){install(sc,c,a);let rev=economics::revision(c);let hash=economics::commitment(c);economics::set_enabled(c,a,rev,hash,true)}
#[test]
fun real_catalog_freezes_actual_soul_issuer_tool_and_kiosk(){
 let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let old=economics::commitment(&c);let id=install(&mut sc,&mut c,&mut a);native_binding::assert_current(&c);let r=native_binding::current(&c);
 assert!(object::id(r)==id && native_binding::config(r)==object::id(&c) && native_binding::generation(r)==0 && native_binding::role_count(r)==15 && native_binding::owner_model(r)==0,0);
 assert!(native_binding::role(r,0)==type_name::with_original_ids<soulidity_standard::soul::Soul>() && native_binding::role(r,1)==type_name::with_original_ids<soulidity_v1::issuer::Build>() && native_binding::role(r,2)==type_name::with_original_ids<soulidity_application::vault::ContentOperator>() && native_binding::role(r,3)==type_name::with_original_ids<soulidity_custody::account::Account>(),1);
 assert!(native_binding::role_defining(r,0)==type_name::with_defining_ids<soulidity_standard::soul::Soul>() && native_binding::role_defining(r,1)==type_name::with_defining_ids<soulidity_v1::issuer::Build>() && native_binding::role_defining(r,2)==type_name::with_defining_ids<soulidity_application::vault::ContentOperator>(),5);
 assert!(native_binding::role(r,5)==type_name::with_original_ids<soulidity_maker_manufacturing::maker_catalog::Product<USD>>() && native_binding::payment_coin(r)==type_name::with_original_ids<USD>() && native_binding::original_package(r)==object::id_from_address(type_name::original_id<soulidity_native_binder::native_binding::NativeInstaller1>()) && native_binding::callable_package(r)==object::id_from_address(type_name::defining_id<soulidity_native_binder::native_binding::NativeRevision2>()),2);
 assert!(economics::revision(&c)==1 && economics::commitment(&c)!=old && !economics::enabled(&c),3);let n=economics::native_snapshot(&c).destroy_some();assert!(economics::native_catalog(&n)==id && economics::native_commitment(&n)==native_binding::commitment(r),4);let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,1,hash,true);economics::assert_enabled(&c);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun real_config_cannot_enable_without_actual_native_catalog(){let sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let h=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,0,h,true);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun native_install_rejects_old_cas(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let h=economics::commitment(&c);native_binding::install(&mut c,&mut a,1,h,sc.ctx());test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun native_install_rejects_wrong_commitment(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();native_binding::install(&mut c,&mut a,0,fixtures::h(1),sc.ctx());test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun enabled_config_cannot_replace_native_catalog(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();activate(&mut sc,&mut c,&mut a);install(&mut sc,&mut c,&mut a);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test]
fun disabled_replacement_archives_exact_old_catalog_and_preserves_real_funds(){
 let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();activate(&mut sc,&mut c,&mut a);let root=object::id(&c);let first=object::id(native_binding::current(&c));let first_hash=native_binding::commitment(native_binding::current(&c));economics::deposit_income(&mut c,coin::mint_for_testing<USD>(7,sc.ctx()));let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,2,hash,false);let second=install(&mut sc,&mut c,&mut a);native_binding::assert_current(&c);
 assert!(second!=first && object::id(&c)==root && native_binding::generation(native_binding::current(&c))==1 && object::id(native_binding::historical(&c,0))==first && native_binding::commitment(native_binding::historical(&c,0))==first_hash && economics::revision(&c)==4 && revenue::balance(economics::income(&c))==7 && revenue::revision(economics::income(&c))==1,0);
 let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,4,hash,true);economics::assert_enabled(&c);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun completed_install_cannot_replay_old_snapshot(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let h=economics::commitment(&c);native_binding::install(&mut c,&mut a,0,h,sc.ctx());native_binding::install(&mut c,&mut a,0,h,sc.ctx());test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test]
fun actual_transferred_admin_installs_from_current_holder(){let mut sc=setup();let a:Admin=sc.take_from_sender();transfer::public_transfer(a,@0xb);sc.next_tx(@0xb);let mut a:Admin=sc.take_from_sender();let mut c:Config<USD> = sc.take_shared();activate(&mut sc,&mut c,&mut a);native_binding::assert_current(&c);economics::assert_enabled(&c);test_scenario::return_shared(c);sc.return_to_sender(a);sc.next_tx(@0xa);assert!(sc.ids_for_sender<Admin>().is_empty(),0);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun another_actual_config_admin_cannot_install(){let mut sc=setup();let c:Config<USD> = sc.take_shared();let id=object::id(&c);test_scenario::return_shared(c);let a:Admin=sc.take_from_sender();let aid=object::id(&a);sc.return_to_sender(a);let auth:Authority=sc.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,0,0,0,@0xe,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xa);let mut c:Config<USD> = sc.take_shared_by_id(id);let mut other=option::none();sc.ids_for_sender<Admin>().do_ref!(|i|{if(*i!=aid)other=option::some(*i)});let mut a:Admin=sc.take_from_sender_by_id(other.destroy_some());install(&mut sc,&mut c,&mut a);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test]
fun future_minimum_rejects_old_operations_but_preserves_stop_and_money_exit(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();activate(&mut sc,&mut c,&mut a);economics::deposit_income(&mut c,coin::mint_for_testing<USD>(7,sc.ctx()));economics::raise_minimum_for_testing(&mut c,economics::current_release()+1);assert!(economics::minimum_release(&c)>economics::current_release(),0);let h=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,2,h,false);economics::configure(&mut c,&mut a,3,1000,500,3,@0xf,true);economics::withdraw_income(&mut c,&mut a,1,7,@0xb,fixtures::h(42),sc.ctx());assert!(revenue::balance(economics::income(&c))==0 && !economics::enabled(&c),1);test_scenario::return_shared(c);sc.return_to_sender(a);sc.next_tx(@0xb);let coin:sui::coin::Coin<USD> = sc.take_from_sender();assert!(coin::value(&coin)==7,2);sc.return_to_sender(coin);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun future_minimum_blocks_old_release_business(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();activate(&mut sc,&mut c,&mut a);economics::raise_minimum_for_testing(&mut c,economics::current_release()+1);economics::assert_enabled(&c);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun future_minimum_cannot_downgrade_via_rebind(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();install(&mut sc,&mut c,&mut a);economics::raise_minimum_for_testing(&mut c,economics::current_release()+1);economics::drift_callable_for_testing(&mut c);let h=economics::commitment(&c);economics::rebind_current_package(&mut c,&mut a,1,h);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun future_minimum_cannot_downgrade_via_catalog_replacement(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();install(&mut sc,&mut c,&mut a);economics::raise_minimum_for_testing(&mut c,economics::current_release()+1);install(&mut sc,&mut c,&mut a);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
#[test]
fun common_fixture_installs_real_catalog_without_bypassing_runtime_guard(){let sc=fixtures::setup(0,0,0,0,0,0);let c:Config<USD> = sc.take_shared();native_binding::assert_current(&c);economics::assert_enabled(&c);assert!(economics::revision(&c)==0 && native_binding::role_count(native_binding::current(&c))==15,0);test_scenario::return_shared(c);sc.end();}
#[test]
fun nonzero_hash_validation_keeps_exact_length_and_checks_all_bytes(){assert!(!economics::is_nonzero_hash(&vector[]) && !economics::is_nonzero_hash(&vector::tabulate!(31,|_|1u8)) && !economics::is_nonzero_hash(&vector::tabulate!(33,|_|1u8)) && !economics::is_nonzero_hash(&vector::tabulate!(32,|_|0u8)),0);let mut hash=vector::tabulate!(32,|_|0u8);*hash.borrow_mut(31)=1;assert!(economics::is_nonzero_hash(&hash),1)}
