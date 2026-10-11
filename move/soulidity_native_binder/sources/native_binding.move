/// Canonical native object/issuer/container identity with a registered binder role.
/// This does not certify offchain bytes, Walrus/Seal policy or an UpgradeCap lock.
module soulidity_native_binder::native_binding;
public struct NATIVE_BINDING has drop {}
fun init(w:NATIVE_BINDING,ctx:&mut TxContext){sui::package::claim_and_keep(w,ctx)}
use std::bcs;
use std::hash;
use std::type_name::{Self,TypeName};
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
const EBinding:u64=1;
/// Retained for compatible type origins; current business uses Revision2.
public struct NativeRevision1 has drop {}
public struct NativeRevision2 has drop {}
/// Only this module constructs the role; sibling modules receive it privately.
public struct NativeInstaller1 has drop {}
public struct Catalog<phantom C> has key,store {id:UID,schema:u16,application_operator:TypeName,application_revision:TypeName,config:ID,generation:u64,original_package:ID,callable_package:ID,payment_coin:TypeName,owner_model:u8,roles:vector<TypeName>,defining_roles:vector<TypeName>,commitment:vector<u8>}
public struct Commitment has drop {domain:vector<u8>,schema:u16,application_operator:TypeName,application_revision:TypeName,catalog:ID,config:ID,generation:u64,original_package:ID,callable_package:ID,payment_coin:TypeName,owner_model:u8,roles:vector<TypeName>,defining_roles:vector<TypeName>}
/// Fixed role order: Soul, issuance Build, Vault module namespace, Kiosk Account,
/// Item, Product<C>, Control, Artifact, Config<C>, Soul-attached Vault, framework Kiosk,
/// framework KioskOwnerCap, Clock, Walrus Blob, Walrus System.
/// Every name comes from a concrete type; callers cannot supply a type tuple.
fun roles<C,B>():vector<TypeName>{vector[
    type_name::with_original_ids<soulidity_standard::soul::Soul>(),
    type_name::with_original_ids<B>(),
    type_name::with_original_ids<soulidity_application::vault::ContentOperator>(),
    type_name::with_original_ids<soulidity_custody::account::Account>(),
    type_name::with_original_ids<soulidity_model::components::Item>(),
    type_name::with_original_ids<soulidity_maker_manufacturing::maker_catalog::Product<C>>(),
    type_name::with_original_ids<soulidity_maker_manufacturing::maker_catalog::Control>(),
    type_name::with_original_ids<soulidity_application::output::Artifact>(),
    type_name::with_original_ids<Config<C>>(),
    type_name::with_original_ids<soulidity_application::vault::Vault>(),
    type_name::with_original_ids<sui::kiosk::Kiosk>(),
    type_name::with_original_ids<sui::kiosk::KioskOwnerCap>(),
    type_name::with_original_ids<sui::clock::Clock>(),
    type_name::with_original_ids<walrus::blob::Blob>(),
    type_name::with_original_ids<walrus::system::System>(),
]}
fun defining_roles<C,B>():vector<TypeName>{vector[
    type_name::with_defining_ids<soulidity_standard::soul::Soul>(),
    type_name::with_defining_ids<B>(),
    type_name::with_defining_ids<soulidity_application::vault::ContentOperator>(),
    type_name::with_defining_ids<soulidity_custody::account::Account>(),
    type_name::with_defining_ids<soulidity_model::components::Item>(),
    type_name::with_defining_ids<soulidity_maker_manufacturing::maker_catalog::Product<C>>(),
    type_name::with_defining_ids<soulidity_maker_manufacturing::maker_catalog::Control>(),
    type_name::with_defining_ids<soulidity_application::output::Artifact>(),
    type_name::with_defining_ids<Config<C>>(),
    type_name::with_defining_ids<soulidity_application::vault::Vault>(),
    type_name::with_defining_ids<sui::kiosk::Kiosk>(),
    type_name::with_defining_ids<sui::kiosk::KioskOwnerCap>(),
    type_name::with_defining_ids<sui::clock::Clock>(),
    type_name::with_defining_ids<walrus::blob::Blob>(),
    type_name::with_defining_ids<walrus::system::System>(),
]}
fun computed<C>(r:&Catalog<C>):vector<u8>{hash::sha2_256(bcs::to_bytes(&Commitment{domain:b"soulidity/native-binding/v3",schema:r.schema,application_operator:r.application_operator,application_revision:r.application_revision,catalog:object::id(r),config:r.config,generation:r.generation,original_package:r.original_package,callable_package:r.callable_package,payment_coin:r.payment_coin,owner_model:r.owner_model,roles:r.roles,defining_roles:r.defining_roles}))}
fun new<C,B,O,R>(config:ID,generation:u64,ctx:&mut TxContext):Catalog<C>{
    let original=object::id_from_address(type_name::original_id<NativeInstaller1>());let callable=object::id_from_address(type_name::defining_id<NativeRevision2>());
    
    let mut r=Catalog<C>{id:object::new(ctx),schema:3,application_operator:type_name::with_original_ids<O>(),application_revision:type_name::with_defining_ids<R>(),config,generation,original_package:original,callable_package:callable,payment_coin:type_name::with_original_ids<C>(),owner_model:0,roles:roles<C,B>(),defining_roles:defining_roles<C,B>(),commitment:vector[]};r.commitment=computed(&r);r
}
/// Install exactly once while disabled, or replace explicitly while disabled.
/// Previous catalogs remain owned by the same Config and readable by generation.
public fun install<C,B,O:drop,R:drop>(_operator:O,_revision:R,c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,ctx:&mut TxContext):ID{
    assert_application<B,O,R>();economics::assert_install_admin(c,a,expected,expected_commitment);let existing=economics::native_snapshot(c);let generation=if(existing.is_none())0 else economics::native_generation(existing.borrow())+1;
    let r=new<C,B,O,R>(object::id(c),generation,ctx);let id=object::id(&r);let h=r.commitment;
    let permit=economics::authorize_installation<C,NativeInstaller1,NativeRevision2,Catalog<C>>(c,a,expected,expected_commitment,0,NativeInstaller1{},NativeRevision2{},&r,generation,h);
    economics::install_native(c,a,permit,r,generation,h);id
}
public fun current<C>(c:&Config<C>):&Catalog<C>{economics::native_object(c)}
public fun historical<C>(c:&Config<C>,generation:u64):&Catalog<C>{economics::native_history(c,generation)}
public fun commitment<C>(r:&Catalog<C>):vector<u8>{r.commitment}
public fun generation<C>(r:&Catalog<C>):u64{r.generation}
public fun config<C>(r:&Catalog<C>):ID{r.config}
public fun original_package<C>(r:&Catalog<C>):ID{r.original_package}
public fun callable_package<C>(r:&Catalog<C>):ID{r.callable_package}
public fun payment_coin<C>(r:&Catalog<C>):TypeName{r.payment_coin}
public fun owner_model<C>(r:&Catalog<C>):u8{r.owner_model}
public fun role_count<C>(r:&Catalog<C>):u64{r.roles.length()}
public fun role<C>(r:&Catalog<C>,index:u64):TypeName{r.roles[index]}
public fun role_defining<C>(r:&Catalog<C>,index:u64):TypeName{r.defining_roles[index]}
public fun assert_current<C,B,O,R>(c:&Config<C>){
    assert_application<B,O,R>();economics::assert_role_types<C,NativeInstaller1,NativeRevision2>(c,0);let r=current(c);let n=economics::native_snapshot(c).destroy_some();
    assert!(r.schema==3 && r.application_operator==type_name::with_original_ids<O>() && r.application_revision==type_name::with_defining_ids<R>() && r.config==object::id(c) && r.payment_coin==type_name::with_original_ids<C>() && r.roles==roles<C,B>() && r.defining_roles==defining_roles<C,B>() && r.owner_model==0 && r.original_package==object::id_from_address(type_name::original_id<NativeInstaller1>()) && r.callable_package==object::id_from_address(type_name::defining_id<NativeRevision2>()) && r.commitment==computed(r) && object::id(r)==economics::native_catalog(&n) && r.generation==economics::native_generation(&n) && r.commitment==economics::native_commitment(&n),EBinding)
}
#[test_only]
public fun create_enabled_for_testing<C,B,O:drop,R:drop>(_operator:O,_revision:R,_authority:&Authority,primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):ID{
    let(mut c,mut a)=economics::new_config_for_testing<C>(primary,secondary,fixed,recipient,ctx);economics::bootstrap_application_for_testing<C,NativeInstaller1,NativeRevision2>(&mut c,&mut a,NativeInstaller1{},NativeRevision2{});soulidity_maker_manufacturing::maker_catalog::bootstrap_for_testing(&mut c,&mut a);soulidity_maker_manufacturing::maker_release::bootstrap_for_testing(&mut c,&mut a);soulidity_content::paid_access::bootstrap_for_testing(&mut c,&mut a);soulidity_market::market::bootstrap_for_testing(&mut c,&mut a);let hash=economics::commitment(&c);
    let r=new<C,B,O,R>(object::id(&c),0,ctx);let h=r.commitment;
    let permit=economics::authorize_installation<C,NativeInstaller1,NativeRevision2,Catalog<C>>(&c,&mut a,0,hash,0,NativeInstaller1{},NativeRevision2{},&r,0,h);
    economics::install_native_initial_for_testing(&mut c,&mut a,permit,r,h);economics::enable_initial_for_testing(&mut c);economics::share_config_for_testing(c,a,ctx)
}
#[test_only]
public fun create_enabled_collection_for_testing<C,B,O:drop,R:drop>(_operator:O,_revision:R,_authority:&Authority,primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):ID{
    let(mut c,mut a)=economics::new_config_for_testing<C>(primary,secondary,fixed,recipient,ctx);economics::bootstrap_application_for_testing<C,NativeInstaller1,NativeRevision2>(&mut c,&mut a,NativeInstaller1{},NativeRevision2{});soulidity_maker_manufacturing::maker_catalog::bootstrap_for_testing(&mut c,&mut a);soulidity_maker_manufacturing::maker_release::bootstrap_for_testing(&mut c,&mut a);soulidity_content::paid_access::bootstrap_for_testing(&mut c,&mut a);soulidity_market::market::bootstrap_for_testing(&mut c,&mut a);soulidity_collection::collection::bootstrap_for_testing(&mut c,&mut a);let hash=economics::commitment(&c);
    let r=new<C,B,O,R>(object::id(&c),0,ctx);let h=r.commitment;
    let permit=economics::authorize_installation<C,NativeInstaller1,NativeRevision2,Catalog<C>>(&c,&mut a,0,hash,0,NativeInstaller1{},NativeRevision2{},&r,0,h);
    economics::install_native_initial_for_testing(&mut c,&mut a,permit,r,h);economics::enable_initial_for_testing(&mut c);economics::share_config_for_testing(c,a,ctx)
}
#[test_only]
public fun installation_for_testing<C>(c:&Config<C>,a:&mut Admin,expected:u64,hash:vector<u8>,r:&Catalog<C>):economics::Installation<C,Catalog<C>>{
    assert!(r.config==object::id(c),EBinding);
    economics::authorize_installation<C,NativeInstaller1,NativeRevision2,Catalog<C>>(c,a,expected,hash,0,NativeInstaller1{},NativeRevision2{},r,r.generation,r.commitment)
}
#[test_only]
public fun catalog_for_testing<C,B,O:drop,R:drop>(_operator:O,_revision:R,c:&Config<C>,generation:u64,ctx:&mut TxContext):Catalog<C>{new<C,B,O,R>(object::id(c),generation,ctx)}

