#[test_only]
module soulidity_v1::pack_soul_tests;
use std::bcs;
use sui::test_scenario::{Self,Scenario};
use sui::clock::{Self,Clock};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_v1::pack_publication_tests as pub_fixture;
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::Config;
use soulidity_visual::visual::{Self,Scene};
use soulidity_model::policy;
use soulidity_model::assembly::{Self,Scope,PartKey};
use soulidity_maker_manufacturing::maker_player::{Player};
use soulidity_v1::player;
use soulidity_model::components::Item;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_market::market::{Listing};
use soulidity_v1::market;
use soulidity_application::output;
use soulidity_v1::issuer;
use soulidity_v1::storage_fixture;
use sui::coin;
use soulidity_v1::physical::{Self,Registry,Asset};
use soulidity_model::material_policy;
use soulidity_application::visual_capture;
use soulidity_application::forms;
use soulidity_standard::soul as standard;
public struct F {sc:Scenario,maker:Product<USD>,a:Product<USD>,b:Product<USD>,cfg:Config<USD>,clock:Clock,p:Player}
#[test]
fun forms_restore_both_same_name_pack_palettes_and_original_free_ids(){
    let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");
    let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);
    let ia=soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some());let ib=soul::free_id(&soul::binding_scoped(&s,key(&b)).destroy_some());
    let root=standard::revision(&s);let form=forms::save(&mut s,b"silver",option::none(),0,0,root,0,sc.ctx());
    let original=soul::semantic_recipe_hash(&s);let original_render=bcs::to_bytes(&soul::render_plan(&s));
    soul::tune_pack_colors(&mut s,scope(&a),colors(true),0);
    soul::tune_scoped(&mut s,key(&b),policy::layout(false,1,false,0,1000000,0,vector[]),1);
    let root=standard::revision(&s);let current=soul::recipe_hash(&s);
    forms::activate(&mut s,form,vector[],1,root,2,current,sc.ctx()).destroy_empty();
    assert!(soul::semantic_recipe_hash(&s)==original && bcs::to_bytes(&soul::render_plan(&s))==original_render,0);
    assert!(soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some())==ia && soul::free_id(&soul::binding_scoped(&s,key(&b)).destroy_some())==ib,1);
    assert!(forms::active_is_current(&s) && sc.ids_for_sender<Item>().is_empty(),2);
    sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
fun z():visual::Signed{visual::signed(false,0)}
fun sel(part:vector<u8>):visual::Selector{visual::selector(option::none(),option::none(),part,option::none(),option::none())}
fun scene(rule:bool):Scene{
    let base=pub_fixture::base();let mut rules=vector[pub_fixture::base_rule()];if(rule)rules.push_back(visual::rule(b"pack-rule",0,sel(b"accessory"),false,vector[sel(b"ref")]));
    let mut channels=*visual::channels(&base);channels.push_back(visual::channel(b"metal",b"gold",true,vector[visual::swatch(b"gold",3,vector[]),visual::swatch(b"silver",4,vector[])]));
    visual::scene(1024,1024,z(),z(),0,fixtures::h(14),b"body",b"pose",vector[b"ref",b"bound",b"free",b"accessory"],vector[visual::track(b"back",0,false),visual::track(b"glow",1,false),visual::track(b"front",2,true)],channels,vector[visual::anchor(b"root",vector[],z(),z()),visual::anchor(b"pack-root",vector[],z(),z())],rules)
}
fun definition(scene:&Scene,style:vector<u8>,rights:u8):policy::Definition{
    let d=pub_fixture::def(scene,b"accessory",style,style!=b"inherited-color-style",false);
    policy::definition(b"accessory",b"item",style,rights,fixtures::h(11),fixtures::h(12),*policy::representation(&d),10,fixtures::layout(),policy::bounds(10000,10000,500000,2000000,90000,vector[]),vector[],vector[],true)
}
fun publish(sc:&mut Scenario,id:ID,rule:bool,rights:u8){let mut p:Product<USD> = sc.take_shared_by_id(id);let mut c=pub_fixture::control(sc,id);let scene=scene(rule);let defs=vector[definition(&scene,b"pack-style",rights),definition(&scene,b"alt-style",rights),definition(&scene,b"inherited-color-style",rights)];catalog::publish(&mut p,&mut c,0,catalog::with_pack_key(pub_fixture::draft(scene,vector[b"accessory"],defs,vector[]),b"pack"));sc.return_to_sender(c);test_scenario::return_shared(p)}
fun setup():F{setup_rights(2,2)}
fun fresh_enhancement(rights:u8):(Scenario,Product<USD>,Product<USD>,Product<USD>,Config<USD>,Clock,Player,ID){mint_impl(setup_rights(rights,2),false,false)}
fun buy_choice(sc:&mut Scenario,s:&mut Soul,maker:&Product<USD>,pack:&mut Product<USD>,cfg:&mut Config<USD>,clock:&Clock,style:vector<u8>,attempt:u8):vector<Item>{
 let version=catalog::current_version(pack);let d=catalog::definitions(catalog::published(pack,version)).filter!(|d|visual::selector_style(&policy::definition_path(d))==option::some(style))[0];
 let revision=soul::revision(s);let target=key(pack);let hash=catalog::policy_hash(catalog::published(pack,version));let payment=coin::mint_for_testing<USD>(catalog::completion_price(pack,version,sc.ctx().sender()),sc.ctx());
 issuer::enhance_pack_for_testing(s,pack,maker,cfg,version,revision,hash,vector[issuer::purchase(policy::definition_hash(&d),target,fixtures::layout())],fixtures::h(attempt),0,1000,payment,clock,sc.ctx())
}
// Frozen published choice is reused; every purchase still validates the live
// revision, policy, payment, supply, receipt and captured source in issuer.
fun buy_definition(sc:&mut Scenario,s:&mut Soul,maker:&Product<USD>,pack:&mut Product<USD>,cfg:&mut Config<USD>,clock:&Clock,definition:vector<u8>,attempt:u8):vector<Item>{
 let version=catalog::current_version(pack);let revision=soul::revision(s);let target=key(pack);let hash=catalog::policy_hash(catalog::published(pack,version));let payment=coin::mint_for_testing<USD>(catalog::completion_price(pack,version,sc.ctx().sender()),sc.ctx());
 issuer::enhance_pack_for_testing(s,pack,maker,cfg,version,revision,hash,vector[issuer::purchase(definition,target,fixtures::layout())],fixtures::h(attempt),0,1000,payment,clock,sc.ctx())
}
fun setup_rights(a_rights:u8,b_rights:u8) : F {
    let(mut sc,maker,a,_)=pub_fixture::setup();publish(&mut sc,a,true,a_rights);sc.next_tx(@0xa);
    let m:Product<USD> = sc.take_shared_by_id(maker);let cfg:Config<USD> = sc.take_shared();let mut cap=pub_fixture::control(&sc,maker);let b=catalog::create_pack_for_testing(&m,2,&mut cap,&cfg,0,sc.ctx());sc.return_to_sender(cap);test_scenario::return_shared(m);test_scenario::return_shared(cfg);sc.next_tx(@0xa);publish(&mut sc,b,false,b_rights);sc.next_tx(@0xb);
    let mut maker:Product<USD> = sc.take_shared_by_id(maker);let a:Product<USD> = sc.take_shared_by_id(a);let b:Product<USD> = sc.take_shared_by_id(b);let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let id=player::create_for_testing(&mut maker,&cfg,2,0,1000,fixtures::h(33),&clock,sc.ctx());sc.next_tx(@0xb);let mut p:Player=sc.take_from_sender_by_id(id);let d=pub_fixture::def(&pub_fixture::base(),b"ref",b"style",false,false);player::set_base_for_testing(&mut p,&maker,&cfg,policy::definition_hash(&d),fixtures::layout(),0,0,1000,&clock,sc.ctx());F{sc,maker,a,b,cfg,clock,p}
}
fun scope(p:&Product<USD>):Scope{assembly::profile_scope(&catalog::assembly_profile(p,catalog::current_version(p)))}
fun key(p:&Product<USD>):PartKey{assembly::scoped_part(scope(p),b"accessory")}
fun select(f:&mut F,a:bool,style:vector<u8>){let p=if(a)&f.a else &f.b;let defs=catalog::definitions(catalog::published(p,1));let d=defs.filter!(|d|visual::selector_style(&policy::definition_path(d))==option::some(style))[0];let revision=player::revision(&f.p);player::set_pack_for_testing(&mut f.p,&f.maker,p,&f.cfg,1,policy::definition_hash(&d),fixtures::layout(),revision,0,1000,&f.clock,f.sc.ctx())}
fun colors(silver:bool):vector<visual::ColorChoice>{let base=pub_fixture::base();let mut colors=visual::default_colors(&base);colors.push_back(visual::color_choice(b"metal",if(silver)b"silver" else b"gold"));colors}
fun end(f:F){let F{sc,maker,a,b,cfg,clock,p}=f;let mut sc=sc;let revision=player::revision(&p);player::close(p,revision,sc.ctx());test_scenario::return_shared(maker);test_scenario::return_shared(a);test_scenario::return_shared(b);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.end();}


