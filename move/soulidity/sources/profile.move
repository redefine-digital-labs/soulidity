/// Public account identity for the static client. Private preferences, device
/// credentials and private loadouts do not belong in this object or its metadata.
module soulidity::profile;

use std::string::String;
use std::{bcs, hash};
use sui::clock::Clock;
use sui::dynamic_field as df;
use sui::event;
use sui::table::{Self as table, Table};

const VERSION: u64 = 1;
const MAX_METADATA_BYTES: u64 = 65536;
const EWrongRegistry: u64 = 0;
const ENotOwner: u64 = 1;
const EAlreadyRegistered: u64 = 2;
const EInvalidHandle: u64 = 3;
const EReservedHandle: u64 = 4;
const EHandleTaken: u64 = 5;
const EStaleRevision: u64 = 6;
const EInvalidMetadata: u64 = 7;
const EInvalidVersion: u64 = 8;
const BOOKMARKS_VERSION: u8 = 1;
const MAX_BOOKMARKS_CIPHERTEXT_BYTES: u64 = 16_777_216;
const MAX_BOOKMARKS_RECEIPTS: u64 = 32;
const EInvalidBookmarksHead: u64 = 9;
const EInvalidBookmarksReference: u64 = 10;
const EBookmarksRequestConflict: u64 = 11;
const EBookmarksSealIdMismatch: u64 = 12;

/// Append-only profile directory. The index is a stable creation-order cursor;
/// clients can enumerate pages without relying on a private indexer/database.
public struct ProfileRegistryV1 has key {
    id: UID,
    version: u64,
    profile_count: u64,
    by_owner: Table<address, ID>,
    by_handle: Table<String, ID>,
    by_index: Table<u64, ID>,
}

/// Self-published public metadata, not a certificate of storage availability.
/// Readers must verify the referenced Walrus object, byte length and SHA-256
/// before parsing/rendering it. No arbitrary endpoint is supplied by this record.
public struct PublicMetadataV1 has copy, drop, store {
    blob_object_id: ID,
    blob_id: vector<u8>,
    sha256: vector<u8>,
    byte_length: u64,
}

/// No `store`, transfer or owner setter: the profile remains bound to its wallet.
/// Its ID, not a mutable/reusable handle, is the durable public identity.
public struct WalletProfileV1 has key {
    id: UID,
    version: u64,
    registry_id: ID,
    owner: address,
    revision: u64,
    handle: String,
    metadata: PublicMetadataV1,
    created_at_ms: u64,
    updated_at_ms: u64,
}

public struct ProfileRegistryCreatedV1 has copy, drop {
    registry_id: ID,
}

public struct ProfileCreatedV1 has copy, drop {
    registry_id: ID,
    profile_id: ID,
    owner: address,
    index: u64,
    revision: u64,
    handle: String,
    metadata: PublicMetadataV1,
    timestamp_ms: u64,
}

public struct ProfileUpdatedV1 has copy, drop {
    registry_id: ID,
    profile_id: ID,
    owner: address,
    revision: u64,
    previous_handle: String,
    handle: String,
    metadata: PublicMetadataV1,
    timestamp_ms: u64,
}

/// Wallet-private documents have no public Profile or asset prerequisite. The
/// key and ciphertext metadata are public; Soul IDs, names, counts and intent
/// remain exclusively inside the encrypted document. Existing registry/profile
/// layouts are unchanged.
public struct BookmarksHeadKeyV1 has copy, drop, store {
    version: u8,
    owner: address,
}

public struct BookmarksCipherRefV1 has copy, drop, store {
    blob_object_id: ID,
    blob_id: String,
    sha256: vector<u8>,
    byte_length: u64,
}

public struct BookmarksReceiptV1 has copy, drop, store {
    request_id: vector<u8>,
    revision: u64,
    ciphertext: BookmarksCipherRefV1,
}

public struct BookmarksHeadV1 has copy, drop, store {
    version: u8,
    registry_id: ID,
    owner: address,
    revision: u64,
    ciphertext: BookmarksCipherRefV1,
    receipts: vector<BookmarksReceiptV1>,
}

public struct BookmarksSealScopeV1 has drop {
    domain: String,
    version: u8,
    registry_id: ID,
    owner: address,
}

