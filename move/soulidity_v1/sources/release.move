/// Thin downstream facade; canonical state and ledgers live in Maker.
module soulidity_v1::release;
use std::bcs;
use std::hash;
use std::type_name;
use sui::dynamic_object_field as dof;
use sui::clock::Clock;
use walrus::blob::Blob;
use walrus::system::{Self,System};
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_v1::native_binding;
use soulidity_maker_manufacturing::maker_catalog::{Product,Control,Version};
use soulidity_v1::catalog;
use soulidity_transport::storage_transport::{Self as storage,Reference};
use soulidity_transport::blob_transport as blob_custody;
use soulidity_visual::visual;
use soulidity_application::publication_rules;
use soulidity_maker_publication::publication_validation::Expected;
use soulidity_model::policy;
use soulidity_transport::paged_transport::{Self as paged_store,Store};
use soulidity_maker_manufacturing::maker_release as implementation;
use soulidity_maker_manufacturing::maker_release::{MAKER_RELEASE,ReleaseInstaller1,ReleaseRevision1,ReleaseRevision2,ReleaseRevision3,Author,CatalogBody,Catalog,CatalogCommitment,Asset,Header,MetadataKey,DraftVersion,Draft,Custody,Certificate,CertificateCommitment,Scope};

public fun author(name:vector<u8>,description:vector<u8>,website:vector<u8>,license:vector<u8>,defaults:vector<u8>):Author{ implementation::author(name,description,website,license,defaults) }
public fun author_name(a:&Author):vector<u8>{ implementation::author_name(a) }
public fun author_defaults(a:&Author):vector<u8>{ implementation::author_defaults(a) }
public fun install<C>(cfg:&mut Config<C>,a:&mut Admin,system:&System,source:vector<u8>,abi:vector<u8>,expected:u64,expected_hash:vector<u8>,ctx:&mut TxContext):ID{ implementation::install<C>(cfg,a,system,source,abi,expected,expected_hash,ctx) }
public fun current<C>(cfg:&Config<C>):&Catalog<C>{ implementation::current<C>(cfg) }
public fun historical<C>(cfg:&Config<C>,generation:u64):&Catalog<C>{ implementation::historical<C>(cfg,generation) }
public fun catalog_hash<C>(c:&Catalog<C>):vector<u8>{ implementation::catalog_hash<C>(c) }
public fun catalog_system<C>(c:&Catalog<C>):ID{ implementation::catalog_system<C>(c) }
public fun catalog_generation<C>(c:&Catalog<C>):u64{ implementation::catalog_generation<C>(c) }
public fun assert_catalog<C>(cfg:&Config<C>,system:&System){ implementation::assert_catalog<C>(cfg,system) }
public fun begin<C>(p:&Product<C>,control:&mut Control,cfg:&Config<C>,expected_version:u64,v:Version,author:Author,living:Blob,manifest:Blob,system:&System,ctx:&mut TxContext):Draft{ implementation::begin<C>(p,control,cfg,expected_version,v,author,living,manifest,system,ctx) }
public fun deliver(d:Draft,ctx:&TxContext){ implementation::deliver(d,ctx) }
public fun revision(d:&Draft):u64{ implementation::revision(d) }
public fun asset_count(d:&Draft):u64{ implementation::asset_count(d) }
public fun expected_count(d:&Draft):u64{ implementation::expected_count(d) }
public fun draft_version(d:&Draft):&Version{ implementation::draft_version(d) }
public fun expected_asset(d:&Draft,index:u64):vector<u8>{ implementation::expected_asset(d,index) }
public fun expected_bytes(d:&Draft,asset:vector<u8>):u64{ implementation::expected_bytes(d,asset) }
public fun seal_scope(config:ID,product:ID,version:u64,asset:vector<u8>):vector<u8>{ implementation::seal_scope(config,product,version,asset) }
public fun append<C>(d:&mut Draft,p:&Product<C>,control:&mut Control,cfg:&Config<C>,asset:vector<u8>,protected:bool,transport_hash:vector<u8>,blob:Blob,system:&System,expected_revision:u64,ctx:&mut TxContext){ implementation::append<C>(d,p,control,cfg,asset,protected,transport_hash,blob,system,expected_revision,ctx) }
public fun append_batch<C>(d:&mut Draft,p:&Product<C>,control:&mut Control,cfg:&Config<C>,assets:vector<vector<u8>>,protected:vector<bool>,transport_hashes:vector<vector<u8>>,blobs:vector<Blob>,system:&System,expected_revision:u64,ctx:&mut TxContext){ implementation::append_batch<C>(d,p,control,cfg,assets,protected,transport_hashes,blobs,system,expected_revision,ctx) }
public fun finish<C>(d:Draft,p:&mut Product<C>,control:&mut Control,cfg:&Config<C>,system:&System,expected_revision:u64,ctx:&mut TxContext):ID{ implementation::finish<C>(d,p,control,cfg,system,expected_revision,ctx) }
public fun cancel_chunk(d:&mut Draft,limit:u64,expected:u64,ctx:&TxContext):vector<Blob>{ implementation::cancel_chunk(d,limit,expected,ctx) }
public fun cancel(d:Draft,ctx:&TxContext):vector<Blob>{ implementation::cancel(d,ctx) }
public fun certificate<C>(p:&Product<C>,version:u64):&Certificate{ implementation::certificate<C>(p,version) }
public fun certificate_hash(c:&Certificate):vector<u8>{ implementation::certificate_hash(c) }
public fun certificate_author(c:&Certificate):&Author{ implementation::certificate_author(c) }
public fun certificate_rows(c:&Certificate):u64{ implementation::certificate_rows(c) }
public fun certificate_asset(c:&Certificate,index:u64):&Asset{ implementation::certificate_asset(c,index) }
public fun certificate_asset_by_hash(c:&Certificate,asset:vector<u8>):&Asset{ implementation::certificate_asset_by_hash(c,asset) }
public fun asset_reference(a:&Asset):&Reference{ implementation::asset_reference(a) }
public fun asset_scope(a:&Asset):vector<u8>{ implementation::asset_scope(a) }
public fun asset_protected(a:&Asset):bool{ implementation::asset_protected(a) }
public fun asset_hash(a:&Asset):vector<u8>{ implementation::asset_hash(a) }
public fun asset_plain_bytes(a:&Asset):u64{ implementation::asset_plain_bytes(a) }
public fun extend_blob<C>(p:&mut Product<C>,control:&mut Control,cfg:&Config<C>,version:u64,kind:u8,index:u64,extension:walrus::storage_resource::Storage,system:&System){ implementation::extend_blob<C>(p,control,cfg,version,kind,index,extension,system) }
public fun pause<C>(p:&mut Product<C>,control:&mut Control,version:u64){ implementation::pause<C>(p,control,version) }
public fun archive<C>(p:&mut Product<C>,control:&mut Control,version:u64){ implementation::archive<C>(p,control,version) }
public fun resume<C>(p:&mut Product<C>,control:&mut Control,cfg:&Config<C>,version:u64,system:&System){ implementation::resume<C>(p,control,cfg,version,system) }
public fun assert_current<C>(p:&Product<C>,cfg:&Config<C>,version:u64,system:&System){ implementation::assert_current<C>(p,cfg,version,system) }
public fun seal_approve<C>(id:vector<u8>,p:&Product<C>,cfg:&Config<C>,version:u64,system:&System,clock:&Clock,ctx:&TxContext){ implementation::seal_approve<C>(id,p,cfg,version,system,clock,ctx) }
public fun seal_approve_pack<C>(id:vector<u8>,p:&Product<C>,maker:&Product<C>,cfg:&Config<C>,version:u64,system:&System,clock:&Clock,ctx:&TxContext){ implementation::seal_approve_pack<C>(id,p,maker,cfg,version,system,clock,ctx) }
public fun register<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,hash:vector<u8>,p:&sui::package::Publisher,cap:&sui::package::UpgradeCap){ implementation::register<C>(c,a,expected,hash,p,cap) }
