# Soulidity Phase Handoff: animacraft-creator-expansion-editor-parity

## Snapshot

- Created: 2026-08-13T12:03:49+08:00
- Phase: animacraft-creator-expansion-editor-parity
- Status: paused
- Goal: Unify Expansion Pack Studio with the Maker editor capabilities and polish Part/wardrobe-slot UX while preserving additive overlay and publication safety
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/20260813-120349-animacraft-creator-expansion-editor-parity.md`

## Outcome

New implementation phase started after the v8 wallet pilot; cover publication cascade reproduced and first local fix is in progress, editor-parity audits running

## Scope and non-goals

### In scope

- Expansion Pack Layer Tracks, Smart Color, combination/visibility rules, and composable-slot editing
- Centralize Pack access policy in Commerce & Rights instead of the nested Studio
- Add a Part-row slot shortcut beside preview visibility and reduce left-column crowding
- Preserve the cover publication diagnostic fix and add regression coverage

### Intentionally not done

- Do not change Mainnet package IDs, release gates, Move objects, or wallet claim state

## Durable decisions

- Parent Maker remains immutable and Pack mutations remain additive/namespaced even when the editing UI is shared

## Changed paths and assets

### Changed paths

- tmp/animacraft-drop-legacy/maker-workspace.js
- tmp/animacraft-drop-legacy/maker-workspace-i18n.js
- tmp/animacraft-drop-legacy/test/maker-workspace-actions.test.js
- tmp/animacraft-drop-legacy/test/maker-workspace-i18n.test.js

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- No verification command recorded; treat the phase as unverified.

## Risks and recovery

### Risks or blockers

- The current nested Pack Studio exposes only a subset of the data model, so UI reuse must not accidentally permit parent mutations

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

Finish the capability/data-flow audit, then implement shared Pack editing surfaces and Part-row slot controls with behavioral tests
