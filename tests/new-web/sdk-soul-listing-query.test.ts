import { describe, expect, it, vi } from 'vitest'
import {
  getSoulListingObject,
  OnChainVerificationError,
} from '@soulidity/sdk'

const PACKAGE_ID = `0x${'1'.repeat(64)}`
const LISTING_ID = `0x${'2'.repeat(64)}`
const SOUL_ID = `0x${'3'.repeat(64)}`
const STATE_ID = `0x${'4'.repeat(64)}`
const SELLER = `0x${'5'.repeat(64)}`
const KIOSK_ID = `0x${'6'.repeat(64)}`
const CREATOR = `0x${'7'.repeat(64)}`
const FOREIGN_PACKAGE_ID = `0x${'8'.repeat(64)}`

function listingResponse(type = `${PACKAGE_ID}::market::SoulListing`) {
  return {
    data: {
      objectId: LISTING_ID,
      type,
      content: {
        dataType: 'moveObject',
        type,
        fields: {
          version: '5',
          soul_id: SOUL_ID,
          state_id: STATE_ID,
          seller: SELLER,
          seller_kiosk_id: KIOSK_ID,
          price: '1000000',
          creator: CREATOR,
          creator_royalty_bps: '250',
          collection_id: { vec: [] },
          is_active: true,
        },
      },
    },
  }
}

describe('getSoulListingObject', () => {
  it('reads the v5 version and creator royalty from the canonical listing', async () => {
    const client = { getObject: vi.fn().mockResolvedValue(listingResponse()) }
    const listing = await getSoulListingObject(LISTING_ID, PACKAGE_ID, client as never)

    expect(listing).toMatchObject({
      objectId: LISTING_ID,
      version: 5,
      soulId: SOUL_ID,
      stateId: STATE_ID,
      sellerAddress: SELLER,
      sellerKioskId: KIOSK_ID,
      priceAtomic: 1_000_000n,
      creatorAddress: CREATOR,
      creatorRoyaltyBps: 250,
      collectionId: null,
      active: true,
    })
  })

  it('fails closed when the object is not a SoulListing', async () => {
    const client = {
      getObject: vi.fn().mockResolvedValue(
        listingResponse(`${PACKAGE_ID}::market::CollectionListing`),
      ),
    }

    await expect(
      getSoulListingObject(LISTING_ID, PACKAGE_ID, client as never),
    ).rejects.toBeInstanceOf(OnChainVerificationError)
  })

  it('fails closed for a same-named SoulListing from a foreign package', async () => {
    const client = {
      getObject: vi.fn().mockResolvedValue(
        listingResponse(`${FOREIGN_PACKAGE_ID}::market::SoulListing`),
      ),
    }

    await expect(
      getSoulListingObject(LISTING_ID, PACKAGE_ID, client as never),
    ).rejects.toBeInstanceOf(OnChainVerificationError)
  })

  it('accepts equivalent package addresses with omitted leading zeros', async () => {
    const shortPackageId = '0x1'
    const canonicalPackageId = `0x${'0'.repeat(63)}1`
    const client = {
      getObject: vi.fn().mockResolvedValue(
        listingResponse(`${canonicalPackageId}::market::SoulListing`),
      ),
    }

    const listing = await getSoulListingObject(
      LISTING_ID,
      shortPackageId,
      client as never,
    )

    expect(listing.packageId).toBe(canonicalPackageId)
  })
})
