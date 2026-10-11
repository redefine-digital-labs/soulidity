# Soulidity Phase Handoff: Owned creation actual source cutover and verified regressions

## Snapshot

- Created: 2026-10-11T20:34:20+03:00
- Phase: Owned creation actual source cutover and verified regressions
- Status: in-progress
- Goal: Activate the exact reviewed local owned-creation source/consumer transaction and verify affected actual contract graphs; retain the full original ecosystem goal
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (42 status entries)
- Handoff: `docs/codex/handoffs/20261011-owned-creation-actual-source-cutover.md`

## Outcome

Exact source36 plus consumer CI2 applied to actual owning sources. Independent final review accepted live640 inputs, protected606 states, 21 production byte maps, 1293 selected actual-source tests and registered owning Market44. Normalized offline/test transports and seven test-only byte exceptions are explicit. Full D26, Gate0, B0 and157/30/1528/15 remain open.

## Scope and non-goals

### In scope

- Contracts, module/owning-source separation, creation/authority boundaries and affected unsigned/compiler/VM evidence; Handbookv1.0 sections1-5,7,8.3-8.4,9,12 and OperatingModel8; originalDOF-001/P01/P09 owners preserved.

### Intentionally not done

- No formal SDK or original UI rollout, Git commit/push/PR, remote creation, production, real wallets/funds, chain operations, irreversible permissions or data deletion.

## Durable decisions

- Completed Soul remains key+store; private linear Creation and sealed native authority enforce managed construction/delivery; generic Maker remains Soul-independent.
- Fresh arbitrary gifting is explicitly changed to sender delivery then a later existing-owned gift; no universal future framework transfer interception or published compatibility is claimed.

## Changed paths and assets

### Changed paths

- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/owned-creation-actual-activation-v1
- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/owned-creation-actual-source-postcheck-v1
- output/ecosystem-construction/repository-split-2026-10-10/maker-manufacturing-extraction/owned-creation-actual-postcheck-readonly-review-v1
- 36 actual owning contract/test paths and two registered Market CI files listed in the exact operation ledger

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- Final independent result37db6f29a229e66a121e61c35606ad5941f64e1a5fbca1b05c392c03e73a5718: SCOPED_ACTUAL_SOURCE_POSTCHECK_ACCEPTED; no actionable findings PASS
- Actual registered Market resultc17c0e78:44 unique outcomes,615inputs,177productionmodules,409currentCore+4owning=413; actual_activation true; live640 unchanged PASS
- Affected actual source result8801cba5:21 whole production maps exact,1293 tests;5 whole test maps exact and7 retained noncontrol maps with explicit test_only exceptions; recursive33 scopes and13 memory controls PASS

## Risks and recovery

### Risks or blockers

- Actual source tests reconstruct the reviewed normalized offline graph from unchanged raw actual sources; literal standalone release manifests, published nominal/linkage/effective authority and old-callable migration remain unproven.
- Locked-parent fresh-child composition, signed persistent paid-abort rollback, fullD26/Gate0, B0/CASE19, independent releases and complete original157/30/1528/15 remain open. New Vault construction deferred; formal SDK/UI later.

### Recovery or rollback points

- CURRENT v5 paired helper in owned-creation-actual-activation-v1 restores b26c27d9 CURRENTv4 before source_cas.py rollback of exact38. Actual rollback not executed; unknown edits refuse.
- After latest38 rollback, restore prior CURRENTv4 to43c4, v3 tobbde612 before H3 Market10 rollback, then v2/v1 before original138 rollback; frozen predecessor helpers unchanged.

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

Close locked-parent fresh-child composition against these actual sources with authenticated scoped access and no fresh-root/UID/cap escape; then finish effective-authority and dependency gates before freezing target B0 and zero-forced-market-release fixtures.
