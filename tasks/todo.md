# Soulidity Audit 2026-05-04 Fix Pass

Reference: `docs/audits/2026-05-04-soulidity-audit.md`

## Scope

Audit identified 1 Medium + 3 Low + 1 Accepted + 1 Excluded (deferred to multisig). This pass closes Low #3, Low #4, Medium #2 short-term, Low #5 doc, in one shot. #6 accepted as-is. UpgradeCap / Admin Cap centralization deferred to multisig handoff per user.

## Done

- [x] **Low #3** `paid_access::revoke_access` / `cleanup_stale_entries` — drop empty inner `Table<u32, KindPaidEntry>` and remove the outer `entries[buyer]` row via new private `drop_empty_buyer_row` helper. Indexer-friendly `has_buyer_row(addr)` getter added so off-chain tooling and tests can observe outer row presence.
- [x] **Low #4** `SoulState.is_listed: bool` field + `set_listed` package fn. `market::list_soul_fixed_price{,_with_collection}` take `&mut SoulState` and flip it on; `market::cancel_soul_listing` adds `&mut SoulState` and flips off; `buy_soul_impl` clears it after rotation. `collection::add_soul` aborts with new `ESoulCurrentlyListed=6`. TS SDK `buildDelistSoulTx` / `buildUpdateListingPriceTx` carry the `stateObjectId`; `web/components/souls/listing-modals.tsx` passes it through. `market-errors.ts` + tests updated for the new collection code.
- [x] **Medium #2 (short-term)** `purchase_paid_access` / `revoke_access` carry explicit doc that paid access is owner-revocable subscription, with on-chain events (`SoulPaidAccessRevoked`, `ContentVersionDeleted`, `ContentVersionPurged`) for buyer-side indexing. `CLAUDE.md` System Invariants codifies the trust boundary + the unverified `imported` `origin_ref` alongside it.
- [x] **Low #5** `mint_imported_in_personal_kiosk` doc-comment now explicitly labels `origin_ref` as an unverified off-chain claim and points at the multisig / oracle path that would be required for verified provenance.

## Move tests

- `paid_access_revoke_drops_empty_buyer_row` — single-kind revoke path drops the outer row.
- `paid_access_cleanup_drops_empty_buyer_row_on_rotation` — `cleanup_stale_entries` after rotation drops the outer row.
- `add_soul_aborts_when_soul_currently_listed` — solo list → add_soul abort `ESoulCurrentlyListed`.
- `add_soul_succeeds_after_listing_cancelled` — list → cancel → add_soul ok, supply increments.

Existing `version_fields_cover_persistent_objects` + `list_and_buy_soul_rotates_owner_and_invalidates_grants` already exercise the new `&mut SoulState` signatures and were updated in-place. Total Move suite: 90/90 green.

## TS/Web tests

- `tests/new-web/market-errors.test.ts` — extended to cover `ESoulCurrentlyListed (6)` mapping + HTTP 409.
- `tests/new-web/soulidity-tx-builders.test.ts` — `buildDelistSoulTx` regression now asserts `stateObjectId` is wired in.
- Vitest suite: 1464/1464 green. The 2 stale regression tests (`asset-access-seal-regression`, `skill-access-seal-regression`) referenced deleted phase-1 modules (`assets.move`, `skills.move`, `content_access.move`) and were removed — they were guarding `seal_approve_*` symbols that no longer exist; phase 2's `seal_approve_content_*` path is covered by `protocol_tests.move`.

## Out of scope

- Multisig handoff for `UpgradeCap` / `MarketAdminCap` / `KindAdminCap` (excluded per user).
- Phase-2 stale TS/test cleanup (`asset-access*.ts`, `skill-access*.test.ts`, etc.) — tracked in unified-content-phase2 plan, not an audit finding.
- Promoting paid access into a guaranteed term (would require slot-level receipts, delete-lock window, or refund rail). Deferred until product-side decision.

---

# Soulidity Unified Content Kind Matrix — Phase 2 Hard Cut

Plan: `docs/plans/2026-05-04-soulidity-unified-content-phase2.md`
Decisions (all "最激进版"): D1 = single-name + version-incrementing memory; D2 = soul.md folded into SoulContent; D3 = pure-PUBLIC slot is plaintext (not Seal); D4 = paid_access per-kind; D5 = full hard cut.
User constraint: **all Move changes must have Move tests**.

