/// Owned standard root. No public UID, module removal, idle Free inventory or fresh root return.
module soulidity_application::character;
use soulidity_custody::lifecycle;

use std::string::String;
use std::type_name::{Self,TypeName};
use soulidity_maker_admission::maker_issuance::{Self as issuance,Genesis,Contribution};
use soulidity_standard::soul::{Self as standard,Soul};
use std::bcs;
use sui::dynamic_object_field as dof;
use sui::table::{Self,Table};
use sui::event;
use sui::clock::{Self,Clock};
use soulidity_model::policy::{Self,Source,Layout,Adapter};
use soulidity_model::components::{Self as item,Item,Permit};
use soulidity_content::document::{Self,Record};
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_transport::storage_transport as storage;
use walrus::blob::{Self,Blob};
use walrus::system::{Self,System};
use walrus::storage_resource::Storage;
use soulidity_content::paid_access::{Self,Ledger};
use soulidity_content::state_configuration::{Self,Configuration};
use soulidity_foundation::economics::{Self,Config,PrimaryReceipt};
use soulidity_maker_terms::maker_resale::{Self as resale,Snapshot};
use sui::coin::Coin;
use soulidity_application::output::{Self,Artifact};
use soulidity_maker_publication::output_data::{RecipeSlot,InitialRule,Intent};
use soulidity_content::authorization::{Self,Authorization,Grant,CleanupTarget};
use soulidity_content::loadout::{Self,Library,Capture,Head};
use soulidity_model::assembly::{Self,State,Profile,Scope,PartKey,ProfileSnapshot,Equipped,Variant};
use soulidity_visual::visual::{Self,Scene,ColorChoice,Layer,Fact};

// Schema 2 is the incompatible cross-Scene semantics boundary. Older code
// closes with schema 1, so Standard's monotonic commit guard rolls it back.
// Schema 3 commits optional state-configuration contents. Old schema-2 writers
// must not replace the semantic commitment while omitting these actual children.
const MODULE_SCHEMA:u16=3;
const ERevision:u64=1;const EPart:u64=2;const ERights:u64=3;const ECapacity:u64=4;
const EAdapter:u64=6;const EBound:u64=7;const EOwner:u64=8;
const EGrant:u64=9;const EContent:u64=10;
const EAlreadyHeld:u64=11;const EEnhancement:u64=12;const EAuthority:u64=13;const EDraft:u64=14;
use soulidity_transport::paged_transport::{Self as paged_store,Store};

public struct ApplicationState has key,store {id:UID,root:ID,revision:u64,recipe_hash:vector<u8>,operator:TypeName}
/// Private constructor; permanent application namespace, never an asset root.
public struct ApplicationWitness has drop {}
/// Private constructor; binds content libraries to the actual application carrier.
public struct ContentOperator has drop {}
public struct Core has key,store {id:UID,protocol:ID,maker:ID,maker_version:u64,creator:address,collection:Option<ID>,manifest:vector<u8>,configuration:vector<u8>,genesis:vector<u8>,resale:Snapshot,beneficiary:address}
public struct Composition has key,store {id:UID,revision:u64,assembly:State,required:vector<vector<u8>>,slots:Table<PartKey,StoredBinding>,references:Store<Source>,colors:vector<ColorChoice>,enhancements:Table<EnhancementKey,EnhancementReceipt>}
public struct EnhancementKey has copy,drop,store {product:ID,actor:address,attempt:vector<u8>}
/// A compact permanent receipt, not a transferable licence or issuance witness.
public struct EnhancementReceipt has copy,drop,store {soul:ID,product:ID,version:u64,policy:vector<u8>,actor:address,attempt:vector<u8>,before_revision:u64,after_revision:u64,before_recipe:vector<u8>,after_recipe:vector<u8>,choices:vector<u8>,payment:PrimaryReceipt}
public struct RootVisual has key,store {id:UID,scene:Scene,adapters:vector<Adapter>}
public struct RootVisualKey has copy,drop,store {}
/// Original publication stays in RootVisual. Each active creator mapping is a
/// separate Table field; this view metadata never owns or duplicates Items.
public struct ActiveVariants has key,store {id:UID,scopes:vector<Scope>,values:Table<Scope,Variant>}
public struct ActiveVariantsKey has copy,drop,store {}
public struct VariantRecipeCommitment has drop {domain:vector<u8>,base:vector<u8>,variants:vector<vector<u8>>}
public struct BoundParts has key,store {id:UID,records:Store<Source>}
public struct Content has key,store {id:UID,versions:Table<u64,Record>,count:u64,counts:Table<ContentName,u64>,indices:Table<ContentVersionKey,u64>,names_by_kind:Table<u32,u64>,active:Table<u32,u64>,attempts:Table<vector<u8>,u64>}
public struct ContentName has copy,drop,store {kind:u32,name:String}
public struct ContentVersionKey has copy,drop,store {kind:u32,name:String,version:u64}
public struct ContentBlobKey has copy,drop,store {index:u64}
public struct ContentChanged has copy,drop {soul:ID,index:Option<u64>,kind:u32,operation:u8,revision:u64}
public struct CoreKey has copy,drop,store {}
public struct CompositionKey has copy,drop,store {}
public struct BoundPartsKey has copy,drop,store {}
public struct AuthorizationKey has copy,drop,store {}
public struct ContentKey has copy,drop,store {}
public struct PaidAccessKey has copy,drop,store {}
public struct OutputKey has copy,drop,store {}
public struct LoadoutKey has copy,drop,store {}
public struct StateConfigurationKey has copy,drop,store {}
public struct StateConfigurationChanged has copy,drop {soul:ID,configuration:ID,updater:address,key:String,deleted:bool,revision:u64,commitment:vector<u8>}
public struct ItemKey has copy,drop,store {id:ID}
/// Stored slots locate the actual Item or permanent Soul-owned record.
/// Binding remains the complete public value view, reconstructed from custody.
public struct StoredBinding has copy,drop,store {reference:Option<u64>,layout:Layout,item:Option<ID>,bound:Option<u64>,adapter:Option<Adapter>}
public struct Binding has copy,drop,store {source:Source,layout:Layout,item:Option<ID>,bound:Option<u64>,adapter:Option<Adapter>}
/// Commit each complete Source separately rather than recursively embedding its
/// full fragment/program tree in a bundle. Exact data remains queryable below.
public struct SourceSnapshot has copy,drop,store {source_hash:vector<u8>,product:ID,maker:ID,maker_version:u64,version:u64,definition:vector<u8>,representation:vector<u8>,rights:u8}
public struct BindingSnapshot has copy,drop,store {source:SourceSnapshot,layout:Layout,item:Option<ID>,bound:Option<u64>,adapter:Option<vector<u8>>}
public struct SlotSnapshot has copy,drop,store {part:PartKey,binding:Option<BindingSnapshot>}
public struct Manifest has copy,drop,store {standard_revision:u64,standard_manifest:vector<u8>,soul:ID,revision:u64,creator:address,collection:Option<ID>,resale:Snapshot,recipe_hash:vector<u8>,core:ID,composition:ID,composition_revision:u64,bound_module:ID,authorization:ID,content:ID,paid_access:ID,output:ID,loadout:ID,enhancement_table:ID,enhancement_count:u64,bound:vector<SourceSnapshot>,references:vector<SourceSnapshot>,slots:vector<SlotSnapshot>,scene:Scene,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>}
public struct CompositionCommitment has drop {domain:vector<u8>,schema:u16,scene:vector<u8>,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,slots:vector<SlotSnapshot>}
public enum Selection has copy,drop,store {Empty,Reference{index:u64,layout:Layout},Bound{index:u64,layout:Layout},Free{id:ID,layout:Layout}}
public struct DesiredSlot has copy,drop,store {part:PartKey,selection:Selection}
public struct Changed has copy,drop {soul:ID,revision:u64,recipe_hash:vector<u8>,operation:u8,item:Option<ID>}
public struct Created has copy,drop {soul:ID,maker:ID,maker_version:u64,recipe_hash:vector<u8>}

