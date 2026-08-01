import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMoveObjectDefiningPackageId: vi.fn(),
  getSoulStateObject: vi.fn(),
  getSoulGrantObject: vi.fn(),
  findActiveGrantSlotForViewer: vi.fn(),
  getSealEnvelopePackageId: vi.fn(),
  resolveSouliditySealPackageRoute: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    soulPaidAccessEntry: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@soulidity/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@soulidity/sdk')>()
  return {
    ...actual,
    getBlobUrl: vi.fn((blobId: string) => `https://walrus.invalid/${blobId}`),
    getMoveObjectDefiningPackageId: mocks.getMoveObjectDefiningPackageId,
    getSoulStateObject: mocks.getSoulStateObject,
    getSoulGrantObject: mocks.getSoulGrantObject,
    findActiveGrantSlotForViewer: mocks.findActiveGrantSlotForViewer,
  }
})

vi.mock('@/lib/services/seal-crypto', () => ({
  getSealEnvelopePackageId: mocks.getSealEnvelopePackageId,
}))

vi.mock('@/lib/services/seal', () => ({
  getSealRuntimeConfig: vi.fn(() => ({
    network: 'mainnet',
    threshold: 2,
    verifyKeyServers: true,
    serverConfigs: [],
  })),
  getSealSessionTtlMinutes: vi.fn(() => 10),
  resolveSouliditySealPackageRoute: mocks.resolveSouliditySealPackageRoute,
}))

import { READ_OWNER, type SoulContentVersionRecord } from '@soulidity/sdk'
import {
  ContentAccessDeniedError,
  resolveContentAccessPayload,
} from '../../web/lib/soulidity/access'

const SOUL_ID = `0x${'11'.repeat(32)}`
const STATE_ID = `0x${'22'.repeat(32)}`
const CONTENT_ID = `0x${'33'.repeat(32)}`
const OWNER = `0x${'44'.repeat(32)}`
const HISTORICAL_ORIGINAL = `0x${'55'.repeat(32)}`
const HISTORICAL_CALLABLE = `0x${'66'.repeat(32)}`
const ACTIVE_ORIGINAL = `0x${'77'.repeat(32)}`
const ACTIVE_CALLABLE = `0x${'88'.repeat(32)}`

const historicalRoute = {
  sealPackageId: HISTORICAL_ORIGINAL,
  callablePackageId: HISTORICAL_CALLABLE,
}

function version(): SoulContentVersionRecord {
  return {
    id: 'version-row',
    soulOnChainId: SOUL_ID,
    contentOnChainId: CONTENT_ID,
    kind: 0,
    kindName: 'soul',
    name: 'soul',
    versionIndex: 0,
    blobObjectId: `0x${'99'.repeat(32)}`,
    blobId: 'blob-id',
    readModeMask: READ_OWNER,
    opMask: 0,
    grantScopeMask: 0,
    isPublic: false,
    sealEncrypted: true,
    downloadPolicy: 'owner_only',
    sealSidecar: {
      version: 1,
      mode: 'seal-envelope',
      sealPackageId: HISTORICAL_ORIGINAL,
      documentId: `0x${'aa'.repeat(49)}`,
      encryptedDek: 'ZW5jcnlwdGVk',
      iv: 'AAAAAAAAAAAAAAAA',
      cipher: 'AES-GCM-256',
      mimeType: 'text/markdown',
      fileName: 'soul.md',
      contentHash: 'b'.repeat(64),
    },
    deletedAt: null,
    purgedAt: null,
    createdAtMs: 1,
    createdAt: new Date(1).toISOString(),
    updatedAt: new Date(1).toISOString(),
  }
}

function state(soulId = SOUL_ID) {
  return {
    objectId: STATE_ID,
    packageId: HISTORICAL_ORIGINAL,
    soulId,
    creatorAddress: OWNER,
    creatorRoyaltyBps: 0,
    currentOwnerAddress: OWNER,
    currentKioskId: `0x${'ab'.repeat(32)}`,
    ownershipEpoch: 0,
    grantCapacity: 1,
    activeGrantCount: 0,
    activeGrants: [],
    contentId: CONTENT_ID,
    paidAccessListId: null,
    collectionId: null,
    isListed: false,
  }
}

