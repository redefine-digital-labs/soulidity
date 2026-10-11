#[test_only]
module soulidity_v1::pack_tests;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::coin;
use sui::clock;
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::Config;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_model::policy;
use soulidity_v1::issuer;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_application::output;
use soulidity_v1::storage_fixture;

fun pack_setup(): (Scenario,ID,ID) {
    pack_setup_filtered(true,vector[])
}
fun pack_setup_filtered(all:bool,allowed:vector<vector<u8>>): (Scenario,ID,ID) {
    let mut sc=fixtures::setup_with_output(0,0,0,0,0,0,false,all,allowed);sc.next_tx(@0xa);
    let maker:Product<USD> = sc.take_shared();let mut control:Control=sc.take_from_sender();let maker_id=object::id(&maker);
    let cfg:Config<USD> = sc.take_shared();let pack_id=catalog::create_pack_for_testing(&maker,1,&mut control,&cfg,500,sc.ctx());test_scenario::return_shared(cfg);test_scenario::return_shared(maker);sc.return_to_sender(control);
    sc.next_tx(@0xa);let mut pack:Product<USD> = sc.take_shared_by_id(pack_id);let mut c=control_for(&sc,pack_id);
    catalog::publish(&mut pack,&mut c,0,catalog::with_pack_key(catalog::version(fixtures::h(3),fixtures::h(4),2,0,1,19,0,0,1000,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"bound"],vector[],vector[fixtures::pack_def(b"bound",1,20)],vector[],fixtures::scene()),b"pack"));
    test_scenario::return_shared(pack);sc.return_to_sender(c);sc.next_tx(@0xb);(sc,maker_id,pack_id)
}
fun mint(sc:&mut Scenario,maker_id:ID,pack_id:ID,use_pack:bool):ID {
    let mut system=fixtures::prepare_storage(sc);
    let mut maker:Product<USD> = sc.take_shared_by_id(maker_id);let mut pack:Product<USD> = sc.take_shared_by_id(pack_id);let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let bound=if(use_pack)option::some(output::selection(catalog::preview_source(&pack,1,policy::definition_hash(&fixtures::pack_def(b"bound",1,20))),fixtures::layout(),option::none())) else option::none();
    let recipe=fixtures::recipe(vector[output::slot(b"ref",option::none()),output::slot(b"bound",bound),output::slot(b"free",option::some(output::selection(catalog::preview_source(&maker,1,policy::definition_hash(&fixtures::def(b"free",2,10))),fixtures::layout(),option::none())))]);
    let revision=soulidity_foundation::economics::revision(&cfg);let intent=fixtures::default_intent(&maker,20,recipe,sc.sender());let coin=coin::zero<USD>(sc.ctx());let mut b=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&cfg),&mut maker,&mut cfg,intent,b"default",revision,1000,coin,&clock,sc.ctx());
    let hash=catalog::policy_hash(catalog::published(&pack,1));let pay=coin::mint_for_testing<USD>(19,sc.ctx());issuer::include_pack_for_testing(&mut b,&mut pack,&maker,&mut cfg,1,hash,revision,1000,pay,&clock,sc.ctx());
    issuer::select(&mut b,&mut maker,policy::definition_hash(&fixtures::def(b"free",2,10)),b"free",fixtures::layout(),sc.ctx());
    if(use_pack)issuer::select(&mut b,&mut pack,policy::definition_hash(&fixtures::pack_def(b"bound",1,20)),b"bound",fixtures::layout(),sc.ctx());
    let id=fixtures::finish(sc,b,&mut system,&clock);storage_fixture::return_system(system);clock::destroy_for_testing(clock);test_scenario::return_shared(maker);test_scenario::return_shared(pack);test_scenario::return_shared(cfg);id
}
#[test]
fun included_pack_mints_bound_uses_parent_access() {
    let(mut sc,maker_id,pack_id)=pack_setup();let id=mint(&mut sc,maker_id,pack_id,true);sc.next_tx(@0xb);
    let s:Soul=sc.take_from_sender_by_id(id);assert!(soul::bound_count(&s)==1,0);let source=soul::bound_source(&s,0);assert!(policy::source_product(source)==pack_id && policy::source_maker(source)==maker_id && policy::maker_version(source)==1,1);sc.return_to_sender(s);sc.end();
}
#[test]
fun allowlisted_pack_retains_exact_contribution_receipt(){
    let(mut sc,maker_id,pack_id)=pack_setup_filtered(false,vector[b"pack"]);let id=mint(&mut sc,maker_id,pack_id,true);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);
    let receipt=output::artifact_receipt(soul::original_output(&s));let lines=output::pay_lines(receipt);assert!(lines.length()==2 && output::total_paid(receipt)==19 && output::fee_revision(receipt)==0,0);
    assert!(output::line_product(&lines[0])==maker_id && output::line_gross(&lines[0])==0 && output::line_fixed(&lines[0])==0 && output::line_product(&lines[1])==pack_id && output::line_gross(&lines[1])==19 && output::line_platform(&lines[1])==1 && output::line_beneficiary(&lines[1])==@0xe,1);sc.return_to_sender(s);
    sc.next_tx(@0xe);assert!(fixtures::product_income(&sc,pack_id)==18 && sc.ids_for_sender<sui::coin::Coin<USD>>().is_empty(),2);
    sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==1 && sc.ids_for_sender<sui::coin::Coin<USD>>().is_empty(),3);sc.end();
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_publication::output_data)]
fun creator_output_pack_allowlist_enforced_before_charge(){let(mut sc,maker_id,pack_id)=pack_setup_filtered(false,vector[b"other-pack"]);mint(&mut sc,maker_id,pack_id,true);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_v1::issuer)]
fun unused_pack_cannot_charge_complete(){let(mut sc,maker_id,pack_id)=pack_setup();mint(&mut sc,maker_id,pack_id,false);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_manufacturing::maker_catalog)]
fun unrelated_control_cannot_publish_pack(){
    let(mut sc,maker_id,pack_id)=pack_setup();sc.next_tx(@0xa);let pack:Product<USD> = sc.take_shared_by_id(pack_id);let c=control_for(&sc,maker_id);let maker:Product<USD> = sc.take_shared_by_id(maker_id);
    catalog::assert_control(&pack,&c);test_scenario::return_shared(pack);test_scenario::return_shared(maker);sc.return_to_sender(c);sc.end();
}
#[test]
#[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)]
fun pack_cannot_declare_ignored_soul_royalty_policy(){let(mut sc,_maker,pack_id)=pack_setup();sc.next_tx(@0xa);let mut p:Product<USD> = sc.take_shared_by_id(pack_id);let mut c=control_for(&sc,pack_id);let v=catalog::with_pack_key(catalog::version(fixtures::h(3),fixtures::h(4),2,0,1,19,0,0,1000,@0xe,soulidity_maker_terms::maker_resale::rates(500,0),vector[b"bound"],vector[],vector[fixtures::pack_def(b"bound",1,20)],vector[],fixtures::scene()),b"pack");catalog::publish(&mut p,&mut c,1,v);test_scenario::return_shared(p);sc.return_to_sender(c);sc.end();}

