module soulidity::market;

use kiosk::kiosk_lock_rule;
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use kiosk::personal_kiosk_rule;
use kiosk::witness_rule;
use soulidity::collection::{Self as collection, SoulCollection, SoulCollectionRight};
use soulidity::grant;
use soulidity::memory;
use soulidity::skills;
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::dynamic_field as df;
use sui::event;
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::package::{Self as package, Publisher};
use sui::sui::SUI;
use sui::transfer_policy::{Self as transfer_policy, TransferPolicy};
use usdc::usdc::USDC;
use walrus::blob::Blob;

const MAX_BPS: u16 = 10_000;
const MAX_U64_AS_U128: u128 = 18446744073709551615;

const EInvalidRecipient: u64 = 0;
const EInvalidPrice: u64 = 1;
const EPlatformFeeTooHigh: u64 = 2;
const EInactiveListing: u64 = 3;
const EListingKioskMismatch: u64 = 4;
const EListingSoulMismatch: u64 = 5;
const EIncorrectPaymentAmount: u64 = 6;
const EMissingPurchaseCap: u64 = 7;
const EUnauthorizedKioskAccess: u64 = 8;
const EQuoteOverflow: u64 = 9;
const ECombinedFeesTooHigh: u64 = 10;
const EMarketPaused: u64 = 11;
const EPersonalKioskAlreadyInitialized: u64 = 12;
const EPersonalKioskNotInitialized: u64 = 13;
const EPersonalKioskMismatch: u64 = 14;
const ECollectionMismatch: u64 = 15;
const ECollectionRightMismatch: u64 = 16;
const EStateMismatch: u64 = 18;

public struct MARKET has drop {}

public struct MarketAdminCap has key, store {
    id: UID,
}

public struct MarketConfig has key {
    id: UID,
    fee_recipient: address,
    platform_fee_bps: u16,
    paused: bool,
}

public struct SoulListing has key, store {
    id: UID,
    soul_id: ID,
    state_id: ID,
    seller: address,
    seller_kiosk_id: ID,
    price: u64,
    creator: address,
    creator_royalty_bps: u16,
    collection_id: Option<ID>,
    purchase_cap: Option<kiosk::PurchaseCap<Soul>>,
    is_active: bool,
}

public struct CollectionListing has key, store {
    id: UID,
    collection_id: ID,
    right_id: ID,
    seller: address,
    seller_kiosk_id: ID,
    price: u64,
    purchase_cap: Option<kiosk::PurchaseCap<SoulCollectionRight>>,
    is_active: bool,
}

public struct PersonalKioskOwnerKey has copy, drop, store {
    owner: address,
}

public struct PersonalKioskRegistration has copy, drop, store {
    kiosk_id: ID,
    kiosk_cap_id: ID,
}

public struct SoulMarketProof has drop {}

public struct CollectionMarketProof has drop {}

public struct MarketInitialized has copy, drop {
    config_id: ID,
    soul_policy_id: ID,
    collection_policy_id: ID,
    admin: address,
}

public struct FeeRecipientUpdated has copy, drop {
    fee_recipient: address,
}

public struct PlatformFeeBpsUpdated has copy, drop {
    fee_bps: u16,
}

public struct MarketPauseUpdated has copy, drop {
    paused: bool,
}

public struct PersonalKioskInitialized has copy, drop {
    kiosk_id: ID,
    kiosk_cap_id: ID,
    owner: address,
}

public struct SoulMintedToKiosk has copy, drop {
    soul_id: ID,
    state_id: ID,
    memory_id: ID,
    kiosk_id: ID,
    owner: address,
    provenance_kind: u8,
}

public struct SoulListed has copy, drop {
    listing_id: ID,
    soul_id: ID,
    seller: address,
    kiosk_id: ID,
    price: u64,
}

public struct SoulListingCancelled has copy, drop {
    listing_id: ID,
    soul_id: ID,
    seller: address,
}

public struct SoulPurchased has copy, drop {
    listing_id: ID,
    soul_id: ID,
    seller: address,
    buyer: address,
    price: u64,
    platform_fee: u64,
    creator_royalty: u64,
    collection_royalty: u64,
}

public struct CollectionMintedToKiosk has copy, drop {
    collection_id: ID,
    right_id: ID,
    owner: address,
    kiosk_id: ID,
    tradeable: bool,
}