fun mint(f:F,two:bool):(Scenario,Product<USD>,Product<USD>,Product<USD>,Config<USD>,Clock,Player,ID){mint_impl(f,true,two)}
fun mint_without_a(f:F):(Scenario,Product<USD>,Product<USD>,Product<USD>,Config<USD>,Clock,Player,ID){mint_impl(f,false,true)}
fun mint_impl(f:F,use_a:bool,use_b:bool):(Scenario,Product<USD>,Product<USD>,Product<USD>,Config<USD>,Clock,Player,ID){
 let F{mut sc,mut maker,mut a,mut b,mut cfg,clock,p}=f;let v=catalog::published(&maker,2);let out=catalog::output_policy(v,b"default");let seed=(56+catalog::wallet_completes(&maker,2,@0xb)) as u8;let intent=output::intent(catalog::protocol(&maker),object::id(&maker),2,catalog::policy_hash(v),output::policy_hash(&out),@0xb,fixtures::h(seed),std::string::utf8(b"OC"),player::semantic_recipe_hash(&p),vector::tabulate!(16,|_|seed));
 let mut build=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&cfg),&mut maker,&mut cfg,intent,b"default",0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx());
 if(use_a){let version=catalog::current_version(&a);let hash=catalog::policy_hash(catalog::published(&a,version));issuer::include_pack_for_testing(&mut build,&mut a,&maker,&mut cfg,version,hash,0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx())};
 if(use_b){let version=catalog::current_version(&b);let hash=catalog::policy_hash(catalog::published(&b,version));issuer::include_pack_for_testing(&mut build,&mut b,&maker,&mut cfg,version,hash,0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx())};
 let revision=player::revision(&p);issuer::select_player(&mut build,&mut maker,&p,b"ref",revision,sc.ctx());
 if(use_a){let key=key(&a);issuer::select_player_scoped(&mut build,&mut a,&p,key,revision,sc.ctx())};if(use_b){let key=key(&b);issuer::select_player_scoped(&mut build,&mut b,&p,key,revision,sc.ctx())};
 let mut system=fixtures::prepare_storage(&mut sc);let id=fixtures::finish(&mut sc,build,&mut system,&clock);storage_fixture::return_system(system);sc.next_tx(@0xb);(sc,maker,a,b,cfg,clock,p,id)
}
#[test]
fun complete_preserves_two_same_name_pack_slots_palettes_and_original_profile_scenes(){
 let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let scope=scope(&f.a);player::set_pack_colors(&mut f.p,scope,colors(true),3,f.sc.ctx());let expected=player::semantic_recipe_hash(&f.p);let plan=bcs::to_bytes(&player::render_plan(&f.p));
 let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let s:Soul=sc.take_from_sender_by_id(id);
 assert!(soul::semantic_recipe_hash(&s)==expected && bcs::to_bytes(&soul::render_plan(&s))==plan,0);
 let out=soul::original_output(&s);assert!(output::original_recipe_hash(out)==expected && output::original_profiles(out).length()==2 && soul::parts(&s).length()==5,1);
 assert!(*assembly::profile_scene(output::original_profile(out,scope))==scene(true),2);
 let ka=key(&a);let kb=key(&b);assert!(soul::free_id(&soul::binding_scoped(&s,ka).destroy_some()).is_some() && soul::free_id(&soul::binding_scoped(&s,kb).destroy_some()).is_some() && sc.ids_for_sender<Item>().is_empty(),3);
 sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun scoped_detach_and_reattach_preserve_item_identity_and_other_pack(){
 let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);let ka=key(&a);let kb=key(&b);let ia=soul::free_id(&soul::binding_scoped(&s,ka).destroy_some()).destroy_some();let ib=soul::free_id(&soul::binding_scoped(&s,kb).destroy_some()).destroy_some();
 let it=soul::detach_scoped(&mut s,ka,0);assert!(object::id(&it)==ia && soul::binding_scoped(&s,ka).is_none() && soul::free_id(&soul::binding_scoped(&s,kb).destroy_some())==option::some(ib),0);soul::attach_scoped(&mut s,it,ka,fixtures::layout(),1);assert!(soul::free_id(&soul::binding_scoped(&s,ka).destroy_some())==option::some(ia) && soul::render_plan(&s).length()==3,1);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun soul_palette_tuning_changes_current_recipe_but_not_original_output(){
 let mut f=setup();select(&mut f,true,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);let original=output::original_recipe_hash(soul::original_output(&s));let scope=scope(&a);soul::tune_pack_colors(&mut s,scope,colors(true),0);assert!(soul::semantic_recipe_hash(&s)!=original && output::original_recipe_hash(soul::original_output(&s))==original,0);assert!(output::original_profiles(soul::original_output(&s))!=soul::semantic_profiles(&s),1);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_revision_cannot_tune_scoped_soul_palette(){let mut f=setup();select(&mut f,true,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);let scope=scope(&a);soul::tune_pack_colors(&mut s,scope,colors(true),1);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=4,location=soulidity_model::assembly)]
fun soul_pack_palette_cannot_override_root_channel(){let mut f=setup();select(&mut f,true,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);let scope=scope(&a);soul::tune_pack_colors(&mut s,scope,vector[visual::color_choice(b"fabric",b"blue"),visual::color_choice(b"metal",b"gold")],0);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test]
fun full_scoped_loadout_conserves_all_detached_item_ids(){
 let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);let ka=key(&a);let kb=key(&b);let ia=soul::free_id(&soul::binding_scoped(&s,ka).destroy_some()).destroy_some();let ib=soul::free_id(&soul::binding_scoped(&s,kb).destroy_some()).destroy_some();
 let slots=soul::parts(&s).map_ref!(|part|soul::empty_slot_scoped(*part));let hash=soul::recipe_hash(&s);let items=soul::apply_loadout(&mut s,slots,vector[],0,hash);assert!(items.length()==3 && items.any!(|it|object::id(it)==ia) && items.any!(|it|object::id(it)==ib),0);items.do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun mint_after_clear_does_not_charge_or_include_unused_pack(){let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let ka=key(&f.a);player::clear_scoped(&mut f.p,ka,3,f.sc.ctx());let(mut sc,maker,a,b,cfg,clock,p,id)=mint_without_a(f);let s:Soul=sc.take_from_sender_by_id(id);assert!(output::pay_lines(output::artifact_receipt(soul::original_output(&s))).length()==2 && soul::semantic_profiles(&s).length()==1 && soul::semantic_recipe_hash(&s)==player::semantic_recipe_hash(&p),0);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=6,location=soulidity_application::character)]
