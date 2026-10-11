/// Certified producer consumption. Held Soul/Item exit and transfers remain independent.
module soulidity_v1::runtime;
use std::string::String;
use sui::coin::Coin;
use sui::clock::Clock;
use walrus::blob::Blob;
use walrus::system::{Self,System};
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config};
use soulidity_maker_manufacturing::maker_player::{Player};
use soulidity_v1::player;
use soulidity_v1::issuer::{Self,Purchase};
use soulidity_application::output::{Self};
use soulidity_maker_publication::output_data::{Intent,Policy};
use soulidity_model::policy::{Self,Layout};
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_v1::physical::{Self,Registry,Asset};
use soulidity_model::assembly::{Self,PartKey};
use soulidity_content_kinds::content_kind_registry::KindRegistry;
use soulidity_v1::release;
const ESystem:u64=1;
const EMaterial:u64=2;
/// Copy this issued asset's original material for public PTB use. Transport metadata
/// remains readable after archive/expiry; decryption still requires Seal approval.
public fun physical_material<C>(a:&Asset,p:&Product<C>,plain:vector<u8>):soulidity_maker_manufacturing::maker_release::Asset{
    let source=physical::asset_source(a);
    assert!(object::id(p)==policy::source_product(source),EMaterial);
    let fragments=soulidity_visual::visual::fragments(policy::source_representation(source));
    assert!(fragments.any!(|f|soulidity_visual::visual::fragment_asset(f)==plain),EMaterial);
    *release::certificate_asset_by_hash(release::certificate(p,policy::source_version(source)),plain)
}
/// No copy/drop/store/key: all paid contributions, content and finish share one PTB.
public struct Build {inner:issuer::Build,system:ID,epoch:u32}
fun guard(b:&Build,system:&System){assert!(b.system==object::id(system) && b.epoch==system::epoch(system),ESystem)}
fun pair<C>(maker:&Product<C>,product:&Product<C>,cfg:&Config<C>,maker_version:u64,version:u64,system:&System){release::assert_current(maker,cfg,maker_version,system);if(object::id(product)!=object::id(maker))release::assert_current(product,cfg,version,system)}
public fun soul_id(b:&Build):ID{issuer::soul_id(&b.inner)}
public fun output_intent(b:&Build):&Intent{issuer::output_intent(&b.inner)}
public fun output_policy(b:&Build):&Policy{issuer::output_policy(&b.inner)}
public fun semantic_recipe_hash(b:&Build):vector<u8>{issuer::semantic_recipe_hash(&b.inner)}

public fun create_pack<C>(maker:&Product<C>,parent_version:u64,control:&mut Control,cfg:&Config<C>,control_royalty_bps:u16,system:&System,ctx:&mut TxContext):ID {
    release::assert_current(maker,cfg,parent_version,system);catalog::create_pack<C>(maker,parent_version,control,cfg,control_royalty_bps,system,ctx)
}

public fun buy_access<C>(p:&mut Product<C>,cfg:&mut Config<C>,v:u64,hash:vector<u8>,fee_revision:u64,expiry:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext) {
    release::assert_current(p,cfg,v,system);catalog::buy_access<C>(p,cfg,v,hash,fee_revision,expiry,attempt,payment,clock,system,ctx)
}

public fun claim_access<C>(p:&mut Product<C>,cfg:&Config<C>,v:u64,hash:vector<u8>,fee_revision:u64,expiry:u64,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext){
    release::assert_current(p,cfg,v,system);catalog::claim_access<C>(p,cfg,v,hash,fee_revision,expiry,attempt,clock,system,ctx)
}

public fun create_player<C>(maker:&mut Product<C>,cfg:&Config<C>,version:u64,fee_revision:u64,expiry:u64,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):ID {
    release::assert_current(maker,cfg,version,system);player::create<C>(maker,cfg,version,fee_revision,expiry,attempt,clock,system,ctx)
}

public fun set_base<C>(p:&mut Player,maker:&Product<C>,cfg:&Config<C>,definition:vector<u8>,layout:Layout,expected:u64,fee_revision:u64,expiry:u64,clock:&Clock,system:&System,ctx:&TxContext) {
    release::assert_current(maker,cfg,player::maker_version(p),system);player::set_base<C>(p,maker,cfg,definition,layout,expected,fee_revision,expiry,clock,system,ctx)
}

