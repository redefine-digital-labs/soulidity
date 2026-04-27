# E2E Test Results - new-web Soulidity Marketplace

> Two runs are recorded below. **Latest first**: 2026-04-27 (partial — W0 landing
> + Phase 0 + early Phase 1, against the post-Privy / wallet-stub branch). The
> 2026-04-24 PASS run further down was against the pre-Privy architecture and is
> kept as historical reference; its Soul / Collection / Imported IDs are no longer
> reachable on testnet (the package was fresh-published since).

---

## 2026-04-27 Run — W0 + Phase 0 + Phase 1 partial (PARTIAL)

**Date:** 2026-04-27
**Environment:** Sui Testnet, `http://localhost:3100`
**Branch:** `feat/remove-privy-sui-wallet-auth` (HEAD `19ca835`)
**Plan:** `docs/plans/e2e-test-plan.md`
**Accounts:** Seller `0xa9e1…947b`, Buyer `0xc652…595a`, Agent Alpha `0x3b82…8610`, Agent Beta `0x7ef4…8790`
**Status:** PARTIAL — W0 landed, Phase 0 + Tests 1.1 / 1.6 / 1.7 / 1.8 passed; Tests 1.9 → 11.1 deferred to a follow-up session.

### Scope of this session

This run covered (a) closing the two W0 work items the plan declared blocking, (b) proving the e2e wallet stub end-to-end through dapp-kit ConnectModal + post-Privy session/CSRF auth, and (c) driving two real on-chain mints + DB sync as ground truth that the upload + mint pipelines work in dev. The volume of remaining work (88 more tests, mostly browser-mediated) is left for a follow-up session — the engineering uncertainty has now been retired, what remains is regression coverage.

### W0 — execution prerequisites (now landed)

#### W0.1 Dev-only Wallet Standard stub

**File:** `web/components/providers/e2e-wallet-stub.tsx` (new). Mounted in `app-providers.tsx` behind a double gate:

1. `process.env.NODE_ENV === 'development'` — bundle-time gate
2. `process.env.NEXT_PUBLIC_E2E_TEST_MODE === '1'` — runtime gate; a normal `npm run dev` session does not register the stub even if a stale `__E2E_PRIVATE_KEY` sits in localStorage

Implements `standard:connect`, `standard:disconnect`, `standard:events`, `sui:signPersonalMessage` v1.1, `sui:signTransaction` v2, `sui:signAndExecuteTransaction` v2.

Verified flow: `localStorage.setItem('__E2E_PRIVATE_KEY', '<bech32>')` + reload → ConnectModal lists "E2E Test Wallet" → click → `standard:connect` returns the keypair-derived account → wallet-auth-bridge auto-runs `/api/auth/wallet-challenge` + `/api/auth/wallet-login` → `session` (HS256 JWT) + `csrf-token` cookies written → `/api/auth/me` returns `primarySuiAddress = $SELLER_ADDR`.

#### W0.2 Env-driven `scripts/e2e-setup-agents.ts`

Rewritten to read `E2E_AGENT_*_PRIVATE_KEY` / `E2E_AGENT_*_API_KEY` from env, derive addresses via `loadKeypairFromEnv`, and idempotently `findOrCreate` `Account` / `Member(kind='agent', agentStatus='active')` / `WalletBinding(chain='sui', address=…)`. Two consecutive runs produce identical member IDs and hashes.

#### Other supporting changes

- `web/next.config.ts` also loads `.env.local` (with `override: true`) so `NEXT_PUBLIC_E2E_TEST_MODE` and the `E2E_*` keys are visible to the dev server
- Pending migration `prisma/migrations/20260426000000_remove_privy_add_wallet_address` deployed against the live dev DB (the `accounts.privy_did` column was still present on disk)

### Dev-only short-circuit added: upload bypass

**File:** `web/lib/upload/client-upload.ts`

**Symptom:** clicking `Sign & Deploy` always 409'd 5× then surfaced "Upload binding is not ready". Vercel Blob's `onUploadCompleted` is the server-to-server callback that records the binding row; on a localhost dev server it cannot reach back to `http://localhost:3100`, so the binding row is never written and `consumeSoulUploadBinding` returns 409 indefinitely. The plan's "race retry 5 次" comment was written for production where the callback eventually wins; in dev it never does.

**Fix:** when `NODE_ENV === 'development' && NEXT_PUBLIC_E2E_TEST_MODE === '1'`, `uploadSoulPayload` POSTs directly to legacy `/api/souls/upload` (multipart FormData) instead of running the two-step Vercel Blob direct-upload. The legacy route shares the same auth (`requireSoulCreateWalletIdentity`), rate limit (`soul-upload:<memberId>`), signature/MIME validation, encryption, and Walrus path, and returns the same `SoulUploadResult` shape. Production builds skip both the env check and the legacy fall-through entirely.

**Constraint:** the legacy route is capped at the 4.5 MB Vercel serverless inbound limit. The E2E fixtures top out at `skill.zip` 5.6 KB so this is not currently a constraint. If a future fixture exceeds ~4 MB, it will need either a localtunnel/ngrok callback URL or a server-side dev-only `from-blob` synthesizing path.

### Phase 0 — pre-flight (3/3)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 0.1 | Landing `Redefine` + market/create links | ✓ | snapshot uid `1_16` `1_18` `1_20` |
| 0.2 | Market empty state + search box + Login | ✓ | snapshot uid `2_22` `2_33` `2_13` |
| 0.3 | Screenshot archive | ✓ | `e2e-artifacts/2026-04-27/phase0-market-empty.png` |

### Phase 1 — Seller login + Soul A/B mint (4/12 done)

#### Test 1.1 — Seller login via stub

