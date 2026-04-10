# Open Registration And Telegram Group Gate Design

移除邀请码体系，但不要再把“网站人类注册 / agent 注册 / Telegram 群准入”混成一条链路。

本次设计只做两件事：

1. 网站侧改为开放注册：用户通过 Privy 邮箱登录即可自动创建网站人类身份。
2. Telegram Bot `/join` 改为群准入校验：只给已经具备人类身份或已完成 TG 预绑定的人发群邀请链接。

Agent 注册体系保持现状，不在本次改动范围内。

## 背景与目标

当前邀请码方案把以下三件事绑在了一起：

- 网站账号注册
- Telegram 群资格发放
- Bot/Agent 注册

这导致身份语义混乱，也让邀请码成为不必要的耦合点。

本次要把语义拆开：

- 网站注册：对应人类用户，产物是 `Account + human Member`
- Agent 注册：对应 bot/agent 身份，仍然走现有 `Member(kind='agent')` 体系
- Telegram 群准入：对应用户是否有资格拿群邀请链接，不负责创建新的人类身份

## 范围

- 删除邀请码系统：模型、生成器、校验逻辑、管理页、管理 API、相关测试与类型残留
- 在 `resolvePrivyIdentity()` 中补上开放注册和“预绑定 TG 用户自动挂接”逻辑
- 重写 Telegram Bot `/join`：不再发邀请码，不再创建 pending invite，不再要求 skill 粘贴验证
- 保持 agent 身份与 agent API key 体系不变
- 清理所有运行时代码中的 invite code 引用

## 非目标

- 不重做 agent 注册流程
- 不引入新的 bot 平台账号模型
- 不设计新的 Telegram 预绑定产品流程

本次直接复用现有语义：

- `Member(kind='human', accountId != null)`：已注册网站的人类用户
- `Member(kind='human', accountId == null, tgId != null)`：已完成 TG 预绑定、但尚未注册网站的人类用户
- `Member(kind='agent')`：agent 身份，完全不参与 `/join` 群准入判断

## 身份模型

### 网站人类身份

- 创建方式：Privy 邮箱登录
- 数据形态：`Account + Member(kind='human')`
- 这是网站登录、个人资料、后续钱包绑定的主体身份

### Agent 身份

- 数据形态：`Member(kind='agent')`
- 一个用户可以在同一 `Account` 下拥有多个 agent
- 本次不修改其创建、认证或归属逻辑

### Telegram 群准入身份

Telegram `/join` 只看“当前 `tgId` 是否已经绑定到一个人类身份”。

合格条件：

- 存在 `human Member`，且 `tgId = 当前 Telegram 用户`
- 该 `human Member` 可以是：
  - `accountId != null`：说明该用户已经注册网站
  - `accountId == null`：说明该用户尚未注册网站，但已经完成 TG 预绑定

不合格条件：

- 查不到任何 `human Member(tgId = 当前 tgId)`
- 只查到 agent 身份，不算合格

`/join` 本身不再创建或 upsert 人类 `Member`。

## Schema Changes

### Delete

- 删除 `InviteCode` model，对应删除 `invite_codes` 表

### Modify

- `Member`:
  - 删除 `inviteCode` 字段
  - 删除 `@@index([inviteCode])`
- `Account`:
  - 无 schema 变更
- `Member.kind`:
  - 无 schema 变更

Migration 结果应包含：

- `DROP TABLE invite_codes`
- `ALTER TABLE members DROP COLUMN invite_code`
- 删除 `members(invite_code)` 相关索引

## Web Registration

**文件**：`web/lib/auth/identity.ts` 的 `resolvePrivyIdentity()`

### 当前问题

当前逻辑在以下情况下会返回 `null`：

- 找不到已有 `Account(privyDid)`
- 也找不到可复用的旧 `Account(tgId/email)`

这会把“新网站用户注册”和“TG 预绑定用户首次注册网站”都挡在外面。

### 新行为

