#[test_only]
module soulidity_v1::account_source_exit_tests;
use soulidity_custody::lifecycle;
use sui::test_scenario::{Self,Scenario};
use sui::kiosk::{Self,Kiosk};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::custody;
use soulidity_custody::account::{Self as leaf,Account};
use soulidity_application::character::{Self as app};
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_foundation::economics::{Self,Config,Admin};
use account_source_handler::handler;
fun setup():(Scenario,Kiosk,Account,Soul,Config<USD>) {
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,89,0);sc.next_tx(@0xb);
    let s:Soul=sc.take_from_sender_by_id(id);let cfg:Config<USD> =sc.take_shared();let(k,a)=leaf::new(sc.ctx());let kid=leaf::finalize(k,a,sc.ctx());sc.next_tx(@0xb);let k:Kiosk=sc.take_shared_by_id(kid);let a:Account=sc.take_from_sender();(sc,k,a,s,cfg)
}
fun done(mut sc:Scenario,k:Kiosk,a:Account,s:Soul,cfg:Config<USD>) {
    sc.return_to_sender(s);test_scenario::return_shared(cfg);test_scenario::return_shared(k);sc.return_to_sender(a);sc.end();
}
fun roundtrip(sc:&mut Scenario,k:&mut Kiosk,a:&mut Account,s:Soul,cfg:&Config<USD>):Soul {
    let id=object::id(&s);custody::deposit_soul(k,a,s,cfg,0,sc.ctx());custody::withdraw_soul(k,a,id,1,sc.ctx());sc.next_tx(@0xb);sc.take_from_sender_by_id(id)
}
#[test]
fun actual_owner_roundtrip_preserves_root_and_clears_all_grants() {
    let(mut sc,mut k,mut a,mut s,cfg)=setup();let id=object::id(&s);let origin=standard::origin(&s);let clock=sui::clock::create_for_testing(sc.ctx());
    app::grant(&mut s,@0xe,1,option::none(),0,option::none(),&clock,sc.ctx());custody::deposit_soul(&mut k,&mut a,s,&cfg,1,sc.ctx());
    let stored=leaf::borrow_for_testing<Soul>(&mut k,&a,id,sc.ctx());assert!(app::generation(stored)==1 && app::grant_count(stored)==0,0);
    custody::withdraw_soul(&mut k,&mut a,id,2,sc.ctx());sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);
    assert!(object::id(&s)==id && standard::origin(&s)==origin && app::generation(&s)==2 && app::grant_count(&s)==0 && !kiosk::has_item(&k,id),1);
    sui::clock::destroy_for_testing(clock);done(sc,k,a,s,cfg)
}
#[test]
fun disabled_paused_config_still_allows_original_exit() {
    let(mut sc,mut k,mut a,s,mut cfg)=setup();let id=object::id(&s);custody::deposit_soul(&mut k,&mut a,s,&cfg,0,sc.ctx());
    sc.next_tx(@0xa);let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut admin,rev,hash,false);
    let rev=economics::revision(&cfg);economics::configure(&mut cfg,&mut admin,rev,1000,500,0,@0xf,true);sc.return_to_sender(admin);sc.next_tx(@0xb);
    custody::withdraw_soul(&mut k,&mut a,id,1,sc.ctx());sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);assert!(app::generation(&s)==2 && !kiosk::has_item(&k,id),0);done(sc,k,a,s,cfg)
}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_application_revision_cannot_deposit() {let(mut sc,mut k,mut a,s,cfg)=setup();let id=object::id(&s);custody::deposit_soul(&mut k,&mut a,s,&cfg,1,sc.ctx());custody::withdraw_soul(&mut k,&mut a,id,1,sc.ctx());test_scenario::return_shared(cfg);leaf::finalize(k,a,sc.ctx());sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_application_revision_cannot_exit() {let(mut sc,mut k,mut a,s,cfg)=setup();let id=object::id(&s);custody::deposit_soul(&mut k,&mut a,s,&cfg,0,sc.ctx());custody::withdraw_soul(&mut k,&mut a,id,0,sc.ctx());test_scenario::return_shared(cfg);leaf::finalize(k,a,sc.ctx());sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_custody::account)]
fun wrong_sender_cannot_begin_exit() {let(mut sc,mut k,mut a,s,cfg)=setup();let id=object::id(&s);custody::deposit_soul(&mut k,&mut a,s,&cfg,0,sc.ctx());sc.next_tx(@0xc);custody::withdraw_soul(&mut k,&mut a,id,1,sc.ctx());test_scenario::return_shared(cfg);leaf::finalize(k,a,sc.ctx());sc.end();}
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun wrong_pair_cannot_begin_deposit() {let(mut sc,k,mut a,s,cfg)=setup();let(mut other,b)=leaf::new(sc.ctx());custody::deposit_soul(&mut other,&mut a,s,&cfg,0,sc.ctx());leaf::finalize(other,b,sc.ctx());leaf::finalize(k,a,sc.ctx());test_scenario::return_shared(cfg);sc.end();}
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun installed_foreign_source_cannot_take_app_deposited_root() {let(mut sc,mut k,mut a,mut s,cfg)=setup();handler::install(&mut s,sc.ctx());let id=object::id(&s);let mut h=app::begin_account_deposit(&mut k,&mut a,s,&cfg,0,sc.ctx());handler::acknowledge(leaf::handover_mut(&mut h));app::finish_account_deposit(&mut k,&mut a,h,sc.ctx());handler::attempt_foreign_withdraw(&mut k,&mut a,id,sc.ctx());test_scenario::return_shared(cfg);leaf::finalize(k,a,sc.ctx());sc.end();}
#[test]
fun independent_private_source_ack_composes_same_owner_exit() {let(mut sc,mut k,mut a,mut s,cfg)=setup();handler::install(&mut s,sc.ctx());let id=object::id(&s);let mut h=app::begin_account_deposit(&mut k,&mut a,s,&cfg,0,sc.ctx());handler::acknowledge(leaf::handover_mut(&mut h));app::finish_account_deposit(&mut k,&mut a,h,sc.ctx());let mut h=app::begin_account_withdraw(&mut k,&mut a,id,1,sc.ctx());handler::acknowledge(leaf::handover_mut(&mut h));app::finish_account_withdraw(&mut k,&mut a,h,sc.ctx());sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);assert!(object::id(&s)==id && handler::generation(&s)==2 && app::generation(&s)==2,0);done(sc,k,a,s,cfg)}
#[test,expected_failure(abort_code=12,location=soulidity_custody::lifecycle)]
fun missing_foreign_ack_cannot_finish_exit() {let(mut sc,mut k,mut a,mut s,cfg)=setup();handler::install(&mut s,sc.ctx());let id=object::id(&s);let mut h=app::begin_account_deposit(&mut k,&mut a,s,&cfg,0,sc.ctx());handler::acknowledge(leaf::handover_mut(&mut h));app::finish_account_deposit(&mut k,&mut a,h,sc.ctx());custody::withdraw_soul(&mut k,&mut a,id,1,sc.ctx());test_scenario::return_shared(cfg);leaf::finalize(k,a,sc.ctx());sc.end();}
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun session_cannot_finish_against_different_account_pair() {let(mut sc,mut k,mut a,s,cfg)=setup();let h=app::begin_account_deposit(&mut k,&mut a,s,&cfg,0,sc.ctx());let(mut other,mut b)=leaf::new(sc.ctx());app::finish_account_deposit(&mut other,&mut b,h,sc.ctx());leaf::finalize(other,b,sc.ctx());leaf::finalize(k,a,sc.ctx());test_scenario::return_shared(cfg);sc.end();}
#[test,expected_failure(abort_code=12,location=soulidity_custody::lifecycle)]
fun mutation_after_app_ack_requires_new_source_ack() {let(mut sc,mut k,mut a,s,cfg)=setup();let mut h=app::begin_account_deposit(&mut k,&mut a,s,&cfg,0,sc.ctx());app::clear_authorizations(lifecycle::handover_raw_mut_for_testing(leaf::handover_mut(&mut h)));app::finish_account_deposit(&mut k,&mut a,h,sc.ctx());test_scenario::return_shared(cfg);leaf::finalize(k,a,sc.ctx());sc.end();}

