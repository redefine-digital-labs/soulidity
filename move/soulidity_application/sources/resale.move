/// Thin namespace adapter to the sole Maker leaf implementation.
/// Types are canonical leaf types; this unpublished target is not old published ABI compatibility.
module soulidity_application::resale;
use std::bcs;
use sui::coin::{Self,Coin};
use sui::event;
use soulidity_model::policy;
use soulidity_foundation::economics::{Self,Config};
use soulidity_maker_terms::maker_resale::{Self as leaf,Rates,Snapshot,Receipt,Settled};
public fun rates(oc:u16,maker:u16):Rates {leaf::rates(oc,maker)}
public fun oc_bps(r:&Rates):u16 {leaf::oc_bps(r)}
public fun maker_bps(r:&Rates):u16 {leaf::maker_bps(r)}
public fun snapshot(protocol:ID,maker:ID,version:u64,policy_hash:vector<u8>,maker_creator:address,rates:Rates,ctx:&TxContext):Snapshot {leaf::snapshot(protocol,maker,version,policy_hash,maker_creator,rates,ctx)}
public fun schema(s:&Snapshot):u16 {leaf::schema(s)}
public fun hash(s:&Snapshot):vector<u8> {leaf::hash(s)}
public fun protocol(s:&Snapshot):ID {leaf::protocol(s)}
public fun maker(s:&Snapshot):ID {leaf::maker(s)}
public fun version(s:&Snapshot):u64 {leaf::version(s)}
public fun policy_hash(s:&Snapshot):vector<u8> {leaf::policy_hash(s)}
public fun oc_creator(s:&Snapshot):address {leaf::oc_creator(s)}
public fun maker_creator(s:&Snapshot):address {leaf::maker_creator(s)}
public fun snapshot_rates(s:&Snapshot):Rates {leaf::snapshot_rates(s)}
public fun quote_gross<C>(s:&Snapshot,cfg:&Config<C>,price:u64,seller:address):Receipt {leaf::quote_gross<C>(s,cfg,price,seller)}
public fun quote_collection<C>(s:&Snapshot,cfg:&Config<C>,ask:u64,seller:address,collection:ID,holder:address,extra:u16):Receipt {leaf::quote_collection<C>(s,cfg,ask,seller,collection,holder,extra)}
public fun settle<C,W:drop,R:drop>(_w:W,_revision:R,cfg:&mut Config<C>,s:&Snapshot,r:Receipt,payment:Coin<C>,subject:ID,attempt:vector<u8>,ctx:&mut TxContext) {leaf::settle<C,W,R>(_w,_revision,cfg,s,r,payment,subject,attempt,ctx)}
public fun basis(r:&Receipt):u8 {leaf::basis(r)}
public fun price(r:&Receipt):u64 {leaf::price(r)}
public fun total(r:&Receipt):u64 {leaf::total(r)}
public fun seller_amount(r:&Receipt):u64 {leaf::seller_amount(r)}
public fun platform_amount(r:&Receipt):u64 {leaf::platform_amount(r)}
public fun oc_amount(r:&Receipt):u64 {leaf::oc_amount(r)}
public fun maker_amount(r:&Receipt):u64 {leaf::maker_amount(r)}
public fun collection_amount(r:&Receipt):u64 {leaf::collection_amount(r)}
public fun seller(r:&Receipt):address {leaf::seller(r)}
public fun platform(r:&Receipt):address {leaf::platform(r)}
public fun oc_recipient(r:&Receipt):address {leaf::oc_recipient(r)}
public fun maker_recipient(r:&Receipt):address {leaf::maker_recipient(r)}
public fun config(r:&Receipt):ID {leaf::config(r)}
public fun collection_holder(r:&Receipt):Option<address> {leaf::collection_holder(r)}
public fun fee_revision(r:&Receipt):u64 {leaf::fee_revision(r)}
