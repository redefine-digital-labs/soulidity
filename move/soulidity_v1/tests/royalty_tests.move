#[test_only]
module soulidity_v1::royalty_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin::{Self,Coin};
use sui::clock;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_market::market::{Listing};
use soulidity_v1::market;
use soulidity_maker_terms::maker_resale::{Self as resale,Receipt};
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry,KindAdminCap};
use soulidity_application::output;
use soulidity_model::policy;
use soulidity_v1::issuer;
use soulidity_v1::storage_fixture;

fun setup():(Scenario,ID){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,70,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);transfer::public_transfer(s,@0xc);configure(&mut sc,250,@0xf,false);sc.next_tx(@0xc);(sc,id)
}
fun configure(sc:&mut Scenario,bps:u16,recipient:address,paused:bool){sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();let rev=economics::revision(&cfg);economics::configure(&mut cfg,&mut admin,rev,1000,bps,0,recipient,paused);test_scenario::return_shared(cfg);sc.return_to_sender(admin);}
fun list(sc:&mut Scenario,id:ID,price:u64):ID{let s:Soul=sc.take_from_sender_by_id(id);let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let h=soul::manifest_hash(&s);let rev=soul::revision(&s);let lid=market::list_soul(s,&cfg,price,1000,rev,h,economics::revision(&cfg),&clock,sc.ctx());test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);lid}
fun buy(sc:&mut Scenario,lid:ID,amount:u64,q:Option<vector<u8>>,fee:u64){let mut l:Listing<Soul,USD> = sc.take_shared_by_id(lid);let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=market::manifest_hash(&l);let q=if(q.is_some())q.destroy_some() else market::soul_quote_hash(&l,&mut cfg,sc.sender());let pay=coin::mint_for_testing<USD>(amount,sc.ctx());market::buy_soul(&mut l,&mut cfg,0,hash,q,fee,fixtures::h(80),pay,&clock,sc.ctx());test_scenario::return_shared(l);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock)}
fun quote(sc:&Scenario,lid:ID,buyer:address):vector<u8>{let l:Listing<Soul,USD> = sc.take_shared_by_id(lid);let cfg:Config<USD> = sc.take_shared();let q=market::soul_quote_hash(&l,&cfg,buyer);test_scenario::return_shared(l);test_scenario::return_shared(cfg);q}
fun sum(sc:&Scenario):u64{let ids=sc.ids_for_sender<Coin<USD>>();let mut n=0;ids.do_ref!(|id|{let c:Coin<USD> = sc.take_from_sender_by_id(*id);n=n+coin::value(&c);sc.return_to_sender(c)});n}
fun receipt(sc:&Scenario,lid:ID):Receipt{let l:Listing<Soul,USD> = sc.take_shared_by_id(lid);let r=market::settlement(&l).destroy_some();test_scenario::return_shared(l);r}

