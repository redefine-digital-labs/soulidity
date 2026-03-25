import { beforeEach, describe, expect, it, vi } from 'vitest'

const VALID_SERIES_ID = `0x${'11'.repeat(32)}`
const VALID_RELEASE_ID = `0x${'33'.repeat(32)}`
const VALID_PASS_ID = `0x${'44'.repeat(32)}`
const AGENT_ADDRESS = `0x${'55'.repeat(32)}`
const PACKAGE_ID = `0x${'66'.repeat(32)}`

const mockedPrisma = vi.hoisted(() => ({
  soulSeries: { findFirst: vi.fn() },
  member: { findFirst: vi.fn() },
  soulPassSnapshot: { findFirst: vi.fn(), findMany: vi.fn() },
  soulRelease: { findFirst: vi.fn() },
}))

const mockedRequireAgentApiKey = vi.hoisted(() => vi.fn())
const mockedGetSealSessionPerpetual = vi.hoisted(() => vi.fn())
const mockedGetSealSessionSubscription = vi.hoisted(() => vi.fn())
const mockedGetSealRuntimeConfig = vi.hoisted(() => vi.fn())
const mockedHasCredentialedSealServerConfigs = vi.hoisted(() => vi.fn())
const mockedHasSealSessionConfig = vi.hoisted(() => vi.fn())
const mockedNormalizeWalrusBlobId = vi.hoisted(() => vi.fn())
const mockedGetBlobUrl = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  getObject: vi.fn(),
}))

vi.mock('@web/lib/prisma', () => ({ prisma: mockedPrisma }))
vi.mock('@web/lib/auth/require-agent-api-key', () => ({ requireAgentApiKey: mockedRequireAgentApiKey }))
vi.mock('@web/lib/services/seal', () => ({
  getSealSessionPerpetual: mockedGetSealSessionPerpetual,
  getSealSessionSubscription: mockedGetSealSessionSubscription,
  getSealRuntimeConfig: mockedGetSealRuntimeConfig,
  hasCredentialedSealServerConfigs: mockedHasCredentialedSealServerConfigs,
  hasSealSessionConfig: mockedHasSealSessionConfig,
}))
vi.mock('@web/lib/services/walrus', () => ({
  getBlobUrl: mockedGetBlobUrl,
  normalizeWalrusBlobId: mockedNormalizeWalrusBlobId,
}))
vi.mock('@web/lib/rate-limit', () => ({ takeRateLimitToken: mockedTakeRateLimitToken }))
vi.mock('@web/lib/sui', () => ({ suiClient: mockedSuiClient }))

