# Soul Marketplace Walrus + Seal 查漏补缺复核与实施计划

**日期**: 2026-03-21
**状态**: 已复核，待实施
**范围**: 仅审视本仓库当前 `Soul` 相关实现，以及为 `Walrus + Seal` 数据交付闭环补齐缺口；不在本轮恢复已禁用的购买/发布业务流。
**来源**:
- 当前仓库 `soul` / `walrus` / `seal` 实现现状
- `KrillTube-frontend` 的 Walrus/Seal 实战代码
- Seal 官方文档：`Using Seal`、`Access Policy Example Patterns`、`Security Best Practices and Risk Mitigations`、`Seal Pricing`
- Walrus 官方文档：`Operate the Upload Relay`

---

## 结论

当前仓库并不是“只差把 `@mysten/seal` 接进来”。

真正的主缺口有 5 个：

1. `Seal` 目前只停留在“返回 policy 参数”，没有任何 SDK、`SessionKey`、`seal_approve` PTB 构造或解密实现。
2. 如果采用官方更推荐的 envelope encryption，当前 release 模型没有定义 `encryptedDek / documentId / iv / cipher` 这类解密元数据如何落地和透出；这是原草案最大的漏项。
3. 当前 `NEXT_PUBLIC_SEAL_PACKAGE_ID` / `NEXT_PUBLIC_SOUL_PACKAGE_ID` 语义混乱。按官方文档，`SessionKey.create`、`SealClient.encrypt/decrypt` 使用的是**访问策略包**，也就是 `seal_approve*` 所在包，而不是 Seal 的链上解密包。
4. 当前 publish / purchase / renew 链路仍被显式禁用，因此本轮优先级不应是“补浏览器钱包上传”，而应是先补齐 `release 密文 + access contract + agent 解密所需元数据`。
5. Key server 与 URL 管理不能只照抄参考项目的硬编码写法。官方文档已明确：URL 可能变化，`objectId` 才是主锚点；需要按环境配置并在合适时机启用 `verifyKeyServers`。

---

## 已观察事实

| 事实 | 当前证据 | 影响 |
|------|----------|------|
| `Seal` 仅返回静态参数，没有 SDK 能力 | `web/lib/services/seal.ts` | 现有 agent 只能拿到 policy 描述，不能真正解密 |
| `Walrus` 仅有服务端 `PUT /v1/blobs`，默认硬编码 testnet URL | `web/lib/services/walrus.ts` | 主网/多环境切换不完整；也没有发布侧的浏览器上传方案 |
| 上传 API 只接受 `public` / `encrypted`，且 `encrypted` 被强制当作 ZIP | `web/app/api/souls/upload/route.ts`、`web/lib/souls/upload-validation.ts` | 无法承接 Seal 密文或 envelope 密文 |
| agent access API 没有返回解密运行时配置，也没有 sidecar 元数据 | `web/app/api/agent/souls/[id]/access/route.ts` | 客户端拿不到 `serverConfigs / threshold / verifyKeyServers / encryptedDek / documentId` |
| Release 模型其实已经有 `publicMetadataRef` 可复用 | `move/soul_market/sources/series.move`、`prisma/schema.prisma` | 不必先扩库；可用它承载 release sidecar |
| 发布页、购买、续费都已禁用 | `web/app/souls/publish/page.tsx`、`web/app/api/souls/[id]/purchase/route.ts`、`web/app/api/souls/[id]/renew/route.ts` | 原草案里把“浏览器钱包上传”当主线，排序不对 |
| `seal_policy.move` 使用 `public entry` 且保留魔术错误码 | `move/soul_market/sources/seal_policy.move` | 与官方“非 public entry + 可升级兼容”建议不完全一致 |
| 示例环境没有 Walrus / Seal 相关变量 | `.env.example` | 实施后无法靠示例配置跑通 |

---

## 从参考实现吸收什么，不照抄什么

### 应吸收

- 复用单个 `SealClient` / `SessionKey`，避免每次解密都重新初始化。
- 构造 `seal_approve` PTB 时只传 object id，不传 fully-qualified object ref，避免 key server full node 落后时触发 `InvalidParameter`。
- `tx.build({ onlyTransactionKind: true })` 作为 Seal dry-run 输入。
- `Walrus` 运行时区分 testnet / mainnet，主网 aggregator 默认走可用地址。
- 浏览器大文件上传最终应走 upload relay / SDK，而不是让浏览器自己 fan-out 到存储节点。

### 不应照抄

- 不直接照抄 KrillTube 里的 key server URL 硬编码和 `verifyKeyServers: false` 作为默认生产策略。
- 不把 `backupKey` 默认持久化到服务端。官方安全文档已明确，这会引入额外泄漏面。
- 不把“每个分片直接用 Seal 加密”的视频流方案原样搬到 Soul bundle。Soul 当前更像“单个 release bundle”，优先采用官方更推荐的 envelope pattern。

