module soulidity::collection;

use std::string::String;
use sui::display::{Self as display, Display};
use sui::event;
use sui::package::{Self as package, Publisher};
use soulidity::soul::{Self as soul, SoulState};

const MAX_BPS: u16 = 10_000;

const EExtraRoyaltyTooHigh: u64 = 0;
const ENotCollectionCreator: u64 = 1;
const ECollectionLocked: u64 = 2;
const ECreatorMismatch: u64 = 3;
const ECollectionSupplyExceeded: u64 = 4;
const ESupplyCapInvalid: u64 = 5;

public struct COLLECTION has drop {}

public struct SoulCollection has key {
    id: UID,
    creator: address,
    extra_royalty_bps: u16,
    tradeable: bool,
    current_holder: address,
    current_holder_kiosk_id: ID,
    right_id: ID,
    max_supply: Option<u64>,
    current_supply: u64,
}

public struct SoulCollectionRight has key, store {
    id: UID,
    collection_id: ID,
    creator: address,
    name: String,
    description: String,
    image_url: String,
    extra_royalty_bps: u16,
    tradeable: bool,
}

public struct SoulCollectionCreated has copy, drop {
    collection_id: ID,
    right_id: ID,
    creator: address,
    current_holder: address,
    tradeable: bool,
    max_supply: Option<u64>,
}

public struct SoulAddedToCollection has copy, drop {
    collection_id: ID,
    soul_id: ID,
    current_supply: u64,
    max_supply: Option<u64>,
}

public struct CollectionHolderUpdated has copy, drop {
    collection_id: ID,
    previous_holder: address,
    current_holder: address,
}

fun init(otw: COLLECTION, ctx: &mut TxContext) {
    let publisher = package::claim(otw, ctx);
    let collection_display = create_display(&publisher, ctx);

    transfer::public_transfer(collection_display, ctx.sender());
    publisher.burn();
}

public fun creator(self: &SoulCollection): address {
    self.creator
}

public fun extra_royalty_bps(self: &SoulCollection): u16 {
    self.extra_royalty_bps
}

public fun current_holder(self: &SoulCollection): address {
    self.current_holder
}

public fun current_holder_kiosk_id(self: &SoulCollection): ID {
    self.current_holder_kiosk_id
}

public fun tradeable(self: &SoulCollection): bool {
    self.tradeable
}

public fun right_id(self: &SoulCollection): ID {
    self.right_id
}

public fun max_supply(self: &SoulCollection): Option<u64> {
    self.max_supply
}

public fun current_supply(self: &SoulCollection): u64 {
    self.current_supply
}

public fun collection_id(self: &SoulCollectionRight): ID {
    self.collection_id
}

public fun right_tradeable(self: &SoulCollectionRight): bool {
    self.tradeable
}

public(package) fun create(
    name: String,
    description: String,
    image_url: String,
    extra_royalty_bps: u16,
    tradeable: bool,
    max_supply: Option<u64>,
    holder: address,
    holder_kiosk_id: ID,
    ctx: &mut TxContext,
): (SoulCollection, SoulCollectionRight) {
    assert!(extra_royalty_bps <= MAX_BPS, EExtraRoyaltyTooHigh);
    assert!(max_supply.is_none() || *max_supply.borrow() >= 1, ESupplyCapInvalid);

    let creator = ctx.sender();
    let collection_uid = object::new(ctx);
    let collection_id = collection_uid.to_inner();
    let right = SoulCollectionRight {
        id: object::new(ctx),
        collection_id,
        creator,
        name,
        description,
        image_url,
        extra_royalty_bps,
        tradeable,
    };
    let right_id = object::id(&right);
    let collection = SoulCollection {
        id: collection_uid,
        creator,
        extra_royalty_bps,
        tradeable,
        current_holder: holder,
        current_holder_kiosk_id: holder_kiosk_id,
        right_id,
        max_supply,
        current_supply: 0,
    };

    event::emit(SoulCollectionCreated {
        collection_id,
        right_id,
        creator,
        current_holder: holder,
        tradeable,
        max_supply,
    });

    (collection, right)
}

public fun add_soul(
    collection: &mut SoulCollection,
    state: &mut SoulState,
    ctx: &TxContext,
) {
    assert!(collection.creator == ctx.sender(), ENotCollectionCreator);
    assert!(soul::state_creator(state) == collection.creator, ECreatorMismatch);
    soul::assert_owner(state, ctx.sender());

    if (collection.max_supply.is_some()) {
        let cap = *collection.max_supply.borrow();
        assert!(collection.current_supply < cap, ECollectionSupplyExceeded);
    };
    collection.current_supply = collection.current_supply + 1;

    soul::bind_collection(state, object::id(collection));
    event::emit(SoulAddedToCollection {
        collection_id: object::id(collection),
        soul_id: soul::soul_id(state),
        current_supply: collection.current_supply,
        max_supply: collection.max_supply,
    });
}

public(package) fun update_holder(
    collection: &mut SoulCollection,
    new_holder: address,
    new_kiosk_id: ID,
) {
    let previous_holder = collection.current_holder;
    collection.current_holder = new_holder;
    collection.current_holder_kiosk_id = new_kiosk_id;
    event::emit(CollectionHolderUpdated {
        collection_id: object::id(collection),
        previous_holder,
        current_holder: new_holder,
    });
}

public(package) fun assert_tradeable(collection: &SoulCollection) {
    assert!(collection.tradeable, ECollectionLocked);
}

public(package) fun share_collection(collection: SoulCollection) {
    transfer::share_object(collection);
}

fun create_display(publisher: &Publisher, ctx: &mut TxContext): Display<SoulCollectionRight> {
    let mut collection_display = display::new<SoulCollectionRight>(publisher, ctx);
    collection_display.add(b"name".to_string(), b"{name}".to_string());
    collection_display.add(b"description".to_string(), b"{description}".to_string());
    collection_display.add(b"image_url".to_string(), b"{image_url}".to_string());
    collection_display.add(b"creator".to_string(), b"{creator}".to_string());
    collection_display.update_version();
    collection_display
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    let publisher = package::claim(COLLECTION {}, ctx);
    let collection_display = create_display(&publisher, ctx);
    transfer::public_transfer(collection_display, recipient);
    publisher.burn();
}

#[test_only]
public fun destroy_collection_for_testing(self: SoulCollection) {
    let SoulCollection {
        id,
        creator: _,
        extra_royalty_bps: _,
        tradeable: _,
        current_holder: _,
        current_holder_kiosk_id: _,
        right_id: _,
        max_supply: _,
        current_supply: _,
    } = self;
    id.delete();
}

#[test_only]
public fun destroy_right_for_testing(self: SoulCollectionRight) {
    let SoulCollectionRight {
        id,
        collection_id: _,
        creator: _,
        name: _,
        description: _,
        image_url: _,
        extra_royalty_bps: _,
        tradeable: _,
    } = self;
    id.delete();
}
