# AgentBundle 模板市场 MVP 设计方案

**日期**: 2026-03-12
**状态**: 已修订

---

## 决策总结

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 结算方式 | Sui-only | 最快落地，后续再加 Solana 或法币 |
| 商品模型 | 购买授权 + 下载权 | 模板是可重复销售数字商品，不做 1/1 资产转移 |
| 上架方式 | 中心化 DB 托管 | 上下架、搜索、价格、审核都先放在服务端 |
| 存储方案 | Supabase Storage | 先验证需求，后续再考虑 Walrus/Seal |
| 链上职责 | 仅作为支付结算凭证 | MVP 不引入自定义 Move 合约和链上 listing 状态 |
| 授权来源 | 后端验证链上支付后发放 entitlement | 和中心化下载链路一致，避免双重状态机 |
| 市场渠道 | 自有 Web 平台（`web/` 子应用） | 与现有内容/社区体系复用登录和导航 |
| 钱包集成 | `@mysten/dapp-kit` | 官方 SDK，足够支撑钱包连接与发起 PTB |

---

## 核心流程

```text
卖家上传 bundle.zip → 写入 Supabase Storage → DB 创建 Bundle + Listing
→ 买家登录并绑定 Sui 钱包 → 后端创建 PurchaseIntent
→ 买家钱包转账 SUI → 前端回传 txDigest
→ 后端验证支付交易 → 写入 Order + Entitlement
→ 买家下载（Signed URL 5 分钟有效）
```

---

## 授权模型

- 卖家发布的是一个可重复销售的数字商品，不转移源 bundle 的所有权。
- 一个 `Listing` 可以产生多个 `Order`，每个 `Order` 对应一个 `Entitlement`。
- `Entitlement` 的语义是“该成员已为该 bundle 付费，可下载当前版本的交付包”。
- MVP 中 entitlement 不可转售、不可转赠，不做二级市场。
- 链上支付只是付款凭证，不直接承载下载权限对象。

---

## 系统架构

```text
┌──────────────────────────────────────────────────────────────┐
│               现有 clawnews Web (`web/`, Next.js)            │
│  新闻 │ 方向 │ 社区 │ 知识库 │ 技能 │ 【市场】                │
│  Telegram Session + Sui Wallet（仅 market 模块加载）         │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────┴──────────────────────────────────────┐
│                       市场 API                               │
│  /api/market/listings         列表/搜索                      │
│  /api/market/upload           上传 bundle 与预览图           │
│  /api/market/publish          创建/更新 Bundle + Listing     │
│  /api/market/purchase-intent  创建价格快照                   │
│  /api/market/confirm-purchase 验证 txDigest 并发放授权       │
│  /api/market/download         entitlement 鉴权 + signed URL  │
│  /api/wallet/bind/*           钱包绑定 challenge / confirm   │
└───────────────┬───────────────────────────┬──────────────────┘
                │                           │
┌───────────────┴──────────────┐   ┌────────┴──────────────────┐
│ Prisma / Postgres            │   │ Supabase Storage          │
│ Bundle / Listing / Order /   │   │ bundle.zip / preview img  │
│ PurchaseIntent / Entitlement │   │                            │
└───────────────┬──────────────┘   └───────────────────────────┘
                │
┌───────────────┴──────────────┐
│ Sui 链                        │
│ 仅支付交易（txDigest 作为凭证）│
└──────────────────────────────┘
```

**职责划分：**

- **Sui 链上**：完成 SUI 支付结算，提供可验证的交易凭证。
- **Supabase Postgres**：作为 listing、订单、授权的唯一业务真相源。
- **Supabase Storage**：存放交付包、预览图、README 附件。
- **Next.js API**：处理上传、钱包绑定、purchase intent、支付校验、下载鉴权。
- **Next.js 前端**：市场浏览、登录态串联、钱包连接、支付确认、下载入口。

---

## 数据模型 (Prisma)

