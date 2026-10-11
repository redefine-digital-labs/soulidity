# Soulidity Phase Handoff: physical-primary-economics-increment

## Snapshot

- Created: 2026-10-07T20:52:50+03:00
- Phase: physical-primary-economics-increment
- Status: complete
- Goal: Primary/Pack immutable economics and Physical product-role settlement local increment; full all-contract goal stays active
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (8 status entries)
- Handoff: `docs/codex/handoffs/2026-10-07-physical-primary-increment.md`

## Outcome

395/395 VM;26 identical build modules;6 legal+28 rejected foreign compiler packages;49 frozen inputs. Treasury16 functions5partial/11pending;AC193 functions15restructured/23partial/155pending;all30 old modulespartial. Full contract goal NOT complete.

## Scope and non-goals

### In scope

- Immutable PrimaryPolicy committed to Product/Version/Source and actual PrimaryReceipt for Complete/access/Pack/Physical; live pause and version guards
- Physical actual Maker creator/source roles, canonical Soul proof preservation and buyer-bound exact SaleReceipt

### Intentionally not done

- SDK/frontend/live37/deploy/sign/spend/commit/push/independent or external audit

## Durable decisions

- Direct immutable beneficiary payout is not acceptance of legacy treasury accumulation and Control-owned income/Withdraw UI; this gap is mandatory

## Changed paths and assets

### Changed paths

- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/codex/CURRENT.md
- output/contract-rebuild/physical-primary-2026-10-07

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- 395/395 local Move VM PASS
- Two 26-module JSON builds identical;49 source hashes unchanged PASS
- 34 actual foreign compiler packages:6 legal/28 rejected as expected PASS
- Slack14 rows exact3 record changes;root implementation namespace only;rootCURRENT unchanged PASS

## Risks and recovery

### Risks or blockers

- Full treasury/Config/access/release/runtime/visual/ABI/Seal/Kiosk/security acceptance mandatory; unrestricted Soul transfer has no global revocation hook

### Recovery or rollback points

- Isolated uncommitted worktree preserved; no chain operations, wallet action or production modifications

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

Implement original Maker/Pack/Protocol treasury income custody, transferable Control revenue and withdrawal, exact access metadata/current Config guards; then complete Scene/Tracks/Color/Rules/certified Release/runtime/Kiosk/Seal/all ABI and security.
