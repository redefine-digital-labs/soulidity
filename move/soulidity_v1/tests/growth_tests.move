#[test_only]
module soulidity_v1::growth_tests;
use std::string;
use sui::clock::{Self,Clock};
use sui::test_scenario::{Self,Scenario};
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::growth::{Self,Receipt};
public struct SoulProducer has drop {}
public struct GrowthProducer has drop {}
public struct WrongProducer has drop {}
public struct Source has key,store {id:UID}
fun hash():vector<u8>{std::hash::sha3_256(b"rules")}
fun setup():(Scenario,Source,Soul,Clock){
    let mut sc=test_scenario::begin(@0xb);let source=Source{id:object::new(sc.ctx())};
    let s=standard::creation_raw_for_testing(standard::new(SoulProducer{},&source,1,hash(),string::utf8(b"OC"),sc.ctx()));
    let clock=clock::create_for_testing(sc.ctx());(sc,source,s,clock)
}
fun end(sc:Scenario,source:Source,s:Soul,clock:Clock){
    transfer::public_transfer(source,@0xb);transfer::public_transfer(s,@0xb);clock::destroy_for_testing(clock);sc.end();
}
fun auth(sc:&mut Scenario,s:&mut Soul,p:&Source,c:&Clock,expected:u64){
    let journal=if(growth::installed(s))growth::revision(growth::journal(s)) else 0;let root=standard::revision(s);
    growth::authorize<GrowthProducer,Source>(s,p,hash(),1,1,1000,expected,journal,root,c,sc.ctx())
}
fun receipt(s:&Soul,p:&Source,c:&Clock,event:vector<u8>,seq:u64):Receipt{
    let j=growth::journal(s);let policy=growth::policy<GrowthProducer,Source>(j,p,hash()).destroy_some();
    growth::issue(GrowthProducer{},p,object::id(s),hash(),1,growth::generation(j),growth::policy_revision(&policy),b"life-instance",event,seq,1,0,1000,hash(),hash(),c)
}
fun accept(sc:&mut Scenario,s:&mut Soul,r:Receipt,c:&Clock){
    let journal=growth::revision(growth::journal(s));let root=standard::revision(s);growth::accept(s,r,journal,root,c,sc.ctx())
}
fun revoke(sc:&mut Scenario,s:&mut Soul,p:&Source,c:&Clock){
    let journal=growth::revision(growth::journal(s));let root=standard::revision(s);
    growth::revoke<GrowthProducer,Source>(s,p,hash(),1,journal,root,c,sc.ctx())
}
#[test]
fun actual_source_holder_acceptance_and_history_preserve_root(){
    let(mut sc,p,mut s,c)=setup();let id=object::id(&s);let origin=standard::origin(&s);auth(&mut sc,&mut s,&p,&c,0);
    let first=receipt(&s,&p,&c,b"learn",1);accept(&mut sc,&mut s,first,&c);
    let second=receipt(&s,&p,&c,b"work",2);accept(&mut sc,&mut s,second,&c);
    let j=growth::journal(&s);assert!(growth::root(j)==id && object::id(&s)==id && standard::origin(&s)==origin,0);
    assert!(growth::accepted_count(j)==2 && growth::policy_count(j)==1 && growth::revision(j)==3 && standard::module_count(&s)==1,1);
    let row=growth::history(j,2);let a=growth::change_accepted(&row).destroy_some();
    assert!(growth::accepted_actor(&a)==@0xb && growth::accepted_receipt(&a)==first && growth::accepted_at_ms(&a)==0,2);
    assert!(growth::accepted_at(j,&first)==option::some(2) && growth::accepted_at(j,&second)==option::some(3),3);
    assert!(growth::change_previous(&growth::history(j,3))==growth::change_hash(&row) && growth::history_head(j)==growth::change_hash(&growth::history(j,3)),4);
    end(sc,p,s,c)
}
#[test]
fun revoke_reauthorize_keeps_tombstones_and_stream_sequence(){
    let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let first=receipt(&s,&p,&c,b"one",1);accept(&mut sc,&mut s,first,&c);
    revoke(&mut sc,&mut s,&p,&c);let old=growth::policy<GrowthProducer,Source>(growth::journal(&s),&p,hash()).destroy_some();
    assert!(!growth::policy_enabled(growth::journal(&s),&old,&c),0);auth(&mut sc,&mut s,&p,&c,2);
    let second=receipt(&s,&p,&c,b"two",2);accept(&mut sc,&mut s,second,&c);
    assert!(growth::accepted_at(growth::journal(&s),&first)==option::some(2) && growth::accepted_count(growth::journal(&s))==2,1);end(sc,p,s,c)
}
#[test]
fun reset_is_constant_size_and_old_history_remains(){
    let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);accept(&mut sc,&mut s,r,&c);
    let journal=growth::revision(growth::journal(&s));let root=standard::revision(&s);growth::reset_sources(&mut s,journal,root,&c,sc.ctx());
    let old=growth::policy<GrowthProducer,Source>(growth::journal(&s),&p,hash()).destroy_some();assert!(!growth::policy_enabled(growth::journal(&s),&old,&c),0);
    auth(&mut sc,&mut s,&p,&c,1);let second=receipt(&s,&p,&c,b"two",2);accept(&mut sc,&mut s,second,&c);
    assert!(growth::generation(growth::journal(&s))==1 && growth::accepted_at(growth::journal(&s),&r)==option::some(2),1);end(sc,p,s,c)
}
#[test]
fun independent_runs_and_paged_history(){
    let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let mut i=1;
    while(i<=34){let r=receipt(&s,&p,&c,std::bcs::to_bytes(&i),i);accept(&mut sc,&mut s,r,&c);i=i+1};
    let r=growth::issue(GrowthProducer{},&p,object::id(&s),hash(),1,0,1,b"new-incarnation",b"one",1,1,0,1000,hash(),hash(),&c);accept(&mut sc,&mut s,r,&c);
    assert!(growth::accepted_count(growth::journal(&s))==35 && growth::history_page(growth::journal(&s),30,7).length()==7,0);end(sc,p,s,c)
}
#[test]
fun whole_soul_transfer_new_holder_explicitly_accepts_pending_receipt(){
    let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);let root=object::id(&s);
    transfer::public_transfer(s,@0xc);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(root);accept(&mut sc,&mut s,r,&c);
    let row=growth::history(growth::journal(&s),2);assert!(growth::accepted_actor(&growth::change_accepted(&row).destroy_some())==@0xc,0);end(sc,p,s,c)
}
#[test]
#[expected_failure(abort_code=7,location=soulidity_application::growth)]
fun same_receipt_copy_cannot_be_accepted_twice(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);accept(&mut sc,&mut s,r,&c);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=7,location=soulidity_application::growth)]
fun reissued_event_after_reset_and_reauthorization_still_rejected(){
    let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);accept(&mut sc,&mut s,r,&c);
    let j=growth::revision(growth::journal(&s));let root=standard::revision(&s);growth::reset_sources(&mut s,j,root,&c,sc.ctx());auth(&mut sc,&mut s,&p,&c,1);
    let reissued=receipt(&s,&p,&c,b"one",2);accept(&mut sc,&mut s,reissued,&c);end(sc,p,s,c)
}
#[test]
#[expected_failure(abort_code=8,location=soulidity_application::growth)]
fun skipped_sequence_cannot_be_accepted(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",2);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::growth)]
fun revoked_pending_receipt_rejected(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);revoke(&mut sc,&mut s,&p,&c);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::growth)]
fun reauthorize_never_revives_old_policy_receipt(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);auth(&mut sc,&mut s,&p,&c,1);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::growth)]
fun reset_then_reauthorize_never_revives_old_generation(){
    let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);let j=growth::revision(growth::journal(&s));let root=standard::revision(&s);
    growth::reset_sources(&mut s,j,root,&c,sc.ctx());auth(&mut sc,&mut s,&p,&c,1);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::growth)]
