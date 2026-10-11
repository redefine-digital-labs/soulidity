/// Public character configuration bytes, separate from encrypted content and grants.
/// The private application operator controls writes; its entry proves custody/gates.
module soulidity_content::state_configuration;

use std::bcs;
use std::hash;
use std::string::{Self, String};
use sui::table::{Self, Table};
use soulidity_content::authority::{Self, Controller};
use soulidity_standard::soul::Soul;

const EKey: u64 = 1;
const EMissing: u64 = 2;
const ERevision: u64 = 3;
const EReserved: u64 = 4;

public struct Entry has copy, drop, store { key: String, value_hash: vector<u8> }
public struct Configuration has key, store {
    id: UID, controller: Controller, root: ID, revision: u64,
    values: Table<String, vector<u8>>, entries: vector<Entry>,
}
public struct Commitment has drop { domain: vector<u8>, configuration: vector<u8> }

public fun new<W: drop, P: key>(w: W, parent: &P, root: &Soul, ctx: &mut TxContext): Configuration {
    Configuration { id: object::new(ctx), controller: authority::bind(w, parent, root),
        root: object::id(root), revision: 0, values: table::new(ctx), entries: vector[] }
}
public fun root(c: &Configuration): ID { c.root }
public fun revision(c: &Configuration): u64 { c.revision }
public fun count(c: &Configuration): u64 { c.entries.length() }
public fun key_at(c: &Configuration, i: u64): String { c.entries[i].key }
public fun contains(c: &Configuration, key: String): bool { c.values.contains(key) }
public fun value(c: &Configuration, key: String): &vector<u8> {
    assert!(c.values.contains(key), EMissing); c.values.borrow(key)
}
/// Includes the exact per-key value digests, not just the Table UID.
public fun commitment(c: &Configuration): vector<u8> {
    hash::sha2_256(bcs::to_bytes(&Commitment {
        domain: b"soulidity/state-configuration/v1", configuration: bcs::to_bytes(c),
    }))
}
public fun assert_binding(c: &Configuration, parent: ID, root: ID) {
    assert!(authority::parent(&c.controller) == parent && c.root == root && authority::root(&c.controller) == root, EKey)
}
fun index(c: &Configuration, key: &String): u64 {
    let mut i = 0; while (i < c.entries.length()) {
        if (c.entries[i].key == *key) return i; i = i + 1
    }; abort EMissing
}
public fun set<W: drop>(w: W, c: &mut Configuration, key: String, value: vector<u8>, expected: u64) {
    authority::assert_operator(w, &c.controller); assert!(c.revision == expected, ERevision);
    assert!(!string::is_empty(&key), EKey); let value_hash = hash::sha2_256(value);
    if (c.values.contains(key)) {
        let i = index(c, &key); *c.values.borrow_mut(key) = value; c.entries[i].value_hash = value_hash
    } else {
        c.entries.push_back(Entry { key, value_hash }); c.values.add(key, value)
    }; c.revision = c.revision + 1
}
public fun delete<W: drop>(w: W, c: &mut Configuration, key: String, expected: u64) {
    authority::assert_operator(w, &c.controller); assert!(c.revision == expected, ERevision);
    assert!(!string::is_empty(&key), EKey); let i = index(c, &key);
    let _ = c.values.remove(key); c.entries.remove(i); c.revision = c.revision + 1
}
/// Original mint-time rule only. These bytes must not masquerade as an envelope.
/// Later ordinary metadata writes do not grant or modify encrypted-content access.
public fun assert_initial_key(key: &String) {
    assert!(!string::is_empty(key), EKey); let prefix = b"content_seal_envelope_v1:";
    let bytes = key.as_bytes(); if (bytes.length() < prefix.length()) return;
    let mut i = 0; while (i < prefix.length()) {
        if (bytes[i] != prefix[i]) return; i = i + 1
    }; abort EReserved
}
