# Soul Collection: 链上 max_supply（含全链路联动）

## Context

用户要做"建一个 10000 上限的 collection，先入驻 1 个 Soul，后续逐个加"的产品。当前合约 `soulidity::collection` **没有任何 supply 字段**：`add_soul` 完全开放，链上不会拦截第 10001 个 Soul，DB 端的 `soulCount` 仅做计数展示，10000 上限只是营销话术。

为兑现"上限"承诺并消除链下 race，决策是**把 max_supply 写进合约**作为 source of truth；DB 端 `soulCount` 切换为从链上 `current_supply` 镜像。四个开放决策已确认：
- **Mainnet 处理**：重发 package（mainnet 视为无真实数据）。
- **语义**：`Option<u64>`，`None = 无限`，前端默认 required + 提供"无上限"开关。
- **可变性**：immutable，创建后永久锁死。
- **工作流**：创建 collection 与 mint Soul **完全解耦**。允许先建空 collection（`current_supply = 0`），后续按 creator 节奏单独 `add_soul`。这是产品必需场景（lazy mint），不是边缘情况。
- **供应量语义**：`current_supply` 单调递增；当前没有 `remove_soul`，burn Soul 也不会回收 collection 名额。这是给买家的供应量保证，不是当前活跃 Soul 数。

### 必须保持的工作流不变量
1. `market::create_collection_in_personal_kiosk` 调用**不要求**任何 Soul 存在。
2. `collection::add_soul` 始终是独立 entry（与 mint 在不同 TX 也允许）。
3. 前端 `/collections/create` 必须支持 "先创建空 collection"：Step 2 可以选择暂不添加 Souls，Preview 允许 `batchSouls.length = 0`，成功后跳转 collection 详情页，由用户自主决定何时添加第一个 Soul。
4. DB 允许 `soulCount = 0` 的 collection 长期存在（不要在镜像 / repository / 列表 API 加"必须 ≥1"假设）。

参考模式：`SoulState.grant_capacity` + `active_grant_count` + `EGrantCapacityExceeded` + `GrantCapacityUpdated` 是现成模板（grant.move:71-75, 143, 287; soul.move:57, 60, 149, 321, 341, 398），本计划全程复刻该结构。

### 当前 repo truth 必须先修正的计划口径
- `protocol_tests.move` 不是 13 个 create 调用；当前有 19 个 `market::create_collection_in_personal_kiosk(...)` 和 1 个直接 `collection::create(...)`，签名变更必须全量更新。
- `soulCount` 的旧 DB recount 不只在 add-soul route；`web/lib/soulidity/mirror/upsert-soul.ts` 也会按 Prisma count 覆盖 collection `soulCount`，必须一起删除/改成链上镜像。
- 主网/测试网重发不能走裸 `sui client publish` 手工替换；当前 canonical path 是 `npm run publish:soulidity` / `scripts/publish-soulidity-and-sync.ts`，因为它处理依赖闭包、manifest 写回、`Published.toml` 写回和 cap handoff。
- Web 端 `SoulCollectionAssetSummary` / response type 是 JSON-facing；不要直接返回 `bigint`，`maxSoulSupply` 在 API 层用 string/null，UI 再格式化。

---

## 合约层（Move）

### 1. `move/soulidity/sources/collection.move`

**`SoulCollection` 增加字段**（line 18-26 区域）：
```move
public struct SoulCollection has key {
    id: UID,
    creator: address,
    extra_royalty_bps: u16,
    tradeable: bool,
    current_holder: address,
    current_holder_kiosk_id: ID,
    right_id: ID,
    max_supply: Option<u64>,      // 新增：None = 无限，Some(n) = 上限
    current_supply: u64,          // 新增：已绑定 Soul 数
}
```

**`SoulCollectionRight` 不新增 `max_supply`**。`max_supply` 和 `current_supply` 只存在于 `SoulCollection`，由它作为唯一链上 source of truth。理由：产品展示需要 `(current_supply, max_supply)` 一对；只把 `max_supply` 冗余到 Right 仍无法避免读取 shared `SoulCollection`，反而形成半套镜像。`Display<SoulCollectionRight>` 也不新增 `max_supply` 字段；前端用 repository/API 返回的 `maxSoulSupply` / `currentSoulSupply` 渲染进度条。

**新增错误码**：
```move
const ECollectionSupplyExceeded: u64 = 4;
const ESupplyCapInvalid: u64 = 5;
```

**`create()` 签名加参数**（line 98-142）：
```move
public(package) fun create(
    name, description, image_url,
    extra_royalty_bps, tradeable,
    max_supply: Option<u64>,           // 新增
    holder, holder_kiosk_id, ctx,
): (SoulCollection, SoulCollectionRight)
```
`create()` 必须先拒绝 `Some(0)`，不能只靠 SDK 校验：
```move
assert!(max_supply.is_none() || *max_supply.borrow() >= 1, ESupplyCapInvalid);
```

