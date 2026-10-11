#[test_only]
module soulidity_native::native_binding;
use std::type_name;
use soulidity_foundation::economics::{Self,Config,Admin,Authority};
public struct NativeInstaller1 has drop {}
public struct NativeRevision2 has drop {}
public struct Catalog<phantom C> has key,store {id:UID,config:ID}
public fun create_enabled_for_testing<C>(_authority:&Authority,primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):ID {
    let(mut c,mut a)=economics::new_config_for_testing<C>(primary,secondary,fixed,recipient,ctx);
    economics::bootstrap_application_for_testing<C,NativeInstaller1,NativeRevision2>(&mut c,&mut a,NativeInstaller1{},NativeRevision2{});
    let r=Catalog<C>{id:object::new(ctx),config:object::id(&c)};let h=std::hash::sha2_256(std::bcs::to_bytes(&r));let hash=economics::commitment(&c);
    let permit=economics::authorize_installation<C,NativeInstaller1,NativeRevision2,Catalog<C>>(&c,&mut a,0,hash,0,NativeInstaller1{},NativeRevision2{},&r,0,h);
    economics::install_native_initial_for_testing(&mut c,&mut a,permit,r,h);economics::enable_initial_for_testing(&mut c);economics::share_config_for_testing(c,a,ctx)
}
