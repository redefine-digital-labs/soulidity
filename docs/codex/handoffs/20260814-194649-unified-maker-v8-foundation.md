# Soulidity Phase Handoff: unified-maker-v8-foundation

## Snapshot

- Created: 2026-08-14T19:46:49+08:00
- Phase: unified-maker-v8-foundation
- Status: complete
- Goal: Freeze and integrate the exact v8-only author, Commerce, compiler boundary, and hardened fresh Maker v8 Core package.
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260814-194649-unified-maker-v8-foundation.md`

## Outcome

The v8-only document/Commerce/compiler boundary is fail-closed and committed; the independently audited Core package chain is integrated and passes 46 Move tests, positive companion compilation, adversarial probes, and exact package-size measurement.

## Scope and non-goals

### In scope

- Exact animacraft.maker.v8 author schema and strict input snapshot boundary
- Independent Base and Expansion Pack Commerce v8 models with exact BigInt settlement
- Compiler primitives, capability mask 127, and explicit zero-Physical activation plan
- Fresh animacraft_v8_core package, protocol catalog, typed witnesses, successor CAS, and rights evidence

### Intentionally not done

- No public UI/runtime cutover in this phase
- No Mainnet signing, broadcasting, package publish, GitHub push, or Vercel deployment

## Durable decisions

- No OCMaker/v4/v5/v6/v7 compatibility, migration, fallback, or public discovery path.
- Public product identity is one unified Maker v8; internal packages may split by role.
- All seven capabilities are native and required; mask is 127.
- Core catalog is ProtocolAdmin-governed; Release is the sole activation emitter.

## Changed paths and assets

### Changed paths

- animacraft/UNIFIED_MAKER_V8.md
- animacraft/maker-v8-document.js
- animacraft/maker-commerce-v8.js
- animacraft/maker-v8-compiler.js
- animacraft/move/animacraft_v8_core
- animacraft/test/maker-v8-document.test.js
- animacraft/test/maker-commerce-v8.test.js
- animacraft/test/maker-v8-compiler.test.js

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- 42761a7 fix(v8): lock author commerce compiler boundaries
- bc37967 feat(move): split animacraft v8 core package
- 80a8d4d fix(move): harden animacraft v8 core contracts
- 2379a56 fix(move): close maker v8 core authority gaps
- 1400750 fix(move): freeze control with successor authority

## Verification

- node --test test/maker-commerce-v8.test.js test/maker-v8-document.test.js test/maker-v8-compiler.test.js => 39/39 PASS
- sui move test --warnings-are-errors in move/animacraft_v8_core => 46/46 PASS
- positive companion compile plus all adversarial probes PASS
- MovePackage::size 38,383 bytes under 45,000-byte target PASS
- node --check and git diff --check PASS

## Risks and recovery

### Risks or blockers

- Companion package ABI and compiler call-plan parity are not yet implemented or audited.
- No GitHub/Vercel/Mainnet release has occurred; production still runs the prior product.

### Recovery or rollback points

- Primary implementation worktree is /private/tmp/animacraft-unified-maker-v8 on branch codex/unified-maker-v8 at commit 1400750.

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

Implement the mandatory Seal, Runtime, Output, Physical, Market, and Release companion package DAG against Core commit 1400750, with no legacy imports or compatibility paths.
