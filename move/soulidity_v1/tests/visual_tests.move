#[test_only]
module soulidity_v1::visual_tests;
use std::bcs;
use std::string;
use sui::test_scenario::{Self,Scenario};
use sui::clock;
use sui::coin;
use soulidity_v1::fixtures::{Self,USD};
use soulidity_visual::visual::{Self,Scene,Representation,Fragment,Token};
use soulidity_model::policy::{Self,Definition};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_content_kinds::content_kind_registry::KindRegistry;
use soulidity_application::output;
use soulidity_v1::issuer;
use soulidity_maker_manufacturing::maker_player::{Player};
use soulidity_v1::player;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_v1::market;

fun zero():visual::Signed{visual::signed(false,0)}
fun t():visual::Transform{visual::transform(zero(),zero(),1000000,zero())}
fun selected(part:vector<u8>):Token{visual::token(0,option::some(visual::selector(option::none(),option::none(),part,option::none(),option::none())),0)}
fun palette(editable:bool):visual::Channel{visual::channel(b"fabric",b"red",editable,vector[
    visual::swatch(b"red",0xff0000ff,vector[]),visual::swatch(b"blue",0x0000ffff,vector[]),
    visual::swatch(b"gradient",0,vector[visual::stop(0,1),visual::stop(500000,2),visual::stop(500000,3),visual::stop(1000000,4)]),
])}
fun profile(mode:u8):Scene{
    let tracks=vector[visual::track(b"back",0,false),visual::track(if(mode==3)b"back" else b"front",1,true)];
    let anchors=if(mode==4)vector[visual::anchor(b"root",vector[selected(b"ref")],zero(),zero())]
        else vector[visual::anchor(b"root",vector[],zero(),zero())];
    let rules=if(mode==5)vector[visual::rule(b"requires-body",0,visual::selector(option::none(),option::none(),b"free",option::none(),option::none()),false,vector[visual::selector(option::none(),option::none(),b"ref",option::none(),option::none())])] else vector[];
    visual::scene(if(mode==1)512 else if(mode==2)8193 else 1024,1024,zero(),zero(),0,fixtures::h(14),b"body",b"pose",vector[b"ref",b"bound",b"free"],tracks,vector[palette(mode!=6)],anchors,rules)
}
fun f(front:bool,mask:Option<u64>,blend:u8):Fragment{visual::fragment(if(front)b"front-image" else b"back-image",fixtures::h(if(front)12 else 11),b"image/png",1024,1024,1024,0,0,1024,1024,512000,512000,if(front)b"front" else b"back",0,b"root",t(),1000000,blend,option::some(b"fabric"),option::some(if(front)b"red" else b"blue"),mask,vector[])}
fun rep(s:&Scene):Representation{visual::representation(s,1024,1024,vector[f(true,option::none(),0),f(false,option::none(),1)],vector[])}
fun fact(part:vector<u8>):visual::Fact{visual::fact(object::id_from_address(@0x1),1,part,b"item",b"style")}
fun render(s:&Scene,r:&Representation):vector<visual::Layer>{visual::ordered(visual::render_layers(s,r,&option::none(),fixtures::h(20),fact(b"free"),&vector[fact(b"free")],&visual::default_colors(s),t(),vector[]))}
fun def(s:&Scene,part:vector<u8>,rights:u8):Definition{policy::definition(part,b"item",b"style",rights,fixtures::h(11),fixtures::h(12),rep(s),10,fixtures::layout(),policy::bounds(10000,10000,500000,2000000,90000,vector[]),vector[],vector[],true)}

