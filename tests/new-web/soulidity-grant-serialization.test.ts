import { beforeEach, describe, expect, it, vi } from 'vitest'

const issuedByAddress = `0x${'1'.repeat(64)}`
const granteeAddress = `0x${'2'.repeat(64)}`
const soulOnChainId = `0x${'3'.repeat(64)}`
const grantOnChainId = `0x${'4'.repeat(64)}`

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberSuiWalletAddresses = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  soulAsset: {
    findMany: vi.fn(),
  },
  soulCollectionAsset: {
    findMany: vi.fn(),
  },
  soulGrantRecord: {
    findMany: vi.fn(),
  },
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberSuiWalletAddresses: mockedGetMemberSuiWalletAddresses,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

function makeGrantRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-db-1',
    onChainId: grantOnChainId,
    soulOnChainId,
    issuedByAddress,
    issuedByMemberId: 'issuer-1',
    granteeAddress,
    granteeMemberId: 'grantee-1',
    scopes: ['assets'],
    status: 'active',
    expiresAt: null,
    endedAt: null,
    replacedByGrantOnChainId: null,
    createdAt: new Date('2026-04-11T00:00:00.000Z'),
    updatedAt: new Date('2026-04-11T00:00:00.000Z'),
    ...overrides,
  } as any
}

describe('Soul grant serialization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1' },
    })
    mockedGetMemberSuiWalletAddresses.mockResolvedValue([])
    mockedPrisma.soulAsset.findMany.mockResolvedValue([])
    mockedPrisma.soulCollectionAsset.findMany.mockResolvedValue([])
    mockedPrisma.soulGrantRecord.findMany.mockResolvedValue([makeGrantRecord()])
  })

  it('preserves the assets scope in repository grant records', async () => {
    const { toSoulGrantRecord } = await import('../../web/lib/soulidity/repository')

    expect(toSoulGrantRecord(makeGrantRecord()).scopes).toEqual(['assets'])
  })

  it('returns the assets scope from GET /api/souls/my', async () => {
    const { GET } = await import('../../web/app/api/souls/my/route')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      grants: [
        expect.objectContaining({
          onChainId: grantOnChainId,
          scopes: ['assets'],
        }),
      ],
    })
  })
})
