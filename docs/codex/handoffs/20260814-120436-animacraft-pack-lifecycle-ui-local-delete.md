# Soulidity Phase Handoff: animacraft-pack-lifecycle-ui-local-delete

## Snapshot

- Created: 2026-08-14T12:04:36+08:00
- Phase: animacraft-pack-lifecycle-ui-local-delete
- Status: complete
- Goal: Fix Expansion Pack lifecycle Manage modal stacking and add fail-closed deletion for pure local drafts, then publish and verify production without any Mainnet mutation.
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260814-120436-animacraft-pack-lifecycle-ui-local-delete.md`

## Outcome

Lifecycle Manage now opens above and accessibly suspends its Pack list or Studio origin; only exact pure local-parent drafts expose confirmed revision-CAS deletion. GitHub PR #53 and Vercel production were updated and verified.

## Scope and non-goals

### In scope

- Source-aware modal suspension, focus restoration, busy close guards, and z-index ordering.
- Five-language local draft deletion with identity, wallet, parent, publication/recovery, revision CAS, and post-delete readback guards.

### Intentionally not done

- No lifecycle or other Mainnet transaction was signed or broadcast.
- No compatibility fallback was added for the newly published OCMaker Player regression.

## Durable decisions

- Only parentBinding.kind=local-draft projects with no Release/AdminCap/publication/recovery evidence may be deleted locally.
- The next product architecture is a fresh unified Maker v8 TypeOrigin; old OCMaker/v5/v6/v7 test objects will not be publicly discovered or migrated.

## Changed paths and assets

### Changed paths

- tmp/animacraft-drop-legacy/app.js
- tmp/animacraft-drop-legacy/expansion-pack-lifecycle-i18n.js
- tmp/animacraft-drop-legacy/maker-workspace.js
- tmp/animacraft-drop-legacy/styles.css
- tmp/animacraft-drop-legacy/test/maker-workspace-actions.test.js
- tmp/animacraft-drop-legacy/test/ui-contract.test.js

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- aac90dbc0d1aad7ce7f7b76b3aa11ac43aac024e

## Verification

- Focused lifecycle/delete/a11y suite: 192/192 PASS
- Vite production build PASS
- GitHub PR #53 Repository hygiene, Web production build, Vercel, and Preview checks PASS
- Production deployment dpl_Hs7VUUidRMKyxcBtCNRBx8errPvd READY and promoted to https://animacraft.soulidity.ai PASS
- Production smoke and strict network Expansion Pack v8 preflight PASS

## Risks and recovery

### Risks or blockers

- The newly published test Maker still cannot enter Player because the current product publishes OCMaker while requiring optional Commerce v5 state; this is intentionally deferred to the unified Maker v8 cutover, not hidden by a compatibility bypass.

### Recovery or rollback points

- Rollback Vercel production to dpl_F8etALpXWEmgi2FZCK6ZWVzCLndq if the deployed UI repair regresses.

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

Start a fresh unified Maker v8 phase: design and implement a new animacraft_v8 TypeOrigin and MakerRootV8 with staged DRAFT writes, atomic activation, and v8-only public discovery; do not add a legacy Player fallback.
