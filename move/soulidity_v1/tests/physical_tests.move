#[test_only]
module soulidity_v1::physical_tests;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::coin::{Self,Coin};
use sui::clock::{Self,Clock};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_model::material_policy::{Self,Terms};
use soulidity_v1::physical::{Self,Registry,Asset,Listing};
use soulidity_maker_manufacturing::maker_player::{Player};
use soulidity_v1::player;
use soulidity_model::policy;
use soulidity_content_kinds::content_kind_registry::KindRegistry;
use soulidity_v1::issuer;
use soulidity_application::output;
use soulidity_maker_terms::maker_physical_metadata::{Self as metadata,SalePolicy,Snapshot,SaleReceipt,Registration,Proof};
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_application::vault;
use walrus::system::System;
public struct F {sc:Scenario,maker:Product<USD>,registry:Registry<USD>,player:Player,cfg:Config<USD>,clock:Clock}
/// Explicit former field order: format relocation must preserve its BCS commitment.
public struct SnapshotShape has drop {asset:ID,registry:ID,source:policy::Source,terms:Terms,sale:SalePolicy,registration:Registration,row_hash:vector<u8>,serial:u64,holder:address,epoch:u64,authorization:vector<u8>,proof:Option<Proof>,visual:vector<u8>,provenance:vector<u8>}
public struct ReceiptShape has drop {domain:vector<u8>,listing:ID,asset:ID,revision:u64,snapshot:vector<u8>,policy:SalePolicy,config:ID,fee_revision:u64,seller:address,buyer:address,expiry:u64,gross:u64,platform:u64,creator:u64,source:u64,net:u64}
fun assert_snapshot_format(s:&Snapshot) {
    let shape=SnapshotShape{asset:metadata::snapshot_asset(s),registry:metadata::snapshot_registry(s),source:metadata::snapshot_source(s),terms:metadata::snapshot_terms(s),sale:metadata::snapshot_sale(s),registration:metadata::snapshot_registration(s),row_hash:metadata::snapshot_row_hash(s),serial:metadata::snapshot_serial(s),holder:metadata::snapshot_holder(s),epoch:metadata::snapshot_epoch(s),authorization:metadata::snapshot_authorization(s),proof:metadata::snapshot_proof(s),visual:metadata::snapshot_visual(s),provenance:metadata::snapshot_provenance(s)};
    assert!(std::bcs::to_bytes(&shape)==std::bcs::to_bytes(s),100);
}
fun assert_receipt_format(r:&SaleReceipt) {
    let shape=ReceiptShape{domain:metadata::receipt_domain(r),listing:metadata::receipt_listing(r),asset:metadata::receipt_asset(r),revision:metadata::receipt_revision(r),snapshot:metadata::receipt_snapshot(r),policy:metadata::receipt_policy(r),config:metadata::receipt_config(r),fee_revision:metadata::receipt_fee_revision(r),seller:metadata::receipt_seller(r),buyer:metadata::receipt_buyer(r),expiry:metadata::receipt_expiry(r),gross:metadata::receipt_gross(r),platform:metadata::receipt_platform(r),creator:metadata::receipt_creator(r),source:metadata::receipt_source(r),net:metadata::receipt_net(r)};
    assert!(std::bcs::to_bytes(&shape)==std::bcs::to_bytes(r),101);
}
#[test]
fun physical_snapshot_fields_remain_inspectable_across_custody_and_sale() {
    let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);let id=object::id(&a);let s=physical::snapshot(&a);assert_snapshot_format(&s);
    assert!(metadata::snapshot_asset(&s)==id && metadata::snapshot_registry(&s)==object::id(&f.registry) && metadata::snapshot_source(&s)==*physical::asset_source(&a) && metadata::snapshot_terms(&s)==*physical::asset_terms(&a),102);
    assert!(metadata::snapshot_row_hash(&s)==physical::asset_rule_hash(&a) && metadata::snapshot_authorization(&s)==physical::asset_authorization(&a) && metadata::snapshot_provenance(&s)==physical::asset_provenance(&a) && metadata::snapshot_proof(&s).is_none(),103);
    let p=metadata::snapshot_sale(&s);assert!(metadata::sale_maker(&p)==object::id(&f.maker) && metadata::sale_version(&p)==2 && metadata::sale_product(&p)==object::id(&f.maker) && metadata::sale_product_version(&p)==2 && metadata::sale_policy_hash(&p)==physical::registry_policy_hash(&f.registry),104);
    assert!(metadata::sale_creator(&p)==@0xa && metadata::sale_source_recipient(&p)==@0xd && metadata::sale_rates(&p)==physical::sale_rates(&p) && soulidity_foundation::economics::market_config(&metadata::sale_market(&p))==object::id(&f.cfg),105);
    assert!(metadata::rule_hash(metadata::snapshot_source(&s),metadata::snapshot_terms(&s),p,metadata::snapshot_registration(&s))==physical::asset_rule_hash(&a),106);
    let lid=physical::list(&f.registry,&f.maker,&f.maker,a,&f.cfg,101,1000,0,0,&f.clock,f.sc.ctx());f.sc.next_tx(@0xc);
    let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);assert!(physical::listing_snapshot(&l)==s && physical::listing_hash(&l)==metadata::snapshot_hash(&s),107);
    let quote=physical::sale_quote(&l,&f.cfg,@0xc);assert_receipt_format(&quote);
    assert!(metadata::receipt_domain(&quote)==b"soulidity-physical-resale-v1" && metadata::receipt_listing(&quote)==lid && metadata::receipt_asset(&quote)==id && metadata::receipt_snapshot(&quote)==metadata::snapshot_hash(&s) && metadata::receipt_policy(&quote)==p && metadata::receipt_revision(&quote)==0 && metadata::receipt_fee_revision(&quote)==0 && metadata::receipt_expiry(&quote)==1000,108);
    assert!(metadata::receipt_config(&quote)==object::id(&f.cfg) && metadata::receipt_seller(&quote)==@0xb && metadata::receipt_buyer(&quote)==@0xc && metadata::receipt_gross(&quote)==101 && metadata::receipt_platform(&quote)==2 && metadata::receipt_creator(&quote)==5 && metadata::receipt_source(&quote)==5 && metadata::receipt_net(&quote)==89,109);
    let ticket=test_scenario::receiving_ticket_by_id<Asset>(id);{let F{sc,maker,registry,player:_,cfg,clock}=&mut f;physical::buy(&mut l,registry,maker,ticket,cfg,coin::mint_for_testing<USD>(101,sc.ctx()),0,metadata::snapshot_hash(&s),metadata::receipt_hash(&quote),0,fixtures::h(41),clock,sc.ctx())};
    assert!(physical::listing_settlement(&l)==option::some(quote) && physical::listing_snapshot(&l)==s,110);test_scenario::return_shared(l);f.sc.next_tx(@0xc);
    let a:Asset=f.sc.take_from_sender_by_id(id);let next=physical::snapshot(&a);assert_snapshot_format(&next);assert!(metadata::snapshot_holder(&next)==@0xc && metadata::snapshot_epoch(&next)==1 && metadata::snapshot_registration(&next)==metadata::snapshot_registration(&s) && metadata::snapshot_provenance(&next)==metadata::snapshot_provenance(&s),111);physical::deliver(a);f.sc.next_tx(@0xb);end(f)
}
fun terms(part:vector<u8>,mode:u8,price:u64,supply:u64,transferable:bool):Terms {
    let rights=if(part==b"ref")0 else if(part==b"bound")1 else 2;
    material_policy::terms(policy::definition_hash(&fixtures::def(part,rights,10)),fixtures::h(90),mode,if(mode==2)2 else 0,price,supply,transferable)
}
fun setup(mode:u8,price:u64,supply:u64,transferable:bool):F {
    let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let mut maker:Product<USD> = sc.take_shared();let mut cap:Control=sc.take_from_sender();let kind:KindRegistry=sc.take_shared();
    let v=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,1000,@0xd,soulidity_maker_terms::maker_resale::rates(500,500),vector[b"ref",b"bound",b"free"],vector[b"free"],vector[fixtures::def(b"ref",0,10),fixtures::def(b"bound",1,10),fixtures::def(b"free",2,10)],vector[],fixtures::scene()),vector[fixtures::default_output(&kind,false,true,vector[])]);
    catalog::publish(&mut maker,&mut cap,1,catalog::with_physical(v,vector[terms(b"ref",mode,price,supply,transferable),terms(b"bound",mode,price,supply,transferable),terms(b"free",mode,price,supply,transferable)]));test_scenario::return_shared(kind);
    let maker_id=object::id(&maker);let cfg:Config<USD> =sc.take_shared();let registry_id=physical::create_registry_for_testing(&mut maker,&mut cap,2,&cfg,sc.ctx());test_scenario::return_shared(cfg);sc.return_to_sender(cap);test_scenario::return_shared(maker);sc.next_tx(@0xb);
    let mut maker:Product<USD> = sc.take_shared_by_id(maker_id);let cfg:Config<USD> = sc.take_shared();let c=clock::create_for_testing(sc.ctx());let player_id=player::create_for_testing(&mut maker,&cfg,2,0,1000,fixtures::h(29),&c,sc.ctx());test_scenario::return_shared(maker);test_scenario::return_shared(cfg);sc.next_tx(@0xb);
    let maker:Product<USD> = sc.take_shared_by_id(maker_id);let cfg:Config<USD> = sc.take_shared();let mut p:Player=sc.take_from_sender_by_id(player_id);let registry=sc.take_shared_by_id(registry_id);
    player::set_base_for_testing(&mut p,&maker,&cfg,policy::definition_hash(&fixtures::def(b"ref",0,10)),fixtures::layout(),0,0,1000,&c,sc.ctx());
    player::set_base_for_testing(&mut p,&maker,&cfg,policy::definition_hash(&fixtures::def(b"bound",1,10)),fixtures::layout(),1,0,1000,&c,sc.ctx());
    player::set_base_for_testing(&mut p,&maker,&cfg,policy::definition_hash(&fixtures::def(b"free",2,10)),fixtures::layout(),2,0,1000,&c,sc.ctx());
    F{sc,maker,registry,player:p,cfg,clock:c}
}
fun end(f:F){let F{sc,maker,registry,player,cfg,clock}=f;test_scenario::return_shared(maker);test_scenario::return_shared(registry);test_scenario::return_shared(cfg);sc.return_to_sender(player);clock::destroy_for_testing(clock);sc.end();}
fun key(f:&F,part:vector<u8>):vector<u8>{policy::source_hash(player::source(&player::selection(&f.player,part).destroy_some()))}
fun claim(f:&mut F,part:vector<u8>,attempt:u8):Asset {
    let key=key(f,part);let quote=physical::quote(&f.registry,key,&f.cfg,f.sc.sender(),1000);let issued=physical::issued(physical::rule(&f.registry,key));let revision=physical::revision(&f.registry);let player_rev=player::revision(&f.player);
    physical::claim(&mut f.registry,&f.maker,&f.maker,&f.player,part,&f.cfg,player_rev,revision,issued,0,1000,quote,fixtures::h(attempt),&f.clock,f.sc.ctx())
}
fun claim_checked(f:&mut F,player_rev:u64,registry_rev:u64,quoted_actor:address):Asset {
    let k=key(f,b"ref");let q=physical::quote(&f.registry,k,&f.cfg,quoted_actor,1000);
    physical::claim(&mut f.registry,&f.maker,&f.maker,&f.player,b"ref",&f.cfg,player_rev,registry_rev,0,0,1000,q,fixtures::h(31),&f.clock,f.sc.ctx())
}
fun purchase(f:&mut F,part:vector<u8>,attempt:u8,payment:u64):Asset {
    let key=key(f,part);let quote=physical::quote(&f.registry,key,&f.cfg,f.sc.sender(),1000);let issued=physical::issued(physical::rule(&f.registry,key));let revision=physical::revision(&f.registry);let coin=coin::mint_for_testing<USD>(payment,f.sc.ctx());let player_rev=player::revision(&f.player);
    {let F{sc,maker,registry,player,cfg,clock}=f;let fee_revision=economics::revision(cfg);physical::purchase(registry,maker,player,part,cfg,coin,player_rev,revision,issued,fee_revision,1000,quote,fixtures::h(attempt),clock,sc.ctx())}
}
fun mint(f:&mut F):Soul {mint_attempt(f,20)}
fun mint_attempt(f:&mut F,attempt:u8):Soul {
    let mut sys:System=f.sc.take_shared();let mut slots=vector[];let parts=vector[b"ref",b"bound",b"free"];
    parts.do_ref!(|part|{let s=player::selection(&f.player,*part).destroy_some();slots.push_back(output::slot(*part,option::some(output::selection(*player::source(&s),player::layout(&s),option::none()))))});
    let v=catalog::published(&f.maker,2);let policy=catalog::output_policy(v,b"default");let intent=output::intent(object::id(&f.cfg),object::id(&f.maker),2,catalog::policy_hash(v),output::policy_hash(&policy),f.sc.sender(),fixtures::h(attempt),string::utf8(b"OC"),fixtures::recipe(slots),vector::tabulate!(16,|_|attempt));
    let mut b=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&f.cfg),&mut f.maker,&mut f.cfg,intent,b"default",0,1000,coin::zero<USD>(f.sc.ctx()),&f.clock,f.sc.ctx());
    parts.do_ref!(|part|issuer::select_player(&mut b,&mut f.maker,&f.player,*part,3,f.sc.ctx()));
    let root=fixtures::finish(&mut f.sc,b,&mut sys,&f.clock);test_scenario::return_shared(sys);f.sc.next_tx(@0xb);f.sc.take_from_sender_by_id(root)
}
fun materialize(f:&mut F,s:&mut Soul,part:vector<u8>,material_key:vector<u8>,attempt:u8):Asset {
    let key=key(f,part);let quote=physical::quote(&f.registry,key,&f.cfg,f.sc.sender(),1000);let issued=physical::issued(physical::rule(&f.registry,key));let registry_rev=physical::revision(&f.registry);let soul_rev=soul::revision(s);
    physical::materialize(&mut f.registry,&f.maker,&f.maker,s,part,material_key,&f.cfg,soul_rev,registry_rev,issued,0,1000,quote,fixtures::h(attempt),&f.clock,f.sc.ctx())
}
#[test]
fun free_claim_uses_actual_selection_without_consuming_oc_rights() {
    let mut f=setup(0,0,3,true);let k=key(&f,b"ref");let a=claim(&mut f,b"ref",31);let id=object::id(&a);
    assert!(physical::asset_holder(&a)==@0xb && physical::asset_epoch(&a)==0 && physical::asset_serial(&a)==1 && policy::rights(physical::asset_source(&a))==0 && physical::asset_proof(&a).is_none(),0);
    assert!(physical::issued(physical::rule(&f.registry,k))==1 && physical::receipt(&f.registry,@0xb,fixtures::h(31))==option::some(id) && player::revision(&f.player)==3,1);physical::deliver(a);end(f)
}
#[test]
fun paid_base_settlement_conserves_exact_coins_and_registry_counters() {
    let mut f=setup(1,37,3,true);let a=purchase(&mut f,b"bound",31,37);physical::deliver(a);let stats=physical::stats(&f.registry);assert!(physical::gross(&stats)==37 && physical::platform_paid(&stats)==3 && physical::maker_paid(&stats)==34 && physical::pack_paid(&stats)==0,0);
    f.sc.next_tx(@0xd);assert!(soulidity_foundation::revenue::balance(catalog::income(&f.maker))==34 && coin_sum(&f.sc)==0,1);f.sc.next_tx(@0xf);assert!(soulidity_foundation::revenue::balance(economics::income(&f.cfg))==3 && coin_sum(&f.sc)==0,2);f.sc.next_tx(@0xb);end(f)
}
#[test]
fun distinct_paid_attempts_and_coins_can_purchase_multiple_units() {let mut f=setup(1,37,3,true);let a=purchase(&mut f,b"ref",31,37);let b=purchase(&mut f,b"ref",32,37);assert!(object::id(&a)!=object::id(&b) && physical::asset_serial(&b)==2,0);physical::deliver(a);physical::deliver(b);end(f)}
#[test]
fun canonical_soul_proof_records_original_artifact_and_reserves_materialization() {
    let mut f=setup(2,0,3,true);let mut s=mint(&mut f);let artifact=object::id(soul::original_output(&s));let a=materialize(&mut f,&mut s,b"free",b"print-1",31);
    assert!(physical::asset_proof(&a).is_some() && physical::asset_serial(&a)==1 && soul::revision(&s)==1 && output::materialization(soul::original_output(&s),b"print-1").is_some() && object::id(soul::original_output(&s))==artifact,0);physical::deliver(a);f.sc.return_to_sender(s);end(f)
}
#[test]
fun genesis_proof_stays_fixed_across_reservations_layout_and_actual_handover() {
    let mut f=setup(2,0,3,true);let mut s=mint(&mut f);let id=object::id(&s);
    let original=output::original_commitment(soul::original_output(&s));let genesis=soul::genesis_commitment(&s);let manifest=soul::manifest_hash(&s);
    assert!(soul::original_output_commitment(&s)==original,120);
    let a=materialize(&mut f,&mut s,b"free",b"print-free",31);let p=physical::asset_proof(&a).destroy_some();
    assert!(metadata::proof_schema(&p)==2 && metadata::proof_soul(&p)==id && metadata::proof_output_commitment(&p)==original && metadata::proof_soul_commitment(&p)==genesis && metadata::proof_revision(&p)==0,121);
    let b=materialize(&mut f,&mut s,b"bound",b"print-bound",32);let q=physical::asset_proof(&b).destroy_some();
    assert!(metadata::proof_revision(&q)==1 && metadata::proof_source(&q)!=metadata::proof_source(&p) && metadata::proof_output_commitment(&q)==original && metadata::proof_soul_commitment(&q)==genesis,122);
    assert!(soul::manifest_hash(&s)!=manifest && soul::genesis_commitment(&s)==genesis && output::original_commitment(soul::original_output(&s))==original,123);
    physical::deliver(a);physical::deliver(b);
    soul::tune(&mut s,b"free",policy::layout(false,1,false,0,1000000,0,vector[]),2);
    assert!(soul::genesis_commitment(&s)==genesis && soul::original_output_commitment(&s)==original,124);
    soul::reset_layout(&mut s,b"free",3);transfer::public_transfer(s,@0xc);f.sc.next_tx(@0xc);
    let s:Soul=f.sc.take_from_sender_by_id(id);assert!(soul::genesis_commitment(&s)==genesis && soul::original_output_commitment(&s)==original,125);
    soul::handover(s,@0xb,4);f.sc.next_tx(@0xb);let s:Soul=f.sc.take_from_sender_by_id(id);
    assert!(object::id(&s)==id && soul::genesis_commitment(&s)==genesis && soul::original_output_commitment(&s)==original && soul::generation(&s)==1,126);
    f.sc.return_to_sender(s);end(f)
}
#[test]
fun identical_recipe_does_not_alias_two_actual_soul_births() {
    let mut f=setup(2,0,3,true);let mut first=mint_attempt(&mut f,20);let mut second=mint_attempt(&mut f,21);
    let a=soul::original_output(&first);let b=soul::original_output(&second);
    assert!(output::original_recipe_hash(a)==output::original_recipe_hash(b) && output::policy_hash(output::artifact_policy(a))==output::policy_hash(output::artifact_policy(b)),130);
    assert!(object::id(&first)!=object::id(&second) && object::id(a)!=object::id(b) && soul::original_output_commitment(&first)!=soul::original_output_commitment(&second) && soul::genesis_commitment(&first)!=soul::genesis_commitment(&second),131);
    let a=materialize(&mut f,&mut first,b"free",b"same-print-key",31);let b=materialize(&mut f,&mut second,b"free",b"same-print-key",32);
    let p=physical::asset_proof(&a).destroy_some();let q=physical::asset_proof(&b).destroy_some();
    assert!(metadata::proof_recipe(&p)==metadata::proof_recipe(&q) && metadata::proof_soul_commitment(&p)!=metadata::proof_soul_commitment(&q) && metadata::proof_output_commitment(&p)!=metadata::proof_output_commitment(&q),132);
    physical::deliver(a);physical::deliver(b);f.sc.return_to_sender(first);f.sc.return_to_sender(second);end(f)
}
#[test]
fun terminal_consume_retains_supply_and_permanent_receipt() {
    let mut f=setup(0,0,1,false);let k=key(&f,b"ref");let a=claim(&mut f,b"ref",31);let id=object::id(&a);physical::consume(&mut f.registry,a,0,f.sc.ctx());let stats=physical::stats(&f.registry);
    assert!(physical::total_issued(&stats)==1 && physical::total_consumed(&stats)==1 && physical::issued(physical::rule(&f.registry,k))==1 && physical::consumed(physical::rule(&f.registry,k))==1 && physical::receipt(&f.registry,@0xb,fixtures::h(31))==option::some(id),0);end(f)
}
#[test]
fun transfer_and_consume_remain_available_after_source_archives() {
    let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);let id=object::id(&a);let before=physical::asset_provenance(&a);f.sc.next_tx(@0xa);let mut c:Control=f.sc.take_from_sender();catalog::lifecycle(&mut f.maker,&mut c,2,3);f.sc.return_to_sender(c);f.sc.next_tx(@0xb);
    physical::transfer_asset(a,@0xc,0,f.sc.ctx());f.sc.next_tx(@0xc);let a:Asset=f.sc.take_from_sender_by_id(id);assert!(physical::asset_holder(&a)==@0xc && physical::asset_epoch(&a)==1 && physical::asset_provenance(&a)==before,0);physical::consume(&mut f.registry,a,1,f.sc.ctx());f.sc.next_tx(@0xb);end(f)
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_v1::physical)]
fun free_holder_cannot_claim_same_policy_twice(){let mut f=setup(0,0,3,true);physical::deliver(claim(&mut f,b"ref",31));physical::deliver(claim(&mut f,b"ref",32));end(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_v1::physical)]
fun new_payment_coin_cannot_replay_same_attempt(){let mut f=setup(1,37,3,true);physical::deliver(purchase(&mut f,b"ref",31,37));physical::deliver(purchase(&mut f,b"ref",31,37));end(f)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_v1::physical)]
fun consumption_does_not_reset_supply(){let mut f=setup(1,37,1,true);let a=purchase(&mut f,b"ref",31,37);physical::consume(&mut f.registry,a,0,f.sc.ctx());physical::deliver(purchase(&mut f,b"ref",32,37));end(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_v1::physical)]
fun canonical_soul_cannot_repeat_same_style_using_another_key(){let mut f=setup(2,0,3,true);let mut s=mint(&mut f);physical::deliver(materialize(&mut f,&mut s,b"free",b"print-1",31));physical::deliver(materialize(&mut f,&mut s,b"free",b"print-2",32));f.sc.return_to_sender(s);end(f)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_application::output)]
fun materialization_key_is_unique_across_styles_for_one_soul(){let mut f=setup(2,0,3,true);let mut s=mint(&mut f);physical::deliver(materialize(&mut f,&mut s,b"free",b"print-1",31));physical::deliver(materialize(&mut f,&mut s,b"ref",b"print-1",32));f.sc.return_to_sender(s);end(f)}
#[test]
#[expected_failure(abort_code=10,location=soulidity_application::character)]
fun changed_recipe_cannot_use_genesis_materialization_proof(){let mut f=setup(2,0,3,true);let mut s=mint(&mut f);soul::tune(&mut s,b"free",policy::layout(false,1,false,0,1000000,0,vector[]),0);physical::deliver(materialize(&mut f,&mut s,b"free",b"print-1",31));f.sc.return_to_sender(s);end(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_v1::physical)]
fun receipt_free_route_cannot_materialize_proof_policy(){let mut f=setup(2,0,3,true);physical::deliver(claim(&mut f,b"free",31));end(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun paid_issuance_requires_exact_price(){let mut f=setup(1,37,3,true);physical::deliver(purchase(&mut f,b"free",31,38));end(f)}
#[test]
#[expected_failure(abort_code=7,location=soulidity_v1::physical)]
fun nonzero_protocol_fee_cannot_round_to_zero(){let mut f=setup(1,1,3,true);physical::deliver(purchase(&mut f,b"free",31,1));end(f)}
#[test]
#[expected_failure(abort_code=9,location=soulidity_v1::physical)]
fun creator_nontransferable_policy_cannot_be_bypassed(){let mut f=setup(0,0,3,false);let a=claim(&mut f,b"ref",31);physical::transfer_asset(a,@0xc,0,f.sc.ctx());end(f)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_v1::physical)]
fun stale_asset_epoch_cannot_transfer(){let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);physical::transfer_asset(a,@0xc,1,f.sc.ctx());end(f)}
#[test]
#[expected_failure(abort_code=6,location=soulidity_v1::physical)]
fun non_holder_cannot_consume(){let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);f.sc.next_tx(@0xc);physical::consume(&mut f.registry,a,0,f.sc.ctx());f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_player)]
fun stale_player_selection_cannot_claim(){let mut f=setup(0,0,3,true);physical::deliver(claim_checked(&mut f,2,0,@0xb));end(f)}
#[test]
#[expected_failure(abort_code=11,location=soulidity_v1::physical)]
fun quote_from_other_actor_cannot_claim(){let mut f=setup(0,0,3,true);physical::deliver(claim_checked(&mut f,3,0,@0xc));end(f)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_v1::physical)]
fun stale_shared_registry_or_supply_is_rejected(){let mut f=setup(0,0,3,true);physical::deliver(claim_checked(&mut f,3,1,@0xb));end(f)}
#[test]
#[expected_failure(abort_code=8,location=soulidity_maker_manufacturing::maker_catalog)]
fun second_registry_cannot_reset_maker_supply_or_replay(){let mut f=setup(0,0,3,true);f.sc.next_tx(@0xa);let mut c:Control=f.sc.take_from_sender();{let F{sc,maker,cfg,..}=&mut f;physical::create_registry_for_testing(maker,&mut c,2,cfg,sc.ctx());};f.sc.return_to_sender(c);f.sc.next_tx(@0xb);end(f)}
fun listed(): (F,ID,ID) {
    let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);let id=object::id(&a);let listing=physical::list(&f.registry,&f.maker,&f.maker,a,&f.cfg,101,1000,0,0,&f.clock,f.sc.ctx());f.sc.next_tx(@0xb);(f,listing,id)
}
#[test]
fun market_receives_exact_key_only_child_and_settles_then_increments_epoch_once() {
    let(mut f,lid,asset_id)=listed();f.sc.next_tx(@0xc);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let ticket=test_scenario::receiving_ticket_by_id<Asset>(asset_id);let hash=physical::listing_hash(&l);let quote=physical::sale_quote_hash(&l,&f.cfg,f.sc.sender());let pay=coin::mint_for_testing<USD>(101,f.sc.ctx());
    {let F{sc,maker,registry,player:_,cfg,clock}=&mut f;let fee_revision=economics::revision(cfg);physical::buy(&mut l,registry,maker,ticket,cfg,pay,0,hash,quote,0,fixtures::h(41),clock,sc.ctx())};assert!(physical::listing_state(&l)==1 && physical::listing_receipt(&l)==option::some(fixtures::h(41)),0);test_scenario::return_shared(l);f.sc.next_tx(@0xc);
    let a:Asset=f.sc.take_from_sender_by_id(asset_id);assert!(physical::asset_epoch(&a)==1 && physical::asset_holder(&a)==@0xc,1);physical::consume(&mut f.registry,a,1,f.sc.ctx());
    f.sc.next_tx(@0xb);let seller:Coin<USD> = f.sc.take_from_sender();assert!(coin::value(&seller)==89,2);f.sc.return_to_sender(seller);f.sc.next_tx(@0xd);assert!(soulidity_foundation::revenue::balance(catalog::income(&f.maker))==5 && coin_sum(&f.sc)==0,3);f.sc.next_tx(@0xf);assert!(soulidity_foundation::revenue::balance(economics::income(&f.cfg))==2 && coin_sum(&f.sc)==0,4);f.sc.next_tx(@0xb);end(f)
}
#[test]
fun cancellation_returns_same_asset_epoch_while_maker_archived_and_protocol_paused() {
    let(mut f,lid,asset_id)=listed();f.sc.next_tx(@0xa);let mut c:Control=f.sc.take_from_sender();let mut admin:Admin=f.sc.take_from_sender();catalog::lifecycle(&mut f.maker,&mut c,2,3);economics::configure(&mut f.cfg,&mut admin,0,1000,500,0,@0xf,true);f.sc.return_to_sender(c);f.sc.return_to_sender(admin);f.sc.next_tx(@0xb);
    let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let ticket=test_scenario::receiving_ticket_by_id<Asset>(asset_id);physical::cancel(&mut l,ticket,0,f.sc.ctx());test_scenario::return_shared(l);f.sc.next_tx(@0xb);let a:Asset=f.sc.take_from_sender_by_id(asset_id);assert!(physical::asset_epoch(&a)==0 && physical::asset_holder(&a)==@0xb,0);physical::consume(&mut f.registry,a,0,f.sc.ctx());end(f)
}
#[test]
#[expected_failure(abort_code=6,location=soulidity_v1::physical)]
fun non_seller_cannot_cancel_listing(){let(mut f,lid,asset_id)=listed();f.sc.next_tx(@0xc);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let ticket=test_scenario::receiving_ticket_by_id<Asset>(asset_id);physical::cancel(&mut l,ticket,0,f.sc.ctx());test_scenario::return_shared(l);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=11,location=soulidity_v1::physical)]
fun self_purchase_rejected_before_child_receive(){let(mut f,lid,asset_id)=listed();let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let ticket=test_scenario::receiving_ticket_by_id<Asset>(asset_id);let hash=physical::listing_hash(&l);let quote=physical::sale_quote_hash(&l,&f.cfg,f.sc.sender());let coin=coin::mint_for_testing<USD>(101,f.sc.ctx());{let F{sc,maker,registry,player:_,cfg,clock}=&mut f;let fee_revision=economics::revision(cfg);physical::buy(&mut l,registry,maker,ticket,cfg,coin,0,hash,quote,0,fixtures::h(41),clock,sc.ctx())};test_scenario::return_shared(l);end(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_model::material_policy)]
fun receipt_only_proof_mode_is_invalid(){terms(b"free",2,0,3,true);material_policy::terms(fixtures::h(1),fixtures::h(2),2,1,0,3,true);}
#[test]
#[expected_failure(abort_code=1,location=soulidity_model::material_policy)]
fun paid_terms_require_nonzero_price(){terms(b"free",1,0,3,true);}
#[test]
#[expected_failure(abort_code=1,location=soulidity_model::material_policy)]
fun free_terms_cannot_hide_price(){terms(b"free",0,1,3,true);}
#[test]
#[expected_failure(abort_code=1,location=soulidity_model::material_policy)]
fun supply_must_be_bounded(){terms(b"free",0,0,1000000001,true);}
fun control_for(sc:&Scenario,product:ID):Control {
    let ids=sc.ids_for_sender<Control>();let mut result=option::none();
    ids.do_ref!(|id|{let c:Control=sc.take_from_sender_by_id(*id);if(catalog::control_product(&c)==product)result.fill(c) else sc.return_to_sender(c)});result.destroy_some()
}
fun controls_for(sc:&Scenario,maker:ID,pack:ID):(Control,Control) {
    let ids=sc.ids_for_sender<Control>();let mut m=option::none();let mut p=option::none();
    ids.do_ref!(|id|{let c:Control=sc.take_from_sender_by_id(*id);let product=catalog::control_product(&c);if(product==maker)m.fill(c) else if(product==pack)p.fill(c) else sc.return_to_sender(c)});
    (m.destroy_some(),p.destroy_some())
}
fun add_pack(f:&mut F,mode:u8,price:u64,access_mode:u8):Product<USD> {
    f.sc.next_tx(@0xa);let mut maker_cap=control_for(&f.sc,object::id(&f.maker));let id=catalog::create_pack_for_testing(&f.maker,2,&mut maker_cap,&f.cfg,500,f.sc.ctx());f.sc.return_to_sender(maker_cap);f.sc.next_tx(@0xa);
    let mut pack:Product<USD> = f.sc.take_shared_by_id(id);let(mut maker_cap,mut cap)=controls_for(&f.sc,object::id(&f.maker),id);let d=fixtures::pack_def(b"bound",1,20);
    let term=material_policy::terms(policy::definition_hash(&d),fixtures::h(91),mode,if(mode==2)2 else 0,price,3,true);
    let v=catalog::with_pack_key(catalog::version(fixtures::h(3),fixtures::h(4),access_mode,if(access_mode==1)15 else 0,0,0,0,0,1000,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"bound"],vector[],vector[d],vector[],fixtures::scene()),b"pack");catalog::publish(&mut pack,&mut cap,0,catalog::with_physical(v,vector[term]));
    physical::register_pack(&mut f.registry,&f.maker,&mut maker_cap,&pack,&mut cap,1,0,f.sc.ctx());f.sc.return_to_sender(cap);f.sc.return_to_sender(maker_cap);test_scenario::return_shared(pack);f.sc.next_tx(@0xb);f.sc.take_shared_by_id(id)
}
fun select_pack(f:&mut F,pack:&Product<USD>) {
    player::set_pack_for_testing(&mut f.player,&f.maker,pack,&f.cfg,1,policy::definition_hash(&fixtures::pack_def(b"bound",1,20)),fixtures::layout(),3,0,1000,&f.clock,f.sc.ctx())
}
fun pack_purchase(f:&mut F,pack:&mut Product<USD>):Asset {
    let k=key(f,b"bound");let q=physical::quote(&f.registry,k,&f.cfg,@0xb,1000);let coin=coin::mint_for_testing<USD>(37,f.sc.ctx());
    {let F{sc,maker,registry,player,cfg,clock}=f;let fee_revision=economics::revision(cfg);physical::purchase_pack(registry,maker,pack,player,b"bound",cfg,coin,4,1,0,0,1000,q,fixtures::h(31),clock,sc.ctx())}
}
#[test]
fun included_pack_paid_material_is_bound_to_exact_published_source_and_beneficiary() {
    let mut f=setup(0,0,3,true);let mut pack=add_pack(&mut f,1,37,2);select_pack(&mut f,&pack);let a=pack_purchase(&mut f,&mut pack);assert!(policy::source_product(physical::asset_source(&a))==object::id(&pack) && policy::beneficiary(physical::asset_source(&a))==@0xe && policy::maker_version(physical::asset_source(&a))==2,0);physical::deliver(a);
    let stats=physical::stats(&f.registry);assert!(physical::gross(&stats)==37 && physical::platform_paid(&stats)==3 && physical::pack_paid(&stats)==34 && physical::maker_paid(&stats)==0,1);test_scenario::return_shared(pack);
    f.sc.next_tx(@0xe);assert!(fixtures::product_income(&f.sc,policy::source_product(player::source(&player::selection(&f.player,b"bound").destroy_some())))==34 && coin_sum(&f.sc)==0,2);f.sc.next_tx(@0xb);end(f)
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun paid_pack_without_current_holder_access_cannot_be_selected(){let mut f=setup(0,0,3,true);let pack=add_pack(&mut f,1,37,1);select_pack(&mut f,&pack);test_scenario::return_shared(pack);end(f)}
#[test]
fun paid_pack_access_and_material_purchase_are_separate_economic_actions() {
    let mut f=setup(0,0,3,true);let mut pack=add_pack(&mut f,1,37,1);let hash=catalog::policy_hash(catalog::published(&pack,1));let payment=coin::mint_for_testing<USD>(15,f.sc.ctx());{let F{sc,cfg,clock,..}=&mut f;catalog::buy_access_for_testing(&mut pack,cfg,1,hash,0,1000,fixtures::h(30),payment,clock,sc.ctx())};select_pack(&mut f,&pack);physical::deliver(pack_purchase(&mut f,&mut pack));assert!(catalog::access_held(&pack,1,@0xb) && !catalog::access_held(&pack,1,@0xc),0);test_scenario::return_shared(pack);end(f)
}
#[test]
#[expected_failure(abort_code=2,location=soulidity_v1::physical)]
fun duplicate_pack_registration_cannot_reset_supply(){let mut f=setup(0,0,3,true);let pack=add_pack(&mut f,1,37,2);f.sc.next_tx(@0xa);let(mut m,mut c)=controls_for(&f.sc,object::id(&f.maker),object::id(&pack));register_again(&mut f,&pack,&mut m,&mut c);f.sc.return_to_sender(c);f.sc.return_to_sender(m);test_scenario::return_shared(pack);f.sc.next_tx(@0xb);end(f)}
fun register_again(f:&mut F,pack:&Product<USD>,m:&mut Control,c:&mut Control){physical::register_pack(&mut f.registry,&f.maker,m,pack,c,1,1,f.sc.ctx())}
#[test]
fun soul_with_vault_tool_materializes_without_reverse_custody() {
    let mut f=setup(2,0,3,true);let mut s=mint(&mut f);
    let root=object::id(&s);let r=soulidity_standard::soul::revision(&s);
    let tool=vault::install(&mut s,r,f.sc.ctx());let manifest=vault::snapshot(&s);
    let a=materialize(&mut f,&mut s,b"free",b"print-with-tool",31);
    assert!(object::id(&s)==root && object::id(vault::tool(&s))==tool && vault::snapshot(&s)==manifest,0);
    assert!(soul::revision(&s)==1 && physical::total_issued(&physical::stats(&f.registry))==1,1);
    physical::deliver(a);f.sc.return_to_sender(s);end(f)
}
#[test]
fun unrelated_wallet_does_not_hold_soul_or_its_vault_tool(){
    let mut f=setup(2,0,3,true);let mut s=mint(&mut f);let root=object::id(&s);
    let r=soulidity_standard::soul::revision(&s);vault::install(&mut s,r,f.sc.ctx());
    f.sc.return_to_sender(s);f.sc.next_tx(@0xc);
    assert!(f.sc.ids_for_sender<Soul>().is_empty() && f.sc.ids_for_sender<vault::Vault>().is_empty(),0);
    f.sc.next_tx(@0xb);let s:Soul=f.sc.take_from_sender_by_id(root);
    assert!(vault::installed(&s) && vault::root(vault::tool(&s))==root,1);f.sc.return_to_sender(s);end(f)
}
fun mint_pack(f:&mut F,pack:&mut Product<USD>):Soul {
    let mut sys:System=f.sc.take_shared();let mut slots=vector[];let parts=vector[b"ref",b"bound",b"free"];
    parts.do_ref!(|part|{let s=player::selection(&f.player,*part).destroy_some();slots.push_back(output::slot(*part,option::some(output::selection(*player::source(&s),player::layout(&s),option::none()))))});
    let v=catalog::published(&f.maker,2);let policy=catalog::output_policy(v,b"default");let intent=output::intent(object::id(&f.cfg),object::id(&f.maker),2,catalog::policy_hash(v),output::policy_hash(&policy),f.sc.sender(),fixtures::h(20),string::utf8(b"OC"),fixtures::recipe(slots),vector::tabulate!(16,|_|20));
    let mut b=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&f.cfg),&mut f.maker,&mut f.cfg,intent,b"default",0,1000,coin::zero<USD>(f.sc.ctx()),&f.clock,f.sc.ctx());
    let pack_hash=catalog::policy_hash(catalog::published(pack,1));issuer::include_pack_for_testing(&mut b,pack,&f.maker,&mut f.cfg,1,pack_hash,0,1000,coin::zero<USD>(f.sc.ctx()),&f.clock,f.sc.ctx());
    parts.do_ref!(|part|{if(*part==b"bound")issuer::select_player(&mut b,pack,&f.player,*part,4,f.sc.ctx()) else issuer::select_player(&mut b,&mut f.maker,&f.player,*part,4,f.sc.ctx())});
    let root=fixtures::finish(&mut f.sc,b,&mut sys,&f.clock);test_scenario::return_shared(sys);f.sc.next_tx(@0xb);f.sc.take_from_sender_by_id(root)
}
fun materialize_pack(f:&mut F,pack:&Product<USD>,s:&mut Soul):Asset {
    let k=key(f,b"bound");let q=physical::quote(&f.registry,k,&f.cfg,f.sc.sender(),1000);
    physical::materialize(&mut f.registry,&f.maker,pack,s,b"bound",b"pack-print",&f.cfg,0,1,0,0,1000,q,fixtures::h(31),&f.clock,f.sc.ctx())
}
#[test]
fun pack_materialization_requires_actual_complete_and_matches_entire_artifact_proof() {
    let mut f=setup(0,0,3,true);let mut pack=add_pack(&mut f,2,0,2);select_pack(&mut f,&pack);let mut s=mint_pack(&mut f,&mut pack);let a=materialize_pack(&mut f,&pack,&mut s);let p=physical::asset_proof(&a).destroy_some();let artifact=soul::original_output(&s);
    assert!(soulidity_maker_terms::maker_physical_metadata::proof_soul(&p)==object::id(&s) && soulidity_maker_terms::maker_physical_metadata::proof_generation(&p)==soul::generation(&s) && soulidity_maker_terms::maker_physical_metadata::proof_revision(&p)==0 && soulidity_maker_terms::maker_physical_metadata::proof_artifact(&p)==object::id(artifact),0);
    assert!(soulidity_maker_terms::maker_physical_metadata::proof_intent(&p)==output::intent_hash(output::artifact_intent(artifact)) && soulidity_maker_terms::maker_physical_metadata::proof_output_policy(&p)==output::policy_hash(output::artifact_policy(artifact)) && soulidity_maker_terms::maker_physical_metadata::proof_recipe(&p)==fixtures::recipe(soul::semantic_recipe(&s)),1);
    assert!(soulidity_maker_terms::maker_physical_metadata::proof_render(&p)==fixtures::h(60) && soulidity_maker_terms::maker_physical_metadata::proof_receipt(&p)==output::receipt_hash(output::artifact_receipt(artifact)) && soulidity_maker_terms::maker_physical_metadata::proof_source(&p)==policy::source_hash(physical::asset_source(&a)),2);
    assert!(output::materialization(artifact,b"pack-print")==option::some(soulidity_maker_terms::maker_physical_metadata::proof_hash(&p)) && physical::asset_registry(&a)==object::id(&f.registry) && physical::authorization_receipt(&f.registry,physical::asset_authorization(&a))==option::some(object::id(&a)),3);
    let stats=physical::stats(&f.registry);assert!(physical::total_materialized(&stats)==1 && physical::total_free(&stats)==0 && physical::total_paid(&stats)==0 && physical::authorization_count(&f.registry)==1,4);
    physical::deliver(a);f.sc.return_to_sender(s);test_scenario::return_shared(pack);end(f)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_model::material_policy)]
