#[test_only]
module independent_content::tests;
use sui::test_scenario;
use sui::clock;
use soulidity_standard::soul;
use independent_content::extension;
#[test]
fun independent_install_grant_clear_preserves_root_and_library(){
    let mut sc=test_scenario::begin(@0xb);let mut s=extension::mint_for_testing(&mut sc);let id=object::id(&s);let c=clock::create_for_testing(sc.ctx());
    extension::install(&mut s,0,sc.ctx());let library=extension::library_id(&s);let before=extension::library_namespace(&s,@0xb);
    assert!(extension::grant(&mut s,@0x8,2,option::none(),option::none(),1,&c,sc.ctx())==0 && extension::permits(&mut s,@0x8,2,&c,sc.ctx()),0);
    let hash=soul::manifest_hash(&s);extension::clear(&mut s,2);assert!(!extension::permits(&mut s,@0x8,2,&c,sc.ctx()) && extension::revision(&s)==2 && soul::revision(&s)==3,1);
    assert!(object::id(&s)==id && extension::library_id(&s)==library && before!=extension::library_namespace(&s,@0xb) && hash!=soul::manifest_hash(&s),2);
    clock::destroy_for_testing(c);transfer::public_transfer(s,@0xb);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_standard::soul)]
fun stale_root_revision_rejects_extension_grant(){
    let mut sc=test_scenario::begin(@0xb);let mut s=extension::mint_for_testing(&mut sc);let c=clock::create_for_testing(sc.ctx());extension::install(&mut s,0,sc.ctx());extension::grant(&mut s,@0x8,2,option::none(),option::none(),0,&c,sc.ctx());clock::destroy_for_testing(c);transfer::public_transfer(s,@0xb);sc.end();
}
#[test]
fun free_transfer_current_holder_query_does_not_pretend_universal_revocation(){
    let mut sc=test_scenario::begin(@0xb);let mut s=extension::mint_for_testing(&mut sc);let id=object::id(&s);let c=clock::create_for_testing(sc.ctx());extension::install(&mut s,0,sc.ctx());extension::grant(&mut s,@0x8,2,option::none(),option::none(),1,&c,sc.ctx());transfer::public_transfer(s,@0xc);
    sc.next_tx(@0xc);let mut s:soul::Soul=sc.take_from_sender_by_id(id);assert!(!extension::permits(&mut s,@0x8,2,&c,sc.ctx()) && soul::revision(&s)==2,0);transfer::public_transfer(s,@0xb);
    sc.next_tx(@0xb);let mut s:soul::Soul=sc.take_from_sender_by_id(id);assert!(extension::permits(&mut s,@0x8,2,&c,sc.ctx()),1);extension::clear(&mut s,2);assert!(!extension::permits(&mut s,@0x8,2,&c,sc.ctx()),2);clock::destroy_for_testing(c);sc.return_to_sender(s);sc.end();
}