public struct CollectionListed has copy, drop {
    listing_id: ID,
    collection_id: ID,
    right_id: ID,
    seller: address,
    kiosk_id: ID,
    price: u64,
}

public struct CollectionListingCancelled has copy, drop {
    listing_id: ID,
    collection_id: ID,
    seller: address,
}

public struct CollectionPurchased has copy, drop {
    listing_id: ID,
    collection_id: ID,
    right_id: ID,
    seller: address,
    buyer: address,
    price: u64,
    platform_fee: u64,
}

fun init(otw: MARKET, ctx: &mut TxContext) {
    init_impl(package::claim(otw, ctx), ctx.sender(), ctx)
}

public fun fee_recipient(self: &MarketConfig): address {
    self.fee_recipient
}

public fun platform_fee_bps(self: &MarketConfig): u16 {
    self.platform_fee_bps
}

public fun paused(self: &MarketConfig): bool {
    self.paused
}

public fun quote_soul_purchase(
    config: &MarketConfig,
    price: u64,
    creator_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    assert!(
        ((config.platform_fee_bps as u64) + (creator_royalty_bps as u64) + (collection_royalty_bps as u64))
            <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );

    let platform_fee = bps_amount(price, config.platform_fee_bps);
    let creator_royalty = bps_amount(price, creator_royalty_bps);
    let collection_royalty = bps_amount(price, collection_royalty_bps);
    let total = (price as u128)
        + (platform_fee as u128)
        + (creator_royalty as u128)
        + (collection_royalty as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);

    (platform_fee, price, creator_royalty, collection_royalty, total as u64)
}

public fun quote_collection_purchase(
    config: &MarketConfig,
    price: u64,
): (u64, u64, u64) {
    let platform_fee = bps_amount(price, config.platform_fee_bps);
    let total = (price as u128) + (platform_fee as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);
    (platform_fee, price, total as u64)
}

public fun update_fee_recipient(
    config: &mut MarketConfig,
    _: &MarketAdminCap,
    fee_recipient: address,
) {
    assert!(fee_recipient != @0x0, EInvalidRecipient);
    config.fee_recipient = fee_recipient;
    event::emit(FeeRecipientUpdated { fee_recipient });
}

public fun update_platform_fee_bps(
    config: &mut MarketConfig,
    _: &MarketAdminCap,
    fee_bps: u16,
) {
    assert!(fee_bps <= MAX_BPS, EPlatformFeeTooHigh);
    config.platform_fee_bps = fee_bps;
    event::emit(PlatformFeeBpsUpdated { fee_bps });
}

public fun update_paused(
    config: &mut MarketConfig,
    _: &MarketAdminCap,
    paused: bool,
) {
    config.paused = paused;
    event::emit(MarketPauseUpdated { paused });
}

public fun init_personal_kiosk(config: &mut MarketConfig, ctx: &mut TxContext): ID {
    assert!(!config.paused, EMarketPaused);
    let (mut kiosk_obj, kiosk_owner_cap) = kiosk::new(ctx);
    let kiosk_id = object::id(&kiosk_obj);
    let personal_kiosk_cap = personal_kiosk::new(&mut kiosk_obj, kiosk_owner_cap, ctx);
    let kiosk_cap_id = object::id(&personal_kiosk_cap);
    let owner = ctx.sender();

    register_personal_kiosk(config, owner, kiosk_id, kiosk_cap_id);
    transfer::public_share_object(kiosk_obj);
    personal_kiosk::transfer_to_sender(personal_kiosk_cap, ctx);
    event::emit(PersonalKioskInitialized {
        kiosk_id,
        kiosk_cap_id,
        owner,
    });

    kiosk_id
}

public fun register_existing_personal_kiosk(
    config: &mut MarketConfig,
    personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    let kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(personal_kiosk_cap));
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    register_personal_kiosk(config, ctx.sender(), kiosk_id, kiosk_cap_id);
}

public fun ensure_personal_kiosk_registered(
    config: &mut MarketConfig,
    personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    let owner = ctx.sender();
    let key = PersonalKioskOwnerKey { owner };
    if (df::exists_(&config.id, key)) {
        return
    };

    let kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(personal_kiosk_cap));
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    register_personal_kiosk(config, owner, kiosk_id, kiosk_cap_id);
}

