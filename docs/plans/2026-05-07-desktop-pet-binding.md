# Desktop App Pet ID 绑定到 Web Account

## Context

Desktop app 是 Soulidity 浮球宠物桌面伴侣。每台 desktop 启动时本地生成一个 Sui Ed25519 keypair，其地址即 pet id。当前 keypair 已用 Electron `safeStorage` 加密存储在 `desktop/apps/desktop/src/main/agent-wallet.ts`；renderer 端已有 `SettingsTab.tsx` 的 Link to Web Account 状态机；web 端已有 `/api/desktop/device/{start,poll,complete}` 三件套。

当前缺口是：pet id 只写入 `DesktopProfile.agentAddress`，没有独立 web 身份，因此 web 业务无法判断 "user X 拥有 pet Y"，`Authorization: Bearer sk-*` 的 agent API 也没有可解析的 agent member。

本 plan 的修订版采用硬边界：

- `DesktopProfile` 继续表示 account-level 桌面偏好，保留 `accountId @unique`，不承载 pet identity、desktop token 或 active source。
- 新增 `DesktopPet` 表表示 per-device / per-pet 身份、token、label、lastSeen 和 active source。
- `/api/desktop/me/active-persona` 读写当前 `DesktopPet.activeSourceType/activeSourceRef`；同一 account 的多个 pet 可以各自选不同 source。
- browser `/complete` 永不返回 `desktopAccessToken` 或 `agentApiKey`；credentials 只通过 desktop poll channel 回到 Electron main process，并由 main process 写入 safeStorage。
- `WalletBinding(chain,address)` 仍是全局唯一。重复绑定同一 pet 地址时复用 / re-enable 原 agent member，不创建冲突 wallet binding。

---

## 现状盘点（已就位 -> 复用）

| 层 | 状态 |
|---|---|
| Desktop SDK | `desktop/apps/desktop/package.json` 已有 `@mysten/sui@2.16.0` |
| Desktop keypair | `agent-wallet.ts` 已生成 Ed25519 keypair，并用 safeStorage 保存 secret |
| Desktop Renderer | `SettingsTab.tsx` 已有 idle / linking / confirmed / error / unlink 状态 |
| Desktop IPC | `device:start-link`, `device:poll`, `desktop-auth:unlink` 已存在 |
| Web device API | `/api/desktop/device/start`, `/poll`, `/complete` 已存在 |
| Web desktop auth | `verifyDesktopAccessToken()` / `requireDesktopIdentity()` 已验证 `dtk_*` |
| Agent API key 基建 | `generateApiKey`, `hashApiKey`, `buildAgentApiKeyData`, `resolveAgentByApiKey` 已存在 |
| Wallet challenge | `issueWalletChallenge(address, purpose)` 已支持 `login` / `agent-join` message 分支 |
| Identity resolver | `resolveIdentity()` 已支持 `Bearer sk-*` 和 agent wallet signature |

## 本轮补齐

1. **Pet identity schema**：新增 `DesktopPet`；从 `DesktopProfile` 移走 `agentAddress`、`desktopAccessToken*`、active source。
2. **绑定事务**：确认 device session 时创建或复用 `Member(kind='agent')` + `WalletBinding` + `DesktopPet`，并写入 agent API key hash。
3. **持有权证明**：`/start` 前要求 desktop 用本地 pet keypair 签 `desktop-link` challenge，防止 self-claim 陌生地址。
4. **Secret routing**：browser 只看到绑定结果；Electron main process 存储 `dtk_*` 和 `sk-*`，renderer 不接触明文 credential。
5. **管理面**：新增 `/account/pets` 列表、改名、解绑；API key rotation 放在 desktop Settings 内完成。
6. **Per-pet active source**：desktop `/me` 与 `/me/active-persona` 都以当前 pet 为边界，不再使用 account-level active source。

---

## A. Schema 变更

### `prisma/schema.prisma`

`Account` 保留 1:1 `desktopProfile`，新增 1:N `desktopPets`：

```prisma
model Account {
  // existing fields
  desktopProfile DesktopProfile?
  desktopPets    DesktopPet[]
}
```

`DesktopProfile` 保留 account-level 偏好，不再承载 pet identity / auth token / active source：

```prisma
model DesktopProfile {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId   String   @unique @map("account_id") @db.Uuid
  account     Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  preferences Json?
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@map("desktop_profiles")
}
```

新增 `DesktopPet`：

```prisma
model DesktopPet {
  id                         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId                  String    @map("account_id") @db.Uuid
  account                    Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  agentAddress               String    @map("agent_address")
  agentMemberId              String    @unique @map("agent_member_id") @db.Uuid
  agentMember                Member    @relation("DesktopPetAgentMember", fields: [agentMemberId], references: [id], onDelete: Restrict)
  label                      String
  desktopAccessTokenHash     String?   @unique(map: "desktop_pets_desktop_access_token_hash_key") @map("desktop_access_token_hash")
  desktopAccessTokenIssuedAt DateTime? @map("desktop_access_token_issued_at") @db.Timestamptz
  activeSourceType           String?   @map("active_source_type")
  activeSourceRef            String?   @map("active_source_ref")
  lastSyncedAt               DateTime? @map("last_synced_at") @db.Timestamptz
  lastSeenAt                 DateTime? @map("last_seen_at") @db.Timestamptz
  createdAt                  DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt                  DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([accountId, agentAddress], map: "desktop_pets_account_agent_address_key")
  @@index([accountId, updatedAt(sort: Desc)])
  @@index([accountId, activeSourceType, activeSourceRef])
  @@index([agentAddress])
  @@map("desktop_pets")
}
```

