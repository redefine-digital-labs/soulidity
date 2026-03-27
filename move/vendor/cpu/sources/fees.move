// Copyright (c) Blockus
// Author: Tirso J. Bello Ponce (tirso@blockus.gg)

module cpu::fees {
    use sui::transfer_policy::TransferPolicy;
    use cpu::transfer_policy_utils;

    /// An object to store the fee structure to be apply on every
    /// sale inside the marketplace.
    /// This object is intended to be used inside `CpuMarketplace`
    /// declared in `cpu::core`
    ///
    /// The `base_fee_percentage` is the percentage
    /// of the transfer amount to be paid as a platform fee.
    ///
    /// The `min_fee_amount` is the minimum amount to be paid if the percentage based fee is
    /// lower than the `min_fee_amount` setting. Useful to enforce a fixed fee even if
    /// the transfer amount is very small or 0.
    public struct CpuMarketplaceFeeStructure has store, drop {
        base_fee_percentage: u64,
        min_fee_amount: u64,
    }

    /// Detailed fee breakdown for display and analytics
    public struct FeeBreakdown has copy, drop {
        price: u64,
        marketplace_fee: u64,
        royalty_fee: u64,
        total_fees: u64,
        seller_proceeds: u64,
    }

    // ========== Method Aliases (Move 2024) ==========
    // Note: CpuMarketplaceFeeStructure methods are auto-aliased (first param is same module type)
    // Method aliases for FeeBreakdown accessor functions
    public use fun breakdown_price as FeeBreakdown.price;
    public use fun breakdown_marketplace_fee as FeeBreakdown.marketplace_fee;
    public use fun breakdown_royalty_fee as FeeBreakdown.royalty_fee;
    public use fun breakdown_total_fees as FeeBreakdown.total_fees;
    public use fun breakdown_seller_proceeds as FeeBreakdown.seller_proceeds;

    #[error]
    const EInvalidBaseFeePercentage: vector<u8> = b"Base fee percentage must be <= 100_000_000 (10%).";

    #[error]
    const EInvalidMinFeeAmount: vector<u8> = b"Minimum fee amount must be <= 10_000_000_000 (10 SUI).";

    /// Upper bound for minimum fee amount (10 SUI)
    const MAX_MIN_FEE_AMOUNT: u64 = 10_000_000_000;

    /// Creates a new FeeStructure with the provided `base_fee`
    /// [L-01 FIX] Capped at 10% (was 100%) to prevent admin overreach
    public(package) fun new(
        base_fee_percentage: u64,
        min_fee_amount: u64,
    ): CpuMarketplaceFeeStructure {
        assert!(base_fee_percentage <= 100_000_000, EInvalidBaseFeePercentage);
        assert!(min_fee_amount <= MAX_MIN_FEE_AMOUNT, EInvalidMinFeeAmount);
        let fee_structure = CpuMarketplaceFeeStructure {
            base_fee_percentage,
            min_fee_amount
        };

        (fee_structure)
    }

    /// Given a price, the `fee` to apply is returned
    public(package) fun calculate_fee(
        price: u64,
        fee_structure: &CpuMarketplaceFeeStructure,
    ): (u64) {
        let base_fee_percentage = fee_structure.base_fee_percentage;
        let min_fee_amount = fee_structure.min_fee_amount;
        // Use scaled multiplication decomposition to avoid u64 overflow:
        // (price * base_fee_percentage) / 1e9 == (price/1e9)*bfp + ((price%1e9)*bfp)/1e9
        let denom = 1_000_000_000;
        let q = price / denom;
        let r = price % denom;
        let mut amount = q * base_fee_percentage + (r * base_fee_percentage) / denom;

        // If the amount is less than the minimum, use the minimum
        if (amount < min_fee_amount) {
            amount = min_fee_amount;
        };

        (amount)
    }

    public(package) fun base_fee_percentage(
        fee_structure: &CpuMarketplaceFeeStructure,
    ): u64 {
        (fee_structure.base_fee_percentage)
    }

