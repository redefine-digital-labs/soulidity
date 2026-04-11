module soulidity::content_access;

use sui::clock::Clock;
use sui::coin::Coin;
use sui::event;
use sui::table;
use std::string::String;
use soulidity::assets::{Self as assets, SoulAssets};
use soulidity::skills::{Self as skills, SoulSkills};
use soulidity::soul::{Self as soul, SoulState};
use usdc::usdc::USDC;

const ENotCreatorOrOwner: u64 = 1;
const EAlreadyHasAccess: u64 = 2;
const ENoAccessEntry: u64 = 3;
const EAccessExpired: u64 = 4;
const EScopeMismatch: u64 = 5;
const EIncorrectPaymentAmount: u64 = 6;
const EAccessListMismatch: u64 = 7;

// ── Structs ──

public struct ContentAccessEntry has copy, drop, store {
    scope_mask: u64,
    price_paid_atomic: u64,
    granted_at_ms: u64,
    expires_at_ms: Option<u64>,
}

public struct ContentAccessList has key {
    id: UID,
    soul_id: ID,
    creator: address,
    price_atomic: u64,
    default_scope_mask: u64,
    entries: table::Table<address, ContentAccessEntry>,
    entry_count: u64,
}

// ── Events ──

public struct ContentAccessListCreated has copy, drop {
    access_list_id: ID,
    soul_id: ID,
    creator: address,
    price_atomic: u64,
    default_scope_mask: u64,
}

public struct ContentAccessGranted has copy, drop {
    soul_id: ID,
    access_list_id: ID,
    grantee: address,
    scope_mask: u64,
    price_paid_atomic: u64,
}

public struct ContentAccessRevoked has copy, drop {
    soul_id: ID,
    access_list_id: ID,
    grantee: address,
}

public struct ContentAccessPriceUpdated has copy, drop {
    soul_id: ID,
    access_list_id: ID,
    old_price_atomic: u64,
    new_price_atomic: u64,
}

// ── Getters ──

public fun soul_id(self: &ContentAccessList): ID { self.soul_id }
public fun creator(self: &ContentAccessList): address { self.creator }
public fun price_atomic(self: &ContentAccessList): u64 { self.price_atomic }
public fun entry_count(self: &ContentAccessList): u64 { self.entry_count }

public fun has_access(
    self: &ContentAccessList,
    addr: address,
    required_scope: u64,
    clock: &Clock,
): bool {
    if (!self.entries.contains(addr)) { return false };
    let entry = &self.entries[addr];
    if (entry.scope_mask & required_scope != required_scope) { return false };
    if (entry.expires_at_ms.is_some()) {
        let expires = *entry.expires_at_ms.borrow();
        if (clock.timestamp_ms() >= expires) { return false };
    };
    true
}

// ── Creation ──

public(package) fun create(
    soul_id: ID,
    creator: address,
    price_atomic: u64,
    default_scope_mask: u64,
    ctx: &mut TxContext,
): ContentAccessList {
    let list = ContentAccessList {
        id: object::new(ctx),
        soul_id,
        creator,
        price_atomic,
        default_scope_mask,
        entries: table::new(ctx),
        entry_count: 0,
    };
    event::emit(ContentAccessListCreated {
        access_list_id: object::id(&list),
        soul_id,
        creator,
        price_atomic,
        default_scope_mask,
    });
    list
}

public(package) fun share_access_list(list: ContentAccessList) {
    transfer::share_object(list);
}

// ── Purchase (on-chain USDC payment) ──

public entry fun purchase_content_access(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    payment: Coin<USDC>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let buyer = ctx.sender();
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    // Allow renewal: if buyer has an expired entry, remove it first
    if (access_list.entries.contains(buyer)) {
        let entry = &access_list.entries[buyer];
        if (entry.expires_at_ms.is_some()) {
            let expires = *entry.expires_at_ms.borrow();
            assert!(clock.timestamp_ms() >= expires, EAlreadyHasAccess);
            access_list.entries.remove(buyer);
            access_list.entry_count = access_list.entry_count - 1;
        } else {
            abort EAlreadyHasAccess
        };
    };
    let paid = payment.value();
    assert!(paid == access_list.price_atomic, EIncorrectPaymentAmount);

    transfer::public_transfer(payment, access_list.creator);

    let now_ms = clock.timestamp_ms();
    let entry = ContentAccessEntry {
        scope_mask: access_list.default_scope_mask,
        price_paid_atomic: paid,
        granted_at_ms: now_ms,
        expires_at_ms: option::none(),
    };
    access_list.entries.add(buyer, entry);
    access_list.entry_count = access_list.entry_count + 1;

    event::emit(ContentAccessGranted {
        soul_id: access_list.soul_id,
        access_list_id: object::id(access_list),
        grantee: buyer,
        scope_mask: access_list.default_scope_mask,
        price_paid_atomic: paid,
    });
}

