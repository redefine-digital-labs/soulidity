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

public struct SoulPackageAuthority has key {
    id: UID,
    publisher: Publisher,
}

public struct Soul has key, store {
    id: UID,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    agent_grant: Option<address>,
    grant_version: u64,
    creator: address,
}

fun init(otw: SOUL, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let recipient = ctx.sender();
    let soul_display = create_display(&publisher, ctx);
    let authority = SoulPackageAuthority {
        id: object::new(ctx),
        publisher,
    };

    transfer::public_transfer(soul_display, recipient);
    transfer::transfer(authority, recipient);
}

public fun mint(
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    ctx: &mut TxContext,
): Soul {
    mint_with_creator(
        ctx.sender(),
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        ctx,
    )
}

public fun publisher(self: &SoulPackageAuthority): &Publisher {
    &self.publisher
}

public entry fun burn_authority(authority: SoulPackageAuthority) {
    let SoulPackageAuthority { id, publisher } = authority;
    id.delete();
    publisher.burn();
}

public fun creator(self: &Soul): address {
    self.creator
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

public fun agent_grant(self: &Soul): &Option<address> {
    &self.agent_grant
}

public fun grant_version(self: &Soul): u64 {
    self.grant_version
}

public fun content_blob_object_id(self: &Soul): ID {
    blob::object_id(&self.content_blob)
}

public(package) fun clear_agent_grant(self: &mut Soul) {
    self.agent_grant = option::none();
    self.grant_version = self.grant_version + 1;
}

public fun clear_agent_grant_if_present(self: &mut Soul): bool {
    if (self.agent_grant.is_some()) {
        self.agent_grant = option::none();
        self.grant_version = self.grant_version + 1;
        true
    } else {
        false
    }
}

public(package) fun set_agent_grant(self: &mut Soul, agent: Option<address>): u64 {
    self.agent_grant = agent;
    self.grant_version = self.grant_version + 1;
    self.grant_version
}

fun mint_with_creator(
    creator: address,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    ctx: &mut TxContext,
): Soul {
    let blob_object_id = blob::object_id(&content_blob);
    let soul = Soul {
        id: object::new(ctx),
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        agent_grant: option::none(),
        grant_version: 0,
        creator,
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
    let authority = SoulPackageAuthority {
        id: object::new(ctx),
        publisher,
    };
    transfer::public_transfer(soul_display, recipient);
    transfer::transfer(authority, recipient);
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
    mint_with_creator(
        creator,
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
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
        agent_grant: _,
        grant_version: _,
        creator: _,
    } = self;
    id.delete();
    content_blob
}

#[test_only]
public fun destroy_package_authority_for_testing(self: SoulPackageAuthority) {
    let SoulPackageAuthority { id, publisher } = self;
    id.delete();
    publisher.burn();
}
