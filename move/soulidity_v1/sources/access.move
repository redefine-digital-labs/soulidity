/// OPTIONAL native Kiosk access extension, distinct from Soul's Vault tool.
/// Roots remain real DOF objects in Sui ObjectBag. The existing private Account
/// keeps the native KioskOwnerCap; no new owner cap or shared Vault is issued.
module soulidity_v1::access;
use std::string::String;
use sui::kiosk::{Self,Kiosk};
use sui::kiosk_extension as ext;
use sui::bag;
use sui::object_bag::{Self,ObjectBag};
use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;
use soulidity_standard::soul::Soul;
use soulidity_application::character::{Self as soul,Manifest};
use soulidity_content_kinds::content_kind_registry::{Self as kind_registry,KindRegistry};
use soulidity_content::paid_access::{Self,Entry,Offer,Receipt};
use soulidity_foundation::economics::Config;
use soulidity_custody::account::{Self as custody,Account};
use soulidity_v1::application_operator as op;
use soulidity_v1::native_binding;
use soulidity_application::vault;
use walrus::blob::Blob;
use walrus::system::System;
const EBinding:u64=1;const ERevision:u64=2;const EDisabled:u64=3;const ECapacity:u64=4;
public struct AccessExtension has drop {}
public struct InventoryKey has copy,drop,store {}
public struct RootKey has copy,drop,store {root:ID}
public struct Inventory has store {account:ID,kiosk:ID,owner:address,protocol:ID,revision:u64,roots:ObjectBag,ids:vector<ID>}
public struct Changed has copy,drop {kiosk:ID,root:ID,revision:u64,operation:u8}
fun record(k:&Kiosk):&Inventory{
    let v:&Inventory=bag::borrow(ext::storage(AccessExtension{},k),InventoryKey{});
    assert!(v.kiosk==object::id(k) && v.owner==kiosk::owner(k),EBinding);v
}
fun record_mut(k:&mut Kiosk):&mut Inventory{
    let _=record(k);bag::borrow_mut(ext::storage_mut(AccessExtension{},k),InventoryKey{})
}
fun active(k:&Kiosk){assert!(ext::is_enabled<AccessExtension>(k),EDisabled);let _=record(k);}
fun owner(k:&mut Kiosk,a:&mut Account,ctx:&TxContext){
    custody::assert_access(k,a,ctx);assert!(record(k).account==object::id(a),EBinding)
}
fun root(k:&Kiosk,id:ID):&Soul{let s:&Soul=object_bag::borrow(&record(k).roots,RootKey{root:id});assert!(object::id(s)==id,EBinding);s}
fun root_mut(k:&mut Kiosk,id:ID,expected:u64,expected_soul:u64):&mut Soul{
    active(k);assert!(record(k).revision==expected,ERevision);
    let s:&mut Soul=object_bag::borrow_mut(&mut record_mut(k).roots,RootKey{root:id});assert!(object::id(s)==id,EBinding);soul::assert_revision(s,expected_soul);s
}
fun owner_root(k:&mut Kiosk,a:&mut Account,id:ID,expected:u64,expected_soul:u64,ctx:&TxContext):&mut Soul{owner(k,a,ctx);root_mut(k,id,expected,expected_soul)}
fun changed(k:&mut Kiosk,id:ID,operation:u8){let v=record_mut(k);v.revision=v.revision+1;event::emit(Changed{kiosk:v.kiosk,root:id,revision:v.revision,operation})}
public fun installed(k:&Kiosk):bool{ext::is_installed<AccessExtension>(k)}
public fun revision(k:&Kiosk):u64{record(k).revision}
public fun root_count(k:&Kiosk):u64{record(k).ids.length()}
public fun root_ids(k:&Kiosk):vector<ID>{record(k).ids}
public fun root_present(k:&Kiosk,id:ID):bool{object_bag::contains_with_type<RootKey,Soul>(&record(k).roots,RootKey{root:id})}
public fun soul_revision(k:&Kiosk,id:ID):u64{soul::revision(root(k,id))}
public fun manifest(k:&Kiosk,id:ID):Manifest{soul::manifest(root(k,id))}
/// The extension requests zero place/lock permissions; native owner may disable
/// access without losing the right to recover every actual stored Soul.
public fun install<C>(k:&mut Kiosk,a:&mut Account,cfg:&Config<C>,ctx:&mut TxContext){
    custody::assert_access(k,a,ctx);native_binding::assert_current(cfg);
    custody::add_extension(AccessExtension{},k,a,ctx);
    let v=Inventory{account:object::id(a),kiosk:object::id(k),owner:ctx.sender(),protocol:object::id(cfg),revision:0,roots:object_bag::new(ctx),ids:vector[]};
    bag::add(ext::storage_mut(AccessExtension{},k),InventoryKey{},v)
}
public fun disable(k:&mut Kiosk,a:&mut Account,ctx:&TxContext){owner(k,a,ctx);custody::disable_extension(AccessExtension{},k,a,ctx)}
public fun enable(k:&mut Kiosk,a:&mut Account,ctx:&TxContext){owner(k,a,ctx);custody::enable_extension(AccessExtension{},k,a,ctx)}
public fun uninstall_empty(k:&mut Kiosk,a:&mut Account,ctx:&TxContext){
    owner(k,a,ctx);let v:Inventory=bag::remove(ext::storage_mut(AccessExtension{},k),InventoryKey{});
    let Inventory{roots,account:_,kiosk:_,owner:_,protocol:_,revision:_,ids:_}=v;object_bag::destroy_empty(roots);custody::remove_extension(AccessExtension{},k,a,ctx)
}
public fun deposit<C>(k:&mut Kiosk,a:&mut Account,mut s:Soul,cfg:&Config<C>,expected:u64,expected_soul:u64,ctx:&TxContext){
    owner(k,a,ctx);active(k);assert!(record(k).revision==expected,ERevision);
    assert!(record(k).protocol==object::id(cfg) && soul::protocol(&s)==object::id(cfg),EBinding);soul::assert_revision(&s,expected_soul);
    assert!(record(k).ids.length()<256,ECapacity);let id=object::id(&s);
    soul::clear_authorizations(&mut s);vault::prepare_handover(&mut s);
    let v=record_mut(k);object_bag::add(&mut v.roots,RootKey{root:id},s);v.ids.push_back(id);changed(k,id,0)
}
/// Withdrawal is independent of extension enablement and protocol pause.
public fun withdraw(k:&mut Kiosk,a:&mut Account,id:ID,expected:u64,expected_soul:u64,ctx:&TxContext){
    owner(k,a,ctx);assert!(record(k).revision==expected,ERevision);soul::assert_revision(root(k,id),expected_soul);
    let mut s:Soul=object_bag::remove(&mut record_mut(k).roots,RootKey{root:id});
    let v=record_mut(k);let mut i=0;while(v.ids[i]!=id){i=i+1};v.ids.remove(i);
    soul::clear_authorizations(&mut s);vault::prepare_handover(&mut s);changed(k,id,1);transfer::public_transfer(s,ctx.sender())
}
public fun grant(k:&mut Kiosk,a:&mut Account,id:ID,grantee:address,scope:u64,expiry:Option<u64>,expected:u64,expected_soul:u64,previous:Option<vector<u8>>,clock:&Clock,ctx:&TxContext){
    soul::grant(owner_root(k,a,id,expected,expected_soul,ctx),grantee,scope,expiry,expected_soul,previous,clock,ctx);changed(k,id,2)
}
public fun revoke(k:&mut Kiosk,a:&mut Account,id:ID,grantee:address,expected:u64,expected_soul:u64,previous:vector<u8>,ctx:&TxContext){
    soul::revoke(owner_root(k,a,id,expected,expected_soul,ctx),grantee,expected_soul,previous);changed(k,id,3)
}
public fun configure_paid(k:&mut Kiosk,a:&mut Account,id:ID,r:&KindRegistry,kind:u32,price:u64,scope:u64,duration:Option<u64>,expected_ledger:u64,expected:u64,expected_soul:u64,ctx:&TxContext){
    soul::configure_paid(owner_root(k,a,id,expected,expected_soul,ctx),r,kind,price,scope,duration,expected_ledger,expected_soul,ctx);changed(k,id,4)
}
public fun remove_paid_offer(k:&mut Kiosk,a:&mut Account,id:ID,kind:u32,expected_ledger:u64,expected:u64,expected_soul:u64,ctx:&TxContext){
    soul::remove_paid_offer(owner_root(k,a,id,expected,expected_soul,ctx),kind,expected_ledger,expected_soul);changed(k,id,5)
}
public fun add_paid_access(k:&mut Kiosk,a:&mut Account,id:ID,r:&KindRegistry,kind:u32,buyer:address,scope:u64,expiry:Option<u64>,expected_ledger:u64,previous:Option<vector<u8>>,expected:u64,expected_soul:u64,clock:&Clock,ctx:&TxContext){
    soul::add_paid_access(owner_root(k,a,id,expected,expected_soul,ctx),r,kind,buyer,scope,expiry,expected_ledger,previous,expected_soul,clock,ctx);changed(k,id,6)
}
public fun revoke_paid_access(k:&mut Kiosk,a:&mut Account,id:ID,kind:u32,buyer:address,expected_ledger:u64,previous:vector<u8>,expected:u64,expected_soul:u64,ctx:&TxContext){
    soul::revoke_paid_access(owner_root(k,a,id,expected,expected_soul,ctx),kind,buyer,expected_ledger,previous,expected_soul);changed(k,id,7)
}
public fun cleanup_paid_access(k:&mut Kiosk,a:&mut Account,id:ID,kind:u32,buyer:address,expected_ledger:u64,expected:u64,expected_soul:u64,clock:&Clock,ctx:&TxContext){
    soul::cleanup_paid_access(owner_root(k,a,id,expected,expected_soul,ctx),kind,buyer,expected_ledger,expected_soul,clock,ctx);changed(k,id,8)
}
public fun paid_quote(k:&Kiosk,id:ID,kind:u32):vector<u8>{paid_access::quote(soul::paid_access(root(k,id)),kind)}
public fun paid_total<C>(k:&Kiosk,id:ID,cfg:&Config<C>,kind:u32):u64{paid_access::total(soul::paid_access(root(k,id)),cfg,kind)}
public fun paid_offer(k:&Kiosk,id:ID,kind:u32):Option<Offer>{paid_access::offer(soul::paid_access(root(k,id)),kind)}
public fun paid_entry(k:&Kiosk,id:ID,kind:u32,buyer:address):Option<Entry>{paid_access::entry(soul::paid_access(root(k,id)),kind,buyer)}
public fun paid_entry_hash(k:&Kiosk,id:ID,kind:u32,buyer:address):Option<vector<u8>>{paid_access::entry_hash(soul::paid_access(root(k,id)),kind,buyer)}
public fun paid_receipt(k:&Kiosk,id:ID,buyer:address,attempt:vector<u8>):Option<Receipt>{paid_access::receipt(soul::paid_access(root(k,id)),buyer,attempt)}
public fun buy_paid<C>(k:&mut Kiosk,id:ID,cfg:&mut Config<C>,kind:u32,expected:u64,expected_soul:u64,quote:vector<u8>,previous:Option<vector<u8>>,fee_revision:u64,expiry:u64,attempt:vector<u8>,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext){
    assert!(record(k).protocol==object::id(cfg),EBinding);let owner=record(k).owner;
    soul::buy_paid(op::operator(),root_mut(k,id,expected,expected_soul),cfg,kind,owner,expected_soul,quote,previous,fee_revision,expiry,attempt,payment,clock,ctx);changed(k,id,9)
}
public fun seal_approve_paid(id:vector<u8>,k:&Kiosk,root_id:ID,index:u64,system:&System,clock:&Clock,ctx:&TxContext){
    active(k);soul::assert_paid_read(op::operator(),id,root(k,root_id),index,record(k).owner,system,clock,ctx)
}
public fun seal_approve_owner(id:vector<u8>,k:&mut Kiosk,a:&mut Account,root_id:ID,index:u64,system:&System,ctx:&TxContext){
    owner(k,a,ctx);let s:&mut Soul=object_bag::borrow_mut(&mut record_mut(k).roots,RootKey{root:root_id});soul::seal_approve_owner(id,s,index,system,ctx)
}
public fun seal_approve_delegate(id:vector<u8>,k:&Kiosk,root_id:ID,index:u64,system:&System,clock:&Clock,ctx:&TxContext){
    active(k);let s=root(k,root_id);soul::assert_delegate(op::operator(),s,record(k).owner,ctx.sender(),soul::content_scope(s,index),clock);
    soul::assert_content_read(op::operator(),id,s,index,system,kind_registry::read_grant())
}
public fun seal_approve_original_output_delegate(id:vector<u8>,k:&Kiosk,root_id:ID,system:&System,clock:&Clock,ctx:&TxContext){
    active(k);let s=root(k,root_id);soul::assert_delegate(op::operator(),s,record(k).owner,ctx.sender(),soul::scope_assets(),clock);soul::assert_original_output_read(op::operator(),id,s,system)
}
public fun append_content_as_delegate(k:&mut Kiosk,root_id:ID,r:&KindRegistry,kind:u32,name:String,read_mask:u64,download_policy:u8,blob:Blob,system:&System,sha256:vector<u8>,nonce:vector<u8>,envelope:vector<u8>,expected_version:u64,expected:u64,expected_soul:u64,attempt:vector<u8>,clock:&Clock,ctx:&TxContext):u64{
    active(k);let scope=kind_registry::descriptor_default_grant_scope_mask(kind_registry::borrow_descriptor(r,kind));
    soul::assert_delegate(op::operator(),root(k,root_id),record(k).owner,ctx.sender(),scope,clock);
    let index=soul::append_content(root_mut(k,root_id,expected,expected_soul),r,kind,name,read_mask,download_policy,blob,system,sha256,nonce,envelope,expected_version,expected_soul,attempt,clock);changed(k,root_id,10);index
}
public fun delete_content_as_delegate(k:&mut Kiosk,root_id:ID,index:u64,expected:u64,expected_soul:u64,clock:&Clock,ctx:&TxContext){
    active(k);let s=root(k,root_id);soul::assert_delegate(op::operator(),s,record(k).owner,ctx.sender(),soul::content_scope(s,index),clock);
    soul::delete_content(root_mut(k,root_id,expected,expected_soul),index,expected_soul);changed(k,root_id,11)
}
