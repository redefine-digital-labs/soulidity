/// Ordinary public posts. Storage references are commitments, not storage
/// certificates: clients verify Walrus availability, bytes and public schema.
module soulidity::community_posts;

use soulidity::profile::{Self as profile, ProfileRegistryV1};
use sui::clock::Clock;
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 1;
const MAX_U64: u64 = 18446744073709551615;
const EInvalidVersion: u64 = 0;
const EActorNotRegistered: u64 = 1;
const EWrongRegistry: u64 = 2;
const EInvalidType: u64 = 3;
const EInvalidChannel: u64 = 4;
const EInvalidDocument: u64 = 5;
const ECounterOverflow: u64 = 6;
const ENotAuthor: u64 = 7;
const ENotQuestion: u64 = 8;
const EWrongParent: u64 = 9;
const EStaleRevision: u64 = 10;
const ERevisionOverflow: u64 = 11;

/// Only module init creates the production shared directory.
public struct CommunityRegistryV1 has key {
    id: UID,
    version: u64,
    post_count: u64,
    by_index: Table<u64, ID>,
}

public struct PublicDocumentRefV1 has copy, drop, store {
    blob_object_id: ID,
    blob_id: vector<u8>,
    sha256: vector<u8>,
    byte_length: u64,
}

/// Type: 0 log, 1 question, 2 knowledge. Channel: 0 general, 1 questions.
/// Content/identity are immutable. Comments update only count/directory/time;
/// acceptance updates only its selected ID and revision.
public struct PostV1 has key {
    id: UID,
    version: u64,
    registry_id: ID,
    profile_registry_id: ID,
    author: ID,
    author_owner: address,
    index: u64,
    post_type: u8,
    channel: u8,
    document: PublicDocumentRefV1,
    created_at_ms: u64,
    updated_at_ms: u64,
    comment_count: u64,
    comments_by_index: Table<u64, ID>,
    accepted_comment_id: Option<ID>,
    acceptance_revision: u64,
}

/// Frozen after creation; there is no reply tree or separate accepted flag.
public struct CommentV1 has key {
    id: UID,
    version: u64,
    registry_id: ID,
    profile_registry_id: ID,
    post_id: ID,
    author: ID,
    author_owner: address,
    index: u64,
    document: PublicDocumentRefV1,
    created_at_ms: u64,
}

public struct CommunityRegistryCreatedV1 has copy, drop { registry_id: ID }
public struct PostCreatedV1 has copy, drop {
    registry_id: ID, post_id: ID, author: ID, index: u64, timestamp_ms: u64,
}
public struct CommentCreatedV1 has copy, drop {
    registry_id: ID, post_id: ID, comment_id: ID, author: ID, index: u64, timestamp_ms: u64,
}
public struct AnswerAcceptedV1 has copy, drop {
    registry_id: ID, post_id: ID, comment_id: ID, revision: u64,
}

fun init(ctx: &mut TxContext) {
    let registry = CommunityRegistryV1 {
        id: object::new(ctx), version: VERSION, post_count: 0, by_index: table::new(ctx),
    };
    event::emit(CommunityRegistryCreatedV1 { registry_id: object::id(&registry) });
    transfer::share_object(registry);
}

fun document_ref(blob_object_id: ID, blob_id: vector<u8>, sha256: vector<u8>, byte_length: u64): PublicDocumentRefV1 {
    assert!(blob_object_id != object::id_from_address(@0x0)
        && blob_id.length() == 32 && sha256.length() == 32 && byte_length > 0, EInvalidDocument);
    PublicDocumentRefV1 { blob_object_id, blob_id, sha256, byte_length }
}

public(package) fun assert_post(registry: &CommunityRegistryV1, profiles: &ProfileRegistryV1, post: &PostV1) {
    assert!(registry.version == VERSION && post.version == VERSION, EInvalidVersion);
    assert!(post.registry_id == object::id(registry)
        && post.profile_registry_id == profile::registry_id(profiles)
        && registry.by_index.contains(post.index)
        && *registry.by_index.borrow(post.index) == object::id(post), EWrongRegistry);
}

public fun create_post(registry: &mut CommunityRegistryV1, profiles: &ProfileRegistryV1,
    author_id: ID, post_type: u8, channel: u8, blob_object_id: ID,
    blob_id: vector<u8>, sha256: vector<u8>, byte_length: u64,
    clock: &Clock, ctx: &mut TxContext): ID {
    assert!(registry.version == VERSION, EInvalidVersion);
    assert!(profile::is_registered_profile(profiles, ctx.sender(), author_id), EActorNotRegistered);
    assert!(post_type <= 2, EInvalidType);
    assert!(channel <= 1, EInvalidChannel);
    assert!(registry.post_count < MAX_U64, ECounterOverflow);
    let document = document_ref(blob_object_id, blob_id, sha256, byte_length);
    let index = registry.post_count;
    let timestamp_ms = clock.timestamp_ms();
    let post = PostV1 {
        id: object::new(ctx), version: VERSION, registry_id: object::id(registry),
        profile_registry_id: profile::registry_id(profiles), author: author_id, author_owner: ctx.sender(),
        index, post_type, channel, document, created_at_ms: timestamp_ms, updated_at_ms: timestamp_ms,
        comment_count: 0, comments_by_index: table::new(ctx),
        accepted_comment_id: option::none(), acceptance_revision: 0,
    };
    let post_id = object::id(&post);
    registry.by_index.add(index, post_id);
    registry.post_count = index + 1;
    event::emit(PostCreatedV1 { registry_id: object::id(registry), post_id, author: author_id, index, timestamp_ms });
    transfer::share_object(post);
    post_id
}

