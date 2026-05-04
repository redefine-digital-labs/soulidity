# Plan — 后置 Persona Sprite 上传 + 新合约重新部署

**Status**: Executed through 2026-05-02 combined mainnet reset plan (`docs/plans/2026-05-02-soulidity-mainnet-reset-and-post-mint-sprite.md`). The Move entry, frontend hook/UI, DB reset script, and resolver fix from this plan all landed under that combined plan. The mainnet publish, production DB reset, smoke run, and cap handoff are now operator steps tracked in the combined plan.

## Context

**问题来源**：上一轮把 Persona Sprite 相关 UI 从所有 mint 流程（create / import / wrap-link / collections）的"上传阶段"移除后，新铸的 Soul 不会再创建 `SoulAssets` 链上根对象。但 `components/souls/persona-asset-panel.tsx`（已挂载在 `app/souls/[id]/page.tsx:349` owner-only）依赖 `soul.assetsOnChainId` 才能 append sprite 版本。结果就是：mint 不传 sprite 的 Soul，永远无法在详情页后补 sprite——`useAssets.appendAndActivateSprite` 在 `lib/hooks/use-assets.ts:322` 会抛 "Soul is missing on-chain assets/metadata roots"。

**根因**：`assets::create` / `assets::share_assets` 在 `move/soulidity/sources/assets.move` 是 `public(package)`，链上没有任何 mint 之外的入口能补建 SoulAssets root。

**目标**：让 Soul owner 在 mint 之后任意时刻，能给已铸 Soul 上传 sprite + config，并设置 visibility（public / private）。具体期望体验：详情页 PersonaAssetPanel 在 `assetsOnChainId == null` 时仍可上传，一次 PTB 完成"创建 SoulAssets root + 写第 1 版 sprite + 写两个 metadata blob + 设为 active"。

**部署策略**：在 Sui mainnet **重新部署一个全新的 soulidity package**（不走升级路径），DB 镜像清空。所有现有链上 Soul / Collection / Grant / Memory / Skill / Asset / AccessList 对象由旧 package 持有，对新合约不可见，DB 里对应的镜像行同步删除。

---

## 改动总览

| 层 | 文件 | 动作 |
|----|------|------|
| Move | `move/soulidity/sources/market.move` | 新增 `public fun init_assets_and_append_sprite_as_owner` + 新错误码 `EAssetsRootAlreadyExists = 34` |
| Move | `move/soulidity/sources/assets.move` | 不动；`assets::create` / `assets::share_assets` / `assets::append_initial_version` 都是 `public(package)`，从 `market` 同包合法调用 |
| Move 部署 | `move/soulidity/Move.toml` + `Published.toml` | 重新发布；记录新 package id / upgrade cap |
| 前端配置 | `web/lib/soulidity/deployment-manifest.json` | 替换 mainnet 整段对象 ID（packageId、marketConfigId、kioskRegistryId、soulTransferPolicyId、collectionTransferPolicyId、marketUpgradeStateId、upgradeCapId、marketAdminCapId） |
| 前端 hook | `web/lib/hooks/use-assets.ts` | `appendAndActivateSprite` 分支：`assetsOnChainId == null` 走新入口，否则走原 `append_version_as_owner` 路径 |
| 前端 UI | `web/components/souls/persona-asset-panel.tsx` | 移除 `assetsOnChainId` 为 null 时的灰显（line 222），改为正常显示上传面板；`canManage` 条件去掉 `assetsOnChainId` 检查 |
| 前端 mirror | `web/app/api/souls/[id]/assets/route.ts` | 兼容首次创建：从同一笔 TX 解析 `SoulAssetsCreated` 事件 + `AssetVersionAppendedEvent`；调用 `syncSoulProjectionFromChain`（已经能从 `state.assetsId` 自动捕获，无需改） + `upsertAssetVersionProjection` |
| DB | Prisma | 清空 8 个含链上 id 的表（保留 Member / WalletBinding / Account 等身份层） |

---

## Phase 1 — Move 合约改动

### 1.1 新增 entry 函数（`market.move`）

放置位置：`market.move` 现有 `set_active_sprite`（line 949）附近，作为同主题 owner 操作。

