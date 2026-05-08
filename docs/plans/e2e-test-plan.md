# new-web E2E 全自动测试计划 — Soulidity Marketplace

## Context

`web/`（Next.js 16 + React 19，port 3100）是 Soulidity 唯一的 web 前端。本计划覆盖 Soul 全生命周期：创建 → 上架 → 购买 → Grant → 访问 → Skills → Memory → 解密，以及 Collection / Import。

**目标网络：Sui Mainnet（Phase 2 Unified Content）**。 2026-05-04 hard-cut publish 落在 commit 区间 `415ac36`..`d748423`（含 `415ac36` / `43b561c` / `6c55b59` / `0151a02` / `4c23a46` / `d748423` 这几个关键节点；非线性 parent 链）。合约换成统一的 `content / kind_registry / paid_access` 体系，SDK 抽到 `packages/soulidity-sdk/`。Phase 1 testnet 96/96 PASS（2026-04-28）已归档到 `docs/e2e-test-results-new-web.md`，本计划只对应 Phase 2 mainnet runtime；testnet 包 / 旧 SoulMetadata + ContentAccessList 架构不再有效。

**当前部署基线（2026-05-04 mainnet fresh publish，version = 1）**

合约整体 fresh publish，**无 upgrade 路径**。所有 on-chain ID、kiosk 注册、历史 listings / paid access / grant 均从零起步，DB 需配合清空。`packages/soulidity-sdk/src/deployment-manifest.json` 的 `mainnet` 段是权威源；**testnet 段保留只作 Phase 1 历史，不可作为本计划运行时来源**。

| 字段 | mainnet 值 |
|------|------------|
| `packageId` | `0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0` |
| `marketConfigId` | `0xe6214eaba8afa4c9191a602b78bfc0658ce1e188625f986dc6768d40f4d7dbb5` |
| `kioskRegistryId` | `0x8063dbb7cc35b136355a329a7d54ae3258ee8b30473d86a925d3390f7b9a32e4` |
| `kindRegistryId`（Phase 2 新增） | `0x27f249c5fe0ff056f4d5bc1473e10621966e646faf29de89200d9b612e6b9880` |
| `soulTransferPolicyId` | `0xaf28f957b4f30bfd73c00bff61cc3cb8d54be25ca1a0f03aa8aad15e06e476c4` |
| `collectionTransferPolicyId` | `0xaeee89fa0d39d43f7cbd402ec13a618a06222ff40792e8edc6c627cadfc0def0` |
| `paymentCoinType` | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| `publishTxDigest` | `BuBAX27guhWwvUM5y9PGUnMi77C3ttSdRG95p1eGhxmS` |
| `upgradeCapId` | `0xca2ff2940a628e5d15e7d452604aa0a2777ed147febe012280b54feced1dc701` |
| `marketAdminCapId` | `0x1a68b6e897b9c76377e895545c2d54f777820bf8b844748718ec9e242aae2446` |
| `kindAdminCapId` | `0x4119e53eac9c6b53739e2a0727c601923dc89f545241dbffe9f7aa4c1e6b2fe0` |
| `soulPolicyCapId` | `0xc4923f86bb28e8a9839898fa387a5af16cfaf0f4bb9b439f5a871282f8701cc8` |
| `collectionPolicyCapId` | `0x1aa2e82267d865eeb08d4b0b9aeee3e223cab73e05598a4a6f0c5e8d63754b19` |
| `soulDisplayId` | `0x5dd035eac005605c44f10eda57fcef3e2de4407f714d43ea4a931998c6918e93` |
| `collectionDisplayId` | `0x0d21ab049f684a37f8f898d7ccabc4976426ad8c76234f194c0a03705728ed82` |

权威文件：`packages/soulidity-sdk/src/deployment-manifest.json` + `move/soulidity/Published.toml`。任何测试脚本 / 断言引用的 ID 必须与此一致；testnet packageId（`0x0b79af1f…`）以及 Phase 1 历史 ID 全部作废。

**本基线包含的安全审计全集**（Phase 2 mainnet 已固化）

- **市场与付款**：`market::purchase_paid_access` 要求 `price_atomic > 0` + 双向校验 `state.access_list_id == object::id(paid_access_list)`；付款发给 `soul::current_owner(state)`，含平台抽成（`MarketConfig.platform_fee_bps`，默认 250 bps）。免费 access 仅 owner 通过 `paid_access::add_access` 发放。
- **KioskRegistry 独立共享对象**：`ensure_personal_kiosk_registered` 幂等 insert-or-assert（同 cap no-op，不同 cap abort `EPersonalKioskMismatch`）；换 kiosk 唯一合法路径 `market::rebind_primary_kiosk`，要求旧 kiosk 为空（`EOldKioskNotEmpty` / `EOldKioskMismatch` / `ERebindSameKiosk`）。rebind 只面向运维 / 测试脚本（SDK `buildRebindPrimaryKioskTx`、Test 7.10h 走 `sui client call`），终端用户路径不暴露。
- **Grant 容量 + 僵尸回收**：`grant::set_grant_capacity(state, capacity, clock, ctx)`（owner-only，带上限 `MAX_GRANT_CAPACITY`）；`grant::destroy_invalidated_grant(grant, state, clock, ctx)` 要求 epoch mismatch / 不在 active_grants / 已过期任一条件，事件 `SoulGrantDestroyed`，错误码 `EGrantStillActive`。`SoulGrant` 是 owned object，交易 sender 必须持有该对象。
- **Listing 回收**：`market::delete_soul_listing` / `delete_collection_listing` 要求 `!is_active`（`EListingStillActive`），事件 `SoulListingDeleted` / `CollectionListingDeleted`。
- **Scope mask 校验**：Grant `scope_mask` 必须是 `SCOPE_SEAL|MEMORY|SKILLS|ASSETS = 15` 的非零子集；非法传值 abort `EEmptyScopeMask` / `EGrantInvalidScopeMask`。Paid-access kind config 更严格：`scope_mask` 必须等于该 kind descriptor 的单 bit `default_grant_scope_mask`，且 kind 必须允许 `READ_PAID`；当前 builtin 中只有 `KIND_SPRITE` / `KIND_AUDIO` 支持 paid reads，scope 都是 `SCOPE_ASSETS = 8`。
- **Paid access duration**：`KindPaidConfig.duration_ms: Option<u64>`；`paid_access::record_purchase` 按 `now + duration` 写 `expires_at_ms`；owner 通过 `paid_access::configure_paid_access_kind` 调整 price / scope / duration。
- **Seal 文档 ID 长度严格 `==`**：`content::assert_matching_document_id` 要求 `documentId == hash(contentObjectId, kind, name, versionIndex)` 精确字节长度；TS SDK 输出精确字节长度，client-built sidecar 同样满足。
- **owner 校验单一错误码**：`content` 所有 owner 校验走单一错误码 `ENotOwner`。

**本基线的结构性变化（合约层架构级）**

1. **SoulContent 作为统一 typed-content 根（shared object）**
   - 单一 `SoulContent` shared object 取代 Phase 1 的 4 个独立模块（`metadata.move` / `skills.move` / `assets.move` / `content_access.move` 全部下线）。`SoulState.content_id: ID` 引用该对象。
   - 5 个 builtin kind（`KindRegistry` 在发布时由 `kind_registry::init` 注册，`kindRegistryId` 写入 manifest）：
     | Kind | id | opMask | readModeMask | hasActive | scope |
     |---|---|---|---|---|---|
     | KIND_SOUL_DOC | 0 | 0 | OWNER\|GRANT | no | SCOPE_SEAL |
     | KIND_MEMORY | 1 | APPEND\|DELETE\|PURGE | OWNER\|GRANT | no | SCOPE_MEMORY |
     | KIND_SKILL | 2 | APPEND\|DELETE\|PURGE | OWNER\|GRANT | no | SCOPE_SKILLS |
     | KIND_SPRITE | 3 | APPEND\|DELETE\|PURGE\|ACTIVE_BIND | OWNER\|GRANT\|PAID\|PUBLIC | yes | SCOPE_ASSETS |
     | KIND_AUDIO | 4 | APPEND\|DELETE\|PURGE\|ACTIVE_BIND | OWNER\|GRANT\|PAID\|PUBLIC | yes | SCOPE_ASSETS |
   - 自定义 kind 由 `kindAdminCapId` 持有者 `kind_registry::register_kind` 注册，单 bit `default_grant_scope_mask`（`is_single_bit` 校验）。
   - Persona / voice 的"激活态"通过 `SoulContent.active_table[KIND_SPRITE]` / `[KIND_AUDIO]` 维护（`OP_ACTIVE_BIND` op 设置，`OP_ACTIVE_CLEAR` 清空）；mirror 到 `SoulAsset.activeSpriteName / activeSpriteVersionIndex / spriteConfigJson / voiceConfigJson` 等列。
   - Phase 1 的 `SoulMetadata` shared object、`Soul.metadata_ref`、外部 metadata JSON 全部下线。

2. **Mint 签名整体改为批量 vec（market.move `mint_native_in_personal_kiosk` / `mint_imported_in_personal_kiosk` / `mint_joined_in_personal_kiosk<T>`）**
   - Phase 1 的 13 个独立 sprite / voice / content_access / royalty 参数全部废弃。
   - 新签名（Phase 2）：
     ```
     mint_native_in_personal_kiosk(
       market_config, kind_registry, kiosk_registry, soul_transfer_policy,
       personal_kiosk, personal_kiosk_cap,
       name, description, image_url,
       initial_content: vector<InitialContentEntry>,        // 单笔 mint 内含所有 kind 的 v0 版本
       initial_state_config: vector<StateConfigEntry>,      // sprite/voice config / mood map JSON 等
       creator_royalty_bps: u16,
       clock, ctx,
     )
     ```
   - `InitialContentEntry = { kind: u32, name: String, slot_read_mode_mask: u64, download_policy: u8, set_active: bool, blob: Blob }`，由 `packages/soulidity-sdk/src/tx/mint-helpers.ts::buildInitialContentArgs()` 装配。
   - 任何绕过 `@soulidity/sdk` 的直接 PTB 调用必须自行装配 vec。

3. **SoulPaidAccessList per Soul (1:1) 取代 ContentAccessList**
   - mint 自动创建 `SoulPaidAccessList` shared object 并写入 `SoulState.access_list_id`，`creator` 字段记录 mint sender。
   - 持有 per-`kind` `KindPaidConfig`（`price_atomic`、`scope_mask`、`Option<duration_ms>`），由 owner 通过 `paid_access::configure_paid_access_kind` / `update_paid_access_kind` / `delete_paid_access_kind` 维护；`SoulPaidAccessKindConfig` mirror。
   - 持有嵌套 `entries[buyer][kind]` 的 `KindPaidEntry`（`scope_mask` / `price_paid_atomic` / `expires_at_ms` / `ownership_epoch_snapshot`）；`SoulPaidAccessEntry` mirror。
   - `paid_access::record_purchase` 要求 `price_atomic > 0` + linkage match；owner 任何时刻可 `paid_access::revoke_access`（无链上退款）；`cleanup_stale_entries` 任何调用者可清理失效 entry 拿存储 rebate。

4. **Paid access epoch-pinned**：`KindPaidEntry.ownership_epoch_snapshot` 与 `SoulState.ownership_epoch` 必须相等才有效；Soul 转售后旧 subscriber `has_access` 立即翻 false，stale 条目保留作审计；re-purchase 在新 owner 下覆盖 stale 行（同 Phase 1 ContentAccessEntry 语义，搬到 paid_access 模块）。

5. **API 路由瘦身**：
   - `/api/souls/[id]/{access-list/*, metadata, skills/*, memory/*, sprites/*, assets/*}` 全部删除
   - `/api/agent/souls/[id]/{skills/*, memory/*, assets/*}` 全部删除
   - 唯一保留 `/api/souls/[id]/access`（GET，`requireHumanWalletIdentity`，仅放行 SOUL_DOC v0）和 `/api/agent/souls/[id]/access`（GET，Agent Bearer）
   - Memory / Skill / Sprite / Audio 的 Seal 访问目前**没有专用 HTTP 路由**；本计划的解密验收统一由 agent-side Node 脚本执行，脚本用 Agent Alpha 的 Bearer + 私钥构造 Seal session，不走 human owner 浏览器自解路径

6. **Move 协议测试基线**：`move/soulidity/sources/protocol_tests.move`（102 项 `#[test...]` 属性，含 Phase W1.5 固化的 4 条负向 test）全绿；web vitest soulidity 套件全绿。Phase 1 测试名（`purchase_content_access_with_zero_price_fails` 等）已全部失效；正向新名字示例：`mint_with_invariant_entries_only_succeeds` / `mint_with_skill_records_version` / `mint_with_sprite_set_active_binds_active_table` / `memory_append_and_delete_succeed` / `skill_full_crud_succeeds` / `soul_doc_owner_seal_reads` / `register_kind_allocates_monotonic_custom_ids`。Phase W1.5 固化的 4 条 negative test 名分别为 `destroy_invalidated_grant_aborts_when_grant_still_active`（Test 5.8 step 5）、`purchase_paid_access_aborts_when_price_zero`（Test 7.10d）、`configure_paid_access_kind_rejects_scope_mismatch`（Test 7.10e）、`delete_soul_listing_aborts_when_active`（Test 11.0a step 4）；mainnet 测试不允许 mid-run 新增 Move test 或重新 grep 选名。

**本基线的运行时 / 协议外架构变化**

7. **Privy 完全下线，Sui 钱包签名 + Session Cookie + CSRF（commit 19ca835）**
   - 浏览器登录：dapp-kit `ConnectModal` → 选钱包 → `POST /api/auth/wallet-challenge { address }` 拿 nonce + 5min 过期 message → `useSignPersonalMessage` 签 → `POST /api/auth/wallet-login { address, signature, nonce }` 写 `session` + `csrf-token` cookies。
   - **E2E 自动化前置（W0，2026-04-27 已落地）**：`web/components/providers/e2e-wallet-stub.tsx` 已实现并在 `web/components/providers/app-providers.tsx` 的 development 分支挂载。`localStorage.setItem('__E2E_PRIVATE_KEY', <bech32>)` + reload → 桩自动注册到 dapp-kit → ConnectModal 列出 "E2E Test Wallet" → 桩接管 sign-message / sign-transaction，0 popup。切换角色 = 改 localStorage + reload。
   - 浏览器 API 鉴权：cookie `session`（HS256 JWT，AUTH_SECRET 签，30d，HttpOnly + SameSite=Lax + Secure(prod)） + header `x-csrf-token`（双提交，cookie `csrf-token` 64 hex）。所有调用 `web/lib/auth/identity.ts::requireMutationIdentity(request)` / `requireHumanWalletIdentity({ mutation })` 的 cookie-auth 写路由强制 CSRF + 同源 Origin/Referer；header-based agent 路径不变（仍 `Authorization: Bearer sk-...`）。
   - Env：`AUTH_SECRET` 签 human session JWT；desktop token 仍可按 `web/lib/desktop/auth.ts` 回退到 `SOUL_UPLOAD_SECRET`。

8. **Soul / sprite / skills 上传统一走 wallet-paid Walrus browser upload**
   - 旧路由 `POST /api/souls/upload`、`/api/souls/upload/token`、`/api/souls/upload/from-blob` 已退役为 410；不再使用 Vercel Blob staging、服务端 publisher 或 raw DEK envelope。
   - 客户端入口：`web/lib/upload/client-upload.ts::uploadSoulPayload`。Phase 1 / 3 / 6 / 8 所有 Soul / sprite / skills / wrap / collection 大文件都走它；签名前必须先展示 `UploadCostReview` 并由连接的钱包支付 Walrus storage / Sui gas / relay tip。
   - 报价入口：`packages/soulidity-sdk/src/walrus-quote.ts::quoteWalrusUpload`。`<= 50 MiB` 单 blob，`> 50 MiB` 自动按 16 MiB chunk + manifest blob 上传；quote 覆盖所有 chunk / manifest 的 Walrus storage、write cost、relay tip 与 register/certify TX 数，TTL 为 60 秒。
   - 私有内容在浏览器内 AES-GCM 加密；`web/lib/upload/client-seal.ts` 只把短期 `PendingSealMaterial` 留给当前会话 / recovery，mirror API 只接受客户端生成的 Seal sidecar object。raw DEK envelope string 直接 400。
   - Collection/profile cover 也走 `uploadSoulPayload(..., 'public')`；legacy `/api/collections/upload-image` 和 `/api/profile/cover` 已退役为 410。

9. **mirror 路由 `POST /api/souls/[id]/grant-capacity`（commit 107ab0d）**
   - 接 `txDigest` → 链上读 `GrantCapacityUpdated` 事件 → upsert `soul_assets.grantCapacity` / `activeGrantCount`。`window.__e2eSoulidity.setGrantCapacity` 已在内部调用此路由，Phase 5.2a 不需要再单独 cURL。

10. **SDK 抽到 `packages/soulidity-sdk/`（commit 6c55b59）**
    - web 通过 `@soulidity/sdk` import；服务端 mirror 专属代码仍在 `web/lib/soulidity/mirror/`。
    - 所有 tx builder（publish / buy / list / delist / grant / paid-access / content / collection / personal-join / import / kiosk-management）位于 `packages/soulidity-sdk/src/tx/`。

11. **Content sidecar mirror（commits 4c23a46、d748423）**
    - mint / batch-publish / append-version 等路由的 request body 携带 `contentSidecars: ContentSidecarRequestEntry[]`（每个 entry: `{ kind, name, versionIndex, sidecar: SealEnvelopeSidecar | null }`）。
    - mirror 端 `web/lib/soulidity/mirror/build-seal-sidecars.ts::buildSyncSealSidecars()` 用 `isContentDocumentIdForVersion(documentId, { contentObjectId, kind, name, versionIndex })` 精确校验；任意失败抛 `SealSidecarSyncConfigError`，禁止吞错。
    - Post-TX 写 `SoulContentVersionRecord`（含 `sealSidecar` JSON）/ `SoulPaidAccessKindConfig` / `SoulPaidAccessEntry` / `SoulGrantRecord` / `SoulAsset` projection。

12. **Nav 顺序（commit 5f4f85c）**：`web/components/nav/navbar.tsx`：Docs 挪到 `+ New` 菜单之后（与 Admin 同列）。无功能影响。

**全自动执行：** 本计划设计为 AI agent 独立可执行，0 人工介入（master 钱包按 4.4 节预存清单注资，且 Phase W1 支撑脚本落地后即可）。自动化覆盖：
- **浏览器交互** — Chrome DevTools MCP（snapshot → uid → click/fill/upload）
- **角色注资** — `MAINNET_DEPLOYER_PRIV_KEY` 单笔 PTB 转 SUI / WAL / USDC 给 5 个角色地址（Phase W1 必须先落地 `scripts/e2e-fund-roles.ts`）
- **链上状态发现** — `sui client` CLI（balance / objects / gas）
- **API + DB 验证** — `curl` / SQL / `npx tsx` 脚本
- **TX 签名** — W0 E2E Wallet Stub 接管浏览器钱包签名（dev-only Wallet Standard 实现，0 popup）；Agent 侧 TX 由 `web/scripts/e2e-agent-purchase.ts` 通过 `AGENT_PRIVATE_KEY="$E2E_AGENT_*_PRIVATE_KEY"` 在 Node 直接签

**手动介入：** 0 次。`MAINNET_DEPLOYER_PRIV_KEY` 钱包按 4.4 节预存清单注资是用户的一次性前置（**不是测试运行时介入**）。注资不足时按"测试纪律"硬约束直接 abort，禁止绕过。

**测试 Fixture：** `/Users/admin/Documents/example`（单 Soul）+ `/Users/admin/Documents/example-collection`（Collection）。当前 fixture 不含 persona sprite / voice；Phase 1 mint 时 sprite / voice 留空（均为 InitialContentEntry vec 内 0 个 KIND_SPRITE / KIND_AUDIO entry），Phase 1.8 仅断言 `contentOnChainId` 非空 + `activeSpriteName` / `activeVoiceName` 为 null。

**总计：96 个主流程测试项，13 个 Phase（0-11，含 Phase 7.5；Phase 6.5 / 9.10 因 API 路由 / 脚本删除整段移除；Phase -1 为环境准备，不计入总数）**。本轮计数以 96 个 `### Test` heading 为准；Phase 7.5 现为 12 项（`7.6` + `7.10a-k`）。Phase 2 mainnet review 之后扩展的重点覆盖包括：Phase 3 子 Soul 上架、Phase 4 quote 链上对账 + collection 子 Soul 真买、Phase 5 capacity 2 真用 / 容量超限 / Beta revoke、Phase 7.5 add_access / owner 自购拒绝 / revoke_access lifecycle、Phase 11 cleanup_stale_entries。

| Phase | 项数 | 备注 |
|-------|------|------|
| 0 | 3 | Pre-flight |
| 1 | 12 | Seller 登录 + 创建 Soul A & B |
| 2 | 8 | 上架 Soul A & B |
| 3 | 7 | Collection + Floor Guard |
| 4 | 11 | Buyer 登录 + 非合约社交 / 报价预检 + 购买 |
| 5 | 15 | Grant 系统 |
| 6 | 1 | Content Panels 展示验收 |
| 7 | 5 | Agent API 购买路径（7.1-7.5） |
| 7.5 | 12 | Paid Access lifecycle（7.6 + 7.10a-k） |
| 8 | 6 | Import |
| 9 | 6 | API 边界 & Hardening |
| 10 | 6 | 页面渲染冒烟（10.1-10.5 前置；10.6 随 Buyer 登录后执行） |
| 11 | 4 | Cleanup |
| **总** | **96** | 不含 Phase -1 / W0 / W1 |

执行前用 `awk '/^## Phase [0-9-]/ {p=$0} /^### Test [0-9]/ {n[p]++} END {for (k in n) print k, n[k]}' docs/plans/e2e-test-plan.md | sort` 复核；任一行偏离立即按"测试纪律"硬约束 abort 并修源。

**价格 / Scope 约束（合约层硬性保障，SDK 默认值兜底）**

- `Soul` / `Collection` 的 listing price 必须严格大于 `0`（sell UI 前置拦截 + `market::EInvalidPrice` 后置拦截）。
- 本计划统一 list price = `100000` atomic USDC（**0.1 USDC**），mainnet 真币节省预算。
- `paid_access::record_purchase` 要求 `price_atomic > 0`；免费 access 仅 owner 通过 `paid_access::add_access` 发放。本计划中所有 paid purchase 用例使用正数价格；`0` 价不再是合法测试路径。
- Grant `default_scope_mask` 必须是 `SCOPE_SEAL(1) | SCOPE_MEMORY(2) | SCOPE_SKILLS(4) | SCOPE_ASSETS(8) = 15` 的非零子集；所有 mint/grant 用例传 `ALL_ACCESS_SCOPES = 15`（SDK 默认兜底）。Paid-access `KindPaidConfig.scope_mask` 必须等于目标 kind 的单 bit descriptor scope；本计划 paid-access 正向路径统一用 `KIND_SPRITE = 3` + `SCOPE_ASSETS = 8`。

### 调用顺序与轻重分层（硬约束）

执行顺序按真实依赖与链上副作用排列，不按文档 Phase 编号机械顺跑：

| 层级 | 类型 | 执行位置 |
|------|------|----------|
| A | 本地 / 静态 / 无合约调用 | `sui move test` fixed negative baseline（含 Test 7.10j local proof）、Phase 0、Test 10.1-10.5，放在任何 mainnet 写链 TX 前 |
| B | 浏览器 / HTTP / DB 读写，但不触发合约 TX | Buyer 登录后的 Test 4.3-4.3c、Test 10.6，放在购买 TX 前 |
| C | 读链 / dev-inspect / dry-run | quote 对账、owner 自购拒绝 dry-run、manifest accessor 检查，放在对应写链 TX 前 |
| D | 写链 TX | mint / list / buy / grant / paid-access / import / cleanup，严格按状态依赖链执行 |

规则：凡是不需要当前步骤写链结果的测试，都前置到第一次依赖它的写链动作之前；凡是会改变资产 owner、listing、grant、paid-access entry 或 cleanup 状态的测试，必须留在其依赖链位置。

---

## 执行约束（全自动 + Chrome DevTools MCP）

### 测试纪律（硬约束）

**遇到任何报错 / 失败 / 异常退出，禁止绕过：**

1. **禁止 skip**：不允许 `skip(...)` / `it.skip` / 注释掉断言 / 把失败步骤改成 `console.log` 后继续。
2. **禁止偷懒重试**：不允许在没有定位根因的情况下加 `--retry` / 二次执行 / sleep + 重试硬撑过去。瞬态网络抖动除外，但必须明确记录为 "transient infra"，不能用来掩盖业务回归。
   - **明确允许的重试政策**（不算"硬撑"）：
     - **Walrus relay HTTP 4xx (含 429) / 5xx**：最多 3 次重试，间隔 1s / 2s / 4s（exponential backoff）。3 次后仍失败按 transient infra 标记，把 relay 响应、TX digest、quote fingerprint 写入失败记录后 abort。
     - **Seal session HTTP 5xx / 网络断流**：最多 3 次重试，间隔同上。
     - **`waitForTransaction` notFound**：对同一 digest 最多 polling 5 次（间隔 2s），超时按 transient infra 处理。
     - **`paid_access::has_access` 等链上 eventual-consistency 状态翻转**（如 Test 7.10f step 4）：明确为"`expires_at_ms` 合规等待"，使用预设 polling loop（步骤内显式约束最大次数 + 间隔 + 超时硬失败），不是 sleep+retry 兜底。
   - 上述政策外的任何重试一律视为违规：包括"再点一次按钮看好不好"、"换个 RPC 节点再试"、"sleep 30 秒再 curl"、跨 Phase 隐式重试等。
3. **禁止 try-catch 吞错**：不允许在测试代码 / helper 脚本里加 try-catch 把 reject 转成 resolve 让 CI 绿灯。
4. **禁止改断言迁就 bug**：不允许把"预期 X，实得 Y"的失败通过把预期改成 Y 来"修复" — 必须先确认 X 是否仍是产品契约。
5. **报错处理标准流程**：
   1. 完整复制错误（stderr + 栈 + 相关 TX digest / 链上对象 ID / DB 行）
   2. `grep` 源码 + 相邻测试 + commit history 锁定根因（产品 bug / plan 文档错 / 环境问题三选一）
   3. 修源代码或 plan 文档（环境问题需要先描述阻塞，再排期）
   4. 从失败的测试点（不是从 Phase 0）重新执行，确认 PASS 后继续
   5. 把该 fix 记到 `docs/e2e-test-results-new-web.md` 当轮 Run 段，包含失败签名 / 根因 / 修复 commit
6. **失败连锁**：一个测试失败往往污染后续状态（链上 / DB / cookie）；修复后必须重跑当 Phase 全部测试，不能只重跑失败那一项。
7. **本计划价值**：96 项 e2e 跑完后，用户人工抽查应当只看新功能 / 边界，不应该再撞到本计划已经覆盖的失败路径 — 这是判断本轮 e2e 是否合格的硬标准。

### 前端 UI 为准（硬约束）

**测试以前端实际暴露的功能为准；UI 上不存在的能力不纳入主验收：**

1. **Create wizard 不上传 sprite / voice**：当前 `/create` 4 步只接受 cover + soul.md + memory.md + skills.zip；fixture 也不含 persona sprite / voice。任何"sprite 上传 / persona 激活"步骤如果在 UI 上没有入口，**禁止**通过 `evaluate_script` 直接构造 File 或调 SDK 兜底；这种白盒路径属于"代码侧能力存在但产品未发布"，不计入用户验收。
2. **UI 没有的就跳过整段，而不是绕过**：如果 Phase X 的某个测试只能通过白盒脚本 / SDK 直调实现，且 UI 无对应入口，那该测试整段从主验收里删除（不是改为白盒执行），并在测试数量汇总里减计；只把"UI 入口存在但失败"的情况按"测试纪律"流程定位 + 修源 + 重测。
3. **Move CLI 调用是例外**：Phase 5.8 / 7.10h / 11.0a-b 等"运维语义"测试（KioskRegistry 矩阵、destroy_invalidated_grant、delete listing）由 `sui client call` / `sui move test` 固化，理由是这些 entry function 本身就不面向终端用户，只面向运维 / 协议自我守护。这部分**保留**，但要在每条测试开头说明"非 UI 路径，校验合约语义"。
4. **Agent API 是另一类例外**：`web/scripts/e2e-agent-*.ts` 验证的是 agent SDK / API key 调用契约，不是 web UI；Phase 7.x 主流程保留。
5. **执行前自检**：每个 Phase 第一项测试运行前，先 `take_snapshot` 确认 UI 上对应入口存在；不存在则按规则 2 整段删除 + 更新计数。

本计划的设计目标是**零人工判断执行**。`MAINNET_DEPLOYER_PRIV_KEY` 钱包按 4.4 节预存清单注资、Phase W1 支撑脚本落地后，Phase -1.3 由 `scripts/e2e-fund-roles.ts` 一次性把 SUI / WAL / USDC 转给 5 个角色地址，**测试运行时 0 人工介入**：

| 操作类型 | 自动化方式 | 人工介入 |
|----------|-----------|---------|
| 浏览器交互 | Chrome DevTools MCP（snapshot → uid → click/fill/upload） | 无 |
| 链上状态发现 | `sui client balance` / `sui client objects` / `sui client gas` | 无 |
| 角色钱包注资 | `MAINNET_DEPLOYER_PRIV_KEY` 单笔 PTB 转账（Phase W1 必须先落地 `scripts/e2e-fund-roles.ts`） | 无 |
| TX 签名 | W0 e2e-wallet-stub 接管浏览器签名；Agent Node 脚本用 `E2E_AGENT_*_PRIVATE_KEY` 本地签名 | 无 |
| Agent API 调用 | `curl` + `npx tsx` 脚本 | 无 |
| DB 验证 | SQL 查询 | 无 |

**失败处理：** 严格按"测试纪律"处理；不允许 take_screenshot 后跳过失败步骤继续。

### 浏览器步骤必须落到 MCP 原语

- 导航：`new_page` / `navigate_page`
- 定位：先 `take_snapshot`，基于最新 snapshot 的 `uid` 找元素
- 点击：`click(uid)`
- 输入：`fill(uid, value)` 或 `type_text`
- 上传：`upload_file(uid, filePath)`
- 断言：`wait_for` + `evaluate_script`
- 截图：`take_screenshot`

### 文档中的 selector 只是定位提示，不是直接命令

- 文中的 `button:has-text("...")`、`input[...]`、`selector: ...`、`a[href="..."]` 仅用于帮助执行者在 snapshot / DOM 中定位目标。
- 执行时不要把这些字符串直接当作 Chrome DevTools MCP 参数；必须先刷新 snapshot，再用对应 `uid` 调 `click` / `fill` / `upload_file`。
- 每次页面跳转、modal 打开、toast 消失、列表刷新、iframe 重绘后，都要重新 `take_snapshot`，不要复用旧 `uid`。

### Wallet-paid Walrus 成本确认

凡是页面调用 `uploadSoulPayload`，都会在第一笔 Walrus register/certify 钱包签名前弹出 `UploadCostReview`。执行者必须把这个弹窗当作上传流程的一部分处理，不能只等待最终 TX：

1. `wait_for` text "Review Upload Cost"。
2. `take_snapshot`，断言弹窗含当前网络（本计划为 `mainnet` / `Sui Mainnet`）、Payload、Storage、Transactions、WAL storage、Relay tip、Gas budget estimate。
3. 当前小 fixture 每个文件应显示 `Storage = 3 epochs`、`Transactions = 2`；`> 50 MiB` chunk item / manifest item / transaction count 行为由 unit/repo guard 覆盖，不并入 96 项 mainnet 主流程。
4. 点击 `Confirm`。如果点击 `Cancel` 或 quote TTL / 文件 / 网络 / relay / chunk plan 变化，上传应在签名前失败并要求重新确认；这类负向由 unit/repo guard 覆盖，不计入 96 项主流程。
5. 同一操作会按上传文件数重复弹窗；每次页面变化后重新 `take_snapshot`，不要复用旧 `uid`。

### Mainnet Walrus 上传限制口径

- Walrus 协议最大 blob size 不是本计划的直接 E2E 上限；按官方文档，真实值应以 `walrus info --context mainnet` 查询为准。ClawNews 产品层 UI 入口在 50 MiB 即拒（`packages/soulidity-sdk/src/upload-validation.ts:10` `MAX_SOUL_UPLOAD_BYTES = WALRUS_SINGLE_BLOB_MAX_BYTES = 50 * MIB`，错误文案 `File exceeds the 50 MiB upload limit`）。SDK chunking path（`> 50 MiB` 自动 16 MiB chunk + manifest）只供直调消费者，**不通过 `uploadSoulPayload` UI 暴露**。
- Mainnet 公共 upload relay / publisher 是外部服务，可能因 HTTP body size、rate limit、relay tip freshness、storage node 状态或 413/429/5xx 临时失败而低于协议上限；这属于 infra limitation，按"测试纪律"流程定位 + 修源后重测，不能用来掩盖业务回归。
- 主流程只使用小 fixture（最大约 5.6 KiB），不把 `> 50 MiB` live upload 绑定到 mainnet 公共服务稳定性。`> 50 MiB` chunk + manifest 行为由 unit/repo guard 固化；live 大文件 smoke 不属于本计划主验收，不能作为 96 项通过条件。

