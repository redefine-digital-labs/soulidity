#[test_only]
module soulidity_v1::forms_tests;
use sui::test_scenario::{Self,Scenario};
use soulidity_v1::fixtures;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::character::{Self as character};
use soulidity_application::forms::{Self,Reference,Journal,Witness};
use soulidity_model::policy;
use walrus::system::System;

fun setup():(Scenario,Soul,System){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);
    let s=sc.take_from_sender_by_id(id);let system=sc.take_shared();(sc,s,system)
}
fun end(sc:Scenario,s:Soul,system:System){sc.return_to_sender(s);test_scenario::return_shared(system);sc.end();}
fun save(sc:&mut Scenario,s:&mut Soul,name:vector<u8>,parent:Option<Reference>):Reference{
    let(head,journal)=if(forms::installed(s)){let j=forms::journal(s);(forms::latest(j,name),forms::revision(j))}else(0,0);
    let root=standard::revision(s);let app=character::revision(s);
    forms::save(s,name,parent,head,journal,root,app,sc.ctx())
}
fun activate(sc:&mut Scenario,s:&mut Soul,r:Reference,items:vector<soulidity_model::components::Item>):vector<soulidity_model::components::Item>{
    let journal=forms::revision(forms::journal(s));let root=standard::revision(s);let app=character::revision(s);let recipe=character::recipe_hash(s);
    forms::activate(s,r,items,journal,root,app,recipe,sc.ctx())
}
#[test]
fun append_versions_keeps_identity_original_output_and_immutable_parent(){
    let(mut sc,mut s,sys)=setup();let root=object::id(&s);let origin=standard::origin(&s);
    let free=character::free_id(&character::binding(&s,b"free").destroy_some());
    let output=object::id(character::original_output(&s));let old_recipe=character::semantic_recipe_hash(&s);
    let first=save(&mut sc,&mut s,b"adult",option::none());
    let original=forms::commitment(forms::snapshot(forms::journal(&s),first));
    character::tune(&mut s,b"free",policy::layout(false,1,false,0,1000000,0,vector[]),0);
    let second=save(&mut sc,&mut s,b"adult",option::none());let j=forms::journal(&s);
    assert!(forms::version(&first)==1 && forms::version(&second)==2 && forms::form_count(j)==1 && forms::version_count(j)==2,0);
    assert!(forms::parent(forms::snapshot(j,second))==option::some(first) && forms::commitment(forms::snapshot(j,first))==original,1);
    assert!(forms::recipe(forms::snapshot(j,first))==old_recipe && forms::recipe(forms::snapshot(j,second))!=old_recipe,2);
    assert!(object::id(&s)==root && standard::origin(&s)==origin && object::id(character::original_output(&s))==output,3);
    assert!(character::free_id(&character::binding(&s,b"free").destroy_some())==free && character::bound_count(&s)==1 && character::reference_count(&s)==1,4);
    assert!(forms::source_count(forms::snapshot(j,first))==3 && forms::source_page(forms::snapshot(j,first),0,3).length()==3,5);
    end(sc,s,sys)
}
#[test]
fun activate_historical_version_reuses_actual_free_and_preserves_history(){
    let(mut sc,mut s,sys)=setup();let first=save(&mut sc,&mut s,b"adult",option::none());
    let free=character::free_id(&character::binding(&s,b"free").destroy_some());let hash=character::recipe_hash(&s);
    character::tune(&mut s,b"free",policy::layout(false,1,false,0,1000000,0,vector[]),0);
    let second=save(&mut sc,&mut s,b"adult",option::none());activate(&mut sc,&mut s,first,vector[]).destroy_empty();
    let j=forms::journal(&s);assert!(forms::version_count(j)==2 && forms::revision(j)==3 && forms::latest(j,b"adult")==2,0);
    assert!(forms::active_reference(&forms::active(j).destroy_some())==first && forms::active_is_current(&s),1);
    assert!(character::recipe_hash(&s)==hash && character::free_id(&character::binding(&s,b"free").destroy_some())==free,2);
    let a=forms::transition(j,1);let b=forms::transition(j,2);let c=forms::transition(j,3);
    assert!(forms::transition_previous(&b)==forms::transition_commitment(&a) && forms::transition_previous(&c)==forms::transition_commitment(&b) && forms::history_head(j)==forms::transition_commitment(&c),3);
    assert!(forms::transition_reference(&b)==second && forms::history_page(j,1,3).length()==3,4);
    character::tune(&mut s,b"free",policy::layout(false,2,false,0,1000000,0,vector[]),2);
    assert!(!forms::active_is_current(&s) && forms::active_reference(&forms::active(forms::journal(&s)).destroy_some())==first,5);
    end(sc,s,sys)
}
#[test]
fun supplied_original_wallet_item_restores_bound_and_reference_without_reissuing(){
    let(mut sc,mut s,sys)=setup();let r=save(&mut sc,&mut s,b"dress",option::none());
    let original=character::free_id(&character::binding(&s,b"free").destroy_some()).destroy_some();
    let item=character::detach(&mut s,b"free",0);character::unmount_bound(&mut s,b"bound",1);character::clear_reference(&mut s,b"ref",2);
    activate(&mut sc,&mut s,r,vector[item]).destroy_empty();
    assert!(character::free_id(&character::binding(&s,b"free").destroy_some())==option::some(original),0);
    assert!(character::bound_count(&s)==1 && character::reference_count(&s)==1 && character::binding(&s,b"bound").is_some() && character::binding(&s,b"ref").is_some(),1);
    assert!(forms::active_is_current(&s),2);end(sc,s,sys)
}
#[test]
fun form_branch_and_journal_follow_actual_soul_transfer(){
    let(mut sc,mut s,sys)=setup();let r=save(&mut sc,&mut s,b"child",option::none());let root=object::id(&s);
    transfer::public_transfer(s,@0xc);test_scenario::return_shared(sys);sc.next_tx(@0xc);
    let mut s:Soul=sc.take_from_sender_by_id(root);let sys:System=sc.take_shared();let branch=save(&mut sc,&mut s,b"adult",option::some(r));
    let j=forms::journal(&s);assert!(forms::parent(forms::snapshot(j,branch))==option::some(r),0);
    assert!(forms::creator(forms::snapshot(j,r))==@0xb && forms::creator(forms::snapshot(j,branch))==@0xc && forms::root(j)==root,1);
    activate(&mut sc,&mut s,r,vector[]).destroy_empty();end(sc,s,sys)
}
#[test]
fun journal_records_beyond_32_versions_without_overwriting_old_records(){
    let(mut sc,mut s,sys)=setup();let first=save(&mut sc,&mut s,b"adult",option::none());
    let old=forms::commitment(forms::snapshot(forms::journal(&s),first));let mut i=1;
    while(i < 34){save(&mut sc,&mut s,b"adult",option::none());i=i+1};let j=forms::journal(&s);
    assert!(forms::version_count(j)==34 && forms::latest(j,b"adult")==34 && forms::commitment(forms::snapshot(j,first))==old,0);
    assert!(forms::history_page(j,30,5).length()==5,1);end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_application::character)]
