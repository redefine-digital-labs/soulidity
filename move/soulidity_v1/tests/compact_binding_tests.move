#[test_only]
module soulidity_v1::compact_binding_tests;
use sui::test_scenario::{Self,Scenario};
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::character;
use soulidity_model::{assembly,components,policy};
use soulidity_v1::fixtures;

fun issued():(Scenario,Soul){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,210,0);
    sc.next_tx(@0xb);let root:Soul=sc.take_from_sender_by_id(id);(sc,root)
}
#[test]
fun all_three_rights_keep_exact_source_views_with_small_stored_slots(){
    let(sc,s)=issued();let mut i=0u8;
    vector[b"ref",b"bound",b"free"].do_ref!(|part|{
        let b=character::binding(&s,*part).destroy_some();let source=character::binding_source(&b);
        assert!(policy::rights(source)==i,0);
        assert!(policy::source_definition_hash(source)==policy::definition_hash(&fixtures::def(*part,i,10)),1);
        assert!(character::binding_layout(&b)==fixtures::layout(),2);
        let stored=character::stored_binding_bytes_for_testing(&s,assembly::root_part(*part));
        assert!(stored<=100 && stored*3 < std::bcs::to_bytes(&b).length(),3);i=i+1
    });
    assert!(character::reference_count(&s)==1 && character::bound_count(&s)==1,4);
    sc.return_to_sender(s);sc.end();
}
#[test]
fun free_locator_follows_real_original_item_custody_and_preserves_genesis(){
    let(sc,mut s)=issued();let id=object::id(&s);let origin=standard::origin(&s);
    let genesis=std::bcs::to_bytes(character::original_output(&s));
    let binding=character::binding(&s,b"free").destroy_some();let source=*character::binding_source(&binding);
    let item_id=character::free_id(&binding).destroy_some();let item=character::detach(&mut s,b"free",0);
    assert!(object::id(&item)==item_id && *components::source(&item)==source && character::binding(&s,b"free").is_none(),0);
    assert!(std::bcs::to_bytes(character::original_output(&s))==genesis,1);
    character::attach(&mut s,item,b"free",fixtures::layout(),1);
    let binding=character::binding(&s,b"free").destroy_some();
    assert!(character::free_id(&binding)==option::some(item_id) && *character::binding_source(&binding)==source,2);
    assert!(object::id(&s)==id && standard::origin(&s)==origin && std::bcs::to_bytes(character::original_output(&s))==genesis,3);
    sc.return_to_sender(s);sc.end();
}
#[test]
fun permanent_reference_and_bound_locators_survive_unmount_and_remount(){
    let(sc,mut s)=issued();let reference=*character::binding_source(&character::binding(&s,b"ref").destroy_some());
    let bound=*character::binding_source(&character::binding(&s,b"bound").destroy_some());
    let genesis=std::bcs::to_bytes(character::original_output(&s));
    character::clear_reference(&mut s,b"ref",0);character::unmount_bound(&mut s,b"bound",1);
    assert!(character::binding(&s,b"ref").is_none() && character::binding(&s,b"bound").is_none(),0);
    assert!(*character::reference_source(&s,0)==reference && *character::bound_source(&s,0)==bound,1);
    character::remount_reference(&mut s,0,b"ref",fixtures::layout(),2);
    character::remount_bound(&mut s,0,b"bound",fixtures::layout(),3);
    assert!(*character::binding_source(&character::binding(&s,b"ref").destroy_some())==reference,2);
    assert!(*character::binding_source(&character::binding(&s,b"bound").destroy_some())==bound,3);
    assert!(character::reference_count(&s)==1 && character::bound_count(&s)==1 && std::bcs::to_bytes(character::original_output(&s))==genesis,4);
    sc.return_to_sender(s);sc.end();
}
#[test]
fun tuning_changes_layout_without_copying_or_changing_source(){
    let(sc,mut s)=issued();let source=*character::binding_source(&character::binding(&s,b"free").destroy_some());
    let stored=character::stored_binding_bytes_for_testing(&s,assembly::root_part(b"free"));
    let layout=policy::layout(false,3,true,2,1000000,0,vector[]);
    character::tune(&mut s,b"free",layout,0);let binding=character::binding(&s,b"free").destroy_some();
    assert!(character::binding_layout(&binding)==layout && *character::binding_source(&binding)==source,0);
    assert!(character::stored_binding_bytes_for_testing(&s,assembly::root_part(b"free"))==stored,1);
    sc.return_to_sender(s);sc.end();
}