#[test]
fun sale_pays_original_oc_and_maker_creators_distinct_from_seller_and_primary_beneficiary(){
    let(mut sc,id)=setup();let s:Soul=sc.take_from_sender_by_id(id);let rights=*soul::resale(&s);assert!(resale::oc_creator(&rights)==@0xb && resale::maker_creator(&rights)==@0xa && soul::beneficiary(&s)==@0xd,0);sc.return_to_sender(s);sc.next_tx(@0xc);let lid=list(&mut sc,id,101);sc.next_tx(@0xe);buy(&mut sc,lid,101,option::none(),1);sc.next_tx(@0xe);
    let r=receipt(&sc,lid);assert!(resale::basis(&r)==0 && resale::total(&r)==101 && resale::seller_amount(&r)==89 && resale::platform_amount(&r)==2 && resale::oc_amount(&r)==5 && resale::maker_amount(&r)==5 && resale::collection_amount(&r)==0,1);assert!(resale::seller(&r)==@0xc && resale::oc_recipient(&r)==@0xb && resale::maker_recipient(&r)==@0xa && resale::platform(&r)==@0xf && resale::fee_revision(&r)==1,2);
    let s:Soul=sc.take_from_sender_by_id(id);assert!(*soul::resale(&s)==rights && soul::generation(&s)==1,3);sc.return_to_sender(s);sc.next_tx(@0xb);assert!(sum(&sc)==5,4);sc.next_tx(@0xa);assert!(sum(&sc)==5,5);sc.next_tx(@0xc);assert!(sum(&sc)==89,6);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==2 && sum(&sc)==0,7);sc.next_tx(@0xd);assert!(sum(&sc)==0,8);sc.end();
}
#[test]
fun control_transfer_new_version_and_treasury_change_do_not_modify_issued_rights(){
    let(mut sc,id)=setup();sc.next_tx(@0xc);let s:Soul=sc.take_from_sender_by_id(id);let original=*soul::resale(&s);sc.return_to_sender(s);sc.next_tx(@0xa);let cap:Control=sc.take_from_sender();transfer::public_transfer(cap,@0xc);sc.next_tx(@0xc);let mut p:Product<USD> = sc.take_shared();let mut cap:Control=sc.take_from_sender();let registry:KindRegistry=sc.take_shared();
    let v=catalog::with_outputs(catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,1000,@0xe,resale::rates(0,0),vector[b"ref",b"bound",b"free"],vector[b"free"],vector[fixtures::def(b"ref",0,10),fixtures::def(b"bound",1,10),fixtures::def(b"free",2,10)],vector[],fixtures::scene()),vector[fixtures::default_output(&registry,false,true,vector[])]);catalog::publish(&mut p,&mut cap,1,v);
    assert!(catalog::creator(&p)==@0xa && catalog::beneficiary(catalog::published(&p,2))==@0xe && catalog::policy_hash(catalog::published(&p,1))==resale::policy_hash(&original),0);test_scenario::return_shared(registry);test_scenario::return_shared(p);sc.return_to_sender(cap);
    let s:Soul=sc.take_from_sender_by_id(id);assert!(*soul::resale(&s)==original && soul::maker_version(&s)==1,1);sc.return_to_sender(s);sc.next_tx(@0xc);let lid=list(&mut sc,id,101);sc.next_tx(@0xe);buy(&mut sc,lid,101,option::none(),1);sc.next_tx(@0xe);let r=receipt(&sc,lid);assert!(resale::maker_recipient(&r)==@0xa && resale::oc_recipient(&r)==@0xb && resale::maker_amount(&r)==5,2);let new_id=mint_v2(&mut sc);sc.next_tx(@0xe);let new:Soul=sc.take_from_sender_by_id(new_id);let sr=soul::resale(&new);assert!(resale::maker_creator(sr)==@0xa && resale::oc_creator(sr)==@0xe && resale::version(sr)==2 && resale::oc_bps(&resale::snapshot_rates(sr))==0 && resale::maker_bps(&resale::snapshot_rates(sr))==0,3);sc.return_to_sender(new);sc.end();
}
fun mint_v2(sc:&mut Scenario):ID{
    let mut system=fixtures::prepare_storage(sc);let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let v=catalog::published(&p,2);let op=catalog::output_policy(v,b"default");let recipe=fixtures::recipe(vector[
        output::slot(b"ref",option::some(output::selection(catalog::preview_source(&p,2,policy::definition_hash(&fixtures::def(b"ref",0,10))),fixtures::layout(),option::none()))),output::slot(b"bound",option::some(output::selection(catalog::preview_source(&p,2,policy::definition_hash(&fixtures::def(b"bound",1,10))),fixtures::layout(),option::none()))),output::slot(b"free",option::some(output::selection(catalog::preview_source(&p,2,policy::definition_hash(&fixtures::def(b"free",2,10))),fixtures::layout(),option::none())))
    ]);let intent=output::intent(object::id(&cfg),object::id(&p),2,catalog::policy_hash(v),output::policy_hash(&op),sc.sender(),fixtures::h(71),std::string::utf8(b"New OC"),recipe,vector::tabulate!(16,|_|71));let coin=coin::zero<USD>(sc.ctx());let mut b=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&cfg),&mut p,&mut cfg,intent,b"default",1,1000,coin,&clock,sc.ctx());issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"ref",0,10)),b"ref",fixtures::layout(),sc.ctx());issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"bound",1,10)),b"bound",fixtures::layout(),sc.ctx());issuer::select(&mut b,&mut p,policy::definition_hash(&fixtures::def(b"free",2,10)),b"free",fixtures::layout(),sc.ctx());let id=fixtures::finish(sc,b,&mut system,&clock);storage_fixture::return_system(system);test_scenario::return_shared(p);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);id
}
#[test]
fun smallest_gross_rounds_three_fees_independently_without_zero_coin_outputs(){let(mut sc,id)=setup();let lid=list(&mut sc,id,1);sc.next_tx(@0xe);buy(&mut sc,lid,1,option::none(),1);sc.next_tx(@0xe);let r=receipt(&sc,lid);assert!(resale::seller_amount(&r)==1 && resale::oc_amount(&r)==0 && resale::maker_amount(&r)==0 && resale::platform_amount(&r)==0,0);sc.next_tx(@0xc);assert!(sum(&sc)==1,1);sc.next_tx(@0xb);assert!(sum(&sc)==0,2);sc.next_tx(@0xa);assert!(sum(&sc)==0,3);sc.next_tx(@0xf);assert!(sum(&sc)==0,4);sc.end();}
#[test]
fun max_u64_gross_can_settle_without_overflow_or_losing_remainder(){let(mut sc,id)=setup();let gross=18446744073709551615;let lid=list(&mut sc,id,gross);sc.next_tx(@0xe);buy(&mut sc,lid,gross,option::none(),1);sc.next_tx(@0xe);let r=receipt(&sc,lid);let platform=(((gross as u128)*250/10000) as u64);let oc=(((gross as u128)*500/10000) as u64);assert!(resale::seller_amount(&r)==gross-platform-oc-oc && resale::platform_amount(&r)==platform && resale::oc_amount(&r)==oc && resale::maker_amount(&r)==oc,0);sc.next_tx(@0xc);assert!(sum(&sc)==gross-platform-oc-oc,1);sc.next_tx(@0xa);assert!(sum(&sc)==oc,2);sc.next_tx(@0xb);assert!(sum(&sc)==oc,3);sc.next_tx(@0xf);assert!(fixtures::protocol_income(&sc)==platform && sum(&sc)==0,4);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun other_buyer_quote_cannot_authorize_purchase(){let(mut sc,id)=setup();let lid=list(&mut sc,id,101);sc.next_tx(@0xe);let q=quote(&sc,lid,@0x8);sc.next_tx(@0xe);buy(&mut sc,lid,101,option::some(q),1);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun changed_platform_recipient_requires_new_quote_even_with_current_fee_revision(){let(mut sc,id)=setup();let lid=list(&mut sc,id,101);sc.next_tx(@0xe);let q=quote(&sc,lid,@0xe);configure(&mut sc,250,@0x9,false);sc.next_tx(@0xe);buy(&mut sc,lid,101,option::some(q),2);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun stale_fee_revision_cannot_settle(){let(mut sc,id)=setup();let lid=list(&mut sc,id,101);configure(&mut sc,250,@0x9,false);sc.next_tx(@0xe);buy(&mut sc,lid,101,option::none(),1);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_maker_terms::maker_resale)]
fun wrong_native_protocol_rate_rejected_at_listing(){let(mut sc,id)=setup();configure(&mut sc,500,@0xf,false);sc.next_tx(@0xc);list(&mut sc,id,101);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_maker_terms::maker_resale)]
fun wrong_native_protocol_rate_cannot_be_accepted_at_purchase(){let(mut sc,id)=setup();let lid=list(&mut sc,id,101);configure(&mut sc,500,@0xf,false);sc.next_tx(@0xe);buy(&mut sc,lid,101,option::none(),2);sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_maker_terms::maker_resale)]
fun gross_plus_fees_overpayment_is_not_a_valid_native_price(){let(mut sc,id)=setup();let lid=list(&mut sc,id,101);sc.next_tx(@0xe);buy(&mut sc,lid,113,option::none(),1);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_market::market)]
fun quote_for_another_listing_with_same_price_cannot_replay(){let(mut sc,id)=setup();let lid=list(&mut sc,id,101);sc.next_tx(@0xe);let old=quote(&sc,lid,@0xe);sc.next_tx(@0xc);let mut l:Listing<Soul,USD> = sc.take_shared_by_id(lid);market::cancel(&mut l,0,sc.ctx());test_scenario::return_shared(l);sc.next_tx(@0xc);let new=list(&mut sc,id,101);sc.next_tx(@0xe);buy(&mut sc,new,101,option::some(old),1);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_terms::maker_resale)]
fun oc_rate_above_original_cap_rejected(){resale::rates(1001,0);}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_terms::maker_resale)]
fun maker_rate_above_original_cap_rejected(){resale::rates(0,1001);}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_terms::maker_resale)]
fun combined_rights_pool_above_original_cap_rejected(){resale::rates(501,500);}
#[test]
fun exact_rights_pool_boundaries_supported(){let r=resale::rates(1000,0);assert!(resale::oc_bps(&r)==1000 && resale::maker_bps(&r)==0,0);let r=resale::rates(0,1000);assert!(resale::oc_bps(&r)==0 && resale::maker_bps(&r)==1000,1);let r=resale::rates(0,0);assert!(resale::oc_bps(&r)==0 && resale::maker_bps(&r)==0,2);}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_terms::maker_resale)]
fun zero_gross_cannot_create_listing(){let(mut sc,id)=setup();list(&mut sc,id,0);sc.end();}
#[test]
fun fresh_quote_pays_updated_platform_recipient_without_changing_rights(){let(mut sc,id)=setup();let lid=list(&mut sc,id,101);configure(&mut sc,250,@0x9,false);sc.next_tx(@0xe);buy(&mut sc,lid,101,option::none(),2);sc.next_tx(@0xe);let r=receipt(&sc,lid);assert!(resale::platform(&r)==@0x9 && resale::fee_revision(&r)==2 && resale::oc_recipient(&r)==@0xb && resale::maker_recipient(&r)==@0xa,0);sc.next_tx(@0x9);assert!(fixtures::protocol_income(&sc)==2 && sum(&sc)==0,1);sc.next_tx(@0xf);assert!(sum(&sc)==0,2);sc.end();}
#[test]
#[expected_failure(abort_code=2,location=soulidity_maker_terms::maker_resale)]
fun same_coin_wrong_config_cannot_price_issued_soul(){let(mut sc,id)=setup();sc.next_tx(@0xa);let auth:soulidity_foundation::economics::Authority=sc.take_from_sender();let wrong=soulidity_v1::native_binding::create_enabled_for_testing<USD>(&auth,1000,250,0,@0xf,sc.ctx());sc.return_to_sender(auth);sc.next_tx(@0xc);let cfg:Config<USD> = sc.take_shared_by_id(wrong);let s:Soul=sc.take_from_sender_by_id(id);resale::quote_gross(soul::resale(&s),&cfg,101,@0xc);sc.return_to_sender(s);test_scenario::return_shared(cfg);sc.end();}
#[test]
fun transferred_admin_can_configure_with_actual_mutable_cap(){let(mut sc,_)=setup();sc.next_tx(@0xa);let cap:Admin=sc.take_from_sender();transfer::public_transfer(cap,@0xe);sc.next_tx(@0xe);let mut cap:Admin=sc.take_from_sender();let mut cfg:Config<USD> = sc.take_shared();economics::configure(&mut cfg,&mut cap,1,1000,250,0,@0x9,false);assert!(economics::revision(&cfg)==2 && economics::recipient(&cfg)==@0x9,0);sc.return_to_sender(cap);test_scenario::return_shared(cfg);sc.end();}
#[test]
fun transferred_kind_admin_can_register_deprecate_and_reactivate_using_mutable_cap(){let(mut sc,_)=setup();sc.next_tx(@0xa);let cap:KindAdminCap=sc.take_from_sender();transfer::public_transfer(cap,@0xe);sc.next_tx(@0xe);let mut cap:KindAdminCap=sc.take_from_sender();let mut r:KindRegistry=sc.take_shared();let k=kind_registry::register_kind(&mut r,&mut cap,std::string::utf8(b"custom_kind"),kind_registry::op_append(),kind_registry::read_owner(),false,false,0,sc.ctx());assert!(kind_registry::contains_kind(&r,k),0);kind_registry::deprecate_kind(&mut r,&mut cap,k,sc.ctx());assert!(kind_registry::descriptor_deprecated(kind_registry::borrow_descriptor(&r,k)),1);kind_registry::reactivate_kind(&mut r,&mut cap,k,sc.ctx());assert!(!kind_registry::descriptor_deprecated(kind_registry::borrow_descriptor(&r,k)),2);test_scenario::return_shared(r);sc.return_to_sender(cap);sc.end();}
