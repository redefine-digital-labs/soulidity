module soulidity::market;

use animacraft::animacraft::{
    Self as animacraft,
    CanonicalSoulMintAuthorization,
    MakerTreasury,
    OCMaker,
};
use animacraft::commerce_v5::{
    Self as animacraft_commerce_v5,
    CommerceProtocolConfigV5,
    CommerceV5SoulMintAuthorization,
    MakerRootV5,
};
use animacraft::composition_v6::{
    Self as composition_v6,
    CompositionProtocolConfigV6,
    CompositionRegistryV6,
    LoadoutSelectionV6,
    MakerProfileV6,
};
use animacraft_physical_v7::physical_composition_v7::{
    Self as physical_v7,
    MakerPhysicalProfileV7,
    PhysicalProtocolConfigV7,
    SoulWardrobeV7,
};
use std::string::{Self as string, String};
use std::type_name;
use kiosk::kiosk_lock_rule;
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use kiosk::personal_kiosk_rule;
use kiosk::witness_rule;
use soulidity::collection::{Self as collection, SoulCollection, SoulCollectionRight};
use soulidity::animacraft_soul_binding_v5 as animacraft_soul_binding_v5;
use soulidity::animacraft_provenance::{Self as animacraft_provenance, AnimacraftProvenance};
use soulidity::animacraft_output_provenance_v5 as animacraft_output_provenance_v5;
use soulidity::animacraft_appearance_adapter_v6 as appearance_adapter_v6;
use soulidity::appearance_v6::{Self as appearance_v6, SoulAppearanceStateV6};
use soulidity::content::{Self as content, SoulContent};
use soulidity::grant;
use soulidity::kind_registry::{Self as kind_registry, KindRegistry};
use soulidity::paid_access::{Self as paid_access, SoulPaidAccessList};
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::dynamic_field as df;
use sui::event;
use sui::kiosk::{Self as kiosk, Kiosk};
use sui::package::{Self as package, Publisher};
use sui::sui::SUI;
use sui::transfer_policy::{Self as transfer_policy, TransferPolicy, TransferRequest};
use usdc::usdc::USDC;
use walrus::blob::Blob;

const MAX_BPS: u16 = 10_000;
const MAX_U64_AS_U128: u128 = 18446744073709551615;
const DEFAULT_PLATFORM_FEE_BPS: u16 = 250;
const ANIMACRAFT_PROTOCOL_VERSION_V4: u64 = 4;
const ANIMACRAFT_PROTOCOL_VERSION_V5: u64 = 5;
/// The v5 secondary model settles a listed price as a gross amount. The
/// protocol fee is fixed at 2.5%; the immutable Animacraft provenance supplies
/// the Maker-source royalty, while the Soul creator share is selected once at
/// canonical mint and then frozen in SoulState.
/// Both rights royalties use 0.5% steps from 0% through 5% and may total 10%.
/// The fixed 2.5% protocol fee is separate, so the gross-price ceiling is
/// 12.5% and the seller always receives at least 87.5%.
const ANIMACRAFT_V5_PROTOCOL_FEE_BPS: u16 = 250;
const ANIMACRAFT_V5_MAX_SOUL_CREATOR_BPS: u16 = 500;
const ANIMACRAFT_V5_MAX_MAKER_SOURCE_BPS: u16 = 500;
const ANIMACRAFT_V5_ROYALTY_STEP_BPS: u16 = 50;
const ANIMACRAFT_V5_MAX_RIGHTS_POOL_BPS: u16 = 1_000;
const ANIMACRAFT_V5_MAX_ADD_ON_BPS: u16 = 1_250;

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
const EAccessListStateMismatch: u64 = 19;
const ESourceAlreadyJoined: u64 = 25;
const EPaidAccessNotPurchasable: u64 = 28;
const EAccessListLinkageMismatch: u64 = 29;
const EListingStillActive: u64 = 30;
const EOldKioskNotEmpty: u64 = 31;
const EOldKioskMismatch: u64 = 32;
const ERebindSameKiosk: u64 = 33;
const EPaidAccessOwnerCannotPurchase: u64 = 35;
const EPersonalKioskCapMismatch: u64 = 37;
const ESoulCurrentKioskMismatch: u64 = 38;
const ESoulOwnerMismatch: u64 = 39;
const EKioskOwnerMismatch: u64 = 40;
const EListingSellerMismatch: u64 = 41;
const EListingStateMismatch: u64 = 42;
const EInitialEntryActiveNotSupported: u64 = 43;
const ENotSoulOwner: u64 = 44;
const EStateConfigKeyEmpty: u64 = 45;
const EInitialSoulDocCountMismatch: u64 = 46;
const EInitialSoulDocNameMismatch: u64 = 47;
const EInitialMemoryCountMismatch: u64 = 48;
const EInitialMemoryNameMismatch: u64 = 49;
const EInitialKindOpNotAllowedAtMint: u64 = 50;
const EPaidAccessKindMismatch: u64 = 51;
const EAnimacraftProtocolVersion: u64 = 52;
const EAnimacraftPayerMismatch: u64 = 53;
const EAnimacraftCoinTypeMismatch: u64 = 54;
const EAnimacraftAuthorizationMismatch: u64 = 55;
const EAnimacraftPurchasePathRequired: u64 = 56;
const EAnimacraftRoyaltyTooSmall: u64 = 57;
const EAnimacraftListingPathRequired: u64 = 58;
const ELegacyMarketMustBePaused: u64 = 59;
const EPrimaryPausedV2: u64 = 60;
const ESecondaryPausedV2: u64 = 61;
const EAnimacraftV5CommercePathRequired: u64 = 62;
const EAnimacraftV5ProtocolFeeMismatch: u64 = 63;
const EAnimacraftV5MakerRoyaltyMismatch: u64 = 64;
const EAnimacraftV5CreatorRoyaltyTooHigh: u64 = 65;
const EAnimacraftV5ListingMismatch: u64 = 66;
const EAnimacraftV5CreatorRoyaltyMismatch: u64 = 67;
const EAnimacraftV6ListingPathRequired: u64 = 68;
const EAnimacraftV6ListingSnapshotMismatch: u64 = 69;
const EAnimacraftV6ListingSnapshotInactive: u64 = 70;
const EAnimacraftV7WardrobeListingUnsupported: u64 = 71;
const EAnimacraftV7WardrobeMissing: u64 = 72;
const EAnimacraftV7ListingSnapshotMismatch: u64 = 73;
const EAnimacraftV7ListingSnapshotInactive: u64 = 74;
const VERSION: u64 = 1;
const MARKET_VERSION_V2: u64 = 2;
const MARKET_VERSION_ANIMACRAFT_V5: u64 = 5;
const MARKET_VERSION_ANIMACRAFT_V6: u64 = 6;

public struct MARKET has drop {}

public struct MarketAdminCap has key, store {
    id: UID,
}

public struct MarketConfig has key {
    id: UID,
    version: u64,
    fee_recipient: address,
    platform_fee_bps: u16,
    paused: bool,
}

/// Successor configuration used after the legacy `MarketConfig` has been
/// irreversibly retired. The primary mint and secondary resale gates are
/// intentionally independent. Migration leaves both gates fail-closed; each
/// requires a separate, explicit post-deployment governance decision.
public struct MarketConfigV2 has key {
    id: UID,
    version: u64,
    legacy_config_id: ID,
    fee_recipient: address,
    platform_fee_bps: u16,
    primary_enabled: bool,
    secondary_enabled: bool,
}

public struct MarketAdminCapV2 has key, store {
    id: UID,
    config_id: ID,
}

/// Secondary-market policy introduced by v6. This is deliberately a new
/// TypeOrigin: immutable v2 bytecode can only accept `MarketConfigV2`, whose
/// secondary gate remains permanently closed after retirement.
public struct MarketConfigV6 has key {
    id: UID,
    version: u64,
    config_v2_id: ID,
    legacy_config_id: ID,
    fee_recipient: address,
    platform_fee_bps: u16,
    secondary_enabled: bool,
}

/// The only post-retirement admin capability. The v2 capability is wrapped
/// inside this object and is never exposed, so old package bytecode cannot
/// borrow it to enable `MarketConfigV2.secondary_enabled`.
public struct MarketAdminCapV6 has key, store {
    id: UID,
    config_v2_id: ID,
    config_v6_id: ID,
    v2_admin_cap: MarketAdminCapV2,
}

public struct KioskRegistry has key {
    id: UID,
    version: u64,
}

/// Marker objects for listings: `key`-only by design. Without `store`,
/// listings cannot be `public_transfer`'d or wrapped — the only sanctioned
/// path is `finalize_*` which shares them. PTBs may still hold and pass
/// them between commands within a single transaction.
public struct SoulListing has key {
    id: UID,
    version: u64,
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

/// Dedicated listing for a Soul whose active appearance uses Animacraft v6.
/// It intentionally cannot be passed to any immutable v1/v2/v5 buy or cancel
/// entrypoint, while carrying the purchase capability and exact appearance
/// snapshot in one atomic object.
public struct AnimacraftV6SoulListing has key {
    id: UID,
    version: u64,
    soul_id: ID,
    state_id: ID,
    seller: address,
    seller_kiosk_id: ID,
    price: u64,
    creator: address,
    creator_royalty_bps: u16,
    purchase_cap: Option<kiosk::PurchaseCap<Soul>>,
    appearance_state_id: ID,
    appearance_revision: u64,
    ownership_epoch: u64,
    loadout_hash: vector<u8>,
    transfer_safe: bool,
    is_active: bool,
}

/// Dedicated listing for a physical-v7 Soul. The immutable snapshot binds the
/// exact wardrobe, Profile, post-lock revision, and Soul ownership epoch. Old
/// listing entrypoints cannot accept this TypeOrigin and continue to reject a
/// v7-bound Soul.
public struct AnimacraftV7SoulListing has key {
    id: UID,
    soul_id: ID,
    seller: address,
    seller_kiosk_id: ID,
    price: u64,
    purchase_cap: Option<kiosk::PurchaseCap<Soul>>,
    wardrobe_id: ID,
    wardrobe_revision: u64,
    ownership_epoch: u64,
    is_active: bool,
}

public struct CollectionListing has key {
    id: UID,
    version: u64,
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

public struct JoinedSourceKey has copy, drop, store {
    source_object_id: ID,
}

public struct PersonalKioskRegistration has copy, drop, store {
    version: u64,
    kiosk_id: ID,
    kiosk_cap_id: ID,
}

public struct SoulMarketProof has drop {}

/// The PhysicalProtocolConfigV7 listing proof is bound once to this exact
/// TypeOrigin. Fields and constructors remain private to `market`, so callers
/// cannot independently unlock a listed wardrobe or bypass Soul settlement.
public struct PhysicalWardrobeListingProofV7 has drop {}

public struct CollectionMarketProof has drop {}

/// Caller-supplied initial content entry consumed by mint flows. Carries
/// the Walrus `Blob`, so the struct must be `store`-only and unpacked
/// during the mint PTB. `set_active=true` is only valid for kinds with
/// `has_active_binding=true`; the mint helper aborts with
/// `EInitialEntryActiveNotSupported` otherwise so the failure is local to
/// the market wrapper rather than surfacing from `content::set_active`.
///
/// Phase 2: `is_public` was replaced by `slot_read_mode_mask`. `is_public`
/// becomes a derived event field in `content.move` (set when the slot's
/// read-mode mask includes `READ_PUBLIC`). Mint flows must include exactly
/// one `(KIND_SOUL_DOC, "soul")` entry and at least one
/// `(KIND_MEMORY, "default")` entry; see `assert_initial_content_well_formed`.
public struct InitialContentEntry has store {
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    set_active: bool,
    blob: Blob,
}

/// Caller-supplied initial state-config entry consumed by mint flows.
/// Mirrors the legacy `metadata::ext` blobs; typical keys: `sprite_config_json`,
/// `sprite_mood_map_json`.
public struct StateConfigEntry has copy, drop, store {
    key: String,
    value: vector<u8>,
}

public struct MarketInitialized has copy, drop {
    config_id: ID,
    registry_id: ID,
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

public struct LegacyMarketRetired has copy, drop {
    legacy_config_id: ID,
    config_v2_id: ID,
    admin_cap_v2_id: ID,
    retired_by: address,
}

/// Additive v6 event. `LegacyMarketRetired` is a deployed TypeOrigin and must
/// retain its exact v5 layout for upgrade compatibility.
public struct MarketV6Initialized has copy, drop {
    config_v2_id: ID,
    admin_cap_v2_id: ID,
    config_v6_id: ID,
    admin_cap_v6_id: ID,
    initialized_by: address,
}

public struct MarketPrimaryGateV2Updated has copy, drop {
    enabled: bool,
}

public struct MarketSecondaryGateV2Updated has copy, drop {
    enabled: bool,
}

public struct MarketSecondaryGateV6Updated has copy, drop {
    enabled: bool,
}

public struct MarketFeePolicyV6Updated has copy, drop {
    fee_recipient: address,
    platform_fee_bps: u16,
}

public struct PersonalKioskInitialized has copy, drop {
    kiosk_id: ID,
    kiosk_cap_id: ID,
    owner: address,
}

public struct PersonalKioskRegistrationUpdated has copy, drop {
    kiosk_id: ID,
    kiosk_cap_id: ID,
    owner: address,
}

public struct PersonalKioskRebound has copy, drop {
    owner: address,
    old_kiosk_id: ID,
    old_kiosk_cap_id: ID,
    new_kiosk_id: ID,
    new_kiosk_cap_id: ID,
}

public struct SoulMintedToKiosk has copy, drop {
    soul_id: ID,
    state_id: ID,
    content_id: ID,
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

public struct AnimacraftSoulPurchased has copy, drop {
    listing_id: ID,
    soul_id: ID,
    provenance_id: ID,
    maker_id: ID,
    maker_treasury_id: ID,
    seller: address,
    buyer: address,
    price: u64,
    platform_fee: u64,
    maker_royalty_bps: u16,
    maker_royalty: u64,
    collection_royalty: u64,
}

/// Settlement record for the isolated v5 path. Unlike v4, `price` is the
/// buyer's complete gross payment and `seller_payout` is its residual after
/// the approved protocol, Soul creator, and Maker-source shares.
public struct AnimacraftV5SoulPurchased has copy, drop {
    listing_id: ID,
    soul_id: ID,
    provenance_id: ID,
    seller: address,
    buyer: address,
    maker_source_recipient: address,
    price: u64,
    seller_payout: u64,
    protocol_fee: u64,
    soul_creator_royalty_bps: u16,
    soul_creator_royalty: u64,
    maker_source_royalty_bps: u16,
    maker_source_royalty: u64,
}

public struct AnimacraftV6SoulListed has copy, drop {
    listing_id: ID,
    soul_id: ID,
    appearance_state_id: ID,
    appearance_revision: u64,
    ownership_epoch: u64,
    loadout_hash: vector<u8>,
}

public struct AnimacraftV6SoulListingCancelled has copy, drop {
    listing_id: ID,
    soul_id: ID,
    appearance_revision: u64,
}

public struct AnimacraftV6SoulPurchased has copy, drop {
    listing_id: ID,
    soul_id: ID,
    appearance_state_id: ID,
    appearance_revision: u64,
    previous_ownership_epoch: u64,
    ownership_epoch: u64,
    buyer: address,
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

public struct SoulPaidAccessPurchased has copy, drop {
    soul_id: ID,
    paid_access_list_id: ID,
    buyer: address,
    price: u64,
    platform_fee: u64,
    payment_recipient: address,
}

public struct SoulListingDeleted has copy, drop {
    listing_id: ID,
    soul_id: ID,
    seller: address,
    deleted_by: address,
}

public struct CollectionListingDeleted has copy, drop {
    listing_id: ID,
    collection_id: ID,
    seller: address,
    deleted_by: address,
}

fun init(otw: MARKET, ctx: &mut TxContext) {
    init_impl(package::claim(otw, ctx), ctx.sender(), true, ctx)
}

public fun protocol_version(): u64 {
    VERSION
}

public fun config_version(self: &MarketConfig): u64 {
    self.version
}

public fun kiosk_registry_version(self: &KioskRegistry): u64 {
    self.version
}

public fun soul_listing_version(self: &SoulListing): u64 {
    self.version
}

public fun animacraft_v6_listing_version(
    self: &AnimacraftV6SoulListing,
): u64 { self.version }

public fun animacraft_v6_listing_appearance_id(
    self: &AnimacraftV6SoulListing,
): ID { self.appearance_state_id }

public fun animacraft_v6_listing_revision(
    self: &AnimacraftV6SoulListing,
): u64 { self.appearance_revision }

public fun animacraft_v6_listing_ownership_epoch(
    self: &AnimacraftV6SoulListing,
): u64 { self.ownership_epoch }

public fun animacraft_v6_listing_loadout_hash(
    self: &AnimacraftV6SoulListing,
): &vector<u8> { &self.loadout_hash }

public fun animacraft_v6_listing_is_active(
    self: &AnimacraftV6SoulListing,
): bool { self.is_active }

public fun collection_listing_version(self: &CollectionListing): u64 {
    self.version
}

public fun personal_kiosk_registration_version(self: &PersonalKioskRegistration): u64 {
    self.version
}

public fun personal_kiosk_registration(
    registry: &KioskRegistry,
    owner: address,
): &PersonalKioskRegistration {
    borrow_personal_kiosk_registration(registry, owner)
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

public fun config_v2_version(self: &MarketConfigV2): u64 {
    self.version
}

public fun config_v2_legacy_config_id(self: &MarketConfigV2): ID {
    self.legacy_config_id
}

public fun config_v2_fee_recipient(self: &MarketConfigV2): address {
    self.fee_recipient
}

public fun config_v2_platform_fee_bps(self: &MarketConfigV2): u16 {
    self.platform_fee_bps
}

public fun config_v2_primary_enabled(self: &MarketConfigV2): bool {
    self.primary_enabled
}

public fun config_v2_secondary_enabled(self: &MarketConfigV2): bool {
    self.secondary_enabled
}

public fun admin_cap_v2_config_id(self: &MarketAdminCapV2): ID {
    self.config_id
}

public fun config_v6_version(self: &MarketConfigV6): u64 {
    self.version
}

public fun config_v6_config_v2_id(self: &MarketConfigV6): ID {
    self.config_v2_id
}

public fun config_v6_legacy_config_id(self: &MarketConfigV6): ID {
    self.legacy_config_id
}

public fun config_v6_fee_recipient(self: &MarketConfigV6): address {
    self.fee_recipient
}

public fun config_v6_platform_fee_bps(self: &MarketConfigV6): u16 {
    self.platform_fee_bps
}

public fun config_v6_secondary_enabled(self: &MarketConfigV6): bool {
    self.secondary_enabled
}

public fun admin_cap_v6_config_v2_id(self: &MarketAdminCapV6): ID {
    self.config_v2_id
}

public fun admin_cap_v6_config_v6_id(self: &MarketAdminCapV6): ID {
    self.config_v6_id
}

// ── Initial entry constructors (callable by wallet PTBs) ──────────────

public fun new_initial_content_entry(
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    set_active: bool,
    blob: Blob,
): InitialContentEntry {
    InitialContentEntry {
        kind,
        name,
        slot_read_mode_mask,
        download_policy,
        set_active,
        blob,
    }
}

public fun new_state_config_entry(key: String, value: vector<u8>): StateConfigEntry {
    StateConfigEntry { key, value }
}

// ── Quote helpers ─────────────────────────────────────────────────────

public fun quote_soul_purchase(
    config: &MarketConfig,
    price: u64,
    creator_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    quote_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        creator_royalty_bps,
        collection_royalty_bps,
    )
}

public fun quote_soul_purchase_v2(
    config: &MarketConfigV2,
    price: u64,
    creator_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    quote_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        creator_royalty_bps,
        collection_royalty_bps,
    )
}

public fun quote_soul_purchase_v6(
    config: &MarketConfigV6,
    price: u64,
    creator_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    quote_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        creator_royalty_bps,
        collection_royalty_bps,
    )
}

fun quote_soul_purchase_with_fee_bps(
    platform_fee_bps: u16,
    price: u64,
    creator_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    assert!(
        ((platform_fee_bps as u64) + (creator_royalty_bps as u64) + (collection_royalty_bps as u64))
            <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );

    let platform_fee = bps_amount(price, platform_fee_bps);
    let creator_royalty = bps_amount(price, creator_royalty_bps);
    let collection_royalty = bps_amount(price, collection_royalty_bps);
    let total = (price as u128)
        + (platform_fee as u128)
        + (creator_royalty as u128)
        + (collection_royalty as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);

    (platform_fee, price, creator_royalty, collection_royalty, total as u64)
}

/// Animacraft resale quote. Soulidity and collection fees retain the existing
/// round-up behavior, while the immutable Maker royalty uses Animacraft's
/// floor rule so the exact quoted coin can be deposited into MakerTreasury.
public fun quote_animacraft_soul_purchase(
    config: &MarketConfig,
    price: u64,
    maker_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    quote_animacraft_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        maker_royalty_bps,
        collection_royalty_bps,
    )
}

public fun quote_animacraft_soul_purchase_v2(
    config: &MarketConfigV2,
    price: u64,
    maker_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    quote_animacraft_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        maker_royalty_bps,
        collection_royalty_bps,
    )
}

public fun quote_animacraft_soul_purchase_v6(
    config: &MarketConfigV6,
    price: u64,
    maker_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    quote_animacraft_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        maker_royalty_bps,
        collection_royalty_bps,
    )
}