## Step 1 — `kind_registry.move` 扩展

- [x] 1.1 在 `KindDescriptor` 加 `op_mask: u64` / `read_mode_mask: u64` 字段
- [x] 1.2 加 4 个 op_mask bit 常量 (`OP_APPEND / OP_DELETE / OP_PURGE / OP_ACTIVE_BIND`) 与 4 个 read_mode bit 常量 (`READ_OWNER / READ_GRANT / READ_PAID / READ_PUBLIC`)
- [x] 1.3 `register_kind` 入参扩展（含 op_mask, read_mode_mask）
- [x] 1.4 `assert_valid_default_grant_scope` 改为按 `read_mode_mask` 决定是否允许 grant scope；放宽到允许 SCOPE_SEAL / SCOPE_MEMORY
- [x] 1.5 加 invariant assert: op_mask 子集校验、read_mode_mask 必含 OWNER、has_active_binding 与 OP_ACTIVE_BIND 双向等价、READ_PUBLIC ⇒ requires_download_policy
- [x] 1.6 `init` 时一次性预注册 5 个内置 kind (SOUL_DOC=0, MEMORY=1, SKILL=2, SPRITE=3, AUDIO=4) 并设置 op_mask / read_mode_mask
- [x] 1.7 加测试 8.1 全部 11 个用例（kind_registry 测试组）

## Step 2 — `content.move` 扩展

- [x] 2.1 `ContentSlot` 加 `read_mode_mask: u64` / `op_mask: u64` / `seal_encrypted: bool` 字段，append-time 缓存
- [x] 2.2 `append_version_impl` 加 `OP_APPEND` 断言；`append_initial_version` 不读断言
- [x] 2.3 按 read_mode_mask 决定 `seal_encrypted`：纯 PUBLIC → false；其他 → true
- [x] 2.4 `delete_version_as_owner` / `delete_version_as_granted_agent` 加 `OP_DELETE` 断言
- [x] 2.5 `purge_deleted_version_as_owner` 加 `OP_PURGE` 断言
- [x] 2.6 `set_active` / `clear_active` 加 `OP_ACTIVE_BIND` 断言（与 has_active_binding 对齐）
- [x] 2.7 `seal_approve_content_owner` 加 `READ_OWNER` 断言
- [x] 2.8 `seal_approve_content_granted_agent` 加 `READ_GRANT` 断言
- [x] 2.9 新增 `seal_approve_content_public(id, state, content, kind, name, version, _ctx)`，校验 `READ_PUBLIC`、`seal_encrypted=true`、slot 未删除/未 purge
- [x] 2.10 新增错误码 `EOpNotAllowed=18 / EReadModeNotAllowed=19 / EPublicSlotNoSeal=20 / ESoulDocAlreadyExists=21 / EMemoryNameMismatch=22 / EOwnerReadModeRequired=29`
- [x] 2.11 加测试 8.2 全部 13 个 op 用例
- [x] 2.12 加测试 8.3 全部 14 个 read_mode 用例
- [x] 2.13 加测试 8.7 全部 5 个 grant scope 共存用例

## Step 3 — `paid_access.move` per-kind 改造

- [x] 3.1 新数据结构 `KindPaidConfig` (price/scope/duration) + `KindPaidEntry` (kind/scope/expires/epoch)
- [x] 3.2 `SoulPaidAccessList.entries` 改为 `Table<address, Table<u32, KindPaidEntry>>`
- [x] 3.3 `SoulPaidAccessList` 新字段 `kind_configs: Table<u32, KindPaidConfig>`
- [x] 3.4 `record_purchase` / `add_access` / `revoke_access` / `has_access` / `cleanup_stale_entries` 全部加 `kind: u32` 入参
- [x] 3.5 `seal_approve_content_paid_access` 加 `READ_PAID` 断言、读取 slot.read_mode_mask
- [x] 3.6 新增 `configure_paid_access_kind` / `delete_paid_access_kind`（owner-only）
- [x] 3.7 新增错误码 `EKindNotConfigured=7 / EKindAlreadyConfigured=8 / EKindScopeMismatch=9 / EReadModeNotAllowed=10`
- [x] 3.8 加测试 8.4 全部 8 个 per-kind 用例

