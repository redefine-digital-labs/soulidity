# Soulidity Phase Handoff: animacraft-expansion-pack-v8-mainnet-upgrade

## Snapshot

- Created: 2026-08-12T08:58:18+08:00
- Phase: animacraft-expansion-pack-v8-mainnet-upgrade
- Status: complete
- Goal: Freeze and commit reviewed Expansion Pack v8 source, complete a controlled Sui Mainnet upgrade after exact user approval, and preserve complete readback evidence while every product and bridge gate remains disabled.
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260812-085818-animacraft-expansion-pack-v8-mainnet-upgrade.md`

## Outcome

Expansion Pack v8 source was frozen in two auditable commits, upgraded once on Sui Mainnet, read back at transaction 2ef2pUjBBuhGDTuzVHZwo3ZkqgkqzUc6A2mNnjZeLLTF and checkpoint 309641036, recorded as callable and TypeOrigin package 0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a, and verified by full Web and Move baselines plus strict networked required-v8 preflight with the v8, Complete and physical gates false.

## Scope and non-goals

### In scope

- Reviewed and froze the 45-path v8 implementation plus two release-safety fixes.
- Completed deterministic Web, Move, build, ABI, TypeOrigin and fail-closed gate baselines.
- Completed package-size rehearsal, exact Mainnet dry-run, pre-sign lock, one approved signature and one approved broadcast.
- Read back transaction, checkpoint, package, UpgradeCap, TypeOrigins, ABI, events, object effects, Seal and Walrus zero-write evidence.
- Recorded the fully evidenced gate-false v8 deployment tuple and a strict v8-only Mainnet preflight command.

### Intentionally not done

- No product release gate activation, v8 business-object initialization, Seal write, Walrus write, Web or Vercel deployment, push or pull request occurred.
- Website wallet testing and product activation are intentionally deferred to the next independent phase.

## Durable decisions

- The deployed package source is commit 59cae42a8602f54a7b7902aee77971a1dff8a270 and tree 794b18902c5d758889baf80431a3f99f59e4a8aa; the later c836ddee43c734149a483f069801c6667f300735 commit contains evidence and preflight changes, not different deployed Move bytecode.
- Actual callable and all new v8 or Complete TypeOrigins are 0x4b7109b4780c91ec528cced9fd77f4ed9dad4cb462484c74f100f1ed7f309c7a; the product primary callable remains v4 0x2221610b5513ef3f926433229b7f0b565e850d56020e344266737cdca078af3b.
- Sui upgraded-package function ABI uses the original lineage namespace while datatype definingId carries TypeOrigin; preflight now verifies these independently.
- Mainnet transaction AVYsGvyfgSVFQ8mrQWXCpNbNzwDcPc4BboegLsetSYXT had already activated v4, Commerce v5, Composition v6 and Soulidity market state before this phase; observedChainState records that fact separately while all product runtime gates remain false.
- The prior source-readiness handoff remains docs/codex/handoffs/20260812-035848-animacraft-expansion-pack-v8-source-readiness.md.

## Changed paths and assets

### Changed paths

- tmp/animacraft-drop-legacy/deployments/mainnet.json
- tmp/animacraft-drop-legacy/move/animacraft/Published.toml
- tmp/animacraft-drop-legacy/package.json
- tmp/animacraft-drop-legacy/public/config.js
- tmp/animacraft-drop-legacy/runtime-config.js
- tmp/animacraft-drop-legacy/scripts/mainnet-preflight.mjs
- tmp/animacraft-drop-legacy/test/deployment-record.test.js
- tmp/animacraft-drop-legacy/test/mainnet-preflight-v8.test.js
- tmp/animacraft-drop-legacy/test/runtime-config.test.js
- docs/codex/assets/animacraft-expansion-pack-v8-mainnet-upgrade/mainnet-upgrade-dry-run.md
- docs/codex/assets/animacraft-expansion-pack-v8-mainnet-upgrade/mainnet-upgrade-v8-actual-readback.md
- docs/codex/assets/animacraft-expansion-pack-v8-mainnet-upgrade/mainnet-upgrade-v8-actual-readback.json
- docs/codex/assets/animacraft-expansion-pack-v8-mainnet-upgrade/strict-required-v8-preflight.json
- docs/codex/assets/animacraft-expansion-pack-v8-mainnet-upgrade/full-network-legacy-state-alert.json

### Image and binary assets

- docs/codex/assets/animacraft-expansion-pack-v8-mainnet-upgrade/mainnet-upgrade-v8-unsigned.b64
- docs/codex/assets/animacraft-expansion-pack-v8-mainnet-upgrade/mainnet-upgrade-v8-unsigned-manifest.json
- docs/codex/assets/animacraft-expansion-pack-v8-mainnet-upgrade/mainnet-upgrade-v8-signature.json

### Relevant commits

- 3f0553382eba922936ab4dafd4affb8092ca1e9e
- 59cae42a8602f54a7b7902aee77971a1dff8a270
- c836ddee43c734149a483f069801c6667f300735

## Verification

- npm run check: 1019 Web tests total, 1018 passed, 1 skipped, 0 failed, and Vite build passed. PASS
- npm run move:test: Animacraft 116 of 116 and Physical v7 42 of 42 passed. PASS
- npm run move:build: both Move packages passed. PASS
- npm run preflight:v8-mainnet -- --json: strict networked required-v8 tuple, gRPC, GraphQL, Walrus, ABI, TypeOrigin and false-gate checks passed. PASS
- Independent final nine-file diff review found no P0, P1 or P2 findings. PASS
- git diff --check passed and nested worktree is clean after commit. PASS

## Risks and recovery

### Risks or blockers

- The product website still has expansionPackV8ReleaseEnabled false and was not deployed, so users cannot wallet-test v8 until the next activation phase.
- The full legacy network audit reports pre-existing activated v4 or v5 or v6 chain objects against intentionally disabled product runtime; exact evidence is in full-network-legacy-state-alert.json and must be reconciled before activation.
- No v8 Release, AdminCap, Treasury, Pass, event, Seal policy or Walrus Blob was created by the package-only upgrade; those writes, if required for wallet testing, need exact per-write review in the activation phase.

### Recovery or rollback points

- Keep the product primary callable at v4 and every product, Complete and physical gate false; no Web deployment means current users remain on the pre-v8 product path.
- The Sui package upgrade is irreversible; preserve UpgradeCap version 955119810 and use only a separately reviewed roll-forward if package correction is ever needed.

### Working-tree evidence

```text
 M .gitignore
 M CONTEXT.md
 M README.md
?? .pnpm-store/
?? AGENTS.md
?? clawnews/
?? docs/
?? live-portrait.html
?? scripts/
```

## Exact next action

Start a new manage-soulidity-phases task for phase animacraft-expansion-pack-v8-wallet-test-activation using this handoff only; reconcile the recorded pre-existing core chain state with disabled product runtime, determine the exact v8 object, Seal, Walrus and Web or Vercel activation tuple, then perform each exact write only under the required approval boundary and complete browser wallet acceptance testing.
