# Fixed Issues

Date: 2026-03-12

### 1. High - `wallet-bind-nonce` cookie is not actually cleared

**Problem**: `wallet-bind-nonce` was set with `path: '/api/wallet/bind'`, but `cookies.delete()` was called without specifying the same path. This defaults to `path=/`, so the original cookie survives until `maxAge` expiry, allowing the challenge to be reused within the 10-minute window.

**Fix**: Changed both `cookies.delete('wallet-bind-nonce')` calls in `confirm/route.ts` to `cookies.delete({ name: 'wallet-bind-nonce', path: '/api/wallet/bind' })` so the deletion targets the correct cookie path.

Files changed:
- `web/app/api/wallet/bind/confirm/route.ts` (lines 44, 64)

### 3. Medium - Preview uploads depend on undeclared public bucket

**Problem**: Upload route uses an `agent-previews` bucket for preview images with `getPublicUrl()`, but the implementation plan only documented creating the private `agent-bundles` bucket. New deployments would fail or produce inaccessible preview images.

**Fix**: Updated `docs/plans/2026-03-12-implementation-plan.md` Step 3 to document both buckets with their correct settings (private for bundles, public for previews, with appropriate MIME types and size limits).

Files changed:
- `docs/plans/2026-03-12-implementation-plan.md` (Step 3)

### 4. Medium - `confirm-purchase` clock sync between Postgres and Sui

**Problem**: The replay guard rejected any transaction whose on-chain `timestampMs` was earlier than `intent.createdAt`. These timestamps come from different systems (Postgres vs Sui checkpoint clock). If the DB clock was ahead, a legitimate purchase confirmed immediately after intent creation would be rejected as "predates purchase intent".

**Fix**: Added a 60-second clock skew tolerance (`CLOCK_SKEW_MS = 60_000`) to the timestamp comparison, so `txTimestamp < intent.createdAt - 60s` is the actual rejection threshold. This accommodates realistic clock drift between Postgres and Sui while still blocking replay of old transfers.

Files changed:
- `web/app/api/market/confirm-purchase/route.ts` (lines 82-86)

### 5. Medium - Implementation plan missing SUPABASE_SERVICE_ROLE_KEY

**Problem**: The code introduced `createSupabaseAdmin()` and upload/download routes depend on `SUPABASE_SERVICE_ROLE_KEY`, but the implementation plan's Step 2 only mentioned the Sui variables. A fresh setup following the plan would miss this key and break marketplace storage operations.

**Fix**: Updated Task 2 / Step 2 in the implementation plan to explicitly include `SUPABASE_SERVICE_ROLE_KEY` with instructions on where to find it in the Supabase dashboard.

Files changed:
- `docs/plans/2026-03-12-implementation-plan.md` (Step 2)
