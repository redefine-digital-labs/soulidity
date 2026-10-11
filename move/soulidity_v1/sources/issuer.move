/// A non-storable assembly ticket makes selection, fees, issuance and transfer one PTB.
/// There is no public fresh Soul or public forgeable issuance witness.
module soulidity_v1::issuer;
use soulidity_custody::lifecycle;

use std::string::String;
use sui::coin::{Self,Coin};
use sui::clock::Clock;
use soulidity_maker_manufacturing::maker_catalog::{Product};
use soulidity_v1::catalog;
use soulidity_foundation::economics::{Self,Config};
use soulidity_model::policy::Layout;
use soulidity_application::character::{Self as soul};
use soulidity_standard::soul::{Self as standard,Soul};
use soulidity_custody::lifecycle::{Construction};
use soulidity_maker_manufacturing::maker_catalog::{Self as manufacture,Session};
use soulidity_maker_manufacturing::maker_factory as factory;
use soulidity_origin_protocol::producer_origin::{Self as origin,CompletionAuthorization};
use soulidity_v1::application_operator::{Self as operator,ApplicationOperator,ApplicationRevision1};
use soulidity_maker_admission::maker_issuance as admission;
use soulidity_application::output::{Self};
use soulidity_maker_publication::output_data::{Intent,Policy,PayLine};
use soulidity_content_kinds::content_kind_registry::KindRegistry;
use walrus::blob::Blob;
use walrus::system::System;
use soulidity_maker_manufacturing::maker_player::{Player};
use soulidity_v1::player;
use soulidity_model::policy;

