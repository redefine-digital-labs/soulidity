# E2E Test Results — new-web Soulidity Marketplace

**Date:** 2026-04-08
**Environment:** Testnet, localhost:3100 (new-web dev server)
**Package ID:** `0x93e7b3852b5f1615e2bf2714546efc5d54e3dd500de85b76215b31591f4e6e37`

## Test Variables

| Variable | Value |
|----------|-------|
| SOUL_A_ID | `0x5ed262aaecbb68033133a30df2c3d3e671190cfb1c3cdbd3a5fef1698ba90a25` |
| SOUL_B_ID | `0x4f7aab58dc36c9d28c2767f415d709736158aeb159c05deea96dbf4d3db0aca5` |
| SOUL_A_STATE_OBJ | `0xdf17344f7955002f72732374a571bfd09645cabbdac10398c632e63ced117f14` |
| Seller | ithinco@gmail.com (0x858d...eb82) |
| Buyer | tenxhunter@gmail.com (0xb9ed...614c) |
| Agent Alpha | 0x3b82...8610 |
| Agent Beta | 0x7ef4...8790 |

## Results Summary

| Phase | Tests | Pass | Fail | Deferred | Status |
|-------|-------|------|------|----------|--------|
| -1 Environment | 6 | 6 | 0 | 0 | DONE |
| 0 Pre-flight | 3 | 3 | 0 | 0 | DONE |
| 1 Create Soul A & B | 12 | 12 | 0 | 0 | DONE |
| 2 List Soul A & B | 6 | 6 | 0 | 0 | DONE |
| 3 Collection | 5 | 3 | 1 | 1 | DONE (mirror sync fail on launch) |
| 4 Buy Soul A | 6 | 6 | 0 | 0 | DONE |
| 5 Grant System | 7 | 7 | 0 | 0 | DONE |
| 6 Skills & Memory | 4 | 1 | 0 | 3 | DONE (gated by missing skillsOnChainId) |
| 7 Agent API | 6 | 5 | 0 | 1 | DONE (Seal decrypt deferred) |
| 8 Import | 5 | 5 | 0 | 0 | DONE |
| 9 API Boundary | 6 | 6 | 0 | 0 | DONE |
| 10 Page Smoke | 3 | 3 | 0 | 0 | DONE |
| 11 Cleanup | 1 | 1 | 0 | 0 | DONE |
| **Total** | **64** | **58** | **1** | **5** | |

## Bugs Found & Fixed

### Bug 1: Move contract not published (commit 82f8425)
- **Symptom:** `mint_native_in_personal_kiosk` TX failed with "Incorrect number of arguments"
- **Root cause:** Local Move source added `initial_skill_name` parameter but contract wasn't published to testnet
- **Fix:** Published new contract package `0x93e7b3...`, updated .env with new package/config IDs

### Bug 2: `readNestedObjectId` extracts wrong kiosk ID
- **File:** `new-web/lib/soulidity/queries.ts:260`
- **Symptom:** "No Soulidity personal kiosk found for this wallet" on sell page
- **Root cause:** `readNestedObjectId` checked `id` field before `for` field. For `KioskOwnerCap`, `id` is the cap's UID while `for` is the actual kiosk ID. The extracted ID pointed to a wrapped object that doesn't exist as top-level, causing `filterExistingPersonalKiosks` to filter ALL kiosks out.
- **Fix:** Moved `for` check before `id` check in `readNestedObjectId`

### Bug 3: `useListSoul` resolves wrong kiosk for listing
- **File:** `new-web/lib/hooks/use-list-soul.ts`
- **Symptom:** `EPersonalKioskMismatch` (abort code 14) when listing a Soul
- **Root cause:** The sell hook resolved the seller's "generic" personal kiosk via API, but used a different kiosk than the one holding the Soul. With multiple kiosks, the resolved one didn't match.
- **Fix:** Use `soul.currentKioskId` / `soul.currentKioskCapOnChainId` (the Soul's own kiosk) instead of resolving via `/api/souls/personal-kiosk`

### Bug 4: Hardcoded USDC coin type in agent purchase route
- **File:** `new-web/app/api/agent/souls/[id]/purchase/route.ts:18`
- **Symptom:** "Insufficient USDC balance for purchase" despite sufficient balance
- **Root cause:** `PAYMENT_COIN_TYPE` was hardcoded to `0xa1ec...::usdc::USDC` but actual testnet USDC is `0x79d8...::usdc::USDC`
- **Fix:** Changed to `getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE')`

### Bug 5: E2E scripts only accept mnemonic, not suiprivkey
- **Files:** `new-web/scripts/e2e-agent-purchase.ts`, `new-web/scripts/e2e-agent-decrypt.ts`
- **Symptom:** Scripts fail if `AGENT_MNEMONIC` not set
- **Fix:** Added `AGENT_PRIVATE_KEY` (suiprivkey format) as alternative input, using `decodeSuiPrivateKey` + `Ed25519Keypair.fromSecretKey`

## Remaining Gaps

- **Phase 3.4 (Collection Launch mirror):** On-chain TX succeeded but `mirror add-soul transaction` failed. Bug: collection mirror sync route issue.
- **Phase 6.2 (Skills append):** Gated — `skillsOnChainId` is null in DB after mint (publish mirror bug, skills root not captured).
- **Phase 6.3 (Memory append):** Gated — `__e2eAppendMemory` helper not yet implemented.
- **Phase 6.4 (Owner decrypt skills):** Gated — depends on skillsOnChainId being non-null.
- **Phase 7.6 (Agent Seal Decrypt):** Requires Seal key server network access and `@mysten/seal` SDK.

## New Bug Discovered

### Bug 6: `skillsOnChainId` not mirrored during publish
- **Location:** Publish mirror sync (post-TX API route)
- **Symptom:** After minting a Soul with skill.zip, `SoulAsset.skillsOnChainId` is null in DB, but skill version records exist
- **Impact:** Skills panel shows "no root", Decrypt and Append both fail
- **Root cause:** The mint TX creates a SoulSkills object on-chain but the mirror sync doesn't extract and save its object ID

### Bug 7: Collection add-soul mirror sync fails
- **Location:** Collection publish flow mirror sync
- **Symptom:** "Failed to mirror add-soul transaction" after successful on-chain TX
- **Impact:** Collection created on-chain but DB state incomplete

## Screenshots

| File | Description |
|------|-------------|
| `phase0-market-empty.png` | Market empty state before any souls |
| `phase1-seller-login.png` | Seller logged in |
| `phase1-soul-a-published.png` | Soul A published success |
| `phase1-seller-done.png` | My Souls with 2 souls owned |
| `phase2-soul-a-listed.png` | Soul A listed at 1 USDC |
| `phase2-market-listed.png` | Market showing 2 listed souls |
| `phase3-collection-created.png` | Collection launch (mirror sync fail) |
| `phase4-buyer-login.png` | Buyer logged in |
| `phase4-soul-a-purchased.png` | Soul A purchase success |
| `phase5-grant-issued.png` | Grant issued to Agent Alpha |
| `phase8-import-done.png` | Import Soul success |
| `phase11-cleanup.png` | Market restored to empty state |