fun state_new(root:&Soul,operator:TypeName,protocol:ID,maker:ID,maker_version:u64,manifest:vector<u8>,configuration:vector<u8>,profile:Profile,required:vector<vector<u8>>,adapters:vector<Adapter>,scene:Scene,resale:Snapshot,beneficiary:address,ctx:&mut TxContext):ApplicationState {
    policy::assert_hash(&manifest);policy::assert_hash(&configuration);
    assert!(resale::protocol(&resale)==protocol && resale::maker(&resale)==maker && resale::version(&resale)==maker_version && resale::oc_creator(&resale)==ctx.sender(),EOwner);
    let mut s=ApplicationState{id:object::new(ctx),root:object::id(root),revision:0,recipe_hash:vector[],operator};
    dof::add(&mut s.id,CoreKey{},Core{id:object::new(ctx),protocol,maker,maker_version,creator:ctx.sender(),collection:option::none(),manifest,configuration,genesis:vector[],resale,beneficiary});
    assert!(assembly::scope_product(&assembly::profile_scope(&profile))==maker && assembly::scope_version(&assembly::profile_scope(&profile))==maker_version && *assembly::profile_scene(&profile)==scene,EPart);let assembly=assembly::new(&profile,ctx);let colors=visual::default_colors(&scene);let mut composition=Composition{id:object::new(ctx),revision:0,assembly,required,slots:table::new(ctx),references:paged_store::new(ctx),colors,enhancements:table::new(ctx)};let root_visual=RootVisual{id:object::new(ctx),scene,adapters};assert!(bcs::to_bytes(&root_visual).length()<=245760,ECapacity);dof::add(&mut composition.id,RootVisualKey{},root_visual);dof::add(&mut s.id,CompositionKey{},composition);
    dof::add(&mut s.id,BoundPartsKey{},BoundParts{id:object::new(ctx),records:paged_store::new(ctx)});
    let auth=authorization::new(ContentOperator{},&s,root,ctx);dof::add(&mut s.id,AuthorizationKey{},auth);
    let library=loadout::new(ContentOperator{},&s,root,ctx);dof::add(&mut s.id,LoadoutKey{},library);
    dof::add(&mut s.id,ContentKey{},Content{id:object::new(ctx),versions:table::new(ctx),count:0,counts:table::new(ctx),indices:table::new(ctx),names_by_kind:table::new(ctx),active:table::new(ctx),attempts:table::new(ctx)});
    let ledger=paid_access::new(ContentOperator{},&s,root,protocol,ctx);dof::add(&mut s.id,PaidAccessKey{},ledger);s
}
fun state_finish(s:&mut ApplicationState) {
    state_validate_recipe(s);assert!(dof::exists_with_type<OutputKey,Artifact>(&s.id,OutputKey{}),EContent);
    assert!(state_content_version_count(s,0,document::soul_doc_name())==1 && state_content_version_count(s,1,document::memory_name())>=1,EContent);
    s.revision=0;let hash=state_recipe_commitment(s);s.recipe_hash=hash;
    let soul_id=s.root;let core:&mut Core=dof::borrow_mut(&mut s.id,CoreKey{});core.genesis=hash;
    event::emit(Created{soul:soul_id,maker:core.maker,maker_version:core.maker_version,recipe_hash:hash});
}
fun state_core(s:&ApplicationState):&Core {dof::borrow(&s.id,CoreKey{})}
fun state_composition(s:&ApplicationState):&Composition {dof::borrow(&s.id,CompositionKey{})}
fun state_composition_revision(s:&ApplicationState):u64{state_composition(s).revision}
fun state_reserve_materialization(s:&mut ApplicationState,key:vector<u8>,commitment:vector<u8>,expected:u64) {
    state_assert_revision(s,expected);assert!(state_semantic_recipe_hash(s)==output::original_recipe_hash(state_original_output(s)),EContent);
    let a:&mut Artifact=dof::borrow_mut(&mut s.id,OutputKey{});output::reserve_materialization(ContentOperator{},a,key,commitment);s.revision=s.revision+1
}
fun state_reference_count(s:&ApplicationState):u64{paged_store::length(&state_composition(s).references)}
fun state_reference_source(s:&ApplicationState,index:u64):&Source{paged_store::get(&state_composition(s).references,index)}
fun state_loadouts(s:&ApplicationState):&Library{dof::borrow(&s.id,LoadoutKey{})}
fun state_bound_parts(s:&ApplicationState):&BoundParts {dof::borrow(&s.id,BoundPartsKey{})}
fun state_authorization(s:&ApplicationState):&Authorization {dof::borrow(&s.id,AuthorizationKey{})}
fun state_content(s:&ApplicationState):&Content {dof::borrow(&s.id,ContentKey{})}
fun state_protocol(s:&ApplicationState):ID {state_core(s).protocol}
fun state_maker(s:&ApplicationState):ID {state_core(s).maker}
fun state_maker_version(s:&ApplicationState):u64 {state_core(s).maker_version}
fun state_creator(s:&ApplicationState):address{state_core(s).creator}
fun state_collection_id(s:&ApplicationState):Option<ID>{state_core(s).collection}
fun state_bind_collection(s:&mut ApplicationState,id:ID,expected:u64) {
    state_assert_revision(s,expected);let c:&mut Core=dof::borrow_mut(&mut s.id,CoreKey{});assert!(c.collection.is_none(),EOwner);c.collection.fill(id);s.revision=s.revision+1
}
fun state_revision(s:&ApplicationState):u64 {s.revision}
fun state_recipe_hash(s:&ApplicationState):vector<u8>{s.recipe_hash}
fun state_generation(s:&ApplicationState):u64 {authorization::generation(state_authorization(s))}
fun state_resale(s:&ApplicationState):&Snapshot{&state_core(s).resale}
fun state_beneficiary(s:&ApplicationState):address {state_core(s).beneficiary}
fun state_bound_count(s:&ApplicationState):u64{paged_store::length(&state_bound_parts(s).records)}
fun stored_binding(reference:Option<u64>,layout:Layout,item:Option<ID>,bound:Option<u64>,adapter:Option<Adapter>):StoredBinding {
    let n=(if(reference.is_some())1 else 0)+(if(item.is_some())1 else 0)+(if(bound.is_some())1 else 0);assert!(n==1,ERights);
    StoredBinding{reference,layout,item,bound,adapter}
}
fun stored_source(s:&ApplicationState,b:&StoredBinding):&Source {
    if(b.item.is_some())item::source(dof::borrow<ItemKey,Item>(&s.id,ItemKey{id:*b.item.borrow()}))
    else if(b.bound.is_some())state_bound_source(s,*b.bound.borrow())
    else state_reference_source(s,*b.reference.borrow())
}
fun state_binding_scoped(s:&ApplicationState,part:PartKey):Option<Binding>{
    let c=state_composition(s);if(c.slots.contains(part)){let b=c.slots.borrow(part);option::some(Binding{source:*stored_source(s,b),layout:b.layout,item:b.item,bound:b.bound,adapter:b.adapter})} else option::none()
}
fun state_free_id(b:&Binding):Option<ID>{b.item}
fun state_binding_source(b:&Binding):&Source{&b.source}
fun state_binding_layout(b:&Binding):Layout{b.layout}
fun state_bound_source(s:&ApplicationState,index:u64):&Source {paged_store::get(&state_bound_parts(s).records,index)}
fun state_assert_revision(s:&ApplicationState,expected:u64){assert!(s.revision==expected,ERevision)}
fun state_slot_snapshots(s:&ApplicationState):vector<SlotSnapshot>{
    state_slot_snapshots_with_composition(s,state_composition(s))
}
fun state_slot_snapshots_with_composition(s:&ApplicationState,c:&Composition):vector<SlotSnapshot>{
    let mut slots=vector[];
    assembly::parts(&c.assembly).do_ref!(|p| {
        let binding=if(c.slots.contains(*p)){
            let b=c.slots.borrow(*p);
            let source=if(b.item.is_some())item::source(dof::borrow<ItemKey,Item>(&s.id,ItemKey{id:*b.item.borrow()}))
                else if(b.bound.is_some())state_bound_source(s,*b.bound.borrow())
                else paged_store::get(&c.references,*b.reference.borrow());
            option::some(BindingSnapshot{source:state_source_snapshot(source),layout:b.layout,item:b.item,bound:b.bound,adapter:b.adapter.map_ref!(|a|policy::hash_bytes(bcs::to_bytes(a)))})
        } else option::none();
        slots.push_back(SlotSnapshot{part:*p,binding})
    });slots
}
fun state_manifest(s:&ApplicationState):Manifest {
    let c=state_composition(s);let slots=state_slot_snapshots_with_composition(s,c);let core=state_core(s);let bound=state_bound_parts(s);
    Manifest{standard_revision:0,standard_manifest:vector[],soul:s.root,revision:s.revision,creator:core.creator,collection:core.collection,resale:core.resale,recipe_hash:s.recipe_hash,core:object::id(core),composition:object::id(c),composition_revision:c.revision,bound_module:object::id(bound),authorization:object::id(state_authorization(s)),content:object::id(state_content(s)),paid_access:object::id(state_paid_access(s)),output:object::id(state_original_output(s)),loadout:object::id(state_loadouts(s)),enhancement_table:object::id(&c.enhancements),enhancement_count:c.enhancements.length(),bound:vector::tabulate!(paged_store::length(&bound.records),|i|state_source_snapshot(paged_store::get(&bound.records,i))),references:vector::tabulate!(paged_store::length(&c.references),|i|state_source_snapshot(paged_store::get(&c.references,i))),slots,scene:*state_effective_scene_with_composition(c),colors:c.colors,profiles:assembly::snapshots(&c.assembly)}
}
fun state_source_snapshot(s:&Source):SourceSnapshot{SourceSnapshot{source_hash:policy::source_hash(s),product:policy::source_product(s),maker:policy::source_maker(s),maker_version:policy::maker_version(s),version:policy::source_version(s),definition:policy::source_definition_hash(s),representation:visual::representation_hash(policy::source_representation(s)),rights:policy::rights(s)}}
fun state_manifest_hash(s:&ApplicationState):vector<u8>{policy::hash_bytes(bcs::to_bytes(&state_manifest(s)))}
fun state_manifest_profiles(m:&Manifest):vector<ProfileSnapshot>{m.profiles}
fun state_manifest_slots(m:&Manifest):vector<SlotSnapshot>{m.slots}
fun state_snapshot_part(s:&SlotSnapshot):PartKey{s.part}
fun state_snapshot_binding(s:&SlotSnapshot):Option<BindingSnapshot>{s.binding}
fun state_recipe_commitment(s:&ApplicationState):vector<u8>{
    let c=state_composition(s);let slots=state_slot_snapshots(s);
    // Preserve every mandatory typed child borrow performed by Manifest. Output
    // is deliberately required: an unfinished Draft must keep the original rejection.
    let _=state_core(s);let _=state_bound_parts(s);let _=state_authorization(s);
    let _=state_content(s);let _=state_paid_access(s);let _=state_original_output(s);
    let _=state_loadouts(s);let _=state_enhancement_table(s);let _=state_enhancement_count(s);
    // Unselected permanent inventories are not fields of CompositionCommitment.
    // Their sealed append-only stores and full public Manifest remain unchanged.
    let base=policy::hash_bytes(bcs::to_bytes(&CompositionCommitment{domain:b"soulidity/composition/v1",schema:2,scene:visual::scene_hash(state_effective_scene(s)),colors:c.colors,profiles:assembly::snapshots(&c.assembly),slots}));state_variant_recipe(s,base)
}
/// Exact pre-projection algorithm as a test-only oracle, including full Manifest.
#[test_only]
public fun assert_recipe_commitment_oracle_for_testing(root:&Soul){
    let s=application(root);let expected=state_recipe_commitment_manifest_oracle(s);
    assert!(state_recipe_commitment(s)==expected,ERevision)
}
#[test_only]
fun state_recipe_commitment_manifest_oracle(s:&ApplicationState):vector<u8>{let m=state_manifest(s);let base=policy::hash_bytes(bcs::to_bytes(&CompositionCommitment{domain:b"soulidity/composition/v1",schema:2,scene:visual::scene_hash(&m.scene),colors:m.colors,profiles:m.profiles,slots:m.slots}));state_variant_recipe(s,base)}
fun state_variant_recipe(s:&ApplicationState,base:vector<u8>):vector<u8>{
    let variants=assembly::variant_commitments(&state_visual_variants(s));
    if(variants.is_empty())base else policy::hash_bytes(bcs::to_bytes(&VariantRecipeCommitment{domain:b"soulidity/variant-recipe/v1",base,variants}))
}
fun state_visual_variants(s:&ApplicationState):vector<Variant>{
    let c=state_composition(s);
    if(!dof::exists_with_type<ActiveVariantsKey,ActiveVariants>(&c.id,ActiveVariantsKey{}))return vector[];
    let v:&ActiveVariants=dof::borrow(&c.id,ActiveVariantsKey{});v.scopes.map_ref!(|scope|*v.values.borrow(*scope))
}
fun state_prepare_variants(s:&mut ApplicationState,ctx:&mut TxContext){
    let c=state_composition_mut(s);
    if(!dof::exists_with_type<ActiveVariantsKey,ActiveVariants>(&c.id,ActiveVariantsKey{}))
        dof::add(&mut c.id,ActiveVariantsKey{},ActiveVariants{id:object::new(ctx),scopes:vector[],values:table::new(ctx)})
}
fun state_replace_variants(s:&mut ApplicationState,variants:vector<Variant>){
    assembly::assert_variants(&state_composition(s).assembly,state_scene(s),&variants);
    let variants=assembly::canonical_variants(variants);let c=state_composition_mut(s);
    if(!dof::exists_with_type<ActiveVariantsKey,ActiveVariants>(&c.id,ActiveVariantsKey{})){assert!(variants.is_empty(),EAdapter);return};
    let v:&mut ActiveVariants=dof::borrow_mut(&mut c.id,ActiveVariantsKey{});
    v.scopes.do_ref!(|scope|{v.values.remove(*scope);});v.scopes=vector[];
    variants.do!(|variant|{let scope=assembly::variant_scope(&variant);v.scopes.push_back(scope);v.values.add(scope,variant)})
}
fun state_composition_mut(s:&mut ApplicationState):&mut Composition{dof::borrow_mut(&mut s.id,CompositionKey{})}
fun state_target(s:&ApplicationState,source:&Source,part:PartKey,layout:&Layout):Option<Adapter> {
    let c=state_composition(s);assert!(assembly::parts(&c.assembly).contains(&part),EPart);policy::use_follows_soul(source);
    let root_visual:&RootVisual=dof::borrow(&c.id,RootVisualKey{});
    if(assembly::native_matches(&c.assembly,&root_visual.scene,source,part)){policy::assert_layout(policy::source_bounds(source),layout);option::none()}
    else {let adapters=if(assembly::part_scope(&part).is_none())root_visual.adapters else assembly::profile_adapters(assembly::published_profile(&c.assembly,assembly::part_scope(&part).destroy_some()));
        let mut found=option::none();adapters.do_ref!(|a|{if(policy::adapter_source(a)==policy::source_hash(source) && policy::adapter_part(a)==assembly::part_name(&part))found=option::some(*a)});assert!(found.is_some(),EAdapter);
        visual::assert_mapping(policy::source_representation(source),assembly::target_scene(&c.assembly,&root_visual.scene,part),&policy::adapter_mapping(found.borrow()));policy::assert_layout(policy::source_bounds(source),layout);policy::assert_layout(policy::adapter_bounds(found.borrow()),layout);found}
}
fun state_admit_profile(s:&mut ApplicationState,p:Profile){let base=*state_scene(s);let c=state_composition_mut(s);assembly::admit(&mut c.assembly,&base,p)}
/// Empty visual slots are metadata. Admission issues no asset, access grant,
/// content right or paid Complete entitlement. Mounting still requires a real
/// Item or this ApplicationState's permanent Bound/Reference records and fixed licence.
fun state_admit_pack(s:&mut ApplicationState,profile:Profile,expected:u64):Scope{
    state_assert_revision(s,expected);let scope=assembly::profile_scope(&profile);
    assert!(assembly::scope_protocol(&scope)==state_protocol(s) && assembly::profile_parent(&profile).is_some(),EPart);
    state_admit_profile(s,profile);state_changed(s,12,option::none());scope
}
fun state_parts(s:&ApplicationState):vector<PartKey>{assembly::parts(&state_composition(s).assembly)}
fun state_profile_snapshots(s:&ApplicationState):vector<ProfileSnapshot>{assembly::snapshots(&state_composition(s).assembly)}
fun state_pack_colors(s:&ApplicationState,scope:Scope):vector<ColorChoice>{assembly::pack_colors(&state_composition(s).assembly,scope)}
fun state_set_initial_pack_colors(s:&mut ApplicationState,scope:Scope,colors:vector<ColorChoice>){let base=*state_scene(s);let c=state_composition_mut(s);assembly::set_pack_colors(&mut c.assembly,&base,scope,colors)}
fun state_tune_pack_colors(s:&mut ApplicationState,scope:Scope,colors:vector<ColorChoice>,expected:u64){state_assert_revision(s,expected);state_set_initial_pack_colors(s,scope,colors);state_changed(s,11,option::none())}
fun state_add_issued(s:&mut ApplicationState,permit:Permit,part:PartKey,layout:Layout,ctx:&mut TxContext) {
    let source=*item::preview(&permit);assert!(!state_composition(s).slots.contains(part),EPart);let adapter=state_target(s,&source,part,&layout);
    state_add_issued_target(s,permit,part,layout,adapter,ctx)
}
/// The target was checked against this same source, layout and unchanged assembly
/// immediately before replacing a binding. Removing a slot cannot change that target.
fun state_add_issued_target(s:&mut ApplicationState,permit:Permit,part:PartKey,layout:Layout,adapter:Option<Adapter>,ctx:&mut TxContext) {
    let source=*item::preview(&permit);assert!(!state_composition(s).slots.contains(part),EPart);
    let mode=policy::rights(&source);let mut item_id=option::none();let mut bound=option::none();let mut reference=option::none();
    let (source,issued)=item::materialize(permit,s.root,ctx);
    if(mode==2){let it=issued.destroy_some();let id=object::id(&it);dof::add(&mut s.id,ItemKey{id},it);item_id=option::some(id)}
    else if(mode==1){issued.destroy_none();let records:&mut BoundParts=dof::borrow_mut(&mut s.id,BoundPartsKey{});bound=option::some(paged_store::append(&mut records.records,source))}
    else {issued.destroy_none();assert!(mode==0,ERights);let c=state_composition_mut(s);reference=option::some(paged_store::append(&mut c.references,source));};
    state_composition_mut(s).slots.add(part,stored_binding(reference,layout,item_id,bound,adapter));
}
fun state_remove_binding(s:&mut ApplicationState,part:PartKey):Option<Item> {
    assert!(state_composition(s).slots.contains(part),EPart);let b=state_composition_mut(s).slots.remove(part);
    if(b.item.is_some()){let id=b.item.destroy_some();option::some(dof::remove<ItemKey,Item>(&mut s.id,ItemKey{id}))} else option::none()
}
/// A permanent exact Source already owned by this ApplicationState is remounted through the
/// normal owner API; purchasing it again must not consume quota or supply.
fun state_assert_fresh_issuance(s:&ApplicationState,source:&Source,part:PartKey,layout:&Layout){
    let _=state_fresh_issuance_target(s,source,part,layout);
}
fun state_fresh_issuance_target(s:&ApplicationState,source:&Source,part:PartKey,layout:&Layout):Option<Adapter>{
    let adapter=state_target(s,source,part,layout);let mode=policy::rights(source);
    if(mode==0){let mut i=0;while(i < state_reference_count(s)){assert!(state_reference_source(s,i)!=source,EAlreadyHeld);i=i+1}}
    else if(mode==1){let mut i=0;while(i < state_bound_count(s)){assert!(state_bound_source(s,i)!=source,EAlreadyHeld);i=i+1}}
    else assert!(mode==2,ERights);adapter
}
fun state_replace_issued(s:&mut ApplicationState,permit:Permit,part:PartKey,layout:Layout,ctx:&mut TxContext):Option<Item>{
    let source=*item::preview(&permit);
    let adapter=state_fresh_issuance_target(s,&source,part,&layout);
    let previous=if(state_composition(s).slots.contains(part))state_remove_binding(s,part) else option::none();
    state_add_issued_target(s,permit,part,layout,adapter,ctx);previous
}
fun state_finish_enhancement(s:&mut ApplicationState,product:ID,version:u64,policy:vector<u8>,before_revision:u64,before_recipe:vector<u8>,choices:vector<u8>,payment:PrimaryReceipt,ctx:&TxContext){
    state_assert_revision(s,before_revision);policy::assert_hash(&choices);policy::assert_hash(&policy);
    assert!(economics::primary_receipt_subject(&payment)==s.root && economics::primary_receipt_actor(&payment)==ctx.sender() && economics::primary_receipt_revenue(&payment)==option::some(product) && economics::primary_receipt_commitment(&payment)==policy,EEnhancement);
    let attempt=economics::primary_receipt_attempt(&payment);let key=EnhancementKey{product,actor:ctx.sender(),attempt};assert!(!state_composition(s).enhancements.contains(key),EEnhancement);
    state_validate_recipe(s);state_record_change(s,13,option::none());
    let record=EnhancementReceipt{soul:s.root,product,version,policy,actor:ctx.sender(),attempt,before_revision,after_revision:s.revision,before_recipe,after_recipe:state_semantic_recipe_hash(s),choices,payment};
    state_composition_mut(s).enhancements.add(key,record)
}
fun state_enhancement_count(s:&ApplicationState):u64{state_composition(s).enhancements.length()}
fun state_enhancement_table(s:&ApplicationState):ID{object::id(&state_composition(s).enhancements)}
fun state_enhancement_receipt(s:&ApplicationState,product:ID,actor:address,attempt:vector<u8>):Option<EnhancementReceipt>{let k=EnhancementKey{product,actor,attempt};if(state_composition(s).enhancements.contains(k))option::some(*state_composition(s).enhancements.borrow(k)) else option::none()}
fun state_enhancement_product(r:&EnhancementReceipt):ID{r.product}
fun state_enhancement_version(r:&EnhancementReceipt):u64{r.version}
fun state_enhancement_actor(r:&EnhancementReceipt):address{r.actor}
fun state_enhancement_before_revision(r:&EnhancementReceipt):u64{r.before_revision}
fun state_enhancement_after_revision(r:&EnhancementReceipt):u64{r.after_revision}
fun state_enhancement_before_recipe(r:&EnhancementReceipt):vector<u8>{r.before_recipe}
fun state_enhancement_after_recipe(r:&EnhancementReceipt):vector<u8>{r.after_recipe}
fun state_enhancement_choices(r:&EnhancementReceipt):vector<u8>{r.choices}
fun state_enhancement_payment(r:&EnhancementReceipt):PrimaryReceipt{r.payment}
fun state_attach_scoped(s:&mut ApplicationState,it:Item,part:PartKey,layout:Layout,expected:u64) {
    state_assert_revision(s,expected);assert!(!state_composition(s).slots.contains(part),EPart);state_attach_impl(s,it,part,layout);state_changed(s,1,option::none())
}
fun state_attach_impl(s:&mut ApplicationState,it:Item,part:PartKey,layout:Layout) {
    let source=*item::source(&it);let adapter=state_target(s,&source,part,&layout);let id=object::id(&it);
    assert!(policy::rights(&source)==2,ERights);dof::add(&mut s.id,ItemKey{id},it);
    state_composition_mut(s).slots.add(part,stored_binding(option::none(),layout,option::some(id),option::none(),adapter));
}
/// Returned old object must be consumed by the same PTB. Atomic abort restores both objects.
fun state_replace_scoped(s:&mut ApplicationState,it:Item,part:PartKey,layout:Layout,expected:u64):Option<Item> {
    state_assert_revision(s,expected);let previous=if(state_composition(s).slots.contains(part))state_remove_binding(s,part) else option::none();
    state_attach_impl(s,it,part,layout);state_changed(s,2,option::none());previous
}
fun state_detach_scoped(s:&mut ApplicationState,part:PartKey,expected:u64):Item {
    state_assert_revision(s,expected);let b=state_binding_scoped(s,part);assert!(b.is_some() && b.borrow().item.is_some(),ERights);
    let it=state_remove_binding(s,part).destroy_some();state_changed(s,3,option::some(object::id(&it)));it
}
fun state_clear_reference_scoped(s:&mut ApplicationState,part:PartKey,expected:u64) {
    state_assert_revision(s,expected);let b=state_binding_scoped(s,part);assert!(b.is_some() && policy::rights(&b.borrow().source)==0,ERights);
    state_remove_binding(s,part).destroy_none();state_changed(s,4,option::none())
}
fun state_unmount_bound_scoped(s:&mut ApplicationState,part:PartKey,expected:u64) {
    state_assert_revision(s,expected);let b=state_binding_scoped(s,part);assert!(b.is_some() && b.borrow().bound.is_some(),ERights);
    state_remove_binding(s,part).destroy_none();state_changed(s,5,option::none())
}
fun state_remount_bound_scoped(s:&mut ApplicationState,index:u64,part:PartKey,layout:Layout,expected:u64) {
    state_assert_revision(s,expected);assert!(!state_composition(s).slots.contains(part) && index < state_bound_count(s),EBound);
    assembly::parts(&state_composition(s).assembly).do_ref!(|p| {let b=state_binding_scoped(s,*p);if(b.is_some())assert!(b.borrow().bound!=option::some(index),EBound)});
    let source=*state_bound_source(s,index);let adapter=state_target(s,&source,part,&layout);
    state_composition_mut(s).slots.add(part,stored_binding(option::none(),layout,option::none(),option::some(index),adapter));state_changed(s,6,option::none())
}
fun state_tune_scoped(s:&mut ApplicationState,part:PartKey,layout:Layout,expected:u64) {
    state_assert_revision(s,expected);let b=state_binding_scoped(s,part).destroy_some();let adapter=state_target(s,&b.source,part,&layout);
    let slot=state_composition_mut(s).slots.borrow_mut(part);slot.layout=layout;slot.adapter=adapter;state_changed(s,7,option::none())
}
fun state_remount_reference_scoped(s:&mut ApplicationState,index:u64,part:PartKey,layout:Layout,expected:u64) {
    state_assert_revision(s,expected);assert!(!state_composition(s).slots.contains(part) && index < state_reference_count(s),ERights);
    let source=*state_reference_source(s,index);
    assembly::parts(&state_composition(s).assembly).do_ref!(|p|{let b=state_binding_scoped(s,*p);if(b.is_some())assert!(b.borrow().source!=source,ERights)});
    let adapter=state_target(s,&source,part,&layout);
    state_composition_mut(s).slots.add(part,stored_binding(option::some(index),layout,option::none(),option::none(),adapter));state_changed(s,8,option::none())
}
fun state_empty_slot_scoped(part:PartKey):DesiredSlot{DesiredSlot{part,selection:Selection::Empty}}
fun state_reference_slot_scoped(part:PartKey,index:u64,layout:Layout):DesiredSlot{DesiredSlot{part,selection:Selection::Reference{index,layout}}}
fun state_bound_slot_scoped(part:PartKey,index:u64,layout:Layout):DesiredSlot{DesiredSlot{part,selection:Selection::Bound{index,layout}}}
fun state_free_slot_scoped(part:PartKey,id:ID,layout:Layout):DesiredSlot{DesiredSlot{part,selection:Selection::Free{id,layout}}}
/// Full final selection in canonical Part order. Temporary removals do not check
/// cross-Part rules; the final composition does. Every Free object is conserved.
/// Supplied wallet Items and detached Items not selected are returned to the PTB.
fun state_apply_loadout(s:&mut ApplicationState,slots:vector<DesiredSlot>,mut items:vector<Item>,expected:u64,expected_recipe:vector<u8>):vector<Item> {
    state_assert_revision(s,expected);assert!(s.recipe_hash==expected_recipe,ERevision);
    let parts=assembly::parts(&state_composition(s).assembly);assert!(slots.length()==parts.length() && items.length()<=512,ECapacity);
    let mut n=0;while(n < parts.length()){assert!(slots[n].part==parts[n],EPart);n=n+1};
    parts.do_ref!(|p|{if(state_composition(s).slots.contains(*p)){let it=state_remove_binding(s,*p);if(it.is_some())items.push_back(it.destroy_some()) else it.destroy_none()}});
    let mut used_refs=vector[];let mut used_bound=vector[];
    slots.do_ref!(|slot|match(slot.selection){
        Selection::Empty=>(),
        Selection::Reference{index,layout}=>{
            assert!(index < state_reference_count(s) && !used_refs.contains(&index),ERights);used_refs.push_back(index);
            let source=*state_reference_source(s,index);let adapter=state_target(s,&source,slot.part,&layout);
            state_composition_mut(s).slots.add(slot.part,stored_binding(option::some(index),layout,option::none(),option::none(),adapter))
        },
        Selection::Bound{index,layout}=>{
            assert!(index < state_bound_count(s) && !used_bound.contains(&index),EBound);used_bound.push_back(index);
            let source=*state_bound_source(s,index);let adapter=state_target(s,&source,slot.part,&layout);
            state_composition_mut(s).slots.add(slot.part,stored_binding(option::none(),layout,option::none(),option::some(index),adapter))
        },
        Selection::Free{id,layout}=>{
            let mut found=option::none();let mut i=0;
            while(i < items.length()){if(object::id(&items[i])==id){assert!(found.is_none(),ERights);found=option::some(i)};i=i+1};
            assert!(found.is_some(),ERights);let it=items.swap_remove(found.destroy_some());state_attach_impl(s,it,slot.part,layout)
        },
    });
    state_changed(s,9,option::none());items
}
fun state_loadouts_mut(s:&mut ApplicationState):&mut Library{dof::borrow_mut(&mut s.id,LoadoutKey{})}
fun state_loadout_capture(s:&ApplicationState):Capture{loadout::capture(object::id(state_composition(s)),state_composition_revision(s),s.recipe_hash)}
fun state_current_loadout_head(s:&ApplicationState,ctx:&TxContext):Option<Head>{loadout::head(state_loadouts(s),ctx.sender(),state_generation(s))}
fun state_loadout_seal_id(s:&ApplicationState,owner:address):vector<u8>{loadout::seal_id(state_loadouts(s),owner,state_generation(s))}
fun state_seal_approve_loadout(id:vector<u8>,s:&ApplicationState,expected_generation:u64,ctx:&TxContext) {
    assert!(state_generation(s)==expected_generation,ERevision);loadout::approve(ContentOperator{},id,state_loadouts(s),ctx.sender(),state_generation(s))
}
fun state_approve_loadout_for(id:vector<u8>,s:&ApplicationState,owner:address,expected_generation:u64) {
    assert!(state_generation(s)==expected_generation,ERevision);loadout::approve(ContentOperator{},id,state_loadouts(s),owner,state_generation(s))
}
fun state_save_loadout(s:&mut ApplicationState,capture:Capture,blob:Blob,system:&System,sha256:vector<u8>,request:vector<u8>,expected_generation:u64,expected_library:u64,expected_soul:u64,ctx:&TxContext):u64 {
    state_assert_revision(s,expected_soul);assert!(state_generation(s)==expected_generation,ERevision);
    loadout::assert_capture(&capture,object::id(state_composition(s)),state_composition_revision(s),s.recipe_hash);
    state_commit_loadout(s,option::some(capture),blob,system,sha256,request,expected_library,ctx)
}
/// Rename/delete/renew encrypted JSON. This does not change equipment or licences.
fun state_update_loadout(s:&mut ApplicationState,blob:Blob,system:&System,sha256:vector<u8>,request:vector<u8>,expected_generation:u64,expected_library:u64,expected_soul:u64,ctx:&TxContext):u64 {
    state_assert_revision(s,expected_soul);assert!(state_generation(s)==expected_generation,ERevision);
    state_commit_loadout(s,option::none(),blob,system,sha256,request,expected_library,ctx)
}
fun state_commit_loadout(s:&mut ApplicationState,capture:Option<Capture>,blob:Blob,system:&System,sha256:vector<u8>,request:vector<u8>,expected_library:u64,ctx:&TxContext):u64 {
    let generation=state_generation(s);let revision=loadout::commit(ContentOperator{},state_loadouts_mut(s),ctx.sender(),generation,expected_library,request,blob,system,sha256,capture);
    s.revision=s.revision+1;revision
}
fun state_extend_loadout(s:&mut ApplicationState,receipt_owner:address,receipt_generation:u64,request:vector<u8>,extension:Storage,system:&System,expected:u64) {
    state_assert_revision(s,expected);loadout::extend(ContentOperator{},state_loadouts_mut(s),receipt_owner,receipt_generation,request,extension,system);s.revision=s.revision+1
}
fun state_purge_loadout(s:&mut ApplicationState,receipt_owner:address,receipt_generation:u64,request:vector<u8>,expected:u64,ctx:&TxContext) {
    state_assert_revision(s,expected);let generation=state_generation(s);
    loadout::purge(ContentOperator{},state_loadouts_mut(s),ctx.sender(),generation,receipt_owner,receipt_generation,request);s.revision=s.revision+1
}
fun state_validate_recipe(s:&ApplicationState) {
    let _=state_validated_render_plan(s);
}
fun state_validated_render_plan(s:&ApplicationState):vector<Layer>{
    let c=state_composition(s);c.required.do_ref!(|p|assert!(c.slots.contains(assembly::root_part(*p)),EPart));state_rules_and_render(s)
}
fun state_validate_rules(s:&ApplicationState) {let _=state_rules_and_render(s);}
fun state_rules_and_render(s:&ApplicationState):vector<Layer>{
    let c=state_composition(s);let equipped=state_equipped(s);
    let hashes=equipped.map_ref!(|e|policy::source_definition_hash(assembly::equipped_source(e)));
    equipped.do_ref!(|e|policy::assert_rules(assembly::equipped_source(e),&hashes));
    assembly::render_variants(&c.assembly,state_scene(s),&c.colors,&equipped,&state_visual_variants(s))
}
fun state_changed(s:&mut ApplicationState,operation:u8,item:Option<ID>) {
    // Asset exits must remain available even when a dependency or anchor becomes
    // unsatisfied. The remaining ApplicationState explicitly fails validate_recipe/render_plan.
    if(operation!=3 && operation!=4 && operation!=5)state_validate_rules(s);state_record_change(s,operation,item)
}
/// Record only after the caller has performed its required validation. Enhancement
/// already validates the complete recipe, including the same rules and render plan.
fun state_record_change(s:&mut ApplicationState,operation:u8,item:Option<ID>) {
    s.revision=s.revision+1;let c=state_composition_mut(s);c.revision=c.revision+1;s.recipe_hash=state_recipe_commitment(s);
    event::emit(Changed{soul:s.root,revision:s.revision,recipe_hash:s.recipe_hash,operation,item})
}
/// Modules holding a ApplicationState must enforce their own container ownership. No caller-supplied owner.
fun state_grant(s:&mut ApplicationState,grantee:address,scope:u64,expiry:Option<u64>,expected:u64,expected_slot:Option<vector<u8>>,clock:&Clock,ctx:&TxContext):u64 {
    state_assert_revision(s,expected);let sequence=authorization::issue(ContentOperator{},state_authorization_mut(s),grantee,scope,expiry,expected_slot,clock,ctx);s.revision=s.revision+1;sequence
}
fun state_revoke(s:&mut ApplicationState,grantee:address,expected:u64,expected_slot:vector<u8>) {
    state_assert_revision(s,expected);authorization::revoke(ContentOperator{},state_authorization_mut(s),grantee,expected_slot);s.revision=s.revision+1
}
fun state_revoke_grant_scope(s:&mut ApplicationState,grantee:address,revoked:u64,expected:u64,expected_slot:vector<u8>,clock:&Clock,ctx:&TxContext):u64 {
    state_assert_revision(s,expected);let sequence=authorization::revoke_scope(ContentOperator{},state_authorization_mut(s),grantee,revoked,expected_slot,clock,ctx);s.revision=s.revision+1;sequence
}
fun state_set_grant_capacity(s:&mut ApplicationState,capacity:u64,expected_capacity:u64,expected:u64) {
    state_assert_revision(s,expected);authorization::set_capacity(ContentOperator{},state_authorization_mut(s),capacity,expected_capacity);s.revision=s.revision+1
}
fun state_cleanup_grants(s:&mut ApplicationState,targets:vector<CleanupTarget>,expected:u64,clock:&Clock,ctx:&TxContext):u64 {
    state_assert_revision(s,expected);let removed=authorization::cleanup(ContentOperator{},state_authorization_mut(s),targets,clock,ctx);if(removed>0)s.revision=s.revision+1;removed
}
fun state_grant_capacity(s:&ApplicationState):u64{authorization::capacity(state_authorization(s))}
fun state_grant_record(s:&ApplicationState,grantee:address):Option<Grant>{authorization::grant(state_authorization(s),grantee)}
fun state_grant_hash(s:&ApplicationState,grantee:address):Option<vector<u8>>{authorization::grant_hash(state_authorization(s),grantee)}
fun state_grant_live(s:&ApplicationState,grantee:address,clock:&Clock,ctx:&TxContext):bool{authorization::live(ContentOperator{},state_authorization(s),grantee,ctx.sender(),clock)}
fun state_assert_grant_snapshot(s:&ApplicationState,expected_generation:u64,expected_capacity:u64,expected_count:u64,grantee:address,expected_slot:Option<vector<u8>>,expected_live:bool,clock:&Clock,ctx:&TxContext) {
    authorization::assert_snapshot(ContentOperator{},state_authorization(s),expected_generation,expected_capacity,expected_count,grantee,expected_slot,expected_live,ctx.sender(),clock)
}
fun state_assert_preserves_grant_scopes(s:&ApplicationState,grantee:address,desired:u64,clock:&Clock,ctx:&TxContext) {
    authorization::assert_preserves_active_scopes(ContentOperator{},state_authorization(s),grantee,desired,ctx.sender(),clock)
}
fun state_authorization_mut(s:&mut ApplicationState):&mut Authorization{dof::borrow_mut(&mut s.id,AuthorizationKey{})}
fun state_clear_authorizations(s:&mut ApplicationState) {
    authorization::clear(ContentOperator{},state_authorization_mut(s));s.revision=s.revision+1;
}
/// Owner authentication comes from the mutable owned ApplicationState input or certified container.
fun state_append_content(s:&mut ApplicationState,registry:&KindRegistry,kind:u32,name:String,read_mask:u64,download_policy:u8,blob:Blob,system:&System,sha256:vector<u8>,nonce:vector<u8>,envelope:vector<u8>,expected_version:u64,expected_soul:u64,attempt:vector<u8>,clock:&Clock):u64 {
    state_append_content_impl(s,registry,kind,name,read_mask,download_policy,blob,system,sha256,nonce,envelope,expected_version,expected_soul,attempt,clock,false)
}
fun state_content_mut(s:&mut ApplicationState):&mut Content{dof::borrow_mut(&mut s.id,ContentKey{})}
fun state_append_content_impl(s:&mut ApplicationState,registry:&KindRegistry,kind:u32,name:String,read_mask:u64,download_policy:u8,blob:Blob,system:&System,sha256:vector<u8>,nonce:vector<u8>,envelope:vector<u8>,expected_version:u64,expected_soul:u64,attempt:vector<u8>,clock:&Clock,initial:bool):u64 {
    state_assert_revision(s,expected_soul);policy::assert_hash(&attempt);
    let reference=storage::certified(&blob,system,sha256);
    let c=state_content(s);assert!(!c.attempts.contains(attempt),EContent);
    let key=ContentName{kind,name};let version=if(c.counts.contains(key))*c.counts.borrow(key) else 0;
    assert!(version==expected_version,ERevision);
    let record=document::new(kind_registry::borrow_descriptor(registry,kind),name,version,reference,read_mask,download_policy,nonce,envelope,clock::timestamp_ms(clock),initial);
    let c=state_content_mut(s);let index=c.count;
    dof::add(&mut c.id,ContentBlobKey{index},blob);
    c.versions.add(index,record);c.count=index+1;c.attempts.add(attempt,index);
    c.indices.add(ContentVersionKey{kind,name,version},index);
    if(version==0){if(c.names_by_kind.contains(kind)){let n=c.names_by_kind.borrow_mut(kind);*n=*n+1} else c.names_by_kind.add(kind,1)};
    if(c.counts.contains(key))*c.counts.borrow_mut(key)=version+1 else c.counts.add(key,1);
    state_content_changed(s,kind,option::some(index),0);index
}
fun state_content_version_count(s:&ApplicationState,kind:u32,name:String):u64 {
    let c=state_content(s);let key=ContentName{kind,name};if(c.counts.contains(key))*c.counts.borrow(key) else 0
}
fun state_content_index(s:&ApplicationState,kind:u32,name:String,version:u64):Option<u64> {
    let c=state_content(s);let key=ContentVersionKey{kind,name,version};if(c.indices.contains(key))option::some(*c.indices.borrow(key)) else option::none()
}
fun state_content_names_for_kind(s:&ApplicationState,kind:u32):u64{let c=state_content(s);if(c.names_by_kind.contains(kind))*c.names_by_kind.borrow(kind) else 0}
fun state_content_count(s:&ApplicationState):u64{state_content(s).count}
fun state_content_record(s:&ApplicationState,index:u64):&Record {assert!(index < state_content_count(s),EContent);state_content(s).versions.borrow(index)}
fun state_content_id(s:&ApplicationState):ID{object::id(state_content(s))}
fun state_content_receipt(s:&ApplicationState,attempt:vector<u8>):Option<u64>{let c=state_content(s);if(c.attempts.contains(attempt))option::some(*c.attempts.borrow(attempt)) else option::none()}
fun state_active_content(s:&ApplicationState,kind:u32):Option<u64>{let c=state_content(s);if(c.active.contains(kind))option::some(*c.active.borrow(kind)) else option::none()}
fun state_set_active_content(s:&mut ApplicationState,index:u64,expected_active:Option<u64>,expected_soul:u64) {
    state_assert_revision(s,expected_soul);let r=state_content_record(s,index);document::assert_live(r);document::assert_operation(r,kind_registry::op_active_bind());let kind=document::kind(r);
    assert!(state_active_content(s,kind)==expected_active,ERevision);
    let c=state_content_mut(s);if(c.active.contains(kind))*c.active.borrow_mut(kind)=index else c.active.add(kind,index);
    state_content_changed(s,kind,option::some(index),1)
}
fun state_clear_active_content(s:&mut ApplicationState,kind:u32,expected_active:u64,expected_soul:u64) {
    state_assert_revision(s,expected_soul);assert!(state_active_content(s,kind)==option::some(expected_active),ERevision);
    state_content_mut(s).active.remove(kind);state_content_changed(s,kind,option::some(expected_active),2)
}
fun state_delete_content(s:&mut ApplicationState,index:u64,expected_soul:u64) {
    state_assert_revision(s,expected_soul);let kind=document::kind(state_content_record(s,index));
    assert!(state_active_content(s,kind)!=option::some(index),EContent);
    document::mark_deleted(state_content_mut(s).versions.borrow_mut(index));state_content_changed(s,kind,option::some(index),3)
}
/// Purge consumes the Blob object; it does not claim to erase already downloaded bytes/keys.
fun state_purge_content(s:&mut ApplicationState,index:u64,expected_soul:u64) {
    state_assert_revision(s,expected_soul);let kind=document::kind(state_content_record(s,index));let c=state_content_mut(s);
    document::mark_purged(c.versions.borrow_mut(index));let stored:Blob=dof::remove(&mut c.id,ContentBlobKey{index});blob::burn(stored);
    state_content_changed(s,kind,option::some(index),4)
}
/// The exact stored object can be extended without a public mutable UID/Blob escape hatch.
fun state_extend_content(s:&mut ApplicationState,index:u64,extension:Storage,system:&System,expected_soul:u64) {
    state_assert_revision(s,expected_soul);let kind=document::kind(state_content_record(s,index));document::assert_live(state_content_record(s,index));
    let c=state_content_mut(s);system::extend_blob_with_resource(system,dof::borrow_mut(&mut c.id,ContentBlobKey{index}),extension);
    state_content_changed(s,kind,option::some(index),5)
}
fun state_content_changed(s:&mut ApplicationState,kind:u32,index:Option<u64>,operation:u8) {
    s.revision=s.revision+1;event::emit(ContentChanged{soul:s.root,index,kind,operation,revision:s.revision})
}
fun state_seal_id(s:&ApplicationState,index:u64):vector<u8>{document::seal_id(state_content_id(s),state_content_record(s,index))}
fun state_seal_approve_owner(id:vector<u8>,s:&ApplicationState,index:u64,system:&System,_ctx:&TxContext) {
    state_assert_content_read(id,s,index,system,kind_registry::read_owner())
}

