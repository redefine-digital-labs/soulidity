# Soulidity Phase Handoff: immutable-dual-royalty-mutable-caps

## Snapshot

- Created: 2026-10-07T20:01:05+03:00
- Phase: immutable-dual-royalty-mutable-caps
- Status: complete
- Goal: Dual royalties, exact Soul quotes/receipts and frozen management-cap guard local increment; all-contract goal stays active
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (8 status entries)
- Handoff: `docs/codex/handoffs/2026-10-07-royalties-increment.md`

## Outcome

26 modules twice identical;331 VM with22 new scenarios;3 legal+18 rejected foreign compiler probes;47 inputs. Actual OC/Maker immutable rates/recipients and actor-bound receipt settlement. Full all-contract goal NOT complete: Maker Control/Item/Physical/Primary economics, Scene/release/runtime, all Kiosk/Seal/ABI/security remain required.

## Scope and non-goals

### In scope

- Native SO Soul dual royalty gross; Collection net-ask dual royalty; immutable actual creators/Version/Complete/Core/Manifest and exact quote/Receipt
- Require mutable Control/Admin/KindAdminCap for state changes; real transferred Cap operations and foreign readonly rejection

### Intentionally not done

- SDK/frontend/live37/deploy/sign/spend/commit/push/independent or external audit

## Durable decisions

- Keep native SO gross250bps floor and AC internal minimum-share behavior distinct; remaining AC economics not accepted
- Snapshot records original creators; current Control/beneficiary or new published Version cannot rewrite issued Soul

## Changed paths and assets

### Changed paths

- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/codex/CURRENT.md
- output/contract-rebuild/royalties-2026-10-07

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- sui move test331/331 with22 new cases: PASS
- 26 modules two identical builds and47 input hashes: PASS
- 21 foreign packages3 legal/18 rejected with exact diagnostics: PASS
- Slack14 rows3 updates with all other values preserved; rootCURRENT unchanged: PASS

## Risks and recovery

### Risks or blockers

- Control royalty omission, Item wrong source royalty, Physical/Primary/Pack economics and AC min-share snapshots mandatory
- All30 old modules remain partial; full Scene/release/runtime/Kiosk/Seal/ABI/upgrade/authority/contention acceptance pending

### Recovery or rollback points

- Uncommitted isolated codex/soul-dof-v1-contracts worktree preserved; no root production changes or chain actions/reset/clean

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

Fix Control omitted Maker creator resale royalty and Item source royalty mismatch; inspect original Root economics snapshots and nonzero-share/dust per market kind, then Physical dual proof/Primary/Scene/runtime/all-ABI/security.