`Member` 增加反向关系 + durable rotation fields（服务端只存 hash 和 rotation id，不缓存明文 key）：

```prisma
model Member {
  // existing fields
  apiKeyRotationId              String?     @unique @map("api_key_rotation_id")
  pendingApiKeyHash             String?     @map("pending_api_key_hash")
  pendingApiKeyRotationId       String?     @unique @map("pending_api_key_rotation_id")
  pendingApiKeyRotationExpiresAt DateTime?  @map("pending_api_key_rotation_expires_at") @db.Timestamptz
  desktopPet                    DesktopPet? @relation("DesktopPetAgentMember")
}
```

`WalletChallenge` 增加 purpose，防止 login / agent-join / desktop-link nonce 混用：

```prisma
model WalletChallenge {
  // existing fields
  purpose String @default("login")

  @@index([purpose, address, expiresAt])
}
```

### Migration policy

生成 migration：

```bash
npx prisma migrate dev --name desktop_pet_identity_split --schema=prisma/schema.prisma
```

Migration 必须包含 legacy data guard。因为当前 plan 按未上线桌面身份表执行 hard cut，如果旧 `desktop_profiles` 中已有任一 `agent_address`、`desktop_access_token_hash` 或 account-level active source，migration 应 fail fast，避免静默丢 token / source 选择：

```sql
DO $$
BEGIN
	  IF EXISTS (
	    SELECT 1 FROM "desktop_profiles"
	    WHERE "agent_address" IS NOT NULL
	       OR "desktop_access_token_hash" IS NOT NULL
	       OR "active_source_type" IS NOT NULL
	       OR "active_source_ref" IS NOT NULL
	       OR "last_synced_at" IS NOT NULL
	  ) THEN
	    RAISE EXCEPTION 'desktop_profiles contains legacy desktop auth/source data; run explicit backfill before desktop_pet_identity_split';
	  END IF;
END $$;
```

随后创建 `desktop_pets`、增加 `wallet_challenges.purpose`，再从 `desktop_profiles` 删除 `agent_address` / `desktop_access_token_hash` / `desktop_access_token_issued_at` / `active_source_type` / `active_source_ref` / `last_synced_at`。

Migration 末尾清空现存 challenge 行，避免 backfill 默认 `'login'` 让仍未使用的 legacy `agent-join` / `desktop-link` nonce 被错当成 login nonce。`wallet_challenges` 本身是短 TTL 临时表，被清掉的登录挑战可由前端重新签发：

```sql
DELETE FROM "wallet_challenges";
```

---

## B. Web 绑定与 Credential Contract

### Device session service

修改 `web/lib/desktop/device-session.ts`：

- `persistConfirmedDesktopSession()` 不再 upsert `DesktopProfile`。
- 新增 `persistConfirmedDesktopPet()`，在同一 transaction 内完成 pet member / wallet binding / desktop pet 写入。
- 多设备绑定不再 expire 同 account 的其他 confirmed session，只 expire 同 account + 同 `agentAddress` 的旧 confirmed sessions。
- `completeDesktopDeviceSession()` 可以在内部拿到 credentials，但返回给 browser route 前仍会被 strip。
- `pollDesktopDeviceSession()` 是唯一向 desktop main 返回 credentials 的 web endpoint。

新增或调整的 helper contract：

```ts
interface PersistedDesktopPetCredentials {
  desktopAccessToken: string
  agentApiKey: string
}

interface DesktopPetIdentity {
  desktopPetId: string
  accountId: string
  agentAddress: string
  agentMemberId: string
}
```

`agentApiKey` 生成必须支持 confirmed poll retry。把 desktop credential helper 集中在 `web/lib/desktop/auth.ts`：导出 `getDesktopCredentialSecret()`，并新增 deterministic `generateAgentApiKeyForDeviceSession(deviceCode)`，和 `generateDesktopAccessTokenForDeviceSession(deviceCode)` 同类：

```ts
export function generateAgentApiKeyForDeviceSession(deviceCode: string): { apiKey: string; hash: string } {
  const digest = createHmac('sha256', getDesktopCredentialSecret())
    .update(`desktop-agent-api-key:${deviceCode}`)
    .digest('hex')
  const apiKey = `sk-${digest}`
  return { apiKey, hash: hashApiKey(apiKey) }
}
```

`persistConfirmedDesktopPet()` 的 wallet binding 策略必须是幂等的：

