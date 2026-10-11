/// Optional functional tool BELOW a freely owned standard Soul.
/// No shared custody root, cached owner, OwnerCap or loan of the Soul exists.
/// Funds/assets and encrypted private libraries have separate policy domains.
module soulidity_application::vault;
use soulidity_custody::lifecycle;
use std::bcs;
use std::hash;
use std::type_name::{Self,TypeName};
use sui::balance::{Self,Balance};
use sui::coin::{Self,Coin};
use sui::dynamic_field as df;
use sui::dynamic_object_field as dof;
use sui::table::{Self,Table};
use sui::event;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_content::loadout::{Self,Library,Head};
use walrus::blob::Blob;
use walrus::system::System;
use walrus::storage_resource::Storage;
const ERevision:u64=1;const ERoot:u64=2;const EAmount:u64=3;
const EAsset:u64=4;const EReplay:u64=5;const ECapacity:u64=6;
const SCHEMA:u16=1;
public struct ContentOperator has drop {}
public struct Vault has key,store {
    id:UID,root:ID,revision:u64,privacy_generation:u64,
    coins:vector<CoinSummary>,assets:vector<AssetSummary>,
    requests:Table<vector<u8>,Action>,private_library:ID,
}
public struct CoinSummary has copy,drop,store {coin:TypeName,balance:u64,deposited:u128,withdrawn:u128}
public struct AssetSummary has copy,drop,store {asset:ID,asset_type:TypeName}
public struct Action has copy,drop,store {root:ID,sequence:u64,kind:u8,asset_type:TypeName,amount:u64,asset:Option<ID>,actor:address}
public struct CoinKey<phantom T> has copy,drop,store {}
public struct AssetKey has copy,drop,store {asset:ID}
public struct PrivateKey has copy,drop,store {}
public struct Snapshot has copy,drop,store {root:ID,vault:ID,revision:u64,privacy_generation:u64,coins:vector<CoinSummary>,assets:vector<AssetSummary>,private_library:ID}
public struct Changed has copy,drop {root:ID,vault:ID,revision:u64,commitment:vector<u8>}
fun digest<T>(v:&T):vector<u8>{hash::sha3_256(bcs::to_bytes(v))}
public fun installed(s:&Soul):bool{standard::descriptor<ContentOperator>(s,b"vault").is_some()}
public fun tool(s:&Soul):&Vault{
    let v=standard::borrow_module<ContentOperator,Vault>(s,b"vault");assert!(v.root==object::id(s),ERoot);v
}
public fun root(v:&Vault):ID{v.root}
public fun revision(v:&Vault):u64{v.revision}
public fun privacy_generation(v:&Vault):u64{v.privacy_generation}
public fun snapshot(s:&Soul):Snapshot{let v=tool(s);Snapshot{root:v.root,vault:object::id(v),revision:v.revision,privacy_generation:v.privacy_generation,coins:v.coins,assets:v.assets,private_library:v.private_library}}
/// Stable, inspectable sale inventory. Copies convey data only, never authority.
public fun snapshot_root(s:&Snapshot):ID{s.root}
public fun snapshot_tool(s:&Snapshot):ID{s.vault}
public fun snapshot_revision(s:&Snapshot):u64{s.revision}
public fun snapshot_privacy_generation(s:&Snapshot):u64{s.privacy_generation}
public fun snapshot_coins(s:&Snapshot):&vector<CoinSummary>{&s.coins}
public fun snapshot_assets(s:&Snapshot):&vector<AssetSummary>{&s.assets}
public fun snapshot_private_library(s:&Snapshot):ID{s.private_library}
public fun summary_coin(c:&CoinSummary):TypeName{c.coin}
public fun summary_asset(a:&AssetSummary):ID{a.asset}
public fun summary_asset_type(a:&AssetSummary):TypeName{a.asset_type}
public fun action_root(a:&Action):ID{a.root}
public fun action_sequence(a:&Action):u64{a.sequence}
public fun action_kind(a:&Action):u8{a.kind}
public fun action_type(a:&Action):TypeName{a.asset_type}
public fun action_amount(a:&Action):u64{a.amount}
public fun action_asset(a:&Action):Option<ID>{a.asset}
public fun action_actor(a:&Action):address{a.actor}
public fun coin_balance<T>(s:&Soul):u64{let v=tool(s);let key=CoinKey<T>{};if(df::exists_with_type<CoinKey<T>,Balance<T>>(&v.id,key))balance::value<T>(df::borrow<CoinKey<T>,Balance<T>>(&v.id,key)) else 0}
public fun coin_summary<T>(s:&Soul):Option<CoinSummary>{let t=type_name::with_original_ids<T>();let mut out=option::none();tool(s).coins.do_ref!(|c|{if(c.coin==t)out=option::some(*c)});out}
public fun summary_balance(c:&CoinSummary):u64{c.balance}
public fun deposited(c:&CoinSummary):u128{c.deposited}
public fun withdrawn(c:&CoinSummary):u128{c.withdrawn}
public fun has_asset<T:key+store>(s:&Soul,id:ID):bool{dof::exists_with_type<AssetKey,T>(&tool(s).id,AssetKey{asset:id})}
public fun asset<T:key+store>(s:&Soul,id:ID):&T{dof::borrow(&tool(s).id,AssetKey{asset:id})}
public fun action(s:&Soul,request:vector<u8>):Option<Action>{let v=tool(s);if(v.requests.contains(request))option::some(*v.requests.borrow(request)) else option::none()}
/// Installation is optional, but the installed accounting/receipt carrier is
/// permanent. Real funds/assets can always be withdrawn by actual Soul custody.
public fun install(s:&mut Soul,expected_root:u64,ctx:&mut TxContext):ID{
    assert!(standard::revision(s)==expected_root,ERevision);
    let mut v=Vault{id:object::new(ctx),root:object::id(s),revision:0,privacy_generation:0,coins:vector[],assets:vector[],requests:table::new(ctx),private_library:object::id_from_address(@0x0)};
    let library=loadout::new(ContentOperator{},&v,s,ctx);v.private_library=object::id(&library);dof::add(&mut v.id,PrivateKey{},library);
    let id=object::id(&v);let h=digest(&v);lifecycle::install_protected(s,ContentOperator{},b"vault",v,SCHEMA,false,h,expected_root);id
}
fun open(s:&mut Soul,expected_tool:u64,expected_root:u64):(Vault,standard::Edit<ContentOperator,Vault>){
    assert!(standard::revision(s)==expected_root && tool(s).revision==expected_tool,ERevision);
    standard::begin_update(s,ContentOperator{},b"vault",expected_root)
}
fun close(s:&mut Soul,ticket:standard::Edit<ContentOperator,Vault>,mut v:Vault){
    assert!(v.root==object::id(s),ERoot);v.revision=v.revision+1;
    // Includes exact balances, typed asset IDs and monotonically changing
    // private generation/revision; no uncommitted child update is certified.
    assert!(bcs::to_bytes(&v).length()<=196608,ECapacity);let h=digest(&v);
    event::emit(Changed{root:v.root,vault:object::id(&v),revision:v.revision,commitment:h});
    standard::commit_update(s,ticket,ContentOperator{},v,SCHEMA,h)
}
fun remember(v:&mut Vault,request:vector<u8>,kind:u8,t:TypeName,amount:u64,asset:Option<ID>,ctx:&TxContext){
    assert!(request.length()==32,EReplay);assert!(!v.requests.contains(request),EReplay);
    v.requests.add(request,Action{root:v.root,sequence:v.revision+1,kind,asset_type:t,amount,asset,actor:ctx.sender()})
}
fun coin_index<T>(v:&Vault):u64{let t=type_name::with_original_ids<T>();let mut i=0;while(i < v.coins.length()){if(v.coins[i].coin==t)return i;i=i+1};abort EAsset}
/// No Grant/AgentPass value is accepted here. Future spend delegation must bind
/// root, coin/asset, amount/budget, recipient, expiry and replay state separately.
public fun deposit_coin<T>(s:&mut Soul,payment:Coin<T>,request:vector<u8>,expected_tool:u64,expected_root:u64,ctx:&TxContext){
    let(mut v,ticket)=open(s,expected_tool,expected_root);let amount=coin::value(&payment);assert!(amount>0,EAmount);
    remember(&mut v,request,0,type_name::with_original_ids<T>(),amount,option::none(),ctx);
    let key=CoinKey<T>{};
    if(!df::exists_with_type<CoinKey<T>,Balance<T>>(&v.id,key)){
        assert!(v.coins.length()<64,ECapacity);df::add(&mut v.id,key,balance::zero<T>());
        v.coins.push_back(CoinSummary{coin:type_name::with_original_ids<T>(),balance:0,deposited:0,withdrawn:0})
    };
    let i=coin_index<T>(&v);let expected=v.coins[i].balance;let bal:&mut Balance<T> =df::borrow_mut(&mut v.id,key);assert!(balance::value(bal)==expected,EAmount);
    bal.join(coin::into_balance(payment));let current=balance::value(bal);let c=&mut v.coins[i];c.balance=current;c.deposited=c.deposited+(amount as u128);close(s,ticket,v)
}
public fun withdraw_coin<T>(s:&mut Soul,amount:u64,request:vector<u8>,expected_tool:u64,expected_root:u64,ctx:&mut TxContext):Coin<T>{
    let(mut v,ticket)=open(s,expected_tool,expected_root);assert!(amount>0,EAmount);
    remember(&mut v,request,1,type_name::with_original_ids<T>(),amount,option::none(),ctx);
    let i=coin_index<T>(&v);let expected=v.coins[i].balance;let bal:&mut Balance<T> =df::borrow_mut(&mut v.id,CoinKey<T>{});
    assert!(balance::value(bal)==expected && amount<=balance::value(bal),EAmount);
    let out=coin::from_balance(bal.split(amount),ctx);let current=balance::value(bal);let c=&mut v.coins[i];c.balance=current;c.withdrawn=c.withdrawn+(amount as u128);close(s,ticket,v);out
}
public fun deposit_asset<T:key+store>(s:&mut Soul,a:T,request:vector<u8>,expected_tool:u64,expected_root:u64,ctx:&TxContext){
    let(mut v,ticket)=open(s,expected_tool,expected_root);let id=object::id(&a);
    assert!(id!=v.root && id!=object::id(&v) && v.assets.length()<512,EAsset);
    remember(&mut v,request,2,type_name::with_original_ids<T>(),0,option::some(id),ctx);
    dof::add(&mut v.id,AssetKey{asset:id},a);v.assets.push_back(AssetSummary{asset:id,asset_type:type_name::with_original_ids<T>()});close(s,ticket,v)
}
public fun withdraw_asset<T:key+store>(s:&mut Soul,id:ID,request:vector<u8>,expected_tool:u64,expected_root:u64,ctx:&TxContext):T{
    let(mut v,ticket)=open(s,expected_tool,expected_root);
    remember(&mut v,request,3,type_name::with_original_ids<T>(),0,option::some(id),ctx);
    let mut i=0;while(i < v.assets.length() && v.assets[i].asset!=id){i=i+1};
    assert!(i < v.assets.length() && v.assets[i].asset_type==type_name::with_original_ids<T>(),EAsset);
    let a:T=dof::remove(&mut v.id,AssetKey{asset:id});assert!(object::id(&a)==id,EAsset);v.assets.remove(i);close(s,ticket,v);a
}
fun library(v:&Vault):&Library{let l=dof::borrow(&v.id,PrivateKey{});assert!(object::id(l)==v.private_library && loadout::root(l)==v.root,ERoot);l}
fun library_mut(v:&mut Vault):&mut Library{let l=dof::borrow_mut(&mut v.id,PrivateKey{});assert!(object::id(l)==v.private_library && loadout::root(l)==v.root,ERoot);l}
/// Encrypted libraries reuse the existing certified Blob/receipt implementation.
/// Owner-specific namespace recovery follows the existing private-library model;
/// a free transfer has no global revocation hook, and explicit handover rotates it.
public fun private_head(s:&Soul,owner:address):Option<Head>{let v=tool(s);loadout::head(library(v),owner,v.privacy_generation)}
public fun private_receipt(s:&Soul,receipt_owner:address,receipt_generation:u64,request:vector<u8>):Option<loadout::Receipt>{loadout::receipt(library(tool(s)),receipt_owner,receipt_generation,request)}
public fun private_seal_id(s:&Soul,owner:address):vector<u8>{let v=tool(s);loadout::seal_id(library(v),owner,v.privacy_generation)}
public fun save_private(s:&mut Soul,blob:Blob,system:&System,sha256:vector<u8>,request:vector<u8>,expected_library:u64,expected_tool:u64,expected_root:u64,ctx:&TxContext):u64{
    let(mut v,ticket)=open(s,expected_tool,expected_root);let generation=v.privacy_generation;
    let index=loadout::commit(ContentOperator{},library_mut(&mut v),ctx.sender(),generation,expected_library,request,blob,system,sha256,option::none());close(s,ticket,v);index
}
/// A mutable actual Soul is mandatory; no address, copied Grant or tool snapshot
/// is accepted as a standalone owner proof or as authority to withdraw funds.
public fun seal_approve_private_owner(id:vector<u8>,s:&mut Soul,system:&System,ctx:&TxContext){
    let v=tool(s);let l=library(v);let h=loadout::head(l,ctx.sender(),v.privacy_generation).destroy_some();
    loadout::assert_available(l,&loadout::head_receipt(&h),system);
    loadout::approve(ContentOperator{},id,l,ctx.sender(),v.privacy_generation)
}
public fun extend_private(s:&mut Soul,receipt_owner:address,receipt_generation:u64,request:vector<u8>,extension:Storage,system:&System,expected_tool:u64,expected_root:u64){
    let(mut v,ticket)=open(s,expected_tool,expected_root);loadout::extend(ContentOperator{},library_mut(&mut v),receipt_owner,receipt_generation,request,extension,system);close(s,ticket,v)
}
public fun purge_private(s:&mut Soul,receipt_owner:address,receipt_generation:u64,request:vector<u8>,expected_tool:u64,expected_root:u64,ctx:&TxContext){
    let(mut v,ticket)=open(s,expected_tool,expected_root);let generation=v.privacy_generation;
    loadout::purge(ContentOperator{},library_mut(&mut v),ctx.sender(),generation,receipt_owner,receipt_generation,request);close(s,ticket,v)
}
public fun rotate_private_scope(s:&mut Soul,expected_tool:u64,expected_root:u64){let(mut v,ticket)=open(s,expected_tool,expected_root);v.privacy_generation=v.privacy_generation+1;close(s,ticket,v)}
/// Supported handovers revoke every known Vault in the native nested Soul tree.
/// Unknown extension protocols retain their own authorization rules.
/// Bounded work rejects excessive nesting before handover; owner can unnest.
/// Revoke private scope without moving
/// it outside Soul, erasing its receipts or touching its balances/assets.
public fun prepare_handover(s:&mut Soul){let _=prepare_tree_handover(s,0,256);}
fun prepare_tree_handover(s:&mut Soul,depth:u64,budget:u64):u64{
    assert!(depth<=16 && budget>0,ECapacity);let mut used=1;
    if(installed(s)){let t=tool(s).revision;let r=standard::revision(s);rotate_private_scope(s,t,r)};
    let children=standard::module_page(s,0,64);
    children.do_ref!(|d|{
        if(standard::namespace(d)==type_name::with_defining_ids<standard::NestedSoulWitness>()){
            assert!(used < budget,ECapacity);let r=standard::revision(s);
            let(mut child,ticket)=standard::begin_nested_update(s,standard::module_id(d),r);
            used=used+prepare_tree_handover(&mut child,depth+1,budget-used);
            standard::commit_nested_update(s,ticket,child)
        }
    });used
}