### 终端步骤的边界

- 本文中的 `curl`、SQL、`npx tsx` 只用于 API 边界、链路校验和辅助脚本，不替代浏览器侧的 Chrome DevTools MCP 流程。
- 主流程通过口径以浏览器链路 + 必要 API 校验为准；白盒脚本和外部依赖脚本单独标记，不混入主流程通过数。

### 一条浏览器步骤的标准翻译

文档写法：

```text
click "Login" 按钮（button:has-text("Login")）
```

实际执行：

```text
1. take_snapshot
2. 在 snapshot 中找到文本为 "Login" 的按钮 uid
3. click(uid)
```

文件上传同理：先 `take_snapshot` 找到 file input 的 `uid`，再 `upload_file(uid, filePath)`。

---

## 测试 Fixture

### 单 Soul — `/Users/admin/Documents/example/`

| 文件 | 大小 | 用途 |
|------|------|------|
| `soul.md` | 1K | Soul Character 文件（memory management template） |
| `memory.md` | 1K | Founding Memory 文件 |
| `images.jpeg` | 4.8K, 225×225 JPEG | Cover 图片 |
| `skills.zip` | 5.6K, ZIP 含 SKILL.md frontmatter | Skills Bundle |

### Collection — `/Users/admin/Documents/example-collection/`

| 文件 | 大小 | 用途 |
|------|------|------|
| `soul-collection-template.xlsx` | 6.2K | Collection 元数据模板（Soul Name, Description, Category, Tags, Royalty） |
| `1/soul.md` | 1K | 子文件夹 Soul Character |
| `1/memory.md` | 1K | 子文件夹 Memory |
| `1/images.jpeg` | 4.8K | 子文件夹 Cover |
| `1/skills.zip` | 5.6K | 子文件夹 Skills |

---

## Agent API 迁移方案（Phase 2 已收敛）

> Phase 1 实现于 2026-04-03（7 个文件，1028 tests pass）。Phase 2 hard-cut 后路由表收敛为 5 个，per-kind seal access 路由全部删除。

### 架构

Agent API 路由在 `web/app/api/agent/` 下，通过 `requireAgentWalletIdentity` 中间件认证，走 Soulidity Grant 体系（而非旧 allowlist）。

### Agent API 路由清单（Phase 2 mainnet）

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/agent/souls/search` | GET | 搜索 listed Soul（q, limit, offset；category 已废弃，改 tags） |
| `/api/agent/souls/[id]` | GET | Soul 详情 + 购买报价 + paid-access kind configs |
| `/api/agent/souls/[id]/access` | GET | Seal 访问 — owner 或 granted-agent；当前仅放行 SOUL_DOC v0 |
| `/api/agent/souls/[id]/purchase` | POST | 准备购买 TX（返回未签名 txBytes + preparedPurchaseId） |
| `/api/agent/souls/[id]/purchase/execute` | POST | 提交签名执行购买 + mirror 同步 |

> **路径变更说明**：Phase 1 的 `/skills/[skillName]/versions/[versionIndex]/access` 与 `/memory/[entryKey]/access` 已删除；`/assets/...` 也未实装。Memory 的 Seal 解密由 agent-side Node 脚本通过 `@soulidity/sdk` 直接构造 Seal session（参考 `web/scripts/e2e-agent-decrypt.ts`、`e2e-agent-verify-content.ts`）；HTTP 层暂未提供专用 endpoint，本计划 Test 5.3a-b 不走 human owner 浏览器自解。

### Auth 中间件

**`web/lib/soulidity/agent-server.ts`** — `requireAgentWalletIdentity(request)`:
1. 从 `Authorization: Bearer sk-*` 提取 API key
2. `resolveAgentByApiKey(key)` → `AgentIdentity`（复用 `@web/lib/auth/resolve-agent`）
3. `getMemberSuiWalletAddresses(agentMemberId)` → `string[]`
4. 返回 `{ agent, walletAddresses }` 或 `{ error: NextResponse }`
5. 失败认证按 IP rate limit（60/min）

### Agent 访问流程

```
Agent → /api/agent/souls/{id}/access → requireAgentWalletIdentity
  → resolveContentAccessPayload(soul, agentWalletAddresses, KIND_SOUL_DOC, "soul", 0)
  → 自动匹配: owner? → seal_approve_content_owner
                 activeGrants 含对应 scope? → seal_approve_content_granted_agent
                 paid-access entry? → seal_approve_content_paid_access
  → 返回 ContentAccessResponse
```

核心：**Agent API key 与 SoulGrant 是两层不同门槛**：
- `AGENT_API_KEY` 是 HTTP/API 身份，用来通过 `requireAgentWalletIdentity()` 解析 `members.kind='agent'`、确认 agent active，并取出该 agent 绑定的 Sui wallet 地址。
- SoulGrant 是链上内容授权，由 owner 通过 `useGrant().issueGrant()` 发给 agent 钱包地址；GrantModal 默认发放 `seal|memory|skills|assets = 15`，各 kind 按其 `default_grant_scope_mask` 自动匹配 scope bit。
- 走产品 Agent API / E2E 脚本时必须同时有 `AGENT_API_KEY` 和 `AGENT_PRIVATE_KEY`：前者证明 agent API 身份，后者签 Seal session / agent TX。仅有 SoulGrant 不能调用 `/api/agent/*`；仅有 API key 但没有 active grant 也不能解密授权内容。

无需额外 allowlist 表；paid-access kind config 是另一条独立授权路径。

### Agent 购买流程（两步签名）

```
Step 1: POST /api/agent/souls/{id}/purchase
  → requireAgentWalletIdentity
  → getMarketConfig + quoteSoulPurchase → 报价
  → resolveOwnedPersonalKiosk → buyer kiosk
  → selectCoinObjectIdsForAmountAcrossPages → USDC coins
  → buildBuySoulTx + tx.setSender + tx.build → 序列化 base64
  → 存 SoulPreparedPurchase（10 分钟 TTL）
  → 返回 { preparedPurchaseId, txBytes, context }

Step 2: POST /api/agent/souls/{id}/purchase/execute
  → requireAgentWalletIdentity
  → 验证 preparedPurchase 归属 + 未执行 + 未过期
  → SHA-256 校验 txBytes 完整性
  → suiClient.executeTransactionBlock(txBytes, signature)
  → waitForTransaction → extractSoulPurchasedEvent
  → syncSoulProjectionFromChain + endActiveSoulGrantProjectionsFromChain
  → 缓存结果到 SoulPreparedPurchase + SoulTxSync
  → 返回 { digest, soulOnChainId, currentOwnerAddress, ... }
```

---

## 测试账号

### 角色定义（5 角色，浏览器侧由 W0 e2e-wallet-stub 注入；env 全部位于 `.env.e2e`）

| 角色 | 浏览器登录 | API 调用 | 私钥 env | API key env |
|------|-----------|---------|----------|------------|
| Seller | stub（`localStorage['__E2E_PRIVATE_KEY'] = $E2E_SELLER_PRIVATE_KEY`） → ConnectModal 选 "E2E Test Wallet" | session cookie + `x-csrf-token` | `E2E_SELLER_PRIVATE_KEY` | — |
| Buyer | 同上，切 `$E2E_BUYER_PRIVATE_KEY` + reload | session cookie + `x-csrf-token` | `E2E_BUYER_PRIVATE_KEY` | — |
| Agent Alpha | 不进浏览器（也用于 Phase 7.10g 重新上架与 Phase 5.8 destroy_invalidated_grant 的 owned-object 签名） | `Authorization: Bearer $E2E_AGENT_ALPHA_API_KEY` | `E2E_AGENT_ALPHA_PRIVATE_KEY` | `E2E_AGENT_ALPHA_API_KEY` |
| Agent Beta | 不进浏览器 | `Authorization: Bearer $E2E_AGENT_BETA_API_KEY` | `E2E_AGENT_BETA_PRIVATE_KEY` | `E2E_AGENT_BETA_API_KEY` |
| Dev | 不进浏览器，仅用于 Phase 7.10h KioskRegistry insert-or-assert + rebind 矩阵；与 Seller / Buyer / Agent 完全隔离 | `sui client call`（用 dev keypair 切到 active-address） | `E2E_DEV_PRIVATE_KEY` | — |

> Agent 购买 / 解密脚本读取通用 env：`AGENT_PRIVATE_KEY` + `AGENT_API_KEY`。本计划统一用 `AGENT_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY"` / `AGENT_PRIVATE_KEY="$E2E_AGENT_BETA_PRIVATE_KEY"` 映射，避免依赖 mnemonic。

### `.env.e2e` 现状 + 待追加项

`.env.e2e` 已存在于仓库根目录（3582 字节）。其中已有：

```bash
NEXT_PUBLIC_SUI_NETWORK=mainnet
AUTH_SECRET=<existing 32+ bytes>
DATABASE_URL=<mainnet supabase>
DIRECT_URL=<mainnet supabase>
NEXT_PUBLIC_KIOSK_PACKAGE_ID=<mainnet kiosk>
NEXT_PUBLIC_SEAL_SERVER_CONFIGS=<mainnet seal>
NEXT_PUBLIC_SEAL_THRESHOLD=<int>
MAINNET_DEPLOYER_PRIV_KEY=suiprivkey1...   # 主测试钱包
# 注意：还有 SOUL_UPLOAD_SECRET / BLOB_READ_WRITE_TOKEN 等 legacy 项，
# wallet-paid Walrus 链路不依赖；不要删除（不在本计划编辑范围）也不要在测试里使用
```

由 AI 在 Phase -1.2 通过 W1.1 的 `scripts/e2e-bootstrap-keys.ts` **追加**写入（幂等，已有就不覆盖）：

```bash
NEXT_PUBLIC_E2E_TEST_MODE=1               # 启用 e2e-wallet-stub 注册
E2E_SELLER_PRIVATE_KEY=suiprivkey1...
E2E_BUYER_PRIVATE_KEY=suiprivkey1...
E2E_AGENT_ALPHA_PRIVATE_KEY=suiprivkey1...
E2E_AGENT_BETA_PRIVATE_KEY=suiprivkey1...
E2E_DEV_PRIVATE_KEY=suiprivkey1...
```

由用户独立提供（agent API key SHA-256 由 `scripts/e2e-setup-agents.ts` 写 DB）：

```bash
E2E_AGENT_ALPHA_API_KEY=sk-...
E2E_AGENT_BETA_API_KEY=sk-...
```

### dev server 加载 `.env.e2e`

`web/next.config.ts` 当前 `dotenv.config({ path: '../.env.local', override: true })`。本计划不修改该文件；执行前由 AI / 用户 **把 `.env.e2e` 的内容覆盖到 `.env.local`**：

```bash
cp /Users/admin/Desktop/nao/clawnews/.env.e2e /Users/admin/Desktop/nao/clawnews/.env.local
npm --prefix /Users/admin/Desktop/nao/clawnews/web run dev
```

Phase -1.5 在 env 完整性校验时显式校验：`MAINNET_DEPLOYER_PRIV_KEY` 派生地址等于 master 钱包预期地址；5 个 `E2E_*_PRIVATE_KEY` 派生的地址都已在 `accounts` / `wallet_bindings` 中（Seller / Buyer 由首次浏览器登录写入；Agent Alpha / Beta 由 `e2e-setup-agents.ts` 写入；Dev 不进 DB，仅 Phase 7.10h 用）。

### Sui CLI 速查（地址发现 + 余额检查）

> 前提：`sui client active-env` = mainnet，`sui --version` >= 1.69.0

| 命令 | 用途 |
|------|------|
| `sui client active-address` | 当前活跃地址 |
| `sui client balance <addr>` | 全币种余额 |
| `sui client balance --coin-type "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC" <addr>` | mainnet USDC 余额 |
| `sui client balance --coin-type "<MAINNET_WAL_COIN_TYPE>" <addr>` | mainnet WAL 余额（具体 coin type 由 `walrus info --context mainnet` 实测填入；mainnet WAL package 与 testnet 不同） |
| `sui client gas <addr>` | SUI gas coin 列表 |
| `sui client objects <addr>` | 所有拥有的对象（含 kiosk、Soul 等） |

> mainnet 真币没有 testnet faucet 与 USDC mint 入口；所有补给走 `MAINNET_DEPLOYER_PRIV_KEY` 钱包的预存余额（详见 Phase -1.3）。

### USDC + WAL（mainnet 真币）

| 属性 | 值 |
|------|---|
| USDC Coin Type | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC` |
| USDC Decimals | 6（1 USDC = 1,000,000 atomic units） |
| WAL Coin Type | mainnet 实测填入（`walrus info --context mainnet`） |
| Walrus Upload Relay | mainnet relay（默认 `NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL` 或显式填入 `.env.e2e`） |

> mainnet USDC / WAL 无 mint，本计划不再保留 testnet treasury cap / mint 命令。

### 钱包地址自动派生

```bash
node --input-type=module - <<'NODE'
const pairs = [
  ['MASTER_ADDR', 'MAINNET_DEPLOYER_PRIV_KEY'],
  ['SELLER_ADDR', 'E2E_SELLER_PRIVATE_KEY'],
  ['BUYER_ADDR', 'E2E_BUYER_PRIVATE_KEY'],
  ['AGENT_ALPHA_ADDR', 'E2E_AGENT_ALPHA_PRIVATE_KEY'],
  ['AGENT_BETA_ADDR', 'E2E_AGENT_BETA_PRIVATE_KEY'],
  ['DEV_ADDR', 'E2E_DEV_PRIVATE_KEY'],
]
for (const [out, env] of pairs) {
  console.log(`export ${out}=$(npx tsx -e "import { loadKeypairFromEnv } from './scripts/lib/keypair'; console.log(loadKeypairFromEnv('${env}').toSuiAddress())")`)
}
NODE
```

执行输出中的 `export ...`，得到 **MASTER_ADDR / SELLER_ADDR / BUYER_ADDR / AGENT_ALPHA_ADDR / AGENT_BETA_ADDR / DEV_ADDR**。

**运行时变量（Phase -1 动态发现 + 测试流程中捕获）：**
- `MASTER_ADDR` — `MAINNET_DEPLOYER_PRIV_KEY` 派生（Phase -1.3 注资源头校验用）
- `SELLER_ADDR` / `BUYER_ADDR` / `AGENT_ALPHA_ADDR` / `AGENT_BETA_ADDR` / `DEV_ADDR` — Phase -1.2 派生 + 注资 + Sui CLI 余额校验
- `SELLER_MEMBER_ID` — Phase -1.2 记录（Phase 10.6 Follow 用）
- `PACKAGE_ID` / `MARKET_CONFIG_ID` / `KIOSK_REGISTRY_OBJ` / `KIND_REGISTRY_OBJ` / `SOUL_TRANSFER_POLICY_ID` / `COLLECTION_TRANSFER_POLICY_ID` / `UPGRADE_CAP_ID` — Phase -1.0 从 `packages/soulidity-sdk/src/deployment-manifest.json.mainnet` 读取（值见 Context 表格）
- `SOUL_A_ID` / `SOUL_A_STATE_OBJ` / `SOUL_A_CONTENT_OBJ` / `SOUL_B_ID` / `SOUL_B_STATE_OBJ` / `SOUL_B_CONTENT_OBJ` / `COLLECTION_ID` — 测试流程中捕获
- `SOUL_A_PAID_ACCESS_OBJ` / `SOUL_B_PAID_ACCESS_OBJ` — Phase 1.6/1.7 DB 查询捕获（SoulPaidAccessList on-chain ID）
- `SOUL_A_FOUNDING_MEMORY_NAME` / `SOUL_A_FOUNDING_MEMORY_VERSION_INDEX` / `SOUL_A_INITIAL_SKILL_NAME` / `SOUL_A_INITIAL_SKILL_VERSION_INDEX` — Phase 1.6 publish sync 响应或 DB 查询捕获（Phase 5.3a-b 使用）
- `SOUL_B_FOUNDING_MEMORY_NAME` / `SOUL_B_FOUNDING_MEMORY_VERSION_INDEX` / `SOUL_B_INITIAL_SKILL_NAME` / `SOUL_B_INITIAL_SKILL_VERSION_INDEX` — Phase 1.7 publish sync 响应捕获（paid-access / detail sanity 使用）
- `SOUL_A_LISTING_OBJ` — Phase 2.2 listing TX 或 Phase 4.5 purchase 后事件捕获（Phase 11.0a 使用）
- `COLLECTION_LISTING_OBJ` — Phase 3.5 list + delist collection right 后捕获（Phase 11.0b 使用）
- `SOUL_A_SEAL_MATERIAL_JSON` / `SOUL_B_SEAL_MATERIAL_JSON` — Phase 1.6/1.7 mint gas 页在发布成功时立即捕获的 Pending Seal material JSON（Phase 2 sidecar 仍由客户端构造）；Phase 5.3b 使用 `SOUL_A_SEAL_MATERIAL_JSON` 作为预期 artifact / hash / 文件名证据

---

## Phase W0: 执行前代码前置（已落地 ✅，commit cee27a3）

> 这两项不是测试步骤；它们是让本计划真正"0 popup / 0 OTP / 0 真扩展依赖"可执行的代码前置。**2026-04-27 已落地**（commit cee27a3）：W0.1 stub 在 `web/components/providers/e2e-wallet-stub.tsx`、双门控（`NODE_ENV=development` + `NEXT_PUBLIC_E2E_TEST_MODE=1`）挂在 `app-providers.tsx` 的 dev 分支；W0.2 `scripts/e2e-setup-agents.ts` 重写为从 `E2E_AGENT_*_PRIVATE_KEY` / `E2E_AGENT_*_API_KEY` env 派生 + 幂等 create-or-update。两条都在第 7 / 9 节"已知约束"中固化条目（34 / 35）。本节保留作为执行前自检与回归口径。

### W0.1 dev-only Wallet Standard Stub（已落地）

文件：`web/components/providers/e2e-wallet-stub.tsx`，挂载点：`web/components/providers/app-providers.tsx` 的 development 分支。回归自检：
- 未设置 `localStorage['__E2E_PRIVATE_KEY']` 时不注册任何测试钱包。
- 设置 `__E2E_PRIVATE_KEY` 为 bech32 / base64 / hex Ed25519 私钥并 reload 后，dapp-kit ConnectModal 中出现 `E2E Test Wallet`。
- 该钱包支持 `standard:connect`、`sui:signPersonalMessage` v1.1、`sui:signTransaction` v2、`sui:signAndExecuteTransaction` v2；返回签名的 sender 必须等于由私钥派生出的地址。
- 双门控：`process.env.NODE_ENV === 'development'`（bundle-time）+ `process.env.NEXT_PUBLIC_E2E_TEST_MODE === '1'`（runtime）。任一不满足则 stub 不进入 bundle / 不挂载，普通 dev 会话即便 localStorage 残留 `__E2E_PRIVATE_KEY` 也不会激活。

### W0.2 Agent Setup 脚本 env-driven（已落地）

文件：`scripts/e2e-setup-agents.ts`。脚本入口 `import './lib/dotenv'` 自动加载 `.env` + `.env.local`。回归自检：
- 从 `E2E_AGENT_ALPHA_PRIVATE_KEY` / `E2E_AGENT_BETA_PRIVATE_KEY` 派生 Sui 地址（`loadKeypairFromEnv`）。
- 从 `E2E_AGENT_ALPHA_API_KEY` / `E2E_AGENT_BETA_API_KEY` 计算 SHA-256 hash。
- 通过 `E2E_AGENT_OWNER_WALLET`（推荐）或 `E2E_SELLER_PRIVATE_KEY` 派生 owner 地址 → 找到该钱包对应的 `Account` → 把两个 agent 作为 sibling `Member(kind='agent', agentStatus='active', apiKeyHash=...)` 挂在 owner Account 下，并维护 `WalletBinding(chain='sui', address=...)`。`web/lib/auth/resolve-agent.ts` 要求 agent Account 同时持有 `kind='human'` member 才能填充 `ownerMemberId`，因此必须先让 owner 钱包通过浏览器登录建账（产生 `WalletBinding` 行）后再跑该脚本。
- 重跑脚本幂等：连续两次得到相同 member ID + apiKeyHash，且输出 wallet 必须分别等于 `$AGENT_ALPHA_ADDR` / `$AGENT_BETA_ADDR`。

---

## Phase W1: 执行前支撑脚本补丁（必须先落地）

> 这是 mainnet 执行硬门槛，不计入主流程通过数。当前计划依赖的支撑脚本 / 脚本升级如果在 checkout 中不存在，必须先补齐脚本与最小测试，再进入 Phase -1；禁止把缺脚本的失败归类为 mainnet 业务失败，也禁止手工绕过注资、paid-access、env gate 或逐字节比对步骤。
>
> **本轮测试中产生但不清理的支撑脚本**：`scripts/e2e-bootstrap-keys.ts`、`scripts/e2e-fund-roles.ts`、`web/scripts/e2e-relist-soul.ts`。这 3 个不是一次性 scratch 文件，分别承担 `.env.e2e` 角色私钥 bootstrap、mainnet 角色再平衡、Soul 重新上架 / stale paid-access 构造；必须保留、纳入 git 跟踪，并在本节 W1.1 / W1.2 / W1.7 与第 9 节脚本清单中同步维护。若后续决定删除其中任一脚本，必须先从本计划移除对应测试步骤并改写替代执行路径。

### W1.1 角色私钥 bootstrap

文件：`scripts/e2e-bootstrap-keys.ts`。契约：
- 幂等读取 `.env.e2e`。
- 缺失 `E2E_SELLER_PRIVATE_KEY` / `E2E_BUYER_PRIVATE_KEY` / `E2E_AGENT_ALPHA_PRIVATE_KEY` / `E2E_AGENT_BETA_PRIVATE_KEY` / `E2E_DEV_PRIVATE_KEY` 时生成 Ed25519 keypair，并以 `suiprivkey1...` 追加写回。
- 确保 `NEXT_PUBLIC_E2E_TEST_MODE=1` 存在。
- 不覆盖 `MAINNET_DEPLOYER_PRIV_KEY` / `AUTH_SECRET` / `DATABASE_URL` / `DIRECT_URL` / 任何已存在的 E2E key。
- 验证：对临时 env 文件跑两次，第二次 diff 为空；输出 5 个地址均可由 `scripts/lib/keypair.ts::loadKeypairFromEnv` 派生。

### W1.2 mainnet 5 角色注资

文件：`scripts/e2e-fund-roles.ts`。契约：
- mainnet-only；`NEXT_PUBLIC_SUI_NETWORK !== mainnet` 直接 abort。
- 用 `MAINNET_DEPLOYER_PRIV_KEY` 签 1 笔 PTB，按 Phase -1.3 表的差额补齐 Seller / Buyer / Agent Alpha / Agent Beta / Dev 的 SUI、WAL、USDC。
- 支持 dry-run 与显式执行模式；执行模式必须在发送 TX 前打印 funder、recipient、coin type、目标余额、差额。
- 失败时明确区分 master 余额不足、WAL coin type 未配置、coin selection 失败、dry-run abort、execute abort。
- 验证：unit 测试覆盖差额计算与缺 env abort；mainnet 执行前先跑 dry-run，确认不会向非 E2E 地址转账。

### W1.3 Phase 2 paid-access lifecycle CLI

文件：`web/scripts/e2e-paid-access-lifecycle.ts`。契约：
- 读取 `.env.local` / `.env.e2e` 后使用 `@soulidity/sdk` builder，不再调用旧 `content_access::*`。
- 支持 `set-config` / `update-config` / `delete-config` / `purchase` / `add-access` / `revoke` / `inspect-config` / `inspect-access`。
- 正向主流程只配置当前支持 `READ_PAID` 的 kind：`KIND_SPRITE = 3` 或 `KIND_AUDIO = 4`；本计划统一用 `KIND_SPRITE = 3`、`SCOPE_MASK = 8`。
- `purchase` 必须做 USDC coin selection，按 `quote_paid_access_purchase` 的 total 支付，并输出 `SoulPaidAccessPurchased` / `SoulPaidAccessGranted` 事件、TX digest、buyer、recipient、platform_fee、ownership_epoch_snapshot。
- `inspect-config` / `inspect-access` 通过 `devInspectTransactionBlock` 调 accessor / `has_access`，不得 SQL 模拟。
- 验证：用 mocked Sui client 或 builder-level tests 覆盖参数装配；实际 mainnet 执行前先跑 `inspect-config` 空配置路径，确认不会发 TX。

### W1.4 Phase 2 grant 解密逐字节比对

文件：`web/scripts/e2e-agent-verify-content.ts`。契约：
- Agent grant 内容验收走 Node 脚本是本计划的正式路径，不要求浏览器 UI 暴露 memory / skill 解密入口；但脚本必须真实走 Agent Alpha Bearer + 私钥签出的 granted-agent Seal session，不能用 pending material 的 raw DEK / IV 直接解密。
- 必须从当前 SOUL 的 `SoulAsset.contentOnChainId` + `SoulContentVersionRecord` 精确选择 `KIND_SOUL_DOC/name=soul/version=0`、`KIND_MEMORY/name=memory/version=0` 两个初始 artifact。
- 脚本必须以 Agent Alpha 身份执行：`AGENT_API_KEY` 解析 agent 钱包地址，`AGENT_PRIVATE_KEY` 签 Seal session；accessKind 必须是 `granted-agent`，授权来自 owner 在 Test 5.2 给 Soul A 发放的 active SoulGrant。
- `soul.md` 可以继续通过 `/api/agent/souls/{id}/access` 黑盒验证；`memory.md` 不允许恢复 Phase 1 per-kind HTTP 路由，脚本应在 Node 内复用 `resolveContentAccessPayload()` 或同等 SDK/DB resolver 生成 `KIND_MEMORY` access payload。
- 输入统一使用 `PENDING_SEAL_MATERIALS_JSON` 与 `COMPARE_MAP_JSON`；`PENDING_SEAL_MATERIALS_JSON` 只作为预期 artifact / hash / 文件名证据，不得用其中的 raw DEK/IV 直接解密来绕过 Seal。缺任一 artifact material、缺 DB content version、缺 Walrus blob、缺 Seal sidecar、Seal session 解密失败或字节不一致均退出非 0。
- 最终输出必须为 `OK 2 artifact(s) matched byte-for-byte.`；`OK 1 artifact(s)` 只能作为 W1.4 升级前的失败证据，不能进入主验收。
- 验证：补 regression 覆盖两个 artifact 选择、unsupported key hard-fail、缺 material hard-fail、非 granted-agent access hard-fail；mainnet 执行前用本地 fixture 跑到 2 artifact 输出。

### W1.5 Phase 2 negative Move tests 固化

文件：`move/soulidity/sources/protocol_tests.move`。契约：
- 在 Phase -1 启动前必须存在以下 4 条 negative test，分别由 `#[expected_failure(abort_code = ...)]` 注解锁定：
  - `destroy_invalidated_grant_aborts_when_grant_still_active` — abort `soulidity::grant::EGrantStillActive`（被 Test 5.8 step 5 引用）
  - `purchase_paid_access_aborts_when_price_zero` — abort `soulidity::market::EPaidAccessNotPurchasable`（被 Test 7.10d 引用）
  - `configure_paid_access_kind_rejects_scope_mismatch` — abort `soulidity::paid_access::EKindScopeMismatch`（被 Test 7.10e 引用）
  - `delete_soul_listing_aborts_when_active` — abort `soulidity::market::EListingStillActive`（被 Test 11.0a step 4 引用）
- 不允许在 mainnet 测试运行中途 grep 现有 test 名或新增 negative test —— 这是 Phase 2 Move 协议测试基线（行 91 注释中 102 项 `#[test...]` 属性）的硬约束之一。
- 执行顺序：这 4 条 fixed negative tests 不调用 mainnet 合约，也不依赖 E2E 资产状态；必须在 Phase -1 funding / mainnet 写链 TX 之前一次性跑完并留存日志，后续 Test 5.8 / 7.10d / 7.10e / 11.0a 只引用这份 preflight 证据，不在中途重新选名或补测。Test 7.10j 的 `owner_cannot_purchase_paid_access` 也是本地 Move proof，同批前置留证；7.10j mainnet 阶段只跑 dry-run 作为运行时证据。
- 验证：`cd move/soulidity && sui move test` 全绿（102 项）；上述 4 个 test 名分别可通过 `sui move test <name>` 单独运行并输出 `[ PASS    ]` + `Test result: OK. Total tests: 1; passed: 1; failed: 0`。

执行命令（必须在 Phase -1 funding 前完成）：

```bash
set -euo pipefail
REPO_ROOT="/Users/admin/Desktop/nao/clawnews"
: "${RUN_DATE:=$(date +%Y-%m-%d)}"
: "${ARTIFACT_DIR:=e2e-artifacts/${RUN_DATE}}"
case "$ARTIFACT_DIR" in
  /*) ;;
  *) ARTIFACT_DIR="$REPO_ROOT/${ARTIFACT_DIR#./}" ;;
esac
mkdir -p "$ARTIFACT_DIR"
cd "$REPO_ROOT/move/soulidity"
sui move test 2>&1 | tee "$ARTIFACT_DIR/w1.5-move-all.log"
for name in \
  destroy_invalidated_grant_aborts_when_grant_still_active \
  purchase_paid_access_aborts_when_price_zero \
  configure_paid_access_kind_rejects_scope_mismatch \
  delete_soul_listing_aborts_when_active \
  owner_cannot_purchase_paid_access
do
  sui move test "$name" 2>&1 | tee "$ARTIFACT_DIR/w1.5-${name}.log"
done
```

### W1.6 mainnet env gate

文件：`scripts/e2e-check-env.ts`。契约：
- 读取 `.env.e2e`，并校验 `NEXT_PUBLIC_SUI_NETWORK=mainnet`、`AUTH_SECRET`、`DATABASE_URL` / `DIRECT_URL`、`MAINNET_DEPLOYER_PRIV_KEY`、5 个 `E2E_*_PRIVATE_KEY`、2 个 `E2E_AGENT_*_API_KEY`、mainnet Seal / Walrus / Kiosk 配置均存在且非占位。
- 派生并打印 master / Seller / Buyer / Agent Alpha / Agent Beta / Dev 地址；任一私钥无法解析或地址重复时退出非 0。
- 校验 deployment manifest mainnet 段与 `getRequiredSoulidityEnv()` 解析值一致；发现 testnet packageId、占位 WAL coin type、缺 Seal threshold、缺 upload relay 时退出非 0。
- 验证：先用临时缺字段 env 跑出非 0，再用完整 `.env.e2e` 跑出 `Env gate OK: mainnet e2e prerequisites present.`；未通过不得启动 dev server 或注资。

### W1.7 relist Soul 支撑脚本

文件：`web/scripts/e2e-relist-soul.ts`。契约：
- 复用 `@soulidity/sdk` 的 `buildListSoulTx`，不允许手写 PTB。
- 入参：`OWNER_PRIVATE_KEY` / `PACKAGE_ID` / `MARKET_CONFIG_ID` / `KIOSK_REGISTRY_OBJ` / `SOUL_STATE_OBJECT_ID` / `SOUL_KIOSK_ID` / `SOUL_KIOSK_CAP_ID` / `PRICE_ATOMIC` (> 0) / `COLLECTION_OBJECT_ID`(可选)。
- 必须提取 `SoulListed` 事件并打印 `parsedJson`；事件缺失时退出非 0。
- 验证：脚本进入 git tracked 状态（不再是 `??`）；本计划基线固化时一并 commit。

---

## Phase -1: 环境准备

### -1.0 读取部署 manifest

```bash
cd /Users/admin/Desktop/nao/clawnews
eval "$(node - <<'NODE'
const manifest = require('./packages/soulidity-sdk/src/deployment-manifest.json').mainnet
const vars = {
  PACKAGE_ID: manifest.packageId,
  MARKET_CONFIG_ID: manifest.marketConfigId,
  KIOSK_REGISTRY_OBJ: manifest.kioskRegistryId,
  KIND_REGISTRY_OBJ: manifest.kindRegistryId,
  SOUL_TRANSFER_POLICY_ID: manifest.soulTransferPolicyId,
  COLLECTION_TRANSFER_POLICY_ID: manifest.collectionTransferPolicyId,
  PAYMENT_COIN_TYPE: manifest.paymentCoinType,
  UPGRADE_CAP_ID: manifest.upgradeCapId,
  MARKET_ADMIN_CAP_ID: manifest.marketAdminCapId,
  KIND_ADMIN_CAP_ID: manifest.kindAdminCapId,
  SOUL_POLICY_CAP_ID: manifest.soulPolicyCapId,
  COLLECTION_POLICY_CAP_ID: manifest.collectionPolicyCapId,
}
for (const [key, value] of Object.entries(vars)) {
  if (!value) throw new Error(`Missing ${key} in deployment manifest .mainnet`)
  console.log(`export ${key}=${JSON.stringify(value)}`)
}
NODE
)"
```

验证：
- `$PACKAGE_ID` / `$KIND_REGISTRY_OBJ` 等变量均非空，且与 Context 表格 mainnet 段完全一致
- `move/soulidity/Published.toml` 的 `published-at` / `original-id` / `upgrade-capability` 与 manifest 的 `packageId` / `upgradeCapId` 一致
- 未引用 testnet 段任何 ID

### -1.1 DB Soulidity 数据 reset（保留账号 / 钱包 / API key）

执行本节任何 `DELETE` 之前，必须先完成 `.env.e2e` bootstrap 与 mainnet env gate；未通过不得连接 mainnet DB，也不得注资：

```bash
cd /Users/admin/Desktop/nao/clawnews
npx tsx scripts/e2e-bootstrap-keys.ts
npx tsx scripts/e2e-check-env.ts
```

若 `scripts/e2e-check-env.ts` 因 `MAINNET_WAL_COIN_TYPE` 缺失或占位失败，先用 `walrus info --context mainnet` 实测 WAL coin type 并写回 `.env.e2e`；Phase -1.8 仍负责记录 relay tip-config 与 runtime probe 结果。

```bash
cd /Users/admin/Desktop/nao/clawnews
psql "$DATABASE_URL" <<'SQL'
DELETE FROM "soul_grant_records";
DELETE FROM "soul_paid_access_entries";
DELETE FROM "soul_paid_access_kind_configs";
DELETE FROM "soul_content_version_records";
DELETE FROM "soul_prepared_purchases";
DELETE FROM "soul_tx_syncs";
DELETE FROM "soul_collection_assets";
DELETE FROM "soul_assets";
SQL
```

> Phase 2 schema：`soul_skill_version_records` / `soul_memory_entries` / `soul_asset_version_records` / `content_access_records` 已被 migration `20260504150000_phase2_unified_content` 删除，对应数据合并到 `soul_content_version_records`；`soul_paid_access_kind_configs` / `soul_paid_access_entries` 取代 `content_access_records`。

本节只允许执行上面的 scoped `DELETE` 清理，必须保留 `accounts` / `members` / `wallet_bindings` / `wallet_challenges` 以及 agent `api_key_hash` 所在账号数据。`bookmarks` 通过 `soul_assets` 外键级联清理，`follows` 是 member-to-member 社交图，禁止在本 reset 中全表删除。**禁止**在 mainnet E2E 数据库上执行 `npx prisma migrate reset --force --skip-seed`；该命令会重置全库，和“保留账号 / 钱包 / API key”的验收目标冲突。清理后，`scripts/e2e-setup-agents.ts` 仍可幂等 create-or-update Agent Alpha / Beta；若 Seller / Buyer / Dev 钱包绑定不存在，按 Phase -1.2 登录流程补建。

### -1.2 钱包生成 + 账号初始化（全自动）

**Step 0 — 准备 `.env.e2e`（一次性）：**

```bash
cd /Users/admin/Desktop/nao/clawnews

# 已在 -1.1 DB reset 前执行过；这里允许幂等复跑，确保 shell 续跑时 .env.e2e 完整。
npx tsx scripts/e2e-bootstrap-keys.ts

# 把 .env.e2e 内容拷到 .env.local 供 dev server 加载
cp .env.e2e .env.local
```

`scripts/e2e-bootstrap-keys.ts` 契约见 Phase W1.1；Phase -1 执行时必须确认该文件存在且 dry-run / 临时 env 测试已通过。摘要：
- 检查 `.env.e2e` 中是否已有 `E2E_SELLER_PRIVATE_KEY` / `E2E_BUYER_PRIVATE_KEY` / `E2E_AGENT_ALPHA_PRIVATE_KEY` / `E2E_AGENT_BETA_PRIVATE_KEY` / `E2E_DEV_PRIVATE_KEY`
- 任一缺失则 `Ed25519Keypair.generate()` 一把，bech32 序列化追加写回 `.env.e2e`
- 同时确保 `NEXT_PUBLIC_E2E_TEST_MODE=1` 行存在
- **不**覆盖现有键值；**不**修改 `MAINNET_DEPLOYER_PRIV_KEY` / `AUTH_SECRET` 等用户预置项
- 失败任何步骤直接 abort（按"测试纪律"硬约束）

**Step 1 — 派生 6 个地址：**

执行"测试账号 — 钱包地址自动派生" bash 块，把 `MASTER_ADDR / SELLER_ADDR / BUYER_ADDR / AGENT_ALPHA_ADDR / AGENT_BETA_ADDR / DEV_ADDR` 全部 `export` 到当前 shell。

**Step 2 — 校验 / 刷新 Agent 账号（Seller / Buyer 由首次浏览器登录自动建账）：**

```bash
npx tsx scripts/e2e-setup-agents.ts
```

脚本按 `E2E_AGENT_*_PRIVATE_KEY` 派生地址、`E2E_AGENT_*_API_KEY` 计算 SHA-256，幂等 create-or-update `Account` / `Member(kind='agent', agentStatus='active')` / `WalletBinding(chain='sui')`，通过 `E2E_AGENT_OWNER_WALLET`（推荐）或 `E2E_SELLER_PRIVATE_KEY` 把 agents 挂在 owner Account 下。通过标准：脚本输出的 Alpha / Beta wallet 必须分别等于 `$AGENT_ALPHA_ADDR` / `$AGENT_BETA_ADDR`；连续两次执行得到相同 member ID + hash。若 owner 钱包尚无 `WalletBinding` 行，脚本会报错并指向"先用 owner 钱包通过浏览器登录一次"——这是预期路径。

**Step 3 — Sui CLI 链上验证 5 角色地址可达：**

```bash
for var in SELLER_ADDR BUYER_ADDR AGENT_ALPHA_ADDR AGENT_BETA_ADDR DEV_ADDR; do
  ADDR=${!var}
  echo "=== $var = $ADDR ==="
  sui client balance "$ADDR" 2>&1 | head -20
done
```

5 个地址均应返回余额信息（即使为 0 也说明地址在链上存在）。

**Step 4 — 记录 SELLER_MEMBER_ID（Phase 10.6 Follow 用）：**

> Seller 的 `members` 行只有在 Test 1.1 完成首次登录后才存在。本步暂留 `SELLER_MEMBER_ID=` 占位；Test 1.1 之后回填：
>
> ```sql
> SELECT m.id FROM members m
> JOIN wallet_bindings wb ON wb.member_id = m.id
> WHERE wb.address = '$SELLER_ADDR' AND wb.chain = 'sui';
> ```

### -1.3 钱包余额检查 + master-funded 注资（mainnet 真币）

**前提（用户在执行前必须完成）：** `MAINNET_DEPLOYER_PRIV_KEY` 派生地址（`MASTER_ADDR`）持有：
- ≥ 2 SUI（master 自己 gas + 5 角色注资 PTB gas）
- ≥ 130,000,000 atomic mainnet WAL（Seller 5M + Buyer 100M + Dev 5M + 自留缓冲 20M）
- ≥ 12,000,000 atomic USDC（即 12 USDC，覆盖 Buyer paid-access / Soul 购买、Agent Alpha 购买 Soul B、Seller 回购 Soul B，以及手续费缓冲）

**最低余额要求（注资后）：**

| 角色 | SUI Gas / Relay Tip | WAL Storage | Mainnet USDC | 用途 |
|------|---------------------|-------------|-----------|------|
| Seller | ≥ 0.5 SUI | ≥ 5,000,000 atomic WAL | ≥ 1,000,000 atomic USDC（1 USDC） | Soul A/B + Collection 创建（4-5 次 wallet-paid Walrus register/certify）+ List / Grant / SetGrantCapacity + Phase 7.10g 回购 Soul B |
| Buyer | ≥ 0.5 SUI | ≥ 100,000,000 atomic WAL | ≥ 5,000,000 atomic USDC（5 USDC） | 购买 Soul A 0.1 USDC + 购买 collection 子 Soul 0.1 USDC（Test 4.5a，含 collection royalty）+ Phase 6 skills append + Phase 8 import（2026-05-05 小 fixture 实测 quote 77,112,000 atomic WAL）+ Phase 7.10a/f/g paid-access purchase 多次 |
| Agent Alpha | ≥ 0.3 SUI | — | ≥ 5,000,000 atomic USDC（5 USDC） | Agent 购买 Soul B 0.1 USDC + Phase 7.10a 配置 paid-access + Phase 7.10g 重新上架 + Phase 5.8 destroy_invalidated_grant 签名 |
| Agent Beta | ≥ 0.1 SUI | — | — | 仅 403 验证 + gas 备用 |
| Dev | ≥ 0.3 SUI | ≥ 5,000,000 atomic WAL | — | Phase 7.10h KioskRegistry 矩阵：3-4 个 sui client call 的 gas + step 4 把 1 个 dev Soul lock 到 DEV_KIOSK_A 用的 Walrus storage |

WAL 下限是小 fixture 的执行缓冲，不是协议常量。Buyer 目标按 2026-05-05 Phase 8 mainnet import 实测 `UploadCostReview` quote `77,112,000` atomic WAL 加缓冲设置。每次执行仍以 `UploadCostReview` 的 `WAL storage` 实时报价为准：若 quote 总和超过表格缓冲，先补 WAL 再继续；不得用 `__e2eUpload` 自动 approve 跳过成本确认。

**注资熔断硬上限（W1.2 `scripts/e2e-fund-roles.ts` 内固化，无法绕过）：**

| 维度 | 上限 | 说明 |
|------|------|------|
| 单笔 PTB SUI 总额 | 5 SUI | 触发即 abort，禁止单次大额转账 |
| 单笔 PTB WAL 总额 | 150,000,000 atomic | 同上 |
| 单笔 PTB USDC 总额 | 30,000,000 atomic（30 USDC） | 同上 |
| 单角色单次 SUI top-up | 1 SUI | 任意 recipient 超限 abort，不发 TX |
| 单角色单次 WAL top-up | 120,000,000 atomic | 同上 |
| 单角色单次 USDC top-up | 10,000,000 atomic（10 USDC） | 同上 |

注资脚本默认 dry-run；要实际发 TX 必须显式 `--execute`。dry-run 阶段会打印每个 recipient 的 `current` / `target` / `diff`，已达标的角色 `diff=0` 自动跳过、不会重复转账。任何上限超出在 dry-run 阶段就抓住，绝不会进入 execute。

**Step 1 — 校验 master 钱包预存：**

```bash
USDC_TYPE="0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
# WAL_TYPE 不允许保留占位字符串 —— 必须先用 walrus info / Phase -1.8 的 walrus-info.txt 实测后写回 .env.e2e。
# 缺失或仍为占位时 abort 整轮测试。
WAL_TYPE="${MAINNET_WAL_COIN_TYPE:-}"
case "$WAL_TYPE" in
  ""|"<"*">"|"<MAINNET_WAL_COIN_TYPE>")
    echo "WAL_TYPE 未配置或仍为占位字符串；先跑 Phase -1.8 walrus info 实测，写入 .env.e2e MAINNET_WAL_COIN_TYPE=0x...::wal::WAL 后再继续。"
    exit 1
    ;;
  0x*::*::*) ;;
  *)
    echo "WAL_TYPE 必须是 '0x...::module::SYM' 形式，当前: $WAL_TYPE"
    exit 1
    ;;
esac
echo "=== MASTER_ADDR = $MASTER_ADDR ==="
sui client balance "$MASTER_ADDR" 2>&1 | head -20
sui client balance --coin-type "$WAL_TYPE" "$MASTER_ADDR" 2>&1 | head -5
sui client balance --coin-type "$USDC_TYPE" "$MASTER_ADDR" 2>&1 | head -5
```

通过标准：master 钱包同时满足上面 SUI ≥ 2 / WAL ≥ 130M atomic / USDC ≥ 12M atomic。
不满足时按"测试纪律"硬约束直接 abort 测试，**禁止绕过**。W1.2 的 `scripts/e2e-fund-roles.ts` 会在 dry-run 阶段按目标差额、master 实际余额与熔断上限 fail closed；缺口未补齐不得进入 execute。

**Step 2 — 单笔 PTB 转账给 5 个角色：**

```bash
npx tsx scripts/e2e-fund-roles.ts
npx tsx scripts/e2e-fund-roles.ts --execute
```

`scripts/e2e-fund-roles.ts` 契约见 Phase W1.2；Phase -1 执行时必须确认该文件存在且 dry-run 输出只包含本轮 E2E 地址。摘要：
- 用 `MAINNET_DEPLOYER_PRIV_KEY` 签 1 笔 PTB，按"最低余额要求"表的差额补到目标值
  - SUI 转账：`tx.transferObjects([tx.splitCoins(tx.gas, [needSui])], recipient)` × 5
  - WAL 转账：`tx.splitCoins(tx.object(walCoin), [needWal])` 然后 transferObjects（Seller / Buyer / Dev）
  - USDC 转账：同上模式（Seller / Buyer / Agent Alpha）
- 输出每地址转账后的实际余额；任意地址注资后仍未达标则 abort
- 失败时打印根因（master 余额不足 / coin selection 失败 / TX abort），按"测试纪律"流程修源后重跑

**Step 3 — 校验 5 角色注资到位：**

```bash
for var in SELLER_ADDR BUYER_ADDR AGENT_ALPHA_ADDR AGENT_BETA_ADDR DEV_ADDR; do
  ADDR=${!var}
  echo "=== $var = $ADDR ==="
  sui client balance "$ADDR" 2>&1 | head -10
  sui client balance --coin-type "$WAL_TYPE" "$ADDR" 2>&1 | head -5
  sui client balance --coin-type "$USDC_TYPE" "$ADDR" 2>&1 | head -5
done
```

5 个地址 SUI / WAL / USDC 均 ≥ 表格阈值，否则按"测试纪律"流程定位 fund-roles 失败原因后重跑。

### -1.4 验证测试 Fixture

验证文件存在且完整：
```bash
ls -la /Users/admin/Documents/example/soul.md \
       /Users/admin/Documents/example/memory.md \
       /Users/admin/Documents/example/images.jpeg \
       /Users/admin/Documents/example/skills.zip \
       /Users/admin/Documents/example-collection/soul-collection-template.xlsx \
       /Users/admin/Documents/example-collection/1/soul.md \
       /Users/admin/Documents/example-collection/1/memory.md \
       /Users/admin/Documents/example-collection/1/images.jpeg \
       /Users/admin/Documents/example-collection/1/skills.zip
```

### -1.5 确认 Dev Server 运行 + Env 完整性

- 推荐不覆盖开发者本地 `.env.local`，直接用 shell-safe `.env.e2e` 启动 mainnet E2E dev server，并显式禁止 `.env.local` override：

  ```bash
  set -a
  . /Users/admin/Desktop/nao/clawnews/.env.e2e
  set +a
  CLAWNEWS_LOAD_ENV_LOCAL=false npm --prefix /Users/admin/Desktop/nao/clawnews/web run dev -- --port 3100
  ```

  `.env.e2e` 中含 JSON 的值必须 shell-safe（例如 `NEXT_PUBLIC_SEAL_SERVER_CONFIGS='[{"objectId":"0x...","weight":1}]'`），否则 `source .env.e2e` 会剥掉 JSON 双引号，浏览器端 `JSON.parse` 失败。若选择旧方式 `cp .env.e2e .env.local`，也必须保证 `.env.local` 没有 testnet / local override 残留。

- 当前前端：`curl http://localhost:3100/market`（确认 HTML 含 "Soulidity"）
- Agent API 在 `web/` 应用（port 3100）。

**Env 必填校验（来自 `.env.e2e`）：**

| 变量 | 用途 |
|------|------|
| `NODE_ENV=development` | W0 e2e-wallet-stub bundle-time gate（dev 默认） |
| `NEXT_PUBLIC_E2E_TEST_MODE=1` | runtime gate；启用 e2e-wallet-stub 注册 |
| `NEXT_PUBLIC_SUI_NETWORK=mainnet` | web、Walrus quote/upload、Seal helper 与 Node 脚本都按此选择网络 |
| `AUTH_SECRET` | ≥ 32 字节随机；签 session JWT |
| `DATABASE_URL` / `DIRECT_URL` | mainnet supabase（`.env.e2e` 已配置，prisma 与 web server 共用） |
| `NEXT_PUBLIC_KIOSK_PACKAGE_ID` | mainnet kiosk package；与 `KIND_REGISTRY_OBJ` 一起用于 PTB 构造 |
| `NEXT_PUBLIC_SEAL_SERVER_CONFIGS` / `NEXT_PUBLIC_SEAL_THRESHOLD` | mainnet Seal key servers（mainnet 必须显式配置，无默认） |
| `MAINNET_DEPLOYER_PRIV_KEY` | master 钱包私钥（注资 5 角色的源头） |
| `E2E_SELLER_PRIVATE_KEY` / `E2E_BUYER_PRIVATE_KEY` / `E2E_AGENT_ALPHA_PRIVATE_KEY` / `E2E_AGENT_BETA_PRIVATE_KEY` / `E2E_DEV_PRIVATE_KEY` | 5 个角色 keypair |
| `E2E_AGENT_ALPHA_API_KEY` / `E2E_AGENT_BETA_API_KEY` | agent setup 脚本 + Bearer auth |
| `E2E_AGENT_OWNER_WALLET` | 默认可省；缺失时 setup 脚本回退到 `E2E_SELLER_PRIVATE_KEY` 派生地址 |

**Wallet-paid Walrus / Seal 显式覆盖（mainnet 必须与 `NEXT_PUBLIC_SUI_NETWORK=mainnet` 一致）：**
- `NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL`（mainnet upload relay）
- `NEXT_PUBLIC_WALRUS_AGGREGATOR_URL`（mainnet aggregator）
- `NEXT_PUBLIC_WALRUS_WASM_URL`（默认从 `@mysten/walrus-wasm` CDN 加载）

**禁用项**：repo guard 强制 `client-upload.ts` 不依赖 `BLOB_READ_WRITE_TOKEN` / `WALRUS_PUBLISHER_URL` / `SOUL_UPLOAD_SECRET`。这些项可能仍存在于 `.env.e2e`（legacy），但 wallet-paid Walrus 测试链路 **绝对不能引用**；引用了立即按"测试纪律"硬约束 abort。`NEXT_PUBLIC_SEAL_SERVER_CONFIGS` / `NEXT_PUBLIC_SEAL_THRESHOLD` / `NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS` 必须显式指向 mainnet 配置，不能依赖 testnet 默认。
- W0 Stub 自检：设置 `localStorage['__E2E_PRIVATE_KEY']` 后 reload，打开 dapp-kit ConnectModal；最新 `take_snapshot` 必须出现 "E2E Test Wallet" 条目。不要用 `navigator.wallets` 断言，当前 stub 通过 Wallet Standard `registerWallet()` 注册，仓库没有把钱包列表暴露到 `navigator.wallets`。
- 严禁出现 `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_CUSTOM_AUTH_*`（CI 有 ripgrep no-residue guard）。E2E 用户上传链路也不得引用 `BLOB_READ_WRITE_TOKEN`、`WALRUS_PUBLISHER_URL` 或 `SOUL_UPLOAD_SECRET`；这些若在本地存在，只能服务 desktop release / 历史批量发布脚本 / 内部白盒脚本，不能作为主流程前提。

**Seal mainnet key-server probe（必做，错配会让 Phase 5.3a 在 Buyer 已花掉 0.105 USDC 之后才暴露）：**

probe 路径 (`SEAL_PROBE_PATH`) 默认按以下优先级选择，**不允许在测试运行时手工 grep**：

1. 显式 `SEAL_PROBE_PATH=/v1/service` env override（CI / 手动覆盖）
2. 自动 grep 仓库内 `web/lib/seal*.ts` / `web/lib/services/seal*.ts` 中第一个匹配 `/^\/v1\/(service|service-info|health)/` 的 path 字面量
3. fallback `/v1/service`

```bash
node --input-type=module - <<'NODE' | tee "$ARTIFACT_DIR/seal-probe.json"
import { execSync } from 'node:child_process'

let probePath = process.env.SEAL_PROBE_PATH?.trim()
if (!probePath) {
  try {
    const grep = execSync(
      "grep -hoE '/v1/(service|service-info|health)' web/lib/services/seal.ts web/lib/seal*.ts 2>/dev/null | head -1",
      { encoding: 'utf8' },
    ).trim()
    if (grep) probePath = grep
  } catch { /* ignore */ }
}
if (!probePath) probePath = '/v1/service'
console.error('Seal probe path:', probePath)

