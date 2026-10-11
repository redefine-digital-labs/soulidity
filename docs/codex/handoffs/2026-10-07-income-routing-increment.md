# Soulidity Phase Handoff: income-routing-increment

## Snapshot

- Created: 2026-10-07T21:36:25+03:00
- Phase: income-routing-increment
- Status: complete
- Goal: Canonical current income routing increment; full all-contract goal active
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (8 status entries)
- Handoff: `docs/codex/handoffs/2026-10-07-income-routing-increment.md`

## Outcome

431/431 VM (16 new);27 identical modules;7 legal +36 rejected foreign packages;52 frozen hashes. Complete/Pack/Physical primary/source secondary/all current protocol fees routed. Full goal NOT complete.

## Scope and non-goals

### In scope

- Current package primary and secondary income routing, exact mutable ABI, funds conservation and Control/Admin exit

### Intentionally not done

- SDK/frontend/live37/network/deployment/sign/spend/commit/push/external audit

## Durable decisions

- Product income follows current Control; original creator fixed royalties remain distinct rights; Config and income revisions separate

## Changed paths and assets

### Changed paths

- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/codex/CURRENT.md
- output/contract-rebuild/income-routing-2026-10-07

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- 431/431 VM with exact balances, withdrawals and source misrouting: PASS
- 27 modules two identical bytecode/dependencies/digest builds;52 stable inputs: PASS
- 43 foreign packages7legal/36expected rejections: PASS
- Slack14 rows exact3 edits;Owner/status/stage and root other values/CURRENT preserved: PASS

## Risks and recovery

### Risks or blockers

- Full Config/runtime/INCLUDED/visual/Release/Kiosk/Seal/PTB/ABI/authority/upgrade/exit/contention pending;30 legacy modules partial

### Recovery or rollback points

- Isolated uncommitted worktree; no chain/wallet/production source or asset operations

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

Implement full current Config commitment/enable/replacement/authority/recovery and runtime exact Access/INCLUDED entitlement guards; then full visual/Release/Kiosk/Seal/PTB/ABI/security responsibilities.
