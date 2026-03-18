# Marketplace Phase 2: Solana 支付 + Agent x402 协议设计

**日期**: 2026-03-17
**状态**: 已验证
**前置**: [marketplace-mvp-design](./2026-03-12-marketplace-mvp-design.md)（已基本完成）

---

## 决策总结

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 支付代币 | USDC (主) + SOL (备选) | 稳定定价，Solana 生态最成熟的支付方式 |
| 定价单位 | USD cents | 去耦具体代币波动，USDC 1:1，SOL 按汇率快照 |
| Agent 身份 | Member 子实体 + 自有 Solana 钱包 | P1 用 API key 走 owner 授权，P2/P3 用自有钱包自主购买 |
| Agent 钱包管理 | Agent 自托管（平台只存公钥） | 最简，非托管，无合规负担 |
| x402 范围 | 专用 Agent 端点，与 Web 端点分离 | 机器友好，不干扰现有 Web 流程 |
| Agent 预算控制 | 无限制 | Agent 钱包有多少花多少，完全自主 |
| 分阶段发布 | P1 → P2 → P3 | 递增复杂度，每阶段可独立交付价值 |

---

## 三阶段规划

| Phase | 谁购买 | 支付方式 | Agent 访问模式 |
|-------|--------|---------|---------------|
| **P1: Owner 购买, Agent 消费** | 人类通过 Web UI | Solana (USDC/SOL) 浏览器钱包签名 | API key 访问 owner 的 entitlements |
| **P2: Agent 通过 x402 购买** | Agent 自动完成 | Agent 自有 Solana 钱包 | x402 协议：402 → 付款 → 获取资源 |
| **P3: Agent 自主发现并购买** | Agent 浏览市场 + 自主决策 | Agent 自有 Solana 钱包 | 搜索 API + x402 下载，无需人工介入 |

---

## Phase 1: Solana 支付 + Agent API Key

### 1.1 Solana 支付流程（Web 用户）

与现有 SUI 支付流程同构，替换链和验证逻辑：

```text
买家点击购买 → POST /api/market/purchase-intent
  { listingId, chain: "solana", currency: "USDC" }
  ← { intentId, amount, recipientAddress, mint, expiresAt }

买家在浏览器钱包签名 SPL TransferChecked / SOL transfer
  → 获得 txSignature

POST /api/market/confirm-purchase
  { intentId, txSignature }
  → 后端通过 Solana RPC 验证（confirmed commitment）
  → 写入 Order + Entitlement
```

### 1.2 后端验证规则（Solana）

1. `connection.getTransaction(sig, { commitment: 'confirmed' })` 获取交易
2. 交易执行成功
3. sender 匹配买家绑定的 Solana 钱包
4. recipient 匹配 intent 中的 recipientAddress
5. 金额 ≥ intent 中的 expectedAmount
6. 代币 mint 匹配（USDC: 对应 mint 地址 / SOL: system transfer）
7. txSignature 唯一（防重复确认）

### 1.3 定价模型

- 卖家以 USD 定价，存为 `priceUsdCents`（整数，单位: 分）
- 创建 PurchaseIntent 时快照汇率：
  - USDC: 1:1（amount = priceUsdCents × 10000，即 USDC minor units）
  - SOL: 通过价格预言机 / CoinGecko 查汇率，计算 lamports
- Intent 锁定价格 15 分钟，与现有 SUI 流程一致
- 卖家收款地址不再从 `Listing.sellerWalletAddress` 这种自由字符串读取：
  - SOL: 使用卖家的主 Solana `WalletBinding.address`
  - USDC: 基于卖家主 Solana 钱包派生/校验 ATA，并快照到 intent
  - `Listing.sellerWalletAddress` 继续保留给现有 SUI / legacy 展示与兼容逻辑；若卖家没有主 Solana `WalletBinding`，Solana 购买接口直接返回 400

### 1.4 Schema 变更

