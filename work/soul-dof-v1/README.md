# Soul DOF v1 — bounded Move research prototype

2026-10-07. Local only; nothing published or deployed. Current target: [fresh Soul DOF specification](../../docs/SOUL_DOF_V1_REBUILD_CN.md). This directory is isolated from the production Soulidity contracts.

## Implemented

- An owned `Soul has key, store` root with required Core and Composition DOF modules.
- Real `T: key + store` objects deposited under an item ID key; a separate member index and typed slot activation.
- Deposit, activate, deactivate, withdraw and same-type replace, with expected revision checking. Withdrawal clears activation and returns the same original object ID.
- A mint function that sends the fresh root directly to a recipient rather than returning a fresh value that a caller could share.
- Read-only module/item access; no public mutable UID or removal of required modules.

The root can move by native transfer while its DOF children stay beneath it. A recipient can withdraw a component. Deposit by itself does not activate anything. The test using `Coin<SUI>` illustrates generic foreign-type custody only; it does not define a currency visual slot.

## Verification

Actual local runs on 2026-10-07:

```sh
sui move test --path work/soul-dof-v1
sui move build --path work/soul-dof-v1
```

Tests: **10 passed, 0 failed**. Production-mode compilation: **exit 0**. CLI: `sui 1.78.1-homebrew`; the generated [Move.lock](Move.lock) resolves Sui/MoveStdlib at `2a0becb2fcc6989e492981104af67f62f2c9511a`. The lock's `mainnet` environment label describes dependency resolution; these were local builds/tests, not Mainnet transactions.

| Test area | Actual assertions |
| --- | --- |
| Active item withdrawal | Original Soul and Item IDs retained; binding and member index cleared; wallet custody recovered |
| Whole-root transfer | Core and equipped child remain under the same Soul; buyer can withdraw the original child |
| Nested container transfer | Test container holds the real Soul; recipient recovers root and child with original IDs |
| Replace | Old object returned, new object activated, one member and one logical revision change |
| Deactivate and generic custody | Coin from the Sui framework remains held while inactive; withdrawal retains its value |
| Kiosk purchase | Generic Kiosk purchase carries the root's equipped child; buyer can withdraw it |
| Rejection paths | Stale revision, incompatible exact type, one item in two slots, and occupied slot all abort |

The Kiosk test uses test SUI and a no-rule TransferPolicy. The nested container is a test module in this package, not an independently deployed custodian. The tests do not prove arbitrary external containers are safe.

Captured terminal output and file identities: [evidence](../../output/asset-standard-2026-10-07/dof-prototype-evidence.json), [test log](../../output/asset-standard-2026-10-07/dof-prototype-test.log), [build log](../../output/asset-standard-2026-10-07/dof-prototype-build.log).

## Deliberately incomplete

This is executable evidence for native ownership, not a finished asset protocol. It does not implement:

- Scene/anchor/mask definitions, cross-Maker VisualAdapter, ContentRef bindings, user PlacementOverride, canvas editing or visual validation.
- Accurate product/source/version admission and licensing, paid Maker/Pack passes, Complete or production issuance limits.
- Walrus/Seal, delegated grants and handoff, Display objects, event/indexer APIs or generic extension updates.
- USDC settlement, fees/royalties, market bundle snapshots, listing recovery, policy rules or audited custody.
- Burn/recovery/exit APIs, comprehensive invalid-input/capacity/gas/depth tests, or live-network and independent security review.

The 500-member/slot constants are research bounds, not validated production limits. Exact-type acceptance and same-type replace are intentionally narrower than the full planned admission model.

Next bounded implementation: real 2D visual fixtures for two different Maker canvases/anchors, explicit replacement/overlay behavior, default adaptation, constrained adjustment and recipe/preview consistency, as specified in section 3 of the target document. No old ABI or Pass migration is required by the fresh target.
