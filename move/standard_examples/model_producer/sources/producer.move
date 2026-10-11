/// Independent free issuer prototype. No native Maker, paid Complete or native Item issuance,
/// Walrus or market authority is obtained by using the shared value formats.
module independent_model_producer::producer;
use std::bcs;
use std::string::String;
use soulidity_model::policy::{Self,Definition,Source};
use soulidity_model::assembly::{Self,Profile};
use soulidity_model::components::{Self,Permit};
use soulidity_visual::visual::{Self,Scene};
use soulidity_foundation::economics::{Self,Config,MarketPolicy,PrimaryPolicy};
use soulidity_standard::soul::{Self,Soul};

public struct Product has key,store {
    id:UID,protocol:ID,version:u64,definition:Definition,scene:Scene,
    market:MarketPolicy,primary:PrimaryPolicy,creator:address,issued:u64,components_issued:u64,
}
public struct SoulProducer has drop {}
public struct PolicyProducer has drop {}
public struct ComponentProducer has drop {}
public struct VisualWitness has drop {}
public struct VisualProfile has key,store {id:UID,profile:Profile}

public fun create<C>(cfg:&Config<C>,definition:Definition,scene:Scene,ctx:&mut TxContext):Product{
    visual::assert_native(policy::representation(&definition),&scene);
    assert!(visual::parts(&scene).contains(&policy::definition_part(&definition)),0);
    Product{id:object::new(ctx),protocol:object::id(cfg),version:1,definition,scene,
        market:economics::market_policy(cfg,0,ctx),primary:economics::primary_policy(cfg),creator:ctx.sender(),issued:0,components_issued:0}
}
public fun preview(p:&Product):Source{
    policy::source(PolicyProducer{},p,object::id(p),p.version,p.version,p.protocol,0,p.creator,p.market,p.primary,p.definition)
}
public fun profile(p:&Product):Profile{
    let scope=assembly::scope(PolicyProducer{},p,p.protocol,p.version,policy::definition_hash(&p.definition));
    assembly::profile(PolicyProducer{},p,scope,option::none(),p.scene,vector[policy::definition_part(&p.definition)],vector[])
}
public fun mint(p:&mut Product,name:String,ctx:&mut TxContext):soul::Creation{
    assert!(p.issued < policy::supply(&p.definition),1);p.issued=p.issued+1;
    let mut s=soul::new(SoulProducer{},p,p.version,policy::definition_hash(&p.definition),name,ctx);
    let profile=profile(p);let semantic=policy::hash_bytes(bcs::to_bytes(&profile));
    soul::creation_install(&mut s,VisualWitness{},b"appearance",VisualProfile{id:object::new(ctx),profile},1,false,semantic,0);
    s
}
public fun issued(p:&Product):u64{p.issued}
public fun installed(s:&Soul):&Profile{&soul::borrow_module<VisualWitness,VisualProfile>(s,b"appearance").profile}

/// Independent creator attests its own Free supply; this is not a native paid
/// Complete entry or a reference/bound recording implementation.
public fun issue_component(p:&mut Product,target:&Soul):Permit{
    assert!(policy::rights(&preview(p))==policy::transferable() && p.components_issued < policy::supply(&p.definition),2);
    p.components_issued=p.components_issued+1;let source=preview(p);
    components::authorize(ComponentProducer{},p,target,source)
}
public fun components_issued(p:&Product):u64{p.components_issued}

/// Fixture obtains the actual public terminal's owned root in a later
/// transaction; it neither unpacks Creation nor grants raw fresh authority.
#[test_only]
public fun mint_owned_for_testing(p:&mut Product,name:String,sc:&mut sui::test_scenario::Scenario):Soul {
    let c=mint(p,name,sc.ctx());let id=soul::creation_id(&c);
    soul::creation_deliver_sender(c,sc.ctx());let actor=sc.sender();sc.next_tx(actor);
    sc.take_from_sender_by_id(id)
}