fun state_grant_count(s:&ApplicationState):u64{authorization::count(state_authorization(s))}
fun state_manifest_bound_count(m:&Manifest):u64{m.bound.length()}

fun state_assert_content_read(id:vector<u8>,s:&ApplicationState,index:u64,system:&System,mode:u64) {
    let r=state_content_record(s,index);document::assert_read(r,mode);assert!(id==state_seal_id(s,index),EContent);
    let stored:&Blob=dof::borrow(&state_content(s).id,ContentBlobKey{index});storage::assert_current(document::reference(r),stored,system)
}
fun state_assert_delegate(s:&ApplicationState,owner:address,grantee:address,scope:u64,clock:&Clock) {
    assert!(authorization::permits(ContentOperator{},state_authorization(s),owner,grantee,scope,clock),EGrant)
}
fun state_content_scope(s:&ApplicationState,index:u64):u64{document::scope(state_content_record(s,index))}

fun state_scope_seal():u64{1}
fun state_scope_memory():u64{2}
fun state_scope_skills():u64{4}
fun state_scope_assets():u64{8}

fun state_paid_access(s:&ApplicationState):&Ledger{dof::borrow(&s.id,PaidAccessKey{})}
fun state_paid_access_mut(s:&mut ApplicationState):&mut Ledger{dof::borrow_mut(&mut s.id,PaidAccessKey{})}
fun state_configure_paid(s:&mut ApplicationState,registry:&KindRegistry,kind:u32,price:u64,scope:u64,duration:Option<u64>,expected_ledger:u64,expected_soul:u64,ctx:&TxContext) {
    state_assert_revision(s,expected_soul);let generation=state_generation(s);
    paid_access::configure(ContentOperator{},state_paid_access_mut(s),registry,kind,price,scope,duration,ctx.sender(),generation,expected_ledger);state_content_changed(s,kind,option::none(),6)
}
fun state_remove_paid_offer(s:&mut ApplicationState,kind:u32,expected_ledger:u64,expected_soul:u64) {
    state_assert_revision(s,expected_soul);paid_access::remove_offer(ContentOperator{},state_paid_access_mut(s),kind,expected_ledger);state_content_changed(s,kind,option::none(),7)
}
fun state_add_paid_access(s:&mut ApplicationState,registry:&KindRegistry,kind:u32,buyer:address,scope:u64,expiry:Option<u64>,expected_ledger:u64,expected_entry:Option<vector<u8>>,expected_soul:u64,clock:&Clock,ctx:&TxContext) {
    state_assert_revision(s,expected_soul);let generation=state_generation(s);
    paid_access::add(ContentOperator{},state_paid_access_mut(s),registry,kind,buyer,scope,expiry,ctx.sender(),generation,expected_ledger,expected_entry,clock);state_content_changed(s,kind,option::none(),8)
}
fun state_revoke_paid_access(s:&mut ApplicationState,kind:u32,buyer:address,expected_ledger:u64,expected_entry:vector<u8>,expected_soul:u64) {
    state_assert_revision(s,expected_soul);paid_access::revoke(ContentOperator{},state_paid_access_mut(s),kind,buyer,expected_ledger,expected_entry);state_content_changed(s,kind,option::none(),9)
}
fun state_cleanup_paid_access(s:&mut ApplicationState,kind:u32,buyer:address,expected_ledger:u64,expected_soul:u64,clock:&Clock,ctx:&TxContext) {
    state_assert_revision(s,expected_soul);let generation=state_generation(s);paid_access::cleanup(ContentOperator{},state_paid_access_mut(s),kind,buyer,ctx.sender(),generation,expected_ledger,clock);state_content_changed(s,kind,option::none(),10)
}
/// Only a certified container supplies actual owner authority for independent buyers.
fun state_buy_paid<C>(s:&mut ApplicationState,cfg:&mut Config<C>,kind:u32,owner:address,expected_soul:u64,quote:vector<u8>,expected_entry:Option<vector<u8>>,fee_revision:u64,expiry:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) {
    state_assert_revision(s,expected_soul);let generation=state_generation(s);
    paid_access::buy(ContentOperator{},state_paid_access_mut(s),cfg,kind,owner,generation,quote,expected_entry,fee_revision,expiry,attempt,payment,clock,ctx);state_content_changed(s,kind,option::none(),11)
}
fun state_assert_paid_read(id:vector<u8>,s:&ApplicationState,index:u64,owner:address,system:&System,clock:&Clock,ctx:&TxContext) {
    state_assert_content_read(id,s,index,system,kind_registry::read_paid());let r=state_content_record(s,index);
    paid_access::assert_access(ContentOperator{},state_paid_access(s),document::kind(r),ctx.sender(),owner,state_generation(s),document::scope(r),clock)
}

