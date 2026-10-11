#[test_only]
module soulidity_v1::entitlement_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin;
use sui::clock;
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::player;
use soulidity_foundation::revenue;
use soulidity_maker_terms::maker_resale as resale;
use soulidity_standard::soul::Soul;

fun paid():Scenario{let mut sc=fixtures::setup(15,0,0,0,0,0);let mut p:Product<USD> = sc.take_shared();let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=catalog::policy_hash(catalog::published(&p,1));catalog::buy_access_for_testing(&mut p,&mut cfg,1,hash,0,1000,fixtures::h(30),coin::mint_for_testing<USD>(15,sc.ctx()),&clock,sc.ctx());test_scenario::return_shared(p);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.next_tx(@0xb);sc}
fun runtime(sc:&mut Scenario,bad:u8){let p:Product<USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let v=catalog::published(&p,1);let hash=if(bad==1)fixtures::h(99) else catalog::policy_hash(v);let manifest=if(bad==2)fixtures::h(99) else catalog::manifest(v);let commitment=if(bad==3)fixtures::h(99) else economics::commitment(&cfg);catalog::assert_runtime_access(&p,&cfg,1,hash,manifest,0,commitment,&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(cfg)}
fun corrupt(field:u8){let mut sc=paid();let mut p:Product<USD> = sc.take_shared();catalog::corrupt_access_for_testing(&mut p,1,@0xb,field);test_scenario::return_shared(p);sc.next_tx(@0xb);runtime(&mut sc,0);sc.end();}
fun cap(sc:&mut Scenario,p:ID):Control{let mut found=option::none();sc.ids_for_sender<Control>().do_ref!(|id|{let c:Control=sc.take_from_sender_by_id(*id);if(catalog::control_product(&c)==p)found.fill(c) else sc.return_to_sender(c)});found.destroy_some()}
fun included(claim:bool):(Scenario,ID,ID){let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let maker:Product<USD> = sc.take_shared();let id=object::id(&maker);let mut c:Control=sc.take_from_sender();let cfg:Config<USD> = sc.take_shared();let pack=catalog::create_pack_for_testing(&maker,1,&mut c,&cfg,0,sc.ctx());test_scenario::return_shared(maker);test_scenario::return_shared(cfg);sc.return_to_sender(c);sc.next_tx(@0xa);let mut p:Product<USD> = sc.take_shared_by_id(pack);let mut c=cap(&mut sc,pack);catalog::publish(&mut p,&mut c,0,catalog::with_pack_key(catalog::version(fixtures::h(3),fixtures::h(4),2,0,0,0,0,0,0,@0xe,resale::rates(0,0),vector[b"free"],vector[],vector[fixtures::pack_def(b"free",2,10)],vector[],fixtures::scene()),b"included"));sc.return_to_sender(c);test_scenario::return_shared(p);sc.next_tx(@0xb);if(claim){let mut maker:Product<USD> = sc.take_shared_by_id(id);let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=catalog::policy_hash(catalog::published(&maker,1));catalog::claim_access_for_testing(&mut maker,&cfg,1,hash,0,1000,fixtures::h(30),&clock,sc.ctx());test_scenario::return_shared(maker);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.next_tx(@0xb);};(sc,id,pack)}
fun pack_runtime(sc:&mut Scenario,maker:ID,pack:ID,maker_version:u64){let m:Product<USD> = sc.take_shared_by_id(maker);let p:Product<USD> = sc.take_shared_by_id(pack);let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let v=catalog::published(&p,1);catalog::assert_runtime_pack(&p,&m,maker_version,1,&cfg,catalog::policy_hash(v),catalog::manifest(v),0,economics::commitment(&cfg),&clock,sc.ctx());clock::destroy_for_testing(clock);test_scenario::return_shared(p);test_scenario::return_shared(m);test_scenario::return_shared(cfg)}

#[test]
fun paid_runtime_checks_exact_record_and_actual_actor(){let mut sc=paid();runtime(&mut sc,0);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun another_wallet_cannot_reuse_qualification(){let mut sc=paid();sc.next_tx(@0xc);runtime(&mut sc,0);sc.end();}
#[test]
#[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)]
fun runtime_policy_mismatch_rejected(){let mut sc=paid();runtime(&mut sc,1);sc.end();}
#[test]
#[expected_failure(abort_code=9,location=soulidity_maker_manufacturing::maker_catalog)]
fun runtime_manifest_mismatch_rejected(){let mut sc=paid();runtime(&mut sc,2);sc.end();}
#[test]
#[expected_failure(abort_code=1,location=soulidity_foundation::economics)]
fun runtime_configuration_commitment_mismatch_rejected(){let mut sc=paid();runtime(&mut sc,3);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun entitlement_wrong_product_rejected(){corrupt(0)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun entitlement_wrong_version_rejected(){corrupt(1)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun entitlement_wrong_policy_rejected(){corrupt(2)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun entitlement_wrong_manifest_rejected(){corrupt(3)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun entitlement_wrong_holder_rejected(){corrupt(4)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun entitlement_wrong_price_rejected(){corrupt(5)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun entitlement_future_timestamp_rejected(){corrupt(6)}

#[test]
fun free_player_creation_records_qualification_without_fees(){let mut sc=fixtures::setup(0,0,0,0,0,0);let mut p:Product<USD> = sc.take_shared();let cfg:Config<USD> = sc.take_shared();assert!(!catalog::access_held(&p,1,@0xb),0);let clock=clock::create_for_testing(sc.ctx());let id=player::create_for_testing(&mut p,&cfg,1,0,1000,fixtures::h(29),&clock,sc.ctx());catalog::assert_access_entitlement(&p,1,@0xb);let a=catalog::access_record(&p,1,@0xb).destroy_some();assert!(catalog::access_paid(&a)==0 && catalog::access_commitment(&a).length()==32 && revenue::balance(catalog::income(&p))==0 && revenue::revision(catalog::income(&p))==0,1);test_scenario::return_shared(p);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.next_tx(@0xb);let player:soulidity_maker_manufacturing::maker_player::Player=sc.take_from_sender_by_id(id);player::close(player,0,sc.ctx());sc.end();}
#[test]
fun free_complete_records_exact_qualification_atomically(){let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,31,0);sc.next_tx(@0xb);let p:Product<USD> = sc.take_shared();catalog::assert_access_entitlement(&p,1,@0xb);assert!(catalog::access_paid(&catalog::access_record(&p,1,@0xb).destroy_some())==0 && catalog::receipt(&p,@0xb,1,fixtures::h(31))==option::some(object::id(&p)),0);let s:Soul=sc.take_from_sender_by_id(id);sc.return_to_sender(s);test_scenario::return_shared(p);sc.end();}
#[test]
fun included_pack_uses_exact_free_parent_entitlement(){let(mut sc,m,p)=included(true);pack_runtime(&mut sc,m,p,1);sc.end();}
#[test]
#[expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun included_pack_cannot_substitute_public_free_policy_for_exact_parent_record(){let(mut sc,m,p)=included(false);pack_runtime(&mut sc,m,p,1);sc.end();}
#[test]
#[expected_failure(abort_code=8,location=soulidity_maker_manufacturing::maker_catalog)]
fun included_pack_wrong_parent_version_rejected(){let(mut sc,m,p)=included(true);pack_runtime(&mut sc,m,p,2);sc.end();}
#[test]
#[expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_catalog)]
fun included_pack_stopped_parent_cannot_authorize_runtime(){let(mut sc,m,p)=included(true);sc.next_tx(@0xa);let mut maker:Product<USD> = sc.take_shared_by_id(m);let mut c=cap(&mut sc,m);catalog::lifecycle(&mut maker,&mut c,1,2);test_scenario::return_shared(maker);sc.return_to_sender(c);sc.next_tx(@0xb);pack_runtime(&mut sc,m,p,1);sc.end();}
