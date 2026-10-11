#[test_only]
module soulidity_v1::maker_validation_atomic_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use sui::coin;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_foundation::economics::{Self,Config};
use soulidity_v1::{catalog,issuer,native_binding};
use soulidity_maker_manufacturing::maker_catalog::Product;

fun direct(sc:&mut Scenario,cfg:&mut Config<USD>,gross:u64){
 let clock=clock::create_for_testing(sc.ctx());let policy=economics::primary_policy(cfg);
 let (_receipt,_net)=economics::quote_collect_primary<USD,bool,bool>(cfg,true,true,&policy,gross,false,@0xd,@0x44.to_id(),fixtures::h(1),sc.sender(),fixtures::h(2),1000,@0x55.to_id(),coin::mint_for_testing<USD>(gross,sc.ctx()),&clock,sc.ctx());abort 99
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::package_roles)]
fun additive_native_api_cannot_use_foreign_role_witness(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut cfg:Config<USD> =sc.take_shared();direct(&mut sc,&mut cfg,37);abort 99}
#[test,expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun combined_quote_error_precedes_foreign_role_error(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut cfg:Config<USD> =sc.take_shared();direct(&mut sc,&mut cfg,1);abort 99}
#[test,expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun original_quote_error_precedes_foreign_role_error(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut cfg:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let policy=economics::primary_policy(&cfg);let receipt=economics::route_primary(economics::primary_quote(&policy,&cfg,1,false,@0xd,@0x44.to_id(),fixtures::h(1),sc.sender(),fixtures::h(2),1000),@0x55.to_id());let _net=economics::collect_primary(&mut cfg,true,true,receipt,coin::mint_for_testing<USD>(1,sc.ctx()),&clock,sc.ctx());abort 99}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun stale_global_package_precedes_quote_and_role_errors(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut cfg:Config<USD> =sc.take_shared();economics::drift_callable_for_testing(&mut cfg);direct(&mut sc,&mut cfg,1);abort 99}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun manufacturing_api_cannot_bypass_missing_release_identity(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut cfg:Config<USD> =sc.take_shared();let policy=economics::primary_policy(&cfg);let clock=clock::create_for_testing(sc.ctx());let (_receipt,_net)=economics::quote_collect_manufacturing_primary<USD,bool,bool>(&mut cfg,true,true,&policy,37,false,@0xd,@0x44.to_id(),fixtures::h(1),sc.sender(),fixtures::h(2),1000,@0x55.to_id(),coin::mint_for_testing<USD>(37,sc.ctx()),&clock,sc.ctx());abort 99}
fun session(sc:&mut Scenario,p:&mut Product<USD>,cfg:&mut Config<USD>,clock:&Clock,revision:u64,expiry:u64,payment:u64){
 let intent=fixtures::default_intent(p,90,fixtures::default_recipe(p),sc.sender());
 let _build=issuer::begin_for_testing(native_binding::application_binding(cfg),p,cfg,intent,b"default",revision,expiry,coin::mint_for_testing<USD>(payment,sc.ctx()),clock,sc.ctx());abort 99
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun native_atomic_session_still_rejects_underfunding(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());session(&mut sc,&mut p,&mut cfg,&clock,0,1000,39);abort 99}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun native_atomic_session_still_rejects_overfunding(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());session(&mut sc,&mut p,&mut cfg,&clock,0,1000,41);abort 99}
#[test,expected_failure(abort_code=3,location=soulidity_foundation::economics)]
fun expired_session_precedes_underfunding(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let mut clock=clock::create_for_testing(sc.ctx());clock::increment_for_testing(&mut clock,1001);session(&mut sc,&mut p,&mut cfg,&clock,0,1000,39);abort 99}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun stale_revision_precedes_expiry_and_underfunding(){let mut sc=fixtures::setup(0,1,37,0,0,3);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let mut clock=clock::create_for_testing(sc.ctx());clock::increment_for_testing(&mut clock,1001);session(&mut sc,&mut p,&mut cfg,&clock,1,1000,39);abort 99}