public fun create_comment(registry: &CommunityRegistryV1, profiles: &ProfileRegistryV1,
    post: &mut PostV1, author_id: ID, blob_object_id: ID,
    blob_id: vector<u8>, sha256: vector<u8>, byte_length: u64,
    clock: &Clock, ctx: &mut TxContext): ID {
    assert_post(registry, profiles, post);
    assert!(profile::is_registered_profile(profiles, ctx.sender(), author_id), EActorNotRegistered);
    assert!(post.comment_count < MAX_U64, ECounterOverflow);
    let document = document_ref(blob_object_id, blob_id, sha256, byte_length);
    let index = post.comment_count;
    let timestamp_ms = clock.timestamp_ms();
    let comment = CommentV1 {
        id: object::new(ctx), version: VERSION, registry_id: object::id(registry),
        profile_registry_id: profile::registry_id(profiles), post_id: object::id(post),
        author: author_id, author_owner: ctx.sender(), index, document, created_at_ms: timestamp_ms,
    };
    let comment_id = object::id(&comment);
    post.comments_by_index.add(index, comment_id);
    post.comment_count = index + 1;
    post.updated_at_ms = timestamp_ms;
    event::emit(CommentCreatedV1 { registry_id: object::id(registry), post_id: object::id(post),
        comment_id, author: author_id, index, timestamp_ms });
    transfer::freeze_object(comment);
    comment_id
}

public fun accept_answer(registry: &CommunityRegistryV1, profiles: &ProfileRegistryV1,
    post: &mut PostV1, comment: &CommentV1, author_id: ID,
    expected_revision: u64, ctx: &TxContext): u64 {
    assert_post(registry, profiles, post);
    assert!(profile::is_registered_profile(profiles, ctx.sender(), author_id), EActorNotRegistered);
    assert!(post.author == author_id && post.author_owner == ctx.sender(), ENotAuthor);
    assert!(post.post_type == 1, ENotQuestion);
    assert!(comment.version == VERSION, EInvalidVersion);
    assert!(comment.registry_id == post.registry_id && comment.profile_registry_id == post.profile_registry_id, EWrongRegistry);
    let comment_id = object::id(comment);
    assert!(comment.post_id == object::id(post) && post.comments_by_index.contains(comment.index)
        && *post.comments_by_index.borrow(comment.index) == comment_id, EWrongParent);
    assert!(post.acceptance_revision == expected_revision, EStaleRevision);
    if (post.accepted_comment_id == option::some(comment_id)) return post.acceptance_revision;
    assert!(post.acceptance_revision < MAX_U64, ERevisionOverflow);
    post.accepted_comment_id = option::some(comment_id);
    post.acceptance_revision = post.acceptance_revision + 1;
    event::emit(AnswerAcceptedV1 { registry_id: object::id(registry), post_id: object::id(post),
        comment_id, revision: post.acceptance_revision });
    post.acceptance_revision
}

public fun post_count(registry: &CommunityRegistryV1): u64 { registry.post_count }
public fun post_at_index(registry: &CommunityRegistryV1, index: u64): ID { *registry.by_index.borrow(index) }
public fun comment_count(post: &PostV1): u64 { post.comment_count }
public fun comment_at_index(post: &PostV1, index: u64): ID { *post.comments_by_index.borrow(index) }
public fun accepted_comment_id(post: &PostV1): Option<ID> { post.accepted_comment_id }
public fun acceptance_revision(post: &PostV1): u64 { post.acceptance_revision }
public fun post_author(post: &PostV1): ID { post.author }
public fun comment_author(comment: &CommentV1): ID { comment.author }
public fun comment_post_id(comment: &CommentV1): ID { comment.post_id }
public fun created_at_ms(post: &PostV1): u64 { post.created_at_ms }
public fun updated_at_ms(post: &PostV1): u64 { post.updated_at_ms }
public fun comment_created_at_ms(comment: &CommentV1): u64 { comment.created_at_ms }
public fun post_document(post: &PostV1): &PublicDocumentRefV1 { &post.document }
public fun comment_document(comment: &CommentV1): &PublicDocumentRefV1 { &comment.document }

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
#[test_only]
public fun set_post_count_for_testing(registry: &mut CommunityRegistryV1, count: u64) { registry.post_count = count }
#[test_only]
public fun set_comment_count_for_testing(post: &mut PostV1, count: u64) { post.comment_count = count }
#[test_only]
public fun set_acceptance_revision_for_testing(post: &mut PostV1, revision: u64) { post.acceptance_revision = revision }
#[test_only]
public fun set_registry_for_testing(post: &mut PostV1, id: ID) { post.registry_id = id }
#[test_only]
public fun set_profile_registry_for_testing(post: &mut PostV1, id: ID) { post.profile_registry_id = id }