const EProduct:u64=1;
const EActor:u64=2;const EPayment:u64=3;
const EUnused:u64=4;const EInitial:u64=5;const ERecipe:u64=6;
const EChoices:u64=7;
public struct Purchase has copy,drop,store {definition:vector<u8>,part:soulidity_model::assembly::PartKey,layout:Layout}
public struct InstalledChoice has copy,drop {source:vector<u8>,part:soulidity_model::assembly::PartKey,layout:Layout,item:Option<ID>,returned:Option<ID>}
public struct EnhancementIntent has drop {domain:vector<u8>,schema:u16,soul:ID,product:ID,version:u64,policy:vector<u8>,actor:address,attempt:vector<u8>,before_revision:u64,before_recipe:vector<u8>,choices:vector<InstalledChoice>}
/// A purchase description is untrusted input; only actual catalog issuance grants rights.
public fun purchase(definition:vector<u8>,part:soulidity_model::assembly::PartKey,layout:Layout):Purchase{policy::assert_hash(&definition);Purchase{definition,part,layout}}
/// Existing OC enhancement does not mint another Soul or rewrite its genesis Output.
/// One actual product contribution charges its published completion price/quota
/// once, without charging the OC mint fixed fee again. Old free objects return.
public(package) fun enhance_maker<C>(s:&mut Soul,maker:&mut Product<C>,cfg:&mut Config<C>,expected:u64,policy_hash:vector<u8>,choices:vector<Purchase>,attempt:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext):vector<soulidity_model::components::Item>{
 enhance_maker_guard(s,maker,cfg,expected,policy_hash,attempt,fee_revision,expiry,clock,system,ctx);let version=soul::maker_version(s);let snapshot=enhance_prepare(s,maker,cfg,version,policy_hash,&choices,attempt,expiry,&payment,clock,ctx);let session=factory::begin_native(maker,s,cfg,snapshot,payment,operator::operator(),operator::revision(),system,clock,ctx);let(session,returned)=enhance_apply(s,maker,cfg,version,expected,policy_hash,choices,attempt,snapshot,session,ctx);let completion=factory::finish(session,s,cfg,operator::operator(),operator::revision(),system,clock,ctx);origin::consume_completion<ApplicationOperator,ApplicationRevision1,Soul>(completion,s,&snapshot,ctx);returned
}
public(package) fun enhance_pack<C>(s:&mut Soul,pack:&mut Product<C>,maker:&Product<C>,cfg:&mut Config<C>,version:u64,expected:u64,policy_hash:vector<u8>,choices:vector<Purchase>,attempt:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext):vector<soulidity_model::components::Item>{
 enhance_pack_guard(s,pack,maker,cfg,version,expected,policy_hash,fee_revision,expiry,clock,ctx);let snapshot=enhance_prepare(s,pack,cfg,version,policy_hash,&choices,attempt,expiry,&payment,clock,ctx);let session=factory::begin_native_pack(pack,maker,s,cfg,snapshot,payment,operator::operator(),operator::revision(),system,clock,ctx);let(session,returned)=enhance_apply(s,pack,cfg,version,expected,policy_hash,choices,attempt,snapshot,session,ctx);let completion=factory::finish(session,s,cfg,operator::operator(),operator::revision(),system,clock,ctx);origin::consume_completion<ApplicationOperator,ApplicationRevision1,Soul>(completion,s,&snapshot,ctx);returned
}
fun enhance_maker_guard<C>(s:&Soul,maker:&mut Product<C>,cfg:&Config<C>,expected:u64,policy_hash:vector<u8>,attempt:vector<u8>,fee_revision:u64,expiry:u64,clock:&Clock,system:&System,ctx:&mut TxContext){
 soul::assert_revision(s,expected);assert!(catalog::parent(maker).is_none() && object::id(maker)==soul::maker(s) && catalog::protocol(maker)==soul::protocol(s) && soul::protocol(s)==object::id(cfg),EProduct);let version=soul::maker_version(s);economics::assert_primary_live(cfg,fee_revision,expiry,clock);catalog::ensure_access(maker,cfg,version,attempt,fee_revision,expiry,clock,system,ctx);let v=catalog::published(maker,version);assert!(catalog::policy_hash(v)==policy_hash,EProduct);catalog::assert_runtime_access(maker,cfg,version,policy_hash,catalog::manifest(v),fee_revision,economics::commitment(cfg),clock,ctx)
}
fun enhance_pack_guard<C>(s:&mut Soul,pack:&Product<C>,maker:&Product<C>,cfg:&Config<C>,version:u64,expected:u64,policy_hash:vector<u8>,fee_revision:u64,expiry:u64,clock:&Clock,ctx:&TxContext){
 soul::assert_revision(s,expected);assert!(object::id(maker)==soul::maker(s) && soul::protocol(s)==object::id(cfg) && catalog::protocol(pack)==soul::protocol(s),EProduct);economics::assert_primary_live(cfg,fee_revision,expiry,clock);let v=catalog::published(pack,version);assert!(catalog::policy_hash(v)==policy_hash,EProduct);catalog::assert_runtime_pack(pack,maker,soul::maker_version(s),version,cfg,policy_hash,catalog::manifest(v),fee_revision,economics::commitment(cfg),clock,ctx);soul::admit_profile(operator::operator(),s,catalog::assembly_profile(pack,version))
}
fun enhance_prepare<C>(s:&Soul,p:&Product<C>,cfg:&Config<C>,version:u64,policy_hash:vector<u8>,choices:&vector<Purchase>,attempt:vector<u8>,expiry:u64,payment:&Coin<C>,clock:&Clock,ctx:&TxContext):origin::Snapshot{
 assert!(!choices.is_empty() && choices.length()<=512,EChoices);policy::assert_hash(&attempt);let mut parts=vector[];choices.do_ref!(|c|{assert!(!parts.contains(&c.part),EChoices);parts.push_back(c.part);let src=catalog::preview_source(p,version,c.definition);soul::assert_fresh_issuance(s,&src,c.part,&c.layout)});let v=catalog::published(p,version);let quote=economics::primary_quote(&catalog::version_primary(v),cfg,catalog::completion_price(p,version,ctx.sender()),false,catalog::beneficiary(v),object::id(s),policy_hash,ctx.sender(),attempt,expiry);assert!(coin::value(payment)==economics::primary_receipt_total(&quote),EPayment);
 // Request metadata uses the current expiry already checked by the outer gate.
 let snapshot=manufacture::request_native_contribution(p,s,cfg,version,policy_hash,*standard::name(s),attempt,expiry,operator::operator(),operator::revision(),clock,ctx);snapshot
}
fun enhance_apply<C>(s:&mut Soul,p:&mut Product<C>,cfg:&Config<C>,version:u64,expected:u64,policy_hash:vector<u8>,choices:vector<Purchase>,attempt:vector<u8>,snapshot:origin::Snapshot,mut session:Session,ctx:&mut TxContext):(Session,vector<soulidity_model::components::Item>){
 let product=object::id(p);let paid=manufacture::session_receipt(&session);let action=manufacture::take_action(&mut session,p,s,ctx);let contribution=admission::authorize_contribution_action(cfg,p,s,action,paid,operator::operator(),operator::revision(),ctx);let enhancement=soul::begin_enhancement(contribution,s,expected,ctx);let before_recipe=soul::enhancement_start_recipe(&enhancement);let mut returned=vector[];let mut installed=vector[];
 choices.do!(|c|{let(permit,selection)=manufacture::select(&mut session,p,s,c.definition,ctx);let src=*soulidity_model::components::preview(&permit);let previous=soul::replace_issued(&enhancement,s,permit,c.part,c.layout,ctx);manufacture::selected(&mut session,selection,s,operator::operator(),operator::revision(),ctx);let old=previous.map_ref!(|it|object::id(it));previous.do!(|it|returned.push_back(it));let binding=soul::binding_scoped(s,c.part).destroy_some();installed.push_back(InstalledChoice{source:policy::source_hash(&src),part:c.part,layout:c.layout,item:soul::free_id(&binding),returned:old})});let commitment=policy::hash_bytes(std::bcs::to_bytes(&EnhancementIntent{domain:b"soulidity/enhancement/v1",schema:1,soul:object::id(s),product,version,policy:policy_hash,actor:ctx.sender(),attempt,before_revision:expected,before_recipe,choices:installed}));soul::finish_enhancement(enhancement,s,commitment,ctx);let _=snapshot;(session,returned)
}
#[test_only]
public(package) fun enhance_maker_for_testing<C>(s:&mut Soul,maker:&mut Product<C>,cfg:&mut Config<C>,expected:u64,policy_hash:vector<u8>,choices:vector<Purchase>,attempt:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):vector<soulidity_model::components::Item>{enhance_maker_guard_for_testing(s,maker,cfg,expected,policy_hash,attempt,fee_revision,expiry,clock,ctx);let version=soul::maker_version(s);let snapshot=enhance_prepare(s,maker,cfg,version,policy_hash,&choices,attempt,expiry,&payment,clock,ctx);let session=manufacture::begin_native_session_for_testing(maker,s,cfg,snapshot,payment,operator::operator(),operator::revision(),clock,ctx);let(session,returned)=enhance_apply(s,maker,cfg,version,expected,policy_hash,choices,attempt,snapshot,session,ctx);let completion=manufacture::finish_session_for_testing(session,s,operator::operator(),operator::revision(),ctx);origin::consume_completion<ApplicationOperator,ApplicationRevision1,Soul>(completion,s,&snapshot,ctx);returned}
#[test_only]
public(package) fun enhance_pack_for_testing<C>(s:&mut Soul,pack:&mut Product<C>,maker:&Product<C>,cfg:&mut Config<C>,version:u64,expected:u64,policy_hash:vector<u8>,choices:vector<Purchase>,attempt:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):vector<soulidity_model::components::Item>{enhance_pack_guard(s,pack,maker,cfg,version,expected,policy_hash,fee_revision,expiry,clock,ctx);let snapshot=enhance_prepare(s,pack,cfg,version,policy_hash,&choices,attempt,expiry,&payment,clock,ctx);let session=manufacture::begin_native_pack_session_for_testing(pack,maker,s,cfg,snapshot,payment,operator::operator(),operator::revision(),clock,ctx);let(session,returned)=enhance_apply(s,pack,cfg,version,expected,policy_hash,choices,attempt,snapshot,session,ctx);let completion=manufacture::finish_session_for_testing(session,s,operator::operator(),operator::revision(),ctx);origin::consume_completion<ApplicationOperator,ApplicationRevision1,Soul>(completion,s,&snapshot,ctx);returned}
public struct Contribution has copy,drop {product:ID,version:u64,used:u64}
/// No key, store or drop: unfinished assemblies cannot survive transaction execution.
public struct Build {
    construction:Construction,sessions:vector<Session>,draft:soulidity_application::character::Draft,actor:address,maker:ID,maker_version:u64,protocol:ID,
    attempt:vector<u8>,contributions:vector<Contribution>,intent:Intent,output_policy:Policy,pay_lines:vector<PayLine>,platform_recipient:address,fee_revision:u64,
}