#[test]
fun two_fragments_keep_fixed_style_and_back_front_order(){let s=profile(0);let layers=render(&s,&rep(&s));assert!(layers.length()==2 && visual::track_key(visual::layer_track(&layers[0]))==b"back" && visual::fragment_key(visual::layer_fragment(&layers[1]))==b"front-image",0);assert!(visual::fragment_blend(visual::layer_fragment(&layers[0]))==1,1)}
#[test]
fun no_player_override_preserves_each_fragment_swatch(){let s=profile(0);let ls=render(&s,&rep(&s));assert!(visual::swatch_key(&visual::layer_color(&ls[0]).destroy_some())==b"blue" && visual::swatch_key(&visual::layer_color(&ls[1]).destroy_some())==b"red",0)}
#[test]
fun linked_color_override_applies_to_both_fragments_with_hard_gradient(){let s=profile(0);let colors=vector[visual::color_choice(b"fabric",b"gradient")];let ls=visual::render_layers(&s,&rep(&s),&option::none(),fixtures::h(20),fact(b"free"),&vector[fact(b"free")],&colors,t(),vector[]);let sw=visual::layer_color(&ls[0]).destroy_some();let(a,b)=visual::stop_value(&visual::swatch_stops(&sw)[1]);let(c,d)=visual::stop_value(&visual::swatch_stops(&sw)[2]);assert!(visual::swatch_stops(&sw).length()==4 && a==500000 && b==2 && c==500000 && d==3,0);assert!(visual::layer_color(&ls[0])==visual::layer_color(&ls[1]),1)}
#[test,expected_failure(abort_code=2,location=soulidity_visual::visual)]
fun oversized_canvas_rejected(){let _=profile(2);}
#[test,expected_failure(abort_code=3,location=soulidity_visual::visual)]
fun duplicate_track_key_rejected(){let _=profile(3);}
#[test,expected_failure(abort_code=6,location=soulidity_visual::visual)]
fun palette_missing_swatch_rejected(){let s=profile(0);visual::assert_colors(&s,&vector[visual::color_choice(b"fabric",b"missing")])}
#[test,expected_failure(abort_code=6,location=soulidity_visual::visual)]
fun locked_channel_cannot_be_overridden(){let s=profile(6);visual::assert_colors(&s,&vector[visual::color_choice(b"fabric",b"red")])}
#[test,expected_failure(abort_code=6,location=soulidity_visual::visual)]
fun color_choices_cannot_omit_linked_channel(){visual::assert_colors(&profile(0),&vector[])}
#[test,expected_failure(abort_code=6,location=soulidity_visual::visual)]
fun raw_rgba_cannot_bypass_linked_channel(){let s=profile(0);let _=visual::render_layers(&s,&rep(&s),&option::none(),fixtures::h(20),fact(b"free"),&vector[fact(b"free")],&visual::default_colors(&s),t(),vector[255,0,0,255]);}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun native_representation_cannot_cross_canvas(){visual::assert_native(&rep(&profile(0)),&profile(1))}
#[test]
fun explicit_mapping_covers_each_fragment_and_exact_canvas(){let source=profile(0);let target=profile(1);let r=rep(&source);let m=visual::mapping(&r,&target,vector[visual::fragment_map(0,b"front",b"root",t(),option::some(b"fabric"),option::some(b"red")),visual::fragment_map(1,b"back",b"root",t(),option::some(b"fabric"),option::some(b"blue"))]);visual::assert_mapping(&r,&target,&m);let ls=visual::render_layers(&target,&r,&option::some(m),fixtures::h(20),fact(b"free"),&vector[fact(b"free")],&visual::default_colors(&target),t(),vector[]);assert!(ls.length()==2 && visual::mapping_scene(&m)==visual::scene_hash(&target),0)}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun partial_adapter_cannot_drop_a_fragment(){let s=profile(0);let _=visual::mapping(&rep(&s),&s,vector[visual::fragment_map(0,b"front",b"root",t(),option::none(),option::none())]);}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun adapter_indices_cannot_duplicate_fragment(){let s=profile(0);let m=visual::fragment_map(0,b"front",b"root",t(),option::none(),option::none());let _=visual::mapping(&rep(&s),&s,vector[m,m]);}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun approved_adapter_does_not_match_other_canvas(){let s=profile(0);let r=rep(&s);let m=visual::mapping(&r,&s,vector[visual::fragment_map(0,b"front",b"root",t(),option::none(),option::none()),visual::fragment_map(1,b"back",b"root",t(),option::none(),option::none())]);visual::assert_mapping(&r,&profile(1),&m)}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun forward_mask_reference_rejected(){let s=profile(0);let _=visual::representation(&s,1024,1024,vector[f(true,option::some(1),0),f(false,option::none(),0)],vector[]);}
#[test]
fun prior_fragment_mask_is_committed(){let s=profile(0);let r=visual::representation(&s,1024,1024,vector[f(true,option::none(),0),f(false,option::some(0),0)],vector[]);assert!(render(&s,&r).length()==2 && visual::representation_hash(&r)!=visual::representation_hash(&rep(&s)),0)}
#[test,expected_failure(abort_code=1,location=soulidity_visual::visual)]
fun unsupported_blend_code_rejected(){let _=f(true,option::none(),17);}
#[test,expected_failure(abort_code=3,location=soulidity_visual::visual)]
fun duplicate_fragment_cannot_be_two_selections(){let s=profile(0);let f=f(true,option::none(),0);let _=visual::representation(&s,1024,1024,vector[f,f],vector[]);}
fun keyed_fragment(key:vector<u8>,order:u64,mask:Option<u64>):Fragment{
    visual::fragment(key,fixtures::h(11),b"image/png",1024,1,1,0,0,1,1,0,0,b"front",order,b"root",t(),1000000,0,option::none(),option::none(),mask,vector[])
}
#[test]
fun capacity_key_validation_preserves_all_original_fragments_and_mask_indices(){
    let s=profile(0);let mut fragments=vector[];let mut i=0u64;
    while(i < 500){fragments.push_back(keyed_fragment(bcs::to_bytes(&(500-i)),i,if(i==0)option::none() else option::some(0)));i=i+1};
    let r=visual::representation(&s,1024,1024,fragments,vector[]);
    assert!(*visual::fragments(&r)==fragments && visual::fragment_key(&visual::fragments(&r)[499])==bcs::to_bytes(&1u64),0)
}
#[test]
fun prefix_and_binary_keys_remain_distinct_and_keep_author_order(){
    let s=profile(0);let keys=vector[b"z",b"a-long",b"a",vector[97u8,0],vector[255u8],vector[0u8]];
    let fragments=keys.map_ref!(|k|keyed_fragment(*k,0,option::none()));
    let r=visual::representation(&s,1024,1024,fragments,vector[]);assert!(*visual::fragments(&r)==fragments,0)
}
#[test,expected_failure(abort_code=3,location=soulidity_visual::visual)]
fun capacity_last_fragment_duplicate_is_rejected(){
    let s=profile(0);let mut fragments=vector[];let mut i=0u64;
    while(i < 499){fragments.push_back(keyed_fragment(bcs::to_bytes(&i),i,option::none()));i=i+1};
    fragments.push_back(keyed_fragment(bcs::to_bytes(&0u64),499,option::none()));
    let _=visual::representation(&s,1024,1024,fragments,vector[]);
}
#[test,expected_failure(abort_code=3,location=soulidity_visual::visual)]
fun extension_duplicate_of_old_key_is_rejected(){
    let s=profile(0);let r=visual::representation(&s,1024,1024,vector[keyed_fragment(b"a",0,option::none())],vector[]);
    let _=visual::extend_representation(&r,&s,vector[keyed_fragment(b"z",1,option::none()),keyed_fragment(b"a",2,option::none())]);
}
#[test,expected_failure(abort_code=3,location=soulidity_visual::visual)]
fun extension_duplicate_between_new_keys_is_rejected(){
    let s=profile(0);let r=visual::representation(&s,1024,1024,vector[keyed_fragment(b"a",0,option::none())],vector[]);
    let _=visual::extend_representation(&r,&s,vector[keyed_fragment(b"z",1,option::none()),keyed_fragment(b"z",2,option::none())]);
}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun conditional_anchor_requires_actual_provider(){let s=profile(4);let _=render(&s,&rep(&s));}
#[test]
fun conditional_anchor_resolves_from_actual_selected_provider(){let s=profile(4);let r=rep(&s);let ls=visual::render_layers(&s,&r,&option::none(),fixtures::h(20),fact(b"free"),&vector[fact(b"free"),fact(b"ref")],&visual::default_colors(&s),t(),vector[]);assert!(ls.length()==2,0)}
#[test,expected_failure(abort_code=5,location=soulidity_visual::visual)]
fun require_rule_cannot_use_unselected_provider(){visual::assert_rules(&profile(5),&vector[fact(b"free")])}
#[test]
fun exact_product_selector_rejects_semantically_identical_foreign_source(){let selector=visual::selector(option::some(object::id_from_address(@0x2)),option::some(1),b"free",option::some(b"item"),option::some(b"style"));assert!(!visual::selected(&selector,&vector[fact(b"free")]),0)}
#[test]
fun postfix_visibility_evaluates_all_not_any_from_selection(){let program=vector[selected(b"free"),selected(b"ref"),visual::token(1,option::none(),1),visual::token(2,option::none(),2)];assert!(visual::evaluate(&program,&vector[fact(b"free")]) && !visual::evaluate(&program,&vector[fact(b"free"),fact(b"ref")]),0)}
#[test,expected_failure(abort_code=5,location=soulidity_visual::visual)]
fun malformed_visibility_stack_rejected(){visual::validate_program(&vector[visual::token(1,option::none(),1)])}
#[test]
fun scene_and_palette_change_semantic_commitment_even_when_empty(){let s=profile(0);let h=output::recipe_hash(&s,&visual::default_colors(&s),vector[]);assert!(h!=output::recipe_hash(&profile(1),&visual::default_colors(&profile(1)),vector[]),0);assert!(h!=output::recipe_hash(&s,&vector[visual::color_choice(b"fabric",b"blue")],vector[]),1)}
#[test]
fun signed_rotation_and_signed_zero_are_canonical(){assert!(visual::signed(true,0)==zero(),0);let l=policy::layout_signed(true,1000,false,0,1000000,true,45000,vector[]);let(x,_,scale,r)=visual::transform_parts(&policy::visual_transform(&l));let(xn,xm)=visual::signed_parts(&x);let(rn,rm)=visual::signed_parts(&r);assert!(xn && xm==1000 && scale==1000000 && rn && rm==45000,1)}