fun another_source_instance_cannot_impersonate_allowed_app(){
    let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let other=Source{id:object::new(sc.ctx())};
    let r=growth::issue(GrowthProducer{},&other,object::id(&s),hash(),1,0,1,b"life-instance",b"one",1,1,0,1000,hash(),hash(),&c);
    transfer::public_transfer(other,@0xb);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)
}
#[test]
#[expected_failure(abort_code=6,location=soulidity_application::growth)]
fun receipt_cannot_cross_soul_roots(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=growth::issue(GrowthProducer{},&p,object::id_from_address(@0x9),hash(),1,0,1,b"run",b"one",1,1,0,1000,hash(),hash(),&c);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_application::growth)]
fun exact_expiry_is_closed(){let(mut sc,p,mut s,mut c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);clock::set_for_testing(&mut c,1000);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_application::growth)]
fun receipt_cannot_outlive_policy(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=growth::issue(GrowthProducer{},&p,object::id(&s),hash(),1,0,1,b"run",b"one",1,1,0,1001,hash(),hash(),&c);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::growth)]
fun unapproved_schema_rejected(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=growth::issue(GrowthProducer{},&p,object::id(&s),hash(),1,0,1,b"run",b"one",1,2,0,1000,hash(),hash(),&c);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::growth)]
fun unapproved_source_version_rejected(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=growth::issue(GrowthProducer{},&p,object::id(&s),hash(),2,0,1,b"run",b"one",1,1,0,1000,hash(),hash(),&c);accept(&mut sc,&mut s,r,&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::growth)]
fun stale_policy_revision_rejected(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);auth(&mut sc,&mut s,&p,&c,0);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::growth)]
fun stale_journal_acceptance_rejected(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);let root=standard::revision(&s);growth::accept(&mut s,r,0,root,&c,sc.ctx());end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::growth)]
fun stale_root_acceptance_rejected(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let r=receipt(&s,&p,&c,b"one",1);growth::accept(&mut s,r,1,0,&c,sc.ctx());end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_application::growth)]
fun same_module_metadata_is_not_the_designated_producer(){let(sc,p,s,c)=setup();let _=growth::issue(WrongProducer{},&p,object::id(&s),hash(),1,0,1,b"run",b"one",1,1,0,1000,hash(),hash(),&c);end(sc,p,s,c)}
#[test]
#[expected_failure(abort_code=8,location=soulidity_standard::soul)]
fun permanent_journal_cannot_be_removed_to_reset_replay(){let(mut sc,p,mut s,c)=setup();auth(&mut sc,&mut s,&p,&c,0);let root=standard::revision(&s);let j=standard::uninstall<growth::Witness,growth::Journal>(&mut s,b"growth",root);transfer::public_transfer(j,@0xb);end(sc,p,s,c)}
