import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedSuiClient = vi.hoisted(() => ({
  getObject: vi.fn(),
}))
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const COUNTERFEIT_PACKAGE_ID = `0x${'8'.repeat(64)}`

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

describe('on-chain verification helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('rejects bigint timestamps that exceed Number.MAX_SAFE_INTEGER', async () => {
    const { dateFromSafeMsBigInt, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    expect(() =>
      dateFromSafeMsBigInt(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'Soul grant_version'),
    ).toThrow(OnChainVerificationError)
  })

  it('rejects soul objects from a counterfeit package', async () => {
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xsoul',
        owner: { AddressOwner: `0x${'1'.repeat(64)}` },
        type: `${COUNTERFEIT_PACKAGE_ID}::soul::Soul`,
        content: {
          dataType: 'moveObject',
          type: `${COUNTERFEIT_PACKAGE_ID}::soul::Soul`,
          fields: {
            creator: `0x${'2'.repeat(64)}`,
            name: 'Soul',
            description: 'Desc',
            image_url: 'https://example.com/soul.png',
            metadata_ref: { vec: [] },
            content_blob: { id: `0x${'3'.repeat(64)}` },
            agent_grant: { vec: [] },
            grant_version: '0',
          },
        },
      },
    })

    const { getVerifiedSoulState, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedSoulState('0xsoul', PACKAGE_ID)).rejects.toThrow(OnChainVerificationError)
  })

  it('reads soul objects and normalizes optional addresses', async () => {
    const canonicalOwner = `0x${'1'.repeat(64)}`
    const canonicalCreator = `0x${'2'.repeat(64)}`
    const canonicalAgent = `0x${'ab'.repeat(32)}`
    const metadataRef = 'walrus://metadata'
    const blobObjectId = `0x${'3'.repeat(64)}`
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xsoul',
        owner: { AddressOwner: canonicalOwner.toUpperCase() },
        type: `${PACKAGE_ID}::soul::Soul`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::soul::Soul`,
          fields: {
            creator: canonicalCreator.toUpperCase(),
            name: 'Soul',
            description: 'Desc',
            image_url: 'https://example.com/soul.png',
            metadata_ref: { vec: [metadataRef] },
            content_blob: { id: blobObjectId },
            agent_grant: { vec: [canonicalAgent.toUpperCase()] },
            grant_version: '2',
          },
        },
      },
    })

    const { getVerifiedSoulState } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedSoulState('0xsoul', PACKAGE_ID)).resolves.toMatchObject({
      objectId: '0xsoul',
      ownerAddress: canonicalOwner,
      creatorAddress: canonicalCreator,
      metadataRef,
      contentBlobObjectId: blobObjectId,
      agentGrant: canonicalAgent,
      grantVersion: 2n,
    })
  })

  it('reads soul access cap objects and their owner address', async () => {
    const ownerAddress = `0x${'4'.repeat(64)}`
    const soulId = `0x${'5'.repeat(64)}`
    const agentAddress = `0x${'6'.repeat(64)}`
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xcap',
        owner: { AddressOwner: ownerAddress },
        type: `${PACKAGE_ID}::grant::SoulAccessCap`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::grant::SoulAccessCap`,
          fields: {
            soul_id: soulId,
            agent: agentAddress,
            grant_version: '7',
          },
        },
      },
    })

    const { getVerifiedSoulAccessCapState } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedSoulAccessCapState('0xcap', PACKAGE_ID)).resolves.toMatchObject({
      objectId: '0xcap',
      ownerAddress,
      soulObjectId: soulId,
      agentAddress,
      grantVersion: 7n,
    })
  })

  it('extracts the listing event payload from a successful market transaction', async () => {
    const { extractSoulListingEvent } = await import('../../web/lib/souls/on-chain-verification.ts')
    const soulObjectId = `0x${'7'.repeat(64)}`
    const kioskObjectId = `0x${'8'.repeat(64)}`

    expect(extractSoulListingEvent({
      events: [{
        type: `${PACKAGE_ID}::market::SoulListed`,
        parsedJson: {
          soul_id: soulObjectId,
          kiosk_id: kioskObjectId,
          seller: `0x${'1'.repeat(64)}`,
          price: '1000',
        },
      }],
    }, PACKAGE_ID)).toEqual({
      soulObjectId,
      sellerKioskId: kioskObjectId,
      sellerAddress: `0x${'1'.repeat(64)}`,
      priceSui: 1000n,
    })
  })
})
