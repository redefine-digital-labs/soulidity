import { describe, expect, it } from 'vitest'
import { createMockPrisma } from './mock-prisma.js'

describe('createMockPrisma', () => {
  it('supports account creation and enforces unique account identifiers', async () => {
    const { prisma, store } = createMockPrisma()

    await prisma.account.create({
      data: {
        privyDid: 'did:privy:123',
        email: 'user@example.com',
      },
    })

    expect(store.accounts).toHaveLength(1)

    await expect(prisma.account.create({
      data: {
        email: 'user@example.com',
      },
    })).rejects.toMatchObject({ code: 'P2002' })
  })
})
