/// Certified personal Kiosk. Its native owner cap never leaves this wallet capability.
module soulidity_custody::account;
use soulidity_custody::lifecycle;
use soulidity_standard::native_authority::{Self as sealed,Authority};
use sui::kiosk::{Self,Kiosk,KioskOwnerCap};
use sui::coin::Coin;
use sui::sui::SUI;
use soulidity_standard::soul::{Self,Soul};
use soulidity_custody::lifecycle::{Construction};
use soulidity_origin_protocol::producer_origin::CompletionAuthorization;
use soulidity_foundation::economics::Config;
const EOwner:u64=1;const EBinding:u64=2;
public struct Account has key {id:UID,kiosk:ID,owner:address,authority:Authority}
/// Return owned values so the first purchase can use its new account in the
/// same PTB. Account has no store/drop and never exposes the native owner cap.
public fun new(ctx:&mut TxContext):(Kiosk,Account) {
    let(mut k,cap)=kiosk::new(ctx);let id=object::id(&k);
    let authority=sealed::seal(&mut k,cap,ctx);
    (k,Account{id:object::new(ctx),kiosk:id,owner:ctx.sender(),authority})
}
/// Import a genuine raw native cap once, preserving its exact ID and rights
/// through a sealed Account. No terminal ever returns the raw cap.
public fun from_native_cap(k:&mut Kiosk,cap:KioskOwnerCap,ctx:&mut TxContext):Account {
    let authority=sealed::seal(k,cap,ctx);
    Account{id:object::new(ctx),kiosk:object::id(k),owner:ctx.sender(),authority}
}
/// Persist the exact pair only after its operations succeed. Its owner is
/// fixed by new(); this cannot transfer an account to an arbitrary recipient.
public fun finalize(mut k:Kiosk,mut a:Account,ctx:&TxContext):ID {
    assert_access(&mut k,&mut a,ctx);let id=object::id(&k);
    transfer::public_share_object(k);transfer::transfer(a,ctx.sender());id
}
public fun create(ctx:&mut TxContext):ID {let(k,a)=new(ctx);finalize(k,a,ctx)}
public fun owner(a:&Account):address{a.owner}
public fun kiosk_id(a:&Account):ID{a.kiosk}
public fun assert_access(k:&mut Kiosk,a:&mut Account,ctx:&TxContext) {
    assert_pair(k,a,ctx)
}
fun assert_pair_inner(k:&mut Kiosk,a:&Account,ctx:&TxContext) {
    assert!(a.owner==ctx.sender(),EOwner);assert!(a.kiosk==object::id(k) && kiosk::owner(k)==a.owner,EBinding);sealed::assert_pair(k,&a.authority,ctx)
}
public fun cap_id(a:&Account):ID{sealed::cap_id(&a.authority)}
public fun assert_pair(k:&mut Kiosk,a:&Account,ctx:&TxContext) { assert_pair_inner(k,a,ctx) }
public fun withdraw_profits(k:&mut Kiosk,a:&mut Account,amount:Option<u64>,ctx:&mut TxContext) {
    assert_access(k,a,ctx);let profits:Coin<SUI> = sealed::withdraw(k,&a.authority,amount,ctx);transfer::public_transfer(profits,ctx.sender())
}
/// A concrete role-authenticated consumer. Witness values cannot be packed by clients.
/// This checks identity only: Collection.create retains its original Primary-live gate.
fun assert_collection<C,W:drop,R:drop,T>(cfg:&Config<C>,_w:W,_r:R) {
    soulidity_foundation::economics::assert_role_types<C,W,R>(cfg,4);
    let actual=std::type_name::with_original_ids<T>();
    let authority=std::type_name::with_original_ids<W>();
    let defining=std::type_name::with_defining_ids<T>();
    let defining_authority=std::type_name::with_defining_ids<W>();
    assert!(!actual.is_primitive() && actual.address_string()==authority.address_string()
        && actual.module_string()==authority.module_string()
        && *actual.datatype_string().as_bytes()==b"Right"
        && defining.address_string()==defining_authority.address_string()
        && defining.module_string()==defining_authority.module_string(),EBinding)
}
public fun lock_right<C,W:drop,R:drop,T:key+store>(cfg:&Config<C>,w:W,r:R,k:&mut Kiosk,a:&Account,p:&sui::transfer_policy::TransferPolicy<T>,value:T,ctx:&TxContext) {
    assert_collection<C,W,R,T>(cfg,w,r);assert_pair(k,a,ctx);sealed::lock(k,&a.authority,p,value,ctx)
}
public fun borrow_right<C,W:drop,R:drop,T:key+store>(cfg:&Config<C>,w:W,r:R,k:&mut Kiosk,a:&Account,id:ID,ctx:&TxContext):&T {
    assert_collection<C,W,R,T>(cfg,w,r);assert_pair(k,a,ctx);sealed::borrow<T>(k,&a.authority,id,ctx)
}
public fun list_right<C,W:drop,R:drop,T:key+store>(cfg:&Config<C>,w:W,r:R,k:&mut Kiosk,a:&Account,id:ID,ctx:&mut TxContext):sui::kiosk::PurchaseCap<T> {
    assert_collection<C,W,R,T>(cfg,w,r);assert_pair(k,a,ctx);sealed::list_exclusively<T>(k,&a.authority,id,ctx)
}
public fun borrow_for_collection<C,W:drop,R:drop,T:key+store>(cfg:&Config<C>,_w:W,_r:R,k:&mut Kiosk,a:&Account,id:ID,ctx:&TxContext):&mut T {
    soulidity_foundation::economics::assert_role_types<C,W,R>(cfg,4);assert!(std::type_name::with_original_ids<T>()==std::type_name::with_original_ids<Soul>() && std::type_name::with_defining_ids<T>()==std::type_name::with_defining_ids<Soul>(),EBinding);assert_pair(k,a,ctx);sealed::borrow_mut<T>(k,&a.authority,id,ctx)
}
/// Real X values scope each operation to X's namespace. All installations request
/// zero permissions; these helpers expose neither Soul storage nor native caps.
public fun add_extension<X:drop>(x:X,k:&mut Kiosk,a:&Account,ctx:&mut TxContext) {
    assert_pair(k,a,ctx);sealed::add_extension(x,k,&a.authority,ctx)
}
public fun disable_extension<X:drop>(_x:X,k:&mut Kiosk,a:&Account,ctx:&TxContext) {
    assert_pair(k,a,ctx);sealed::disable_extension<X>(k,&a.authority,ctx)
}
public fun enable_extension<X:drop>(_x:X,k:&mut Kiosk,a:&Account,ctx:&TxContext) {
    assert_pair(k,a,ctx);sealed::enable_extension<X>(k,&a.authority,ctx)
}
public fun remove_extension<X:drop>(_x:X,k:&mut Kiosk,a:&Account,ctx:&TxContext) {
    assert_pair(k,a,ctx);sealed::remove_extension<X>(k,&a.authority,ctx)
}
#[test_only]
public fun has_access_for_testing(k:&mut Kiosk,a:&Account):bool{sealed::has_access_for_testing(k,&a.authority)}
#[test_only]
public fun borrow_for_testing<T:key+store>(k:&mut Kiosk,a:&Account,id:ID,ctx:&TxContext):&T {
    assert_pair(k,a,ctx);sealed::borrow<T>(k,&a.authority,id,ctx)
}
#[test_only]
public fun attempt_take_right_for_testing<T:key+store>(k:&mut Kiosk,a:&Account,id:ID,recipient:address,ctx:&TxContext) {
    let n=std::type_name::with_original_ids<T>();assert!(!n.is_primitive() && *n.module_string().as_bytes()==b"collection" && *n.datatype_string().as_bytes()==b"Right",EBinding);
    assert_pair(k,a,ctx);let right=sealed::take<T>(k,&a.authority,id,ctx);transfer::public_transfer(right,recipient)
}
#[test_only]
public fun list_for_testing<T:key+store>(k:&mut Kiosk,a:&Account,id:ID,price:u64,ctx:&TxContext) {
    assert_pair(k,a,ctx);sealed::list<T>(k,&a.authority,id,price,ctx)
}
#[test_only]
public fun list_exclusively_for_testing<T:key+store>(k:&mut Kiosk,a:&Account,id:ID,ctx:&mut TxContext):sui::kiosk::PurchaseCap<T> {
    assert_pair(k,a,ctx);sealed::list_exclusively<T>(k,&a.authority,id,ctx)
}

