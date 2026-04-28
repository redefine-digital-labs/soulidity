# new-web E2E 全自动测试计划 — Soulidity Marketplace

## Context

`web/`（Next.js 16 + React 19，port 3100）是 Soulidity 唯一的 web 前端，替代 legacy `web/`（原 port 3000）。本计划覆盖 Soul 全生命周期：创建 → 上架 → 购买 → Grant → 访问 → Skills → Memory → 解密，以及 Collection / Import。

**最近一次执行（2026-04-28）：96/96 主验收 PASS**。本次按 `.env.local` 测试环境、Sui Testnet 地址、Chrome DevTools MCP 浏览器流程执行，覆盖 wallet-paid Walrus `UploadCostReview`、Seal 私有内容、Agent API、ContentAccess、Import、公共 sprite 匿名访问和 Cleanup。详细对象 ID / TX 摘要见 `docs/e2e-test-results-new-web.md` 的 `2026-04-28 Run` 段。这里的“主验收”指 main-flow acceptance，不是 Sui mainnet 验收；当前文档只能证明 web testnet 主流程通过，不能证明 mainnet runtime 已无问题。2026-04-27 PASS 是 wallet-paid Walrus cutover 前的历史基线，仍保留在结果文档中用于对照；原执行台账曾将 Test 9.10 单列，本计划已把 9.10 并入 Phase 9 主验收，不再保留待办 / 延期测试项。

**当前部署基线（2026-04-24 fresh publish，Published.toml `version = 1`）**

合约整体 fresh publish，**无 upgrade 路径**。所有 on-chain ID、kiosk 注册、历史 listings / access list / grant 均从零起步，DB 需配合清空。`deployment-manifest.json` 与 `Published.toml` 均以本次发布为权威源；**旧 packageId / kioskRegistryId / upgradeCapId 不可复用**。

| 字段 | 当前 testnet 值 |
|------|----------------|
| `packageId` | `0x0b79af1ffb805632236370bba9539aacbb8f917e4a26a2761bc189f193b95205` |
| `marketConfigId` | `0x252255abd42007f0a2b3fad596c7b0705f19979436ed043fb24f2047050827fe` |
| `kioskRegistryId` | `0xec8c87496f40c640411f8b4b0ee76d5b171de4fcf5aa49062ba7db4c1a15e30c` |
| `soulTransferPolicyId` | `0x5e5711e21db5e445c03a59154bcb1fd889efc111cd42180f28c7a3adbe9ae92f` |
| `collectionTransferPolicyId` | `0x97bf30a371ab12bd3184357cb69dd0ec8c1503ab730390166c4279173a8851db` |
| `upgradeCapId` | `0xa7dee4f2413c40f4a3210e958651706d3fe6d61983911e5689a6c02226b6ff9b` |
| `upgradeStateId` | `0x616117e725110550e03490bf189e0c5a9a01c2383e819eff2092b58560355f2c` |
| `paymentCoinType` | `…::usdc::USDC`（见 deployment-manifest.json） |
| `publishTxDigest` | `HKenfarHCL6jnrqS2CosAkVNc7zBTTVXfpby5RB62i7r` |

权威文件：`web/lib/soulidity/deployment-manifest.json` + `move/soulidity/Published.toml`。任何测试脚本 / 断言引用的 ID 必须与此一致；旧计划中的 `0x65898551…` / `0x51c3c0b…` / `0x7fd33aedd…` 等 ID 已全部作废。

**本基线包含的安全审计全集**（已在 fresh publish 中固化，不再分期）

- **市场与付款**：`market::purchase_content_access` 要求 `price_atomic > 0`（`EContentAccessNotPurchasable = 28`）+ 双向校验 `state.access_list_id == object::id(access_list)`（`EAccessListLinkageMismatch = 29`）；付款发给 `soul::current_owner(state)`（非固定 creator），含平台抽成（`market::quote_content_access_purchase`）。免费 access 仅 owner 通过 `content_access::add_access` 发放。
- **KioskRegistry 独立共享对象**：`insert_or_assert_personal_kiosk_registration` 幂等 insert-or-assert；换 kiosk 唯一合法路径 `market::rebind_primary_kiosk`，要求旧 kiosk 为空（`EOldKioskNotEmpty = 31` / `EOldKioskMismatch = 32` / `ERebindSameKiosk = 33`）。rebind 只面向运维 / 测试脚本（SDK 提供 `buildRebindPrimaryKioskTx`、Test 7.10h 走 `sui client call`），终端用户路径不暴露。
- **Grant 容量 + 僵尸回收**：`grant::set_grant_capacity(state, capacity, clock, ctx)`（owner-only，带上限 `MAX_GRANT_CAPACITY`）；`grant::destroy_invalidated_grant(grant, state, clock, ctx)` 要求 epoch mismatch / 不在 active_grants / 已过期任一条件，新事件 `SoulGrantDestroyed`，错误码 `EGrantStillActive = 16`。`SoulGrant` 是 owned object，交易 sender 必须持有该对象。
- **Listing 回收**：`market::delete_soul_listing` / `delete_collection_listing` 要求 `!is_active`（`EListingStillActive = 30`），事件 `SoulListingDeleted` / `CollectionListingDeleted`。
- **Scope mask 校验**：`grant::assert_valid_scope_mask` 导出供 `content_access::create` 复用。`default_scope_mask` 必须是 `SCOPE_SEAL|MEMORY|SKILLS|ASSETS = 15` 的非零子集；非法传值 abort `EEmptyScopeMask (10)` / `EGrantInvalidScopeMask (13)`。SDK publish/import/personal-join builder 默认兜底 `ALL_ACCESS_SCOPES = 15`。
- **ContentAccessList.duration**：`default_access_duration_ms: Option<u64>`；`record_purchase` 按 `now + duration` 写 `expires_at_ms`，`set_content_access_duration` 允许 owner 随时调整，事件 `ContentAccessDurationUpdated`。
- **Seal 文档 ID 长度严格 `==`**：`seal_policy` / `skills` / `assets` 的 `assert_matching_document_id`；TS SDK 已输出精确字节长度，无客户端变更。
- **ENotOwner 归一**：`content_access` 所有 owner 校验走单一错误码 `ENotOwner`（`ENotCreatorOrOwner` 作废）。

**本基线的结构性变化（合约层架构级）**

1. **SoulMetadata 作为 presentation truth（shared object）**
   - 新模块 `move/soulidity/sources/metadata.move`（296 行）：`SoulMetadata` 在 mint 内自动 `metadata::create()` + `share_metadata()` shared 出来，持有 `active_sprite: Option<AssetBinding>` / `active_voice: Option<AssetBinding>` / `ext: Table<String, vector<u8>>`。
   - `SoulState.metadata_id: Option<ID>` 引用该对象；运行时 persona / voice selector 皆经由 SoulMetadata。`soul::metadata_ref` 与外部 metadata JSON 彻底下线。
   - Public 函数：`metadata::set_active_sprite` / `clear_active_sprite` / `set_active_voice` / `clear_active_voice` / `upsert_metadata_blob` / `delete_metadata_blob`。
   - 事件：`SoulMetadataCreated` / `SoulMetadataSpriteUpdated` / `SoulMetadataVoiceUpdated` / `SoulMetadataBlobUpserted` / `SoulMetadataBlobDeleted`。
   - 新 API：`POST /api/souls/[id]/metadata`（`requireHumanWalletIdentity` + `txDigest` → 从链上读事件 → upsert 到 `SoulAsset.metadataOnChainId` 及 sprite / voice 绑定字段）。
   - `SoulAsset` 新增列：`metadataOnChainId @unique`、`activeSpriteAssetName/VersionIndex/DownloadPolicy`、`activeVoiceAssetName/VersionIndex/DownloadPolicy`、`spriteConfigJson`、`spriteMoodMapJson`、`voiceConfigJson`（migration `20260423120000_hard_cut_soul_metadata_onchain_object`）。

2. **Mint 签名重写（market.move `mint_native_in_personal_kiosk` / `mint_imported_in_personal_kiosk` / `mint_joined_in_personal_kiosk<T>`）**
   - 在原 `asset_*` 组之后，新增 10 个 persona-sprite / voice / content-access 参数，顺序：
     ```
     initial_sprite_asset_name: Option<String>
     initial_sprite_version_index: Option<u64>
     initial_sprite_download_policy: Option<u8>
     initial_sprite_config: Option<vector<u8>>
     initial_sprite_mood_map: Option<vector<u8>>
     initial_voice_asset_name: Option<String>
     initial_voice_version_index: Option<u64>
     initial_voice_download_policy: Option<u8>
     initial_voice_config: Option<vector<u8>>
     content_access_price_atomic: u64
     content_access_default_scope_mask: u64
     content_access_default_duration_ms: Option<u64>
     creator_royalty_bps: u16
     ```
     （sprite 5 项 + voice 4 项 + content_access 3 项 + royalty，见 `web/lib/soulidity/tx/publish.ts:179-214`）。SDK builder 已全量适配；`ALL_ACCESS_SCOPES = 15` 兜底。
   - 任何绕过 `web/lib/soulidity/tx/` SDK 的直接 PTB 调用必须同步插入这些参数。

3. **ContentAccessEntry epoch-pinned（content_access.move）**
   - `ContentAccessEntry` 新增 `ownership_epoch_snapshot: u64`；`has_access(self, state, addr, required_scope, clock)` 签名扩 `&SoulState` 参数，epoch 失配直接返回 false。
   - `record_purchase` / `add_access` 的 renewal 分支把 stale-epoch 条目视作可覆盖（前买家转售后可在新 owner 下 re-purchase 写回新 epoch）。
   - `seal_approve_skill_allowlisted` / `seal_approve_asset_allowlisted` 透传 `&SoulState` 做 epoch 比对。
   - `ContentAccessGranted` 事件扩展 `ownership_epoch_snapshot`、`expires_at_ms`、`default_access_duration_ms`。
   - Prisma `ContentAccessRecord.ownershipEpochSnapshot Int`（migration `20260423130000_content_access_epoch_snapshot`）；mirror / `/api/souls/[id]/access-list/add|purchase|revoke` / `asset-version-access.ts` / agent access route 统一过滤 `ownershipEpochSnapshot = state.ownershipEpoch`，stale 条目在 Seal round-trip 之前 403。

4. **`/api/souls/[id]/access-list/*` 改为 TX-digest 同步路由**
   - `add` / `purchase` / `revoke` 三个子路由统一 `requireHumanWalletIdentity` + `parseRequiredTxDigest` + `assertTransactionSender`，从链上读事件再 upsert DB。**旧计划中"DB 直接 INSERT / UPDATE 模拟"的路径不再有效**（仍然可写 DB，但会与链上事件 + owner epoch 不同步，违反 post-TX 单向写入的不变量）。
   - 本计划的 content-access 断言必须通过真实链上 TX（`window.__e2eSoulidity.purchaseContentAccess` 或 `sui client call content_access::add_access` / `revoke_access`）触达；验证通过 `GET /api/souls/[id]/access-list`。

5. **Move 协议测试基线**：`protocol_tests.move` 149 项全绿；web vitest soulidity 套件（events / mirror / access / sync-helpers / tx-builders / events-asset-delete）221 项全绿。

**本基线的运行时 / 协议外架构变化（2026-04-26 HEAD）**

6. **Privy 完全下线，Sui 钱包签名 + Session Cookie + CSRF（commit 19ca835）**
   - 浏览器登录：dapp-kit `ConnectModal` → 选钱包 → `POST /api/auth/wallet-challenge { address }` 拿 nonce + 5min 过期 message → `useSignPersonalMessage` 签 → `POST /api/auth/wallet-login { address, signature, nonce }` 写 `session` + `csrf-token` cookies。
   - **E2E 自动化前置（W0，2026-04-27 已落地）**：`web/components/providers/e2e-wallet-stub.tsx` 已实现并在 `web/components/providers/app-providers.tsx` 的 development 分支挂载。`localStorage.setItem('__E2E_PRIVATE_KEY', <bech32>)` + reload → 桩自动注册到 dapp-kit → ConnectModal 列出 "E2E Test Wallet" → 桩接管 sign-message / sign-transaction，0 popup。切换角色 = 改 localStorage + reload。
   - 浏览器 API 鉴权：cookie `session`（HS256 JWT，AUTH_SECRET 签，30d，HttpOnly + SameSite=Lax + Secure(prod)） + header `x-csrf-token`（双提交，cookie `csrf-token` 64 hex）。所有调用 `web/lib/auth/identity.ts::requireMutationIdentity(request)` / `requireHumanWalletIdentity({ mutation })` 的 cookie-auth 写路由强制 CSRF + 同源 Origin/Referer；header-based agent 路径不变（仍 `Authorization: Bearer sk-...`）。
   - Env：移除 `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_CUSTOM_AUTH_*`；`AUTH_SECRET` 签 human session JWT，desktop token 仍可按 `web/lib/desktop/auth.ts` 回退到 `SOUL_UPLOAD_SECRET`。
   - DB：`accounts.privy_did` 删除，新增去规范化列 `accounts.wallet_address` + 表 `WalletChallenge`。`wallet_bindings` 不变。
   - Hook：`usePrivySuiSign` → `useWalletSign`（`web/lib/hooks/use-wallet-sign.ts`）；`useGenericLogin` → `useLogin`（`web/lib/hooks/use-login.ts`）。

7. **Soul / sprite / skills 上传统一走 wallet-paid Walrus browser upload（2026-04-28）**
   - 旧路由 `POST /api/souls/upload`、`/api/souls/upload/token`、`/api/souls/upload/from-blob` 已退役为 410；不再使用 Vercel Blob staging、服务端 publisher 或 raw DEK envelope。
   - 客户端入口：`web/lib/upload/client-upload.ts::uploadSoulPayload`。Phase 1 / 3 / 6 / 8 所有 Soul / sprite / skills / wrap / collection 大文件都走它；签名前必须先展示 `UploadCostReview` 并由连接的钱包支付 Walrus storage / Sui gas / relay tip。
   - 报价入口：`web/lib/upload/walrus-quote.ts::quoteWalrusUpload`。当前实现 `<= 50 MiB` 单 blob，`> 50 MiB` 自动按 16 MiB chunk + manifest blob 上传；quote 覆盖所有 chunk / manifest 的 Walrus storage、write cost、relay tip 与 register/certify TX 数，TTL 为 60 秒。
   - 私有内容在浏览器内 AES-GCM 加密；`web/lib/upload/client-seal.ts` 只把短期 `PendingSealMaterial` 留给当前会话 / recovery，mirror API 只接受客户端生成的 Seal sidecar object。raw DEK envelope string 直接 400。
   - Persona Asset Panel：`web/components/souls/persona-asset-panel.tsx`（owner-only sprite 版本管理：append + activate + delete + clear，一笔 PTB = `assets::append_version` + `metadata::upsert_metadata_blob` + `metadata::set_active_sprite`）。
   - Collection/profile cover 也走 `uploadSoulPayload(..., 'public')`；legacy `/api/collections/upload-image` 和 `/api/profile/cover` 已退役为 410。

8. **新 mirror 路由 `POST /api/souls/[id]/grant-capacity`（commit 107ab0d）**
   - 接 `txDigest` → 链上读 `GrantCapacityUpdated` 事件 → upsert `soul_assets.grantCapacity` / `activeGrantCount`。`window.__e2eSoulidity.setGrantCapacity` 已在内部调用此路由（`e2e-wallet-helpers.tsx:148`），Phase 5.2a 不需要再单独 cURL。

9. **匿名 sprite 公共下载 E2E（commit 08e2d73）**
   - 脚本 `web/scripts/e2e-public-sprite-anonymous.ts`：未登录 / 错 Bearer 也能下载 public sprite + 字节比对。Phase 9.10 固化。

10. **Nav 顺序（commit 5f4f85c）**
    - `web/components/nav/navbar.tsx`：Docs 挪到 `+ New` 菜单之后（与 Admin 同列）。无功能影响。

