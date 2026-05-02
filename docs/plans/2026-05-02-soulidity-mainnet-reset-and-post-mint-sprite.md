# 主网 Soulidity 重置 + Post-Mint Persona Sprite 入口

## 结论

本轮按一次完整主网收口执行：修正 mainnet `PersonalKioskCap` resolver、新增 post-mint sprite root 创建入口、fresh publish 新 `soulidity` package、清空 Soulidity 镜像数据、部署 web、完成主网 smoke、把治理能力转入多签、同步所有 deployment 文档与审计记录。

交付完成态只有一种：代码、合约、manifest、`Published.toml`、生产 DB、线上 web、主网治理对象和相关文档全部一致。任何 publish 已成功但 cap 未转移、manifest 带旧 digest、DB 未清、web 未部署、smoke 未通过、文档未标记的状态都只是执行中断点，不能作为完成态。

## Owner 与验收

| 项 | Owner | 完成标准 |
|---|---|---|
| 实现 | Codex / implementer | resolver、Move entry、frontend hook/UI、reset script、tests 均落地 |
| 主网 publish | mainnet deployer EOA via `MAINNET_DEPLOYER_PRIV_KEY` | 新 package、config、registry、policies、upgrade state、admin/policy/display caps 全部从 publish 输出提取并存档 |
| 生产治理 | multisig `0xcaab58c145b4c0479f662a88bcb9d4db9f1f391f8ec19535b1ef75ce08879294` | `MarketAdminCap`、`TransferPolicyCap<Soul>`、`TransferPolicyCap<SoulCollectionRight>`、`UpgradeCap`、`Display<Soul>`、`Display<SoulCollectionRight>` 均归属多签，`track_upgrade_cap` 已记录 |
| DB reset | deploy operator | Soulidity mirror 表和 desktop `sourceType='soul'` catalog entries 清空，desktop active soul profile 指针归零；身份、资讯流、starter persona、desktop session 表保留 |
| Web 发布 | deploy operator | Vercel production 使用新 manifest；`NEXT_PUBLIC_SUI_NETWORK=mainnet`；核心页面和 API smoke 通过 |
| 主网 smoke | deploy operator + wallet owner | collection 创建恢复；post-mint sprite 首次创建 root、追加 v2、公有/私有渲染均通过 |

## 已观察事实

1. 当前主网 collection 创建失败的直接原因不是用户 `PersonalKioskCap` 丢失。链上实测 wallet `0xf1e23e7d...` 仍持有 cap `0x547b81723e1bf23f3d4565bd93f8d0d597af97db86f0924c7144dc2b754b0f70`，`cap.for` 指向 registry 里的 kiosk `0xf27df1...`。问题是 web/API 用 `0x434b5bd8...::personal_kiosk::PersonalKioskCap` 做 mainnet owned-object filter，真实 type origin 是 `0x0cb4bcc0560340eb1a1b929cabe56b33fc6449820ec8c1980d69bb98b649b802`。
2. `assets::create`、`assets::share_assets`、`assets::append_initial_version` 在 `move/soulidity/sources/assets.move` 是 `public(package)`；mint 之外没有 public entry 能创建 `SoulAssets` root。当前 `web/lib/hooks/use-assets.ts:322` 在 `assetsOnChainId == null` 时直接抛错，详情页 post-mint sprite 永远无法补建 root。
3. `NEXT_PUBLIC_SOULIDITY_*` 的公开合约配置由 `web/lib/soulidity/deployment.ts::getSoulidityDeployment()` 读取 `web/lib/soulidity/deployment-manifest.json`，不是直接读 `.env`。本轮只改 manifest 的 `mainnet` 段；`.env` 不承载这些 ID。
4. 当前 `web/lib/soulidity/deployment-manifest.json` 的 mainnet 段有 17 个字段：`packageId`、`marketConfigId`、`kioskRegistryId`、`soulTransferPolicyId`、`collectionTransferPolicyId`、`paymentCoinType`、`publishTxDigest`、`upgradeCapId`、`upgradeStateId`、`marketAdminCapId`、`soulPolicyCapId`、`collectionPolicyCapId`、`soulDisplayId`、`collectionDisplayId`、`multisigOwner`、`capTransferTxDigest`、`trackUpgradeCapTxDigest`。fresh publish 后所有链上对象字段都必须替换为新值；`paymentCoinType` 保持主网 USDC `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC`。
5. `move/soulidity/Move.toml` 当前主网 publish 依赖形态是：USDC `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7`、stablecoin `0xecf47609d7da919ea98e7fd04f6e0648a0a79b337aaad373fa37aac8febf19c8`、sui_extensions `0xe0917b74a5912e4ad186ac634e29c922ab83903f71af7500969f9411706f9b9a` 均来自 Circle pinned git source + mainnet `addr_subst` / `dep-replacements.mainnet`；Kiosk 来自 `MystenLabs/apps` pinned git source，original id 是 `0x434b5bd8f6a7b05fede0ff46c6e511d71ea326ed38056e3bcd681d2d7c2a7879`，mainnet published package 是 `0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3`；Walrus 使用 `mainnet-contracts/walrus`。不再依赖本地 `move/test_usdc` 或 `move/vendor/kiosk`。fresh publish 前必须做 linkage preflight，确认 Kiosk package / `PersonalKioskCap` type origin、Walrus `Blob`、USDC 类型在 mainnet runtime 下和 web 传入对象一致。
6. `scripts/publish-soulidity-and-sync.ts` 已能从 publish 输出提取 manifest 字段，写 `Published.toml`，并通过 `--transfer-caps-to` 构造包含 `track_upgrade_cap` 的 cap transfer PTB。该脚本是主路径；手工 `sui client publish` 只作为故障时的排障工具。

