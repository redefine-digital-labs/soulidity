# Interactive Feedback (TG Bot Gateway + /mark) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add TG Bot as community gateway (/join via OpenClaw skill + invite code) and /mark command for content feedback from group discussions.

**Architecture:** Bot moves from ephemeral usage to long-running polling mode in main.ts. New /join command returns a prompt for OpenClaw to execute; OpenClaw calls POST /api/join which validates invite code, creates member, and returns a one-time group invite link. /mark command lets admins tag group messages as raw_items for the content pipeline.

**Tech Stack:** grammy (existing), Prisma (existing), Next.js API routes (existing)

---

### Task 1: Bot gateway module — handleJoin

**Files:**
- Create: `src/bot/handlers.ts`
- Test: `tests/bot/handlers.test.ts`

**Step 1: Write the failing test**

Create `tests/bot/handlers.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleJoin } from '../../src/bot/handlers.js'

function createMockCtx(overrides: any = {}) {
  return {
    from: { id: 123456789 },
    chat: { type: 'private' },
    reply: vi.fn(),
    ...overrides,
  }
}

describe('handleJoin', () => {
  it('replies with prompt containing tg_id in private chat', async () => {
    const ctx = createMockCtx()
    await handleJoin(ctx as any)
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('123456789')
    expect(msg).toContain('join-skill.md')
  })

  it('ignores non-private chats', async () => {
    const ctx = createMockCtx({ chat: { type: 'group' } })
    await handleJoin(ctx as any)
    expect(ctx.reply).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/handlers.test.ts`
Expected: FAIL — cannot resolve `../../src/bot/handlers.js`

**Step 3: Write minimal implementation**

Create `src/bot/handlers.ts`:

```typescript
import type { Context } from 'grammy'
import type { PrismaClient } from '../db/database.js'

const SKILL_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/data/join-skill.md'

function buildJoinPrompt(tgId: number): string {
  return [
    '🦞 欢迎加入 OpenClaw 社群！',
    '',
    '请将以下内容复制发送给你的 OpenClaw Agent：',
    '',
    '---',
    '请执行以下 skill 帮我加入 OpenClaw 社群：',
    SKILL_URL,
    '',
    '我的验证信息：',
    `- tg_id: ${tgId}`,
    '- 请向我索要邀请码',
    '---',
  ].join('\n')
}

export async function handleJoin(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== 'private') return
  const tgId = ctx.from?.id
  if (!tgId) return
  await ctx.reply(buildJoinPrompt(tgId))
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/handlers.ts tests/bot/handlers.test.ts
git commit -m "feat: add /join command handler for bot gateway"
```

---

### Task 2: Bot gateway module — handleMark

**Files:**
- Modify: `src/bot/handlers.ts`
- Modify: `tests/bot/handlers.test.ts`

**Step 1: Write the failing test**

Append to `tests/bot/handlers.test.ts`:

```typescript
import { handleMark } from '../../src/bot/handlers.js'
import { createMockPrisma } from '../helpers/mock-prisma.js'

describe('handleMark', () => {
  let prisma: ReturnType<typeof createMockPrisma>['prisma']
  let store: ReturnType<typeof createMockPrisma>['store']

  beforeEach(() => {
    const mock = createMockPrisma()
    prisma = mock.prisma
    store = mock.store
  })

  it('saves replied message as raw_item when admin uses /mark', async () => {
    const ctx = createMockCtx({
      chat: { id: -100123, type: 'group' },
      from: { id: 111 },
      message: {
        reply_to_message: {
          text: 'This is a great discussion about AI agents',
          message_id: 42,
          from: { id: 222 },
        },
      },
    })
    // Mock getChatMember to return admin
    const getChatMember = vi.fn().mockResolvedValue({ status: 'administrator' })
    ctx.api = { getChatMember } as any

    await handleMark(ctx as any, prisma)

    expect(store.rawItems).toHaveLength(1)
    expect(store.rawItems[0].sourceType).toBe('community')
    expect(store.rawItems[0].sourceName).toBe('tg_group')
    expect(store.rawItems[0].content).toBe('This is a great discussion about AI agents')
    expect(ctx.reply).toHaveBeenCalledWith('✅ 已标记为素材')
  })

  it('ignores when not a reply', async () => {
    const ctx = createMockCtx({
      chat: { id: -100123, type: 'group' },
      from: { id: 111 },
      message: {},
    })
    await handleMark(ctx as any, prisma)
    expect(store.rawItems).toHaveLength(0)
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('回复'))
  })

  it('rejects non-admin users', async () => {
    const ctx = createMockCtx({
      chat: { id: -100123, type: 'group' },
      from: { id: 111 },
      message: {
        reply_to_message: { text: 'Some text', message_id: 42 },
      },
    })
    const getChatMember = vi.fn().mockResolvedValue({ status: 'member' })
    ctx.api = { getChatMember } as any

    await handleMark(ctx as any, prisma)
    expect(store.rawItems).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/handlers.test.ts`
