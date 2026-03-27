module soul_market_adapter::market;

use std::string::{Self as string, String};
use cpu::core::CpuMarketplace;
use cpu::marketplace_fixed_trade;
use soul_object::market_bootstrap;
use soul_object::royalty_rule;
use soul_object::soul::{Self as soul, Soul, SoulPackageAuthority};
use sui::coin::{Self as coin, Coin};
use sui::event;
use sui::kiosk::{Kiosk, KioskOwnerCap};
use sui::sui::SUI;
use sui::transfer_policy::{Self as transfer_policy, TransferPolicy, TransferPolicyCap};
use unft_standard::unft_standard::{NftBurnCap, NftCollection, NftCollectionMetadataCap, NftMintCap, NftRegistry};
use walrus::blob::Blob;

const EInvalidPrice: u64 = 0;

const COLLECTION_NAME: vector<u8> = b"Soul Collection";
const COLLECTION_DESCRIPTION: vector<u8> = b"Single-object Soul assets traded through CPU marketplace";
const COLLECTION_IMAGE_URL: vector<u8> = b"https://claw.news/souls/collection.png";

public struct SoulListed has copy, drop {
    soul_id: ID,
    kiosk_id: ID,
    seller: address,
    price: u64,
}

public struct SoulPurchased has copy, drop {
    soul_id: ID,
    seller_kiosk_id: ID,
    buyer: address,
    price: u64,
    platform_fee: u64,
    royalty_fee: u64,
}

public fun bootstrap(
    authority: &SoulPackageAuthority,
    registry: &mut NftRegistry,
    royalty_bps: u16,
    ctx: &mut TxContext,
): (
    NftMintCap<Soul>,
    option::Option<NftBurnCap<Soul>>,
    NftCollectionMetadataCap<Soul>,
    TransferPolicyCap<Soul>,
) {
    let (mint_cap, burn_cap_opt, metadata_cap) = create_collection(authority, registry, ctx);
    let policy_cap = create_transfer_policy(authority, royalty_bps, ctx);
    (mint_cap, burn_cap_opt, metadata_cap, policy_cap)
}

public fun create_collection(
    authority: &SoulPackageAuthority,
    registry: &mut NftRegistry,
    ctx: &mut TxContext,
): (
    NftMintCap<Soul>,
    option::Option<NftBurnCap<Soul>>,
    NftCollectionMetadataCap<Soul>,
) {
    market_bootstrap::create_collection(
        authority,
        registry,
        string::utf8(COLLECTION_NAME),
        string::utf8(COLLECTION_DESCRIPTION),
        string::utf8(COLLECTION_IMAGE_URL),
        ctx,
    )
}

#[allow(lint(share_owned))]
public fun create_transfer_policy(
    authority: &SoulPackageAuthority,
    royalty_bps: u16,
    ctx: &mut TxContext,
): TransferPolicyCap<Soul> {
    market_bootstrap::create_transfer_policy(authority, royalty_bps, ctx)
}

public fun mint_and_list(
    collection: &NftCollection<Soul>,
    kiosk: &mut Kiosk,
    kiosk_owner_cap: &KioskOwnerCap,
    marketplace: &CpuMarketplace,
    name: String,
    description: String,
    image_url: String,
    metadata_ref: option::Option<String>,
    content_blob: Blob,
    price: u64,
    ctx: &mut TxContext,
): ID {
    assert!(price > 0, EInvalidPrice);

    let soul = soul::mint(
        name,
        description,
        image_url,
        metadata_ref,
        content_blob,
        ctx,
    );
    let soul_id = object::id(&soul);
    let seller = kiosk.owner();
    let kiosk_id = object::id(kiosk);

    marketplace_fixed_trade::list_to_existing_kiosk<Soul>(
        kiosk,
        kiosk_owner_cap,
        collection,
        soul,
        price,
        marketplace,
        ctx,
    );

    event::emit(SoulListed {
        soul_id,
        kiosk_id,
        seller,
        price,
    });

    soul_id
}

public fun quote_purchase(
    seller_kiosk: &mut Kiosk,
    marketplace: &mut CpuMarketplace,
    policy: &TransferPolicy<Soul>,
    soul_id: ID,
): (u64, u64, u64, u64) {
    let (marketplace_fee, listing_price, total_without_royalty) =
        marketplace_fixed_trade::calculate_fee<Soul>(seller_kiosk, marketplace, soul_id);
    let royalty_fee =
        if (royalty_rule::is_enabled(policy)) {
            ((listing_price as u128) * (royalty_rule::bps(policy) as u128) / 10_000) as u64
        } else {
            0
        };

    (
        marketplace_fee,
        listing_price,
        royalty_fee,
        total_without_royalty + royalty_fee,
    )
}

public fun purchase(
    collection: &NftCollection<Soul>,
    marketplace: &mut CpuMarketplace,
    policy: &mut TransferPolicy<Soul>,
    seller_kiosk: &mut Kiosk,
    soul_id: ID,
    mut payment: Coin<SUI>,
    mut fee_coin: Coin<SUI>,
    ctx: &mut TxContext,
): (Soul, Coin<SUI>) {
    let (marketplace_fee, listing_price, royalty_fee, _) =
        quote_purchase(seller_kiosk, marketplace, policy, soul_id);
    let seller_kiosk_id = object::id(seller_kiosk);
    let buyer = ctx.sender();

    let mut royalty_payment =
        if (royalty_fee > 0) {
            coin::split(&mut fee_coin, royalty_fee, ctx)
        } else {
            coin::zero(ctx)
        };
    coin::join(&mut payment, fee_coin);

    let (mut soul, mut request, mut change) = marketplace_fixed_trade::purchase<Soul>(
        collection,
        seller_kiosk,
        soul_id,
        payment,
        marketplace,
        ctx,
    );

    royalty_rule::pay(policy, &mut request, &mut royalty_payment, soul::creator(&soul), ctx);
    transfer_policy::confirm_request(policy, request);
    coin::join(&mut change, royalty_payment);
    soul::clear_agent_grant_if_present(&mut soul);

    event::emit(SoulPurchased {
        soul_id,
        seller_kiosk_id,
        buyer,
        price: listing_price,
        platform_fee: marketplace_fee,
        royalty_fee,
    });

    (soul, change)
}
