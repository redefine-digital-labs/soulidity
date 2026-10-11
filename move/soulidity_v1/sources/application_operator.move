/// Leaf authority for sibling native adapters. No public constructor or export.
/// Adapters must separately prove actual custody, owner, payment and current roles.
module soulidity_v1::application_operator;
public struct ApplicationOperator has drop {}
public(package) fun operator():ApplicationOperator{ApplicationOperator{}}

public struct ApplicationRevision1 has drop {}
public(package) fun revision():ApplicationRevision1{ApplicationRevision1{}}
