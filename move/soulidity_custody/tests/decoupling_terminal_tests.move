#[test_only]
module soulidity_custody::decoupling_terminal_tests;
use soulidity_custody::lifecycle;
use sui::test_scenario;
use sui::kiosk::Kiosk;
use sui::transfer_policy;
use soulidity_standard::soul::{Self,Soul};
use soulidity_custody::account::{Self,Account};
use private_source::producer;
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun terminal_rejects_crossed_two_real_account_pairs(){
    let mut sc=test_scenario::begin(@0xa);let(mut k,a)=account::new(sc.ctx());let(k2,a2)=account::new(sc.ctx());let p=producer::create(sc.ctx());
    let c=lifecycle::new(producer::witness_for_testing(),&p,producer::request<Soul>(&p,0,sc.ctx()),sc.ctx());let(policy,pc)=transfer_policy::new_for_testing<Soul>(sc.ctx());let auth=producer::complete(&p,lifecycle::construction_ref(&c),lifecycle::construction_snapshot(&c),sc.ctx());
    account::deliver_locked_account(c,auth,&mut k,a2,&policy,sc.ctx());account::finalize(k,a,sc.ctx());transfer::public_share_object(k2);transfer::public_share_object(policy);transfer::public_transfer(pc,@0xa);transfer::public_transfer(p,@0xa);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_custody::account)]
fun terminal_rejects_wrong_sender_of_existing_account(){
    let mut sc=test_scenario::begin(@0xa);let(k,a)=account::new(sc.ctx());let ki=object::id(&k);let ai=object::id(&a);account::finalize(k,a,sc.ctx());
    sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(ki);let a:Account=sc.take_from_address_by_id(@0xa,ai);let p=producer::create(sc.ctx());
    let c=lifecycle::new(producer::witness_for_testing(),&p,producer::request<Soul>(&p,0,sc.ctx()),sc.ctx());let(policy,pc)=transfer_policy::new_for_testing<Soul>(sc.ctx());let auth=producer::complete(&p,lifecycle::construction_ref(&c),lifecycle::construction_snapshot(&c),sc.ctx());
    account::deliver_locked_account(c,auth,&mut k,a,&policy,sc.ctx());test_scenario::return_shared(k);transfer::public_share_object(policy);transfer::public_transfer(pc,@0xb);transfer::public_transfer(p,@0xb);sc.end();
}
