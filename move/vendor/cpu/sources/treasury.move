// Copyright (c) Blockus
// Author: Tirso J. Bello Ponce (tirso@blockus.gg)

module cpu::treasury {
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::coin::{Self, Coin};

    /// An object to collect profits inside marketplace
    /// This object is intended to be composed inside
    /// `CpuMarketplace` declared in `cpu::core` module
    public struct CpuMarketplaceTreasury has store {
        profits: Balance<SUI>,
    }

    // ========== Method Aliases (Move 2024) ==========
    // Note: CpuMarketplaceTreasury methods are auto-aliased (first param is same module type)

    /// Creates a new `CpuMarketplaceTreasury` with balance in zero
    public(package) fun new(): CpuMarketplaceTreasury {
        let treasury = CpuMarketplaceTreasury {
            profits: balance::zero(),
        };

        (treasury)
    }

    /// Collect a `profit` into the `treasury` balance
    public(package) fun collect(treasury: &mut CpuMarketplaceTreasury, profit: Coin<SUI>) {
        coin::put(&mut treasury.profits, profit);
    }

    /// Withdraw all profits from the `treasury`
    /// Since it's a friend function, the authorization cap is intended to be 
    /// placed on the implementation function inside `cpu::core` module
    public(package) fun withdraw_profits(
        treasury: &mut CpuMarketplaceTreasury,
        ctx: &mut TxContext,
    ): Coin<SUI> {
        let amount = treasury.profits.value();
        let profits = coin::take(&mut treasury.profits, amount, ctx);

        cpu::events::emit_profits_withdrawn_event(
            amount,
            ctx.sender(),
        );

        (profits)
    }

    public(package) fun profits(
        treasury: & CpuMarketplaceTreasury,
    ): u64 {
        let amount = treasury.profits.value();

        (amount)
    }

    #[test_only]
    public fun new_for_testing(_ctx: &mut TxContext): CpuMarketplaceTreasury {
        new()
    }
}