新对象初始化 `current_supply: 0`，`max_supply` 只写入 `SoulCollection`，不写入 `SoulCollectionRight`。

**`add_soul()` 加守卫与计数**（line 145-159）：
```move
public fun add_soul(
    collection: &mut SoulCollection,   // 改 &mut
    state: &mut SoulState, ctx: &TxContext,
) {
    assert!(collection.creator == ctx.sender(), ENotCollectionCreator);
    assert!(soul::state_creator(state) == collection.creator, ECreatorMismatch);
    soul::assert_owner(state, ctx.sender());

    if (collection.max_supply.is_some()) {
        let cap = *collection.max_supply.borrow();
        assert!(collection.current_supply < cap, ECollectionSupplyExceeded);
    };
    collection.current_supply = collection.current_supply + 1;

    soul::bind_collection(state, object::id(collection));
    event::emit(SoulAddedToCollection {
        collection_id: object::id(collection),
        soul_id: soul::soul_id(state),
        current_supply: collection.current_supply,    // 新增
        max_supply: collection.max_supply,            // 新增
    });
}
```

**事件扩展**：
- `SoulCollectionCreated` 加 `max_supply: Option<u64>`（前端 mirror 时直接拿，不必 fetch 对象）。
- `SoulAddedToCollection` 加 `current_supply: u64`、`max_supply: Option<u64>`（后续 mint 不需要 refetch 对象进度）。

**新增 getter**：`max_supply(self): Option<u64>`、`current_supply(self): u64`。不新增 `remaining_supply` getter；前端和 API 用 `(current_supply, max_supply)` 自己计算剩余名额，减少合约暴露面。

### 2. `move/soulidity/sources/market.move`

**`create_collection_in_personal_kiosk`**（line 895-948）：
- 入参加 `max_supply: Option<u64>`（在 `tradeable` 之后、`ctx` 之前）。
- 透传给 `collection::create(...)` 调用（line 919-928 处）。

### 3. `move/soulidity/sources/protocol_tests.move`

**升级全部 create 调用**：每个 `create_collection_in_personal_kiosk` / 直接调 `collection::create` 的位置加 `option::none<u64>()` 参数（确保现有测试 baseline 仍通过）。当前 repo truth 是 20 个 callsite：
- `create_collection_in_personal_kiosk`: 1522, 1857, 1947, 2266, 2325, 3567, 3744, 3910, 3968, 4089, 4118, 4359, 4388, 11402, 11755, 11821, 11969, 12073, 13053。
- `collection::create`: 9383。
- 实施时用 `rg -n "create_collection_in_personal_kiosk\\(|collection::create\\(" move/soulidity/sources/protocol_tests.move` 复核，不允许只按上面行号机械替换。
- 数量口径是 `19 + 1 = 20`；落地前后分别用 `rg -c "create_collection_in_personal_kiosk\\(" move/soulidity/sources/protocol_tests.move` 和 `rg -c "collection::create\\(" move/soulidity/sources/protocol_tests.move` 复核。

**新增测试**（参考 `grant_capacity_too_low_fails` line 8290 / `grant_capacity_too_high_fails` line 8363）：
- `collection_with_supply_cap_accepts_within_limit` — `Some(2)`，加 2 个成功。
- `collection_with_supply_cap_rejects_exceeding` — `Some(2)`，第 3 个 abort `ECollectionSupplyExceeded`。
- `collection_unlimited_supply_accepts_many` — `None`，加 N 个无限制。
- `collection_max_supply_zero_rejects_create` — `Some(0)` 在 `create` 阶段 abort `ESupplyCapInvalid`，不是等到第一个 `add_soul`。
- `collection_supply_counter_increments` — 验证 `current_supply` 在多次 `add_soul` 后单调递增。
- `collection_holder_change_preserves_supply` — `Some(3)` + `add_soul` 两次 + `update_holder` 后断言 `current_supply == 2` 且 `max_supply == Some(3)`。

---

## SDK 层（TypeScript）

### 4. `web/lib/soulidity/tx/collection.ts`

**`CreateCollectionTxParams` 加**：
```ts
maxSupply?: number | null   // null/undefined = unlimited
```

**`buildCreateCollectionTx`** 在 `tx.pure.bool(params.tradeable)` 之后插入：
```ts
params.maxSupply == null
  ? tx.pure.option('u64', null)
  : tx.pure.option('u64', params.maxSupply)
```

