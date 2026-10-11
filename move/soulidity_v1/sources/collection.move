/// Thin Core journey adapter; canonical types, authority and logic belong to the leaf.
module soulidity_v1::collection;
use std::string::String;
use std::bcs;
use sui::table::{Self,Table};
use sui::package::{Self,Publisher};
use sui::display;
use sui::kiosk::{Self,Kiosk,PurchaseCap};
use sui::transfer_policy::{Self,TransferPolicy,TransferPolicyCap};
use sui::dynamic_object_field as dof;
use sui::coin::{Self,Coin};
use sui::clock::{Self,Clock};
use sui::event;
use soulidity_custody::account::{Self as custody,Account};
use soulidity_foundation::economics::{Self,Config};
use soulidity_model::policy;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_collection::collection as implementation;
use soulidity_collection::collection::{CollectionAuthority1,CollectionRevision1,CollectionRevision2,CollectionRevision3,COLLECTION,Factory,Rule,RuleConfig,Collection,Right,Snapshot,RightKey,Listing,Quote,Created,Added,Listed,Sold,Cancelled,ListingDeleted,ListingReclaimed};
#[test_only]
public fun init_for_testing(ctx:&mut TxContext) { implementation::init_for_testing(ctx) }
public fun factory_policy(f:&Factory):ID { implementation::factory_policy(f) }
public fun create<C>(f:&Factory,p:&TransferPolicy<Right>,cfg:&Config<C>,k:&mut Kiosk,a:&mut Account,name:String,description:String,image_url:String,extra:u16,tradeable:bool,max_supply:Option<u64>,floor:Option<u128>,fee_revision:u64,expiry:u64,clock:&Clock,ctx:&mut TxContext):ID { implementation::create<C>(f,p,cfg,k,a,name,description,image_url,extra,tradeable,max_supply,floor,fee_revision,expiry,clock,ctx) }
public fun add_soul(c:&mut Collection,s:&mut Soul,expected_collection:u64,expected_soul:u64,ctx:&TxContext) { implementation::add_soul<soulidity_v1::application_operator::ApplicationOperator>(soulidity_v1::application_operator::operator(),c,s,expected_collection,expected_soul,ctx) }
public fun add_kiosk_soul<C>(c:&mut Collection,cfg:&Config<C>,k:&mut Kiosk,a:&mut Account,id:ID,expected_collection:u64,expected_soul:u64,ctx:&TxContext) { implementation::add_kiosk_soul<C,soulidity_v1::application_operator::ApplicationOperator>(soulidity_v1::application_operator::operator(),c,cfg,k,a,id,expected_collection,expected_soul,ctx) }
public fun snapshot(c:&Collection):Snapshot { implementation::snapshot(c) }
public fun snapshot_hash(c:&Collection):vector<u8> { implementation::snapshot_hash(c) }
public fun creator(c:&Collection):address { implementation::creator(c) }
public fun protocol_version():u16 { implementation::protocol_version() }
public fun version(c:&Collection):u16 { implementation::version(c) }
public fun right_version(r:&Right):u16 { implementation::right_version(r) }
public fun protocol(c:&Collection):ID { implementation::protocol(c) }
public fun current_holder(c:&Collection):address { implementation::current_holder(c) }
public fun current_kiosk(c:&Collection):ID { implementation::current_kiosk(c) }
public fun ownership_epoch(c:&Collection):u64 { implementation::ownership_epoch(c) }
public fun revision(c:&Collection):u64 { implementation::revision(c) }
public fun right_id(c:&Collection):ID { implementation::right_id(c) }
public fun extra_royalty(c:&Collection):u16 { implementation::extra_royalty(c) }
public fun tradeable(c:&Collection):bool { implementation::tradeable(c) }
public fun max_supply(c:&Collection):Option<u64> { implementation::max_supply(c) }
public fun supply(c:&Collection):u64 { implementation::supply(c) }
public fun floor_price(c:&Collection):Option<u128> { implementation::floor_price(c) }
public fun contains(c:&Collection,id:ID):bool { implementation::contains(c,id) }
public fun right_collection(r:&Right):ID { implementation::right_collection(r) }
public fun right_name(r:&Right):String { implementation::right_name(r) }
public fun right_description(r:&Right):String { implementation::right_description(r) }
public fun right_image(r:&Right):String { implementation::right_image(r) }
public(package) fun assert_member(c:&Collection,s:&Soul) { implementation::assert_member(c,s) }
public fun list<C>(c:&Collection,k:&mut Kiosk,a:&mut Account,cfg:&Config<C>,ask:u64,expiry:u64,expected_epoch:u64,fee_revision:u64,clock:&Clock,ctx:&mut TxContext):ID { implementation::list<C>(c,k,a,cfg,ask,expiry,expected_epoch,fee_revision,clock,ctx) }
public fun quote<C>(l:&Listing<C>,cfg:&Config<C>,buyer:address):vector<u8> { implementation::quote<C>(l,cfg,buyer) }
public fun cancel<C>(l:&mut Listing<C>,k:&mut Kiosk,a:&mut Account,expected:u64,ctx:&TxContext) { implementation::cancel<C>(l,k,a,expected,ctx) }
public fun buy<C>(l:&mut Listing<C>,c:&mut Collection,f:&Factory,p:&TransferPolicy<Right>,seller:&mut Kiosk,buyer:&mut Kiosk,a:&mut Account,cfg:&mut Config<C>,expected_listing:u64,expected_epoch:u64,fee_revision:u64,expected_quote:vector<u8>,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) { implementation::buy<C>(l,c,f,p,seller,buyer,a,cfg,expected_listing,expected_epoch,fee_revision,expected_quote,attempt,payment,clock,ctx) }
public fun listing_state<C>(l:&Listing<C>):u8 { implementation::listing_state<C>(l) }
public fun listing_receipt<C>(l:&Listing<C>):Option<vector<u8>> { implementation::listing_receipt<C>(l) }
public fun listing_ask<C>(l:&Listing<C>):u64 { implementation::listing_ask<C>(l) }
public fun delete_listing<C>(l:Listing<C>,ctx:&TxContext) { implementation::delete_listing<C>(l,ctx) }
public fun register<C>(cfg:&mut soulidity_foundation::economics::Config<C>,admin:&mut soulidity_foundation::economics::Admin,expected:u64,hash:vector<u8>,factory:&Factory,cap:&sui::package::UpgradeCap) { implementation::register<C>(cfg,admin,expected,hash,factory,cap) }
#[test_only]
public fun right_for_testing<C>(cfg:&Config<C>,k:&mut Kiosk,a:&Account,id:ID,ctx:&TxContext):&Right { implementation::right_for_testing<C>(cfg,k,a,id,ctx) }
#[test_only]
public fun bootstrap_for_testing<C>(cfg:&mut Config<C>,admin:&mut soulidity_foundation::economics::Admin) { implementation::bootstrap_for_testing<C>(cfg,admin) }
#[test_only]
public fun wrong_right_type_for_testing<C,T:key+store>(cfg:&Config<C>,k:&mut Kiosk,a:&Account,id:ID,ctx:&TxContext):&T { implementation::wrong_right_type_for_testing<C,T>(cfg,k,a,id,ctx) }
#[test_only]
public fun old_revision_right_for_testing<C>(cfg:&Config<C>,k:&mut Kiosk,a:&Account,id:ID,ctx:&TxContext):&Right { implementation::old_revision_right_for_testing<C>(cfg,k,a,id,ctx) }
