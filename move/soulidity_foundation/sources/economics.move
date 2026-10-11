module soulidity_foundation::economics;

use sui::coin::{Self,Coin};
use sui::clock::{Self,Clock};
use sui::event;
use std::bcs;
use std::hash;
use std::type_name::{Self,TypeName};
use soulidity_foundation::revenue::{Self,Ledger};
use sui::dynamic_object_field as dof;
use sui::dynamic_field as df;
use sui::package::{Publisher,UpgradeCap};
use soulidity_foundation::package_roles::{Self,State,Role,RoleCertificate};
use soulidity_foundation::source_authority::{Self,Revision as SourceRevision};

const EPolicy:u64=1;
const EPayment:u64=2;
const EExpired:u64=3;
const EShare:u64=4;

/// Coin type is fixed by the Config type, never accepted as a text label.
public struct Config<phantom C> has key {
    id:UID, revision:u64, primary_bps:u16, secondary_bps:u16,
    complete_fee:u64, recipient:address, paused:bool,income:Ledger<C>,
    schema:u16,enabled:bool,payment_coin:TypeName,original_package:ID,callable_package:ID,commitment:vector<u8>,
    native_binding:Option<NativeBindingSnapshot>,
    release_binding:Option<ReleaseBindingSnapshot>,
    minimum_release:u64,roles:State,
}
public struct NativeBindingKey has copy,drop,store {}
public struct NativeBindingHistoryKey has copy,drop,store {generation:u64}
/// Native type identity is installed only by this package's actual binder.
public struct NativeBindingSnapshot has copy,drop,store {catalog:ID,generation:u64,original_package:ID,callable_package:ID,commitment:vector<u8>}
/// A fresh marker must be introduced for each callable protocol release. A
/// defining ID is the package that introduced this marker, not an UpgradeCap lock.
public struct ProtocolRevision1 has drop {}
public struct ProtocolRevision2 has drop {}
/// Private construction and parent UID access prevent arbitrary flag injection.
public struct MarketGatesKey has copy,drop,store {}
public struct MarketGates has copy,drop,store {primary:bool,secondary:bool}
/// A producer-specific, permanent singleton directory. This stores identity,
/// not an asset, permission grant, configurable fee or mutable UID escape.
public struct SourceRegistryKey<phantom T> has copy,drop,store {}
public struct SourceRegistryLocation has copy,drop,store {id:ID}
/// Config owns the one active revision for each concrete producer directory.
/// No mutable slot or UID accessor exists. This is separate from fee snapshots.
public struct SourceRevisionKey<phantom T> has copy,drop,store {}
public struct SourceRevisionChanged has copy,drop {config:ID,registry:ID,revision:u64,source:SourceRevision,commitment:vector<u8>}
/// Preserve the original snapshot ABI; the operational commitment includes gates.
public struct OperationalSnapshot has copy,drop,store {domain:vector<u8>,config:ConfigSnapshot,gates:MarketGates}
public struct OperationalConfigurationChanged has copy,drop {snapshot:OperationalSnapshot,commitment:vector<u8>}
public struct ConfigSnapshot has copy,drop,store {
    domain:vector<u8>,schema:u16,config:ID,revision:u64,enabled:bool,paused:bool,
    payment_coin:TypeName,original_package:ID,callable_package:ID,income_root:ID,
    primary_bps:u16,secondary_bps:u16,complete_fee:u64,recipient:address,
    native_binding:Option<NativeBindingSnapshot>,
    release_binding:Option<ReleaseBindingSnapshot>,
    minimum_release:u64,roles:State,
}
public struct ConfigurationChanged has copy,drop {snapshot:ConfigSnapshot,commitment:vector<u8>}
public struct Authority has key { id:UID }
fun init(ctx:&mut TxContext) { transfer::transfer(Authority{id:object::new(ctx)},ctx.sender()) }
#[test_only]
public fun init_for_testing(ctx:&mut TxContext) {init(ctx)}
public struct Admin has key,store {id:UID,config:ID}
/// Linear, transaction-local authority for installing one concrete directory.
/// No copy/drop/store: it cannot be cached, wrapped, silently discarded or replayed.
public struct Installation<phantom C,phantom T> {
    config:ID,revision:u64,commitment:vector<u8>,kind:u8,
    original:ID,callable:ID,marker:TypeName,value:ID,generation:u64,value_commitment:vector<u8>,
}
/// The actual private witness is created only by the corresponding binder.
/// Text/hashes are not accepted as evidence of the caller's role.
public fun authorize_installation<C,W:drop,R:drop,T:key+store>(c:&Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,kind:u8,_witness:W,_revision:R,value:&T,generation:u64,value_commitment:vector<u8>):Installation<C,T>{
    assert_install_admin(c,a,expected,expected_commitment);assert_current_package(c);assert!(kind<=1,EPolicy);
    let witness=type_name::with_original_ids<W>();let value_type=type_name::with_original_ids<T>();
    let role_module=if(kind==0)b"native_binding" else b"maker_release";
    let name=if(kind==0)b"NativeInstaller1" else b"ReleaseInstaller1";
    assert!(!witness.is_primitive() && !value_type.is_primitive() && is_nonzero_hash(&value_commitment),EPolicy);
    assert!(*witness.module_string().as_bytes()==role_module && *witness.datatype_string().as_bytes()==name
        && *value_type.module_string().as_bytes()==role_module && *value_type.datatype_string().as_bytes()==b"Catalog",EPolicy);
    let original=object::id_from_address(type_name::original_id<W>());
        assert!(type_name::original_id<T>()==type_name::original_id<W>(),EPolicy);
    package_roles::assert_types<W,R>(&c.roles,kind);
    let callable=object::id_from_address(type_name::defining_id<R>());
    Installation{config:object::id(c),revision:c.revision,commitment:c.commitment,kind,original,callable,marker:type_name::with_defining_ids<R>(),value:object::id(value),generation,value_commitment}
}
fun consume_installation<C,T:key+store>(c:&Config<C>,a:&mut Admin,p:Installation<C,T>,kind:u8,value:&T,expected_generation:u64,expected_value_commitment:&vector<u8>):(ID,ID,TypeName){
    let Installation{config,revision,commitment,kind:actual,original,callable,marker,value:bound,generation,value_commitment}=p;
    assert_install_admin(c,a,revision,commitment);assert_current_package(c);
    package_roles::assert_identity(&c.roles,kind,original,callable);
    assert!(config==object::id(c) && actual==kind && bound==object::id(value)
        && generation==expected_generation && value_commitment==*expected_value_commitment,EPolicy);(original,callable,marker)
}
/// Config remains the single authority; its embedded registry is never exposed mutably.
public fun role<C>(c:&Config<C>,kind:u8):Role{package_roles::role(&c.roles,kind)}
public fun assert_role_types<C,W,R>(c:&Config<C>,kind:u8){assert_recovery_identity(c);package_roles::assert_types<W,R>(&c.roles,kind)}
public fun register_role<C,W:drop,R:drop>(c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,kind:u8,w:W,r:R,p:&Publisher,cap:&UpgradeCap){
    assert_install_admin(c,a,expected,expected_commitment);assert_current_package(c);
    package_roles::register(&mut c.roles,kind,w,r,p,cap);c.revision=c.revision+1;refresh_commitment(c)
}
/// Each instance Admin selects its own authentic release while disabled, with
/// the same revision/commitment CAS and strictly monotone lineage checks.
public fun register_role_from_certificate<C,W:drop,R:drop>(c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,kind:u8,w:W,r:R,certificate:&RoleCertificate<W,R>){
    assert_install_admin(c,a,expected,expected_commitment);assert_current_package(c);
    package_roles::register_from_certificate(&mut c.roles,kind,w,r,certificate);
    c.revision=c.revision+1;refresh_commitment(c)
}
public fun freeze_role<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,kind:u8){
    assert_install_admin(c,a,expected,expected_commitment);package_roles::freeze_role(&mut c.roles,kind);c.revision=c.revision+1;refresh_commitment(c)
}
public fun assert_business<C,W:drop,R:drop>(c:&Config<C>,kind:u8,_w:W,_r:R){
    assert!(kind>=2 && kind < 6,EPolicy);
    if(kind==2 || kind==5)assert_primary(c) else assert_secondary(c);
    assert!(package_roles::pinned(&package_roles::role(&c.roles,kind)),EPolicy);package_roles::assert_types<W,R>(&c.roles,kind)
}
#[test_only]
public fun new_config_for_testing<C>(primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):(Config<C>,Admin){new_config(primary,secondary,fixed,recipient,ctx)}
#[test_only]
public fun share_config_for_testing<C>(c:Config<C>,a:Admin,ctx:&TxContext):ID{share_config(c,a,ctx)}
/// Immutable issuance economics; operational Config still governs pause/revision.
public struct PrimaryPolicy has copy,drop,store {schema:u16,config:ID,snapshot_revision:u64,platform:address,bps:u16,complete_fee:u64}
public struct PrimaryReceipt has copy,drop,store {
    policy:PrimaryPolicy,operational_revision:u64,subject:ID,commitment:vector<u8>,actor:address,attempt:vector<u8>,expiry:u64,
    gross:u64,primary_amount:u64,fixed:u64,total:u64,beneficiary:address,net:u64,revenue:Option<ID>,
}
public struct PrimarySettled has copy,drop {receipt:PrimaryReceipt}
public fun primary_policy<C>(c:&Config<C>):PrimaryPolicy {
    assert_primary(c);primary_policy_value(c)
}
fun primary_policy_value<C>(c:&Config<C>):PrimaryPolicy{PrimaryPolicy{schema:1,config:object::id(c),snapshot_revision:c.revision,platform:c.recipient,bps:c.primary_bps,complete_fee:c.complete_fee}
}
public fun primary_policy_hash(p:&PrimaryPolicy):vector<u8>{hash::sha2_256(bcs::to_bytes(p))}
public fun primary_policy_config(p:&PrimaryPolicy):ID{p.config}
public fun primary_policy_revision(p:&PrimaryPolicy):u64{p.snapshot_revision}
public fun primary_policy_platform(p:&PrimaryPolicy):address{p.platform}
public fun primary_policy_bps(p:&PrimaryPolicy):u16{p.bps}
public fun primary_policy_fixed(p:&PrimaryPolicy):u64{p.complete_fee}
public fun primary_policy_fee(p:&PrimaryPolicy,price:u64):u64{fee(price,p.bps)}
public fun primary_quote<C>(p:&PrimaryPolicy,c:&Config<C>,gross:u64,charge_fixed:bool,beneficiary:address,subject:ID,commitment:vector<u8>,actor:address,attempt:vector<u8>,expiry:u64):PrimaryReceipt {
    assert_primary(c);primary_quote_value(p,c,gross,charge_fixed,beneficiary,subject,commitment,actor,attempt,expiry)
}
fun primary_quote_value<C>(p:&PrimaryPolicy,c:&Config<C>,gross:u64,charge_fixed:bool,beneficiary:address,subject:ID,commitment:vector<u8>,actor:address,attempt:vector<u8>,expiry:u64):PrimaryReceipt{
    assert!(p.config==object::id(c) && beneficiary!=@0x0 && actor!=@0x0 && commitment.length()==32 && attempt.length()==32,EPolicy);
    let cut=if(gross==0)0 else strict_share(gross,p.bps);assert!(gross==0 || cut < gross,EPayment);
    let fixed=if(charge_fixed)p.complete_fee else 0;let total=(gross as u128)+(fixed as u128);assert!(total<=18446744073709551615,EPayment);
    PrimaryReceipt{policy:*p,operational_revision:c.revision,subject,commitment,actor,attempt,expiry,gross,primary_amount:cut,fixed,total:total as u64,beneficiary,net:gross-cut,revenue:option::none()}
}
public fun route_primary(mut r:PrimaryReceipt,product:ID):PrimaryReceipt{assert!(r.revenue.is_none(),EPolicy);r.revenue=option::some(product);r}
/// Exact platform income is retained under the same Config authority. Product
/// residual must be deposited by catalog; no loose Coin exits a public API.
public fun collect_primary<C,W:drop,R:drop>(c:&mut Config<C>,w:W,r_marker:R,r:PrimaryReceipt,mut payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):Coin<C>{
    assert_business<C,W,R>(c,2,w,r_marker);
    // Business validation above checks this same Config before any mutation.
    assert_live_fields(c,r.operational_revision,r.expiry,clock);collect_primary_value(c,r,payment,ctx)
}
fun collect_primary_value<C>(c:&mut Config<C>,r:PrimaryReceipt,mut payment:Coin<C>,ctx:&mut TxContext):Coin<C>{
    assert!(r.revenue.is_some() && r.policy.config==object::id(c) && ctx.sender()==r.actor,EPolicy);
    assert!(coin::value(&payment)==r.total,EPayment);let platform=r.primary_amount+r.fixed;
    if(platform>0)revenue::deposit(&c.id,&mut c.income,coin::split(&mut payment,platform,ctx));
    assert!(coin::value(&payment)==r.net,EPayment);event::emit(PrimarySettled{receipt:r});payment
}
/// Concrete atomic quote and Coin collection. The quote and role/receipt checks
/// share this unchanged Config before collect_primary_value mutates income.
/// No authority token or partially validated quote escapes this invocation.
public fun quote_collect_primary<C,W:drop,R:drop>(c:&mut Config<C>,_w:W,_r:R,p:&PrimaryPolicy,gross:u64,fixed:bool,beneficiary:address,subject:ID,commitment:vector<u8>,actor:address,attempt:vector<u8>,expiry:u64,product:ID,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):(PrimaryReceipt,Coin<C>){
    assert_primary(c);
    let receipt=route_primary(primary_quote_value(p,c,gross,fixed,beneficiary,subject,commitment,actor,attempt,expiry),product);
    // Original collect_primary's assert_business continuation, after the same
    // full Primary guard and before any Config mutation. Preserve quote errors first.
    assert!(package_roles::pinned(&package_roles::role(&c.roles,2)),EPolicy);package_roles::assert_types<W,R>(&c.roles,2);
    assert_live_fields(c,receipt.operational_revision,receipt.expiry,clock);
    let net=collect_primary_value(c,receipt,payment,ctx);(receipt,net)
}
public fun quote_collect_manufacturing_primary<C,W:drop,R:drop>(c:&mut Config<C>,_w:W,_r:R,p:&PrimaryPolicy,gross:u64,fixed:bool,beneficiary:address,subject:ID,commitment:vector<u8>,actor:address,attempt:vector<u8>,expiry:u64,product:ID,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):(PrimaryReceipt,Coin<C>){
    assert_manufacturing_primary(c);
    let receipt=route_primary(primary_quote_value(p,c,gross,fixed,beneficiary,subject,commitment,actor,attempt,expiry),product);
    package_roles::assert_types<W,R>(&c.roles,2);
    assert_live_fields(c,receipt.operational_revision,receipt.expiry,clock);
    let net=collect_primary_value(c,receipt,payment,ctx);(receipt,net)
}
public fun primary_receipt_policy(r:&PrimaryReceipt):PrimaryPolicy{r.policy}
public fun primary_receipt_revision(r:&PrimaryReceipt):u64{r.operational_revision}
public fun primary_receipt_gross(r:&PrimaryReceipt):u64{r.gross}
public fun primary_receipt_fee(r:&PrimaryReceipt):u64{r.primary_amount}
public fun primary_receipt_fixed(r:&PrimaryReceipt):u64{r.fixed}
public fun primary_receipt_total(r:&PrimaryReceipt):u64{r.total}
public fun primary_receipt_net(r:&PrimaryReceipt):u64{r.net}
public fun primary_receipt_beneficiary(r:&PrimaryReceipt):address{r.beneficiary}
public fun primary_receipt_subject(r:&PrimaryReceipt):ID{r.subject}
public fun primary_receipt_actor(r:&PrimaryReceipt):address{r.actor}
public fun primary_receipt_attempt(r:&PrimaryReceipt):vector<u8>{r.attempt}
public fun primary_receipt_commitment(r:&PrimaryReceipt):vector<u8>{r.commitment}
public fun primary_receipt_revenue(r:&PrimaryReceipt):Option<ID>{r.revenue}
/// Product creation fixes fee authority and original creator rights. A later
/// Control owner or Config update cannot rewrite this snapshot.
public struct MarketPolicy has copy,drop,store {
    schema:u16,config:ID,snapshot_revision:u64,platform:address,
    control_fee_bps:u16,equipment_fee_bps:u16,control_royalty_bps:u16,creator:address,
}
public struct MarketReceipt has copy,drop,store {
    lane:u8,config:ID,operational_revision:u64,policy:MarketPolicy,
    gross:u64,seller_amount:u64,platform_amount:u64,creator_amount:u64,seller:address,
}
public struct MarketSettled has copy,drop {subject:ID,attempt:vector<u8>,payer:address,receipt:MarketReceipt}
public fun market_policy<C>(c:&Config<C>,control_royalty_bps:u16,ctx:&TxContext):MarketPolicy {
    assert_enabled(c);market_policy_value(c,control_royalty_bps,ctx)
}
fun market_policy_value<C>(c:&Config<C>,control_royalty_bps:u16,ctx:&TxContext):MarketPolicy{
    assert!(control_royalty_bps<=1000 && ctx.sender()!=@0x0,EPolicy);
    MarketPolicy{schema:1,config:object::id(c),snapshot_revision:c.revision,platform:c.recipient,
        control_fee_bps:250,equipment_fee_bps:250,control_royalty_bps,creator:ctx.sender()}
}
public fun market_policy_hash(p:&MarketPolicy):vector<u8>{hash::sha2_256(bcs::to_bytes(p))}
public fun market_creator(p:&MarketPolicy):address{p.creator}
public fun market_platform(p:&MarketPolicy):address{p.platform}
public fun market_revision(p:&MarketPolicy):u64{p.snapshot_revision}
public fun market_config(p:&MarketPolicy):ID{p.config}
public fun control_royalty_bps(p:&MarketPolicy):u16{p.control_royalty_bps}
public fun control_fee_bps(p:&MarketPolicy):u16{p.control_fee_bps}
public fun equipment_fee_bps(p:&MarketPolicy):u16{p.equipment_fee_bps}
/// CONTROL=0; EQUIPMENT=1. Original AC internal markets require every
/// nonzero share to produce at least one atomic unit and a positive seller net.
public fun market_quote<C>(p:&MarketPolicy,c:&Config<C>,lane:u8,gross:u64,seller:address):MarketReceipt {
    assert_secondary(c);
    assert!(p.config==object::id(c) && lane<=1,EPolicy);assert!(gross>0 && seller!=@0x0,EPayment);
    let platform_bps=if(lane==0)p.control_fee_bps else p.equipment_fee_bps;
    let creator_bps=if(lane==0)p.control_royalty_bps else 0;
    let platform_amount=strict_share(gross,platform_bps);let creator_amount=strict_share(gross,creator_bps);
    let distributed=(platform_amount as u128)+(creator_amount as u128);
    assert!(distributed < (gross as u128),EPayment);
    MarketReceipt{lane,config:p.config,operational_revision:c.revision,policy:*p,gross,
        seller_amount:gross-(distributed as u64),platform_amount,creator_amount,seller}
}
public fun strict_share(gross:u64,bps:u16):u64{assert!(bps<=10000,EPolicy);let amount=fee(gross,bps);assert!(bps==0 || amount>0,EShare);amount}
public fun market_settle<C,W:drop,R:drop>(c:&mut Config<C>,w:W,r_marker:R,r:MarketReceipt,mut payment:Coin<C>,subject:ID,attempt:vector<u8>,ctx:&mut TxContext) {
    assert_business<C,W,R>(c,3,w,r_marker);
    assert_enabled(c);assert!(r.config==object::id(c) && r.operational_revision==c.revision,EPolicy);assert!(coin::value(&payment)==r.gross,EPayment);
    if(r.platform_amount>0)deposit_income(c,coin::split(&mut payment,r.platform_amount,ctx));
    if(r.creator_amount>0)transfer::public_transfer(coin::split(&mut payment,r.creator_amount,ctx),r.policy.creator);
    assert!(coin::value(&payment)==r.seller_amount && r.seller_amount>0,EPayment);transfer::public_transfer(payment,r.seller);
    event::emit(MarketSettled{subject,attempt,payer:ctx.sender(),receipt:r})
}
public fun market_receipt_lane(r:&MarketReceipt):u8{r.lane}
public fun market_receipt_gross(r:&MarketReceipt):u64{r.gross}
public fun market_receipt_seller_amount(r:&MarketReceipt):u64{r.seller_amount}
public fun market_receipt_platform_amount(r:&MarketReceipt):u64{r.platform_amount}
public fun market_receipt_creator_amount(r:&MarketReceipt):u64{r.creator_amount}
public fun market_receipt_seller(r:&MarketReceipt):address{r.seller}
public fun market_receipt_policy(r:&MarketReceipt):MarketPolicy{r.policy}
public fun market_receipt_revision(r:&MarketReceipt):u64{r.operational_revision}
public struct Paid has copy,drop { subject:ID,attempt:vector<u8>,payer:address,gross:u64,fee:u64,beneficiary:address }

