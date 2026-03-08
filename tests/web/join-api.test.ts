import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
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

  it('returns error and preserves invite code when link creation fails', async () => {
    store.inviteCodes.push({ code: 'LINK1234', active: 1, usedBy: null, createdAt: new Date() })

    const createInviteLink = vi.fn().mockRejectedValue(new Error('Bot API error'))
    const result = await processJoinRequest(prisma, {
      tg_id: '123',
      invite_code: 'LINK1234',
      createInviteLink,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('invite link')
    expect(store.inviteCodes[0].active).toBe(1)
    expect(store.inviteCodes[0].usedBy).toBeNull()
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
