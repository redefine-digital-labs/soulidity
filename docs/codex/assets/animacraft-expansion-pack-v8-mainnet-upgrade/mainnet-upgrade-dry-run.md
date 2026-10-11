# Expansion Pack v8 Mainnet upgrade dry-run evidence

- Phase: `animacraft-expansion-pack-v8-mainnet-upgrade`
- Recorded at: `2026-08-12T08:15:54+08:00` (`2026-08-12T00:15:54Z`)
- Evidence status: immutable pre-write dry-run record; no signature or write was performed during this record
- Subsequent authorized result: see `mainnet-upgrade-v8-actual-readback.md`
- Source worktree: `/Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-drop-legacy`
- Source branch: `codex/composable-wardrobe-v7`

## Frozen source

- Reviewed v8 source commit: `3f0553382eba922936ab4dafd4affb8092ca1e9e`
- Reviewed v8 source tree: `621fba5a6289545b89f2bc22002cc19683cb9170`
- Mainnet package-size follow-up commit: `59cae42a8602f54a7b7902aee77971a1dff8a270`
- Exact final dry-run source tree: `794b18902c5d758889baf80431a3f99f59e4a8aa`
- Final worktree status before build and dry-run: clean
- No source commit was pushed and no PR was opened.

The follow-up removed nine unused public read accessors from the disabled
`expansion_pack_complete_v8` provenance adapter. The provenance datatype,
TypeOrigin checks, authorization/binding ABI, Complete gate, physical gate, and
their fail-closed simulations remain covered. Production module bytecode fell
from 92,877 bytes to 92,434 bytes.

## Deterministic verification

- `node --test test/mainnet-preflight-v8.test.js`: 11/11 passed
- `npm run move:test`: Animacraft 116/116 and Physical v7 42/42 passed
- `npm run move:build`: both Move packages passed
- `npm run check`: 1,018 Web tests, 1,017 passed, 1 intentionally skipped, 0 failed; config preflight and Vite build passed
- `git diff --check`: passed
- Remaining build note: the existing Vite large-chunk warning is non-blocking.

## Network and authority readback

- Sui CLI: `1.76.1-homebrew`
- Active environment: `mainnet`
- RPC: `https://fullnode.mainnet.sui.io:443`
- Chain identifier: `35834a8a`
- CLI active address: `0x31adec2ab07a413292be92e0ba5280f26ca13be7efa086b25d7dd7979e8691d9`
- Explicit proposed sender / UpgradeCap owner: `0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f`
- Local public key alias for the explicit sender: `hardcore-beryl` (`ed25519`)
- Sender SUI address balance: `20,772,928,309 MIST` (`20.772928309 SUI`)
- UpgradeCap: `0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520`
- UpgradeCap object version: `955119809`
- UpgradeCap object digest: `cTsChuWJG2jMnXJSET8irKZCBNKGXsvS4BjeFkftyoK`
- UpgradeCap policy: compatible (`0`)
- Current chain package controlled by the cap: `0x3863f5c037d6f8827e0e2401eebb6d0f91ff95f394f5f1c9376a3f4c87b6ce84`, package version `5`
- Runtime/deployment primary callable remains deliberately pinned to v4: `0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b`

The sender uses Sui address-balance gas. The CLI dry-run represents this with
the synthetic gas object `0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff`;
there is no separately selected legacy gas coin.

## Exact package digest

- Digest bytes: `[5,86,234,158,170,119,31,5,116,56,142,11,167,253,116,124,51,80,58,164,72,76,200,89,226,105,153,169,119,98,107,180]`
- Hex: `0x0556ea9eaa771f0574388e0ba7fd747c33503aa4484cc859e26999a977626bb4`
- Base58: `Mquf4qbGQ5nFAJhS8MyzGZZbK6bgAnxqUF4jQVdA7kw`
- Modules: `animacraft`, `commerce_v5`, `composition_v6`, `expansion_pack_complete_v8`, `expansion_pack_v8`, `seal_v5`
- Dependencies: framework packages `0x1` and `0x2`

