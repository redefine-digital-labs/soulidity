# Soulidity Phase Handoff: soul-vault-tool-integration

## Snapshot

- Created: 2026-10-09T14:26:22+03:00
- Phase: soul-vault-tool-integration
- Status: in-progress
- Goal: Continue unchanged all-contract goal; implement Soul-attached Vault funds/assets and private content tool, AgentPass deferred
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-soul-vault-tool-integration.md`

## Outcome

Correct Soul DOF Vault implemented in production source; old reverse custody removed. Two reproducible builds;17 independent VM and206 selected original VM plus11 foreign probes pass. Full default suite still compile-fails234 diagnostics in6 legacy-interface tests. Correct tool not chain-published; all30partial/Releasefalse.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No SDK/frontend/37live/production/Git/agents/external audit; AgentPass deferred.

## Durable decisions

- Soul remains independent key+store root. Optional Vault tool is permanent DOF child with typed Balance DF, original asset DOF, certified encrypted Library DOF; read delegation never implies spend.
- Free transfer has no universal revoke hook; private library owner+generation recovery may revive old scope after transfer back without explicit rotation. Supported market sales rotate optional tool scope atomically.

## Changed paths and assets

### Changed paths

- move/soulidity_v1/sources/vault.move
- move/soulidity_v1/sources/native_binding.move
- move/soulidity_v1/sources/runtime.move
- move/soulidity_v1/sources/market.move
- move/soulidity_v1/tests/market_tests.move
- move/soulidity_v1/tests/physical_tests.move
- move/soulidity_v1/tests/release_tests.move
- move/soulidity_v1/tests/native_binding_tests.move
- move/standard_examples/vault_tool
- scripts/verify_contract_ability_probes.py
- scripts/verify_contract_ability_batches.py
- docs/CONTRACT_REBUILD_COVERAGE.json
- output/contract-rebuild/soul-vault-tool-2026-10-09

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:108 current frozen inputs,58 exact production source copies/7 explicitly selected test+fixture copies;2 production build outputs equal;17 independent+206 original VM PASS;11 selected compiler2positive9negative PASS.
- Default full VM current FAIL234 compile diagnostics across6 old-interface tests; current307 full compiler not run. Publication lowerbound90898B/102400, EXACT_SIZE_AND_REAL_PUBLISH_REQUIRED, no correct-tool new chain publication/PTB.
- Slack original9rows15cells updated/readback;567 other business cells plus30record IDs unchanged; original owners/status/stages preserved. Proof slack-sync-proof.json.

## Risks and recovery

### Risks or blockers

- Old full895/Corev4/20 custody PTBs are historical rejected reverse model. New layout/API/schema needs fresh deployment, not Compatible upgrade. All30 remain partial, full goal ACTIVE, release false.

### Recovery or rollback points

- Original retained ae60751d/protocol137 DB/Genesis keys/receipts/Root preserved; node no-space crashed, not restarted. Primary CURRENT remains SHA2c9cf369d720f5d9319613acf020c2d236c79f3dcbf90057cddc148c39430512. Worktree PROJECT_MEMORY missing; authoritative primary stable memory read.

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

Migrate authorization/loadout/output/paid_access/vault_edit/vault six original test files to actual Soul and correct tool/container permissions, preserving substantive original duties; then full default VM/307 foreign gates, retained-node disk/DB recovery and fresh candidate exact ABI/publication/actual PTBs. No AgentPass implementation.
