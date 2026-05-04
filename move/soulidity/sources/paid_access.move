module soulidity::paid_access;

use sui::clock::Clock;
use sui::event;
use sui::table::{Self as table, Table};
use std::string::String;
use soulidity::content::{Self as content, SoulContent};
use soulidity::grant;
use soulidity::kind_registry::{Self as kind_registry, KindRegistry};
use soulidity::soul::{Self as soul, SoulState};

const ENotOwner: u64 = 1;
const EAlreadyHasAccess: u64 = 2;
const ENoAccessEntry: u64 = 3;
const EScopeMismatch: u64 = 4;
const EAccessListMismatch: u64 = 5;
const EScopeNotPermittedForKind: u64 = 6;
const EKindNotConfigured: u64 = 7;
const EKindAlreadyConfigured: u64 = 8;
const EKindScopeMismatch: u64 = 9;
// Slot read-mode enforcement (READ_PAID) lives in `content::assert_slot_paid_read_allowed`,
// so the matching `EReadModeNotAllowed` abort code is exposed there, not here.
const EKindReadPaidNotAllowed: u64 = 11;
const EKindConfigOwnerEpochMismatch: u64 = 12;
const EMismatchedLengths: u64 = 13;
const VERSION: u64 = 1;

// ── Structs ──

/// Per-kind purchase configuration. Set via `configure_paid_access_kind`
/// and consumed by `record_purchase`. `scope_mask` must equal the kind
/// descriptor's `default_grant_scope_mask` (single grant-scope bit).
public struct KindPaidConfig has copy, drop, store {
    version: u64,
    price_atomic: u64,
    scope_mask: u64,
    duration_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}

/// Per-buyer per-kind purchase record. Snapshots the ownership epoch so
/// every entry auto-invalidates on Soul ownership rotation, mirroring the
/// `SoulGrant.ownership_epoch_snapshot` contract.
public struct KindPaidEntry has copy, drop, store {
    version: u64,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}

public struct SoulPaidAccessList has key {
    id: UID,
    version: u64,
    soul_id: ID,
    creator: address,
    /// Per-kind config table. Keys are `u32` kind ids; entries are added
    /// via `configure_paid_access_kind` (owner-only) and removed via
    /// `delete_paid_access_kind` (owner-only). Configs snapshot the owner
    /// epoch; after ownership rotates, purchases are blocked until the new
    /// owner configures or updates the kind. Removing a config does NOT
    /// invalidate already-issued entries — those still pass `has_access`
    /// checks until ownership rotates.
    kind_configs: Table<u32, KindPaidConfig>,
    /// Per-buyer entries, keyed by address then by kind. The inner table
    /// is created lazily on first purchase. Cleanup of stale entries
    /// happens via `cleanup_stale_entries` (callable by anyone).
    entries: Table<address, Table<u32, KindPaidEntry>>,
}

// ── Events ──

public struct SoulPaidAccessListCreated has copy, drop {
    paid_access_list_id: ID,
    soul_id: ID,
    creator: address,
}

public struct SoulPaidAccessKindConfigured has copy, drop {
    soul_id: ID,
    paid_access_list_id: ID,
    kind: u32,
    price_atomic: u64,
    scope_mask: u64,
    duration_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}

public struct SoulPaidAccessKindUpdated has copy, drop {
    soul_id: ID,
    paid_access_list_id: ID,
    kind: u32,
    old_price_atomic: u64,
    new_price_atomic: u64,
    old_scope_mask: u64,
    new_scope_mask: u64,
    old_duration_ms: Option<u64>,
    new_duration_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}

public struct SoulPaidAccessKindDeleted has copy, drop {
    soul_id: ID,
    paid_access_list_id: ID,
    kind: u32,
}

public struct SoulPaidAccessGranted has copy, drop {
    soul_id: ID,
    paid_access_list_id: ID,
    grantee: address,
    kind: u32,
    scope_mask: u64,
    price_paid_atomic: u64,
    expires_at_ms: Option<u64>,
    ownership_epoch_snapshot: u64,
}

public struct SoulPaidAccessRevoked has copy, drop {
    soul_id: ID,
    paid_access_list_id: ID,
    grantee: address,
    kind: u32,
}

// ── Getters ──

public fun soul_id(self: &SoulPaidAccessList): ID { self.soul_id }

public fun protocol_version(): u64 { VERSION }

public fun paid_access_list_version(self: &SoulPaidAccessList): u64 { self.version }

public fun creator(self: &SoulPaidAccessList): address { self.creator }