public(package) fun begin<C>(binding:soulidity_maker_admission::maker_issuance::Binding,maker:&mut Product<C>,cfg:&mut Config<C>,intent:Intent,output_key:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext):Build {
    let version=output::intent_version(&intent);let policy_hash=output::intent_policy(&intent);let attempt=output::intent_attempt(&intent);let name=output::intent_name(&intent);
    assert!(catalog::parent(maker).is_none() && catalog::protocol(maker)==object::id(cfg),EProduct);
    assert!(name.length()>0 && name.length()<=128,EProduct);
    economics::assert_primary_live(cfg,fee_revision,expiry,clock);
    catalog::ensure_access(maker,cfg,version,attempt,fee_revision,expiry,clock,system,ctx);
    let av=catalog::published(maker,version);catalog::assert_runtime_access(maker,cfg,version,catalog::policy_hash(av),catalog::manifest(av),fee_revision,economics::commitment(cfg),clock,ctx);
    let v=*catalog::published(maker,version);let output_policy=catalog::output_policy(&v,output_key);output::assert_intent(&intent,object::id(cfg),object::id(maker),version,policy_hash,&output_policy,ctx.sender());
    let(request,witness)=manufacture::request_native_origin_with_witness<C,ApplicationOperator,ApplicationRevision1,Soul>(maker,cfg,version,policy_hash,name,attempt,expiry,operator::operator(),operator::revision(),clock,ctx);let snapshot=origin::snapshot(&request);let mut construction=lifecycle::new(witness,maker,request,ctx);
    let mut session=factory::begin_native(maker,lifecycle::construction_ref(&construction),cfg,snapshot,payment,operator::operator(),operator::revision(),system,clock,ctx);let receipt=manufacture::session_receipt(&session);let action=manufacture::take_action(&mut session,maker,lifecycle::construction_ref(&construction),ctx);
    let resale=soulidity_maker_terms::maker_resale::snapshot(object::id(cfg),object::id(maker),version,policy_hash,catalog::creator(maker),catalog::soul_rates(&v),ctx);let profile=catalog::assembly_profile(maker,version);let metadata=soul::genesis_hash(object::id(cfg),object::id(maker),version,catalog::manifest(&v),catalog::configuration(&v),profile,catalog::required_parts(&v),catalog::adapters(&v),*catalog::scene(&v),resale,catalog::beneficiary(&v),ctx);
    let genesis=admission::authorize_genesis_action(cfg,maker,lifecycle::construction_ref(&construction),binding,action,receipt,metadata,operator::operator(),operator::revision(),ctx);
    let draft=soul::initialize_creation(genesis,lifecycle::construction_mut(&mut construction),object::id(cfg),object::id(maker),version,catalog::manifest(&v),catalog::configuration(&v),profile,catalog::required_parts(&v),catalog::adapters(&v),*catalog::scene(&v),resale,catalog::beneficiary(&v),ctx);
    let primary=catalog::version_primary(&v);
    let line=output::pay_line(object::id(maker),version,policy_hash,receipt);
    Build{construction,sessions:vector[session],draft,actor:ctx.sender(),maker:object::id(maker),maker_version:version,protocol:object::id(cfg),attempt,contributions:vector[Contribution{product:object::id(maker),version,used:0}],intent,output_policy,pay_lines:vector[line],platform_recipient:economics::primary_policy_platform(&primary),fee_revision}
}