const raw = process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS
if (!raw) {
  console.error('NEXT_PUBLIC_SEAL_SERVER_CONFIGS missing — abort')
  process.exit(1)
}
let configs
try { configs = JSON.parse(raw) } catch { configs = raw.split(',').map(u => ({ url: u.trim() })) }
const list = Array.isArray(configs) ? configs : configs.servers ?? []
const results = []
for (const entry of list) {
  const url = (typeof entry === 'string' ? entry : entry.url ?? entry.endpoint)?.replace(/\/$/, '')
  if (!url) continue
  let status = 0, ok = false, err = null
  try {
    const res = await fetch(url + probePath, { method: 'GET' })
    status = res.status; ok = res.ok
  } catch (e) { err = String(e) }
  results.push({ url, probePath, status, ok, err })
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), probePath, results }, null, 2))
const reachable = results.filter((r) => r.ok).length
const threshold = Number(process.env.NEXT_PUBLIC_SEAL_THRESHOLD ?? 0)
if (reachable < Math.max(threshold, 1)) {
  console.error(`Reachable Seal servers (${reachable}) < threshold (${threshold || 1}) — abort`)
  process.exit(1)
}
NODE
```

通过标准：所有配置的 Seal key server probe path 返回 2xx；可达数 ≥ `NEXT_PUBLIC_SEAL_THRESHOLD`。失败按"测试纪律"硬约束 abort，禁止继续到 Phase 5.3a 才暴露。

**KindAdminCap chain probe（确认 manifest `kindAdminCapId` 与链上 cap 一致，避免 Phase 2 admin 路径 typo）：**

```bash
sui client object $KIND_ADMIN_CAP_ID --json 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)['data']
print('owner:', d['owner'])
print('objType:', d['type'])
print('objectId:', d['objectId'])
"
```

通过标准：`objectId == $KIND_ADMIN_CAP_ID`，`objType` 含 `kind_registry::KindAdminCap`，`owner` 为 master 钱包地址或 multisig 待交接地址。`objectId` 不一致则按"测试纪律"流程定位 manifest / 链上不一致后修源。本步骤不实际 `register_kind`（避免污染 mainnet KindRegistry），只校验 cap 链路。

### -1.6 清空浏览器状态
`evaluate_script`: `localStorage.clear(); sessionStorage.clear();`

### -1.7 创建截图产物目录

所有截图统一写入 `ARTIFACT_DIR=e2e-artifacts/<RUN_DATE>`。执行前创建：
```bash
RUN_DATE=$(date +%F)
export ARTIFACT_DIR="e2e-artifacts/${RUN_DATE}"
mkdir -p "$ARTIFACT_DIR"
```

### -1.8 Mainnet Walrus capability probe

本步骤只确认 mainnet 公共 Walrus 服务当前可用边界；不上传业务 fixture，不替代 Phase 1 / 3 / 6 / 8 的真实 wallet-paid UI 上传。

**Step 1 — relay tip-config 可达：**
```bash
cd /Users/admin/Desktop/nao/clawnews
WALRUS_RELAY="${NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL:-https://upload-relay.mainnet.walrus.space}"
curl -fsS "${WALRUS_RELAY%/}/v1/tip-config" | tee "$ARTIFACT_DIR/walrus-tip-config.json"
```
通过标准：退出码 0，JSON 为 `no_tip` 或 `send_tip`。失败 / 超时 / 429 / 5xx = 环境阻塞，按"测试纪律"流程先定位（DNS / TLS / relay 端口 / mainnet relay URL 是否准确）后修源；不能继续声称 wallet-paid upload 已通过。

**Step 2 — 记录协议上限（有 `walrus` CLI 时执行）：**
```bash
if command -v walrus >/dev/null 2>&1; then
  walrus info --context mainnet | tee "$ARTIFACT_DIR/walrus-info.txt"
else
  echo "walrus CLI not installed; protocol info probe not executed" | tee "$ARTIFACT_DIR/walrus-info.txt"
fi
```
通过标准：如果 CLI 存在，输出必须包含 maximum blob size / storage epoch / WAL coin type 信息；如果 CLI 不存在，不阻塞主流程，因为 web path 使用 `@mysten/walrus` SDK + upload relay。CLI 输出的 WAL coin type 必须用于 Phase -1.3 注资 + 余额校验。

**Step 3 — 大文件 live smoke 边界：**
- 默认主流程不跑 `> 50 MiB` live upload。
- `E2E_WALRUS_LIVE_LARGE_UPLOAD` 保持 unset；大文件 live smoke 属于独立 Walrus capability 验收，不改写本计划主流程业务结论。

---

## Phase 0: Pre-flight（3 tests）

### Test 0.1: Landing Page 加载
1. `navigate_page` → `http://localhost:3100`
2. `wait_for` text "Redefine"
3. `evaluate_script` 验证 `a[href="/market"]` 和 `a[href="/create"]` 存在

### Test 0.2: Market 空状态
1. `navigate_page` → `http://localhost:3100/market`
2. `wait_for` text "Soul Market"
3. `evaluate_script` 验证搜索框 `input[placeholder="Search souls..."]` 存在
4. `evaluate_script` 验证页面含 "No live Soul listings"
5. `evaluate_script` 验证 navbar 有 "Login" 按钮（dapp-kit ConnectModal 触发器）

### Test 0.3: 截图存档
`take_screenshot` → `$ARTIFACT_DIR/phase0-market-empty.png`

---

## Phase 1: Seller 登录 + 创建 Soul A & B（12 tests）

### Test 1.1: Seller 登录（W0 stub 钱包，0 popup 0 OTP）

> 前置：W0 已实现 `web/components/providers/e2e-wallet-stub.tsx` 并在 `app-providers.tsx` development 分支挂载。本测试必须走 stub，不允许退回真实浏览器扩展或手动 popup。

1. `navigate_page` → `http://localhost:3100/market`
2. `evaluate_script`:
   ```js
   localStorage.setItem('__E2E_PRIVATE_KEY', '<bech32 of $E2E_SELLER_PRIVATE_KEY，driver 注入>');
   location.reload();
   ```
3. `wait_for` 页面加载完成
4. `evaluate_script` 自检本轮角色私钥已写入 localStorage：
   ```js
   localStorage.getItem('__E2E_PRIVATE_KEY')?.startsWith('suiprivkey')
   ```
   返回 `true`
5. `take_snapshot` 找 navbar "Login" 按钮 uid → `click`
6. `wait_for` text "Connect a Sui Wallet"（dapp-kit ConnectModal）
7. `take_snapshot` 找 "E2E Test Wallet" 条目 uid → `click`。这是 stub 注册成功的黑盒验收；不要用 `navigator.wallets` 断言。
8. dapp-kit 调 stub 的 `standard:connect` → wallet-auth-bridge 自动调 `/api/auth/wallet-challenge` → stub 签 nonce → `/api/auth/wallet-login` 写 `session` + `csrf-token` cookies
9. `wait_for` AccountButton 出现（snapshot 中 `0x...` 缩略地址或头像按钮）
10. `evaluate_script` 验证 `document.cookie.includes('csrf-token=')` 为 `true`
11. `evaluate_script` 验证 `(await fetch('/api/auth/me').then(r => r.json())).user.primarySuiAddress === '$SELLER_ADDR'`
12. `take_screenshot` → `$ARTIFACT_DIR/phase1-seller-login.png`
13. **回填 SELLER_MEMBER_ID**：执行 Phase -1.2 Step 4 SQL，记录到运行时变量

### Test 1.2: 创建向导 Step 1 — Basic Info
1. `navigate_page` → `http://localhost:3100/create`
2. `wait_for` text "Step 1 — Basic Info"
3. `fill` Soul Name（`input[placeholder="e.g. AlphaScout, Kaze no Akira..."]`）: `E2E Soul Alpha NW`
4. `fill` Description（`textarea[placeholder*="Describe your Soul"]`）: `E2E test Soul A — alpha trading strategy content`
5. `fill` Tags 输入（`input[placeholder="e.g. ai, trading, signals"]`）: `e2e, test`
6. **Cover image 上传 — fixture file:**
   ```
   upload_file(selector: 'div[aria-label="Click to upload cover image"] input[type="file"]',
               filePath: '/Users/admin/Documents/example/images.jpeg')
   ```
7. `wait_for` text "images.jpeg"（确认文件已选择，provider 显示文件名）
8. `evaluate_script` 验证 5% royalty 按钮默认推荐选中（4 个按钮：0% / 2.5% / 5% / 10%）

### Test 1.3: 创建向导 Step 2 — Living Content
1. `click` "Next: Living Content →" 按钮（`button:has-text("Next: Living Content")`）
2. `wait_for` text "Step 2 - Living Content"
3. **打标签** — UploadTarget 渲染 3 个 `<input type="file" className="sr-only">`，无 aria-label，需先标记：
   ```javascript
   evaluate_script(`
     const inputs = document.querySelectorAll('input[type="file"].sr-only');
     if (inputs[0]) inputs[0].setAttribute('data-e2e', 'char-input');
     if (inputs[1]) inputs[1].setAttribute('data-e2e', 'memory-input');
     if (inputs[2]) inputs[2].setAttribute('data-e2e', 'skills-input');
     return inputs.length;
   `)
   ```
   验证返回 `3`。
4. **Soul Character 上传:**
   ```
   upload_file(selector: 'input[data-e2e="char-input"]',
               filePath: '/Users/admin/Documents/example/soul.md')
   ```
5. `wait_for` text "soul.md"（确认文件名出现）
6. **Memory 上传:**
   ```
   upload_file(selector: 'input[data-e2e="memory-input"]',
               filePath: '/Users/admin/Documents/example/memory.md')
   ```
7. `wait_for` text "memory.md"（确认文件名出现）
8. **Skills 上传:**
   ```
   upload_file(selector: 'input[data-e2e="skills-input"]',
               filePath: '/Users/admin/Documents/example/skills.zip')
   ```
9. `wait_for` text "skills.zip"（确认文件名出现）

### Test 1.4: 创建向导 Step 3 — Preview（2×2 Review Grid）
1. `click` "Next: Soul Awakened →" 按钮（`button:has-text("Next: Soul Awakened")`）
2. `wait_for` text "Step 3"
3. `evaluate_script` 验证 Basic Info card 显示 "E2E Soul Alpha NW"
4. `evaluate_script` 验证 royalty 显示 "5%"
5. `evaluate_script` 验证 Soul Character card 显示 "soul.md"
6. `evaluate_script` 验证 Memory card 显示 "memory.md"

### Test 1.5: 创建向导 Step 4 — Gas & Deploy
1. `click` "Next: Pay Gas →" 链接（`a[href="/create/gas"]`）
2. `wait_for` text "Step 4" 或 "Transaction Preview"
3. Gas 页守卫: `missingStep1` → redirect `/create`，`missingStep2` → redirect `/create/content`。必须从 wizard 顺序走到，保持 CreateSoulProvider context。

> **注意**: Gas 页 `handleDeploy()` 内部完成全流程：upload cover(public) → char(encrypted) → memory(encrypted) → skills(encrypted) → buildPublishSoulTx（Phase 2 签名：`vector<InitialContentEntry>` + `vector<StateConfigEntry>` + `creator_royalty_bps`）→ signAndExecute → POST `/api/souls/publish`（携带 `contentSidecars: ContentSidecarRequestEntry[]`）→ mirror 同步（`buildSyncSealSidecars` + `upsertContentVersionProjection` + `upsertPaidAccessKindConfig`）。e2e-wallet-stub 接管签名（内存 keypair，0 popup）。所有上传走 browser wallet-paid Walrus path：`uploadSoulPayload` 本地加密、报价、弹出 `UploadCostReview`，再由测试钱包签 Walrus register/certify TX。