**`web/lib/soulidity/tx/shared.ts → validateCollectionArgs`** 同步扩展 params 类型：在现有 `name/description/imageUrl/extraRoyaltyBps` 基础上纳入 `tradeable: boolean` 和 `maxSupply?: number | null`。校验要求：
- `tradeable` 必须是 boolean，不能继续由 `buildCreateCollectionTx` 未校验透传。
- `maxSupply` 必须是 undefined/null 或正整数（`Number.isSafeInteger(n) && n >= 1`），上限给个合理值（如 `1_000_000`）。
- `1_000_000` 是 Web/SDK 产品 soft limit；Move 层只拒绝 `Some(0)`，链上语义仍是任意 `u64 >= 1`。
- `buildCreateCollectionTx` 里不要把 `maxSupply` 单独贴到 moveCall 末尾而遗漏 `tradeable` 校验；tx params、validator params、测试 fixture 三处要同步。

### 5. `web/lib/soulidity/events.ts`

- `extractSoulAddedToCollectionEvent`（line 260-269）：返回结构加 `currentSupply: bigint`、`maxSupply: bigint | null`。
- `extractCollectionMintedToKioskEvent`（line 271-283）：保持不变（market 事件未涉及 supply）。
- 当前仓库没有 `extractSoulCollectionCreatedEvent`，必须新增；不要把存在性判断留给落地阶段临时处理。新增函数返回 `maxSupply: bigint | null`。
- 新增专用 `readOptionalU64` / `readOptionalBigInt` helper，按 Move `Option<u64>` 的 `vec` 形态解析：`[] => null`，`[0] => 0n`，`["3"] => 3n`。当前 `events.ts` 已有 `readOptionalNumber` / `readOptionalString` 的递归结构，`queries.ts` 已有 `readOptionalVectorValue`；新 helper 要复用或对齐这套 vec-form 解析，并修掉 `events.ts` 里 `if (record.value)` 这种 truthy 判断，不能另写 truthy/falsy fallback，否则 `Some(0)` 会被误读成 `None`。
- 对 `SoulCollectionCreated.max_supply` 和 `SoulAddedToCollection.max_supply` 都用同一个 Option helper；事件解析测试必须覆盖 `Some(0)` 与 `None` 的差异，即使 Move create 阶段会拒绝 `Some(0)`。
- 创建镜像时序：`extractCollectionMintedToKioskEvent` 继续负责 `collectionId/rightId/owner/kioskId/tradeable`；`extractSoulCollectionCreatedEvent` 只补 `maxSupply`。`web/app/api/collections/create/route.ts` 若同时解析两个事件，必须 assert `collection_id/right_id` 与 `CollectionMintedToKiosk` 对齐；最终 mirror 仍以 `syncCollectionProjectionFromChain()` 读取的 `SoulCollection` 对象为准。

### 6. `web/lib/soulidity/queries.ts`

`getSoulCollectionObject`（当前 line 900-920）读 `SoulCollection` 对象时增量读 `max_supply` / `current_supply` 字段，反序列化为 `bigint | null` / `bigint`。当前该 reader 没有 Option 字段先例；实现时要复用/抽取 `readOptionalVectorValue` 风格的 parser，不能在这里手写 `if (fields.max_supply)`。

### 7. `web/lib/soulidity/types.ts`

`SoulCollectionAssetSummary` / `SoulCollectionAssetDetail`：
```ts
maxSoulSupply: string | null // JSON-facing；null = unlimited
currentSoulSupply: number    // 与 soulCount 同源，保留 soulCount 兼容前端
```

内部链上 reader / event extractor 可以用 `bigint`，但 repository/API 输出必须转成 string/null，避免 NextResponse JSON 序列化 `bigint` 失败。
API 响应期内保留双字段契约：`soulCount === currentSoulSupply`。新前端代码必须读 `currentSoulSupply`；`soulCount` 只作为旧调用方兼容字段。

---

## DB 层

### 8. `prisma/schema.prisma`（`SoulCollectionAsset` line 401-431）

新增列：
```prisma
maxSoulSupply BigInt? @map("max_soul_supply")  // null = unlimited
```

`soulCount Int @default(0)` 保留语义不变（minted count），但**数据来源切换**为镜像链上 `current_supply`（不再用 prisma count）。

新增 migration：`add_collection_max_supply`。

### 9. `web/lib/soulidity/mirror/upsert-collection.ts`

- 接受 `maxSoulSupply: bigint | null`、`currentSupply: number`（来自链上对象）。
- 在 update / create payload 都写入 `maxSoulSupply` 与 `soulCount = currentSupply`。
- 调用方 `sync-helpers.ts:164-167` 已经直接读链上对象，加字段后自然会读到。
- 同时删除当前 line 14-16 的 `prisma.soulAsset.count({ where: { collectionOnChainId } })` 和后续基于该 count 的 `soulCount` 写入。新版 `soulCount` 只能来自 `params.currentSupply`；如果调用方不传，必须在 TypeScript required field 层阻断，不能 fallback 成 `0`。
- `currentSupply/maxSoulSupply` 必须是 upsert 入参的必填字段，不能在缺字段时默认写 `0/null`。补 regression：已有 row `soulCount=2/maxSoulSupply=3` 时，holder/listing 类更新如果没有重新读 supply，不得把 supply 静默清零；正确做法是先读链上 `SoulCollection`，或在更新 payload 里不写 supply 字段。
- 类型转换边界：events / queries 读到的 `current_supply` 是 `bigint`；`sync-helpers.ts` 调 `upsertCollectionProjection` 前执行 `assertBigIntFitsPrismaInt(currentSupply)`（`0 <= currentSupply <= 2_147_483_647`），再 `Number(currentSupply)`。超过 Prisma `Int` 范围时 fail closed 并抛明确 mirror error；不要 clamp 到 `1_000_000`。未来如果要支持更大 supply，再把 `SoulCollectionAsset.soulCount` 从 `Int` 迁到 `BigInt`。

