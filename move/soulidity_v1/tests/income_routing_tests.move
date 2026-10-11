#[test_only]
module soulidity_v1::income_routing_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin::{Self,Coin};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_foundation::revenue;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_application::output;
fun sum(sc:&Scenario):u64{let mut n=0;sc.ids_for_sender<Coin<USD>>().do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);n=n+coin::value(&c);sc.return_to_sender(c)});n}
#[test]
fun complete_income_receipt_and_current_control_withdrawal_after_pause(){
    let mut sc=fixtures::setup(0,1,37,0,0,3);let root=fixtures::mint(&mut sc,20,40);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let r=output::line_receipt(&output::pay_lines(output::artifact_receipt(soul::original_output(&s)))[0]);let id=output::line_product(&output::pay_lines(output::artifact_receipt(soul::original_output(&s)))[0]);assert!(economics::primary_receipt_revenue(&r)==option::some(id) && economics::primary_receipt_subject(&r)==root && economics::primary_receipt_total(&r)==40,0);sc.return_to_sender(s);
    sc.next_tx(@0xa);let cap:Control=sc.take_from_sender();transfer::public_transfer(cap,@0xc);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,9000,9000,999,@0xe,true);assert!(revenue::balance(economics::income(&cfg))==6 && revenue::collected(economics::income(&cfg))==6 && revenue::revision(economics::income(&cfg))==1,1);economics::withdraw_income(&mut cfg,&mut admin,1,6,@0x9,fixtures::h(41),sc.ctx());test_scenario::return_shared(cfg);sc.return_to_sender(admin);
    sc.next_tx(@0xc);let mut p:Product<USD> = sc.take_shared_by_id(id);let mut cap:Control=sc.take_from_sender();assert!(revenue::balance(catalog::income(&p))==34 && revenue::collected(catalog::income(&p))==34 && revenue::revision(catalog::income(&p))==1,2);catalog::lifecycle(&mut p,&mut cap,1,3);catalog::withdraw_income(&mut p,&mut cap,1,34,@0x9,fixtures::h(40),sc.ctx());assert!(revenue::balance(catalog::income(&p))==0 && revenue::withdrawn(catalog::income(&p))==34,3);test_scenario::return_shared(p);sc.return_to_sender(cap);sc.next_tx(@0x9);assert!(sum(&sc)==40,4);sc.next_tx(@0xd);assert!(sum(&sc)==0,5);sc.next_tx(@0xf);assert!(sum(&sc)==0,6);sc.end();
}
#[test]
fun two_completes_accumulate_without_changing_fee_configuration_revision(){let mut sc=fixtures::setup(0,1,37,0,0,3);fixtures::mint(&mut sc,20,40);sc.next_tx(@0xb);fixtures::mint(&mut sc,21,40);sc.next_tx(@0xa);let p:Product<USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();assert!(revenue::balance(catalog::income(&p))==68 && revenue::collected(catalog::income(&p))==68 && revenue::revision(catalog::income(&p))==2 && catalog::wallet_completes(&p,1,@0xb)==2,0);assert!(revenue::balance(economics::income(&cfg))==12 && revenue::revision(economics::income(&cfg))==2 && economics::revision(&cfg)==0,1);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();}
#[test]
fun free_complete_fixed_fee_has_only_protocol_income(){let mut sc=fixtures::setup(0,0,0,0,0,3);fixtures::mint(&mut sc,20,3);sc.next_tx(@0xa);let p:Product<USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();assert!(revenue::balance(catalog::income(&p))==0 && revenue::revision(catalog::income(&p))==0 && revenue::collected(catalog::income(&p))==0 && revenue::balance(economics::income(&cfg))==3 && revenue::revision(economics::income(&cfg))==1,0);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();}
#[test]
fun max_complete_income_can_be_fully_withdrawn_without_dust_or_overflow(){let mut sc=fixtures::setup(0,1,1000000000000,0,0,18446743073709551615);fixtures::mint(&mut sc,20,18446744073709551615);sc.next_tx(@0xa);let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let mut cap:Control=sc.take_from_sender();let mut admin:Admin=sc.take_from_sender();let net=revenue::balance(catalog::income(&p));let fee=revenue::balance(economics::income(&cfg));assert!((net as u128)+(fee as u128)==18446744073709551615 && net==900000000000 && fee==18446743173709551615,0);catalog::withdraw_income(&mut p,&mut cap,1,net,@0x9,fixtures::h(40),sc.ctx());economics::withdraw_income(&mut cfg,&mut admin,1,fee,@0x9,fixtures::h(41),sc.ctx());assert!(revenue::balance(catalog::income(&p))==0 && revenue::balance(economics::income(&cfg))==0,1);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.return_to_sender(cap);sc.return_to_sender(admin);sc.next_tx(@0x9);assert!(sum(&sc)==18446744073709551615,2);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::revenue)]
fun another_complete_invalidates_old_income_withdrawal_quote(){let mut sc=fixtures::setup(0,1,37,0,0,3);fixtures::mint(&mut sc,20,40);sc.next_tx(@0xb);fixtures::mint(&mut sc,21,40);sc.next_tx(@0xa);let mut p:Product<USD> = sc.take_shared();let mut cap:Control=sc.take_from_sender();catalog::withdraw_income(&mut p,&mut cap,1,34,@0x9,fixtures::h(40),sc.ctx());test_scenario::return_shared(p);sc.return_to_sender(cap);sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_catalog)]
fun archived_source_cannot_complete_to_add_new_income(){let mut sc=fixtures::setup(0,1,37,0,0,3);sc.next_tx(@0xa);let mut p:Product<USD> = sc.take_shared();let mut cap:Control=sc.take_from_sender();catalog::lifecycle(&mut p,&mut cap,1,3);test_scenario::return_shared(p);sc.return_to_sender(cap);sc.next_tx(@0xb);fixtures::mint(&mut sc,20,40);sc.end();}
