# Soulidity Phase Handoff: animacraft-shared-maker-shell-ui-convergence

## Snapshot

- Created: 2026-08-13T14:51:21+08:00
- Phase: animacraft-shared-maker-shell-ui-convergence
- Status: paused
- Goal: Replace the bespoke Expansion Pack Studio visual structure with the existing shared Maker editor shell and redesign the shared Part list and embedded rule controls for clear narrow-width use
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260813-145121-animacraft-shared-maker-shell-ui-convergence.md`

## Outcome

New implementation phase started from Animacraft b151cea; no source changes integrated yet.

## Scope and non-goals

### In scope

- Literal reuse of the Maker editor shell in Expansion Pack Studio
- Shared Part-list compact structure for Creator and Pack
- Shared compact combination-rule controls

### Intentionally not done

- No Mainnet, Move object, release-gate, wallet, or commerce-policy mutation

## Durable decisions

- Do not visually imitate or fork Maker UI; reuse its shared rendering and CSS contracts
- Remove bespoke Pack merge-preview cards and oversized embedded rule cards

## Changed paths and assets

### Changed paths

- No changed paths recorded.

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- No verification command recorded; treat the phase as unverified.

## Risks and recovery

### Risks or blockers

- Concurrent implementations are isolated and must be reconciled against the same shared renderer contracts

### Recovery or rollback points

- Use the snapshot commit and preserve all uncommitted files shown below.

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

Integrate the shared Part-list and Pack shared-shell implementations, then run behavioral and narrow-width visual verification.