## 执行顺序

### Step 0 - Freeze 与证据确认

1. 记录当前 branch、HEAD、dirty files，不覆盖用户已有改动。
2. 用显式 mainnet 参数确认现状，不依赖 active env：

```bash
sui client --client.env mainnet object 0x547b81723e1bf23f3d4565bd93f8d0d597af97db86f0924c7144dc2b754b0f70 --json
sui client --client.env mainnet object 0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3 --json
```

验收：cap owner 是 `0xf1e23e7d...`，`cap.for` 是 `0xf27df1...`；official kiosk package 的 `personal_kiosk::PersonalKioskCap` type origin 是 `0x0cb4...`。

### Step 1 - PersonalKioskCap Resolver 修正

目标文件：

| 路径 | 动作 |
|---|---|
| `web/lib/soulidity/kiosk.ts` | 新增独立 `OFFICIAL_MAINNET_PERSONAL_KIOSK_CAP_TYPE_PACKAGE_ID = 0x0cb4...`；mainnet `getPersonalKioskCapStructType()` 返回该 type package |
| `web/lib/soulidity/personal-kiosk.ts` / tests | 覆盖 registry `(kiosk, cap)` 与 owned cap 同时存在时返回 `ready` |
| `web/lib/soulidity/queries.ts` tests | 覆盖 `listOwnedPersonalKioskCaps()` 使用正确 struct type |

实现要求：

- `OFFICIAL_MAINNET_KIOSK_PACKAGE_ID = 0xdfb4...` 继续用于调用 `personal_kiosk::new`。
- `0x434b5bd8...` 不再用于 `PersonalKioskCap` owned-object filter；如仍保留，只能用独立常量名表达对应 rule/type，不再叫 kiosk type package。
- registry 有 entry 且 wallet 确实不持有匹配 cap 时才返回 conflict；错误 type-origin 不能制造 conflict。

验收：

- `NEXT_PUBLIC_SUI_NETWORK=mainnet` 时 `getPersonalKioskCapStructType()` 返回 `0x0cb4...::personal_kiosk::PersonalKioskCap`。
- `resolveOwnedPersonalKiosk()` 在 registry 记录 `(kiosk, cap)` 且 owned cap 列表含同一 `(kiosk, cap)` 时返回 `ready`，不抛 `SoulidityPersonalKioskInvariantError`。

### Step 2 - Move Entry 新增

目标文件：`move/soulidity/sources/market.move`。

在现有 `set_active_sprite` 附近新增 entry：

```move
public fun init_assets_and_append_sprite_as_owner(
    state: &mut SoulState,
    metadata_obj: &mut SoulMetadata,
    asset_name: std::string::String,
    is_public: bool,
    content_blob: Blob,
    sprite_config: vector<u8>,
    sprite_mood_map: vector<u8>,
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

    metadata::upsert_metadata_blob(metadata_obj, state, sprite_config_key, sprite_config, ctx);
    metadata::upsert_metadata_blob(metadata_obj, state, sprite_mood_map_key, sprite_mood_map, ctx);

    let binding = metadata::new_asset_binding(asset_name, version_index, download_policy);
    metadata::set_active_sprite(metadata_obj, state, option::some(binding), ctx);

    soul::set_assets_id(state, object::id(&assets_book));
    assets::share_assets(assets_book);
}
```