```move
public fun init_assets_and_append_sprite_as_owner(
    state: &mut SoulState,
    metadata_obj: &mut SoulMetadata,
    asset_name: std::string::String,
    is_public: bool,
    content_blob: Blob,
    sprite_config: vector<u8>,    // 写入 metadata blob，键由前端约定 sprite.config.v1
    sprite_mood_map: vector<u8>,  // 写入 metadata blob，键由前端约定 sprite.mood_map.v1
    sprite_config_key: std::string::String,
    sprite_mood_map_key: std::string::String,
    download_policy: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    soul::assert_owner(state, ctx.sender());
    assert!(soul::assets_id(state).is_none(), EAssetsRootAlreadyExists);

    let mut assets_book = assets::create(soul::soul_id(state), ctx);
    let version_index = assets::append_initial_version(
        &mut assets_book,
        asset_name,
        is_public,
        ASSET_TYPE_SPRITE,
        content_blob,
        clock,
        ctx,
    );

    // 必须在 set_assets_id 之前把 metadata 关联好；upsert 不依赖 assets_book
    metadata::upsert_metadata_blob(metadata_obj, state, sprite_config_key, sprite_config, ctx);
    metadata::upsert_metadata_blob(metadata_obj, state, sprite_mood_map_key, sprite_mood_map, ctx);

    let binding = metadata::new_asset_binding(asset_name, version_index, download_policy);
    // 注意：现有 metadata::set_active_sprite 不接受 assets 引用（4 参版本，line 146）；
    // 不走 market::set_active_sprite（那个是 6 参 + 需要 assets 引用），而是直接调 metadata 模块版本
    metadata::set_active_sprite(metadata_obj, state, option::some(binding), ctx);

    soul::set_assets_id(state, object::id(&assets_book));
    assets::share_assets(assets_book);
}
```

### 1.2 新增错误码（`market.move` 顶部 const 块）

现有最大编号是 33（line 31-64 区间），插入：
```move
const EAssetsRootAlreadyExists: u64 = 34;
```

### 1.3 不需要改 `assets.move`

`assets::create`、`assets::share_assets`、`assets::append_initial_version` 都是 `public(package)`，从 `market` 模块同包调用合法。`assets.move` 不动。

### 1.4 不需要改 `metadata.move`

`metadata::set_active_sprite`（line 146-164，4 参版本）、`metadata::upsert_metadata_blob`（line 202-225）、`metadata::new_asset_binding`（line 121-132）都已经是合适的可见性，签名直接可用。注意区分 `metadata::set_active_sprite`（4 参，被新入口调用）和 `market::set_active_sprite`（line 949，6 参带 assets 引用，被既有 append flow 调用）。

### 1.5 关键不变量

- `soul::set_assets_id`（`soul.move:305`）已自带 `assert!(state.assets_id.is_none())` + `EAssetsAlreadyBound = 12`，等于双重保险，但保留合约里显式的 `EAssetsRootAlreadyExists` 让前端能拿到清晰报错。
- 整个函数原子化：任一中途 abort，PTB 全回滚，不会出现孤儿 `SoulAssets`。

---

## Phase 2 — 重新部署（mainnet）

### 2.1 流程（用户手动执行）

1. 在 `move/soulidity/` 跑 `sui move build` 验证编译通过。
2. `sui client switch --env mainnet`，确认账户。
3. `sui client publish --gas-budget <budget>` —— `init` 自动执行，emit `MarketInitialized` 和 `KindRegistryCreated`。
4. 从 publish 输出收集：
   - **package id**（顶层）
   - **upgrade cap id**（owned by deployer）
   - 从 `MarketInitialized` 事件读：`config_id` / `registry_id` / `soul_policy_id` / `collection_policy_id`
   - 从 `KindRegistryCreated` 事件读：`registry_id` / `admin_cap_id`
   - deployer 钱包里出现的：`MarketAdminCap`、`KindAdminCap`、两个 `TransferPolicyCap<Soul>` / `TransferPolicyCap<SoulCollectionRight>`。
5. `MarketUpgradeState` 已移除；升级治理以 `UpgradeCap` 归属、多签和必要时 freeze 为准。

### 2.2 文件更新

- `move/soulidity/Published.toml`：新建 `[published.mainnet]` 段（覆盖现有），写入 `published-at`、`original-id`、`upgrade-capability`、`version = 1`。
- `web/lib/soulidity/deployment-manifest.json`：替换 `mainnet` 段全部 ID。
- `move/soulidity/Move.toml`：`[addresses] soulidity = "0x0"` 保持，发布脚本会处理。

### 2.3 用户侧影响（重要风险点）

- 所有用户的 personal kiosk 是 `kiosk::Kiosk`（由 kiosk package 拥有，不是 soulidity package），**对象本身不会作废**。但新合约的 `KioskRegistry` 是空的，用户首次操作时需要走 `ensure_personal_kiosk_registered` 或 `init_personal_kiosk` 重新登记一次。
- 旧 package 持有的所有 Soul / SoulMetadata / SoulState / SoulMemory / SoulSkills / SoulAssets / Soul Grant / ContentAccessList / SoulCollection / SoulCollectionRight / SoulListing / CollectionListing 都成为孤儿——新合约调用既不能引用、也不能销毁它们，这些对象会永久占用链上空间。
- 旧 `TransferPolicy<Soul>` / `TransferPolicy<SoulCollectionRight>` / `MarketConfig` / `KioskRegistry` / `KindRegistry` 同上。

