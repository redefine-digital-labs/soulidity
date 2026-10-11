#[test_only]
module soulidity_v1::pack_application_manifest_read_oracle_tests;
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
 let version=catalog::current_version(pack);let mut definition=option::none();catalog::definitions_ref(catalog::published(pack,version)).do_ref!(|d|{if(visual::selector_style(&policy::definition_path(d))==option::some(style))definition=option::some(policy::definition_hash(d));});let definition=definition.destroy_some();
 buy_definition(sc,s,maker,pack,cfg,clock,definition,attempt)
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























fun publish_adapter(f:&mut F){
 f.sc.next_tx(@0xa);let mut cap=pub_fixture::control(&f.sc,object::id(&f.b));let scene=scene(false);let source=catalog::preview_source(&f.a,1,policy::definition_hash(&definition(&scene(true),b"pack-style",2)));let t=visual::transform(z(),z(),1000000,z());let mapping=visual::mapping(policy::source_representation(&source),&scene,vector[visual::fragment_map(0,b"front",b"root",t,option::some(b"fabric"),option::some(b"blue"))]);let adapter=policy::adapter(&source,&scene,b"accessory",mapping,policy::bounds(0,0,1000000,1000000,0,vector[]));let d=definition(&scene,b"pack-style",2);let v=catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xd,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"accessory"],vector[],vector[d],vector[adapter],scene);catalog::publish(&mut f.b,&mut cap,1,catalog::with_pack_key(v,b"pack"));f.sc.return_to_sender(cap);f.sc.next_tx(@0xb);
}



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



fun materialize_visual(f:&mut F,r:&mut Registry<USD>,s:&mut Soul):Asset{
 let target=physical_key(f);let source=*soul::binding_source(&soul::binding_scoped(s,target).destroy_some());let key=policy::source_hash(&source);let quote=physical::quote(r,key,&f.cfg,@0xb,1000);let sr=soul::revision(s);let rr=physical::revision(r);let issued=physical::issued(physical::rule(r,key));physical::materialize_scoped(r,&f.maker,&f.a,s,target,b"print-expanded",&f.cfg,sr,rr,issued,0,1000,quote,fixtures::h(65),&f.clock,f.sc.ctx())
}












fun expect_no_items(items:vector<Item>){items.destroy_empty()}
fun paid_enhancement():(Scenario,Product<USD>,Product<USD>,Product<USD>,Config<USD>,Clock,Player,ID){
 let(mut sc,maker,mut a,b,cfg,clock,p,id)=fresh_enhancement(2);sc.next_tx(@0xa);let mut cap=pub_fixture::control(&sc,object::id(&a));let scene=scene(true);let d=definition(&scene,b"pack-style",2);let v=catalog::version(fixtures::h(1),fixtures::h(2),1,15,1,37,0,0,0,@0xd,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"accessory"],vector[],vector[d],vector[],scene);catalog::publish(&mut a,&mut cap,1,catalog::with_pack_key(v,b"pack"));sc.return_to_sender(cap);sc.next_tx(@0xb);(sc,maker,a,b,cfg,clock,p,id)
}












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



// Default-budget increment: compare exact old full-Manifest algorithm at runtime.

