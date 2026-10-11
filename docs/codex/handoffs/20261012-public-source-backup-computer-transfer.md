# Soulidity Phase Handoff: public-source-backup-computer-transfer

## Snapshot

- Created: 2026-10-12T00:19:27+03:00
- Phase: public-source-backup-computer-transfer
- Status: complete
- Goal: Preserve the latest public sources and prepare an English handoff for the contract/module refactor on another computer.
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (42 status entries)
- Handoff: `docs/codex/handoffs/20261012-public-source-backup-computer-transfer.md`

## Outcome

All fourteen source checkpoints across thirteen public repositories were pushed and exact remote commit IDs verified. Public transfer evidence and restoration guidance are prepared and independently reviewed for additive backup-branch publication. The full original contract objective remains unfinished; recipient-machine restoration and private chain-state transfer have not occurred.

## Scope and non-goals

### In scope

- Source snapshots, remote verification, English transfer entry, owner alias and path-relocation manifest, public contract evidence.

### Intentionally not done

- Production release, signatures, spending, irreversible authority changes, original browser migration, private chain database/key transfer, and completing the full original contract goal.

## Durable decisions

- Human backup instruction on 2026-10-12 authorizes these Git operations only; preserved CURRENT no-push text is historical for this narrow backup.
- Keep both CURRENT documents and original Owners, roadmap, Delivery/DEV/BUG records unchanged; do not activate H2 or accept the failed final Standard conformance gate.
- Handbookv1.0 core1-4,9,12 and OperatingModel8 remain applicable; source backup is distinct from Release and Deploy.

## Changed paths and assets

### Changed paths

- docs/codex/handoffs/20261012-public-source-backup-computer-transfer.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- e3cd2e055b148631ab25999539efb975cd0b1493
- 291e40072dce5751d3755c59a3cd75297e88eaed

## Verification

- All fourteen initial remote backup refs match their source checkpoint OIDs PASS
- Independent source tree validation, 8921 files and no unrelated working branch/index/config changes PASS
- Synthetic restore clone/verify/prepare, alias, manifest, overlap and unknown-drift controls PASS

## Risks and recovery

### Risks or blockers

- Recipient machine is not connected; no destination execution is claimed. Private keys/local chain databases, large traces/tool binaries and unrelated worktrees are not on public GitHub.
- Frozen old guards retain absolute paths and old CURRENT versions. Historical results and rollback scripts must not be replayed as current destination acceptance.

### Recovery or rollback points

- Retain original working trees and public snapshots. H1 v6-to-v5 continuation restore precedes historical exact7 rollback; actual rollback was not performed.

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
?? move/foreign_soul/
?? move/private_source/
?? move/soulidity_application/
?? move/soulidity_community
?? move/soulidity_content/
?? move/soulidity_custody/
?? move/soulidity_foundation/
?? move/soulidity_model
?? move/soulidity_native/
?? move/soulidity_native_binder/
?? move/soulidity_origin_protocol/
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
... 2 additional status entries omitted
```

## Exact next action

Restore the pinned sources into a fresh destination, verify original bytes, prepare owner aliases and local manifests, then create fresh reviewed contract guards before resuming the unactivated Maker bridge candidate.

## Final preparation boundary

The bounded source-backup and transfer-preparation milestone is complete. Independent final material review passed:16,199 archive members, exact409 public framework inputs,27aliases, complete H2 before/after source payloads, preserved final Standard test failure, and the readonly-aware restore fixture. Archive SHA256: `ee19604d166c24744a05f2b34f400fa19faacec36783d8a239f4486fba0efd1d`. Full original contract goal remains incomplete; recipient restoration, private-state transfer and production operations are outside this completed milestone.