    public(package) fun min_fee_amount(
        fee_structure: &CpuMarketplaceFeeStructure,
    ): u64 {
        (fee_structure.min_fee_amount)
    }

    /// Calculate marketplace + royalty fees (centralized calculation)
    public(package) fun calculate_total_fees<T: key + store>(
        price: u64,
        fee_structure: &CpuMarketplaceFeeStructure,
        policy: &TransferPolicy<T>,
    ): (u64, u64, u64) {
        let marketplace_fee = calculate_fee(price, fee_structure);
        let royalty_fee = transfer_policy_utils::calculate_royalty<T>(policy, price);
        let total = marketplace_fee + royalty_fee;

        (marketplace_fee, royalty_fee, total)
    }

    /// Validate fee payment covers all required fees
    public(package) fun validate_fee_payment<T: key + store>(
        price: u64,
        fee_payment_amount: u64,
        fee_structure: &CpuMarketplaceFeeStructure,
        policy: &TransferPolicy<T>,
    ): bool {
        let (_marketplace_fee, _royalty_fee, total) = calculate_total_fees(
            price,
            fee_structure,
            policy
        );
        fee_payment_amount >= total
    }

    /// Calculate fees with edge case handling (safe version)
    public(package) fun calculate_fee_safe(
        price: u64,
        fee_structure: &CpuMarketplaceFeeStructure,
    ): u64 {
        // Handle edge case: zero price with min fee
        if (price == 0) {
            return fee_structure.min_fee_amount
        };

        let base_fee_percentage = fee_structure.base_fee_percentage;
        let min_fee_amount = fee_structure.min_fee_amount;
        let denom = 1_000_000_000;
        // Scaled multiplication decomposition to avoid overflow
        let q = price / denom;
        let r = price % denom;
        let mut amount = q * base_fee_percentage + (r * base_fee_percentage) / denom;

        // Apply minimum fee
        if (amount < min_fee_amount) {
            amount = min_fee_amount;
        };

        amount
    }

    /// Get fee breakdown for display/analytics
    #[error]
    const EInsufficientPrice: vector<u8> = b"Price is less than total fees";

    public(package) fun get_fee_breakdown<T: key + store>(
        price: u64,
        fee_structure: &CpuMarketplaceFeeStructure,
        policy: &TransferPolicy<T>,
    ): FeeBreakdown {
        let marketplace_fee = calculate_fee_safe(price, fee_structure);
        let royalty_fee = transfer_policy_utils::calculate_royalty<T>(policy, price);
        let total_fees = marketplace_fee + royalty_fee;

        // Guard against underflow on seller_proceeds
        assert!(price >= total_fees, EInsufficientPrice);

        FeeBreakdown {
            price,
            marketplace_fee,
            royalty_fee,
            total_fees,
            seller_proceeds: price - total_fees,
        }
    }

    /// Calculate marketplace fee only (alias for clarity)
    public(package) fun calculate_marketplace_fee(
        price: u64,
        fee_structure: &CpuMarketplaceFeeStructure,
    ): u64 {
        calculate_fee(price, fee_structure)
    }

    /// Accessor functions for FeeBreakdown
    public fun breakdown_price(breakdown: &FeeBreakdown): u64 {
        breakdown.price
    }

    public fun breakdown_marketplace_fee(breakdown: &FeeBreakdown): u64 {
        breakdown.marketplace_fee
    }

    public fun breakdown_royalty_fee(breakdown: &FeeBreakdown): u64 {
        breakdown.royalty_fee
    }

    public fun breakdown_total_fees(breakdown: &FeeBreakdown): u64 {
        breakdown.total_fees
    }

    public fun breakdown_seller_proceeds(breakdown: &FeeBreakdown): u64 {
        breakdown.seller_proceeds
    }

    #[test_only]
    public fun new_for_testing(base_fee_percentage: u64, _ctx: &mut TxContext): CpuMarketplaceFeeStructure {
        new(base_fee_percentage, 0)
    }
}
