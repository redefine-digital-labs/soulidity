#[test_only]
module soulidity_v1::storage_epoch_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use sui::coin;
use walrus::system::{Self,System};
use walrus::blob::{Self,Blob};
use walrus::test_node::TestStorageNode;
use soulidity_v1::storage_fixture;
use soulidity_transport::storage_transport::{Self as storage,Reference};
use soulidity_v1::fixtures;
fun setup():(Scenario,System,vector<TestStorageNode>,Clock,Blob,Reference) {
    let mut sc=test_scenario::begin(@0xb);let(nodes,clock)=storage_fixture::bootstrap(&mut sc);let mut system:System=sc.take_shared();
    let blob=storage_fixture::blob(&mut system,301,false,true,sc.ctx());let reference=storage::certified(&blob,&system,fixtures::h(1));(sc,system,nodes,clock,blob,reference)
}
fun end(sc:Scenario,system:System,nodes:vector<TestStorageNode>,clock:Clock,blob:Blob) {
    nodes.do!(|node|node.destroy());blob::burn(blob);test_scenario::return_shared(system);clock::destroy_for_testing(clock);sc.end();
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun certified_blob_expires_at_real_walrus_epoch_boundary() {
    let(mut sc,mut system,mut nodes,mut clock,blob,reference)=setup();assert!(system::epoch(&system)==1 && storage::original_end_epoch(&reference)==4,0);
    storage_fixture::next_epoch(&mut sc,&mut system,&mut nodes,&mut clock);storage_fixture::next_epoch(&mut sc,&mut system,&mut nodes,&mut clock);storage::assert_current(&reference,&blob,&system);
    storage_fixture::next_epoch(&mut sc,&mut system,&mut nodes,&mut clock);assert!(system::epoch(&system)==4,1);storage::assert_current(&reference,&blob,&system);end(sc,system,nodes,clock,blob)
}
#[test]
fun extended_blob_remains_available_past_original_reference_end() {
    let(mut sc,mut system,mut nodes,mut clock,mut blob,reference)=setup();let mut payment=coin::mint_for_testing<wal::wal::WAL>(1000000000,sc.ctx());
    let amount=walrus::encoding::encoded_blob_length(blob::size(&blob),1,system::n_shards(&system));let extension=system::reserve_space_for_epochs(&mut system,amount,4,6,&mut payment,sc.ctx());coin::burn_for_testing(payment);system::extend_blob_with_resource(&system,&mut blob,extension);
    let mut n=0;while(n < 4){storage_fixture::next_epoch(&mut sc,&mut system,&mut nodes,&mut clock);n=n+1};
    assert!(system::epoch(&system)==5 && storage::original_end_epoch(&reference)==4 && blob::end_epoch(&blob)==6,0);storage::assert_current(&reference,&blob,&system);end(sc,system,nodes,clock,blob)
}

#[test]
fun batch_current_checks_actual_identity_and_returns_no_cached_authority(){
    let(sc,system,nodes,clock,blob,reference)=setup();
    let mut blobs=vector[blob];storage::assert_current_batch(&vector[reference],&blobs,&system);
    let last=blobs.pop_back();blobs.destroy_empty();end(sc,system,nodes,clock,last)
}
#[test,expected_failure(abort_code=2,location=soulidity_transport::storage_transport)]
fun batch_does_not_accept_missing_actual_blobs(){
    let(sc,system,nodes,clock,blob,reference)=setup();
    let empty=vector[];storage::assert_current_batch(&vector[reference],&empty,&system);empty.destroy_empty();end(sc,system,nodes,clock,blob)
}
#[test,expected_failure(abort_code=2,location=soulidity_transport::storage_transport)]
fun batch_checks_last_actual_blob_identity(){
    let(mut sc,mut system,nodes,clock,blob,reference)=setup();
    let other=storage_fixture::blob(&mut system,302,false,true,sc.ctx());
    let mut blobs=vector[blob,other];storage::assert_current_batch(&vector[reference,reference],&blobs,&system);
    blob::burn(blobs.pop_back());let last=blobs.pop_back();blobs.destroy_empty();end(sc,system,nodes,clock,last)
}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun earlier_successful_batch_cannot_hide_a_later_actual_epoch_change(){
    let(mut sc,mut system,mut nodes,mut clock,blob,reference)=setup();let mut blobs=vector[blob];
    storage::assert_current_batch(&vector[reference],&blobs,&system);
    let mut i=0;while(i < 3){storage_fixture::next_epoch(&mut sc,&mut system,&mut nodes,&mut clock);i=i+1};
    storage::assert_current_batch(&vector[reference],&blobs,&system);let last=blobs.pop_back();blobs.destroy_empty();end(sc,system,nodes,clock,last)
}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun batch_checks_last_expired_blob_after_an_earlier_renewed_blob(){
    let(mut sc,mut system,mut nodes,mut clock,mut first,reference)=setup();
    let last=storage_fixture::blob(&mut system,302,false,true,sc.ctx());let last_reference=storage::certified(&last,&system,fixtures::h(2));
    let mut payment=coin::mint_for_testing<wal::wal::WAL>(1000000000,sc.ctx());
    let amount=walrus::encoding::encoded_blob_length(blob::size(&first),1,system::n_shards(&system));
    let extension=system::reserve_space_for_epochs(&mut system,amount,4,6,&mut payment,sc.ctx());coin::burn_for_testing(payment);
    system::extend_blob_with_resource(&system,&mut first,extension);
    let mut i=0;while(i < 3){storage_fixture::next_epoch(&mut sc,&mut system,&mut nodes,&mut clock);i=i+1};
    storage::assert_current(&reference,&first,&system);let mut blobs=vector[first,last];
    storage::assert_current_batch(&vector[reference,last_reference],&blobs,&system);
    blob::burn(blobs.pop_back());let last=blobs.pop_back();blobs.destroy_empty();end(sc,system,nodes,clock,last)
}

#[test]
fun certification_batch_matches_single_blob_references_in_input_order(){
    let(mut sc,mut system,nodes,clock,first,reference)=setup();
    let last=storage_fixture::blob(&mut system,302,false,true,sc.ctx());let last_reference=storage::certified(&last,&system,fixtures::h(2));
    let mut blobs=vector[first,last];let references=storage::certified_batch(&blobs,&system,&vector[fixtures::h(1),fixtures::h(2)]);
    assert!(references==vector[reference,last_reference],0);storage::assert_current_batch(&references,&blobs,&system);
    blob::burn(blobs.pop_back());let first=blobs.pop_back();blobs.destroy_empty();end(sc,system,nodes,clock,first)
}
fun invalid_last_certification(deletable:bool,certified:bool){
    let(mut sc,mut system,nodes,clock,first,_)=setup();let last=storage_fixture::blob(&mut system,302,deletable,certified,sc.ctx());
    let mut blobs=vector[first,last];let _=storage::certified_batch(&blobs,&system,&vector[fixtures::h(1),fixtures::h(2)]);
    blob::burn(blobs.pop_back());let first=blobs.pop_back();blobs.destroy_empty();end(sc,system,nodes,clock,first)
}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun certification_batch_checks_last_uncertified_blob(){invalid_last_certification(false,false)}
#[test,expected_failure(abort_code=1,location=soulidity_transport::storage_transport)]
fun certification_batch_checks_last_deletable_blob(){invalid_last_certification(true,true)}
#[test,expected_failure(abort_code=2,location=soulidity_transport::storage_transport)]
fun certification_batch_rejects_missing_transport_hash(){
    let(sc,system,nodes,clock,blob,_)=setup();let mut blobs=vector[blob];let _=storage::certified_batch(&blobs,&system,&vector[]);
    let first=blobs.pop_back();blobs.destroy_empty();end(sc,system,nodes,clock,first)
}
#[test,expected_failure(abort_code=2,location=soulidity_transport::storage_transport)]
fun certification_batch_rejects_wrong_digest_length(){
    let(sc,system,nodes,clock,blob,_)=setup();let mut blobs=vector[blob];let _=storage::certified_batch(&blobs,&system,&vector[vector[1u8]]);
    let first=blobs.pop_back();blobs.destroy_empty();end(sc,system,nodes,clock,first)
}
