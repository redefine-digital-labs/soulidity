#[test_only]
module soulidity_v1::loadout_tests;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use sui::coin;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::storage_fixture;
use soulidity_application::character::{Self as soul,DesiredSlot};
use soulidity_standard::soul::Soul;
use soulidity_model::components::Item;
use soulidity_content::loadout;
use soulidity_transport::storage_transport as storage;
use soulidity_model::policy;
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::Config;
use soulidity_content_kinds::content_kind_registry::KindRegistry;
use soulidity_v1::issuer;
use soulidity_application::output;
use soulidity_application::vault;
use walrus::system::{Self,System};
use wal::wal::WAL;
fun setup():(Scenario,Soul,System) {
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);
    let s=sc.take_from_sender_by_id(root);let sys=sc.take_shared();(sc,s,sys)
}
fun end(sc:Scenario,s:Soul,sys:System){sc.return_to_sender(s);test_scenario::return_shared(sys);sc.end();}
fun empty():vector<DesiredSlot>{vector[soul::empty_slot(b"ref"),soul::empty_slot(b"bound"),soul::empty_slot(b"free")]}
fun selected(id:ID):vector<DesiredSlot>{vector[soul::reference_slot(b"ref",0,fixtures::layout()),soul::bound_slot(b"bound",0,fixtures::layout()),soul::free_slot(b"free",id,fixtures::layout())]}
fun save(sc:&mut Scenario,s:&mut Soul,sys:&mut System,request:u8):u64 {
    let capture=soul::loadout_capture(s);let blob=storage_fixture::blob(sys,300+(request as u256),false,true,sc.ctx());
    let gen=soul::generation(s);let lib=loadout::current_revision(soul::loadouts(s),sc.sender(),gen);let rev=soul::revision(s);
    soul::save_loadout(s,capture,blob,sys,fixtures::h(request),fixtures::h(request),gen,lib,rev,sc.ctx())
}
#[test]
fun save_retains_capture_and_does_not_change_equipment_or_mint_items() {
    let(mut sc,mut s,mut sys)=setup();let capture=soul::loadout_capture(&s);let hash=soul::recipe_hash(&s);let id=soul::free_id(&soul::binding(&s,b"free").destroy_some());let seal=soul::loadout_seal_id(&s,@0xb);
    soul::seal_approve_loadout(seal,&mut s,0,sc.ctx());assert!(save(&mut sc,&mut s,&mut sys,31)==1,0);
    let head=soul::current_loadout_head(&mut s,sc.ctx()).destroy_some();let r=loadout::head_receipt(&head);
    assert!(loadout::receipt_capture(&r)==option::some(capture) && loadout::head_revision(&head)==1 && loadout::head_request(&head)==fixtures::h(31),1);
    assert!(soul::recipe_hash(&s)==hash && soul::composition_revision(&s)==0 && soul::revision(&s)==1 && soul::free_id(&soul::binding(&s,b"free").destroy_some())==id && soul::reference_count(&s)==1 && soul::bound_count(&s)==1,2);
    assert!(seal==soul::loadout_seal_id(&s,@0xb),3);loadout::assert_available(soul::loadouts(&s),&r,&sys);end(sc,s,sys)
}
#[test]
fun encrypted_rename_update_preserves_composition_and_old_receipt_recovery() {
    let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let r=loadout::receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31)).destroy_some();let capture=loadout::receipt_capture(&r);
    soul::tune(&mut s,b"free",policy::layout(false,1,false,0,1000000,0,vector[]),1);
    let blob=storage_fixture::blob(&mut sys,332,false,true,sc.ctx());assert!(soul::update_loadout(&mut s,blob,&sys,fixtures::h(32),fixtures::h(32),0,1,2,sc.ctx())==2,0);
    assert!(loadout::assert_receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31),storage::object_id(loadout::receipt_reference(&r)),fixtures::h(31),capture)==1 && soul::composition_revision(&s)==1,1);
    assert!(loadout::receipt_capture(&loadout::head_receipt(&soul::current_loadout_head(&mut s,sc.ctx()).destroy_some())).is_none(),2);end(sc,s,sys)
}
#[test]
fun atomic_apply_preserves_original_ids_and_restores_issued_reference_rights() {
    let(sc,mut s,sys)=setup();let original=soul::free_id(&soul::binding(&s,b"free").destroy_some()).destroy_some();let hash=soul::recipe_hash(&s);
    let mut removed=soul::apply_loadout(&mut s,empty(),vector[],0,hash);assert!(removed.length()==1 && object::id(&removed[0])==original,0);
    assert!(soul::reference_count(&s)==1 && soul::bound_count(&s)==1 && soul::binding(&s,b"ref").is_none(),1);
    let it=removed.pop_back();removed.destroy_empty();let current=soul::recipe_hash(&s);
    soul::apply_loadout(&mut s,selected(original),vector[it],1,current).destroy_empty();
    assert!(soul::recipe_hash(&s)==hash && soul::composition_revision(&s)==2 && soul::free_id(&soul::binding(&s,b"free").destroy_some())==option::some(original),2);end(sc,s,sys)
}
#[test]
fun kept_free_object_is_reused_without_wallet_input_and_unselected_wallet_item_is_returned() {
    let(mut sc,s,sys)=setup();test_scenario::return_shared(sys);sc.return_to_sender(s);sc.next_tx(@0xb);let second=fixtures::mint(&mut sc,21,0);sc.next_tx(@0xb);let sys:System=sc.take_shared();let mut other:Soul=sc.take_from_sender_by_id(second);let it=soul::detach(&mut other,b"free",0);let unused=object::id(&it);let mut s:Soul=sc.take_from_sender();
    let original=soul::free_id(&soul::binding(&s,b"free").destroy_some()).destroy_some();let hash=soul::recipe_hash(&s);let mut returned=soul::apply_loadout(&mut s,selected(original),vector[it],0,hash);
    assert!(returned.length()==1 && object::id(&returned[0])==unused,0);transfer::public_transfer(returned.pop_back(),@0xb);returned.destroy_empty();sc.return_to_sender(other);end(sc,s,sys)
}
#[test]
fun reference_can_be_cleared_and_remounted_without_new_issuance() {
    let(sc,mut s,sys)=setup();let source=*soul::reference_source(&s,0);soul::clear_reference(&mut s,b"ref",0);soul::remount_reference(&mut s,0,b"ref",fixtures::layout(),1);
    assert!(*soul::binding_source(&soul::binding(&s,b"ref").destroy_some())==source && soul::reference_count(&s)==1,0);end(sc,s,sys)
}
#[test]
fun receipts_persist_beyond_client_window_and_historical_blob_can_be_purged() {
    let(mut sc,mut s,mut sys)=setup();let mut i=31u8;while(i < 65){save(&mut sc,&mut s,&mut sys,i);i=i+1};
    let first=loadout::receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31)).destroy_some();assert!(loadout::receipt_revision(&first)==1,0);
    soul::purge_loadout(&mut s,@0xb,0,fixtures::h(31),34,sc.ctx());assert!(!loadout::available(soul::loadouts(&s),&first),1);
    assert!(loadout::assert_receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31),storage::object_id(loadout::receipt_reference(&first)),fixtures::h(31),loadout::receipt_capture(&first))==1,2);end(sc,s,sys)
}
#[test]
fun actual_blob_renewal_keeps_namespace_and_receipt_unchanged() {
    let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let r=loadout::receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31)).destroy_some();let seal=soul::loadout_seal_id(&s,@0xb);
    let mut payment=coin::mint_for_testing<WAL>(1000000000,sc.ctx());let amount=walrus::encoding::encoded_blob_length(1024,1,system::n_shards(&sys));let ext=system::reserve_space_for_epochs(&mut sys,amount,4,6,&mut payment,sc.ctx());coin::burn_for_testing(payment);
    soul::extend_loadout(&mut s,@0xb,0,fixtures::h(31),ext,&sys,1);
    assert!(loadout::receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31))==option::some(r) && soul::loadout_seal_id(&s,@0xb)==seal && soul::composition_revision(&s)==0,0);
    loadout::assert_available(soul::loadouts(&s),&r,&sys);end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_application::character)]
