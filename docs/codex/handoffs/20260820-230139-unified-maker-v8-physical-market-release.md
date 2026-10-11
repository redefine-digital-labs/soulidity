# Soulidity Phase Handoff: unified-maker-v8-physical-market-release

## Snapshot

- Created: 2026-08-20T23:01:39+08:00
- Phase: unified-maker-v8-physical-market-release
- Status: complete
- Goal: Close the audited Output/Physical boundaries, implement complete native Physical issuance and custody, and add fresh Market and Release companions that complete the exact MakerRootV8 activation/lifecycle graph
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260820-230139-unified-maker-v8-physical-market-release.md`

## Outcome

Fresh unified Maker v8 now has hardened Output/Physical boundaries, complete Physical issuance/custody, an exact Market activation foundation, and a sole Release activation/lifecycle package on one verified seven-role DAG

## Scope and non-goals

### In scope

- Output/Physical typed boundary corrections and Complete Pack allowlist parity
- Physical FREE_CLAIM, PAID_PURCHASE, Canonical-Soul materialization, Pack policy, exact settlement, replay/supply CAS, transfer and consume
- Market sealed zero-state registry, exact treasury identity, readiness and Maker/Soul quote foundation
- Release-only activation discovery and strict pause/resume/archive lifecycle
- Seven-package integration tests, adversarial probes, TypeOrigin checks and exact package-size gates

### Intentionally not done

- No v4-v7 compatibility, migration or fallback
- No full Market listing/escrow settlement in this phase
- No compiler/recovery/web cutover, GitHub push, Vercel deployment or Mainnet signing/broadcast

## Durable decisions

- The public product is only fresh unified Maker v8; internal packages are seven exact TypeOrigin roles with native capability mask 127
- Output Complete always mints Canonical Soul in the same PTB; Physical has no receipt-only proof mode
- Physical selection identity carries exact Part, Item, Style and Layer Track keys from live Runtime state
- Complete semantic Pack allowlists are capped at 64 in both author and chain contracts
- Release is the sole MakerV8Activated event emitter; Market activation is explicit sealed zero state and does not claim listing support

## Changed paths and assets

### Changed paths

- animacraft/UNIFIED_MAKER_V8.md
- animacraft/maker-v8-document.js
- animacraft/test/maker-v8-document.test.js
- animacraft/move/animacraft_v8_core
- animacraft/move/animacraft_v8_runtime
- animacraft/move/animacraft_v8_output
- animacraft/move/animacraft_v8_physical
- animacraft/move/animacraft_v8_market
- animacraft/move/animacraft_v8_release

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- 3fae184 fix(v8): harden output physical boundaries
- bc51a1d feat(move): add unified maker v8 release
- 85dc41b feat(v8): complete physical issuance package
- 49ef540 feat(move): add unified maker v8 market foundation
- d62bcff chore(move): refresh unified v8 release lock

## Verification

- Seven package warnings-as-errors Move tests: 225/225 PASS
- All seven companion/adversarial runners: PASS
- All seven force-disassembly builds and exact MovePackage::size gates: PASS
- Independent Physical, Market and seven-package integration P0/P1 audits: PASS
- git diff --check and clean integration worktree: PASS

## Risks and recovery

### Risks or blockers

- Core is 63,809/64,000 bytes against its self-imposed target, leaving only 191 bytes target headroom although 38,591 bytes remain under Sui's hard max
- Market listing/escrow/settlement remains intentionally absent until concrete no-ability Output/Physical custody tickets are integrated

### Recovery or rollback points

- Integration branch codex/unified-maker-v8-resume at d62bcffa92eca065dad1bee534c5019c0bf8507f in /Users/naoer/Documents/Claude/Projects/soulidity/tmp/animacraft-unified-v8-resume

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

Start a new bounded phase implementing typed Market listing/escrow/settlement with concrete Output/Physical custody tickets, then align the v8 compiler/recovery and v8-only web cutover
