/// Thin downstream facade; canonical state and ledgers live in Maker.
module soulidity_v1::catalog;
use soulidity_custody::lifecycle;
use std::bcs;
use soulidity_application::publication_rules;
use sui::table::{Self,Table};
use sui::coin::Coin;
use sui::clock::Clock;
use sui::event;
use sui::dynamic_object_field as dof;
use soulidity_model::policy::{Self,Definition,Source,Adapter};
use soulidity_foundation::economics::{Self,Config,MarketPolicy,PrimaryPolicy,PrimaryReceipt};
use soulidity_application::output::{Self};
use soulidity_maker_publication::output_data::{Policy};
use soulidity_maker_terms::maker_resale::{Self as resale,Rates};
use soulidity_model::material_policy::{Self,Terms};
use soulidity_foundation::revenue::{Self,Ledger};
use soulidity_visual::visual::{Self,Scene};
use soulidity_model::assembly::{Self,Profile,Scope};
use std::string::String;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_maker_manufacturing::maker_catalog as implementation;
use soulidity_maker_manufacturing::maker_factory as factory;
use walrus::system::System;
use soulidity_maker_manufacturing::maker_catalog::{CreatorAuthority1,CreatorRevision1,CreatorRevision2,CreatorRevision3,MAKER_CATALOG,SoulProducer,PolicyProducer,ComponentProducer,Control,Product,AccessKey,Access,SupplyKey,CountKey,RequestKey,ParentSnapshot,PublicationContext,Version,Published,AccessPurchased,LifecycleChanged,CertificationKey};

#[test_only]
public(package) fun mint_soul<C>(binding:soulidity_maker_admission::maker_issuance::Binding,p:&mut Product<C>,cfg:&mut Config<C>,v:u64,name:String,hash:vector<u8>,attempt:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):(Soul,soulidity_maker_admission::maker_issuance::Genesis,PrimaryReceipt){
 economics::assert_primary_live(cfg,fee_revision,expiry,clock);let(request,witness)=implementation::request_native_origin_with_witness<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,hash,name,attempt,expiry,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),clock,ctx);let snapshot=soulidity_origin_protocol::producer_origin::snapshot(&request);let root=lifecycle::raw_from_request_for_testing(witness,p,request,ctx);
 let mut session=implementation::begin_native_session_for_testing(p,&root,cfg,snapshot,payment,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),clock,ctx);let receipt=implementation::session_receipt(&session);let action=implementation::take_action(&mut session,p,&root,ctx);let version=*implementation::published(p,v);let resale=resale::snapshot(object::id(cfg),object::id(p),v,hash,implementation::creator(p),soul_rates(&version),ctx);let metadata=soulidity_application::character::genesis_hash(object::id(cfg),object::id(p),v,manifest(&version),configuration(&version),assembly_profile(p,v),required_parts(&version),adapters(&version),*scene(&version),resale,beneficiary(&version),ctx);
 let genesis=soulidity_maker_admission::maker_issuance::authorize_genesis_action(cfg,p,&root,binding,action,receipt,metadata,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),ctx);let completion=implementation::finish_session_for_testing(session,&root,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),ctx);soulidity_origin_protocol::producer_origin::consume_completion<soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(completion,&root,&snapshot,ctx);(root,genesis,receipt)
}

