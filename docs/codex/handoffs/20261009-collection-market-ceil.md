# Soulidity Phase Handoff: collection-market-ceil

## Snapshot

- Created: 2026-10-09T20:38:05+03:00
- Phase: collection-market-ceil
- Status: in-progress
- Goal: Continue the complete all-contract goal; restore original Collection additive fee rounding and verify native membership, Right transfer and actual whole-Soul settlement
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-collection-market-ceil.md`

## Outcome

Restore original per-component CEIL for CollectionRight and Collection Soul; preserve native gross FLOOR. Four source changes/59 frozen inputs.1031VM retains1018 old names;13 added;321 foreign=81legal240intendeddiagnostics. Three actual compatible upgrades Foundationv2/Appv7/Corev4: two fixed builds,bytecode/origins/linkage/Cap verified,18358/99135/99275B under102400. Only Market/Collection Revision3 roles rotate;others/directories unchanged.61 original digests36success24expectedMoveAbort1PTB-reference-return harness failure;rawBCS/sender/intents exact.24basic22deep rollback. Native regular/exclusive listings freeze membership;real cap not creator authority,proved via compiled external integration adapter. Right207=201+6;wholeSoul118=101+3+6+6+currentholder2. Unmounted Bound and Free originalID remain whole inventory. Actual tiny Right2=seller1+platform1 and same-type clone rejection. Old floor quotes cannot settle after role rotation. Fivewallet delta-1851511058+allGas1851511048+platform10=0;othercoins/spare/Maker/Control/3Blobs unchanged. Slack8rows14cells568others,30rows/schema/owners/status/stage retained. Node54927/session73903SIGINT0,5stores/networkidentity/primaryCURRENT retained. Execution-harness parent-owner/mutableRoot/recipe/schema assertions corrected without re-sign. Both funds/assets and private-content Soul DOF Vault scopes remain required;read!=spend;AgentPass deferred. Whole30partial,4Community49duties reviewed,1479pending;fullgoalactive/Releasefalse.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No production,SDK/frontend/37live,Git,agents,AgentPass,independent audit or KMS/service claim.

## Durable decisions

- Collection additive fees ceil each component;native gross floors;coincident recipients do not merge rates before rounding.
- Both Soul DOF funds/assets and private content required;read!=spend;AgentPass deferred. DOF ObjectOwner may be field wrapper;prove actual membership.

## Changed paths and assets

### Changed paths

- move/soulidity_foundation/sources/economics.move
- move/soulidity_application/sources/resale.move
- move/soulidity_v1/sources/market.move
- move/soulidity_v1/sources/collection.move
- move/soulidity_v1/tests/collection_tests.move
- output/contract-rebuild/collection-market-2026-10-09
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/codex/PROJECT_MEMORY.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:1031VM/321foreign/59frozeninputs/3compatibleupgrades/8packagebudgets/61digests/rawBCS/24basic22deeprollback/wholeBoundandFreeinventory.
- SUI+allGas+platform10 difference0;othercoins unchanged. Slack8rows14cells568others/30rows/schema/owners/status/stage exact. NodeSIGINT0/network5stores/primaryCURRENT preserved.

## Risks and recovery

### Risks or blockers

- Whole-release and original26modules1479 semantic duties pending;new-buyer singlePTB parity still to inspect,allmarket permissions/upgrade combinations,recovery contention and expired reupload continuity pending.

### Recovery or rollback points

- Use current bootstrap-next-evidence.json;Cap IDs and origins retained;only changed roles rotate.61originalintents/receipts retained,no blind replay. Localchain upgrades not reverted by source rollback.

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

Continue original Collection semantic coverage, especially original new-buyer Kiosk creation and purchase in one PTB versus current custody.create returning only ID; verify before declaring a gap. Use this artifact bootstrap-next-evidence.json/current-package-state.json/phase-state.json, never older bootstrap: Corecb53v4/Appc731v7/Foundationc567v2/Configrev31 income182;Soulc3bc Alice standardrev14/Characterrev3,Right Bob epoch2/membercount1. Node54927/session73903 stopped0;restart retained ae60751d/137 only for needed PTBs,neverresetDB/Genesis or rerun completed journeys. Original26modules1479duties,remainingmarket permission/upgrade combinations,recovery contention,expired reupload/source continuity and independent review still required. Fresh Clock expiry for new intents;unknown receipts query original digest. No agents/Git/production/SDK/frontend/37live/AgentPass.