/// Canonical terminal consumes the sealed Account in its private cap scope.
public fun deliver_locked_account(c:Construction,completion:CompletionAuthorization,k:&mut Kiosk,mut a:Account,p:&sui::transfer_policy::TransferPolicy<Soul>,ctx:&TxContext):ID {
    assert_pair(k,&a,ctx);let id=lifecycle::deliver_locked_authority(c,completion,k,&mut a.authority,p,ctx);
    let owner=a.owner;transfer::transfer(a,owner);id
}
public fun deliver_locked_fresh_account(c:Construction,completion:CompletionAuthorization,mut k:Kiosk,a:Account,p:&sui::transfer_policy::TransferPolicy<Soul>,ctx:&TxContext):ID {
    let id=deliver_locked_account(c,completion,&mut k,a,p,ctx);transfer::public_share_object(k);id
}
/// Compatibility delegate to the one canonical pinned-layout guard.
public fun assert_legacy_disabled(k:&Kiosk) { lifecycle::assert_legacy_disabled(k) }

/// Ingress carries existing non-Soul source objects only. The genuine source
/// witness/object must match; this grants no take, borrow or cap access.
public fun place_source<W:drop,P:key,T:key+store>(_w:W,_source:&P,k:&mut Kiosk,a:&Account,value:T,ctx:&TxContext) {
    let w=std::type_name::with_original_ids<W>();let p=std::type_name::with_original_ids<P>();let t=std::type_name::with_original_ids<T>();
    assert!(!w.is_primitive() && !p.is_primitive() && w.address_string()==p.address_string() && w.module_string()==p.module_string(),EBinding);
    assert!(t.module_string()!=std::ascii::string(b"soul") || t.datatype_string()!=std::ascii::string(b"Soul"),EBinding);
    assert_pair(k,a,ctx);sealed::place(k,&a.authority,value,ctx)
}

