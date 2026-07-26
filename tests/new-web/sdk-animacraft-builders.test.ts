import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import {
  CANONICAL_MEMORY_NAME,
  CANONICAL_SOUL_DOC_NAME,
  KIND_MEMORY,
  KIND_SOUL_DOC,
  NO_DOWNLOAD_POLICY,
  READ_GRANT,
  READ_OWNER,
  buildBuyAnimacraftSoulTx,
  buildListSoulTx,
  buildMintAnimacraftSoulTx,
  buildUpdateListingPriceTx,
  appendAnimacraftSoulMintAuthorization,
  animacraftRecipeBytes,
  hashAnimacraftRecipe,
  parseAnimacraftRecipeHashHex,
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
