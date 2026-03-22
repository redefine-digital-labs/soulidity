/// Mintable test USDC for testnet.
/// Module path `usdc::usdc` and struct name `USDC` match the compilation
/// stub used by soul_market so the two packages are link-compatible.
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