---

## 修正后的 gap matrix

| 主题 | 当前状态 | 严重度 | 处理结论 |
|------|----------|--------|----------|
| 访问策略包语义 | `seal.ts` 同时暴露 `packageId` 和 `soulPackageId`，语义混乱 | 严重 | 统一为“访问策略包 = `soul_market` 包”；仅在需要链上解密时才单独引入 Seal package id |
| release 解密 sidecar | 未定义 | 严重 | 复用 `publicMetadataRef` 承载 sidecar，不先加库 |
| Seal SDK / SessionKey / decrypt | 不存在 | 严重 | 新增完整客户端封装与 envelope crypto helper |
| agent access contract | 信息不足 | 严重 | access API 至少要返回运行时 server config、policy inputs、以及 release sidecar 或 sidecar ref |
| 上传格式 | 强制 ZIP | 高 | 不新增并行旧类型，直接把现有 `encrypted` 语义改成“opaque sealed payload” |
| key server 配置 | 仅能靠硬编码想象 | 高 | 以 `objectId` 为主锚点，按环境配置，支持 `verifyKeyServers` |
| Move policy 硬化 | 魔术数字、`public entry` | 中高 | 命名错误码；若兼容，改为非 `public entry`；补 Move 单测 |
| Walrus 运行时 | 默认 testnet、无 fallback | 中 | 服务端上传路径加网络感知与重试；浏览器 relay 另起任务 |
| 环境文档 / 测试 | 不完整 | 中高 | 必须补 `.env.example`、单测和文档契约 |
| 审计与密钥访问日志 | 不存在 | 中 | 官方建议项，建议并入下一阶段，不阻塞功能闭环 |

---

## 实施计划

### Step 1：先收敛运行时契约与命名

**改造** `web/lib/services/seal.ts`

目标：

- 把“访问策略包”与“Seal 链上解密包”语义拆清。
- 对外不再暴露歧义字段 `packageId + soulPackageId`。

结论：

- `SessionKey.create`、`SealClient.encrypt`、`SealClient.decrypt`、`seal_approve*` PTB 都使用 **`soul_market` 包 ID**。
- `NEXT_PUBLIC_SEAL_PACKAGE_ID` 只有在未来要接 `seal::bf_mac_encryption` 时才需要；本轮不让它混入 access path。

建议导出形态：

```ts
export interface AccessPolicyDescriptor {
  packageId: string
  moduleName: 'seal_policy'
  functionName: 'seal_approve_perpetual' | 'seal_approve_subscription'
  seriesObjectId: string
}

export interface SealRuntimeConfig {
  network: 'testnet' | 'mainnet'
  threshold: number
  verifyKeyServers: boolean
  serverConfigs: Array<{
    objectId: string
    weight: number
    aggregatorUrl?: string
    apiKeyName?: string
    apiKey?: string
  }>
}
```

同时补：

- `.env.example`
- `web/package.json` 依赖说明
- `web/lib/sui.ts` 或新的 `web/lib/sui-client.ts`，改用与 `@mysten/seal` 兼容的 `@mysten/sui/client`

---

### Step 2：定义 release sidecar，复用 `publicMetadataRef`

这是原草案缺失的关键步骤。

如果采用 envelope encryption，就不能只存 Walrus blob id；还必须有一个 sidecar 告诉客户端如何恢复数据密钥。

**不新增 Prisma / Move 字段**。优先复用现有：

- 链上 `publish_release(..., public_metadata_id, ...)`
- DB `SoulRelease.publicMetadataRef`

sidecar 建议格式：

```json
{
  "version": 1,
  "mode": "seal-envelope",
  "documentId": "0x...",
  "encryptedDek": "<base64>",
  "iv": "<base64>",
  "cipher": "AES-GCM-256",
  "mimeType": "application/zip",
  "fileName": "bundle.zip",
  "contentHash": "<sha256-plaintext>"
}
```

约束：

- `documentId` 只包含 **访问策略 id**，不含 package 前缀。
- `encryptedDek` 来自 `SealClient.encrypt()` 的 `encryptedObject`。
- **不默认落库 `backupKey`**。若确需灾备，只允许在发布端本地导出，由人手工保管。
- `contentHash` 继续以链上 release 里的 `content_hash` 为权威，sidecar 只做冗余校验。

说明：

- `documentId` 最低要求是 `[series_id][nonce]`。
- 推荐把 `release_id` 或版本标识编码进后缀，便于排障；但授权判断仍以 `seal_approve*` 的对象参数为准，不依赖后缀语义。

---

### Step 3：补齐 Seal SDK 与 envelope crypto

**改造** `web/lib/services/seal.ts`

