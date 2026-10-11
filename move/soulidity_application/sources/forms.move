/// Versioned forms of one OC. A form is immutable metadata, never an asset root,
/// an issuance permit or a second inventory. The actual Soul owns this journal.
module soulidity_application::forms;

use std::bcs;
use std::hash;
use sui::dynamic_object_field as dof;
use sui::table::{Self,Table};
use sui::event;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_application::character::{Self as character,DesiredSlot,SlotSnapshot};
use soulidity_model::components::Item;
use soulidity_model::assembly::{Self,ProfileSnapshot,Scope,Variant};
use soulidity_model::policy;
use soulidity_visual::visual::{Self,ColorChoice};
use soulidity_transport::paged_transport::{Self as paged_store,Store};

// Journal schema 2 prevents old writers from dropping cross-Scene snapshot
// semantics. Snapshot schema 1 remains valid immutable historical metadata.
const MODULE_SCHEMA:u16=2;
const ERevision:u64=1;const EForm:u64=2;const EBinding:u64=3;
const ECapacity:u64=4;const ERecipe:u64=5;
public struct Witness has drop {}
public struct Reference has copy,drop,store {name:vector<u8>,version:u64}
public struct Journal has key,store {
    id:UID,root:ID,revision:u64,forms:u64,versions:u64,
    heads:Table<vector<u8>,u64>,history:Table<u64,Transition>,
    head:vector<u8>,active:Option<Activation>,
}
public struct Snapshot has key,store {
    id:UID,schema:u16,root:ID,application:ID,reference:Reference,
    parent:Option<Reference>,creator:address,epoch:u64,
    application_revision:u64,composition_revision:u64,scene:vector<u8>,
    colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,
    recipe:vector<u8>,render:vector<u8>,commitment:vector<u8>,
}
public struct Selections has key,store {id:UID,values:Store<DesiredSlot>}
public struct Sources has key,store {id:UID,values:Store<SlotSnapshot>}
public struct SelectionsKey has copy,drop,store {}
public struct SourcesKey has copy,drop,store {}
public struct VisualVariants has key,store {id:UID,scopes:vector<Scope>,values:Table<Scope,Variant>}
public struct VisualVariantsKey has copy,drop,store {}
public struct VisualSnapshotCommitment has drop {domain:vector<u8>,base:SnapshotCommitment,variants:vector<vector<u8>>}
public struct SnapshotKey has copy,drop,store {reference:Reference}
public struct Activation has copy,drop,store {
    reference:Reference,snapshot:ID,commitment:vector<u8>,
    application_revision:u64,composition:vector<u8>,
}
public struct Transition has copy,drop,store {
    root:ID,sequence:u64,operation:u8,actor:address,epoch:u64,
    reference:Reference,snapshot:ID,snapshot_commitment:vector<u8>,
    previous:vector<u8>,commitment:vector<u8>,
}
public struct Saved has copy,drop {root:ID,reference:Reference,snapshot:ID,commitment:vector<u8>}
public struct Selected has copy,drop {root:ID,reference:Reference,snapshot:ID,sequence:u64}
public struct SnapshotCommitment has drop {
    domain:vector<u8>,schema:u16,root:ID,application:ID,
    reference:Reference,parent:Option<Reference>,creator:address,epoch:u64,
    application_revision:u64,composition_revision:u64,scene:vector<u8>,
    colors:vector<ColorChoice>,profiles:vector<ProfileSnapshot>,
    selections:vector<u8>,sources:vector<u8>,recipe:vector<u8>,render:vector<u8>,
}
public struct TransitionCommitment has drop {
    domain:vector<u8>,schema:u16,root:ID,sequence:u64,operation:u8,
    actor:address,epoch:u64,reference:Reference,snapshot:ID,
    snapshot_commitment:vector<u8>,previous:vector<u8>,
}

