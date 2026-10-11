# Soulidity Phase Handoff: native-custody-sdk-source-increment

## Snapshot

- Created: 2026-10-10T16:53:57+03:00
- Phase: native-custody-sdk-source-increment
- Status: in-progress
- Goal: Continue complete ecosystem reconstruction through independent source ownership and tested public interoperability
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (38 status entries)
- Handoff: `docs/codex/handoffs/20261010-native-custody-sdk-source-increment.md`

## Outcome

Ten local repositories preserved. SDK10 sources now sole-owned in soul-sdk with277 independent tests,300 original consumer tests and original SDK/UI types passed. NativeCustody retained leaf imported29 inputs; actual4 production roots equal reviewed candidate; defaultCore1038 andleaf3 passed,140 graph inputs unchanged. Original52 baseline duties preserved:47 unchanged bodies,5 transformations,2 new retained sources. Common integrity tooling43 controls/92 actual inputs passed; initial3 review findings fixed, recheck pending. Full ecosystem goal remains active.

## Scope and non-goals

### In scope

- Local reversible contract/SDK/tooling extraction and original consumer verification; primary CURRENT and original owners unchanged

### Intentionally not done

- No commits/push/PR,remote GitHub/Slack,production,real keys/funds,irreversible authority or new roadmap

## Durable decisions

- Soul privately held; adversarial share tests retained. Direct delivered-root rejection is scoped evidence; D26 unsafe fresh Kiosk findings remain FAIL.
- Ten repositories and15 retained units; custody leaf remains NATIVE.PRODUCER,not an11th repository.
- Original157 scope and69 reviewed/1459 pending duties unchanged. Source originalSHA is immutable baseline; current transformedSHA is separate.

## Changed paths and assets

### Changed paths

- move/soulidity_custody
- move/soulidity_v1/sources/custody.move
- move/soulidity_v1/sources/collection.move
- packages/soulidity-sdk/src/sui-grpc-compat.ts
- docs/ecosystem-construction/ACTIVE_CONSTRUCTION_CN.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- output/ecosystem-construction/repository-split-2026-10-10/native-custody-leaf/actual-layout-verification/summary.json:4 actual roots raw+mv equal candidate,Core1038/leaf3 defaultPASS,140 unchanged inputs,no signing
- Workspace soul-sdk/evidence/sui-core-extraction/independent-actual-review.json:17 checks PASS;10 aliases/127 guarded inputs/117 locked identities/888 exports
- Workspace ecosystem-devops/tools/repository-extraction/evidence/source-transition-guard/evidence.json:43 controls,actual92 input guards,54 production writers,10 SDK locators;3 initial findings fixed/recheck pending

## Risks and recovery

### Risks or blockers

- Gate0 effective authority,published type origins/linkage/independent upgrades,B0/CASE19,original UI/wallet/fulljourneys still pending; no full acceptance
- New Account type identity belongs to unpublished coherent target; no old Account compatibility claim. Maker/Operator/Binder andContent3 retained publication duties remain coupled.

### Recovery or rollback points

- Native persistent payload before/after and source-transition-registered.json under output/ecosystem-construction/repository-split-2026-10-10/native-custody-leaf; SDK10 frozen before copies and validated restore planner in new SDK repo.
- Four whole-package frozen-before andContent9 original copies retained. Chainae60751d PID29546/RPC19089 DB/Genesis/keys/Blobcase2 untouched; no replay.

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

Close independent actual Native/source-tool rechecks, then split Maker pure terms/admission and authenticated Soul adapters without exposing operator or cap; remove NativeBinder reverse Maker imports before activating Maker sources.
