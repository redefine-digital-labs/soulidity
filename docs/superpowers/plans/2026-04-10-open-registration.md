# Open Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the invite code system and allow open web registration via Privy, while converting the Telegram Bot `/join` into a group-gate that only issues invite links to users who already have a human Member identity.

**Architecture:** Delete the `InviteCode` model and all invite-code runtime code. Add auto-create logic in `resolvePrivyIdentity()` to create Account + Member on first Privy login (linking pending TG-prebound Members when found). Rewrite `handleJoin` to be a read-only group-gate check. Delete the `processJoinRequest` gateway and all invite-only API routes/tests.

**Tech Stack:** Prisma (PostgreSQL), TypeScript, Vitest, grammy (Telegram bot)

---

### Task 1: Schema — Delete InviteCode model and Member.inviteCode field

**Files:**
- Modify: `prisma/schema.prisma:221-273`

- [ ] **Step 1: Remove InviteCode model and Member.inviteCode from schema**

In `prisma/schema.prisma`, delete the entire `InviteCode` model (lines 265-273) and remove the `inviteCode` field and its index from the `Member` model.

Remove from `Member` model:
```prisma
  inviteCode  String?  @map("invite_code")
```
and:
```prisma
  @@index([inviteCode])
```

Delete entire block:
```prisma
model InviteCode {
  code      String    @id
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  expiresAt DateTime? @map("expires_at") @db.Timestamptz
  usedBy    String?   @map("used_by")
  active    Int       @default(1)

  @@map("invite_codes")
}
```

- [ ] **Step 2: Generate Prisma migration**

Run:
```bash
npx prisma migrate dev --schema=prisma/schema.prisma --name remove_invite_codes
```

Expected: Migration created that drops `invite_codes` table, drops `invite_code` column and index from `members`.

- [ ] **Step 3: Regenerate Prisma client**

Run:
```bash
npx prisma generate --schema=prisma/schema.prisma
```

Expected: Prisma client regenerated without `InviteCode` model or `Member.inviteCode` field.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: remove InviteCode model and Member.inviteCode field"
```

---

### Task 2: Delete invite code utility files

**Files:**
- Delete: `src/shared/invite-code-generator.ts`
- Delete: `src/shared/invite-code-record.ts`
- Delete: `src/shared/invite-code-format.ts`

- [ ] **Step 1: Delete the three invite code utility files**

```bash
rm src/shared/invite-code-generator.ts src/shared/invite-code-record.ts src/shared/invite-code-format.ts
```

- [ ] **Step 2: Verify no remaining runtime imports of deleted files**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

If there are compile errors referencing these deleted files, they will be fixed in subsequent tasks (db/members.ts, handlers.ts, admin route). Just verify the files are gone.

- [ ] **Step 3: Commit**

```bash
git add -u src/shared/invite-code-generator.ts src/shared/invite-code-record.ts src/shared/invite-code-format.ts
git commit -m "chore: delete invite code utility files"
```

---

### Task 3: Clean up db/members.ts — remove invite code helpers

**Files:**
- Modify: `src/db/members.ts`

- [ ] **Step 1: Rewrite db/members.ts**

Remove `createInviteCode`, `validateInviteCode`, `useInviteCode` functions and the `createInviteCodeRecord` import. Remove `inviteCode` parameter from `insertMember`. Keep `insertMember` and `getMembers`.

The file should become:

```typescript
import type { PrismaClient } from './database.js'

export async function insertMember(prisma: PrismaClient, tgId: string, tgName: string | null): Promise<string> {
  const row = await prisma.member.upsert({
    where: { tgId },
    create: { tgId, tgName },
    update: {},
  })
  return row.id
}

