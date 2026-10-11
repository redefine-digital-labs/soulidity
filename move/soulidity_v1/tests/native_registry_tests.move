#[test_only]
module soulidity_v1::native_registry_tests;
use sui::test_scenario::{Self,Scenario};
use sui::kiosk::{Self,Kiosk,KioskOwnerCap};
use std::string;
use std::type_name;
use soulidity_native::registry::{Self,Registry};
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
use soulidity_v1::fixtures::USD;
public struct NFT has key,store {id:UID}
public struct WrongNFT has key,store {id:UID}
public struct Impostor has drop {}
public struct ContentOperator has drop {}
public struct Carrier has key,store {id:UID}
fun nonce(n:u8):vector<u8>{vector::tabulate!(16,|_|n)}
fun setup():(Scenario,ID){
    let mut sc=test_scenario::begin(@0xa);economics::init_for_testing(sc.ctx());sc.next_tx(@0xa);let a:Authority=sc.take_from_sender();
    let cfg=soulidity_v1::native_binding::create_enabled_for_testing<USD>(&a,1000,250,0,@0xf,sc.ctx());sc.return_to_sender(a);sc.next_tx(@0xa);
    let mut cfg:Config<USD> =sc.take_shared_by_id(cfg);let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut admin,rev,hash,false);
    let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);let id=registry::create_for_testing(&mut cfg,&mut admin,rev,hash,sc.ctx());
    assert!(economics::source_registry_id<USD,Registry>(&cfg)==id,0);let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut admin,rev,hash,true);
    test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);(sc,id)
}
fun register(sc:&mut Scenario,r:&mut Registry,cfg:&Config<USD>):(Kiosk,KioskOwnerCap){let(mut k,c)=kiosk::new(sc.ctx());registry::register_personal_kiosk(r,cfg,&mut k,&c,sc.ctx());(k,c)}
fun finish(sc:Scenario,r:Registry,cfg:Config<USD>,k:Kiosk,c:KioskOwnerCap){transfer::public_share_object(k);transfer::public_transfer(c,sc.sender());test_scenario::return_shared(r);test_scenario::return_shared(cfg);sc.end();}

#[test]
fun canonical_directory_and_stable_typed_nonce_identity(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg:Config<USD> =sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);registry::register_personal_kiosk(&mut r,&cfg,&mut k,&c,sc.ctx());
    let expected=registry::expected_content_id(&r,@0xb,nonce(1));assert!(expected!=registry::expected_content_id(&r,@0xc,nonce(1)) && expected!=registry::expected_content_id(&r,@0xb,nonce(2)),0);
    let claim=registry::prepare_native(&mut r,&cfg,&mut k,&c,nonce(1),expected,sc.ctx());assert!(registry::claim_content_id(&claim)==expected && registry::kind(&registry::claim_provenance(&claim))==0,1);
    let(actual,_)=registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());assert!(actual==expected && registry::content_id_claimed(&r,@0xb,nonce(1)),2);finish(sc,r,cfg,k,c)
}
#[test]
fun import_text_stays_unverified_and_preserves_exact_origin(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg=sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);let expected=registry::expected_content_id(&r,@0xb,nonce(1));let text=string::utf8(b"somewhere:unverified");
    let claim=registry::prepare_imported(&mut r,&cfg,&mut k,&c,text,nonce(1),expected,sc.ctx());let(_,p)=registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());
    assert!(registry::kind(&p)==1 && registry::declared_origin(&p)==option::some(text) && !registry::verified_import(&p) && registry::joined(&p).is_none(),0);finish(sc,r,cfg,k,c)
}
#[test]
fun joined_claim_checks_actual_asset_type_and_preserves_source(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg=sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);let it=NFT{id:object::new(sc.ctx())};let source=object::id(&it);kiosk::place(&mut k,&c,it);
    let expected=registry::expected_content_id(&r,@0xb,nonce(1));let claim=registry::prepare_joined<USD,NFT>(&mut r,&cfg,&mut k,&c,source,string::utf8(b"declared"),nonce(1),expected,sc.ctx());let(_,p)=registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());let joined=registry::joined(&p).destroy_some();
    assert!(registry::kind(&p)==2 && registry::joined_id(&joined)==source && registry::joined_type(&joined)==type_name::with_defining_ids<NFT>() && !registry::verified_import(&p),0);
    assert!(kiosk::has_item_with_type<NFT>(&k,source) && registry::source_joined(&r,source),1);finish(sc,r,cfg,k,c)
}
#[test,expected_failure(abort_code=4,location=soulidity_native::registry)]
fun deleted_content_uid_cannot_reset_nonce(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg=sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);let expected=registry::expected_content_id(&r,@0xb,nonce(1));
    let first=registry::prepare_native(&mut r,&cfg,&mut k,&c,nonce(1),expected,sc.ctx());let(_,_) =registry::consume_for_testing(first,&mut r,&cfg,&mut k,&c,sc.ctx());
    let second=registry::prepare_native(&mut r,&cfg,&mut k,&c,nonce(1),expected,sc.ctx());let(_,_) =registry::consume_for_testing(second,&mut r,&cfg,&mut k,&c,sc.ctx());finish(sc,r,cfg,k,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_native::registry)]
