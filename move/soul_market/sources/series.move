module soul_market::series;

use std::string::{Self as string, String};
use sui::event;
use sui::vec_map::{Self, VecMap};

// === Events ===

public struct SeriesCreated has copy, drop {
    series_id: ID,
    author: address,
    name: vector<u8>,
    category: vector<u8>,
}

public struct SeriesMetadataUpdated has copy, drop {
    series_id: ID,
}

public struct ReleasePublished has copy, drop {
    series_id: ID,
    release_id: ID,
    version: vector<u8>,
    encrypted_blob_id: vector<u8>,
    public_metadata_id: vector<u8>,
    content_hash: vector<u8>,
}

public struct AuthorCapTransferred has copy, drop {
    series_id: ID,
    old_author: address,
    new_author: address,
}

// === Constants ===

const MAX_NAME_BYTES: u64 = 256;
const MAX_DESCRIPTION_BYTES: u64 = 4096;
const MAX_CATEGORY_BYTES: u64 = 64;
const MAX_TAGS: u64 = 10;
const MAX_TAG_BYTES: u64 = 64;
const MAX_PREVIEW_IMAGES: u64 = 10;
const MAX_PREVIEW_IMAGE_BYTES: u64 = 512;
const MAX_RELEASE_VERSION_BYTES: u64 = 64;
const MAX_RELEASE_BLOB_ID_BYTES: u64 = 256;
const MAX_RELEASE_PUBLIC_METADATA_ID_BYTES: u64 = 256;
const MAX_RELEASE_CONTENT_HASH_BYTES: u64 = 64;
const E_NOT_AUTHOR: u64 = 0;
const E_NAME_TOO_LONG: u64 = 30;
const E_DESCRIPTION_TOO_LONG: u64 = 31;
const E_CATEGORY_TOO_LONG: u64 = 32;
const E_TOO_MANY_TAGS: u64 = 33;
const E_TAG_TOO_LONG: u64 = 34;
const E_TOO_MANY_PREVIEW_IMAGES: u64 = 35;
const E_PREVIEW_IMAGE_TOO_LONG: u64 = 36;
const E_NAME_EMPTY: u64 = 37;
const E_CATEGORY_EMPTY: u64 = 38;
const E_SELF_TRANSFER: u64 = 39;
const E_PLAN_TYPE_ALREADY_ACTIVE: u64 = 40;
const E_PLAN_TYPE_NOT_ACTIVE: u64 = 41;
const E_RELEASE_VERSION_TOO_LONG: u64 = 42;
const E_RELEASE_BLOB_ID_TOO_LONG: u64 = 43;
const E_RELEASE_PUBLIC_METADATA_ID_TOO_LONG: u64 = 44;
const E_RELEASE_CONTENT_HASH_TOO_LONG: u64 = 45;
const E_INVALID_RECIPIENT: u64 = 46;
const E_RELEASE_VERSION_EMPTY: u64 = 47;
const E_RELEASE_BLOB_ID_EMPTY: u64 = 48;
const E_RELEASE_CONTENT_HASH_EMPTY: u64 = 49;
const E_RELEASE_PUBLIC_METADATA_ID_EMPTY: u64 = 50;
const E_DESCRIPTION_EMPTY: u64 = 51;

// === Structs ===

/// Author capability — proves ownership of a series.
/// Does not have `store`, so it cannot be freely transferred via public_transfer.
/// Use `transfer_author_cap` to transfer ownership and update payment recipient.
public struct AuthorCap has key {
    id: UID,
    series_id: ID,
}

/// A Soul product series (shared object)
public struct SoulSeries has key {
    id: UID,
    name: String,
    description: String,
    category: String,
    tags: vector<String>,
    preview_images: vector<String>,
    author: address,
    latest_release_id: Option<ID>,
    release_count: u64,
    active_plans: VecMap<u8, ID>,
}

/// An immutable release version (frozen object)
public struct SoulRelease has key {
    id: UID,
    series_id: ID,
    version: String,
    encrypted_blob_id: String,
    public_metadata_id: String,
    content_hash: vector<u8>,
    created_at: u64,
}

// === Internal Helpers ===

