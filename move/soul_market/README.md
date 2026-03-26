# soul_market Deployment Notes

## Current Testnet Lineage

- `move/soul_market/Published.toml` tracks the current upgrade lineage for testnet.
- `original-id = 0x8827d42c7834878abd4eed7ac124f37d96908c17490e3be45adf9b1ed8ec841e` is the stable package ID the app points at today.
- `published-at = 0xa33262df79f2146911ad0531b04c428267d05eec4c98426ce695bd95e79f96a0` is the latest upgraded package object for version 3.
- `.env` already uses `NEXT_PUBLIC_SOUL_PACKAGE_ID=0x8827...`, so runtime callers stay on the stable package lineage instead of pinning a transient upgraded object ID.

## USDC Address Changes

- `move/soul_market/Move.toml` and `move/soul_market/deps/usdc/Move.toml` now point at the current test USDC package `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325`.
- Existing `SoulSeries`, `SoulRelease`, `PricingPlan`, and pass objects do not embed `USDC` in stored fields, so changing the USDC dependency does not invalidate those objects by itself.
- The real compatibility boundary is the payment coin type accepted by `buy_perpetual`, `buy_subscription`, and `renew_subscription`. After a USDC package switch, callers must use the new `Coin<0x79d8...::usdc::USDC>` type and cannot spend balances from the old test coin type against the new package.

## Deployment Rule

Treat a USDC package change as an environment migration, not as a silent in-place upgrade:

1. Update `move/soul_market/Move.toml` and `move/soul_market/deps/usdc/Move.toml`.
2. Update `.env` / runtime config: `NEXT_PUBLIC_USDC_PACKAGE_ID` and `NEXT_PUBLIC_USDC_COIN_TYPE`.
3. Re-mint or redistribute balances for the new test USDC package before running purchases or renewals.
4. Keep `NEXT_PUBLIC_SOUL_PACKAGE_ID` on the stable `original-id` lineage unless you intentionally repoint the whole app.

If you need old and new test USDC balances to coexist, that is a separate migration plan. The current repo assumes a clean cutover to one active USDC type per environment.
