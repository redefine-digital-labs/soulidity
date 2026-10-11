#[test_only]
module soulidity_v1::market_global_gate_tests;
use sui::test_scenario;
use soulidity_foundation::economics::{Self,Admin,Config};
use soulidity_v1::fixtures::{Self,USD};

fun primary(paused:bool,disabled:bool){
    let mut sc=fixtures::setup(0,0,0,0,0,0);
    sc.next_tx(@0xa);
    let mut c:Config<USD> = sc.take_shared();
    let mut a:Admin = sc.take_from_sender();
    if(paused)economics::configure(&mut c,&mut a,0,1000,500,0,@0xf,true);
    if(disabled){let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,0,hash,false)};
    economics::primary_policy(&c);
    test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();
}
fun secondary(paused:bool,disabled:bool){
    let mut sc=fixtures::setup(0,0,0,0,0,0);
    sc.next_tx(@0xa);
    let mut c:Config<USD> = sc.take_shared();
    let mut a:Admin = sc.take_from_sender();
    if(paused)economics::configure(&mut c,&mut a,0,1000,500,0,@0xf,true);
    if(disabled){let hash=economics::commitment(&c);economics::set_enabled(&mut c,&mut a,0,hash,false)};
    economics::market_policy(&c,0,sc.ctx());
    test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();
}
#[test]
fun global_enabled_permits_both_primary_and_secondary_policy(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);
    let c:Config<USD> = sc.take_shared();
    economics::primary_policy(&c);economics::market_policy(&c,0,sc.ctx());
    test_scenario::return_shared(c);sc.end();
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun global_pause_blocks_primary_policy(){primary(true,false)}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun global_pause_also_blocks_secondary_policy(){secondary(true,false)}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun global_disable_blocks_primary_policy(){primary(false,true)}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun global_disable_also_blocks_secondary_policy(){secondary(false,true)}