---

## Phase 3 — 前端联动

### 3.1 `web/lib/hooks/use-assets.ts`

- **第 290 行 `canManage`**：去掉 `soul?.assetsOnChainId` 条件 → `Boolean(soul?.isOwner && soul?.metadataOnChainId)`。
- **第 315-447 行 `appendAndActivateSprite`**：
  - 删掉第 322-324 行的 `if (!soul.assetsOnChainId || ...)` 抛错。
  - 新增分支：
    ```ts
    if (!soul.assetsOnChainId) {
      // 首次：走 init_assets_and_append_sprite_as_owner（单 PTB）
      // 不需要 set_active_sprite 单独 moveCall，新入口已经包含 active binding 设置
      tx.moveCall({
        target: `${packageId}::market::init_assets_and_append_sprite_as_owner`,
        arguments: [
          tx.object(soul.stateOnChainId),
          tx.object(soul.metadataOnChainId),
          tx.pure.string(SPRITE_ASSET_NAME),
          tx.pure.bool(params.visibility === 'public'),
          tx.object(uploaded.blobObjectId),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(spriteConfigJson))),
          tx.pure.vector('u8', Array.from(new TextEncoder().encode(spriteMoodMapJson))),
          tx.pure.string(SPRITE_CONFIG_KEY),
          tx.pure.string(SPRITE_MOOD_MAP_KEY),
          tx.pure.u8(policyToU8(downloadPolicy)),
          tx.object('0x6'),
        ],
      })
    } else {
      // 已有 root：走原 append_version_as_owner + 2× upsert_metadata_blob + market::set_active_sprite
      // （现有第 352-398 行代码原封保留）
    }
    ```
  - `assertObjectInputsExist` 在 `assetsOnChainId == null` 分支跳过 `'Soul assets'` 校验项。

### 3.2 `web/components/souls/persona-asset-panel.tsx`

- 第 134 行 `Tag color={soul.assetsOnChainId ? 'teal' : 'muted'}`：保留状态显示，但把"no root"改成"new root"提示语，表明可以创建。
- 第 219-223 行：把"This Soul was minted without a sprite assets root."分支删掉，让 `canManage` 为 true 的 owner 始终能看到上传 UI。
- 上传按钮文案：`assetsOnChainId == null` 时显示"Create root & set active"，否则保留"Upload & Set Active"。

### 3.3 `web/app/api/souls/[id]/assets/route.ts`（POST handler）

- 现有第 103 行 `extractAssetVersionAppendedEvent` 在新入口下仍然有效——`append_initial_version` 内部调用 `append_version_impl`，发同样的事件。
- 新增：在同一 TX 里也解析 `SoulAssetsCreated` 事件（`assets.move:118`），把 `assetsId` 兜底写入。但 `syncSoulProjectionFromChain` 已经会从 `state.assets_id` 读出来（`upsert-soul.ts:30-32`），所以新事件解析非必须，**优先依赖 state 重读**。
- `upsertAssetVersionProjection`（line 153-168）参数无需变化。

### 3.4 类型 / 镜像层补充

- `web/lib/soulidity/types.ts` 中 `SoulAssetDetail.assetsOnChainId: string | null` 已经是 nullable，无需改类型。
- `useAssets` 内部对 `soul.assetsOnChainId` 的读取在 `assertObjectInputsExist`（line 332-337）和 `appendVersionAccess` 调用处都要加 null guard。

---

## Phase 4 — DB 镜像清空

### 4.1 清空范围（保留 Member / 身份层）

按 Prisma schema 里**含链上对象 id**的表，全部 truncate（含级联）：
- `SoulAsset`
- `SoulAssetVersionRecord`
- `SoulCollectionAsset`
- `SoulGrantRecord`
- `SoulMemoryEntry`
- `SoulSkillVersionRecord`
- `ContentAccessRecord`
- `SoulPreparedPurchase`
- 任何引用上述表的关联表（评论 / 收藏 / 评分等若挂在 `SoulAsset` 上需级联）

### 4.2 保留范围

- `Member`、`Account`、`WalletBinding`（钱包绑定不依赖合约 package id，只是地址）
- `MagicLink` / `Session` / TG 身份相关
- `Article` / `Publication` / `RawItem`（资讯流，与 soulidity 无关）
- `Achievement` / `LeaderboardEntry`（如有）—— 取决于是否依赖 Soul 数据，需逐项确认；本计划范围内默认保留，按需后补。

### 4.3 执行方式