/// Preserves all original funds/assets/permanent receipts and rotates every
/// installed native-tree Vault before private-witness acknowledgment.
public fun acknowledge_handover(h:&mut lifecycle::Handover) {
    prepare_handover_creation(lifecycle::handover_mut(h));
    lifecycle::acknowledge_handover<ContentOperator,Vault>(h,ContentOperator{},b"vault",SCHEMA)
}


fun open_creation(s:&mut standard::Creation,expected_tool:u64,expected_root:u64):(Vault,standard::Edit<ContentOperator,Vault>){
    assert!(standard::revision(standard::creation_ref(s))==expected_root && tool(standard::creation_ref(s)).revision==expected_tool,ERevision);
    standard::creation_begin_update(s,ContentOperator{},b"vault",expected_root)
}

fun close_creation(s:&mut standard::Creation,ticket:standard::Edit<ContentOperator,Vault>,mut v:Vault){
    assert!(v.root==object::id(standard::creation_ref(s)),ERoot);v.revision=v.revision+1;
    // Includes exact balances, typed asset IDs and monotonically changing
    // private generation/revision; no uncommitted child update is certified.
    assert!(bcs::to_bytes(&v).length()<=196608,ECapacity);let h=digest(&v);
    event::emit(Changed{root:v.root,vault:object::id(&v),revision:v.revision,commitment:h});
    standard::creation_commit_update(s,ticket,ContentOperator{},v,SCHEMA,h)
}