当找不到可用 `Account` 时，不再直接返回 `null`，而是进入自动创建/挂接逻辑。

### 目标流程

```text
Privy token verified
  -> lookup Account by privyDid
  -> found -> return existing human identity

  -> load privy user
  -> collect tgId / email / tgName
  -> lookup Account by tgId -> email
  -> found -> 继续沿用现有 legacy linking 逻辑

  -> still not found -> auto-create transaction:
       1. if tgId exists:
            find pending human Member where:
              kind = 'human'
              tgId = current tgId
              accountId is null
       2. create Account {
            privyDid,
            email,
            tgId,
            tgName
          }
       3. if pending human Member exists:
            update Member.accountId = account.id
            reuse this member as the website human member
          else:
            create Member {
              accountId: account.id,
              kind: 'human'
            }
       4. ensureSuiWallet(...)
       5. return Identity { accountId, memberId, kind: 'human' }
```

### 关键约束

- 如果已存在 `pending human Member(tgId, accountId=null)`，网站注册必须挂接这个 member，不能再创建第二个 `human Member`
- `resolvePrivyIdentity()` 的自动创建路径只处理 `kind='human'`
- 不得复用或误连 `kind='agent'` 的 member

### Edge Cases

- `privyDid / tgId / email` 任一唯一键冲突时，不能只依赖事务“自然成功”
- create-path 需要显式处理唯一键竞争：
  - 捕获唯一键冲突
  - 重新按 `privyDid -> tgId -> email` 查找
  - 查到后直接返回已有 identity
- 如果 `tgId` 对应的是一个已经挂到账户的人类 member，应优先走已有账户匹配，不进入新建路径
- 如果 Privy 没有 Telegram 信息，则正常创建网站账号，但该账号不具备 `/join` 的 TG 准入资格，直到后续完成 TG 绑定

## Telegram Group Gate

**文件**：`src/bot/handlers.ts` 的 `handleJoin`

### 新职责

`/join` 是“发群邀请链接”的入口，不是“创建网站身份”的入口。

它只做三件事：

1. 根据当前 Telegram 用户查找是否存在匹配的 `human Member`
2. 判断该用户是否有资格进入群
3. 创建 Telegram 群邀请链接并回复

### 新流程

```text
/join command received
  -> find first human Member by tgId
  -> not found
       -> reply: 请先完成网站注册或 TG 预绑定，再领取群邀请
  -> found with accountId != null
       -> eligible (已注册网站)
  -> found with accountId == null
       -> eligible (已完成 TG 预绑定，但未注册网站)
  -> create Telegram group invite link
  -> reply with invite link
       -> if accountId == null, 可额外附上网站地址，提示稍后可完成网站注册
```

### 明确禁止

- 不生成 invite code
- 不校验 invite code
- 不消费 invite code
- 不创建新的 human `Member`
- 不把 `/join` 当成 bot/agent 注册入口
- 不要求用户再去复制 skill 给 Agent 做中转验证

### Reply 文案

#### 已有网站账号

```text
欢迎加入 OpenClaw！
点击链接加入 Telegram 群：{群邀请链接}
```

#### 已 TG 预绑定但未注册网站

```text
欢迎加入 OpenClaw！
点击链接加入 Telegram 群：{群邀请链接}

你还没有完成网站注册，可稍后访问：{网站地址}
```

#### 未通过准入校验

```text
暂时无法领取群邀请链接。
请先完成网站注册，或先完成 TG 预绑定流程后再试。
```

## `processJoinRequest`

**文件**：`src/bot/gateway.ts`

整文件删除。

原因：

- 其职责完全围绕 invite code 校验与消费
- 新流程不再需要 Agent 中转 join 请求
- 群邀请链接由 bot 在 `handleJoin` 内直接发放即可

如果仓库里还存在历史 `/api/join` route 或只为 invite 逻辑存在的测试，也一并删除。

## Cleanup

### Delete Files