fun zero_material_commitment_cannot_be_published(){material_policy::terms(fixtures::h(1),fixtures::h(0),0,0,0,1,true);}
#[test]
#[expected_failure(abort_code=1,location=soulidity_model::material_policy)]
fun zero_definition_commitment_cannot_be_published(){material_policy::terms(fixtures::h(0),fixtures::h(1),0,0,0,1,true);}
#[test]
#[expected_failure(abort_code=8,location=soulidity_v1::physical)]
fun empty_player_slot_cannot_issue_material(){let mut f=setup(0,0,3,true);player::clear(&mut f.player,b"ref",3,f.sc.ctx());let k=policy::source_hash(&catalog::preview_source(&f.maker,2,policy::definition_hash(&fixtures::def(b"ref",0,10))));let q=physical::quote(&f.registry,k,&f.cfg,@0xb,1000);claim_empty(&mut f,q);end(f)}
fun claim_empty(f:&mut F,q:vector<u8>){physical::deliver(physical::claim(&mut f.registry,&f.maker,&f.maker,&f.player,b"ref",&f.cfg,4,0,0,0,1000,q,fixtures::h(31),&f.clock,f.sc.ctx()))}
#[test]
fun player_can_clear_and_close_after_maker_archives_and_protocol_pauses() {
    let mut f=setup(0,0,3,true);f.sc.next_tx(@0xa);let mut c:Control=f.sc.take_from_sender();let mut admin:Admin=f.sc.take_from_sender();catalog::lifecycle(&mut f.maker,&mut c,2,3);economics::configure(&mut f.cfg,&mut admin,0,1000,500,0,@0xf,true);f.sc.return_to_sender(c);f.sc.return_to_sender(admin);f.sc.next_tx(@0xb);
    player::clear(&mut f.player,b"bound",3,f.sc.ctx());let F{mut sc,maker,registry,player,cfg,clock}=f;player::close(player,4,sc.ctx());test_scenario::return_shared(maker);test_scenario::return_shared(registry);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.end();
}
#[test]
#[expected_failure(abort_code=3,location=sui::transfer)]
fun receiving_child_from_another_listing_cannot_be_purchased() {
    let mut f=setup(1,37,3,true);let a=purchase(&mut f,b"ref",31,37);let b=purchase(&mut f,b"ref",32,37);let wrong=object::id(&b);
    let l=physical::list(&f.registry,&f.maker,&f.maker,a,&f.cfg,101,1000,0,0,&f.clock,f.sc.ctx());physical::list(&f.registry,&f.maker,&f.maker,b,&f.cfg,101,1000,0,0,&f.clock,f.sc.ctx());f.sc.next_tx(@0xc);
    let mut listing:Listing<USD> = f.sc.take_shared_by_id(l);let ticket=test_scenario::receiving_ticket_by_id<Asset>(wrong);let hash=physical::listing_hash(&listing);let quote=physical::sale_quote_hash(&listing,&f.cfg,f.sc.sender());let payment=coin::mint_for_testing<USD>(101,f.sc.ctx());
    {let F{sc,maker,registry,player:_,cfg,clock}=&mut f;let fee_revision=economics::revision(cfg);physical::buy(&mut listing,registry,maker,ticket,cfg,payment,0,hash,quote,0,fixtures::h(41),clock,sc.ctx())};test_scenario::return_shared(listing);f.sc.next_tx(@0xb);end(f)
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_v1::physical)]
fun handover_cannot_reset_canonical_style_materialization_allowance() {
    let mut f=setup(2,0,3,true);let mut s=mint(&mut f);let root=object::id(&s);physical::deliver(materialize(&mut f,&mut s,b"free",b"print-1",31));soul::handover(s,@0xc,1);f.sc.next_tx(@0xc);
    let mut s:Soul=f.sc.take_from_sender_by_id(root);physical::deliver(materialize(&mut f,&mut s,b"free",b"print-2",32));f.sc.return_to_sender(s);f.sc.next_tx(@0xb);end(f)
}