export async function getMembers(prisma: PrismaClient): Promise<Array<{ id: string; tg_id: string | null; tg_name: string | null; level: number; joined_at: string }>> {
  const rows = await prisma.member.findMany({ orderBy: { joinedAt: 'desc' } })
  return rows.map((r) => ({
    id: r.id,
    tg_id: r.tgId,
    tg_name: r.tgName,
    level: r.level,
    joined_at: r.joinedAt instanceof Date ? r.joinedAt.toISOString() : r.joinedAt,
  }))
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/members.ts
git commit -m "refactor: remove invite code helpers from db/members"
```

---

### Task 4: Remove invite_code from shared types

**Files:**
- Modify: `src/shared/types.ts:50-61`

- [ ] **Step 1: Remove invite_code from Member interface**

In `src/shared/types.ts`, remove the `invite_code` field from the `Member` interface:

```typescript
// Remove this line:
  invite_code: string | null
```

The `Member` interface should become:

```typescript
export interface Member {
  id: string
  tg_id: string
  tg_name: string | null
  wallet: string | null
  level: number
  avatar: string | null
  bio: string | null
  exp: number
  joined_at: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "refactor: remove invite_code from Member type"
```

---

### Task 5: Delete processJoinRequest gateway

**Files:**
- Delete: `src/bot/gateway.ts`

- [ ] **Step 1: Delete gateway.ts**

```bash
rm src/bot/gateway.ts
```

- [ ] **Step 2: Commit**

```bash
git add -u src/bot/gateway.ts
git commit -m "chore: delete processJoinRequest gateway"
```

---

### Task 6: Rewrite handleJoin as Telegram group gate

**Files:**
- Modify: `src/bot/handlers.ts`

The `/join` command becomes a read-only group-gate check. It does NOT create or upsert Members. It looks up an existing human Member by `tgId` and, if found, creates a Telegram group invite link.

- [ ] **Step 1: Write the failing test for the new handleJoin**

Replace the entire `describe('handleJoin', ...)` block in `tests/bot/handlers.test.ts` with:

```typescript
describe('handleJoin', () => {
  let prisma: ReturnType<typeof createMockPrisma>['prisma']
  let store: ReturnType<typeof createMockPrisma>['store']

  beforeEach(() => {
    const mock = createMockPrisma()
    prisma = mock.prisma
    store = mock.store
  })

  it('ignores non-private chats', async () => {
    const ctx = createMockCtx({ chat: { type: 'group' } })
    await handleJoin(ctx as any, prisma)
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('replies with group invite link for registered user (accountId set)', async () => {
    store.members.push({
      id: 'member-1',
      tgId: '123456789',
      accountId: 'account-1',
      kind: 'human',
      level: 1,
      createdAt: new Date(),
    })

    const ctx = createMockCtx()
    await handleJoin(ctx as any, prisma)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('OpenClaw')
    expect(msg).not.toContain('还没有完成网站注册')
  })

  it('replies with group invite link and website hint for pre-bound user (accountId null)', async () => {
    store.members.push({
      id: 'member-1',
      tgId: '123456789',
      accountId: null,
      kind: 'human',
      level: 1,
      createdAt: new Date(),
    })

    const ctx = createMockCtx()
    await handleJoin(ctx as any, prisma)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('OpenClaw')
    expect(msg).toContain('还没有完成网站注册')
  })

  it('rejects user with no human member', async () => {
    const ctx = createMockCtx()
    await handleJoin(ctx as any, prisma)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('暂时无法领取群邀请链接')
  })

  it('ignores agent members and rejects if no human member exists', async () => {
    store.members.push({
      id: 'agent-1',
      tgId: '123456789',
      accountId: 'account-1',
      kind: 'agent',
      level: 1,
      createdAt: new Date(),
    })

    const ctx = createMockCtx()
    await handleJoin(ctx as any, prisma)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('暂时无法领取群邀请链接')
  })

  it('replies with error when prisma is unavailable', async () => {
    const ctx = createMockCtx()
    await handleJoin(ctx as any, undefined)
    expect(ctx.reply).toHaveBeenCalledWith('系统暂时不可用，请稍后再试')
  })

  it('replies with error when Telegram invite link creation fails', async () => {
    store.members.push({
      id: 'member-1',
      tgId: '123456789',
      accountId: 'account-1',
      kind: 'human',
      level: 1,
      createdAt: new Date(),
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = createMockCtx()
    // Override createChatInviteLink to fail
    ctx.api = { createChatInviteLink: vi.fn().mockRejectedValue(new Error('Bot API error')) }

    await handleJoin(ctx as any, prisma)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('系统暂时不可用')
    consoleError.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test -- tests/bot/handlers.test.ts
```

Expected: FAIL — `handleJoin` still has old invite code logic.

- [ ] **Step 3: Rewrite handleJoin and associated code in handlers.ts**

Replace the entire content of `src/bot/handlers.ts` with:

```typescript
import type { Bot, Context } from 'grammy'
import { insertRawItem } from '../db/database.js'
import type { PrismaClient } from '../db/database.js'
import { getAppBaseUrl } from '../shared/app-config.js'

const TG_GROUP_ID = () => process.env.TG_GROUP_ID ?? ''

export async function handleStart(ctx: Context, prisma?: PrismaClient): Promise<void> {
  if (ctx.chat?.type !== 'private') return

  const payload = (ctx as any).match
  if (payload === 'join') {
    return handleJoin(ctx, prisma)
  }
  await ctx.reply(
    '🦞 欢迎来到 CryptoOpenClaw！\n\n' +
    '可用命令：\n' +
    '/join — 领取群邀请链接\n' +
    '/start — 显示本帮助'
  )
}

export async function handleJoin(ctx: Context, prisma?: PrismaClient): Promise<void> {
  if (ctx.chat?.type !== 'private') return
  const tgId = ctx.from?.id
  if (!tgId) return

  if (!prisma) {
    await ctx.reply('系统暂时不可用，请稍后再试')
    return
  }

  const humanMember = await prisma.member.findFirst({
    where: { tgId: String(tgId), kind: 'human' },
    select: { id: true, accountId: true },
  })

  if (!humanMember) {
    await ctx.reply(
      '暂时无法领取群邀请链接。\n' +
      `请先完成网站注册（${getAppBaseUrl()}），或先完成 TG 预绑定流程后再试。`
    )
    return
  }

  const groupId = TG_GROUP_ID()
  if (!groupId) {
    console.error('[handleJoin] TG_GROUP_ID not configured')
    await ctx.reply('系统暂时不可用，请稍后再试')
    return
  }

  let inviteLink: string
  try {
    const result = await ctx.api.createChatInviteLink(groupId, {
      member_limit: 1,
    })
    inviteLink = result.invite_link
  } catch (error) {
    console.error('[handleJoin] failed to create invite link:', error)
    await ctx.reply('系统暂时不可用，请稍后再试')
    return
  }

  if (humanMember.accountId) {
    await ctx.reply(
      `🦞 欢迎加入 OpenClaw！\n` +
      `点击链接加入 Telegram 群：${inviteLink}`
    )
  } else {
    await ctx.reply(
      `🦞 欢迎加入 OpenClaw！\n` +
      `点击链接加入 Telegram 群：${inviteLink}\n\n` +
      `你还没有完成网站注册，可稍后访问：${getAppBaseUrl()}`
    )
  }
}

export async function handleMark(ctx: Context, prisma: PrismaClient): Promise<void> {
  const chatId = ctx.chat?.id
  const fromId = ctx.from?.id
  if (!chatId || !fromId) return

  const member = await ctx.api.getChatMember(chatId, fromId)
  if (member.status !== 'administrator' && member.status !== 'creator') {
    return
  }

  const replyMsg = (ctx.message as any)?.reply_to_message
  if (!replyMsg?.text) {
    await ctx.reply('请回复一条消息后使用 /mark')
    return
  }

  const text = replyMsg.text as string
  const msgId = replyMsg.message_id

  await insertRawItem(prisma, {
    source_type: 'community',
    source_name: 'tg_group',
    title: text.slice(0, 80),
    url: `tg://msg/${chatId}/${msgId}`,
    title_hash: null,
    content: text,
    language: 'zh',
    score: 5.0,
    raw_data: JSON.stringify({ chat_id: chatId, message_id: msgId, from_id: replyMsg.from?.id }),
  })

  await ctx.reply('✅ 已标记为素材')
}

export function registerHandlers(bot: Bot, prisma: PrismaClient): void {
  bot.command('start', (ctx) => handleStart(ctx, prisma))
  bot.command('join', (ctx) => handleJoin(ctx, prisma))
  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' })
  })
  bot.command('mark', (ctx) => handleMark(ctx, prisma))

  bot.on('chat_member', async (ctx) => {
    const { old_chat_member, new_chat_member } = ctx.chatMember
    const wasOut = old_chat_member.status === 'left' || old_chat_member.status === 'kicked'
    const isIn = new_chat_member.status === 'member' || new_chat_member.status === 'administrator'
    if (wasOut && isIn) {
      const name = new_chat_member.user.first_name
      await ctx.reply(`🦞 欢迎 ${name} 加入 OpenClaw 社群！`)
    }
  })
}
```

- [ ] **Step 4: Update handleJoin tests to work with new ctx.api mock**

The new `handleJoin` calls `ctx.api.createChatInviteLink`. Update `createMockCtx` in the test file to include a default mock:

Add to `createMockCtx` in `tests/bot/handlers.test.ts`:

```typescript
function createMockCtx(overrides: any = {}) {
  return {
    from: { id: 123456789 },
    chat: { type: 'private' },
    reply: vi.fn(),
    api: {
      createChatInviteLink: vi.fn().mockResolvedValue({ invite_link: 'https://t.me/+test123' }),
      ...overrides.api,
    },
    ...overrides,
  }
}
```

Also set `TG_GROUP_ID` in `beforeEach`:

```typescript
beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
  store = mock.store
  process.env.TG_GROUP_ID = '-100123'
})
```

Update the `handleStart` deep-link test to no longer expect `invite_code:` or `join-skill.md`:

```typescript
it('triggers join flow when deep link payload is "join"', async () => {
  const mock = createMockPrisma()
  // Must have a human member for /join to succeed
  mock.store.members.push({
    id: 'member-1',
    tgId: '123456789',
    accountId: 'account-1',
    kind: 'human',
    level: 1,
    createdAt: new Date(),
  })
  process.env.TG_GROUP_ID = '-100123'
  const ctx = createMockCtx({ match: 'join' })
  await handleStart(ctx as any, mock.prisma)
  expect(ctx.reply).toHaveBeenCalledTimes(1)
  const msg = ctx.reply.mock.calls[0][0] as string
  expect(msg).toContain('OpenClaw')
  expect(msg).not.toContain('invite_code')
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
npm test -- tests/bot/handlers.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/bot/handlers.ts tests/bot/handlers.test.ts
git commit -m "feat: rewrite /join as group gate, remove invite code flow"
```

---

### Task 7: Delete admin invite page and API route

**Files:**
- Delete: `web/app/api/admin/invites/route.ts`
- Delete: `web/app/admin/invites/page.tsx`
- Modify: `web/app/admin/layout.tsx:7-15`

- [ ] **Step 1: Delete admin invite files**

```bash
rm web/app/api/admin/invites/route.ts web/app/admin/invites/page.tsx
rmdir web/app/api/admin/invites web/app/admin/invites
```

- [ ] **Step 2: Remove "邀请码" from admin nav**

In `web/app/admin/layout.tsx`, remove this line from the `adminNav` array:

```typescript
  { label: '邀请码', href: '/admin/invites' },
```

- [ ] **Step 3: Commit**

```bash
git add -u web/app/api/admin/invites/route.ts web/app/admin/invites/page.tsx
git add web/app/admin/layout.tsx
git commit -m "chore: delete admin invite page and API route"
```

---

### Task 8: Add auto-create logic to resolvePrivyIdentity

**Files:**
- Modify: `web/lib/auth/identity.ts:318-422`
- Create: `tests/web/identity-auto-create.test.ts`

This is the core change. When `resolvePrivyIdentity()` finds no existing Account (by privyDid, tgId, or email), it now auto-creates Account + Member in a transaction. If a pending human Member (kind='human', tgId matches, accountId=null) exists, it links that Member instead of creating a new one.

- [ ] **Step 1: Write the failing tests**

Create `tests/web/identity-auto-create.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'

const { prisma: mockedPrisma, store } = createMockPrisma()

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

const mockedPrivy = {
  verifyAuthToken: vi.fn(),
  getUser: vi.fn(),
  createWallets: vi.fn(),
}

vi.mock('@web/lib/auth/privy', () => ({
  privy: mockedPrivy,
}))

// Stub wallet sync to avoid side effects
vi.mock('@web/lib/auth/sui-wallet-sync-cache', () => ({
  getSuiWalletSyncCacheEntry: () => ({ lastAttemptAt: Date.now(), inFlight: null }),
  setSuiWalletSyncCacheEntry: () => {},
  SUI_WALLET_SYNC_IN_FLIGHT_TIMEOUT_MS: 5000,
  SUI_WALLET_SYNC_TTL_MS: 60000,
}))

vi.mock('@web/lib/auth/resolve-agent', () => ({
  resolveAgentByApiKey: vi.fn().mockResolvedValue(null),
}))

vi.mock('@web/lib/request-headers', () => ({
  getRequestHeaders: vi.fn().mockResolvedValue({
    get: (name: string) => {
      if (name === 'authorization') return 'Bearer test-token'
      return null
    },
  }),
}))

vi.mock('@web/lib/rate-limit', () => ({
  getRequestIp: vi.fn().mockReturnValue('127.0.0.1'),
  takeRateLimitToken: vi.fn().mockResolvedValue({ limited: false }),
}))

vi.mock('@web/lib/sui-verify', () => ({
  verifyPersonalMessageSignature: vi.fn(),
}))

vi.mock('@web/lib/auth/challenge', () => ({
  buildChallengeMessage: vi.fn(),
  getTrustedAppDomain: vi.fn(),
  normalizeSuiWalletAddress: (a: string | undefined) => a ?? null,
}))

describe('resolvePrivyIdentity auto-create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.accounts.length = 0
    store.members.length = 0

    mockedPrivy.verifyAuthToken.mockResolvedValue({ userId: 'did:privy:new-user' })
    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'new@example.com', firstVerifiedAt: new Date() },
      telegram: undefined,
      linkedAccounts: [],
    })
  })

  it('auto-creates Account + Member for a new Privy user with no prior data', async () => {
    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.js')

    const identity = await resolvePrivyIdentity('test-token')

    expect(identity).not.toBeNull()
    expect(identity!.kind).toBe('human')
    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0].privyDid).toBe('did:privy:new-user')
    expect(store.accounts[0].email).toBe('new@example.com')
    expect(store.members).toHaveLength(1)
    expect(store.members[0].kind).toBe('human')
    expect(store.members[0].accountId).toBe(store.accounts[0].id)
  })

  it('links pending human Member when Privy tgId matches', async () => {
    store.members.push({
      id: 'pending-member',
      tgId: '999888',
      accountId: null,
      kind: 'human',
      level: 1,
      createdAt: new Date(),
    })

    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'tguser@example.com', firstVerifiedAt: new Date() },
      telegram: { telegramUserId: 999888, username: 'tguser' },
      linkedAccounts: [],
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.js')
    const identity = await resolvePrivyIdentity('test-token')

    expect(identity).not.toBeNull()
    expect(identity!.memberId).toBe('pending-member')
    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0].tgId).toBe('999888')
    // The pending member should now be linked
    expect(store.members[0].accountId).toBe(store.accounts[0].id)
  })

  it('does not create a second human member when pending member exists', async () => {
    store.members.push({
      id: 'pending-member',
      tgId: '999888',
      accountId: null,
      kind: 'human',
      level: 1,
      createdAt: new Date(),
    })

    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'tguser@example.com', firstVerifiedAt: new Date() },
      telegram: { telegramUserId: 999888, username: 'tguser' },
      linkedAccounts: [],
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.js')
    await resolvePrivyIdentity('test-token')

    const humanMembers = store.members.filter((m: any) => m.kind === 'human')
    expect(humanMembers).toHaveLength(1)
  })

  it('does not link agent members even if tgId matches', async () => {
    store.members.push({
      id: 'agent-member',
      tgId: '999888',
      accountId: 'some-account',
      kind: 'agent',
      level: 1,
      createdAt: new Date(),
    })

    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'agent@example.com', firstVerifiedAt: new Date() },
      telegram: { telegramUserId: 999888 },
      linkedAccounts: [],
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.js')
    const identity = await resolvePrivyIdentity('test-token')

    expect(identity).not.toBeNull()
    // Should create a NEW human member, not reuse the agent one
    expect(identity!.memberId).not.toBe('agent-member')
    expect(store.accounts.length).toBeGreaterThanOrEqual(1)
    const newHuman = store.members.find((m: any) => m.kind === 'human')
    expect(newHuman).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npm test -- tests/web/identity-auto-create.test.ts
```

Expected: FAIL — `resolvePrivyIdentity` returns `null` for unknown users.

- [ ] **Step 3: Add auto-create logic to resolvePrivyIdentity**

In `web/lib/auth/identity.ts`, replace the final `return null` at the end of `resolvePrivyIdentity()` (line 421) with the auto-create logic.

Replace:
```typescript
  return null
}
```

With:
```typescript
  // --- Auto-create: open registration ---
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Check for pending human member to link (TG pre-bound, accountId null)
      let pendingMember: { id: string } | null = null
      if (tgId) {
        pendingMember = await tx.member.findFirst({
          where: { tgId, kind: 'human', accountId: null },
          select: { id: true },
        })
      }

      const accountData: {
        privyDid: string
        email?: string
        tgId?: string
        tgName?: string
      } = { privyDid: claims.userId }
      if (email) accountData.email = email
      if (tgId) accountData.tgId = tgId
      if (tgName) accountData.tgName = tgName

      const account = await tx.account.create({ data: accountData })

      let memberId: string
      if (pendingMember) {
        await tx.member.update({
          where: { id: pendingMember.id },
          data: { accountId: account.id },
        })
        memberId = pendingMember.id
      } else {
        const newMember = await tx.member.create({
          data: { accountId: account.id, kind: 'human' },
        })
        memberId = newMember.id
      }

      return { accountId: account.id, memberId }
    })

    void ensureSuiWallet(claims.userId, result.memberId, privyUser).catch((error) => {
      console.error('Failed to schedule Privy Sui wallet sync', {
        privyUserId: claims.userId,
        memberId: result.memberId,
        error,
      })
    })

    return {
      accountId: result.accountId,
      memberId: result.memberId,
      kind: 'human',
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      // Race condition: another request created the account concurrently.
      // Retry lookup by privyDid — it should exist now.
      const retryAccount = await findHumanAccount({ privyDid: claims.userId })
      if (retryAccount) {
        return toHumanIdentity(retryAccount)
      }
    }
    console.error('Failed to auto-create account', { privyUserId: claims.userId, error })
    return null
  }
}
```

Note: The `prisma` import for the transaction must use the module-level `prisma` (already imported at line 3). The `tx` parameter inside `$transaction` provides the transactional client.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npm test -- tests/web/identity-auto-create.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/auth/identity.ts tests/web/identity-auto-create.test.ts
git commit -m "feat: auto-create Account+Member on first Privy login (open registration)"
```