```prisma
// Listing — 新增 USD 定价
model Listing {
  // ... existing fields ...
  priceUsdCents  Int       @map("price_usd_cents")  // 新增，USD 定价（分）
  // priceMist 保留向后兼容（SUI 支付仍支持）
}

// PurchaseIntent — 泛化链/币种，并区分 beneficiary / acting agent / payer wallet
model PurchaseIntent {
  // ... existing fields ...
  memberId              String   @map("member_id")                  // entitlement beneficiary（owner）
  agentMemberId         String?  @map("agent_member_id")            // acting agent（P2/P3）
  walletBindingId       String   @map("wallet_binding_id")          // 付款钱包；P1=human, P2/P3=agent
  chain                 String   @default("sui")                    // "sui" | "solana"
  currency              String   @default("SUI")                    // "SUI" | "USDC" | "SOL"
  expectedAmount        BigInt   @map("expected_amount")            // 泛化金额（替代 expectedPriceMist）
  recipientAddress      String   @map("recipient_address")          // SOL 收款地址 / Solana owner 地址
  recipientTokenAccount String?  @map("recipient_token_account")    // SPL/USDC token account snapshot
  paymentRequestId      String?  @unique @map("payment_request_id") // x402 payment-identifier
  // expectedPriceMist 保留向后兼容
}

// Order — entitlement 归 owner，acting agent 单独审计
model Order {
  // ... existing fields ...
  buyerId           String   @map("buyer_id")                // owner human member
  agentMemberId     String?  @map("agent_member_id")         // 谁代 owner 购买（P2/P3）
  chain             String   @default("sui")
  currency          String   @default("SUI")
  paymentRequestId  String?  @unique @map("payment_request_id")
  // txDigest 复用（Solana 的 txSignature / settlement tx id 语义等价）
}
```

### 1.5 Agent 身份与 API Key

扩展现有 `Member(kind='agent')` 模型（已在 "我的 Agents" 中使用）：

```prisma
model Member {
  // ... existing fields ...
  apiKeyHash   String?  @unique @map("api_key_hash")
  agentStatus  String?  @default("active") @map("agent_status") // active | disabled
  // Agent 钱包继续走 WalletBinding；不新增 solanaPublicKey 裸字段
}
```

**API Key 管理流程：**

1. Owner 在 profile 页点击 "生成 API Key"
2. 后端生成随机 key，返回明文（仅显示一次），存 hash
3. Agent runtime 使用 `Authorization: Bearer <apiKey>`
4. 后端解析: apiKey → agent member → owner account → owner human memberId → entitlements

**Agent 下载端点（Phase 1，无 x402）：**

```text
GET /api/agent/bundles/{bundleId}/download
  Authorization: Bearer <apiKey>

  → 200 + { downloadUrl, fileName, expiresIn }   (owner 有 entitlement)
  → 403 + { error: "No entitlement" }             (无权限)
  → 401                                            (无效 API key)
```

---

## Phase 2: x402 协议集成

### 2.1 x402 流程（按 V2 标准）

Agent 请求下载 → 无 entitlement 时返回标准 402 + `PAYMENT-REQUIRED` → Agent 使用官方 x402 client 生成 `PAYMENT-SIGNATURE` → 服务端通过 facilitator / x402 server 验证并结算 → 返回资源。

**第一次请求（无 entitlement）：**

```text
GET /api/agent/bundles/{bundleId}/download
  Authorization: Bearer <apiKey>

← 402 Payment Required
   PAYMENT-REQUIRED: <base64-encoded PaymentRequired>
   Cache-Control: no-store
```

`PaymentRequired` 使用 x402 V2 标准字段：

- `scheme = "exact"`
- `network = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"`（devnet）或 `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`（mainnet）
- `payTo = <seller solana wallet address>`
- `maxAmountRequired = <USDC atomic units>`
- `asset = USDC mint / decimals`
- `mimeType = application/json`
- `extensions.payment-identifier`：启用幂等重试
- P2/P3 的 x402 MVP 仅支持 USDC；SOL 继续保留在 Web / P1 购买路径，未来若要让 Agent 走 SOL 再单独设计自定义 scheme

服务端可在生成 402 时创建内部 `PurchaseIntent`，但 `intentId` 不进入 x402 wire protocol。

**第二次请求（附带标准支付载荷）：**