fun change_fees(f:&mut F,paused:bool){f.sc.next_tx(@0xa);let mut a:Admin=f.sc.take_from_sender();economics::configure(&mut f.cfg,&mut a,0,9000,9000,999,@0x9,paused);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);}
fun trade(f:&mut F,lid:ID,asset:ID,amount:u64,expected_quote:Option<vector<u8>>) {
    let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=if(expected_quote.is_some())expected_quote.destroy_some() else physical::sale_quote_hash(&l,&f.cfg,f.sc.sender());let h=physical::listing_hash(&l);let rev=physical::listing_revision(&l);let ticket=test_scenario::receiving_ticket_by_id<Asset>(asset);
    {let F{sc,maker,registry,player:_,cfg,clock}=f;let fee_revision=economics::revision(cfg);physical::buy(&mut l,registry,maker,ticket,cfg,coin::mint_for_testing<USD>(amount,sc.ctx()),rev,h,q,fee_revision,fixtures::h(41),clock,sc.ctx())};test_scenario::return_shared(l)
}
fun coin_sum(sc:&Scenario):u64{let ids=sc.ids_for_sender<Coin<USD>>();let mut amount=0;ids.do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);amount=amount+coin::value(&c);sc.return_to_sender(c)});amount}

#[test]
fun physical_primary_plus_resale_income_is_redeemable_after_control_transfer(){let mut f=setup(1,37,3,true);let a=purchase(&mut f,b"ref",31,37);let asset=object::id(&a);let receipt=physical::payment_receipt(&f.registry,@0xb,fixtures::h(31)).destroy_some();assert!(economics::primary_receipt_revenue(&receipt)==option::some(object::id(&f.maker)),0);let listing=physical::list(&f.registry,&f.maker,&f.maker,a,&f.cfg,101,1000,0,0,&f.clock,f.sc.ctx());f.sc.next_tx(@0xc);trade(&mut f,listing,asset,101,option::none());assert!(soulidity_foundation::revenue::balance(catalog::income(&f.maker))==39 && soulidity_foundation::revenue::revision(catalog::income(&f.maker))==2 && soulidity_foundation::revenue::balance(economics::income(&f.cfg))==5 && soulidity_foundation::revenue::revision(economics::income(&f.cfg))==2,1);f.sc.next_tx(@0xa);let cap:Control=f.sc.take_from_sender();transfer::public_transfer(cap,@0xc);{let F{sc,cfg,..}=&mut f;let mut admin:Admin=sc.take_from_sender();economics::configure(cfg,&mut admin,0,9000,9000,999,@0xe,true);economics::withdraw_income(cfg,&mut admin,2,5,@0x9,fixtures::h(42),sc.ctx());sc.return_to_sender(admin)};f.sc.next_tx(@0xc);{let F{sc,maker,..}=&mut f;let mut cap:Control=sc.take_from_sender();catalog::lifecycle(maker,&mut cap,2,3);catalog::withdraw_income(maker,&mut cap,2,39,@0x9,fixtures::h(43),sc.ctx());sc.return_to_sender(cap)};f.sc.next_tx(@0x9);assert!(coin_sum(&f.sc)==44,2);f.sc.next_tx(@0xa);assert!(coin_sum(&f.sc)==5,3);f.sc.next_tx(@0xb);assert!(coin_sum(&f.sc)==89,4);end(f)}
#[test]
fun physical_sale_receipt_identifies_actual_income_roots(){let(mut f,lid,id)=listed();f.sc.next_tx(@0xc);trade(&mut f,lid,id,101,option::none());f.sc.next_tx(@0xc);let l:Listing<USD> = f.sc.take_shared_by_id(lid);let r=physical::listing_settlement(&l).destroy_some();assert!(physical::sale_receipt_source_revenue(&r)==object::id(&f.maker) && physical::sale_receipt_protocol_revenue(&r)==object::id(&f.cfg),0);assert!(soulidity_foundation::revenue::collected(catalog::income(&f.maker))==5 && soulidity_foundation::revenue::collected(economics::income(&f.cfg))==2,1);test_scenario::return_shared(l);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_v1::physical)]
fun pack_purchase_cannot_credit_pack_for_a_base_source(){let mut f=setup(1,37,3,true);let mut pack=add_pack(&mut f,1,37,2);let k=key(&f,b"ref");let q=physical::quote(&f.registry,k,&f.cfg,@0xb,1000);let issued=physical::issued(physical::rule(&f.registry,k));let revision=physical::revision(&f.registry);let pay=coin::mint_for_testing<USD>(37,f.sc.ctx());{let F{sc,maker,registry,player,cfg,clock}=&mut f;let a=physical::purchase_pack(registry,maker,&mut pack,player,b"ref",cfg,pay,3,revision,issued,0,1000,q,fixtures::h(40),clock,sc.ctx());physical::deliver(a)};test_scenario::return_shared(pack);end(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_v1::physical)]
fun base_purchase_cannot_credit_maker_for_a_pack_source(){let mut f=setup(0,0,3,true);let pack=add_pack(&mut f,1,37,2);select_pack(&mut f,&pack);let k=key(&f,b"bound");let q=physical::quote(&f.registry,k,&f.cfg,@0xb,1000);let issued=physical::issued(physical::rule(&f.registry,k));let revision=physical::revision(&f.registry);let pay=coin::mint_for_testing<USD>(37,f.sc.ctx());{let F{sc,maker,registry,player,cfg,clock}=&mut f;let a=physical::purchase(registry,maker,player,b"bound",cfg,pay,4,revision,issued,0,1000,q,fixtures::h(40),clock,sc.ctx());physical::deliver(a)};test_scenario::return_shared(pack);end(f)}
#[test]
fun physical_receipt_accounts_separate_creator_source_platform_and_seller(){let(mut f,lid,id)=listed();f.sc.next_tx(@0xc);trade(&mut f,lid,id,101,option::none());f.sc.next_tx(@0xc);let l:Listing<USD> = f.sc.take_shared_by_id(lid);let r=physical::listing_settlement(&l).destroy_some();let p=physical::sale_receipt_policy(&r);assert!(physical::sale_creator(&p)==@0xa && physical::sale_source_recipient(&p)==@0xd && physical::sale_platform(&p)==@0xf,0);assert!(physical::sale_receipt_seller(&r)==@0xb && physical::sale_receipt_buyer(&r)==@0xc && physical::sale_receipt_net(&r)==89 && physical::sale_receipt_creator(&r)==5 && physical::sale_receipt_source(&r)==5 && physical::sale_receipt_platform(&r)==2,1);test_scenario::return_shared(l);f.sc.next_tx(@0xa);assert!(coin_sum(&f.sc)==5,2);f.sc.next_tx(@0xd);assert!(soulidity_foundation::revenue::balance(catalog::income(&f.maker))==5 && coin_sum(&f.sc)==0,3);f.sc.next_tx(@0xf);assert!(soulidity_foundation::revenue::balance(economics::income(&f.cfg))==2 && coin_sum(&f.sc)==0,4);f.sc.next_tx(@0xb);assert!(coin_sum(&f.sc)==89,5);end(f)}
#[test]
fun physical_resale_old_policy_survives_current_config_changes(){let(mut f,lid,id)=listed();change_fees(&mut f,false);f.sc.next_tx(@0xc);trade(&mut f,lid,id,101,option::none());f.sc.next_tx(@0xc);let l:Listing<USD> = f.sc.take_shared_by_id(lid);let r=physical::listing_settlement(&l).destroy_some();assert!(physical::sale_receipt_revision(&r)==1 && physical::sale_receipt_net(&r)==89,0);test_scenario::return_shared(l);f.sc.next_tx(@0xf);assert!(soulidity_foundation::revenue::balance(economics::income(&f.cfg))==2 && coin_sum(&f.sc)==0,1);f.sc.next_tx(@0x9);assert!(coin_sum(&f.sc)==0,2);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=11,location=soulidity_v1::physical)]
fun physical_quote_binds_buyer(){let(mut f,lid,id)=listed();let l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=physical::sale_quote_hash(&l,&f.cfg,@0x9);test_scenario::return_shared(l);f.sc.next_tx(@0xc);trade(&mut f,lid,id,101,option::some(q));end(f)}
#[test]
#[expected_failure(abort_code=11,location=soulidity_v1::physical)]
fun physical_old_quote_cannot_be_used_with_fresh_config_revision(){let(mut f,lid,id)=listed();let l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=physical::sale_quote_hash(&l,&f.cfg,@0xc);test_scenario::return_shared(l);change_fees(&mut f,false);f.sc.next_tx(@0xc);trade(&mut f,lid,id,101,option::some(q));end(f)}
#[test]
#[expected_failure(abort_code=7,location=soulidity_v1::physical)]
fun physical_overpayment_rejected(){let(mut f,lid,id)=listed();f.sc.next_tx(@0xc);trade(&mut f,lid,id,102,option::none());end(f)}
#[test]
#[expected_failure(abort_code=7,location=soulidity_v1::physical)]
fun physical_underpayment_rejected(){let(mut f,lid,id)=listed();f.sc.next_tx(@0xc);trade(&mut f,lid,id,100,option::none());end(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun physical_tiny_nonzero_resale_fee_rejected_at_list(){let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);physical::list(&f.registry,&f.maker,&f.maker,a,&f.cfg,39,1000,0,0,&f.clock,f.sc.ctx());end(f)}
#[test]
fun physical_max_gross_conserves_all_four_roles(){let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);let id=object::id(&a);let l=physical::list(&f.registry,&f.maker,&f.maker,a,&f.cfg,18446744073709551615,1000,0,0,&f.clock,f.sc.ctx());f.sc.next_tx(@0xc);trade(&mut f,l,id,18446744073709551615,option::none());f.sc.next_tx(@0xc);let listing:Listing<USD> = f.sc.take_shared_by_id(l);let r=physical::listing_settlement(&listing).destroy_some();assert!((physical::sale_receipt_net(&r) as u128)+(physical::sale_receipt_platform(&r) as u128)+(physical::sale_receipt_creator(&r) as u128)+(physical::sale_receipt_source(&r) as u128)==18446744073709551615,0);test_scenario::return_shared(listing);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=10,location=soulidity_v1::physical)]
fun physical_cannot_settle_sold_asset_again(){let(mut f,lid,id)=listed();f.sc.next_tx(@0xc);trade(&mut f,lid,id,101,option::none());f.sc.next_tx(@0x9);trade(&mut f,lid,id,101,option::none());end(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun physical_pause_blocks_trade_even_with_immutable_policy(){let(mut f,lid,id)=listed();change_fees(&mut f,true);f.sc.next_tx(@0xc);trade(&mut f,lid,id,101,option::none());end(f)}
#[test]
fun primary_physical_uses_published_rate_and_persists_exact_receipt(){let mut f=setup(1,37,3,true);change_fees(&mut f,false);let a=purchase(&mut f,b"ref",31,37);let id=object::id(&a);physical::deliver(a);let r=physical::payment_receipt(&f.registry,@0xb,fixtures::h(31)).destroy_some();assert!(economics::primary_receipt_fee(&r)==3 && economics::primary_receipt_net(&r)==34 && economics::primary_receipt_revision(&r)==1 && economics::primary_policy_revision(&economics::primary_receipt_policy(&r))==0 && physical::receipt(&f.registry,@0xb,fixtures::h(31))==option::some(id),0);f.sc.next_tx(@0xd);assert!(soulidity_foundation::revenue::balance(catalog::income(&f.maker))==34 && coin_sum(&f.sc)==0,1);f.sc.next_tx(@0xf);assert!(soulidity_foundation::revenue::balance(economics::income(&f.cfg))==3 && coin_sum(&f.sc)==0,2);f.sc.next_tx(@0x9);assert!(coin_sum(&f.sc)==0,3);f.sc.next_tx(@0xb);end(f)}
#[test]
fun physical_soul_proof_is_not_a_new_royalty_recipient(){let mut f=setup(2,0,3,true);let mut s=mint(&mut f);let a=materialize(&mut f,&mut s,b"free",b"print-once",31);assert!(soulidity_maker_terms::maker_resale::oc_creator(soul::resale(&s))==@0xb && physical::sale_creator(&physical::asset_sale(&a))==@0xa,0);let proof=physical::asset_proof(&a).destroy_some();let root=object::id(&s);assert!(soulidity_maker_terms::maker_physical_metadata::proof_soul(&proof)==root,1);f.sc.return_to_sender(s);let id=object::id(&a);physical::transfer_asset(a,@0xc,0,f.sc.ctx());f.sc.next_tx(@0xc);let a:Asset=f.sc.take_from_sender_by_id(id);assert!(physical::asset_proof(&a)==option::some(proof),2);let l=physical::list(&f.registry,&f.maker,&f.maker,a,&f.cfg,101,1000,0,1,&f.clock,f.sc.ctx());f.sc.next_tx(@0x9);trade(&mut f,l,id,101,option::none());f.sc.next_tx(@0x9);let a:Asset=f.sc.take_from_sender_by_id(id);assert!(physical::asset_epoch(&a)==2 && physical::asset_proof(&a)==option::some(proof) && physical::sale_creator(&physical::asset_sale(&a))==@0xa,3);f.sc.return_to_sender(a);f.sc.next_tx(@0xc);assert!(coin_sum(&f.sc)==89,4);f.sc.next_tx(@0xb);assert!(coin_sum(&f.sc)==0,5);end(f)}
#[test]
fun pack_physical_sale_keeps_maker_creator_and_its_own_source_income(){let mut f=setup(0,0,3,true);let mut pack=add_pack(&mut f,1,37,2);select_pack(&mut f,&pack);let a=pack_purchase(&mut f,&mut pack);let id=object::id(&a);let pack_id=object::id(&pack);let p=physical::asset_sale(&a);assert!(physical::sale_creator(&p)==@0xa && physical::sale_source_recipient(&p)==@0xe,0);let lid=physical::list(&f.registry,&f.maker,&pack,a,&f.cfg,101,1000,0,0,&f.clock,f.sc.ctx());f.sc.next_tx(@0xc);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=physical::sale_quote_hash(&l,&f.cfg,@0xc);let h=physical::listing_hash(&l);let t=test_scenario::receiving_ticket_by_id<Asset>(id);{let F{sc,maker,registry,player:_,cfg,clock}=&mut f;let fee_revision=economics::revision(cfg);physical::buy_pack(&mut l,registry,maker,&mut pack,t,cfg,coin::mint_for_testing<USD>(101,sc.ctx()),0,h,q,0,fixtures::h(41),clock,sc.ctx())};test_scenario::return_shared(l);test_scenario::return_shared(pack);f.sc.next_tx(@0xe);assert!(fixtures::product_income(&f.sc,pack_id)==39 && coin_sum(&f.sc)==0,1);f.sc.next_tx(@0xa);assert!(coin_sum(&f.sc)==5,2);f.sc.next_tx(@0xf);assert!(soulidity_foundation::revenue::balance(economics::income(&f.cfg))==5 && coin_sum(&f.sc)==0,3);f.sc.next_tx(@0xb);assert!(coin_sum(&f.sc)==89,4);end(f)}
#[test]
fun new_pack_after_config_change_inherits_maker_primary_policy(){let mut f=setup(0,0,3,true);change_fees(&mut f,false);let pack=add_pack(&mut f,1,37,2);let primary=catalog::version_primary(catalog::published(&pack,1));assert!(primary==catalog::primary_policy(&f.maker) && economics::primary_policy_platform(&primary)==@0xf && economics::primary_policy_bps(&primary)==1000 && economics::market_platform(&catalog::market_policy(&pack))==@0x9,0);test_scenario::return_shared(pack);end(f)}

// Foreign producer within a test-only module. It owns no native production marker.
public struct CaptureProducer has drop {}
public struct OwnCarrier has key,store {id:UID}
fun detached(f:&mut F,p:&OwnCarrier):soulidity_application::visual_capture::Capture{
    soulidity_application::visual_capture::new(CaptureProducer{},p,object::id(&f.player),player::revision(&f.player),catalog::assembly_profile(&f.maker,2),player::profiles(&f.player),player::published_profiles(&f.player),player::colors(&f.player),player::semantic_recipe(&f.player),f.sc.ctx())
}
#[test]
fun native_visual_capture_binds_actual_registry_and_keeps_exact_recipe(){
    let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);let c=physical::asset_visual(&a);
    physical::assert_native_capture_for_testing(&f.registry,c);
    assert!(soulidity_application::visual_capture::carrier(c)==object::id(&f.registry) && soulidity_application::visual_capture::subject(c)==object::id(&f.player) && soulidity_application::visual_capture::recipe_hash(c)==player::semantic_recipe_hash(&f.player),0);
    physical::consume(&mut f.registry,a,0,f.sc.ctx());end(f)
}
#[test]
fun detached_capture_preserves_visual_but_is_a_distinct_application_object(){
    let mut f=setup(0,0,3,true);let p=OwnCarrier{id:object::new(f.sc.ctx())};let c=detached(&mut f,&p);let a=claim(&mut f,b"ref",31);let native_capture=physical::asset_visual(&a);
    assert!(soulidity_application::visual_capture::recipe_hash(&c)==soulidity_application::visual_capture::recipe_hash(native_capture) && soulidity_application::visual_capture::render_hash(&c)==soulidity_application::visual_capture::render_hash(native_capture),0);
    assert!(object::id(&c)!=object::id(native_capture) && soulidity_application::visual_capture::commitment(&c)!=soulidity_application::visual_capture::commitment(native_capture),1);
    soulidity_application::visual_capture::destroy(CaptureProducer{},&p,c);transfer::public_transfer(p,@0xb);physical::consume(&mut f.registry,a,0,f.sc.ctx());end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_application::visual_capture)]
