#[test_only]
module soulidity_v1::completion_cap_tests;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use sui::test_scenario;

#[test]
fun quota_equal_total_cap_is_valid(){let sc=fixtures::setup(0,2,37,1,1,0);sc.end();}
#[test]
fun no_total_cap_keeps_wallet_quota(){let sc=fixtures::setup(0,3,0,2,0,0);sc.end();}
#[test]
#[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)]
fun constructor_rejects_quota_above_nonzero_cap(){let sc=fixtures::setup(0,2,37,2,1,0);sc.end();}
#[test]
#[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)]
fun publication_rechecks_older_constructor_values(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);
    let mut p:Product<USD> =sc.take_shared();let mut c:Control=sc.take_from_sender();
    let r:soulidity_content_kinds::content_kind_registry::KindRegistry=sc.take_shared();
    let mut v=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,2,37,1,1,1000,@0xd,soulidity_maker_terms::maker_resale::rates(500,500),vector[b"ref",b"bound",b"free"],vector[b"free"],vector[fixtures::def(b"ref",0,10),fixtures::def(b"bound",1,10),fixtures::def(b"free",2,10)],vector[],fixtures::scene()),vector[fixtures::default_output(&r,false,true,vector[])]);
    catalog::invalid_completion_cap_for_testing(&mut v);catalog::publish(&mut p,&mut c,1,v);
    test_scenario::return_shared(p);test_scenario::return_shared(r);sc.return_to_sender(c);sc.end();
}
