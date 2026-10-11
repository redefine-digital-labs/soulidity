#[test_only]
module soulidity_v1::standard_business_tests;
use sui::test_scenario;
use std::type_name;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_application::character as soul;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_v1::standard_extension_fixture as growth;

#[test]
fun complete_uses_real_product_origin_and_one_permanent_application(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);let p:Product<USD> =sc.take_shared();
    let o=standard::origin(&s);assert!(standard::source(&o)==object::id(&p) && standard::source_version(&o)==1 && standard::source_hash(&o)==catalog::policy_hash(catalog::published(&p,1)),0);
    assert!(standard::source_type(&o)==type_name::with_defining_ids<Product<USD>>() && standard::producer(&o)==type_name::with_defining_ids<soulidity_maker_manufacturing::maker_catalog::SoulProducer>() && standard::minted_by(&o)==@0xb,1);
    let d=standard::descriptor<soul::ApplicationWitness>(&s,b"animacraft").destroy_some();assert!(!standard::removable(&d) && standard::module_id(&d)==soul::application_module_id(&s) && standard::value_type(&d)==type_name::with_defining_ids<soul::ApplicationState>(),2);
    assert!(object::id(&s)!=soul::application_module_id(&s) && standard::module_count(&s)==1 && soul::revision(&s)==0 && standard::revision(&s)>0,3);
    assert!(soul::reference_count(&s)==1 && soul::bound_count(&s)==1 && soul::free_id(&soul::binding(&s,b"free").destroy_some()).is_some(),4);
    test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}
#[test]
fun app_updates_preserve_foreign_module_identity_and_root_revision(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(id);let app=soul::application_module_id(&s);let component=growth::install(&mut s,sc.ctx());let before=standard::revision(&s);
    let d0=standard::descriptor<soul::ApplicationWitness>(&s,b"animacraft").destroy_some();let manifest=soul::manifest_hash(&s);
    soul::tune(&mut s,b"free",fixtures::layout(),0);let d1=standard::descriptor<soul::ApplicationWitness>(&s,b"animacraft").destroy_some();
    assert!(object::id(&s)==id && soul::application_module_id(&s)==app && standard::revision(&s)==before+1 && soul::revision(&s)==1 && growth::events(&s)==0,0);
    assert!(standard::body_hash(&d0)!=standard::body_hash(&d1) && standard::semantic_hash(&d0)!=standard::semantic_hash(&d1) && soul::manifest_hash(&s)!=manifest,1);
    let before=soul::manifest_hash(&s);let rev=standard::revision(&s);growth::update(&mut s);assert!(soul::revision(&s)==1 && standard::revision(&s)==rev+1 && soul::manifest_hash(&s)!=before && growth::events(&s)==1,2);
    let x=growth::uninstall(&mut s);assert!(object::id(&x)==component && standard::module_count(&s)==1,3);transfer::public_transfer(x,@0xc);sc.return_to_sender(s);sc.end();
}
#[test]
fun readonly_owned_apis_do_not_change_standard_commitments(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(id);let rev=standard::revision(&s);let manifest=standard::manifest_hash(&s);
    assert!(soul::current_loadout_head(&mut s,sc.ctx()).is_none(),0);assert!(standard::revision(&s)==rev && standard::manifest_hash(&s)==manifest && soul::revision(&s)==0,1);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=8,location=soulidity_standard::soul)]