public fun create<C>(_authority:&Authority,primary_bps:u16,secondary_bps:u16,complete_fee:u64,recipient:address,ctx:&mut TxContext):ID {
    let (config,admin)=new_config<C>(primary_bps,secondary_bps,complete_fee,recipient,ctx);let id=object::id(&config);transfer::public_transfer(admin,ctx.sender());transfer::share_object(config);id
}
public(package) fun new_config<C>(primary_bps:u16,secondary_bps:u16,complete_fee:u64,recipient:address,ctx:&mut TxContext):(Config<C>,Admin) {
    assert!(primary_bps<=10000 && secondary_bps<=10000 && recipient!=@0x0,EPolicy);
    let uid=object::new(ctx);let income=revenue::new<C>(&uid,ctx);
    let mut config=Config<C>{id:uid,revision:0,primary_bps,secondary_bps,complete_fee,recipient,paused:false,income,schema:3,enabled:false,payment_coin:type_name::with_original_ids<C>(),original_package:current_original_package(),callable_package:current_callable_package(),commitment:vector[],native_binding:option::none(),release_binding:option::none(),minimum_release:current_release(),roles:package_roles::initial(current_original_package(),current_callable_package())};
    refresh_commitment(&mut config);
    let id=object::id(&config);(config,Admin{id:object::new(ctx),config:id})
}
public(package) fun share_config<C>(c:Config<C>,a:Admin,ctx:&TxContext):ID{assert_admin(&c,&a);let id=object::id(&c);transfer::public_transfer(a,ctx.sender());transfer::share_object(c);id}
public struct ManufacturingCreatorKey has copy,drop,store {}
public struct ManufacturingCreator has copy,drop,store {creator:address}
/// Only allocates a fresh Config. There is no old Config, Product or ledger
/// input to rebind or reset. Both real business markers are supplied by Maker.
public fun new_manufacturing_instance<C,WR:drop,RR:drop,WC:drop,RC:drop>(release:&RoleCertificate<WR,RR>,creator:&RoleCertificate<WC,RC>,wr:WR,rr:RR,wc:WC,rc:RC,primary:u16,secondary:u16,fixed:u64,recipient:address,ctx:&mut TxContext):(Config<C>,Admin){
    let mut roles=package_roles::initial(current_original_package(),current_callable_package());
    package_roles::register_from_certificate(&mut roles,1,wr,rr,release);
    package_roles::register_from_certificate(&mut roles,2,wc,rc,creator);
    let(mut cfg,admin)=new_config<C>(primary,secondary,fixed,recipient,ctx);
    cfg.roles=roles;df::add(&mut cfg.id,ManufacturingCreatorKey{},ManufacturingCreator{creator:ctx.sender()});refresh_commitment(&mut cfg);(cfg,admin)
}
public fun manufacturing_creator<C>(c:&Config<C>):address{df::borrow<ManufacturingCreatorKey,ManufacturingCreator>(&c.id,ManufacturingCreatorKey{}).creator}
/// Consumes the actual bound pair, shares Config in its defining module, and
/// transfers Admin to the creator of this fresh instance.
public fun finalize_manufacturing_instance<C>(c:Config<C>,a:Admin,ctx:&TxContext):ID {
    assert!(manufacturing_creator(&c)==ctx.sender(),EPolicy);share_config(c,a,ctx)
}
public fun configure<C>(c:&mut Config<C>,admin:&mut Admin,expected:u64,primary:u16,secondary:u16,fixed:u64,recipient:address,paused:bool) {
    assert_admin(c,admin);assert_recovery_identity(c);if(!paused)assert_current_package(c);
    assert!(c.revision==expected && primary<=10000 && secondary<=10000 && recipient!=@0x0,EPolicy);
    c.primary_bps=primary;c.secondary_bps=secondary;c.complete_fee=fixed;c.recipient=recipient;c.paused=paused;c.revision=c.revision+1;
    refresh_commitment(c)
}
public fun snapshot<C>(c:&Config<C>):ConfigSnapshot{ConfigSnapshot{domain:b"soulidity-protocol-config-v3",schema:c.schema,config:object::id(c),revision:c.revision,enabled:c.enabled,paused:c.paused,payment_coin:c.payment_coin,original_package:c.original_package,callable_package:c.callable_package,income_root:revenue::root(&c.income),primary_bps:c.primary_bps,secondary_bps:c.secondary_bps,complete_fee:c.complete_fee,recipient:c.recipient,native_binding:c.native_binding,release_binding:c.release_binding,minimum_release:c.minimum_release,roles:c.roles}}
public fun snapshot_hash(s:&ConfigSnapshot):vector<u8>{hash::sha2_256(bcs::to_bytes(s))}
public fun commitment<C>(c:&Config<C>):vector<u8>{c.commitment}
public fun enabled<C>(c:&Config<C>):bool{c.enabled}
public fun paused<C>(c:&Config<C>):bool{c.paused}
public fun payment_coin<C>(c:&Config<C>):TypeName{c.payment_coin}
public fun original_package<C>(c:&Config<C>):ID{c.original_package}
public fun callable_package<C>(c:&Config<C>):ID{c.callable_package}
public fun current_original_package():ID{object::id_from_address(type_name::original_id<Authority>())}
public fun current_callable_package():ID{object::id_from_address(type_name::defining_id<ProtocolRevision2>())}
public fun operational_snapshot<C>(c:&Config<C>):OperationalSnapshot{assert!(df::exists_(&c.id,MarketGatesKey{}),EPolicy);OperationalSnapshot{domain:b"soulidity-protocol-operational-v4",config:snapshot(c),gates:*df::borrow(&c.id,MarketGatesKey{})}}
public fun operational_snapshot_hash(s:&OperationalSnapshot):vector<u8>{hash::sha2_256(bcs::to_bytes(s))}
fun refresh_commitment<C>(c:&mut Config<C>){
    if(!df::exists_(&c.id,MarketGatesKey{}))df::add(&mut c.id,MarketGatesKey{},MarketGates{primary:false,secondary:false});
    c.commitment=operational_snapshot_hash(&operational_snapshot(c));
    event::emit(OperationalConfigurationChanged{snapshot:operational_snapshot(c),commitment:c.commitment})
}
fun assert_admin<C>(c:&Config<C>,a:&Admin){assert!(a.config==object::id(c),EPolicy)}
/// Exits do not depend on an old quote, pause, enable or callable marker. They
/// retain actual root, Coin, original package and schema integrity checks.
public fun assert_recovery_identity<C>(c:&Config<C>){
    assert!(c.schema==3 && c.original_package==current_original_package() && c.payment_coin==type_name::with_original_ids<C>(),EPolicy);
    let income_root=revenue::root(&c.income);
    let config=object::id(c);
    assert!(income_root==config,EPolicy);
    let has_gates=df::exists_(&c.id,MarketGatesKey{});
    // These immutable IDs were validated above in this same call. All snapshot
    // fields, domains and the fresh full BCS commitment remain identical.
    let value=ConfigSnapshot{domain:b"soulidity-protocol-config-v3",schema:c.schema,config,revision:c.revision,enabled:c.enabled,paused:c.paused,payment_coin:c.payment_coin,original_package:c.original_package,callable_package:c.callable_package,income_root,primary_bps:c.primary_bps,secondary_bps:c.secondary_bps,complete_fee:c.complete_fee,recipient:c.recipient,native_binding:c.native_binding,release_binding:c.release_binding,minimum_release:c.minimum_release,roles:c.roles};
    let expected=if(has_gates)operational_snapshot_hash(&OperationalSnapshot{domain:b"soulidity-protocol-operational-v4",config:value,gates:*df::borrow(&c.id,MarketGatesKey{})}) else snapshot_hash(&value);
    assert!(c.commitment==expected,EPolicy)
}
public fun current_release():u64{2}
public fun minimum_release<C>(c:&Config<C>):u64{c.minimum_release}
fun assert_current_package<C>(c:&Config<C>){assert!(c.callable_package==current_callable_package() && c.minimum_release<=current_release(),EPolicy)}
public fun assert_exact_snapshot<C>(c:&Config<C>,expected_config:ID,expected_revision:u64,expected_commitment:vector<u8>){assert_enabled(c);assert!(object::id(c)==expected_config && c.revision==expected_revision && c.commitment==expected_commitment,EPolicy)}
/// Disable remains available after callable drift, so a stale release cannot
/// trap the emergency stop or settled funds. Enabling requires current identity.
public fun set_enabled<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,enabled:bool){
    assert_admin(c,a);assert_recovery_identity(c);assert!(c.revision==expected && c.commitment==expected_commitment && c.enabled!=enabled,EPolicy);
    if(enabled){assert_current_package(c);assert_native_current(c);assert!(!c.paused,EPolicy)};c.enabled=enabled;c.revision=c.revision+1;refresh_commitment(c)
}
/// Rebinding is an explicit Admin transition while disabled. It preserves the
/// same root, funds, Coin and previously published economic rights.
public fun rebind_current_package<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>){
    assert_admin(c,a);assert_recovery_identity(c);assert!(!c.enabled && c.revision==expected && c.commitment==expected_commitment && c.callable_package!=current_callable_package(),EPolicy);
    assert!(c.minimum_release<=current_release(),EPolicy);
    c.callable_package=current_callable_package();c.revision=c.revision+1;refresh_commitment(c)
}
#[test_only]
public fun drift_callable_for_testing<C>(c:&mut Config<C>){c.callable_package=object::id_from_address(@0x99);refresh_commitment(c)}
#[test_only]
public fun raise_minimum_for_testing<C>(c:&mut Config<C>,minimum:u64){assert!(minimum>c.minimum_release,EPolicy);c.minimum_release=minimum;refresh_commitment(c)}
public fun revision<C>(c:&Config<C>):u64 {c.revision}
public fun complete_fee<C>(c:&Config<C>):u64 {c.complete_fee}
public fun fee(amount:u64,bps:u16):u64 { (((amount as u128)*(bps as u128)/10000) as u64) }
public fun assert_live<C>(c:&Config<C>,expected:u64,expiry:u64,clock:&Clock) {
    assert_enabled(c);assert_live_fields(c,expected,expiry,clock)
}
/// Only used after the same actual Config has already passed full authority
/// validation in this local call, before settlement mutates its income ledger.
fun assert_live_fields<C>(c:&Config<C>,expected:u64,expiry:u64,clock:&Clock){
    assert!(c.revision==expected,EPolicy);
    assert!(clock::timestamp_ms(clock)<=expiry,EExpired);
}
public fun assert_primary_live<C>(c:&Config<C>,expected:u64,expiry:u64,clock:&Clock){assert_live(c,expected,expiry,clock);assert!(primary_enabled(c),EPolicy)}
public fun assert_secondary_live<C>(c:&Config<C>,expected:u64,expiry:u64,clock:&Clock){assert_live(c,expected,expiry,clock);assert!(secondary_enabled(c),EPolicy)}
public fun assert_primary_snapshot<C>(c:&Config<C>,expected_config:ID,expected_revision:u64,expected_commitment:vector<u8>){assert_exact_snapshot(c,expected_config,expected_revision,expected_commitment);assert!(primary_enabled(c),EPolicy)}
public fun primary_fee<C>(c:&Config<C>,amount:u64):u64{fee(amount,c.primary_bps)}
public fun primary_bps<C>(c:&Config<C>):u16{c.primary_bps}
/// Paid content uses the original owner ask plus an additional primary fee.
public fun primary_total<C>(c:&Config<C>,ask:u64):u64 {
    let total=(ask as u128)+(fee(ask,c.primary_bps) as u128);
    assert!(total<=18446744073709551615,EPolicy);total as u64
}
public fun primary_additional<C,W:drop,R:drop>(c:&mut Config<C>,w:W,r_marker:R,mut payment:Coin<C>,ask:u64,beneficiary:address,subject:ID,attempt:vector<u8>,ctx:&mut TxContext) {
    assert_business<C,W,R>(c,5,w,r_marker);
    let total=primary_total(c,ask);assert!(beneficiary!=@0x0 && coin::value(&payment)==total,EPayment);
    let cut=fee(ask,c.primary_bps);
    if(cut>0)deposit_income(c,coin::split(&mut payment,cut,ctx));
    event::emit(Paid{subject,attempt,payer:ctx.sender(),gross:total,fee:cut,beneficiary});
    assert!(coin::value(&payment)==ask,EPayment);
    if(ask==0)coin::destroy_zero(payment) else transfer::public_transfer(payment,beneficiary)
}
public fun secondary_bps<C>(c:&Config<C>):u16{c.secondary_bps}
public fun recipient<C>(c:&Config<C>):address{c.recipient}
public fun income<C>(c:&Config<C>):&Ledger<C>{&c.income}
public fun assert_enabled<C>(c:&Config<C>){assert_recovery_identity(c);assert_enabled_after_recovery(c)}
/// Private continuation after a fresh integrity check in this immutable call.
fun assert_enabled_after_recovery<C>(c:&Config<C>){assert_current_package(c);assert_native_current(c);assert!(c.enabled && !c.paused && df::exists_(&c.id,MarketGatesKey{}),EPolicy)}
/// Same-call role-first Native live validation; no reusable validation token.
public fun assert_role_primary_live<C,W,R>(c:&Config<C>,kind:u8,expected:u64,expiry:u64,clock:&Clock){
    assert_role_types<C,W,R>(c,kind);assert_enabled_after_recovery(c);assert_live_fields(c,expected,expiry,clock);assert!(primary_enabled(c),EPolicy)
}
/// Same-call role-first Native exact snapshot validation, including Primary.
public fun assert_role_primary_snapshot<C,W,R>(c:&Config<C>,kind:u8,config:ID,expected:u64,commitment:vector<u8>){
    assert_role_types<C,W,R>(c,kind);assert_enabled_after_recovery(c);assert!(object::id(c)==config && c.revision==expected && c.commitment==commitment,EPolicy);assert!(primary_enabled(c),EPolicy)
}
public fun primary_enabled<C>(c:&Config<C>):bool{df::exists_(&c.id,MarketGatesKey{}) && df::borrow<MarketGatesKey,MarketGates>(&c.id,MarketGatesKey{}).primary}
public fun secondary_enabled<C>(c:&Config<C>):bool{df::exists_(&c.id,MarketGatesKey{}) && df::borrow<MarketGatesKey,MarketGates>(&c.id,MarketGatesKey{}).secondary}
public fun assert_primary<C>(c:&Config<C>){assert_enabled(c);assert!(primary_enabled(c),EPolicy)}
public fun assert_secondary<C>(c:&Config<C>){assert_enabled(c);assert!(secondary_enabled(c),EPolicy)}
public fun set_primary_enabled<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,enabled:bool){set_gate(c,a,expected,expected_commitment,true,enabled)}
public fun set_secondary_enabled<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,enabled:bool){set_gate(c,a,expected,expected_commitment,false,enabled)}
fun set_gate<C>(c:&mut Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>,primary:bool,enabled:bool){
    assert_admin(c,a);assert_recovery_identity(c);assert_current_package(c);
    assert!(c.revision==expected && c.commitment==expected_commitment && df::exists_(&c.id,MarketGatesKey{}),EPolicy);
    let gates: &mut MarketGates=df::borrow_mut(&mut c.id,MarketGatesKey{});
    if(primary)gates.primary=enabled else gates.secondary=enabled;
    c.revision=c.revision+1;refresh_commitment(c)
}
public fun native_snapshot<C>(c:&Config<C>):Option<NativeBindingSnapshot>{c.native_binding}
public fun native_catalog(s:&NativeBindingSnapshot):ID{s.catalog}
public fun native_generation(s:&NativeBindingSnapshot):u64{s.generation}
public fun native_commitment(s:&NativeBindingSnapshot):vector<u8>{s.commitment}
public fun is_nonzero_hash(value:&vector<u8>):bool{value.length()==32 && value.any!(|byte|byte!=0)}
public fun native_object<C,T:key+store>(c:&Config<C>):&T{dof::borrow(&c.id,NativeBindingKey{})}
public fun native_history<C,T:key+store>(c:&Config<C>,generation:u64):&T{dof::borrow(&c.id,NativeBindingHistoryKey{generation})}
public fun assert_install_admin<C>(c:&Config<C>,a:&mut Admin,expected:u64,expected_commitment:vector<u8>){assert_admin(c,a);assert_recovery_identity(c);assert!(!c.enabled && c.revision==expected && c.commitment==expected_commitment,EPolicy)}
/// Register an actual producer-owned registry, never export Config's UID.
/// Real Admin installs the private same-module producer while disabled. The
/// singleton locator cannot be replaced or cleared if the registry disappears.
public fun register_source_registry<C,W:drop,T:key>(c:&mut Config<C>,a:&mut Admin,w:W,source:&T,expected:u64,expected_commitment:vector<u8>):ID{
    assert_install_admin(c,a,expected,expected_commitment);assert_current_package(c);let _=w;
    let witness=type_name::with_original_ids<W>();let registry=type_name::with_original_ids<T>();
    assert!(!witness.is_primitive() && !registry.is_primitive() && witness.address_string()==registry.address_string() && witness.module_string()==registry.module_string() && *witness.datatype_string().as_bytes()==b"SoulProducer",EPolicy);
    let key=SourceRegistryKey<T>{};assert!(!df::exists_(&c.id,key),EPolicy);
    let id=object::id(source);df::add(&mut c.id,key,SourceRegistryLocation{id});c.revision=c.revision+1;refresh_commitment(c);id
}
/// Immutable producer-directory discovery, independently checked against the
/// actual Config. The ordinary fee snapshot does not certify this directory.
public fun source_registry_id<C,T:key>(c:&Config<C>):ID{df::borrow<SourceRegistryKey<T>,SourceRegistryLocation>(&c.id,SourceRegistryKey<T>{}).id}
public fun source_revision<C,T:key>(c:&Config<C>):Option<SourceRevision>{
    let key=SourceRevisionKey<T>{};if(df::exists_with_type<SourceRevisionKey<T>,SourceRevision>(&c.id,key))option::some(*df::borrow(&c.id,key)) else option::none()
}
/// Real Admin, disabled Config, CAS, actual directory, Publisher and UpgradeCap
/// are all required. Old revision markers cannot be selected again.
public fun register_source_revision<C,W:drop,R:drop,T:key>(c:&mut Config<C>,a:&mut Admin,w:W,r:R,source:&T,p:&Publisher,cap:&UpgradeCap,expected:u64,expected_commitment:vector<u8>){
    assert_install_admin(c,a,expected,expected_commitment);assert_current_package(c);
    assert!(object::id(source)==source_registry_id<C,T>(c),EPolicy);
    let value=source_authority::advance<W,R,T>(source_revision<C,T>(c),w,r,p,cap);
    set_source_revision<C,T>(c,source,value)
}
fun set_source_revision<C,T:key>(c:&mut Config<C>,source:&T,value:SourceRevision){
    let key=SourceRevisionKey<T>{};if(df::exists_with_type<SourceRevisionKey<T>,SourceRevision>(&c.id,key))*df::borrow_mut(&mut c.id,key)=value else df::add(&mut c.id,key,value);
    c.revision=c.revision+1;refresh_commitment(c);event::emit(SourceRevisionChanged{config:object::id(c),registry:object::id(source),revision:c.revision,source:value,commitment:c.commitment})
}
public fun assert_source_revision<C,W,R,T:key>(c:&Config<C>){
    assert_recovery_identity(c);let value=source_revision<C,T>(c);assert!(value.is_some(),EPolicy);source_authority::assert_types<W,R,T>(value.borrow())
}
#[test_only]
public fun source_revision_for_testing<C,W:drop,R:drop,T:key>(c:&mut Config<C>,a:&mut Admin,_w:W,_r:R,source:&T,expected:u64,hash:vector<u8>,version:u64){
    assert_install_admin(c,a,expected,hash);assert_current_package(c);assert!(object::id(source)==source_registry_id<C,T>(c),EPolicy);
    let value=source_authority::model_for_testing<W,R,T>(version);let old=source_revision<C,T>(c);
    if(old.is_some())assert!(source_authority::original(old.borrow())==source_authority::original(&value) && source_authority::marker(old.borrow())!=source_authority::marker(&value) && version>source_authority::version(old.borrow()),EPolicy);
    set_source_revision<C,T>(c,source,value)
}
public fun install_native<C,T:key+store>(c:&mut Config<C>,a:&mut Admin,permit:Installation<C,T>,binding:T,generation:u64,commitment:vector<u8>){
    let(original,callable,marker)=consume_installation(c,a,permit,0,&binding,generation,&commitment);
    install_native_value(c,binding,generation,original,callable,marker,commitment);c.revision=c.revision+1;refresh_commitment(c)
}
fun install_native_value<C,T:key+store>(c:&mut Config<C>,binding:T,generation:u64,original:ID,callable:ID,marker:TypeName,commitment:vector<u8>){
    package_roles::assert_identity(&c.roles,0,original,callable);
    assert!(!c.enabled && c.minimum_release<=current_release() && is_nonzero_hash(&commitment),EPolicy);
    package_roles::pin(&mut c.roles,0,marker);
    c.minimum_release=current_release();
    let id=object::id(&binding);if(c.native_binding.is_none())assert!(generation==0,EPolicy) else {
        let old=c.native_binding.destroy_some();assert!(generation==old.generation+1,EPolicy);let prior:T=dof::remove(&mut c.id,NativeBindingKey{});assert!(object::id(&prior)==old.catalog,EPolicy);dof::add(&mut c.id,NativeBindingHistoryKey{generation:old.generation},prior)
    };
    dof::add(&mut c.id,NativeBindingKey{},binding);c.native_binding=option::some(NativeBindingSnapshot{catalog:id,generation,original_package:original,callable_package:callable,commitment});refresh_commitment(c)
}
#[test_only]
public fun install_native_initial_for_testing<C,T:key+store>(c:&mut Config<C>,a:&mut Admin,permit:Installation<C,T>,binding:T,commitment:vector<u8>){
    let(original,callable,marker)=consume_installation(c,a,permit,0,&binding,0,&commitment);assert!(c.revision==0 && c.native_binding.is_none(),EPolicy);
    install_native_value(c,binding,0,original,callable,marker,commitment)
}
fun assert_native_current<C>(c:&Config<C>){assert!(c.native_binding.is_some() && dof::exists_(&c.id,NativeBindingKey{}),EPolicy);let n=c.native_binding.borrow();package_roles::assert_identity(&c.roles,0,n.original_package,n.callable_package);assert!(is_nonzero_hash(&n.commitment),EPolicy)}
#[test_only]
public fun enable_initial_for_testing<C>(c:&mut Config<C>){assert!(c.revision==0 && !c.enabled,EPolicy);assert_native_current(c);package_roles::pin_business_bootstrap_for_testing(&mut c.roles);let gates:&mut MarketGates=df::borrow_mut(&mut c.id,MarketGatesKey{});gates.primary=true;gates.secondary=true;c.enabled=true;refresh_commitment(c)}
public fun deposit_income<C>(c:&mut Config<C>,payment:Coin<C>){assert_enabled(c);assert!(coin::value(&payment)>0,EPayment);revenue::deposit(&c.id,&mut c.income,payment)}
/// Exit never depends on operational pause or current pricing revision.
public fun withdraw_income<C>(c:&mut Config<C>,admin:&mut Admin,expected:u64,amount:u64,recipient:address,attempt:vector<u8>,ctx:&mut TxContext){
    assert_admin(c,admin);assert_recovery_identity(c);revenue::withdraw(&c.id,&mut c.income,expected,amount,recipient,attempt,ctx)
}
/// Original CollectionRight price is the seller ask; platform fee is additional.
/// Preserve the original per-component ceil rule, separate from gross-price fees.
fun right_fee(amount:u64,bps:u16):u64{let n=(amount as u128)*(bps as u128);(((n+9999)/10000) as u64)}
public fun right_total<C>(c:&Config<C>,ask:u64):u64 {
    let total=(ask as u128)+(right_fee(ask,c.secondary_bps) as u128);assert!(total<=18446744073709551615,EPolicy);total as u64
}
public fun right_sale<C,W:drop,R:drop>(c:&mut Config<C>,w:W,r_marker:R,mut payment:Coin<C>,ask:u64,seller:address,subject:ID,attempt:vector<u8>,ctx:&mut TxContext) {
    assert_business<C,W,R>(c,4,w,r_marker);
    assert!(seller!=@0x0 && coin::value(&payment)==right_total(c,ask),EPayment);let fee=right_fee(ask,c.secondary_bps);
    if(fee>0)deposit_income(c,coin::split(&mut payment,fee,ctx));
    event::emit(Paid{subject,attempt,payer:ctx.sender(),gross:ask+fee,fee,beneficiary:seller});transfer::public_transfer(payment,seller)
}

