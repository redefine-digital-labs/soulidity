import { beforeEach, describe, expect, it, vi } from 'vitest'

const AUTHOR_ADDRESS = `0x${'a'.repeat(64)}`
const SERIES_ID = `0x${'1'.repeat(64)}`
const RELEASE_ID = `0x${'2'.repeat(64)}`
const ONETIME_PLAN_ID = `0x${'3'.repeat(64)}`
const SUB_PLAN_ID = `0x${'4'.repeat(64)}`
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const COUNTERFEIT_PACKAGE_ID = `0x${'8'.repeat(64)}`
const PUBLISH_TX_DIGEST = 'FruqTGvpFsoobpBYWWgTgpsQ8S6v2zkCm8fn1Y5cppSN'
const RELEASE_TX_DIGEST = '8iEEVkAMZirnQxfXn9gtK4bdsd5sBB6pJ2yP5wJxC7ux'
const ONETIME_PLAN_TX_DIGEST = '3PvcMdm21RaeePjxCgqcvK4VDm2G9y8zJG33fPYWS9n7'
const SUB_PLAN_TX_DIGEST = 'DV9VuHnbUJNAGsEZe5BFTBx3LU53u13MKx7FvgwYdAYc'

const mockedRequireIdentity = vi.hoisted(() => vi.fn())
const mockedGetMemberPrimarySuiWalletAddress = vi.hoisted(() => vi.fn())
const mockedTakeRateLimitToken = vi.hoisted(() => vi.fn())
const mockedPrisma = vi.hoisted(() => ({
  member: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
const mockedDbCreateSeries = vi.hoisted(() => vi.fn())
const mockedDbCreateRelease = vi.hoisted(() => vi.fn())
const mockedDbUpdatePricingPlan = vi.hoisted(() => vi.fn())
const mockedCreateAndStoreReleaseSealSidecar = vi.hoisted(() => vi.fn())
const mockedGetStoredSoulTxSync = vi.hoisted(() => vi.fn())
const mockedStoreSoulTxSync = vi.hoisted(() => vi.fn())
const mockedSuiClient = vi.hoisted(() => ({
  getTransactionBlock: vi.fn(),
  getObject: vi.fn(),
}))

vi.mock('@web/lib/auth/identity', () => ({
  requireIdentity: mockedRequireIdentity,
}))

vi.mock('@web/lib/auth/sui-wallet', () => ({
  getMemberPrimarySuiWalletAddress: mockedGetMemberPrimarySuiWalletAddress,
}))

vi.mock('@web/lib/rate-limit', () => ({
  takeRateLimitToken: mockedTakeRateLimitToken,
}))

vi.mock('@web/lib/prisma', () => ({
  prisma: mockedPrisma,
}))

vi.mock('@web/lib/souls/post-tx-db', () => ({
  dbCreateSeries: mockedDbCreateSeries,
  dbCreateRelease: mockedDbCreateRelease,
  dbUpdatePricingPlan: mockedDbUpdatePricingPlan,
}))

vi.mock('@web/lib/souls/release-seal-sidecar', () => ({
  createAndStoreReleaseSealSidecar: mockedCreateAndStoreReleaseSealSidecar,
}))

vi.mock('@web/lib/souls/tx-sync', () => ({
  getStoredSoulTxSync: mockedGetStoredSoulTxSync,
  storeSoulTxSync: mockedStoreSoulTxSync,
}))

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

vi.mock('@web/lib/services/seal', () => ({
  getSealRuntimeConfig: vi.fn().mockReturnValue({ threshold: 1 }),
  createSealClient: vi.fn().mockReturnValue({ encrypt: vi.fn() }),
}))

describe('soul publish route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID = PACKAGE_ID

    mockedRequireIdentity.mockResolvedValue({
      error: null,
      identity: { memberId: 'member-1', kind: 'human' },
    })
    mockedGetMemberPrimarySuiWalletAddress.mockResolvedValue(AUTHOR_ADDRESS)
    mockedTakeRateLimitToken.mockReturnValue({ limited: false, retryAfterSeconds: 60 })
    mockedPrisma.member.findUnique.mockResolvedValue({
      id: 'member-1',
      wallet: AUTHOR_ADDRESS,
      walletBindings: [{ address: AUTHOR_ADDRESS, chain: 'sui' }],
    })
    mockedPrisma.$transaction.mockImplementation(async (callback: (tx: Record<string, never>) => Promise<unknown>) => callback({}))
    mockedSuiClient.getTransactionBlock.mockImplementation(async ({ digest }: { digest: string }) => {
      if (digest === PUBLISH_TX_DIGEST) {
        return {
          digest,
          effects: { status: { status: 'success' } },
          objectChanges: [
            {
              type: 'created',
              objectId: SERIES_ID,
              objectType: `${PACKAGE_ID}::series::SoulSeries`,
              sender: AUTHOR_ADDRESS,
              owner: { AddressOwner: AUTHOR_ADDRESS },
            },
          ],
          transaction: { data: { sender: AUTHOR_ADDRESS } },
        }
      }

      if (digest === RELEASE_TX_DIGEST) {
        return {
          digest,
          effects: { status: { status: 'success' } },
          objectChanges: [
            {
              type: 'created',
              objectId: RELEASE_ID,
              objectType: `${PACKAGE_ID}::series::SoulRelease`,
              sender: AUTHOR_ADDRESS,
              owner: { AddressOwner: AUTHOR_ADDRESS },
            },
          ],
          transaction: { data: { sender: AUTHOR_ADDRESS } },
        }
      }

      if (digest === ONETIME_PLAN_TX_DIGEST) {
        return {
          digest,
          effects: { status: { status: 'success' } },
          objectChanges: [
            {
              type: 'created',
              objectId: ONETIME_PLAN_ID,
              objectType: `${PACKAGE_ID}::purchase::PricingPlan`,
              sender: AUTHOR_ADDRESS,
              owner: { AddressOwner: AUTHOR_ADDRESS },
            },
          ],
          transaction: { data: { sender: AUTHOR_ADDRESS } },
        }
      }

      if (digest === SUB_PLAN_TX_DIGEST) {
        return {
          digest,
          effects: { status: { status: 'success' } },
          objectChanges: [
            {
              type: 'created',
              objectId: SUB_PLAN_ID,
              objectType: `${PACKAGE_ID}::purchase::PricingPlan`,
              sender: AUTHOR_ADDRESS,
              owner: { AddressOwner: AUTHOR_ADDRESS },
            },
          ],
          transaction: { data: { sender: AUTHOR_ADDRESS } },
        }
      }

      return {
        digest,
        effects: { status: { status: 'success' } },
        objectChanges: [],
        transaction: { data: { sender: AUTHOR_ADDRESS } },
      }
    })
    mockedSuiClient.getObject.mockImplementation(async ({ id }: { id: string }) => {
      if (id === SERIES_ID) {
        return {
          data: {
            objectId: SERIES_ID,
            type: `${PACKAGE_ID}::series::SoulSeries`,
            content: {
              dataType: 'moveObject',
              type: `${PACKAGE_ID}::series::SoulSeries`,
              fields: {
                name: 'On-chain Name',
                description: 'On-chain Description',
                category: 'Research',
                tags: ['alpha', 'beta'],
                preview_images: ['blob-1', 'blob-2'],
                author: AUTHOR_ADDRESS,
              },
            },
          },
        }
      }

      if (id === RELEASE_ID) {
        return {
          data: {
            objectId: RELEASE_ID,
            type: `${PACKAGE_ID}::series::SoulRelease`,
            content: {
              dataType: 'moveObject',
              type: `${PACKAGE_ID}::series::SoulRelease`,
              fields: {
                series_id: SERIES_ID,
                version: '2.0.0',
                encrypted_blob_id: 'blob-from-chain',
                public_metadata_id: 'public-sidecar',
                content_hash: [0xde, 0xad, 0xbe, 0xef],
              },
            },
          },
        }
      }

      if (id === ONETIME_PLAN_ID) {
        return {
          data: {
            objectId: ONETIME_PLAN_ID,
            type: `${PACKAGE_ID}::purchase::PricingPlan`,
            content: {
              dataType: 'moveObject',
              type: `${PACKAGE_ID}::purchase::PricingPlan`,
              fields: {
                series_id: SERIES_ID,
                plan_type: 0,
                price_usdc: '2500000',
                period_ms: '0',
                active: true,
              },
            },
          },
        }
      }

      if (id === SUB_PLAN_ID) {
        return {
          data: {
            objectId: SUB_PLAN_ID,
            type: `${PACKAGE_ID}::purchase::PricingPlan`,
            content: {
              dataType: 'moveObject',
              type: `${PACKAGE_ID}::purchase::PricingPlan`,
              fields: {
                series_id: SERIES_ID,
                plan_type: 1,
                price_usdc: '9990000',
                period_ms: '2592000000',
                active: true,
              },
            },
          },
        }
      }

      return { data: null }
    })
    mockedDbCreateSeries.mockResolvedValue({
      id: 'series-db-1',
      name: 'On-chain Name',
      onChainId: SERIES_ID,
    })
    mockedDbCreateRelease.mockResolvedValue({
      id: 'release-db-1',
      onChainId: RELEASE_ID,
      version: '2.0.0',
    })
    mockedDbUpdatePricingPlan.mockResolvedValue(undefined)
    mockedGetStoredSoulTxSync.mockResolvedValue(null)
    mockedStoreSoulTxSync.mockResolvedValue(undefined)
    mockedCreateAndStoreReleaseSealSidecar.mockResolvedValue({
      version: 1,
      mode: 'seal-envelope',
      documentId: `0x${'b'.repeat(66)}`,
      encryptedDek: 'ZW5j',
      iv: 'aXY=',
      cipher: 'AES-GCM-256',
      mimeType: 'application/octet-stream',
      fileName: 'bundle.zip',
      contentHash: 'deadbeef',
    })
  })

  it('requires txDigest for durable publish idempotency', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seriesOnChainId: SERIES_ID }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'txDigest must be a valid transaction digest',
    })
    expect(mockedSuiClient.getObject).not.toHaveBeenCalled()
  })

  it('returns 503 when the soul package id env is missing before on-chain verification', async () => {
    delete process.env.NEXT_PUBLIC_SOUL_PACKAGE_ID

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
        }),
      }) as any,
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Service temporarily unavailable',
    })
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
  })

  it('returns structured 500 JSON when publish mirroring hits an unexpected sync error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedSuiClient.getTransactionBlock.mockRejectedValueOnce(new Error('rpc down'))

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
        }),
      }) as any,
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Sync failed',
    })
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('rejects mirroring a series whose on-chain author does not match the authenticated wallet', async () => {
    mockedSuiClient.getObject.mockImplementationOnce(async () => ({
      data: {
        objectId: SERIES_ID,
        type: `${PACKAGE_ID}::series::SoulSeries`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::series::SoulSeries`,
          fields: {
            name: 'Other Series',
            description: 'Other Description',
            category: 'Research',
            tags: [],
            preview_images: [],
            author: `0x${'b'.repeat(64)}`,
          },
        },
      },
    }))

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          seriesOnChainId: SERIES_ID,
          txDigest: PUBLISH_TX_DIGEST,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
        }),
      }) as any,
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'On-chain series author does not match the authenticated wallet',
    })
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
  })

  it('rejects oversized readme payloads before on-chain verification', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          readme: 'x'.repeat(50_001),
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'readme must be 50,000 characters or fewer',
    })
    expect(mockedSuiClient.getObject).not.toHaveBeenCalled()
  })

  it('requires at least one pricing plan before any on-chain verification work starts', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'At least one pricing plan must be provided',
    })
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
  })

  it('rejects release mirroring without sealDekEnvelope before any verification or caching work', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          releaseOnChainId: RELEASE_ID,
          releaseTxDigest: RELEASE_TX_DIGEST,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'sealDekEnvelope is required when releaseOnChainId is provided',
    })
    expect(mockedGetStoredSoulTxSync).not.toHaveBeenCalled()
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
    expect(mockedStoreSoulTxSync).not.toHaveBeenCalled()
  })

  it('rejects release mirroring when releaseOnChainId is provided without releaseTxDigest', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          releaseOnChainId: RELEASE_ID,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
        }),
      }) as any,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'releaseTxDigest is required when releaseOnChainId is provided',
    })
    expect(mockedGetStoredSoulTxSync).not.toHaveBeenCalled()
    expect(mockedSuiClient.getTransactionBlock).not.toHaveBeenCalled()
    expect(mockedSuiClient.getObject).not.toHaveBeenCalled()
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
    expect(mockedStoreSoulTxSync).not.toHaveBeenCalled()
  })

  it('rejects release mirrors whose submitted publish tx did not create the release object', async () => {
    mockedSuiClient.getTransactionBlock.mockImplementation(async ({ digest }: { digest: string }) => {
      if (digest === RELEASE_TX_DIGEST) {
        return {
          digest,
          effects: { status: { status: 'success' } },
          objectChanges: [],
          transaction: { data: { sender: AUTHOR_ADDRESS } },
        }
      }

      if (digest === PUBLISH_TX_DIGEST) {
        return {
          digest,
          effects: { status: { status: 'success' } },
          objectChanges: [
            {
              type: 'created',
              objectId: SERIES_ID,
              objectType: `${PACKAGE_ID}::series::SoulSeries`,
              sender: AUTHOR_ADDRESS,
              owner: { AddressOwner: AUTHOR_ADDRESS },
            },
          ],
          transaction: { data: { sender: AUTHOR_ADDRESS } },
        }
      }

      if (digest === ONETIME_PLAN_TX_DIGEST) {
        return {
          digest,
          effects: { status: { status: 'success' } },
          objectChanges: [
            {
              type: 'created',
              objectId: ONETIME_PLAN_ID,
              objectType: `${PACKAGE_ID}::purchase::PricingPlan`,
              sender: AUTHOR_ADDRESS,
              owner: { AddressOwner: AUTHOR_ADDRESS },
            },
          ],
          transaction: { data: { sender: AUTHOR_ADDRESS } },
        }
      }

      if (digest === SUB_PLAN_TX_DIGEST) {
        return {
          digest,
          effects: { status: { status: 'success' } },
          objectChanges: [
            {
              type: 'created',
              objectId: SUB_PLAN_ID,
              objectType: `${PACKAGE_ID}::purchase::PricingPlan`,
              sender: AUTHOR_ADDRESS,
              owner: { AddressOwner: AUTHOR_ADDRESS },
            },
          ],
          transaction: { data: { sender: AUTHOR_ADDRESS } },
        }
      }

      return {
        digest,
        effects: { status: { status: 'success' } },
        objectChanges: [],
        transaction: { data: { sender: AUTHOR_ADDRESS } },
      }
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          releaseOnChainId: RELEASE_ID,
          releaseTxDigest: RELEASE_TX_DIGEST,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
          sealDekEnvelope: 'mock-envelope',
        }),
      }) as any,
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction did not create the submitted Soul release',
    })
    expect(mockedDbCreateRelease).not.toHaveBeenCalled()
  })

  it('rejects publish tx object changes from a counterfeit package id', async () => {
    mockedSuiClient.getTransactionBlock.mockImplementationOnce(async ({ digest }: { digest: string }) => {
      expect(digest).toBe(PUBLISH_TX_DIGEST)
      return {
        digest,
        effects: { status: { status: 'success' } },
        objectChanges: [
          {
            type: 'created',
            objectId: SERIES_ID,
            objectType: `${COUNTERFEIT_PACKAGE_ID}::series::SoulSeries`,
            sender: AUTHOR_ADDRESS,
            owner: { AddressOwner: AUTHOR_ADDRESS },
          },
        ],
        transaction: { data: { sender: AUTHOR_ADDRESS } },
      }
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
        }),
      }) as any,
    )

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'Transaction did not create the submitted Soul series',
    })
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
  })

  it('rate limits publish mirroring before on-chain verification work starts', async () => {
    mockedTakeRateLimitToken.mockReturnValue({ limited: true, retryAfterSeconds: 300 })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seriesOnChainId: SERIES_ID, txDigest: PUBLISH_TX_DIGEST }),
      }) as any,
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('300')
    expect(mockedSuiClient.getObject).not.toHaveBeenCalled()
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
  })

  it('replays the stored publish response for an already-processed txDigest', async () => {
    mockedGetStoredSoulTxSync.mockResolvedValue({
      statusCode: 201,
      body: {
        id: 'series-db-cached',
        name: 'Cached Soul',
        onChainId: SERIES_ID,
        releaseId: null,
      },
    })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seriesOnChainId: SERIES_ID, txDigest: PUBLISH_TX_DIGEST }),
      }) as any,
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      id: 'series-db-cached',
      name: 'Cached Soul',
      onChainId: SERIES_ID,
      releaseId: null,
    })
    expect(mockedGetStoredSoulTxSync).toHaveBeenCalledWith({
      txDigest: PUBLISH_TX_DIGEST,
      routeKey: 'publish',
      actorKey: 'member-1',
      resourceKey: SERIES_ID,
    })
    expect(mockedSuiClient.getObject).not.toHaveBeenCalled()
    expect(mockedDbCreateSeries).not.toHaveBeenCalled()
  })

  it('derives mirrored series, release, and pricing data from chain objects instead of request JSON', async () => {
    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const response = await POST(
      new Request('http://localhost/api/souls/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          releaseOnChainId: RELEASE_ID,
          releaseTxDigest: RELEASE_TX_DIGEST,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
          subPlanOnChainId: SUB_PLAN_ID,
          subPlanTxDigest: SUB_PLAN_TX_DIGEST,
          readme: 'off-chain readme is still allowed',
          sealDekEnvelope: 'mock-envelope',
        }),
      }) as any,
    )

    expect(response.status).toBe(201)
    expect(mockedDbCreateSeries).toHaveBeenCalledWith(expect.objectContaining({
      seriesOnChainId: SERIES_ID,
      authorAddress: AUTHOR_ADDRESS,
      authorMemberId: 'member-1',
      name: 'On-chain Name',
      description: 'On-chain Description',
      category: 'Research',
      tags: ['alpha', 'beta'],
      previewImages: ['blob-1', 'blob-2'],
      readme: 'off-chain readme is still allowed',
    }))
    expect(mockedDbCreateRelease).toHaveBeenCalledWith(expect.objectContaining({
      releaseOnChainId: RELEASE_ID,
      seriesDbId: 'series-db-1',
      version: '2.0.0',
      walrusBlobRef: 'blob-from-chain',
      publicMetadataRef: 'public-sidecar',
      contentHash: 'deadbeef',
    }))
    expect(mockedDbUpdatePricingPlan).toHaveBeenNthCalledWith(1, expect.objectContaining({
      seriesOnChainId: SERIES_ID,
      planType: 'onetime',
      planOnChainId: ONETIME_PLAN_ID,
      priceUsdc: 2500000n,
    }))
    expect(mockedDbUpdatePricingPlan).toHaveBeenNthCalledWith(2, expect.objectContaining({
      seriesOnChainId: SERIES_ID,
      planType: 'subscription',
      planOnChainId: SUB_PLAN_ID,
      priceUsdc: 9990000n,
      periodMs: 2592000000n,
    }))
    expect(mockedStoreSoulTxSync).toHaveBeenCalledWith({
      db: expect.any(Object),
      txDigest: PUBLISH_TX_DIGEST,
      routeKey: 'publish',
      actorKey: 'member-1',
      resourceKey: SERIES_ID,
      statusCode: 201,
      body: {
        id: 'series-db-1',
        name: 'On-chain Name',
        onChainId: SERIES_ID,
        releaseId: 'release-db-1',
      },
    })
    expect(mockedGetMemberPrimarySuiWalletAddress).toHaveBeenCalledWith('member-1')
  })

  it('returns 503 and leaves the publish txDigest retryable when Seal sidecar generation fails', async () => {
    mockedCreateAndStoreReleaseSealSidecar
      .mockRejectedValueOnce(new Error('seal unavailable'))
      .mockResolvedValueOnce({
        version: 1,
        mode: 'seal-envelope',
        documentId: `0x${'b'.repeat(66)}`,
        encryptedDek: 'ZW5j',
        iv: 'aXY=',
        cipher: 'AES-GCM-256',
        mimeType: 'application/octet-stream',
        fileName: 'bundle.zip',
        contentHash: 'deadbeef',
      })

    const { POST } = await import('../../web/app/api/souls/publish/route.ts')
    const request = () => new Request('http://localhost/api/souls/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          txDigest: PUBLISH_TX_DIGEST,
          seriesOnChainId: SERIES_ID,
          releaseOnChainId: RELEASE_ID,
          releaseTxDigest: RELEASE_TX_DIGEST,
          oneTimePlanOnChainId: ONETIME_PLAN_ID,
          oneTimePlanTxDigest: ONETIME_PLAN_TX_DIGEST,
          sealDekEnvelope: 'mock-envelope',
      }),
    }) as any

    const firstResponse = await POST(request())
    expect(firstResponse.status).toBe(503)
    await expect(firstResponse.json()).resolves.toEqual({
      error: 'Release mirrored locally, but Seal sidecar generation failed. Retry publish sync.',
    })
    expect(mockedStoreSoulTxSync).not.toHaveBeenCalled()

    const secondResponse = await POST(request())
    expect(secondResponse.status).toBe(201)
    await expect(secondResponse.json()).resolves.toMatchObject({
      id: 'series-db-1',
      name: 'On-chain Name',
      onChainId: SERIES_ID,
      releaseId: 'release-db-1',
    })
    expect(mockedDbCreateSeries).toHaveBeenCalledTimes(2)
    expect(mockedDbCreateRelease).toHaveBeenCalledTimes(2)
    expect(mockedStoreSoulTxSync).toHaveBeenCalledTimes(1)
  })
})