- localStorage seeded → reload → `navigator.wallets` contains `E2E Test Wallet`
- Click Login → ConnectModal → click "E2E Test Wallet" → wallet-auth-bridge completes challenge + login round-trip
- `csrf-token` cookie set; `/api/auth/me.user.primarySuiAddress` = `0xa9e1293c…947b`
- **SELLER_MEMBER_ID** `55add2a7-9f9f-4d16-8828-1ed81c61907c`
- Screenshot: `e2e-artifacts/2026-04-27/phase1-seller-login.png`

#### Tests 1.2–1.5 — Wizard Step 1 / 2 / 3 / 4 (collapsed)

Step 1 form (name `E2E Soul Alpha NW`, description, tags `e2e, test`, cover `images.jpeg` cropped to webp 35.4 KB, royalty `Standard 5%` default), Step 2 uploads (`soul.md`, `memory.md`, `skill.zip` from `/Users/admin/Documents/example/`; sprite/voice intentionally empty), Step 3 preview, Step 4 gas page render.

#### Test 1.6 — Soul A mint

- TX digest `7iGmyJ5wQafvyDeBSCGb4GcbknEKGFP7y6hExUn4qQcx`
- **SOUL_A_ID** `0x92b6be965f55d4b471af8d5529e0b198fdd012dc034427def2342d7d7993d91a`
- **SOUL_A_STATE_OBJ** `0xeda22808f71e1fe677fd1e7e171a378d43c9319cd47c270b43d3d4a9943cd351`
- **SOUL_A_ACCESS_LIST_OBJ** `0x7574093895fa3393a8deda875205497a47db18418e3221defdfb39893f59e145`
- **SOUL_A_METADATA_OBJ** `0xe49d6d4727ad078163d07995b9d4767aef43c5d02279620dee4daa687e52615c`
- DB `soul_assets` mirror complete (owner = SELLER_ADDR, access_list/metadata IDs non-null, sprite/voice columns null as expected)
- DB `soul_skill_version_records`: `api-design v0` captured as `SOUL_A_INITIAL_SKILL_NAME` / `SOUL_A_INITIAL_SKILL_VERSION_INDEX`
- DB `soul_memory_entries`: 1 founding row written
- Screenshot: `e2e-artifacts/2026-04-27/phase1-soul-a-published.png`

#### Test 1.7 — Soul B mint

- TX digest `27zM73…zuM3`
- **SOUL_B_ID** `0xe98ac54d82b39a7e79e6daefd5109105fde189956a99d2d53a37b94c3db9e2ff`
- **SOUL_B_STATE_OBJ** `0x52020cbfc95cb8cef838c60bbe27803826a4b27404fccdd3667b191492c46f9d`
- **SOUL_B_ACCESS_LIST_OBJ** `0x5c289335d515f91ed1d2b4f35605adfbc3da4ba7ff741f8e5b9a646724c81bf0`
- **SOUL_B_METADATA_OBJ** `0x92ae5e28f3ffbf425b3a2dc95bdcb149750d42c61d806c3b0552bbe78895a82b`

#### Test 1.8 — Soul A detail page

- Hero badge "Held" ✓; owner CTA "List Soul" ✓
- Protocol State card shows Soul / State / Memory / Metadata IDs matching captured vars ✓
- ACCESS card: Grant capacity `0 / 1`, Skills versions `1`, Creator royalty `5.00%` ✓
- Active Grants region: `No active SoulGrant is attached to this Soul.` ✓
- Memory panel renders, founding entry visible with Founder writer-kind + lock icon ✓
- Skills panel renders, `api-design v0` row visible ✓
- On-chain `SoulState`: `access_list_id` = SOUL_A_ACCESS_LIST_OBJ, `metadata_id` = SOUL_A_METADATA_OBJ, `current_owner` = SELLER_ADDR, `grant_capacity = 1`, `creator_royalty_bps = 500` ✓

### Open items (deferred to follow-up session)

- Phase 1 remaining: Tests 1.9 (Soul B detail), 1.10 (market still empty), 1.11 (My Souls 5 tabs), 1.12 (final screenshot)
- Phase 2 → Phase 11.1: 88 tests covering listing, collection, buyer purchase, grant lifecycle, skills append, asset list edges, agent API matrix, content access epoch + duration, import wizard, API auth boundary, page renders, follow/unfollow, listing/collection delete cleanup
- Phase 7.5 / 5.8 / 11.0a Move tests still need to be exercised (`sui move test ...` against `protocol_tests.move`)
- DB final cleanup (Test 11.1) intentionally not run

### Engineering takeaways

- **W0 stub design works as a Wallet Standard adapter inside dapp-kit ConnectModal** — no extension or popup, signing is in-process via the `@mysten/sui` `Ed25519Keypair` imported in the stub.
- **Two real on-chain mints land cleanly** — full upload + Walrus + Seal envelope + `mint_native_in_personal_kiosk` PTB + post-TX mirror writes succeed end to end against testnet from a local browser session.
- **Dev short-circuit is mandatory for local E2E** until either `VERCEL_BLOB_CALLBACK_URL` gets a tunnel or `from-blob` grows a dev-mode lazy-binding fallback. Documented in `web/lib/upload/client-upload.ts` and gated so it cannot ship to production.
- **Run-time blocker not in plan**: pending DB migration `20260426000000_remove_privy_add_wallet_address` had to be deployed before `e2e-setup-agents.ts` would run. Future runs against a clean DB should `npx prisma migrate deploy` as part of Phase -1.

---

## 2026-04-24 Run — full pass (HISTORICAL)

> The architecture has changed materially since this run (Privy removed, Vercel
> Blob direct-upload unified, W0 wallet stub introduced). Object IDs below are
> from the previous package deploy and no longer resolvable on testnet. Kept
> as a snapshot of the test-plan coverage when it last ran end-to-end.

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
