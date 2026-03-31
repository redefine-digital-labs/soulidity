module soul_object::market;

use kiosk::kiosk_lock_rule;
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use kiosk::personal_kiosk_rule;
use kiosk::witness_rule;
use std::string::String;
use sui::coin::{Self as coin, Coin};
use sui::dynamic_field as df;
use sui::event;
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::package::{Self, Publisher};
use sui::sui::SUI;
use sui::transfer_policy::{Self as transfer_policy, TransferPolicy};
use soul_object::allowlist::{Self as allowlist, AllowlistRegistry};
use soul_object::soul::{Self as soul, Soul};
use usdc::usdc::USDC;

const EInvalidRecipient: u64 = 1;
const EInvalidPrice: u64 = 2;
const EPlatformFeeTooHigh: u64 = 3;
const ECreatorRoyaltyTooHigh: u64 = 13;
const EInactiveListing: u64 = 4;
const EListingKioskMismatch: u64 = 5;
const EListingSoulMismatch: u64 = 6;
const EIncorrectPaymentAmount: u64 = 7;
const EMissingPurchaseCap: u64 = 8;
const EUnauthorizedKioskAccess: u64 = 9;
const EQuoteOverflow: u64 = 10;
const ECombinedFeesTooHigh: u64 = 11;
const EMarketPaused: u64 = 12;
const EPersonalKioskAlreadyInitialized: u64 = 16;
const EPersonalKioskNotInitialized: u64 = 17;
const EPersonalKioskMismatch: u64 = 18;

const MAX_BPS: u16 = 10_000;
const MAX_U64_AS_U128: u128 = 18446744073709551615;

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

public struct FixedPriceListing has key, store {
    id: UID,
    soul_id: ID,
    seller: address,
    seller_kiosk_id: ID,
    price: u64,
    creator: address,
    creator_royalty_bps: u16,
    purchase_cap: Option<kiosk::PurchaseCap<Soul>>,
    // Shared listings cannot be deleted on Sui, so cancellation tombstones them in place.
    is_active: bool,
}

public struct PersonalKioskOwnerKey has copy, drop, store {
    owner: address,
}

public struct PersonalKioskRegistration has copy, drop, store {
    kiosk_id: ID,
    kiosk_cap_id: ID,
}

public struct MarketOnlyProof has drop {}