fun item_from_same_named_other_pack_cannot_cross_scoped_slot(){let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);let ka=key(&a);let kb=key(&b);let it=soul::detach_scoped(&mut s,ka,0);let previous=soul::replace_scoped(&mut s,it,kb,fixtures::layout(),1);previous.do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test]
fun whole_sale_hands_over_both_scoped_items_and_exact_profiles(){
 let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let target=scope(&f.a);player::set_pack_colors(&mut f.p,target,colors(true),3,f.sc.ctx());let expected=player::semantic_recipe_hash(&f.p);let(mut sc,maker,a,b,mut cfg,clock,p,id)=mint(f,true);sc.next_tx(@0xa);let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();soulidity_foundation::economics::configure(&mut cfg,&mut admin,0,1000,250,0,@0xf,false);sc.return_to_sender(admin);sc.next_tx(@0xb);let s:Soul=sc.take_from_sender_by_id(id);let ka=key(&a);let kb=key(&b);let ia=soul::free_id(&soul::binding_scoped(&s,ka).destroy_some());let ib=soul::free_id(&soul::binding_scoped(&s,kb).destroy_some());let hash=soul::manifest_hash(&s);let lid=market::list_soul(s,&cfg,101,1000,0,hash,1,&clock,sc.ctx());sc.next_tx(@0xc);let mut listing:Listing<Soul,USD> =sc.take_shared_by_id(lid);let bundle=market::bundle(&listing);assert!(soul::manifest_profiles(&bundle).length()==2 && soul::manifest_slots(&bundle).length()==5,0);let quote=market::soul_quote_hash(&listing,&cfg,@0xc);market::buy_soul(&mut listing,&mut cfg,0,hash,quote,1,fixtures::h(57),coin::mint_for_testing<USD>(101,sc.ctx()),&clock,sc.ctx());test_scenario::return_shared(listing);sc.next_tx(@0xc);let s:Soul=sc.take_from_sender_by_id(id);assert!(soul::semantic_recipe_hash(&s)==expected && soul::free_id(&soul::binding_scoped(&s,ka).destroy_some())==ia && soul::free_id(&soul::binding_scoped(&s,kb).destroy_some())==ib && soul::generation(&s)==1,1);sc.return_to_sender(s);sc.next_tx(@0xb);end(F{sc,maker,a,b,cfg,clock,p})
}

#[test]
fun complete_respects_creator_reference_and_bound_expansion_rights(){
 let mut f=setup_rights(0,1);select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let recipe=player::semantic_recipe_hash(&f.p);let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);let ka=key(&a);let kb=key(&b);
 assert!(soul::reference_count(&s)==1 && soul::bound_count(&s)==1 && soul::free_id(&soul::binding_scoped(&s,ka).destroy_some()).is_none() && soul::free_id(&soul::binding_scoped(&s,kb).destroy_some()).is_none() && sc.ids_for_sender<Item>().is_empty(),0);
 assert!(policy::source_product(soul::reference_source(&s,0))==object::id(&a) && policy::source_product(soul::bound_source(&s,0))==object::id(&b) && soul::semantic_recipe_hash(&s)==recipe,1);
 soul::clear_reference_scoped(&mut s,ka,0);soul::unmount_bound_scoped(&mut s,kb,1);assert!(soul::reference_count(&s)==1 && soul::bound_count(&s)==1 && soul::manifest_bound_count(&soul::manifest(&s))==1 && soul::profile_snapshots(&s).length()==2,2);
 soul::remount_reference_scoped(&mut s,0,ka,fixtures::layout(),2);soul::remount_bound_scoped(&mut s,0,kb,fixtures::layout(),3);assert!(soul::semantic_recipe_hash(&s)==recipe && output::original_recipe_hash(soul::original_output(&s))==recipe,3);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test,expected_failure(abort_code=3,location=soulidity_application::character)]
