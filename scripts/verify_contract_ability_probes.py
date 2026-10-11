"""Compile real foreign-package ability probes; preserve exact sources and logs."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SUI_DEPENDENCY = next(line for line in (ROOT / "move/soulidity_v1/Move.toml").read_text().splitlines() if line.startswith("Sui = "))
CASES = {
    'positive_state_configuration_owned_update': ('public fun write(s:&mut soulidity_standard::soul::Soul,c:&soulidity_foundation::economics::Config<sui::sui::SUI>,ctx:&mut TxContext){soulidity_application::character::set_state_config(s,c,std::string::utf8(b"mood"),b"happy",0,ctx)}', True, None),
    'positive_state_configuration_query': ('public fun read(s:&soulidity_standard::soul::Soul):bool{soulidity_application::character::has_state_config(s,std::string::utf8(b"mood"))}', True, None),
    'foreign_state_configuration_uid_escape': ('public fun attack(c:&mut soulidity_content::state_configuration::Configuration):&mut UID{&mut c.id}', False, 'EC04001'),
    'foreign_state_configuration_values_escape': ('public fun attack(c:&mut soulidity_content::state_configuration::Configuration){c.revision=0}', False, 'EC04001'),
    'foreign_state_configuration_native_operator_forge': ('public fun attack():soulidity_application::character::ContentOperator{soulidity_application::character::ContentOperator{}}', False, 'EC04001'),
    'foreign_state_configuration_native_key_forge': ('public fun attack():soulidity_application::character::StateConfigurationKey{soulidity_application::character::StateConfigurationKey{}}', False, 'EC04001'),
    'foreign_state_configuration_immutable_owner_write': ('public fun attack(s:&soulidity_standard::soul::Soul,c:&soulidity_foundation::economics::Config<sui::sui::SUI>,ctx:&mut TxContext){soulidity_application::character::set_state_config(s,c,std::string::utf8(b"mood"),b"happy",0,ctx)}', False, 'EC04006'),
    'foreign_state_configuration_private_issuance_write': ('public fun attack(b:&mut soulidity_v1::issuer::Build,ctx:&mut TxContext){soulidity_v1::issuer::set_initial_state_config(b,std::string::utf8(b"mood"),b"happy",ctx)}', False, 'EC04001'),
    'positive_vault_tool_native_composition': ('public fun take<T>(s:&mut soulidity_standard::soul::Soul,ctx:&mut TxContext):sui::coin::Coin<T>{let t=soulidity_application::vault::revision(soulidity_application::vault::tool(s));let r=soulidity_standard::soul::revision(s);soulidity_application::vault::withdraw_coin(s,1,vector::tabulate!(32,|_|9),t,r,ctx)}', True, None),
    'positive_vault_tool_public_snapshot': ('public fun view(s:&soulidity_standard::soul::Soul):soulidity_application::vault::Snapshot{soulidity_application::vault::snapshot(s)}', True, None),
    'foreign_vault_tool_constructor': ('public fun fake(ctx:&mut TxContext):soulidity_application::vault::Vault{soulidity_application::vault::Vault{id:object::new(ctx),root:object::id_from_address(@0x1),revision:0,privacy_generation:0,coins:vector[],assets:vector[],requests:sui::table::new(ctx),private_library:object::id_from_address(@0x2)}}', False, 'EC04001'),
    'foreign_vault_tool_uid_mutation': ('public fun fake(v:&mut soulidity_application::vault::Vault):&mut UID{&mut v.id}', False, 'EC04001'),
    'foreign_vault_tool_coin_mutation': ('public fun fake(v:&mut soulidity_application::vault::Vault){v.coins=vector[]}', False, 'EC04001'),
    'foreign_vault_tool_private_witness': ('public fun fake():soulidity_application::vault::ContentOperator{soulidity_application::vault::ContentOperator{}}', False, 'EC04001'),
    'foreign_vault_tool_detached_spend': ('public fun fake<T>(v:&mut soulidity_application::vault::Vault,ctx:&mut TxContext):sui::coin::Coin<T>{soulidity_application::vault::withdraw_coin(v,1,vector::tabulate!(32,|_|9),0,0,ctx)}', False, 'EC04007'),
    'foreign_vault_tool_snapshot_spend': ('public fun fake<T>(v:&mut soulidity_application::vault::Snapshot,ctx:&mut TxContext):sui::coin::Coin<T>{soulidity_application::vault::withdraw_coin(v,1,vector::tabulate!(32,|_|9),0,0,ctx)}', False, 'EC04007'),
    'foreign_vault_tool_grant_cannot_spend': ('public fun fake<T>(g:&mut soulidity_content::authorization::Grant,ctx:&mut TxContext):sui::coin::Coin<T>{soulidity_application::vault::withdraw_coin(g,1,vector::tabulate!(32,|_|9),0,0,ctx)}', False, 'EC04007'),
    'foreign_vault_tool_immutable_soul_spend': ('public fun fake<T>(s:&soulidity_standard::soul::Soul,ctx:&mut TxContext):sui::coin::Coin<T>{soulidity_application::vault::withdraw_coin(s,1,vector::tabulate!(32,|_|9),0,0,ctx)}', False, 'EC04006'),
    'positive_visual_variant_native_control': ('public fun issue<C>(p:&soulidity_v1::catalog::Product<C>,c:&soulidity_v1::catalog::Control,scene:soulidity_visual::visual::Scene,a:vector<soulidity_model::policy::Adapter>):soulidity_model::assembly::Variant{soulidity_v1::catalog::visual_variant(p,c,1,scene,a)}', True, None),
    'positive_visual_variant_metadata_store': ('public struct View has store{v:soulidity_model::assembly::Variant} public fun read(v:&View):vector<u8>{soulidity_model::assembly::variant_hash(&v.v)}', True, None),
    'positive_visual_variant_holder_atomic_update': ('public fun update(s:&mut soulidity_standard::soul::Soul,v:vector<soulidity_model::assembly::Variant>,ctx:&mut TxContext):vector<soulidity_model::components::Item>{let slots=soulidity_application::character::capture_slots(s);let colors=soulidity_application::character::colors(s);let profiles=soulidity_application::character::profile_snapshots(s);let rev=soulidity_application::character::revision(s);let recipe=soulidity_application::character::recipe_hash(s);soulidity_application::character::apply_variant_loadout(s,v,slots,vector[],colors,profiles,rev,recipe,ctx)}', True, None),
    'foreign_visual_variant_constructor': ('public fun attack(p:soulidity_model::assembly::Profile,t:soulidity_visual::visual::Scene):soulidity_model::assembly::Variant{soulidity_model::assembly::Variant{domain:vector[],schema:1,original:p,target:t,adapters:vector[],target_hash:vector[],commitment:vector[]}}', False, 'EC04001'),
    'foreign_visual_variant_scene_mutation': ('public fun attack(v:&mut soulidity_model::assembly::Variant,t:soulidity_visual::visual::Scene){v.target=t}', False, 'EC04001'),
    'foreign_visual_variant_hash_mutation': ('public fun attack(v:&mut soulidity_model::assembly::Variant){v.commitment=vector[]}', False, 'EC04001'),
    'foreign_visual_variant_publication_mutation': ('public fun attack(v:&mut soulidity_model::assembly::Variant,p:soulidity_model::assembly::Profile){v.original=p}', False, 'EC04001'),
    'foreign_visual_variant_asset_transfer': ('public fun attack(v:soulidity_model::assembly::Variant){transfer::public_transfer(v,@0xb)}', False, 'EC05001'),
    'foreign_visual_variant_immutable_holder_update': ('public fun attack(s:&soulidity_standard::soul::Soul,ctx:&mut TxContext){soulidity_application::character::apply_variant_loadout(s,vector[],vector[],vector[],vector[],vector[],0,vector[],ctx);}', False, 'EC04006'),
    'foreign_visual_variant_native_witness': ('public fun attack():soulidity_v1::catalog::PolicyProducer{soulidity_v1::catalog::PolicyProducer{}}', False, 'EC04001'),
    'foreign_visual_variant_active_uid_escape': ('public fun attack(v:&mut soulidity_application::character::ActiveVariants):&mut UID{&mut v.id}', False, 'EC04001'),
    'foreign_visual_variant_active_key': ('public fun attack():soulidity_application::character::ActiveVariantsKey{soulidity_application::character::ActiveVariantsKey{}}', False, 'EC04001'),
    'foreign_visual_variant_snapshot_mapping_mutation': ('public fun attack(v:&mut soulidity_application::forms::VisualVariants){v.scopes=vector[]}', False, 'EC04001'),
    'foreign_visual_variant_snapshot_key': ('public fun attack():soulidity_application::forms::VisualVariantsKey{soulidity_application::forms::VisualVariantsKey{}}', False, 'EC04001'),
    'positive_growth_private_source_receipt': ('public struct GrowthProducer has drop {} public struct Source has key{id:UID} public fun issue(p:&Source,target:ID,c:&sui::clock::Clock):soulidity_application::growth::Receipt{soulidity_application::growth::issue(GrowthProducer{},p,target,std::hash::sha3_256(b"r"),1,0,1,b"run",b"event",1,1,0,1000,std::hash::sha3_256(b"e"),std::hash::sha3_256(b"c"),c)}', True, None),
    'positive_growth_holder_acceptance': ('public fun accept(s:&mut soulidity_standard::soul::Soul,r:soulidity_application::growth::Receipt,c:&sui::clock::Clock,ctx:&mut TxContext){let revision=soulidity_standard::soul::revision(s);soulidity_application::growth::accept(s,r,1,revision,c,ctx)}', True, None),
    'positive_growth_async_receipt_store_copy': ('public struct Outbox has key,store{id:UID,receipt:soulidity_application::growth::Receipt} public fun copy_receipt(o:&Outbox):soulidity_application::growth::Receipt{o.receipt}', True, None),
    'foreign_growth_witness_constructor': ('public fun attack():soulidity_application::growth::Witness{soulidity_application::growth::Witness{}}', False, 'EC04001'),
    'foreign_growth_receipt_target_mutation': ('public fun attack(r:&mut soulidity_application::growth::Receipt,target:ID){r.target=target}', False, 'EC04001'),
    'foreign_growth_receipt_source_mutation': ('public fun attack(r:&mut soulidity_application::growth::Receipt,source:soulidity_application::growth::SourceKey){r.source=source}', False, 'EC04001'),
    'foreign_growth_receipt_sequence_mutation': ('public fun attack(r:&mut soulidity_application::growth::Receipt){r.sequence=2}', False, 'EC04001'),
    'foreign_growth_journal_replay_reset': ('public fun attack(j:&mut soulidity_application::growth::Journal){j.generation=0;j.revision=0}', False, 'EC04001'),
    'foreign_growth_journal_uid_escape': ('public fun attack(j:&mut soulidity_application::growth::Journal):&mut UID{&mut j.id}', False, 'EC04001'),
    'foreign_growth_holder_immutable_acceptance': ('public fun attack(s:&soulidity_standard::soul::Soul,r:soulidity_application::growth::Receipt,c:&sui::clock::Clock,ctx:&mut TxContext){soulidity_application::growth::accept(s,r,1,1,c,ctx)}', False, 'EC04006'),
    'foreign_growth_receipt_direct_asset_transfer': ('public fun attack(r:soulidity_application::growth::Receipt){transfer::public_transfer(r,@0xb)}', False, 'EC05001'),
    'foreign_physical_private_issue_with_metadata': ('public fun attack(r:&mut soulidity_v1::physical::Registry<sui::sui::SUI>,p:soulidity_application::physical_metadata::Proof,c:soulidity_application::visual_capture::Capture,ctx:&mut TxContext):soulidity_v1::physical::Asset{soulidity_v1::physical::issue(r,vector[],vector[],option::some(p),c,vector[],ctx)}',False,'EC04001'),
    'positive_physical_proof_metadata': ('public fun hash(p:&soulidity_application::physical_metadata::Proof):vector<u8>{soulidity_application::physical_metadata::proof_hash(p)}',True,None),

    'positive_capture_owned_creation': ('public struct CaptureProducer has drop {} public struct Parent has key{id:UID} public fun own(p:&Parent,profile:soulidity_model::assembly::Profile,ctx:&mut TxContext):soulidity_application::visual_capture::Capture{soulidity_application::visual_capture::new(CaptureProducer{},p,object::id(p),0,profile,vector[],vector[],vector[],vector[],ctx)}',True,None),
    'positive_capture_owned_destroy': ('public struct CaptureProducer has drop {} public struct Parent has key{id:UID} public fun destroy(p:&Parent,c:soulidity_application::visual_capture::Capture){soulidity_application::visual_capture::destroy(CaptureProducer{},p,c)}',True,None),
    'foreign_capture_native_producer_constructor': ('public fun attack():soulidity_v1::physical::CaptureProducer{soulidity_v1::physical::CaptureProducer{}}',False,'EC04001'),
    'foreign_capture_controller_mutation': ('public fun attack(c:&mut soulidity_application::visual_capture::Capture,p:ID){c.carrier=p}',False,'EC04001'),

    'positive_output_owned_creation': ("public struct ContentOperator has drop {} public struct Parent has key{id:UID} public fun own(p:&Parent,s:&soulidity_standard::soul::Soul,i:&soulidity_application::output::Intent):soulidity_application::output::Creation{soulidity_application::output::authorize(ContentOperator{},p,s,i)}", True, None),
    'positive_output_receipt_metadata': ("public fun metadata(id:ID,r:soulidity_foundation::economics::PrimaryReceipt,h:vector<u8>,recipient:address,rev:u64):soulidity_application::output::Receipt{let line=soulidity_application::output::pay_line(id,1,h,r);soulidity_application::output::receipt(vector[line],recipient,rev)}", True, None),
    'foreign_output_creation_constructor': ("public fun attack(controller:soulidity_content::authority::Controller,intent:vector<u8>):soulidity_application::output::Creation{soulidity_application::output::Creation{controller,intent}}", False, 'EC04001'),
    'foreign_output_creation_copy': ("public fun attack(p:soulidity_application::output::Creation):(soulidity_application::output::Creation,soulidity_application::output::Creation){(copy p,p)}", False, 'EC05001'),
    'foreign_output_creation_discard': ("public fun attack(p:soulidity_application::output::Creation){let _=p;}", False, 'EC05001'),
    'foreign_output_creation_store': ("public struct Stash has store{creation:soulidity_application::output::Creation}", False, 'EC05001'),
    'foreign_output_native_mutable': ("public fun attack(s:&soulidity_standard::soul::Soul):&mut soulidity_application::output::Artifact{soulidity_application::character::original_output(s)}", False, 'EC04006'),
    'foreign_output_native_factory': ("public fun attack(s:soulidity_standard::soul::Soul,i:soulidity_application::output::Intent,p:soulidity_application::output::Policy,recipe:vector<soulidity_application::output::RecipeSlot>,scene:soulidity_visual::visual::Scene,blob:walrus::blob::Blob,system:&walrus::system::System,r:soulidity_application::output::Receipt,ctx:&mut TxContext):soulidity_application::output::Artifact{let d=soulidity_application::character::Draft{root:object::id(&s),state:soulidity_application::character::application_module_id(&s),actor:ctx.sender()};let a=soulidity_application::character::create_output(&d,&s,i,p,recipe,scene,vector[],vector[],vector[],blob,system,vector[],vector[],r,ctx);soulidity_application::character::finish(d,s,ctx.sender(),ctx);a}", False, 'EC04001'),
    'foreign_output_artifact_controller_mutation': ("public fun attack(a:&mut soulidity_application::output::Artifact,c:soulidity_content::authority::Controller){a.controller=c}", False, 'EC04001'),
    'foreign_output_uid': ("public fun attack(a:&mut soulidity_application::output::Artifact):&mut UID{&mut a.id}", False, 'EC04001'),
    'foreign_output_blob_mutable': ("public fun attack(a:&mut soulidity_application::output::Artifact):&mut walrus::blob::Blob{sui::dynamic_object_field::borrow_mut(&mut a.id,soulidity_application::output::RenderKey{})}", False, 'EC04001'),
    'foreign_market_role_constructor': ("public fun attack():soulidity_v1::market::MarketAuthority1{soulidity_v1::market::MarketAuthority1{}}", False, 'EC04001'),
    "positive_content_owned_metadata_store": (
        "public fun own(ctx:&mut TxContext){let mut s=soulidity_content::paged_store::new<u64>(ctx);soulidity_content::paged_store::append(&mut s,1);soulidity_content::paged_store::destroy(s)}", True, None
    ),
    "positive_content_own_controller": (
        "public struct ContentOperator has drop {} public struct Parent has key{ id:UID } public fun own(p:&Parent,s:&soulidity_standard::soul::Soul,ctx:&mut TxContext):soulidity_content::authorization::Authorization{soulidity_content::authorization::new(ContentOperator{},p,s,ctx)}", True, None
    ),
    "foreign_native_content_operator_constructor": (
        "public fun attack():soulidity_application::character::ContentOperator{soulidity_application::character::ContentOperator{}}", False, "EC04001"
    ),
    "foreign_content_controller_constructor": (
        "public fun attack(parent:ID,root:ID):soulidity_content::authority::Controller{soulidity_content::authority::Controller{operator:std::type_name::with_original_ids<u64>(),parent,root}}", False, "EC04001"
    ),
    "foreign_content_controller_operator_mutation": (
        "public fun attack(c:&mut soulidity_content::authority::Controller){c.operator=std::type_name::with_original_ids<u64>()}", False, "EC04001"
    ),
    "foreign_content_internal_permits": (
        "public fun attack(a:&soulidity_content::authorization::Authorization,c:&sui::clock::Clock):bool{soulidity_content::authorization::internal_permits(a,@0xb,@0x8,2,c)}", False, "EC04001"
    ),
    "foreign_content_native_authorization_mutable": (
        "public fun attack(s:&soulidity_standard::soul::Soul):&mut soulidity_content::authorization::Authorization{soulidity_application::character::authorization(s)}", False, "EC04006"
    ),
    "foreign_content_native_library_mutable": (
        "public fun attack(s:&soulidity_standard::soul::Soul):&mut soulidity_content::loadout::Library{soulidity_application::character::loadouts(s)}", False, "EC04006"
    ),
    "foreign_content_native_paid_ledger_mutable": (
        "public fun attack(s:&soulidity_standard::soul::Soul):&mut soulidity_content::paid_access::Ledger{soulidity_application::character::paid_access(s)}", False, "EC04006"
    ),
    "foreign_content_native_record_mutable": (
        "public fun attack(s:&soulidity_standard::soul::Soul):&mut soulidity_content::document::Record{soulidity_application::character::content_record(s,0)}", False, "EC04006"
    ),

    "positive_component_permit_consumer": (
        "public fun consume(p:soulidity_model::components::Permit,s:&soulidity_standard::soul::Soul,ctx:&mut TxContext):(soulidity_model::policy::Source,Option<soulidity_model::components::Item>){soulidity_model::components::materialize(p,object::id(s),ctx)}", True, None
    ),
    "positive_component_permit_preview": (
        "public fun view(p:&soulidity_model::components::Permit):soulidity_model::policy::Source{*soulidity_model::components::preview(p)}", True, None
    ),
    "foreign_component_producer_constructor": (
        "public fun attack():soulidity_v1::catalog::ComponentProducer{soulidity_v1::catalog::ComponentProducer{}}", False, "EC04001"
    ),
    "foreign_component_permit_constructor": (
        "public fun attack(source:soulidity_model::policy::Source,target:ID):soulidity_model::components::Permit{soulidity_model::components::Permit{source,target}}", False, "EC04001"
    ),
    "foreign_component_permit_copy": (
        "public fun attack(p:soulidity_model::components::Permit):(soulidity_model::components::Permit,soulidity_model::components::Permit){(copy p,p)}", False, "EC05001"
    ),
    "foreign_component_permit_discard": (
        "public fun attack(p:soulidity_model::components::Permit){let _=p;}", False, "EC05001"
    ),
    "foreign_component_permit_store": (
        "public struct Stash has store{permit:soulidity_model::components::Permit}", False, "EC05001"
    ),
    "foreign_component_permit_transfer": (
        "public fun attack(p:soulidity_model::components::Permit,r:address){transfer::public_transfer(p,r)}", False, "EC05001"
    ),
    "foreign_component_item_constructor": (
        "public fun attack(source:soulidity_model::policy::Source,ctx:&mut TxContext):soulidity_model::components::Item{soulidity_model::components::Item{id:object::new(ctx),source}}", False, "EC04001"
    ),
    "foreign_component_permit_target_mutation": (
        "public fun attack(p:&mut soulidity_model::components::Permit,target:ID){p.target=target}", False, "EC04001"
    ),
    "positive_model_source_type": (
        "public fun view(s:&soulidity_model::policy::Source):std::type_name::TypeName{soulidity_model::policy::source_type(s)}", True, None
    ),
    "positive_model_definition_value_extend": (
        "public fun view(d:&soulidity_model::policy::Definition,s:&soulidity_visual::visual::Scene,f:vector<soulidity_visual::visual::Fragment>):soulidity_model::policy::Definition{soulidity_model::policy::extended_definition(d,s,f)}", True, None
    ),
    "foreign_policy_producer_constructor": (
        "public fun attack():soulidity_v1::catalog::PolicyProducer{soulidity_v1::catalog::PolicyProducer{}}", False, "EC04001"
    ),
    "foreign_model_source_type_replacement": (
        "public fun attack(s:&mut soulidity_model::policy::Source){s.source_type=std::type_name::with_defining_ids<u64>()}", False, "EC04001"
    ),
    "foreign_item_issue_from_preview": (
        "public fun attack(s:soulidity_model::policy::Source,ctx:&mut TxContext):soulidity_model::components::Item{soulidity_model::components::issue_item(s,ctx)}", False, "EC04001"
    ),
    "positive_standard_product_manifest": (
        "public fun view(s:&soulidity_standard::soul::Soul):vector<u8>{soulidity_application::character::manifest_standard_hash(&soulidity_application::character::manifest(s))}", True, None
    ),
    "positive_standard_listing_inventory": (
        "public fun view<C>(l:&soulidity_v1::market::Listing<soulidity_standard::soul::Soul,C>):soulidity_standard::soul::Manifest{soulidity_v1::market::bundle_standard(l)}", True, None
    ),
    "foreign_app_witness_constructor": (
        "public fun attack():soulidity_application::character::ApplicationWitness{soulidity_application::character::ApplicationWitness{}}", False, "EC04001"
    ),
    "foreign_producer_witness_constructor": (
        "public fun attack():soulidity_v1::catalog::SoulProducer{soulidity_v1::catalog::SoulProducer{}}", False, "EC04001"
    ),
    "foreign_app_uid_escape": (
        "public fun attack(s:&mut soulidity_application::character::ApplicationState):&mut UID{&mut s.id}", False, "EC04001"
    ),
    "foreign_app_root_rebinding": (
        "public fun attack(s:&mut soulidity_application::character::ApplicationState){s.root=@0xb.to_id()}", False, "EC04001"
    ),
    "positive_forms_immutable_views": (
        "public fun inspect(s:&soulidity_standard::soul::Soul,r:soulidity_application::forms::Reference):vector<u8>{let j=soulidity_application::forms::journal(s);let f=soulidity_application::forms::snapshot(j,r);soulidity_application::forms::commitment(f)}", True, None
    ),
    "positive_forms_actual_custody_save": (
        "public fun save(s:&mut soulidity_standard::soul::Soul,name:vector<u8>,parent:Option<soulidity_application::forms::Reference>,head:u64,journal:u64,root:u64,app:u64,ctx:&mut TxContext):soulidity_application::forms::Reference{soulidity_application::forms::save(s,name,parent,head,journal,root,app,ctx)}", True, None
    ),
    "foreign_forms_witness_construct": (
        "public fun attack():soulidity_application::forms::Witness{soulidity_application::forms::Witness{}}", False, "EC04001"
    ),
    "foreign_forms_journal_mutation": (
        "public fun attack(j:&mut soulidity_application::forms::Journal){j.root=object::id_from_address(@0xb);j.revision=0}", False, "EC04001"
    ),
    "foreign_forms_snapshot_mutation": (
        "public fun attack(f:&mut soulidity_application::forms::Snapshot){f.root=object::id_from_address(@0xb);f.commitment=vector[]}", False, "EC04001"
    ),
    "foreign_forms_activation_forgery": (
        "public fun attack(a:&mut soulidity_application::forms::Activation){a.reference=soulidity_application::forms::reference(b\"fake\",1)}", False, "EC04001"
    ),
    "foreign_app_factory": (
        "public fun attack(root:&soulidity_standard::soul::Soul,profile:soulidity_model::assembly::Profile,scene:soulidity_visual::visual::Scene,snapshot:soulidity_application::resale::Snapshot,ctx:&mut TxContext):soulidity_application::character::ApplicationState{soulidity_application::character::state_new(root,std::type_name::with_original_ids<u64>(),object::id(root),object::id(root),1,vector[],vector[],profile,vector[],vector[],scene,snapshot,@0xb,ctx)}", False, "EC04001"
    ),

    "positive_config_role_view": (
        "public fun view<C>(c:&soulidity_foundation::economics::Config<C>):vector<u8>{std::bcs::to_bytes(&soulidity_foundation::economics::role(c,0))}", True, None
    ),
    "foreign_config_role_state_mutation": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>){c.roles=abort 7;}", False, "EC04001"
    ),
    "foreign_config_role_view_mutation": (
        "public fun attack<C>(c:&soulidity_foundation::economics::Config<C>){let mut r=soulidity_foundation::economics::role(c,0);r.original=object::id_from_address(@0xa)}", False, "EC04001"
    ),
    "positive_installation_guarded_native": (
        "public fun install<C>(c:&mut soulidity_foundation::economics::Config<C>,a:&mut soulidity_foundation::economics::Admin,p:soulidity_foundation::economics::Installation<C,soulidity_v1::native_binding::Catalog<C>>,v:soulidity_v1::native_binding::Catalog<C>,h:vector<u8>) { soulidity_foundation::economics::install_native(c,a,p,v,0,h) }", True, None
    ),
    "foreign_installation_construct": (
        "public fun attack<C>():soulidity_foundation::economics::Installation<C,soulidity_v1::native_binding::Catalog<C>> { soulidity_foundation::economics::Installation { config:object::id_from_address(@0x1),revision:0,commitment:vector[],kind:0,original:object::id_from_address(@0x1),callable:object::id_from_address(@0x1),marker:std::type_name::with_defining_ids<soulidity_v1::native_binding::NativeRevision1>(),value:object::id_from_address(@0x1),generation:0,value_commitment:vector[] } }", False, "EC04001"
    ),
    "foreign_installation_discard": (
        "public fun attack<C,T>(p:soulidity_foundation::economics::Installation<C,T>) {}", False, "EC06001"
    ),
    "foreign_installation_store": (
        "public struct Stored<phantom C,phantom T> has key {id:UID,permit:soulidity_foundation::economics::Installation<C,T>}", False, "EC05001"
    ),
    "foreign_installation_copy": (
        "public fun attack<C,T>(p:soulidity_foundation::economics::Installation<C,T>):(soulidity_foundation::economics::Installation<C,T>,soulidity_foundation::economics::Installation<C,T>) { (copy p,p) }", False, "EC05001"
    ),
    "foreign_installation_mutation": (
        "public fun attack<C,T>(p:&mut soulidity_foundation::economics::Installation<C,T>) { p.revision=0;p.kind=1; }", False, "EC04001"
    ),
    "foreign_installation_wrong_coin": (
        "public fun attack(c:&mut soulidity_foundation::economics::Config<sui::sui::SUI>,a:&mut soulidity_foundation::economics::Admin,p:soulidity_foundation::economics::Installation<u64,soulidity_v1::native_binding::Catalog<sui::sui::SUI>>,v:soulidity_v1::native_binding::Catalog<sui::sui::SUI>,h:vector<u8>) { soulidity_foundation::economics::install_native(c,a,p,v,0,h) }", False, "EC04007"
    ),
    "positive_community_profile_count": (
        "public fun inspect(r:&soulidity_community::profile::ProfileRegistryV1):u64 { soulidity_community::profile::profile_count(r) }", True, None
    ),
    "positive_community_post_time": (
        "public fun inspect(p:&soulidity_community::community_posts::PostV1):u64 { soulidity_community::community_posts::updated_at_ms(p) }", True, None
    ),
    "foreign_community_registered_profile": (
        "public fun attack(r:&soulidity_community::profile::ProfileRegistryV1,a:address,id:ID):bool { soulidity_community::profile::is_registered_profile(r,a,id) }", False, "EC04001"
    ),
    "foreign_community_assert_post": (
        "public fun attack(r:&soulidity_community::community_posts::CommunityRegistryV1,p:&soulidity_community::profile::ProfileRegistryV1,t:&soulidity_community::community_posts::PostV1) { soulidity_community::community_posts::assert_post(r,p,t) }", False, "EC04001"
    ),
    "foreign_community_profile_owner": (
        "public fun attack(p:&mut soulidity_community::profile::WalletProfileV1) { p.owner=@0xb; }", False, "EC04001"
    ),
    "foreign_community_registry_transfer": (
        "public fun attack(r:soulidity_community::profile::ProfileRegistryV1,to:address) { sui::transfer::public_transfer(r,to) }", False, "EC05001"
    ),
    "positive_metadata_revision": (
        "public fun inspect(m:&soulidity_v1::metadata::Metadata):u64 { soulidity_v1::metadata::revision(m) }", True, None
    ),
    "positive_metadata_canonical_hash": (
        "public fun inspect(m:&soulidity_v1::metadata::Metadata):vector<u8> { soulidity_v1::metadata::policy_hash(m) }", True, None
    ),
    "foreign_metadata_mutation": (
        "public fun attack(m:&mut soulidity_v1::metadata::Metadata) { m.actor=@0xb;m.revision=0; }", False, "EC04001"
    ),
    "public_transfer_metadata": (
        "public fun attack(m:soulidity_v1::metadata::Metadata,to:address) { sui::transfer::public_transfer(m,to) }", False, "EC05001"
    ),
    "foreign_metadata_value_mutation": (
        "public fun attack(v:&mut soulidity_v1::metadata::Value,c:soulidity_v1::catalog::Version) { v.version=c; }", False, "EC04001"
    ),
    "foreign_catalog_metadata_append": (
        "public fun attack(v:&mut soulidity_v1::catalog::Version,d:vector<soulidity_model::policy::Definition>) { soulidity_v1::catalog::append_definitions(v,d) }", False, "EC04001"
    ),
    "positive_visual_value_extend": (
        "public fun attack(r:&soulidity_visual::visual::Representation,s:&soulidity_visual::visual::Scene,f:vector<soulidity_visual::visual::Fragment>):soulidity_visual::visual::Representation { soulidity_visual::visual::extend_representation(r,s,f) }", True, None
    ),
    "foreign_policy_metadata_extend": (
        "public fun attack(d:&mut soulidity_model::policy::Definition,s:&soulidity_visual::visual::Scene,f:vector<soulidity_visual::visual::Fragment>) { d.representation=soulidity_visual::visual::extend_representation(soulidity_model::policy::representation(d),s,f) }", False, "EC04001"
    ),
    "foreign_vault_tool_raw_update": (
        "public fun attack(s:&mut soulidity_standard::soul::Soul){let(v,t)=soulidity_application::vault::open(s,0,0);soulidity_application::vault::close(s,t,v)}", False, "EC04001"
    ),
    "positive_certified_runtime_player": (
        "public fun create<C>(p:&mut soulidity_v1::catalog::Product<C>,c:&soulidity_foundation::economics::Config<C>,clock:&sui::clock::Clock,s:&walrus::system::System,ctx:&mut TxContext):ID { soulidity_v1::runtime::create_player(p,c,1,0,1000,vector[1],clock,s,ctx) }", True, None
    ),
    "positive_certified_runtime_metadata": (
        "public fun inspect(b:&soulidity_v1::runtime::Build):ID { soulidity_v1::runtime::soul_id(b) }", True, None
    ),
    "foreign_runtime_build_construct": (
        "public fun attack(b:soulidity_v1::issuer::Build):soulidity_v1::runtime::Build { soulidity_v1::runtime::Build{inner:b,system:object::id_from_address(@0x99),epoch:0} }", False, "EC04001"
    ),
    "foreign_runtime_build_inner": (
        "public fun attack(b:&mut soulidity_v1::runtime::Build):&mut soulidity_v1::issuer::Build { &mut b.inner }", False, "EC04001"
    ),
    "foreign_runtime_build_store": (
        "public struct Stored has key {id:UID,build:soulidity_v1::runtime::Build}", False, "EC05001"
    ),
    "foreign_runtime_build_discard": (
        "public fun attack(b:soulidity_v1::runtime::Build) {}", False, "EC06001"
    ),
    "foreign_raw_complete_begin": (
        "public fun attack<C>(binding:soulidity_application::issuance::Binding,m:&mut soulidity_v1::catalog::Product<C>,cfg:&mut soulidity_foundation::economics::Config<C>,i:soulidity_application::output::Intent,p:sui::coin::Coin<C>,clock:&sui::clock::Clock,ctx:&mut TxContext):soulidity_v1::issuer::Build { soulidity_v1::issuer::begin(binding,m,cfg,i,b\"default\",0,1000,p,clock,ctx) }", False, "EC04001"
    ),
    "foreign_raw_access_payment": (
        "public fun attack<C>(m:&mut soulidity_v1::catalog::Product<C>,cfg:&mut soulidity_foundation::economics::Config<C>,p:sui::coin::Coin<C>,clock:&sui::clock::Clock,ctx:&mut TxContext) { soulidity_v1::catalog::buy_access(m,cfg,1,vector[1],0,1000,vector[1],p,clock,ctx) }", False, "EC04001"
    ),
    "foreign_publication_custody_uid": (
        "public fun attack(c:&mut soulidity_v1::release::Certificate):&mut UID { &mut c.custody.id }", False, "EC04001"
    ),
    "foreign_publication_custody_replacement": (
        "public fun attack(c:&mut soulidity_v1::release::Certificate) { c.custody=abort 7 }", False, "EC04001"
    ),
    "foreign_storage_end_epoch_mutation": (
        "public fun attack(r:&mut soulidity_content::storage::Reference) { r.end_epoch=999 }", False, "EC04001"
    ),
    "positive_publication_certificate_read": (
        "public fun inspect<C>(p:&soulidity_v1::catalog::Product<C>):vector<u8> { soulidity_v1::release::certificate_hash(soulidity_v1::release::certificate(p,1)) }", True, None
    ),
    "positive_publication_scope_read": (
        "public fun inspect(c:&soulidity_v1::release::Certificate):vector<u8> { soulidity_v1::release::asset_scope(soulidity_v1::release::certificate_asset(c,0)) }", True, None
    ),
    "bypass_certified_publication": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,c:&mut soulidity_v1::catalog::Control,v:soulidity_v1::catalog::Version) { soulidity_v1::catalog::publish(p,c,0,v) }", False, "EC04001"
    ),
    "bypass_certified_lifecycle": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,c:&mut soulidity_v1::catalog::Control) { soulidity_v1::catalog::lifecycle(p,c,1,1) }", False, "EC04001"
    ),
    "foreign_publication_attachment": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,c:soulidity_v1::release::Certificate) { soulidity_v1::catalog::attach_certification(p,1,c) }", False, "EC04001"
    ),
    "foreign_publication_root_uid": (
        "public fun attack(c:&mut soulidity_v1::release::Certificate):&mut UID { &mut c.id }", False, "EC04001"
    ),
    "foreign_publication_draft_mutation": (
        "public fun attack(d:&mut soulidity_v1::release::Draft) { d.revision=0 }", False, "EC04001"
    ),
    "foreign_release_config_mutation": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>) { c.release_binding=std::option::none() }", False, "EC04001"
    ),
    "foreign_release_catalog_install": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>,a:&mut soulidity_foundation::economics::Admin,r:soulidity_v1::release::Catalog<C>,h:vector<u8>) { let p=soulidity_foundation::economics::authorize_installation<C,soulidity_v1::release::ReleaseInstaller1,soulidity_v1::release::ReleaseRevision1,soulidity_v1::release::Catalog<C>>(c,a,0,h,1,soulidity_v1::release::ReleaseInstaller1{},soulidity_v1::release::ReleaseRevision1{},&r,0,vector[1]);soulidity_foundation::economics::install_release(c,a,p,r,0,vector[1]) }", False, "EC04001"
    ),
    "public_transfer_publication_draft": (
        "public fun attack(d:soulidity_v1::release::Draft,to:address) { sui::transfer::public_transfer(d,to) }", False, "EC05001"
    ),
    "foreign_publication_certificate_mutation": (
        "public fun attack(c:&mut soulidity_v1::release::Certificate) { c.commitment=vector[] }", False, "EC04001"
    ),
    "positive_native_type_discovery": (
        "public fun inspect<C>(c:&soulidity_foundation::economics::Config<C>):std::type_name::TypeName { soulidity_v1::native_binding::role(soulidity_v1::native_binding::current(c),0) }", True, None
    ),
    "positive_native_defining_discovery": (
        "public fun inspect<C>(c:&soulidity_foundation::economics::Config<C>):std::type_name::TypeName { soulidity_v1::native_binding::role_defining(soulidity_v1::native_binding::current(c),1) }", True, None
    ),
    "foreign_native_catalog_mutation": (
        "public fun attack<C>(r:&mut soulidity_v1::native_binding::Catalog<C>) { r.roles=vector[] }", False, "EC04001"
    ),
    "foreign_native_catalog_uid": (
        "public fun attack<C>(r:&mut soulidity_v1::native_binding::Catalog<C>):&mut UID { &mut r.id }", False, "EC04001"
    ),
    "foreign_native_snapshot_mutation": (
        "public fun attack(r:&mut soulidity_foundation::economics::NativeBindingSnapshot) { r.catalog=object::id_from_address(@0x99) }", False, "EC04001"
    ),
    "foreign_minimum_release_mutation": (
        "public fun attack<C>(r:&mut soulidity_foundation::economics::Config<C>) { r.minimum_release=0 }", False, "EC04001"
    ),
    "foreign_new_protocol_config": (
        "public fun attack<C>(ctx:&mut TxContext):(soulidity_foundation::economics::Config<C>,soulidity_foundation::economics::Admin) { soulidity_foundation::economics::new_config(0,0,0,@0xb,ctx) }", False, "EC04001"
    ),
    "foreign_native_installation": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>,a:&mut soulidity_foundation::economics::Admin,r:soulidity_v1::native_binding::Catalog<C>,h:vector<u8>) { let p=soulidity_foundation::economics::authorize_installation<C,soulidity_v1::native_binding::NativeInstaller1,soulidity_v1::native_binding::NativeRevision1,soulidity_v1::native_binding::Catalog<C>>(c,a,0,h,0,soulidity_v1::native_binding::NativeInstaller1{},soulidity_v1::native_binding::NativeRevision1{},&r,0,vector[1]);soulidity_foundation::economics::install_native(c,a,p,r,0,vector[1]) }", False, "EC04001"
    ),
    "readonly_native_install_config": (
        "public fun attack<C>(c:&soulidity_foundation::economics::Config<C>,a:&mut soulidity_foundation::economics::Admin,ctx:&mut TxContext) { soulidity_v1::native_binding::install(c,a,0,vector[],ctx); }", False, "EC04006"
    ),
    "readonly_native_install_admin": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>,a:&soulidity_foundation::economics::Admin,ctx:&mut TxContext) { soulidity_v1::native_binding::install(c,a,0,vector[],ctx); }", False, "EC04006"
    ),
    "positive_enhancement_purchase": (
        "public fun describe(h:vector<u8>,p:soulidity_model::assembly::PartKey,l:soulidity_model::policy::Layout):soulidity_v1::issuer::Purchase { soulidity_v1::issuer::purchase(h,p,l) }", True, None
    ),
    "positive_enhancement_receipt_metadata": (
        "public fun inspect(s:&soulidity_standard::soul::Soul):u64 { soulidity_application::character::enhancement_count(s) }", True, None
    ),
    "foreign_enhancement_receipt_mutation": (
        "public fun attack(r:&mut soulidity_application::character::EnhancementReceipt) { r.actor=@0xb }", False, "EC04001"
    ),
    "foreign_enhancement_table_access": (
        "public fun attack(s:&mut soulidity_application::character::Composition):&mut UID { &mut s.enhancements.id }", False, "EC04001"
    ),
    "foreign_replace_issued": (
        "public fun attack(root:ID,state:ID,payment:soulidity_foundation::economics::PrimaryReceipt):soulidity_application::character::Enhancement{soulidity_application::character::Enhancement{root,state,actor:@0xb,product:root,version:1,policy:vector[],before_revision:0,before_recipe:vector[],payment}}", False, "EC04001"
    ),
    "foreign_finish_enhancement": (
        "public fun attack(s:&mut soulidity_standard::soul::Soul,h:vector<u8>,r:soulidity_foundation::economics::PrimaryReceipt,ctx:&TxContext){soulidity_application::character::finish_enhancement(r,s,h,ctx)}", False, "EC04007"
    ),
    "readonly_soul_enhance_pack": (
        "public fun attack<C>(s:&soulidity_standard::soul::Soul,p:&mut soulidity_v1::catalog::Product<C>,m:&soulidity_v1::catalog::Product<C>,c:&mut soulidity_foundation::economics::Config<C>,coin:sui::coin::Coin<C>,clock:&sui::clock::Clock,ctx:&mut TxContext):vector<soulidity_model::components::Item> { soulidity_v1::issuer::enhance_pack(s,p,m,c,1,0,vector[],vector[],vector[],0,1000,coin,clock,ctx) }", False, "EC04006"
    ),
    "positive_paged_original_slot": (
        "public fun inspect(a:&soulidity_application::output::Artifact):soulidity_model::assembly::PartKey { soulidity_application::output::slot_part(soulidity_application::output::original_slot(a,0)) }", True, None
    ),
    "positive_paged_capture_slot": (
        "public fun inspect(c:&soulidity_application::visual_capture::Capture):u64 { soulidity_application::visual_capture::slot_count(c) }", True, None
    ),
    "positive_paged_store_constructor": (
        "public fun attack(ctx:&mut TxContext):soulidity_content::paged_store::Store<u64> { soulidity_content::paged_store::new(ctx) }", True, None
    ),
    "positive_paged_store_append": (
        "public fun attack(s:&mut soulidity_content::paged_store::Store<u64>) { soulidity_content::paged_store::append(s,0); }", True, None
    ),
    "positive_paged_store_destroy": (
        "public fun attack(s:soulidity_content::paged_store::Store<u64>) { soulidity_content::paged_store::destroy(s) }", True, None
    ),
    "foreign_paged_location_mutation": (
        "public fun attack(s:&mut soulidity_content::paged_store::Store<u64>) { s.locations=vector[] }", False, "EC04001"
    ),
    "foreign_root_visual_mutation": (
        "public fun attack(s:&mut soulidity_application::character::RootVisual,v:soulidity_visual::visual::Scene) { s.scene=v }", False, "EC04001"
    ),
    "foreign_recovery_envelope_mutation": (
        "public fun attack(s:&mut soulidity_application::output::RecoveryEnvelope) { s.bytes=vector[] }", False, "EC04001"
    ),
    "positive_actual_pack_admission": (
        "public fun mount<C>(s:&mut soulidity_standard::soul::Soul,p:&soulidity_v1::catalog::Product<C>):soulidity_model::assembly::Scope { soulidity_application::character::admit_pack(s,soulidity_v1::catalog::assembly_profile(p,1),0) }", True, None
    ),
    "readonly_soul_pack_admission": (
        "public fun attack<C>(s:&soulidity_standard::soul::Soul,p:&soulidity_v1::catalog::Product<C>) { soulidity_application::character::admit_pack(s,soulidity_v1::catalog::assembly_profile(p,1),0) }", False, "EC04006"
    ),
    "positive_physical_visual_metadata": (
        "public fun inspect(a:&Asset):vector<u8> { soulidity_application::visual_capture::commitment(soulidity_v1::physical::asset_visual(a)) }", True, None
    ),
    "positive_frozen_visual_render": (
        "public fun inspect(c:&soulidity_application::visual_capture::Capture,ctx:&mut TxContext):vector<soulidity_visual::visual::Layer> { soulidity_application::visual_capture::render_plan(c,ctx) }", True, None
    ),
    "positive_published_definition_metadata": (
        "public fun inspect(v:&soulidity_v1::catalog::Version):vector<soulidity_model::policy::Definition> { soulidity_v1::catalog::definitions(v) }", True, None
    ),
    "foreign_visual_capture_constructor": (
        "public fun attack(r:&soulidity_v1::physical::Registry<sui::sui::SUI>,p:soulidity_model::assembly::Profile,ctx:&mut TxContext):soulidity_application::visual_capture::Capture { soulidity_application::visual_capture::new(soulidity_v1::physical::CaptureProducer{},r,object::id_from_address(@0x1),0,p,vector[],vector[],vector[],vector[],ctx) }", False, "EC04001"
    ),
    "foreign_visual_capture_destroy": (
        "public fun attack(r:&soulidity_v1::physical::Registry<sui::sui::SUI>,c:soulidity_application::visual_capture::Capture) { soulidity_application::visual_capture::destroy(soulidity_v1::physical::CaptureProducer{},r,c) }", False, "EC04001"
    ),
    "foreign_visual_capture_header_mutation": (
        "public fun attack(c:&mut soulidity_application::visual_capture::Capture) { c.recipe_hash=vector[1] }", False, "EC04001"
    ),
    "foreign_frozen_recipe_mutation": (
        "public fun attack(c:&mut soulidity_application::visual_capture::FrozenRecipe) { c.slots=vector[] }", False, "EC04001"
    ),
    "foreign_frozen_profile_mutation": (
        "public fun attack(c:&mut soulidity_application::visual_capture::Profiles) { c.keys=vector[] }", False, "EC04001"
    ),
    "foreign_capture_uid_extraction": (
        "public fun attack(c:&mut soulidity_application::visual_capture::Capture):&mut UID { &mut c.id }", False, "EC04001"
    ),
    "foreign_physical_capture_extraction": (
        "public fun attack(a:&mut Asset):soulidity_application::visual_capture::Capture { sui::dynamic_object_field::remove(&mut a.id,soulidity_v1::physical::VisualKey{}) }", False, "EC04001"
    ),
    "positive_scoped_soul_manifest_metadata": (
        "public fun inspect(s:&soulidity_standard::soul::Soul):vector<soulidity_model::assembly::ProfileSnapshot> { soulidity_application::character::manifest_profiles(&soulidity_application::character::manifest(s)) }", True, None
    ),
    "positive_original_output_profile_metadata": (
        "public fun inspect(a:&soulidity_application::output::Artifact):vector<soulidity_model::assembly::ProfileSnapshot> { soulidity_application::output::original_profiles(a) }", True, None
    ),
    "readonly_scoped_soul_palette": (
        "public fun attack(s:&soulidity_standard::soul::Soul,scope:soulidity_model::assembly::Scope) { soulidity_application::character::tune_pack_colors(s,scope,vector[],0) }", False, "EC04006"
    ),
    "foreign_initial_scoped_soul_palette": (
        "public fun attack(s:&mut soulidity_standard::soul::Soul,scope:soulidity_model::assembly::Scope,ctx:&TxContext):soulidity_application::character::Draft{let d=soulidity_application::character::Draft{root:object::id(s),state:soulidity_application::character::application_module_id(s),actor:ctx.sender()};soulidity_application::character::set_initial_pack_colors(&d,s,scope,vector[],ctx);d}", False, "EC04001"
    ),
    "foreign_original_output_profile_mutation": (
        "public fun attack(p:&mut soulidity_application::output::OriginalProfiles) { p.profiles=vector[] }", False, "EC04001"
    ),
    "foreign_soul_profile_admission": (
        "public fun attack(s:&mut soulidity_application::character::ApplicationState,p:soulidity_model::assembly::Profile) { soulidity_application::character::state_admit_profile(s,p) }", False, "EC04001"
    ),
    "positive_actual_assembly_profile_metadata": (
        "public fun inspect<C>(p:&soulidity_v1::catalog::Product<C>):soulidity_model::assembly::Scope { soulidity_model::assembly::profile_scope(&soulidity_v1::catalog::assembly_profile(p,1)) }", True, None
    ),
    "positive_typed_player_recipe_metadata": (
        "public fun inspect(p:&soulidity_v1::player::Player):vector<soulidity_model::assembly::ProfileSnapshot> { soulidity_v1::player::profiles(p) }", True, None
    ),
    "foreign_assembly_state_part_mutation": (
        "public fun attack(s:&mut soulidity_model::assembly::State) { s.parts=vector[] }", False, "EC04001"
    ),
    "foreign_profile_scene_forgery": (
        "public fun attack(scope:soulidity_model::assembly::Scope,scene:soulidity_visual::visual::Scene):soulidity_model::assembly::Profile { soulidity_model::assembly::Profile{scope,parent:option::none(),scene,parts:vector[b\"part\"],adapters:vector[]} }", False, "EC04001"
    ),
    "foreign_scope_constructor": (
        "public fun attack(id:ID):soulidity_model::assembly::Scope { soulidity_model::assembly::Scope{protocol:id,product:id,source_type:std::type_name::with_defining_ids<soulidity_v1::catalog::Product<u64>>(),version:1,policy:vector[1]} }", False, "EC04001"
    ),
    "positive_owned_profile_admission": (
        "public fun attack(s:&mut soulidity_model::assembly::State,b:&soulidity_visual::visual::Scene,p:soulidity_model::assembly::Profile) { soulidity_model::assembly::admit(s,b,p) }", True, None
    ),
    "readonly_player_pack_palette": (
        "public fun attack(p:&soulidity_v1::player::Player,scope:soulidity_model::assembly::Scope,ctx:&TxContext) { soulidity_v1::player::set_pack_colors(p,scope,vector[],0,ctx) }", False, "EC04006"
    ),
    "foreign_part_scope_mutation": (
        "public fun attack(mut p:soulidity_model::assembly::PartKey):soulidity_model::assembly::PartKey { p.scope=option::none();p }", False, "EC04001"
    ),
    "positive_publication_identity_metadata": (
        "public fun inspect<C>(p:&soulidity_v1::catalog::Product<C>):soulidity_v1::catalog::PublicationContext { soulidity_v1::catalog::publication(soulidity_v1::catalog::published(p,1)).destroy_some() }", True, None
    ),
    "foreign_pack_parent_snapshot_mutation": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>) { p.parent_snapshot=option::none() }", False, "EC04001"
    ),
    "foreign_parent_scene_mutation": (
        "public fun attack(mut p:soulidity_v1::catalog::ParentSnapshot,s:soulidity_visual::visual::Scene):soulidity_v1::catalog::ParentSnapshot { p.scene=s;p }", False, "EC04001"
    ),
    "foreign_publication_identity_mutation": (
        "public fun attack(mut p:soulidity_v1::catalog::PublicationContext):soulidity_v1::catalog::PublicationContext { p.product=object::id_from_address(@0x99);p }", False, "EC04001"
    ),
    "foreign_version_publication_mutation": (
        "public fun attack(mut v:soulidity_v1::catalog::Version):soulidity_v1::catalog::Version { v.publication=option::none();v }", False, "EC04001"
    ),
    "readonly_control_publish_pack": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,c:&soulidity_v1::catalog::Control,v:soulidity_v1::catalog::Version) { soulidity_v1::catalog::publish(p,c,0,v) }", False, "EC04001"
    ),
    "positive_scene_metadata": (
        "public fun inspect(s:&soulidity_standard::soul::Soul):vector<u8> { soulidity_visual::visual::scene_hash(soulidity_application::character::scene(s)) }", True, None
    ),
    "positive_standard_render_plan": (
        "public fun inspect(s:&soulidity_standard::soul::Soul):vector<soulidity_visual::visual::Layer> { soulidity_application::character::render_plan(s) }", True, None
    ),
    "foreign_scene_dimension_mutation": (
        "public fun attack(mut s:soulidity_visual::visual::Scene):soulidity_visual::visual::Scene { s.width=1;s }", False, "EC04001"
    ),
    "foreign_representation_source_mutation": (
        "public fun attack(mut r:soulidity_visual::visual::Representation):soulidity_visual::visual::Representation { r.scene_hash=vector[1];r }", False, "EC04001"
    ),
    "foreign_mapping_admission_mutation": (
        "public fun attack(mut m:soulidity_visual::visual::Mapping):soulidity_visual::visual::Mapping { m.scene=vector[1];m }", False, "EC04001"
    ),
    "foreign_soul_palette_mutation": (
        "public fun attack(c:&mut soulidity_application::character::Composition) { c.colors=vector[] }", False, "EC04001"
    ),
    "readonly_soul_palette": (
        "public fun attack(s:&soulidity_standard::soul::Soul) { soulidity_application::character::tune_colors(s,vector[],0) }", False, "EC04006"
    ),
    "foreign_initial_palette": (
        "public fun attack(s:&mut soulidity_standard::soul::Soul,ctx:&TxContext):soulidity_application::character::Draft{let d=soulidity_application::character::Draft{root:object::id(s),state:soulidity_application::character::application_module_id(s),actor:ctx.sender()};soulidity_application::character::set_initial_colors(&d,s,vector[],ctx);d}", False, "EC04001"
    ),
    "foreign_representation_forgery": (
        "public fun attack(s:&soulidity_visual::visual::Scene):soulidity_visual::visual::Representation { soulidity_visual::visual::Representation{domain:vector[],schema:1,scene_hash:soulidity_visual::visual::scene_hash(s),renderer:vector[],canvas_width:1,canvas_height:1,fragments:vector[],visible:vector[]} }", False, "EC04001"
    ),
    "positive_config_snapshot_metadata": (
        "public fun inspect<C>(c:&soulidity_foundation::economics::Config<C>):vector<u8> { soulidity_foundation::economics::snapshot_hash(&soulidity_foundation::economics::snapshot(c)) }", True, None
    ),
    "positive_runtime_access_guard": (
        "public fun check<C>(p:&soulidity_v1::catalog::Product<C>,c:&soulidity_foundation::economics::Config<C>,clock:&sui::clock::Clock,ctx:&TxContext) { let v=soulidity_v1::catalog::published(p,1);soulidity_v1::catalog::assert_runtime_access(p,c,1,soulidity_v1::catalog::policy_hash(v),soulidity_v1::catalog::manifest(v),soulidity_foundation::economics::revision(c),soulidity_foundation::economics::commitment(c),clock,ctx) }", True, None
    ),
    "readonly_admin_enable": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>,a:&soulidity_foundation::economics::Admin) { soulidity_foundation::economics::set_enabled(c,a,0,vector[1],true) }", False, "EC04006"
    ),
    "readonly_admin_rebind": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>,a:&soulidity_foundation::economics::Admin) { soulidity_foundation::economics::rebind_current_package(c,a,0,vector[1]) }", False, "EC04006"
    ),
    "foreign_config_enable_mutation": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>) { c.enabled=true;c.commitment=vector[1] }", False, "EC04001"
    ),
    "foreign_config_snapshot_mutation": (
        "public fun attack(mut s:soulidity_foundation::economics::ConfigSnapshot):soulidity_foundation::economics::ConfigSnapshot { s.enabled=true;s }", False, "EC04001"
    ),
    "foreign_ensure_access": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,c:&soulidity_foundation::economics::Config<C>,clock:&sui::clock::Clock,ctx:&mut TxContext) { soulidity_v1::catalog::ensure_access(p,c,1,vector[1],0,1000,clock,ctx) }", False, "EC04001"
    ),
    "readonly_maker_player_creation": (
        "public fun attack<C>(p:&soulidity_v1::catalog::Product<C>,c:&soulidity_foundation::economics::Config<C>,clock:&sui::clock::Clock,ctx:&mut TxContext) { soulidity_v1::player::create(p,c,1,0,1000,vector[1],clock,ctx); }", False, "EC04001"
    ),
    "foreign_wrong_coin_protocol_deposit": (
        "public fun attack<A,B>(c:&mut soulidity_foundation::economics::Config<A>,p:sui::coin::Coin<B>) { soulidity_foundation::economics::deposit_income(c,p) }", False, "EC04007"
    ),
    "readonly_config_complete": (
        "public fun attack<C>(binding:soulidity_application::issuance::Binding,m:&mut soulidity_v1::catalog::Product<C>,cfg:&soulidity_foundation::economics::Config<C>,i:soulidity_application::output::Intent,p:sui::coin::Coin<C>,clock:&sui::clock::Clock,ctx:&mut TxContext):soulidity_v1::issuer::Build { soulidity_v1::issuer::begin(binding,m,cfg,i,b\"default\",0,1000,p,clock,ctx) }", False, "EC04001"
    ),
    "readonly_product_physical_purchase": (
        "public fun attack<C>(r:&mut soulidity_v1::physical::Registry<C>,m:&soulidity_v1::catalog::Product<C>,p:&soulidity_v1::player::Player,cfg:&mut soulidity_foundation::economics::Config<C>,pay:sui::coin::Coin<C>,clock:&sui::clock::Clock,system:&walrus::system::System,ctx:&mut TxContext) { let a=soulidity_v1::runtime::physical_purchase(r,m,p,b\"ref\",cfg,pay,0,0,0,0,1000,vector[1],vector[1],clock,system,ctx);soulidity_v1::physical::deliver(a) }", False, "EC04006"
    ),
    "readonly_config_control_sale": (
        "public fun attack<C>(l:&mut soulidity_v1::market::Listing<soulidity_v1::catalog::Control,C>,p:&soulidity_v1::catalog::Product<C>,cfg:&soulidity_foundation::economics::Config<C>,pay:sui::coin::Coin<C>,clock:&sui::clock::Clock,ctx:&mut TxContext) { soulidity_v1::market::buy_control(l,p,cfg,0,vector[1],vector[1],0,vector[1],pay,clock,ctx) }", False, "EC04006"
    ),
    "positive_revenue_metadata": (
        "public fun inspect<C>(p:&soulidity_v1::catalog::Product<C>):u64 { soulidity_foundation::revenue::balance(soulidity_v1::catalog::income(p)) }", True, None
    ),
    "readonly_control_withdraw_income": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,c:&soulidity_v1::catalog::Control,ctx:&mut TxContext) { soulidity_v1::catalog::withdraw_income(p,c,1,1,@0xb,vector[1],ctx) }", False, "EC04006"
    ),
    "readonly_admin_withdraw_income": (
        "public fun attack<C>(p:&mut soulidity_foundation::economics::Config<C>,c:&soulidity_foundation::economics::Admin,ctx:&mut TxContext) { soulidity_foundation::economics::withdraw_income(p,c,1,1,@0xb,vector[1],ctx) }", False, "EC04006"
    ),
    "foreign_revenue_withdraw": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,l:&mut soulidity_foundation::revenue::Ledger<C>,ctx:&mut TxContext) { soulidity_foundation::revenue::withdraw(&p.id,l,1,1,@0xb,vector[1],ctx) }", False, "EC04001"
    ),
    "foreign_income_mutation": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>) { p.income.revision=0 }", False, "EC04001"
    ),
    "foreign_access_holder_mutation": (
        "public fun attack(mut a:soulidity_v1::catalog::Access):soulidity_v1::catalog::Access { a.holder=@0xb;a }", False, "EC04001"
    ),
    "positive_metadata": (
        "public fun inspect(a:&Asset):address { physical::asset_holder(a) }", True, None
    ),
    "physical_public_transfer": (
        "public fun attack(a:Asset,recipient:address) { sui::transfer::public_transfer(a,recipient) }", False, "EC05001"
    ),
    "physical_public_freeze": (
        "public fun attack(a:Asset) { sui::transfer::public_freeze_object(a) }", False, "EC05001"
    ),
    "player_public_transfer": (
        "public fun attack(p:soulidity_v1::player::Player,recipient:address) { sui::transfer::public_transfer(p,recipient) }", False, "EC05001"
    ),
    "foreign_receive": (
        "public fun attack(parent:&mut UID,ticket:sui::transfer::Receiving<Asset>):Asset { sui::transfer::receive(parent,ticket) }", False, "ESC02009"
    ),
    "private_registry_uid": (
        "public fun attack<C>(r:&mut physical::Registry<C>):&mut UID { &mut r.id }", False, "EC04001"
    ),
    "positive_collection_metadata": (
        "public fun inspect(r:&soulidity_v1::collection::Right):std::string::String { soulidity_v1::collection::right_name(r) }", True, None
    ),
    "account_public_transfer": (
        "public fun attack(a:soulidity_v1::custody::Account,to:address) { sui::transfer::public_transfer(a,to) }", False, "EC05001"
    ),
    "account_native_cap_escape": (
        "public fun attack(a:&soulidity_v1::custody::Account):&sui::kiosk::KioskOwnerCap { &a.cap }", False, "EC04001"
    ),
    "collection_rule_forgery": (
        "public fun attack(r:&mut sui::transfer_policy::TransferRequest<soulidity_v1::collection::Right>) { sui::transfer_policy::add_receipt(soulidity_v1::collection::Rule{},r) }", False, "EC04001"
    ),
    "factory_policy_cap_escape": (
        "public fun attack(f:&soulidity_v1::collection::Factory):&sui::transfer_policy::TransferPolicyCap<soulidity_v1::collection::Right> { &f.cap }", False, "EC04001"
    ),
    "factory_publisher_escape": (
        "public fun attack(f:&soulidity_v1::collection::Factory):&sui::package::Publisher { &f.publisher }", False, "EC04001"
    ),
    "positive_resale_metadata": (
        "public fun inspect(s:&soulidity_application::resale::Snapshot):address { soulidity_application::resale::maker_creator(s) }", True, None
    ),
    "resale_snapshot_mutation": (
        "public fun attack(mut s:soulidity_application::resale::Snapshot,to:address):soulidity_application::resale::Snapshot { s.maker_creator=to;s }", False, "EC04001"
    ),
    "resale_rates_forgery": (
        "public fun attack():soulidity_application::resale::Rates { soulidity_application::resale::Rates{oc:10000,maker:10000} }", False, "EC04001"
    ),
    "product_creator_mutation": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,to:address) { p.creator=to }", False, "EC04001"
    ),
    "readonly_admin_configure": (
        "public fun attack<C>(c:&mut soulidity_foundation::economics::Config<C>,a:&soulidity_foundation::economics::Admin) { soulidity_foundation::economics::configure(c,a,0,0,0,0,@0x1,false) }", False, "EC04006"
    ),
    "readonly_control_publish": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,c:&soulidity_v1::catalog::Control,v:soulidity_v1::catalog::Version) { soulidity_v1::catalog::publish(p,c,0,v) }", False, "EC04001"
    ),
    "readonly_control_lifecycle": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,c:&soulidity_v1::catalog::Control) { soulidity_v1::catalog::lifecycle(p,c,1,3) }", False, "EC04001"
    ),
    "readonly_control_create_pack": (
        "public fun attack<C>(p:&soulidity_v1::catalog::Product<C>,c:&soulidity_v1::catalog::Control,cfg:&soulidity_foundation::economics::Config<C>,ctx:&mut TxContext) { soulidity_v1::catalog::create_pack(p,1,c,cfg,0,ctx); }", False, "EC04001"
    ),
    "positive_market_policy_metadata": (
        "public fun inspect(p:&soulidity_foundation::economics::MarketPolicy):address { soulidity_foundation::economics::market_creator(p) }", True, None
    ),
    "market_policy_creator_mutation": (
        "public fun attack(mut p:soulidity_foundation::economics::MarketPolicy):soulidity_foundation::economics::MarketPolicy { p.creator=@0xb;p }", False, "EC04001"
    ),
    "market_receipt_payment_mutation": (
        "public fun attack(mut r:soulidity_foundation::economics::MarketReceipt):soulidity_foundation::economics::MarketReceipt { r.seller_amount=r.gross;r }", False, "EC04001"
    ),
    "source_market_replacement": (
        "public fun attack(mut s:soulidity_model::policy::Source,p:soulidity_foundation::economics::MarketPolicy):soulidity_model::policy::Source { s.market=p;s }", False, "EC04001"
    ),
    "product_market_replacement": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,m:soulidity_foundation::economics::MarketPolicy) { p.market=m }", False, "EC04001"
    ),
    "positive_primary_metadata": (
        "public fun inspect(p:&soulidity_foundation::economics::PrimaryPolicy):address { soulidity_foundation::economics::primary_policy_platform(p) }", True, None
    ),
    "positive_physical_sale_metadata": (
        "public fun inspect(p:&soulidity_application::physical_metadata::SalePolicy):address { soulidity_v1::physical::sale_creator(p) }", True, None
    ),
    "positive_physical_snapshot_all_fields": (
        "public struct View has drop {asset:ID,registry:ID,source:soulidity_model::policy::Source,terms:soulidity_model::material_policy::Terms,sale:soulidity_application::physical_metadata::SalePolicy,registration:soulidity_application::physical_metadata::Registration,row_hash:vector<u8>,serial:u64,holder:address,epoch:u64,authorization:vector<u8>,proof:Option<soulidity_application::physical_metadata::Proof>,visual:vector<u8>,provenance:vector<u8>} public fun inspect(v:&soulidity_application::physical_metadata::Snapshot):vector<u8> { use soulidity_application::physical_metadata as m; std::bcs::to_bytes(&View{asset:m::snapshot_asset(v),registry:m::snapshot_registry(v),source:m::snapshot_source(v),terms:m::snapshot_terms(v),sale:m::snapshot_sale(v),registration:m::snapshot_registration(v),row_hash:m::snapshot_row_hash(v),serial:m::snapshot_serial(v),holder:m::snapshot_holder(v),epoch:m::snapshot_epoch(v),authorization:m::snapshot_authorization(v),proof:m::snapshot_proof(v),visual:m::snapshot_visual(v),provenance:m::snapshot_provenance(v)}) }", True, None
    ),
    "positive_physical_receipt_all_fields": (
        "public struct View has drop {domain:vector<u8>,listing:ID,asset:ID,revision:u64,snapshot:vector<u8>,policy:soulidity_application::physical_metadata::SalePolicy,config:ID,fee_revision:u64,seller:address,buyer:address,expiry:u64,gross:u64,platform:u64,creator:u64,source:u64,net:u64} public fun inspect(v:&soulidity_application::physical_metadata::SaleReceipt):vector<u8> { use soulidity_application::physical_metadata as m; std::bcs::to_bytes(&View{domain:m::receipt_domain(v),listing:m::receipt_listing(v),asset:m::receipt_asset(v),revision:m::receipt_revision(v),snapshot:m::receipt_snapshot(v),policy:m::receipt_policy(v),config:m::receipt_config(v),fee_revision:m::receipt_fee_revision(v),seller:m::receipt_seller(v),buyer:m::receipt_buyer(v),expiry:m::receipt_expiry(v),gross:m::receipt_gross(v),platform:m::receipt_platform(v),creator:m::receipt_creator(v),source:m::receipt_source(v),net:m::receipt_net(v)}) }", True, None
    ),
    "positive_physical_genesis_proof_all_fields": (
        "public struct View has drop {schema:u16,soul:ID,generation:u64,revision:u64,artifact:ID,intent:vector<u8>,output_policy:vector<u8>,recipe:vector<u8>,render:vector<u8>,receipt:vector<u8>,output_commitment:vector<u8>,soul_commitment:vector<u8>,key:vector<u8>,source:vector<u8>} public fun inspect(v:&soulidity_application::physical_metadata::Proof):vector<u8> { use soulidity_application::physical_metadata as m; std::bcs::to_bytes(&View{schema:m::proof_schema(v),soul:m::proof_soul(v),generation:m::proof_generation(v),revision:m::proof_revision(v),artifact:m::proof_artifact(v),intent:m::proof_intent(v),output_policy:m::proof_output_policy(v),recipe:m::proof_recipe(v),render:m::proof_render(v),receipt:m::proof_receipt(v),output_commitment:m::proof_output_commitment(v),soul_commitment:m::proof_soul_commitment(v),key:m::proof_key(v),source:m::proof_source(v)}) }", True, None
    ),
    "positive_soul_genesis_commitments": (
        "public fun inspect(s:&soulidity_standard::soul::Soul):(vector<u8>,vector<u8>) { soulidity_application::character::genesis_commitments(s) }", True, None
    ),
    "foreign_physical_genesis_proof_mutation": (
        "public fun attack(mut p:soulidity_application::physical_metadata::Proof):soulidity_application::physical_metadata::Proof { p.soul_commitment=vector[];p }", False, "EC04001"
    ),
    "foreign_original_artifact_commitment_mutation": (
        "public fun attack(mut p:soulidity_application::output::OriginalCommitment):soulidity_application::output::OriginalCommitment { p.artifact=object::id_from_address(@0xb);p }", False, "EC04001"
    ),
    "foreign_soul_genesis_commitment_mutation": (
        "public fun attack(mut p:soulidity_application::character::GenesisCommitment):soulidity_application::character::GenesisCommitment { p.soul=object::id_from_address(@0xb);p }", False, "EC04001"
    ),
    "foreign_physical_metadata_settlement": (
        "public fun attack<C>(r:soulidity_application::physical_metadata::SaleReceipt,p:&mut soulidity_v1::catalog::Product<C>,cfg:&mut soulidity_foundation::economics::Config<C>,payment:sui::coin::Coin<C>,attempt:vector<u8>,ctx:&mut TxContext){physical::settle_sale(r,p,cfg,payment,attempt,ctx)}", False, "EC04001"
    ),
    "foreign_physical_metadata_receive": (
        "public fun attack<C>(l:&mut physical::Listing<C>,ticket:sui::transfer::Receiving<Asset>):Asset{physical::receive(l,ticket)}", False, "EC04001"
    ),
    "foreign_physical_snapshot_mutation": (
        "public fun attack(mut s:soulidity_application::physical_metadata::Snapshot):soulidity_application::physical_metadata::Snapshot{s.holder=@0xb;s}", False, "EC04001"
    ),
    "primary_policy_mutation": (
        "public fun attack(mut p:soulidity_foundation::economics::PrimaryPolicy):soulidity_foundation::economics::PrimaryPolicy { p.platform=@0xb;p }", False, "EC04001"
    ),
    "primary_receipt_mutation": (
        "public fun attack(mut r:soulidity_foundation::economics::PrimaryReceipt):soulidity_foundation::economics::PrimaryReceipt { r.actor=@0xb;r }", False, "EC04001"
    ),
    "source_primary_replacement": (
        "public fun attack(mut s:soulidity_model::policy::Source,p:soulidity_foundation::economics::PrimaryPolicy):soulidity_model::policy::Source { s.primary=p;s }", False, "EC04001"
    ),
    "product_primary_replacement": (
        "public fun attack<C>(p:&mut soulidity_v1::catalog::Product<C>,m:soulidity_foundation::economics::PrimaryPolicy) { p.primary=m }", False, "EC04001"
    ),
    "physical_sale_policy_mutation": (
        "public fun attack(mut p:soulidity_application::physical_metadata::SalePolicy):soulidity_application::physical_metadata::SalePolicy { p.creator=@0xb;p }", False, "EC04001"
    ),
    "physical_sale_receipt_mutation": (
        "public fun attack(mut r:soulidity_application::physical_metadata::SaleReceipt):soulidity_application::physical_metadata::SaleReceipt { r.net=r.gross;r }", False, "EC04001"
    ),
    "readonly_kind_admin": (
        "public fun attack(r:&mut soulidity_content::kind_registry::KindRegistry,c:&soulidity_content::kind_registry::KindAdminCap,ctx:&TxContext) { soulidity_content::kind_registry::deprecate_kind(r,c,100,ctx) }", False, "EC04006"
    ),
}


# Admission tickets: abilities and constructors checked in real foreign modules.
CASES.update({'foreign_binding_copy': ('public fun attack(p:soulidity_application::issuance::Binding):(soulidity_application::issuance::Binding,soulidity_application::issuance::Binding){(copy p,p)}', False, 'EC05001'), 'foreign_binding_discard': ('public fun attack(p:soulidity_application::issuance::Binding){let _=p;}', False, 'EC05001'), 'foreign_binding_store': ('public struct Stash has store{proof:soulidity_application::issuance::Binding}', False, 'EC05001'), 'foreign_genesis_copy': ('public fun attack(p:soulidity_application::issuance::Genesis):(soulidity_application::issuance::Genesis,soulidity_application::issuance::Genesis){(copy p,p)}', False, 'EC05001'), 'foreign_genesis_discard': ('public fun attack(p:soulidity_application::issuance::Genesis){let _=p;}', False, 'EC05001'), 'foreign_genesis_store': ('public struct Stash has store{proof:soulidity_application::issuance::Genesis}', False, 'EC05001'), 'foreign_contribution_copy': ('public fun attack(p:soulidity_application::issuance::Contribution):(soulidity_application::issuance::Contribution,soulidity_application::issuance::Contribution){(copy p,p)}', False, 'EC05001'), 'foreign_contribution_discard': ('public fun attack(p:soulidity_application::issuance::Contribution){let _=p;}', False, 'EC05001'), 'foreign_contribution_store': ('public struct Stash has store{proof:soulidity_application::issuance::Contribution}', False, 'EC05001'), 'foreign_draft_copy': ('public fun attack(p:soulidity_application::character::Draft):(soulidity_application::character::Draft,soulidity_application::character::Draft){(copy p,p)}', False, 'EC05001'), 'foreign_draft_discard': ('public fun attack(p:soulidity_application::character::Draft){let _=p;}', False, 'EC05001'), 'foreign_draft_store': ('public struct Stash has store{proof:soulidity_application::character::Draft}', False, 'EC05001'), 'foreign_enhancement_copy': ('public fun attack(p:soulidity_application::character::Enhancement):(soulidity_application::character::Enhancement,soulidity_application::character::Enhancement){(copy p,p)}', False, 'EC05001'), 'foreign_enhancement_discard': ('public fun attack(p:soulidity_application::character::Enhancement){let _=p;}', False, 'EC05001'), 'foreign_enhancement_store': ('public struct Stash has store{proof:soulidity_application::character::Enhancement}', False, 'EC05001'), 'foreign_binding_constructor': ('public fun attack(config:ID):soulidity_application::issuance::Binding{soulidity_application::issuance::Binding{config,operator:std::type_name::with_original_ids<u64>()}}', False, 'EC04001'), 'foreign_genesis_constructor': ('public fun attack(id:ID,h:vector<u8>):soulidity_application::issuance::Genesis{soulidity_application::issuance::Genesis{config:id,root:id,source:id,version:1,policy:h,actor:@0xb,metadata:h,operator:std::type_name::with_original_ids<u64>()}}', False, 'EC04001'), 'foreign_contribution_constructor': ('public fun attack(id:ID,payment:soulidity_foundation::economics::PrimaryReceipt):soulidity_application::issuance::Contribution{soulidity_application::issuance::Contribution{root:id,product:id,version:1,policy:vector[],actor:@0xb,payment}}', False, 'EC04001'), 'foreign_application_operator_constructor': ('public fun attack():soulidity_v1::application_operator::ApplicationOperator{soulidity_v1::application_operator::ApplicationOperator{}}', False, 'EC04001'), 'foreign_application_operator_export': ('public fun attack():soulidity_v1::application_operator::ApplicationOperator{soulidity_v1::application_operator::operator()}', False, 'EC04001'), 'positive_draft_palette_consumer': ('public fun apply(d:&soulidity_application::character::Draft,s:&mut soulidity_standard::soul::Soul,colors:vector<soulidity_visual::visual::ColorChoice>,ctx:&TxContext){soulidity_application::character::set_initial_colors(d,s,colors,ctx)}', True, None), 'positive_enhancement_permit_consumer': ('public fun apply(e:&soulidity_application::character::Enhancement,s:&mut soulidity_standard::soul::Soul,p:soulidity_model::components::Permit,part:soulidity_model::assembly::PartKey,l:soulidity_model::policy::Layout,ctx:&mut TxContext):Option<soulidity_model::components::Item>{soulidity_application::character::replace_issued(e,s,p,part,l,ctx)}', True, None)})

CASES.update({
    'positive_blob_page_identity_read': ('public fun page_id(p:&soulidity_content::blob_custody::BlobPage):ID{sui::object::id(p)}', True, None),
    'foreign_blob_page_constructor': ('public fun attack(ctx:&mut TxContext):soulidity_content::blob_custody::BlobPage{soulidity_content::blob_custody::BlobPage{id:sui::object::new(ctx),blobs:vector[]}}', False, 'EC04001'),
    'foreign_blob_page_mutable_uid': ('public fun attack(p:&mut soulidity_content::blob_custody::BlobPage):&mut UID{&mut p.id}', False, 'EC04001'),
    'foreign_blob_page_unwrap': ('public fun attack(p:&mut soulidity_content::blob_custody::BlobPage):walrus::blob::Blob{p.blobs.remove(0)}', False, 'EC04001'),
    'positive_release_append_mutable_context': ('public fun forward<C>(d:&mut soulidity_v1::release::Draft,p:&soulidity_v1::catalog::Product<C>,control:&mut soulidity_v1::catalog::Control,cfg:&soulidity_foundation::economics::Config<C>,asset:vector<u8>,hash:vector<u8>,blob:walrus::blob::Blob,system:&walrus::system::System,expected:u64,ctx:&mut TxContext){soulidity_v1::release::append(d,p,control,cfg,asset,false,hash,blob,system,expected,ctx)}', True, None),
})

CASES.update({'positive_expected_directory_reader': ('public fun read(e:&soulidity_application::publication_rules::Expected):(vector<u8>,u64){(soulidity_application::publication_rules::expected_digest(e),soulidity_application::publication_rules::expected_size(e))}', True, None), 'foreign_expected_constructor': ('public fun attack():soulidity_application::publication_rules::Expected{soulidity_application::publication_rules::Expected{asset:vector[],bytes:1}}', False, 'EC04001'), 'foreign_expected_length_mutation': ('public fun attack(e:&mut soulidity_application::publication_rules::Expected){e.bytes=1}', False, 'EC04001'), 'foreign_expected_installed_draft_replacement': ('public fun attack(d:&mut soulidity_v1::release::Draft){d.expected=vector[]}', False, 'EC04001'), 'foreign_cached_reference_installation': ('public fun attack(d:&mut soulidity_v1::release::Draft,r:soulidity_content::storage::Reference,b:walrus::blob::Blob,ctx:&mut TxContext){soulidity_v1::release::record_asset(d,0,vector[],1024,false,r,b,ctx)}', False, 'EC04001'), 'positive_actual_blob_batch_validator': ('public fun check(r:&vector<soulidity_content::storage::Reference>,b:&vector<walrus::blob::Blob>,s:&walrus::system::System){soulidity_content::storage::assert_current_batch(r,b,s)}', True, None)})

CASES.update({
 'positive_actual_blob_native_custody': ('public fun install_and_take(parent:&mut UID,b:walrus::blob::Blob,ctx:&mut TxContext):walrus::blob::Blob{soulidity_content::blob_custody::append(parent,0,b,ctx);soulidity_content::blob_custody::take(parent,0)}',True,None),
 'positive_expected_index_reader': ('public fun read(e:&vector<soulidity_application::publication_rules::Expected>,h:vector<u8>):Option<u64>{soulidity_application::publication_rules::expected_index(e,h)}',True,None),
 'foreign_claimed_epoch_validation': ('public fun attack(r:&soulidity_content::storage::Reference,b:&walrus::blob::Blob){soulidity_content::storage::assert_current_at_epoch(r,b,0)}',False,'EC04001'),
 'foreign_draft_index_replacement': ('public fun attack(d:&mut soulidity_v1::release::Draft){d.index=vector[]}',False,'EC04001'),
 'foreign_certificate_index_replacement': ('public fun attack(c:&mut soulidity_v1::release::Certificate){c.index=vector[]}',False,'EC04001'),
 'foreign_certificate_directory_replacement': ('public fun attack(c:&mut soulidity_v1::release::Certificate){c.expected=vector[]}',False,'EC04001'),
 'foreign_certificate_custody_uid': ('public fun attack(c:&mut soulidity_v1::release::Certificate):&mut UID{&mut c.custody.id}',False,'EC04001'),
 'foreign_blob_key_constructor': ('public fun attack():soulidity_content::blob_custody::BlobKey{soulidity_content::blob_custody::BlobKey{kind:2,index:0}}',False,'EC04001'),
})

# Optional native access extension: metadata is public; native storage authority remains private.
CASES.update({'positive_access_metadata': ('public fun read(k:&sui::kiosk::Kiosk,id:ID):(u64,u64,soulidity_application::character::Manifest){(soulidity_v1::access::revision(k),soulidity_v1::access::soul_revision(k,id),soulidity_v1::access::manifest(k,id))}', True, None), 'positive_access_install': ('public fun install<C>(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_v1::custody::Account,c:&soulidity_foundation::economics::Config<C>,ctx:&mut TxContext){soulidity_v1::access::install(k,a,c,ctx)}', True, None), 'positive_access_owner_exit': ('public fun exit(k:&mut sui::kiosk::Kiosk,a:&mut soulidity_v1::custody::Account,id:ID,ctx:&TxContext){soulidity_v1::access::withdraw(k,a,id,0,0,ctx);soulidity_v1::access::uninstall_empty(k,a,ctx)}', True, None), 'positive_access_paid_purchase': ('public fun buy<C>(k:&mut sui::kiosk::Kiosk,id:ID,c:&mut soulidity_foundation::economics::Config<C>,p:sui::coin::Coin<C>,clock:&sui::clock::Clock,ctx:&mut TxContext){soulidity_v1::access::buy_paid(k,id,c,3,0,0,vector[],std::option::none(),0,1000,vector[],p,clock,ctx)}', True, None), 'positive_access_delegate_read': ('public fun read(k:&sui::kiosk::Kiosk,root:ID,s:&walrus::system::System,clock:&sui::clock::Clock,ctx:&TxContext){soulidity_v1::access::seal_approve_delegate(vector[],k,root,3,s,clock,ctx)}', True, None), 'foreign_access_witness_constructor': ('public fun attack():soulidity_v1::access::AccessExtension{soulidity_v1::access::AccessExtension{}}', False, 'EC04001'), 'foreign_access_inventory_key_constructor': ('public fun attack():soulidity_v1::access::InventoryKey{soulidity_v1::access::InventoryKey{}}', False, 'EC04001'), 'foreign_access_inventory_owner_mutation': ('public fun attack(v:&mut soulidity_v1::access::Inventory){v.owner=@0xa}', False, 'EC04001'), 'foreign_access_inventory_roots_escape': ('public fun attack(v:&mut soulidity_v1::access::Inventory):&mut sui::object_bag::ObjectBag{&mut v.roots}', False, 'EC04001'), 'foreign_access_raw_root_escape': ('public fun attack(k:&mut sui::kiosk::Kiosk,id:ID):&mut soulidity_standard::soul::Soul{soulidity_v1::access::root_mut(k,id,0,0)}', False, 'EC04001'), 'foreign_access_immutable_root_escape': ('public fun attack(k:&sui::kiosk::Kiosk,id:ID):&soulidity_standard::soul::Soul{soulidity_v1::access::root(k,id)}', False, 'EC04001'), 'foreign_access_native_cap_function': ('public fun attack(a:&soulidity_v1::custody::Account):&sui::kiosk::KioskOwnerCap{soulidity_v1::custody::cap(a)}', False, 'EC04001'), 'foreign_access_readonly_account_exit': ('public fun attack(k:&mut sui::kiosk::Kiosk,a:&soulidity_v1::custody::Account,id:ID,ctx:&TxContext){soulidity_v1::access::withdraw(k,a,id,0,0,ctx)}', False, 'EC04006'), 'foreign_access_readonly_kiosk_exit': ('public fun attack(k:&sui::kiosk::Kiosk,a:&mut soulidity_v1::custody::Account,id:ID,ctx:&TxContext){soulidity_v1::access::withdraw(k,a,id,0,0,ctx)}', False, 'EC04006')})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--sui-binary", default="sui", help="Explicit compiler binary; does not replace the installed CLI")
    parser.add_argument("--case", action="append", choices=tuple(CASES), help="Run only named probes; evidence remains explicit about selected scope")
    parser.add_argument("--jobs", type=int, default=1, choices=range(1,9), help="Independent compiler processes; each case keeps its own build directory")
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    selected = [(name, values) for name, values in CASES.items() if not args.case or name in args.case]
    def compile_case(case):
        name, (body, positive, diagnostic) = case
        directory = out / name
        (directory / "sources").mkdir(parents=True, exist_ok=True)
        toml = (
            '[package]\nname = "ability_probe"\nedition = "2024"\n'
            f'[dependencies]\nsoulidity_v1 = {{ local = "{ROOT / "move/soulidity_v1"}" }}\n'
            + SUI_DEPENDENCY + '\n[addresses]\nability_probe = "0xa"\n'
        )
        (directory / "Move.toml").write_text(toml)
        (directory / "sources/probe.move").write_text(
            "module ability_probe::probe;\nuse soulidity_v1::physical::{Self,Asset};\n" + body + "\n"
        )
        # Compiler-boundary tests need no RPC/tree-shaking. Preserve fixed dependencies.
        command = [args.sui_binary, "move", "build", "--path", str(directory), "--dump-bytecode-as-base64", "--no-tree-shaking", "--with-unpublished-dependencies"]
        run = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        (directory / "build.log").write_text(run.stdout)
        codes = sorted(set(re.findall(r"error\[([^]]+)\]", run.stdout)))
        unrelated = [c for c in codes if c.startswith(("EC01", "EC02", "EC03"))]
        passed = run.returncode == 0 if positive else run.returncode != 0 and diagnostic in run.stdout and not unrelated
        result = {"case": name, "command": command, "exit_code": run.returncode,
                        "expected_success": positive, "expected_diagnostic": diagnostic,
                        "error_codes": codes, "unrelated_structural_errors": unrelated,
                        "verified": passed}
        print(f"{name}: {'PASS' if passed else 'FAIL'} (exit {run.returncode})", flush=True)
        return result
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        # map keeps the original case order in the evidence, regardless of completion order.
        results = list(pool.map(compile_case, selected))
    evidence = {"tool": "Sui Move compiler/verifier against actual foreign package",
                "selected_cases": args.case, "total_available": len(CASES),
                "jobs": args.jobs,
                "all_verified": all(r["verified"] for r in results), "cases": results,
                "limit": "These compiler probes do not prove all protocol authority or runtime safety."}
    (out / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    raise SystemExit(0 if evidence["all_verified"] else 1)


# Atomic first-use custody: returned values remain sealed, linear and caller-bound.
CASES.update({
 'positive_account_new_finalize': ('public fun setup(ctx:&mut TxContext):ID{let(k,a)=soulidity_v1::custody::new(ctx);soulidity_v1::custody::finalize(k,a,ctx)}',True,None),
 'foreign_new_account_discard': ('public fun attack(ctx:&mut TxContext){let(k,a)=soulidity_v1::custody::new(ctx);let _=a;sui::transfer::public_share_object(k)}',False,'EC05001'),
 'foreign_new_account_native_cap_escape': ('public fun attack(ctx:&mut TxContext):sui::kiosk::KioskOwnerCap{let(k,a)=soulidity_v1::custody::new(ctx);let cap=a.cap;let _=a;sui::transfer::public_share_object(k);cap}',False,'EC04001'),
 'foreign_new_account_owner_rebind': ('public fun attack(ctx:&mut TxContext){let(k,mut a)=soulidity_v1::custody::new(ctx);a.owner=@0xb;soulidity_v1::custody::finalize(k,a,ctx)}',False,'EC04001'),
})

# Foreign consumers may call terminal cleanup, but cannot forge terminal state
# or extract the private listing UID to alter real custody.
CASES.update({
 'positive_market_soul_terminal_cleanup': ('public fun clean<C>(l:soulidity_v1::market::Listing<soulidity_standard::soul::Soul,C>,ctx:&sui::tx_context::TxContext){soulidity_v1::market::delete_listing(l,ctx)}',True,None),
 'positive_collection_terminal_cleanup': ('public fun clean<C>(l:soulidity_v1::collection::Listing<C>,ctx:&sui::tx_context::TxContext){soulidity_v1::collection::delete_listing(l,ctx)}',True,None),
 'foreign_market_listing_terminal_state_forge': ('public fun attack<C>(l:&mut soulidity_v1::market::Listing<soulidity_standard::soul::Soul,C>){l.state=1}',False,'EC04001'),
 'foreign_collection_listing_terminal_state_forge': ('public fun attack<C>(l:&mut soulidity_v1::collection::Listing<C>){l.state=1}',False,'EC04001'),
 'foreign_market_listing_custody_uid_escape': ('public fun attack<C>(l:&mut soulidity_v1::market::Listing<soulidity_standard::soul::Soul,C>):&mut sui::object::UID{&mut l.id}',False,'EC04001'),
})

# Native source claims and complete initial-content custody are linear values.
CASES.update({
    "positive_native_content_identity_reader": ("public fun read(r:&soulidity_native::registry::Registry,a:address,n:vector<u8>):ID{soulidity_native::registry::expected_content_id(r,a,n)}", True, None),
    "positive_native_claim_forward": ("public fun prepare<C>(r:&mut soulidity_native::registry::Registry,c:&soulidity_foundation::economics::Config<C>,k:&mut sui::kiosk::Kiosk,cap:&sui::kiosk::KioskOwnerCap,n:vector<u8>,id:ID,ctx:&TxContext):soulidity_native::registry::Claim{soulidity_native::registry::prepare_native(r,c,k,cap,n,id,ctx)}", True, None),
    "positive_founding_library_reader": ("public fun read(l:&soulidity_content::founding_library::Library):(ID,u64,vector<u8>){(soulidity_content::founding_library::root(l),soulidity_content::founding_library::count(l),soulidity_content::founding_library::commitment(l))}", True, None),
    "positive_independent_founding_operator": ("public struct ContentOperator has drop{} public struct Parent has key{id:UID} public fun begin(p:&Parent,s:&soulidity_standard::soul::Soul,ctx:&mut TxContext):soulidity_content::founding_library::Founding{soulidity_content::founding_library::begin(ContentOperator{},p,s,ctx)}", True, None),
    "foreign_native_registry_uid": ("public fun attack(r:&mut soulidity_native::registry::Registry):&mut UID{&mut r.id}", False, "EC04001"),
    "foreign_native_registry_kiosks": ("public fun attack(r:&mut soulidity_native::registry::Registry){r.schema=0}", False, "EC04001"),
    "foreign_native_producer_constructor": ("public fun attack():soulidity_native::registry::SoulProducer{soulidity_native::registry::SoulProducer{}}", False, "EC04001"),
    "foreign_native_claim_copy": ("public fun attack(c:soulidity_native::registry::Claim):(soulidity_native::registry::Claim,soulidity_native::registry::Claim){(copy c,c)}", False, "EC05001"),
    "foreign_native_claim_drop": ("public fun attack(c:soulidity_native::registry::Claim){let _=c;}", False, "EC05001"),
    "foreign_native_claim_store": ("public struct Stash has store{claim:soulidity_native::registry::Claim}", False, "EC05001"),
    "foreign_native_claim_uid": ("public fun attack(c:&mut soulidity_native::registry::Claim):&mut UID{&mut c.id}", False, "EC04001"),
    "foreign_native_claim_consume": ("public fun attack<C>(claim:soulidity_native::registry::Claim,r:&soulidity_native::registry::Registry,c:&soulidity_foundation::economics::Config<C>,k:&mut sui::kiosk::Kiosk,cap:&sui::kiosk::KioskOwnerCap,ctx:&TxContext):(ID,soulidity_native::registry::Provenance,vector<u8>){soulidity_native::registry::consume(claim,r,c,k,cap,ctx)}", False, "EC04001"),
    "foreign_founding_copy": ("public fun attack(f:soulidity_content::founding_library::Founding):(soulidity_content::founding_library::Founding,soulidity_content::founding_library::Founding){(copy f,f)}", False, "EC05001"),
    "foreign_founding_drop": ("public fun attack(f:soulidity_content::founding_library::Founding){let _=f;}", False, "EC05001"),
    "foreign_founding_store": ("public struct Stash has store{founding:soulidity_content::founding_library::Founding}", False, "EC05001"),
    "foreign_founding_unwrap": ("public fun attack(f:soulidity_content::founding_library::Founding):soulidity_content::founding_library::Library{let soulidity_content::founding_library::Founding{library,actor:_}=f;library}", False, "EC04001"),
    "foreign_founding_library_uid": ("public fun attack(l:&mut soulidity_content::founding_library::Library):&mut UID{&mut l.id}", False, "EC04001"),
    "foreign_founding_record_mutation": ("public fun attack(l:&mut soulidity_content::founding_library::Library):&mut sui::table::Table<u64,soulidity_content::document::Record>{&mut l.records}", False, "EC04001"),
    "foreign_founding_blob_key_constructor": ("public fun attack():soulidity_content::founding_library::BlobKey{soulidity_content::founding_library::BlobKey{index:0}}", False, "EC04001"),
    "foreign_founding_cached_record_as_blob": ("public struct ContentOperator has drop{} public fun attack(f:&mut soulidity_content::founding_library::Founding,r:&soulidity_content::kind_registry::KindRegistry,record:soulidity_content::document::Record,sys:&walrus::system::System,c:&sui::clock::Clock,ctx:&TxContext){soulidity_content::founding_library::append_initial(ContentOperator{},f,r,0,std::string::utf8(b\"soul\"),3,0,record,sys,vector[],vector[],b\"e\",0,false,c,ctx);}", False, "EC04007"),
})

# Complete native birth: linear draft, real children, private operators.
CASES.update({
    'positive_native_birth_state_reader': ('public fun read(s:&soulidity_standard::soul::Soul):(ID,u16,vector<u8>){let n=soulidity_native::birth::state(s);(soulidity_native::birth::root_id(n),soulidity_native::birth::royalty(n),soulidity_native::birth::commitment(n))}',True,None),
    'positive_native_birth_linear_finish': ('public fun finish<C>(d:soulidity_native::birth::Draft,r:&soulidity_native::registry::Registry,c:&soulidity_foundation::economics::Config<C>,k:&mut sui::kiosk::Kiosk,cap:&sui::kiosk::KioskOwnerCap,p:&sui::transfer_policy::TransferPolicy<soulidity_standard::soul::Soul>,sys:&walrus::system::System,ctx:&mut TxContext):ID{soulidity_native::birth::finish(d,r,c,k,cap,p,sys,ctx)}',True,None),
    'positive_native_sealed_registration': ('public fun register<C>(r:&mut soulidity_native::registry::Registry,c:&soulidity_foundation::economics::Config<C>,k:&mut sui::kiosk::Kiosk,a:&mut soulidity_v1::custody::Account,ctx:&TxContext){soulidity_v1::native_creation::register(r,c,k,a,ctx)}',True,None),
    'foreign_native_birth_draft_copy': ('public fun attack(d:soulidity_native::birth::Draft):(soulidity_native::birth::Draft,soulidity_native::birth::Draft){(copy d,d)}',False,'EC05001'),
    'foreign_native_birth_draft_drop': ('public fun attack(d:soulidity_native::birth::Draft){let _=d;}',False,'EC05001'),
    'foreign_native_birth_draft_store': ('public struct Stash has store{draft:soulidity_native::birth::Draft}',False,'EC05001'),
    'foreign_native_birth_root_escape': ('public fun attack(d:&soulidity_native::birth::Draft):&soulidity_standard::soul::Soul{&d.root}',False,'EC04001'),
    'foreign_native_birth_state_uid': ('public fun attack(s:&mut soulidity_native::birth::State):&mut UID{&mut s.id}',False,'EC04001'),
    'foreign_native_birth_content_pointer_replace': ('public fun attack(s:&mut soulidity_native::birth::State,id:ID){s.content=id}',False,'EC04001'),
    'foreign_native_birth_royalty_replace': ('public fun attack(s:&mut soulidity_native::birth::State){s.creator_royalty_bps=0}',False,'EC04001'),
    'foreign_native_birth_actor_replace': ('public fun attack(d:&mut soulidity_native::birth::Draft){d.actor=@0xb}',False,'EC04001'),
    'foreign_native_birth_operator_constructor': ('public fun attack():soulidity_native::birth::ContentOperator{soulidity_native::birth::ContentOperator{}}',False,'EC04001'),
    'foreign_native_birth_module_constructor': ('public fun attack():soulidity_native::birth::NativeModule{soulidity_native::birth::NativeModule{}}',False,'EC04001'),
    'foreign_native_birth_content_key_constructor': ('public fun attack():soulidity_native::birth::ContentKey{soulidity_native::birth::ContentKey{}}',False,'EC04001'),
})

# Native issuer revision is private Config authority, not a detached metadata grant.
CASES.update({
    'positive_source_revision_reader': ('public fun read(r:&soulidity_foundation::source_authority::Revision):(ID,ID,u64){(soulidity_foundation::source_authority::original(r),soulidity_foundation::source_authority::callable(r),soulidity_foundation::source_authority::version(r))}',True,None),
    'positive_native_source_revision_discovery': ('public fun read<C>(c:&soulidity_foundation::economics::Config<C>):Option<soulidity_foundation::source_authority::Revision>{soulidity_foundation::economics::source_revision<C,soulidity_native::registry::Registry>(c)}',True,None),
    'positive_native_source_sealed_ingress': ('public fun place<C,T:key+store>(r:&soulidity_native::registry::Registry,c:&soulidity_foundation::economics::Config<C>,k:&mut sui::kiosk::Kiosk,a:&mut soulidity_v1::custody::Account,source:T,ctx:&TxContext):ID{soulidity_v1::native_creation::place_source(r,c,k,a,source,ctx)}',True,None),
    'positive_native_revision_admin_forward': ('public fun register<C>(r:&soulidity_native::registry::Registry,c:&mut soulidity_foundation::economics::Config<C>,a:&mut soulidity_foundation::economics::Admin,rev:u64,h:vector<u8>,p:&sui::package::Publisher,cap:&sui::package::UpgradeCap){soulidity_native::registry::register_revision(r,c,a,rev,h,p,cap)}',True,None),
    'positive_standard_real_policy_constructor': ('public fun create(p:&sui::package::Publisher,ctx:&mut TxContext):(sui::transfer_policy::TransferPolicy<soulidity_standard::soul::Soul>,sui::transfer_policy::TransferPolicyCap<soulidity_standard::soul::Soul>){sui::transfer_policy::new<soulidity_standard::soul::Soul>(p,ctx)}',True,None),
    'foreign_source_revision_constructor': ('public fun attack(id:ID,t:std::type_name::TypeName):soulidity_foundation::source_authority::Revision{soulidity_foundation::source_authority::Revision{original:id,callable:id,marker:t,version:2}}',False,'EC04001'),
    'foreign_source_revision_field_write': ('public fun attack(r:&mut soulidity_foundation::source_authority::Revision){r.version=2}',False,'EC04001'),
    'foreign_source_revision_config_key': ('public fun attack():soulidity_foundation::economics::SourceRevisionKey<soulidity_native::registry::Registry>{soulidity_foundation::economics::SourceRevisionKey<soulidity_native::registry::Registry>{}}',False,'EC04001'),
    'foreign_native_revision_marker_constructor': ('public fun attack():soulidity_native::registry::SourceRevision1{soulidity_native::registry::SourceRevision1{}}',False,'EC04001'),
    'foreign_native_registry_OTP_constructor': ('public fun attack():soulidity_native::registry::REGISTRY{soulidity_native::registry::REGISTRY{}}',False,'EC04001'),
    'foreign_standard_publisher_OTP_constructor': ('public fun attack():soulidity_standard::soul::SOUL{soulidity_standard::soul::SOUL{}}',False,'EC04001'),
    'foreign_native_claim_issuer_replace': ('public fun attack(c:&mut soulidity_native::registry::Claim,r:soulidity_foundation::source_authority::Revision){c.issuer=r}',False,'EC04001'),
    'foreign_native_state_issuer_replace': ('public fun attack(s:&mut soulidity_native::birth::State,r:soulidity_foundation::source_authority::Revision){s.issuer=r}',False,'EC04001'),
})

if __name__ == "__main__":
    main()