- 若 `walletBinding(chain='sui', address=agentAddress)` 不存在：创建 `Member(kind='agent')`、创建 wallet binding、创建 `DesktopPet`。
- 若 binding 已存在且 member 是同 account 的 `kind='agent'`：复用该 member，更新 `agentStatus='active'` 和 `apiKeyHash`，再 upsert `DesktopPet`。
- 若 binding 属于 human member 或其他 account：抛 `DesktopPetAddressConflictError`，route 返回 409。
- 若同 account + same `agentAddress` 已有 `DesktopPet`：更新 label 默认值以外的 token/hash/member 字段，不创建第二条 active pet。

### Desktop auth

修改 `web/lib/desktop/auth.ts`：

- `verifyDesktopAccessToken()` 改查 `prisma.desktopPet.findUnique({ where: { desktopAccessTokenHash } })`。
- 返回 `{ accountId, desktopPetId, agentAddress, agentMemberId }`。
- 成功验证后 best-effort 更新 `DesktopPet.lastSeenAt`，**带 60s 进程内节流**：在 `web/lib/desktop/auth.ts` 内维护 `Map<desktopPetId, lastUpdatedAt>`，命中 60s 内跳过 DB write，避免 floating ball `/api/desktop/me` 高频 polling 把 `desktop_pets` 写成热点。
- `requireDesktopIdentity()` 返回值增加 `desktopPet?: DesktopPetIdentity`；browser human auth 路径没有 `desktopPet`。

所有 desktop routes 继续用 `auth.accountId` 过滤 owner 数据；需要 pet identity 的 route 使用 `auth.desktopPet`。

### Desktop profile / active source

修改 `web/lib/desktop/profile.ts`、`web/app/api/desktop/me/route.ts`、`web/app/api/desktop/me/active-persona/route.ts`：

- `getDesktopMe()` 接收 `{ accountId, desktopPetId }`，desktop token path 必须带 `desktopPetId`。
- `/api/desktop/me` 返回当前 `DesktopPet.activeSourceType/activeSourceRef/lastSyncedAt`，不再从 `DesktopProfile` 读取 active source。
- `/api/desktop/me/active-persona` 只允许 desktop token 调用；缺少 `auth.desktopPet` 时返回 403。
- `setDesktopActivePersona()` 改成按 `{ accountId, desktopPetId }` 更新 `DesktopPet`，where 条件必须同时校验 pet 属于该 account。
- `DesktopProfile.preferences` 仍可保存 account-level 桌面偏好，但不得再保存 active source。

### Browser route secret boundary

`web/app/api/desktop/device/complete/route.ts` 保持当前安全策略：

- 允许 browser human 完成 userCode。
- response 只返回 `status/accountId/userCode/expiresAt/confirmedAt/pollInterval/deepLink`。
- 永不返回 `desktopAccessToken` / `agentApiKey` / `deviceCode`。

`web/app/api/desktop/device/poll/route.ts`：

- confirmed 时返回 `desktopAccessToken` 和 `agentApiKey`。
- 如果 `DesktopPet.agentMember.apiKeyHash` 已被 desktop-authenticated rotation 改过，poll 不再返回旧 deterministic `agentApiKey`，只返回 `desktopAccessToken`。

---

## C. Desktop-Link 签名防伪

### Challenge route

新增 `web/app/api/desktop/device/challenge/route.ts`：

- `POST { address }`
- normalize Sui address
- rate limit bucket：`device-challenge:{ip}:{address}`
- 调 `issueWalletChallenge(address, 'desktop-link')`
- 返回 `{ address, nonce, message, expiresAt, domain }`

### Challenge helpers

修改 `web/lib/auth/challenge.ts` / `web/lib/auth/wallet-challenge.ts`：

- `WalletChallengePurpose = 'login' | 'agent-join' | 'desktop-link'`
- 新增 `buildDesktopLinkChallengeMessage(domain, address, nonce, expiresAt)`，message 文案必须区别于 login / agent registration。
- `issueWalletChallenge()` 写入 `purpose`。
- login 和 agent wallet signature 消费 nonce 时必须校验对应 purpose。

新增 shared consume helper，供 login / identity / desktop start 复用：

```ts
async function consumeWalletChallengeForPurpose(params: {
  nonce: string
  address: string
  purpose: WalletChallengePurpose
  signature: string
}): Promise<boolean>
```

该 helper 必须检查：

- nonce 是 UUID
- address normalized 后匹配 challenge.address
- challenge.purpose 匹配
- `usedAt` 为空
- `expiresAt >= now`
- signature 对 expected message 和 address 有效
- 用 `updateMany({ where: { nonce, usedAt: null }, data: { usedAt: now } })` 原子消费；`count === 0` 时返回 false

### Start route

修改 `web/app/api/desktop/device/start/route.ts`：

- request body 必须包含 `{ agentAddress, nonce, signature }`
- 先 consume `desktop-link` challenge
- 通过后调用 `startDesktopDeviceSession({ agentAddress })`
- 签名错误、nonce 已用、地址不匹配、challenge 过期统一返回 401
- rate limit 保留现有 IP bucket，并增加 address bucket

---

