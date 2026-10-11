#[test_only]
module soulidity_v1::financial_domain_tests;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control,Version};
use soulidity_v1::catalog;
use soulidity_maker_terms::maker_resale as resale;
use sui::test_scenario;
use soulidity_foundation::economics::Config;
fun version(access:u64,complete:u64,quota:u64,cap:u64,royalty:u16,oc:u16,maker:u16):Version{
    catalog::version(fixtures::h(1),fixtures::h(2),if(access>0)1 else 0,access,if(quota>0)2 else if(complete>0)1 else 0,complete,quota,cap,royalty,@0xd,resale::rates(oc,maker),vector[b"ref",b"bound",b"free"],vector[b"free"],vector[fixtures::def(b"ref",0,10),fixtures::def(b"bound",1,10),fixtures::def(b"free",2,10)],vector[],fixtures::scene())
}
#[test] fun original_price_quota_cap_and_royalty_boundaries_are_valid(){let _=version(1000000000000,1000000000000,1000000000,1000000000,1000,500,500);let _=version(0,0,0,0,0,0,0);let _=version(15,17,1,0,50,50,950);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun access_price_above_native_limit(){let _=version(1000000000001,17,0,0,500,500,500);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun complete_price_above_native_limit(){let _=version(15,1000000000001,0,0,500,500,500);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun quota_above_native_limit(){let _=version(15,17,1000000001,0,500,500,500);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun cap_above_native_limit(){let _=version(15,17,1,1000000001,500,500,500);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun source_royalty_above_native_limit(){let _=version(15,17,0,0,1001,500,500);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun source_royalty_off_native_step(){let _=version(15,17,0,0,1,500,500);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun oc_royalty_off_native_step(){let _=version(15,17,0,0,500,1,0);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun maker_royalty_off_native_step(){let _=version(15,17,0,0,500,0,1);}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun control_royalty_off_native_step(){let mut sc=fixtures::setup(0,0,0,0,0,0);let cfg:Config<USD> =sc.take_shared();catalog::create_maker(&cfg,1,sc.ctx());test_scenario::return_shared(cfg);sc.end();}
fun older_constructor_cannot_publish(field:u8){let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let mut p:Product<USD> =sc.take_shared();let mut c:Control=sc.take_from_sender();let r:soulidity_content_kinds::content_kind_registry::KindRegistry=sc.take_shared();let mut v=catalog::with_outputs(version(0,0,0,0,500,500,500),vector[fixtures::default_output(&r,false,true,vector[])]);catalog::invalid_financial_domain_for_testing(&mut v,field);catalog::publish(&mut p,&mut c,1,v);test_scenario::return_shared(p);test_scenario::return_shared(r);sc.return_to_sender(c);sc.end();}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun stored_access_price_rechecked(){older_constructor_cannot_publish(0)}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun stored_complete_price_rechecked(){older_constructor_cannot_publish(1)}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun stored_quota_rechecked(){older_constructor_cannot_publish(2)}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun stored_cap_rechecked(){older_constructor_cannot_publish(3)}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun stored_royalty_bound_rechecked(){older_constructor_cannot_publish(4)}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun stored_royalty_step_rechecked(){older_constructor_cannot_publish(5)}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun stored_oc_step_rechecked(){older_constructor_cannot_publish(6)}
#[test] #[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)] fun stored_maker_step_rechecked(){older_constructor_cannot_publish(7)}
