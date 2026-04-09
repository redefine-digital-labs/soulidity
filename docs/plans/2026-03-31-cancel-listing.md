# Cancel Listing (Delist) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow Soul owners to cancel an active listing and return the Soul to 'held' status.

**Architecture:** Mirrors the existing allowlist-clear pattern — on-chain TX via `cancel_listing` → extract `SoulListingCancelled` event → mirror to DB. No new Move contract changes needed (function already exists).

**Tech Stack:** Next.js API route, Sui Move transaction builder, on-chain event verification, Prisma DB mirror

---

### Task 1: Event extractor in on-chain-verification.ts

**Files:**
- Modify: `web/lib/souls/on-chain-verification.ts`

Add `VerifiedSoulListingCancelledEvent` interface and `extractSoulListingCancelledEvent` function following the existing `extractSoulPurchasedEvent` pattern.

Event fields from Move contract `SoulListingCancelled`:
- `listing_id: ID` → `listingObjectId: string`
- `soul_id: ID` → `soulObjectId: string`
- `kiosk_id: ID` → `kioskId: string`
- `seller: address` → `sellerAddress: string`

### Task 2: Transaction builder in tx-builder.ts

**Files:**
- Modify: `web/lib/souls/tx-builder.ts`

Add `buildCancelListingTx` following the `buildListHeldSoulTx` pattern. Calls `ensure_personal_kiosk_registered` then `cancel_listing`.

Params: `currentKioskId`, `currentKioskCapOnChainId`, `listingObjectId`

### Task 3: DB cancel function in post-tx-db.ts

**Files:**
- Modify: `web/lib/souls/post-tx-db.ts`

Add `dbCancelSoulListing` that sets `listingStatus: 'held'`, `listingObjectOnChainId: null`, `listedPriceAtomic: null`. Uses `buildSoulMirrorWhere` with `expectedListingStatus: 'listed'` guard.

### Task 4: Delist API route

**Files:**
- Create: `web/app/api/souls/[id]/delist/route.ts`

POST handler following the allowlist DELETE pattern:
1. requireIdentity + rate limit
2. Verify Soul is listed + caller is owner
3. Extract `SoulListingCancelledEvent` from TX
4. Verify event matches Soul
5. Call `dbCancelSoulListing`
6. Store tx-sync with routeKey `'delist'`

### Task 5: Detail page cancel UI

**Files:**
- Modify: `web/app/souls/[id]/page.tsx`
- Modify: `web/lib/souls/tx-builder.ts` (import)

Add cancel listing section visible when `isOwner && listingStatus === 'listed'`:
- State: `cancelSubmitting`, `cancelError`
- Handler: build TX → sign → mirror to `/api/souls/{id}/delist` → refetch
- UI: "Cancel listing" button in a new owner panel

### Task 6: Tests

**Files:**
- Modify existing tests as needed for new exports

## Verification

1. `npm test` — all tests pass
2. Manual: List a Soul → see cancel button → cancel → Soul returns to 'held'