fun init(ctx: &mut TxContext) {
    let registry = ProfileRegistryV1 {
        id: object::new(ctx), version: VERSION, profile_count: 0,
        by_owner: table::new(ctx), by_handle: table::new(ctx), by_index: table::new(ctx),
    };
    event::emit(ProfileRegistryCreatedV1 { registry_id: object::id(&registry) });
    transfer::share_object(registry);
}

/// Empty means no public handle, matching the existing clear-handle operation.
/// Nonempty handles are canonical lowercase ASCII, with the existing 3..30 bound.
fun assert_handle(handle: &String) {
    let bytes = handle.as_bytes();
    if (bytes.is_empty()) return;
    assert!(bytes.length() >= 3 && bytes.length() <= 30, EInvalidHandle);
    let mut i = 0;
    while (i < bytes.length()) {
        let b = bytes[i];
        assert!((b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b == 95, EInvalidHandle);
        i = i + 1;
    };
    assert!(*bytes != b"clawnews_bot" && *bytes != b"system"
        && *bytes != b"admin" && *bytes != b"moderator", EReservedHandle);
}

fun metadata_ref(blob_object_id: ID, blob_id: vector<u8>, sha256: vector<u8>, byte_length: u64): PublicMetadataV1 {
    assert!(blob_object_id != object::id_from_address(@0x0)
        && blob_id.length() == 32 && sha256.length() == 32
        && byte_length > 0 && byte_length <= MAX_METADATA_BYTES, EInvalidMetadata);
    PublicMetadataV1 { blob_object_id, blob_id, sha256, byte_length }
}

/// Wallet connection alone never creates a profile. The user explicitly approves
/// this transaction after reviewing/uploading their public metadata.
public fun create_profile(
    registry: &mut ProfileRegistryV1,
    handle: String,
    blob_object_id: ID,
    blob_id: vector<u8>,
    sha256: vector<u8>,
    byte_length: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    assert!(registry.version == VERSION, EInvalidVersion);
    let owner = ctx.sender();
    assert!(!registry.by_owner.contains(owner), EAlreadyRegistered);
    assert_handle(&handle);
    assert!(handle.is_empty() || !registry.by_handle.contains(handle), EHandleTaken);
    let metadata = metadata_ref(blob_object_id, blob_id, sha256, byte_length);
    let timestamp_ms = clock.timestamp_ms();
    let profile = WalletProfileV1 {
        id: object::new(ctx), version: VERSION, registry_id: object::id(registry),
        owner, revision: 0, handle, metadata, created_at_ms: timestamp_ms, updated_at_ms: timestamp_ms,
    };
    let profile_id = object::id(&profile);
    let index = registry.profile_count;
    registry.by_owner.add(owner, profile_id);
    registry.by_index.add(index, profile_id);
    if (!handle.is_empty()) registry.by_handle.add(handle, profile_id);
    registry.profile_count = index + 1;
    event::emit(ProfileCreatedV1 {
        registry_id: object::id(registry), profile_id, owner, index,
        revision: 0, handle, metadata, timestamp_ms,
    });
    transfer::transfer(profile, owner);
    profile_id
}

public fun update_profile(
    registry: &mut ProfileRegistryV1,
    profile: &mut WalletProfileV1,
    expected_revision: u64,
    handle: String,
    blob_object_id: ID,
    blob_id: vector<u8>,
    sha256: vector<u8>,
    byte_length: u64,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(registry.version == VERSION && profile.version == VERSION, EInvalidVersion);
    assert!(profile.registry_id == object::id(registry), EWrongRegistry);
    assert!(profile.owner == ctx.sender(), ENotOwner);
    assert!(registry.by_owner.contains(profile.owner)
        && *registry.by_owner.borrow(profile.owner) == object::id(profile), EWrongRegistry);
    assert!(profile.revision == expected_revision, EStaleRevision);
    assert_handle(&handle);
    let metadata = metadata_ref(blob_object_id, blob_id, sha256, byte_length);
    let previous_handle = profile.handle;
    if (handle != previous_handle) {
        assert!(handle.is_empty() || !registry.by_handle.contains(handle), EHandleTaken);
        if (!previous_handle.is_empty()) {
            let previous_id = registry.by_handle.remove(previous_handle);
            assert!(previous_id == object::id(profile), EWrongRegistry);
        };
        if (!handle.is_empty()) registry.by_handle.add(handle, object::id(profile));
    };
    profile.handle = handle;
    profile.metadata = metadata;
    profile.revision = profile.revision + 1;
    profile.updated_at_ms = clock.timestamp_ms();
    event::emit(ProfileUpdatedV1 {
        registry_id: object::id(registry), profile_id: object::id(profile), owner: profile.owner,
        revision: profile.revision, previous_handle, handle, metadata, timestamp_ms: profile.updated_at_ms,
    });
}

public fun registry_id(registry: &ProfileRegistryV1): ID { object::id(registry) }
public fun profile_count(registry: &ProfileRegistryV1): u64 { registry.profile_count }
public fun contains_owner(registry: &ProfileRegistryV1, owner: address): bool { registry.by_owner.contains(owner) }
public fun contains_handle(registry: &ProfileRegistryV1, handle: String): bool { registry.by_handle.contains(handle) }
public fun profile_for_owner(registry: &ProfileRegistryV1, owner: address): ID { *registry.by_owner.borrow(owner) }
public fun profile_for_handle(registry: &ProfileRegistryV1, handle: String): ID { *registry.by_handle.borrow(handle) }
public fun profile_at_index(registry: &ProfileRegistryV1, index: u64): ID { *registry.by_index.borrow(index) }
public fun owner(profile: &WalletProfileV1): address { profile.owner }
public fun revision(profile: &WalletProfileV1): u64 { profile.revision }
public fun handle(profile: &WalletProfileV1): &String { &profile.handle }
public fun metadata(profile: &WalletProfileV1): &PublicMetadataV1 { &profile.metadata }
public fun metadata_blob_object_id(metadata: &PublicMetadataV1): ID { metadata.blob_object_id }
public fun metadata_blob_id(metadata: &PublicMetadataV1): &vector<u8> { &metadata.blob_id }
public fun metadata_sha256(metadata: &PublicMetadataV1): &vector<u8> { &metadata.sha256 }
public fun metadata_byte_length(metadata: &PublicMetadataV1): u64 { metadata.byte_length }

/// Stable through head changes, including absent/paid-but-uncommitted heads.
public fun bookmarks_seal_id(registry: &ProfileRegistryV1, owner: address): vector<u8> {
    assert!(registry.version == VERSION, EInvalidVersion);
    hash::sha2_256(bcs::to_bytes(&BookmarksSealScopeV1 {
        domain: b"soulidity/private-bookmarks/seal-id/v1".to_string(),
        version: BOOKMARKS_VERSION, registry_id: object::id(registry), owner,
    }))
}

public fun seal_approve_bookmarks(id: vector<u8>, registry: &ProfileRegistryV1, ctx: &TxContext) {
    assert!(id == bookmarks_seal_id(registry, ctx.sender()), EBookmarksSealIdMismatch);
}

/// Read-only metadata is not access to the encrypted private document.
public fun bookmarks_head(registry: &ProfileRegistryV1, owner: address): Option<BookmarksHeadV1> {
    assert!(registry.version == VERSION, EInvalidVersion);
    let key = BookmarksHeadKeyV1 { version: BOOKMARKS_VERSION, owner };
    if (!df::exists(&registry.id, key)) return option::none();
    let head: &BookmarksHeadV1 = df::borrow(&registry.id, key);
    assert!(head.version == BOOKMARKS_VERSION && head.registry_id == object::id(registry)
        && head.owner == owner && head.revision > 0
        && head.receipts.length() > 0 && head.receipts.length() <= MAX_BOOKMARKS_RECEIPTS,
        EInvalidBookmarksHead);
    option::some(*head)
}

public fun bookmarks_revision(registry: &ProfileRegistryV1, owner: address): u64 {
    let head = bookmarks_head(registry, owner);
    if (head.is_some()) head.borrow().revision else 0
}

public fun bookmarks_receipt(registry: &ProfileRegistryV1, owner: address,
    request_id: vector<u8>): Option<BookmarksReceiptV1> {
    let head = bookmarks_head(registry, owner);
    if (head.is_none()) return option::none();
    let receipts = &head.borrow().receipts;
    let mut i = 0;
    while (i < receipts.length()) {
        if (receipts[i].request_id == request_id) return option::some(receipts[i]);
        i = i + 1;
    };
    option::none()
}

public fun bookmarks_receipt_revision(receipt: &BookmarksReceiptV1): u64 { receipt.revision }

fun assert_bookmarks_hash(bytes: &vector<u8>) {
    assert!(bytes.length() == 32, EInvalidBookmarksReference);
    let mut nonzero = false;
    bytes.do_ref!(|byte| { if (*byte != 0) nonzero = true });
    assert!(nonzero, EInvalidBookmarksReference);
}

fun assert_bookmarks_reference(reference: &BookmarksCipherRefV1, request_id: &vector<u8>) {
    assert_bookmarks_hash(request_id);
    assert_bookmarks_hash(&reference.sha256);
    assert!(reference.blob_object_id != object::id_from_address(@0x0)
        && reference.byte_length > 0 && reference.byte_length <= MAX_BOOKMARKS_CIPHERTEXT_BYTES,
        EInvalidBookmarksReference);
    let bytes = reference.blob_id.as_bytes();
    assert!(bytes.length() == 43, EInvalidBookmarksReference);
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut i = 0;
    while (i < bytes.length()) {
        assert!(alphabet.contains(&bytes[i]), EInvalidBookmarksReference);
        i = i + 1;
    };
    assert!(b"AEIMQUYcgkosw048".contains(&bytes[42]), EInvalidBookmarksReference);
}

/// Owner/key are derived exclusively from the transaction sender. A bounded
/// replay receipt resolves before CAS; uncertain retries never retoggle intent.
/// Move checks ciphertext references, not Walrus certification or private data.
/// This emits no bookmark event and does not change public profile counters.
public fun commit_bookmarks(registry: &mut ProfileRegistryV1, expected_revision: u64,
    request_id: vector<u8>, blob_object_id: ID, blob_id: String,
    cipher_sha256: vector<u8>, cipher_bytes: u64, ctx: &TxContext): u64 {
    let owner = ctx.sender();
    let head = bookmarks_head(registry, owner);
    let ciphertext = BookmarksCipherRefV1 {
        blob_object_id, blob_id, sha256: cipher_sha256, byte_length: cipher_bytes,
    };
    if (head.is_some()) {
        let receipts = &head.borrow().receipts;
        let mut i = 0;
        while (i < receipts.length()) {
            if (receipts[i].request_id == request_id) {
                assert!(receipts[i].ciphertext == ciphertext, EBookmarksRequestConflict);
                return receipts[i].revision
            };
            i = i + 1;
        };
    };
    let revision = if (head.is_some()) head.borrow().revision else 0;
    assert!(revision == expected_revision && revision < 18_446_744_073_709_551_615, EStaleRevision);
    assert_bookmarks_reference(&ciphertext, &request_id);
    let revision = revision + 1;
    let mut receipts = if (head.is_some()) head.borrow().receipts else vector[];
    if (receipts.length() == MAX_BOOKMARKS_RECEIPTS) { receipts.remove(0); };
    receipts.push_back(BookmarksReceiptV1 { request_id, revision, ciphertext });
    let key = BookmarksHeadKeyV1 { version: BOOKMARKS_VERSION, owner };
    let next = BookmarksHeadV1 { version: BOOKMARKS_VERSION, registry_id: object::id(registry),
        owner, revision, ciphertext, receipts };
    if (head.is_some()) *df::borrow_mut(&mut registry.id, key) = next
    else df::add(&mut registry.id, key, next);
    revision
}

/// Registration proof for package-local shared-state modules. A caller-supplied
/// profile ID alone is never identity, and invalid registries keep their error.
public(package) fun is_registered_profile(registry: &ProfileRegistryV1, owner: address, profile_id: ID): bool {
    assert!(registry.version == VERSION, EInvalidVersion);
    registry.by_owner.contains(owner) && *registry.by_owner.borrow(owner) == profile_id
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }
