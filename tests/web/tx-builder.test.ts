import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }
const SOUL_OBJECT_PACKAGE_ID = '0xsoulobject'
const MARKET_CONFIG_ID = '0xmarketconfig'
const TRANSFER_POLICY_ID = '0xpolicy'
const ALLOWLIST_REGISTRY_ID = '0xallowlistregistry'
const PAYMENT_COIN_TYPE = '0xpayment::usdc::USDC'

describe('tx builders', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID: SOUL_OBJECT_PACKAGE_ID,
      NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID: MARKET_CONFIG_ID,
      NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID: TRANSFER_POLICY_ID,
      NEXT_PUBLIC_SOUL_ALLOWLIST_REGISTRY_ID: ALLOWLIST_REGISTRY_ID,
      NEXT_PUBLIC_SOUL_PAYMENT_COIN_TYPE: PAYMENT_COIN_TYPE,
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('rejects creator royalty values above the supported cap', async () => {
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildMintAndListSoulTx({
      name: 'Soul name',
      description: 'Soul description',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: null,
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: [],
      readme: null,
      priceAtomic: 1_000_000n,
      creatorRoyaltyBps: 2_501,
    })).toThrow('creatorRoyaltyBps must be between 0 and 2500')
  })

  it('rejects mint-and-list payloads that exceed the on-chain tag limit', async () => {
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildMintAndListSoulTx({
      name: 'Soul name',
      description: 'Soul description',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
      previewImages: [],
      readme: 'README',
      priceAtomic: 1_000_000n,
      creatorRoyaltyBps: 0,
    })).toThrow('Soul tags exceed the 10-tag limit')
  })

  it('rejects empty descriptions before signing publish txs', async () => {
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildMintAndListSoulTx({
      name: 'Soul name',
      description: '   ',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: null,
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: [],
      readme: null,
      priceAtomic: 1_000_000n,
      creatorRoyaltyBps: 0,
    })).toThrow('Soul description is required')
  })

  it('rejects zero-priced listings before they reach the chain', async () => {
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildMintAndListSoulTx({
      name: 'Soul name',
      description: 'Soul description',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: null,
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: [],
      readme: null,
      priceAtomic: 0n,
      creatorRoyaltyBps: 0,
    })).toThrow('priceAtomic must be positive')
  })

  it('builds the soul publish move call with a fixed-price market config and per-Soul creator royalty', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    moveCallSpy.mockImplementation(() => ({ $kind: 'Result', Result: 0 } as any))
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildMintAndListSoulTx({
      name: 'Soul name',
      description: 'Soul description',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: [],
      readme: 'README',
      priceAtomic: 1_000_000n,
      creatorRoyaltyBps: 250,
    })

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${SOUL_OBJECT_PACKAGE_ID}::market::mint_and_list_fixed_price`,
    }))
    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(8)
    moveCallSpy.mockRestore()
  })

  it('builds the soul publish move call against an existing personal kiosk when one is already registered', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    moveCallSpy.mockImplementation(() => ({ $kind: 'Result', Result: 0 } as any))
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildMintAndListSoulTx({
      name: 'Soul name',
      description: 'Soul description',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: '0xblob',
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xcap',
      category: 'Research',
      tags: ['alpha'],
      previewImages: [],
      readme: 'README',
      priceAtomic: 1_000_000n,
      creatorRoyaltyBps: 250,
    })

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${SOUL_OBJECT_PACKAGE_ID}::market::mint_and_list_fixed_price_in_personal_kiosk`,
    }))
    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(10)
    moveCallSpy.mockRestore()
  })

  it('builds the soul purchase move call against the configured package using stablecoin objects instead of splitting gas', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const splitCoinsSpy = vi.spyOn(Transaction.prototype, 'splitCoins')
    const mergeCoinsSpy = vi.spyOn(Transaction.prototype, 'mergeCoins')
    const transferSpy = vi.spyOn(Transaction.prototype, 'transferObjects')
    const { buildBuySoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildBuySoulTx({
      listingObjectId: '0xlisting',
      sellerKioskId: '0xkiosk',
      buyerKioskId: '0xbuyer-kiosk',
      buyerKioskCapOnChainId: '0xbuyer-kiosk-cap',
      totalAtomic: 1_100_000n,
      paymentCoinObjectIds: ['0xcoin-a', '0xcoin-b'],
    })

    const moveCall = moveCallSpy.mock.calls.findLast(
      ([call]) => (call as Record<string, unknown>).target === `${SOUL_OBJECT_PACKAGE_ID}::market::buy_fixed_price`,
    )?.[0] as Record<string, unknown> | undefined

    expect(moveCall).toMatchObject({
      target: `${SOUL_OBJECT_PACKAGE_ID}::market::buy_fixed_price`,
    })
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(8)
    expect(splitCoinsSpy).toHaveBeenCalledTimes(1)
    expect(mergeCoinsSpy).toHaveBeenCalledTimes(1)
    expect(mergeCoinsSpy).toHaveBeenCalledWith(expect.anything(), [expect.anything()])
    expect(transferSpy).not.toHaveBeenCalled()
    splitCoinsSpy.mockRestore()
    mergeCoinsSpy.mockRestore()
    moveCallSpy.mockRestore()
    transferSpy.mockRestore()
  })

  it('rejects purchase transactions without stablecoin inputs', async () => {
    const { buildBuySoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildBuySoulTx({
      listingObjectId: '0xlisting',
      sellerKioskId: '0xkiosk',
      buyerKioskId: '0xbuyer-kiosk',
      buyerKioskCapOnChainId: '0xbuyer-kiosk-cap',
      totalAtomic: 1_100_000n,
      paymentCoinObjectIds: [],
    })).toThrow('paymentCoinObjectIds must contain at least one coin object id')
  })

  it('builds the Soul personal kiosk initialization move call', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    moveCallSpy.mockImplementation(() => ({ $kind: 'Result', Result: 0 } as any))
    const { buildInitSoulPersonalKioskTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildInitSoulPersonalKioskTx()

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${SOUL_OBJECT_PACKAGE_ID}::market::init_personal_kiosk`,
    }))
    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(1)
    moveCallSpy.mockRestore()
  })

  it('reuses the existing Soul personal kiosk cap when the caller already has one', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    moveCallSpy.mockImplementation(() => ({ $kind: 'Result', Result: 0 } as any))
    const { buildInitSoulPersonalKioskTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildInitSoulPersonalKioskTx({ currentKioskCapOnChainId: '0xexistingcap' })

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${SOUL_OBJECT_PACKAGE_ID}::market::reuse_personal_kiosk`,
    }))
    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(2)
    moveCallSpy.mockRestore()
  })

  it('builds the soul allowlist move call against the kiosk-held Soul and transfers the returned cap to the allowlisted address', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const transferSpy = vi.spyOn(Transaction.prototype, 'transferObjects')
    const soulObjectId = `0x${'1'.repeat(64)}`
    const currentKioskId = `0x${'2'.repeat(64)}`
    const currentKioskCapOnChainId = `0x${'3'.repeat(64)}`
    const allowlistAddress = `0x${'4'.repeat(64)}`
    const pureSpy = vi.spyOn(Transaction.prototype as any, 'pure', 'get').mockReturnValue({
      address: vi.fn((value: string) => ({
        $kind: 'Input',
        Input: value,
        type: 'pure',
      })),
      id: vi.fn((value: string) => ({
        $kind: 'Input',
        Input: value,
        type: 'pure',
      })),
    } as any)
    const accessCap = { fake: true }
    moveCallSpy.mockImplementation(() => [accessCap] as any)
    transferSpy.mockImplementation(() => undefined as any)
    const { buildSetAllowlistAddressTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildSetAllowlistAddressTx({
      soulObjectId,
      currentKioskId,
      currentKioskCapOnChainId,
      allowlistAddress,
    })

    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(moveCall).toEqual(expect.objectContaining({
      target: `${SOUL_OBJECT_PACKAGE_ID}::allowlist::set_allowlist_address_via_personal_kiosk`,
    }))
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(5)
    expect((moveCall?.arguments as unknown[] | undefined)?.[3]).toMatchObject({ Input: soulObjectId })
    expect((moveCall?.arguments as unknown[] | undefined)?.[4]).toMatchObject({ Input: allowlistAddress })
    expect(transferSpy).toHaveBeenCalledTimes(1)
    expect(transferSpy).toHaveBeenCalledWith(
      [accessCap],
      expect.objectContaining({ Input: allowlistAddress }),
    )
    pureSpy.mockRestore()
    moveCallSpy.mockRestore()
    transferSpy.mockRestore()
  })

  it('builds the soul clear-allowlist move call against the kiosk-held Soul', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const soulObjectId = `0x${'1'.repeat(64)}`
    const currentKioskId = `0x${'2'.repeat(64)}`
    const currentKioskCapOnChainId = `0x${'3'.repeat(64)}`
    moveCallSpy.mockImplementation(() => ({ $kind: 'Result', Result: 0 } as any))
    const pureSpy = vi.spyOn(Transaction.prototype as any, 'pure', 'get').mockReturnValue({
      id: vi.fn((value: string) => ({
        $kind: 'Input',
        Input: value,
        type: 'pure',
      })),
    } as any)
    const { buildClearAllowlistAddressTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildClearAllowlistAddressTx({
      soulObjectId,
      currentKioskId,
      currentKioskCapOnChainId,
    })

    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(moveCall).toEqual(expect.objectContaining({
      target: `${SOUL_OBJECT_PACKAGE_ID}::allowlist::clear_allowlist_address_via_personal_kiosk`,
    }))
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(4)
    expect((moveCall?.arguments as unknown[] | undefined)?.[3]).toMatchObject({ Input: soulObjectId })
    pureSpy.mockRestore()
    moveCallSpy.mockRestore()
  })

  it('builds the relist move call against soul_object::market directly', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    moveCallSpy.mockImplementation(() => ({ $kind: 'Result', Result: 0 } as any))
    const { buildListHeldSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildListHeldSoulTx({
      currentKioskId: `0x${'1'.repeat(64)}`,
      currentKioskCapOnChainId: `0x${'2'.repeat(64)}`,
      soulObjectId: `0x${'3'.repeat(64)}`,
      priceAtomic: 1_000_000n,
    })

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${SOUL_OBJECT_PACKAGE_ID}::market::list_fixed_price`,
    }))
    const moveCall = moveCallSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(6)
    moveCallSpy.mockRestore()
  })

  it('rejects relist transactions with non-positive prices', async () => {
    const { buildListHeldSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildListHeldSoulTx({
      currentKioskId: `0x${'1'.repeat(64)}`,
      currentKioskCapOnChainId: `0x${'2'.repeat(64)}`,
      soulObjectId: `0x${'3'.repeat(64)}`,
      priceAtomic: 0n,
    })).toThrow('priceAtomic must be positive')
  })

  it('builds cancel-listing txs without taking a MarketConfig write lock', async () => {
    const { Transaction } = await import('@mysten/sui/transactions')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    moveCallSpy.mockImplementation(() => ({ $kind: 'Result', Result: 0 } as any))
    const { buildCancelListingTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildCancelListingTx({
      currentKioskId: '0xkiosk',
      currentKioskCapOnChainId: '0xcap',
      listingObjectId: '0xlisting',
    })

    expect(moveCallSpy).toHaveBeenCalledTimes(1)
    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${SOUL_OBJECT_PACKAGE_ID}::market::cancel_listing`,
    }))
    moveCallSpy.mockRestore()
  })

})
