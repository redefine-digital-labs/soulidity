#[test_only]
module soulidity_v1::scene_variant_tests;
use std::bcs;
use sui::test_scenario::{Self,Scenario};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_visual::visual::{Self,Scene};
use soulidity_model::assembly::{Self,State,Variant,Equipped};
use soulidity_model::policy::{Self,Source,Adapter};
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::character;
use walrus::system::System;
fun z():visual::Signed{visual::signed(false,0)}
fun target(mode:u8):Scene{
    let original=fixtures::scene();
    let parts=if(mode==1)vector[b"bound",b"ref",b"free"] else visual::parts(&original);
    let channels=if(mode==2)vector[visual::channel(b"new",b"red",true,vector[visual::swatch(b"red",1,vector[])])] else *visual::channels(&original);
    let rules=if(mode==3)vector[visual::rule(b"changed",0,visual::selector(option::none(),option::none(),b"free",option::none(),option::none()),false,vector[visual::selector(option::none(),option::none(),b"ref",option::none(),option::none())])] else *visual::rules(&original);
    visual::scene(512,768,z(),z(),if(mode==4)1 else 0,if(mode==5)fixtures::h(15) else visual::renderer(&original),b"adult",b"sitting",parts,*visual::tracks(&original),channels,vector[visual::anchor(b"root",vector[],visual::signed(false,42000),visual::signed(true,10000))],rules)
}
fun adapter(source:&Source,scene:&Scene):Adapter{
    let maps=visual::fragments(policy::source_representation(source)).map_ref!(|_|visual::fragment_map(0,b"main",b"root",policy::visual_transform(&fixtures::layout()),option::none(),option::none()));
    let mapping=visual::mapping(policy::source_representation(source),scene,maps);
    policy::adapter(source,scene,policy::part(source),mapping,*policy::source_bounds(source))
}
fun setup():(Scenario,Product<USD>,Control,Soul,System,State,vector<Equipped>){
    let mut sc=fixtures::setup(0,0,0,0,0,0);let id=fixtures::mint(&mut sc,21,0);sc.next_tx(@0xa);
    let p:Product<USD> = sc.take_shared();let c:Control=sc.take_from_sender();
    let s:Soul=sc.take_from_address_by_id(@0xb,id);let sys:System=sc.take_shared();
    let state=assembly::new(&catalog::assembly_profile(&p,1),sc.ctx());
    let equipped=character::parts(&s).map_ref!(|part|{let b=character::binding_scoped(&s,*part).destroy_some();assembly::equipped(*part,*character::binding_source(&b),character::binding_layout(&b))});(sc,p,c,s,sys,state,equipped)
}
fun v(p:&Product<USD>,c:&Control,equipped:&vector<Equipped>,mode:u8):Variant{
    let scene=target(mode);let adapters=equipped.map_ref!(|e|adapter(assembly::equipped_source(e),&scene));catalog::visual_variant(p,c,1,scene,adapters)
}
fun end(sc:Scenario,p:Product<USD>,c:Control,s:Soul,sys:System,state:State){
    assembly::destroy(state);test_scenario::return_shared(p);sc.return_to_sender(c);test_scenario::return_to_address(@0xb,s);test_scenario::return_shared(sys);sc.end();
}
#[test]
fun creator_projection_preserves_original_soul_all_three_rights_and_assets(){
    let(sc,p,c,s,sys,state,e)=setup();let before=bcs::to_bytes(&s);let id=object::id(&s);let original=character::recipe_hash(&s);
    let free=character::free_id(&character::binding(&s,b"free").destroy_some());let artifact=object::id(character::original_output(&s));
    let variant=v(&p,&c,&e,0);let layers=assembly::render_variants(&state,&fixtures::scene(),&vector[],&e,&vector[variant]);
    assert!(layers.length()==3 && assembly::variant_scope(&variant)==assembly::profile_scope(&catalog::assembly_profile(&p,1)),0);
    let(x,y)=visual::anchor_position(visual::layer_anchor(&layers[0]));let(nx,mx)=visual::signed_parts(&x);let(ny,my)=visual::signed_parts(&y);assert!(!nx && mx==42000 && ny && my==10000,1);
    assert!(assembly::variant_scene_hash(&variant)==visual::scene_hash(&target(0)) && assembly::variant_hash(&variant).length()==32,2);
    assert!(e.map_ref!(|x|policy::rights(assembly::equipped_source(x)))==vector[0u8,1,2],3);
    assert!(object::id(&s)==id && bcs::to_bytes(&s)==before && character::recipe_hash(&s)==original && character::free_id(&character::binding(&s,b"free").destroy_some())==free && object::id(character::original_output(&s))==artifact,4);
    assert!(character::bound_count(&s)==1 && character::reference_count(&s)==1 && standard::module_count(&s)==1,5);
    let originals=assembly::render(&state,&fixtures::scene(),&vector[],&e);
    layers.do_ref!(|l|assert!(originals.any!(|o|*visual::layer_fragment(o)==*visual::layer_fragment(l)),6));end(sc,p,c,s,sys,state)
}
#[test]
fun empty_variant_set_is_exact_old_render(){let(sc,p,c,s,sys,state,e)=setup();assert!(assembly::render_variants(&state,&fixtures::scene(),&vector[],&e,&vector[])==assembly::render(&state,&fixtures::scene(),&vector[],&e),0);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun missing_fixed_style_mapping_rejects_projection(){let(sc,p,c,s,sys,state,e)=setup();let variant=catalog::visual_variant(&p,&c,1,target(0),vector[]);let _=assembly::render_variants(&state,&fixtures::scene(),&vector[],&e,&vector[variant]);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_model::assembly)]
fun duplicate_preset_scope_is_ambiguous(){let(sc,p,c,s,sys,state,e)=setup();let variant=v(&p,&c,&e,0);let _=assembly::render_variants(&state,&fixtures::scene(),&vector[],&e,&vector[variant,variant]);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_model::assembly)]
fun duplicate_source_mapping_rejected(){let(sc,p,c,s,sys,state,e)=setup();let target=target(0);let a=adapter(assembly::equipped_source(&e[0]),&target);let _=catalog::visual_variant(&p,&c,1,target,vector[a,a]);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=5,location=soulidity_model::assembly)]
fun mapping_for_another_target_scene_rejected(){let(sc,p,c,s,sys,state,e)=setup();let a=adapter(assembly::equipped_source(&e[0]),&fixtures::scene());let _=catalog::visual_variant(&p,&c,1,target(0),vector[a]);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun variant_cannot_reorder_parts(){let(sc,p,c,s,sys,state,e)=setup();let _=v(&p,&c,&e,1);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun variant_cannot_change_smart_color_contract(){let(sc,p,c,s,sys,state,e)=setup();let _=v(&p,&c,&e,2);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun variant_cannot_change_published_rules(){let(sc,p,c,s,sys,state,e)=setup();let _=v(&p,&c,&e,3);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun variant_cannot_change_sampling(){let(sc,p,c,s,sys,state,e)=setup();let _=v(&p,&c,&e,4);end(sc,p,c,s,sys,state)}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun variant_cannot_change_renderer(){let(sc,p,c,s,sys,state,e)=setup();let _=v(&p,&c,&e,5);end(sc,p,c,s,sys,state)}
#[test]
fun control_transfer_new_holder_can_approve_same_publication_variant(){
    let(mut sc,p,c,s,sys,state,e)=setup();let pid=object::id(&p);let cid=object::id(&c);transfer::public_transfer(c,@0xc);test_scenario::return_shared(p);sc.next_tx(@0xc);
    let p:Product<USD> = sc.take_shared_by_id(pid);let c:Control=sc.take_from_sender_by_id(cid);let variant=v(&p,&c,&e,0);assert!(assembly::scope_product(&assembly::variant_scope(&variant))==pid,0);end(sc,p,c,s,sys,state)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_manufacturing::maker_catalog)]
fun another_product_control_cannot_approve_original_maker_variant(){
    let(mut sc,p,c,s,sys,state,e)=setup();let cfg:soulidity_foundation::economics::Config<USD> = sc.take_shared();let other=catalog::create_maker(&cfg,0,sc.ctx());test_scenario::return_shared(cfg);sc.return_to_sender(c);sc.next_tx(@0xa);
    let ids=sc.ids_for_sender<Control>();let mut wrong=option::none();ids.do!(|id|{let c:Control=sc.take_from_sender_by_id(id);if(catalog::control_product(&c)==other)wrong.fill(c) else sc.return_to_sender(c)});
    let wrong=wrong.destroy_some();let _=v(&p,&wrong,&e,0);sc.return_to_sender(wrong);test_scenario::return_shared(p);test_scenario::return_to_address(@0xb,s);test_scenario::return_shared(sys);assembly::destroy(state);sc.end();
}

fun pack_pose(original:&Scene,pack:bool):Scene{
    let mut anchors=vector[visual::anchor(b"root",vector[],visual::signed(false,42000),visual::signed(true,10000))];
    if(pack)anchors.push_back(visual::anchor(b"pack-root",vector[],visual::signed(false,10000),z()));
    visual::scene(512,768,z(),z(),0,visual::renderer(original),b"adult",b"sitting",visual::parts(original),*visual::tracks(original),*visual::channels(original),anchors,*visual::rules(original))
}
fun pack_setup():(Scenario,Product<USD>,Product<USD>,Control,Control,State,vector<Equipped>){
    use soulidity_v1::pack_publication_tests as f;
    let(mut sc,mid,pid,_)=f::setup();let mut p:Product<USD> = sc.take_shared_by_id(pid);
    // Take both controls in one inventory pass: Scenario IDs include objects
    // already taken in the current transaction and must not be taken twice.
    let mut maker_control=option::none();let mut pack_control=option::none();
    sc.ids_for_sender<Control>().do!(|id|{let control:Control=sc.take_from_sender_by_id(id);if(catalog::control_product(&control)==mid)maker_control.fill(control) else if(catalog::control_product(&control)==pid)pack_control.fill(control) else sc.return_to_sender(control)});
    let mc=maker_control.destroy_some();let mut c=pack_control.destroy_some();
    let base=f::base();let mut parts=visual::parts(&base);parts.push_back(b"accessory");let mut channels=*visual::channels(&base);channels.push_back(visual::channel(b"metal",b"gold",true,vector[visual::swatch(b"gold",3,vector[])]));
    let scene=visual::scene(1024,1024,z(),z(),0,visual::renderer(&base),b"body",b"pose",parts,vector[visual::track(b"back",0,false),visual::track(b"glow",1,false),visual::track(b"front",2,true)],channels,vector[visual::anchor(b"root",vector[],z(),z()),visual::anchor(b"pack-root",vector[],z(),z())],*visual::rules(&base));
    let d=f::def(&scene,b"accessory",b"pack-style",true,false);let hash=policy::definition_hash(&d);
    catalog::publish(&mut p,&mut c,0,catalog::with_pack_key(f::draft(scene,vector[b"accessory"],vector[d],vector[]),b"pack"));
    let maker:Product<USD> = sc.take_shared_by_id(mid);let mut state=assembly::new(&catalog::assembly_profile(&maker,2),sc.ctx());assembly::admit(&mut state,&base,catalog::assembly_profile(&p,1));
    let root=catalog::preview_source(&maker,2,policy::definition_hash(&f::def(&base,b"ref",b"style",false,false)));
    let ps=catalog::preview_source(&p,1,hash);let scope=assembly::profile_scope(&catalog::assembly_profile(&p,1));
    let e=vector[assembly::equipped(assembly::root_part(b"ref"),root,fixtures::layout()),assembly::equipped(assembly::scoped_part(scope,b"accessory"),ps,fixtures::layout())];(sc,maker,p,mc,c,state,e)
}
fun pack_variants(m:&Product<USD>,p:&Product<USD>,mc:&Control,pc:&Control,e:&vector<Equipped>):vector<Variant>{
    let base=pack_pose(&soulidity_v1::pack_publication_tests::base(),false);let pack=pack_pose(catalog::scene(catalog::published(p,1)),true);
    let root_source=assembly::equipped_source(&e[0]);let root_mapping=visual::mapping(policy::source_representation(root_source),&base,vector[visual::fragment_map(0,b"back",b"root",policy::visual_transform(&fixtures::layout()),option::some(b"fabric"),option::some(b"red"))]);
    let root=policy::adapter(root_source,&base,b"ref",root_mapping,*policy::source_bounds(root_source));
    let source=assembly::equipped_source(&e[1]);let mapping=visual::mapping(policy::source_representation(source),&pack,vector[visual::fragment_map(0,b"glow",b"pack-root",policy::visual_transform(&fixtures::layout()),option::some(b"metal"),option::some(b"gold"))]);
    let pa=policy::adapter(source,&pack,b"accessory",mapping,*policy::source_bounds(source));
    vector[catalog::visual_variant(m,mc,2,base,vector[root]),catalog::visual_variant(p,pc,1,pack,vector[pa])]
}
fun pack_end(sc:Scenario,m:Product<USD>,p:Product<USD>,mc:Control,pc:Control,state:State){assembly::destroy(state);test_scenario::return_shared(m);test_scenario::return_shared(p);sc.return_to_sender(mc);sc.return_to_sender(pc);sc.end();}
#[test]
fun active_pack_requires_its_own_authorized_compatible_pose_and_keeps_palette_scope(){
    let(sc,m,p,mc,pc,state,e)=pack_setup();let vars=pack_variants(&m,&p,&mc,&pc,&e);
    let ls=assembly::render_variants(&state,&soulidity_v1::pack_publication_tests::base(),&visual::default_colors(&soulidity_v1::pack_publication_tests::base()),&e,&vars);
    assert!(ls.length()==2 && visual::swatch_key(&visual::layer_color(&ls[1]).destroy_some())==b"gold",0);
    assert!(assembly::variant_scope(&vars[0])!=assembly::variant_scope(&vars[1]),1);pack_end(sc,m,p,mc,pc,state)
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun active_pack_cannot_silently_render_in_the_previous_canvas(){let(sc,m,p,mc,pc,state,e)=pack_setup();let vars=pack_variants(&m,&p,&mc,&pc,&e);let _=assembly::render_variants(&state,&soulidity_v1::pack_publication_tests::base(),&visual::default_colors(&soulidity_v1::pack_publication_tests::base()),&e,&vector[vars[0]]);pack_end(sc,m,p,mc,pc,state)}
#[test]
#[expected_failure(abort_code=1,location=soulidity_maker_manufacturing::maker_catalog)]
fun maker_control_cannot_sign_a_pack_pose(){let(sc,m,p,mc,pc,state,e)=pack_setup();let _=catalog::visual_variant(&p,&mc,1,pack_pose(catalog::scene(catalog::published(&p,1)),true),vector[]);pack_end(sc,m,p,mc,pc,state)}
#[test]
fun unused_admitted_pack_does_not_require_a_pose_or_invent_inventory(){let(sc,m,p,mc,pc,state,e)=pack_setup();let vars=pack_variants(&m,&p,&mc,&pc,&e);let ls=assembly::render_variants(&state,&soulidity_v1::pack_publication_tests::base(),&visual::default_colors(&soulidity_v1::pack_publication_tests::base()),&vector[e[0]],&vector[vars[0]]);assert!(ls.length()==1,0);pack_end(sc,m,p,mc,pc,state)}

fun apply_pose(sc:&mut Scenario,s:&mut Soul,variants:vector<Variant>){
    let slots=character::capture_slots(s);let colors=character::colors(s);let profiles=character::profile_snapshots(s);let rev=character::revision(s);let recipe=character::recipe_hash(s);
    character::apply_variant_loadout(s,variants,slots,vector[],colors,profiles,rev,recipe,sc.ctx()).destroy_empty()
}
fun save_pose(sc:&mut Scenario,s:&mut Soul,name:vector<u8>):soulidity_application::forms::Reference{
    use soulidity_application::forms;
    let(head,j)=if(forms::installed(s)){let j=forms::journal(s);(forms::latest(j,name),forms::revision(j))}else(0,0);
    let root=standard::revision(s);let app=character::revision(s);forms::save(s,name,option::none(),head,j,root,app,sc.ctx())
}
fun activate_pose(sc:&mut Scenario,s:&mut Soul,r:soulidity_application::forms::Reference,items:vector<soulidity_model::components::Item>){
    use soulidity_application::forms;
    let j=forms::revision(forms::journal(s));let root=standard::revision(s);let app=character::revision(s);let recipe=character::recipe_hash(s);
    forms::activate(s,r,items,j,root,app,recipe,sc.ctx()).destroy_empty()
}
#[test]
fun actual_soul_persists_creator_pose_without_replacing_genesis_or_inventory(){
    let(mut sc,p,c,mut s,sys,state,e)=setup();let root=object::id(&s);let artifact=object::id(character::original_output(&s));let output=character::original_output_commitment(&s);let genesis=character::genesis_commitment(&s);let original_scene=*character::scene(&s);let original_recipe=character::semantic_recipe_hash(&s);let free=character::free_id(&character::binding(&s,b"free").destroy_some());
    let variant=v(&p,&c,&e,0);apply_pose(&mut sc,&mut s,vector[variant]);
    assert!(*character::scene(&s)==target(0) && *character::original_scene(&s)==original_scene && character::visual_variants(&s)==vector[variant],0);
    assert!(character::render_plan(&s)==assembly::render_variants(&state,&original_scene,&vector[],&e,&vector[variant]),1);
    assert!(character::semantic_recipe_hash(&s)!=original_recipe && character::visual_variant_commitments(&s)==vector[assembly::variant_hash(&variant)],2);
    assert!(object::id(&s)==root && object::id(character::original_output(&s))==artifact && character::original_output_commitment(&s)==output && character::genesis_commitment(&s)==genesis,3);
    assert!(character::free_id(&character::binding(&s,b"free").destroy_some())==free && character::bound_count(&s)==1 && character::reference_count(&s)==1,4);
    apply_pose(&mut sc,&mut s,vector[]);assert!(*character::scene(&s)==original_scene && character::semantic_recipe_hash(&s)==original_recipe && character::visual_variants(&s).is_empty(),5);end(sc,p,c,s,sys,state)
}
#[test]
fun immutable_cross_scene_forms_restore_same_items_and_each_exact_mapping(){
    use soulidity_application::forms;
    let(mut sc,p,c,mut s,sys,state,e)=setup();let free=character::free_id(&character::binding(&s,b"free").destroy_some());let root=object::id(&s);let original=save_pose(&mut sc,&mut s,b"child");let old=character::semantic_recipe_hash(&s);
    let variant=v(&p,&c,&e,0);apply_pose(&mut sc,&mut s,vector[variant]);let adult=save_pose(&mut sc,&mut s,b"adult");let rendered=character::render_plan(&s);let adult_recipe=character::semantic_recipe_hash(&s);let snapshot=forms::snapshot(forms::journal(&s),adult);let frozen=bcs::to_bytes(snapshot);let frozen_hash=forms::commitment(snapshot);
    assert!(forms::visual_variants(snapshot)==vector[variant] && forms::visual_variant_commitments(snapshot)==character::visual_variant_commitments(&s),0);
    activate_pose(&mut sc,&mut s,original,vector[]);assert!(character::visual_variants(&s).is_empty() && character::semantic_recipe_hash(&s)==old && *character::scene(&s)==fixtures::scene(),1);
    activate_pose(&mut sc,&mut s,adult,vector[]);assert!(*character::scene(&s)==target(0) && character::render_plan(&s)==rendered && character::semantic_recipe_hash(&s)==adult_recipe && forms::active_is_current(&s),2);
    assert!(object::id(&s)==root && character::free_id(&character::binding(&s,b"free").destroy_some())==free && character::bound_count(&s)==1 && character::reference_count(&s)==1,3);
    let snapshot=forms::snapshot(forms::journal(&s),adult);assert!(bcs::to_bytes(snapshot)==frozen && forms::commitment(snapshot)==frozen_hash && forms::version_count(forms::journal(&s))==2,4);end(sc,p,c,s,sys,state)
}
#[test]
fun detach_and_restore_cross_scene_form_requires_and_reuses_original_wallet_item(){
    let(mut sc,p,c,mut s,sys,state,e)=setup();apply_pose(&mut sc,&mut s,vector[v(&p,&c,&e,0)]);let r=save_pose(&mut sc,&mut s,b"adult");let free=character::free_id(&character::binding(&s,b"free").destroy_some());let rev=character::revision(&s);let it=character::detach(&mut s,b"free",rev);
    let rev=character::revision(&s);character::unmount_bound(&mut s,b"bound",rev);let rev=character::revision(&s);character::clear_reference(&mut s,b"ref",rev);
    activate_pose(&mut sc,&mut s,r,vector[it]);assert!(character::free_id(&character::binding(&s,b"free").destroy_some())==free && character::bound_count(&s)==1 && character::reference_count(&s)==1 && character::render_plan(&s).length()==3,0);end(sc,p,c,s,sys,state)
}
#[test]
#[expected_failure(abort_code=3,location=soulidity_application::character)]
fun cross_scene_snapshot_cannot_regenerate_sold_component(){
    let(mut sc,p,c,mut s,sys,state,e)=setup();apply_pose(&mut sc,&mut s,vector[v(&p,&c,&e,0)]);let r=save_pose(&mut sc,&mut s,b"adult");let rev=character::revision(&s);let it=character::detach(&mut s,b"free",rev);transfer::public_transfer(it,@0xc);activate_pose(&mut sc,&mut s,r,vector[]);end(sc,p,c,s,sys,state)
}
#[test]
fun ordinary_tuning_in_active_pose_keeps_bounds_and_stales_saved_activation(){
    use soulidity_application::forms;
    let(mut sc,p,c,mut s,sys,state,e)=setup();apply_pose(&mut sc,&mut s,vector[v(&p,&c,&e,0)]);let r=save_pose(&mut sc,&mut s,b"adult");activate_pose(&mut sc,&mut s,r,vector[]);let old=character::render_plan(&s);let rev=character::revision(&s);
    character::tune(&mut s,b"free",policy::layout(false,1,false,0,1000000,0,vector[]),rev);assert!(character::render_plan(&s)!=old && !forms::active_is_current(&s) && *character::scene(&s)==target(0),0);
    let rev=character::revision(&s);character::reset_layout(&mut s,b"free",rev);assert!(character::render_plan(&s)==old && forms::active_is_current(&s),1);end(sc,p,c,s,sys,state)
}
#[test]
#[expected_failure(abort_code=2,location=soulidity_model::policy)]
fun active_pose_cannot_expand_original_source_adjustment_bounds(){
    let(mut sc,p,c,mut s,sys,state,e)=setup();apply_pose(&mut sc,&mut s,vector[v(&p,&c,&e,0)]);let rev=character::revision(&s);character::tune(&mut s,b"free",policy::layout(false,11,false,0,1000000,0,vector[]),rev);end(sc,p,c,s,sys,state)
}
#[test]
#[expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun soul_activation_without_required_style_mapping_is_rejected(){
    let(mut sc,p,c,mut s,sys,state,_)=setup();let variant=catalog::visual_variant(&p,&c,1,target(0),vector[]);apply_pose(&mut sc,&mut s,vector[variant]);end(sc,p,c,s,sys,state)
}
#[test]
#[expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_recipe_cannot_install_or_activate_creator_mapping(){
    let(mut sc,p,c,mut s,sys,state,e)=setup();let variant=v(&p,&c,&e,0);let slots=character::capture_slots(&s);let rev=character::revision(&s);character::apply_variant_loadout(&mut s,vector[variant],slots,vector[],vector[],vector[],rev,fixtures::h(255),sc.ctx()).destroy_empty();end(sc,p,c,s,sys,state)
}
#[test]
fun pose_snapshot_and_mapping_follow_soul_handover_and_allow_new_holder_restore(){
    use soulidity_application::forms;
    let(mut sc,p,c,mut s,sys,state,e)=setup();let root=object::id(&s);let free=character::free_id(&character::binding(&s,b"free").destroy_some());apply_pose(&mut sc,&mut s,vector[v(&p,&c,&e,0)]);let r=save_pose(&mut sc,&mut s,b"adult");let recipe=character::recipe_hash(&s);let rev=character::revision(&s);
    character::handover(s,@0xc,rev);test_scenario::return_shared(p);sc.return_to_sender(c);test_scenario::return_shared(sys);assembly::destroy(state);sc.next_tx(@0xc);
    let mut s:Soul=sc.take_from_sender_by_id(root);apply_pose(&mut sc,&mut s,vector[]);activate_pose(&mut sc,&mut s,r,vector[]);
    assert!(character::recipe_hash(&s)==recipe && character::free_id(&character::binding(&s,b"free").destroy_some())==free && forms::active_is_current(&s),0);sc.return_to_sender(s);sc.end();
}
