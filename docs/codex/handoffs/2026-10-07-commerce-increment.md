# Soulidity Phase Handoff: maker-pack-item-commerce-increment

## Snapshot

- Created: 2026-10-07T20:15:12+03:00
- Phase: maker-pack-item-commerce-increment
- Status: complete
- Goal: Maker/Pack original control royalty and Item fixed platform fee with immutable policy, paused control and equipment repricing local increment; full all-contract goal stays active
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (8 status entries)
- Handoff: `docs/codex/handoffs/2026-10-07-commerce-increment.md`

## Outcome

26 identical build modules /365 VM /4 legal+22 rejected foreign packages /48 source hashes. 34 new economic, snapshot, quote, receipt, pause and reprice scenarios. Full AC193 production-function inventory contains15 restructured/16 partial/162 pending; all-contract goal NOT complete.

## Scope and non-goals

### In scope

- Maker/Pack control resale fixed250bps+explicit original creator royalty <=1000bps; equipment fixed250bps only; original AC strict minimum share
- Private MarketPolicy committed to Product/published Version/Source; actor-bound AssetQuote and exact MarketReceipt; Maker must paused; equipment seller reprice CAS

### Intentionally not done

- SDK/frontend/live37/deploy/sign/spend/commit/push/independent or external audit

## Durable decisions

- Distinct native SO tiny floor and AC internal nonzero-share rules; later Config/Control/new Version cannot rewrite historical product policy

## Changed paths and assets

### Changed paths

- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/codex/CURRENT.md
- output/contract-rebuild/commerce-2026-10-07

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- sui move test365/365: PASS
- 26 modules two identical builds and48 input hashes: PASS
- 26 foreign packages4 legal/22 rejected with expected diagnostics: PASS
- Slack14 records3 exact changes; all other fields preserved; root CURRENT unchanged: PASS

## Risks and recovery

### Risks or blockers

- Physical/Primary economics and full Scene/release/runtime/native Kiosk/Seal/all-ABI/authority/upgrade/exit/contention mandatory
- Full AC market193 functions:162pending/16partial; complete remains false

### Recovery or rollback points

- Isolated uncommitted worktree preserved; no chain operations or original production modification/reset/clean

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

Implement Physical dual OC/Maker royalties from actual creator/provenance and Primary/Pack publication economic snapshots/min-share/dust/Coin/lifecycle; then Scene/Tracks/Color/Rules/certified Release/runtime/Kiosk/Seal/full ABI and security.
