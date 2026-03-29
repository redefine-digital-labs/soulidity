import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockedSuiClient = vi.hoisted(() => ({
  getObject: vi.fn(),
}))
const mockedGetVendoredKioskPackageAddress = vi.hoisted(() => vi.fn())
const PACKAGE_ID = `0x${'9'.repeat(64)}`
const COUNTERFEIT_PACKAGE_ID = `0x${'8'.repeat(64)}`
const KIOSK_PACKAGE_ID = `0x${'7'.repeat(64)}`

vi.mock('@web/lib/sui', () => ({
  suiClient: mockedSuiClient,
}))

vi.mock('@web/lib/souls/kiosk-package', () => ({
  getVendoredKioskPackageAddress: mockedGetVendoredKioskPackageAddress,
}))

describe('on-chain verification helpers', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
    mockedGetVendoredKioskPackageAddress.mockReturnValue(KIOSK_PACKAGE_ID)
  })

  it('rejects bigint timestamps that exceed Number.MAX_SAFE_INTEGER', async () => {
    const { dateFromSafeMsBigInt, OnChainVerificationError } = await import('../../web/lib/souls/on-chain-verification.ts')

    expect(() =>
      dateFromSafeMsBigInt(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'Soul allowlist_version'),
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
            allowlist_address: { vec: [] },
            allowlist_version: '0',
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
    const canonicalAllowlisted = `0x${'ab'.repeat(32)}`
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
            creator_royalty_bps: '250',
            name: 'Soul',
            description: 'Desc',
            image_url: 'https://example.com/soul.png',
            metadata_ref: { vec: [metadataRef] },
            content_blob: { id: blobObjectId },
            allowlist_address: { vec: [canonicalAllowlisted.toUpperCase()] },
            allowlist_version: '2',
          },
        },
      },
    })

    const { getVerifiedSoulState } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedSoulState('0xsoul', PACKAGE_ID)).resolves.toMatchObject({
      objectId: '0xsoul',
      ownerAddress: canonicalOwner,
      creatorAddress: canonicalCreator,
      creatorRoyaltyBps: 250,
      metadataRef,
      contentBlobObjectId: blobObjectId,
      allowlistAddress: canonicalAllowlisted,
      allowlistVersion: 2n,
    })
  })

  it('reads soul access cap objects and their owner address', async () => {
    const ownerAddress = `0x${'4'.repeat(64)}`
    const soulId = `0x${'5'.repeat(64)}`
    const allowlistedAddress = `0x${'6'.repeat(64)}`
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xcap',
        owner: { AddressOwner: ownerAddress },
        type: `${PACKAGE_ID}::allowlist::SoulAllowlistCap`,
        content: {
          dataType: 'moveObject',
          type: `${PACKAGE_ID}::allowlist::SoulAllowlistCap`,
          fields: {
            soul_id: soulId,
            allowlisted: allowlistedAddress,
            allowlist_version: '7',
          },
        },
      },
    })

    const { getVerifiedSoulAllowlistCapState } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedSoulAllowlistCapState('0xcap', PACKAGE_ID)).resolves.toMatchObject({
      objectId: '0xcap',
      ownerAddress,
      soulObjectId: soulId,
      allowlistedAddress,
      allowlistVersion: 7n,
    })
  })

  it('reads personal kiosk cap objects using the vendored kiosk package address', async () => {
    const ownerAddress = `0x${'4'.repeat(64)}`
    const kioskId = `0x${'5'.repeat(64)}`
    mockedSuiClient.getObject.mockResolvedValue({
      data: {
        objectId: '0xkioskcap',
        owner: { AddressOwner: ownerAddress },
        type: `${KIOSK_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
        content: {
          dataType: 'moveObject',
          type: `${KIOSK_PACKAGE_ID}::personal_kiosk::PersonalKioskCap`,
          fields: {
            cap: {
              fields: {
                for: kioskId,
              },
            },
          },
        },
      },
    })

    const { getVerifiedPersonalKioskCapState } = await import('../../web/lib/souls/on-chain-verification.ts')

    await expect(getVerifiedPersonalKioskCapState('0xkioskcap')).resolves.toMatchObject({
      objectId: '0xkioskcap',
      ownerAddress,
      kioskId,
    })
    expect(mockedGetVendoredKioskPackageAddress).toHaveBeenCalledTimes(1)
  })

  it('extracts the listing event payload from a successful market transaction', async () => {
    const { extractSoulListingEvent } = await import('../../web/lib/souls/on-chain-verification.ts')
    const listingObjectId = `0x${'9'.repeat(64)}`
    const soulObjectId = `0x${'7'.repeat(64)}`
    const kioskObjectId = `0x${'8'.repeat(64)}`
    const kioskCapObjectId = `0x${'6'.repeat(64)}`

    expect(extractSoulListingEvent({
      events: [{
        type: `${PACKAGE_ID}::market::SoulListed`,
        parsedJson: {
          listing_id: listingObjectId,
          soul_id: soulObjectId,
          kiosk_id: kioskObjectId,
          kiosk_cap_id: kioskCapObjectId,
          seller: `0x${'1'.repeat(64)}`,
          price: '1000',
        },
      }],
    }, PACKAGE_ID)).toEqual({
      listingObjectId,
      soulObjectId,
      kioskId: kioskObjectId,
      kioskCapOnChainId: kioskCapObjectId,
      sellerAddress: `0x${'1'.repeat(64)}`,
      priceAtomic: 1000n,
    })
  })

  it('extracts the purchase event payload including buyer kiosk fields', async () => {
    const { extractSoulPurchasedEvent } = await import('../../web/lib/souls/on-chain-verification.ts')
    const soulObjectId = `0x${'7'.repeat(64)}`
    const sellerKioskId = `0x${'8'.repeat(64)}`
    const buyerKioskId = `0x${'6'.repeat(64)}`
    const buyerKioskCapObjectId = `0x${'5'.repeat(64)}`

    expect(extractSoulPurchasedEvent({
      events: [{
        type: `${PACKAGE_ID}::market::SoulPurchased`,
        parsedJson: {
          soul_id: soulObjectId,
          seller_kiosk_id: sellerKioskId,
          buyer_kiosk_id: buyerKioskId,
          buyer_kiosk_cap_id: buyerKioskCapObjectId,
          buyer: `0x${'1'.repeat(64)}`,
          price: '1000',
          platform_fee: '25',
          creator_royalty: '100',
        },
      }],
    }, PACKAGE_ID)).toEqual({
      soulObjectId,
      sellerKioskId,
      buyerKioskId,
      buyerKioskCapOnChainId: buyerKioskCapObjectId,
      buyerAddress: `0x${'1'.repeat(64)}`,
      priceAtomic: 1000n,
      platformFeeAtomic: 25n,
      creatorRoyaltyAtomic: 100n,
    })
  })
})
