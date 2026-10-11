#[test_only]
module soulidity_v1::authorization_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_content::authorization;
use soulidity_application::vault;
use soulidity_v1::application_operator;
use walrus::system::System;
fun setup():(Scenario,Soul,Clock) {
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let s=sc.take_from_sender_by_id(root);let clock=clock::create_for_testing(sc.ctx());(sc,s,clock)
}
fun end(sc:Scenario,s:Soul,clock:Clock){sc.return_to_sender(s);clock::destroy_for_testing(clock);sc.end();}
fun issue(sc:&mut Scenario,s:&mut Soul,c:&Clock,grantee:address,scope:u64,expiry:Option<u64>):u64 {
    let revision=soul::revision(s);let slot=soul::grant_hash(s,grantee);soul::grant(s,grantee,scope,expiry,revision,slot,c,sc.ctx())
}
#[test]
fun permanent_grant_and_supersede_keep_one_slot_with_unique_sequence() {
    let(mut sc,mut s,mut c)=setup();assert!(soul::grant_capacity(&s)==1 && soul::grant_count(&s)==0,0);let first=issue(&mut sc,&mut s,&c,@0x8,2,option::none());let old=soul::grant_hash(&s,@0x8).destroy_some();clock::increment_for_testing(&mut c,1000000);
    assert!(soul::grant_live(&mut s,@0x8,&c,sc.ctx()),1);let second=issue(&mut sc,&mut s,&c,@0x8,6,option::none());let g=soul::grant_record(&s,@0x8).destroy_some();assert!(first==0 && second==1 && authorization::scope(&g)==6 && authorization::expiry(&g).is_none() && authorization::root(&g)==object::id(&s) && soul::grant_count(&s)==1 && old!=authorization::hash(&g),2);end(sc,s,c)
}
#[test]
fun partial_revoke_preserves_expiry_and_retained_scopes() {
    let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,15,option::some(1000));let old=soul::grant_hash(&s,@0x8).destroy_some();soul::revoke_grant_scope(&mut s,@0x8,2,1,old,&c,sc.ctx());let g=soul::grant_record(&s,@0x8).destroy_some();assert!(authorization::scope(&g)==13 && authorization::expiry(&g)==option::some(1000) && authorization::sequence(&g)==1 && soul::grant_count(&s)==1,0);end(sc,s,c)
}
#[test]
fun cleanup_removes_expired_but_preserves_live_and_missing_targets() {
    let(mut sc,mut s,mut c)=setup();soul::set_grant_capacity(&mut s,3,1,0);issue(&mut sc,&mut s,&c,@0x8,2,option::some(1000));issue(&mut sc,&mut s,&c,@0x9,4,option::none());let expired=soul::grant_hash(&s,@0x8);let live=soul::grant_hash(&s,@0x9);clock::increment_for_testing(&mut c,1000);
    let removed=soul::cleanup_grants(&mut s,vector[authorization::cleanup_target(@0x8,expired),authorization::cleanup_target(@0x9,live),authorization::cleanup_target(@0x10,option::none())],3,&c,sc.ctx());assert!(removed==1 && soul::grant_count(&s)==1 && soul::grant_hash(&s,@0x8).is_none() && soul::grant_hash(&s,@0x9)==live && soul::revision(&s)==4,0);
    soul::set_grant_capacity(&mut s,1,3,4);end(sc,s,c)
}
#[test]
fun cleanup_noop_does_not_advance_soul_revision() {let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());let snapshot=soul::grant_hash(&s,@0x8);assert!(soul::cleanup_grants(&mut s,vector[authorization::cleanup_target(@0x8,snapshot)],1,&c,sc.ctx())==0 && soul::revision(&s)==1,0);end(sc,s,c)}
#[test]
fun expired_slot_can_be_replaced_at_full_capacity() {let(mut sc,mut s,mut c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::some(1000));clock::increment_for_testing(&mut c,1000);assert!(!soul::grant_live(&mut s,@0x8,&c,sc.ctx()),0);issue(&mut sc,&mut s,&c,@0x8,8,option::none());assert!(soul::grant_count(&s)==1 && soul::grant_live(&mut s,@0x8,&c,sc.ctx()),1);end(sc,s,c)}
#[test]
fun exact_snapshot_and_append_scope_guard_accept_widening() {let(mut sc,mut s,c)=setup();soul::assert_grant_snapshot(&mut s,0,1,0,@0x8,option::none(),false,&c,sc.ctx());issue(&mut sc,&mut s,&c,@0x8,2,option::none());let hash=soul::grant_hash(&s,@0x8);soul::assert_grant_snapshot(&mut s,0,1,1,@0x8,hash,true,&c,sc.ctx());soul::assert_preserves_grant_scopes(&mut s,@0x8,6,&c,sc.ctx());issue(&mut sc,&mut s,&c,@0x8,6,option::none());end(sc,s,c)}
#[test]
fun capacity_zero_disables_then_owner_can_enable_again() {let(mut sc,mut s,c)=setup();soul::set_grant_capacity(&mut s,0,1,0);soul::set_grant_capacity(&mut s,10000,0,1);issue(&mut sc,&mut s,&c,@0x8,2,option::none());let h=soul::grant_hash(&s,@0x8).destroy_some();soul::revoke(&mut s,@0x8,3,h);assert!(soul::grant_count(&s)==0 && soul::grant_capacity(&s)==10000,0);end(sc,s,c)}
#[test]
fun clear_generation_keeps_stale_row_inactive_and_cleanup_does_not_underflow() {let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());let h=soul::grant_hash(&s,@0x8);soul::clear_authorizations(&mut s);assert!(soul::grant_count(&s)==0 && soul::generation(&s)==1 && !soul::grant_live(&mut s,@0x8,&c,sc.ctx()),0);assert!(soul::cleanup_grants(&mut s,vector[authorization::cleanup_target(@0x8,h)],2,&c,sc.ctx())==1 && soul::grant_count(&s)==0,1);issue(&mut sc,&mut s,&c,@0x9,4,option::none());end(sc,s,c)}
#[test]
fun stale_generation_row_can_be_replaced_without_using_capacity() {let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());soul::clear_authorizations(&mut s);issue(&mut sc,&mut s,&c,@0x8,8,option::none());assert!(soul::grant_count(&s)==1 && authorization::grant_generation(&soul::grant_record(&s,@0x8).destroy_some())==1,0);end(sc,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_content::authorization)]
fun second_grantee_exceeds_default_capacity(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());issue(&mut sc,&mut s,&c,@0x9,2,option::none());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_content::authorization)]
fun disabled_capacity_rejects_grant(){let(mut sc,mut s,c)=setup();soul::set_grant_capacity(&mut s,0,1,0);issue(&mut sc,&mut s,&c,@0x8,2,option::none());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_content::authorization)]
fun capacity_above_max_rejected(){let(sc,mut s,c)=setup();soul::set_grant_capacity(&mut s,10001,1,0);end(sc,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_content::authorization)]
fun capacity_below_current_count_rejected(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());soul::set_grant_capacity(&mut s,0,1,1);end(sc,s,c)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::authorization)]
fun stale_capacity_snapshot_rejected(){let(sc,mut s,c)=setup();soul::set_grant_capacity(&mut s,2,0,0);end(sc,s,c)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_content::authorization)]
fun owner_cannot_delegate_to_self(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0xb,2,option::none());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_content::authorization)]
fun zero_grantee_rejected(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x0,2,option::none());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content::authorization)]
fun zero_scope_rejected(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,0,option::none());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content::authorization)]
fun unsupported_scope_bit_rejected(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,16,option::none());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_content::authorization)]
fun expired_at_exact_issue_deadline_rejected(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::some(0));end(sc,s,c)}
#[test]
#[expected_failure(abort_code=7,location=soulidity_content::authorization)]
fun partial_revoke_cannot_remove_all_scopes(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());let h=soul::grant_hash(&s,@0x8).destroy_some();soul::revoke_grant_scope(&mut s,@0x8,2,1,h,&c,sc.ctx());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=6,location=soulidity_content::authorization)]
fun partial_revoke_requires_live_grant(){let(mut sc,mut s,mut c)=setup();issue(&mut sc,&mut s,&c,@0x8,6,option::some(1000));let h=soul::grant_hash(&s,@0x8).destroy_some();clock::increment_for_testing(&mut c,1000);soul::revoke_grant_scope(&mut s,@0x8,2,1,h,&c,sc.ctx());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::authorization)]
fun replacing_row_requires_exact_physical_snapshot(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());soul::grant(&mut s,@0x8,4,option::none(),1,option::none(),&c,sc.ctx());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::authorization)]
fun superseded_snapshot_cannot_revoke_new_grant(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());let old=soul::grant_hash(&s,@0x8).destroy_some();issue(&mut sc,&mut s,&c,@0x8,2,option::none());soul::revoke(&mut s,@0x8,2,old);end(sc,s,c)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::authorization)]
fun stale_cleanup_cannot_delete_newly_reissued_row(){let(mut sc,mut s,mut c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::some(1000));let old=soul::grant_hash(&s,@0x8);clock::increment_for_testing(&mut c,1000);issue(&mut sc,&mut s,&c,@0x8,2,option::none());soul::cleanup_grants(&mut s,vector[authorization::cleanup_target(@0x8,old)],2,&c,sc.ctx());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=8,location=soulidity_content::authorization)]
fun duplicate_cleanup_targets_rejected(){let(mut sc,mut s,mut c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::some(1000));let t=authorization::cleanup_target(@0x8,soul::grant_hash(&s,@0x8));clock::increment_for_testing(&mut c,1000);soul::cleanup_grants(&mut s,vector[t,t],1,&c,sc.ctx());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::authorization)]
fun snapshot_cannot_treat_expired_physical_row_as_absent(){let(mut sc,mut s,mut c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::some(1000));clock::increment_for_testing(&mut c,1000);soul::assert_grant_snapshot(&mut s,0,1,1,@0x8,option::none(),false,&c,sc.ctx());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::authorization)]
fun append_guard_cannot_narrow_current_live_scope(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,6,option::none());soul::assert_preserves_grant_scopes(&mut s,@0x8,2,&c,sc.ctx());end(sc,s,c)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_root_revision_rejected_before_issuing(){let(mut sc,mut s,c)=setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());let hash=soul::grant_hash(&s,@0x8);soul::grant(&mut s,@0x8,4,option::none(),0,hash,&c,sc.ctx());end(sc,s,c)}
fun tool_setup():(Scenario,Soul,System,Clock,vector<u8>){
    let(mut sc,mut s,c)=setup();let id=soul::seal_id(&s,1);let r=soulidity_standard::soul::revision(&s);
    vault::install(&mut s,r,sc.ctx());let system=sc.take_shared();(sc,s,system,c,id)
}
fun tool_end(sc:Scenario,s:Soul,system:System,c:Clock){sc.return_to_sender(s);test_scenario::return_shared(system);clock::destroy_for_testing(c);sc.end();}
/// These supplied-root tests evaluate actual Application policy primitives.
/// They do not establish independent delegate input/Seal authentication; that
/// product adapter remains deferred to AgentPass. No shared reverse Vault exists.
#[test]
fun permanent_delegate_policy_retains_memory_after_partial_revoke(){
    let(mut sc,mut s,system,mut c,id)=tool_setup();let tool=vault::snapshot(&s);
    issue(&mut sc,&mut s,&c,@0x8,6,option::none());let h=soul::grant_hash(&s,@0x8).destroy_some();
    soul::revoke_grant_scope(&mut s,@0x8,4,1,h,&c,sc.ctx());clock::increment_for_testing(&mut c,1000000);
    soul::assert_delegate(application_operator::operator(),&s,@0xb,@0x8,2,&c);
    soul::assert_content_read(application_operator::operator(),id,&s,1,&system,2);
    assert!(soul::grant_live(&mut s,@0x8,&c,sc.ctx()) && soul::grant_count(&s)==1 && vault::snapshot(&s)==tool,0);
    tool_end(sc,s,system,c)
}
#[test,expected_failure(abort_code=9,location=soulidity_application::character)]
fun revoked_memory_policy_rejects_other_retained_scopes(){
    let(mut sc,mut s,system,c,_id)=tool_setup();issue(&mut sc,&mut s,&c,@0x8,6,option::none());let h=soul::grant_hash(&s,@0x8).destroy_some();
    soul::revoke_grant_scope(&mut s,@0x8,2,1,h,&c,sc.ctx());
    soul::assert_delegate(application_operator::operator(),&s,@0xb,@0x8,2,&c);tool_end(sc,s,system,c)
}
#[test,expected_failure(abort_code=4,location=sui::test_scenario)]
fun delegate_cannot_supply_owner_soul_to_issue_own_authority(){
    let(mut sc,s,system,c,_id)=tool_setup();let root=object::id(&s);sc.return_to_sender(s);sc.next_tx(@0x8);
    let mut s:Soul=sc.take_from_sender_by_id(root);issue(&mut sc,&mut s,&c,@0x9,15,option::none());tool_end(sc,s,system,c)
}
#[test]
fun capacity_cleanup_and_snapshot_use_actual_soul_versions(){
    let(mut sc,mut s,system,mut c,_id)=tool_setup();let tool=vault::snapshot(&s);let start=soulidity_standard::soul::revision(&s);
    soul::set_grant_capacity(&mut s,2,1,0);issue(&mut sc,&mut s,&c,@0x8,2,option::some(1000));let h=soul::grant_hash(&s,@0x8);
    soul::assert_grant_snapshot(&mut s,0,2,1,@0x8,h,true,&c,sc.ctx());clock::increment_for_testing(&mut c,1000);
    assert!(soul::cleanup_grants(&mut s,vector[authorization::cleanup_target(@0x8,h)],2,&c,sc.ctx())==1,0);
    assert!(soul::revision(&s)==3 && soulidity_standard::soul::revision(&s)==start+3 && soul::grant_count(&s)==0 && vault::snapshot(&s)==tool,1);tool_end(sc,s,system,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_application_revision_cannot_replace_tool_soul_authorization(){
    let(mut sc,mut s,system,c,_id)=tool_setup();issue(&mut sc,&mut s,&c,@0x8,2,option::none());let h=soul::grant_hash(&s,@0x8);
    soul::grant(&mut s,@0x8,4,option::none(),0,h,&c,sc.ctx());tool_end(sc,s,system,c)
}
#[test]
fun public_transfer_new_holder_cleans_old_issuer_and_can_reauthorize() {
    let(mut sc,mut s,c)=setup();let root=object::id(&s);issue(&mut sc,&mut s,&c,@0x8,2,option::none());let old=soul::grant_hash(&s,@0x8);transfer::public_transfer(s,@0xc);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(root);assert!(!soul::grant_live(&mut s,@0x8,&c,sc.ctx()) && soul::generation(&s)==0,0);
    assert!(soul::cleanup_grants(&mut s,vector[authorization::cleanup_target(@0x8,old)],1,&c,sc.ctx())==1,1);issue(&mut sc,&mut s,&c,@0x8,2,option::none());assert!(authorization::issuer(&soul::grant_record(&s,@0x8).destroy_some())==@0xc && soul::grant_count(&s)==1,2);end(sc,s,c)
}
#[test]
fun foreign_soul_grant_hash_is_not_a_valid_replacement_snapshot() {
    let(mut sc,mut first,c)=setup();issue(&mut sc,&mut first,&c,@0x8,2,option::none());let first_hash=soul::grant_hash(&first,@0x8);sc.return_to_sender(first);sc.next_tx(@0xb);let root=fixtures::mint(&mut sc,21,0);sc.next_tx(@0xb);let mut second:Soul=sc.take_from_sender_by_id(root);issue(&mut sc,&mut second,&c,@0x8,2,option::none());assert!(soul::grant_hash(&second,@0x8)!=first_hash,0);end(sc,second,c)
}
#[test]
#[expected_failure(abort_code=8,location=soulidity_content::authorization)]
fun oversized_cleanup_batch_rejected_before_mutation(){let(mut sc,mut s,c)=setup();let targets=vector::tabulate!(257,|_|authorization::cleanup_target(@0x8,option::none()));soul::cleanup_grants(&mut s,targets,0,&c,sc.ctx());end(sc,s,c)}
