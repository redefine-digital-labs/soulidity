#[test_only]
module soulidity_v1::primary_snapshot_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use sui::coin::{Self,Coin};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_v1::issuer;
use soulidity_model::policy;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_application::output;

fun change(sc:&mut Scenario,paused:bool){sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,9000,9000,999,@0xe,paused);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);}
fun mint(sc:&mut Scenario,amount:u64):ID {
    let mut sys=fixtures::prepare_storage(sc);let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let intent=fixtures::default_intent(&p,20,fixtures::default_recipe(&p),sc.sender());let revision=economics::revision(&cfg);
    let mut b=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&cfg),&mut p,&mut cfg,intent,b"default",revision,1000,coin::mint_for_testing<USD>(amount,sc.ctx()),&clock,sc.ctx());
    issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"ref",0,10)),b"ref",fixtures::layout(),sc.ctx());issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"bound",1,10)),b"bound",fixtures::layout(),sc.ctx());issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"free",2,10)),b"free",fixtures::layout(),sc.ctx());
    let id=fixtures::finish(sc,b,&mut sys,&clock);test_scenario::return_shared(sys);clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.next_tx(@0xb);id
}
fun sum(sc:&Scenario):u64{let ids=sc.ids_for_sender<Coin<USD>>();let mut total=0;ids.do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);total=total+coin::value(&c);sc.return_to_sender(c)});total}
#[test]
fun complete_fees_recipients_and_fixed_fee_survive_config_change(){
    let mut sc=fixtures::setup(0,1,37,0,0,3);change(&mut sc,false);let id=mint(&mut sc,40);let s:Soul=sc.take_from_sender_by_id(id);let out=output::artifact_receipt(soul::original_output(&s));let line=&output::pay_lines(out)[0];let r=output::line_receipt(line);let p=economics::primary_receipt_policy(&r);
    assert!(output::total_paid(out)==40 && output::platform_recipient(out)==@0xf && output::fee_revision(out)==1 && output::line_platform(line)==3 && output::line_fixed(line)==3,0);assert!(economics::primary_policy_revision(&p)==0 && economics::primary_policy_bps(&p)==1000 && economics::primary_policy_fixed(&p)==3 && economics::primary_receipt_revision(&r)==1,1);
    assert!(economics::primary_receipt_subject(&r)==id && economics::primary_receipt_actor(&r)==@0xb && economics::primary_receipt_attempt(&r)==fixtures::h(20) && economics::primary_receipt_net(&r)==34,2);let product=output::line_product(line);sc.return_to_sender(s);sc.next_tx(@0xd);assert!(fixtures::product_income(&sc,product)==34 && sum(&sc)==0,3);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==6 && sum(&sc)==0,4);sc.next_tx(@0xe);assert!(sum(&sc)==0,5);sc.end();
}
#[test]
fun access_uses_exact_version_snapshot_and_persists_full_receipt(){
    let mut sc=fixtures::setup(15,0,0,0,0,3);change(&mut sc,false);let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=catalog::policy_hash(catalog::published(&p,1));let q=catalog::access_quote(&p,&cfg,1,@0xb,fixtures::h(30),1000);assert!(economics::primary_receipt_total(&q)==15 && economics::primary_receipt_fixed(&q)==0 && economics::primary_receipt_fee(&q)==1,0);
    catalog::buy_access_for_testing(&mut p,&mut cfg,1,hash,1,1000,fixtures::h(30),coin::mint_for_testing<USD>(15,sc.ctx()),&clock,sc.ctx());let r=catalog::payment_receipt(&p,@0xb,1,fixtures::h(30)).destroy_some();assert!(r==q && economics::primary_receipt_subject(&r)==object::id(&p) && catalog::access_held(&p,1,@0xb),1);assert!(soulidity_foundation::revenue::balance(catalog::income(&p))==14 && soulidity_foundation::revenue::balance(economics::income(&cfg))==1,5);clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.next_tx(@0xd);assert!(sum(&sc)==0,2);sc.next_tx(@0xf);assert!(sum(&sc)==0,3);sc.next_tx(@0xe);assert!(sum(&sc)==0,4);sc.end();
}
#[test]
fun free_complete_only_charges_snapshotted_fixed_fee(){let mut sc=fixtures::setup(0,0,0,0,0,3);change(&mut sc,false);let id=mint(&mut sc,3);let s:Soul=sc.take_from_sender_by_id(id);let line=&output::pay_lines(output::artifact_receipt(soul::original_output(&s)))[0];assert!(output::line_gross(line)==0 && output::line_platform(line)==0 && output::line_fixed(line)==3,0);sc.return_to_sender(s);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==3 && sum(&sc)==0,1);sc.next_tx(@0xd);assert!(sum(&sc)==0,2);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun paid_complete_nonzero_fee_cannot_floor_to_zero(){let mut sc=fixtures::setup(0,1,1,0,0,0);mint(&mut sc,1);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun paid_access_nonzero_fee_cannot_floor_to_zero(){let sc=fixtures::setup(1,0,0,0,0,0);let p:Product<USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();catalog::access_quote(&p,&cfg,1,@0xb,fixtures::h(30),1000);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun paused_config_cannot_be_bypassed_using_old_snapshot(){let mut sc=fixtures::setup(0,1,37,0,0,3);change(&mut sc,true);mint(&mut sc,40);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun total_complete_price_overflow_rejected(){let mut sc=fixtures::setup(0,1,1000000000000,0,0,18446744073709551615);mint(&mut sc,18446744073709551615);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun snapshot_rejects_wrong_same_coin_config_instance(){let mut sc=fixtures::setup(15,0,0,0,0,0);sc.next_tx(@0xa);let auth:soulidity_foundation::economics::Authority=sc.take_from_sender();let id=soulidity_v1::native_binding::create_enabled_for_testing<USD>(&auth,1000,500,0,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xb);let p:Product<USD> = sc.take_shared();let wrong:Config<USD> = sc.take_shared_by_id(id);catalog::access_quote(&p,&wrong,1,@0xb,fixtures::h(30),1000);test_scenario::return_shared(wrong);test_scenario::return_shared(p);sc.end();}
#[test]
fun maximum_total_primary_settlement_conserves_funds(){let mut sc=fixtures::setup(0,1,1000000000000,0,0,18446743073709551615);let id=mint(&mut sc,18446744073709551615);let s:Soul=sc.take_from_sender_by_id(id);let r=output::line_receipt(&output::pay_lines(output::artifact_receipt(soul::original_output(&s)))[0]);assert!((economics::primary_receipt_net(&r) as u128)+(economics::primary_receipt_fee(&r) as u128)+(economics::primary_receipt_fixed(&r) as u128)==18446744073709551615 && economics::primary_receipt_gross(&r)==1000000000000,0);sc.return_to_sender(s);sc.end();}
#[test]
fun generic_primary_quote_keeps_maximum_gross(){let sc=fixtures::setup(0,0,0,0,0,0);let cfg:Config<USD> =sc.take_shared();let p=economics::primary_policy(&cfg);let r=economics::primary_quote(&p,&cfg,18446744073709551615,false,@0xd,object::id(&cfg),fixtures::h(1),@0xb,fixtures::h(30),1000);assert!((economics::primary_receipt_net(&r) as u128)+(economics::primary_receipt_fee(&r) as u128)==18446744073709551615,0);test_scenario::return_shared(cfg);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun third_party_cannot_settle_someone_elses_receipt(){let mut sc=fixtures::setup(15,0,0,0,0,0);let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let r=catalog::access_quote(&p,&cfg,1,@0xb,fixtures::h(30),1000);sc.next_tx(@0xc);let clock=clock::create_for_testing(sc.ctx());catalog::collect_primary_for_testing(&mut p,&mut cfg,r,coin::mint_for_testing<USD>(15,sc.ctx()),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();}
#[test]
fun zero_fee_policy_has_no_fee_coin_and_preserves_positive_beneficiary(){let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,0,500,0,@0xf,false);let p=economics::primary_policy(&cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);let r=economics::primary_quote(&p,&cfg,1,false,@0xd,object::id(&cfg),fixtures::h(1),@0xb,fixtures::h(30),1000);let r=economics::route_primary(r,object::id(&cfg));let clock=clock::create_for_testing(sc.ctx());let net=catalog::settle_quote_for_testing(&mut cfg,r,coin::mint_for_testing<USD>(1,sc.ctx()),&clock,sc.ctx());assert!(coin::value(&net)==1 && soulidity_foundation::revenue::balance(economics::income(&cfg))==0,2);transfer::public_transfer(net,@0xd);clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);sc.next_tx(@0xd);assert!(sum(&sc)==1,0);sc.next_tx(@0xf);assert!(sum(&sc)==0,1);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun one_hundred_percent_primary_fee_cannot_leave_zero_beneficiary(){let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,10000,500,0,@0xf,false);let p=economics::primary_policy(&cfg);economics::primary_quote(&p,&cfg,37,false,@0xd,object::id(&cfg),fixtures::h(1),@0xb,fixtures::h(30),1000);sc.return_to_sender(admin);test_scenario::return_shared(cfg);sc.end();}
#[test]
fun new_version_changes_its_price_beneficiary_but_not_old_snapshot(){
    let mut sc=fixtures::setup(15,0,0,0,0,3);change(&mut sc,false);sc.next_tx(@0xa);let mut p:Product<USD> = sc.take_shared();let mut cap:soulidity_maker_manufacturing::maker_catalog::Control=sc.take_from_sender();let registry:soulidity_content_kinds::content_kind_registry::KindRegistry=sc.take_shared();let old=catalog::preview_source(&p,1,policy::definition_hash(&fixtures::def(b"free",2,10)));
    let v=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),1,27,0,0,0,0,1000,@0xe,soulidity_maker_terms::maker_resale::rates(500,500),vector[b"free"],vector[b"free"],vector[fixtures::def(b"free",2,10)],vector[],fixtures::scene()),vector[fixtures::default_output(&registry,false,true,vector[])]);catalog::publish(&mut p,&mut cap,1,v);
    assert!(catalog::version_primary(catalog::published(&p,2))==catalog::version_primary(catalog::published(&p,1)) && catalog::preview_source(&p,1,policy::definition_hash(&fixtures::def(b"free",2,10)))==old,0);sc.return_to_sender(cap);test_scenario::return_shared(registry);sc.next_tx(@0xb);let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let h1=catalog::policy_hash(catalog::published(&p,1));let h2=catalog::policy_hash(catalog::published(&p,2));catalog::buy_access_for_testing(&mut p,&mut cfg,1,h1,1,1000,fixtures::h(30),coin::mint_for_testing<USD>(15,sc.ctx()),&clock,sc.ctx());catalog::buy_access_for_testing(&mut p,&mut cfg,2,h2,1,1000,fixtures::h(31),coin::mint_for_testing<USD>(27,sc.ctx()),&clock,sc.ctx());assert!(catalog::access_held(&p,1,@0xb) && catalog::access_held(&p,2,@0xb),1);assert!(soulidity_foundation::revenue::balance(catalog::income(&p))==39 && soulidity_foundation::revenue::balance(economics::income(&cfg))==3,5);clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.next_tx(@0xd);assert!(sum(&sc)==0,2);sc.next_tx(@0xe);assert!(sum(&sc)==0,3);sc.next_tx(@0xf);assert!(sum(&sc)==0,4);sc.end();
}
#[test]
fun access_valid_at_exact_expiry(){let mut sc=fixtures::setup(15,0,0,0,0,0);let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let mut clock=clock::create_for_testing(sc.ctx());clock::increment_for_testing(&mut clock,1000);let h=catalog::policy_hash(catalog::published(&p,1));catalog::buy_access_for_testing(&mut p,&mut cfg,1,h,0,1000,fixtures::h(30),coin::mint_for_testing<USD>(15,sc.ctx()),&clock,sc.ctx());assert!(catalog::access_held(&p,1,@0xb),0);clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_foundation::economics)]
fun access_invalid_after_expiry(){let mut sc=fixtures::setup(15,0,0,0,0,0);let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let mut clock=clock::create_for_testing(sc.ctx());clock::increment_for_testing(&mut clock,1001);let h=catalog::policy_hash(catalog::published(&p,1));catalog::buy_access_for_testing(&mut p,&mut cfg,1,h,0,1000,fixtures::h(30),coin::mint_for_testing<USD>(15,sc.ctx()),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();}
