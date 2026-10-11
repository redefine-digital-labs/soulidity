#[test_only]
module soulidity_v1::character_boundary_tests;
use sui::test_scenario::{Self,Scenario};
use sui::coin;
use sui::clock;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_v1::native_binding;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::character::{Self as app,Draft};
use soulidity_maker_admission::maker_issuance::{Self as issuance,Genesis};
use soulidity_maker_terms::maker_resale as resale;
use soulidity_foundation::economics::{Self,Config};
use soulidity_visual::visual;
fun pending(sc:&mut Scenario,p:&mut Product<USD>,cfg:&mut Config<USD>,n:u8):(Soul,Genesis){
    let c=clock::create_for_testing(sc.ctx());
    let hash=catalog::policy_hash(catalog::published(p,1));catalog::ensure_access_for_testing(p,cfg,1,fixtures::h(n),0,1000,&c,sc.ctx());
    let binding=native_binding::application_binding(cfg);
    let(root,g,_)=catalog::mint_soul(binding,p,cfg,1,std::string::utf8(b"OC"),hash,fixtures::h(n),0,1000,coin::zero<USD>(sc.ctx()),&c,sc.ctx());
    clock::destroy_for_testing(c);(root,g)
}
fun construct(sc:&mut Scenario,p:&Product<USD>,root:Soul,g:Genesis,changed:bool):(Soul,Draft){
    let v=*catalog::published(p,1);
    let r=resale::snapshot(catalog::protocol(p),object::id(p),1,catalog::policy_hash(&v),catalog::creator(p),catalog::soul_rates(&v),sc.ctx());
    let(s,d)=app::new(g,root,catalog::protocol(p),object::id(p),1,if(changed)fixtures::h(99) else catalog::manifest(&v),catalog::configuration(&v),catalog::assembly_profile(p,1),catalog::required_parts(&v),catalog::adapters(&v),*catalog::scene(&v),r,catalog::beneficiary(&v),sc.ctx());(s,d)
}
#[test,expected_failure(abort_code=2,location=soulidity_maker_admission::maker_issuance)]
fun authentic_genesis_cannot_authorize_changed_publication_metadata(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let(root,g)=pending(&mut sc,&mut p,&mut cfg,100);let(s,d)=construct(&mut sc,&p,root,g,true);app::finish(d,s,@0xb,sc.ctx());test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();
}
#[test,expected_failure(abort_code=2,location=soulidity_maker_admission::maker_issuance)]
fun authentic_genesis_cannot_initialize_another_actual_root(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let(one,g1)=pending(&mut sc,&mut p,&mut cfg,100);let(two,g2)=pending(&mut sc,&mut p,&mut cfg,101);
    let(s,d)=construct(&mut sc,&p,two,g1,false);app::finish(d,s,@0xb,sc.ctx());let(s,d)=construct(&mut sc,&p,one,g2,false);app::finish(d,s,@0xb,sc.ctx());test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();
}
#[test,expected_failure(abort_code=14,location=soulidity_application::character)]
fun draft_cannot_change_another_root_with_the_same_maker(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let(one,g1)=pending(&mut sc,&mut p,&mut cfg,100);let(two,g2)=pending(&mut sc,&mut p,&mut cfg,101);
    let(one,d1)=construct(&mut sc,&p,one,g1,false);let(mut two,d2)=construct(&mut sc,&p,two,g2,false);let colors=visual::default_colors(app::scene(&two));
    app::set_initial_colors(&d1,&mut two,colors,sc.ctx());app::finish(d1,one,@0xb,sc.ctx());app::finish(d2,two,@0xb,sc.ctx());test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();
}
#[test,expected_failure(abort_code=14,location=soulidity_application::character)]
fun draft_actor_is_checked_after_cross_module_handoff(){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let(root,g)=pending(&mut sc,&mut p,&mut cfg,100);let(mut s,d)=construct(&mut sc,&p,root,g,false);
    sc.next_tx(@0xc);let colors=visual::default_colors(app::scene(&s));app::set_initial_colors(&d,&mut s,colors,sc.ctx());app::finish(d,s,@0xb,sc.ctx());test_scenario::return_shared(p);test_scenario::return_shared(cfg);sc.end();
}
fun issued():(Scenario,Soul){let mut sc=fixtures::setup(0,0,0,0,0,0);let root=fixtures::mint(&mut sc,102,0);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(root);(sc,s)}
#[test]
fun native_complete_installs_one_application_on_the_original_standard_root(){
    let(sc,s)=issued();let origin=standard::origin(&s);assert!(standard::source(&origin)==app::maker(&s) && standard::source_version(&origin)==app::maker_version(&s),0);
    let descriptor=standard::descriptor<app::ApplicationWitness>(&s,b"animacraft").destroy_some();assert!(standard::module_id(&descriptor)==app::application_module_id(&s) && app::bound_count(&s)==1 && app::reference_count(&s)==1,1);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=13,location=soulidity_application::character)]
fun copyable_metadata_cannot_bind_a_collection(){let(sc,mut s)=issued();let id=object::id(&s);app::bind_collection(id,&mut s,id,0);sc.return_to_sender(s);sc.end();}
#[test,expected_failure(abort_code=13,location=soulidity_application::character)]
fun copyable_metadata_cannot_approve_container_content(){let(mut sc,s)=issued();let sys=fixtures::prepare_storage(&mut sc);app::assert_content_read(app::maker(&s),vector[],&s,0,&sys,1);test_scenario::return_shared(sys);sc.return_to_sender(s);sc.end();}
#[test,expected_failure(abort_code=13,location=soulidity_application::character)]
fun foreign_marker_cannot_supply_a_cached_container_owner(){let(mut sc,s)=issued();let c=clock::create_for_testing(sc.ctx());app::assert_delegate(1u64,&s,@0xb,@0xc,2,&c);clock::destroy_for_testing(c);sc.return_to_sender(s);sc.end();}
#[test,expected_failure(abort_code=13,location=soulidity_application::character)]
fun foreign_marker_cannot_use_initial_profile_admission(){let(sc,mut s)=issued();let p:Product<USD> =sc.take_shared();app::admit_profile(catalog::policy_hash(catalog::published(&p,1)),&mut s,catalog::assembly_profile(&p,1));test_scenario::return_shared(p);sc.return_to_sender(s);sc.end();}
#[test,expected_failure(abort_code=2,location=soulidity_maker_admission::maker_issuance)]
fun paid_contribution_cannot_enhance_another_soul(){
    let(mut sc,one)=issued();let root=fixtures::mint(&mut sc,103,0);sc.next_tx(@0xb);let mut two:Soul=sc.take_from_sender_by_id(root);
    let mut p:Product<USD> =sc.take_shared();let mut cfg:Config<USD> =sc.take_shared();let c=clock::create_for_testing(sc.ctx());let hash=catalog::policy_hash(catalog::published(&p,1));
    let contribution=catalog::complete_contribution(&mut p,&one,&mut cfg,1,hash,fixtures::h(104),1000,coin::zero<USD>(sc.ctx()),&c,sc.ctx());
    let enhancement=app::begin_enhancement(contribution,&two,0,sc.ctx());app::finish_enhancement(enhancement,&mut two,fixtures::h(105),sc.ctx());
    test_scenario::return_shared(p);test_scenario::return_shared(cfg);clock::destroy_for_testing(c);sc.return_to_sender(one);sc.return_to_sender(two);sc.end();
}
