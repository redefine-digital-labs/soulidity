module soulidity::market;

use std::string;
use kiosk::kiosk_lock_rule;
use kiosk::personal_kiosk::{Self as personal_kiosk, PersonalKioskCap};
use kiosk::personal_kiosk_rule;
use kiosk::witness_rule;
use soulidity::assets::{Self as assets, SoulAssets};
use soulidity::collection::{Self as collection, SoulCollection, SoulCollectionRight};
use soulidity::content_access;
use soulidity::grant;
use soulidity::memory;
use soulidity::metadata::{Self as metadata, AssetBinding, SoulMetadata};
use soulidity::skills::{Self as skills, SoulSkills};
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
const DEFAULT_PLATFORM_FEE_BPS: u16 = 250;

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
const EUpgradeCapNotTracked: u64 = 20;
const EUpgradeCapMismatch: u64 = 21;
const EUpgradesImmutable: u64 = 22;
const EUpgradeAlreadyPending: u64 = 23;
const EUpgradeNotPending: u64 = 24;
const ESourceAlreadyJoined: u64 = 25;
const EInvalidMetadataBinding: u64 = 26;
const EMetadataAssetsMissing: u64 = 27;
const EContentAccessNotPurchasable: u64 = 28;
const EAccessListLinkageMismatch: u64 = 29;
const EListingStillActive: u64 = 30;
const EOldKioskNotEmpty: u64 = 31;
const EOldKioskMismatch: u64 = 32;
const ERebindSameKiosk: u64 = 33;
const EAssetsRootAlreadyExists: u64 = 34;
const EContentAccessOwnerCannotPurchase: u64 = 35;
const ESkillsRootAlreadyExists: u64 = 36;
const EPersonalKioskCapMismatch: u64 = 37;
const ESoulCurrentKioskMismatch: u64 = 38;
const ESoulOwnerMismatch: u64 = 39;
const EKioskOwnerMismatch: u64 = 40;
const EListingSellerMismatch: u64 = 41;
const EListingStateMismatch: u64 = 42;

const ASSET_TYPE_SPRITE: u8 = 0;
const ASSET_TYPE_AUDIO: u8 = 2;

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

public struct KioskRegistry has key {
    id: UID,
}