#[test]
fun nested_only_independent_private_handler_composes_original_exit() {
    let(mut sc,mut k,mut a,mut s,cfg)=setup();
    let(seed,mut child)=soulidity_v1::standard_extension_fixture::bare_soul(sc.ctx());handler::install(&mut child,sc.ctx());let child_id=object::id(&child);
    let id=object::id(&s);let rev=standard::revision(&s);standard::nest(&mut s,child,rev);
    let mut h=app::begin_account_deposit(&mut k,&mut a,s,&cfg,0,sc.ctx());handler::acknowledge(leaf::handover_mut(&mut h));app::finish_account_deposit(&mut k,&mut a,h,sc.ctx());
    let mut h=app::begin_account_withdraw(&mut k,&mut a,id,1,sc.ctx());handler::acknowledge(leaf::handover_mut(&mut h));app::finish_account_withdraw(&mut k,&mut a,h,sc.ctx());
    sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);assert!(object::id(standard::nested(&s,child_id))==child_id && handler::generation(standard::nested(&s,child_id))==2,0);
    transfer::public_transfer(seed,@0xb);done(sc,k,a,s,cfg)
}

/// Existing fixture models noncurrent callable identity, not a published upgrade.
#[test]
fun simulated_noncurrent_callable_preserves_disabled_paused_exit() {
    let(mut sc,mut k,mut a,s,mut cfg)=setup();let id=object::id(&s);custody::deposit_soul(&mut k,&mut a,s,&cfg,0,sc.ctx());
    economics::drift_callable_for_testing(&mut cfg);
    assert!(economics::callable_package(&cfg)==object::id_from_address(@0x99),0);
    sc.next_tx(@0xa);let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut admin,rev,hash,false);
    let rev=economics::revision(&cfg);economics::configure(&mut cfg,&mut admin,rev,1000,500,0,@0xf,true);sc.return_to_sender(admin);sc.next_tx(@0xb);
    custody::withdraw_soul(&mut k,&mut a,id,1,sc.ctx());sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);assert!(object::id(&s)==id && app::generation(&s)==2,1);done(sc,k,a,s,cfg)
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun simulated_noncurrent_callable_rejects_current_business() {
    let(mut sc,k,a,s,mut cfg)=setup();economics::drift_callable_for_testing(&mut cfg);
    assert!(economics::callable_package(&cfg)==object::id_from_address(@0x99),0);
    soulidity_v1::catalog::create_maker(&cfg,500,sc.ctx());done(sc,k,a,s,cfg)
}

#[test,expected_failure(abort_code=1,location=soulidity_custody::account)]
fun changed_sender_cannot_finish_started_session() {
    let(mut sc,mut k,mut a,s,cfg)=setup();let h=app::begin_account_deposit(&mut k,&mut a,s,&cfg,0,sc.ctx());
    sc.next_tx(@0xc);app::finish_account_deposit(&mut k,&mut a,h,sc.ctx());
    test_scenario::return_shared(cfg);test_scenario::return_shared(k);sc.return_to_sender(a);sc.end();
}
