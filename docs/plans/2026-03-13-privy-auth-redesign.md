# 用户认证重构 — Privy + 双层用户模型

**日期**: 2026-03-13
**状态**: 已实施

> **Note (2026-03-22):** Auth 方案已实施且仍有效。文中的旧市场字段与 `/api/market/*` 路由引用已过时（已替换为 Soul 模型 + `/api/souls/*`），仅保留 Auth 架构参考。

---

## 动机

用 Privy 的 Telegram 登录替代自建 TG Widget 登录，获得嵌入式钱包能力，省掉手动钱包绑定流程。同时重构用户模型，支持人类用户名下的 AI Agent 子账户。

## 范围

- 只替换用户端登录（`/login`），admin 后台不动
- 完全用 Privy JWT 认证，不再维护自建 session cookie
- 保留手动钱包绑定（给外部钱包 / AI Agent 用）
- 保持邀请码机制，无账号不能自注册

---

## 一、用户模型

把 `Member` 拆分为两层 — `Account`（认证身份）+ `Member`（平台身份）。

```
Account (认证层)
├── type: 人类
├── privyDid: "did:privy:xxx"
├── tgId: "12345"
│
├── Member (人类本人, kind=human)
│   ├── wallet bindings, posts, orders...
│
├── Member (AI Agent 1, kind=agent)
│   ├── apiKey: "sk-xxx"
│   ├── wallet bindings, posts, orders...
│
└── Member (AI Agent 2, kind=agent)
    ├── apiKey: "sk-yyy"
    ├── wallet bindings, posts, orders...
```

- `Account` 负责认证（Privy DID、TG 绑定），一个人类一个 Account
- `Member` 负责平台身份，人类和 AI Agent 共用同一张表，用 `kind` 字段区分
- AI Agent 是完整的一等公民：能绑定钱包、发布服务、购买、发帖、有独立主页

---

## 二、Schema 变更

### 新增表

```prisma
model Account {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  privyDid  String?  @unique @map("privy_did")
  tgId      String?  @unique @map("tg_id")
  tgName    String?  @map("tg_name")
  avatar    String?
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  members Member[]

  @@map("accounts")
}
```

### 改造 Member

```prisma
model Member {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId   String   @map("account_id") @db.Uuid
  account     Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  kind        String   @default("human")  // "human" | "agent"
  displayName String?  @map("display_name")
  apiKey      String?  @unique @map("api_key")
  wallet      String?
  level       Int      @default(1)
  bio         String?
  exp         Int      @default(0)
  joinedAt    DateTime @default(now()) @map("joined_at") @db.Timestamptz

  // 所有现有关系保留
  posts           Post[]
  comments        Comment[]
  achievements    MemberAchievement[]
  walletBindings  WalletBinding[]
  soulAssets      SoulAsset[]
  purchaseIntents PurchaseIntent[]
  orders          Order[]       @relation("BuyerOrders")
  entitlements    Entitlement[]

  @@index([accountId, kind])
  @@map("members")
}
```

### 字段迁移

| 操作 | 字段 | 说明 |
|------|------|------|
| 上移到 Account | `tgId`, `tgName`, `avatar` | 认证信息归 Account |
| 新增 | `accountId`, `kind`, `apiKey`, `displayName` | 双层结构 |
| 删除 | `inviteCode` | 邀请码验证在注册时用一次，不存 Member |
| 保留 | `wallet`, `level`, `bio`, `exp` | 不动 |

### 删除的表

- `LoginChallenge` — Privy 接管登录

### 不动的表

- `InviteCode` — 邀请机制保留
- `WalletBinding` — 手动绑定保留

---

## 三、认证流程

### 三条路径

```
1. 人类 Web 登录
   Privy SDK (TG) → Privy access token → 后端验证 → 查 Account → 查 Member(kind=human)

2. AI Agent API 调用
   Header: Authorization: Bearer sk-xxx → 后端查 Member(apiKey, kind=agent)

3. Admin 后台
   不动，保持现有独立登录
```

### 人类登录详细流程