public fun has_kind_config(self: &SoulPaidAccessList, kind: u32): bool {
    self.kind_configs.contains(kind)
}

public fun kind_config_price_atomic(self: &SoulPaidAccessList, kind: u32): u64 {
    assert!(self.kind_configs.contains(kind), EKindNotConfigured);
    self.kind_configs.borrow(kind).price_atomic
}

public fun kind_config_version(self: &SoulPaidAccessList, kind: u32): u64 {
    assert!(self.kind_configs.contains(kind), EKindNotConfigured);
    self.kind_configs.borrow(kind).version
}

public fun kind_config_scope_mask(self: &SoulPaidAccessList, kind: u32): u64 {
    assert!(self.kind_configs.contains(kind), EKindNotConfigured);
    self.kind_configs.borrow(kind).scope_mask
}

public fun kind_config_duration_ms(self: &SoulPaidAccessList, kind: u32): Option<u64> {
    assert!(self.kind_configs.contains(kind), EKindNotConfigured);
    self.kind_configs.borrow(kind).duration_ms
}

public fun kind_config_ownership_epoch_snapshot(self: &SoulPaidAccessList, kind: u32): u64 {
    assert!(self.kind_configs.contains(kind), EKindNotConfigured);
    self.kind_configs.borrow(kind).ownership_epoch_snapshot
}

public fun has_kind_entry(self: &SoulPaidAccessList, addr: address, kind: u32): bool {
    if (!self.entries.contains(addr)) { return false };
    self.entries[addr].contains(kind)
}

/// True iff the outer `entries[addr]` row exists. Used by indexers to detect
/// long-tail buyer accumulation, and by tests to verify that revoke /
/// cleanup paths reclaim empty outer rows.
public fun has_buyer_row(self: &SoulPaidAccessList, addr: address): bool {
    self.entries.contains(addr)
}

public fun kind_entry_scope_mask(self: &SoulPaidAccessList, addr: address, kind: u32): u64 {
    assert!(has_kind_entry(self, addr, kind), ENoAccessEntry);
    self.entries[addr][kind].scope_mask
}

public fun kind_entry_version(self: &SoulPaidAccessList, addr: address, kind: u32): u64 {
    assert!(has_kind_entry(self, addr, kind), ENoAccessEntry);
    self.entries[addr][kind].version
}

public fun kind_entry_expires_at_ms(
    self: &SoulPaidAccessList,
    addr: address,
    kind: u32,
): Option<u64> {
    if (!has_kind_entry(self, addr, kind)) { return option::none() };
    self.entries[addr][kind].expires_at_ms
}

/// Returns true iff `addr` currently holds an active entry for `kind`
/// satisfying `required_scope`. "Active" means:
///   (a) the entry exists for this access list and kind,
///   (b) the entry's `scope_mask` is a superset of `required_scope`,
///   (c) the entry's `ownership_epoch_snapshot` matches the Soul's current
///       `ownership_epoch` — i.e. the entry predates the current owner and
///       was not wiped by a `SoulState::rotate_owner` call,
///   (d) the entry is not expired (`expires_at_ms > now`, if bounded).
///
/// Callers MUST pass the `SoulState` whose `soul_id` matches this access
/// list (asserted via `EAccessListMismatch`). This prevents lookups against
/// an unrelated Soul's state bypassing the epoch check.
public fun has_access(
    self: &SoulPaidAccessList,
    state: &SoulState,
    addr: address,
    kind: u32,
    required_scope: u64,
    clock: &Clock,
): bool {
    assert_paid_access_list_matches_state(self, state);
    if (!self.entries.contains(addr)) { return false };
    let by_kind = &self.entries[addr];
    if (!by_kind.contains(kind)) { return false };
    let entry = &by_kind[kind];
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
    ctx: &mut TxContext,
): SoulPaidAccessList {
    let list = SoulPaidAccessList {
        id: object::new(ctx),
        version: VERSION,
        soul_id,
        creator,
        kind_configs: table::new(ctx),
        entries: table::new(ctx),
    };
    event::emit(SoulPaidAccessListCreated {
        paid_access_list_id: object::id(&list),
        soul_id,
        creator,
    });
    list
}

public(package) fun share_paid_access_list(list: SoulPaidAccessList) {
    transfer::share_object(list);
}

// ── Per-kind config (owner-only) ──