fun control_for(sc:&Scenario,product:ID):Control {
    let ids=sc.ids_for_sender<Control>();let mut result=option::none();
    ids.do_ref!(|id|{let c:Control=sc.take_from_sender_by_id(*id);if(catalog::control_product(&c)==product)result.fill(c) else sc.return_to_sender(c)});
    result.destroy_some()
}
#[test]
fun pack_complete_uses_parent_issuance_snapshot_after_admin_changes(){let(mut sc,m,p)=pack_setup();sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();soulidity_foundation::economics::configure(&mut cfg,&mut admin,0,9000,9000,999,@0x9,false);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);let id=mint(&mut sc,m,p,true);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);let r=output::artifact_receipt(soul::original_output(&s));assert!(output::fee_revision(r)==1 && output::platform_recipient(r)==@0xf && output::total_paid(r)==19,0);let line=&output::pay_lines(r)[1];let primary=soulidity_foundation::economics::primary_receipt_policy(&output::line_receipt(line));assert!(output::line_platform(line)==1 && output::line_fixed(line)==0 && soulidity_foundation::economics::primary_policy_bps(&primary)==1000,1);sc.return_to_sender(s);sc.next_tx(@0xe);assert!(fixtures::product_income(&sc,p)==18 && sc.ids_for_sender<sui::coin::Coin<USD>>().is_empty(),2);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==1 && sc.ids_for_sender<sui::coin::Coin<USD>>().is_empty(),3);sc.next_tx(@0x9);assert!(sc.ids_for_sender<sui::coin::Coin<USD>>().is_empty(),4);sc.end();}

#[test]
fun pack_complete_income_is_separate_and_redeemable_by_new_pack_controller(){let(mut sc,m,p)=pack_setup();let root=mint(&mut sc,m,p,true);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let lines=output::pay_lines(output::artifact_receipt(soul::original_output(&s)));assert!(soulidity_foundation::economics::primary_receipt_revenue(&output::line_receipt(&lines[0]))==option::some(m) && soulidity_foundation::economics::primary_receipt_revenue(&output::line_receipt(&lines[1]))==option::some(p),0);sc.return_to_sender(s);sc.next_tx(@0xa);let cap=control_for(&sc,p);transfer::public_transfer(cap,@0xc);let mut cfg:Config<USD> = sc.take_shared();let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();soulidity_foundation::economics::withdraw_income(&mut cfg,&mut admin,1,1,@0x9,fixtures::h(41),sc.ctx());test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xc);let mut pack:Product<USD> = sc.take_shared_by_id(p);let mut cap=control_for(&sc,p);assert!(soulidity_foundation::revenue::balance(catalog::income(&pack))==18 && soulidity_foundation::revenue::revision(catalog::income(&pack))==1,1);catalog::lifecycle(&mut pack,&mut cap,1,3);catalog::withdraw_income(&mut pack,&mut cap,1,18,@0x9,fixtures::h(40),sc.ctx());test_scenario::return_shared(pack);sc.return_to_sender(cap);let maker:Product<USD> = sc.take_shared_by_id(m);assert!(soulidity_foundation::revenue::balance(catalog::income(&maker))==0,2);test_scenario::return_shared(maker);sc.next_tx(@0x9);let mut sum=0;sc.ids_for_sender<sui::coin::Coin<USD>>().do_ref!(|id|{let c:sui::coin::Coin<USD> = sc.take_from_sender_by_id(*id);sum=sum+coin::value(&c);sc.return_to_sender(c)});assert!(sum==19,3);sc.end();}