public struct MarketUpgradeState has key {
    id: UID,
    tracked_package_id: Option<ID>,
    tracked_upgrade_cap_id: Option<ID>,
    tracked_upgrade_policy: u8,
    tracked_upgrade_version: u64,
    upgrade_cap_live: bool,
    immutable: bool,
    pending_upgrade: bool,
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

public struct JoinedSourceKey has copy, drop, store {
    source_object_id: ID,
}

public struct PersonalKioskRegistration has copy, drop, store {
    kiosk_id: ID,
    kiosk_cap_id: ID,
}

public struct SoulMarketProof has drop {}

public struct CollectionMarketProof has drop {}

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

public struct MarketUpgradeStateInitialized has copy, drop {
    upgrade_state_id: ID,
}

public struct MarketUpgradeCapTracked has copy, drop {
    upgrade_state_id: ID,
    package_id: ID,
    upgrade_cap_id: ID,
    policy: u8,
    version: u64,
}

public struct MarketUpgradeAuthorized has copy, drop {
    upgrade_state_id: ID,
    package_id: ID,
    policy: u8,
}

public struct MarketUpgradeCommitted has copy, drop {
    upgrade_state_id: ID,
    from_package_id: ID,
    to_package_id: ID,
    version: u64,
}

public struct MarketUpgradesFrozen has copy, drop {
    upgrade_state_id: ID,
    package_id: ID,
    version: u64,
}

public struct SoulMintedToKiosk has copy, drop {
    soul_id: ID,
    state_id: ID,
    memory_id: ID,
    metadata_id: ID,
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

public struct ContentAccessPurchased has copy, drop {
    soul_id: ID,
    access_list_id: ID,
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

public fun tracked_upgrade_policy(self: &MarketUpgradeState): u8 {
    self.tracked_upgrade_policy
}

public fun tracked_upgrade_version(self: &MarketUpgradeState): u64 {
    self.tracked_upgrade_version
}

public fun has_tracked_upgrade_cap(self: &MarketUpgradeState): bool {
    self.tracked_upgrade_cap_id.is_some()
}

public fun upgrade_cap_live(self: &MarketUpgradeState): bool {
    self.upgrade_cap_live
}

public fun upgrades_immutable(self: &MarketUpgradeState): bool {
    self.immutable
}

public fun upgrade_pending(self: &MarketUpgradeState): bool {
    self.pending_upgrade
}

public fun tracked_package_id(self: &MarketUpgradeState): Option<ID> {
    self.tracked_package_id
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

public fun quote_content_access_purchase(
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

public fun track_upgrade_cap(
    upgrade_state: &mut MarketUpgradeState,
    _: &MarketAdminCap,
    upgrade_cap: &package::UpgradeCap,
) {
    assert!(!upgrade_state.immutable, EUpgradesImmutable);
    assert!(!upgrade_state.pending_upgrade, EUpgradeAlreadyPending);
    let package_id = package::upgrade_package(upgrade_cap);
    assert!(package_id.to_address() != @0x0, EInvalidRecipient);
    let upgrade_cap_id = object::id(upgrade_cap);
    if (upgrade_state.tracked_upgrade_cap_id.is_some()) {
        assert!(*upgrade_state.tracked_upgrade_cap_id.borrow() == upgrade_cap_id, EUpgradeCapMismatch);
    };
    upgrade_state.tracked_package_id = option::some(package_id);
    upgrade_state.tracked_upgrade_cap_id = option::some(upgrade_cap_id);
    upgrade_state.tracked_upgrade_policy = package::upgrade_policy(upgrade_cap);
    upgrade_state.tracked_upgrade_version = package::version(upgrade_cap);
    upgrade_state.upgrade_cap_live = true;
    event::emit(MarketUpgradeCapTracked {
        upgrade_state_id: object::id(upgrade_state),
        package_id,
        upgrade_cap_id,
        policy: upgrade_state.tracked_upgrade_policy,
        version: upgrade_state.tracked_upgrade_version,
    });
}

public fun restrict_upgrade_policy_additive(
    upgrade_state: &mut MarketUpgradeState,
    _: &MarketAdminCap,
    upgrade_cap: &mut package::UpgradeCap,
) {
    assert!(!upgrade_state.immutable, EUpgradesImmutable);
    assert!(upgrade_state.upgrade_cap_live, EUpgradeCapNotTracked);
    assert!(!upgrade_state.pending_upgrade, EUpgradeAlreadyPending);
    assert_tracked_upgrade_cap(upgrade_state, object::id(upgrade_cap));
    package::only_additive_upgrades(upgrade_cap);
    upgrade_state.tracked_package_id = option::some(package::upgrade_package(upgrade_cap));
    upgrade_state.tracked_upgrade_policy = package::upgrade_policy(upgrade_cap);
    upgrade_state.tracked_upgrade_version = package::version(upgrade_cap);
    event::emit(MarketUpgradeCapTracked {
        upgrade_state_id: object::id(upgrade_state),
        package_id: package::upgrade_package(upgrade_cap),
        upgrade_cap_id: object::id(upgrade_cap),
        policy: upgrade_state.tracked_upgrade_policy,
        version: package::version(upgrade_cap),
    });
}

public fun restrict_upgrade_policy_dep_only(
    upgrade_state: &mut MarketUpgradeState,
    _: &MarketAdminCap,
    upgrade_cap: &mut package::UpgradeCap,
) {
    assert!(!upgrade_state.immutable, EUpgradesImmutable);
    assert!(upgrade_state.upgrade_cap_live, EUpgradeCapNotTracked);
    assert!(!upgrade_state.pending_upgrade, EUpgradeAlreadyPending);
    assert_tracked_upgrade_cap(upgrade_state, object::id(upgrade_cap));
    package::only_dep_upgrades(upgrade_cap);
    upgrade_state.tracked_package_id = option::some(package::upgrade_package(upgrade_cap));
    upgrade_state.tracked_upgrade_policy = package::upgrade_policy(upgrade_cap);
    upgrade_state.tracked_upgrade_version = package::version(upgrade_cap);
    event::emit(MarketUpgradeCapTracked {
        upgrade_state_id: object::id(upgrade_state),
        package_id: package::upgrade_package(upgrade_cap),
        upgrade_cap_id: object::id(upgrade_cap),
        policy: upgrade_state.tracked_upgrade_policy,
        version: package::version(upgrade_cap),
    });
}

public fun authorize_upgrade(
    upgrade_state: &mut MarketUpgradeState,
    _: &MarketAdminCap,
    upgrade_cap: &mut package::UpgradeCap,
    policy: u8,
    digest: vector<u8>,
): package::UpgradeTicket {
    assert!(!upgrade_state.immutable, EUpgradesImmutable);
    assert!(upgrade_state.upgrade_cap_live, EUpgradeCapNotTracked);
    assert!(!upgrade_state.pending_upgrade, EUpgradeAlreadyPending);
    assert_tracked_upgrade_cap(upgrade_state, object::id(upgrade_cap));

    let package_id = package::upgrade_package(upgrade_cap);
    let ticket = package::authorize_upgrade(upgrade_cap, policy, digest);
    upgrade_state.pending_upgrade = true;
    event::emit(MarketUpgradeAuthorized {
        upgrade_state_id: object::id(upgrade_state),
        package_id,
        policy: package::ticket_policy(&ticket),
    });
    ticket
}

public fun commit_upgrade(
    upgrade_state: &mut MarketUpgradeState,
    _: &MarketAdminCap,
    upgrade_cap: &mut package::UpgradeCap,
    receipt: package::UpgradeReceipt,
) {
    assert!(!upgrade_state.immutable, EUpgradesImmutable);
    assert!(upgrade_state.upgrade_cap_live, EUpgradeCapNotTracked);
    assert!(upgrade_state.pending_upgrade, EUpgradeNotPending);
    assert_tracked_upgrade_cap(upgrade_state, object::id(upgrade_cap));

    let from_package_id = *upgrade_state.tracked_package_id.borrow();
    package::commit_upgrade(upgrade_cap, receipt);
    let to_package_id = package::upgrade_package(upgrade_cap);
    upgrade_state.tracked_package_id = option::some(to_package_id);
    upgrade_state.tracked_upgrade_policy = package::upgrade_policy(upgrade_cap);
    upgrade_state.tracked_upgrade_version = package::version(upgrade_cap);
    upgrade_state.pending_upgrade = false;
    event::emit(MarketUpgradeCommitted {
        upgrade_state_id: object::id(upgrade_state),
        from_package_id,
        to_package_id,
        version: upgrade_state.tracked_upgrade_version,
    });
}

public fun freeze_upgrades(
    upgrade_state: &mut MarketUpgradeState,
    _: &MarketAdminCap,
    upgrade_cap: package::UpgradeCap,
) {
    assert!(!upgrade_state.immutable, EUpgradesImmutable);
    assert!(upgrade_state.upgrade_cap_live, EUpgradeCapNotTracked);
    assert!(!upgrade_state.pending_upgrade, EUpgradeAlreadyPending);

    let upgrade_cap_id = object::id(&upgrade_cap);
    assert_tracked_upgrade_cap(upgrade_state, upgrade_cap_id);
    let package_id = package::upgrade_package(&upgrade_cap);
    let version = package::version(&upgrade_cap);
    package::make_immutable(upgrade_cap);
    upgrade_state.tracked_package_id = option::some(package_id);
    upgrade_state.tracked_upgrade_version = version;
    upgrade_state.upgrade_cap_live = false;
    upgrade_state.immutable = true;
    event::emit(MarketUpgradesFrozen {
        upgrade_state_id: object::id(upgrade_state),
        package_id,
        version,
    });
}

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
    let owner = ctx.sender();
    let old_kiosk_id = object::id(old_kiosk);
    let new_kiosk_id = kiosk::kiosk_owner_cap_for(personal_kiosk::borrow(new_personal_kiosk_cap));
    let new_kiosk_cap_id = object::id(new_personal_kiosk_cap);
    assert!(old_kiosk_id != new_kiosk_id, ERebindSameKiosk);
    assert!(kiosk::item_count(old_kiosk) == 0, EOldKioskNotEmpty);

    let key = PersonalKioskOwnerKey { owner };
    assert!(df::exists_(&registry.id, key), EPersonalKioskNotInitialized);
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

public fun mint_native_in_personal_kiosk(
    config: &MarketConfig,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    protected_blob: Blob,
    founding_memory_blob: Option<Blob>,
    skills_blob: Option<Blob>,
    initial_skill_name: std::string::String,
    skills_public: bool,
    asset_blob: Option<Blob>,
    initial_asset_name: std::string::String,
    asset_public: bool,
    asset_type: u8,
    initial_sprite_asset_name: Option<std::string::String>,
    initial_sprite_version_index: Option<u64>,
    initial_sprite_download_policy: Option<u8>,
    initial_sprite_config: Option<vector<u8>>,
    initial_sprite_mood_map: Option<vector<u8>>,
    initial_voice_asset_name: Option<std::string::String>,
    initial_voice_version_index: Option<u64>,
    initial_voice_download_policy: Option<u8>,
    initial_voice_config: Option<vector<u8>>,
    content_access_price_atomic: u64,
    content_access_default_scope_mask: u64,
    content_access_default_duration_ms: Option<u64>,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    mint_soul_in_personal_kiosk_impl(
        config,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        protected_blob,
        founding_memory_blob,
        skills_blob,
        initial_skill_name,
        skills_public,
        asset_blob,
        initial_asset_name,
        asset_public,
        asset_type,
        initial_sprite_asset_name,
        initial_sprite_version_index,
        initial_sprite_download_policy,
        initial_sprite_config,
        initial_sprite_mood_map,
        initial_voice_asset_name,
        initial_voice_version_index,
        initial_voice_download_policy,
        initial_voice_config,
        content_access_price_atomic,
        content_access_default_scope_mask,
        content_access_default_duration_ms,
        creator_royalty_bps,
        soul::provenance_native(),
        option::none(),
        clock,
        ctx,
    )
}

public fun mint_imported_in_personal_kiosk(
    config: &MarketConfig,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    protected_blob: Blob,
    founding_memory_blob: Option<Blob>,
    skills_blob: Option<Blob>,
    initial_skill_name: std::string::String,
    skills_public: bool,
    asset_blob: Option<Blob>,
    initial_asset_name: std::string::String,
    asset_public: bool,
    asset_type: u8,
    initial_sprite_asset_name: Option<std::string::String>,
    initial_sprite_version_index: Option<u64>,
    initial_sprite_download_policy: Option<u8>,
    initial_sprite_config: Option<vector<u8>>,
    initial_sprite_mood_map: Option<vector<u8>>,
    initial_voice_asset_name: Option<std::string::String>,
    initial_voice_version_index: Option<u64>,
    initial_voice_download_policy: Option<u8>,
    initial_voice_config: Option<vector<u8>>,
    content_access_price_atomic: u64,
    content_access_default_scope_mask: u64,
    content_access_default_duration_ms: Option<u64>,
    origin_ref: std::string::String,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    mint_soul_in_personal_kiosk_impl(
        config,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        protected_blob,
        founding_memory_blob,
        skills_blob,
        initial_skill_name,
        skills_public,
        asset_blob,
        initial_asset_name,
        asset_public,
        asset_type,
        initial_sprite_asset_name,
        initial_sprite_version_index,
        initial_sprite_download_policy,
        initial_sprite_config,
        initial_sprite_mood_map,
        initial_voice_asset_name,
        initial_voice_version_index,
        initial_voice_download_policy,
        initial_voice_config,
        content_access_price_atomic,
        content_access_default_scope_mask,
        content_access_default_duration_ms,
        creator_royalty_bps,
        soul::provenance_imported(),
        option::some(origin_ref),
        clock,
        ctx,
    )
}

public fun mint_joined_in_personal_kiosk<T: key + store>(
    config: &MarketConfig,
    registry: &mut KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    source_object_id: ID,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    protected_blob: Blob,
    founding_memory_blob: Option<Blob>,
    skills_blob: Option<Blob>,
    initial_skill_name: std::string::String,
    skills_public: bool,
    asset_blob: Option<Blob>,
    initial_asset_name: std::string::String,
    asset_public: bool,
    asset_type: u8,
    initial_sprite_asset_name: Option<std::string::String>,
    initial_sprite_version_index: Option<u64>,
    initial_sprite_download_policy: Option<u8>,
    initial_sprite_config: Option<vector<u8>>,
    initial_sprite_mood_map: Option<vector<u8>>,
    initial_voice_asset_name: Option<std::string::String>,
    initial_voice_version_index: Option<u64>,
    initial_voice_download_policy: Option<u8>,
    initial_voice_config: Option<vector<u8>>,
    content_access_price_atomic: u64,
    content_access_default_scope_mask: u64,
    content_access_default_duration_ms: Option<u64>,
    origin_ref: std::string::String,
    creator_royalty_bps: u16,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(kiosk::has_item_with_type<T>(kiosk_obj, source_object_id), ECollectionMismatch);
    let join_key = JoinedSourceKey { source_object_id };
    assert!(!df::exists_(&registry.id, join_key), ESourceAlreadyJoined);
    df::add(&mut registry.id, join_key, true);
    mint_soul_in_personal_kiosk_impl(
        config,
        registry,
        soul_policy,
        kiosk_obj,
        personal_kiosk_cap,
        name,
        description,
        image_url,
        protected_blob,
        founding_memory_blob,
        skills_blob,
        initial_skill_name,
        skills_public,
        asset_blob,
        initial_asset_name,
        asset_public,
        asset_type,
        initial_sprite_asset_name,
        initial_sprite_version_index,
        initial_sprite_download_policy,
        initial_sprite_config,
        initial_sprite_mood_map,
        initial_voice_asset_name,
        initial_voice_version_index,
        initial_voice_download_policy,
        initial_voice_config,
        content_access_price_atomic,
        content_access_default_scope_mask,
        content_access_default_duration_ms,
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
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    extra_royalty_bps: u16,
    tradeable: bool,
    max_supply: Option<u64>,
    ctx: &mut TxContext,
): SoulCollection {
    assert!(!config.paused, EMarketPaused);
    assert!(
        ((config.platform_fee_bps as u64) + (extra_royalty_bps as u64)) <= (MAX_BPS as u64),
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

public fun set_active_sprite(
    metadata_obj: &mut SoulMetadata,
    state: &SoulState,
    assets_book: &assets::SoulAssets,
    asset_name: std::string::String,
    version_index: u64,
    download_policy: u8,
    ctx: &TxContext,
) {
    let binding = metadata::new_asset_binding(asset_name, version_index, download_policy);
    assert_binding_matches_assets(&binding, assets_book, ASSET_TYPE_SPRITE);
    metadata::set_active_sprite(metadata_obj, state, option::some(binding), ctx);
}

public fun clear_active_sprite(
    metadata_obj: &mut SoulMetadata,
    state: &SoulState,
    ctx: &TxContext,
) {
    metadata::clear_active_sprite(metadata_obj, state, ctx);
}

public fun set_active_voice(
    metadata_obj: &mut SoulMetadata,
    state: &SoulState,
    assets_book: &assets::SoulAssets,
    asset_name: std::string::String,
    version_index: u64,
    download_policy: u8,
    ctx: &TxContext,
) {
    let binding = metadata::new_asset_binding(asset_name, version_index, download_policy);
    assert_binding_matches_assets(&binding, assets_book, ASSET_TYPE_AUDIO);
    metadata::set_active_voice(metadata_obj, state, option::some(binding), ctx);
}

public fun clear_active_voice(
    metadata_obj: &mut SoulMetadata,
    state: &SoulState,
    ctx: &TxContext,
) {
    metadata::clear_active_voice(metadata_obj, state, ctx);
}

/// Atomically create the SoulAssets root for a Soul that minted without
/// initial sprite assets, append the first sprite version, write the
/// sprite config + mood map metadata blobs, and bind the sprite as the
/// active version — all in one PTB.
///
/// Required when the Soul was minted via the bare-mint path (no sprite
/// blob at mint time) and the owner is now uploading the first sprite.
/// The legacy `assets::append_version_as_owner` path requires an existing
/// `SoulAssets` root and is unreachable in this case.
public fun init_assets_and_append_sprite_as_owner(
    state: &mut SoulState,
    metadata_obj: &mut SoulMetadata,
    asset_name: std::string::String,
    is_public: bool,
    content_blob: Blob,
    sprite_config: vector<u8>,
    sprite_mood_map: vector<u8>,
    sprite_config_key: std::string::String,
    sprite_mood_map_key: std::string::String,
    download_policy: u8,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulAssets {
    soul::assert_owner(state, ctx.sender());
    assert!(soul::assets_id(state).is_none(), EAssetsRootAlreadyExists);

    let mut assets_book = assets::create(soul::soul_id(state), ctx);
    let version_index = assets::append_initial_version(
        &mut assets_book,
        asset_name,
        is_public,
        ASSET_TYPE_SPRITE,
        content_blob,
        clock,
        ctx,
    );

    metadata::upsert_metadata_blob(metadata_obj, state, sprite_config_key, sprite_config, ctx);
    metadata::upsert_metadata_blob(metadata_obj, state, sprite_mood_map_key, sprite_mood_map, ctx);

    let binding = metadata::new_asset_binding(asset_name, version_index, download_policy);
    assert_binding_matches_assets(&binding, &assets_book, ASSET_TYPE_SPRITE);
    metadata::set_active_sprite(metadata_obj, state, option::some(binding), ctx);

    soul::set_assets_id(state, object::id(&assets_book));
    assets_book
}

public fun init_skills_and_append_as_owner(
    state: &mut SoulState,
    skill_name: std::string::String,
    is_public: bool,
    content_blob: Blob,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulSkills {
    soul::assert_owner(state, ctx.sender());
    assert!(soul::skills_id(state).is_none(), ESkillsRootAlreadyExists);

    let mut skills_book = skills::create(soul::soul_id(state), ctx);
    let _ = skills::append_initial_version(
        &mut skills_book,
        skill_name,
        is_public,
        content_blob,
        clock,
        ctx,
    );
    soul::set_skills_id(state, object::id(&skills_book));
    skills_book
}

public fun list_soul_fixed_price(
    config: &MarketConfig,
    registry: &KioskRegistry,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    state: &SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(!config.paused, EMarketPaused);
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
    state: &SoulState,
    price: u64,
    ctx: &mut TxContext,
): SoulListing {
    assert!(!config.paused, EMarketPaused);
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

    event::emit(SoulListed {
        listing_id,
        soul_id,
        seller,
        kiosk_id,
        price,
    });

    listing
}

public fun cancel_soul_listing(
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    listing: &mut SoulListing,
) {
    assert!(listing.is_active, EInactiveListing);
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);
    assert!(object::id(kiosk_obj) == listing.seller_kiosk_id, EListingKioskMismatch);
    assert!(personal_kiosk::owner(kiosk_obj) == listing.seller, EKioskOwnerMismatch);

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
    assert!(listing.collection_id.is_none(), ECollectionMismatch);
    assert!(soul::collection_id(state).is_none(), ECollectionMismatch);
    buy_soul_impl(
        config,
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
    let collection_id = object::id(collection_obj);
    assert!(listing.collection_id.contains(&collection_id), ECollectionMismatch);
    assert!(soul::collection_id(state).contains(&collection_id), ECollectionMismatch);
    buy_soul_impl(
        config,
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
    assert!(!config.paused, EMarketPaused);
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

// ── Content access purchase (H-1 fix: pays current owner, I-2: platform fee) ──

public fun purchase_content_access(
    config: &MarketConfig,
    access_list: &mut content_access::ContentAccessList,
    state: &SoulState,
    payment: Coin<USDC>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!config.paused, EMarketPaused);
    assert!(content_access::soul_id(access_list) == soul::soul_id(state), EAccessListStateMismatch);
    assert!(
        soul::access_list_id(state).contains(&object::id(access_list)),
        EAccessListLinkageMismatch,
    );

    let price = content_access::price_atomic(access_list);
    assert!(price > 0, EContentAccessNotPurchasable);
    assert!(ctx.sender() != soul::current_owner(state), EContentAccessOwnerCannotPurchase);
    let (platform_fee, _, total) = quote_content_access_purchase(config, price);
    assert!(payment.value() == total, EIncorrectPaymentAmount);

    let payment_recipient = soul::current_owner(state);
    let mut owner_payment = payment;
    if (platform_fee > 0) {
        let fee = coin::split(&mut owner_payment, platform_fee, ctx);
        transfer::public_transfer(fee, config.fee_recipient);
    };
    transfer::public_transfer(owner_payment, payment_recipient);

    let buyer = ctx.sender();
    content_access::record_purchase(access_list, state, buyer, price, clock);

    event::emit(ContentAccessPurchased {
        soul_id: soul::soul_id(state),
        access_list_id: object::id(access_list),
        buyer,
        price,
        platform_fee,
        payment_recipient,
    });
}

/// Reclaim storage for a fully-settled `SoulListing` (cancelled or purchased).
/// Any caller may invoke this — invalidated listings carry no value and
/// leaving them shared indefinitely only wastes on-chain storage rebate.
public fun delete_soul_listing(listing: SoulListing, ctx: &TxContext) {
    assert!(!listing.is_active, EListingStillActive);
    let listing_id = object::id(&listing);
    let SoulListing {
        id,
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

fun mint_soul_in_personal_kiosk_impl(
    config: &MarketConfig,
    registry: &KioskRegistry,
    soul_policy: &TransferPolicy<Soul>,
    kiosk_obj: &mut Kiosk,
    personal_kiosk_cap: &PersonalKioskCap,
    name: std::string::String,
    description: std::string::String,
    image_url: std::string::String,
    protected_blob: Blob,
    founding_memory_blob: Option<Blob>,
    skills_blob: Option<Blob>,
    initial_skill_name: std::string::String,
    skills_public: bool,
    asset_blob: Option<Blob>,
    initial_asset_name: std::string::String,
    asset_public: bool,
    asset_type: u8,
    initial_sprite_asset_name: Option<std::string::String>,
    initial_sprite_version_index: Option<u64>,
    initial_sprite_download_policy: Option<u8>,
    initial_sprite_config: Option<vector<u8>>,
    initial_sprite_mood_map: Option<vector<u8>>,
    initial_voice_asset_name: Option<std::string::String>,
    initial_voice_version_index: Option<u64>,
    initial_voice_download_policy: Option<u8>,
    initial_voice_config: Option<vector<u8>>,
    content_access_price_atomic: u64,
    content_access_default_scope_mask: u64,
    content_access_default_duration_ms: Option<u64>,
    creator_royalty_bps: u16,
    provenance_kind: u8,
    origin_ref: Option<std::string::String>,
    clock: &Clock,
    ctx: &mut TxContext,
): SoulState {
    assert!(!config.paused, EMarketPaused);
    assert!(
        ((config.platform_fee_bps as u64) + (creator_royalty_bps as u64)) <= (MAX_BPS as u64),
        ECombinedFeesTooHigh,
    );
    assert!(kiosk::has_access(kiosk_obj, personal_kiosk::borrow(personal_kiosk_cap)), EUnauthorizedKioskAccess);

    let owner = personal_kiosk::owner(kiosk_obj);
    let kiosk_id = object::id(kiosk_obj);
    assert_registered_personal_kiosk(registry, owner, kiosk_id, object::id(personal_kiosk_cap));

    let soul_obj = soul::mint(
        name,
        description,
        image_url,
        protected_blob,
        owner,
        creator_royalty_bps,
        provenance_kind,
        origin_ref,
        ctx,
    );
    let soul_id = object::id(&soul_obj);
    let mut memory_obj = memory::create(soul_id, ctx);
    let memory_id = object::id(&memory_obj);
    let mut state = soul::create_state(
        soul_id,
        owner,
        creator_royalty_bps,
        owner,
        kiosk_id,
        option::some(memory_id),
        ctx,
    );
    let state_id = object::id(&state);
    let mut metadata_obj = metadata::create(soul_id, ctx);
    let metadata_id = object::id(&metadata_obj);
    soul::set_metadata_id(&mut state, metadata_id);
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
        let _ = skills::append_initial_version(
            &mut skills_book,
            initial_skill_name,
            skills_public,
            skill_blob,
            clock,
            ctx,
        );
        soul::set_skills_id(&mut state, object::id(&skills_book));
        skills::share_skills(skills_book);
    };
    skills_blob.destroy_none();

    let mut initial_sprite_binding = resolve_initial_binding(
        initial_sprite_asset_name,
        initial_sprite_version_index,
        initial_sprite_download_policy,
    );
    let mut initial_voice_binding = resolve_initial_binding(
        initial_voice_asset_name,
        initial_voice_version_index,
        initial_voice_download_policy,
    );

    // Create SoulAssets if asset_blob provided
    let mut asset_blob = asset_blob;
    if (asset_blob.is_some()) {
        let ab = option::extract(&mut asset_blob);
        let mut assets_book = assets::create(soul_id, ctx);
        let _ = assets::append_initial_version(
            &mut assets_book,
            initial_asset_name,
            asset_public,
            asset_type,
            ab,
            clock,
            ctx,
        );

        if (initial_sprite_binding.is_some()) {
            let sprite_binding = option::extract(&mut initial_sprite_binding);
            assert_binding_matches_assets(&sprite_binding, &assets_book, ASSET_TYPE_SPRITE);
            metadata::set_active_sprite(&mut metadata_obj, &state, option::some(sprite_binding), ctx);
        };

        if (initial_voice_binding.is_some()) {
            let voice_binding = option::extract(&mut initial_voice_binding);
            assert_binding_matches_assets(&voice_binding, &assets_book, ASSET_TYPE_AUDIO);
            metadata::set_active_voice(&mut metadata_obj, &state, option::some(voice_binding), ctx);
        };

        soul::set_assets_id(&mut state, object::id(&assets_book));
        assets::share_assets(assets_book);
    } else {
        assert!(initial_sprite_binding.is_none(), EMetadataAssetsMissing);
        assert!(initial_voice_binding.is_none(), EMetadataAssetsMissing);
    };
    asset_blob.destroy_none();
    initial_sprite_binding.destroy_none();
    initial_voice_binding.destroy_none();

    // Create ContentAccessList and bind to state (M-1 fix)
    let access_list = content_access::create(
        soul_id,
        ctx.sender(),
        content_access_price_atomic,
        content_access_default_scope_mask,
        content_access_default_duration_ms,
        ctx,
    );
    soul::set_access_list_id(&mut state, object::id(&access_list));
    content_access::share_access_list(access_list);
    upsert_initial_metadata_blobs(
        &mut metadata_obj,
        &state,
        initial_sprite_config,
        initial_sprite_mood_map,
        initial_voice_config,
        ctx,
    );
    metadata::share_metadata(metadata_obj);

    kiosk::lock<Soul>(
        kiosk_obj,
        personal_kiosk::borrow(personal_kiosk_cap),
        soul_policy,
        soul_obj,
    );
    soul::emit_created(&state, provenance_kind);
    memory::share_memory(memory_obj);
    event::emit(SoulMintedToKiosk {
        soul_id,
        state_id,
        memory_id,
        metadata_id,
        kiosk_id,
        owner,
        provenance_kind,
    });

    state
}

// ─── Finalize wrappers ────────────────────────────────────────────────
// These exist solely to share the unshared root objects produced by the
// new fast-path mint/create/list/init ABI. PTBs compose primitive object
// returns first (mint → bind, create → list, init_skills → append_more,
// etc.) and call the matching finalize_* call last to share the root.

public fun finalize_soul_state(state: SoulState) {
    soul::share_state(state)
}

public fun finalize_collection(collection_obj: SoulCollection) {
    collection::share_collection(collection_obj)
}

#[allow(lint(share_owned, custom_state_change))]
public fun finalize_soul_listing(listing: SoulListing) {
    transfer::share_object(listing)
}

#[allow(lint(share_owned, custom_state_change))]
public fun finalize_collection_listing(listing: CollectionListing) {
    transfer::share_object(listing)
}

public fun finalize_soul_skills(skills_book: SoulSkills) {
    skills::share_skills(skills_book)
}

public fun finalize_soul_assets(assets_book: SoulAssets) {
    assets::share_assets(assets_book)
}

fun resolve_initial_binding(
    asset_name: Option<std::string::String>,
    version_index: Option<u64>,
    download_policy: Option<u8>,
): Option<AssetBinding> {
    let has_asset_name = asset_name.is_some();
    let has_version_index = version_index.is_some();
    let has_download_policy = download_policy.is_some();

    if (!has_asset_name && !has_version_index && !has_download_policy) {
        asset_name.destroy_none();
        version_index.destroy_none();
        download_policy.destroy_none();
        return option::none()
    };

    assert!(has_asset_name && has_version_index && has_download_policy, EInvalidMetadataBinding);
    option::some(metadata::new_asset_binding(
        option::destroy_some(asset_name),
        option::destroy_some(version_index),
        option::destroy_some(download_policy),
    ))
}

fun assert_binding_matches_assets(
    binding: &AssetBinding,
    assets_book: &assets::SoulAssets,
    expected_asset_type: u8,
) {
    let asset_name = *metadata::asset_name(binding);
    let version_index = metadata::version_index(binding);
    let download_policy = metadata::download_policy(binding);

    assert!(!assets::version_is_deleted(assets_book, copy asset_name, version_index), EInvalidMetadataBinding);
    assert!(assets::version_asset_type(assets_book, copy asset_name, version_index) == expected_asset_type, EInvalidMetadataBinding);

    if (download_policy == metadata::download_policy_public()) {
        assert!(assets::version_is_public(assets_book, asset_name, version_index), EInvalidMetadataBinding);
    } else {
        assert!(!assets::version_is_public(assets_book, asset_name, version_index), EInvalidMetadataBinding);
    };
}

fun upsert_initial_metadata_blobs(
    metadata_obj: &mut SoulMetadata,
    state: &SoulState,
    initial_sprite_config: Option<vector<u8>>,
    initial_sprite_mood_map: Option<vector<u8>>,
    initial_voice_config: Option<vector<u8>>,
    ctx: &TxContext,
) {
    upsert_initial_metadata_blob_if_some(
        metadata_obj,
        state,
        string::utf8(b"sprite.config.v1"),
        initial_sprite_config,
        ctx,
    );
    upsert_initial_metadata_blob_if_some(
        metadata_obj,
        state,
        string::utf8(b"sprite.mood_map.v1"),
        initial_sprite_mood_map,
        ctx,
    );
    upsert_initial_metadata_blob_if_some(
        metadata_obj,
        state,
        string::utf8(b"voice.config.v1"),
        initial_voice_config,
        ctx,
    );
}

fun upsert_initial_metadata_blob_if_some(
    metadata_obj: &mut SoulMetadata,
    state: &SoulState,
    key: std::string::String,
    blob: Option<vector<u8>>,
    ctx: &TxContext,
) {
    if (blob.is_some()) {
        metadata::upsert_metadata_blob(
            metadata_obj,
            state,
            key,
            option::destroy_some(blob),
            ctx,
        );
    } else {
        blob.destroy_none();
    };
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
    config: &MarketConfig,
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
    assert!(!config.paused, EMarketPaused);
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
    registry: &mut KioskRegistry,
    owner: address,
    kiosk_id: ID,
    kiosk_cap_id: ID,
) {
    let key = PersonalKioskOwnerKey { owner };
    assert!(!df::exists_(&registry.id, key), EPersonalKioskAlreadyInitialized);
    df::add(
        &mut registry.id,
        key,
        PersonalKioskRegistration {
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
    if (df::exists_(&registry.id, key)) {
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
    assert!(df::exists_(&registry.id, key), EPersonalKioskNotInitialized);
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

fun assert_tracked_upgrade_cap(upgrade_state: &MarketUpgradeState, upgrade_cap_id: ID) {
    assert!(upgrade_state.tracked_upgrade_cap_id.is_some(), EUpgradeCapNotTracked);
    assert!(*upgrade_state.tracked_upgrade_cap_id.borrow() == upgrade_cap_id, EUpgradeCapMismatch);
}

#[allow(lint(share_owned))]
fun init_impl(publisher: Publisher, admin: address, ctx: &mut TxContext) {
    let (mut soul_policy, soul_policy_cap) = transfer_policy::new<Soul>(&publisher, ctx);
    let (mut collection_policy, collection_policy_cap) =
        transfer_policy::new<SoulCollectionRight>(&publisher, ctx);
    let config = MarketConfig {
        id: object::new(ctx),
        fee_recipient: admin,
        platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
        paused: false,
    };
    let registry = KioskRegistry {
        id: object::new(ctx),
    };
    let upgrade_state = MarketUpgradeState {
        id: object::new(ctx),
        tracked_package_id: option::none(),
        tracked_upgrade_cap_id: option::none(),
        tracked_upgrade_policy: package::compatible_policy(),
        tracked_upgrade_version: 0,
        upgrade_cap_live: false,
        immutable: false,
        pending_upgrade: false,
    };
    let config_id = object::id(&config);
    let registry_id = object::id(&registry);
    let upgrade_state_id = object::id(&upgrade_state);
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
    transfer::share_object(upgrade_state);
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
    event::emit(MarketUpgradeStateInitialized {
        upgrade_state_id,
    });
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    init_impl(package::claim(MARKET {}, ctx), recipient, ctx);
}
