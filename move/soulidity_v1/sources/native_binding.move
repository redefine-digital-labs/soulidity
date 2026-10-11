/// Fixed canonical application consumer of the independently owned Native binder.
/// Historical marker declarations remain inert source references; no constructor exists.
module soulidity_v1::native_binding;
use std::type_name::TypeName;
use soulidity_foundation::economics::{Config,Admin,Authority};
use soulidity_native_binder::native_binding::{Self as leaf,Catalog};
use soulidity_v1::application_operator::{Self as op,ApplicationOperator,ApplicationRevision1};
use soulidity_v1::issuer::Build;
public struct NativeRevision1 has drop {}
public struct NativeRevision2 has drop {}
public struct NativeInstaller1 has drop {}
public fun install<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,hash:vector<u8>,ctx:&mut TxContext):ID{leaf::install<C,Build,ApplicationOperator,ApplicationRevision1>(op::operator(),op::revision(),c,a,expected,hash,ctx)}
public fun current<C>(c:&Config<C>):&Catalog<C>{leaf::current(c)}
public fun historical<C>(c:&Config<C>,generation:u64):&Catalog<C>{leaf::historical(c,generation)}
public fun commitment<C>(r:&Catalog<C>):vector<u8>{leaf::commitment(r)}
public fun generation<C>(r:&Catalog<C>):u64{leaf::generation(r)}
public fun config<C>(r:&Catalog<C>):ID{leaf::config(r)}
public fun original_package<C>(r:&Catalog<C>):ID{leaf::original_package(r)}
public fun callable_package<C>(r:&Catalog<C>):ID{leaf::callable_package(r)}
public fun payment_coin<C>(r:&Catalog<C>):TypeName{leaf::payment_coin(r)}
public fun owner_model<C>(r:&Catalog<C>):u8{leaf::owner_model(r)}
public fun role_count<C>(r:&Catalog<C>):u64{leaf::role_count(r)}
public fun role<C>(r:&Catalog<C>,index:u64):TypeName{leaf::role(r,index)}
public fun role_defining<C>(r:&Catalog<C>,index:u64):TypeName{leaf::role_defining(r,index)}
public fun assert_current<C>(c:&Config<C>){leaf::assert_current<C,Build,ApplicationOperator,ApplicationRevision1>(c)}
#[test_only]
public fun create_enabled_for_testing<C>(authority:&Authority,primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):ID{leaf::create_enabled_for_testing<C,Build,ApplicationOperator,ApplicationRevision1>(op::operator(),op::revision(),authority,primary,secondary,fixed,recipient,ctx)}
#[test_only]
public fun create_enabled_collection_for_testing<C>(authority:&Authority,primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):ID{leaf::create_enabled_collection_for_testing<C,Build,ApplicationOperator,ApplicationRevision1>(op::operator(),op::revision(),authority,primary,secondary,fixed,recipient,ctx)}
#[test_only]
public fun create_config_for_testing<C>(authority:&Authority,primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):ID{leaf::create_config_for_testing<C,Build,ApplicationOperator,ApplicationRevision1>(op::operator(),op::revision(),authority,primary,secondary,fixed,recipient,ctx)}
#[test_only]
public fun installation_for_testing<C>(c:&Config<C>,a:&mut Admin,expected:u64,hash:vector<u8>,r:&Catalog<C>):soulidity_foundation::economics::Installation<C,Catalog<C>>{leaf::installation_for_testing(c,a,expected,hash,r)}
#[test_only]
public fun catalog_for_testing<C>(c:&Config<C>,generation:u64,ctx:&mut TxContext):Catalog<C>{leaf::catalog_for_testing<C,Build,ApplicationOperator,ApplicationRevision1>(op::operator(),op::revision(),c,generation,ctx)}
public fun register<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,hash:vector<u8>,p:&sui::package::Publisher,cap:&sui::package::UpgradeCap){leaf::register(c,a,expected,hash,p,cap)}
#[test_only]
public fun publisher_for_testing(ctx:&mut TxContext):sui::package::Publisher{leaf::publisher_for_testing(ctx)}
public(package) fun application_binding<C>(cfg:&Config<C>):soulidity_maker_admission::maker_issuance::Binding{leaf::application_binding<C,Build,ApplicationOperator,ApplicationRevision1>(cfg,op::operator(),op::revision())}