fun state_equipped(s:&ApplicationState):vector<Equipped>{let mut e=vector[];state_parts(s).do_ref!(|p|{let b=state_binding_scoped(s,*p);if(b.is_some()){let b=b.destroy_some();e.push_back(assembly::mapped_equipped(*p,b.source,b.layout,b.adapter))}});e}
fun state_semantic_profiles(s:&ApplicationState):vector<ProfileSnapshot>{assembly::active_snapshots(&state_composition(s).assembly,&state_equipped(s))}
fun state_semantic_recipe(s:&ApplicationState):vector<RecipeSlot>{let mut slots=vector[];assembly::active_parts(&state_composition(s).assembly,&state_equipped(s)).do_ref!(|part|{let b=state_binding_scoped(s,*part);let selection=b.map_ref!(|b|output::selection(b.source,b.layout,b.adapter));slots.push_back(output::scoped_slot(*part,selection))});slots}
fun state_semantic_recipe_hash(s:&ApplicationState):vector<u8>{state_variant_recipe(s,output::profile_recipe_hash(state_effective_scene(s),&state_colors(s),state_semantic_profiles(s),state_semantic_recipe(s)))}
fun state_root_visual(s:&ApplicationState):&RootVisual{dof::borrow(&state_composition(s).id,RootVisualKey{})}
fun state_scene(s:&ApplicationState):&Scene{&state_root_visual(s).scene}
fun state_effective_scene(s:&ApplicationState):&Scene{
    let c=state_composition(s);let scope=assembly::root(&c.assembly);
    if(dof::exists_with_type<ActiveVariantsKey,ActiveVariants>(&c.id,ActiveVariantsKey{})){
        let v:&ActiveVariants=dof::borrow(&c.id,ActiveVariantsKey{});
        if(v.values.contains(scope))return assembly::variant_scene(v.values.borrow(scope))
    };state_scene(s)
}
fun state_colors(s:&ApplicationState):vector<ColorChoice>{state_composition(s).colors}
fun state_visual_facts(s:&ApplicationState):vector<Fact>{let mut facts=vector[];state_parts(s).do_ref!(|p|{let b=state_binding_scoped(s,*p);if(b.is_some() && assembly::part_scope(p).is_none())facts.push_back(policy::visual_fact(&b.borrow().source,assembly::part_name(p)))});facts}
fun state_render_plan(s:&ApplicationState):vector<Layer>{let c=state_composition(s);assembly::render_variants(&c.assembly,state_scene(s),&c.colors,&state_equipped(s),&state_visual_variants(s))}
fun state_published_profiles(s:&ApplicationState):vector<Profile>{let c=state_composition(s);assembly::scopes(&c.assembly).map_ref!(|scope|*assembly::published_profile(&c.assembly,*scope))}
fun state_tune_colors(s:&mut ApplicationState,colors:vector<ColorChoice>,expected:u64){state_assert_revision(s,expected);visual::assert_colors(state_scene(s),&colors);state_composition_mut(s).colors=colors;state_changed(s,10,option::none())}
fun state_set_initial_colors(s:&mut ApplicationState,colors:vector<ColorChoice>){visual::assert_colors(state_scene(s),&colors);state_composition_mut(s).colors=colors}
fun state_reset_layout_scoped(s:&mut ApplicationState,part:PartKey,expected:u64){let b=state_binding_scoped(s,part).destroy_some();state_tune_scoped(s,part,policy::default_layout(&b.source),expected)}
fun state_original_output(s:&ApplicationState):&Artifact{dof::borrow(&s.id,OutputKey{})}
fun state_install_output(s:&mut ApplicationState,artifact:Artifact) {
    output::assert_controller(ContentOperator{},&artifact,object::id(s),s.root);assert!(!dof::exists_with_type<OutputKey,Artifact>(&s.id,OutputKey{}),EContent);dof::add(&mut s.id,OutputKey{},artifact)
}
fun state_append_initial_output_content(s:&mut ApplicationState,registry:&KindRegistry,rule:&InitialRule,intent:&Intent,blob:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,clock:&Clock):u64 {
    let kind=output::rule_kind(rule);let name=output::rule_name(rule);assert!(state_content_version_count(s,kind,name)==0,EContent);
    let namespace=output::content_id(intent,kind,name);let attempt=policy::hash_bytes(namespace);
    let expected=state_revision(s);
    let index=state_append_content_impl(s,registry,kind,name,output::rule_read(rule),output::rule_download(rule),blob,system,sha256,output::intent_nonce(intent),envelope,0,expected,attempt,clock,kind==0);
    document::bind_initial_namespace(state_content_mut(s).versions.borrow_mut(index),namespace);index
}
fun state_seal_approve_original_output_owner(id:vector<u8>,s:&ApplicationState,system:&System,_ctx:&TxContext){output::assert_read(ContentOperator{},state_original_output(s),id,system)}
fun state_extend_original_output(s:&mut ApplicationState,extension:Storage,system:&System,expected_soul:u64) {
    state_assert_revision(s,expected_soul);output::extend_render(ContentOperator{},dof::borrow_mut(&mut s.id,OutputKey{}),extension,system);state_content_changed(s,0,option::none(),6)
}
fun state_assert_original_output_read(id:vector<u8>,s:&ApplicationState,system:&System){output::assert_read(ContentOperator{},state_original_output(s),id,system)}

fun state_binding(s:&ApplicationState,part:vector<u8>):Option<Binding>{state_binding_scoped(s,assembly::root_part(part))}
fun state_attach(s:&mut ApplicationState,it:Item,part:vector<u8>,layout:Layout,expected:u64){state_attach_scoped(s,it,assembly::root_part(part),layout,expected)}
fun state_replace(s:&mut ApplicationState,it:Item,part:vector<u8>,layout:Layout,expected:u64):Option<Item> {state_replace_scoped(s,it,assembly::root_part(part),layout,expected)}
fun state_detach(s:&mut ApplicationState,part:vector<u8>,expected:u64):Item {state_detach_scoped(s,assembly::root_part(part),expected)}
fun state_clear_reference(s:&mut ApplicationState,part:vector<u8>,expected:u64){state_clear_reference_scoped(s,assembly::root_part(part),expected)}
fun state_unmount_bound(s:&mut ApplicationState,part:vector<u8>,expected:u64){state_unmount_bound_scoped(s,assembly::root_part(part),expected)}
fun state_remount_bound(s:&mut ApplicationState,index:u64,part:vector<u8>,layout:Layout,expected:u64){state_remount_bound_scoped(s,index,assembly::root_part(part),layout,expected)}
fun state_tune(s:&mut ApplicationState,part:vector<u8>,layout:Layout,expected:u64){state_tune_scoped(s,assembly::root_part(part),layout,expected)}
fun state_remount_reference(s:&mut ApplicationState,index:u64,part:vector<u8>,layout:Layout,expected:u64){state_remount_reference_scoped(s,index,assembly::root_part(part),layout,expected)}
fun state_empty_slot(part:vector<u8>):DesiredSlot{state_empty_slot_scoped(assembly::root_part(part))}
fun state_reference_slot(part:vector<u8>,index:u64,layout:Layout):DesiredSlot{state_reference_slot_scoped(assembly::root_part(part),index,layout)}
fun state_bound_slot(part:vector<u8>,index:u64,layout:Layout):DesiredSlot{state_bound_slot_scoped(assembly::root_part(part),index,layout)}
fun state_free_slot(part:vector<u8>,id:ID,layout:Layout):DesiredSlot{state_free_slot_scoped(assembly::root_part(part),id,layout)}
fun state_reset_layout(s:&mut ApplicationState,part:vector<u8>,expected:u64){state_reset_layout_scoped(s,assembly::root_part(part),expected)}