/// Quote the approved Animacraft v5 secondary distribution. `price` is a
/// gross listing price, not a seller net price: all recipients are paid from
/// this one coin. The Maker-source share must come from the immutable
/// Animacraft provenance/royalty snapshot; it is never selected by the seller.
public fun quote_animacraft_v5_soul_sale(
    price: u64,
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
): (u64, u64, u64, u64) {
    assert!(price > 0, EInvalidPrice);
    assert_animacraft_v5_royalty_schedule(
        soul_creator_royalty_bps,
        maker_source_royalty_bps,
    );

    let protocol_fee = floor_bps_amount(price, ANIMACRAFT_V5_PROTOCOL_FEE_BPS);
    let soul_creator_royalty = floor_bps_amount(price, soul_creator_royalty_bps);
    let maker_source_royalty = floor_bps_amount(price, maker_source_royalty_bps);
    let seller_payout = price - protocol_fee - soul_creator_royalty - maker_source_royalty;
    (seller_payout, protocol_fee, soul_creator_royalty, maker_source_royalty)
}

/// Quote a v5 resale from the immutable SoulState creator-rate snapshot.
/// Repeated owners and listings therefore receive exactly the same creator
/// split for a given gross price and Maker-source rate.
public fun quote_animacraft_v5_soul_sale_for_state(
    state: &SoulState,
    price: u64,
    maker_source_royalty_bps: u16,
): (u64, u64, u64, u64) {
    quote_animacraft_v5_soul_sale(
        price,
        soul::creator_royalty_bps(state),
        maker_source_royalty_bps,
    )
}

fun assert_animacraft_v5_royalty_schedule(
    soul_creator_royalty_bps: u16,
    maker_source_royalty_bps: u16,
) {
    assert!(
        soul_creator_royalty_bps <= ANIMACRAFT_V5_MAX_SOUL_CREATOR_BPS
            && soul_creator_royalty_bps % ANIMACRAFT_V5_ROYALTY_STEP_BPS == 0,
        EAnimacraftV5CreatorRoyaltyTooHigh,
    );
    assert!(
        maker_source_royalty_bps <= ANIMACRAFT_V5_MAX_MAKER_SOURCE_BPS
            && maker_source_royalty_bps % ANIMACRAFT_V5_ROYALTY_STEP_BPS == 0,
        EAnimacraftV5MakerRoyaltyMismatch,
    );
    let rights_pool_bps = (maker_source_royalty_bps as u64)
        + (soul_creator_royalty_bps as u64);
    assert!(
        rights_pool_bps <= (ANIMACRAFT_V5_MAX_RIGHTS_POOL_BPS as u64),
        ECombinedFeesTooHigh,
    );
    let total_add_on_bps =
        (ANIMACRAFT_V5_PROTOCOL_FEE_BPS as u64) + rights_pool_bps;
    assert!(total_add_on_bps <= (ANIMACRAFT_V5_MAX_ADD_ON_BPS as u64), ECombinedFeesTooHigh);
}

fun settle_animacraft_v5_payment(
    payment: Coin<USDC>,
    price: u64,
    fee_recipient: address,
    soul_creator: address,
    maker_source_recipient: address,
    seller: address,
    state: &SoulState,
    maker_source_royalty_bps: u16,
    ctx: &mut TxContext,
): (u64, u64, u64, u64) {
    let (seller_payout, protocol_fee, soul_creator_royalty, maker_source_royalty) =
        quote_animacraft_v5_soul_sale_for_state(
            state,
            price,
            maker_source_royalty_bps,
        );
    assert!(payment.value() == price, EIncorrectPaymentAmount);
    let mut seller_payment = payment;
    if (protocol_fee > 0) {
        transfer::public_transfer(
            coin::split(&mut seller_payment, protocol_fee, ctx),
            fee_recipient,
        );
    };
    if (soul_creator_royalty > 0) {
        transfer::public_transfer(
            coin::split(&mut seller_payment, soul_creator_royalty, ctx),
            soul_creator,
        );
    };
    if (maker_source_royalty > 0) {
        transfer::public_transfer(
            coin::split(&mut seller_payment, maker_source_royalty, ctx),
            maker_source_recipient,
        );
    };
    transfer::public_transfer(seller_payment, seller);
    (seller_payout, protocol_fee, soul_creator_royalty, maker_source_royalty)
}

fun finish_animacraft_soul_purchase(
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    soul_obj: Soul,
    mut request: TransferRequest<Soul>,
    ctx: &TxContext,
) {
    assert!(
        kiosk::has_access(
            buyer_kiosk,
            personal_kiosk::borrow(buyer_personal_kiosk_cap),
        ),
        EUnauthorizedKioskAccess,
    );
    assert!(personal_kiosk::owner(buyer_kiosk) == ctx.sender(), EKioskOwnerMismatch);
    let buyer_kiosk_id = object::id(buyer_kiosk);
    assert_registered_personal_kiosk(
        registry,
        ctx.sender(),
        buyer_kiosk_id,
        object::id(buyer_personal_kiosk_cap),
    );
    grant::invalidate_all_for_owner_rotation(state, ctx.sender(), ctx.sender());
    soul::rotate_owner(state, ctx.sender(), buyer_kiosk_id);
    soul::set_listed(state, false);
    kiosk::lock<Soul>(
        buyer_kiosk,
        personal_kiosk::borrow(buyer_personal_kiosk_cap),
        soul_policy,
        soul_obj,
    );
    kiosk_lock_rule::prove(&mut request, buyer_kiosk);
    personal_kiosk_rule::prove(buyer_kiosk, &mut request);
    witness_rule::prove(SoulMarketProof {}, soul_policy, &mut request);
    let (_, _, _) = transfer_policy::confirm_request(soul_policy, request);
}

#[test_only]
public fun assert_animacraft_v5_creator_royalty_snapshot_for_testing(
    state: &SoulState,
    supplied_bps: u16,
) {
    assert!(
        supplied_bps == soul::creator_royalty_bps(state),
        EAnimacraftV5CreatorRoyaltyMismatch,
    );
}

fun quote_animacraft_soul_purchase_with_fee_bps(
    platform_fee_bps: u16,
    price: u64,
    maker_royalty_bps: u16,
    collection_royalty_bps: u16,
): (u64, u64, u64, u64, u64) {
    assert!(price > 0, EInvalidPrice);
    assert!(
        ((platform_fee_bps as u64) + (maker_royalty_bps as u64) + (collection_royalty_bps as u64))
            <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );

    let platform_fee = bps_amount(price, platform_fee_bps);
    let maker_royalty = floor_bps_amount(price, maker_royalty_bps);
    assert!(maker_royalty_bps == 0 || maker_royalty > 0, EAnimacraftRoyaltyTooSmall);
    let collection_royalty = bps_amount(price, collection_royalty_bps);
    let total = (price as u128)
        + (platform_fee as u128)
        + (maker_royalty as u128)
        + (collection_royalty as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);

    (platform_fee, price, maker_royalty, collection_royalty, total as u64)
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

public fun quote_collection_purchase_v2(
    config: &MarketConfigV2,
    price: u64,
): (u64, u64, u64) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let platform_fee = bps_amount(price, config.platform_fee_bps);
    let total = (price as u128) + (platform_fee as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);
    (platform_fee, price, total as u64)
}

public fun quote_collection_purchase_v6(
    config: &MarketConfigV6,
    price: u64,
): (u64, u64, u64) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let platform_fee = bps_amount(price, config.platform_fee_bps);
    let total = (price as u128) + (platform_fee as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);
    (platform_fee, price, total as u64)
}

public fun quote_paid_access_purchase(
    config: &MarketConfig,
    price: u64,
): (u64, u64, u64) {
    let platform_fee = bps_amount(price, config.platform_fee_bps);
    let total = (price as u128) + (platform_fee as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);
    (platform_fee, price, total as u64)
}

public fun quote_paid_access_purchase_v2(
    config: &MarketConfigV2,
    price: u64,
): (u64, u64, u64) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    let platform_fee = bps_amount(price, config.platform_fee_bps);
    let total = (price as u128) + (platform_fee as u128);
    assert!(total <= MAX_U64_AS_U128, EQuoteOverflow);
    (platform_fee, price, total as u64)
}

// ── Admin entries ─────────────────────────────────────────────────────

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

/// One-way security migration for the immutable v1 package entrypoints.
///
/// Old package bytecode remains callable forever on Sui. It cannot observe
/// the Animacraft provenance dynamic field added by this upgrade, so merely
/// routing the web application to new entrypoints is insufficient. This
/// function requires the legacy market to already be paused and consumes
/// (deletes) the only `MarketAdminCap`; therefore no transaction can ever
/// unpause the old `MarketConfig` again.
///
/// The successor config starts with both primary minting and secondary resale
/// disabled. Enabling either gate is a separate, explicit admin action after
/// the new package family has passed production postflight.
#[allow(lint(share_owned))]
public fun retire_legacy_market(
    config: &mut MarketConfig,
    admin_cap: MarketAdminCap,
    ctx: &mut TxContext,
) {
    assert!(config.paused, ELegacyMarketMustBePaused);
    let legacy_config_id = object::id(config);
    let MarketAdminCap { id: legacy_admin_uid } = admin_cap;
    legacy_admin_uid.delete();

    let successor = MarketConfigV2 {
        id: object::new(ctx),
        version: MARKET_VERSION_V2,
        legacy_config_id,
        fee_recipient: config.fee_recipient,
        platform_fee_bps: config.platform_fee_bps,
        primary_enabled: false,
        secondary_enabled: false,
    };
    let successor_id = object::id(&successor);
    let successor_admin_v2 = MarketAdminCapV2 {
        id: object::new(ctx),
        config_id: successor_id,
    };
    let successor_admin_v2_id = object::id(&successor_admin_v2);
    let successor_v6 = MarketConfigV6 {
        id: object::new(ctx),
        version: MARKET_VERSION_ANIMACRAFT_V6,
        config_v2_id: successor_id,
        legacy_config_id,
        fee_recipient: config.fee_recipient,
        platform_fee_bps: config.platform_fee_bps,
        secondary_enabled: false,
    };
    let successor_v6_id = object::id(&successor_v6);
    let successor_admin_v6 = MarketAdminCapV6 {
        id: object::new(ctx),
        config_v2_id: successor_id,
        config_v6_id: successor_v6_id,
        v2_admin_cap: successor_admin_v2,
    };
    let successor_admin_v6_id = object::id(&successor_admin_v6);

    transfer::share_object(successor);
    transfer::share_object(successor_v6);
    transfer::transfer(successor_admin_v6, ctx.sender());
    event::emit(LegacyMarketRetired {
        legacy_config_id,
        config_v2_id: successor_id,
        admin_cap_v2_id: successor_admin_v2_id,
        retired_by: ctx.sender(),
    });
    event::emit(MarketV6Initialized {
        config_v2_id: successor_id,
        admin_cap_v2_id: successor_admin_v2_id,
        config_v6_id: successor_v6_id,
        admin_cap_v6_id: successor_admin_v6_id,
        initialized_by: ctx.sender(),
    });
}

/// Upgrade an already-retired v2 market to the isolated v6 secondary policy.
/// The v2 secondary gate must still be closed and its capability is consumed
/// into the v6 vault, making the old enable function unreachable thereafter.
#[allow(lint(share_owned))]
public fun initialize_market_v6_from_v2(
    config: &MarketConfigV2,
    admin_cap_v2: MarketAdminCapV2,
    ctx: &mut TxContext,
) {
    assert!(!config.secondary_enabled, ESecondaryPausedV2);
    assert!(admin_cap_v2.config_id == object::id(config), EAnimacraftAuthorizationMismatch);
    let config_v2_id = object::id(config);
    let successor_v6 = MarketConfigV6 {
        id: object::new(ctx),
        version: MARKET_VERSION_ANIMACRAFT_V6,
        config_v2_id,
        legacy_config_id: config.legacy_config_id,
        fee_recipient: config.fee_recipient,
        platform_fee_bps: config.platform_fee_bps,
        secondary_enabled: false,
    };
    let config_v6_id = object::id(&successor_v6);
    let admin_cap_v6 = MarketAdminCapV6 {
        id: object::new(ctx),
        config_v2_id,
        config_v6_id,
        v2_admin_cap: admin_cap_v2,
    };
    let admin_cap_v2_id = object::id(&admin_cap_v6.v2_admin_cap);
    let admin_cap_v6_id = object::id(&admin_cap_v6);
    transfer::share_object(successor_v6);
    transfer::transfer(admin_cap_v6, ctx.sender());
    event::emit(MarketV6Initialized {
        config_v2_id,
        admin_cap_v2_id,
        config_v6_id,
        admin_cap_v6_id,
        initialized_by: ctx.sender(),
    });
}