fun detached_visual_metadata_cannot_pass_native_issuance_guard(){
    let mut f=setup(0,0,3,true);let p=OwnCarrier{id:object::new(f.sc.ctx())};let c=detached(&mut f,&p);
    physical::assert_native_capture_for_testing(&f.registry,&c);
    soulidity_application::visual_capture::destroy(CaptureProducer{},&p,c);transfer::public_transfer(p,@0xb);end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_application::visual_capture)]
fun same_carrier_type_wrong_instance_cannot_control_capture(){
    let mut f=setup(0,0,3,true);let p=OwnCarrier{id:object::new(f.sc.ctx())};let other=OwnCarrier{id:object::new(f.sc.ctx())};let c=detached(&mut f,&p);
    soulidity_application::visual_capture::assert_controller(CaptureProducer{},&other,&c);
    soulidity_application::visual_capture::destroy(CaptureProducer{},&p,c);transfer::public_transfer(p,@0xb);transfer::public_transfer(other,@0xb);end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_application::visual_capture)]
fun same_type_wrong_carrier_cannot_destroy_capture(){
    let mut f=setup(0,0,3,true);let p=OwnCarrier{id:object::new(f.sc.ctx())};let other=OwnCarrier{id:object::new(f.sc.ctx())};let c=detached(&mut f,&p);
    soulidity_application::visual_capture::destroy(CaptureProducer{},&other,c);transfer::public_transfer(p,@0xb);transfer::public_transfer(other,@0xb);end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_application::visual_capture)]
