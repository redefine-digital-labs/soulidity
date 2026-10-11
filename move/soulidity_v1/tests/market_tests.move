#[test_only]
module soulidity_v1::market_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use sui::coin::{Self,Coin};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_market::market::{Listing};
use soulidity_v1::market;
use soulidity_model::components::Item;

fun listed():Scenario {
    let mut sc=fixtures::setup(0,0,0,0,0,0);fixtures::mint(&mut sc,20,0);native_fee(&mut sc);
    sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender();let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    soul::grant(&mut s,@0x8,1,option::some(1000),0,option::none(),&clock,sc.ctx());soul::unmount_bound(&mut s,b"bound",1);
    let rev=soul::revision(&s);let hash=soul::manifest_hash(&s);market::list_soul(s,&cfg,101,1000,rev,hash,1,&clock,sc.ctx());
    clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);sc.next_tx(@0xc);sc
}
fun buy(sc:&mut Scenario,payment:u64) {
    let mut l:Listing<Soul,USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=market::manifest_hash(&l);
    let q=market::soul_quote_hash(&l,&mut cfg,sc.sender());let pay=coin::mint_for_testing<USD>(payment,sc.ctx());market::buy_soul(&mut l,&mut cfg,0,hash,q,1,fixtures::h(40),pay,&clock,sc.ctx());
    clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);test_scenario::return_shared(l);
}
#[test]
fun whole_sale_includes_unmounted_bound_and_clears_grants() {
    let mut sc=listed();let l:Listing<Soul,USD> = sc.take_shared();assert!(soul::manifest_bound_count(&market::bundle(&l))==1,0);test_scenario::return_shared(l);sc.next_tx(@0xc);
    buy(&mut sc,101);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender();assert!(soul::grant_count(&s)==0 && soul::generation(&s)==1,1);
    assert!(soul::bound_count(&s)==1 && soul::binding(&s,b"bound").is_none(),2);assert!(soul::free_id(&soul::binding(&s,b"free").destroy_some()).is_some(),3);
    soul::remount_bound(&mut s,0,b"bound",fixtures::layout(),3);sc.return_to_sender(s);
    let l:Listing<Soul,USD> = sc.take_shared();assert!(market::status(&l)==1 && market::buyer(&l)==option::some(@0xc) && market::receipt(&l)==option::some(fixtures::h(40)),4);test_scenario::return_shared(l);
    sc.next_tx(@0xb);assert!(coin_sum(&sc)==94,5);
    sc.next_tx(@0xa);let creator:Coin<USD> = sc.take_from_sender();assert!(coin::value(&creator)==5,6);sc.return_to_sender(creator);
    sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==2 && sc.ids_for_sender<Coin<USD>>().is_empty(),7);sc.end();
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_maker_terms::maker_resale)]
fun failed_payment_cannot_handover(){let mut sc=listed();buy(&mut sc,100);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_market::market)]
fun sold_receipt_prevents_second_buyer(){let mut sc=listed();buy(&mut sc,101);sc.next_tx(@0x9);buy(&mut sc,101);sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_market::market)]
fun only_seller_can_cancel(){let mut sc=listed();let mut l:Listing<Soul,USD> = sc.take_shared();market::cancel(&mut l,0,sc.ctx());test_scenario::return_shared(l);sc.end();}
#[test]
fun seller_can_cancel_after_protocol_pause(){
    let mut sc=listed();sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,1,1000,250,0,@0xf,true);test_scenario::return_shared(cfg);sc.return_to_sender(admin);
    sc.next_tx(@0xb);let mut l:Listing<Soul,USD> = sc.take_shared();market::cancel(&mut l,0,sc.ctx());assert!(market::status(&l)==2,0);test_scenario::return_shared(l);
    sc.next_tx(@0xb);let s:Soul=sc.take_from_sender();assert!(soul::bound_count(&s)==1 && soul::grant_count(&s)==1,1);sc.return_to_sender(s);sc.end();
}
#[test]
fun detached_item_sold_with_original_id(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender();let it=soul::detach(&mut s,b"free",0);let id=object::id(&it);sc.return_to_sender(s);
    let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());market::list_item(it,&cfg,101,1000,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);
    sc.next_tx(@0xc);let mut l:Listing<Item,USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=market::manifest_hash(&l);let q=market::item_quote_hash(&l,&mut cfg,@0xc);let pay=coin::mint_for_testing<USD>(101,sc.ctx());market::buy_item(&mut l,&mut cfg,0,hash,q,0,fixtures::h(40),pay,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);test_scenario::return_shared(l);
    sc.next_tx(@0xc);let it:Item=sc.take_from_sender();assert!(object::id(&it)==id,0);sc.return_to_sender(it);sc.end();
}
#[test]
fun maker_control_sale_preserves_product_and_usage(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let mut p:Product<USD> = sc.take_shared();let mut c:Control=sc.take_from_sender();catalog::lifecycle(&mut p,&mut c,1,2);let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());market::list_control(c,&p,&cfg,101,1000,1,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);
    sc.next_tx(@0xc);let mut l:Listing<Control,USD> = sc.take_shared();let p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=market::manifest_hash(&l);let q=market::control_quote_hash(&l,&mut cfg,@0xc);let pay=coin::mint_for_testing<USD>(101,sc.ctx());market::buy_control(&mut l,&p,&mut cfg,0,hash,q,0,fixtures::h(40),pay,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);test_scenario::return_shared(l);
    sc.next_tx(@0xc);let c:Control=sc.take_from_sender();let p:Product<USD> = sc.take_shared();catalog::assert_control(&p,&c);assert!(catalog::current_version(&p)==1,0);test_scenario::return_shared(p);sc.return_to_sender(c);sc.end();
}

