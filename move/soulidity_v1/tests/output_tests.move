#[test_only]
module soulidity_v1::output_tests;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use sui::coin::{Self,Coin};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::storage_fixture;
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config};
use soulidity_v1::issuer::{Self,Build};
use soulidity_application::output::{Self};
use soulidity_maker_publication::output_data::{Intent};
use soulidity_model::policy;
use soulidity_content::document;
use soulidity_content_kinds::content_kind_registry::KindRegistry;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_application::vault;
use soulidity_v1::application_operator;
use walrus::system::System;
public struct Fixture {sc:Scenario,maker:Product<USD>,config:Config<USD>,system:System,registry:KindRegistry,clock:Clock}
fun setup(protected:bool,price:u64,fixed:u64):Fixture {
    let mut sc=fixtures::setup_with_output(0,if(price>0)1 else 0,price,0,0,fixed,protected,true,vector[]);
    let maker=sc.take_shared();let config=sc.take_shared();let system=sc.take_shared();let registry=sc.take_shared();let clock=clock::create_for_testing(sc.ctx());Fixture{sc,maker,config,system,registry,clock}
}
fun intent(f:&Fixture):Intent{fixtures::default_intent(&f.maker,20,fixtures::default_recipe(&f.maker),f.sc.sender())}
fun begin(f:&mut Fixture,i:Intent):Build {
    let pay=coin::mint_for_testing<USD>(catalog::completion_price(&f.maker,1,f.sc.sender())+economics::complete_fee(&f.config),f.sc.ctx());
    {let Fixture{sc,maker,config,clock,..}=f;issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(config),maker,config,i,b"default",0,1000,pay,clock,sc.ctx())}
}
fun select(f:&mut Fixture,b:&mut Build,drift:bool) {
    let parts=vector[b"ref",b"bound",b"free"];let mut n=0;
    while(n < parts.length()){
        let p=parts[n];let layout=if(drift && n==2)policy::layout(false,1,false,0,1000000,0,vector[]) else fixtures::layout();
        issuer::select(b,&mut f.maker,policy::definition_hash(&fixtures::def(p,n as u8,10)),p,layout,f.sc.ctx());n=n+1
    }
}
fun append(f:&mut Fixture,b:&mut Build,kind:u32,name:vector<u8>) {
    let blob=storage_fixture::blob(&mut f.system,(100+kind) as u256,false,true,f.sc.ctx());
    issuer::append_initial_content(b,&f.registry,kind,string::utf8(name),blob,&f.system,fixtures::h((50+kind) as u8),b"initial-envelope",&f.clock,f.sc.ctx());
}
fun initial(f:&mut Fixture,b:&mut Build,omit:Option<u32>) {
    output::initials(issuer::output_policy(b)).do_ref!(|r|{
        let kind=output::rule_kind(r);if(omit!=option::some(kind))append(f,b,kind,*output::rule_name(r).as_bytes())
    })
}
fun finish(f:&mut Fixture,b:Build,envelope:vector<u8>,deletable:bool,certified:bool):ID {
    let blob=storage_fixture::blob(&mut f.system,200,deletable,certified,f.sc.ctx());issuer::finish(b,blob,&f.system,fixtures::h(60),envelope,f.sc.ctx())
}
fun release(f:Fixture):Scenario {
    let Fixture{sc,maker,config,system,registry,clock}=f;test_scenario::return_shared(maker);test_scenario::return_shared(config);test_scenario::return_shared(system);test_scenario::return_shared(registry);clock::destroy_for_testing(clock);sc
}
fun done(f:Fixture){release(f).end();}
#[test]
fun complete_retains_precomputed_namespaces_original_recipe_and_receipt() {
    let mut f=setup(true,37,3);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());let root=finish(&mut f,b,b"render-envelope",false,true);
    f.sc.next_tx(@0xb);let mut s:Soul=f.sc.take_from_sender_by_id(root);let artifact=soul::original_output(&s);
    assert!(output::root(artifact)==root && output::intent_hash(output::artifact_intent(artifact))==output::intent_hash(&i),0);
    assert!(fixtures::recipe(output::original_recipe(artifact))==fixtures::default_recipe(&f.maker) && soul::revision(&s)==0,1);
    assert!(soul::seal_id(&s,0)==output::content_id(&i,0,document::soul_doc_name()) && soul::seal_id(&s,1)==output::content_id(&i,1,document::memory_name()),2);
    let receipt=output::artifact_receipt(artifact);let line=&output::pay_lines(receipt)[0];
    assert!(output::total_paid(receipt)==40 && output::platform_recipient(receipt)==@0xf && output::line_gross(line)==37 && output::line_platform(line)==3 && output::line_fixed(line)==3 && output::line_beneficiary(line)==@0xd && output::line_product(line)==object::id(&f.maker) && output::line_version(line)==1 && output::line_policy_hash(line)==catalog::policy_hash(catalog::published(&f.maker,1)),3);
    soul::seal_approve_original_output_owner(output::render_id(&i),&mut s,&f.system,f.sc.ctx());
    let original=fixtures::recipe(output::original_recipe(soul::original_output(&s)));soul::tune(&mut s,b"free",policy::layout(false,1,false,0,1000000,0,vector[]),0);
    assert!(original==fixtures::recipe(output::original_recipe(soul::original_output(&s))) && original!=soul::semantic_recipe_hash(&s),4);f.sc.return_to_sender(s);
    f.sc.next_tx(@0xd);assert!(soulidity_foundation::revenue::balance(catalog::income(&f.maker))==34 && f.sc.ids_for_sender<Coin<USD>>().is_empty(),5);
    f.sc.next_tx(@0xf);let mut total=0;f.sc.ids_for_sender<Coin<USD>>().do_ref!(|id|{let c:Coin<USD> = f.sc.take_from_sender_by_id(*id);total=total+coin::value(&c);f.sc.return_to_sender(c)});assert!(total==0 && soulidity_foundation::revenue::balance(economics::income(&f.config))==6,6);done(f)
}
#[test]
#[expected_failure(abort_code=5,location=soulidity_v1::issuer)]
fun missing_founding_document_aborts_complete(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::some(0));finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_v1::issuer)]
fun missing_memory_aborts_complete(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::some(1));finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_v1::issuer)]
fun missing_creator_required_skill_aborts_complete(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::some(2));finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=10,location=soulidity_application::character)]
fun initial_content_cannot_be_supplied_twice(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());append(&mut f,&mut b,1,b"default");finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_publication::output_data)]
fun undeclared_initial_content_rejected(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);append(&mut f,&mut b,3,b"main");select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=6,location=soulidity_v1::issuer)]
fun changed_layout_cannot_use_pre_encrypted_intent(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,true);initial(&mut f,&mut b,option::none());finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_maker_publication::output_data)]
fun intent_cannot_authorize_a_different_actor(){let mut f=setup(false,0,0);let i=fixtures::default_intent(&f.maker,20,fixtures::default_recipe(&f.maker),@0xc);let b=begin(&mut f,i);finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_maker_publication::output_data)]
fun intent_wrong_protocol_rejected(){let mut f=setup(false,0,0);let v=catalog::published(&f.maker,1);let p=catalog::output_policy(v,b"default");let i=output::intent(object::id_from_address(@0x999),object::id(&f.maker),1,catalog::policy_hash(v),output::policy_hash(&p),@0xb,fixtures::h(20),string::utf8(b"OC"),fixtures::default_recipe(&f.maker),vector::tabulate!(16,|_|20));let b=begin(&mut f,i);finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_maker_publication::output_data)]
fun intent_wrong_maker_rejected(){let mut f=setup(false,0,0);let v=catalog::published(&f.maker,1);let p=catalog::output_policy(v,b"default");let i=output::intent(catalog::protocol(&f.maker),object::id_from_address(@0x999),1,catalog::policy_hash(v),output::policy_hash(&p),@0xb,fixtures::h(20),string::utf8(b"OC"),fixtures::default_recipe(&f.maker),vector::tabulate!(16,|_|20));let b=begin(&mut f,i);finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_maker_publication::output_data)]
fun intent_wrong_output_policy_rejected(){let mut f=setup(false,0,0);let v=catalog::published(&f.maker,1);let i=output::intent(catalog::protocol(&f.maker),object::id(&f.maker),1,catalog::policy_hash(v),fixtures::h(99),@0xb,fixtures::h(20),string::utf8(b"OC"),fixtures::default_recipe(&f.maker),vector::tabulate!(16,|_|20));let b=begin(&mut f,i);finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::output)]
fun protected_render_requires_envelope(){let mut f=setup(true,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());finish(&mut f,b,vector[],false,true);done(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::output)]
fun public_render_cannot_carry_protected_envelope(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());finish(&mut f,b,b"unexpected-envelope",false,true);done(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun unverified_render_rejected(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());finish(&mut f,b,vector[],false,false);done(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun deletable_render_rejected(){let mut f=setup(false,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());finish(&mut f,b,vector[],true,true);done(f)}
#[test]
fun recovery_available_only_for_exact_author_intent_before_complete(){let mut f=setup(true,0,0);let i=intent(&f);issuer::seal_approve_upload_recovery(output::recovery_id(&i),&f.maker,i,b"default",f.sc.ctx());assert!(output::recovery_id(&i)!=output::render_id(&i) && output::content_id(&i,0,document::soul_doc_name())!=output::render_id(&i),0);done(f)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_v1::issuer)]
fun recovery_is_revoked_after_successful_complete(){let mut f=setup(true,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());finish(&mut f,b,b"render-envelope",false,true);issuer::seal_approve_upload_recovery(output::recovery_id(&i),&f.maker,i,b"default",f.sc.ctx());done(f)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_v1::issuer)]
fun render_namespace_cannot_be_used_as_upload_recovery(){let mut f=setup(true,0,0);let i=intent(&f);issuer::seal_approve_upload_recovery(output::render_id(&i),&f.maker,i,b"default",f.sc.ctx());done(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_maker_publication::output_data)]
fun other_wallet_cannot_recover_author_upload(){let mut f=setup(true,0,0);let i=intent(&f);f.sc.next_tx(@0xc);issuer::seal_approve_upload_recovery(output::recovery_id(&i),&f.maker,i,b"default",f.sc.ctx());done(f)}
#[test]
fun original_render_follows_soul_transfer_and_new_holder_reads(){let mut f=setup(true,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());let root=finish(&mut f,b,b"render-envelope",false,true);f.sc.next_tx(@0xb);let s:Soul=f.sc.take_from_sender_by_id(root);transfer::public_transfer(s,@0xc);f.sc.next_tx(@0xc);let mut s:Soul=f.sc.take_from_sender_by_id(root);soul::seal_approve_original_output_owner(output::render_id(&i),&mut s,&f.system,f.sc.ctx());f.sc.return_to_sender(s);assert!(!test_scenario::has_most_recent_for_address<Soul>(@0xb),0);done(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::output)]
fun wrong_render_namespace_rejected(){let mut f=setup(true,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());let root=finish(&mut f,b,b"render-envelope",false,true);f.sc.next_tx(@0xb);let mut s:Soul=f.sc.take_from_sender_by_id(root);soul::seal_approve_original_output_owner(output::recovery_id(&i),&mut s,&f.system,f.sc.ctx());f.sc.return_to_sender(s);done(f)}
#[test]
fun original_render_extends_stored_blob_without_changing_genesis(){let mut f=setup(true,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());let root=finish(&mut f,b,b"render-envelope",false,true);f.sc.next_tx(@0xb);let mut s:Soul=f.sc.take_from_sender_by_id(root);let a=soul::original_output(&s);let end=output::render_end_epoch(a);let original=fixtures::recipe(output::original_recipe(a));let size=soulidity_transport::storage_transport::bytes(output::render(a));let mut pay=coin::mint_for_testing<wal::wal::WAL>(1000000000,f.sc.ctx());let amount=walrus::encoding::encoded_blob_length(size,1,walrus::system::n_shards(&f.system));let extension=walrus::system::reserve_space_for_epochs(&mut f.system,amount,end,end+4,&mut pay,f.sc.ctx());coin::burn_for_testing(pay);soul::extend_original_output(&mut s,extension,&f.system,0);assert!(output::render_end_epoch(soul::original_output(&s))>end && fixtures::recipe(output::original_recipe(soul::original_output(&s)))==original && soul::revision(&s)==1,0);soul::seal_approve_original_output_owner(output::render_id(&i),&mut s,&f.system,f.sc.ctx());f.sc.return_to_sender(s);done(f)}
#[test]
fun supplied_root_render_policy_and_actual_new_owner_read(){
    let(mut f,i,root)=protected_root(soul::scope_assets());let mut s:Soul=f.sc.take_from_sender_by_id(root);
    // Policy primitive under a supplied owned root; independent agent routing
    // remains deferred. This private test call is not a production Seal endpoint.
    soul::assert_delegate(application_operator::operator(),&s,@0xb,@0x8,soul::scope_assets(),&f.clock);
    soul::assert_original_output_read(application_operator::operator(),output::render_id(&i),&s,&f.system);
    let tool=object::id(vault::tool(&s));soul::clear_authorizations(&mut s);let r=soulidity_standard::soul::revision(&s);vault::rotate_private_scope(&mut s,0,r);
    transfer::public_transfer(s,@0xc);f.sc.next_tx(@0xc);let mut s:Soul=f.sc.take_from_sender_by_id(root);
    soul::seal_approve_original_output_owner(output::render_id(&i),&mut s,&f.system,f.sc.ctx());
    assert!(soul::grant_count(&s)==0 && object::id(vault::tool(&s))==tool,0);f.sc.return_to_sender(s);done(f)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_publication::output_data)]