fun copied_native_snapshot_is_not_a_capture_producer(){
    let mut f=setup(0,0,3,true);let a=claim(&mut f,b"ref",31);let metadata=physical::snapshot(&a);
    let c=soulidity_application::visual_capture::new(metadata,&f.registry,object::id(&f.player),player::revision(&f.player),catalog::assembly_profile(&f.maker,2),player::profiles(&f.player),player::published_profiles(&f.player),player::colors(&f.player),player::semantic_recipe(&f.player),f.sc.ctx());
    transfer::public_transfer(c,@0xb);physical::consume(&mut f.registry,a,0,f.sc.ctx());end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_application::visual_capture)]
fun foreign_producer_cannot_claim_actual_native_registry(){
    let mut f=setup(0,0,3,true);
    let c=soulidity_application::visual_capture::new(CaptureProducer{},&f.registry,object::id(&f.player),player::revision(&f.player),catalog::assembly_profile(&f.maker,2),player::profiles(&f.player),player::published_profiles(&f.player),player::colors(&f.player),player::semantic_recipe(&f.player),f.sc.ctx());
    transfer::public_transfer(c,@0xb);end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_application::visual_capture)]
fun correct_carrier_does_not_make_public_metadata_an_operator(){
    let mut f=setup(0,0,3,true);let p=OwnCarrier{id:object::new(f.sc.ctx())};let c=detached(&mut f,&p);
    soulidity_application::visual_capture::assert_controller(0u64,&p,&c);
    soulidity_application::visual_capture::destroy(CaptureProducer{},&p,c);transfer::public_transfer(p,@0xb);end(f)
}

