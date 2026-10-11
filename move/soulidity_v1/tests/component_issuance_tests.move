#[test_only]
module soulidity_v1::component_issuance_tests;
use sui::test_scenario;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_model::policy;
use soulidity_model::components::{Self,Item};
use soulidity_standard::soul::Soul;
use soulidity_foundation::economics::{Self,Config};
public struct ComponentProducer has drop {}
public struct PolicyProducer has drop {}
public struct ForeignProduct has key {id:UID}
fun destroy(p:ForeignProduct){let ForeignProduct{id}=p;id.delete()}

#[test]
fun actual_reserved_free_unit_materializes_once_for_exact_soul(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,91,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let mut p:Product<USD> =sc.take_shared();
    let key=policy::definition_hash(&fixtures::def(b"free",2,10));let before=catalog::issued_count(&p,1,key);let permit=catalog::issue(&mut p,1,key,&s);let preview=*components::preview(&permit);let copied=preview;
    assert!(preview==copied && components::target(&permit)==root && catalog::issued_count(&p,1,key)==before+1,0);
    let (source,item)=components::materialize(permit,root,sc.ctx());let item=item.destroy_some();assert!(source==preview && *components::source(&item)==source && catalog::issued_count(&p,1,key)==before+1,1);
    let id=object::id(&item);transfer::public_transfer(item,@0xb);test_scenario::return_shared(p);sc.return_to_sender(s);sc.next_tx(@0xb);let item:Item=sc.take_from_sender_by_id(id);assert!(object::id(&item)==id,2);sc.return_to_sender(item);sc.end();
}
#[test]
fun reference_reservation_creates_no_free_object(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,92,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let mut p:Product<USD> =sc.take_shared();
    let permit=catalog::issue(&mut p,1,policy::definition_hash(&fixtures::def(b"ref",0,10)),&s);let(source,item)=components::materialize(permit,root,sc.ctx());assert!(policy::rights(&source)==0 && item.is_none(),0);item.destroy_none();test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}
#[test]
fun bound_reservation_creates_no_free_object(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,93,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let mut p:Product<USD> =sc.take_shared();
    let permit=catalog::issue(&mut p,1,policy::definition_hash(&fixtures::def(b"bound",1,10)),&s);let(source,item)=components::materialize(permit,root,sc.ctx());assert!(policy::rights(&source)==1 && item.is_none(),0);item.destroy_none();test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=3,location=soulidity_model::components)]
fun permit_for_one_actual_soul_cannot_materialize_for_another(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,94,0);sc.next_tx(@0xb);let other=fixtures::mint(&mut sc,95,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let mut p:Product<USD> =sc.take_shared();
    let permit=catalog::issue(&mut p,1,policy::definition_hash(&fixtures::def(b"free",2,10)),&s);let(_,item)=components::materialize(permit,other,sc.ctx());item.do!(|i|transfer::public_transfer(i,@0xb));test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::components)]
fun published_version_cannot_authorize_component_from_preview(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,96,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let p:Product<USD> =sc.take_shared();let v=*catalog::published(&p,1);let source=catalog::preview_source(&p,1,policy::definition_hash(&fixtures::def(b"free",2,10)));
    let permit=components::authorize(v,&p,&s,source);let(_,item)=components::materialize(permit,root,sc.ctx());item.do!(|i|transfer::public_transfer(i,@0xb));test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_model::components)]
fun foreign_same_named_marker_cannot_authorize_native_product(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,97,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let p:Product<USD> =sc.take_shared();let source=catalog::preview_source(&p,1,policy::definition_hash(&fixtures::def(b"free",2,10)));
    let permit=components::authorize(ComponentProducer{},&p,&s,source);let(_,item)=components::materialize(permit,root,sc.ctx());item.do!(|i|transfer::public_transfer(i,@0xb));test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=2,location=soulidity_model::components)]
fun own_producer_marker_cannot_reissue_copied_native_source(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,98,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let p:Product<USD> =sc.take_shared();let foreign=ForeignProduct{id:object::new(sc.ctx())};let source=catalog::preview_source(&p,1,policy::definition_hash(&fixtures::def(b"free",2,10)));
    let permit=components::authorize(ComponentProducer{},&foreign,&s,source);let(_,item)=components::materialize(permit,root,sc.ctx());item.do!(|i|transfer::public_transfer(i,@0xb));destroy(foreign);test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}
#[test]
fun genuinely_independent_producer_can_materialize_own_free_component(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,99,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);let p:Product<USD> =sc.take_shared();let cfg:Config<USD> =sc.take_shared();let foreign=ForeignProduct{id:object::new(sc.ctx())};
    let source=policy::source(PolicyProducer{},&foreign,object::id(&foreign),1,1,object::id(&cfg),0,@0xb,catalog::market_policy(&p),economics::primary_policy(&cfg),fixtures::def(b"free",2,10));
    let permit=components::authorize(ComponentProducer{},&foreign,&s,source);let(meta,item)=components::materialize(permit,root,sc.ctx());let item=item.destroy_some();assert!(meta==source && *components::source(&item)==source && policy::source_product(&meta)==object::id(&foreign),0);transfer::public_transfer(item,@0xb);
    destroy(foreign);test_scenario::return_shared(cfg);test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();
}
