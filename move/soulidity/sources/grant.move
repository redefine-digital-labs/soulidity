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

public struct SoulGrantInvalidated has copy, drop {
    grant_id: ID,
    soul_id: ID,
    grantee: address,
    invalidated_by: address,
    new_owner: address,
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

    cleanup_expired_impl(state, clock);

    let mut existing_index = soul::active_grant_index_by_grantee(state, grantee);
    let mut replaced_slot = if (existing_index.is_some()) {
        option::some(soul::remove_active_grant_at(state, option::extract(&mut existing_index)))
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

    soul::push_active_grant(state, grant_id, grantee, scope_mask, expires_at_ms);
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
    cleanup_expired_impl(state, clock);
    let mut index = soul::active_grant_index_by_grantee(state, grantee);
    assert!(index.is_some(), EGrantNotFound);
    let slot = soul::remove_active_grant_at(state, option::extract(&mut index));
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
    cleanup_expired_impl(state, clock);

    let mut index = soul::active_grant_index_by_grantee(state, grantee);
    assert!(index.is_some(), EGrantNotFound);
    let slot = soul::remove_active_grant_at(state, option::extract(&mut index));
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
    soul::push_active_grant(
        state,
        new_grant_id,
        grantee,
        retained_scope_mask,
        *soul::active_grant_slot_expires_at_ms(&slot),
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

public fun cleanup_expired(state: &mut SoulState, clock: &Clock) {
    cleanup_expired_impl(state, clock);
}

public(package) fun invalidate_all_for_owner_rotation(
    state: &mut SoulState,
    new_owner: address,
    invalidated_by: address,
) {
    while (soul::active_grant_count(state) > 0) {
        let last_index = soul::active_grant_count(state) - 1;
        let slot = soul::remove_active_grant_at(state, last_index);
        event::emit(SoulGrantInvalidated {
            grant_id: soul::active_grant_slot_grant_id(&slot),
            soul_id: soul::soul_id(state),
            grantee: soul::active_grant_slot_grantee(&slot),
            invalidated_by,
            new_owner,
        });
    };
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
        assert!(clock.timestamp_ms() <= *self.expires_at_ms.borrow(), EGrantExpired);
    };

    let mut index = soul::active_grant_index_by_id(state, object::id(self));
    assert!(index.is_some(), EGrantNotActive);
    let slot = soul::active_grant_slot_at(state, option::extract(&mut index));
    assert!(soul::active_grant_slot_grantee(slot) == self.grantee, EGrantIdMismatch);
    assert!(soul::active_grant_slot_scope_mask(slot) == self.scope_mask, EGrantIdMismatch);
    assert!(has_required_scope(self.scope_mask, required_scope_mask), EGrantScopeMissing);
}

fun cleanup_expired_impl(state: &mut SoulState, clock: &Clock) {
    let mut i = 0;
    while (i < soul::active_grant_count(state)) {
        let expired = {
            let slot = soul::active_grant_slot_at(state, i);
            soul::active_grant_slot_expires_at_ms(slot).is_some()
                && clock.timestamp_ms() > *soul::active_grant_slot_expires_at_ms(slot).borrow()
        };

        if (expired) {
            let slot = soul::remove_active_grant_at(state, i);
            event::emit(SoulGrantExpired {
                grant_id: soul::active_grant_slot_grant_id(&slot),
                soul_id: soul::soul_id(state),
                grantee: soul::active_grant_slot_grantee(&slot),
            });
        } else {
            i = i + 1;
        };
    };
}

fun assert_valid_scope_mask(scope_mask: u64) {
    assert!(scope_mask != 0, EEmptyScopeMask);
    assert!((scope_mask & all_scopes()) == scope_mask, EGrantInvalidScopeMask);
}

fun all_scopes(): u64 {
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