fun native_fee(sc:&mut Scenario){sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,1000,250,0,@0xf,false);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);}
fun coin_sum(sc:&Scenario):u64{let ids=sc.ids_for_sender<Coin<USD>>();let mut n=0;ids.do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);n=n+coin::value(&c);sc.return_to_sender(c)});n}

#[test]
fun original_third_wallet_reclaims_cancelled_soul_listing_after_pause(){
    let mut sc=listed();sc.next_tx(@0xb);let mut l:Listing<Soul,USD> =sc.take_shared();market::cancel(&mut l,0,sc.ctx());test_scenario::return_shared(l);
    sc.next_tx(@0xa);let mut cfg:Config<USD> =sc.take_shared();let mut a:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut a,1,1000,250,0,@0xf,true);test_scenario::return_shared(cfg);sc.return_to_sender(a);
    sc.next_tx(@0x9);let l:Listing<Soul,USD> =sc.take_shared();market::delete_listing(l,sc.ctx());
    assert!(sui::event::events_by_type<soulidity_market::market::ListingDeleted>().length()==1,2);
    sc.next_tx(@0xb);assert!(!test_scenario::has_most_recent_shared<Listing<Soul,USD>>(),0);
    let s:Soul=sc.take_from_sender();assert!(soul::bound_count(&s)==1 && soul::grant_count(&s)==1 && soul::binding(&s,b"free").is_some(),1);sc.return_to_sender(s);
    sc.end();
}
#[test]
fun original_third_wallet_reclaims_sold_soul_listing_without_touching_buyer(){
    let mut sc=listed();buy(&mut sc,101);sc.next_tx(@0x9);let l:Listing<Soul,USD> =sc.take_shared();market::delete_listing(l,sc.ctx());
    assert!(sui::event::events_by_type<soulidity_market::market::ListingDeleted>().length()==1,1);
    sc.next_tx(@0xc);let s:Soul=sc.take_from_sender();assert!(soul::bound_count(&s)==1 && soul::grant_count(&s)==0 && soul::binding(&s,b"free").is_some(),0);sc.return_to_sender(s);
    assert!(!test_scenario::has_most_recent_shared<Listing<Soul,USD>>(),1);
    sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==2,2);sc.end();
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_market::market)]
fun original_live_soul_listing_cannot_be_reclaimed_by_third_wallet(){
    let mut sc=listed();sc.next_tx(@0x9);let l:Listing<Soul,USD> =sc.take_shared();market::delete_listing(l,sc.ctx());sc.end();
}
#[test]
fun terminal_item_cleanup_preserves_original_free_asset_id(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender();let it=soul::detach(&mut s,b"free",0);let id=object::id(&it);sc.return_to_sender(s);
    let cfg:Config<USD> =sc.take_shared();let c=clock::create_for_testing(sc.ctx());market::list_item(it,&cfg,101,1000,0,&c,sc.ctx());clock::destroy_for_testing(c);test_scenario::return_shared(cfg);
    sc.next_tx(@0xb);let mut l:Listing<Item,USD> =sc.take_shared();market::cancel(&mut l,0,sc.ctx());test_scenario::return_shared(l);
    sc.next_tx(@0x9);let l:Listing<Item,USD> =sc.take_shared();market::delete_listing(l,sc.ctx());
    sc.next_tx(@0xb);let it:Item=sc.take_from_sender_by_id(id);assert!(object::id(&it)==id && !test_scenario::has_most_recent_shared<Listing<Item,USD>>(),0);sc.return_to_sender(it);sc.end();
}
#[test]
fun terminal_control_cleanup_preserves_original_control_and_product(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let mut p:Product<USD> =sc.take_shared();let mut c:Control=sc.take_from_sender();let id=object::id(&c);let product=object::id(&p);catalog::lifecycle(&mut p,&mut c,1,2);
    let cfg:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());market::list_control(c,&p,&cfg,101,1000,1,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);
    sc.next_tx(@0xa);let mut l:Listing<Control,USD> =sc.take_shared();market::cancel(&mut l,0,sc.ctx());test_scenario::return_shared(l);
    sc.next_tx(@0x9);let l:Listing<Control,USD> =sc.take_shared();market::delete_listing(l,sc.ctx());
    sc.next_tx(@0xa);let c:Control=sc.take_from_sender_by_id(id);let p:Product<USD> =sc.take_shared_by_id(product);catalog::assert_control(&p,&c);assert!(!test_scenario::has_most_recent_shared<Listing<Control,USD>>() && catalog::current_version(&p)==1,0);test_scenario::return_shared(p);sc.return_to_sender(c);sc.end();
}
#[test]
fun soul_sale_platform_income_withdraws_after_protocol_pause(){let mut sc=listed();buy(&mut sc,101);sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();assert!(soulidity_foundation::revenue::balance(economics::income(&cfg))==2 && soulidity_foundation::revenue::revision(economics::income(&cfg))==1,0);economics::configure(&mut cfg,&mut admin,1,1000,250,0,@0xe,true);economics::withdraw_income(&mut cfg,&mut admin,1,2,@0x9,fixtures::h(50),sc.ctx());assert!(soulidity_foundation::revenue::balance(economics::income(&cfg))==0 && soulidity_foundation::revenue::withdrawn(economics::income(&cfg))==2,1);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0x9);assert!(coin_sum(&sc)==2,2);sc.end();}