public fun reuse_personal_kiosk(
    config: &MarketConfig,
    personal_kiosk_cap: PersonalKioskCap,
    ctx: &mut TxContext,
): ID {
    let kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(&personal_kiosk_cap));
    assert_registered_personal_kiosk(
        config,
        ctx.sender(),
        kiosk_id,
        object::id(&personal_kiosk_cap),
    );
    personal_kiosk::transfer_to_sender(personal_kiosk_cap, ctx);
    kiosk_id
}

public fun mint_native_in_personal_kiosk(
    config: &MarketConfig,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    metadata_ref: Option<std::string::String>,
    protected_blob: Blob,
    founding_memory_blob: Option<Blob>,
    skills_blob: Option<Blob>,
    skills_public: bool,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    mint_soul_in_personal_kiosk_impl(
        config,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        metadata_ref,
        protected_blob,
        founding_memory_blob,
        skills_blob,
        skills_public,
        creator_royalty_bps,
        soul::provenance_native(),
        option::none(),
        clock,
        ctx,
    )
}

public fun mint_imported_in_personal_kiosk(
    config: &MarketConfig,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    metadata_ref: Option<std::string::String>,
    protected_blob: Blob,
    founding_memory_blob: Option<Blob>,
    skills_blob: Option<Blob>,
    skills_public: bool,
    origin_ref: std::string::String,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    mint_soul_in_personal_kiosk_impl(
        config,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        metadata_ref,
        protected_blob,
        founding_memory_blob,
        skills_blob,
        skills_public,
        creator_royalty_bps,
        soul::provenance_imported(),
        option::some(origin_ref),
        clock,
        ctx,
    )
}

public fun mint_joined_in_personal_kiosk<T: key + store>(
    config: &MarketConfig,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    source_object_id: ID,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    metadata_ref: Option<std::string::String>,
    protected_blob: Blob,
    founding_memory_blob: Option<Blob>,
    skills_blob: Option<Blob>,
    skills_public: bool,
    origin_ref: std::string::String,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    assert!(kiosk::has_item_with_type<T>(kiosk_obj, source_object_id), ECollectionMismatch);
    mint_soul_in_personal_kiosk_impl(
        config,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        metadata_ref,
        protected_blob,
        founding_memory_blob,
        skills_blob,
        skills_public,
        creator_royalty_bps,
        soul::provenance_personal_join(),
        option::some(origin_ref),
        clock,
        ctx,
    )
}

public fun create_collection_in_personal_kiosk(
    config: &MarketConfig,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    extra_royalty_bps: u16,
    tradeable: bool,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);

    let owner = kiosk_obj.owner();
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(config, owner, kiosk_id, object::id(personal_kiosk_cap));

    let (collection_obj, right_obj) = collection::create(
        name,
        description,
        image_url,
        extra_royalty_bps,
        tradeable,
        owner,
        kiosk_id,
        ctx,
    );
    let collection_id = object::id(&collection_obj);
    let right_id = object::id(&right_obj);

    kiosk::lock<SoulCollectionRight>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        collection_policy,
        right_obj,
    );
    collection::share_collection(collection_obj);
    event::emit(CollectionMintedToKiosk {
        collection_id,
        right_id,
        owner,
        kiosk_id,
        tradeable,
    });

    collection_id
}

#[allow(lint(share_owned))]
public fun list_soul_fixed_price(
    config: &MarketConfig,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &SoulState,
    soul_id: ID,
    price: u64,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(price > 0, EInvalidPrice);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::soul_id(state) == soul_id, EStateMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    assert!(soul::current_owner(state) == ctx.sender(), EUnauthorizedKioskAccess);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), EPersonalKioskMismatch);

    let seller = kiosk_obj.owner();
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(config, seller, kiosk_id, object::id(personal_kiosk_cap));

    let listing = create_soul_listing(
        config,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        soul_id,
        price,
        option::none(),
        0,
        ctx,
    );
    let listing_id = object::id(&listing);

    transfer::share_object(listing);
    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id,
        price,
    });

    listing_id
}

