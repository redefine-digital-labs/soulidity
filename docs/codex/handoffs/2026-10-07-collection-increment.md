# Soulidity Phase Handoff: collection-native-kiosk-paid-parity

## Snapshot

- Created: 2026-10-07T19:35:31+03:00
- Phase: collection-native-kiosk-paid-parity
- Status: complete
- Goal: Collection/native Kiosk/Paid Access local implementation and evidence increment; all-contract goal remains active
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (8 status entries)
- Handoff: `docs/codex/handoffs/2026-10-07-collection-increment.md`

## Outcome

25 modules; 309 VM tests; two identical builds; 12 foreign-package probes and 45 input hashes. Collection20 old functions inventoried (18 interfaces plus2 private). Full goal NOT complete: dual OC/Maker royalties, Scene/release/runtime, full Kiosk/Seal/ABI/security remain required.

## Scope and non-goals

### In scope

- Collection permanent creator/member/cap and real native Right purchase/relock/Policy/cancel/terminal exit
- Paid Access owner ask plus additional primary fee and exact durable settlement receipt

### Intentionally not done

- SDK/frontend/live37 journey/deploy/sign/spend/external audit; no commit/push

## Durable decisions

- Keep gross native v8 distinct from additional-fee Collection/PaidAccess; both OC and Maker royalties required
- Canonical key-only Account encapsulates native OwnerCap; private Factory Publisher/PolicyCap/Rule has no escape

## Changed paths and assets

### Changed paths

- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/codex/CURRENT.md
- output/contract-rebuild/collection-2026-10-07

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- sui move test 309/309: PASS
- 25 modules twice identical and45 source inputs: PASS
- 2 legal and10 rejected foreign compiler packages: PASS
- Slack4 changed/14 exact records with other owner/status/stage preserved and root CURRENT unchanged: PASS

## Risks and recovery

### Risks or blockers

- Native v8 OC/Maker dual royalty authority still missing; original economics must be mapped before full acceptance
- Full Scene/release/runtime/ABI/upgrade/contention, native Soul Kiosk and Seal PTB provenance pending; Physical95 pending/3 partial

### Recovery or rollback points

- Isolated uncommitted codex/soul-dof-v1-contracts worktree; preserve files, no reset/clean or chain action

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

Implement immutable OC creator and Maker source royalty snapshots and independent native v8 gross settlement; per-function remaining economics map, then Scene/runtime/full Kiosk/ABI/security.
