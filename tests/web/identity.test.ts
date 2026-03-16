import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedPrisma = vi.hoisted(() => ({
  account: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  member: {
    findUnique: vi.fn(),
  },
  walletChallenge: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  walletBinding: {
    findFirst: vi.fn(),
  },
}))

const mockedPrivy = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/auth/privy', () => ({
  privy: mockedPrivy,
}))

describe('resolveIdentity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedPrivy.verifyAuthToken.mockResolvedValue({ userId: 'did:privy:123' })
    mockedPrisma.member.findUnique.mockResolvedValue(null)
  })

  it('returns the linked human account when privyDid is already stored', async () => {
    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-1',
      memberId: 'member-1',
      kind: 'human',
    })
    expect(mockedPrivy.getUser).not.toHaveBeenCalled()
  })

  it('links a legacy Telegram-backed account on first Privy login', async () => {
    mockedPrisma.account.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.privyDid) return null
      if (where.tgId === '123456') {
        return {
          id: 'account-legacy',
          privyDid: null,
          tgName: null,
          email: null,
          members: [{ id: 'member-legacy', kind: 'human' }],
        }
      }
      return null
    })
    mockedPrisma.account.update.mockResolvedValue({
      id: 'account-legacy',
    })
    mockedPrivy.getUser.mockResolvedValue({
      telegram: {
        telegramUserId: 123456,
        username: 'legacy_member',
      },
      email: {
        address: 'legacy@example.com',
      },
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-legacy',
      memberId: 'member-legacy',
      kind: 'human',
    })
    expect(mockedPrisma.account.update).toHaveBeenCalledWith({
      where: { id: 'account-legacy' },
      data: {
        privyDid: 'did:privy:123',
        email: 'legacy@example.com',
        tgName: 'legacy_member',
      },
    })
  })

  it('links legacy tgId account even when email is claimed by another account', async () => {
    mockedPrisma.account.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.privyDid) return null
      if (where.tgId === '123456') {
        return {
          id: 'account-legacy',
          privyDid: null,
          tgName: null,
          email: null,
          members: [{ id: 'member-legacy', kind: 'human' }],
        }
      }
      return null
    })
    // First update fails: email unique constraint violation
    mockedPrisma.account.update.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['email'] },
      })
    )
    // Retry without email succeeds
    mockedPrisma.account.update.mockResolvedValueOnce({ id: 'account-legacy' })

    mockedPrivy.getUser.mockResolvedValue({
      telegram: { telegramUserId: 123456, username: 'legacy_member' },
      email: { address: 'claimed@example.com' },
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-legacy',
      memberId: 'member-legacy',
      kind: 'human',
    })
    // Second call should omit the email
    expect(mockedPrisma.account.update).toHaveBeenCalledTimes(2)
    expect(mockedPrisma.account.update).toHaveBeenLastCalledWith({
      where: { id: 'account-legacy' },
      data: {
        privyDid: 'did:privy:123',
        tgName: 'legacy_member',
      },
    })
  })

  it('falls back to linking by email when a legacy account already has one', async () => {
    mockedPrisma.account.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.privyDid) return null
      if (where.email === 'user@example.com') {
        return {
          id: 'account-email',
          privyDid: null,
          tgName: null,
          email: 'user@example.com',
          members: [{ id: 'member-email', kind: 'human' }],
        }
      }
      return null
    })
    mockedPrisma.account.update.mockResolvedValue({
      id: 'account-email',
    })
    mockedPrivy.getUser.mockResolvedValue({
      email: {
        address: 'USER@example.com',
      },
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-email',
      memberId: 'member-email',
      kind: 'human',
    })
    expect(mockedPrisma.account.update).toHaveBeenCalledWith({
      where: { id: 'account-email' },
      data: {
        privyDid: 'did:privy:123',
      },
    })
  })
})
