#[test_only]
module soulidity_v1::foundation_tests;
use sui::coin::{Self,Coin};
use sui::test_scenario::{Self,Scenario};
use soulidity_foundation::revenue::{Self,Ledger};
use soulidity_foundation::economics::{Self,Config};
use soulidity_v1::fixtures::{Self,USD};
public struct Parent<phantom C> has key {id:UID,income:Ledger<C>}
fun new<C>(ctx:&mut TxContext):Parent<C>{let id=object::new(ctx);let income=revenue::new<C>(&id,ctx);Parent{id,income}}
fun sum(sc:&Scenario):u64{let mut n=0;sc.ids_for_sender<Coin<USD>>().do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);n=n+coin::value(&c);sc.return_to_sender(c)});n}
#[test]
fun actual_parent_uid_keeps_root_receipt_and_funds_conserved(){
    let mut s=test_scenario::begin(@0xa);let mut p=new<USD>(s.ctx());let root=object::id(&p);
    revenue::deposit(&p.id,&mut p.income,coin::mint_for_testing<USD>(37,s.ctx()));revenue::withdraw(&p.id,&mut p.income,1,12,@0xb,fixtures::h(90),s.ctx());
    assert!(revenue::root(&p.income)==root && revenue::balance(&p.income)==25 && revenue::collected(&p.income)==37 && revenue::withdrawn(&p.income)==12 && revenue::revision(&p.income)==2,0);
    let r=revenue::receipt(&p.income,@0xa,fixtures::h(90)).destroy_some();assert!(revenue::receipt_root(&r)==root && revenue::receipt_amount(&r)==12 && revenue::receipt_balance(&r)==25 && revenue::receipt_revision(&r)==2,1);
    transfer::transfer(p,@0xa);s.next_tx(@0xb);assert!(sum(&s)==12,2);s.end();
}
#[test,expected_failure(abort_code=4,location=soulidity_foundation::revenue)]
fun different_real_uid_cannot_deposit_into_existing_root(){let mut s=test_scenario::begin(@0xa);let mut p=new<USD>(s.ctx());let other=object::new(s.ctx());revenue::deposit(&other,&mut p.income,coin::mint_for_testing<USD>(7,s.ctx()));other.delete();transfer::transfer(p,@0xa);s.end();}
#[test,expected_failure(abort_code=4,location=soulidity_foundation::revenue)]
fun different_real_uid_cannot_withdraw_existing_root(){let mut s=test_scenario::begin(@0xa);let mut p=new<USD>(s.ctx());revenue::deposit(&p.id,&mut p.income,coin::mint_for_testing<USD>(7,s.ctx()));let other=object::new(s.ctx());revenue::withdraw(&other,&mut p.income,1,7,@0xb,fixtures::h(90),s.ctx());other.delete();transfer::transfer(p,@0xa);s.end();}
#[test,expected_failure(abort_code=4,location=soulidity_foundation::revenue)]
fun zero_deposit_still_requires_real_matching_root(){let mut s=test_scenario::begin(@0xa);let mut p=new<USD>(s.ctx());let other=object::new(s.ctx());revenue::deposit(&other,&mut p.income,coin::mint_for_testing<USD>(0,s.ctx()));other.delete();transfer::transfer(p,@0xa);s.end();}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::revenue)]
fun root_proof_does_not_bypass_ledger_cas(){let mut s=test_scenario::begin(@0xa);let mut p=new<USD>(s.ctx());revenue::deposit(&p.id,&mut p.income,coin::mint_for_testing<USD>(7,s.ctx()));revenue::withdraw(&p.id,&mut p.income,0,7,@0xb,fixtures::h(90),s.ctx());transfer::transfer(p,@0xa);s.end();}
#[test,expected_failure(abort_code=3,location=soulidity_foundation::revenue)]
fun root_proof_does_not_bypass_actor_attempt_replay(){let mut s=test_scenario::begin(@0xa);let mut p=new<USD>(s.ctx());revenue::deposit(&p.id,&mut p.income,coin::mint_for_testing<USD>(7,s.ctx()));revenue::withdraw(&p.id,&mut p.income,1,2,@0xb,fixtures::h(90),s.ctx());revenue::withdraw(&p.id,&mut p.income,2,2,@0xb,fixtures::h(90),s.ctx());transfer::transfer(p,@0xa);s.end();}
#[test]
fun parent_transfer_keeps_income_and_original_uid(){let mut s=test_scenario::begin(@0xa);let mut p=new<USD>(s.ctx());let root=object::id(&p);revenue::deposit(&p.id,&mut p.income,coin::mint_for_testing<USD>(19,s.ctx()));transfer::transfer(p,@0xb);s.next_tx(@0xb);let mut p:Parent<USD> = s.take_from_sender();assert!(object::id(&p)==root && revenue::root(&p.income)==root && revenue::balance(&p.income)==19,0);revenue::withdraw(&p.id,&mut p.income,1,19,@0xc,fixtures::h(91),s.ctx());assert!(revenue::balance(&p.income)==0 && revenue::collected(&p.income)==revenue::withdrawn(&p.income),1);s.return_to_sender(p);s.next_tx(@0xc);assert!(sum(&s)==19,2);s.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::package_roles)]
fun primitive_role_cannot_authorize_creator_fees(){let mut s=fixtures::setup(0,0,0,0,0,0);let c:Config<USD> = s.take_shared();economics::assert_business<USD,bool,bool>(&c,2,true,true);test_scenario::return_shared(c);s.end();}
#[test]
fun config_original_uses_stable_authority_type_not_revision_marker(){assert!(economics::current_original_package()==object::id_from_address(std::type_name::original_id<economics::Authority>()),0);}
