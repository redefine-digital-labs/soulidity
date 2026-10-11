#[test_only]
module soulidity_v1::collection_tests;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::kiosk::{Self,Kiosk};
use sui::transfer_policy::{Self,TransferPolicy};
use sui::coin::{Self,Coin};
use sui::clock::{Self,Clock};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_custody::account::{Self as custody,Account};
use soulidity_collection::collection::{Collection,Factory,Right,Listing};
use soulidity_v1::collection;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_v1::market;
public struct F {sc:Scenario,c:Collection,k:Kiosk,a:Account,cfg:Config<USD>,factory:Factory,policy:TransferPolicy<Right>,clock:Clock,s:Soul,spare:Soul}
fun setup(extra:u16,tradeable:bool,max:Option<u64>,floor:Option<u128>,other_creator:bool):F {
    let mut sc=fixtures::setup_collection(0,0,0,0,0,0);collection::init_for_testing(sc.ctx());let kid=custody::create(sc.ctx());let sid=fixtures::mint(&mut sc,71,0);sc.next_tx(if(other_creator)@0xc else @0xb);let spare_id=fixtures::mint(&mut sc,72,0);sc.next_tx(if(other_creator)@0xc else @0xb);let spare:Soul=sc.take_from_sender_by_id(spare_id);transfer::public_transfer(spare,@0xb);sc.next_tx(@0xb);
    let cfg:Config<USD> = sc.take_shared();let factory:Factory=sc.take_shared();let policy:TransferPolicy<Right> = sc.take_shared();let mut k:Kiosk=sc.take_shared_by_id(kid);let mut a:Account=sc.take_from_sender();let clock=clock::create_for_testing(sc.ctx());
    let cid=collection::create(&factory,&policy,&cfg,&mut k,&mut a,string::utf8(b"Collection"),string::utf8(b"Original members"),string::utf8(b"https://example.invalid/cover"),extra,tradeable,max,floor,0,1000,&clock,sc.ctx());sc.next_tx(@0xb);let c:Collection=sc.take_shared_by_id(cid);let s:Soul=sc.take_from_sender_by_id(sid);let spare:Soul=sc.take_from_sender_by_id(spare_id);F{sc,c,k,a,cfg,factory,policy,clock,s,spare}
}
fun normal():F{setup(2000,true,option::some(2),option::some(1000),false)}
fun end(f:F){let F{sc,c,k,a,cfg,factory,policy,clock,s,spare}=f;test_scenario::return_shared(c);test_scenario::return_shared(k);test_scenario::return_shared(cfg);test_scenario::return_shared(factory);test_scenario::return_shared(policy);sc.return_to_sender(a);sc.return_to_sender(s);sc.return_to_sender(spare);clock::destroy_for_testing(clock);sc.end();}
fun add(f:&mut F,cr:u64,sr:u64){collection::add_soul(&mut f.c,&mut f.s,cr,sr,f.sc.ctx())}
fun add_spare(f:&mut F,cr:u64){collection::add_soul(&mut f.c,&mut f.spare,cr,0,f.sc.ctx())}
fun list(f:&mut F):ID{collection::list(&f.c,&mut f.k,&mut f.a,&f.cfg,100,1000,0,0,&f.clock,f.sc.ctx())}
fun buy(f:&mut F,l:&mut Listing<USD>,buyer:&mut Kiosk,a:&mut Account,payment:u64,quote:vector<u8>,epoch:u64) {
    let coin=coin::mint_for_testing<USD>(payment,f.sc.ctx());collection::buy(l,&mut f.c,&f.factory,&f.policy,&mut f.k,buyer,a,&mut f.cfg,0,epoch,0,quote,fixtures::h(80),coin,&f.clock,f.sc.ctx())
}
fun buyer(f:&mut F):(Kiosk,Account){f.sc.next_tx(@0xc);let id=custody::create(f.sc.ctx());f.sc.next_tx(@0xc);(f.sc.take_shared_by_id(id),f.sc.take_from_sender())}
#[test]
fun creation_locks_real_right_under_canonical_policy_and_preserves_metadata() {
    let mut f=normal();assert!(collection::creator(&f.c)==@0xb && collection::current_holder(&f.c)==@0xb && collection::current_kiosk(&f.c)==object::id(&f.k) && collection::ownership_epoch(&f.c)==0 && collection::supply(&f.c)==0,0);assert!(collection::max_supply(&f.c)==option::some(2) && collection::floor_price(&f.c)==option::some(1000) && collection::extra_royalty(&f.c)==2000,1);
    assert!(kiosk::is_locked(&f.k,collection::right_id(&f.c)) && transfer_policy::has_rule<Right,soulidity_collection::collection::Rule>(&f.policy) && collection::factory_policy(&f.factory)==object::id(&f.policy),2);
    assert_metadata(&mut f);end(f)
}
fun assert_metadata(f:&mut F){let r=collection::right_for_testing(&f.cfg,&mut f.k,&f.a,collection::right_id(&f.c),f.sc.ctx());assert!(collection::right_collection(r)==object::id(&f.c) && collection::right_name(r)==string::utf8(b"Collection") && collection::right_description(r)==string::utf8(b"Original members"),0);}
#[test]
fun permanent_membership_preserves_recipe_and_original_player_creator() {
    let mut f=normal();let hash=soul::recipe_hash(&f.s);let manifest=soul::manifest_hash(&f.s);assert!(soul::creator(&f.s)==@0xb && soul::beneficiary(&f.s)==@0xd,0);add(&mut f,0,0);
    assert!(collection::contains(&f.c,object::id(&f.s)) && collection::supply(&f.c)==1 && soul::collection_id(&f.s)==option::some(object::id(&f.c)) && soul::revision(&f.s)==1 && soul::composition_revision(&f.s)==0 && soul::recipe_hash(&f.s)==hash && soul::manifest_hash(&f.s)!=manifest,1);end(f)
}
#[test]
fun native_purchase_cap_sale_relocks_same_right_and_conserves_additional_fee() {
    let mut f=normal();add(&mut f,0,0);let right=collection::right_id(&f.c);let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);
    assert!(collection::current_holder(&f.c)==@0xc && collection::current_kiosk(&f.c)==object::id(&k) && collection::ownership_epoch(&f.c)==1 && collection::creator(&f.c)==@0xb && collection::supply(&f.c)==1 && kiosk::is_locked(&k,right) && !kiosk::has_item(&f.k,right),0);assert!(collection::listing_state(&l)==1 && collection::listing_receipt(&l)==option::some(fixtures::h(80)),1);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xf);assert!(soulidity_foundation::revenue::balance(economics::income(&f.cfg))==5 && f.sc.ids_for_sender<Coin<USD>>().is_empty(),2);f.sc.next_tx(@0xb);let seller:Coin<USD> = f.sc.take_from_sender();assert!(coin::value(&seller)==100,3);f.sc.return_to_sender(seller);add_spare(&mut f,2);assert!(collection::supply(&f.c)==2,4);end(f)
}
#[test]
fun right_sale_protocol_fee_is_withdrawable_after_exact_native_handoff(){let mut f=normal();add(&mut f,0,0);let right=collection::right_id(&f.c);let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);assert!(kiosk::is_locked(&k,right) && collection::current_holder(&f.c)==@0xc && soulidity_foundation::revenue::balance(economics::income(&f.cfg))==5,0);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xa);{let F{sc,cfg,..}=&mut f;let mut admin:Admin=sc.take_from_sender();economics::withdraw_income(cfg,&mut admin,1,5,@0x9,fixtures::h(51),sc.ctx());sc.return_to_sender(admin)};f.sc.next_tx(@0x9);let c:Coin<USD> = f.sc.take_from_sender();assert!(coin::value(&c)==5,1);f.sc.return_to_sender(c);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=6,location=soulidity_collection::collection)]
fun duplicate_member_cannot_consume_supply_twice(){let mut f=normal();add(&mut f,0,0);add(&mut f,1,1);end(f)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_collection::collection)]
fun collection_cap_is_lifetime_membership_cap(){let mut f=setup(2000,true,option::some(1),option::none(),false);add(&mut f,0,0);add_spare(&mut f,1);end(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_collection::collection)]
fun owner_cannot_add_someone_elses_created_soul(){let mut f=setup(2000,true,option::none(),option::none(),true);add_spare(&mut f,0);end(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_collection::collection)]
fun non_creator_cannot_add_a_member(){let mut f=normal();f.sc.next_tx(@0xc);add(&mut f,0,0);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_collection::collection)]
fun stale_collection_revision_cannot_add_member(){let mut f=normal();add(&mut f,1,0);end(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_soul_revision_cannot_bind_membership(){let mut f=normal();add(&mut f,0,1);end(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_collection::collection)]
fun nontradeable_right_cannot_be_listed(){let mut f=setup(2000,false,option::none(),option::none(),false);list(&mut f);end(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_collection::collection)]
fun zero_max_supply_rejected(){end(setup(2000,true,option::some(0),option::none(),false))}
#[test]
#[expected_failure(abort_code=1,location=soulidity_collection::collection)]
fun oversized_floor_policy_rejected(){end(setup(2000,true,option::none(),option::some(100000000000000000000),false))}
#[test]
#[expected_failure(abort_code=1,location=soulidity_collection::collection)]
fun excessive_combined_fee_rejected_at_creation(){end(setup(9600,true,option::none(),option::none(),false))}
#[test]
#[expected_failure(abort_code=8,location=sui::kiosk)]
fun locked_right_cannot_be_taken_even_by_owner(){let mut f=normal();take_locked(&mut f);end(f)}
fun take_locked(f:&mut F){custody::attempt_take_right_for_testing<Right>(&mut f.k,&f.a,collection::right_id(&f.c),@0xc,f.sc.ctx())}
#[test]
#[expected_failure(abort_code=7,location=sui::kiosk)]
fun foreign_extension_cannot_expose_kiosk_uid(){let mut f=normal();kiosk::uid_mut(&mut f.k);end(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_market::market)]
fun collection_member_cannot_use_unbundled_soul_listing(){let mut f=normal();add(&mut f,0,0);let F{mut sc,c,k,a,cfg,factory,policy,clock,s,spare}=f;let h=soul::manifest_hash(&s);market::list_soul(s,&cfg,101,1000,1,h,0,&clock,sc.ctx());test_scenario::return_shared(c);test_scenario::return_shared(k);test_scenario::return_shared(cfg);test_scenario::return_shared(factory);test_scenario::return_shared(policy);sc.return_to_sender(a);sc.return_to_sender(spare);clock::destroy_for_testing(clock);sc.end();}
fun configure(f:&mut F,paused:bool){f.sc.next_tx(@0xa);let mut admin:Admin=f.sc.take_from_sender();economics::configure(&mut f.cfg,&mut admin,0,1000,500,0,@0xf,paused);f.sc.return_to_sender(admin);f.sc.next_tx(@0xb);}
fun cancel(f:&mut F,l:&mut Listing<USD>){collection::cancel(l,&mut f.k,&mut f.a,0,f.sc.ctx())}
#[test]
fun cancellation_preserves_locked_right_and_epoch_during_protocol_pause() {
    let mut f=normal();let lid=list(&mut f);let before=collection::snapshot_hash(&f.c);configure(&mut f,true);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);cancel(&mut f,&mut l);assert!(collection::listing_state(&l)==2 && collection::snapshot_hash(&f.c)==before && kiosk::is_locked(&f.k,collection::right_id(&f.c)) && !kiosk::is_listed(&f.k,collection::right_id(&f.c)),0);test_scenario::return_shared(l);end(f)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_custody::account)]
