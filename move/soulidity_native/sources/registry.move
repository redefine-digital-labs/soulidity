/// Canonical non-Maker issuance registry and linear source claims. This module
/// does not issue a visible Soul before its typed founding content is installed.
module soulidity_native::registry;
use soulidity_custody::lifecycle;
use std::type_name::{Self,TypeName};
use sui::kiosk::{Self,Kiosk,KioskOwnerCap};
use sui::derived_object;
use sui::dynamic_field as df;
use sui::table::{Self,Table};
use soulidity_foundation::economics::{Self,Config,Admin};
use soulidity_foundation::source_authority::Revision as SourceRevision;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_custody::lifecycle::{Construction};
use soulidity_content::founding_library::{Self,Founding};
use soulidity_custody::account::{Self as account,Account};
use soulidity_origin_protocol::producer_origin::{Self,CompletionAuthorization};

const EIdentity:u64=1;
const EOwner:u64=2;
const EKiosk:u64=3;
const ENonce:u64=4;
const EJoined:u64=5;
const ESchema:u64=6;
const SCHEMA:u16=1;

/// Only this producer can attest roots from this real Registry object.
public struct SoulProducer has drop {}
public struct SourceRevision1 has drop {}
public struct REGISTRY has drop {}
fun init(w:REGISTRY,ctx:&mut TxContext){sui::package::claim_and_keep(w,ctx)}
/// Shared, non-transferable directory. No mutable UID/table accessor exists.
public struct Registry has key {id:UID,protocol:ID,schema:u16,kiosks:Table<address,PersonalKiosk>}
public struct PersonalKiosk has copy,drop,store {kiosk:ID,cap:ID}
public struct ContentMintKey has copy,drop,store {author:address,nonce:vector<u8>}
public struct JoinedSourceKey has copy,drop,store {source:ID}
public struct JoinedSource has copy,drop,store {object:ID,source_type:TypeName}
/// All fields are private. Unverified import text is never upgraded to proof.
public struct Provenance has copy,drop,store {kind:u8,origin:Option<std::string::String>,joined:Option<JoinedSource>}
/// No abilities. It cannot escape into storage or finish without a same-package
/// consumer that installs real founding content under the derived UID.
public struct Claim {id:ID,registry:ID,protocol:ID,actor:address,kiosk:ID,nonce:vector<u8>,provenance:Provenance,issuer:SourceRevision}

