/// Immutable full visual capture. Compact parent commitment; full Scene/Profile/
/// fixed-Style recipe in separate owned DOFs to avoid recursive BCS layout limits.
module soulidity_application::visual_capture;
use std::bcs;
use std::type_name::{Self,TypeName};
use soulidity_transport::paged_transport::{Self as paged_store,Store};
use sui::dynamic_object_field as dof;
use sui::table::{Self,Table};
use soulidity_model::assembly::{Self,Profile,ProfileSnapshot,Scope,Equipped};
use soulidity_model::policy::{Self};
use soulidity_visual::visual::{Self,Scene,ColorChoice,Layer};
use soulidity_application::output::{Self};
use soulidity_maker_publication::output_data::{RecipeSlot};
const EProducer:u64=4;
const EBinding:u64=1;const ERecipe:u64=2;const ECapacity:u64=3;
public struct Capture has key,store {id:UID,producer:TypeName,carrier:ID,subject:ID,revision:u64,root:Scope,scene_hash:vector<u8>,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,recipe_hash:vector<u8>,render_hash:vector<u8>,commitment:vector<u8>}
public struct Base has key,store {id:UID,scene:Scene}
public struct Profiles has key,store {id:UID,keys:vector<Scope>,scenes:Table<Scope,Profile>}
public struct FrozenRecipe has key,store {id:UID,slots:Store<RecipeSlot>}
public struct BaseKey has copy,drop,store {}
public struct ProfilesKey has copy,drop,store {}
public struct RecipeKey has copy,drop,store {}
public struct Commitment has copy,drop,store {domain:vector<u8>,schema:u16,producer:TypeName,carrier:ID,subject:ID,revision:u64,root:Scope,scene:vector<u8>,recipe:vector<u8>,render:vector<u8>}
/// Capture is immutable visual metadata, not a right to mint a native asset.
/// The dedicated private producer must originate in the actual carrier module.
/// Its application must additionally prove subject custody, payment and rules.
public fun new<W:drop,P:key>(_w:W,parent:&P,subject:ID,revision:u64,root:Profile,profiles:vector<ProfileSnapshot>,published:vector<Profile>,colors:vector<ColorChoice>,slots:vector<RecipeSlot>,ctx:&mut TxContext):Capture{
    let producer=type_name::with_original_ids<W>();let p=type_name::with_original_ids<P>();
    assert!(!producer.is_primitive() && !p.is_primitive(),EProducer);
    assert!(producer.address_string()==p.address_string() && producer.module_string()==p.module_string() && *producer.datatype_string().as_bytes()==b"CaptureProducer",EProducer);
    let carrier=object::id(parent);
    assert!(assembly::profile_parent(&root).is_none(),EBinding);let scene=*assembly::profile_scene(&root);let scope=assembly::profile_scope(&root);
    let mut state=assembly::new(&root,ctx);let mut scenes=table::new(ctx);let mut keys=vector[scope];scenes.add(scope,root);
    profiles.do_ref!(|snapshot|{let scope=assembly::snapshot_scope(snapshot);let mut found=option::none();published.do_ref!(|p|{if(assembly::profile_scope(p)==scope)found=option::some(*p)});let p=found.destroy_some();assembly::admit(&mut state,&scene,p);assembly::set_pack_colors(&mut state,&scene,scope,assembly::snapshot_colors(snapshot));assert!(!scenes.contains(scope),EBinding);scenes.add(scope,p);keys.push_back(scope)});
    let equipped=equipped(&slots);assert!(assembly::active_snapshots(&state,&equipped)==profiles && assembly::active_parts(&state,&equipped)==slots.map_ref!(|s|output::slot_part(s)),ERecipe);
    assert_equipped(&state,&root,&scene,&equipped);let plan=assembly::render(&state,&scene,&colors,&equipped);assembly::destroy(state);
    let recipe_hash=output::profile_recipe_hash(&scene,&colors,profiles,slots);let render_hash=policy::hash_bytes(bcs::to_bytes(&plan));let scene_hash=visual::scene_hash(&scene);
    let commitment=policy::hash_bytes(bcs::to_bytes(&Commitment{domain:b"soulidity-visual-capture",schema:2,producer,carrier,subject,revision,root:scope,scene:scene_hash,recipe:recipe_hash,render:render_hash}));
    let mut c=Capture{id:object::new(ctx),producer,carrier,subject,revision,root:scope,scene_hash,colors,profiles,recipe_hash,render_hash,commitment};assert!(bcs::to_bytes(&c).length()<=196608,ECapacity);
    dof::add(&mut c.id,BaseKey{},Base{id:object::new(ctx),scene});dof::add(&mut c.id,ProfilesKey{},Profiles{id:object::new(ctx),keys,scenes});dof::add(&mut c.id,RecipeKey{},FrozenRecipe{id:object::new(ctx),slots:paged_store::from_values(slots,ctx)});c
}
fun equipped(slots:&vector<RecipeSlot>):vector<Equipped>{let mut e=vector[];slots.do_ref!(|s|output::slot_selection(s).do_ref!(|selected|e.push_back(assembly::mapped_equipped(output::slot_part(s),*output::selection_source(selected),output::selection_layout(selected),output::selection_adapter(selected)))));e}
fun assert_equipped(state:&assembly::State,root:&Profile,scene:&Scene,e:&vector<Equipped>){
    e.do_ref!(|equipped|{let part=assembly::equipped_part(equipped);let source=assembly::equipped_source(equipped);let layout=assembly::equipped_layout(equipped);policy::assert_layout(policy::source_bounds(source),&layout);
        let adapter=assembly::equipped_adapter(equipped);if(adapter.is_none())assert!(assembly::native_matches(state,scene,source,part),EBinding)
        else {let a=adapter.destroy_some();let allowed=if(assembly::part_scope(&part).is_none())assembly::profile_adapters(root) else assembly::profile_adapters(assembly::published_profile(state,assembly::part_scope(&part).destroy_some()));assert!(allowed.contains(&a) && policy::adapter_source(&a)==policy::source_hash(source) && policy::adapter_part(&a)==assembly::part_name(&part),EBinding);policy::assert_layout(policy::adapter_bounds(&a),&layout)}
    })
}
/// Instance binding: a marker alone cannot authorize another registry's capture.
public fun assert_controller<W:drop,P:key>(_w:W,parent:&P,c:&Capture){assert!(type_name::with_original_ids<W>()==c.producer && object::id(parent)==c.carrier,EProducer)}
public fun producer(c:&Capture):TypeName{c.producer}
public fun carrier(c:&Capture):ID{c.carrier}
public fun commitment(c:&Capture):vector<u8>{c.commitment}
public fun subject(c:&Capture):ID{c.subject}
public fun revision(c:&Capture):u64{c.revision}
public fun recipe_hash(c:&Capture):vector<u8>{c.recipe_hash}
public fun render_hash(c:&Capture):vector<u8>{c.render_hash}
public fun root(c:&Capture):Scope{c.root}
public fun colors(c:&Capture):vector<ColorChoice>{c.colors}
public fun profiles(c:&Capture):vector<ProfileSnapshot>{c.profiles}
public fun scene(c:&Capture):&Scene{let b:&Base=dof::borrow(&c.id,BaseKey{});&b.scene}
public fun recipe(c:&Capture):vector<RecipeSlot>{let r:&FrozenRecipe=dof::borrow(&c.id,RecipeKey{});paged_store::values(&r.slots)}
public fun slot_count(c:&Capture):u64{let r:&FrozenRecipe=dof::borrow(&c.id,RecipeKey{});paged_store::length(&r.slots)}
public fun slot(c:&Capture,index:u64):&RecipeSlot{let r:&FrozenRecipe=dof::borrow(&c.id,RecipeKey{});paged_store::get(&r.slots,index)}
public fun profile(c:&Capture,scope:Scope):&Profile{let p:&Profiles=dof::borrow(&c.id,ProfilesKey{});p.scenes.borrow(scope)}
public fun render_plan(c:&Capture,ctx:&mut TxContext):vector<Layer>{
    let root=profile(c,c.root);let mut state=assembly::new(root,ctx);c.profiles.do_ref!(|p|{let scope=assembly::snapshot_scope(p);assembly::admit(&mut state,scene(c),*profile(c,scope));assembly::set_pack_colors(&mut state,scene(c),scope,assembly::snapshot_colors(p))});let plan=assembly::render(&state,scene(c),&c.colors,&equipped(&recipe(c)));assembly::destroy(state);assert!(policy::hash_bytes(bcs::to_bytes(&plan))==c.render_hash,ERecipe);plan
}
public fun destroy<W:drop,P:key>(w:W,parent:&P,mut c:Capture){
    assert_controller(w,parent,&c);
    let Base{id,scene:_}=dof::remove<BaseKey,Base>(&mut c.id,BaseKey{});id.delete();let FrozenRecipe{id,slots}=dof::remove<RecipeKey,FrozenRecipe>(&mut c.id,RecipeKey{});paged_store::destroy(slots);id.delete();let Profiles{id,keys,mut scenes}=dof::remove<ProfilesKey,Profiles>(&mut c.id,ProfilesKey{});keys.do!(|k|scenes.remove(k));scenes.destroy_empty();id.delete();let Capture{id,producer:_,carrier:_,subject:_,revision:_,root:_,scene_hash:_,colors:_,profiles:_,recipe_hash:_,render_hash:_,commitment:_}=c;id.delete()
}