---

### Task 9: Clean up mock-prisma and delete obsolete test files

**Files:**
- Modify: `tests/helpers/mock-prisma.ts`
- Delete: `tests/web/join-api.test.ts`
- Delete: `tests/web/join-route.test.ts`
- Delete: `tests/web/register-api.test.ts`
- Delete: `tests/web/verify-route.test.ts`
- Modify: `tests/db/members.test.ts`

- [ ] **Step 1: Remove inviteCodes from mock-prisma**

In `tests/helpers/mock-prisma.ts`:

Remove `inviteCodes: any[]` from the `MockStore` interface.

Remove `inviteCodes: []` from the `store` initialization in `createMockPrisma()`.

Remove `inviteCode: createModel(store.inviteCodes, { active: 1 }),` from the `prisma` object.

- [ ] **Step 2: Delete obsolete test files**

```bash
rm tests/web/join-api.test.ts tests/web/join-route.test.ts tests/web/register-api.test.ts tests/web/verify-route.test.ts
```

These files test:
- `join-api.test.ts`: `processJoinRequest` (deleted in Task 5)
- `join-route.test.ts`: `/api/join` route (doesn't exist)
- `register-api.test.ts`: `/api/register` route with invite code validation (doesn't exist)
- `verify-route.test.ts`: `/api/verify` route with invite code (doesn't exist)

- [ ] **Step 3: Rewrite db/members.test.ts**

Replace the entire file with:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { insertMember, getMembers } from '../../src/db/members.js'

let prisma: ReturnType<typeof createMockPrisma>['prisma']

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
})

describe('members', () => {
  it('inserts and retrieves members', async () => {
    await insertMember(prisma, 'tg_123', 'TestUser')
    const members = await getMembers(prisma)
    expect(members).toHaveLength(1)
    expect(members[0].tg_id).toBe('tg_123')
  })
})
```

- [ ] **Step 4: Run all tests**

Run:
```bash
npm test
```

Expected: All tests PASS. No references to deleted files or invite code logic.

- [ ] **Step 5: Commit**

```bash
git add -u tests/web/join-api.test.ts tests/web/join-route.test.ts tests/web/register-api.test.ts tests/web/verify-route.test.ts
git add tests/helpers/mock-prisma.ts tests/db/members.test.ts
git commit -m "test: clean up invite code tests, update mocks"
```

---

### Task 10: Final verification

- [ ] **Step 1: Check for any remaining invite code references in runtime code**

Run:
```bash
grep -r "inviteCode\|invite_code\|InviteCode\|invite-code" --include="*.ts" --include="*.tsx" src/ web/ new-web/ 2>/dev/null | grep -v node_modules | grep -v ".test." || echo "Clean"
```

Expected: "Clean" or only references in docs/comments that don't affect runtime.

- [ ] **Step 2: TypeScript compile check**

Run:
```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run:
```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 4: Verify Prisma client is consistent**

Run:
```bash
npx prisma generate --schema=prisma/schema.prisma
```

Expected: Success, no warnings about InviteCode.
