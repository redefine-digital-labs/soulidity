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