| File | Reason |
|------|--------|
| `src/shared/invite-code-generator.ts` | 邀请码生成 |
| `src/shared/invite-code-record.ts` | 邀请码写库 |
| `src/shared/invite-code-format.ts` | 邀请码格式校验 |
| `src/bot/gateway.ts` | 仅服务于 invite code join 流程 |
| `web/app/api/admin/invites/route.ts` | 管理端邀请码 API |
| `web/app/admin/invites/page.tsx` | 管理端邀请码页面 |

### Modify Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | 删除 `InviteCode` model；删除 `Member.inviteCode` 字段与索引 |
| `web/lib/auth/identity.ts` | 增加 human auto-create；支持把 `pending human Member(tgId, accountId=null)` 挂接到新 `Account` |
| `src/bot/handlers.ts` | `/join` 改为 TG 群准入校验与直接发邀请；不再创建/更新 pending invite member |
| `src/db/members.ts` | 删除 invite code 相关 helper；`insertMember` 去掉 `inviteCode` 参数 |
| `src/shared/types.ts` | 删除 `Member.invite_code` 类型字段 |
| `web/app/admin/layout.tsx` | 删除“邀请码”导航 |

### Tests

| File | Action |
|------|--------|
| `tests/web/join-api.test.ts` | 删除，旧测试只覆盖 invite code gateway |
| `tests/web/join-route.test.ts` | 删除或重写；若 `/api/join` 被删除，则直接删除 |
| `tests/web/register-api.test.ts` | 删除或重写 invite code 注册断言；新测试改覆盖 `resolvePrivyIdentity()` 自动创建/挂接逻辑 |
| `tests/web/verify-route.test.ts` | 删除；旧 route 只服务 invite code 校验 |
| `tests/db/members.test.ts` | 删除 invite code helper 相关用例；保留与 `getMembers`/`insertMember` 相关的非 invite 测试 |
| `tests/bot/handlers.test.ts` | 改为测试 `/join` 的准入判断：已注册网站、已 TG 预绑定、未绑定三种路径 |
| `tests/helpers/mock-prisma.ts` | 删除 `inviteCode` / `inviteCodes` mock 结构 |
| `tests/web/identity.test.ts` | 新增两个关键用例：开放注册自动创建；命中 `pending human Member` 时挂接而非新建 |

### Not Touched

- `docs/plans/` 与 `docs/legacy/` 作为历史文档保留
- 历史 migration SQL 不回改
- agent API key、agent 身份解析、agent purchase/access 等现有 agent 运行时逻辑不动

## Anti-Spam

本次不新增新的反垃圾策略。

准入门槛改为“必须已有合法的人类 TG 绑定”，已经比纯开放发链接更收敛。后续若需要，可单独补：

- `/join` 限频
- 单用户邀请链接冷却时间
- 群链接一次性/短 TTL 策略

## Acceptance Criteria

1. 新用户可直接通过 Privy 邮箱登录完成网站注册，不再需要邀请码。
2. 若当前 Privy 用户的 `tgId` 已对应一个 `pending human Member(accountId=null)`，注册时必须挂接该 member，而不是新建第二个 `human Member`。
3. `InviteCode` 表被删除，`Member.inviteCode` 字段被删除。
4. 运行时代码中不再存在 invite code 生成、校验、消费逻辑。
5. `/join` 不再创建任何人类 member，也不再要求 Agent 中转验证。
6. `/join` 只对已存在 `human Member(tgId=当前用户)` 的用户发放群邀请链接。
7. `/join` 同时支持两类合格用户：
   - 已注册网站的人类用户
   - 已 TG 预绑定但尚未注册网站的人类用户
8. 未绑定的 Telegram 用户调用 `/join` 时，返回明确的下一步提示，不发放群邀请链接。
9. `Member(kind='agent')` 相关注册、认证、归属逻辑不受本次改动影响。
10. 相关测试完成清理与更新，并覆盖开放注册、pending member 挂接、TG 群准入三条主路径。
