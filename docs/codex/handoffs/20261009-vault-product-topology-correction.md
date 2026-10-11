# Soulidity Phase Handoff: vault-product-topology-correction

## Snapshot

- Created: 2026-10-09T13:41:41+03:00
- Phase: vault-product-topology-correction
- Status: in-progress
- Goal: Continue unchanged full all-contract goal; correct Vault to a Soul DOF functional tool for funds/assets and private content, AgentPass deferred
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-vault-product-topology-correction.md`

## Outcome

User rejects shared Vault -> Soul product model. Correct Soul -> DOF -> Vault tool; funds/assets and private content both required with separated permissions, AgentPass later. Existing895 VM/7 foreign/Corev4 upgrade/20 actual custody tx are mechanism history, not product acceptance. Original root returned Bob Standard104/App49/Forms31/Growth10gen1accepted5. All30 partial/full goalACTIVE/Releasefalse.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No SDK/frontend/37live/production/Git/agents/external audit; AgentPass deferred.

## Durable decisions

- Soul is root; Vault is tool below it. Both funds/assets and private content required. Content read grants never imply spend rights.

## Changed paths and assets

### Changed paths

- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/SOUL_ARCHITECTURE_REVIEW_CN.md
- docs/SOUL_STANDARD_KERNEL_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- output/contract-rebuild/strict-vault-edit-2026-10-09

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Source has old Vault reverse ownership; explicitly marked rework-required. User confirmation saved in product-topology-correction.json and existing docs.
- 20 original custody PTBs12success8intended rejects; original Root104/App49/Forms31 restoredBob, Growth10gen1accepted5 unchanged; no helper publish intent.

## Risks and recovery

### Risks or blockers

- Correct funds/private Vault product not implemented. Whole30 responsibilities remainpartial. Current304 full compiler and full release incomplete.

### Recovery or rollback points

- Node62039 terminal134/no19089 after no-space. DB/keys/receipts kept. Only1,500,124,279B regenerable compiled caches removed. PrimaryCURRENT unchangedSHA2c9cf369d720f5d9319613acf020c2d236c79f3dcbf90057cddc148c39430512.

### Working-tree evidence

```text
?? docs/CONTRACT_REBUILD_COVERAGE.json
?? docs/CONTRACT_REBUILD_SPEC_CN.md
?? docs/CONTRACT_SECURITY_REVIEW_CN.md
?? docs/SOUL_ARCHITECTURE_REVIEW_CN.md
?? docs/SOUL_STANDARD_KERNEL_CN.md
?? docs/codex/
?? move/soulidity_application/
?? move/soulidity_community/
?? move/soulidity_content/
?? move/soulidity_foundation/
?? move/soulidity_model/
?? move/soulidity_standard/
?? move/soulidity_v1/
?? move/soulidity_visual/
?? move/standard_examples/
?? output/
?? scripts/codex/
?? scripts/inspect_contract_dependencies.py
?? scripts/profile_move_function_trace.py
?? scripts/verify_contract_ability_batches.py
?? scripts/verify_contract_ability_probes.py
?? scripts/verify_contract_publication_budget.py
?? scripts/verify_soul_standard_external.py
?? scripts/verify_soul_standard_local.mjs
```

## Exact next action

Implement correct Soul-attached Vault tool using existing funds/content/authorization primitives; map and replace old reverse Vault ownership, runtime/Physical/native binding and all consumer/test paths without losing rights/payments/history. Keep external third-party containers separate. No AgentPass implementation now.

Slack纠正已读回：原DOF-001/007/009、D02-D04、R1/R4/R5共9行15格更新，597其他格及Owner/status/stage保持。证据：output/contract-rebuild/strict-vault-edit-2026-10-09/slack-topology-correction.json。用户确认两类都需要，AgentPass后置；不再待业务澄清。
