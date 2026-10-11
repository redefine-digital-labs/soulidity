#[test_only]
module soulidity_custody::collection;
use soulidity_custody::lifecycle;
use sui::test_scenario;
use sui::kiosk;
use sui::transfer_policy;
use soulidity_standard::soul::{Self,Soul};
use soulidity_custody::account;
use soulidity_foundation::economics::{Self,Config,Admin};
use private_source::producer;
public struct CollectionAuthority1 has drop {}
public struct CollectionRevision1 has drop {}
public struct WrongAuthority has drop {}
public struct CoinType has drop {}
fun config(ctx:&mut TxContext):(Config<CoinType>,Admin){
    let(mut cfg,mut admin)=economics::new_config_for_testing<CoinType>(0,0,0,@0xf,ctx);
    economics::pin_initial_role_for_testing(&mut cfg,&mut admin,4,CollectionAuthority1{},CollectionRevision1{});(cfg,admin)
}
#[test]
fun canonical_collection_borrow_preserves_role4_and_soul_identity(){
    let mut sc=test_scenario::begin(@0xa);let(cfg,admin)=config(sc.ctx());let(mut k,a)=account::new(sc.ctx());let ki=object::id(&k);let ai=object::id(&a);let p=producer::create(sc.ctx());
    let c=lifecycle::new(producer::witness_for_testing(),&p,producer::request<Soul>(&p,0,sc.ctx()),sc.ctx());let root=lifecycle::construction_id(&c);let origin=soul::origin(lifecycle::construction_ref(&c));let(policy,pc)=transfer_policy::new_for_testing<Soul>(sc.ctx());
    let auth=producer::complete(&p,lifecycle::construction_ref(&c),lifecycle::construction_snapshot(&c),sc.ctx());account::deliver_locked_account(c,auth,&mut k,a,&policy,sc.ctx());
    transfer::public_share_object(k);economics::share_config_for_testing(cfg,admin,sc.ctx());transfer::public_share_object(policy);transfer::public_transfer(pc,@0xa);transfer::public_transfer(p,@0xa);
    sc.next_tx(@0xa);let cfg:Config<CoinType> =sc.take_shared();let mut k:sui::kiosk::Kiosk=sc.take_shared_by_id(ki);let a:account::Account=sc.take_from_sender_by_id(ai);
    let s=account::borrow_for_collection<CoinType,CollectionAuthority1,CollectionRevision1,Soul>(&cfg,CollectionAuthority1{},CollectionRevision1{},&mut k,&a,root,sc.ctx());assert!(object::id(s)==root && soul::origin(s)==origin,0);
    test_scenario::return_shared(cfg);test_scenario::return_shared(k);sc.return_to_sender(a);sc.end();
}
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun foreign_same_name_soul_refused_after_valid_role4(){
    let mut sc=test_scenario::begin(@0xa);let(cfg,admin)=config(sc.ctx());let(mut k,a)=account::new(sc.ctx());let id=object::id(&k);
    account::borrow_for_collection<CoinType,CollectionAuthority1,CollectionRevision1,foreign_soul::soul::Soul>(&cfg,CollectionAuthority1{},CollectionRevision1{},&mut k,&a,id,sc.ctx());
    account::finalize(k,a,sc.ctx());economics::share_config_for_testing(cfg,admin,sc.ctx());sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::package_roles)]
fun canonical_soul_borrow_refuses_wrong_role4_witness(){
    let mut sc=test_scenario::begin(@0xa);let(cfg,admin)=config(sc.ctx());let(mut k,a)=account::new(sc.ctx());let id=object::id(&k);
    account::borrow_for_collection<CoinType,WrongAuthority,CollectionRevision1,Soul>(&cfg,WrongAuthority{},CollectionRevision1{},&mut k,&a,id,sc.ctx());
    account::finalize(k,a,sc.ctx());economics::share_config_for_testing(cfg,admin,sc.ctx());sc.end();
}
