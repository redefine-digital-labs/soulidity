/// Mintable test USDC for testnet.
/// Module path `usdc::usdc` and struct name `USDC` match the compilation
/// stub kept for historical Soul marketplace compatibility tests.
module usdc::usdc;

use sui::coin::{Self, TreasuryCap};

/// One-time witness — must match the module name in UPPER_SNAKE_CASE.
public struct USDC has drop {}

/// Publish: create the currency with 6 decimals (same as real USDC).
fun init(witness: USDC, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency<USDC>(
        witness,
        6,              // decimals
        b"USDC",        // symbol
        b"Test USDC",   // name
        b"Mintable test USDC for Soul marketplace testing",
        option::none(), // icon_url
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::public_transfer(treasury_cap, ctx.sender());
}

/// Mint `amount` (atomic units, 6 decimals) to `recipient`.
public fun mint(
    cap: &mut TreasuryCap<USDC>,
    amount: u64,
    recipient: address,
    ctx: &mut TxContext,
) {
    let minted = coin::mint(cap, amount, ctx);
    transfer::public_transfer(minted, recipient);
}

/// Burn coins.
public fun burn(
    cap: &mut TreasuryCap<USDC>,
    coin: coin::Coin<USDC>,
) {
    coin::burn(cap, coin);
}

#[test_only]
public fun init_for_testing(recipient: address, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency<USDC>(
        USDC {},
        6,
        b"USDC",
        b"Test USDC",
        b"Mintable test USDC for Soul marketplace testing",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::public_transfer(treasury_cap, recipient);
}

#[test_only]
public fun mint_for_testing(
    cap: &mut TreasuryCap<USDC>,
    amount: u64,
    ctx: &mut TxContext,
): coin::Coin<USDC> {
    coin::mint(cap, amount, ctx)
}
