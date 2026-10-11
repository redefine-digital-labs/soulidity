#[test_only]
module soulidity_v1::capacity_tests;
use std::bcs;
use sui::test_scenario;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_model::policy;
use soulidity_transport::paged_transport as paged_store;

#[test]
fun inline_inventory_at_declared_limit_exceeds_single_object_budget(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let maker:Product<USD> = sc.take_shared();
    let source=catalog::preview_source(&maker,1,policy::definition_hash(&fixtures::def(b"bound",1,10)));
    let inline=vector::tabulate!(512,|_|source);let bytes=bcs::to_bytes(&inline).length();
    std::debug::print(&bcs::to_bytes(&source).length());std::debug::print(&bytes);
    assert!(bytes>256000,0);test_scenario::return_shared(maker);sc.end();
}

#[test]
fun full_source_inventory_pages_preserve_all_indices_and_small_parent(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let maker:Product<USD> = sc.take_shared();let source=catalog::preview_source(&maker,1,policy::definition_hash(&fixtures::def(b"bound",1,10)));
    let mut store=paged_store::new(sc.ctx());let mut i=0;while(i < 512){assert!(paged_store::append(&mut store,source)==i,0);i=i+1};
    assert!(paged_store::length(&store)==512 && paged_store::pages(&store)==16 && bcs::to_bytes(&store).length() < 10000 && *paged_store::get(&store,0)==source && *paged_store::get(&store,511)==source && paged_store::values(&store)==vector::tabulate!(512,|_|source),1);
    paged_store::destroy(store);test_scenario::return_shared(maker);sc.end();
}
#[test]
fun large_rows_split_by_bytes_before_row_count_without_changing_values(){
    let mut sc=test_scenario::begin(@0xb);let row=vector::tabulate!(60000,|_|7u8);let rows=vector::tabulate!(10,|_|row);let store=paged_store::from_values(rows,sc.ctx());
    assert!(paged_store::pages(&store)==4 && paged_store::length(&store)==10 && bcs::to_bytes(&store).length() < 1024 && paged_store::values(&store)==rows,0);
    paged_store::destroy(store);let effects=sc.next_tx(@0xb);assert!(test_scenario::created(&effects).is_empty(),1);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_transport::paged_transport)]
fun append_513th_record_is_rejected(){let mut sc=test_scenario::begin(@0xb);let mut store=paged_store::from_values(vector::tabulate!(512,|i|i),sc.ctx());paged_store::append(&mut store,512);paged_store::destroy(store);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_transport::paged_transport)]
fun single_row_cannot_hide_oversize_bcs_value(){let mut sc=test_scenario::begin(@0xb);let row=vector::tabulate!(196608,|_|1u8);let store=paged_store::from_values(vector[row],sc.ctx());paged_store::destroy(store);sc.end();}
#[test,expected_failure(abort_code=2,location=soulidity_transport::paged_transport)]
fun unknown_record_index_cannot_alias_existing_inventory(){let mut sc=test_scenario::begin(@0xb);let store=paged_store::from_values(vector[1u8],sc.ctx());let _=paged_store::get(&store,1);paged_store::destroy(store);sc.end();}

#[test]
fun page_ranges_preserve_order_across_row_and_byte_boundaries(){
    let mut sc=test_scenario::begin(@0xb);
    let rows=vector::tabulate!(65,|i|vector::tabulate!(100,|_|(i as u8)));
    let store=paged_store::from_values(rows,sc.ctx());
    assert!(paged_store::pages(&store)==3 && paged_store::values(&store)==rows,0);
    assert!(paged_store::range(&store,31,34)==vector::tabulate!(34,|i|rows[i+31]),1);
    assert!(paged_store::range(&store,65,0).is_empty(),2);paged_store::destroy(store);
    let rows=vector::tabulate!(8,|i|vector::tabulate!(60000,|_|(i as u8)));
    let store=paged_store::from_values(rows,sc.ctx());
    assert!(paged_store::pages(&store)==3 && paged_store::values(&store)==rows,3);
    assert!(paged_store::range(&store,2,5)==vector::tabulate!(5,|i|rows[i+2]),4);
    paged_store::destroy(store);let empty:paged_store::Store<u8> =paged_store::new(sc.ctx());
    assert!(paged_store::range(&empty,0,0).is_empty(),5);paged_store::destroy(empty);sc.end();
}
#[test,expected_failure(abort_code=2,location=soulidity_transport::paged_transport)]
fun range_past_end_is_rejected_before_reading_a_page(){
    let mut sc=test_scenario::begin(@0xb);let store=paged_store::from_values(vector[1u8],sc.ctx());
    let _=paged_store::range(&store,1,1);paged_store::destroy(store);sc.end();
}
#[test,expected_failure(abort_code=2,location=soulidity_transport::paged_transport)]
fun range_overflow_cannot_wrap_into_an_existing_page(){
    let mut sc=test_scenario::begin(@0xb);let store=paged_store::from_values(vector[1u8],sc.ctx());
    let _=paged_store::range(&store,1,18446744073709551615);paged_store::destroy(store);sc.end();
}