**全自动执行：** 本计划设计为 AI agent 独立可执行，零人工判断（除 Phase -1.3 一次性 SUI 转账）。自动化覆盖：
- **浏览器交互** — Chrome DevTools MCP（snapshot → uid → click/fill/upload）
- **链上状态发现 + USDC mint** — `sui client` CLI（balance / objects / call / mint）
- **API + DB 验证** — `curl` / SQL / `npx tsx` 脚本
- **TX 签名** — W0 完成后由 E2E Wallet Stub 接管浏览器钱包签名（dev-only Wallet Standard 实现，0 popup）；Agent 侧 TX 由 `web/scripts/e2e-agent-purchase.ts` 通过 `AGENT_PRIVATE_KEY="$E2E_AGENT_*_PRIVATE_KEY"` 在 Node 直接签

**手动介入预设：1 次（仅 SUI gas 补给）。** Phase -1.3 由 AI 列出 4 个测试地址的"缺多少 SUI"清单并暂停；用户从自有钱包转入后回告"已转完"，AI 继续。USDC 由 AI 自动 mint（`sui client switch` 到 Treasury Owner → `sui client call ... mint`），无需用户介入。W0 完成后，测试运行时（Phase 0 onwards）0 介入：钱包签名由 dev-only `e2e-wallet-stub.tsx`（Wallet Standard 实现）接管，切角色靠 `localStorage['__E2E_PRIVATE_KEY']`。
**测试 Fixture：** `/Users/admin/Documents/example`（单 Soul）+ `/Users/admin/Documents/example-collection`（Collection）。当前 fixture 不含 persona sprite / voice；Phase 1 默认 sprite 与 voice 留空（均为 Option，可全空），Phase 1.8 仅断言 `metadataOnChainId` 非空 + `activeSprite* / activeVoice*` 为 null。
**总计：96 个测试项，14 个 Phase（0-11，含 Phase 6.5 / 7.5；Phase -1 为环境准备，不计入总数）**

**价格 / Scope 约束（合约层硬性保障，SDK 默认值兜底）**

- `Soul` 的 listing price 必须严格大于 `0`（sell UI 前置拦截 + `market::EInvalidPrice` 后置拦截）。
- `market::purchase_content_access` 要求 `price_atomic > 0`（`EContentAccessNotPurchasable = 28`）；免费 access 仅 owner 通过 `content_access::add_access` 发放。本计划中所有 paid purchase 用例使用正数价格；`0` 价不再是合法测试路径。
- `ContentAccessList.default_scope_mask` 必须是 `SCOPE_SEAL(1) | SCOPE_MEMORY(2) | SCOPE_SKILLS(4) | SCOPE_ASSETS(8) = 15` 的非零子集。所有 mint 用例传 `ALL_ACCESS_SCOPES = 15`（SDK `publish.ts` / `import.ts` / `personal-join.ts` / desktop `publish.ts` 兜底）。绕过 SDK 传 0 或含无效位时 `grant::assert_valid_scope_mask` abort `EEmptyScopeMask` / `EGrantInvalidScopeMask`。

---

## 执行约束（全自动 + Chrome DevTools MCP）

### 全自动执行原则

本计划的设计目标是**零人工判断执行**。除 Phase -1.3 一次性 SUI gas 转账外，所有步骤均可由 AI agent 独立完成：

| 操作类型 | 自动化方式 | 人工介入 |
|----------|-----------|---------|
| 浏览器交互 | Chrome DevTools MCP（snapshot → uid → click/fill/upload） | 无 |
| 链上状态发现 | `sui client balance` / `sui client objects` / `sui client gas` | 无 |
| 测试 USDC 补给 | `sui client switch` Treasury Owner + `sui client call ... mint` | 无 |
| SUI Gas 补给 | AI 列清单暂停等用户从自有钱包转账 | **Phase -1.3 一次性** |
| TX 签名 | W0 完成后由 e2e-wallet-stub 接管浏览器签名；Agent Node 脚本用 `AGENT_PRIVATE_KEY` 本地签名 | 无 |
| Agent API 调用 | `curl` + `npx tsx` 脚本 | 无 |
| DB 验证 | SQL 查询 | 无 |

**失败自动处理：** 每步有明确 pass/fail 判据；失败时自动 `take_screenshot` 存档后继续或中止。

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
2. `take_snapshot`，断言弹窗含当前网络（本计划为 `testnet`）、Payload、Storage、Transactions、WAL storage、Relay tip、Gas budget estimate。
3. 当前小 fixture 每个文件应显示 `Storage = 3 epochs`、`Transactions = 2`；若引入 `> 50 MiB` fixture，则必须看到 chunk item 与 manifest item，且 transaction count = `(chunkCount + manifestCount) * 2`。
4. 点击 `Confirm`。如果点击 `Cancel` 或 quote TTL / 文件 / 网络 / relay / chunk plan 变化，上传应在签名前失败并要求重新确认；这类负向由 unit/repo guard 覆盖，不计入 96 项主流程。
5. 同一操作会按上传文件数重复弹窗；每次页面变化后重新 `take_snapshot`，不要复用旧 `uid`。

### Testnet Walrus 上传限制口径

- Walrus 协议最大 blob size 不是本计划的直接 E2E 上限；按官方文档，真实值应以 `walrus info --context testnet` 查询为准，文档当前示例口径是 13.3 GiB。ClawNews 产品层仍限制 `MAX_SOUL_UPLOAD_BYTES = 500 MiB`。
- Testnet 公共 upload relay / publisher 是外部服务，可能因 HTTP body size、rate limit、relay tip freshness、storage node 状态或 413/429/5xx 临时失败而低于协议上限；这属于 testnet infra limitation，不等同产品合约失败。
- 96 项主流程只使用小 fixture（最大约 5.6 KiB，Phase 9.10 sprite helper 约 7.9 MiB），不把 `> 50 MiB` live upload 绑定到 testnet 公共服务稳定性。`> 50 MiB` chunk + manifest 行为由 unit/repo guard 固化；若需要 live 大文件 smoke，必须先通过 Phase -1.8 的 testnet Walrus capability probe。
- Phase 9.10 的 `e2e-sprite-lifecycle.ts` 是白盒 helper，当前仍走 `web/lib/services/walrus.ts` publisher path，不代表用户 UI 的 upload relay path；如果 publisher 返回 413，只能换小 fixture / 下采样 sprite / 配置已验证 publisher，不允许把该失败归因到 wallet-paid UI 上传主链路。

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
| `skill.zip` | 5.6K, ZIP 含 SKILL.md frontmatter | Skills Bundle |

### Collection — `/Users/admin/Documents/example-collection/`

| 文件 | 大小 | 用途 |
|------|------|------|
| `soul-collection-template.xlsx` | 6.2K | Collection 元数据模板（Soul Name, Description, Category, Tags, Royalty） |
| `1/soul.md` | 1K | 子文件夹 Soul Character |
| `1/memory.md` | 1K | 子文件夹 Memory |
| `1/images.jpeg` | 4.8K | 子文件夹 Cover |
| `1/skill.zip` | 5.6K | 子文件夹 Skills |

---

## Agent API 迁移方案（已完成 ✅）

> 实现于 2026-04-03，7 个新文件 + 1 个测试文件，1028 tests pass。

### 架构

Agent API 路由在 `web/app/api/agent/` 下，通过 `requireAgentWalletIdentity` 中间件认证，走 Soulidity Grant 体系（而非旧 allowlist）。

### Agent API 路由清单

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/agent/souls/search` | GET | 搜索 listed Soul（q, category, limit, offset） |
| `/api/agent/souls/[id]` | GET | Soul 详情 + 购买报价 |
| `/api/agent/souls/[id]/access` | GET | Seal 访问 — owner 或 granted-agent |
| `/api/agent/souls/[id]/purchase` | POST | 准备购买 TX（返回未签名 txBytes + preparedPurchaseId） |
| `/api/agent/souls/[id]/purchase/execute` | POST | 提交签名执行购买 + mirror 同步 |
| `/api/agent/souls/[id]/skills/[skillName]/versions/[versionIndex]/access` | GET | Skills Seal 访问 |
| `/api/agent/souls/[id]/memory/[entryKey]/access` | GET | Memory Seal 访问 |

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
  → resolveSoulAccessPayload(soul, agentWalletAddresses)
  → 自动匹配: owner? → seal_approve_owner
                 activeGrants 含对应 scope? → seal_approve_*_granted_agent
  → 返回 SoulAccessResponse
```

核心：**Agent 访问 Soul 的前提是 owner 已通过 `useGrant().issueGrant()` 给 agent 钱包地址发放 SoulGrant；GrantModal 默认发放 `seal|memory|skills|assets = 15`，各 API 再按资源类型校验对应 scope。** 无需额外 allowlist 表。

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
  → syncSoulProjectionFromChain + endActiveSoulGrantProjections
  → 缓存结果到 SoulPreparedPurchase + SoulTxSync
  → 返回 { digest, soulOnChainId, currentOwnerAddress, ... }
```

---

## 测试账号

### 角色定义（钱包 = 本地 Ed25519 keypair env，浏览器侧由 W0 e2e-wallet-stub 注入）

| 角色 | 浏览器登录 | API 调用 |
|------|-----------|---------|
| Seller | stub（`localStorage['__E2E_PRIVATE_KEY'] = $E2E_SELLER_PRIVATE_KEY`） → ConnectModal 选 "E2E Test Wallet" | session cookie + `x-csrf-token` |
| Buyer | 同上，切 `$E2E_BUYER_PRIVATE_KEY` + reload | session cookie + `x-csrf-token` |
| Agent Alpha | 不进浏览器 | `Authorization: Bearer $E2E_AGENT_ALPHA_API_KEY` |
| Agent Beta | 不进浏览器 | `Authorization: Bearer $E2E_AGENT_BETA_API_KEY` |

> Agent 购买 / 解密脚本当前读取通用 env：`AGENT_PRIVATE_KEY`（或 `AGENT_MNEMONIC`）+ `AGENT_API_KEY`。本计划统一用 `AGENT_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY"` / `AGENT_PRIVATE_KEY="$E2E_AGENT_BETA_PRIVATE_KEY"` 映射，避免继续依赖 mnemonic。

### Sui CLI 速查（地址发现 + 余额检查 + WAL / USDC mint）

> 前提：`sui client active-env` = testnet，`sui --version` >= 1.69.0

| 命令 | 用途 |
|------|------|
| `sui client active-address` | 当前活跃地址（USDC mint 需为 Treasury Cap owner） |
| `sui client balance <addr>` | 全币种余额 |
| `sui client balance --coin-type "0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325::usdc::USDC" <addr>` | USDC 余额 |
| `sui client balance --coin-type "0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL" <addr>` | WAL 余额（wallet-paid Walrus register/certify 需要） |
| `sui client gas <addr>` | SUI gas coin 列表 |
| `sui client objects <addr>` | 所有拥有的对象（含 kiosk、Soul 等） |
| `sui client switch --address <addr>` | 切换 active address（USDC mint 前切到 Treasury Owner） |

### WAL 测试网包（wallet-paid Walrus 必需）

| 属性 | 值 |
|------|---|
| Coin Type | `0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL` |
| 来源 | 当前 testnet Walrus package 的 `staking::stake_with_pool` 入参解析；若 Walrus package 升级，先按 `@mysten/walrus` 当前 package config 重新派生 |

WAL 用于 `uploadSoulPayload` 里的 Walrus storage / write cost；SUI 只覆盖 gas 与 upload relay tip，不能替代 WAL。Phase 1 / 3 / 6 / 8 的所有 `UploadCostReview` 都必须在 signer 钱包 WAL 余额充足时执行，否则 register blob TX 会在签名前或 dry-run 阶段失败。

### USDC 测试网包（自动 mint 用）

| 属性 | 值 |
|------|---|
| Package | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325` |
| Module | `usdc` |
| Coin Type | `0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325::usdc::USDC` |
| Treasury Cap | `0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184` |
| Treasury Owner | `0x76fd52cac79bda80806be6b5ab7f3b1f099a966203cce809254919a7ab755728` |
| Decimals | 6（1 USDC = 1,000,000 atomic units） |

**Mint 命令模板：**
```bash
sui client call \
  --package 0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325 \
  --module usdc --function mint \
  --args 0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184 \
         <AMOUNT_ATOMIC> <RECIPIENT_ADDR> \
  --gas-budget 10000000