Expected: FAIL — `handleMark` not exported

**Step 3: Write minimal implementation**

Add to `src/bot/handlers.ts`:

```typescript
import { insertRawItem } from '../db/database.js'

export async function handleMark(ctx: Context, prisma: PrismaClient): Promise<void> {
  const chatId = ctx.chat?.id
  const fromId = ctx.from?.id
  if (!chatId || !fromId) return

  const replyMsg = (ctx.message as any)?.reply_to_message
  if (!replyMsg?.text) {
    await ctx.reply('请回复一条消息后使用 /mark')
    return
  }

  // Check admin status
  const member = await ctx.api.getChatMember(chatId, fromId)
  if (member.status !== 'administrator' && member.status !== 'creator') {
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
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/handlers.ts tests/bot/handlers.test.ts
git commit -m "feat: add /mark command to save group messages as raw_items"
```

---

### Task 3: Bot registration + handleStart

**Files:**
- Modify: `src/bot/handlers.ts`
- Modify: `tests/bot/handlers.test.ts`

**Step 1: Write the failing test**

Append to `tests/bot/handlers.test.ts`:

```typescript
import { handleStart, registerHandlers } from '../../src/bot/handlers.js'

describe('handleStart', () => {
  it('replies with welcome message in private chat', async () => {
    const ctx = createMockCtx()
    await handleStart(ctx as any)
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('OpenClaw')
    expect(msg).toContain('/join')
  })
})

describe('registerHandlers', () => {
  it('registers all commands on the bot', () => {
    const bot = { command: vi.fn() }
    const mock = createMockPrisma()
    registerHandlers(bot as any, mock.prisma)
    expect(bot.command).toHaveBeenCalledWith('start', expect.any(Function))
    expect(bot.command).toHaveBeenCalledWith('join', expect.any(Function))
    expect(bot.command).toHaveBeenCalledWith('mark', expect.any(Function))
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/handlers.test.ts`
Expected: FAIL — `handleStart` and `registerHandlers` not exported

**Step 3: Write minimal implementation**

Add to `src/bot/handlers.ts`:

```typescript
import type { Bot } from 'grammy'

export async function handleStart(ctx: Context): Promise<void> {
  if (ctx.chat?.type !== 'private') return
  await ctx.reply(
    '🦞 欢迎来到 CryptoOpenClaw！\n\n' +
    '可用命令：\n' +
    '/join — 验证身份加入社群\n' +
    '/start — 显示本帮助'
  )
}

export function registerHandlers(bot: Bot, prisma: PrismaClient): void {
  bot.command('start', handleStart)
  bot.command('join', handleJoin)
  bot.command('mark', (ctx) => handleMark(ctx, prisma))
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/handlers.ts tests/bot/handlers.test.ts
git commit -m "feat: add /start command and registerHandlers for bot"
```

---

### Task 4: POST /api/join endpoint

**Files:**
- Create: `web/app/api/join/route.ts`
- Create: `tests/web/join-api.test.ts`

