# Soulidity Phase Handoff: native-initial-state-config

## Snapshot

- Created: 2026-10-10T11:14:28+03:00
- Phase: native-initial-state-config
- Status: in-progress
- Goal: Continue all-contract reconstruction; verified state-configuration source candidate and current Feynman report
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261010-native-initial-state-config.md`

## Outcome

Full goal remains active. Added ordinary StateConfiguration real DOF under ApplicationState using existing private ContentOperator; initial one-use Draft and current holder set/delete with protocol, Primary, CAS and full commitment. Application schema3 rejects old2 writers.60 production/59 test freezes:3 existing sources changed+1new module.1081 defaultVM passes,11 new targeted;8 new foreign cases2positive/6intended rejects;old330 bodies preserved,full338 not rerun. Distinct-address dual builds equal:Content32303/App100690/Core100297 projected default102400;historical same-source relocated bytecode equals actual readback,Core conservative unused dependency72. No new candidate actual upgrade/receipt; chain unchanged F3/Content2/App8/Core8 Config51 income203. Original13 function slices reviewed;native/imported/joined6 production paths not complete;formal69/1528,1459pending/all30partial/Releasefalse. Slack8 cells updated,468 others incl22IDs/schema/Owner/status/stage unchanged. Final verifier repaired literal CASES.update parsing and passes; failures retained. Node off,DB/5identity hashes/primaryCURRENT preserved. Feynman report distinguishes new source from prior27actual Core8 receipts. No production/frontend/AgentPass/Git/agents/external audit.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No production,SDK/frontend37live,AgentPass,Git commit/push/PR,agents,external audit or KMS acceptance claim.

## Durable decisions

- StateConfiguration is public ordinary metadata, not private grant or spending authority. Schema3 commits actual values and rejects older writers omitting them.
- Current projected build sizes and VM tests do not prove latest candidate actually upgraded; retain separate earlier Core8 actual evidence.

## Changed paths and assets

### Changed paths

- move/soulidity_content/sources/state_configuration.move
- move/soulidity_application/sources/character.move
- move/soulidity_v1/sources/issuer.move
- move/soulidity_v1/sources/runtime.move
- move/soulidity_v1/tests/state_configuration_tests.move
- move/soulidity_v1/tests/upgrade_schema_tests.move
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- output/contract-rebuild/native-initial-state-config-2026-10-10
- output/reports/2026-10-10-feynman-latest

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:60 production/59tests frozen;1081VM/11targeted/8foreign;330 bodies unchanged;budget double builds+historical bytecode;Slack8/468;identities/primary unchanged.

## Risks and recovery

### Risks or blockers

- Latest source unupgraded;full338 pending.6native issuance paths incomplete,all30original modules partial/1459pending. Complete tree,permissions/KMS,expirySource,oldcross-entry,recovery concurrency and independent Release unclosed.

### Recovery or rollback points

- Keep ae60751d DB/config/keys/intents and prior bootstrap-next/phase-state. Offline address-layout-only.toml uses compiler-only mainnet label with local addresses; never route/sign with it. Source freeze and original failure logs retained.

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

Read output/contract-rebuild/native-initial-state-config-2026-10-10/REVIEW_CN.md,verification-evidence.json,source-freeze.json,published-address-budget.json and true local candidate-published.toml. Use prior market-terminal-cleanup bootstrap-next/phase-state for actual F3/Content2/App8/Core8. Preflight retained ae60751d/default137,actual Caps/ABI/IDs;restart same DB only if needed. Complete3package compatible upgrades,exact identity/type-origin/linkage/default-budget readback and configuration normal/negative/oldschema2/asset/money PTBs;preserve unsigned intent and recover unknown digest. Run full338 probes. Then complete original6nonMaker issuance:raw metadata/full names,typed initial contents,nonce-derived IDs,actual joined Kiosk/source dedup,unverified import declaration. No fakeMaker/Canvas/Artifact or generic issuer bypass. Continue all1459 duties,fulltree/permissions/expirySource/oldcross-entry/recoveryconcurrency and independent Release.