// The binding is custody authority, independent from mutable module revisions,
// body hashes and schema. The defining source validates each supported schema.
public struct IngressKey has copy, drop, store { root: ID }
public struct IngressBinding has copy, drop, store {
    root: ID, witness_original: std::type_name::TypeName,
    witness_defining: std::type_name::TypeName,
    value_original: std::type_name::TypeName, value_defining: std::type_name::TypeName,
    name: vector<u8>, module_id: ID,
}
/// A linear operation tied to this exact Account, Kiosk, actor, root and source.
/// No by-value Handover, Soul, UID or native cap can leave its private fields.
public struct AccountHandover {
    account: ID, kiosk: ID, actor: address, operation: u8,
    source: IngressBinding, inner: lifecycle::Handover,
}
fun source_binding<W:drop,T:key+store>(_w:W,s:&Soul,name:vector<u8>):IngressBinding {
    let d=soul::descriptor<W>(s,name).destroy_some();
    assert!(soul::namespace(&d)==std::type_name::with_defining_ids<W>()
        && soul::value_type(&d)==std::type_name::with_defining_ids<T>()
        && lifecycle::handover_required(s,&d) && !soul::removable(&d),EBinding);
    let actual=soul::borrow_module<W,T>(s,name);
    assert!(object::id(actual)==soul::module_id(&d),EBinding);
    IngressBinding { root:object::id(s),
        witness_original:std::type_name::with_original_ids<W>(),
        witness_defining:std::type_name::with_defining_ids<W>(),
        value_original:std::type_name::with_original_ids<T>(),
        value_defining:std::type_name::with_defining_ids<T>(),
        name,module_id:soul::module_id(&d) }
}
/// Authenticate the actual permanent source namespace before atomic nesting.
/// Business readiness, current Config/revision and supported source schema remain
/// the genuine source's duties. Parent origin need not be that source namespace.
public fun nest_locked_source<W:drop,T:key+store>(
 w:W,k:&mut Kiosk,a:&mut Account,parent:ID,name:vector<u8>,
 child:Construction,completion:CompletionAuthorization,expected:u64,ctx:&TxContext,
):ID {
 assert_pair(k,a,ctx);
 assert_nesting_namespace<W,T>();
 let parent_origin={
  let s=sealed::borrow<Soul>(k,&a.authority,parent,ctx);
  let binding=source_binding<W,T>(w,s,name);
  assert!(binding.root==parent,EBinding);
  let d=soul::descriptor<W>(s,name).destroy_some();let value=soul::borrow_module<W,T>(s,name);
  assert!(std::hash::sha3_256(std::bcs::to_bytes(value))==soul::body_hash(&d),EBinding);
  soul::origin(s)
 };
 lifecycle::nest_locked_authority(child,completion,k,&mut a.authority,parent,parent_origin,expected,ctx)
}
fun assert_nesting_namespace<W,T>() {
 let wo=std::type_name::with_original_ids<W>();let to=std::type_name::with_original_ids<T>();
 let wd=std::type_name::with_defining_ids<W>();let td=std::type_name::with_defining_ids<T>();
 assert!(!wo.is_primitive() && !to.is_primitive()
  && wo.address_string()==to.address_string() && wo.module_string()==to.module_string()
  && wd.address_string()==td.address_string() && wd.module_string()==td.module_string(),EBinding);
}
/// Immutable source state only; a defining Source validates its schema and
/// current instance/config policy before authorizing the append terminal.
public fun source_module<W:drop,T:key+store>(
 w:W,k:&mut Kiosk,a:&Account,parent:ID,name:vector<u8>,ctx:&TxContext,
):(&T,u16) {
 assert_pair(k,a,ctx);assert_nesting_namespace<W,T>();
 let s=sealed::borrow<Soul>(k,&a.authority,parent,ctx);
 let binding=source_binding<W,T>(w,s,name);assert!(binding.root==parent,EBinding);
 let d=soul::descriptor<W>(s,name).destroy_some();let value=soul::borrow_module<W,T>(s,name);
 assert!(std::hash::sha3_256(std::bcs::to_bytes(value))==soul::body_hash(&d),EBinding);(value,soul::module_schema(&d))
}
fun assert_source<W:drop,T:key+store>(w:W,h:&AccountHandover) {
    assert!(source_binding<W,T>(w,lifecycle::handover_ref(&h.inner),h.source.name)==h.source,EBinding)
}
fun assert_session(k:&mut Kiosk,a:&Account,h:&AccountHandover,operation:u8,ctx:&TxContext) {
    assert_pair(k,a,ctx);
    assert!(h.account==object::id(a) && h.kiosk==object::id(k)
        && h.actor==ctx.sender() && h.operation==operation
        && lifecycle::handover_id(&h.inner)==h.source.root,EBinding)
}
public fun begin_source_deposit<W:drop,T:key+store>(w:W,k:&mut Kiosk,a:&mut Account,
    s:Soul,name:vector<u8>,ctx:&TxContext):AccountHandover {
    assert_pair(k,a,ctx);let source=source_binding<W,T>(w,&s,name);
    assert!(!sui::dynamic_field::exists_<IngressKey>(&a.id,IngressKey{root:source.root}),EBinding);
    AccountHandover {account:object::id(a),kiosk:object::id(k),actor:ctx.sender(),
        operation:0,source,inner:lifecycle::begin_handover(s)}
}
public fun begin_source_withdraw<W:drop,T:key+store>(w:W,k:&mut Kiosk,a:&mut Account,
    id:ID,ctx:&TxContext):AccountHandover {
    assert_pair(k,a,ctx);
    let source:IngressBinding=*sui::dynamic_field::borrow(&a.id,IngressKey{root:id});
    // Check the exact persisted source before taking the real unlocked Soul.
    assert!(source.witness_original==std::type_name::with_original_ids<W>()
        && source.witness_defining==std::type_name::with_defining_ids<W>()
        && source.value_original==std::type_name::with_original_ids<T>()
        && source.value_defining==std::type_name::with_defining_ids<T>(),EBinding);
    let s=sealed::take<Soul>(k,&a.authority,id,ctx);
    assert!(source_binding<W,T>(w,&s,source.name)==source,EBinding);
    AccountHandover {account:object::id(a),kiosk:object::id(k),actor:ctx.sender(),
        operation:1,source,inner:lifecycle::begin_handover(s)}
}
/// Borrowing a linear, authenticated session permits independent handlers to
/// fulfill their duties. No by-value handover, root or cap can be extracted.
public fun handover_ref(h:&AccountHandover):&lifecycle::Handover { &h.inner }
public fun handover_mut(h:&mut AccountHandover):&mut lifecycle::Handover { &mut h.inner }
public fun finish_source_deposit<W:drop,T:key+store>(w:W,k:&mut Kiosk,a:&mut Account,
    h:AccountHandover,ctx:&TxContext):ID {
    assert_session(k,a,&h,0,ctx);assert_source<W,T>(w,&h);
    let AccountHandover{account:_,kiosk:_,actor:_,operation:_,source,inner}=h;
    sui::dynamic_field::add(&mut a.id,IngressKey{root:source.root},source);
    lifecycle::finish_handover_place_authority(inner,k,&a.authority,ctx)
}
public fun finish_source_withdraw<W:drop,T:key+store>(w:W,k:&mut Kiosk,a:&mut Account,
    h:AccountHandover,ctx:&TxContext):ID {
    assert_session(k,a,&h,1,ctx);assert_source<W,T>(w,&h);
    let AccountHandover{account:_,kiosk:_,actor:_,operation:_,source,inner}=h;
    let installed:IngressBinding=sui::dynamic_field::remove(&mut a.id,IngressKey{root:source.root});
    assert!(installed==source,EBinding);lifecycle::finish_handover(inner,ctx.sender())
}
