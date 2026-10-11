# Soulidity Phase Handoff: physical-provenance

## Snapshot

- Created: 2026-10-09T03:50:23+03:00
- Phase: physical-provenance
- Status: complete
- Goal: Implement Physical actual-control registration and protected certificate metadata; preserve full all-contract active goal
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-physical-provenance.md`

## Outcome

Bounded implementation/build increment complete; full all-contract goal ACTIVE.128inputs/9changed;783default782PASS/1original500TIMEOUT, all777 outcomes retained,6newPASS. App/Core two compiles identical and10currentbytesABI verified. Real App68346/Core102286 publish; first102768failure retained. No new-source business PTB accepted. Slack6/302 preserved,4workspace links/rootCURRENT unchanged,node66022PID11491terminal0.

## Scope and non-goals

### In scope

- Full all-contract goal unchanged; handoff only records this implementation/build increment

### Intentionally not done

- No agents/SDK/frontend/live37/production/Git/PR/external audit; AgentPass deferred

## Durable decisions

- Registration actual actor/control IDs/txdigest is metadata, Sui epoch not ownership epoch. Runtime queries original Certificate without Seal authorization. Five test-only convenience aliases omitted from production, all public Runtime preserved.

## Changed paths and assets

### Changed paths

- move/soulidity_application/sources/physical_metadata.move
- move/soulidity_v1/sources/physical.move
- move/soulidity_v1/sources/release.move
- move/soulidity_v1/sources/runtime.move
- move/soulidity_v1/sources/issuer.move
- move/soulidity_v1/Move.lock
- move/soulidity_v1/tests
- output/contract-rebuild/physical-provenance-2026-10-09
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- 128currentinputs/10actualpackagebytesABI verified and App/Core twice identical compilation PASS
- 783default782PASS/1original500TIMEOUT; all777old outcomes retained and six additional cases passed, regression comparison PASS
- 3actualpublishoriginalBCS:Appsuccess/Core102768oversizefailure/Core102286success; default protocol unchanged PASS
- Slack6evidence302others22headers/4workspace links/rootCURRENTsha/node66022PID11491terminal0ports empty PASS

## Risks and recovery

### Risks or blockers

- FullgoalACTIVE/all30partial/Releasefalse; full defaultVM gate still FAIL(original500TIMEOUT),new business PTB/current242/500Complete/17145pending3partial/upgrade-security-recovery/growth-nesting pending;Coremargin114

### Recovery or rollback points

- baseline128copies and oversizebytes/originalBCS retained. Old485previouscandidate,Config10funds99,income333 unchanged. NewCore/App fresh originals have no business Config yet.

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

Use physical-provenance candidate-evidence10packages/source-freeze-r3; restart saved ae60751d19089 after socket check. Create isolated new Config/Admin; register actual Publishers/UpgradeCaps and Native/Release directories. Run certified Maker+Pack Physical registration/issuance/protected-material read/transfer/negative/Receiving-sale PTBs. OldConfig10funds99/old485 are previous-candidate history, never replay mutations. Continue171/current242/500Complete/all30/upgrade/security/OCgrowth/nesting.
