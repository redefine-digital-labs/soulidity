/// Pure nominal source attestation. Payment, product validity and live Clock
/// checks remain the genuine producer's duties. A copied Snapshot is metadata.
module soulidity_origin_protocol::producer_origin;
use std::type_name::{Self, TypeName};
use std::string::String;
const EProducer: u64 = 1;
const EIdentity: u64 = 2;
const EActor: u64 = 3;
const EAction: u64 = 4;

public struct Snapshot has copy, drop, store {
    producer: TypeName, source_type: TypeName, source: ID, version: u64,
    policy: vector<u8>, actor: address, name: String, attempt: vector<u8>,
    config: ID, revision: u64, commitment: vector<u8>, expiry: u64,
    operation: u8, adapter: TypeName, adapter_revision: TypeName, target_type: TypeName,
}
public struct OriginRequest { snapshot: Snapshot }
public struct PaidAction { producer: TypeName, snapshot: Snapshot, target: ID, receipt: vector<u8> }
public struct CompletionAuthorization { snapshot: Snapshot, target: ID }

fun assert_producer<W, P>(name: vector<u8>) {
    let w = type_name::with_original_ids<W>();
    let p = type_name::with_original_ids<P>();
    assert!(!w.is_primitive() && !p.is_primitive()
        && w.address_string() == p.address_string()
        && w.module_string() == p.module_string()
        && *w.datatype_string().as_bytes() == name, EProducer)
}
public fun request<W: drop, P: key, A: drop, R: drop, T: key>(
    _w: W, p: &P, _a: A, _r: R, version: u64, policy: vector<u8>,
    name: String, attempt: vector<u8>, config: ID, revision: u64,
    commitment: vector<u8>, expiry: u64, operation: u8, ctx: &TxContext,
): OriginRequest {
    assert_producer<W, P>(b"SoulProducer");
    assert!(version > 0 && policy.length() == 32 && attempt.length() == 32
        && commitment.length() == 32, EIdentity);
    OriginRequest { snapshot: Snapshot {
        producer: type_name::with_defining_ids<W>(),
        source_type: type_name::with_defining_ids<P>(), source: object::id(p),
        version, policy, actor: ctx.sender(), name, attempt, config, revision,
        commitment, expiry, operation, adapter: type_name::with_defining_ids<A>(),
        adapter_revision: type_name::with_defining_ids<R>(),
        target_type: type_name::with_defining_ids<T>(),
    } }
}
public fun snapshot(request: &OriginRequest): Snapshot { request.snapshot }
public fun consume_request<T: key>(request: OriginRequest, ctx: &TxContext): Snapshot {
    let OriginRequest { snapshot } = request;
    assert!(snapshot.actor == ctx.sender()
        && snapshot.target_type == type_name::with_defining_ids<T>(), EActor);
    snapshot
}
/// This proves which real producer emitted an action, not that this leaf
/// independently executed settlement. The source must check actual payment.
public fun authorize_action<W: drop, P: key, T: key>(
    _w: W, p: &P, target: &T, snapshot: Snapshot, receipt: vector<u8>, ctx: &TxContext,
): PaidAction {
    assert_producer<W, P>(b"ManufacturingProducer");
    assert_actual(&snapshot, p, target, ctx);
    assert!(receipt.length() == 32, EIdentity);
    PaidAction { producer: type_name::with_defining_ids<W>(), snapshot, target: object::id(target), receipt }
}
public fun consume_action<A: drop, R: drop, T: key>(
    action: PaidAction, _a: A, _r: R, target: &T, operation: u8, ctx: &TxContext,
): (Snapshot, vector<u8>) {
    let PaidAction { producer: _, snapshot, target: id, receipt } = action;
    assert_adapter<A, R, T>(&snapshot, target, ctx);
    assert!(id == object::id(target) && snapshot.operation == operation, EAction);
    (snapshot, receipt)
}
/// Only the same actual defining SoulProducer can complete its snapshot.
/// Genuine producers are responsible for live Clock and business readiness.
public fun complete<W: drop, P: key, T: key>(
    _w: W, p: &P, target: &T, snapshot: Snapshot, ctx: &TxContext,
): CompletionAuthorization {
    assert_producer<W, P>(b"SoulProducer");
    assert!(snapshot.producer == type_name::with_defining_ids<W>(), EProducer);
    assert_actual(&snapshot, p, target, ctx);
    CompletionAuthorization { snapshot, target: object::id(target) }
}
public fun consume_completion<A, R, T: key>(
    completion: CompletionAuthorization, target: &T, expected: &Snapshot, ctx: &TxContext,
) {
    let CompletionAuthorization { snapshot, target: id } = completion;
    assert!(id == object::id(target) && snapshot == *expected, EIdentity);
    assert_adapter<A, R, T>(&snapshot, target, ctx)
}
public fun consume_delivery<T: key>(
    completion: CompletionAuthorization, target: &T, expected: &Snapshot, ctx: &TxContext,
) {
    let CompletionAuthorization { snapshot, target: id } = completion;
    assert!(id == object::id(target) && snapshot == *expected
        && snapshot.target_type == type_name::with_defining_ids<T>()
        && snapshot.actor == ctx.sender(), EIdentity)
}
fun assert_actual<P: key, T: key>(snapshot: &Snapshot, p: &P, _target: &T, ctx: &TxContext) {
    assert!(snapshot.source == object::id(p)
        && snapshot.source_type == type_name::with_defining_ids<P>()
        && snapshot.target_type == type_name::with_defining_ids<T>()
        && snapshot.actor == ctx.sender(), EIdentity)
}
public fun assert_adapter<A, R, T: key>(snapshot: &Snapshot, _target: &T, ctx: &TxContext) {
    assert!(snapshot.actor == ctx.sender()
        && snapshot.adapter == type_name::with_defining_ids<A>()
        && snapshot.adapter_revision == type_name::with_defining_ids<R>()
        && snapshot.target_type == type_name::with_defining_ids<T>(), EAction)
}
public fun source(s: &Snapshot): ID { s.source }
public fun source_type(s: &Snapshot): TypeName { s.source_type }
public fun producer(s: &Snapshot): TypeName { s.producer }
public fun version(s: &Snapshot): u64 { s.version }
public fun policy(s: &Snapshot): vector<u8> { s.policy }
public fun actor(s: &Snapshot): address { s.actor }
public fun name(s: &Snapshot): String { s.name }
public fun attempt(s: &Snapshot): vector<u8> { s.attempt }
public fun config(s: &Snapshot): ID { s.config }
public fun revision(s: &Snapshot): u64 { s.revision }
public fun commitment(s: &Snapshot): vector<u8> { s.commitment }
public fun expiry(s: &Snapshot): u64 { s.expiry }
public fun operation(s: &Snapshot): u8 { s.operation }
public fun adapter(s: &Snapshot): TypeName { s.adapter }
public fun adapter_revision(s: &Snapshot): TypeName { s.adapter_revision }
public fun target_type(s: &Snapshot): TypeName { s.target_type }

public fun action_producer(action: &PaidAction): TypeName { action.producer }
