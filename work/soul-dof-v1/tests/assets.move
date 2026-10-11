#[test_only]
module soul_dof_v1::assets;

use soul_dof_v1::soul::Soul;
use sui::dynamic_object_field as dof;

public struct Hat has key, store { id: UID }
public struct Other has key, store { id: UID }
public struct Namespace has drop {}
public struct Container has key, store { id: UID }
public struct SoulKey has copy, drop, store {}

public fun hat(ctx: &mut TxContext): Hat { Hat { id: object::new(ctx) } }
public fun other(ctx: &mut TxContext): Other { Other { id: object::new(ctx) } }
public fun container(soul: Soul, ctx: &mut TxContext): Container {
    let mut c = Container { id: object::new(ctx) };
    dof::add(&mut c.id, SoulKey {}, soul);
    c
}
public fun take_soul(c: &mut Container): Soul { dof::remove(&mut c.id, SoulKey {}) }
