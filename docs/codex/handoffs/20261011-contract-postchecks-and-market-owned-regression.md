# Soulidity Phase Handoff: Contract postchecks and Market owning regressions

## Snapshot

- Created: 2026-10-11T18:41:39+03:00
- Phase: Contract postchecks and Market owning regressions
- Status: in-progress
- Goal: Complete contract module separation and interoperable authority boundaries while preserving the full original product scope
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (42 status entries)
- Handoff: `docs/codex/handoffs/20261011-contract-postchecks-and-market-owned-regression.md`

## Outcome

Applied-source postchecks independently accepted: 1390 actual tests, ten production builds and 19 exact module comparisons. Frozen isolated Market transport independently accepted 44/44, unchanged609 actual inputs and407 prior compiled modules. Actual Market test/CI activation remains pending. Contract-only phase; formal SDK/UI rollout is later.

## Scope and non-goals

### In scope

- Preserve original157 responsibilities,30 duties,1528 queue and15 retained units, existing Owners, roadmap, Delivery/DEV/BUG and primary CURRENT.

### Intentionally not done

- Formal SDK migration, original page wiring and complete product UI journeys are later integration work, not current contract exit conditions.

## Durable decisions

- Minimal unsigned callers/PTBs remain contract verification tools. Collection contract revision guards must be tested; no formal SDK or UI activation is required.
- Soul remains an owned minimal key+store asset; generic Maker remains Soul/Channel-free, optional adapters separate.

## Changed paths and assets

### Changed paths

- /Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity/output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/coherent-owning-source-actual-activation-v1
- /Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity/output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/market-owned-regression-transport-readonly-review-v1
- /Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity/output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/market-owned-regression-transport-v1

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Applied-source read-only review result19b23491:1390 tests/10 production/19 module comparisons PASS.
- Market independent result425de9b1, terminal1ce1b347:44/44 scoped PASS;609 inputs unchanged;407 modules exact plus4 test-only.

## Risks and recovery

### Risks or blockers

- Actual Market owning test and CI registration remain unactivated; isolated transport is not standalone Market CI. Transitional Native/Core domains still need independent release boundaries.
- Published identity/authority migration, deployed B0, transaction creation/auth/settlement/exit/pause/recovery, hosted CI and independent releases remain incomplete. Full goal is not complete.
- Latest public backup is Integration d372b737; new combined source/replay/Market evidence not publicly backed up. No Git or chain operation in this continuation.

### Recovery or rollback points

- CURRENT v2 must restore to v1 2c461 before v1 helper restores b87; only then use reviewed source-CAS rollback. Frozen ledgers remain unchanged; unexpected edits refuse.

### Working-tree evidence

```text
 T packages/soulidity-sdk/src/chain-event-discovery.ts
 T packages/soulidity-sdk/src/chain-object-discovery.ts
 T packages/soulidity-sdk/src/coin-selection.ts
 T packages/soulidity-sdk/src/format.ts
 T packages/soulidity-sdk/src/object-inputs.ts
 T packages/soulidity-sdk/src/profile-read-step.ts
 T packages/soulidity-sdk/src/request.ts
 T packages/soulidity-sdk/src/sui-grpc-compat.ts
 T packages/soulidity-sdk/src/sui-network.ts
 T packages/soulidity-sdk/src/tx-result.ts
?? docs/CONTRACT_REBUILD_COVERAGE.json
?? docs/CONTRACT_REBUILD_SPEC_CN.md
?? docs/CONTRACT_SECURITY_REVIEW_CN.md
?? docs/SOUL_ARCHITECTURE_REVIEW_CN.md
?? docs/SOUL_STANDARD_KERNEL_CN.md
?? docs/codex/
?? docs/ecosystem-construction/
?? move/foreign_soul/
?? move/private_source/
?? move/soulidity_application/
?? move/soulidity_community
?? move/soulidity_content/
?? move/soulidity_custody/
?? move/soulidity_foundation/
?? move/soulidity_model
?? move/soulidity_native/
?? move/soulidity_native_binder/
?? move/soulidity_origin_protocol/
?? move/soulidity_standard
?? move/soulidity_v1/
?? move/soulidity_visual
?? move/standard_examples/
?? output/
?? scripts/codex/
?? scripts/ecosystem/
?? scripts/inspect_contract_dependencies.py
?? scripts/profile_move_function_trace.py
?? scripts/verify_contract_ability_batches.py
?? scripts/verify_contract_ability_probes.py
?? scripts/verify_contract_publication_budget.py
... 2 additional status entries omitted
```

## Exact next action

Activate the reviewed Market owning test transport and reproducible consumer regression gate with exact source guards; then finish independent contract package/release and published authority/type/object/Config/legacy migration and deployed B0 checks.