#[test]
fun application_manifest_read_oracle_pack_reference_and_inactive_profile(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(0);let mut s:Soul=sc.take_from_sender_by_id(id);
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",200).do!(|it|transfer::public_transfer(it,@0xb));
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 let rev=soul::revision(&s);soul::admit_pack(&mut s,catalog::assembly_profile(&b,1),rev);
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 let revision=soul::revision(&s);soul::set_state_config(&mut s,&cfg,std::string::utf8(b"oracle-read"),b"actual",revision,sc.ctx());soul::assert_application_manifest_read_oracle_for_testing(&s);
 sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun application_manifest_read_oracle_pack_bound_and_inactive_profile(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(1);let mut s:Soul=sc.take_from_sender_by_id(id);
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",200).do!(|it|transfer::public_transfer(it,@0xb));
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 let rev=soul::revision(&s);soul::admit_pack(&mut s,catalog::assembly_profile(&b,1),rev);
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun application_manifest_read_oracle_pack_free_and_inactive_profile(){
 let(mut sc,maker,mut a,b,mut cfg,clock,p,id)=fresh_enhancement(2);let mut s:Soul=sc.take_from_sender_by_id(id);
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 buy_choice(&mut sc,&mut s,&maker,&mut a,&mut cfg,&clock,b"pack-style",200).do!(|it|transfer::public_transfer(it,@0xb));
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 let rev=soul::revision(&s);soul::admit_pack(&mut s,catalog::assembly_profile(&b,1),rev);
 soul::assert_application_manifest_read_oracle_for_testing(&s);
 sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
#[test]
fun application_manifest_read_oracle_variants_and_restored_forms(){
    let mut f=setup();select(&mut f,true,b"pack-style");select(&mut f,false,b"pack-style");let sa=scope(&f.a);player::set_pack_colors(&mut f.p,sa,colors(true),3,f.sc.ctx());
    let(mut sc,maker,a,b,cfg,clock,p,id)=mint(f,true);let mut s:Soul=sc.take_from_sender_by_id(id);let ia=soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some());let ib=soul::free_id(&soul::binding_scoped(&s,key(&b)).destroy_some());let artifact=object::id(soul::original_output(&s));let genesis=soul::genesis_commitment(&s);
    soul::assert_application_manifest_read_oracle_for_testing(&s);let variants=native_poses(&sc,&maker,&a,&b,&s);let commitments=assembly::variant_commitments(&variants);
    let slots=soul::capture_slots(&s);let colors=soul::colors(&s);let profiles=soul::profile_snapshots(&s);let recipe=soul::recipe_hash(&s);
    soul::apply_variant_loadout(&mut s,variants,slots,vector[],colors,profiles,0,recipe,sc.ctx()).destroy_empty();
    soul::assert_application_manifest_read_oracle_for_testing(&s);let layers=soul::render_plan(&s);let glow=layers.filter!(|l|visual::track_key(visual::layer_track(l))==b"glow");
    assert!(layers.length()==3 && glow.length()==2 && glow.any!(|l|visual::swatch_key(&visual::layer_color(l).destroy_some())==b"silver") && glow.any!(|l|visual::swatch_key(&visual::layer_color(l).destroy_some())==b"gold"),0);
    let root=standard::revision(&s);let adult=forms::save(&mut s,b"adult",option::none(),0,0,root,1,sc.ctx());
    let slots=soul::capture_slots(&s);let colors=soul::colors(&s);let profiles=soul::profile_snapshots(&s);let recipe=soul::recipe_hash(&s);
    soul::apply_variant_loadout(&mut s,vector[],slots,vector[],colors,profiles,1,recipe,sc.ctx()).destroy_empty();
    let root=standard::revision(&s);let recipe=soul::recipe_hash(&s);forms::activate(&mut s,adult,vector[],1,root,2,recipe,sc.ctx()).destroy_empty();
    soul::assert_application_manifest_read_oracle_for_testing(&s);assert!(soul::render_plan(&s)==layers && soul::visual_variant_commitments(&s)==commitments && forms::active_is_current(&s),1);
    assert!(soul::free_id(&soul::binding_scoped(&s,key(&a)).destroy_some())==ia && soul::free_id(&soul::binding_scoped(&s,key(&b)).destroy_some())==ib && soul::parts(&s).length()==5 && object::id(&s)==id,2);
    assert!(object::id(soul::original_output(&s))==artifact && soul::genesis_commitment(&s)==genesis && sc.ids_for_sender<Item>().is_empty(),3);sc.return_to_sender(s);end(F{sc,maker,a,b,cfg,clock,p})
}
