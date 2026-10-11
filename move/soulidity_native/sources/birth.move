/// Complete non-Maker birth. Draft is linear: no root, state, library, UID or
/// operator escapes before founding invariants and final actual custody checks.
module soulidity_native::birth;
use soulidity_custody::lifecycle;
use std::bcs;
use std::hash;
use std::string::String;
use sui::clock::{Self,Clock};
use sui::dynamic_object_field as dof;
use sui::event;
use sui::kiosk::{Self,Kiosk,KioskOwnerCap};
use sui::transfer_policy::TransferPolicy;
use walrus::blob::Blob;
use walrus::system::System;
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_custody::lifecycle::{Construction};
use soulidity_foundation::economics::{Self,Config};
use soulidity_foundation::source_authority::Revision as SourceRevision;
use soulidity_content::founding_library::{Self,Founding,Library};
use soulidity_content::authorization::{Self,Authorization};
use soulidity_content::paid_access::{Self,Ledger};
use soulidity_content::state_configuration::{Self,Configuration};
use soulidity_content_kinds::content_kind_registry::KindRegistry;
use soulidity_native::registry::{Self,Registry,Claim,Provenance};

const EActor:u64=1;const EIdentity:u64=2;const ERoyalty:u64=3;const EConfig:u64=4;
const SCHEMA:u16=1;
public struct NativeModule has drop {}
public struct ContentOperator has drop {}
public struct ContentKey has copy,drop,store {}
public struct AuthorizationKey has copy,drop,store {}
public struct PaidKey has copy,drop,store {}
public struct ConfigurationKey has copy,drop,store {}
public struct State has key,store {
    id:UID,root:ID,protocol:ID,registry:ID,schema:u16,creator:address,
    description:String,image:String,creator_royalty_bps:u16,created_at:u64,
    provenance:Provenance,mint_nonce:vector<u8>,content:ID,issuer:SourceRevision,
}
public struct Draft {root:Construction,state:State,founding:Founding,actor:address,kiosk:ID}
public struct Metadata has drop {
    domain:vector<u8>,protocol:ID,registry:ID,name:String,description:String,image:String,
    creator:address,royalty:u16,provenance:Provenance,content:ID,issuer:SourceRevision,
}
public struct Commitment has drop {
    domain:vector<u8>,state:vector<u8>,content:vector<u8>,authorization:vector<u8>,paid:vector<u8>,configuration:vector<u8>,
}
public struct Created has copy,drop {
    soul:ID,state:ID,content:ID,authorization:ID,paid:ID,configuration:ID,
    kiosk:ID,owner:address,provenance_kind:u8,manifest:vector<u8>,
}
fun assert_royalty<C>(cfg:&Config<C>,royalty:u16){assert!((royalty as u64)+(economics::secondary_bps(cfg) as u64)<=10000,ERoyalty)}
public fun begin<C>(claim:Claim,r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,cap:&KioskOwnerCap,
    name:String,description:String,image:String,creator_royalty_bps:u16,
    mut keys:vector<String>,mut values:vector<vector<u8>>,clock:&Clock,ctx:&mut TxContext):Draft {
    registry::assert_current_custody(r,cfg,k,cap,ctx);begin_verified(claim,r,cfg,k,name,description,image,creator_royalty_bps,keys,values,clock,ctx)
}
public fun begin_account<C>(claim:Claim,r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,a:&soulidity_custody::account::Account,name:String,description:String,image:String,creator_royalty_bps:u16,keys:vector<String>,values:vector<vector<u8>>,clock:&Clock,ctx:&mut TxContext):Draft {
    registry::assert_current_account(r,cfg,k,a,ctx);begin_verified(claim,r,cfg,k,name,description,image,creator_royalty_bps,keys,values,clock,ctx)
}
fun begin_verified<C>(claim:Claim,r:&mut Registry,cfg:&Config<C>,k:&mut Kiosk,name:String,description:String,image:String,creator_royalty_bps:u16,mut keys:vector<String>,mut values:vector<vector<u8>>,clock:&Clock,ctx:&mut TxContext):Draft {
    assert_royalty(cfg,creator_royalty_bps);
    assert!(keys.length()==values.length(),EConfig);
    let provenance=registry::claim_provenance(&claim);let content=registry::claim_content_id(&claim);
    let issuer=economics::source_revision<C,Registry>(cfg).destroy_some();
    let metadata=hash::sha2_256(bcs::to_bytes(&Metadata{domain:b"soulidity/native-metadata/v1",protocol:object::id(cfg),registry:object::id(r),name,description,image,creator:ctx.sender(),royalty:creator_royalty_bps,provenance,content,issuer}));
    let nonce=registry::claim_nonce(&claim);let root=registry::new_construction(r,cfg,metadata,name,nonce,ctx);
    let mut state=State{id:object::new(ctx),root:lifecycle::construction_id(&root),protocol:object::id(cfg),registry:object::id(r),schema:SCHEMA,creator:ctx.sender(),description,image,creator_royalty_bps,created_at:clock::timestamp_ms(clock),provenance,mint_nonce:vector[],content,issuer};
    let(founding,actual_provenance,nonce)=registry::begin_content_verified(claim,r,cfg,k,ContentOperator{},&state,lifecycle::construction_ref(&root),ctx);
    assert!(provenance==actual_provenance && founding_library::pending_id(&founding)==content,EIdentity);state.mint_nonce=nonce;
    let mut configuration=state_configuration::new(ContentOperator{},&state,lifecycle::construction_ref(&root),ctx);
    // Preserve original reverse application: the first duplicate key wins.
    while(!keys.is_empty()){
        let key=keys.pop_back();let value=values.pop_back();state_configuration::assert_initial_key(&key);
        let rev=state_configuration::revision(&configuration);state_configuration::set(ContentOperator{},&mut configuration,key,value,rev)
    };
    dof::add(&mut state.id,ConfigurationKey{},configuration);
    Draft{root,state,founding,actor:ctx.sender(),kiosk:object::id(k)}
}
public fun draft_soul_id(d:&Draft):ID{lifecycle::construction_id(&d.root)}
public fun draft_content_id(d:&Draft):ID{founding_library::pending_id(&d.founding)}
public fun append_initial(d:&mut Draft,kinds:&KindRegistry,kind:u32,name:String,read:u64,download:u8,
    blob:Blob,system:&System,sha256:vector<u8>,nonce:vector<u8>,envelope:vector<u8>,expected:u64,set_active:bool,clock:&Clock,ctx:&TxContext):u64 {
    assert!(d.actor==ctx.sender(),EActor);
    founding_library::append_initial(ContentOperator{},&mut d.founding,kinds,kind,name,read,download,blob,system,sha256,nonce,envelope,expected,set_active,clock,ctx)
}
fun complete<C>(d:Draft,r:&Registry,cfg:&Config<C>,k:&Kiosk,system:&System,ctx:&mut TxContext):(Construction,soulidity_origin_protocol::producer_origin::CompletionAuthorization,Created) {
    let Draft{mut root,mut state,founding,actor,kiosk}=d;
    assert!(actor==ctx.sender(),EActor);assert!(kiosk==object::id(k) && state.registry==object::id(r) && state.protocol==object::id(cfg) && state.root==lifecycle::construction_id(&root),EIdentity);
    assert!(economics::source_revision<C,Registry>(cfg)==option::some(state.issuer),EIdentity);
    assert_royalty(cfg,state.creator_royalty_bps);
    let content=founding_library::finish(ContentOperator{},founding,system,ctx);
    founding_library::assert_binding(&content,object::id(&state),lifecycle::construction_id(&root));assert!(object::id(&content)==state.content,EIdentity);
    let authorization=authorization::new(ContentOperator{},&state,lifecycle::construction_ref(&root),ctx);
    let paid=paid_access::new(ContentOperator{},&state,lifecycle::construction_ref(&root),object::id(cfg),ctx);
    let auth_id=object::id(&authorization);let paid_id=object::id(&paid);
    dof::add(&mut state.id,ContentKey{},content);dof::add(&mut state.id,AuthorizationKey{},authorization);dof::add(&mut state.id,PaidKey{},paid);
    let state_id=object::id(&state);let configuration=object::id(configuration(&state));let content_id=state.content;let kind=registry::kind(&state.provenance);
    let semantic=commitment(&state);standard::creation_install(lifecycle::construction_mut(&mut root),NativeModule{},b"native",state,SCHEMA,false,semantic,0);
    let id=lifecycle::construction_id(&root);let manifest=standard::manifest_hash(lifecycle::construction_ref(&root));
    let completion=registry::complete_construction(r,cfg,&root,ctx);
    (root,completion,Created{soul:id,state:state_id,content:content_id,authorization:auth_id,paid:paid_id,configuration,kiosk,owner:actor,provenance_kind:kind,manifest})
}
public fun finish<C>(d:Draft,r:&Registry,cfg:&Config<C>,k:&mut Kiosk,cap:KioskOwnerCap,policy:&TransferPolicy<Soul>,system:&System,ctx:&mut TxContext):ID {
    registry::assert_current_custody(r,cfg,k,&cap,ctx);let(root,completion,created)=complete(d,r,cfg,k,system,ctx);
    let a=soulidity_custody::account::from_native_cap(k,cap,ctx);let id=soulidity_custody::account::deliver_locked_account(root,completion,k,a,policy,ctx);event::emit(created);id
}
public fun finish_account<C>(d:Draft,r:&Registry,cfg:&Config<C>,k:&mut Kiosk,a:soulidity_custody::account::Account,policy:&TransferPolicy<Soul>,system:&System,ctx:&mut TxContext):ID {
    registry::assert_current_account(r,cfg,k,&a,ctx);let(root,completion,created)=complete(d,r,cfg,k,system,ctx);
    let id=soulidity_custody::account::deliver_locked_account(root,completion,k,a,policy,ctx);event::emit(created);id
}
public fun finish_fresh_account<C>(d:Draft,r:&Registry,cfg:&Config<C>,mut k:Kiosk,a:soulidity_custody::account::Account,policy:&TransferPolicy<Soul>,system:&System,ctx:&mut TxContext):ID {
    registry::assert_current_account(r,cfg,&mut k,&a,ctx);let(root,completion,created)=complete(d,r,cfg,&k,system,ctx);
    let id=soulidity_custody::account::deliver_locked_fresh_account(root,completion,k,a,policy,ctx);event::emit(created);id
}
public fun has_state(root:&Soul):bool{standard::descriptor<NativeModule>(root,b"native").is_some()}
public fun state(root:&Soul):&State{standard::borrow_module<NativeModule,State>(root,b"native")}
public fun schema(s:&State):u16{s.schema}
public fun protocol(s:&State):ID{s.protocol}
public fun root_id(s:&State):ID{s.root}
public fun creator(s:&State):address{s.creator}
public fun royalty(s:&State):u16{s.creator_royalty_bps}
public fun description(s:&State):&String{&s.description}
public fun image(s:&State):&String{&s.image}
public fun provenance(s:&State):Provenance{s.provenance}
public fun mint_nonce(s:&State):vector<u8>{s.mint_nonce}
public fun created_at(s:&State):u64{s.created_at}
public fun issuer(s:&State):SourceRevision{s.issuer}
public fun content(s:&State):&Library{dof::borrow(&s.id,ContentKey{})}
public fun authorization(s:&State):&Authorization{dof::borrow(&s.id,AuthorizationKey{})}
public fun paid(s:&State):&Ledger{dof::borrow(&s.id,PaidKey{})}
public fun configuration(s:&State):&Configuration{dof::borrow(&s.id,ConfigurationKey{})}
public fun commitment(s:&State):vector<u8>{hash::sha2_256(bcs::to_bytes(&Commitment{domain:b"soulidity/native-state/v1",state:bcs::to_bytes(s),content:founding_library::commitment(content(s)),authorization:bcs::to_bytes(authorization(s)),paid:bcs::to_bytes(paid(s)),configuration:state_configuration::commitment(configuration(s))}))}
