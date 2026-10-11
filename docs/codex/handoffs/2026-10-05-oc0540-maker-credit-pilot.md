# Soulidity Phase Handoff: OC 0540 Maker credit pilot

## Snapshot

- Created: 2026-10-05T19:33:27+03:00
- Phase: OC 0540 Maker credit pilot
- Status: complete
- Goal: Deliver one local editable Maker pilot and reusable Krita workflow with credit snapshots
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (46 status entries)
- Handoff: `docs/codex/handoffs/2026-10-05-oc0540-maker-credit-pilot.md`

## Outcome

Created Apricot Atelier from OC 0540: 13 PNGs, 7 groups, layered KRA, current-v8 ZIP and local interactive preview. Corrected hat after user feedback.

## Scope and non-goals

### In scope

- ImageGen plus Krita production, v8 validation, local preview and credit snapshots

### Intentionally not done

- No signing, production changes, or batch manufacturing

## Durable decisions

- Fixed hairstyle and skin tone; one outfit shape in three colors. Eye/mouth are feathered local patches, not isolated line art.

## Changed paths and assets

### Changed paths

- output/maker-credit-pilot-2026-10-05

### Image and binary assets

- output/maker-credit-pilot-2026-10-05/Apricot-Atelier.kra
- output/maker-credit-pilot-2026-10-05/Apricot-Atelier-Maker-v8.zip
- output/maker-credit-pilot-2026-10-05/qa/browser-preview.jpg

### Relevant commits

- No additional commit references recorded.

## Verification

- Current-v8 draft validation, ZIP roundtrip and hashes, 72 local recipe transitions: PASS
- 13 KRA paint layers, 13 PNG dimension and alpha checks, browser transparent output: PASS
- Observed eye/mouth/hat interaction and final default hat visual review: PASS

## Risks and recovery

### Risks or blockers

- Only representative visual combinations reviewed. Production Creator import UI and chain publication untested.
- Account-wide delta 590.2961 credits is not single-Maker attributable cost and may omit delayed billing.

### Recovery or rollback points

- All changes scoped to new output directory. User originals preserved; raw PNGs and prompts retained.

### Working-tree evidence

```text
 M .gitignore
 M CONTEXT.md
 M README.md
 M agent-management/README.md
 M agent-management/foundation/README.md
 M agent-management/foundation/ai-roles/brand-growth.md
 M agent-management/foundation/ai-roles/community.md
 M agent-management/foundation/alex.md
 M agent-management/foundation/ann.md
 M agent-management/foundation/head.md
 M agent-management/foundation/trinity.md
 M agent-management/foundation/wayne.md
 M agent-management/image-prompts.md
 M agent-management/labs/README.md
 M agent-management/labs/ai-roles/backend.md
 M agent-management/labs/ai-roles/cto.md
 M agent-management/labs/ai-roles/frontend.md
 M agent-management/labs/ai-roles/fullstack.md
 M agent-management/labs/ai-roles/pm.md
 M agent-management/labs/hunter.md
 M agent-management/milestones.md
 M agent-management/shared/bd-priorities.md
 M agent-management/shared/context-sync.md
 M agent-management/shared/decision-log.md
 M agent-management/soul-team.html
?? .pnpm-store/
?? AGENTS.md
?? agent-management/EXECUTION_POLICY.md
?? agent-management/LIVE_PRODUCT_STATE.md
?? agent-management/M0_BASELINE.md
?? agent-management/OPERATING_MODEL.md
?? agent-management/agent-registry.json
?? agent-management/creator-registry.json
?? agent-management/creators/
?? agent-management/evidence/
?? agent-management/history/
?? agent-management/roles/
?? agent-management/runs/
?? agent-management/templates/
?? agent-management/workspace.json
... 6 additional status entries omitted
```

## Exact next action

Review the pilot; for a new batch start a new chat with this handoff and fixed target part counts.