public fun rotate_private_scope_creation(s:&mut standard::Creation,expected_tool:u64,expected_root:u64){let(mut v,ticket)=open_creation(s,expected_tool,expected_root);v.privacy_generation=v.privacy_generation+1;close_creation(s,ticket,v)}

public fun prepare_handover_creation(s:&mut standard::Creation){let _=prepare_tree_handover_creation(s,0,256);}

fun prepare_tree_handover_creation(s:&mut standard::Creation,depth:u64,budget:u64):u64{
    assert!(depth<=16 && budget>0,ECapacity);let mut used=1;
    if(installed(standard::creation_ref(s))){let t=tool(standard::creation_ref(s)).revision;let r=standard::revision(standard::creation_ref(s));rotate_private_scope_creation(s,t,r)};
    let children=standard::module_page(standard::creation_ref(s),0,64);
    children.do_ref!(|d|{
        if(standard::namespace(d)==type_name::with_defining_ids<standard::NestedSoulWitness>()){
            assert!(used < budget,ECapacity);let r=standard::revision(standard::creation_ref(s));
            let(mut child,ticket)=standard::creation_begin_nested_update(s,standard::module_id(d),r);
            used=used+prepare_tree_handover_creation(&mut child,depth+1,budget-used);
            standard::creation_commit_nested_update(s,ticket,child)
        }
    });used
}
