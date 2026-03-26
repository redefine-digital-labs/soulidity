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
    creator: address,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: Blob,
    agent_grant: Option<address>,
}

fun init(otw: SOUL, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let recipient = ctx.sender();
    let soul_display = create_display(&publisher, ctx);

    transfer::public_transfer(soul_display, recipient);
    transfer::public_transfer(publisher, recipient);
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

public fun content_blob_object_id(self: &Soul): ID {
    blob::object_id(&self.content_blob)
}

public(package) fun clear_agent_grant(self: &mut Soul) {
    self.agent_grant = option::none();
}

public(package) fun set_agent_grant(self: &mut Soul, agent: Option<address>) {
    self.agent_grant = agent;
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
        creator,
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        agent_grant: option::none(),
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
    transfer::public_transfer(publisher, recipient);
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
        creator: _,
        name: _,
        description: _,
        image_url: _,
        metadata_ref: _,
        content_blob,
        agent_grant: _,
    } = self;
    id.delete();
    content_blob
}