fun validate_metadata(
    name: &String,
    description: &String,
    category: &String,
    tags: &vector<String>,
    preview_images: &vector<String>,
) {
    assert!(name.length() > 0, E_NAME_EMPTY);
    assert!(name.length() <= MAX_NAME_BYTES, E_NAME_TOO_LONG);
    assert!(description.length() > 0, E_DESCRIPTION_EMPTY);
    assert!(description.length() <= MAX_DESCRIPTION_BYTES, E_DESCRIPTION_TOO_LONG);
    assert!(category.length() > 0, E_CATEGORY_EMPTY);
    assert!(category.length() <= MAX_CATEGORY_BYTES, E_CATEGORY_TOO_LONG);
    assert!(tags.length() <= MAX_TAGS, E_TOO_MANY_TAGS);
    let mut i = 0;
    while (i < tags.length()) {
        assert!(tags[i].length() <= MAX_TAG_BYTES, E_TAG_TOO_LONG);
        i = i + 1;
    };
    assert!(preview_images.length() <= MAX_PREVIEW_IMAGES, E_TOO_MANY_PREVIEW_IMAGES);
    let mut j = 0;
    while (j < preview_images.length()) {
        assert!(preview_images[j].length() <= MAX_PREVIEW_IMAGE_BYTES, E_PREVIEW_IMAGE_TOO_LONG);
        j = j + 1;
    };
}

fun validate_release_fields(
    version: &String,
    encrypted_blob_id: &String,
    public_metadata_id: &String,
    content_hash: &vector<u8>,
) {
    assert!(version.length() > 0, E_RELEASE_VERSION_EMPTY);
    assert!(version.length() <= MAX_RELEASE_VERSION_BYTES, E_RELEASE_VERSION_TOO_LONG);
    assert!(encrypted_blob_id.length() > 0, E_RELEASE_BLOB_ID_EMPTY);
    assert!(encrypted_blob_id.length() <= MAX_RELEASE_BLOB_ID_BYTES, E_RELEASE_BLOB_ID_TOO_LONG);
    assert!(public_metadata_id.length() > 0, E_RELEASE_PUBLIC_METADATA_ID_EMPTY);
    assert!(
        public_metadata_id.length() <= MAX_RELEASE_PUBLIC_METADATA_ID_BYTES,
        E_RELEASE_PUBLIC_METADATA_ID_TOO_LONG,
    );
    assert!(content_hash.length() > 0, E_RELEASE_CONTENT_HASH_EMPTY);
    assert!(content_hash.length() <= MAX_RELEASE_CONTENT_HASH_BYTES, E_RELEASE_CONTENT_HASH_TOO_LONG);
}

// === Entry Functions ===

/// Create a new Soul series. Returns AuthorCap to the sender.
public entry fun create_series_entry(
    name: String,
    description: String,
    category: String,
    tags: vector<String>,
    preview_images: vector<String>,
    ctx: &mut TxContext,
) {
    validate_metadata(&name, &description, &category, &tags, &preview_images);

    let author = ctx.sender();
    let series = SoulSeries {
        id: object::new(ctx),
        name,
        description,
        category,
        tags,
        preview_images,
        author,
        latest_release_id: option::none(),
        release_count: 0,
        active_plans: vec_map::empty(),
    };

    let series_id = object::id(&series);

    let cap = AuthorCap {
        id: object::new(ctx),
        series_id,
    };

    event::emit(SeriesCreated {
        series_id,
        author,
        name: *series.name.as_bytes(),
        category: *series.category.as_bytes(),
    });

    transfer::share_object(series);
    transfer::transfer(cap, author);
}

/// Publish a new release for a series. Only the AuthorCap holder can do this.
public entry fun publish_release(
    cap: &AuthorCap,
    series: &mut SoulSeries,
    version: String,
    encrypted_blob_id: String,
    public_metadata_id: String,
    content_hash: vector<u8>,
    clock: &sui::clock::Clock,
    ctx: &mut TxContext,
) {
    assert!(cap.series_id == object::id(series), E_NOT_AUTHOR);
    assert!(series.author == ctx.sender(), E_NOT_AUTHOR);
    validate_release_fields(&version, &encrypted_blob_id, &public_metadata_id, &content_hash);

    let release = SoulRelease {
        id: object::new(ctx),
        series_id: object::id(series),
        version,
        encrypted_blob_id,
        public_metadata_id,
        content_hash,
        created_at: clock.timestamp_ms(),
    };

    let release_id = object::id(&release);
    series.latest_release_id = option::some(release_id);
    series.release_count = series.release_count + 1;

    event::emit(ReleasePublished {
        series_id: object::id(series),
        release_id,
        version: *release.version.as_bytes(),
        encrypted_blob_id: *release.encrypted_blob_id.as_bytes(),
        public_metadata_id: *release.public_metadata_id.as_bytes(),
        content_hash: release.content_hash,
    });

    transfer::freeze_object(release);
}

