/// Optional, permanent experience journal. Source attestation is not a reward
/// oracle: the actual Soul custodian explicitly accepts every receipt.
module soulidity_application::growth;

use std::bcs;
use std::hash;
use std::type_name::{Self,TypeName};
use sui::clock::{Self,Clock};
use sui::table::{Self,Table};
use sui::event;
use soulidity_standard::soul::{Self as standard,Soul};

const ERevision:u64=1;const EAuthority:u64=2;const EInput:u64=3;
const EPolicy:u64=4;const ETime:u64=5;const ETarget:u64=6;
const EReplay:u64=7;const ESequence:u64=8;
public struct Witness has drop {}
public struct SourceKey has copy,drop,store {
    producer:TypeName,source_type:TypeName,source:ID,ruleset:vector<u8>,
}
public struct StreamKey has copy,drop,store {source:SourceKey,run:vector<u8>}
public struct EventKey has copy,drop,store {stream:StreamKey,event:vector<u8>}
public struct Policy has copy,drop,store {
    source:SourceKey,version:u64,generation:u64,revision:u64,
    schema:u16,expires_ms:u64,enabled:bool,
}
/// Private fields prevent fabrication. Copying is intentional: asynchronous
/// applications can store it in their own outbox, and the journal rejects reuse.
/// This value is not a key asset, mint permit or content read authorization.
public struct Receipt has copy,drop,store {
    domain:vector<u8>,schema:u16,target:ID,source:SourceKey,source_version:u64,
    generation:u64,policy_revision:u64,run:vector<u8>,event:vector<u8>,sequence:u64,
    occurred_ms:u64,issued_ms:u64,expires_ms:u64,evidence:vector<u8>,content:vector<u8>,
}
public struct Accepted has copy,drop,store {receipt:Receipt,actor:address,accepted_ms:u64}
public struct Change has copy,drop,store {
    domain:vector<u8>,root:ID,sequence:u64,operation:u8,generation:u64,
    actor:address,time_ms:u64,policy:Option<Policy>,accepted:Option<Accepted>,
    previous:vector<u8>,
}
public struct Journal has key,store {
    id:UID,root:ID,revision:u64,generation:u64,accepted:u64,policies:u64,
    policy:Table<SourceKey,Policy>,streams:Table<StreamKey,u64>,
    seen:Table<EventKey,u64>,history:Table<u64,Change>,head:vector<u8>,
}
public struct Changed has copy,drop {root:ID,sequence:u64,operation:u8,commitment:vector<u8>}

