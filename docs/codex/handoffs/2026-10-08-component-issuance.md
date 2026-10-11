# Soulidity Phase Handoff: component-issuance

## Snapshot

- Created: 2026-10-08T20:07:57+03:00
- Phase: component-issuance
- Status: complete
- Goal: Separate actual Item from Core and preserve native component issuance with target-bound no-abilities producer permit; full all-contract goal remains ACTIVE
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (21 status entries)
- Handoff: `docs/codex/handoffs/2026-10-08-component-issuance.md`

## Outcome

Model.components owns unique Item and linear Permit. Native supply/payment/append/replace private guards retained; actual P/Source type-ID and actual target Soul checked. Default734/733/1 originalTIMEOUT retains726 prior results;8new casesPASS;12 foreign2positive10negativePASS;106inputs;three-package repeat346copies. Core170558>102400 stilloversized; full goalACTIVE/Release false.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No additional non-goals recorded.

## Durable decisions

- Copyable Source cannot issue Item or install new rights; dedicated private ComponentProducer attests actual P/Source and actual standard Soul. Permit cannot copy/drop/store/transfer and target consumption is exact; generic issuer must attest own supply/payment/licence, no native authority from same marker name.
- Only Free produces Item; Ref/Bound continue native permanent records. Item type/event path intentionally moves to Model without old alias, fresh-deployment authorization; existing market/Kiosk/NativeBinding/Loadout use same unique new type.

## Changed paths and assets

### Changed paths

- move/soulidity_model/sources/components.move
- move/soulidity_model/Move.toml
- move/soulidity_v1/sources/catalog.move
- move/soulidity_v1/sources/character.move
- move/soulidity_v1/sources/issuer.move
- move/soulidity_v1/sources/native_binding.move
- move/soulidity_v1/tests/component_issuance_tests.move
- move/standard_examples/model_producer/sources/producer.move
- scripts/verify_contract_ability_probes.py
- docs/SOUL_STANDARD_KERNEL_CN.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Default734/733PASS/1 originalTIMEOUT;8new behavior casesPASS and all726 baseline names/results preserved: PASS
- Current12 real foreign compiler probes2legal10intended refusals, no structural error substitution: PASS
- Three-package two production builds159Core97Model90Standard module file copies including dependencies equal: PASS
- IndependentModelProducer own Free supply->target-bound Permit current production build: PASS
- 106 frozen inputs/current30 target files present/coverage statuses preserved: PASS
- Slack14 records four evidence cells only/304 preserved and root implementation-only CAS/protectedCURRENT: PASS

## Risks and recovery

### Risks or blockers

- Full all-contract objective active. Core170558>102400, original500BlobVMtimeout; Model budget lower15127 and Std4390 not publication proof. Current real publications/roles/PTBs/deployedABI/whole187matrix/capacity/all original duty/funds/privacy/old-entry/recovery/security/forms/history pending. Root/output/Seal cross-package entry proof still required before app extraction.

### Recovery or rollback points

- 106 current inputs frozen;105 preceding inputs in before/ preserve removed CoreItem. No production/frontend/SDK/Git/keys/funds/signed transactions changes. Source recovery not deployed rollback. Slack/root before-readback and protectedCURRENTsha2c9cf369 retained.

### Working-tree evidence

```text
?? docs/CONTRACT_REBUILD_COVERAGE.json
?? docs/CONTRACT_REBUILD_SPEC_CN.md
?? docs/CONTRACT_SECURITY_REVIEW_CN.md
?? docs/SOUL_ARCHITECTURE_REVIEW_CN.md
?? docs/SOUL_STANDARD_KERNEL_CN.md
?? docs/codex/
?? move/soulidity_community/
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
?? scripts/verify_contract_ability_probes.py
?? scripts/verify_contract_publication_budget.py
?? scripts/verify_soul_standard_external.py
?? scripts/verify_soul_standard_local.mjs
```

## Exact next action

Extract actual Character/content cluster after inspecting package-private boundaries: establish Root initialization/output/paid/Seal proof and preserve actual owner/Creator/Market/Collection roles. Use new component Permit instead of public Source issuance; then default-protocol legal publish/roles/current PTBs/normalized ABI/capacity and full responsibilities.