public fun create<C>(cfg:&mut Config<C>,admin:&mut Admin,expected:u64,hash:vector<u8>,p:&sui::package::Publisher,cap:&sui::package::UpgradeCap,ctx:&mut TxContext):ID{
    let r=Registry{id:object::new(ctx),protocol:object::id(cfg),schema:SCHEMA,kiosks:table::new(ctx)};
    let id=economics::register_source_registry(cfg,admin,SoulProducer{},&r,expected,hash);
    let rev=economics::revision(cfg);let hash=economics::commitment(cfg);
    economics::register_source_revision(cfg,admin,SoulProducer{},SourceRevision1{},&r,p,cap,rev,hash);transfer::share_object(r);id
}
/// Current deployment adapter. A new SourceRevision type must be introduced
/// for every protected Native release; unchanged type origins are insufficient.
public fun register_revision<C>(r:&Registry,cfg:&mut Config<C>,admin:&mut Admin,expected:u64,hash:vector<u8>,p:&sui::package::Publisher,cap:&sui::package::UpgradeCap){
    assert!(r.protocol==object::id(cfg) && r.schema==SCHEMA,ESchema);
    economics::register_source_revision(cfg,admin,SoulProducer{},SourceRevision1{},r,p,cap,expected,hash)
}
public fun protocol(r:&Registry):ID{r.protocol}
public fun schema(r:&Registry):u16{r.schema}
fun assert_current<C>(r:&Registry,cfg:&Config<C>){
    economics::assert_primary(cfg);assert!(r.schema==SCHEMA,ESchema);
    economics::assert_source_revision<C,SoulProducer,SourceRevision1,Registry>(cfg);
    assert!(r.protocol==object::id(cfg) && object::id(r)==economics::source_registry_id<C,Registry>(cfg),EIdentity)
}
fun assert_kiosk(k:&mut Kiosk,cap:&KioskOwnerCap,ctx:&TxContext){assert!(kiosk::owner(k)==ctx.sender(),EOwner);assert!(kiosk::has_access(k,cap),EKiosk)}
public fun register_personal_kiosk<C>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,ctx:&TxContext){
    assert_current(r,cfg);assert_kiosk(k,cap,ctx);let pair=PersonalKiosk{kiosk:object::id(k),cap:object::id(cap)};
    if(r.kiosks.contains(ctx.sender()))assert!(*r.kiosks.borrow(ctx.sender())==pair,EKiosk) else r.kiosks.add(ctx.sender(),pair)
}
fun assert_registered(r:&Registry,k:&mut Kiosk,cap:&KioskOwnerCap,ctx:&TxContext){
    assert_kiosk(k,cap,ctx);assert!(r.kiosks.contains(ctx.sender()),EKiosk);
    assert!(*r.kiosks.borrow(ctx.sender())==PersonalKiosk{kiosk:object::id(k),cap:object::id(cap)},EKiosk)
}
public(package) fun assert_current_custody<C>(r:&Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,ctx:&TxContext){
    assert_current(r,cfg);assert_registered(r,k,cap,ctx)
}
/// Deposit an actual existing source asset through the registered owner path.
/// Soul has its own handover obligations and cannot use this generic ingress.
public fun place_source<C,T:key+store>(r:&Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,source:T,ctx:&TxContext):ID{
    assert_current_custody(r,cfg,k,cap,ctx);
    assert!(type_name::with_original_ids<T>()!=type_name::with_original_ids<Soul>(),EJoined);
    let id=object::id(&source);kiosk::place(k,cap,source);id
}
public fun expected_content_id(r:&Registry,author:address,nonce:vector<u8>):ID{
    assert!(nonce.length()==16,ENonce);object::id_from_address(derived_object::derive_address(object::id(r),ContentMintKey{author,nonce}))
}
public fun content_id_claimed(r:&Registry,author:address,nonce:vector<u8>):bool{
    assert!(nonce.length()==16,ENonce);df::exists_(&r.id,ContentMintKey{author,nonce})
}
public fun actual_content_allocated(r:&Registry,author:address,nonce:vector<u8>):bool{assert!(nonce.length()==16,ENonce);derived_object::exists(&r.id,ContentMintKey{author,nonce})}
public fun source_joined(r:&Registry,source:ID):bool{df::exists_(&r.id,JoinedSourceKey{source})}
fun prepare<C>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,nonce:vector<u8>,expected:ID,provenance:Provenance,ctx:&TxContext):Claim{
    assert_current(r,cfg);assert_registered(r,k,cap,ctx);prepare_verified(r,cfg,k,nonce,expected,provenance,ctx)
}
fun prepare_verified<C>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,nonce:vector<u8>,expected:ID,provenance:Provenance,ctx:&TxContext):Claim {
    assert!(expected_content_id(r,ctx.sender(),nonce)==expected,EIdentity);
    let key=ContentMintKey{author:ctx.sender(),nonce};assert!(!df::exists_(&r.id,key),ENonce);df::add(&mut r.id,key,true);
    Claim{id:expected,registry:object::id(r),protocol:object::id(cfg),actor:ctx.sender(),kiosk:object::id(k),nonce,provenance,issuer:economics::source_revision<C,Registry>(cfg).destroy_some()}
}
public fun prepare_native<C>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,nonce:vector<u8>,expected:ID,ctx:&TxContext):Claim{
    prepare(r,cfg,k,cap,nonce,expected,Provenance{kind:0,origin:option::none(),joined:option::none()},ctx)
}
public fun prepare_imported<C>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,origin:std::string::String,nonce:vector<u8>,expected:ID,ctx:&TxContext):Claim{
    prepare(r,cfg,k,cap,nonce,expected,Provenance{kind:1,origin:option::some(origin),joined:option::none()},ctx)
}
public fun prepare_joined<C,T:key+store>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,source:ID,origin:std::string::String,nonce:vector<u8>,expected:ID,ctx:&TxContext):Claim{
    assert_current(r,cfg);assert_registered(r,k,cap,ctx);
    assert!(kiosk::has_item_with_type<T>(k,source),EJoined);let key=JoinedSourceKey{source};assert!(!df::exists_(&r.id,key),EJoined);df::add(&mut r.id,key,true);
    prepare(r,cfg,k,cap,nonce,expected,Provenance{kind:2,origin:option::some(origin),joined:option::some(JoinedSource{object:source,source_type:type_name::with_defining_ids<T>()})},ctx)
}
public fun kind(p:&Provenance):u8{p.kind}
public fun declared_origin(p:&Provenance):Option<std::string::String>{p.origin}
public fun verified_import(_p:&Provenance):bool{false}
public fun joined(p:&Provenance):Option<JoinedSource>{p.joined}
public fun joined_id(p:&JoinedSource):ID{p.object}
public fun joined_type(p:&JoinedSource):TypeName{p.source_type}
public fun claim_content_id(c:&Claim):ID{c.id}
public fun claim_provenance(c:&Claim):Provenance{c.provenance}
public fun claim_issuer(c:&Claim):SourceRevision{c.issuer}
/// Internal-only: a foreign caller cannot release a UID or convert a claim to
/// an arbitrary asset. The eventual native birth verifies its own actor/root.
public(package) fun consume<C>(c:Claim,r:&Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,ctx:&TxContext):(ID,Provenance,vector<u8>){
    assert_current(r,cfg);assert_registered(r,k,cap,ctx);consume_verified(c,r,cfg,k,ctx)
}
fun consume_verified<C>(c:Claim,r:&Registry,cfg:&Config<C>,k:&mut Kiosk,ctx:&TxContext):(ID,Provenance,vector<u8>){
    let Claim{id,registry,protocol,actor,kiosk,nonce,provenance,issuer}=c;
    assert!(economics::source_revision<C,Registry>(cfg)==option::some(issuer),EIdentity);
    assert!(registry==object::id(r) && protocol==object::id(cfg) && actor==ctx.sender() && kiosk==object::id(k),EIdentity);
    assert!(id==expected_content_id(r,actor,nonce) && content_id_claimed(r,actor,nonce),EIdentity);(id,provenance,nonce)
}
/// Future native birth consumes its exact claim while the content module
/// allocates and packs the derived UID itself. No raw UID is returned.
public(package) fun begin_content<C,W:drop,P:key>(c:Claim,r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,w:W,parent:&P,root:&Soul,ctx:&mut TxContext):(Founding,Provenance,vector<u8>){
    assert_current(r,cfg);assert_registered(r,k,cap,ctx);begin_content_verified(c,r,cfg,k,w,parent,root,ctx)
}
public(package) fun begin_content_verified<C,W:drop,P:key>(c:Claim,r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,w:W,parent:&P,root:&Soul,ctx:&mut TxContext):(Founding,Provenance,vector<u8>){
    let(expected,provenance,nonce)=consume_verified(c,r,cfg,k,ctx);
    let origin=standard::origin(root);
    assert!(standard::source(&origin)==object::id(r) && standard::source_type(&origin)==type_name::with_defining_ids<Registry>() && standard::producer(&origin)==type_name::with_defining_ids<SoulProducer>() && standard::minted_by(&origin)==ctx.sender(),EIdentity);
    let f=founding_library::begin_derived(w,parent,root,&mut r.id,ContentMintKey{author:ctx.sender(),nonce},ctx);
    assert!(founding_library::pending_id(&f)==expected,EIdentity);(f,provenance,nonce)
}
public(package) fun new_construction<C>(r:&Registry,cfg:&Config<C>,metadata:vector<u8>,name:std::string::String,nonce:vector<u8>,ctx:&mut TxContext):Construction {
    assert_current(r,cfg);let issuer=economics::source_revision<C,Registry>(cfg).destroy_some();
    let attempt=std::hash::sha2_256(std::bcs::to_bytes(&Attempt{domain:b"soulidity/native-attempt/v1",registry:object::id(r),actor:ctx.sender(),nonce}));
    let request=producer_origin::request<SoulProducer,Registry,SoulProducer,SourceRevision1,Soul>(SoulProducer{},r,SoulProducer{},SourceRevision1{},soulidity_foundation::source_authority::version(&issuer),metadata,name,attempt,object::id(cfg),economics::revision(cfg),economics::commitment(cfg),0,0,ctx);
    lifecycle::new(SoulProducer{},r,request,ctx)
}
public struct Attempt has drop {domain:vector<u8>,registry:ID,actor:address,nonce:vector<u8>}
public(package) fun complete_construction<C>(r:&Registry,cfg:&Config<C>,c:&Construction,ctx:&TxContext):CompletionAuthorization {
    assert_current(r,cfg);let snap=lifecycle::construction_snapshot(c);
    assert!(producer_origin::config(&snap)==object::id(cfg) && producer_origin::revision(&snap)==economics::revision(cfg) && producer_origin::commitment(&snap)==economics::commitment(cfg),EIdentity);
    producer_origin::complete(SoulProducer{},r,lifecycle::construction_ref(c),snap,ctx)
}
public(package) fun claim_nonce(c:&Claim):vector<u8>{c.nonce}
public(package) fun assert_current_account<C>(r:&Registry,cfg:&Config<C>,k:&mut Kiosk,a:&Account,ctx:&TxContext) {
    assert_current(r,cfg);account::assert_pair(k,a,ctx);assert!(r.kiosks.contains(ctx.sender()),EKiosk);
    assert!(*r.kiosks.borrow(ctx.sender())==PersonalKiosk{kiosk:object::id(k),cap:account::cap_id(a)},EKiosk)
}
public fun register_account<C>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,a:&Account,ctx:&TxContext) {
    assert_current(r,cfg);account::assert_pair(k,a,ctx);let pair=PersonalKiosk{kiosk:object::id(k),cap:account::cap_id(a)};
    if(r.kiosks.contains(ctx.sender()))assert!(*r.kiosks.borrow(ctx.sender())==pair,EKiosk) else r.kiosks.add(ctx.sender(),pair)
}
public fun place_account_source<C,T:key+store>(r:&Registry,cfg:&Config<C>,k:&mut Kiosk,a:&Account,source:T,ctx:&TxContext):ID {
    assert_current_account(r,cfg,k,a,ctx);assert!(type_name::with_original_ids<T>()!=type_name::with_original_ids<Soul>(),EJoined);
    let id=object::id(&source);account::place_source(SoulProducer{},r,k,a,source,ctx);id
}
public fun prepare_native_account<C>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,a:&Account,nonce:vector<u8>,expected:ID,ctx:&TxContext):Claim {
    assert_current_account(r,cfg,k,a,ctx);prepare_verified(r,cfg,k,nonce,expected,Provenance{kind:0,origin:option::none(),joined:option::none()},ctx)
}
public fun prepare_imported_account<C>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,a:&Account,origin:std::string::String,nonce:vector<u8>,expected:ID,ctx:&TxContext):Claim {
    assert_current_account(r,cfg,k,a,ctx);prepare_verified(r,cfg,k,nonce,expected,Provenance{kind:1,origin:option::some(origin),joined:option::none()},ctx)
}
public fun prepare_joined_account<C,T:key+store>(r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,a:&Account,source:ID,origin:std::string::String,nonce:vector<u8>,expected:ID,ctx:&TxContext):Claim {
    assert_current_account(r,cfg,k,a,ctx);assert!(kiosk::has_item_with_type<T>(k,source),EJoined);let key=JoinedSourceKey{source};assert!(!df::exists_(&r.id,key),EJoined);df::add(&mut r.id,key,true);
    prepare_verified(r,cfg,k,nonce,expected,Provenance{kind:2,origin:option::some(origin),joined:option::some(JoinedSource{object:source,source_type:type_name::with_defining_ids<T>()})},ctx)
}
#[test_only]
public fun create_for_testing<C>(cfg:&mut Config<C>,admin:&mut Admin,expected:u64,hash:vector<u8>,ctx:&mut TxContext):ID{
    let r=Registry{id:object::new(ctx),protocol:object::id(cfg),schema:SCHEMA,kiosks:table::new(ctx)};
    let id=economics::register_source_registry(cfg,admin,SoulProducer{},&r,expected,hash);let rev=economics::revision(cfg);let hash=economics::commitment(cfg);
    economics::source_revision_for_testing(cfg,admin,SoulProducer{},SourceRevision1{},&r,rev,hash,1);transfer::share_object(r);id
}
#[test_only]
public struct SourceRevision9999 has drop {}
#[test_only]
public fun advance_revision_for_testing<C>(r:&Registry,cfg:&mut Config<C>,admin:&mut Admin,expected:u64,hash:vector<u8>){economics::source_revision_for_testing(cfg,admin,SoulProducer{},SourceRevision9999{},r,expected,hash,2)}
#[test_only]
public fun assert_advanced_revision_for_testing<C>(cfg:&Config<C>){economics::assert_source_revision<C,SoulProducer,SourceRevision9999,Registry>(cfg)}
#[test_only]
public fun publisher_for_testing(ctx:&mut TxContext):sui::package::Publisher{sui::package::test_claim(SoulProducer{},ctx)}
#[test_only]
public fun new_root_for_testing<C>(r:&Registry,cfg:&Config<C>,metadata:vector<u8>,name:std::string::String,ctx:&mut TxContext):Soul{assert_current(r,cfg);let issuer=economics::source_revision<C,Registry>(cfg).destroy_some();standard::creation_raw_for_testing(standard::new(SoulProducer{},r,soulidity_foundation::source_authority::version(&issuer),metadata,name,ctx))}
#[test_only]
public fun begin_content_for_testing<C,W:drop,P:key>(c:Claim,r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,w:W,parent:&P,root:&Soul,ctx:&mut TxContext):(Founding,Provenance,vector<u8>){begin_content(c,r,cfg,k,cap,w,parent,root,ctx)}
#[test_only]
public fun consume_for_testing<C>(c:Claim,r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,ctx:&TxContext):(ID,Provenance){
    let(expected,p,nonce)=consume(c,r,cfg,k,cap,ctx);let uid=derived_object::claim(&mut r.id,ContentMintKey{author:ctx.sender(),nonce});let result=uid.to_inner();assert!(result==expected,EIdentity);uid.delete();(result,p)
}
