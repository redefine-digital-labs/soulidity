#[test_only]
module soulidity_v1::model_source_tests;
use sui::test_scenario;
use std::type_name;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_model::policy;
use soulidity_foundation::economics::{Self,Config};
use soulidity_standard::soul as standard;
public struct PolicyProducer has drop {}

#[test]
fun preview_has_real_product_type_and_id_without_consuming_supply(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();
    let key=policy::definition_hash(&fixtures::def(b"free",2,10));
    let before=catalog::issued_count(&p,1,key);let s=catalog::preview_source(&p,1,key);let copied=s;
    assert!(policy::source_product(&s)==object::id(&p) && policy::source_type(&s)==type_name::with_defining_ids<Product<USD>>(),0);
    assert!(s==copied && catalog::issued_count(&p,1,key)==before && before==0,1);
    test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=3,location=soulidity_standard::soul)]
fun public_catalog_version_cannot_attest_an_unpaid_soul(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let v=*catalog::published(&p,1);
    let s=standard::creation_raw_for_testing(standard::new(v,&p,1,catalog::policy_hash(&v),std::string::utf8(b"unpaid"),sc.ctx()));
    transfer::public_transfer(s,@0xb);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=4,location=soulidity_model::policy)]
fun public_catalog_version_cannot_attest_component_metadata(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let v=*catalog::published(&p,1);
    let cfg:Config<USD> =sc.take_shared();
    let _=policy::source(v,&p,object::id(&p),1,1,object::id(&cfg),0,@0xa,catalog::market_policy(&p),economics::primary_policy(&cfg),fixtures::def(b"free",2,10));
    test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=4,location=soulidity_model::policy)]
fun same_named_foreign_marker_cannot_attest_actual_catalog_product(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let cfg:Config<USD> =sc.take_shared();
    let _=policy::source(PolicyProducer{},&p,object::id(&p),1,1,object::id(&cfg),0,@0xa,catalog::market_policy(&p),economics::primary_policy(&cfg),fixtures::def(b"free",2,10));
    test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.end();
}
#[test]
fun extended_creator_definition_leaves_original_and_rights_unchanged(){
    let d=fixtures::def(b"free",2,10);let scene=fixtures::scene();let old=policy::definition_hash(&d);
    let f=soulidity_visual::visual::fragment(b"second",fixtures::h(13),b"image/png",1024,1,1,0,0,1,1,0,0,b"main",1,b"root",soulidity_visual::visual::transform(soulidity_visual::visual::signed(false,0),soulidity_visual::visual::signed(false,0),1000000,soulidity_visual::visual::signed(false,0)),1000000,0,option::none(),option::none(),option::some(0),vector[]);
    let n=policy::extended_definition(&d,&scene,vector[f]);
    assert!(policy::definition_hash(&d)==old && soulidity_visual::visual::fragments(policy::representation(&d)).length()==1,0);
    assert!(policy::definition_key(&n)==policy::definition_key(&d) && policy::supply(&n)==policy::supply(&d) && policy::definition_hash(&n)!=old && soulidity_visual::visual::fragments(policy::representation(&n)).length()==2,1)
}

