# Soulidity Phase Handoff: animacraft-expansion-pack-v8-source-readiness

## Snapshot

- Created: 2026-08-12T03:58:48+08:00
- Phase: animacraft-expansion-pack-v8-source-readiness
- Status: complete
- Goal: Finish Expansion Pack v8 as an independent, inherited child Maker release with recoverable Walrus/Sui publication, exact parent and Seal evidence, verified Player acquisition, and fail-closed Mainnet activation.
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260812-035848-animacraft-expansion-pack-v8-source-readiness.md`

## Outcome

Expansion Pack v8 source readiness is complete in the existing Animacraft worktree. Creator, recovery, Move, paid Seal, Player, lifecycle, parent evidence, docs/i18n, autosave, and exact ABI preflight are implemented and fully tested; no P0/P1 remains. Mainnet package IDs and release gate intentionally remain empty/off.

## Scope and non-goals

### In scope

- Independent ExpansionPackReleaseV8 child release bound to one exact parent Maker release/version/manifest.
- Pack Studio inheritance contract, additive Part/Item/Style editing, autosave flush, and four-step recoverable publication UX.
- Walrus encryption/upload/certification recovery plus Sui create, manifest bind, Style registry, Seal policy, parent admission, activation, lifecycle, purchase, and treasury operations.
- Verified Player discovery, exact-release session pins, free claim, paid purchase, Seal decryption, overlay merge, and fail-closed acquisition policy.
- Exact parent Maker release evidence, distinct legacy/Commerce/v8 TypeOrigins, and full ordered Move ABI/visibility/entry readback.
- Five-language docs/UI, recovery states, and production preflight coverage.

### Intentionally not done

- No Mainnet package upgrade, initialization, gate activation, Walrus upload, wallet signature, or other network write in this phase.
- No commit, push, pull request, or Vercel production deployment in this phase.
- Expansion Pack Complete-to-Soulidity remains deliberately fail-closed until its separate reviewed adapter/protocol phase.

## Durable decisions

- Expansion Packs are independent child releases, not embedded mutable rows and not nested Makers; each inherits a deep-frozen parent contract and contributes only additive overlays.
- Published Pack identity pins wallet, parent root/release/version/manifest, Pack ID/version, content commitment, Walrus evidence, Sui object, and stable TypeOrigin.
- Paid Pack artwork is encrypted before Walrus and gated by exact wallet Pass plus release-scoped Seal proof; public server policy is checked before payment without persisting credentials.
- MakerRootV5 layout remains unchanged; bind-once MakerReleaseEvidenceV5 is stored as a dynamic field and exact retries are idempotent.
- Legacy OCMaker, Commerce v5, and Expansion Pack v8 datatypes retain separate defining IDs; Mainnet preflight verifies every parameter/reference/generic/return plus visibility and entry status.
- Current Mainnet Expansion Pack v8 tuple stays intentionally empty and expansionPackV8ReleaseEnabled stays false until a separate evidence ceremony succeeds.

## Changed paths and assets

### Changed paths

- tmp/animacraft-drop-legacy/app.js
- tmp/animacraft-drop-legacy/chain-runtime.js
- tmp/animacraft-drop-legacy/expansion-pack-publication.js
- tmp/animacraft-drop-legacy/expansion-pack-publication-recovery.js
- tmp/animacraft-drop-legacy/expansion-pack-publication-controller.js
- tmp/animacraft-drop-legacy/expansion-pack-publication-store.js
- tmp/animacraft-drop-legacy/expansion-pack-publication-v8-app.js
- tmp/animacraft-drop-legacy/expansion-pack-player-v8.js
- tmp/animacraft-drop-legacy/expansion-pack-project.js
- tmp/animacraft-drop-legacy/expansion-pack-workspace.js
- tmp/animacraft-drop-legacy/maker-workspace.js
- tmp/animacraft-drop-legacy/maker-workspace-i18n.js
- tmp/animacraft-drop-legacy/maker-seal-v5.js
- tmp/animacraft-drop-legacy/move/animacraft/sources/commerce_v5.move
- tmp/animacraft-drop-legacy/move/animacraft/sources/expansion_pack_v8.move
- tmp/animacraft-drop-legacy/move/animacraft/sources/expansion_pack_complete_v8.move
- tmp/animacraft-drop-legacy/scripts/mainnet-preflight.mjs
- tmp/animacraft-drop-legacy/docs-center-content.js
- tmp/animacraft-drop-legacy/test

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- Animacraft worktree codex/composable-wardrobe-v7 at base 2c7d5b514e81b8928fa105bb7c123ec276f094f1; phase changes remain uncommitted.

## Verification

- npm run check; Node tests 1015 passed, 0 failed, 1 skipped; Vite production build — PASS
- npm run move:test; Animacraft 116/116 and Physical v7 42/42 — PASS
- npm run move:build for Animacraft and Physical v7 — PASS
- node --test test/mainnet-preflight-v8.test.js; 10/10 including distinct TypeOrigins, all ordered types, generics, returns, visibility, and entry drift — PASS
- npm run preflight:config with Expansion Pack v8 intentionally disabled — PASS
- Strict required-v8 preflight exited 1 only for the intentionally missing undeployed IDs and release/readback evidence — PASS
- git diff --check — PASS
- Fresh read-only final audit found no remaining P0/P1 after exact ABI and TypeOrigin fixes — PASS

## Risks and recovery

### Risks or blockers

- The Animacraft worktree is intentionally dirty with 45 tracked/untracked status entries and has not been committed or reviewed as a Git changeset.
- Expansion Pack v8 is not deployed; callable and TypeOrigin IDs plus upgrade evidence are empty, so strict required-v8 preflight correctly fails.
- No live Mainnet package ABI/object/event/Seal/Walrus readback has occurred in this phase.
- Complete-to-Soulidity and physical bridges remain explicitly disabled until a separate protocol integration is reviewed.
- Vite reports a non-blocking large-chunk warning for the main bundle at about 2.734 MB / 768 KB gzip.

### Recovery or rollback points

- Resume from /Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-drop-legacy on branch codex/composable-wardrobe-v7, base HEAD 2c7d5b514e81b8928fa105bb7c123ec276f094f1.
- Mainnet is unchanged: expansionPackV8CallablePackageId and expansionPackV8TypeOriginPackageId are empty and expansionPackV8ReleaseEnabled is false in public/config.js, runtime-config.js, and deployments/mainnet.json.

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

Start a separate gated Mainnet v8 upgrade ceremony: freeze and commit the reviewed source, dry-run the package upgrade, capture callable/TypeOrigin/transaction/checkpoint/source-tree/package-digest/readback evidence, populate the deployment tuple while the release gate stays false, rerun strict network preflight, and only then review activation.