#[test]
fun registration_records_actual_control_and_actor_without_following_transfers(){
    let mut f=setup(0,0,3,true);let key=key(&f,b"ref");let registration=physical::rule_registration(physical::rule(&f.registry,key));
    f.sc.next_tx(@0xa);let c=control_for(&f.sc,object::id(&f.maker));let cid=object::id(&c);
    assert!(soulidity_maker_terms::maker_physical_metadata::registered_actor(&registration)==@0xa && soulidity_maker_terms::maker_physical_metadata::maker_control(&registration)==cid && soulidity_maker_terms::maker_physical_metadata::source_control(&registration)==cid && soulidity_maker_terms::maker_physical_metadata::registration_revision(&registration)==0,0);
    assert!(soulidity_maker_terms::maker_physical_metadata::registration_transaction(&registration).length()==32,1);transfer::public_transfer(c,@0xb);f.sc.next_tx(@0xb);
    let a=claim(&mut f,b"ref",31);let aid=object::id(&a);let h=physical::asset_rule_hash(&a);assert!(physical::asset_registration(&a)==registration && physical::snapshot_registration(&physical::snapshot(&a))==registration,2);
    let c:Control=f.sc.take_from_sender_by_id(cid);transfer::public_transfer(c,@0xc);physical::transfer_asset(a,@0xc,0,f.sc.ctx());f.sc.next_tx(@0xc);let a:Asset=f.sc.take_from_sender_by_id(aid);let c:Control=f.sc.take_from_sender_by_id(cid);
    assert!(physical::asset_registration(&a)==registration && physical::asset_rule_hash(&a)==h && physical::asset_holder(&a)==@0xc,3);physical::deliver(a);transfer::public_transfer(c,@0xa);f.sc.next_tx(@0xb);end(f)
}
#[test]
fun pack_registration_commits_both_actual_controls_and_registration_revision(){
    let mut f=setup(0,0,3,true);let mut pack=add_pack(&mut f,1,37,2);select_pack(&mut f,&pack);let a=pack_purchase(&mut f,&mut pack);let reg=physical::asset_registration(&a);let rule=physical::rule(&f.registry,policy::source_hash(physical::asset_source(&a)));
    assert!(physical::rule_registration(rule)==reg && physical::asset_rule_hash(&a)==physical::rule_hash(rule),0);f.sc.next_tx(@0xa);let(m,c)=controls_for(&f.sc,object::id(&f.maker),object::id(&pack));
    assert!(soulidity_maker_terms::maker_physical_metadata::registered_actor(&reg)==@0xa && soulidity_maker_terms::maker_physical_metadata::maker_control(&reg)==object::id(&m) && soulidity_maker_terms::maker_physical_metadata::source_control(&reg)==object::id(&c) && object::id(&m)!=object::id(&c),1);
    assert!(soulidity_maker_terms::maker_physical_metadata::registration_revision(&reg)==1 && soulidity_maker_terms::maker_physical_metadata::registration_transaction(&reg).length()==32,2);
    f.sc.return_to_sender(m);f.sc.return_to_sender(c);f.sc.next_tx(@0xb);physical::deliver(a);test_scenario::return_shared(pack);end(f)
}