```

**敏感变量（仅本地 shell / direnv 注入，不写入仓库）：**
- `E2E_SELLER_PRIVATE_KEY`（Sui Ed25519，bech32 / base64 / hex 任一格式；由 `scripts/lib/keypair.ts::loadKeypairFromEnv` 解析）
- `E2E_BUYER_PRIVATE_KEY`
- `E2E_AGENT_ALPHA_PRIVATE_KEY`（Agent Alpha 本地签购买 TX 用）
- `E2E_AGENT_ALPHA_API_KEY`（`sk-…`，Agent API auth）
- `E2E_AGENT_BETA_PRIVATE_KEY`
- `E2E_AGENT_BETA_API_KEY`
- `AUTH_SECRET`（本计划要求显式设置；签 session JWT，≥32 字节随机）

### 钱包地址自动派生

```bash
node --input-type=module - <<'NODE'
const pairs = [
  ['SELLER_ADDR', 'E2E_SELLER_PRIVATE_KEY'],
  ['BUYER_ADDR', 'E2E_BUYER_PRIVATE_KEY'],
  ['AGENT_ALPHA_ADDR', 'E2E_AGENT_ALPHA_PRIVATE_KEY'],
  ['AGENT_BETA_ADDR', 'E2E_AGENT_BETA_PRIVATE_KEY'],
]
for (const [out, env] of pairs) {
  console.log(`export ${out}=$(npx tsx -e "import { loadKeypairFromEnv } from './scripts/lib/keypair'; console.log(loadKeypairFromEnv('${env}').toSuiAddress())")`)
}
NODE
```

执行输出中的 `export ...`，得到 **SELLER_ADDR / BUYER_ADDR / AGENT_ALPHA_ADDR / AGENT_BETA_ADDR**。

**运行时变量（Phase -1 动态发现 + 测试流程中捕获）：**
- `SELLER_ADDR` / `BUYER_ADDR` / `AGENT_ALPHA_ADDR` / `AGENT_BETA_ADDR` — Phase -1.2 DB 查询 + Sui CLI 验证
- `SELLER_MEMBER_ID` — Phase -1.2 记录（Phase 10.6 Follow 用）
- `PACKAGE_ID` / `MARKET_CONFIG_ID` / `KIOSK_REGISTRY_OBJ` / `SOUL_TRANSFER_POLICY_ID` / `COLLECTION_TRANSFER_POLICY_ID` / `UPGRADE_CAP_ID` / `UPGRADE_STATE_ID` — Phase -1.0 从 `web/lib/soulidity/deployment-manifest.json` 读取（值见 Context 表格）
- `SOUL_A_ID` / `SOUL_A_STATE_OBJ` / `SOUL_A_METADATA_OBJ` / `SOUL_B_ID` / `SOUL_B_STATE_OBJ` / `SOUL_B_METADATA_OBJ` / `COLLECTION_ID` — 测试流程中捕获
- `SOUL_A_ACCESS_LIST_OBJ` / `SOUL_B_ACCESS_LIST_OBJ` — Phase 1.6/1.7 DB 查询捕获（ContentAccessList on-chain ID）
- `SOUL_A_INITIAL_SKILL_NAME` / `SOUL_A_INITIAL_SKILL_VERSION_INDEX` — Phase 1.6 publish sync 响应或 DB 查询捕获（Phase 5.3 使用）
- `SOUL_B_FOUNDING_MEMORY_TIMESTAMP_KEY` / `SOUL_B_INITIAL_SKILL_NAME` / `SOUL_B_INITIAL_SKILL_VERSION_INDEX` — Phase 1.7 publish sync 响应捕获（Phase 7.12 使用）
- `SOUL_A_LISTING_OBJ` — Phase 2.2 listing TX 或 Phase 4.5 purchase 后事件捕获（Phase 11.0a 使用）
- `COLLECTION_LISTING_OBJ` — Phase 3.5 list + delist collection right 后捕获（Phase 11.0b 使用）
- `CAPTURED_SEAL_MATERIAL_JSON` — Phase 1.6/1.7 mint/import gas 页在发布成功时立即捕获的 `{char,memory,skills,sprite}` Pending Seal material JSON，Phase 7.12 复用
- `MEMORY_ENTRY_KEY` / `SKILL_NAME` / `SKILL_VERSION_INDEX` — Phase 7.12 访问 memory / skills artifact 时使用，来自 publish/import sync 响应

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

## Phase -1: 环境准备

### -1.0 读取部署 manifest
```bash
cd /Users/admin/Desktop/nao/clawnews
eval "$(node - <<'NODE'
const manifest = require('./web/lib/soulidity/deployment-manifest.json').testnet
const vars = {
  PACKAGE_ID: manifest.packageId,
  MARKET_CONFIG_ID: manifest.marketConfigId,
  KIOSK_REGISTRY_OBJ: manifest.kioskRegistryId,
  SOUL_TRANSFER_POLICY_ID: manifest.soulTransferPolicyId,
  COLLECTION_TRANSFER_POLICY_ID: manifest.collectionTransferPolicyId,
  PAYMENT_COIN_TYPE: manifest.paymentCoinType,
  UPGRADE_CAP_ID: manifest.upgradeCapId,
  UPGRADE_STATE_ID: manifest.upgradeStateId,
}
for (const [key, value] of Object.entries(vars)) {
  if (!value) throw new Error(`Missing ${key} in deployment manifest`)
  console.log(`export ${key}=${JSON.stringify(value)}`)
}
NODE
)"
```
验证：
- `$PACKAGE_ID` 等变量均非空，且与 Context 表格一致
- `move/soulidity/Published.toml` 的 `published-at` / `original-id` / `upgrade-capability` 与 manifest 的 `packageId` / `upgradeCapId` 一致
- `UPGRADE_STATE_ID` 仅来自 `deployment-manifest.json`；`Published.toml` 不记录该 shared object

### -1.1 DB Soulidity 数据 reset（保留账号 / 钱包 / API key）

```bash
cd /Users/admin/Desktop/nao/clawnews
psql "$DATABASE_URL" <<'SQL'
DELETE FROM "soul_grant_records";
DELETE FROM "soul_skill_version_records";
DELETE FROM "soul_memory_entries";
DELETE FROM "soul_asset_version_records";
DELETE FROM "content_access_records";
DELETE FROM "soul_prepared_purchases";
DELETE FROM "soul_tx_syncs";
DELETE FROM "soul_collection_assets";
DELETE FROM "soul_assets";
DELETE FROM "follows";
DELETE FROM "bookmarks";
SQL
```

`scripts/e2e-setup-agents.ts` 现已为 env-driven create-or-update（W0.2 ✅）。需要全库 reset 时按以下顺序执行：(1) `npx prisma migrate reset --schema=prisma/schema.prisma --force --skip-seed`；(2) Seller 通过浏览器 wallet stub 首次登录，写入 `accounts` + `members(kind='human')` + `wallet_bindings`；(3) `npx tsx scripts/e2e-setup-agents.ts` 把 Agent Alpha / Beta 挂在 Seller 的 Account 下。Buyer 同样在首次登录时自动建账。直接 fresh DB → 跑 setup 脚本会因 `E2E_AGENT_OWNER_WALLET`（或 `E2E_SELLER_PRIVATE_KEY` 派生地址）无 `WalletBinding` 行而报错，符合预期。

### -1.2 钱包派生 + 账号初始化（全自动）

**Step 1 — 从 env keypair 派生 4 个地址：**

执行"测试账号"段中的派生 bash，把 `SELLER_ADDR / BUYER_ADDR / AGENT_ALPHA_ADDR / AGENT_BETA_ADDR` 全部 `export` 到当前 shell。

**Step 2 — 校验 / 刷新 Agent 账号（Seller / Buyer 由首次浏览器登录自动建账）：**

```bash
npx tsx scripts/e2e-setup-agents.ts
```

脚本（W0.2 已落地）按 `E2E_AGENT_*_PRIVATE_KEY` 派生地址、`E2E_AGENT_*_API_KEY` 计算 SHA-256，幂等 create-or-update `Account` / `Member(kind='agent', agentStatus='active')` / `WalletBinding(chain='sui')`，并通过 `E2E_AGENT_OWNER_WALLET`（推荐）或 `E2E_SELLER_PRIVATE_KEY` 把 agents 挂在 owner Account 下。通过标准：脚本输出的 Alpha / Beta wallet 必须分别等于 `$AGENT_ALPHA_ADDR` / `$AGENT_BETA_ADDR`；连续两次执行得到相同 member ID + hash。若 owner 钱包尚无 `WalletBinding` 行，脚本会报错并指向"先用 owner 钱包通过浏览器登录一次"——这是预期路径。

**Step 3 — Sui CLI 链上验证 4 地址可达：**
```bash
sui client balance $SELLER_ADDR
sui client balance $BUYER_ADDR
sui client balance $AGENT_ALPHA_ADDR
sui client balance $AGENT_BETA_ADDR
```
4 个地址均应返回余额信息（即使为 0 也说明地址在链上存在）。

**Step 4 — 记录 SELLER_MEMBER_ID（Phase 10.6 Follow 用）：**

> Seller 的 `members` 行只有在 Test 1.1 完成首次登录后才存在。本步暂留 `SELLER_MEMBER_ID=` 占位；Test 1.1 之后回填：
>
> ```sql
> SELECT m.id FROM members m
> JOIN wallet_bindings wb ON wb.member_id = m.id
> WHERE wb.address = '$SELLER_ADDR' AND wb.chain = 'sui';
> ```

### -1.3 钱包余额检查 + SUI / WAL 人工补给 + USDC 自动 mint

**最低余额要求：**

| 角色 | SUI Gas / Relay Tip | WAL Storage | Test USDC | 用途 |
|------|---------------------|-------------|-----------|------|
| Seller | ≥0.5 SUI | ≥10,000,000 atomic WAL | — | Create Soul A/B + Collection 的 wallet-paid Walrus register/certify、List / Grant / SetGrantCapacity / SetContentAccessPrice |
| Buyer | ≥0.5 SUI | ≥5,000,000 atomic WAL | ≥10 USDC | 购买 Soul A ($1) + Phase 6 skills append + Phase 8 import + Phase 7.10a content access purchase |
| Agent Alpha | ≥0.3 SUI | — | ≥10 USDC | Agent 购买 Soul B ($2) + Phase 7.10g re-purchase + gas |
| Agent Beta | ≥0.1 SUI | — | — | 仅 403 验证 + gas 备用 |

WAL 下限是当前小 fixture 的执行缓冲，不是协议常量。每次执行仍以 `UploadCostReview` 的 `WAL storage` 实时报价为准：若 quote 总和超过表格缓冲，先补 WAL 再继续；不得用 `__e2eUpload` 自动 approve 跳过成本确认。

**Step 1 — 检查 4 地址当前余额：**

```bash
USDC_TYPE="0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325::usdc::USDC"
WAL_TYPE="0x8270feb7375eee355e64fdb69c50abb6b5f9393a722883c1cf45f8e26048810a::wal::WAL"
for var in SELLER_ADDR BUYER_ADDR AGENT_ALPHA_ADDR AGENT_BETA_ADDR; do
  ADDR=${!var}
  echo "=== $var = $ADDR ==="
  sui client balance "$ADDR" 2>&1 | head -20
  sui client balance --coin-type "$WAL_TYPE" "$ADDR" 2>&1 | head -5
  sui client balance --coin-type "$USDC_TYPE" "$ADDR" 2>&1 | head -5
done
```

**Step 2 — SUI / WAL 不足时，AI 列清单暂停等用户转账（**手动介入唯一一次**）：**

AI 根据 Step 1 输出对照"最低余额要求"，生成清单形如：

```
请从你的 wallet 给以下测试地址转 SUI / WAL（testnet）：
- BUYER_ADDR (0xabc...) : 缺 0.3 SUI
- SELLER_ADDR (0x123...) : 缺 10,000,000 atomic WAL
- AGENT_ALPHA_ADDR (0xdef...) : 缺 0.2 SUI
- (其余地址余额充足)

转完后回复"已转完"继续。
```

用户从自有钱包转账后回告"已转完"。AI 重跑 Step 1 校验 SUI / WAL ≥ 最低要求；不达标则回 Step 2 重列清单。若本地有足额测试 WAL / SUI keystore，AI 可以直接按清单转账；否则不得进入 Phase 1/3/6/8 的 wallet-paid upload 流程。

> 不再使用 `sui client faucet`：testnet faucet 频率限制 + 失败率高，让用户用自有钱包转更可靠。

**Step 3 — USDC 不足时，AI 自动 mint（无需用户介入）：**

```bash
# 切到 Treasury Owner（一次性，后续 mint 不需要再 switch）
sui client switch --address 0x76fd52cac79bda80806be6b5ab7f3b1f099a966203cce809254919a7ab755728

# 给 Buyer mint 10 USDC（10,000,000 atomic units）
sui client call \
  --package 0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325 \
  --module usdc --function mint \
  --args 0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184 \
         10000000 $BUYER_ADDR \
  --gas-budget 10000000

# 给 Agent Alpha mint 10 USDC
sui client call \
  --package 0x79d8bbac24e7bb040260c54fccd3b47eded90d67fb8d8d6bb42b3a5e62b85325 \
  --module usdc --function mint \
  --args 0x56033240326fa75ab7986654d87aa3f2c8168212492edc7d7ee4755f30189184 \
         10000000 $AGENT_ALPHA_ADDR \
  --gas-budget 10000000
```

> 前置：`sui keytool list` 中必须存在 Treasury Owner（`0x76fd…5728`）的私钥。如果不在 keystore，AI 报错并要求用户一次性 import；之后所有 USDC mint 都自动。

**Step 4 — Mint 后验证：**
```bash
sui client balance --coin-type "$USDC_TYPE" $BUYER_ADDR
sui client balance --coin-type "$USDC_TYPE" $AGENT_ALPHA_ADDR
```
均应 ≥ 最低要求。

### -1.4 验证测试 Fixture

验证文件存在且完整：
```bash
ls -la /Users/admin/Documents/example/soul.md \
       /Users/admin/Documents/example/memory.md \
       /Users/admin/Documents/example/images.jpeg \
       /Users/admin/Documents/example/skill.zip \
       /Users/admin/Documents/example-collection/soul-collection-template.xlsx \
       /Users/admin/Documents/example-collection/1/soul.md \
       /Users/admin/Documents/example-collection/1/memory.md \
       /Users/admin/Documents/example-collection/1/images.jpeg \
       /Users/admin/Documents/example-collection/1/skill.zip
```

### -1.5 确认 Dev Server 运行 + Env 完整性
- 当前前端：`curl http://localhost:3100/market`（确认 HTML 含 "Soulidity"）
- Agent API 已迁移到当前 `web/` 应用（port 3100），**不再需要 legacy web (port 3000)**
- Env 必填校验（写入 `.env.local`，`web/next.config.ts` 已 `dotenv.config({ path: '../.env.local', override: true })`）：
  - `NODE_ENV=development`（W0 e2e-wallet-stub bundle-time gate）
  - `NEXT_PUBLIC_E2E_TEST_MODE=1`（runtime gate；启用 e2e-wallet-stub 注册）
  - `NEXT_PUBLIC_SUI_NETWORK=testnet`（web、Walrus quote/upload、Seal helper 与 Node 脚本都按此选择网络）
  - `AUTH_SECRET`（≥32 字节随机；虽然 dev 有回退值，本计划要求显式设置，避免 session secret 漂移）
  - `E2E_SELLER_PRIVATE_KEY` / `E2E_BUYER_PRIVATE_KEY` / `E2E_AGENT_ALPHA_PRIVATE_KEY` / `E2E_AGENT_BETA_PRIVATE_KEY`（4 个角色 keypair）
  - `E2E_AGENT_ALPHA_API_KEY` / `E2E_AGENT_BETA_API_KEY`（agent setup 脚本 + Bearer auth）
  - `E2E_AGENT_OWNER_WALLET`（可选；缺失时 setup 脚本回退到 `E2E_SELLER_PRIVATE_KEY` 派生地址）
- Wallet-paid Walrus / Seal 可选覆盖（testnet 默认可不填；若填写必须与 `NEXT_PUBLIC_SUI_NETWORK` 一致）：
  - `NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL`（默认 testnet upload relay）
  - `NEXT_PUBLIC_WALRUS_AGGREGATOR_URL`（默认 testnet aggregator）
  - `NEXT_PUBLIC_WALRUS_WASM_URL`（默认从 `@mysten/walrus-wasm` CDN 加载）
  - `NEXT_PUBLIC_SEAL_SERVER_CONFIGS` / `NEXT_PUBLIC_SEAL_THRESHOLD` / `NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS`（testnet 有默认 key server；mainnet smoke 必须显式配置）
- W0 Stub 自检：`evaluate_script` 在任意页面运行 `(navigator.wallets ?? []).some(w => w.name === 'E2E Test Wallet')`，没设 `__E2E_PRIVATE_KEY` 前应为 `false`；设了 + reload 后应为 `true`
- 严禁出现 `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` / `PRIVY_CUSTOM_AUTH_*`（CI 有 ripgrep no-residue guard）。E2E 用户上传链路也不得要求 `BLOB_READ_WRITE_TOKEN`、`WALRUS_PUBLISHER_URL` 或 `SOUL_UPLOAD_SECRET`；这些若在本地存在，只能服务 desktop release / 历史批量发布脚本 / 内部白盒脚本，不能作为主流程前提。

### -1.6 清空浏览器状态
`evaluate_script`: `localStorage.clear(); sessionStorage.clear();`

### -1.7 创建截图产物目录

所有截图统一写入 `ARTIFACT_DIR=e2e-artifacts/<RUN_DATE>`。执行前创建：
```bash
RUN_DATE=$(date +%F)
export ARTIFACT_DIR="e2e-artifacts/${RUN_DATE}"
mkdir -p "$ARTIFACT_DIR"
```

### -1.8 Testnet Walrus capability probe

本步骤只确认 testnet 公共 Walrus 服务当前可用边界；不上传业务 fixture，不替代 Phase 1 / 3 / 6 / 8 的真实 wallet-paid UI 上传。

**Step 1 — relay tip-config 可达：**
```bash
cd /Users/admin/Desktop/nao/clawnews
WALRUS_RELAY="${NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL:-https://upload-relay.testnet.walrus.space}"
curl -fsS "${WALRUS_RELAY%/}/v1/tip-config" | tee "$ARTIFACT_DIR/walrus-tip-config.json"
```
通过标准：退出码 0，JSON 为 `no_tip` 或 `send_tip`。失败 / 超时 / 429 / 5xx = 环境阻塞，先换 relay 或稍后重试；不能继续声称 wallet-paid upload 已通过。

**Step 2 — 记录协议上限（有 `walrus` CLI 时执行）：**
```bash
if command -v walrus >/dev/null 2>&1; then
  walrus info --context testnet | tee "$ARTIFACT_DIR/walrus-info.txt"
else
  echo "walrus CLI not installed; skip protocol info probe" | tee "$ARTIFACT_DIR/walrus-info.txt"
fi
```
通过标准：如果 CLI 存在，输出必须包含 maximum blob size / storage epoch 信息；如果 CLI 不存在，不阻塞主流程，因为 web path 使用 `@mysten/walrus` SDK + upload relay。

**Step 3 — 大文件 live smoke 边界：**
- 默认 96 项主流程不跑 `> 50 MiB` live upload。
- 若本轮目标明确要求验证 testnet 大文件上传，先设置 `E2E_WALRUS_LIVE_LARGE_UPLOAD=1`，再用专门 fixture 跑 `> 50 MiB`；如果 upload relay / publisher 返回 413/429/5xx，记录为 testnet Walrus capability failure，不改写主 96 项业务结论。

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
4. `evaluate_script` 自检 stub 已注册：
   ```js
   const wallets = navigator.wallets ?? [];
   wallets.some(w => w.name === 'E2E Test Wallet')
   ```
   返回 `true`