```text
GET /api/agent/bundles/{bundleId}/download
  Authorization: Bearer <apiKey>
  PAYMENT-SIGNATURE: <base64-encoded PaymentPayload>

← 200 OK
   PAYMENT-RESPONSE: <base64-encoded SettlementResponse>
   { downloadUrl, fileName, expiresIn }
```

后端流程：

1. `Authorization` 先解析出 agent member 和 owner
2. 若 owner 已有 entitlement，直接返回 200，跳过支付
3. 否则由 x402 server（`@x402/next` / `@x402/core`）+ `ExactSvmScheme` 验证 `PAYMENT-SIGNATURE`
4. 通过 facilitator 完成 verify / settle，避免自定义协议分叉
5. `onAfterSettle` hook 创建内部 `Order + Entitlement`
6. `Order.buyerId = owner memberId`，`Order.agentMemberId = acting agent`
7. 返回 `PAYMENT-RESPONSE` + 签名下载 URL

**快捷路径：** 如果 Agent 的 owner 已通过 Web 购买，owner 下任意 agent 都直接返回 200。

### 2.2 Agent 注册 Solana 钱包

```text
POST /api/wallet/bind/challenge
  Authorization: Bearer <apiKey>
  { "chain": "solana" }
  → { nonce, message, expiresAt } + Set-Cookie(wallet-bind-*)

POST /api/wallet/bind/confirm
  Authorization: Bearer <apiKey>
  { "chain": "solana", "address": "...", "signature": "...", "nonce": "..." }
  → 200 + { registered: true }
```

绑定成功后落库为 `WalletBinding(memberId = agentId, chain = 'solana')`。
当前复用现有浏览器式 bind 流程：Agent runtime 需要在 `challenge -> confirm` 两次请求之间保留 `wallet-bind-*` cookies；若后续要支持完全无状态客户端，再引入 DB-backed bind challenge。
同时对 API key 调用启用单独限流：每 agent 每小时最多 5 次 challenge、10 次 confirm，防止泄露 key 被刷接口。

### 2.3 Agent 端 x402 客户端实现（参考）

```typescript
async function fetchWithX402(url: string, apiKey: string, wallet: Keypair) {
  const headers = { 'Authorization': `Bearer ${apiKey}` }

  let res = await fetch(url, { headers })

  if (res.status === 402) {
    const body = await res.json()
    const txSig = await payOnSolana(wallet, body.recipient, body.amount, body.mint)

    res = await fetch(url, {
      headers: {
        ...headers,
        'X-Payment-TxSignature': txSig,
        'X-Payment-Intent': body.intentId,
      },
    })
  }

  return res
}
```

---

## Phase 3: Agent 自主发现

### 3.1 Marketplace API for Agents

```text
GET /api/agent/marketplace/search?q=content+writer&category=媒体&limit=10
  Authorization: Bearer <apiKey>
  ← {
      listings: [
        { id, name, description, category, tags, priceUsdCents, salesCount, version }
      ],
      total: 42
    }

GET /api/agent/marketplace/{listingId}
  Authorization: Bearer <apiKey>
  ← { id, name, description, readme, category, tags, priceUsdCents, salesCount, version, contentHash, seller }

GET /api/agent/bundles/{bundleId}/download
  (x402 flow from Phase 2)
```

三个端点：搜索 → 查看详情 → 购买下载。Agent 自己的 LLM 决定搜什么、买什么。

### 3.2 不做的事

- 不做 Agent 间推荐 / 发现 AI — Agent 自己有 LLM
- 不做预算控制 — Agent 钱包余额即上限
- 不做审批流程 — 完全自主
- 不做 Agent 钱包充值 — Owner 通过普通 Solana 转账充值

---

## 边界情况与错误处理

### 支付失败

| 场景 | 处理方式 |
|------|---------|
| 支付已广播但响应丢失（网络问题） | Agent 使用相同 `payment-identifier` 重试。服务端按 x402 idempotency 返回缓存 / 已结算结果 |
| Tx 提交但未确认 | facilitator / x402 server 返回未完成状态；Agent 用相同 `payment-identifier` 重试直到成功或超时 |
| facilitator 已结算但 `onAfterSettle` DB 事务失败 | Agent 使用相同 `PAYMENT-SIGNATURE` / `payment-identifier` 重试；服务端按唯一 `paymentRequestId` 复用同一 `settling` intent 并重试落库。若持续失败，由 operator 手动处理 `settling` intents |
| Agent 支付金额不足 | 后端验证拒绝，返回 400。资金已到卖家，需手动退款。MVP 接受此风险 |
| Agent 钱包余额不足 | Solana tx 客户端失败。Agent 应向 operator 报告 |
| USDC mint 地址不匹配 | 后端验证 mint 地址，拒绝不匹配交易 |