### 9.1 `web/lib/soulidity/mirror/upsert-soul.ts`

- 删除当前 "Keep collection soulCount in sync when a Soul belongs to a collection" 的 Prisma count recount。
- `SoulAsset.collectionOnChainId` 仍从 `SoulState.collection_id` 镜像；但 `SoulCollectionAsset.soulCount` 只允许由 `SoulCollection.current_supply` 或 `SoulAddedToCollection.current_supply` 写入。
- 补 regression：当 `upsertSoulProjection` 处理一个已绑定 collection 的 Soul 时，不应调用 `prisma.soulCollectionAsset.updateMany({ data: { soulCount: count } })`。

### 10. `web/lib/soulidity/repository.ts`

`soulCollectionSummarySelect`（line 162-183）加 `maxSoulSupply`；`toSoulCollectionSummary`（line 333）映射 summary 字段，`toSoulCollectionDetail`（line 466）通过 `toSoulCollectionSummary(record)` 继承 detail 字段。不要只改 line 466。
- `maxSoulSupply`: `record.maxSoulSupply?.toString() ?? null`
- `currentSoulSupply`: `record.soulCount`
- `soulCount`: 继续保留，值与 `currentSoulSupply` 相同，兼容现有 UI/API。
- 在 mapping 附近加一行短注释说明命名对应关系：Move `max_supply/current_supply` -> Prisma `maxSoulSupply/soulCount` -> API `maxSoulSupply/currentSoulSupply`。这是为了兼容既有 `soulCount` 字段，不是三套独立真值。

---

## API 层

### 11. `web/app/api/collections/[id]/add-soul/route.ts`

- **删除**当前的 `prisma.soulAsset.count` + `updateMany` 重算逻辑（line 98-104，已被合约 `current_supply` 替代）。
- 改为：从 `extractSoulAddedToCollectionEvent` 拿到 `currentSupply` / `maxSupply`，先执行同一套 `assertBigIntFitsPrismaInt(currentSupply)`，再 `prisma.soulCollectionAsset.update({ data: { soulCount: Number(currentSupply), maxSoulSupply: maxSupply?.toString() ?? null } })`。
- 链上层已经守住，所以**无需 API 层 supply 预检查**；但必须做业务错误映射，不能只返回 generic 4xx/500。
- 扩展现有 `web/lib/soulidity/market-errors.ts` 的 MoveAbort 解析思路，新增 collection-module abort catalog（可在同文件新增 `parseCollectionAbort` / `getCollectionAbortInfo`，或拆到共享 `move-abort-errors.ts`，但 route 和 hook 必须复用同一份 catalog）。
- `web/app/api/collections/[id]/add-soul/route.ts` 的 catch 先调用 collection abort mapper：
  - abort code `4` / `ECollectionSupplyExceeded` -> HTTP `409`，body `{ code: "ECollectionSupplyExceeded", error: "Collection at maximum capacity" }`。
  - abort code `5` / `ESupplyCapInvalid` -> HTTP `400`，body `{ code: "ESupplyCapInvalid", error: "Collection supply cap is invalid" }`。
  - 其他 abort 和 verification error 保持现有 generic 路径。
- 补 sanity test：collection abort parser 必须能从 Sui MoveAbort 字符串解析出 `module = "collection"` 和 code `4/5`，否则 UI 会退回 generic error。
- 前端 add-soul hook 直接读 `error.code` 渲染本地化文案；不要只显示 "Transaction failed"。

### 12. `web/app/api/collections/create/route.ts`

无 input 改动 —— `maxSupply` 已经在 TX 里走链上，post-TX 镜像直接读链上字段。Floor price 输入路径保持不变。

Response 增加只读字段，方便成功页/后续 UI 使用：
```ts
{
  txDigest: string
  collectionOnChainId: string
  rightOnChainId: string
  listingStatus: string
  soulCount: number
  currentSoulSupply: number
  maxSoulSupply: string | null
}
```

