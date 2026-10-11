#[test_only]
module soulidity_v1::market_independent_gate_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use sui::coin::{Self,Coin};
use soulidity_foundation::economics::{Self,Admin,Authority,Config};
use soulidity_foundation::revenue;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Control,Product};
use soulidity_v1::catalog;
use soulidity_market::market::{Listing};
use soulidity_v1::market;
use soulidity_v1::player;

fun close(sc:Scenario,c:Config<USD>,a:Admin){test_scenario::return_shared(c);sc.return_to_sender(a);sc.end();}
fun setup():(Scenario,Config<USD>,Admin){let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let c:Config<USD> = sc.take_shared();let a:Admin=sc.take_from_sender();(sc,c,a)}
fun primary(c:&mut Config<USD>,a:&mut Admin,enabled:bool){let revision=economics::revision(c);let hash=economics::commitment(c);economics::set_primary_enabled(c,a,revision,hash,enabled)}
fun secondary(c:&mut Config<USD>,a:&mut Admin,enabled:bool){let revision=economics::revision(c);let hash=economics::commitment(c);economics::set_secondary_enabled(c,a,revision,hash,enabled)}
fun sum(sc:&Scenario):u64{let mut n=0;sc.ids_for_sender<Coin<USD>>().do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);n=n+coin::value(&c);sc.return_to_sender(c)});n}
fun listed():(Scenario,ID,ID){
    let(mut sc,c,a)=setup();let mut p:Product<USD> =sc.take_shared();let mut cap:Control=sc.take_from_sender();catalog::lifecycle(&mut p,&mut cap,1,2);let asset=object::id(&cap);
    test_scenario::return_shared(p);test_scenario::return_shared(c);sc.return_to_sender(a);transfer::public_transfer(cap,@0xb);sc.next_tx(@0xb);
    let cap:Control=sc.take_from_sender();let p:Product<USD> =sc.take_shared();let c:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let id=market::list_control(cap,&p,&c,101,1000,1,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(c);sc.next_tx(@0xa);(sc,id,asset)
}

#[test]
fun fresh_real_config_starts_with_both_lanes_disabled(){
    let mut sc=test_scenario::begin(@0xa);economics::init_for_testing(sc.ctx());sc.next_tx(@0xa);let auth:Authority=sc.take_from_sender();
    soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,0,0,0,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xa);
    let c:Config<USD> = sc.take_shared();let a:Admin=sc.take_from_sender();
    assert!(!economics::enabled(&c) && !economics::primary_enabled(&c) && !economics::secondary_enabled(&c),0);
    assert!(economics::commitment(&c)==economics::operational_snapshot_hash(&economics::operational_snapshot(&c)),1);close(sc,c,a)
}

#[test]
fun secondary_off_still_allows_actual_maker_creation(){
    let(mut sc,mut c,mut a)=setup();let root=object::id(&c);let before=economics::commitment(&c);secondary(&mut c,&mut a,false);
    assert!(economics::primary_enabled(&c) && !economics::secondary_enabled(&c) && economics::revision(&c)==1 && before!=economics::commitment(&c),0);
    let id=catalog::create_maker(&c,0,sc.ctx());close(sc,c,a);assert!(id!=root,1)
}

#[test]
fun primary_off_preserves_actual_control_sale_id_and_money(){
    let(mut sc,mut c,mut a)=setup();primary(&mut c,&mut a,false);assert!(!economics::primary_enabled(&c) && economics::secondary_enabled(&c),0);
    let mut p:Product<USD> =sc.take_shared();let mut cap:Control=sc.take_from_sender();catalog::lifecycle(&mut p,&mut cap,1,2);let asset=object::id(&cap);
    test_scenario::return_shared(p);test_scenario::return_shared(c);sc.return_to_sender(a);transfer::public_transfer(cap,@0xb);sc.next_tx(@0xb);
    let cap:Control=sc.take_from_sender();let p:Product<USD> =sc.take_shared();let c:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let id=market::list_control(cap,&p,&c,101,1000,1,1,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(c);sc.next_tx(@0xc);
    let mut l:Listing<Control,USD> =sc.take_shared_by_id(id);let p:Product<USD> =sc.take_shared();let mut c:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let q=market::control_quote_hash(&l,&c,@0xc);let h=market::manifest_hash(&l);let pay=coin::mint_for_testing<USD>(101,sc.ctx());
    market::buy_control(&mut l,&p,&mut c,0,h,q,1,fixtures::h(91),pay,&clock,sc.ctx());clock::destroy_for_testing(clock);
    assert!(market::status(&l)==1 && revenue::balance(economics::income(&c))==2 && !economics::primary_enabled(&c),1);
    test_scenario::return_shared(l);test_scenario::return_shared(p);test_scenario::return_shared(c);sc.next_tx(@0xc);let cap:Control=sc.take_from_sender();assert!(object::id(&cap)==asset,2);sc.return_to_sender(cap);
    sc.next_tx(@0xb);assert!(sum(&sc)==94,3);sc.next_tx(@0xa);assert!(sum(&sc)==5,4);sc.end();
}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun primary_off_blocks_actual_maker_creation(){let(mut sc,mut c,mut a)=setup();primary(&mut c,&mut a,false);catalog::create_maker(&c,0,sc.ctx());close(sc,c,a)}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun primary_off_blocks_free_player_entry(){let(mut sc,mut c,mut a)=setup();primary(&mut c,&mut a,false);let mut p:Product<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());player::create_for_testing(&mut p,&c,1,1,1000,fixtures::h(92),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);close(sc,c,a)}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun primary_off_blocks_cached_primary_quote(){let(sc,mut c,mut a)=setup();let p=economics::primary_policy(&c);primary(&mut c,&mut a,false);economics::primary_quote(&p,&c,100,false,@0xb,object::id(&c),fixtures::h(1),@0xa,fixtures::h(93),1000);close(sc,c,a)}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun secondary_off_blocks_market_quote(){let(mut sc,mut c,mut a)=setup();let p=economics::market_policy(&c,0,sc.ctx());secondary(&mut c,&mut a,false);economics::market_quote(&p,&c,0,101,@0xb);close(sc,c,a)}

