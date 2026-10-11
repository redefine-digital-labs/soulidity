#[test_only]
module independent_capture::tests;
use sui::test_scenario;
use independent_capture::extension;
use soulidity_standard::soul::{Self,Soul};
use soulidity_application::visual_capture;
#[test]
fun standard_root_install_and_original_id_exit_without_core(){
    let mut sc=test_scenario::begin(@0xa);let p=extension::seed(sc.ctx());let mut s=extension::mint_owned_for_testing(&p,&mut sc);let root=object::id(&s);let cid=extension::install(&mut s,&p,0,sc.ctx());let carrier=object::id(extension::installed(&s));
    assert!(visual_capture::subject(extension::capture(extension::installed(&s)))==root && visual_capture::carrier(extension::capture(extension::installed(&s)))==carrier && soul::revision(&s)==1,0);
    let e=extension::uninstall(&mut s,1);assert!(object::id(&e)==carrier && object::id(extension::capture(&e))==cid && object::id(&s)==root && soul::revision(&s)==2,1);
    extension::destroy(e);transfer::public_transfer(s,@0xa);transfer::public_transfer(p,@0xa);sc.end();
}
#[test]
fun whole_root_transfer_keeps_original_capture_and_new_holder_can_uninstall(){
    let mut sc=test_scenario::begin(@0xa);let p=extension::seed(sc.ctx());let mut s=extension::mint_owned_for_testing(&p,&mut sc);let root=object::id(&s);let cid=extension::install(&mut s,&p,0,sc.ctx());transfer::public_transfer(p,@0xa);transfer::public_transfer(s,@0xb);
    sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);let e=extension::uninstall(&mut s,1);assert!(object::id(extension::capture(&e))==cid && visual_capture::subject(extension::capture(&e))==root,0);extension::destroy(e);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_standard::soul)]
fun stale_revision_cannot_uninstall_snapshot(){let mut sc=test_scenario::begin(@0xa);let p=extension::seed(sc.ctx());let mut s=extension::mint_owned_for_testing(&p,&mut sc);let _=extension::install(&mut s,&p,0,sc.ctx());let e=extension::uninstall(&mut s,0);extension::destroy(e);transfer::public_transfer(s,@0xa);transfer::public_transfer(p,@0xa);sc.end();}