/// Update series metadata (name, description, category, tags, preview_images)
public entry fun update_series_metadata(
    cap: &AuthorCap,
    series: &mut SoulSeries,
    name: String,
    description: String,
    category: String,
    tags: vector<String>,
    preview_images: vector<String>,
    ctx: &TxContext,
) {
    assert!(cap.series_id == object::id(series), E_NOT_AUTHOR);
    assert!(series.author == ctx.sender(), E_NOT_AUTHOR);
    validate_metadata(&name, &description, &category, &tags, &preview_images);

    series.name = name;
    series.description = description;
    series.category = category;
    series.tags = tags;
    series.preview_images = preview_images;

    event::emit(SeriesMetadataUpdated {
        series_id: object::id(series),
    });
}

/// Transfer AuthorCap to a new author, updating the series payment recipient.
public entry fun transfer_author_cap(
    cap: AuthorCap,
    series: &mut SoulSeries,
    recipient: address,
    ctx: &TxContext,
) {
    assert!(cap.series_id == object::id(series), E_NOT_AUTHOR);
    assert!(series.author == ctx.sender(), E_NOT_AUTHOR);
    assert!(recipient != @0x0, E_INVALID_RECIPIENT);
    assert!(series.author != recipient, E_SELF_TRANSFER);
    let old_author = series.author;
    series.author = recipient;
    event::emit(AuthorCapTransferred {
        series_id: cap.series_id,
        old_author,
        new_author: recipient,
    });
    transfer::transfer(cap, recipient);
}

// === Active Plan Registry ===

public(package) fun set_active_plan(series: &mut SoulSeries, plan_type: u8, plan_id: ID) {
    assert!(!series.active_plans.contains(&plan_type), E_PLAN_TYPE_ALREADY_ACTIVE);
    series.active_plans.insert(plan_type, plan_id);
}

public(package) fun remove_active_plan(series: &mut SoulSeries, plan_type: u8) {
    assert!(series.active_plans.contains(&plan_type), E_PLAN_TYPE_NOT_ACTIVE);
    series.active_plans.remove(&plan_type);
}

public(package) fun active_plan_id(series: &SoulSeries, plan_type: u8): ID {
    *series.active_plans.get(&plan_type)
}

public(package) fun has_active_plan(series: &SoulSeries, plan_type: u8): bool {
    series.active_plans.contains(&plan_type)
}

// === Accessors ===

public fun series_id(series: &SoulSeries): ID { object::id(series) }
public fun series_author(series: &SoulSeries): address { series.author }
public fun series_latest_release_id(series: &SoulSeries): Option<ID> { series.latest_release_id }
public fun release_series_id(release: &SoulRelease): ID { release.series_id }
public fun release_content_hash(release: &SoulRelease): vector<u8> { release.content_hash }
public fun author_cap_series_id(cap: &AuthorCap): ID { cap.series_id }

// === Test Helpers ===

#[test_only]
public(package) fun new_author_cap_for_testing(series: &SoulSeries, ctx: &mut TxContext): AuthorCap {
    AuthorCap {
        id: object::new(ctx),
        series_id: object::id(series),
    }
}

#[test_only]
public(package) fun new_series_for_testing(author: address, ctx: &mut TxContext): SoulSeries {
    SoulSeries {
        id: object::new(ctx),
        name: string::utf8(b"Test Series"),
        description: string::utf8(b"Test description"),
        category: string::utf8(b"music"),
        tags: vector[],
        preview_images: vector[],
        author,
        latest_release_id: option::none(),
        release_count: 0,
        active_plans: vec_map::empty(),
    }
}

#[test_only]
public(package) fun new_release_for_testing(
    series: &SoulSeries,
    version: vector<u8>,
    ctx: &mut TxContext,
): SoulRelease {
    SoulRelease {
        id: object::new(ctx),
        series_id: object::id(series),
        version: string::utf8(version),
        encrypted_blob_id: string::utf8(b"encrypted-blob"),
        public_metadata_id: string::utf8(b"public-metadata"),
        content_hash: b"content-hash",
        created_at: 0,
    }
}

#[test_only]
public(package) fun destroy_author_cap_for_testing(cap: AuthorCap) {
    let AuthorCap { id, series_id: _ } = cap;
    id.delete();
}

#[test_only]
public(package) fun destroy_series_for_testing(series: SoulSeries) {
    let SoulSeries {
        id,
        name: _,
        description: _,
        category: _,
        tags: _,
        preview_images: _,
        author: _,
        latest_release_id: _,
        release_count: _,
        active_plans: _,
    } = series;
    id.delete();
}

#[test_only]
public(package) fun destroy_release_for_testing(release: SoulRelease) {
    let SoulRelease {
        id,
        series_id: _,
        version: _,
        encrypted_blob_id: _,
        public_metadata_id: _,
        content_hash: _,
        created_at: _,
    } = release;
    id.delete();
}