/// Exactly one non-generic Soul asset type. The application owns its private
/// permanent module and nested records; independent namespaces remain extensible.
fun application(s:&Soul):&ApplicationState {standard::borrow_module<ApplicationWitness,ApplicationState>(s,b"animacraft")}
fun open(s:&mut Soul):(ApplicationState,standard::Edit<ApplicationWitness,ApplicationState>){
    let revision=standard::revision(s);standard::begin_update(s,ApplicationWitness{},b"animacraft",revision)
}
fun close(s:&mut Soul,ticket:standard::Edit<ApplicationWitness,ApplicationState>,state:ApplicationState){
    assert!(state.root==object::id(s),EOwner);let semantic=application_commitment(&state);
    standard::commit_update(s,ticket,ApplicationWitness{},state,MODULE_SCHEMA,semantic)
}
public struct ApplicationCommitment has drop {domain:vector<u8>,root:ID,revision:u64,state:vector<u8>,core:vector<u8>,composition:vector<u8>,visual:vector<u8>,bound:vector<u8>,authorization:vector<u8>,content:vector<u8>,paid:vector<u8>,loadout:vector<u8>,output:Option<vector<u8>>,recipe:Option<vector<u8>>}
fun application_commitment(s:&ApplicationState):vector<u8>{
    let complete=dof::exists_with_type<OutputKey,Artifact>(&s.id,OutputKey{});
    let mut state=bcs::to_bytes(s);let config=if(state_has_configuration(s))option::some(state_configuration::commitment(state_configuration(s))) else option::none();state.append(bcs::to_bytes(&config));
    policy::hash_bytes(bcs::to_bytes(&ApplicationCommitment{domain:b"soulidity/animacraft/state/v2",root:s.root,revision:s.revision,state,core:bcs::to_bytes(state_core(s)),composition:bcs::to_bytes(state_composition(s)),visual:bcs::to_bytes(state_root_visual(s)),bound:bcs::to_bytes(state_bound_parts(s)),authorization:bcs::to_bytes(state_authorization(s)),content:bcs::to_bytes(state_content(s)),paid:bcs::to_bytes(state_paid_access(s)),loadout:bcs::to_bytes(state_loadouts(s)),output:if(complete)option::some(bcs::to_bytes(state_original_output(s))) else option::none(),recipe:if(complete)option::some(state_manifest_hash(s)) else option::none()}))
}
fun state_has_configuration(s:&ApplicationState):bool{dof::exists_with_type<StateConfigurationKey,Configuration>(&s.id,StateConfigurationKey{})}
fun state_configuration(s:&ApplicationState):&Configuration{dof::borrow(&s.id,StateConfigurationKey{})}
fun state_set_configuration(s:&mut ApplicationState,root:&Soul,key:String,value:vector<u8>,ctx:&mut TxContext){
    if(!state_has_configuration(s)){let c=state_configuration::new(ContentOperator{},s,root,ctx);dof::add(&mut s.id,StateConfigurationKey{},c)};
    let parent=object::id(s);let soul=s.root;let c:&mut Configuration=dof::borrow_mut(&mut s.id,StateConfigurationKey{});state_configuration::assert_binding(c,parent,object::id(root));let expected=state_configuration::revision(c);state_configuration::set(ContentOperator{},c,key,value,expected);
    event::emit(StateConfigurationChanged{soul,configuration:object::id(c),updater:ctx.sender(),key,deleted:false,revision:state_configuration::revision(c),commitment:state_configuration::commitment(c)});s.revision=s.revision+1
}
public fun has_state_config(s:&Soul,key:String):bool{let a=application(s);state_has_configuration(a) && state_configuration::contains(state_configuration(a),key)}
public fun state_config(s:&Soul,key:String):&vector<u8>{state_configuration::value(state_configuration(application(s)),key)}
public fun state_config_module(s:&Soul):&Configuration{state_configuration(application(s))}
/// Initial configuration is applied only to a live one-use issuance Draft.
public fun set_initial_state_config(d:&Draft,s:&mut Soul,key:String,value:vector<u8>,ctx:&mut TxContext){
    assert_draft(d,s,ctx);state_configuration::assert_initial_key(&key);let(mut a,ticket)=open(s);state_set_configuration(&mut a,s,key,value,ctx);close(s,ticket,a)
}
/// Actual mutable Soul custody, exact protocol, Primary gate and revision CAS.
public fun set_state_config<C>(s:&mut Soul,cfg:&Config<C>,key:String,value:vector<u8>,expected:u64,ctx:&mut TxContext){
    assert!(protocol(s)==object::id(cfg),EOwner);economics::assert_primary(cfg);assert_revision(s,expected);let(mut a,ticket)=open(s);state_set_configuration(&mut a,s,key,value,ctx);close(s,ticket,a)
}
public fun delete_state_config<C>(s:&mut Soul,cfg:&Config<C>,key:String,expected:u64,ctx:&TxContext){
    assert!(protocol(s)==object::id(cfg),EOwner);economics::assert_primary(cfg);assert_revision(s,expected);let(mut a,ticket)=open(s);let parent=object::id(&a);let soul=a.root;let c:&mut Configuration=dof::borrow_mut(&mut a.id,StateConfigurationKey{});state_configuration::assert_binding(c,parent,object::id(s));let rev=state_configuration::revision(c);state_configuration::delete(ContentOperator{},c,key,rev);
    event::emit(StateConfigurationChanged{soul,configuration:object::id(c),updater:ctx.sender(),key,deleted:true,revision:state_configuration::revision(c),commitment:state_configuration::commitment(c)});a.revision=a.revision+1;close(s,ticket,a)
}
/// Explicit manufacturing-only custody/config route, separate from Native policy.
public fun set_manufacturing_state_config<C,W:drop>(w:W,s:&mut Soul,cfg:&Config<C>,key:String,value:vector<u8>,expected:u64,ctx:&mut TxContext){
    assert_operator(w,s);assert!(protocol(s)==object::id(cfg),EOwner);economics::assert_manufacturing_primary(cfg);assert_revision(s,expected);let(mut a,ticket)=open(s);state_set_configuration(&mut a,s,key,value,ctx);close(s,ticket,a)
}
public fun delete_manufacturing_state_config<C,W:drop>(w:W,s:&mut Soul,cfg:&Config<C>,key:String,expected:u64,ctx:&TxContext){
    assert_operator(w,s);assert!(protocol(s)==object::id(cfg),EOwner);economics::assert_manufacturing_primary(cfg);assert_revision(s,expected);delete_state_config_value(s,key,ctx)
}
fun delete_state_config_value(s:&mut Soul,key:String,ctx:&TxContext){
    let(mut a,ticket)=open(s);let parent=object::id(&a);let soul=a.root;let c:&mut Configuration=dof::borrow_mut(&mut a.id,StateConfigurationKey{});state_configuration::assert_binding(c,parent,object::id(s));let rev=state_configuration::revision(c);state_configuration::delete(ContentOperator{},c,key,rev);
    event::emit(StateConfigurationChanged{soul,configuration:object::id(c),updater:ctx.sender(),key,deleted:true,revision:state_configuration::revision(c),commitment:state_configuration::commitment(c)});a.revision=a.revision+1;close(s,ticket,a)
}

/// These tickets have no abilities: assembly/enhancement must finish atomically.
public struct Draft {root:ID,state:ID,actor:address}
public struct Enhancement {root:ID,state:ID,actor:address,product:ID,version:u64,policy:vector<u8>,before_revision:u64,before_recipe:vector<u8>,payment:PrimaryReceipt}
public struct GenesisMetadata has drop {domain:vector<u8>,protocol:ID,maker:ID,version:u64,manifest:vector<u8>,configuration:vector<u8>,profile:Profile,required:vector<vector<u8>>,adapters:vector<Adapter>,scene:Scene,resale:Snapshot,beneficiary:address,actor:address}
/// Pure metadata commitment; it cannot issue a Genesis or a Soul.
public fun genesis_hash(protocol:ID,maker:ID,version:u64,manifest:vector<u8>,configuration:vector<u8>,profile:Profile,required:vector<vector<u8>>,adapters:vector<Adapter>,scene:Scene,resale:Snapshot,beneficiary:address,ctx:&TxContext):vector<u8>{
    policy::hash_bytes(bcs::to_bytes(&GenesisMetadata{domain:b"soulidity/character/genesis/v1",protocol,maker,version,manifest,configuration,profile,required,adapters,scene,resale,beneficiary,actor:ctx.sender()}))
}
public fun initialize(g:Genesis,root:&mut Soul,protocol:ID,maker:ID,maker_version:u64,manifest:vector<u8>,configuration:vector<u8>,profile:Profile,required:vector<vector<u8>>,adapters:vector<Adapter>,scene:Scene,resale:Snapshot,beneficiary:address,ctx:&mut TxContext):Draft {
    let metadata=genesis_hash(protocol,maker,maker_version,manifest,configuration,profile,required,adapters,scene,resale,beneficiary,ctx);
    let(config,operator)=issuance::consume_genesis(g,root,metadata,ctx);assert!(config==protocol,EOwner);
    let origin=standard::origin(root);assert!(standard::source(&origin)==maker && standard::source_version(&origin)==maker_version && standard::source_hash(&origin)==resale::policy_hash(&resale),EOwner);
    let state=state_new(root,operator,protocol,maker,maker_version,manifest,configuration,profile,required,adapters,scene,resale,beneficiary,ctx);
    let draft=Draft{root:object::id(root),state:object::id(&state),actor:ctx.sender()};
    let semantic=application_commitment(&state);let revision=standard::revision(root);
    lifecycle::install_protected(root,ApplicationWitness{},b"animacraft",state,MODULE_SCHEMA,false,semantic,revision);draft
}
#[test_only]
public fun new(g:Genesis,mut root:Soul,protocol:ID,maker:ID,maker_version:u64,manifest:vector<u8>,configuration:vector<u8>,profile:Profile,required:vector<vector<u8>>,adapters:vector<Adapter>,scene:Scene,resale:Snapshot,beneficiary:address,ctx:&mut TxContext):(Soul,Draft) {let draft=initialize(g,&mut root,protocol,maker,maker_version,manifest,configuration,profile,required,adapters,scene,resale,beneficiary,ctx);(root,draft)}

fun assert_draft(d:&Draft,s:&Soul,ctx:&TxContext){
    let a=application(s);assert!(d.root==object::id(s) && d.state==object::id(a) && d.actor==ctx.sender() && state_core(a).genesis.is_empty(),EDraft)
}
fun assert_operator<W:drop>(_:W,s:&Soul){assert!(application(s).operator==type_name::with_original_ids<W>(),EAuthority)}
public fun finalize(d:Draft,s:&mut Soul,recipient:address,ctx:&TxContext){assert_draft(&d,s,ctx);let Draft{root:_,state:_,actor}=d;assert!(recipient==actor,EDraft);let(mut state,ticket)=open(s);state_finish(&mut state);close(s,ticket,state)}
#[test_only]
public fun finish(d:Draft,mut s:Soul,recipient:address,ctx:&TxContext){finalize(d,&mut s,recipient,ctx);transfer::public_transfer(s,recipient)}

public fun begin_enhancement(c:Contribution,s:&Soul,expected:u64,ctx:&TxContext):Enhancement{
    assert_revision(s,expected);let (product,version,policy,payment)=issuance::consume_contribution(c,s,ctx);
    assert!(economics::primary_policy_config(&economics::primary_receipt_policy(&payment))==protocol(s) && !state_core(application(s)).genesis.is_empty(),EEnhancement);
    Enhancement{root:object::id(s),state:application_module_id(s),actor:ctx.sender(),product,version,policy,before_revision:expected,before_recipe:semantic_recipe_hash(s),payment}
}
/// Read the actual before-recipe metadata captured by this linear enhancement.
/// This borrow grants no issuance, mutation or handover authority.
public fun enhancement_start_recipe(e:&Enhancement):vector<u8>{e.before_recipe}
fun assert_enhancement(e:&Enhancement,s:&Soul,ctx:&TxContext){assert!(e.root==object::id(s) && e.state==application_module_id(s) && e.actor==ctx.sender(),EEnhancement);assert_revision(s,e.before_revision)}
public fun admit_contribution(d:&Draft,s:&mut Soul,c:Contribution,p:Profile,ctx:&TxContext):PrimaryReceipt{
    assert_draft(d,s,ctx);let(product,version,hash,payment)=issuance::consume_contribution(c,s,ctx);let scope=assembly::profile_scope(&p);
    assert!(assembly::scope_product(&scope)==product && assembly::scope_version(&scope)==version && assembly::scope_policy(&scope)==hash && assembly::scope_protocol(&scope)==protocol(s),EEnhancement);
    let(mut state,ticket)=open(s);state_admit_profile(&mut state,p);close(s,ticket,state);payment
}
public fun handover(mut s:Soul,recipient:address,expected:u64){
    assert_revision(&s,expected);assert!(recipient!=@0x0,EOwner);
    let mut h=lifecycle::begin_handover(s);acknowledge_handover(&mut h);
    soulidity_application::vault::acknowledge_handover(&mut h);let _=lifecycle::finish_handover(h,recipient);
}
public fun manifest(s:&Soul):Manifest{
    let mut m=state_manifest(application(s));m.standard_revision=standard::revision(s);m.standard_manifest=standard::manifest_hash(s);m
}
public fun manifest_hash(s:&Soul):vector<u8>{policy::hash_bytes(bcs::to_bytes(&manifest(s)))}
/// Birth provenance is separate from the current mutable composition manifest.
public struct GenesisCommitment has copy,drop,store {domain:vector<u8>,schema:u16,soul:ID,origin:standard::Origin,artifact:ID,output:vector<u8>}
public fun genesis_commitments(s:&Soul):(vector<u8>,vector<u8>){
    let a=state_original_output(application(s));let output=output::original_commitment(a);
    let genesis=policy::hash_bytes(bcs::to_bytes(&GenesisCommitment{domain:b"soulidity/soul-genesis/v1",schema:1,soul:object::id(s),origin:standard::origin(s),artifact:object::id(a),output}));(output,genesis)
}
public fun original_output_commitment(s:&Soul):vector<u8>{let(output,_)=genesis_commitments(s);output}
public fun genesis_commitment(s:&Soul):vector<u8>{let(_,genesis)=genesis_commitments(s);genesis}
/// Discovery includes independently installed modules and distinct nested Souls.
public fun standard_manifest(s:&Soul):standard::Manifest{standard::manifest(s)}
public fun application_module_id(s:&Soul):ID{object::id(application(s))}
public fun manifest_standard_revision(m:&Manifest):u64{m.standard_revision}
public fun manifest_standard_hash(m:&Manifest):vector<u8>{m.standard_manifest}