```prisma
model WalletBinding {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  memberId    String   @map("member_id") @db.Uuid
  member      Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)
  chain       String   @default("sui")
  address     String
  isPrimary   Boolean  @default(true) @map("is_primary")
  verifiedAt  DateTime @default(now()) @map("verified_at") @db.Timestamptz
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  purchaseIntents PurchaseIntent[]
  orders          Order[]
  entitlements    Entitlement[]

  @@unique([chain, address])
  @@index([memberId, chain])
  @@map("wallet_bindings")
}

model AgentBundle {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sellerId      String   @map("seller_id") @db.Uuid
  seller        Member   @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  name          String
  description   String
  version       String   @default("1.0.0")
  category      String
  tags          String[]
  storageBucket String   @default("agent-bundles") @map("storage_bucket")
  storagePath   String   @map("storage_path")
  contentHash   String   @map("content_hash")
  previewImages String[] @map("preview_images")
  readme        String?
  status        String   @default("draft") // draft/reviewing/active/delisted
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  listings     Listing[]
  entitlements Entitlement[]

  @@index([sellerId, status])
  @@map("agent_bundles")
}

model Listing {
  id                  String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  bundleId            String      @map("bundle_id") @db.Uuid
  bundle              AgentBundle @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  sellerWalletAddress String      @map("seller_wallet_address")
  priceMist           BigInt      @map("price_mist")
  currency            String      @default("SUI")
  status              String      @default("active") // active/paused/delisted
  createdAt           DateTime    @default(now()) @map("created_at") @db.Timestamptz
  updatedAt           DateTime    @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  purchaseIntents PurchaseIntent[]
  orders          Order[]

  @@index([bundleId, status])
  @@map("listings")
}

model PurchaseIntent {
  id                String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  listingId         String        @map("listing_id") @db.Uuid
  listing           Listing       @relation(fields: [listingId], references: [id], onDelete: Cascade)
  memberId          String        @map("member_id") @db.Uuid
  member            Member        @relation(fields: [memberId], references: [id], onDelete: Cascade)
  walletBindingId   String        @map("wallet_binding_id") @db.Uuid
  walletBinding     WalletBinding @relation(fields: [walletBindingId], references: [id], onDelete: Cascade)
  expectedPriceMist BigInt        @map("expected_price_mist")
  recipientAddress  String        @map("recipient_address")
  nonce             String        @unique
  expiresAt         DateTime      @map("expires_at") @db.Timestamptz
  txDigest          String?       @unique @map("tx_digest")
  status            String        @default("pending") // pending/confirmed/expired/cancelled
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime      @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  order Order?

  @@index([memberId, status])
  @@index([listingId, status])
  @@map("purchase_intents")
}

model Order {
  id              String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  listingId       String        @map("listing_id") @db.Uuid
  listing         Listing       @relation(fields: [listingId], references: [id], onDelete: Cascade)
  buyerId         String        @map("buyer_id") @db.Uuid
  buyer           Member        @relation(fields: [buyerId], references: [id], onDelete: Cascade)
  walletBindingId String        @map("wallet_binding_id") @db.Uuid
  walletBinding   WalletBinding @relation(fields: [walletBindingId], references: [id], onDelete: Cascade)
  purchaseIntentId String       @unique @map("purchase_intent_id") @db.Uuid
  purchaseIntent  PurchaseIntent @relation(fields: [purchaseIntentId], references: [id], onDelete: Cascade)
  priceMist       BigInt        @map("price_mist")
  txDigest        String        @unique @map("tx_digest")
  status          String        @default("completed") // pending/completed/failed/refunded
  createdAt       DateTime      @default(now()) @map("created_at") @db.Timestamptz

  entitlement Entitlement?

  @@index([buyerId, createdAt(sort: Desc)])
  @@map("orders")
}

model Entitlement {
  id              String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  bundleId        String         @map("bundle_id") @db.Uuid
  bundle          AgentBundle    @relation(fields: [bundleId], references: [id], onDelete: Cascade)
  orderId         String         @unique @map("order_id") @db.Uuid
  order           Order          @relation(fields: [orderId], references: [id], onDelete: Cascade)
  memberId        String         @map("member_id") @db.Uuid
  member          Member         @relation(fields: [memberId], references: [id], onDelete: Cascade)
  walletBindingId String?        @map("wallet_binding_id") @db.Uuid
  walletBinding   WalletBinding? @relation(fields: [walletBindingId], references: [id], onDelete: SetNull)
  accessType      String         @default("download") @map("access_type")
  status          String         @default("active") // active/revoked
  grantedAt       DateTime       @default(now()) @map("granted_at") @db.Timestamptz
  updatedAt       DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@index([memberId, status])
  @@index([bundleId, status])
  @@map("entitlements")
}
```