fun borrowed_foreign_account_cannot_cancel(){let mut f=normal();let lid=list(&mut f);f.sc.next_tx(@0xc);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);cancel(&mut f,&mut l);test_scenario::return_shared(l);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun exact_additional_right_fee_is_required(){let mut f=normal();let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,100,q,0);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=8,location=soulidity_collection::collection)]
fun right_quote_cannot_be_reused_by_another_buyer(){let mut f=normal();let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xd);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_collection::collection)]
fun stale_right_epoch_cannot_buy(){let mut f=normal();let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,1);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun fee_revision_change_rejects_old_right_approval(){let mut f=normal();let lid=list(&mut f);configure(&mut f,false);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_foundation::economics)]
fun expired_right_listing_cannot_purchase(){let mut f=normal();let lid=list(&mut f);clock::set_for_testing(&mut f.clock,1001);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=7,location=soulidity_collection::collection)]
fun settled_listing_cannot_receive_or_charge_twice(){let mut f=normal();let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,1);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_custody::account)]
fun correct_account_type_for_wrong_kiosk_cannot_withdraw(){let mut f=normal();let(mut k,mut a)=buyer(&mut f);custody::withdraw_profits(&mut f.k,&mut a,option::none(),f.sc.ctx());test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
fun kiosk_deposit_membership_and_withdraw_keep_same_root_and_safe_exit() {
    let f=normal();let F{mut sc,mut c,mut k,mut a,mut cfg,factory,policy,clock,s,spare}=f;let id=object::id(&s);let recipe=soul::recipe_hash(&s);soulidity_v1::custody::deposit_soul(&mut k,&mut a,s,&cfg,0,sc.ctx());collection::add_kiosk_soul(&mut c,&cfg,&mut k,&mut a,id,0,1,sc.ctx());
    sc.next_tx(@0xa);let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,1000,500,0,@0xf,true);sc.return_to_sender(admin);sc.next_tx(@0xb);soulidity_v1::custody::withdraw_soul(&mut k,&mut a,id,2,sc.ctx());sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);assert!(soul::creator(&s)==@0xb && soul::collection_id(&s)==option::some(object::id(&c)) && soul::recipe_hash(&s)==recipe && soul::revision(&s)==3 && soul::generation(&s)==2 && !kiosk::has_item(&k,id),0);end(F{sc,c,k,a,cfg,factory,policy,clock,s,spare})
}
public struct T {sc:Scenario,c:Collection,k:Kiosk,a:Account,cfg:Config<USD>,factory:Factory,policy:TransferPolicy<Right>,clock:Clock,spare:Soul}
fun list_member(f:F):(T,ID,ID) {
    let F{mut sc,mut c,k,a,cfg,factory,policy,clock,mut s,spare}=f;let id=object::id(&s);soul::grant(&mut s,@0xe,1,option::none(),0,option::none(),&clock,sc.ctx());collection::add_soul(&mut c,&mut s,0,1,sc.ctx());soul::unmount_bound(&mut s,b"bound",2);let h=soul::manifest_hash(&s);let lid=market::list_soul_with_collection(s,&c,&cfg,101,1000,3,h,0,&clock,sc.ctx());(T{sc,c,k,a,cfg,factory,policy,clock,spare},lid,id)
}
fun end_t(t:T){let T{sc,c,k,a,cfg,factory,policy,clock,spare}=t;test_scenario::return_shared(c);test_scenario::return_shared(k);test_scenario::return_shared(cfg);test_scenario::return_shared(factory);test_scenario::return_shared(policy);sc.return_to_sender(a);sc.return_to_sender(spare);clock::destroy_for_testing(clock);sc.end();}
fun transfer_right(t:&mut T) {
    let id=collection::list(&t.c,&mut t.k,&mut t.a,&t.cfg,100,1000,0,0,&t.clock,t.sc.ctx());t.sc.next_tx(@0xc);let buyer=custody::create(t.sc.ctx());t.sc.next_tx(@0xc);let mut k:Kiosk=t.sc.take_shared_by_id(buyer);let mut a:Account=t.sc.take_from_sender();let mut l:Listing<USD> = t.sc.take_shared_by_id(id);let q=collection::quote(&l,&t.cfg,@0xc);let payment=coin::mint_for_testing<USD>(105,t.sc.ctx());collection::buy(&mut l,&mut t.c,&t.factory,&t.policy,&mut t.k,&mut k,&mut a,&mut t.cfg,0,0,0,q,fixtures::h(80),payment,&t.clock,t.sc.ctx());test_scenario::return_shared(k);test_scenario::return_shared(l);t.sc.return_to_sender(a);t.sc.next_tx(@0xb);
}
fun buy_member(t:&mut T,l:&mut soulidity_market::market::Listing<Soul,USD>,snapshot:vector<u8>) {
    let h=market::manifest_hash(l);let total=market::collection_total(l,&t.c,&t.cfg);assert!(total==140,0);let payment=coin::mint_for_testing<USD>(total,t.sc.ctx());let q=market::collection_quote_hash(l,&t.c,&t.cfg,t.sc.sender());market::buy_soul_with_collection(l,&t.c,&mut t.cfg,0,h,snapshot,q,0,fixtures::h(81),payment,&t.clock,t.sc.ctx())
}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun collection_sale_quote_is_bound_to_actual_buyer(){let(mut t,lid,_)=list_member(normal());t.sc.next_tx(@0xe);let mut l:soulidity_market::market::Listing<Soul,USD> = t.sc.take_shared_by_id(lid);wrong_buyer_member_quote(&mut t,&mut l);test_scenario::return_shared(l);t.sc.next_tx(@0xb);end_t(t)}
fun wrong_buyer_member_quote(t:&mut T,l:&mut soulidity_market::market::Listing<Soul,USD>){let h=market::manifest_hash(l);let snapshot=collection::snapshot_hash(&t.c);let q=market::collection_quote_hash(l,&t.c,&t.cfg,@0x9);let payment=coin::mint_for_testing<USD>(140,t.sc.ctx());market::buy_soul_with_collection(l,&t.c,&mut t.cfg,0,h,snapshot,q,0,fixtures::h(81),payment,&t.clock,t.sc.ctx())}
#[test]
fun whole_member_sale_requotes_current_right_holder_pays_all_four_recipients_and_clears_grants() {
    let(mut t,lid,root)=list_member(normal());transfer_right(&mut t);t.sc.next_tx(@0xe);let mut l:soulidity_market::market::Listing<Soul,USD> = t.sc.take_shared_by_id(lid);let snapshot=collection::snapshot_hash(&t.c);buy_member(&mut t,&mut l,snapshot);test_scenario::return_shared(l);t.sc.next_tx(@0xe);let s:Soul=t.sc.take_from_sender_by_id(root);assert!(soul::creator(&s)==@0xb && soul::collection_id(&s)==option::some(object::id(&t.c)) && soul::generation(&s)==1 && soul::grant_count(&s)==0 && soul::bound_count(&s)==1 && soul::binding(&s,b"bound").is_none() && soul::free_id(&soul::binding(&s,b"free").destroy_some()).is_some(),0);t.sc.return_to_sender(s);
    t.sc.next_tx(@0xc);let c:Coin<USD> = t.sc.take_from_sender();assert!(coin::value(&c)==21,1);t.sc.return_to_sender(c);t.sc.next_tx(@0xa);let c:Coin<USD> = t.sc.take_from_sender();assert!(coin::value(&c)==6,2);t.sc.return_to_sender(c);t.sc.next_tx(@0xb);let total=sum_coins(&t.sc);assert!(total==207,3);t.sc.next_tx(@0xf);assert!(sum_coins(&t.sc)==0 && soulidity_foundation::revenue::balance(economics::income(&t.cfg))==11,4);t.sc.next_tx(@0xb);end_t(t)
}
fun sum_coins(sc:&Scenario):u64{let ids=sc.ids_for_sender<Coin<USD>>();let mut total=0;ids.do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);total=total+coin::value(&c);sc.return_to_sender(c)});total}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun stale_collection_recipient_snapshot_cannot_settle_member_sale(){let(mut t,lid,_)=list_member(normal());let old=collection::snapshot_hash(&t.c);transfer_right(&mut t);t.sc.next_tx(@0xe);let mut l:soulidity_market::market::Listing<Soul,USD> = t.sc.take_shared_by_id(lid);buy_member(&mut t,&mut l,old);test_scenario::return_shared(l);t.sc.next_tx(@0xb);end_t(t)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_market::market)]
fun ordinary_buy_entry_cannot_bypass_collection_fees(){let(mut t,lid,_)=list_member(normal());t.sc.next_tx(@0xe);let mut l:soulidity_market::market::Listing<Soul,USD> = t.sc.take_shared_by_id(lid);plain_buy(&mut t,&mut l);test_scenario::return_shared(l);t.sc.next_tx(@0xb);end_t(t)}
fun plain_buy(t:&mut T,l:&mut soulidity_market::market::Listing<Soul,USD>){let h=market::manifest_hash(l);let payment=coin::mint_for_testing<USD>(101,t.sc.ctx());market::buy_soul(l,&mut t.cfg,0,h,fixtures::h(99),0,fixtures::h(81),payment,&t.clock,t.sc.ctx())}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_terms::maker_resale)]
fun collection_valid_rate_can_still_exceed_combined_soul_fee(){let(t,_,_)=list_member(setup(9000,true,option::none(),option::none(),false));end_t(t)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun right_total_overflow_rejected_before_native_listing(){let mut f=normal();list_overflow(&mut f);end(f)}
fun list_overflow(f:&mut F){collection::list(&f.c,&mut f.k,&mut f.a,&f.cfg,18446744073709551615,1000,0,0,&f.clock,f.sc.ctx());}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_terms::maker_resale)]
fun member_total_overflow_is_not_allowed_to_wrap(){let f=normal();soulidity_maker_terms::maker_resale::quote_collection(soul::resale(&f.s),&f.cfg,18446744073709551615,@0xb,object::id(&f.c),@0xb,2000);end(f)}
#[test]
fun floor_is_immutable_app_metadata_and_does_not_block_lower_price_trade(){let mut f=normal();let lid=list(&mut f);assert!(collection::floor_price(&f.c)==option::some(1000),0);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);assert!(collection::listing_ask(&l)==100,1);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);test_scenario::return_shared(k);test_scenario::return_shared(l);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
fun terminal_cancel_can_reclaim_listing_without_unlocking_right(){let mut f=normal();let right=collection::right_id(&f.c);let lid=list(&mut f);f.sc.next_tx(@0xb);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);cancel(&mut f,&mut l);collection::delete_listing(l,f.sc.ctx());assert!(kiosk::is_locked(&f.k,right) && collection::ownership_epoch(&f.c)==0,0);end(f)}
#[test]
fun terminal_sale_deletion_preserves_buyer_custody_and_holder(){let mut f=normal();let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);f.sc.next_tx(@0xb);collection::delete_listing(l,f.sc.ctx());assert!(collection::current_holder(&f.c)==@0xc && kiosk::is_locked(&k,collection::right_id(&f.c)),0);test_scenario::return_shared(k);test_scenario::return_to_address(@0xc,a);end(f)}
#[test]
#[expected_failure(abort_code=7,location=soulidity_collection::collection)]
fun live_listing_cannot_be_deleted_with_purchase_cap(){let mut f=normal();let lid=list(&mut f);f.sc.next_tx(@0xb);let l:Listing<USD> = f.sc.take_shared_by_id(lid);collection::delete_listing(l,f.sc.ctx());end(f)}
#[test]
fun another_wallet_can_delete_empty_terminal_receipt(){let mut f=normal();let right=collection::right_id(&f.c);let lid=list(&mut f);f.sc.next_tx(@0xb);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);cancel(&mut f,&mut l);f.sc.next_tx(@0xc);collection::delete_listing(l,f.sc.ctx());f.sc.next_tx(@0xb);assert!(!test_scenario::has_most_recent_shared<Listing<USD>>() && kiosk::is_locked(&f.k,right) && collection::ownership_epoch(&f.c)==0,0);end(f)}
/// Original Soulidity market permits any wallet to reclaim an empty terminal listing.
#[test]
fun original_any_wallet_can_reclaim_cancelled_collection_listing(){
    let mut f=normal();let right=collection::right_id(&f.c);let lid=list(&mut f);
    f.sc.next_tx(@0xb);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);cancel(&mut f,&mut l);
    f.sc.next_tx(@0x9);collection::delete_listing(l,f.sc.ctx());
    f.sc.next_tx(@0xb);assert!(!test_scenario::has_most_recent_shared<Listing<USD>>() && kiosk::is_locked(&f.k,right) && collection::ownership_epoch(&f.c)==0,0);end(f)
}
#[test]
fun original_third_wallet_reclaims_sold_collection_without_moving_right(){
    let mut f=normal();let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);
    let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,105,q,0);
    f.sc.next_tx(@0x9);collection::delete_listing(l,f.sc.ctx());
    assert!(sui::event::events_by_type<soulidity_collection::collection::ListingReclaimed>().length()==1,1);
    f.sc.next_tx(@0xc);assert!(!test_scenario::has_most_recent_shared<Listing<USD>>() && collection::current_holder(&f.c)==@0xc && kiosk::is_locked(&k,collection::right_id(&f.c)),0);
    test_scenario::return_shared(k);test_scenario::return_to_address(@0xc,a);f.sc.next_tx(@0xb);end(f)
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_collection::collection)]
fun legitimate_transfer_policy_type_wrong_instance_cannot_confirm_sale(){let mut f=normal();let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);wrong_policy_buy(&mut f,&mut l,&mut k,&mut a);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
fun wrong_policy_buy(f:&mut F,l:&mut Listing<USD>,k:&mut Kiosk,a:&mut Account){let(p,cap)=transfer_policy::new_for_testing<Right>(f.sc.ctx());let q=collection::quote(l,&mut f.cfg,@0xc);let coin=coin::mint_for_testing<USD>(105,f.sc.ctx());collection::buy(l,&mut f.c,&f.factory,&p,&mut f.k,k,a,&mut f.cfg,0,0,0,q,fixtures::h(80),coin,&f.clock,f.sc.ctx());transfer::public_share_object(p);transfer::public_transfer(cap,@0xc)}
#[test]
#[expected_failure(abort_code=9,location=sui::kiosk)]
fun listed_native_soul_cannot_change_membership_snapshot(){let f=normal();let F{mut sc,mut c,mut k,mut a,cfg,factory,policy,clock,s,spare}=f;let id=object::id(&s);soulidity_v1::custody::deposit_soul(&mut k,&mut a,s,&cfg,0,sc.ctx());custody::list_for_testing<Soul>(&mut k,&a,id,100,sc.ctx());collection::add_kiosk_soul(&mut c,&cfg,&mut k,&mut a,id,0,1,sc.ctx());soulidity_v1::custody::withdraw_soul(&mut k,&mut a,id,1,sc.ctx());sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);end(F{sc,c,k,a,cfg,factory,policy,clock,s,spare})}
#[test]
#[expected_failure(abort_code=6,location=soulidity_collection::collection)]
fun existing_member_cannot_bind_to_second_collection(){let mut f=normal();add(&mut f,0,0);second_collection_add(&mut f);end(f)}
fun second_collection_add(f:&mut F){let id=collection::create(&f.factory,&f.policy,&f.cfg,&mut f.k,&mut f.a,string::utf8(b"Second"),string::utf8(b""),string::utf8(b""),0,true,option::none(),option::none(),0,1000,&f.clock,f.sc.ctx());f.sc.next_tx(@0xb);let mut c:Collection=f.sc.take_shared_by_id(id);collection::add_soul(&mut c,&mut f.s,0,1,f.sc.ctx());test_scenario::return_shared(c)}
#[test]
#[expected_failure(abort_code=3,location=soulidity_collection::collection)]
fun right_listing_rejects_same_coin_type_wrong_config(){let mut f=normal();f.sc.next_tx(@0xa);let auth:soulidity_foundation::economics::Authority=f.sc.take_from_sender();let id=soulidity_v1::native_binding::create_enabled_for_testing<USD>(&auth,0,0,0,@0xe,f.sc.ctx());f.sc.return_to_sender(auth);f.sc.next_tx(@0xb);let cfg:Config<USD> = f.sc.take_shared_by_id(id);wrong_config_list(&mut f,&cfg);test_scenario::return_shared(cfg);end(f)}
fun wrong_config_list(f:&mut F,cfg:&Config<USD>){collection::list(&f.c,&mut f.k,&mut f.a,cfg,100,1000,0,0,&f.clock,f.sc.ctx());}