public struct IndependentProduct has key {id:UID}
fun destroy_product(p:IndependentProduct){let IndependentProduct{id}=p;id.delete()}
fun value_source(p:&IndependentProduct,native_product:&Product<USD>,cfg:&Config<USD>,maker_version:u64,version:u64,royalty:u16,beneficiary:address,protocol:ID):policy::Source{
    policy::source(PolicyProducer{},p,object::id(native_product),maker_version,version,protocol,royalty,beneficiary,catalog::market_policy(native_product),economics::primary_policy(cfg),fixtures::def(b"free",2,10))
}
#[test]
fun independent_producer_metadata_is_copyable_but_not_native(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let cfg:Config<USD> =sc.take_shared();let foreign=IndependentProduct{id:object::new(sc.ctx())};
    let source=value_source(&foreign,&p,&cfg,1,1,0,@0xa,object::id(&cfg));
    let copied=source;assert!(source==copied && policy::source_product(&source)==object::id(&foreign) && policy::source_type(&source)==type_name::with_defining_ids<IndependentProduct>(),0);
    let native_product=catalog::assembly_profile(&p,1);let state=soulidity_model::assembly::new(&native_product,sc.ctx());
    assert!(!soulidity_model::assembly::native_matches(&state,&fixtures::scene(),&source,soulidity_model::assembly::root_part(b"free")),1);
    let scope=soulidity_model::assembly::scope(PolicyProducer{},&foreign,object::id(&cfg),1,fixtures::h(1));
    let profile=soulidity_model::assembly::profile(PolicyProducer{},&foreign,scope,option::none(),fixtures::scene(),vector[b"free"],vector[]);
    assert!(soulidity_model::assembly::profile_scope(&profile)==scope && soulidity_model::assembly::scope_type(&scope)==type_name::with_defining_ids<IndependentProduct>(),2);
    soulidity_model::assembly::destroy(state);destroy_product(foreign);test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::policy)]
fun producer_source_requires_positive_version(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let cfg:Config<USD> =sc.take_shared();let foreign=IndependentProduct{id:object::new(sc.ctx())};
    let _=value_source(&foreign,&p,&cfg,1,0,0,@0xa,object::id(&cfg));destroy_product(foreign);test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::policy)]
fun producer_source_requires_positive_maker_version(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let cfg:Config<USD> =sc.take_shared();let foreign=IndependentProduct{id:object::new(sc.ctx())};
    let _=value_source(&foreign,&p,&cfg,0,1,0,@0xa,object::id(&cfg));destroy_product(foreign);test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::policy)]
fun producer_source_rejects_excessive_royalty(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let cfg:Config<USD> =sc.take_shared();let foreign=IndependentProduct{id:object::new(sc.ctx())};
    let _=value_source(&foreign,&p,&cfg,1,1,10001,@0xa,object::id(&cfg));destroy_product(foreign);test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::policy)]
fun producer_source_rejects_zero_beneficiary(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let cfg:Config<USD> =sc.take_shared();let foreign=IndependentProduct{id:object::new(sc.ctx())};
    let _=value_source(&foreign,&p,&cfg,1,1,0,@0x0,object::id(&cfg));destroy_product(foreign);test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::policy)]
fun producer_source_rejects_different_policy_protocol(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let cfg:Config<USD> =sc.take_shared();let foreign=IndependentProduct{id:object::new(sc.ctx())};
    let _=value_source(&foreign,&p,&cfg,1,1,0,@0xa,object::id(&foreign));destroy_product(foreign);test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=4,location=soulidity_model::policy)]
fun public_catalog_version_cannot_attest_visual_scope(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let v=*catalog::published(&p,1);
    let _=soulidity_model::assembly::scope(v,&p,catalog::protocol(&p),1,catalog::policy_hash(&v));test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::assembly)]
fun foreign_producer_cannot_claim_native_profile_parent(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let foreign=IndependentProduct{id:object::new(sc.ctx())};let parent=soulidity_model::assembly::profile_scope(&catalog::assembly_profile(&p,1));
    let scope=soulidity_model::assembly::scope(PolicyProducer{},&foreign,catalog::protocol(&p),1,fixtures::h(1));
    let _=soulidity_model::assembly::profile(PolicyProducer{},&foreign,scope,option::some(parent),fixtures::scene(),vector[b"free"],vector[]);
    destroy_product(foreign);test_scenario::return_shared(p);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::assembly)]
fun same_producer_cannot_rebind_scope_to_other_actual_object(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let p:Product<USD> =sc.take_shared();let one=IndependentProduct{id:object::new(sc.ctx())};let two=IndependentProduct{id:object::new(sc.ctx())};
    let scope=soulidity_model::assembly::scope(PolicyProducer{},&one,catalog::protocol(&p),1,fixtures::h(1));
    let _=soulidity_model::assembly::profile(PolicyProducer{},&two,scope,option::none(),fixtures::scene(),vector[b"free"],vector[]);
    destroy_product(one);destroy_product(two);test_scenario::return_shared(p);sc.end();
}
