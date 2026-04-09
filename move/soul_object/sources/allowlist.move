module soul_object::allowlist;

use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use sui::dynamic_field as df;
use sui::event;
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::package::{Self as package};
use soul_object::soul::{Self as soul, Soul};

const ENoAllowlistAddress: u64 = 0;
const EInvalidAllowlistAddress: u64 = 1;
const ESelfAllowlistAddress: u64 = 2;
const EAllowlistCapStillActive: u64 = 3;

public struct ALLOWLIST has drop {}

public struct AllowlistRegistry has key {
    id: UID,
}

public struct AllowlistVersionKey has copy, drop, store {
    soul_id: ID,
}

public struct AllowlistVersionValue has copy, drop, store {
    version: u64,
}

public struct SoulAllowlistCap has key, store {
    id: UID,
    soul_id: ID,
    allowlisted: address,
    allowlist_version: u64,
}

public struct AllowlistAddressSet has copy, drop {
    soul_id: ID,
    allowlisted: address,
    allowlist_version: u64,
}

public struct AllowlistAddressCleared has copy, drop {
    soul_id: ID,
    old_allowlisted: address,
}

fun init(_otw: ALLOWLIST, ctx: &mut TxContext) {
    transfer::share_object(AllowlistRegistry {
        id: object::new(ctx),
    });
}

fun sync_registry_version(registry: &mut AllowlistRegistry, soul_id: ID, allowlist_version: u64) {
    let key = AllowlistVersionKey { soul_id };
    if (df::exists_(&registry.id, key)) {
        let stored = df::borrow_mut<AllowlistVersionKey, AllowlistVersionValue>(&mut registry.id, key);
        stored.version = allowlist_version;
    } else {
        df::add(
            &mut registry.id,
            key,
            AllowlistVersionValue { version: allowlist_version },
        );
    };
}

fun set_allowlist_address_impl(
    registry: &mut AllowlistRegistry,
    soul: &mut Soul,
    allowlisted: address,
    ctx: &mut TxContext,
): SoulAllowlistCap {
    assert!(allowlisted != @0x0, EInvalidAllowlistAddress);
    assert!(allowlisted != ctx.sender(), ESelfAllowlistAddress);

    let soul_id = object::id(soul);
    let existing_allowlist_address = *soul::allowlist_address(soul);
    if (existing_allowlist_address.is_some()) {
        let old_allowlisted = existing_allowlist_address.destroy_some();
        event::emit(AllowlistAddressCleared {
            soul_id,
            old_allowlisted,
        });
    };

    let allowlist_version = soul::set_allowlist_address(soul, allowlisted);
    sync_registry_version(registry, soul_id, allowlist_version);
    event::emit(AllowlistAddressSet {
        soul_id,
        allowlisted,
        allowlist_version,
    });

    SoulAllowlistCap {
        id: object::new(ctx),
        soul_id,
        allowlisted,
        allowlist_version,
    }
}

fun clear_allowlist_address_impl(registry: &mut AllowlistRegistry, soul: &mut Soul) {
    let existing_allowlist_address = *soul::allowlist_address(soul);
    assert!(existing_allowlist_address.is_some(), ENoAllowlistAddress);

    let soul_id = object::id(soul);
    let old_allowlisted = existing_allowlist_address.destroy_some();
    soul::clear_allowlist_address(soul);
    sync_registry_version(registry, soul_id, soul::allowlist_version(soul));
    event::emit(AllowlistAddressCleared {
        soul_id,
        old_allowlisted,
    });
}

/// Returns 0 for unregistered Souls. Freshly minted Souls also start at
/// allowlist_version 0, and valid SoulAllowlistCap objects are only minted
/// after the first increment.
public fun registry_version(registry: &AllowlistRegistry, soul_id: ID): u64 {
    let key = AllowlistVersionKey { soul_id };
    if (df::exists_(&registry.id, key)) {
        df::borrow<AllowlistVersionKey, AllowlistVersionValue>(&registry.id, key).version
    } else {
        0
    }
}

public fun soul_id(self: &SoulAllowlistCap): ID {
    self.soul_id
}

public fun allowlisted(self: &SoulAllowlistCap): address {
    self.allowlisted
}

public fun allowlist_version(self: &SoulAllowlistCap): u64 {
    self.allowlist_version
}

public(package) fun set_allowlist_address(
    registry: &mut AllowlistRegistry,
    soul: &mut Soul,
    allowlisted: address,
    ctx: &mut TxContext,
): SoulAllowlistCap {
    // Package visibility is a trust boundary, not a shortcut around ownership checks. Any future
    // soul_object module that calls this helper must first prove equivalent kiosk ownership.
    set_allowlist_address_impl(registry, soul, allowlisted, ctx)
}

public(package) fun clear_allowlist_address(
    registry: &mut AllowlistRegistry,
    soul: &mut Soul,
) {
    clear_allowlist_address_impl(registry, soul)
}

public(package) fun clear_allowlist_address_if_present(registry: &mut AllowlistRegistry, soul: &mut Soul): bool {
    let existing_allowlist_address = *soul::allowlist_address(soul);
    if (existing_allowlist_address.is_some()) {
        let soul_id = object::id(soul);
        let old_allowlisted = existing_allowlist_address.destroy_some();
        let cleared = soul::clear_allowlist_address_if_present(soul);
        if (cleared) {
            sync_registry_version(registry, soul_id, soul::allowlist_version(soul));
            event::emit(AllowlistAddressCleared {
                soul_id,
                old_allowlisted,
            });
        };
        cleared
    } else {
        false
    }
}

public fun set_allowlist_address_via_personal_kiosk(
    registry: &mut AllowlistRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    soul_id: ID,
    allowlisted: address,
    ctx: &mut TxContext,
): SoulAllowlistCap {
    let soul = kiosk::borrow_mut<Soul>(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_id);
    set_allowlist_address_impl(registry, soul, allowlisted, ctx)
}

public fun clear_allowlist_address_via_personal_kiosk(
    registry: &mut AllowlistRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    soul_id: ID,
) {
    let soul = kiosk::borrow_mut<Soul>(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_id);
    clear_allowlist_address_if_present(registry, soul);
}

public fun clear_allowlist_address_if_present_via_personal_kiosk(
    registry: &mut AllowlistRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    soul_id: ID,
): bool {
    let soul = kiosk::borrow_mut<Soul>(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_id);
    clear_allowlist_address_if_present(registry, soul)
}

public fun destroy_stale_allowlist_cap(
    registry: &AllowlistRegistry,
    self: SoulAllowlistCap,
) {
    let SoulAllowlistCap {
        id,
        soul_id,
        allowlisted: _,
        allowlist_version,
    } = self;
    assert!(registry_version(registry, soul_id) != allowlist_version, EAllowlistCapStillActive);
    id.delete();
}

#[allow(lint(share_owned))]
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    let publisher = package::claim(ALLOWLIST {}, ctx);
    transfer::share_object(AllowlistRegistry {
        id: object::new(ctx),
    });
    publisher.burn();
}

#[test_only]
public fun destroy_for_testing(self: SoulAllowlistCap) {
    let SoulAllowlistCap {
        id,
        soul_id: _,
        allowlisted: _,
        allowlist_version: _,
    } = self;
    id.delete();
}
