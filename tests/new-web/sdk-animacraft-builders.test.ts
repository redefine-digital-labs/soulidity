import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_MEMORY,
  KIND_SOUL_DOC,
  NO_DOWNLOAD_POLICY,
  READ_GRANT,
  READ_OWNER,
  buildAnimacraftCompleteOutputSealApprovalTx,
  buildBuyAnimacraftSoulTx,
  buildBuyAnimacraftV5SoulTx,
  buildListSoulTx,
  buildListAnimacraftV5SoulTx,
  buildMintAnimacraftSoulTx,
  buildUpdateListingPriceTx,
  appendAnimacraftCommerceV5Authorization,
  appendAnimacraftSoulMintAuthorization,
  animacraftRecipeBytes,
  hashAnimacraftCompleteSelectionV5,
  hashAnimacraftRecipe,
  parseAnimacraftRecipeHashHex,
  quoteAnimacraftV5SoulSale,
  simulateAnimacraftCompleteQuoteV5,
} from '@soulidity/sdk'

const id = (character: string) => `0x${character.repeat(64)}`
const PACKAGE_ID = id('1')
const ORIGINAL_PACKAGE_ID = id('0')
const ANIMACRAFT_PACKAGE_ID = id('2')
const MARKET_CONFIG_ID = id('3')
const MARKET_CONFIG_V2_ID = id('9')
const KIND_REGISTRY_ID = id('4')
const KIOSK_REGISTRY_ID = id('5')
const TRANSFER_POLICY_ID = id('6')
const KIOSK_ID = id('7')
const KIOSK_CAP_ID = id('8')

const initialContent = [
  {
    kind: KIND_SOUL_DOC,
    name: CANONICAL_SOUL_DOC_NAME,
    slotReadModeMask: READ_OWNER | READ_GRANT,
    downloadPolicy: NO_DOWNLOAD_POLICY,
    setActive: false,
    blobObjectId: id('a'),
  },
  {
    kind: KIND_MEMORY,
    name: CANONICAL_MEMORY_NAME,
    slotReadModeMask: READ_OWNER | READ_GRANT,
    downloadPolicy: NO_DOWNLOAD_POLICY,
    setActive: false,
    blobObjectId: id('b'),
  },
] as const

function moveCalls(tx: Awaited<ReturnType<typeof buildMintAnimacraftSoulTx>>) {
  const json = JSON.parse(JSON.stringify(tx.getData()))
  return (json.commands ?? [])
    .map((command: { MoveCall?: { package?: string; module?: string; function?: string; arguments?: unknown[] } }) => command.MoveCall)
    .filter(Boolean) as Array<{ package: string; module: string; function: string; arguments: unknown[] }>
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', PACKAGE_ID)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', ORIGINAL_PACKAGE_ID)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID', MARKET_CONFIG_ID)
  vi.stubEnv(
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
    MARKET_CONFIG_V2_ID,
  )
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', KIND_REGISTRY_ID)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID', KIOSK_REGISTRY_ID)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID', TRANSFER_POLICY_ID)
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildMintAnimacraftSoulTx', () => {
  it('creates and consumes the Animacraft authorization in one PTB', async () => {
    const tx = await buildMintAnimacraftSoulTx({
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      description: 'A canonical Animacraft Soul',
      initialContent,
      initialStateConfig: [],
      createAuthorization(transaction) {
        return transaction.moveCall({
          target: `${ANIMACRAFT_PACKAGE_ID}::animacraft::authorize_soul_mint_with_protocol_gate`,
          arguments: [],
        })
      },
    })

    const calls = moveCalls(tx)
    const functions = calls.map((call) => call.function)
    const authorizationIndex = functions.indexOf('authorize_soul_mint_with_protocol_gate')
    const mintIndex = functions.indexOf('mint_animacraft_in_personal_kiosk_v2')

    expect(authorizationIndex).toBeGreaterThanOrEqual(0)
    expect(mintIndex).toBeGreaterThan(authorizationIndex)
    expect(functions.filter((name) => name === 'new_initial_content_entry')).toHaveLength(2)
    expect(functions.filter((name) => name === 'mint_animacraft_in_personal_kiosk_v2'))
      .toHaveLength(1)
    expect(functions).toContain('ensure_personal_kiosk_registered_v2')
    expect(JSON.stringify(tx.getData())).toContain(MARKET_CONFIG_V2_ID.slice(2))
    expect(JSON.stringify(tx.getData())).not.toContain(MARKET_CONFIG_ID.slice(2))
    expect(functions.filter((name) => name === 'finalize_soul_state')).toHaveLength(1)
    expect(calls.filter((call) => call.module === 'market').every((call) => call.package === PACKAGE_ID))
      .toBe(true)
    expect(JSON.stringify(tx.getData())).toContain(
      `${ORIGINAL_PACKAGE_ID}::market::InitialContentEntry`,
    )
  })

  it('rejects a missing authorization factory before a wallet signature', async () => {
    await expect(buildMintAnimacraftSoulTx({
      description: 'Missing authorization',
      initialContent,
      initialStateConfig: [],
      createAuthorization: null as never,
    })).rejects.toThrow(/createAuthorization/)
  })
})

