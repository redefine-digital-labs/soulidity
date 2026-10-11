/// Owned container: authority is the real mutable container input. This is not
/// a shared custodian, delegated read authorization or a privacy-revocation hook.
module independent_container::container;
use sui::dynamic_object_field as dof;
use soulidity_standard::soul::{Self, Soul};

const EOccupied: u64 = 1;
const EEmpty: u64 = 2;
public struct Slot has copy, drop, store {}
public struct Container has key, store { id: UID, occupied: bool }

public fun new(ctx: &mut TxContext): Container { Container { id: object::new(ctx), occupied: false } }
public fun deposit(c: &mut Container, s: Soul, revision: u64, manifest: vector<u8>) {
    assert!(!c.occupied, EOccupied);
    soul::assert_manifest(&s, revision, manifest);
    dof::add(&mut c.id, Slot {}, s); c.occupied = true
}
public fun borrow(c: &Container): &Soul { assert!(c.occupied, EEmpty); dof::borrow(&c.id, Slot {}) }
/// For composition inside Move code. A PTB cannot use a returned reference as
/// its next command input; use withdraw -> application calls -> deposit instead.
public fun borrow_mut(c: &mut Container): &mut Soul { assert!(c.occupied, EEmpty); dof::borrow_mut(&mut c.id, Slot {}) }
public fun withdraw(c: &mut Container): Soul {
    assert!(c.occupied, EEmpty); let s = dof::remove<Slot, Soul>(&mut c.id, Slot {}); c.occupied = false; s
}
public fun destroy_empty(c: Container) {
    let Container { id, occupied } = c; assert!(!occupied, EOccupied); id.delete()
}
public fun occupied(c: &Container): bool { c.occupied }