public struct MarketInitialized has copy, drop {
    config_id: ID,
    policy_id: ID,
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

public struct SoulListed has copy, drop {
    listing_id: ID,
    soul_id: ID,
    kiosk_id: ID,
    kiosk_cap_id: ID,
    seller: address,
    price: u64,
}

public struct SoulListingCancelled has copy, drop {
    listing_id: ID,
    soul_id: ID,
    kiosk_id: ID,
    seller: address,
}

public struct SoulPurchased has copy, drop {
    listing_id: ID,
    soul_id: ID,
    seller_kiosk_id: ID,
    buyer_kiosk_id: ID,
    buyer_kiosk_cap_id: ID,
    buyer: address,
    price: u64,
    platform_fee: u64,
    creator_royalty: u64,
}

public struct SoulMintedToKiosk has copy, drop {
    soul_id: ID,
    kiosk_id: ID,
    kiosk_cap_id: ID,
    owner: address,
}

public struct PersonalKioskInitialized has copy, drop {
    kiosk_id: ID,
    kiosk_cap_id: ID,
    owner: address,
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

public fun listing_soul_id(self: &FixedPriceListing): ID {
    self.soul_id
}

public fun listing_seller_kiosk_id(self: &FixedPriceListing): ID {
    self.seller_kiosk_id
}

public fun listing_price(self: &FixedPriceListing): u64 {
    self.price
}

public fun listing_creator_royalty_bps(self: &FixedPriceListing): u16 {
    self.creator_royalty_bps
}

public fun listing_is_active(self: &FixedPriceListing): bool {
    self.is_active
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

public fun quote_purchase(
    config: &MarketConfig,
    price: u64,
    creator_royalty_bps: u16,
): (u64, u64, u64, u64) {
    assert!(creator_royalty_bps <= MAX_BPS, ECreatorRoyaltyTooHigh);
    assert!(
        ((config.platform_fee_bps as u64) + (creator_royalty_bps as u64)) <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );
    let platform_fee = bps_amount(price, config.platform_fee_bps);
    let creator_royalty = bps_amount(price, creator_royalty_bps);
    let total = (price as u128) + (platform_fee as u128) + (creator_royalty as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);
    (platform_fee, price, creator_royalty, total as u64)
}

public fun quote_fixed_price(
    config: &MarketConfig,
    listing: &FixedPriceListing,
): (u64, u64, u64, u64) {
    assert!(listing.is_active, EInactiveListing);
    quote_purchase(config, listing.price, listing.creator_royalty_bps)
}

public fun init_personal_kiosk(config: &mut MarketConfig, ctx: &mut TxContext): ID {
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

/// Register an existing PersonalKioskCap in a fresh MarketConfig (e.g. after redeployment).
public fun register_existing_personal_kiosk(
    config: &mut MarketConfig,
    personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    let kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(personal_kiosk_cap));
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    register_personal_kiosk(config, ctx.sender(), kiosk_id, kiosk_cap_id);
}

/// Idempotent version: register if not yet registered, no-op otherwise.
public fun ensure_personal_kiosk_registered(
    config: &mut MarketConfig,
    personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
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

#[allow(lint(share_owned))]
public fun mint_and_list_fixed_price(
    config: &mut MarketConfig,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: walrus::blob::Blob,
    price: u64,
    creator_royalty_bps: u16,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(price > 0, EInvalidPrice);

    let (mut kiosk_obj, kiosk_owner_cap) = kiosk::new(ctx);
    let kiosk_id = object::id(&kiosk_obj);
    let personal_kiosk_cap = personal_kiosk::new(&mut kiosk_obj, kiosk_owner_cap, ctx);
    let kiosk_cap_id = object::id(&personal_kiosk_cap);
    let seller = kiosk_obj.owner();

    register_personal_kiosk(config, seller, kiosk_id, kiosk_cap_id);

    let soul_obj = soul::mint_with_creator_royalty(
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        creator_royalty_bps,
        ctx,
    );
    let soul_id = object::id(&soul_obj);

    kiosk::place(&mut kiosk_obj, personal_kiosk::borrow(&personal_kiosk_cap), soul_obj);
    let listing = create_listing(config, &mut kiosk_obj, &personal_kiosk_cap, soul_id, price, ctx);
    let listing_id = object::id(&listing);

    transfer::share_object(listing);
    transfer::public_share_object(kiosk_obj);
    personal_kiosk::transfer_to_sender(personal_kiosk_cap, ctx);

    event::emit(SoulListed {
        listing_id,
        soul_id,
        kiosk_id,
        kiosk_cap_id,
        seller,
        price,
    });

    soul_id
}

#[allow(lint(share_owned))]
public fun mint_and_list_fixed_price_in_personal_kiosk(
    config: &MarketConfig,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: walrus::blob::Blob,
    price: u64,
    creator_royalty_bps: u16,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(price > 0, EInvalidPrice);
    assert!(
        kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)),
        EUnauthorizedKioskAccess,
    );

    let seller = kiosk_obj.owner();
    let kiosk_id = object::id(kiosk_obj);
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    assert_registered_personal_kiosk(config, seller, kiosk_id, kiosk_cap_id);

    let soul_obj = soul::mint_with_creator_royalty(
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        creator_royalty_bps,
        ctx,
    );
    let soul_id = object::id(&soul_obj);

    kiosk::place(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_obj);
    let listing = create_listing(config, kiosk_obj, personal_kiosk_cap, soul_id, price, ctx);
    let listing_id = object::id(&listing);

    transfer::share_object(listing);
    event::emit(SoulListed {
        listing_id,
        soul_id,
        kiosk_id,
        kiosk_cap_id,
        seller,
        price,
    });

    soul_id
}

#[allow(lint(share_owned))]
public fun mint_to_kiosk(
    config: &mut MarketConfig,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: walrus::blob::Blob,
    creator_royalty_bps: u16,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);

    let (mut kiosk_obj, kiosk_owner_cap) = kiosk::new(ctx);
    let kiosk_id = object::id(&kiosk_obj);
    let personal_kiosk_cap = personal_kiosk::new(&mut kiosk_obj, kiosk_owner_cap, ctx);
    let kiosk_cap_id = object::id(&personal_kiosk_cap);
    let owner = kiosk_obj.owner();

    register_personal_kiosk(config, owner, kiosk_id, kiosk_cap_id);

    let soul_obj = soul::mint_with_creator_royalty(
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        creator_royalty_bps,
        ctx,
    );
    let soul_id = object::id(&soul_obj);

    kiosk::place(&mut kiosk_obj, personal_kiosk::borrow(&personal_kiosk_cap), soul_obj);

    transfer::public_share_object(kiosk_obj);
    personal_kiosk::transfer_to_sender(personal_kiosk_cap, ctx);

