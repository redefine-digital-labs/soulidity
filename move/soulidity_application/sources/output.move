/// Creator output policies and immutable genesis artifacts. Encryption intent is
/// computable before storage/Complete; live read authority comes from the Soul.
module soulidity_application::output;
use std::bcs;
use soulidity_maker_publication::output_data::{Self,InitialRule,Policy,Intent,Selection,RecipeSlot,Recipe,Namespace,PayLine,Receipt};
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_content::authority::{Self,Controller};
use soulidity_transport::paged_transport::{Self as paged_store,Store};
use std::string::String;
use sui::dynamic_object_field as dof;
use sui::table::{Self,Table};
use soulidity_model::policy::{Self,Source,Layout,Adapter};
use soulidity_content::document;
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_transport::storage_transport::{Self as storage,Reference};
use soulidity_foundation::economics::{Self,PrimaryReceipt};
use soulidity_visual::visual::{Self,Scene,ColorChoice};
use soulidity_model::assembly::{Self,PartKey,ProfileSnapshot,Profile,Scope};
use walrus::blob::Blob;
use walrus::system::System;
use walrus::storage_resource::Storage;
const EPolicy:u64=1;const EIntent:u64=2;const ERecipe:u64=3;const EProtection:u64=4;









public struct Artifact has key,store {
    id:UID,controller:Controller,root:ID,intent:Intent,policy:Policy,recipe:Store<RecipeSlot>,scene:Scene,colors:vector<ColorChoice>,render:Reference,seal_id:Option<vector<u8>>,receipt:Receipt,materializations:Table<vector<u8>,vector<u8>>,
}
/// Immutable issuance/output fields only. Materialization reservations and the
/// current Blob lease are live state, not a change to the original OC output.
public struct OriginalCommitment has copy,drop,store {domain:vector<u8>,schema:u16,artifact:ID,controller:vector<u8>,root:ID,intent:vector<u8>,policy:vector<u8>,recipe:vector<u8>,render:Reference,seal_id:Option<vector<u8>>,envelope:vector<u8>,receipt:vector<u8>}
public fun original_commitment(a:&Artifact):vector<u8>{
    policy::hash_bytes(bcs::to_bytes(&OriginalCommitment{domain:b"soulidity/original-artifact/v1",schema:1,artifact:object::id(a),controller:policy::hash_bytes(bcs::to_bytes(&a.controller)),root:a.root,intent:intent_hash(&a.intent),policy:policy_hash(&a.policy),recipe:original_recipe_hash(a),render:a.render,seal_id:a.seal_id,envelope:policy::hash_bytes(*envelope(a)),receipt:receipt_hash(&a.receipt)}))
}
/// Linear application authorization, not proof of payment. The producer must
/// validate its own payment/supply/Complete path before authorizing creation.
/// Actual root provenance, parent identity, operator and exact intent are bound.
public struct Creation {controller:Controller,intent:vector<u8>}
public fun authorize<W:drop,P:key>(w:W,parent:&P,root:&Soul,intent:&Intent):Creation {
    let controller=authority::bind(w,parent,root);let origin=standard::origin(root);
    assert!(standard::source(&origin)==intent_maker(intent) && standard::source_version(&origin)==intent_version(intent) && standard::source_hash(&origin)==intent_policy(intent) && standard::minted_by(&origin)==intent_actor(intent),EIntent);
    Creation{controller,intent:intent_hash(intent)}
}
/// Current custody remains the application's responsibility. Matching a root ID
/// alone does not authorize native installation or a Seal approval endpoint.
public fun assert_controller<W:drop>(w:W,a:&Artifact,parent:ID,root:ID){
    authority::assert_operator(w,&a.controller);assert!(authority::parent(&a.controller)==parent && a.root==root,EIntent)
}
public fun application_parent(a:&Artifact):ID{authority::parent(&a.controller)}
public struct RecoveryEnvelope has key,store {id:UID,bytes:vector<u8>}
public struct RecoveryEnvelopeKey has copy,drop,store {}
public struct OriginalProfiles has key,store {id:UID,profiles:vector<ProfileSnapshot>,profile_scenes:Table<Scope,Profile>}
public struct OriginalProfilesKey has copy,drop,store {}
public struct RenderKey has copy,drop,store {}
public fun initial_rule(registry:&KindRegistry,kind:u32,name:String,read_mask:u64,download_policy:u8):InitialRule { output_data::initial_rule(registry,kind,name,read_mask,download_policy) }
public fun policy(key:vector<u8>,protected:bool,scope:vector<u8>,renderer:vector<u8>,all_packs:bool,allowed_packs:vector<vector<u8>>,initials:vector<InitialRule>):Policy { output_data::policy(key,protected,scope,renderer,all_packs,allowed_packs,initials) }
public fun policy_key(p:&Policy):vector<u8>{ output_data::policy_key(p) }
public fun policy_hash(p:&Policy):vector<u8>{ output_data::policy_hash(p) }
public fun protected(p:&Policy):bool{ output_data::protected(p) }
public fun scope(p:&Policy):vector<u8>{ output_data::scope(p) }
public fun renderer(p:&Policy):vector<u8>{ output_data::renderer(p) }
public fun allows_all_packs(p:&Policy):bool{ output_data::allows_all_packs(p) }
public fun allowed_packs(p:&Policy):vector<vector<u8>>{ output_data::allowed_packs(p) }
public fun initials(p:&Policy):vector<InitialRule>{ output_data::initials(p) }
public fun rule_kind(r:&InitialRule):u32{ output_data::rule_kind(r) }
public fun rule_name(r:&InitialRule):String{ output_data::rule_name(r) }
public fun rule_read(r:&InitialRule):u64{ output_data::rule_read(r) }
public fun rule_download(r:&InitialRule):u8{ output_data::rule_download(r) }
public fun rule(p:&Policy,kind:u32,name:String):InitialRule { output_data::rule(p,kind,name) }
public fun assert_pack(p:&Policy,key:vector<u8>){ output_data::assert_pack(p,key) }
public fun intent(protocol:ID,maker:ID,maker_version:u64,policy_hash:vector<u8>,output_policy_hash:vector<u8>,actor:address,attempt:vector<u8>,name:String,recipe:vector<u8>,nonce:vector<u8>):Intent { output_data::intent(protocol,maker,maker_version,policy_hash,output_policy_hash,actor,attempt,name,recipe,nonce) }
public fun intent_hash(i:&Intent):vector<u8>{ output_data::intent_hash(i) }
public fun intent_protocol(i:&Intent):ID{ output_data::intent_protocol(i) }
public fun intent_maker(i:&Intent):ID{ output_data::intent_maker(i) }
public fun intent_version(i:&Intent):u64{ output_data::intent_version(i) }
public fun intent_policy(i:&Intent):vector<u8>{ output_data::intent_policy(i) }
public fun intent_output_policy(i:&Intent):vector<u8>{ output_data::intent_output_policy(i) }
public fun intent_actor(i:&Intent):address{ output_data::intent_actor(i) }
public fun intent_attempt(i:&Intent):vector<u8>{ output_data::intent_attempt(i) }
public fun intent_name(i:&Intent):String{ output_data::intent_name(i) }
public fun intent_recipe(i:&Intent):vector<u8>{ output_data::intent_recipe(i) }
public fun intent_nonce(i:&Intent):vector<u8>{ output_data::intent_nonce(i) }
public fun assert_intent(i:&Intent,protocol:ID,maker:ID,version:u64,policy_hash:vector<u8>,p:&Policy,actor:address) { output_data::assert_intent(i,protocol,maker,version,policy_hash,p,actor) }
public fun selection(source:Source,layout:Layout,adapter:Option<Adapter>):Selection{ output_data::selection(source,layout,adapter) }
public fun slot(part:vector<u8>,selection:Option<Selection>):RecipeSlot{ output_data::slot(part,selection) }
public fun scoped_slot(part:PartKey,selection:Option<Selection>):RecipeSlot{ output_data::scoped_slot(part,selection) }
public fun slot_part(s:&RecipeSlot):PartKey{ output_data::slot_part(s) }
public fun slot_selection(s:&RecipeSlot):Option<Selection>{ output_data::slot_selection(s) }
public fun selection_source(s:&Selection):&Source{ output_data::selection_source(s) }
public fun selection_layout(s:&Selection):Layout{ output_data::selection_layout(s) }
public fun selection_adapter(s:&Selection):Option<Adapter>{ output_data::selection_adapter(s) }
/// No freshly-issued Item or module IDs: callers can hash the exact fixed-Style
/// source/layout/adapter selections before paying to register ciphertext.
public fun recipe_hash(scene:&Scene,colors:&vector<ColorChoice>,slots:vector<RecipeSlot>):vector<u8>{ output_data::recipe_hash(scene,colors,slots) }
public fun profile_recipe_hash(scene:&Scene,colors:&vector<ColorChoice>,profiles:vector<ProfileSnapshot>,slots:vector<RecipeSlot>):vector<u8>{ output_data::profile_recipe_hash(scene,colors,profiles,slots) }
public fun content_id(i:&Intent,kind:u32,name:String):vector<u8> { output_data::content_id(i,kind,name) }
public fun render_id(i:&Intent):vector<u8>{ output_data::render_id(i) }
public fun recovery_id(i:&Intent):vector<u8>{ output_data::recovery_id(i) }
public fun pay_line(product:ID,version:u64,policy_hash:vector<u8>,receipt:PrimaryReceipt):PayLine { output_data::pay_line(product,version,policy_hash,receipt) }
public fun receipt(lines:vector<PayLine>,platform_recipient:address,fee_revision:u64):Receipt { output_data::receipt(lines,platform_recipient,fee_revision) }
public fun total_paid(r:&Receipt):u128{ output_data::total_paid(r) }
public fun pay_lines(r:&Receipt):&vector<PayLine>{ output_data::pay_lines(r) }
public fun platform_recipient(r:&Receipt):address{ output_data::platform_recipient(r) }
public fun fee_revision(r:&Receipt):u64{ output_data::fee_revision(r) }
public fun line_product(l:&PayLine):ID{ output_data::line_product(l) }
public fun line_version(l:&PayLine):u64{ output_data::line_version(l) }
public fun line_policy_hash(l:&PayLine):vector<u8>{ output_data::line_policy_hash(l) }
public fun line_beneficiary(l:&PayLine):address{ output_data::line_beneficiary(l) }
public fun line_gross(l:&PayLine):u64{ output_data::line_gross(l) }
public fun line_platform(l:&PayLine):u64{ output_data::line_platform(l) }
public fun line_fixed(l:&PayLine):u64{ output_data::line_fixed(l) }
public fun line_receipt(l:&PayLine):PrimaryReceipt{ output_data::line_receipt(l) }
public fun receipt_hash(r:&Receipt):vector<u8>{ output_data::receipt_hash(r) }
public fun new(creation:Creation,intent:Intent,policy:Policy,recipe:vector<RecipeSlot>,scene:Scene,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,published:vector<Profile>,blob:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,receipt:Receipt,ctx:&mut TxContext):Artifact {
    let Creation{controller,intent:authorized_intent}=creation;
    assert!(authorized_intent==intent_hash(&intent) && intent_actor(&intent)==ctx.sender() && intent_output_policy(&intent)==policy_hash(&policy),EIntent);
    let root=authority::root(&controller);
    assert!(profile_recipe_hash(&scene,&colors,profiles,recipe)==intent_recipe(&intent) && renderer(&policy)==visual::renderer(&scene),ERecipe);
    let render=storage::certified(&blob,system,sha256);
    if(protected(&policy))assert!(!envelope.is_empty() && envelope.length()<=65536,EProtection) else assert!(envelope.is_empty(),EProtection);
    let seal_id=if(protected(&policy))option::some(render_id(&intent)) else option::none();
    let mut profile_scenes=table::new(ctx);profiles.do_ref!(|snapshot|{let scope=assembly::snapshot_scope(snapshot);let mut found=option::none();published.do_ref!(|p|{if(assembly::profile_scope(p)==scope)found=option::some(*p)});let p=found.destroy_some();assert!(assembly::snapshot_scene(snapshot)==visual::scene_hash(assembly::profile_scene(&p)),ERecipe);profile_scenes.add(scope,p)});let recipe=paged_store::from_values(recipe,ctx);let mut artifact=Artifact{id:object::new(ctx),controller,root,intent,policy,recipe,scene,colors,render,seal_id,receipt,materializations:table::new(ctx)};dof::add(&mut artifact.id,OriginalProfilesKey{},OriginalProfiles{id:object::new(ctx),profiles,profile_scenes});dof::add(&mut artifact.id,RecoveryEnvelopeKey{},RecoveryEnvelope{id:object::new(ctx),bytes:envelope});assert!(bcs::to_bytes(&artifact).length()<=245760,ERecipe);dof::add(&mut artifact.id,RenderKey{},blob);artifact
}
public fun materialization(a:&Artifact,key:vector<u8>):Option<vector<u8>>{if(a.materializations.contains(key))option::some(*a.materializations.borrow(key)) else option::none()}
public fun reserve_materialization<W:drop>(w:W,a:&mut Artifact,key:vector<u8>,commitment:vector<u8>) {
    authority::assert_operator(w,&a.controller);policy::assert_key(&key);policy::assert_hash(&commitment);assert!(!a.materializations.contains(key),ERecipe);a.materializations.add(key,commitment)
}
public fun root(a:&Artifact):ID{a.root}
public fun artifact_intent(a:&Artifact):&Intent{&a.intent}
public fun artifact_policy(a:&Artifact):&Policy{&a.policy}
public fun original_recipe(a:&Artifact):vector<RecipeSlot>{paged_store::values(&a.recipe)}
public fun original_slot_count(a:&Artifact):u64{paged_store::length(&a.recipe)}
public fun original_slot(a:&Artifact,index:u64):&RecipeSlot{paged_store::get(&a.recipe,index)}
public fun original_scene(a:&Artifact):&Scene{&a.scene}
public fun original_colors(a:&Artifact):vector<ColorChoice>{a.colors}
public fun original_recipe_hash(a:&Artifact):vector<u8>{profile_recipe_hash(&a.scene,&a.colors,original_profiles(a),original_recipe(a))}
public fun render(a:&Artifact):&Reference{&a.render}
public fun artifact_receipt(a:&Artifact):&Receipt{&a.receipt}
public fun seal_id(a:&Artifact):Option<vector<u8>>{a.seal_id}
public fun envelope(a:&Artifact):&vector<u8>{let e:&RecoveryEnvelope=dof::borrow(&a.id,RecoveryEnvelopeKey{});&e.bytes}
public fun render_end_epoch(a:&Artifact):u32{walrus::blob::end_epoch(dof::borrow<RenderKey,Blob>(&a.id,RenderKey{}))}
public fun extend_render<W:drop>(w:W,a:&mut Artifact,extension:Storage,system:&System) {
    authority::assert_operator(w,&a.controller);walrus::system::extend_blob_with_resource(system,dof::borrow_mut(&mut a.id,RenderKey{}),extension)
}
public fun assert_read<W:drop>(w:W,a:&Artifact,id:vector<u8>,system:&System) {
    authority::assert_operator(w,&a.controller);assert!(protected(&a.policy) && a.seal_id==option::some(id),EProtection);
    let blob:&Blob=dof::borrow(&a.id,RenderKey{});storage::assert_current(&a.render,blob,system)
}

public fun original_profiles(a:&Artifact):vector<ProfileSnapshot>{let p:&OriginalProfiles=dof::borrow(&a.id,OriginalProfilesKey{});p.profiles}
public fun original_profile(a:&Artifact,scope:Scope):&Profile{let p:&OriginalProfiles=dof::borrow(&a.id,OriginalProfilesKey{});p.profile_scenes.borrow(scope)}
