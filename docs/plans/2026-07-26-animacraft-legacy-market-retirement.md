# Animacraft legacy-market retirement runbook

Status: mandatory P0 release gate. Do not merge or execute the Soulidity
upgrade until the Animacraft v4 release commit is frozen and Soulidity pins
that exact commit.

## Why routing is insufficient

Sui upgrades do not remove older package versions. A caller can always target
the original Soulidity package ID directly. Animacraft provenance is attached
to `SoulState` as a dynamic field by the upgraded package; the original
`market::list_soul_fixed_price` and `buy_soul_fixed_price` bytecode cannot see
that field. A web-only switch to royalty-aware entrypoints therefore does not
close the bypass.

The only durable control over the old bytecode is the shared legacy
`MarketConfig`. Mainnet currently has:

- Original Soulidity package:
  `0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0`
- Legacy `MarketConfig`:
  `0xe6214eaba8afa4c9191a602b78bfc0658ce1e188625f986dc6768d40f4d7dbb5`
- Legacy `MarketAdminCap`:
  `0x1a68b6e897b9c76377e895545c2d54f777820bf8b844748718ec9e242aae2446`
- Soulidity `UpgradeCap`:
  `0xca2ff2940a628e5d15e7d452604aa0a2777ed147febe012280b54feced1dc701`
- Soulidity admin wallet:
  `0x840221acb5a4bd05dfd1cfd696c070773270125012f9c7e67e5c334e406712da`

The live legacy config was read on 2026-07-26 and was `paused=false`.

`MarketConfigV2` is the unified successor for the complete Soulidity market,
not an Animacraft-only side market. Native/import/joined minting, ordinary
Soul trading, collection creation/trading, Kiosk registration/rebinding,
owner content/state mutations and paid-access configuration/purchase all have
v2 entrypoints. Animacraft uses the same config but its dedicated list/buy
paths additionally require immutable provenance and route Maker royalty.

The old config must still remain paused forever. Product and SDK code must
never fall back to v1 when v2 is unavailable; missing v2 IDs or disabled gates
are a release-blocking maintenance state.

## Exact two-wallet sequence

### Wallet A — Animacraft protocol owner

Wallet:
`0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f`

1. Upgrade Animacraft to the audited v4 bytecode.
2. Initialize the v4 protocol-fee objects with the canonical USDC type.
   Initialization must leave the canonical mint gate **disabled**.
3. Record the new callable package ID, `ProtocolFeeConfig`,
   `ProtocolTreasury`, `ProtocolFeeAdminCap`, and initialization digest.
4. Freeze and push the exact Animacraft release commit containing its
   `Published.toml`. Soulidity must pin this commit before its own build.
5. Run Animacraft Mainnet preflight, but do **not** enable canonical minting.
   The gate stays disabled through legacy pause, Soulidity upgrade, retirement
   and old-bytecode adversarial verification.
6. Only after Wallet B completes every retirement verification below may
   Wallet A enable canonical minting and run the first Animacraft v4 mint.

Wallet A does not touch Soulidity's legacy market objects.

### Wallet B — Soulidity protocol owner

Wallet:
`0x840221acb5a4bd05dfd1cfd696c070773270125012f9c7e67e5c334e406712da`

1. Confirm Wallet A's canonical Animacraft mint gate is still disabled.
2. Pin the exact frozen Animacraft v4 commit.
3. Run `sui move test` and the exact Mainnet Soulidity upgrade dry-run.
4. **Before upgrading**, target the currently callable/original package and
   call `market::update_paused(legacyConfig, &legacyAdminCap, true)`.
   Read the object back and prove `paused=true`. From this point onward, old
   bytecode is fail-closed even if the following transaction is delayed.
5. Upgrade Soulidity and record the new callable package ID. Never unpause v1
   to shorten the maintenance window.
6. Target the new callable package and call
   `market::retire_legacy_market(legacyConfig, legacyAdminCap)`.
7. Retirement consumes and deletes the legacy admin cap and creates:
   - shared `MarketConfigV2`;
   - owned `MarketAdminCapV2`.
8. Put both new IDs in `deployment-manifest.json`. Set
   `NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID` to the same config ID and set
   `marketConfigV2PackageId` /
   `NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID` to the package that
   introduced the v2 types. The defining ID stays fixed across future
   upgrades; transaction targets continue to use the latest callable ID.
9. Run the mandatory post-transaction checks and adversarial simulations while
   `secondary_enabled=false` and Animacraft canonical minting remains disabled.
10. Deploy SDK/Web only after those IDs are present. Every ordinary and
    Animacraft transaction builder must use v2 config and v2 entrypoints.
11. Exercise ordinary primary operations (Kiosk + native mint + content and
    paid-access configuration) while secondary remains closed.
12. After review, call
    `update_config_v2_secondary_enabled(true)`, read it back, then smoke:
    - a pre-retirement ordinary listing settled through v2;
    - a fresh ordinary v2 mint → list → quote → buy;
    - a collection list → quote → buy.
13. Wallet A may now enable canonical Animacraft minting. Mint one canonical
    Soul, prove generic v2 list/buy rejects it, then complete the dedicated
    Animacraft list/buy smoke and verify MakerTreasury royalty.

### Exact guarded commands

Every migration command defaults to a non-signing dry-run. `--execute` alone
is insufficient: the exact step-specific confirmation is also required. The
scripts validate Sui Mainnet chain ID, the canonical Wallet B address, the
canonical legacy config/admin cap, and the UpgradeCap owner/package before
they can sign.

