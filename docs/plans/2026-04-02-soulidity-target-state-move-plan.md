# Soulidity 目标态 Move 合约实现计划

## 目标

基于 `docs/specs/2026-04-02-soulidity-target-state-product-requirements-confirmation.md`，在 `/move` 下新增一套全新的 Sui Move 合约包，直接表达 Soulidity 目标态，而不是继续在 `move/soul_object` 的 allowlist 单地址模型上叠补。

## 设计结论

### 1. 三类权利拆开

- `Soul`：可拥有、可交易的资产对象，长期锁在 `PersonalKiosk` 中。
- `SoulGrant`：授予 agent 的使用权对象，只代表访问权，不代表所有权。
- `SoulCollectionRight`：Collection 额外收益权对象，可独立交易。

### 2. 所有权真相源

- `Soul` 与 `SoulCollectionRight` 默认都锁在 `PersonalKiosk` 中，避免对象脱离协议约束。
- 协议维护共享状态对象记录当前 owner、kiosk、ownership epoch、active grant。
- 所有 Soul 与 Collection 的协议内转移都统一更新 epoch / holder，并在 Soul 转移时清空授权。

### 3. 授权失效机制

- `SoulGrant` 内携带 `ownership_epoch_snapshot` 与 `grant_nonce_snapshot`。
- `SoulState` 维护当前 `ownership_epoch` 与 `grant_nonce`。
- 只要 Soul 被卖出、赠与、撤销授权或改派授权，旧 grant 自动变成 stale。

### 4. Memory 设计

- 每个 Soul 对应一个共享 `SoulMemory`。
- founding memory 与后续 agent write-back 都以 append-only 方式新增 `MemoryEntry`。
- 不提供删除、覆盖、回滚接口。

### 5. Collection 收益流

- `SoulCollection` 是共享配置对象，记录额外 royalty、当前权益持有人与是否永久不可交易。
- `SoulCollectionRight` 是可选的收益权 NFT；不可交易 collection 也会铸出该对象，但市场与转移入口永久拒绝它。
- Soul 二级交易时同时结算 creator royalty + collection extra royalty + platform fee。

## 模块拆分

### `soul.move`

- `Soul`
- `SoulState`
- `SoulAdminCap`
- 原生创建 / import / personal join 的统一 mint 工厂
- Soul display
- 协议内 owner / kiosk / epoch 更新 helper

### `memory.move`

- `SoulMemory`
- `MemoryEntry`
- founder append
- owner append
- granted agent append

### `grant.move`

- `SoulGrant`
- grant issue / revoke / reassign
- active grant 校验 helper

### `collection.move`

- `SoulCollection`
- `SoulCollectionRight`
- create collection
- add soul to collection
- collection holder 更新 helper

### `market.move`

- `MarketConfig`
- `MarketAdminCap`
- Soul 固定价 listing / buy / cancel
- CollectionRight 固定价 listing / buy / cancel
- personal kiosk 注册
- gift / protocol transfer helper

### `seal_policy.move`

- owner 访问校验
- granted agent 访问校验
- 文档 ID 前缀校验

## 验收映射

### Soul

- 可创建、可持有、可上架、可买卖
- creator royalty 永久存在
- import / personal join 都能生成 Soul

### SoulGrant

- 同时只有一个有效授权
- revoke / reassign 生效
- Soul 转移后旧 grant 立即失效

### Memory

- 创建时可写 founding memory
- grant agent 可 append
- 历史不可删除

### Soul Collection

- 可创建收益权
- 可选永久不可交易
- Soul 二级交易时给当前 SC holder 分润

## 实施顺序

1. 新建 `move/soulidity` 包和 `Move.toml`
2. 先实现 `soul + grant + memory`
3. 再实现 `collection + market`
4. 最后接 `seal_policy` 与测试