## Dry-run history

The first frozen candidate failed safely during simulation with
`MovePackageTooBig { object_size: 102581, max_object_size: 102400 }`. It was
181 bytes over the Mainnet limit. No signature or write occurred. The minimal
package-size follow-up above was then committed and all deterministic baselines
were rerun.

The final exact proposed-parameter dry-run command was:

```text
sui client upgrade move/animacraft \
  --upgrade-capability 0xe7d1269532bbfbf5e448cb5c58f07fc6720ed3d22e7853e9f13b7b6282746520 \
  --verify-deps \
  --force \
  --sender 0xadea1910ac0e738dc020247bc5408b57b15f3701026a96098b716a35c3a6c52f \
  --gas-price 100 \
  --gas-budget 1500000000 \
  --dry-run \
  --json
```

Final dry-run result:

- Status: success
- Simulated epoch: `1217`
- Simulated transaction digest: `Cs7rwQemkWW3EFSYGSKjTdyGEUPPBiRKcdzvXacy9khV`
- Expected callable package: `0xd5e1f04490823d230273d2e29e156f607f5d1bbb9b6c9ed75535b84701b21216`
- Expected TypeOrigin for newly introduced v8 types: `0xd5e1f04490823d230273d2e29e156f607f5d1bbb9b6c9ed75535b84701b21216`
- Expected package version: `6`
- Simulated package object digest: `ANrNAATWb8PRV9cbQZsQtnTyie45sie6xD2CCVXLJHRG`
- Computation cost: `863,000 MIST`
- Storage cost: `779,486,400 MIST`
- Storage rebate: `1,617,660 MIST`
- Non-refundable storage fee: `16,340 MIST`
- Net simulated balance change: `-778,731,740 MIST` (`-0.778731740 SUI`)
- Proposed budget: `1,500,000,000 MIST` (`1.5 SUI`)
- Proposed gas price: `100 MIST`
- Events: none
- Execution error: none
- Simulated UpgradeCap next version: `955119810`

The package ID and transaction digest above are simulation expectations. They
must be recomputed if any source, transaction parameter, UpgradeCap version, gas
state, epoch-dependent transaction input, or sender state changes before the
approved write.

## Gate and configuration boundary

- `expansionPackV8ReleaseEnabled=false` in `public/config.js`, `runtime-config.js`, and `deployments/mainnet.json`.
- Canonical Soul / Complete-to-Soulidity remains disabled.
- The physical release gate and the v8 physical bridge remain disabled.
- The Move read functions simulate Complete and physical gates as false; both bridge assertion helpers abort; `companion_proof_available_v8` is false.
- No Web/Vercel deployment occurred.
- No Walrus or Seal write occurred.

After an approved successful upgrade, the repository-only evidence update will
populate the v8 callable/TypeOrigin pair and the complete
`releases.expansionPackV8` / verification tuple from actual chain readback while
keeping every release and bridge gate false. It will not deploy Web production
configuration.

## Authorized write and recovery point

After a fresh read-only lock confirmed the exact chain, RPC, sender, balance,
UpgradeCap version/digest/owner, source commit/tree, package digest, unsigned
TransactionData, and simulated effects, the user explicitly approved one
Mainnet upgrade. The address-balance transaction was signed once and broadcast
once. It succeeded as transaction
`2ef2pUjBBuhGDTuzVHZwo3ZkqgkqzUc6A2mNnjZeLLTF`; authoritative effects and
the actual package `0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a`
are recorded in `mainnet-upgrade-v8-actual-readback.md` and JSON.

Sui package upgrades are irreversible. The recovery plan is therefore:

1. keep the product gate, Complete bridge, and physical bridge false;
2. do not publish any Web configuration or onboard v8 objects;
3. preserve current package v5 and runtime v4 evidence as the recovery point;
4. if post-upgrade readback diverges, stop before filling a success tuple and use a separately reviewed roll-forward upgrade.