public struct VaultAsset has key,store {id:UID,value:u64}
fun listed_with_tool():(Scenario,ID,ID,ID){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,20,0);native_fee(&mut sc);
    sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(root);
    let r=soulidity_standard::soul::revision(&s);let tool=soulidity_application::vault::install(&mut s,r,sc.ctx());
    let r=soulidity_standard::soul::revision(&s);let payment=coin::mint_for_testing<USD>(100,sc.ctx());
    soulidity_application::vault::deposit_coin(&mut s,payment,fixtures::h(70),0,r,sc.ctx());
    let a=VaultAsset{id:object::new(sc.ctx()),value:17};let asset=object::id(&a);
    let r=soulidity_standard::soul::revision(&s);soulidity_application::vault::deposit_asset(&mut s,a,fixtures::h(71),1,r,sc.ctx());
    let cfg:Config<USD> =sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let rev=soul::revision(&s);let hash=soul::manifest_hash(&s);
    market::list_soul(s,&cfg,101,1000,rev,hash,1,&clock,sc.ctx());
    clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);sc.next_tx(@0xc);(sc,root,tool,asset)
}
#[test]
fun whole_sale_inventory_carries_tool_money_and_original_asset(){
    let(mut sc,root,tool,asset)=listed_with_tool();let l:Listing<Soul,USD> =sc.take_shared();
    let inventory=market::bundle_vault(&l).destroy_some();
    assert!(soulidity_application::vault::snapshot_root(&inventory)==root && soulidity_application::vault::snapshot_tool(&inventory)==tool,20);
    let coins=soulidity_application::vault::snapshot_coins(&inventory);let assets=soulidity_application::vault::snapshot_assets(&inventory);
    assert!(coins.length()==1 && soulidity_application::vault::summary_balance(&coins[0])==100 && soulidity_application::vault::summary_coin(&coins[0])==std::type_name::with_original_ids<USD>(),21);
    assert!(assets.length()==1 && soulidity_application::vault::summary_asset(&assets[0])==asset && soulidity_application::vault::summary_asset_type(&assets[0])==std::type_name::with_original_ids<VaultAsset>(),22);
    test_scenario::return_shared(l);sc.next_tx(@0xc);buy(&mut sc,101);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(root);
    assert!(object::id(soulidity_application::vault::tool(&s))==tool && soulidity_application::vault::privacy_generation(soulidity_application::vault::tool(&s))==1 && soulidity_application::vault::coin_balance<USD>(&s)==100,23);
    assert!(soulidity_application::vault::action(&s,fixtures::h(70)).is_some() && soulidity_application::vault::has_asset<VaultAsset>(&s,asset),24);
    let r=soulidity_standard::soul::revision(&s);let payment=soulidity_application::vault::withdraw_coin<USD>(&mut s,100,fixtures::h(72),3,r,sc.ctx());
    assert!(coin::value(&payment)==100,25);transfer::public_transfer(payment,@0xc);
    let r=soulidity_standard::soul::revision(&s);let a:VaultAsset=soulidity_application::vault::withdraw_asset(&mut s,asset,fixtures::h(73),4,r,sc.ctx());
    assert!(object::id(&a)==asset && a.value==17 && soulidity_application::vault::coin_balance<USD>(&s)==0,26);
    transfer::public_transfer(a,@0xc);sc.return_to_sender(s);sc.next_tx(@0xb);
    assert!(sc.ids_for_sender<Soul>().is_empty() && sc.ids_for_sender<VaultAsset>().is_empty(),27);sc.end();
}
#[test]
fun cancelled_sale_preserves_same_tool_scope_and_funds(){
    let(mut sc,root,tool,asset)=listed_with_tool();let l:Listing<Soul,USD> =sc.take_shared();let before=market::bundle_vault(&l).destroy_some();test_scenario::return_shared(l);
    sc.next_tx(@0xb);let mut l:Listing<Soul,USD> =sc.take_shared();market::cancel(&mut l,0,sc.ctx());test_scenario::return_shared(l);
    sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);assert!(soulidity_application::vault::snapshot(&s)==before && object::id(soulidity_application::vault::tool(&s))==tool && soulidity_application::vault::has_asset<VaultAsset>(&s,asset),28);
    sc.return_to_sender(s);sc.end();
}