public fun update_config_v2_primary_enabled(
    config: &mut MarketConfigV2,
    admin_cap: &MarketAdminCapV2,
    enabled: bool,
) {
    assert!(admin_cap.config_id == object::id(config), EAnimacraftAuthorizationMismatch);
    config.primary_enabled = enabled;
    event::emit(MarketPrimaryGateV2Updated { enabled });
}

public fun update_config_v2_secondary_enabled(
    config: &mut MarketConfigV2,
    admin_cap: &MarketAdminCapV2,
    enabled: bool,
) {
    assert!(admin_cap.config_id == object::id(config), EAnimacraftAuthorizationMismatch);
    config.secondary_enabled = enabled;
    event::emit(MarketSecondaryGateV2Updated { enabled });
}

public fun update_config_v2_fee_recipient(
    config: &mut MarketConfigV2,
    admin_cap: &MarketAdminCapV2,
    fee_recipient: address,
) {
    assert!(admin_cap.config_id == object::id(config), EAnimacraftAuthorizationMismatch);
    assert!(fee_recipient != @0x0, EInvalidRecipient);
    config.fee_recipient = fee_recipient;
    event::emit(FeeRecipientUpdated { fee_recipient });
}

public fun update_config_v2_platform_fee_bps(
    config: &mut MarketConfigV2,
    admin_cap: &MarketAdminCapV2,
    fee_bps: u16,
) {
    assert!(admin_cap.config_id == object::id(config), EAnimacraftAuthorizationMismatch);
    assert!(fee_bps <= MAX_BPS, EPlatformFeeTooHigh);
    config.platform_fee_bps = fee_bps;
    event::emit(PlatformFeeBpsUpdated { fee_bps });
}

/// Primary operations continue to use `MarketConfigV2`, but only the v6
/// wrapper capability can manage their gate after retirement.
public fun update_config_v6_primary_enabled(
    config_v2: &mut MarketConfigV2,
    admin_cap: &MarketAdminCapV6,
    enabled: bool,
) {
    assert_v6_admin_links(config_v2, admin_cap);
    // Reassert the invariant on every v6 governance write. The wrapped v2
    // capability is intentionally retained only for primary administration.
    assert!(!config_v2.secondary_enabled, ESecondaryPausedV2);
    config_v2.primary_enabled = enabled;
    event::emit(MarketPrimaryGateV2Updated { enabled });
}

public fun update_config_v6_secondary_enabled(
    config_v2: &MarketConfigV2,
    config_v6: &mut MarketConfigV6,
    admin_cap: &MarketAdminCapV6,
    enabled: bool,
) {
    assert_v6_admin_links(config_v2, admin_cap);
    assert_v6_config_links(config_v2, config_v6, admin_cap);
    assert!(!config_v2.secondary_enabled, ESecondaryPausedV2);
    config_v6.secondary_enabled = enabled;
    event::emit(MarketSecondaryGateV6Updated { enabled });
}

/// Fee policy is kept identical for primary v2 and secondary v6 flows. A
/// single transaction updates both objects, preventing split-brain quotes.
public fun update_config_v6_fee_policy(
    config_v2: &mut MarketConfigV2,
    config_v6: &mut MarketConfigV6,
    admin_cap: &MarketAdminCapV6,
    fee_recipient: address,
    fee_bps: u16,
) {
    assert_v6_admin_links(config_v2, admin_cap);
    assert_v6_config_links(config_v2, config_v6, admin_cap);
    assert!(!config_v2.secondary_enabled, ESecondaryPausedV2);
    assert!(fee_recipient != @0x0, EInvalidRecipient);
    assert!(fee_bps <= MAX_BPS, EPlatformFeeTooHigh);
    config_v2.fee_recipient = fee_recipient;
    config_v2.platform_fee_bps = fee_bps;
    config_v6.fee_recipient = fee_recipient;
    config_v6.platform_fee_bps = fee_bps;
    event::emit(MarketFeePolicyV6Updated {
        fee_recipient,
        platform_fee_bps: fee_bps,
    });
}

fun assert_v6_admin_links(
    config_v2: &MarketConfigV2,
    admin_cap: &MarketAdminCapV6,
) {
    assert!(admin_cap.config_v2_id == object::id(config_v2), EAnimacraftAuthorizationMismatch);
    assert!(admin_cap.v2_admin_cap.config_id == object::id(config_v2), EAnimacraftAuthorizationMismatch);
}

fun assert_v6_config_links(
    config_v2: &MarketConfigV2,
    config_v6: &MarketConfigV6,
    admin_cap: &MarketAdminCapV6,
) {
    assert!(config_v6.config_v2_id == object::id(config_v2), EAnimacraftAuthorizationMismatch);
    assert!(config_v6.legacy_config_id == config_v2.legacy_config_id, EAnimacraftAuthorizationMismatch);
    assert!(admin_cap.config_v6_id == object::id(config_v6), EAnimacraftAuthorizationMismatch);
}

// ── Personal kiosk plumbing ───────────────────────────────────────────

public fun init_personal_kiosk(
    config: &MarketConfig,
    registry: &mut KioskRegistry,
    ctx: &mut TxContext,
): ID {
    assert!(!config.paused, EMarketPaused);
    let (mut kiosk_obj, kiosk_owner_cap) = kiosk::new(ctx);
    let kiosk_id = object::id(&kiosk_obj);
    let personal_kiosk_cap = personal_kiosk::new(&mut kiosk_obj, kiosk_owner_cap, ctx);
    let kiosk_cap_id = object::id(&personal_kiosk_cap);
    let owner = ctx.sender();

    register_personal_kiosk(registry, owner, kiosk_id, kiosk_cap_id);
    transfer::public_share_object(kiosk_obj);
    personal_kiosk::transfer_to_sender(personal_kiosk_cap, ctx);
    event::emit(PersonalKioskInitialized {
        kiosk_id,
        kiosk_cap_id,
        owner,
    });

    kiosk_id
}

public fun init_personal_kiosk_v2(
    config: &MarketConfigV2,
    registry: &mut KioskRegistry,
    ctx: &mut TxContext,
): ID {
    assert!(config.primary_enabled || config.secondary_enabled, EPrimaryPausedV2);
    let (mut kiosk_obj, kiosk_owner_cap) = kiosk::new(ctx);
    let kiosk_id = object::id(&kiosk_obj);
    let personal_kiosk_cap = personal_kiosk::new(&mut kiosk_obj, kiosk_owner_cap, ctx);
    let kiosk_cap_id = object::id(&personal_kiosk_cap);
    let owner = ctx.sender();

    register_personal_kiosk(registry, owner, kiosk_id, kiosk_cap_id);
    transfer::public_share_object(kiosk_obj);
    personal_kiosk::transfer_to_sender(personal_kiosk_cap, ctx);
    event::emit(PersonalKioskInitialized {
        kiosk_id,
        kiosk_cap_id,
        owner,
    });

    kiosk_id
}

public fun init_personal_kiosk_v6(
    config: &MarketConfigV6,
    registry: &mut KioskRegistry,
    ctx: &mut TxContext,
): ID {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let (mut kiosk_obj, kiosk_owner_cap) = kiosk::new(ctx);
    let kiosk_id = object::id(&kiosk_obj);
    let personal_kiosk_cap = personal_kiosk::new(&mut kiosk_obj, kiosk_owner_cap, ctx);
    let kiosk_cap_id = object::id(&personal_kiosk_cap);
    let owner = ctx.sender();
    register_personal_kiosk(registry, owner, kiosk_id, kiosk_cap_id);
    transfer::public_share_object(kiosk_obj);
    personal_kiosk::transfer_to_sender(personal_kiosk_cap, ctx);
    event::emit(PersonalKioskInitialized {
        kiosk_id,
        kiosk_cap_id,
        owner,
    });
    kiosk_id
}

public fun ensure_personal_kiosk_registered(
    config: &MarketConfig,
    registry: &mut KioskRegistry,
    personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    let owner = ctx.sender();
    let kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(personal_kiosk_cap));
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    insert_or_assert_personal_kiosk_registration(registry, owner, kiosk_id, kiosk_cap_id);
}

public fun ensure_personal_kiosk_registered_v2(
    config: &MarketConfigV2,
    registry: &mut KioskRegistry,
    personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled || config.secondary_enabled, EPrimaryPausedV2);
    let owner = ctx.sender();
    let kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(personal_kiosk_cap));
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    insert_or_assert_personal_kiosk_registration(registry, owner, kiosk_id, kiosk_cap_id);
}

public fun ensure_personal_kiosk_registered_v6(
    config: &MarketConfigV6,
    registry: &mut KioskRegistry,
    personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let owner = ctx.sender();
    let kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(personal_kiosk_cap));
    let kiosk_cap_id = object::id(personal_kiosk_cap);
    insert_or_assert_personal_kiosk_registration(registry, owner, kiosk_id, kiosk_cap_id);
}

/// Swap the caller's registered personal kiosk to a fresh one.
///
/// This is the ONLY public path that may change which `(kiosk_id, kiosk_cap_id)`
/// is recorded under `PersonalKioskOwnerKey { owner }`. The caller must:
///   1. Already have an existing registration (otherwise use
///      `ensure_personal_kiosk_registered` or `init_personal_kiosk`).
///   2. Pass the currently-registered `old_kiosk` as proof; it must match the
///      on-chain registration.
///   3. Ensure the old kiosk holds zero items — any Soul still locked there
///      would be orphaned (list/buy assert `state.current_kiosk_id ==
///      object::id(kiosk_obj)` AND the registry pointer, so once the pointer
///      moves off the old kiosk those Souls can no longer be operated on).
public fun rebind_primary_kiosk(
    config: &MarketConfig,
    registry: &mut KioskRegistry,
    old_kiosk: &Kiosk,
    new_personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    rebind_primary_kiosk_impl(registry, old_kiosk, new_personal_kiosk_cap, ctx);
}

public fun rebind_primary_kiosk_v2(
    config: &MarketConfigV2,
    registry: &mut KioskRegistry,
    old_kiosk: &Kiosk,
    new_personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled || config.secondary_enabled, EPrimaryPausedV2);
    rebind_primary_kiosk_impl(registry, old_kiosk, new_personal_kiosk_cap, ctx);
}

public fun rebind_primary_kiosk_v6(
    config: &MarketConfigV6,
    registry: &mut KioskRegistry,
    old_kiosk: &Kiosk,
    new_personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    rebind_primary_kiosk_impl(registry, old_kiosk, new_personal_kiosk_cap, ctx);
}

fun rebind_primary_kiosk_impl(
    registry: &mut KioskRegistry,
    old_kiosk: &Kiosk,
    new_personal_kiosk_cap: &PersonalKioskCap,
    ctx: &TxContext,
) {
    let owner = ctx.sender();
    let old_kiosk_id = object::id(old_kiosk);
    let new_kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(new_personal_kiosk_cap));
    let new_kiosk_cap_id = object::id(new_personal_kiosk_cap);
    assert!(old_kiosk_id != new_kiosk_id, ERebindSameKiosk);
    assert!(kiosk::item_count(old_kiosk) == 0, EOldKioskNotEmpty);

    let key = PersonalKioskOwnerKey { owner };
    assert!(df::exists(&registry.id, key), EPersonalKioskNotInitialized);
    let registration = df::borrow_mut<PersonalKioskOwnerKey, PersonalKioskRegistration>(
        &mut registry.id,
        key,
    );
    assert!(registration.kiosk_id == old_kiosk_id, EOldKioskMismatch);
    let old_kiosk_cap_id = registration.kiosk_cap_id;

    registration.kiosk_id = new_kiosk_id;
    registration.kiosk_cap_id = new_kiosk_cap_id;

    event::emit(PersonalKioskRebound {
        owner,
        old_kiosk_id,
        old_kiosk_cap_id,
        new_kiosk_id,
        new_kiosk_cap_id,
    });
}

public fun reuse_personal_kiosk(
    registry: &KioskRegistry,
    personal_kiosk_cap: PersonalKioskCap,
    ctx: &mut TxContext,
): ID {
    let kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(&personal_kiosk_cap));
    assert_registered_personal_kiosk(
        registry,
        ctx.sender(),
        kiosk_id,
        object::id(&personal_kiosk_cap),
    );
    personal_kiosk::transfer_to_sender(personal_kiosk_cap, ctx);
    kiosk_id
}

// ── Mint entries (typed-content ABI) ──────────────────────────────────

public fun mint_native_in_personal_kiosk(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    mint_soul_in_personal_kiosk_impl(
        config.paused,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        initial_content,
        initial_state_config,
        creator_royalty_bps,
        soul::provenance_native(),
        option::none(),
        clock,
        ctx,
    )
}

public fun mint_native_in_personal_kiosk_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    mint_soul_in_personal_kiosk_impl(
        false,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        initial_content,
        initial_state_config,
        creator_royalty_bps,
        soul::provenance_native(),
        option::none(),
        clock,
        ctx,
    )
}

/// Mint a Soul whose origin is declared off-chain (e.g. ported from another
/// chain or platform). `origin_ref` is treated as a free-form, **unverified**
/// human-readable string — the chain layer does not check signatures, oracles
/// or provenance attestations against it. UI surfaces must label imported
/// Souls accordingly so buyers don't mistake the field for a verified claim.
/// Promoting `origin_ref` to a verified channel would require introducing an
/// oracle / multisig attestation path here.
public fun mint_imported_in_personal_kiosk(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    origin_ref: String,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    mint_soul_in_personal_kiosk_impl(
        config.paused,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        initial_content,
        initial_state_config,
        creator_royalty_bps,
        soul::provenance_imported(),
        option::some(origin_ref),
        clock,
        ctx,
    )
}

public fun mint_imported_in_personal_kiosk_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    origin_ref: String,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    mint_soul_in_personal_kiosk_impl(
        false,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        initial_content,
        initial_state_config,
        creator_royalty_bps,
        soul::provenance_imported(),
        option::some(origin_ref),
        clock,
        ctx,
    )
}

/// Canonical Animacraft handoff. The authorization is non-droppable and is
/// consumed in the same PTB that creates Soulidity's only finished Soul.
public fun mint_animacraft_in_personal_kiosk(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    authorization: CanonicalSoulMintAuthorization,
    description: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    mint_animacraft_in_personal_kiosk_impl(
        config.paused,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        authorization,
        description,
        initial_content,
        initial_state_config,
        0,
        ANIMACRAFT_PROTOCOL_VERSION_V4,
        clock,
        ctx,
    )
}

/// Canonical Animacraft v4-compatible handoff after irreversible
/// legacy-market retirement. The dedicated v5 entrypoint below adds the
/// immutable Soul-creator royalty snapshot without changing this ABI.
public fun mint_animacraft_in_personal_kiosk_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    authorization: CanonicalSoulMintAuthorization,
    description: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    mint_animacraft_in_personal_kiosk_impl(
        false,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        authorization,
        description,
        initial_content,
        initial_state_config,
        0,
        ANIMACRAFT_PROTOCOL_VERSION_V4,
        clock,
        ctx,
    )
}

/// Canonical Animacraft commerce-v5 handoff. The authorization has a distinct
/// non-droppable type and carries the MakerRootV5 creator royalty snapshot;
/// callers cannot supply or override that value at Soulidity's public ABI.
public fun mint_animacraft_v5_in_personal_kiosk_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    root: &mut MakerRootV5,
    commerce_protocol_config: &CommerceProtocolConfigV5,
    authorization: CommerceV5SoulMintAuthorization,
    description: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    let (
        canonical_authorization,
        soul_creator_royalty_bps,
        output_binding,
    ) =
        animacraft_commerce_v5::consume_commerce_v5_soul_mint_authorization(
            authorization,
        );
    let output_seal_id =
        *animacraft_commerce_v5::complete_output_soul_binding_seal_id_v5(
            &output_binding,
        );
    let mut state = mint_animacraft_in_personal_kiosk_impl(
        false,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        canonical_authorization,
        description,
        initial_content,
        initial_state_config,
        soul_creator_royalty_bps,
        ANIMACRAFT_PROTOCOL_VERSION_V5,
        clock,
        ctx,
    );
    let soul_id = soul::soul_id(&state);
    let binding_proof = animacraft_soul_binding_v5::new();
    animacraft_commerce_v5::bind_complete_output_to_soul_v5(
        root,
        commerce_protocol_config,
        output_binding,
        soul_id,
        binding_proof,
    );
    animacraft_output_provenance_v5::new_bind_and_freeze(
        &mut state,
        root,
        output_seal_id,
        ctx,
    );
    state
}

