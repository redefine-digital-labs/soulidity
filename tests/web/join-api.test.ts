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
    expect(result.error_code).toBe('INVALID_OR_USED')
  })

  it('rejects already-registered members before consuming invite codes', async () => {
    store.inviteCodes.push({ code: 'GOOD1234', active: 1, usedBy: null, createdAt: new Date() })
    store.members.push({
      id: 'member-1',
      tgId: '123456',
      accountId: 'account-1',
      inviteCode: 'OLDCODE1',
      level: 1,
      createdAt: new Date(),
    })

    const result = await processJoinRequest(prisma, {
      tg_id: '123456',
      invite_code: 'GOOD1234',
      createInviteLink: vi.fn(),
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Already registered')
    expect(result.error_code).toBe('ALREADY_REGISTERED')
    expect(store.inviteCodes[0].active).toBe(1)
    expect(store.inviteCodes[0].usedBy).toBeNull()
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
    expect(result.register_code).toBe('GOOD1234')
    expect(store.inviteCodes[0].active).toBe(0)
    expect(store.inviteCodes[0].usedBy).toBe('123456')
    expect(store.members).toHaveLength(1)
    expect(store.members[0].tgId).toBe('123456')
    expect(createInviteLink).toHaveBeenCalled()
  })

  it('returns error after consuming the code when link creation fails', async () => {
    store.inviteCodes.push({ code: 'LINK1234', active: 1, usedBy: null, createdAt: new Date() })

    const createInviteLink = vi.fn().mockRejectedValue(new Error('Bot API error'))
    const result = await processJoinRequest(prisma, {
      tg_id: '123',
      invite_code: 'LINK1234',
      createInviteLink,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('invite link')
    expect(result.error_code).toBe('LINK_FAILED')
    expect(store.inviteCodes[0].active).toBe(0)
    expect(store.inviteCodes[0].usedBy).toBe('123')
    expect(store.members).toHaveLength(1)
    expect(store.members[0].inviteCode).toBe('LINK1234')
  })

  it('allows the same Telegram user to retry a consumed pending code', async () => {
    store.inviteCodes.push({
      code: 'RETRY123',
      active: 0,
      usedBy: '123456',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })
    store.members.push({
      id: 'member-1',
      tgId: '123456',
      accountId: null,
      inviteCode: 'RETRY123',
      level: 1,
      createdAt: new Date(),
    })

    const createInviteLink = vi.fn().mockResolvedValue('https://t.me/+retry')
    const result = await processJoinRequest(prisma, {
      tg_id: '123456',
      invite_code: 'RETRY123',
      createInviteLink,
    })

    expect(result.success).toBe(true)
    expect(result.invite_link).toBe('https://t.me/+retry')
    expect(result.register_code).toBe('RETRY123')
    expect(createInviteLink).toHaveBeenCalledTimes(1)
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

  it('keeps an existing unexpired registration code without consuming a new invite on rejoin', async () => {
    store.inviteCodes.push({ code: 'NEWCODE1', active: 1, usedBy: null, createdAt: new Date() })
    store.inviteCodes.push({ code: 'OLDCODE1', active: 0, usedBy: '123456', createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) })
    store.members.push({
      id: 'member-1',
      tgId: '123456',
      accountId: null,
      inviteCode: 'OLDCODE1',
      level: 1,
      createdAt: new Date(),
    })

    const result = await processJoinRequest(prisma, {
      tg_id: '123456',
      invite_code: 'NEWCODE1',
      createInviteLink: vi.fn().mockResolvedValue('https://t.me/+updated'),
    })

    expect(result.success).toBe(true)
    expect(result.register_code).toBe('OLDCODE1')
    expect(store.members).toHaveLength(1)
    expect(store.members[0].inviteCode).toBe('OLDCODE1')
    expect(store.inviteCodes.find((invite) => invite.code === 'NEWCODE1')).toMatchObject({
      active: 1,
      usedBy: null,
    })
  })

  it('does not reuse another user’s previously consumed invite code', async () => {
    store.inviteCodes.push({ code: 'NEWCODE1', active: 1, usedBy: null, createdAt: new Date() })
    store.inviteCodes.push({ code: 'OLDCODE1', active: 0, usedBy: 'other-user', createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) })
    store.members.push({
      id: 'member-1',
      tgId: '123456',
      accountId: null,
      inviteCode: 'OLDCODE1',
      level: 1,
      createdAt: new Date(),
    })

    const result = await processJoinRequest(prisma, {
      tg_id: '123456',
      invite_code: 'NEWCODE1',
      createInviteLink: vi.fn().mockResolvedValue('https://t.me/+updated'),
    })

    expect(result.success).toBe(true)
    expect(result.register_code).toBe('NEWCODE1')
    expect(store.members[0].inviteCode).toBe('NEWCODE1')
  })

  it('replaces an expired pending registration code on rejoin', async () => {
    store.inviteCodes.push({ code: 'NEWCODE1', active: 1, usedBy: null, createdAt: new Date() })
    store.inviteCodes.push({ code: 'OLDCODE1', active: 0, usedBy: '123456', createdAt: new Date(), expiresAt: new Date(Date.now() - 60_000) })
    store.members.push({
      id: 'member-1',
      tgId: '123456',
      accountId: null,
      inviteCode: 'OLDCODE1',
      level: 1,
      createdAt: new Date(),
    })

    const result = await processJoinRequest(prisma, {
      tg_id: '123456',
      invite_code: 'NEWCODE1',
      createInviteLink: vi.fn().mockResolvedValue('https://t.me/+updated'),
    })

    expect(result.success).toBe(true)
    expect(result.register_code).toBe('NEWCODE1')
    expect(store.members[0].inviteCode).toBe('NEWCODE1')
  })
})
