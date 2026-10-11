#[test_only]
module soulidity_v1::config_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin::{Self,Coin};
use sui::clock;
use std::type_name;
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
use soulidity_v1::catalog;
use soulidity_foundation::revenue;
use soulidity_v1::fixtures::{Self,USD};

fun setup():Scenario{let mut sc=test_scenario::begin(@0xa);economics::init_for_testing(sc.ctx());sc.next_tx(@0xa);let auth:Authority=sc.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,1000,500,3,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xa);sc}
fun activate(sc:&mut Scenario){let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let hash=economics::commitment(&c);soulidity_v1::native_binding::install(&mut c,&mut a,0,hash,sc.ctx());let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,1,hash,true);test_scenario::return_shared(c);sc.return_to_sender(a);sc.next_tx(@0xa);}
fun sum(sc:&Scenario):u64{let mut n=0;sc.ids_for_sender<Coin<USD>>().do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);n=n+coin::value(&c);sc.return_to_sender(c)});n}

#[test]
fun real_creation_disabled_with_exact_coin_root_and_commitment(){let sc=setup();let c:Config<USD> = sc.take_shared();assert!(!economics::enabled(&c) && !economics::paused(&c) && economics::revision(&c)==0,0);assert!(economics::payment_coin(&c)==type_name::with_original_ids<USD>() && revenue::root(economics::income(&c))==object::id(&c),1);assert!(economics::original_package(&c)==economics::current_original_package() && economics::callable_package(&c)==economics::current_callable_package(),2);assert!(economics::commitment(&c)==economics::operational_snapshot_hash(&economics::operational_snapshot(&c)) && economics::commitment(&c).length()==32,3);economics::assert_recovery_identity(&c);test_scenario::return_shared(c);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun disabled_new_config_cannot_create_maker(){let mut sc=setup();let c:Config<USD> = sc.take_shared();catalog::create_maker(&c,0,sc.ctx());test_scenario::return_shared(c);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun actual_enable_does_not_authorize_an_unregistered_creator_role(){let mut sc=setup();activate(&mut sc);let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let hash=economics::commitment(&c);economics::set_primary_enabled(&mut c,&mut a,2,hash,true);assert!(economics::enabled(&c) && economics::primary_enabled(&c) && economics::revision(&c)==3,0);economics::assert_exact_snapshot(&c,object::id(&c),3,economics::commitment(&c));catalog::create_maker(&c,0,sc.ctx());test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}

#[test]
fun income_changes_do_not_change_configuration_snapshot(){let mut sc=setup();activate(&mut sc);let mut c:Config<USD> = sc.take_shared();let before=economics::commitment(&c);economics::deposit_income(&mut c,coin::mint_for_testing<USD>(7,sc.ctx()));assert!(economics::commitment(&c)==before && economics::revision(&c)==2 && revenue::revision(economics::income(&c))==1,0);economics::assert_exact_snapshot(&c,object::id(&c),2,before);test_scenario::return_shared(c);sc.end();}

#[test]
fun disable_pause_and_callable_drift_preserve_real_funds_exit(){let mut sc=setup();activate(&mut sc);let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();economics::deposit_income(&mut c,coin::mint_for_testing<USD>(7,sc.ctx()));let original_hash=economics::commitment(&c);economics::drift_callable_for_testing(&mut c);assert!(economics::commitment(&c)!=original_hash,0);let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,2,hash,false);economics::configure(&mut c,&mut a,3,9000,9000,99,@0xe,true);economics::withdraw_income(&mut c,&mut a,1,7,@0xb,fixtures::h(40),sc.ctx());assert!(revenue::balance(economics::income(&c))==0 && revenue::withdrawn(economics::income(&c))==7 && !economics::enabled(&c) && economics::paused(&c),1);test_scenario::return_shared(c);sc.return_to_sender(a);sc.next_tx(@0xb);assert!(sum(&sc)==7,2);sc.end();}

#[test]
fun explicit_disabled_rebinding_keeps_root_and_existing_money(){let mut sc=setup();activate(&mut sc);let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let root=object::id(&c);economics::deposit_income(&mut c,coin::mint_for_testing<USD>(7,sc.ctx()));let before=economics::commitment(&c);economics::drift_callable_for_testing(&mut c);let drift=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,2,drift,false);let disabled=economics::commitment(&c);economics::rebind_current_package(&mut c,&mut a,3,disabled);assert!(object::id(&c)==root && revenue::balance(economics::income(&c))==7 && revenue::root(economics::income(&c))==root && economics::revision(&c)==4 && economics::commitment(&c)!=before,0);let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,4,hash,true);economics::assert_enabled(&c);assert!(economics::revision(&c)==5 && revenue::revision(economics::income(&c))==1,1);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun enabled_callable_drift_rejects_operation(){let mut sc=setup();activate(&mut sc);let mut c:Config<USD> = sc.take_shared();economics::drift_callable_for_testing(&mut c);let clock=clock::create_for_testing(sc.ctx());economics::assert_live(&c,2,1000,&clock);clock::destroy_for_testing(clock);test_scenario::return_shared(c);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun rebind_while_enabled_rejected(){let mut sc=setup();activate(&mut sc);let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();economics::drift_callable_for_testing(&mut c);let hash=economics::commitment(&c);economics::rebind_current_package(&mut c,&mut a,2,hash);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun old_config_snapshot_cannot_authorize_after_terms_change(){let mut sc=setup();activate(&mut sc);let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let hash=economics::commitment(&c);economics::configure(&mut c,&mut a,2,2000,600,9,@0xe,false);economics::assert_exact_snapshot(&c,object::id(&c),2,hash);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun hash_mismatch_rejected_even_at_current_revision(){let mut sc=setup();activate(&mut sc);let c:Config<USD> = sc.take_shared();economics::assert_exact_snapshot(&c,object::id(&c),2,fixtures::h(1));test_scenario::return_shared(c);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun wrong_config_identity_rejected(){let mut sc=setup();activate(&mut sc);let c:Config<USD> = sc.take_shared();economics::assert_exact_snapshot(&c,object::id_from_address(@0x99),2,economics::commitment(&c));test_scenario::return_shared(c);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun paused_config_cannot_enable_by_toggle(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let hash=economics::commitment(&c);soulidity_v1::native_binding::install(&mut c,&mut a,0,hash,sc.ctx());economics::configure(&mut c,&mut a,1,1000,500,3,@0xf,true);let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,2,hash,true);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun replayed_enable_transition_rejected(){let mut sc=setup();let mut c:Config<USD> = sc.take_shared();let mut a:Admin=sc.take_from_sender();let hash=economics::commitment(&c);soulidity_v1::native_binding::install(&mut c,&mut a,0,hash,sc.ctx());let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,1,hash,true);economics::set_enabled(&mut c,&mut a,1,hash,true);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}

#[test]
fun actual_transferred_admin_can_enable_and_previous_wallet_loses_cap(){let mut sc=setup();let a:Admin=sc.take_from_sender();transfer::public_transfer(a,@0xb);sc.next_tx(@0xa);assert!(sc.ids_for_sender<Admin>().is_empty(),0);sc.next_tx(@0xb);let mut a:Admin=sc.take_from_sender();let mut c:Config<USD> = sc.take_shared();let hash=economics::commitment(&c);soulidity_v1::native_binding::install(&mut c,&mut a,0,hash,sc.ctx());let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,1,hash,true);economics::assert_enabled(&c);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}

#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun wrong_admin_cannot_enable_other_config(){let mut sc=setup();let c:Config<USD> = sc.take_shared();let id=object::id(&c);test_scenario::return_shared(c);let a:Admin=sc.take_from_sender();let aid=object::id(&a);sc.return_to_sender(a);let auth:Authority=sc.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,1000,500,3,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xa);let mut c:Config<USD> = sc.take_shared_by_id(id);let mut other=option::none();sc.ids_for_sender<Admin>().do_ref!(|i|{if(*i!=aid)other=option::some(*i)});let mut a:Admin=sc.take_from_sender_by_id(other.destroy_some());let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,0,hash,true);test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
