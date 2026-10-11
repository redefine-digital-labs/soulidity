# Soulidity Phase Handoff: new-buyer-atomic

## Snapshot

- Created: 2026-10-09T21:00:52+03:00
- Phase: new-buyer-atomic
- Status: in-progress
- Goal: Continue complete all-contract goal; restore first-user creation and purchase in one atomic PTB with sealed native custody capability
- Worktree: `/Users/naoer/.codex/worktrees/soul-dof-v1-rebuild/soulidity`
- Branch: `codex/soul-dof-v1-contracts`
- Commit: `0cfb60a29b2b378dd9fbf31970b324b2ef2e301e`
- Working tree: dirty (24 status entries)
- Handoff: `docs/codex/handoffs/20261009-new-buyer-atomic.md`

## Outcome

Original collection_buy_snapshot_tests has existing/new buyer branches. custody.create persisted objects and returned only ID, losing new-user one-PTB flow. Add custody.new returning linear real Kiosk/Account and finalize validating sender/pair before persistence;create shares same implementation. Account key-only/no-drop,cap private. Only custody production source changes,59inputs frozen;1037VM retainsall1031 plus6,325foreign=82legal243intendeddiag retainsold321sourcehashes plus4. Coreactualcompatiblev5 b931,99350B;two builds/bytecode/origins/linkage/Cap exact,no newtypes/role rotation. ZeroAccount buyer signs one new-buy-finalize PTB;rawcommands and exact NestedResult pair audited. Firstcreator container+collection onePTB. Crossed realpairs/underpayment/post-settlement finalize failure allabort with no createdobjects and realdeep rollback;right originallyID relocked,newAccount usable list/cancel.9originalsigned6success3MoveAbort,allrawBCS/sender/intent exact,no replay. Fivewallet delta-816692551+allGas816692548+platform3=0;othercoins and protected7roots/issuer/blobs unchanged. Config31/income185 roles/directories same. Slack8rows14cells568others30IDs/schema/owners/status/stage exact. Node62523/session3618SIGINT0,5stores/networkidentity/primaryCURRENT retained. Harness framework readonly-arg and ABI abilities nesting fixed,no weakening. BothVault scopes required/read!=spend,AgentPass deferred. Wholegoalactive/30partial,4community49old duties reviewed/1479pending,Releasefalse.

## Scope and non-goals

### In scope

- Use the goal statement as the recorded scope.

### Intentionally not done

- No production,SDK/frontend/37live,Git,agents,AgentPass,independent audit or KMS/service claim.

## Durable decisions

- First-use APIs return real linear objects;finalize seals exact pair and sender. Account key-only/no-drop;no native cap escape or arbitrary recipient. create is one convenience path over same implementation.
- Adding compatible APIs without changing business roles preserves existing marker definitions and roles;callable package and marker definingID serve distinct purposes.

## Changed paths and assets

### Changed paths

- move/soulidity_v1/sources/custody.move
- move/soulidity_v1/tests/custody_creation_tests.move
- move/soulidity_v1/tests/collection_tests.move
- scripts/verify_contract_ability_probes.py
- output/contract-rebuild/new-buyer-atomic-2026-10-09
- docs/CONTRACT_REBUILD_SPEC_CN.md
- docs/CONTRACT_REBUILD_COVERAGE.json
- docs/CONTRACT_SECURITY_REVIEW_CN.md
- docs/codex/PROJECT_MEMORY.md

### Image and binary assets

- No image or binary assets recorded.

### Relevant commits

- No additional commit references recorded.

## Verification

- verify_increment.py PASS:59frozeninputs/onlycustody source/1037VM/325foreign old321SHAs/compatibleCorev5 actual99350B/allorigins-linkage-bytecodeCap/no newtypes-roles.
- 9originaldigests6success3MoveAbort/rawBCS sender intent/3deep rollback no createdobjects/exact new-buy-finalize commands sameNestedResultpair/SUI+Gas+platform3 difference0.
- Protected roots/Maker/Control/3Blobs/othercoins unchanged;Slack8rows14cells568others/30rows/schemaownersstatusstage exact;nodeSIGINT0/5stores/networkidentity/primaryCURRENT retained.

## Risks and recovery

### Risks or blockers

- Remaining original26modules1479 semantics,allmarket permission/upgrade combos,recovery contention,expiredreupload/sourcecontinuity and independentreview;wholeRelease unproved.

### Recovery or rollback points

- Keep bootstrap-next-evidence exact package/Cap/object IDs;Config31 income185/newAccountnewKiosk statuses.9intents originaldigests retained;source rollback does not reverse chain upgrade. No DB/Genesis reset or whole journey replay.

### Working-tree evidence

```text
?? docs/CONTRACT_REBUILD_COVERAGE.json
?? docs/CONTRACT_REBUILD_SPEC_CN.md
?? docs/CONTRACT_SECURITY_REVIEW_CN.md
?? docs/SOUL_ARCHITECTURE_REVIEW_CN.md
?? docs/SOUL_STANDARD_KERNEL_CN.md
?? docs/codex/
?? move/soulidity_application/
?? move/soulidity_community/
?? move/soulidity_content/
?? move/soulidity_foundation/
?? move/soulidity_model/
?? move/soulidity_standard/
?? move/soulidity_v1/
?? move/soulidity_visual/
?? move/standard_examples/
?? output/
?? scripts/codex/
?? scripts/inspect_contract_dependencies.py
?? scripts/profile_move_function_trace.py
?? scripts/verify_contract_ability_batches.py
?? scripts/verify_contract_ability_probes.py
?? scripts/verify_contract_publication_budget.py
?? scripts/verify_soul_standard_external.py
?? scripts/verify_soul_standard_local.mjs
```

## Exact next action

Continue original Collection and market complete semantic-duty coverage, then other26modules1479 production declarations;new-buyer one-PTB gap is closed,do not reopen/rerun it. Authoritative new-buyer-atomic-2026-10-09/bootstrap-next-evidence.json and phase-state: Coreb931v5/Appc731v7/Foundationc567v2,Config31 income185;Soulc3bc remainsAlice;originalRight nowab5b buyer epoch3,Kiosk/Account there;newfirstcreator collection andwallet IDs included. Market/CollectionRevision3 still definedcb53v4,otherroles/directories unchanged,do not pin to currentCore merely because APIs added. Node62523/session3618 stopped0;restart retainedae60751d/137 for nextneededPTB,no reset/no full-script replay,freshClock expiry for newintent. Remainingallmarket permission/upgrade combos,recovery contention,expiredreupload/sourcecontinuity and independentreview. No agents/Git/production/SDK/frontend/37live/AgentPass.