// Original u128 floor policies are metadata, including Some(0), not u64 asks.
#[test]
fun original_none_floor_policy_survives_native_creation(){let f=setup(123,true,option::none(),option::none(),false);assert!(collection::floor_price(&f.c)==option::none(),0);end(f)}
#[test]
fun original_zero_floor_policy_is_distinct_from_absence(){let f=setup(123,true,option::none(),option::some(0),false);assert!(collection::floor_price(&f.c)==option::some(0),0);end(f)}
#[test]
fun original_above_u64_floor_policy_is_not_truncated(){let f=setup(123,true,option::none(),option::some(18446744073709551616),false);assert!(collection::floor_price(&f.c)==option::some(18446744073709551616),0);end(f)}
#[test]
fun original_maximum_floor_policy_is_preserved(){let f=setup(123,true,option::some(18446744073709551615),option::some(99999999999999999999),false);assert!(collection::floor_price(&f.c)==option::some(99999999999999999999) && collection::max_supply(&f.c)==option::some(18446744073709551615),0);end(f)}
#[test]
fun original_collection_royalty_has_no_native_maker_step_constraint(){let mut f=setup(123,true,option::none(),option::none(),false);add(&mut f,0,0);assert!(collection::extra_royalty(&f.c)==123,0);let r=soulidity_maker_terms::maker_resale::quote_collection(soul::resale(&f.s),&f.cfg,1,@0xb,object::id(&f.c),@0xc,123);assert!(soulidity_maker_terms::maker_resale::collection_amount(&r)==1 && soulidity_maker_terms::maker_resale::platform_amount(&r)==1,1);end(f)}
#[test]
fun cancel_relist_atomically_reprices_same_locked_right(){let mut f=normal();let right=collection::right_id(&f.c);let hash=collection::snapshot_hash(&f.c);let old_id=list(&mut f);f.sc.next_tx(@0xb);let mut old:Listing<USD> =f.sc.take_shared_by_id(old_id);cancel(&mut f,&mut old);let new_id=list_ask(&mut f,201,0);assert!(new_id!=old_id && collection::listing_state(&old)==2 && collection::snapshot_hash(&f.c)==hash && kiosk::is_locked(&f.k,right) && kiosk::is_listed(&f.k,right),0);collection::delete_listing(old,f.sc.ctx());f.sc.next_tx(@0xb);let new:Listing<USD> =f.sc.take_shared_by_id(new_id);assert!(collection::listing_state(&new)==0 && collection::listing_ask(&new)==201,1);test_scenario::return_shared(new);end(f)}
#[test]
fun right_round_trip_keeps_creator_members_and_id_but_invalidates_old_snapshot(){let mut f=normal();add(&mut f,0,0);let before=collection::snapshot_hash(&f.c);let right=collection::right_id(&f.c);let initial_kiosk=object::id(&f.k);let lid=list(&mut f);let(mut k,mut a)=buyer(&mut f);let mut first:Listing<USD> =f.sc.take_shared_by_id(lid);let q=collection::quote(&first,&f.cfg,@0xc);buy(&mut f,&mut first,&mut k,&mut a,105,q,0);let next=collection::list(&f.c,&mut k,&mut a,&f.cfg,100,1000,1,0,&f.clock,f.sc.ctx());test_scenario::return_shared(first);f.sc.next_tx(@0xb);let mut second:Listing<USD> =f.sc.take_shared_by_id(next);let q=collection::quote(&second,&f.cfg,@0xb);let payment=coin::mint_for_testing<USD>(105,f.sc.ctx());round_trip_buy(&mut f,&mut second,&mut k,q,payment);assert!(collection::ownership_epoch(&f.c)==2 && collection::current_holder(&f.c)==@0xb && collection::creator(&f.c)==@0xb && collection::current_kiosk(&f.c)==initial_kiosk && collection::right_id(&f.c)==right && collection::supply(&f.c)==1 && collection::snapshot_hash(&f.c)!=before && kiosk::is_locked(&f.k,right) && !kiosk::has_item(&k,right),0);test_scenario::return_shared(second);test_scenario::return_shared(k);test_scenario::return_to_address(@0xc,a);end(f)}
#[test]
#[expected_failure(abort_code=9,location=sui::kiosk)]
fun exclusive_native_listing_also_freezes_membership(){let f=normal();let F{mut sc,mut c,mut k,mut a,cfg,factory,policy,clock,s,spare}=f;let id=object::id(&s);soulidity_v1::custody::deposit_soul(&mut k,&mut a,s,&cfg,0,sc.ctx());let cap=custody::list_exclusively_for_testing<Soul>(&mut k,&a,id,sc.ctx());collection::add_kiosk_soul(&mut c,&cfg,&mut k,&mut a,id,0,1,sc.ctx());kiosk::return_purchase_cap(&mut k,cap);soulidity_v1::custody::withdraw_soul(&mut k,&mut a,id,1,sc.ctx());sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);end(F{sc,c,k,a,cfg,factory,policy,clock,s,spare})}