public struct ReleaseBindingKey has copy,drop,store {}
public struct ReleaseHistoryKey has copy,drop,store {generation:u64}
public struct ReleaseBindingSnapshot has copy,drop,store {catalog:ID,generation:u64,original_package:ID,callable_package:ID,marker:TypeName,commitment:vector<u8>}
public fun release_snapshot<C>(c:&Config<C>):Option<ReleaseBindingSnapshot>{c.release_binding}
public fun release_catalog(s:&ReleaseBindingSnapshot):ID{s.catalog}
public fun release_generation(s:&ReleaseBindingSnapshot):u64{s.generation}
public fun release_commitment(s:&ReleaseBindingSnapshot):vector<u8>{s.commitment}
public fun release_object<C,T:key+store>(c:&Config<C>):&T{dof::borrow(&c.id,ReleaseBindingKey{})}
public fun release_history<C,T:key+store>(c:&Config<C>,generation:u64):&T{dof::borrow(&c.id,ReleaseHistoryKey{generation})}
public fun install_release<C,T:key+store>(c:&mut Config<C>,a:&mut Admin,permit:Installation<C,T>,value:T,generation:u64,commitment:vector<u8>){
    assert_native_current(c);
    install_manufacturing_release(c,a,permit,value,generation,commitment)
}
/// Explicit same-Config manufacturing installation. No native role or locator fallback.
public fun install_manufacturing_release<C,T:key+store>(c:&mut Config<C>,a:&mut Admin,permit:Installation<C,T>,value:T,generation:u64,commitment:vector<u8>){
    let(original,callable,marker)=consume_installation(c,a,permit,1,&value,generation,&commitment);
    package_roles::pin(&mut c.roles,1,marker);
    assert!(!c.enabled && is_nonzero_hash(&commitment),EPolicy);assert_current_package(c);
    let id=object::id(&value);if(c.release_binding.is_none())assert!(generation==0,EPolicy) else {
        let old=c.release_binding.destroy_some();assert!(generation==old.generation+1,EPolicy);let prior:T=dof::remove(&mut c.id,ReleaseBindingKey{});assert!(object::id(&prior)==old.catalog,EPolicy);dof::add(&mut c.id,ReleaseHistoryKey{generation:old.generation},prior)
    };dof::add(&mut c.id,ReleaseBindingKey{},value);c.release_binding=option::some(ReleaseBindingSnapshot{catalog:id,generation,original_package:original,callable_package:callable,marker,commitment});c.revision=c.revision+1;refresh_commitment(c)
}