**Step 1: Write the failing test**

Create `tests/web/join-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'

// We test the core logic function, not the Next.js route handler directly
import { processJoinRequest } from '../../src/bot/gateway.js'

describe('processJoinRequest', () => {
  let prisma: ReturnType<typeof createMockPrisma>['prisma']
  let store: ReturnType<typeof createMockPrisma>['store']

  beforeEach(() => {
    const mock = createMockPrisma()
    prisma = mock.prisma
    store = mock.store
  })

  it('returns error when invite code is invalid', async () => {
    const result = await processJoinRequest(prisma, {
      tg_id: '123',
      invite_code: 'BADCODE',
      createInviteLink: vi.fn(),
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid')
  })

  it('consumes invite code and creates member on valid code', async () => {
    store.inviteCodes.push({ code: 'GOOD1234', active: 1, usedBy: null, createdAt: new Date() })

    const createInviteLink = vi.fn().mockResolvedValue('https://t.me/+abc123')
    const result = await processJoinRequest(prisma, {
      tg_id: '123456',
      invite_code: 'GOOD1234',
      createInviteLink,
    })

    expect(result.success).toBe(true)
    expect(result.invite_link).toBe('https://t.me/+abc123')
    expect(store.inviteCodes[0].active).toBe(0)
    expect(store.inviteCodes[0].usedBy).toBe('123456')
    expect(store.members).toHaveLength(1)
    expect(store.members[0].tgId).toBe('123456')
    expect(createInviteLink).toHaveBeenCalled()
  })

  it('rejects already-used invite code', async () => {
    store.inviteCodes.push({ code: 'USED1234', active: 0, usedBy: 'other', createdAt: new Date() })

    const result = await processJoinRequest(prisma, {
      tg_id: '123',
      invite_code: 'USED1234',
      createInviteLink: vi.fn(),
    })
    expect(result.success).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/join-api.test.ts`
Expected: FAIL — cannot resolve `../../src/bot/gateway.js`

**Step 3: Write minimal implementation**

Create `src/bot/gateway.ts`:

```typescript
import type { PrismaClient } from '../db/database.js'

interface JoinRequest {
  tg_id: string
  invite_code: string
  createInviteLink: () => Promise<string>
}

interface JoinResult {
  success: boolean
  invite_link?: string
  error?: string
}

export async function processJoinRequest(
  prisma: PrismaClient,
  req: JoinRequest,
): Promise<JoinResult> {
  const invite = await prisma.inviteCode.findFirst({
    where: { code: req.invite_code, active: 1, usedBy: null },
  })

  if (!invite) {
    return { success: false, error: 'Invalid or used invite code' }
  }

  await prisma.inviteCode.update({
    where: { code: req.invite_code },
    data: { usedBy: req.tg_id, active: 0 },
  })

  await prisma.member.upsert({
    where: { tgId: req.tg_id },
    create: { tgId: req.tg_id, inviteCode: req.invite_code },
    update: {},
  })

  const invite_link = await req.createInviteLink()

  return { success: true, invite_link }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/web/join-api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/gateway.ts tests/web/join-api.test.ts
git commit -m "feat: add processJoinRequest gateway logic"
```

---

### Task 5: Next.js /api/join route

**Files:**
- Create: `web/app/api/join/route.ts`

**Step 1: Write the route handler**

Create `web/app/api/join/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { Bot } from 'grammy'
import { processJoinRequest } from '../../../src/bot/gateway.js'

export async function POST(request: NextRequest) {
  const { tg_id, invite_code } = await request.json()

  if (!tg_id || !invite_code) {
    return NextResponse.json({ success: false, error: 'tg_id and invite_code required' }, { status: 400 })
  }

  const token = process.env.TG_BOT_TOKEN
  const groupId = process.env.TG_GROUP_ID
  if (!token || !groupId) {
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 })
  }

  const bot = new Bot(token)

  const result = await processJoinRequest(prisma, {
    tg_id,
    invite_code,
    createInviteLink: async () => {
      const link = await bot.api.createChatInviteLink(groupId, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 600,
      })
      return link.invite_link
    },
  })

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error })
  }

  return NextResponse.json({ success: true, invite_link: result.invite_link })
}
```