describe('historical Soul package-family access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMoveObjectDefiningPackageId.mockResolvedValue(HISTORICAL_ORIGINAL)
    mocks.getSoulStateObject.mockResolvedValue(state())
    mocks.getSealEnvelopePackageId.mockReturnValue(HISTORICAL_ORIGINAL)
    mocks.resolveSouliditySealPackageRoute.mockImplementation((packageId: string) => {
      if (packageId === HISTORICAL_ORIGINAL) return historicalRoute
      if (packageId === ACTIVE_ORIGINAL) {
        return {
          sealPackageId: ACTIVE_ORIGINAL,
          callablePackageId: ACTIVE_CALLABLE,
        }
      }
      throw new Error('Seal namespace is not a trusted Soulidity package family')
    })
  })

  it('derives the object family and routes the Seal approval through that family callable', async () => {
    const payload = await resolveContentAccessPayload({
      soul: {
        onChainId: SOUL_ID,
        stateOnChainId: STATE_ID,
        contentOnChainId: CONTENT_ID,
        paidAccessListOnChainId: null,
      },
      version: version(),
      viewerAddresses: [OWNER],
    })

    expect(mocks.getMoveObjectDefiningPackageId).toHaveBeenCalledWith({
      objectId: STATE_ID,
      moduleName: 'soul',
      structName: 'SoulState',
    })
    expect(mocks.getSoulStateObject).toHaveBeenCalledWith(
      STATE_ID,
      HISTORICAL_ORIGINAL,
      { includeActiveGrants: false },
    )
    expect(payload).toMatchObject({
      visibility: 'sealed',
      accessPolicy: {
        packageId: HISTORICAL_ORIGINAL,
        sealPackageId: HISTORICAL_ORIGINAL,
        callablePackageId: HISTORICAL_CALLABLE,
      },
      sealSidecar: {
        sealPackageId: HISTORICAL_ORIGINAL,
      },
    })
  })

  it('fails closed when ciphertext belongs to another package family', async () => {
    mocks.getSealEnvelopePackageId.mockReturnValue(ACTIVE_ORIGINAL)

    await expect(resolveContentAccessPayload({
      soul: {
        onChainId: SOUL_ID,
        stateOnChainId: STATE_ID,
        contentOnChainId: CONTENT_ID,
        paidAccessListOnChainId: null,
      },
      version: version(),
      viewerAddresses: [OWNER],
    })).rejects.toMatchObject({
      name: 'ContentAccessDeniedError',
      status: 409,
      message: 'Seal envelope namespace does not match the Soul package family',
    } satisfies Partial<ContentAccessDeniedError>)
  })

  it('fails closed when the on-chain SoulState family is not trusted', async () => {
    mocks.getMoveObjectDefiningPackageId.mockResolvedValue(`0x${'ff'.repeat(32)}`)

    await expect(resolveContentAccessPayload({
      soul: {
        onChainId: SOUL_ID,
        stateOnChainId: STATE_ID,
        contentOnChainId: CONTENT_ID,
        paidAccessListOnChainId: null,
      },
      version: version(),
      viewerAddresses: [OWNER],
    })).rejects.toMatchObject({
      name: 'ContentAccessDeniedError',
      status: 409,
      message: 'Seal namespace is not a trusted Soulidity package family',
    } satisfies Partial<ContentAccessDeniedError>)
    expect(mocks.getSoulStateObject).not.toHaveBeenCalled()
  })

  it('fails closed when the mirrored Soul and on-chain SoulState are not linked', async () => {
    mocks.getSoulStateObject.mockResolvedValue(state(`0x${'ee'.repeat(32)}`))

    await expect(resolveContentAccessPayload({
      soul: {
        onChainId: SOUL_ID,
        stateOnChainId: STATE_ID,
        contentOnChainId: CONTENT_ID,
        paidAccessListOnChainId: null,
      },
      version: version(),
      viewerAddresses: [OWNER],
    })).rejects.toMatchObject({
      name: 'ContentAccessDeniedError',
      status: 409,
      message: 'SoulState does not belong to this Soul',
    } satisfies Partial<ContentAccessDeniedError>)
  })
})