### Entitlement 冲突

| 场景 | 处理方式 |
|------|---------|
| Owner 已通过 Web 购买，Agent 请求下载 | 200 直接返回（owner 的 entitlement 覆盖所有 agent） |
| 同一 owner 的两个 agent 同时首次通过 x402 购买同一 bundle | 可能产生重复支付；MVP 接受此风险，后续如有需要可按 `(owner, bundle)` 做 pending intent 去重 |
| Agent A 通过 x402 购买，Agent B 请求同 bundle | 200 直接返回（同 owner 共享 entitlement） |
| Agent 通过 x402 购买，Owner 查看"我的购买" | 显示在 owner 的 entitlement 列表中，订单额外展示 `agentMemberId` 审计信息 |
| Bundle 下架 | 已有 entitlement 不受影响，仍可下载 |
| 卖家更新 bundle（新版本） | 同 bundleId，entitlement 覆盖新版本 |

### x402 特定

- 严格使用 V2 标准头：`PAYMENT-REQUIRED`、`PAYMENT-SIGNATURE`、`PAYMENT-RESPONSE`
- 402 响应必须包含 `Cache-Control: no-store`
- 不新增 `X-Payment-*` 私有头；自定义状态放在 x402 `extensions`
- 启用 `payment-identifier` 扩展，支持 Agent 幂等重试
- 对 Solana 直连结算要有 duplicate-settlement 防护；优先走 facilitator
- 速率限制: 每 agent 每分钟最多 10 次 402 创建，防滥用

---

## 实施步骤

### Step 1: Schema 迁移 + Solana 支付基础 (P1)

- Listing 添加 `priceUsdCents`
- PurchaseIntent / Order 泛化 `chain`、`currency`、`expectedAmount`
- PurchaseIntent / Order 增加 `agentMemberId`（审计 acting agent）
- 卖家 Solana 收款统一走 `WalletBinding`；USDC intent 快照 seller ATA
- `Member(kind='agent')` 添加 `apiKeyHash`、`agentStatus`
- 实现 Solana RPC 验证工具函数
- 数据库迁移

### Step 2: Web Solana 支付 (P1)

- 前端接入 Solana wallet adapter（Phantom 等）
- 购买流程支持 chain 选择（SUI / Solana）
- confirm-purchase 路由支持 Solana 验证
- 测试: Solana devnet 完整购买流程

### Step 3: Agent API Key + 下载端点 (P1)

- Agent API key 生成 / 管理 UI
- `GET /api/agent/bundles/{bundleId}/download` 端点
- API key 认证中间件
- owner account → human member 解析逻辑
- 测试: 生成 key → agent 下载已购 bundle

### Step 4: x402 协议 (P2)

- 接入官方 x402 server/client SDK（`@x402/next` / `@x402/core` / `@x402/svm`）
- 扩展现有 wallet bind challenge/confirm 流程以支持 agent API key
- 下载端点添加标准 402 响应逻辑（`PAYMENT-REQUIRED`）
- 通过 facilitator verify / settle；`onAfterSettle` 创建 Order + Entitlement
- 启用 `payment-identifier` 扩展
- 测试: Agent 端到端 x402 购买流程

### Step 5: Agent Marketplace API (P3)

- `GET /api/agent/marketplace/search`
- `GET /api/agent/marketplace/{listingId}`
- 速率限制
- 测试: Agent 搜索 → 发现 → x402 购买 → 下载完整流程

### Step 6: Solana Mainnet + 上线

- 切换 USDC mint 地址到 mainnet
- 价格预言机接入（SOL 定价用）
- 端到端 mainnet 测试
- 文档: Agent x402 接入指南