修改点必须落到两个位置：
- `web/app/api/collections/create/route.ts` 的 `responseBody` 字面量（当前在 route 末尾直接构造）。
- `web/lib/soulidity/mirror/sync-helpers.ts` / `upsertCollectionProjection` 返回链路：先让 `syncCollectionProjectionFromChain()` 返回值包含 `soulCount/currentSoulSupply/maxSoulSupply`，route 再从 `mirrored` spread/拷贝这些字段。不要在 route 里二次 query 或自己拼 DB count。

### 13. `web/app/api/collections/[id]/route.ts`

通过 repository 自动带 `maxSoulSupply`，无需单独改动。

---

## 前端

### 14. `/collections/create` supply state + empty collection flow

**`web/components/providers/create-collection-provider.tsx`**
- `supplyCap` 默认值改成 `"10000"`；新增 `unlimitedSupply: boolean` / `setUnlimitedSupply`。
- `CollectionSuccessSnapshot`、recovery hydration、`reset()` 都保存/恢复 `supplyCap` 和 `unlimitedSupply`。
- `addSoulsMethod` 扩展为 `'batch-upload' | 'skip' | null`。
- 保留 `null` = 未选择的现有语义，不在本任务里重构成 `'unselected'`。本轮只新增 `'skip'` 分支，避免扩大前端状态迁移面。

**`web/app/collections/create/page.tsx`**
- `supplyCap` 从 "template validation only" 改成链上参数：默认 required，placeholder 为 `10000`。
- 加 "无上限模式" toggle；开启时禁用 number input，并在 tx params 中传 `maxSupply: null`。
- 校验：非无限时必须是整数且 `1 <= supplyCap <= 1_000_000`。
- 文案改为 **"创建后无法修改，请谨慎填写"**；删除 "template validation only" 和 "Leave blank for unlimited"。

**`web/app/collections/create/souls/page.tsx`**
- 启用一个明确的 "Skip for now" / "Create empty collection" 方式，设置 `addSoulsMethod = 'skip'`。
- `handleNext()` 在 `addSoulsMethod === 'skip'` 时不要求 `batchFile`、`batchSouls.length > 0`、folder files。
- batch upload 仍用 `supplyCap` 做模板行数上限校验；无限模式不传 cap。
- 实施前后都用 `rg -n "addSoulsMethod" web/app web/components web/lib` 复核所有比较 / switch / type annotation；当前 union 是 `'batch-upload' | null`，新增 `'skip'` 后不能只改 provider 类型。

**`web/app/collections/create/preview/page.tsx`**
- `missingStep2` 在 `addSoulsMethod === 'skip'` 时为 false。
- 当前仓库已有 `buildCollectionDraftSignature()`，不要新编第二套签名函数。把它的输入和 Preview 调用扩展为包含 `maxSupply` / `unlimitedSupply`，否则 recovery 会把不同上限的草稿误判为同一个 on-chain launch。
- `publish()` 调用传 `maxSupply: null | number` 和 `souls: []`；Preview 文案显示 "0 now / max later"，不能写 "Soul list locked"。

**`web/lib/hooks/use-collection-publish.ts`**
- `CollectionPublishParams` 加 `maxSupply?: number | null`。
- `CollectionRecoveryMeta` 和 `buildCollectionDraftSignature()` 同步包含 `maxSupply`；在 sessionStorage 持久化前的 draft signature 构造输入里包含 `maxSupply/unlimitedSupply`，再让 `attachSoulidityDeploymentSignature(nextState)` 写入 storage。
- `RECOVERY_VERSION` 从 `9` bump 到 `10`，使旧 draft 自动作废。函数名以当前 `web/lib/hooks/use-collection-publish.ts` 现状为准；本仓库当前确实已有 `buildCollectionDraftSignature()`，不要按不存在的函数名另起新 helper。
- 同步更新 `tests/new-web/collection-publish-regressions.test.ts` 里的现有 source-guard 断言（version、draft signature shape、success effect dependency 等）。这不是只新增测试；旧断言若仍期待 `RECOVERY_VERSION = 9` 或旧 draft shape，必须同轮改掉。
- `buildCreateCollectionTx()` 调用传 `maxSupply`。
- 当 `recovery.souls.length === 0` 时，Phase 2/3/4 自然跳过并进入 done；不要把空数组当错误。
- `collection_publish_started/completed` 事件带 `maxSupply`、`unlimited: params.maxSupply == null` 和 `emptyCollection: params.souls?.length === 0`，方便后续按 capacity 分桶分析。
- 如本仓库存在本地事件 schema / PostHog schema 注册 / 内部 analytics schema，必须同轮补 `maxSupply/unlimited/emptyCollection`；如果没有 schema 文件，补 source regression 或 grep 说明，证明没有被 schema 过滤。

**`web/app/collections/create/success/page.tsx`**
- 空 collection 成功页文案改为 "Collection created. Add Souls when ready."。
- `Souls minted` 行在空 collection 时显示 `0 now · capacity {maxSoulSupply ?? 'Unlimited'}`，不拼空 soulNames。

