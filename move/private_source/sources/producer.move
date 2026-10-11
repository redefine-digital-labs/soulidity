/// Independent concrete source for compiler/VM attestation tests. It is not the
/// Maker payment runtime and does not claim a payment or deployment receipt.
module private_source::producer;
use std::string;
use soulidity_origin_protocol::producer_origin::{Self, OriginRequest, Snapshot, PaidAction, CompletionAuthorization};
public struct SoulProducer has drop {}
public struct ManufacturingProducer has drop {}
public struct Adapter has drop {}
public struct Revision has drop {}
public struct Source has key, store { id: UID, version: u64, policy: vector<u8>, config: ID, revision: u64, commitment: vector<u8>, expiry: u64 }
public fun create(ctx: &mut TxContext): Source {
    let id = object::new(ctx); let config = object::uid_to_inner(&id);
    Source { id, version: 3, policy: vector::tabulate!(32, |_| 8), config, revision: 7,
        commitment: vector::tabulate!(32, |_| 6), expiry: 10000 }
}
public fun request<T: key>(p: &Source, operation: u8, ctx: &TxContext): OriginRequest {
    producer_origin::request<SoulProducer, Source, Adapter, Revision, T>(
        SoulProducer {}, p, Adapter {}, Revision {}, p.version, p.policy,
        string::utf8(b"independent source"), vector::tabulate!(32, |_| 9),
        p.config, p.revision, p.commitment, p.expiry, operation, ctx,
    )
}
fun current(p: &Source, snapshot: &Snapshot) {
    assert!(producer_origin::version(snapshot) == p.version && producer_origin::policy(snapshot) == p.policy
        && producer_origin::config(snapshot) == p.config && producer_origin::revision(snapshot) == p.revision
        && producer_origin::commitment(snapshot) == p.commitment && producer_origin::expiry(snapshot) == p.expiry, 1)
}
public fun complete<T: key>(p: &Source, target: &T, snapshot: Snapshot, ctx: &TxContext): CompletionAuthorization {
    current(p, &snapshot); producer_origin::complete(SoulProducer {}, p, target, snapshot, ctx)
}
public fun action<T: key>(p: &Source, target: &T, snapshot: Snapshot, ctx: &TxContext): PaidAction {
    current(p, &snapshot); producer_origin::authorize_action(ManufacturingProducer {}, p, target, snapshot, vector::tabulate!(32, |_| 5), ctx)
}
public fun consume_action<T: key>(action: PaidAction, target: &T, operation: u8, ctx: &TxContext): (Snapshot, vector<u8>) {
    producer_origin::consume_action<Adapter, Revision, T>(action, Adapter {}, Revision {}, target, operation, ctx)
}
public fun consume_completion<T: key>(authorization: CompletionAuthorization, target: &T, snapshot: &Snapshot, ctx: &TxContext) {
    producer_origin::consume_completion<Adapter, Revision, T>(authorization, target, snapshot, ctx)
}

#[test_only]
public fun witness_for_testing():SoulProducer{SoulProducer{}}