describe('appendAnimacraftSoulMintAuthorization', () => {
  const authorizationBase = {
    animacraftPackageId: ANIMACRAFT_PACKAGE_ID,
    animacraftOriginalPackageId: id('b'),
    makerObjectId: id('c'),
    makerTreasuryObjectId: id('d'),
    protocolFeeConfigId: id('f'),
    paymentCoinType: `${id('e')}::usdc::USDC`,
    mintFeeEnabled: false,
    mintPriceAtomic: 0n,
    name: 'Mira',
    profileJsonBlobId: 'profile-patch-id',
    imageBlobId: 'image-patch-id',
    imageUrl: 'https://aggregator.walrus.space/v1/blob',
    recipeHashBytes: new Uint8Array(32).fill(7),
    recipe: [
      { partKey: 'eyes', itemKey: 'bright', colorHex: '#7b5cff', renderOrder: 0 },
      { partKey: 'hair', itemKey: 'long', colorHex: '#221144', renderOrder: 1 },
    ],
  }

  it('builds RecipeSlot values before the free authorization call', () => {
    const tx = new Transaction()
    appendAnimacraftSoulMintAuthorization(tx, authorizationBase)
    const calls = moveCalls(tx)
    expect(calls.filter((call) => call.function === 'new_recipe_slot')).toHaveLength(2)
    expect(calls.at(-1)?.function).toBe('authorize_soul_mint_with_protocol_gate')
    expect(calls.at(-1)?.arguments).toHaveLength(9)
    expect(JSON.stringify(tx.getData())).toContain(
      `${authorizationBase.animacraftOriginalPackageId}::animacraft::RecipeSlot`,
    )
  })

  it('uses only the non-bypassable v4 paid authorization entry', () => {
    const tx = new Transaction()
    appendAnimacraftSoulMintAuthorization(tx, {
      ...authorizationBase,
      mintFeeEnabled: true,
      mintPriceAtomic: 1_000_000n,
      protocolTreasuryId: id('9'),
      paymentCoinObjectIds: [id('a')],
    })
    const functions = moveCalls(tx).map((call) => call.function)
    expect(functions).toContain('authorize_soul_mint_paid_with_protocol_fee')
    expect(functions).not.toContain('authorize_soul_mint_paid')
  })
})

