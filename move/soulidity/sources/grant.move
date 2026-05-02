module soulidity::grant;

use sui::clock::Clock;
use sui::event;
use soulidity::soul::{Self as soul, SoulState};

const EInvalidGrantee: u64 = 1;
const EGrantSoulMismatch: u64 = 2;
const EGrantOwnerEpochMismatch: u64 = 3;
const EGrantNotActive: u64 = 4;
const EGrantTargetMismatch: u64 = 5;
const EGrantExpired: u64 = 6;
const EGrantScopeMissing: u64 = 7;
const EGrantCapacityExceeded: u64 = 8;
const EGrantNotFound: u64 = 9;
const EEmptyScopeMask: u64 = 10;
const EGrantIdMismatch: u64 = 11;
const EGrantScopeWouldRemoveAll: u64 = 12;
const EGrantInvalidScopeMask: u64 = 13;
const EGrantCapacityTooLow: u64 = 14;
const EGrantCapacityTooHigh: u64 = 15;
const EGrantStillActive: u64 = 16;

const MAX_GRANT_CAPACITY: u64 = 10_000;

const SCOPE_SEAL: u64 = 1;
const SCOPE_MEMORY: u64 = 2;
const SCOPE_SKILLS: u64 = 4;
const SCOPE_ASSETS: u64 = 8;

public struct SoulGrant has key, store {
    id: UID,
    soul_id: ID,
    grantee: address,
    issued_by: address,
    ownership_epoch_snapshot: u64,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
}

public struct SoulGrantIssued has copy, drop {
    grant_id: ID,
    soul_id: ID,
    issued_by: address,
    grantee: address,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
}

public struct SoulGrantRevoked has copy, drop {
    grant_id: ID,
    soul_id: ID,
    revoked_by: address,
    grantee: address,
}

public struct SoulGrantSuperseded has copy, drop {
    old_grant_id: ID,
    new_grant_id: ID,
    soul_id: ID,
    grantee: address,
    superseded_by: address,
}

public struct SoulGrantExpired has copy, drop {
    grant_id: ID,
    soul_id: ID,
    grantee: address,
}

public struct GrantCapacityUpdated has copy, drop {
    soul_id: ID,
    old_capacity: u64,
    new_capacity: u64,
}

public struct SoulGrantDestroyed has copy, drop {
    grant_id: ID,
    soul_id: ID,
    grantee: address,
    destroyed_by: address,
}

public fun soul_id(self: &SoulGrant): ID {
    self.soul_id
}

public fun grantee(self: &SoulGrant): address {
    self.grantee
}

public fun issued_by(self: &SoulGrant): address {
    self.issued_by
}

public fun scope_mask(self: &SoulGrant): u64 {
    self.scope_mask
}

public fun expires_at_ms(self: &SoulGrant): &Option<u64> {
    &self.expires_at_ms
}

public fun scope_seal(): u64 {
    SCOPE_SEAL
}

public fun scope_memory(): u64 {
    SCOPE_MEMORY
}

public fun scope_skills(): u64 {
    SCOPE_SKILLS
}

public fun scope_assets(): u64 {
    SCOPE_ASSETS
}

public fun has_scope(self: &SoulGrant, required_scope_mask: u64): bool {
    has_required_scope(self.scope_mask, required_scope_mask)
}

