module soulidity::content_access;

use sui::clock::Clock;
use sui::event;
use sui::table;
use std::string::String;
use soulidity::assets::{Self as assets, SoulAssets};
use soulidity::grant;
use soulidity::skills::{Self as skills, SoulSkills};
use soulidity::soul::{Self as soul, SoulState};

const ENotOwner: u64 = 1;
const EAlreadyHasAccess: u64 = 2;
const ENoAccessEntry: u64 = 3;
const EScopeMismatch: u64 = 4;
const EAccessListMismatch: u64 = 5;

// ── Structs ──

public struct ContentAccessEntry has copy, drop, store {
    scope_mask: u64,
    price_paid_atomic: u64,
    granted_at_ms: u64,
    expires_at_ms: Option<u64>,
    /// Snapshot of `SoulState.ownership_epoch` at the moment the entry was
    /// recorded. `has_access` requires this to equal the current state epoch,
    /// which makes every entry auto-invalidate on Soul ownership rotation
    /// (mirrors the `SoulGrant.ownership_epoch_snapshot` contract). Kept
    /// in the table even after invalidation to preserve the historical
    /// price / grant-time record for audits and potential refunds.
    ownership_epoch_snapshot: u64,
}

public struct ContentAccessList has key {
    id: UID,
    soul_id: ID,
    creator: address,
    price_atomic: u64,
    default_scope_mask: u64,
    default_access_duration_ms: Option<u64>,
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
    default_access_duration_ms: Option<u64>,
}