- 引入 `@mysten/seal`
- 按环境加载 `serverConfigs`
- 复用单例 `SealClient`
- 支持 `SessionKey.create()`、`import()` / `export()` 的持久化策略
- 预留 app startup 时可选 `verifyKeyServers`

**新建** `web/lib/services/seal-crypto.ts`

职责：

- `encryptBundle`
  - 生成随机 DEK
  - 用 AES-GCM-256 加密 bundle
  - 用 `SealClient.encrypt()` 加密 DEK
  - 输出 `{ encryptedData, sidecar }`
- `decryptBundle`
  - 构建只包含 `seal_approve*` 的 PTB
  - `tx.build({ onlyTransactionKind: true })`
  - `SealClient.decrypt()` 解出 DEK
  - 再解密 bundle

实现注意：

- 当前仓库的 access policy 是 `seal_policy::seal_approve_perpetual/subscription`
- `SessionKey` 绑定的是访问策略包
- 构造 PTB 时只使用 object id，不使用版本化 object ref
- 如果 key server 返回 `InvalidParameter`，按官方建议做短暂重试

---

### Step 4：把 access API 改成“可独立解密”的契约

**改造** `web/app/api/agent/souls/[id]/access/route.ts`

目标：

- 让 agent 客户端拿到一次响应后，就具备完成解密的全部信息。

返回结构至少应覆盖：

```json
{
  "artifact": {
    "walrusBlobRef": "...",
    "walrusBlobUrl": "...",
    "publicMetadataRef": "...",
    "publicMetadataUrl": "...",
    "contentHash": "..."
  },
  "accessPolicy": {
    "packageId": "0x...",
    "moduleName": "seal_policy",
    "functionName": "seal_approve_perpetual",
    "seriesObjectId": "0x...",
    "passObjectId": "0x...",
    "releaseObjectId": "0x...",
    "clockObjectId": "0x6"
  },
  "seal": {
    "network": "testnet",
    "threshold": 2,
    "verifyKeyServers": true,
    "serverConfigs": [{ "objectId": "0x...", "weight": 1 }]
  }
}
```

优先方案：

- access API 直接读取 `publicMetadataRef` 对应的 sidecar，并内联 `documentId / encryptedDek / iv / cipher`

保守方案：

- 若担心 API 多一次 Walrus 读取，则至少返回 `publicMetadataRef / publicMetadataUrl`

无论选哪种，都要满足：

- agent 不需要再猜 package id / key server / sidecar 结构
- perpetual / subscription 两种 PTB 输入都能由响应直接推导

---

### Step 5：上传契约直接切到 sealed payload，不保留伪兼容尾巴

**改造** `web/lib/souls/upload-validation.ts`

原草案里新增 `sealed` 并保留 `encrypted` 兼容，这里不采用。

原因：

- 当前 publish 流程已禁用，没有稳定线上调用方。
- 现有 `encrypted = ZIP` 只是过渡约定，不值得继续保留双轨。

改造结论：

- 保留字段名 `type: 'encrypted' | 'public'`
- 但把 `encrypted` 的语义改成“opaque sealed payload”
- `encrypted` 只校验大小、MIME 与必要的最小字节长度，不再强依赖 ZIP 签名

**改造** `web/app/api/souls/upload/route.ts`

- 上传密文 bundle 时返回 `blobId + contentHash`
- 上传 public sidecar 时返回 `blobId`
- 后续恢复 publish flow 时，发布端应先上传：
  1. 密文 bundle blob
  2. release sidecar blob
  3. 再把二者引用写入链上 release

---

### Step 6：Walrus 服务层只补当前真正需要的运行时能力

**改造** `web/lib/services/walrus.ts`

本轮只做：

- 按 `NEXT_PUBLIC_SUI_NETWORK` 选择 testnet / mainnet 默认 URL
- 主网 aggregator 默认使用当前可用地址
- 服务端上传路径增加 1 次重试
- testnet 可参考多 publisher fallback；mainnet 维持配置化单入口

本轮不把“浏览器钱包签名上传 / upload relay”并进当前任务主线，原因：

- 当前 publish UI 仍禁用
- upload relay 更适合在发布链路恢复时一次性接 `@mysten/walrus`

若未来恢复浏览器发布，再单独立项：

- 引入 `@mysten/walrus`
- 默认启用 upload relay
- 需要时再补 `storageCost` 估算与 tip 展示

---

### Step 7：Move policy 硬化

**改造** `move/soul_market/sources/seal_policy.move`

必须项：

- 把魔术数字替换成命名常量
- 若不破坏外部调用，优先把 `public entry fun` 改成 `entry fun`
- 补 Move 单测，覆盖：
  - owner / agent grant 允许
  - 非 owner / 非 agent 拒绝
  - perpetual 的 release / series 校验
  - subscription 的 expiry 校验

