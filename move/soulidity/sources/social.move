/// Shared public following state. Identity is proven by the one profile
/// registry, never created here or delegated through a content-access grant.
module soulidity::social;

use soulidity::profile::{Self as profile, ProfileRegistryV1};
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 1;
const MAX_U64: u64 = 18446744073709551615;
const EInvalidVersion: u64 = 0;
const EActorNotRegistered: u64 = 1;
const ETargetNotRegistered: u64 = 2;
const ESelfFollow: u64 = 3;
const EStaleRevision: u64 = 4;
const ECounterOverflow: u64 = 5;
const ECounterUnderflow: u64 = 6;
const ERevisionOverflow: u64 = 7;

/// Created only by module init. ProfileRegistryV1 has the same singleton
/// construction boundary, so an arbitrary registry cannot be substituted.
public struct SocialRegistryV1 has key {
    id: UID,
    version: u64,
    counts: Table<ID, FollowCountsV1>,
    edges: Table<FollowKeyV1, FollowEdgeV1>,
}

public struct FollowCountsV1 has copy, drop, store {
    follower_count: u64,
    following_count: u64,
}

public struct FollowKeyV1 has copy, drop, store {
    follower: ID,
    following: ID,
}

public struct FollowEdgeV1 has copy, drop, store {
    following: bool,
    revision: u64,
}

public struct SocialRegistryCreatedV1 has copy, drop { social_registry_id: ID }
public struct FollowChangedV1 has copy, drop {
    social_registry_id: ID,
    profile_registry_id: ID,
    follower: ID,
    following: ID,
    desired: bool,
    revision: u64,
    follower_following_count: u64,
    following_follower_count: u64,
}

fun init(ctx: &mut TxContext) {
    let registry = SocialRegistryV1 {
        id: object::new(ctx), version: VERSION,
        counts: table::new(ctx), edges: table::new(ctx),
    };
    event::emit(SocialRegistryCreatedV1 { social_registry_id: object::id(&registry) });
    transfer::share_object(registry);
}

/// CAS is checked before no-op: an old intent cannot succeed merely because
/// somebody changed the state back. Absent edges are (false, 0). A real change
/// increments the revision, and unfollow leaves its tombstone forever.
public fun set_follow(
    registry: &mut SocialRegistryV1,
    profiles: &ProfileRegistryV1,
    actor_id: ID,
    target_id: ID,
    target_owner: address,
    expected_revision: u64,
    desired: bool,
    ctx: &TxContext,
): (bool, u64) {
    assert!(registry.version == VERSION, EInvalidVersion);
    assert!(profile::is_registered_profile(profiles, ctx.sender(), actor_id), EActorNotRegistered);
    assert!(profile::is_registered_profile(profiles, target_owner, target_id), ETargetNotRegistered);
    assert!(actor_id != target_id, ESelfFollow);
    let key = FollowKeyV1 { follower: actor_id, following: target_id };
    let previous = if (registry.edges.contains(key)) *registry.edges.borrow(key)
        else FollowEdgeV1 { following: false, revision: 0 };
    assert!(previous.revision == expected_revision, EStaleRevision);
    if (previous.following == desired) return (previous.following, previous.revision);
    assert!(previous.revision < MAX_U64, ERevisionOverflow);

    // Only a real edge change allocates rows; once created neither row is
    // removed, including when both counts return to zero.
    if (!registry.counts.contains(actor_id)) registry.counts.add(actor_id,
        FollowCountsV1 { follower_count: 0, following_count: 0 });
    if (!registry.counts.contains(target_id)) registry.counts.add(target_id,
        FollowCountsV1 { follower_count: 0, following_count: 0 });
    let actor_count = registry.counts.borrow(actor_id).following_count;
    let target_count = registry.counts.borrow(target_id).follower_count;
    if (desired) {
        assert!(actor_count < MAX_U64 && target_count < MAX_U64, ECounterOverflow);
    } else {
        assert!(actor_count > 0 && target_count > 0, ECounterUnderflow);
    };
    let actor_count = if (desired) actor_count + 1 else actor_count - 1;
    let target_count = if (desired) target_count + 1 else target_count - 1;
    registry.counts.borrow_mut(actor_id).following_count = actor_count;
    registry.counts.borrow_mut(target_id).follower_count = target_count;
    let revision = previous.revision + 1;
    if (registry.edges.contains(key)) {
        let edge = registry.edges.borrow_mut(key);
        edge.following = desired;
        edge.revision = revision;
    } else registry.edges.add(key, FollowEdgeV1 { following: desired, revision });
    event::emit(FollowChangedV1 {
        social_registry_id: object::id(registry), profile_registry_id: profile::registry_id(profiles),
        follower: actor_id, following: target_id, desired, revision,
        follower_following_count: actor_count, following_follower_count: target_count,
    });
    (desired, revision)
}

public fun counts(registry: &SocialRegistryV1, profile_id: ID): (u64, u64) {
    assert!(registry.version == VERSION, EInvalidVersion);
    if (!registry.counts.contains(profile_id)) return (0, 0);
    let row = registry.counts.borrow(profile_id);
    (row.follower_count, row.following_count)
}

public fun edge(registry: &SocialRegistryV1, follower: ID, following: ID): (bool, u64) {
    assert!(registry.version == VERSION, EInvalidVersion);
    let key = FollowKeyV1 { follower, following };
    if (!registry.edges.contains(key)) return (false, 0);
    let row = registry.edges.borrow(key);
    (row.following, row.revision)
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
#[test_only]
public fun has_counts_for_testing(registry: &SocialRegistryV1, profile_id: ID): bool { registry.counts.contains(profile_id) }
#[test_only]
public fun has_edge_for_testing(registry: &SocialRegistryV1, follower: ID, following: ID): bool {
    registry.edges.contains(FollowKeyV1 { follower, following })
}
#[test_only]
public fun set_version_for_testing(registry: &mut SocialRegistryV1, version: u64) { registry.version = version }
#[test_only]
public fun set_counts_for_testing(registry: &mut SocialRegistryV1, profile_id: ID, followers: u64, following: u64) {
    if (registry.counts.contains(profile_id)) { registry.counts.remove(profile_id); };
    registry.counts.add(profile_id, FollowCountsV1 { follower_count: followers, following_count: following });
}
#[test_only]
public fun set_edge_for_testing(registry: &mut SocialRegistryV1, follower: ID, following: ID, desired: bool, revision: u64) {
    let key = FollowKeyV1 { follower, following };
    if (registry.edges.contains(key)) { registry.edges.remove(key); };
    registry.edges.add(key, FollowEdgeV1 { following: desired, revision });
}
