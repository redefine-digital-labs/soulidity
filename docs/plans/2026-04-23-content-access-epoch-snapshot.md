# Content Access Epoch Snapshot (M-2)

**Status**: Implemented 2026-04-23. Contract + mirror + API landed; no UI changes required.

**Goal**: Close M-2 — `ContentAccessList.entries` persisted across Soul ownership rotation, creating an asymmetry with `SoulGrant` (which auto-invalidates via `ownership_epoch_snapshot`) and enabling a "sell cheap access then sell the Soul" arbitrage that left the new owner with free-riding subscribers.

## Problem

The old contract paid `purchase_content_access` proceeds to `soul::current_owner(state)` (so content access is an *owner* cash flow), yet entries had no ownership-epoch concept — they survived intact across a Soul sale. Consequences:

1. Economic asymmetry: the seller collected the access fees AND the Soul sale proceeds, while the next owner inherited service obligations without compensation.
2. API inconsistency: `SoulGrant` auto-invalidated on `soul::rotate_owner` via `grant::invalidate_all_for_owner_rotation`, but `ContentAccessList` ignored the same event.
3. Seal limitation partly masked the issue — buyers who had already downloaded a decryption key could continue decrypting the blob versions they had pulled. But any *new* blob version (a fresh skill revision, a new asset upload) is a distinct Seal document and requires a fresh `seal_approve_*_allowlisted` round-trip, which is where the stale entry should be rejected.

## Design

Mirror the `SoulGrant.ownership_epoch_snapshot` contract on `ContentAccessEntry`:

- Each entry records the `SoulState.ownership_epoch` at grant time.
- Access checks (`has_access`, and by extension `seal_approve_skill_allowlisted` / `seal_approve_asset_allowlisted`) assert the snapshot matches the current state epoch; mismatches are treated as "no access" alongside scope-mask / expiry failures.
- Entry rows are retained (never wiped) for audit / refund trails. Re-purchase under the new owner overwrites the stale row rather than blocking with `EAlreadyHasAccess`.
- Event parity: `ContentAccessGranted` gains the same field so mirror layers can persist it.

Crucially, `has_access` now takes a `SoulState` argument and asserts `list.soul_id == soul::soul_id(state)`, so the epoch check cannot be bypassed by passing an unrelated Soul's state.

## Changes Landed

### Contract (`move/soulidity/sources/content_access.move`)

- `ContentAccessEntry` — add `ownership_epoch_snapshot: u64`.
- `ContentAccessGranted` — event gains `ownership_epoch_snapshot`.
- `has_access(list, state, addr, required_scope, clock)` — signature now requires `&SoulState`; returns false on soul_id mismatch assert, missing entry, scope subset mismatch, epoch mismatch, or expiry.
- `record_purchase(list, state, buyer, price_paid_atomic, clock)` — signature gains `state`; stale-epoch entries can be overwritten (previous buyer re-purchases under new owner).
- `add_access` — same epoch-aware renewal.
- `seal_approve_skill_allowlisted` / `seal_approve_asset_allowlisted` — thread `state` into `has_access`.

`market::purchase_content_access` updated to pass `state` through to `record_purchase`.

### Tests (`move/soulidity/sources/protocol_tests.move`)

Added:
- `content_access_invalidates_and_allows_repurchase_after_ownership_rotation` — buyer purchases under creator epoch=0 → `has_access` true; secondary buys the Soul → epoch=1 → buyer's `has_access` returns false for all scopes, `entry_count == 1` (row retained); buyer re-purchases under secondary → `has_access` true again, still `entry_count == 1` (stale row overwritten).
- `seal_approve_asset_allowlisted_fails_after_ownership_rotation` — mirror scenario but exercises the entry-function path; expects `EScopeMismatch` abort.

Updated: all 11 existing `content_access::has_access(...)` call sites gain the `&state` argument.

Total Move tests: 149/149 passing.

### Prisma + Mirror + API

- `prisma/schema.prisma::ContentAccessRecord` — new `ownershipEpochSnapshot Int @map("ownership_epoch_snapshot")`.
- Migration `prisma/migrations/20260423130000_content_access_epoch_snapshot/migration.sql` — `ADD COLUMN NOT NULL DEFAULT 0`, then `DROP DEFAULT` so future writes must supply the value.
- `web/lib/soulidity/events.ts` — `extractContentAccessGrantedEvent` + `extractMatchedContentAccessGrantedEvent` return `ownershipEpochSnapshot`.
- `web/lib/soulidity/mirror/upsert-content-access.ts` — `upsertContentAccessProjection` accepts `ownershipEpochSnapshot` and writes it on both `create` and `update` branches (update branch rewrites the snapshot on re-purchase, so a stale row gets refreshed to the current epoch).
- `web/lib/soulidity/mirror/sync-helpers.ts::syncContentAccessProjectionFromChain` — signature gains the field.
- `web/app/api/souls/[id]/access-list/add/route.ts` — persists the snapshot from the `ContentAccessGranted` event.
- `web/app/api/souls/[id]/access-list/purchase/route.ts` — persists the snapshot from the paired grant event.
- `web/lib/soulidity/asset-version-access.ts` — `contentAccessRecord.findFirst` filters on `ownershipEpochSnapshot: state.ownershipEpoch`, so stale rows are skipped and the access flow 403s early instead of deferring rejection to Seal.
- `web/app/api/agent/souls/[id]/assets/[assetName]/versions/[versionIndex]/access/route.ts` — same filter for the agent route.

### Documentation

- `CLAUDE.md` — `ContentAccessList per Soul` invariant upgraded with the epoch-pinning contract.
- `docs/audits/2026-04-03-soulidity-audit.md` — Fix Log section extended with M-2.

## Verification

- `sui move test` → 149 pass, 0 fail. Two new regression tests (`content_access_invalidates_and_allows_repurchase_after_ownership_rotation`, `seal_approve_asset_allowlisted_fails_after_ownership_rotation`) cover the rotation path.
- `npm run typecheck:web` + `npm run typecheck:root` → clean.
- `npx vitest run tests/new-web/soulidity-mirror-upsert.test.ts tests/new-web/soulidity-access.test.ts tests/new-web/soulidity-sync-helpers.test.ts` → pass. (`soulidity-events.test.ts` has two pre-existing failures from an unrelated `SoulMintedToKiosk` metadata fixture drift on the branch; not introduced by this change, not touching `ContentAccessGranted`.)

## Why This Only Affects Future Access Requests

The Seal key material, once released by the key servers to a client, is cached client-side. Re-fetching a cached key does not require a fresh `seal_approve_*` call, so a buyer who already downloaded the key for a specific `document_id` retains the ability to decrypt *that* blob. However, each new blob version (e.g. a skill v2 upload by the new owner) has a distinct `document_id` and therefore requires a fresh `seal_approve_*_allowlisted` call — which now fails. This means the fix closes the door on the "next owner updates content; stale subscribers ride along" variant of the bug, even though it cannot retroactively revoke already-downloaded keys.

## Known Non-Issues

- **Prisma DEFAULT 0 on backfill**: The migration uses `DEFAULT 0` only so the `NOT NULL` constraint holds for any legacy rows; on-chain data always supplies the real value. We `DROP DEFAULT` immediately afterward so future inserts without the field (bugs) fail loudly rather than silently write 0.
- **No frontend UI changes**: The subscriber listing at `GET /api/souls/[id]/access-list` already returns all Prisma columns via spread, so UI consumers automatically receive `ownershipEpochSnapshot`. A "stale" badge can be computed client-side from the current Soul epoch without further backend work.