### Test 1.6: Deploy Soul A — Sign & Deploy
1. `click` "✓ Sign & Deploy" 按钮（`button:has-text("Sign & Deploy")`）
2. `wait_for` `[data-testid="publish-status"]` 出现，跟踪状态变化: uploading → building → signing → syncing
3. 按"Wallet-paid Walrus 成本确认"循环处理 `UploadCostReview` 弹窗。**fresh run 预期：4 次确认**，依据如下：

   | 上传项 | 加密 | plaintext SHA-256（前 16 字符） | 实际 Walrus blob 内容 | 是否 dedupe |
   |---|---|---|---|---|
   | `images.jpeg`（cover） | 否（public） | `6bf46961d19d8ed0` | 文件本体 | 否（与其他文件 hash 不同） |
   | `soul.md`（char） | 是 | `aad35826f2f798f2` | AES-GCM 密文（每次随机 IV） | 否（密文 hash 每次都不同） |
   | `memory.md` | 是 | `aad35826f2f798f2` | AES-GCM 密文（每次随机 IV） | 否（同上；plaintext 与 soul.md 撞 hash 但密文仍不同） |
   | `skills.zip` | 是 | `9e6fd6fc45432333` | AES-GCM 密文（每次随机 IV） | 否 |

   注意：`soul.md` 与 `memory.md` 当前 fixture **plaintext 完全相同（均 1018 字节，`aad35826…` hash）**，但 AES-GCM 用每次随机的 DEK + IV，所以 Walrus blob ID 不会重合，dedupe 不生效。如果未来 Walrus relay 增加 plaintext-level dedupe 或 fixture 内容差异化，**预期次数会变**——按本表为基线，实际偏离时只能修源（fixture / dedupe 实现）后修订表格，禁止把"实际是 3 次"当作"4 次预期错了"绕过断言。每次确认后由 e2e-wallet-stub 签 Walrus register/certify TX。
4. e2e-wallet-stub 接管 Soul mint 签名（内存 keypair，0 popup）
5. `wait_for` URL 变为 `/create/success`（status=done 时自动 redirect），timeout 90s
6. `wait_for` text "Soul Born"（success 页标题）
7. 从 success 页提取 **SOUL_A_ID**（Soul Object ID 行）:
   ```javascript
   evaluate_script(`document.body.innerText.match(/0x[a-f0-9]{64}/)?.[0] ?? ''`)
   ```
8. 立即捕获 **SOUL_A_SEAL_MATERIAL_JSON**：
   ```javascript
   evaluate_script(`JSON.stringify(window.__e2eLastSealMaterial ?? null)`)
   ```
   验证 JSON 至少含 `char` 与 `memory`，后续 Test 5.3b 只把它作为预期 artifact / hash / 文件名证据，不作为解密密钥。
9. `take_screenshot` → `$ARTIFACT_DIR/phase1-soul-a-published.png`
10. **DB 验证 mint mirror 写入完整：**
   ```sql
   SELECT on_chain_id, content_on_chain_id, paid_access_list_on_chain_id,
          active_sprite_name, active_voice_name, sprite_config_json, voice_config_json
   FROM soul_assets WHERE on_chain_id = '$SOUL_A_ID';
   ```
   - `content_on_chain_id IS NOT NULL`（mint 自动创建 SoulContent typed-content 根对象），记录为 **SOUL_A_CONTENT_OBJ**
   - `paid_access_list_on_chain_id IS NOT NULL`（mint 自动创建 SoulPaidAccessList，与 SoulState 1:1 绑定），记录为 **SOUL_A_PAID_ACCESS_OBJ**
   - `active_sprite_name` / `active_voice_name` / `sprite_config_json` / `voice_config_json` 均为 NULL（fixture 未上传 sprite / voice，对应 InitialContentEntry vec 中没有 KIND_SPRITE / KIND_AUDIO entry）
11. **DB 捕获 founding memory + 初始 Skills 版本：**
   ```sql
   SELECT name AS memory_name, version_index
   FROM soul_content_version_records
   WHERE content_on_chain_id = '$SOUL_A_CONTENT_OBJ' AND kind = 1
   ORDER BY version_index DESC
   LIMIT 1;

   SELECT name AS skill_name, version_index
   FROM soul_content_version_records
   WHERE content_on_chain_id = '$SOUL_A_CONTENT_OBJ' AND kind = 2
   ORDER BY version_index DESC
   LIMIT 1;
   ```
   记录为 **SOUL_A_FOUNDING_MEMORY_NAME** / **SOUL_A_FOUNDING_MEMORY_VERSION_INDEX** 与 **SOUL_A_INITIAL_SKILL_NAME** / **SOUL_A_INITIAL_SKILL_VERSION_INDEX**。Test 5.3b 使用 memory 版本做 agent grant 解密逐字节比对；当前 HTTP 路由不再暴露 per-kind access endpoint。

### Test 1.7: 创建 Soul B — 完整 wizard 流程
重复 Tests 1.2-1.6 全流程，参数差异:
1. `navigate_page` → `http://localhost:3100/create`
2. Name: `E2E Soul Beta NW`，Description: `E2E test Soul B — held, not listed`
3. Cover: `upload_file` ← `/Users/admin/Documents/example/images.jpeg`
4. Content: 同 Test 1.3 — soul.md, memory.md, skills.zip 均来自 `/Documents/example/`
5. Preview → Gas → Sign & Deploy
6. Deploy 阶段同 Test 1.6 处理 `UploadCostReview`；fresh run 预期 4 次确认（与 Test 1.6 相同的 fixture，dedupe 后可能更少；以首次 dry-run 实测为准）
7. 从 success 页捕获 **SOUL_B_ID**
   同时捕获 **SOUL_B_SEAL_MATERIAL_JSON**（同 Test 1.6 step 8，只作后续排障证据）。
8. **DB 验证同 Test 1.6 step 10：**
   ```sql
   SELECT on_chain_id, content_on_chain_id, paid_access_list_on_chain_id
   FROM soul_assets WHERE on_chain_id = '$SOUL_B_ID';
   ```
   记录 `content_on_chain_id` 为 **SOUL_B_CONTENT_OBJ**，`paid_access_list_on_chain_id` 为 **SOUL_B_PAID_ACCESS_OBJ**

   同时捕获 Soul B 的 founding memory + 初始 skill 版本（paid-access / detail sanity 用）：
   ```sql
   SELECT name, version_index FROM soul_content_version_records
   WHERE content_on_chain_id = '$SOUL_B_CONTENT_OBJ' AND kind = 1
   ORDER BY version_index DESC LIMIT 1;
   -- 记录为 SOUL_B_FOUNDING_MEMORY_NAME / SOUL_B_FOUNDING_MEMORY_VERSION_INDEX
   SELECT name, version_index FROM soul_content_version_records
   WHERE content_on_chain_id = '$SOUL_B_CONTENT_OBJ' AND kind = 2
   ORDER BY version_index DESC LIMIT 1;
   -- 记录为 SOUL_B_INITIAL_SKILL_NAME / SOUL_B_INITIAL_SKILL_VERSION_INDEX
   ```

### Test 1.8: Soul A 详情页 — Held 状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `wait_for` text "E2E Soul Alpha NW"
3. `evaluate_script` 验证 hero badge 含 "Held"（mint 后默认 held）
4. `evaluate_script` 验证 owner CTA 为 "List Soul"（`a:has-text("List Soul")`）
5. `evaluate_script` 验证 Protocol State 卡片显示 Soul / State / Content object ID（Phase 2 不再显示 Memory / Metadata 单独 ID；SoulContent 是统一根），记录 **SOUL_A_STATE_OBJ** 与 **SOUL_A_CONTENT_OBJ**（与 Test 1.6 DB 捕获一致）
6. `evaluate_script` 验证 Access 卡片显示 "Grant capacity: 0 /"（默认容量 1，0 已用）
7. **链上验证 SoulState 关键字段：**
   ```bash
   sui client object $SOUL_A_STATE_OBJ --json | python3 -c "
   import json, sys
   f = json.load(sys.stdin)['data']['content']['fields']
   print('content_id:', f.get('content_id'))
   print('access_list_id:', f.get('access_list_id'))
   print('ownership_epoch:', f.get('ownership_epoch'))
   print('grant_capacity:', f.get('grant_capacity'))
   "
   ```
   - `content_id` 非空且等于 DB 的 `content_on_chain_id`
   - `access_list_id` 非空且等于 DB 的 `paid_access_list_on_chain_id`（即 `SoulPaidAccessList` 的 ID）
   - `ownership_epoch = 0`（初始 mint）
   - `grant_capacity = 1`
8. **以 UI 实际渲染为准**：取最新 `take_snapshot`，断言详情页存在 SOUL_DOC v0 / 初始 memory v0 / 初始 skill v0 三段内容卡片（Phase 2 详情页可能用 `ContentVersionList` 或类似组件统一渲染所有 kind 的版本，列表中应至少有 3 行）。如果 UI 已经不再单独渲染 MemoryPanel / SkillsPanel（Phase 2 hard-cut 后这两个组件文件都已删除），就不要断言旧组件名存在；只断言 UI 上能看到对应版本行 + 时间戳 + private/public tag。如果新版 UI 把"founding memory"标签改成其他文案（如 "v0 Founder"），按当前 `take_snapshot` 实际文本调整断言；不允许跑去 grep 旧组件源码反向确认。

### Test 1.9: Soul B 详情页 — Held 状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_B_ID}`
2. `wait_for` text "E2E Soul Beta NW"
3. `evaluate_script` 验证 hero badge 含 "Held"
4. `evaluate_script` 验证 CTA 为 "List Soul"

### Test 1.10: Market 空状态（两个 Soul 均 held，未上架）
1. `navigate_page` → `http://localhost:3100/market`
2. `evaluate_script` 验证 "No live Soul listings" 仍然出现（market 只显示 listed 状态）

### Test 1.11: My Souls — Seller Portfolio（5 tabs）
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `wait_for` text "My Souls"
3. `evaluate_script` 验证 5 个 tab 存在：Owned / Collections / Listings / Activity / Bookmarks
4. `evaluate_script` 验证 Owned tab 默认选中，显示 2 个 soul row
5. `click` "Collections" tab → 验证 "No collection rights yet"
6. `click` "Bookmarks" tab → 验证 "No bookmarks yet"

### Test 1.12: 截图存档
`take_screenshot` → `$ARTIFACT_DIR/phase1-seller-done.png`

---

## Phase 2: 上架 Soul A & B（8 tests）

> 本计划统一上架价为 **0.1 USDC**（atomic = 100000）以节省 mainnet 真币。Soul A / Soul B 同价；排序 / 筛选断言相应调整为不依赖价格差异。

### Test 2.1: List Soul A — Set Price 0.1 USDC
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}/sell`
2. `wait_for` text "List Soul"
3. `evaluate_script` 验证 Soul 名称 "E2E Soul Alpha NW" 显示
4. `fill` price input（`input[type="number"][placeholder="0.00"]`）: `0.1`
5. `evaluate_script` 验证 "Next: Authorize →" 链接已激活

### Test 2.2: List Soul A — Authorize & Sign
1. `click` "Next: Authorize →"（`a:has-text("Next: Authorize")`）
2. `wait_for` URL 含 `/sell/authorize`
3. `wait_for` text "Authorize listing"
4. `evaluate_script` 验证 Wallet Request 卡片显示: Soul name, Ask price "0.10 USDC", Creator royalty
5. `click` "✓ Sign & List" 按钮（`button:has-text("Sign & List")`）
6. e2e-wallet-stub 接管签名（内存 keypair，0 popup） `list_fixed_price` TX
7. `wait_for` URL 变为 `/sell/success`，timeout 60s

### Test 2.3: List Soul A — Success
1. `wait_for` text "Soul listed"
2. `evaluate_script` 验证: Soul name + "0.10 USDC" + "Live in kiosk market"
3. `take_screenshot` → `$ARTIFACT_DIR/phase2-soul-a-listed.png`

### Test 2.4: List Soul B — Set Price 0.1 USDC
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_B_ID}/sell`
2. `wait_for` text "List Soul"
3. `fill` price input: `0.1`

### Test 2.5: List Soul B — Authorize & Sign
1. `click` "Next: Authorize →"
2. `wait_for` URL 含 `/sell/authorize`
3. `click` "✓ Sign & List"
4. `wait_for` URL 变为 `/sell/success`，timeout 60s

### Test 2.6: Market 显示 2 个 Listed Soul
1. `navigate_page` → `http://localhost:3100/market`
2. `evaluate_script` 验证 "E2E Soul Alpha NW" 和 "E2E Soul Beta NW" 两个 card 均可见
3. `evaluate_script` 验证 "No live Soul listings" 不再出现
4. `take_screenshot` → `$ARTIFACT_DIR/phase2-market-listed.png`

### Test 2.7: Market 排序
1. 在 market 页，修改 Sort 下拉为 "Price: Low to High":
   ```javascript
   evaluate_script(`
     const select = document.querySelector('select');
     if (select) { select.value = 'price_asc'; select.dispatchEvent(new Event('change', { bubbles: true })); }
     return select?.value ?? '';
   `)
   ```
2. `wait_for` 列表刷新
3. `evaluate_script` 验证两个 Soul card 同时存在；两 Soul 同价（0.1 USDC），二级排序按 `created_at` 倒序，Soul B 应在 Soul A 上面（Soul B 创建在后）
4. 切回 "Newest" 恢复默认

### Test 2.8: Market 高级筛选 — Price Range
1. `click` "Filters" 按钮（`button:has-text("Filters")`）
2. `wait_for` 筛选面板出现（"Price Range" 文本可见）
3. `fill` Min Price（`input[placeholder="Min"]`）: `0.05`
4. `fill` Max Price（`input[placeholder="Max"]`）: `0.15`
5. `wait_for` 列表更新（debounce 300ms）
6. `evaluate_script` 验证两个 Soul（均 0.10 USDC）均在结果集中
7. `fill` Max Price: `0.05`（区间外）
8. `wait_for` 列表更新
9. `evaluate_script` 验证两个 Soul 均不在结果集中（被价格上限过滤）
10. `click` "Clear filters"（`button:has-text("Clear filters")`）
11. `evaluate_script` 验证两个 Soul 均恢复可见
12. `take_screenshot` → `$ARTIFACT_DIR/phase2-market-filters.png`

---

## Phase 3: Collection 创建 + Floor Guard（7 tests）

> Seller 仍登录，在同一 session 内完成 Collection 创建。

### Test 3.1: Collection Step 1 — Collection Info
1. `navigate_page` → `http://localhost:3100/collections/create`
2. `wait_for` text "Step 1"
3. `fill` Collection Name（`input` placeholder 含 "Cyber Sentinels"）: `E2E Collection Alpha`
4. `fill` Description（`textarea` placeholder 含 "What is this Collection about"）: `E2E test collection with one Soul`
5. **Cover image 上传:**
   ```
   upload_file(selector: 'div[aria-label="Upload cover image"] input[type="file"]',
               filePath: '/Users/admin/Documents/example/images.jpeg')
   ```
6. `wait_for` text "images.jpeg"
7. `fill` Floor Price（`input[type="number"]` placeholder 含 "e.g. 10"）: `0.1`
8. `evaluate_script` 验证 5% royalty 按钮默认选中（4 个按钮：0% / 2.5% / 5% / 10%）
9. `evaluate_script` 验证 "Soul Collection + Resale" toggle 默认 tradeable

### Test 3.2: Collection Step 2 — Batch Upload（directory 模拟）
1. `click` Next 按钮进入 Step 2
2. `wait_for` text "Step 2"
3. `click` "Batch Upload" 方法卡片

**Directory upload 模拟** — `upload_file` 无法模拟 `webkitdirectory` picker。使用 `evaluate_script` 构造 File 对象：

先用 bash 将 fixture 文件转 base64：
```bash
XLSX_B64=$(base64 -i /Users/admin/Documents/example-collection/soul-collection-template.xlsx)
SOUL_B64=$(base64 -i /Users/admin/Documents/example-collection/1/soul.md)
MEM_B64=$(base64 -i /Users/admin/Documents/example-collection/1/memory.md)
IMG_B64=$(base64 -i /Users/admin/Documents/example-collection/1/images.jpeg)
SKILL_B64=$(base64 -i /Users/admin/Documents/example-collection/1/skills.zip)
```

