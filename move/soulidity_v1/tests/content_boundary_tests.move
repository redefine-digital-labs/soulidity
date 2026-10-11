#[test_only]
module soulidity_v1::content_boundary_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_application::character as app;
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_standard::soul::{Self,Soul};
use soulidity_content::authorization;
use soulidity_content::loadout;
use soulidity_content::paid_access;
public struct ContentOperator has drop {}
public struct Carrier has key,store {id:UID}
fun setup():(Scenario,Soul,Clock){let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,81,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let c=clock::create_for_testing(sc.ctx());(sc,s,c)}
fun end(mut sc:Scenario,s:Soul,c:Clock){clock::destroy_for_testing(c);sc.return_to_sender(s);sc.end();}
#[test]
fun own_controller_can_manage_own_ledger_without_native_grant(){
    let(mut sc,s,c)=setup();let parent=Carrier{id:object::new(sc.ctx())};let mut a=authorization::new(ContentOperator{},&parent,&s,sc.ctx());
    let seq=authorization::issue(ContentOperator{},&mut a,@0x8,2,option::none(),option::none(),&c,sc.ctx());
    assert!(seq==0 && authorization::module_root(&a)==object::id(&s) && authorization::permits(ContentOperator{},&a,@0xb,@0x8,2,&c),0);
    assert!(app::grant_record(&s,@0x8).is_none() && app::generation(&s)==0,1);
    authorization::clear(ContentOperator{},&mut a);assert!(!authorization::permits(ContentOperator{},&a,@0xb,@0x8,2,&c) && authorization::generation(&a)==1,2);
    transfer::public_transfer(a,@0xb);transfer::public_transfer(parent,@0xb);end(sc,s,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun foreign_same_named_operator_cannot_read_native_grant(){
    let(mut sc,mut s,c)=setup();app::grant(&mut s,@0x8,2,option::none(),0,option::none(),&c,sc.ctx());
    assert!(authorization::permits(ContentOperator{},app::authorization(&s),@0xb,@0x8,2,&c),0);end(sc,s,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun copied_grant_is_not_native_operator(){
    let(mut sc,mut s,c)=setup();app::grant(&mut s,@0x8,2,option::none(),0,option::none(),&c,sc.ctx());let copied=app::grant_record(&s,@0x8).destroy_some();
    assert!(authorization::permits(copied,app::authorization(&s),@0xb,@0x8,2,&c),0);end(sc,s,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun native_application_cannot_be_claimed_by_foreign_operator(){
    let(mut sc,s,c)=setup();let app=soul::borrow_module<app::ApplicationWitness,app::ApplicationState>(&s,b"animacraft");let a=authorization::new(ContentOperator{},app,&s,sc.ctx());transfer::public_transfer(a,@0xb);end(sc,s,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun public_same_module_catalog_version_is_not_content_operator(){
    let(mut sc,s,c)=setup();let p:Product<USD> =sc.take_shared();let v=*catalog::published(&p,1);let a=authorization::new(v,&p,&s,sc.ctx());transfer::public_transfer(a,@0xb);test_scenario::return_shared(p);end(sc,s,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun primitive_operator_rejected_at_authority_boundary(){
    let(mut sc,s,c)=setup();let parent=Carrier{id:object::new(sc.ctx())};let a=authorization::new(1u64,&parent,&s,sc.ctx());transfer::public_transfer(a,@0xb);transfer::public_transfer(parent,@0xb);end(sc,s,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun native_library_namespace_alone_does_not_approve_read(){
    let(sc,s,c)=setup();let library=app::loadouts(&s);let id=loadout::seal_id(library,@0xb,app::generation(&s));loadout::approve(ContentOperator{},id,library,@0xb,app::generation(&s));end(sc,s,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_content::authority)]
fun native_paid_read_rejects_foreign_operator_before_entry_lookup(){
    let(sc,s,c)=setup();paid_access::assert_access(ContentOperator{},app::paid_access(&s),3,@0x8,@0xb,app::generation(&s),8,&c);end(sc,s,c)
}
fun role_setup():Scenario{let mut sc=test_scenario::begin(@0xa);soulidity_foundation::economics::init_for_testing(sc.ctx());sc.next_tx(@0xa);let a:soulidity_foundation::economics::Authority=sc.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&a,0,0,0,@0xf,sc.ctx());sc.return_to_sender(a);sc.next_tx(@0xa);sc}
#[test]
fun actual_content_publisher_cap_registers_paid_role_independently(){
    let mut sc=role_setup();let mut cfg:soulidity_foundation::economics::Config<USD> =sc.take_shared();let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();let core_before=soulidity_foundation::economics::role(&cfg,2);
    let p=paid_access::publisher_for_testing(sc.ctx());let package=object::id_from_address(std::type_name::defining_id<soulidity_content::paid_access::PaidRevision1>());let cap=sui::package::test_publish(package,sc.ctx());
    let hash=soulidity_foundation::economics::commitment(&cfg);paid_access::register(&mut cfg,&mut admin,0,hash,&p,&cap);
    let role=soulidity_foundation::economics::role(&cfg,5);assert!(soulidity_foundation::package_roles::pinned(&role) && soulidity_foundation::package_roles::original(&role)==object::id_from_address(std::type_name::original_id<soulidity_content::paid_access::PaidAuthority1>()) && soulidity_foundation::package_roles::callable(&role)==package && soulidity_foundation::economics::role(&cfg,2)==core_before && soulidity_foundation::economics::revision(&cfg)==1,0);
    sui::package::burn_publisher(p);sui::package::make_immutable(cap);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.end();
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::package_roles)]
fun core_publisher_cannot_register_content_paid_role(){
    let mut sc=role_setup();let mut cfg:soulidity_foundation::economics::Config<USD> =sc.take_shared();let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();let p=soulidity_v1::native_binding::publisher_for_testing(sc.ctx());let cap=sui::package::test_publish(object::id_from_address(std::type_name::defining_id<soulidity_content::paid_access::PaidRevision1>()),sc.ctx());let h=soulidity_foundation::economics::commitment(&cfg);paid_access::register(&mut cfg,&mut admin,0,h,&p,&cap);sui::package::burn_publisher(p);sui::package::make_immutable(cap);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.end();
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::package_roles)]
fun content_publisher_with_core_cap_cannot_register_paid_role(){
    let mut sc=role_setup();let mut cfg:soulidity_foundation::economics::Config<USD> =sc.take_shared();let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();let p=paid_access::publisher_for_testing(sc.ctx());let cap=sui::package::test_publish(object::id_from_address(std::type_name::defining_id<soulidity_native_binder::native_binding::NativeRevision2>()),sc.ctx());let h=soulidity_foundation::economics::commitment(&cfg);paid_access::register(&mut cfg,&mut admin,0,h,&p,&cap);sui::package::burn_publisher(p);sui::package::make_immutable(cap);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.end();
}