public fun core(s:&Soul):&Core { state_core(application(s)) }
public fun composition(s:&Soul):&Composition { state_composition(application(s)) }
public fun composition_revision(s:&Soul):u64 { state_composition_revision(application(s)) }
public fun reserve_materialization<W:drop>(w:W,s:&mut Soul,key:vector<u8>,commitment:vector<u8>,expected:u64) { assert_operator(w,s); let (mut state,ticket)=open(s); state_reserve_materialization(&mut state,key,commitment,expected); close(s,ticket,state) }
public fun reference_count(s:&Soul):u64 { state_reference_count(application(s)) }
public fun reference_source(s:&Soul,index:u64):&Source { state_reference_source(application(s),index) }
public fun loadouts(s:&Soul):&Library { state_loadouts(application(s)) }
public fun bound_parts(s:&Soul):&BoundParts { state_bound_parts(application(s)) }
public fun authorization(s:&Soul):&Authorization { state_authorization(application(s)) }
public fun content(s:&Soul):&Content { state_content(application(s)) }
public fun protocol(s:&Soul):ID { state_protocol(application(s)) }
public fun maker(s:&Soul):ID { state_maker(application(s)) }
public fun maker_version(s:&Soul):u64 { state_maker_version(application(s)) }
public fun creator(s:&Soul):address { state_creator(application(s)) }
public fun collection_id(s:&Soul):Option<ID> { state_collection_id(application(s)) }
public fun bind_collection<W:drop>(w:W,s:&mut Soul,id:ID,expected:u64) { assert_operator(w,s); let (mut state,ticket)=open(s); state_bind_collection(&mut state,id,expected); close(s,ticket,state) }
public fun revision(s:&Soul):u64 { state_revision(application(s)) }
public fun recipe_hash(s:&Soul):vector<u8> { state_recipe_hash(application(s)) }
public fun generation(s:&Soul):u64 { state_generation(application(s)) }
public fun resale(s:&Soul):&Snapshot { state_resale(application(s)) }
public fun beneficiary(s:&Soul):address { state_beneficiary(application(s)) }
public fun bound_count(s:&Soul):u64 { state_bound_count(application(s)) }
public fun binding_scoped(s:&Soul,part:PartKey):Option<Binding> { state_binding_scoped(application(s),part) }
public fun free_id(b:&Binding):Option<ID> { state_free_id(b) }
public fun binding_source(b:&Binding):&Source { state_binding_source(b) }
public fun binding_layout(b:&Binding):Layout { state_binding_layout(b) }
#[test_only]
public fun stored_binding_bytes_for_testing(s:&Soul,part:PartKey):u64 {bcs::to_bytes(state_composition(application(s)).slots.borrow(part)).length()}
public fun bound_source(s:&Soul,index:u64):&Source { state_bound_source(application(s),index) }
public fun assert_revision(s:&Soul,expected:u64) { state_assert_revision(application(s),expected) }
public fun source_snapshot(s:&Source):SourceSnapshot { state_source_snapshot(s) }
public fun manifest_profiles(m:&Manifest):vector<ProfileSnapshot> { state_manifest_profiles(m) }
public fun manifest_slots(m:&Manifest):vector<SlotSnapshot> { state_manifest_slots(m) }
public fun snapshot_part(s:&SlotSnapshot):PartKey { state_snapshot_part(s) }
public fun snapshot_binding(s:&SlotSnapshot):Option<BindingSnapshot> { state_snapshot_binding(s) }
public fun admit_profile<W:drop>(w:W,s:&mut Soul,p:Profile) { assert_operator(w,s); let (mut state,ticket)=open(s); state_admit_profile(&mut state,p); close(s,ticket,state) }
public fun admit_pack(s:&mut Soul,profile:Profile,expected:u64):Scope { let (mut state,ticket)=open(s); let result=state_admit_pack(&mut state,profile,expected); close(s,ticket,state); result }
public fun parts(s:&Soul):vector<PartKey> { state_parts(application(s)) }
public fun profile_snapshots(s:&Soul):vector<ProfileSnapshot> { state_profile_snapshots(application(s)) }
public fun pack_colors(s:&Soul,scope:Scope):vector<ColorChoice> { state_pack_colors(application(s),scope) }
public fun set_initial_pack_colors(d:&Draft,s:&mut Soul,scope:Scope,colors:vector<ColorChoice>,ctx:&TxContext) { assert_draft(d,s,ctx); let (mut state,ticket)=open(s); state_set_initial_pack_colors(&mut state,scope,colors); close(s,ticket,state) }
public fun tune_pack_colors(s:&mut Soul,scope:Scope,colors:vector<ColorChoice>,expected:u64) { let (mut state,ticket)=open(s); state_tune_pack_colors(&mut state,scope,colors,expected); close(s,ticket,state) }
public fun add_issued(d:&Draft,s:&mut Soul,permit:Permit,part:PartKey,layout:Layout,ctx:&mut TxContext) { assert_draft(d,s,ctx); let (mut state,ticket)=open(s); state_add_issued(&mut state,permit,part,layout,ctx); close(s,ticket,state) }
public fun assert_fresh_issuance(s:&Soul,source:&Source,part:PartKey,layout:&Layout) { state_assert_fresh_issuance(application(s),source,part,layout) }
public fun replace_issued(e:&Enhancement,s:&mut Soul,permit:Permit,part:PartKey,layout:Layout,ctx:&mut TxContext):Option<Item> { assert_enhancement(e,s,ctx);let src=item::preview(&permit);assert!(policy::source_product(src)==e.product && policy::source_version(src)==e.version,EEnhancement); let (mut state,ticket)=open(s); let result=state_replace_issued(&mut state,permit,part,layout,ctx); close(s,ticket,state); result }
public fun finish_enhancement(e:Enhancement,s:&mut Soul,choices:vector<u8>,ctx:&TxContext) { assert_enhancement(&e,s,ctx);let Enhancement{root:_,state:_,actor:_,product,version,policy,before_revision,before_recipe,payment}=e;let (mut state,ticket)=open(s);state_finish_enhancement(&mut state,product,version,policy,before_revision,before_recipe,choices,payment,ctx);close(s,ticket,state) }
public fun enhancement_count(s:&Soul):u64 { state_enhancement_count(application(s)) }
public fun enhancement_table(s:&Soul):ID { state_enhancement_table(application(s)) }
public fun enhancement_receipt(s:&Soul,product:ID,actor:address,attempt:vector<u8>):Option<EnhancementReceipt> { state_enhancement_receipt(application(s),product,actor,attempt) }
public fun enhancement_product(r:&EnhancementReceipt):ID { state_enhancement_product(r) }
public fun enhancement_version(r:&EnhancementReceipt):u64 { state_enhancement_version(r) }
public fun enhancement_actor(r:&EnhancementReceipt):address { state_enhancement_actor(r) }
public fun enhancement_before_revision(r:&EnhancementReceipt):u64 { state_enhancement_before_revision(r) }
public fun enhancement_after_revision(r:&EnhancementReceipt):u64 { state_enhancement_after_revision(r) }
public fun enhancement_before_recipe(r:&EnhancementReceipt):vector<u8> { state_enhancement_before_recipe(r) }
public fun enhancement_after_recipe(r:&EnhancementReceipt):vector<u8> { state_enhancement_after_recipe(r) }
public fun enhancement_choices(r:&EnhancementReceipt):vector<u8> { state_enhancement_choices(r) }
public fun enhancement_payment(r:&EnhancementReceipt):PrimaryReceipt { state_enhancement_payment(r) }
public fun attach_scoped(s:&mut Soul,it:Item,part:PartKey,layout:Layout,expected:u64) { let (mut state,ticket)=open(s); state_attach_scoped(&mut state,it,part,layout,expected); close(s,ticket,state) }
public fun replace_scoped(s:&mut Soul,it:Item,part:PartKey,layout:Layout,expected:u64):Option<Item> { let (mut state,ticket)=open(s); let result=state_replace_scoped(&mut state,it,part,layout,expected); close(s,ticket,state); result }
public fun detach_scoped(s:&mut Soul,part:PartKey,expected:u64):Item { let (mut state,ticket)=open(s); let result=state_detach_scoped(&mut state,part,expected); close(s,ticket,state); result }
public fun clear_reference_scoped(s:&mut Soul,part:PartKey,expected:u64) { let (mut state,ticket)=open(s); state_clear_reference_scoped(&mut state,part,expected); close(s,ticket,state) }
public fun unmount_bound_scoped(s:&mut Soul,part:PartKey,expected:u64) { let (mut state,ticket)=open(s); state_unmount_bound_scoped(&mut state,part,expected); close(s,ticket,state) }
public fun remount_bound_scoped(s:&mut Soul,index:u64,part:PartKey,layout:Layout,expected:u64) { let (mut state,ticket)=open(s); state_remount_bound_scoped(&mut state,index,part,layout,expected); close(s,ticket,state) }
public fun tune_scoped(s:&mut Soul,part:PartKey,layout:Layout,expected:u64) { let (mut state,ticket)=open(s); state_tune_scoped(&mut state,part,layout,expected); close(s,ticket,state) }
public fun remount_reference_scoped(s:&mut Soul,index:u64,part:PartKey,layout:Layout,expected:u64) { let (mut state,ticket)=open(s); state_remount_reference_scoped(&mut state,index,part,layout,expected); close(s,ticket,state) }
public fun empty_slot_scoped(part:PartKey):DesiredSlot { state_empty_slot_scoped(part) }
public fun reference_slot_scoped(part:PartKey,index:u64,layout:Layout):DesiredSlot { state_reference_slot_scoped(part,index,layout) }
public fun bound_slot_scoped(part:PartKey,index:u64,layout:Layout):DesiredSlot { state_bound_slot_scoped(part,index,layout) }
public fun free_slot_scoped(part:PartKey,id:ID,layout:Layout):DesiredSlot { state_free_slot_scoped(part,id,layout) }
public fun apply_loadout(s:&mut Soul,slots:vector<DesiredSlot>,items:vector<Item>,expected:u64,expected_recipe:vector<u8>):vector<Item> { let (mut state,ticket)=open(s); let result=state_apply_loadout(&mut state,slots,items,expected,expected_recipe); close(s,ticket,state); result }
/// Freeze selections only. These copies cannot issue an Item or change its Style.
public fun capture_slots(s:&Soul):vector<DesiredSlot> {
    let state=application(s);let c=state_composition(state);
    state_parts(state).map_ref!(|part|{
        if(!c.slots.contains(*part))state_empty_slot_scoped(*part)
        else {let b=c.slots.borrow(*part);
            if(b.item.is_some())state_free_slot_scoped(*part,*b.item.borrow(),b.layout)
            else if(b.bound.is_some())state_bound_slot_scoped(*part,*b.bound.borrow(),b.layout)
            else state_reference_slot_scoped(*part,*b.reference.borrow(),b.layout)
        }
    })
}
public fun desired_part(slot:&DesiredSlot):PartKey{slot.part}
/// Restore equipment and palettes together. Validating each intermediate outfit
/// would reject otherwise-valid cross-Part/colour transitions. The final state
/// still uses the normal custody, fixed-Style, adapter and creator rule guards.
public fun apply_visual_loadout(s:&mut Soul,slots:vector<DesiredSlot>,items:vector<Item>,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,expected:u64,expected_recipe:vector<u8>):vector<Item> {
    let(mut state,ticket)=open(s);
    let result=state_apply_visual_loadout(&mut state,slots,items,colors,profiles,expected,expected_recipe);
    close(s,ticket,state);result
}
fun state_apply_visual_loadout(state:&mut ApplicationState,slots:vector<DesiredSlot>,items:vector<Item>,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,expected:u64,expected_recipe:vector<u8>):vector<Item>{
    state_assert_revision(state,expected);assert!(state.recipe_hash==expected_recipe,ERevision);
    state_set_initial_colors(state,colors);let mut scopes=vector[];
    profiles.do_ref!(|snapshot|{
        let scope=assembly::snapshot_scope(snapshot);assert!(!scopes.contains(&scope),EPart);scopes.push_back(scope);
        state_set_initial_pack_colors(state,scope,assembly::snapshot_colors(snapshot));
        assert!(state_profile_snapshots(state).contains(snapshot),EPart)
    });
    let result=state_apply_loadout(state,slots,items,expected,expected_recipe);
    state_validate_recipe(state);result
}
/// One atomic view/equipment update, with original Source eligibility and real
/// Item custody. No intermediate outfit is validated or published.
public fun apply_variant_loadout(s:&mut Soul,variants:vector<Variant>,slots:vector<DesiredSlot>,items:vector<Item>,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,expected:u64,expected_recipe:vector<u8>,ctx:&mut TxContext):vector<Item>{
    assert_revision(s,expected);assert!(recipe_hash(s)==expected_recipe,ERevision);
    let(mut state,ticket)=open(s);
    if(!variants.is_empty())state_prepare_variants(&mut state,ctx);
    state_replace_variants(&mut state,variants);
    let result=state_apply_visual_loadout(&mut state,slots,items,colors,profiles,expected,expected_recipe);
    close(s,ticket,state);result
}
/// A saved nonempty form necessarily originated from an existing ActiveVariants
/// carrier on this same Soul. Restoring its Table entries needs no new object.
public fun restore_variant_loadout(s:&mut Soul,variants:vector<Variant>,slots:vector<DesiredSlot>,items:vector<Item>,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,expected:u64,expected_recipe:vector<u8>):vector<Item>{
    let(mut state,ticket)=open(s);state_assert_revision(&state,expected);
    assert!(state.recipe_hash==expected_recipe,ERevision);state_replace_variants(&mut state,variants);
    let result=state_apply_visual_loadout(&mut state,slots,items,colors,profiles,expected,expected_recipe);
    close(s,ticket,state);result
}
public fun loadout_capture(s:&Soul):Capture { state_loadout_capture(application(s)) }
public fun current_loadout_head(s:&mut Soul,ctx:&TxContext):Option<Head> { state_current_loadout_head(application(s),ctx) }
public fun loadout_seal_id(s:&Soul,owner:address):vector<u8> { state_loadout_seal_id(application(s),owner) }
public fun seal_approve_loadout(id:vector<u8>,s:&mut Soul,expected_generation:u64,ctx:&TxContext) { state_seal_approve_loadout(id,application(s),expected_generation,ctx) }
public fun approve_loadout_for<W:drop>(w:W,id:vector<u8>,s:&Soul,owner:address,expected_generation:u64) { assert_operator(w,s); state_approve_loadout_for(id,application(s),owner,expected_generation) }
public fun save_loadout(s:&mut Soul,capture:Capture,blob:Blob,system:&System,sha256:vector<u8>,request:vector<u8>,expected_generation:u64,expected_library:u64,expected_soul:u64,ctx:&TxContext):u64 { let (mut state,ticket)=open(s); let result=state_save_loadout(&mut state,capture,blob,system,sha256,request,expected_generation,expected_library,expected_soul,ctx); close(s,ticket,state); result }
public fun update_loadout(s:&mut Soul,blob:Blob,system:&System,sha256:vector<u8>,request:vector<u8>,expected_generation:u64,expected_library:u64,expected_soul:u64,ctx:&TxContext):u64 { let (mut state,ticket)=open(s); let result=state_update_loadout(&mut state,blob,system,sha256,request,expected_generation,expected_library,expected_soul,ctx); close(s,ticket,state); result }
public fun extend_loadout(s:&mut Soul,receipt_owner:address,receipt_generation:u64,request:vector<u8>,extension:Storage,system:&System,expected:u64) { let (mut state,ticket)=open(s); state_extend_loadout(&mut state,receipt_owner,receipt_generation,request,extension,system,expected); close(s,ticket,state) }
public fun purge_loadout(s:&mut Soul,receipt_owner:address,receipt_generation:u64,request:vector<u8>,expected:u64,ctx:&TxContext) { let (mut state,ticket)=open(s); state_purge_loadout(&mut state,receipt_owner,receipt_generation,request,expected,ctx); close(s,ticket,state) }
public fun validate_recipe(s:&Soul) { state_validate_recipe(application(s)) }
public fun validated_render_plan(s:&Soul):vector<Layer>{state_validated_render_plan(application(s))}
public fun grant(s:&mut Soul,grantee:address,scope:u64,expiry:Option<u64>,expected:u64,expected_slot:Option<vector<u8>>,clock:&Clock,ctx:&TxContext):u64 { let (mut state,ticket)=open(s); let result=state_grant(&mut state,grantee,scope,expiry,expected,expected_slot,clock,ctx); close(s,ticket,state); result }
public fun revoke(s:&mut Soul,grantee:address,expected:u64,expected_slot:vector<u8>) { let (mut state,ticket)=open(s); state_revoke(&mut state,grantee,expected,expected_slot); close(s,ticket,state) }
public fun revoke_grant_scope(s:&mut Soul,grantee:address,revoked:u64,expected:u64,expected_slot:vector<u8>,clock:&Clock,ctx:&TxContext):u64 { let (mut state,ticket)=open(s); let result=state_revoke_grant_scope(&mut state,grantee,revoked,expected,expected_slot,clock,ctx); close(s,ticket,state); result }
public fun set_grant_capacity(s:&mut Soul,capacity:u64,expected_capacity:u64,expected:u64) { let (mut state,ticket)=open(s); state_set_grant_capacity(&mut state,capacity,expected_capacity,expected); close(s,ticket,state) }
public fun cleanup_grants(s:&mut Soul,targets:vector<CleanupTarget>,expected:u64,clock:&Clock,ctx:&TxContext):u64 { let (mut state,ticket)=open(s); let result=state_cleanup_grants(&mut state,targets,expected,clock,ctx); close(s,ticket,state); result }
public fun grant_capacity(s:&Soul):u64 { state_grant_capacity(application(s)) }
public fun grant_record(s:&Soul,grantee:address):Option<Grant> { state_grant_record(application(s),grantee) }
public fun grant_hash(s:&Soul,grantee:address):Option<vector<u8>> { state_grant_hash(application(s),grantee) }
public fun grant_live(s:&mut Soul,grantee:address,clock:&Clock,ctx:&TxContext):bool { state_grant_live(application(s),grantee,clock,ctx) }
public fun assert_grant_snapshot(s:&mut Soul,expected_generation:u64,expected_capacity:u64,expected_count:u64,grantee:address,expected_slot:Option<vector<u8>>,expected_live:bool,clock:&Clock,ctx:&TxContext) { state_assert_grant_snapshot(application(s),expected_generation,expected_capacity,expected_count,grantee,expected_slot,expected_live,clock,ctx) }
public fun assert_preserves_grant_scopes(s:&mut Soul,grantee:address,desired:u64,clock:&Clock,ctx:&TxContext) { state_assert_preserves_grant_scopes(application(s),grantee,desired,clock,ctx) }
/// Explicit protocol handover revokes this application's delegations throughout
/// native nested Souls. Unknown extension protocols keep their own auth rules.
/// Bound work prevents unbounded recursion; cancel/unnest remain available.
public fun clear_authorizations(s:&mut Soul) {let _=clear_tree_authorizations(s,0,256);}
fun clear_tree_authorizations(s:&mut Soul,depth:u64,budget:u64):u64 {
    assert!(depth<=16 && budget>0,ECapacity);let mut used=1;
    if(standard::descriptor<ApplicationWitness>(s,b"animacraft").is_some()) {
        let (mut state,ticket)=open(s);state_clear_authorizations(&mut state);close(s,ticket,state)
    };
    let children=standard::module_page(s,0,64);
    children.do_ref!(|d| {
        if(standard::namespace(d)==std::type_name::with_defining_ids<standard::NestedSoulWitness>()) {
            assert!(used < budget,ECapacity);let rev=standard::revision(s);
            let (mut child,ticket)=standard::begin_nested_update(s,standard::module_id(d),rev);
            used=used+clear_tree_authorizations(&mut child,depth+1,budget-used);
            standard::commit_nested_update(s,ticket,child)
        }
    });used
}
public fun append_content(s:&mut Soul,registry:&KindRegistry,kind:u32,name:String,read_mask:u64,download_policy:u8,blob:Blob,system:&System,sha256:vector<u8>,nonce:vector<u8>,envelope:vector<u8>,expected_version:u64,expected_soul:u64,attempt:vector<u8>,clock:&Clock):u64 { let (mut state,ticket)=open(s); let result=state_append_content(&mut state,registry,kind,name,read_mask,download_policy,blob,system,sha256,nonce,envelope,expected_version,expected_soul,attempt,clock); close(s,ticket,state); result }
public fun content_version_count(s:&Soul,kind:u32,name:String):u64 { state_content_version_count(application(s),kind,name) }
public fun content_index(s:&Soul,kind:u32,name:String,version:u64):Option<u64> { state_content_index(application(s),kind,name,version) }
public fun content_names_for_kind(s:&Soul,kind:u32):u64 { state_content_names_for_kind(application(s),kind) }
public fun content_count(s:&Soul):u64 { state_content_count(application(s)) }
public fun content_record(s:&Soul,index:u64):&Record { state_content_record(application(s),index) }
public fun content_id(s:&Soul):ID { state_content_id(application(s)) }
public fun content_receipt(s:&Soul,attempt:vector<u8>):Option<u64> { state_content_receipt(application(s),attempt) }
public fun active_content(s:&Soul,kind:u32):Option<u64> { state_active_content(application(s),kind) }
public fun set_active_content(s:&mut Soul,index:u64,expected_active:Option<u64>,expected_soul:u64) { let (mut state,ticket)=open(s); state_set_active_content(&mut state,index,expected_active,expected_soul); close(s,ticket,state) }
public fun clear_active_content(s:&mut Soul,kind:u32,expected_active:u64,expected_soul:u64) { let (mut state,ticket)=open(s); state_clear_active_content(&mut state,kind,expected_active,expected_soul); close(s,ticket,state) }
public fun delete_content(s:&mut Soul,index:u64,expected_soul:u64) { let (mut state,ticket)=open(s); state_delete_content(&mut state,index,expected_soul); close(s,ticket,state) }
public fun purge_content(s:&mut Soul,index:u64,expected_soul:u64) { let (mut state,ticket)=open(s); state_purge_content(&mut state,index,expected_soul); close(s,ticket,state) }
public fun extend_content(s:&mut Soul,index:u64,extension:Storage,system:&System,expected_soul:u64) { let (mut state,ticket)=open(s); state_extend_content(&mut state,index,extension,system,expected_soul); close(s,ticket,state) }
public fun seal_id(s:&Soul,index:u64):vector<u8> { state_seal_id(application(s),index) }
public fun seal_approve_owner(id:vector<u8>,s:&mut Soul,index:u64,system:&System,_ctx:&TxContext) { state_seal_approve_owner(id,application(s),index,system,_ctx) }
public fun grant_count(s:&Soul):u64 { state_grant_count(application(s)) }
public fun manifest_bound_count(m:&Manifest):u64 { state_manifest_bound_count(m) }
public fun assert_content_read<W:drop>(w:W,id:vector<u8>,s:&Soul,index:u64,system:&System,mode:u64) { assert_operator(w,s); state_assert_content_read(id,application(s),index,system,mode) }
public fun assert_delegate<W:drop>(w:W,s:&Soul,owner:address,grantee:address,scope:u64,clock:&Clock) { assert_operator(w,s); state_assert_delegate(application(s),owner,grantee,scope,clock) }
public fun content_scope(s:&Soul,index:u64):u64 { state_content_scope(application(s),index) }
public fun scope_seal():u64 { state_scope_seal() }
public fun scope_memory():u64 { state_scope_memory() }
public fun scope_skills():u64 { state_scope_skills() }
public fun scope_assets():u64 { state_scope_assets() }
public fun paid_access(s:&Soul):&Ledger { state_paid_access(application(s)) }
public fun configure_paid(s:&mut Soul,registry:&KindRegistry,kind:u32,price:u64,scope:u64,duration:Option<u64>,expected_ledger:u64,expected_soul:u64,ctx:&TxContext) { let (mut state,ticket)=open(s); state_configure_paid(&mut state,registry,kind,price,scope,duration,expected_ledger,expected_soul,ctx); close(s,ticket,state) }
public fun remove_paid_offer(s:&mut Soul,kind:u32,expected_ledger:u64,expected_soul:u64) { let (mut state,ticket)=open(s); state_remove_paid_offer(&mut state,kind,expected_ledger,expected_soul); close(s,ticket,state) }
public fun add_paid_access(s:&mut Soul,registry:&KindRegistry,kind:u32,buyer:address,scope:u64,expiry:Option<u64>,expected_ledger:u64,expected_entry:Option<vector<u8>>,expected_soul:u64,clock:&Clock,ctx:&TxContext) { let (mut state,ticket)=open(s); state_add_paid_access(&mut state,registry,kind,buyer,scope,expiry,expected_ledger,expected_entry,expected_soul,clock,ctx); close(s,ticket,state) }
public fun revoke_paid_access(s:&mut Soul,kind:u32,buyer:address,expected_ledger:u64,expected_entry:vector<u8>,expected_soul:u64) { let (mut state,ticket)=open(s); state_revoke_paid_access(&mut state,kind,buyer,expected_ledger,expected_entry,expected_soul); close(s,ticket,state) }
public fun cleanup_paid_access(s:&mut Soul,kind:u32,buyer:address,expected_ledger:u64,expected_soul:u64,clock:&Clock,ctx:&TxContext) { let (mut state,ticket)=open(s); state_cleanup_paid_access(&mut state,kind,buyer,expected_ledger,expected_soul,clock,ctx); close(s,ticket,state) }
public fun buy_paid<C,W:drop>(w:W,s:&mut Soul,cfg:&mut Config<C>,kind:u32,owner:address,expected_soul:u64,quote:vector<u8>,expected_entry:Option<vector<u8>>,fee_revision:u64,expiry:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) { assert_operator(w,s); let (mut state,ticket)=open(s); state_buy_paid<C>(&mut state,cfg,kind,owner,expected_soul,quote,expected_entry,fee_revision,expiry,attempt,payment,clock,ctx); close(s,ticket,state) }
public fun assert_paid_read<W:drop>(w:W,id:vector<u8>,s:&Soul,index:u64,owner:address,system:&System,clock:&Clock,ctx:&TxContext) { assert_operator(w,s); state_assert_paid_read(id,application(s),index,owner,system,clock,ctx) }
public fun semantic_profiles(s:&Soul):vector<ProfileSnapshot> { state_semantic_profiles(application(s)) }
public fun semantic_recipe(s:&Soul):vector<RecipeSlot> { state_semantic_recipe(application(s)) }
public fun semantic_recipe_hash(s:&Soul):vector<u8> { state_semantic_recipe_hash(application(s)) }
public fun root_visual(s:&Soul):&RootVisual { state_root_visual(application(s)) }
public fun scene(s:&Soul):&Scene { state_effective_scene(application(s)) }
public fun original_scene(s:&Soul):&Scene { state_scene(application(s)) }
public fun visual_variants(s:&Soul):vector<Variant> { state_visual_variants(application(s)) }
public fun visual_variant_commitments(s:&Soul):vector<vector<u8>> { assembly::variant_commitments(&visual_variants(s)) }
public fun colors(s:&Soul):vector<ColorChoice> { state_colors(application(s)) }
public fun visual_facts(s:&Soul):vector<Fact> { state_visual_facts(application(s)) }
public fun render_plan(s:&Soul):vector<Layer> { state_render_plan(application(s)) }
public fun published_profiles(s:&Soul):vector<Profile> { state_published_profiles(application(s)) }
public fun tune_colors(s:&mut Soul,colors:vector<ColorChoice>,expected:u64) { let (mut state,ticket)=open(s); state_tune_colors(&mut state,colors,expected); close(s,ticket,state) }
public fun set_initial_colors(d:&Draft,s:&mut Soul,colors:vector<ColorChoice>,ctx:&TxContext) { assert_draft(d,s,ctx); let (mut state,ticket)=open(s); state_set_initial_colors(&mut state,colors); close(s,ticket,state) }
public fun reset_layout_scoped(s:&mut Soul,part:PartKey,expected:u64) { let (mut state,ticket)=open(s); state_reset_layout_scoped(&mut state,part,expected); close(s,ticket,state) }
public fun original_output(s:&Soul):&Artifact { state_original_output(application(s)) }
/// Only the verified native Build path calls this factory. Metadata receipts
/// never grant application authority or replace actual Complete payment checks.
public fun create_output(d:&Draft,s:&Soul,intent:Intent,policy:soulidity_maker_publication::output_data::Policy,recipe:vector<RecipeSlot>,scene:Scene,colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,published:vector<Profile>,blob:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,receipt:soulidity_maker_publication::output_data::Receipt,ctx:&mut TxContext):Artifact { assert_draft(d,s,ctx);
    let creation=output::authorize(ContentOperator{},application(s),s,&intent);
    output::new(creation,intent,policy,recipe,scene,colors,profiles,published,blob,system,sha256,envelope,receipt,ctx)
}
public fun install_output<W:drop>(w:W,s:&mut Soul,artifact:Artifact) { assert_operator(w,s); let (mut state,ticket)=open(s); state_install_output(&mut state,artifact); close(s,ticket,state) }
public fun append_initial_output_content(d:&Draft,s:&mut Soul,registry:&KindRegistry,rule:&InitialRule,intent:&Intent,blob:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,clock:&Clock,ctx:&TxContext):u64 { assert_draft(d,s,ctx); let (mut state,ticket)=open(s); let result=state_append_initial_output_content(&mut state,registry,rule,intent,blob,system,sha256,envelope,clock); close(s,ticket,state); result }
public fun seal_approve_original_output_owner(id:vector<u8>,s:&mut Soul,system:&System,_ctx:&TxContext) { state_seal_approve_original_output_owner(id,application(s),system,_ctx) }
public fun extend_original_output(s:&mut Soul,extension:Storage,system:&System,expected_soul:u64) { let (mut state,ticket)=open(s); state_extend_original_output(&mut state,extension,system,expected_soul); close(s,ticket,state) }
public fun assert_original_output_read<W:drop>(w:W,id:vector<u8>,s:&Soul,system:&System) { assert_operator(w,s); state_assert_original_output_read(id,application(s),system) }
public fun binding(s:&Soul,part:vector<u8>):Option<Binding> { state_binding(application(s),part) }
public fun attach(s:&mut Soul,it:Item,part:vector<u8>,layout:Layout,expected:u64) { let (mut state,ticket)=open(s); state_attach(&mut state,it,part,layout,expected); close(s,ticket,state) }
public fun replace(s:&mut Soul,it:Item,part:vector<u8>,layout:Layout,expected:u64):Option<Item> { let (mut state,ticket)=open(s); let result=state_replace(&mut state,it,part,layout,expected); close(s,ticket,state); result }
public fun detach(s:&mut Soul,part:vector<u8>,expected:u64):Item { let (mut state,ticket)=open(s); let result=state_detach(&mut state,part,expected); close(s,ticket,state); result }
public fun clear_reference(s:&mut Soul,part:vector<u8>,expected:u64) { let (mut state,ticket)=open(s); state_clear_reference(&mut state,part,expected); close(s,ticket,state) }
public fun unmount_bound(s:&mut Soul,part:vector<u8>,expected:u64) { let (mut state,ticket)=open(s); state_unmount_bound(&mut state,part,expected); close(s,ticket,state) }
public fun remount_bound(s:&mut Soul,index:u64,part:vector<u8>,layout:Layout,expected:u64) { let (mut state,ticket)=open(s); state_remount_bound(&mut state,index,part,layout,expected); close(s,ticket,state) }
public fun tune(s:&mut Soul,part:vector<u8>,layout:Layout,expected:u64) { let (mut state,ticket)=open(s); state_tune(&mut state,part,layout,expected); close(s,ticket,state) }
public fun remount_reference(s:&mut Soul,index:u64,part:vector<u8>,layout:Layout,expected:u64) { let (mut state,ticket)=open(s); state_remount_reference(&mut state,index,part,layout,expected); close(s,ticket,state) }
public fun empty_slot(part:vector<u8>):DesiredSlot { state_empty_slot(part) }
public fun reference_slot(part:vector<u8>,index:u64,layout:Layout):DesiredSlot { state_reference_slot(part,index,layout) }
public fun bound_slot(part:vector<u8>,index:u64,layout:Layout):DesiredSlot { state_bound_slot(part,index,layout) }
public fun free_slot(part:vector<u8>,id:ID,layout:Layout):DesiredSlot { state_free_slot(part,id,layout) }
public fun reset_layout(s:&mut Soul,part:vector<u8>,expected:u64) { let (mut state,ticket)=open(s); state_reset_layout(&mut state,part,expected); close(s,ticket,state) }

