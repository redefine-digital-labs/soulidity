# Soulidity Phase Handoff: Market actual CI and owned creation

## Snapshot

- Created: 2026-10-11T19:32:49+03:00
- Phase: Market actual CI and owned creation
- Status: in-progress
- Goal: Complete the actual Market test CI increment and continue coherent D26 owned-only construction
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (42 status entries)
- Handoff: `docs/codex/handoffs/20261011-market-actual-ci-and-owned-creation.md`

## Outcome

V3 reviewed ten-operation transaction applied to actual soul-market. Actual registered ci.py --product passed44/44;176 production modules;407 prior Core modules plus4 test-only;613 inputs unchanged. This is combined local regression, not standalone release, deployed B0 or full-goal acceptance. Earlier V1/V2 refusals and safe preparation failure retained.

## Scope and non-goals

### In scope

- Full157 responsibilities/30 duties/1528 queue/15 retained units; original behavior and Owners retained.
- Handbook v1.0 sections1-5,7,8.3-8.4,9,12; Operating Model section8; existing DOF-001/P01/P09 records.

### Intentionally not done

- No formal SDK/UI rollout, Git/remote/chain/production action.

## Durable decisions

- Soul key+store; Standard business-free; no platform permission.
- Frozen module.json pending fields predate activation; actual registered receipt proves local CI only.

## Changed paths and assets

### Changed paths

- /Users/naoer/Documents/Claude/Projects/soulidity-ecosystem/soul-market: three docs, module.json, two CI inputs, four owning tests.

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Actual registered CI44/44;176/407+4 modules;613 inputs unchanged;zero chain transactions: PASS
- Independent V3 result06c741398e79bbea5bf08fe7b2cb826e91f6f97dc62ab5cbb654bd597fd7abf4;25 candidate/20 Root controls: PASS

## Risks and recovery

### Risks or blockers

- D26 Standard raw fresh Soul return and fresh Kiosk continuation remain open.
- Hosted CI, independent releases, Native/Core ownership, deployed B0 and published authority migration pending.

### Recovery or rollback points

- Restore CURRENT v3 to bbde612 before H3 Market rollback; then CURRENT v2/v1 before original138 source rollback. Unknown edits refuse.

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

Implement neutral Creation and closed native-custody construction across real producers and fixtures; preserve source obligations and existing handovers.
