# E2E Test Results - new-web Soulidity Marketplace

**Date:** 2026-04-24
**Environment:** Sui Testnet, `http://localhost:3100`
**Test Data:** `/Users/admin/Documents/example`, `/Users/admin/Documents/example-collection`
**Accounts:** seller `ithinco@gmail.com`, buyer `tenxhunter@gmail.com`
**Status:** PASS - all planned phases completed and cleaned up.

## Deployment

| Item | Value |
| --- | --- |
| Package ID | `0x0b79af1ffb805632236370bba9539aacbb8f917e4a26a2761bc189f193b95205` |
| MarketConfig | `0x252255abd42007f0a2b3fad596c7b0705f19979436ed043fb24f2047050827fe` |
| KioskRegistry | `0xec8c87496f40c640411f8b4b0ee76d5b171de4fcf5aa49062ba7db4c1a15e30c` |
| Soul TransferPolicy | `0x5e5711e21db5e445c03a59154bcb1fd889efc111cd42180f28c7a3adbe9ae92f` |
| Collection TransferPolicy | `0x97bf30a371ab12bd3184357cb69dd0ec8c1503ab730390166c4279173a8851db` |
| Publish TX | `HKenfarHCL6jnrqS2CosAkVNc7zBTTVXfpby5RB62i7r` |

## Primary Objects

| Variable | Value |
| --- | --- |
| SOUL_A_ID | `0xb064155ba5802cfab0696a617187faf24fe2f138e65d134a100b34f130dae269` |
| SOUL_B_ID | `0x985bd293db831fd8bb60ea701563ff8e696d9a6bf7e46074ad8aafa5a3908ab3` |
| COLLECTION_ID | `0x696d16f967700d4fc418d1058c1b5793efc688338cf775f5d0d93a6558d7188b` |
| IMPORTED_SOUL_ID | `0x1022e706e3d34b4047fd31f538fc1c92d0e35b297819f7994137697fce71e455` |
| Agent Alpha | `0x3b82a2209ab7f937d29c12105fe501a63f4223a7f5c128842d25686e66a68610` |
| Agent Beta | `0x7ef4e29eba6968cd8f255d3533116fd593a71dfb6d23f6e7b03271603c238790` |

## Results Summary

| Phase | Scope | Status |
| --- | --- | --- |
| -1 | Environment, DB cleanup, Sui CLI, account and agent setup | PASS |
| 0 | Market empty state, landing page, deployment smoke | PASS |
| 1 | Seller login, create Soul A and Soul B with metadata mirror | PASS |
| 2 | List Soul A and Soul B, market filters | PASS |
| 3 | Collection create, add child Soul, list/delist, floor guard | PASS |
| 4 | Buyer login, bookmark, buy Soul A | PASS |
| 5 | Grant issue/access/revoke, grant capacity, destroy invalidated grant | PASS |
| 6 | Append private skill version and verify assets API boundaries | PASS |
| 7 | Agent search/detail/prepare/purchase/decrypt/access matrix | PASS |
| 7.5/7.10 | Content access pricing, expiry, quote, resale epoch invalidation, kiosk registry guards | PASS |
| 8 | Import wizard with `soul.md`, `memory.md`, `skill.zip`, cover image | PASS |
| 9 | API boundary and hardening checks | PASS |
| 10 | Community/resources/wrap-link/leaderboard/stats/profile follow smoke | PASS |
| 11 | Delete inactive listing objects, DB cleanup, market empty state | PASS |

## Fixes Applied During Run

1. `readNestedObjectId` now accepts direct non-empty string `Option<ID>` values, fixing metadata and related object extraction.
2. Publish sync now backfills `metadataOnChainId` when the mint TX produced metadata but the mirror response did not include it.
3. Added `/api/souls/[id]/grant-capacity` and mirror route tracking for `grant:capacity`, so owner grant-capacity changes persist in DB.
4. Agent purchase preparation is idempotent for duplicate `(agentMemberId, txBytesHash)` retries.
5. Content-format copy/spec now use `skill.zip`, matching the actual fixture and import/create UX contract.

## Verification

| Check | Result |
| --- | --- |
| `sui move test --path move/soulidity` | 149 passed before fresh deploy |
| `npm run test -- tests/new-web/soul-grant-capacity-route.test.ts tests/new-web/mirror-sync-regression.test.ts tests/new-web/read-nested-object-id.test.ts tests/new-web/soulidity-mirror-upsert.test.ts` | 50 passed |
| `npm run test -- tests/new-web/agent-purchase-prepare-route.test.ts tests/new-web/soul-grant-capacity-route.test.ts` | 4 passed |
| `npm run test -- tests/new-web/soulidity-deployment.test.ts` | passed |
| `sui move test --path move/soulidity delete_active_soul_listing_fails` | passed |
| Phase 9 API boundary | all 9 expected HTTP statuses passed |
| Phase 11 DB cleanup | target tables all zero |

## Cleanup Evidence

| Item | Result |
| --- | --- |
| Soul A inactive listing delete TX | `DLe2H4im2Q6deQvbBn13VG8cRfyAnBL1eERSFH4ag5zd` |
| Collection inactive listing delete TX | `73VY9nNrmpz1ViWVTHPDumLmEnitpibP1coPZDYJiy2x` |
| Deleted listing object checks | both return object-not-found |
| DB target tables | `soul_*`, `content_access_records`, `bookmarks`, `follows` all zero |
| Final market page | shows `No live Soul listings` |

## Key Artifacts

Artifacts are under `e2e-artifacts/2026-04-24/`.

| File | Description |
| --- | --- |
| `phase0-market-empty.png` | Market empty state before run |
| `phase1-soul-a-published.png` | Soul A publish success |
| `phase1-soul-b-published.png` | Soul B publish success |
| `phase2-market-listed.png` | Market with live listings |
| `phase3-collection-created.png` | Collection created |
| `phase4-soul-a-purchased.png` | Buyer purchase success |
| `phase5-grant-issued.png` | Grant issued to Agent Alpha |
| `phase6-skill-version-appended.png` | Skill version append success |
| `phase7-agent-access-matrix.json` | Agent access matrix |
| `phase7-agent-alpha-decrypt-soul-b.log` | Agent decrypt proof |
| `phase7_10g-seller-repurchase-after-resale-tx.json` | Resale epoch repurchase proof |
| `phase8-import-preview.png` | Import preview |
| `phase8-import-done.png` | Import on-chain success |
| `phase9-api-boundary.json` | API boundary status matrix |
| `phase10-follow-toggle.png` | Follow/unfollow smoke |
| `phase11-db-cleanup.json` | DB cleanup counts |
| `phase11-cleanup.png` | Final empty market |