## D. Desktop Main / Preload / Renderer

### Main process owns secrets

`desktop/apps/desktop/src/main/index.ts`：

- `device:start-link` 不再信任 renderer 传入的 `agentAddress`。
- handler 内部调用 `generateAgentKeypair()` / `loadAgentKeypair()` 得到真实 pet address。
- handler 顺序：`POST /challenge` -> main process 用 pet keypair sign message -> `POST /start`。
- `device:poll` 收到 confirmed credential 后必须**双写成功才返 confirmed**：先写 `desktop_token.enc` 再写 `agent_api_key.enc`，任一失败保留 `deviceCode` 不清、不向 renderer 返回 confirmed，下一次 poll tick 用同一 `deviceCode` 再请求；HMAC determinism 保证拿到同对凭据，幂等可重试。连续 3 次写失败回退为 `error: storage-failed` 状态，由 SettingsTab 触发 unlink + 重新 link。
- renderer 不接收 `desktopAccessToken` 或 `agentApiKey` 明文。
- 新增 `agent_keypair:rotate` IPC（T-A）：内部先走 `agentResetIdentity()` 的 server-side revoke，成功后清掉 `agent_secret.enc` + `agent_keypair.json` + `desktop_token.enc` + `agent_api_key.enc` 并生成新 keypair。仅供"换 pet 身份"场景；不得绕过 server revoke 直接遗留旧 pet。

`desktop/apps/desktop/src/main/agent-wallet.ts`：

- 新增 `signAgentPersonalMessage(message: Uint8Array): Promise<{ signature: string }>`。
- 新增 secret decode helper，兼容当前 safeStorage 中的 bech32-string hex encoding，以及 legacy JSON secret。
- 如果 encrypted secret 存在但无法 decrypt，继续 fail closed，不删除 metadata。

新增 `desktop/apps/desktop/src/main/agent-api-key-store.ts`：

- `storeAgentApiKey(apiKey: string, agentMemberId?: string | null): void`
- `loadAgentApiKey(): string | null`
- `clearAgentApiKey(): void`
- `getAgentApiKeyStatus(): { hasKey: boolean; storedAt: number | null }`
- `rotateAgentApiKey(): Promise<{ ok: true } | { ok: false; error: string }>` —
  内部走 durable pending hash + write-then-commit 流程：
  1. 生成 client-side `rotationId = randomUUID()`，**进程内 single-flight**：若已有 inflight rotate 直接复用同一 promise（避免双击竞态）。
  2. `POST /api/desktop/me/agent-key/rotate { rotationId }` 携带 `dtk_*`；server 用 `desktop-agent-api-key-rotate:${agentMemberId}:${rotationId}` HMAC deterministic 生成 `sk-*`，只把 hash 写入 `Member.pendingApiKeyHash/pendingApiKeyRotationId/pendingApiKeyRotationExpiresAt`，不改当前 `apiKeyHash`。
  3. server 返回 `{ apiKey }`；同一 `rotationId` 重试时从 DB pending/committed rotation state 重新推导同一 `apiKey`，不依赖进程内明文缓存。
  4. 写入 `agent_api_key.enc`；写成功才发 `POST /api/desktop/me/agent-key/rotate/commit { rotationId }`。
  5. commit 在单个 DB update 中把 `pendingApiKeyHash` promote 到 `apiKeyHash`，设置 `apiKeyRotationId = rotationId`，清空 pending fields；commit 丢响应后重试同 `rotationId` 返回 ok。
  6. rotate 或 commit 过期返回 `409 stale-rotation`，旧 `apiKeyHash` 仍有效；main 用新 `rotationId` 重发并覆盖本地 enc 文件。
- 使用 safeStorage；不记录明文，不写 renderer-accessible 文件。

`desktop/apps/desktop/src/main/desktop-auth-store.ts`：

- 继续只负责 `dtk_*`。
- `desktop-auth:unlink` 同时清 `desktop_token.enc` 和 `agent_api_key.enc`。

### Preload API

`desktop/apps/desktop/src/preload/index.ts` 和 `desktop/apps/desktop/src/renderer/env.d.ts`：

- `deviceStartLink()` 不再接收 `agentAddress` 参数。
- `devicePoll(deviceCode)` 不暴露 credentials。
- 不新增 `agent:get-api-key` 或 `agent:sign-message` 给 renderer。
- 新增 `agentRotateApiKey()`，但它只返回 `{ ok: true } | { ok: false; error: string }`，明文 key 仍只在 main process 内存中流转并写入 safeStorage。
- 新增 `agentResetIdentity()`（T-A）：如果本地存在 `dtk_*`，main process 必须先 POST `/api/desktop/me/revoke` 完成 server-side revoke；server 返回 success 后才清掉所有 desktop-side 凭据 + keypair + metadata。没有 `dtk_*` 时只允许 local-only reset，并在返回值中标记 `remoteRevoked: false`。

### Renderer UX

`desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.tsx`：