/// Canonical physical-composition-v7 Complete boundary. The trusted
/// Root/v6/v7 Profile tuple is fixed here, while the authenticated v5
/// Complete authorization is consumed, so a later public wardrobe call can
/// never bind an unrelated Maker or Profile to this Soul.
public fun mint_animacraft_v7_in_personal_kiosk_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    root: &mut MakerRootV5,
    commerce_protocol_config: &CommerceProtocolConfigV5,
    composition_profile: &MakerProfileV6,
    physical_profile: &MakerPhysicalProfileV7,
    authorization: CommerceV5SoulMintAuthorization,
    description: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    let root_id = animacraft_commerce_v5::root_id_v5(root);
    let composition_profile_id = composition_v6::profile_id_v6(
        composition_profile,
    );
    physical_v7::assert_physical_profile_binding_v7(
        physical_profile,
        root_id,
        composition_profile_id,
        composition_v6::profile_slot_schema_commitment_v6(
            composition_profile,
        ),
        composition_v6::profile_renderer_commitment_v6(
            composition_profile,
        ),
    );
    // Snapshot only the hash already authenticated inside v5 Complete before
    // that non-droppable authorization is consumed by the canonical mint.
    // No handoff/client hash is accepted by this boundary.
    let authenticated_recipe_hash =
        *animacraft_commerce_v5::complete_authorization_recipe_hash_v5(
            &authorization,
        );
    let mut state = mint_animacraft_v5_in_personal_kiosk_v2(
        config,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        root,
        commerce_protocol_config,
        authorization,
        description,
        initial_content,
        initial_state_config,
        clock,
        ctx,
    );
    soul::bind_animacraft_physical_v7_profile(
        &mut state,
        root_id,
        composition_profile_id,
        physical_v7::physical_profile_id_v7(physical_profile),
        authenticated_recipe_hash,
    );
    state
}

fun mint_animacraft_in_personal_kiosk_impl(
    market_paused: bool,
    platform_fee_bps: u16,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    authorization: CanonicalSoulMintAuthorization,
    description: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    soul_creator_royalty_bps: u16,
    required_animacraft_version: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    let (
        authorization,
        protocol_fee_config_id,
        protocol_treasury_id,
        primary_protocol_fee_bps,
        primary_protocol_fee_atomic,
    ) = animacraft::consume_canonical_soul_mint_authorization(authorization);
    let (
        animacraft_version,
        maker_id,
        maker_treasury_id,
        maker_creator,
        payer,
        name,
        profile_json_blob_id,
        image_blob_id,
        image_url,
        recipe_hash,
        license_snapshot,
        royalty_policy,
        mint_payment_coin_type,
        mint_price_atomic,
        recipe,
        authorized_at_ms,
    ) = animacraft::consume_soul_mint_authorization(authorization);

    // The current dependency exposes the canonical v4 type.  Animacraft v5
    // is intentionally accepted only if it preserves this canonical consume
    // ABI and reports version 5; its resale path is separately fail-closed.
    assert!(
        animacraft_version == ANIMACRAFT_PROTOCOL_VERSION_V4
            || animacraft_version == ANIMACRAFT_PROTOCOL_VERSION_V5,
        EAnimacraftProtocolVersion,
    );
    assert!(
        required_animacraft_version == 0
            || animacraft_version == required_animacraft_version,
        EAnimacraftProtocolVersion,
    );
    assert!(payer == ctx.sender(), EAnimacraftPayerMismatch);
    assert!(personal_kiosk::owner(kiosk_obj) == payer, EAnimacraftPayerMismatch);
    assert!(
        maker_id == animacraft::royalty_policy_maker_id(&royalty_policy),
        EAnimacraftAuthorizationMismatch,
    );
    assert!(
        maker_treasury_id == animacraft::royalty_policy_treasury_id(&royalty_policy),
        EAnimacraftAuthorizationMismatch,
    );
    let maker_source_royalty_bps = animacraft::royalty_policy_bps(&royalty_policy);
    if (animacraft_version == ANIMACRAFT_PROTOCOL_VERSION_V5) {
        assert_animacraft_v5_royalty_schedule(
            soul_creator_royalty_bps,
            maker_source_royalty_bps,
        );
    } else {
        // v4 ABI and settlement semantics remain unchanged.
        assert!(soul_creator_royalty_bps == 0, EAnimacraftAuthorizationMismatch);
    };
    let expected_payment_coin_type = payment_coin_type_name<USDC>();
    assert!(
        &mint_payment_coin_type == &expected_payment_coin_type,
        EAnimacraftCoinTypeMismatch,
    );

    let mut state = mint_soul_in_personal_kiosk_impl(
        market_paused,
        platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        copy image_url,
        initial_content,
        initial_state_config,
        soul_creator_royalty_bps,
        soul::provenance_animacraft(),
        option::some(copy profile_json_blob_id),
        clock,
        ctx,
    );
    let provenance = animacraft_provenance::new(
        soul::soul_id(&state),
        animacraft_version,
        maker_id,
        maker_treasury_id,
        maker_creator,
        payer,
        profile_json_blob_id,
        image_blob_id,
        image_url,
        recipe_hash,
        license_snapshot,
        royalty_policy,
        mint_payment_coin_type,
        mint_price_atomic,
        protocol_fee_config_id,
        protocol_treasury_id,
        primary_protocol_fee_bps,
        primary_protocol_fee_atomic,
        recipe,
        authorized_at_ms,
        ctx,
    );
    animacraft_provenance::bind_and_freeze(&mut state, provenance);
    state
}

public fun mint_joined_in_personal_kiosk<T: key + store>(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    registry: &mut KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    source_object_id: ID,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    origin_ref: String,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(kiosk::has_item_with_type<T>(kiosk_obj, source_object_id), ECollectionMismatch);
    let join_key = JoinedSourceKey { source_object_id };
    assert!(!df::exists(&registry.id, join_key), ESourceAlreadyJoined);
    df::add(&mut registry.id, join_key, true);
    mint_soul_in_personal_kiosk_impl(
        config.paused,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        initial_content,
        initial_state_config,
        creator_royalty_bps,
        soul::provenance_personal_join(),
        option::some(origin_ref),
        clock,
        ctx,
    )
}

public fun mint_joined_in_personal_kiosk_v2<T: key + store>(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &mut KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    source_object_id: ID,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    origin_ref: String,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    assert!(kiosk::has_item_with_type<T>(kiosk_obj, source_object_id), ECollectionMismatch);
    let join_key = JoinedSourceKey { source_object_id };
    assert!(!df::exists(&registry.id, join_key), ESourceAlreadyJoined);
    df::add(&mut registry.id, join_key, true);
    mint_soul_in_personal_kiosk_impl(
        false,
        config.platform_fee_bps,
        kind_registry_obj,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        initial_content,
        initial_state_config,
        creator_royalty_bps,
        soul::provenance_personal_join(),
        option::some(origin_ref),
        clock,
        ctx,
    )
}

public fun create_collection_in_personal_kiosk(
    config: &MarketConfig,
    registry: &KioskRegistry,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    extra_royalty_bps: u16,
    tradeable: bool,
    max_supply: Option<u64>,
    ctx: &mut TxContext,
): SoulCollection {
    create_collection_in_personal_kiosk_impl(
        config.paused,
        config.platform_fee_bps,
        registry,
        collection_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        extra_royalty_bps,
        tradeable,
        max_supply,
        ctx,
    )
}

public fun create_collection_in_personal_kiosk_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    extra_royalty_bps: u16,
    tradeable: bool,
    max_supply: Option<u64>,
    ctx: &mut TxContext,
): SoulCollection {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    create_collection_in_personal_kiosk_impl(
        false,
        config.platform_fee_bps,
        registry,
        collection_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        extra_royalty_bps,
        tradeable,
        max_supply,
        ctx,
    )
}

fun create_collection_in_personal_kiosk_impl(
    market_paused: bool,
    platform_fee_bps: u16,
    registry: &KioskRegistry,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    extra_royalty_bps: u16,
    tradeable: bool,
    max_supply: Option<u64>,
    ctx: &mut TxContext,
): SoulCollection {
    assert!(!market_paused, EMarketPaused);
    assert!(
        ((platform_fee_bps as u64) + (extra_royalty_bps as u64)) <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);

    let owner = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, owner, kiosk_id, object::id(personal_kiosk_cap));

    let (collection_obj, right_obj) = collection::create(
        name,
        description,
        image_url,
        extra_royalty_bps,
        tradeable,
        max_supply,
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
    event::emit(CollectionMintedToKiosk {
        collection_id,
        right_id,
        owner,
        kiosk_id,
        tradeable,
    });

    collection_obj
}

// ── Active-binding / state-config wallet wrappers ─────────────────────

/// Bind `(kind, name, version_index)` as the active version for `kind`
/// on this Soul. Replaces the legacy `set_active_sprite` /
/// `set_active_voice` pair. Operates on the typed-content root
/// (`&mut SoulContent`) instead of the deleted `SoulMetadata` object.
public fun set_active_content(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    content: &mut SoulContent,
    state: &SoulState,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    assert!(soul::current_owner(state) == ctx.sender(), ENotSoulOwner);
    content::set_active(content, state, kind_registry_obj, kind, name, version_index, ctx);
}

public fun clear_active_content(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    content: &mut SoulContent,
    state: &SoulState,
    kind: u32,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    assert!(soul::current_owner(state) == ctx.sender(), ENotSoulOwner);
    content::clear_active(content, state, kind_registry_obj, kind, ctx);
}

public fun set_state_config(
    config: &MarketConfig,
    state: &mut SoulState,
    key: String,
    value: vector<u8>,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    assert!(soul::current_owner(state) == ctx.sender(), ENotSoulOwner);
    assert!(!std::string::is_empty(&key), EStateConfigKeyEmpty);
    let updater = ctx.sender();
    let key_for_event = copy key;
    soul::upsert_state_config(state, key, value);
    soul::emit_state_config_upserted(state, updater, key_for_event);
}

public fun delete_state_config(
    config: &MarketConfig,
    state: &mut SoulState,
    key: String,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    assert!(soul::current_owner(state) == ctx.sender(), ENotSoulOwner);
    assert!(!std::string::is_empty(&key), EStateConfigKeyEmpty);
    let updater = ctx.sender();
    let key_for_event = copy key;
    soul::delete_state_config(state, key);
    soul::emit_state_config_deleted(state, updater, key_for_event);
}

public fun set_active_content_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    content: &mut SoulContent,
    state: &SoulState,
    kind: u32,
    name: String,
    version_index: u64,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    assert!(soul::current_owner(state) == ctx.sender(), ENotSoulOwner);
    content::set_active(content, state, kind_registry_obj, kind, name, version_index, ctx);
}

public fun clear_active_content_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    content: &mut SoulContent,
    state: &SoulState,
    kind: u32,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    assert!(soul::current_owner(state) == ctx.sender(), ENotSoulOwner);
    content::clear_active(content, state, kind_registry_obj, kind, ctx);
}

public fun set_state_config_v2(
    config: &MarketConfigV2,
    state: &mut SoulState,
    key: String,
    value: vector<u8>,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    assert!(soul::current_owner(state) == ctx.sender(), ENotSoulOwner);
    assert!(!std::string::is_empty(&key), EStateConfigKeyEmpty);
    let updater = ctx.sender();
    let key_for_event = copy key;
    soul::upsert_state_config(state, key, value);
    soul::emit_state_config_upserted(state, updater, key_for_event);
}

public fun delete_state_config_v2(
    config: &MarketConfigV2,
    state: &mut SoulState,
    key: String,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    assert!(soul::current_owner(state) == ctx.sender(), ENotSoulOwner);
    assert!(!std::string::is_empty(&key), EStateConfigKeyEmpty);
    let updater = ctx.sender();
    let key_for_event = copy key;
    soul::delete_state_config(state, key);
    soul::emit_state_config_deleted(state, updater, key_for_event);
}

// ── Listing flows (Soul / Collection) ─────────────────────────────────

public fun list_soul_fixed_price(
    config: &MarketConfig,
    registry: &KioskRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(!config.paused, EMarketPaused);
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftListingPathRequired);
    assert!(
        ((config.platform_fee_bps as u64) + (soul::creator_royalty_bps(state) as u64)) <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    assert!(soul::current_owner(state) == ctx.sender(), ESoulOwnerMismatch);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), ESoulCurrentKioskMismatch);

    let soul_id = soul::soul_id(state);
    let seller = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, seller, kiosk_id, object::id(personal_kiosk_cap));

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
    soul::set_listed(state, true);

    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id,
        price,
    });

    listing
}

public fun list_soul_fixed_price_with_collection(
    config: &MarketConfig,
    registry: &KioskRegistry,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(!config.paused, EMarketPaused);
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftListingPathRequired);
    assert!(
        (
            (config.platform_fee_bps as u64)
                + (soul::creator_royalty_bps(state) as u64)
                + (collection::extra_royalty_bps(collection_obj) as u64)
        ) <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    let collection_id = object::id(collection_obj);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    assert!(soul::current_owner(state) == ctx.sender(), ESoulOwnerMismatch);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), ESoulCurrentKioskMismatch);

    let soul_id = soul::soul_id(state);
    let seller = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, seller, kiosk_id, object::id(personal_kiosk_cap));

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
    soul::set_listed(state, true);

    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id,
        price,
    });

    listing
}

public fun list_soul_fixed_price_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftListingPathRequired);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    list_soul_after_validation_successor(
        config.secondary_enabled,
        config.platform_fee_bps,
        MARKET_VERSION_V2,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::none(),
        0,
        ctx,
    )
}

public fun list_soul_fixed_price_with_collection_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftListingPathRequired);
    let collection_id = object::id(collection_obj);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    list_soul_after_validation_successor(
        config.secondary_enabled,
        config.platform_fee_bps,
        MARKET_VERSION_V2,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::some(collection_id),
        collection::extra_royalty_bps(collection_obj),
        ctx,
    )
}

public fun list_soul_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftListingPathRequired);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    list_soul_after_validation_successor(
        config.secondary_enabled,
        config.platform_fee_bps,
        MARKET_VERSION_ANIMACRAFT_V6,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::none(),
        0,
        ctx,
    )
}

public fun list_soul_fixed_price_with_collection_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftListingPathRequired);
    let collection_id = object::id(collection_obj);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    list_soul_after_validation_successor(
        config.secondary_enabled,
        config.platform_fee_bps,
        MARKET_VERSION_ANIMACRAFT_V6,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::some(collection_id),
        collection::extra_royalty_bps(collection_obj),
        ctx,
    )
}

/// List an Animacraft-derived Soul without a collection. The immutable
/// provenance is required at list time so every fee is validated before a
/// public listing can be created; buyers can never discover an unfillable
/// listing whose Maker royalty was omitted from the fee ceiling.
public fun list_animacraft_soul_fixed_price(
    config: &MarketConfig,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(!config.paused, EMarketPaused);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v4_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::creator_royalty_bps(state) == 0, EAnimacraftAuthorizationMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let (_, _, _, _, _) = quote_animacraft_soul_purchase(
        config,
        price,
        animacraft_provenance::royalty_bps(provenance),
        0,
    );

    list_animacraft_soul_after_validation(
        config,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::none(),
        0,
        ctx,
    )
}

/// Collection-aware Animacraft listing. Validates platform, Maker and
/// collection royalties together, using the same rounding rules as purchase.
public fun list_animacraft_soul_fixed_price_with_collection(
    config: &MarketConfig,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(!config.paused, EMarketPaused);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v4_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::creator_royalty_bps(state) == 0, EAnimacraftAuthorizationMismatch);
    let collection_id = object::id(collection_obj);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let collection_royalty_bps = collection::extra_royalty_bps(collection_obj);
    let (_, _, _, _, _) = quote_animacraft_soul_purchase(
        config,
        price,
        animacraft_provenance::royalty_bps(provenance),
        collection_royalty_bps,
    );

    list_animacraft_soul_after_validation(
        config,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::some(collection_id),
        collection_royalty_bps,
        ctx,
    )
}

/// Royalty-aware listing through the successor market. Secondary trading is
/// disabled by default after migration and must be explicitly enabled.
public fun list_animacraft_soul_fixed_price_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v4_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::creator_royalty_bps(state) == 0, EAnimacraftAuthorizationMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let (_, _, _, _, _) = quote_animacraft_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        animacraft_provenance::royalty_bps(provenance),
        0,
    );

    list_soul_after_validation_successor(
        config.secondary_enabled,
        config.platform_fee_bps,
        MARKET_VERSION_V2,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::none(),
        0,
        ctx,
    )
}