设计提醒：

- 官方建议未来升级时对 shared object 做 versioning，或引入 versioned shared global object。
- 如果确认 `soul_market` 包未来会升级，这项不能永久搁置；否则新包版本可能影响历史密文的访问兼容性。

---

### Step 8：测试、文档与契约校验

建议新增：

- `tests/web/seal-config.test.ts`
  - access policy package 命名与 env 解析
  - key server config 解析
- `tests/web/seal-crypto.test.ts`
  - document id 生成
  - AES-GCM roundtrip
  - envelope roundtrip（mock `SealClient`）
- `tests/web/soul-access-route.test.ts`
  - access API 返回的解密契约完整
  - perpetual / subscription 两种输入分支
- `tests/web/soul-upload-validation.test.ts`
  - `encrypted` 接受 opaque sealed payload
  - `public` 仍只接受图片

验证命令：

1. `npm test`
2. `npm run typecheck`
3. `cd web && npm run build`
4. `cd move/soul_market && sui move test`

---

## 文件影响清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `web/lib/services/seal.ts` | 改造 | access policy / runtime config / Seal SDK 封装 |
| `web/lib/services/seal-crypto.ts` | 新建 | envelope encrypt/decrypt |
| `web/lib/services/walrus.ts` | 改造 | 网络感知、重试、publisher/aggregator 选择 |
| `web/lib/souls/upload-validation.ts` | 改造 | `encrypted` 改为 opaque sealed payload |
| `web/app/api/souls/upload/route.ts` | 改造 | 支持密文 bundle + sidecar 上传契约 |
| `web/app/api/agent/souls/[id]/access/route.ts` | 改造 | 返回完整解密契约 |
| `move/soul_market/sources/seal_policy.move` | 改造 | 错误码常量化、入口函数硬化 |
| `.env.example` | 改造 | 补 Walrus / Seal / Soul package 相关变量 |
| `web/package.json` | 改造 | 如需引入 `@mysten/seal`，在此落依赖 |
| `tests/web/seal-config.test.ts` | 新建 | Seal 配置契约测试 |
| `tests/web/seal-crypto.test.ts` | 新建 | crypto helper 测试 |
| `tests/web/soul-access-route.test.ts` | 新建 | access API 契约测试 |
| `tests/web/soul-upload-validation.test.ts` | 新建 | 上传校验测试 |

---

## 不在本轮范围

- 恢复 publish 页面与前端钱包流
- 恢复 purchase / renew 结算闭环
- 浏览器侧 upload relay / tip 支付 UI
- Seal key server 商务接入与 API key 采购

---

## 建议但不阻塞本轮

- 为 agent access / decrypt 过程加审计日志。官方安全文档明确指出：Seal key delivery 本身没有链上审计轨迹。
- 建立 key server 供应商清单、SLA 与阈值选择原则，不把 testnet 开放节点当长期可用性承诺。
- 若后续 release 体积继续增大，评估是否需要在 sidecar 里加入 padding / size-hiding 策略，避免长度泄漏。

---

## 验收标准

满足以下条件才算这轮“Walrus + Seal 查漏补缺”完成：

1. 一个 `SoulRelease` 不新增数据库字段，也能完整表达“密文 bundle + 可解密 sidecar”。
2. agent 访问接口单次响应即可推导或直接拿到全部解密参数，不再依赖前端/agent 猜测环境配置。
3. `seal.ts` 不再混淆访问策略包与 Seal 核心包。
4. 上传接口能接受真实 sealed/envelope payload，不再把密文错误地当作 ZIP 结构校验。
5. `seal_policy.move` 的错误码与访问逻辑可测试、可读、可升级。
6. `.env.example`、测试与文档同步更新，不留下“代码能跑、文档没说”的尾巴。

---

## 参考

- 当前仓库：
  - `web/lib/services/seal.ts`
  - `web/lib/services/walrus.ts`
  - `web/lib/souls/upload-validation.ts`
  - `web/app/api/souls/upload/route.ts`
  - `web/app/api/agent/souls/[id]/access/route.ts`
  - `move/soul_market/sources/seal_policy.move`
  - `move/soul_market/sources/series.move`
- KrillTube：
  - `lib/seal/sealClient.ts`
  - `lib/upload/sealUploadOrchestrator.ts`
  - `lib/player/sealDecryptingLoader.ts`
  - `lib/client-walrus-sdk.ts`
  - `lib/walrus-cost.ts`
- 官方文档：
  - `https://seal-docs.wal.app/UsingSeal`
  - `https://seal-docs.wal.app/ExamplePatterns`
  - `https://seal-docs.wal.app/SecurityBestPractices/`
  - `https://seal-docs.wal.app/Pricing`
  - `https://docs.wal.app/docs/operator-guide/upload-relay`
