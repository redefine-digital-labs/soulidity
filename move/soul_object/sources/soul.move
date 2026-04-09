module soul_object::soul;

use std::string::String;
use sui::display::{Self, Display};
use sui::event;
use sui::package::{Self, Publisher};
use walrus::blob::{Self, Blob};

public struct SoulMinted has copy, drop {
    soul_id: ID,
    creator: address,
    blob_object_id: ID,
}

public struct SOUL has drop {}

public struct Soul has key, store {
    id: UID,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    allowlist_address: Option<address>,
    allowlist_version: u64,
    creator: address,
    creator_royalty_bps: u16,
}

const ECreatorRoyaltyTooHigh: u64 = 0;
const MAX_CREATOR_ROYALTY_BPS: u16 = 2_500;

fun init(otw: SOUL, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let recipient = ctx.sender();
    let soul_display = create_display(&publisher, ctx);

    transfer::public_transfer(soul_display, recipient);
    publisher.burn();
}

public(package) fun mint(
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    ctx: &mut TxContext,
): Soul {
    mint_with_creator_royalty(
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        0,
        ctx,
    )
}

public(package) fun mint_with_creator_royalty(
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    creator_royalty_bps: u16,
    ctx: &mut TxContext,
): Soul {
    mint_with_creator(
        ctx.sender(),
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        creator_royalty_bps,
        ctx,
    )
}

public fun creator(self: &Soul): address {
    self.creator
}

public fun creator_royalty_bps(self: &Soul): u16 {
    self.creator_royalty_bps
}

public fun name(self: &Soul): &String {
    &self.name
}

public fun description(self: &Soul): &String {
    &self.description
}

public fun image_url(self: &Soul): &String {
    &self.image_url
}

public fun metadata_ref(self: &Soul): &Option<String> {
    &self.metadata_ref
}

public fun allowlist_address(self: &Soul): &Option<address> {
    &self.allowlist_address
}

public fun allowlist_version(self: &Soul): u64 {
    self.allowlist_version
}

public fun content_blob_object_id(self: &Soul): ID {
    blob::object_id(&self.content_blob)
}

public(package) fun clear_allowlist_address(self: &mut Soul) {
    self.allowlist_address = option::none();
    self.allowlist_version = self.allowlist_version + 1;
}

public(package) fun clear_allowlist_address_if_present(self: &mut Soul): bool {
    if (self.allowlist_address.is_some()) {
        self.allowlist_address = option::none();
        self.allowlist_version = self.allowlist_version + 1;
        true
    } else {
        false
    }
}

public(package) fun set_allowlist_address(self: &mut Soul, allowlist_address: address): u64 {
    self.allowlist_address = option::some(allowlist_address);
    self.allowlist_version = self.allowlist_version + 1;
    self.allowlist_version
}

fun mint_with_creator(
    creator: address,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    creator_royalty_bps: u16,
    ctx: &mut TxContext,
): Soul {
    assert!(creator_royalty_bps <= MAX_CREATOR_ROYALTY_BPS, ECreatorRoyaltyTooHigh);
    let blob_object_id = blob::object_id(&content_blob);
    let soul = Soul {
        id: object::new(ctx),
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        allowlist_address: option::none(),
        allowlist_version: 0,
        creator,
        creator_royalty_bps,
    };

    event::emit(SoulMinted {
        soul_id: object::id(&soul),
        creator,
        blob_object_id,
    });

    soul
}

fun create_display(publisher: &Publisher, ctx: &mut TxContext): Display<Soul> {
    let mut soul_display = display::new<Soul>(publisher, ctx);
    soul_display.add(b"name".to_string(), b"{name}".to_string());
    soul_display.add(b"description".to_string(), b"{description}".to_string());
    soul_display.add(b"image_url".to_string(), b"{image_url}".to_string());
    soul_display.add(b"creator".to_string(), b"{creator}".to_string());
    soul_display.update_version();
    soul_display
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    let publisher = package::claim(SOUL {}, ctx);
    let soul_display = create_display(&publisher, ctx);
    transfer::public_transfer(soul_display, recipient);
    publisher.burn();
}

#[test_only]
public fun mint_for_testing(
    creator: address,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    ctx: &mut TxContext,
): Soul {
    mint_for_testing_with_creator_royalty(
        creator,
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        0,
        ctx,
    )
}

#[test_only]
public fun mint_for_testing_with_creator_royalty(
    creator: address,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    creator_royalty_bps: u16,
    ctx: &mut TxContext,
): Soul {
    mint_with_creator(
        creator,
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        creator_royalty_bps,
        ctx,
    )
}

#[test_only]
public fun destroy_for_testing(self: Soul): Blob {
    let Soul {
        id,
        name: _,
        description: _,
        image_url: _,
        metadata_ref: _,
        content_blob,
        allowlist_address: _,
        allowlist_version: _,
        creator: _,
        creator_royalty_bps: _,
    } = self;
    id.delete();
    content_blob
}
