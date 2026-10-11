# Soulidity Phase Handoff: pack-publication-increment

## Snapshot

- Created: 2026-10-08T07:29:51+03:00
- Phase: pack-publication-increment
- Status: complete
- Goal: Bounded additive Pack publication verified; all-contract goal active and unfinished
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (8 status entries)
- Handoff: `docs/codex/handoffs/2026-10-08-pack-publication-increment.md`

## Outcome

524VM with all499 retained plus25new;28 identical modules;12legal+55rejected foreign compiler cases;57stable inputs. Actual immutable parent-bound additive publication and all28 source ABI inventory. Full goal unfinished.

## Scope and non-goals

### In scope

- Actual immutable parent publication snapshot, additive Scene rows, owned-rule and local-reference guards, true Product/version identity

### Intentionally not done

- No frontend/live37/deployment/signatures/spend/commit/push/external audit

## Durable decisions

- Maker later versions never reparent an existing Pack; Pack cannot shadow parent fixed Style or rewrite inherited rows
- PublicationContext is private actual Product/version metadata, not certified Release/Seal/issuance authority; external selectors fail closed pending certified dependencies

## Changed paths and assets

### Changed paths

- move/soulidity_v1
- scripts/verify_contract_ability_probes.py
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/codex/CURRENT.md
- output/contract-rebuild/pack-publication-2026-10-08

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- 524VM all499 retained and25new Pack publication tests PASS
- 28modules two identical builds and57stable inputs PASS
- 67real foreign compiler cases12legal55expectedrejected PASS
- Slack14 exact3records12cells; rootnamespaceCAS and rootCURRENT unchanged PASS

## Risks and recovery

### Risks or blockers

- Extended Pack profiles still not admitted by Player/Complete/Soul native Scene checks; mandatory scoped composition and certified Release/runtime remain unfinished
- Source ABI inventory891public77package222types36keytypes is not final ABI/authority/security acceptance;30 legacy modules still partial

### Recovery or rollback points

- Isolated uncommitted worktree; original production source/assets/owner/wallet unchanged

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

Implement actual Pack profiles in Player/Complete/Soul with scoped Part/color identities and inherited rules; freeze profiles into Output/sale/Loadout/Physical. Then certified Release/cross-Pack dependencies/native bindings/runtime/Kiosk/PTB/full responsibility/ABI/security acceptance.