## Step 4 — `soul.move` 字段裁剪

- [x] 4.1 `Soul` 删除 `protected_blob: Blob` 字段
- [x] 4.2 `SoulState` 删除 `memory_id: Option<ID>` 字段
- [x] 4.3 `SoulCreated` / `SoulMintedToKiosk` 事件删除 `memory_id`
- [x] 4.4 `mint` 入参移除 `protected_blob`
- [x] 4.5 `create_state` 入参移除 `memory_id`
- [x] 4.6 新增 `assert_initial_content_complete(state, content)`：SOUL_DOC v0 + MEMORY ≥1 v
- [x] 4.7 `share_state` / `emit_created_after_content_bound` 调用前由 market 调 `assert_initial_content_complete`
- [x] 4.8 加测试 8.6 删除字段回归用例

## Step 5 — `memory.move` / `seal_policy.move` 删除

- [x] 5.1 `git rm move/soulidity/sources/memory.move`
- [x] 5.2 `git rm move/soulidity/sources/seal_policy.move`
- [x] 5.3 全 `protocol_tests.move` 内对 `seal_policy::*` / `memory::*` 调用切换到 `content::*`（kind=KIND_SOUL_DOC / KIND_MEMORY）
- [x] 5.4 加测试 8.6 模块缺席的编译期断言（通过测试 import 不再使用旧符号体现）

## Step 6 — `market.move` mint 改造

- [x] 6.1 `mint_native_in_personal_kiosk` / `mint_imported_in_personal_kiosk` / `mint_joined_in_personal_kiosk` 移除 `protected_blob` / `founding_memory_blob` 入参
- [x] 6.2 `apply_initial_content_entries` 前置 `assert_initial_content_well_formed`：SOUL_DOC=1 (name="soul")、MEMORY≥1 (name="default")
- [x] 6.3 `mint_soul_in_personal_kiosk_impl` 不再创建 `SoulMemory`；不再 `memory::append_founding`；不再 `memory::share_memory`
- [x] 6.4 `purchase_paid_access` 加 `kind: u32` 入参，调 `paid_access::record_purchase` 时透传
- [x] 6.5 新增 wrapper `configure_paid_access_kind` / `delete_paid_access_kind`（owner + market not paused 守卫）
- [x] 6.6 新增错误码 `EInitialSoulDocCountMismatch / EInitialSoulDocNameMismatch / EInitialMemoryCountMismatch`
- [x] 6.7 加测试 8.5 全部 7 个 mint invariants 用例

## Step 7 — Move 整体校验

- [x] 7.1 `cd move/soulidity && sui move build`
- [x] 7.2 `sui move test` 全绿（包括 8.1–8.7 全部新增用例）
- [x] 7.3 `sui move test --coverage` 检查内置 kind × op × read_mode 矩阵覆盖率

## Step 8 — Prisma schema reset (D5 hard cut)

- [ ] 8.1 删除 `SoulMemoryEntry` 表 model + index
- [ ] 8.2 删除 `SoulSkillVersionRecord` (若仍存在)
- [ ] 8.3 删除 `SoulAsset.protectedBlobObjectId` / `SoulAsset.memoryOnChainId` 字段
- [ ] 8.4 新增 `SoulPaidAccessKindConfig` 表 (`@@id([soulPaidAccessListId, kind])`)
- [ ] 8.5 重写 `SoulPaidAccessRecord` 主键为 `(buyerAddress, soulPaidAccessListId, kind)`
- [ ] 8.6 `npx prisma migrate dev --schema=prisma/schema.prisma --create-only --name phase2_unified_content`
- [ ] 8.7 检视生成的 SQL，手工调整 RLS / index 后 `prisma migrate dev`
- [ ] 8.8 `npx prisma generate`

## Step 9 — TS / SDK / API hard cut