新增错误码：

```move
const EAssetsRootAlreadyExists: u64 = 34;
```

实现要求：

- 不改 `assets.move` 和 `metadata.move`。`market` 与它们同包，直接调用 `public(package)` 函数合法。
- `soul::set_assets_id` 已有 `EAssetsAlreadyBound = 12` 作为第二道保护；`EAssetsRootAlreadyExists = 34` 用于更清晰的入口级报错。
- 整个函数必须保持一笔 PTB 原子性：任一中途 abort，不能留下孤儿 `SoulAssets`。

Move tests 加在 `move/soulidity/sources/protocol_tests.move`：

- `init_assets_and_append_sprite_succeeds_for_owner_without_existing_root`
- `init_assets_and_append_sprite_fails_when_root_already_exists`
- `init_assets_and_append_sprite_fails_for_non_owner`

验收：`sui move test` 全量通过，新增三条测试均执行。

### Step 3 - Frontend Post-Mint Sprite 联动

目标文件：

| 路径 | 动作 |
|---|---|
| `web/lib/hooks/use-assets.ts` | `canManage` 去掉 `assetsOnChainId` 条件；`appendAndActivateSprite` 增加首次 root 创建分支；签名后立即断言 effects success |
| `web/components/souls/persona-asset-panel.tsx` | owner 在 `assetsOnChainId == null` 时仍看到上传 UI；状态文案改为可创建 root；按钮区分首次创建与追加版本 |
| `web/app/api/souls/[id]/assets/route.ts` | 保持现有 `AssetVersionAppended` 事件解析和 `syncSoulProjectionFromChain` 重读链上 state；用回归测试证明首次 root 创建 TX 可被 mirror |
| `web/lib/sui/tx-result.ts` 调用点 | `use-assets.ts` 引入并调用 `assertSuiTxSucceeded` |

`use-assets.ts` 实现要求：

```ts
const canManage = Boolean(soul?.isOwner && soul?.metadataOnChainId)
```

首次 root 创建分支：

```ts
if (!soul.assetsOnChainId) {
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
  // Existing append_version_as_owner + 2x metadata::upsert_metadata_blob + market::set_active_sprite path.
}
```

Additional requirements:

- `assertObjectInputsExist` 在首次 root 创建分支不检查 `'Soul assets'`，仍检查 state、metadata、uploaded blob。
- `signAndExecute(tx)` 返回后立刻执行 `assertSuiTxSucceeded(result, 'Soul sprite asset transaction')`。只有 effects success 后才能写 recovery、调用 mirror API 或更新 local state。
- private sprite 没有 Seal material 时必须失败，不写 mirror。
- 已有 root 的 Soul 仍走原 append 路径，active version 使用同 PTB 返回的 `version_index`，不依赖 DB 快照。

UI 验收：

- `assetsOnChainId == null` 时 tag 文案为 `ready to create root`。
- owner 可看到上传表单，按钮显示 `Create root & set active`。
- 已有 root 时按钮保持 `Upload & Set Active`。
- 非 owner 仍只看到只读提示。

### Step 4 - DB Reset Script

目标文件：`scripts/reset-soulidity-mirror.ts`。

CLI contract：

```bash
npx tsx scripts/reset-soulidity-mirror.ts --dry-run
npx tsx scripts/reset-soulidity-mirror.ts --apply
```

实现要求：

- 默认是 dry-run；`--apply` 才执行写操作。
- 打印每张表将删除的行数。
- `--apply` 全程在一个 transaction 内执行。
- 删除顺序必须尊重 FK，并覆盖所有旧 package mirror 关系。

删除范围：

```ts
await prisma.$transaction([
  prisma.contentAccessRecord.deleteMany({}),
  prisma.soulSkillVersionRecord.deleteMany({}),
  prisma.soulMemoryEntry.deleteMany({}),
  prisma.soulGrantRecord.deleteMany({}),
  prisma.soulAssetVersionRecord.deleteMany({}),
  prisma.bookmark.deleteMany({}),
  prisma.soulPreparedPurchase.deleteMany({}),
  prisma.soulUploadBinding.deleteMany({}),
  prisma.soulTxSync.deleteMany({}),
  prisma.desktopCatalogEntry.deleteMany({ where: { sourceType: 'soul' } }),
  prisma.desktopProfile.updateMany({
    where: { activeSourceType: 'soul' },
    data: { activeSourceType: null, activeSourceRef: null },
  }),
  prisma.soulAsset.updateMany({ data: { collectionOnChainId: null } }),
  prisma.soulAsset.deleteMany({}),
  prisma.soulCollectionAsset.deleteMany({}),
])
```

