/// Thin Core journey adapter; canonical types, authority and logic belong to the leaf.
module soulidity_v1::market;
use std::bcs;
use std::type_name::{Self,TypeName};
use sui::dynamic_object_field as dof;
use sui::coin::Coin;
use sui::clock::{Self,Clock};
use sui::event;
use soulidity_application::character::{Self as soul,Manifest};
use soulidity_standard::soul::Soul;
use soulidity_model::components::{Self as item,Item};
use soulidity_model::policy;
use soulidity_maker_manufacturing::maker_catalog::{Control,Product};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config,MarketPolicy,MarketReceipt};
use soulidity_collection::collection::{Collection};
use soulidity_v1::collection;
use soulidity_maker_terms::maker_resale::{Self as resale,Snapshot,Receipt};
use soulidity_market::market as implementation;
use soulidity_market::market::{MarketRevision1,MarketRevision2,MARKET,AssetKey,Listing,CollectionFee,Listed,Sold,Cancelled,ListingDeleted,Repriced,ControlManifest,AssetQuote,SoulQuote};
public fun list_soul<C>(s:Soul,cfg:&Config<C>,price:u64,expiry:u64,expected:u64,manifest_hash:vector<u8>,fee_revision:u64,clock:&Clock,ctx:&mut TxContext):ID { implementation::list_soul<C>(s,cfg,price,expiry,expected,manifest_hash,fee_revision,clock,ctx) }
public fun list_soul_with_collection<C>(s:Soul,c:&Collection,cfg:&Config<C>,price:u64,expiry:u64,expected:u64,manifest_hash:vector<u8>,fee_revision:u64,clock:&Clock,ctx:&mut TxContext):ID { implementation::list_soul_with_collection<C>(s,c,cfg,price,expiry,expected,manifest_hash,fee_revision,clock,ctx) }
public fun list_item<C>(it:Item,cfg:&Config<C>,price:u64,expiry:u64,fee_revision:u64,clock:&Clock,ctx:&mut TxContext):ID { implementation::list_item<C>(it,cfg,price,expiry,fee_revision,clock,ctx) }
public fun list_control<C>(c:Control,p:&Product<C>,cfg:&Config<C>,price:u64,expiry:u64,expected_version:u64,fee_revision:u64,clock:&Clock,ctx:&mut TxContext):ID { implementation::list_control<C>(c,p,cfg,price,expiry,expected_version,fee_revision,clock,ctx) }
public fun bundle<C>(l:&Listing<Soul,C>):Manifest { implementation::bundle<C>(l) }
public fun bundle_vault<C>(l:&Listing<Soul,C>):Option<soulidity_application::vault::Snapshot> { implementation::bundle_vault<C>(l) }
public fun bundle_standard<C>(l:&Listing<Soul,C>):soulidity_standard::soul::Manifest { implementation::bundle_standard<C>(l) }
public fun bundle_bound_source<C>(l:&Listing<Soul,C>,index:u64):soulidity_model::policy::Source { implementation::bundle_bound_source<C>(l,index) }
public fun bundle_reference_source<C>(l:&Listing<Soul,C>,index:u64):soulidity_model::policy::Source { implementation::bundle_reference_source<C>(l,index) }
public fun price<T:key+store,C>(l:&Listing<T,C>):u64 { implementation::price<T,C>(l) }
public fun status<T:key+store,C>(l:&Listing<T,C>):u8 { implementation::status<T,C>(l) }
public fun revision<T:key+store,C>(l:&Listing<T,C>):u64 { implementation::revision<T,C>(l) }
public fun manifest_hash<T:key+store,C>(l:&Listing<T,C>):vector<u8> { implementation::manifest_hash<T,C>(l) }
public fun buyer<T:key+store,C>(l:&Listing<T,C>):Option<address> { implementation::buyer<T,C>(l) }
public fun receipt<T:key+store,C>(l:&Listing<T,C>):Option<vector<u8>> { implementation::receipt<T,C>(l) }
public fun rights<C>(l:&Listing<Soul,C>):Snapshot { implementation::rights<C>(l) }
public fun settlement<T:key+store,C>(l:&Listing<T,C>):Option<Receipt> { implementation::settlement<T,C>(l) }
public fun asset_settlement<T:key+store,C>(l:&Listing<T,C>):Option<MarketReceipt> { implementation::asset_settlement<T,C>(l) }
public fun item_quote<C>(l:&Listing<Item,C>,cfg:&Config<C>):MarketReceipt { implementation::item_quote<C>(l,cfg) }
public fun control_quote<C>(l:&Listing<Control,C>,cfg:&Config<C>):MarketReceipt { implementation::control_quote<C>(l,cfg) }
public fun item_quote_hash<C>(l:&Listing<Item,C>,cfg:&Config<C>,buyer:address):vector<u8> { implementation::item_quote_hash<C>(l,cfg,buyer) }
public fun control_quote_hash<C>(l:&Listing<Control,C>,cfg:&Config<C>,buyer:address):vector<u8> { implementation::control_quote_hash<C>(l,cfg,buyer) }
public fun reprice_item<C>(l:&mut Listing<Item,C>,cfg:&Config<C>,expected:u64,manifest_hash:vector<u8>,price:u64,expiry:u64,fee_revision:u64,clock:&Clock,ctx:&TxContext) { implementation::reprice_item<C>(l,cfg,expected,manifest_hash,price,expiry,fee_revision,clock,ctx) }
public fun soul_quote<C>(l:&Listing<Soul,C>,cfg:&Config<C>):Receipt { implementation::soul_quote<C>(l,cfg) }
public fun collection_quote<C>(l:&Listing<Soul,C>,c:&Collection,cfg:&Config<C>):Receipt { implementation::collection_quote<C>(l,c,cfg) }
public fun collection_total<C>(l:&Listing<Soul,C>,c:&Collection,cfg:&Config<C>):u64 { implementation::collection_total<C>(l,c,cfg) }
public fun soul_quote_hash<C>(l:&Listing<Soul,C>,cfg:&Config<C>,buyer:address):vector<u8> { implementation::soul_quote_hash<C>(l,cfg,buyer) }
public fun collection_quote_hash<C>(l:&Listing<Soul,C>,c:&Collection,cfg:&Config<C>,buyer:address):vector<u8> { implementation::collection_quote_hash<C>(l,c,cfg,buyer) }
public fun cancel<T:key+store,C>(l:&mut Listing<T,C>,expected:u64,ctx:&TxContext) { implementation::cancel<T,C>(l,expected,ctx) }
public fun delete_listing<T:key+store,C>(l:Listing<T,C>,ctx:&TxContext) { implementation::delete_listing<T,C>(l,ctx) }
public fun buy_soul<C>(l:&mut Listing<Soul,C>,cfg:&mut Config<C>,expected:u64,manifest_hash:vector<u8>,expected_quote:vector<u8>,fee_revision:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) { implementation::buy_soul<C>(l,cfg,expected,manifest_hash,expected_quote,fee_revision,attempt,payment,clock,ctx) }
public fun buy_soul_with_collection<C>(l:&mut Listing<Soul,C>,c:&Collection,cfg:&mut Config<C>,expected:u64,manifest_hash:vector<u8>,expected_collection:vector<u8>,expected_quote:vector<u8>,fee_revision:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) { implementation::buy_soul_with_collection<C>(l,c,cfg,expected,manifest_hash,expected_collection,expected_quote,fee_revision,attempt,payment,clock,ctx) }
public fun buy_item<C>(l:&mut Listing<Item,C>,cfg:&mut Config<C>,expected:u64,manifest_hash:vector<u8>,expected_quote:vector<u8>,fee_revision:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) { implementation::buy_item<C>(l,cfg,expected,manifest_hash,expected_quote,fee_revision,attempt,payment,clock,ctx) }
public fun buy_control<C>(l:&mut Listing<Control,C>,p:&Product<C>,cfg:&mut Config<C>,expected:u64,manifest_hash:vector<u8>,expected_quote:vector<u8>,fee_revision:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) { implementation::buy_control<C>(l,p,cfg,expected,manifest_hash,expected_quote,fee_revision,attempt,payment,clock,ctx) }
public fun register<C>(cfg:&mut soulidity_foundation::economics::Config<C>,admin:&mut soulidity_foundation::economics::Admin,expected:u64,hash:vector<u8>,publisher:&sui::package::Publisher,cap:&sui::package::UpgradeCap) { implementation::register<C>(cfg,admin,expected,hash,publisher,cap) }
#[test_only]
public fun settle_for_testing<C>(cfg:&mut Config<C>,s:&Snapshot,r:Receipt,payment:Coin<C>,subject:ID,attempt:vector<u8>,ctx:&mut TxContext) { implementation::settle_for_testing<C>(cfg,s,r,payment,subject,attempt,ctx) }

