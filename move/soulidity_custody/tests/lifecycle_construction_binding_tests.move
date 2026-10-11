#[test_only]
module soulidity_custody::lifecycle_construction_binding_tests;
use soulidity_custody::lifecycle;
use soulidity_standard::soul::Soul;
use private_source::producer;
use sui::test_scenario;
#[test,expected_failure(abort_code=9,location=soulidity_custody::lifecycle)]
fun actual_source_object_substitution_rejects_constructor(){
    let mut sc=test_scenario::begin(@0xa);
    let source=producer::create(sc.ctx());
    let other=producer::create(sc.ctx());
    let q=producer::request<Soul>(&source,0,sc.ctx());
    let _c=lifecycle::new(producer::witness_for_testing(),&other,q,sc.ctx());
    abort 0
}
#[test,expected_failure(abort_code=9,location=soulidity_custody::lifecycle)]
fun internally_substituted_root_rejects_pinned_construction(){
    let mut sc=test_scenario::begin(@0xa);
    let source=producer::create(sc.ctx());
    let a=lifecycle::new(producer::witness_for_testing(),&source,producer::request<Soul>(&source,0,sc.ctx()),sc.ctx());
    let b=lifecycle::new(producer::witness_for_testing(),&source,producer::request<Soul>(&source,0,sc.ctx()),sc.ctx());
    let (a,b)=lifecycle::swap_roots_for_testing(a,b);
    let _=lifecycle::construction_ref(&a);
    let _=lifecycle::construction_ref(&b);
    abort 0
}