#[test_only]
public(package) fun publish<C>(p:&mut Product<C>,control:&mut Control,expected_version:u64,mut v:Version):vector<u8> { implementation::publish_for_testing<C>(p,control,expected_version,v) }
#[test_only]
public(package) fun assert_publication_economics<C>(p:&Product<C>,v:&Version){ implementation::assert_publication_economics_for_testing<C>(p,v) }
#[test_only]
public fun invalid_completion_cap_for_testing(v:&mut Version){ implementation::invalid_completion_cap_for_testing(v) }
#[test_only]
public fun invalid_financial_domain_for_testing(v:&mut Version,field:u8){ implementation::invalid_financial_domain_for_testing(v,field) }
#[test_only]
public(package) fun lifecycle<C>(p:&mut Product<C>,control:&mut Control,expected:u64,state:u8) { implementation::lifecycle_for_testing<C>(p,control,expected,state) }
public fun assert_control<C>(p:&Product<C>,c:&Control) { implementation::assert_control<C>(p,c) }
#[test_only]
public(package) fun attach_certification<C,T:key+store>(p:&mut Product<C>,version:u64,value:T){ implementation::attach_certification_for_testing<C,T>(p,version,value) }
#[test_only]
public(package) fun certification<C,T:key+store>(p:&Product<C>,version:u64):&T{ implementation::certification_for_testing<C,T>(p,version) }
#[test_only]
public(package) fun certification_mut<C,T:key+store>(p:&mut Product<C>,version:u64):&mut T{ implementation::certification_mut_for_testing<C,T>(p,version) }
public fun control_product(c:&Control):ID { implementation::control_product(c) }
public fun current_version<C>(p:&Product<C>):u64 { implementation::current_version<C>(p) }
public fun protocol<C>(p:&Product<C>):ID { implementation::protocol<C>(p) }
public fun creator<C>(p:&Product<C>):address{ implementation::creator<C>(p) }
public fun market_policy<C>(p:&Product<C>):MarketPolicy{ implementation::market_policy<C>(p) }
public fun version_market(v:&Version):MarketPolicy{ implementation::version_market(v) }
public fun primary_policy<C>(p:&Product<C>):PrimaryPolicy{ implementation::primary_policy<C>(p) }
public fun version_primary(v:&Version):PrimaryPolicy{ implementation::version_primary(v) }
public fun assert_active<C>(p:&Product<C>){ implementation::assert_active<C>(p) }
public fun assert_paused<C>(p:&Product<C>){ implementation::assert_paused<C>(p) }
public fun physical_registry<C>(p:&Product<C>,version:u64):Option<ID>{ implementation::physical_registry<C>(p,version) }
#[test_only]
public(package) fun bind_physical<C>(p:&mut Product<C>,version:u64,registry:ID){ implementation::bind_physical_for_testing<C>(p,version,registry) }
public fun parent<C>(p:&Product<C>):Option<ID>{ implementation::parent<C>(p) }
public fun published<C>(p:&Product<C>,v:u64):&Version { implementation::published<C>(p,v) }
public fun policy_hash(v:&Version):vector<u8>{ implementation::policy_hash(v) }
#[test_only]
public fun publication_preimage_for_testing(mut v:Version):vector<u8>{ implementation::publication_preimage_for_testing(v) }
public fun manifest(v:&Version):vector<u8>{ implementation::manifest(v) }
public fun configuration(v:&Version):vector<u8>{ implementation::configuration(v) }
public fun scene(v:&Version):&Scene{ implementation::scene(v) }
public fun publication(v:&Version):Option<PublicationContext>{ implementation::publication(v) }
public fun publication_product(p:&PublicationContext):ID{ implementation::publication_product(p) }
public fun publication_version(p:&PublicationContext):u64{ implementation::publication_version(p) }
public fun publication_parent(p:&PublicationContext):Option<ID>{ implementation::publication_parent(p) }
public fun publication_parent_version(p:&PublicationContext):u64{ implementation::publication_parent_version(p) }
public fun publication_parent_policy(p:&PublicationContext):Option<vector<u8>>{ implementation::publication_parent_policy(p) }
public fun parent_scene<C>(p:&Product<C>):Option<Scene>{ implementation::parent_scene<C>(p) }
public fun parent_policy<C>(p:&Product<C>):Option<vector<u8>>{ implementation::parent_policy<C>(p) }
public fun assembly_profile<C>(p:&Product<C>,version:u64):Profile{ implementation::assembly_profile<C>(p,version) }
public fun visual_variant<C>(p:&Product<C>,control:&Control,version:u64,target:Scene,adapters:vector<Adapter>):assembly::Variant{ implementation::visual_variant<C>(p,control,version,target,adapters) }
public fun parts(v:&Version):vector<vector<u8>>{ implementation::parts(v) }
public fun definitions(v:&Version):vector<Definition>{ implementation::definitions(v) }
public fun definitions_ref(v:&Version):&vector<Definition>{ implementation::definitions_ref(v) }
#[test_only]
public(package) fun assert_unpublished(v:&Version){ implementation::assert_unpublished_for_testing(v) }
#[test_only]
public(package) fun append_definitions(v:&mut Version,extra:vector<Definition>){ implementation::append_definitions_for_testing(v,extra) }
#[test_only]
public(package) fun extend_definition(v:&mut Version,index:u64,extra:vector<visual::Fragment>){ implementation::extend_definition_for_testing(v,index,extra) }
#[test_only]
public(package) fun append_adapters(v:&mut Version,extra:vector<Adapter>){ implementation::append_adapters_for_testing(v,extra) }
#[test_only]
public(package) fun append_physical(v:&mut Version,extra:vector<Terms>){ implementation::append_physical_for_testing(v,extra) }
#[test_only]
public(package) fun finalize_metadata(v:&Version):Version{ implementation::finalize_metadata_for_testing(v) }
#[test_only]
public(package) fun unpublished_hash(v:&Version):vector<u8>{ implementation::unpublished_hash_for_testing(v) }
public fun required_parts(v:&Version):vector<vector<u8>>{ implementation::required_parts(v) }
public fun soul_rates(v:&Version):Rates{ implementation::soul_rates(v) }
public fun royalty(v:&Version):u16 { implementation::royalty(v) }
public fun beneficiary(v:&Version):address { implementation::beneficiary(v) }
public fun adapters(v:&Version):vector<Adapter>{ implementation::adapters(v) }
public fun access_held<C>(p:&Product<C>,version:u64,wallet:address):bool { implementation::access_held<C>(p,version,wallet) }
public fun assert_access<C>(p:&Product<C>,v:u64,wallet:address) { implementation::assert_access<C>(p,v,wallet) }
public fun assert_access_entitlement<C>(p:&Product<C>,v:u64,wallet:address){ implementation::assert_access_entitlement<C>(p,v,wallet) }
public fun access_commitment(a:&Access):vector<u8>{ implementation::access_commitment(a) }
#[test_only]
public fun corrupt_access_for_testing<C>(p:&mut Product<C>,v:u64,wallet:address,field:u8){ implementation::corrupt_access_for_testing<C>(p,v,wallet,field) }
public fun assert_runtime_access<C>(p:&Product<C>,cfg:&Config<C>,v:u64,expected_policy:vector<u8>,expected_manifest:vector<u8>,expected_config_revision:u64,expected_config_commitment:vector<u8>,clock:&Clock,ctx:&TxContext){ implementation::assert_runtime_access_native<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,expected_policy,expected_manifest,expected_config_revision,expected_config_commitment,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
public(package) fun ensure_access<C>(p:&mut Product<C>,cfg:&Config<C>,v:u64,attempt:vector<u8>,fee_revision:u64,expiry:u64,clock:&Clock,system:&System,ctx:&mut TxContext){factory::ensure_native_access<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,attempt,fee_revision,expiry,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),system,clock,ctx)}
public fun assert_pack<C>(p:&Product<C>,maker:&Product<C>,maker_version:u64,version:u64,wallet:address) { implementation::assert_pack<C>(p,maker,maker_version,version,wallet) }
public fun assert_runtime_pack<C>(p:&Product<C>,maker:&Product<C>,maker_version:u64,version:u64,cfg:&Config<C>,expected_policy:vector<u8>,expected_manifest:vector<u8>,expected_config_revision:u64,expected_config_commitment:vector<u8>,clock:&Clock,ctx:&TxContext){ implementation::assert_runtime_pack_native<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,maker,maker_version,version,cfg,expected_policy,expected_manifest,expected_config_revision,expected_config_commitment,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
public(package) fun buy_access<C>(p:&mut Product<C>,cfg:&mut Config<C>,v:u64,hash:vector<u8>,fee_revision:u64,expiry:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext){factory::buy_native_access<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,hash,fee_revision,expiry,attempt,payment,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),system,clock,ctx)}
public fun access_quote<C>(p:&Product<C>,cfg:&Config<C>,version:u64,actor:address,attempt:vector<u8>,expiry:u64):PrimaryReceipt { implementation::access_quote_native<C>(p,cfg,version,actor,attempt,expiry) }
public(package) fun collect_primary<C>(p:&mut Product<C>,cfg:&mut Config<C>,v:u64,r:PrimaryReceipt,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext){factory::collect_native_primary<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,r,payment,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),system,clock,ctx)}
public(package) fun claim_access<C>(p:&mut Product<C>,cfg:&Config<C>,v:u64,hash:vector<u8>,fee_revision:u64,expiry:u64,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext){factory::claim_native_access<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,hash,fee_revision,expiry,attempt,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),system,clock,ctx)}
public fun access_record<C>(p:&Product<C>,version:u64,holder:address):Option<Access>{ implementation::access_record<C>(p,version,holder) }
public fun access_product(a:&Access):ID{ implementation::access_product(a) }
public fun access_version(a:&Access):u64{ implementation::access_version(a) }
public fun access_policy_hash(a:&Access):vector<u8>{ implementation::access_policy_hash(a) }
public fun access_manifest(a:&Access):vector<u8>{ implementation::access_manifest(a) }
public fun access_holder(a:&Access):address{ implementation::access_holder(a) }
public fun access_paid(a:&Access):u64{ implementation::access_paid(a) }
public fun access_issued_at(a:&Access):u64{ implementation::access_issued_at(a) }
public fun income<C>(p:&Product<C>):&Ledger<C>{ implementation::income<C>(p) }
public fun deposit_income<C>(p:&mut Product<C>,cfg:&Config<C>,payment:Coin<C>){ implementation::deposit_income<C>(p,cfg,payment) }
public fun withdraw_income<C>(p:&mut Product<C>,control:&mut Control,expected:u64,amount:u64,recipient:address,attempt:vector<u8>,ctx:&mut TxContext){ implementation::withdraw_income<C>(p,control,expected,amount,recipient,attempt,ctx) }
public fun payment_receipt<C>(p:&Product<C>,actor:address,kind:u8,attempt:vector<u8>):Option<PrimaryReceipt>{ implementation::payment_receipt<C>(p,actor,kind,attempt) }
public fun completion_price<C>(p:&Product<C>,v:u64,wallet:address):u64 { implementation::completion_price<C>(p,v,wallet) }
public fun wallet_completes<C>(p:&Product<C>,v:u64,wallet:address):u64 { implementation::wallet_completes<C>(p,v,wallet) }
#[test_only]
public(package) fun authorize_complete<C>(p:&mut Product<C>,v:u64,hash:vector<u8>,attempt:vector<u8>,soul:ID,ctx:&TxContext):u64 { implementation::authorize_complete_for_testing<C>(p,v,hash,attempt,soul,ctx) }
#[test_only]
public(package) fun issue<C>(p:&mut Product<C>,v:u64,definition_hash:vector<u8>,target:&soulidity_standard::soul::Soul):soulidity_model::components::Permit { implementation::issue_for_testing<C,Soul>(p,v,definition_hash,target) }
public fun issued_count<C>(p:&Product<C>,v:u64,definition_hash:vector<u8>):u64{ implementation::issued_count<C>(p,v,definition_hash) }
public fun receipt<C>(p:&Product<C>,actor:address,kind:u8,attempt:vector<u8>):Option<ID> { implementation::receipt<C>(p,actor,kind,attempt) }
#[test_only]
public(package) fun record_attempt<C>(p:&mut Product<C>,kind:u8,attempt:vector<u8>,result:ID,ctx:&TxContext) { implementation::record_attempt_for_testing<C>(p,kind,attempt,result,ctx) }
public fun with_outputs(mut v:Version,outputs:vector<Policy>):Version { implementation::with_outputs(v,outputs) }
public fun with_pack_key(mut v:Version,key:vector<u8>):Version { implementation::with_pack_key(v,key) }
public fun output_policy(v:&Version,key:vector<u8>):Policy { implementation::output_policy(v,key) }
public fun pack_key(v:&Version):vector<u8>{ implementation::pack_key(v) }
public fun physical_terms(v:&Version):vector<Terms>{ implementation::physical_terms(v) }
public fun with_physical(mut v:Version,terms:vector<Terms>):Version { implementation::with_physical_route(implementation::with_physical(v,terms),soulidity_v1::physical::physical_producer(),soulidity_v1::physical::physical_revision()) }
public fun preview_source<C>(p:&Product<C>,v:u64,definition_hash:vector<u8>):Source { implementation::preview_source<C>(p,v,definition_hash) }
public fun register<C>(cfg:&mut soulidity_foundation::economics::Config<C>,admin:&mut soulidity_foundation::economics::Admin,expected:u64,hash:vector<u8>,publisher:&sui::package::Publisher,cap:&sui::package::UpgradeCap){ implementation::register<C>(cfg,admin,expected,hash,publisher,cap) }
#[test_only]
public fun settle_quote_for_testing<C>(cfg:&mut Config<C>,receipt:PrimaryReceipt,payment:sui::coin::Coin<C>,clock:&Clock,ctx:&mut TxContext):sui::coin::Coin<C>{ implementation::settle_native_quote_for_testing<C>(cfg,receipt,payment,clock,ctx) }
#[test_only]
public(package) fun complete_contribution<C>(p:&mut Product<C>,root:&Soul,cfg:&mut Config<C>,version:u64,hash:vector<u8>,attempt:vector<u8>,expiry:u64,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):soulidity_maker_admission::maker_issuance::Contribution{
 let snapshot=implementation::request_native_contribution(p,root,cfg,version,hash,*standard::name(root),attempt,expiry,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),clock,ctx);let mut session=implementation::begin_native_session_for_testing(p,root,cfg,snapshot,payment,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),clock,ctx);let receipt=implementation::session_receipt(&session);let action=implementation::take_action(&mut session,p,root,ctx);let contribution=soulidity_maker_admission::maker_issuance::authorize_contribution_action(cfg,p,root,action,receipt,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),ctx);let completion=implementation::finish_session_for_testing(session,root,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),ctx);soulidity_origin_protocol::producer_origin::consume_completion<soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(completion,root,&snapshot,ctx);contribution
}

