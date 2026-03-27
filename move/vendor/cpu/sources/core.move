// Copyright (c) Blockus
// Author: Tirso J. Bello Ponce (tirso@blockus.gg)

/// The core module groups all the common functionalities for the marketplace
/// and let build on top of this functionalities different ways for trading like
/// fixed trade, bid, or some custom trading methodology.
module cpu::core {
    use sui::kiosk::{Self, Kiosk, KioskOwnerCap, PurchaseCap};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::transfer_policy::{TransferRequest, TransferPolicy};
    use sui::clock::{Self, Clock};
    use kiosk::royalty_rule;
    use cpu::transfer_policy_utils;
    use std::string::String;

    #[error]
    const ECpuMarketplaceVersionMismatch: vector<u8> = 
        b"The provided CpuMarketplace version mismatch with the deployed version.";

    const VERSION: u8 = 1;

    #[error]
    const EExtensionNotInstalled: vector<u8> =
        b"Cpu Kiosk Extension is not installed.";

    #[error]
    const EExtensionDisabled: vector<u8> =
        b"Cpu Kiosk Extension is disabled.";

    #[error]
    const ENotListed: vector<u8> =
        b"Item is not listed for sale on this kiosk.";

    #[error]
    const EMarketplaceAlreadyPaused: vector<u8> =
        b"Marketplace is already paused.";

    #[error]
    const EMarketplaceNotPaused: vector<u8> =
        b"Marketplace is not paused.";

    #[error]
    const EMarketplacePaused: vector<u8> =
        b"Marketplace is currently paused.";

    #[error]
    const EOwnerCapMismatch: vector<u8> =
        b"OwnerCap does not belong to this Marketplace instance.";

    #[error]
    const EVersionMustIncrease: vector<u8> =
        b"New marketplace version must be greater than current version.";

    #[error]
    const EVersionMustMatchDeployed: vector<u8> =
        b"New marketplace version must match the deployed module version.";

    #[error]
    const ETotalPriceOverflow: vector<u8> =
        b"Listing price and fee overflowed u64.";

    // ========== One-Time Witness ==========

    /// One-Time Witness for marketplace initialization
    /// Ensures init function can only be called once during package publish
    /// Name must match module name in uppercase: core -> CORE
    public struct CORE has drop {}

    // ========== Data Structures ==========

    /// An object to wrap the `PurchaseCap` from `Kiosk` module to perform exclusive trading inside the marketplace.
    public struct CpuPurchaseCap<phantom MarketType, phantom T: key + store> has store {
        purchase_cap: PurchaseCap<T>
    }

    /// An object to represent a listing inside the marketplace.
    public struct CpuListing<phantom MarketType, phantom T: key + store> has store {
        cpu_purchase_cap: CpuPurchaseCap<MarketType, T>,
        listing_price: u64,
    }

    /// A capability to allow the owner to perform certain actions
    /// like modify the fee structure or withdraw profits.
    /// Bound to a specific Marketplace instance for security.
    public struct CpuMarketplaceOwnerCap has key {
        id: UID,
        marketplace_id: ID,  // Binds this Cap to a specific Marketplace
    }

    /// A shared object to represent the marketplace rules.
    public struct CpuMarketplace has key, store {
        id: UID,
        treasury: cpu::treasury::CpuMarketplaceTreasury,
        fee_structure: cpu::fees::CpuMarketplaceFeeStructure,
        version: u8,
        paused: bool,
        pause_reason: Option<String>,
    }

    /// Creates the CpuMarketplace with a `base_fee`, and CpuMarketplaceOwnerCap
    /// Uses One-Time Witness to ensure this can only be called once during package publish
    fun init(
        _otw: CORE,
        ctx: &mut TxContext
    ) {
        let treasury = cpu::treasury::new();

        // `base_fee_percentage` = 2.5% = 0.025 * 10^9 = 25_000_000
        // `min_fee_amount` = 0.2 SUI = 0.2 * 10^9 = 200_000_000
        let fee_structure = cpu::fees::new(
            25_000_000,
            200_000_000,
        );

        let (marketplace, cap) = create_cpu_marketplace(
            treasury,
            fee_structure,
            ctx
        );
    
        transfer::public_share_object(marketplace);
        transfer::transfer(cap, ctx.sender());
    }

