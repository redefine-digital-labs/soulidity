// Copyright (c) CPU Marketplace
// SPDX-License-Identifier: Apache-2.0

/// Buyer-initiated offer system for CPU Marketplace
/// Allows buyers to make offers on specific NFTs,
/// and sellers to accept those offers through the Kiosk system
module cpu::marketplace_offer {
    use sui::kiosk::{Self, Kiosk, KioskOwnerCap};
    use sui::transfer_policy::{Self, TransferPolicy};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::table::{Self, Table};
    use sui::clock::{Self, Clock};
    use cpu::events;
    use cpu::offer_portfolio::{Self, OfferPortfolio};
    use unft_standard::unft_standard::NftCollection;
    use kiosk::royalty_rule;
    use kiosk::floor_price_rule;
    use kiosk::kiosk_lock_rule;
    use cpu::transfer_policy_utils;
    use std::ascii::String;
    use std::type_name::{Self as tn, TypeName};
    use sui::dynamic_field as df;
    use kiosk::personal_kiosk::{Self, PersonalKioskCap};
    use kiosk::personal_kiosk_rule;

    // ========== Error Codes ==========

    #[error]
    const EOfferNotFound: vector<u8> =
        b"Offer does not exist.";

    #[error]
    const EOfferExpired: vector<u8> =
        b"Offer has expired.";

    #[error]
    const ENotOfferOwner: vector<u8> =
        b"Only the offer creator can perform this action.";

    #[error]
    const EOfferNotActive: vector<u8> =
        b"Offer is not in active status.";

    #[error]
    const EInvalidItemId: vector<u8> =
        b"Item ID does not match the offer target.";

    #[error]
    const EOfferAlreadyExists: vector<u8> =
        b"An active offer from this buyer already exists for this item.";

    #[error]
    const EInvalidExpireDays: vector<u8> =
        b"Expire days must be greater than 0.";

    #[error]
    const EWrongCollection: vector<u8> =
        b"NFT does not belong to the target collection.";

    #[error]
    const ENotCollectionOffer: vector<u8> =
        b"This is not a collection-level offer.";

    #[error]
    const ECannotUpdatePortfolioOffer: vector<u8> =
        b"Cannot update portfolio-backed offers using update_offer. Use update_portfolio_offer instead.";

    #[error]
    const ECannotCancelPortfolioOffer: vector<u8> =
        b"Use cancel_portfolio_offer for portfolio-backed offers.";

    #[error]
    const ENotPortfolioOffer: vector<u8> =
        b"Operation requires a portfolio-backed offer.";

    #[error]
    const EPortfolioIdMismatch: vector<u8> =
        b"Portfolio ID does not match offer's portfolio_id.";

    #[error]
    const EIncreaseRequired: vector<u8> =
        b"New amount must be greater than current amount.";

    #[error]
    const EInsufficientPortfolioBalance: vector<u8> =
        b"Insufficient available balance in portfolio.";

    #[error]
    const EInsufficientFeePayment: vector<u8> =
        b"Fee payment does not cover royalty and marketplace fees.";

    #[error]
    const EPolicyInconsistency: vector<u8> =
        b"Cannot mix offers with and without transfer policies for the same NFT type.";

    #[error]
    const EClaimTicketExpired: vector<u8> =
        b"Claim ticket has expired.";

    #[error]
    const EClaimTicketNotExpired: vector<u8> =
        b"Claim ticket has not yet expired.";

    #[error]
    const ENotPersonalKioskOwner: vector<u8> =
        b"Caller is not the owner of the personal kiosk.";

    #[error]
    const ETypeMismatch: vector<u8> =
        b"NFT type does not match the expected type.";

    #[error]
    const EUnauthorized: vector<u8> =
        b"Unauthorized action.";

    #[error]
    const EOfferAmountTooLow: vector<u8> =
        b"Gross offer payment must be at least 1 SUI before cleanup bounty.";

    #[error]
    const ECleanupGracePeriodNotPassed: vector<u8> =
        b"Third-party cleanup allowed 7 days after expiry.";

    #[error]
    const EOfferNotExpired: vector<u8> =
        b"Offer must be expired before cleanup.";

    #[error]
    const ESelfAcceptanceNotAllowed: vector<u8> =
        b"Cannot accept your own offer.";

    #[error]
    const EClaimRecoveryPeriodNotPassed: vector<u8> =
        b"Recovery period (30 days) has not passed yet.";

    #[error]
    const ENotClaimSeller: vector<u8> =
        b"Only the original seller can recover a stuck claim.";

    #[error]
    const EClaimMetaNotFound: vector<u8> =
        b"Claim ticket metadata not found (already claimed, cancelled, or recovered).";

    #[error]
    const EPolicyRulesChanged: vector<u8> =
        b"Transfer policy rules have changed since offer was accepted. Use cancel_claim_policy_changed to get a refund.";

    #[error]
    const EPolicyIdMismatch: vector<u8> =
        b"The provided TransferPolicy does not match the policy recorded at offer acceptance time.";

    #[error]
    const ETooManyOffersForItem: vector<u8> =
        b"Too many offers indexed for this item. Compact offers before adding more.";

    #[error]
    const ETooManyOffersForCollection: vector<u8> =
        b"Too many offers indexed for this collection. Compact offers before adding more.";

    #[error]
    const EOfferNotCompetitiveForCollection: vector<u8> =
        b"Collection offer pool is full; new offer must be higher than the current lowest active offer.";

    #[error]
    const EPortfolioCleanupRequiresPortfolio: vector<u8> =
        b"Portfolio-backed offers must use portfolio-aware cleanup functions.";

    #[error]
    const ETooManyAutoCreatedKiosks: vector<u8> =
        b"Buyer reached the auto-created kiosk rate limit for this window. Use claim-ticket flow or retry later.";

    #[error]
    const EPolicyChangeCancelDelayNotPassed: vector<u8> =
        b"Policy-change cancellation delay not passed yet.";

    #[error]
    const EUnsupportedClaimTransferPolicyRules: vector<u8> =
        b"Claim flow supports only royalty, floor_price, kiosk_lock, and personal_kiosk rules.";

    #[error]
    const EClaimTicketNotStale: vector<u8> =
        b"Claim ticket still has live storage entries and cannot be cleaned up.";

    // ========== Constants ==========

    const OFFER_STATUS_ACTIVE: u8 = 1;
    const OFFER_STATUS_ACCEPTED: u8 = 2;
    const OFFER_STATUS_CANCELLED: u8 = 3;
    const OFFER_STATUS_EXPIRED: u8 = 4;

    const MAX_EXPIRE_DAYS: u64 = 30; // Maximum 30 days
    const CLAIM_TICKET_EXPIRY_MS: u64 = 7 * 24 * 60 * 60 * 1000; // 7 days

    /// Minimum gross offer payment before cleanup bounty extraction (0.1 SUI for testnet)
    const MIN_OFFER_AMOUNT: u64 = 100_000_000;

    /// Cleanup bounty rate: 0.5% in 1e9 scale
    const CLEANUP_BOUNTY_BP: u64 = 5_000_000;

    /// Maximum cleanup bounty cap (0.01 SUI)
    const MAX_CLEANUP_BOUNTY: u64 = 10_000_000;

    /// Grace period before third-party cleanup allowed (7 days)
    const CLEANUP_GRACE_PERIOD_MS: u64 = 7 * 24 * 60 * 60 * 1000;

    /// Recovery period for stuck claim tickets (30 days)
    const CLAIM_RECOVERY_PERIOD_MS: u64 = 30 * 24 * 60 * 60 * 1000;

    /// Delay before `cancel_claim_policy_changed` can be called (6 hours)
    const POLICY_CHANGE_CANCEL_DELAY_MS: u64 = 6 * 60 * 60 * 1000;

    /// Prevent unbounded offer-index growth for a single item/collection.
    const MAX_OFFERS_PER_ITEM: u64 = 500;
    const MAX_OFFERS_PER_COLLECTION: u64 = 500;

    /// Bound automatic kiosk creation for kiosk_lock-rule acceptance path.
    /// Limit applies per rolling window to avoid permanent buyer lockout.
    const MAX_AUTO_KIOSKS_PER_BUYER: u64 = 32;
    const AUTO_KIOSK_LIMIT_WINDOW_MS: u64 = 24 * 60 * 60 * 1000;
    /// Hard cap on tracked buyers to prevent unbounded state growth.
    const MAX_TRACKED_AUTO_KIOSK_BUYERS: u64 = 4096;
    /// Opportunistic stale-window GC budget per update call.
    const AUTO_KIOSK_GC_SCAN_PER_CALL: u64 = 16;
    /// Max number of expired offers processed per cleanup tx.
    const MAX_EXPIRED_CLEANUPS_PER_TX: u64 = 32;
    /// Number of terminal offers to prune opportunistically per mutating call.
    const TERMINAL_OFFERS_PRUNE_BATCH: u64 = 16;

    // ========== Data Structures ==========

    public struct AutoKioskWindow has store {
        window_start_ms: u64,
        count: u64,
    }

    /// Represents a buyer's offer for an NFT
    public struct BuyerOffer has store {
        offerer: address,
        target_item_id: object::ID,  // ID::ZERO for collection offers
        collection_id: object::ID,
        offer_amount: u64,
        escrow: Balance<SUI>,
        expire_time: u64,
        status: u8,
        created_at: u64,
        is_collection_offer: bool,  // true for collection-level offers
        portfolio_id: option::Option<object::ID>,  // Link to OfferPortfolio if funded from portfolio
        /// Cleanup bounty to incentivize expired offer cleanup
        cleanup_bounty: Balance<SUI>,
        /// Timestamp after which third-party cleanup is allowed (expire_time + CLEANUP_GRACE_PERIOD_MS)
        can_cleanup_after: u64,
    }

    /// Shared object that manages all offers
    public struct OfferPool has key {
        id: object::UID,
        /// Map from item ID to list of offer IDs
        offers_by_item: Table<object::ID, vector<object::ID>>,
        /// Map from collection ID to list of collection offer IDs
        collection_offers: Table<object::ID, vector<object::ID>>,
        /// Map from offer ID to BuyerOffer
        offers: Table<object::ID, BuyerOffer>,
        /// Total number of active offers
        active_offers_count: u64,
        /// Total volume locked in offers
        total_volume_locked: u64,
        /// Registry of NFT types that have transfer policies
        /// Maps TypeName(with defining ids) to boolean (true = has policy)
        transfer_policies: Table<TypeName, bool>,
        /// Total cleanup bounty locked across all offers
        total_cleanup_bounty_locked: u64,
        /// Number of auto-created kiosks per buyer in kiosk_lock acceptance path.
        auto_kiosk_count_by_buyer: Table<address, AutoKioskWindow>,
        /// Bounded list of tracked buyers for stale-window GC/eviction.
        auto_kiosk_tracked_buyers: vector<address>,
        /// Round-robin cursor for auto kiosk tracking GC/eviction.
        auto_kiosk_gc_cursor: u64,
        /// Offer IDs that reached terminal states and are eligible for pruning.
        terminal_offer_ids: vector<object::ID>,
    }

    /// Witness type for marketplace offer operations
    public struct CpuMarketplaceOffer has drop {}

    /// Claim ticket for personal kiosk transfers
    /// Buyer can redeem this to complete the NFT transfer
    public struct PersonalKioskClaimTicket has key, store {
        id: object::UID,
        buyer: address,
        nft_type: String,        // Type name for verification
        nft_id: object::ID,
        collection_id: object::ID,
        offer_id: object::ID,
        seller: address,
        amount_paid: u64,
        created_at: u64,
        expires_at: u64,         // 7 days timeout for safety
        // [H-01 FIX] Policy snapshot for mismatch detection
        policy_id: object::ID,
        snapshot_has_royalty_rule: bool,
        snapshot_has_floor_price_rule: bool,
        snapshot_has_kiosk_lock_rule: bool,
        snapshot_has_personal_kiosk_rule: bool,
        // [L-02 FIX] Royalty parameter snapshot for parameter-level change detection
        snapshot_royalty_amount: u64,
        // Total rule count snapshot to detect custom rule additions/removals.
        snapshot_policy_rule_count: u64,
    }

    /// Temporary storage for NFTs awaiting claim
    /// Stored as dynamic field in OfferPool
    public struct TemporaryNftStorage<T: key + store> has store {
        nft: T,
        ticket_id: object::ID,
    }

    /// Key for accessing temporary storage
    public struct TemporaryStorageKey has copy, drop, store {
        ticket_id: object::ID,
    }

    /// Temporary storage for royalty payment until claim
    public struct TemporaryRoyaltyStorage has store {
        royalty_balance: Balance<SUI>,
        ticket_id: object::ID,
    }

    /// Key for accessing royalty storage
    public struct RoyaltyStorageKey has copy, drop, store {
        ticket_id: object::ID,
    }

    /// [H-01 FIX] Temporary storage for escrowed seller payment until claim
    /// Payment is only released to seller when buyer successfully claims.
    /// On expiry/cancellation, payment is refunded to buyer.
    public struct TemporaryPaymentStorage has store {
        payment_balance: Balance<SUI>,
        ticket_id: object::ID,
        buyer: address,
    }

    /// Key for accessing payment storage
    public struct PaymentStorageKey has copy, drop, store {
        ticket_id: object::ID,
    }

    /// Temporary storage for marketplace fee until claim finalization
    /// Prevents charging seller marketplace fees when claim never completes.
    public struct TemporaryMarketplaceFeeStorage has store {
        fee_balance: Balance<SUI>,
        ticket_id: object::ID,
    }

    /// Key for accessing marketplace fee storage
    public struct MarketplaceFeeStorageKey has copy, drop, store {
        ticket_id: object::ID,
    }

    /// Metadata stored alongside TemporaryNftStorage for claim recovery
    /// Enables seller-initiated recovery after 30 days without needing the ticket object
    public struct ClaimTicketMeta has store {
        seller: address,
        buyer: address,
        nft_type: String,
        nft_id: object::ID,
        collection_id: object::ID,
        created_at: u64,
        recovery_unlocks_at: u64,
    }

    /// Key for accessing claim ticket metadata
    public struct ClaimTicketMetaKey has copy, drop, store {
        ticket_id: object::ID,
    }

    // ========== Initialization ==========

    fun init(ctx: &mut tx_context::TxContext) {
        let pool = OfferPool {
            id: object::new(ctx),
            offers_by_item: table::new(ctx),
            collection_offers: table::new(ctx),
            offers: table::new(ctx),
            active_offers_count: 0,
            total_volume_locked: 0,
            transfer_policies: table::new(ctx),
            total_cleanup_bounty_locked: 0,
            auto_kiosk_count_by_buyer: table::new(ctx),
            auto_kiosk_tracked_buyers: vector[],
            auto_kiosk_gc_cursor: 0,
            terminal_offer_ids: vector[],
        };

        transfer::share_object(pool);
    }

    #[test_only]
    public fun test_init(ctx: &mut tx_context::TxContext) {
        init(ctx);
    }

    #[test_only]
    public fun test_track_auto_created_kiosk(pool: &mut OfferPool, buyer: address, clock: &Clock) {
        track_auto_created_kiosk_for_buyer(pool, buyer, clock);
    }

    #[test_only]
    public fun test_seed_collection_offers(
        pool: &mut OfferPool,
        collection_id: object::ID,
        offerer: address,
        offer_amount: u64,
        count: u64,
        expire_time: u64,
        ctx: &mut tx_context::TxContext,
    ) {
        if (!pool.collection_offers.contains(collection_id)) {
            pool.collection_offers.add(collection_id, vector[]);
        };
        let offers_ref = &mut pool.collection_offers[collection_id];
        let mut i = 0u64;
        while (i < count) {
            let offer_uid = object::new(ctx);
            let offer_id = object::uid_to_inner(&offer_uid);
            offer_uid.delete();
            let offer = BuyerOffer {
                offerer,
                target_item_id: object::id_from_address(@0x0),
                collection_id,
                offer_amount,
                escrow: balance::zero(),
                expire_time,
                status: OFFER_STATUS_ACTIVE,
                created_at: 0,
                is_collection_offer: true,
                portfolio_id: option::none(),
                cleanup_bounty: balance::zero(),
                can_cleanup_after: expire_time,
            };
            offers_ref.push_back(offer_id);
            pool.offers.add(offer_id, offer);
            pool.active_offers_count = pool.active_offers_count + 1;
            pool.total_volume_locked = pool.total_volume_locked + offer_amount;
            i = i + 1;
        };
    }

    // ========== Transfer Policy Registry ==========

    /// Register a transfer policy for an NFT type
    /// Called automatically on first offer creation with policy
    fun register_transfer_policy<T: key + store>(
        pool: &mut OfferPool,
        policy: &TransferPolicy<T>,
    ) {
        let tkey: TypeName = tn::with_defining_ids<T>();
        let has_rules = transfer_policy_utils::policy_rule_count(policy) > 0;

        if (has_rules) {
            if (!pool.transfer_policies.contains(tkey)) {
                pool.transfer_policies.add(tkey, true);
            };
        } else if (pool.transfer_policies.contains(tkey)) {
            let _ = pool.transfer_policies.remove(tkey);
        };
    }

    /// Sync the policy registry with the current rule set.
    /// If policy has zero rules, this removes the registry entry for the type.
    public fun sync_transfer_policy_registration<T: key + store>(
        pool: &mut OfferPool,
        policy: &TransferPolicy<T>,
    ) {
        register_transfer_policy(pool, policy);
    }

    /// Check if an NFT type has a registered transfer policy
    public fun has_registered_policy<T: key + store>(pool: &OfferPool): bool {
        let tkey: TypeName = tn::with_defining_ids<T>();
        pool.transfer_policies.contains(tkey)
    }

    /// Validate policy consistency - prevent mixing policy/no-policy offers
    /// If type is already registered with policy, new offers must also have policy
    fun validate_policy_consistency<T: key + store>(
        pool: &OfferPool,
        has_policy: bool,
    ) {
        let tkey: TypeName = tn::with_defining_ids<T>();
        if (pool.transfer_policies.contains(tkey)) {
            // Type is registered - must use policy-aware functions
            assert!(has_policy, EPolicyInconsistency);
        }
    }

    fun elapsed_ms(now: u64, start_ms: u64): u64 {
        if (now >= start_ms) {
            now - start_ms
        } else {
            0
        }
    }

    fun is_auto_kiosk_window_expired(window: &AutoKioskWindow, now: u64): bool {
        elapsed_ms(now, window.window_start_ms) >= AUTO_KIOSK_LIMIT_WINDOW_MS
    }

    fun gc_auto_kiosk_windows(pool: &mut OfferPool, now: u64) {
        let mut scanned = 0;
        while (scanned < AUTO_KIOSK_GC_SCAN_PER_CALL && !pool.auto_kiosk_tracked_buyers.is_empty()) {
            let len = pool.auto_kiosk_tracked_buyers.length();
            let idx = pool.auto_kiosk_gc_cursor % len;
            let buyer = pool.auto_kiosk_tracked_buyers[idx];

            let mut remove_entry = false;
            if (pool.auto_kiosk_count_by_buyer.contains(buyer)) {
                let window = &pool.auto_kiosk_count_by_buyer[buyer];
                if (is_auto_kiosk_window_expired(window, now)) {
                    remove_entry = true;
                }
            } else {
                remove_entry = true;
            };

            if (remove_entry) {
                if (pool.auto_kiosk_count_by_buyer.contains(buyer)) {
                    let AutoKioskWindow { window_start_ms: _, count: _ } =
                        pool.auto_kiosk_count_by_buyer.remove(buyer);
                };
                let _ = vector::swap_remove(&mut pool.auto_kiosk_tracked_buyers, idx);
            } else {
                pool.auto_kiosk_gc_cursor = pool.auto_kiosk_gc_cursor + 1;
            };

            scanned = scanned + 1;
        };
    }

    fun ensure_auto_kiosk_tracking_capacity(pool: &mut OfferPool, now: u64) {
        gc_auto_kiosk_windows(pool, now);
        while (pool.auto_kiosk_tracked_buyers.length() >= MAX_TRACKED_AUTO_KIOSK_BUYERS) {
            let len = pool.auto_kiosk_tracked_buyers.length();
            let idx = pool.auto_kiosk_gc_cursor % len;
            let buyer = pool.auto_kiosk_tracked_buyers[idx];
            if (pool.auto_kiosk_count_by_buyer.contains(buyer)) {
                let AutoKioskWindow { window_start_ms: _, count: _ } =
                    pool.auto_kiosk_count_by_buyer.remove(buyer);
            };
            let _ = vector::swap_remove(&mut pool.auto_kiosk_tracked_buyers, idx);
        };
    }

