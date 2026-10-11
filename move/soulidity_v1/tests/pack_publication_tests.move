#[test_only]
module soulidity_v1::pack_publication_tests;
use sui::test_scenario::{Self,Scenario};
use soulidity_v1::fixtures::{Self,USD};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::Config;
use soulidity_model::policy::{Self,Definition};
use soulidity_visual::visual::{Self,Scene};
use soulidity_content_kinds::content_kind_registry::KindRegistry;

fun z():visual::Signed{visual::signed(false,0)}
fun t():visual::Transform{visual::transform(z(),z(),1000000,z())}
fun sel(part:vector<u8>,item:Option<vector<u8>>,style:Option<vector<u8>>):visual::Selector{visual::selector(option::none(),option::none(),part,item,style)}
public fun base_rule():visual::Rule{visual::rule(b"maker-rule",0,sel(b"free",option::none(),option::none()),false,vector[sel(b"ref",option::none(),option::none())])}
fun color(changed:bool):visual::Channel{visual::channel(b"fabric",if(changed)b"blue" else b"red",true,vector[visual::swatch(b"red",1,vector[]),visual::swatch(b"blue",2,vector[])])}
public fun base():Scene{visual::scene(1024,1024,z(),z(),0,fixtures::h(14),b"body",b"pose",vector[b"ref",b"bound",b"free"],vector[visual::track(b"back",0,false),visual::track(b"front",2,true)],vector[color(false)],vector[visual::anchor(b"root",vector[],z(),z())],vector[base_rule()])}
fun extended(mode:u8):Scene{
    let parts=if(mode==5)vector[b"bound",b"ref",b"free",b"accessory"] else vector[b"ref",b"bound",b"free",b"accessory"];
    let tracks=if(mode==8)vector[visual::track(b"back",0,false),visual::track(b"glow",1,false)] else vector[visual::track(b"back",0,false),visual::track(b"glow",1,false),visual::track(b"front",if(mode==7)3 else 2,true)];
    let channels=vector[color(mode==6),visual::channel(b"metal",b"gold",true,vector[visual::swatch(b"gold",3,vector[])])];
    let mut anchors=vector[visual::anchor(b"root",vector[],visual::signed(false,if(mode==9)1 else 0),z()),visual::anchor(b"pack-root",vector[],z(),z())];
    if(mode==10)anchors.push_back(visual::anchor(b"root",vector[visual::token(0,option::some(sel(b"free",option::none(),option::none())),0)],z(),z()));
    let trigger=if(mode==13)sel(b"free",option::none(),option::none()) else if(mode==14)sel(b"free",option::some(b"item"),option::some(b"unknown")) else if(mode==15)sel(b"free",option::some(b"item"),option::some(b"style")) else if(mode==16)sel(b"free",option::some(b"item"),option::some(b"pack-style")) else sel(b"accessory",option::none(),option::none());
    let target=if(mode==17)sel(b"ref",option::some(b"missing"),option::none()) else if(mode==18)visual::selector(option::some(object::id_from_address(@0x99)),option::some(1),b"ref",option::none(),option::none()) else sel(b"ref",option::some(b"item"),option::some(b"style"));
    let mut rules=if(mode==11)vector[] else if(mode==12)vector[visual::rule(b"maker-rule",0,sel(b"bound",option::none(),option::none()),false,vector[sel(b"ref",option::none(),option::none())])] else vector[base_rule()];
    rules.push_back(visual::rule(b"pack-rule",0,trigger,false,vector[target]));
    visual::scene(if(mode==1)512 else 1024,1024,z(),z(),if(mode==4)1 else 0,fixtures::h(if(mode==2)15 else 14),if(mode==3)b"other-body" else b"body",b"pose",parts,tracks,channels,anchors,rules)
}
public fun def(scene:&Scene,part:vector<u8>,style:vector<u8>,pack:bool,missing_visibility:bool):Definition{
    let visible=if(missing_visibility)vector[visual::token(0,option::some(sel(b"ref",option::some(b"item"),option::some(b"missing-style"))),0)] else vector[];
    let fragment=visual::fragment(b"image",fixtures::h(11),b"image/png",1024,1024,1024,0,0,1024,1024,512000,512000,if(pack)b"glow" else b"back",0,if(pack)b"pack-root" else b"root",t(),1000000,0,option::some(if(pack)b"metal" else b"fabric"),option::some(if(pack)b"gold" else b"red"),option::none(),vector[]);
    policy::definition(part,b"item",style,2,fixtures::h(11),fixtures::h(12),visual::representation(scene,1024,1024,vector[fragment],visible),10,fixtures::layout(),policy::bounds(10000,10000,500000,2000000,90000,vector[]),vector[],vector[],true)
}
public fun draft(scene:Scene,parts:vector<vector<u8>>,defs:vector<Definition>,required:vector<vector<u8>>):soulidity_maker_manufacturing::maker_catalog::Version{catalog::version(fixtures::h(1),fixtures::h(2),0,0,0,0,0,0,0,@0xd,soulidity_maker_terms::maker_resale::rates(0,0),parts,required,defs,vector[],scene)}
public fun control(sc:&Scenario,id:ID):Control{let mut found=option::none();sc.ids_for_sender<Control>().do_ref!(|oid|{let c:Control=sc.take_from_sender_by_id(*oid);if(catalog::control_product(&c)==id)found.fill(c) else sc.return_to_sender(c)});found.destroy_some()}
public fun setup():(Scenario,ID,ID,vector<u8>){
    let mut sc=fixtures::setup(0,0,0,0,0,0);sc.next_tx(@0xa);let mut maker:Product<USD> = sc.take_shared();let mut cap:Control=sc.take_from_sender();let registry:KindRegistry=sc.take_shared();
    let s=base();let defs=vector[def(&s,b"ref",b"style",false,false),def(&s,b"bound",b"style",false,false),def(&s,b"free",b"style",false,false)];
    catalog::publish(&mut maker,&mut cap,1,catalog::with_physical(catalog::with_outputs(draft(s,vector[b"ref",b"bound",b"free"],defs,vector[]),vector[fixtures::default_output(&registry,false,true,vector[])]),vector[]));
    let cfg:Config<USD> = sc.take_shared();let id=object::id(&maker);let parent_hash=catalog::policy_hash(catalog::published(&maker,2));let pack=catalog::create_pack_for_testing(&maker,2,&mut cap,&cfg,0,sc.ctx());
    test_scenario::return_shared(maker);test_scenario::return_shared(cfg);test_scenario::return_shared(registry);sc.return_to_sender(cap);sc.next_tx(@0xa);(sc,id,pack,parent_hash)
}
fun publish(sc:&mut Scenario,id:ID,mode:u8){
    let mut p:Product<USD> = sc.take_shared_by_id(id);let mut c=control(sc,id);let scene=extended(mode);let d=def(&scene,if(mode==16 || mode==21)b"free" else b"accessory",if(mode==21)b"style" else b"pack-style",true,mode==22);
    let parts=if(mode==19)vector[b"bound"] else if(mode==16 || mode==21)vector[b"accessory",b"free"] else vector[b"accessory"];
    let required=if(mode==20)vector[b"accessory"] else vector[];catalog::publish(&mut p,&mut c,0,catalog::with_pack_key(draft(scene,parts,vector[d],required),b"pack"));
    sc.return_to_sender(c);test_scenario::return_shared(p)
}
#[test]
fun actual_pack_publication_adds_rows_and_binds_actual_parent(){let(mut sc,maker,pack,hash)=setup();publish(&mut sc,pack,0);sc.next_tx(@0xa);let p:Product<USD> = sc.take_shared_by_id(pack);let v=catalog::published(&p,1);let c=catalog::publication(v).destroy_some();assert!(catalog::publication_product(&c)==pack && catalog::publication_version(&c)==1 && catalog::publication_parent(&c)==option::some(maker) && catalog::publication_parent_version(&c)==2 && catalog::publication_parent_policy(&c)==option::some(hash),0);assert!(catalog::parent_policy(&p)==option::some(hash) && catalog::parent_scene(&p)==option::some(base()),1);assert!(visual::tracks(catalog::scene(v)).length()==3 && visual::channels(catalog::scene(v)).length()==2 && visual::parts(catalog::scene(v)).length()==4 && visual::rules(catalog::scene(v)).length()==2,2);test_scenario::return_shared(p);sc.end();}
#[test]
fun pack_can_add_style_to_inherited_item_with_own_trigger(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,16);sc.end();}
#[test]
fun maker_new_publication_does_not_reparent_existing_pack(){let(mut sc,maker,pack,hash)=setup();let mut p:Product<USD> = sc.take_shared_by_id(maker);let mut c=control(&sc,maker);let registry:KindRegistry=sc.take_shared();let scene=extended(0);let defs=vector[def(&scene,b"ref",b"style",false,false),def(&scene,b"free",b"style",false,false),def(&scene,b"accessory",b"new-style",true,false)];catalog::publish(&mut p,&mut c,2,catalog::with_outputs(draft(scene,vector[b"ref",b"free",b"accessory"],defs,vector[]),vector[fixtures::default_output(&registry,false,true,vector[])]));test_scenario::return_shared(p);test_scenario::return_shared(registry);sc.return_to_sender(c);sc.next_tx(@0xa);publish(&mut sc,pack,0);sc.next_tx(@0xa);let pack:Product<USD> = sc.take_shared_by_id(pack);assert!(catalog::parent_policy(&pack)==option::some(hash),0);test_scenario::return_shared(pack);sc.end();}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_change_parent_canvas(){visual::assert_additive(&base(),&extended(1));}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_change_parent_renderer(){visual::assert_additive(&base(),&extended(2));}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_change_parent_body(){visual::assert_additive(&base(),&extended(3));}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_change_parent_sampling(){visual::assert_additive(&base(),&extended(4));}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_reorder_parent_parts(){visual::assert_additive(&base(),&extended(5));}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_rewrite_parent_palette(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,6);sc.end();}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_reorder_parent_tracks(){visual::assert_additive(&base(),&extended(7));}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_remove_parent_track(){visual::assert_additive(&base(),&extended(8));}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_move_parent_anchor(){visual::assert_additive(&base(),&extended(9));}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun added_anchor_variant_cannot_hijack_parent_key(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,10);sc.end();}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_remove_parent_rules(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,11);sc.end();}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_cannot_rewrite_parent_rule(){visual::assert_additive(&base(),&extended(12));}
#[test,expected_failure(abort_code=5,location=soulidity_visual::visual)]
fun pack_rule_cannot_impose_new_generic_trigger_on_parent_part(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,13);sc.end();}
#[test,expected_failure(abort_code=5,location=soulidity_visual::visual)]
fun pack_rule_cannot_claim_unpublished_style(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,14);sc.end();}
#[test,expected_failure(abort_code=5,location=soulidity_visual::visual)]
fun pack_rule_cannot_claim_parent_style(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,15);sc.end();}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun pack_rule_requires_existing_parent_item(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,17);sc.end();}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun uncertified_external_dependency_cannot_enter_publication(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,18);sc.end();}
#[test,expected_failure(abort_code=5,location=soulidity_maker_manufacturing::maker_catalog)]
fun extension_part_must_be_declared_by_pack(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,19);sc.end();}
#[test,expected_failure(abort_code=8,location=soulidity_maker_manufacturing::maker_catalog)]
fun expansion_cannot_add_required_parts_to_maker(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,20);sc.end();}
#[test,expected_failure(abort_code=5,location=soulidity_maker_manufacturing::maker_catalog)]
fun pack_fixed_style_cannot_shadow_parent_path(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,21);sc.end();}
#[test,expected_failure(abort_code=4,location=soulidity_visual::visual)]
fun representation_visibility_requires_real_local_style(){let(mut sc,_,id,_)=setup();publish(&mut sc,id,22);sc.end();}
#[test]
fun declaration_copy_is_not_a_published_product(){let s=base();let v=draft(s,vector[b"free"],vector[],vector[]);assert!(catalog::publication(&v).is_none(),0)}