describe('Animacraft recipe codec', () => {
  const fixture = [{
    partKey: 'eyes',
    itemKey: 'bright',
    colorHex: '#2db7a3',
    renderOrder: 0,
  }]

  it('matches the Move BCS recipe fixture', () => {
    expect(Buffer.from(animacraftRecipeBytes(fixture)).toString('hex')).toBe(
      '0104657965730662726967687407233264623761330000000000000000',
    )
  })

  it('matches the canonical SHA-256 fixture and parses its hex form', async () => {
    const expected = '176621d82d82b8e8e9068bcd59de9fdbb69170115e87609ba097fe3ea738d46d'
    expect(Buffer.from(await hashAnimacraftRecipe(fixture)).toString('hex')).toBe(expected)
    expect(Buffer.from(parseAnimacraftRecipeHashHex(`0x${expected}`)).toString('hex')).toBe(expected)
  })
})

describe('buildBuyAnimacraftSoulTx', () => {
  const base = {
    sellerKioskId: id('c'),
    stateObjectId: id('d'),
    listingObjectId: id('e'),
    provenanceObjectId: id('f'),
    makerObjectId: id('9'),
    makerTreasuryObjectId: id('0'),
    totalAtomic: 1_055_000n,
    paymentCoinObjectIds: [id('a')],
    buyerKioskId: KIOSK_ID,
    buyerKioskCapOnChainId: KIOSK_CAP_ID,
  }

  it('uses the dedicated royalty-aware solo purchase entry', () => {
    const calls = moveCalls(buildBuyAnimacraftSoulTx(base))
    const purchase = calls.find(
      (call) => call.function === 'buy_animacraft_soul_fixed_price_v2',
    )
    expect(purchase).toBeDefined()
    expect(purchase?.arguments).toHaveLength(12)
  })

  it('uses the collection-aware entry when a collection is supplied', () => {
    const calls = moveCalls(buildBuyAnimacraftSoulTx({
      ...base,
      collectionObjectId: id('b'),
    }))
    const purchase = calls.find(
      (call) => call.function === 'buy_animacraft_soul_fixed_price_with_collection_v2',
    )
    expect(purchase).toBeDefined()
    expect(purchase?.arguments).toHaveLength(13)
  })

  it('requires provenance and treasury identities before signing', () => {
    expect(() => buildBuyAnimacraftSoulTx({
      ...base,
      provenanceObjectId: ' ',
    })).toThrow(/provenanceObjectId/)
  })
})

describe('Animacraft listing builders', () => {
  const base = {
    currentKioskId: KIOSK_ID,
    currentKioskCapOnChainId: KIOSK_CAP_ID,
    stateObjectId: id('c'),
    priceAtomic: 1_000_000n,
    animacraftProvenanceObjectId: id('d'),
  }

  it('uses the provenance-aware solo listing entry', () => {
    const calls = moveCalls(buildListSoulTx(base))
    expect(calls.map((call) => call.function))
      .toContain('list_animacraft_soul_fixed_price_v2')
    expect(calls.map((call) => call.function))
      .toContain('ensure_personal_kiosk_registered_v2')
    expect(calls.map((call) => call.function)).not.toContain('list_soul_fixed_price')
  })

  it('uses the provenance-aware collection listing entry', () => {
    const calls = moveCalls(buildListSoulTx({
      ...base,
      collectionObjectId: id('e'),
    }))
    expect(calls.map((call) => call.function)).toContain(
      'list_animacraft_soul_fixed_price_with_collection_v2',
    )
  })

  it('routes native Souls through the unified v2 listing ABI', () => {
    const calls = moveCalls(buildListSoulTx({
      ...base,
      animacraftProvenanceObjectId: null,
    }))
    expect(calls.map((call) => call.function)).toContain('list_soul_fixed_price_v2')
    expect(calls.map((call) => call.function)).toContain('ensure_personal_kiosk_registered_v2')
    expect(calls.map((call) => call.function))
      .not.toContain('ensure_personal_kiosk_registered')
  })

  it('uses the provenance-aware entry when updating an Animacraft listing', () => {
    const calls = moveCalls(buildUpdateListingPriceTx({
      currentKioskId: base.currentKioskId,
      currentKioskCapOnChainId: base.currentKioskCapOnChainId,
      stateObjectId: base.stateObjectId,
      listingObjectId: id('f'),
      newPriceAtomic: 2_000_000n,
      animacraftProvenanceObjectId: base.animacraftProvenanceObjectId,
    }))
    const functions = calls.map((call) => call.function)
    expect(functions).toContain('cancel_soul_listing')
    expect(functions).toContain('list_animacraft_soul_fixed_price_v2')
  })
})