    #[test_only]
    /// Create marketplace for testing (bypasses OTW requirement)
    /// Note: Real init function requires OTW and can only be called once during package publish
    public fun test_init(ctx: &mut TxContext) {
        let treasury = cpu::treasury::new();
        let fee_structure = cpu::fees::new(25_000_000, 200_000_000);
        let (marketplace, cap) = create_cpu_marketplace(treasury, fee_structure, ctx);
        transfer::public_share_object(marketplace);
        transfer::transfer(cap, ctx.sender());
    }


    #[test_only]
    /// Wrapper of module initializer for testing
    public fun test_update_version(
        marketplace: &mut CpuMarketplace,
        version: u8
    ) {
        marketplace.version = version;
    }

    /// - PUBLIC METHODS -

    /// Function to enable the owner of the marketplace to update the `base_fee` of the `fee_structure`
    #[allow(lint(public_entry))]
    public fun update_base_fee(
        cap: &CpuMarketplaceOwnerCap,
        marketplace: &mut CpuMarketplace,
        base_fee_percentage: u64,
        min_fee_amount: u64,
        clk: &Clock,
        ctx: &mut TxContext,
    ) {
        verify_owner_cap(cap, marketplace);
        assert!(marketplace.version == VERSION, ECpuMarketplaceVersionMismatch);
        let old_base = base_fee_percentage(marketplace);
        let old_min = min_fee_amount(marketplace);
        let fee_structure = cpu::fees::new(base_fee_percentage, min_fee_amount);
        marketplace.fee_structure = fee_structure;

        cpu::events::emit_fee_updated_event(
            old_base,
            base_fee_percentage,
            old_min,
            min_fee_amount,
            ctx.sender(),
            clock::timestamp_ms(clk),
        );
    }

    /// Function to enable the owner of the marketplace to withdraw the `profits`
    /// Returns Coin for composability in programmable transaction blocks (PTBs)
    public fun withdraw_profits(
        cap: &CpuMarketplaceOwnerCap,
        marketplace: &mut CpuMarketplace,
        ctx: &mut TxContext,
    ): Coin<SUI> {
        verify_owner_cap(cap, marketplace);
        assert!(marketplace.version == VERSION, ECpuMarketplaceVersionMismatch);
        let profits = cpu::treasury::withdraw_profits(
            &mut marketplace.treasury,
            ctx,
        );
        profits
    }

    /// Collect marketplace fee
    public(package) fun collect_marketplace_fee(
        marketplace: &mut CpuMarketplace,
        fee_payment: Coin<SUI>,
    ) {
        assert!(marketplace.version == VERSION, ECpuMarketplaceVersionMismatch);
        cpu::treasury::collect(&mut marketplace.treasury, fee_payment);
    }

    /// Validate marketplace version
    /// Used by functions that calculate fees manually without calling calculate_fee
    public(package) fun validate_version(marketplace: &CpuMarketplace) {
        assert!(marketplace.version == VERSION, ECpuMarketplaceVersionMismatch);
    }

    /// Given a listing, calculates the fee to apply.
    /// Aborts with `ENotListed` if the listing doesn't exists.
    /// Can be dry runed to know the fee for the payment
    public fun calculate_fee<MarketType, T: key + store>(
        kiosk: &Kiosk,
        marketplace: &CpuMarketplace,
        item_id: ID,
    ): (u64, u64, u64) {
        assert!(marketplace.version == VERSION, ECpuMarketplaceVersionMismatch);
        assert!(kiosk.is_listed(item_id), ENotListed);
        
        let listing_price = listing_price<MarketType, T>(kiosk, item_id);

        let fee = cpu::fees::calculate_fee(
            listing_price,
            &marketplace.fee_structure,
        );

        assert!(listing_price <= (18446744073709551615u64 - fee), ETotalPriceOverflow);
        let total_price = fee + listing_price;

        (fee, listing_price, total_price)
    }

    /// Given a listing, get the listing price without the fee.
    /// Aborts with `ENotListed` if the listing doesn't exists.
    public fun price<MarketType, T: key + store>(kiosk: &Kiosk, item_id: ID): u64 {
        assert!(kiosk.is_listed(item_id), ENotListed);
        let listing = cpu::extension::storage(kiosk).borrow<ID, CpuListing<MarketType, T>>(item_id);
        listing.listing_price
    }

    /// - PRIVATE METHODS -
    