写一份一次性 Prisma 清理脚本（`scripts/wipe-soulidity-mirror.ts`），手工跑：
```ts
await prisma.$transaction([
  prisma.soulAssetVersionRecord.deleteMany({}),
  prisma.soulGrantRecord.deleteMany({}),
  prisma.soulMemoryEntry.deleteMany({}),
  prisma.soulSkillVersionRecord.deleteMany({}),
  prisma.contentAccessRecord.deleteMany({}),
  prisma.soulPreparedPurchase.deleteMany({}),
  prisma.soulCollectionAsset.deleteMany({}),
  prisma.soulAsset.deleteMany({}),
])
```

部署时序：**先清 DB，再切 deployment-manifest.json，再 deploy 前端**。如果先切配置但 DB 没清，旧 `assetsOnChainId` 等字段会让前端尝试调用旧 package 引用导致全链路 404。

---

## 关键文件路径速查

### 待改文件
- `move/soulidity/sources/market.move` — 新增 entry + 错误码
- `move/soulidity/Published.toml` — 部署后写新 ID
- `web/lib/soulidity/deployment-manifest.json` — 整段 mainnet 替换
- `web/lib/hooks/use-assets.ts` — appendAndActivateSprite 分支
- `web/components/souls/persona-asset-panel.tsx` — 解锁 null assetsOnChainId UI
- `web/app/api/souls/[id]/assets/route.ts` — 兼容首次创建
- `scripts/wipe-soulidity-mirror.ts`（新建）

### 已就绪可复用
- `web/lib/soulidity/mirror/upsert-soul.ts:30-32` — 已自动从 `state.assetsId` 读 `assetsOnChainId`
- `web/lib/soulidity/mirror/sync-helpers.ts:24-151` — 全链状态再读机制成熟
- `web/lib/soulidity/persona-sprite.ts:113` — `validatePersonaSpriteDraft` 复用
- `move/soulidity/sources/assets.move:130` — `append_initial_version` 同包可调
- `move/soulidity/sources/metadata.move:121,146,202` — `new_asset_binding` / `set_active_sprite`(4参) / `upsert_metadata_blob` 全部直接可调

---

## 验证流程（端到端）

### Move 单元测试
1. 在 `move/soulidity/tests/` 加 `init_assets_and_append_sprite_test.move`：
   - 测路径 1：mint 不传 sprite → 调新入口 → 断言 `state.assets_id.is_some()` + `metadata.active_sprite()` 命中
   - 测路径 2：mint 不传 sprite → 调新入口 → 再调一次 → 应 abort `EAssetsRootAlreadyExists`
   - 测路径 3：非 owner 调用 → 应 abort owner check
2. `sui move test` 全绿。

### Devnet / Testnet 联调
1. 切 `sui client switch --env testnet`，先在 testnet 完整跑一遍 publish + init + 用前端 mint 一个无 sprite Soul + 详情页 PersonaAssetPanel 上传 sprite。
2. 验证：DB `SoulAsset.assetsOnChainId` 从 null 变为新 id；`SoulAssetVersionRecord` 出现 v1；详情页面板展示 active v1。

### Mainnet 部署后冒烟
1. 用一个备用钱包 mint 一个不带 sprite 的 Soul。
2. 在详情页用 PersonaAssetPanel 上传 sprite + config，分别测 public 和 private visibility 各一次（用两个不同 Soul 测，避免 `EAssetsRootAlreadyExists`）。
3. 验证：
   - 链上 `SoulState.assets_id` 出现
   - 镜像层 `SoulAsset.assetsOnChainId` 出现
   - `SoulAssetVersionRecord` 出现 v1
   - 详情页 active sprite 渲染正常（public 直链 Walrus；private 走 Seal 密钥流）
4. 在已上传 sprite 的 Soul 再追加 v2：验证走的是原 append 路径（应不触发新入口），active 切到 v2。

---

## 已知风险与回退

- **mainnet 弃旧不可逆**：发布新 package 后旧合约对象永久孤儿。无法回退到"基于旧 package 继续运行"——前端配置一旦切走，旧 Soul 的所有详情页 / 列表 / 上架都失效。
- **personal kiosk 重新登记摩擦**：老用户首次在新合约下卖货前要触发 `ensure_personal_kiosk_registered`，前端需要给一个清晰提示（不在本计划范围，但部署后必须立即跟上）。
- **upgrade cap 误失**：`init_impl` 把 `MarketAdminCap` + 两个 `TransferPolicyCap` 转给 deployer 钱包，妥善保管，否则后续无法调 `update_fee_recipient` / 改 transfer policy。
- **DB 清空后任何索引型读路径短暂为空**：community / leaderboard 如果挂在 SoulAsset 上的统计查询会瞬时返回空，需要确认 UI 容错。