/// Pack fees/counts are charged once; finish refuses an included Pack with no selection.
public(package) fun include_pack<C>(b:&mut Build,pack:&mut Product<C>,maker:&Product<C>,cfg:&mut Config<C>,version:u64,policy_hash:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,system:&System,ctx:&mut TxContext) {
    actor(b,ctx);
    assert!(b.fee_revision==fee_revision && b.protocol==object::id(cfg) && catalog::protocol(pack)==b.protocol && object::id(maker)==b.maker,EProduct);
    assert!(!b.contributions.any!(|c| c.product==object::id(pack)),EProduct);
    economics::assert_primary_live(cfg,fee_revision,expiry,clock);
    let av=catalog::published(pack,version);catalog::assert_runtime_pack(pack,maker,b.maker_version,version,cfg,catalog::policy_hash(av),catalog::manifest(av),fee_revision,economics::commitment(cfg),clock,ctx);
    let v=*catalog::published(pack,version);output::assert_pack(&b.output_policy,catalog::pack_key(&v));
    let primary=catalog::version_primary(&v);assert!(economics::primary_policy_platform(&primary)==b.platform_recipient,EProduct);
    let snapshot=manufacture::request_native_contribution(pack,lifecycle::construction_ref(&b.construction),cfg,version,policy_hash,origin::name(&lifecycle::construction_snapshot(&b.construction)),b.attempt,expiry,operator::operator(),operator::revision(),clock,ctx);let mut session=factory::begin_native_pack(pack,maker,lifecycle::construction_ref(&b.construction),cfg,snapshot,payment,operator::operator(),operator::revision(),system,clock,ctx);let paid=manufacture::session_receipt(&session);let action=manufacture::take_action(&mut session,pack,lifecycle::construction_ref(&b.construction),ctx);let contribution=admission::authorize_contribution_action(cfg,pack,lifecycle::construction_ref(&b.construction),action,paid,operator::operator(),operator::revision(),ctx);
    let receipt=soul::admit_contribution_creation(&b.draft,lifecycle::construction_mut(&mut b.construction),contribution,catalog::assembly_profile(pack,version),ctx);b.sessions.push_back(session);
    b.contributions.push_back(Contribution{product:object::id(pack),version,used:0});b.pay_lines.push_back(output::pay_line(object::id(pack),version,policy_hash,receipt));
}