5. `take_snapshot` 找 navbar "Login" 按钮 uid → `click`
6. `wait_for` text "Connect a Sui Wallet"（dapp-kit ConnectModal）
7. `take_snapshot` 找 "E2E Test Wallet" 条目 uid → `click`
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
               filePath: '/Users/admin/Documents/example/skill.zip')
   ```
9. `wait_for` text "skill.zip"（确认文件名出现）

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

> **注意**: Gas 页 `handleDeploy()` 内部完成全流程：upload cover(public) → char(encrypted) → memory(encrypted) → skills(encrypted) → buildPublishSoulTx → signAndExecute → POST `/api/souls/publish` mirror 同步。e2e-wallet-stub 接管签名（内存 keypair，0 popup）。所有上传走 browser wallet-paid Walrus path：`uploadSoulPayload` 本地加密、报价、弹出 `UploadCostReview`，再由测试钱包签 Walrus register/certify TX。

### Test 1.6: Deploy Soul A — Sign & Deploy
1. `click` "✓ Sign & Deploy" 按钮（`button:has-text("Sign & Deploy")`）
2. `wait_for` `[data-testid="publish-status"]` 出现，跟踪状态变化: uploading → building → signing → syncing
3. 按"Wallet-paid Walrus 成本确认"循环处理 `UploadCostReview` 弹窗。当前 fixture fresh run 预期 4 次确认：cover(public)、char(encrypted)、memory(encrypted)、skills(encrypted)；每次确认后由 e2e-wallet-stub 签 Walrus register/certify TX。
4. e2e-wallet-stub 接管 Soul mint 签名（内存 keypair，0 popup）
5. `wait_for` URL 变为 `/create/success`（status=done 时自动 redirect），timeout 90s
6. `wait_for` text "Soul Born"（success 页标题）
7. 从 success 页提取 **SOUL_A_ID**（Soul Object ID 行）:
   ```javascript
   evaluate_script(`document.body.innerText.match(/0x[a-f0-9]{64}/)?.[0] ?? ''`)
   ```
8. `take_screenshot` → `$ARTIFACT_DIR/phase1-soul-a-published.png`
9. **DB 验证 mint mirror 写入完整：**
   ```sql
   SELECT on_chain_id, assets_on_chain_id, access_list_on_chain_id, metadata_on_chain_id,
          active_sprite_asset_name, active_voice_asset_name, sprite_config_json, voice_config_json
   FROM soul_assets WHERE on_chain_id = '$SOUL_A_ID';
   ```
   - `access_list_on_chain_id IS NOT NULL`（mint 自动创建 ContentAccessList），记录为 **SOUL_A_ACCESS_LIST_OBJ**
   - `metadata_on_chain_id IS NOT NULL`（mint 自动创建 SoulMetadata shared object），记录为 **SOUL_A_METADATA_OBJ**
   - `assets_on_chain_id` 为 NULL（wizard 不传 `assetBlobObjectId`）
   - `active_sprite_asset_name` / `active_voice_asset_name` / `sprite_config_json` / `voice_config_json` 均为 NULL（fixture 未上传 sprite / voice）
10. **DB 捕获初始 Skills 版本：**
   ```sql
   SELECT skill_name, version_index
   FROM soul_skill_version_records
   WHERE soul_on_chain_id = '$SOUL_A_ID'
   ORDER BY version_index DESC
   LIMIT 1;
   ```
   记录为 **SOUL_A_INITIAL_SKILL_NAME** / **SOUL_A_INITIAL_SKILL_VERSION_INDEX**（Phase 5.3 Skills grant 正向访问用）

### Test 1.7: 创建 Soul B — 完整 wizard 流程
重复 Tests 1.2-1.6 全流程，参数差异:
1. `navigate_page` → `http://localhost:3100/create`
2. Name: `E2E Soul Beta NW`，Description: `E2E test Soul B — held, not listed`
3. Cover: `upload_file` ← `/Users/admin/Documents/example/images.jpeg`
4. Content: 同 Test 1.3 — soul.md, memory.md, skill.zip 均来自 `/Documents/example/`
5. Preview → Gas → Sign & Deploy
6. Deploy 阶段同 Test 1.6 处理 `UploadCostReview`；fresh run 预期 4 次确认
7. 从 success 页捕获 **SOUL_B_ID**
8. **DB 验证同 Test 1.6 step 9：**
   ```sql
   SELECT on_chain_id, assets_on_chain_id, access_list_on_chain_id, metadata_on_chain_id
   FROM soul_assets WHERE on_chain_id = '$SOUL_B_ID';
   ```
   记录 `access_list_on_chain_id` 为 **SOUL_B_ACCESS_LIST_OBJ**，`metadata_on_chain_id` 为 **SOUL_B_METADATA_OBJ**

### Test 1.8: Soul A 详情页 — Held 状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. `wait_for` text "E2E Soul Alpha NW"
3. `evaluate_script` 验证 hero badge 含 "Held"（mint 后默认 held）
4. `evaluate_script` 验证 owner CTA 为 "List Soul"（`a:has-text("List Soul")`）
5. `evaluate_script` 验证 Protocol State 卡片显示 Soul / State / Memory / Metadata object ID，从中分别记录 **SOUL_A_STATE_OBJ** 与 **SOUL_A_METADATA_OBJ**（与 Test 1.6 DB 捕获一致）
6. `evaluate_script` 验证 Access 卡片显示 "Grant capacity: 0 /"（默认容量 1，0 已用）
7. **链上验证 SoulState 关键字段：**
   ```bash
   sui client object $SOUL_A_STATE_OBJ --json | python3 -c "
   import json, sys
   f = json.load(sys.stdin)['data']['content']['fields']
   print('access_list_id:', f.get('access_list_id'))
   print('metadata_id:', f.get('metadata_id'))
   print('ownership_epoch:', f.get('ownership_epoch'))
   print('grant_capacity:', f.get('grant_capacity'))
   "
   ```
   - `access_list_id` 非空且等于 DB 的 `access_list_on_chain_id`
   - `metadata_id` 非空且等于 DB 的 `metadata_on_chain_id`
   - `ownership_epoch = 0`（初始 mint）
   - `grant_capacity = 1`
8. `evaluate_script` 验证 MemoryPanel 渲染（页面含 "Memory" kicker）+ founding memory entry 存在（writerKind 为 "Founder"，purple tag，含 lock icon）
9. `evaluate_script` 验证 SkillsPanel 渲染（页面含 "Skills" kicker + 初始 skill version row）

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

### Test 2.1: List Soul A — Set Price $1
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}/sell`
2. `wait_for` text "List Soul"
3. `evaluate_script` 验证 Soul 名称 "E2E Soul Alpha NW" 显示
4. `fill` price input（`input[type="number"][placeholder="0.00"]`）: `1`
5. `evaluate_script` 验证 "Next: Authorize →" 链接已激活

### Test 2.2: List Soul A — Authorize & Sign
1. `click` "Next: Authorize →"（`a:has-text("Next: Authorize")`）
2. `wait_for` URL 含 `/sell/authorize`
3. `wait_for` text "Authorize listing"
4. `evaluate_script` 验证 Wallet Request 卡片显示: Soul name, Ask price "1.00 USDC", Creator royalty
5. `click` "✓ Sign & List" 按钮（`button:has-text("Sign & List")`）
6. e2e-wallet-stub 接管签名（内存 keypair，0 popup） `list_fixed_price` TX
7. `wait_for` URL 变为 `/sell/success`，timeout 60s

### Test 2.3: List Soul A — Success
1. `wait_for` text "Soul listed"
2. `evaluate_script` 验证: Soul name + "1.00 USDC" + "Live in kiosk market"
3. `take_screenshot` → `$ARTIFACT_DIR/phase2-soul-a-listed.png`

### Test 2.4: List Soul B — Set Price $2
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_B_ID}/sell`
2. `wait_for` text "List Soul"
3. `fill` price input: `2`

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
3. `evaluate_script` 验证第一个 Soul card 是 Soul A（$1），第二个是 Soul B（$2）
4. 切回 "Newest" 恢复默认

### Test 2.8: Market 高级筛选 — Price Range
1. `click` "Filters" 按钮（`button:has-text("Filters")`）
2. `wait_for` 筛选面板出现（"Price Range" 文本可见）
3. `fill` Min Price（`input[placeholder="Min"]`）: `0.5`
4. `fill` Max Price（`input[placeholder="Max"]`）: `1.5`
5. `wait_for` 列表更新（debounce 300ms）
6. `evaluate_script` 验证只有 Soul A（$1）可见，Soul B（$2）被过滤
7. `click` "Clear filters"（`button:has-text("Clear filters")`）
8. `evaluate_script` 验证两个 Soul 均恢复可见
9. `take_screenshot` → `$ARTIFACT_DIR/phase2-market-filters.png`

---

## Phase 3: Collection 创建 + Floor Guard（6 tests）

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
7. `fill` Floor Price（`input[type="number"]` placeholder 含 "e.g. 10"）: `5`
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
SKILL_B64=$(base64 -i /Users/admin/Documents/example-collection/1/skill.zip)
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
    dt.items.add(b64toFile('${SKILL_B64}', 'skill.zip', 'application/zip',
      'example-collection/1/skill.zip'));

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
6. 按"Wallet-paid Walrus 成本确认"循环处理 `UploadCostReview`。当前 1-Soul fixture fresh run 预期 5 次确认：collection cover(public)、child char(encrypted)、child memory(encrypted)、child skills(encrypted)、child image(public)。
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
4. 输入 list price `5.00` USDC，签名 `list_collection_right_fixed_price`
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
4. `fill` price input（定位提示：`input[type="number"][placeholder="0.00"]`）: `4.99`
5. `evaluate_script` 验证页面出现 floor 提示："Minimum price for this collection is 5"
6. `evaluate_script` 验证继续按钮不是 `"Next: Authorize →"` 链接，而是 disabled 按钮 `"Enter a valid price"`

---

## Phase 4: Buyer 登录 + 购买（9 tests）

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
   - "Collection royalty" 行
   - "Total" 行（gold 文字）
4. `evaluate_script` 验证 "Buy for ..." 金色按钮可点击

### Test 4.5: 执行购买 Soul A
1. `click` "Buy for ..." 按钮（`button:has-text("Buy for")`）
2. `wait_for` 按钮文字变为 "⟳ Building TX…" / "⟳ Signing…" / "⟳ Syncing…"
3. e2e-wallet-stub 接管签名（内存 keypair，0 popup） `purchase()` TX
4. `wait_for` text "Soul acquired"（success 状态），timeout 60s
5. `evaluate_script` 验证 success 卡片: Soul name + 支付金额 + TX digest
6. `evaluate_script` 验证 "View in My Souls" 链接（`a[href="/my-souls"]`）
7. `take_screenshot` → `$ARTIFACT_DIR/phase4-soul-a-purchased.png`

### Test 4.6: Buyer My Souls — Owned 1
1. `navigate_page` → `http://localhost:3100/my-souls`
2. `evaluate_script` 验证 Owned tab 显示 1 个 soul row（Soul A）
3. `click` "Collections" tab → 验证 "No collection rights yet"
4. `click` "Activity" tab → 验证 "No activity yet"

---

## Phase 5: Grant 系统（10 tests）

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

> 从 `SoulState` 直接读 `grant_capacity` + `access_list_id`，与 Test 5.2a 的 helper TX 结果 + Test 1.6 的 mint 后 mirror 对齐。

**链上验证：**
```bash
sui client object $SOUL_A_STATE_OBJ --json 2>&1 | python3 -c "
import json, sys
data = json.load(sys.stdin)
fields = data.get('data',{}).get('content',{}).get('fields',{})
print(f'grant_capacity={fields.get(\"grant_capacity\",\"?\")}')
print(f'access_list_id={fields.get(\"access_list_id\",\"?\")}')
"
```
验证:
- `grant_capacity` 为 `2`（Test 5.2a 已通过 owner TX 调整）
- `access_list_id` 非空（mint 时自动创建 ContentAccessList 并绑定）

### Test 5.3: Agent Alpha → Soul A: 200（granted-agent via 当前 `web/` 应用）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/access
```
验证:
- HTTP 200
- `accessKind` = `"granted-agent"`
- `accessPolicy.functionName` = `"seal_approve_granted_agent"`
- `accessPolicy.soulGrantObjectId` 非空（指向链上 SoulGrant 对象）

同一个 Grant 必须允许 Skills 正向访问：
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/skills/${SOUL_A_INITIAL_SKILL_NAME}/versions/${SOUL_A_INITIAL_SKILL_VERSION_INDEX}/access
```
验证:
- HTTP 200
- `accessKind` = `"granted-agent"`
- `accessPolicy.functionName` = `"seal_approve_private_read_granted_agent"`
- `accessPolicy.soulGrantObjectId` 非空

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

5. **负向测试：Active grant 不可 destroy**（固化为 Move test，避免 RPC dry-run 构造 owned-object 输入的不稳定性）：
   ```bash
   cd /Users/admin/Desktop/nao/clawnews/move/soulidity && \
     sui move test destroy_invalidated_grant_rejects_active_grant 2>&1 | tail -20
   ```
   验证退出码 0，输出含 `destroy_invalidated_grant_rejects_active_grant`、`[ PASS ]` / `[ PASS    ]` 与 `Test result: OK`。Abort code 由 `protocol_tests.move` 中该 test 的 `#[expected_failure(abort_code = soulidity::grant::EGrantStillActive)]` 注解固定；当前 Sui CLI 的 test 输出不会打印 `MoveAbort` 明细。

---

## Phase 6: Skills 生命周期（3 tests）

### Test 6.1: Skills Panel 初始状态
1. `navigate_page` → `http://localhost:3100/souls/${SOUL_A_ID}`
2. 定位 Skills 面板（`SkillsPanel` 组件）
3. `evaluate_script` 验证显示 owner 级别操作（Buyer 是 owner）

### Test 6.2: Append Skills Version
1. 在 Skills 面板中找到上传 input，上传 fixture skill bundle:
   ```
   upload_file(selector: '<SkillsPanel 内的 input[type="file"]>',
               filePath: '/Users/admin/Documents/example/skill.zip')
   ```
   > Selector 需运行时通过 `evaluate_script` 定位 SkillsPanel 内的隐藏 file input 并打标签。
2. `click` "Append Version" 按钮
3. 按"Wallet-paid Walrus 成本确认"处理 1 次 `UploadCostReview`（skill.zip encrypted upload，当前 fixture 小文件预期 `Transactions = 2`）
4. e2e-wallet-stub 自动签名 Walrus register/certify 和 `append_version_as_owner()` TX
5. `wait_for` 新 skill version row 出现
6. `evaluate_script` 验证 version row 含 "private" tag + blob 地址

> Skills 大文件 (>2 MB) 走 `uploadSoulPayload` 的 wallet-paid Walrus path；客户端 hook (`use-skills.ts`) 在 append TX 成功后用 tx event 生成 `skillsSealSidecar` 并提交 mirror。

### Test 6.3: Owner Decrypt Skills Version
1. 在 skill version row 点击 "Decrypt" 按钮
2. e2e-wallet-stub 自动签 Seal personal message
3. `wait_for` 按钮从 loading 恢复
4. `list_console_messages` 验证无 error

> **Memory 验收口径**：MemoryPanel 目前为 owner-only 只读视图（`web/components/souls/memory-panel.tsx`），founding memory entry 的渲染已在 Test 1.8 覆盖。Memory append TX 属于 agent API / SDK 写入路径（`POST /api/agent/souls/{id}/memory/{entryKey}/append`），没有 web UI 用户入口；本计划不保留单独待办用例。Memory blob 的 Seal 读解密由 `web/scripts/e2e-agent-decrypt.ts` / `e2e-agent-verify-content.ts` 在 Phase 7.11-7.12 覆盖。

---

## Phase 6.5: SoulAssets API 验证（4 tests）

