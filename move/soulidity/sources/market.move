module soulidity::market;

use animacraft_v8_core::maker_v8::{Self as maker_v8, MakerRootV8};
use animacraft_v8_core::protocol_config_v8::ProtocolConfigV8;
use animacraft_v8_core::soulidity_binding_v8;
use animacraft_v8_output::output_v8::{Self as output_v8, NativeSoulBindingV8, OutputRegistryV8, SoulRegistryV8, SoulMintAuthorizationV8};
use soulidity::animacraft_v8_binding;

use std::string::{Self as string, String};
use kiosk::kiosk_lock_rule;
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use kiosk::personal_kiosk_rule;
use kiosk::witness_rule;
use soulidity::collection::{Self as collection, SoulCollection, SoulCollectionRight};
use soulidity::content::{Self as content, SoulContent};
use soulidity::grant;
use soulidity::kind_registry::{Self as kind_registry, KindRegistry};
use soulidity::paid_access::{Self as paid_access, SoulPaidAccessList};
use soulidity::soul::{Self as soul, Soul, SoulState};
use sui::clock::Clock;
use sui::coin::{Self as coin, Coin};
use sui::dynamic_field as df;
use sui::derived_object;
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
/// Native resale deducts fixed 250bps and immutable Core rights from gross price.
const ANIMACRAFT_NATIVE_PROTOCOL_FEE_BPS: u16 = 250;

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
const EAnimacraftAuthorizationMismatch: u64 = 55;
const EAnimacraftPurchasePathRequired: u64 = 56;
const EAnimacraftListingPathRequired: u64 = 58;
const EPrimaryPausedV2: u64 = 60;
const ESecondaryPausedV2: u64 = 61;
const EAnimacraftNativeProtocolFeeMismatch: u64 = 63;
const EAnimacraftNativeCreatorRoyaltyMismatch: u64 = 67;
const EAnimacraftNativeV8BindingMismatch: u64 = 75;
const EAnimacraftNativeV8ListingMismatch: u64 = 76;
const EPaidAccessSnapshotMismatch: u64 = 77;
const ECollectionCommandSnapshotMismatch: u64 = 78;
const EMintNonceInvalid: u64 = 79;
const EMintContentIdentityMismatch: u64 = 80;
const EMintManifestHashInvalid: u64 = 81;
const EInitialEnvelopeConfigReserved: u64 = 82;
const VERSION: u64 = 1;
const MARKET_VERSION_V2: u64 = 2;
const MARKET_VERSION_ANIMACRAFT_V8: u64 = 8;

public struct MARKET has drop {}

