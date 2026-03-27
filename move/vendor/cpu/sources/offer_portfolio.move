// Copyright (c) CPU Marketplace
// SPDX-License-Identifier: Apache-2.0

/// Portfolio system for managing multiple offers with shared balance
/// Enables capital-efficient bidding where one balance pool can fund multiple offers
module cpu::offer_portfolio {
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::table::{Self, Table};
    use std::string::String;

    // ========== Error Codes ==========

    #[error]
    const EInsufficientBalance: vector<u8> =
        b"Insufficient available balance in portfolio.";

    #[error]
    const ENotPortfolioOwner: vector<u8> =
        b"Only the portfolio owner can perform this action.";

    #[error]
    const EOfferNotInPortfolio: vector<u8> =
        b"Offer is not tracked in this portfolio.";

    #[error]
    const EOfferAlreadyCommitted: vector<u8> =
        b"Offer is already committed in this portfolio.";

    // ========== Data Structures ==========

    /// Portfolio for managing multiple offers with shared balance pool
    /// Enables capital-efficient bidding strategy
    public struct OfferPortfolio has key {
        id: UID,
        /// Owner of the portfolio
        owner: address,
        /// Portfolio name (e.g., "Blue Chip Strategy", "Floor Sweep")
        name: String,
        /// Shared balance pool for all offers
        balance: Balance<SUI>,
        /// Map from offer ID to committed amount
        active_offers: Table<ID, u64>,
        /// Total amount committed to active offers
        total_committed: u64,
    }

    // ========== Portfolio Management ==========

    /// Create new portfolio with initial balance
    public fun create_portfolio(
        name: String,
        initial_funds: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        let portfolio = OfferPortfolio {
            id: object::new(ctx),
            owner: ctx.sender(),
            name,
            balance: initial_funds.into_balance(),
            active_offers: table::new(ctx),
            total_committed: 0,
        };

        transfer::share_object(portfolio);
    }

    /// Add funds to portfolio
    public fun deposit(
        portfolio: &mut OfferPortfolio,
        funds: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(portfolio.owner == ctx.sender(), ENotPortfolioOwner);
        coin::put(&mut portfolio.balance, funds);
    }

    /// Withdraw available balance (not committed to offers)
    public fun withdraw(
        portfolio: &mut OfferPortfolio,
        amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(portfolio.owner == ctx.sender(), ENotPortfolioOwner);

        let total_balance = portfolio.balance.value();
        let available = total_balance - portfolio.total_committed;
        assert!(amount <= available, EInsufficientBalance);

        let withdrawn = coin::from_balance(
            portfolio.balance.split(amount),
            ctx
        );
        transfer::public_transfer(withdrawn, portfolio.owner);
    }

    /// Update portfolio name
    public fun update_name(
        portfolio: &mut OfferPortfolio,
        new_name: String,
        ctx: &mut TxContext,
    ) {
        assert!(portfolio.owner == ctx.sender(), ENotPortfolioOwner);
        portfolio.name = new_name;
    }

    // ========== Package-only Functions (called by marketplace_offer) ==========

    /// Commit funds for an offer (called when offer is created)
    public(package) fun commit_offer(
        portfolio: &mut OfferPortfolio,
        offer_id: ID,
        amount: u64,
    ) {
        // Check if offer is already committed
        assert!(!portfolio.active_offers.contains(offer_id), EOfferAlreadyCommitted);

        // Check available balance
        let total_balance = portfolio.balance.value();
        let available = total_balance - portfolio.total_committed;
        assert!(amount <= available, EInsufficientBalance);

        // Commit the offer
        portfolio.active_offers.add(offer_id, amount);
        portfolio.total_committed = portfolio.total_committed + amount;
    }

    /// Extract cleanup bounty from portfolio balance
    /// Used when creating offers with cleanup bounty mechanism
    public(package) fun extract_bounty(
        portfolio: &mut OfferPortfolio,
        amount: u64,
    ): Balance<SUI> {
        // Check available balance
        let total_balance = portfolio.balance.value();
        let available = total_balance - portfolio.total_committed;
        assert!(amount <= available, EInsufficientBalance);

        // Extract bounty from available balance
        portfolio.balance.split(amount)
    }

