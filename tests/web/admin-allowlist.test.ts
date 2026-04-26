import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS
const ORIGINAL_ADMIN_WALLET_ADDRESSES = process.env.ADMIN_WALLET_ADDRESSES

const SAMPLE_ADMIN_ADDRESS =
  '0x0000000000000000000000000000000000000000000000000000000000000001'
const NORMALIZED_ADMIN_ADDRESS = SAMPLE_ADMIN_ADDRESS

describe('admin allowlist', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (ORIGINAL_ADMIN_EMAILS === undefined) delete process.env.ADMIN_EMAILS
    else process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS
    if (ORIGINAL_ADMIN_WALLET_ADDRESSES === undefined) {
      delete process.env.ADMIN_WALLET_ADDRESSES
    } else {
      process.env.ADMIN_WALLET_ADDRESSES = ORIGINAL_ADMIN_WALLET_ADDRESSES
    }
  })

  it('reports the allowlist as configured when only wallet addresses are set', async () => {
    delete process.env.ADMIN_EMAILS
    process.env.ADMIN_WALLET_ADDRESSES = SAMPLE_ADMIN_ADDRESS

    const { adminAllowlistConfigured, isAdminIdentity } = await import(
      '../../web/lib/auth/admin-allowlist.ts'
    )

    expect(adminAllowlistConfigured()).toBe(true)
    expect(isAdminIdentity({ walletAddress: NORMALIZED_ADMIN_ADDRESS })).toBe(true)
  })

  it('matches wallet addresses regardless of canonical-form variations', async () => {
    delete process.env.ADMIN_EMAILS
    process.env.ADMIN_WALLET_ADDRESSES = '  0x1  '

    const { isAdminIdentity } = await import(
      '../../web/lib/auth/admin-allowlist.ts'
    )

    expect(isAdminIdentity({ walletAddress: NORMALIZED_ADMIN_ADDRESS })).toBe(true)
    expect(isAdminIdentity({ walletAddress: '0x01' })).toBe(true)
  })

  it('rejects callers whose email and wallet are both unmatched', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'
    process.env.ADMIN_WALLET_ADDRESSES = SAMPLE_ADMIN_ADDRESS

    const { isAdminIdentity } = await import(
      '../../web/lib/auth/admin-allowlist.ts'
    )

    expect(
      isAdminIdentity({ email: 'someone@example.com', walletAddress: '0x2' }),
    ).toBe(false)
    expect(isAdminIdentity({ email: null, walletAddress: null })).toBe(false)
  })

  it('reports an empty allowlist when neither env var is set', async () => {
    delete process.env.ADMIN_EMAILS
    delete process.env.ADMIN_WALLET_ADDRESSES

    const { adminAllowlistConfigured, isAdminIdentity } = await import(
      '../../web/lib/auth/admin-allowlist.ts'
    )

    expect(adminAllowlistConfigured()).toBe(false)
    expect(
      isAdminIdentity({ email: 'admin@example.com', walletAddress: '0x1' }),
    ).toBe(false)
  })
})

describe('auth me route wallet-only admin', () => {
  const mockedResolveIdentity = vi.fn()
  const mockedPrisma = {
    member: { findUnique: vi.fn() },
    account: { findUnique: vi.fn() },
  }

  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@web/lib/auth/identity', () => ({
      resolveIdentity: mockedResolveIdentity,
    }))
    vi.doMock('@lib/auth/identity', () => ({
      resolveIdentity: mockedResolveIdentity,
    }))
    vi.doMock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
    vi.doMock('@lib/prisma', () => ({ prisma: mockedPrisma }))
    mockedResolveIdentity.mockReset()
    mockedPrisma.member.findUnique.mockReset()
    mockedPrisma.account.findUnique.mockReset()
    mockedResolveIdentity.mockResolvedValue({
      memberId: 'member-1',
      accountId: 'account-1',
    })
    mockedPrisma.account.findUnique.mockResolvedValue({ email: null })
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      displayName: 'Wallet Admin',
      tgName: null,
      avatar: null,
      level: 1,
      bio: null,
      coverImage: null,
      handle: null,
      twitterUrl: null,
      websiteUrl: null,
      kind: 'human',
      walletBindings: [{ address: NORMALIZED_ADMIN_ADDRESS }],
    })
  })

  afterEach(() => {
    vi.doUnmock('@web/lib/auth/identity')
    vi.doUnmock('@lib/auth/identity')
    vi.doUnmock('@web/lib/prisma')
    vi.doUnmock('@lib/prisma')
    if (ORIGINAL_ADMIN_EMAILS === undefined) delete process.env.ADMIN_EMAILS
    else process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS
    if (ORIGINAL_ADMIN_WALLET_ADDRESSES === undefined) {
      delete process.env.ADMIN_WALLET_ADDRESSES
    } else {
      process.env.ADMIN_WALLET_ADDRESSES = ORIGINAL_ADMIN_WALLET_ADDRESSES
    }
  })

  it('marks isAdmin=true for a wallet-only login that matches ADMIN_WALLET_ADDRESSES', async () => {
    delete process.env.ADMIN_EMAILS
    process.env.ADMIN_WALLET_ADDRESSES = SAMPLE_ADMIN_ADDRESS

    const { GET } = await import('../../web/app/api/auth/me/route.ts')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.user.isAdmin).toBe(true)
    expect(body.user.primarySuiAddress).toBe(NORMALIZED_ADMIN_ADDRESS)
  })

  it('marks isAdmin=false for a wallet-only login when no allowlist matches', async () => {
    delete process.env.ADMIN_EMAILS
    process.env.ADMIN_WALLET_ADDRESSES =
      '0x0000000000000000000000000000000000000000000000000000000000000099'

    const { GET } = await import('../../web/app/api/auth/me/route.ts')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.user.isAdmin).toBe(false)
  })
})
