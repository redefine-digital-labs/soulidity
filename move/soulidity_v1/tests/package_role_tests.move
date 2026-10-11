#[test_only]
module soulidity_v1::package_role_tests;
use sui::test_scenario::{Self,Scenario};
use sui::package;
use soulidity_foundation::package_roles;
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
use soulidity_v1::native_binding;
use soulidity_v1::fixtures::{Self,USD};
fun setup():Scenario {
    let mut s=test_scenario::begin(@0xa);economics::init_for_testing(s.ctx());s.next_tx(@0xa);
    let authority:Authority=s.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&authority,0,0,0,@0xf,s.ctx());s.return_to_sender(authority);s.next_tx(@0xa);s
}
fun install(c:&mut Config<USD>,a:&mut Admin,ctx:&mut TxContext){let rev=economics::revision(c);let h=economics::commitment(c);native_binding::install(c,a,rev,h,ctx);}
#[test]
fun installation_pins_role_and_role_freeze_commits_without_changing_income_or_binding(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let original=economics::role(&c,0);assert!(!package_roles::pinned(&original),0);
    install(&mut c,&mut a,s.ctx());let old=economics::commitment(&c);let binding=economics::native_snapshot(&c);let root=soulidity_foundation::revenue::root(economics::income(&c));
    economics::freeze_role(&mut c,&mut a,1,old,0);let role=economics::role(&c,0);
    assert!(package_roles::pinned(&role) && package_roles::frozen(&role) && package_roles::original(&role)==package_roles::original(&original) && package_roles::callable(&role)==package_roles::callable(&original),1);
    assert!(economics::revision(&c)==2 && economics::commitment(&c)!=old && binding==economics::native_snapshot(&c) && soulidity_foundation::revenue::root(economics::income(&c))==root,2);
    native_binding::assert_current(&c);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun role_freeze_invalidates_prepared_installation_snapshot(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();install(&mut c,&mut a,s.ctx());
    let value=native_binding::catalog_for_testing(&c,1,s.ctx());let h=native_binding::commitment(&value);let p=native_binding::installation_for_testing(&c,&mut a,1,economics::commitment(&c),&value);
    let h=economics::commitment(&c);economics::freeze_role(&mut c,&mut a,1,h,0);economics::install_native(&mut c,&mut a,p,value,1,h);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
#[test,expected_failure(abort_code=3,location=soulidity_foundation::package_roles)]
fun never_installed_role_cannot_be_frozen(){let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let h=economics::commitment(&c);economics::freeze_role(&mut c,&mut a,0,h,0);test_scenario::return_shared(c);s.return_to_sender(a);s.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun enabled_config_cannot_edit_role(){let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();install(&mut c,&mut a,s.ctx());let h=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,1,h,true);let h=economics::commitment(&c);economics::freeze_role(&mut c,&mut a,2,h,0);test_scenario::return_shared(c);s.return_to_sender(a);s.end();}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun stale_revision_cannot_edit_role(){let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();install(&mut c,&mut a,s.ctx());let h=economics::commitment(&c);economics::freeze_role(&mut c,&mut a,0,h,0);test_scenario::return_shared(c);s.return_to_sender(a);s.end();}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::package_roles)]
fun real_publisher_cannot_register_with_unrelated_upgrade_cap(){let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();let p=native_binding::publisher_for_testing(s.ctx());let cap=package::test_publish(@0x11.to_id(),s.ctx());let h=economics::commitment(&c);native_binding::register(&mut c,&mut a,0,h,&p,&cap);package::burn_publisher(p);package::make_immutable(cap);test_scenario::return_shared(c);s.return_to_sender(a);s.end();}
#[test]
fun role_freeze_does_not_block_same_role_catalog_replacement_or_admin_fund_exit(){
    let mut s=setup();let mut c:Config<USD> = s.take_shared();let mut a:Admin=s.take_from_sender();install(&mut c,&mut a,s.ctx());let h=economics::commitment(&c);economics::freeze_role(&mut c,&mut a,1,h,0);install(&mut c,&mut a,s.ctx());
    let h=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,3,h,true);economics::deposit_income(&mut c,sui::coin::mint_for_testing<USD>(10,s.ctx()));
    let h=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,4,h,false);economics::withdraw_income(&mut c,&mut a,1,10,@0xa,fixtures::h(99),s.ctx());
    assert!(soulidity_foundation::revenue::balance(economics::income(&c))==0 && package_roles::frozen(&economics::role(&c,0)) && native_binding::generation(native_binding::current(&c))==1,0);test_scenario::return_shared(c);s.return_to_sender(a);s.end();
}
