#[test_only]
module soulidity_v1::state_configuration_tests;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::coin;
use sui::clock;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_v1::issuer;
use soulidity_application::character::{Self as character};
use soulidity_content::state_configuration;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_model::policy;

fun setup():(Scenario,Soul,Config<USD>){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);
    let s=sc.take_from_sender_by_id(id);let cfg=sc.take_shared();(sc,s,cfg)
}
fun finish(sc:Scenario,s:Soul,cfg:Config<USD>){sc.return_to_sender(s);test_scenario::return_shared(cfg);sc.end();}
fun set(sc:&mut Scenario,s:&mut Soul,cfg:&Config<USD>,key:vector<u8>,value:vector<u8>){let rev=character::revision(s);character::set_state_config(s,cfg,string::utf8(key),value,rev,sc.ctx());}

#[test]
fun optional_real_configuration_upserts_deletes_and_preserves_assets(){
    let(mut sc,mut s,cfg)=setup();let id=object::id(&s);let origin=standard::origin(&s);let artifact=object::id(character::original_output(&s));let item=character::free_id(&character::binding(&s,b"free").destroy_some());let genesis=character::genesis_commitment(&s);let app=character::revision(&s);let root=standard::revision(&s);let manifest=character::manifest_hash(&s);
    assert!(!character::has_state_config(&s,string::utf8(b"sprite_config_json")),0);
    set(&mut sc,&mut s,&cfg,b"sprite_config_json",b"{}");let module_id=object::id(character::state_config_module(&s));let first=state_configuration::commitment(character::state_config_module(&s));
    set(&mut sc,&mut s,&cfg,b"sprite_config_json",b"{new}");assert!(object::id(character::state_config_module(&s))==module_id && state_configuration::count(character::state_config_module(&s))==1,1);
    assert!(*character::state_config(&s,string::utf8(b"sprite_config_json"))==b"{new}" && state_configuration::commitment(character::state_config_module(&s))!=first,2);
    character::delete_state_config(&mut s,&cfg,string::utf8(b"sprite_config_json"),app+2,sc.ctx());
    assert!(!character::has_state_config(&s,string::utf8(b"sprite_config_json")) && state_configuration::count(character::state_config_module(&s))==0 && state_configuration::revision(character::state_config_module(&s))==3,3);
    assert!(object::id(&s)==id && standard::origin(&s)==origin && object::id(character::original_output(&s))==artifact && character::free_id(&character::binding(&s,b"free").destroy_some())==item && character::genesis_commitment(&s)==genesis,4);
    assert!(character::revision(&s)==app+3 && standard::revision(&s)==root+3 && character::manifest_hash(&s)!=manifest,5);finish(sc,s,cfg)
}
#[test]
fun original_metadata_domain_accepts_long_keys_empty_and_large_values(){
    let(mut sc,mut s,cfg)=setup();let key=vector::tabulate!(4097,|_|97u8);set(&mut sc,&mut s,&cfg,key,vector[]);
    assert!(character::has_state_config(&s,string::utf8(key)) && character::state_config(&s,string::utf8(key)).is_empty(),0);
    let value=vector::tabulate!(15000,|_|42u8);set(&mut sc,&mut s,&cfg,key,value);assert!(*character::state_config(&s,string::utf8(key))==value,1);finish(sc,s,cfg)
}
#[test]
fun configuration_follows_original_soul_to_new_owner(){
    let(mut sc,mut s,cfg)=setup();let id=object::id(&s);set(&mut sc,&mut s,&cfg,b"mood",b"happy");let child=object::id(character::state_config_module(&s));transfer::public_transfer(s,@0xc);test_scenario::return_shared(cfg);sc.next_tx(@0xc);
    let mut s:Soul=sc.take_from_sender_by_id(id);let cfg=sc.take_shared();set(&mut sc,&mut s,&cfg,b"mood",b"calm");assert!(object::id(character::state_config_module(&s))==child && *character::state_config(&s,string::utf8(b"mood"))==b"calm",0);finish(sc,s,cfg)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::state_configuration)]