/// Container adapters must derive owner from their authenticated custody state.
public fun container_grant_live<W:drop>(w:W,s:&Soul,grantee:address,owner:address,clock:&Clock):bool { assert_operator(w,s);authorization::live(ContentOperator{},state_authorization(application(s)),grantee,owner,clock)}
public fun container_assert_grant_snapshot<W:drop>(w:W,s:&Soul,expected_generation:u64,expected_capacity:u64,expected_count:u64,grantee:address,expected_slot:Option<vector<u8>>,expected_live:bool,owner:address,clock:&Clock) { assert_operator(w,s);authorization::assert_snapshot(ContentOperator{},state_authorization(application(s)),expected_generation,expected_capacity,expected_count,grantee,expected_slot,expected_live,owner,clock)}
public fun container_assert_preserves_grant_scopes<W:drop>(w:W,s:&Soul,grantee:address,desired:u64,owner:address,clock:&Clock) { assert_operator(w,s);authorization::assert_preserves_active_scopes(ContentOperator{},state_authorization(application(s)),grantee,desired,owner,clock)}

/// Test-only reproduction of a previous compiled writer's schema argument.
#[test_only]
public fun previous_schema_commit_for_testing(s:&mut Soul){
    let(state,ticket)=open(s);let semantic=application_commitment(&state);
    standard::commit_update(s,ticket,ApplicationWitness{},state,1,semantic)
}
#[test_only]
public fun previous_configuration_schema_commit_for_testing(s:&mut Soul){
    let(state,ticket)=open(s);let semantic=application_commitment(&state);
    standard::commit_update(s,ticket,ApplicationWitness{},state,2,semantic)
}

/// Runs the complete original recursive body before genuine private-witness
/// acknowledgment. No public API returns ApplicationWitness or a bare permit.
public fun acknowledge_handover(h:&mut lifecycle::Handover) {
    clear_authorizations_creation(lifecycle::handover_mut(h));
    lifecycle::acknowledge_handover<ApplicationWitness,ApplicationState>(h,ApplicationWitness{},b"animacraft",MODULE_SCHEMA)
}

