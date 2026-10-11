# Soulidity Phase Handoff: native-source-founding

## Snapshot

- Created: 2026-10-10T12:24:09+03:00
- Phase: native-source-founding
- Status: in-progress
- Goal: Continue complete all-contract reconstruction; implement canonical non-Maker source and initial-content custody
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (25 status entries)
- Handoff: `docs/codex/handoffs/20261010-native-source-founding.md`

## Outcome

63 production/61 test freezes;1108 VM pass;358 foreign90legal268intended per-sourceSHA;15 registry/joint and12 founding tests. Production rawUID ESC01001 fixed by actual defining-module allocation, no UID/Cap export. Five distinct-address double builds F20507/C36393/Native4779/App100690/Core100369 below102400. Source only;actual retained F3/C3/App9/Core9 and Config55 unchanged,nodeoff. Native6 full issuance/market/rawmetadata/royalty pending;69/1528 unchanged,30partial,Releasefalse. Slack8/468/schemaOwnerstage maintained.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No production,SDK/frontend37live,AgentPass,Git commit/push/PR,agents,external audit or KMS acceptance.

## Durable decisions

- Source Registry has actual freshly allocated key-only shared object plus immutable Config DF locator. Native Claim reserves a typed nonce; actual derived content UID is allocated/packed inside Content, not returned across modules. Root origin is actual Registry and actor. Native full issuer still pending.

## Changed paths and assets

### Changed paths

- move/soulidity_native
- move/soulidity_content/sources/founding_library.move
- move/soulidity_content/sources/document.move
- move/soulidity_foundation/sources/economics.move
- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- output/contract-rebuild/native-source-registry-2026-10-10
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:63/61 source freeze;1108VM;358fullforeign;5two-builddefaultbudgets;Slack8/468;retainedidentity/nodeoff/primaryCURRENT.

## Risks and recovery

### Risks or blockers

- Native6 production births,raw metadata/name domain,original native royalty,Core market/custody/oldcode guards and actual PTBs unclosed;1459 duties/30partial/Releasefalse.

### Recovery or rollback points

- Actual retained local chain/keys/DB and all prior intents/receipts remain unchanged; bootstrap actual F3/C3/App9/Core9. New Native offline address is synthetic, never sign with it.

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
?? move/soulidity_native/
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

Read native-source-registry-2026-10-10/REVIEW_CN.md,verification-evidence.json and source-delta.json. Implement Native Birth/State using registry.new_root + begin_content and Founding finish; preserve original raw names/description/image/royalty/provenance, resolve Standard name nonempty128 restriction without truncation or fake Maker. Bind actual content/auth/paid/config DOF and only hand complete Soul to actual registered Kiosk; use sealed Core Account via thin wrappers, finish ordinary/whole market and old issuance/writes protections. Test default production builders plus VM/foreign and retained local PTBs. Actual bootstrap remains state-config-local-2026-10-10/bootstrap-next-evidence.json/phase-state.json; do not route with synthetic Native address or compilation mainnet label. Continue full1459 duties/FormsGrowthVaulttree/expirySource/recovery/qualifiedindependent Release. No resets/replays,production,SDKfrontend,AgentPass,Git,agents,externalaudit.
