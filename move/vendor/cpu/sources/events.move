// Copyright (c) Blockus
// Author: Tirso J. Bello Ponce (tirso@blockus.gg)

module cpu::events {
    use sui::event;
    use unft_standard::unft_standard::NftCollection;

    public struct ItemListed<phantom CpuMarketplace, phantom T> has copy, drop {
        kiosk_id: object::ID,
        item_id: object::ID,
        listing_price: u64,
        seller: address,
        collection_id: object::ID,
    }

    public struct ItemDelisted<phantom CpuMarketplace, phantom T> has copy, drop {
        kiosk_id: object::ID,
        item_id: object::ID,
        seller: address,
        collection_id: object::ID,
    }

    public struct ItemPurchasedFixedPrice<phantom CpuMarketplace, phantom T> has copy, drop {
        kiosk_id: object::ID,
        item_id: object::ID,
        seller: address,
        buyer: address,
        paid: u64,
        collection_id: object::ID,
    }

    public struct ItemRelisted<phantom CpuMarketplace, phantom T> has copy, drop {
        kiosk_id: object::ID,
        item_id: object::ID,
        old_price: u64,
        new_price: u64,
        seller: address,
        collection_id: object::ID,
    }

    public struct TreasuryProfitsWithdrawn has copy, drop {
        amount: u64,
        owner: address,
    }