fun creator_bound_inventory_cannot_exit_by_removing_the_app_module(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(id);let rev=standard::revision(&s);let state=standard::uninstall<soul::ApplicationWitness,soul::ApplicationState>(&mut s,b"animacraft",rev);transfer::public_transfer(state,@0xc);sc.return_to_sender(s);sc.end();
}
#[test]
fun nested_oc_edit_and_original_id_exit_preserve_bound_rights(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let parent=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let child=fixtures::mint(&mut sc,21,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(parent);let t:Soul=sc.take_from_sender_by_id(child);let original=standard::origin(&t);let item=soul::free_id(&soul::binding(&t,b"free").destroy_some()).destroy_some();let revision=standard::revision(&s);standard::nest(&mut s,t,revision);let before=soul::manifest_hash(&s);
    let revision=standard::revision(&s);let(mut t,ticket)=standard::begin_nested_update(&mut s,child,revision);let it=soul::detach(&mut t,b"free",0);assert!(object::id(&it)==item && soul::bound_count(&t)==1,0);standard::commit_nested_update(&mut s,ticket,t);assert!(soul::manifest_hash(&s)!=before && soul::revision(&s)==0,1);
    transfer::public_transfer(it,@0xc);transfer::public_transfer(s,@0xc);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(parent);let rev=standard::revision(&s);let t=standard::unnest(&mut s,child,rev);assert!(object::id(&t)==child && standard::origin(&t)==original && soul::bound_count(&t)==1 && soul::binding(&t,b"free").is_none(),2);transfer::public_transfer(t,@0xc);sc.return_to_sender(s);sc.end();
}
#[test]
fun whole_sale_transfers_foreign_extension_and_nested_oc_with_original_ids(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let parent=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let child=fixtures::mint(&mut sc,21,0);
    sc.next_tx(@0xa);let mut cfg:soulidity_foundation::economics::Config<USD> =sc.take_shared();let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();soulidity_foundation::economics::configure(&mut cfg,&mut admin,0,1000,250,0,@0xf,false);test_scenario::return_shared(cfg);sc.return_to_sender(admin);
    sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(parent);let mut t:Soul=sc.take_from_sender_by_id(child);let clock=sui::clock::create_for_testing(sc.ctx());soul::grant(&mut t,@0x8,1,option::some(1000),0,option::none(),&clock,sc.ctx());sui::clock::destroy_for_testing(clock);let child_app=soul::application_module_id(&t);let extension=growth::install(&mut s,sc.ctx());let rev=standard::revision(&s);standard::nest(&mut s,t,rev);let hash=soul::manifest_hash(&s);let root_hash=standard::manifest_hash(&s);
    let cfg:soulidity_foundation::economics::Config<USD> =sc.take_shared();let clock=sui::clock::create_for_testing(sc.ctx());soulidity_v1::market::list_soul(s,&cfg,101,1000,0,hash,1,&clock,sc.ctx());sui::clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);
    sc.next_tx(@0xc);let mut l:soulidity_market::market::Listing<Soul,USD> =sc.take_shared();let mut cfg:soulidity_foundation::economics::Config<USD> =sc.take_shared();assert!(soul::manifest_standard_hash(&soulidity_v1::market::bundle(&l))==root_hash,0);let _inventory=soulidity_v1::market::bundle_standard(&l);let clock=sui::clock::create_for_testing(sc.ctx());let quote=soulidity_v1::market::soul_quote_hash(&l,&cfg,@0xc);let payment=sui::coin::mint_for_testing<USD>(101,sc.ctx());soulidity_v1::market::buy_soul(&mut l,&mut cfg,0,hash,quote,1,fixtures::h(40),payment,&clock,sc.ctx());sui::clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);test_scenario::return_shared(l);
    sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(parent);assert!(standard::module_count(&s)==3 && soul::bound_count(&s)==1 && growth::events(&s)==0,1);let x=growth::uninstall(&mut s);assert!(object::id(&x)==extension,2);let rev=standard::revision(&s);let t=standard::unnest(&mut s,child,rev);assert!(object::id(&t)==child && soul::application_module_id(&t)==child_app && soul::bound_count(&t)==1 && soul::grant_count(&t)==0 && soul::generation(&t)==1,3);transfer::public_transfer(x,@0xc);transfer::public_transfer(t,@0xc);sc.return_to_sender(s);sc.end();
}
#[test]
fun explicit_handover_clears_known_grants_through_a_foreign_soul(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let parent=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let child=fixtures::mint(&mut sc,21,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(parent);let mut t:Soul=sc.take_from_sender_by_id(child);let clock=sui::clock::create_for_testing(sc.ctx());soul::grant(&mut t,@0x8,1,option::some(1000),0,option::none(),&clock,sc.ctx());sui::clock::destroy_for_testing(clock);
    let (seed,mut foreign)=growth::bare_soul(sc.ctx());let foreign_id=object::id(&foreign);standard::nest(&mut foreign,t,0);let rev=standard::revision(&s);standard::nest(&mut s,foreign,rev);transfer::public_transfer(seed,@0xb);soul::handover(s,@0xc,0);
    sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(parent);let rev=standard::revision(&s);let mut foreign=standard::unnest(&mut s,foreign_id,rev);assert!(standard::descriptor<soul::ApplicationWitness>(&foreign,b"animacraft").is_none(),0);let rev=standard::revision(&foreign);let t=standard::unnest(&mut foreign,child,rev);assert!(soul::grant_count(&t)==0 && soul::generation(&t)==1 && soul::bound_count(&t)==1,1);transfer::public_transfer(t,@0xc);transfer::public_transfer(foreign,@0xc);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=7,location=soulidity_custody::lifecycle)]
fun overly_deep_explicit_handover_rejected_before_transfer(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let parent=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(parent);let (seed,mut branch)=growth::bare_soul(sc.ctx());transfer::public_transfer(seed,@0xb);let mut n=0;while(n < 16){let(seed,mut next)=growth::bare_soul(sc.ctx());transfer::public_transfer(seed,@0xb);standard::nest(&mut next,branch,0);branch=next;n=n+1};let rev=standard::revision(&s);standard::nest(&mut s,branch,rev);soul::handover(s,@0xc,0);sc.end();
}