#[allow(lint(share_owned))]
public fun list_soul_fixed_price_with_collection(
    config: &MarketConfig,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &SoulState,
    soul_id: ID,
    price: u64,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(price > 0, EInvalidPrice);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::soul_id(state) == soul_id, EStateMismatch);
    let collection_id = object::id(collection_obj);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    assert!(soul::current_owner(state) == ctx.sender(), EUnauthorizedKioskAccess);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), EPersonalKioskMismatch);

    let seller = kiosk_obj.owner();
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(config, seller, kiosk_id, object::id(personal_kiosk_cap));

    let listing = create_soul_listing(
        config,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        soul_id,
        price,
        option::some(collection_id),
        collection::extra_royalty_bps(collection_obj),
        ctx,
    );
    let listing_id = object::id(&listing);

    transfer::share_object(listing);
    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id,
        price,
    });

    listing_id
}

public fun cancel_soul_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut SoulListing,
) {
    assert!(listing.is_active, EInactiveListing);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(object::id(kiosk_obj) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(kiosk_obj.owner() == listing.seller, EUnauthorizedKioskAccess);

    let purchase_cap = take_soul_purchase_cap(listing);
    kiosk::return_purchase_cap<Soul>(kiosk_obj, purchase_cap);
    listing.is_active = false;

    event::emit(SoulListingCancelled {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        seller: listing.seller,
    });
}

public fun buy_soul_fixed_price(
    config: &MarketConfig,
    soul_policy: &TransferPolicy<Soul>,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    let seller = listing.seller;
    assert!(listing.collection_id.is_none(), ECollectionMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    buy_soul_impl(
        config,
        soul_policy,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        listing,
        payment,
        0,
        seller,
        ctx,
    )
}

public fun buy_soul_fixed_price_with_collection(
    config: &MarketConfig,
    soul_policy: &TransferPolicy<Soul>,
    collection_obj: &mut SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    let collection_id = object::id(collection_obj);
    assert!(listing.collection_id.contains(&collection_id), ECollectionMismatch);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    buy_soul_impl(
        config,
        soul_policy,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        listing,
        payment,
        collection::extra_royalty_bps(collection_obj),
        collection::current_holder(collection_obj),
        ctx,
    )
}

#[allow(lint(share_owned))]
public fun list_collection_right_fixed_price(
    config: &MarketConfig,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    right_id: ID,
    price: u64,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(price > 0, EInvalidPrice);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    collection::assert_tradeable(collection_obj);
    assert!(collection::current_holder(collection_obj) == ctx.sender(), EUnauthorizedKioskAccess);
    assert!(collection::current_holder_kiosk_id(collection_obj) == object::id(kiosk_obj), ECollectionMismatch);
    assert!(right_id == collection::right_id(collection_obj), ECollectionRightMismatch);

    let seller = kiosk_obj.owner();
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(config, seller, kiosk_id, object::id(personal_kiosk_cap));

    let listing = create_collection_listing(kiosk_obj, personal_kiosk_cap, collection_obj, right_id, price, ctx);
    let listing_id = object::id(&listing);

    transfer::share_object(listing);
    event::emit(CollectionListed {
        listing_id,
        collection_id: object::id(collection_obj),
        right_id,
        seller,
        kiosk_id,
        price,
    });

    listing_id
}

public fun cancel_collection_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut CollectionListing,
) {
    assert!(listing.is_active, EInactiveListing);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(object::id(kiosk_obj) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(kiosk_obj.owner() == listing.seller, EUnauthorizedKioskAccess);

    let purchase_cap = take_collection_purchase_cap(listing);
    kiosk::return_purchase_cap<SoulCollectionRight>(kiosk_obj, purchase_cap);
    listing.is_active = false;

    event::emit(CollectionListingCancelled {
        listing_id: object::id(listing),
        collection_id: listing.collection_id,
        seller: listing.seller,
    });
}

public fun buy_collection_right_fixed_price(
    config: &MarketConfig,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    collection_obj: &mut SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut CollectionListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    assert!(listing.is_active, EInactiveListing);
    assert!(listing.collection_id == object::id(collection_obj), ECollectionMismatch);
    assert!(listing.right_id == collection::right_id(collection_obj), ECollectionRightMismatch);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(seller_kiosk.owner() == listing.seller, EListingKioskMismatch);
    assert!(kiosk::has_access(buyer_kiosk, personal_kiosk::borrow(buyer_personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(personal_kiosk::owner(buyer_kiosk) == ctx.sender(), EUnauthorizedKioskAccess);
    collection::assert_tradeable(collection_obj);

    let buyer_kiosk_id = object::id(buyer_kiosk);
    assert_registered_personal_kiosk(
        config,
        ctx.sender(),
        buyer_kiosk_id,
        object::id(buyer_personal_kiosk_cap),
    );

    let (platform_fee, price, total) = quote_collection_purchase(config, listing.price);
    assert!(payment.value() == total, EIncorrectPaymentAmount);

    let purchase_cap = take_collection_purchase_cap(listing);
    let (right_obj, mut request) = kiosk::purchase_with_cap<SoulCollectionRight>(
        seller_kiosk,
        purchase_cap,
        coin::zero<SUI>(ctx),
    );
    assert!(object::id(&right_obj) == listing.right_id, ECollectionRightMismatch);

    let mut seller_payment = payment;
    if (platform_fee > 0) {
        let fee_payment = coin::split(&mut seller_payment, platform_fee, ctx);
        transfer::public_transfer(fee_payment, config.fee_recipient);
    };
    transfer::public_transfer(seller_payment, listing.seller);

    collection::update_holder(collection_obj, ctx.sender(), buyer_kiosk_id);
    kiosk::lock<SoulCollectionRight>(
        buyer_kiosk,
        personal_kiosk::borrow(buyer_personal_kiosk_cap),
        collection_policy,
        right_obj,
    );
    kiosk_lock_rule::prove(&mut request, buyer_kiosk);
    personal_kiosk_rule::prove(buyer_kiosk, &mut request);
    witness_rule::prove(CollectionMarketProof {}, collection_policy, &mut request);
    transfer_policy::confirm_request(collection_policy, request);

    listing.is_active = false;
    event::emit(CollectionPurchased {
        listing_id: object::id(listing),
        collection_id: listing.collection_id,
        right_id: listing.right_id,
        seller: listing.seller,
        buyer: ctx.sender(),
        price,
        platform_fee,
    });
}

fun mint_soul_in_personal_kiosk_impl(
    config: &MarketConfig,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    metadata_ref: Option<std::string::String>,
    protected_blob: Blob,
    founding_memory_blob: Option<Blob>,
    skills_blob: Option<Blob>,
    skills_public: bool,
    creator_royalty_bps: u16,
    provenance_kind: u8,
    origin_ref: Option<std::string::String>,
    clock: &Clock,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);

    let owner = kiosk_obj.owner();
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(config, owner, kiosk_id, object::id(personal_kiosk_cap));

    let soul_obj = soul::mint(
        name,
        description,
        image_url,
        metadata_ref,
        protected_blob,
        owner,
        creator_royalty_bps,
        provenance_kind,
        origin_ref,
        ctx,
    );
    let soul_id = object::id(&soul_obj);
    let mut state = soul::create_state(
        soul_id,
        owner,
        creator_royalty_bps,
        owner,
        kiosk_id,
        ctx,
    );
    let mut memory_obj = memory::create(soul_id, ctx);
    let state_id = object::id(&state);
    let memory_id = object::id(&memory_obj);
    let mut founding_memory_blob = founding_memory_blob;
    if (founding_memory_blob.is_some()) {
        let blob = option::extract(&mut founding_memory_blob);
        let _ = memory::append_founding(&mut memory_obj, owner, blob, clock, ctx);
    };
    founding_memory_blob.destroy_none();

    let mut skills_blob = skills_blob;
    if (skills_blob.is_some()) {
        let skill_blob = option::extract(&mut skills_blob);
        let mut skills_book = skills::create(soul_id, ctx);
        let _ = skills::append_initial_version(&mut skills_book, skills_public, skill_blob, clock, ctx);
        soul::set_skills_id(&mut state, object::id(&skills_book));
        skills::share_skills(skills_book);
    };
    skills_blob.destroy_none();

    kiosk::lock<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_policy,
        soul_obj,
    );
    soul::emit_created(&state, provenance_kind);
    soul::share_state(state);
    memory::share_memory(memory_obj);
    event::emit(SoulMintedToKiosk {
        soul_id,
        state_id,
        memory_id,
        kiosk_id,
        owner,
        provenance_kind,
    });

    soul_id
}

fun create_soul_listing(
    config: &MarketConfig,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &SoulState,
    soul_id: ID,
    price: u64,
    collection_id: Option<ID>,
    collection_royalty_bps: u16,
    ctx: &mut TxContext,
): SoulListing {
    let _soul_ref = kiosk::borrow<Soul>(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_id);
    let (_, _, _, _, _) = quote_soul_purchase(
        config,
        price,
        soul::creator_royalty_bps(state),
        collection_royalty_bps,
    );
    let purchase_cap = kiosk::list_with_purchase_cap<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
        0,
        ctx,
    );

    SoulListing {
        id: object::new(ctx),
        soul_id,
        state_id: object::id(state),
        seller: kiosk_obj.owner(),
        seller_kiosk_id: object::id(kiosk_obj),
        price,
        creator: soul::state_creator(state),
        creator_royalty_bps: soul::creator_royalty_bps(state),
        collection_id,
        purchase_cap: option::some(purchase_cap),
        is_active: true,
    }
}

fun create_collection_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    collection_obj: &SoulCollection,
    right_id: ID,
    price: u64,
    ctx: &mut TxContext,
): CollectionListing {
    let _right_ref = kiosk::borrow<SoulCollectionRight>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        right_id,
    );
    let purchase_cap = kiosk::list_with_purchase_cap<SoulCollectionRight>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        right_id,
        0,
        ctx,
    );

    CollectionListing {
        id: object::new(ctx),
        collection_id: object::id(collection_obj),
        right_id,
        seller: kiosk_obj.owner(),
        seller_kiosk_id: object::id(kiosk_obj),
        price,
        purchase_cap: option::some(purchase_cap),
        is_active: true,
    }
}