fun digest<T>(v:&T):vector<u8>{hash::sha3_256(bcs::to_bytes(v))}
fun hash32(v:&vector<u8>){assert!(v.length()==32,EInput)}
fun label(v:&vector<u8>){assert!(v.length()>0 && v.length()<=64,EInput)}
fun source_key<W,P: key>(source:&P,ruleset:vector<u8>):SourceKey{
    let w=type_name::with_original_ids<W>();let p=type_name::with_original_ids<P>();
    assert!(!w.is_primitive() && w.address_string()==p.address_string()
        && w.module_string()==p.module_string()
        && *w.datatype_string().as_bytes()==b"GrowthProducer",EAuthority);
    hash32(&ruleset);SourceKey{producer:w,source_type:p,source:object::id(source),ruleset}
}
/// Only the source's own private designated marker can attest a receipt.
/// Ruleset/version/event truth is that application's attestation. Holder policy
/// pins them; no claim is made that this module verifies an offchain simulation.
public fun issue<W:drop,P:key>(
    witness:W,source:&P,target:ID,ruleset:vector<u8>,source_version:u64,
    generation:u64,policy_revision:u64,run:vector<u8>,event:vector<u8>,sequence:u64,
    schema:u16,occurred_ms:u64,expires_ms:u64,evidence:vector<u8>,content:vector<u8>,clock:&Clock,
):Receipt{
    let key=source_key<W,P>(source,ruleset);let _=witness;
    label(&run);label(&event);hash32(&evidence);hash32(&content);
    assert!(source_version>0 && policy_revision>0 && sequence>0 && schema>0,EInput);
    let now=clock::timestamp_ms(clock);
    assert!(occurred_ms<=now && now < expires_ms,ETime);
    Receipt{domain:b"soulidity/growth-receipt/v1",schema,target,source:key,source_version,
        generation,policy_revision,run,event,sequence,occurred_ms,issued_ms:now,expires_ms,evidence,content}
}
public fun installed(s:&Soul):bool{standard::descriptor<Witness>(s,b"growth").is_some()}
public fun journal(s:&Soul):&Journal{standard::borrow_module<Witness,Journal>(s,b"growth")}
public fun revision(j:&Journal):u64{j.revision}
public fun generation(j:&Journal):u64{j.generation}
public fun root(j:&Journal):ID{j.root}
public fun accepted_count(j:&Journal):u64{j.accepted}
public fun policy_count(j:&Journal):u64{j.policies}
public fun history_head(j:&Journal):vector<u8>{j.head}
public fun history(j:&Journal,sequence:u64):Change{
    assert!(sequence>0 && sequence<=j.revision,EInput);*j.history.borrow(sequence)
}
public fun history_page(j:&Journal,offset:u64,limit:u64):vector<Change>{
    assert!(offset>0 && offset<=j.revision+1 && limit<=64,EInput);
    let end=if(limit < j.revision+1-offset)offset+limit else j.revision+1;
    let mut rows=vector[];let mut i=offset;
    while(i < end){rows.push_back(*j.history.borrow(i));i=i+1};rows
}
public fun policy<W,P:key>(j:&Journal,source:&P,ruleset:vector<u8>):Option<Policy>{
    let key=source_key<W,P>(source,ruleset);
    if(j.policy.contains(key))option::some(*j.policy.borrow(key)) else option::none()
}
public fun policy_revision(p:&Policy):u64{p.revision}
public fun policy_enabled(j:&Journal,p:&Policy,clock:&Clock):bool{
    p.enabled && p.generation==j.generation && clock::timestamp_ms(clock)<p.expires_ms
}
public fun policy_hash(p:&Policy):vector<u8>{digest(p)}
public fun receipt_hash(r:&Receipt):vector<u8>{digest(r)}
public fun receipt_target(r:&Receipt):ID{r.target}
public fun receipt_source(r:&Receipt):ID{r.source.source}
public fun receipt_sequence(r:&Receipt):u64{r.sequence}
public fun receipt_run(r:&Receipt):vector<u8>{r.run}
public fun receipt_event(r:&Receipt):vector<u8>{r.event}
public fun receipt_content(r:&Receipt):vector<u8>{r.content}
public fun receipt_evidence(r:&Receipt):vector<u8>{r.evidence}
public fun change_hash(c:&Change):vector<u8>{digest(c)}
public fun change_previous(c:&Change):vector<u8>{c.previous}
public fun change_actor(c:&Change):address{c.actor}
public fun change_accepted(c:&Change):Option<Accepted>{c.accepted}
public fun accepted_receipt(a:&Accepted):Receipt{a.receipt}
public fun accepted_actor(a:&Accepted):address{a.actor}
public fun accepted_at_ms(a:&Accepted):u64{a.accepted_ms}
public fun accepted_at(j:&Journal,r:&Receipt):Option<u64>{
    let key=event_key(r);if(j.seen.contains(key))option::some(*j.seen.borrow(key)) else option::none()
}
fun event_key(r:&Receipt):EventKey{EventKey{stream:StreamKey{source:r.source,run:r.run},event:r.event}}
fun cas(s:&Soul,expected_journal:u64,expected_root:u64){
    assert!(standard::revision(s)==expected_root,ERevision);
    assert!((if(installed(s))journal(s).revision else 0)==expected_journal,ERevision)
}
fun ensure(s:&mut Soul,ctx:&mut TxContext){
    if(!installed(s)){
        let j=Journal{id:object::new(ctx),root:object::id(s),revision:0,generation:0,accepted:0,policies:0,
            policy:table::new(ctx),streams:table::new(ctx),seen:table::new(ctx),history:table::new(ctx),head:vector[]};
        let hash=digest(&j);let revision=standard::revision(s);
        standard::install(s,Witness{},b"growth",j,1,false,hash,revision)
    }
}
fun append(j:&mut Journal,operation:u8,policy:Option<Policy>,accepted:Option<Accepted>,clock:&Clock,ctx:&TxContext){
    j.revision=j.revision+1;
    let row=Change{domain:b"soulidity/growth-change/v1",root:j.root,sequence:j.revision,operation,
        generation:j.generation,actor:ctx.sender(),time_ms:clock::timestamp_ms(clock),policy,accepted,previous:j.head};
    j.head=digest(&row);j.history.add(j.revision,row);
    event::emit(Changed{root:j.root,sequence:j.revision,operation,commitment:j.head})
}
fun close(s:&mut Soul,j:Journal,ticket:standard::Edit<Witness,Journal>){
    let hash=digest(&j);standard::commit_update(s,ticket,Witness{},j,1,hash)
}
/// Requires actual mutable Soul custody. A shared/parent container MUST verify
/// its own authority before lending/withdrawing that value; no UID escape exists.
public fun authorize<W:drop,P:key>(
    s:&mut Soul,source:&P,ruleset:vector<u8>,source_version:u64,schema:u16,expires_ms:u64,
    expected_policy:u64,expected_journal:u64,expected_root:u64,clock:&Clock,ctx:&mut TxContext,
){
    cas(s,expected_journal,expected_root);let key=source_key<W,P>(source,ruleset);
    assert!(source_version>0 && schema>0,EInput);assert!(clock::timestamp_ms(clock)<expires_ms,ETime);
    ensure(s,ctx);let revision=standard::revision(s);
    let(mut j,ticket)=standard::begin_update<Witness,Journal>(s,Witness{},b"growth",revision);
    let exists=j.policy.contains(key);let previous=if(exists)j.policy.borrow(key).revision else 0;
    assert!(previous==expected_policy,ERevision);
    let p=Policy{source:key,version:source_version,generation:j.generation,revision:previous+1,schema,expires_ms,enabled:true};
    if(exists)*j.policy.borrow_mut(key)=p else{j.policy.add(key,p);j.policies=j.policies+1};
    append(&mut j,0,option::some(p),option::none(),clock,ctx);close(s,j,ticket)
}
public fun revoke<W,P:key>(
    s:&mut Soul,source:&P,ruleset:vector<u8>,expected_policy:u64,expected_journal:u64,expected_root:u64,clock:&Clock,ctx:&mut TxContext,
){
    cas(s,expected_journal,expected_root);let key=source_key<W,P>(source,ruleset);let revision=standard::revision(s);
    let(mut j,ticket)=standard::begin_update<Witness,Journal>(s,Witness{},b"growth",revision);
    assert!(j.policy.contains(key),EPolicy);let mut p=*j.policy.borrow(key);
    assert!(p.revision==expected_policy,ERevision);p.revision=p.revision+1;p.enabled=false;
    *j.policy.borrow_mut(key)=p;append(&mut j,1,option::some(p),option::none(),clock,ctx);close(s,j,ticket)
}
/// O(1) invalidation of all pending sources. Neither history nor replay tombstones
/// are cleared. Reauthorization must use the previous monotonically increasing
/// policy revision, even after transfer/reset; no free-transfer hook is assumed.
public fun reset_sources(s:&mut Soul,expected_journal:u64,expected_root:u64,clock:&Clock,ctx:&mut TxContext){
    cas(s,expected_journal,expected_root);ensure(s,ctx);let revision=standard::revision(s);
    let(mut j,ticket)=standard::begin_update<Witness,Journal>(s,Witness{},b"growth",revision);
    j.generation=j.generation+1;append(&mut j,2,option::none(),option::none(),clock,ctx);close(s,j,ticket)
}
public fun accept(s:&mut Soul,r:Receipt,expected_journal:u64,expected_root:u64,clock:&Clock,ctx:&mut TxContext){
    cas(s,expected_journal,expected_root);assert!(r.target==object::id(s),ETarget);
    assert!(installed(s),EPolicy);let revision=standard::revision(s);
    let(mut j,ticket)=standard::begin_update<Witness,Journal>(s,Witness{},b"growth",revision);
    assert!(j.policy.contains(r.source),EPolicy);let p=*j.policy.borrow(r.source);
    assert!(p.enabled && p.generation==j.generation && r.generation==j.generation
        && p.revision==r.policy_revision && p.version==r.source_version && p.schema==r.schema,EPolicy);
    let now=clock::timestamp_ms(clock);
    assert!(r.occurred_ms<=r.issued_ms && r.issued_ms<=now && now < r.expires_ms
        && now < p.expires_ms && r.expires_ms<=p.expires_ms,ETime);
    let key=event_key(&r);assert!(!j.seen.contains(key),EReplay);
    let stream=key.stream;let previous=if(j.streams.contains(stream))*j.streams.borrow(stream) else 0;
    assert!(r.sequence==previous+1,ESequence);
    if(previous==0)j.streams.add(stream,r.sequence) else *j.streams.borrow_mut(stream)=r.sequence;
    let accepted_sequence=j.revision+1;j.seen.add(key,accepted_sequence);j.accepted=j.accepted+1;
    append(&mut j,3,option::some(p),option::some(Accepted{receipt:r,actor:ctx.sender(),accepted_ms:now}),clock,ctx);close(s,j,ticket)
}