fun missing_free_object_cannot_be_materialized_from_snapshot(){let(sc,mut s,sys)=setup();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,selected(object::id_from_address(@0xdead)),vector[],0,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_application::character)]
fun unissued_reference_index_rejected(){let(sc,mut s,sys)=setup();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,vector[soul::reference_slot(b"ref",1,fixtures::layout()),soul::empty_slot(b"bound"),soul::empty_slot(b"free")],vector[],0,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=7,location=soulidity_application::character)]
fun bound_index_cannot_be_selected_twice(){let(sc,mut s,sys)=setup();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,vector[soul::empty_slot(b"ref"),soul::bound_slot(b"bound",0,fixtures::layout()),soul::bound_slot(b"free",0,fixtures::layout())],vector[],0,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_application::character)]
fun reference_index_cannot_be_selected_twice(){let(sc,mut s,sys)=setup();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,vector[soul::reference_slot(b"ref",0,fixtures::layout()),soul::empty_slot(b"bound"),soul::reference_slot(b"free",0,fixtures::layout())],vector[],0,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_application::character)]
fun duplicate_or_wrong_part_order_rejected(){let(sc,mut s,sys)=setup();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,vector[soul::empty_slot(b"ref"),soul::empty_slot(b"ref"),soul::empty_slot(b"free")],vector[],0,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_application::character)]
fun partial_selection_rejected(){let(sc,mut s,sys)=setup();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,vector[],vector[],0,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_apply_root_revision_rejected(){let(sc,mut s,sys)=setup();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,empty(),vector[],1,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_apply_recipe_rejected(){let(sc,mut s,sys)=setup();let out=soul::apply_loadout(&mut s,empty(),vector[],0,fixtures::h(99));out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_model::policy)]
fun saved_layout_cannot_bypass_creator_bounds(){let(sc,mut s,sys)=setup();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,vector[soul::reference_slot(b"ref",0,policy::layout(false,11,false,0,1000000,0,vector[])),soul::empty_slot(b"bound"),soul::empty_slot(b"free")],vector[],0,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_content::loadout)]
fun stale_equipment_capture_rejected(){let(mut sc,mut s,mut sys)=setup();let capture=soul::loadout_capture(&s);soul::tune(&mut s,b"free",fixtures::layout(),0);let blob=storage_fixture::blob(&mut sys,331,false,true,sc.ctx());soul::save_loadout(&mut s,capture,blob,&sys,fixtures::h(31),fixtures::h(31),0,0,1,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_content::loadout)]
fun wrong_composition_capture_rejected(){let(mut sc,mut s,mut sys)=setup();let capture=loadout::capture(object::id_from_address(@0xdead),0,soul::recipe_hash(&s));let blob=storage_fixture::blob(&mut sys,331,false,true,sc.ctx());soul::save_loadout(&mut s,capture,blob,&sys,fixtures::h(31),fixtures::h(31),0,0,0,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_content::loadout)]
fun wrong_capture_commitment_rejected(){let(mut sc,mut s,mut sys)=setup();let capture=loadout::capture(object::id(soul::composition(&s)),0,fixtures::h(99));let blob=storage_fixture::blob(&mut sys,331,false,true,sc.ctx());soul::save_loadout(&mut s,capture,blob,&sys,fixtures::h(31),fixtures::h(31),0,0,0,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_content::loadout)]
fun stale_library_revision_rejected(){let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let blob=storage_fixture::blob(&mut sys,332,false,true,sc.ctx());soul::update_loadout(&mut s,blob,&sys,fixtures::h(32),fixtures::h(32),0,0,1,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content::loadout)]
fun permanent_request_replay_cannot_commit_another_blob(){let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let blob=storage_fixture::blob(&mut sys,332,false,true,sc.ctx());soul::update_loadout(&mut s,blob,&sys,fixtures::h(32),fixtures::h(31),0,1,1,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_content::loadout)]
fun receipt_recovery_rejects_different_ciphertext(){let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let r=loadout::receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31)).destroy_some();loadout::assert_receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31),storage::object_id(loadout::receipt_reference(&r)),fixtures::h(99),loadout::receipt_capture(&r));end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_content::loadout)]
fun receipt_recovery_rejects_different_capture(){let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let r=loadout::receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31)).destroy_some();loadout::assert_receipt(soul::loadouts(&s),@0xb,0,fixtures::h(31),storage::object_id(loadout::receipt_reference(&r)),fixtures::h(31),option::none());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_content::loadout)]
fun active_library_blob_cannot_be_purged(){let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);soul::purge_loadout(&mut s,@0xb,0,fixtures::h(31),1,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=6,location=soulidity_content::loadout)]
fun foreign_owner_namespace_cannot_be_approved(){let(mut sc,mut s,sys)=setup();let id=soul::loadout_seal_id(&s,@0xc);soul::seal_approve_loadout(id,&mut s,0,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_generation_cannot_write_library(){let(mut sc,mut s,mut sys)=setup();soul::clear_authorizations(&mut s);let blob=storage_fixture::blob(&mut sys,331,false,true,sc.ctx());soul::update_loadout(&mut s,blob,&sys,fixtures::h(31),fixtures::h(31),0,0,1,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun uncertified_loadout_blob_rejected(){let(mut sc,mut s,mut sys)=setup();let blob=storage_fixture::blob(&mut sys,331,false,false,sc.ctx());soul::update_loadout(&mut s,blob,&sys,fixtures::h(31),fixtures::h(31),0,0,0,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun deletable_loadout_blob_rejected(){let(mut sc,mut s,mut sys)=setup();let blob=storage_fixture::blob(&mut sys,331,true,true,sc.ctx());soul::update_loadout(&mut s,blob,&sys,fixtures::h(31),fixtures::h(31),0,0,0,sc.ctx());end(sc,s,sys)}
#[test]
fun supported_handover_invalidates_scope_and_request_can_be_reused_only_in_new_scope() {
    let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let id=object::id(&s);let old=soul::loadout_seal_id(&s,@0xb);soul::handover(s,@0xc,1);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(id);
    assert!(soul::current_loadout_head(&mut s,sc.ctx()).is_none() && soul::generation(&s)==1 && old!=soul::loadout_seal_id(&s,@0xc),0);
    let blob=storage_fixture::blob(&mut sys,332,false,true,sc.ctx());soul::update_loadout(&mut s,blob,&sys,fixtures::h(32),fixtures::h(31),1,0,2,sc.ctx());
    assert!(loadout::current_revision(soul::loadouts(&s),@0xc,1)==1 && loadout::current_revision(soul::loadouts(&s),@0xb,0)==1,1);
    soul::handover(s,@0xb,3);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(id);assert!(soul::current_loadout_head(&mut s,sc.ctx()).is_none() && old!=soul::loadout_seal_id(&s,@0xb),2);end(sc,s,sys)
}
#[test]
fun freely_transferred_soul_starts_new_owner_scope_but_has_no_global_epoch_hook() {
    let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let id=object::id(&s);let old=soul::loadout_seal_id(&s,@0xb);transfer::public_transfer(s,@0xc);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(id);
    assert!(soul::current_loadout_head(&mut s,sc.ctx()).is_none() && soul::generation(&s)==0 && old!=soul::loadout_seal_id(&s,@0xc),0);
    transfer::public_transfer(s,@0xb);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(id);
    // Evidence of the standard public_transfer limitation, not permanent revocation.
    assert!(soul::current_loadout_head(&mut s,sc.ctx()).is_some() && old==soul::loadout_seal_id(&s,@0xb),1);end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=6,location=soulidity_content::loadout)]
fun new_holder_cannot_use_old_owner_library_namespace() {
    let(mut sc,mut s,mut sys)=setup();save(&mut sc,&mut s,&mut sys,31);let id=object::id(&s);let old=soul::loadout_seal_id(&s,@0xb);transfer::public_transfer(s,@0xc);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(id);soul::seal_approve_loadout(old,&mut s,0,sc.ctx());end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_root_revision_cannot_save_current_capture() {
    let(mut sc,mut s,mut sys)=setup();let c=soul::loadout_capture(&s);save(&mut sc,&mut s,&mut sys,31);let blob=storage_fixture::blob(&mut sys,332,false,true,sc.ctx());soul::save_loadout(&mut s,c,blob,&sys,fixtures::h(32),fixtures::h(32),0,1,0,sc.ctx());end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_content::loadout)]
fun zero_request_hash_is_invalid(){let(mut sc,mut s,mut sys)=setup();let blob=storage_fixture::blob(&mut sys,331,false,true,sc.ctx());soul::update_loadout(&mut s,blob,&sys,fixtures::h(31),fixtures::h(0),0,0,0,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_content::loadout)]
fun zero_ciphertext_hash_is_invalid(){let(mut sc,mut s,mut sys)=setup();let blob=storage_fixture::blob(&mut sys,331,false,true,sc.ctx());soul::update_loadout(&mut s,blob,&sys,fixtures::h(0),fixtures::h(31),0,0,0,sc.ctx());end(sc,s,sys)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_content::loadout)]
fun zero_capture_commitment_is_invalid(){let(sc,s,sys)=setup();loadout::capture(object::id(soul::composition(&s)),0,fixtures::h(0));end(sc,s,sys)}
/// Actual owned Soul with an optional tool; no shared Vault or separate cap.
fun tool_setup():(Scenario,Soul,System){
    let(mut sc,mut s,sys)=setup();let root=soulidity_standard::soul::revision(&s);
    vault::install(&mut s,root,sc.ctx());(sc,s,sys)
}
#[test]
fun soul_tool_save_and_apply_return_same_actual_item(){
    let(mut sc,mut s,mut sys)=tool_setup();let tool=vault::snapshot(&s);let original=soul::free_id(&soul::binding(&s,b"free").destroy_some()).destroy_some();
    let capture=soul::loadout_capture(&s);let seal=soul::loadout_seal_id(&s,@0xb);soul::seal_approve_loadout(seal,&mut s,0,sc.ctx());
    assert!(save(&mut sc,&mut s,&mut sys,31)==1,0);
    assert!(loadout::receipt_capture(&loadout::head_receipt(&soul::current_loadout_head(&mut s,sc.ctx()).destroy_some()))==option::some(capture),1);
    let hash=soul::recipe_hash(&s);let items=soul::apply_loadout(&mut s,empty(),vector[],1,hash);
    assert!(items.length()==1 && object::id(&items[0])==original && soul::revision(&s)==2 && vault::snapshot(&s)==tool,2);
    items.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)
}
#[test]
fun explicit_soul_handover_rotates_loadout_scope_without_revival(){
    let(mut sc,mut s,mut sys)=tool_setup();save(&mut sc,&mut s,&mut sys,31);let old=soul::loadout_seal_id(&s,@0xb);let root=object::id(&s);let tool=object::id(vault::tool(&s));
    soul::clear_authorizations(&mut s);let r=soulidity_standard::soul::revision(&s);vault::rotate_private_scope(&mut s,0,r);transfer::public_transfer(s,@0xc);
    sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(root);
    assert!(soul::current_loadout_head(&mut s,sc.ctx()).is_none() && old!=soul::loadout_seal_id(&s,@0xc),0);
    soul::clear_authorizations(&mut s);let r=soulidity_standard::soul::revision(&s);vault::rotate_private_scope(&mut s,1,r);transfer::public_transfer(s,@0xb);
    sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);
    assert!(soul::current_loadout_head(&mut s,sc.ctx()).is_none() && old!=soul::loadout_seal_id(&s,@0xb) && object::id(vault::tool(&s))==tool,1);end(sc,s,sys)
}
#[test,expected_failure(abort_code=4,location=sui::test_scenario)]
fun unrelated_wallet_cannot_supply_owner_soul_for_library_read(){
    let(mut sc,s,sys)=tool_setup();let root=object::id(&s);sc.return_to_sender(s);sc.next_tx(@0xc);
    let mut s:Soul=sc.take_from_sender_by_id(root);let id=soul::loadout_seal_id(&s,@0xb);
    soul::seal_approve_loadout(id,&mut s,0,sc.ctx());end(sc,s,sys)
}
#[test,expected_failure(abort_code=4,location=sui::test_scenario)]
fun unrelated_wallet_cannot_supply_owner_soul_for_apply(){
    let(mut sc,s,sys)=tool_setup();let root=object::id(&s);sc.return_to_sender(s);sc.next_tx(@0xc);
    let mut s:Soul=sc.take_from_sender_by_id(root);let hash=soul::recipe_hash(&s);
    soul::apply_loadout(&mut s,empty(),vector[],0,hash).do!(|it|transfer::public_transfer(it,@0xc));end(sc,s,sys)
}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_application_revision_rejects_tool_soul_loadout(){
    let(mut sc,mut s,sys)=tool_setup();let hash=soul::recipe_hash(&s);
    soul::apply_loadout(&mut s,empty(),vector[],1,hash).do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)
}
/// Build a real published Maker whose Free Style requires the Ref Style.
fun rule_setup():(Scenario,Soul,System) {
    let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);
    let mut p:Product<USD> = sc.take_shared();let mut cap:Control=sc.take_from_sender();let registry:KindRegistry=sc.take_shared();
    let ref_def=fixtures::def(b"ref",0,10);let free_def=policy::definition(b"free",b"item",b"style",2,fixtures::h(11),fixtures::h(12),fixtures::representation(),10,fixtures::layout(),policy::bounds(10,10,500000,2000000,90000,vector[vector[255,0,0,255]]),vector[policy::definition_hash(&ref_def)],vector[],true);
    catalog::publish(&mut p,&mut cap,1,catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,1000,@0xd,soulidity_maker_terms::maker_resale::rates(500,500),vector[b"ref",b"bound",b"free"],vector[b"free"],vector[ref_def,fixtures::def(b"bound",1,10),free_def],vector[],fixtures::scene()),vector[fixtures::default_output(&registry,false,true,vector[])]));
    sc.return_to_sender(cap);test_scenario::return_shared(registry);test_scenario::return_shared(p);sc.next_tx(@0xb);
    let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let mut sys:System=sc.take_shared();let c=clock::create_for_testing(sc.ctx());
    let defs=vector[ref_def,fixtures::def(b"bound",1,10),free_def];let parts=vector[b"ref",b"bound",b"free"];let mut slots=vector[];let mut i=0;
    while(i < 3){slots.push_back(output::slot(parts[i],option::some(output::selection(catalog::preview_source(&p,2,policy::definition_hash(&defs[i])),fixtures::layout(),option::none()))));i=i+1};
    let version=catalog::published(&p,2);let out=catalog::output_policy(version,b"default");let intent=output::intent(catalog::protocol(&p),object::id(&p),2,catalog::policy_hash(version),output::policy_hash(&out),@0xb,fixtures::h(20),string::utf8(b"OC"),fixtures::recipe(slots),vector::tabulate!(16,|_|20));
    let mut b=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&cfg),&mut p,&mut cfg,intent,b"default",0,1000,coin::mint_for_testing<USD>(0,sc.ctx()),&c,sc.ctx());let mut i=0;
    while(i < 3){issuer::select(&mut b,&mut p,policy::definition_hash(&defs[i]),parts[i],fixtures::layout(),sc.ctx());i=i+1};
    let root=fixtures::finish(&mut sc,b,&mut sys,&c);clock::destroy_for_testing(c);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.next_tx(@0xb);let s=sc.take_from_sender_by_id(root);(sc,s,sys)
}
#[test]
fun valid_final_recipe_can_remove_required_pair_atomically() {
    let(sc,mut s,sys)=rule_setup();let id=soul::free_id(&soul::binding(&s,b"free").destroy_some()).destroy_some();let hash=soul::recipe_hash(&s);let removed=soul::apply_loadout(&mut s,empty(),vector[],0,hash);
    let h=soul::recipe_hash(&s);soul::apply_loadout(&mut s,selected(id),removed,1,h).destroy_empty();assert!(soul::recipe_hash(&s)==hash,0);end(sc,s,sys)
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_model::policy)]
fun invalid_final_recipe_is_rejected_after_atomic_planning() {
    let(sc,mut s,sys)=rule_setup();let id=soul::free_id(&soul::binding(&s,b"free").destroy_some()).destroy_some();let h=soul::recipe_hash(&s);let out=soul::apply_loadout(&mut s,vector[soul::empty_slot(b"ref"),soul::empty_slot(b"bound"),soul::free_slot(b"free",id,fixtures::layout())],vector[],0,h);out.do!(|it|transfer::public_transfer(it,@0xb));end(sc,s,sys)
}