#[test_only]
public fun setup_for_testing(access_price:u64,completion_mode:u8,completion_price:u64,quota:u64,cap:u64,fixed_fee:u64):sui::test_scenario::Scenario {
    soulidity_v1::fixtures::setup_with_canonical_market_for_testing(access_price,completion_mode,completion_price,quota,cap,fixed_fee,false,true,vector[])
}
#[test_only]
public fun bootstrap_for_testing<C>(cfg:&mut Config<C>,admin:&mut economics::Admin){implementation::bootstrap_for_testing(cfg,admin)}

#[test_only]
public struct MarketAuthority1 has drop {}

#[test_only]
public struct MarketRevision3 has drop {}

// Historical private witness construction exists only in VM fixtures.
#[test_only]
fun historical_core_fixture():sui::test_scenario::Scenario {
    soulidity_v1::fixtures::setup_with_market_for_testing(0,0,0,0,0,0,MarketAuthority1{},MarketRevision3{})
}
#[test_only]
public fun setup_historical_core_for_testing():sui::test_scenario::Scenario {
    let mut sc=historical_core_fixture();
    let cfg:Config<soulidity_v1::fixtures::USD> =sui::test_scenario::take_shared(&sc);
    assert_historical_core_role_for_testing(&cfg);
    sui::test_scenario::return_shared(cfg);sc.next_tx(@0xb);sc
}
#[test_only]
public fun assert_historical_core_role_for_testing<C>(cfg:&Config<C>){
    use soulidity_foundation::package_roles;
    let role=economics::role(cfg,3);
    assert!(package_roles::original(&role)==object::id_from_address(type_name::original_id<MarketAuthority1>()),101);
    assert!(package_roles::callable(&role)==object::id_from_address(type_name::defining_id<MarketRevision3>()),102);
    assert!(package_roles::marker(&role)==option::some(type_name::with_defining_ids<MarketRevision3>()),103);
    assert!(package_roles::pinned(&role) && !package_roles::frozen(&role) && package_roles::version(&role)==1,104);
    assert!(type_name::with_original_ids<MarketAuthority1>()!=type_name::with_original_ids<soulidity_market::market::MarketAuthority1>(),105);
    assert!(type_name::with_defining_ids<MarketRevision3>()!=type_name::with_defining_ids<soulidity_market::market::MarketRevision3>(),106);
    economics::assert_role_types<C,MarketAuthority1,MarketRevision3>(cfg,3);
    economics::assert_secondary(cfg);
    soulidity_v1::native_binding::assert_current(cfg);
}