public(package) fun select_scoped<C>(b:&mut Build,product:&mut Product<C>,definition_hash:vector<u8>,part:soulidity_model::assembly::PartKey,layout:Layout,ctx:&mut TxContext) {
    actor(b,ctx);assert!(catalog::protocol(product)==b.protocol,EProduct);
    let index=contribution_index(b,object::id(product));
    let version=b.contributions[index].version;
    let (source,selection)=manufacture::select(&mut b.sessions[index],product,lifecycle::construction_ref(&b.construction),definition_hash,ctx);
    soul::add_issued_creation(&b.draft,lifecycle::construction_mut(&mut b.construction),source,part,layout,ctx);manufacture::selected(&mut b.sessions[index],selection,lifecycle::construction_ref(&b.construction),operator::operator(),operator::revision(),ctx);
    b.contributions[index].used=b.contributions[index].used+1;
}
/// Complete may consume the same actual Player selection used by Physical.
/// This is the first OC issuance; copying a Player selection never issues rights.
public(package) fun select_player_scoped<C>(b:&mut Build,product:&mut Product<C>,p:&Player,part:soulidity_model::assembly::PartKey,expected_player:u64,ctx:&mut TxContext) {
    actor(b,ctx);player::assert_owner(p,expected_player,ctx);assert!(player::maker(p)==b.maker && player::maker_version(p)==b.maker_version && player::protocol(p)==b.protocol,EProduct);
    let selected=player::scoped_selection(p,part).destroy_some();let source=player::source(&selected);let c=contribution_index(b,object::id(product));
    assert!(policy::source_product(source)==object::id(product) && policy::source_version(source)==b.contributions[c].version && catalog::preview_source(product,b.contributions[c].version,policy::source_definition_hash(source))==*source,EProduct);
    soul::set_initial_colors_creation(&b.draft,lifecycle::construction_mut(&mut b.construction),player::colors(p),ctx);player::profiles(p).do_ref!(|profile|{let scope=soulidity_model::assembly::snapshot_scope(profile);if(soul::profile_snapshots(lifecycle::construction_ref(&b.construction)).any!(|x|soulidity_model::assembly::snapshot_scope(x)==scope))soul::set_initial_pack_colors_creation(&b.draft,lifecycle::construction_mut(&mut b.construction),scope,player::pack_colors(p,scope),ctx)});select_scoped(b,product,policy::source_definition_hash(source),part,player::layout(&selected),ctx)
}

