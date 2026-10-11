#[test_only]
module soulidity_v1::custody_creation_tests;
use sui::test_scenario::{Self as ts};
use sui::kiosk::{Self,Kiosk};
use soulidity_custody::account::{Self as custody,Account};
#[test]
fun new_pair_can_be_used_then_finalized_in_same_transaction(){let mut s=ts::begin(@0xa);let(mut k,mut a)=custody::new(s.ctx());let kid=object::id(&k);let aid=object::id(&a);custody::assert_access(&mut k,&mut a,s.ctx());assert!(custody::kiosk_id(&a)==kid && custody::owner(&a)==@0xa && custody::has_access_for_testing(&mut k,&a),0);assert!(custody::finalize(k,a,s.ctx())==kid,1);s.next_tx(@0xa);let mut k:Kiosk=s.take_shared_by_id(kid);let mut a:Account=s.take_from_sender_by_id(aid);custody::assert_access(&mut k,&mut a,s.ctx());ts::return_shared(k);s.return_to_sender(a);s.end();}
#[test]
fun create_convenience_persists_same_sealed_account(){let mut s=ts::begin(@0xa);let kid=custody::create(s.ctx());s.next_tx(@0xa);let mut k:Kiosk=s.take_shared_by_id(kid);let mut a:Account=s.take_from_sender();custody::assert_access(&mut k,&mut a,s.ctx());ts::return_shared(k);s.return_to_sender(a);s.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_custody::account)]
fun finalize_rejects_crossed_genuine_pairs(){let mut s=ts::begin(@0xa);let(k1,a1)=custody::new(s.ctx());let(k2,a2)=custody::new(s.ctx());custody::finalize(k1,a2,s.ctx());custody::finalize(k2,a1,s.ctx());s.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_custody::account)]
fun finalize_cannot_change_original_account_owner(){let mut s=ts::begin(@0xa);let(k,a)=custody::new(s.ctx());s.next_tx(@0xb);custody::finalize(k,a,s.ctx());s.end();}