// ── Manual add (creator or owner) ──

public entry fun add_access(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    grantee: address,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    clock: &Clock,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(
        sender == access_list.creator || sender == soul::current_owner(state),
        ENotCreatorOrOwner,
    );
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    // Allow renewal: if grantee has an expired entry, remove it first
    if (access_list.entries.contains(grantee)) {
        let entry = &access_list.entries[grantee];
        if (entry.expires_at_ms.is_some()) {
            let expires = *entry.expires_at_ms.borrow();
            assert!(clock.timestamp_ms() >= expires, EAlreadyHasAccess);
            access_list.entries.remove(grantee);
            access_list.entry_count = access_list.entry_count - 1;
        } else {
            abort EAlreadyHasAccess
        };
    };

    let now_ms = clock.timestamp_ms();
    let entry = ContentAccessEntry {
        scope_mask,
        price_paid_atomic: 0,
        granted_at_ms: now_ms,
        expires_at_ms,
    };
    access_list.entries.add(grantee, entry);
    access_list.entry_count = access_list.entry_count + 1;

    event::emit(ContentAccessGranted {
        soul_id: access_list.soul_id,
        access_list_id: object::id(access_list),
        grantee,
        scope_mask,
        price_paid_atomic: 0,
    });
}

// ── Revoke ──

public entry fun revoke_access(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    grantee: address,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(
        sender == access_list.creator || sender == soul::current_owner(state),
        ENotCreatorOrOwner,
    );
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    assert!(access_list.entries.contains(grantee), ENoAccessEntry);

    access_list.entries.remove(grantee);
    access_list.entry_count = access_list.entry_count - 1;

    event::emit(ContentAccessRevoked {
        soul_id: access_list.soul_id,
        access_list_id: object::id(access_list),
        grantee,
    });
}

// ── Set price ──

public entry fun set_content_price(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    new_price_atomic: u64,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(
        sender == access_list.creator || sender == soul::current_owner(state),
        ENotCreatorOrOwner,
    );
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    let old_price = access_list.price_atomic;
    access_list.price_atomic = new_price_atomic;
    event::emit(ContentAccessPriceUpdated {
        soul_id: access_list.soul_id,
        access_list_id: object::id(access_list),
        old_price_atomic: old_price,
        new_price_atomic,
    });
}

// ── Seal approval for allowlisted users (skills) ──

public entry fun seal_approve_skill_allowlisted(
    id: vector<u8>,
    state: &SoulState,
    access_list: &ContentAccessList,
    skill_store: &SoulSkills,
    skill_name: String,
    version_index: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    skills::assert_valid_skill_seal_request(id, state, skill_store, skill_name, version_index);
    let sender = ctx.sender();
    assert!(has_access(access_list, sender, 4, clock), EScopeMismatch); // SCOPE_SKILLS = 4
}

// ── Seal approval for allowlisted users (assets) ──

public entry fun seal_approve_asset_allowlisted(
    id: vector<u8>,
    state: &SoulState,
    access_list: &ContentAccessList,
    asset_store: &SoulAssets,
    asset_name: String,
    version_index: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    assets::assert_valid_asset_seal_request(id, state, asset_store, asset_name, version_index);
    let sender = ctx.sender();
    assert!(has_access(access_list, sender, 8, clock), EScopeMismatch); // SCOPE_ASSETS = 8
}

// ── Test helpers ──

#[test_only]
public fun destroy_for_testing(self: ContentAccessList) {
    let ContentAccessList {
        id,
        soul_id: _,
        creator: _,
        price_atomic: _,
        default_scope_mask: _,
        entries,
        entry_count: _,
    } = self;
    table::drop(entries);
    id.delete();
}