fun reference_expansion_cannot_be_exported_as_item(){let mut f=setup_rights(0,2);select(&mut f,true,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);let it=soul::detach_scoped(&mut s,key(&a),0);transfer::public_transfer(it,@0xb);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=3,location=soulidity_application::character)]
fun bound_expansion_cannot_be_exported_as_item(){let mut f=setup_rights(1,2);select(&mut f,true,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);let it=soul::detach_scoped(&mut s,key(&a),0);transfer::public_transfer(it,@0xb);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=6,location=soulidity_application::character)]
fun bound_expansion_cannot_remount_into_other_pack_same_name(){let mut f=setup_rights(1,1);select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);soul::unmount_bound_scoped(&mut s,key(&b),0);soul::unmount_bound_scoped(&mut s,key(&a),1);soul::remount_bound_scoped(&mut s,0,key(&b),fixtures::layout(),2);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=6,location=soulidity_application::character)]
fun reference_expansion_cannot_remount_into_other_pack_same_name(){let mut f=setup_rights(0,0);select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);soul::clear_reference_scoped(&mut s,key(&b),0);soul::clear_reference_scoped(&mut s,key(&a),1);soul::remount_reference_scoped(&mut s,0,key(&b),fixtures::layout(),2);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test]
fun mixed_rights_loadout_returns_only_real_free_objects_and_restores_records(){
 let mut f=setup_rights(0,1);select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);let root=assembly::root_part(b"ref");let rid=soul::free_id(&soul::binding_scoped(&s,root).destroy_some()).destroy_some();let hash=soul::recipe_hash(&s);let slots=soul::parts(&s).map_ref!(|k|soul::empty_slot_scoped(*k));let mut items=soul::apply_loadout(&mut s,slots,vector[],0,hash);assert!(items.length()==1 && object::id(&items[0])==rid && soul::bound_count(&s)==1 && soul::reference_count(&s)==1,0);
 let slots=soul::parts(&s).map_ref!(|k|if(*k==root)soul::free_slot_scoped(*k,rid,fixtures::layout()) else if(*k==key(&a))soul::reference_slot_scoped(*k,0,fixtures::layout()) else if(*k==key(&b))soul::bound_slot_scoped(*k,0,fixtures::layout()) else soul::empty_slot_scoped(*k));let hash=soul::recipe_hash(&s);let unused=soul::apply_loadout(&mut s,slots,items,1,hash);assert!(unused.is_empty() && soul::semantic_recipe_hash(&s)==output::original_recipe_hash(soul::original_output(&s)),1);unused.do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun whole_sale_includes_unmounted_bound_and_reference_inventory(){
 let mut f=setup_rights(0,1);select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let(mut sc,maker,a,b,mut cfg,clock,p,id)=mint(f,true);sc.next_tx(@0xa);let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();soulidity_foundation::economics::configure(&mut cfg,&mut admin,0,1000,250,0,@0xf,false);sc.return_to_sender(admin);sc.next_tx(@0xb);let mut s:Soul=sc.take_from_sender_by_id(id);let ka=key(&a);let kb=key(&b);soul::clear_reference_scoped(&mut s,ka,0);soul::unmount_bound_scoped(&mut s,kb,1);let hash=soul::manifest_hash(&s);let lid=market::list_soul(s,&cfg,101,1000,2,hash,1,&clock,sc.ctx());sc.next_tx(@0xc);let mut listing:Listing<Soul,USD> =sc.take_shared_by_id(lid);let bundle=market::bundle(&listing);assert!(soul::manifest_bound_count(&bundle)==1 && soul::manifest_profiles(&bundle).length()==2,0);let quote=market::soul_quote_hash(&listing,&cfg,@0xc);market::buy_soul(&mut listing,&mut cfg,0,hash,quote,1,fixtures::h(58),coin::mint_for_testing<USD>(101,sc.ctx()),&clock,sc.ctx());test_scenario::return_shared(listing);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(id);assert!(soul::generation(&s)==1 && soul::bound_count(&s)==1 && soul::reference_count(&s)==1,1);let r=soul::revision(&s);soul::remount_reference_scoped(&mut s,0,ka,fixtures::layout(),r);soul::remount_bound_scoped(&mut s,0,kb,fixtures::layout(),r+1);assert!(soul::semantic_recipe_hash(&s)==output::original_recipe_hash(soul::original_output(&s)),2);sc.return_to_sender(s);sc.next_tx(@0xb);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun post_mint_pack_admission_adds_empty_slots_without_issuing_rights(){
 let f=setup();let(mut sc,maker,a,b,cfg,clock,p,id)=mint_impl(f,false,false);let mut s:Soul=sc.take_from_sender_by_id(id);let original=soul::semantic_recipe_hash(&s);let before=soul::manifest_hash(&s);let completes=catalog::wallet_completes(&a,1,@0xb);let scope=soul::admit_pack(&mut s,catalog::assembly_profile(&a,1),0);assert!(scope==scope(&a) && soul::parts(&s).length()==4 && soul::binding_scoped(&s,key(&a)).is_none() && soul::revision(&s)==1 && soul::manifest_hash(&s)!=before,0);assert!(soul::semantic_recipe_hash(&s)==original && output::original_recipe_hash(soul::original_output(&s))==original && soul::reference_count(&s)==0 && soul::bound_count(&s)==0 && catalog::wallet_completes(&a,1,@0xb)==completes && !catalog::access_held(&a,1,@0xb) && sc.ids_for_sender<Item>().is_empty(),1);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun post_mint_pack_admission_requires_current_soul_revision(){let f=setup();let(mut sc,maker,a,b,cfg,clock,p,id)=mint_impl(f,false,false);let mut s:Soul=sc.take_from_sender_by_id(id);soul::admit_pack(&mut s,catalog::assembly_profile(&a,1),1);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=2,location=soulidity_application::character)]
fun post_mint_maker_cannot_impersonate_pack(){let f=setup();let(mut sc,maker,a,b,cfg,clock,p,id)=mint_impl(f,false,false);let mut s:Soul=sc.take_from_sender_by_id(id);soul::admit_pack(&mut s,catalog::assembly_profile(&maker,2),0);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test]
fun post_mint_pack_accepts_previously_issued_wallet_item_with_exact_id(){
 let mut f=setup();select(&mut f,true,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut donor:Soul=sc.take_from_sender_by_id(id);let item=soul::detach_scoped(&mut donor,key(&a),0);let iid=object::id(&item);transfer::public_transfer(item,@0xb);sc.return_to_sender(donor);let r=player::revision(&p);let mut p=p;player::clear_scoped(&mut p,key(&a),r,sc.ctx());let(mut sc,maker,a,b,cfg,clock,p,target)=mint_impl(F{sc,maker,a,b,cfg,clock,p},false,false);let mut s:Soul=sc.take_from_sender_by_id(target);soul::admit_pack(&mut s,catalog::assembly_profile(&a,1),0);let item:Item=sc.take_from_sender_by_id(iid);soul::attach_scoped(&mut s,item,key(&a),fixtures::layout(),1);assert!(soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some())==option::some(iid) && target!=id && output::original_profiles(soul::original_output(&s)).is_empty(),0);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun paid_pack_empty_slot_admission_grants_no_paid_usage_or_component(){
 let f=setup();let(mut sc,maker,mut a,b,cfg,clock,p,id)=mint_impl(f,false,false);let mut s:Soul=sc.take_from_sender_by_id(id);sc.next_tx(@0xa);let mut cap=pub_fixture::control(&sc,object::id(&a));let scene=scene(true);let d=definition(&scene,b"pack-style",2);let v=catalog::version(fixtures::h(1),fixtures::h(2),1,15,1,17,0,0,0,@0xd,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"accessory"],vector[],vector[d],vector[],scene);catalog::publish(&mut a,&mut cap,1,catalog::with_pack_key(v,b"pack"));sc.return_to_sender(cap);sc.next_tx(@0xb);let original=soul::semantic_recipe_hash(&s);soul::admit_pack(&mut s,catalog::assembly_profile(&a,2),0);assert!(!catalog::access_held(&a,2,@0xb) && catalog::wallet_completes(&a,2,@0xb)==0 && soul::binding_scoped(&s,key(&a)).is_none() && soul::bound_count(&s)==0 && soul::reference_count(&s)==0 && soul::semantic_recipe_hash(&s)==original && sc.ids_for_sender<Item>().is_empty(),0);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test,expected_failure(abort_code=1,location=soulidity_model::assembly)]
fun pack_of_another_actual_maker_version_cannot_enter_soul(){
 let f=setup();let(mut sc,maker,a,b,cfg,clock,p,id)=mint_impl(f,false,false);let mut s:Soul=sc.take_from_sender_by_id(id);sc.next_tx(@0xa);let mut cap=pub_fixture::control(&sc,object::id(&maker));let other_id=catalog::create_pack_for_testing(&maker,1,&mut cap,&cfg,0,sc.ctx());sc.return_to_sender(cap);sc.next_tx(@0xa);let mut other:Product<USD> = sc.take_shared_by_id(other_id);let mut cap=pub_fixture::control(&sc,other_id);let d=fixtures::pack_def(b"bound",1,20);catalog::publish(&mut other,&mut cap,0,catalog::with_pack_key(pub_fixture::draft(fixtures::scene(),vector[b"bound"],vector[d],vector[]),b"other-pack"));sc.return_to_sender(cap);sc.next_tx(@0xb);soul::admit_pack(&mut s,catalog::assembly_profile(&other,1),0);test_scenario::return_shared(other);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
fun publish_adapter(f:&mut F){
 f.sc.next_tx(@0xa);let mut cap=pub_fixture::control(&f.sc,object::id(&f.b));let scene=scene(false);let source=catalog::preview_source(&f.a,1,policy::definition_hash(&definition(&scene(true),b"pack-style",2)));let t=visual::transform(z(),z(),1000000,z());let mapping=visual::mapping(policy::source_representation(&source),&scene,vector[visual::fragment_map(0,b"front",b"root",t,option::some(b"fabric"),option::some(b"blue"))]);let adapter=policy::adapter(&source,&scene,b"accessory",mapping,policy::bounds(0,0,1000000,1000000,0,vector[]));let d=definition(&scene,b"pack-style",2);let v=catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xd,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"accessory"],vector[],vector[d],vector[adapter],scene);catalog::publish(&mut f.b,&mut cap,1,catalog::with_pack_key(v,b"pack"));f.sc.return_to_sender(cap);f.sc.next_tx(@0xb);
}
#[test]
fun actual_published_scoped_adapter_moves_item_with_exact_provenance_and_mapping(){
 let mut f=setup();select(&mut f,true,b"pack-style");publish_adapter(&mut f);let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);soul::admit_pack(&mut s,catalog::assembly_profile(&b,2),0);let it=soul::detach_scoped(&mut s,key(&a),1);let iid=object::id(&it);soul::attach_scoped(&mut s,it,key(&b),fixtures::layout(),2);let binding=soul::binding_scoped(&s,key(&b)).destroy_some();assert!(soul::free_id(&binding)==option::some(iid) && policy::source_product(soul::binding_source(&binding))==object::id(&a) && soul::semantic_profiles(&s).length()==2 && output::original_profiles(soul::original_output(&s)).length()==1,0);let plan=soul::render_plan(&s);assert!(plan.length()==2 && plan.any!(|l|visual::track_key(visual::layer_track(l))==b"front"),1);let it=soul::detach_scoped(&mut s,key(&b),3);assert!(object::id(&it)==iid,2);transfer::public_transfer(it,@0xb);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test,expected_failure(abort_code=2,location=soulidity_model::policy)]
fun scoped_adapter_tuning_obeys_published_target_bounds(){let mut f=setup();select(&mut f,true,b"pack-style");publish_adapter(&mut f);let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);soul::admit_pack(&mut s,catalog::assembly_profile(&b,2),0);let it=soul::detach_scoped(&mut s,key(&a),1);soul::attach_scoped(&mut s,it,key(&b),fixtures::layout(),2);soul::tune_scoped(&mut s,key(&b),policy::layout(false,1,false,0,1000000,0,vector[]),3);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}