**`web/lib/hooks/use-collections.ts`**
- 直接 create collection 的 hook 也要把 `params.maxSupply` 透传给 `buildCreateCollectionTx()`，避免只有 wizard 支持上限。

### 15. `web/app/collections/[id]/page.tsx` + `collection-stats-row.tsx:31`

- "Souls" 项展示规则：
  - `maxSoulSupply == null`：保持 `{currentSoulSupply} Souls`。
  - 否则：`{currentSoulSupply} / {maxSoulSupply}`，下加细进度条（width = `currentSoulSupply / Number(maxSoulSupply) * 100%`，最大 100%）。
- `collection-stats-row.tsx:31` 和相邻 collection UI（如 `collection-header.tsx` / `collection-row-card.tsx`）的新逻辑统一使用 `currentSoulSupply`；`soulCount` 只作为 API 兼容字段，不再作为新前端 capacity 逻辑来源。
- 进度条样式延用 DESIGN.md 的 token，避免新引入颜色。
- 当 `maxSoulSupply != null && currentSoulSupply >= Number(maxSoulSupply)` 时，collection 详情页隐藏/禁用 "Add Soul" CTA，并显示 "Supply reached"。
- 纵深防御：如果旧脏数据出现 `maxSoulSupply === "0"`，进度条渲染为 100%，不要除以 0 得到 `NaN`。Move 新逻辑会阻止新建 `Some(0)`，但 UI 不能因为旧/脏 DB 行崩。

---

## 部署

1. **Move build/test**：
   ```
   cd move/soulidity
   sui move build
   sui move test
   ```
2. **脚本化 testnet 重发**（不要手工裸 publish）：
   ```
   NEXT_PUBLIC_SUI_NETWORK=testnet npm run publish:soulidity -- --dry-run --payment-coin-type=<testnet-usdc-type>
   NEXT_PUBLIC_SUI_NETWORK=testnet npm run publish:soulidity -- --payment-coin-type=<testnet-usdc-type>
   ```
   脚本必须写回 `web/lib/soulidity/deployment-manifest.json` 和 `move/soulidity/Published.toml`；发布后用 diff 复核 packageId / policy / display / upgradeCap / KindRegistry 等字段。
3. **Mainnet live collection mandatory pre-flight**：
   - 在任何 mainnet `--mainnet-e2e --dry-run` / publish 之前，新增并运行 `scripts/precheck-live-soulidity-collections.ts`（或等价 npm script）。
   - precheck 输入：当前 mainnet packageId、当前 production DB URL、已知 deployer / multisig / holder 地址列表。
   - precheck 必须同时查：
     - production DB `SoulCollectionAsset` 是否已有行；
     - Sui `queryEvents` 是否存在 `${packageId}::collection::SoulCollectionCreated` 或 `${packageId}::market::CollectionMintedToKiosk` 事件；
     - 可选补充 `getOwnedObjects` / `sui client objects --owner` 查 Right / Kiosk 侧信号，但不能把 owner objects 当唯一依据，因为 `SoulCollection` 是 shared object。
   - 任一信号非空都必须 fail closed，阻断重发；此时不得继续 publish，必须改走 package upgrade + migration/dynamic-field 兼容路径，或先形成明确迁移计划。
   - 退出码语义固定：`exit 0` = 全部信号为 0，可继续 publish；`exit 1` = 任一信号非空，stderr 打印 DB row 数、Sui event count、ownedObjects count 及样例 ID，由 `set -e` / publish wrapper 阻断。pre-flight 必须 idempotent，多次运行不改变外部状态。
   示例命令：
   ```
   NEXT_PUBLIC_SUI_NETWORK=mainnet \
     npx tsx scripts/precheck-live-soulidity-collections.ts \
       --package-id=<current-mainnet-package-id> \
       --database-url=$DATABASE_URL \
       --owner=<deployer> \
       --owner=<multisig>
   ```
4. **脚本化 mainnet 重发**（pre-flight 证明无 live collection 后才允许执行；cap handoff 仍按发布规范执行）：
   ```
   NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- --dry-run --mainnet-e2e --payment-coin-type=<mainnet-usdc-type> --use-env-key
   NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- --mainnet-e2e --payment-coin-type=<mainnet-usdc-type> --use-env-key
   # full smoke 通过后：
   NEXT_PUBLIC_SUI_NETWORK=mainnet npm run publish:soulidity -- --resume-cap-transfer-from-manifest --transfer-caps-to=<multisig> --use-env-key
   ```
   不允许手工编辑 manifest 作为主要发布路径；如脚本失败，先修脚本或记录 partialDeploymentReason，再 resume。
   发布写回后必须把 `web/lib/soulidity/deployment-manifest.json` 当 runtime source of truth，`move/soulidity/Published.toml` 当 publish cross-check；同步核对 `.env.example`、CI/Vercel Production 环境变量和任何 `NEXT_PUBLIC_SOULIDITY_*` fallback，确保线上不会继续指向旧 packageId / policy / registry。