public fun set_pack<C>(p:&mut Player,maker:&Product<C>,pack:&Product<C>,cfg:&Config<C>,version:u64,definition:vector<u8>,layout:Layout,expected:u64,fee_revision:u64,expiry:u64,clock:&Clock,system:&System,ctx:&TxContext) {
    release::assert_current(maker,cfg,player::maker_version(p),system);release::assert_current(pack,cfg,version,system);player::set_pack<C>(p,maker,pack,cfg,version,definition,layout,expected,fee_revision,expiry,clock,system,ctx)
}

public fun enhance_maker<C>(s:&mut Soul,maker:&mut Product<C>,cfg:&mut Config<C>,expected:u64,policy_hash:vector<u8>,choices:vector<Purchase>,attempt:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext):vector<soulidity_model::components::Item>{
    release::assert_current(maker,cfg,soul::maker_version(s),system);issuer::enhance_maker<C>(s,maker,cfg,expected,policy_hash,choices,attempt,fee_revision,expiry,payment,clock,system,ctx)
}

public fun enhance_pack<C>(s:&mut Soul,pack:&mut Product<C>,maker:&Product<C>,cfg:&mut Config<C>,version:u64,expected:u64,policy_hash:vector<u8>,choices:vector<Purchase>,attempt:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext):vector<soulidity_model::components::Item>{
    pair(maker,pack,cfg,soul::maker_version(s),version,system);issuer::enhance_pack<C>(s,pack,maker,cfg,version,expected,policy_hash,choices,attempt,fee_revision,expiry,payment,clock,system,ctx)
}

public fun begin<C>(maker:&mut Product<C>,cfg:&mut Config<C>,intent:Intent,output_key:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext):Build {
    release::assert_current(maker,cfg,output::intent_version(&intent),system);Build{system:object::id(system),epoch:system::epoch(system),inner:issuer::begin<C>(soulidity_v1::native_binding::application_binding(cfg),maker,cfg,intent,output_key,fee_revision,expiry,payment,clock,system,ctx)}
}

public fun include_pack<C>(b:&mut Build,pack:&mut Product<C>,maker:&Product<C>,cfg:&mut Config<C>,version:u64,policy_hash:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext) {
    guard(b,system);pair(maker,pack,cfg,output::intent_version(issuer::output_intent(&b.inner)),version,system);issuer::include_pack<C>(&mut b.inner,pack,maker,cfg,version,policy_hash,fee_revision,expiry,payment,clock,system,ctx)
}

public fun select_scoped<C>(b:&mut Build,product:&mut Product<C>,definition_hash:vector<u8>,part:soulidity_model::assembly::PartKey,layout:Layout,cfg:&Config<C>,system:&System,ctx:&mut TxContext) {
    guard(b,system);release::assert_current(product,cfg,issuer::product_version(&b.inner,object::id(product)),system);issuer::select_scoped<C>(&mut b.inner,product,definition_hash,part,layout,ctx)
}

public fun select_player_scoped<C>(b:&mut Build,product:&mut Product<C>,p:&Player,part:soulidity_model::assembly::PartKey,expected_player:u64,cfg:&Config<C>,system:&System,ctx:&mut TxContext) {
    guard(b,system);release::assert_current(product,cfg,issuer::product_version(&b.inner,object::id(product)),system);issuer::select_player_scoped<C>(&mut b.inner,product,p,part,expected_player,ctx)
}

public fun append_initial_content(b:&mut Build,registry:&KindRegistry,kind:u32,name:String,blob:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,clock:&Clock,ctx:&TxContext):u64 {
    guard(b,system);issuer::append_initial_content(&mut b.inner,registry,kind,name,blob,system,sha256,envelope,clock,ctx)
}
public fun set_initial_state_config(b:&mut Build,key:String,value:vector<u8>,system:&System,ctx:&mut TxContext){
    guard(b,system);issuer::set_initial_state_config(&mut b.inner,key,value,ctx)
}

#[test_only]
public fun finish(b:Build,render:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,ctx:&mut TxContext):ID {
    guard(&b,system);let Build{inner,system:_,epoch:_}=b;issuer::finish(inner,render,system,sha256,envelope,ctx)
}

/// Explicit live finish retains Config and Clock identity through delivery.
public fun finish_live<C>(b:Build,cfg:&Config<C>,clock:&Clock,render:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,ctx:&mut TxContext):ID{guard(&b,system);let Build{inner,system:_,epoch:_}=b;issuer::finish_live(inner,cfg,clock,render,system,sha256,envelope,ctx)}

public fun select_colors(b:&mut Build,colors:vector<soulidity_visual::visual::ColorChoice>,ctx:&TxContext){
    issuer::select_colors(&mut b.inner,colors,ctx)
}