public struct ContentAccessGranted has copy, drop {
    soul_id: ID,
    access_list_id: ID,
    grantee: address,
    scope_mask: u64,
    price_paid_atomic: u64,
    expires_at_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
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

public struct ContentAccessDurationUpdated has copy, drop {
    soul_id: ID,
    access_list_id: ID,
    old_duration_ms: Option<u64>,
    new_duration_ms: Option<u64>,
}

// ── Getters ──

public fun soul_id(self: &ContentAccessList): ID { self.soul_id }
public fun creator(self: &ContentAccessList): address { self.creator }
public fun price_atomic(self: &ContentAccessList): u64 { self.price_atomic }
public fun entry_count(self: &ContentAccessList): u64 { self.entry_count }
public fun default_access_duration_ms(self: &ContentAccessList): Option<u64> { self.default_access_duration_ms }
public fun entry_expires_at_ms(self: &ContentAccessList, addr: address): Option<u64> {
    if (!self.entries.contains(addr)) { return option::none() };
    self.entries[addr].expires_at_ms
}

/// Returns true iff `addr` currently holds an active entry satisfying
/// `required_scope`. "Active" means:
///   (a) the entry exists for this access list,
///   (b) the entry's `scope_mask` is a superset of `required_scope`,
///   (c) the entry's `ownership_epoch_snapshot` matches the Soul's current
///       `ownership_epoch` — i.e. the entry predates the current owner and
///       was not wiped by a `SoulState::rotate_owner` call,
///   (d) the entry is not expired (`expires_at_ms > now`, if bounded).
///
/// Callers MUST pass the `SoulState` whose `soul_id` matches this access
/// list (asserted via `EAccessListMismatch`). This prevents lookups
/// against an unrelated Soul's state bypassing the epoch check.
public fun has_access(
    self: &ContentAccessList,
    state: &SoulState,
    addr: address,
    required_scope: u64,
    clock: &Clock,
): bool {
    assert!(self.soul_id == soul::soul_id(state), EAccessListMismatch);
    if (!self.entries.contains(addr)) { return false };
    let entry = &self.entries[addr];
    if (entry.scope_mask & required_scope != required_scope) { return false };
    if (entry.ownership_epoch_snapshot != soul::ownership_epoch(state)) { return false };
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
    default_access_duration_ms: Option<u64>,
    ctx: &mut TxContext,
): ContentAccessList {
    grant::assert_valid_scope_mask(default_scope_mask);
    let list = ContentAccessList {
        id: object::new(ctx),
        soul_id,
        creator,
        price_atomic,
        default_scope_mask,
        default_access_duration_ms,
        entries: table::new(ctx),
        entry_count: 0,
    };
    event::emit(ContentAccessListCreated {
        access_list_id: object::id(&list),
        soul_id,
        creator,
        price_atomic,
        default_scope_mask,
        default_access_duration_ms,
    });
    list
}

public(package) fun share_access_list(list: ContentAccessList) {
    transfer::share_object(list);
}

// ── Record purchase (called by market module after payment split) ──

public(package) fun record_purchase(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    buyer: address,
    price_paid_atomic: u64,
    clock: &Clock,
) {
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    let current_epoch = soul::ownership_epoch(state);
    if (access_list.entries.contains(buyer)) {
        let entry = &access_list.entries[buyer];
        let stale_epoch = entry.ownership_epoch_snapshot != current_epoch;
        if (stale_epoch) {
            // Entry pre-dates the current Soul owner — invalidated and safe to
            // overwrite regardless of expiry, since `has_access` already treats
            // it as inactive.
            access_list.entries.remove(buyer);
            access_list.entry_count = access_list.entry_count - 1;
        } else if (entry.expires_at_ms.is_some()) {
            let expires = *entry.expires_at_ms.borrow();
            assert!(clock.timestamp_ms() >= expires, EAlreadyHasAccess);
            access_list.entries.remove(buyer);
            access_list.entry_count = access_list.entry_count - 1;
        } else {
            abort EAlreadyHasAccess
        };
    };

    let now_ms = clock.timestamp_ms();
    let expires_at_ms = compute_expires_at_ms(access_list.default_access_duration_ms, now_ms);
    let entry = ContentAccessEntry {
        scope_mask: access_list.default_scope_mask,
        price_paid_atomic,
        granted_at_ms: now_ms,
        expires_at_ms,
        ownership_epoch_snapshot: current_epoch,
    };
    access_list.entries.add(buyer, entry);
    access_list.entry_count = access_list.entry_count + 1;

    event::emit(ContentAccessGranted {
        soul_id: access_list.soul_id,
        access_list_id: object::id(access_list),
        grantee: buyer,
        scope_mask: access_list.default_scope_mask,
        price_paid_atomic,
        expires_at_ms,
        ownership_epoch_snapshot: current_epoch,
    });
}

fun compute_expires_at_ms(duration_ms: Option<u64>, now_ms: u64): Option<u64> {
    if (duration_ms.is_some()) {
        option::some(now_ms + *duration_ms.borrow())
    } else {
        option::none()
    }
}

// ── Manual add (creator or owner) ──

public fun add_access(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    grantee: address,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    clock: &Clock,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    let current_epoch = soul::ownership_epoch(state);
    if (access_list.entries.contains(grantee)) {
        let entry = &access_list.entries[grantee];
        let stale_epoch = entry.ownership_epoch_snapshot != current_epoch;
        if (stale_epoch) {
            // Pre-rotation entry — invalid, safe to overwrite.
            access_list.entries.remove(grantee);
            access_list.entry_count = access_list.entry_count - 1;
        } else if (entry.expires_at_ms.is_some()) {
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
        ownership_epoch_snapshot: current_epoch,
    };
    access_list.entries.add(grantee, entry);
    access_list.entry_count = access_list.entry_count + 1;

    event::emit(ContentAccessGranted {
        soul_id: access_list.soul_id,
        access_list_id: object::id(access_list),
        grantee,
        scope_mask,
        price_paid_atomic: 0,
        expires_at_ms,
        ownership_epoch_snapshot: current_epoch,
    });
}

// ── Revoke ──

public fun revoke_access(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    grantee: address,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
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

public fun set_content_price(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    new_price_atomic: u64,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
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

/// Owner updates the `default_access_duration_ms`. Future `record_purchase`
/// calls will compute `expires_at_ms = now + duration`. Passing `None`
/// reverts to lifetime access for future buyers. Existing entries are
/// not retroactively modified.
public fun set_content_access_duration(
    access_list: &mut ContentAccessList,
    state: &SoulState,
    new_duration_ms: Option<u64>,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
    assert!(access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    let old_duration = access_list.default_access_duration_ms;
    access_list.default_access_duration_ms = new_duration_ms;
    event::emit(ContentAccessDurationUpdated {
        soul_id: access_list.soul_id,
        access_list_id: object::id(access_list),
        old_duration_ms: old_duration,
        new_duration_ms,
    });
}

// ── Seal approval for allowlisted users (skills) ──

entry fun seal_approve_skill_allowlisted(
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
    assert!(has_access(access_list, state, sender, 4, clock), EScopeMismatch); // SCOPE_SKILLS = 4
}

// ── Seal approval for allowlisted users (assets) ──

entry fun seal_approve_asset_allowlisted(
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
    assert!(has_access(access_list, state, sender, 8, clock), EScopeMismatch); // SCOPE_ASSETS = 8
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
        default_access_duration_ms: _,
        entries,
        entry_count: _,
    } = self;
    table::drop(entries);
    id.delete();
}
