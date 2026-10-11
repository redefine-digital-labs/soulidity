# Soulidity Phase Handoff: metadata-ingress-checkpoint

## Snapshot

- Created: 2026-10-08T13:42:36+03:00
- Phase: metadata-ingress-checkpoint
- Status: complete
- Goal: Verify bounded typed Creator metadata ingress and unsigned transaction envelopes; full contract goal remains active
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (8 status entries)
- Handoff: `docs/codex/handoffs/2026-10-08-metadata-ingress-checkpoint.md`

## Outcome

500 Fragment metadata across18 writes now passes default meter and matches canonical Version/hash.15 new scenarios defaultPASS;670 aggregate semantic/669default plus1 original500Blob cumulative timeout.35 identical builds/69 inputs/8 foreign2legal6reject. Current protocol137 and SDK2.16 synthetic unsigned BCS envelope checks only; real PTB gas/effects acceptance pending.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No additional non-goals recorded.

## Durable decisions

- Metadata key-only author root/privateVersion DOF; per chunk32rows8192bytes, conservative196608 bound, exact snapshot/CAS/control/System; original author can cancel after drift.
- Incremental rows preserve masks/global order/duplicates and Physical fixed Definition; stream commitment is distinct from canonical policy hash, finalized once before actual release custody.
- SDK envelope10880/5274/558bytes uses synthetic package/object refs and is unsigned/unexecuted; small finish envelope is not execution budget acceptance.

## Changed paths and assets

### Changed paths

- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- output/contract-rebuild/metadata-ingress-2026-10-08

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- 35 identical builds/69 fixed inputs/8 foreign2legal6reject and167 measurement files PASS
- Default500 Fragment and15new scenarios PASS; accurately retain default669PASS1original cumulative timeout/aggregate670semantics and original655/609 PASS
- Slack exact14rows/3records/4columns and root implementation-only CAS/production CURRENT SHA preserved PASS

## Risks and recovery

### Risks or blockers

- Real execution budgets/contention, rich Scene/output seed, remaining all old duties, actual upgrades/UpgradeCap, full149/final ABI/third-party/security remain open. No independent review.

### Recovery or rollback points

- Isolated uncommitted baseline0cfb60a; no commit/push/PR/productiondeploy/sign/spend/reset/clean. Early timeout diagnostics preserved; source nowdefault500FragmentPASS.

### Working-tree evidence

```text
?? docs/CONTRACT_REBUILD_COVERAGE.json
?? docs/CONTRACT_REBUILD_SPEC_CN.md
?? docs/CONTRACT_SECURITY_REVIEW_CN.md
?? docs/codex/
?? move/soulidity_v1/
?? output/
?? scripts/codex/
?? scripts/verify_contract_ability_probes.py
```

## Exact next action

Establish a real local PTB execution harness without production signing/deployment/spending; measure metadata/append32/finish500/runtime/renew/cancel gas/effects/cache/newIDs/writes/contention, then rich Scene/output seed, remaining duties/upgrade/final ABI/security.