/// Add a per-kind config the first time. The kind must exist in the
/// registry, must permit `READ_PAID`, and `scope_mask` must equal the
/// descriptor's `default_grant_scope_mask`. Use `update_paid_access_kind`
/// to mutate an existing config.
public fun configure_paid_access_kind(
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    price_atomic: u64,
    scope_mask: u64,
    duration_ms: Option<u64>,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
    assert_paid_access_list_matches_state(paid_access_list, state);
    assert!(!paid_access_list.kind_configs.contains(kind), EKindAlreadyConfigured);
    assert_kind_supports_paid_with_scope(registry, kind, scope_mask);
    grant::assert_valid_scope_mask(scope_mask);
    let ownership_epoch_snapshot = soul::ownership_epoch(state);

    paid_access_list.kind_configs.add(
        kind,
        KindPaidConfig {
            version: VERSION,
            price_atomic,
            scope_mask,
            duration_ms,
            ownership_epoch_snapshot,
        },
    );

    event::emit(SoulPaidAccessKindConfigured {
        soul_id: paid_access_list.soul_id,
        paid_access_list_id: object::id(paid_access_list),
        kind,
        price_atomic,
        scope_mask,
        duration_ms,
        ownership_epoch_snapshot,
    });
}

/// Mutate an existing per-kind config. `scope_mask` is still pinned to the
/// kind descriptor's `default_grant_scope_mask` because slots cache that
/// scope on append; rotating it here would silently desynchronise existing
/// slot caches from the active config.
public fun update_paid_access_kind(
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    registry: &KindRegistry,
    kind: u32,
    new_price_atomic: u64,
    new_scope_mask: u64,
    new_duration_ms: Option<u64>,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
    assert_paid_access_list_matches_state(paid_access_list, state);
    assert!(paid_access_list.kind_configs.contains(kind), EKindNotConfigured);
    assert_kind_supports_paid_with_scope(registry, kind, new_scope_mask);
    grant::assert_valid_scope_mask(new_scope_mask);
    let ownership_epoch_snapshot = soul::ownership_epoch(state);

    let cfg = paid_access_list.kind_configs.borrow_mut(kind);
    let old_price_atomic = cfg.price_atomic;
    let old_scope_mask = cfg.scope_mask;
    let old_duration_ms = cfg.duration_ms;
    cfg.price_atomic = new_price_atomic;
    cfg.scope_mask = new_scope_mask;
    cfg.duration_ms = new_duration_ms;
    cfg.ownership_epoch_snapshot = ownership_epoch_snapshot;

    event::emit(SoulPaidAccessKindUpdated {
        soul_id: paid_access_list.soul_id,
        paid_access_list_id: object::id(paid_access_list),
        kind,
        old_price_atomic,
        new_price_atomic,
        old_scope_mask,
        new_scope_mask,
        old_duration_ms,
        new_duration_ms,
        ownership_epoch_snapshot,
    });
}

/// Remove a per-kind config. Existing entries remain valid until ownership
/// rotates — buyers get what they paid for, but nobody new can purchase
/// until reconfigured.
public fun delete_paid_access_kind(
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
    assert_paid_access_list_matches_state(paid_access_list, state);
    assert!(paid_access_list.kind_configs.contains(kind), EKindNotConfigured);
    let _ = paid_access_list.kind_configs.remove(kind);

    event::emit(SoulPaidAccessKindDeleted {
        soul_id: paid_access_list.soul_id,
        paid_access_list_id: object::id(paid_access_list),
        kind,
    });
}

// ── Record purchase (called by market module after payment split) ──

