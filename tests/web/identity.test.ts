import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetRateLimitBucketsForTests } from '../../web/lib/rate-limit.ts'

const NORMALIZED_ABC = `0x${'0'.repeat(61)}abc`

const mockedPrisma = vi.hoisted(() => ({
  account: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  member: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  walletChallenge: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  walletBinding: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
}))

const mockedPrivy = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  getUser: vi.fn(),
  createWallets: vi.fn(),
}))

const mockedHeaders = vi.hoisted(() => vi.fn())

const mockedVerify = vi.hoisted(() => ({
  verifyPersonalMessageSignature: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/request-headers', () => ({
  getRequestHeaders: mockedHeaders,
}))

vi.mock('@web/lib/auth/privy', () => ({
  privy: mockedPrivy,
}))

vi.mock('@web/lib/sui-verify', () => mockedVerify)

describe('resolveIdentity', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    resetRateLimitBucketsForTests()
    process.env.NEXT_PUBLIC_BASE_URL = 'https://clawnews.example.com'
    delete process.env.TRUST_PROXY_HEADERS
    mockedPrivy.verifyAuthToken.mockResolvedValue({ userId: 'did:privy:123' })
    mockedPrisma.member.findUnique.mockResolvedValue(null)
    mockedPrisma.member.findFirst.mockResolvedValue(null)
    mockedPrisma.walletBinding.findFirst.mockResolvedValue(null)
    mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
    mockedPrisma.walletBinding.deleteMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.update.mockResolvedValue({ id: 'binding-1' })
    mockedPrivy.createWallets.mockResolvedValue({
      linkedAccounts: [{ type: 'wallet', chainType: 'sui', address: '0xdef' }],
    })
  })

  it('backfills a local Sui wallet binding when the Privy user already has one', async () => {
    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })
    // ensureSuiWallet will call getUser in the background
    mockedPrivy.getUser.mockResolvedValue({
      linkedAccounts: [{ type: 'wallet', chainType: 'sui', address: '0xabc' }],
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-1',
      memberId: 'member-1',
      kind: 'human',
    })
    expect(mockedPrivy.createWallets).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(mockedPrisma.walletBinding.create).toHaveBeenCalledWith({
        data: {
          memberId: 'member-1',
          chain: 'sui',
          address: NORMALIZED_ABC,
        },
      })
    })
  })

  it('skips Privy wallet sync when the member already has a local Sui binding', async () => {
    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      address: NORMALIZED_ABC,
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-1',
      memberId: 'member-1',
      kind: 'human',
    })
    expect(mockedPrivy.getUser).not.toHaveBeenCalled()
    expect(mockedPrivy.createWallets).not.toHaveBeenCalled()
    expect(mockedPrisma.walletBinding.create).not.toHaveBeenCalled()
    expect(mockedPrisma.walletBinding.update).not.toHaveBeenCalled()
  })

  it('repairs a short-form local Sui binding before skipping Privy sync', async () => {
    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      address: '0xabc',
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-1',
      memberId: 'member-1',
      kind: 'human',
    })
    expect(mockedPrisma.walletBinding.update).toHaveBeenCalledWith({
      where: { id: 'binding-1' },
      data: { address: NORMALIZED_ABC },
    })
    expect(mockedPrivy.getUser).not.toHaveBeenCalled()
    expect(mockedPrivy.createWallets).not.toHaveBeenCalled()
  })

  it('warns when canonicalizing a stored Sui binding collides with another member', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      address: '0xabc',
    })
    mockedPrisma.walletBinding.update.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['chain', 'address'] },
      }),
    )
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      memberId: 'member-elsewhere',
    })
    mockedPrivy.getUser.mockResolvedValue({ linkedAccounts: [] })
    mockedPrivy.createWallets.mockResolvedValue({ linkedAccounts: [] })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-1',
      memberId: 'member-1',
      kind: 'human',
    })
    await vi.waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        'Canonical Sui wallet binding already belongs to another member',
        {
          address: `${NORMALIZED_ABC.slice(0, 10)}...${NORMALIZED_ABC.slice(-4)}`,
        },
      )
    })

    consoleWarn.mockRestore()
  })

  it('drops a stale short-form Sui binding when the canonical row already belongs to the same member', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})

    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      address: '0xabc',
    })
    mockedPrisma.walletBinding.update.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['chain', 'address'] },
      }),
    )
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      memberId: 'member-1',
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-1',
      memberId: 'member-1',
      kind: 'human',
    })
    await vi.waitFor(() => {
      expect(mockedPrisma.walletBinding.deleteMany).toHaveBeenCalledWith({
        where: { id: 'binding-1' },
      })
    })
    expect(consoleInfo).toHaveBeenCalledWith(
      'Removed duplicate non-canonical Sui wallet binding after canonicalization',
      {
        memberId: 'member-1',
        address: `${NORMALIZED_ABC.slice(0, 10)}...${NORMALIZED_ABC.slice(-4)}`,
      },
    )
    expect(mockedPrivy.getUser).not.toHaveBeenCalled()
    expect(mockedPrivy.createWallets).not.toHaveBeenCalled()
    consoleInfo.mockRestore()
  })

  it('does not silently no-op when the Privy Sui wallet is already bound to another member', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })
    mockedPrivy.getUser.mockResolvedValue({
      linkedAccounts: [{ type: 'wallet', chainType: 'sui', address: '0xabc' }],
    })
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      id: 'binding-elsewhere',
      memberId: 'member-elsewhere',
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolvePrivyIdentity('token')

    expect(identity).toEqual({
      accountId: 'account-1',
      memberId: 'member-1',
      kind: 'human',
    })
    expect(mockedPrisma.walletBinding.create).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith(
        'Privy Sui wallet is already bound to another member',
        {
          address: `${NORMALIZED_ABC.slice(0, 10)}...${NORMALIZED_ABC.slice(-4)}`,
        },
      )
    })

    consoleWarn.mockRestore()
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
      linkedAccounts: [],
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
      linkedAccounts: [],
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
      linkedAccounts: [],
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

  it('verifies wallet challenges against the configured app domain instead of the request host', async () => {
    const nonce = 'nonce-123'
    const normalizedAddress = `0x${'0'.repeat(63)}1`

    mockedHeaders.mockResolvedValue(new Headers({
      host: 'evil.example.com',
      'x-agent-address': '0x1',
      'x-agent-signature': 'signature',
      'x-agent-message': nonce,
    }))
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      address: normalizedAddress,
      nonce,
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    })
    mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      member: {
        id: 'member-wallet',
        accountId: 'account-wallet',
        kind: 'human',
      },
    })
    mockedVerify.verifyPersonalMessageSignature.mockImplementation(async (message: Uint8Array) => {
      const decoded = new TextDecoder().decode(message)
      expect(decoded).toContain('clawnews.example.com wants you to sign in with your Sui account:')
      expect(decoded).not.toContain('evil.example.com')

      return {
        toSuiAddress: () => normalizedAddress,
      }
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')
    const identity = await resolveIdentity()

    expect(identity).toEqual({
      accountId: 'account-wallet',
      memberId: 'member-wallet',
      kind: 'human',
    })
    expect(mockedPrisma.walletBinding.findFirst).toHaveBeenCalledWith({
      where: { chain: 'sui', address: normalizedAddress },
      select: {
        member: {
          select: { id: true, accountId: true, kind: true },
        },
      },
    })
    expect(mockedPrisma.walletChallenge.updateMany).toHaveBeenCalledWith({
      where: { nonce, usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('rejects expired wallet challenges before verifying signatures', async () => {
    mockedHeaders.mockResolvedValue(new Headers({
      'x-agent-address': '0x1',
      'x-agent-signature': 'signature',
      'x-agent-message': 'nonce-expired',
    }))
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      address: `0x${'0'.repeat(63)}1`,
      nonce: 'nonce-expired',
      usedAt: null,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedVerify.verifyPersonalMessageSignature).not.toHaveBeenCalled()
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('rejects replayed wallet challenges that were already used', async () => {
    mockedHeaders.mockResolvedValue(new Headers({
      'x-agent-address': '0x1',
      'x-agent-signature': 'signature',
      'x-agent-message': 'nonce-used',
    }))
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      address: `0x${'0'.repeat(63)}1`,
      nonce: 'nonce-used',
      usedAt: new Date('2099-03-21T00:00:00.000Z'),
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedVerify.verifyPersonalMessageSignature).not.toHaveBeenCalled()
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('rejects wallet challenges whose stored address no longer matches the signer address', async () => {
    mockedHeaders.mockResolvedValue(new Headers({
      'x-agent-address': '0x1',
      'x-agent-signature': 'signature',
      'x-agent-message': 'nonce-mismatch',
    }))
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      address: `0x${'0'.repeat(63)}2`,
      nonce: 'nonce-mismatch',
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedVerify.verifyPersonalMessageSignature).not.toHaveBeenCalled()
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('logs unexpected wallet identity failures before failing closed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dbError = new Error('db unavailable')

    mockedHeaders.mockResolvedValue(new Headers({
      'x-agent-address': '0xabc',
      'x-agent-signature': 'signature',
      'x-agent-message': 'nonce-db-error',
    }))
    mockedPrisma.walletChallenge.findUnique.mockRejectedValue(dbError)

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(consoleError).toHaveBeenCalledWith(
      'Unexpected wallet identity resolution failure',
      expect.objectContaining({
        address: NORMALIZED_ABC,
        nonce: 'nonce-db-error',
        error: dbError,
      }),
    )

    consoleError.mockRestore()
  })

  it('treats invalid wallet signatures as expected auth failures without error logging', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    mockedHeaders.mockResolvedValue(new Headers({
      'x-agent-address': '0xabc',
      'x-agent-signature': 'bad-signature',
      'x-agent-message': 'nonce-bad-signature',
    }))
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      address: NORMALIZED_ABC,
      nonce: 'nonce-bad-signature',
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    })
    mockedVerify.verifyPersonalMessageSignature.mockRejectedValue(new Error('Invalid signature'))

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
    expect(mockedPrisma.walletBinding.findFirst).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('logs privy verification failures before failing closed', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockedHeaders.mockResolvedValue(new Headers({
      authorization: 'Bearer privy-token',
    }))
    mockedPrivy.verifyAuthToken.mockRejectedValue(new Error('privy unavailable'))

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(consoleWarn).toHaveBeenCalledWith(
      'Privy token verification failed',
      expect.objectContaining({
        error: expect.any(Error),
      }),
    )

    consoleWarn.mockRestore()
  })

  it('fails closed when resolvePrivyIdentity receives an invalid token directly', async () => {
    mockedPrivy.verifyAuthToken.mockRejectedValue(new Error('invalid token'))

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolvePrivyIdentity('bad-token')).resolves.toBeNull()
    expect(mockedPrivy.getUser).not.toHaveBeenCalled()
  })

  it('rejects oversized wallet auth headers before any DB or signature work', async () => {
    mockedHeaders.mockResolvedValue(new Headers({
      'x-agent-address': `0x${'a'.repeat(129)}`,
      'x-agent-signature': 'signature',
      'x-agent-message': 'nonce-ok',
    }))

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedPrisma.walletChallenge.findUnique).not.toHaveBeenCalled()
    expect(mockedVerify.verifyPersonalMessageSignature).not.toHaveBeenCalled()
  })

  it('rejects oversized wallet signature and nonce headers before any DB or signature work', async () => {
    mockedHeaders.mockResolvedValue(new Headers({
      'x-agent-address': '0xabc',
      'x-agent-signature': 's'.repeat(513),
      'x-agent-message': 'n'.repeat(129),
    }))

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedPrisma.walletChallenge.findUnique).not.toHaveBeenCalled()
    expect(mockedVerify.verifyPersonalMessageSignature).not.toHaveBeenCalled()
  })

  it('rate limits repeated wallet identity probes before extra challenge lookups', async () => {
    const nonce = 'nonce-rate-limit'
    const normalizedAddress = `0x${'0'.repeat(63)}1`
    process.env.TRUST_PROXY_HEADERS = 'true'

    mockedHeaders.mockResolvedValue(new Headers({
      'x-forwarded-for': '203.0.113.10',
      'x-agent-address': '0x1',
      'x-agent-signature': 'signature',
      'x-agent-message': nonce,
    }))
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue({
      address: normalizedAddress,
      nonce,
      usedAt: null,
      expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    })
    mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue({
      member: {
        id: 'member-wallet',
        accountId: 'account-wallet',
        kind: 'human',
      },
    })
    mockedVerify.verifyPersonalMessageSignature.mockResolvedValue({
      toSuiAddress: () => normalizedAddress,
    })

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(resolveIdentity()).resolves.toEqual({
        accountId: 'account-wallet',
        memberId: 'member-wallet',
        kind: 'human',
      })
    }
    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedPrisma.walletChallenge.findUnique).toHaveBeenCalledTimes(10)
  })

  it('rejects trivially short agent API keys before hashing or DB lookup', async () => {
    mockedHeaders.mockResolvedValue(new Headers({
      authorization: 'Bearer sk-',
    }))

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedPrisma.member.findFirst).not.toHaveBeenCalled()
  })

  it('rejects empty bearer tokens before attempting Privy verification', async () => {
    mockedHeaders.mockResolvedValue(new Headers({
      authorization: 'Bearer ',
    }))

    const { resolveIdentity } = await import('../../web/lib/auth/identity.ts')

    await expect(resolveIdentity()).resolves.toBeNull()
    expect(mockedPrivy.verifyAuthToken).not.toHaveBeenCalled()
  })

  it('skips repeated wallet sync attempts for the same member within the sync TTL', async () => {
    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue(null)
    mockedPrivy.getUser.mockResolvedValue({ linkedAccounts: [] })
    mockedPrivy.createWallets.mockResolvedValue({ linkedAccounts: [] })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')

    await resolvePrivyIdentity('token')
    await resolvePrivyIdentity('token')

    expect(mockedPrisma.walletBinding.findFirst).toHaveBeenCalledTimes(1)
    expect(mockedPrivy.getUser).toHaveBeenCalledTimes(1)
    expect(mockedPrivy.createWallets).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent wallet sync attempts for the same member', async () => {
    let resolveGetUser: ((value: any) => void) | undefined

    mockedPrisma.account.findUnique.mockResolvedValue({
      id: 'account-1',
      privyDid: 'did:privy:123',
      tgName: 'openclaw',
      email: 'user@example.com',
      members: [{ id: 'member-1', kind: 'human' }],
    })
    mockedPrisma.walletBinding.findFirst.mockResolvedValue(null)
    mockedPrivy.getUser.mockImplementation(
      () => new Promise((resolve) => { resolveGetUser = resolve }),
    )
    mockedPrivy.createWallets.mockResolvedValue({ linkedAccounts: [] })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.ts')

    const first = resolvePrivyIdentity('token')
    const second = resolvePrivyIdentity('token')
    await vi.waitFor(() => {
      expect(resolveGetUser).toBeTypeOf('function')
    })
    resolveGetUser?.({ linkedAccounts: [] })

    await Promise.all([first, second])

    expect(mockedPrivy.getUser).toHaveBeenCalledTimes(1)
    expect(mockedPrivy.createWallets).toHaveBeenCalledTimes(1)
  })
})