保留范围：

`Member`、`Account`、`WalletBinding`、`WalletChallenge`、`RawItem`、`Article`、`ArticleCompany`、`Publication`、`Post`、`Comment`、`PostVote`、`Achievement`、`MemberAchievement`、`Skill`、`StarterPersonaAsset`、`DesktopDeviceSession`、Telegram/auth/collector/producer 表全部保留。

验收：

- dry-run 输出删除计数但不改 DB。
- apply 后 Soulidity mirror 查询为空：Soul、Collection、Grant、Memory、Skill version、Asset version、ContentAccess、PreparedPurchase、Soul upload binding、Soul tx sync、desktop soul catalog entries 均为 0；desktop profile 不再指向 `activeSourceType='soul'`。
- starter persona catalog entries 仍存在。

### Step 5 - Local Verification

本地验证按低成本到高成本执行：

```bash
npm run test -- --run tests/scripts/publish-soulidity-and-sync.test.ts
npm run typecheck
cd move/soulidity && sui move build
cd move/soulidity && sui move test
cd web && npm run build
```

验收：

- publish script tests 覆盖 manifest extraction、cap transfer PTB、resume flow。
- web typecheck/build 通过。
- Move build/test 通过。
- 新增 resolver、post-mint sprite、DB reset script 的 focused tests 通过。

### Step 6 - Mainnet Publish

首选命令（publish-only；cap handoff 留到 Step 9）：

```bash
CLAWNEWS_LOAD_ENV_LOCAL=false \
NEXT_PUBLIC_SUI_NETWORK=mainnet \
npm run publish:soulidity -- \
  --use-env-key --mainnet-e2e \
  --gas-budget=5000000000 \
  --payment-coin-type=0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC
```

`--mainnet-e2e` 让脚本只 publish，不在同一笔运行里推 cap 到多签；smoke 失败可在 deployer 手里回滚，不会污染多签。`CLAWNEWS_LOAD_ENV_LOCAL=false` 防止 dev 用的 `.env.local`（`NEXT_PUBLIC_SUI_NETWORK=testnet`）覆盖 inline 设置。

正式签名前先跑同一命令加 `--dry-run`：脚本会构造 PTB、做 `dryRunTransactionBlock`、打印 status / gasUsed / objectChanges 数量，无任何链上写入也不修改 manifest。

Preflight：

1. `MAINNET_DEPLOYER_PRIV_KEY` 可加载（脚本默认从 `.env` 读取，`.env.local` 不应再设置），并派生出预期 deployer。
2. Deployer gas >= 6 SUI。
3. `NEXT_PUBLIC_SUI_NETWORK=mainnet`（确认未被 `.env.local` 覆盖）。
4. `sui move build` 通过。
5. Linkage preflight 通过：
   - Kiosk：web `PersonalKioskCap` filter 是 `0x0cb4...::personal_kiosk::PersonalKioskCap`。
   - Walrus：Move `Blob` 类型与 web wallet-paid mainnet upload 传入的 blob object type 一致。
   - USDC：sale/collection dry run 使用 manifest 的 mainnet USDC 类型，不解析到本地 test coin。

Publish 输出必须存档：

```bash
mkdir -p docs/deployments
cp /tmp/<publish-output>.json docs/deployments/mainnet-soulidity-YYYYMMDD-HHMMSS.json
```

Manifest / Published 验收：

- `web/lib/soulidity/deployment-manifest.json.mainnet` 写入新 `packageId`、`marketConfigId`、`kioskRegistryId`、两个 policy、`publishTxDigest`、`upgradeCapId`、`upgradeStateId`、`marketAdminCapId`、两个 policy cap、两个 display。
- `move/soulidity/Published.toml[published.mainnet]` 的 `published-at`、`original-id`、`upgrade-capability` 指向新 package / upgrade cap。
- 中间 manifest 不得沿用旧 `capTransferTxDigest` / `trackUpgradeCapTxDigest`。cap handoff 完成前这两个字段必须不存在。

### Step 7 - Production DB Reset 与 Web Deploy

执行顺序固定：

1. 备份 production DB：

```bash
pg_dump "$DATABASE_URL" > "$HOME/backups/clawnews-db-$(date +%Y%m%d-%H%M%S).sql"
```

2. 对 production target env 跑 reset dry-run：

