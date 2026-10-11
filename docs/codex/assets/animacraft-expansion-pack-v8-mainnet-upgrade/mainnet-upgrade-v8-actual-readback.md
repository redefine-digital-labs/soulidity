# Expansion Pack v8 Mainnet upgrade — actual execution and readback

- Phase: `animacraft-expansion-pack-v8-mainnet-upgrade`
- Executed: `2026-08-12T00:27:36.691Z` (`2026-08-12T08:27:36.691+08:00`)
- Result: successful Mainnet package upgrade; one signature, one broadcast, no retry
- Machine-readable evidence: `mainnet-upgrade-v8-actual-readback.json`
- Dry-run evidence: `mainnet-upgrade-dry-run.md`

## Authoritative result

- Transaction: `2ef2pUjBBuhGDTuzVHZwo3ZkqgkqzUc6A2mNnjZeLLTF`
- Status: `success`
- Epoch: `1217`
- Checkpoint: `309641036`
- Actual callable package: `0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a`
- Actual TypeOrigin for all new Expansion Pack v8 and Complete v8 datatypes: the same package
- Package version: `6`
- Package object digest: `8Br3y89HNVPUndvAVhyddc4rV8GTCFZ2Pde8aMnEpfm`
- Frozen source commit: `59cae42a8602f54a7b7902aee77971a1dff8a270`
- Frozen source tree: `794b18902c5d758889baf80431a3f99f59e4a8aa`
- Package digest: `Mquf4qbGQ5nFAJhS8MyzGZZbK6bgAnxqUF4jQVdA7kw`

The dry-run digest-derived package `0xd5e1…1216` is not the actual package.
Sui simulation synthesized address-balance gas, while the signed raw
TransactionData used an empty gas-payment vector. The actual transaction and
package IDs above are therefore authoritative; source and package digest did
not change.

## Signed transaction lock

- Network/RPC: Sui Mainnet, `https://fullnode.mainnet.sui.io:443`
- Chain identifier: `35834a8a` / `4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S`
- Sender and gas owner: `0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f`
- Gas payment: address-balance gas (`[]` legacy coin inputs)
- Gas price: `100 MIST`
- Gas budget: `1,500,000,000 MIST`
- Unsigned TransactionData digest: `2ef2pUjBBuhGDTuzVHZwo3ZkqgkqzUc6A2mNnjZeLLTF`
- Unsigned bytes SHA-256: `08c4240bafd2851a1f0c9d2a9d678f5b178db15d791b6862a0afcc73068e1226`
- Signature artifact SHA-256: `3a8a95b75c482ad4ded7771bf0d8aa147cddbc29837b9e6b6f75e4ced294050f`
- Commands: `authorize_upgrade` → `Upgrade` → `commit_upgrade`

The user's one-write approval was consumed once. No transaction was rebuilt,
re-signed, retried, or rebroadcast.

## Effects and authority readback

- Computation: `863,000 MIST`
- Storage: `778,498,400 MIST`
- Rebate: `1,617,660 MIST`
- Non-refundable storage: `16,340 MIST`
- Net gas: `777,743,740 MIST` (`0.777743740 SUI`)
- Post-transaction signer balance: `19.995184569 SUI`
- UpgradeCap: `0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520`
- UpgradeCap version: `955119809` → `955119810`
- UpgradeCap digest: `7TTHPiXmMNo19C2C6RBwRYnWduqoLa2hRTBCtfSRnALy`
- UpgradeCap owner unchanged; compatible policy remains `0`

Object changes were exactly the published package and mutated UpgradeCap.
There were zero Move events and zero v8 business objects. The only auxiliary
event was Sui's system address-balance gas accumulator split.

## ABI, TypeOrigin and gate readback

The published package contains exactly:

- `animacraft`
- `commerce_v5`
- `composition_v6`
- `expansion_pack_complete_v8`
- `expansion_pack_v8`
- `seal_v5`

The package TypeOrigin table has 144 entries. All 18 `expansion_pack_v8`
datatypes, all 8 `expansion_pack_complete_v8` datatypes, and the new
`commerce_v5::MakerReleaseEvidenceV5` evidence type resolve to the actual v6
package. Exact callable ABI was read through the original package lineage
namespace and TypeOrigin was separately checked through each datatype's
`definingId`, matching Sui's upgrade model.

Read-only simulations proved:

- `version_v8() == 8`
- `companion_proof_version_v8() == 8`
- `complete_bridge_enabled_v8() == false`
- `physical_bridge_enabled_v8() == false`
- `companion_proof_available_v8() == false`
- both bridge assertion helpers abort

`expansionPackV8ReleaseEnabled`, canonical Soul mint, Complete-to-Soulidity,
and physical release remain false in product runtime/deployment configuration.
The primary product callable remains v4 `0x222161…af3b`.

## Pre-existing core chain state

A separate full-network audit found that Mainnet transaction
`AVYsGvyfgSVFQ8mrQWXCpNbNzwDcPc4BboegLsetSYXT` at checkpoint `305867277`
(`2026-08-02T09:34:16.910Z`) had already enabled the v4 fee, Commerce v5,
Composition v6, and Soulidity market gates before this phase. It also bound the
Commerce logical Blob/proof and Composition Soul owner proof, and rotated the
validator to epoch 1 / cap
`0x5d791f7752f3c7ca9509089de5c2376367a4d5fa8a70fc40b456a276c7bcee75`.

That state was not created or modified by the v8 upgrade. It is now recorded in
`deployments/mainnet.json` under `observedChainState`, separately from product
runtime gates, which remain false. The v8 Complete bridge still hard-aborts, so
the pre-existing core activation cannot bypass this phase's v8 gate.

## Seal, Walrus, object and event readback

The package upgrade did not call v8, Complete, Seal, or Walrus application
functions. Therefore there is no v8 object, v8 event, Seal object, policy
write, Blob ID, or Walrus write to read back. This is an explicit zero-result,
not missing evidence. Sui transaction effects prove the object/event set;
read-only strict preflight additionally confirmed exact Seal/v8 ABI and HTTP
200 health for both the Walrus aggregator and upload relay.

## Preflight results

Final deterministic baselines also passed: `npm run check` (1,019 Web tests,
1,018 passed, 1 intentional skip, 0 failed, plus Vite build), Animacraft Move
116/116, Physical v7 Move 42/42, both Move builds, and `git diff --check`.
The existing Vite large-chunk warning remains non-blocking.

Passed:

```text
npm run preflight:v8-mainnet -- --json
```

This is a strict, networked, required-v8 preflight scoped to the v8 deployment:
deployment tuple, runtime gate, gRPC/GraphQL, Walrus endpoints/tip policy,
exact ABI, TypeOrigins, false gates, and aborting helpers all passed.

The independent full legacy network audit reports the pre-existing core state
above as a mismatch against the deliberately disabled product runtime record.
It does not invalidate this v8 package upgrade or its false bridges, but it must
be reconciled before the next product activation phase. The alert is preserved
rather than suppressed by changing chain or product configuration here.

## Delivery boundary and recovery

- No push or PR occurred.
- No Web/Vercel production deployment occurred.
- The v8 product gate was not enabled.
- No v8 initialization, Seal write, or Walrus write occurred.

Sui package upgrades are irreversible. Recovery remains a fail-closed product
gate plus a separately reviewed roll-forward package. Website wallet testing
requires the next independent activation phase to reconcile legacy state,
initialize the exact v8 object/Seal/Walrus tuple if required, deploy reviewed
runtime configuration, and execute browser/wallet acceptance checks.
