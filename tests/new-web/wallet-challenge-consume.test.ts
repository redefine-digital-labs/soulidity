import { beforeEach, describe, expect, it, vi } from 'vitest'

const NORMALIZED_WALLET = `0x${'0'.repeat(61)}abc`
const OTHER_WALLET = `0x${'0'.repeat(63)}9`
const NONCE = '11111111-1111-4111-8111-111111111111'
const FUTURE_EXPIRY = new Date('2099-03-21T00:05:00.000Z')

const mockedPrisma = vi.hoisted(() => ({
  walletChallenge: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
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
    expiresAt: FUTURE_EXPIRY,
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
  mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
  mockedVerify.verifyPersonalMessageSignature.mockResolvedValue({
    toSuiAddress: () => NORMALIZED_WALLET,
  })
})

describe('consumeWalletChallengeForPurpose', () => {
  it('round-trips the login purpose', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ purpose: 'login' }))
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: true, address: NORMALIZED_WALLET })
    expect(mockedPrisma.walletChallenge.updateMany).toHaveBeenCalledWith({
      where: { nonce: NONCE, usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('round-trips the agent-join purpose', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ purpose: 'agent-join' }))
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'agent-join',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: true, address: NORMALIZED_WALLET })
  })

  it('round-trips the desktop-link purpose', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ purpose: 'desktop-link' }))
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'desktop-link',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: true, address: NORMALIZED_WALLET })
  })

  it('rejects with challenge_purpose_mismatch when issued purpose differs from consume purpose', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ purpose: 'login' }))
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'desktop-link',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'challenge_purpose_mismatch' })
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('rejects with challenge_purpose_mismatch when login challenge is consumed as agent-join', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ purpose: 'login' }))
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'agent-join',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'challenge_purpose_mismatch' })
  })

  it('rejects with signature_invalid when verify throws', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedVerify.verifyPersonalMessageSignature.mockRejectedValue(new Error('Invalid signature'))
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toMatchObject({ ok: false, reason: 'signature_invalid' })
    if (!result.ok && result.reason === 'signature_invalid') {
      expect(result.cause).toContain('Invalid signature')
    }
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('rejects with challenge_expired when expiry is in the past', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(
      makeChallenge({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }),
    )
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'challenge_expired' })
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('returns challenge_used on the second call (replay)', async () => {
    // First call: succeeds.
    mockedPrisma.walletChallenge.findUnique.mockResolvedValueOnce(makeChallenge())
    mockedPrisma.walletChallenge.updateMany.mockResolvedValueOnce({ count: 1 })

    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const first = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(first).toEqual({ ok: true, address: NORMALIZED_WALLET })

    // Second call: row now has usedAt set.
    mockedPrisma.walletChallenge.findUnique.mockResolvedValueOnce(
      makeChallenge({ usedAt: new Date() }),
    )
    const second = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(second).toEqual({ ok: false, reason: 'challenge_used' })
  })

  it('returns challenge_used when atomic consume race loses', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 0 })
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'challenge_used' })
  })

  it('rejects when address differs from challenge.address', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: OTHER_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(['address_mismatch', 'signer_mismatch']).toContain(result.reason)
    }
    expect(mockedPrisma.walletChallenge.updateMany).not.toHaveBeenCalled()
  })

  it('rejects with signer_mismatch when recovered address differs from claimed', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge())
    mockedVerify.verifyPersonalMessageSignature.mockResolvedValue({
      toSuiAddress: () => OTHER_WALLET,
    })
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'signer_mismatch' })
  })

  it('rejects with invalid_nonce when nonce is not a UUID', async () => {
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: 'not-a-uuid',
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_nonce' })
    expect(mockedPrisma.walletChallenge.findUnique).not.toHaveBeenCalled()
  })

  it('rejects oversize signature without calling DB or verify', async () => {
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'a'.repeat(8193),
    })
    expect(result).toEqual({ ok: false, reason: 'signature_invalid' })
    expect(mockedPrisma.walletChallenge.findUnique).not.toHaveBeenCalled()
    expect(mockedVerify.verifyPersonalMessageSignature).not.toHaveBeenCalled()
  })

  it('rejects oversize address without calling DB', async () => {
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: 'x'.repeat(129),
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'address_mismatch' })
    expect(mockedPrisma.walletChallenge.findUnique).not.toHaveBeenCalled()
  })

  it('rejects with challenge_not_found when no row matches', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(null)
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'challenge_not_found' })
  })

  it('rejects with domain_missing when stored domain is empty', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ domain: '' }))
    const { consumeWalletChallengeForPurpose } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await consumeWalletChallengeForPurpose({
      nonce: NONCE,
      address: NORMALIZED_WALLET,
      purpose: 'login',
      signature: 'sig',
    })
    expect(result).toEqual({ ok: false, reason: 'domain_missing' })
  })
})

describe('issueWalletChallenge writes purpose', () => {
  it('persists purpose=desktop-link with the desktop-link message wording', async () => {
    mockedPrisma.walletChallenge.create.mockResolvedValue({})
    const { issueWalletChallenge } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await issueWalletChallenge(NORMALIZED_WALLET, 'desktop-link')

    expect(mockedPrisma.walletChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        address: NORMALIZED_WALLET,
        purpose: 'desktop-link',
      }),
    })
    expect(result.message).toContain('desktop pet')
    expect(result.message).toContain('Clawnews desktop pet link')
  })

  it('persists purpose=agent-join with the agent registration wording', async () => {
    mockedPrisma.walletChallenge.create.mockResolvedValue({})
    const { issueWalletChallenge } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await issueWalletChallenge(NORMALIZED_WALLET, 'agent-join')
    expect(mockedPrisma.walletChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ purpose: 'agent-join' }),
    })
    expect(result.message).toContain('Clawnews agent registration')
  })

  it('defaults to purpose=login with the login wording', async () => {
    mockedPrisma.walletChallenge.create.mockResolvedValue({})
    const { issueWalletChallenge } = await import('../../web/lib/auth/wallet-challenge.ts')
    const result = await issueWalletChallenge(NORMALIZED_WALLET)
    expect(mockedPrisma.walletChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ purpose: 'login' }),
    })
    expect(result.message).toContain('Clawnews authentication')
  })
})

describe('loginWithWalletSignature regression with login-purpose challenge', () => {
  it('successfully logs in when consume returns ok for purpose=login', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ purpose: 'login' }))
    mockedPrisma.walletChallenge.updateMany.mockResolvedValue({ count: 1 })
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
    expect(mockedPrisma.walletChallenge.updateMany).toHaveBeenCalledWith({
      where: { nonce: NONCE, usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
  })

  it('rejects login when challenge has the wrong purpose (mapped to challenge_not_found)', async () => {
    mockedPrisma.walletChallenge.findUnique.mockResolvedValue(makeChallenge({ purpose: 'desktop-link' }))
    const { loginWithWalletSignature, WalletLoginError } = await import('../../web/lib/auth/wallet-login.ts')
    try {
      await loginWithWalletSignature({
        address: NORMALIZED_WALLET,
        signature: 'sig',
        nonce: NONCE,
      })
      expect.fail('expected WalletLoginError')
    } catch (err) {
      expect(err).toBeInstanceOf(WalletLoginError)
      expect((err as InstanceType<typeof WalletLoginError>).reason).toBe('challenge_not_found')
    }
  })
})