```bash
npx tsx scripts/reset-soulidity-mirror.ts --dry-run
```

3. 核对 dry-run 行数与主网弃旧范围一致后执行：

```bash
npx tsx scripts/reset-soulidity-mirror.ts --apply
```

4. 提交并部署 web：包含新合约源码、tests、reset script、新 manifest、新 `Published.toml`、publish JSON 存档。
5. Vercel production redeploy 完成后检查：

```bash
curl -I https://<production-host>/
curl -I https://<production-host>/market
curl -I https://<production-host>/my-souls
curl -I https://<production-host>/create/gas
curl -I https://<production-host>/api/auth/me
```

验收：

- 生产 DB 已无旧 Soulidity mirror 数据。
- 线上 bundle 读取新 mainnet manifest。
- 核心页面 200 或预期 auth 状态；没有 manifest 解析错误。

### Step 8 - Mainnet Smoke

按顺序验证：

1. 用户 wallet `0xf1e23e7d...` 登录 web。
2. GET `/api/souls/personal-kiosk`：
   - wallet 持有 `0x0cb4...::personal_kiosk::PersonalKioskCap` 时返回 `ready`。
   - registry 有 entry 且 owned cap 匹配时不抛 `SoulidityPersonalKioskInvariantError`。
   - wallet 确实没有任何 cap 时才返回缺失状态。
3. `/collections/create` 创建 Collection：
   - 已有 cap 走复用/ensure 路径，不创建第二个 cap。
   - 无 cap 走自动建新 kiosk 路径。
   - `/api/collections/create` 回写后 DB 出现 `SoulCollectionAsset` 行。
4. mint 一个不带 sprite 的 Soul。
5. 在详情页 PersonaAssetPanel 上传 public sprite + config：
   - 链上 `SoulState.assets_id` 从 none 变成新 object id。
   - DB `SoulAsset.assetsOnChainId` 写入新 id。
   - DB `SoulAssetVersionRecord` 出现 v1。
   - active sprite public 直连 Walrus 渲染。
6. 用另一个无 sprite Soul 上传 private sprite + config：
   - private Seal sidecar 写入。
   - active sprite 走 Seal 访问。
7. 对已有 root 的 Soul 追加 v2：
   - 走原 `assets::append_version_as_owner` 路径。
   - active 切到 v2。
8. 观察 Sentry / Vercel logs：
   - 没有 `SoulidityPersonalKioskInvariantError` 误报。
   - 没有 `MissingSoulidityDeploymentError`。
   - 没有 failed effects 被 mirror 成功记录。

### Step 9 - Governance Handoff

Smoke 通过后立即执行 cap handoff。

Dry-run：

```bash
CLAWNEWS_LOAD_ENV_LOCAL=false \
NEXT_PUBLIC_SUI_NETWORK=mainnet \
npm run publish:soulidity -- \
  --resume-cap-transfer-from-manifest \
  --dry-run-transfer-only \
  --transfer-caps-to=0xcaab58c145b4c0479f662a88bcb9d4db9f1f391f8ec19535b1ef75ce08879294
```

Execute：

```bash
CLAWNEWS_LOAD_ENV_LOCAL=false \
NEXT_PUBLIC_SUI_NETWORK=mainnet \
npm run publish:soulidity -- \
  --resume-cap-transfer-from-manifest \
  --transfer-caps-to=0xcaab58c145b4c0479f662a88bcb9d4db9f1f391f8ec19535b1ef75ce08879294
```

验收：

- `market::track_upgrade_cap` 成功执行。
- manifest 写入新 `multisigOwner`、`capTransferTxDigest`、`trackUpgradeCapTxDigest`。
- Deployer 不再持有 `MarketAdminCap`、两个 `TransferPolicyCap`、`UpgradeCap`、两个 Display。
- 多签地址持有以上 6 个治理对象。
- 再提交 manifest-only diff 并触发 production redeploy。

如果 cap transfer 命令失败：

1. 读取脚本写入的 `partialDeploymentReason`。
2. 修复错误后立刻重跑 resume 命令。
3. resume 仍失败且原因影响治理安全时，停止 web 发布，恢复上一版 manifest 和 DB backup；链上新 package 保留但不作为线上 runtime。

### Step 10 - 文档与审计收口

必须同轮更新：

