/// Thin downstream facade; canonical state and ledgers live in Maker.
module soulidity_v1::metadata;
use std::bcs;
use std::hash;
use sui::dynamic_object_field as dof;
use sui::event;
use walrus::system::System;
use walrus::blob::Blob;
use soulidity_maker_manufacturing::maker_catalog::{Product,Control,Version};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config};
use soulidity_maker_manufacturing::maker_release::{Author,Draft};
use soulidity_v1::release;
use soulidity_model::policy::{Definition,Adapter};
use soulidity_visual::visual::Fragment;
use soulidity_model::material_policy::Terms;
use soulidity_maker_manufacturing::maker_metadata as implementation;
use soulidity_maker_manufacturing::maker_metadata::{VersionKey,Value,Metadata,StreamStep,Changed,Cancelled};

public fun start<C>(p:&Product<C>,control:&mut Control,cfg:&Config<C>,expected_version:u64,seed:Version,system:&System,ctx:&mut TxContext):Metadata{ implementation::start<C>(p,control,cfg,expected_version,seed,system,ctx) }
public fun deliver(m:Metadata,ctx:&TxContext){ implementation::deliver(m,ctx) }
public fun revision(m:&Metadata):u64{ implementation::revision(m) }
public fun byte_bound(m:&Metadata):u64{ implementation::byte_bound(m) }
public fun stream_commitment(m:&Metadata):vector<u8>{ implementation::stream_commitment(m) }
public fun version(m:&Metadata):&Version{ implementation::version(m) }
public fun policy_hash(m:&Metadata):vector<u8>{ implementation::policy_hash(m) }
public fun append_definitions<C>(m:&mut Metadata,p:&Product<C>,control:&mut Control,cfg:&Config<C>,definitions:vector<Definition>,system:&System,expected:u64,ctx:&TxContext){ implementation::append_definitions<C>(m,p,control,cfg,definitions,system,expected,ctx) }
public fun extend_definition<C>(m:&mut Metadata,p:&Product<C>,control:&mut Control,cfg:&Config<C>,index:u64,fragments:vector<Fragment>,system:&System,expected:u64,ctx:&TxContext){ implementation::extend_definition<C>(m,p,control,cfg,index,fragments,system,expected,ctx) }
public fun append_adapters<C>(m:&mut Metadata,p:&Product<C>,control:&mut Control,cfg:&Config<C>,adapters:vector<Adapter>,system:&System,expected:u64,ctx:&TxContext){ implementation::append_adapters<C>(m,p,control,cfg,adapters,system,expected,ctx) }
public fun append_physical<C>(m:&mut Metadata,p:&Product<C>,control:&mut Control,cfg:&Config<C>,terms:vector<Terms>,system:&System,expected:u64,ctx:&TxContext){ implementation::append_physical<C>(m,p,control,cfg,terms,system,expected,ctx) }
public fun begin_publication<C>(m:Metadata,p:&Product<C>,control:&mut Control,cfg:&Config<C>,expected:u64,hash:vector<u8>,author:Author,living:Blob,manifest:Blob,system:&System,ctx:&mut TxContext):Draft{ implementation::begin_publication<C>(m,p,control,cfg,expected,hash,author,living,manifest,system,ctx) }
public fun cancel(m:Metadata,ctx:&TxContext){ implementation::cancel(m,ctx) }