> Buyer 仍登录，owns Soul A。本 Phase 的验收范围是 asset 空状态和不存在版本的 404/400 边界：两个 Soul 均无 asset version（wizard 当前不传 `assetBlobObjectId`），对 human / agent 访问不存在的 asset version 均返回 404。Phase 7.11-7.12 覆盖 skills / memory 的 Seal 解密，但不宣称 `asset-version-access.ts` 的 owner / grant / allowlist 授权矩阵已经验证。真实 asset version 授权矩阵不是本计划的待办用例；只有当产品 fixture / mint 入口实际创建 asset version 时，才另开 SPEC 把 owner 200、grant 200、allowlist 200、unauthorized 403 四类断言纳入主验收。

### Test 6.5.1: List Assets — Soul A 空状态
```bash
curl -s -w "\n%{http_code}" \
  http://localhost:3100/api/souls/${SOUL_A_ID}/assets
```
验证:
- HTTP 200
- `assets` 为空数组 `[]`（wizard 不传 `assetBlobObjectId`，无 asset version 创建）

### Test 6.5.2: List Assets — Soul B 空状态
```bash
curl -s -w "\n%{http_code}" \
  http://localhost:3100/api/souls/${SOUL_B_ID}/assets
```
验证:
- HTTP 200
- `assets` 为空数组 `[]`

### Test 6.5.3: Human Asset Access — 不存在的 asset version
```bash
curl -s -w "\n%{http_code}" \
  http://localhost:3100/api/souls/${SOUL_A_ID}/assets/nonexistent/versions/0/access
```
验证:
- HTTP 404
- 响应含 `"Asset version not found"`

### Test 6.5.4: Agent Asset Access — 不存在的 asset version
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/assets/nonexistent/versions/0/access
```
验证:
- HTTP 404
- 响应含 `"Asset version not found"`

---

## Phase 7: Agent API 功能验证（7 tests: 7.1-7.5 主流程 + 7.11 Seal 解密 + 7.12 逐字节比对）

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

### Test 7.11: Agent Seal Decrypt Soul B
```bash
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY="${E2E_AGENT_ALPHA_API_KEY}" \
AGENT_PRIVATE_KEY="${E2E_AGENT_ALPHA_PRIVATE_KEY}" \
BASE_URL=http://localhost:3100 \
npx tsx web/scripts/e2e-agent-decrypt.ts
```
验证:
- 解密成功（退出码 0）
- Seal 调用 `seal_approve_owner`（Agent Alpha 是 owner）
- 输出 content hash 匹配

### Test 7.12: Seal 加密内容与原始文件逐字节比对

前置：Agent Alpha 已购买 Soul B（Test 7.3）并拥有 owner 访问权（Test 7.4）。创建 / 导入 gas 页在 development 环境暴露 `window.__e2eLastSealMaterial = { char, memory, skills, sprite }`，测试必须在 mint/import 后立即捕获该 JSON。本测试必须在 Test 7.10g 的 Soul B 再转售之前执行，否则 Agent Alpha 不再是 Soul B owner。

```bash
SOUL_ID=${SOUL_B_ID} \
AGENT_API_KEY="${E2E_AGENT_ALPHA_API_KEY}" \
PENDING_SEAL_MATERIALS_JSON="${CAPTURED_SEAL_MATERIAL_JSON}" \
MEMORY_ENTRY_KEY="${SOUL_B_FOUNDING_MEMORY_TIMESTAMP_KEY}" \
SKILL_NAME="${SOUL_B_INITIAL_SKILL_NAME}" \
SKILL_VERSION_INDEX="${SOUL_B_INITIAL_SKILL_VERSION_INDEX}" \
COMPARE_DIR="/Users/admin/Documents/example" \
npx tsx web/scripts/e2e-agent-verify-content.ts
```
验证:
- 退出码 0
- `char` 对 `/api/agent/souls/{id}/access` 返回的 Walrus blob 解密后与 `soul.md` 逐字节一致
- `memory` 对 `/api/agent/souls/{id}/memory/{entryKey}/access` 返回的 Walrus blob 解密后与 `memory.md` 逐字节一致
- `skills` 对 `/api/agent/souls/{id}/skills/{skillName}/versions/{versionIndex}/access` 返回的 Walrus blob 解密后与 `skill.zip` 逐字节一致
- 最终输出 `OK 3 artifact(s) matched byte-for-byte.`

---

## Phase 7.5: ContentAccess API + Registry 全链上验证（9 tests）

> **执行原则：** ContentAccess mirror 路由 `add` / `purchase` / `revoke` 均 `requireHumanWalletIdentity` + `parseRequiredTxDigest` + `assertTransactionSender`，从链上事件 upsert DB。DB 直写模拟不再有效 —— 本 Phase 所有写入类断言走真实链上 TX（stub 钱包经 `window.__e2eSoulidity.purchaseContentAccess`；owner-only 路径的负向断言走 Move test 固化）。
> 前提：Agent Alpha owns Soul B（Test 7.3），Buyer owns Soul A（Phase 4）。两个 Soul 均有 `accessListOnChainId`（Phase 1.6/1.7 捕获）。

### Test 7.6: Content Access List — 初始空状态
```bash
curl -s -w "\n%{http_code}" \
  http://localhost:3100/api/souls/${SOUL_A_ID}/access-list
```
验证:
- HTTP 200
- `accessList` 为空数组 `[]`（尚无 content access 授权）

对 Soul B 做同样的 `curl`，同样返回 `[]`。

### Test 7.10a: Content Access Purchase — 付款路由 + 平台抽成 + epoch mirror

> 验证链上 `market::purchase_content_access` 付款流 + mirror 写入：付款发给 `soul::current_owner(state)`（非固定 creator）、平台抽成进 `MarketConfig`、`ContentAccessRecord.ownershipEpochSnapshot` 与 `SoulState.ownership_epoch` 一致。
> Soul B 由 Seller 创建，Phase 7.3 卖给 Agent Alpha。Seller 再作为非 owner 购买 Soul B 的 content access，付款必须发给 Agent Alpha（当前 owner），非 Seller（creator / buyer）。

1. **确认 Soul B 当前 owner 为 Agent Alpha：**
   ```sql
   SELECT current_owner_address, creator_address, access_list_on_chain_id, state_on_chain_id
   FROM soul_assets WHERE on_chain_id = '$SOUL_B_ID';
   ```
   验证: `current_owner_address = $AGENT_ALPHA_ADDR`，`creator_address = $SELLER_ADDR`（两者不同），记录 `SOUL_B_STATE_OBJ` / `SOUL_B_ACCESS_LIST_OBJ`

2. **Agent Alpha owner 设置 paid access + 短 duration（供 7.10f 继续测生命周期）：**
   ```bash
   OWNER_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY" \
   ACCESS_LIST_ID="$SOUL_B_ACCESS_LIST_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   PRICE_ATOMIC=1000000 \
   DURATION_MS=2000 \
   npx tsx web/scripts/e2e-content-access-lifecycle.ts set-initial
   ```
   验证:
   - TX success
   - 事件 `<pkg>::content_access::ContentAccessPriceUpdated`
   - 事件 `<pkg>::content_access::ContentAccessDurationUpdated`
   - 链上对象 `price_atomic = 1000000`，`default_access_duration_ms.vec = [2000]`

3. **Seller（非 owner）购买 Soul B content access：**
   - 如 Seller USDC 不足，先用 test USDC treasury mint `>= 2 USDC` 到 `$SELLER_ADDR`
   - Chrome DevTools 切到 Seller 登录会话，打开任意已挂载 AppProviders 的页面
   - 执行：
     ```js
     await window.__e2eSoulidity.purchaseContentAccess({
       soulObjectId: '$SOUL_B_ID',
       accessListOnChainId: '$SOUL_B_ACCESS_LIST_OBJ',
       stateOnChainId: '$SOUL_B_STATE_OBJ',
       priceAtomic: '1000000',
       platformFeeBps: 250
     })
     ```
   - 记录 `CONTENT_ACCESS_PURCHASE_DIGEST_1`

4. **验证付款路由 + mirror：**
   - TX events 含 `<pkg>::market::ContentAccessPurchased`
   - `buyer == $SELLER_ADDR`
   - `payment_recipient == $AGENT_ALPHA_ADDR`
   - `price == 1000000`，`platform_fee == 25000`
   - `ContentAccessGranted.expires_at_ms` 非空
   ```sql
   SELECT grantee_address, scope_mask, price_paid_atomic, expires_at_ms, revoked_at,
          ownership_epoch_snapshot
   FROM content_access_records
   WHERE soul_on_chain_id = '$SOUL_B_ID' AND grantee_address = '$SELLER_ADDR';
   ```
   验证 `scope_mask = 15`、`price_paid_atomic = 1000000`、`expires_at_ms IS NOT NULL`、`revoked_at IS NULL`、`ownership_epoch_snapshot` 等于 `SoulState.ownership_epoch`（Test 7.3 已把 Soul B 卖给 Agent Alpha，epoch 应为 1；若后续再次转售则为当时 epoch）

### Test 7.10b: Content Access Purchase 报价含平台抽成 + manifest 一致性

> 验证 `market::quote_content_access_purchase(config, price)` 返回 `(platform_fee, price, total)`，以及 deployment-manifest 与运行环境一致。

**运行环境 + manifest 一致性（single source of truth）：**
```bash
cd /Users/admin/Desktop/nao/clawnews && npx tsx -e "
import { getRequiredSoulidityEnv } from './web/lib/soulidity/env'
for (const k of [
  'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID',
  'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE',
]) console.log(k + '=' + getRequiredSoulidityEnv(k))
"
```
必须与 Context 表格完全一致（当前 packageId 前缀 `0x0b79af1f…`）。任何不匹配立即阻塞。

**链上 `quote_content_access_purchase` dev-inspect：**
```bash
sui client call \
  --package $PACKAGE_ID --module market --function quote_content_access_purchase \
  --args $MARKET_CONFIG_ID 1000000 \
  --gas-budget 10000000 --dev-inspect 2>&1 | grep -E "returnValues|platform_fee"
```
期望返回 `(platform_fee = 25000, price = 1000000, total = 1025000)`（250 bps 平台费）。

### Test 7.10c: KioskRegistry 共享对象存在 + 与 manifest 一致

```bash
sui client object $KIOSK_REGISTRY_OBJ --json 2>&1 | python3 -c "
import json, sys
d = json.load(sys.stdin)['data']
print('objectId:', d['objectId'])
print('owner:', d['owner'])
print('objType:', d['type'])
"
```
验证:
- `objectId == $KIOSK_REGISTRY_OBJ`（与 `deployment-manifest.json.kioskRegistryId` 一致，值 `0x355648aa…`）
- `objType` 含 `market::KioskRegistry`
- `owner` 为 `Shared`

### Test 7.10d: purchase_content_access 拒绝 price=0

> Soul A 的 ContentAccessList 在 Test 1.6 时以默认 `price_atomic = 0` 创建（wizard 未暴露价格输入）。合约必须以 `EContentAccessNotPurchasable = 28` 拒绝任何 paid purchase 请求。
>
> **执行路径固化为 Move test**：绕过前端 mint dry-run 构造 Walrus Blob owned object 输入不稳定（Blob 对象归属 + epoch），合约断言由 `protocol_tests.move::purchase_content_access_with_zero_price_fails` 覆盖（149 项基线内），本测试直接运行该 Move test 并把输出附到结果文档。

```bash
cd /Users/admin/Desktop/nao/clawnews/move/soulidity && \
  sui move test purchase_content_access_with_zero_price_fails 2>&1 | tail -20
```
验证:
- 退出码 0
- 输出含 `purchase_content_access_with_zero_price_fails`、`[ PASS ]` / `[ PASS    ]` 与 `Test result: OK`
- Abort code 由 `protocol_tests.move` 中该 test 的 `#[expected_failure(abort_code = soulidity::market::EContentAccessNotPurchasable)]` 注解固定；当前 Sui CLI 的 test 输出不会打印 `MoveAbort` 明细

### Test 7.10e: mint 传 scope_mask=0 / 非法 mask 被 `grant` 模块拒绝

> 合约层 scope mask 校验：`content_access::create` → `grant::assert_valid_scope_mask`。`0` 值 abort `EEmptyScopeMask (10)`，`15` 之外的 bit abort `EGrantInvalidScopeMask (13)`。
>
> **执行路径固化为 Move test**：SDK 默认兜底 `ALL_ACCESS_SCOPES = 15`，E2E 正向路径已在 Phase 1 全量覆盖；负向断言直接通过 `protocol_tests.move` 两条用例固化。

```bash
cd /Users/admin/Desktop/nao/clawnews/move/soulidity && \
  sui move test mint_with_zero_scope_mask_fails 2>&1 | tail -20 && \
  sui move test mint_with_invalid_scope_mask_fails 2>&1 | tail -20
```
验证:
- 退出码 0
- 两条 test 均输出对应 test name、`[ PASS ]` / `[ PASS    ]` 与 `Test result: OK`
- Abort code 分别由 `protocol_tests.move` 中两条 test 的 `#[expected_failure(abort_code = soulidity::grant::EEmptyScopeMask)]` / `#[expected_failure(abort_code = soulidity::grant::EGrantInvalidScopeMask)]` 注解固定；当前 Sui CLI 的 test 输出不会打印 `MoveAbort` 明细

### Test 7.10f: ContentAccessList duration 生命周期

> 复用 Test 7.10a 的 Soul B：Agent Alpha owner 已把 `default_access_duration_ms` 设置为 2000ms，Seller 已完成首次购买。

1. **链上核对初始字段：**
   ```bash
   sui client object $SOUL_B_ACCESS_LIST_OBJ --json 2>&1 | python3 -c "
   import json, sys
   d = json.load(sys.stdin)['data']['content']['fields']
   print('price_atomic:', d['price_atomic'])
   print('default_access_duration_ms:', d['default_access_duration_ms'])
   "
   ```
   - `price_atomic = 1000000`
   - `default_access_duration_ms.vec = [2000]`

2. **DB 验证首次购买写入 expiresAtMs：**
   ```sql
   SELECT grantee_address, scope_mask, price_paid_atomic, granted_at_ms, expires_at_ms
   FROM "content_access_records"
   WHERE soul_on_chain_id = '$SOUL_B_ID' AND grantee_address = '$SELLER_ADDR';
   ```
   - `expires_at_ms` 非 null
   - `expires_at_ms` 落在 Test 7.10a 购买 TX 前后时间窗口 + 2000ms 内（允许 RPC / mirror 等待带来的秒级漂移）

3. **`has_access` 链上查询：未过期时为 true：**
   ```bash
   ACCESS_LIST_ID="$SOUL_B_ACCESS_LIST_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   GRANTEE_ADDRESS="$SELLER_ADDR" \
   REQUIRED_SCOPE=15 \
   npx tsx web/scripts/e2e-content-access-lifecycle.ts inspect-access
   ```
   - 输出 `hasAccess: true`

4. **等待过期后再次查询：**
   ```bash
   sleep 3
   ACCESS_LIST_ID="$SOUL_B_ACCESS_LIST_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   GRANTEE_ADDRESS="$SELLER_ADDR" \
   REQUIRED_SCOPE=15 \
   npx tsx web/scripts/e2e-content-access-lifecycle.ts inspect-access
   ```
   - 输出 `hasAccess: false`

5. **Agent Alpha owner 更新 duration 为 2 小时：**
   ```bash
   OWNER_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY" \
   ACCESS_LIST_ID="$SOUL_B_ACCESS_LIST_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   DURATION_MS=7200000 \
   npx tsx web/scripts/e2e-content-access-lifecycle.ts set-duration
   ```
   - TX digest + `ContentAccessDurationUpdated` 事件 emit
   - 链上对象 `default_access_duration_ms.vec = [7200000]`
   - 既有 Seller entry 不变（测试 "不追溯"）