**补充说明：**

- `Member` 需要新增 `walletBindings`、`soldBundles`、`purchaseIntents`、`orders`、`entitlements` 关联。
- 现有 `Member.wallet` 字段建议保留一个迁移周期，仅作为旧数据兼容；新逻辑统一走 `WalletBinding`。
- `Listing` 是中心化业务对象，不再映射链上 objectId。

---

## 支付与授权设计

MVP 不引入自定义 Move 合约，也不引入独立 indexer。购买链路完全基于“后端创建购买意图 + 钱包发起 SUI 转账 + 后端验证 txDigest”。

### 购买意图 (`PurchaseIntent`)

买家点击购买时，前端先调用：

```text
POST /api/market/purchase-intent
{ listingId }
```

后端返回：

```json
{
  "intentId": "...",
  "nonce": "...",
  "priceMist": "1000000000",
  "recipientAddress": "0x...",
  "expiresAt": "2026-03-12T12:34:56.000Z"
}
```

这个 intent 是服务端生成的价格快照，后续只认这一笔付款。

### 钱包支付

前端使用 `@mysten/dapp-kit` 发起一笔最小 PTB：

```ts
const tx = new Transaction()
const [payment] = tx.splitCoins(tx.gas, [priceMist])
tx.transferObjects([payment], recipientAddress)
```

买家签名成功后拿到 `txDigest`，再调用：

```text
POST /api/market/confirm-purchase
{ intentId, txDigest }
```

### 后端验证规则

后端用 `suiClient.getTransactionBlock({ digest, options })` 校验：

1. 交易执行成功。
2. `sender` 等于当前成员已绑定的钱包地址。
3. 转账接收地址等于 `PurchaseIntent.recipientAddress`。
4. 转账金额等于 `PurchaseIntent.expectedPriceMist`。
5. `PurchaseIntent` 未过期、未取消、未被其他订单消费。
6. `txDigest` 未被历史订单使用。

验证通过后，事务性写入：

- `PurchaseIntent.status = confirmed`
- `Order`
- `Entitlement`

写库必须幂等，唯一键以 `purchaseIntentId` 和 `txDigest` 为准。

---

## 前端页面

| 路由 | 功能 | 认证 |
|------|------|------|
| `/market` | 市场首页，bundle 卡片列表、分类筛选、搜索 | 公开 |
| `/market/[id]` | 详情页，展示说明、预览、价格、购买 CTA | 页面公开，购买动作要求登录+钱包 |
| `/market/publish` | 上架页，填写信息、上传 zip、设价、发布 | 登录 + 已绑定主钱包 |
| `/market/my` | 我的订单、我的授权、下载记录 | 登录 |

**路由约束：**

- `web/middleware.ts` 需要把 `/market` 和 `/market/[id]` 加入 public allowlist。
- `/market/publish`、`/market/my` 和全部写接口继续要求应用登录态。
- 钱包 Provider 仅挂在 `/market` layout 下，不影响其他模块。

---

## 交互流程

### 卖家上架

1. 登录 clawnews Web。
2. 绑定 Sui 钱包，设为主钱包。
3. 进入 `/market/publish` 填写名称、描述、分类、标签、预览图。
4. 上传 `.zip` 模板包到 Supabase Storage。
5. 后端计算 `contentHash`，创建 `AgentBundle`。
6. 卖家填写价格，后端创建 `Listing(status=active)`。
7. 商品出现在 `/market` 列表页。

### 买家购买

1. 浏览 `/market` 或 `/market/[id]`。
2. 点击“购买”时，如未登录或未绑定钱包，则先完成登录与绑定。
3. 前端请求 `POST /api/market/purchase-intent`。
4. 钱包发起 SUI 转账，收款地址为 intent 快照中的 `recipientAddress`。
5. 前端提交 `txDigest` 到 `POST /api/market/confirm-purchase`。
6. 后端验证成功后写入 `Order + Entitlement`。
7. 买家跳转 `/market/my`，即可下载。

