// Copyright (c) CPU Marketplace
// SPDX-License-Identifier: Apache-2.0

/// Utility module for TransferPolicy operations
/// Provides helper functions to work with Sui's TransferPolicy and various rules
module cpu::transfer_policy_utils {
    use sui::transfer_policy::{Self as policy, TransferPolicy};
    use std::type_name::{Self, TypeName};
    use std::ascii::{String};
    use sui::vec_set;
    use kiosk::royalty_rule;
    use kiosk::floor_price_rule;
    use kiosk::kiosk_lock_rule;
    use kiosk::personal_kiosk_rule;

    // ========== Error Codes ==========

    #[error]
    const ECannotBypassFloorPrice: vector<u8> =
        b"Cannot bypass floor price rule with zero-price offer.";

    // ========== Policy Rule Detection ==========

    /// Check if policy has royalty rule
    public fun has_royalty_rule<T: key + store>(policy: &TransferPolicy<T>): bool {
        policy::has_rule<T, royalty_rule::Rule>(policy)
    }

    /// Check if policy has floor price rule
    public fun has_floor_price_rule<T: key + store>(policy: &TransferPolicy<T>): bool {
        policy::has_rule<T, floor_price_rule::Rule>(policy)
    }

    /// Check if policy has kiosk lock rule
    public fun has_kiosk_lock_rule<T: key + store>(policy: &TransferPolicy<T>): bool {
        policy::has_rule<T, kiosk_lock_rule::Rule>(policy)
    }

    /// Check if policy has personal kiosk rule
    ///
    /// IMPORTANT LIMITATION: personal_kiosk_rule is NOT supported in marketplace
    /// offer acceptance flows. This is because PersonalKioskCap lacks the `store`
    /// ability and can only be transferred using personal_kiosk::transfer_to_sender(),
    /// which transfers to the transaction sender (seller) rather than the buyer.
    ///
    /// In seller-initiated offer acceptance, the marketplace cannot properly transfer
    /// PersonalKioskCap to the buyer. Offers for items with personal_kiosk_rule will
    /// fail at transfer policy validation.
    ///
    /// For personal kiosk requirements, use buyer-initiated claim flows instead.
    public fun has_personal_kiosk_rule<T: key + store>(policy: &TransferPolicy<T>): bool {
        policy::has_rule<T, personal_kiosk_rule::Rule>(policy)
    }

    // ========== Royalty Calculation ==========

    /// Calculate royalty amount based on transfer policy
    /// Returns 0 if no royalty rule exists
    public fun calculate_royalty<T: key + store>(
        policy: &TransferPolicy<T>,
        paid_amount: u64,
    ): u64 {
        if (has_royalty_rule(policy)) {
            royalty_rule::fee_amount(policy, paid_amount)
        } else {
            0
        }
    }

    /// Calculate total payment required (offer amount + royalty)
    /// Does not include marketplace fees
    public fun calculate_total_with_royalty<T: key + store>(
        policy: &TransferPolicy<T>,
        offer_amount: u64,
    ): u64 {
        let royalty = calculate_royalty(policy, offer_amount);
        offer_amount + royalty
    }

    // ========== Floor Price Validation ==========

    /// NOTE: Floor price validation cannot be performed at offer creation time
    /// because the Kiosk floor_price_rule module does not expose a getter for the
    /// floor price value. The actual floor price check happens during transfer
    /// confirmation via floor_price_rule::prove().
    ///
    /// This function only checks if a floor price rule exists.
    /// Use this to warn users that their offer may fail if below the floor price.
    public fun validate_floor_price_exists<T: key + store>(
        policy: &TransferPolicy<T>,
    ) {
        // This is a marker function for UIs to know that floor price exists
        // Actual validation happens in floor_price_rule::prove() during transfer
        assert!(has_floor_price_rule(policy), 0);
    }

    /// Check if zero-price offer is allowed
    /// Zero-price offers are not allowed if floor price rule exists
    public fun can_offer_zero_price<T: key + store>(policy: &TransferPolicy<T>): bool {
        !has_floor_price_rule(policy)
    }

    /// Validate zero-price offer against floor price rule
    /// Aborts if floor price rule exists
    public fun validate_zero_price_offer<T: key + store>(policy: &TransferPolicy<T>) {
        assert!(!has_floor_price_rule(policy), ECannotBypassFloorPrice);
    }

    // ========== Type Name Utilities ==========

    /// Get type name as String for policy registry
    /// String has copy + drop + store, making it suitable for Table keys
    #[allow(deprecated_usage)]
    public fun get_type_name<T>(): String {
        let type_name: TypeName = type_name::with_defining_ids<T>();
        type_name::into_string(type_name)
    }

    /// Get type name from policy
    public fun get_policy_type_name<T: key + store>(_policy: &TransferPolicy<T>): String {
        get_type_name<T>()
    }

    // ========== Policy Requirement Summary ==========

    /// Get a summary of policy requirements for a given type
    /// Returns (has_royalty, has_floor_price, has_kiosk_lock, has_personal_kiosk)
    public fun get_policy_requirements<T: key + store>(
        policy: &TransferPolicy<T>
    ): (bool, bool, bool, bool) {
        (
            has_royalty_rule(policy),
            has_floor_price_rule(policy),
            has_kiosk_lock_rule(policy),
            has_personal_kiosk_rule(policy),
        )
    }

    /// Check if policy has any rules
    public fun has_any_rules<T: key + store>(policy: &TransferPolicy<T>): bool {
        policy_rule_count(policy) > 0
    }

    /// Return the total number of rules attached to a transfer policy.
    /// This includes custom rules beyond the four known kiosk rules.
    public fun policy_rule_count<T: key + store>(policy: &TransferPolicy<T>): u64 {
        vec_set::length(policy::rules(policy))
    }

    // ========== Payment Calculation Helpers ==========

    /// Calculate the minimum payment required for an offer
    /// Returns offer_amount + royalty
    /// Frontend should add marketplace fees on top of this
    public fun calculate_minimum_offer_payment<T: key + store>(
        policy: &TransferPolicy<T>,
        offer_amount: u64,
    ): u64 {
        calculate_total_with_royalty(policy, offer_amount)
    }

    /// Validate that fee_payment is sufficient to cover royalty
    /// Used in accept_offer functions
    public fun validate_fee_payment<T: key + store>(
        policy: &TransferPolicy<T>,
        offer_amount: u64,
        fee_payment_amount: u64,
        marketplace_fee: u64,
    ): bool {
        let royalty = calculate_royalty(policy, offer_amount);
        let required_fee = royalty + marketplace_fee;
        fee_payment_amount >= required_fee
    }

    // ========== Test-only Functions ==========

    #[test_only]
    public fun test_calculate_royalty<T: key + store>(
        policy: &TransferPolicy<T>,
        amount: u64,
    ): u64 {
        calculate_royalty(policy, amount)
    }

    #[test_only]
    public fun test_has_royalty_rule<T: key + store>(policy: &TransferPolicy<T>): bool {
        has_royalty_rule(policy)
    }

    #[test_only]
    public fun test_has_floor_price_rule<T: key + store>(policy: &TransferPolicy<T>): bool {
        has_floor_price_rule(policy)
    }
}