describe('Soul agent access route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID = PACKAGE_ID

    mockedRequireAgentApiKey.mockResolvedValue({
      agent: { agentMemberId: 'agent-member-1' },
      response: null,
    })
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: VALID_SERIES_ID,
      status: 'active',
      releases: [{
        id: 'release-db-1',
        onChainId: VALID_RELEASE_ID,
        version: '1.0.0',
        walrusBlobRef: 'blob-123',
        contentHash: 'deadbeef',
        sealSidecar: null,
      }],
    })
    mockedPrisma.member.findFirst.mockResolvedValue({
      walletBindings: [{ address: AGENT_ADDRESS }],
    })
    mockedPrisma.soulPassSnapshot.findMany.mockResolvedValue([{
      passType: 'perpetual',
      onChainId: VALID_PASS_ID,
      lockedReleaseId: VALID_RELEASE_ID,
      ownerAddress: AGENT_ADDRESS,
      agentGrant: null,
    }])
    mockedPrisma.soulRelease.findFirst.mockResolvedValue({
      id: 'release-db-1',
      onChainId: VALID_RELEASE_ID,
      version: '1.0.0',
      walrusBlobRef: 'blob-123',
      contentHash: 'deadbeef',
      sealSidecar: null,
    })
    mockedGetSealSessionPerpetual.mockReturnValue({
      packageId: '0xsoul',
      seriesObjectId: VALID_SERIES_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_perpetual',
    })
    mockedGetSealSessionSubscription.mockReturnValue({
      packageId: '0xsoul',
      seriesObjectId: VALID_SERIES_ID,
      moduleName: 'seal_policy',
      functionName: 'seal_approve_subscription',
    })
    mockedGetSealRuntimeConfig.mockReturnValue({
      network: 'testnet',
      threshold: 2,
      verifyKeyServers: true,
      serverConfigs: [{ objectId: '0xkeyserver', weight: 1, aggregatorUrl: 'https://aggregator.internal' }],
    })
    mockedHasCredentialedSealServerConfigs.mockReturnValue(false)
    mockedHasSealSessionConfig.mockReturnValue(true)
    mockedNormalizeWalrusBlobId.mockImplementation((v: string) => v)
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedGetBlobUrl.mockImplementation(
      (blobId: string) => `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`,
    )
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: VALID_PASS_ID,
        type: `${PACKAGE_ID}::pass::PerpetualPass`,
        owner: { AddressOwner: AGENT_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          fields: {
            owner: AGENT_ADDRESS,
            series_id: VALID_SERIES_ID,
            release_id: VALID_RELEASE_ID,
            agent_grant: { vec: [] },
          },
        },
      },
    })
  })

  it('rate limits before doing the heavy read path', async () => {
    mockedTakeRateLimitToken.mockReturnValue({ limited: true, retryAfterSeconds: 120 })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('120')
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('returns artifact + accessPolicy + seal for perpetual releases', async () => {
    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      artifact: {
        walrusBlobRef: 'blob-123',
        walrusBlobUrl: 'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-123',
        contentHash: 'deadbeef',
      },
      accessPolicy: {
        packageId: '0xsoul',
        seriesObjectId: VALID_SERIES_ID,
        moduleName: 'seal_policy',
        functionName: 'seal_approve_perpetual',
        passObjectId: VALID_PASS_ID,
        releaseObjectId: VALID_RELEASE_ID,
        clockObjectId: null,
      },
      seal: {
        network: 'testnet',
        threshold: 2,
        verifyKeyServers: true,
        serverConfigs: [{ objectId: '0xkeyserver', weight: 1 }],
      },
      sealSidecar: null,
      releaseId: VALID_RELEASE_ID,
      version: '1.0.0',
      passType: 'perpetual',
      passOnChainId: VALID_PASS_ID,
    })
  })

  it('fails closed when Seal direct access depends on credentialed key servers', async () => {
    mockedHasCredentialedSealServerConfigs.mockReturnValue(true)

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(503)
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('fails before DB work when Seal session config is missing', async () => {
    mockedHasSealSessionConfig.mockReturnValue(false)

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(503)
    expect(mockedPrisma.soulSeries.findFirst).not.toHaveBeenCalled()
  })

  it('returns 403 when the agent has no active or granted pass for the series', async () => {
    mockedPrisma.soulPassSnapshot.findMany.mockResolvedValue([])

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'No active pass or direct ownership for this Soul',
    })
  })

  it('returns subscription access with clockObjectId', async () => {
    mockedPrisma.soulPassSnapshot.findMany.mockResolvedValue([{
      passType: 'subscription',
      onChainId: VALID_PASS_ID,
      lockedReleaseId: null,
      ownerAddress: AGENT_ADDRESS,
      agentGrant: null,
    }])
    mockedSuiClient.getObject.mockResolvedValueOnce({
      data: {
        objectId: VALID_PASS_ID,
        type: `${PACKAGE_ID}::pass::SubscriptionPass`,
        owner: { AddressOwner: AGENT_ADDRESS },
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::pass::SubscriptionPass`,
          fields: {
            owner: AGENT_ADDRESS,
            series_id: VALID_SERIES_ID,
            expires_at: `${Date.now() + 60_000}`,
            agent_grant: { vec: [] },
          },
        },
      },
    })
    mockedSuiClient.getObject.mockResolvedValueOnce({
      data: {
        objectId: VALID_SERIES_ID,
        type: `${PACKAGE_ID}::series::SoulSeries`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::series::SoulSeries`,
          fields: {
            name: 'Soul',
            description: 'Desc',
            category: 'Research',
            tags: [],
            preview_images: [],
            author: AGENT_ADDRESS,
            latest_release_id: { vec: [VALID_RELEASE_ID] },
          },
        },
      },
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.accessPolicy.functionName).toBe('seal_approve_subscription')
    expect(body.accessPolicy.clockObjectId).toBe('0x6')
    expect(body.passType).toBe('subscription')
  })

  it('fails closed when the DB grant is stale but the on-chain pass no longer grants or owns access', async () => {
    mockedPrisma.soulPassSnapshot.findMany.mockResolvedValue([{
      passType: 'perpetual',
      onChainId: VALID_PASS_ID,
      lockedReleaseId: VALID_RELEASE_ID,
      ownerAddress: `0x${'77'.repeat(32)}`,
      agentGrant: AGENT_ADDRESS,
    }])
    mockedSuiClient.getObject.mockResolvedValueOnce({
      data: {
        objectId: VALID_PASS_ID,
        type: `${PACKAGE_ID}::pass::PerpetualPass`,
        owner: { AddressOwner: `0x${'77'.repeat(32)}` },
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          fields: {
            owner: `0x${'77'.repeat(32)}`,
            series_id: VALID_SERIES_ID,
            release_id: VALID_RELEASE_ID,
            agent_grant: { vec: [] },
          },
        },
      },
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'No active pass or direct ownership for this Soul',
    })
  })

  it('normalizes 0x-prefixed contentHash', async () => {
    mockedPrisma.soulSeries.findFirst.mockResolvedValue({
      id: 'series-db-1',
      onChainId: VALID_SERIES_ID,
      status: 'active',
      releases: [{
        id: 'release-db-1',
        onChainId: VALID_RELEASE_ID,
        version: '1.0.0',
        walrusBlobRef: 'blob-123',
        contentHash: '0xDEADBEEF',
        sealSidecar: null,
      }],
    })
    mockedPrisma.soulRelease.findFirst.mockResolvedValue({
      id: 'release-db-1',
      onChainId: VALID_RELEASE_ID,
      version: '1.0.0',
      walrusBlobRef: 'blob-123',
      contentHash: '0xDEADBEEF',
      sealSidecar: null,
    })

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(200)
  })

  it('keeps scanning candidate passes beyond the first 10 snapshots before denying access', async () => {
    const stalePasses = Array.from({ length: 10 }, (_, index) => ({
      passType: 'perpetual',
      onChainId: `0x${String(index + 10).padStart(64, '9')}`,
      lockedReleaseId: VALID_RELEASE_ID,
      ownerAddress: `0x${'77'.repeat(32)}`,
      agentGrant: null,
    }))
    const validPass = {
      passType: 'perpetual',
      onChainId: `0x${'88'.repeat(32)}`,
      lockedReleaseId: VALID_RELEASE_ID,
      ownerAddress: AGENT_ADDRESS,
      agentGrant: null,
    }

    mockedPrisma.soulPassSnapshot.findMany.mockResolvedValueOnce([...stalePasses, validPass])
    mockedSuiClient.getObject
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[0].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[1].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[2].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[3].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[4].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[5].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[6].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[7].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[8].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: stalePasses[9].onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: `0x${'77'.repeat(32)}` },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: `0x${'77'.repeat(32)}`,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          objectId: validPass.onChainId,
          type: `${PACKAGE_ID}::pass::PerpetualPass`,
          owner: { AddressOwner: AGENT_ADDRESS },
          content: {
            dataType: 'moveObject',
            type: `${PACKAGE_ID}::pass::PerpetualPass`,
            fields: {
              owner: AGENT_ADDRESS,
              series_id: VALID_SERIES_ID,
              release_id: VALID_RELEASE_ID,
              agent_grant: { vec: [] },
            },
          },
        },
      }))

    const { GET } = await import('../../web/app/api/agent/souls/[id]/access/route.ts')
    const response = await GET(
      new Request(`http://localhost/api/agent/souls/${VALID_SERIES_ID}/access`) as any,
      { params: Promise.resolve({ id: VALID_SERIES_ID }) },
    )

    expect(response.status).toBe(200)
    expect(mockedPrisma.soulPassSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.any(Object),
      orderBy: expect.any(Array),
    }))
    const findManyArgs = mockedPrisma.soulPassSnapshot.findMany.mock.calls[0]?.[0]
    expect(findManyArgs).not.toHaveProperty('take')
  })
})