public fun issue(
    state: &mut SoulState,
    grantee: address,
    scope_mask: u64,
    expires_at_ms: Option<u64>,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulGrant {
    soul::assert_owner(state, ctx.sender());
    assert!(grantee != @0x0, EInvalidGrantee);
    assert!(grantee != ctx.sender(), EInvalidGrantee);
    assert_valid_scope_mask(scope_mask);
    assert_future_expiry(expires_at_ms, clock);

    cleanup_inactive_grant_for_grantee(state, grantee, clock);

    let mut replaced_slot = if (soul::active_grant_contains_grantee(state, grantee)) {
        option::some(soul::remove_active_grant_for_grantee(state, grantee))
    } else {
        assert!(soul::active_grant_count(state) < soul::grant_capacity(state), EGrantCapacityExceeded);
        option::none()
    };

    let grant = SoulGrant {
        id: object::new(ctx),
        soul_id: soul::soul_id(state),
        grantee,
        issued_by: ctx.sender(),
        ownership_epoch_snapshot: soul::ownership_epoch(state),
        scope_mask,
        expires_at_ms,
    };
    let grant_id = object::id(&grant);
    let ownership_epoch_snapshot = soul::ownership_epoch(state);

    soul::push_active_grant(
        state,
        grant_id,
        grantee,
        scope_mask,
        expires_at_ms,
        ownership_epoch_snapshot,
    );
    if (replaced_slot.is_some()) {
        let old_slot = option::extract(&mut replaced_slot);
        event::emit(SoulGrantSuperseded {
            old_grant_id: soul::active_grant_slot_grant_id(&old_slot),
            new_grant_id: grant_id,
            soul_id: soul::soul_id(state),
            grantee,
            superseded_by: ctx.sender(),
        });
    };
    event::emit(SoulGrantIssued {
        grant_id,
        soul_id: soul::soul_id(state),
        issued_by: ctx.sender(),
        grantee,
        scope_mask,
        expires_at_ms,
    });

    grant
}

public fun revoke(
    state: &mut SoulState,
    grantee: address,
    clock: &Clock,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    cleanup_inactive_grant_for_grantee(state, grantee, clock);
    assert!(soul::active_grant_contains_grantee(state, grantee), EGrantNotFound);
    let slot = soul::remove_active_grant_for_grantee(state, grantee);
    event::emit(SoulGrantRevoked {
        grant_id: soul::active_grant_slot_grant_id(&slot),
        soul_id: soul::soul_id(state),
        revoked_by: ctx.sender(),
        grantee,
    });
}

public fun revoke_scope(
    state: &mut SoulState,
    grantee: address,
    revoked_scope_mask: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulGrant {
    soul::assert_owner(state, ctx.sender());
    assert_valid_scope_mask(revoked_scope_mask);
    cleanup_inactive_grant_for_grantee(state, grantee, clock);

    assert!(soul::active_grant_contains_grantee(state, grantee), EGrantNotFound);
    let slot = soul::remove_active_grant_for_grantee(state, grantee);
    let slot_scope_mask = soul::active_grant_slot_scope_mask(&slot);
    let retained_scope_mask = slot_scope_mask ^ (slot_scope_mask & revoked_scope_mask);
    assert!(retained_scope_mask != 0, EGrantScopeWouldRemoveAll);

    let new_grant = SoulGrant {
        id: object::new(ctx),
        soul_id: soul::soul_id(state),
        grantee,
        issued_by: ctx.sender(),
        ownership_epoch_snapshot: soul::ownership_epoch(state),
        scope_mask: retained_scope_mask,
        expires_at_ms: *soul::active_grant_slot_expires_at_ms(&slot),
    };
    let new_grant_id = object::id(&new_grant);
    let ownership_epoch_snapshot = soul::ownership_epoch(state);
    soul::push_active_grant(
        state,
        new_grant_id,
        grantee,
        retained_scope_mask,
        *soul::active_grant_slot_expires_at_ms(&slot),
        ownership_epoch_snapshot,
    );

    event::emit(SoulGrantSuperseded {
        old_grant_id: soul::active_grant_slot_grant_id(&slot),
        new_grant_id,
        soul_id: soul::soul_id(state),
        grantee,
        superseded_by: ctx.sender(),
    });
    event::emit(SoulGrantIssued {
        grant_id: new_grant_id,
        soul_id: soul::soul_id(state),
        issued_by: ctx.sender(),
        grantee,
        scope_mask: retained_scope_mask,
        expires_at_ms: *soul::active_grant_slot_expires_at_ms(&slot),
    });

    new_grant
}

public fun cleanup_inactive_grants(
    state: &mut SoulState,
    grantees: vector<address>,
    clock: &Clock,
) {
    let mut grantees = grantees;
    while (!grantees.is_empty()) {
        let grantee = grantees.pop_back();
        cleanup_inactive_grant_for_grantee(state, grantee, clock);
    };
    grantees.destroy_empty();
}

public fun set_grant_capacity(
    state: &mut SoulState,
    capacity: u64,
    _clock: &Clock,
    ctx: &TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert!(capacity >= soul::active_grant_count(state), EGrantCapacityTooLow);
    assert!(capacity <= MAX_GRANT_CAPACITY, EGrantCapacityTooHigh);
    let old_capacity = soul::grant_capacity(state);
    soul::set_grant_capacity(state, capacity);
    event::emit(GrantCapacityUpdated {
        soul_id: soul::soul_id(state),
        old_capacity,
        new_capacity: capacity,
    });
}

/// Reclaim storage for a SoulGrant that is no longer valid. A grant is
/// considered invalidated when: (1) the Soul has changed owner since the
/// grant was issued (epoch snapshot mismatch), or (2) the grant has been
/// revoked / superseded and is no longer in `state.active_grants`, or
/// (3) the expiry time has passed. This function does not enforce grantee
/// identity, but `SoulGrant` is an owned object, so the transaction sender
/// must still own/provide the grant object for Sui input validation to pass.
public fun destroy_invalidated_grant(
    grant: SoulGrant,
    state: &mut SoulState,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(grant.soul_id == soul::soul_id(state), EGrantSoulMismatch);

    let grant_id = object::id(&grant);
    let epoch_mismatch = grant.ownership_epoch_snapshot != soul::ownership_epoch(state);
    let mut active_grantee = soul::active_grant_grantee_by_id(state, grant_id);
    let not_in_active = active_grantee.is_none();
    let expired = grant.expires_at_ms.is_some()
        && clock.timestamp_ms() >= *grant.expires_at_ms.borrow();
    assert!(epoch_mismatch || not_in_active || expired, EGrantStillActive);
    if (active_grantee.is_some()) {
        let grantee_for_active_slot = option::extract(&mut active_grantee);
        let slot = soul::active_grant_slot_for_grantee(state, grantee_for_active_slot);
        if (
            soul::active_grant_slot_grant_id(slot) == grant_id
                && soul::active_grant_slot_ownership_epoch_snapshot(slot) != soul::ownership_epoch(state)
                || expired
        ) {
            let _ = soul::remove_active_grant_for_grantee(state, grantee_for_active_slot);
        };
    };

    let SoulGrant {
        id,
        soul_id,
        grantee,
        issued_by: _,
        ownership_epoch_snapshot: _,
        scope_mask: _,
        expires_at_ms: _,
    } = grant;
    id.delete();

    event::emit(SoulGrantDestroyed {
        grant_id,
        soul_id,
        grantee,
        destroyed_by: ctx.sender(),
    });
}

public(package) fun invalidate_all_for_owner_rotation(
    state: &mut SoulState,
    new_owner: address,
    invalidated_by: address,
) {
    let _ = new_owner;
    let _ = invalidated_by;
    soul::clear_active_grant_count_for_owner_rotation(state);
}

public fun assert_active_with_scope(
    state: &SoulState,
    self: &SoulGrant,
    required_scope_mask: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(self.soul_id == soul::soul_id(state), EGrantSoulMismatch);
    assert!(self.grantee == ctx.sender(), EGrantTargetMismatch);
    assert!(self.ownership_epoch_snapshot == soul::ownership_epoch(state), EGrantOwnerEpochMismatch);
    assert!(required_scope_mask != 0, EEmptyScopeMask);

    if (self.expires_at_ms.is_some()) {
        assert!(clock.timestamp_ms() < *self.expires_at_ms.borrow(), EGrantExpired);
    };

    let mut grantee = soul::active_grant_grantee_by_id(state, object::id(self));
    assert!(grantee.is_some(), EGrantNotActive);
    let slot_grantee = option::extract(&mut grantee);
    let slot = soul::active_grant_slot_for_grantee(state, slot_grantee);
    assert!(soul::active_grant_slot_grantee(slot) == self.grantee, EGrantIdMismatch);
    assert!(soul::active_grant_slot_scope_mask(slot) == self.scope_mask, EGrantIdMismatch);
    assert!(
        soul::active_grant_slot_ownership_epoch_snapshot(slot) == self.ownership_epoch_snapshot,
        EGrantIdMismatch,
    );
    assert!(has_required_scope(self.scope_mask, required_scope_mask), EGrantScopeMissing);
}

fun cleanup_inactive_grant_for_grantee(state: &mut SoulState, grantee: address, clock: &Clock) {
    if (!soul::active_grant_has_grantee_row(state, grantee)) {
        return
    };

    let slot = soul::active_grant_slot_for_grantee(state, grantee);
    let expired = soul::active_grant_slot_expires_at_ms(slot).is_some()
        && clock.timestamp_ms() >= *soul::active_grant_slot_expires_at_ms(slot).borrow();
    let epoch_mismatch = soul::active_grant_slot_ownership_epoch_snapshot(slot) != soul::ownership_epoch(state);
    if (expired || epoch_mismatch) {
        let removed = soul::remove_active_grant_for_grantee(state, grantee);
        if (expired) {
            event::emit(SoulGrantExpired {
                grant_id: soul::active_grant_slot_grant_id(&removed),
                soul_id: soul::soul_id(state),
                grantee: soul::active_grant_slot_grantee(&removed),
            });
        };
    };
}

fun assert_future_expiry(expires_at_ms: Option<u64>, clock: &Clock) {
    if (expires_at_ms.is_some()) {
        assert!(*expires_at_ms.borrow() > clock.timestamp_ms(), EGrantExpired);
    };
}

public(package) fun assert_valid_scope_mask(scope_mask: u64) {
    assert!(scope_mask != 0, EEmptyScopeMask);
    assert!((scope_mask & all_scopes()) == scope_mask, EGrantInvalidScopeMask);
}

public(package) fun all_scopes(): u64 {
    SCOPE_SEAL | SCOPE_MEMORY | SCOPE_SKILLS | SCOPE_ASSETS
}

fun has_required_scope(scope_mask: u64, required_scope_mask: u64): bool {
    (scope_mask & required_scope_mask) == required_scope_mask
}

#[test_only]
public fun destroy_for_testing(self: SoulGrant) {
    let SoulGrant {
        id,
        soul_id: _,
        grantee: _,
        issued_by: _,
        ownership_epoch_snapshot: _,
        scope_mask: _,
        expires_at_ms: _,
    } = self;
    id.delete();
}
