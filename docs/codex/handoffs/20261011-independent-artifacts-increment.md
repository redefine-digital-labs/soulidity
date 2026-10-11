# Soulidity Phase Handoff: Historical authority and independent publication artifacts

## Snapshot

- Created: 2026-10-11T10:25:28+03:00
- Phase: Historical authority and independent publication artifacts
- Status: in-progress
- Goal: Continue the complete original Soulidity reconstruction; close this integration increment without shrinking157 responsibilities or30 original module duties.
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (38 status entries)
- Handoff: `docs/codex/handoffs/20261011-independent-artifacts-increment.md`

## Outcome

Market64/64 plus3/3 proofs and corrected SDK287+121+12/full108/99PTB pass independent review. Offline19 roots/74 own modules pass with1680 source inputs unchanged. MakerPack56/57 remains failed; nothing activated.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No additional non-goals recorded.

## Durable decisions

- Publish independent roots in dependency order; never route wallets using synthetic offline fixture IDs. No cache/token/hash bypass for Maker.

## Changed paths and assets

### Changed paths

- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/historical-market-authority-fixture-v1
- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/sui-core-corrected-package-v2
- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/canonical-publication-artifact-v1
- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/maker-issuer-snapshot-runtime-v1

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Fixture cfc272/1680 and SDK a0542a/278; independent review b72ce5cdaadf5a5bd29616b23af548a20ee7b52afe908a57fb534f8bb96c02cc PASS A/B. Fixture production175/196 unchanged; package287, consumer121+12, full108, PTB99 pass. No fresh npm ci or installation.
- Publication proof4764e22/284 members:19 separate roots/74 own modules, no source changes, no dependency aggregation or unresolved handle addresses. Synthetic metadata only; protocol137 compiler assumption, no real publication proof.
- Maker8c8add/1680 selected round1 saves2071 VM units against exact canonical baseline; Pack56/57 still OOG. Core196 soleissuer byte delta, Market175 all bytes exact; original750 test files retained. TraceCLI exit-6; failing iteration UNKNOWN.

## Risks and recovery

### Risks or blockers

- Gate0 D26, real old-chain writer/current authority/type origins, source activation, Channel, original UI/recovery and independent releases remain open. Full goal ACTIVE.
- Historical Node/Python runtime SHAs differ; all180 historical non-Python guards match:154 Move+24 config/lock+Sui+primaryCURRENT. Do not call181 source checks or181 historical PASS.

### Recovery or rollback points

- Ignore unactivated candidates; primary CURRENT unchanged at2c9cf369d720f5d9319613acf020c2d236c79f3dcbf90057cddc148c39430512. Existing DOF-001/P01/P09 owners and roadmap retained.

### Working-tree evidence

```text
 T packages/soulidity-sdk/src/chain-event-discovery.ts
 T packages/soulidity-sdk/src/chain-object-discovery.ts
 T packages/soulidity-sdk/src/coin-selection.ts
 T packages/soulidity-sdk/src/format.ts
 T packages/soulidity-sdk/src/object-inputs.ts
 T packages/soulidity-sdk/src/profile-read-step.ts
 T packages/soulidity-sdk/src/request.ts
 T packages/soulidity-sdk/src/sui-grpc-compat.ts
 T packages/soulidity-sdk/src/sui-network.ts
 T packages/soulidity-sdk/src/tx-result.ts
?? docs/CONTRACT_REBUILD_COVERAGE.json
?? docs/CONTRACT_REBUILD_SPEC_CN.md
?? docs/CONTRACT_SECURITY_REVIEW_CN.md
?? docs/SOUL_ARCHITECTURE_REVIEW_CN.md
?? docs/SOUL_STANDARD_KERNEL_CN.md
?? docs/codex/
?? docs/ecosystem-construction/
?? move/soulidity_application/
?? move/soulidity_community
?? move/soulidity_content/
?? move/soulidity_custody/
?? move/soulidity_foundation/
?? move/soulidity_model
?? move/soulidity_native/
?? move/soulidity_standard
?? move/soulidity_v1/
?? move/soulidity_visual
?? move/standard_examples/
?? output/
?? scripts/codex/
?? scripts/ecosystem/
?? scripts/inspect_contract_dependencies.py
?? scripts/profile_move_function_trace.py
?? scripts/verify_contract_ability_batches.py
?? scripts/verify_contract_ability_probes.py
?? scripts/verify_contract_publication_budget.py
?? scripts/verify_soul_standard_external.py
?? scripts/verify_soul_standard_local.mjs
```

## Exact next action

Read the terminal publication review, then verify actual isolated-chain publication/linkage and coherent source activation. Resolve Maker same-graph session recovery serialization; preserve original UI/recovery and full scope.

## Terminal publication review

Independent review9a08eef0a9cd313df40f38924414ffcc8306fe7c6a981e57de64046b158b5aa4 PASS:284 exact proof members,1680 inputs,19 proxy trees,9551 artifact members and74 root modules. Independent decoder and missing-dependency/duplicate-module/nonzero-self negatives pass. This covers offline artifacts only. All increment agents are terminal.

Phase helper generated this handoff without --update-current because the readable CURRENT has no managed marker. Coordinator updated only the actual continuation pointer; primary CURRENT and source guards remain unchanged.

## Verified public recovery checkpoint

Public integration main commit `fbd2b5657d477a467928e180ba442895a20ece68` contains `construction-checkpoints/2026-10-11-independent-artifacts-review`. Fresh public download verified all 4,045 archive members by SHA and length, complete Git tree and main ref. Archive SHA `141457d36aa58dc904b22f1cba4cbcfd7fbd1cd25854e5872bb1061b6b0e363e`. Integration checkout clean; public visibility confirmed and Actions disabled. Receipt: `output/ecosystem-construction/remote-backup-20261011/independent-artifacts-remote.json`. Backup commits/pushes follow the later explicit user authorization; no release, activation or deployment.

Previous goal turn was a read-only status report (no implementation progress). This turn completed independently reviewed fixture/SDK proofs, executed and independently verified separate artifact construction for all 19 package roots, reproduced same-graph Maker failure and verified remote recovery. Full goal remains ACTIVE; no completion or blocked audit claim.