/// Unit fixture only: Core is one application package with synthetic dependency addresses.
/// Production has no such shortcut; each application role registers Publisher/Cap.
#[test_only]
public fun bootstrap_application_for_testing<C,W:drop,R:drop>(c:&mut Config<C>,a:&mut Admin,_w:W,_r:R){
    assert_admin(c,a);assert_recovery_identity(c);assert!(!c.enabled && c.revision==0 && c.native_binding.is_none() && c.release_binding.is_none(),EPolicy);
    let state=package_roles::initial(object::id_from_address(type_name::original_id<W>()),object::id_from_address(type_name::defining_id<R>()));package_roles::assert_types<W,R>(&state,0);c.roles=state;refresh_commitment(c)
}

#[test_only]
public fun bootstrap_role_for_testing<C,W:drop,R:drop>(c:&mut Config<C>,a:&mut Admin,kind:u8,_w:W,_r:R){assert_admin(c,a);assert!(c.revision==0 && !c.enabled,EPolicy);package_roles::initial_role_for_testing<W,R>(&mut c.roles,kind);refresh_commitment(c)}

/// The global stop/integrity authority shared by both Native and manufacture.
public fun assert_operation<C>(c:&Config<C>){assert_recovery_identity(c);assert_current_package(c);assert!(c.enabled && !c.paused && df::exists_(&c.id,MarketGatesKey{}),EPolicy)}
/// Manufacturing uses fixed roles1+2 and the one release directory.
public fun assert_manufacturing_enabled<C>(c:&Config<C>){assert_operation(c);assert!(c.release_binding.is_some() && dof::exists_(&c.id,ReleaseBindingKey{}) && package_roles::pinned(&role(c,1)) && package_roles::pinned(&role(c,2)),EPolicy);let release=c.release_binding.borrow();package_roles::assert_identity(&c.roles,1,release.original_package,release.callable_package);assert!(package_roles::marker(&role(c,1))==option::some(release.marker) && is_nonzero_hash(&release.commitment),EPolicy)}
public fun assert_manufacturing_primary<C>(c:&Config<C>){assert_manufacturing_enabled(c);assert!(primary_enabled(c),EPolicy)}
public fun assert_manufacturing_live<C>(c:&Config<C>,expected:u64,expiry:u64,clock:&Clock){assert_manufacturing_primary(c);assert!(c.revision==expected,EPolicy);assert!(clock::timestamp_ms(clock)<=expiry,EExpired)}
public fun assert_manufacturing_snapshot<C>(c:&Config<C>,config:ID,expected:u64,commitment:vector<u8>){assert_manufacturing_primary(c);assert!(object::id(c)==config && c.revision==expected && c.commitment==commitment,EPolicy)}
public fun assert_manufacturing_business<C,W:drop,R:drop>(c:&Config<C>,_w:W,_r:R){assert_manufacturing_primary(c);package_roles::assert_types<W,R>(&c.roles,2)}
public fun manufacturing_primary_policy<C>(c:&Config<C>):PrimaryPolicy{assert_manufacturing_primary(c);primary_policy_value(c)}
public fun manufacturing_market_policy<C>(c:&Config<C>,bps:u16,ctx:&TxContext):MarketPolicy{assert_manufacturing_enabled(c);market_policy_value(c,bps,ctx)}
public fun manufacturing_primary_quote<C>(p:&PrimaryPolicy,c:&Config<C>,gross:u64,fixed:bool,beneficiary:address,subject:ID,commitment:vector<u8>,actor:address,attempt:vector<u8>,expiry:u64):PrimaryReceipt{assert_manufacturing_primary(c);primary_quote_value(p,c,gross,fixed,beneficiary,subject,commitment,actor,attempt,expiry)}
public fun collect_manufacturing_primary<C,W:drop,R:drop>(c:&mut Config<C>,w:W,r_marker:R,r:PrimaryReceipt,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):Coin<C>{assert_manufacturing_business(c,w,r_marker);assert_live_fields(c,r.operational_revision,r.expiry,clock);collect_primary_value(c,r,payment,ctx)}
/// Disabled Admin/CAS and both actual private role markers are required. The
/// Maker caller also validates its actual catalog and actual Walrus System.
public struct ManufacturingActivation {config:ID,revision:u64,commitment:vector<u8>,original:ID,callable:ID}
public fun authorize_manufacturing_activation<C,W:drop,R:drop>(c:&Config<C>,a:&mut Admin,expected:u64,commitment:vector<u8>,_w:W,_r:R):ManufacturingActivation{assert_install_admin(c,a,expected,commitment);assert_current_package(c);package_roles::assert_types<W,R>(&c.roles,2);assert!(package_roles::pinned(&role(c,2)),EPolicy);ManufacturingActivation{config:object::id(c),revision:expected,commitment,original:object::id_from_address(type_name::original_id<W>()),callable:object::id_from_address(type_name::defining_id<R>())}}
public fun activate_manufacturing_identity<C,W1:drop,R1:drop>(c:&mut Config<C>,a:&mut Admin,expected:u64,commitment:vector<u8>,_w1:W1,_r1:R1,authorization:ManufacturingActivation,catalog:ID){
 let ManufacturingActivation{config,revision,commitment:bound,original,callable}=authorization;assert_install_admin(c,a,expected,commitment);assert_current_package(c);assert!(!c.paused && df::exists_(&c.id,MarketGatesKey{}),EPolicy);package_roles::assert_types<W1,R1>(&c.roles,1);package_roles::assert_identity(&c.roles,2,original,callable);assert!(config==object::id(c) && revision==expected && bound==commitment && package_roles::pinned(&role(c,1)) && package_roles::pinned(&role(c,2)) && c.release_binding.is_some() && dof::exists_(&c.id,ReleaseBindingKey{}) && catalog==c.release_binding.borrow().catalog,EPolicy);c.enabled=true;c.revision=c.revision+1;refresh_commitment(c)
}

/// Fixture only: synthetic initial role registration, never production Publisher/Cap proof.
#[test_only]
public fun pin_initial_role_for_testing<C,W:drop,R:drop>(c:&mut Config<C>,a:&mut Admin,kind:u8,_w:W,_r:R){assert_admin(c,a);assert!(c.revision==0 && !c.enabled,EPolicy);package_roles::initial_role_for_testing<W,R>(&mut c.roles,kind);package_roles::pin(&mut c.roles,kind,type_name::with_defining_ids<R>());refresh_commitment(c)}
