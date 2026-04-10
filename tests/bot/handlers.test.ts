import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleJoin, handleMark, handleStart, registerHandlers } from '../../src/bot/handlers.js'
import { createMockPrisma } from '../helpers/mock-prisma.js'

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

describe('handleJoin', () => {
  let prisma: ReturnType<typeof createMockPrisma>['prisma']
  let store: ReturnType<typeof createMockPrisma>['store']
  const originalGroupId = process.env.TG_GROUP_ID

  beforeEach(() => {
    const mock = createMockPrisma()
    prisma = mock.prisma
    store = mock.store
    process.env.TG_GROUP_ID = '-100123'
  })

  afterEach(() => {
    if (originalGroupId === undefined) {
      delete process.env.TG_GROUP_ID
    } else {
      process.env.TG_GROUP_ID = originalGroupId
    }
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
    const ctx = createMockCtx({
      api: { createChatInviteLink: vi.fn().mockRejectedValue(new Error('Bot API error')) },
    })

    await handleJoin(ctx as any, prisma)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('系统暂时不可用')
    consoleError.mockRestore()
  })
})

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
    const getChatMember = vi.fn().mockResolvedValue({ status: 'administrator' })
    ctx.api = { getChatMember } as any

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
    expect(ctx.reply).not.toHaveBeenCalled()
  })
})

describe('handleStart', () => {
  it('replies with welcome message in private chat', async () => {
    const ctx = createMockCtx()
    await handleStart(ctx as any)
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('OpenClaw')
    expect(msg).toContain('/join')
  })

  it('triggers join flow when deep link payload is "join"', async () => {
    const mock = createMockPrisma()
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
})

describe('registerHandlers', () => {
  it('registers all commands and event handlers on the bot', () => {
    const bot = { command: vi.fn(), on: vi.fn() }
    const mock = createMockPrisma()
    registerHandlers(bot as any, mock.prisma)
    expect(bot.command).toHaveBeenCalledWith('start', expect.any(Function))
    expect(bot.command).toHaveBeenCalledWith('join', expect.any(Function))
    expect(bot.command).toHaveBeenCalledWith('mark', expect.any(Function))
    expect(bot.on).toHaveBeenCalledWith('chat_member', expect.any(Function))
  })

  it('welcome handler replies when new member joins', async () => {
    const bot = { command: vi.fn(), on: vi.fn() }
    const mock = createMockPrisma()
    registerHandlers(bot as any, mock.prisma)

    const chatMemberHandler = bot.on.mock.calls.find((c: any) => c[0] === 'chat_member')![1]
    const ctx = {
      chatMember: {
        old_chat_member: { status: 'left' },
        new_chat_member: { status: 'member', user: { first_name: 'Alice' } },
      },
      reply: vi.fn(),
    }
    await chatMemberHandler(ctx)
    expect(ctx.reply).toHaveBeenCalledWith('🦞 欢迎 Alice 加入 OpenClaw 社群！')
  })

  it('welcome handler ignores non-join events', async () => {
    const bot = { command: vi.fn(), on: vi.fn() }
    const mock = createMockPrisma()
    registerHandlers(bot as any, mock.prisma)

    const chatMemberHandler = bot.on.mock.calls.find((c: any) => c[0] === 'chat_member')![1]
    const ctx = {
      chatMember: {
        old_chat_member: { status: 'member' },
        new_chat_member: { status: 'member', user: { first_name: 'Bob' } },
      },
      reply: vi.fn(),
    }
    await chatMemberHandler(ctx)
    expect(ctx.reply).not.toHaveBeenCalled()
  })
})