fun controls(sc:&Scenario,maker:ID,pack:ID):(Control,Control){let mut m=option::none();let mut p=option::none();sc.ids_for_sender<Control>().do_ref!(|id|{let c:Control=sc.take_from_sender_by_id(*id);let product=catalog::control_product(&c);if(product==maker)m.fill(c) else if(product==pack)p.fill(c) else sc.return_to_sender(c)});(m.destroy_some(),p.destroy_some())}
// Actual dual-control registration on a Pack's own expanded Scene/Part.
fun register_physical(f:&mut F,mode:u8):Registry<USD>{
 f.sc.next_tx(@0xa);let(mut maker_cap,mut pack_cap)=controls(&f.sc,object::id(&f.maker),object::id(&f.a));let d=definition(&scene(true),b"pack-style",2);let terms=material_policy::terms(policy::definition_hash(&d),fixtures::h(90),mode,if(mode==2)2 else 0,if(mode==1)37 else 0,3,true);catalog::publish(&mut f.a,&mut pack_cap,1,catalog::with_physical(catalog::with_pack_key(pub_fixture::draft(scene(true),vector[b"accessory"],vector[d],vector[]),b"pack"),vector[terms]));let id={let F{sc,maker,cfg,..}=f;physical::create_registry_for_testing(maker,&mut maker_cap,2,cfg,sc.ctx())};f.sc.return_to_sender(maker_cap);f.sc.return_to_sender(pack_cap);f.sc.next_tx(@0xa);let mut r:Registry<USD> =f.sc.take_shared_by_id(id);let(mut maker_cap,mut pack_cap)=controls(&f.sc,object::id(&f.maker),object::id(&f.a));physical::register_pack(&mut r,&f.maker,&mut maker_cap,&f.a,&mut pack_cap,2,0,f.sc.ctx());f.sc.return_to_sender(maker_cap);f.sc.return_to_sender(pack_cap);f.sc.next_tx(@0xb);
 let d=definition(&scene(true),b"pack-style",2);let rev=player::revision(&f.p);player::set_pack_for_testing(&mut f.p,&f.maker,&f.a,&f.cfg,2,policy::definition_hash(&d),policy::layout_signed(true,41,false,27,1100000,true,5000,vector[]),rev,0,1000,&f.clock,f.sc.ctx());let scope=assembly::profile_scope(&catalog::assembly_profile(&f.a,2));let rev=player::revision(&f.p);player::set_pack_colors(&mut f.p,scope,colors(true),rev,f.sc.ctx());r
}
fun physical_key(f:&F):PartKey{assembly::scoped_part(assembly::profile_scope(&catalog::assembly_profile(&f.a,2)),b"accessory")}
fun claim_visual(f:&mut F,r:&mut Registry<USD>,attempt:u8):Asset{
 let source=*player::source(&player::scoped_selection(&f.p,physical_key(f)).destroy_some());let hash=policy::source_hash(&source);let quote=physical::quote(r,hash,&f.cfg,@0xb,1000);let rev=physical::revision(r);let issued=physical::issued(physical::rule(r,hash));physical::claim_scoped(r,&f.maker,&f.a,&f.p,physical_key(f),&f.cfg,player::revision(&f.p),rev,issued,0,1000,quote,fixtures::h(attempt),&f.clock,f.sc.ctx())
}
#[test]
fun expanded_physical_freezes_full_player_scene_colors_fixed_style_and_layout(){
 let mut f=setup();let mut r=register_physical(&mut f,0);let expected=player::semantic_recipe_hash(&f.p);let plan=bcs::to_bytes(&player::render_plan(&f.p));let pid=object::id(&f.p);let rev=player::revision(&f.p);let a=claim_visual(&mut f,&mut r,60);let capture=physical::asset_visual(&a);assert!(visual_capture::subject(capture)==pid && visual_capture::revision(capture)==rev && visual_capture::recipe_hash(capture)==expected && bcs::to_bytes(&visual_capture::render_plan(capture,f.sc.ctx()))==plan && *visual_capture::scene(capture)==pub_fixture::base(),0);let scope=assembly::profile_scope(&catalog::assembly_profile(&f.a,2));assert!(*assembly::profile_scene(visual_capture::profile(capture,scope))==scene(true) && visual_capture::profiles(capture).length()==1 && visual_capture::recipe(capture).length()==4,1);let hash=physical::snapshot_visual(&physical::snapshot(&a));player::set_pack_colors(&mut f.p,scope,colors(false),rev,f.sc.ctx());let target=physical_key(&f);let rev=player::revision(&f.p);player::reset_scoped_layout(&mut f.p,target,rev,f.sc.ctx());assert!(player::semantic_recipe_hash(&f.p)!=expected && physical::snapshot_visual(&physical::snapshot(&a))==hash && visual_capture::recipe_hash(physical::asset_visual(&a))==expected && bcs::to_bytes(&visual_capture::render_plan(physical::asset_visual(&a),f.sc.ctx()))==plan,2);physical::consume(&mut r,a,0,f.sc.ctx());assert!(physical::issued(physical::rule(&r,policy::source_hash(player::source(&player::scoped_selection(&f.p,target).destroy_some()))))==1,3);test_scenario::return_shared(r);end(f)
}
#[test,expected_failure(abort_code=4,location=soulidity_v1::physical)]
fun changing_colors_does_not_reset_free_physical_authorization(){let mut f=setup();let mut r=register_physical(&mut f,0);let a=claim_visual(&mut f,&mut r,61);physical::consume(&mut r,a,0,f.sc.ctx());let scope=assembly::profile_scope(&catalog::assembly_profile(&f.a,2));let rev=player::revision(&f.p);player::set_pack_colors(&mut f.p,scope,colors(false),rev,f.sc.ctx());let a=claim_visual(&mut f,&mut r,62);physical::deliver(a);test_scenario::return_shared(r);end(f)}
#[test]
fun expanded_physical_paid_routes_real_coin_and_freezes_exact_recipe(){
 let mut f=setup();let mut r=register_physical(&mut f,1);let target=physical_key(&f);let source=*player::source(&player::scoped_selection(&f.p,target).destroy_some());let hash=policy::source_hash(&source);let quote=physical::quote(&r,hash,&f.cfg,@0xb,1000);let expected=player::semantic_recipe_hash(&f.p);let coin=coin::mint_for_testing<USD>(37,f.sc.ctx());let a={let F{sc,maker,a,b:_,cfg,clock,p}=&mut f;let rev=player::revision(p);physical::purchase_pack_scoped_for_testing(&mut r,maker,a,p,target,cfg,coin,rev,1,0,0,1000,quote,fixtures::h(63),clock,sc.ctx())};assert!(soulidity_foundation::revenue::balance(catalog::income(&f.a))==34 && soulidity_foundation::revenue::balance(soulidity_foundation::economics::income(&f.cfg))==3 && visual_capture::recipe_hash(physical::asset_visual(&a))==expected && physical::gross(&physical::stats(&r))==37,0);physical::consume(&mut r,a,0,f.sc.ctx());test_scenario::return_shared(r);end(f)
}
fun materialize_visual(f:&mut F,r:&mut Registry<USD>,s:&mut Soul):Asset{
 let target=physical_key(f);let source=*soul::binding_source(&soul::binding_scoped(s,target).destroy_some());let key=policy::source_hash(&source);let quote=physical::quote(r,key,&f.cfg,@0xb,1000);let sr=soul::revision(s);let rr=physical::revision(r);let issued=physical::issued(physical::rule(r,key));physical::materialize_scoped(r,&f.maker,&f.a,s,target,b"print-expanded",&f.cfg,sr,rr,issued,0,1000,quote,fixtures::h(65),&f.clock,f.sc.ctx())
}
#[test]
fun expanded_physical_proof_freezes_actual_soul_original_composition(){
 let mut f=setup();let mut r=register_physical(&mut f,2);let recipe=player::semantic_recipe_hash(&f.p);let plan=bcs::to_bytes(&player::render_plan(&f.p));let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);let artifact=object::id(soul::original_output(&s));let mut f=F{sc,maker,a,b,cfg,clock,p};let asset=materialize_visual(&mut f,&mut r,&mut s);let c=physical::asset_visual(&asset);let proof=physical::asset_proof(&asset).destroy_some();assert!(visual_capture::subject(c)==id && visual_capture::revision(c)==0 && visual_capture::recipe_hash(c)==recipe && soulidity_maker_terms::maker_physical_metadata::proof_recipe(&proof)==recipe && bcs::to_bytes(&visual_capture::render_plan(c,f.sc.ctx()))==plan && soul::revision(&s)==1 && object::id(soul::original_output(&s))==artifact,0);physical::consume(&mut r,asset,0,f.sc.ctx());f.sc.return_to_sender(s);test_scenario::return_shared(r);end(f)
}
#[test,expected_failure(abort_code=10,location=soulidity_application::character)]
fun changed_pack_palette_cannot_claim_original_physical_proof(){
 let mut f=setup();let mut r=register_physical(&mut f,2);let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,false);let mut s:Soul=sc.take_from_sender_by_id(id);let scope=scope(&a);soul::tune_pack_colors(&mut s,scope,colors(false),0);let mut f=F{sc,maker,a,b,cfg,clock,p};let asset=materialize_visual(&mut f,&mut r,&mut s);physical::deliver(asset);f.sc.return_to_sender(s);test_scenario::return_shared(r);end(f)
}
#[test,expected_failure(abort_code=8,location=soulidity_v1::physical)]
fun raw_root_part_cannot_select_same_named_expansion_physical(){
 let mut f=setup();let mut r=register_physical(&mut f,0);let hash=policy::source_hash(player::source(&player::scoped_selection(&f.p,physical_key(&f)).destroy_some()));let quote=physical::quote(&r,hash,&f.cfg,@0xb,1000);let a=physical::claim_scoped(&mut r,&f.maker,&f.a,&f.p,assembly::root_part(b"accessory"),&f.cfg,player::revision(&f.p),1,0,0,1000,quote,fixtures::h(66),&f.clock,f.sc.ctx());physical::deliver(a);test_scenario::return_shared(r);end(f)
}
#[test]
fun physical_sale_transfers_immutable_visual_capture_and_exact_render(){
 let mut f=setup();let mut r=register_physical(&mut f,0);let plan=bcs::to_bytes(&player::render_plan(&f.p));let asset=claim_visual(&mut f,&mut r,67);let aid=object::id(&asset);let capture_id=object::id(physical::asset_visual(&asset));let committed=physical::snapshot_visual(&physical::snapshot(&asset));f.sc.next_tx(@0xa);let mut admin:soulidity_foundation::economics::Admin=f.sc.take_from_sender();soulidity_foundation::economics::configure(&mut f.cfg,&mut admin,0,1000,250,0,@0xf,false);f.sc.return_to_sender(admin);f.sc.next_tx(@0xb);let listing=physical::list(&r,&f.maker,&f.a,asset,&f.cfg,101,1000,1,0,&f.clock,f.sc.ctx());f.sc.next_tx(@0xc);let mut l:physical::Listing<USD> = f.sc.take_shared_by_id(listing);let hash=physical::listing_hash(&l);let quote=physical::sale_quote_hash(&l,&f.cfg,@0xc);let ticket=test_scenario::receiving_ticket_by_id<Asset>(aid);let payment=coin::mint_for_testing<USD>(101,f.sc.ctx());{let F{sc,maker,a,b:_,cfg,clock,p:_}=&mut f;physical::buy_pack(&mut l,&mut r,maker,a,ticket,cfg,payment,0,hash,quote,1,fixtures::h(68),clock,sc.ctx())};test_scenario::return_shared(l);f.sc.next_tx(@0xc);let asset:Asset=f.sc.take_from_sender_by_id(aid);assert!(physical::asset_epoch(&asset)==1 && object::id(physical::asset_visual(&asset))==capture_id && physical::snapshot_visual(&physical::snapshot(&asset))==committed && bcs::to_bytes(&visual_capture::render_plan(physical::asset_visual(&asset),f.sc.ctx()))==plan,0);physical::consume(&mut r,asset,1,f.sc.ctx());test_scenario::return_shared(r);f.sc.next_tx(@0xb);end(f)
}

