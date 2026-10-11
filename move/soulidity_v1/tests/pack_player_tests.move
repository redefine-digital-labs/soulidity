#[test_only]
module soulidity_v1::pack_player_tests;
use std::bcs;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::pack_publication_tests as pub_fixture;
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_foundation::economics::Config;
use soulidity_visual::visual::{Self,Scene};
use soulidity_model::policy;
use soulidity_model::assembly::{Self,Scope,PartKey};
use soulidity_maker_manufacturing::maker_player::{Player};
use soulidity_v1::player;
use soulidity_model::components::Item;
use soulidity_application::output;
use soulidity_v1::issuer;
use soulidity_v1::storage_fixture;
use sui::coin;
public struct F {sc:Scenario,maker:Product<USD>,a:Product<USD>,b:Product<USD>,cfg:Config<USD>,clock:Clock,p:Player}
fun z():visual::Signed{visual::signed(false,0)}
fun sel(part:vector<u8>):visual::Selector{visual::selector(option::none(),option::none(),part,option::none(),option::none())}
fun scene(rule:bool):Scene{
    let base=pub_fixture::base();let mut rules=vector[pub_fixture::base_rule()];if(rule)rules.push_back(visual::rule(b"pack-rule",0,sel(b"accessory"),false,vector[sel(b"ref")]));
    let mut channels=*visual::channels(&base);channels.push_back(visual::channel(b"metal",b"gold",true,vector[visual::swatch(b"gold",3,vector[]),visual::swatch(b"silver",4,vector[])]));
    visual::scene(1024,1024,z(),z(),0,fixtures::h(14),b"body",b"pose",vector[b"ref",b"bound",b"free",b"accessory"],vector[visual::track(b"back",0,false),visual::track(b"glow",1,false),visual::track(b"front",2,true)],channels,vector[visual::anchor(b"root",vector[],z(),z()),visual::anchor(b"pack-root",vector[],z(),z())],rules)
}
fun publish(sc:&mut Scenario,id:ID,rule:bool){let mut p:Product<USD> = sc.take_shared_by_id(id);let mut c=pub_fixture::control(sc,id);let scene=scene(rule);let defs=vector[pub_fixture::def(&scene,b"accessory",b"pack-style",true,false),pub_fixture::def(&scene,b"accessory",b"alt-style",true,false),pub_fixture::def(&scene,b"accessory",b"inherited-color-style",false,false)];catalog::publish(&mut p,&mut c,0,catalog::with_pack_key(pub_fixture::draft(scene,vector[b"accessory"],defs,vector[]),b"pack"));sc.return_to_sender(c);test_scenario::return_shared(p)}
fun setup() : F {
    let(mut sc,maker,a,_)=pub_fixture::setup();publish(&mut sc,a,true);sc.next_tx(@0xa);
    let m:Product<USD> = sc.take_shared_by_id(maker);let cfg:Config<USD> = sc.take_shared();let mut cap=pub_fixture::control(&sc,maker);let b=catalog::create_pack_for_testing(&m,2,&mut cap,&cfg,0,sc.ctx());sc.return_to_sender(cap);test_scenario::return_shared(m);test_scenario::return_shared(cfg);sc.next_tx(@0xa);publish(&mut sc,b,false);sc.next_tx(@0xb);
    let mut maker:Product<USD> = sc.take_shared_by_id(maker);let a:Product<USD> = sc.take_shared_by_id(a);let b:Product<USD> = sc.take_shared_by_id(b);let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let id=player::create_for_testing(&mut maker,&cfg,2,0,1000,fixtures::h(33),&clock,sc.ctx());sc.next_tx(@0xb);let mut p:Player=sc.take_from_sender_by_id(id);let d=pub_fixture::def(&pub_fixture::base(),b"ref",b"style",false,false);player::set_base_for_testing(&mut p,&maker,&cfg,policy::definition_hash(&d),fixtures::layout(),0,0,1000,&clock,sc.ctx());F{sc,maker,a,b,cfg,clock,p}
}
fun scope(p:&Product<USD>):Scope{assembly::profile_scope(&catalog::assembly_profile(p,1))}
fun key(p:&Product<USD>):PartKey{assembly::scoped_part(scope(p),b"accessory")}
fun select(f:&mut F,a:bool,style:vector<u8>){let p=if(a)&f.a else &f.b;let d=pub_fixture::def(&scene(a),b"accessory",style,style!=b"inherited-color-style",false);let revision=player::revision(&f.p);player::set_pack_for_testing(&mut f.p,&f.maker,p,&f.cfg,1,policy::definition_hash(&d),fixtures::layout(),revision,0,1000,&f.clock,f.sc.ctx())}
fun colors(silver:bool):vector<visual::ColorChoice>{let base=pub_fixture::base();let mut colors=visual::default_colors(&base);colors.push_back(visual::color_choice(b"metal",if(silver)b"silver" else b"gold"));colors}
fun end(f:F){let F{sc,maker,a,b,cfg,clock,p}=f;let mut sc=sc;let revision=player::revision(&p);player::close(p,revision,sc.ctx());test_scenario::return_shared(maker);test_scenario::return_shared(a);test_scenario::return_shared(b);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.end();}