fun empty_configuration_key_is_rejected(){let(mut sc,mut s,cfg)=setup();set(&mut sc,&mut s,&cfg,b"",b"{}");finish(sc,s,cfg)}
#[test,expected_failure(abort_code=2,location=soulidity_content::state_configuration)]
fun delete_missing_configuration_key_is_rejected(){let(mut sc,mut s,cfg)=setup();set(&mut sc,&mut s,&cfg,b"present",b"{}");character::delete_state_config(&mut s,&cfg,string::utf8(b"missing"),1,sc.ctx());finish(sc,s,cfg)}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_application_revision_cannot_overwrite_configuration(){let(mut sc,mut s,cfg)=setup();set(&mut sc,&mut s,&cfg,b"mood",b"first");character::set_state_config(&mut s,&cfg,string::utf8(b"mood"),b"stale",0,sc.ctx());finish(sc,s,cfg)}
#[test,expected_failure(abort_code=10,location=soulidity_standard::soul)]
fun schema_two_writer_cannot_omit_configuration_commitment(){let(mut sc,mut s,cfg)=setup();set(&mut sc,&mut s,&cfg,b"mood",b"first");character::previous_configuration_schema_commit_for_testing(&mut s);finish(sc,s,cfg)}

fun initial(reserved:bool){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let mut sys=fixtures::prepare_storage(&mut sc);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let intent=fixtures::default_intent(&p,41,fixtures::default_recipe(&p),sc.sender());let rev=economics::revision(&cfg);
    let mut b=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&cfg),&mut p,&mut cfg,intent,b"default",rev,1000,coin::mint_for_testing<USD>(0,sc.ctx()),&clock,sc.ctx());
    issuer::set_initial_state_config(&mut b,string::utf8(if(reserved)b"content_seal_envelope_v1:soul" else b"sprite_config_json"),b"{}",sc.ctx());
    issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"ref",0,10)),b"ref",fixtures::layout(),sc.ctx());issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"bound",1,10)),b"bound",fixtures::layout(),sc.ctx());issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"free",2,10)),b"free",fixtures::layout(),sc.ctx());
    let id=fixtures::finish(&mut sc,b,&mut sys,&clock);test_scenario::return_shared(sys);test_scenario::return_shared(p);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);
    assert!(*character::state_config(&s,string::utf8(b"sprite_config_json"))==b"{}" && character::revision(&s)==0 && state_configuration::revision(character::state_config_module(&s))==1,0);sc.return_to_sender(s);sc.end();
}
#[test]
fun complete_initial_configuration_survives_one_use_draft(){initial(false)}
#[test,expected_failure(abort_code=4,location=soulidity_content::state_configuration)]
fun initial_configuration_cannot_impersonate_content_envelope(){initial(true)}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun primary_disabled_rejects_configuration_write(){
    let(mut sc,s,cfg)=setup();let id=object::id(&s);sc.return_to_sender(s);test_scenario::return_shared(cfg);sc.next_tx(@0xa);let mut cfg:Config<USD> =sc.take_shared();let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_primary_enabled(&mut cfg,&mut admin,rev,hash,false);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(id);let cfg=sc.take_shared();set(&mut sc,&mut s,&cfg,b"mood",b"happy");finish(sc,s,cfg)
}

#[test,expected_failure(abort_code=8,location=soulidity_application::character)]
fun another_protocol_cannot_authorize_configuration_write(){
    let(mut sc,mut s,cfg)=setup();let(other,admin)=economics::new_config_for_testing<USD>(0,0,0,@0xf,sc.ctx());
    character::set_state_config(&mut s,&other,string::utf8(b"mood"),b"happy",0,sc.ctx());
    economics::share_config_for_testing(other,admin,sc.ctx());finish(sc,s,cfg)
}