public fun list_animacraft_soul_fixed_price_with_collection_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v4_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::creator_royalty_bps(state) == 0, EAnimacraftAuthorizationMismatch);
    let collection_id = object::id(collection_obj);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let collection_royalty_bps = collection::extra_royalty_bps(collection_obj);
    let (_, _, _, _, _) = quote_animacraft_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        animacraft_provenance::royalty_bps(provenance),
        collection_royalty_bps,
    );

    list_soul_after_validation_successor(
        config.secondary_enabled,
        config.platform_fee_bps,
        MARKET_VERSION_V2,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::some(collection_id),
        collection_royalty_bps,
        ctx,
    )
}

public fun list_animacraft_soul_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v4_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::creator_royalty_bps(state) == 0, EAnimacraftAuthorizationMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let (_, _, _, _, _) = quote_animacraft_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        animacraft_provenance::royalty_bps(provenance),
        0,
    );
    list_soul_after_validation_successor(
        config.secondary_enabled,
        config.platform_fee_bps,
        MARKET_VERSION_ANIMACRAFT_V6,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::none(),
        0,
        ctx,
    )
}

public fun list_animacraft_soul_fixed_price_with_collection_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v4_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::creator_royalty_bps(state) == 0, EAnimacraftAuthorizationMismatch);
    let collection_id = object::id(collection_obj);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let collection_royalty_bps = collection::extra_royalty_bps(collection_obj);
    let (_, _, _, _, _) = quote_animacraft_soul_purchase_with_fee_bps(
        config.platform_fee_bps,
        price,
        animacraft_provenance::royalty_bps(provenance),
        collection_royalty_bps,
    );
    list_soul_after_validation_successor(
        config.secondary_enabled,
        config.platform_fee_bps,
        MARKET_VERSION_ANIMACRAFT_V6,
        registry,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        option::some(collection_id),
        collection_royalty_bps,
        ctx,
    )
}

/// Dedicated gross-price resale listing for Animacraft v5 provenance.  This
/// deliberately has no collection variant: the approved v5 model reserves a
/// maximum 10% rights pool plus the separate fixed 2.5% protocol fee, and
/// therefore cannot be silently expanded by a collection royalty.
public fun list_animacraft_v5_soul_fixed_price_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    let frozen_creator_royalty_bps = soul::creator_royalty_bps(state);
    list_animacraft_v5_soul_fixed_price_with_creator_royalty_v2(
        config,
        registry,
        provenance,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        frozen_creator_royalty_bps,
        ctx,
    )
}

/// ABI-compatible v5 listing variant. `soul_creator_royalty_bps` is no longer
/// seller-configurable: it must equal the immutable value selected when the
/// Soul was minted. The Maker-source share is independently read from frozen
/// Animacraft provenance.
public fun list_animacraft_v5_soul_fixed_price_with_creator_royalty_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    soul_creator_royalty_bps: u16,
    ctx: &mut TxContext,
): SoulListing {
    assert_legacy_listing_has_no_v6_appearance(state);
    list_animacraft_v5_soul_fixed_price_with_creator_royalty_impl(
        config.secondary_enabled,
        config.platform_fee_bps,
        registry,
        provenance,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        soul_creator_royalty_bps,
        ctx,
    )
}

public fun list_animacraft_v5_soul_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    let frozen_creator_royalty_bps = soul::creator_royalty_bps(state);
    list_animacraft_v5_soul_fixed_price_with_creator_royalty_v6(
        config,
        registry,
        provenance,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        frozen_creator_royalty_bps,
        ctx,
    )
}

public fun list_animacraft_v5_soul_fixed_price_with_creator_royalty_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    soul_creator_royalty_bps: u16,
    ctx: &mut TxContext,
): SoulListing {
    assert_legacy_listing_has_no_v6_appearance(state);
    list_animacraft_v5_soul_fixed_price_with_creator_royalty_impl(
        config.secondary_enabled,
        config.platform_fee_bps,
        registry,
        provenance,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        price,
        soul_creator_royalty_bps,
        ctx,
    )
}

fun list_animacraft_v5_soul_fixed_price_with_creator_royalty_impl(
    secondary_enabled: bool,
    platform_fee_bps: u16,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    soul_creator_royalty_bps: u16,
    ctx: &mut TxContext,
): SoulListing {
    assert!(secondary_enabled, ESecondaryPausedV2);
    assert!(platform_fee_bps == ANIMACRAFT_V5_PROTOCOL_FEE_BPS, EAnimacraftV5ProtocolFeeMismatch);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v5_commerce_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    assert!(
        soul_creator_royalty_bps == soul::creator_royalty_bps(state),
        EAnimacraftV5CreatorRoyaltyMismatch,
    );
    let maker_source_royalty_bps = animacraft_provenance::royalty_bps(provenance);
    let (_, _, _, _) = quote_animacraft_v5_soul_sale_for_state(
        state,
        price,
        maker_source_royalty_bps,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::current_owner(state) == ctx.sender(), ESoulOwnerMismatch);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), ESoulCurrentKioskMismatch);

    let soul_id = soul::soul_id(state);
    let seller = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, seller, kiosk_id, object::id(personal_kiosk_cap));
    let _soul_ref = kiosk::borrow<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
    );
    let purchase_cap = kiosk::list_with_purchase_cap<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
        0,
        ctx,
    );
    let listing = SoulListing {
        id: object::new(ctx),
        version: MARKET_VERSION_ANIMACRAFT_V5,
        soul_id,
        state_id: object::id(state),
        seller,
        seller_kiosk_id: kiosk_id,
        price,
        creator: soul::state_creator(state),
        creator_royalty_bps: soul_creator_royalty_bps,
        collection_id: option::none(),
        purchase_cap: option::some(purchase_cap),
        is_active: true,
    };
    let listing_id = object::id(&listing);
    soul::set_listed(state, true);
    event::emit(SoulListed { listing_id, soul_id, seller, kiosk_id, price });
    listing
}

/// The only listing creation path for a Soul with a v6 appearance companion.
/// A new config and listing TypeOrigin ensure immutable v2/v5 bytecode cannot
/// create or settle this path.
public fun list_animacraft_v6_soul_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    composition_registry: &CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    commerce_config: &CommerceProtocolConfigV5,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    appearance: &SoulAppearanceStateV6,
    selections: vector<LoadoutSelectionV6>,
    price: u64,
    ctx: &mut TxContext,
): AnimacraftV6SoulListing {
    appearance_adapter_v6::assert_secondary_market_appearance_v6(
        composition_registry,
        composition_config,
        profile,
        root,
        commerce_config,
        state,
        appearance,
        &selections,
    );
    list_animacraft_v6_soul_fixed_price_impl(
        config,
        registry,
        provenance,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        appearance,
        price,
        ctx,
    )
}

fun list_animacraft_v6_soul_fixed_price_impl(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    appearance: &SoulAppearanceStateV6,
    price: u64,
    ctx: &mut TxContext,
): AnimacraftV6SoulListing {
    // v7-bound Souls require a dedicated market ABI that receives and checks
    // the exact wardrobe in the same PTB. Until that reviewed path exists,
    // fail closed rather than allowing the v6 listing to bypass external
    // Style custody.
    assert!(
        !soul::has_animacraft_physical_v7_profile(state)
            && !soul::has_animacraft_wardrobe_v7(state),
        EAnimacraftV7WardrobeListingUnsupported,
    );
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(config.platform_fee_bps == ANIMACRAFT_V5_PROTOCOL_FEE_BPS, EAnimacraftV5ProtocolFeeMismatch);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v5_commerce_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let soul_creator_royalty_bps = soul::creator_royalty_bps(state);
    let maker_source_royalty_bps = animacraft_provenance::royalty_bps(provenance);
    let (_, _, _, _) = quote_animacraft_v5_soul_sale_for_state(
        state,
        price,
        maker_source_royalty_bps,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::current_owner(state) == ctx.sender(), ESoulOwnerMismatch);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), ESoulCurrentKioskMismatch);
    appearance_v6::assert_transfer_safe_for_listing(state, appearance);

    let soul_id = soul::soul_id(state);
    let seller = personal_kiosk::owner(kiosk_obj);
    let seller_kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(
        registry,
        seller,
        seller_kiosk_id,
        object::id(personal_kiosk_cap),
    );
    let _soul_ref = kiosk::borrow<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
    );
    let purchase_cap = kiosk::list_with_purchase_cap<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
        0,
        ctx,
    );
    let appearance_state_id = object::id(appearance);
    let appearance_revision = appearance_v6::revision(appearance);
    let ownership_epoch = appearance_v6::ownership_epoch_snapshot(appearance);
    let loadout_hash = *appearance_v6::current_loadout_hash(appearance);
    let listing = AnimacraftV6SoulListing {
        id: object::new(ctx),
        version: MARKET_VERSION_ANIMACRAFT_V6,
        soul_id,
        state_id: object::id(state),
        seller,
        seller_kiosk_id,
        price,
        creator: soul::state_creator(state),
        creator_royalty_bps: soul_creator_royalty_bps,
        purchase_cap: option::some(purchase_cap),
        appearance_state_id,
        appearance_revision,
        ownership_epoch,
        loadout_hash: copy loadout_hash,
        transfer_safe: true,
        is_active: true,
    };
    let listing_id = object::id(&listing);
    soul::set_listed(state, true);
    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id: seller_kiosk_id,
        price,
    });
    event::emit(AnimacraftV6SoulListed {
        listing_id,
        soul_id,
        appearance_state_id,
        appearance_revision,
        ownership_epoch,
        loadout_hash,
    });
    listing
}

#[test_only]
public fun list_animacraft_v6_soul_fixed_price_for_testing(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    appearance: &SoulAppearanceStateV6,
    price: u64,
    ctx: &mut TxContext,
): AnimacraftV6SoulListing {
    list_animacraft_v6_soul_fixed_price_impl(
        config,
        registry,
        provenance,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        appearance,
        price,
        ctx,
    )
}

/// The only listing creation path for a physical-v7 Soul. Animacraft locks
/// the exact bound wardrobe in this PTB and aborts when any wallet-owned
/// external Style remains in Soul custody. Soul-local Included Styles remain
/// attached to the Soul and are safe to transfer with it.
public fun list_animacraft_v7_soul_fixed_price_v7(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    provenance: &AnimacraftProvenance,
    physical_config: &PhysicalProtocolConfigV7,
    physical_profile: &MakerPhysicalProfileV7,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    wardrobe: &mut SoulWardrobeV7,
    price: u64,
    expected_wardrobe_revision: u64,
    ctx: &mut TxContext,
): AnimacraftV7SoulListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(config.platform_fee_bps == ANIMACRAFT_V5_PROTOCOL_FEE_BPS, EAnimacraftV5ProtocolFeeMismatch);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v5_commerce_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let maker_source_royalty_bps = animacraft_provenance::royalty_bps(provenance);
    let (_, _, _, _) = quote_animacraft_v5_soul_sale_for_state(
        state,
        price,
        maker_source_royalty_bps,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::current_owner(state) == ctx.sender(), ESoulOwnerMismatch);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), ESoulCurrentKioskMismatch);
    assert_animacraft_v7_wardrobe_binding(state, wardrobe, physical_profile);

    let soul_id = soul::soul_id(state);
    let seller = personal_kiosk::owner(kiosk_obj);
    let seller_kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(
        registry,
        seller,
        seller_kiosk_id,
        object::id(personal_kiosk_cap),
    );
    let _soul_ref = kiosk::borrow<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
    );
    physical_v7::set_wardrobe_listed_v7(
        wardrobe,
        physical_config,
        physical_profile,
        soul_id,
        true,
        PhysicalWardrobeListingProofV7 {},
        expected_wardrobe_revision,
    );
    let purchase_cap = kiosk::list_with_purchase_cap<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
        0,
        ctx,
    );
    let wardrobe_id = physical_v7::wardrobe_id_v7(wardrobe);
    let wardrobe_revision = physical_v7::wardrobe_revision_v7(wardrobe);
    let ownership_epoch = soul::ownership_epoch(state);
    let listing = AnimacraftV7SoulListing {
        id: object::new(ctx),
        soul_id,
        seller,
        seller_kiosk_id,
        price,
        purchase_cap: option::some(purchase_cap),
        wardrobe_id,
        wardrobe_revision,
        ownership_epoch,
        is_active: true,
    };
    let listing_id = object::id(&listing);
    soul::set_listed(state, true);
    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id: seller_kiosk_id,
        price,
    });
    listing
}

public fun cancel_soul_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
) {
    assert_legacy_listing_has_no_v6_appearance(state);
    cancel_soul_listing_impl(
        kiosk_obj,
        personal_kiosk_cap,
        state,
        listing,
    )
}

fun cancel_soul_listing_impl(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
) {
    assert!(listing.is_active, EInactiveListing);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(object::id(kiosk_obj) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(kiosk_obj) == listing.seller, EKioskOwnerMismatch);
    assert!(listing.state_id == object::id(state), EListingStateMismatch);
    assert!(listing.soul_id == soul::soul_id(state), EListingStateMismatch);

    let purchase_cap = take_soul_purchase_cap(listing);
    kiosk::return_purchase_cap<Soul>(kiosk_obj, purchase_cap);
    listing.is_active = false;
    soul::set_listed(state, false);

    event::emit(SoulListingCancelled {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        seller: listing.seller,
    });
}

