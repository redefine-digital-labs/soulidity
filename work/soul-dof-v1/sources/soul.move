/// Research prototype: native custody and typed activation, not a production
/// license, private-access, issuance, rendering or settlement implementation.
module soul_dof_v1::soul;

use std::string::String;
use std::type_name::{Self, TypeName};
use sui::dynamic_object_field as dof;
use sui::table::{Self, Table};

const ERevision: u64 = 0;
const EManifest: u64 = 1;
const ESlotKey: u64 = 2;
const EUnknownItem: u64 = 3;
const EType: u64 = 4;
const EOccupied: u64 = 5;
const EAlreadyActive: u64 = 6;
const EInvariant: u64 = 7;
const ECapacity: u64 = 8;
const MAX_MEMBERS: u64 = 500;
const MAX_SLOTS: u64 = 500;

public struct Soul has key, store {
    id: UID,
    schema_version: u16,
    name: String,
    revision: u64,
}

public struct SoulCore has key, store {
    id: UID,
    schema_version: u16,
    genesis_manifest_hash: vector<u8>,
}

public struct SoulComposition has key, store {
    id: UID,
    slots: Table<SlotKey, SlotState>,
    members: Table<ID, Member>,
}

public struct CoreKey has copy, drop, store {}
public struct CompositionKey has copy, drop, store {}
public struct ItemKey has copy, drop, store { item_id: ID }
public struct SlotKey has copy, drop, store {
    namespace: TypeName,
    part: vector<u8>,
}
public struct SlotDefinition has drop, store { key: SlotKey, accepted_type: TypeName }
public struct SlotState has store { accepted_type: TypeName, active: Option<ID> }
public struct Member has drop, store { item_type: TypeName, active_slot: Option<SlotKey> }

public fun slot_key<Namespace>(part: vector<u8>): SlotKey {
    assert!(part.length() > 0 && part.length() <= 64, ESlotKey);
    SlotKey { namespace: type_name::with_original_ids<Namespace>(), part }
}

public fun slot_definition<T: key + store, Namespace>(part: vector<u8>): SlotDefinition {
    SlotDefinition { key: slot_key<Namespace>(part), accepted_type: type_name::with_original_ids<T>() }
}

/// Send the fresh root to its recipient instead of returning a fresh Soul value.
/// Ordinary roots cannot later be turned into shared objects. Container modules
/// must authenticate their own borrowing interfaces when they hold a Soul.
public fun mint_to(
    name: String, manifest_hash: vector<u8>, definitions: vector<SlotDefinition>,
    recipient: address, ctx: &mut TxContext,
): ID {
    assert!(manifest_hash.length() == 32, EManifest);
    assert!(definitions.length() <= MAX_SLOTS, ECapacity);
    let mut slots = table::new(ctx);
    let mut definitions = definitions;
    while (!definitions.is_empty()) {
        let SlotDefinition { key, accepted_type } = definitions.pop_back();
        slots.add(key, SlotState { accepted_type, active: option::none() });
    };
    let mut soul = Soul { id: object::new(ctx), schema_version: 1, name, revision: 0 };
    dof::add(&mut soul.id, CoreKey {}, SoulCore {
        id: object::new(ctx), schema_version: 1, genesis_manifest_hash: manifest_hash,
    });
    dof::add(&mut soul.id, CompositionKey {}, SoulComposition {
        id: object::new(ctx), slots, members: table::new(ctx),
    });
    let id = object::id(&soul);
    transfer::public_transfer(soul, recipient);
    id
}

public fun revision(soul: &Soul): u64 { soul.revision }
public fun core(soul: &Soul): &SoulCore { dof::borrow(&soul.id, CoreKey {}) }
public fun composition(soul: &Soul): &SoulComposition { dof::borrow(&soul.id, CompositionKey {}) }
public fun member_count(soul: &Soul): u64 { composition(soul).members.length() }
public fun has_item(soul: &Soul, item_id: ID): bool { composition(soul).members.contains(item_id) }
public fun active_item(soul: &Soul, slot: SlotKey): Option<ID> { composition(soul).slots.borrow(slot).active }
public fun borrow_item<T: key + store>(soul: &Soul, item_id: ID): &T {
    assert_member_type<T>(soul, item_id);
    dof::borrow(&soul.id, ItemKey { item_id })
}