6. **Seller 续购 → 新 entry 使用 2 小时 duration：**
   ```js
   await window.__e2eSoulidity.purchaseContentAccess({
     soulObjectId: '$SOUL_B_ID',
     accessListOnChainId: '$SOUL_B_ACCESS_LIST_OBJ',
     stateOnChainId: '$SOUL_B_STATE_OBJ',
     priceAtomic: '1000000',
     platformFeeBps: 250
   })
   ```
   - 记录 `CONTENT_ACCESS_PURCHASE_DIGEST_2`
   - `ContentAccessGranted.expires_at_ms` 更新
   - DB 新 `expires_at_ms` 落在续购 TX 前后时间窗口 + 7200000ms 内

### Test 7.10g: Content access 跨所有权转让自动失效 + re-purchase 覆盖

> 验证 ownership_epoch_snapshot 语义：前 owner 下的已付 subscriber 在 Soul 转售后 `has_access` 立即翻 false，且 stale entry 可被 re-purchase 覆盖。
> 前置：Test 7.10a / 7.10f 已让 Seller 在 Agent Alpha 名下拥有 Soul B 的有效 content access。

1. **Agent Alpha 本地签名把 Soul B 重新上架**（不能用 `window.__e2eSoulidity`：该 helper 只签当前浏览器内 stub 钱包，且不提供 list helper）：
   ```sql
   SELECT current_owner_address, current_kiosk_id, current_kiosk_cap_on_chain_id, state_on_chain_id
   FROM soul_assets WHERE on_chain_id = '$SOUL_B_ID';
   ```
   验证 `current_owner_address = $AGENT_ALPHA_ADDR`，记录 `SOUL_B_AGENT_KIOSK_ID` / `SOUL_B_AGENT_KIOSK_CAP_ID`。
   ```bash
   AGENT_PRIVATE_KEY="$E2E_AGENT_ALPHA_PRIVATE_KEY" \
   SOUL_B_AGENT_KIOSK_ID="$SOUL_B_AGENT_KIOSK_ID" \
   SOUL_B_AGENT_KIOSK_CAP_ID="$SOUL_B_AGENT_KIOSK_CAP_ID" \
   PRICE_ATOMIC=1000000 \
   npx tsx -e "
   import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
   import { Transaction } from '@mysten/sui/transactions'
   import { loadKeypairFromEnv } from './scripts/lib/keypair'
   const required = (name) => {
     const value = process.env[name]
     if (!value) throw new Error(name + ' is required')
     return value
   }
   const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })
   const keypair = loadKeypairFromEnv('AGENT_PRIVATE_KEY')
   const sender = keypair.toSuiAddress()
   const tx = new Transaction()
   tx.setSender(sender)
   tx.moveCall({
     target: required('PACKAGE_ID') + '::market::ensure_personal_kiosk_registered',
     arguments: [
       tx.object(required('MARKET_CONFIG_ID')),
       tx.object(required('KIOSK_REGISTRY_OBJ')),
       tx.object(required('SOUL_B_AGENT_KIOSK_CAP_ID')),
     ],
   })
   tx.moveCall({
     target: required('PACKAGE_ID') + '::market::list_soul_fixed_price',
     arguments: [
       tx.object(required('MARKET_CONFIG_ID')),
       tx.object(required('KIOSK_REGISTRY_OBJ')),
       tx.object(required('SOUL_B_AGENT_KIOSK_ID')),
       tx.object(required('SOUL_B_AGENT_KIOSK_CAP_ID')),
       tx.object(required('SOUL_B_STATE_OBJ')),
       tx.pure.id(required('SOUL_B_ID')),
       tx.pure.u64(BigInt(required('PRICE_ATOMIC'))),
     ],
   })
   const bytes = await tx.build({ client })
   const { signature } = await keypair.signTransaction(bytes)
   const result = await client.executeTransactionBlock({
     transactionBlock: Buffer.from(bytes).toString('base64'),
     signature,
     options: { showEffects: true, showEvents: true, showObjectChanges: true },
   })
   await client.waitForTransaction({ digest: result.digest }).catch(() => undefined)
   console.log(JSON.stringify({ sender, digest: result.digest, status: result.effects?.status }, null, 2))
   "
   ```
   - TX success，事件含 `SoulListed`
   - DB / repository sync 后 `SOUL_B_ID.listingStatus = listed`
2. **Buyer 购买 Soul B**：Chrome DevTools 切回 Buyer 登录会话（若当前浏览器已切到 Seller，按 Test 4.2 模板：`evaluate_script` 改 `localStorage['__E2E_PRIVATE_KEY'] = $E2E_BUYER_PRIVATE_KEY` + reload + 重走 stub Login），打开 `/souls/${SOUL_B_ID}/buy`，按 Test 4.4-4.5 购买：
   - 记录 `SOUL_B_RESALE_DIGEST`
   - TX event `SoulPurchased`：`buyer == $BUYER_ADDR`，`seller == $AGENT_ALPHA_ADDR`

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
   - `current_owner == $BUYER_ADDR`

4. **`has_access` 链上查询 Seller（原 subscriber）立即失效：**
   ```bash
   ACCESS_LIST_ID="$SOUL_B_ACCESS_LIST_OBJ" \
   STATE_ID="$SOUL_B_STATE_OBJ" \
   GRANTEE_ADDRESS="$SELLER_ADDR" \
   REQUIRED_SCOPE=15 \
   npx tsx web/scripts/e2e-content-access-lifecycle.ts inspect-access
   ```
   - 输出 `hasAccess: false`（尽管 entry 未过期，epoch 失配直接拒绝）

5. **验证 DB stale 条目仍保留但 API 查询拒绝：**
   ```sql
   SELECT grantee_address, ownership_epoch_snapshot, revoked_at
   FROM "content_access_records"
   WHERE soul_on_chain_id = '$SOUL_B_ID' AND grantee_address = '$SELLER_ADDR';
   ```
   - 记录存在，`revoked_at IS NULL`，但 `ownership_epoch_snapshot` 仍为转售前值（审计行保留）
   - 在 Seller session（stub 切回 `$E2E_SELLER_PRIVATE_KEY` + reload）中调用 skills allowlist 读路径返回 403（该路由按 `ownershipEpochSnapshot = state.ownershipEpoch` 过滤 stale 条目）：
     ```js
     const headers = await window.__e2eSoulidity.getAuthHeaders()
     const res = await fetch(`/api/souls/${SOUL_B_ID}/skills/${SOUL_B_INITIAL_SKILL_NAME}/versions/${SOUL_B_INITIAL_SKILL_VERSION_INDEX}/access`, { headers })
     return { status: res.status, body: await res.json().catch(() => null) }
     ```

6. **Seller 在新 owner 下 re-purchase 覆盖 stale entry：**
   ```js
   await window.__e2eSoulidity.purchaseContentAccess({
     soulObjectId: '$SOUL_B_ID',
     accessListOnChainId: '$SOUL_B_ACCESS_LIST_OBJ',
     stateOnChainId: '$SOUL_B_STATE_OBJ',
     priceAtomic: '1000000',
     platformFeeBps: 250
   })
   ```
   - TX 成功，**不** abort `EAlreadyHasAccess`（合约把 stale-epoch 条目视为可覆盖）
   - 事件 `ContentAccessGranted.ownership_epoch_snapshot` 等于新 epoch
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
     --function register_existing_personal_kiosk \
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
7. 上传 Skills Bundle: `/Users/admin/Documents/example/skill.zip`
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
2. `click` "Sign & Deploy" 按钮（`button:has-text("Sign & Deploy")`）
3. 按"Wallet-paid Walrus 成本确认"循环处理 `UploadCostReview`。当前 fixture fresh run 预期 4 次确认：cover(public)、char(encrypted)、memory(encrypted)、skills(encrypted)。
4. e2e-wallet-stub 自动签名 Walrus register/certify 和 import mint TX
5. `wait_for` URL 含 `/import/success`，timeout 90s

### Test 8.6: Import Step 6 — On-chain Success（`/import/success`）
1. `wait_for` success 页面内容
2. `evaluate_script` 提取 imported Soul on-chain ID，记录为 `$IMPORTED_SOUL_ID`
3. `take_screenshot` → `$ARTIFACT_DIR/phase8-import-done.png`

---

## Phase 9: API 边界 & Hardening（10 tests）

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

### Test 9.7: Agent Asset Access → 404（不存在的 Soul）
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/0x0000000000000000000000000000000000000000000000000000000000000000/assets/default/versions/0/access
```
验证 HTTP 404

### Test 9.8: Agent Asset Access → 400（非法 versionIndex）
```bash
curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${E2E_AGENT_ALPHA_API_KEY}" \
  http://localhost:3100/api/agent/souls/${SOUL_A_ID}/assets/default/versions/abc/access
```
验证:
- HTTP 400
- 响应含 `"versionIndex must be a non-negative integer"`

### Test 9.9: Content Access Purchase → 401（无认证）
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://localhost:3100/api/souls/${SOUL_A_ID}/access-list/purchase
```
验证 HTTP 401（`requireHumanWalletIdentity` 拒绝无认证请求）

### Test 9.10: Anonymous Public Sprite Download → 200 + 字节比对

> 固化 commit 08e2d73。
>
> **前置：** 先用 `web/scripts/e2e-sprite-lifecycle.ts` 给 SOUL_A 上传一个 public sprite（`OWNER_PRIVATE_KEY=$E2E_BUYER_PRIVATE_KEY`，因为 Phase 4 之后 Buyer 是 SOUL_A 的 owner），记录 `assetName` / `versionIndex` / 源 PNG 路径：
>
> ```bash
> SOUL_ON_CHAIN_ID=$SOUL_A_ID \
> OWNER_PRIVATE_KEY=$E2E_BUYER_PRIVATE_KEY \
> DESKTOP_ASSETS_DIR=/Users/admin/Desktop/nao/clawnews/desktop/data/assets \
> npx tsx web/scripts/e2e-sprite-lifecycle.ts append wusaqi public
> ```
>
> 该脚本是白盒 sprite lifecycle helper，当前直接调用 `web/lib/services/walrus.ts` 的 publisher helper，不代表用户 UI 上传主路径；用户 UI 上传主路径仍必须走 `UploadCostReview`。

```bash
SOUL_ID=$SOUL_A_ID \
COMPARE_DIR=/Users/admin/Desktop/nao/clawnews/desktop/data/assets/wusaqi \
ASSET_NAME=persona-sprite \
ASSET_VERSION_INDEX=0 \
BASE_URL=http://localhost:3100 \
npx tsx web/scripts/e2e-public-sprite-anonymous.ts
```

验证：脚本退出 0，stdout 含字节比对成功提示（具体字串以脚本实现为准；脚本同时用 anonymous + bogus Bearer 两次访问 agent assets/access 路由，确认 public 短路在 auth 校验之前）。

---

## Phase 10: 页面渲染冒烟（6 tests）

### Test 10.1: Community Page
1. `navigate_page` → `http://localhost:3100/community`
2. `wait_for` text "Soul Feed"
3. `evaluate_script` 验证 filter tabs 至少包含 "New" 和 "Top"
4. `evaluate_script` 验证侧栏标题为 "Top Contributors"
5. `evaluate_script` 验证主列要么渲染 `article` 列表，要么显示 "No posts yet. Be the first to publish!"

### Test 10.2: Resources — Content Format + Getting Started
1. `navigate_page` → `http://localhost:3100/resources/content-format`
2. `wait_for` text "soul.md" 或 "Content Format"
3. `evaluate_script` 验证页面含 soul.md / memory.md / skill.zip 格式说明
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

## Phase 11: Cleanup（3 tests）

### Test 11.0a: Delete Inactive Soul Listing — 回收 storage rebate

> Phase 4 Buyer 购买 Soul A → `listing.is_active = false` 但对象仍留在 shared pool。
> `market::delete_soul_listing(listing, ctx)` 需要 `!is_active`，析构 + 删 UID。任何签名者均可调用（storage rebate 归调用者），前端可以把这一步拼在购买 PTB 后；本测试独立验证。

1. **读 Soul A 的 listing object id**（Phase 2 records 或链上 query）：
   ```bash
   # 扫描 MarketConfig 的 shared listing 集合，筛出 SOUL_A_ID 的 inactive listing
   sui client events --module market --event-type "SoulPurchased" --json | \
     jq -r '.[] | select(.parsedJson.soul_id == env.SOUL_A_ID) | .parsedJson.listing_id' | head -1
   ```
   记录为 **SOUL_A_LISTING_OBJ**。

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

4. **负向断言**（固化为 Move test）：
   ```bash
   cd /Users/admin/Desktop/nao/clawnews/move/soulidity && \
     sui move test delete_active_soul_listing_fails 2>&1 | tail -20
   ```
   验证退出码 0，输出含 `delete_active_soul_listing_fails`、`[ PASS ]` / `[ PASS    ]` 与 `Test result: OK`。Abort code 由 `protocol_tests.move` 中该 test 的 `#[expected_failure(abort_code = soulidity::market::EListingStillActive)]` 注解固定；当前 Sui CLI 的 test 输出不会打印 `MoveAbort` 明细。

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

### Test 11.1: 清理
1. `evaluate_script`: `localStorage.clear(); sessionStorage.clear();`
2. 运行 DB 清理 SQL（同 Phase -1.1）:
   ```sql
   DELETE FROM "soul_grant_records";
   DELETE FROM "soul_skill_version_records";
   DELETE FROM "soul_memory_entries";
   DELETE FROM "soul_asset_version_records";
   DELETE FROM "content_access_records";
   DELETE FROM "soul_prepared_purchases";
   DELETE FROM "soul_tx_syncs";
   DELETE FROM "soul_collection_assets";
   DELETE FROM "soul_assets";
   DELETE FROM "follows";
   DELETE FROM "bookmarks";
   ```
3. `navigate_page` → `http://localhost:3100/market`
4. `evaluate_script` 验证 "No live Soul listings" 恢复
5. `take_screenshot` → `$ARTIFACT_DIR/phase11-cleanup.png`

---

## 手动介入点（仅 1 项：环境前置 SUI 转账）

> **环境前置 1 次（Phase -1.3）：** AI 派生 4 个测试地址 + 链上查余额 → 列出"缺多少 SUI"清单后暂停；用户从自有 wallet 转入后回告"已转完"，AI 继续。
>
> **USDC 完全自动**：AI `sui client switch` 到 Treasury Owner 后调 `sui client call ... mint`。前置一次性 import Treasury Owner 私钥后永远自动。
>
> **测试运行时 0 介入（Phase 0 onwards）：** W0 完成后，dev-only `e2e-wallet-stub.tsx` 接管全部浏览器钱包签名，**0 popup、0 OTP、0 真扩展依赖**。切角色 = `evaluate_script` 改 `localStorage['__E2E_PRIVATE_KEY']` + reload。Agent 侧 TX 由 `web/scripts/e2e-agent-purchase.ts` 通过 `AGENT_PRIVATE_KEY="$E2E_AGENT_*_PRIVATE_KEY"` 在 Node 直接签。

**全自动覆盖：**
- Stub 钱包 sign-message + sign-transaction（内存 keypair，无 popup，所有 Phase 的链上交易）
- USDC mint（Treasury Owner active address + `sui client call`）
- `sui client` 链上状态查询 / `destroy_invalidated_grant` / rebind / delete listing（Phase -1、5.8、7.10h、11.0a-b）
- `sui move test` 负向断言执行（Phase 5.8 step 5、7.10d、7.10e、11.0a step 4）
- Chrome DevTools MCP 浏览器操作（含 ConnectModal 选 stub）（Phase 0-8、10-11）
- Agent API `curl` 调用（Phase 6.5、7、7.5、9）
- DB SQL 验证与 DB reset（Phase -1、1.6/1.7、11.1）
- `npx tsx` E2E 脚本（Phase 7.3、7.10a/f/g、7.11、7.12、9.10）
- 截图存档（全 Phase）

---

## 状态依赖链