public(package) fun append_initial_content(b:&mut Build,registry:&KindRegistry,kind:u32,name:String,blob:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,clock:&Clock,ctx:&TxContext):u64 {
    actor(b,ctx);let rule=output::rule(&b.output_policy,kind,name);
    soul::append_initial_output_content_creation(&b.draft,lifecycle::construction_mut(&mut b.construction),registry,&rule,&b.intent,blob,system,sha256,envelope,clock,ctx)
}
public(package) fun set_initial_state_config(b:&mut Build,key:String,value:vector<u8>,ctx:&mut TxContext){
    actor(b,ctx);soul::set_initial_state_config_creation(&b.draft,lifecycle::construction_mut(&mut b.construction),key,value,ctx)
}
/// Production finalization rechecks the same Config/Clock before Standard delivery.
public(package) fun finish_live<C>(b:Build,cfg:&Config<C>,clock:&Clock,render:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,ctx:&mut TxContext):ID{
    let (construction,mut sessions,recipient)=prepare_finish(b,render,system,sha256,envelope,ctx);
    while(sessions.length()>1){let session=sessions.pop_back();let snapshot=manufacture::session_snapshot(&session);let completion=factory::finish(session,lifecycle::construction_ref(&construction),cfg,operator::operator(),operator::revision(),system,clock,ctx);origin::consume_completion<ApplicationOperator,ApplicationRevision1,Soul>(completion,lifecycle::construction_ref(&construction),&snapshot,ctx)};
    let session=sessions.pop_back();sessions.destroy_empty();let completion=factory::finish(session,lifecycle::construction_ref(&construction),cfg,operator::operator(),operator::revision(),system,clock,ctx);lifecycle::deliver(construction,completion,recipient,ctx)
}
/// Historical fixture signature retains its assertions, not production liveness proof.
#[test_only]
public(package) fun finish(b:Build,render:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,ctx:&mut TxContext):ID{
    let (construction,mut sessions,recipient)=prepare_finish(b,render,system,sha256,envelope,ctx);
    while(sessions.length()>1){let session=sessions.pop_back();let snapshot=manufacture::session_snapshot(&session);let completion=manufacture::finish_session_for_testing(session,lifecycle::construction_ref(&construction),operator::operator(),operator::revision(),ctx);origin::consume_completion<ApplicationOperator,ApplicationRevision1,Soul>(completion,lifecycle::construction_ref(&construction),&snapshot,ctx)};
    let session=sessions.pop_back();sessions.destroy_empty();let completion=manufacture::finish_session_for_testing(session,lifecycle::construction_ref(&construction),operator::operator(),operator::revision(),ctx);lifecycle::deliver(construction,completion,recipient,ctx)
}
fun prepare_finish(b:Build,render:Blob,system:&System,sha256:vector<u8>,envelope:vector<u8>,ctx:&mut TxContext):(Construction,vector<Session>,address){
    actor(&b,ctx);let mut i=1;while(i < b.contributions.length()){assert!(b.contributions[i].used>0,EUnused);i=i+1};
    output::initials(&b.output_policy).do_ref!(|r|assert!(soul::content_index(lifecycle::construction_ref(&b.construction),output::rule_kind(r),output::rule_name(r),0).is_some(),EInitial));let recipe=soul::semantic_recipe(lifecycle::construction_ref(&b.construction));assert!(soul::semantic_recipe_hash(lifecycle::construction_ref(&b.construction))==output::intent_recipe(&b.intent),ERecipe);
    let Build{mut construction,sessions,draft,actor,maker:_,maker_version:_,protocol:_,attempt:_,contributions:_,intent,output_policy,pay_lines,platform_recipient,fee_revision}=b;let receipt=output::receipt(pay_lines,platform_recipient,fee_revision);
    let root=lifecycle::construction_ref(&construction);let scene=*soul::scene(root);let colors=soul::colors(root);let artifact=soul::create_output(&draft,root,intent,output_policy,recipe,scene,colors,soul::semantic_profiles(root),soul::published_profiles(root),render,system,sha256,envelope,receipt,ctx);soul::install_output_creation(operator::operator(),lifecycle::construction_mut(&mut construction),artifact);soul::finalize_creation(draft,lifecycle::construction_mut(&mut construction),actor,ctx);(construction,sessions,actor)
}
/// The recovery policy is unavailable after any successful Complete for this attempt.
/// Already fetched plaintext/keys remain outside onchain revocation guarantees.
public fun seal_approve_upload_recovery<C>(id:vector<u8>,maker:&Product<C>,intent:Intent,output_key:vector<u8>,ctx:&TxContext) {
    let version=output::intent_version(&intent);let v=catalog::published(maker,version);let policy=catalog::output_policy(v,output_key);
    output::assert_intent(&intent,catalog::protocol(maker),object::id(maker),version,catalog::policy_hash(v),&policy,ctx.sender());
    assert!(id==output::recovery_id(&intent) && catalog::receipt(maker,ctx.sender(),2,output::intent_attempt(&intent)).is_none(),EInitial)
}
public fun output_intent(b:&Build):&Intent{&b.intent}
public fun output_policy(b:&Build):&Policy{&b.output_policy}
public fun semantic_recipe_hash(b:&Build):vector<u8>{soul::semantic_recipe_hash(lifecycle::construction_ref(&b.construction))}
public(package) fun select_colors(b:&mut Build,colors:vector<soulidity_visual::visual::ColorChoice>,ctx:&TxContext){actor(b,ctx);soul::set_initial_colors_creation(&b.draft,lifecycle::construction_mut(&mut b.construction),colors,ctx)}
public fun soul_id(b:&Build):ID{object::id(lifecycle::construction_ref(&b.construction))}
fun actor(b:&Build,ctx:&TxContext){assert!(b.actor==ctx.sender(),EActor)}
fun contribution_index(b:&Build,product:ID):u64 {
    let mut i=0;while(i < b.contributions.length()){if(b.contributions[i].product==product)return i;i=i+1};abort EProduct
}

