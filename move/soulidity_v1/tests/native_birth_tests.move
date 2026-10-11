#[test_only]
module soulidity_v1::native_birth_tests;
use sui::test_scenario::{Self,Scenario};
use sui::kiosk::{Self,Kiosk,KioskOwnerCap};
use sui::transfer_policy;
use sui::clock;
use std::string::{Self,String};
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_native::registry::{Self,Registry};
use soulidity_native::birth;
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
use soulidity_content::founding_library;
use soulidity_content::state_configuration;
use soulidity_content::authorization;
use soulidity_content_kinds::content_kind_registry::KindRegistry;
use soulidity_v1::fixtures::USD;
fun nonce():vector<u8>{vector::tabulate!(16,|_|9)}
fun setup():(Scenario,ID){
    let mut sc=test_scenario::begin(@0xa);economics::init_for_testing(sc.ctx());sc.next_tx(@0xa);let a:Authority=sc.take_from_sender();
    let cfg=soulidity_v1::native_binding::create_enabled_for_testing<USD>(&a,1000,250,0,@0xf,sc.ctx());sc.return_to_sender(a);sc.next_tx(@0xa);
    let mut cfg:Config<USD> =sc.take_shared_by_id(cfg);let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut admin,rev,hash,false);
    let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);let id=registry::create_for_testing(&mut cfg,&mut admin,rev,hash,sc.ctx());
    let rev=economics::revision(&cfg);let hash=economics::commitment(&cfg);economics::set_enabled(&mut cfg,&mut admin,rev,hash,true);
    test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);(sc,id)
}
public struct SourceNFT has key,store {id:UID}
fun run_case(name:String,royalty:u16,keys:vector<String>,values:vector<vector<u8>>,doc:bool,memory:bool,read:u64){run_mode(name,royalty,keys,values,doc,memory,read,0)}
fun run_mode(name:String,royalty:u16,keys:vector<String>,values:vector<vector<u8>>,doc:bool,memory:bool,read:u64,mode:u8){
    let(mut sc,registry_id)=setup();soulidity_content_kinds::content_kind_registry::init_for_testing(sc.ctx());soulidity_v1::storage_fixture::initialize(&mut sc);
    let mut r:Registry=sc.take_shared_by_id(registry_id);let cfg:Config<USD> =sc.take_shared();let(mut k,mut account)=soulidity_custody::account::new(sc.ctx());
    soulidity_v1::native_creation::register(&mut r,&cfg,&mut k,&mut account,sc.ctx());
    let source=SourceNFT{id:object::new(sc.ctx())};let source_id=object::id(&source);
    assert!(soulidity_v1::native_creation::place_source(&r,&cfg,&mut k,&mut account,source,sc.ctx())==source_id,14);
    let content=registry::expected_content_id(&r,@0xb,nonce());let claim=if(mode==0)soulidity_v1::native_creation::prepare_native(&mut r,&cfg,&mut k,&mut account,nonce(),content,sc.ctx()) else if(mode==1)soulidity_v1::native_creation::prepare_imported(&mut r,&cfg,&mut k,&mut account,string::utf8(b"declared-only"),nonce(),content,sc.ctx()) else soulidity_v1::native_creation::prepare_joined<USD,SourceNFT>(&mut r,&cfg,&mut k,&mut account,source_id,string::utf8(b"declared-only"),nonce(),content,sc.ctx());
    let clock=clock::create_for_testing(sc.ctx());
    let mut draft=soulidity_v1::native_creation::begin(claim,&mut r,&cfg,&mut k,&mut account,name,string::utf8(b"exact description"),string::utf8(b"ipfs://exact-image"),royalty,keys,values,&clock,sc.ctx());
    let root_id=birth::draft_soul_id(&draft);assert!(birth::draft_content_id(&draft)==content,0);
    let mut system:walrus::system::System=sc.take_shared();let kinds:KindRegistry=sc.take_shared();
    vector[0u32,1u32].do!(|kind|{
        if((kind==0 && doc) || (kind==1 && memory)){
            let blob=soulidity_v1::storage_fixture::blob(&mut system,kind as u256,false,true,sc.ctx());
            let label=if(kind==0)soulidity_content::document::soul_doc_name() else soulidity_content::document::memory_name();
            birth::append_initial(&mut draft,&kinds,kind,label,read,0,blob,&system,vector::tabulate!(32,|_|kind as u8),nonce(),b"founding-envelope",0,false,&clock,sc.ctx());
        }
    });
    let(policy,policy_cap)=transfer_policy::new_for_testing<Soul>(sc.ctx());
    // Genuine fresh terminal custody consumes Account and Kiosk. Inspect only after delivery.
    let kiosk_id=object::id(&k);
    let issued=soulidity_v1::native_creation::finish_fresh(draft,&r,&cfg,k,account,&policy,&system,sc.ctx());
    transfer::public_share_object(policy);transfer::public_transfer(policy_cap,@0xb);sc.next_tx(@0xb);let mut k:Kiosk=sc.take_shared_by_id(kiosk_id);let account:soulidity_custody::account::Account=sc.take_from_sender();
    assert!(issued==root_id && kiosk::is_locked(&k,root_id),1);
    let root=soulidity_custody::account::borrow_for_testing<Soul>(&mut k,&account,root_id,sc.ctx());let state=birth::state(root);let library=birth::content(state);
    assert!(*standard::name(root)==name && birth::description(state)==&string::utf8(b"exact description") && birth::image(state)==&string::utf8(b"ipfs://exact-image"),2);
    assert!(birth::royalty(state)==royalty && birth::creator(state)==@0xb && birth::protocol(state)==object::id(&cfg),3);
    assert!(object::id(library)==content && founding_library::root(library)==root_id && founding_library::count(library)==2,4);
    assert!(authorization::module_root(birth::authorization(state))==root_id && authorization::generation(birth::authorization(state))==0 && authorization::count(birth::authorization(state))==0,5);
    assert!(state_configuration::root(birth::configuration(state))==root_id && birth::mint_nonce(state)==nonce(),6);
    let provenance=birth::provenance(state);assert!(registry::kind(&provenance)==mode && !registry::verified_import(&provenance),10);
    assert!(kiosk::has_item_with_type<SourceNFT>(&k,source_id),11);if(mode==2)assert!(registry::joined_id(&registry::joined(&provenance).destroy_some())==source_id && registry::source_joined(&r,source_id),12);
    let origin=standard::origin(root);assert!(standard::source(&origin)==registry_id && standard::minted_by(&origin)==@0xb,7);
    let issuer=birth::issuer(state);
    assert!(economics::source_revision<USD,Registry>(&cfg)==option::some(issuer)
        && standard::source_version(&origin)==soulidity_foundation::source_authority::version(&issuer),13);
    let descriptor=standard::descriptor<birth::NativeModule>(root,b"native").destroy_some();
    assert!(!standard::removable(&descriptor) && standard::module_id(&descriptor)==object::id(state) && standard::semantic_hash(&descriptor)==birth::commitment(state),8);
    if(state_configuration::contains(birth::configuration(state),string::utf8(b"duplicate"))){
        assert!(*state_configuration::value(birth::configuration(state),string::utf8(b"duplicate"))==b"first",9)
    };
    test_scenario::return_shared(k);sc.return_to_sender(account);
    test_scenario::return_shared(kinds);soulidity_v1::storage_fixture::return_system(system);clock::destroy_for_testing(clock);test_scenario::return_shared(r);test_scenario::return_shared(cfg);sc.end();
}
#[test]
fun full_birth_real_DOF_contents_locked_registered_kiosk(){run_case(string::utf8(b"Native OC"),9750,vector[],vector[],true,true,3)}
#[test]
fun empty_original_name_is_preserved(){run_case(string::utf8(b""),0,vector[],vector[],true,true,3)}
#[test]
fun original_name_over_128_and_32768_bytes_is_preserved(){run_case(string::utf8(vector::tabulate!(33000,|_|97)),50,vector[],vector[],true,true,3)}
#[test]
fun original_reverse_config_duplicate_first_wins(){run_case(string::utf8(b"config"),0,vector[string::utf8(b"duplicate"),string::utf8(b"duplicate")],vector[b"first",b"second"],true,true,3)}
#[test,expected_failure(abort_code=3,location=soulidity_native::birth)]
fun combined_royalty_over_10000_rejects(){run_case(string::utf8(b"royalty"),9751,vector[],vector[],true,true,3)}
#[test,expected_failure(abort_code=4,location=soulidity_native::birth)]
fun mismatched_config_vectors_reject(){run_case(string::utf8(b"config"),0,vector[string::utf8(b"k")],vector[],true,true,3)}
#[test,expected_failure(abort_code=4,location=soulidity_content::state_configuration)]
fun reserved_initial_config_cannot_masquerade_as_envelope(){run_case(string::utf8(b"config"),0,vector[string::utf8(b"content_seal_envelope_v1:fake")],vector[b"fake"],true,true,3)}
#[test,expected_failure(abort_code=1,location=soulidity_content::state_configuration)]
fun empty_initial_key_rejects(){run_case(string::utf8(b"config"),0,vector[string::utf8(b"")],vector[b"value"],true,true,3)}
#[test,expected_failure(abort_code=2,location=soulidity_content::founding_library)]
fun no_memory_cannot_finish_visible_soul(){run_case(string::utf8(b"missing memory"),0,vector[],vector[],true,false,3)}
#[test,expected_failure(abort_code=2,location=soulidity_content::founding_library)]
fun no_document_cannot_finish_visible_soul(){run_case(string::utf8(b"missing doc"),0,vector[],vector[],false,true,3)}

#[test]
fun imported_birth_preserves_unverified_origin(){run_mode(string::utf8(b"imported"),9750,vector[],vector[],true,true,3,1)}
#[test]
fun joined_birth_preserves_actual_original_asset(){run_mode(string::utf8(b"joined"),9750,vector[string::utf8(b"setting")],vector[b"value"],true,true,3,2)}
#[test]
fun imported_birth_with_initial_configuration(){run_mode(string::utf8(b"imported configured"),9750,vector[string::utf8(b"setting")],vector[b"value"],true,true,3,1)}
#[test]
fun joined_birth_without_initial_configuration(){run_mode(string::utf8(b"joined plain"),9750,vector[],vector[],true,true,3,2)}
