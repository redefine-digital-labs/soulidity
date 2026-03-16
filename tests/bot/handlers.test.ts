import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleJoin, handleMark, handleStart, registerHandlers } from '../../src/bot/handlers.js'
import { createMockPrisma } from '../helpers/mock-prisma.js'

function createMockCtx(overrides: any = {}) {
  return {
    from: { id: 123456789 },
    chat: { type: 'private' },
    reply: vi.fn(),
    ...overrides,
  }
}

describe('handleJoin', () => {
  let prisma: ReturnType<typeof createMockPrisma>['prisma']
  let store: ReturnType<typeof createMockPrisma>['store']

  beforeEach(() => {
    const mock = createMockPrisma()
    prisma = mock.prisma
    store = mock.store
  })

  it('generates invite code and includes it in prompt', async () => {
    const ctx = createMockCtx()
    await handleJoin(ctx as any, prisma)
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('123456789')
    expect(msg).toContain('join-skill.md')
    expect(msg).toContain('invite_code:')
    expect(store.inviteCodes).toHaveLength(1)
    expect(store.inviteCodes[0].code).toHaveLength(16)
    expect(store.members).toHaveLength(1)
    expect(store.members[0].tgId).toBe('123456789')
    expect(store.members[0].inviteCode).toBe(store.inviteCodes[0].code)
  })

  it('ignores non-private chats', async () => {
    const ctx = createMockCtx({ chat: { type: 'group' } })
    await handleJoin(ctx as any, prisma)
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  it('reuses an existing unexpired pending invite code', async () => {
    store.members.push({
      id: 'member-1',
      tgId: '123456789',
      inviteCode: 'PENDING01',
      accountId: null,
      level: 1,
      createdAt: new Date(),
    })
    store.inviteCodes.push({
      code: 'PENDING01',
      active: 0,
      usedBy: '123456789',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    })

    const ctx = createMockCtx()
    await handleJoin(ctx as any, prisma)

    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('PENDING01')
    expect(store.inviteCodes).toHaveLength(1)
  })

  it('reuses the same code on repeated /join before API verification completes', async () => {
    const firstCtx = createMockCtx()
    await handleJoin(firstCtx as any, prisma)

    expect(store.inviteCodes).toHaveLength(1)
    const firstCode = store.inviteCodes[0].code

    const secondCtx = createMockCtx()
    await handleJoin(secondCtx as any, prisma)

    expect(store.inviteCodes).toHaveLength(1)
    expect((secondCtx.reply.mock.calls[0][0] as string)).toContain(firstCode)
    expect(store.members).toHaveLength(1)
    expect(store.members[0].inviteCode).toBe(firstCode)
  })

  it('rotates an expired pending invite code once and then reuses the replacement', async () => {
    store.members.push({
      id: 'member-1',
      tgId: '123456789',
      inviteCode: 'EXPIRED01',
      accountId: null,
      level: 1,
      createdAt: new Date(),
    })
    store.inviteCodes.push({
      code: 'EXPIRED01',
      active: 0,
      usedBy: '123456789',
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
    })

    const firstCtx = createMockCtx()
    await handleJoin(firstCtx as any, prisma)

    expect(store.inviteCodes).toHaveLength(2)
    const replacementCode = store.inviteCodes[1].code
    expect(replacementCode).toHaveLength(16)
    expect(store.members[0].inviteCode).toBe(replacementCode)
    expect((firstCtx.reply.mock.calls[0][0] as string)).toContain(replacementCode)

    const secondCtx = createMockCtx()
    await handleJoin(secondCtx as any, prisma)

    expect(store.inviteCodes).toHaveLength(2)
    expect((secondCtx.reply.mock.calls[0][0] as string)).toContain(replacementCode)
  })

  it('rolls back invite rotation when the pending member update fails', async () => {
    store.members.push({
      id: 'member-1',
      tgId: '123456789',
      inviteCode: 'EXPIRED01',
      accountId: null,
      level: 1,
      createdAt: new Date(),
    })
    store.inviteCodes.push({
      code: 'EXPIRED01',
      active: 0,
      usedBy: '123456789',
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
    })

    prisma.member.upsert.mockRejectedValueOnce(new Error('write failed'))
    const ctx = createMockCtx()

    await handleJoin(ctx as any, prisma)
    expect(store.inviteCodes).toHaveLength(1)
    expect(store.members[0].inviteCode).toBe('EXPIRED01')
    expect(ctx.reply).toHaveBeenCalledWith('系统暂时不可用，请稍后再试')
  })

  it('replies with a friendly error when invite code creation fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'))
    const ctx = createMockCtx()

    await handleJoin(ctx as any, prisma)

    expect(ctx.reply).toHaveBeenCalledWith('系统暂时不可用，请稍后再试')
    expect(consoleError).toHaveBeenCalledWith('[handleJoin] transaction failed:', expect.any(Error))
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
    const ctx = createMockCtx({ match: 'join' })
    await handleStart(ctx as any, mock.prisma)
    expect(ctx.reply).toHaveBeenCalledTimes(1)
    const msg = ctx.reply.mock.calls[0][0] as string
    expect(msg).toContain('join-skill.md')
    expect(msg).toContain('123456789')
    expect(msg).toContain('invite_code:')
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
