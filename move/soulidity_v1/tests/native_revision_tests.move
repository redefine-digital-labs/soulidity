/// Unit type-domain transitions are not actual package-upgrade proofs.
#[test_only]
module soulidity_v1::native_revision_tests;
use sui::test_scenario::{Self,Scenario};
use sui::kiosk::{Self,Kiosk,KioskOwnerCap};
use sui::package;
use soulidity_native::registry::{Self,Registry};
use soulidity_native::birth;
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
use soulidity_foundation::source_authority;
use soulidity_foundation::revenue;
use soulidity_v1::fixtures::USD;
fun nonce():vector<u8>{vector::tabulate!(16,|_|8)}
fun setup():(Scenario,Registry,Config<USD>,Admin){
    let mut s=test_scenario::begin(@0xa);economics::init_for_testing(s.ctx());s.next_tx(@0xa);
    let a:Authority=s.take_from_sender();let id=soulidity_v1::native_binding::create_enabled_for_testing<USD>(&a,1000,250,0,@0xf,s.ctx());s.return_to_sender(a);s.next_tx(@0xa);
    let mut c:Config<USD> =s.take_shared_by_id(id);let mut a:Admin=s.take_from_sender();
    let h=economics::commitment(&c);let rev=economics::revision(&c);economics::set_enabled(&mut c,&mut a,rev,h,false);
    let h=economics::commitment(&c);let rev=economics::revision(&c);let r=registry::create_for_testing(&mut c,&mut a,rev,h,s.ctx());
    let h=economics::commitment(&c);let rev=economics::revision(&c);economics::set_enabled(&mut c,&mut a,rev,h,true);
    test_scenario::return_shared(c);s.return_to_sender(a);s.next_tx(@0xa);
    let r:Registry=s.take_shared_by_id(r);let c:Config<USD> =s.take_shared_by_id(id);let a:Admin=s.take_from_sender();(s,r,c,a)
}
fun register(s:&mut Scenario,r:&mut Registry,c:&Config<USD>):(Kiosk,KioskOwnerCap){let(mut k,cap)=kiosk::new(s.ctx());registry::register_personal_kiosk(r,c,&mut k,&cap,s.ctx());(k,cap)}
fun disable(c:&mut Config<USD>,a:&mut Admin){let rev=economics::revision(c);let h=economics::commitment(c);economics::set_enabled(c,a,rev,h,false)}
fun rotate(r:&Registry,c:&mut Config<USD>,a:&mut Admin){disable(c,a);let rev=economics::revision(c);let h=economics::commitment(c);registry::advance_revision_for_testing(r,c,a,rev,h);let rev=economics::revision(c);let h=economics::commitment(c);economics::set_enabled(c,a,rev,h,true)}
fun done(s:Scenario,r:Registry,c:Config<USD>,a:Admin){test_scenario::return_shared(r);test_scenario::return_shared(c);s.return_to_sender(a);s.end();}
fun return_kiosk(k:Kiosk,cap:KioskOwnerCap){transfer::public_share_object(k);transfer::public_transfer(cap,@0xa)}