fun buy_soul_impl(
    config: &MarketConfig,
    soul_policy: &TransferPolicy<Soul>,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    collection_royalty_bps: u16,
    collection_holder: address,
    ctx: &mut TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    assert!(listing.is_active, EInactiveListing);
    assert!(listing.state_id == object::id(state), EStateMismatch);
    assert!(listing.soul_id == soul::soul_id(state), EStateMismatch);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(seller_kiosk.owner() == listing.seller, EListingKioskMismatch);
    assert!(kiosk::has_access(buyer_kiosk, personal_kiosk::borrow(buyer_personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(personal_kiosk::owner(buyer_kiosk) == ctx.sender(), EUnauthorizedKioskAccess);

    let buyer_kiosk_id = object::id(buyer_kiosk);
    assert_registered_personal_kiosk(
        config,
        ctx.sender(),
        buyer_kiosk_id,
        object::id(buyer_personal_kiosk_cap),
    );

    let (platform_fee, price, creator_royalty, collection_royalty, total) = quote_soul_purchase(
        config,
        listing.price,
        listing.creator_royalty_bps,
        collection_royalty_bps,
    );
    assert!(payment.value() == total, EIncorrectPaymentAmount);

    let purchase_cap = take_soul_purchase_cap(listing);
    let (soul_obj, mut request) = kiosk::purchase_with_cap<Soul>(
        seller_kiosk,
        purchase_cap,
        coin::zero<SUI>(ctx),
    );
    assert!(object::id(&soul_obj) == listing.soul_id, EListingSoulMismatch);

    let mut seller_payment = payment;
    if (platform_fee > 0) {
        let fee_payment = coin::split(&mut seller_payment, platform_fee, ctx);
        transfer::public_transfer(fee_payment, config.fee_recipient);
    };
    if (creator_royalty > 0 && listing.creator != listing.seller) {
        let royalty_payment = coin::split(&mut seller_payment, creator_royalty, ctx);
        transfer::public_transfer(royalty_payment, listing.creator);
    };
    if (collection_royalty > 0 && collection_holder != listing.seller) {
        let collection_payment = coin::split(&mut seller_payment, collection_royalty, ctx);
        transfer::public_transfer(collection_payment, collection_holder);
    };
    transfer::public_transfer(seller_payment, listing.seller);

    grant::invalidate_all_for_owner_rotation(state, ctx.sender(), ctx.sender());
    soul::rotate_owner(state, ctx.sender(), buyer_kiosk_id);
    kiosk::lock<Soul>(
        buyer_kiosk,
        personal_kiosk::borrow(buyer_personal_kiosk_cap),
        soul_policy,
        soul_obj,
    );
    kiosk_lock_rule::prove(&mut request, buyer_kiosk);
    personal_kiosk_rule::prove(buyer_kiosk, &mut request);
    witness_rule::prove(SoulMarketProof {}, soul_policy, &mut request);
    transfer_policy::confirm_request(soul_policy, request);

    listing.is_active = false;
    event::emit(SoulPurchased {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        seller: listing.seller,
        buyer: ctx.sender(),
        price,
        platform_fee,
        creator_royalty,
        collection_royalty,
    });
}

fun take_soul_purchase_cap(listing: &mut SoulListing): kiosk::PurchaseCap<Soul> {
    assert!(listing.purchase_cap.is_some(), EMissingPurchaseCap);
    option::extract(&mut listing.purchase_cap)
}

fun take_collection_purchase_cap(
    listing: &mut CollectionListing,
): kiosk::PurchaseCap<SoulCollectionRight> {
    assert!(listing.purchase_cap.is_some(), EMissingPurchaseCap);
    option::extract(&mut listing.purchase_cap)
}

fun bps_amount(price: u64, bps: u16): u64 {
    (((price as u128) * (bps as u128)) / 10_000) as u64
}

fun register_personal_kiosk(
    config: &mut MarketConfig,
    owner: address,
    kiosk_id: ID,
    kiosk_cap_id: ID,
) {
    let key = PersonalKioskOwnerKey { owner };
    assert!(!df::exists_(&config.id, key), EPersonalKioskAlreadyInitialized);
    df::add(
        &mut config.id,
        key,
        PersonalKioskRegistration {
            kiosk_id,
            kiosk_cap_id,
        },
    );
}

fun borrow_personal_kiosk_registration(
    config: &MarketConfig,
    owner: address,
): &PersonalKioskRegistration {
    let key = PersonalKioskOwnerKey { owner };
    assert!(df::exists_(&config.id, key), EPersonalKioskNotInitialized);
    df::borrow<PersonalKioskOwnerKey, PersonalKioskRegistration>(&config.id, key)
}

fun assert_registered_personal_kiosk(
    config: &MarketConfig,
    owner: address,
    kiosk_id: ID,
    kiosk_cap_id: ID,
) {
    let registration = borrow_personal_kiosk_registration(config, owner);
    assert!(registration.kiosk_id == kiosk_id, EPersonalKioskMismatch);
    assert!(registration.kiosk_cap_id == kiosk_cap_id, EPersonalKioskMismatch);
}

#[allow(lint(share_owned))]
fun init_impl(publisher: Publisher, admin: address, ctx: &mut TxContext) {
    let (mut soul_policy, soul_policy_cap) = transfer_policy::new<Soul>(&publisher, ctx);
    let (mut collection_policy, collection_policy_cap) =
        transfer_policy::new<SoulCollectionRight>(&publisher, ctx);
    let config = MarketConfig {
        id: object::new(ctx),
        fee_recipient: admin,
        platform_fee_bps: 0,
        paused: false,
    };
    let config_id = object::id(&config);
    let soul_policy_id = object::id(&soul_policy);
    let collection_policy_id = object::id(&collection_policy);
    let admin_cap = MarketAdminCap { id: object::new(ctx) };

    kiosk_lock_rule::add<Soul>(&mut soul_policy, &soul_policy_cap);
    personal_kiosk_rule::add<Soul>(&mut soul_policy, &soul_policy_cap);
    witness_rule::add<Soul, SoulMarketProof>(&mut soul_policy, &soul_policy_cap);

    kiosk_lock_rule::add<SoulCollectionRight>(&mut collection_policy, &collection_policy_cap);
    personal_kiosk_rule::add<SoulCollectionRight>(&mut collection_policy, &collection_policy_cap);
    witness_rule::add<SoulCollectionRight, CollectionMarketProof>(&mut collection_policy, &collection_policy_cap);

    transfer::share_object(config);
    transfer::public_share_object(soul_policy);
    transfer::public_share_object(collection_policy);
    transfer::transfer(admin_cap, admin);
    transfer::public_transfer(soul_policy_cap, admin);
    transfer::public_transfer(collection_policy_cap, admin);
    publisher.burn();

    event::emit(MarketInitialized {
        config_id,
        soul_policy_id,
        collection_policy_id,
        admin,
    });
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    init_impl(package::claim(MARKET {}, ctx), recipient, ctx);
}