    fun record_terminal_offer(pool: &mut OfferPool, offer_id: object::ID) {
        pool.terminal_offer_ids.push_back(offer_id);
    }

    fun is_offer_prunable(offer: &BuyerOffer): bool {
        offer.status != OFFER_STATUS_ACTIVE &&
        offer.escrow.value() == 0 &&
        offer.cleanup_bounty.value() == 0
    }

    fun destroy_pruned_offer(offer: BuyerOffer) {
        let BuyerOffer {
            offerer: _,
            target_item_id: _,
            collection_id: _,
            offer_amount: _,
            escrow,
            expire_time: _,
            status: _,
            created_at: _,
            is_collection_offer: _,
            portfolio_id,
            cleanup_bounty,
            can_cleanup_after: _,
        } = offer;
        balance::destroy_zero(escrow);
        balance::destroy_zero(cleanup_bounty);
        if (portfolio_id.is_some()) {
            let _ = portfolio_id.destroy_some();
        } else {
            portfolio_id.destroy_none();
        };
    }

    fun prune_terminal_offers(pool: &mut OfferPool, max_to_prune: u64) {
        let mut pruned = 0;
        let mut scanned = 0;
        let max_to_scan = if (max_to_prune == 0) { 0 } else { max_to_prune * 4 };
        let mut deferred = vector[];

        while (
            pruned < max_to_prune &&
            scanned < max_to_scan &&
            !pool.terminal_offer_ids.is_empty()
        ) {
            let offer_id = pool.terminal_offer_ids.pop_back();
            if (pool.offers.contains(offer_id)) {
                let should_prune = {
                    let offer = &pool.offers[offer_id];
                    is_offer_prunable(offer)
                };
                if (should_prune) {
                    let offer = pool.offers.remove(offer_id);
                    destroy_pruned_offer(offer);
                    pruned = pruned + 1;
                } else {
                    deferred.push_back(offer_id);
                };
            };
            scanned = scanned + 1;
        };

        while (!deferred.is_empty()) {
            pool.terminal_offer_ids.push_back(deferred.pop_back());
        };
    }

    /// Ensure there is bounded index capacity for item offers.
    /// Performs on-demand compaction before enforcing hard limit.
    fun ensure_item_offer_capacity(
        pool: &mut OfferPool,
        item_id: object::ID,
        collection_id: object::ID,
    ) {
        if (!pool.offers_by_item.contains(item_id)) {
            pool.offers_by_item.add(item_id, vector[]);
            return
        };

        let len = {
            let offers_ref = &pool.offers_by_item[item_id];
            offers_ref.length()
        };
        if (len < MAX_OFFERS_PER_ITEM) {
            return
        };

        let _ = compact_offers_for_item_internal(pool, item_id, collection_id);

        let compacted_len = {
            let offers_ref = &pool.offers_by_item[item_id];
            offers_ref.length()
        };
        assert!(compacted_len < MAX_OFFERS_PER_ITEM, ETooManyOffersForItem);
    }

    /// Ensure there is bounded index capacity for collection offers.
    /// Performs on-demand compaction before enforcing hard limit.
    fun ensure_collection_offer_capacity(
        pool: &mut OfferPool,
        collection_id: object::ID,
        new_offer_amount: u64,
        current_time: u64,
        ctx: &mut tx_context::TxContext,
    ) {
        if (!pool.collection_offers.contains(collection_id)) {
            pool.collection_offers.add(collection_id, vector[]);
            return
        };

        let mut len = {
            let offers_ref = &pool.collection_offers[collection_id];
            offers_ref.length()
        };
        if (len < MAX_OFFERS_PER_COLLECTION) {
            return
        };

        let mut stale_entries = 0u64;
        let mut has_candidate = false;
        let mut lowest_offer_id = object::id_from_address(@0x0);
        let mut lowest_amount = 0u64;
        let mut i = 0u64;
        while (i < len) {
            let offer_id = {
                let offers_ref = &pool.collection_offers[collection_id];
                offers_ref[i]
            };

            if (!pool.offers.contains(offer_id)) {
                stale_entries = stale_entries + 1;
            } else {
                let mut should_expire = false;
                let mut is_active_non_expired = false;
                let mut offer_amount = 0u64;
                let is_terminal = {
                    let offer = &pool.offers[offer_id];
                    if (offer.status != OFFER_STATUS_ACTIVE) {
                        true
                    } else if (current_time >= offer.expire_time) {
                        should_expire = true;
                        true
                    } else {
                        is_active_non_expired = true;
                        offer_amount = offer.offer_amount;
                        false
                    }
                };
                if (is_terminal) {
                    stale_entries = stale_entries + 1;
                };
                if (should_expire) {
                    mark_offer_expired(pool, object::id_from_address(@0x0), offer_id, ctx);
                };
                if (is_active_non_expired) {
                    if (!has_candidate || offer_amount < lowest_amount) {
                        has_candidate = true;
                        lowest_offer_id = offer_id;
                        lowest_amount = offer_amount;
                    };
                }
            };
            i = i + 1;
        };

        if (stale_entries > 0) {
            let _ = compact_collection_offers_internal(pool, collection_id);
            len = {
                let offers_ref = &pool.collection_offers[collection_id];
                offers_ref.length()
            };
            if (len < MAX_OFFERS_PER_COLLECTION) {
                return
            };
        };

        assert!(has_candidate, ETooManyOffersForCollection);
        assert!(new_offer_amount > lowest_amount, EOfferNotCompetitiveForCollection);

        mark_offer_expired(pool, object::id_from_address(@0x0), lowest_offer_id, ctx);
        let _ = compact_collection_offers_internal(pool, collection_id);
        len = {
            let offers_ref = &pool.collection_offers[collection_id];
            offers_ref.length()
        };
        assert!(len < MAX_OFFERS_PER_COLLECTION, ETooManyOffersForCollection);
    }

    /// Track auto-created kiosks and enforce a per-buyer rate limit window.
    /// Windowing prevents permanent lockout while still bounding kiosk churn.
    fun track_auto_created_kiosk_for_buyer(
        pool: &mut OfferPool,
        buyer: address,
        clock: &Clock,
    ) {
        let now = clock::timestamp_ms(clock);
        gc_auto_kiosk_windows(pool, now);
        if (pool.auto_kiosk_count_by_buyer.contains(buyer)) {
            let window = pool.auto_kiosk_count_by_buyer.borrow_mut(buyer);
            let elapsed = elapsed_ms(now, window.window_start_ms);
            if (elapsed >= AUTO_KIOSK_LIMIT_WINDOW_MS) {
                window.window_start_ms = now;
                window.count = 1;
                return
            };
            assert!(window.count < MAX_AUTO_KIOSKS_PER_BUYER, ETooManyAutoCreatedKiosks);
            window.count = window.count + 1;
        } else {
            ensure_auto_kiosk_tracking_capacity(pool, now);
            pool.auto_kiosk_count_by_buyer.add(
                buyer,
                AutoKioskWindow {
                    window_start_ms: now,
                    count: 1,
                }
            );
            pool.auto_kiosk_tracked_buyers.push_back(buyer);
        };
    }

    fun count_supported_claim_policy_rules<T: key + store>(
        policy: &TransferPolicy<T>,
    ): u64 {
        let mut count = 0;
        if (transfer_policy_utils::has_royalty_rule(policy)) {
            count = count + 1;
        };
        if (transfer_policy_utils::has_floor_price_rule(policy)) {
            count = count + 1;
        };
        if (transfer_policy_utils::has_kiosk_lock_rule(policy)) {
            count = count + 1;
        };
        if (transfer_policy_utils::has_personal_kiosk_rule(policy)) {
            count = count + 1;
        };
        count
    }

    /// Claim flow supports only well-known kiosk rules that this module
    /// can explicitly prove/pay before `confirm_request`.
    fun assert_supported_claim_policy_rules<T: key + store>(
        policy: &TransferPolicy<T>,
    ) {
        let total_rules = transfer_policy_utils::policy_rule_count(policy);
        let supported_rules = count_supported_claim_policy_rules(policy);
        assert!(total_rules == supported_rules, EUnsupportedClaimTransferPolicyRules);
    }

    fun has_policy_snapshot_changed<T: key + store>(
        ticket: &PersonalKioskClaimTicket,
        policy: &TransferPolicy<T>,
    ): bool {
        let current_royalty_amount = transfer_policy_utils::calculate_royalty(policy, ticket.amount_paid);
        (
            ticket.snapshot_has_royalty_rule != transfer_policy_utils::has_royalty_rule(policy) ||
            ticket.snapshot_has_floor_price_rule != transfer_policy_utils::has_floor_price_rule(policy) ||
            ticket.snapshot_has_kiosk_lock_rule != transfer_policy_utils::has_kiosk_lock_rule(policy) ||
            ticket.snapshot_has_personal_kiosk_rule != transfer_policy_utils::has_personal_kiosk_rule(policy) ||
            ticket.snapshot_policy_rule_count != transfer_policy_utils::policy_rule_count(policy) ||
            ticket.snapshot_royalty_amount != current_royalty_amount
        )
    }

    // ========== Buyer Functions ==========