- Link card 显示 userCode，并提供 copy userCode / open browser。
- Open Browser 跳 `/account/pets?link=<userCode>`。
- Confirmed card 显示 Pet ID、linked account、agent key status，不显示 `sk-*` 明文。
- Regenerate API key 按钮调用 desktop main 的 `agentRotateApiKey()`；按钮点下后 disable 直到 IPC resolve（防双击 + 配合 main 内 single-flight）；成功后只显示 "Agent key stored"。
- Reset Pet Identity 按钮（T-A，二级折叠区）—— 二次确认后调用 `agentResetIdentity()`；只有 server-side revoke 成功或确认无 remote binding 时，UI 才退回未绑定态。若 revoke 返回 401/5xx，UI 显示 remote revoke failed，并引导到 `/account/pets` 删除该 pet，不得声称泄漏已处理。
- Unlink 继续清本地 credentials；web-side unlink 由 `/account/pets` 完成。

`desktop/apps/desktop/src/renderer/components/FloatingBall/*`：

- 未绑定时只显示小状态徽标。
- 徽标状态来自 `desktop-auth:status` / verified `/api/desktop/me`，不读取 credential。

---

## E. Web `/account/pets`

新增 account pets 管理面：

| 路径 | 类型 | 功能 |
|---|---|---|
| `web/app/account/pets/page.tsx` | RSC | 登录后列出当前 account 的 `DesktopPet[]` |
| `web/app/account/pets/_components/LinkPetDialog.tsx` | client | 读取 `?link=` 预填 userCode，POST `/api/desktop/device/complete` |
| `web/app/account/pets/_components/PetCard.tsx` | client | label、agentAddress、lastSeenAt、agentStatus、改名、解绑 |
| `web/app/api/account/pets/route.ts` | GET | 返回当前 account 的 pet 列表 |
| `web/app/api/account/pets/[id]/route.ts` | PATCH / DELETE | PATCH label；DELETE 解绑 |

`DELETE /api/account/pets/[id]` 必须在 transaction 内：

- 校验 pet 属于当前 human account。
- 删除 `DesktopPet`。
- `member.update({ where: { id: agentMemberId }, data: { agentStatus: 'disabled', apiKeyHash: null, apiKeyRotationId: null, pendingApiKeyHash: null, pendingApiKeyRotationId: null, pendingApiKeyRotationExpiresAt: null } })`。
- 保留 `WalletBinding`，用于同一 desktop address 重新绑定时 revive 同一个 agent member。
- 保留历史 grant / purchase 关联。

不新增 browser-side regenerate-key endpoint。API key rotation 只能由已绑定 desktop 使用 `dtk_*` 调 desktop-authenticated route 完成，避免 browser 拿到但 desktop 没有安装的新 `sk-*`。

新增 desktop-authenticated revoke route：

| 路径 | 类型 | 功能 |
|---|---|---|
| `web/app/api/desktop/me/revoke/route.ts` | POST | 只允许 `dtk_*`。根据 `auth.desktopPet` 在 transaction 内删除当前 `DesktopPet`，disable 对应 `Member(kind='agent')`，清空 `apiKeyHash/apiKeyRotationId/pending*`。成功后当前 `dtk_*` 与 `sk-*` 都必须失效。 |

新增 desktop-authenticated rotation routes（durable pending hash + write-then-commit 协议）：

| 路径 | 类型 | 功能 |
|---|---|---|
| `web/app/api/desktop/me/agent-key/rotate/route.ts` | POST | 需要 `dtk_*` + body `{ rotationId }`；server 先清掉过期 pending fields，再用 HMAC deterministic 生成 `apiKey` + hash。若 `apiKeyRotationId === rotationId` 或 `pendingApiKeyRotationId === rotationId`，返回同一 `apiKey`；否则只写 `pendingApiKeyHash/pendingApiKeyRotationId/pendingApiKeyRotationExpiresAt`，不改当前 `apiKeyHash`。 |
| `web/app/api/desktop/me/agent-key/rotate/commit/route.ts` | POST | 需要 `dtk_*` + body `{ rotationId }`；若 pending rotation 匹配且未过期，原子 promote pending hash 到 `apiKeyHash`，设置 `apiKeyRotationId = rotationId`，清空 pending fields。若已 commit 同一 `rotationId`，返回 ok；若 pending 过期或不匹配，返回 `409 stale-rotation` 且旧 active key 保持有效。 |

该路由族只允许 desktop token path。browser human cookie 调用返回 403。

`Member` 的 rotation fields 与 `apiKeyHash` 一起构成状态机：`apiKeyHash` 是唯一 active key，`pendingApiKeyHash` 只在 desktop 本地写入 enc 文件前暂存。任何 server 重启、多实例或 desktop 写盘失败都不会让 active key 先失效。

导航入口：

- 顶部 account menu 增加 "My Pets" -> `/account/pets`。
- 现有 `/desktop/link` 页面改为 redirect：保留 `?link=` 参数并跳 `/account/pets?link=...`；无 code 时跳 `/account/pets`，由 pets 页面提示去 desktop Settings 获取 userCode。

---

## F. 关键文件清单

### 修改

