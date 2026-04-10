import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockPrisma } from '../helpers/mock-prisma.js'

const { prisma: mockedPrisma, store } = createMockPrisma()

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

const mockedPrivy = {
  verifyAuthToken: vi.fn(),
  getUser: vi.fn(),
  createWallets: vi.fn(),
}

vi.mock('@web/lib/auth/privy', () => ({
  privy: mockedPrivy,
}))

// Stub wallet sync to avoid side effects
vi.mock('@web/lib/auth/sui-wallet-sync-cache', () => ({
  getSuiWalletSyncCacheEntry: () => ({ lastAttemptAt: Date.now(), inFlight: null }),
  setSuiWalletSyncCacheEntry: () => {},
  SUI_WALLET_SYNC_IN_FLIGHT_TIMEOUT_MS: 5000,
  SUI_WALLET_SYNC_TTL_MS: 60000,
}))

vi.mock('@web/lib/auth/resolve-agent', () => ({
  resolveAgentByApiKey: vi.fn().mockResolvedValue(null),
}))

vi.mock('@web/lib/request-headers', () => ({
  getRequestHeaders: vi.fn().mockResolvedValue({
    get: (name: string) => {
      if (name === 'authorization') return 'Bearer test-token'
      return null
    },
  }),
}))

vi.mock('@web/lib/rate-limit', () => ({
  getRequestIp: vi.fn().mockReturnValue('127.0.0.1'),
  takeRateLimitToken: vi.fn().mockResolvedValue({ limited: false }),
}))

vi.mock('@web/lib/sui-verify', () => ({
  verifyPersonalMessageSignature: vi.fn(),
}))

vi.mock('@web/lib/auth/challenge', () => ({
  buildChallengeMessage: vi.fn(),
  getTrustedAppDomain: vi.fn(),
  normalizeSuiWalletAddress: (a: string | undefined) => a ?? null,
}))

describe('resolvePrivyIdentity auto-create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.accounts.length = 0
    store.members.length = 0

    mockedPrivy.verifyAuthToken.mockResolvedValue({ userId: 'did:privy:new-user' })
    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'new@example.com', firstVerifiedAt: new Date() },
      telegram: undefined,
      linkedAccounts: [],
    })
  })

  it('auto-creates Account + Member for a new Privy user with no prior data', async () => {
    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.js')

    const identity = await resolvePrivyIdentity('test-token')

    expect(identity).not.toBeNull()
    expect(identity!.kind).toBe('human')
    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0].privyDid).toBe('did:privy:new-user')
    expect(store.accounts[0].email).toBe('new@example.com')
    expect(store.members).toHaveLength(1)
    expect(store.members[0].kind).toBe('human')
    expect(store.members[0].accountId).toBe(store.accounts[0].id)
  })

  it('links pending human Member when Privy tgId matches', async () => {
    store.members.push({
      id: 'pending-member',
      tgId: '999888',
      accountId: null,
      kind: 'human',
      level: 1,
      createdAt: new Date(),
    })

    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'tguser@example.com', firstVerifiedAt: new Date() },
      telegram: { telegramUserId: 999888, username: 'tguser' },
      linkedAccounts: [],
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.js')
    const identity = await resolvePrivyIdentity('test-token')

    expect(identity).not.toBeNull()
    expect(identity!.memberId).toBe('pending-member')
    expect(store.accounts).toHaveLength(1)
    expect(store.accounts[0].tgId).toBe('999888')
    // The pending member should now be linked
    expect(store.members[0].accountId).toBe(store.accounts[0].id)
  })

  it('does not create a second human member when pending member exists', async () => {
    store.members.push({
      id: 'pending-member',
      tgId: '999888',
      accountId: null,
      kind: 'human',
      level: 1,
      createdAt: new Date(),
    })

    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'tguser@example.com', firstVerifiedAt: new Date() },
      telegram: { telegramUserId: 999888, username: 'tguser' },
      linkedAccounts: [],
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.js')
    await resolvePrivyIdentity('test-token')

    const humanMembers = store.members.filter((m: any) => m.kind === 'human')
    expect(humanMembers).toHaveLength(1)
  })

  it('does not link agent members even if tgId matches', async () => {
    store.members.push({
      id: 'agent-member',
      tgId: '999888',
      accountId: 'some-account',
      kind: 'agent',
      level: 1,
      createdAt: new Date(),
    })

    mockedPrivy.getUser.mockResolvedValue({
      email: { address: 'agent@example.com', firstVerifiedAt: new Date() },
      telegram: { telegramUserId: 999888 },
      linkedAccounts: [],
    })

    const { resolvePrivyIdentity } = await import('../../web/lib/auth/identity.js')
    const identity = await resolvePrivyIdentity('test-token')

    expect(identity).not.toBeNull()
    // Should create a NEW human member, not reuse the agent one
    expect(identity!.memberId).not.toBe('agent-member')
    expect(store.accounts.length).toBeGreaterThanOrEqual(1)
    const newHuman = store.members.find((m: any) => m.kind === 'human')
    expect(newHuman).toBeTruthy()
  })
})