public fun cancel_animacraft_v6_soul_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    appearance: &SoulAppearanceStateV6,
    listing: &mut AnimacraftV6SoulListing,
) {
    assert_animacraft_v6_listing(
        state,
        appearance,
        listing,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(object::id(kiosk_obj) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(kiosk_obj) == listing.seller, EKioskOwnerMismatch);
    let purchase_cap = take_animacraft_v6_soul_purchase_cap(listing);
    kiosk::return_purchase_cap<Soul>(kiosk_obj, purchase_cap);
    listing.is_active = false;
    soul::set_listed(state, false);
    event::emit(SoulListingCancelled {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        seller: listing.seller,
    });
    event::emit(AnimacraftV6SoulListingCancelled {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        appearance_revision: listing.appearance_revision,
    });
}

/// Cancel and unlock a physical-v7 listing atomically. The exact wardrobe,
/// Profile and post-lock revision are pinned by the listing snapshot.
public fun cancel_animacraft_v7_soul_listing(
    physical_config: &PhysicalProtocolConfigV7,
    physical_profile: &MakerPhysicalProfileV7,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    wardrobe: &mut SoulWardrobeV7,
    listing: &mut AnimacraftV7SoulListing,
) {
    assert_animacraft_v7_listing(state, wardrobe, physical_profile, listing);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(object::id(kiosk_obj) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(kiosk_obj) == listing.seller, EKioskOwnerMismatch);
    physical_v7::set_wardrobe_listed_v7(
        wardrobe,
        physical_config,
        physical_profile,
        listing.soul_id,
        false,
        PhysicalWardrobeListingProofV7 {},
        listing.wardrobe_revision,
    );
    let purchase_cap = take_animacraft_v7_soul_purchase_cap(listing);
    kiosk::return_purchase_cap<Soul>(kiosk_obj, purchase_cap);
    listing.is_active = false;
    soul::set_listed(state, false);
    event::emit(SoulListingCancelled {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        seller: listing.seller,
    });
}

public fun buy_soul_fixed_price(
    config: &MarketConfig,
    registry: &KioskRegistry,
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
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftPurchasePathRequired);
    assert!(listing.collection_id.is_none(), ECollectionMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    buy_soul_impl(
        config.paused,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
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
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    collection_obj: &SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftPurchasePathRequired);
    let collection_id = object::id(collection_obj);
    assert!(listing.collection_id.contains(&collection_id), ECollectionMismatch);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    buy_soul_impl(
        config.paused,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
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

/// Settle an ordinary Soul listing through the unified successor market.
/// Listings created before retirement remain compatible because their fee
/// snapshot and kiosk purchase capability are stored on `SoulListing`.
public fun buy_soul_fixed_price_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let seller = listing.seller;
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftPurchasePathRequired);
    assert!(listing.collection_id.is_none(), ECollectionMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    buy_soul_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
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

public fun buy_soul_fixed_price_with_collection_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    collection_obj: &SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftPurchasePathRequired);
    let collection_id = object::id(collection_obj);
    assert!(listing.collection_id.contains(&collection_id), ECollectionMismatch);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    buy_soul_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
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

public fun buy_soul_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let seller = listing.seller;
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftPurchasePathRequired);
    assert!(listing.collection_id.is_none(), ECollectionMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    buy_soul_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
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

public fun buy_soul_fixed_price_with_collection_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    collection_obj: &SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(!soul::has_animacraft_provenance(state), EAnimacraftPurchasePathRequired);
    let collection_id = object::id(collection_obj);
    assert!(listing.collection_id.contains(&collection_id), ECollectionMismatch);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    buy_soul_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
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

public fun buy_animacraft_soul_fixed_price(
    config: &MarketConfig,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    maker: &OCMaker,
    maker_treasury: &mut MakerTreasury<USDC>,
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
    buy_animacraft_soul_impl(
        config.paused,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        soul_policy,
        provenance,
        maker,
        maker_treasury,
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

public fun buy_animacraft_soul_fixed_price_with_collection(
    config: &MarketConfig,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    maker: &OCMaker,
    maker_treasury: &mut MakerTreasury<USDC>,
    collection_obj: &SoulCollection,
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
    buy_animacraft_soul_impl(
        config.paused,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        soul_policy,
        provenance,
        maker,
        maker_treasury,
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

public fun buy_animacraft_soul_fixed_price_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    maker: &OCMaker,
    maker_treasury: &mut MakerTreasury<USDC>,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let seller = listing.seller;
    assert!(listing.collection_id.is_none(), ECollectionMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    buy_animacraft_soul_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        soul_policy,
        provenance,
        maker,
        maker_treasury,
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

public fun buy_animacraft_soul_fixed_price_with_collection_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    maker: &OCMaker,
    maker_treasury: &mut MakerTreasury<USDC>,
    collection_obj: &SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let collection_id = object::id(collection_obj);
    assert!(listing.collection_id.contains(&collection_id), ECollectionMismatch);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    buy_animacraft_soul_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        soul_policy,
        provenance,
        maker,
        maker_treasury,
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

public fun buy_animacraft_soul_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    maker: &OCMaker,
    maker_treasury: &mut MakerTreasury<USDC>,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let seller = listing.seller;
    assert!(listing.collection_id.is_none(), ECollectionMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    buy_animacraft_soul_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        soul_policy,
        provenance,
        maker,
        maker_treasury,
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

public fun buy_animacraft_soul_fixed_price_with_collection_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    maker: &OCMaker,
    maker_treasury: &mut MakerTreasury<USDC>,
    collection_obj: &SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    let collection_id = object::id(collection_obj);
    assert!(listing.collection_id.contains(&collection_id), ECollectionMismatch);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    buy_animacraft_soul_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        soul_policy,
        provenance,
        maker,
        maker_treasury,
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

/// Dedicated v5 counterpart to `list_animacraft_v5_soul_fixed_price_v2`.
/// Payment is exactly the listed gross price; no generic or v4 purchase
/// function can settle this listing because both provenance and listing
/// versions are checked before the kiosk purchase cap is consumed.
public fun buy_animacraft_v5_soul_fixed_price_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert_legacy_listing_has_no_v6_appearance(state);
    buy_animacraft_v5_soul_fixed_price_impl(
        config.secondary_enabled,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        soul_policy,
        provenance,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        listing,
        payment,
        ctx,
    )
}

public fun buy_animacraft_v5_soul_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert_legacy_listing_has_no_v6_appearance(state);
    buy_animacraft_v5_soul_fixed_price_impl(
        config.secondary_enabled,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        soul_policy,
        provenance,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        listing,
        payment,
        ctx,
    )
}

fun buy_animacraft_v5_soul_fixed_price_impl(
    secondary_enabled: bool,
    fee_recipient: address,
    platform_fee_bps: u16,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(secondary_enabled, ESecondaryPausedV2);
    assert!(platform_fee_bps == ANIMACRAFT_V5_PROTOCOL_FEE_BPS, EAnimacraftV5ProtocolFeeMismatch);
    assert!(listing.version == MARKET_VERSION_ANIMACRAFT_V5, EAnimacraftV5ListingMismatch);
    assert!(listing.collection_id.is_none(), ECollectionMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v5_commerce_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(listing.is_active, EInactiveListing);
    assert!(listing.state_id == object::id(state), EListingStateMismatch);
    assert!(listing.soul_id == soul::soul_id(state), EListingStateMismatch);
    assert!(listing.creator == soul::state_creator(state), EListingStateMismatch);
    assert!(
        listing.creator_royalty_bps == soul::creator_royalty_bps(state),
        EAnimacraftV5CreatorRoyaltyMismatch,
    );
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(seller_kiosk) == listing.seller, EListingSellerMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let maker_source_royalty_bps = animacraft_provenance::royalty_bps(provenance);
    // v5 source royalties belong to the original Maker author frozen into
    // immutable provenance at canonical mint. They must not follow a later
    // Maker operator, Maker transfer, or caller-supplied treasury object.
    let maker_source_recipient = animacraft_provenance::maker_creator(provenance);
    let purchase_cap = take_soul_purchase_cap(listing);
    let (soul_obj, request) = kiosk::purchase_with_cap<Soul>(
        seller_kiosk,
        purchase_cap,
        coin::zero<SUI>(ctx),
    );
    assert!(object::id(&soul_obj) == listing.soul_id, EListingSoulMismatch);

    let (seller_payout, protocol_fee, soul_creator_royalty, maker_source_royalty) =
        settle_animacraft_v5_payment(
            payment,
            listing.price,
            fee_recipient,
            listing.creator,
            maker_source_recipient,
            listing.seller,
            state,
            maker_source_royalty_bps,
            ctx,
        );
    finish_animacraft_soul_purchase(
        registry,
        soul_policy,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        soul_obj,
        request,
        ctx,
    );

    listing.is_active = false;
    event::emit(AnimacraftV5SoulPurchased {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        provenance_id: animacraft_provenance::provenance_id(provenance),
        seller: listing.seller,
        buyer: ctx.sender(),
        maker_source_recipient,
        price: listing.price,
        seller_payout,
        protocol_fee,
        soul_creator_royalty_bps: listing.creator_royalty_bps,
        soul_creator_royalty,
        maker_source_royalty_bps,
        maker_source_royalty,
    });
}

/// Dedicated v6 settlement. The v6 listing owns the kiosk purchase cap, so no
/// immutable old buy function can consume it without synchronizing ownership.
public fun buy_animacraft_v6_soul_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    composition_registry: &CompositionRegistryV6,
    composition_config: &CompositionProtocolConfigV6,
    commerce_config: &CommerceProtocolConfigV5,
    profile: &MakerProfileV6,
    root: &MakerRootV5,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    appearance: &mut SoulAppearanceStateV6,
    listing: &mut AnimacraftV6SoulListing,
    selections: vector<LoadoutSelectionV6>,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    appearance_adapter_v6::assert_secondary_market_appearance_v6(
        composition_registry,
        composition_config,
        profile,
        root,
        commerce_config,
        state,
        appearance,
        &selections,
    );
    buy_animacraft_v6_soul_fixed_price_impl(
        config,
        registry,
        soul_policy,
        provenance,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        appearance,
        listing,
        payment,
        ctx,
    );
}

fun buy_animacraft_v6_soul_fixed_price_impl(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    appearance: &mut SoulAppearanceStateV6,
    listing: &mut AnimacraftV6SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert_animacraft_v6_listing(
        state,
        appearance,
        listing,
    );
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(config.platform_fee_bps == ANIMACRAFT_V5_PROTOCOL_FEE_BPS, EAnimacraftV5ProtocolFeeMismatch);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v5_commerce_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(seller_kiosk) == listing.seller, EListingSellerMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let maker_source_royalty_bps = animacraft_provenance::royalty_bps(provenance);
    let maker_source_recipient = animacraft_provenance::maker_creator(provenance);
    let purchase_cap = take_animacraft_v6_soul_purchase_cap(listing);
    let (soul_obj, request) = kiosk::purchase_with_cap<Soul>(
        seller_kiosk,
        purchase_cap,
        coin::zero<SUI>(ctx),
    );
    assert!(object::id(&soul_obj) == listing.soul_id, EListingSoulMismatch);

    let (seller_payout, protocol_fee, soul_creator_royalty, maker_source_royalty) =
        settle_animacraft_v5_payment(
            payment,
            listing.price,
            config.fee_recipient,
            soul::state_creator(state),
            maker_source_recipient,
            listing.seller,
            state,
            maker_source_royalty_bps,
            ctx,
        );
    finish_animacraft_soul_purchase(
        registry,
        soul_policy,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        soul_obj,
        request,
        ctx,
    );

    let previous_ownership_epoch = listing.ownership_epoch;
    let appearance_revision = listing.appearance_revision;
    appearance_v6::sync_ownership_after_transfer(
        state,
        appearance,
        appearance_revision,
    );
    listing.is_active = false;
    event::emit(AnimacraftV5SoulPurchased {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        provenance_id: animacraft_provenance::provenance_id(provenance),
        seller: listing.seller,
        buyer: ctx.sender(),
        maker_source_recipient,
        price: listing.price,
        seller_payout,
        protocol_fee,
        soul_creator_royalty_bps: soul::creator_royalty_bps(state),
        soul_creator_royalty,
        maker_source_royalty_bps,
        maker_source_royalty,
    });
    event::emit(AnimacraftV6SoulPurchased {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        appearance_state_id: listing.appearance_state_id,
        appearance_revision,
        previous_ownership_epoch,
        ownership_epoch: soul::ownership_epoch(state),
        buyer: ctx.sender(),
    });
}

#[test_only]
public fun buy_animacraft_v6_soul_fixed_price_for_testing(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    appearance: &mut SoulAppearanceStateV6,
    listing: &mut AnimacraftV6SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    buy_animacraft_v6_soul_fixed_price_impl(
        config,
        registry,
        soul_policy,
        provenance,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        appearance,
        listing,
        payment,
        ctx,
    );
}

/// Dedicated physical-v7 settlement. Unlocking the wardrobe, transferring the
/// Soul, rotating the canonical owner and clearing the listing are one atomic
/// PTB. No independent wardrobe-unlock transaction is exposed.
public fun buy_animacraft_v7_soul_fixed_price_v7(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    physical_config: &PhysicalProtocolConfigV7,
    physical_profile: &MakerPhysicalProfileV7,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    wardrobe: &mut SoulWardrobeV7,
    listing: &mut AnimacraftV7SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert_animacraft_v7_listing(state, wardrobe, physical_profile, listing);
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(config.platform_fee_bps == ANIMACRAFT_V5_PROTOCOL_FEE_BPS, EAnimacraftV5ProtocolFeeMismatch);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v5_commerce_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(seller_kiosk) == listing.seller, EListingSellerMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    let maker_source_royalty_bps = animacraft_provenance::royalty_bps(provenance);
    let maker_source_recipient = animacraft_provenance::maker_creator(provenance);
    let previous_wardrobe_revision = listing.wardrobe_revision;
    physical_v7::set_wardrobe_listed_v7(
        wardrobe,
        physical_config,
        physical_profile,
        listing.soul_id,
        false,
        PhysicalWardrobeListingProofV7 {},
        previous_wardrobe_revision,
    );
    physical_v7::assert_wardrobe_transferable_v7(wardrobe, physical_profile);
    let purchase_cap = take_animacraft_v7_soul_purchase_cap(listing);
    let (soul_obj, request) = kiosk::purchase_with_cap<Soul>(
        seller_kiosk,
        purchase_cap,
        coin::zero<SUI>(ctx),
    );
    assert!(object::id(&soul_obj) == listing.soul_id, EListingSoulMismatch);

    let (seller_payout, protocol_fee, soul_creator_royalty, maker_source_royalty) =
        settle_animacraft_v5_payment(
            payment,
            listing.price,
            config.fee_recipient,
            soul::state_creator(state),
            maker_source_recipient,
            listing.seller,
            state,
            maker_source_royalty_bps,
            ctx,
        );
    finish_animacraft_soul_purchase(
        registry,
        soul_policy,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        state,
        soul_obj,
        request,
        ctx,
    );

    listing.is_active = false;
    event::emit(AnimacraftV5SoulPurchased {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        provenance_id: animacraft_provenance::provenance_id(provenance),
        seller: listing.seller,
        buyer: ctx.sender(),
        maker_source_recipient,
        price: listing.price,
        seller_payout,
        protocol_fee,
        soul_creator_royalty_bps: soul::creator_royalty_bps(state),
        soul_creator_royalty,
        maker_source_royalty_bps,
        maker_source_royalty,
    });
}

public fun list_collection_right_fixed_price(
    config: &MarketConfig,
    registry: &KioskRegistry,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    price: u64,
    ctx: &mut TxContext,
): CollectionListing {
    assert!(!config.paused, EMarketPaused);
    assert!(price > 0, EInvalidPrice);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    collection::assert_tradeable(collection_obj);
    assert!(collection::current_holder(collection_obj) == ctx.sender(), ESoulOwnerMismatch);
    assert!(collection::current_holder_kiosk_id(collection_obj) == object::id(kiosk_obj), ECollectionMismatch);

    let right_id = collection::right_id(collection_obj);
    let seller = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, seller, kiosk_id, object::id(personal_kiosk_cap));

    let listing = create_collection_listing(kiosk_obj, personal_kiosk_cap, collection_obj, right_id, price, ctx);
    let listing_id = object::id(&listing);

    event::emit(CollectionListed {
        listing_id,
        collection_id: object::id(collection_obj),
        right_id,
        seller,
        kiosk_id,
        price,
    });

    listing
}

/// Unified-v2 collection listing entrypoint. Existing v1 listings keep the
/// same `CollectionListing` shape and can be cancelled or settled through the
/// v2 paths after the legacy market is retired.
public fun list_collection_right_fixed_price_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    price: u64,
    ctx: &mut TxContext,
): CollectionListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(price > 0, EInvalidPrice);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    collection::assert_tradeable(collection_obj);
    assert!(collection::current_holder(collection_obj) == ctx.sender(), ESoulOwnerMismatch);
    assert!(collection::current_holder_kiosk_id(collection_obj) == object::id(kiosk_obj), ECollectionMismatch);

    let right_id = collection::right_id(collection_obj);
    let seller = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, seller, kiosk_id, object::id(personal_kiosk_cap));

    let listing = create_collection_listing(kiosk_obj, personal_kiosk_cap, collection_obj, right_id, price, ctx);
    let listing_id = object::id(&listing);

    event::emit(CollectionListed {
        listing_id,
        collection_id: object::id(collection_obj),
        right_id,
        seller,
        kiosk_id,
        price,
    });

    listing
}

public fun list_collection_right_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    collection_obj: &SoulCollection,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    price: u64,
    ctx: &mut TxContext,
): CollectionListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(price > 0, EInvalidPrice);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    collection::assert_tradeable(collection_obj);
    assert!(collection::current_holder(collection_obj) == ctx.sender(), ESoulOwnerMismatch);
    assert!(collection::current_holder_kiosk_id(collection_obj) == object::id(kiosk_obj), ECollectionMismatch);

    let right_id = collection::right_id(collection_obj);
    let seller = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, seller, kiosk_id, object::id(personal_kiosk_cap));
    let listing = create_collection_listing(
        kiosk_obj,
        personal_kiosk_cap,
        collection_obj,
        right_id,
        price,
        ctx,
    );
    let listing_id = object::id(&listing);
    event::emit(CollectionListed {
        listing_id,
        collection_id: object::id(collection_obj),
        right_id,
        seller,
        kiosk_id,
        price,
    });
    listing
}

public fun cancel_collection_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut CollectionListing,
) {
    assert!(listing.is_active, EInactiveListing);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(object::id(kiosk_obj) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(kiosk_obj) == listing.seller, EKioskOwnerMismatch);

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
    registry: &KioskRegistry,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    collection_obj: &mut SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut CollectionListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    buy_collection_right_fixed_price_impl(
        config.paused,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        collection_policy,
        collection_obj,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        listing,
        payment,
        ctx,
    );
}

/// Unified-v2 settlement path for both newly-created v2 listings and active
/// collection listings that existed before the irreversible v1 retirement.
public fun buy_collection_right_fixed_price_v2(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    collection_obj: &mut SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut CollectionListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    buy_collection_right_fixed_price_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        collection_policy,
        collection_obj,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        listing,
        payment,
        ctx,
    );
}

public fun buy_collection_right_fixed_price_v6(
    config: &MarketConfigV6,
    registry: &KioskRegistry,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    collection_obj: &mut SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut CollectionListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    buy_collection_right_fixed_price_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        registry,
        collection_policy,
        collection_obj,
        seller_kiosk,
        buyer_kiosk,
        buyer_personal_kiosk_cap,
        listing,
        payment,
        ctx,
    );
}

