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
  soulTxSync: {
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

function makeSoulSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'soul-db-1',
    onChainId: soulOnChainId,
    stateOnChainId: `0x${'5'.repeat(64)}`,
    contentOnChainId: `0x${'6'.repeat(64)}`,
    paidAccessListOnChainId: `0x${'7'.repeat(64)}`,
    name: 'Purchased Soul',
    description: 'A purchased Soul',
    imageUrl: '',
    activeSpriteName: null,
    activeSpriteVersionIndex: null,
    activeSpriteDownloadPolicy: null,
    activeVoiceName: null,
    activeVoiceVersionIndex: null,
    activeVoiceDownloadPolicy: null,
    spriteConfigJson: null,
    spriteMoodMapJson: null,
    voiceConfigJson: null,
    provenanceKind: 'native',
    personaKind: 'characters',
    originRef: null,
    tags: [],
    previewImages: [],
    creatorAddress: issuedByAddress,
    creatorRoyaltyBps: 500,
    currentOwnerAddress: granteeAddress,
    currentKioskId: `0x${'8'.repeat(64)}`,
    currentKioskCapOnChainId: `0x${'9'.repeat(64)}`,
    listingObjectOnChainId: null,
    listedPriceAtomic: null,
    listingStatus: 'held',
    collectionOnChainId: null,
    grantCapacity: 1,
    activeGrantCount: 0,
    createdAt: new Date('2026-04-12T00:00:00.000Z'),
    updatedAt: new Date('2026-04-12T00:00:00.000Z'),
    collection: null,
    grantRecords: [],
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
    mockedPrisma.soulTxSync.findMany.mockResolvedValue([])
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
      purchases: [],
    })
  })

  it('returns current member Soul purchase activity from tx sync rows', async () => {
    mockedPrisma.soulTxSync.findMany.mockResolvedValueOnce([
      {
        id: 'tx-sync-1',
        txDigest: 'abc123',
        resourceKey: soulOnChainId,
        responseBody: {
          soulOnChainId,
          paidAtomic: '100000',
          totalAtomic: '107500',
        },
        createdAt: new Date('2026-04-12T00:00:00.000Z'),
      },
    ])
    mockedPrisma.soulAsset.findMany.mockResolvedValueOnce([makeSoulSummary()])

    const { GET } = await import('../../web/app/api/souls/my/route')
    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      purchases: [
        {
          txDigest: 'abc123',
          soulOnChainId,
          soulName: 'Purchased Soul',
          paidAtomic: '100000',
          totalAtomic: '107500',
          createdAt: '2026-04-12T00:00:00.000Z',
        },
      ],
    })
  })

  it('keeps agent access route selector and Seal byte-compare script wired', async () => {
    const routeSource = await import('node:fs').then((fs) =>
      fs.readFileSync('web/app/api/agent/souls/[id]/access/route.ts', 'utf8'),
    )
    const scriptSource = await import('node:fs').then((fs) =>
      fs.readFileSync('web/scripts/e2e-agent-decrypt.ts', 'utf8'),
    )
    const paidAccessScriptSource = await import('node:fs').then((fs) =>
      fs.readFileSync('web/scripts/e2e-paid-access-lifecycle.ts', 'utf8'),
    )

    expect(routeSource).toContain("searchParams.get('kind')")
    expect(routeSource).toContain('version.kind === selector.kind')
    expect(scriptSource).toContain('CONTENT_KIND')
    expect(scriptSource).toContain('OK byte compare')
    expect(paidAccessScriptSource).toContain("@mysten/sui/jsonRpc")
    expect(paidAccessScriptSource).toContain('new SuiJsonRpcClient')
  })
})
