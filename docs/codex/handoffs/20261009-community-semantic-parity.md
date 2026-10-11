# Soulidity Phase Handoff: community-semantic-parity

## Snapshot

- Created: 2026-10-09T19:59:33+03:00
- Phase: community-semantic-parity
- Status: in-progress
- Goal: Continue complete all-contract goal; close original wallet Profile, Social, Community Posts and Votes semantic mapping and restore missing original regressions
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-community-semantic-parity.md`

## Outcome

59production inputs unchanged. Four Community source bodies/fields/abilities/visibility identical to originals after namespace mapping;49ABI-facing production duties reviewed, remaining1479 in26modules pending. Restore66original social/posts/votes regression bodies;1018VM=952retained+66. OriginalProfile exact andbookmarks logic retained.51originalsigned30success21expectedMoveAbort/rawBCS sender intent match;failed root/Table/dynamic-field business state rollback;7success noops historical before-after equal/noevents/nocreationdeletion. Three stablewalletProfiles/handle release-reclaim;followCAS,tombstones,counters;frozencomments/question-authoracceptance/replacement;votesdesiredstates/authorvoteallowed. Walletbookmarks independentowner domains,bounded32receipts,evictedID only newcurrentCAS accepted. Opaque reference only, no encryption/KMS/UI claim andnot SoulVault. Actualeightpackages bytecode/typeorigins/linkage unchanged;49actualABI duties incl2Friend;noupg/roles. SUI5wallet-675099656+all51gas675099656 difference0/othercoins unchanged;oldSoul/Maker/Control/Config/Blob unchanged. Slack6rows11cells571others30IDs/schemaOwner/status/stage unchanged. Node53793/session51865SIGINT0/5DBstores/5identityhashes/primaryCURRENT retained. Documentation-harness/patch errors retained, no chain replay.4original_semantic_review verified separated from30umbrella partial/goalactive/Releasefalse.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No production,SDK/frontend/37live,Git,agents,AgentPass or external audit. No encryption,SealKMS,offchain persistence or public document schema claim. No new source,upgrade or role rotation.

## Durable decisions

- Wallet Profile/public social identify wallets separately from OC Soul; wallet bookmarks are not Soul Vault. Both funds/assets and private-content Soul DOF tools remain required; read != spend; AgentPass deferred.
- Four original sources have verified semantic-duty mapping; global source statuses remain partial for whole-release/independent security/UI checks. Bounded receipt eviction ends old-idempotency guarantee; currentCAS can create a new write.

## Changed paths and assets

### Changed paths

- move/soulidity_v1/tests/original_social_tests.move
- move/soulidity_v1/tests/original_community_posts_tests.move
- move/soulidity_v1/tests/original_community_votes_tests.move
- output/contract-rebuild/community-semantic-parity-2026-10-09
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/codex/PROJECT_MEMORY.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:59unchangedinputs/4sourceparity/49originalduties/1018VM=952old+66originaltests/8sameactualpackages/49ABIincluding2Friends/7historicalnoops.
- 51originalsigned30success21MoveAbort/rawBCS-intent-sender/deepTableDFrollback/SUI+allgasdifference0/othercoinbalancesunchanged/oldSoul-Maker-Control-Config-Blob preserved.
- Slack6records11cells571others/30rows/schemas/owners-status-stage unchanged;Node53793/session51865SIGINT0/5stores/5networkidentityhashes/primaryCURRENT retained.

## Risks and recovery

### Risks or blockers

- Full source implementation/semantic audit remains across26modules1479ABI-facingduties;collection membership/listing/right/fees/package combos, recovery contention and expired reupload/source continuity pending. No fullRelease,production or independent audit.

### Recovery or rollback points

- Same8packages/Core978cv3/Appc6f1v6/Config27 income172/Maker13f6income0/oldSoulc3bcBob;newCommunity IDs andheads use phase-state.json, not historical empty-registry snapshots.
- Node53793/session51865 stopped0;5stores/network identity preserved.51signed originaldigests/intents saved;unknown outcomes query original receipt, never reinitialize or whole-script replay.

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

Continue collection original semantics and actual listing/member/right combinations using CURRENT and this increment phase-state.json/package-*.json plus lease-renewal bootstrap-current-evidence.json. Core978cv3/Appc6f1v6/Config7114 rev27 platform172/nativegen1/releasegen2 unchanged;Maker13f6v1 income0,oldSoulc3bc Bob unchanged. Community2ecfv1 registries same;3Profiles/1question/2Immutablecomments/bookmarkCarolrev34 receipts32/Bobrev1 now exist, use phase-state not old zero counts. Node53793/session51865 stopped0;restart retained ae60751d/137 withoutreset only for nextPTBs. Verify owned and Kiosk already-listed Soul membership admission/cancel requirement,creator vsRight holder,fees/cap/floor/transfer-and-settlement. Full original duties,permission/package combos,recovery contention and expired reupload/source continuity remain. No rerun baseline helpers or whole journey script;no agents/Git/production/SDK/frontend/37live/AgentPass/outer audit.