- [ ] 9.1 删除 `web/lib/soulidity/tx/memory.ts` 与所有 memory mirror writer
- [ ] 9.2 删除 `web/lib/soulidity/seal/{owner,memory}*.ts`（Soul-level 与 memory-level seal helpers）
- [ ] 9.3 新建 `web/lib/soulidity/tx/content-public.ts`（构造 `seal_approve_content_public` PTB）
- [ ] 9.4 `web/lib/soulidity/tx/paid-access.ts` 加 `configure_paid_access_kind` / `purchase_paid_access(kind)`
- [ ] 9.5 SDK types: `KindDescriptor` 加 op/read mask 字段，`SoulPaidAccess` 改 per-kind shape
- [ ] 9.6 删除 `/api/souls/[id]/memory/*` 路由；新建 `/api/souls/[id]/content?kind=memory`
- [ ] 9.7 删除 `/api/souls/[id]/seal-token`，新建 `/api/souls/[id]/content/[kind]/[name]/[version]/seal-token`
- [ ] 9.8 `/api/souls/[id]/paid-access` 加 `kind` 入参 + per-kind 列表 API
- [ ] 9.9 ESLint 规则：禁止 `prisma.soulMemoryEntry` / `prisma.soulSkillVersionRecord` 直调；禁止 `import.*memory\\.ts`
- [ ] 9.10 `npm run lint` + `npx tsc --noEmit` 全绿

## Step 10 — 前端 hooks / pages

- [ ] 10.1 `web/lib/hooks/use-memory.ts` → `use-content.ts({ kind: KIND_MEMORY })`，旧 hook 删除
- [ ] 10.2 Soul detail 页面：protected blob 视图改读 KIND_SOUL_DOC v0 content URL
- [ ] 10.3 Memory editor：调用新 content delete API
- [ ] 10.4 Sprite/Audio 卡片：按 slot.seal_encrypted 决定走 Seal session 或明文 Walrus URL
- [ ] 10.5 Paid-access 配置面板：per-kind 价格 / scope / duration 三段
- [ ] 10.6 `npm run dev`，浏览器手测 mint → list → buy → grant → paid_access(SPRITE) → public sprite 读取 全链路

## Step 11 — Publish + multisig handoff

- [ ] 11.1 在 testnet 重新发包（旧 mainnet 数据已弃，无需迁移）
- [ ] 11.2 `KindAdminCap` / `MarketCap` / `UpgradeCap` 一并 multisig handoff（沿用 phase 1 PTB）
- [ ] 11.3 precheck：`kindAdminCapId != deployerAddr` && `kindAdminCap.owner == multisig`
- [ ] 11.4 写入 deployment manifest

## Step 12 — Smoke + bench

- [ ] 12.1 mint smoke：构造 InitialContentEntry[SOUL_DOC + MEMORY + 1 SKILL + 1 SPRITE]，验证 mint 成功
- [ ] 12.2 mint 反向：缺 SOUL_DOC abort、name 错 abort、缺 MEMORY abort
- [ ] 12.3 grant smoke：SCOPE_MEMORY 单 grant 读 KIND_MEMORY；SCOPE_ASSETS 单 grant 同时读 SPRITE+AUDIO
- [ ] 12.4 paid_access smoke：configure SPRITE → buy → seal_approve_content_paid_access OK
- [ ] 12.5 paid_access 反向：未 configure AUDIO → buy AUDIO abort
- [ ] 12.6 public smoke：sprite slot read_mode_mask = OWNER|GRANT|PUBLIC（混合）→ seal_approve_content_public OK；read_mode = PUBLIC-only → append/mint abort EOwnerReadModeRequired
- [ ] 12.7 memory delete smoke：delete + purge → seal_approve abort EVersionDeleted
- [ ] 12.8 ownership rotate smoke：rotate 后所有 grant + per-kind paid entry 全失效

## Acceptance gate（与 plan 对齐）

- [ ] A1 — soul.md 一经加入不可变（OP_APPEND / OP_DELETE / OP_PURGE 全 abort）
- [ ] A2 — memory.md 不可修改 / 可附加 / 可删除 / 只 owner+grant 可读
- [ ] A3 — skills.zip 可附加 / 可修改（new version）/ 可删除 / 只 owner+grant 可读
- [ ] A4 — sprite + audio 全 op + 4 read modes 通过；纯 PUBLIC 走明文
- [ ] A5 — 管理员通过 KindAdminCap 注册新 kind 配置 op_mask + read_mode_mask 工作
- [ ] A6 — 所有 Move 入口都有 ≥1 正向 + ≥1 反向测试
- [ ] A7 — `sui move test` 全绿
- [ ] A8 — DB / TS / 前端 hard cut 完成，无旧符号残留