fun setup(mode:u8):(Scenario,ID){let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let mut p:Product<USD> = sc.take_shared();let mut c:Control=sc.take_from_sender();let registry:KindRegistry=sc.take_shared();let scene=profile(mode);let defs=vector[def(&scene,b"ref",0),def(&scene,b"bound",1),def(&scene,b"free",2)];let v=catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,1000,@0xd,soulidity_maker_terms::maker_resale::rates(500,500),vector[b"ref",b"bound",b"free"],vector[b"free"],defs,vector[],scene);catalog::publish(&mut p,&mut c,1,catalog::with_outputs(v,vector[fixtures::default_output(&registry,false,true,vector[])]));let id=object::id(&p);sc.return_to_sender(c);test_scenario::return_shared(registry);test_scenario::return_shared(p);sc.next_tx(@0xb);(sc,id)}
fun mint(sc:&mut Scenario,id:ID,colored:bool):ID{
    let mut p:Product<USD> = sc.take_shared_by_id(id);let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let pid=player::create_for_testing(&mut p,&cfg,2,0,1000,fixtures::h(19),&clock,sc.ctx());sc.next_tx(@0xb);
    let mut pl:Player=sc.take_from_sender_by_id(pid);let scene=*catalog::scene(catalog::published(&p,2));let parts=vector[b"ref",b"bound",b"free"];let mut i=0;
    while(i < 3){let d=def(&scene,parts[i],i as u8);player::set_base_for_testing(&mut pl,&p,&cfg,policy::definition_hash(&d),fixtures::layout(),i,0,1000,&clock,sc.ctx());i=i+1};
    if(colored)player::set_colors(&mut pl,vector[visual::color_choice(b"fabric",b"gradient")],3,sc.ctx());
    let v=catalog::published(&p,2);let out=catalog::output_policy(v,b"default");let intent=output::intent(catalog::protocol(&p),id,2,catalog::policy_hash(v),output::policy_hash(&out),@0xb,fixtures::h(20),string::utf8(b"OC"),player::semantic_recipe_hash(&pl),vector::tabulate!(16,|_|20));let plan=player::render_plan(&pl);assert!(plan.length()==6,0);
    let mut build=issuer::begin_for_testing(soulidity_v1::native_binding::application_binding(&cfg),&mut p,&mut cfg,intent,b"default",0,1000,coin::mint_for_testing<USD>(0,sc.ctx()),&clock,sc.ctx());
    i=0;while(i < 3){issuer::select_player(&mut build,&mut p,&pl,parts[i],if(colored)4 else 3,sc.ctx());i=i+1};
    let mut system=fixtures::prepare_storage(sc);let root=fixtures::finish(sc,build,&mut system,&clock);test_scenario::return_shared(system);player::close(pl,if(colored)4 else 3,sc.ctx());test_scenario::return_shared(p);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.next_tx(@0xb);root
}
#[test]
fun actual_player_complete_preserves_linked_palette_and_six_layers(){let(mut sc,id)=setup(0);let root=mint(&mut sc,id,true);let s:Soul=sc.take_from_sender_by_id(root);assert!(soul::render_plan(&s).length()==6 && soul::bound_count(&s)==1 && soul::free_id(&soul::binding(&s,b"free").destroy_some()).is_some(),0);assert!(soul::colors(&s)==vector[visual::color_choice(b"fabric",b"gradient")] && soul::semantic_recipe_hash(&s)==output::original_recipe_hash(soul::original_output(&s)),1);let h=soul::manifest_hash(&s);assert!(h==policy::hash_bytes(bcs::to_bytes(&soul::manifest(&s))),2);sc.return_to_sender(s);sc.end();}
#[test]
fun tune_palette_changes_sale_manifest_but_not_original_output(){let(mut sc,id)=setup(0);let root=mint(&mut sc,id,true);let mut s:Soul=sc.take_from_sender_by_id(root);let original=output::original_recipe_hash(soul::original_output(&s));let manifest=soul::manifest_hash(&s);soul::tune_colors(&mut s,vector[visual::color_choice(b"fabric",b"blue")],0);assert!(soul::manifest_hash(&s)!=manifest && soul::semantic_recipe_hash(&s)!=original && output::original_recipe_hash(soul::original_output(&s))==original,0);sc.return_to_sender(s);sc.end();}
#[test]
fun removing_rule_provider_never_traps_actual_free_item(){let(mut sc,id)=setup(5);let root=mint(&mut sc,id,false);let mut s:Soul=sc.take_from_sender_by_id(root);let free=soul::free_id(&soul::binding(&s,b"free").destroy_some()).destroy_some();soul::clear_reference(&mut s,b"ref",0);let it=soul::detach(&mut s,b"free",1);assert!(object::id(&it)==free,0);transfer::public_transfer(it,@0xb);sc.return_to_sender(s);sc.next_tx(@0xb);let it:soulidity_model::components::Item=sc.take_from_sender_by_id(free);sc.return_to_sender(it);sc.end();}
#[test,expected_failure(abort_code=5,location=soulidity_visual::visual)]
fun incomplete_composition_explicitly_fails_rule_validation(){let(mut sc,id)=setup(5);let root=mint(&mut sc,id,false);let mut s:Soul=sc.take_from_sender_by_id(root);soul::clear_reference(&mut s,b"ref",0);soul::validate_recipe(&s);sc.return_to_sender(s);sc.end();}
#[test]
fun whole_sale_keeps_palette_and_queries_unmounted_source(){
    let(mut sc,id)=setup(0);let root=mint(&mut sc,id,true);sc.next_tx(@0xa);let mut cfg:Config<USD> = sc.take_shared();let mut admin:Admin=sc.take_from_sender();economics::configure(&mut cfg,&mut admin,0,1000,250,0,@0xf,false);test_scenario::return_shared(cfg);sc.return_to_sender(admin);sc.next_tx(@0xb);
    let mut s:Soul=sc.take_from_sender_by_id(root);soul::unmount_bound(&mut s,b"bound",0);let cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let hash=soul::manifest_hash(&s);let lid=market::list_soul(s,&cfg,101,1000,1,hash,1,&clock,sc.ctx());test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.next_tx(@0xc);
    let mut l:soulidity_market::market::Listing<Soul,USD> = sc.take_shared_by_id(lid);let src=market::bundle_bound_source(&l,0);assert!(visual::fragments(policy::source_representation(&src)).length()==2 && soul::manifest_bound_count(&market::bundle(&l))==1,0);let mut cfg:Config<USD> = sc.take_shared();let clock=clock::create_for_testing(sc.ctx());let q=market::soul_quote_hash(&l,&cfg,@0xc);market::buy_soul(&mut l,&mut cfg,0,hash,q,1,fixtures::h(40),coin::mint_for_testing<USD>(101,sc.ctx()),&clock,sc.ctx());test_scenario::return_shared(l);test_scenario::return_shared(cfg);clock::destroy_for_testing(clock);sc.next_tx(@0xc);
    let s:Soul=sc.take_from_sender_by_id(root);assert!(soul::colors(&s)==vector[visual::color_choice(b"fabric",b"gradient")] && soul::render_plan(&s).length()==4 && soul::bound_count(&s)==1 && soul::binding(&s,b"bound").is_none(),1);sc.return_to_sender(s);sc.end();
}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun version_rejects_definition_from_other_scene(){let _=catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xd,soulidity_maker_terms::maker_resale::rates(0,0),vector[b"free"],vector[],vector[def(&profile(0),b"free",2)],vector[],profile(1));}
#[test,expected_failure(abort_code=1,location=soulidity_model::policy)]
fun adapter_part_must_exist_in_exact_target_scene(){let(mut sc,id)=setup(0);let p:Product<USD> = sc.take_shared_by_id(id);let src=catalog::preview_source(&p,2,policy::definition_hash(&def(&profile(0),b"free",2)));let scene=profile(1);let m=visual::mapping(policy::source_representation(&src),&scene,vector[visual::fragment_map(0,b"front",b"root",t(),option::none(),option::none()),visual::fragment_map(1,b"back",b"root",t(),option::none(),option::none())]);let _=policy::adapter(&src,&scene,b"missing",m,policy::bounds(0,0,1000000,1000000,0,vector[]));test_scenario::return_shared(p);sc.end();}
#[test,expected_failure(abort_code=1,location=soulidity_application::character)]
fun stale_palette_revision_cannot_overwrite_newer_choice(){let(mut sc,id)=setup(0);let root=mint(&mut sc,id,false);let mut s:Soul=sc.take_from_sender_by_id(root);soul::tune_colors(&mut s,vector[visual::color_choice(b"fabric",b"blue")],0);soul::tune_colors(&mut s,vector[visual::color_choice(b"fabric",b"red")],0);sc.return_to_sender(s);sc.end();}
#[test]
fun reset_uses_frozen_creator_layout_and_user_transform_reaches_plan(){let(mut sc,id)=setup(0);let root=mint(&mut sc,id,false);let mut s:Soul=sc.take_from_sender_by_id(root);soul::tune(&mut s,b"free",policy::layout_signed(true,1000,false,2000,1500000,true,45000,vector[]),0);let layers=soul::render_plan(&s);let mut matched=0;layers.do_ref!(|l|{let(x,y,scale,rotation)=visual::transform_parts(&visual::layer_user(l));let(nx,mx)=visual::signed_parts(&x);let(ny,my)=visual::signed_parts(&y);let(nr,mr)=visual::signed_parts(&rotation);if(nx && mx==1000){assert!(!ny && my==2000 && scale==1500000 && nr && mr==45000,0);matched=matched+1}});assert!(matched==2,1);soul::reset_layout(&mut s,b"free",1);assert!(soul::binding_layout(&soul::binding(&s,b"free").destroy_some())==fixtures::layout(),2);sc.return_to_sender(s);sc.end();}

fun shared_prefix_key(index:u64):vector<u8>{let mut key=vector::tabulate!(31,|_|97u8);key.push_back(index as u8);key}
#[test]
fun capacity_shared_prefix_keys_preserve_exact_bytes_and_mask_order(){
    let s=profile(0);let fragments=vector::tabulate!(64,|i|keyed_fragment(shared_prefix_key(63-i),i,if(i==0)option::none() else option::some(0)));
    let r=visual::representation(&s,1024,1024,fragments,vector[]);assert!(*visual::fragments(&r)==fragments,0)
}
#[test,expected_failure(abort_code=3,location=soulidity_visual::visual)]
fun capacity_shared_prefix_bucket_rejects_last_exact_duplicate(){
    let s=profile(0);let mut fragments=vector::tabulate!(63,|i|keyed_fragment(shared_prefix_key(i),i,option::none()));
    fragments.push_back(keyed_fragment(shared_prefix_key(0),63,option::none()));let _=visual::representation(&s,1024,1024,fragments,vector[]);
}