#[test]
fun post_mint_fresh_reference_keeps_original_output_and_exact_receipt(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(0);let mut s:Soul=sc.take_from_sender_by_id(id);let artifact=object::id(soul::original_output(&s));let original=output::original_recipe_hash(soul::original_output(&s));let old=soul::semantic_recipe_hash(&s);
 expect_no_items(buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",70));
 let src=catalog::preview_source(&a,1,policy::definition_hash(&definition(&scene(true),b"pack-style",0)));assert!(soul::reference_count(&s)==1 && *soul::reference_source(&s,0)==src && soul::bound_count(&s)==0 && soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some()).is_none() && sc.ids_for_sender<Item>().is_empty(),1);
 let r=soul::enhancement_receipt(&s,object::id(&a),@0xb,fixtures::h(70)).destroy_some();assert!(soul::enhancement_count(&s)==1 && soul::enhancement_product(&r)==object::id(&a) && soul::enhancement_version(&r)==1 && soul::enhancement_actor(&r)==@0xb && soul::enhancement_before_revision(&r)==0 && soul::enhancement_after_revision(&r)==1 && soul::enhancement_before_recipe(&r)==old && soul::enhancement_after_recipe(&r)==soul::semantic_recipe_hash(&s) && soul::enhancement_choices(&r).length()==32 && soulidity_foundation::economics::primary_receipt_subject(&soul::enhancement_payment(&r))==id,2);
 assert!(object::id(soul::original_output(&s))==artifact && output::original_recipe_hash(soul::original_output(&s))==original && catalog::wallet_completes(&a,1,@0xb)==1 && catalog::receipt(&a,@0xb,2,fixtures::h(70))==option::some(id),3);soul::clear_reference_scoped(&mut s,key(&a),1);soul::remount_reference_scoped(&mut s,0,key(&a),fixtures::layout(),2);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun post_mint_fresh_bound_replacement_retains_both_permanent_styles(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(1);let mut s:Soul=sc.take_from_sender_by_id(id);expect_no_items(buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",71));let original=*soul::bound_source(&s,0);expect_no_items(buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"alt-style",72));
 assert!(soul::bound_count(&s)==2 && *soul::bound_source(&s,0)==original && policy::source_definition_hash(soul::binding_source(&soul::binding_scoped(&s,key(&a)).destroy_some()))==policy::definition_hash(&definition(&scene(true),b"alt-style",1)) && soul::enhancement_count(&s)==2 && sc.ids_for_sender<Item>().is_empty(),2);soul::unmount_bound_scoped(&mut s,key(&a),2);soul::remount_bound_scoped(&mut s,0,key(&a),fixtures::layout(),3);assert!(*soul::binding_source(&soul::binding_scoped(&s,key(&a)).destroy_some())==original,3);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun post_mint_fresh_free_replacement_returns_original_object(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);expect_no_items(buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",73));let old=soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some()).destroy_some();let items=buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"alt-style",74);assert!(items.length()==1 && object::id(&items[0])==old && soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some())!=option::some(old) && soul::bound_count(&s)==0 && soul::reference_count(&s)==0,1);items.do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);sc.next_tx(@0xb);let it:Item=sc.take_from_sender_by_id(old);assert!(policy::source_definition_hash(soulidity_model::components::source(&it))==policy::definition_hash(&definition(&scene(true),b"pack-style",2)),2);sc.return_to_sender(it);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test,expected_failure(abort_code=11,location=soulidity_application::character)]
fun post_mint_cannot_repurchase_permanent_bound_source(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(1);let mut s:Soul=sc.take_from_sender_by_id(id);buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",75).do!(|it|transfer::public_transfer(it,@0xb));buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",76).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=11,location=soulidity_application::character)]
fun post_mint_cannot_repurchase_unmounted_reference(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(0);let mut s:Soul=sc.take_from_sender_by_id(id);buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",77).do!(|it|transfer::public_transfer(it,@0xb));soul::clear_reference_scoped(&mut s,key(&a),1);buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",78).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=7,location=soulidity_v1::issuer)]
fun post_mint_two_styles_in_one_part_are_rejected(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);let one=issuer::purchase(policy::definition_hash(&definition(&scene(true),b"pack-style",2)),key(&a),fixtures::layout());let two=issuer::purchase(policy::definition_hash(&definition(&scene(true),b"alt-style",2)),key(&a),fixtures::layout());let hash=catalog::policy_hash(catalog::published(&a,1));issuer::enhance_pack_for_testing(&mut s,&mut a,&maker,&mut cfg,1,0,hash,vector[one,two],fixtures::h(79),0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx()).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=7,location=soulidity_v1::issuer)]
fun post_mint_empty_purchase_cannot_consume_product_quota(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);let hash=catalog::policy_hash(catalog::published(&a,1));issuer::enhance_pack_for_testing(&mut s,&mut a,&maker,&mut cfg,1,0,hash,vector[],fixtures::h(80),0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx()).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
fun expect_no_items(items:vector<Item>){items.destroy_empty()}
fun paid_enhancement():(Scenario,Product<USD>,Product<USD>,Product<USD>,Config<USD>,Clock,Player,ID){
 let(mut sc,maker,mut a,b,cfg,clock,p,id)=fresh_enhancement(2);sc.next_tx(@0xa);let mut cap=pub_fixture::control(&sc,object::id(&a));let scene=scene(true);let d=definition(&scene,b"pack-style",2);let v=catalog::version(fixtures::h(1),fixtures::h(2),1,15,1,37,0,0,0,@0xd,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"accessory"],vector[],vector[d],vector[],scene);catalog::publish(&mut a,&mut cap,1,catalog::with_pack_key(v,b"pack"));sc.return_to_sender(cap);sc.next_tx(@0xb);(sc,maker,a,b,cfg,clock,p,id)
}
#[test]
fun paid_post_mint_access_and_issuance_preserve_exact_revenue(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=paid_enhancement();let mut s:Soul=sc.take_from_sender_by_id(id);let original=output::original_recipe_hash(soul::original_output(&s));let hash=catalog::policy_hash(catalog::published(&a,2));catalog::buy_access_for_testing(&mut a,&mut cfg,2,hash,0,1000,fixtures::h(81),coin::mint_for_testing<USD>(15,sc.ctx()),&clock,sc.ctx());expect_no_items(buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",82));
 let r=soul::enhancement_receipt(&s,object::id(&a),@0xb,fixtures::h(82)).destroy_some();let pay=soul::enhancement_payment(&r);assert!(soulidity_foundation::economics::primary_receipt_gross(&pay)==37 && soulidity_foundation::economics::primary_receipt_fee(&pay)==3 && soulidity_foundation::economics::primary_receipt_fixed(&pay)==0 && soulidity_foundation::economics::primary_receipt_net(&pay)==34 && soulidity_foundation::revenue::balance(catalog::income(&a))==48 && soulidity_foundation::revenue::balance(soulidity_foundation::economics::income(&cfg))==4,1);
 assert!(output::original_recipe_hash(soul::original_output(&s))==original && catalog::wallet_completes(&a,2,@0xb)==1 && catalog::wallet_completes(&maker,2,@0xb)==1,2);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test,expected_failure(abort_code=4,location=soulidity_maker_manufacturing::maker_catalog)]
fun paid_pack_metadata_admission_does_not_authorize_fresh_issuance(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=paid_enhancement();let mut s:Soul=sc.take_from_sender_by_id(id);soul::admit_pack(&mut s,catalog::assembly_profile(&a,2),0);buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",83).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=3,location=soulidity_v1::issuer)]
fun paid_fresh_issuance_rejects_underpayment(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=paid_enhancement();let mut s:Soul=sc.take_from_sender_by_id(id);let hash=catalog::policy_hash(catalog::published(&a,2));catalog::buy_access_for_testing(&mut a,&mut cfg,2,hash,0,1000,fixtures::h(84),coin::mint_for_testing<USD>(15,sc.ctx()),&clock,sc.ctx());let choice=issuer::purchase(policy::definition_hash(&definition(&scene(true),b"pack-style",2)),key(&a),fixtures::layout());issuer::enhance_pack_for_testing(&mut s,&mut a,&maker,&mut cfg,2,0,hash,vector[choice],fixtures::h(85),0,1000,coin::mint_for_testing<USD>(36,sc.ctx()),&clock,sc.ctx()).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=7,location=soulidity_maker_manufacturing::maker_catalog)]
fun post_mint_attempt_cannot_replay_into_new_free_item(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",86).do!(|it|transfer::public_transfer(it,@0xb));buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"alt-style",86).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun post_mint_fresh_issuance_rejects_stale_soul_revision(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);let hash=catalog::policy_hash(catalog::published(&a,1));let choice=issuer::purchase(policy::definition_hash(&definition(&scene(true),b"pack-style",2)),key(&a),fixtures::layout());issuer::enhance_pack_for_testing(&mut s,&mut a,&maker,&mut cfg,1,1,hash,vector[choice],fixtures::h(87),0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx()).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=1,location=soulidity_v1::issuer)]
fun post_mint_wrong_product_policy_is_rejected(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);let choice=issuer::purchase(policy::definition_hash(&definition(&scene(true),b"pack-style",2)),key(&a),fixtures::layout());issuer::enhance_pack_for_testing(&mut s,&mut a,&maker,&mut cfg,1,0,fixtures::h(99),vector[choice],fixtures::h(88),0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx()).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test]
fun existing_soul_maker_batch_changes_each_part_once_without_remint(){let(mut sc,mut maker,a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);let output_id=object::id(soul::original_output(&s));let choices=vector[b"bound",b"free"].map!(|part|issuer::purchase(policy::definition_hash(&pub_fixture::def(&pub_fixture::base(),part,b"style",false,false)),assembly::root_part(part),fixtures::layout()));let hash=catalog::policy_hash(catalog::published(&maker,2));let returned=issuer::enhance_maker_for_testing(&mut s,&mut maker,&mut cfg,0,hash,choices,fixtures::h(89),0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx());assert!(returned.is_empty() && soul::revision(&s)==1 && soul::binding(&s,b"bound").is_some() && soul::binding(&s,b"free").is_some() && object::id(soul::original_output(&s))==output_id && catalog::wallet_completes(&maker,2,@0xb)==2 && soul::enhancement_count(&s)==1,0);returned.destroy_empty();sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test]
fun fresh_free_purchase_uses_exact_published_supply_and_returns_every_old_id(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);let d=policy::definition_hash(&definition(&scene(true),b"pack-style",2));let mut old_ids=vector[];let mut i=0;while(i < 10){let items=buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",100+(i as u8));items.do!(|it|{old_ids.push_back(object::id(&it));transfer::public_transfer(it,@0xb)});i=i+1};let current=soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some()).destroy_some();assert!(old_ids.length()==9 && !old_ids.contains(&current) && catalog::issued_count(&a,1,d)==10 && catalog::wallet_completes(&a,1,@0xb)==10 && soul::enhancement_count(&s)==10,0);sc.return_to_sender(s);sc.next_tx(@0xb);assert!(sc.ids_for_sender<Item>().length()==9,1);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=6,location=soulidity_maker_manufacturing::maker_catalog)]
fun post_mint_fresh_free_cannot_exceed_published_supply(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);let mut i=0;while(i < 11){buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",110+(i as u8)).do!(|it|transfer::public_transfer(it,@0xb));i=i+1};sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}
#[test]
fun post_mint_bound_inventory_and_receipt_follow_actual_whole_sale(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(1);let mut s:Soul=sc.take_from_sender_by_id(id);expect_no_items(buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",90));let receipt=soul::enhancement_receipt(&s,object::id(&a),@0xb,fixtures::h(90));let tid=soul::enhancement_table(&s);let source=*soul::bound_source(&s,0);soul::unmount_bound_scoped(&mut s,key(&a),1);sc.next_tx(@0xa);let mut admin:soulidity_foundation::economics::Admin=sc.take_from_sender();soulidity_foundation::economics::configure(&mut cfg,&mut admin,0,1000,250,0,@0xf,false);sc.return_to_sender(admin);sc.next_tx(@0xb);let hash=soul::manifest_hash(&s);let lid=market::list_soul(s,&cfg,101,1000,2,hash,1,&clock,sc.ctx());sc.next_tx(@0xc);let mut listing:Listing<Soul,USD> = sc.take_shared_by_id(lid);let quote=market::soul_quote_hash(&listing,&cfg,@0xc);market::buy_soul(&mut listing,&mut cfg,0,hash,quote,1,fixtures::h(91),coin::mint_for_testing<USD>(101,sc.ctx()),&clock,sc.ctx());test_scenario::return_shared(listing);sc.next_tx(@0xc);let mut s:Soul=sc.take_from_sender_by_id(id);assert!(soul::enhancement_table(&s)==tid && soul::enhancement_receipt(&s,object::id(&a),@0xb,fixtures::h(90))==receipt && *soul::bound_source(&s,0)==source && soul::generation(&s)==1,0);let rev=soul::revision(&s);soul::remount_bound_scoped(&mut s,0,key(&a),fixtures::layout(),rev);assert!(*soul::binding_source(&soul::binding_scoped(&s,key(&a)).destroy_some())==source,1);sc.return_to_sender(s);sc.next_tx(@0xb);end(F{sc,maker,a,b,cfg,clock,p})}
#[test,expected_failure(abort_code=2,location=soulidity_model::policy)]
fun post_mint_layout_outside_creator_bounds_is_rejected(){let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);let hash=catalog::policy_hash(catalog::published(&a,1));let choice=issuer::purchase(policy::definition_hash(&definition(&scene(true),b"pack-style",2)),key(&a),policy::layout(false,10001,false,0,1000000,0,vector[]));issuer::enhance_pack_for_testing(&mut s,&mut a,&maker,&mut cfg,1,0,hash,vector[choice],fixtures::h(92),0,1000,coin::zero<USD>(sc.ctx()),&clock,sc.ctx()).do!(|it|transfer::public_transfer(it,@0xb));sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})}

fun variant_pose(original:&Scene,pack:bool):Scene{
    let mut anchors=vector[visual::anchor(b"root",vector[],visual::signed(false,42000),visual::signed(true,10000))];
    if(pack)anchors.push_back(visual::anchor(b"pack-root",vector[],visual::signed(false,10000),z()));
    visual::scene(512,768,z(),z(),0,visual::renderer(original),b"adult",b"sitting",visual::parts(original),*visual::tracks(original),*visual::channels(original),anchors,*visual::rules(original))
}
fun native_pose(p:&Product<USD>,c:&Control,s:&Soul,part:PartKey,pack:bool):assembly::Variant{
    let version=catalog::current_version(p);let scene=variant_pose(catalog::scene(catalog::published(p,version)),pack);let b=soul::binding_scoped(s,part).destroy_some();let source=soul::binding_source(&b);
    let mapping=visual::mapping(policy::source_representation(source),&scene,vector[visual::fragment_map(0,if(pack)b"glow" else b"back",if(pack)b"pack-root" else b"root",policy::visual_transform(&fixtures::layout()),option::some(if(pack)b"metal" else b"fabric"),option::some(if(pack)b"gold" else b"red"))]);
    catalog::visual_variant(p,c,version,scene,vector[policy::adapter(source,&scene,assembly::part_name(&part),mapping,*policy::source_bounds(source))])
}
fun native_poses(sc:&Scenario,m:&Product<USD>,a:&Product<USD>,b:&Product<USD>,s:&Soul):vector<assembly::Variant>{
    let mut variants=vector[];
    // Creator-owned controls are fixture inputs only; production authority is
    // separately checked by actual Sui owned-input transactions.
    test_scenario::ids_for_address<Control>(@0xa).do!(|id|{
        let c:Control=sc.take_from_address_by_id(@0xa,id);let p=catalog::control_product(&c);
        if(p==object::id(m))variants.push_back(native_pose(m,&c,s,assembly::root_part(b"ref"),false))
        else if(p==object::id(a))variants.push_back(native_pose(a,&c,s,key(a),true))
        else if(p==object::id(b))variants.push_back(native_pose(b,&c,s,key(b),true));
        test_scenario::return_to_address(@0xa,c)
    });assert!(variants.length()==3,0);variants
}
#[test]
fun cross_scene_form_keeps_two_same_name_pack_scopes_palettes_and_original_assets(){
    let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let sa=scope(&f.a);player::set_pack_colors(&mut f.p,sa,colors(true),3,f.sc.ctx());
    let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);let ia=soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some());let ib=soul::free_id(&soul::binding_scoped(&s,key(&b)).destroy_some());let artifact=object::id(soul::original_output(&s));let genesis=soul::genesis_commitment(&s);
    let variants=native_poses(&sc,&maker,&a,&b,&s);let commitments=assembly::variant_commitments(&variants);
    let slots=soul::capture_slots(&s);let colors=soul::colors(&s);let profiles=soul::profile_snapshots(&s);let recipe=soul::recipe_hash(&s);
    soul::apply_variant_loadout(&mut s,variants,slots,vector[],colors,profiles,0,recipe,sc.ctx()).destroy_empty();
    let layers=soul::render_plan(&s);let glow=layers.filter!(|l|visual::track_key(visual::layer_track(l))==b"glow");
    assert!(layers.length()==3 && glow.length()==2 && glow.any!(|l|visual::swatch_key(&visual::layer_color(l).destroy_some())==b"silver") && glow.any!(|l|visual::swatch_key(&visual::layer_color(l).destroy_some())==b"gold"),0);
    let root=standard::revision(&s);let adult=forms::save(&mut s,b"adult",option::none(),0,0,root,1,sc.ctx());
    let slots=soul::capture_slots(&s);let colors=soul::colors(&s);let profiles=soul::profile_snapshots(&s);let recipe=soul::recipe_hash(&s);
    soul::apply_variant_loadout(&mut s,vector[],slots,vector[],colors,profiles,1,recipe,sc.ctx()).destroy_empty();
    let root=standard::revision(&s);let recipe=soul::recipe_hash(&s);forms::activate(&mut s,adult,vector[],1,root,2,recipe,sc.ctx()).destroy_empty();
    assert!(soul::render_plan(&s)==layers && soul::visual_variant_commitments(&s)==commitments && forms::active_is_current(&s),1);
    assert!(soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some())==ia && soul::free_id(&soul::binding_scoped(&s,key(&b)).destroy_some())==ib && soul::parts(&s).length()==5 && object::id(&s)==id,2);
    assert!(object::id(soul::original_output(&s))==artifact && soul::genesis_commitment(&s)==genesis && sc.ids_for_sender<Item>().is_empty(),3);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun active_same_name_second_pack_cannot_use_first_pack_mapping(){
    let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);
    let variants=native_poses(&sc,&maker,&a,&b,&s).filter!(|v|assembly::scope_product(&assembly::variant_scope(v))!=object::id(&b));
    let slots=soul::capture_slots(&s);let colors=soul::colors(&s);let profiles=soul::profile_snapshots(&s);let recipe=soul::recipe_hash(&s);
    soul::apply_variant_loadout(&mut s,variants,slots,vector[],colors,profiles,0,recipe,sc.ctx()).destroy_empty();sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}