```text
prisma/schema.prisma
web/lib/auth/challenge.ts
web/lib/auth/wallet-challenge.ts
web/lib/auth/identity.ts
web/lib/auth/resolve-agent.ts
web/lib/desktop/auth.ts
web/lib/desktop/device-session.ts
web/lib/desktop/profile.ts
web/lib/types/desktop.ts
web/app/api/desktop/device/start/route.ts
web/app/api/desktop/device/poll/route.ts
web/app/api/desktop/device/complete/route.ts
web/app/api/desktop/me/route.ts
web/app/api/desktop/me/active-persona/route.ts
web/app/desktop/link/page.tsx
web/components/nav/account-button.tsx
desktop/apps/desktop/src/main/index.ts
desktop/apps/desktop/src/main/agent-wallet.ts
desktop/apps/desktop/src/main/desktop-auth-store.ts
desktop/apps/desktop/src/preload/index.ts
desktop/apps/desktop/src/renderer/env.d.ts
desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.tsx
desktop/apps/desktop/src/renderer/components/FloatingBall/index.tsx
desktop/apps/desktop/src/renderer/components/FloatingBall/styles.css
```

### 新增

```text
desktop/apps/desktop/src/main/agent-api-key-store.ts
web/app/api/desktop/device/challenge/route.ts
web/app/api/desktop/me/revoke/route.ts
web/app/api/desktop/me/agent-key/rotate/route.ts
web/app/api/desktop/me/agent-key/rotate/commit/route.ts
web/app/account/pets/page.tsx
web/app/account/pets/_components/LinkPetDialog.tsx
web/app/account/pets/_components/PetCard.tsx
web/app/api/account/pets/route.ts
web/app/api/account/pets/[id]/route.ts
prisma/migrations/<timestamp>_desktop_pet_identity_split/migration.sql
```

### 测试更新 / 新增

```text
tests/new-web/desktop-device-session.test.ts
tests/new-web/desktop-device-routes.test.ts
tests/new-web/desktop-profile-service.test.ts
web/lib/desktop/__tests__/auth.test.ts
tests/new-web/desktop-pets-api.test.ts
tests/new-web/desktop-pet-persist.test.ts                # NEW — persistConfirmedDesktopPet 5 分支
tests/new-web/wallet-challenge-consume.test.ts           # NEW — purpose 矩阵 + login/agent-join regression
tests/new-web/desktop-auth-token-redirect.test.ts        # NEW — REGRESSION: 不再查 desktop_profiles
tests/new-web/agent-key-rotate-idempotent.test.ts        # NEW — A3 pending hash / commit / stale-rotation
tests/new-web/desktop-pets-revive.test.ts                # NEW — 同 address unlink → re-link 复用 Member
tests/new-web/desktop-lastseen-throttle.test.ts          # NEW — A5 60s 节流
tests/new-web/desktop-pet-active-source.test.ts          # NEW — 同 account 多 pet active source 隔离
tests/new-web/desktop-reset-identity-revoke.test.ts      # NEW — Reset Pet Identity server revoke
desktop/apps/desktop/src/renderer/components/MainWindow/SettingsTab.test.tsx
desktop/apps/desktop/src/main/agent-wallet.test.ts
desktop/apps/desktop/src/main/agent-api-key-store.test.ts
```

---

## G. 验收标准

### Schema / Prisma

```bash
npx prisma migrate dev --name desktop_pet_identity_split --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
npx prisma validate --schema=prisma/schema.prisma
```

验收：

- `DesktopProfile.accountId` 仍是 unique。
- `DesktopPet` 存在，且 `@@unique([accountId, agentAddress])` 存在。
- `DesktopPet.activeSourceType/activeSourceRef/lastSyncedAt` 存在；`DesktopProfile` 不再有 active source columns。
- `Member.desktopPet` 反向关系存在。
- `Member.apiKeyRotationId/pendingApiKeyHash/pendingApiKeyRotationId/pendingApiKeyRotationExpiresAt` 存在。
- `WalletChallenge.purpose` 存在，login / agent-join / desktop-link 都会写入 purpose。

### Targeted web tests

```bash
npx vitest run \
  tests/new-web/desktop-device-session.test.ts \
  tests/new-web/desktop-device-routes.test.ts \
  tests/new-web/desktop-profile-service.test.ts \
  web/lib/desktop/__tests__/auth.test.ts \
  tests/new-web/desktop-pets-api.test.ts \
  tests/new-web/desktop-pet-persist.test.ts \
  tests/new-web/wallet-challenge-consume.test.ts \
  tests/new-web/desktop-auth-token-redirect.test.ts \
  tests/new-web/agent-key-rotate-idempotent.test.ts \
  tests/new-web/desktop-pets-revive.test.ts \
  tests/new-web/desktop-lastseen-throttle.test.ts \
  tests/new-web/desktop-pet-active-source.test.ts \
  tests/new-web/desktop-reset-identity-revoke.test.ts
```

必须覆盖：