fun wrong_expected_content_id_rejects_claim(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg=sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);
    let claim=registry::prepare_native(&mut r,&cfg,&mut k,&c,nonce(1),object::id_from_address(@0xdead),sc.ctx());let(_,_) =registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());finish(sc,r,cfg,k,c)
}
#[test,expected_failure(abort_code=4,location=soulidity_native::registry)]
fun invalid_nonce_length_rejected(){let(mut sc,id)=setup();let r:Registry=sc.take_shared_by_id(id);let _=registry::expected_content_id(&r,@0xb,b"short");test_scenario::return_shared(r);sc.end();}
#[test,expected_failure(abort_code=5,location=soulidity_native::registry)]
fun wrong_source_type_rejected(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg=sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);let it=NFT{id:object::new(sc.ctx())};let source=object::id(&it);kiosk::place(&mut k,&c,it);let expected=registry::expected_content_id(&r,@0xb,nonce(1));
    let claim=registry::prepare_joined<USD,WrongNFT>(&mut r,&cfg,&mut k,&c,source,string::utf8(b""),nonce(1),expected,sc.ctx());let(_,_) =registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());finish(sc,r,cfg,k,c)
}
#[test,expected_failure(abort_code=3,location=soulidity_native::registry)]
fun unregistered_actual_kiosk_rejected(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg=sc.take_shared();let(mut k,c)=kiosk::new(sc.ctx());let expected=registry::expected_content_id(&r,@0xb,nonce(1));
    let claim=registry::prepare_native(&mut r,&cfg,&mut k,&c,nonce(1),expected,sc.ctx());let(_,_) =registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());finish(sc,r,cfg,k,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun existing_canonical_registry_cannot_be_reinstalled(){
    let(mut sc,_)=setup();sc.next_tx(@0xa);let mut cfg:Config<USD> =sc.take_shared();let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut admin,rev,hash,false);let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);let _=registry::create_for_testing(&mut cfg,&mut admin,rev,hash,sc.ctx());test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun foreign_marker_cannot_claim_native_registry_slot(){
    let(mut sc,_)=setup();sc.next_tx(@0xa);let mut cfg:Config<USD> =sc.take_shared();let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut admin,rev,hash,false);let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);
    let r:Registry=sc.take_shared();let _=economics::register_source_registry<USD,Impostor,Registry>(&mut cfg,&mut admin,Impostor{},&r,rev,hash);test_scenario::return_shared(r);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.end();
}
#[test,expected_failure(abort_code=5,location=soulidity_native::registry)]
fun source_remains_joined_after_transfer_to_another_registered_wallet(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg:Config<USD> =sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);let it=NFT{id:object::new(sc.ctx())};let source=object::id(&it);kiosk::place(&mut k,&c,it);
    let expected=registry::expected_content_id(&r,@0xb,nonce(1));let claim=registry::prepare_joined<USD,NFT>(&mut r,&cfg,&mut k,&c,source,string::utf8(b"first"),nonce(1),expected,sc.ctx());let(_,_) =registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());
    let original=kiosk::take<NFT>(&mut k,&c,source);transfer::public_transfer(original,@0xc);transfer::public_share_object(k);transfer::public_transfer(c,@0xb);test_scenario::return_shared(r);test_scenario::return_shared(cfg);sc.next_tx(@0xc);
    let mut r:Registry=sc.take_shared_by_id(id);let cfg:Config<USD> =sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);let original:NFT=sc.take_from_sender_by_id(source);kiosk::place(&mut k,&c,original);let expected=registry::expected_content_id(&r,@0xc,nonce(2));
    let claim=registry::prepare_joined<USD,NFT>(&mut r,&cfg,&mut k,&c,source,string::utf8(b"second"),nonce(2),expected,sc.ctx());let(_,_) =registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());finish(sc,r,cfg,k,c)
}
#[test,expected_failure(abort_code=3,location=soulidity_native::registry)]
fun another_kiosk_cap_does_not_authorize_registration(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg:Config<USD> =sc.take_shared();let(mut k,c)=kiosk::new(sc.ctx());let(other,wrong)=kiosk::new(sc.ctx());
    registry::register_personal_kiosk(&mut r,&cfg,&mut k,&wrong,sc.ctx());transfer::public_share_object(other);transfer::public_transfer(wrong,@0xb);finish(sc,r,cfg,k,c)
}
#[test,expected_failure(abort_code=2,location=soulidity_native::registry)]
fun cap_possession_cannot_impersonate_kiosk_owner(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg:Config<USD> =sc.take_shared();let(mut k,c)=kiosk::new(sc.ctx());kiosk::set_owner_custom(&mut k,&c,@0xc);
    registry::register_personal_kiosk(&mut r,&cfg,&mut k,&c,sc.ctx());finish(sc,r,cfg,k,c)
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun source_claims_stop_when_primary_is_disabled(){
    let(mut sc,id)=setup();let mut r:Registry=sc.take_shared_by_id(id);let cfg:Config<USD> =sc.take_shared();let(k,c)=register(&mut sc,&mut r,&cfg);let kiosk_id=object::id(&k);let cap_id=object::id(&c);
    transfer::public_share_object(k);transfer::public_transfer(c,@0xb);test_scenario::return_shared(r);test_scenario::return_shared(cfg);
    sc.next_tx(@0xa);let mut cfg:Config<USD> =sc.take_shared();let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_primary_enabled(&mut cfg,&mut admin,rev,hash,false);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);
    let mut r:Registry=sc.take_shared_by_id(id);let cfg:Config<USD> =sc.take_shared();let mut k:Kiosk=sc.take_shared_by_id(kiosk_id);let c:KioskOwnerCap=sc.take_from_sender_by_id(cap_id);let expected=registry::expected_content_id(&r,@0xb,nonce(1));let claim=registry::prepare_native(&mut r,&cfg,&mut k,&c,nonce(1),expected,sc.ctx());let(_,_) =registry::consume_for_testing(claim,&mut r,&cfg,&mut k,&c,sc.ctx());test_scenario::return_shared(k);sc.return_to_sender(c);test_scenario::return_shared(r);test_scenario::return_shared(cfg);sc.end();
}
#[test]
fun actual_registry_claim_constructs_same_derived_content_object(){
    let(mut sc,id)=setup();soulidity_content_kinds::content_kind_registry::init_for_testing(sc.ctx());soulidity_v1::storage_fixture::initialize(&mut sc);
    let mut r:Registry=sc.take_shared_by_id(id);let cfg:Config<USD> =sc.take_shared();let(mut k,c)=register(&mut sc,&mut r,&cfg);
    let expected=registry::expected_content_id(&r,@0xb,nonce(1));let claim=registry::prepare_native(&mut r,&cfg,&mut k,&c,nonce(1),expected,sc.ctx());
    assert!(registry::content_id_claimed(&r,@0xb,nonce(1)) && !registry::actual_content_allocated(&r,@0xb,nonce(1)),0);
    let root=registry::new_root_for_testing(&r,&cfg,vector::tabulate!(32,|_|9),string::utf8(b"Native OC"),sc.ctx());let parent=Carrier{id:object::new(sc.ctx())};
    let(mut f,_,_)=registry::begin_content_for_testing(claim,&mut r,&cfg,&mut k,&c,ContentOperator{},&parent,&root,sc.ctx());
    assert!(soulidity_content::founding_library::pending_id(&f)==expected && registry::actual_content_allocated(&r,@0xb,nonce(1)),1);
    let mut sys:walrus::system::System=sc.take_shared();let clock=sui::clock::create_for_testing(sc.ctx());let kinds:soulidity_content_kinds::content_kind_registry::KindRegistry=sc.take_shared();
    vector[0u32,1u32].do!(|kind|{
        let blob=soulidity_v1::storage_fixture::blob(&mut sys,kind as u256,false,true,sc.ctx());let name=if(kind==0)soulidity_content::document::soul_doc_name() else soulidity_content::document::memory_name();
        soulidity_content::founding_library::append_initial(ContentOperator{},&mut f,&kinds,kind,name,3,0,blob,&sys,vector::tabulate!(32,|_|kind as u8),nonce(1),b"founding-envelope",0,false,&clock,sc.ctx());
    });
    let content=soulidity_content::founding_library::finish(ContentOperator{},f,&sys,sc.ctx());assert!(object::id(&content)==expected && soulidity_content::founding_library::root(&content)==object::id(&root),2);
    transfer::public_transfer(content,@0xb);transfer::public_transfer(parent,@0xb);transfer::public_transfer(root,@0xb);test_scenario::return_shared(kinds);soulidity_v1::storage_fixture::return_system(sys);sui::clock::destroy_for_testing(clock);finish(sc,r,cfg,k,c)
}