5. **DB migration**：
   ```
   npx prisma migrate dev --name add_collection_max_supply --schema=prisma/schema.prisma
   npm run prisma:generate
   ```
   如果从 `web/` 目录执行，则必须使用 `--schema=../prisma/schema.prisma`，不要写 `--schema=prisma/schema.prisma`。
6. **环境文件收口**：`.env.example` 不应重新成为 Soulidity ID 的 primary source；只保留指向 manifest 的说明或必要 fallback。发布后用 `rg -n "NEXT_PUBLIC_SOULIDITY|0x[0-9a-fA-F]{40,}" .env.example web scripts` 复核没有 stale hard-coded ID。`NEXT_PUBLIC_KIOSK_PACKAGE_ID` 是上游 PersonalKiosk 标准包 ID 例外，与本次 Soulidity 重发无关；grep 命中时只需确认它没有指向 Soulidity 自家 packageId。
7. **System invariants 文档收口**：实现验证通过后更新 `CLAUDE.md` 的长期 invariant，写入：`Collection capacity is on-chain enforced; SoulCollection.current_supply is monotonically increasing and is not decremented by burn; DB soulCount mirrors it 1:1.`。这一步必须在同轮完成，不留给后续。

---

## 验证

1. **Move 测试**：`cd move/soulidity && sui move test`
   - 20 个 collection create callsite 全部使用新签名并 pass（`option::none<u64>()` baseline）。
   - 6 个新增 supply 测试全 pass：within limit、exceeding、unlimited、zero create abort、counter increments、holder change preserves supply。
2. **Targeted Vitest**：
   ```
   npx vitest run \
     tests/new-web/soulidity-tx-builders.test.ts \
     tests/new-web/soulidity-events.test.ts \
     tests/new-web/market-errors.test.ts \
     tests/new-web/soulidity-mirror-upsert.test.ts \
     tests/new-web/soulidity-repository.test.ts \
     tests/new-web/collection-publish-regressions.test.ts \
     tests/new-web/collection-create-ui.test.ts
   ```
   必须覆盖：
   - `buildCreateCollectionTx` emits `option<u64>` for `maxSupply` and `None` for unlimited，且使用 number/null 形态，不包无必要的 `BigInt(...)`。
   - `validateCollectionArgs` 同时校验 `tradeable` 和 `maxSupply`，测试 fixture 与 builder params 类型一致；`1_000_000` 只作为 Web/SDK soft limit。
   - events parser 新增 `extractSoulCollectionCreatedEvent`，Option helper 正确区分 `None`、`Some(0)`、`Some(3)`。
   - collection abort mapper 把 `collection::ECollectionSupplyExceeded` -> 409/code，`collection::ESupplyCapInvalid` -> 400/code，hook/API 复用同一 catalog。
   - collection abort parser 能从 MoveAbort 字符串稳定识别 `module = collection` 和 code `4/5`。
   - `upsertCollectionProjection` writes `maxSoulSupply` and chain-backed `soulCount/currentSoulSupply`，并覆盖 holder/listing 更新不会把已有 supply 静默重置为 `0/null`。
   - `sync-helpers.ts` 对 `current_supply` bigint -> Prisma Int 做 fail-closed range check；超过 `2_147_483_647` 抛明确 mirror error，不 clamp。
   - `upsertSoulProjection` no longer recounts collection `soulCount`。
   - create wizard allows skip/empty collection，所有 `addSoulsMethod` 用法都有 `'skip'` 分支，且保留 `null` = 未选择语义。
   - draft signature includes max supply 且 `RECOVERY_VERSION` 已 bump；`tests/new-web/collection-publish-regressions.test.ts` 现有断言同步更新。
   - telemetry includes `maxSupply`、`unlimited`、`emptyCollection`；本地 analytics/PostHog schema 若存在也已同步。
   - repository/API output serializes `maxSoulSupply` as string/null, not bigint，并保留命名映射注释。
   - 新前端 capacity UI 读 `currentSoulSupply`；`soulCount` 只做兼容字段。
   - collection `Display` 不新增 `max_supply`，详情页进度条从 API/repository 字段渲染；`maxSoulSupply === "0"` 防御性渲染为 100%，不出现 `NaN`。
3. **Full checks**：
   ```
   npm test
   npm run typecheck
   cd web && npm run lint && npm run build
   ```
4. **端到端（testnet 实跑）**：
   - 前端 `/collections/create` 创建 cap=3 collection（**当下不 mint 任何 Soul**）→ 详情页应显示 `0/3 Souls`，列表页可见且可访问。
   - 隔一段时间后，回到 collection 详情页，mint 第 1 个 Soul → `add_soul` → `1/3`。
   - 再分两次单独 mint + `add_soul` → `2/3 → 3/3`。
   - mint 第 4 个 Soul 尝试 `add_soul` → 钱包 dryRun 阶段就报 `ECollectionSupplyExceeded`，前端显示友好错误且 "Add Soul" 按钮置灰。
   - 创建一个 maxSupply=null 的 collection（同样不立即 mint）→ 详情页显示 `0 Souls`，长期保留可正常加 Soul。