### 买家下载

1. 登录后进入 `/market/my`。
2. 点击“下载”。
3. API 校验当前成员是否拥有 `Entitlement(status=active)`。
4. 返回 5 分钟有效的 Supabase Signed URL。

---

## 链下同步策略

MVP 不建独立 indexer，也不消费全量链上事件流。

### 同步原则

- `publish` 完全链下完成，不需要链上确认。
- `purchase` 只在用户明确提交 `intentId + txDigest` 时同步。
- 交易确认接口必须幂等，可安全重试。
- `PurchaseIntent` 过期由定时任务清理为 `expired`。

### 明确不支持的情况

- 用户绕过产品流程直接给卖家地址打款，不会自动获得下载权限。
- 未关联到 `PurchaseIntent` 的链上转账，不参与自动对账。
- 钱包端成功但前端回调丢失时，用户需要在“我的订单”页重试确认；必要时提供手动恢复入口。

这意味着 MVP 的业务真相源仍然是 DB，不是链上事件流。链上的作用是提供支付凭证，而不是推导完整业务状态。

---

## 安全

- **下载鉴权**：只认 `Entitlement(status=active)`，Signed URL 5 分钟有效。
- **钱包绑定**：采用 challenge + nonce + 钱包签名验证；nonce 单次有效，默认 10 分钟过期。
- **账户绑定约束**：一个 Sui 钱包只能绑定一个 clawnews 账户；切换主钱包需要重新签名确认。
- **支付验证**：后端只信任链上交易结果和服务端创建的 `PurchaseIntent`，不信任前端传来的价格或收款地址。
- **幂等写入**：`txDigest`、`purchaseIntentId` 唯一，防止重复确认与重复发放 entitlement。
- **文件完整性**：上传后计算 SHA-256 `contentHash`，写入 `AgentBundle`，后续下载包更新必须重新生成版本。
- **文件上传校验**：限制 MIME、扩展名、体积；上传路径按 seller/member 隔离，避免覆盖攻击。
- **权限边界**：公开页可浏览，购买、下载、上架全部要求应用登录态；后台不要依赖仅钱包连接判断身份。

### MVP 范围外

- 自定义 Move 合约
- 链上 Receipt NFT / Access Pass
- 独立 indexer / 事件监听服务
- 版税 / 二级市场转售
- 退款机制
- Bundle 内容审核自动化
- 评价系统
- 多版本并行授权
- Walrus / Seal 迁移
- Solana 支付通道

---

## 实施步骤

### Step 1: 账户与钱包基础

- 新增 `WalletBinding`、`PurchaseIntent`、`Entitlement` 模型
- `Member` 挂接新 relation，保留旧 `wallet` 字段一个迁移周期
- 实现 `/api/wallet/bind/challenge` 与 `/api/wallet/bind/confirm`

### Step 2: 市场数据层

- Prisma schema 新增 `AgentBundle`、`Listing`、`Order`
- 迁移数据库
- 实现 listing 查询、详情、上下架状态流转

### Step 3: 上传与发布

- `/api/market/upload`：上传 zip 与预览图到 Supabase Storage
- `/api/market/publish`：创建或更新 `AgentBundle + Listing`
- 后端统一计算 `contentHash`

### Step 4: 支付与授权

- `/api/market/purchase-intent`：生成价格快照、收款地址、过期时间
- 前端接入 `@mysten/dapp-kit` 发起 SUI 转账
- `/api/market/confirm-purchase`：校验 `txDigest` 并发放 entitlement
- `/api/market/download`：按 entitlement 签发下载链接

### Step 5: 前端页面

- `/market` layout + 钱包 Provider
- 市场首页（列表/筛选/搜索）
- 详情页（说明/预览/购买）
- 上架页（表单/上传/设价）
- 我的页面（订单/授权/下载）
- 导航栏添加“市场”入口
- `middleware` 放开 `/market` 公开访问

### Step 6: 集成测试

- 完整验证“上架 → 浏览 → 创建 intent → 钱包支付 → 确认订单 → 下载”
- 测试边界情况：intent 过期、金额不匹配、钱包未绑定、重复确认、重复下载
- 在 Sui testnet 上完成至少一轮真实支付验证