    /// Make an offer for a specific NFT
    public fun make_item_offer<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        item_id: object::ID,
        mut payment: Coin<SUI>,
        expire_days: u64,
        marketplace: &cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        cpu::core::assert_marketplace_not_paused(marketplace);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);

        // Disallow mixing no-policy offers when policy is registered for type
        validate_policy_consistency<T>(pool, false);

        let payment_value = payment.value();

        // Validate minimum gross payment before cleanup bounty extraction
        assert!(payment_value >= MIN_OFFER_AMOUNT, EOfferAmountTooLow);
        assert!(expire_days > 0 && expire_days <= MAX_EXPIRE_DAYS, EInvalidExpireDays);

        // Calculate and extract cleanup bounty
        let bounty_amount = calculate_cleanup_bounty(payment_value);
        let bounty_coin = payment.split(bounty_amount, ctx);
        let offer_amount = payment.value();

        let offerer = ctx.sender();
        let current_time = clock::timestamp_ms(clock);
        let expire_time = current_time + (expire_days * 24 * 60 * 60 * 1000);
        let can_cleanup_after = expire_time + CLEANUP_GRACE_PERIOD_MS;
        let collection_id = object::id(collection);

        // Check for duplicate active offers from the same buyer
        if (pool.offers_by_item.contains(item_id)) {
            let len;
            {
                let offers_ref = &pool.offers_by_item[item_id];
                len = offers_ref.length();
            };

            let mut i = 0;
            while (i < len) {
                let offer_id = {
                    let offers_ref = &pool.offers_by_item[item_id];
                    offers_ref[i]
                };

                if (pool.offers.contains(offer_id)) {
                    let mut should_expire = false;
                    {
                        let existing_offer = &pool.offers[offer_id];
                        if (existing_offer.offerer == offerer &&
                            existing_offer.status == OFFER_STATUS_ACTIVE) {
                            if (current_time >= existing_offer.expire_time) {
                                should_expire = true;
                            } else {
                                abort EOfferAlreadyExists
                            }
                        };
                    };
                    if (should_expire) {
                        mark_offer_expired(pool, item_id, offer_id, ctx);
                    }
                };

                i = i + 1;
            };
        };

        // Create new offer
        let offer_uid = object::new(ctx);
        let offer_id = object::uid_to_inner(&offer_uid);
        offer_uid.delete();

        let offer = BuyerOffer {
            offerer,
            target_item_id: item_id,
            collection_id,
            offer_amount,
            escrow: payment.into_balance(),
            expire_time,
            status: OFFER_STATUS_ACTIVE,
            created_at: current_time,
            is_collection_offer: false,
            portfolio_id: option::none(),
            cleanup_bounty: bounty_coin.into_balance(),
            can_cleanup_after,
        };

        // Update offer tracking
        ensure_item_offer_capacity(pool, item_id, collection_id);
        let item_offers = &mut pool.offers_by_item[item_id];
        item_offers.push_back(offer_id);

        pool.offers.add(offer_id, offer);

        // Update statistics
        pool.active_offers_count = pool.active_offers_count + 1;
        pool.total_volume_locked = pool.total_volume_locked + offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked + bounty_amount;

        // Emit event
        events::emit_offer_made_event<T>(
            collection,
            offer_id,
            offerer,
            item_id,
            offer_amount,
            expire_time,
        );
    }

    /// Cancel an active offer and get refund
    /// For portfolio offers, funds remain in portfolio
    /// Returns the refunded coin for composability
    public fun cancel_offer(
        pool: &mut OfferPool,
        offer_id: object::ID,
        ctx: &mut tx_context::TxContext,
    ): Coin<SUI> {
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer = &mut pool.offers[offer_id];
        let sender = ctx.sender();

        assert!(offer.offerer == sender, ENotOfferOwner);
        assert!(offer.status == OFFER_STATUS_ACTIVE, EOfferNotActive);

        let refund_amount = offer.offer_amount;
        let bounty_amount = offer.cleanup_bounty.value();
        let collection_id = offer.collection_id;
        offer.status = OFFER_STATUS_CANCELLED;

        // For portfolio offers, caller must use cancel_portfolio_offer
        assert!(offer.portfolio_id.is_none(), ECannotCancelPortfolioOffer);

        // Refund the escrowed amount + cleanup bounty (regular offers only)
        let mut refund = coin::from_balance(
            balance::withdraw_all(&mut offer.escrow),
            ctx
        );
        let bounty = coin::from_balance(
            balance::withdraw_all(&mut offer.cleanup_bounty),
            ctx
        );
        coin::join(&mut refund, bounty);

        // Update statistics
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - refund_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Emit event
        events::emit_offer_cancelled_event(
            offer_id,
            sender,
            refund_amount,
            collection_id,
        );
        record_terminal_offer(pool, offer_id);

        // Return refund for composability
        refund
    }

    /// Cancel a portfolio-funded offer
    /// Funds are released back to portfolio's available balance
    public fun cancel_portfolio_offer(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        offer_id: object::ID,
        ctx: &mut tx_context::TxContext,
    ) {
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer = &mut pool.offers[offer_id];
        let sender = ctx.sender();

        assert!(offer.offerer == sender, ENotOfferOwner);
        assert!(offer.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer.portfolio_id.is_some(), ENotPortfolioOffer);

        // Verify portfolio ID matches
        let portfolio_id = offer_portfolio::get_id(portfolio);
        assert!(*offer.portfolio_id.borrow() == portfolio_id, EPortfolioIdMismatch);

        let refund_amount = offer.offer_amount;
        let bounty_amount = offer.cleanup_bounty.value();
        let collection_id = offer.collection_id;
        offer.status = OFFER_STATUS_CANCELLED;

        // Refund to portfolio (releases commitment, funds stay in portfolio)
        // Guard to avoid aborts if already refunded
        if (offer_portfolio::is_offer_committed(portfolio, offer_id)) {
            offer_portfolio::refund_offer(portfolio, offer_id);
        };

        // Return cleanup bounty to portfolio balance
        let bounty_balance = balance::withdraw_all(&mut offer.cleanup_bounty);
        offer_portfolio::return_bounty(portfolio, bounty_balance);

        // Update statistics
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - refund_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Emit event
        events::emit_portfolio_offer_cancelled_event(
            offer_id,
            sender,
            refund_amount,
            collection_id,
            portfolio_id,
        );
        record_terminal_offer(pool, offer_id);
    }

    // ========== Cleanup Functions ==========

    /// Calculate cleanup bounty amount based on offer payment
    /// Returns: bounty amount (0.5% of payment, capped at 0.01 SUI, minimum 0.000001 SUI)
    fun calculate_cleanup_bounty(payment_value: u64): u64 {
        // Safe decomposed multiplication to avoid u64 overflow (same pattern as fees::calculate_fee)
        let denom = 1_000_000_000;
        let q = payment_value / denom;
        let r = payment_value % denom;
        let bounty_bp = q * CLEANUP_BOUNTY_BP + (r * CLEANUP_BOUNTY_BP) / denom;

        if (bounty_bp > MAX_CLEANUP_BOUNTY) {
            MAX_CLEANUP_BOUNTY
        } else if (bounty_bp < 1000) {
            1000
        } else {
            bounty_bp
        }
    }

    /// Offerer self-cleans their expired offer
    /// Can be called immediately after expiry
    /// Returns: offer_amount + cleanup_bounty (full refund)
    public fun self_clean_expired_offer(
        pool: &mut OfferPool,
        offer_id: object::ID,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): Coin<SUI> {
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer = &mut pool.offers[offer_id];
        let sender = ctx.sender();
        let current_time = clock::timestamp_ms(clock);

        assert!(offer.offerer == sender, ENotOfferOwner);
        assert!(offer.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(current_time >= offer.expire_time, EOfferNotExpired);
        assert!(offer.portfolio_id.is_none(), EPortfolioCleanupRequiresPortfolio);

        offer.status = OFFER_STATUS_EXPIRED;

        let bounty_amount = offer.cleanup_bounty.value();
        let escrow_amount = offer.offer_amount;
        let total_refund = bounty_amount + escrow_amount;
        let collection_id = offer.collection_id;

        // Withdraw escrow (regular offers only).
        let mut refund = coin::from_balance(
            balance::withdraw_all(&mut offer.escrow),
            ctx
        );

        // Add bounty to refund
        let bounty = coin::from_balance(
            balance::withdraw_all(&mut offer.cleanup_bounty),
            ctx
        );
        coin::join(&mut refund, bounty);

        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - escrow_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        events::emit_offer_self_cleaned_event(
            offer_id,
            sender,
            total_refund,
            collection_id,
        );
        record_terminal_offer(pool, offer_id);

        refund
    }

    /// Portfolio owner self-cleans an expired portfolio-backed offer and releases commitment.
    /// This is the portfolio-aware single-transaction cleanup path.
    public fun self_clean_expired_portfolio_offer(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        offer_id: object::ID,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        assert!(pool.offers.contains(offer_id), EOfferNotFound);
        offer_portfolio::verify_owner(portfolio, ctx);

        let offer = &mut pool.offers[offer_id];
        let sender = ctx.sender();
        let current_time = clock::timestamp_ms(clock);

        assert!(offer.offerer == sender, ENotOfferOwner);
        assert!(offer.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(current_time >= offer.expire_time, EOfferNotExpired);
        assert!(offer.portfolio_id.is_some(), ENotPortfolioOffer);

        let portfolio_id = offer_portfolio::get_id(portfolio);
        assert!(*offer.portfolio_id.borrow() == portfolio_id, EPortfolioIdMismatch);

        offer.status = OFFER_STATUS_EXPIRED;

        let bounty_amount = offer.cleanup_bounty.value();
        let escrow_amount = offer.offer_amount;
        let total_refund = bounty_amount + escrow_amount;
        let collection_id = offer.collection_id;

        // Release committed offer funds back to available portfolio balance.
        if (offer_portfolio::is_offer_committed(portfolio, offer_id)) {
            offer_portfolio::refund_offer(portfolio, offer_id);
        };

        // Return bounty to portfolio balance.
        let bounty_balance = balance::withdraw_all(&mut offer.cleanup_bounty);
        offer_portfolio::return_bounty(portfolio, bounty_balance);

        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - escrow_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        events::emit_offer_self_cleaned_event(
            offer_id,
            sender,
            total_refund,
            collection_id,
        );
        record_terminal_offer(pool, offer_id);
    }

    /// Clean expired offer and claim cleanup bounty (third-party cleanup)
    /// Requires grace period to have passed (expire_time + 7 days)
    /// Returns: cleanup_bounty to caller, offer_amount refunded to original offerer
    public fun clean_expired_offer_with_bounty(
        pool: &mut OfferPool,
        offer_id: object::ID,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): Coin<SUI> {
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer = &mut pool.offers[offer_id];
        let current_time = clock::timestamp_ms(clock);

        assert!(offer.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(current_time >= offer.expire_time, EOfferNotExpired);
        assert!(current_time >= offer.can_cleanup_after, ECleanupGracePeriodNotPassed);
        assert!(offer.portfolio_id.is_none(), EPortfolioCleanupRequiresPortfolio);

        offer.status = OFFER_STATUS_EXPIRED;

        let bounty_amount = offer.cleanup_bounty.value();
        let escrow_amount = offer.offer_amount;
        let offerer = offer.offerer;
        let collection_id = offer.collection_id;
        let cleaner = ctx.sender();

        // Extract bounty for caller
        let bounty = coin::from_balance(
            balance::withdraw_all(&mut offer.cleanup_bounty),
            ctx
        );

        // Refund escrow to original offerer.
        let refund = coin::from_balance(
            balance::withdraw_all(&mut offer.escrow),
            ctx
        );
        transfer::public_transfer(refund, offerer);

        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - escrow_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        events::emit_offer_cleaned_by_third_party_event(
            offer_id,
            cleaner,
            offerer,
            bounty_amount,
            escrow_amount,
            collection_id,
        );
        record_terminal_offer(pool, offer_id);

        bounty
    }

    /// Update an existing offer with additional payment
    public fun update_offer<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        offer_id: object::ID,
        additional_payment: Coin<SUI>,
        marketplace: &cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        cpu::core::assert_marketplace_not_paused(marketplace);
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer = &mut pool.offers[offer_id];
        let sender = ctx.sender();

        assert!(offer.offerer == sender, ENotOfferOwner);
        assert!(offer.status == OFFER_STATUS_ACTIVE, EOfferNotActive);

        // Portfolio-backed offers must use update_portfolio_offer instead
        assert!(offer.portfolio_id.is_none(), ECannotUpdatePortfolioOffer);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer.expire_time, EOfferExpired);

        let additional_amount = additional_payment.value();
        assert!(additional_amount > 0, EIncreaseRequired);
        let old_amount = offer.offer_amount;
        let item_id = offer.target_item_id;

        // Update offer amount and escrow
        coin::put(&mut offer.escrow, additional_payment);
        offer.offer_amount = offer.offer_amount + additional_amount;

        // Update total volume locked
        pool.total_volume_locked = pool.total_volume_locked + additional_amount;

        // Emit event
        events::emit_offer_updated_event<T>(
            collection,
            offer_id,
            sender,
            item_id,
            old_amount,
            offer.offer_amount,
        );
    }

    /// Update a portfolio-backed offer by increasing the commitment from the portfolio
    /// This increases the offer amount without requiring additional coin payment
    public fun update_portfolio_offer<T: key + store>(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection: &NftCollection<T>,
        offer_id: object::ID,
        new_amount: u64,
        marketplace: &cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        cpu::core::assert_marketplace_not_paused(marketplace);
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        // Verify portfolio ownership
        offer_portfolio::verify_owner(portfolio, ctx);

        let offer = &mut pool.offers[offer_id];
        let sender = ctx.sender();

        assert!(offer.offerer == sender, ENotOfferOwner);
        assert!(offer.status == OFFER_STATUS_ACTIVE, EOfferNotActive);

        // Must be a portfolio-backed offer
        assert!(offer.portfolio_id.is_some(), ENotPortfolioOffer);

        // Verify portfolio ID matches
        let portfolio_id = offer_portfolio::get_id(portfolio);
        assert!(*offer.portfolio_id.borrow() == portfolio_id, EPortfolioIdMismatch);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer.expire_time, EOfferExpired);

        let old_amount = offer.offer_amount;
        let item_id = offer.target_item_id;

        // New amount must be greater than old amount
        assert!(new_amount > old_amount, EIncreaseRequired);
        let increase = new_amount - old_amount;

        // Check portfolio has sufficient available balance
        assert!(
            offer_portfolio::has_available_balance(portfolio, increase),
            EInsufficientPortfolioBalance
        );

        // Update portfolio commitment
        offer_portfolio::update_commitment(portfolio, offer_id, new_amount);

        // Update offer amount (no escrow change needed - funds stay in portfolio)
        offer.offer_amount = new_amount;

        // Update total volume locked
        pool.total_volume_locked = pool.total_volume_locked + increase;

        // Emit event
        events::emit_offer_updated_event<T>(
            collection,
            offer_id,
            sender,
            item_id,
            old_amount,
            new_amount,
        );
    }

    /// Make an offer for any NFT in a collection
    public fun make_collection_offer<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        mut payment: Coin<SUI>,
        expire_days: u64,
        marketplace: &cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        cpu::core::assert_marketplace_not_paused(marketplace);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);

        // Disallow mixing no-policy offers when policy is registered for type
        validate_policy_consistency<T>(pool, false);

        let payment_value = payment.value();
        assert!(payment_value >= MIN_OFFER_AMOUNT, EOfferAmountTooLow);
        assert!(expire_days > 0 && expire_days <= MAX_EXPIRE_DAYS, EInvalidExpireDays);

        // Calculate and extract cleanup bounty
        let bounty_amount = calculate_cleanup_bounty(payment_value);
        let bounty_coin = payment.split(bounty_amount, ctx);
        let offer_amount = payment.value();

        let offerer = ctx.sender();
        let current_time = clock::timestamp_ms(clock);
        let expire_time = current_time + (expire_days * 24 * 60 * 60 * 1000);
        let can_cleanup_after = expire_time + CLEANUP_GRACE_PERIOD_MS;
        let collection_id = object::id(collection);

        // Create new collection offer
        let offer_uid = object::new(ctx);
        let offer_id = object::uid_to_inner(&offer_uid);
        offer_uid.delete();

        let offer = BuyerOffer {
            offerer,
            target_item_id: object::id_from_address(@0x0), // Placeholder for collection offers
            collection_id,
            offer_amount,
            escrow: payment.into_balance(),
            expire_time,
            status: OFFER_STATUS_ACTIVE,
            created_at: current_time,
            is_collection_offer: true,
            portfolio_id: option::none(),
            cleanup_bounty: bounty_coin.into_balance(),
            can_cleanup_after,
        };

        // Add to collection offers index
        ensure_collection_offer_capacity(pool, collection_id, offer_amount, current_time, ctx);
        let collection_offer_list = &mut pool.collection_offers[collection_id];
        collection_offer_list.push_back(offer_id);

        pool.offers.add(offer_id, offer);

        // Update statistics
        pool.active_offers_count = pool.active_offers_count + 1;
        pool.total_volume_locked = pool.total_volume_locked + offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked + bounty_amount;

        // Emit event
        events::emit_collection_offer_made_event<T>(
            collection,
            offer_id,
            offerer,
            offer_amount,
            expire_time,
        );
    }

    /// Make an offer for a specific NFT with transfer policy awareness
    /// This function validates the offer against the transfer policy requirements
    public fun make_item_offer_with_policy<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        item_id: object::ID,
        mut payment: Coin<SUI>,
        expire_days: u64,
        policy: &TransferPolicy<T>,
        marketplace: &cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        cpu::core::assert_marketplace_not_paused(marketplace);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);

        let payment_value = payment.value();
        assert!(payment_value >= MIN_OFFER_AMOUNT, EOfferAmountTooLow);
        assert!(expire_days > 0 && expire_days <= MAX_EXPIRE_DAYS, EInvalidExpireDays);

        // Validate policy consistency
        validate_policy_consistency<T>(pool, true);

        // Register this type's policy if first time
        register_transfer_policy<T>(pool, policy);

        // NOTE: Cannot validate floor price at offer creation time
        // Floor price enforcement happens during transfer confirmation via floor_price_rule::prove()
        // UIs should check has_floor_price_rule() and warn users accordingly

        // Calculate and extract cleanup bounty
        let bounty_amount = calculate_cleanup_bounty(payment_value);
        let bounty_coin = payment.split(bounty_amount, ctx);
        let offer_amount = payment.value();

        // Proceed with standard offer creation
        let offerer = ctx.sender();
        let current_time = clock::timestamp_ms(clock);
        let expire_time = current_time + (expire_days * 24 * 60 * 60 * 1000);
        let can_cleanup_after = expire_time + CLEANUP_GRACE_PERIOD_MS;
        let collection_id = object::id(collection);

        // Check for duplicate active offers from the same buyer
        if (pool.offers_by_item.contains(item_id)) {
            let len;
            {
                let offers_ref = &pool.offers_by_item[item_id];
                len = offers_ref.length();
            };

            let mut i = 0;
            while (i < len) {
                let offer_id = {
                    let offers_ref = &pool.offers_by_item[item_id];
                    offers_ref[i]
                };

                if (pool.offers.contains(offer_id)) {
                    let mut should_expire = false;
                    {
                        let existing_offer = &pool.offers[offer_id];
                        if (existing_offer.offerer == offerer &&
                            existing_offer.status == OFFER_STATUS_ACTIVE) {
                            if (current_time >= existing_offer.expire_time) {
                                should_expire = true;
                            } else {
                                abort EOfferAlreadyExists
                            }
                        };
                    };

                    if (should_expire) {
                        mark_offer_expired(pool, item_id, offer_id, ctx);
                    }
                };

                i = i + 1;
            };
        };

        // Create new offer
        let offer_uid = object::new(ctx);
        let offer_id = object::uid_to_inner(&offer_uid);
        offer_uid.delete();

        let offer = BuyerOffer {
            offerer,
            target_item_id: item_id,
            collection_id,
            offer_amount,
            escrow: payment.into_balance(),
            expire_time,
            status: OFFER_STATUS_ACTIVE,
            created_at: current_time,
            is_collection_offer: false,
            portfolio_id: option::none(),
            cleanup_bounty: bounty_coin.into_balance(),
            can_cleanup_after,
        };

        // Add to item offers index
        ensure_item_offer_capacity(pool, item_id, collection_id);
        let item_offer_list = &mut pool.offers_by_item[item_id];
        item_offer_list.push_back(offer_id);

        pool.offers.add(offer_id, offer);

        // Update statistics
        pool.active_offers_count = pool.active_offers_count + 1;
        pool.total_volume_locked = pool.total_volume_locked + offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked + bounty_amount;

        // Emit event
        events::emit_offer_made_event<T>(
            collection,
            offer_id,
            offerer,
            item_id,
            offer_amount,
            expire_time,
        );
    }

    /// Make a collection-level offer with transfer policy awareness
    /// This function validates the offer against the transfer policy requirements
    public fun make_collection_offer_with_policy<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        mut payment: Coin<SUI>,
        expire_days: u64,
        policy: &TransferPolicy<T>,
        marketplace: &cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        cpu::core::assert_marketplace_not_paused(marketplace);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);

        let payment_value = payment.value();
        assert!(payment_value >= MIN_OFFER_AMOUNT, EOfferAmountTooLow);
        assert!(expire_days > 0 && expire_days <= MAX_EXPIRE_DAYS, EInvalidExpireDays);

        // Validate policy consistency
        validate_policy_consistency<T>(pool, true);

        // Register this type's policy if first time
        register_transfer_policy<T>(pool, policy);

        // NOTE: Cannot validate floor price at offer creation time
        // Floor price enforcement happens during transfer confirmation via floor_price_rule::prove()
        // UIs should check has_floor_price_rule() and warn users accordingly

        // Calculate and extract cleanup bounty
        let bounty_amount = calculate_cleanup_bounty(payment_value);
        let bounty_coin = payment.split(bounty_amount, ctx);
        let offer_amount = payment.value();

        let offerer = ctx.sender();
        let current_time = clock::timestamp_ms(clock);
        let expire_time = current_time + (expire_days * 24 * 60 * 60 * 1000);
        let can_cleanup_after = expire_time + CLEANUP_GRACE_PERIOD_MS;
        let collection_id = object::id(collection);

        // Create new collection offer
        let offer_uid = object::new(ctx);
        let offer_id = object::uid_to_inner(&offer_uid);
        offer_uid.delete();

        let offer = BuyerOffer {
            offerer,
            target_item_id: object::id_from_address(@0x0), // Placeholder for collection offers
            collection_id,
            offer_amount,
            escrow: payment.into_balance(),
            expire_time,
            status: OFFER_STATUS_ACTIVE,
            created_at: current_time,
            is_collection_offer: true,
            portfolio_id: option::none(),
            cleanup_bounty: bounty_coin.into_balance(),
            can_cleanup_after,
        };

        // Add to collection offers index
        ensure_collection_offer_capacity(pool, collection_id, offer_amount, current_time, ctx);
        let collection_offer_list = &mut pool.collection_offers[collection_id];
        collection_offer_list.push_back(offer_id);

        pool.offers.add(offer_id, offer);

        // Update statistics
        pool.active_offers_count = pool.active_offers_count + 1;
        pool.total_volume_locked = pool.total_volume_locked + offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked + bounty_amount;

        // Emit event
        events::emit_collection_offer_made_event<T>(
            collection,
            offer_id,
            offerer,
            offer_amount,
            expire_time,
        );
    }

    // ========== Portfolio-Based Offer Functions ==========

    /// Make an item-specific offer funded from a portfolio
    /// The portfolio commits the funds but doesn't transfer them until offer is accepted
    public fun make_portfolio_item_offer<T: key + store>(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection: &NftCollection<T>,
        item_id: object::ID,
        offer_amount: u64,
        expire_days: u64,
        policy: &TransferPolicy<T>,
        marketplace: &cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        cpu::core::assert_marketplace_not_paused(marketplace);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);

        // Verify caller is portfolio owner
        offer_portfolio::verify_owner(portfolio, ctx);

        // Validate policy consistency
        validate_policy_consistency<T>(pool, true);

        // Register this type's policy if first time
        register_transfer_policy<T>(pool, policy);

        assert!(offer_amount >= MIN_OFFER_AMOUNT, EOfferAmountTooLow);
        assert!(expire_days > 0 && expire_days <= MAX_EXPIRE_DAYS, EInvalidExpireDays);

        // Calculate cleanup bounty
        let bounty_amount = calculate_cleanup_bounty(offer_amount);
        let total_required = offer_amount + bounty_amount;

        // Check portfolio has sufficient available balance for offer + bounty
        assert!(
            offer_portfolio::has_available_balance(portfolio, total_required),
            EInsufficientPortfolioBalance
        );

        let offerer = ctx.sender();
        let current_time = clock::timestamp_ms(clock);
        let expire_time = current_time + (expire_days * 24 * 60 * 60 * 1000);
        let can_cleanup_after = expire_time + CLEANUP_GRACE_PERIOD_MS;
        let collection_id = object::id(collection);
        let portfolio_id = offer_portfolio::get_id(portfolio);

        // Check for duplicate active offers from the same buyer
        if (pool.offers_by_item.contains(item_id)) {
            let len;
            {
                let offers_ref = &pool.offers_by_item[item_id];
                len = offers_ref.length();
            };

            let mut i = 0;
            while (i < len) {
                let offer_id = {
                    let offers_ref = &pool.offers_by_item[item_id];
                    offers_ref[i]
                };

                if (pool.offers.contains(offer_id)) {
                    let mut should_expire = false;
                    let mut should_refund_portfolio = false;
                    {
                        let existing_offer = &pool.offers[offer_id];
                        if (existing_offer.offerer == offerer &&
                            existing_offer.status == OFFER_STATUS_ACTIVE) {
                            if (current_time >= existing_offer.expire_time) {
                                should_expire = true;
                                // Check if this is a portfolio offer from the same portfolio
                                if (existing_offer.portfolio_id.is_some() &&
                                    *existing_offer.portfolio_id.borrow() == portfolio_id) {
                                    should_refund_portfolio = true;
                                }
                            } else {
                                abort EOfferAlreadyExists
                            }
                        };
                    };
                    if (should_expire) {
                        // Refund portfolio commitment before marking as expired
                        // Guard to avoid aborts if already refunded
                        if (should_refund_portfolio) {
                            if (offer_portfolio::is_offer_committed(portfolio, offer_id)) {
                                offer_portfolio::refund_offer(portfolio, offer_id);
                            };
                        };
                        mark_offer_expired(pool, item_id, offer_id, ctx);
                    }
                };

                i = i + 1;
            };
        };

        // Create new offer
        let offer_uid = object::new(ctx);
        let offer_id = object::uid_to_inner(&offer_uid);
        offer_uid.delete();

        // Extract cleanup bounty from portfolio balance
        let bounty_balance = offer_portfolio::extract_bounty(portfolio, bounty_amount);

        // Commit offer amount in portfolio (no balance transferred yet)
        offer_portfolio::commit_offer(portfolio, offer_id, offer_amount);

        let offer = BuyerOffer {
            offerer,
            target_item_id: item_id,
            collection_id,
            offer_amount,
            escrow: balance::zero(), // Empty escrow - funds stay in portfolio
            expire_time,
            status: OFFER_STATUS_ACTIVE,
            created_at: current_time,
            is_collection_offer: false,
            portfolio_id: option::some(portfolio_id),
            cleanup_bounty: bounty_balance,
            can_cleanup_after,
        };

        // Update offer tracking
        ensure_item_offer_capacity(pool, item_id, collection_id);
        let item_offers = &mut pool.offers_by_item[item_id];
        item_offers.push_back(offer_id);

        pool.offers.add(offer_id, offer);

        // Update statistics
        pool.active_offers_count = pool.active_offers_count + 1;
        pool.total_volume_locked = pool.total_volume_locked + offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked + bounty_amount;

        // Emit event
        events::emit_portfolio_offer_made_event<T>(
            collection,
            offer_id,
            offerer,
            item_id,
            offer_amount,
            expire_time,
            portfolio_id,
        );
    }

    /// Make a collection-level offer funded from a portfolio
    public fun make_portfolio_collection_offer<T: key + store>(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection: &NftCollection<T>,
        offer_amount: u64,
        expire_days: u64,
        policy: &TransferPolicy<T>,
        marketplace: &cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        cpu::core::assert_marketplace_not_paused(marketplace);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);

        // Verify caller is portfolio owner
        offer_portfolio::verify_owner(portfolio, ctx);

        // Validate policy consistency
        validate_policy_consistency<T>(pool, true);

        // Register this type's policy if first time
        register_transfer_policy<T>(pool, policy);

        assert!(offer_amount >= MIN_OFFER_AMOUNT, EOfferAmountTooLow);
        assert!(expire_days > 0 && expire_days <= MAX_EXPIRE_DAYS, EInvalidExpireDays);

        // Calculate cleanup bounty
        let bounty_amount = calculate_cleanup_bounty(offer_amount);
        let total_required = offer_amount + bounty_amount;

        // Check portfolio has sufficient available balance for offer + bounty
        assert!(
            offer_portfolio::has_available_balance(portfolio, total_required),
            EInsufficientPortfolioBalance
        );

        let offerer = ctx.sender();
        let current_time = clock::timestamp_ms(clock);
        let expire_time = current_time + (expire_days * 24 * 60 * 60 * 1000);
        let can_cleanup_after = expire_time + CLEANUP_GRACE_PERIOD_MS;
        let collection_id = object::id(collection);
        let portfolio_id = offer_portfolio::get_id(portfolio);

        // Check for duplicate expired collection offers from same portfolio
        if (pool.collection_offers.contains(collection_id)) {
            let len;
            {
                let offers_ref = &pool.collection_offers[collection_id];
                len = offers_ref.length();
            };

            let mut i = 0;
            while (i < len) {
                let existing_offer_id = {
                    let offers_ref = &pool.collection_offers[collection_id];
                    offers_ref[i]
                };

                if (pool.offers.contains(existing_offer_id)) {
                    let mut should_expire = false;
                    let mut should_refund_portfolio = false;
                    {
                        let existing_offer = &pool.offers[existing_offer_id];
                        if (existing_offer.offerer == offerer &&
                            existing_offer.status == OFFER_STATUS_ACTIVE &&
                            current_time >= existing_offer.expire_time) {
                            should_expire = true;
                            // Check if this is from the same portfolio
                            if (existing_offer.portfolio_id.is_some() &&
                                *existing_offer.portfolio_id.borrow() == portfolio_id) {
                                should_refund_portfolio = true;
                            }
                        }
                    };

                    if (should_expire) {
                        // Refund portfolio commitment before marking as expired
                        // Guard to avoid aborts if already refunded
                        if (should_refund_portfolio) {
                            if (offer_portfolio::is_offer_committed(portfolio, existing_offer_id)) {
                                offer_portfolio::refund_offer(portfolio, existing_offer_id);
                            };
                        };
                        // For collection offers, use placeholder ID
                        mark_offer_expired(pool, object::id_from_address(@0x0), existing_offer_id, ctx);
                    }
                };

                i = i + 1;
            };
        };

        // Create new collection offer
        let offer_uid = object::new(ctx);
        let offer_id = object::uid_to_inner(&offer_uid);
        offer_uid.delete();

        // Extract cleanup bounty from portfolio balance
        let bounty_balance = offer_portfolio::extract_bounty(portfolio, bounty_amount);

        // Commit offer amount in portfolio
        offer_portfolio::commit_offer(portfolio, offer_id, offer_amount);

        let offer = BuyerOffer {
            offerer,
            target_item_id: object::id_from_address(@0x0), // Placeholder for collection offers
            collection_id,
            offer_amount,
            escrow: balance::zero(), // Empty escrow - funds stay in portfolio
            expire_time,
            status: OFFER_STATUS_ACTIVE,
            created_at: current_time,
            is_collection_offer: true,
            portfolio_id: option::some(portfolio_id),
            cleanup_bounty: bounty_balance,
            can_cleanup_after,
        };

        // Add to collection offers index
        ensure_collection_offer_capacity(pool, collection_id, offer_amount, current_time, ctx);
        let collection_offer_list = &mut pool.collection_offers[collection_id];
        collection_offer_list.push_back(offer_id);

        pool.offers.add(offer_id, offer);

        // Update statistics
        pool.active_offers_count = pool.active_offers_count + 1;
        pool.total_volume_locked = pool.total_volume_locked + offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked + bounty_amount;

        // Emit event
        events::emit_portfolio_collection_offer_made_event<T>(
            collection,
            offer_id,
            offerer,
            offer_amount,
            expire_time,
            portfolio_id,
        );
    }

    // ========== Seller Functions ==========

    /// Accept an offer and transfer the NFT
    /// The seller must provide additional funds to cover marketplace fees
    /// Supports both regular offers and portfolio-funded offers
    /// Returns any excess fee payment for composability
    public fun accept_offer<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,
        offer_id: object::ID,
        marketplace: &mut cpu::core::CpuMarketplace,
        policy: &mut TransferPolicy<T>,
        mut fee_payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): Coin<SUI> {
        // Check marketplace is not paused
        cpu::core::assert_marketplace_not_paused(marketplace);

        // ========== PHASE 1: READ-ONLY VALIDATION ==========
        // Read offer first to get values, DON'T modify status yet
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer_ref = &pool.offers[offer_id];
        assert!(offer_ref.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer_ref.target_item_id == item_id, EInvalidItemId);
        assert!(offer_ref.portfolio_id.is_none(), ENotPortfolioOffer);

        // Verify the NFT belongs to the correct collection
        let collection_id = object::id(collection);
        assert!(offer_ref.collection_id == collection_id, EWrongCollection);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer_ref.expire_time, EOfferExpired);

        let offer_amount = offer_ref.offer_amount;
        let offerer = offer_ref.offerer;
        // [M-02 FIX] Prevent self-acceptance (wash trading)
        assert!(ctx.sender() != offerer, ESelfAcceptanceNotAllowed);

        // ========== PHASE 2: FEE VALIDATION ==========
        cpu::core::validate_version(marketplace);
        // Validate transfer policy requirements
        // Calculate royalty from policy
        let royalty_amount = transfer_policy_utils::calculate_royalty<T>(policy, offer_amount);

        // Early guard (intentionally redundant with Phase 4 total-fee check):
        // fail fast when royalty is clearly uncovered before doing item operations.
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= royalty_amount, EInsufficientFeePayment);

        // NOTE: Cannot validate floor price here - enforcement happens during transfer
        // via floor_price_rule::prove(). If offer is below floor price, the transfer
        // will fail at that point.

        // Handle zero-price edge case
        if (offer_amount == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // ========== PHASE 3: FUND EXTRACTION ==========
        let (bounty_amount, bounty_refund, payment) = {
            let offer_mut = &mut pool.offers[offer_id];

            // Extract bounty to return to offerer
            let bounty_amount = offer_mut.cleanup_bounty.value();
            let bounty_refund = coin::from_balance(
                balance::withdraw_all(&mut offer_mut.cleanup_bounty),
                ctx
            );

            // Prepare payment - from escrow or portfolio
            let payment_balance = if (offer_mut.portfolio_id.is_none()) {
                // Regular offer - withdraw from escrow
                balance::withdraw_all(&mut offer_mut.escrow)
            } else {
                // Portfolio offer - release funds from portfolio must use accept_portfolio_offer
                // This branch should not be reached for portfolio offers
                abort ENotPortfolioOffer
            };

            let payment = coin::from_balance(payment_balance, ctx);
            (bounty_amount, bounty_refund, payment)
        };

        // ========== PHASE 4: ITEM OPERATIONS & TRANSFER POLICY ==========
        // List the item at the offer price and purchase in one helper
        let item = kiosk::take<T>(kiosk, kiosk_cap, item_id);

        // Final authoritative fee check (marketplace + royalty).
        let (_marketplace_fee, _royalty_amount, total_fees_required) =
            cpu::core::calculate_fees_for_price<T>(marketplace, offer_amount, policy);
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= total_fees_required, EInsufficientFeePayment);

        // Split the fees: first marketplace fee, then royalty, return any excess
        let (marketplace_fee_coin, royalty_payment) =
            cpu::core::take_fee_coins_for_price<T>(
                marketplace,
                offer_amount,
                policy,
                &mut fee_payment,
                ctx,
            );

        // Combine offer payment with marketplace fee for purchase
        let mut total_payment = payment;
        coin::join(&mut total_payment, marketplace_fee_coin);

        // Execute list + purchase via core helper
        let (purchased_item, mut transfer_request) = cpu::core::list_and_purchase_with_payment<CpuMarketplaceOffer, T>(
            kiosk,
            kiosk_cap,
            item,
            offer_amount,
            total_payment,
            marketplace,
            ctx,
        );

        // ========== PHASE 5: TRANSFER POLICY ==========
        // Satisfy transfer policy rules before confirmation
        // 1. Pay royalty if required (via core helper)
        cpu::core::pay_royalty_if_required<T>(policy, &mut transfer_request, royalty_payment);

        // 2. Prove floor price if required (automatically satisfied by payment amount)
        if (transfer_policy_utils::has_floor_price_rule(policy)) {
            floor_price_rule::prove(policy, &mut transfer_request);
        };

        // 3/4. Handle kiosk-based rules using the BUYER'S kiosk
        // Note: personal_kiosk_rule is NOT supported in offer acceptance flows
        // because PersonalKioskCap cannot be transferred to arbitrary addresses
        if (transfer_policy_utils::has_kiosk_lock_rule(policy)) {
            track_auto_created_kiosk_for_buyer(pool, offerer, clock);
            // Create a kiosk for the buyer
            let (mut buyer_kiosk, buyer_kiosk_cap) = kiosk::new(ctx);

            // Lock the purchased item in the buyer's kiosk under the policy
            kiosk::lock(&mut buyer_kiosk, &buyer_kiosk_cap, policy, purchased_item);

            // Prove kiosk lock rule
            kiosk_lock_rule::prove(&mut transfer_request, &buyer_kiosk);

            // Share the newly created kiosk, then transfer owner cap to buyer
            transfer::public_share_object(buyer_kiosk);
            transfer::public_transfer(buyer_kiosk_cap, offerer);
        } else {
            // No kiosk lock rule; transfer item directly to the buyer
            transfer::public_transfer(purchased_item, offerer);
        };

        // Now confirm the transfer with all rules satisfied
        let (_, _, _) = transfer_policy::confirm_request(policy, transfer_request);

        // ========== PHASE 6: STATE COMMIT (DELAYED - KEY CHANGE!) ==========
        // IMPORTANT: Status update moved HERE, after all operations succeed
        let offer_mut = &mut pool.offers[offer_id];
        offer_mut.status = OFFER_STATUS_ACCEPTED;
        record_terminal_offer(pool, offer_id);

        // ========== PHASE 7: CLEANUP & EVENTS ==========
        // Update statistics
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Return bounty to offerer
        transfer::public_transfer(bounty_refund, offerer);

        // Emit unified event with portfolio_id (None for regular offers)
        events::emit_offer_accepted_event<T>(
            collection,
            offer_id,
            ctx.sender(),
            item_id,
            offer_amount,
            option::none(),  // Regular offer, not portfolio-funded
        );

        // Return any excess fee payment for composability
        fee_payment
    }

    /// Accept a collection-level offer with any NFT from the collection
    /// The seller can choose any NFT from their kiosk that belongs to the collection
    /// Returns any excess fee payment for composability
    public fun accept_collection_offer<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,  // Seller chooses any NFT from their kiosk
        offer_id: object::ID,
        marketplace: &mut cpu::core::CpuMarketplace,
        policy: &mut TransferPolicy<T>,
        mut fee_payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): Coin<SUI> {
        // Check marketplace is not paused
        cpu::core::assert_marketplace_not_paused(marketplace);

        // ========== PHASE 1: READ-ONLY VALIDATION ==========
        // Read offer first to get values, DON'T modify status yet
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer_ref = &pool.offers[offer_id];
        assert!(offer_ref.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer_ref.is_collection_offer, ENotCollectionOffer);
        assert!(offer_ref.portfolio_id.is_none(), ENotPortfolioOffer);

        // Verify the NFT belongs to the correct collection
        let collection_id = object::id(collection);
        assert!(offer_ref.collection_id == collection_id, EWrongCollection);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer_ref.expire_time, EOfferExpired);

        let offer_amount = offer_ref.offer_amount;
        let offerer = offer_ref.offerer;
        // [M-02 FIX] Prevent self-acceptance (wash trading)
        assert!(ctx.sender() != offerer, ESelfAcceptanceNotAllowed);

        // ========== PHASE 2: FEE VALIDATION ==========
        cpu::core::validate_version(marketplace);
        // Validate transfer policy requirements
        // Calculate royalty from policy
        let royalty_amount = transfer_policy_utils::calculate_royalty<T>(policy, offer_amount);

        // Validate fee_payment is sufficient to cover royalty
        // Note: Marketplace fees are handled separately in the purchase flow
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= royalty_amount, EInsufficientFeePayment);

        // NOTE: Cannot validate floor price here - enforcement happens during transfer
        // via floor_price_rule::prove(). If offer is below floor price, the transfer
        // will fail at that point.

        // Handle zero-price edge case
        if (offer_amount == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // ========== PHASE 3: FUND EXTRACTION ==========
        let (bounty_amount, bounty_refund, payment) = {
            let offer_mut = &mut pool.offers[offer_id];

            // [H-02 FIX] Prevent portfolio offers from being accepted through this path
            assert!(offer_mut.portfolio_id.is_none(), ENotPortfolioOffer);

            // Extract bounty to return to offerer
            let bounty_amount = offer_mut.cleanup_bounty.value();
            let bounty_refund = coin::from_balance(
                balance::withdraw_all(&mut offer_mut.cleanup_bounty),
                ctx
            );

            // Prepare payment from escrow
            let payment_balance = balance::withdraw_all(&mut offer_mut.escrow);
            let payment = coin::from_balance(payment_balance, ctx);
            (bounty_amount, bounty_refund, payment)
        };

        // ========== PHASE 4: ITEM OPERATIONS & TRANSFER POLICY ==========
        // Take the item to list and purchase in one step
        let item = kiosk::take<T>(kiosk, kiosk_cap, item_id);

        // Calculate and validate fees using unified core API (price = offer_amount)
        let (_marketplace_fee, _royalty_amount, total_fees_required) =
            cpu::core::calculate_fees_for_price<T>(marketplace, offer_amount, policy);
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= total_fees_required, EInsufficientFeePayment);

        // Split the fees: first marketplace fee, then royalty, return any excess
        let (marketplace_fee_coin, royalty_payment) =
            cpu::core::take_fee_coins_for_price<T>(
                marketplace,
                offer_amount,
                policy,
                &mut fee_payment,
                ctx,
            );

        // Combine offer payment with marketplace fee for purchase
        let mut total_payment = payment;
        coin::join(&mut total_payment, marketplace_fee_coin);

        // Execute list + purchase via core helper
        let (purchased_item, mut transfer_request) = cpu::core::list_and_purchase_with_payment<CpuMarketplaceOffer, T>(
            kiosk,
            kiosk_cap,
            item,
            offer_amount,
            total_payment,
            marketplace,
            ctx,
        );

        // ========== PHASE 5: TRANSFER POLICY ==========
        // Satisfy transfer policy rules before confirmation
        // 1. Pay royalty if required (via core helper)
        cpu::core::pay_royalty_if_required<T>(policy, &mut transfer_request, royalty_payment);

        // 2. Prove floor price if required (automatically satisfied by payment amount)
        if (transfer_policy_utils::has_floor_price_rule(policy)) {
            floor_price_rule::prove(policy, &mut transfer_request);
        };

        // 3/4. Handle kiosk-based rules using the BUYER'S kiosk
        // Note: personal_kiosk_rule is NOT supported in offer acceptance flows
        // because PersonalKioskCap cannot be transferred to arbitrary addresses
        if (transfer_policy_utils::has_kiosk_lock_rule(policy)) {
            track_auto_created_kiosk_for_buyer(pool, offerer, clock);
            // Create a kiosk for the buyer
            let (mut buyer_kiosk, buyer_kiosk_cap) = kiosk::new(ctx);

            // Lock the purchased item in the buyer's kiosk under the policy
            kiosk::lock(&mut buyer_kiosk, &buyer_kiosk_cap, policy, purchased_item);

            // Prove kiosk lock rule
            kiosk_lock_rule::prove(&mut transfer_request, &buyer_kiosk);

            // Share the newly created kiosk, then transfer owner cap to buyer
            transfer::public_share_object(buyer_kiosk);
            transfer::public_transfer(buyer_kiosk_cap, offerer);
        } else {
            // No kiosk lock rule; transfer item directly to the buyer
            transfer::public_transfer(purchased_item, offerer);
        };

        // Now confirm the transfer with all rules satisfied
        let (_, _, _) = transfer_policy::confirm_request(policy, transfer_request);

        // ========== PHASE 6: STATE COMMIT (DELAYED - KEY CHANGE!) ==========
        // IMPORTANT: Status update moved HERE, after all operations succeed
        let offer_mut = &mut pool.offers[offer_id];
        offer_mut.status = OFFER_STATUS_ACCEPTED;
        record_terminal_offer(pool, offer_id);

        // ========== PHASE 7: CLEANUP & EVENTS ==========
        // Update statistics
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Return bounty to offerer
        transfer::public_transfer(bounty_refund, offerer);

        // Emit unified event with portfolio_id (None for regular collection offers)
        events::emit_collection_offer_accepted_event<T>(
            collection,
            offer_id,
            ctx.sender(),
            item_id,
            offer_amount,
            option::none(),  // Regular collection offer, not portfolio-funded
        );

        // Return any excess fee payment for composability
        fee_payment
    }

    /// Accept a portfolio-funded item offer
    /// Returns any excess fee payment for composability
    public fun accept_portfolio_item_offer<T: key + store>(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,
        offer_id: object::ID,
        marketplace: &mut cpu::core::CpuMarketplace,
        policy: &mut TransferPolicy<T>,
        mut fee_payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): Coin<SUI> {
        // Check marketplace is not paused
        cpu::core::assert_marketplace_not_paused(marketplace);

        // ========== PHASE 1: READ-ONLY VALIDATION ==========
        // Read offer first to get values, DON'T modify status yet
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer_ref = &pool.offers[offer_id];
        assert!(offer_ref.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer_ref.target_item_id == item_id, EInvalidItemId);
        assert!(offer_ref.portfolio_id.is_some(), ENotPortfolioOffer);

        // Verify portfolio ID matches
        let portfolio_id = offer_portfolio::get_id(portfolio);
        assert!(*offer_ref.portfolio_id.borrow() == portfolio_id, EPortfolioIdMismatch);

        // Verify the NFT belongs to the correct collection
        let collection_id = object::id(collection);
        assert!(offer_ref.collection_id == collection_id, EWrongCollection);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer_ref.expire_time, EOfferExpired);

        let offer_amount = offer_ref.offer_amount;
        let offerer = offer_ref.offerer;
        // [M-02 FIX] Prevent self-acceptance (wash trading)
        assert!(ctx.sender() != offerer, ESelfAcceptanceNotAllowed);

        // ========== PHASE 2: FEE VALIDATION ==========
        cpu::core::validate_version(marketplace);
        // Validate transfer policy requirements
        // Calculate royalty from policy
        let royalty_amount = transfer_policy_utils::calculate_royalty<T>(policy, offer_amount);

        // Validate fee_payment is sufficient to cover royalty
        // Note: Marketplace fees are handled separately in the purchase flow
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= royalty_amount, EInsufficientFeePayment);

        // NOTE: Cannot validate floor price here - enforcement happens during transfer
        // via floor_price_rule::prove(). If offer is below floor price, the transfer
        // will fail at that point.

        // Handle zero-price edge case
        if (offer_amount == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // ========== PHASE 3: FUND EXTRACTION ==========
        let (bounty_amount, bounty_balance, payment) = {
            let offer_mut = &mut pool.offers[offer_id];

            // Extract bounty to return to portfolio balance
            let bounty_amount = offer_mut.cleanup_bounty.value();
            let bounty_balance = balance::withdraw_all(&mut offer_mut.cleanup_bounty);

            // Release funds from portfolio
            let payment_balance = offer_portfolio::release_offer(portfolio, offer_id);
            let payment = coin::from_balance(payment_balance, ctx);
            (bounty_amount, bounty_balance, payment)
        };

        // ========== PHASE 4: ITEM OPERATIONS & TRANSFER POLICY ==========
        // Take the item to list and purchase in one step
        let item = kiosk::take<T>(kiosk, kiosk_cap, item_id);

        // Calculate and validate fees using unified core API (price = offer_amount)
        let (_marketplace_fee, _royalty_amount, total_fees_required) =
            cpu::core::calculate_fees_for_price<T>(marketplace, offer_amount, policy);
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= total_fees_required, EInsufficientFeePayment);

        // Split the fees: first marketplace fee, then royalty, return any excess
        let (marketplace_fee_coin, royalty_payment) =
            cpu::core::take_fee_coins_for_price<T>(
                marketplace,
                offer_amount,
                policy,
                &mut fee_payment,
                ctx,
            );

        // Combine offer payment with marketplace fee for purchase
        let mut total_payment = payment;
        coin::join(&mut total_payment, marketplace_fee_coin);

        // Execute list + purchase via core helper
        let (purchased_item, mut transfer_request) = cpu::core::list_and_purchase_with_payment<CpuMarketplaceOffer, T>(
            kiosk,
            kiosk_cap,
            item,
            offer_amount,
            total_payment,
            marketplace,
            ctx,
        );

        // ========== PHASE 5: TRANSFER POLICY ==========
        // Satisfy transfer policy rules before confirmation
        // 1. Pay royalty if required (via core helper)
        cpu::core::pay_royalty_if_required<T>(policy, &mut transfer_request, royalty_payment);

        // 2. Prove floor price if required (automatically satisfied by payment amount)
        if (transfer_policy_utils::has_floor_price_rule(policy)) {
            floor_price_rule::prove(policy, &mut transfer_request);
        };

        // 3/4. Handle kiosk-based rules using the BUYER'S kiosk
        // Note: personal_kiosk_rule is NOT supported in offer acceptance flows
        // because PersonalKioskCap cannot be transferred to arbitrary addresses
        if (transfer_policy_utils::has_kiosk_lock_rule(policy)) {
            track_auto_created_kiosk_for_buyer(pool, offerer, clock);
            // Create a kiosk for the buyer
            let (mut buyer_kiosk, buyer_kiosk_cap) = kiosk::new(ctx);

            // Lock the purchased item in the buyer's kiosk under the policy
            kiosk::lock(&mut buyer_kiosk, &buyer_kiosk_cap, policy, purchased_item);

            // Prove kiosk lock rule
            kiosk_lock_rule::prove(&mut transfer_request, &buyer_kiosk);

            // Share the newly created kiosk, then transfer owner cap to buyer
            transfer::public_share_object(buyer_kiosk);
            transfer::public_transfer(buyer_kiosk_cap, offerer);
        } else {
            // No kiosk lock rule; transfer item directly to the buyer
            transfer::public_transfer(purchased_item, offerer);
        };

        // Now confirm the transfer with all rules satisfied
        let (_, _, _) = transfer_policy::confirm_request(policy, transfer_request);

        // ========== PHASE 6: STATE COMMIT (DELAYED - KEY CHANGE!) ==========
        // IMPORTANT: Status update moved HERE, after all operations succeed
        let offer_mut = &mut pool.offers[offer_id];
        offer_mut.status = OFFER_STATUS_ACCEPTED;
        record_terminal_offer(pool, offer_id);

        // ========== PHASE 7: CLEANUP & EVENTS ==========
        // Update statistics
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Return bounty to portfolio balance
        offer_portfolio::return_bounty(portfolio, bounty_balance);

        // Emit unified event with portfolio_id (Some for portfolio offers)
        events::emit_offer_accepted_event<T>(
            collection,
            offer_id,
            ctx.sender(),
            item_id,
            offer_amount,
            option::some(portfolio_id),  // Portfolio offer - include portfolio_id
        );

        // Return any excess fee payment for composability
        fee_payment
    }

    /// Accept a portfolio-funded collection offer
    /// Returns any excess fee payment for composability
    public fun accept_portfolio_collection_offer<T: key + store>(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,
        offer_id: object::ID,
        marketplace: &mut cpu::core::CpuMarketplace,
        policy: &mut TransferPolicy<T>,
        mut fee_payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): Coin<SUI> {
        // Check marketplace is not paused
        cpu::core::assert_marketplace_not_paused(marketplace);

        // ========== PHASE 1: READ-ONLY VALIDATION ==========
        // Read offer first to get values, DON'T modify status yet
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer_ref = &pool.offers[offer_id];
        assert!(offer_ref.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer_ref.is_collection_offer, ENotCollectionOffer);
        assert!(offer_ref.portfolio_id.is_some(), ENotPortfolioOffer);

        // Verify portfolio ID matches
        let portfolio_id = offer_portfolio::get_id(portfolio);
        assert!(*offer_ref.portfolio_id.borrow() == portfolio_id, EPortfolioIdMismatch);

        // Verify the NFT belongs to the correct collection
        let collection_id = object::id(collection);
        assert!(offer_ref.collection_id == collection_id, EWrongCollection);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer_ref.expire_time, EOfferExpired);

        let offer_amount = offer_ref.offer_amount;
        let offerer = offer_ref.offerer;

        // [M-02 FIX] Prevent self-acceptance (wash trading)
        assert!(ctx.sender() != offerer, ESelfAcceptanceNotAllowed);

        // ========== PHASE 2: FEE VALIDATION ==========
        cpu::core::validate_version(marketplace);
        // Validate transfer policy requirements
        // Calculate royalty from policy
        let royalty_amount = transfer_policy_utils::calculate_royalty<T>(policy, offer_amount);

        // Validate fee_payment is sufficient to cover royalty
        // Note: Marketplace fees are handled separately in the purchase flow
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= royalty_amount, EInsufficientFeePayment);

        // NOTE: Cannot validate floor price here - enforcement happens during transfer
        // via floor_price_rule::prove(). If offer is below floor price, the transfer
        // will fail at that point.

        // Handle zero-price edge case
        if (offer_amount == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // ========== PHASE 3: FUND EXTRACTION ==========
        let (bounty_amount, bounty_balance, payment) = {
            let offer_mut = &mut pool.offers[offer_id];

            // Extract bounty to return to portfolio balance
            let bounty_amount = offer_mut.cleanup_bounty.value();
            let bounty_balance = balance::withdraw_all(&mut offer_mut.cleanup_bounty);

            // Release funds from portfolio
            let payment_balance = offer_portfolio::release_offer(portfolio, offer_id);
            let payment = coin::from_balance(payment_balance, ctx);
            (bounty_amount, bounty_balance, payment)
        };

        // ========== PHASE 4: ITEM OPERATIONS & TRANSFER POLICY ==========
        // Take the item to list and purchase in one step
        let item = kiosk::take<T>(kiosk, kiosk_cap, item_id);

        // Calculate and validate fees using unified core API (price = offer_amount)
        let (_marketplace_fee, _royalty_amount, total_fees_required) =
            cpu::core::calculate_fees_for_price<T>(marketplace, offer_amount, policy);
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= total_fees_required, EInsufficientFeePayment);

        let (marketplace_fee_coin, royalty_payment) =
            cpu::core::take_fee_coins_for_price<T>(
                marketplace,
                offer_amount,
                policy,
                &mut fee_payment,
                ctx,
            );

        // Combine offer payment with marketplace fee for purchase
        let mut total_payment = payment;
        coin::join(&mut total_payment, marketplace_fee_coin);

        // Execute list + purchase via core helper
        let (purchased_item, mut transfer_request) = cpu::core::list_and_purchase_with_payment<CpuMarketplaceOffer, T>(
            kiosk,
            kiosk_cap,
            item,
            offer_amount,
            total_payment,
            marketplace,
            ctx,
        );

        // ========== PHASE 5: TRANSFER POLICY ==========
        // Satisfy transfer policy rules before confirmation
        // 1. Pay royalty if required (via core helper)
        cpu::core::pay_royalty_if_required<T>(policy, &mut transfer_request, royalty_payment);

        // 2. Prove floor price if required (automatically satisfied by payment amount)
        if (transfer_policy_utils::has_floor_price_rule(policy)) {
            floor_price_rule::prove(policy, &mut transfer_request);
        };

        // 3/4. Handle kiosk-based rules using the BUYER'S kiosk
        // Note: personal_kiosk_rule is NOT supported in offer acceptance flows
        // because PersonalKioskCap cannot be transferred to arbitrary addresses
        if (transfer_policy_utils::has_kiosk_lock_rule(policy)) {
            track_auto_created_kiosk_for_buyer(pool, offerer, clock);
            // Create a kiosk for the buyer
            let (mut buyer_kiosk, buyer_kiosk_cap) = kiosk::new(ctx);

            // Lock the purchased item in the buyer's kiosk under the policy
            kiosk::lock(&mut buyer_kiosk, &buyer_kiosk_cap, policy, purchased_item);

            // Prove kiosk lock rule
            kiosk_lock_rule::prove(&mut transfer_request, &buyer_kiosk);

            // Share the newly created kiosk, then transfer owner cap to buyer
            transfer::public_share_object(buyer_kiosk);
            transfer::public_transfer(buyer_kiosk_cap, offerer);
        } else {
            // No kiosk lock rule; transfer item directly to the buyer
            transfer::public_transfer(purchased_item, offerer);
        };

        // Now confirm the transfer with all rules satisfied
        let (_, _, _) = transfer_policy::confirm_request(policy, transfer_request);

        // ========== PHASE 6: STATE COMMIT (DELAYED - KEY CHANGE!) ==========
        // IMPORTANT: Status update moved HERE, after all operations succeed
        let offer_mut = &mut pool.offers[offer_id];
        offer_mut.status = OFFER_STATUS_ACCEPTED;
        record_terminal_offer(pool, offer_id);

        // ========== PHASE 7: CLEANUP & EVENTS ==========
        // Update statistics
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Return bounty to portfolio balance
        offer_portfolio::return_bounty(portfolio, bounty_balance);

        // Emit unified event with portfolio_id (Some for portfolio collection offers)
        events::emit_collection_offer_accepted_event<T>(
            collection,
            offer_id,
            ctx.sender(),
            item_id,
            offer_amount,
            option::some(portfolio_id),  // Portfolio collection offer - include portfolio_id
        );

        // Return any excess fee payment for composability
        fee_payment
    }

    // ========== Claim Ticket Functions ==========

    /// Accept item offer and create claim ticket (for personal kiosk rule)
    /// Returns (ticket, payment_to_seller) for composability
    #[allow(lint(self_transfer))] // excess fee_payment refund to seller is intentional
    public fun accept_offer_create_claim<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,
        offer_id: object::ID,
        marketplace: &mut cpu::core::CpuMarketplace,
        policy: &mut TransferPolicy<T>,
        mut fee_payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        // Check marketplace is not paused
        cpu::core::assert_marketplace_not_paused(marketplace);

        // ========== PHASE 1: READ-ONLY VALIDATION ==========
        // Read offer first to get values, DON'T modify status yet
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer_ref = &pool.offers[offer_id];
        assert!(offer_ref.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer_ref.target_item_id == item_id, EInvalidItemId);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer_ref.expire_time, EOfferExpired);

        let offer_amount = offer_ref.offer_amount;
        let offerer = offer_ref.offerer;

        // [M-02 FIX] Prevent self-acceptance (wash trading)
        assert!(ctx.sender() != offerer, ESelfAcceptanceNotAllowed);

        // ========== PHASE 2: FEE VALIDATION ==========
        // Validate marketplace version to enforce upgrade path
        cpu::core::validate_version(marketplace);

        // Calculate and validate fees (using offer_amount as the price)
        let (marketplace_fee, royalty_amount, total_fee) =
            cpu::core::calculate_fees_for_price<T>(marketplace, offer_amount, policy);
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= total_fee, EInsufficientFeePayment);
        assert_supported_claim_policy_rules(policy);
        if (offer_amount == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // ========== PHASE 3: FUND EXTRACTION ==========
        // NOW get mutable reference
        let offer_mut = &mut pool.offers[offer_id];

        // [M-02 FIX] Prevent portfolio offers from being accepted through non-portfolio path
        assert!(offer_mut.portfolio_id.is_none(), ENotPortfolioOffer);

        // Extract bounty to return to offerer
        let bounty_amount = offer_mut.cleanup_bounty.value();
        let bounty_refund = coin::from_balance(
            balance::withdraw_all(&mut offer_mut.cleanup_bounty),
            ctx
        );

        // Process payment — escrow instead of giving to seller immediately
        let seller = ctx.sender();
        let payment_to_seller = balance::withdraw_all(&mut offer_mut.escrow);

        // ========== PHASE 4: ITEM OPERATIONS ==========
        // Remove NFT from seller kiosk
        let purchased_item = kiosk::take<T>(kiosk, kiosk_cap, item_id);

        // Store NFT temporarily in OfferPool
        let ticket_uid = object::new(ctx);
        let ticket_id = object::uid_to_inner(&ticket_uid);

        let storage = TemporaryNftStorage<T> {
            nft: purchased_item,
            ticket_id,
        };

        df::add(
            &mut pool.id,
            TemporaryStorageKey { ticket_id },
            storage
        );

        // [H-01 FIX] Escrow seller payment instead of returning immediately
        let payment_storage = TemporaryPaymentStorage {
            payment_balance: payment_to_seller,
            ticket_id,
            buyer: offerer,
        };
        df::add(&mut pool.id, PaymentStorageKey { ticket_id }, payment_storage);

        // Store claim ticket metadata for recovery
        let claim_meta = ClaimTicketMeta {
            seller,
            buyer: offerer,
            nft_type: transfer_policy_utils::get_type_name<T>(),
            nft_id: item_id,
            collection_id: object::id(collection),
            created_at: current_time,
            recovery_unlocks_at: current_time + CLAIM_RECOVERY_PERIOD_MS,
        };
        df::add(&mut pool.id, ClaimTicketMetaKey { ticket_id }, claim_meta);

        // ========== PHASE 5: FEE PROCESSING ==========
        // fee_payment (provided by caller) is split into up to 3 parts:
        //   1. marketplace_fee  -> held in TemporaryMarketplaceFeeStorage until claim
        //   2. royalty_amount   -> held in TemporaryRoyaltyStorage until claim
        //   3. excess remainder -> returned to seller immediately (seller's money)
        if (marketplace_fee > 0) {
            let marketplace_fee_coin = fee_payment.split(marketplace_fee, ctx);
            let marketplace_fee_storage = TemporaryMarketplaceFeeStorage {
                fee_balance: marketplace_fee_coin.into_balance(),
                ticket_id,
            };
            df::add(
                &mut pool.id,
                MarketplaceFeeStorageKey { ticket_id },
                marketplace_fee_storage
            );
        };

        // Handle royalty payment separately if it exists
        if (royalty_amount > 0) {
            let royalty_coin = fee_payment.split(royalty_amount, ctx);
            // Store royalty temporarily until claim is finalized
            let royalty_storage = TemporaryRoyaltyStorage {
                royalty_balance: royalty_coin.into_balance(),
                ticket_id,
            };
            df::add(&mut pool.id, RoyaltyStorageKey { ticket_id }, royalty_storage);
        };

        // Return excess fee payment to seller immediately (this is seller's money)
        if (fee_payment.value() > 0) {
            transfer::public_transfer(fee_payment, seller);
        } else {
            coin::destroy_zero(fee_payment);
        };

        // ========== PHASE 6: STATE COMMIT (DELAYED - KEY CHANGE!) ==========
        // IMPORTANT: Status update moved HERE, after all operations succeed
        offer_mut.status = OFFER_STATUS_ACCEPTED;
        record_terminal_offer(pool, offer_id);

        // ========== PHASE 7: CLEANUP & EVENTS ==========
        // Update pool counters
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Return bounty to offerer
        transfer::public_transfer(bounty_refund, offerer);

        // Get policy rule flags for enhanced claim ticket event and snapshot
        let has_personal_kiosk_rule = transfer_policy_utils::has_personal_kiosk_rule(policy);
        let has_royalty_rule = transfer_policy_utils::has_royalty_rule(policy);
        let has_floor_price_rule = transfer_policy_utils::has_floor_price_rule(policy);
        let has_kiosk_lock_rule = transfer_policy_utils::has_kiosk_lock_rule(policy);
        // [L-02 FIX] Snapshot royalty amount for parameter-level change detection
        let snapshot_royalty_amount = transfer_policy_utils::calculate_royalty(policy, offer_amount);
        let snapshot_policy_rule_count = transfer_policy_utils::policy_rule_count(policy);

        // Create claim ticket with policy snapshot
        let expire_time = current_time + CLAIM_TICKET_EXPIRY_MS;
        let ticket = PersonalKioskClaimTicket {
            id: ticket_uid,
            buyer: offerer,
            nft_type: transfer_policy_utils::get_type_name<T>(),
            nft_id: item_id,
            collection_id: object::id(collection),
            offer_id,
            seller,
            amount_paid: offer_amount,
            created_at: current_time,
            expires_at: expire_time,
            // [H-01 FIX] Policy snapshot
            policy_id: object::id(policy),
            snapshot_has_royalty_rule: has_royalty_rule,
            snapshot_has_floor_price_rule: has_floor_price_rule,
            snapshot_has_kiosk_lock_rule: has_kiosk_lock_rule,
            snapshot_has_personal_kiosk_rule: has_personal_kiosk_rule,
            // [L-02 FIX] Royalty parameter snapshot
            snapshot_royalty_amount,
            snapshot_policy_rule_count,
        };

        // Emit events
        events::emit_offer_accepted_event<T>(
            collection,
            offer_id,
            seller,
            item_id,
            offer_amount,
            option::none(),  // Regular offer, not portfolio-funded
        );

        events::emit_claim_ticket_created_event(
            ticket_id,
            offerer,
            seller,
            item_id,
            object::id(collection),
            offer_amount,
            expire_time,
            has_personal_kiosk_rule,
            has_royalty_rule,
            has_floor_price_rule,
            has_kiosk_lock_rule,
            marketplace_fee,
            royalty_amount,
        );

        // [F1 FIX] Force-transfer ticket to buyer to prevent seller withholding
        transfer::public_transfer(ticket, offerer);
    }

    /// Accept portfolio item offer and create claim ticket
    /// Returns payment_to_seller; ticket is transferred directly to buyer
    #[allow(lint(self_transfer))] // excess fee_payment refund to seller is intentional
    public fun accept_portfolio_item_offer_create_claim<T: key + store>(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,
        offer_id: object::ID,
        marketplace: &mut cpu::core::CpuMarketplace,
        policy: &mut TransferPolicy<T>,
        mut fee_payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        // Check marketplace is not paused
        cpu::core::assert_marketplace_not_paused(marketplace);

        // ========== PHASE 1: READ-ONLY VALIDATION ==========
        // Read offer first to get values, DON'T modify status yet
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer_ref = &pool.offers[offer_id];
        assert!(offer_ref.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer_ref.target_item_id == item_id, EInvalidItemId);
        assert!(offer_ref.portfolio_id.is_some(), ENotPortfolioOffer);

        let portfolio_id = *offer_ref.portfolio_id.borrow();
        assert!(object::id(portfolio) == portfolio_id, EPortfolioIdMismatch);
        // [M-02 FIX] Prevent self-acceptance (wash trading) — corrected error code
        assert!(ctx.sender() != offer_ref.offerer, ESelfAcceptanceNotAllowed);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer_ref.expire_time, EOfferExpired);

        let offer_amount = offer_ref.offer_amount;
        let offerer = offer_ref.offerer;

        // ========== PHASE 2: FEE VALIDATION ==========
        // Validate marketplace version to enforce upgrade path
        cpu::core::validate_version(marketplace);

        // Calculate and validate fees using unified core API (unlisted flow)
        let (marketplace_fee, royalty_amount, total_fee) =
            cpu::core::calculate_fees_for_price<T>(marketplace, offer_amount, policy);
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= total_fee, EInsufficientFeePayment);
        assert_supported_claim_policy_rules(policy);
        if (offer_amount == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // ========== PHASE 3: FUND EXTRACTION ==========
        // NOW get mutable reference
        let offer_mut = &mut pool.offers[offer_id];

        // Extract bounty to return to portfolio balance
        let bounty_amount = offer_mut.cleanup_bounty.value();
        let bounty_balance = balance::withdraw_all(&mut offer_mut.cleanup_bounty);

        // Process payment from portfolio — escrow instead of giving to seller
        let seller = ctx.sender();
        let payment_balance = offer_portfolio::release_offer(portfolio, offer_id);

        // ========== PHASE 4: ITEM OPERATIONS ==========
        // Remove NFT from seller kiosk and store temporarily
        let purchased_item = kiosk::take<T>(kiosk, kiosk_cap, item_id);
        let ticket_uid = object::new(ctx);
        let ticket_id = object::uid_to_inner(&ticket_uid);

        let storage = TemporaryNftStorage<T> {
            nft: purchased_item,
            ticket_id,
        };

        df::add(
            &mut pool.id,
            TemporaryStorageKey { ticket_id },
            storage
        );

        // [H-01 FIX] Escrow seller payment instead of returning immediately
        let payment_storage = TemporaryPaymentStorage {
            payment_balance,
            ticket_id,
            buyer: offerer,
        };
        df::add(&mut pool.id, PaymentStorageKey { ticket_id }, payment_storage);

        // Store claim ticket metadata for recovery
        let claim_meta = ClaimTicketMeta {
            seller,
            buyer: offerer,
            nft_type: transfer_policy_utils::get_type_name<T>(),
            nft_id: item_id,
            collection_id: object::id(collection),
            created_at: current_time,
            recovery_unlocks_at: current_time + CLAIM_RECOVERY_PERIOD_MS,
        };
        df::add(&mut pool.id, ClaimTicketMetaKey { ticket_id }, claim_meta);

        // ========== PHASE 5: FEE PROCESSING ==========
        // fee_payment (provided by caller) is split into up to 3 parts:
        //   1. marketplace_fee  -> held in TemporaryMarketplaceFeeStorage until claim
        //   2. royalty_amount   -> held in TemporaryRoyaltyStorage until claim
        //   3. excess remainder -> returned to seller immediately (seller's money)
        if (marketplace_fee > 0) {
            let marketplace_fee_coin = fee_payment.split(marketplace_fee, ctx);
            let marketplace_fee_storage = TemporaryMarketplaceFeeStorage {
                fee_balance: marketplace_fee_coin.into_balance(),
                ticket_id,
            };
            df::add(
                &mut pool.id,
                MarketplaceFeeStorageKey { ticket_id },
                marketplace_fee_storage
            );
        };

        if (royalty_amount > 0) {
            let royalty_coin = fee_payment.split(royalty_amount, ctx);
            // Store royalty temporarily until claim is finalized
            let royalty_storage = TemporaryRoyaltyStorage {
                royalty_balance: royalty_coin.into_balance(),
                ticket_id,
            };
            df::add(&mut pool.id, RoyaltyStorageKey { ticket_id }, royalty_storage);
        };

        // Return excess fee payment to seller immediately (this is seller's money)
        if (fee_payment.value() > 0) {
            transfer::public_transfer(fee_payment, seller);
        } else {
            coin::destroy_zero(fee_payment);
        };

        // ========== PHASE 6: STATE COMMIT (DELAYED - KEY CHANGE!) ==========
        // IMPORTANT: Status update moved HERE, after all operations succeed
        offer_mut.status = OFFER_STATUS_ACCEPTED;
        record_terminal_offer(pool, offer_id);

        // ========== PHASE 7: CLEANUP & EVENTS ==========
        // Update pool counters
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Return bounty to portfolio balance
        offer_portfolio::return_bounty(portfolio, bounty_balance);

        // Get policy rule flags for enhanced claim ticket event and snapshot
        let has_personal_kiosk_rule = transfer_policy_utils::has_personal_kiosk_rule(policy);
        let has_royalty_rule = transfer_policy_utils::has_royalty_rule(policy);
        let has_floor_price_rule = transfer_policy_utils::has_floor_price_rule(policy);
        let has_kiosk_lock_rule = transfer_policy_utils::has_kiosk_lock_rule(policy);
        // [L-02 FIX] Snapshot royalty amount for parameter-level change detection
        let snapshot_royalty_amount = transfer_policy_utils::calculate_royalty(policy, offer_amount);
        let snapshot_policy_rule_count = transfer_policy_utils::policy_rule_count(policy);

        // Create claim ticket with policy snapshot
        let expire_time = current_time + CLAIM_TICKET_EXPIRY_MS;
        let ticket = PersonalKioskClaimTicket {
            id: ticket_uid,
            buyer: offerer,
            nft_type: transfer_policy_utils::get_type_name<T>(),
            nft_id: item_id,
            collection_id: object::id(collection),
            offer_id,
            seller,
            amount_paid: offer_amount,
            created_at: current_time,
            expires_at: expire_time,
            // [H-01 FIX] Policy snapshot
            policy_id: object::id(policy),
            snapshot_has_royalty_rule: has_royalty_rule,
            snapshot_has_floor_price_rule: has_floor_price_rule,
            snapshot_has_kiosk_lock_rule: has_kiosk_lock_rule,
            snapshot_has_personal_kiosk_rule: has_personal_kiosk_rule,
            // [L-02 FIX] Royalty parameter snapshot
            snapshot_royalty_amount,
            snapshot_policy_rule_count,
        };

        // Emit unified events
        events::emit_offer_accepted_event<T>(
            collection,
            offer_id,
            seller,
            item_id,
            offer_amount,
            option::some(portfolio_id),  // Portfolio offer - include portfolio_id
        );

        events::emit_claim_ticket_created_event(
            ticket_id,
            offerer,
            seller,
            item_id,
            object::id(collection),
            offer_amount,
            expire_time,
            has_personal_kiosk_rule,
            has_royalty_rule,
            has_floor_price_rule,
            has_kiosk_lock_rule,
            marketplace_fee,
            royalty_amount,
        );

        // [F1 FIX] Force-transfer ticket to buyer to prevent seller withholding
        transfer::public_transfer(ticket, offerer);
    }

    /// Accept collection offer and create claim ticket
    /// Ticket is transferred directly to buyer; seller payment is escrowed
    #[allow(lint(self_transfer))] // excess fee_payment refund to seller is intentional
    public fun accept_collection_offer_create_claim<T: key + store>(
        pool: &mut OfferPool,
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,
        offer_id: object::ID,
        marketplace: &mut cpu::core::CpuMarketplace,
        policy: &mut TransferPolicy<T>,
        mut fee_payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        // Check marketplace is not paused
        cpu::core::assert_marketplace_not_paused(marketplace);

        // ========== PHASE 1: READ-ONLY VALIDATION ==========
        // Read offer first to get values, DON'T modify status yet
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer_ref = &pool.offers[offer_id];
        assert!(offer_ref.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer_ref.is_collection_offer, ENotCollectionOffer);
        assert!(offer_ref.collection_id == object::id(collection), EWrongCollection);
        assert!(offer_ref.portfolio_id.is_none(), ENotPortfolioOffer);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer_ref.expire_time, EOfferExpired);

        let offer_amount = offer_ref.offer_amount;
        let offerer = offer_ref.offerer;

        // [M-02 FIX] Prevent self-acceptance (wash trading)
        assert!(ctx.sender() != offerer, ESelfAcceptanceNotAllowed);

        // ========== PHASE 2: FEE VALIDATION ==========
        // Validate marketplace version to enforce upgrade path
        cpu::core::validate_version(marketplace);

        // Calculate and validate fees using unified core API (unlisted flow)
        let (marketplace_fee, royalty_amount, total_fee) =
            cpu::core::calculate_fees_for_price<T>(marketplace, offer_amount, policy);
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= total_fee, EInsufficientFeePayment);
        assert_supported_claim_policy_rules(policy);
        if (offer_amount == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // ========== PHASE 3: FUND EXTRACTION ==========
        // NOW get mutable reference
        let offer_mut = &mut pool.offers[offer_id];

        // [M-02 FIX] Prevent portfolio offers from being accepted through non-portfolio path
        assert!(offer_mut.portfolio_id.is_none(), ENotPortfolioOffer);

        // Extract bounty to return to offerer
        let bounty_amount = offer_mut.cleanup_bounty.value();
        let bounty_refund = coin::from_balance(
            balance::withdraw_all(&mut offer_mut.cleanup_bounty),
            ctx
        );

        // Process payment — escrow instead of giving to seller immediately
        let seller = ctx.sender();
        let payment_to_seller = balance::withdraw_all(&mut offer_mut.escrow);

        // ========== PHASE 4: ITEM OPERATIONS ==========
        // Remove NFT from seller kiosk
        let purchased_item = kiosk::take<T>(kiosk, kiosk_cap, item_id);

        // Store NFT temporarily
        let ticket_uid = object::new(ctx);
        let ticket_id = object::uid_to_inner(&ticket_uid);

        let storage = TemporaryNftStorage<T> {
            nft: purchased_item,
            ticket_id,
        };

        df::add(
            &mut pool.id,
            TemporaryStorageKey { ticket_id },
            storage
        );

        // [H-01 FIX] Escrow seller payment instead of returning immediately
        let payment_storage = TemporaryPaymentStorage {
            payment_balance: payment_to_seller,
            ticket_id,
            buyer: offerer,
        };
        df::add(&mut pool.id, PaymentStorageKey { ticket_id }, payment_storage);

        // Store claim ticket metadata for recovery
        let claim_meta = ClaimTicketMeta {
            seller,
            buyer: offerer,
            nft_type: transfer_policy_utils::get_type_name<T>(),
            nft_id: item_id,
            collection_id: object::id(collection),
            created_at: current_time,
            recovery_unlocks_at: current_time + CLAIM_RECOVERY_PERIOD_MS,
        };
        df::add(&mut pool.id, ClaimTicketMetaKey { ticket_id }, claim_meta);

        // ========== PHASE 5: FEE PROCESSING ==========
        // fee_payment (provided by caller) is split into up to 3 parts:
        //   1. marketplace_fee  -> held in TemporaryMarketplaceFeeStorage until claim
        //   2. royalty_amount   -> held in TemporaryRoyaltyStorage until claim
        //   3. excess remainder -> returned to seller immediately (seller's money)
        if (marketplace_fee > 0) {
            let marketplace_fee_coin = fee_payment.split(marketplace_fee, ctx);
            let marketplace_fee_storage = TemporaryMarketplaceFeeStorage {
                fee_balance: marketplace_fee_coin.into_balance(),
                ticket_id,
            };
            df::add(
                &mut pool.id,
                MarketplaceFeeStorageKey { ticket_id },
                marketplace_fee_storage
            );
        };

        if (royalty_amount > 0) {
            let royalty_coin = fee_payment.split(royalty_amount, ctx);
            // Store royalty temporarily until claim is finalized
            let royalty_storage = TemporaryRoyaltyStorage {
                royalty_balance: royalty_coin.into_balance(),
                ticket_id,
            };
            df::add(&mut pool.id, RoyaltyStorageKey { ticket_id }, royalty_storage);
        };

        // Return excess fee payment to seller immediately (this is seller's money)
        if (fee_payment.value() > 0) {
            transfer::public_transfer(fee_payment, seller);
        } else {
            coin::destroy_zero(fee_payment);
        };

        // ========== PHASE 6: STATE COMMIT (DELAYED - KEY CHANGE!) ==========
        // IMPORTANT: Status update moved HERE, after all operations succeed
        offer_mut.status = OFFER_STATUS_ACCEPTED;
        record_terminal_offer(pool, offer_id);

        // ========== PHASE 7: CLEANUP & EVENTS ==========
        // Update pool counters
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Return bounty to offerer
        transfer::public_transfer(bounty_refund, offerer);

        // Get policy rule flags for enhanced claim ticket event and snapshot
        let has_personal_kiosk_rule = transfer_policy_utils::has_personal_kiosk_rule(policy);
        let has_royalty_rule = transfer_policy_utils::has_royalty_rule(policy);
        let has_floor_price_rule = transfer_policy_utils::has_floor_price_rule(policy);
        let has_kiosk_lock_rule = transfer_policy_utils::has_kiosk_lock_rule(policy);
        // [L-02 FIX] Snapshot royalty amount for parameter-level change detection
        let snapshot_royalty_amount = transfer_policy_utils::calculate_royalty(policy, offer_amount);
        let snapshot_policy_rule_count = transfer_policy_utils::policy_rule_count(policy);

        // Create claim ticket with policy snapshot
        let expire_time = current_time + CLAIM_TICKET_EXPIRY_MS;
        let ticket = PersonalKioskClaimTicket {
            id: ticket_uid,
            buyer: offerer,
            nft_type: transfer_policy_utils::get_type_name<T>(),
            nft_id: item_id,
            collection_id: object::id(collection),
            offer_id,
            seller,
            amount_paid: offer_amount,
            created_at: current_time,
            expires_at: expire_time,
            // [H-01 FIX] Policy snapshot
            policy_id: object::id(policy),
            snapshot_has_royalty_rule: has_royalty_rule,
            snapshot_has_floor_price_rule: has_floor_price_rule,
            snapshot_has_kiosk_lock_rule: has_kiosk_lock_rule,
            snapshot_has_personal_kiosk_rule: has_personal_kiosk_rule,
            // [L-02 FIX] Royalty parameter snapshot
            snapshot_royalty_amount,
            snapshot_policy_rule_count,
        };

        // Emit unified events
        events::emit_collection_offer_accepted_event<T>(
            collection,
            offer_id,
            seller,
            item_id,
            offer_amount,
            option::none(),  // Regular collection offer, not portfolio-funded
        );

        events::emit_claim_ticket_created_event(
            ticket_id,
            offerer,
            seller,
            item_id,
            object::id(collection),
            offer_amount,
            expire_time,
            has_personal_kiosk_rule,
            has_royalty_rule,
            has_floor_price_rule,
            has_kiosk_lock_rule,
            marketplace_fee,
            royalty_amount,
        );

        // [F1 FIX] Force-transfer ticket to buyer to prevent seller withholding
        transfer::public_transfer(ticket, offerer);
    }

    /// Accept portfolio collection offer and create claim ticket
    /// Ticket is transferred directly to buyer; seller payment is escrowed
    #[allow(lint(self_transfer))] // excess fee_payment refund to seller is intentional
    public fun accept_portfolio_collection_offer_create_claim<T: key + store>(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,
        offer_id: object::ID,
        marketplace: &mut cpu::core::CpuMarketplace,
        policy: &mut TransferPolicy<T>,
        mut fee_payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        // Check marketplace is not paused
        cpu::core::assert_marketplace_not_paused(marketplace);

        // ========== PHASE 1: READ-ONLY VALIDATION ==========
        // Read offer first to get values, DON'T modify status yet
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer_ref = &pool.offers[offer_id];
        assert!(offer_ref.status == OFFER_STATUS_ACTIVE, EOfferNotActive);
        assert!(offer_ref.is_collection_offer, ENotCollectionOffer);
        assert!(offer_ref.collection_id == object::id(collection), EWrongCollection);
        assert!(offer_ref.portfolio_id.is_some(), ENotPortfolioOffer);

        let portfolio_id = *offer_ref.portfolio_id.borrow();
        assert!(object::id(portfolio) == portfolio_id, EPortfolioIdMismatch);
        // [M-02 FIX] Prevent self-acceptance (wash trading) — corrected error code
        assert!(ctx.sender() != offer_ref.offerer, ESelfAcceptanceNotAllowed);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < offer_ref.expire_time, EOfferExpired);

        let offer_amount = offer_ref.offer_amount;
        let offerer = offer_ref.offerer;

        // ========== PHASE 2: FEE VALIDATION ==========
        // Validate marketplace version to enforce upgrade path
        cpu::core::validate_version(marketplace);

        // Calculate and validate fees using unified core API (unlisted flow)
        let (marketplace_fee, royalty_amount, total_fee) =
            cpu::core::calculate_fees_for_price<T>(marketplace, offer_amount, policy);
        let fee_payment_value = fee_payment.value();
        assert!(fee_payment_value >= total_fee, EInsufficientFeePayment);
        assert_supported_claim_policy_rules(policy);
        if (offer_amount == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // ========== PHASE 3: FUND EXTRACTION ==========
        // NOW get mutable reference
        let offer_mut = &mut pool.offers[offer_id];

        // Extract bounty to return to portfolio balance
        let bounty_amount = offer_mut.cleanup_bounty.value();
        let bounty_balance = balance::withdraw_all(&mut offer_mut.cleanup_bounty);

        // Process payment from portfolio — escrow instead of giving to seller
        let seller = ctx.sender();
        let payment_balance = offer_portfolio::release_offer(portfolio, offer_id);

        // ========== PHASE 4: ITEM OPERATIONS ==========
        // Remove NFT from seller kiosk
        let purchased_item = kiosk::take<T>(kiosk, kiosk_cap, item_id);

        // Store NFT temporarily
        let ticket_uid = object::new(ctx);
        let ticket_id = object::uid_to_inner(&ticket_uid);

        let storage = TemporaryNftStorage<T> {
            nft: purchased_item,
            ticket_id,
        };

        df::add(
            &mut pool.id,
            TemporaryStorageKey { ticket_id },
            storage
        );

        // [H-01 FIX] Escrow seller payment instead of returning immediately
        let payment_storage = TemporaryPaymentStorage {
            payment_balance,
            ticket_id,
            buyer: offerer,
        };
        df::add(&mut pool.id, PaymentStorageKey { ticket_id }, payment_storage);

        // Store claim ticket metadata for recovery
        let claim_meta = ClaimTicketMeta {
            seller,
            buyer: offerer,
            nft_type: transfer_policy_utils::get_type_name<T>(),
            nft_id: item_id,
            collection_id: object::id(collection),
            created_at: current_time,
            recovery_unlocks_at: current_time + CLAIM_RECOVERY_PERIOD_MS,
        };
        df::add(&mut pool.id, ClaimTicketMetaKey { ticket_id }, claim_meta);

        // ========== PHASE 5: FEE PROCESSING ==========
        // fee_payment (provided by caller) is split into up to 3 parts:
        //   1. marketplace_fee  -> held in TemporaryMarketplaceFeeStorage until claim
        //   2. royalty_amount   -> held in TemporaryRoyaltyStorage until claim
        //   3. excess remainder -> returned to seller immediately (seller's money)
        if (marketplace_fee > 0) {
            let marketplace_fee_coin = fee_payment.split(marketplace_fee, ctx);
            let marketplace_fee_storage = TemporaryMarketplaceFeeStorage {
                fee_balance: marketplace_fee_coin.into_balance(),
                ticket_id,
            };
            df::add(
                &mut pool.id,
                MarketplaceFeeStorageKey { ticket_id },
                marketplace_fee_storage
            );
        };

        if (royalty_amount > 0) {
            let royalty_coin = fee_payment.split(royalty_amount, ctx);
            // Store royalty temporarily until claim is finalized
            let royalty_storage = TemporaryRoyaltyStorage {
                royalty_balance: royalty_coin.into_balance(),
                ticket_id,
            };
            df::add(&mut pool.id, RoyaltyStorageKey { ticket_id }, royalty_storage);
        };

        // Return excess fee payment to seller immediately (this is seller's money)
        if (fee_payment.value() > 0) {
            transfer::public_transfer(fee_payment, seller);
        } else {
            coin::destroy_zero(fee_payment);
        };

        // ========== PHASE 6: STATE COMMIT (DELAYED - KEY CHANGE!) ==========
        // IMPORTANT: Status update moved HERE, after all operations succeed
        offer_mut.status = OFFER_STATUS_ACCEPTED;
        record_terminal_offer(pool, offer_id);

        // ========== PHASE 7: CLEANUP & EVENTS ==========
        // Update pool counters
        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;

        // Return bounty to portfolio balance
        offer_portfolio::return_bounty(portfolio, bounty_balance);

        // Get policy rule flags for enhanced claim ticket event and snapshot
        let has_personal_kiosk_rule = transfer_policy_utils::has_personal_kiosk_rule(policy);
        let has_royalty_rule = transfer_policy_utils::has_royalty_rule(policy);
        let has_floor_price_rule = transfer_policy_utils::has_floor_price_rule(policy);
        let has_kiosk_lock_rule = transfer_policy_utils::has_kiosk_lock_rule(policy);
        // [L-02 FIX] Snapshot royalty amount for parameter-level change detection
        let snapshot_royalty_amount = transfer_policy_utils::calculate_royalty(policy, offer_amount);
        let snapshot_policy_rule_count = transfer_policy_utils::policy_rule_count(policy);

        // Create claim ticket with policy snapshot
        let expire_time = current_time + CLAIM_TICKET_EXPIRY_MS;
        let ticket = PersonalKioskClaimTicket {
            id: ticket_uid,
            buyer: offerer,
            nft_type: transfer_policy_utils::get_type_name<T>(),
            nft_id: item_id,
            collection_id: object::id(collection),
            offer_id,
            seller,
            amount_paid: offer_amount,
            created_at: current_time,
            expires_at: expire_time,
            // [H-01 FIX] Policy snapshot
            policy_id: object::id(policy),
            snapshot_has_royalty_rule: has_royalty_rule,
            snapshot_has_floor_price_rule: has_floor_price_rule,
            snapshot_has_kiosk_lock_rule: has_kiosk_lock_rule,
            snapshot_has_personal_kiosk_rule: has_personal_kiosk_rule,
            // [L-02 FIX] Royalty parameter snapshot
            snapshot_royalty_amount,
            snapshot_policy_rule_count,
        };

        // Emit unified events
        events::emit_collection_offer_accepted_event<T>(
            collection,
            offer_id,
            seller,
            item_id,
            offer_amount,
            option::some(portfolio_id),  // Portfolio collection offer - include portfolio_id
        );

        events::emit_claim_ticket_created_event(
            ticket_id,
            offerer,
            seller,
            item_id,
            object::id(collection),
            offer_amount,
            expire_time,
            has_personal_kiosk_rule,
            has_royalty_rule,
            has_floor_price_rule,
            has_kiosk_lock_rule,
            marketplace_fee,
            royalty_amount,
        );

        // [F1 FIX] Force-transfer ticket to buyer to prevent seller withholding
        transfer::public_transfer(ticket, offerer);
    }

    /// Claim NFT to buyer's personal kiosk
    /// Must be called by the buyer (ticket owner)
    public fun claim_with_personal_kiosk<T: key + store>(
        pool: &mut OfferPool,
        ticket: PersonalKioskClaimTicket,
        buyer_personal_kiosk: &mut Kiosk,
        buyer_personal_cap: &mut PersonalKioskCap,
        policy: &mut TransferPolicy<T>,
        marketplace: &mut cpu::core::CpuMarketplace,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        // 1. Verify ticket ownership
        let caller = ctx.sender();
        assert!(ticket.buyer == caller, EUnauthorized);

        // 2. Verify not expired
        let current_time = clock::timestamp_ms(clock);
        assert!(current_time < ticket.expires_at, EClaimTicketExpired);

        // 3. Verify type name matches
        let actual_type = transfer_policy_utils::get_type_name<T>();
        assert!(ticket.nft_type == actual_type, ETypeMismatch);

        // 3.5 [M-02 FIX] Verify policy is the same one recorded at accept time
        assert!(object::id(policy) == ticket.policy_id, EPolicyIdMismatch);
        assert_supported_claim_policy_rules(policy);
        if (ticket.amount_paid == 0) {
            transfer_policy_utils::validate_zero_price_offer<T>(policy);
        };

        // 3.6 Early policy snapshot validation to avoid deep execution/gas waste.
        let changed = has_policy_snapshot_changed(&ticket, policy);
        assert!(!changed, EPolicyRulesChanged);

        // 4. Verify personal kiosk ownership
        assert!(
            personal_kiosk::owner(buyer_personal_kiosk) == caller,
            ENotPersonalKioskOwner
        );

        // 5. Retrieve NFT from temporary storage
        let storage_key = TemporaryStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        let TemporaryNftStorage<T> { nft, ticket_id: _ } = df::remove(
            &mut pool.id,
            storage_key
        );

        // 5.5. Remove claim ticket metadata
        let meta_key = ClaimTicketMetaKey { ticket_id: object::uid_to_inner(&ticket.id) };
        if (df::exists_(&pool.id, meta_key)) {
            let ClaimTicketMeta { seller: _, buyer: _, nft_type: _, nft_id: _, collection_id: _, created_at: _, recovery_unlocks_at: _ } =
                df::remove(&mut pool.id, meta_key);
        };

        // 6. Create transfer request
        let mut transfer_request = transfer_policy::new_request<T>(
            object::id(&nft),
            ticket.amount_paid,
            object::id(&nft),
        );

        // 7. Lock NFT in buyer's personal kiosk
        // Borrow the KioskOwnerCap from PersonalKioskCap to perform the lock
        let kiosk_cap = personal_kiosk::borrow_mut(buyer_personal_cap);
        kiosk::lock(buyer_personal_kiosk, kiosk_cap, policy, nft);

        // 8. Prove personal_kiosk_rule if present (✅ now sender = buyer)
        if (transfer_policy_utils::has_personal_kiosk_rule(policy)) {
            personal_kiosk_rule::prove(buyer_personal_kiosk, &mut transfer_request);
        };

        // 9. Prove kiosk_lock_rule if present
        if (transfer_policy_utils::has_kiosk_lock_rule(policy)) {
            kiosk_lock_rule::prove(&mut transfer_request, buyer_personal_kiosk);
        };

        // 9.5. Prove floor_price_rule if present
        if (transfer_policy_utils::has_floor_price_rule(policy)) {
            floor_price_rule::prove(policy, &mut transfer_request);
        };

        // 10. Pay royalty if required
        if (transfer_policy_utils::has_royalty_rule(policy)) {
            let royalty_key = RoyaltyStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };

            // Check if royalty storage exists (handles zero royalty case)
            if (df::exists_(&pool.id, royalty_key)) {
                // Non-zero royalty: retrieve and pay from storage
                let TemporaryRoyaltyStorage { royalty_balance, ticket_id: _ } =
                    df::remove(&mut pool.id, royalty_key);
                let royalty_coin = coin::from_balance(royalty_balance, ctx);
                royalty_rule::pay(policy, &mut transfer_request, royalty_coin);
            } else {
                // Zero royalty case: storage was never created in Stage 1
                // Pay zero royalty to satisfy the rule
                let zero_royalty = coin::zero<SUI>(ctx);
                royalty_rule::pay(policy, &mut transfer_request, zero_royalty);
            };
        };

        // 11. Confirm transfer
        let (_, _, _) = transfer_policy::confirm_request(policy, transfer_request);

        // 12. Collect marketplace fee only after successful claim completion
        let marketplace_fee_key = MarketplaceFeeStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        if (df::exists_(&pool.id, marketplace_fee_key)) {
            let TemporaryMarketplaceFeeStorage { fee_balance, ticket_id: _ } =
                df::remove(&mut pool.id, marketplace_fee_key);
            let marketplace_fee_coin = coin::from_balance(fee_balance, ctx);
            cpu::core::collect_marketplace_fee(marketplace, marketplace_fee_coin);
        };

        // 13. [H-01 FIX] Release escrowed payment to seller on successful claim
        let payment_key = PaymentStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        if (df::exists_(&pool.id, payment_key)) {
            let TemporaryPaymentStorage { payment_balance, ticket_id: _, buyer: _ } =
                df::remove(&mut pool.id, payment_key);
            let seller_payment_coin = coin::from_balance(payment_balance, ctx);
            transfer::public_transfer(seller_payment_coin, ticket.seller);
        };

        // 14. Emit event
        events::emit_nft_claimed_event(
            object::uid_to_inner(&ticket.id),
            caller,
            ticket.nft_id,
            object::id(buyer_personal_kiosk),
        );

        // 15. Delete ticket
        let PersonalKioskClaimTicket { id, .. } = ticket;
        id.delete();
    }

    /// Cancel expired claim and return NFT to seller
    /// [H-01 FIX] Also refunds escrowed payment to buyer
    /// Returns Option<Coin<SUI>> containing royalty if it exists (for seller)
    public fun cancel_expired_claim<T: key + store>(
        pool: &mut OfferPool,
        ticket: PersonalKioskClaimTicket,
        seller_kiosk: &mut Kiosk,
        seller_kiosk_cap: &KioskOwnerCap,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): option::Option<coin::Coin<SUI>> {
        // 1. Verify expired
        let current_time = clock::timestamp_ms(clock);
        assert!(current_time >= ticket.expires_at, EClaimTicketNotExpired);

        // 2. Verify seller
        let caller = ctx.sender();
        assert!(ticket.seller == caller, EUnauthorized);

        // 3. Verify type
        let actual_type = transfer_policy_utils::get_type_name<T>();
        assert!(ticket.nft_type == actual_type, ETypeMismatch);

        // 4. Retrieve NFT from temporary storage
        let storage_key = TemporaryStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        let TemporaryNftStorage<T> { nft, ticket_id: _ } = df::remove(
            &mut pool.id,
            storage_key
        );

        // 4.5. Remove claim ticket metadata
        let meta_key = ClaimTicketMetaKey { ticket_id: object::uid_to_inner(&ticket.id) };
        if (df::exists_(&pool.id, meta_key)) {
            let ClaimTicketMeta { seller: _, buyer: _, nft_type: _, nft_id: _, collection_id: _, created_at: _, recovery_unlocks_at: _ } =
                df::remove(&mut pool.id, meta_key);
        };

        // 5. Return NFT to seller kiosk
        kiosk::place(seller_kiosk, seller_kiosk_cap, nft);

        // 5.5. [H-01 FIX] Refund escrowed payment to BUYER on cancellation
        let payment_key = PaymentStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        let buyer_refund_amount = if (df::exists_(&pool.id, payment_key)) {
            let TemporaryPaymentStorage { payment_balance, ticket_id: _, buyer } =
                df::remove(&mut pool.id, payment_key);
            let refund_amount = payment_balance.value();
            let refund_coin = coin::from_balance(payment_balance, ctx);
            transfer::public_transfer(refund_coin, buyer);
            refund_amount
        } else {
            0
        };

        // 5.55. Refund marketplace fee to seller if it was escrowed
        let marketplace_fee_key = MarketplaceFeeStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        if (df::exists_(&pool.id, marketplace_fee_key)) {
            let TemporaryMarketplaceFeeStorage { fee_balance, ticket_id: _ } =
                df::remove(&mut pool.id, marketplace_fee_key);
            let marketplace_fee_coin = coin::from_balance(fee_balance, ctx);
            transfer::public_transfer(marketplace_fee_coin, ticket.seller);
        };

        // 5.6. Clean up royalty storage if it exists and prepare to return to seller
        let royalty_key = RoyaltyStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        let royalty_refund = if (df::exists_(&pool.id, royalty_key)) {
            let TemporaryRoyaltyStorage { royalty_balance, ticket_id: _ } =
                df::remove(&mut pool.id, royalty_key);
            let royalty_coin = coin::from_balance(royalty_balance, ctx);
            option::some(royalty_coin)
        } else {
            option::none()
        };

        // 6. Emit event
        events::emit_claim_cancelled_event(
            object::uid_to_inner(&ticket.id),
            ticket.seller,
            ticket.nft_id,
            std::ascii::string(b"expired"),
            caller,  // cancelled_by
            true,    // was_expired
            buyer_refund_amount,
        );

        // 7. Delete ticket
        let PersonalKioskClaimTicket { id, .. } = ticket;
        id.delete();

        // 8. Return royalty refund if any
        royalty_refund
    }

    /// [H-01 FIX] Cancel claim when transfer policy rules have changed.
    /// Buyer-callable: refund path when claim becomes unclaimable due policy drift.
    public fun cancel_claim_policy_changed<T: key + store>(
        pool: &mut OfferPool,
        ticket: PersonalKioskClaimTicket,
        policy: &TransferPolicy<T>,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        // 1. Verify caller is buyer
        assert!(ticket.buyer == ctx.sender(), EUnauthorized);

        // 1.5 Delay cancellation to reduce trivial policy-tweak trade reversals.
        let current_time = clock::timestamp_ms(clock);
        assert!(
            current_time >= ticket.created_at + POLICY_CHANGE_CANCEL_DELAY_MS,
            EPolicyChangeCancelDelayNotPassed
        );

        // 2. Verify type
        let actual_type = transfer_policy_utils::get_type_name<T>();
        assert!(ticket.nft_type == actual_type, ETypeMismatch);

        // 2.5 [M-02 FIX] Verify this is the SAME policy recorded at accept time
        assert!(object::id(policy) == ticket.policy_id, EPolicyIdMismatch);

        // Conservative policy-cancel behavior: any snapshot delta qualifies.
        // This intentionally includes beneficial changes.
        let changed = has_policy_snapshot_changed(&ticket, policy);
        assert!(changed, EPolicyRulesChanged);

        // 4. Return NFT to seller inside a fresh owned kiosk.
        // Keeping it owned enables later consolidation and deterministic cleanup.
        let storage_key = TemporaryStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        let TemporaryNftStorage<T> { nft, ticket_id: _ } = df::remove(
            &mut pool.id,
            storage_key
        );
        let (mut seller_kiosk, seller_kiosk_cap) = kiosk::new(ctx);
        kiosk::place(&mut seller_kiosk, &seller_kiosk_cap, nft);
        transfer::public_transfer(seller_kiosk, ticket.seller);
        transfer::public_transfer(seller_kiosk_cap, ticket.seller);

        // 5. Remove claim ticket metadata
        let meta_key = ClaimTicketMetaKey { ticket_id: object::uid_to_inner(&ticket.id) };
        if (df::exists_(&pool.id, meta_key)) {
            let ClaimTicketMeta { seller: _, buyer: _, nft_type: _, nft_id: _, collection_id: _, created_at: _, recovery_unlocks_at: _ } =
                df::remove(&mut pool.id, meta_key);
        };

        // 6. Refund escrowed payment to buyer
        let payment_key = PaymentStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        let refund_amount = if (df::exists_(&pool.id, payment_key)) {
            let TemporaryPaymentStorage { payment_balance, ticket_id: _, buyer: _ } =
                df::remove(&mut pool.id, payment_key);
            let amount = payment_balance.value();
            let refund_coin = coin::from_balance(payment_balance, ctx);
            transfer::public_transfer(refund_coin, ticket.buyer);
            amount
        } else {
            0
        };

        // 7. Refund marketplace fee to seller (who fronted it)
        let marketplace_fee_key = MarketplaceFeeStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        if (df::exists_(&pool.id, marketplace_fee_key)) {
            let TemporaryMarketplaceFeeStorage { fee_balance, ticket_id: _ } =
                df::remove(&mut pool.id, marketplace_fee_key);
            let marketplace_fee_coin = coin::from_balance(fee_balance, ctx);
            transfer::public_transfer(marketplace_fee_coin, ticket.seller);
        };

        // 8. Refund royalty to seller (who fronted it)
        let royalty_key = RoyaltyStorageKey { ticket_id: object::uid_to_inner(&ticket.id) };
        if (df::exists_(&pool.id, royalty_key)) {
            let TemporaryRoyaltyStorage { royalty_balance, ticket_id: _ } =
                df::remove(&mut pool.id, royalty_key);
            let royalty_coin = coin::from_balance(royalty_balance, ctx);
            transfer::public_transfer(royalty_coin, ticket.seller);
        };

        // 9. Emit refund event
        events::emit_claim_refunded_event(
            object::uid_to_inner(&ticket.id),
            ticket.buyer,
            ticket.seller,
            ticket.nft_id,
            refund_amount,
            std::ascii::string(b"policy_changed"),
        );

        // 10. Delete ticket
        let PersonalKioskClaimTicket { id, .. } = ticket;
        id.delete();
    }

    /// Consolidate a temporary claim-cancel kiosk into seller's primary kiosk.
    ///
    /// Intended for kiosks created by `cancel_claim_policy_changed`, where each kiosk
    /// contains exactly one returned NFT. Moves the NFT into `seller_kiosk`, then closes
    /// the temporary kiosk and optionally returns accumulated profits.
    public fun consolidate_orphan_claim_kiosk<T: key + store>(
        mut orphan_kiosk: Kiosk,
        orphan_kiosk_cap: KioskOwnerCap,
        seller_kiosk: &mut Kiosk,
        seller_kiosk_cap: &KioskOwnerCap,
        item_id: object::ID,
        ctx: &mut tx_context::TxContext,
    ): option::Option<coin::Coin<SUI>> {
        let item = kiosk::take<T>(&mut orphan_kiosk, &orphan_kiosk_cap, item_id);
        kiosk::place(seller_kiosk, seller_kiosk_cap, item);

        let profits = kiosk::close_and_withdraw(orphan_kiosk, orphan_kiosk_cap, ctx);
        if (profits.value() > 0) {
            option::some(profits)
        } else {
            coin::destroy_zero(profits);
            option::none()
        }
    }

    /// Cancel expired claim by ticket ID without requiring ticket object ownership.
    /// Allows seller to reclaim NFT as soon as claim expiry passes (7 days).
    public fun cancel_expired_claim_by_id<T: key + store>(
        pool: &mut OfferPool,
        ticket_id: object::ID,
        seller_kiosk: &mut Kiosk,
        seller_kiosk_cap: &KioskOwnerCap,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): option::Option<coin::Coin<SUI>> {
        let current_time = clock::timestamp_ms(clock);
        let caller = ctx.sender();

        // 1. Verify metadata exists and caller is seller
        let meta_key = ClaimTicketMetaKey { ticket_id };
        assert!(df::exists_(&pool.id, meta_key), EClaimMetaNotFound);

        let meta_ref: &ClaimTicketMeta = df::borrow(&pool.id, meta_key);
        assert!(meta_ref.seller == caller, ENotClaimSeller);
        assert!(current_time >= meta_ref.created_at + CLAIM_TICKET_EXPIRY_MS, EClaimTicketNotExpired);

        // 2. Verify type matches
        let actual_type = transfer_policy_utils::get_type_name<T>();
        assert!(meta_ref.nft_type == actual_type, ETypeMismatch);

        // Cache values before removing metadata
        let seller = meta_ref.seller;
        let buyer = meta_ref.buyer;
        let nft_id = meta_ref.nft_id;

        // 3. Remove metadata
        let ClaimTicketMeta {
            seller: _, buyer: _, nft_type: _, nft_id: _,
            collection_id: _, created_at: _, recovery_unlocks_at: _,
        } = df::remove(&mut pool.id, meta_key);

        // 4. Retrieve NFT from temporary storage and return to seller kiosk
        let storage_key = TemporaryStorageKey { ticket_id };
        let TemporaryNftStorage<T> { nft, ticket_id: _ } = df::remove(
            &mut pool.id,
            storage_key
        );
        kiosk::place(seller_kiosk, seller_kiosk_cap, nft);

        // 5. Refund escrowed payment to buyer
        let payment_key = PaymentStorageKey { ticket_id };
        let buyer_refund_amount = if (df::exists_(&pool.id, payment_key)) {
            let TemporaryPaymentStorage { payment_balance, ticket_id: _, buyer: _ } =
                df::remove(&mut pool.id, payment_key);
            let refund_amount = payment_balance.value();
            let refund_coin = coin::from_balance(payment_balance, ctx);
            transfer::public_transfer(refund_coin, buyer);
            refund_amount
        } else {
            0
        };

        // 6. Refund marketplace fee to seller (who fronted it)
        let marketplace_fee_key = MarketplaceFeeStorageKey { ticket_id };
        if (df::exists_(&pool.id, marketplace_fee_key)) {
            let TemporaryMarketplaceFeeStorage { fee_balance, ticket_id: _ } =
                df::remove(&mut pool.id, marketplace_fee_key);
            let marketplace_fee_coin = coin::from_balance(fee_balance, ctx);
            transfer::public_transfer(marketplace_fee_coin, seller);
        };

        // 7. Refund royalty to seller if present
        let royalty_key = RoyaltyStorageKey { ticket_id };
        let royalty_refund = if (df::exists_(&pool.id, royalty_key)) {
            let TemporaryRoyaltyStorage { royalty_balance, ticket_id: _ } =
                df::remove(&mut pool.id, royalty_key);
            let royalty_coin = coin::from_balance(royalty_balance, ctx);
            option::some(royalty_coin)
        } else {
            option::none()
        };

        // 8. Emit event
        events::emit_claim_cancelled_event(
            ticket_id,
            seller,
            nft_id,
            std::ascii::string(b"expired_by_id"),
            caller,
            true,
            buyer_refund_amount,
        );

        royalty_refund
    }

    /// Delete a stale claim ticket object after state was already recovered/cancelled by ID.
    ///
    /// This is safe only when ALL storage entries tied to the ticket have been removed.
    public fun cleanup_stale_claim_ticket(
        pool: &OfferPool,
        ticket: PersonalKioskClaimTicket,
    ) {
        let ticket_id = object::uid_to_inner(&ticket.id);
        let has_live_entries =
            df::exists_(&pool.id, ClaimTicketMetaKey { ticket_id }) ||
            df::exists_(&pool.id, TemporaryStorageKey { ticket_id }) ||
            df::exists_(&pool.id, PaymentStorageKey { ticket_id }) ||
            df::exists_(&pool.id, MarketplaceFeeStorageKey { ticket_id }) ||
            df::exists_(&pool.id, RoyaltyStorageKey { ticket_id });
        assert!(!has_live_entries, EClaimTicketNotStale);

        let PersonalKioskClaimTicket { id, .. } = ticket;
        id.delete();
    }

    // ========== Helper Functions for Claim Tickets ==========

    /// Check if an NFT is in temporary storage
    public fun has_nft_in_storage(pool: &OfferPool, ticket_id: object::ID): bool {
        let storage_key = TemporaryStorageKey { ticket_id };
        df::exists_(&pool.id, storage_key)
    }

    /// Get claim ticket expiry time
    public fun get_claim_expiry(ticket: &PersonalKioskClaimTicket): u64 {
        ticket.expires_at
    }

    /// Get claim ticket buyer
    public fun get_claim_buyer(ticket: &PersonalKioskClaimTicket): address {
        ticket.buyer
    }

    /// Get claim ticket NFT ID
    public fun get_claim_nft_id(ticket: &PersonalKioskClaimTicket): object::ID {
        ticket.nft_id
    }

    fun mark_offer_expired(
        pool: &mut OfferPool,
        item_id: object::ID,
        offer_id: object::ID,
        ctx: &mut tx_context::TxContext,
    ) {
        let offer = &mut pool.offers[offer_id];
        let collection_id = offer.collection_id;
        let offerer = offer.offerer;
        offer.status = OFFER_STATUS_EXPIRED;

        // [H-01 FIX] Refund cleanup bounty (was previously leaked)
        // For portfolio offers, bounty is returned to the portfolio during the
        // portfolio-aware expired-recovery path.
        let bounty_amount = offer.cleanup_bounty.value();
        let mut bounty_released = false;
        if (bounty_amount > 0 && offer.portfolio_id.is_none()) {
            let bounty_balance = balance::withdraw_all(&mut offer.cleanup_bounty);
            let bounty_refund = coin::from_balance(bounty_balance, ctx);
            transfer::public_transfer(bounty_refund, offerer);
            bounty_released = true;
        };

        // Handle escrow refund based on whether this is a portfolio-backed offer
        let refund_amount = if (offer.portfolio_id.is_some()) {
            // Portfolio-backed offer: funds are in portfolio, not escrow
            // Commitment and bounty are released later via clean_expired_portfolio_offers
            // (owner path) or recover_expired_portfolio_offers (permissionless path).
            offer.offer_amount
        } else {
            // Regular offer: funds are in escrow
            let escrow_amount = offer.escrow.value();
            let refund_balance = balance::withdraw_all(&mut offer.escrow);
            let refund = coin::from_balance(refund_balance, ctx);
            transfer::public_transfer(refund, offerer);
            escrow_amount
        };

        pool.active_offers_count = pool.active_offers_count - 1;
        pool.total_volume_locked = pool.total_volume_locked - refund_amount;
        // Portfolio-backed bounties are released later during portfolio cleanup.
        if (bounty_released) {
            pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;
        };

        events::emit_offer_expired_event(
            offer_id,
            offerer,
            item_id,
            collection_id,
        );
        record_terminal_offer(pool, offer_id);
    }

    // ========== Query Functions ==========

    /// Get the best (highest) offer for an item
    public fun get_best_offer(
        pool: &OfferPool,
        item_id: object::ID,
        clock: &Clock,
    ): option::Option<object::ID> {
        if (!pool.offers_by_item.contains(item_id)) {
            return option::none()
        };

        let item_offers = &pool.offers_by_item[item_id];
        let current_time = clock::timestamp_ms(clock);

        let mut best_offer_id = option::none<ID>();
        let mut best_amount = 0u64;

        let mut i = 0;
        let len = item_offers.length();

        while (i < len) {
            let offer_id = item_offers[i];

            if (pool.offers.contains(offer_id)) {
                let offer = &pool.offers[offer_id];

                if (offer.status == OFFER_STATUS_ACTIVE &&
                    current_time < offer.expire_time &&
                    offer.offer_amount > best_amount) {
                    best_amount = offer.offer_amount;
                    best_offer_id = option::some(offer_id);
                }
            };

            i = i + 1;
        };

        best_offer_id
    }

    /// Get the best (highest) offer for a collection
    public fun get_best_collection_offer(
        pool: &OfferPool,
        collection_id: object::ID,
        clock: &Clock,
    ): option::Option<object::ID> {
        if (!pool.collection_offers.contains(collection_id)) {
            return option::none()
        };

        let collection_offer_ids = &pool.collection_offers[collection_id];
        let current_time = clock::timestamp_ms(clock);

        let mut best_offer_id = option::none<ID>();
        let mut best_amount = 0u64;

        let mut i = 0;
        let len = collection_offer_ids.length();

        while (i < len) {
            let offer_id = collection_offer_ids[i];

            if (pool.offers.contains(offer_id)) {
                let offer = &pool.offers[offer_id];

                if (offer.status == OFFER_STATUS_ACTIVE &&
                    current_time < offer.expire_time &&
                    offer.offer_amount > best_amount) {
                    best_amount = offer.offer_amount;
                    best_offer_id = option::some(offer_id);
                }
            };

            i = i + 1;
        };

        best_offer_id
    }

    /// Get offer details
    public fun get_offer_details(
        pool: &OfferPool,
        offer_id: object::ID,
    ): (address, ID, u64, u64, u8, ID) {
        assert!(pool.offers.contains(offer_id), EOfferNotFound);

        let offer = &pool.offers[offer_id];

        (
            offer.offerer,
            offer.target_item_id,
            offer.offer_amount,
            offer.expire_time,
            offer.status,
            offer.collection_id
        )
    }

    /// Returns current auto-created kiosk count within the active rate-limit window.
    public fun get_auto_created_kiosk_count(
        pool: &OfferPool,
        buyer: address,
    ): u64 {
        if (pool.auto_kiosk_count_by_buyer.contains(buyer)) {
            let window = &pool.auto_kiosk_count_by_buyer[buyer];
            window.count
        } else {
            0
        }
    }

    /// Check if offer is active and not expired
    public fun is_offer_valid(
        pool: &OfferPool,
        offer_id: object::ID,
        clock: &Clock,
    ): bool {
        if (!pool.offers.contains(offer_id)) {
            return false
        };

        let offer = &pool.offers[offer_id];
        let current_time = clock::timestamp_ms(clock);

        offer.status == OFFER_STATUS_ACTIVE && current_time < offer.expire_time
    }

    /// Get pool statistics
    public fun get_pool_stats(pool: &OfferPool): (u64, u64) {
        (pool.active_offers_count, pool.total_volume_locked)
    }

    #[test_only]
    public fun offers_index_len_for_item(
        pool: &OfferPool,
        item_id: object::ID,
    ): u64 {
        if (!pool.offers_by_item.contains(item_id)) { return 0 };
        let vref = &pool.offers_by_item[item_id];
        vref.length()
    }

    /// Internal compaction for item index.
    /// Returns number of cleaned entries and emits compaction event.
    fun compact_offers_for_item_internal(
        pool: &mut OfferPool,
        item_id: object::ID,
        fallback_collection_id: object::ID,
    ): u64 {
        let mut old_vec = pool.offers_by_item.remove(item_id);
        let mut new_vec = vector[];
        let mut cleaned: u64 = 0;
        let zero_id = object::id_from_address(@0x0);
        let mut resolved_collection_id = fallback_collection_id;

        while (!old_vec.is_empty()) {
            let offer_id = old_vec.pop_back();
            if (pool.offers.contains(offer_id)) {
                let offer = &pool.offers[offer_id];

                // Resolve collection_id for event payload when possible.
                if (resolved_collection_id == zero_id) {
                    resolved_collection_id = offer.collection_id;
                };

                if (offer.status == OFFER_STATUS_ACTIVE) {
                    new_vec.push_back(offer_id);
                } else {
                    cleaned = cleaned + 1;
                }
            } else {
                cleaned = cleaned + 1;
            };
        };

        pool.offers_by_item.add(item_id, new_vec);
        events::emit_offers_compacted_event(item_id, resolved_collection_id, cleaned);
        cleaned
    }

    /// Internal compaction for collection index.
    /// Returns number of cleaned entries and emits compaction event.
    fun compact_collection_offers_internal(
        pool: &mut OfferPool,
        collection_id: object::ID,
    ): u64 {
        let mut old_vec = pool.collection_offers.remove(collection_id);
        let mut new_vec = vector[];
        let mut cleaned: u64 = 0;

        while (!old_vec.is_empty()) {
            let offer_id = old_vec.pop_back();
            if (pool.offers.contains(offer_id)) {
                let offer = &pool.offers[offer_id];
                if (offer.status == OFFER_STATUS_ACTIVE) {
                    new_vec.push_back(offer_id);
                } else {
                    cleaned = cleaned + 1;
                }
            } else {
                cleaned = cleaned + 1;
            };
        };

        pool.collection_offers.add(collection_id, new_vec);
        // For collection compaction, use ZERO item id and actual collection_id.
        events::emit_offers_compacted_event(object::id_from_address(@0x0), collection_id, cleaned);
        cleaned
    }

    /// Compact offers-by-item index by removing stale (missing or inactive) offers.
    public fun compact_offers_for_item(
        pool: &mut OfferPool,
        item_id: object::ID,
        _ctx: &mut tx_context::TxContext,
    ) {
        if (!pool.offers_by_item.contains(item_id)) {
            return
        };
        let _ = compact_offers_for_item_internal(pool, item_id, object::id_from_address(@0x0));
    }

    /// Compact collection offers index by removing stale (missing or inactive) offers.
    public fun compact_collection_offers(
        pool: &mut OfferPool,
        collection_id: object::ID,
        _ctx: &mut tx_context::TxContext,
    ) {
        if (!pool.collection_offers.contains(collection_id)) {
            return
        };
        let _ = compact_collection_offers_internal(pool, collection_id);
    }

    /// Clean up expired offers (can be called by anyone)
    public fun clean_expired_offers(
        pool: &mut OfferPool,
        item_id: object::ID,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);
        if (!pool.offers_by_item.contains(item_id)) {
            return
        };

        let current_time = clock::timestamp_ms(clock);
        let len;
        {
            let offers_ref = &pool.offers_by_item[item_id];
            len = offers_ref.length();
        };

        let mut i = 0;
        let mut processed = 0;
        while (i < len && processed < MAX_EXPIRED_CLEANUPS_PER_TX) {
            let offer_id = {
                let offers_ref = &pool.offers_by_item[item_id];
                offers_ref[i]
            };

            if (pool.offers.contains(offer_id)) {
                let mut should_expire = false;
                {
                    let offer = &pool.offers[offer_id];
                    if (offer.status == OFFER_STATUS_ACTIVE &&
                        current_time >= offer.expire_time) {
                        should_expire = true;
                    }
                };

                if (should_expire) {
                    mark_offer_expired(pool, item_id, offer_id, ctx);
                    processed = processed + 1;
                }
            };

            i = i + 1;
        };
    }

    /// Clean up expired collection offers (can be called by anyone)
    public fun clean_expired_collection_offers(
        pool: &mut OfferPool,
        collection_id: object::ID,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);
        if (!pool.collection_offers.contains(collection_id)) {
            return
        };

        let current_time = clock::timestamp_ms(clock);
        let len;
        {
            let offers_ref = &pool.collection_offers[collection_id];
            len = offers_ref.length();
        };

        let mut i = 0;
        let mut processed = 0;
        while (i < len && processed < MAX_EXPIRED_CLEANUPS_PER_TX) {
            let offer_id = {
                let offers_ref = &pool.collection_offers[collection_id];
                offers_ref[i]
            };

            if (pool.offers.contains(offer_id)) {
                let mut should_expire = false;
                {
                    let offer = &pool.offers[offer_id];
                    if (offer.status == OFFER_STATUS_ACTIVE &&
                        current_time >= offer.expire_time) {
                        should_expire = true;
                    }
                };

                if (should_expire) {
                    // For collection offers, pass ID::ZERO as item_id since they don't target specific items
                    mark_offer_expired(pool, object::id_from_address(@0x0), offer_id, ctx);
                    processed = processed + 1;
                }
            };

            i = i + 1;
        };
    }

    fun release_expired_portfolio_commitments_for_item(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        item_id: object::ID,
        current_time: u64,
    ) {
        if (!pool.offers_by_item.contains(item_id)) {
            return
        };

        let portfolio_id = offer_portfolio::get_id(portfolio);
        let len;
        {
            let offers_ref = &pool.offers_by_item[item_id];
            len = offers_ref.length();
        };

        let mut i = 0;
        while (i < len) {
            let offer_id = {
                let offers_ref = &pool.offers_by_item[item_id];
                offers_ref[i]
            };

            if (pool.offers.contains(offer_id)) {
                let mut should_release = false;
                let mut should_mark_expired = false;
                let mut collection_id = object::id_from_address(@0x0);
                let mut offerer = @0x0;
                {
                    let offer = &pool.offers[offer_id];
                    if (offer.portfolio_id.is_some() &&
                        *offer.portfolio_id.borrow() == portfolio_id) {
                        if (offer.status == OFFER_STATUS_EXPIRED) {
                            should_release = true;
                        } else if (
                            offer.status == OFFER_STATUS_ACTIVE &&
                            current_time >= offer.expire_time
                        ) {
                            should_release = true;
                            should_mark_expired = true;
                            collection_id = offer.collection_id;
                            offerer = offer.offerer;
                        };
                    }
                };

                if (should_release) {
                    if (should_mark_expired) {
                        let offer_amount = {
                            let offer = &mut pool.offers[offer_id];
                            offer.status = OFFER_STATUS_EXPIRED;
                            offer.offer_amount
                        };
                        pool.active_offers_count = pool.active_offers_count - 1;
                        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
                        events::emit_offer_expired_event(
                            offer_id,
                            offerer,
                            item_id,
                            collection_id,
                        );
                        record_terminal_offer(pool, offer_id);
                    };

                    if (offer_portfolio::is_offer_committed(portfolio, offer_id)) {
                        offer_portfolio::refund_offer(portfolio, offer_id);
                    };

                    let bounty_amount = {
                        let offer = &pool.offers[offer_id];
                        offer.cleanup_bounty.value()
                    };
                    if (bounty_amount > 0) {
                        let bounty_balance = {
                            let offer = &mut pool.offers[offer_id];
                            balance::withdraw_all(&mut offer.cleanup_bounty)
                        };
                        offer_portfolio::return_bounty(portfolio, bounty_balance);
                        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;
                    };
                }
            };

            i = i + 1;
        };
    }

    fun release_expired_portfolio_commitments_for_collection(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection_id: object::ID,
        current_time: u64,
    ) {
        if (!pool.collection_offers.contains(collection_id)) {
            return
        };

        let portfolio_id = offer_portfolio::get_id(portfolio);
        let len;
        {
            let offers_ref = &pool.collection_offers[collection_id];
            len = offers_ref.length();
        };

        let mut i = 0;
        while (i < len) {
            let offer_id = {
                let offers_ref = &pool.collection_offers[collection_id];
                offers_ref[i]
            };

            if (pool.offers.contains(offer_id)) {
                let mut should_release = false;
                let mut should_mark_expired = false;
                let mut offerer = @0x0;
                {
                    let offer = &pool.offers[offer_id];
                    if (offer.portfolio_id.is_some() &&
                        *offer.portfolio_id.borrow() == portfolio_id) {
                        if (offer.status == OFFER_STATUS_EXPIRED) {
                            should_release = true;
                        } else if (
                            offer.status == OFFER_STATUS_ACTIVE &&
                            current_time >= offer.expire_time
                        ) {
                            should_release = true;
                            should_mark_expired = true;
                            offerer = offer.offerer;
                        };
                    }
                };

                if (should_release) {
                    if (should_mark_expired) {
                        let offer_amount = {
                            let offer = &mut pool.offers[offer_id];
                            offer.status = OFFER_STATUS_EXPIRED;
                            offer.offer_amount
                        };
                        pool.active_offers_count = pool.active_offers_count - 1;
                        pool.total_volume_locked = pool.total_volume_locked - offer_amount;
                        events::emit_offer_expired_event(
                            offer_id,
                            offerer,
                            object::id_from_address(@0x0),
                            collection_id,
                        );
                        record_terminal_offer(pool, offer_id);
                    };

                    if (offer_portfolio::is_offer_committed(portfolio, offer_id)) {
                        offer_portfolio::refund_offer(portfolio, offer_id);
                    };

                    let bounty_amount = {
                        let offer = &pool.offers[offer_id];
                        offer.cleanup_bounty.value()
                    };
                    if (bounty_amount > 0) {
                        let bounty_balance = {
                            let offer = &mut pool.offers[offer_id];
                            balance::withdraw_all(&mut offer.cleanup_bounty)
                        };
                        offer_portfolio::return_bounty(portfolio, bounty_balance);
                        pool.total_cleanup_bounty_locked = pool.total_cleanup_bounty_locked - bounty_amount;
                    };
                }
            };

            i = i + 1;
        };
    }

    /// Clean up expired portfolio offers and release funds back to the portfolio.
    /// Must be called by portfolio owner.
    public fun clean_expired_portfolio_offers(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        item_id: object::ID,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        offer_portfolio::verify_owner(portfolio, ctx);
        let current_time = clock::timestamp_ms(clock);
        release_expired_portfolio_commitments_for_item(pool, portfolio, item_id, current_time);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);
    }

    /// Permissionless recovery path for expired portfolio commitments.
    /// Useful if portfolio owner key is lost and commitments remain locked.
    public fun recover_expired_portfolio_offers(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        item_id: object::ID,
        clock: &Clock,
    ) {
        let current_time = clock::timestamp_ms(clock);
        release_expired_portfolio_commitments_for_item(pool, portfolio, item_id, current_time);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);
    }

    /// Clean up expired collection offers from portfolio and release funds.
    /// Must be called by portfolio owner.
    public fun clean_expired_portfolio_collection_offers(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection_id: object::ID,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ) {
        offer_portfolio::verify_owner(portfolio, ctx);
        let current_time = clock::timestamp_ms(clock);
        release_expired_portfolio_commitments_for_collection(pool, portfolio, collection_id, current_time);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);
    }

    /// Permissionless recovery path for expired collection-offer commitments.
    public fun recover_expired_portfolio_collection_offers(
        pool: &mut OfferPool,
        portfolio: &mut OfferPortfolio,
        collection_id: object::ID,
        clock: &Clock,
    ) {
        let current_time = clock::timestamp_ms(clock);
        release_expired_portfolio_commitments_for_collection(pool, portfolio, collection_id, current_time);
        prune_terminal_offers(pool, TERMINAL_OFFERS_PRUNE_BATCH);
    }

    // ========== Claim Recovery Functions ==========

    /// Recover a stuck claim ticket after 30 days
    /// Called by the original seller when the buyer has not claimed the NFT
    /// Does NOT require the PersonalKioskClaimTicket object — uses ticket_id from events
    public fun recover_stuck_claim<T: key + store>(
        pool: &mut OfferPool,
        ticket_id: object::ID,
        seller_kiosk: &mut Kiosk,
        seller_kiosk_cap: &KioskOwnerCap,
        clock: &Clock,
        ctx: &mut tx_context::TxContext,
    ): option::Option<coin::Coin<SUI>> {
        // 1. Verify claim metadata exists
        let meta_key = ClaimTicketMetaKey { ticket_id };
        assert!(df::exists_(&pool.id, meta_key), EClaimMetaNotFound);

        // 2. Read metadata to verify seller and timing
        let meta: &ClaimTicketMeta = df::borrow(&pool.id, meta_key);
        let caller = ctx.sender();
        assert!(meta.seller == caller, ENotClaimSeller);

        let current_time = clock::timestamp_ms(clock);
        assert!(current_time >= meta.recovery_unlocks_at, EClaimRecoveryPeriodNotPassed);

        // Cache values before removing meta
        let nft_id = meta.nft_id;
        let seller = meta.seller;

        // 3. Verify type matches
        let actual_type = transfer_policy_utils::get_type_name<T>();
        assert!(meta.nft_type == actual_type, ETypeMismatch);

        // 4. Remove claim metadata
        let ClaimTicketMeta {
            seller: _, buyer: _, nft_type: _, nft_id: _,
            collection_id: _, created_at: _, recovery_unlocks_at: _,
        } = df::remove(&mut pool.id, meta_key);

        // 5. Retrieve NFT from temporary storage
        let storage_key = TemporaryStorageKey { ticket_id };
        let TemporaryNftStorage<T> { nft, ticket_id: _ } = df::remove(
            &mut pool.id,
            storage_key
        );

        // 6. Return NFT to seller kiosk
        kiosk::place(seller_kiosk, seller_kiosk_cap, nft);

        // 6.5. [H-01 FIX] Refund escrowed payment to buyer
        let payment_key = PaymentStorageKey { ticket_id };
        if (df::exists_(&pool.id, payment_key)) {
            let TemporaryPaymentStorage { payment_balance, ticket_id: _, buyer: payment_buyer } =
                df::remove(&mut pool.id, payment_key);
            let refund_coin = coin::from_balance(payment_balance, ctx);
            transfer::public_transfer(refund_coin, payment_buyer);
        };

        // 6.6. Refund marketplace fee to seller (who fronted it)
        let marketplace_fee_key = MarketplaceFeeStorageKey { ticket_id };
        if (df::exists_(&pool.id, marketplace_fee_key)) {
            let TemporaryMarketplaceFeeStorage { fee_balance, ticket_id: _ } =
                df::remove(&mut pool.id, marketplace_fee_key);
            let marketplace_fee_coin = coin::from_balance(fee_balance, ctx);
            transfer::public_transfer(marketplace_fee_coin, seller);
        };

        // 7. Clean up royalty storage if it exists
        let royalty_key = RoyaltyStorageKey { ticket_id };
        let royalty_refunded;
        let royalty_refund = if (df::exists_(&pool.id, royalty_key)) {
            let TemporaryRoyaltyStorage { royalty_balance, ticket_id: _ } =
                df::remove(&mut pool.id, royalty_key);
            let royalty_coin = coin::from_balance(royalty_balance, ctx);
            royalty_refunded = true;
            option::some(royalty_coin)
        } else {
            royalty_refunded = false;
            option::none()
        };

        // 8. Emit recovery event
        events::emit_claim_recovered_event(
            ticket_id,
            seller,
            nft_id,
            caller,
            royalty_refunded,
        );

        royalty_refund
    }

    /// Check if a claim ticket is recoverable (metadata exists and 30 days passed)
    public fun is_claim_recoverable(
        pool: &OfferPool,
        ticket_id: object::ID,
        clock: &Clock,
    ): bool {
        let meta_key = ClaimTicketMetaKey { ticket_id };
        if (!df::exists_(&pool.id, meta_key)) {
            return false
        };
        let meta: &ClaimTicketMeta = df::borrow(&pool.id, meta_key);
        clock::timestamp_ms(clock) >= meta.recovery_unlocks_at
    }

    /// Get the unlock timestamp for claim recovery
    public fun get_claim_recovery_unlock_time(
        pool: &OfferPool,
        ticket_id: object::ID,
    ): u64 {
        let meta_key = ClaimTicketMetaKey { ticket_id };
        assert!(df::exists_(&pool.id, meta_key), EClaimMetaNotFound);
        let meta: &ClaimTicketMeta = df::borrow(&pool.id, meta_key);
        meta.recovery_unlocks_at
    }
}
