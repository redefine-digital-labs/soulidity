// Copyright (c) Blockus
// Author: Tirso J. Bello Ponce (tirso@blockus.gg)

/// An implementation of a fixed trade marketplace using `cpu::core` module
#[allow(lint(public_entry))]
module cpu::marketplace_fixed_trade {
    use sui::kiosk::{Kiosk, KioskOwnerCap};
    use sui::transfer_policy::{TransferRequest};
    use sui::coin::{Coin};
    use sui::sui::SUI;
    use unft_standard::unft_standard::NftCollection;

    #[error]
    const EPaymentInsufficientAmount: vector<u8> =
        b"The payment provided does not cover the fee + listing price amount.";

    public struct CpuMarketplaceFixedTrade {}


    /// List an item from your wallet to your existing Kiosk
    ///
    /// This is the RECOMMENDED way to list items according to Sui Kiosk best practices.
    /// It allows you to use a single Kiosk for all your NFTs across different collections.
    ///
    /// If the Extension is not installed on your Kiosk, it will be automatically added.
    public fun list_to_existing_kiosk<T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        collection: &NftCollection<T>,
        item: T,
        listing_price: u64,
        marketplace: &cpu::core::CpuMarketplace,
        ctx: &mut TxContext,
    ) {
        let item_id = object::id(&item);

        // Install extension if not already installed
        if (!cpu::extension::is_installed(kiosk)) {
            cpu::extension::add(kiosk, kiosk_owner_cap, ctx);
        } else if (!cpu::extension::is_enabled(kiosk)) {
            cpu::extension::enable(kiosk, kiosk_owner_cap);
        };

        // List the item using core module
        cpu::core::list<CpuMarketplaceFixedTrade, T>(
            kiosk,
            kiosk_owner_cap,
            item,
            listing_price,
            marketplace,
            ctx,
        );

        // Emit event
        cpu::events::emit_item_listed_event<CpuMarketplaceFixedTrade, T>(
            collection,
            object::id(kiosk),
            ctx.sender(),
            listing_price,
            item_id,
        );
    }

    /// List an item that is already in your Kiosk
    ///
    /// This is the STANDARD way to list items that are already in your Kiosk.
    /// Use this when:
    /// - You previously bought an NFT that went into your Kiosk
    /// - You delisted an item and want to list it again
    /// - The NFT was minted directly into your Kiosk
    /// - The NFT is locked in your Kiosk
    ///
    /// If the Extension is not installed on your Kiosk, it will be automatically added.
    public fun list_from_kiosk<T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        collection: &NftCollection<T>,
        item_id: ID,
        listing_price: u64,
        marketplace: &cpu::core::CpuMarketplace,
        ctx: &mut TxContext,
    ) {
        // Install extension if not already installed
        if (!cpu::extension::is_installed(kiosk)) {
            cpu::extension::add(kiosk, kiosk_owner_cap, ctx);
        } else if (!cpu::extension::is_enabled(kiosk)) {
            cpu::extension::enable(kiosk, kiosk_owner_cap);
        };

        // List the item by ID using core module
        cpu::core::list_by_id<CpuMarketplaceFixedTrade, T>(
            kiosk,
            kiosk_owner_cap,
            item_id,
            listing_price,
            marketplace,
            ctx,
        );

        // Emit event
        cpu::events::emit_item_listed_event<CpuMarketplaceFixedTrade, T>(
            collection,
            object::id(kiosk),
            ctx.sender(),
            listing_price,
            item_id,
        );
    }

    /// Delist an item from the CpuMarketplace, this function is not intended to detroy the `Kiosk` after the delist
    public fun delist<T: key + store>(
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        item_id: ID,
        ctx: &mut TxContext,
    ) {
        cpu::core::delist<CpuMarketplaceFixedTrade, T>(
            kiosk,
            kiosk_owner_cap,
            item_id,
            ctx,
        );
        cpu::events::emit_item_delisted_event<CpuMarketplaceFixedTrade, T>(
            collection,
            object::id(kiosk),
            ctx.sender(),
            item_id,
        );
    }

    /// Delist an item but keep it in the kiosk
    /// Use this for Personal Kiosk or items with kiosk_lock_rule
    /// Unlike regular delist, this doesn't try to take the item out of the kiosk
    /// The NFT remains in the kiosk, unlisted and available for future listing
    public fun delist_in_kiosk<T: key + store>(
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        item_id: ID,
        ctx: &mut TxContext,
    ) {
        cpu::core::delist_in_kiosk<CpuMarketplaceFixedTrade, T>(
            kiosk,
            kiosk_owner_cap,
            item_id,
            ctx,
        );
        cpu::events::emit_item_delisted_event<CpuMarketplaceFixedTrade, T>(
            collection,
            object::id(kiosk),
            ctx.sender(),
            item_id,
        );
    }

    /// Relist an item with a new price without removing it from the kiosk
    /// This is an atomic operation that allows price updates for items that cannot leave the kiosk
    /// (e.g., items in personal kiosks or locked items)
    public fun relist<T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_owner_cap: &KioskOwnerCap,
        collection: &NftCollection<T>,
        item_id: ID,
        new_price: u64,
        marketplace: &cpu::core::CpuMarketplace,
        ctx: &mut TxContext,
    ) {
        let old_price = cpu::core::relist<CpuMarketplaceFixedTrade, T>(
            kiosk,
            kiosk_owner_cap,
            item_id,
            new_price,
            marketplace,
            ctx,
        );

        cpu::events::emit_item_relisted_event<CpuMarketplaceFixedTrade, T>(
            collection,
            object::id(kiosk),
            ctx.sender(),
            item_id,
            old_price,
            new_price,
        );
    }

    /// Purchase an item from the CpuMarketplace
    /// Now accepts overpayment (payment >= required_amount) and returns change
    /// The `item` is returned with a `transfer_request` and any excess payment as change
    /// The caller is responsible to confirm the request and satisfy all the policy rules.
    /// [L-01 FIX] Removed `buyer: address` parameter — buyer is derived from ctx.sender()
    public fun purchase<T: key + store>(
        collection: &NftCollection<T>,
        kiosk: &mut Kiosk,
        item_id: ID,
        mut payment: Coin<SUI>,
        marketplace: &mut cpu::core::CpuMarketplace,
        ctx: &mut TxContext,
    ): (T, TransferRequest<T>, Coin<SUI>) {

        let (_fee, _listing_price, total) = cpu::core::calculate_fee<CpuMarketplaceFixedTrade, T>(kiosk, marketplace, item_id);
        let payment_value = payment.value();

        assert!(payment_value >= total, EPaymentInsufficientAmount);

        // Split exact payment amount and keep change
        let (exact_payment, change) = if (payment_value == total) {
            (payment, sui::coin::zero<SUI>(ctx))
        } else {
            let exact = payment.split(total, ctx);
            (exact, payment)
        };

        let (item, transfer_request) = cpu::core::purchase<CpuMarketplaceFixedTrade, T>(
            kiosk,
            item_id,
            exact_payment,
            marketplace,
            ctx,
        );

        // [L-01 FIX] Use ctx.sender() instead of caller-supplied address
        let buyer = ctx.sender();
        let seller = kiosk.owner();
        cpu::events::emit_item_purchased_fixed_price_event<CpuMarketplaceFixedTrade, T>(
            collection,
            object::id(kiosk),
            item_id,
            seller,
            buyer,
            transfer_request.paid(),
        );

        (item, transfer_request, change)
    }

    public fun calculate_fee<T: key + store>(
        kiosk: &mut Kiosk,
        marketplace: &mut cpu::core::CpuMarketplace,
        item_id: ID,
    ): (u64, u64, u64) {
        let (fee, listing_price, total_price) = cpu::core::calculate_fee<CpuMarketplaceFixedTrade, T>(kiosk, marketplace, item_id);

        (fee, listing_price, total_price)
    }
}
