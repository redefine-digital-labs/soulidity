#[test_only]
module soulidity_custody::lifecycle_declaration_tests;
use soulidity_standard::soul::{Self,Soul};
use soulidity_custody::lifecycle;
use sui::test_scenario;
public struct SoulProducer has drop {}
public struct Source has key,store{id:UID}
public struct Witness has drop {}
public struct Tool has key,store{id:UID,body:u64}
fun h():vector<u8>{vector::tabulate!(32,|_|1)}
fun new(ctx:&mut TxContext):Soul{let p=Source{id:object::new(ctx)};let s=soul::creation_raw_for_testing(soul::new(SoulProducer{},&p,1,h(),std::string::utf8(b"source"),ctx));transfer::public_transfer(p,ctx.sender());s}
#[test]
fun source_removable_intent_is_preserved_without_changing_physical_protection(){let mut sc=test_scenario::begin(@0xa);let mut s=new(sc.ctx());lifecycle::install_protected(&mut s,Witness{},b"logical-true",Tool{id:object::new(sc.ctx()),body:1},1,true,h(),0);lifecycle::install_protected(&mut s,Witness{},b"logical-false",Tool{id:object::new(sc.ctx()),body:2},1,false,h(),1);let a=soul::descriptor<Witness>(&s,b"logical-true").destroy_some();let b=soul::descriptor<Witness>(&s,b"logical-false").destroy_some();assert!(!soul::removable(&a) && !soul::removable(&b),0);assert!(lifecycle::protected_removable_intent(&s,&a)==option::some(true) && lifecycle::protected_removable_intent(&s,&b)==option::some(false),1);assert!(lifecycle::handover_required(&s,&a) && lifecycle::handover_required(&s,&b) && soul::module_count(&s)==2,2);let before=soul::module_annotation(&s,&a);let (mut v,e)=soul::begin_update<Witness,Tool>(&mut s,Witness{},b"logical-true",2);v.body=3;soul::commit_update(&mut s,e,Witness{},v,1,h());let after=soul::descriptor<Witness>(&s,b"logical-true").destroy_some();assert!(soul::module_annotation(&s,&after)==before && lifecycle::protected_removable_intent(&s,&after)==option::some(true),3);assert!(soul::updated_revision(&soul::module_version(&s,&after).destroy_some())==3,4);transfer::public_transfer(s,@0xa);sc.end();}
#[test,expected_failure(abort_code=12,location=soulidity_custody::lifecycle)]
fun unknown_empty_root_topology_cannot_begin_future_handover(){let mut sc=test_scenario::begin(@0xa);let mut s=new(sc.ctx());soul::remove_nesting_version_for_testing(&mut s);let h=lifecycle::begin_handover(s);lifecycle::finish_handover(h,@0xb);sc.end();}
#[test,expected_failure(abort_code=12,location=soulidity_custody::lifecycle)]
fun unknown_topology_after_snapshot_cannot_finish_even_when_empty(){let mut sc=test_scenario::begin(@0xa);let s=new(sc.ctx());let mut h=lifecycle::begin_handover(s);soul::remove_nesting_version_for_testing(lifecycle::handover_raw_mut_for_testing(&mut h));lifecycle::finish_handover(h,@0xb);sc.end();}
