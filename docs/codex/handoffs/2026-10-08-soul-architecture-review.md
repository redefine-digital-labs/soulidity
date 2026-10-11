# Soulidity Phase Handoff: soul-architecture-review

## Snapshot

- Created: 2026-10-08T16:43:13+03:00
- Phase: soul-architecture-review
- Status: complete
- Goal: Review current all-contract engineering graph and propose a Soul-centered interoperable boundary; full reconstruction remains incomplete
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (14 status entries)
- Handoff: `docs/codex/handoffs/2026-10-08-soul-architecture-review.md`

## Outcome

Audited 36 production modules and 149 local source references; current DOF tree and proposed dependency boundaries documented. Selectable graph verified at 736/320 px. Three original Slack records updated and read back. No production source changes during this review. Prior Foundation migration draft remains incompletely validated.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No contract restructure this review, no production keys/config/funds/sign/deploy, frontend/live37, commit/push/PR. Root CURRENT unrelated; preserve it.

## Durable decisions

- Proposal: small Soul kernel independent of Maker/Product/economics/Walrus/markets; Composition and applications depend on it. Unimplemented.
- Preserve current site UI, fixedStyle perPart, Ref/Bound/Free, original-ID exit, visual constraints and all responsibilities. AgentPass deferred.

## Changed paths and assets

### Changed paths

- docs/SOUL_ARCHITECTURE_REVIEW_CN.md
- docs/CONTRACT_REBUILD_SPEC_CN.md
- scripts/inspect_contract_dependencies.py
- output/contract-rebuild/soul-architecture-review-2026-10-08

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- 36 current source hashes match; 149 local references resolve PASS
- Diagram 736/320 px: 36 nodes, 15 Soul/14 Runtime refs, no errors or overflow PASS
- Slack14 rows, 3 records/12 fields read back, 9 changed and299 preserved cells PASS

## Risks and recovery

### Risks or blockers

- Suggested architecture, current Core full regressions/ABI/probes/actual product publication/market/funds/security unverified. Independent review absent.

### Recovery or rollback points

- Foundation migration before93 input copies/logs retained. Original23 signed transactions never replay; node stopped. No production mutation.

### Working-tree evidence

```text
?? docs/CONTRACT_REBUILD_COVERAGE.json
?? docs/CONTRACT_REBUILD_SPEC_CN.md
?? docs/CONTRACT_SECURITY_REVIEW_CN.md
?? docs/SOUL_ARCHITECTURE_REVIEW_CN.md
?? docs/codex/
?? move/soulidity_community/
?? move/soulidity_foundation/
?? move/soulidity_v1/
?? move/soulidity_visual/
?? output/
?? scripts/codex/
?? scripts/inspect_contract_dependencies.py
?? scripts/verify_contract_ability_probes.py
?? scripts/verify_contract_publication_budget.py
```

## Exact next action

Define minimal Soul interfaces and provenance/namespace/rights boundaries, then verify independent third-party producer/extension/container prototypes before reconnecting complete Animacraft duties. Do not blindly resume bulk package splitting.

## In-progress Foundation migration, not completed

- economics/revenue moved from Core into Foundation; stable original identity now derives Authority, callable identity uses ProtocolRevision1. Parent UID proof added to ledger new/deposit/withdraw; Product and Config pass private actual parent UID.
- Six Config roles: Native/Release/Creator/Market/Collection/Paid. Four economics writers made public with private business W/R proofs; each production caller registers actual Publisher/UpgradeCap. Do not bulk widen package-only functions.
- New 9 foundation_tests PASS and production Foundation build PASS. Earlier fixture Native origin failures and compiler diagnostics preserved; test-only application bootstrap fixes synthetic dependency addresses. Current Core tests/probes/full publication/upgrade have NOT been rerun. foreign_revenue_withdraw probe still needs its obsolete private-entry expectation adapted to actual UID guard.
- Source inventory currently 28 Core + 3 Foundation +1 Visual +4 Community. Old30 Core181531 size/ABI1125/146/290/key50 and688 tests are historical; no new exact Core size/ABI proof.
- Source may require further redesign following this review. All duties/rights and negative cases survive; suggested interfaces require compiling a real independent package before implementation decisions.
- Full reconstruction not complete. After this review the user explicitly requested a new goal based on the Soul-centered direction. get_goal returned null; create_goal created the full-scope, unbudgeted active goal, recorded in output/contract-rebuild/soul-architecture-review-2026-10-08/goal.json. Independent Soul first, then all original contract duties; no completion claimed.

## Engineering diagram delivery fix

User reported inline visualization Invalid visualization read request. Switched to independent offline H5 /Users/naoer/Documents/Claude/Projects/soulidity/output/soul-contract-map/index.html with current36/149 module graph, current Soul DOF ownership and proposed architecture tabs. Browser1100/736/320 checks PASS, primary selection and all tabs verified; HTTP localhost18764 returns200. Codex open queued. Own preview server exec34222 left live for user; no production server. Preview metadata/browser evidence in that H5 folder. Original inline fragment retained as historical; do not re-emit its failed read directive. Full contract goal remains active; next code action is unchanged: independent standard interfaces and third-party prototype.