/// Deposit is custody only. It does not automatically activate an item.
public fun deposit<T: key + store>(soul: &mut Soul, item: T, expected_revision: u64) {
    assert_revision(soul, expected_revision);
    deposit_impl(soul, item);
    soul.revision = soul.revision + 1;
}

public fun activate<T: key + store>(soul: &mut Soul, item_id: ID, slot: SlotKey, expected_revision: u64) {
    assert_revision(soul, expected_revision);
    activate_impl<T>(soul, item_id, slot);
    soul.revision = soul.revision + 1;
}

/// Keep custody but clear activation. This differs from withdrawal.
public fun deactivate(soul: &mut Soul, item_id: ID, expected_revision: u64) {
    assert_revision(soul, expected_revision);
    assert!(has_item(soul, item_id), EUnknownItem);
    clear_activation(soul, item_id);
    soul.revision = soul.revision + 1;
}

/// Returns the original object. An active item's binding is cleared atomically.
/// The caller must deposit, transfer, or otherwise consume the returned asset.
public fun withdraw<T: key + store>(soul: &mut Soul, item_id: ID, expected_revision: u64): T {
    assert_revision(soul, expected_revision);
    let item = withdraw_impl<T>(soul, item_id);
    soul.revision = soul.revision + 1;
    item
}

/// One logical revision for replacing a slot, including returning its old item.
public fun replace<T: key + store>(soul: &mut Soul, slot: SlotKey, item: T, expected_revision: u64): Option<T> {
    assert_revision(soul, expected_revision);
    let mut old_id = active_item(soul, slot);
    let previous = if (old_id.is_some()) option::some(withdraw_impl<T>(soul, old_id.extract())) else option::none();
    let item_id = object::id(&item);
    deposit_impl(soul, item);
    activate_impl<T>(soul, item_id, slot);
    soul.revision = soul.revision + 1;
    previous
}

fun assert_revision(soul: &Soul, expected: u64) { assert!(soul.revision == expected, ERevision) }
fun composition_mut(soul: &mut Soul): &mut SoulComposition { dof::borrow_mut(&mut soul.id, CompositionKey {}) }
fun assert_member_type<T: key + store>(soul: &Soul, item_id: ID) {
    assert!(has_item(soul, item_id), EUnknownItem);
    assert!(composition(soul).members.borrow(item_id).item_type == type_name::with_original_ids<T>(), EType);
}
fun deposit_impl<T: key + store>(soul: &mut Soul, item: T) {
    assert!(member_count(soul) < MAX_MEMBERS, ECapacity);
    let item_id = object::id(&item);
    composition_mut(soul).members.add(item_id, Member {
        item_type: type_name::with_original_ids<T>(), active_slot: option::none(),
    });
    dof::add(&mut soul.id, ItemKey { item_id }, item);
}
fun activate_impl<T: key + store>(soul: &mut Soul, item_id: ID, slot: SlotKey) {
    assert_member_type<T>(soul, item_id);
    let _ = borrow_item<T>(soul, item_id);
    let composition = composition_mut(soul);
    assert!(composition.slots.borrow(slot).accepted_type == type_name::with_original_ids<T>(), EType);
    assert!(composition.slots.borrow(slot).active.is_none(), EOccupied);
    assert!(composition.members.borrow(item_id).active_slot.is_none(), EAlreadyActive);
    composition.slots.borrow_mut(slot).active = option::some(item_id);
    composition.members.borrow_mut(item_id).active_slot = option::some(slot);
}
fun clear_activation(soul: &mut Soul, item_id: ID) {
    let composition = composition_mut(soul);
    let mut active = composition.members.borrow_mut(item_id).active_slot;
    if (active.is_some()) {
        let slot = active.extract();
        assert!(composition.slots.borrow(slot).active == option::some(item_id), EInvariant);
        composition.slots.borrow_mut(slot).active = option::none();
        composition.members.borrow_mut(item_id).active_slot = option::none();
    };
}
fun withdraw_impl<T: key + store>(soul: &mut Soul, item_id: ID): T {
    assert_member_type<T>(soul, item_id);
    clear_activation(soul, item_id);
    let _ = composition_mut(soul).members.remove(item_id);
    let item = dof::remove<ItemKey, T>(&mut soul.id, ItemKey { item_id });
    assert!(object::id(&item) == item_id, EInvariant);
    item
}