fun buy_collection_right_fixed_price_impl(
    market_paused: bool,
    fee_recipient: address,
    platform_fee_bps: u16,
    registry: &KioskRegistry,
    collection_policy: &TransferPolicy<SoulCollectionRight>,
    collection_obj: &mut SoulCollection,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut CollectionListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(!market_paused, EMarketPaused);
    assert!(listing.is_active, EInactiveListing);
    assert!(listing.collection_id == object::id(collection_obj), ECollectionMismatch);
    assert!(listing.right_id == collection::right_id(collection_obj), ECollectionRightMismatch);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(seller_kiosk) == listing.seller, EListingSellerMismatch);
    assert!(kiosk::has_access(buyer_kiosk, personal_kiosk::borrow(buyer_personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(personal_kiosk::owner(buyer_kiosk) == ctx.sender(), EKioskOwnerMismatch);
    collection::assert_tradeable(collection_obj);

    let buyer_kiosk_id = object::id(buyer_kiosk);
    assert_registered_personal_kiosk(
        registry,
        ctx.sender(),
        buyer_kiosk_id,
        object::id(buyer_personal_kiosk_cap),
    );

    let price = listing.price;
    let platform_fee = bps_amount(price, platform_fee_bps);
    let total_u128 = (price as u128) + (platform_fee as u128);
    assert!(total_u128 <= MAX_U64_AS_U128, EQuoteOverflow);
    let total = total_u128 as u64;
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
        transfer::public_transfer(fee_payment, fee_recipient);
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

// ── Paid-access purchase ──────────────────────────────────────────────
//
// Paid access is an **owner-revocable subscription**, not a perpetual or
// term-guaranteed license:
//
// - The owner may revoke a buyer's `(grantee, kind)` entry at any time via
//   `paid_access::revoke_access`; no on-chain refund is issued.
// - Underlying content can still be soft-deleted (`content::delete_*`) or
//   permanently purged (`content::purge_deleted_*`) by the owner; once
//   purged, the Walrus blob is burned even if active paid entries exist.
// - `SoulPaidAccessRevoked` / `ContentVersionDeleted` / `ContentVersionPurged`
//   events let buyer-side indexers detect the situation and notify users;
//   any refund or credit policy must run off-chain.
//
// Surfaces that take payment for a kind MUST disclose this trust boundary
// (see CLAUDE.md `System Invariants`). Promoting paid access to a guaranteed
// term would require introducing slot-level receipts, a delete-lock window,
// or an explicit refund rail.
public fun purchase_paid_access(
    config: &MarketConfig,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    payment: Coin<USDC>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    purchase_paid_access_impl(
        config.paused,
        config.fee_recipient,
        config.platform_fee_bps,
        paid_access_list,
        state,
        kind,
        payment,
        clock,
        ctx,
    );
}

public fun purchase_paid_access_v2(
    config: &MarketConfigV2,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    payment: Coin<USDC>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    purchase_paid_access_impl(
        false,
        config.fee_recipient,
        config.platform_fee_bps,
        paid_access_list,
        state,
        kind,
        payment,
        clock,
        ctx,
    );
}

fun purchase_paid_access_impl(
    market_paused: bool,
    fee_recipient: address,
    platform_fee_bps: u16,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    payment: Coin<USDC>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!market_paused, EMarketPaused);
    assert!(paid_access::soul_id(paid_access_list) == soul::soul_id(state), EAccessListStateMismatch);
    assert!(
        soul::access_list_id(state).contains(&object::id(paid_access_list)),
        EAccessListLinkageMismatch,
    );
    assert!(paid_access::has_kind_config(paid_access_list, kind), EPaidAccessKindMismatch);

    let price = paid_access::kind_config_price_atomic(paid_access_list, kind);
    assert!(price > 0, EPaidAccessNotPurchasable);
    assert!(ctx.sender() != soul::current_owner(state), EPaidAccessOwnerCannotPurchase);
    let platform_fee = bps_amount(price, platform_fee_bps);
    let total_u128 = (price as u128) + (platform_fee as u128);
    assert!(total_u128 <= MAX_U64_AS_U128, EQuoteOverflow);
    let total = total_u128 as u64;
    assert!(payment.value() == total, EIncorrectPaymentAmount);

    let payment_recipient = soul::current_owner(state);
    let mut owner_payment = payment;
    if (platform_fee > 0) {
        let fee = coin::split(&mut owner_payment, platform_fee, ctx);
        transfer::public_transfer(fee, fee_recipient);
    };
    transfer::public_transfer(owner_payment, payment_recipient);

    let buyer = ctx.sender();
    paid_access::record_purchase(paid_access_list, state, buyer, kind, price, clock, ctx);

    event::emit(SoulPaidAccessPurchased {
        soul_id: soul::soul_id(state),
        paid_access_list_id: object::id(paid_access_list),
        buyer,
        price,
        platform_fee,
        payment_recipient,
    });
}

// ── Paid-access per-kind config wrappers ──────────────────────────────

public fun configure_paid_access_kind(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    price_atomic: u64,
    scope_mask: u64,
    duration_ms: Option<u64>,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    paid_access::configure_paid_access_kind(
        paid_access_list,
        state,
        kind_registry_obj,
        kind,
        price_atomic,
        scope_mask,
        duration_ms,
        ctx,
    );
}

public fun configure_paid_access_kind_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    price_atomic: u64,
    scope_mask: u64,
    duration_ms: Option<u64>,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    paid_access::configure_paid_access_kind(
        paid_access_list,
        state,
        kind_registry_obj,
        kind,
        price_atomic,
        scope_mask,
        duration_ms,
        ctx,
    );
}

public fun update_paid_access_kind(
    config: &MarketConfig,
    kind_registry_obj: &KindRegistry,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    price_atomic: u64,
    scope_mask: u64,
    duration_ms: Option<u64>,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    paid_access::update_paid_access_kind(
        paid_access_list,
        state,
        kind_registry_obj,
        kind,
        price_atomic,
        scope_mask,
        duration_ms,
        ctx,
    );
}

public fun update_paid_access_kind_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    price_atomic: u64,
    scope_mask: u64,
    duration_ms: Option<u64>,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    paid_access::update_paid_access_kind(
        paid_access_list,
        state,
        kind_registry_obj,
        kind,
        price_atomic,
        scope_mask,
        duration_ms,
        ctx,
    );
}

public fun delete_paid_access_kind(
    config: &MarketConfig,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    ctx: &TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    paid_access::delete_paid_access_kind(paid_access_list, state, kind, ctx);
}

public fun delete_paid_access_kind_v2(
    config: &MarketConfigV2,
    paid_access_list: &mut SoulPaidAccessList,
    state: &SoulState,
    kind: u32,
    ctx: &TxContext,
) {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    paid_access::delete_paid_access_kind(paid_access_list, state, kind, ctx);
}

// ── Listing storage cleanup ───────────────────────────────────────────

/// Reclaim storage for a fully-settled `SoulListing` (cancelled or purchased).
/// Any caller may invoke this — invalidated listings carry no value and
/// leaving them shared indefinitely only wastes on-chain storage rebate.
public fun delete_soul_listing(listing: SoulListing, ctx: &TxContext) {
    assert!(!listing.is_active, EListingStillActive);
    let listing_id = object::id(&listing);
    let SoulListing {
        id,
        version: _,
        soul_id,
        state_id: _,
        seller,
        seller_kiosk_id: _,
        price: _,
        creator: _,
        creator_royalty_bps: _,
        collection_id: _,
        purchase_cap,
        is_active: _,
    } = listing;
    purchase_cap.destroy_none();
    id.delete();
    event::emit(SoulListingDeleted {
        listing_id,
        soul_id,
        seller,
        deleted_by: ctx.sender(),
    });
}

public fun delete_animacraft_v6_soul_listing(
    listing: AnimacraftV6SoulListing,
    ctx: &TxContext,
) {
    assert!(!listing.is_active, EListingStillActive);
    let listing_id = object::id(&listing);
    let AnimacraftV6SoulListing {
        id,
        version: _,
        soul_id,
        state_id: _,
        seller,
        seller_kiosk_id: _,
        price: _,
        creator: _,
        creator_royalty_bps: _,
        purchase_cap,
        appearance_state_id: _,
        appearance_revision: _,
        ownership_epoch: _,
        loadout_hash: _,
        transfer_safe: _,
        is_active: _,
    } = listing;
    purchase_cap.destroy_none();
    id.delete();
    event::emit(SoulListingDeleted {
        listing_id,
        soul_id,
        seller,
        deleted_by: ctx.sender(),
    });
}

public fun delete_animacraft_v7_soul_listing(
    listing: AnimacraftV7SoulListing,
    ctx: &TxContext,
) {
    assert!(!listing.is_active, EListingStillActive);
    let listing_id = object::id(&listing);
    let AnimacraftV7SoulListing {
        id,
        soul_id,
        seller,
        seller_kiosk_id: _,
        price: _,
        purchase_cap,
        wardrobe_id: _,
        wardrobe_revision: _,
        ownership_epoch: _,
        is_active: _,
    } = listing;
    purchase_cap.destroy_none();
    id.delete();
    event::emit(SoulListingDeleted {
        listing_id,
        soul_id,
        seller,
        deleted_by: ctx.sender(),
    });
}

/// Reclaim storage for a fully-settled `CollectionListing`.
public fun delete_collection_listing(listing: CollectionListing, ctx: &TxContext) {
    assert!(!listing.is_active, EListingStillActive);
    let listing_id = object::id(&listing);
    let CollectionListing {
        id,
        version: _,
        collection_id,
        right_id: _,
        seller,
        seller_kiosk_id: _,
        price: _,
        purchase_cap,
        is_active: _,
    } = listing;
    purchase_cap.destroy_none();
    id.delete();
    event::emit(CollectionListingDeleted {
        listing_id,
        collection_id,
        seller,
        deleted_by: ctx.sender(),
    });
}

// ── Mint impl (typed-content) ─────────────────────────────────────────

fun mint_soul_in_personal_kiosk_impl(
    market_paused: bool,
    platform_fee_bps: u16,
    kind_registry_obj: &KindRegistry,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    creator_royalty_bps: u16,
    provenance_kind: u8,
    origin_ref: Option<String>,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(!market_paused, EMarketPaused);
    assert!(
        ((platform_fee_bps as u64) + (creator_royalty_bps as u64)) <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);

    // Phase 2 invariant: every mint must include the SOUL_DOC and at least
    // one MEMORY entry. Validate before consuming any blobs so the caller
    // gets back malformed PTBs cleanly (blobs stay owned by them).
    assert_initial_content_well_formed(kind_registry_obj, &initial_content);

    let owner = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, owner, kiosk_id, object::id(personal_kiosk_cap));

    let soul_obj = soul::mint(
        name,
        description,
        image_url,
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
    let state_id = object::id(&state);

    let mut content_obj = content::create(soul_id, ctx);
    let content_id = object::id(&content_obj);
    soul::set_content_id(&mut state, content_id);

    apply_initial_state_config(&mut state, initial_state_config, owner);
    apply_initial_content_entries(
        &mut content_obj,
        &state,
        kind_registry_obj,
        initial_content,
        clock,
        ctx,
    );
    // Mint-time invariant: SOUL_DOC v0 + MEMORY v0 must be bound before
    // the SoulState becomes visible. Any deviation aborts the whole tx.
    content::assert_initial_content_complete(&state, &content_obj);

    let paid_access_list = paid_access::create(soul_id, owner, ctx);
    soul::set_access_list_id(&mut state, object::id(&paid_access_list));
    paid_access::share_paid_access_list(paid_access_list);

    content::share_content(content_obj);

    kiosk::lock<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_policy,
        soul_obj,
    );

    soul::emit_created_after_content_bound(&state, provenance_kind);
    event::emit(SoulMintedToKiosk {
        soul_id,
        state_id,
        content_id,
        kiosk_id,
        owner,
        provenance_kind,
    });

    state
}

fun apply_initial_state_config(
    state: &mut SoulState,
    initial_state_config: vector<StateConfigEntry>,
    updater: address,
) {
    let mut entries = initial_state_config;
    while (!entries.is_empty()) {
        let entry = entries.pop_back();
        let StateConfigEntry { key, value } = entry;
        assert!(!std::string::is_empty(&key), EStateConfigKeyEmpty);
        let key_for_event = copy key;
        soul::upsert_state_config(state, key, value);
        soul::emit_state_config_upserted(state, updater, key_for_event);
    };
    entries.destroy_empty();
}

fun apply_initial_content_entries(
    content_obj: &mut SoulContent,
    state: &SoulState,
    kind_registry_obj: &KindRegistry,
    initial_content: vector<InitialContentEntry>,
    clock: &Clock,
    ctx: &TxContext,
) {
    let kind_soul_doc = kind_registry::kind_soul_doc();
    let kind_memory = kind_registry::kind_memory();

    // Forward iteration so version_index assignment is predictable for
    // callers (lower indices appended first).
    let mut entries = initial_content;
    entries.reverse();
    while (!entries.is_empty()) {
        let entry = entries.pop_back();
        let InitialContentEntry {
            kind,
            name,
            slot_read_mode_mask,
            download_policy,
            set_active,
            blob,
        } = entry;

        if (set_active) {
            // Reject `set_active=true` for kinds that don't support active
            // binding here — failing inside `content::set_active` would be
            // less helpful at the wallet boundary.
            let descriptor = kind_registry::borrow_descriptor(kind_registry_obj, kind);
            assert!(
                kind_registry::descriptor_has_active_binding(descriptor),
                EInitialEntryActiveNotSupported,
            );
        };

        let version_index = if (kind == kind_soul_doc || kind == kind_memory) {
            // SOUL_DOC and MEMORY bypass the OP_APPEND gate (SOUL_DOC's
            // descriptor declares op_mask=0 by design; MEMORY's founding
            // entry must always be appendable at mint time even if
            // OP_APPEND is later restricted).
            content::append_initial_invariant_version(
                content_obj,
                kind_registry_obj,
                kind,
                copy name,
                slot_read_mode_mask,
                download_policy,
                blob,
                clock,
            )
        } else {
            content::append_initial_user_version(
                content_obj,
                kind_registry_obj,
                kind,
                copy name,
                slot_read_mode_mask,
                download_policy,
                blob,
                clock,
            )
        };

        if (set_active) {
            // Mint flow uses owner-as-sender semantics; `set_active` only
            // requires `state` for mismatch checks here, no owner assertion.
            // Wallet-callable variants flow through `set_active_content`.
            content::set_active(content_obj, state, kind_registry_obj, kind, name, version_index, ctx);
        };
    };
    entries.destroy_empty();
}

/// Wallet-boundary preflight: enforces exactly one `(KIND_SOUL_DOC, "soul")`
/// entry and at least one `(KIND_MEMORY, "default")` entry across the
/// `initial_content` vector. Custom kinds in `initial_content` must have
/// `OP_APPEND` set in their descriptor — otherwise the user could seed
/// content into a kind that later forbids appends, escaping the op gate.
fun assert_initial_content_well_formed(
    registry: &KindRegistry,
    entries: &vector<InitialContentEntry>,
) {
    let kind_soul_doc = kind_registry::kind_soul_doc();
    let kind_memory = kind_registry::kind_memory();
    let soul_doc_name = content::soul_doc_name();
    let memory_name = content::memory_name();

    let mut soul_doc_count: u64 = 0;
    let mut memory_count: u64 = 0;
    let len = entries.length();
    let mut i = 0;
    while (i < len) {
        let entry = vector::borrow(entries, i);
        let entry_kind = initial_entry_kind(entry);
        let entry_name = initial_entry_name(entry);
        if (entry_kind == kind_soul_doc) {
            assert!(entry_name == &soul_doc_name, EInitialSoulDocNameMismatch);
            soul_doc_count = soul_doc_count + 1;
        } else if (entry_kind == kind_memory) {
            assert!(entry_name == &memory_name, EInitialMemoryNameMismatch);
            memory_count = memory_count + 1;
        } else {
            let descriptor = kind_registry::borrow_descriptor(registry, entry_kind);
            assert!(
                kind_registry::descriptor_op_mask(descriptor) & kind_registry::op_append() != 0,
                EInitialKindOpNotAllowedAtMint,
            );
        };
        i = i + 1;
    };
    assert!(soul_doc_count == 1, EInitialSoulDocCountMismatch);
    assert!(memory_count >= 1, EInitialMemoryCountMismatch);
}

fun initial_entry_kind(entry: &InitialContentEntry): u32 {
    entry.kind
}

fun initial_entry_name(entry: &InitialContentEntry): &String {
    &entry.name
}

// ── Finalize wrappers ─────────────────────────────────────────────────

public fun finalize_soul_state(state: SoulState) {
    assert!(
        !soul::has_animacraft_physical_v7_profile(&state)
            || soul::has_animacraft_wardrobe_v7(&state),
        EAnimacraftV7WardrobeMissing,
    );
    soul::share_state(state)
}

public fun finalize_collection(collection_obj: SoulCollection) {
    collection::share_collection(collection_obj)
}

public fun finalize_soul_listing(listing: SoulListing) {
    transfer::share_object(listing)
}

public fun finalize_animacraft_v6_soul_listing(
    listing: AnimacraftV6SoulListing,
) {
    transfer::share_object(listing)
}

public fun finalize_animacraft_v7_soul_listing(
    listing: AnimacraftV7SoulListing,
) {
    transfer::share_object(listing)
}