然后注入浏览器：
```javascript
evaluate_script(`
  (async () => {
    function b64toFile(b64, name, type, relPath) {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const f = new File([arr], name, { type });
      Object.defineProperty(f, 'webkitRelativePath', { value: relPath });
      return f;
    }
    const dt = new DataTransfer();
    dt.items.add(b64toFile('${XLSX_B64}', 'soul-collection-template.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'example-collection/soul-collection-template.xlsx'));
    dt.items.add(b64toFile('${SOUL_B64}', 'soul.md', 'text/markdown',
      'example-collection/1/soul.md'));
    dt.items.add(b64toFile('${MEM_B64}', 'memory.md', 'text/markdown',
      'example-collection/1/memory.md'));
    dt.items.add(b64toFile('${IMG_B64}', 'images.jpeg', 'image/jpeg',
      'example-collection/1/images.jpeg'));
    dt.items.add(b64toFile('${SKILL_B64}', 'skills.zip', 'application/zip',
      'example-collection/1/skills.zip'));

    const input = document.querySelector('input[type="file"][webkitdirectory]');
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return dt.files.length;
  })()
`)
```

4. `wait_for` 确认 modal 出现
5. `click` Confirm 按钮
6. `wait_for` text "1 Soul ready — all files matched"

### Test 3.3: Collection Step 3 — Preview & Launch
1. `click` Next 按钮进入 Preview（`button:has-text("Next")`）
2. `wait_for` text "Step 3" 或 "Preview"
3. `evaluate_script` 验证 collection name "E2E Collection Alpha", floor "5 USDC", royalty "5%"
4. `evaluate_script` 验证 1 个 Soul row 含 "Ready" tag
5. `click` "Sign & Launch →" 按钮（`button:has-text("Sign & Launch")`）
6. 按"Wallet-paid Walrus 成本确认"循环处理 `UploadCostReview`。当前 1-Soul fixture fresh run 预期 5 次确认（collection cover(public)、child char(encrypted)、child memory(encrypted)、child skills(encrypted)、child image(public)）；fixture 中 collection cover 和 child image 都是 `images.jpeg`，若 `UploadCostReview` 按 content hash dedupe 则实际次数为 4。执行前先用本地 fixture dry-run 验证次数后再断言。
7. e2e-wallet-stub 自动签名（多笔 TX: Walrus register/certify → create collection → mint soul → bind soul）
8. `wait_for` URL 含 `/collections/create/success`，timeout 120s（多笔 TX）

### Test 3.4: Collection Success
1. `wait_for` text "Collection Born"
2. `evaluate_script` 提取 **COLLECTION_ID**
3. `take_screenshot` → `$ARTIFACT_DIR/phase3-collection-created.png`

### Test 3.5: Collection 详情页
1. `navigate_page` → `http://localhost:3100/collections/${COLLECTION_ID}`
2. `evaluate_script` 验证 collection 显示 1 个 Soul, floor price, royalty
3. 打开 Collection action，选择 `List Collection`
4. 输入 list price `0.10` USDC（fill `0.1`），签名 `list_collection_right_fixed_price`
5. DB / API 捕获并记录 **COLLECTION_LISTING_OBJ**
   ```sql
   SELECT listing_object_on_chain_id
   FROM soul_collections
   WHERE on_chain_id = '$COLLECTION_ID';
   ```
6. 打开 Collection action，选择 `Delist Collection`，签名 `cancel_collection_listing`
7. 验证 DB `listing_object_on_chain_id IS NULL`，链上 `COLLECTION_LISTING_OBJ` 仍存在且 `is_active = false`（供 Test 11.0b 回收）

### Test 3.6: Collection 子 Soul 低于 Floor Price 时禁止继续上架
1. 在 collection 详情页刷新 snapshot，定位第一个子 Soul card（链接目标为 `/souls/{id}`）并点击进入
2. 记录该子 Soul 的 `onChainId`，然后 `navigate_page` → `http://localhost:3100/souls/${CHILD_SOUL_ID}/sell`
3. `wait_for` text "Step 1 — Set Your Price"
4. `fill` price input（定位提示：`input[type="number"][placeholder="0.00"]`）: `0.05`
5. `evaluate_script` 验证页面出现 floor 提示："Minimum price for this collection is 0.1"
6. `evaluate_script` 验证继续按钮不是 `"Next: Authorize →"` 链接，而是 disabled 按钮 `"Enter a valid price"`

### Test 3.7: Collection 子 Soul 上架（floor 价 0.1 USDC，触达 collection-bound 上架路径）

> Test 3.6 仅验证拒绝；本测试在 floor 价之上正常上架，让 Phase 4.5a 通过 `buy_soul_fixed_price_with_collection` 真实走 collection royalty stack。

1. 仍在 `${CHILD_SOUL_ID}/sell` 页（或重新导航）
2. `fill` price input：`0.1`（与 floor 价一致）
3. `click` "Next: Authorize →"
4. `wait_for` URL 含 `/sell/authorize`
5. `click` "✓ Sign & List"
6. e2e-wallet-stub 自动签名 `list_soul_fixed_price_with_collection` TX
7. `wait_for` URL 变为 `/sell/success`
8. **DB 验证子 Soul 已 listed + collection bound：**
   ```sql
   SELECT listing_status, listed_price_atomic, collection_on_chain_id
   FROM soul_assets WHERE on_chain_id = '$CHILD_SOUL_ID';
   ```
   - `listing_status = 'listed'`、`listed_price_atomic = 100000`、`collection_on_chain_id = $COLLECTION_ID`

---

## Phase 4: Buyer 登录 + 非合约社交 / 报价预检 + 购买（11 tests）

> 调用顺序：Buyer 登录后先执行不触发合约 TX 的 Test 4.3-4.3c 与 Test 10.6，再执行 Test 4.4 quote UI / Test 4.4a dev-inspect，最后进入 Test 4.5 / 4.5a 购买 TX。这样能在资产 owner 被购买改写前完成 Market、Bookmark、Follow 这些状态不变或可回滚的浏览器检查。

### Test 4.1: Seller 登出
1. `take_snapshot` 找 navbar AccountButton uid（`.rounded-full.border.border-border.bg-card2` 按钮）→ `click`
2. `wait_for` dropdown 出现（含 "Sign Out" 文字）
3. `take_snapshot` 找 "Sign Out" uid（`button:has-text("Sign Out")`，红色 `text-danger`）→ `click`
4. AuthProvider 自动 `POST /api/auth/logout` 带 `x-csrf-token` + disconnect dapp-kit wallet
5. `wait_for` "Login" 按钮重新出现
6. `evaluate_script` 验证 `document.cookie` 中 `session` 与 `csrf-token` 已清空（Max-Age=0）

### Test 4.2: Buyer 登录（stub 切角色）
1. `evaluate_script`:
   ```js
   localStorage.setItem('__E2E_PRIVATE_KEY', '<bech32 of $E2E_BUYER_PRIVATE_KEY>');
   location.reload();
   ```
2. 重复 Test 1.1 步骤 4–11（断言 `primarySuiAddress === '$BUYER_ADDR'`）
3. `take_screenshot` → `$ARTIFACT_DIR/phase4-buyer-login.png`

### Test 4.3: Market 显示 2 个 Listed Soul
1. `navigate_page` → `http://localhost:3100/market`
2. `evaluate_script` 验证 "E2E Soul Alpha NW" 和 "E2E Soul Beta NW" 两个 card 均可见

### Test 4.3a: Bookmark Soul B — 从 Market 页
1. 找到 Soul B card 上的 bookmark 按钮（`button[aria-label="Bookmark this Soul"]`）
2. `click` bookmark 按钮
3. `wait_for` 按钮变为 filled 状态（`aria-label` 变为 `"Remove bookmark"`）
4. `take_screenshot` → `$ARTIFACT_DIR/phase4-bookmark-on.png`

### Test 4.3b: My Souls Bookmarks Tab 验证
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `click` "Bookmarks" tab（`button:has-text("Bookmarks")`）
3. `evaluate_script` 验证 bookmark 列表包含 "E2E Soul Beta NW"

### Test 4.3c: Remove Bookmark
1. `navigate_page` → `http://localhost:3100/market`
2. 找到 Soul B card 上的 bookmark 按钮（`button[aria-label="Remove bookmark"]`）
3. `click` 取消 bookmark
4. `wait_for` 按钮变回 unfilled（`aria-label="Bookmark this Soul"`）
5. `navigate_page` → `http://localhost:3100/my-souls`
6. `click` "Bookmarks" tab → 验证 "No bookmarks yet" 空状态

### Test 4.4: Buy Page — 审核 Soul A 报价
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}/buy`
2. `wait_for` text "Confirm purchase"
3. `evaluate_script` 验证报价明细:
   - "List price" 行
   - "Protocol fee" 行
   - "Creator royalty" 行
   - "Collection royalty" 行（Soul A 不在 collection，预期为 0）
   - "Total" 行（gold 文字）
4. `evaluate_script` 验证 "Buy for ..." 金色按钮可点击

### Test 4.4a: Quote 链上对账（`quote_soul_purchase` dev-inspect 与 UI receipt 一致）

> 与 Test 7.10b 对 paid-access quote 的 dev-inspect 对账对称：避免 UI 报价（前端 mirror）与链上 quote 函数计算不一致导致下单后扣款不符。

```bash
sui client call \
  --package $PACKAGE_ID --module market --function quote_soul_purchase \
  --args $MARKET_CONFIG_ID 100000 500 0 \
  --gas-budget 10000000 --dev-inspect 2>&1 | tee "$ARTIFACT_DIR/test-4.4a-quote.log"
```

> 参数：`(price=100000, creator_royalty_bps=500, collection_royalty_bps=0)`。Soul A `creator_royalty_bps = 500` 来自 Phase 1.2 选 5%；non-collection 路径 `collection_royalty_bps = 0`。

验证（dev-inspect 输出 `returnValues`）：
- `platform_fee == 2500` (250 bps × 100000 / 10000)
- `price == 100000`
- `creator_royalty == 5000` (500 bps × 100000 / 10000)
- `collection_royalty == 0`
- `total == 107500`
- 与 Test 4.4 step 3 截图中 "Total" 行金额完全一致（atomic 单位）

### Test 4.5: 执行购买 Soul A
1. `click` "Buy for ..." 按钮（`button:has-text("Buy for")`）
2. `wait_for` 按钮文字变为 "⟳ Building TX…" / "⟳ Signing…" / "⟳ Syncing…"
3. e2e-wallet-stub 接管签名（内存 keypair，0 popup） `purchase()` TX
4. `wait_for` text "Soul acquired"（success 状态），timeout 60s
5. `evaluate_script` 验证 success 卡片: Soul name + 支付金额 + TX digest
6. `evaluate_script` 验证 "View in My Souls" 链接（`a[href="/my-souls"]`）
7. `take_screenshot` → `$ARTIFACT_DIR/phase4-soul-a-purchased.png`

### Test 4.5a: Buy Collection 子 Soul — 验证 collection royalty stack

> 通过 `buy_soul_fixed_price_with_collection` 路径验证 platform fee + creator royalty + collection extra royalty 三层抽成均到位。Soul A 的购买（4.5）走的是 no-collection 路径（`buy_soul_fixed_price`，extra_royalty_bps 硬写 0）；本测试覆盖另一条 entry function。

1. `navigate_page` → `http://localhost:3100/souls/${CHILD_SOUL_ID}/buy`
2. `wait_for` text "Confirm purchase"
3. `evaluate_script` 验证报价明细，包含**非零** "Collection royalty" 行（COLLECTION_ROYALTY_BPS = 500 = 5%）
4. `click` "Buy for ..." 按钮
5. e2e-wallet-stub 接管签名 `buy_soul_fixed_price_with_collection` TX
6. `wait_for` text "Soul acquired"，timeout 60s
7. **链上 + DB 验证三层抽成：**
   ```bash
   sui client tx-block <CHILD_SOUL_PURCHASE_DIGEST> --json | python3 -c "
   import json, sys
   evs = json.load(sys.stdin).get('events', [])
   for e in evs:
     if 'SoulPurchased' in e['type']:
       p = e['parsedJson']
       print('platform_fee:', p.get('platform_fee'))
       print('creator_royalty:', p.get('creator_royalty'))
       print('collection_royalty:', p.get('collection_royalty'))
   "
   ```
   - `platform_fee == 2500` (250 bps × 100000 / 10000 = 0.0025 USDC)
   - `creator_royalty == 5000` (5% creator royalty bps from Phase 3 mint)
   - `collection_royalty == 5000` (5% collection extra royalty bps from Phase 3.1)
   - `SoulPurchased` 事件不含 `seller_proceeds` 字段；seller 到账不要从事件字段读取。若需要余额级验证，按 `price + platform_fee + creator_royalty + collection_royalty = 112500` 的 buyer total 与链上 coin balance delta 单独核算。
8. **Buyer DB owned set：**
   ```sql
   SELECT count(*) FROM soul_assets
   WHERE current_owner_address = '$BUYER_ADDR';
   ```
   - 至少 2（Soul A + child Soul）

### Test 4.6: Buyer My Souls — Owned 2（含 collection 子 Soul）
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `evaluate_script` 验证 Owned tab 显示 2 个 soul row（Soul A + 子 Soul）
3. `click` "Collections" tab → 验证 "No collection rights yet"（Buyer 持有的是 Soul，不是 collection right）
4. `click` "Activity" tab → 验证至少 2 条 purchase activity

---

## Phase 5: Grant 系统（15 tests）

### Test 5.1: Buyer 查看 Soul A 详情（Owner 视角）
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `wait_for` text "E2E Soul Alpha NW"
3. `evaluate_script` 验证 hero badge 含 "Held"（购买后从 listed 变 held）
4. `evaluate_script` 验证 Active Grants: "No active SoulGrant is attached to this Soul."
5. `evaluate_script` 验证 owner CTA 为 "List Soul"（owner + held）

### Test 5.2: Issue SoulGrant to Agent Alpha — via GrantModal UI

1. `navigate_page` → `http://localhost:3100/my-souls`
2. `wait_for` "My Souls"
3. 在 Soul A 的 SoulCard 上点击 `"🔑 Grant Access"` 按钮（`button:has-text("Grant Access")`）
4. GrantModal 弹出 — `wait_for` text "SoulGrant Management"
5. `evaluate_script` 验证 scope 显示："Skills & Docs · read + update" 和 "Memory · read + append"
6. `evaluate_script` 验证 Current Grant 显示 "No agent authorized"
7. `fill` agent address input（`input[placeholder="0x_agent_address_or_ocl_id"]`）: `$AGENT_ALPHA_ADDR`（Phase -1.2 动态发现的完整地址）
8. `click` "Authorize Agent →"（`button:has-text("Authorize Agent")`）
9. e2e-wallet-stub 自动签名 `issue_grant` TX
10. `wait_for` modal 关闭（Toast "Agent authorized successfully" 出现）
11. 刷新 Soul A 详情页验证:
    - Active Grants 区域显示 1 条 grant
    - Grant row 含 Agent Alpha 地址前缀（`$AGENT_ALPHA_ADDR` 前 6 字符）
    - Grant scopes 含 `seal` / `memory` / `skills` / `assets` scope tags
    - DB mirror 中该 active grant 的 `scope_mask = 15`
12. `take_screenshot` → `$ARTIFACT_DIR/phase5-grant-issued.png`

### Test 5.2a: Set Grant Capacity to 2

> 默认 grant_capacity = 1，只允许 1 个 active grant。本测试调高到 2，验证 `grant::set_grant_capacity` 合约入口 + 前端 mirror。

1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `evaluate_script` 验证 "Grant capacity: 1 / 1"（Test 5.2 发放了 1 个 grant）
3. **DB 验证容量扩展前状态：**
   ```sql
   SELECT grant_capacity FROM soul_assets WHERE on_chain_id = '$SOUL_A_ID';
   ```
   验证 `grant_capacity = 1`
4. **Buyer owner 通过 dev-only E2E helper 调高容量：**
   ```js
   await window.__e2eSoulidity.setGrantCapacity({
     stateObjectId: '$SOUL_A_STATE_OBJ',
     capacity: 2,
   })
   ```
   验证 TX success，事件 `<pkg>::grant::GrantCapacityUpdated` 中 `old_capacity = 1`、`new_capacity = 2`
5. **链上 + DB 验证容量已更新：**

   > `__e2eSoulidity.setGrantCapacity` 内部已自动 POST `/api/souls/${stateObjectId}/grant-capacity` 完成 mirror（`e2e-wallet-helpers.tsx:148-156`），所以这里 DB 断言可以紧跟 step 4 之后无需额外 sync 调用。

   ```bash
   sui client object $SOUL_A_STATE_OBJ --json | jq '.data.content.fields.grant_capacity'
   ```
   ```sql
   SELECT grant_capacity FROM soul_assets WHERE on_chain_id = '$SOUL_A_ID';
   ```
   两处均为 `2`。

### Test 5.2b: 验证 SoulState 关键字段链上快照

> 从 `SoulState` 直接读 `grant_capacity` / `content_id` / `access_list_id`，与 Test 5.2a 的 helper TX 结果 + Test 1.6 的 mint 后 mirror 对齐。

**链上验证：**
```bash
sui client object $SOUL_A_STATE_OBJ --json 2>&1 | python3 -c "
import json, sys
data = json.load(sys.stdin)
fields = data.get('data',{}).get('content',{}).get('fields',{})
print(f'grant_capacity={fields.get(\"grant_capacity\",\"?\")}')
print(f'content_id={fields.get(\"content_id\",\"?\")}')
print(f'access_list_id={fields.get(\"access_list_id\",\"?\")}')
"
```
验证:
- `grant_capacity` 为 `2`（Test 5.2a 已通过 owner TX 调整）
- `content_id` 非空且等于 DB 的 `content_on_chain_id`（mint 时自动创建 SoulContent 并绑定）
- `access_list_id` 非空且等于 DB 的 `paid_access_list_on_chain_id`（mint 时自动创建 SoulPaidAccessList 并绑定）

### Test 5.2c: Issue 第二个 SoulGrant 给 Agent Beta（验证 capacity 2 真正承载多 grant）

> Test 5.2a 已把 grant_capacity 调到 2，但仅 Test 5.2 占用了 1 个 slot；本测试发出第二个 grant 真正使用 capacity 2，并验证不同 grantee 的 scope 隔离。Test 5.2e 将在 5.4 之前 revoke Beta，恢复"Beta 无 grant"前置以兼容 Test 5.4 的 403 断言。

1. `navigate_page` → `http://localhost:3100/my-souls`
2. 在 Soul A 的 SoulCard 上点击 `"🔐 Manage Grant"`（Test 5.2 之后已变成 manage）
3. GrantModal 弹出，选择 "Authorize another agent"（或类似入口；snapshot 中找未占用 slot 的输入框）
4. `fill` agent address input：`$AGENT_BETA_ADDR`
5. `evaluate_script` 把 scope 选择限制为 `Skills` only（如 UI 不支持 sub-scope，跳到 step 6）
6. `click` "Authorize Agent"
7. e2e-wallet-stub 自动签名 `issue_grant` TX
8. `wait_for` modal 提示 "Agent authorized"
9. **DB / 链上验证：**
   ```sql
   SELECT grantee_address, scope_mask, status
   FROM soul_grant_records
   WHERE soul_on_chain_id = '$SOUL_A_ID' AND status = 'active'
   ORDER BY created_at;
   ```
   - 2 行，`grantee_address` 分别为 `$AGENT_ALPHA_ADDR` / `$AGENT_BETA_ADDR`
   - `active_grants.length == 2` 在链上 SoulState
   ```bash
   sui client object $SOUL_A_STATE_OBJ --json | python3 -c "
   import json, sys
   d = json.load(sys.stdin)['data']['content']['fields']
   print('active_grant_count:', d.get('active_grant_count'))
   print('grant_capacity:', d.get('grant_capacity'))
   "
   ```
   - `active_grant_count = 2`、`grant_capacity = 2`

### Test 5.2d: 第三个 grant 必须被 capacity 拒绝

> 链上 `grant::issue` 在 capacity 已满时 abort `EGrantCapacityExceeded`（`grant.move:153`）。本测试用 Dev 地址作为"假第三 agent"尝试发 grant，预期签名后 abort。

1. 在 GrantModal 中尝试发第三个 grant：
   ```js
   await window.__e2eSoulidity.issueGrantRaw?.({
     stateObjectId: '$SOUL_A_STATE_OBJ',
     granteeAddress: '$DEV_ADDR',
     scopeMask: 4,
   }).catch((err) => ({ error: String(err) }))
   ```
   如果 `issueGrantRaw` helper 不存在（当前 helpers 中暂未导出），通过 GrantModal UI 手动操作即可：填写 Dev 地址 + 点击 Authorize → 钱包发 TX → 期望 dryRun 阶段 abort。
2. **验证 abort：**
   - TX dryRun / execute 失败，错误信息含 `EGrantCapacityExceeded` 或 abort code `8`（`grant.move:14`）
   - DB `soul_grant_records` 中**不**存在 grantee=`$DEV_ADDR` 的行
   - 链上 `active_grant_count` 仍为 `2`

> 如果 UI 在 capacity 满时直接禁用 "Authorize" 按钮（前端 guard），本测试转为"前端 guard 验证"：断言按钮 disabled + 提示文案含 "capacity reached" 或类似 — 不允许通过 stub 强制 dispatch click。

### Test 5.2e: Revoke Agent Beta（恢复 Test 5.4 前置）

1. GrantModal 切到 Beta 行，点击 `"Revoke"`
2. e2e-wallet-stub 签名 `revoke_grant` TX
3. `wait_for` Toast "Grant revoked"
4. **DB / 链上验证：**
   - `soul_grant_records` 中 Beta 行 `status = 'revoked'`
   - `active_grant_count` 在链上 = 1（仅 Alpha）
5. 注：5.6 仍然 revoke Alpha；5.2e 只 revoke Beta，Alpha 留待 5.6 主流程处理。

### Test 5.3: Agent Alpha → Soul A: 200（granted-agent via 当前 `web/` 应用）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证:
- HTTP 200
- `accessKind` = `"granted-agent"`
- `accessPolicy.functionName` = `"seal_approve_content_granted_agent"`（Phase 2：所有 access 入口走 content 模块）
- `accessPolicy.soulGrantObjectId` 非空（指向链上 SoulGrant 对象）

> Phase 2 不再有 `/api/agent/souls/[id]/memory/[name]/versions/[index]/access` HTTP 路由；Memory 的 Seal session 由 agent-side Node 脚本通过 SDK 直接构造（Test 5.3b 的 `e2e-agent-verify-content.ts` 走该路径）。本测试只断言 SOUL_DOC v0 access 200；完整解密与字节比对在 Test 5.3a-b 执行，并且必须在 Test 5.6 revoke 前完成。

### Test 5.3a: Agent Alpha Seal decrypt Soul A（granted-agent）
```bash
SOUL_ID=${SOUL_A_ID} \
AGENT_API_KEY="${E2E_AGENT_ALPHA_API_KEY}" \
AGENT_PRIVATE_KEY="${E2E_AGENT_ALPHA_PRIVATE_KEY}" \
BASE_URL=http://localhost:3100 \
npx tsx web/scripts/e2e-agent-decrypt.ts
```
验证:
- 解密成功（退出码 0）
- 解密由 agent 进程完成：`AGENT_API_KEY` 解析 Agent Alpha，`AGENT_PRIVATE_KEY` 签 Seal session
- `accessKind = "granted-agent"`，Seal policy 走 `seal_approve_content_granted_agent`
- 输出 SOUL_DOC content hash 匹配

### Test 5.3b: Agent Alpha 逐字节比对 soul.md + memory.md（granted-agent）

前置：Buyer 已在 Test 5.2 给 Soul A 授权 Agent Alpha，grant scope 含 `seal` + `memory`，且尚未执行 Test 5.6 revoke。Test 1.6 已捕获 `SOUL_A_SEAL_MATERIAL_JSON`，其中至少含 `char` 与 `memory`。

```bash
SOUL_ID=${SOUL_A_ID} \
AGENT_API_KEY="${E2E_AGENT_ALPHA_API_KEY}" \
AGENT_PRIVATE_KEY="${E2E_AGENT_ALPHA_PRIVATE_KEY}" \
PENDING_SEAL_MATERIALS_JSON="$(node -e 'const m=JSON.parse(process.env.SOUL_A_SEAL_MATERIAL_JSON); process.stdout.write(JSON.stringify({char:m.char,memory:m.memory}))')" \
COMPARE_MAP_JSON='{"char":"soul.md","memory":"memory.md"}' \
COMPARE_DIR="/Users/admin/Documents/example" \
npx tsx web/scripts/e2e-agent-verify-content.ts
```
验证:
- 退出码 0
- `char` 由 Agent Alpha 的 granted-agent Seal session 解密，明文与 `soul.md` 逐字节一致
- `memory` 由 Agent Alpha 的 granted-agent Seal session 解密 `KIND_MEMORY/name=memory/version=0` 的 Walrus blob，明文与 `memory.md` 逐字节一致
- 最终输出 `OK 2 artifact(s) matched byte-for-byte.`

### Test 5.4: Agent Beta → Soul A: 403（无 Grant）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_BETA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 HTTP 403

### Test 5.5: My Souls — Activity tab
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `click` "Activity" tab
3. `evaluate_script` 验证至少 1 条 grant record
4. `evaluate_script` 验证 grant row 含 "active" status tag + `seal` / `memory` / `skills` / `assets` scope tags

### Test 5.6: Revoke SoulGrant — via GrantModal UI
1. `navigate_page` → `http://localhost:3100/my-souls`
2. 在 Soul A 的 SoulCard 上点击 `"🔐 Manage Grant"` 按钮（`button:has-text("Manage Grant")`）
3. GrantModal 弹出
4. `wait_for` "Agent Authorized" 文本（active grant 状态指示器，绿色圆点）
5. `evaluate_script` 验证 grantee 地址前缀（`$AGENT_ALPHA_ADDR` 前 6 字符）显示
6. `click` "Revoke" 按钮（`button:has-text("Revoke")`，danger variant）
7. e2e-wallet-stub 自动签名
8. `wait_for` modal 关闭（Toast "Grant revoked"）
9. 刷新 Soul A 详情页 → 验证 "No active SoulGrant is attached to this Soul."
10. `take_screenshot`

### Test 5.7: Agent Alpha revoked → 403（Grant 已撤销）

> Agent access route 直读 DB mirror。Test 5.6 的 revoke TX 通过 `/api/souls/[id]/grant` mirror 路由 post-TX 同步写入（同步路径，不是 eventually-consistent indexer）；因此 5.6 → 5.7 之间无需 polling，首调即应 403。如出现首调 200 但复测 403，说明 grant mirror 同步性被破坏，按"测试纪律"流程定位 `web/lib/soulidity/mirror/upsert-grant.ts` 与 revoke 路由后修源，**禁止**用 polling 兜底。

```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 HTTP 403

### Test 5.8: Destroy Invalidated SoulGrant — 回收 storage rebate

> Test 5.6 revoke 了 Agent Alpha 的 grant，链上 `state.active_grants` 已移除该 slot，但 `SoulGrant` owned object 仍留在 Agent Alpha 的钱包里（epoch 不匹配 + 不在 active_grants）。`grant::destroy_invalidated_grant` 无额外业务身份校验，但 Sui 会在 Move 执行前校验 owned object 输入归属；因此本步骤必须用 Agent Alpha（或当前持有该 grant object 的地址）签名。
> 本测试验证：合约接受销毁请求，事件 `SoulGrantDestroyed` 触发，对象消失。

1. **通过 Sui CLI 读 Test 5.2 创建的 SoulGrant object id**（可从 Test 5.2 stub 钱包 TX digest 的 `objectChanges` 提取；或查询 Agent Alpha 持有的 `soulidity::grant::SoulGrant` 对象列表）：
   ```bash
   AGENT_ALPHA_ADDR=<记录的 agent 地址>
   sui client objects --address $AGENT_ALPHA_ADDR --json 2>&1 | jq -r '
     .[] | select(.data.type | test("::grant::SoulGrant$"; "i")) | .data.objectId
   ' | head -1
   ```
   记录为 **GRANT_OBJ**。

2. **通过 Sui CLI 调用 destroy_invalidated_grant**（必须切到拥有 `GRANT_OBJ` 的地址；本流程中为 Agent Alpha。不要用 treasury/seller/buyer 这类不拥有该 owned object 的 signer，否则会在 Sui object ownership 校验阶段失败，无法进入 Move 函数）：
   ```bash
   sui client switch --address $AGENT_ALPHA_ADDR
   sui client call \
     --package $PACKAGE_ID \
     --module grant \
     --function destroy_invalidated_grant \
     --args $GRANT_OBJ $SOUL_A_STATE_OBJ 0x6 \
     --gas-budget 50000000
   ```

3. 验证:
   - TX `effects.status` = success
   - `events` 含 `<pkg>::grant::SoulGrantDestroyed`，字段 `grant_id == GRANT_OBJ`
   - 再查 `sui client object $GRANT_OBJ` → 返回 `Object has been deleted`
   - 负向确认：用不拥有 `GRANT_OBJ` 的 signer 调用应在 Sui owned object 输入校验阶段失败；这不是 `EGrantStillActive`，而是交易输入所有权不满足

4. **DB 验证（mirror 层无状态变化）：**
   ```sql
   SELECT status FROM "soul_grant_records"
   WHERE soul_on_chain_id = '$SOUL_A_ID' AND grantee_address = '$AGENT_ALPHA_ADDR'
   ORDER BY created_at DESC LIMIT 1;
   ```
   - 验证 `status` 保持 Test 5.6 revoke 后的状态（`revoked`）；destroy 不触发新 mirror 更新（合约未 emit 状态变更事件，只 emit destroy 事件）

5. **负向证据引用：Active grant 不可 destroy**（Phase W1.5 已前置执行，避免 RPC dry-run 构造 owned-object 输入的不稳定性）：

   ```bash
   grep -E "destroy_invalidated_grant_aborts_when_grant_still_active|\\[ PASS +\\]|Test result: OK" \
     "$ARTIFACT_DIR/w1.5-destroy_invalidated_grant_aborts_when_grant_still_active.log"
   ```
   验证输出含 `destroy_invalidated_grant_aborts_when_grant_still_active`、`[ PASS    ]` 与 `Test result: OK. Total tests: 1; passed: 1; failed: 0`。Abort code 由 `protocol_tests.move` 中该 test 的 `#[expected_failure(abort_code = soulidity::grant::EGrantStillActive)]` 注解固定；当前 Sui CLI 的 test 输出不会打印 `MoveAbort` 明细。该 test 由 Phase W1.5 一次性补齐并前置执行，不允许在 mainnet 测试中途重新 grep test 名、新增 Move test 或首次执行本地 Move test。

---

## Phase 6: Content Panels 展示验收（1 test）

> **Phase 6 范围调整说明（Phase 2 mainnet）**：当前 `web/app/souls/[id]/page.tsx` 内联 `SkillsPanel` / `MemoryPanel` / `ContentPanel` 只展示 `SoulContentVersionRecord`，并用 `MigrationNote` 明确写入面板尚未接线；Memory row 的按钮文案也是 `Decrypt unavailable`。因此 Phase 6 主验收固定为 UI 展示验收，不保留 append / decrypt 点击用例；解密与字节正确性统一由 Test 5.3b 的 agent-side Node 脚本覆盖。

### Test 6.1: Soul A 详情页内容版本初始状态（UI 渲染）
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `take_snapshot` 确认页面含 `Skills` tab、`Memory` tab，并渲染初始 skill / memory version 行或对应空态
3. `evaluate_script` 验证页面不存在可点击的 Skills append/upload 控件；若出现 enabled append/upload 控件，必须新增主流程测试覆盖真实 wallet-paid upload，不得继续沿旧计划执行
4. `evaluate_script` 验证 Memory row 仅显示 `Decrypt unavailable` 或 disabled owner/grant-only 控件；若出现 enabled decrypt 控件，必须新增主流程测试覆盖真实 Seal 解密，不得继续沿旧计划执行

> **Memory 验收口径**：Memory append TX 当前没有 web UI 用户入口；Memory blob 的 Seal 读解密与原始文件逐字节一致性由 Test 5.3b `e2e-agent-verify-content.ts` 覆盖。

---

> **Phase 6.5 已删除（4 项）**：原 Phase 6.5 验证的 4 个 HTTP endpoint（`/api/souls/[id]/assets`、`/api/agent/souls/[id]/assets/.../versions/.../access`、human / agent 不存在版本 404）在 Phase 2 mainnet 下不存在 — 这些路由已从 `web/app/api/` 删除。本计划按"前端 UI 为准"硬约束整段移除，不绕过、不模拟。sprite / asset UI + 对应 HTTP 路由属于未发布产品面，不列入本计划主验收尾项。


## Phase 7: Agent API 购买路径验证（5 tests: 7.1-7.5）

> 全部走 `web/` 应用 Agent API（port 3100），Agent 认证走 `Authorization: Bearer sk-*` API key。

### Test 7.1: Agent Soul Search
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  "http://localhost:3100/api/agent/souls/search?q=E2E&limit=10"
```
验证:
- HTTP 200
- `items` 数组含 Soul B（listed 状态）
- 每个 item 含 `onChainId`, `name`, `listedPriceAtomic`, `listingStatus`

### Test 7.2: Agent Soul Detail
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}
```
验证 HTTP 200 + response 含 Soul B 完整信息（name, description, listingStatus=listed, listedPriceAtomic）

### Test 7.3: Agent Alpha 购买 Soul B（两步签名）
**Step 1 — 准备 TX：**
```bash
curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/purchase
```
验证 HTTP 200 + 捕获 `preparedPurchaseId` 和 `txBytes`（base64）

**Step 2 — 签名执行：**
使用 Agent Alpha 的 Ed25519 keypair（通过 `AGENT_PRIVATE_KEY` 注入）对 `txBytes` 签名:
```bash
cd /Users/admin/Desktop/nao/clawnews && \
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY="${E2E_AGENT_ALPHA_API_KEY}" \
AGENT_PRIVATE_KEY="${E2E_AGENT_ALPHA_PRIVATE_KEY}" \
BASE_URL=http://localhost:3100 \
npx tsx web/scripts/e2e-agent-purchase.ts
```
验证退出码 0 + 输出含 TX digest + `listingStatus: "held"`

### Test 7.4: Agent Alpha → Soul B: 200（owner）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
```
验证:
- HTTP 200
- `accessKind` = `"owner"`
- `accessPolicy.functionName` = `"seal_approve_owner"`

### Test 7.5: 交叉验证矩阵（全走当前 `web/` 应用）
4 个 curl 均走 `localhost:3100`:

| Agent | Soul A | Soul B |
|-------|--------|--------|
| Alpha | 403 (grant revoked in Phase 5) | 200 (owner) |
| Beta  | 403 (无 grant) | 403 (非 owner) |

```bash
# Alpha → Soul A
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
# → 403

# Alpha → Soul B
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
# → 200

# Beta → Soul A
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_BETA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
# → 403

# Beta → Soul B
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_BETA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_B_ID}/access
# → 403
```

## Phase 7.5: Paid Access API（SoulPaidAccessList）+ Registry 全链上验证（12 tests）

> **执行原则（Phase 2 mainnet）：** 所有写路径通过 `@soulidity/sdk` 的 paid-access tx builder（`buildConfigurePaidAccessKindTx` / `buildPurchasePaidAccessTx` / `buildAddPaidAccessTx` / `buildRevokePaidAccessTx`）签名后由 `web/lib/soulidity/mirror/upsert-paid-access.ts` post-TX mirror。`/api/souls/[id]/access-list/*` HTTP 路由全部不存在；Phase 1 的 `__e2eSoulidity.purchaseContentAccess` / `setContentAccessPrice` / `setContentAccessDuration` 三个 helper 在 Phase 2 已硬抛 `Phase 1 helper is gone`。本计划改用 Phase W1.3 的 Node 脚本 `web/scripts/e2e-paid-access-lifecycle.ts`；该脚本缺失时，本 Phase 是执行前代码阻塞，不能启动 mainnet 花费。
>
> 前提：Agent Alpha owns Soul B（Test 7.3），Buyer owns Soul A（Phase 4）。两个 Soul 均有 `paidAccessListOnChainId`（Phase 1.6/1.7 捕获）。
>
> **`web/scripts/e2e-paid-access-lifecycle.ts` 契约（Phase W1.3 必须先落地）：**
> - `set-config`：以 owner 私钥签 `buildConfigurePaidAccessKindTx({ paidAccessListObjectId, stateObjectId, kindRegistryObjectId, kind, priceAtomic, scopeMask, durationMs })`
> - `update-config`：以 owner 私钥签 `buildUpdatePaidAccessKindTx`
> - `delete-config`：以 owner 私钥签 `buildDeletePaidAccessKindTx`
> - `purchase`：以 buyer 私钥签 `buildPurchasePaidAccessTx`（含 USDC coin selection + market platform fee 路由）
> - `add-access`：以 owner 私钥签 `buildAddPaidAccessTx`（免费授权）
> - `revoke`：以 owner 私钥签 `buildRevokePaidAccessTx`
> - `inspect-access`：dev-inspect `paid_access::has_access(list, addr, kind)` 返回 bool
> - 所有命令打印 TX digest + 事件名 + 关键 `KindPaidConfig` / `KindPaidEntry` 字段；失败按"测试纪律"流程 abort

### Test 7.6: Paid Access 初始空状态
```bash
curl -s -w "\n%{http_code}" \
  -H "Cookie: <Buyer cookies>" \
  -H "x-csrf-token: <token>" \
  http://localhost:3100/api/souls/${SOUL_A_ID}
```
验证:
- HTTP 200
- 返回 JSON 含 `paidAccessKindConfigs: []` + `paidAccessEntries: []`（mint 时未配置任何 kind 的付费访问）

对 Soul B 做同样的 `curl`，同样 `paidAccessKindConfigs / paidAccessEntries` 为空。

### Test 7.10a: Paid Access Purchase — 付款路由 + 平台抽成 + epoch mirror

> 验证链上 `market::purchase_paid_access` 付款流 + mirror 写入：付款发给 `soul::current_owner(state)`（非固定 creator）、平台抽成进 `MarketConfig`、`SoulPaidAccessEntry.ownershipEpochSnapshot` 与 `SoulState.ownership_epoch` 一致。
> Soul B 由 Seller 创建，Phase 7.3 卖给 Agent Alpha。Buyer 再作为非 owner 购买 Soul B 的 paid access。当前 builtin 只有 `KIND_SPRITE = 3` / `KIND_AUDIO = 4` 支持 `READ_PAID`；本计划统一用 `KIND_SPRITE = 3` + `SCOPE_ASSETS = 8` 验证付款路由和 mirror，不把它表述成 SOUL_DOC 内容读取验收。付款必须发给 Agent Alpha（当前 owner），非 Seller（creator）。

1. **确认 Soul B 当前 owner 为 Agent Alpha：**
   ```sql
   SELECT current_owner_address, creator_address, paid_access_list_on_chain_id, state_on_chain_id
   FROM soul_assets WHERE on_chain_id = '$SOUL_B_ID';
   ```
   验证: `current_owner_address = $AGENT_ALPHA_ADDR`，`creator_address = $SELLER_ADDR`（两者不同），记录 `SOUL_B_STATE_OBJ` / `SOUL_B_PAID_ACCESS_OBJ`

2. **Agent Alpha owner 配置 KIND_SPRITE paid-access kind config + 短 duration（供 7.10f 继续测生命周期）：**
   ```bash
   OWNER_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY" \
   PAID_ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   KIND_REGISTRY_ID="$KIND_REGISTRY_OBJ" \
   KIND=3 \
   PRICE_ATOMIC=100000 \
   SCOPE_MASK=8 \
   DURATION_MS=5000 \
   npx tsx web/scripts/e2e-paid-access-lifecycle.ts set-config
   ```
   验证:
   - TX success
   - 事件 `<pkg>::paid_access::SoulPaidAccessKindConfigured`（字段名以新 mainnet event schema 为准；执行前 `grep -nE "SoulPaidAccessKind|PaidAccessKindConfig" sources/paid_access.move` 确认精确名）
   - 链上 `KindPaidConfig.price_atomic = 100000`，`scope_mask = 8`，`duration_ms.vec = [2000]`
   - DB `soul_paid_access_kind_configs` 写入对应行（kind=3、price_atomic=100000、scope_mask=8、duration_ms=2000）

3. **Buyer（非 owner）通过 Node 脚本购买 Soul B 的 KIND_SPRITE paid access：**
   - Buyer 已在 Phase -1.3 注资到 ≥ 5 USDC
   - 执行：
     ```bash
     BUYER_PRIVATE_KEY="$E2E_BUYER_PRIVATE_KEY" \
     SOUL_OBJECT_ID="$SOUL_B_ID" \
     PAID_ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
     STATE_ID="$SOUL_B_STATE_OBJ" \
     KIND_REGISTRY_ID="$KIND_REGISTRY_OBJ" \
     MARKET_CONFIG_ID="$MARKET_CONFIG_ID" \
     KIND=3 \
     PRICE_ATOMIC=100000 \
     PLATFORM_FEE_BPS=250 \
     npx tsx web/scripts/e2e-paid-access-lifecycle.ts purchase
     ```
   - 记录 `PAID_ACCESS_PURCHASE_DIGEST_1`

4. **验证付款路由 + mirror：**
   - TX events 含 `<pkg>::market::SoulPaidAccessPurchased`（字段名以 mainnet `market.move` 为准）
   - `buyer == $BUYER_ADDR`
   - `payment_recipient == $AGENT_ALPHA_ADDR`
   - `price == 100000`，`platform_fee == 2500`（250 bps × 100000 / 10000 = 2500 atomic = 0.0025 USDC）
   - `SoulPaidAccessGranted.expires_at_ms` 非空
   ```sql
   SELECT buyer_address, kind, scope_mask, price_paid_atomic, expires_at_ms, revoked_at,
          ownership_epoch_snapshot
   FROM soul_paid_access_entries
   WHERE paid_access_list_on_chain_id = '$SOUL_B_PAID_ACCESS_OBJ'
     AND buyer_address = '$BUYER_ADDR'
    AND kind = 3;
   ```
   验证 `scope_mask = 8`、`price_paid_atomic = 100000`、`expires_at_ms IS NOT NULL`、`revoked_at IS NULL`、`ownership_epoch_snapshot` 等于 `SoulState.ownership_epoch`（Test 7.3 已把 Soul B 卖给 Agent Alpha，epoch 应为 1；若后续再次转售则为当时 epoch）

### Test 7.10b: Paid Access Purchase 报价含平台抽成 + manifest 一致性

> 验证 `market::quote_paid_access_purchase(config, price)`（精确函数名以 mainnet `market.move` 实测填入；执行前 `grep -nE "quote_paid_access" sources/market.move`）返回 `(platform_fee, price, total)`，以及 deployment-manifest 与运行环境一致。

**运行环境 + manifest 一致性（single source of truth）：**
```bash
cd /Users/admin/Desktop/nao/clawnews && npx tsx -e "
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
for (const k of [
  'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID',
  'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE',
]) console.log(k + '=' + getRequiredSoulidityEnv(k))
"
```
必须与 Context 表格 mainnet 段完全一致（packageId 前缀 `0x6680f74…`，kindRegistryId `0x27f249c5…`）。任何不匹配按"测试纪律"流程 abort。

**链上 `quote_paid_access_purchase` dev-inspect：**
```bash
sui client call \
  --package $PACKAGE_ID --module market --function quote_paid_access_purchase \
  --args $MARKET_CONFIG_ID 100000 \
  --gas-budget 10000000 --dev-inspect 2>&1 | grep -E "returnValues|platform_fee"
```
期望返回 `(platform_fee = 2500, price = 100000, total = 102500)`（250 bps 平台费）。

### Test 7.10c: KioskRegistry + KindRegistry 共享对象存在 + 与 manifest 一致

```bash
sui client object $KIOSK_REGISTRY_OBJ --json 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)['data']
print('objectId:', d['objectId'])
print('owner:', d['owner'])
print('objType:', d['type'])
"
sui client object $KIND_REGISTRY_OBJ --json 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)['data']
print('objectId:', d['objectId'])
print('owner:', d['owner'])
print('objType:', d['type'])
"
```
验证:
- `KIOSK_REGISTRY_OBJ.objectId == $KIOSK_REGISTRY_OBJ`（与 mainnet manifest `kioskRegistryId` 一致）
- `KIOSK_REGISTRY_OBJ.objType` 含 `market::KioskRegistry`，`owner` 为 `Shared`
- `KIND_REGISTRY_OBJ.objectId == $KIND_REGISTRY_OBJ`（与 mainnet manifest `kindRegistryId` 一致）
- `KIND_REGISTRY_OBJ.objType` 含 `kind_registry::KindRegistry`，`owner` 为 `Shared`

### Test 7.10d: paid_access purchase 拒绝 price=0

> 未配置 kind 不等于 `price_atomic = 0`：当前 `market::purchase_paid_access` 会先因未配置 abort `EPaidAccessKindMismatch`。本测试覆盖真正的 0 价路径：先配置一个支持 paid read 的 kind（`KIND_SPRITE = 3`）且 `price_atomic = 0`、`scope_mask = 8`，再 purchase，预期 abort `market::EPaidAccessNotPurchasable`。
>
> **执行路径固化为 Move test**：Phase W1.5 已在 `protocol_tests.move` 中添加 `purchase_paid_access_aborts_when_price_zero`，并在 mainnet 写链前执行；本步骤只引用前置日志。

```bash
grep -E "purchase_paid_access_aborts_when_price_zero|\\[ PASS +\\]|Test result: OK" \
  "$ARTIFACT_DIR/w1.5-purchase_paid_access_aborts_when_price_zero.log"
```
验证:
- 输出含 `purchase_paid_access_aborts_when_price_zero`、`[ PASS    ]` 与 `Test result: OK. Total tests: 1; passed: 1; failed: 0`
- Abort code 由 `protocol_tests.move` 中该 test 的 `#[expected_failure(abort_code = soulidity::market::EPaidAccessNotPurchasable)]` 注解固定

### Test 7.10e: paid_access kind config 拒绝 scope 与 kind descriptor 不匹配

> 合约层 paid-access scope 不是任意非零子集：`paid_access::configure_paid_access_kind` 先要求目标 kind 支持 `READ_PAID`，再要求 `scope_mask == KindDescriptor.default_grant_scope_mask`。当前正向 paid kind `KIND_SPRITE = 3` 的 descriptor scope 是 `SCOPE_ASSETS = 8`；传 `SCOPE_SKILLS = 4` 或 `15` 都应 abort `paid_access::EKindScopeMismatch`。`EEmptyScopeMask` / `EGrantInvalidScopeMask` 仍属于 Grant 通用校验，不是本 paid-access 正向路径的负向错误码。
>
> **执行路径固化为 Move test**：E2E 正向路径已在 Test 7.10a 用 `KIND_SPRITE = 3` / `SCOPE_MASK = 8` 覆盖；负向断言通过 `protocol_tests.move` 现有的 `configure_paid_access_kind_rejects_scope_mismatch`（line ~2904 `#[expected_failure(abort_code = soulidity::paid_access::EKindScopeMismatch)]`）覆盖，并在 Phase W1.5 前置执行。

```bash
grep -E "configure_paid_access_kind_rejects_scope_mismatch|\\[ PASS +\\]|Test result: OK" \
  "$ARTIFACT_DIR/w1.5-configure_paid_access_kind_rejects_scope_mismatch.log"
```
验证:
- 输出含 `configure_paid_access_kind_rejects_scope_mismatch`、`[ PASS    ]` 与 `Test result: OK. Total tests: 1; passed: 1; failed: 0`
- Abort code 由 `protocol_tests.move` 中该 test 的 `#[expected_failure(abort_code = soulidity::paid_access::EKindScopeMismatch)]` 注解固定

> 注：该断言的 fixed name 是 `configure_paid_access_kind_rejects_scope_mismatch`。如 Phase -1 前发现该名字不存在，说明 Phase W1.5 基线未完成，必须先修 Move test / plan 基线并重新验证；mainnet 执行中途不得 grep 其它名字临时代入，也不得首次执行本地 Move test。

### Test 7.10f: KindPaidConfig duration 生命周期

> 复用 Test 7.10a 的 Soul B：Agent Alpha owner 已对 `KIND_SPRITE = 3` 配置 `duration_ms = 2000`，Buyer 已完成首次购买。

1. **链上核对初始 KindPaidConfig 字段：**
   ```bash
   sui client object $SOUL_B_PAID_ACCESS_OBJ --json 2>&1 | python3 -c "
   import json, sys
   # KindPaidConfig 嵌套在 paid_access_list 内的 Table；这里只验证 list 自身存在
   d = json.load(sys.stdin)['data']
   print('owner:', d['owner'])
   print('objType:', d['type'])
   "
   ```
   - `owner` 为 `Shared`，`objType` 含 `paid_access::SoulPaidAccessList`
   - 详细字段通过 `paid_access.move` accessor 读：`paid_access::kind_config_price_atomic(list, kind=3)` / `kind_config_duration_ms(list, kind=3)` 应返回 `(100000, Option::Some(5000))`

   ```bash
   ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
   KIND=3 \
   npx tsx web/scripts/e2e-paid-access-lifecycle.ts inspect-config
   ```
   - 输出 `priceAtomic: 100000`、`durationMs: 5000`、`scopeMask: 8`

2. **DB 验证首次购买写入 expiresAtMs：**
   ```sql
   SELECT buyer_address, kind, scope_mask, price_paid_atomic, expires_at_ms
   FROM soul_paid_access_entries
   WHERE paid_access_list_on_chain_id = '$SOUL_B_PAID_ACCESS_OBJ'
     AND buyer_address = '$BUYER_ADDR'
    AND kind = 3;
   ```
   - `expires_at_ms` 非 null
   - `expires_at_ms` 落在 Test 7.10a 购买 TX 前后时间窗口 + 5000ms 内（允许 RPC / mirror 等待带来的秒级漂移）

3. **`has_access` 链上查询：未过期时为 true：**
   ```bash
   ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
   KIND=3 \
   GRANTEE_ADDRESS="$BUYER_ADDR" \
   npx tsx web/scripts/e2e-paid-access-lifecycle.ts inspect-access
   ```
   - 输出 `hasAccess: true`

4. **等待过期后 polling 直到 `hasAccess` 翻 false（合约 `expires_at_ms` 合规等待，非 sleep+retry 兜底）：**

   合约语义是"过期后立即返回 false"，但 `inspect-access` 通过 `devInspectTransactionBlock` 读取最新 checkpoint 的 `Clock`，mainnet 公共 RPC 节点的 checkpoint 索引 + clock 节点漂移会带来秒级抖动。本步骤明确把"等到过期生效"作为正常时序断言，不属于"测试纪律"段第 2 条禁止的"sleep+重试硬撑"——退出条件是"`hasAccess=false` 出现"，超时即业务失败。

   ```bash
   # purchase TX 后等到 expires_at_ms + 余量后开始 polling
   sleep 6
   for attempt in 1 2 3 4 5 6 7 8; do
     OUT=$(ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
       KIND=3 \
       GRANTEE_ADDRESS="$BUYER_ADDR" \
       npx tsx web/scripts/e2e-paid-access-lifecycle.ts inspect-access 2>&1)
     echo "[attempt $attempt] $OUT"
     echo "$OUT" | grep -q 'hasAccess: false' && break
     sleep 1
   done
   echo "$OUT" | grep -q 'hasAccess: false' || { echo 'timed out waiting for expiry'; exit 1; }
   ```
   验证：8 次 polling（约 14 秒上限）内出现 `hasAccess: false`；超时退出非 0，按"测试纪律"流程定位（mainnet RPC 异常 / Clock 节点漂移 > 5s / `expires_at_ms` mirror 与链上不一致），不允许扩大 polling 窗口掩盖。

5. **Agent Alpha owner 把 duration 改成 2 小时（update-config）：**
   ```bash
   OWNER_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY" \
   PAID_ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   KIND_REGISTRY_ID="$KIND_REGISTRY_OBJ" \
   KIND=3 \
   PRICE_ATOMIC=100000 \
   SCOPE_MASK=8 \
   DURATION_MS=7200000 \
   npx tsx web/scripts/e2e-paid-access-lifecycle.ts update-config
   ```
   - TX digest + 对应 `*KindUpdated` 事件 emit
   - 链上 `kind_config_duration_ms(list, 3)` 返回 `Option::Some(7200000)`
   - 既有 Buyer entry 不变（"不追溯"语义）

6. **Buyer 续购 → 新 entry 使用 2 小时 duration：**
   ```bash
   BUYER_PRIVATE_KEY="$E2E_BUYER_PRIVATE_KEY" \
   SOUL_OBJECT_ID="$SOUL_B_ID" \
   PAID_ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   KIND_REGISTRY_ID="$KIND_REGISTRY_OBJ" \
   MARKET_CONFIG_ID="$MARKET_CONFIG_ID" \
   KIND=3 \
   PRICE_ATOMIC=100000 \
   PLATFORM_FEE_BPS=250 \
   npx tsx web/scripts/e2e-paid-access-lifecycle.ts purchase
   ```
   - 记录 `PAID_ACCESS_PURCHASE_DIGEST_2`
   - `SoulPaidAccessGranted.expires_at_ms` 更新
   - DB 新 `expires_at_ms` 落在续购 TX 前后时间窗口 + 7200000ms 内

### Test 7.10g: Paid access 跨所有权转让自动失效 + re-purchase 覆盖

> 验证 `KindPaidEntry.ownership_epoch_snapshot` 语义：前 owner 下的已付 buyer 在 Soul 转售后 `has_access` 立即翻 false，且 stale entry 可被 re-purchase 覆盖。
> 前置：Test 7.10a / 7.10f 已让 Buyer 在 Agent Alpha 名下拥有 Soul B 的有效 paid access。

1. **Agent Alpha 本地签名把 Soul B 重新上架**（owner 转售模拟，运维路径；通过独立脚本调用 SDK `buildListSoulTx`，不要 inline `npx tsx -e` PTB —— mainnet `list_soul_fixed_price` ABI 不再接 `soul_id` 参数，且返回的 `SoulListing` 必须由 `finalize_soul_listing` 串接才能共享）：
   ```sql
   SELECT current_owner_address, current_kiosk_id, current_kiosk_cap_on_chain_id, state_on_chain_id
   FROM soul_assets WHERE on_chain_id = '$SOUL_B_ID';
   ```
   验证 `current_owner_address = $AGENT_ALPHA_ADDR`，记录 `SOUL_B_AGENT_KIOSK_ID` / `SOUL_B_AGENT_KIOSK_CAP_ID`。
   ```bash
   cd /Users/admin/Desktop/nao/clawnews && \
   OWNER_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY" \
   PACKAGE_ID="$PACKAGE_ID" \
   MARKET_CONFIG_ID="$MARKET_CONFIG_ID" \
   KIOSK_REGISTRY_OBJ="$KIOSK_REGISTRY_OBJ" \
   SOUL_STATE_OBJECT_ID="$SOUL_B_STATE_OBJ" \
   SOUL_KIOSK_ID="$SOUL_B_AGENT_KIOSK_ID" \
   SOUL_KIOSK_CAP_ID="$SOUL_B_AGENT_KIOSK_CAP_ID" \
   PRICE_ATOMIC=100000 \
   SUI_NETWORK=mainnet \
   npx tsx web/scripts/e2e-relist-soul.ts
   ```
   `web/scripts/e2e-relist-soul.ts` 包装 `buildListSoulTx`（`packages/soulidity-sdk/src/tx/list.ts:12-68`，含 `ensure_personal_kiosk_registered → list_soul_fixed_price → finalize_soul_listing` 三段），`SuiJsonRpcClient` + `loadKeypairFromEnv('OWNER_PRIVATE_KEY')` 本地签 + 执行 + 等待。
   - 退出码 0
   - 输出含 `TX digest:`、`SoulListed event:` 与 `Status: ...success...`
   - DB / repository sync 后 `SOUL_B_ID.listingStatus = listed`
   - 列出价格用 `0.1 USDC`（与 Phase 2 价格基线一致）；后续测试参考相同价格

2. **Seller 购买 Soul B**（角色置换：原 Buyer 已是 Soul A owner，再让 Seller 用 0.1 USDC 买回 Soul B 充当新 owner，避免 Buyer 持有过多 Soul 干扰其他断言；如果 Seller mainnet USDC 不足则按"测试纪律"流程从 master 钱包补给）：

   Chrome DevTools 切到 Seller 登录会话（按 Test 4.2 模板：`evaluate_script` 改 `localStorage['__E2E_PRIVATE_KEY'] = bech32($E2E_SELLER_PRIVATE_KEY)` + reload + 重走 stub Login），打开 `/souls/${SOUL_B_ID}/buy`，按 Test 4.4-4.5 购买：
   - 记录 `SOUL_B_RESALE_DIGEST`
   - TX event `SoulPurchased`：`buyer == $SELLER_ADDR`，`seller == $AGENT_ALPHA_ADDR`

3. **验证 SoulState epoch 递增：**
   ```bash
   sui client object $SOUL_B_STATE_OBJ --json 2>&1 | python3 -c "
   import json, sys
   d = json.load(sys.stdin)['data']['content']['fields']
   print('ownership_epoch:', d['ownership_epoch'])
   print('current_owner:', d['current_owner'])
   "
   ```
   - `ownership_epoch` 相较 Test 7.10a 时点 +1
   - `current_owner == $SELLER_ADDR`

4. **`has_access` 链上查询 Buyer（原 subscriber）立即失效：**
   ```bash
   ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
   KIND=3 \
   GRANTEE_ADDRESS="$BUYER_ADDR" \
   npx tsx web/scripts/e2e-paid-access-lifecycle.ts inspect-access
   ```
   - 输出 `hasAccess: false`（尽管 entry 未过期，epoch 失配直接拒绝）

5. **验证 DB stale 条目仍保留：**
   ```sql
   SELECT buyer_address, kind, ownership_epoch_snapshot, revoked_at
   FROM soul_paid_access_entries
   WHERE paid_access_list_on_chain_id = '$SOUL_B_PAID_ACCESS_OBJ'
     AND buyer_address = '$BUYER_ADDR'
     AND kind = 3;
   ```
   - 记录存在，`revoked_at IS NULL`，但 `ownership_epoch_snapshot` 仍为转售前值（审计行保留）
   - **以前端 UI 为准**：Phase 2 没有"per-skill HTTP endpoint 返回 403"的路由（已删），本步骤只校验链上 + DB 快照，不再调用 `/skills/.../access` 这类已废弃路径

6. **Buyer 在新 owner 下 re-purchase 覆盖 stale entry：**
   ```bash
   BUYER_PRIVATE_KEY="$E2E_BUYER_PRIVATE_KEY" \
   SOUL_OBJECT_ID="$SOUL_B_ID" \
   PAID_ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   KIND_REGISTRY_ID="$KIND_REGISTRY_OBJ" \
   MARKET_CONFIG_ID="$MARKET_CONFIG_ID" \
   KIND=3 \
   PRICE_ATOMIC=100000 \
   PLATFORM_FEE_BPS=250 \
   npx tsx web/scripts/e2e-paid-access-lifecycle.ts purchase
   ```
   - TX 成功，**不** abort `EAlreadyHasAccess`（合约把 stale-epoch 条目视为可覆盖；新 owner 现在是 Seller，付款发给 Seller）
   - 事件 `SoulPaidAccessGranted.ownership_epoch_snapshot` 等于新 epoch
   - DB 上同一行被覆盖：`ownership_epoch_snapshot` 刷新到新值，`price_paid_atomic` 更新
   - 再次 `inspect-access` 输出 `hasAccess: true`

### Test 7.10h: KioskRegistry insert-or-assert + rebind 全矩阵

> 验证 registry 语义：同 cap 重注册幂等；不同 cap 再注册 abort；`rebind_primary_kiosk` 在旧 kiosk 非空时 abort、在空时成功。
> 全部由 dev 账户独立完成（不借 Seller / Buyer 真人钱包），`PersonalKioskCap` 是 `key`-only soul-bound，只能转给调用者自身。

1. **首次注册（baseline）：** dev 账户 `sui client call … init_personal_kiosk` →
   - 记录 `DEV_KIOSK_A_ID` + `DEV_KIOSK_A_CAP_ID`
   - 事件含 `PersonalKioskRegistrationUpdated`

2. **幂等分支：再次调 `ensure_personal_kiosk_registered` 传同一把 cap → no-op：**
   ```bash
   sui client call --package $PACKAGE_ID --module market \
     --function ensure_personal_kiosk_registered \
     --args $MARKET_CONFIG_ID $KIOSK_REGISTRY_OBJ $DEV_KIOSK_A_CAP_ID \
     --gas-budget 20000000 2>&1 | grep -E "Status|event"
   ```
   - TX success，**不**新增 `PersonalKioskRegistrationUpdated` 事件（insert-or-assert 的匹配分支）

3. **不同 cap 再注册 → abort `EPersonalKioskMismatch`：** dev 账户先构造第二把 cap：
   ```bash
   sui client ptb \
     --move-call 0x2::kiosk::new \
     --assign kiosk_and_cap \
     --move-call $KIOSK_PKG::personal_kiosk::new kiosk_and_cap.0 kiosk_and_cap.1 \
     --assign pk_cap \
     --move-call 0x2::transfer::public_share_object "<0x2::kiosk::Kiosk>" kiosk_and_cap.0 \
     --move-call $KIOSK_PKG::personal_kiosk::transfer_to_sender pk_cap \
     --gas-budget 50000000
   ```
   记录 `DEV_KIOSK_B_CAP_ID`，然后：
   ```bash
  sui client call --package $PACKAGE_ID --module market \
    --function ensure_personal_kiosk_registered \
     --args $MARKET_CONFIG_ID $KIOSK_REGISTRY_OBJ $DEV_KIOSK_B_CAP_ID \
     --gas-budget 20000000 --dry-run 2>&1 | grep -E "abort"
   ```
   - 预期 abort：`MoveAbort(... market ..., EPersonalKioskMismatch)`

4. **`rebind_primary_kiosk` 旧 kiosk 非空时 abort `EOldKioskNotEmpty`：** 先让 DEV_KIOSK_A 装一件任意物（例如把一个测试用 Soul / CollectionRight lock 进去；最简方便做法是用 dev 账户跑一次 `mint_native_in_personal_kiosk`，把 Soul lock 到 DEV_KIOSK_A）。然后：
   ```bash
   DEV_KIOSK_B_ID=$(sui client object $DEV_KIOSK_B_CAP_ID --json 2>&1 | python3 -c "
   import json, sys
   d = json.load(sys.stdin)['data']['content']['fields']['cap']['fields']
   print(d['for'])
   ")
   sui client call --package $PACKAGE_ID --module market \
     --function rebind_primary_kiosk \
     --args $MARKET_CONFIG_ID $KIOSK_REGISTRY_OBJ $DEV_KIOSK_A_ID $DEV_KIOSK_B_CAP_ID \
     --gas-budget 20000000 --dry-run 2>&1 | grep -E "abort"
   ```
   - 预期 abort：`MoveAbort(... market ..., EOldKioskNotEmpty = 31)`

5. **正向：旧 kiosk 为空时 rebind 成功。** 用一个全新的 dev 账户（或把 DEV_KIOSK_A 里的 Soul 先 sell/delist 清空，更简单的是换账户做一次空流程）重复 step 1 得到空 kiosk `DEV_KIOSK_C_ID` + cap，然后新建第四把 cap `DEV_KIOSK_D_CAP_ID`（同 step 3 手法），再：
   ```bash
   sui client call --package $PACKAGE_ID --module market \
     --function rebind_primary_kiosk \
     --args $MARKET_CONFIG_ID $KIOSK_REGISTRY_OBJ $DEV_KIOSK_C_ID $DEV_KIOSK_D_CAP_ID \
     --gas-budget 20000000 2>&1 | grep -E "Status|event"
   ```
   - TX success
   - 事件含 `PersonalKioskRebound { owner, old_kiosk_id, old_kiosk_cap_id, new_kiosk_id, new_kiosk_cap_id }`
   - 再次 `sui client object $KIOSK_REGISTRY_OBJ --json` 确认 dev 账户对应的 `PersonalKioskRegistration.kiosk_id` 已从 C 改为 D，`kiosk_cap_id` 改为 DEV_KIOSK_D_CAP_ID

> **说明：** 本 test 聚焦合约语义保障（幂等、防 mismatch 覆盖、空 kiosk 才能 rebind），保证 Seller / Buyer 的 Soul 不因重复注册被孤儿化。rebind 操作只面向运维 / 测试脚本（通过 `buildRebindPrimaryKioskTx` SDK 或本步骤的 `sui client call`），**不暴露给终端用户**；`window.__e2eSoulidity` 不提供此 helper 是正确设计。

### Test 7.10i: paid_access::add_access 免费授权（owner-only）

> Owner 通过 `paid_access::add_access(buyer, kind, scope_mask, expires_at_ms)` 直接发放免费访问，跳过 USDC 付款路径但仍校验 scope_mask = kind descriptor.default_grant_scope_mask。Test 7.10g 之后 Soul B 的当前 owner 是 Seller（再转售一次后的 owner，非 Agent Alpha）；本测试用 Seller owner 给 Dev 地址发 KIND_SPRITE 免费访问。

```bash
OWNER_PRIVATE_KEY="$E2E_SELLER_PRIVATE_KEY" \
PAID_ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
STATE_ID="$SOUL_B_STATE_OBJ" \
KIND_REGISTRY_ID="$KIND_REGISTRY_OBJ" \
GRANTEE_ADDRESS="$DEV_ADDR" \
KIND=3 \
SCOPE_MASK=8 \
DURATION_MS= \
npx tsx web/scripts/e2e-paid-access-lifecycle.ts add-access
```

验证:
- TX success，事件 `<pkg>::paid_access::SoulPaidAccessGranted` emit，字段 `buyer == $DEV_ADDR`、`price_paid_atomic == 0`
- DB `soul_paid_access_entries` 写入 `buyer_address = $DEV_ADDR`、`kind = 3`、`price_paid_atomic = 0`、`scope_mask = 8`
- `inspect-access` 输出 `hasAccess: true`：
  ```bash
  ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
  KIND=3 \
  GRANTEE_ADDRESS="$DEV_ADDR" \
  npx tsx web/scripts/e2e-paid-access-lifecycle.ts inspect-access
  ```
- 负向用 Buyer 钱包尝试 add-access 给 Dev → TX abort `ENotOwner`（owner 校验前置）；本步通过失败 TX digest 留证，不写 DB。

### Test 7.10j: Owner 不能购买自己 Soul 的 paid access（dev-inspect 验证）

> `market::purchase_paid_access` 第 1155 行 `assert!(ctx.sender() != soul::current_owner(state), EPaidAccessOwnerCannotPurchase)`。本测试用 dry-run 验证语义，不发真实 TX、不烧 USDC。

```bash
sui client switch --address $SELLER_ADDR
sui client call \
  --package $PACKAGE_ID \
  --module market \
  --function purchase_paid_access \
  --args $MARKET_CONFIG_ID $SOUL_B_PAID_ACCESS_OBJ $SOUL_B_STATE_OBJ \
         3 \
         $DUMMY_USDC_COIN_ID \
         0x6 \
  --gas-budget 20000000 --dry-run 2>&1 | tee "$ARTIFACT_DIR/test-7.10j-dryrun.log"
```

> `$DUMMY_USDC_COIN_ID` 用 Seller 持有的任意 USDC coin object id（≥ 102500 atomic 即可，dry-run 不会真实扣款）。如果 Seller 没有可用 USDC coin，从 master 钱包补 1 USDC 即可。

验证:
- dry-run 输出含 `MoveAbort` + `EPaidAccessOwnerCannotPurchase` 或 abort code `35`（`market.move:54`）
- 不实际发 TX，不留任何 paid_access entry
- 该负向断言由现有 `protocol_tests.move::owner_cannot_purchase_paid_access`（`#[expected_failure(abort_code = soulidity::market::EPaidAccessOwnerCannotPurchase)]`）固化；Phase W1.5 已前置执行，mainnet dry-run 仅作为运行时再次校验
  ```bash
  grep -E "owner_cannot_purchase_paid_access|\\[ PASS +\\]|Test result: OK" \
    "$ARTIFACT_DIR/w1.5-owner_cannot_purchase_paid_access.log"
  ```

### Test 7.10k: paid_access::revoke_access 主动召回（owner 视角）

> `paid_access::revoke_access(buyer, kind)` 由 owner 调，无链上退款；7.10i 之后 Dev 在 Soul B 拥有 KIND_SPRITE 免费访问，本测试 Seller 主动 revoke 验证 lifecycle。

```bash
OWNER_PRIVATE_KEY="$E2E_SELLER_PRIVATE_KEY" \
PAID_ACCESS_LIST_ID="$SOUL_B_PAID_ACCESS_OBJ" \
STATE_ID="$SOUL_B_STATE_OBJ" \
KIND_REGISTRY_ID="$KIND_REGISTRY_OBJ" \
GRANTEE_ADDRESS="$DEV_ADDR" \
KIND=3 \
npx tsx web/scripts/e2e-paid-access-lifecycle.ts revoke
```

验证:
- TX success，事件 `<pkg>::paid_access::SoulPaidAccessRevoked` emit
- DB `soul_paid_access_entries` 中 Dev / KIND=3 行 `revoked_at IS NOT NULL`
- `inspect-access` 输出 `hasAccess: false`
- 负向：Buyer 钱包尝试 revoke → abort `ENotOwner`

---

## Phase 8: Import 流程（6 tests）

> Buyer 仍登录，使用 `/Documents/example/` fixture 文件测试 Import 功能。
> Import wizard 共 6 步：Choose Source → Upload File → Map Fields → Soul Awakened → Pay Gas → On-chain。

### Test 8.1: Import Step 1 — Choose Source（`/import`）
1. `navigate_page` → `http://localhost:3100/import`
2. `wait_for` text "Choose Source"
3. `evaluate_script` 验证 "Local File" source 选项存在且 enabled
4. `click` "Local File" 选项卡
5. `click` "Next: Upload File →" 按钮
6. `wait_for` URL 含 `/import/upload`

### Test 8.2: Import Step 2 — Upload File（`/import/upload`）
1. `wait_for` text "Upload File"
2. **上传 source file：**
   ```
   upload_file(selector: upload zone file input,
               filePath: '/Users/admin/Documents/example/soul.md')
   ```
3. `wait_for` 文件解析完成（显示文件名 + 格式 badge + field count）
4. `click` "Continue" 按钮
5. `wait_for` URL 含 `/import/map`

### Test 8.3: Import Step 3 — Map Fields（`/import/map`）
1. `wait_for` text "Map Fields"
2. `evaluate_script` 验证 field mapping 表格已渲染（detected fields → Soul fields 下拉）
3. 若 name/description 未自动映射，手动 `fill` Soul Name: `E2E Imported Soul`, Description: `Imported from local file`
4. **上传 Soul Character 文件** — UploadZone:
   ```
   upload_file(selector: soul character upload zone input,
               filePath: '/Users/admin/Documents/example/soul.md')
   ```
5. **上传 Memory 文件** — UploadZone:
   ```
   upload_file(selector: memory upload zone input,
               filePath: '/Users/admin/Documents/example/memory.md')
   ```
6. **上传 Cover Image** — UploadZone:
   ```
   upload_file(selector: cover image upload zone input,
               filePath: '/Users/admin/Documents/example/images.jpeg')
   ```
7. 上传 Skills Bundle: `/Users/admin/Documents/example/skills.zip`
8. `click` "Continue" 按钮
9. `wait_for` URL 含 `/import/preview`

### Test 8.4: Import Step 4 — Soul Awakened / Preview（`/import/preview`）
1. `wait_for` text "Soul Awakened"
2. `evaluate_script` 验证 import provenance badge 显示（Import Source 卡片）
3. `evaluate_script` 验证 Soul name "E2E Imported Soul" 显示
4. `evaluate_script` 验证 Basic Info / Import Source / Living Content / Royalty 四个 review 卡片均渲染
5. `click` proceed 按钮进入 gas 页
6. `wait_for` URL 含 `/import/gas`

### Test 8.5: Import Step 5 — Pay Gas & Deploy（`/import/gas`）
1. `wait_for` text "Pay Gas"
2. `evaluate_script` 验证 `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT` 未设置或为 `server`；`browser` 只允许作为应急回滚单独记录，不计入本次主验收。
3. 在 Chrome DevTools MCP 里开启 network capture，后续重点记录：
   - `/api/walrus/batch/complete`
   - Sui RPC `executeTransactionBlock`
   - 任何 Walrus storage-node 直连写入请求（出现即失败）
4. `click` "Sign & Deploy" 按钮（`button:has-text("Sign & Deploy")`）
5. 按"Wallet-paid Walrus 成本确认"处理 **1 次 batch `UploadCostReview`**。当前 fixture fresh run 包含 4 个 logical files：cover(public)、char(encrypted)、memory(encrypted)、skills(encrypted)；batch quote 必须覆盖全部文件。确认前不得出现 Walrus register、`/api/walrus/batch/complete`、certify 或 import mint 签名。
6. e2e-wallet-stub 自动签第 1 笔 PTB：Walrus batch register。签名成功后必须持久化 register recovery，且不得重新 register。
7. 浏览器必须调用 `POST /api/walrus/batch/complete`，request body 至少包含 `network`、`registerTxDigest`、`walletAddress`、每个文件的 `blobId`、`blobObjectId`、encoded metadata/slivers。响应必须返回同顺序 certificate 列表。若接口失败，页面可重试完成写入，但不得重新触发成本确认或重新 register。
8. network capture 断言：浏览器端不得直接请求 Walrus storage-node 写入接口；storage-node 写入只能发生在后端 `/api/walrus/batch/complete` 内。允许的浏览器侧外部请求仅限 Sui RPC、Walrus WASM/CDN、read/quote 必需资源，以及应用 API。
9. e2e-wallet-stub 自动签第 2 笔 PTB：import mint + Walrus certify calls。最终 mint/certify 交易结构仍由前端用后端返回的 certificates 组装，不允许后端代签、mint 或 sponsor register。
10. `wait_for` URL 含 `/import/success`，timeout 90s

### Test 8.6: Import Step 6 — On-chain Success（`/import/success`）
1. `wait_for` success 页面内容
2. `evaluate_script` 提取 imported Soul on-chain ID，记录为 `$IMPORTED_SOUL_ID`
3. `take_screenshot` → `$ARTIFACT_DIR/phase8-import-done.png`

---

## Phase 9: API 边界 & Hardening（6 tests）

> 全部走当前 `web/` 应用（port 3100）。

### Test 9.1: Invalid API key → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer sk-invalid-000000" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 9.2: No auth header → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 9.3: Non-sk token → 401
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer eyJhbGciOiJFZERTQSJ9.fake.jwt" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证 Agent API 只接受 `sk-` 前缀 token

### Test 9.4: Soul not found → 404
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/0x0000000000000000000000000000000000000000000000000000000000000000/access
```

### Test 9.5: No permission → 403
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_BETA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```

### Test 9.6: Public Soul 详情 API → 404（不存在的 Soul）
```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3100/api/souls/0x0000000000000000000000000000000000000000000000000000000000000000
```

### Removed 9.7 / 9.8 / 9.9 / 9.10（Phase 2 路由 / 脚本不存在）

> Phase 1 的 Test 9.7（Agent Asset Access 404）/ 9.8（Asset version 400）/ 9.9（Content Access Purchase 401）依赖 `/api/agent/souls/.../assets/.../versions/.../access` 与 `/api/souls/.../access-list/purchase` 两个已删除路由；Test 9.10（匿名 public sprite）依赖已删除的 `web/scripts/e2e-sprite-lifecycle.ts`。按"前端 UI 为准"硬约束 + Phase 2 hard-cut，本计划整段移除 4 项，**禁止**绕过用 mock 路由 / SDK 直调白盒模拟。sprite / asset 公共下载 UI + 对应 HTTP 路由属于未发布产品面，不列入本计划主验收尾项。

Phase 9 测试数：10 → 6（保留 9.1-9.6）。

---

## Phase 10: 页面渲染冒烟（6 tests）

> 调用顺序：Test 10.1-10.5 只验证页面渲染 / 空状态 / 静态资源说明，不依赖 mainnet 合约写入，必须在 Phase 1 mint 之前完成。Test 10.6 需要 `SELLER_MEMBER_ID` 和 Buyer session，放在 Test 4.2 之后、购买 TX 之前执行；文档保留 Phase 10 编号以保持 96 项主流程计数稳定。

### Test 10.1: Community Page
1. `navigate_page` → `http://localhost:3100/community`
2. `wait_for` text "Soul Feed"
3. `evaluate_script` 验证 filter tabs 至少包含 "New" 和 "Top"
4. `evaluate_script` 验证侧栏标题为 "Top Contributors"
5. `evaluate_script` 验证主列要么渲染 `article` 列表，要么显示 "No posts yet. Be the first to publish!"

### Test 10.2: Resources — Content Format + Getting Started
1. `navigate_page` → `http://localhost:3100/resources/content-format`
2. `wait_for` text "soul.md" 或 "Content Format"
3. `evaluate_script` 验证页面含 soul.md / memory.md / skills.zip 格式说明
4. `navigate_page` → `http://localhost:3100/resources/getting-started`
5. `wait_for` 页面加载完成（无 error overlay）

### Test 10.3: Wrap + Link Page
1. `navigate_page` → `http://localhost:3100/wrap-link`
2. `wait_for` text "Expand to Soul"
3. `evaluate_script` 验证页面存在 "Personal Join" 入口 card，且无 `Collection Expand` 断言

### Test 10.4: Community Leaderboard
1. `navigate_page` → `http://localhost:3100/community/leaderboard`
2. `wait_for` text "Most Active" 或 "Most Helpful"
3. `evaluate_script` 验证 leaderboard 列表或空状态渲染

### Test 10.5: Resources Stats
1. `navigate_page` → `http://localhost:3100/resources/stats`
2. `wait_for` 页面加载完成（无 error overlay）
3. `evaluate_script` 验证页面含统计数据或空状态

### Test 10.6: Follow/Unfollow — Community Profile
1. `navigate_page` → `http://localhost:3100/community/u/${SELLER_MEMBER_ID}`
2. `wait_for` profile 加载（用户名可见）
3. `click` "Follow" 按钮（`button:has-text("Follow")`）
4. `wait_for` 按钮文案变为 "Following"
5. `evaluate_script` 验证 "Followers" 文本旁计数 ≥ 1
6. `click` "Following" 按钮 → unfollow
7. `wait_for` 按钮文案变回 "Follow"
8. `take_screenshot` → `$ARTIFACT_DIR/phase10-follow-toggle.png`

---

## Phase 11: Cleanup（4 tests）

### Test 11.0a: Delete Inactive Soul Listing — 回收 storage rebate

> Phase 4 Buyer 购买 Soul A → `listing.is_active = false` 但对象仍留在 shared pool。
> `market::delete_soul_listing(listing, ctx)` 需要 `!is_active`，析构 + 删 UID。任何签名者均可调用（storage rebate 归调用者），前端可以把这一步拼在购买 PTB 后；本测试独立验证。

1. **读 Soul A 的 listing object id**（Phase 2 records 或链上 query）：

   优先从 DB mirror 读取（不依赖 Sui CLI events 子命令的具体语法）：
   ```sql
   SELECT listing_object_on_chain_id
   FROM soul_assets WHERE on_chain_id = '$SOUL_A_ID';
   ```
   如果 DB 已清空或未 mirror，再退回链上 query —— Sui CLI 1.69+ `events` 子命令的查询参数因版本会有差异，先确认本机 `sui client events --help` 的实际可用参数（`--query` / `--type` / `--module` / `--event-type` 不同 build 表现不一致），再用对应语法。一种通用 fallback 是用 SDK 直接 `suix_queryEvents` JSON-RPC：
   ```bash
   curl -s -X POST $SUI_RPC_URL -H "Content-Type: application/json" -d "$(cat <<JSON
   {"jsonrpc":"2.0","id":1,"method":"suix_queryEvents",
    "params":[{"MoveEventType":"$PACKAGE_ID::market::SoulPurchased"},null,50,true]}
   JSON
   )" | jq -r '.result.data[] | select(.parsedJson.soul_id == "'$SOUL_A_ID'") | .parsedJson.listing_id' | head -1
   ```
   记录为 **SOUL_A_LISTING_OBJ**。
   `$SUI_RPC_URL` 取 `https://fullnode.mainnet.sui.io:443` 或 `.env.e2e` 中显式配置的 mainnet RPC。

2. **调用 delete_soul_listing**：
   ```bash
   sui client call \
     --package $PACKAGE_ID \
     --module market \
     --function delete_soul_listing \
     --args $SOUL_A_LISTING_OBJ \
     --gas-budget 50000000
   ```
3. 验证:
   - TX success
   - 事件 `<pkg>::market::SoulListingDeleted` emit，字段 `listing_id == SOUL_A_LISTING_OBJ`、`soul_id == $SOUL_A_ID`
   - `sui client object $SOUL_A_LISTING_OBJ` → `Object has been deleted`

4. **负向证据引用**（Phase W1.5 已前置执行的 Move test）：
   ```bash
   grep -E "delete_soul_listing_aborts_when_active|\\[ PASS +\\]|Test result: OK" \
     "$ARTIFACT_DIR/w1.5-delete_soul_listing_aborts_when_active.log"
   ```
   验证输出含 `delete_soul_listing_aborts_when_active`、`[ PASS    ]` 与 `Test result: OK. Total tests: 1; passed: 1; failed: 0`。Abort code 由 `protocol_tests.move` 中该 test 的 `#[expected_failure(abort_code = soulidity::market::EListingStillActive)]` 注解固定；当前 Sui CLI 的 test 输出不会打印 `MoveAbort` 明细。该 test 由 Phase W1.5 一次性补齐并前置执行，不允许在 mainnet 测试中途重新 grep test 名、新增 Move test 或首次执行本地 Move test。

### Test 11.0b: Delete Inactive Collection Listing — 回收 storage rebate

> Phase 3.5 已对 Collection right 执行 list + delist，留下 `is_active = false` 的 `COLLECTION_LISTING_OBJ`。

1. **确认 collection listing 已 inactive：**
   ```bash
   sui client object $COLLECTION_LISTING_OBJ --json | jq '.data.content.fields.is_active'
   ```
   预期 `false`
2. **调用 delete_collection_listing：**
   ```bash
   sui client call \
     --package $PACKAGE_ID \
     --module market \
     --function delete_collection_listing \
     --args $COLLECTION_LISTING_OBJ \
     --gas-budget 50000000
   ```
3. 验证:
   - TX success
   - 事件 `<pkg>::market::CollectionListingDeleted` emit，字段 `listing_id == COLLECTION_LISTING_OBJ`、`collection_id == $COLLECTION_ID`
   - `sui client object $COLLECTION_LISTING_OBJ` → `Object has been deleted`

### Test 11.0c: cleanup_stale_entries — 任意调用者回收 stale paid-access entry

> Test 7.10g step 6 会把 Buyer 旧 stale entry 覆盖到新 epoch，因此本测试不能依赖 7.10g 中途状态。执行 cleanup 前必须先显式确认存在 stale-epoch paid-access entry；若不存在，先构造一条不再覆盖的 stale entry，再进入 cleanup。
>
> 构造方式：Test 7.10k revoke 后，Dev 的 KIND_SPRITE entry 已 `revoked_at IS NOT NULL`，该 revoked entry 不算 stale-epoch。先查询 Buyer / Dev 当前 stale 行数；如果为 0，则由 Soul B 当前 owner（Test 7.10g 之后通常是 Seller）用 `web/scripts/e2e-relist-soul.ts` 重新上架 Soul B，再由另一个 E2E 角色购买完成一次所有权转让，使 `SoulState.ownership_epoch` 增加；转让后不要再次 purchase / add-access 覆盖 paid-access entry。此时 Buyer 在 Test 7.10g step 6 写入的 KIND_SPRITE entry 保持旧 `ownership_epoch_snapshot`，可作为 cleanup 目标。该构造步骤产生的 inactive SoulListing 也必须在本测试收尾用 `market::delete_soul_listing` 回收，不能留到 DB cleanup 后变成链上残留。

```bash
sui client switch --address $DEV_ADDR
sui client call \
  --package $PACKAGE_ID \
  --module paid_access \
  --function cleanup_stale_entries \
  --args $SOUL_B_PAID_ACCESS_OBJ $SOUL_B_STATE_OBJ '[$BUYER_ADDR,$DEV_ADDR]' '[3,3]' \
  --gas-budget 50000000 2>&1 | tee "$ARTIFACT_DIR/test-11.0c-cleanup.log"
```

验证:
- TX success；`paid_access::cleanup_stale_entries` 当前不 emit cleanup event，不能断言不存在的 `SoulPaidAccessCleanedUp`
- 调用前先查询 `soul_paid_access_entries` 中 `(buyer_address, kind) IN (($BUYER_ADDR,3),($DEV_ADDR,3))` 且 `ownership_epoch_snapshot != SoulState.ownership_epoch` 的行数；调用后同一查询至少减少 1 行，作为 stale entry 回收证据
- 如果调用前 stale 行数为 0，先按本测试前置步骤重新构造 stale entry；不能把“无 stale 可回收”的 success TX 计作本测试通过
- 如果本测试为构造 stale entry 重新上架并转售 Soul B，则记录该 listing object id，确认购买后 `is_active = false`，随后调用 `market::delete_soul_listing` 删除该对象，并验证 `sui client object <listing>` 返回 not found
- Dev 钱包 gas 余额变化只作为辅助记录；storage rebate 可能被 gas 费用抵消，不作为硬通过条件

### Test 11.1: 清理
1. `evaluate_script`: `localStorage.clear(); sessionStorage.clear();`
2. 运行 DB 清理 SQL（同 Phase -1.1；禁止全表删除 `follows` / `bookmarks`）:
   ```sql
   DELETE FROM "soul_grant_records";
   DELETE FROM "soul_paid_access_entries";
   DELETE FROM "soul_paid_access_kind_configs";
   DELETE FROM "soul_content_version_records";
   DELETE FROM "soul_prepared_purchases";
   DELETE FROM "soul_tx_syncs";
   DELETE FROM "soul_collection_assets";
   DELETE FROM "soul_assets";
   ```
   `bookmarks` 通过 `soul_assets` 外键级联清理；`follows` 是 member-to-member 社交图，Test 10.6 已在 UI 内完成 follow → unfollow，不允许 cleanup 以全表删除兜底。
3. `navigate_page` → `http://localhost:3100/market`
4. `evaluate_script` 验证 "No live Soul listings" 恢复
5. `take_screenshot` → `$ARTIFACT_DIR/phase11-cleanup.png`

---

## 手动介入点（0 次）

> **测试运行时 0 介入。** master 钱包按 4.4 节预存清单注资后由 `scripts/e2e-fund-roles.ts` 自动转 SUI / WAL / USDC 给 5 个角色；W0 `e2e-wallet-stub.tsx` 接管浏览器钱包签名（**0 popup / 0 OTP / 0 真扩展依赖**）；切角色 = `evaluate_script` 改 `localStorage['__E2E_PRIVATE_KEY']` + reload。Agent 侧 TX 由 `web/scripts/e2e-agent-purchase.ts` 通过 `AGENT_PRIVATE_KEY="$E2E_AGENT_*_PRIVATE_KEY"` 在 Node 直接签。
>
> **用户唯一前置（不计入测试运行时介入）：**
> 1. `MAINNET_DEPLOYER_PRIV_KEY` 钱包预存 ≥ 2 SUI + ≥ 130,000,000 atomic mainnet WAL + ≥ 12,000,000 atomic mainnet USDC（详见 4.4 / Phase -1.3 表）
> 2. `.env.e2e` 里已有 `AUTH_SECRET` / `DATABASE_URL` / `DIRECT_URL` / `NEXT_PUBLIC_KIOSK_PACKAGE_ID` / `NEXT_PUBLIC_SEAL_SERVER_CONFIGS` / `NEXT_PUBLIC_SEAL_THRESHOLD` / `NEXT_PUBLIC_SUI_NETWORK=mainnet` / `MAINNET_DEPLOYER_PRIV_KEY`（仓库 `.env.e2e` 已就绪）
> 3. 提供 2 个 agent API key（`E2E_AGENT_ALPHA_API_KEY` / `E2E_AGENT_BETA_API_KEY`）
>
> 不满足任一前置时按"测试纪律"硬约束直接 abort，禁止跳过。

**全自动覆盖：**
- master 钱包 PTB 注资（`scripts/e2e-fund-roles.ts` Phase -1.3）
- Stub 钱包 sign-message + sign-transaction（内存 keypair，无 popup，所有 Phase 的链上交易）
- `sui client` 链上状态查询 / `destroy_invalidated_grant` / rebind / delete listing（Phase -1、5.8、7.10h、11.0a-b）
- `sui move test` 负向断言执行（Phase W1.5 前置一次性跑完；Phase 5.8 step 5、7.10d、7.10e、7.10j、11.0a step 4 只引用日志 — 4 个 W1.5 fixed test name + `owner_cannot_purchase_paid_access` 均固定）
- Chrome DevTools MCP 浏览器操作（含 ConnectModal 选 stub）（Phase 0-8、10-11）
- Agent API `curl` 调用（Phase 7、9）
- DB SQL 验证与 DB reset（Phase -1、1.6/1.7、11.1）
- `npx tsx` E2E 脚本（Phase 5.3a-b、7.3、7.10a/f/g/i/j/k、7.10g step 1 走 `web/scripts/e2e-relist-soul.ts`）
- 截图存档（全 Phase）

---

## 状态依赖链

```
Phase W1.5 fixed negative Move tests + Test 7.10j local Move proof（本地 `sui move test`，不触 mainnet 合约）→ Phase -1 (env gate + cleanup + master-funded 5 roles)
Phase 0 (pre-flight) → Tests 10.1-10.5 (页面渲染冒烟，无合约调用)
Test 1.1 (seller login) → 记录 SELLER_MEMBER_ID → Tests 1.2-1.12
Tests 1.6-1.7 (create Soul A + B, both held) → SOUL_A_ID, SOUL_B_ID, SOUL_A_CONTENT_OBJ, SOUL_B_CONTENT_OBJ, SOUL_A_PAID_ACCESS_OBJ, SOUL_B_PAID_ACCESS_OBJ
Phase 2 (list Soul A + B at 0.1 USDC each) → 两个 Soul 变 listed
Tests 2.7-2.8 (market sort/filter) ← 两个 Soul 均 listed 时执行；同价排序按 created_at 二级
Phase 3 (collection) → seller session 内创建 Collection (floor 0.1 USDC) → COLLECTION_ID
Test 3.6 (collection floor guard) ← 依赖 collection detail 已正确镜像出子 Soul
Test 3.7 (子 Soul 上架 floor 0.1) → CHILD_SOUL_ID listing 状态进入 listed
Test 4.1 (seller logout) → Test 4.2 (buyer login)
Test 4.3 (market verify) → Tests 4.3a-4.3c (bookmark add/verify/remove，无合约 TX) → Test 10.6 (follow/unfollow，无合约 TX)
Test 4.4 (quote UI) → 4.4a (`quote_soul_purchase` dev-inspect 对账，只读链) → 4.5 (purchase Soul A 0.1 USDC)
Test 4.5a (purchase collection 子 Soul → buy_soul_fixed_price_with_collection 走通 collection royalty stack)
Test 5.2 (issue grant Alpha) → 5.2a-5.2b (capacity 1→2) → 5.2c (Beta 第二 grant) → 5.2d (3rd grant abort EGrantCapacityExceeded) → 5.2e (revoke Beta 恢复 5.4 前置) → Tests 5.3-5.5
Test 5.6 (revoke Alpha grant via GrantModal) → Test 5.7
Test 5.8 (destroy_invalidated_grant via sui client call) ← 依赖 Test 5.6 revoke 后留下的僵尸 grant object；负向断言引用 Phase W1.5 已前置执行的 `destroy_invalidated_grant_aborts_when_grant_still_active` 日志
Phase 6 (content panels 展示) ← Buyer 仍登录 + owns Soul A；只验证 Skills / Memory tab 与当前未接线状态
Phase 6.5 已删除（路由 + UI 路径在 Phase 2 不存在）
Test 7.1-7.2 (agent search + detail) → 独立只读
Test 7.3 (agent purchase Soul B 0.1 USDC) → Tests 7.4-7.5
Phase 7.5 (Paid Access API) ← SOUL_B_PAID_ACCESS_OBJ + AGENT_ALPHA_ADDR 已知；所有写路径一律走 SDK paid-access tx builder + Node 脚本本地签
Test 7.6 (paid-access kind configs / entries empty for A + B) 直接覆盖 baseline；Test 7.10a 通过 Agent Alpha owner 配置 + Buyer 购买完成付款路由 + 平台抽成 + epoch mirror 联合验证
Tests 7.10b-c（quote 平台抽成 + KioskRegistry / KindRegistry manifest 一致性） → 运行环境断言
Tests 7.10d-e（price=0 / scope_mask 负向） → 引用 Phase W1.5 已前置执行的 `purchase_paid_access_aborts_when_price_zero` / `configure_paid_access_kind_rejects_scope_mismatch` 日志
Test 7.10f（KindPaidConfig duration 生命周期） → `e2e-paid-access-lifecycle.ts` set-config / inspect-access / update-config / purchase 联动
Test 7.10g（epoch 跨转让 re-purchase 覆盖） → Agent Alpha 本地签名重新上架 + Seller UI 购买 + Buyer re-purchase
Test 7.10h（KioskRegistry insert-or-assert + rebind 全矩阵） → Dev 账户 `sui client call`，不依赖真人钱包
Test 7.10i (paid_access::add_access 免费授权 — Seller owner 给 Dev 发 KIND_SPRITE) → 7.10j (owner 自购拒绝：local Move proof 已在 Phase W1.5 前置，mainnet 阶段只跑 dry-run EPaidAccessOwnerCannotPurchase) → 7.10k (revoke_access lifecycle)
Phase 8 (import, 6 步 wizard) ← Buyer 仍登录，创建新 Soul（contentSidecars 走 publish 路由）
Phase 9 (API boundary) → 独立于浏览器状态；保留 9.1-9.6（agent auth / 404 / 403）；9.7-9.10 已删除
Phase 10 只保留编号；10.1-10.5 已在 Phase 0 后执行，10.6 已在 Test 4.2 后执行
Phase 11 (cleanup) → delete_soul_listing 回收（Test 11.0a，依赖 Phase 4 purchase 后的 inactive listing；负向引用 Phase W1.5 已前置执行的 `delete_soul_listing_aborts_when_active` 日志） → delete_collection_listing 回收（Test 11.0b） → cleanup_stale_entries 回收（Test 11.0c，Dev 调用） → DB 清理（Test 11.1，新 schema） → 收尾
```

---

## 测试数量汇总

| Phase | Tests | 描述 |
|-------|-------|------|
| 0 | 3 | Pre-flight 冒烟 |
| 1 | 12 | Seller 登录 + Soul 创建（content_id + paid_access_list_id 双对象捕获） |
| 2 | 8 | 上架 Soul A (0.1 USDC) + Soul B (0.1 USDC) + Market 排序 / 筛选 |
| 3 | 7 | Collection 创建（floor 0.1 USDC）+ floor price guard + 子 Soul 上架（触达 collection-bound 路径） |
| 4 | 11 | Buyer 登录 + 非合约 Bookmark / Follow 前置 + 审报价 + `quote_soul_purchase` 只读对账 + 购买 Soul A + 购买 collection 子 Soul（验证 collection royalty stack） |
| 5 | 15 | Grant 发放 / 容量调整 / 第二 grant 占用 / 容量超限拒绝 / Beta revoke / agent grant 解密 soul.md + memory.md / 撤销 / destroy_invalidated_grant 回收（`destroy_invalidated_grant_aborts_when_grant_still_active`） |
| 6 | 1 | Content panels 展示验收（Skills / Memory tab 与未接线状态） |
| 6.5 | 0 | 已删除（路由 + UI 路径不存在） |
| 7 | 5 | Agent API 购买路径主流程（search / detail / purchase / owner access / matrix） |
| 7.5 | 12 | Paid Access API：空状态 + paid purchase 付款路由 / 平台抽成 / epoch mirror + KioskRegistry / KindRegistry manifest 一致性 + price=0 拒购 + scope_mask 负向 + duration 生命周期 + epoch 跨转让 re-purchase + KioskRegistry rebind 矩阵 + add_access 免费授权 + owner 自购拒绝 + revoke_access lifecycle |
| 8 | 6 | Import 流程（6 步 wizard） |
| 9 | 6 | API 边界（agent auth / 404 / 403）；asset / content-access / public-sprite 路径 9.7-9.10 已删除 |
| 10 | 6 | 页面渲染 + Follow/Unfollow；10.1-10.5 在 Phase 1 前执行，10.6 在 Buyer 登录后、购买前执行 |
| 11 | 4 | Cleanup（delete_soul_listing + delete_collection_listing + cleanup_stale_entries + DB 清理 — 新 schema） |
| **Total** | **96** | 固定主流程数量；Phase W1（含 W1.5 Move negative tests）支撑脚本不计入通过数 |

---

## Chrome DevTools MCP 定位提示速查

> 以下内容仅是定位提示，帮助你在最新 snapshot 里找到目标元素；真正执行时必须先 `take_snapshot`，再对对应 `uid` 使用 `click` / `fill` / `upload_file`。

| 元素 | Selector | 页面 |
|------|----------|------|
| Login | `button:has-text("Login")` | Navbar |
| AccountButton | `.rounded-full.border.border-border.bg-card2` | Navbar |
| ConnectModal | dapp-kit dialog 标题 "Connect a Sui Wallet" | Login 触发 |
| E2E Test Wallet (stub) | ConnectModal 中 name="E2E Test Wallet" 的钱包条目 | 任意页面登录场景 |
| Sign Out | `button:has-text("Sign Out")` (text-danger) | AccountButton dropdown |
| Search 框 | `input[placeholder="Search souls..."]` | /market |
| Sort 下拉 | `select` (值: newest/price_asc/price_desc/popular) | /market |
| Filters 切换 | `button:has-text("Filters")` | /market |
| Min Price | `input[placeholder="Min"]` | /market (advanced filters) |
| Max Price | `input[placeholder="Max"]` | /market (advanced filters) |
| Clear filters | `button:has-text("Clear filters")` | /market (advanced filters) |
| Bookmark（添加） | `button[aria-label="Bookmark this Soul"]` | /market |
| Bookmark（移除） | `button[aria-label="Remove bookmark"]` | /market |
| Soul Name | `input[placeholder="e.g. AlphaScout, Kaze no Akira..."]` | /create |
| Description | `textarea[placeholder*="Describe your Soul"]` | /create |
| Tags | `input[placeholder="e.g. ai, trading, signals"]` | /create |
| Price | `input[placeholder="0.00"][type="number"]` | /sell |
| Cover image (create) | `div[aria-label="Click to upload cover image"] input[type="file"]` | /create |
| Cover image (collection) | `div[aria-label="Upload cover image"] input[type="file"]` | /collections/create |
| Char input (打标后) | `input[data-e2e="char-input"]` | /create/content |
| Memory input (打标后) | `input[data-e2e="memory-input"]` | /create/content |
| Skills input (打标后) | `input[data-e2e="skills-input"]` | /create/content |
| Directory upload | `input[type="file"][webkitdirectory]` | /collections/create/souls |
| Royalty 5% | 5% 按钮（4 按钮组：0% / 2.5% / 5% / 10%） | /create |
| Next: Living Content | `button:has-text("Next: Living Content")` | /create |
| Next: Soul Awakened | `button:has-text("Next: Soul Awakened")` | /create/content |
| Next: Pay Gas | `a[href="/create/gas"]` | /create/preview |
| Sign & Deploy | `button:has-text("Sign & Deploy")` | /create/gas |
| Publish status | `[data-testid="publish-status"]` | /create/gas |
| Sign & List | `button:has-text("Sign & List")` | /souls/{id}/sell/authorize |
| Next: Authorize | `a:has-text("Next: Authorize")` | /souls/{id}/sell |
| Batch Upload | `button:has-text("Batch Upload")` | /collections/create/souls |
| Sign & Launch | `button:has-text("Sign & Launch")` | /collections/create/preview |
| Buy button | `button:has-text("Buy for")` | /souls/{id}/buy |
| Grant Access | `button:has-text("Grant Access")` | /my-souls (SoulCard) |
| Manage Grant | `button:has-text("Manage Grant")` | /my-souls (SoulCard) |
| Agent Address Input | `input[placeholder="0x_agent_address_or_ocl_id"]` | GrantModal |
| Authorize Agent | `button:has-text("Authorize Agent")` | GrantModal |
| Revoke | `button:has-text("Revoke")` (danger) | GrantModal |
| Follow | `button:has-text("Follow")` | /community/u/{id} |
| Following | `button:has-text("Following")` | /community/u/{id} |
| Owned tab | `button:has-text("Owned")` | /my-souls |
| Collections tab | `button:has-text("Collections")` | /my-souls |
| Listings tab | `button:has-text("Listings")` | /my-souls |
| Activity tab | `button:has-text("Activity")` | /my-souls |
| Bookmarks tab | `button:has-text("Bookmarks")` | /my-souls |
| List Soul | `a:has-text("List Soul")` | /souls/{id} (owner+held) |

---

## E2E Helper 函数（Phase 2 mainnet）

Gas 页（`web/app/create/gas/page.tsx`）和 AppProviders dev-only 分支挂载的全局 helper：

| 函数 | 状态 | 用途 |
|------|------|------|
| `__e2ePublish` | ✅ 可用 | 触发 mint TX（Phase 2 签名：`vector<InitialContentEntry>` + `vector<StateConfigEntry>` + royalty）；Phase 1 create 流程 |
| `__e2eUpload` | ✅ 可用（白盒，自动 approve quote） | 仅用于调试；不替代主流程 `UploadCostReview` |
| `__e2eListSoul` | ✅ 可用 | 上架；Phase 2 list 流程 |
| `__e2eGetAuthHeaders` | ✅ 可用 | 获取 `{ 'x-csrf-token': csrf }`（cookie `session` 自动携带） |
| `__e2eLastSealMaterial` | ✅ 可用（create/import gas 页） | `{char,memory,skills,sprite}` Pending Seal material 暴露点；Test 5.3b 使用 `char` / `memory` 作为预期证据 |
| `__e2eIssueGrant` / `__e2eRevokeGrant` | ❌ Phase 1 兼容钩，**已废弃** | Phase 5 改用 GrantModal UI |
| `__e2eSoulidity.setGrantCapacity` | ✅ 可用（dev-only） | 内部已 POST `/api/souls/[id]/grant-capacity` mirror；Phase 5.2a |
| `__e2eSoulidity.purchaseContentAccess` | ❌ Phase 2 已删除 | 抛 `Phase 1 helper is gone — use buildPurchasePaidAccessTx with a kind argument`；本计划改用 Node 脚本 `web/scripts/e2e-paid-access-lifecycle.ts` |
| `__e2eSoulidity.setContentAccessPrice` | ❌ Phase 2 已删除 | 同上；改用 SDK `buildConfigurePaidAccessKindTx` 由 Node 脚本签 |
| `__e2eSoulidity.setContentAccessDuration` | ❌ Phase 2 已删除 | 同上 |
| `E2EWalletStub` | ✅ W0 已实现（`web/components/providers/e2e-wallet-stub.tsx`） | 通过 `localStorage['__E2E_PRIVATE_KEY']` 注入 keypair → ConnectModal 自动列出 → 0 popup 签所有 message / TX；Phase 0 onwards 全部登录与签名 |

**使用前提：** 从 `/create` 走完 wizard 到 `/create/gas`，保持 CreateSoulProvider context 完整（name + description + coverImageFile + charFile + memoryFile 非空）。

> **Grant 管理已迁移到 GrantModal UI**：Phase 5 不再需要导航到 gas 页。Grant 发放/撤销通过 My Souls 页的 GrantModal 组件（`web/components/souls/grant-modal.tsx`）直接完成，使用 `useGrant` hook 调用链上 TX。
>
> **Paid Access 已迁移到 SDK + Node 脚本路径**：Phase 7.5 不再调用浏览器 helper；统一通过 Phase W1.3 要求的 `web/scripts/e2e-paid-access-lifecycle.ts` 调用 `@soulidity/sdk` 的 `buildConfigurePaidAccessKindTx` / `buildPurchasePaidAccessTx` / `buildAddPaidAccessTx` / `buildRevokePaidAccessTx`。

---

## 关键文件

### 前端页面
| 文件 | 用途 |
|------|------|
| `web/app/market/page.tsx` | Market 列表页 — Phase 0, 1.10, 2.6, 4.3 |
| `web/app/souls/[id]/page.tsx` | Soul 详情页 — Phase 1.8-1.9, 5.1, 6 |
| `web/app/souls/[id]/buy/page.tsx` | Buy 页 — Phase 4.4-4.5 |
| `web/app/souls/[id]/sell/page.tsx` | Sell 设价页 — Phase 2.1, 2.4 |
| `web/app/souls/[id]/sell/authorize/page.tsx` | Sell 签名页 — Phase 2.2, 2.5 |
| `web/app/souls/[id]/sell/success/page.tsx` | Sell 成功页 — Phase 2.3 |
| `web/app/create/page.tsx` | 创建 Step 1 — Phase 1.2 |
| `web/app/create/content/page.tsx` | 创建 Step 2 — Phase 1.3 |
| `web/app/create/preview/page.tsx` | 创建 Step 3 — Phase 1.4 |
| `web/app/create/gas/page.tsx` | 创建 Step 4 + E2E helpers — Phase 1.5-1.6 |
| `web/app/create/success/page.tsx` | 创建成功 — Phase 1.6 |
| `web/app/collections/create/page.tsx` | Collection Step 1 — Phase 3.1 |
| `web/app/collections/create/souls/page.tsx` | Collection Step 2 — Phase 3.2 |
| `web/app/collections/create/preview/page.tsx` | Collection Step 3 — Phase 3.3 |
| `web/app/import/page.tsx` | Import Choose Source — Phase 8.1 |
| `web/app/import/upload/page.tsx` | Import Upload File — Phase 8.2 |
| `web/app/import/map/page.tsx` | Import Map Fields — Phase 8.3 |
| `web/app/import/preview/page.tsx` | Import Soul Awakened — Phase 8.4 |
| `web/app/import/gas/page.tsx` | Import Pay Gas — Phase 8.5 |
| `web/app/import/success/page.tsx` | Import On-chain Success — Phase 8.6 |
| `web/app/my-souls/page.tsx` | My Souls 5-tab + GrantModal — Phase 1.11, 4.3a-c, 4.6, 5.2, 5.5, 5.6 |
| `web/app/resources/content-format/page.tsx` | Content Format 参考 — Phase 10.2 |
| `web/app/resources/getting-started/page.tsx` | Getting Started — Phase 10.2 |
| `web/app/resources/stats/page.tsx` | Protocol Stats — Phase 10.5 |
| `web/app/community/leaderboard/page.tsx` | Leaderboard — Phase 10.4 |
| `web/app/community/u/[spaceId]/page.tsx` | Community Profile + Follow — Phase 10.6 |
| `web/components/nav/navbar.tsx` | 导航栏（Login + Docs 在 + New 菜单之后） |
| `web/components/nav/account-button.tsx` | 账户下拉 + Sign Out（带 CSRF） |
| `web/components/providers/auth-provider.tsx` | Sui wallet auth context（session + CSRF） |
| `web/components/providers/wallet-login-modal.tsx` | dapp-kit ConnectModal mount |
| `web/components/providers/wallet-auth-bridge.tsx` | 钱包 connect 后自动 challenge → login |
| `web/components/providers/e2e-wallet-helpers.tsx` | `window.__e2eSoulidity` dev-only helper |
| `web/components/providers/e2e-wallet-stub.tsx` | **W0 已实现**：dev-only Wallet Standard 测试桩 |
| `web/components/providers/app-providers.tsx` | **W0 已实现**：development 分支挂 `<E2EWalletStub />`，并包裹 `<UploadCostReviewProvider />` |
| `web/components/upload/upload-cost-review.tsx` | wallet-paid Walrus 成本确认 modal — 所有 `uploadSoulPayload` UI 路径签名前必经 |
| `web/components/souls/grant-modal.tsx` | GrantModal UI — Phase 5.2, 5.6 |
| `web/components/souls/listing-modals.tsx` | List / Delist Modal — Phase 2, 3.5 |
| `web/components/souls/skill-bundle-format-hint.tsx` | Skill bundle 格式提示组件 |
| `web/components/souls/soul-cover-image.tsx` | Soul 封面图组件 |

> Phase 1 的 `web/components/souls/{memory-panel.tsx, persona-asset-panel.tsx}` 已在 Phase 2 hard-cut 后删除；Memory / Sprite / Voice 的 owner UI 入口当前**不存在**，本计划"前端 UI 为准"硬约束下相关测试整段删除（详见 Phase 6 / 6.5 段）。

### 前端 Hooks
| 文件 | 用途 |
|------|------|
| `web/lib/hooks/use-wallet-sign.ts` | 钱包签名（替换 `usePrivySuiSign`）— 所有签名场景 |
| `web/lib/hooks/use-login.ts` | 登录入口（替换 `useGenericLogin`）— Phase 0/1/4 |
| `web/lib/hooks/use-publish.ts` | Publish hook — Phase 1.6-1.7 |
| `web/lib/hooks/use-purchase.ts` | Purchase hook — Phase 4.5 |
| `web/lib/hooks/use-list-soul.ts` | List hook — Phase 2.2, 2.5 |
| `web/lib/hooks/use-grant.ts` | Grant hook — Phase 5.2, 5.6（via GrantModal） |
| `web/lib/hooks/use-skills.ts` | Skills hook — Phase 6 |
| `web/lib/hooks/use-assets.ts` | Persona sprite assets hook — `persona-asset-panel.tsx` |
| `web/lib/hooks/use-social.ts` | Bookmark/Follow hooks — Phase 4.3a-c, 10.6 |
| `web/lib/hooks/use-collection-publish.ts` | Collection publish — Phase 3.3 |
| `web/lib/hooks/use-import.ts` | Import hook — Phase 8.4 |
| `web/lib/upload/client-upload.ts` | `uploadSoulPayload` — wallet-paid Walrus upload 客户端入口 |
| `web/lib/upload/walrus-quote.ts` | `quoteWalrusUpload` / chunk plan / quote TTL 与 fingerprint 校验 |
| `web/lib/upload/client-seal.ts` | 浏览器端 AES-GCM 加密与 client-built Seal sidecar 生成 |
| `web/components/souls/skills-panel.tsx` | Skills 面板 UI — Phase 6 |

### Agent API（已实现 ✅）
| 文件 | 用途 |
|------|------|
| `web/lib/soulidity/agent-server.ts` | Agent auth 中间件 `requireAgentWalletIdentity` |
| `web/lib/soulidity/coin-selection.ts` | Coin 选择工具 |
| `web/app/api/agent/souls/search/route.ts` | Agent 搜索 listed Soul |
| `web/app/api/agent/souls/[id]/route.ts` | Agent Soul 详情 + 报价 |
| `web/app/api/agent/souls/[id]/access/route.ts` | Agent Seal 访问 |
| `web/app/api/agent/souls/[id]/purchase/route.ts` | Agent 准备购买 TX |
| `web/app/api/agent/souls/[id]/purchase/execute/route.ts` | Agent 执行购买 TX + mirror |
| `tests/new-web/soulidity-agent-server.test.ts` | Auth 中间件单元测试 |

> Phase 1 的 `web/app/api/agent/souls/[id]/skills/.../access/route.ts` 与 `[id]/memory/.../access/route.ts` 在 Phase 2 已删除；Memory 的 Seal session 由 agent-side Node 脚本通过 `@soulidity/sdk` 直接构造（Test 5.3b 走该路径）。

### Taxonomy API
| 文件 | 用途 |
|------|------|
| `web/app/api/souls/tags/route.ts` | Tag cloud API（top 50 tags by count）— 替代 Category 分类 |

### E2E 脚本（Phase 2 mainnet）
| 文件 | 状态 | 用途 |
|------|------|------|
| `web/scripts/e2e-agent-purchase.ts` | ✅ | Agent 购买（prepare → local sign → execute → verify access） |
| `web/scripts/e2e-agent-decrypt.ts` | ✅ | Agent Seal 解密（SHA-256 hash 校验） — Test 5.3a |
| `web/scripts/e2e-agent-verify-content.ts` | W1.4 必须升级（当前 checkout 只支持 `char` 时不得进入主验收） | Agent 脚本级 Seal 内容逐字节比对（SHA-256 + byte compare） — Test 5.3b 主验收必须输出 `OK 2 artifact(s)`，覆盖 `char` / `memory` |
| `web/scripts/e2e-relist-soul.ts` | ✅ 已落地（本轮保留，提交前需保持 tracked） | 用 `buildListSoulTx` 一笔 PTB 给当前 owner 把 Soul 重新上架；Test 7.10g step 1 / Test 11.0c stale 构造路径，替代旧 inline `npx tsx -e` |
| `web/scripts/e2e-content-access-lifecycle.ts` | ✅ 已删除 | Phase 1 `content_access::*` 残留不得恢复；由 W1.3 的 `e2e-paid-access-lifecycle.ts` 取代 |
| `web/scripts/e2e-paid-access-lifecycle.ts` | ✅ 已落地（提交前需保持 tracked） | Phase 2 paid-access SDK 调用：`set-config / update-config / delete-config / purchase / add-access / revoke / cleanup / inspect-access / inspect-config`；Phase 7.5 / 7.10a-k 主路径 |
| `web/scripts/e2e-public-sprite-anonymous.ts` | ✅ 已删除 | Phase 9.10 整段已删；不得恢复依赖旧 `e2e-sprite-lifecycle.ts` 的 Phase 1 脚本 |
| `scripts/lib/keypair.ts` | ✅ | `loadKeypairFromEnv` — bech32 / base64 / hex 解析（Phase -1.2 用） |
| `scripts/e2e-setup-agents.ts` | ✅ | env-driven create-or-update：从 `E2E_AGENT_*_PRIVATE_KEY` 派生地址，并从 `E2E_AGENT_*_API_KEY` 写入 hash |
| `scripts/e2e-bootstrap-keys.ts` | ✅ 已落地（本轮保留，提交前需保持 tracked） | 检查 `.env.e2e` 缺失的 `E2E_*_PRIVATE_KEY`，幂等 generate + append；Phase -1.1 env gate / Phase -1.2 Step 0 |
| `scripts/e2e-fund-roles.ts` | ✅ 已落地（本轮保留，提交前需保持 tracked） | 用 `MAINNET_DEPLOYER_PRIV_KEY` 单笔 PTB 给 5 角色按表注资 / 再平衡 SUI、WAL、USDC；Phase -1.3 Step 2 与测试后资金 closeout |
| `scripts/e2e-check-env.ts` | ✅ 已升级 | `.env.e2e` mainnet gate；必须在 DB reset / dev server / 注资前通过 |

### Soulidity SDK（Phase 2：抽到 `packages/soulidity-sdk/`）

> commit 6c55b59 抽包；web 通过 `@soulidity/sdk` import；服务端 mirror 专属代码仍在 `web/lib/soulidity/mirror/`。

| 文件 | 用途 |
|------|------|
| `packages/soulidity-sdk/src/deployment-manifest.json` | mainnet / testnet 部署对象 ID（mainnet 段权威） |
| `packages/soulidity-sdk/src/kinds.ts` | `BUILTIN_KIND_DESCRIPTORS`、KIND_* 常量、op / read mode 位掩码 |
| `packages/soulidity-sdk/src/grant-scopes.ts` | SCOPE_SEAL / MEMORY / SKILLS / ASSETS 位掩码 |
| `packages/soulidity-sdk/src/content-document-id.ts` | Seal sidecar documentId 派生 + 校验 |
| `packages/soulidity-sdk/src/walrus-quote.ts` | `quoteWalrusUpload` / chunk plan / quote TTL fingerprint |
| `packages/soulidity-sdk/src/walrus.ts` / `walrus-blob.ts` | Walrus 上传 helper |
| `packages/soulidity-sdk/src/queries.ts` / `events.ts` | 链上读取 + 事件解析 |
| `packages/soulidity-sdk/src/tx/publish.ts` | 发布 TX builder（含 InitialContentEntry vec） |
| `packages/soulidity-sdk/src/tx/buy.ts` | 购买 TX builder |
| `packages/soulidity-sdk/src/tx/list.ts` / `delist.ts` / `update-price.ts` / `update-collection-price.ts` | 上架 / 下架 / 改价 |
| `packages/soulidity-sdk/src/tx/grant.ts` | Grant 发放 / 撤销 / 容量 / destroy |
| `packages/soulidity-sdk/src/tx/paid-access.ts` | `buildConfigurePaidAccessKindTx` / `buildPurchasePaidAccessTx` / `buildAddPaidAccessTx` / `buildRevokePaidAccessTx` |
| `packages/soulidity-sdk/src/tx/content.ts` | `OP_APPEND` / `OP_DELETE` / `OP_PURGE` / `OP_ACTIVE_BIND` op 装配 |
| `packages/soulidity-sdk/src/tx/mint-helpers.ts` | `buildInitialContentArgs` 装 `InitialContentEntry` vec |
| `packages/soulidity-sdk/src/tx/personal-join.ts` / `import.ts` / `collection.ts` / `kiosk-management.ts` / `shared.ts` | 其余 tx builder |
| `packages/soulidity-sdk/src/personal-kiosk.ts` | Personal kiosk 解析 |
| `packages/soulidity-sdk/src/upload-validation.ts` | 文件上传验证（MIME, 签名, 大小, skill bundle） |
| `packages/soulidity-sdk/src/content-schema.ts` / `content-templates.ts` | Content 验证 schema + soul.md / memory.md / skill.md 模板 |
| `packages/soulidity-sdk/src/object-inputs.ts` | On-chain object input helpers |
| `web/lib/soulidity/access.ts` | Seal 访问逻辑（`resolveContentAccessPayload`，仅 SOUL_DOC v0） |
| `web/lib/soulidity/repository.ts` | Soul 查询 + 序列化 |
| `web/lib/soulidity/server.ts` | `requireHumanWalletIdentity` / `requireSoulCreateWalletIdentity` |
| `web/lib/soulidity/agent-server.ts` | Agent auth 中间件 `requireAgentWalletIdentity` |
| `web/lib/soulidity/mirror/sync-helpers.ts` | `syncSoulProjectionFromChain` 等主入口 |
| `web/lib/soulidity/mirror/build-seal-sidecars.ts` | `buildSyncSealSidecars()`：sidecar documentId 严格校验 |
| `web/lib/soulidity/mirror/parse-content-sidecars.ts` | 解析请求体的 `contentSidecars` |
| `web/lib/soulidity/mirror/upsert-content-version.ts` | mirror `SoulContentVersionRecord` |
| `web/lib/soulidity/mirror/upsert-paid-access.ts` | mirror `SoulPaidAccessKindConfig` / `SoulPaidAccessEntry` |
| `web/lib/soulidity/mirror/upsert-grant.ts` | mirror `SoulGrantRecord` |
| `web/lib/soulidity/mirror/upsert-soul.ts` / `upsert-collection.ts` | mirror SoulAsset / SoulCollection projection |

### Auth + 上传 API
| 文件 | 用途 |
|------|------|
| `web/app/api/auth/wallet-challenge/route.ts` | 发 nonce + sign-in message（rate limit 30/60s） |
| `web/app/api/auth/wallet-login/route.ts` | 校验签名 → 写 `session` + `csrf-token` cookies；同源 + rate limit 20/60s |
| `web/app/api/auth/me/route.ts` | 当前用户信息（GET，无需 CSRF） |
| `web/app/api/auth/logout/route.ts` | 清 cookies（带 CSRF 校验） |
| `web/app/api/souls/publish/route.ts` | mint native — 接 `contentSidecars` + `txDigest`，post-TX mirror 同步 |
| `web/app/api/souls/publish/batch/route.ts` | batch publish（Collection 子 Soul / multi-mint） |
| `web/app/api/souls/[id]/access/route.ts` | 唯一保留的 human-side 访问端点（SOUL_DOC v0） |
| `web/app/api/souls/[id]/grant/route.ts` | Grant 发放 mirror（接 `txDigest` → 链上事件 → upsert） |
| `web/app/api/souls/[id]/grant-capacity/route.ts` | 链上 `GrantCapacityUpdated` 事件 mirror |
| `web/app/api/souls/[id]/list/route.ts` / `delist/route.ts` / `purchase/route.ts` | List / Delist / Purchase mirror 路由 |
| `web/app/api/souls/upload/route.ts` | 已退役为 410；不再接受 server-side Soul upload |
| `web/app/api/souls/upload/token/route.ts` | 已退役为 410；不再签发 Vercel Blob token |
| `web/app/api/souls/upload/from-blob/route.ts` | 已退役为 410；不再接受 Vercel Blob staging finalize |
| `web/lib/auth/identity.ts` | `requireMutationIdentity` / `requireIdentity`；session cookie + agent API key identity resolver |
| `web/lib/soulidity/server.ts` | `requireHumanWalletIdentity` / `requireSoulCreateWalletIdentity`；Soulidity human wallet guard |
| `web/lib/auth/session.ts` | HS256 JWT session（AUTH_SECRET 签，30d，HttpOnly + SameSite=Lax + Secure(prod)） |
| `web/lib/auth/csrf.ts` | 双提交 CSRF + 同源 Origin/Referer |
| `web/lib/auth/wallet-challenge.ts` | challenge 入库 / 校验 |
| `web/lib/auth/wallet-login.ts` | 签名验证 + 登录组合逻辑 |
| `web/lib/auth/sui-wallet.ts` | `getMemberPrimarySuiWalletAddress` 等钱包查询 |
| `web/lib/auth/resolve-agent.ts` | `resolveAgentByApiKey` — API key SHA-256 → AgentIdentity |
| `web/lib/rate-limit.ts` | `takeRateLimitToken` — IP/member rate limiting |
| `web/lib/sui.ts` | `suiClient` — Sui RPC 客户端 |
| `web/lib/prisma.ts` | `prisma` — 共享 Prisma 客户端 |
| `web/lib/upload/client-upload.ts` | `uploadSoulPayload` — wallet-paid Walrus upload 客户端入口 |
| `web/lib/soulidity/mirror/provided-sidecar.ts` | mirror 路由解析 client-built sidecar；raw DEK envelope string 返回 400 |

### Collection 批量处理
| 文件 | 用途 |
|------|------|
| `web/app/collections/create/souls/batch-utils.ts` | `processFolderUpload` — 解析 xlsx + 编号子文件夹 |
| `web/components/providers/create-collection-provider.tsx` | Collection state: batchSouls, soulFolders, publishResult |

---

## 已知约束与缓解（Phase 2 mainnet）

所有条目均为当前必须满足的执行前提 / 断言要求，不保留占位、后续补充或备用分支测试项。

### 环境与工具

1. **Fresh publish 清账（mainnet）**：Phase -1 必须把 `soul_grant_records` / `soul_paid_access_entries` / `soul_paid_access_kind_configs` / `soul_content_version_records` / `soul_prepared_purchases` / `soul_tx_syncs` / `soul_collection_assets` / `soul_assets` 清空；`bookmarks` 依赖 `soul_assets` 外键级联清理，`follows` 不属于 Soulidity fresh-publish 状态，禁止全表删除。旧链上 object 一律不可继承（package / kiosk registry / kind registry / paid access list / content / grant 均从 fresh publish 重建）。
2. **Sui CLI 前置**：`which sui && sui --version`，要求 >= 1.69.0 + mainnet RPC 可达；任一不满足则 Phase -1 阻塞。
3. **mainnet 真币前置（master 钱包）**：`MAINNET_DEPLOYER_PRIV_KEY` 派生地址需预存 ≥ 2 SUI + ≥ 130,000,000 atomic mainnet WAL + ≥ 12,000,000 atomic mainnet USDC（详见 4.4 / Phase -1.3 表）；不足按"测试纪律"硬约束直接 abort，禁止跳过。
4. **Agent 钱包前置**：DB 必须有 `members.kind='agent' + agent_status='active' + api_key_hash IS NOT NULL` 的 Alpha / Beta 两条记录及其 `wallet_bindings`。`scripts/e2e-setup-agents.ts` 已是 env-driven create-or-update；运行前需先让 owner wallet 通过浏览器登录写入 `WalletBinding`，再用 `E2E_AGENT_*_PRIVATE_KEY` / `E2E_AGENT_*_API_KEY` 派生并同步 agent。Agent keypair 调用 Node 脚本时通过 `AGENT_PRIVATE_KEY="$E2E_AGENT_*_PRIVATE_KEY"` 注入。
5. **Agent API 基础设施**：`web/app/api/agent/*` 路由收敛到 5 个（search / [id] / [id]/access / [id]/purchase / [id]/purchase/execute），`web/lib/soulidity/agent-server.ts::requireAgentWalletIdentity` 复用 `@web/lib/auth/resolve-agent` / `getMemberSuiWalletAddresses`；`packages/soulidity-sdk/src/coin-selection.ts` 提供 USDC coin 多页选择 helper。

### 工作流与时序

6. **Create/Import wizard 状态链**：CreateSoulProvider / ImportSoulProvider 用 React context 维护跨页状态；gas 页有 `missingStep1` / `missingStep2` 守卫。测试必须按 Step 1 → 2 → 3 → gas 顺序走，不得跳步直达 gas。
7. **Wallet 扩展不进入测试链路**：dapp-kit `ConnectModal` 是普通 React dialog；在 dev 模式下 `e2e-wallet-stub` 注册一个 Wallet Standard 钱包到 modal，无任何浏览器扩展依赖。Stub 内部用 `localStorage['__E2E_PRIVATE_KEY']` 重建 Ed25519 keypair；切角色靠 `evaluate_script` 改 localStorage + reload。
8. **Rate limit**：dev 环境使用内存 rate limiter；本计划自动化流量处在阈值内。
9. **Agent 购买两步签名 TTL**：prepare → execute 之间必须在 10 分钟内完成，否则 `/api/agent/souls/{id}/purchase/execute` 返回 410。
10. **Collection directory upload**：Chrome DevTools MCP `upload_file` 不支持 `webkitdirectory` picker；Phase 3.2 使用 `evaluate_script` 构造 File + DataTransfer + dispatch change event，此为唯一执行路径。
11. **Import 字段映射**：`soul.md` 作为 source file 时 name/description 不会自动映射，Phase 8.3 必须通过 Chrome DevTools MCP `fill` 写入 `E2E Imported Soul` 与 `Imported from local file`。
12. **Seal 逐字节比对前置**：Test 5.3b 脚本需要在 Soul A create gas 页结束瞬间捕获 `window.__e2eLastSealMaterial` 的完整 JSON；解密必须由 Agent Alpha 的 `AGENT_API_KEY` + `AGENT_PRIVATE_KEY` 完成，不再需要 `SOUL_UPLOAD_SECRET`，也不得用 raw DEK envelope 绕过 Seal。
13. **Follow 测试前置**：Phase 10.6 依赖 Phase -1.2 记录的 `SELLER_MEMBER_ID`，但不调用合约；执行顺序放在 Test 4.2 Buyer 登录后、Test 4.5 购买前。
14. **Bookmark 时序**：Phase 4.3a-4.3c 不调用合约；必须在 Buyer 登录后、购买前执行（需要 Market 列表两个 Soul 均 listed，且购买后 owner/listing 状态会改变）。
15. **Admin 面板范围外**：admin 页面 + admin API 路由不在本轮覆盖面（无 admin 测试账号）。

### 合约 / SDK 契约（Phase 2 mainnet）

16. **Mainnet manifest 唯一真相**：运行时读取的 `packageId` / `marketConfigId` / `kioskRegistryId` / `kindRegistryId` / `soulTransferPolicyId` / `collectionTransferPolicyId` / `paymentCoinType` / `upgradeCapId` / `marketAdminCapId` / `kindAdminCapId` 必须来自 `packages/soulidity-sdk/src/deployment-manifest.json` 的 `mainnet` 段；`move/soulidity/Published.toml` 只交叉校验 `published-at` / `original-id` / `upgrade-capability`。Test 7.10b/c 做 manifest 一致性断言。
17. **Mint 签名（vec 化）**：`mint_native_in_personal_kiosk` / `mint_imported_in_personal_kiosk` / `mint_joined_in_personal_kiosk<T>` Phase 2 签名为 `(market_config, kind_registry, kiosk_registry, transfer_policy, personal_kiosk, personal_kiosk_cap, name, description, image_url, initial_content: vector<InitialContentEntry>, initial_state_config: vector<StateConfigEntry>, creator_royalty_bps, clock, ctx)`；Phase 1 的 13 个独立 sprite/voice/content_access/royalty 参数已废弃。所有直接构造 PTB 的外部调用者必须用 `@soulidity/sdk` 的 `buildInitialContentArgs()` 装配 vec；本计划统一走 SDK builder。
18. **SoulContent + KindRegistry**：mint 内部自动创建 `SoulContent` shared object（`SoulState.content_id` 引用），并通过 `kind_registry` 校验 5 个 builtin kind（SOUL_DOC / MEMORY / SKILL / SPRITE / AUDIO）+ admin 注册的 custom kind。`SoulAsset.contentOnChainId` 在 publish sync 路由 mirror。Phase 1.8 / 1.9 断言该字段非空；fixture 不含 sprite / voice，因此 `activeSpriteName / activeVoiceName / *ConfigJson` 字段为 null。
19. **SoulPaidAccessList 与 SoulState 一一绑定**：mint 自动创建 SoulPaidAccessList 并写入 `SoulState.access_list_id`；`market::purchase_paid_access` 双向校验 `state.access_list_id == object::id(paid_access_list)`（精确错误码以 mainnet `paid_access.move` / `market.move` 为准，执行前 `grep -nE "EAccessListLinkageMismatch\\|EPaidAccessLinkageMismatch" sources/`）。
20. **付款路由 + 平台抽成**：paid access purchase 的 USDC 发给 `soul::current_owner(state)`，平台抽成按 `MarketConfig.platform_fee_bps` 切入（默认 250 bps）。Tests 7.10a / 7.10b 断言此行为。
21. **Scope mask 硬约束**：Grant `default_scope_mask` / `SoulGrant.scope_mask` 必须是 `SCOPE_SEAL|MEMORY|SKILLS|ASSETS = 15` 的非零子集；Paid Access `KindPaidConfig.scope_mask` 必须等于该 kind descriptor 的单 bit `default_grant_scope_mask`，且 kind 必须支持 `READ_PAID`。本计划 paid-access 正向路径固定 `KIND_SPRITE = 3` + `SCOPE_ASSETS = 8`；传 `15` 或其它不匹配 scope 应由 `paid_access::EKindScopeMismatch` abort（Test 7.10e 固化）。
22. **Price=0 paid purchase 拒绝**：`paid_access::record_purchase` / `market::purchase_paid_access` 拒绝 `price_atomic = 0`。Test 7.10d 由 `protocol_tests.move::purchase_paid_access_aborts_when_price_zero`（Phase W1.5 固化）覆盖；该 test 直接走 `sui move test`，不允许 mid-run 重新 grep。免费授权只能 owner 通过 `paid_access::add_access` 直接发放。
23. **KindPaidConfig.duration**：`duration_ms: Option<u64>` 决定新购买 entry 的 `expires_at_ms = now + duration`；`None = 终身`；`paid_access::configure_paid_access_kind` / `update_paid_access_kind` 只影响后续购买、不追溯既有 entry。Test 7.10f 走 Phase W1.3 要求的 `web/scripts/e2e-paid-access-lifecycle.ts`。
24. **Grant capacity 调整**：默认 `grant_capacity = 1`；`grant::set_grant_capacity(state, capacity, clock, ctx)` 要求 `capacity >= active_grant_count` + `capacity <= MAX_GRANT_CAPACITY`。GrantModal 不暴露此控件；Test 5.2a 通过 `window.__e2eSoulidity.setGrantCapacity` 由 Buyer owner stub 钱包签名完成；helper 内部已自动 POST `/api/souls/[id]/grant-capacity` 同步 mirror（无需测试侧再单独 cURL）。
25. **SoulGrant 僵尸回收**：Test 5.6 revoke 后 `SoulGrant` owned object 仍留在 grantee 钱包；`grant::destroy_invalidated_grant` 无额外身份校验，但 Sui 在 Move 执行前做 owned-object 归属校验，sender 必须持有该对象。Test 5.8 切到 Agent Alpha 地址签名；Active grant 负向断言走 `protocol_tests.move::destroy_invalidated_grant_aborts_when_grant_still_active`（Phase W1.5 固化）。
26. **Listing 回收**：`market::delete_soul_listing` / `delete_collection_listing` 要求 `!is_active`。Test 11.0a / 11.0b 正向回收；负向 `EListingStillActive` 走 `protocol_tests.move::delete_soul_listing_aborts_when_active`（Phase W1.5 固化）。
27. **KioskRegistry insert-or-assert + rebind 全矩阵**：`ensure_personal_kiosk_registered` 是唯一现有 kiosk 登记入口，同 cap 幂等、不同 cap abort `EPersonalKioskMismatch`。换 kiosk 唯一合法路径 `market::rebind_primary_kiosk`，要求旧 kiosk `item_count == 0`（`EOldKioskNotEmpty` / `EOldKioskMismatch` / `ERebindSameKiosk`）。Test 7.10h 由 Dev 角色 `sui client call` 覆盖；终端用户路径不暴露。
28. **Paid access epoch-pinned**：`KindPaidEntry.ownership_epoch_snapshot` 与 `SoulState.ownership_epoch` 必须相等才有效；Soul 转售后旧 buyer 的 `has_access` 立即翻 false，stale 条目保留作审计；re-purchase 在新 owner 下覆盖 stale 行（TX 成功 + entry 刷新）。`SoulPaidAccessGranted` 事件含 `ownership_epoch_snapshot`；Prisma `soul_paid_access_entries.ownership_epoch_snapshot` / mirror / agent access route 全链路按 `ownershipEpochSnapshot = state.ownershipEpoch` 过滤，stale 直接 403 不触发 Seal round-trip。Test 7.10g 覆盖。
29. **Seal document id 长度严格 `==`**：`content::assert_matching_document_id` 拒绝尾部多余字节；TS SDK `content-document-id.ts` 输出精确字节长度，client-built sidecar 同样满足。
30. **Category → Tags taxonomy**：Create 页无 Category 下拉，Market 页无 category filter，仅 Tags 自由输入 + `/api/souls/tags`（top 50 tag cloud）。Phase 1.2 / 2.7-2.8 / 10 不涉及 Category 断言。
31. **Paid Access API 写路径全链上**：`/api/souls/[id]/access-list/*` Phase 2 已删除；本计划所有 paid-access 写入均经 SDK builder + Node 脚本签 + post-TX mirror（`upsertPaidAccessKindConfig` / `upsertPaidAccessEntry`），不使用 SQL 直写模拟。

32. **CSRF + Same-Origin 强约束**：所有走 cookie auth 的 mutating 路由（以 `web/lib/auth/identity.ts::requireMutationIdentity` / `requireHumanWalletIdentity({ mutation })` 为真值）要求 `x-csrf-token` header 与 session 内 `csrfHash` 匹配，并且 Origin/Referer 与请求 host 同源。E2E `curl` 调用必须同时传 `Cookie: session=...; csrf-token=...` + `x-csrf-token: ...` 两份。`/api/auth/wallet-login` 与 `/api/auth/logout` 还要 `Origin: http://localhost:3100`。Agent API 路径走 `Authorization: Bearer sk-...` 不受影响。

33. **wallet-paid Walrus 上传链路**：`uploadSoulPayload` 在浏览器本地校验、加密、计算 quote，并通过 `UploadCostReview` 要求用户确认 Walrus storage / Sui gas / relay tip 后才发起钱包签名。UI 入口产品上限是 `MAX_SOUL_UPLOAD_BYTES = WALRUS_SINGLE_BLOB_MAX_BYTES = 50 MiB`（`packages/soulidity-sdk/src/upload-validation.ts:10`），文件超过即由 `validateSoulUploadFile` 抛 `File exceeds the 50 MiB upload limit`，不再走 register/certify。SDK 的 `> 50 MiB` 16 MiB chunk + manifest 路径仅供直调消费者（不在 `uploadSoulPayload` UI 触达），quote TTL 60 秒，文件 / 网络 / relay / chunk plan 变化必须重新确认。mainnet 执行需考虑 Phase -1.8 的 Walrus capability probe；本计划的小 fixture（最大 ~5.6 KiB）远低于 50 MiB UI 上限，chunking path 不在 96 项主流程覆盖。`__e2eUpload` 是白盒 helper，会自动 approve quote，不能替代主流程成本确认验收。

34. **e2e-wallet-stub 前置（W0，2026-04-27 已落地）**：`web/components/providers/e2e-wallet-stub.tsx` 已挂在 `app-providers.tsx` development 分支（双门控：`NODE_ENV === 'development'` AND `NEXT_PUBLIC_E2E_TEST_MODE === '1'`）。该桩通过 `localStorage['__E2E_PRIVATE_KEY']` 重建 Ed25519 keypair，注册到 dapp-kit `getWallets()`。Phase -1.5 自检必须打开 dapp-kit ConnectModal，并在 snapshot 中看到 `E2E Test Wallet`；不要用 `navigator.wallets`，仓库没有把 Wallet Standard 列表暴露到该字段。

35. **`scripts/e2e-setup-agents.ts` env-driven**：从 `E2E_AGENT_ALPHA_PRIVATE_KEY` / `E2E_AGENT_ALPHA_API_KEY` / `E2E_AGENT_BETA_PRIVATE_KEY` / `E2E_AGENT_BETA_API_KEY` 派生地址 + 计算 SHA-256，幂等 `findOrCreate` `Account` / `Member(kind='agent', agentStatus='active')` / `WalletBinding(chain='sui')`。两次连续运行得到相同 member ID 与 hash。

36. **dev server 加载 `.env.e2e`**：mainnet E2E 推荐用 `set -a; . ./.env.e2e; set +a; CLAWNEWS_LOAD_ENV_LOCAL=false npm --prefix web run dev -- --port 3100`，避免污染本地 `.env.local`。`.env.e2e` 包含 `MAINNET_DEPLOYER_PRIV_KEY` / `AUTH_SECRET` / mainnet `DATABASE_URL` / Seal mainnet config 等所有必填字段；含 JSON 的值必须用 shell-safe 单引号包裹。

37. **Client-built Seal sidecar 契约（Phase 2 unified content）**：`/api/souls/publish` / `publish/batch` 等 mirror 路由的 request body 携带 `contentSidecars: ContentSidecarRequestEntry[]`；`buildSyncSealSidecars()` 用 `isContentDocumentIdForVersion(documentId, { contentObjectId, kind, name, versionIndex })` 精确校验，任意失败抛 `SealSidecarSyncConfigError`。`window.__e2eLastSealMaterial` 只给 Test 5.3b 作为预期 artifact / hash / 文件名证据，不能作为 API body 直接提交，也不能作为解密密钥；raw DEK envelope string 必须返回 400。

38. **SDK 抽包（Phase 2，commit 6c55b59）**：所有 tx builder / kind 常量 / event 解析 / Walrus quote 都从 `@soulidity/sdk` import；旧 `web/lib/soulidity/tx/*` 路径已迁出。本计划文档引用一律用 `packages/soulidity-sdk/src/...` 绝对路径或 `@soulidity/sdk` 别名。

39. **Move test 名称固定**：Phase 5.8 / 7.10d / 7.10e / 7.10j / 11.0a 的负向断言只允许使用验证标准中列出的 fixed test names。若任一 fixed name 在 Phase -1 前不存在，说明 Phase W1.5 未完成，必须先修 plan / Move test 基线并重新验证；mainnet 测试运行中途禁止重新 grep test 名、改名代入、新增 negative test，或把本地 Move test 延后到写链阶段才首次执行。

---

## 验证标准（Phase 2 mainnet）

默认验收口径：
- Phase -1 仅作为环境准备单独记录，不计入通过率
- 96 项主流程全部通过
- 全部主验收必须以 **无 skip / 无 try-catch 吞错 / 无降级断言 / 无白盒绕过** 通过；任意一项的修复路径必须落到代码或 plan 文档，留下 git commit + result 文档记录（详见"测试纪律"段第 5 步）
- 调用顺序必须按轻重分层执行：Phase W1.5 的 4 条 fixed negative Move tests + Test 7.10j local Move proof、Phase 0、Test 10.1-10.5 在 mainnet 写链 TX 前完成；Test 4.3-4.3c 与 Test 10.6 在 Buyer 登录后、购买 TX 前完成；quote / dry-run / dev-inspect 类测试必须先于对应写链 TX。
- Test 7.10a 必须完成 `price_atomic > 0` 的 paid purchase（Buyer 用 Node 脚本签，付款 recipient 为 Agent Alpha owner），并在 DB `soul_paid_access_entries` 中看到 `ownership_epoch_snapshot` 与 `SoulState.ownership_epoch` 一致
- Tests 7.10d / 7.10e / 7.10j / 5.8 step 5 / 11.0a step 4 的负向断言全部引用 Phase W1.5 前置执行的 `sui move test <fixed name>` 固化日志，分别为 `purchase_paid_access_aborts_when_price_zero` / `configure_paid_access_kind_rejects_scope_mismatch` / `owner_cannot_purchase_paid_access` / `destroy_invalidated_grant_aborts_when_grant_still_active` / `delete_soul_listing_aborts_when_active`，输出对应 test name + `[ PASS    ]` + `Test result: OK. Total tests: 1; passed: 1; failed: 0`；abort code 以 `protocol_tests.move` 中的 `#[expected_failure(abort_code = ...)]` 注解为准。4 条 fixed negative tests 与 7.10j local proof 由 Phase W1.5 一次性前置留证，**不允许 mid-run 重新 grep、改名代入、新增 Move test，或把本地 Move test 延后到 mainnet 写链过程中才首次执行**。
- Test 7.10f KindPaidConfig duration 生命周期通过 Phase W1.3 要求的 `web/scripts/e2e-paid-access-lifecycle.ts` 的 set-config / inspect-access / update-config / purchase 子命令完成
- Test 7.10g epoch 跨转让 + re-purchase 覆盖必须同时验证：转售后 `has_access = false` + DB stale 行保留 + re-purchase 成功后 entry 覆盖（`ownership_epoch_snapshot` 刷新到新值）；step 1 必须走 `web/scripts/e2e-relist-soul.ts`（包装 `buildListSoulTx`），不得用 inline `npx tsx -e` PTB
- Test 7.10h KioskRegistry rebind 全矩阵必须覆盖：同 cap 幂等（no-op）/ 不同 cap abort / 非空旧 kiosk abort / 正向 rebind
- Tests 7.10i/j/k：`paid_access::add_access` 免费授权 + owner 自购 dry-run abort `EPaidAccessOwnerCannotPurchase` + `paid_access::revoke_access` 主动召回三段全部跑通；7.10j 的 local Move proof 引用 Phase W1.5 前置日志，mainnet 阶段必须走 dry-run，**不允许**真实发 TX 测试
- Tests 5.2c-d-e：grant_capacity = 2 真正承载第 2 个 grant（Beta，scope_mask=4）+ 第 3 个 grant 触发 `EGrantCapacityExceeded` + Beta revoke 恢复 5.4 前置；任一缺失视为未覆盖
- Test 4.4a：`quote_soul_purchase` dev-inspect 输出与 Test 4.4 UI receipt 完全一致（atomic 单位）；不一致即按"测试纪律"流程定位前端 mirror / 后端 quote 偏离的根因
- Test 4.5a：`buy_soul_fixed_price_with_collection` 成功，三层抽成（platform_fee 2500 + creator_royalty 5000 + collection_royalty 5000，atomic 数字）均出现在 `SoulPurchased` 事件；buyer total = 112500。`SoulPurchased` 不含 `seller_proceeds` 字段，禁止把不存在字段作为硬断言。
- Test 11.0c：`cleanup_stale_entries` 由 Dev 调用 success；调用前必须存在 stale-epoch paid-access entry，调用后 DB stale 行数至少减少 1。Dev gas 余额只作辅助记录，不作为硬通过条件
- Phase 5.2 / 5.6 grant 发放 & 撤销全部走 GrantModal UI；Phase 5.2a 容量调整走 `window.__e2eSoulidity.setGrantCapacity`（helper 内部已 mirror）；Phase 5.8 destroy_invalidated_grant 走 `sui client call`（CLI active-address 必须为 `GRANT_OBJ` 持有者，本流程为 Agent Alpha）
- Test 5.3a-b Seal grant 链路必须跑通：Buyer owner 通过 GrantModal 给 Agent Alpha 授权 Soul A 后，`e2e-agent-decrypt.ts` 用 Agent Alpha Bearer + 私钥完成 granted-agent Seal 解密并输出 SOUL_DOC content hash 匹配；`e2e-agent-verify-content.ts` 必须由 Agent Alpha granted-agent Seal session 对 `char` / `memory` 两个初始 artifact 完成逐字节比对并输出 `OK 2 artifact(s) matched byte-for-byte.`，脚本不足时先按 Phase W1.4 修源后再跑
- Phase 1 / 3 / 6（如保留）/ 8 所有 UI 上传都必须实际出现并确认 `UploadCostReview`；确认前不得出现 Walrus register/certify 或 Soul mint/list/append TX 签名
- Phase -1.8 必须记录 mainnet Walrus relay tip-config；如果 relay 不可达，按"测试纪律"流程定位后修源（不能继续声称 wallet-paid upload 已通过）。`> 50 MiB` live smoke 属于独立 Walrus capability 验收，不纳入本计划 96 项主流程证据。
- Phase 9 主验收只保留 9.1-9.6（agent auth / 404 / 403）；9.7-9.10 已删除（路由 / 脚本 / UI 路径不存在）
- 截图存档到 `$ARTIFACT_DIR`（默认 `e2e-artifacts/<RUN_DATE>/`）
- 测试结果更新到 `docs/e2e-test-results-new-web.md`，新增或更新当前 `2026-05-05 Run` 段（mainnet）；包含每个失败的根因 + 修复 commit + 重测结果
- Repo guard 必须保持：用户上传 UI / 核心 upload helper 不引用 `/api/souls/upload*`、`@vercel/blob/client`、`sealDekEnvelope`、raw envelope submit；生产用户上传 env 不依赖 `WALRUS_PUBLISHER_URL`、`SOUL_UPLOAD_SECRET`、`BLOB_READ_WRITE_TOKEN`
- Phase 11 cleanup 完成后：market 恢复空状态；DB `soul_assets` / `soul_content_version_records` / `soul_paid_access_entries` / `soul_paid_access_kind_configs` / `soul_grant_records` 为空，E2E 创建的 Soul bookmarks 随 `soul_assets` 级联消失；`follows` 不作为 cleanup 全表清空目标。Soul A 的 SoulListing 与 Collection 的 CollectionListing 对象均 `Object has been deleted`
- 所有 mutating cURL 必须同时携带 `Cookie: session=...; csrf-token=...` + `x-csrf-token` header；缺任一返回 403（环境失败，非业务失败，按"测试纪律"流程修源）
- W0 已完成但每次运行仍需在 Phase -1.5 自检：确认 `NODE_ENV=development`、`NEXT_PUBLIC_E2E_TEST_MODE=1` 且 `e2e-wallet-stub.tsx` 已挂载（否则 Test 1.1 会卡在 ConnectModal，不能算业务失败）