| 路径 | 动作 |
|---|---|
| `docs/plans/2026-04-23-rebind-primary-kiosk.md` | 状态改为 `Superseded by 2026-05-02 fresh publish reset for mainnet runtime`; 保留历史实现说明 |
| `docs/plans/2026-05-02-post-mint-persona-sprite-and-fresh-redeploy.md` | 状态改为 `Executed through 2026-05-02 combined mainnet reset plan` |
| `docs/audits/2026-04-03-soulidity-audit.md` | 追加 Fix Log：新 packageId、新 `init_assets_and_append_sprite_as_owner` entry、resolver fix、cap handoff tx |
| `docs/deployments/mainnet-soulidity-YYYYMMDD-HHMMSS.json` | 保存 publish 输出 |

验收：

- 文档不再把 kiosk recovery、post-mint sprite、cap handoff、runbook 抽取写成下一轮工作。
- 所有文档引用的新 package、upgrade cap、cap transfer digest 与 manifest 一致。

## 目标文件清单

| 路径 | 类型 | 验收 |
|---|---|---|
| `move/soulidity/sources/market.move` | 改 | 新 entry + `EAssetsRootAlreadyExists = 34` |
| `move/soulidity/sources/protocol_tests.move` | 改 | 新增三条 Move tests |
| `move/soulidity/Published.toml` | 改 | mainnet 指向新 package / upgrade cap |
| `web/lib/soulidity/deployment-manifest.json` | 改 | mainnet 全量替换，新 cap handoff digest 写入 |
| `web/lib/soulidity/kiosk.ts` | 改 | mainnet cap struct type origin 为 `0x0cb4...` |
| `web/lib/soulidity/personal-kiosk.ts` / tests | 改 | registry + owned cap 匹配返回 ready |
| `web/lib/hooks/use-assets.ts` | 改 | null assets root 可首次创建；effects success 后才 mirror |
| `web/components/souls/persona-asset-panel.tsx` | 改 | owner 可创建 root；按钮文案区分首次和追加 |
| `web/app/api/souls/[id]/assets/route.ts` / tests | 验证为主 | 首次 root 创建 TX 的 `AssetVersionAppended` 可被 mirror |
| `scripts/reset-soulidity-mirror.ts` | 新建 | dry-run/apply、计数、transaction、清空 desktop soul catalog 并重置 active soul profile，保留身份与资讯流 |
| `docs/deployments/mainnet-soulidity-YYYYMMDD-HHMMSS.json` | 新建 | publish 输出存档 |
| `docs/plans/2026-04-23-rebind-primary-kiosk.md` | 改 | 标明主网 runtime 已由 fresh publish reset 替换 |
| `docs/plans/2026-05-02-post-mint-persona-sprite-and-fresh-redeploy.md` | 改 | 标明由本合并计划执行 |
| `docs/audits/2026-04-03-soulidity-audit.md` | 改 | 追加 Fix Log |

## 回滚点

| 阶段 | 回滚动作 | 边界 |
|---|---|---|
| publish 前 | 仅 revert code/doc diff | 无链上影响 |
| publish 后、web deploy 前 | 保持 production manifest 不切新 package；不清 DB；新 package 作为废弃链上对象 | 已花费 gas，链上对象无法删除 |
| DB reset 后、web deploy 前 | `psql "$DATABASE_URL" < "$HOME/backups/clawnews-db-YYYYMMDD-HHMMSS.sql"` | 恢复旧镜像后仍运行旧 package |
| web deploy 后、smoke 失败 | 恢复上一版 manifest + DB backup，redeploy production | kiosk resolver / post-mint sprite 问题回到旧行为 |
| cap handoff 失败 | 修复并 resume handoff；无法安全 resume 时恢复上一版 production runtime | 新 package 不进入完成态 |

## 最终验收标准

- `sui move test` 通过。
- `npm run typecheck` 通过。
- `cd web && npm run build` 通过。
- `scripts/reset-soulidity-mirror.ts --dry-run` 和 `--apply` 行为已验证。
- `deployment-manifest.json.mainnet`、`Published.toml[published.mainnet]`、publish JSON 存档一致。
- Production DB 仅清除 Soulidity mirror、desktop soul catalog entries 和 active soul profile 指针，身份/资讯流/starter/desktop session 数据保留。
- Production web 读取新 mainnet manifest。
- Collection 创建恢复。
- Post-mint sprite 首次 root 创建、public/private 渲染、已有 root 追加 v2 全通过。
- 多签持有 6 个治理对象，deployer 不再持有这些对象。
- `capTransferTxDigest` 与 `trackUpgradeCapTxDigest` 是新 package 的 tx digest。
- 三份相关 plan/audit 文档全部更新。