/// Root-name convenience for unit fixtures; production Runtime uses scoped paths.
#[test_only]
public(package) fun select<C>(b:&mut Build,product:&mut Product<C>,definition_hash:vector<u8>,part:vector<u8>,layout:Layout,ctx:&mut TxContext){select_scoped(b,product,definition_hash,soulidity_model::assembly::root_part(part),layout,ctx)}
/// Root-name convenience for unit fixtures; production Runtime uses scoped paths.
#[test_only]
public(package) fun select_player<C>(b:&mut Build,product:&mut Product<C>,p:&Player,part:vector<u8>,expected_player:u64,ctx:&mut TxContext){select_player_scoped(b,product,p,soulidity_model::assembly::root_part(part),expected_player,ctx)}

public(package) fun product_version(b:&Build,product:ID):u64{b.contributions[contribution_index(b,product)].version}


/// Historical raw original regression assembly; not production availability proof.
#[test_only]
public(package) fun begin_for_testing<C>(binding:soulidity_maker_admission::maker_issuance::Binding,maker:&mut Product<C>,cfg:&mut Config<C>,intent:Intent,output_key:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext):Build {
    let version=output::intent_version(&intent);let policy_hash=output::intent_policy(&intent);let attempt=output::intent_attempt(&intent);let name=output::intent_name(&intent);
    assert!(catalog::parent(maker).is_none() && catalog::protocol(maker)==object::id(cfg),EProduct);
    assert!(name.length()>0 && name.length()<=128,EProduct);
    economics::assert_primary_live(cfg,fee_revision,expiry,clock);
    catalog::ensure_access_for_testing(maker,cfg,version,attempt,fee_revision,expiry,clock,ctx);
    let av=catalog::published(maker,version);catalog::assert_runtime_access(maker,cfg,version,catalog::policy_hash(av),catalog::manifest(av),fee_revision,economics::commitment(cfg),clock,ctx);
    let v=*catalog::published(maker,version);let output_policy=catalog::output_policy(&v,output_key);output::assert_intent(&intent,object::id(cfg),object::id(maker),version,policy_hash,&output_policy,ctx.sender());
    let(request,witness)=manufacture::request_native_origin_with_witness<C,ApplicationOperator,ApplicationRevision1,Soul>(maker,cfg,version,policy_hash,name,attempt,expiry,operator::operator(),operator::revision(),clock,ctx);let snapshot=origin::snapshot(&request);let mut construction=lifecycle::new(witness,maker,request,ctx);
    let mut session=manufacture::begin_native_session_for_testing(maker,lifecycle::construction_ref(&construction),cfg,snapshot,payment,operator::operator(),operator::revision(),clock,ctx);let receipt=manufacture::session_receipt(&session);let action=manufacture::take_action(&mut session,maker,lifecycle::construction_ref(&construction),ctx);
    let resale=soulidity_maker_terms::maker_resale::snapshot(object::id(cfg),object::id(maker),version,policy_hash,catalog::creator(maker),catalog::soul_rates(&v),ctx);let profile=catalog::assembly_profile(maker,version);let metadata=soul::genesis_hash(object::id(cfg),object::id(maker),version,catalog::manifest(&v),catalog::configuration(&v),profile,catalog::required_parts(&v),catalog::adapters(&v),*catalog::scene(&v),resale,catalog::beneficiary(&v),ctx);
    let genesis=admission::authorize_genesis_action(cfg,maker,lifecycle::construction_ref(&construction),binding,action,receipt,metadata,operator::operator(),operator::revision(),ctx);
    let draft=soul::initialize_creation(genesis,lifecycle::construction_mut(&mut construction),object::id(cfg),object::id(maker),version,catalog::manifest(&v),catalog::configuration(&v),profile,catalog::required_parts(&v),catalog::adapters(&v),*catalog::scene(&v),resale,catalog::beneficiary(&v),ctx);
    let primary=catalog::version_primary(&v);
    let line=output::pay_line(object::id(maker),version,policy_hash,receipt);
    Build{construction,sessions:vector[session],draft,actor:ctx.sender(),maker:object::id(maker),maker_version:version,protocol:object::id(cfg),attempt,contributions:vector[Contribution{product:object::id(maker),version,used:0}],intent,output_policy,pay_lines:vector[line],platform_recipient:economics::primary_policy_platform(&primary),fee_revision}
}
#[test_only]
public(package) fun include_pack_for_testing<C>(b:&mut Build,pack:&mut Product<C>,maker:&Product<C>,cfg:&mut Config<C>,version:u64,policy_hash:vector<u8>,fee_revision:u64,expiry:u64,payment:Coin<C>,clock:&Clock,ctx:&mut TxContext) {
    actor(b,ctx);
    assert!(b.fee_revision==fee_revision && b.protocol==object::id(cfg) && catalog::protocol(pack)==b.protocol && object::id(maker)==b.maker,EProduct);
    assert!(!b.contributions.any!(|c| c.product==object::id(pack)),EProduct);
    economics::assert_primary_live(cfg,fee_revision,expiry,clock);
    let av=catalog::published(pack,version);catalog::assert_runtime_pack(pack,maker,b.maker_version,version,cfg,catalog::policy_hash(av),catalog::manifest(av),fee_revision,economics::commitment(cfg),clock,ctx);
    let v=*catalog::published(pack,version);output::assert_pack(&b.output_policy,catalog::pack_key(&v));
    let primary=catalog::version_primary(&v);assert!(economics::primary_policy_platform(&primary)==b.platform_recipient,EProduct);
    let snapshot=manufacture::request_native_contribution(pack,lifecycle::construction_ref(&b.construction),cfg,version,policy_hash,origin::name(&lifecycle::construction_snapshot(&b.construction)),b.attempt,expiry,operator::operator(),operator::revision(),clock,ctx);let mut session=manufacture::begin_native_pack_session_for_testing(pack,maker,lifecycle::construction_ref(&b.construction),cfg,snapshot,payment,operator::operator(),operator::revision(),clock,ctx);let paid=manufacture::session_receipt(&session);let action=manufacture::take_action(&mut session,pack,lifecycle::construction_ref(&b.construction),ctx);let contribution=admission::authorize_contribution_action(cfg,pack,lifecycle::construction_ref(&b.construction),action,paid,operator::operator(),operator::revision(),ctx);
    let receipt=soul::admit_contribution_creation(&b.draft,lifecycle::construction_mut(&mut b.construction),contribution,catalog::assembly_profile(pack,version),ctx);b.sessions.push_back(session);
    b.contributions.push_back(Contribution{product:object::id(pack),version,used:0});b.pay_lines.push_back(output::pay_line(object::id(pack),version,policy_hash,receipt));
}

#[test_only]
fun enhance_maker_guard_for_testing<C>(s:&Soul,maker:&mut Product<C>,cfg:&Config<C>,expected:u64,policy_hash:vector<u8>,attempt:vector<u8>,fee_revision:u64,expiry:u64,clock:&Clock,ctx:&mut TxContext){
 soul::assert_revision(s,expected);assert!(catalog::parent(maker).is_none() && object::id(maker)==soul::maker(s) && catalog::protocol(maker)==soul::protocol(s) && soul::protocol(s)==object::id(cfg),EProduct);let version=soul::maker_version(s);economics::assert_primary_live(cfg,fee_revision,expiry,clock);catalog::ensure_access_for_testing(maker,cfg,version,attempt,fee_revision,expiry,clock,ctx);let v=catalog::published(maker,version);assert!(catalog::policy_hash(v)==policy_hash,EProduct);catalog::assert_runtime_access(maker,cfg,version,policy_hash,catalog::manifest(v),fee_revision,economics::commitment(cfg),clock,ctx)
}