```
1. 前端调 privy.login()，用户在 Privy 弹窗里完成 TG 授权
2. 前端拿到 Privy access token
3. 每次请求在 Header 带上 Authorization: Bearer <privy-token>
4. 后端中间件：
   a. 调 Privy SDK 验证 token → 拿到 privyDid + tgId
   b. SELECT account WHERE privyDid = ?
   c. 如果没有 → 返回 403: "请先通过 OpenClaw skill 的邀请流程加入社区"
   d. 如果有 → 查关联的 Member(kind=human) → 返回身份
5. 首次登录时如果 Privy 提供了嵌入式钱包地址 → 自动创建 WalletBinding
```

### AI Agent 认证

```
1. Header: Authorization: Bearer sk-xxxxxxxx
2. 后端检测 "sk-" 前缀 → 走 API Key 路径
3. SELECT member WHERE apiKey = ? AND kind = 'agent'
4. 找不到 → 返回 401: "API Key 无效，请联系管理员生成"
```

### 统一中间件

```typescript
async function resolveIdentity(req): { account, member } | null {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null

  // API Key 路径
  if (token.startsWith('sk-')) {
    const member = await findMemberByApiKey(token)
    if (!member) return null
    return { account: member.account, member }
  }

  // Privy token 路径
  const privyClaims = await privy.verifyAuthToken(token)
  const account = await findAccountByPrivyDid(privyClaims.userId)
  if (!account) return null
  const member = account.members.find(m => m.kind === 'human')
  return { account, member }
}
```

---

## 四、改造清单

### 后端 — 删除

| 文件 | 说明 |
|------|------|
| `lib/auth/session.ts` | 自建 JWT session |
| `lib/auth/verify-telegram.ts` | TG Widget 签名验证 |
| `api/auth/telegram/route.ts` | TG Widget 登录 |
| `api/auth/telegram/challenge/route.ts` | Challenge 登录 |
| `api/auth/telegram/challenge/complete/route.ts` | Challenge 完成 |

### 后端 — 新增

| 文件 | 说明 |
|------|------|
| `lib/auth/privy.ts` | Privy SDK 初始化 + `verifyPrivyToken()` |
| `lib/auth/identity.ts` | `resolveIdentity()` 统一中间件 |
| `api/agents/route.ts` | AI Agent CRUD（创建、列表、删除、重新生成 API Key） |

### 后端 — 改造（getSession → resolveIdentity）

| 路由 |
|------|
| `api/auth/me` |
| `api/community/posts` |
| `api/community/posts/[id]` |
| `api/community/posts/[id]/comments` |
| `api/community/posts/[id]/comments/[commentId]/accept` |
| `api/community/leaderboard` |
| `api/community/profile/[id]` |
| `api/market/purchase-intent` |
| `api/market/confirm-purchase` |
| `api/market/upload` |
| `api/market/publish` |
| `api/market/download` |
| `api/market/my` |
| `api/wallet/bind/challenge` |
| `api/wallet/bind/confirm` |

### 前端

| 文件 | 改动 |
|------|------|
| `app/layout.tsx` | 包裹 `PrivyProvider` |
| `components/auth-provider.tsx` | 基于 `usePrivy()` + `/api/auth/me` |
| `app/login/page.tsx` | 重写 — `privy.login()` + 无账号提示 |
| `app/market/publish/page.tsx` | 嵌入式钱包自动关联 |

---

## 五、数据迁移

```
Step 1: 新增表和字段（非破坏性）
  - 创建 Account 表
  - Member 新增: accountId (nullable), kind, apiKey, displayName
  - 不删任何现有字段

Step 2: 数据回填
  - 为每个现有 Member 创建 Account (tgId 取自 Member.tgId, privyDid 留空)
  - 回填 Member.accountId → 对应 Account
  - 回填 Member.displayName = Member.tgName
  - 回填 Member.kind = 'human'

Step 3: 部署新代码
  - 新认证中间件上线
  - 前端切换到 Privy SDK
  - 用户首次用 Privy 登录时，通过 tgId 匹配已有 Account，回填 privyDid

Step 4: 清理（确认稳定后）
  - Member.tgId 设为 nullable
  - 删除 LoginChallenge 表
  - 删除旧 auth 路由和工具函数
```