fun list_ask(f:&mut F,ask:u64,epoch:u64):ID{collection::list(&f.c,&mut f.k,&mut f.a,&f.cfg,ask,1000,epoch,0,&f.clock,f.sc.ctx())}
fun round_trip_buy(f:&mut F,l:&mut Listing<USD>,seller:&mut Kiosk,q:vector<u8>,payment:Coin<USD>){collection::buy(l,&mut f.c,&f.factory,&f.policy,seller,&mut f.k,&mut f.a,&mut f.cfg,0,1,0,q,fixtures::h(82),payment,&f.clock,f.sc.ctx())}

// Original market::bps_amount rounds each additive fee upwards; gross V8 uses
// floor_bps_amount. Expected values below are independent of the quote helpers.
#[test]
fun original_right_fee_rounding_zero_exact_and_remainder(){let f=normal();assert!(economics::right_total(&f.cfg,0)==0 && economics::right_total(&f.cfg,1)==2 && economics::right_total(&f.cfg,40)==42 && economics::right_total(&f.cfg,41)==44 && economics::right_total(&f.cfg,101)==107,0);end(f)}
#[test]
fun original_one_atomic_member_ceil_each_fee_even_for_same_recipients(){let f=normal();let r=soulidity_maker_terms::maker_resale::quote_collection(soul::resale(&f.s),&f.cfg,1,@0xb,object::id(&f.c),@0xb,123);assert!(soulidity_maker_terms::maker_resale::total(&r)==5 && soulidity_maker_terms::maker_resale::seller_amount(&r)==1 && soulidity_maker_terms::maker_resale::platform_amount(&r)==1 && soulidity_maker_terms::maker_resale::oc_amount(&r)==1 && soulidity_maker_terms::maker_resale::maker_amount(&r)==1 && soulidity_maker_terms::maker_resale::collection_amount(&r)==1,0);end(f)}
#[test]
fun zero_collection_rate_does_not_create_a_fee(){let f=normal();let r=soulidity_maker_terms::maker_resale::quote_collection(soul::resale(&f.s),&f.cfg,1,@0xb,object::id(&f.c),@0xb,0);assert!(soulidity_maker_terms::maker_resale::total(&r)==4 && soulidity_maker_terms::maker_resale::collection_amount(&r)==0,0);end(f)}
#[test]
fun original_one_atomic_right_sale_pays_one_atomic_platform_and_seller(){let mut f=normal();let lid=list_ask(&mut f,1,0);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,2,q,0);assert!(soulidity_foundation::revenue::balance(economics::income(&f.cfg))==1 && kiosk::is_locked(&k,collection::right_id(&f.c)),0);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);let c:Coin<USD> = f.sc.take_from_sender();assert!(coin::value(&c)==1,1);f.sc.return_to_sender(c);end(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun one_atomic_right_cannot_omit_rounded_platform_fee(){let mut f=normal();let lid=list_ask(&mut f,1,0);let(mut k,mut a)=buyer(&mut f);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let q=collection::quote(&l,&f.cfg,@0xc);buy(&mut f,&mut l,&mut k,&mut a,1,q,0);test_scenario::return_shared(l);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}

fun new_account_buy(f:&mut F,l:&mut Listing<USD>,amount:u64):ID{let(mut k,mut a)=custody::new(f.sc.ctx());let q=collection::quote(l,&f.cfg,@0xc);let payment=coin::mint_for_testing<USD>(amount,f.sc.ctx());collection::buy(l,&mut f.c,&f.factory,&f.policy,&mut f.k,&mut k,&mut a,&mut f.cfg,0,0,0,q,fixtures::h(84),payment,&f.clock,f.sc.ctx());custody::finalize(k,a,f.sc.ctx())}
#[test]
fun new_buyer_creates_purchases_and_finalizes_one_transaction(){let mut f=normal();let right=collection::right_id(&f.c);let lid=list(&mut f);f.sc.next_tx(@0xc);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);let kid=new_account_buy(&mut f,&mut l,105);test_scenario::return_shared(l);f.sc.next_tx(@0xc);let k:Kiosk=f.sc.take_shared_by_id(kid);let a:Account=f.sc.take_from_sender();assert!(collection::current_holder(&f.c)==@0xc && collection::current_kiosk(&f.c)==kid && kiosk::is_locked(&k,right) && custody::owner(&a)==@0xc && custody::kiosk_id(&a)==kid,0);test_scenario::return_shared(k);f.sc.return_to_sender(a);f.sc.next_tx(@0xb);end(f)}
#[test]
#[expected_failure(abort_code=2,location=soulidity_foundation::economics)]
fun new_buyer_underpayment_rejects_before_finalize(){let mut f=normal();let lid=list(&mut f);f.sc.next_tx(@0xc);let mut l:Listing<USD> = f.sc.take_shared_by_id(lid);new_account_buy(&mut f,&mut l,104);test_scenario::return_shared(l);f.sc.next_tx(@0xb);end(f)}