    event::emit(SoulMintedToKiosk {
        soul_id,
        kiosk_id,
        kiosk_cap_id,
        owner,
    });

    soul_id
}

public fun mint_in_personal_kiosk(
    config: &MarketConfig,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: Option<String>,
    content_blob: walrus::blob::Blob,
    creator_royalty_bps: u16,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(
        kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)),
        EUnauthorizedKioskAccess,
    );

    let owner = kiosk_obj.owner();
    let kiosk_id = object::id(kiosk_obj);
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    assert_registered_personal_kiosk(config, owner, kiosk_id, kiosk_cap_id);

    let soul_obj = soul::mint_with_creator_royalty(
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        creator_royalty_bps,
        ctx,
    );
    let soul_id = object::id(&soul_obj);

    kiosk::place(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_obj);

    event::emit(SoulMintedToKiosk {
        soul_id,
        kiosk_id,
        kiosk_cap_id,
        owner,
    });

    soul_id
}

#[allow(lint(share_owned))]
public fun list_fixed_price(
    config: &MarketConfig,
    allowlist_registry: &mut AllowlistRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    soul_id: ID,
    price: u64,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    assert!(price > 0, EInvalidPrice);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);

    let seller = kiosk_obj.owner();
    let kiosk_id = object::id(kiosk_obj);
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    assert_registered_personal_kiosk(config, seller, kiosk_id, kiosk_cap_id);
    allowlist::clear_allowlist_address_if_present_via_personal_kiosk(
        allowlist_registry,
        kiosk_obj,
        personal_kiosk_cap,
        soul_id,
    );

    let listing = create_listing(config, kiosk_obj, personal_kiosk_cap, soul_id, price, ctx);
    let listing_id = object::id(&listing);

    transfer::share_object(listing);
    event::emit(SoulListed {
        listing_id,
        soul_id,
        kiosk_id,
        kiosk_cap_id,
        seller,
        price,
    });

    listing_id
}