/// The role and current revision remain private values constructed in this module.
public fun register<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,hash:vector<u8>,p:&sui::package::Publisher,cap:&sui::package::UpgradeCap){
    economics::register_role<C,NativeInstaller1,NativeRevision2>(c,a,expected,hash,0,NativeInstaller1{},NativeRevision2{},p,cap)
}
#[test_only]
public fun publisher_for_testing(ctx:&mut TxContext):sui::package::Publisher{sui::package::test_claim(NativeInstaller1{},ctx)}

#[test_only]
public fun create_config_for_testing<C,B,O:drop,R:drop>(_operator:O,_revision:R,_authority:&Authority,primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):ID{
    let(mut c,mut a)=economics::new_config_for_testing<C>(primary,secondary,fixed,recipient,ctx);economics::bootstrap_application_for_testing<C,NativeInstaller1,NativeRevision2>(&mut c,&mut a,NativeInstaller1{},NativeRevision2{});economics::share_config_for_testing(c,a,ctx)
}

/// Sibling adapters enforce actual custody, owner, role and policy before calling.
/// A lineage token is not a latest-package or current-owner proof.
public fun application_binding<C,B,O:drop,R:drop>(cfg:&Config<C>,operator:O,revision:R):soulidity_maker_admission::maker_issuance::Binding{
    assert_current<C,B,O,R>(cfg);let _=revision;soulidity_maker_admission::maker_issuance::bind_external<C,NativeInstaller1,NativeRevision2,O,B>(cfg,NativeInstaller1{},NativeRevision2{},operator)
}

/// No raw role tuple is accepted. Only private markers from one real application
/// package can attest its assembly type. Installation still requires disabled Config/Admin/CAS.
fun assert_application<B,O,R>() {
    let b=type_name::with_original_ids<B>();let o=type_name::with_original_ids<O>();let r=type_name::with_original_ids<R>();
    assert!(!b.is_primitive() && !o.is_primitive() && !r.is_primitive(),EBinding);
    assert!(b.address_string()==o.address_string() && o.address_string()==r.address_string(),EBinding);
    assert!(*b.module_string().as_bytes()==b"issuer" && *b.datatype_string().as_bytes()==b"Build",EBinding);
    assert!(*o.module_string().as_bytes()==b"application_operator" && *o.datatype_string().as_bytes()==b"ApplicationOperator",EBinding);
    assert!(*r.module_string().as_bytes()==b"application_operator" && *r.datatype_string().as_bytes()==b"ApplicationRevision1",EBinding)
}
public fun application_operator<C>(r:&Catalog<C>):TypeName{r.application_operator}
public fun application_revision<C>(r:&Catalog<C>):TypeName{r.application_revision}
