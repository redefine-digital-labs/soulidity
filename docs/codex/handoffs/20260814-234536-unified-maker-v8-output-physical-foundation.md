# Soulidity Phase Handoff: unified-maker-v8-output-physical-foundation

## Snapshot

- Created: 2026-08-14T23:45:36+08:00
- Phase: unified-maker-v8-output-physical-foundation
- Status: complete
- Goal: Integrate the fresh unified Maker v8 Output package and the fail-closed Physical activation registry against the hardened Core, Seal, and Runtime DAG
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260814-234536-unified-maker-v8-output-physical-foundation.md`

## Outcome

Multi-output Complete, Canonical Soul, exact Seal/Runtime/Physical witnesses, and the immutable Physical base-policy activation registry are integrated and verified

## Scope and non-goals

### In scope

- Multi-output OutputPolicy rows and Complete settlement
- Canonical Soul and exact Physical materialization witness
- Physical package config, immutable Base Style policies, zero-state readiness, and external boundary probes

### Intentionally not done

- No Market, Release, compiler cutover, public web cutover, Mainnet signing, GitHub push, or Vercel deploy in this checkpoint

## Durable decisions

- No v4-v7 import, compatibility, migration, or fallback is permitted
- Output player Pack selection remains runtime-derived; author rows freeze only ALL_ADMITTED or sorted semantic allowlists
- Physical activation binds live sealed Core Style rows and proves all future mutable issuance/Pack/treasury/replay lanes exactly zero

## Changed paths and assets

### Changed paths

- animacraft/move/animacraft_v8_output
- animacraft/move/animacraft_v8_physical
- animacraft/move/animacraft_v8_runtime

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- 918333d feat(move): add maker v8 physical registry (primary integrated tip)
- f8d11b7 feat(move): add unified maker v8 output
- a9efa0c feat(move): certify current physical selections

## Verification

- Integrated Output sui move test --warnings-are-errors: 36/36 PASS
- Integrated Physical sui move test --warnings-are-errors: 15/15 PASS
- Output and Physical positive companion/adversarial probes: PASS
- Output MovePackage::size 28,676 bytes under target: PASS
- Physical MovePackage::size 10,497 bytes under target: PASS

## Risks and recovery

### Risks or blockers

- Physical currently stops at activation registry/readiness; issuance, mutable Pack policy, custody, Market, and Release are not yet implemented
- Independent final Output audit is still running at this checkpoint

### Recovery or rollback points

- Primary integration worktree /private/tmp/animacraft-unified-maker-v8 branch codex/unified-maker-v8 at 918333d

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

Finish Physical claim/purchase/materialization and holder-safe custody using Output's exact witness, then implement Market and Release