#[test]
fun each_gate_is_independent_and_full_commitment_covers_flags(){
    let(sc,mut c,mut a)=setup();let root=object::id(&c);let before=economics::commitment(&c);primary(&mut c,&mut a,false);let after=economics::commitment(&c);
    assert!(before!=after && !economics::primary_enabled(&c) && economics::secondary_enabled(&c),0);
    secondary(&mut c,&mut a,false);primary(&mut c,&mut a,true);
    assert!(economics::primary_enabled(&c) && !economics::secondary_enabled(&c) && economics::revision(&c)==3 && object::id(&c)==root,1);
    assert!(economics::commitment(&c)==economics::operational_snapshot_hash(&economics::operational_snapshot(&c)) && economics::commitment(&c)!=economics::snapshot_hash(&economics::snapshot(&c)),2);close(sc,c,a)
}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun stale_revision_and_commitment_cannot_change_other_gate(){let(sc,mut c,mut a)=setup();let old=economics::commitment(&c);primary(&mut c,&mut a,false);economics::set_secondary_enabled(&mut c,&mut a,0,old,false);close(sc,c,a)}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun changed_gate_invalidates_previously_exact_quote_revision(){let(mut sc,mut c,mut a)=setup();primary(&mut c,&mut a,false);primary(&mut c,&mut a,true);let clock=clock::create_for_testing(sc.ctx());economics::assert_primary_live(&c,0,1000,&clock);clock::destroy_for_testing(clock);close(sc,c,a)}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun wrong_config_admin_cannot_change_gate(){
    let(mut sc,c,a)=setup();let id=object::id(&c);let admin_id=object::id(&a);test_scenario::return_shared(c);sc.return_to_sender(a);
    let auth:Authority=sc.take_from_sender();soulidity_v1::native_binding::create_config_for_testing<USD>(&auth,0,0,0,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xa);
    let mut c:Config<USD> =sc.take_shared_by_id(id);let mut other=option::none();sc.ids_for_sender<Admin>().do_ref!(|id|{if(*id!=admin_id)other=option::some(*id)});let mut a:Admin=sc.take_from_sender_by_id(other.destroy_some());primary(&mut c,&mut a,false);close(sc,c,a)
}

#[test]
fun both_lanes_off_preserve_real_settled_funds_exit(){
    let(mut sc,mut c,mut a)=setup();economics::deposit_income(&mut c,coin::mint_for_testing<USD>(7,sc.ctx()));primary(&mut c,&mut a,false);secondary(&mut c,&mut a,false);
    economics::withdraw_income(&mut c,&mut a,1,7,@0xb,fixtures::h(94),sc.ctx());assert!(revenue::balance(economics::income(&c))==0,0);
    test_scenario::return_shared(c);sc.return_to_sender(a);sc.next_tx(@0xb);assert!(sum(&sc)==7,1);sc.end();
}

#[test]
fun both_lanes_off_preserve_cancel_and_original_control_id(){
    let(mut sc,id,asset)=listed();let mut c:Config<USD> =sc.take_shared();let mut a:Admin=sc.take_from_sender();primary(&mut c,&mut a,false);secondary(&mut c,&mut a,false);
    test_scenario::return_shared(c);sc.return_to_sender(a);sc.next_tx(@0xb);let mut l:Listing<Control,USD> =sc.take_shared_by_id(id);market::cancel(&mut l,0,sc.ctx());assert!(market::status(&l)==2,0);test_scenario::return_shared(l);
    sc.next_tx(@0xb);let cap:Control=sc.take_from_sender();assert!(object::id(&cap)==asset,1);sc.return_to_sender(cap);sc.end();
}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun secondary_off_blocks_existing_control_listing_purchase(){
    let(mut sc,id,_)=listed();let mut c:Config<USD> =sc.take_shared();let mut a:Admin=sc.take_from_sender();secondary(&mut c,&mut a,false);test_scenario::return_shared(c);sc.return_to_sender(a);
    sc.next_tx(@0xc);let mut l:Listing<Control,USD> =sc.take_shared_by_id(id);let p:Product<USD> =sc.take_shared();let mut c:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let h=market::manifest_hash(&l);let pay=coin::mint_for_testing<USD>(101,sc.ctx());
    market::buy_control(&mut l,&p,&mut c,0,h,fixtures::h(1),1,fixtures::h(95),pay,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(l);test_scenario::return_shared(p);test_scenario::return_shared(c);sc.end();
}

#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun gate_replay_with_current_revision_but_wrong_hash_is_rejected(){let(sc,mut c,mut a)=setup();economics::set_primary_enabled(&mut c,&mut a,0,fixtures::h(99),false);close(sc,c,a)}

#[test]
fun original_same_value_update_preserves_flags_and_advances_revision(){let(sc,mut c,mut a)=setup();let before=economics::commitment(&c);primary(&mut c,&mut a,true);assert!(economics::primary_enabled(&c) && economics::secondary_enabled(&c) && economics::revision(&c)==1 && economics::commitment(&c)!=before,0);close(sc,c,a)}
