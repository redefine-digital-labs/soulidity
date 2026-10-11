#[test_only]
module soulidity_v1::vault_edit_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use walrus::system::System;
use soulidity_v1::fixtures;
use soulidity_application::vault;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::character;
use soulidity_application::forms;
use soulidity_application::growth;
use soulidity_model::policy;
public struct GrowthProducer has drop {}
public struct Source has key,store {id:UID}
fun hash():vector<u8>{std::hash::sha3_256(b"vault-experience")}
fun setup():(Scenario,Soul,System){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);
    let mut s:Soul=sc.take_from_sender_by_id(root);let r=standard::revision(&s);vault::install(&mut s,r,sc.ctx());
    let sys=sc.take_shared();(sc,s,sys)
}
fun end(sc:Scenario,s:Soul,sys:System){sc.return_to_sender(s);test_scenario::return_shared(sys);sc.end();}
fun save(sc:&mut Scenario,s:&mut Soul,name:vector<u8>,head:u64):forms::Reference{
    let journal=if(forms::installed(s))forms::revision(forms::journal(s)) else 0;
    let root=standard::revision(s);let app=character::revision(s);forms::save(s,name,option::none(),head,journal,root,app,sc.ctx())
}
fun activate(sc:&mut Scenario,s:&mut Soul,r:forms::Reference,items:vector<soulidity_model::components::Item>):vector<soulidity_model::components::Item>{
    let j=forms::revision(forms::journal(s));let root=standard::revision(s);let app=character::revision(s);let recipe=character::recipe_hash(s);forms::activate(s,r,items,j,root,app,recipe,sc.ctx())
}
#[test]
fun forms_and_wallet_free_restore_on_same_owned_soul_with_tool(){
    let(mut sc,mut s,sys)=setup();let original=object::id(&s);let tool=vault::snapshot(&s);
    let free=character::free_id(&character::binding(&s,b"free").destroy_some());let output=object::id(character::original_output(&s));
    let origin=standard::origin(&s);let first=save(&mut sc,&mut s,b"original",0);
    let frozen=forms::commitment(forms::snapshot(forms::journal(&s),first));
    let app=character::revision(&s);character::tune(&mut s,b"free",policy::layout(false,1,false,0,1000000,0,vector[]),app);
    save(&mut sc,&mut s,b"original",1);let app=character::revision(&s);let it=character::detach(&mut s,b"free",app);
    let app=character::revision(&s);character::unmount_bound(&mut s,b"bound",app);
    let app=character::revision(&s);character::clear_reference(&mut s,b"ref",app);
    activate(&mut sc,&mut s,first,vector[it]).destroy_empty();
    assert!(forms::active_is_current(&s) && forms::version_count(forms::journal(&s))==2,0);
    assert!(forms::commitment(forms::snapshot(forms::journal(&s),first))==frozen,1);
    assert!(standard::origin(&s)==origin && character::free_id(&character::binding(&s,b"free").destroy_some())==free && object::id(character::original_output(&s))==output,2);
    assert!(object::id(&s)==original && vault::snapshot(&s)==tool,3);end(sc,s,sys)
}
#[test]
fun growth_accept_revoke_and_reset_use_current_owner_and_preserve_history(){
    let(mut sc,mut s,sys)=setup();let tool=vault::snapshot(&s);let p=Source{id:object::new(sc.ctx())};let c=clock::create_for_testing(sc.ctx());
    let root=standard::revision(&s);growth::authorize<GrowthProducer,Source>(&mut s,&p,hash(),1,1,1000,0,0,root,&c,sc.ctx());
    let r=growth::issue(GrowthProducer{},&p,object::id(&s),hash(),1,0,1,b"run",b"event",1,1,0,1000,hash(),hash(),&c);
    let root=standard::revision(&s);growth::accept(&mut s,r,1,root,&c,sc.ctx());let frozen=growth::history_head(growth::journal(&s));
    let root=standard::revision(&s);growth::revoke<GrowthProducer,Source>(&mut s,&p,hash(),1,2,root,&c,sc.ctx());
    let root=standard::revision(&s);growth::reset_sources(&mut s,3,root,&c,sc.ctx());
    assert!(growth::accepted_count(growth::journal(&s))==1 && growth::generation(growth::journal(&s))==1,0);
    let row=growth::history(growth::journal(&s),2);assert!(growth::change_hash(&row)==frozen && growth::accepted_actor(&growth::change_accepted(&row).destroy_some())==@0xb,1);
    assert!(vault::snapshot(&s)==tool,2);clock::destroy_for_testing(c);transfer::public_transfer(p,@0xb);end(sc,s,sys)
}
#[test]
fun new_owner_continues_same_form_journal_and_vault_tool(){
    let(mut sc,mut s,sys)=setup();let root=object::id(&s);let tool=vault::snapshot(&s);save(&mut sc,&mut s,b"original",0);
    transfer::public_transfer(s,@0xc);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(root);let r=save(&mut sc,&mut s,b"original",1);
    assert!(forms::creator(forms::snapshot(forms::journal(&s),r))==@0xc && forms::version_count(forms::journal(&s))==2,0);
    assert!(object::id(&s)==root && vault::snapshot(&s)==tool,1);end(sc,s,sys)
}
#[test,expected_failure(abort_code=1,location=soulidity_application::vault)]
fun stale_tool_update_is_rejected(){let(sc,mut s,sys)=setup();let r=standard::revision(&s);vault::rotate_private_scope(&mut s,1,r);end(sc,s,sys)}
#[test,expected_failure(abort_code=1,location=soulidity_application::vault)]
fun stale_standard_update_is_rejected(){let(sc,mut s,sys)=setup();let r=standard::revision(&s);vault::rotate_private_scope(&mut s,0,r+1);end(sc,s,sys)}
#[test,expected_failure(abort_code=4,location=sui::test_scenario)]
fun copied_snapshot_is_insufficient_after_actual_root_owner_changes(){
    let(mut sc,s,sys)=setup();let snapshot=vault::snapshot(&s);let root=object::id(&s);transfer::public_transfer(s,@0xc);sc.next_tx(@0xb);
    assert!(vault::snapshot_root(&snapshot)==root,0);let s:Soul=sc.take_from_sender_by_id(root);end(sc,s,sys)
}
#[test,expected_failure(abort_code=8,location=soulidity_standard::soul)]
fun permanent_tool_cannot_be_removed_as_a_root_loan(){
    let(sc,mut s,sys)=setup();let r=standard::revision(&s);let tool=standard::uninstall<vault::ContentOperator,vault::Vault>(&mut s,b"vault",r);transfer::public_transfer(tool,@0xb);end(sc,s,sys)
}
#[test,expected_failure(abort_code=1,location=soulidity_application::vault)]
fun changing_tool_generation_rejects_old_root_obligation(){
    let(sc,mut s,sys)=setup();let r=standard::revision(&s);vault::rotate_private_scope(&mut s,0,r);vault::rotate_private_scope(&mut s,0,r);end(sc,s,sys)
}
#[test]
fun another_soul_never_substitutes_original_tool_and_history(){
    let(mut sc,first,sys)=setup();let first_root=object::id(&first);let first_tool=vault::snapshot(&first);sc.return_to_sender(first);test_scenario::return_shared(sys);
    sc.next_tx(@0xb);let other=fixtures::mint(&mut sc,21,0);sc.next_tx(@0xb);let mut second:Soul=sc.take_from_sender_by_id(other);
    let r=standard::revision(&second);vault::install(&mut second,r,sc.ctx());let second_tool=vault::snapshot(&second);
    let first:Soul=sc.take_from_sender_by_id(first_root);assert!(vault::snapshot(&first)==first_tool && vault::snapshot_root(&second_tool)==other && vault::snapshot_tool(&second_tool)!=vault::snapshot_tool(&first_tool),0);
    sc.return_to_sender(first);let sys=sc.take_shared();end(sc,second,sys)
}