```
Phase -1 (cleanup) → Phase 0 (pre-flight)
Test 1.1 (seller login) → Tests 1.2-1.12
Tests 1.6-1.7 (create Soul A + B, both held) → SOUL_A_ID, SOUL_B_ID, SOUL_A_ACCESS_LIST_OBJ, SOUL_B_ACCESS_LIST_OBJ
Phase 2 (list Soul A + B) → 两个 Soul 变 listed
Tests 2.7-2.8 (market sort/filter) ← 两个 Soul 均 listed 时执行
Phase 3 (collection) → seller session 内创建 Collection → COLLECTION_ID
Test 3.6 (collection floor guard) ← 依赖 collection detail 已正确镜像出子 Soul
Test 4.1 (seller logout) → Test 4.2 (buyer login)
Test 4.3 (market verify) → Tests 4.3a-4.3c (bookmark add/verify/remove)
Test 4.5 (purchase Soul A) → buyer owns Soul A → Phase 5+
Test 5.2 (issue grant via GrantModal) → Tests 5.2a-5.2b (grant capacity via __e2eSoulidity.setGrantCapacity + access_list_id 检查) → Tests 5.3-5.5
Test 5.6 (revoke grant via GrantModal) → Test 5.7
Test 5.8 (destroy_invalidated_grant via sui client call) ← 依赖 Test 5.6 revoke 后留下的僵尸 grant object；负向断言走 `sui move test destroy_invalidated_grant_rejects_active_grant`
Phase 6 (skills append + decrypt) ← Buyer 仍登录 + owns Soul A；Memory read/decrypt 由 Tests 7.11-7.12 覆盖，无单独待办用例
Phase 6.5 (SoulAssets API) ← Buyer 仍登录 + owns Soul A；验证 asset list 空状态和 404 边界
Test 7.1-7.2 (agent search + detail) → 独立只读
Test 7.3 (agent purchase Soul B) → Tests 7.4-7.5 → Tests 7.11-7.12（必须在 7.10g 转售前执行，保证 Agent Alpha 仍 owns Soul B）
Phase 7.5 (ContentAccess API) ← SOUL_B_ACCESS_LIST_OBJ + AGENT_ALPHA_ADDR 已知；写路径一律走链上 TX（stub-signed via `window.__e2eSoulidity` 或 Move test 固化）
Test 7.6 (access-list empty for A + B) 直接覆盖 baseline；Test 7.10a 通过 Agent Alpha owner + Seller 钱包完成付款路由 + 平台抽成 + epoch mirror 联合验证
Tests 7.10b-c（quote 平台抽成 + KioskRegistry manifest 一致性） → 运行环境断言
Tests 7.10d-e（price=0 拒购 + scope_mask 负向） → Move test 固化执行
Test 7.10f（duration 生命周期） → `e2e-content-access-lifecycle.ts` + `window.__e2eSoulidity` 联动
Test 7.10g（epoch 跨转让 re-purchase 覆盖） → Agent Alpha 本地签名重新上架 + Buyer UI 购买 + Seller re-purchase
Test 7.10h（KioskRegistry insert-or-assert + rebind 全矩阵） → dev 账户 `sui client call`，不依赖真人钱包
Phase 8 (import, 6 步 wizard) ← Buyer 仍登录，创建新 Soul
Phase 9 (API boundary) → 独立于浏览器状态；Tests 9.7-9.9 验证 asset/content-access 边界；Test 9.10 验证 anonymous public sprite 字节比对
Phase 10 (page renders + follow) ← 需 SELLER_MEMBER_ID
Phase 11 (cleanup) → delete_soul_listing 回收（Test 11.0a，依赖 Phase 4 purchase 后的 inactive listing；负向走 Move test `delete_active_soul_listing_fails`） → delete_collection_listing 回收（Test 11.0b） → DB 清理（Test 11.1） → 收尾
```

---

## 测试数量汇总

| Phase | Tests | 描述 |
|-------|-------|------|
| 0 | 3 | Pre-flight 冒烟 |
| 1 | 12 | Seller 登录 + Soul 创建（Metadata + AccessList 双对象捕获） |
| 2 | 8 | 上架 Soul A ($1) + Soul B ($2) + Market 排序 / 筛选 |
| 3 | 6 | Collection 创建 + floor price guard |
| 4 | 9 | Buyer 登录 + Bookmark 增删 + 购买 Soul A |
| 5 | 10 | Grant 发放 / 容量调整 / 验证 / 撤销 / destroy_invalidated_grant 回收 |
| 6 | 3 | Skills append + Owner 解密；Memory read/decrypt 在 Tests 7.11-7.12 验收 |
| 6.5 | 4 | SoulAssets API（list 空状态 + 404 边界） |
| 7 | 7 | Agent API 主流程 + Seal 解密 + 逐字节内容比对 |
| 7.5 | 9 | ContentAccess API：空状态 + paid purchase 付款路由 / 平台抽成 / epoch mirror + KioskRegistry manifest 一致性 + price=0 拒购 + scope_mask 负向 + duration 生命周期 + epoch 跨转让 re-purchase + KioskRegistry rebind 矩阵 |
| 8 | 6 | Import 流程（6 步 wizard） |
| 9 | 10 | API 边界（asset / content-access 404/400/401）+ anonymous public sprite 字节比对 |
| 10 | 6 | 页面渲染 + Follow/Unfollow |
| 11 | 3 | Cleanup（delete_soul_listing + delete_collection_listing + DB 清理） |
| **Total** | **96** | |

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

## E2E Helper 函数（/create/gas 页面）

Gas 页（`web/app/create/gas/page.tsx`）在 `useEffect` 中挂载以下全局函数，仅在 CreateSoulProvider context 完整时可用：

| 函数 | 签名 | 用途 | E2E 使用 |
|------|------|------|----------|
| `__e2ePublish` | `(params: PublishParams) => Promise` | 触发 mint TX | Phase 1 create 流程 |
| `__e2eUpload` | `(fileContent: string, fileName: string, type?: 'public'\|'encrypted') => Promise<UploadResult>` | 白盒 Walrus 上传 helper；当前实现自动 approve quote，仅用于调试，不替代主流程 `UploadCostReview` | 辅助调试 |
| `__e2eListSoul` | `(params: { currentKioskId, currentKioskCapOnChainId, stateObjectId, soulObjectId, priceAtomic }) => Promise` | 上架 | Phase 2 list 流程 |
| `__e2eGetAuthHeaders` | `() => Promise<Record<string, string>>` | 获取 `{ 'x-csrf-token': csrf }`（cookie `session` 由浏览器自动携带） | 通用 |
| `__e2eIssueGrant` | `(params: { stateObjectId, granteeAddress, scopeMask, soulObjectId }) => Promise` | 发放 grant | **已废弃** — Phase 5 改用 GrantModal UI |
| `__e2eRevokeGrant` | `(params: { stateObjectId, granteeAddress, soulObjectId }) => Promise` | 撤销 grant | **已废弃** — Phase 5 改用 GrantModal UI |
| `__e2eLastSealMaterial` | 已实现（create/import gas 页） | `{char,memory,skills,sprite}` Pending Seal material 暴露点 | Phase 7.12 逐字节比对 |
| `__e2eSoulidity` | 已实现（dev-only AppProviders helper） | content access purchase / price / duration / grant capacity helper；`setGrantCapacity` 已内部 POST `/api/souls/[id]/grant-capacity` mirror（无需测试侧再单独 cURL） | Phase 5.2a + Phase 7.10a/f/g |
| `E2EWalletStub` | 已实现的 dev-only Wallet Standard 钱包桩（`web/components/providers/e2e-wallet-stub.tsx`） | 通过 `localStorage['__E2E_PRIVATE_KEY']` 注入 keypair → ConnectModal 自动列出 → 0 popup 签所有 message / TX | Phase 0 onwards 全部登录与签名 |

**使用前提：** 从 `/create` 走完 wizard 到 `/create/gas`，保持 CreateSoulProvider context 完整（name + description + coverImageFile + charFile + memoryFile 非空）。

> **Grant 管理已迁移到 GrantModal UI**：Phase 5 不再需要导航到 gas 页。Grant 发放/撤销通过 My Souls 页的 GrantModal 组件（`web/components/souls/grant-modal.tsx`）直接完成，使用 `useGrant` hook 调用链上 TX。

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
| `web/components/souls/memory-panel.tsx` | Memory Panel — Phase 1.8, 6.3 |
| `web/components/souls/persona-asset-panel.tsx` | Persona Sprite 管理面板（owner-only，append + activate + delete + clear） |

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
| `web/app/api/agent/souls/[id]/skills/[skillName]/versions/[versionIndex]/access/route.ts` | Agent Skills Seal 访问 |
| `web/app/api/agent/souls/[id]/memory/[entryKey]/access/route.ts` | Agent Memory Seal 访问 |
| `tests/new-web/soulidity-agent-server.test.ts` | Auth 中间件单元测试 |

### Taxonomy API
| 文件 | 用途 |
|------|------|
| `web/app/api/souls/tags/route.ts` | Tag cloud API（top 50 tags by count）— 替代 Category 分类 |

### E2E 脚本（已实现 / W0 标注）
| 文件 | 用途 |
|------|------|
| `web/scripts/e2e-agent-purchase.ts` | Agent 购买（prepare → local sign → execute → verify access） |
| `web/scripts/e2e-agent-decrypt.ts` | Agent Seal 解密（SHA-256 hash 校验） — Phase 7.11 |
| `web/scripts/e2e-agent-verify-content.ts` | Seal 内容逐字节比对（SHA-256 + byte compare） — Phase 7.12 |
| `web/scripts/e2e-content-access-lifecycle.ts` | ContentAccess duration 生命周期 — Phase 7.10f |
| `web/scripts/e2e-sprite-lifecycle.ts` | Sprite append / activate / delete / clear lifecycle helper — Phase 9.10 前置 |
| `web/scripts/e2e-public-sprite-anonymous.ts` | 匿名 public sprite 下载 + 字节比对 — Phase 9.10 |
| `scripts/lib/keypair.ts` | `loadKeypairFromEnv` — bech32 / base64 / hex 解析（Phase -1.2 用） |
| `scripts/e2e-setup-agents.ts` | env-driven create-or-update：从 `E2E_AGENT_*_PRIVATE_KEY` 派生地址，并从 `E2E_AGENT_*_API_KEY` 写入 hash |

### Soulidity SDK
| 文件 | 用途 |
|------|------|
| `web/lib/soulidity/access.ts` | Seal 访问逻辑（`resolveSoulAccessPayload`） |
| `web/lib/soulidity/repository.ts` | Soul 查询 + 序列化 |
| `web/lib/soulidity/queries.ts` | 链上读取 + 报价 |
| `web/lib/soulidity/tx/buy.ts` | 购买 TX builder |
| `web/lib/soulidity/tx/publish.ts` | 发布 TX builder |
| `web/lib/soulidity/personal-kiosk.ts` | Personal kiosk 解析 |
| `web/lib/soulidity/mirror/` | Post-TX DB 镜像同步 |
| `web/lib/soulidity/events.ts` | TX 事件提取 |
| `web/lib/soulidity/upload-validation.ts` | 文件上传验证（MIME, 签名, 大小, skill bundle） |
| `web/lib/soulidity/content-schema.ts` | Content 验证 schema |
| `web/lib/soulidity/content-templates.ts` | soul.md / memory.md / skill.md 模板 |
| `web/lib/soulidity/object-inputs.ts` | On-chain object input helpers |

### Auth + 上传 API
| 文件 | 用途 |
|------|------|
| `web/app/api/auth/wallet-challenge/route.ts` | 发 nonce + sign-in message（rate limit 30/60s） |
| `web/app/api/auth/wallet-login/route.ts` | 校验签名 → 写 `session` + `csrf-token` cookies；同源 + rate limit 20/60s |
| `web/app/api/auth/me/route.ts` | 当前用户信息（GET，无需 CSRF） |
| `web/app/api/auth/logout/route.ts` | 清 cookies（带 CSRF 校验） |
| `web/app/api/souls/upload/route.ts` | 已退役为 410；不再接受 server-side Soul upload |
| `web/app/api/souls/upload/token/route.ts` | 已退役为 410；不再签发 Vercel Blob token |
| `web/app/api/souls/upload/from-blob/route.ts` | 已退役为 410；不再接受 Vercel Blob staging finalize |
| `web/app/api/collections/upload-image/route.ts` | 已退役为 410；Collection cover 走 wallet-paid browser Walrus |
| `web/app/api/profile/cover/route.ts` | 已退役为 410；Profile cover 走 wallet-paid browser Walrus |
| `web/app/api/souls/[id]/grant-capacity/route.ts` | 链上 `GrantCapacityUpdated` 事件 mirror |
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

## 已知约束与缓解

所有条目均为当前必须满足的执行前提 / 断言要求，不保留待办、延期或备用分支测试项。

### 环境与工具

1. **Fresh publish 清账**：Phase -1 必须把 `soul_*` / `content_access_records` / `soul_prepared_purchases` / `soul_tx_syncs` / `follows` / `bookmarks` 全部清空；旧链上 object 一律不可继承（package / kiosk registry / listings / access list / grant 均从 fresh publish 重建）。
2. **Sui CLI 前置**：`which sui && sui --version`，要求 >= 1.69.0 + testnet RPC 可达；任一不满足则 Phase -1 阻塞。
3. **USDC Treasury**：`sui client call` mint USDC 前必须 `sui client switch --address 0x76fd52cac79bda80806be6b5ab7f3b1f099a966203cce809254919a7ab755728`（treasury owner）。
4. **Agent 钱包前置**：DB 必须有 `members.kind='agent' + agent_status='active' + api_key_hash IS NOT NULL` 的 Alpha / Beta 两条记录及其 `wallet_bindings`。`scripts/e2e-setup-agents.ts` 已是 env-driven create-or-update；运行前需先让 owner wallet 通过浏览器登录写入 `WalletBinding`，再用 `E2E_AGENT_*_PRIVATE_KEY` / `E2E_AGENT_*_API_KEY` 派生并同步 agent。Agent keypair 调用 Node 脚本时通过 `AGENT_PRIVATE_KEY="$E2E_AGENT_*_PRIVATE_KEY"` 注入。
5. **Agent API 基础设施**：`web/app/api/agent/*` 路由与 `web/lib/soulidity/agent-server.ts::requireAgentWalletIdentity` 已全部落地，复用 `@web/lib/auth/resolve-agent` / `getMemberSuiWalletAddresses`；`web/lib/soulidity/coin-selection.ts` 已独立拆分。

### 工作流与时序

6. **Create/Import wizard 状态链**：CreateSoulProvider / ImportSoulProvider 用 React context 维护跨页状态；gas 页有 `missingStep1` / `missingStep2` 守卫。测试必须按 Step 1 → 2 → 3 → gas 顺序走，不得跳步直达 gas。
7. **Wallet 扩展不进入测试链路**：dapp-kit `ConnectModal` 是普通 React dialog；在 dev 模式下 `e2e-wallet-stub` 注册一个 Wallet Standard 钱包到 modal，无任何浏览器扩展依赖。Stub 内部用 `localStorage['__E2E_PRIVATE_KEY']` 重建 Ed25519 keypair；切角色靠 `evaluate_script` 改 localStorage + reload。
8. **Rate limit**：dev 环境使用内存 rate limiter；本计划自动化流量处在阈值内。
9. **Agent 购买两步签名 TTL**：prepare → execute 之间必须在 10 分钟内完成，否则 `/api/agent/souls/{id}/purchase/execute` 返回 410。
10. **Collection directory upload**：Chrome DevTools MCP `upload_file` 不支持 `webkitdirectory` picker；Phase 3.2 使用 `evaluate_script` 构造 File + DataTransfer + dispatch change event，此为唯一执行路径。
11. **Import 字段映射**：`soul.md` 作为 source file 时 name/description 不会自动映射，Phase 8.3 必须通过 Chrome DevTools MCP `fill` 写入 `E2E Imported Soul` 与 `Imported from local file`。
12. **Seal 逐字节比对前置**：Phase 7.12 脚本需要在 create / import gas 页结束瞬间捕获 `window.__e2eLastSealMaterial` 的完整 JSON；不再需要 `SOUL_UPLOAD_SECRET` 或 raw DEK envelope。
13. **Follow 测试前置**：Phase 10.6 依赖 Phase -1.2 记录的 `SELLER_MEMBER_ID`。
14. **Bookmark 时序**：Phase 4.3a-4.3c 必须在 Buyer 登录后、购买前执行（需要 Market 列表两个 Soul 均 listed）。
15. **Admin 面板范围外**：7 个 admin 页面 + 11 个 admin API 路由不在本轮覆盖面（无 admin 测试账号）。

