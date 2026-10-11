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