public fun version(manifest:vector<u8>,configuration:vector<u8>,access_mode:u8,access_price:u64,completion_mode:u8,completion_price:u64,quota:u64,cap:u64,royalty_bps:u16,beneficiary:address,soul_rates:Rates,parts:vector<vector<u8>>,required_parts:vector<vector<u8>>,definitions:vector<Definition>,adapters:vector<Adapter>,scene:Scene):Version{implementation::with_execution<soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(implementation::version(manifest,configuration,access_mode,access_price,completion_mode,completion_price,quota,cap,royalty_bps,beneficiary,soul_rates,parts,required_parts,definitions,adapters,scene),soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision())}
public fun create_maker<C>(cfg:&Config<C>,royalty:u16,ctx:&mut TxContext):ID{implementation::create_native_maker(cfg,royalty,ctx)}
public(package) fun create_pack<C>(maker:&Product<C>,parent_version:u64,control:&mut Control,cfg:&Config<C>,royalty:u16,system:&System,ctx:&mut TxContext):ID{factory::create_native_pack<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(maker,parent_version,control,cfg,royalty,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision(),system,ctx)}

#[test_only]
public(package) fun buy_access_for_testing<C>(p:&mut Product<C>,cfg:&mut Config<C>,v:u64,hash:vector<u8>,fee_revision:u64,expiry:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) { implementation::buy_access_native_for_testing<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,hash,fee_revision,expiry,attempt,payment,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
#[test_only]
public(package) fun claim_access_for_testing<C>(p:&mut Product<C>,cfg:&Config<C>,v:u64,hash:vector<u8>,fee_revision:u64,expiry:u64,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext){ implementation::claim_access_native_for_testing<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,hash,fee_revision,expiry,attempt,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
#[test_only]
public(package) fun ensure_access_for_testing<C>(p:&mut Product<C>,cfg:&Config<C>,v:u64,attempt:vector<u8>,fee_revision:u64,expiry:u64,clock:&Clock,ctx:&mut TxContext){ implementation::ensure_access_native_for_testing<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,v,attempt,fee_revision,expiry,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
#[test_only]
public(package) fun create_pack_for_testing<C>(maker:&Product<C>,parent_version:u64,control:&mut Control,cfg:&Config<C>,royalty:u16,ctx:&mut TxContext):ID{implementation::create_pack_native_for_testing<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(maker,parent_version,control,cfg,royalty,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision())}
#[test_only]
public(package) fun collect_primary_for_testing<C>(p:&mut Product<C>,cfg:&mut Config<C>,r:PrimaryReceipt,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext){ implementation::collect_primary_native_for_testing<C,soulidity_v1::application_operator::ApplicationOperator,soulidity_v1::application_operator::ApplicationRevision1,Soul>(p,cfg,r,payment,clock,ctx,soulidity_v1::application_operator::operator(),soulidity_v1::application_operator::revision()) }