public fun select<C>(b:&mut Build,product:&mut Product<C>,definition_hash:vector<u8>,part:vector<u8>,layout:Layout,cfg:&Config<C>,system:&System,ctx:&mut TxContext){
    select_scoped<C>(b,product,definition_hash,assembly::root_part(part),layout,cfg,system,ctx)
}

public fun select_player<C>(b:&mut Build,product:&mut Product<C>,p:&Player,part:vector<u8>,expected_player:u64,cfg:&Config<C>,system:&System,ctx:&mut TxContext){
    select_player_scoped<C>(b,product,p,assembly::root_part(part),expected_player,cfg,system,ctx)
}

public fun physical_create_registry<C>(maker:&mut Product<C>,control:&mut Control,version:u64,cfg:&Config<C>,system:&System,ctx:&mut TxContext):ID {
    release::assert_current(maker,cfg,version,system);physical::create_registry<C>(maker,control,version,cfg,system,ctx)
}


public fun physical_register_pack<C>(r:&mut Registry<C>,maker:&Product<C>,maker_control:&mut Control,pack:&Product<C>,pack_control:&mut Control,version:u64,expected:u64,cfg:&Config<C>,system:&System,ctx:&TxContext) {
    pair(maker,pack,cfg,physical::registry_version(r),version,system);physical::register_pack<C>(r,maker,maker_control,pack,pack_control,version,expected,ctx)
}

public fun physical_claim_scoped<C>(r:&mut Registry<C>,maker:&Product<C>,product:&Product<C>,p:&Player,part:PartKey,cfg:&Config<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset {
    let selected=player::scoped_selection(p,part).destroy_some();pair(maker,product,cfg,player::maker_version(p),policy::source_version(player::source(&selected)),system);physical::claim_scoped<C>(r,maker,product,p,part,cfg,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx)
}

public fun physical_purchase_scoped<C>(r:&mut Registry<C>,maker:&mut Product<C>,p:&Player,part:PartKey,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset {
    release::assert_current(maker,cfg,player::maker_version(p),system);physical::purchase_scoped<C>(r,maker,p,part,cfg,payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,system,ctx)
}

public fun physical_purchase_pack_scoped<C>(r:&mut Registry<C>,maker:&Product<C>,pack:&mut Product<C>,p:&Player,part:PartKey,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset {
    let selected=player::scoped_selection(p,part).destroy_some();pair(maker,pack,cfg,player::maker_version(p),policy::source_version(player::source(&selected)),system);physical::purchase_pack_scoped<C>(r,maker,pack,p,part,cfg,payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,system,ctx)
}

public fun physical_materialize_scoped<C>(r:&mut Registry<C>,maker:&Product<C>,product:&Product<C>,s:&mut Soul,part:PartKey,materialization_key:vector<u8>,cfg:&Config<C>,expected_soul:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset {
    let binding=soul::binding_scoped(s,part).destroy_some();pair(maker,product,cfg,soul::maker_version(s),policy::source_version(soul::binding_source(&binding)),system);physical::materialize_scoped<C>(r,maker,product,s,part,materialization_key,cfg,expected_soul,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx)
}

public fun physical_claim<C>(r:&mut Registry<C>,maker:&Product<C>,product:&Product<C>,p:&Player,part:vector<u8>,cfg:&Config<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset{
    physical_claim_scoped<C>(r,maker,product,p,assembly::root_part(part),cfg,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,system,ctx)
}

public fun physical_purchase<C>(r:&mut Registry<C>,maker:&mut Product<C>,p:&Player,part:vector<u8>,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset{
    physical_purchase_scoped<C>(r,maker,p,assembly::root_part(part),cfg,payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,system,ctx)
}

public fun physical_purchase_pack<C>(r:&mut Registry<C>,maker:&Product<C>,pack:&mut Product<C>,p:&Player,part:vector<u8>,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset{
    physical_purchase_pack_scoped<C>(r,maker,pack,p,assembly::root_part(part),cfg,payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,system,ctx)
}

public fun physical_materialize<C>(r:&mut Registry<C>,maker:&Product<C>,product:&Product<C>,s:&mut Soul,part:vector<u8>,materialization_key:vector<u8>,cfg:&Config<C>,expected_soul:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset{
    physical_materialize_scoped<C>(r,maker,product,s,assembly::root_part(part),materialization_key,cfg,expected_soul,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,system,ctx)
}