fun custody_boundary_gate(f:&mut F,primary:bool,enabled:bool){
    f.sc.next_tx(@0xa);let mut admin:Admin=f.sc.take_from_sender();
    let rev=economics::revision(&f.cfg);let hash=economics::commitment(&f.cfg);
    if(primary)economics::set_primary_enabled(&mut f.cfg,&mut admin,rev,hash,enabled)
    else economics::set_secondary_enabled(&mut f.cfg,&mut admin,rev,hash,enabled);
    f.sc.return_to_sender(admin);f.sc.next_tx(@0xb);
}
fun custody_boundary_create(f:&mut F):ID{
    collection::create(&f.factory,&f.policy,&f.cfg,&mut f.k,&mut f.a,string::utf8(b"Secondary off"),string::utf8(b""),string::utf8(b""),0,true,option::none(),option::none(),economics::revision(&f.cfg),1000,&f.clock,f.sc.ctx())
}
#[test]
fun custody_boundary_primary_on_secondary_off_creates_actual_locked_right(){
    let mut f=normal();custody_boundary_gate(&mut f,false,false);
    assert!(economics::primary_enabled(&f.cfg) && !economics::secondary_enabled(&f.cfg),0);
    let id=custody_boundary_create(&mut f);f.sc.next_tx(@0xb);let c:Collection=f.sc.take_shared_by_id(id);
    assert!(kiosk::is_locked(&f.k,collection::right_id(&c)) && collection::creator(&c)==@0xb && collection::protocol(&c)==object::id(&f.cfg),1);
    test_scenario::return_shared(c);end(f)
}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun custody_boundary_primary_off_rejects_collection_create(){let mut f=normal();custody_boundary_gate(&mut f,true,false);custody_boundary_create(&mut f);end(f)}
public struct CustodyFakeWitness has drop{}
public struct CustodyFakeRevision has drop{}
#[test,expected_failure(abort_code=1,location=soulidity_foundation::package_roles)]
fun custody_boundary_fake_witness_cannot_borrow_actual_right(){
    let mut f=normal();{let F{sc,c,k,a,cfg,..}=&mut f;let _=custody::borrow_right<USD,CustodyFakeWitness,CustodyFakeRevision,Right>(cfg,CustodyFakeWitness{},CustodyFakeRevision{},k,a,collection::right_id(c),sc.ctx());};end(f)
}
#[test,expected_failure(abort_code=2,location=soulidity_custody::account)]
fun custody_boundary_authenticated_consumer_rejects_wrong_datatype(){
    let mut f=normal();{let F{sc,c,k,a,cfg,..}=&mut f;let _=collection::wrong_right_type_for_testing<USD,Coin<USD>>(cfg,k,a,collection::right_id(c),sc.ctx());};end(f)
}
#[test,expected_failure(abort_code=2,location=soulidity_foundation::package_roles)]
fun custody_boundary_old_revision_cannot_borrow_actual_right(){
    let mut f=normal();{let F{sc,c,k,a,cfg,..}=&mut f;let _=collection::old_revision_right_for_testing(cfg,k,a,collection::right_id(c),sc.ctx());};end(f)
}