public struct AnimacraftV8SoulPurchased has copy, drop {
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

/// Fresh production configuration. Primary and secondary gates start disabled
/// and require independent admin activation. The legacy_config_id BCS field is
/// reserved history: zero means this deployment has no predecessor or migration.
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

public struct KioskRegistry has key {
    id: UID,
    version: u64,
}

/// Domain-separated identity only; existing kiosk/owner rules authorize minting.
public struct ContentMintKeyV1 has copy, drop, store {
    author: address,
    nonce: vector<u8>,
}

/// Historical recovery commitment, NOT a new mint or Seal permission.
public struct MintManifestCommittedV1 has copy, drop {
    author: address,
    manifest_hash: vector<u8>,
}

public fun commit_mint_manifest(manifest_hash: vector<u8>, ctx: &TxContext) {
    assert!(manifest_hash.length() == 32, EMintManifestHashInvalid);
    event::emit(MintManifestCommittedV1 { author: ctx.sender(), manifest_hash });
}

public fun derive_mint_content_id(registry: &KioskRegistry, author: address, nonce: vector<u8>): ID {
    assert!(nonce.length() == 16, EMintNonceInvalid);
    object::id_from_address(derived_object::derive_address(object::id(registry), ContentMintKeyV1 { author, nonce }))
}

#[test]
fun mint_content_identity_matches_sdk_golden() {
    // Run in the coherent eight-package native-soul-test-graph (Soulidity 0x107),
    // not the historical Published.toml namespace. This is test-only identity;
    // production SDK callers must supply the certified deployment's type origin.
    assert!(@soulidity == @0x107, 98);
    let nonce = vector::tabulate!(16, |i| i as u8);
    assert!(derived_object::derive_address(object::id_from_address(@0x123),
        ContentMintKeyV1 { author: @0xA11, nonce }) ==
        @0x1d38c02388feceb85881c0338deb70131d59033e1adfda248d05d295c726bcc0, 99);
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
    expected_version_index: u64,
    encrypted_envelope: vector<u8>,
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

public struct MarketPrimaryGateV2Updated has copy, drop {
    enabled: bool,
}

public struct MarketSecondaryGateV2Updated has copy, drop {
    enabled: bool,
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
    init_fresh_impl(package::claim(otw, ctx), ctx.sender(), ctx)
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

/// A paid-access quote freezes fee, recipient and gates together. This guard
/// only reads config; existing business entrypoints retain their permissions.
public fun assert_paid_access_snapshot_v2(self: &MarketConfigV2, expected_bcs: vector<u8>) {
    assert!(std::bcs::to_bytes(self) == expected_bcs, EPaidAccessSnapshotMismatch);
}

/// Read-only approval preconditions. Existing collection entrypoints retain
/// all ownership, rights, registration and market permission checks.
public fun assert_collection_command_snapshot(self: &SoulCollection, expected_bcs: vector<u8>) {
    assert!(std::bcs::to_bytes(self) == expected_bcs, ECollectionCommandSnapshotMismatch);
}

public fun assert_collection_listing_snapshot(self: &CollectionListing, expected_bcs: vector<u8>) {
    assert!(std::bcs::to_bytes(self) == expected_bcs, ECollectionCommandSnapshotMismatch);
}

public fun assert_collection_market_snapshot_v2(self: &MarketConfigV2, expected_bcs: vector<u8>) {
    assert!(std::bcs::to_bytes(self) == expected_bcs, ECollectionCommandSnapshotMismatch);
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

// ── Initial entry constructors (callable by wallet PTBs) ──────────────

public fun new_initial_content_entry(
    kind: u32,
    name: String,
    slot_read_mode_mask: u64,
    download_policy: u8,
    set_active: bool,
    blob: Blob,
    expected_version_index: u64,
    encrypted_envelope: vector<u8>,
): InitialContentEntry {
    InitialContentEntry {
        kind,
        name,
        slot_read_mode_mask,
        download_policy,
        set_active,
        blob,
        expected_version_index,
        encrypted_envelope,
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

/// A native resale uses only its immutable DF9 provenance and Soul creator
/// snapshot. Current Maker operators and mutable treasuries have no royalty role.
public fun quote_animacraft_v8_soul_sale(
    state: &SoulState,
    provenance: &NativeSoulBindingV8,
    price: u64,
): (u64, u64, u64, u64) {
    assert_animacraft_native_v8_provenance(state, provenance);
    assert!(price > 0, EInvalidPrice);
    let rights = output_v8::native_soul_binding_rights_v8(provenance);
    // Core is the sole V8 rights authority: each rate may reach 1000bps,
    // with a combined rights pool of 1000bps, unlike the old V5 per-rate cap.
    maker_v8::assert_rights_snapshot_v8(rights);
    let protocol_fee = floor_bps_amount(price, ANIMACRAFT_NATIVE_PROTOCOL_FEE_BPS);
    let creator_royalty = floor_bps_amount(price, soul::creator_royalty_bps(state));
    let source_royalty = floor_bps_amount(price, maker_v8::rights_maker_source_royalty_bps_v2(rights));
    (price - protocol_fee - creator_royalty - source_royalty, protocol_fee, creator_royalty, source_royalty)
}

fun assert_animacraft_native_v8_provenance(
    state: &SoulState,
    provenance: &NativeSoulBindingV8,
) {
    assert!(soul::has_animacraft_native_v8_binding(state), EAnimacraftNativeV8BindingMismatch);
    assert!(soul::animacraft_native_v8_binding_id(state) == object::id(provenance)
        && output_v8::native_soul_binding_soul_id_v8(provenance) == soul::soul_id(state)
        && output_v8::native_soul_binding_state_id_v8(provenance) == object::id(state)
        && output_v8::native_soul_binding_original_holder_v8(provenance) == soul::state_creator(state),
        EAnimacraftNativeV8BindingMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    assert!(maker_v8::rights_soul_creator_royalty_bps_v2(
        output_v8::native_soul_binding_rights_v8(provenance)) == soul::creator_royalty_bps(state),
        EAnimacraftNativeCreatorRoyaltyMismatch);
}

/// The Soul alone moves between personal kiosks. Native Output/Receipt and DF9
/// provenance remain frozen; equipped components must be removed/closed first.
public fun list_animacraft_v8_soul_fixed_price(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    provenance: &NativeSoulBindingV8,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(config.platform_fee_bps == ANIMACRAFT_NATIVE_PROTOCOL_FEE_BPS, EAnimacraftNativeProtocolFeeMismatch);
    let (_, _, _, _) = quote_animacraft_v8_soul_sale(state, provenance, price);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(soul::current_owner(state) == ctx.sender()
        && personal_kiosk::owner(kiosk_obj) == ctx.sender(), ESoulOwnerMismatch);
    let kiosk_id = object::id(kiosk_obj);
    assert!(soul::current_kiosk_id(state) == kiosk_id, ESoulCurrentKioskMismatch);
    assert_registered_personal_kiosk(registry, ctx.sender(), kiosk_id, object::id(personal_kiosk_cap));
    let soul_id = soul::soul_id(state);
    let _soul_ref = kiosk::borrow<Soul>(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_id);
    // This preserves Soul's explicit equipment guard before creating custody.
    soul::set_listed(state, true);
    let purchase_cap = kiosk::list_with_purchase_cap<Soul>(
        kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap), soul_id, 0, ctx);
    let listing = SoulListing {
        id: object::new(ctx), version: MARKET_VERSION_ANIMACRAFT_V8,
        soul_id, state_id: object::id(state), seller: ctx.sender(), seller_kiosk_id: kiosk_id,
        price, creator: soul::state_creator(state), creator_royalty_bps: soul::creator_royalty_bps(state),
        collection_id: option::none(), purchase_cap: option::some(purchase_cap), is_active: true,
    };
    event::emit(SoulListed { listing_id: object::id(&listing), soul_id, seller: ctx.sender(), kiosk_id, price });
    listing
}

public fun buy_animacraft_v8_soul_fixed_price(
    config: &MarketConfigV2,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    provenance: &NativeSoulBindingV8,
    seller_kiosk: &mut Kiosk,
    buyer_kiosk: &mut Kiosk,
    buyer_personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
    payment: Coin<USDC>,
    ctx: &mut TxContext,
) {
    assert!(config.secondary_enabled, ESecondaryPausedV2);
    assert!(config.platform_fee_bps == ANIMACRAFT_NATIVE_PROTOCOL_FEE_BPS, EAnimacraftNativeProtocolFeeMismatch);
    assert_animacraft_native_v8_listing(state, listing);
    let (seller_payout, protocol_fee, soul_creator_royalty, maker_source_royalty) =
        quote_animacraft_v8_soul_sale(state, provenance, listing.price);
    assert!(payment.value() == listing.price, EIncorrectPaymentAmount);
    assert!(object::id(seller_kiosk) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(seller_kiosk) == listing.seller, EListingSellerMismatch);
    let maker_source_royalty_bps = maker_v8::rights_maker_source_royalty_bps_v2(
        output_v8::native_soul_binding_rights_v8(provenance));
    let maker_source_recipient = output_v8::native_soul_binding_maker_creator_v8(provenance);
    let purchase_cap = take_soul_purchase_cap(listing);
    let (soul_obj, request) = kiosk::purchase_with_cap<Soul>(seller_kiosk, purchase_cap, coin::zero<SUI>(ctx));
    assert!(object::id(&soul_obj) == listing.soul_id, EListingSoulMismatch);
    let mut seller_payment = payment;
    if (protocol_fee > 0) transfer::public_transfer(coin::split(&mut seller_payment, protocol_fee, ctx), config.fee_recipient);
    if (soul_creator_royalty > 0) transfer::public_transfer(coin::split(&mut seller_payment, soul_creator_royalty, ctx), listing.creator);
    if (maker_source_royalty > 0) transfer::public_transfer(coin::split(&mut seller_payment, maker_source_royalty, ctx), maker_source_recipient);
    transfer::public_transfer(seller_payment, listing.seller);
    finish_animacraft_soul_purchase(registry, soul_policy, buyer_kiosk, buyer_personal_kiosk_cap,
        state, soul_obj, request, ctx);
    listing.is_active = false;
    event::emit(AnimacraftV8SoulPurchased {
        listing_id: object::id(listing), soul_id: listing.soul_id, provenance_id: object::id(provenance),
        seller: listing.seller, buyer: ctx.sender(), maker_source_recipient, price: listing.price,
        seller_payout, protocol_fee, soul_creator_royalty_bps: listing.creator_royalty_bps,
        soul_creator_royalty, maker_source_royalty_bps, maker_source_royalty,
    });
}

fun assert_animacraft_native_v8_listing(state: &SoulState, listing: &SoulListing) {
    assert!(listing.version == MARKET_VERSION_ANIMACRAFT_V8, EAnimacraftNativeV8ListingMismatch);
    assert!(soul::has_animacraft_native_v8_binding(state), EAnimacraftNativeV8BindingMismatch);
    assert!(listing.is_active && soul::is_listed(state), EInactiveListing);
    assert!(listing.state_id == object::id(state) && listing.soul_id == soul::soul_id(state)
        && listing.creator == soul::state_creator(state), EListingStateMismatch);
    assert!(listing.creator_royalty_bps == soul::creator_royalty_bps(state), EAnimacraftNativeCreatorRoyaltyMismatch);
    assert!(listing.collection_id.is_none() && soul::collection_id(state).is_none(), ECollectionMismatch);
    assert!(listing.seller == soul::current_owner(state), ESoulOwnerMismatch);
    assert!(listing.seller_kiosk_id == soul::current_kiosk_id(state), ESoulCurrentKioskMismatch);
}

/// Returning the exact purchase capability is independent of all pause gates.
public fun cancel_animacraft_v8_soul_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
) {
    assert_animacraft_native_v8_listing(state, listing);
    cancel_soul_listing_impl(kiosk_obj, personal_kiosk_cap, state, listing)
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
    registry: &mut KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    creator_royalty_bps: u16,
    mint_nonce: vector<u8>,
    expected_content_id: ID,
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
        mint_nonce,
        expected_content_id,
        clock,
        ctx,
    )
}

/// A single native Soul is created from the one-use V8 Complete authorization.
/// The immutable V8 binding is provenance, not a second transferable Soul.
public fun mint_animacraft_v8_in_personal_kiosk<PaymentCoin>(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &mut KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    root: &MakerRootV8<PaymentCoin>,
    protocol: &ProtocolConfigV8,
    output_registry: &mut OutputRegistryV8,
    soul_registry: &mut SoulRegistryV8,
    authorization: SoulMintAuthorizationV8,
    name: String,
    description: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    mint_nonce: vector<u8>,
    expected_content_id: ID,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(config.primary_enabled, EPrimaryPausedV2);
    soulidity_binding_v8::assert_native_soul_v8<Soul>(protocol);
    assert!(personal_kiosk::owner(kiosk_obj) == ctx.sender(), EKioskOwnerMismatch);
    assert!(output_v8::soul_mint_authorization_holder_v8(&authorization) == ctx.sender(), EKioskOwnerMismatch);
    let authorization_commitment = *output_v8::soul_mint_authorization_commitment_v8(&authorization);
    // This is a transport reference, not a claim that protected bytes are public.
    let mut image_url = string::utf8(b"walrus://");
    image_url.append(*output_v8::soul_mint_authorization_render_blob_id_v8(&authorization));
    let rights = maker_v8::root_rights_v2(root);
    let mut state = mint_soul_in_personal_kiosk_impl(
        false, config.platform_fee_bps, kind_registry_obj, registry, soul_policy,
        kiosk_obj, personal_kiosk_cap, name, description, image_url,
        initial_content, initial_state_config,
        maker_v8::rights_soul_creator_royalty_bps_v2(&rights),
        soul::provenance_animacraft(), option::none(), mint_nonce, expected_content_id, clock, ctx,
    );
    let witness = animacraft_v8_binding::mint_witness(&state, authorization_commitment, ctx);
    let binding = output_v8::bind_native_soul_v8(
        authorization, output_registry, soul_registry, root, protocol,
        soul::soul_id(&state), object::id(&state), witness, ctx,
    );
    soul::bind_animacraft_native_v8(&mut state, output_v8::native_soul_binding_id_v8(&binding));
    output_v8::freeze_native_soul_binding_v8(binding);
    state
}

public fun mint_native_in_personal_kiosk_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &mut KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: String,
    description: String,
    image_url: String,
    initial_content: vector<InitialContentEntry>,
    initial_state_config: vector<StateConfigEntry>,
    creator_royalty_bps: u16,
    mint_nonce: vector<u8>,
    expected_content_id: ID,
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
        mint_nonce,
        expected_content_id,
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
    registry: &mut KioskRegistry,
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
    mint_nonce: vector<u8>,
    expected_content_id: ID,
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
        mint_nonce,
        expected_content_id,
        clock,
        ctx,
    )
}

public fun mint_imported_in_personal_kiosk_v2(
    config: &MarketConfigV2,
    kind_registry_obj: &KindRegistry,
    registry: &mut KioskRegistry,
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
    mint_nonce: vector<u8>,
    expected_content_id: ID,
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
        mint_nonce,
        expected_content_id,
        clock,
        ctx,
    )
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
    mint_nonce: vector<u8>,
    expected_content_id: ID,
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
        mint_nonce,
        expected_content_id,
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
    mint_nonce: vector<u8>,
    expected_content_id: ID,
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
        mint_nonce,
        expected_content_id,
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
    floor_price_atomic: Option<u128>,
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
        floor_price_atomic,
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
    floor_price_atomic: Option<u128>,
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
        floor_price_atomic,
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
    floor_price_atomic: Option<u128>,
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
        floor_price_atomic,
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

public fun cancel_soul_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &mut SoulState,
    listing: &mut SoulListing,
) {
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

/// Settle an ordinary Soul through the fresh V2 secondary-market gate.
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

/// List a Collection right through the fresh V2 secondary-market gate.
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

/// Settle a Collection right through the fresh V2 secondary-market gate.
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
    let (_, _, _) = transfer_policy::confirm_request(collection_policy, request);

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
    registry: &mut KioskRegistry,
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
    mint_nonce: vector<u8>,
    expected_content_id: ID,
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

    let mut soul_obj = soul::mint(
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

    soul::bind_state_pointer(&mut soul_obj, &state);

    assert!(derive_mint_content_id(registry, ctx.sender(), mint_nonce) == expected_content_id, EMintContentIdentityMismatch);
    let mut content_obj = content::create_derived(soul_id, &mut registry.id,
        ContentMintKeyV1 { author: ctx.sender(), nonce: mint_nonce }, ctx);
    let content_id = object::id(&content_obj);
    soul::set_content_id(&mut state, content_id);

    apply_initial_state_config(&mut state, initial_state_config, owner);
    apply_initial_content_entries(
        &mut content_obj,
        &mut state,
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
        assert_initial_config_key_unreserved(&key);
        let key_for_event = copy key;
        soul::upsert_state_config(state, key, value);
        soul::emit_state_config_upserted(state, updater, key_for_event);
    };
    entries.destroy_empty();
}

fun assert_initial_config_key_unreserved(key: &String) {
    let prefix = b"content_seal_envelope_v1:";
    let bytes = key.as_bytes();
    if (bytes.length() < prefix.length()) return;
    let mut i = 0;
    while (i < prefix.length()) {
        if (bytes[i] != prefix[i]) return;
        i = i + 1;
    };
    abort EInitialEnvelopeConfigReserved
}

fun apply_initial_content_entries(
    content_obj: &mut SoulContent,
    state: &mut SoulState,
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
            expected_version_index,
            encrypted_envelope,
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
                state,
                kind_registry_obj,
                kind,
                copy name,
                slot_read_mode_mask,
                download_policy,
                blob,
                expected_version_index,
                encrypted_envelope,
                clock,
                ctx,
            )
        } else {
            content::append_initial_user_version(
                content_obj,
                state,
                kind_registry_obj,
                kind,
                copy name,
                slot_read_mode_mask,
                download_policy,
                blob,
                expected_version_index,
                encrypted_envelope,
                clock,
                ctx,
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
    soul::share_state(state);
}

public fun finalize_collection(collection_obj: SoulCollection) {
    collection::share_collection(collection_obj)
}

public fun finalize_soul_listing(listing: SoulListing) {
    transfer::share_object(listing)
}

public fun finalize_collection_listing(listing: CollectionListing) {
    transfer::share_object(listing)
}

public fun finalize_soul_content(content_obj: SoulContent) {
    content::share_content(content_obj)
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
    let (_, _, _) = transfer_policy::confirm_request(soul_policy, request);

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
    let numerator = (price as u128) * (bps as u128);
    if (numerator == 0) {
        return 0
    };
    (((numerator + 9_999) / 10_000) as u64)
}

fun floor_bps_amount(price: u64, bps: u16): u64 {
    (((price as u128) * (bps as u128) / 10_000) as u64)
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

// TransferPolicy must stay shared so admins can add/remove Kiosk rules later.
#[allow(lint(share_owned))]
fun init_fresh_impl(
    publisher: Publisher,
    admin: address,
    ctx: &mut TxContext,
) {
    let (mut soul_policy, soul_policy_cap) = transfer_policy::new<Soul>(&publisher, ctx);
    let (mut collection_policy, collection_policy_cap) =
        transfer_policy::new<SoulCollectionRight>(&publisher, ctx);
    let config = MarketConfigV2 {
        id: object::new(ctx),
        version: MARKET_VERSION_V2,
        legacy_config_id: object::id_from_address(@0x0),
        fee_recipient: admin,
        platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
        primary_enabled: false,
        secondary_enabled: false,
    };
    let registry = KioskRegistry {
        id: object::new(ctx),
        version: VERSION,
    };
    let config_id = object::id(&config);
    let registry_id = object::id(&registry);
    let soul_policy_id = object::id(&soul_policy);
    let collection_policy_id = object::id(&collection_policy);
    let admin_cap = MarketAdminCapV2 { id: object::new(ctx), config_id };

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

/// The exact production initializer, including both fail-closed gates.
#[test_only]
public fun init_fresh_for_testing(
    recipient: address,
    ctx: &mut TxContext,
) {
    init_fresh_impl(package::claim(MARKET {}, ctx), recipient, ctx)
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
        expected_version_index: _,
        encrypted_envelope: _,
    } = entry;
    blob
}
