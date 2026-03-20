module soul_market::series;

use std::string::String;
use sui::event;

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

// === Structs ===

/// Author capability — proves ownership of a series.
/// Does not have `store`, so it cannot be freely transferred via public_transfer.
/// Use `transfer_author_cap` to transfer ownership and update payment recipient.
public struct AuthorCap has key {
    id: UID,
    series_id: ID,
}

/// A Soul product series (shared object)
public struct SoulSeries has key, store {
    id: UID,
    name: String,
    description: String,
    category: String,
    tags: vector<String>,
    preview_images: vector<String>,
    author: address,
    latest_release_id: Option<ID>,
    release_count: u64,
}

/// An immutable release version (frozen object)
public struct SoulRelease has key, store {
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
    assert!(name.length() <= MAX_NAME_BYTES, 30); // ENameTooLong
    assert!(description.length() <= MAX_DESCRIPTION_BYTES, 31); // EDescriptionTooLong
    assert!(category.length() <= MAX_CATEGORY_BYTES, 32); // ECategoryTooLong
    assert!(tags.length() <= MAX_TAGS, 33); // ETooManyTags
    let mut i = 0;
    while (i < tags.length()) {
        assert!(tags[i].length() <= MAX_TAG_BYTES, 34); // ETagTooLong
        i = i + 1;
    };
    assert!(preview_images.length() <= MAX_PREVIEW_IMAGES, 35); // ETooManyPreviewImages
    let mut j = 0;
    while (j < preview_images.length()) {
        assert!(preview_images[j].length() <= MAX_PREVIEW_IMAGE_BYTES, 36); // EPreviewImageTooLong
        j = j + 1;
    };
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
    assert!(cap.series_id == object::id(series), 0); // ENotAuthor

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
) {
    assert!(cap.series_id == object::id(series), 0); // ENotAuthor
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
) {
    assert!(cap.series_id == object::id(series), 0); // ENotAuthor
    let old_author = series.author;
    series.author = recipient;
    event::emit(AuthorCapTransferred {
        series_id: cap.series_id,
        old_author,
        new_author: recipient,
    });
    transfer::transfer(cap, recipient);
}

// === Accessors ===

public fun series_id(series: &SoulSeries): ID { object::id(series) }
public fun series_author(series: &SoulSeries): address { series.author }
public fun series_latest_release_id(series: &SoulSeries): Option<ID> { series.latest_release_id }
public fun release_series_id(release: &SoulRelease): ID { release.series_id }
public fun release_content_hash(release: &SoulRelease): vector<u8> { release.content_hash }
public fun author_cap_series_id(cap: &AuthorCap): ID { cap.series_id }
