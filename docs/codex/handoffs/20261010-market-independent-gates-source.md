# Soulidity Phase Handoff: market-independent-gates-source

## Snapshot

- Created: 2026-10-10T09:12:33+03:00
- Phase: market-independent-gates-source
- Status: in-progress
- Goal: Continue full all-contract reconstruction; restore independent market lanes and prepare exact candidate validation
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261010-market-independent-gates-source.md`

## Outcome

Full goal active. Implemented Config private typed DF Primary/Secondary gates, OperationalSnapshot v4 commitment, exact Admin revision/hash CAS, original-valid same-value updates, ProtocolRevision2 source marker and scoped issuance/access/publication/listing/settlement guards. Legacy snapshot reading is recovery-only; no-field current business rejected. Maker future MarketPolicy capture is global-only so Secondary-off permits Primary creation.59frozenr2 inputs/10productionfiles changed;Standard untouched.1063defaultVM pass retain1047+16 gate cases, real Move values/Control IDs and101=94+5+2 routing, both-off cancel/7fundsexit, wrongAdmin/staleCAS/defaultfalse/samevalue. Initial1062/1063 supply-limit gas failure fixed by removing duplicate full identity serialization; original abort6 restored, no budget/test weakening. Ordinary frozen production build PASS; exact publication/upgrade/ABI/linkage/old-entry PTB still pending. Four package module-byte lower bounds not actual package acceptance. Slack4rows8cells updated,468others/22IDs/schemas/owners/status/stage unchanged. No chain signature/upgrade; deployedCorev6/Appv7/Foundationv2 Config31 income185 retained, localnode stopped. Original acceptance67/1528 and1461pending unchanged. No production/Git/agents/frontend/AgentPass/external audit.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No production/SDK/frontend37live/Git/agents/AgentPass/external audit or KMS claim.

## Durable decisions

- DF holds Config scalar flags; DOF remains for Soul real child assets. Full operational commitment includes flags. Default false and same-value setter acceptance preserve original behavior.
- Current source marker2 is not deployed. Recovery-only old snapshot reading does not authorize old issuer or bypass; actual old-callable-package tests remain mandatory.

## Changed paths and assets

### Changed paths

- move/soulidity_foundation/sources/economics.move
- move/soulidity_content/sources/paid_access.move
- move/soulidity_application/sources/resale.move
- move/soulidity_v1/sources
- move/soulidity_v1/tests/market_independent_gate_tests.move
- move/soulidity_v1/tests/config_tests.move
- move/soulidity_v1/tests/native_binding_tests.move
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/codex/PROJECT_MEMORY.md
- output/contract-rebuild/market-independent-gates-2026-10-10

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:59current/copy exact,10changed,Standard untouched;1063VM/all1047 retained+16;original budget-abort regression restored. Frozen ordinary production build and module lower bounds verified.
- Slack4rows8cells/468others/22IDs/schemas/owners/status/stage exact. PrimaryCURRENT SHA unchanged;19089 no listener, all compiler/test handles terminal;no chain action.

## Risks and recovery

### Risks or blockers

- Exact new bound-candidate upgrade/budget/ABI/origins/linkage, old-package entry rejection and real mixed-state PTB/rollback still pending;old chain package tests do not prove new source.
- Original duties67/1528 reviewed,1461 pending;qualified independent review,full permissions/recovery/expiry and full Release pending.

### Recovery or rollback points

- Original deployed bootstrap/current roots and Config31 preserved. r1 snapshots/build rejections/logs retained;source-freeze-r2 is latest. Do not reset node or replay successful transactions.

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

Read market-independent-gates-2026-10-10/DECISION_CN.md and verification-evidence.json. Validate candidate-sources-r2/source-freeze-r2 and four-package upgrade plan using preserved ae60751d/137 node and explicit local client; no reset. Verify scopes/caps/ABI/origins/linkage/default budget before signatures; disable originalConfig through verified old API before upgrade, then Foundation/Content/App/Core upgrade and new-marker rebind/flags with exact CAS. Persist original intents/digests; prove old entry rejection, real mixed-state trade/cancel/funds and original roots/ledger. Current chain bootstrap is bootstrap-current-evidence.json plus prior-phase-state.json in same artifact, unchanged Core289db8v6/Appc731v7/Foundationc567v2 Config31 income185. Continue Market95/remaining1461;qualified independent review/full Release still pending.