    // Offer events migrated from marketplace_offer module
    /// Event emitted when a new offer is made
    public struct OfferMadeEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        offerer: address,
        item_id: object::ID,
        amount: u64,
        expire_time: u64,
        collection_id: object::ID,
    }

    /// Event emitted when an offer is accepted (unified for both regular and portfolio offers)
    public struct OfferAcceptedEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        seller: address,
        item_id: object::ID,
        amount: u64,
        collection_id: object::ID,
        portfolio_id: option::Option<object::ID>,  // None for regular offers, Some for portfolio offers
    }

    /// Event emitted when an offer is cancelled
    public struct OfferCancelledEvent has copy, drop {
        offer_id: object::ID,
        offerer: address,
        refund_amount: u64,
        collection_id: object::ID,
    }

    /// Event emitted when an offer expires
    public struct OfferExpiredEvent has copy, drop {
        offer_id: object::ID,
        offerer: address,
        item_id: object::ID,
        collection_id: object::ID,
    }

    /// Event emitted when an offer is updated
    public struct OfferUpdatedEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        offerer: address,
        item_id: object::ID,
        old_amount: u64,
        new_amount: u64,
        collection_id: object::ID,
    }

    /// Event emitted when a collection-level offer is made
    public struct CollectionOfferMadeEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        offerer: address,
        amount: u64,
        expire_time: u64,
        collection_id: object::ID,
    }

    /// Event emitted when a collection offer is accepted (unified for both regular and portfolio offers)
    public struct CollectionOfferAcceptedEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        seller: address,
        item_id: object::ID,
        amount: u64,
        collection_id: object::ID,
        portfolio_id: option::Option<object::ID>,  // None for regular offers, Some for portfolio offers
    }

    public(package) fun emit_item_listed_event<CpuMarketplace, T>(
        collection: &NftCollection<T>,
        kiosk_id: object::ID,
        seller: address,
        listing_price: u64,
        item_id: object::ID,
    ) {
        let collection_id = object::id(collection);
        event::emit(ItemListed<CpuMarketplace, T> {
            kiosk_id,
            item_id,
            listing_price,
            seller,
            collection_id,
        });
    }

    public(package) fun emit_item_delisted_event<CpuMarketplace, T>(
        collection: &NftCollection<T>,
        kiosk_id: object::ID,
        seller: address,
        item_id: object::ID,
    ) {
        let collection_id = object::id(collection);
        event::emit(ItemDelisted<CpuMarketplace, T> {
            kiosk_id,
            item_id,
            seller,
            collection_id,
        });
    }

    public(package) fun emit_item_purchased_fixed_price_event<CpuMarketplace, T>(
        collection: &NftCollection<T>,
        kiosk_id: object::ID,
        item_id: object::ID,
        seller: address,
        buyer: address,
        paid: u64,
    ) {
        let collection_id = object::id(collection);
        event::emit(ItemPurchasedFixedPrice<CpuMarketplace, T> {
            kiosk_id,
            item_id,
            seller,
            buyer,
            paid,
            collection_id,
        });
    }

    public(package) fun emit_item_relisted_event<CpuMarketplace, T>(
        collection: &NftCollection<T>,
        kiosk_id: object::ID,
        seller: address,
        item_id: object::ID,
        old_price: u64,
        new_price: u64,
    ) {
        let collection_id = object::id(collection);
        event::emit(ItemRelisted<CpuMarketplace, T> {
            kiosk_id,
            item_id,
            old_price,
            new_price,
            seller,
            collection_id,
        });
    }

    public(package) fun emit_profits_withdrawn_event(
        amount: u64,
        owner: address,
    ) {
        event::emit(TreasuryProfitsWithdrawn {
            amount,
            owner,
        });
    }

    // Offer event emission functions
    public(package) fun emit_offer_made_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        offerer: address,
        item_id: object::ID,
        amount: u64,
        expire_time: u64,
    ) {
        let collection_id = object::id(collection);
        event::emit(OfferMadeEvent<T> {
            offer_id,
            offerer,
            item_id,
            amount,
            expire_time,
            collection_id,
        });
    }

    public(package) fun emit_offer_accepted_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        seller: address,
        item_id: object::ID,
        amount: u64,
        portfolio_id: option::Option<object::ID>,
    ) {
        let collection_id = object::id(collection);
        event::emit(OfferAcceptedEvent<T> {
            offer_id,
            seller,
            item_id,
            amount,
            collection_id,
            portfolio_id,
        });
    }

    public(package) fun emit_offer_cancelled_event(
        offer_id: object::ID,
        offerer: address,
        refund_amount: u64,
        collection_id: object::ID,
    ) {
        event::emit(OfferCancelledEvent {
            offer_id,
            offerer,
            refund_amount,
            collection_id,
        });
    }

    public(package) fun emit_offer_expired_event(
        offer_id: object::ID,
        offerer: address,
        item_id: object::ID,
        collection_id: object::ID,
    ) {
        event::emit(OfferExpiredEvent {
            offer_id,
            offerer,
            item_id,
            collection_id,
        });
    }

    public(package) fun emit_offer_updated_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        offerer: address,
        item_id: object::ID,
        old_amount: u64,
        new_amount: u64,
    ) {
        let collection_id = object::id(collection);
        event::emit(OfferUpdatedEvent<T> {
            offer_id,
            offerer,
            item_id,
            old_amount,
            new_amount,
            collection_id,
        });
    }

    public(package) fun emit_collection_offer_made_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        offerer: address,
        amount: u64,
        expire_time: u64,
    ) {
        let collection_id = object::id(collection);
        event::emit(CollectionOfferMadeEvent<T> {
            offer_id,
            offerer,
            amount,
            expire_time,
            collection_id,
        });
    }

    public(package) fun emit_collection_offer_accepted_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        seller: address,
        item_id: object::ID,
        amount: u64,
        portfolio_id: option::Option<object::ID>,
    ) {
        let collection_id = object::id(collection);
        event::emit(CollectionOfferAcceptedEvent<T> {
            offer_id,
            seller,
            item_id,
            amount,
            collection_id,
            portfolio_id,
        });
    }

    // Cleanup events
    /// Event emitted when a third party cleans an expired offer and claims bounty
    public struct OfferCleanedByThirdPartyEvent has copy, drop {
        offer_id: object::ID,
        cleaner: address,
        offerer: address,
        bounty_earned: u64,
        escrow_refunded: u64,
        collection_id: object::ID,
    }

    /// Event emitted when an offerer self-cleans their expired offer
    public struct OfferSelfCleanedEvent has copy, drop {
        offer_id: object::ID,
        offerer: address,
        total_refund: u64,
        collection_id: object::ID,
    }

    public(package) fun emit_offer_cleaned_by_third_party_event(
        offer_id: object::ID,
        cleaner: address,
        offerer: address,
        bounty_earned: u64,
        escrow_refunded: u64,
        collection_id: object::ID,
    ) {
        event::emit(OfferCleanedByThirdPartyEvent {
            offer_id,
            cleaner,
            offerer,
            bounty_earned,
            escrow_refunded,
            collection_id,
        });
    }

    public(package) fun emit_offer_self_cleaned_event(
        offer_id: object::ID,
        offerer: address,
        total_refund: u64,
        collection_id: object::ID,
    ) {
        event::emit(OfferSelfCleanedEvent {
            offer_id,
            offerer,
            total_refund,
            collection_id,
        });
    }

    // Portfolio offer events
    /// Event emitted when a portfolio-funded item offer is made
    public struct PortfolioOfferMadeEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        offerer: address,
        item_id: object::ID,
        amount: u64,
        expire_time: u64,
        collection_id: object::ID,
        portfolio_id: object::ID,
    }

    /// Event emitted when a portfolio-funded collection offer is made
    public struct PortfolioCollectionOfferMadeEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        offerer: address,
        amount: u64,
        expire_time: u64,
        collection_id: object::ID,
        portfolio_id: object::ID,
    }

    /// Event emitted when a portfolio offer is accepted
    public struct PortfolioOfferAcceptedEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        seller: address,
        item_id: object::ID,
        amount: u64,
        collection_id: object::ID,
        portfolio_id: object::ID,
    }

    /// Event emitted when a portfolio collection offer is accepted
    public struct PortfolioCollectionOfferAcceptedEvent<phantom T> has copy, drop {
        offer_id: object::ID,
        seller: address,
        item_id: object::ID,
        amount: u64,
        collection_id: object::ID,
        portfolio_id: object::ID,
    }

    /// Event emitted when a portfolio offer is cancelled
    public struct PortfolioOfferCancelledEvent has copy, drop {
        offer_id: object::ID,
        offerer: address,
        refund_amount: u64,
        collection_id: object::ID,
        portfolio_id: object::ID,
    }

    public(package) fun emit_portfolio_offer_made_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        offerer: address,
        item_id: object::ID,
        amount: u64,
        expire_time: u64,
        portfolio_id: object::ID,
    ) {
        let collection_id = object::id(collection);
        event::emit(PortfolioOfferMadeEvent<T> {
            offer_id,
            offerer,
            item_id,
            amount,
            expire_time,
            collection_id,
            portfolio_id,
        });
    }

    public(package) fun emit_portfolio_collection_offer_made_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        offerer: address,
        amount: u64,
        expire_time: u64,
        portfolio_id: object::ID,
    ) {
        let collection_id = object::id(collection);
        event::emit(PortfolioCollectionOfferMadeEvent<T> {
            offer_id,
            offerer,
            amount,
            expire_time,
            collection_id,
            portfolio_id,
        });
    }

    public(package) fun emit_portfolio_offer_accepted_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        seller: address,
        item_id: object::ID,
        amount: u64,
        portfolio_id: object::ID,
    ) {
        let collection_id = object::id(collection);
        event::emit(PortfolioOfferAcceptedEvent<T> {
            offer_id,
            seller,
            item_id,
            amount,
            collection_id,
            portfolio_id,
        });
    }

    public(package) fun emit_portfolio_collection_offer_accepted_event<T>(
        collection: &NftCollection<T>,
        offer_id: object::ID,
        seller: address,
        item_id: object::ID,
        amount: u64,
        portfolio_id: object::ID,
    ) {
        let collection_id = object::id(collection);
        event::emit(PortfolioCollectionOfferAcceptedEvent<T> {
            offer_id,
            seller,
            item_id,
            amount,
            collection_id,
            portfolio_id,
        });
    }

    public(package) fun emit_portfolio_offer_cancelled_event(
        offer_id: object::ID,
        offerer: address,
        refund_amount: u64,
        collection_id: object::ID,
        portfolio_id: object::ID,
    ) {
        event::emit(PortfolioOfferCancelledEvent {
            offer_id,
            offerer,
            refund_amount,
            collection_id,
            portfolio_id,
        });
    }

    // ========== Operational Events ==========

    /// Event emitted when marketplace fees are updated
    public struct FeeUpdatedEvent has copy, drop {
        old_base_fee_percentage: u64,
        new_base_fee_percentage: u64,
        old_min_fee_amount: u64,
        new_min_fee_amount: u64,
        updated_by: address,
        timestamp: u64,
    }

    /// Event emitted when marketplace version is updated
    public struct VersionUpdatedEvent has copy, drop {
        old_version: u8,
        new_version: u8,
        updated_by: address,
        timestamp: u64,
    }

    /// Event emitted when marketplace is paused
    public struct MarketplacePausedEvent has copy, drop {
        paused_by: address,
        reason: std::string::String,
        timestamp: u64,
    }

    /// Event emitted when marketplace is resumed
    public struct MarketplaceResumedEvent has copy, drop {
        resumed_by: address,
        timestamp: u64,
    }

    /// Event emitted when offers are compacted
    public struct OffersCompactedEvent has copy, drop {
        item_id: object::ID,
        collection_id: object::ID,
        cleaned_count: u64,
    }

    public(package) fun emit_fee_updated_event(
        old_base_fee: u64,
        new_base_fee: u64,
        old_min_fee: u64,
        new_min_fee: u64,
        updated_by: address,
        timestamp: u64,
    ) {
        event::emit(FeeUpdatedEvent {
            old_base_fee_percentage: old_base_fee,
            new_base_fee_percentage: new_base_fee,
            old_min_fee_amount: old_min_fee,
            new_min_fee_amount: new_min_fee,
            updated_by,
            timestamp,
        });
    }

    public(package) fun emit_version_updated_event(
        old_version: u8,
        new_version: u8,
        updated_by: address,
        timestamp: u64,
    ) {
        event::emit(VersionUpdatedEvent {
            old_version,
            new_version,
            updated_by,
            timestamp,
        });
    }

    public(package) fun emit_marketplace_paused_event(
        paused_by: address,
        reason: std::string::String,
        timestamp: u64,
    ) {
        event::emit(MarketplacePausedEvent {
            paused_by,
            reason,
            timestamp,
        });
    }

    public(package) fun emit_marketplace_resumed_event(
        resumed_by: address,
        timestamp: u64,
    ) {
        event::emit(MarketplaceResumedEvent {
            resumed_by,
            timestamp,
        });
    }

    public(package) fun emit_offers_compacted_event(
        item_id: object::ID,
        collection_id: object::ID,
        cleaned_count: u64,
    ) {
        event::emit(OffersCompactedEvent {
            item_id,
            collection_id,
            cleaned_count,
        });
    }

    // ========== Claim Ticket Events ==========

    /// Emitted when claim ticket is created (enhanced with policy flags and financial breakdown)
    public struct ClaimTicketCreatedEvent has copy, drop {
        ticket_id: object::ID,
        buyer: address,
        seller: address,
        nft_id: object::ID,
        collection_id: object::ID,
        amount_paid: u64,
        expires_at: u64,
        // Policy rule flags
        has_personal_kiosk_rule: bool,
        has_royalty_rule: bool,
        has_floor_price_rule: bool,
        has_kiosk_lock_rule: bool,
        // Financial breakdown
        marketplace_fee: u64,
        royalty_amount: u64,
    }

    /// Emitted when NFT is claimed
    public struct NftClaimedEvent has copy, drop {
        ticket_id: object::ID,
        buyer: address,
        nft_id: object::ID,
        personal_kiosk_id: object::ID,
    }

    /// Emitted when claim is cancelled (enhanced with additional context)
    public struct ClaimCancelledEvent has copy, drop {
        ticket_id: object::ID,
        seller: address,
        nft_id: object::ID,
        reason: std::ascii::String,  // "expired" or "seller_cancelled"
        // Additional context
        cancelled_by: address,
        was_expired: bool,
        // [H-01 FIX] Track buyer refund amount
        buyer_refund_amount: u64,
    }

    /// [H-01 FIX] Emitted when a claim is refunded due to policy change or expiry
    public struct ClaimRefundedEvent has copy, drop {
        ticket_id: object::ID,
        buyer: address,
        seller: address,
        nft_id: object::ID,
        refund_amount: u64,
        reason: std::ascii::String,  // "policy_changed" or "expired"
    }

    public(package) fun emit_claim_ticket_created_event(
        ticket_id: object::ID,
        buyer: address,
        seller: address,
        nft_id: object::ID,
        collection_id: object::ID,
        amount_paid: u64,
        expires_at: u64,
        has_personal_kiosk_rule: bool,
        has_royalty_rule: bool,
        has_floor_price_rule: bool,
        has_kiosk_lock_rule: bool,
        marketplace_fee: u64,
        royalty_amount: u64,
    ) {
        event::emit(ClaimTicketCreatedEvent {
            ticket_id,
            buyer,
            seller,
            nft_id,
            collection_id,
            amount_paid,
            expires_at,
            has_personal_kiosk_rule,
            has_royalty_rule,
            has_floor_price_rule,
            has_kiosk_lock_rule,
            marketplace_fee,
            royalty_amount,
        });
    }

    public(package) fun emit_nft_claimed_event(
        ticket_id: object::ID,
        buyer: address,
        nft_id: object::ID,
        personal_kiosk_id: object::ID,
    ) {
        event::emit(NftClaimedEvent {
            ticket_id,
            buyer,
            nft_id,
            personal_kiosk_id,
        });
    }

    /// Emitted when a stuck claim is recovered by the seller after 30 days
    public struct ClaimRecoveredEvent has copy, drop {
        ticket_id: object::ID,
        seller: address,
        nft_id: object::ID,
        recovered_by: address,
        royalty_refunded: bool,
    }

    public(package) fun emit_claim_recovered_event(
        ticket_id: object::ID,
        seller: address,
        nft_id: object::ID,
        recovered_by: address,
        royalty_refunded: bool,
    ) {
        event::emit(ClaimRecoveredEvent {
            ticket_id,
            seller,
            nft_id,
            recovered_by,
            royalty_refunded,
        });
    }

    public(package) fun emit_claim_cancelled_event(
        ticket_id: object::ID,
        seller: address,
        nft_id: object::ID,
        reason: std::ascii::String,
        cancelled_by: address,
        was_expired: bool,
        buyer_refund_amount: u64,
    ) {
        event::emit(ClaimCancelledEvent {
            ticket_id,
            seller,
            nft_id,
            reason,
            cancelled_by,
            was_expired,
            buyer_refund_amount,
        });
    }

    public(package) fun emit_claim_refunded_event(
        ticket_id: object::ID,
        buyer: address,
        seller: address,
        nft_id: object::ID,
        refund_amount: u64,
        reason: std::ascii::String,
    ) {
        event::emit(ClaimRefundedEvent {
            ticket_id,
            buyer,
            seller,
            nft_id,
            refund_amount,
            reason,
        });
    }
}