fun output_policy_requires_canonical_memory(){let f=setup(false,0,0);output::policy(b"bad",false,vector[],fixtures::h(14),true,vector[],vector[output::initial_rule(&f.registry,0,document::soul_doc_name(),3,0),output::initial_rule(&f.registry,2,string::utf8(b"default"),3,0)]);done(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_publication::output_data)]
fun duplicate_initial_slot_rejected(){let f=setup(false,0,0);let doc=output::initial_rule(&f.registry,0,document::soul_doc_name(),3,0);output::policy(b"bad",false,vector[],fixtures::h(14),true,vector[],vector[doc,doc,output::initial_rule(&f.registry,1,document::memory_name(),3,0)]);done(f)}
fun protected_root(scope:u64):(Fixture,Intent,ID){
    let mut f=setup(true,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());
    let root=finish(&mut f,b,b"render-envelope",false,true);f.sc.next_tx(@0xb);let mut s:Soul=f.sc.take_from_sender_by_id(root);
    let r=soulidity_standard::soul::revision(&s);vault::install(&mut s,r,f.sc.ctx());
    soul::grant(&mut s,@0x8,scope,option::some(1000),0,option::none(),&f.clock,f.sc.ctx());f.sc.return_to_sender(s);f.sc.next_tx(@0xb);(f,i,root)
}
#[test,expected_failure(abort_code=9,location=soulidity_application::character)]
fun memory_policy_cannot_read_protected_render(){
    let(mut f,i,root)=protected_root(soul::scope_memory());let s:Soul=f.sc.take_from_sender_by_id(root);
    soul::assert_delegate(application_operator::operator(),&s,@0xb,@0x8,soul::scope_assets(),&f.clock);
    soul::assert_original_output_read(application_operator::operator(),output::render_id(&i),&s,&f.system);f.sc.return_to_sender(s);done(f)
}
#[test,expected_failure(abort_code=9,location=soulidity_application::character)]
fun explicit_handover_and_return_cannot_revive_render_policy(){
    let(mut f,_i,root)=protected_root(soul::scope_assets());let mut s:Soul=f.sc.take_from_sender_by_id(root);
    soul::clear_authorizations(&mut s);transfer::public_transfer(s,@0xc);f.sc.next_tx(@0xc);let mut s:Soul=f.sc.take_from_sender_by_id(root);
    soul::clear_authorizations(&mut s);transfer::public_transfer(s,@0xb);f.sc.next_tx(@0xb);let s:Soul=f.sc.take_from_sender_by_id(root);
    soul::assert_delegate(application_operator::operator(),&s,@0xb,@0x8,soul::scope_assets(),&f.clock);f.sc.return_to_sender(s);done(f)
}
#[test,expected_failure(abort_code=4,location=sui::test_scenario)]
fun cached_seller_cannot_supply_new_owner_soul_for_render_read(){
    let(mut f,i,root)=protected_root(soul::scope_assets());let s:Soul=f.sc.take_from_sender_by_id(root);transfer::public_transfer(s,@0xc);f.sc.next_tx(@0xb);
    let mut s:Soul=f.sc.take_from_sender_by_id(root);soul::seal_approve_original_output_owner(output::render_id(&i),&mut s,&f.system,f.sc.ctx());f.sc.return_to_sender(s);done(f)
}

#[test]
#[expected_failure(abort_code=7,location=soulidity_maker_manufacturing::maker_catalog)]
fun same_intent_cannot_issue_second_soul(){let mut f=setup(true,0,0);let i=intent(&f);let mut b=begin(&mut f,i);select(&mut f,&mut b,false);initial(&mut f,&mut b,option::none());finish(&mut f,b,b"render-envelope",false,true);let b=begin(&mut f,i);finish(&mut f,b,b"render-envelope",false,true);done(f)}
