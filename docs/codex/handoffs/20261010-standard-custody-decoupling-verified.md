# Soulidity Phase Handoff: modular-ecosystem-repository-extraction

## Snapshot

- Created: 2026-10-10T23:14:13+03:00
- Phase: modular-ecosystem-repository-extraction
- Status: in-progress
- Goal: Continue full original contract and user journeys through independent repository ownership and public interoperability
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (38 status entries)
- Handoff: `docs/codex/handoffs/20261010-standard-custody-decoupling-verified.md`

## Outcome

Standard/Custody dependency reversal implemented and scoped-verified in isolated checkpoint-v3. Standard production only OriginProtocol+Sui; sealed Account terminals in Custody, exact canonical Collection Soul checks, Native adapter calls updated. Four production roots and Std63/Cust12/Native16/Maker40 pass; root independently replayed Std/Cust and matched production bytes. Final immutable input paths hermetic, readonly review limited PASS. Core two missing safe-exit delegates remain actual compilation failure; no actual source installation or production change.

## Scope and non-goals

### In scope

- Preserve157/30/1528, original product, Core1038, SDK/UI, Gate0/B0/D26/CASE-19, roadmap and original owners/status; candidate progress is not whole-project completion.

### Intentionally not done

- No commit/push/PR/remotes/GitHub/Slack/production/real wallet/funds/irreversible authority/network/RPC/node/signature or budget overrides.

## Durable decisions

- Soul minimal owned/private asset; new functions can use external assets, source qualifications or internal DOF according to semantics. Reference is not ownership/authorization. Preserve original carried rights and lifecycle obligations.
- Vault-specific construction remains deferred with waitlist; no jobs. Existing optional assets and safe exit duties retained; no full Vault handover claim.
- Only root installs actual source after coherent original Core and affected journeys pass; checkpoint-v3 is sole next source authority. Earlier handover/Vault/v1/v2 evidence historical.

## Changed paths and assets

### Changed paths

- docs/ecosystem-construction/ACTIVE_CONSTRUCTION_CN.md
- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/standard-custody-checkpoint-v3
- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/standard-custody-root-review-v1

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Checkpoint-v3 manifest SHA3fc00f222111bdf8647e6e9880f2497ea7897b9772d04cf327295f347e1401be:1649inputs/2320independent root copies,121106135retained bytes. All pins rehashed;632localrefs relative/tree-contained;59production+dev manifest DAG acyclic;1343originalcache guards unchanged.
- Actual final writer031–038:4productionPASS;Std63=59original+4new,Cust12=3original+4relocated+5new,Native16,Maker40 allPASS. Every1646source/manifest/lock input before/after equal;3doc inputs frozen separately. 7exact foreign primary diagnostics reviewed, no root foreign replay.
- Root independent copied v1/explicit65path-prefix transport:Std63/Cust12 exact same test identities as final writer035/036; independent prod91/96compiled closure modules byte-identical031/032 (include dependencies). v1->v2 source/test bodies unchanged;metadata65 changed. Root does not claim Native/Maker independent replay.
- Readonly verifier limitedPASS mdSHA433ed67c2127c1345c3f129ce6d66508f8c07a7906330a2366fd19ef7a87cfac/jsonca6a63156f9988514469b432222b5713db47de9aea021044e3db422a5c3e4e00 retained. 85originaltestfiles exact;terminal6 explicitly2Std/4Cust relocated;9protectedbodySHAexact.
- Core039 actualFAIL twoEC03003 missing leafdeposit_soul/withdraw_soul retained. All181installed move/source/tool/primaryCURRENT guard pins unchanged. Executor/verifier completed; root Sui sessions6347/15616 exited0, no live jobs.

## Risks and recovery

### Risks or blockers

- Core full graph not compiled; original exit/custody source-owned bridge, native postbirth protected authorizations/private access and paid CEIL domain, real policy/royalty/relock, full Makermanufacturing and original product UI remain open.
- No actual published type origin/Publisher/latestCap/init/upgrade/realPTB acceptance; fresh unpublished layout/API relocation not old deployed compatibility. Full Gate0/B0/D26/CASE-19 and ecosystem lifecycle still incomplete.
- Channel localrepo without independent production module; per-module remote CI/Slack/forms/standingagents/deploy not verified; full assets and service replaceability unproved.

### Recovery or rollback points

- Actual publication/Content source baseline unchanged. Root immutable checkpoint-v3 plus original handover v2 and all failed Vault/source/metadata/test/compile runs retained; rollback source is not chain rollback. No DB/Genesis/keys/Blob reset/deletion; primaryCURRENT protected.

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
?? move/soulidity_application/
?? move/soulidity_community
?? move/soulidity_content/
?? move/soulidity_custody/
?? move/soulidity_foundation/
?? move/soulidity_model
?? move/soulidity_native/
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
?? scripts/verify_soul_standard_external.py
?? scripts/verify_soul_standard_local.mjs
```

## Exact next action

From root-retained standard-custody-checkpoint-v3, inspect original custody deposit_soul/withdraw_soul duties and build one isolated source-owned handover/Account terminal bridge without raw Root/UID/Cap exports or business back-dependencies. Verify genuine original entry, disabled/paused safe exits and precision foreign types; preserve deferred Vault duties. Close Core two errors and coherent original regression before root installation, then prepare runnable target Market B0.
