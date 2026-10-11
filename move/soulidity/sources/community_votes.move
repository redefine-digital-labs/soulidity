/// Public wallet-linked votes on ordinary Posts. Commands set a desired state
/// rather than toggle, so an uncertain transaction can be recovered safely.
module soulidity::community_votes;

use soulidity::community_posts::{Self as posts, CommunityRegistryV1, PostV1};
use soulidity::profile::{Self as profile, ProfileRegistryV1};
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 1;
const MAX_U64: u64 = 18446744073709551615;
const EInvalidVersion: u64 = 0;
const EActorNotRegistered: u64 = 1;
const EInvalidState: u64 = 2;
const EStaleRevision: u64 = 3;
const ECounterOverflow: u64 = 4;
const ECounterUnderflow: u64 = 5;
const ERevisionOverflow: u64 = 6;

public struct VoteRegistryV1 has key {
    id: UID,
    version: u64,
    counts: Table<ID, VoteCountsV1>,
    edges: Table<VoteKeyV1, VoteEdgeV1>,
}
public struct VoteCountsV1 has copy, drop, store { up_count: u64, down_count: u64 }
public struct VoteKeyV1 has copy, drop, store { actor: ID, post: ID }
/// 0 none, 1 up, 2 down. Removing a vote retains this revision forever.
public struct VoteEdgeV1 has copy, drop, store { state: u8, revision: u64 }
public struct VoteRegistryCreatedV1 has copy, drop { registry_id: ID }
public struct VoteChangedV1 has copy, drop {
    registry_id: ID, community_registry_id: ID, profile_registry_id: ID,
    post_id: ID, actor: ID, state: u8, revision: u64, up_count: u64, down_count: u64,
}

fun init(ctx: &mut TxContext) {
    let registry = VoteRegistryV1 {
        id: object::new(ctx), version: VERSION, counts: table::new(ctx), edges: table::new(ctx),
    };
    event::emit(VoteRegistryCreatedV1 { registry_id: object::id(&registry) });
    transfer::share_object(registry);
}

fun assert_target(registry: &VoteRegistryV1, community: &CommunityRegistryV1,
    profiles: &ProfileRegistryV1, post: &PostV1) {
    assert!(registry.version == VERSION, EInvalidVersion);
    posts::assert_post(community, profiles, post);
}

fun previous(registry: &VoteRegistryV1, key: VoteKeyV1): VoteEdgeV1 {
    if (!registry.edges.contains(key)) return VoteEdgeV1 { state: 0, revision: 0 };
    let edge = *registry.edges.borrow(key);
    assert!(edge.state <= 2 && edge.revision > 0 && registry.counts.contains(key.post), EInvalidState);
    edge
}

/// Self-votes are intentionally allowed, matching the retained product.
/// No mutable Post or Clock is accepted: voting cannot edit content timestamps.
public fun set_vote(registry: &mut VoteRegistryV1, community: &CommunityRegistryV1,
    profiles: &ProfileRegistryV1, post: &PostV1, actor_id: ID,
    expected_revision: u64, desired: u8, ctx: &TxContext): (u8, u64) {
    assert_target(registry, community, profiles, post);
    assert!(profile::is_registered_profile(profiles, ctx.sender(), actor_id), EActorNotRegistered);
    assert!(desired <= 2, EInvalidState);
    let post_id = object::id(post);
    let key = VoteKeyV1 { actor: actor_id, post: post_id };
    let old = previous(registry, key);
    assert!(old.revision == expected_revision, EStaleRevision);
    if (old.state == desired) return (old.state, old.revision);
    assert!(old.revision < MAX_U64, ERevisionOverflow);
    let mut counts = if (registry.counts.contains(post_id)) *registry.counts.borrow(post_id)
        else VoteCountsV1 { up_count: 0, down_count: 0 };
    if (old.state == 1) {
        assert!(counts.up_count > 0, ECounterUnderflow);
        counts.up_count = counts.up_count - 1;
    } else if (old.state == 2) {
        assert!(counts.down_count > 0, ECounterUnderflow);
        counts.down_count = counts.down_count - 1;
    };
    if (desired == 1) {
        assert!(counts.up_count < MAX_U64, ECounterOverflow);
        counts.up_count = counts.up_count + 1;
    } else if (desired == 2) {
        assert!(counts.down_count < MAX_U64, ECounterOverflow);
        counts.down_count = counts.down_count + 1;
    };
    let revision = old.revision + 1;
    if (registry.counts.contains(post_id)) *registry.counts.borrow_mut(post_id) = counts
    else registry.counts.add(post_id, counts);
    if (registry.edges.contains(key)) *registry.edges.borrow_mut(key) = VoteEdgeV1 { state: desired, revision }
    else registry.edges.add(key, VoteEdgeV1 { state: desired, revision });
    event::emit(VoteChangedV1 { registry_id: object::id(registry), community_registry_id: object::id(community),
        profile_registry_id: profile::registry_id(profiles), post_id, actor: actor_id, state: desired, revision,
        up_count: counts.up_count, down_count: counts.down_count });
    (desired, revision)
}

/// Absence is zero only after proving an actual registered Post.
public fun counts(registry: &VoteRegistryV1, community: &CommunityRegistryV1,
    profiles: &ProfileRegistryV1, post: &PostV1): (u64, u64) {
    assert_target(registry, community, profiles, post);
    let id = object::id(post);
    if (!registry.counts.contains(id)) return (0, 0);
    let value = registry.counts.borrow(id);
    (value.up_count, value.down_count)
}
public fun edge(registry: &VoteRegistryV1, community: &CommunityRegistryV1,
    profiles: &ProfileRegistryV1, post: &PostV1, actor: ID, owner: address): (u8, u64) {
    assert_target(registry, community, profiles, post);
    assert!(profile::is_registered_profile(profiles, owner, actor), EActorNotRegistered);
    let value = previous(registry, VoteKeyV1 { actor, post: object::id(post) });
    (value.state, value.revision)
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
#[test_only]
public fun set_version_for_testing(registry: &mut VoteRegistryV1, version: u64) { registry.version = version }
#[test_only]
public fun set_counts_for_testing(registry: &mut VoteRegistryV1, post: ID, up_count: u64, down_count: u64) {
    if (registry.counts.contains(post)) { registry.counts.remove(post); };
    registry.counts.add(post, VoteCountsV1 { up_count, down_count });
}
#[test_only]
public fun set_edge_for_testing(registry: &mut VoteRegistryV1, actor: ID, post: ID, state: u8, revision: u64) {
    let key = VoteKeyV1 { actor, post };
    if (registry.edges.contains(key)) { registry.edges.remove(key); };
    registry.edges.add(key, VoteEdgeV1 { state, revision });
}
#[test_only]
public fun has_rows_for_testing(registry: &VoteRegistryV1, actor: ID, post: ID): (bool, bool) {
    (registry.counts.contains(post), registry.edges.contains(VoteKeyV1 { actor, post }))
}
