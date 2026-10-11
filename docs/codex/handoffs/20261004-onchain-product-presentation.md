# Soulidity Phase Handoff: onchain-product-presentation

## Snapshot

- Created: 2026-10-04T09:36:36+03:00
- Phase: onchain-product-presentation
- Status: complete
- Goal: Present Soulidity as an onchain OC ecosystem with explicit architecture scope, problem mapping and evidence boundaries
- Worktree: `/Users/naoer/Documents/Claude/Projects/soulidity`
- Branch: `codex/maker-editor-p0`
- Commit: `40dc2ce5ee568be1950f9d6b36eff11165dd49e4`
- Working tree: dirty (46 status entries)
- Handoff: `docs/codex/handoffs/20261004-onchain-product-presentation.md`

## Outcome

Inline comparison source: `/Users/naoer/.codex/visualizations/2026/10/04/01a10587-670b-7b00-a5a1-5d28bd41d8a1/soulidity-problem-map.html`. Source/export hashes and verification record: `docs/diagrams/soulidity-framework/render-manifest.json`. The earlier three diagrams are unchanged; the onchain overview is newly rendered. The platform baseline in the comparison is a schematic architecture model, not a survey of all Web2 products.

Updated the existing product document, repository introduction and ecosystem entry. Added a fourth onchain overview diagram and a five-stage interactive comparison. Preserved product scope and separated unverified first-of-kind status from supported architecture claims. Refreshed local delivery snapshot to F02-L activation success with public discovery/rendering still incomplete.

## Scope and non-goals

### In scope

- Product narrative, architecture diagrams, inline explanation and documentation continuity

### Intentionally not done

- No product code, signatures, deployments, commits, push, PR or public publishing

## Durable decisions

- Full onchain describes core business authority and rules; content is decentralized and editing/rendering/inference remain in clients/runtimes. Global-first status remains unverified.

## Changed paths and assets

### Changed paths

- docs/SOULIDITY_PROBLEM_PRODUCT_ARCHITECTURE_CN.md
- README.md
- docs/SOULIDITY_ECOSYSTEM_CN.md
- docs/codex/PROJECT_MEMORY.md
- docs/diagrams/soulidity-framework
- docs/codex/CURRENT.md

### Image and binary assets

- docs/diagrams/soulidity-framework/onchain-model.svg
- docs/diagrams/soulidity-framework/onchain-model.png

### Relevant commits

- No additional commit references recorded.

## Verification

- 22 local links resolve; four diagram sources match eight valid exports; source/export manifest updated: PASS
- Eight interactive comparisons at 760/360/320px, five stages each, no overflow or page errors: PASS
- Visual review, explicit first-claim and execution boundaries, memory size and git whitespace: PASS

## Risks and recovery

### Risks or blockers

- Two adjacent-project sources establish only partial precedents, not a full competitor survey. Product progress is a dated local record, not new chain verification.

### Recovery or rollback points

- Reversible documentation and visualization edits; prior phase handoff retained and active product execution untouched.

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

Use docs/SOULIDITY_PROBLEM_PRODUCT_ARCHITECTURE_CN.md as the Chinese product presentation; keep dynamic release status sourced from active AC CURRENT and verify first-of-kind claims separately before asserting them.
