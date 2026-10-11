#[test_only]
module soulidity_v1::commerce_tests;
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use sui::coin::{Self,Coin};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_market::market::{Listing};
use soulidity_v1::market;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_model::components::{Self as item,Item};
use soulidity_model::policy;

fun setup(lane:u8,price:u64):(Scenario,ID) {
    let mut sc=fixtures::setup(0,0,0,0,0,0);let mut asset_id=object::id_from_address(@0x0);
    if(lane==0){
        sc.next_tx(@0xa);let mut cap:Control=sc.take_from_sender();let mut p:Product<USD> = sc.take_shared();catalog::lifecycle(&mut p,&mut cap,1,2);test_scenario::return_shared(p);asset_id=object::id(&cap);transfer::public_transfer(cap,@0xb);
        sc.next_tx(@0xb);let cap:Control=sc.take_from_sender();let p:Product<USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());market::list_control(cap,&p,&cfg,price,1000,1,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);
    } else {
        fixtures::mint(&mut sc,20,0);sc.next_tx(@0xb);let mut soul:Soul=sc.take_from_sender();let it=soul::detach(&mut soul,b"free",0);asset_id=object::id(&it);sc.return_to_sender(soul);
        let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());market::list_item(it,&cfg,price,1000,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);
    };
    sc.next_tx(@0xc);(sc,asset_id)
}
fun buy_control(sc:&mut Scenario,amount:u64,revision:u64,quote:Option<vector<u8>>) {
    let mut l:Listing<Control,USD> = sc.take_shared();let p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let q=if(quote.is_some())quote.destroy_some() else market::control_quote_hash(&l,&cfg,sc.sender());let hash=market::manifest_hash(&l);let pay=coin::mint_for_testing<USD>(amount,sc.ctx());
    market::buy_control(&mut l,&p,&mut cfg,0,hash,q,revision,fixtures::h(40),pay,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);test_scenario::return_shared(l)
}
fun buy_item(sc:&mut Scenario,amount:u64,revision:u64,quote:Option<vector<u8>>) {
    let mut l:Listing<Item,USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());
    let q=if(quote.is_some())quote.destroy_some() else market::item_quote_hash(&l,&cfg,sc.sender());let hash=market::manifest_hash(&l);let pay=coin::mint_for_testing<USD>(amount,sc.ctx());
    market::buy_item(&mut l,&mut cfg,0,hash,q,revision,fixtures::h(40),pay,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);test_scenario::return_shared(l)
}
fun sum(sc:&Scenario):u64{let ids=sc.ids_for_sender<Coin<USD>>();let mut n=0;ids.do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);n=n+coin::value(&c);sc.return_to_sender(c)});n}
#[test]
fun control_protocol_income_is_redeemable_after_sale(){let(mut sc,_)=setup(0,101);buy_control(&mut sc,101,0,option::none());sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();assert!(soulidity_foundation::revenue::balance(economics::income(&cfg))==2,0);economics::withdraw_income(&mut cfg,&mut admin,1,2,@0x9,fixtures::h(50),sc.ctx());test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0x9);assert!(sum(&sc)==2,1);sc.next_tx(@0xa);assert!(sum(&sc)==5,2);sc.next_tx(@0xb);assert!(sum(&sc)==94,3);sc.end();}
#[test]
fun item_protocol_income_is_redeemable_after_sale(){let(mut sc,_)=setup(1,101);buy_item(&mut sc,101,0,option::none());sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::withdraw_income(&mut cfg,&mut admin,1,2,@0x9,fixtures::h(50),sc.ctx());test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0x9);assert!(sum(&sc)==2,4);sc.next_tx(@0xb);assert!(sum(&sc)==99,5);sc.end();}
fun config_change(sc:&mut Scenario,paused:bool){sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,9000,9000,999,@0xe,paused);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xc);}
fun control_hash(sc:&mut Scenario,buyer:address):vector<u8>{let l:Listing<Control,USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();let h=market::control_quote_hash(&l,&cfg,buyer);test_scenario::return_shared(l);test_scenario::return_shared(cfg);sc.next_tx(@0xc);h}
fun item_hash(sc:&mut Scenario,buyer:address):vector<u8>{let l:Listing<Item,USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();let h=market::item_quote_hash(&l,&cfg,buyer);test_scenario::return_shared(l);test_scenario::return_shared(cfg);sc.next_tx(@0xc);h}
#[test]
fun control_sale_pays_original_creator_not_seller_or_primary_beneficiary(){
    let(mut sc,id)=setup(0,101);buy_control(&mut sc,101,0,option::none());sc.next_tx(@0xc);let cap:Control=sc.take_from_sender();assert!(object::id(&cap)==id,0);sc.return_to_sender(cap);
    let l:Listing<Control,USD> = sc.take_shared();let r=market::asset_settlement(&l).destroy_some();assert!(economics::market_receipt_lane(&r)==0 && economics::market_receipt_gross(&r)==101 && economics::market_receipt_seller_amount(&r)==94 && economics::market_receipt_platform_amount(&r)==2 && economics::market_receipt_creator_amount(&r)==5,1);assert!(economics::market_creator(&economics::market_receipt_policy(&r))==@0xa && economics::market_receipt_seller(&r)==@0xb && market::status(&l)==1,2);test_scenario::return_shared(l);
    sc.next_tx(@0xb);assert!(sum(&sc)==94,3);sc.next_tx(@0xa);assert!(sum(&sc)==5,4);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==2 && sum(&sc)==0,5);sc.next_tx(@0xd);assert!(sum(&sc)==0,6);sc.end();
}
#[test]
fun equipment_sale_only_charges_fixed_platform_preserves_object(){
    let(mut sc,id)=setup(1,101);buy_item(&mut sc,101,0,option::none());sc.next_tx(@0xc);let it:Item=sc.take_from_sender();assert!(object::id(&it)==id && policy::royalty(item::source(&it))==1000 && policy::beneficiary(item::source(&it))==@0xd,0);sc.return_to_sender(it);
    let l:Listing<Item,USD> = sc.take_shared();let r=market::asset_settlement(&l).destroy_some();assert!(economics::market_receipt_lane(&r)==1 && economics::market_receipt_seller_amount(&r)==99 && economics::market_receipt_platform_amount(&r)==2 && economics::market_receipt_creator_amount(&r)==0,1);test_scenario::return_shared(l);
    sc.next_tx(@0xb);assert!(sum(&sc)==99,2);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==2 && sum(&sc)==0,3);sc.next_tx(@0xd);assert!(sum(&sc)==0,4);sc.next_tx(@0xa);assert!(sum(&sc)==0,5);sc.end();
}
#[test]
fun current_config_does_not_rewrite_control_published_economics(){let(mut sc,_)=setup(0,101);config_change(&mut sc,false);buy_control(&mut sc,101,1,option::none());sc.next_tx(@0xa);assert!(sum(&sc)==5,0);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==2 && sum(&sc)==0,1);sc.next_tx(@0xe);assert!(sum(&sc)==0,2);sc.next_tx(@0xc);let l:Listing<Control,USD> = sc.take_shared();let r=market::asset_settlement(&l).destroy_some();assert!(economics::market_receipt_revision(&r)==1 && economics::market_revision(&economics::market_receipt_policy(&r))==0,3);test_scenario::return_shared(l);sc.end();}
#[test]
fun current_config_does_not_rewrite_equipment_economics(){let(mut sc,_)=setup(1,101);config_change(&mut sc,false);buy_item(&mut sc,101,1,option::none());sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==2 && sum(&sc)==0,0);sc.next_tx(@0xe);assert!(sum(&sc)==0,1);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun control_quote_binds_buyer(){let(mut sc,_)=setup(0,101);let q=control_hash(&mut sc,@0x9);buy_control(&mut sc,101,0,option::some(q));sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun item_quote_binds_buyer(){let(mut sc,_)=setup(1,101);let q=item_hash(&mut sc,@0x9);buy_item(&mut sc,101,0,option::some(q));sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun stale_control_quote_rejected_even_with_fresh_revision(){let(mut sc,_)=setup(0,101);let q=control_hash(&mut sc,@0xc);config_change(&mut sc,false);buy_control(&mut sc,101,1,option::some(q));sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun stale_item_quote_rejected_even_with_fresh_revision(){let(mut sc,_)=setup(1,101);let q=item_hash(&mut sc,@0xc);config_change(&mut sc,false);buy_item(&mut sc,101,1,option::some(q));sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun equipment_nonzero_fee_may_not_floor_to_zero(){let(sc,_)=setup(1,39);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun control_nonzero_fee_may_not_floor_to_zero(){let(sc,_)=setup(0,39);sc.end();}
#[test]
fun minimum_control_price_is_40(){let(mut sc,_)=setup(0,40);buy_control(&mut sc,40,0,option::none());sc.next_tx(@0xb);assert!(sum(&sc)==37,0);sc.next_tx(@0xa);assert!(sum(&sc)==2,1);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==1 && sum(&sc)==0,2);sc.end();}
#[test]
fun minimum_equipment_price_is_40(){let(mut sc,_)=setup(1,40);buy_item(&mut sc,40,0,option::none());sc.next_tx(@0xb);assert!(sum(&sc)==39,3);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==1 && sum(&sc)==0,4);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun control_payment_must_equal_gross(){let(mut sc,_)=setup(0,101);buy_control(&mut sc,102,0,option::none());sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun item_payment_must_equal_gross(){let(mut sc,_)=setup(1,101);buy_item(&mut sc,100,0,option::none());sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun protocol_pause_still_blocks_control_sale(){let(mut sc,_)=setup(0,101);config_change(&mut sc,true);buy_control(&mut sc,101,1,option::none());sc.end();}
#[test]
fun paused_control_can_be_cancelled_without_losing_id(){let(mut sc,id)=setup(0,101);config_change(&mut sc,true);sc.next_tx(@0xb);let mut l:Listing<Control,USD> = sc.take_shared();market::cancel(&mut l,0,sc.ctx());assert!(market::status(&l)==2 && market::asset_settlement(&l).is_none(),0);test_scenario::return_shared(l);sc.next_tx(@0xb);let cap:Control=sc.take_from_sender();assert!(object::id(&cap)==id,1);sc.return_to_sender(cap);sc.end();}
#[test]
fun max_amount_equipment_funds_conserved(){let(mut sc,_)=setup(1,18446744073709551615);buy_item(&mut sc,18446744073709551615,0,option::none());sc.next_tx(@0xc);let l:Listing<Item,USD> = sc.take_shared();let r=market::asset_settlement(&l).destroy_some();assert!((economics::market_receipt_seller_amount(&r) as u128)+(economics::market_receipt_platform_amount(&r) as u128)==18446744073709551615,0);test_scenario::return_shared(l);sc.end();}
#[test]
fun control_future_version_cannot_redirect_original_royalty(){
    let(mut sc,_)=setup(0,101);buy_control(&mut sc,101,0,option::none());sc.next_tx(@0xc);let mut cap:Control=sc.take_from_sender();let mut p:Product<USD> = sc.take_shared();let registry:soulidity_content_kinds::content_kind_registry::KindRegistry=sc.take_shared();
    let v=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xe,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free"],vector[b"free"],vector[fixtures::def(b"free",2,10)],vector[],fixtures::scene()),vector[fixtures::default_output(&registry,false,true,vector[])]);catalog::publish(&mut p,&mut cap,1,v);catalog::lifecycle(&mut p,&mut cap,2,2);
    let m=catalog::market_policy(&p);assert!(economics::market_creator(&m)==@0xa && economics::control_royalty_bps(&m)==500 && catalog::version_market(catalog::published(&p,1))==m && catalog::version_market(catalog::published(&p,2))==m,0);
    let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let second=market::list_control(cap,&p,&cfg,101,1000,2,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);test_scenario::return_shared(p);test_scenario::return_shared(registry);
    sc.next_tx(@0x9);let mut l:Listing<Control,USD> = sc.take_shared_by_id(second);let p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let h=market::manifest_hash(&l);let q=market::control_quote_hash(&l,&mut cfg,@0x9);market::buy_control(&mut l,&p,&mut cfg,0,h,q,0,fixtures::h(41),coin::mint_for_testing<USD>(101,sc.ctx()),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(cfg);test_scenario::return_shared(p);test_scenario::return_shared(l);
    sc.next_tx(@0xa);assert!(sum(&sc)==10,1);sc.next_tx(@0xc);assert!(sum(&sc)==94,2);sc.next_tx(@0xe);assert!(sum(&sc)==0,3);sc.end();
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun excessive_control_royalty_rejected_at_asset_creation(){let mut sc=fixtures::setup(0,0,0,0,0,0);let cfg:Config<USD> = sc.take_shared();catalog::create_maker(&cfg,1001,sc.ctx());test_scenario::return_shared(cfg);sc.end();}
#[test]
fun zero_and_max_creator_royalties_are_explicit_and_distinct(){let mut sc=fixtures::setup(0,0,0,0,0,0);let cfg:Config<USD> = sc.take_shared();let none=economics::market_policy(&cfg,0,sc.ctx());let max=economics::market_policy(&cfg,1000,sc.ctx());assert!(economics::market_policy_hash(&none)!=economics::market_policy_hash(&max),0);let r=economics::market_quote(&max,&cfg,0,101,@0xb);assert!(economics::market_receipt_creator_amount(&r)==10 && economics::market_receipt_seller_amount(&r)==89,1);let item=economics::market_quote(&max,&cfg,1,101,@0xb);assert!(economics::market_receipt_creator_amount(&item)==0,2);test_scenario::return_shared(cfg);sc.end();}
#[test]
fun pack_control_royalty_uses_its_original_creator_and_preserves_parent(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let maker_cap:Control=sc.take_from_sender();transfer::public_transfer(maker_cap,@0xe);sc.next_tx(@0xe);
    let maker:Product<USD> = sc.take_shared();let mut maker_cap:Control=sc.take_from_sender();let cfg:Config<USD> = sc.take_shared();let id=catalog::create_pack_for_testing(&maker,1,&mut maker_cap,&cfg,500,sc.ctx());let maker_id=object::id(&maker);test_scenario::return_shared(maker);test_scenario::return_shared(cfg);sc.return_to_sender(maker_cap);sc.next_tx(@0xe);
    let mut pack:Product<USD> = sc.take_shared_by_id(id);let mut cap=control_for(&sc,id);let v=catalog::with_pack_key(catalog::version(fixtures::h(3),fixtures::h(4),2,0,0,0,0,0,1000,@0xd,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"bound"],vector[],vector[fixtures::pack_def(b"bound",1,20)],vector[],fixtures::scene()),b"paid-pack");catalog::publish(&mut pack,&mut cap,0,v);catalog::lifecycle(&mut pack,&mut cap,1,2);assert!(catalog::creator(&pack)==@0xe && catalog::parent(&pack)==option::some(maker_id),0);let cap_id=object::id(&cap);test_scenario::return_shared(pack);transfer::public_transfer(cap,@0xb);sc.next_tx(@0xb);
    let pack:Product<USD> = sc.take_shared_by_id(id);let cfg:Config<USD> = sc.take_shared();let cap:Control=sc.take_from_sender();let clock=clock::create_for_testing(sc.ctx());let listing=market::list_control(cap,&pack,&cfg,101,1000,1,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(pack);test_scenario::return_shared(cfg);sc.next_tx(@0xc);
    let pack:Product<USD> = sc.take_shared_by_id(id);let mut cfg:Config<USD> = sc.take_shared();let mut l:Listing<Control,USD> = sc.take_shared_by_id(listing);let clock=clock::create_for_testing(sc.ctx());let q=market::control_quote_hash(&l,&mut cfg,@0xc);let h=market::manifest_hash(&l);market::buy_control(&mut l,&pack,&mut cfg,0,h,q,0,fixtures::h(40),coin::mint_for_testing<USD>(101,sc.ctx()),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(pack);test_scenario::return_shared(cfg);test_scenario::return_shared(l);sc.next_tx(@0xc);let cap:Control=sc.take_from_sender();assert!(object::id(&cap)==cap_id && catalog::control_product(&cap)==id,1);sc.return_to_sender(cap);
    sc.next_tx(@0xe);assert!(sum(&sc)==5,2);sc.next_tx(@0xa);assert!(sum(&sc)==0,3);sc.next_tx(@0xb);assert!(sum(&sc)==94,4);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==2 && sum(&sc)==0,5);sc.end();
}
fun control_for(sc:&Scenario,product:ID):Control {let ids=sc.ids_for_sender<Control>();let mut found=option::none();ids.do_ref!(|id|{let c:Control=sc.take_from_sender_by_id(*id);if(catalog::control_product(&c)==product)found.fill(c) else sc.return_to_sender(c)});found.destroy_some()}
#[test]
#[expected_failure(abort_code=4,location=soulidity_market::market)]
fun item_quote_rejects_same_coin_type_wrong_config(){let(mut sc,_)=setup(1,101);sc.next_tx(@0xa);let auth:soulidity_foundation::economics::Authority=sc.take_from_sender();let id=soulidity_v1::native_binding::create_enabled_for_testing<USD>(&auth,1000,250,0,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xc);let wrong:Config<USD> = sc.take_shared_by_id(id);let l:Listing<Item,USD> = sc.take_shared();market::item_quote(&l,&wrong);test_scenario::return_shared(l);test_scenario::return_shared(wrong);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun control_quote_cannot_replay_after_cancel_and_relist(){let(mut sc,_)=setup(0,101);let q=control_hash(&mut sc,@0xc);sc.next_tx(@0xb);let mut old:Listing<Control,USD> = sc.take_shared();market::cancel(&mut old,0,sc.ctx());test_scenario::return_shared(old);sc.next_tx(@0xb);let cap:Control=sc.take_from_sender();let p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let id=market::list_control(cap,&p,&mut cfg,101,1000,1,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.next_tx(@0xc);let mut l:Listing<Control,USD> = sc.take_shared_by_id(id);let p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let h=market::manifest_hash(&l);market::buy_control(&mut l,&p,&mut cfg,0,h,q,0,fixtures::h(40),coin::mint_for_testing<USD>(101,sc.ctx()),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(l);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_market::market)]
fun sold_control_cannot_settle_again(){let(mut sc,_)=setup(0,101);buy_control(&mut sc,101,0,option::none());sc.next_tx(@0x9);buy_control(&mut sc,101,0,option::none());sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun tiny_nonzero_creator_royalty_must_not_disappear(){let mut sc=fixtures::setup(0,0,0,0,0,0);let cfg:Config<USD> = sc.take_shared();let p=economics::market_policy(&cfg,1,sc.ctx());economics::market_quote(&p,&cfg,0,40,@0xb);test_scenario::return_shared(cfg);sc.end();}
#[test]
fun max_amount_control_funds_conserved(){let(mut sc,_)=setup(0,18446744073709551615);buy_control(&mut sc,18446744073709551615,0,option::none());sc.next_tx(@0xc);let l:Listing<Control,USD> = sc.take_shared();let r=market::asset_settlement(&l).destroy_some();assert!((economics::market_receipt_seller_amount(&r) as u128)+(economics::market_receipt_platform_amount(&r) as u128)+(economics::market_receipt_creator_amount(&r) as u128)==18446744073709551615,0);test_scenario::return_shared(l);sc.end();}
#[test]
fun paused_item_can_be_cancelled_with_original_source_and_id(){let(mut sc,id)=setup(1,101);config_change(&mut sc,true);sc.next_tx(@0xb);let mut l:Listing<Item,USD> = sc.take_shared();market::cancel(&mut l,0,sc.ctx());test_scenario::return_shared(l);sc.next_tx(@0xb);let it:Item=sc.take_from_sender();assert!(object::id(&it)==id && economics::market_platform(&policy::source_market(item::source(&it)))==@0xf,0);sc.return_to_sender(it);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_market::market)]
fun sold_item_cannot_settle_again(){let(mut sc,_)=setup(1,101);buy_item(&mut sc,101,0,option::none());sc.next_tx(@0x9);buy_item(&mut sc,101,0,option::none());sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_catalog)]
fun active_product_control_cannot_list(){let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let cap:Control=sc.take_from_sender();let p:Product<USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());market::list_control(cap,&p,&cfg,101,1000,1,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();}
fun reprice(sc:&mut Scenario,expected:u64,price:u64){let mut l:Listing<Item,USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let h=market::manifest_hash(&l);market::reprice_item(&mut l,&cfg,expected,h,price,2000,0,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(l);test_scenario::return_shared(cfg);sc.next_tx(@0xc);}
#[test]
fun reprice_equipment_keeps_original_asset_and_frozen_fee_policy(){let(mut sc,id)=setup(1,101);sc.next_tx(@0xb);reprice(&mut sc,0,201);let mut l:Listing<Item,USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let q=market::item_quote_hash(&l,&mut cfg,@0xc);let h=market::manifest_hash(&l);assert!(market::revision(&l)==1 && market::price(&l)==201,0);let clock=clock::create_for_testing(sc.ctx());market::buy_item(&mut l,&mut cfg,1,h,q,0,fixtures::h(40),coin::mint_for_testing<USD>(201,sc.ctx()),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(l);test_scenario::return_shared(cfg);sc.next_tx(@0xc);let it:Item=sc.take_from_sender();assert!(object::id(&it)==id,1);sc.return_to_sender(it);sc.next_tx(@0xb);assert!(sum(&sc)==196,2);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==5 && sum(&sc)==0,3);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun item_old_quote_rejected_after_same_price_reprice(){let(mut sc,_)=setup(1,101);let q=item_hash(&mut sc,@0xc);sc.next_tx(@0xb);reprice(&mut sc,0,101);let mut l:Listing<Item,USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let h=market::manifest_hash(&l);market::buy_item(&mut l,&mut cfg,1,h,q,0,fixtures::h(40),coin::mint_for_testing<USD>(101,sc.ctx()),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(l);test_scenario::return_shared(cfg);sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_market::market)]
fun only_seller_can_reprice(){let(mut sc,_)=setup(1,101);reprice(&mut sc,0,201);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_market::market)]
fun reprice_requires_exact_listing_revision(){let(mut sc,_)=setup(1,101);sc.next_tx(@0xb);reprice(&mut sc,1,201);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_foundation::economics)]
fun reprice_cannot_erase_nonzero_equipment_fee(){let(mut sc,_)=setup(1,101);sc.next_tx(@0xb);reprice(&mut sc,0,39);sc.end();}
