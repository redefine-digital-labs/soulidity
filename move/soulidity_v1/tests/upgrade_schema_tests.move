#[test_only]
module soulidity_v1::upgrade_schema_tests;
use sui::test_scenario;
use soulidity_v1::fixtures;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::character::{Self,ApplicationWitness};
use soulidity_application::forms;
#[test]
fun fresh_application_uses_semantic_schema_three(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,31,0);sc.next_tx(@0xb);
    let s:Soul=sc.take_from_sender_by_id(id);
    assert!(standard::module_schema(&standard::descriptor<ApplicationWitness>(&s,b"animacraft").destroy_some())==3,0);
    sc.return_to_sender(s);sc.end();
}
#[test]
#[expected_failure(abort_code=10,location=soulidity_standard::soul)]
fun old_application_writer_cannot_commit_schema_one(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,32,0);sc.next_tx(@0xb);
    let mut s:Soul=sc.take_from_sender_by_id(id);character::previous_schema_commit_for_testing(&mut s);
    sc.return_to_sender(s);sc.end();
}
#[test]
fun fresh_forms_journal_uses_semantic_schema_two(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,33,0);sc.next_tx(@0xb);
    let mut s:Soul=sc.take_from_sender_by_id(id);let sr=standard::revision(&s);let ar=character::revision(&s);
    forms::save(&mut s,b"base",option::none(),0,0,sr,ar,sc.ctx());
    assert!(standard::module_schema(&standard::descriptor<forms::Witness>(&s,b"forms").destroy_some())==2,0);
    sc.return_to_sender(s);sc.end();
}
#[test]
#[expected_failure(abort_code=10,location=soulidity_standard::soul)]
fun old_forms_writer_cannot_commit_schema_one(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,34,0);sc.next_tx(@0xb);
    let mut s:Soul=sc.take_from_sender_by_id(id);let sr=standard::revision(&s);let ar=character::revision(&s);
    forms::save(&mut s,b"base",option::none(),0,0,sr,ar,sc.ctx());forms::previous_schema_commit_for_testing(&mut s);
    sc.return_to_sender(s);sc.end();
}