### 合约 / SDK 契约

16. **Fresh publish manifest 唯一真相**：运行时读取的 packageId / marketConfigId / kioskRegistryId / soulTransferPolicyId / collectionTransferPolicyId / upgradeCapId / upgradeStateId 必须来自 `web/lib/soulidity/deployment-manifest.json`；`move/soulidity/Published.toml` 只交叉校验 `published-at` / `original-id` / `upgrade-capability`（不记录 `upgradeStateId`）。Test 7.10b 做 manifest 一致性断言。
17. **Mint 签名扩展参数**：`mint_native_in_personal_kiosk` / `mint_imported_in_personal_kiosk` / `mint_joined_in_personal_kiosk<T>` 在 `asset_*` 组之后依次插入 sprite 5 项 + voice 4 项 + `content_access_price_atomic/u64` + `content_access_default_scope_mask/u64` + `content_access_default_duration_ms/Option<u64>` + `creator_royalty_bps/u16`。所有直接构造 PTB 的外部调用者必须与 SDK 对齐；本计划统一走 `web/lib/soulidity/tx/*` builder。
18. **SoulMetadata mint 自动创建**：mint 内部自动 `metadata::create()` + `share_metadata()`；`SoulAsset.metadataOnChainId` 在 publish sync 路由 mirror。Phase 1.8 / 1.9 断言该字段非空；fixture 不含 sprite / voice，因此 `activeSprite* / activeVoice*` 字段为 null。
19. **ContentAccessList 与 SoulState 一一绑定**：mint 自动创建 ContentAccessList 并写入 `SoulState.access_list_id`；`market::purchase_content_access` 双向校验 `state.access_list_id == object::id(access_list)`（`EAccessListLinkageMismatch = 29`）。
20. **付款路由 + 平台抽成**：content access paid purchase 的 USDC 发给 `soul::current_owner(state)`，平台抽成按 `MarketConfig.platform_fee_bps` 切入（默认 250 bps）。Tests 7.10a / 7.10b 断言此行为。
21. **Scope mask 硬约束**：`ContentAccessList.default_scope_mask ∈ {非零子集 of 15}`；SDK builder 默认 `ALL_ACCESS_SCOPES = 15`。绕过 SDK 传 0 或非法 bit 由 `grant::assert_valid_scope_mask` abort（Test 7.10e 由 `protocol_tests.move` 固化）。
22. **Price=0 免费 access 只能 owner `add_access`**：`market::purchase_content_access` 拒绝 `price_atomic = 0`（`EContentAccessNotPurchasable = 28`）。Test 7.10d 由 `protocol_tests.move::purchase_content_access_with_zero_price_fails` 固化。
23. **ContentAccessList.duration**：`default_access_duration_ms: Option<u64>` 决定新购买 entry 的 `expires_at_ms = now + duration`；`None = 终身`；`set_content_access_duration` 只影响后续购买、不追溯既有 entry。Test 7.10f 走 `web/scripts/e2e-content-access-lifecycle.ts` + `window.__e2eSoulidity.purchaseContentAccess` 完成。
24. **Grant capacity 调整**：默认 `grant_capacity = 1`；`grant::set_grant_capacity(state, capacity, clock, ctx)` 要求 `capacity >= active_grant_count` + `capacity <= MAX_GRANT_CAPACITY`。GrantModal 不暴露此控件；Test 5.2a 通过 `window.__e2eSoulidity.setGrantCapacity` 由 Buyer owner stub 钱包签名完成；helper 内部已自动 POST `/api/souls/[id]/grant-capacity` 同步 mirror（无需测试侧再单独 cURL）。
25. **SoulGrant 僵尸回收**：Test 5.6 revoke 后 `SoulGrant` owned object 仍留在 grantee 钱包；`grant::destroy_invalidated_grant` 无额外身份校验，但 Sui 在 Move 执行前做 owned-object 归属校验，sender 必须持有该对象。Test 5.8 切到 Agent Alpha 地址签名；Active grant 负向断言由 `protocol_tests.move::destroy_invalidated_grant_rejects_active_grant` 固化。
26. **Listing 回收**：`market::delete_soul_listing` / `delete_collection_listing` 要求 `!is_active`。Test 11.0a / 11.0b 正向回收；负向 `EListingStillActive = 30` 由 `protocol_tests.move::delete_active_soul_listing_fails` 固化。
27. **KioskRegistry insert-or-assert + rebind 全矩阵**：`register_existing_personal_kiosk` / `ensure_personal_kiosk_registered` 语义为 insert-or-assert，同 cap 幂等、不同 cap abort `EPersonalKioskMismatch`。换 kiosk 唯一合法路径 `market::rebind_primary_kiosk`，要求旧 kiosk `item_count == 0`（`EOldKioskNotEmpty = 31` / `EOldKioskMismatch = 32` / `ERebindSameKiosk = 33`）。Test 7.10h 由 dev 账户 `sui client call` 覆盖；`buildRebindPrimaryKioskTx` 不对终端用户暴露（无 `window.__e2eSoulidity` helper，设计如此）。
28. **ContentAccess epoch-pinned**：`ContentAccessEntry.ownership_epoch_snapshot` 与 `SoulState.ownership_epoch` 必须相等才有效；Soul 转售后旧 subscriber 的 `has_access` 立即翻 false，stale 条目保留作审计；re-purchase 在新 owner 下覆盖 stale 行（TX 成功 + entry 刷新）。`ContentAccessGranted` 事件含 `ownership_epoch_snapshot`；Prisma / mirror / `asset-version-access.ts` / agent access route 全链路按 `ownershipEpochSnapshot = state.ownershipEpoch` 过滤，stale 直接 403 不触发 Seal round-trip。Test 7.10g 覆盖。
29. **Seal document id 长度严格 `==`**：`seal_policy` / `skills` / `assets` 的 `assert_matching_document_id` 拒绝尾部多余字节；TS SDK 已对齐精确字节长度，E2E 无额外断言需求。
30. **Category → Tags taxonomy**：Create 页无 Category 下拉，Market 页无 category filter，仅 Tags 自由输入 + `/api/souls/tags`（top 50 tag cloud）。Prisma `soul_assets.category` 仍保留 `@default("Other")` 但全程不暴露。Phase 1.2 / 2.7-2.8 / 10 不涉及 Category 断言。
31. **ContentAccess API 写路径全链上**：`/api/souls/[id]/access-list/add|purchase|revoke` 强制 `requireHumanWalletIdentity` + `parseRequiredTxDigest` + `assertTransactionSender`，从链上事件 upsert DB。本计划所有 content-access 写入均经 `window.__e2eSoulidity.purchaseContentAccess` 或 Move test 完成，不使用 SQL 直写模拟。

32. **CSRF + Same-Origin 强约束**：所有走 cookie auth 的 mutating 路由（以 `web/lib/auth/identity.ts::requireMutationIdentity` / `requireHumanWalletIdentity({ mutation })` 为真值）要求 `x-csrf-token` header 与 session 内 `csrfHash` 匹配，并且 Origin/Referer 与请求 host 同源。E2E `curl` 调用必须同时传 `Cookie: session=...; csrf-token=...` + `x-csrf-token: ...` 两份。`/api/auth/wallet-login` 与 `/api/auth/logout` 还要 `Origin: http://localhost:3100`。Agent API 路径走 `Authorization: Bearer sk-...` 不受影响。

33. **wallet-paid Walrus 上传链路**：`uploadSoulPayload` 在浏览器本地校验、加密、计算 quote，并通过 `UploadCostReview` 要求用户确认 Walrus storage / Sui gas / relay tip 后才发起钱包签名。当前产品上限是 `MAX_SOUL_UPLOAD_BYTES = 500 MiB`；`<= 50 MiB` 单 blob，`> 50 MiB` 自动 16 MiB chunk + manifest，quote TTL 60 秒，文件 / 网络 / relay / chunk plan 变化必须重新确认。测试网执行还必须考虑 Phase -1.8 的 Walrus capability probe：协议 blob 上限可由 `walrus info --context testnet` 查询，但公共 relay / publisher 的实际 HTTP body、rate limit 与 413/429/5xx 行为可能更低；默认 96 项主流程不把 `> 50 MiB` live upload 作为 testnet 公共服务通过条件。旧 Vercel Blob staging 路由、server-side Soul upload、collection/profile server upload 路由均返回 410；E2E 也不再依赖 `BLOB_READ_WRITE_TOKEN`、`WALRUS_PUBLISHER_URL`、`SOUL_UPLOAD_SECRET` 或 legacy upload 短路。`__e2eUpload` 是白盒 helper，会自动 approve quote，不能替代主流程成本确认验收。

34. **e2e-wallet-stub 前置（W0，2026-04-27 已落地）**：`web/components/providers/e2e-wallet-stub.tsx` 已挂在 `app-providers.tsx` development 分支（双门控：`NODE_ENV === 'development'` AND `NEXT_PUBLIC_E2E_TEST_MODE === '1'`）。该桩通过 `localStorage['__E2E_PRIVATE_KEY']` 重建 Ed25519 keypair，注册到 dapp-kit `getWallets()`（经 `wallet-standard:app-ready` handshake）。未设 `NEXT_PUBLIC_E2E_TEST_MODE=1` 或非 dev 环境时不进入 bundle/不挂载，普通开发会话即便 localStorage 残留 `__E2E_PRIVATE_KEY` 也不会激活。Phase -1.5 自检：`evaluate_script` 在任意页面运行 `(navigator.wallets ?? []).some(w => w.name === 'E2E Test Wallet')`，未设 `__E2E_PRIVATE_KEY` 前应为 `false`，设了 + reload 后应为 `true`。

35. **`scripts/e2e-setup-agents.ts` env-driven（W0.2，2026-04-27 已重写）**：从 `E2E_AGENT_ALPHA_PRIVATE_KEY` / `E2E_AGENT_ALPHA_API_KEY` / `E2E_AGENT_BETA_PRIVATE_KEY` / `E2E_AGENT_BETA_API_KEY` 派生地址 + 计算 SHA-256，幂等 `findOrCreate` `Account` / `Member(kind='agent', agentStatus='active')` / `WalletBinding(chain='sui')`。两次连续运行得到相同 member ID 与 hash。脚本入口 `import './lib/dotenv'` 自动加载 `.env` + `.env.local`。

36. **`web/next.config.ts` 加载 `.env.local`（2026-04-27 新增）**：原本只 `dotenv.config({ path: '../.env' })`，现追加 `dotenv.config({ path: '../.env.local', override: true })`。E2E 用的 `NEXT_PUBLIC_E2E_TEST_MODE=1` + `E2E_*` 私钥都放在 `.env.local`，dev server 起来时一并注入。

37. **Client-built Seal sidecar 契约**：create/import/wrap/memory/skills/assets mirror 路由只接受客户端在 TX 成功后生成的 Seal sidecar object，并用链上事件 / object id 绑定校验 document id。`window.__e2eLastSealMaterial` 只给 Phase 7.12 本地逐字节比对使用，不能作为 API body 直接提交；raw DEK envelope string 必须返回 400。

---

## 验证标准

默认验收口径：
- Phase -1 仅作为环境准备单独记录，不计入通过率
- 96 项主流程全部通过（Phase 0 + 1 + 2 + 3 + 4 + 5 + 6 + 6.5 + 7 + 7.5 + 8 + 9 + 10 + 11 = 3+12+8+6+9+10+3+4+7+9+6+10+6+3）
- Test 7.10a 必须完成 `price_atomic > 0` 的 e2e-wallet-stub（内存 keypair）paid purchase（Seller 签名，付款 recipient 为 Agent Alpha owner），并在 DB 镜像中看到 `ownershipEpochSnapshot` 与 `SoulState.ownership_epoch` 一致
- Tests 7.10d / 7.10e / 5.8 step 5 / 11.0a step 4 的负向断言全部走 `sui move test` 固化路径，输出对应 test name + `[ PASS ]` / `[ PASS    ]` + `Test result: OK`；abort code 以 `protocol_tests.move` 中的 `#[expected_failure(abort_code = ...)]` 注解为准
- Test 7.10f duration 生命周期通过 `web/scripts/e2e-content-access-lifecycle.ts` + `window.__e2eSoulidity.purchaseContentAccess`（stub 钱包续购）完成
- Test 7.10g epoch 跨转让 + re-purchase 覆盖必须同时验证：转售后 `has_access = false` + DB stale 行保留但 API 403 + re-purchase 成功后 entry 覆盖
- Test 7.10h KioskRegistry rebind 全矩阵必须覆盖：同 cap 幂等（no-op）/ 不同 cap abort / 非空旧 kiosk abort / 正向 rebind
- Phase 5.2 / 5.6 grant 发放 & 撤销全部走 GrantModal UI；Phase 5.2a 容量调整走 `window.__e2eSoulidity.setGrantCapacity`（helper 内部已 mirror）；Phase 5.8 destroy_invalidated_grant 走 `sui client call`（CLI active-address 必须为 `GRANT_OBJ` 持有者，本流程为 Agent Alpha）
- Phase 7.11 / 7.12 Seal 链路必须跑通：Phase 7.11 `e2e-agent-decrypt.ts` 退出 0 + content hash 匹配；Phase 7.12 `e2e-agent-verify-content.ts` 输出 `OK 3 artifact(s) matched byte-for-byte.`（char / memory / skills 三个 artifact 全匹配）
- Phase 1 / 3 / 6 / 8 所有 UI 上传都必须实际出现并确认 `UploadCostReview`；确认前不得出现 Walrus register/certify 或 Soul mint/list/append TX 签名
- Phase -1.8 必须记录 testnet Walrus relay tip-config；如果 relay 不可达，后续上传失败按环境阻塞处理，不把主流程失败误判成产品回归。`> 50 MiB` live smoke 只有在显式设置 `E2E_WALRUS_LIVE_LARGE_UPLOAD=1` 且 probe 通过后才纳入本轮证据。
- Test 9.10 匿名 public sprite 下载属于 Phase 9 主验收：`SOUL_ON_CHAIN_ID=$SOUL_A_ID npx tsx web/scripts/e2e-sprite-lifecycle.ts append wusaqi public` 生成 public sprite 后，`web/scripts/e2e-public-sprite-anonymous.ts` 必须用 anonymous + bogus Bearer 两条路径拿到 `visibility=public` + `walrusBlobId`，并完成源 PNG 字节比对
- 截图存档到 `$ARTIFACT_DIR`（默认 `e2e-artifacts/<RUN_DATE>/`）
- 测试结果更新到 `docs/e2e-test-results-new-web.md`
- Repo guard 必须保持：用户上传 UI / 核心 upload helper 不引用 `/api/souls/upload*`、`@vercel/blob/client`、`sealDekEnvelope`、raw envelope submit；生产用户上传 env 不依赖 `WALRUS_PUBLISHER_URL`、`SOUL_UPLOAD_SECRET`、`BLOB_READ_WRITE_TOKEN`
- Phase 11 cleanup 完成后：market 恢复空状态；DB `soul_*` / `content_access_records` / `follows` / `bookmarks` 均为空；Soul A 的 SoulListing 与 Collection 的 CollectionListing 对象均 `Object has been deleted`
- 所有 mutating cURL 必须同时携带 `Cookie: session=...; csrf-token=...` + `x-csrf-token` header；缺任一返回 403（环境失败，非业务失败）
- W0 已完成但每次运行仍需在 Phase -1.5 自检：确认 `NODE_ENV=development`、`NEXT_PUBLIC_E2E_TEST_MODE=1` 且 `e2e-wallet-stub.tsx` 已挂载（否则 Test 1.1 会卡在 ConnectModal，不能算业务失败）