**Step 2: Verify import path works**

The route imports from `../../../src/bot/gateway.js`. Check that `web/next.config.ts` or `web/tsconfig.json` allows this. If not, the shared logic in `src/bot/gateway.ts` may need a re-export or the import path adjusted.

Run: `cd web && npx next build` (or just type-check: `npx tsc --noEmit`)

**Step 3: Commit**

```bash
git add web/app/api/join/route.ts
git commit -m "feat: add POST /api/join route for OpenClaw skill verification"
```

---

### Task 6: Refactor autoPublish to accept Bot instance

**Files:**
- Modify: `src/publisher/publish.ts`
- Modify: `tests/publisher/publish.test.ts` (if exists, otherwise skip test)

The current `autoPublish` creates `new Bot(token)` on every call. Refactor to optionally accept a Bot instance so main.ts can share one.

**Step 1: Modify autoPublish signature**

Edit `src/publisher/publish.ts` — add optional `bot` parameter:

```typescript
import { Bot } from 'grammy'
import type { PrismaClient } from '../db/database.js'
import { formatArticle } from './formatter.js'

export async function autoPublish(
  prisma: PrismaClient,
  opts: { maxAgeMs?: number; bot?: Bot } = {}
): Promise<{ published: number; failed: number }> {
  const maxAge = opts.maxAgeMs ?? 10 * 60 * 1000
  const cutoff = new Date(Date.now() - maxAge)

  const token = process.env.TG_BOT_TOKEN
  const channelId = process.env.TG_CHANNEL_ID
  if (!channelId || (!token && !opts.bot)) {
    console.error('TG_BOT_TOKEN or TG_CHANNEL_ID not configured, skipping auto-publish')
    return { published: 0, failed: 0 }
  }

  const articles = await prisma.article.findMany({
    where: { status: 'draft', createdAt: { lte: cutoff } },
    include: {
      rawItem: { select: { url: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (articles.length === 0) return { published: 0, failed: 0 }

  const bot = opts.bot ?? new Bot(token!)
  let published = 0
  let failed = 0

  for (const article of articles) {
    try {
      const text = formatArticle({
        title_zh: article.titleZh,
        summary_zh: article.summaryZh,
        analysis_zh: article.analysisZh ?? null,
        source_url: article.rawItem?.url ?? '',
      })

      const sent = await bot.api.sendMessage(channelId, text, { parse_mode: 'HTML' })
      const messageId = String(sent.message_id)

      await prisma.article.update({ where: { id: article.id }, data: { status: 'published' } })
      await prisma.publication.create({
        data: { articleId: article.id, channel: 'tg_daily', messageId, publishedAt: new Date() },
      })
      published++
    } catch (err) {
      console.error(`Failed to auto-publish article ${article.id}:`, err instanceof Error ? err.message : err)
      failed++
    }
  }

  return { published, failed }
}
```

**Step 2: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests still PASS

**Step 3: Commit**

```bash
git add src/publisher/publish.ts
git commit -m "refactor: autoPublish accepts optional bot instance"
```

---

### Task 7: Integrate Bot into main.ts

**Files:**
- Modify: `src/main.ts`
- Modify: `src/scheduler.ts`

**Step 1: Update main.ts to start bot in long-polling mode**

Edit `src/main.ts`:

```typescript
import 'dotenv/config'
import { Bot } from 'grammy'
import { createPrisma } from './db/database.js'
import { createZaiAdapter } from './producer/llm.js'
import { seedAgentRoles } from './db/agent-roles.js'
import { startScheduler } from './scheduler.js'
import { registerHandlers } from './bot/handlers.js'

const apiKey = process.env.ZAI_API_KEY
if (!apiKey) {
  console.error('ZAI_API_KEY is required. Set it in .env')
  process.exit(1)
}

const prisma = createPrisma()
const llm = createZaiAdapter(apiKey)

console.log('CryptoOpenClaw engine starting...')
await seedAgentRoles(prisma)
console.log('Agent roles seeded.')
console.log(`Database: ${process.env.DATABASE_URL?.replace(/\/\/.*@/, '//***@')}`)

// Start Bot in long-polling mode
const botToken = process.env.TG_BOT_TOKEN
let bot: Bot | undefined
if (botToken) {
  bot = new Bot(botToken)
  registerHandlers(bot, prisma)
  bot.start()
  console.log('Bot started in long-polling mode.')
} else {
  console.warn('TG_BOT_TOKEN not set, bot disabled.')
}

startScheduler(prisma, llm, bot)

// Keep process alive
process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  bot?.stop()
  await prisma.$disconnect()
  process.exit(0)
})
```

**Step 2: Update scheduler.ts to pass bot to autoPublish**

Edit `src/scheduler.ts` — change signature to accept optional bot:

```typescript
import cron from 'node-cron'
import type { Bot } from 'grammy'
import type { PrismaClient } from './db/database.js'
import { expireOldRawItems } from './db/database.js'
import { runCollectors } from './collector/run.js'
import { collectRss } from './collector/rss.js'
import { collectGithub } from './collector/github.js'
import { collectX } from './collector/x.js'
import { runDedup } from './producer/dedup.js'
import { produceArticles } from './producer/produce.js'
import { autoPublish } from './publisher/publish.js'
import type { LLMAdapter } from './producer/llm.js'

export function startScheduler(prisma: PrismaClient, llm: LLMAdapter, bot?: Bot) {
  // ... existing cron jobs unchanged, except autoPublish calls pass bot:
  // autoPublish(prisma) → autoPublish(prisma, { bot })
}
```

Replace all `autoPublish(prisma)` calls with `autoPublish(prisma, { bot })`.

**Step 3: Run existing tests**

Run: `npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/main.ts src/scheduler.ts
git commit -m "feat: integrate bot long-polling into main.ts and scheduler"
```

---

### Task 8: Create join-skill.md

**Files:**
- Create: `data/join-skill.md`

**Step 1: Write the skill file**

Create `data/join-skill.md`:

```markdown
# OpenClaw 社群加入验证

## 目标

帮助用户通过邀请码验证加入 OpenClaw TG 社群。

## 步骤

1. 向用户索要邀请码。如果用户消息中已经包含了邀请码，直接使用。
2. 从用户消息中提取 `tg_id`（格式为数字）。
3. 调用以下 API：

```
POST https://clawnews-mu.vercel.app/api/join
Content-Type: application/json

{
  "tg_id": "<用户提供的 tg_id>",
  "invite_code": "<用户提供的邀请码>"
}
```

4. 根据返回结果：
   - 成功：将 `invite_link` 展示给用户，告知点击链接即可加入社群（链接 10 分钟内有效）
   - 失败：展示错误信息，提示用户检查邀请码是否正确

## 注意

- 邀请码为 8 位大写字母数字组合
- 每个邀请码只能使用一次
- 生成的邀请链接仅限 1 人使用，10 分钟后过期
```

**Step 2: Update SKILL_URL in handlers.ts**

The actual URL depends on where this file will be hosted. For now, keep a placeholder that can be updated once the repo is public or file is hosted.

**Step 3: Commit**

```bash
git add data/join-skill.md
git commit -m "feat: add join-skill.md for OpenClaw verification"
```

---

### Task 9: Run full test suite and verify

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Manual smoke test checklist**

- [ ] `TG_GROUP_ID` added to `.env`
- [ ] Bot starts with `npm run dev`
- [ ] `/start` in private chat returns help
- [ ] `/join` in private chat returns prompt with correct tg_id
- [ ] `/mark` replying to a group message saves to raw_items
- [ ] POST /api/join with valid invite code returns invite_link

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues from smoke testing"
```
