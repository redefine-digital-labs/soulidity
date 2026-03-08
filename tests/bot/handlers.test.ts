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
