import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }
const PACKAGE_ID = '0xsoul'
const MARKET_CONFIG_ID = '0xconfig'
const TRANSFER_POLICY_ID = '0xpolicy'

describe('tx builders', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SOUL_OBJECT_PACKAGE_ID: PACKAGE_ID,
      NEXT_PUBLIC_SOUL_MARKET_CONFIG_ID: MARKET_CONFIG_ID,
      NEXT_PUBLIC_SOUL_TRANSFER_POLICY_ID: TRANSFER_POLICY_ID,
    }
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('rejects mint-and-list payloads that exceed the on-chain tag limit', async () => {
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildMintAndListSoulTx({
      ownerAddress: '0xabc',
      name: 'Soul name',
      description: 'Soul description',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: 'walrus://metadata',
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: Array.from({ length: 11 }, (_, index) => `tag-${index}`),
      previewImages: [],
      readme: 'README',
      priceSui: 1_000_000_000n,
    })).toThrow('Soul tags exceed the 10-tag limit')
  })

  it('rejects empty descriptions before signing publish txs', async () => {
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildMintAndListSoulTx({
      ownerAddress: '0xabc',
      name: 'Soul name',
      description: '   ',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: null,
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: [],
      readme: null,
      priceSui: 1_000_000_000n,
    })).toThrow('Soul description is required')
  })

  it('rejects zero-priced listings before they reach the chain', async () => {
    const { buildMintAndListSoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    expect(() => buildMintAndListSoulTx({
      ownerAddress: '0xabc',
      name: 'Soul name',
      description: 'Soul description',
      imageUrl: 'https://example.com/soul.png',
      metadataRef: null,
      contentBlobObjectId: '0xblob',
      category: 'Research',
      tags: ['alpha'],
      previewImages: [],
      readme: null,
      priceSui: 0n,
    })).toThrow('priceSui must be positive')
  })

  it('builds the soul purchase move call against the configured package', async () => {
    const { Transaction } = await import('../../web/node_modules/@mysten/sui/dist/transactions/index.mjs')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const { buildBuySoulTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildBuySoulTx({
      soulObjectId: '0xsoul-object',
      sellerKioskId: '0xkiosk',
      buyerAddress: `0x${'1'.repeat(64)}`,
      priceSui: 1_000_000_000n,
      feeAmountSui: 100_000_000n,
    })

    const moveCall = moveCallSpy.mock.calls.findLast(
      ([call]) => (call as Record<string, unknown>).target === `${PACKAGE_ID}::market::purchase`,
    )?.[0] as Record<string, unknown> | undefined

    expect(moveCall).toMatchObject({
      target: `${PACKAGE_ID}::market::purchase`,
    })
    expect(Array.isArray(moveCall?.arguments) ? moveCall.arguments : []).toHaveLength(6)
    moveCallSpy.mockRestore()
  })

  it('builds the soul grant move call and transfers the returned cap to the agent', async () => {
    const { Transaction } = await import('../../web/node_modules/@mysten/sui/dist/transactions/index.mjs')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const transferSpy = vi.spyOn(Transaction.prototype, 'transferObjects')
    const { buildSetAgentGrantTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildSetAgentGrantTx({
      soulObjectId: '0xsoul-object',
      agentAddress: `0x${'ab'.repeat(32)}`,
    })

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${PACKAGE_ID}::grant::set_agent_grant`,
    }))
    expect(transferSpy).toHaveBeenCalledTimes(1)
    moveCallSpy.mockRestore()
    transferSpy.mockRestore()
  })

  it('builds the soul revoke move call against the configured package', async () => {
    const { Transaction } = await import('../../web/node_modules/@mysten/sui/dist/transactions/index.mjs')
    const moveCallSpy = vi.spyOn(Transaction.prototype, 'moveCall')
    const { buildRevokeAgentGrantTx } = await import('../../web/lib/souls/tx-builder.ts')

    buildRevokeAgentGrantTx({
      soulObjectId: '0xsoul-object',
    })

    expect(moveCallSpy).toHaveBeenCalledWith(expect.objectContaining({
      target: `${PACKAGE_ID}::grant::revoke_agent_grant`,
    }))
    moveCallSpy.mockRestore()
  })
})