- `/device/start` 缺少 nonce/signature 返回 400 或 401。
- signature 篡改、address 不匹配、nonce replay、wrong purpose 均返回 401。
- `/complete` 创建或 revive agent member + wallet binding + desktop pet。
- 同 account 绑定两个不同 pet address 后有两条 `DesktopPet`。
- 同 pet address 解绑后重新绑定复用原 agent member，不触发 `WalletBinding(chain,address)` unique 冲突。
- browser `/complete` response 不含 `desktopAccessToken` / `agentApiKey` / `deviceCode`。
- desktop `/poll` confirmed response 含 credentials；route 层测试覆盖，renderer mock 不应接触明文。
- `verifyDesktopAccessToken()` 从 `DesktopPet` 解析 account + pet identity，并更新 `lastSeenAt`。
- `/account/pets/[id]` DELETE 后旧 `dtk_*` 和旧 `sk-*` 都 401。
- `/api/desktop/me/active-persona` 用当前 `desktopPetId` 写 `DesktopPet`；同 account 两个 pet 设置不同 source 时互不覆盖。
- `agentResetIdentity()` 先调 `/api/desktop/me/revoke`，server 删除当前 `DesktopPet` 并 disable agent member；revoke 成功后旧 `dtk_*` 和旧 `sk-*` 都 401。
- **REGRESSION**：`verifyDesktopAccessToken()` 不再触达 `desktop_profiles.desktop_access_token_hash`（已删列）；查询完全走 `desktop_pets`。
- **REGRESSION**：`consumeWalletChallengeForPurpose` 在 login（`purpose='login'`）和 agent-join（`purpose='agent-join'`）路径下分别正常消费；purpose 不匹配的 nonce 不会被消费。
- **A3 idempotent rotate**：rotate 不修改 active `apiKeyHash`；同 `rotationId` 在 pending 或 committed 状态都能 deterministic 返回同 `apiKey`；commit 后旧 active key 被新 hash 替换；过期 pending commit 返 `409 stale-rotation` 且旧 active key 仍有效。
- **A5 lastSeenAt 节流**：60s 内多次 `/api/desktop/me` 命中缓存仅触发 1 次 DB UPDATE。
- **Cross-account conflict**：同 `agentAddress` 已绑到另一 account 的 human/agent member 时返 409。
- **Persist transaction integrity**：`persistConfirmedDesktopPet` UniqueViolation race 下不会创建第二条 active pet。

### Desktop tests

```bash
pnpm --dir desktop exec vitest run \
  apps/desktop/src/renderer/components/MainWindow/SettingsTab.test.tsx \
  apps/desktop/src/main/agent-wallet.test.ts \
  apps/desktop/src/main/agent-api-key-store.test.ts
pnpm --dir desktop --filter @soulidity/desktop run typecheck
```

必须覆盖：

- `deviceStartLink()` 不再接收 renderer-provided address。
- main process challenge -> sign -> start 顺序正确。
- `devicePoll()` 写入 `desktop_token.enc` 和 `agent_api_key.enc` 后，只给 renderer 返回 sanitized status。
- Settings confirmed card 不渲染 `sk-*`。
- safeStorage 不可用时 link 不显示成功态。
- **A2 双写部分失败**：mock `agent_api_key.enc` 写失败 → `devicePoll()` 不返回 confirmed，保留 deviceCode；下一次 poll tick 重试成功。
- **A2 fallback**：连续 3 次双写失败 → 返回 `error: storage-failed`。
- **A4 single-flight rotate**：并发两次 `agentRotateApiKey()` IPC 复用同一 in-flight promise，仅一次网络请求触发。
- **`signAgentPersonalMessage()`**：bech32-string-hex roundtrip 正确，签出 sig 通过 `verifyPersonalMessageSignature` 校验。
- **T-A `agentResetIdentity()`**：有 `dtk_*` 时先调用 `/api/desktop/me/revoke`；revoke 成功后清光 keypair + 凭据，`loadAgentKeypair()` 返回 null，`getAgentApiKeyStatus().hasKey === false`；revoke 失败时不显示 leak-safe 成功态。

### Full repo checks

```bash
npm run typecheck:root
npm --prefix web run typecheck
npm test
```

### Browser / desktop e2e

```bash
# terminal 1
npm --prefix web run dev

# terminal 2
pnpm --dir desktop --filter @soulidity/desktop run dev
```

手工验收顺序：

1. Desktop Settings 点 Link。
2. renderer 显示 userCode，可复制，可打开 `/account/pets?link=<userCode>`。
3. browser 登录后 LinkPetDialog 自动预填 userCode，确认后 browser 只显示 success，不显示 token/key。
4. Desktop poll confirmed 后显示 Pet ID 和 Agent key stored。
5. `/account/pets` 出现该 pet，`lastSeenAt` 在 desktop 调 `/api/desktop/me` 后更新。
6. 用 main process 存的 `sk-*` 调 `/api/agent/souls/search` 返回 200。
7. 同一 account 下两个 desktop 分别设置不同 active source；各自 `/api/desktop/me` 返回自己的 source，不互相覆盖。
8. 第二个 desktop 或 reset pet key 后重复绑定，列表出现第二条 pet。
9. 在第一台 desktop 执行 Reset Pet Identity，server revoke 成功后本地回到未绑定态，旧 `dtk_*` 调 `/api/desktop/me` 返回 401，旧 `sk-*` 调 `/api/agent/souls/search` 返回 401。
10. 在 `/account/pets` 删除第二条 pet 后，第二台 desktop 的旧 `dtk_*` 和旧 `sk-*` 都返回 401。

