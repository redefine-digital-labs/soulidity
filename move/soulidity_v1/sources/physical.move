/// Material-product assets use controlled transfer/consume. OC component rights stay separate.
module soulidity_v1::physical;
use std::bcs;
use soulidity_maker_terms::maker_physical_metadata::{Self as physical_metadata,Proof,Registration,SalePolicy,Snapshot,SaleReceipt};
use sui::table::{Self,Table};
use sui::coin::{Self,Coin};
use sui::clock::{Self,Clock};
use sui::event;
use walrus::system::System;
use soulidity_maker_manufacturing::maker_factory as factory;
use sui::dynamic_object_field as dof;
use soulidity_application::visual_capture::{Self,Capture};
use sui::transfer::Receiving;
use soulidity_maker_manufacturing::maker_catalog::{Product,Control};
use soulidity_maker_manufacturing::maker_catalog as catalog;
use soulidity_model::policy::{Self,Source};
use soulidity_model::material_policy::{Self,Terms};
use soulidity_foundation::economics::{Self,Config,MarketPolicy,PrimaryReceipt};
use soulidity_maker_terms::maker_resale::Rates;
use soulidity_maker_manufacturing::maker_player::{Player};
use soulidity_v1::player;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::Soul;
use soulidity_application::output;
use soulidity_model::assembly::{Self,PartKey};
use soulidity_transport::storage_transport as storage;
const EBinding:u64=1;const EPolicy:u64=2;const ERevision:u64=3;const EReplay:u64=4;
const ESupply:u64=5;const EOwner:u64=6;const EPayment:u64=7;const ESelection:u64=8;
const ETransfer:u64=9;const EState:u64=10;const EQuote:u64=11;
/// Private producer; never return a value through a public function.
public struct CaptureProducer has drop {}
public struct PhysicalProducer has drop {}
public struct PhysicalRevision1 has drop {}
public(package) fun physical_producer():PhysicalProducer{PhysicalProducer{}}
public(package) fun physical_revision():PhysicalRevision1{PhysicalRevision1{}}
public struct Registry<phantom C> has key {id:UID,protocol:ID,maker:ID,version:u64,policy_hash:vector<u8>,creator:address,rates:Rates,market:MarketPolicy,revision:u64,keys:vector<vector<u8>>,rules:Table<vector<u8>,Rule>,authorizations:Table<vector<u8>,ID>,requests:Table<Request,ID>,payments:Table<Request,PrimaryReceipt>,stats:Stats}
public struct Rule has copy,drop,store {source:Source,terms:Terms,sale:SalePolicy,registration:Registration,row_hash:vector<u8>,issued:u64,consumed:u64}
public struct Stats has copy,drop,store {issued:u64,free:u64,paid:u64,materialized:u64,consumed:u64,gross:u128,platform:u128,maker:u128,pack:u128}
public struct Request has copy,drop,store {actor:address,attempt:vector<u8>}
public struct Asset has key {id:UID,registry:ID,source:Source,terms:Terms,sale:SalePolicy,registration:Registration,row_hash:vector<u8>,serial:u64,holder:address,epoch:u64,authorization:vector<u8>,proof:Option<Proof>,visual:vector<u8>,provenance:vector<u8>}
public struct Listing<phantom C> has key {id:UID,snapshot:Snapshot,protocol:ID,price:u64,expiry:u64,state:u8,revision:u64,buyer:Option<address>,attempt:Option<vector<u8>>,settlement:Option<SaleReceipt>}
public struct Issued has copy,drop {asset:ID,registry:ID,source:vector<u8>,serial:u64,holder:address,mode:u8,attempt:vector<u8>}
public struct Transferred has copy,drop {asset:ID,previous:address,holder:address,epoch:u64}
public struct Consumed has copy,drop {asset:ID,registry:ID,serial:u64,holder:address,provenance:vector<u8>}
public struct Listed has copy,drop {listing:ID,asset:ID,seller:address,price:u64}
public struct Sold has copy,drop {listing:ID,asset:ID,buyer:address,attempt:vector<u8>}
public struct Cancelled has copy,drop {listing:ID,asset:ID,seller:address}
public struct SaleSettled has copy,drop {receipt:SaleReceipt,attempt:vector<u8>}
/// One registry per actual Maker Version; a second registry cannot reset supply/replay.
fun registry_value<C>(maker:&mut Product<C>,control:&mut Control,version:u64,cfg:&Config<C>,ctx:&mut TxContext):Registry<C> {
    catalog::assert_control(maker,control);assert!(catalog::parent(maker).is_none(),EBinding);let v=catalog::published(maker,version);
    let mut r=Registry<C>{id:object::new(ctx),protocol:catalog::protocol(maker),maker:object::id(maker),version,policy_hash:catalog::policy_hash(v),creator:catalog::creator(maker),rates:catalog::soul_rates(v),market:catalog::version_market(v),revision:0,keys:vector[],rules:table::new(ctx),authorizations:table::new(ctx),requests:table::new(ctx),payments:table::new(ctx),stats:Stats{issued:0,free:0,paid:0,materialized:0,consumed:0,gross:0,platform:0,maker:0,pack:0}};
    let registration=physical_metadata::registration(object::id(control),object::id(control),0,ctx);
    catalog::physical_terms(v).do_ref!(|t|add_rule(&mut r,catalog::preview_source(maker,version,material_policy::definition(t)),*t,registration));
    r
}
public(package) fun create_registry<C>(maker:&mut Product<C>,control:&mut Control,version:u64,cfg:&Config<C>,system:&System,ctx:&mut TxContext):ID{let r=registry_value(maker,control,version,cfg,ctx);let id=object::id(&r);factory::bind_native_physical(maker,control,version,&r,cfg,PhysicalProducer{},PhysicalRevision1{},system);transfer::share_object(r);id}
#[test_only]
public(package) fun create_registry_for_testing<C>(maker:&mut Product<C>,control:&mut Control,version:u64,cfg:&Config<C>,ctx:&mut TxContext):ID{let r=registry_value(maker,control,version,cfg,ctx);let id=object::id(&r);catalog::bind_physical_registry_for_testing(maker,control,version,&r,cfg,PhysicalProducer{},PhysicalRevision1{});transfer::share_object(r);id}
/// Both actual product controls approve Pack policies already fixed in its Version.
public(package) fun register_pack<C>(r:&mut Registry<C>,maker:&Product<C>,maker_control:&mut Control,pack:&Product<C>,pack_control:&mut Control,version:u64,expected:u64,ctx:&TxContext) {
    assert!(r.revision==expected,ERevision);assert_registry(r,maker);catalog::assert_active(maker);catalog::assert_active(pack);catalog::assert_control(maker,maker_control);catalog::assert_control(pack,pack_control);
    assert!(catalog::parent(pack)==option::some(r.maker) && catalog::protocol(pack)==r.protocol,EBinding);
    let terms=catalog::physical_terms(catalog::published(pack,version));assert!(!terms.is_empty(),EPolicy);
    assert!(catalog::parent_policy(pack)==option::some(r.policy_hash),EBinding);let version_data=catalog::published(pack,version);let parts=catalog::parts(version_data);
    let registration=physical_metadata::registration(object::id(maker_control),object::id(pack_control),expected+1,ctx);
    terms.do_ref!(|t|{let source=catalog::preview_source(pack,version,material_policy::definition(t));assert!(policy::source_maker(&source)==r.maker && policy::maker_version(&source)==r.version && parts.contains(&policy::part(&source)),EBinding);soulidity_visual::visual::assert_native(policy::source_representation(&source),catalog::scene(version_data));add_rule(r,source,*t,registration)});r.revision=r.revision+1
}
fun add_rule<C>(r:&mut Registry<C>,source:Source,terms:Terms,registration:Registration) {
    let key=policy::source_hash(&source);assert!(r.keys.length() < 10000 && !r.rules.contains(key),EPolicy);
    let sale=physical_metadata::sale_policy(r.maker,r.version,r.policy_hash,policy::source_product(&source),policy::source_version(&source),r.creator,policy::beneficiary(&source),r.rates,r.market);
    let row_hash=physical_metadata::rule_hash(source,terms,sale,registration);r.keys.push_back(key);r.rules.add(key,Rule{source,terms,sale,registration,row_hash,issued:0,consumed:0})
}
fun assert_registry<C>(r:&Registry<C>,maker:&Product<C>) {
    assert!(object::id(maker)==r.maker && catalog::protocol(maker)==r.protocol && catalog::physical_registry(maker,r.version)==option::some(object::id(r)) && catalog::policy_hash(catalog::published(maker,r.version))==r.policy_hash,EBinding)
}
fun active_source<C>(r:&Registry<C>,maker:&Product<C>,product:&Product<C>,source:&Source,actor:address,access:bool) {
    assert_registry(r,maker);catalog::assert_active(maker);catalog::assert_active(product);
    assert!(catalog::protocol(product)==r.protocol && object::id(product)==policy::source_product(source) && policy::source_maker(source)==r.maker && policy::maker_version(source)==r.version,EBinding);
    assert!(catalog::preview_source(product,policy::source_version(source),policy::source_definition_hash(source))==*source,EBinding);
    if(object::id(product)==r.maker){if(access)catalog::assert_access(maker,r.version,actor)}
    else {assert!(catalog::parent(product)==option::some(r.maker),EBinding);if(access)catalog::assert_pack(product,maker,r.version,policy::source_version(source),actor)}
}
public fun quote<C>(r:&Registry<C>,key:vector<u8>,cfg:&Config<C>,actor:address,expiry:u64):vector<u8> {
    let rule=rule(r,key);physical_metadata::quote_hash(object::id(r),r.revision,rule.row_hash,rule.issued,object::id(cfg),economics::revision(cfg),actor,expiry)
}
fun check_quote<C>(r:&Registry<C>,key:vector<u8>,cfg:&Config<C>,expected:u64,issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,clock:&Clock,ctx:&TxContext) {
    assert!(r.revision==expected && rule(r,key).issued==issued,ERevision);assert!(object::id(cfg)==r.protocol,EBinding);
    economics::assert_primary_live(cfg,fee_revision,expiry,clock);assert!(expected_quote==quote(r,key,cfg,ctx.sender(),expiry),EQuote)
}
fun player_source<C>(r:&Registry<C>,p:&Player,part:PartKey,expected:u64,ctx:&TxContext):Source {
    player::assert_owner(p,expected,ctx);assert!(player::maker(p)==r.maker && player::maker_version(p)==r.version && player::protocol(p)==r.protocol,EBinding);
    let selected=player::scoped_selection(p,part);assert!(selected.is_some(),ESelection);*player::source(selected.borrow())
}
public(package) fun claim_scoped<C>(r:&mut Registry<C>,maker:&Product<C>,product:&Product<C>,p:&Player,part:PartKey,cfg:&Config<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext):Asset {
    let source=player_source(r,p,part,expected_player,ctx);let key=policy::source_hash(&source);let rule=*rule(r,key);assert!(material_policy::mode(&rule.terms)==0,EPolicy);
    active_source(r,maker,product,&source,ctx.sender(),true);check_quote(r,key,cfg,expected_registry,expected_issued,fee_revision,expiry,expected_quote,clock,ctx);
    let auth=authorization(r,&rule,0,ctx.sender(),object::id(product),vector[]);
    let capture=capture_player(r,maker,p,ctx);issue(r,key,auth,option::none(),capture,attempt,ctx)
}
/// Base and Pack entry points avoid borrowing one root both immutably and
/// mutably in the same call. Both use one common exact validation/settlement.
public(package) fun purchase_scoped<C>(r:&mut Registry<C>,maker:&mut Product<C>,p:&Player,part:PartKey,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset {
    let(rule,auth)=prepare_purchase(r,maker,maker,p,part,cfg,&payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx);
    let capture=capture_player(r,maker,p,ctx);finish_purchase(r,maker,cfg,rule,auth,payment,capture,attempt,expiry,clock,system,ctx)
}
public(package) fun purchase_pack_scoped<C>(r:&mut Registry<C>,maker:&Product<C>,pack:&mut Product<C>,p:&Player,part:PartKey,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,system:&System,ctx:&mut TxContext):Asset {
    assert!(catalog::parent(pack)==option::some(object::id(maker)),EBinding);
    let(rule,auth)=prepare_purchase(r,maker,pack,p,part,cfg,&payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx);
    let capture=capture_player(r,maker,p,ctx);finish_purchase(r,pack,cfg,rule,auth,payment,capture,attempt,expiry,clock,system,ctx)
}
fun prepare_purchase<C>(r:&Registry<C>,maker:&Product<C>,product:&Product<C>,p:&Player,part:PartKey,cfg:&Config<C>,payment:&Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,ctx:&TxContext):(Rule,vector<u8>){
    let source=player_source(r,p,part,expected_player,ctx);let key=policy::source_hash(&source);let rule=*rule(r,key);assert!(material_policy::mode(&rule.terms)==1,EPolicy);
    active_source(r,maker,product,&source,ctx.sender(),true);check_quote(r,key,cfg,expected_registry,expected_issued,fee_revision,expiry,expected_quote,clock,ctx);
    let auth=authorization(r,&rule,1,ctx.sender(),object::id(payment),vector[]);available(r,&rule,&auth,&attempt,ctx);(rule,auth)
}
fun finish_purchase<C>(r:&mut Registry<C>,product:&mut Product<C>,cfg:&mut Config<C>,rule:Rule,auth:vector<u8>,payment:Coin<C>,capture:Capture,attempt:vector<u8>,expiry:u64,clock:&Clock,system:&System,ctx:&mut TxContext):Asset{
    let source=rule.source;let key=policy::source_hash(&source);let price=material_policy::price(&rule.terms);let primary=policy::source_primary(&source);let fee=economics::primary_policy_fee(&primary,price);assert!((economics::primary_policy_bps(&primary)==0 || fee>0) && fee < price,EPayment);
    let receipt=economics::route_primary(economics::primary_quote(&primary,cfg,price,false,policy::beneficiary(&source),object::id(r),rule.row_hash,ctx.sender(),attempt,expiry),object::id(product));let settlement=factory::settle_native_physical(product,r,policy::source_version(&source),cfg,receipt,payment,PhysicalProducer{},PhysicalRevision1{},system,clock,ctx);let receipt=catalog::consume_physical_settlement(settlement,r,PhysicalProducer{},PhysicalRevision1{},object::id(product),policy::source_version(&source),ctx);r.payments.add(Request{actor:ctx.sender(),attempt},receipt);
finish_purchase_value(r,key,rule,auth,capture,attempt,price,fee,ctx)}
#[test_only]
fun finish_purchase_for_testing<C>(r:&mut Registry<C>,product:&mut Product<C>,cfg:&mut Config<C>,rule:Rule,auth:vector<u8>,payment:Coin<C>,capture:Capture,attempt:vector<u8>,expiry:u64,clock:&Clock,ctx:&mut TxContext):Asset{
    let source=rule.source;let key=policy::source_hash(&source);let price=material_policy::price(&rule.terms);let primary=policy::source_primary(&source);let fee=economics::primary_policy_fee(&primary,price);assert!((economics::primary_policy_bps(&primary)==0 || fee>0) && fee < price,EPayment);
    let receipt=economics::route_primary(economics::primary_quote(&primary,cfg,price,false,policy::beneficiary(&source),object::id(r),rule.row_hash,ctx.sender(),attempt,expiry),object::id(product));let settlement=catalog::settle_physical_for_testing(product,r,policy::source_version(&source),cfg,receipt,payment,PhysicalProducer{},PhysicalRevision1{},clock,ctx);let receipt=catalog::consume_physical_settlement(settlement,r,PhysicalProducer{},PhysicalRevision1{},object::id(product),policy::source_version(&source),ctx);r.payments.add(Request{actor:ctx.sender(),attempt},receipt);
finish_purchase_value(r,key,rule,auth,capture,attempt,price,fee,ctx)}
fun finish_purchase_value<C>(r:&mut Registry<C>,key:vector<u8>,rule:Rule,auth:vector<u8>,capture:Capture,attempt:vector<u8>,price:u64,fee:u64,ctx:&mut TxContext):Asset{    r.stats.gross=r.stats.gross+(price as u128);r.stats.platform=r.stats.platform+(fee as u128);
    if(policy::source_product(&rule.source)==r.maker)r.stats.maker=r.stats.maker+((price-fee) as u128) else r.stats.pack=r.stats.pack+((price-fee) as u128);
    issue(r,key,auth,option::none(),capture,attempt,ctx)
}
/// Canonical Soul + its private immutable Artifact, never a copied receipt alone.
public(package) fun materialize_scoped<C>(r:&mut Registry<C>,maker:&Product<C>,product:&Product<C>,s:&mut Soul,part:PartKey,materialization_key:vector<u8>,cfg:&Config<C>,expected_soul:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext):Asset {
    soul::assert_revision(s,expected_soul);assert!(soul::maker(s)==r.maker && soul::maker_version(s)==r.version && soul::protocol(s)==r.protocol,EBinding);
    let binding=soul::binding_scoped(s,part);assert!(binding.is_some(),ESelection);let source=*soul::binding_source(binding.borrow());let key=policy::source_hash(&source);let rule=*rule(r,key);assert!(material_policy::mode(&rule.terms)==2,EPolicy);
    active_source(r,maker,product,&source,ctx.sender(),true);check_quote(r,key,cfg,expected_registry,expected_issued,fee_revision,expiry,expected_quote,clock,ctx);
    let(output_commitment,soul_commitment)=soul::genesis_commitments(s);let a=soul::original_output(s);let proof=physical_metadata::proof(object::id(s),soul::generation(s),expected_soul,object::id(a),output::intent_hash(output::artifact_intent(a)),output::policy_hash(output::artifact_policy(a)),output::original_recipe_hash(a),storage::hash(output::render(a)),output::receipt_hash(output::artifact_receipt(a)),output_commitment,soul_commitment,materialization_key,key);
    let auth=authorization(r,&rule,2,@0x0,physical_metadata::proof_soul(&proof),policy::hash_bytes(bcs::to_bytes(&physical_metadata::proof_artifact(&proof))));
    let capture=visual_capture::new(CaptureProducer{},r,object::id(s),expected_soul,catalog::assembly_profile(maker,r.version),soul::semantic_profiles(s),soul::published_profiles(s),soul::colors(s),soul::semantic_recipe(s),ctx);available(r,&rule,&auth,&attempt,ctx);soul::reserve_materialization(soulidity_v1::application_operator::operator(),s,materialization_key,policy::hash_bytes(bcs::to_bytes(&proof)),expected_soul);
    issue(r,key,auth,option::some(proof),capture,attempt,ctx)
}
fun authorization<C>(r:&Registry<C>,rule:&Rule,mode:u8,actor:address,subject:ID,commitment:vector<u8>):vector<u8> {
    physical_metadata::authorization_hash(object::id(r),rule.row_hash,mode,actor,subject,commitment)
}
fun available<C>(r:&Registry<C>,rule:&Rule,auth:&vector<u8>,attempt:&vector<u8>,ctx:&TxContext) {
    policy::assert_hash(attempt);assert!(rule.issued < material_policy::supply(&rule.terms),ESupply);
    assert!(!r.authorizations.contains(*auth) && !r.requests.contains(Request{actor:ctx.sender(),attempt:*attempt}),EReplay)
}
fun issue<C>(r:&mut Registry<C>,key:vector<u8>,auth:vector<u8>,proof:Option<Proof>,capture:Capture,attempt:vector<u8>,ctx:&mut TxContext):Asset {
    visual_capture::assert_controller(CaptureProducer{},r,&capture);
    let rule=*rule(r,key);available(r,&rule,&auth,&attempt,ctx);assert!((material_policy::proof_kind(&rule.terms)==2)==proof.is_some(),EPolicy);
    let visual=visual_capture::commitment(&capture);let serial=rule.issued+1;let provenance=physical_metadata::provenance_hash(object::id(r),rule.row_hash,serial,ctx.sender(),auth,proof,visual);
    let mut a=Asset{id:object::new(ctx),registry:object::id(r),source:rule.source,terms:rule.terms,sale:rule.sale,registration:rule.registration,row_hash:rule.row_hash,serial,holder:ctx.sender(),epoch:0,authorization:auth,proof,visual,provenance};dof::add(&mut a.id,VisualKey{},capture);let id=object::id(&a);
    r.rules.borrow_mut(key).issued=serial;r.authorizations.add(auth,id);r.requests.add(Request{actor:ctx.sender(),attempt},id);r.revision=r.revision+1;r.stats.issued=r.stats.issued+1;
    let mode=material_policy::mode(&rule.terms);if(mode==0)r.stats.free=r.stats.free+1 else if(mode==1)r.stats.paid=r.stats.paid+1 else r.stats.materialized=r.stats.materialized+1;
    event::emit(Issued{asset:id,registry:object::id(r),source:key,serial,holder:ctx.sender(),mode,attempt});a
}
public fun deliver(asset:Asset){let owner=asset.holder;transfer::transfer(asset,owner)}
public fun transfer_asset(mut asset:Asset,recipient:address,expected_epoch:u64,ctx:&TxContext) {
    holder(&asset,expected_epoch,ctx);assert!(material_policy::transferable(&asset.terms) && recipient!=@0x0 && recipient!=asset.holder,ETransfer);
    let previous=asset.holder;asset.holder=recipient;asset.epoch=asset.epoch+1;event::emit(Transferred{asset:object::id(&asset),previous,holder:recipient,epoch:asset.epoch});transfer::transfer(asset,recipient)
}
fun holder(asset:&Asset,expected:u64,ctx:&TxContext){assert!(asset.holder==ctx.sender(),EOwner);assert!(asset.epoch==expected,ERevision)}
public fun consume<C>(r:&mut Registry<C>,mut asset:Asset,expected_epoch:u64,ctx:&TxContext) {
    holder(&asset,expected_epoch,ctx);assert!(asset.registry==object::id(r),EBinding);let key=policy::source_hash(&asset.source);let rule=r.rules.borrow_mut(key);assert!(rule.row_hash==asset.row_hash && rule.consumed < rule.issued,EBinding);
    rule.consumed=rule.consumed+1;r.stats.consumed=r.stats.consumed+1;r.revision=r.revision+1;let id=object::id(&asset);event::emit(Consumed{asset:id,registry:asset.registry,serial:asset.serial,holder:asset.holder,provenance:asset.provenance});
    visual_capture::destroy(CaptureProducer{},r,dof::remove<VisualKey,Capture>(&mut asset.id,VisualKey{}));let Asset{id,registry:_,source:_,terms:_,sale:_,registration:_,row_hash:_,serial:_,holder:_,epoch:_,authorization:_,proof:_,visual:_,provenance:_}=asset;id.delete()
}
public fun snapshot(a:&Asset):Snapshot{physical_metadata::snapshot(object::id(a),a.registry,a.source,a.terms,a.sale,a.registration,a.row_hash,a.serial,a.holder,a.epoch,a.authorization,a.proof,a.visual,a.provenance)}
public fun asset_registration(a:&Asset):Registration{a.registration}
public fun asset_sale(a:&Asset):SalePolicy{a.sale}
public fun sale_creator(p:&SalePolicy):address{physical_metadata::sale_creator(p)}
public fun sale_source_recipient(p:&SalePolicy):address{physical_metadata::sale_source_recipient(p)}
public fun sale_rates(p:&SalePolicy):Rates{physical_metadata::sale_rates(p)}
public fun sale_platform(p:&SalePolicy):address{economics::market_platform(&physical_metadata::sale_market(p))}
public fun sale_policy_hash(p:&SalePolicy):vector<u8>{physical_metadata::sale_hash(p)}
public fun asset_holder(a:&Asset):address{a.holder}
public fun asset_epoch(a:&Asset):u64{a.epoch}
public fun asset_source(a:&Asset):&Source{&a.source}
public fun asset_terms(a:&Asset):&Terms{&a.terms}
public fun asset_serial(a:&Asset):u64{a.serial}
public fun asset_proof(a:&Asset):Option<Proof>{a.proof}
public fun asset_provenance(a:&Asset):vector<u8>{a.provenance}
public fun asset_registry(a:&Asset):ID{a.registry}
public fun asset_rule_hash(a:&Asset):vector<u8>{a.row_hash}
public fun asset_authorization(a:&Asset):vector<u8>{a.authorization}
public fun registry_maker<C>(r:&Registry<C>):ID{r.maker}
public fun registry_version<C>(r:&Registry<C>):u64{r.version}
public fun registry_protocol<C>(r:&Registry<C>):ID{r.protocol}
public fun registry_policy_hash<C>(r:&Registry<C>):vector<u8>{r.policy_hash}
public fun rule_keys<C>(r:&Registry<C>):vector<vector<u8>>{r.keys}
public fun authorization_count<C>(r:&Registry<C>):u64{r.authorizations.length()}
public fun authorization_receipt<C>(r:&Registry<C>,key:vector<u8>):Option<ID>{if(r.authorizations.contains(key))option::some(*r.authorizations.borrow(key)) else option::none()}
public fun revision<C>(r:&Registry<C>):u64{r.revision}
public fun rule<C>(r:&Registry<C>,key:vector<u8>):&Rule{assert!(r.rules.contains(key),EPolicy);r.rules.borrow(key)}
public fun rule_source(r:&Rule):&Source{&r.source}
public fun rule_terms(r:&Rule):&Terms{&r.terms}
public fun rule_registration(r:&Rule):Registration{r.registration}
public fun rule_hash(r:&Rule):vector<u8>{r.row_hash}
public fun issued(r:&Rule):u64{r.issued}
public fun consumed(r:&Rule):u64{r.consumed}
public fun stats<C>(r:&Registry<C>):Stats{r.stats}
public fun total_issued(s:&Stats):u64{s.issued}
public fun total_consumed(s:&Stats):u64{s.consumed}
public fun total_free(s:&Stats):u64{s.free}
public fun total_paid(s:&Stats):u64{s.paid}
public fun total_materialized(s:&Stats):u64{s.materialized}
public fun gross(s:&Stats):u128{s.gross}
public fun platform_paid(s:&Stats):u128{s.platform}
public fun maker_paid(s:&Stats):u128{s.maker}
public fun pack_paid(s:&Stats):u128{s.pack}
public fun receipt<C>(r:&Registry<C>,actor:address,attempt:vector<u8>):Option<ID>{let k=Request{actor,attempt};if(r.requests.contains(k))option::some(*r.requests.borrow(k)) else option::none()}
public fun payment_receipt<C>(r:&Registry<C>,actor:address,attempt:vector<u8>):Option<PrimaryReceipt>{let k=Request{actor,attempt};if(r.payments.contains(k))option::some(*r.payments.borrow(k)) else option::none()}


/// Key-only child ownership uses Receiving, never a public UID or generic store escape.
public fun list<C>(r:&Registry<C>,maker:&Product<C>,product:&Product<C>,asset:Asset,cfg:&Config<C>,price:u64,expiry:u64,fee_revision:u64,expected_epoch:u64,clock:&Clock,ctx:&mut TxContext):ID {
    holder(&asset,expected_epoch,ctx);assert!(asset.registry==object::id(r) && object::id(cfg)==r.protocol,EBinding);assert!(material_policy::transferable(&asset.terms) && price>0,ETransfer);
    active_source(r,maker,product,&asset.source,ctx.sender(),false);economics::assert_secondary_live(cfg,fee_revision,expiry,clock);
    assert!(expiry>clock::timestamp_ms(clock),EQuote);sale_amounts(&asset.sale,price);
    let l=Listing<C>{id:object::new(ctx),snapshot:snapshot(&asset),protocol:r.protocol,price,expiry,state:0,revision:0,buyer:option::none(),attempt:option::none(),settlement:option::none()};let id=object::id(&l);
    transfer::transfer(asset,object::uid_to_address(&l.id));event::emit(Listed{listing:id,asset:physical_metadata::snapshot_asset(&l.snapshot),seller:physical_metadata::snapshot_holder(&l.snapshot),price});transfer::share_object(l);id
}
fun receive<C>(l:&mut Listing<C>,receiving:Receiving<Asset>):Asset {
    let a=transfer::receive(&mut l.id,receiving);assert!(snapshot(&a)==l.snapshot,EBinding);a
}
public fun cancel<C>(l:&mut Listing<C>,receiving:Receiving<Asset>,expected:u64,ctx:&TxContext) {
    assert!(l.state==0 && l.revision==expected,EState);assert!(physical_metadata::snapshot_holder(&l.snapshot)==ctx.sender(),EOwner);let a=receive(l,receiving);l.state=2;l.revision=l.revision+1;
    event::emit(Cancelled{listing:object::id(l),asset:object::id(&a),seller:ctx.sender()});transfer::transfer(a,ctx.sender())
}
public fun buy<C>(l:&mut Listing<C>,r:&Registry<C>,maker:&mut Product<C>,receiving:Receiving<Asset>,cfg:&mut Config<C>,payment:Coin<C>,expected:u64,expected_snapshot:vector<u8>,expected_quote:vector<u8>,fee_revision:u64,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext) {
    let receipt=check_sale(l,r,maker,maker,cfg,expected,expected_snapshot,expected_quote,fee_revision,attempt,clock,ctx);
    finish_sale(l,maker,receiving,cfg,receipt,payment,attempt,ctx)
}
public fun buy_pack<C>(l:&mut Listing<C>,r:&Registry<C>,maker:&Product<C>,pack:&mut Product<C>,receiving:Receiving<Asset>,cfg:&mut Config<C>,payment:Coin<C>,expected:u64,expected_snapshot:vector<u8>,expected_quote:vector<u8>,fee_revision:u64,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext) {
    assert!(catalog::parent(pack)==option::some(object::id(maker)),EBinding);
    let receipt=check_sale(l,r,maker,pack,cfg,expected,expected_snapshot,expected_quote,fee_revision,attempt,clock,ctx);
    finish_sale(l,pack,receiving,cfg,receipt,payment,attempt,ctx)
}
fun check_sale<C>(l:&Listing<C>,r:&Registry<C>,maker:&Product<C>,product:&Product<C>,cfg:&Config<C>,expected:u64,expected_snapshot:vector<u8>,expected_quote:vector<u8>,fee_revision:u64,attempt:vector<u8>,clock:&Clock,ctx:&TxContext):SaleReceipt{
    assert!(l.state==0 && l.revision==expected,EState);assert!(l.protocol==object::id(cfg) && physical_metadata::snapshot_registry(&l.snapshot)==object::id(r),EBinding);assert!(ctx.sender()!=physical_metadata::snapshot_holder(&l.snapshot) && expected_snapshot==listing_hash(l),EQuote);
    active_source(r,maker,product,&physical_metadata::snapshot_source(&l.snapshot),ctx.sender(),false);economics::assert_secondary_live(cfg,fee_revision,l.expiry,clock);policy::assert_hash(&attempt);
    assert!(expected_quote==sale_quote_hash(l,cfg,ctx.sender()),EQuote);sale_quote(l,cfg,ctx.sender())
}
fun finish_sale<C>(l:&mut Listing<C>,product:&mut Product<C>,receiving:Receiving<Asset>,cfg:&mut Config<C>,receipt:SaleReceipt,payment:Coin<C>,attempt:vector<u8>,ctx:&mut TxContext){
    let mut a=receive(l,receiving);assert!(material_policy::transferable(&a.terms),ETransfer);
    settle_sale(receipt,product,cfg,payment,attempt,ctx);l.settlement=option::some(receipt);
    a.holder=ctx.sender();a.epoch=a.epoch+1;l.state=1;l.revision=l.revision+1;l.buyer=option::some(ctx.sender());l.attempt=option::some(attempt);
    event::emit(Sold{listing:object::id(l),asset:object::id(&a),buyer:ctx.sender(),attempt});transfer::transfer(a,ctx.sender())
}
fun sale_amounts(p:&SalePolicy,gross:u64):(u64,u64,u64,u64){
    assert!(gross>0,EPayment);let(platform,creator,source,net)=physical_metadata::sale_amounts(p,gross);assert!(net>0,EPayment);(platform,creator,source,net)
}
public fun sale_quote<C>(l:&Listing<C>,cfg:&Config<C>,buyer:address):SaleReceipt {
    assert!(l.protocol==object::id(cfg) && economics::market_config(&physical_metadata::sale_market(&physical_metadata::snapshot_sale(&l.snapshot)))==object::id(cfg),EBinding);assert!(buyer!=@0x0,EQuote);
    let(platform,creator,source,net)=sale_amounts(&physical_metadata::snapshot_sale(&l.snapshot),l.price);
    physical_metadata::sale_receipt(object::id(l),physical_metadata::snapshot_asset(&l.snapshot),l.revision,listing_hash(l),physical_metadata::snapshot_sale(&l.snapshot),object::id(cfg),economics::revision(cfg),physical_metadata::snapshot_holder(&l.snapshot),buyer,l.expiry,l.price,platform,creator,source,net)
}
public fun sale_quote_hash<C>(l:&Listing<C>,cfg:&Config<C>,buyer:address):vector<u8>{physical_metadata::receipt_hash(&sale_quote(l,cfg,buyer))}
fun settle_sale<C>(r:SaleReceipt,product:&mut Product<C>,cfg:&mut Config<C>,mut payment:Coin<C>,attempt:vector<u8>,ctx:&mut TxContext){
    assert!(physical_metadata::receipt_config(&r)==object::id(cfg) && physical_metadata::sale_product(&physical_metadata::receipt_policy(&r))==object::id(product),EBinding);
    assert!(coin::value(&payment)==physical_metadata::receipt_gross(&r) && physical_metadata::receipt_buyer(&r)==ctx.sender(),EPayment);
    if(physical_metadata::receipt_platform(&r)>0)economics::deposit_income(cfg,coin::split(&mut payment,physical_metadata::receipt_platform(&r),ctx));
    if(physical_metadata::receipt_creator(&r)>0)transfer::public_transfer(coin::split(&mut payment,physical_metadata::receipt_creator(&r),ctx),physical_metadata::sale_creator(&physical_metadata::receipt_policy(&r)));
    if(physical_metadata::receipt_source(&r)>0)catalog::deposit_income(product,cfg,coin::split(&mut payment,physical_metadata::receipt_source(&r),ctx));
    assert!(coin::value(&payment)==physical_metadata::receipt_net(&r) && physical_metadata::receipt_net(&r)>0,EPayment);transfer::public_transfer(payment,physical_metadata::receipt_seller(&r));event::emit(SaleSettled{receipt:r,attempt})
}
public fun listing_settlement<C>(l:&Listing<C>):Option<SaleReceipt>{l.settlement}
public fun sale_receipt_policy(r:&SaleReceipt):SalePolicy{physical_metadata::receipt_policy(r)}
public fun sale_receipt_gross(r:&SaleReceipt):u64{physical_metadata::receipt_gross(r)}
public fun sale_receipt_net(r:&SaleReceipt):u64{physical_metadata::receipt_net(r)}
public fun sale_receipt_platform(r:&SaleReceipt):u64{physical_metadata::receipt_platform(r)}
public fun sale_receipt_creator(r:&SaleReceipt):u64{physical_metadata::receipt_creator(r)}
public fun sale_receipt_source(r:&SaleReceipt):u64{physical_metadata::receipt_source(r)}
public fun sale_receipt_source_revenue(r:&SaleReceipt):ID{physical_metadata::sale_product(&physical_metadata::receipt_policy(r))}
public fun sale_receipt_protocol_revenue(r:&SaleReceipt):ID{physical_metadata::receipt_config(r)}
public fun sale_receipt_seller(r:&SaleReceipt):address{physical_metadata::receipt_seller(r)}
public fun sale_receipt_buyer(r:&SaleReceipt):address{physical_metadata::receipt_buyer(r)}
public fun sale_receipt_revision(r:&SaleReceipt):u64{physical_metadata::receipt_fee_revision(r)}
public fun listing_hash<C>(l:&Listing<C>):vector<u8>{physical_metadata::snapshot_hash(&l.snapshot)}
public fun listing_state<C>(l:&Listing<C>):u8{l.state}
public fun listing_receipt<C>(l:&Listing<C>):Option<vector<u8>>{l.attempt}
public fun listing_asset<C>(l:&Listing<C>):ID{physical_metadata::snapshot_asset(&l.snapshot)}
public fun listing_snapshot<C>(l:&Listing<C>):Snapshot{l.snapshot}
public fun listing_revision<C>(l:&Listing<C>):u64{l.revision}
public fun listing_seller<C>(l:&Listing<C>):address{physical_metadata::snapshot_holder(&l.snapshot)}
public fun listing_buyer<C>(l:&Listing<C>):Option<address>{l.buyer}
public fun listing_price<C>(l:&Listing<C>):u64{l.price}
public fun listing_expiry<C>(l:&Listing<C>):u64{l.expiry}

/// Root-name convenience for unit fixtures; production Runtime uses scoped paths.
#[test_only]
public(package) fun claim<C>(r:&mut Registry<C>,maker:&Product<C>,product:&Product<C>,p:&Player,part:vector<u8>,cfg:&Config<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext):Asset{claim_scoped(r,maker,product,p,assembly::root_part(part),cfg,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx)}
/// Root-name convenience for unit fixtures; production Runtime uses scoped paths.
#[test_only]
public(package) fun purchase<C>(r:&mut Registry<C>,maker:&mut Product<C>,p:&Player,part:vector<u8>,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext):Asset{let part=assembly::root_part(part);
    let(rule,auth)=prepare_purchase(r,maker,maker,p,part,cfg,&payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx);
    let capture=capture_player(r,maker,p,ctx);finish_purchase_for_testing(r,maker,cfg,rule,auth,payment,capture,attempt,expiry,clock,ctx)
}
/// Root-name convenience for unit fixtures; production Runtime uses scoped paths.
#[test_only]
public(package) fun purchase_pack<C>(r:&mut Registry<C>,maker:&Product<C>,pack:&mut Product<C>,p:&Player,part:vector<u8>,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext):Asset{let part=assembly::root_part(part);
    assert!(catalog::parent(pack)==option::some(object::id(maker)),EBinding);
    let(rule,auth)=prepare_purchase(r,maker,pack,p,part,cfg,&payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx);
    let capture=capture_player(r,maker,p,ctx);finish_purchase_for_testing(r,pack,cfg,rule,auth,payment,capture,attempt,expiry,clock,ctx)
}
public(package) fun materialize<C>(r:&mut Registry<C>,maker:&Product<C>,product:&Product<C>,s:&mut Soul,part:vector<u8>,materialization_key:vector<u8>,cfg:&Config<C>,expected_soul:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext):Asset{materialize_scoped(r,maker,product,s,assembly::root_part(part),materialization_key,cfg,expected_soul,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx)}

public struct VisualKey has copy,drop,store {}
fun capture_player<C>(r:&Registry<C>,maker:&Product<C>,p:&Player,ctx:&mut TxContext):Capture{visual_capture::new(CaptureProducer{},r,object::id(p),player::revision(p),catalog::assembly_profile(maker,player::maker_version(p)),player::profiles(p),player::published_profiles(p),player::colors(p),player::semantic_recipe(p),ctx)}
public fun asset_visual(a:&Asset):&Capture{let c:&Capture=dof::borrow(&a.id,VisualKey{});assert!(visual_capture::commitment(c)==a.visual,EBinding);c}
public fun snapshot_visual(s:&Snapshot):vector<u8>{physical_metadata::snapshot_visual(s)}
public fun snapshot_registration(s:&Snapshot):Registration{physical_metadata::snapshot_registration(s)}

/// Test-only access to the exact guard used by private native issue; no factory.
#[test_only]
public fun assert_native_capture_for_testing<C>(r:&Registry<C>,c:&Capture){visual_capture::assert_controller(CaptureProducer{},r,c)}

/// Scoped unit counterpart of purchase_pack: exact original preparation, payment,
/// supply and visual capture duties. Publication availability is verified separately.
#[test_only]
public(package) fun purchase_pack_scoped_for_testing<C>(r:&mut Registry<C>,maker:&Product<C>,pack:&mut Product<C>,p:&Player,part:PartKey,cfg:&mut Config<C>,payment:Coin<C>,expected_player:u64,expected_registry:u64,expected_issued:u64,fee_revision:u64,expiry:u64,expected_quote:vector<u8>,attempt:vector<u8>,clock:&Clock,ctx:&mut TxContext):Asset {
    assert!(catalog::parent(pack)==option::some(object::id(maker)),EBinding);
    let(rule,auth)=prepare_purchase(r,maker,pack,p,part,cfg,&payment,expected_player,expected_registry,expected_issued,fee_revision,expiry,expected_quote,attempt,clock,ctx);
    let capture=capture_player(r,maker,p,ctx);finish_purchase_for_testing(r,pack,cfg,rule,auth,payment,capture,attempt,expiry,clock,ctx)
}
