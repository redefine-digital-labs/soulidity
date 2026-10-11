#[test_only]
module soulidity_v1::paid_access_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use sui::coin::{Self,Coin};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::storage_fixture;
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use sui::kiosk::Kiosk;
use soulidity_custody::account::{Self as custody,Account};
use soulidity_v1::access;
use soulidity_content::paid_access;
use soulidity_foundation::economics::{Self,Config,Admin};
use walrus::system::System;
public(package) fun setup(read:u64,duration:Option<u64>):(Scenario,ID,vector<u8>,System,Clock) {
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);
    let mut sys:System=sc.take_shared();
    let r:KindRegistry=sc.take_shared();let mut s:Soul=sc.take_from_sender_by_id(root);let clock=clock::create_for_testing(sc.ctx());
    let blob=storage_fixture::blob(&mut sys,30,false,true,sc.ctx());
    soul::append_content(&mut s,&r,3,std::string::utf8(b"main"),read,1,blob,&sys,fixtures::h(30),vector::tabulate!(16,|_|30),b"envelope",0,0,fixtures::h(30),&clock);
    let id=soul::seal_id(&s,3);test_scenario::return_shared(r);
    custody::create(sc.ctx());sc.return_to_sender(s);sc.next_tx(@0xb);
    let cfg:Config<USD> = sc.take_shared();let mut v:Kiosk=sc.take_shared();let mut cap:Account=sc.take_from_sender();access::install(&mut v,&mut cap,&cfg,sc.ctx());let s:Soul=sc.take_from_sender_by_id(root);access::deposit(&mut v,&mut cap,s,&cfg,0,1,sc.ctx());test_scenario::return_shared(cfg);
    let r:KindRegistry=sc.take_shared();
    access::configure_paid(&mut v,&mut cap,root,&r,3,37,8,duration,0,1,2,sc.ctx());sc.return_to_sender(cap);test_scenario::return_shared(v);test_scenario::return_shared(r);sc.next_tx(@0x8);(sc,root,id,sys,clock)
}
fun buy(sc:&mut Scenario,clock:&Clock,attempt:u8,amount:u64) {
    let mut v:Kiosk = sc.take_shared();let root=access::root_ids(&v)[0];let mut cfg:Config<USD> = sc.take_shared();let quote=access::paid_quote(&v,root,3);let previous=access::paid_entry_hash(&v,root,3,sc.sender());let rev=access::revision(&v);let root_rev=access::soul_revision(&v,root);
    let payment=coin::mint_for_testing<USD>(amount,sc.ctx());access::buy_paid(&mut v,root,&mut cfg,3,rev,root_rev,quote,previous,0,10000,fixtures::h(attempt),payment,clock,sc.ctx());test_scenario::return_shared(v);test_scenario::return_shared(cfg)
}
fun finish(mut sc:Scenario,sys:System,clock:Clock){storage_fixture::return_system(sys);clock::destroy_for_testing(clock);sc.end();}
#[test]
fun paid_content_platform_income_is_withdrawable_without_revoking_subscription(){let(mut sc,root,id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();assert!(soulidity_foundation::revenue::balance(economics::income(&cfg))==3 && soulidity_foundation::revenue::collected(economics::income(&cfg))==3,0);economics::withdraw_income(&mut cfg,&mut admin,1,3,@0x9,fixtures::h(50),sc.ctx());test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0x9);let c:Coin<USD> = sc.take_from_sender();assert!(coin::value(&c)==3,1);sc.return_to_sender(c);sc.next_tx(@0x8);let v:Kiosk = sc.take_shared();access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);finish(sc,sys,clock)}
#[test]
fun exact_paid_purchase_renewal_receipt_and_conserved_money() {
    let(mut sc,root,id,sys,mut clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0x8);
    let v:Kiosk = sc.take_shared();assert!(paid_access::expires(&access::paid_entry(&v,root,3,@0x8).destroy_some())==option::some(1000),0);let receipt=access::paid_receipt(&v,root,@0x8,fixtures::h(40)).destroy_some();assert!(paid_access::receipt_price(&receipt)==37 && paid_access::receipt_total(&receipt)==40 && paid_access::receipt_fee(&receipt)==3 && paid_access::receipt_fee_revision(&receipt)==0 && paid_access::receipt_beneficiary(&receipt)==@0xb && paid_access::receipt_platform_recipient(&receipt)==@0xf,1);access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);
    clock::increment_for_testing(&mut clock,100);sc.next_tx(@0x8);buy(&mut sc,&clock,41,40);sc.next_tx(@0x8);
    let v:Kiosk = sc.take_shared();assert!(paid_access::expires(&access::paid_entry(&v,root,3,@0x8).destroy_some())==option::some(2000),2);test_scenario::return_shared(v);
    sc.next_tx(@0xb);let ids=test_scenario::ids_for_address<Coin<USD>>(@0xb);let mut sum=0;ids.do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);sum=sum+coin::value(&c);sc.return_to_sender(c)});assert!(sum==74,3);
    sc.next_tx(@0xf);let ids=test_scenario::ids_for_address<Coin<USD>>(@0xf);let mut sum=0;ids.do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);sum=sum+coin::value(&c);sc.return_to_sender(c)});assert!(sum==0 && fixtures::protocol_income(&sc)==6,4);finish(sc,sys,clock)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_content::paid_access)]