// Cancellation intentionally remains available during market pause so sellers can recover listed
// Souls even while new listings and purchases are frozen.
public fun cancel_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut FixedPriceListing,
) {
    assert!(listing.is_active, EInactiveListing);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(object::id(kiosk_obj) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(kiosk_obj.owner() == listing.seller, EUnauthorizedKioskAccess);

    let purchase_cap = take_purchase_cap(listing);
    kiosk::return_purchase_cap<Soul>(kiosk_obj, purchase_cap);
    // Shared listings cannot be deleted on Sui after cancellation, so keep an inactive tombstone.
    listing.is_active = false;

    event::emit(SoulListingCancelled {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        kiosk_id: listing.seller_kiosk_id,
        seller: listing.seller,
    });
}

public fun buy_fixed_price(
    config: &MarketConfig,
    policy: &TransferPolicy<Soul>,
    allowlist_registry: &mut AllowlistRegistry,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut FixedPriceListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    assert!(listing.is_active, EInactiveListing);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(seller_kiosk.owner() == listing.seller, EListingKioskMismatch);
    assert!(kiosk::has_access(buyer_kiosk, personal_kiosk::borrow(buyer_personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(personal_kiosk::owner(buyer_kiosk) == ctx.sender(), EUnauthorizedKioskAccess);
    let buyer_kiosk_id = object::id(buyer_kiosk);
    let buyer_kiosk_cap_id = object::id(buyer_personal_kiosk_cap);
    let buyer = ctx.sender();
    assert_registered_personal_kiosk(config, buyer, buyer_kiosk_id, buyer_kiosk_cap_id);

    let (platform_fee, price, creator_royalty, total) =
        quote_purchase(config, listing.price, listing.creator_royalty_bps);
    assert!(payment.value() == total, EIncorrectPaymentAmount);

    let purchase_cap = take_purchase_cap(listing);
    // The kiosk receipt still requires an SUI coin even though this market settles the real
    // consideration in USDC below. Kiosk profit observers will therefore see a 0-SUI purchase
    // until the underlying kiosk package supports non-SUI settlement accounting.
    let (mut soul_obj, mut request) = kiosk::purchase_with_cap<Soul>(
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
    transfer::public_transfer(seller_payment, listing.seller);

    allowlist::clear_allowlist_address_if_present(allowlist_registry, &mut soul_obj);

    kiosk::lock<Soul>(
        buyer_kiosk,
        personal_kiosk::borrow(buyer_personal_kiosk_cap),
        policy,
        soul_obj,
    );
    kiosk_lock_rule::prove(&mut request, buyer_kiosk);
    personal_kiosk_rule::prove(buyer_kiosk, &mut request);
    witness_rule::prove(MarketOnlyProof {}, policy, &mut request);
    transfer_policy::confirm_request(policy, request);

    listing.is_active = false;

    event::emit(SoulPurchased {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        seller_kiosk_id: listing.seller_kiosk_id,
        buyer_kiosk_id,
        buyer_kiosk_cap_id,
        buyer,
        price,
        platform_fee,
        creator_royalty,
    });
}

#[test_only]
public(package) fun list_fixed_price_for_testing(
    config: &MarketConfig,
    allowlist_registry: &mut AllowlistRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    soul_id: ID,
    price: u64,
    ctx: &mut TxContext,
): FixedPriceListing {
    assert!(!config.paused, EMarketPaused);
    assert!(price > 0, EInvalidPrice);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert_registered_personal_kiosk(
        config,
        kiosk_obj.owner(),
        object::id(kiosk_obj),
        object::id(personal_kiosk_cap),
    );
    allowlist::clear_allowlist_address_if_present_via_personal_kiosk(
        allowlist_registry,
        kiosk_obj,
        personal_kiosk_cap,
        soul_id,
    );
    create_listing(config, kiosk_obj, personal_kiosk_cap, soul_id, price, ctx)
}

#[test_only]
public fun destroy_listing_for_testing(listing: FixedPriceListing) {
    let FixedPriceListing {
        id,
        soul_id: _,
        seller: _,
        seller_kiosk_id: _,
        price: _,
        creator: _,
        creator_royalty_bps: _,
        purchase_cap,
        is_active: _,
    } = listing;
    purchase_cap.destroy_none();
    id.delete();
}

#[test_only]
public(package) fun register_personal_kiosk_for_testing(
    config: &mut MarketConfig,
    owner: address,
    kiosk_id: ID,
    kiosk_cap_id: ID,
) {
    register_personal_kiosk(config, owner, kiosk_id, kiosk_cap_id);
}

fun create_listing(
    config: &MarketConfig,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    soul_id: ID,
    price: u64,
    ctx: &mut TxContext,
): FixedPriceListing {
    let seller = kiosk_obj.owner();
    let seller_kiosk_id = object::id(kiosk_obj);
    let (creator, creator_royalty_bps) = {
        let soul_ref = kiosk::borrow<Soul>(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_id);
        (soul::creator(soul_ref), soul::creator_royalty_bps(soul_ref))
    };
    let (_, _, _, _) = quote_purchase(config, price, creator_royalty_bps);
    let purchase_cap = kiosk::list_with_purchase_cap<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
        // Pricing settles in USDC, so the kiosk's SUI-denominated min_price cannot represent
        // the real floor. Keep the PurchaseCap private to this listing and enforce price in
        // buy_fixed_price via the exact USDC payment amount instead.
        0,
        ctx,
    );

    FixedPriceListing {
        id: object::new(ctx),
        soul_id,
        seller,
        seller_kiosk_id,
        price,
        creator,
        creator_royalty_bps,
        purchase_cap: option::some(purchase_cap),
        is_active: true,
    }
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

fun take_purchase_cap(listing: &mut FixedPriceListing): kiosk::PurchaseCap<Soul> {
    assert!(listing.purchase_cap.is_some(), EMissingPurchaseCap);
    option::extract(&mut listing.purchase_cap)
}

fun bps_amount(price: u64, bps: u16): u64 {
    (((price as u128) * (bps as u128)) / 10_000) as u64
}

#[allow(lint(share_owned))]
fun init_impl(publisher: Publisher, admin: address, ctx: &mut TxContext) {
    let (mut policy, policy_cap) = transfer_policy::new<Soul>(&publisher, ctx);
    let config = MarketConfig {
        id: object::new(ctx),
        fee_recipient: admin,
        platform_fee_bps: 0,
        paused: false,
    };
    let config_id = object::id(&config);
    let policy_id = object::id(&policy);
    let admin_cap = MarketAdminCap { id: object::new(ctx) };

    kiosk_lock_rule::add<Soul>(&mut policy, &policy_cap);
    personal_kiosk_rule::add<Soul>(&mut policy, &policy_cap);
    witness_rule::add<Soul, MarketOnlyProof>(&mut policy, &policy_cap);

    transfer::share_object(config);
    transfer::public_share_object(policy);
    transfer::transfer(admin_cap, admin);
    transfer::public_transfer(policy_cap, admin);
    publisher.burn();

    event::emit(MarketInitialized {
        config_id,
        policy_id,
        admin,
    });
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    init_impl(package::claim(MARKET {}, ctx), recipient, ctx);
}