public(package) fun record_purchase(
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    buyer: address,
    kind: u32,
    price_paid_atomic: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert_paid_access_list_matches_state(paid_access_list, state);
    assert!(paid_access_list.kind_configs.contains(kind), EKindNotConfigured);
    let config = paid_access_list.kind_configs.borrow(kind);
    let current_epoch = soul::ownership_epoch(state);
    assert!(
        config.ownership_epoch_snapshot == current_epoch,
        EKindConfigOwnerEpochMismatch,
    );
    let scope_mask = config.scope_mask;
    let duration_ms = config.duration_ms;
    let now_ms = clock.timestamp_ms();
    let mut previous_expires_at_ms = option::none<u64>();

    if (!paid_access_list.entries.contains(buyer)) {
        paid_access_list.entries.add(buyer, table::new<u32, KindPaidEntry>(ctx));
    };

    {
        let by_kind = paid_access_list.entries.borrow_mut(buyer);
        if (by_kind.contains(kind)) {
            let entry = &by_kind[kind];
            let stale_epoch = entry.ownership_epoch_snapshot != current_epoch;
            if (stale_epoch) {
                // Entry pre-dates the current Soul owner — invalidated and
                // safe to overwrite regardless of expiry.
                let _ = by_kind.remove(kind);
            } else if (entry.expires_at_ms.is_some()) {
                previous_expires_at_ms = option::some(*entry.expires_at_ms.borrow());
                let _ = by_kind.remove(kind);
            } else {
                abort EAlreadyHasAccess
            };
        };
    };

    let expires_at_ms = compute_expires_at_ms(duration_ms, renewal_base_ms(now_ms, previous_expires_at_ms));
    let entry = KindPaidEntry {
        version: VERSION,
        scope_mask,
        expires_at_ms,
        ownership_epoch_snapshot: current_epoch,
    };
    let by_kind_mut = paid_access_list.entries.borrow_mut(buyer);
    by_kind_mut.add(kind, entry);

    event::emit(SoulPaidAccessGranted {
        soul_id: paid_access_list.soul_id,
        paid_access_list_id: object::id(paid_access_list),
        grantee: buyer,
        kind,
        scope_mask,
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

fun renewal_base_ms(now_ms: u64, previous_expires_at_ms: Option<u64>): u64 {
    if (previous_expires_at_ms.is_some()) {
        let previous = *previous_expires_at_ms.borrow();
        if (previous > now_ms) { return previous };
    };
    now_ms
}

// ── Manual add (owner) ──

public fun add_access(
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    registry: &KindRegistry,
    grantee: address,
    kind: u32,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    _clock: &Clock,
    ctx: &mut TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
    assert_paid_access_list_matches_state(paid_access_list, state);
    assert_kind_supports_paid_with_scope(registry, kind, scope_mask);
    grant::assert_valid_scope_mask(scope_mask);
    let current_epoch = soul::ownership_epoch(state);

    if (!paid_access_list.entries.contains(grantee)) {
        paid_access_list.entries.add(grantee, table::new<u32, KindPaidEntry>(ctx));
    };

    {
        let by_kind = paid_access_list.entries.borrow_mut(grantee);
        if (by_kind.contains(kind)) {
            let entry = &by_kind[kind];
            let stale_epoch = entry.ownership_epoch_snapshot != current_epoch;
            if (stale_epoch) {
                let _ = by_kind.remove(kind);
            } else if (entry.expires_at_ms.is_some()) {
                let _ = by_kind.remove(kind);
            } else {
                abort EAlreadyHasAccess
            };
        };
    };

    let entry = KindPaidEntry {
        version: VERSION,
        scope_mask,
        expires_at_ms,
        ownership_epoch_snapshot: current_epoch,
    };
    let by_kind_mut = paid_access_list.entries.borrow_mut(grantee);
    by_kind_mut.add(kind, entry);

    event::emit(SoulPaidAccessGranted {
        soul_id: paid_access_list.soul_id,
        paid_access_list_id: object::id(paid_access_list),
        grantee,
        kind,
        scope_mask,
        price_paid_atomic: 0,
        expires_at_ms,
        ownership_epoch_snapshot: current_epoch,
    });
}

// ── Revoke ──

/// Owner-prerogative revoke. No refund is issued by this function; any refund
/// or credit policy must be handled off-chain or by a future explicit rail.
/// Paid access is an owner-revocable subscription: removing the buyer's
/// `(grantee, kind)` entry here also blocks `seal_approve_*` calls for that
/// buyer until they re-purchase. See CLAUDE.md `System Invariants`.
public fun revoke_access(
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    grantee: address,
    kind: u32,
    ctx: &TxContext,
) {
    let sender = ctx.sender();
    assert!(sender == soul::current_owner(state), ENotOwner);
    assert_paid_access_list_matches_state(paid_access_list, state);
    assert!(paid_access_list.entries.contains(grantee), ENoAccessEntry);
    {
        let by_kind = paid_access_list.entries.borrow_mut(grantee);
        assert!(by_kind.contains(kind), ENoAccessEntry);
        let _ = by_kind.remove(kind);
    };
    drop_empty_buyer_row(paid_access_list, grantee);

    event::emit(SoulPaidAccessRevoked {
        soul_id: paid_access_list.soul_id,
        paid_access_list_id: object::id(paid_access_list),
        grantee,
        kind,
    });
}

/// Sweep stale (post-rotation) entries for a list of `(addr, kind)` pairs.
/// Anyone may call — invalidated entries hold no value and removing them
/// reclaims storage rebate.
public fun cleanup_stale_entries(
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    addrs: vector<address>,
    kinds: vector<u32>,
    _ctx: &TxContext,
) {
    assert_paid_access_list_matches_state(paid_access_list, state);
    assert!(addrs.length() == kinds.length(), EMismatchedLengths);
    let current_epoch = soul::ownership_epoch(state);
    let mut addrs = addrs;
    let mut kinds = kinds;
    addrs.reverse();
    kinds.reverse();
    while (!addrs.is_empty() && !kinds.is_empty()) {
        let addr = addrs.pop_back();
        let kind = kinds.pop_back();
        if (paid_access_list.entries.contains(addr)) {
            {
                let by_kind = paid_access_list.entries.borrow_mut(addr);
                if (by_kind.contains(kind)) {
                    let entry = &by_kind[kind];
                    if (entry.ownership_epoch_snapshot != current_epoch) {
                        let _ = by_kind.remove(kind);
                    };
                };
            };
            drop_empty_buyer_row(paid_access_list, addr);
        };
    };
    addrs.destroy_empty();
    kinds.destroy_empty();
}

/// Reclaim the outer `entries[addr]` row when its inner per-kind table is
/// empty. Called from `revoke_access` and `cleanup_stale_entries` after the
/// inner removal so a long-tail of one-time buyers never accumulates as
/// empty `Table<u32, KindPaidEntry>` shells under a long-lived Soul.
fun drop_empty_buyer_row(paid_access_list: &mut SoulPaidAccessList, addr: address) {
    if (!paid_access_list.entries.contains(addr)) { return };
    let inner_empty = paid_access_list.entries.borrow(addr).is_empty();
    if (inner_empty) {
        let inner = paid_access_list.entries.remove(addr);
        table::destroy_empty(inner);
    };
}

// ── Generic Seal approval over typed-content ──

/// Single Seal approval function that subsumes the legacy
/// `seal_approve_skill_allowlisted` / `seal_approve_asset_allowlisted`
/// pair. Consults `ContentSlot.grant_scope_mask` cached at append time so
/// the access decision stays valid even if the kind is later deprecated
/// or reactivated through `KindRegistry`. Also enforces that the slot's
/// cached `read_mode_mask` permits `READ_PAID`.
///
/// Declared `public` (not `entry`) so other Move modules can compose
/// the same access check; Seal client only requires the function be
/// callable in a PTB dryRun, which `public fun` satisfies.
public fun seal_approve_content_paid_access(
    id: vector<u8>,
    state: &SoulState,
    paid_access_list: &SoulPaidAccessList,
    content: &SoulContent,
    kind: u32,
    name: String,
    version_index: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_paid_access_list_matches_state(paid_access_list, state);
    let slot_scope_mask = content::assert_valid_content_seal_request(
        id,
        state,
        content,
        kind,
        name,
        version_index,
    );
    content::assert_slot_paid_read_allowed(content, kind, name, version_index);
    let sender = ctx.sender();
    assert!(slot_scope_mask != 0, EScopeNotPermittedForKind);
    assert!(
        has_access(paid_access_list, state, sender, kind, slot_scope_mask, clock),
        EScopeMismatch,
    );
}

public fun assert_paid_access_list_matches_state(
    paid_access_list: &SoulPaidAccessList,
    state: &SoulState,
) {
    assert!(paid_access_list.soul_id == soul::soul_id(state), EAccessListMismatch);
    assert!(soul::access_list_id(state).contains(&object::id(paid_access_list)), EAccessListMismatch);
}

fun assert_kind_supports_paid_with_scope(
    registry: &KindRegistry,
    kind: u32,
    scope_mask: u64,
) {
    let descriptor = kind_registry::borrow_descriptor(registry, kind);
    let read_mode_mask = kind_registry::descriptor_read_mode_mask(descriptor);
    assert!(read_mode_mask & kind_registry::read_paid() != 0, EKindReadPaidNotAllowed);
    let descriptor_scope = kind_registry::descriptor_default_grant_scope_mask(descriptor);
    assert!(scope_mask == descriptor_scope, EKindScopeMismatch);
}

// ── Test helpers ──

/// Destroy an empty `SoulPaidAccessList`. The inner `entries` table holds
/// `Table<u32, KindPaidEntry>` values which themselves lack `drop`, so we
/// require both tables to be empty at teardown. Tests that exercise
/// purchases should `return_shared` the list rather than destroy it.
#[test_only]
public fun destroy_for_testing(self: SoulPaidAccessList) {
    let SoulPaidAccessList {
        id,
        version: _,
        soul_id: _,
        creator: _,
        kind_configs,
        entries,
    } = self;
    table::drop(kind_configs);
    table::destroy_empty(entries);
    id.delete();
}