fun form_snapshot_cannot_mint_a_missing_free_item(){
    let(mut sc,mut s,sys)=setup();let r=save(&mut sc,&mut s,b"dress",option::none());
    let item=character::detach(&mut s,b"free",0);transfer::public_transfer(item,@0xc);
    activate(&mut sc,&mut s,r,vector[]).destroy_empty();end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::forms)]
fun stale_standard_revision_rejects_save(){
    let(mut sc,mut s,sys)=setup();let app=character::revision(&s);let root=standard::revision(&s);
    forms::save(&mut s,b"dress",option::none(),0,0,root+1,app,sc.ctx());end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::forms)]
fun stale_journal_revision_rejects_another_version(){
    let(mut sc,mut s,sys)=setup();save(&mut sc,&mut s,b"dress",option::none());let root=standard::revision(&s);
    forms::save(&mut s,b"dress",option::none(),1,0,root,0,sc.ctx());end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::forms)]
fun stale_head_cannot_overwrite_a_form_version(){
    let(mut sc,mut s,sys)=setup();save(&mut sc,&mut s,b"dress",option::none());let root=standard::revision(&s);
    forms::save(&mut s,b"dress",option::none(),0,1,root,0,sc.ctx());end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=2,location=soulidity_application::forms)]
fun nonexistent_parent_does_not_establish_derivation(){
    let(mut sc,mut s,sys)=setup();save(&mut sc,&mut s,b"dress",option::none());
    save(&mut sc,&mut s,b"adult",option::some(forms::reference(b"dress",2)));end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=2,location=soulidity_application::forms)]
fun previous_version_cannot_claim_an_unrelated_parent(){
    let(mut sc,mut s,sys)=setup();save(&mut sc,&mut s,b"dress",option::none());let branch=save(&mut sc,&mut s,b"adult",option::none());
    save(&mut sc,&mut s,b"dress",option::some(branch));end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=8,location=soulidity_standard::soul)]
fun history_extension_cannot_be_detached_or_rebound(){
    let(mut sc,mut s,sys)=setup();save(&mut sc,&mut s,b"dress",option::none());let root=standard::revision(&s);
    let j=standard::uninstall<Witness,Journal>(&mut s,b"forms",root);transfer::public_transfer(j,@0xb);end(sc,s,sys)
}