5. **回归**：随机抽查现有 collection 详情页 / 列表页渲染正常（DB migration 后旧行 `maxSoulSupply = NULL`，UI 走"无上限"分支）。
6. **文档 invariant**：`CLAUDE.md` 已新增 collection capacity invariant；`rg -n "Collection capacity is on-chain enforced|current_supply is monotonically increasing|not decremented by burn|soulCount mirrors" CLAUDE.md` 能命中。

---

## 关键文件清单

| 层 | 文件 | 改动量 |
|---|---|---|
| Move | `move/soulidity/sources/collection.move` | 中（结构 + add_soul + 事件） |
| Move | `move/soulidity/sources/market.move` | 小（透传参数） |
| Move | `move/soulidity/sources/protocol_tests.move` | 中（20 处 baseline + 6 新测试） |
| SDK | `web/lib/soulidity/tx/collection.ts` | 小 |
| SDK | `web/lib/soulidity/tx/shared.ts` | 小 |
| SDK | `web/lib/soulidity/events.ts` | 小 |
| SDK | `web/lib/soulidity/queries.ts` | 小 |
| SDK | `web/lib/soulidity/types.ts` | 小 |
| SDK/API | `web/lib/soulidity/market-errors.ts` 或新增共享 abort parser | 小（collection abort code catalog） |
| DB | `prisma/schema.prisma` + 新 migration | 小 |
| Mirror | `web/lib/soulidity/mirror/upsert-collection.ts` | 小 |
| Mirror | `web/lib/soulidity/mirror/upsert-soul.ts` | 小（删除旧 recount） |
| Mirror | `web/lib/soulidity/repository.ts` | 小 |
| API | `web/app/api/collections/[id]/add-soul/route.ts` | 小（删旧 count + 镜像新字段 + 业务错误映射） |
| API | `web/app/api/collections/create/route.ts` | 小（response 带 supply 字段） |
| Frontend | `web/components/providers/create-collection-provider.tsx` | 中（supply + skip 状态） |
| Frontend | `web/app/collections/create/page.tsx` | 中（rewire + UX） |
| Frontend | `web/app/collections/create/souls/page.tsx` | 中（skip/empty flow） |
| Frontend | `web/app/collections/create/preview/page.tsx` | 中（empty preview + maxSupply publish） |
| Frontend | `web/app/collections/create/success/page.tsx` | 小（empty success copy） |
| Frontend | `web/lib/hooks/use-collection-publish.ts` | 中（maxSupply + recovery） |
| Frontend | `web/lib/hooks/use-collections.ts` | 小（direct create tx maxSupply） |
| Frontend | `web/app/collections/[id]/page.tsx` + `collection-stats-row.tsx` | 小 |
| 部署 | `web/lib/soulidity/deployment-manifest.json` | 小（重发后整体替换 ID） |
| 部署 | `move/soulidity/Published.toml` | 小（脚本写回后核对） |
| 部署 | `scripts/precheck-live-soulidity-collections.ts` | 小（mainnet live collection 阻断检查） |
| Docs | `CLAUDE.md` | 小（落地后新增 collection capacity invariant） |

## 风险与回滚

- **Mainnet 重发** —— mainnet 仅在 mandatory pre-flight 证明无 live collection 后才视为可重发。若 production DB / Sui events / owned-object 辅助信号任一非空，立即停止，不执行 `publish:soulidity`；切回 "package upgrade + migration/dynamic-field" 兼容路径或先形成迁移计划。
- **Supply cap 欺诈风险** —— `Some(0)` 必须在 Move `create()` 阶段 abort `ESupplyCapInvalid`；SDK 软校验不是安全边界。
- **现有 testnet collection 不可用** —— 旧 packageId 下的对象在新 package 里读不到，前端会 404。可接受（testnet）。
- **DB migration 单向** —— 加列是非破坏性。如需回滚，DROP COLUMN 即可（旧 mirror 代码不依赖此列）。
- **TX 失败用户体验** —— 第 N+1 个 `add_soul` 在 dryRun 时即报错；前端要在 collection 详情页隐藏/禁用 "Add Soul" 按钮当 `currentSoulSupply >= maxSoulSupply`。
- **Cap handoff 回滚点** —— mainnet smoke 通过前用 `--mainnet-e2e` 保持 Cap 在 deployer；若 smoke 失败，不执行 `--resume-cap-transfer-from-manifest`，回滚 manifest/DB/web env 到上一版。Cap 已转多签后，回滚必须走多签发布上一版 package/manifest，不能本地单方回滚。
