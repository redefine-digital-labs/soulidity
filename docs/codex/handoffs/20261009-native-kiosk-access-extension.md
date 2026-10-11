# Soulidity Phase Handoff: native-kiosk-access-extension

## Snapshot

- Created: 2026-10-09T15:12:14+03:00
- Phase: native-kiosk-access-extension
- Status: in-progress
- Goal: Continue unchanged all-contract goal: restore real native paid/delegate endpoints while keeping Soul-attached Vault funds/private tools
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-native-kiosk-access-extension.md`

## Outcome

Native optional Kiosk access source restored, Account cap private, zero place/lock; original30 paid/delegate duties retained and11 safety tests added. Current full908 VM + independent Vault17 VM, all321 foreign81legal240reject per-source primary diagnostics PASS. Double production bytecode exact;59copies. Core14 lowerbound96467B, exact publish not verified. Slack9rows15cells readback567other cells30IDs unchanged. Goal ACTIVE/all30partial/Releasefalse.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No SDK/frontend/37live/production/Git/agents/external audit; AgentPass deferred.

## Durable decisions

- Soul Vault is optional permanent DOF functional tool for funds/assets and certified encrypted private content; private reads never authorize spending.
- Native Kiosk access is OPTIONAL external interoperability; no shared reverse Vault or new OwnerCap. Existing private Account seals actual native cap; no raw Soul reference escapes.

## Changed paths and assets

### Changed paths

- move/soulidity_v1/sources/access.move
- move/soulidity_v1/sources/custody.move
- move/soulidity_v1/tests/vault_tests.move
- move/soulidity_v1/tests/paid_access_tests.move
- move/soulidity_v1/tests/access_security_tests.move
- move/standard_examples/vault_tool/Move.toml
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/SOUL_ARCHITECTURE_REVIEW_CN.md
- docs/SOUL_STANDARD_KERNEL_CN.md
- output/contract-rebuild/kiosk-access-extension-2026-10-09

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:59exact production copies, frozen tests/tools, original30 retained,908full+17independent VM;321foreign81positive240negative each source/primary diagnostic; exact double bytecode.
- Slack9records15cells verified;567other businesscells+30IDs and Owner/status/stage/schema unchanged PASS.

## Risks and recovery

### Risks or blockers

- Current VM/foreign compiler proves source behavior, not native shared-input PTB/KMS decryption or exact publication. New layout requires fresh deploy; old Corev4 not a compatible candidate.
- Ordinary free transfers have no universal revocation hook; nested Soul subtree Vault private-domain handover remains required. All30partial/goalACTIVE/Releasefalse.

### Recovery or rollback points

- Before custody source, original2 test files and VaultToolProbe manifest retained. LocalDB/Genesis keys/history/assets untouched; primaryCURRENT preservedSHA2c9cf369d720f5d9319613acf020c2d236c79f3dcbf90057cddc148c39430512.

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

Recover retained local node DB health without replacing Genesis or replaying transactions; freeze accurate fresh deployment candidate, verify exact package size/ABI/linkage/init and real native shared-input paid/delegate, Vault funds/private/whole sale PTBs; close nested-tool privacy, all30 duties, upgrade old-entry/concurrency/recovery gates. AgentPass deferred.