public fun finalize_collection_listing(listing: CollectionListing) {
    transfer::share_object(listing)
}

public fun finalize_soul_content(content_obj: SoulContent) {
    content::share_content(content_obj)
}

// ── Listing helpers ──────────────────────────────────────────────────

fun list_animacraft_soul_after_validation(
    config: &MarketConfig,
    registry: &KioskRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    collection_id: Option<ID>,
    collection_royalty_bps: u16,
    ctx: &mut TxContext,
): SoulListing {
    assert_legacy_listing_has_no_v6_appearance(state);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::current_owner(state) == ctx.sender(), ESoulOwnerMismatch);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), ESoulCurrentKioskMismatch);

    let soul_id = soul::soul_id(state);
    let seller = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, seller, kiosk_id, object::id(personal_kiosk_cap));

    let listing = create_soul_listing(
        config,
        kiosk_obj,
        personal_kiosk_cap,
        state,
        soul_id,
        price,
        collection_id,
        collection_royalty_bps,
        ctx,
    );
    let listing_id = object::id(&listing);
    soul::set_listed(state, true);

    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id,
        price,
    });

    listing
}

fun list_soul_after_validation_successor(
    secondary_enabled: bool,
    platform_fee_bps: u16,
    listing_version: u64,
    registry: &KioskRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    collection_id: Option<ID>,
    collection_royalty_bps: u16,
    ctx: &mut TxContext,
): SoulListing {
    assert_legacy_listing_has_no_v6_appearance(state);
    assert!(secondary_enabled, ESecondaryPausedV2);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::current_owner(state) == ctx.sender(), ESoulOwnerMismatch);
    assert!(soul::current_kiosk_id(state) == object::id(kiosk_obj), ESoulCurrentKioskMismatch);

    let soul_id = soul::soul_id(state);
    let seller = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, seller, kiosk_id, object::id(personal_kiosk_cap));

    assert!(price > 0, EInvalidPrice);
    let _soul_ref = kiosk::borrow<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_id,
    );
    let (_, _, _, _, _) = quote_soul_purchase_with_fee_bps(
        platform_fee_bps,
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
    let listing = SoulListing {
        id: object::new(ctx),
        version: listing_version,
        soul_id,
        state_id: object::id(state),
        seller,
        seller_kiosk_id: kiosk_id,
        price,
        creator: soul::state_creator(state),
        creator_royalty_bps: soul::creator_royalty_bps(state),
        collection_id,
        purchase_cap: option::some(purchase_cap),
        is_active: true,
    };
    let listing_id = object::id(&listing);
    soul::set_listed(state, true);

    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id,
        price,
    });

    listing
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
    assert_legacy_listing_has_no_v6_appearance(state);
    assert!(price > 0, EInvalidPrice);
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
        version: VERSION,
        soul_id,
        state_id: object::id(state),
        seller: personal_kiosk::owner(kiosk_obj),
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
        version: VERSION,
        collection_id: object::id(collection_obj),
        right_id,
        seller: personal_kiosk::owner(kiosk_obj),
        seller_kiosk_id: object::id(kiosk_obj),
        price,
        purchase_cap: option::some(purchase_cap),
        is_active: true,
    }
}

fun buy_soul_impl(
    market_paused: bool,
    fee_recipient: address,
    platform_fee_bps: u16,
    registry: &KioskRegistry,
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
    assert!(!market_paused, EMarketPaused);
    assert!(listing.is_active, EInactiveListing);
    assert!(listing.state_id == object::id(state), EListingStateMismatch);
    assert!(listing.soul_id == soul::soul_id(state), EListingStateMismatch);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(seller_kiosk) == listing.seller, EListingSellerMismatch);
    assert!(kiosk::has_access(buyer_kiosk, personal_kiosk::borrow(buyer_personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(personal_kiosk::owner(buyer_kiosk) == ctx.sender(), EKioskOwnerMismatch);

    let buyer_kiosk_id = object::id(buyer_kiosk);
    assert_registered_personal_kiosk(
        registry,
        ctx.sender(),
        buyer_kiosk_id,
        object::id(buyer_personal_kiosk_cap),
    );

    let (platform_fee, price, creator_royalty, collection_royalty, total) =
        quote_soul_purchase_with_fee_bps(
        platform_fee_bps,
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
        transfer::public_transfer(fee_payment, fee_recipient);
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
    soul::set_listed(state, false);
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

fun buy_animacraft_soul_impl(
    market_paused: bool,
    fee_recipient: address,
    platform_fee_bps: u16,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &AnimacraftProvenance,
    maker: &OCMaker,
    maker_treasury: &mut MakerTreasury<USDC>,
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
    assert!(!market_paused, EMarketPaused);
    assert!(listing.is_active, EInactiveListing);
    assert!(soul::has_animacraft_provenance(state), EAnimacraftAuthorizationMismatch);
    assert!(animacraft_provenance::is_v4_compatible(provenance), EAnimacraftV5CommercePathRequired);
    assert!(listing.state_id == object::id(state), EListingStateMismatch);
    assert!(listing.soul_id == soul::soul_id(state), EListingStateMismatch);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(seller_kiosk) == listing.seller, EListingSellerMismatch);
    assert!(listing.creator_royalty_bps == 0, EAnimacraftAuthorizationMismatch);
    assert!(soul::creator_royalty_bps(state) == 0, EAnimacraftAuthorizationMismatch);
    assert!(kiosk::has_access(buyer_kiosk, personal_kiosk::borrow(buyer_personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(personal_kiosk::owner(buyer_kiosk) == ctx.sender(), EKioskOwnerMismatch);
    animacraft_provenance::assert_matches_soul(provenance, state);
    animacraft_provenance::assert_matches_maker(provenance, maker, maker_treasury);

    let buyer_kiosk_id = object::id(buyer_kiosk);
    assert_registered_personal_kiosk(
        registry,
        ctx.sender(),
        buyer_kiosk_id,
        object::id(buyer_personal_kiosk_cap),
    );

    let maker_royalty_bps = animacraft_provenance::royalty_bps(provenance);
    let (platform_fee, price, maker_royalty, collection_royalty, total) =
        quote_animacraft_soul_purchase_with_fee_bps(
            platform_fee_bps,
            listing.price,
            maker_royalty_bps,
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
        transfer::public_transfer(fee_payment, fee_recipient);
    };
    if (maker_royalty > 0) {
        let royalty_payment = coin::split(&mut seller_payment, maker_royalty, ctx);
        animacraft::deposit_resale_royalty(
            animacraft_provenance::royalty_policy(provenance),
            maker,
            maker_treasury,
            royalty_payment,
            price,
            listing.soul_id,
            ctx,
        );
    };
    if (collection_royalty > 0 && collection_holder != listing.seller) {
        let collection_payment = coin::split(&mut seller_payment, collection_royalty, ctx);
        transfer::public_transfer(collection_payment, collection_holder);
    };
    transfer::public_transfer(seller_payment, listing.seller);

    grant::invalidate_all_for_owner_rotation(state, ctx.sender(), ctx.sender());
    soul::rotate_owner(state, ctx.sender(), buyer_kiosk_id);
    soul::set_listed(state, false);
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
        creator_royalty: maker_royalty,
        collection_royalty,
    });
    event::emit(AnimacraftSoulPurchased {
        listing_id: object::id(listing),
        soul_id: listing.soul_id,
        provenance_id: animacraft_provenance::provenance_id(provenance),
        maker_id: animacraft_provenance::maker_id(provenance),
        maker_treasury_id: animacraft_provenance::maker_treasury_id(provenance),
        seller: listing.seller,
        buyer: ctx.sender(),
        price,
        platform_fee,
        maker_royalty_bps,
        maker_royalty,
        collection_royalty,
    });
}

fun take_soul_purchase_cap(listing: &mut SoulListing): kiosk::PurchaseCap<Soul> {
    assert!(listing.purchase_cap.is_some(), EMissingPurchaseCap);
    option::extract(&mut listing.purchase_cap)
}

fun take_animacraft_v6_soul_purchase_cap(
    listing: &mut AnimacraftV6SoulListing,
): kiosk::PurchaseCap<Soul> {
    assert!(listing.purchase_cap.is_some(), EMissingPurchaseCap);
    option::extract(&mut listing.purchase_cap)
}

fun take_animacraft_v7_soul_purchase_cap(
    listing: &mut AnimacraftV7SoulListing,
): kiosk::PurchaseCap<Soul> {
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
    let numerator = (price as u128) * (bps as u128);
    if (numerator == 0) {
        return 0
    };
    (((numerator + 9_999) / 10_000) as u64)
}

fun floor_bps_amount(price: u64, bps: u16): u64 {
    (((price as u128) * (bps as u128) / 10_000) as u64)
}

fun payment_coin_type_name<PaymentCoin>(): String {
    string::from_ascii(type_name::with_defining_ids<PaymentCoin>().into_string())
}

fun register_personal_kiosk(
    registry: &mut KioskRegistry,
    owner: address,
    kiosk_id: ID,
    kiosk_cap_id: ID,
) {
    let key = PersonalKioskOwnerKey { owner };
    assert!(!df::exists(&registry.id, key), EPersonalKioskAlreadyInitialized);
    df::add(
        &mut registry.id,
        key,
        PersonalKioskRegistration {
            version: VERSION,
            kiosk_id,
            kiosk_cap_id,
        },
    );
}

/// Insert-or-assert: first registration inserts and emits
/// `PersonalKioskRegistrationUpdated`; subsequent calls must present the
/// same `(kiosk_id, kiosk_cap_id)` and become no-ops. Changing the
/// registration target is NOT allowed here — use `rebind_primary_kiosk`
/// instead, which also enforces that the old kiosk is empty so Souls
/// locked inside are not orphaned.
fun insert_or_assert_personal_kiosk_registration(
    registry: &mut KioskRegistry,
    owner: address,
    kiosk_id: ID,
    kiosk_cap_id: ID,
) {
    let key = PersonalKioskOwnerKey { owner };
    if (df::exists(&registry.id, key)) {
        let existing = df::borrow<PersonalKioskOwnerKey, PersonalKioskRegistration>(
            &registry.id,
            key,
        );
        assert!(existing.kiosk_id == kiosk_id, EPersonalKioskMismatch);
        assert!(existing.kiosk_cap_id == kiosk_cap_id, EPersonalKioskCapMismatch);
    } else {
        df::add(
            &mut registry.id,
            key,
            PersonalKioskRegistration {
                version: VERSION,
                kiosk_id,
                kiosk_cap_id,
            },
        );
        event::emit(PersonalKioskRegistrationUpdated {
            kiosk_id,
            kiosk_cap_id,
            owner,
        });
    };
}

fun borrow_personal_kiosk_registration(
    registry: &KioskRegistry,
    owner: address,
): &PersonalKioskRegistration {
    let key = PersonalKioskOwnerKey { owner };
    assert!(df::exists(&registry.id, key), EPersonalKioskNotInitialized);
    df::borrow<PersonalKioskOwnerKey, PersonalKioskRegistration>(&registry.id, key)
}

fun assert_registered_personal_kiosk(
    registry: &KioskRegistry,
    owner: address,
    kiosk_id: ID,
    kiosk_cap_id: ID,
) {
    let registration = borrow_personal_kiosk_registration(registry, owner);
    assert!(registration.kiosk_id == kiosk_id, EPersonalKioskMismatch);
    assert!(registration.kiosk_cap_id == kiosk_cap_id, EPersonalKioskCapMismatch);
}

/// Existing listing objects do not snapshot a v6 appearance revision and
/// therefore cannot safely trade a Soul with a mutable companion. All legacy,
/// v2, Animacraft-v4 and Animacraft-v5 creation helpers converge on this guard
/// or call it directly. A dedicated v6 listing must verify transfer safety and
/// pin the exact appearance revision before taking a purchase capability.
fun assert_legacy_listing_has_no_v6_appearance(state: &SoulState) {
    assert!(
        !soul::has_animacraft_appearance_v6(state),
        EAnimacraftV6ListingPathRequired,
    );
    assert!(
        !soul::has_animacraft_physical_v7_profile(state)
            && !soul::has_animacraft_wardrobe_v7(state),
        EAnimacraftV7WardrobeListingUnsupported,
    );
}

fun assert_animacraft_v6_listing(
    state: &SoulState,
    appearance: &SoulAppearanceStateV6,
    listing: &AnimacraftV6SoulListing,
) {
    assert!(listing.is_active, EAnimacraftV6ListingSnapshotInactive);
    assert!(
        listing.version == MARKET_VERSION_ANIMACRAFT_V6
            && listing.soul_id == soul::soul_id(state)
            && listing.state_id == object::id(state)
            && listing.appearance_state_id == object::id(appearance)
            && listing.creator == soul::state_creator(state)
            && listing.creator_royalty_bps == soul::creator_royalty_bps(state)
            && listing.transfer_safe,
        EAnimacraftV6ListingSnapshotMismatch,
    );
    appearance_v6::assert_active_listing_snapshot(
        state,
        appearance,
        listing.appearance_revision,
        listing.ownership_epoch,
        &listing.loadout_hash,
    );
}

fun assert_animacraft_v7_wardrobe_binding(
    state: &SoulState,
    wardrobe: &SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
) {
    assert!(
        soul::has_animacraft_physical_v7_profile(state)
            && soul::has_animacraft_wardrobe_v7(state)
            && soul::animacraft_wardrobe_v7_id(state)
                == physical_v7::wardrobe_id_v7(wardrobe)
            && soul::animacraft_physical_v7_profile_id(state)
                == physical_v7::physical_profile_id_v7(profile)
            && soul::animacraft_physical_v7_root_id(state)
                == physical_v7::wardrobe_root_id_v7(wardrobe)
            && physical_v7::wardrobe_profile_id_v7(wardrobe)
                == physical_v7::physical_profile_id_v7(profile)
            && physical_v7::wardrobe_soul_id_v7(wardrobe)
                == soul::soul_id(state),
        EAnimacraftV7ListingSnapshotMismatch,
    );
}

fun assert_animacraft_v7_listing(
    state: &SoulState,
    wardrobe: &SoulWardrobeV7,
    profile: &MakerPhysicalProfileV7,
    listing: &AnimacraftV7SoulListing,
) {
    assert!(listing.is_active, EAnimacraftV7ListingSnapshotInactive);
    assert_animacraft_v7_wardrobe_binding(state, wardrobe, profile);
    assert!(
        listing.soul_id == soul::soul_id(state)
            && listing.wardrobe_id == physical_v7::wardrobe_id_v7(wardrobe)
            && listing.wardrobe_revision
                == physical_v7::wardrobe_revision_v7(wardrobe)
            && listing.ownership_epoch == soul::ownership_epoch(state)
            && physical_v7::wardrobe_listed_v7(wardrobe),
        EAnimacraftV7ListingSnapshotMismatch,
    );
}

#[test_only]
public fun assert_legacy_listing_has_no_v6_appearance_for_testing(
    state: &SoulState,
) {
    assert_legacy_listing_has_no_v6_appearance(state);
}

// TransferPolicy must stay shared so admins can add/remove Kiosk rules later.
#[allow(lint(share_owned))]
fun init_impl(
    publisher: Publisher,
    admin: address,
    start_paused: bool,
    ctx: &mut TxContext,
) {
    let (mut soul_policy, soul_policy_cap) = transfer_policy::new<Soul>(&publisher, ctx);
    let (mut collection_policy, collection_policy_cap) =
        transfer_policy::new<SoulCollectionRight>(&publisher, ctx);
    let config = MarketConfig {
        id: object::new(ctx),
        version: VERSION,
        fee_recipient: admin,
        platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
        // Production passes `true`: a freshly published package family must
        // never become writable merely because the initializer ran.
        paused: start_paused,
    };
    let registry = KioskRegistry {
        id: object::new(ctx),
        version: VERSION,
    };
    let config_id = object::id(&config);
    let registry_id = object::id(&registry);
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
    transfer::share_object(registry);
    transfer::public_share_object(soul_policy);
    transfer::public_share_object(collection_policy);
    transfer::transfer(admin_cap, admin);
    transfer::public_transfer(soul_policy_cap, admin);
    transfer::public_transfer(collection_policy_cap, admin);
    publisher.burn();

    event::emit(MarketInitialized {
        config_id,
        registry_id,
        soul_policy_id,
        collection_policy_id,
        admin,
    });
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    // Unit tests explicitly opt into the historical active setup so existing
    // behavior tests can exercise market entrypoints. The production one-time
    // witness path above always starts paused.
    init_impl(package::claim(MARKET {}, ctx), recipient, false, ctx);
}

#[test_only]
public fun destroy_initial_content_entry_for_testing(entry: InitialContentEntry): Blob {
    let InitialContentEntry {
        kind: _,
        name: _,
        slot_read_mode_mask: _,
        download_policy: _,
        set_active: _,
        blob,
    } = entry;
    blob
}
