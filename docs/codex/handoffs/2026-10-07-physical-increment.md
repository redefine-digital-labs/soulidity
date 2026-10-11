# Soulidity Phase Handoff: physical-player-local-verification

## Snapshot

- Created: 2026-10-07T19:13:10+03:00
- Phase: physical-player-local-verification
- Status: complete
- Goal: Physical/Player local implementation verification increment; all-contract goal remains active
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (8 status entries)
- Handoff: `docs/codex/handoffs/2026-10-07-physical-increment.md`

## Outcome

23 modules; 261 VM tests; two identical builds; six foreign-package probes verified. Full Physical/all-contract acceptance NOT complete: old function map has 95 pending/3 partial.

## Scope and non-goals

### In scope

- Physical issuer, actual Player, canonical Soul proof, native Receiving market

### Intentionally not done

- No SDK/frontend/live journey/deploy/sign/spend/external audit

## Durable decisions

- One Registry per actual Maker Version; immutable material Terms distinct from OC Item rights
- Physical key-only Asset uses private Listing UID and native Receiving; Soul retains key+store and DOF

## Changed paths and assets

### Changed paths

- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- scripts/codex/phase_handoff.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/codex/CURRENT.md
- output/contract-rebuild/physical-2026-10-07

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- sui move test 261/261 with 43 new Physical cases: PASS
- 23 modules two identical builds and 42 input hashes: PASS
- Foreign package 1 legal metadata and 5 rejected attacks: PASS
- Slack 14 records, 5 changes, other fields/owners unchanged; root CURRENT preserved: PASS

## Risks and recovery

### Risks or blockers

- 95 pending/3 partial old Physical functions; full Scene/Seal asset metadata, certified publication/runtime, large policy/history gas pending
- Actual Seal/PTB provenance, generic container authority, public_transfer limits, full ABI/upgrades/security/contention pending

### Recovery or rollback points

- Uncommitted candidate in isolated codex/soul-dof-v1-contracts worktree; preserve files without reset/clean. loadout20/218 evidence is historical.

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

Implement Collection and market creator/right/holder, supply, membership, floor app policy, extra royalty, tradeability and Kiosk; continue Scene/runtime, Physical metadata, all ABI/security/contention.
