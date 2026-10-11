# Soulidity Phase Handoff: lease-renewal

## Snapshot

- Created: 2026-10-09T19:39:18+03:00
- Phase: lease-renewal
- Status: in-progress
- Goal: Continue complete all-contract goal; correct pinned Walrus expiry assumptions and prove original Blob renewal, prepaid recovery and funds conservation
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-lease-renewal.md`

## Outcome

59production inputs; only release false expired-revival comment corrected, no functional change.8new lease tests with real dependency epoch transitions: exclusive-end/late renewal denied, all before-end renewal survives immutable snapshot-end, renewed-end expires, partial renewal cannot hide other expired documents/image, expired Draft cancel originalID and finish denied.952VM=944retained+8new;affected100PASS. Two compiler builds exact previous accepted modules/dependencies/currentCore bytecode;Core978cv3/Appc6f1v6/8actual46modules1494Public54Friend381structs unchanged;prior321foreign same-bytecode evidence reused, not rerun.16originalsigned8success8MoveAbort/rawBCS-intent exact/requery/failed custody rollback/Systeminternal reward objects untouched/failedWALdelta0.Original3BlobIDs+all fields exceptactualStorage.end stable:render41->43->45, living+manifest41->43;Certificate/Version semantic commitments unchanged. Stale prepaid originalStorage rejected onrender then reused for matchingmanifest. RenewedMakerPlayer create/close;priorSoulc3bc owner/content unchanged. SUI5wallet+allgasdelta0;WAL5wallet-504/System FutureAccounting+504=0. Actualdailyepoch1/end41 not reached; boundary proof is VM, signed PTBs before-expiry only. OwnedmutableControl same-version concurrency not claimed. Parser-spacing and wrong expected abortcode harnessfail retained, originaldigest recovery no resign. Slack7rows13cells569others/30IDs/schemaownerstatusstage unchanged. Node62946/PID51870SIGINT0/5DBstores/5identityhashes/primaryCURRENT retained. All30partial/goalactive/Releasefalse.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No production,SDK/frontend/37live,Git,agents,AgentPass,external audit. No pixels,KMS or offchain Walrus service claim. No signed actual-expiry boundary or concurrent owned-Control claim.

## Durable decisions

- Pinned Walrus only renews certified live Blob before exclusive end; historical Reference end is not current availability. All documents/render transports must remain live. Expired reupload/newpublication is separate.
- Both funds/assets and private-content Vault remain optional permanent Soul DOF tools; read != spend, AgentPass deferred. Sequential staleStorage recovery is not actual concurrent Control submission evidence.

## Changed paths and assets

### Changed paths

- move/soulidity_v1/sources/release.move
- move/soulidity_v1/tests/release_tests.move
- output/contract-rebuild/lease-renewal-2026-10-09
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/codex/PROJECT_MEMORY.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:59inputs/onlyreleasecomment/2builds identicaldeployedCore/952VM=944retained+8new/affected100/16original8success8MoveAbort/SUI+WALdifference0/8actualpackages46modules.
- Actualoriginal3Blob sameID/semantics storageendsrender45/documents43;stalepaidStorage originalIDrollback/reused;Playercreateclose andpriorSoul owner/content unchanged. Previous321foreign samebytecode reused, not rerun.
- Slack7rows13cells569others30IDs/schemaownerstatusstage unchanged;Node62946/PID51870SIGINT0/5DBstores/5networkidentityhashes/primaryCURRENT retained. Harnessfails saved, no replay.

## Risks and recovery

### Risks or blockers

- All30partial; full original semantic review, permissions/collection/package combinations, actual recovery contention and expired reupload/publication/source continuity remain. Actualdailyepoch boundary not reached; VM boundary evidence only. FullReleasefalse.

### Recovery or rollback points

- SameCore978cv3/Appc6f1v6/Config71143f rev27 enabled/unpaused/platform172/nativegen1/releasegen2;Maker13f6v1 income0. Originalimage38a8end45,living6f02+manifest647cend43. Playerbc4c closed/priorSoulc3bc intact.
- Node62946/PID51870 stopped0,retained DB/Genesis/keys exactidentities unchanged.16originalintent/effects/rawBCS kept;no blind replay, no primaryCURRENT change.

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

Use lease-renewal-2026-10-09/bootstrap-current-evidence.json/current-eight-ABI-evidence.json/phase-state.json/lease-renewal-evidence.json. Core978cv3/Appc6f1v6 and Config71143f rev27 enabled/unpaused/platform172/nativegen1/releasegen2 unchanged;Maker13f6v1 income0, originalimage38a8end45/living6f02+manifest647cend43;Playerbc4c closed,priorSoulc3bc unchanged. Node62946/PID51870 stopped0;retainedae60751d/default137 noreset. Continue original30 semantic duties and permission/collection/package combinations. Expired reupload/newpublication continuity and actual recovery contention remain; Walrus cannot revive expired sameID. Currentexpiry boundary is realdependency VM transitions, not signed dailyepoch boundary. Source bytecode unchanged; no upgrade/role rotation needed. Never rerun successful phase or baseline helpers;no agents/production/SDK/frontend/Git/AgentPass.