### Packaged app verification

有签名环境时：

```bash
cd desktop/apps/desktop
pnpm package:mac
open -n "release/mac-arm64/Soulidity Desktop.app"
pgrep -af "Soulidity Desktop"
```

无签名环境的本地验收：

```bash
cd desktop/apps/desktop
pnpm package:mac:unsigned
open -n "release/mac-arm64/Soulidity Desktop.app"
pgrep -af "Soulidity Desktop"
```

验收点：实际进程路径必须指向 `desktop/apps/desktop/release/mac-arm64/Soulidity Desktop.app/Contents/MacOS/Soulidity Desktop`。

---

## 影响 / 风险 / 回滚

- **身份边界**：human member 仍保留自己的 wallet binding；pet 作为 `Member(kind='agent')` 拥有独立 wallet binding。
- **Active source 边界**：active source 是 per-pet 状态；`DesktopProfile` 只保留 account-level preferences，不能作为多个 pet 的共享 active source。
- **WalletBinding 不变量**：`@@unique([chain, address])` 不改。重绑通过 revive 同 account agent member 解决，不允许抢占 human 或其他 account 的地址。
- **Secret 边界**：browser 和 renderer 都不接触 `dtk_*` / `sk-*` 明文；只有 web poll response -> Electron main process -> safeStorage 这条路径持有明文。
- **Rotation 边界**：rotation route 不先替换 active `apiKeyHash`；只有 desktop 本地 enc 写入成功并 commit 后才 promote pending hash。server 不保存明文 key，重试靠 deterministic HMAC。
- **Reset 边界**：Reset Pet Identity 必须先撤销 server-side `DesktopPet` / agent member，再清本地；server revoke 失败时不得显示为泄漏已处理。
- **不改领域**：Sui Move 合约、Soul Marketplace 定价、Grant 规则、Telegram bot、Walrus uploader 不改。
- **破坏性变更**：从 `DesktopProfile` 删除 legacy auth columns。migration 有 legacy data guard；若 guard 触发，停止执行并先做显式 backfill plan。
- **回滚点**：实施前打 tag `pre-desktop-pet-binding`。回滚 migration 时恢复 `DesktopProfile` legacy auth + active source columns、删除 `desktop_pets`、删除 `wallet_challenges.purpose`、删除 `Member` rotation fields，代码回到旧 `DesktopProfile` token lookup。

---

## 实施顺序

1. Schema + migration guard + Prisma generate（含 `DesktopPet` active source、`Member` durable rotation fields、WalletChallenge cleanup query）。
2. Challenge purpose / consume helper / `/device/challenge` / `/device/start` 签名校验。
3. `DesktopPet` persistence：complete transaction、poll credential response、auth token lookup（含 60s `lastSeenAt` 节流）。
4. Per-pet active source：`/api/desktop/me`、`/api/desktop/me/active-persona`、`web/lib/desktop/profile.ts` 全部改成按 `desktopPetId` 读写。
5. Desktop main secret stores：agent key signing、agent API key safeStorage、sanitized preload contracts、双写部分失败 retry（A2）、rotate single-flight（A4）。
6. Desktop-authenticated revoke：`/api/desktop/me/revoke` + `agentResetIdentity()` server revoke before local clear（T-A）。
7. `/account/pets` APIs + page + nav entry。
8. Durable rotate routes：`/api/desktop/me/agent-key/rotate` + `.../commit`（A3）。
9. SettingsTab link UX、agent key status、Reset Pet Identity 二级折叠区、floating badge。
10. Targeted tests（含新增 web regression files + desktop 双写/single-flight/sign/reset 测试）。
11. Full typecheck / test / packaged app verification。

## Review 修订闭环

本轮 review 的阻断项已并入本文作为实施前置条件：

- R1 rotation safety：§A / §D / §E 改为 durable pending hash + commit promotion；server 不再依赖进程内明文缓存，desktop 写盘失败不会提前废掉旧 active key。
- R2 reset safety：§D / §E / §G 增加 `/api/desktop/me/revoke`；`agentResetIdentity()` 必须先撤销 server-side pet，再清本地。
- R3 active source ownership：§A / §B / §G 将 active source 下沉到 `DesktopPet`；同一 account 多个 pet 的 source 不互相覆盖。
- R4 desktop test command：§G 改为当前 `desktop/vitest.config.ts` 可识别的 `apps/desktop/src/...` 路径。

执行前自查：

- 本文不得引用外部清单作为交付前提。
- rotation route 不得更新 active `apiKeyHash` 后再等待 desktop 写盘。
- Reset Pet Identity 不得只清本地凭据。
- `DesktopProfile` 不得继续保存 active source。