public fun reference(name:vector<u8>,version:u64):Reference{
    assert!(name.length()>0 && name.length()<=64 && version>0,EForm);Reference{name,version}
}
public fun name(r:&Reference):vector<u8>{r.name}
public fun version(r:&Reference):u64{r.version}
public fun installed(s:&Soul):bool{standard::descriptor<Witness>(s,b"forms").is_some()}
public fun journal(s:&Soul):&Journal{standard::borrow_module<Witness,Journal>(s,b"forms")}
public fun root(j:&Journal):ID{j.root}
public fun revision(j:&Journal):u64{j.revision}
public fun form_count(j:&Journal):u64{j.forms}
public fun version_count(j:&Journal):u64{j.versions}
public fun history_head(j:&Journal):vector<u8>{j.head}
public fun latest(j:&Journal,name:vector<u8>):u64{
    if(j.heads.contains(name))*j.heads.borrow(name) else 0
}
public fun snapshot(j:&Journal,r:Reference):&Snapshot{
    assert!(dof::exists_with_type<SnapshotKey,Snapshot>(&j.id,SnapshotKey{reference:r}),EForm);
    dof::borrow(&j.id,SnapshotKey{reference:r})
}
public fun snapshot_root(f:&Snapshot):ID{f.root}
public fun snapshot_reference(f:&Snapshot):Reference{f.reference}
public fun parent(f:&Snapshot):Option<Reference>{f.parent}
public fun creator(f:&Snapshot):address{f.creator}
public fun formation_epoch(f:&Snapshot):u64{f.epoch}
public fun application(f:&Snapshot):ID{f.application}
public fun application_revision(f:&Snapshot):u64{f.application_revision}
public fun composition_revision(f:&Snapshot):u64{f.composition_revision}
public fun scene(f:&Snapshot):vector<u8>{f.scene}
public fun colors(f:&Snapshot):vector<ColorChoice>{f.colors}
public fun profiles(f:&Snapshot):vector<ProfileSnapshot>{f.profiles}
public fun recipe(f:&Snapshot):vector<u8>{f.recipe}
public fun render(f:&Snapshot):vector<u8>{f.render}
public fun commitment(f:&Snapshot):vector<u8>{f.commitment}
public fun selections(f:&Snapshot):vector<DesiredSlot>{
    let values:&Selections=dof::borrow(&f.id,SelectionsKey{});paged_store::values(&values.values)
}
public fun source_count(f:&Snapshot):u64{
    let values:&Sources=dof::borrow(&f.id,SourcesKey{});paged_store::length(&values.values)
}
public fun visual_variants(f:&Snapshot):vector<Variant>{
    if(!dof::exists_with_type<VisualVariantsKey,VisualVariants>(&f.id,VisualVariantsKey{}))return vector[];
    let v:&VisualVariants=dof::borrow(&f.id,VisualVariantsKey{});v.scopes.map_ref!(|scope|*v.values.borrow(*scope))
}
public fun visual_variant_commitments(f:&Snapshot):vector<vector<u8>>{assembly::variant_commitments(&visual_variants(f))}
public fun source_page(f:&Snapshot,start:u64,count:u64):vector<SlotSnapshot>{
    assert!(count<=64,ECapacity);let values:&Sources=dof::borrow(&f.id,SourcesKey{});
    paged_store::range(&values.values,start,count)
}
public fun active(j:&Journal):Option<Activation>{j.active}
public fun active_reference(a:&Activation):Reference{a.reference}
/// A later ordinary edit leaves the selection receipt intact, but it must not be
/// displayed as the current saved form. Content-only changes do not stale it.
public fun active_is_current(s:&Soul):bool{
    if(!installed(s))return false;
    let a=journal(s).active;
    a.is_some() && a.borrow().composition==character::recipe_hash(s)
}
public fun transition(j:&Journal,sequence:u64):Transition{
    assert!(sequence>0 && sequence<=j.revision,EForm);*j.history.borrow(sequence)
}
public fun history_page(j:&Journal,start:u64,count:u64):vector<Transition>{
    assert!(start>0 && start<=j.revision+1 && count<=64 && count<=j.revision+1-start,ECapacity);
    vector::tabulate!(count,|i|transition(j,start+i))
}
public fun transition_previous(t:&Transition):vector<u8>{t.previous}
public fun transition_commitment(t:&Transition):vector<u8>{t.commitment}
public fun transition_reference(t:&Transition):Reference{t.reference}
fun digest<T>(value:&T):vector<u8>{hash::sha3_256(bcs::to_bytes(value))}
fun new(root:ID,ctx:&mut TxContext):Journal{
    Journal{id:object::new(ctx),root,revision:0,forms:0,versions:0,
        heads:table::new(ctx),history:table::new(ctx),head:vector::tabulate!(32,|_|0),active:option::none()}
}
fun close(s:&mut Soul,ticket:standard::Edit<Witness,Journal>,j:Journal){
    assert!(j.root==object::id(s),EBinding);let semantic=digest(&j);
    standard::commit_update(s,ticket,Witness{},j,MODULE_SCHEMA,semantic)
}
fun append(j:&mut Journal,operation:u8,reference:Reference,snapshot:ID,snapshot_commitment:vector<u8>,ctx:&TxContext){
    let sequence=j.revision+1;let actor=ctx.sender();let epoch=ctx.epoch();
    let previous=j.head;
    let commitment=digest(&TransitionCommitment{domain:b"soulidity/form-transition/v1",schema:1,
        root:j.root,sequence,operation,actor,epoch,reference,snapshot,snapshot_commitment,previous});
    j.history.add(sequence,Transition{root:j.root,sequence,operation,actor,epoch,
        reference,snapshot,snapshot_commitment,previous,commitment});
    j.head=commitment;j.revision=sequence
}
/// No mutable journal/snapshot or private Witness is returned. Current custody
/// is supplied by the actual mutable Soul input; a container must prove its own
/// custody before withdrawing or calling this module from Move.
public fun save(s:&mut Soul,name:vector<u8>,parent:Option<Reference>,expected_head:u64,
    expected_journal:u64,expected_standard:u64,expected_application:u64,ctx:&mut TxContext):Reference{
    assert!(standard::revision(s)==expected_standard,ERevision);
    character::assert_revision(s,expected_application);let validated_render=character::validated_render_plan(s);
    let exists=installed(s);
    if(exists){let j=journal(s);assert!(j.root==object::id(s),EBinding);assert!(j.revision==expected_journal,ERevision);
        assert!(latest(j,name)==expected_head,ERevision);
        parent.do_ref!(|r|{let _=snapshot(j,*r);})
    }else assert!(expected_journal==0 && expected_head==0 && parent.is_none(),ERevision);
    let reference=reference(name,expected_head+1);
    // Existing versions are append-only. A new version of the same form always
    // derives from its previous head; explicit parents allow a new form branch.
    let parent=if(expected_head>0){let old=reference(name,expected_head);
        assert!(parent.is_none() || parent==option::some(old),EForm);option::some(old)
    }else parent;
    let root=object::id(s);let application=character::application_module_id(s);
    let slots=character::capture_slots(s);let manifest=character::manifest(s);
    let sources=character::manifest_slots(&manifest);let colors=character::colors(s);
    let profiles=character::profile_snapshots(s);let scene=visual::scene_hash(character::scene(s));
    let recipe=character::semantic_recipe_hash(s);let render=digest(&validated_render);
    let creator=ctx.sender();let epoch=ctx.epoch();let composition_revision=character::composition_revision(s);
    let variants=character::visual_variants(s);let schema=if(variants.is_empty())1 else 2;
    let base_commitment=SnapshotCommitment{domain:b"soulidity/oc-form/v1",schema:1,root,application,
        reference,parent,creator,epoch,application_revision:expected_application,composition_revision,scene,
        colors,profiles,selections:digest(&slots),sources:digest(&sources),recipe,render};
    let commitment=if(variants.is_empty())digest(&base_commitment) else digest(&VisualSnapshotCommitment{domain:b"soulidity/oc-form/v2",base:base_commitment,variants:assembly::variant_commitments(&variants)});
    let mut f=Snapshot{id:object::new(ctx),schema,root,application,reference,parent,creator,epoch,
        application_revision:expected_application,composition_revision,scene,colors,profiles,recipe,render,commitment};
    assert!(bcs::to_bytes(&f).length()<=196608,ECapacity);
    dof::add(&mut f.id,SelectionsKey{},Selections{id:object::new(ctx),values:paged_store::from_values(slots,ctx)});
    dof::add(&mut f.id,SourcesKey{},Sources{id:object::new(ctx),values:paged_store::from_values(sources,ctx)});
    if(!variants.is_empty()){
        let mut v=VisualVariants{id:object::new(ctx),scopes:vector[],values:table::new(ctx)};
        variants.do!(|variant|{let scope=assembly::variant_scope(&variant);v.scopes.push_back(scope);v.values.add(scope,variant)});
        dof::add(&mut f.id,VisualVariantsKey{},v)
    };
    if(!exists){let j=new(root,ctx);let semantic=digest(&j);let revision=standard::revision(s);
        standard::install(s,Witness{},b"forms",j,MODULE_SCHEMA,false,semantic,revision)};
    let revision=standard::revision(s);let(mut j,ticket)=standard::begin_update<Witness,Journal>(s,Witness{},b"forms",revision);
    append(&mut j,0,reference,object::id(&f),f.commitment,ctx);j.versions=j.versions+1;
    if(expected_head==0){j.heads.add(name,reference.version);j.forms=j.forms+1}
    else *j.heads.borrow_mut(name)=reference.version;
    let snapshot=object::id(&f);dof::add(&mut j.id,SnapshotKey{reference},f);close(s,ticket,j);
    event::emit(Saved{root,reference,snapshot,commitment});reference
}
public fun activate(s:&mut Soul,r:Reference,items:vector<Item>,expected_journal:u64,
    expected_standard:u64,expected_application:u64,expected_recipe:vector<u8>,ctx:&TxContext):vector<Item>{
    assert!(standard::revision(s)==expected_standard,ERevision);character::assert_revision(s,expected_application);
    let j=journal(s);assert!(j.revision==expected_journal,ERevision);let f=snapshot(j,r);
    assert!(f.root==object::id(s) && f.application==character::application_module_id(s),EBinding);
    let saved=selections(f);let current=character::parts(s);
    saved.do_ref!(|slot|assert!(current.contains(&character::desired_part(slot)),EBinding));
    // Additional admitted Pack slots may be left empty. They are not inventory.
    let slots=current.map_ref!(|part|{
        let mut found=option::none();saved.do_ref!(|slot|{if(character::desired_part(slot)==*part)found=option::some(*slot)});
        if(found.is_some())found.destroy_some() else character::empty_slot_scoped(*part)
    });
    let colors=f.colors;let profiles=f.profiles;let recipe=f.recipe;let render=f.render;let scene=f.scene;let variants=visual_variants(f);
    let returned=character::restore_variant_loadout(s,variants,slots,items,colors,profiles,expected_application,expected_recipe);
    assert!(visual::scene_hash(character::scene(s))==scene && character::semantic_recipe_hash(s)==recipe && digest(&character::render_plan(s))==render,ERecipe);
    let composition=character::recipe_hash(s);let application_revision=character::revision(s);
    let revision=standard::revision(s);let(mut j,ticket)=standard::begin_update<Witness,Journal>(s,Witness{},b"forms",revision);
    // Append the transition without ever extracting the frozen snapshot.
    let f=snapshot(&j,r);let activation=Activation{reference:r,snapshot:object::id(f),commitment:f.commitment,application_revision,composition};
    append(&mut j,1,r,activation.snapshot,activation.commitment,ctx);
    let sequence=j.revision;j.active=option::some(activation);let root=j.root;
    close(s,ticket,j);event::emit(Selected{root,reference:r,snapshot:activation.snapshot,sequence});returned
}

#[test_only]
public fun previous_schema_commit_for_testing(s:&mut Soul){
    let revision=standard::revision(s);
    let(j,ticket)=standard::begin_update<Witness,Journal>(s,Witness{},b"forms",revision);
    let semantic=digest(&j);standard::commit_update(s,ticket,Witness{},j,1,semantic)
}