1. Simulate the pre-upgrade pause:

   ```sh
   npm run pause:soulidity-legacy-market
   ```

2. After reviewing the simulation, execute only the pause and read
   `paused=true` back:

   ```sh
   npm run pause:soulidity-legacy-market -- \
     --execute \
     --confirm=PAUSE_SOULIDITY_LEGACY_MARKET_MAINNET
   ```

3. Build and simulate the exact compatible upgrade:

   ```sh
   npm run upgrade:soulidity-mainnet
   ```

4. After reviewing the build digest, dependency set, gas and predicted package
   ID, execute the upgrade and atomically record its callable package:

   ```sh
   npm run upgrade:soulidity-mainnet -- \
     --execute \
     --confirm=UPGRADE_SOULIDITY_MAINNET \
     --write-manifest \
     --record-animacraft-provenance-origin
   ```

5. Simulate retirement. This PTB redundantly calls
   `update_paused(..., true)` and then consumes `MarketAdminCap` in
   `retire_legacy_market`, so retirement itself remains atomic:

   ```sh
   npm run retire:soulidity-legacy-market
   ```

6. Execute retirement and atomically record the stable type origins and
   successor object IDs:

   ```sh
   npm run retire:soulidity-legacy-market -- \
     --execute \
     --confirm=RETIRE_SOULIDITY_LEGACY_MARKET_MAINNET \
     --write-manifest
   ```

   The write preserves the full prior deployment record and sets:

   - `callablePackageId`;
   - `animacraftProvenancePackageId`;
   - `marketConfigV2PackageId`;
   - `marketConfigV2Id`;
   - `marketAdminCapV2Id`;
   - the retirement transaction digest.

   `animacraftProvenancePackageId` and `marketConfigV2PackageId` are defining
   package TypeOrigins. They intentionally remain fixed when a future upgrade
   changes `callablePackageId`.

7. Run guarded-launch postflight:

   ```sh
   npm run postflight:animacraft-market-retirement
   ```

   After a separately approved secondary enablement:

   ```sh
   npm run postflight:animacraft-market-retirement -- \
     --expect-secondary=enabled
   ```

Do not use `npm run publish:soulidity` for this migration. A fresh Mainnet
publish now fails closed whenever a Mainnet package family is already
recorded. The separately named break-glass path requires an exact second
confirmation and archives the prior deployment before any manifest overwrite;
it is not an upgrade mechanism.

The pause and upgrade/retirement are deliberately separate transactions.
Failure after step 4 leaves a safe maintenance state: v1 remains paused and
the admin cap remains available for retrying the upgrade/retirement. Never
unpause the legacy config.

## Existing v1 listing handling

Retirement does not mutate or hide active `SoulListing` and
`CollectionListing` objects:

- sellers may cancel either listing type after retirement because cancellation
  does not require a market config;
- once v2 secondary trading is enabled, ordinary v1 listings settle through
  `buy_soul_fixed_price_v2` or `buy_collection_right_fixed_price_v2`;
- the settlement uses the current v2 fee recipient and fee bps, so every UI
  and agent quote must also read `MarketConfigV2`;
- price updates cancel the old listing and create a new v2 listing;
- generic v2 Soul paths reject Animacraft provenance, while dedicated
  Animacraft paths require it and enforce Maker royalty.

Do not mass-delete or rewrite listing objects. If an unexpected listing cannot
settle, keep it cancellable and treat migration as blocked until its exact
object state has been diagnosed.

## Mandatory post-transaction verification

Run:

```sh
npm run postflight:animacraft-market-retirement
```

It must prove:

- callable Soulidity package differs from the original package;
- legacy `MarketConfig.paused == true`;
- legacy `MarketAdminCap` no longer exists;
- successor config points to the exact legacy config;
- successor primary mint gate is enabled;
- successor secondary market gate is disabled;
- successor admin cap points to the successor config.

The read-only postflight also dev-inspects the **original** package's
`market::init_personal_kiosk` against the canonical shared config and registry.
It must abort `EMarketPaused (11)`, and it verifies the normalized ABIs for
the original `list_soul_fixed_price` and `buy_soul_fixed_price` still consume
the canonical legacy config.

This generic runtime probe is not a substitute for fixture-specific trade
evidence: a read-only script cannot safely fabricate a live seller kiosk,
listing, buyer kiosk and payment coin. Retain a separate adversarial PTB
targeting the **original** package's
`market::list_soul_fixed_price` with an existing Soul. Simulation must abort
`EMarketPaused`. Repeat for original `buy_soul_fixed_price`, ordinary mint,
collection listing and paid-access purchase. These simulations run before
Wallet A enables canonical Animacraft minting and are required release
evidence even though the deleted admin cap plus paused config is permanent.

After Wallet A enables canonical minting, repeat original generic list/buy
simulation with the first v4 Animacraft Soul and retain the abort evidence.
Also prove the successor generic v2 path rejects that Soul with
`EAnimacraftListingPathRequired`.

## Rollback boundary

Package upgrades are not reversible. Before the retirement PTB, stop and fix
by shipping a newer compatible upgrade. After retirement, the old market is
intentionally and permanently disabled; rollback means disabling the successor
primary/secondary gates with `MarketAdminCapV2` and shipping a newer
successor implementation. There is no supported path to recreate or restore
the legacy `MarketAdminCap`.