// Default-budget increment: compare exact old full-Manifest algorithm at runtime.
#[test]
fun recipe_commitment_oracle_root_reference(){
 let(mut sc,maker,a,b,cfg,clock,p,id)=fresh_enhancement(0);let s:Soul=sc.take_from_sender_by_id(id);
 soul::assert_recipe_commitment_oracle_for_testing(&s);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun recipe_commitment_oracle_pack_reference_and_inactive_profile(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(0);let mut s:Soul=sc.take_from_sender_by_id(id);
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",200).do!(|it|transfer::public_transfer(it,@0xb));
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 let rev=soul::revision(&s);soul::admit_pack(&mut s,catalog::assembly_profile(&b,1),rev);
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun recipe_commitment_oracle_pack_bound_and_inactive_profile(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(1);let mut s:Soul=sc.take_from_sender_by_id(id);
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",200).do!(|it|transfer::public_transfer(it,@0xb));
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 let rev=soul::revision(&s);soul::admit_pack(&mut s,catalog::assembly_profile(&b,1),rev);
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun recipe_commitment_oracle_pack_free_and_inactive_profile(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",200).do!(|it|transfer::public_transfer(it,@0xb));
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 let rev=soul::revision(&s);soul::admit_pack(&mut s,catalog::assembly_profile(&b,1),rev);
 soul::assert_recipe_commitment_oracle_for_testing(&s);
 sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun recipe_commitment_oracle_variants_and_restored_forms(){
    let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let sa=scope(&f.a);player::set_pack_colors(&mut f.p,sa,colors(true),3,f.sc.ctx());
    let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);let ia=soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some());let ib=soul::free_id(&soul::binding_scoped(&s,key(&b)).destroy_some());let artifact=object::id(soul::original_output(&s));let genesis=soul::genesis_commitment(&s);
    soul::assert_recipe_commitment_oracle_for_testing(&s);let variants=native_poses(&sc,&maker,&a,&b,&s);let commitments=assembly::variant_commitments(&variants);
    let slots=soul::capture_slots(&s);let colors=soul::colors(&s);let profiles=soul::profile_snapshots(&s);let recipe=soul::recipe_hash(&s);
    soul::apply_variant_loadout(&mut s,variants,slots,vector[],colors,profiles,0,recipe,sc.ctx()).destroy_empty();
    soul::assert_recipe_commitment_oracle_for_testing(&s);let layers=soul::render_plan(&s);let glow=layers.filter!(|l|visual::track_key(visual::layer_track(l))==b"glow");
    assert!(layers.length()==3 && glow.length()==2 && glow.any!(|l|visual::swatch_key(&visual::layer_color(l).destroy_some())==b"silver") && glow.any!(|l|visual::swatch_key(&visual::layer_color(l).destroy_some())==b"gold"),0);
    let root=standard::revision(&s);let adult=forms::save(&mut s,b"adult",option::none(),0,0,root,1,sc.ctx());
    let slots=soul::capture_slots(&s);let colors=soul::colors(&s);let profiles=soul::profile_snapshots(&s);let recipe=soul::recipe_hash(&s);
    soul::apply_variant_loadout(&mut s,vector[],slots,vector[],colors,profiles,1,recipe,sc.ctx()).destroy_empty();
    let root=standard::revision(&s);let recipe=soul::recipe_hash(&s);forms::activate(&mut s,adult,vector[],1,root,2,recipe,sc.ctx()).destroy_empty();
    soul::assert_recipe_commitment_oracle_for_testing(&s);assert!(soul::render_plan(&s)==layers && soul::visual_variant_commitments(&s)==commitments && forms::active_is_current(&s),1);
    assert!(soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some())==ia && soul::free_id(&soul::binding_scoped(&s,key(&b)).destroy_some())==ib && soul::parts(&s).length()==5 && object::id(&s)==id,2);
    assert!(object::id(soul::original_output(&s))==artifact && soul::genesis_commitment(&s)==genesis && sc.ids_for_sender<Item>().is_empty(),3);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
