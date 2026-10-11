#[test_only]
module independent_output::tests;
use sui::test_scenario::{Self,Scenario};
use soulidity_standard::soul::{Self,Soul};
use independent_output::extension;
use independent_output::producer;
use independent_output::storage_fixture;
use soulidity_application::output;
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_content::document;
use soulidity_visual::visual;
use walrus::system::System;
fun h(n:u8):vector<u8>{vector::tabulate!(32,|_|n)}
fun setup():(Scenario,Soul,producer::Seed,ID){
    let mut sc=test_scenario::begin(@0xa);kind_registry::init_for_testing(sc.ctx());storage_fixture::initialize(&mut sc);sc.next_tx(@0xa);let mut source=producer::seed(sc.ctx());let mut s=producer::mint_owned_for_testing(&mut source,&mut sc);
    let registry:KindRegistry=sc.take_shared();let scene=visual::scene(32,32,visual::signed(false,0),visual::signed(false,0),0,h(14),b"body",b"pose",vector[b"body"],vector[visual::track(b"main",0,false)],vector[],vector[visual::anchor(b"root",vector[],visual::signed(false,0),visual::signed(false,0))],vector[]);let colors=visual::default_colors(&scene);
    let p=output::policy(b"default",true,b"render",h(14),true,vector[],vector[output::initial_rule(&registry,0,document::soul_doc_name(),3,0),output::initial_rule(&registry,1,document::memory_name(),3,0)]);test_scenario::return_shared(registry);
    let i=output::intent(object::id_from_address(@0x42),object::id(&source),1,h(1),output::policy_hash(&p),@0xa,h(2),b"Independent OC".to_string(),output::recipe_hash(&scene,&colors,vector[]),vector::tabulate!(16,|_|2));
    let mut system:System=sc.take_shared();let blob=storage_fixture::blob(&mut system,231,false,true,sc.ctx());let receipt=output::receipt(vector[],@0xf,0);
    let id=extension::install(&mut s,i,p,vector[],scene,colors,vector[],vector[],blob,&system,h(231),b"encrypted-envelope",receipt,0,sc.ctx());storage_fixture::return_system(system);(sc,s,source,id)
}
fun end(sc:Scenario,s:Soul,source:producer::Seed){transfer::public_transfer(s,sc.sender());transfer::public_transfer(source,sc.sender());sc.end();}
#[test]
fun actual_independent_source_output_and_update_preserve_all_ids(){
    let(sc,mut s,source,id)=setup();let root=object::id(&s);let descriptor=soul::descriptor<extension::ExtensionWitness>(&s,b"genesis-output").destroy_some();let carrier=soul::module_id(&descriptor);let before=soul::manifest_hash(&s);
    assert!(soul::source(&soul::origin(&s))==object::id(&source) && output::root(extension::artifact(&s))==root && output::application_parent(extension::artifact(&s))==carrier && object::id(extension::artifact(&s))==id,0);
    extension::reserve(&mut s,b"card",h(3),1);
    assert!(soul::revision(&s)==2 && object::id(&s)==root && object::id(extension::artifact(&s))==id && soul::module_id(&soul::descriptor<extension::ExtensionWitness>(&s,b"genesis-output").destroy_some())==carrier && soul::manifest_hash(&s)!=before && output::materialization(extension::artifact(&s),b"card")==option::some(h(3)),1);end(sc,s,source)
}
#[test,expected_failure(abort_code=1,location=soulidity_standard::soul)]
fun stale_root_revision_cannot_change_independent_output(){let(sc,mut s,source,_)=setup();extension::reserve(&mut s,b"card",h(3),0);end(sc,s,source)}
#[test]
fun whole_root_transfer_keeps_original_output_and_new_holder_can_read(){
    let(mut sc,s,source,id)=setup();let root=object::id(&s);let namespace=output::render_id(output::artifact_intent(extension::artifact(&s)));transfer::public_transfer(s,@0xb);transfer::public_transfer(source,@0xa);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);let system:System=sc.take_shared();extension::approve_owner(namespace,&mut s,&system);assert!(object::id(extension::artifact(&s))==id,0);storage_fixture::return_system(system);sc.return_to_sender(s);sc.end();
}
