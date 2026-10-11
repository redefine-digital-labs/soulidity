#[test_only]
module soulidity_v1::installation_tests;
use sui::test_scenario::{Self,Scenario};
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
use soulidity_v1::native_binding;
use soulidity_native_binder::native_binding::Catalog;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_foundation::revenue;
public struct ForgedRole has drop {}
fun setup():Scenario{
    let mut s=test_scenario::begin(@0xa);economics::init_for_testing(s.ctx());s.next_tx(@0xa);
    let auth:Authority=s.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,1000,500,3,@0xf,s.ctx());s.return_to_sender(auth);s.next_tx(@0xa);s
}
fun permit(c:&Config<USD>,a:&mut Admin,value:&Catalog<USD>):economics::Installation<USD,Catalog<USD>>{
    native_binding::installation_for_testing(c,a,economics::revision(c),economics::commitment(c),value)
}
#[test]
fun real_private_role_permit_consumes_once_and_commits_installation_atomically(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let root=object::id(&c);
    let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=permit(&c,&mut a,&value);let id=object::id(&value);let hash=native_binding::commitment(&value);
    economics::install_native(&mut c,&mut a,ticket,value,0,hash);native_binding::assert_current(&c);
    assert!(object::id(&c)==root && economics::revision(&c)==1 && !economics::enabled(&c) && object::id(native_binding::current(&c))==id,0);
    assert!(revenue::root(economics::income(&c))==root && revenue::balance(economics::income(&c))==0,1);
    test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun arbitrary_role_with_actual_admin_cannot_authorize(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let h=economics::commitment(&c);
    let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=economics::authorize_installation<USD,ForgedRole,bool,Catalog<USD>>(&c,&mut a,0,h,0,ForgedRole{},true,&value,0,native_binding::commitment(&value));
    let hash=native_binding::commitment(&value);economics::install_native(&mut c,&mut a,ticket,value,0,hash);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun primitive_witness_with_actual_admin_cannot_authorize(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let h=economics::commitment(&c);
    let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=economics::authorize_installation<USD,bool,bool,Catalog<USD>>(&c,&mut a,0,h,0,true,true,&value,0,native_binding::commitment(&value));
    let hash=native_binding::commitment(&value);economics::install_native(&mut c,&mut a,ticket,value,0,hash);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun second_permit_from_same_snapshot_cannot_replace_after_first_install(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let value=native_binding::catalog_for_testing(&c,0,s.ctx());let second=native_binding::catalog_for_testing(&c,1,s.ctx());let one=permit(&c,&mut a,&value);let two=permit(&c,&mut a,&second);
    let hash=native_binding::commitment(&value);economics::install_native(&mut c,&mut a,one,value,0,hash);
    let hash=native_binding::commitment(&second);economics::install_native(&mut c,&mut a,two,second,1,hash);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun config_mutation_invalidates_prepared_permit(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=permit(&c,&mut a,&value);
    economics::configure(&mut c,&mut a,0,900,500,3,@0xf,true);
    let hash=native_binding::commitment(&value);economics::install_native(&mut c,&mut a,ticket,value,0,hash);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun native_permit_cannot_install_a_release_binding(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=permit(&c,&mut a,&value);
    let hash=native_binding::commitment(&value);economics::install_release(&mut c,&mut a,ticket,value,0,hash);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun permit_cannot_cross_config_even_with_both_real_admins(){
    let mut s=setup();let c:Config<USD> = s.take_shared();let root=object::id(&c);test_scenario::return_shared(c);
    let a:Admin=s.take_from_sender();let aid=object::id(&a);s.return_to_sender(a);
    let auth:Authority=s.take_from_sender();let other_id=soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,0,0,0,@0xe,s.ctx());s.return_to_sender(auth);s.next_tx(@0xa);
    let c:Config<USD> = s.take_shared_by_id(root);let mut a:Admin=s.take_from_sender_by_id(aid);
    let bid=s.ids_for_sender<Admin>().filter!(|i|*i!=aid).pop_back();let mut b:Admin=s.take_from_sender_by_id(bid);
    let mut other:Config<USD> = s.take_shared_by_id(other_id);
    let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=permit(&c,&mut a,&value);let hash=native_binding::commitment(&value);economics::install_native(&mut other,&mut b,ticket,value,0,hash);
    test_scenario::return_shared(c);test_scenario::return_shared(other);s.return_to_sender(a);s.return_to_sender(b);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun install_checks_actual_admin_again_after_permit_creation(){
    let mut s=setup();let c:Config<USD> = s.take_shared();let root=object::id(&c);test_scenario::return_shared(c);let a:Admin=s.take_from_sender();let original_admin=object::id(&a);s.return_to_sender(a);
    let auth:Authority=s.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,0,0,0,@0xe,s.ctx());s.return_to_sender(auth);s.next_tx(@0xa);
    let mut c:Config<USD> = s.take_shared_by_id(root);let mut a:Admin=s.take_from_sender_by_id(original_admin);let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=permit(&c,&mut a,&value);
    let other=s.ids_for_sender<Admin>().filter!(|i|*i!=original_admin).pop_back();let mut other:Admin=s.take_from_sender_by_id(other);
    let hash=native_binding::commitment(&value);economics::install_native(&mut c,&mut other,ticket,value,0,hash);test_scenario::return_shared(c);s.return_to_sender(a);s.return_to_sender(other);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun prepared_permit_cannot_substitute_another_real_catalog_id(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();
    let original=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=permit(&c,&mut a,&original);
    let other=native_binding::catalog_for_testing(&c,0,s.ctx());let hash=native_binding::commitment(&other);
    transfer::public_transfer(original,@0xa);economics::install_native(&mut c,&mut a,ticket,other,0,hash);
    test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun prepared_permit_cannot_rewrite_generation(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();
    let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=permit(&c,&mut a,&value);let hash=native_binding::commitment(&value);
    economics::install_native(&mut c,&mut a,ticket,value,1,hash);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun prepared_permit_cannot_rewrite_directory_commitment(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();
    let value=native_binding::catalog_for_testing(&c,0,s.ctx());let ticket=permit(&c,&mut a,&value);
    economics::install_native(&mut c,&mut a,ticket,value,0,fixtures::h(99));test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