## Review

待 Step 1–7（Move 阶段）落地后追加。

---

# Design Review Implementation — Soulidity Design Review.html (legacy / 已完成)

> 历史保留，phase 2 动作不影响此前 design review 结论。

## Scope

Handoff bundle from Claude Design (`/tmp/soulidity-design/`). 38-finding UI/UX audit + brand identity for the Soul marketplace. Audit-against-code pass shows most findings already shipped. This PR closes the remaining open/partial items in one pass.

Reference: `/tmp/soulidity-design/soulidity/project/Soulidity Design Review.html`
Brand direction: **D — Seal & Flame** (already adopted in navbar + favicon)

## Already shipped (verified in `web/`)

Brand (mark + wordmark), S1 pending-buy, S3 "+ New" menu, S6 agent-mode gradient, M1 persona filter, M3 gradient avatars, M4 filter tabs, M7 collection chip, M8 collection ribbons, M9 muted tags, P1 portfolio strip, P2 grant filter + CSV, P3 "Soul/Trainer says", P5 history filters, P6 notification drawer, P7 docs top-level, P8 report modal, C5 wrap+link NFT grid, X2 border #3B2388, X3 empty states, X6 tag sizing, X7 light-mode cut, X8 focus-visible.

## This pass (must-finish)

- [x] C1 — Remove "awaken" pre-mint copy in `create/preview` + `import/preview`
- [x] M5 — Compact Provenance strip on soul-detail (creator · object · grant status · created)
- [x] X5 — Toast redesign: bottom-right stack, max 3, 6s dismiss, hover-pause, left-border semantic stripes
- [x] S5 — Add Deposit action to wallet dropdown
- [x] X8 — Dual-ring focus (purple + bg-offset)

## Follow-up pass (landed after initial scope)

- [x] C7 — baked-in cropper: new `CoverImagePicker` component (canvas-based, no new deps). Enforces 1:1 output, 1024×1024 WebP, ≤2MB via stepped quality. Wired into `create/`, `collections/create/`, `import/map/`. Regression-guard test `tests/new-web/create-basic-info-ui.test.ts` updated to pin the new component.

## Deliberately deferred (Later lane — explicit tail the user should know about)

- S4 — global ⌘K palette (new feature, multi-surface)
- C3 — memory editor upgrade (needs editing UI surface)
- C4 — import smart-guess auto-mapping (source-specific logic)
- P4 — Space template differentiation Soul vs Trainer (cosmetic restructure)
- X1 — shared tokens.css package (currently Tailwind v4 theme serves this role)
- C7 secondary 4:1 banner variant — deferred. Data model only has one cover slot today; adding a second requires provider + upload + on-chain metadata changes.

## Verification

- [x] `npm run lint` — no new issues on changed files (4 pre-existing errors in `lib/hooks/use-wallet-balances.ts` are on master, unrelated)
- [x] `npx tsc --noEmit` — exit 0
- [x] `npm test` — 941 passing, 2 pre-existing failures on master (unrelated to this pass)
- [x] `grep -i awaken` on `web/` — no matches

## Review

Files touched (6):

- `web/app/create/preview/page.tsx` — C1 copy ("awaken" → "mint")
- `web/app/import/preview/page.tsx` — C1 copy ("awaken" → "mint")
- `web/app/souls/[id]/page.tsx` — M5 added `ProvenanceStrip` + `formatRelative`; strip rendered between hero block and Protocol State/Access grid
- `web/components/ui/toast.tsx` — X5 full redesign: bottom-right stack, max 3, 6s dismiss, hover-pause, left-border semantic stripes, dismiss button. Signature `showToast(message, color)` preserved
- `web/components/nav/account-button.tsx` — S5 added Deposit action below SUI balance; copies address and fires a success toast
- `web/app/globals.css` — X8 dual-ring focus: `:focus-visible` now includes a bg-colored box-shadow so the purple outline reads on purple-bordered parents
- `web/components/ui/cover-image-picker.tsx` — C7 baked-in cropper component (new file)
- `tests/new-web/create-basic-info-ui.test.ts` — C7 regression guard for cropper

No code committed per user request.