#[test]
fun model_rotation_pins_current_marker_and_preserves_actual_business_authority(){
    let(s,r,mut c,mut a)=setup();let old=economics::source_revision<USD,Registry>(&c).destroy_some();
    let cfg=object::id(&c);let id=object::id(&r);let native_binding=economics::native_snapshot(&c);let root=revenue::root(economics::income(&c));
    let balance=revenue::balance(economics::income(&c));let ledger_rev=revenue::revision(economics::income(&c));
    let roles=vector::tabulate!(6,|i|economics::role(&c,i as u8));
    disable(&mut c,&mut a);let rev=economics::revision(&c);let h=economics::commitment(&c);
    registry::advance_revision_for_testing(&r,&mut c,&mut a,rev,h);
    let current=economics::source_revision<USD,Registry>(&c).destroy_some();registry::assert_advanced_revision_for_testing(&c);
    assert!(source_authority::version(&old)==1 && source_authority::version(&current)==2 && source_authority::marker(&old)!=source_authority::marker(&current),0);
    assert!(economics::revision(&c)==rev+1 && economics::commitment(&c)!=h && !economics::enabled(&c),1);
    assert!(object::id(&c)==cfg && economics::source_registry_id<USD,Registry>(&c)==id && native_binding==economics::native_snapshot(&c),2);
    assert!(revenue::root(economics::income(&c))==root && revenue::balance(economics::income(&c))==balance && revenue::revision(economics::income(&c))==ledger_rev,3);
    assert!(roles==vector::tabulate!(6,|i|economics::role(&c,i as u8)) && economics::primary_enabled(&c) && economics::secondary_enabled(&c),4);done(s,r,c,a)
}
#[test]
fun prepared_claim_captures_actual_current_issuer(){
    let(mut s,mut r,c,a)=setup();let(mut k,cap)=register(&mut s,&mut r,&c);let id=registry::expected_content_id(&r,@0xa,nonce());
    let claim=registry::prepare_native(&mut r,&c,&mut k,&cap,nonce(),id,s.ctx());
    assert!(option::some(registry::claim_issuer(&claim))==economics::source_revision<USD,Registry>(&c),0);
    let(_,_) =registry::consume_for_testing(claim,&mut r,&c,&mut k,&cap,s.ctx());return_kiosk(k,cap);done(s,r,c,a)
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::source_authority)]
fun obsolete_prepare_is_rejected_after_model_rotation(){
    let(mut s,mut r,mut c,mut a)=setup();let(mut k,cap)=register(&mut s,&mut r,&c);rotate(&r,&mut c,&mut a);
    let id=registry::expected_content_id(&r,@0xa,nonce());let claim=registry::prepare_native(&mut r,&c,&mut k,&cap,nonce(),id,s.ctx());
    let(_,_) =registry::consume_for_testing(claim,&mut r,&c,&mut k,&cap,s.ctx());return_kiosk(k,cap);done(s,r,c,a)
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::source_authority)]
fun obsolete_root_issuance_is_rejected_after_model_rotation(){
    let(mut s,r,mut c,mut a)=setup();rotate(&r,&mut c,&mut a);
    let root=registry::new_root_for_testing(&r,&c,vector::tabulate!(32,|_|9),std::string::utf8(b"old issuer"),s.ctx());
    transfer::public_transfer(root,@0xa);done(s,r,c,a)
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::source_authority)]
fun old_claim_cannot_be_consumed_after_model_rotation(){
    let(mut s,mut r,mut c,mut a)=setup();let(mut k,cap)=register(&mut s,&mut r,&c);let id=registry::expected_content_id(&r,@0xa,nonce());
    let claim=registry::prepare_native(&mut r,&c,&mut k,&cap,nonce(),id,s.ctx());rotate(&r,&mut c,&mut a);
    let(_,_) =registry::consume_for_testing(claim,&mut r,&c,&mut k,&cap,s.ctx());return_kiosk(k,cap);done(s,r,c,a)
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::source_authority)]
fun old_claim_cannot_begin_birth_after_model_rotation(){
    let(mut s,mut r,mut c,mut a)=setup();let(mut k,cap)=register(&mut s,&mut r,&c);let id=registry::expected_content_id(&r,@0xa,nonce());
    let claim=registry::prepare_native(&mut r,&c,&mut k,&cap,nonce(),id,s.ctx());rotate(&r,&mut c,&mut a);let clock=sui::clock::create_for_testing(s.ctx());
    let d=birth::begin(claim,&mut r,&c,&mut k,&cap,std::string::utf8(b"old"),std::string::utf8(b""),std::string::utf8(b""),0,vector[],vector[],&clock,s.ctx());
    let(policy,policy_cap)=sui::transfer_policy::new_for_testing<soulidity_standard::soul::Soul>(s.ctx());soulidity_v1::storage_fixture::initialize(&mut s);
    let sys:walrus::system::System=s.take_shared();birth::finish(d,&r,&c,&mut k,cap,&policy,&sys,s.ctx());
    transfer::public_share_object(policy);transfer::public_transfer(policy_cap,@0xa);soulidity_v1::storage_fixture::return_system(sys);sui::clock::destroy_for_testing(clock);transfer::public_share_object(k);done(s,r,c,a)
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::source_authority)]
fun old_draft_cannot_finish_after_model_rotation(){
    let(mut s,mut r,mut c,mut a)=setup();let(mut k,cap)=register(&mut s,&mut r,&c);let id=registry::expected_content_id(&r,@0xa,nonce());
    let claim=registry::prepare_native(&mut r,&c,&mut k,&cap,nonce(),id,s.ctx());let clock=sui::clock::create_for_testing(s.ctx());
    let d=birth::begin(claim,&mut r,&c,&mut k,&cap,std::string::utf8(b"old"),std::string::utf8(b""),std::string::utf8(b""),0,vector[],vector[],&clock,s.ctx());
    rotate(&r,&mut c,&mut a);let(policy,policy_cap)=sui::transfer_policy::new_for_testing<soulidity_standard::soul::Soul>(s.ctx());soulidity_v1::storage_fixture::initialize(&mut s);
    let sys:walrus::system::System=s.take_shared();birth::finish(d,&r,&c,&mut k,cap,&policy,&sys,s.ctx());
    transfer::public_share_object(policy);transfer::public_transfer(policy_cap,@0xa);soulidity_v1::storage_fixture::return_system(sys);sui::clock::destroy_for_testing(clock);transfer::public_share_object(k);done(s,r,c,a)
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun enabled_source_revision_cannot_be_rotated(){let(s,r,mut c,mut a)=setup();let rev=economics::revision(&c);let h=economics::commitment(&c);registry::advance_revision_for_testing(&r,&mut c,&mut a,rev,h);done(s,r,c,a)}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun stale_revision_cannot_rotate_source(){let(s,r,mut c,mut a)=setup();disable(&mut c,&mut a);let rev=economics::revision(&c);let h=economics::commitment(&c);registry::advance_revision_for_testing(&r,&mut c,&mut a,rev-1,h);done(s,r,c,a)}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun stale_commitment_cannot_rotate_source(){let(s,r,mut c,mut a)=setup();disable(&mut c,&mut a);let rev=economics::revision(&c);registry::advance_revision_for_testing(&r,&mut c,&mut a,rev,vector::tabulate!(32,|_|0));done(s,r,c,a)}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun same_revision_marker_cannot_be_reinstalled(){let(s,r,mut c,mut a)=setup();disable(&mut c,&mut a);let rev=economics::revision(&c);let h=economics::commitment(&c);registry::advance_revision_for_testing(&r,&mut c,&mut a,rev,h);let rev=economics::revision(&c);let h=economics::commitment(&c);registry::advance_revision_for_testing(&r,&mut c,&mut a,rev,h);done(s,r,c,a)}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun wrong_admin_cannot_rotate_source(){
    let(mut s,r,mut c,mut a)=setup();disable(&mut c,&mut a);let(other,mut wrong)=economics::new_config_for_testing<USD>(0,0,0,@0xf,s.ctx());
    let rev=economics::revision(&c);let h=economics::commitment(&c);registry::advance_revision_for_testing(&r,&mut c,&mut wrong,rev,h);
    economics::share_config_for_testing(other,wrong,s.ctx());done(s,r,c,a)
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::source_authority)]
fun real_module_publisher_with_unrelated_upgrade_cap_is_rejected(){
    let(mut s,r,mut c,mut a)=setup();disable(&mut c,&mut a);let p=registry::publisher_for_testing(s.ctx());let cap=package::test_publish(@0x11.to_id(),s.ctx());
    let rev=economics::revision(&c);let h=economics::commitment(&c);registry::register_revision(&r,&mut c,&mut a,rev,h,&p,&cap);
    package::burn_publisher(p);package::make_immutable(cap);done(s,r,c,a)
}
public struct SourceNFT has key,store {id:UID}
#[test,expected_failure(abort_code=5,location=soulidity_native::registry)]
fun generic_source_placement_cannot_bypass_Soul_handover(){
    let(mut s,mut r,c,a)=setup();let(mut k,cap)=register(&mut s,&mut r,&c);
    let root=registry::new_root_for_testing(&r,&c,vector::tabulate!(32,|_|9),std::string::utf8(b"root"),s.ctx());
    registry::place_source(&r,&c,&mut k,&cap,root,s.ctx());return_kiosk(k,cap);done(s,r,c,a)
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::source_authority)]
fun obsolete_source_placement_is_rejected_after_model_rotation(){
    let(mut s,mut r,mut c,mut a)=setup();let(mut k,cap)=register(&mut s,&mut r,&c);rotate(&r,&mut c,&mut a);
    let source=SourceNFT{id:object::new(s.ctx())};registry::place_source(&r,&c,&mut k,&cap,source,s.ctx());return_kiosk(k,cap);done(s,r,c,a)
}
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun sealed_source_placement_rejects_unrelated_account(){
    let(mut s,mut r,c,a)=setup();let(mut k,mut account)=soulidity_custody::account::new(s.ctx());
    soulidity_v1::native_creation::register(&mut r,&c,&mut k,&mut account,s.ctx());
    let(other,mut wrong)=soulidity_custody::account::new(s.ctx());let source=SourceNFT{id:object::new(s.ctx())};
    soulidity_v1::native_creation::place_source(&r,&c,&mut k,&mut wrong,source,s.ctx());
    soulidity_custody::account::finalize(other,wrong,s.ctx());soulidity_custody::account::finalize(k,account,s.ctx());done(s,r,c,a)
}
