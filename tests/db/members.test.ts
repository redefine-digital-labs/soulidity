import { describe, it, expect, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'
import { createInviteCode, validateInviteCode, useInviteCode, insertMember, getMembers } from '../../src/db/members.js'

let prisma: ReturnType<typeof createMockPrisma>['prisma']

beforeEach(() => {
  const mock = createMockPrisma()
  prisma = mock.prisma
})

describe('invite codes', () => {
  it('creates and validates invite code', async () => {
    const code = await createInviteCode(prisma)
    expect(code).toHaveLength(16)
    expect(await validateInviteCode(prisma, code)).toBe(true)
  })

  it('invalidates after use', async () => {
    const code = await createInviteCode(prisma)
    expect(await useInviteCode(prisma, code, 'user123')).toBe(true)
    expect(await validateInviteCode(prisma, code)).toBe(false)
  })

  it('rejects invalid code', async () => {
    expect(await validateInviteCode(prisma, 'BADCODE')).toBe(false)
  })
})

describe('members', () => {
  it('inserts and retrieves members', async () => {
    await insertMember(prisma, 'tg_123', 'TestUser', 'CODE1')
    const members = await getMembers(prisma)
    expect(members).toHaveLength(1)
    expect(members[0].tg_id).toBe('tg_123')
  })
})