    /// Easy accesor for the `listing_price` from an active listing.
    /// Aborts with `ENotListed` if the listing doesn't exists.
    fun listing_price<MarketType, T: key + store>(
        kiosk: &Kiosk,
        item_id: ID,
    ): u64 {
        assert!(kiosk.is_listed(item_id), ENotListed);
        let listing = cpu::extension::storage(kiosk).borrow<ID, CpuListing<MarketType, T>>(item_id);

        (listing.listing_price)
    }

    #[test_only]
    public fun test_listing_price<MarketType, T: key + store>(
        kiosk: &Kiosk,
        item_id: ID,
    ): u64 {
        (listing_price<MarketType, T>(kiosk, item_id))
    }

    /// - FRIEND METHODS -

    /// List an item on the CpuMarketplace
    /// Once listed, the `PurchaseCap` is stored on the `Kiosk` extension
    /// This functionality required to have the `Kiosk` extension installed and enabled.
    ///
    /// This function accepts an item from the wallet and places it into the kiosk.
    public(package) fun list<MarketType, T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        item: T,
        listing_price: u64,
        marketplace: &CpuMarketplace,
        ctx: &mut TxContext,
    ) {
        assert_not_paused(marketplace);
        assert!(cpu::extension::is_installed(kiosk), EExtensionNotInstalled);
        assert!(cpu::extension::is_enabled(kiosk), EExtensionDisabled);

        let item_id = object::id(&item);

        sui::kiosk::place(kiosk, kiosk_owner_cap, item);

        let purchase_cap = kiosk::list_with_purchase_cap<T>(
            kiosk,
            kiosk_owner_cap,
            item_id,
            listing_price,
            ctx
        );

        let cpu_purchase_cap = CpuPurchaseCap<MarketType, T> { purchase_cap };

        let cpu_listing = CpuListing<MarketType, T> {
            cpu_purchase_cap,
            listing_price,
        };

        cpu::extension::storage_mut(kiosk).add(item_id, cpu_listing);
    }

    /// List an item that is already in the Kiosk
    /// This function accepts an item_id for an item that is already placed in the kiosk.
    /// This is the standard way to list items according to Sui Kiosk best practices.
    ///
    /// The item must already be in the kiosk (either placed or locked).
    /// This functionality required to have the `Kiosk` extension installed and enabled.
    public(package) fun list_by_id<MarketType, T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        item_id: ID,
        listing_price: u64,
        marketplace: &CpuMarketplace,
        ctx: &mut TxContext,
    ) {
        assert_not_paused(marketplace);
        assert!(cpu::extension::is_installed(kiosk), EExtensionNotInstalled);
        assert!(cpu::extension::is_enabled(kiosk), EExtensionDisabled);

        let purchase_cap = kiosk::list_with_purchase_cap<T>(
            kiosk,
            kiosk_owner_cap,
            item_id,
            listing_price,
            ctx
        );

        let cpu_purchase_cap = CpuPurchaseCap<MarketType, T> { purchase_cap };

        let cpu_listing = CpuListing<MarketType, T> {
            cpu_purchase_cap,
            listing_price,
        };

        cpu::extension::storage_mut(kiosk).add(item_id, cpu_listing);
    }

    /// Delist an item from the CpuMarketplace
    /// Once delisted, the `PurchaseCap` is returned to the `Kiosk`
    /// The item is transfered back to the owner.
    /// This functionality required to have the `Kiosk` extension installed and enabled.
    public(package) fun delist<MarketType, T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        item_id: ID,
        ctx: & TxContext,
    ) {
        assert!(cpu::extension::is_installed(kiosk), EExtensionNotInstalled);
        assert!(cpu::extension::is_enabled(kiosk), EExtensionDisabled);
        assert!(kiosk.is_listed(item_id), ENotListed);

        let CpuListing<MarketType, T> {
            cpu_purchase_cap,
            listing_price: _,
        } = cpu::extension::storage_mut(kiosk).remove<ID, CpuListing<MarketType, T>>(item_id);

        let CpuPurchaseCap<MarketType,T> { purchase_cap } = cpu_purchase_cap;

        kiosk.return_purchase_cap(purchase_cap);
        let object = kiosk.take<T>(kiosk_owner_cap, item_id);

        transfer::public_transfer(object, ctx.sender());
    }

    /// Delist an item but keep it in the kiosk
    /// Use this for Personal Kiosk or items with kiosk_lock_rule
    /// Unlike regular delist, this doesn't try to take the item out of the kiosk
    /// The NFT remains in the kiosk, unlisted and available for future listing
    public(package) fun delist_in_kiosk<MarketType, T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        item_id: ID,
        _ctx: &TxContext,
    ) {
        assert!(cpu::extension::is_installed(kiosk), EExtensionNotInstalled);
        assert!(cpu::extension::is_enabled(kiosk), EExtensionDisabled);
        assert!(kiosk.has_access(kiosk_owner_cap), EOwnerCapMismatch);
        assert!(kiosk.is_listed(item_id), ENotListed);

        // Remove listing metadata (same as delist)
        let CpuListing<MarketType, T> {
            cpu_purchase_cap,
            listing_price: _,
        } = cpu::extension::storage_mut(kiosk).remove<ID, CpuListing<MarketType, T>>(item_id);

        let CpuPurchaseCap<MarketType, T> { purchase_cap } = cpu_purchase_cap;

        // Return purchase cap (this unlists the item)
        // NFT stays in the kiosk! (no kiosk.take())
        kiosk.return_purchase_cap(purchase_cap);
    }

    /// Relist an item with a new price without removing it from the kiosk
    /// This is an atomic operation that delists and relists in the same transaction
    /// Perfect for personal kiosks and locked items that cannot leave the kiosk
    public(package) fun relist<MarketType, T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        item_id: ID,
        new_price: u64,
        marketplace: &CpuMarketplace,
        ctx: &mut TxContext,
    ): u64 {  // Returns old price for event emission
        assert_not_paused(marketplace);
        assert!(cpu::extension::is_installed(kiosk), EExtensionNotInstalled);
        assert!(cpu::extension::is_enabled(kiosk), EExtensionDisabled);
        assert!(kiosk.is_listed(item_id), ENotListed);

        // Step 1: Remove old listing and get old price
        let CpuListing<MarketType, T> {
            cpu_purchase_cap,
            listing_price: old_price,
        } = cpu::extension::storage_mut(kiosk).remove<ID, CpuListing<MarketType, T>>(item_id);

        let CpuPurchaseCap<MarketType,T> { purchase_cap } = cpu_purchase_cap;

        // Step 2: Return old PurchaseCap (NFT stays in Kiosk)
        kiosk.return_purchase_cap(purchase_cap);

        // Step 3: Create new PurchaseCap with new price
        let new_purchase_cap = kiosk::list_with_purchase_cap<T>(
            kiosk,
            kiosk_owner_cap,
            item_id,  // NFT is still in kiosk
            new_price,
            ctx
        );

        // Step 4: Create new CpuListing and store it
        let new_cpu_listing = CpuListing<MarketType, T> {
            cpu_purchase_cap: CpuPurchaseCap<MarketType, T> {
                purchase_cap: new_purchase_cap
            },
            listing_price: new_price,
        };

        cpu::extension::storage_mut(kiosk).add(item_id, new_cpu_listing);

        old_price  // Return old price for event
    }

    /// Purchase an item from the CpuMarketplace
    /// From the given payment, it will take the profit and
    /// proceed to unpack the `PurchaseCap` to perform the trade
    /// returning to item and the `TransferRequest` back to the caller
    /// so they can approve and resolve all the `TransferPolicy` rules.
    public(package) fun purchase<MarketType, T: key + store>(
        kiosk: &mut Kiosk,
        item_id: ID,
        mut payment: Coin<SUI>,
        marketplace: &mut CpuMarketplace,
        ctx: &mut TxContext,
    ): (T, TransferRequest<T>) {
        assert_not_paused(marketplace);
        assert!(cpu::extension::is_installed(kiosk), EExtensionNotInstalled);
        assert!(cpu::extension::is_enabled(kiosk), EExtensionDisabled);
        assert!(kiosk.is_listed(item_id), ENotListed);
        assert!(marketplace.version == VERSION, ECpuMarketplaceVersionMismatch);

        let (fee, _, _) = calculate_fee<MarketType, T>(kiosk, marketplace, item_id);
        let fee_payment = payment.split(fee, ctx);
        cpu::treasury::collect(&mut marketplace.treasury, fee_payment);

        let CpuListing<MarketType, T> {
            cpu_purchase_cap,
            listing_price: _,
        } = cpu::extension::storage_mut(kiosk).remove<ID, CpuListing<MarketType, T>>(item_id);

        let CpuPurchaseCap { purchase_cap } = cpu_purchase_cap;

        let (item, req) = kiosk.purchase_with_cap(purchase_cap, payment);
    
        (item, req)
    }

    public(package) fun create_cpu_marketplace(
        treasury: cpu::treasury::CpuMarketplaceTreasury,
        fee_structure: cpu::fees::CpuMarketplaceFeeStructure ,
        ctx: &mut TxContext): (CpuMarketplace, CpuMarketplaceOwnerCap) {
        // Create marketplace UID first to get the ID for binding
        let marketplace_uid = object::new(ctx);
        let marketplace_id = object::uid_to_inner(&marketplace_uid);

        // Create Cap bound to this specific Marketplace
        let cap = CpuMarketplaceOwnerCap {
            id: object::new(ctx),
            marketplace_id,  // Bind Cap to Marketplace
        };

        let marketplace = CpuMarketplace {
            id: marketplace_uid,
            treasury,
            fee_structure,
            version: VERSION,
            paused: false,
            pause_reason: option::none(),
        };

        (marketplace, cap)
    }

    /// Update marketplace version (owner action) and emit event
    #[allow(lint(public_entry))]
    public fun update_version(
        cap: &CpuMarketplaceOwnerCap,
        marketplace: &mut CpuMarketplace,
        new_version: u8,
        clk: &Clock,
        ctx: &mut TxContext,
    ) {
        verify_owner_cap(cap, marketplace);
        let old = marketplace.version;
        assert!(new_version == VERSION, EVersionMustMatchDeployed);
        assert!(new_version > old, EVersionMustIncrease);
        marketplace.version = new_version;
        cpu::events::emit_version_updated_event(
            old,
            new_version,
            ctx.sender(),
            clock::timestamp_ms(clk),
        );
    }

    /// Transfer owner cap to a new address.
    /// Since CpuMarketplaceOwnerCap is key-only (no store), transfer must happen in this module.
    public fun transfer_owner_cap(
        cap: CpuMarketplaceOwnerCap,
        recipient: address,
    ) {
        transfer::transfer(cap, recipient);
    }

    // pause/resume entries removed per requirement; only update_version is retained

    public(package) fun base_fee_percentage(
        marketplace: &CpuMarketplace,
    ): u64 {
        let fee = marketplace.fee_structure.base_fee_percentage();

        (fee)
    }

    public(package) fun min_fee_amount(
        marketplace: &CpuMarketplace,
    ): u64 {
        let fee = marketplace.fee_structure.min_fee_amount();

        (fee)
    }


    /// Calculate marketplace + royalty fees for an arbitrary price (unlisted flows)
    /// Returns (marketplace_fee, royalty_fee, total_fee)
    public(package) fun calculate_fees_for_price<T: key + store>(
        marketplace: &CpuMarketplace,
        price: u64,
        policy: &TransferPolicy<T>,
    ): (u64, u64, u64) {
        cpu::fees::calculate_total_fees<T>(price, &marketplace.fee_structure, policy)
    }

    /// Validate that a fee_payment_amount covers marketplace + royalty fees for a price
    public(package) fun validate_fee_payment_for_price<T: key + store>(
        marketplace: &CpuMarketplace,
        policy: &TransferPolicy<T>,
        price: u64,
        fee_payment_amount: u64,
    ): bool {
        cpu::fees::validate_fee_payment<T>(price, fee_payment_amount, &marketplace.fee_structure, policy)
    }

    /// Split marketplace + royalty fees from a provided fee_payment coin for a given price
    /// Returns (marketplace_fee_coin, royalty_fee_coin). Zero-value coins are returned if amounts are zero.
    public(package) fun take_fee_coins_for_price<T: key + store>(
        marketplace: &CpuMarketplace,
        price: u64,
        policy: &TransferPolicy<T>,
        fee_payment: &mut Coin<SUI>,
        ctx: &mut TxContext,
    ): (Coin<SUI>, Coin<SUI>) {
        let (marketplace_fee, royalty_fee, _total) =
            calculate_fees_for_price<T>(marketplace, price, policy);

        let marketplace_fee_coin = if (marketplace_fee > 0) {
            fee_payment.split(marketplace_fee, ctx)
        } else {
            coin::zero<SUI>(ctx)
        };

        let royalty_fee_coin = if (royalty_fee > 0) {
            fee_payment.split(royalty_fee, ctx)
        } else {
            coin::zero<SUI>(ctx)
        };

        (marketplace_fee_coin, royalty_fee_coin)
    }

    /// List an item at a given price and immediately purchase it with provided total payment
    /// Helper to reduce boilerplate in accept_* flows
    public(package) fun list_and_purchase_with_payment<MarketType, T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        item: T,
        price: u64,
        total_payment: Coin<SUI>,
        marketplace: &mut CpuMarketplace,
        ctx: &mut TxContext,
    ): (T, TransferRequest<T>) {
        let item_id = object::id(&item);
        list<MarketType, T>(kiosk, kiosk_owner_cap, item, price, marketplace, ctx);
        purchase<MarketType, T>(kiosk, item_id, total_payment, marketplace, ctx)
    }

    /// Pay royalty if policy has royalty rule, otherwise destroy the zero coin
    /// Used by accept_* flows to reduce duplication
    public(package) fun pay_royalty_if_required<T: key + store>(
        policy: &mut TransferPolicy<T>,
        transfer_request: &mut TransferRequest<T>,
        royalty_payment: Coin<SUI>,
    ) {
        if (transfer_policy_utils::has_royalty_rule(policy)) {
            royalty_rule::pay(policy, transfer_request, royalty_payment);
        } else {
            coin::destroy_zero(royalty_payment);
        };
    }

    // ========== Pause/Resume Functions ==========

    /// Pause marketplace (owner only)
    #[allow(lint(public_entry))]
    public fun pause_marketplace(
        cap: &CpuMarketplaceOwnerCap,
        marketplace: &mut CpuMarketplace,
        reason: String,
        clk: &Clock,
        ctx: &mut TxContext,
    ) {
        verify_owner_cap(cap, marketplace);
        assert!(marketplace.version == VERSION, ECpuMarketplaceVersionMismatch);
        assert!(!marketplace.paused, EMarketplaceAlreadyPaused);

        marketplace.paused = true;
        marketplace.pause_reason = option::some(reason);

        cpu::events::emit_marketplace_paused_event(
            ctx.sender(),
            *marketplace.pause_reason.borrow(),
            clock::timestamp_ms(clk),
        );
    }

    /// Resume marketplace (owner only)
    #[allow(lint(public_entry))]
    public fun resume_marketplace(
        cap: &CpuMarketplaceOwnerCap,
        marketplace: &mut CpuMarketplace,
        clk: &Clock,
        ctx: &mut TxContext,
    ) {
        verify_owner_cap(cap, marketplace);
        assert!(marketplace.version == VERSION, ECpuMarketplaceVersionMismatch);
        assert!(marketplace.paused, EMarketplaceNotPaused);

        marketplace.paused = false;
        marketplace.pause_reason = option::none();

        cpu::events::emit_marketplace_resumed_event(
            ctx.sender(),
            clock::timestamp_ms(clk),
        );
    }

    /// Check if marketplace is paused (public view function)
    public fun is_paused(marketplace: &CpuMarketplace): bool {
        marketplace.paused
    }

    /// Get pause reason (public view function)
    public fun get_pause_reason(marketplace: &CpuMarketplace): String {
        if (marketplace.pause_reason.is_some()) {
            *marketplace.pause_reason.borrow()
        } else {
            b"".to_string()
        }
    }

    /// Get current treasury profits balance (public view function)
    /// Returns the accumulated marketplace fees that haven't been withdrawn yet
    public fun get_treasury_profits(marketplace: &CpuMarketplace): u64 {
        marketplace.treasury.profits()
    }

    /// Internal: verify OwnerCap belongs to this Marketplace
    fun verify_owner_cap(
        cap: &CpuMarketplaceOwnerCap,
        marketplace: &CpuMarketplace,
    ) {
        assert!(
            cap.marketplace_id == object::id(marketplace),
            EOwnerCapMismatch
        );
    }

    /// Internal: assert marketplace is not paused
    fun assert_not_paused(marketplace: &CpuMarketplace) {
        assert!(!marketplace.paused, EMarketplacePaused);
    }

    /// Public package-level function to assert marketplace is not paused
    /// Used by other modules like marketplace_offer
    public(package) fun assert_marketplace_not_paused(marketplace: &CpuMarketplace) {
        assert!(!marketplace.paused, EMarketplacePaused);
    }
}