#[test]
fun two_pack_same_part_names_keep_distinct_fixed_style_slots(){let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let ka=key(&f.a);let kb=key(&f.b);assert!(ka!=kb && assembly::part_name(&ka)==assembly::part_name(&kb),0);assert!(player::parts(&f.p).length()==5 && player::profiles(&f.p).length()==2 && player::scoped_selection(&f.p,ka).is_some() && player::scoped_selection(&f.p,kb).is_some() && player::selection(&f.p,b"accessory").is_none(),1);assert!(player::render_plan(&f.p).length()==3 && f.sc.ids_for_sender<Item>().is_empty(),2);end(f)}
#[test]
fun own_palette_change_does_not_recolor_another_same_name_pack(){let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let a=scope(&f.a);let b=scope(&f.b);player::set_pack_colors(&mut f.p,a,colors(true),3,f.sc.ctx());let layers=player::render_plan(&f.p);let mut gold=0;let mut silver=0;layers.do_ref!(|l|{if(visual::track_key(visual::layer_track(l))==b"glow"){let name=visual::swatch_key(&visual::layer_color(l).destroy_some());if(name==b"gold")gold=gold+1;if(name==b"silver")silver=silver+1}});assert!(gold==1 && silver==1 && player::pack_colors(&f.p,a)!=player::pack_colors(&f.p,b),0);end(f)}
#[test]
fun root_palette_links_inherited_channels_without_rewriting_pack_palette(){let mut f=setup();select(&mut f,true,b"inherited-color-style");player::set_colors(&mut f.p,vector[visual::color_choice(b"fabric",b"blue")],2,f.sc.ctx());let layers=player::render_plan(&f.p);assert!(layers.length()==2 && layers.all!(|l|visual::swatch_key(&visual::layer_color(l).destroy_some())==b"blue"),0);assert!(visual::choice_swatch(&player::pack_colors(&f.p,scope(&f.a))[0]).is_none(),1);end(f)}
#[test,expected_failure(abort_code=4,location=soulidity_model::assembly)]
fun pack_palette_cannot_shadow_inherited_root_channel(){let mut f=setup();select(&mut f,true,b"pack-style");let target=scope(&f.a);player::set_pack_colors(&mut f.p,target,vector[visual::color_choice(b"fabric",b"blue"),visual::color_choice(b"metal",b"gold")],2,f.sc.ctx());end(f)}
#[test]
fun replacement_remains_one_fixed_style_unit_in_one_scoped_part(){let mut f=setup();select(&mut f,true,b"pack-style");let original=policy::source_hash(player::source(&player::scoped_selection(&f.p,key(&f.a)).destroy_some()));select(&mut f,true,b"alt-style");assert!(player::parts(&f.p).length()==4 && player::profiles(&f.p).length()==1 && policy::source_hash(player::source(&player::scoped_selection(&f.p,key(&f.a)).destroy_some()))!=original && player::render_plan(&f.p).length()==2,0);end(f)}
#[test]
fun typed_slot_and_palette_change_are_in_semantic_recipe(){let mut f=setup();let before=player::semantic_recipe_hash(&f.p);select(&mut f,true,b"pack-style");let added=player::semantic_recipe_hash(&f.p);assert!(added!=before,0);let target=scope(&f.a);player::set_pack_colors(&mut f.p,target,colors(true),2,f.sc.ctx());assert!(player::semantic_recipe_hash(&f.p)!=added,1);let recipe=player::semantic_recipe(&f.p);assert!(recipe.length()==4 && output::slot_part(&recipe[3])==key(&f.a),2);end(f)}
#[test]
fun admission_order_does_not_change_canonical_recipe_or_render_order(){
 let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let hash=player::semantic_recipe_hash(&f.p);let plan=bcs::to_bytes(&player::render_plan(&f.p));
 let F{mut sc,mut maker,a,b,cfg,clock,p}=f;let id=player::create_for_testing(&mut maker,&cfg,2,0,1000,fixtures::h(34),&clock,sc.ctx());sc.next_tx(@0xb);let mut other:Player=sc.take_from_sender_by_id(id);
 let d=pub_fixture::def(&pub_fixture::base(),b"ref",b"style",false,false);player::set_base_for_testing(&mut other,&maker,&cfg,policy::definition_hash(&d),fixtures::layout(),0,0,1000,&clock,sc.ctx());
 let d=pub_fixture::def(&scene(false),b"accessory",b"pack-style",true,false);player::set_pack_for_testing(&mut other,&maker,&b,&cfg,1,policy::definition_hash(&d),fixtures::layout(),1,0,1000,&clock,sc.ctx());
 let d=pub_fixture::def(&scene(true),b"accessory",b"pack-style",true,false);player::set_pack_for_testing(&mut other,&maker,&a,&cfg,1,policy::definition_hash(&d),fixtures::layout(),2,0,1000,&clock,sc.ctx());
 assert!(player::semantic_recipe_hash(&other)==hash && bcs::to_bytes(&player::render_plan(&other))==plan,0);player::close(other,3,sc.ctx());end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun clearing_one_pack_slot_does_not_remove_another_same_name_slot(){let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let target=key(&f.a);player::clear_scoped(&mut f.p,target,3,f.sc.ctx());assert!(player::scoped_selection(&f.p,key(&f.a)).is_none() && player::scoped_selection(&f.p,key(&f.b)).is_some() && player::render_plan(&f.p).length()==2,0);end(f)}
#[test]
fun inactive_pack_trigger_cannot_be_satisfied_by_another_same_name_part(){let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let target=key(&f.a);player::clear_scoped(&mut f.p,target,3,f.sc.ctx());player::clear(&mut f.p,b"ref",4,f.sc.ctx());assert!(player::render_plan(&f.p).length()==1,0);end(f)}
#[test,expected_failure(abort_code=5,location=soulidity_visual::visual)]
fun active_pack_rule_still_requires_actual_root_provider(){let mut f=setup();select(&mut f,true,b"pack-style");player::clear(&mut f.p,b"ref",2,f.sc.ctx());player::render_plan(&f.p);end(f)}
#[test,expected_failure(abort_code=3,location=soulidity_maker_manufacturing::maker_player)]
fun stale_revision_cannot_change_pack_palette(){let mut f=setup();select(&mut f,true,b"pack-style");let target=scope(&f.a);player::set_pack_colors(&mut f.p,target,colors(true),1,f.sc.ctx());end(f)}
#[test,expected_failure(abort_code=1,location=soulidity_model::assembly)]
fun unadmitted_pack_cannot_change_palette_using_copyable_metadata(){let mut f=setup();let target=scope(&f.a);player::set_pack_colors(&mut f.p,target,colors(true),1,f.sc.ctx());end(f)}
#[test]
fun scoped_reset_and_close_preserve_preview_only_boundary(){let mut f=setup();select(&mut f,true,b"pack-style");let target=key(&f.a);player::reset_scoped_layout(&mut f.p,target,2,f.sc.ctx());assert!(player::layout(&player::scoped_selection(&f.p,key(&f.a)).destroy_some())==fixtures::layout() && f.sc.ids_for_sender<Item>().is_empty(),0);end(f)}
#[test]
fun cleared_pack_preferences_do_not_force_unused_pack_into_complete_recipe(){let mut f=setup();let root=player::semantic_recipe_hash(&f.p);select(&mut f,true,b"pack-style");let scope=scope(&f.a);player::set_pack_colors(&mut f.p,scope,colors(true),2,f.sc.ctx());let target=key(&f.a);player::clear_scoped(&mut f.p,target,3,f.sc.ctx());assert!(player::semantic_recipe_hash(&f.p)==root && player::semantic_recipe(&f.p).length()==3 && player::profiles(&f.p).is_empty() && player::profile_scopes(&f.p).length()==1 && player::pack_colors(&f.p,scope)==colors(true),0);end(f)}
#[test,expected_failure(abort_code=6,location=soulidity_v1::issuer)]
fun complete_cannot_silently_drop_selected_pack_profile_and_slot(){
    let mut f=setup();select(&mut f,true,b"pack-style");let expected=player::semantic_recipe_hash(&f.p);
    let F{mut sc,mut maker,a,b,mut cfg,clock,p}=f;let v=catalog::published(&maker,2);let out=catalog::output_policy(v,b"default");
    let intent=output::intent(catalog::protocol(&maker),object::id(&maker),2,catalog::policy_hash(v),output::policy_hash(&out),@0xb,fixtures::h(55),std::string::utf8(b"OC"),expected,vector::tabulate!(16,|_|55));
    let mut build=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&cfg),&mut maker,&mut cfg,intent,b"default",0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx());let d=pub_fixture::def(&pub_fixture::base(),b"ref",b"style",false,false);issuer::select(&mut build,&mut maker,policy::definition_hash(&d),b"ref",fixtures::layout(),sc.ctx());
    let mut system=fixtures::prepare_storage(&mut sc);fixtures::finish(&mut sc,build,&mut system,&clock);storage_fixture::return_system(system);end(F{sc,maker,a,b,cfg,clock,p})
}
