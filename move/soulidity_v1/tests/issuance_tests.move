#[test_only]
module soulidity_v1::issuance_tests;
use sui::test_scenario;
use sui::coin::{Self,Coin};
use sui::clock;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_model::policy;
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config};
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;

#[test]
fun fixed_style_three_rights_and_detach_original() {
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,20,0);
    sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(id);
    assert!(soul::bound_count(&s)==1,0);
    assert!(soul::free_id(&soul::binding(&s,b"ref").destroy_some()).is_none(),1);
    let free=soul::free_id(&soul::binding(&s,b"free").destroy_some()).destroy_some();
    soul::clear_reference(&mut s,b"ref",0);soul::unmount_bound(&mut s,b"bound",1);
    assert!(soul::bound_count(&s)==1 && soul::binding(&s,b"bound").is_none(),2);
    let it=soul::detach(&mut s,b"free",2);assert!(object::id(&it)==free,3);
    soul::attach(&mut s,it,b"free",fixtures::layout(),3);
    soul::remount_bound(&mut s,0,b"bound",fixtures::layout(),4);
    soul::validate_recipe(&s);assert!(soul::revision(&s)==5,4);
    let p:Product<USD> = sc.take_shared();assert!(catalog::receipt(&p,@0xb,2,fixtures::h(20))==option::some(id),5);
    test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}

#[test]
fun paid_complete_conserves_value() {
    let mut sc=fixtures::setup(0,1,37,0,0,3);fixtures::mint(&mut sc,20,40);sc.next_tx(@0xa);
    let p:Product<USD> = sc.take_shared();assert!(soulidity_foundation::revenue::balance(catalog::income(&p))==34,0);test_scenario::return_shared(p);assert!(fixtures::protocol_income(&sc)==6,1);
    sc.next_tx(@0xd);assert!(sc.ids_for_sender<Coin<USD>>().is_empty(),2);sc.next_tx(@0xf);assert!(sc.ids_for_sender<Coin<USD>>().is_empty(),3);sc.end();
}

#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun exact_payment_required(){let mut sc=fixtures::setup(0,1,37,0,0,3);fixtures::mint(&mut sc,20,41);sc.end();}
#[test]
#[expected_failure(abort_code=7,location=soulidity_maker_manufacturing::maker_catalog)]
fun cross_transaction_attempt_replay_rejected(){let mut sc=fixtures::setup(0,0,0,0,0,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);fixtures::mint(&mut sc,20,0);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun paid_access_required(){let mut sc=fixtures::setup(15,0,0,0,0,0);fixtures::mint(&mut sc,20,0);sc.end();}
#[test]
#[expected_failure(abort_code=6,location=soulidity_maker_manufacturing::maker_catalog)]
fun quota_only_caps_complete(){let mut sc=fixtures::setup(0,3,0,1,0,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);fixtures::mint(&mut sc,21,0);sc.end();}
#[test]
#[expected_failure(abort_code=6,location=soulidity_maker_manufacturing::maker_catalog)]
fun global_cap_serializes_shared_product(){let mut sc=fixtures::setup(0,0,0,0,1,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xc);fixtures::mint(&mut sc,21,0);sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_application::character)]
fun bound_cannot_be_exported(){let mut sc=fixtures::setup(0,0,0,0,0,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender();let it=soul::detach(&mut s,b"bound",0);transfer::public_transfer(it,@0xb);sc.return_to_sender(s);sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_application::character)]
fun reference_is_not_inventory(){let mut sc=fixtures::setup(0,0,0,0,0,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender();let it=soul::detach(&mut s,b"ref",0);transfer::public_transfer(it,@0xb);sc.return_to_sender(s);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_composition_revision_rejected(){let mut sc=fixtures::setup(0,0,0,0,0,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender();soul::tune(&mut s,b"free",fixtures::layout(),0);soul::unmount_bound(&mut s,b"bound",0);sc.return_to_sender(s);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_model::policy)]
fun tuning_outside_creator_bounds_rejected(){let mut sc=fixtures::setup(0,0,0,0,0,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender();soul::tune(&mut s,b"free",policy::layout(false,11,false,0,1000000,0,vector[]),0);sc.return_to_sender(s);sc.end();}
#[test]
fun paid_access_separate_from_control_and_complete(){
    let mut sc=fixtures::setup(15,0,0,0,0,0);
    let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=catalog::policy_hash(catalog::published(&p,1));
    let payment=coin::mint_for_testing<USD>(15,sc.ctx());catalog::buy_access_for_testing(&mut p,&mut cfg,1,hash,0,1000,fixtures::h(30),payment,&clock,sc.ctx());
    assert!(catalog::access_held(&p,1,@0xb) && !catalog::access_held(&p,1,@0xc),0);
    clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);
    sc.next_tx(@0xb);fixtures::mint(&mut sc,20,0);sc.end();
}
#[test]
fun integer_fee_handles_max(){assert!(economics::fee(18446744073709551615,10000)==18446744073709551615,0);assert!(economics::fee(1,9999)==0,1)}