fun exact_payment_required(){let(mut sc,root,_id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,36);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_content::paid_access)]
fun committed_attempt_cannot_buy_twice(){let(mut sc,root,_id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0x8);buy(&mut sc,&clock,40,40);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::paid_access)]
fun paid_entry_expires_at_exact_deadline(){let(mut sc,root,id,sys,mut clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0x8);clock::increment_for_testing(&mut clock,1000);let v:Kiosk = sc.take_shared();access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content::document)]
fun paid_subscription_does_not_bypass_slot_read_policy(){let(mut sc,root,id,sys,clock)=setup(1,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0x8);let v:Kiosk = sc.take_shared();access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::paid_access)]
fun unpaid_other_wallet_cannot_use_receipt(){let(mut sc,root,id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0x9);let v:Kiosk = sc.take_shared();access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::paid_access)]
fun handover_and_return_do_not_revive_paid_access() {
    let(mut sc,root,id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0xb);
    let mut v:Kiosk = sc.take_shared();let mut cap:Account=sc.take_from_sender();access::withdraw(&mut v,&mut cap,root,3,4,sc.ctx());sc.return_to_sender(cap);test_scenario::return_shared(v);
    sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);transfer::public_transfer(s,@0xc);sc.next_tx(@0xc);let s:Soul=sc.take_from_sender_by_id(root);transfer::public_transfer(s,@0xb);
    sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let mut v:Kiosk=sc.take_shared();let mut cap:Account=sc.take_from_sender();let cfg:Config<USD> =sc.take_shared();access::deposit(&mut v,&mut cap,s,&cfg,4,5,sc.ctx());sc.return_to_sender(cap);test_scenario::return_shared(v);test_scenario::return_shared(cfg);
    sc.next_tx(@0x8);let v:Kiosk = sc.take_shared();access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);finish(sc,sys,clock)
}
#[test]
fun removing_offer_keeps_previously_purchased_access() {
    let(mut sc,root,id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0xb);
    let mut v:Kiosk = sc.take_shared();let mut cap:Account=sc.take_from_sender();access::remove_paid_offer(&mut v,&mut cap,root,3,2,3,4,sc.ctx());assert!(access::paid_offer(&v,root,3).is_none(),0);test_scenario::return_shared(v);sc.return_to_sender(cap);
    sc.next_tx(@0x8);let v:Kiosk = sc.take_shared();access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);finish(sc,sys,clock)
}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::paid_access)]
fun owner_can_revoke_current_buyer() {
    let(mut sc,root,id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,40);sc.next_tx(@0xb);
    let mut v:Kiosk = sc.take_shared();let mut cap:Account=sc.take_from_sender();let entry=access::paid_entry_hash(&v,root,3,@0x8).destroy_some();access::revoke_paid_access(&mut v,&mut cap,root,3,@0x8,2,entry,3,4,sc.ctx());test_scenario::return_shared(v);sc.return_to_sender(cap);
    sc.next_tx(@0x8);let v:Kiosk = sc.take_shared();access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);finish(sc,sys,clock)
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_content::paid_access)]
fun perpetual_entry_cannot_be_rebought(){let(mut sc,root,_id,sys,clock)=setup(5,option::none());buy(&mut sc,&clock,40,40);sc.next_tx(@0x8);buy(&mut sc,&clock,41,40);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content::paid_access)]
fun changed_owner_quote_cannot_charge_buyer() {
    let(mut sc,root,_id,sys,clock)=setup(5,option::some(1000));let v:Kiosk = sc.take_shared();let quote=access::paid_quote(&v,root,3);test_scenario::return_shared(v);
    sc.next_tx(@0xb);let mut v:Kiosk = sc.take_shared();let mut cap:Account=sc.take_from_sender();let r:KindRegistry=sc.take_shared();access::configure_paid(&mut v,&mut cap,root,&r,3,40,8,option::some(1000),1,2,3,sc.ctx());test_scenario::return_shared(v);test_scenario::return_shared(r);sc.return_to_sender(cap);
    sc.next_tx(@0x8);let mut v:Kiosk = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let pay=coin::mint_for_testing<USD>(37,sc.ctx());access::buy_paid(&mut v,root,&mut cfg,3,3,4,quote,option::none(),0,10000,fixtures::h(40),pay,&clock,sc.ctx());test_scenario::return_shared(v);test_scenario::return_shared(cfg);finish(sc,sys,clock)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun protocol_pause_blocks_new_paid_purchase() {
    let(mut sc,root,_id,sys,clock)=setup(5,option::some(1000));sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,1000,500,0,@0xf,true);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0x8);buy(&mut sc,&clock,40,40);finish(sc,sys,clock)
}
#[test]
fun owner_can_add_expiring_access_and_clean_up_after_expiry() {
    let(mut sc,root,id,sys,mut clock)=setup(5,option::some(1000));sc.next_tx(@0xb);let mut v:Kiosk = sc.take_shared();let mut cap:Account=sc.take_from_sender();let r:KindRegistry=sc.take_shared();
    access::add_paid_access(&mut v,&mut cap,root,&r,3,@0x8,8,option::some(500),1,option::none(),2,3,&clock,sc.ctx());test_scenario::return_shared(v);test_scenario::return_shared(r);sc.return_to_sender(cap);
    sc.next_tx(@0x8);let v:Kiosk = sc.take_shared();access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);clock::increment_for_testing(&mut clock,500);
    sc.next_tx(@0xb);let mut v:Kiosk = sc.take_shared();let mut cap:Account=sc.take_from_sender();access::cleanup_paid_access(&mut v,&mut cap,root,3,@0x8,2,3,4,&clock,sc.ctx());assert!(access::paid_entry(&v,root,3,@0x8).is_none(),0);test_scenario::return_shared(v);sc.return_to_sender(cap);finish(sc,sys,clock)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_content::paid_access)]