describe('Animacraft v5 commerce builders', () => {
  const recipe = [
    { partKey: 'eyes', itemKey: 'bright', colorHex: '#7b5cff', renderOrder: 0 },
  ] as const
  const styleSelections = [
    { partKey: 'eyes', itemKey: 'bright', styleKey: 'violet' },
  ] as const
  const commerceAuthorizationBase = {
    runtime: {
      callablePackageId: ANIMACRAFT_PACKAGE_ID,
      typeOriginPackageId: id('a'),
      originalPackageId: id('b'),
      paymentCoinType: `${id('e')}::usdc::USDC`,
    },
    rootObjectId: id('c'),
    rootOwnershipEpoch: 3n,
    legacyMakerObjectId: id('d'),
    makerTreasuryObjectId: id('e'),
    protocolConfigObjectId: id('f'),
    protocolTreasuryObjectId: id('9'),
    protocolFixedCompleteFeeAtomic: 0n,
    wallet: id('8'),
    name: 'Mira',
    profileJsonBlobId: 'profile-patch-id',
    imageBlobId: 'image-patch-id',
    imageUrl: 'https://aggregator.walrus.space/v1/blob',
    outputSealId: new Uint8Array(32).fill(3),
    outputNonce: new Uint8Array(32).fill(4),
    outputDigest: new Uint8Array(32).fill(5),
    recipe,
    styleSelections,
  } as const
  const listingBase = {
    currentKioskId: KIOSK_ID,
    currentKioskCapOnChainId: KIOSK_CAP_ID,
    stateObjectId: id('c'),
    provenanceObjectId: id('d'),
    priceAtomic: 1_000_000n,
    makerSourceRoyaltyBps: 300,
    frozenSoulCreatorRoyaltyBps: 250,
  }

  it('reads an authoritative quote that covers Pack/Pass/quota validation', async () => {
    const quoteBytes = bcs.struct('CompleteQuoteV5', {
      creator_charge_atomic: bcs.u64(),
      protocol_percentage_atomic: bcs.u64(),
      fixed_protocol_fee_atomic: bcs.u64(),
      maker_receives_atomic: bcs.u64(),
      total_due_atomic: bcs.u64(),
      used_pack_count: bcs.u64(),
    }).serialize({
      creator_charge_atomic: 1_000_000n,
      protocol_percentage_atomic: 100_000n,
      fixed_protocol_fee_atomic: 50_000n,
      maker_receives_atomic: 900_000n,
      total_due_atomic: 1_050_000n,
      used_pack_count: 1n,
    }).toBytes()
    let inspected: Transaction | null = null
    const quote = await simulateAnimacraftCompleteQuoteV5({
      async devInspectTransactionBlock(input) {
        inspected = input.transactionBlock
        return {
          effects: { status: { status: 'success' } },
          results: [
            { returnValues: [[[1], 'recipe type']] },
            { returnValues: [[[2], 'style type']] },
            { returnValues: [[Array.from(quoteBytes), 'quote type']] },
          ],
        }
      },
    }, {
      ...commerceAuthorizationBase,
      protocolFixedCompleteFeeAtomic: 50_000n,
    })
    expect(quote).toMatchObject({
      creatorChargeAtomic: 1_000_000n,
      protocolPercentageAtomic: 100_000n,
      totalDueAtomic: 1_050_000n,
      usedPackCount: 1n,
    })
    expect(moveCalls(inspected!).at(-1)?.function).toBe('quote_complete_v5')
  })

  it('composes the v5 free Complete authorization into the canonical Soulidity mint PTB', async () => {
    const recipeHashBytes = await hashAnimacraftCompleteSelectionV5(recipe, styleSelections)
    const tx = await buildMintAnimacraftSoulTx({
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      animacraftProtocolVersion: 5,
      makerRootV5ObjectId: commerceAuthorizationBase.rootObjectId,
      commerceV5ProtocolConfigObjectId:
        commerceAuthorizationBase.protocolConfigObjectId,
      description: 'A commerce v5 Animacraft Soul',
      initialContent,
      initialStateConfig: [],
      createAuthorization: (authorizationTx) =>
        appendAnimacraftCommerceV5Authorization(authorizationTx, {
          ...commerceAuthorizationBase,
          quote: {
            ...commerceAuthorizationBase,
            creatorChargeAtomic: 0n,
            protocolPercentageAtomic: 0n,
            fixedProtocolFeeAtomic: 0n,
            makerReceivesAtomic: 0n,
            totalDueAtomic: 0n,
            usedPackCount: 0n,
            recipeHashBytes,
            quotedAtMs: Date.now(),
          },
        }),
    })
    const calls = moveCalls(tx)
    const functions = calls.map((call) => call.function)
    const authorizeIndex = functions.indexOf('authorize_complete_free_v5')
    const mintIndex = functions.indexOf('mint_animacraft_v5_in_personal_kiosk_v2')
    expect(authorizeIndex).toBeGreaterThanOrEqual(0)
    expect(calls[authorizeIndex]?.arguments).toHaveLength(14)
    expect(mintIndex).toBeGreaterThan(authorizeIndex)
    expect(calls[mintIndex]?.arguments).toHaveLength(13)
    expect(functions.at(-1)).toBe('finalize_soul_state')
  })

  it('does not expose a caller-controlled v5 creator royalty argument', async () => {
    const maliciousParams = {
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      animacraftProtocolVersion: 5,
      makerRootV5ObjectId: commerceAuthorizationBase.rootObjectId,
      commerceV5ProtocolConfigObjectId:
        commerceAuthorizationBase.protocolConfigObjectId,
      // A raw JavaScript caller may still attach unknown properties. The SDK
      // must never serialize this attempted zero override into the Move call.
      soulCreatorRoyaltyBps: 0,
      description: 'Authenticated v5 creator royalty',
      initialContent,
      initialStateConfig: [],
      createAuthorization(transaction) {
        return transaction.moveCall({
          target: `${ANIMACRAFT_PACKAGE_ID}::commerce_v5::authorize_complete_free_v5`,
          arguments: [],
        })
      },
    } as Parameters<typeof buildMintAnimacraftSoulTx>[0] & {
      soulCreatorRoyaltyBps: number
    }
    const tx = await buildMintAnimacraftSoulTx(maliciousParams)
    const mint = moveCalls(tx).find(
      (call) => call.function === 'mint_animacraft_v5_in_personal_kiosk_v2',
    )
    expect(mint?.arguments).toHaveLength(13)
    expect(moveCalls(tx).map((call) => call.function))
      .not.toContain('mint_animacraft_v5_in_personal_kiosk_with_creator_royalty_v2')
  })

  it('requires the MakerRootV5 input before composing a v5 mint', async () => {
    await expect(buildMintAnimacraftSoulTx({
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      animacraftProtocolVersion: 5,
      description: 'Missing commerce root',
      initialContent,
      initialStateConfig: [],
      createAuthorization(transaction) {
        return transaction.moveCall({
          target: `${ANIMACRAFT_PACKAGE_ID}::commerce_v5::authorize_complete_free_v5`,
          arguments: [],
        })
      },
    })).rejects.toThrow(/MakerRootV5/)
  })

  it('requires the proof-anchored commerce protocol config before v5 mint', async () => {
    await expect(buildMintAnimacraftSoulTx({
      currentKioskId: KIOSK_ID,
      currentKioskCapOnChainId: KIOSK_CAP_ID,
      animacraftProtocolVersion: 5,
      makerRootV5ObjectId: commerceAuthorizationBase.rootObjectId,
      description: 'Missing proof-anchored protocol config',
      initialContent,
      initialStateConfig: [],
      createAuthorization(transaction) {
        return transaction.moveCall({
          target: `${ANIMACRAFT_PACKAGE_ID}::commerce_v5::authorize_complete_free_v5`,
          arguments: [],
        })
      },
    })).rejects.toThrow(/protocol config/)
  })

  it('builds the exact current-owner Seal approval transaction kind', () => {
    const tx = buildAnimacraftCompleteOutputSealApprovalTx({
      completeOutputSealId: new Uint8Array(32).fill(7),
      makerRootV5ObjectId: commerceAuthorizationBase.rootObjectId,
      baseProvenanceObjectId: id('1'),
      outputProvenanceObjectId: id('2'),
      soulStateObjectId: id('3'),
    })
    const approval = moveCalls(tx).at(-1)
    expect(approval).toMatchObject({
      package: PACKAGE_ID,
      module: 'animacraft_output_seal',
      function: 'seal_approve_animacraft_complete_output_v5',
    })
    expect(approval?.arguments).toHaveLength(5)
  })

  it('rejects a Complete output Seal ID that is not exactly 32 bytes', () => {
    expect(() => buildAnimacraftCompleteOutputSealApprovalTx({
      completeOutputSealId: new Uint8Array(31),
      makerRootV5ObjectId: commerceAuthorizationBase.rootObjectId,
      baseProvenanceObjectId: id('1'),
      outputProvenanceObjectId: id('2'),
      soulStateObjectId: id('3'),
    })).toThrow(/exactly 32 bytes/)
  })

  it('uses the paid v5 Complete ABI with the exact quoted coin', async () => {
    const recipeHashBytes = await hashAnimacraftCompleteSelectionV5(recipe, styleSelections)
    const tx = new Transaction()
    await appendAnimacraftCommerceV5Authorization(tx, {
      ...commerceAuthorizationBase,
      paymentCoinObjectIds: [id('7')],
      quote: {
        ...commerceAuthorizationBase,
        creatorChargeAtomic: 1_000_000n,
        protocolPercentageAtomic: 100_000n,
        fixedProtocolFeeAtomic: 0n,
        makerReceivesAtomic: 900_000n,
        totalDueAtomic: 1_000_000n,
        usedPackCount: 1n,
        recipeHashBytes,
        quotedAtMs: Date.now(),
      },
    })
    const calls = moveCalls(tx)
    const paid = calls.find((call) => call.function === 'authorize_complete_paid_v5')
    expect(paid).toBeDefined()
    expect(paid?.arguments).toHaveLength(17)
    expect(calls.map((call) => call.function)).not.toContain('authorize_complete_free_v5')
  })

  it('uses the isolated gross-price listing entry with the protocol-default creator share', () => {
    const calls = moveCalls(buildListAnimacraftV5SoulTx(listingBase))
    const listing = calls.find(
      (call) => call.function === 'list_animacraft_v5_soul_fixed_price_v2',
    )
    expect(listing).toBeDefined()
    expect(listing?.arguments).toHaveLength(7)
    expect(calls.map((call) => call.function)).not.toContain('list_animacraft_soul_fixed_price_v2')
  })

  it('never sends the frozen creator royalty as a seller-controlled listing argument', () => {
    const calls = moveCalls(buildListAnimacraftV5SoulTx({
      ...listingBase,
      frozenSoulCreatorRoyaltyBps: 450,
    }))
    const listing = calls.find(
      (call) => call.function === 'list_animacraft_v5_soul_fixed_price_v2',
    )
    expect(listing).toBeDefined()
    expect(listing?.arguments).toHaveLength(7)
    expect(calls.map((call) => call.function))
      .not.toContain('list_animacraft_v5_soul_fixed_price_with_creator_royalty_v2')
  })

  it('rejects an invalid frozen v5 creator royalty before requesting a signature', () => {
    expect(() => buildListAnimacraftV5SoulTx({
      ...listingBase,
      frozenSoulCreatorRoyaltyBps: 501,
    })).toThrow(/soulCreatorRoyaltyBps/)
  })

  it('quotes the Maker source share from verified provenance terms', () => {
    expect(quoteAnimacraftV5SoulSale(1_000_000n, {
      makerSourceRoyaltyBps: 300,
    })).toEqual({
      priceAtomic: 1_000_000n,
      sellerPayoutAtomic: 920_000n,
      protocolFeeAtomic: 25_000n,
      soulCreatorRoyaltyBps: 250,
      soulCreatorRoyaltyAtomic: 25_000n,
      makerSourceRoyaltyBps: 300,
      makerSourceRoyaltyAtomic: 30_000n,
    })
  })

  it('rejects an invalid Maker source step before requesting a signature', () => {
    expect(() => buildListAnimacraftV5SoulTx({
      ...listingBase,
      makerSourceRoyaltyBps: 275,
    })).toThrow(/makerSourceRoyaltyBps/)
  })

  it('accepts the confirmed 250 bps source and creator defaults', () => {
    expect(quoteAnimacraftV5SoulSale(1_000_000n, {
      makerSourceRoyaltyBps: 250,
      soulCreatorRoyaltyBps: 250,
    })).toMatchObject({
      sellerPayoutAtomic: 925_000n,
      protocolFeeAtomic: 25_000n,
      soulCreatorRoyaltyAtomic: 25_000n,
      makerSourceRoyaltyAtomic: 25_000n,
    })
  })

  it('rejects an invalid Soul creator step before requesting a signature', () => {
    expect(() => buildListAnimacraftV5SoulTx({
      ...listingBase,
      frozenSoulCreatorRoyaltyBps: 275,
    })).toThrow(/soulCreatorRoyaltyBps/)
  })

  it('accepts the full 10% rights pool plus the separate 2.5% protocol fee', () => {
    expect(quoteAnimacraftV5SoulSale(1_000_000n, {
      makerSourceRoyaltyBps: 500,
      soulCreatorRoyaltyBps: 500,
    })).toMatchObject({
      sellerPayoutAtomic: 875_000n,
      protocolFeeAtomic: 25_000n,
      soulCreatorRoyaltyAtomic: 50_000n,
      makerSourceRoyaltyAtomic: 50_000n,
    })
    expect(() => buildListAnimacraftV5SoulTx({
      ...listingBase,
      makerSourceRoyaltyBps: 500,
      frozenSoulCreatorRoyaltyBps: 500,
    })).not.toThrow()
  })

  it('rejects rights royalties above their combined 10% ceiling', () => {
    expect(() => quoteAnimacraftV5SoulSale(1_000_000n, {
      makerSourceRoyaltyBps: 550,
      soulCreatorRoyaltyBps: 500,
    })).toThrow(/makerSourceRoyaltyBps/)
  })

  it('uses only the v5 gross-price purchase entry', () => {
    const calls = moveCalls(buildBuyAnimacraftV5SoulTx({
      sellerKioskId: id('e'),
      stateObjectId: id('c'),
      listingObjectId: id('f'),
      provenanceObjectId: id('d'),
      priceAtomic: 1_000_000n,
      paymentCoinObjectIds: [id('a')],
      buyerKioskId: KIOSK_ID,
      buyerKioskCapOnChainId: KIOSK_CAP_ID,
    }))
    const purchase = calls.find(
      (call) => call.function === 'buy_animacraft_v5_soul_fixed_price_v2',
    )
    expect(purchase).toBeDefined()
    expect(purchase?.arguments).toHaveLength(10)
    expect(calls.map((call) => call.function)).not.toContain('buy_animacraft_soul_fixed_price_v2')
  })
})