    /// Return cleanup bounty to portfolio balance
    /// Used when canceling offers or when offers are accepted
    public(package) fun return_bounty(
        portfolio: &mut OfferPortfolio,
        bounty: Balance<SUI>,
    ) {
        balance::join(&mut portfolio.balance, bounty);
    }

    /// Release committed funds and withdraw for accepted/cancelled offer
    /// Returns the balance to be used for payment
    public(package) fun release_offer(
        portfolio: &mut OfferPortfolio,
        offer_id: ID,
    ): Balance<SUI> {
        assert!(portfolio.active_offers.contains(offer_id), EOfferNotInPortfolio);

        // Get committed amount
        let amount = portfolio.active_offers.remove(offer_id);

        // Update total committed
        portfolio.total_committed = portfolio.total_committed - amount;

        // Extract balance from portfolio
        portfolio.balance.split(amount)
    }

    /// Refund committed funds for cancelled/expired offer (no withdrawal)
    /// Simply releases the commitment without extracting balance
    public(package) fun refund_offer(
        portfolio: &mut OfferPortfolio,
        offer_id: ID,
    ) {
        assert!(portfolio.active_offers.contains(offer_id), EOfferNotInPortfolio);

        // Get committed amount
        let amount = portfolio.active_offers.remove(offer_id);

        // Update total committed (balance stays in portfolio)
        portfolio.total_committed = portfolio.total_committed - amount;
    }

    /// Update commitment amount for an existing offer
    /// Used when offer amount is increased via update_offer
    public(package) fun update_commitment(
        portfolio: &mut OfferPortfolio,
        offer_id: ID,
        new_amount: u64,
    ) {
        assert!(portfolio.active_offers.contains(offer_id), EOfferNotInPortfolio);

        // Get current committed amount
        let old_amount = portfolio.active_offers[offer_id];

        // Calculate difference (new_amount should be > old_amount)
        assert!(new_amount > old_amount, EInsufficientBalance);
        let difference = new_amount - old_amount;

        // Check if we have enough available balance for the increase
        let total_balance = portfolio.balance.value();
        let available = total_balance - portfolio.total_committed;
        assert!(difference <= available, EInsufficientBalance);

        // Update the commitment
        *portfolio.active_offers.borrow_mut(offer_id) = new_amount;
        portfolio.total_committed = portfolio.total_committed + difference;
    }

    /// Check if portfolio has sufficient available balance for new offer
    public(package) fun has_available_balance(
        portfolio: &OfferPortfolio,
        amount: u64,
    ): bool {
        let total_balance = portfolio.balance.value();
        let available = total_balance - portfolio.total_committed;
        amount <= available
    }

    /// Verify caller is portfolio owner
    public(package) fun verify_owner(
        portfolio: &OfferPortfolio,
        ctx: &TxContext,
    ) {
        assert!(portfolio.owner == ctx.sender(), ENotPortfolioOwner);
    }

    // ========== Query Functions ==========

    /// Get portfolio ID
    public fun get_id(portfolio: &OfferPortfolio): ID {
        object::uid_to_inner(&portfolio.id)
    }

    /// Get portfolio owner
    public fun get_owner(portfolio: &OfferPortfolio): address {
        portfolio.owner
    }

    /// Get portfolio name
    public fun get_name(portfolio: &OfferPortfolio): String {
        portfolio.name
    }

    /// Get portfolio stats: (total_balance, committed, available, num_active_offers)
    public fun get_stats(portfolio: &OfferPortfolio): (u64, u64, u64, u64) {
        let total = portfolio.balance.value();
        let committed = portfolio.total_committed;
        let available = total - committed;
        let num_offers = portfolio.active_offers.length();
        (total, committed, available, num_offers)
    }

    /// Check if offer is committed in portfolio
    public fun is_offer_committed(
        portfolio: &OfferPortfolio,
        offer_id: ID,
    ): bool {
        portfolio.active_offers.contains(offer_id)
    }

    /// Get committed amount for specific offer
    public fun get_committed_amount(
        portfolio: &OfferPortfolio,
        offer_id: ID,
    ): u64 {
        if (portfolio.active_offers.contains(offer_id)) {
            portfolio.active_offers[offer_id]
        } else {
            0
        }
    }
}
