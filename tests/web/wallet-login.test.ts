import { beforeEach, describe, expect, it, vi } from 'vitest'

const NORMALIZED_WALLET = `0x${'0'.repeat(61)}abc`
const NONCE = '11111111-1111-4111-8111-111111111111'

const mockedPrisma = vi.hoisted(() => ({
  walletChallenge: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  walletBinding: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  account: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  member: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const mockedVerify = vi.hoisted(() => ({
  verifyPersonalMessageSignature: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/sui-verify', () => mockedVerify)

function makeChallenge(overrides: Partial<{
  address: string
  domain: string | null
  expiresAt: Date
  usedAt: Date | null
  purpose: string
}> = {}) {
  return {
    address: NORMALIZED_WALLET,
    nonce: NONCE,
    domain: 'clawnews.example.com',
    expiresAt: new Date('2099-03-21T00:05:00.000Z'),
    usedAt: null,
    purpose: 'login',
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.resetModules()
  process.env.AUTH_SECRET = 'test-secret-for-session-jwt'
  process.env.NEXT_PUBLIC_BASE_URL = 'https://clawnews.example.com'
  // Default: most lookups return nothing
  mockedPrisma.walletBinding.findUnique.mockResolvedValue(null)
  mockedPrisma.walletBinding.findFirst.mockResolvedValue(null)
  mockedPrisma.account.findUnique.mockResolvedValue(null)
  mockedPrisma.member.findFirst.mockResolvedValue(null)
  mockedPrisma.member.findUnique.mockResolvedValue(null)
  mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
  mockedVerify.verifyPersonalMessageSignature.mockResolvedValue({
    toSuiAddress: () => NORMALIZED_WALLET,
  })
})

describe('loginWithWalletSignature', () => {
  it('returns the existing binding when wallet is already bound to a human', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      member: { id: 'member-1', accountId: 'account-1', kind: 'human' },
    })

    const { loginWithWalletSignature } = await import('../../web/lib/auth/wallet-login.ts')
    const result = await loginWithWalletSignature({
      address: NORMALIZED_WALLET,
      signature: 'sig',
      nonce: NONCE,
    })

    expect(result).toEqual({
      memberId: 'member-1',
      accountId: 'account-1',
      walletAddress: NORMALIZED_WALLET,
    })
    // Should consume the challenge
    expect(mockedPrisma.walletChallenge.updateMany).toHaveBeenCalledWith({
      where: { nonce: NONCE, usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('rejects when challenge is missing', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(null)
    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    await expect(
      loginWithWalletSignature({ address: NORMALIZED_WALLET, signature: 'sig', nonce: NONCE }),
    ).rejects.toBeInstanceOf(WalletLoginError)
  })

  it('rejects when challenge is already used (replay)', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ usedAt: new Date() }))
    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    await expect(
      loginWithWalletSignature({ address: NORMALIZED_WALLET, signature: 'sig', nonce: NONCE }),
    ).rejects.toThrow(WalletLoginError)
  })

  it('rejects when challenge is expired', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(
      makeChallenge({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }),
    )
    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    await expect(
      loginWithWalletSignature({ address: NORMALIZED_WALLET, signature: 'sig', nonce: NONCE }),
    ).rejects.toThrow(WalletLoginError)
  })

  it('rejects when signature does not verify', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedVerify.verifyPersonalMessageSignature.mockRejectedValue(new Error('Invalid signature'))

    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    await expect(
      loginWithWalletSignature({ address: NORMALIZED_WALLET, signature: 'sig', nonce: NONCE }),
    ).rejects.toThrow(WalletLoginError)
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('rejects when recovered address does not match challenge address', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedVerify.verifyPersonalMessageSignature.mockResolvedValue({
      toSuiAddress: () => `0x${'0'.repeat(63)}9`,
    })

    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    await expect(
      loginWithWalletSignature({ address: NORMALIZED_WALLET, signature: 'sig', nonce: NONCE }),
    ).rejects.toThrow(WalletLoginError)
  })

  it('rejects 409 when wallet is bound to an agent member', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedPrisma.walletBinding.findUnique.mockResolvedValue({
      member: { id: 'agent-1', accountId: 'account-x', kind: 'agent' },
    })

    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    try {
      await loginWithWalletSignature({ address: NORMALIZED_WALLET, signature: 'sig', nonce: NONCE })
      expect.fail('expected WalletLoginError')
    } catch (err) {
      expect(err).toBeInstanceOf(WalletLoginError)
      expect((err as InstanceType<typeof WalletLoginError>).reason).toBe('wallet_bound_elsewhere')
    }
  })

  it('creates a fresh wallet-owned account when no existing identity matches', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    // walletBinding.findUnique → null, account.findUnique → null
    // $transaction is called for the creation path
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
      const tx = {
        account: {
          create: vi.fn().mockResolvedValue({ id: 'new-account-1' }),
          findUnique: vi.fn(),
        },
        member: {
          create: vi.fn().mockResolvedValue({ id: 'new-member-1' }),
          update: vi.fn().mockResolvedValue({}),
          findUnique: vi.fn().mockResolvedValue(null),
        },
        walletBinding: {
          create: vi.fn().mockResolvedValue({}),
        },
      }
      return fn(tx)
    })

    const { loginWithWalletSignature } = await import('../../web/lib/auth/wallet-login.ts')
    const result = await loginWithWalletSignature({
      address: NORMALIZED_WALLET,
      signature: 'sig',
      nonce: NONCE,
    })

    expect(result).toEqual({
      memberId: 'new-member-1',
      accountId: 'new-account-1',
      walletAddress: NORMALIZED_WALLET,
    })
  })

  it('attaches the wallet to an existing tgId account when verifiedTgContext is provided', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedPrisma.account.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.walletAddress) return null
      if (where.tgId === '12345') {
        return {
          id: 'tg-account-1',
          walletAddress: null,
          tgName: 'tguser',
          members: [{ id: 'tg-member-1' }],
        }
      }
      return null
    })
    mockedPrisma.account.update.mockResolvedValue({ id: 'tg-account-1' })

    const { loginWithWalletSignature } = await import('../../web/lib/auth/wallet-login.ts')
    const result = await loginWithWalletSignature({
      address: NORMALIZED_WALLET,
      signature: 'sig',
      nonce: NONCE,
      verifiedTgContext: { tgId: '12345' },
    })

    expect(result).toEqual({
      memberId: 'tg-member-1',
      accountId: 'tg-account-1',
      walletAddress: NORMALIZED_WALLET,
    })
    // Should denormalize wallet on Account
    expect(mockedPrisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tg-account-1' },
        data: expect.objectContaining({ walletAddress: NORMALIZED_WALLET }),
      }),
    )
  })

  it('rejects 409 when verifiedTgContext account already has a different wallet', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedPrisma.account.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.walletAddress) return null
      if (where.tgId === '12345') {
        return {
          id: 'tg-account-1',
          walletAddress: `0x${'0'.repeat(63)}9`,
          tgName: 'tguser',
          members: [{ id: 'tg-member-1' }],
        }
      }
      return null
    })

    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    try {
      await loginWithWalletSignature({
        address: NORMALIZED_WALLET,
        signature: 'sig',
        nonce: NONCE,
        verifiedTgContext: { tgId: '12345' },
      })
      expect.fail('expected WalletLoginError')
    } catch (err) {
      expect(err).toBeInstanceOf(WalletLoginError)
      expect((err as InstanceType<typeof WalletLoginError>).reason).toBe('wallet_bound_elsewhere')
    }
  })

  it('rejects when nonce is not a UUID', async () => {
    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    await expect(
      loginWithWalletSignature({
        address: NORMALIZED_WALLET,
        signature: 'sig',
        nonce: 'not-a-uuid',
      }),
    ).rejects.toThrow(WalletLoginError)
    expect(mockedPrisma.walletChallenge.findUnique).not.toHaveBeenCalled()
  })
})