fun original_ask_alone_cannot_buy_additional_fee_offer(){let(mut sc,root,_id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,37);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_content::paid_access)]
fun overpayment_is_rejected_without_partial_issue(){let(mut sc,root,_id,sys,clock)=setup(5,option::some(1000));buy(&mut sc,&clock,40,41);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun primary_total_cannot_overflow(){let(sc,root,_id,sys,clock)=setup(5,option::some(1000));let cfg:Config<USD> = sc.take_shared();economics::primary_total(&cfg,18446744073709551615);test_scenario::return_shared(cfg);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun old_fee_revision_cannot_pay_under_new_rate(){let(mut sc,root,_id,sys,clock)=setup(5,option::some(1000));sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,2000,500,0,@0xf,false);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0x8);buy(&mut sc,&clock,40,40);finish(sc,sys,clock)}
#[test]
fun zero_ask_destroys_zero_coin_and_keeps_exact_receipt(){
    let(mut sc,root,id,sys,clock)=setup(5,option::some(1000));sc.next_tx(@0xb);let mut v:Kiosk = sc.take_shared();let mut cap:Account=sc.take_from_sender();let r:KindRegistry=sc.take_shared();access::configure_paid(&mut v,&mut cap,root,&r,3,0,8,option::some(1000),1,2,3,sc.ctx());test_scenario::return_shared(v);test_scenario::return_shared(r);sc.return_to_sender(cap);sc.next_tx(@0x8);buy(&mut sc,&clock,40,0);sc.next_tx(@0x8);
    let v:Kiosk = sc.take_shared();let receipt=access::paid_receipt(&v,root,@0x8,fixtures::h(40)).destroy_some();assert!(paid_access::receipt_total(&receipt)==0 && paid_access::receipt_price(&receipt)==0 && paid_access::receipt_fee(&receipt)==0,0);access::seal_approve_paid(id,&v,root,3,&sys,&clock,sc.ctx());test_scenario::return_shared(v);assert!(test_scenario::ids_for_address<Coin<USD>>(@0xb).is_empty() && test_scenario::ids_for_address<Coin<USD>>(@0xf).is_empty(),1);finish(sc,sys,clock)
}
#[test]
fun additional_fee_rounds_each_ask_without_reducing_owner_payout(){let(sc,root,_id,sys,clock)=setup(5,option::some(1000));let v:Kiosk = sc.take_shared();let cfg:Config<USD> = sc.take_shared();assert!(access::paid_total(&v,root,&cfg,3)==40 && economics::primary_total(&cfg,9)==9 && economics::primary_total(&cfg,10)==11 && economics::primary_total(&cfg,101)==111,0);test_scenario::return_shared(v);test_scenario::return_shared(cfg);finish(sc,sys,clock)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_content::paid_access)]
fun quote_total_rejects_same_coin_type_wrong_config(){let(mut sc,root,_id,sys,clock)=setup(5,option::some(1000));sc.next_tx(@0xa);let auth:soulidity_foundation::economics::Authority=sc.take_from_sender();let wrong=soulidity_v1::native_binding::create_enabled_for_testing<USD>(&auth,0,0,0,@0xe,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0x8);let cfg:Config<USD> = sc.take_shared_by_id(wrong);let v:Kiosk = sc.take_shared();access::paid_total(&v,root,&cfg,3);test_scenario::return_shared(v);test_scenario::return_shared(cfg);finish(sc,sys,clock)}
