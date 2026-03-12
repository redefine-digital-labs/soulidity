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

---

## Round 2 (2026-03-12)

### 6. High - `seed-market` 不是幂等的，第二次执行会直接失败

**Problem**: 脚本用 `tgName: 'mock_seller'` 查卖家，但创建的成员 `tgName` 是 `'OpenClaw 官方'`。第二次执行永远查不到已创建的卖家，重复插入 `tgId: '999999001'` 触发唯一键约束失败。

**Fix**: 改为用 `tgId: '999999001'` 查找，与创建值保持一致。

Files changed:
- `src/db/seed-market.ts` (line 163)

### 7. High - `BigInt` 序列化修复未覆盖发布接口

**Problem**: `POST /api/market/publish` 直接 `NextResponse.json(result)` 返回，`result.listing.priceMist` 是 Prisma 的 `BigInt`，JSON 序列化会抛 `TypeError: Do not know how to serialize a BigInt`。

**Fix**: 将 `listing.priceMist` 显式转成字符串后返回，与其它 market 接口保持一致。

Files changed:
- `web/app/api/market/publish/route.ts` (line 64)

### 8. Medium - 价格 hook 命名不符合 React Hooks 规则

**Problem**: `usesuiPrice` 不匹配 React Hooks lint 期望的 `use[A-Z]...` 模式，导致 `react-hooks/rules-of-hooks` lint 报错。

**Fix**: 重命名为 `useSuiPrice`，同步更新调用点。

Files changed:
- `web/app/market/page.tsx` (lines 29, 66)

### 9. Medium - `seed-market` 钱包查询条件与发布接口不一致

**Problem**: seed 脚本查 wallet 时只按 `memberId` 查第一条绑定，没有限制 `chain: 'sui'` 和 `isPrimary: true`，与正式发布流程条件不一致。

**Fix**: 添加 `chain: 'sui', isPrimary: true` 筛选条件。

Files changed:
- `src/db/seed-market.ts` (line 178)

---

## Round 3 (2026-03-12)

### 10. Medium - `POST /api/market/publish` 对非法 `priceMist` 会直接返回 500

**Problem**: `BigInt(priceMist)` 对非整数字符串（如 `"1.5"`、`"abc"`）会抛 `SyntaxError`，接口返回 500 而非 400 校验错误。公开 POST 接口不应把参数校验问题升级为服务器错误。

**Fix**: 用 try-catch 包裹 `BigInt()` 转换，捕获异常后返回 400 和明确的错误信息 `"priceMist must be a valid integer string"`。

Files changed:
- `web/app/api/market/publish/route.ts` (lines 31-35)
