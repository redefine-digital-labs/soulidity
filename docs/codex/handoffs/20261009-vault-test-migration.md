# Soulidity Phase Handoff: vault-test-migration

## Snapshot

- Created: 2026-10-09T14:43:51+03:00
- Phase: vault-test-migration
- Status: in-progress
- Goal: Continue unchanged all-contract goal: migrate old Vault tests without losing duties or mistaking policy primitives for real native access routes
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-vault-test-migration.md`

## Outcome

4 original test files migrated;all116 tests retained/22 names corrected/116 VM PASS. Production58 inputs unchanged. Full307 compiler76positive231negative verified against current body/hash/own primary diagnostic. Default full VM still106 compile diagnostics inpaid_access/vault. Native independent paid/delegate product endpoint remains missing; cannot mask with supplied-root policy tests.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No SDK/frontend/37live/production/Git/agents/external audit; AgentPass deferred.

## Durable decisions

- Use actual owned Soul for forms/growth/Loadout/Artifact; Vault is independent optional DOF tool. Tests do not add a reverse shared Vault, OwnerCap or production authority.
- Supplied-root policy tests with native private operator prove scope/expiry/revoke logic only; not independent agent input provenance or Seal KMS. Native independent paid/delegate route is an explicit incomplete responsibility.

## Changed paths and assets

### Changed paths

- move/soulidity_v1/tests/authorization_tests.move
- move/soulidity_v1/tests/loadout_tests.move
- move/soulidity_v1/tests/output_tests.move
- move/soulidity_v1/tests/vault_edit_tests.move
- scripts/verify_contract_ability_batches.py
- docs/CONTRACT_REBUILD_COVERAGE.json
- output/contract-rebuild/vault-test-migration-2026-10-09

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:58 production copies unchanged;6 exact selected fixtures/tests;original116 current116 and test-duty-map;116 currentVM pass;307 current foreign76legal231reject each exactbody/SHA/primary diagnostic.
- Full default test FAIL106 compile diagnostics inpaid_access_tests70 andvault_tests36; current4 migrated source files compile and116VMpass. AgentPass independent access and public native paid/delegate endpoint not accepted.
- Slack9original rows15cells verified;567 businesscells+30record IDs unchanged;Owners/status/stages preserved. slack-sync-proof.json.

## Risks and recovery

### Risks or blockers

- Full all30partial/goalACTIVE/Releasefalse. Correct-tool chain publication/PTB still missing; prior source build valid only production unchanged, not full VM. Core lowerbound90898B is not exact release acceptance.

### Recovery or rollback points

- Source-before6 files preserved withSHA;prior Source/Corev4 custody history kept, no wallet/DB/replay/deploy changes. Compiler cleanup only generated batch-local reproducible .mv/.mvd/debug_info after logs/bytecodeJSON retained. PrimaryCURRENT preservedSHA2c9cf369d720f5d9319613acf020c2d236c79f3dcbf90057cddc148c39430512.

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

Complete paid_access/vault remaining tests and restore or define actual native paid/delegate access paths consistent with Soul-attached tools and optional native third-party containers; do not reintroduce rejected reverse Vault or fake holder tests; AgentPass remains deferred. Then full default VM, retained-node disk/DB recovery, fresh candidate exactABI/publication and actual money/private/sale PTB gates.