/// Source-owned begin checks the original protocol/application CAS, then clears
/// this application's duties. Independent protected handlers may compose on the
/// borrowed Handover before the exact source-authenticated Account terminal.
public fun begin_account_deposit<C>(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_custody::account::Account,
    s:Soul,cfg:&Config<C>,expected:u64,ctx:&TxContext):soulidity_custody::account::AccountHandover {
    soulidity_custody::account::assert_pair(k,a,ctx);
    assert!(protocol(&s)==object::id(cfg),2);assert_revision(&s,expected);
    let mut session=soulidity_custody::account::begin_source_deposit<ApplicationWitness,ApplicationState>(ApplicationWitness{},k,a,s,b"animacraft",ctx);
    let h=soulidity_custody::account::handover_mut(&mut session);
    acknowledge_handover(h);soulidity_application::vault::acknowledge_handover(h);session
}
public fun finish_account_deposit(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_custody::account::Account,
    session:soulidity_custody::account::AccountHandover,ctx:&TxContext):ID {
    soulidity_custody::account::finish_source_deposit<ApplicationWitness,ApplicationState>(ApplicationWitness{},k,a,session,ctx)
}
/// Safe exit has no Config, current live-state or source-role gate.
public fun begin_account_withdraw(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_custody::account::Account,
    id:ID,expected:u64,ctx:&TxContext):soulidity_custody::account::AccountHandover {
    let mut session=soulidity_custody::account::begin_source_withdraw<ApplicationWitness,ApplicationState>(ApplicationWitness{},k,a,id,ctx);
    let h=soulidity_custody::account::handover_mut(&mut session);
    assert_revision(lifecycle::handover_ref(h),expected);
    acknowledge_handover(h);soulidity_application::vault::acknowledge_handover(h);session
}
public fun finish_account_withdraw(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_custody::account::Account,
    session:soulidity_custody::account::AccountHandover,ctx:&TxContext):ID {
    soulidity_custody::account::finish_source_withdraw<ApplicationWitness,ApplicationState>(ApplicationWitness{},k,a,session,ctx)
}
public fun deposit_soul<C>(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_custody::account::Account,
    s:Soul,cfg:&Config<C>,expected:u64,ctx:&TxContext) {
    let session=begin_account_deposit(k,a,s,cfg,expected,ctx);let _=finish_account_deposit(k,a,session,ctx);
}
public fun withdraw_soul(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_custody::account::Account,
    id:ID,expected:u64,ctx:&TxContext) {
    let session=begin_account_withdraw(k,a,id,expected,ctx);let _=finish_account_withdraw(k,a,session,ctx);
}

/// Actual application namespace authorization for an atomic closed child append.
/// Preserve the existing operator, protocol, application CAS and Primary gate.
/// The child's genuine Source completion remains independently mandatory.
public fun nest_locked_construction<C,W:drop>(
 w:W,k:&mut sui::kiosk::Kiosk,a:&mut soulidity_custody::account::Account,
 parent:ID,cfg:&Config<C>,child:lifecycle::Construction,
 completion:soulidity_origin_protocol::producer_origin::CompletionAuthorization,
 expected_application:u64,expected_parent:u64,ctx:&TxContext,
):ID {
 {
  let(state,schema)=soulidity_custody::account::source_module<ApplicationWitness,ApplicationState>(ApplicationWitness{},k,a,parent,b"animacraft",ctx);
  assert!(schema==MODULE_SCHEMA && state.root==parent,EDraft);
  assert!(state.operator==type_name::with_original_ids<W>(),EAuthority);let _=w;
  assert!(state_core(state).protocol==object::id(cfg),EOwner);
  assert!(state.revision==expected_application,ERevision);
  // Structural attachment does not manufacture the parent. Its Config may
  // serve Native or Manufacturing independently; the child's Source completion
  // retains its own issuance-specific authority and live-state obligations.
  economics::assert_operation(cfg);assert!(economics::primary_enabled(cfg),EAuthority)
 };
 soulidity_custody::account::nest_locked_source<ApplicationWitness,ApplicationState>(ApplicationWitness{},k,a,parent,b"animacraft",child,completion,expected_parent,ctx)
}

// Test-only exact upstream bodies. Shared unchanged getters/source snapshots are
// not an independent source algorithm; these isolate repeated-read equivalence.
#[test_only]
fun state_slot_snapshots_read_oracle(s:&ApplicationState):vector<SlotSnapshot>{
    let c=state_composition(s);let mut slots=vector[];
    assembly::parts(&c.assembly).do_ref!(|p| slots.push_back(SlotSnapshot{part:*p,binding:state_binding_scoped(s,*p).map_ref!(|b|BindingSnapshot{source:state_source_snapshot(&b.source),layout:b.layout,item:b.item,bound:b.bound,adapter:b.adapter.map_ref!(|a|policy::hash_bytes(bcs::to_bytes(a)))})}));slots
}
#[test_only]
fun state_manifest_read_oracle(s:&ApplicationState):Manifest {
    let c=state_composition(s);let slots=state_slot_snapshots_read_oracle(s);
    Manifest{standard_revision:0,standard_manifest:vector[],soul:s.root,revision:s.revision,creator:state_creator(s),collection:state_collection_id(s),resale:*state_resale(s),recipe_hash:s.recipe_hash,core:object::id(state_core(s)),composition:object::id(c),composition_revision:c.revision,bound_module:object::id(state_bound_parts(s)),authorization:object::id(state_authorization(s)),content:object::id(state_content(s)),paid_access:object::id(state_paid_access(s)),output:object::id(state_original_output(s)),loadout:object::id(state_loadouts(s)),enhancement_table:state_enhancement_table(s),enhancement_count:state_enhancement_count(s),bound:vector::tabulate!(state_bound_count(s),|i|state_source_snapshot(state_bound_source(s,i))),references:vector::tabulate!(state_reference_count(s),|i|state_source_snapshot(state_reference_source(s,i))),slots,scene:*state_effective_scene(s),colors:c.colors,profiles:assembly::snapshots(&c.assembly)}
}
#[test_only]
fun state_manifest_read_oracle_hash(s:&ApplicationState):vector<u8>{policy::hash_bytes(bcs::to_bytes(&state_manifest_read_oracle(s)))}
#[test_only]
fun application_commitment_read_oracle(s:&ApplicationState):vector<u8>{
    let complete=dof::exists_with_type<OutputKey,Artifact>(&s.id,OutputKey{});
    let mut state=bcs::to_bytes(s);let config=if(state_has_configuration(s))option::some(state_configuration::commitment(state_configuration(s))) else option::none();state.append(bcs::to_bytes(&config));
    policy::hash_bytes(bcs::to_bytes(&ApplicationCommitment{domain:b"soulidity/animacraft/state/v2",root:s.root,revision:s.revision,state,core:bcs::to_bytes(state_core(s)),composition:bcs::to_bytes(state_composition(s)),visual:bcs::to_bytes(state_root_visual(s)),bound:bcs::to_bytes(state_bound_parts(s)),authorization:bcs::to_bytes(state_authorization(s)),content:bcs::to_bytes(state_content(s)),paid:bcs::to_bytes(state_paid_access(s)),loadout:bcs::to_bytes(state_loadouts(s)),output:if(complete)option::some(bcs::to_bytes(state_original_output(s))) else option::none(),recipe:if(complete)option::some(state_manifest_read_oracle_hash(s)) else option::none()}))
}
#[test_only]
public fun assert_application_manifest_read_oracle_for_testing(root:&Soul){
    let s=application(root);
    assert!(bcs::to_bytes(&state_slot_snapshots(s))==bcs::to_bytes(&state_slot_snapshots_read_oracle(s)),ERevision);
    assert!(bcs::to_bytes(&state_manifest(s))==bcs::to_bytes(&state_manifest_read_oracle(s)),ERevision);
    assert!(state_manifest_hash(s)==state_manifest_read_oracle_hash(s),ERevision);
    assert!(application_commitment(s)==application_commitment_read_oracle(s),ERevision)
}

// Manifest already holds this immutable Composition; preserve actual variant
// and root visual typed children without borrowing the same Composition again.
fun state_effective_scene_with_composition(c:&Composition):&Scene{
    let scope=assembly::root(&c.assembly);
    if(dof::exists_with_type<ActiveVariantsKey,ActiveVariants>(&c.id,ActiveVariantsKey{})){
        let v:&ActiveVariants=dof::borrow(&c.id,ActiveVariantsKey{});
        if(v.values.contains(scope))return assembly::variant_scene(v.values.borrow(scope))
    };let root:&RootVisual=dof::borrow(&c.id,RootVisualKey{});&root.scene
}


/// Creation-aware source initialization and recursive handover.
public fun initialize_creation(g:Genesis,root:&mut standard::Creation,protocol:ID,maker:ID,maker_version:u64,manifest:vector<u8>,configuration:vector<u8>,profile:Profile,required:vector<vector<u8>>,adapters:vector<Adapter>,scene:Scene,resale:Snapshot,beneficiary:address,ctx:&mut TxContext):Draft {
    let metadata=genesis_hash(protocol,maker,maker_version,manifest,configuration,profile,required,adapters,scene,resale,beneficiary,ctx);
    let(config,operator)=issuance::consume_genesis(g,standard::creation_ref(root),metadata,ctx);assert!(config==protocol,EOwner);
    let origin=standard::origin(standard::creation_ref(root));assert!(standard::source(&origin)==maker && standard::source_version(&origin)==maker_version && standard::source_hash(&origin)==resale::policy_hash(&resale),EOwner);
    let state=state_new(standard::creation_ref(root),operator,protocol,maker,maker_version,manifest,configuration,profile,required,adapters,scene,resale,beneficiary,ctx);
    let draft=Draft{root:object::id(standard::creation_ref(root)),state:object::id(&state),actor:ctx.sender()};
    let semantic=application_commitment(&state);let revision=standard::revision(standard::creation_ref(root));
    lifecycle::install_creation_protected(root,ApplicationWitness{},b"animacraft",state,MODULE_SCHEMA,false,semantic,revision);draft
}

public fun set_initial_state_config_creation(d:&Draft,s:&mut standard::Creation,key:String,value:vector<u8>,ctx:&mut TxContext){
    assert_draft(d,standard::creation_ref(s),ctx);state_configuration::assert_initial_key(&key);let(mut a,ticket)=open_creation(s);state_set_configuration(&mut a,standard::creation_ref(s),key,value,ctx);close_creation(s,ticket,a)
}

public fun finalize_creation(d:Draft,s:&mut standard::Creation,recipient:address,ctx:&TxContext){assert_draft(&d,standard::creation_ref(s),ctx);let Draft{root:_,state:_,actor}=d;assert!(recipient==actor,EDraft);let(mut state,ticket)=open_creation(s);state_finish(&mut state);close_creation(s,ticket,state)}

public fun admit_contribution_creation(d:&Draft,s:&mut standard::Creation,c:Contribution,p:Profile,ctx:&TxContext):PrimaryReceipt{
    assert_draft(d,standard::creation_ref(s),ctx);let(product,version,hash,payment)=issuance::consume_contribution(c,standard::creation_ref(s),ctx);let scope=assembly::profile_scope(&p);
    assert!(assembly::scope_product(&scope)==product && assembly::scope_version(&scope)==version && assembly::scope_policy(&scope)==hash && assembly::scope_protocol(&scope)==protocol(standard::creation_ref(s)),EEnhancement);
    let(mut state,ticket)=open_creation(s);state_admit_profile(&mut state,p);close_creation(s,ticket,state);payment
}

public fun set_initial_pack_colors_creation(d:&Draft,s:&mut standard::Creation,scope:Scope,colors:vector<ColorChoice>,ctx:&TxContext) { assert_draft(d,standard::creation_ref(s),ctx); let (mut state,ticket)=open_creation(s); state_set_initial_pack_colors(&mut state,scope,colors); close_creation(s,ticket,state) }

public fun add_issued_creation(d:&Draft,s:&mut standard::Creation,permit:Permit,part:PartKey,layout:Layout,ctx:&mut TxContext) { assert_draft(d,standard::creation_ref(s),ctx); let (mut state,ticket)=open_creation(s); state_add_issued(&mut state,permit,part,layout,ctx); close_creation(s,ticket,state) }

public fun set_initial_colors_creation(d:&Draft,s:&mut standard::Creation,colors:vector<ColorChoice>,ctx:&TxContext) { assert_draft(d,standard::creation_ref(s),ctx); let (mut state,ticket)=open_creation(s); state_set_initial_colors(&mut state,colors); close_creation(s,ticket,state) }

public fun install_output_creation<W:drop>(w:W,s:&mut standard::Creation,artifact:Artifact) { assert_operator(w,standard::creation_ref(s)); let (mut state,ticket)=open_creation(s); state_install_output(&mut state,artifact); close_creation(s,ticket,state) }

public fun append_initial_output_content_creation(d:&Draft,s:&mut standard::Creation,registry:&KindRegistry,rule:&InitialRule,intent:&Intent,blob:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,clock:&Clock,ctx:&TxContext):u64 { assert_draft(d,standard::creation_ref(s),ctx); let (mut state,ticket)=open_creation(s); let result=state_append_initial_output_content(&mut state,registry,rule,intent,blob,system,sha256,envelope,clock); close_creation(s,ticket,state); result }

fun open_creation(s:&mut standard::Creation):(ApplicationState,standard::Edit<ApplicationWitness,ApplicationState>){
    let revision=standard::revision(standard::creation_ref(s));standard::creation_begin_update(s,ApplicationWitness{},b"animacraft",revision)
}

fun close_creation(s:&mut standard::Creation,ticket:standard::Edit<ApplicationWitness,ApplicationState>,state:ApplicationState){
    assert!(state.root==object::id(standard::creation_ref(s)),EOwner);let semantic=application_commitment(&state);
    standard::creation_commit_update(s,ticket,ApplicationWitness{},state,MODULE_SCHEMA,semantic)
}

public fun clear_authorizations_creation(s:&mut standard::Creation) {let _=clear_tree_authorizations_creation(s,0,256);}

fun clear_tree_authorizations_creation(s:&mut standard::Creation,depth:u64,budget:u64):u64 {
    assert!(depth<=16 && budget>0,ECapacity);let mut used=1;
    if(standard::descriptor<ApplicationWitness>(standard::creation_ref(s),b"animacraft").is_some()) {
        let (mut state,ticket)=open_creation(s);state_clear_authorizations(&mut state);close_creation(s,ticket,state)
    };
    let children=standard::module_page(standard::creation_ref(s),0,64);
    children.do_ref!(|d| {
        if(standard::namespace(d)==std::type_name::with_defining_ids<standard::NestedSoulWitness>()) {
            assert!(used < budget,ECapacity);let rev=standard::revision(standard::creation_ref(s));
            let (mut child,ticket)=standard::creation_begin_nested_update(s,standard::module_id(d),rev);
            used=used+clear_tree_authorizations_creation(&mut child,depth+1,budget-used);
            standard::creation_commit_nested_update(s,ticket,child)
        }
    });used
}


public fun set_manufacturing_state_config_creation<C,W:drop>(w:W,s:&mut standard::Creation,cfg:&Config<C>,key:String,value:vector<u8>,expected:u64,ctx:&mut TxContext){
    assert_operator(w,standard::creation_ref(s));assert!(protocol(standard::creation_ref(s))==object::id(cfg),EOwner);economics::assert_manufacturing_primary(cfg);assert_revision(standard::creation_ref(s),expected);let(mut a,ticket)=open_creation(s);state_set_configuration(&mut a,standard::creation_ref(s),key,value,ctx);close_creation(s,ticket,a)
}

public fun delete_manufacturing_state_config_creation<C,W:drop>(w:W,s:&mut standard::Creation,cfg:&Config<C>,key:String,expected:u64,ctx:&TxContext){
    assert_operator(w,standard::creation_ref(s));assert!(protocol(standard::creation_ref(s))==object::id(cfg),EOwner);economics::assert_manufacturing_primary(cfg);assert_revision(standard::creation_ref(s),expected);delete_state_config_value_creation(s,key,ctx)
}

fun delete_state_config_value_creation(s:&mut standard::Creation,key:String,ctx:&TxContext){
    let(mut a,ticket)=open_creation(s);let parent=object::id(&a);let soul=a.root;let c:&mut Configuration=dof::borrow_mut(&mut a.id,StateConfigurationKey{});state_configuration::assert_binding(c,parent,object::id(standard::creation_ref(s)));let rev=state_configuration::revision(c);state_configuration::delete(ContentOperator{},c,key,rev);
    event::emit(StateConfigurationChanged{soul,configuration:object::id(c),updater:ctx.sender(),key,deleted:true,revision:state_configuration::revision(c),commitment:state_configuration::commitment(c)});a.revision=a.revision+1;close_creation(s,ticket,a)
}
