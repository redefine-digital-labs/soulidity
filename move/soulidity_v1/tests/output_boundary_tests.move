#[test_only]
module soulidity_v1::output_boundary_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::storage_fixture;
use soulidity_application::character as app;
use soulidity_v1::market;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::output::{Self,Artifact};
use soulidity_maker_publication::output_data::{Intent};
use soulidity_maker_terms::maker_resale as resale;
use soulidity_foundation::economics::{Self,Config,Admin};
public struct ContentOperator has drop {}
public struct Carrier has key,store {id:UID}
fun setup():(Scenario,Soul,Carrier){let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,82,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let p=Carrier{id:object::new(sc.ctx())};(sc,s,p)}
fun end(sc:Scenario,s:Soul,p:Carrier){sc.return_to_sender(s);transfer::public_transfer(p,@0xb);sc.end();}
fun edited(i:&Intent,maker:ID,version:u64,hash:vector<u8>,actor:address,nonce:vector<u8>):Intent{
    output::intent(output::intent_protocol(i),maker,version,hash,output::intent_output_policy(i),actor,output::intent_attempt(i),output::intent_name(i),output::intent_recipe(i),nonce)
}
fun issue<W:drop,P:key>(sc:&mut Scenario,s:&Soul,p:&P,w:W,i:Intent,change:bool):Artifact{
    let creation=output::authorize(w,p,s,&i);
    let i=if(change)edited(&i,output::intent_maker(&i),output::intent_version(&i),output::intent_policy(&i),output::intent_actor(&i),vector::tabulate!(16,|_|99)) else i;
    let a=app::original_output(s);let mut system=fixtures::prepare_storage(sc);let blob=storage_fixture::blob(&mut system,241,false,true,sc.ctx());
    let artifact=output::new(creation,i,*output::artifact_policy(a),output::original_recipe(a),*output::original_scene(a),output::original_colors(a),output::original_profiles(a),app::published_profiles(s),blob,&system,fixtures::h(241),vector[],*output::artifact_receipt(a),sc.ctx());
    storage_fixture::return_system(system);artifact
}
#[test]
fun own_artifact_can_use_copied_metadata_without_authority_over_native_artifact(){
    let(mut sc,s,p)=setup();let native_id=object::id(app::original_output(&s));let mut a=issue(&mut sc,&s,&p,ContentOperator{},*output::artifact_intent(app::original_output(&s)),false);
    assert!(output::root(&a)==object::id(&s) && output::application_parent(&a)==object::id(&p) && object::id(&a)!=native_id,0);
    output::reserve_materialization(ContentOperator{},&mut a,b"card",fixtures::h(241));
    assert!(output::materialization(&a,b"card")==option::some(fixtures::h(241)) && output::materialization(app::original_output(&s),b"card").is_none() && object::id(app::original_output(&s))==native_id,1);
    transfer::public_transfer(a,@0xb);end(sc,s,p)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun native_state_cannot_be_claimed_by_another_application_operator(){
    let(mut sc,s,p)=setup();let state=standard::borrow_module<app::ApplicationWitness,app::ApplicationState>(&s,b"animacraft");
    let a=issue(&mut sc,&s,state,ContentOperator{},*output::artifact_intent(app::original_output(&s)),false);transfer::public_transfer(a,@0xb);end(sc,s,p)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun public_intent_is_not_an_output_operator(){
    let(mut sc,s,p)=setup();let i=*output::artifact_intent(app::original_output(&s));let a=issue(&mut sc,&s,&p,i,i,false);transfer::public_transfer(a,@0xb);end(sc,s,p)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun foreign_artifact_for_same_soul_cannot_replace_native_output(){
    let(mut sc,mut s,p)=setup();let a=issue(&mut sc,&s,&p,ContentOperator{},*output::artifact_intent(app::original_output(&s)),false);app::install_output(soulidity_v1::application_operator::operator(),&mut s,a);end(sc,s,p)
}
#[test,expected_failure(abort_code=2,location=soulidity_application::output)]
fun creation_cannot_be_reused_for_another_intent(){
    let(mut sc,s,p)=setup();let a=issue(&mut sc,&s,&p,ContentOperator{},*output::artifact_intent(app::original_output(&s)),true);transfer::public_transfer(a,@0xb);end(sc,s,p)
}
#[test,expected_failure(abort_code=2,location=soulidity_application::output)]
fun claimed_maker_cannot_replace_actual_root_source(){
    let(mut sc,s,p)=setup();let i=*output::artifact_intent(app::original_output(&s));let i=edited(&i,object::id(&p),output::intent_version(&i),output::intent_policy(&i),output::intent_actor(&i),output::intent_nonce(&i));let a=issue(&mut sc,&s,&p,ContentOperator{},i,false);transfer::public_transfer(a,@0xb);end(sc,s,p)
}
#[test,expected_failure(abort_code=2,location=soulidity_application::output)]
fun claimed_version_cannot_replace_actual_root_version(){
    let(mut sc,s,p)=setup();let i=*output::artifact_intent(app::original_output(&s));let i=edited(&i,output::intent_maker(&i),2,output::intent_policy(&i),output::intent_actor(&i),output::intent_nonce(&i));let a=issue(&mut sc,&s,&p,ContentOperator{},i,false);transfer::public_transfer(a,@0xb);end(sc,s,p)
}
#[test,expected_failure(abort_code=2,location=soulidity_application::output)]
fun claimed_policy_cannot_replace_actual_root_policy(){
    let(mut sc,s,p)=setup();let i=*output::artifact_intent(app::original_output(&s));let i=edited(&i,output::intent_maker(&i),output::intent_version(&i),fixtures::h(99),output::intent_actor(&i),output::intent_nonce(&i));let a=issue(&mut sc,&s,&p,ContentOperator{},i,false);transfer::public_transfer(a,@0xb);end(sc,s,p)
}
#[test,expected_failure(abort_code=2,location=soulidity_application::output)]
fun claimed_actor_cannot_replace_actual_root_creator(){
    let(mut sc,s,p)=setup();let i=*output::artifact_intent(app::original_output(&s));let i=edited(&i,output::intent_maker(&i),output::intent_version(&i),output::intent_policy(&i),@0x9,output::intent_nonce(&i));let a=issue(&mut sc,&s,&p,ContentOperator{},i,false);transfer::public_transfer(a,@0xb);end(sc,s,p)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun raw_output_read_cannot_approve_native_seal_with_foreign_operator(){
    let(mut sc,s,p)=setup();let system=fixtures::prepare_storage(&mut sc);let a=app::original_output(&s);output::assert_read(ContentOperator{},a,output::render_id(output::artifact_intent(a)),&system);storage_fixture::return_system(system);end(sc,s,p)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun creation_does_not_allow_a_different_operator_to_mutate_artifact(){
    let(mut sc,s,p)=setup();let mut a=issue(&mut sc,&s,&p,ContentOperator{},*output::artifact_intent(app::original_output(&s)),false);output::reserve_materialization(1u64,&mut a,b"card",fixtures::h(241));transfer::public_transfer(a,@0xb);end(sc,s,p)
}
fun royalties():(Scenario,Soul,Carrier,Config<USD>){
    let(mut sc,s,p)=setup();sc.next_tx(@0xa);let mut cfg:Config<USD> =sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,1000,250,0,@0xf,false);sc.return_to_sender(admin);sc.next_tx(@0xc);(sc,s,p,cfg)
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::package_roles)]
fun copied_royalty_quote_cannot_supply_actual_market_role(){
    let(mut sc,s,p,mut cfg)=royalties();let r=resale::quote_gross(app::resale(&s),&cfg,101,@0xb);let payment=coin::mint_for_testing<USD>(101,sc.ctx());resale::settle(r,r,&mut cfg,app::resale(&s),r,payment,object::id(&s),fixtures::h(92),sc.ctx());test_scenario::return_shared(cfg);end(sc,s,p)
}
#[test,expected_failure(abort_code=1,location=soulidity_maker_terms::maker_resale)]
fun receipt_from_other_rights_is_rejected_before_any_coin_routing(){
    let(mut sc,s,p,mut cfg)=royalties();let r=resale::quote_gross(app::resale(&s),&cfg,101,@0xb);
    let wrong=resale::snapshot(object::id(&cfg),app::maker(&s),1,resale::policy_hash(app::resale(&s)),@0xa,resale::rates(0,0),sc.ctx());let payment=coin::mint_for_testing<USD>(101,sc.ctx());
    market::settle_for_testing(&mut cfg,&wrong,r,payment,object::id(&s),fixtures::h(92),sc.ctx());test_scenario::return_shared(cfg);end(sc,s,p)
}
