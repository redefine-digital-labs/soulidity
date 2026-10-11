# Soulidity Phase Handoff: publication-budget-checkpoint

## Snapshot

- Created: 2026-10-08T14:11:04+03:00
- Phase: publication-budget-checkpoint
- Status: complete
- Goal: Reproduce default137 publication gates; whole contract goal remains active
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (9 status entries)
- Handoff: `docs/codex/handoffs/2026-10-08-publication-budget-checkpoint.md`

## Outcome

35 module local Publish208565 exceeds Tx131072; package lowerbound208295 exceeds102400.11 guard checks PASS; no Soulidity package or Metadata execution.69 original inputs retained. Full scope unfinished.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No additional non-goals recorded.

## Durable decisions

- No protocol overrides. Local new genesis virtual-gas WAL/Walrus dependency publish only; no production keys/funds or Soulidity package.
- Metadata closure175023 and Soul closure114206 exceed package102400. Mechanical groups cannot solve dependency/permission boundaries.

## Changed paths and assets

### Changed paths

- scripts/verify_contract_publication_budget.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- output/contract-rebuild/local-ptb-2026-10-08

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Reproduced node rejection208565>131072/lowerbound208295>102400;11 guard checks PASS
- 69 original source hashes unchanged; prior670/669+1 retained/no full Move rerun PASS
- Slack14rows/3records/4cells and root namespace-only CAS/currentSHA preserved PASS

## Risks and recovery

### Risks or blockers

- Full release fails publication limits; cross-package security/all duties/PTB/ABI/upgrade/third-party/security remain. No independent review.

### Recovery or rollback points

- Isolated uncommitted; local node stopped143/state preserved; original assets/source/traces/rootCURRENT preserved. No commit/push/PR/productiondeploy/sign/spend/reset/clean.

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
?? scripts/verify_contract_publication_budget.py
```

## Exact next action

Implement DAG package boundaries and individually proven cross-package authorities/native role identities. Default137 each-package publish/upgrade and foreign rejects before real Metadata500/Blob32/finish. Preserve all remaining duties/full goal.
