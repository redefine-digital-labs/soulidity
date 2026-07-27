import {
  Transaction,
  type TransactionArgument,
  type TransactionObjectArgument,
} from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import {
  appendFinalizeSoulState,
  buildInitialContentArgs,
  type MintPtbInputs,
} from './mint-helpers'
import {
  MAX_DESCRIPTION_BYTES,
  buildBuyerKioskArgs,
  finishBuyerKioskArgs,
  getUtf8ByteLength,
  validateInitialContentEntries,
  validateInitialStateConfigEntries,
} from './shared'
import { buildExactPaymentCoin } from './buy'

const SUI_CLOCK_OBJECT_ID = '0x6'

export type AnimacraftAuthorizationFactory = (
  tx: Transaction,
) => TransactionArgument | Promise<TransactionArgument>

export interface MintAnimacraftSoulTxParams extends MintPtbInputs {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  description: string
  /**
   * Appends the Animacraft canonical authorization call to this exact PTB. The
   * returned non-droppable `CanonicalSoulMintAuthorization` is consumed by
   * Soulidity below, so legacy original-package authorizations cannot enter
   * this mint boundary and
   * an Animacraft recipe can never produce a second, parallel OC token.
   */
  createAuthorization: AnimacraftAuthorizationFactory
  /**
   * Optional Walrus certification hook. It runs before authorization and mint
   * so the initial content Blob objects can be consumed in the same signature.
   */
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
}

export interface BuyAnimacraftSoulTxParams {
  sellerKioskId: string
  stateObjectId: string
  listingObjectId: string
  provenanceObjectId: string
  makerObjectId: string
  makerTreasuryObjectId: string
  totalAtomic: bigint
  paymentCoinObjectIds: string[]
  collectionObjectId?: string | null
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
}

export interface AnimacraftRecipeSlotInput {
  partKey: string
  itemKey: string
  colorHex: string
  renderOrder: number | bigint
}

export interface AppendAnimacraftAuthorizationParams {
  animacraftPackageId: string
  animacraftOriginalPackageId: string
  makerObjectId: string
  makerTreasuryObjectId: string
  /**
   * Animacraft's chain-owned integration gate. The free and paid authorize
   * entries both require this object so canonical minting can be disabled
   * without redeploying either frontend.
   */
  protocolFeeConfigId: string
  protocolTreasuryId?: string | null
  paymentCoinType: string
  paymentCoinObjectIds?: string[]
  mintFeeEnabled: boolean
  mintPriceAtomic: bigint
  name: string
  profileJsonBlobId: string
  imageBlobId: string
  imageUrl: string
  recipeHashBytes: Uint8Array | ReadonlyArray<number>
  recipe: ReadonlyArray<AnimacraftRecipeSlotInput>
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} is required`)
  }
}

function asTransactionObjectArgument(
  value: ReturnType<Transaction['moveCall']>,
): TransactionObjectArgument {
  return value as unknown as TransactionObjectArgument
}

/**
 * Append the Animacraft half of a canonical mint PTB and return its
 * non-droppable canonical authorization. Paid Makers use the v4 protocol-fee
 * entry; legacy original-package authorization values have a different Move
 * type and are intentionally unusable by Soulidity.
 */
export function appendAnimacraftSoulMintAuthorization(
  tx: Transaction,
  params: AppendAnimacraftAuthorizationParams,
): TransactionArgument {
  requireNonEmpty(params.animacraftPackageId, 'animacraftPackageId')
  requireNonEmpty(params.animacraftOriginalPackageId, 'animacraftOriginalPackageId')
  requireNonEmpty(params.makerObjectId, 'makerObjectId')
  requireNonEmpty(params.makerTreasuryObjectId, 'makerTreasuryObjectId')
  requireNonEmpty(params.protocolFeeConfigId, 'protocolFeeConfigId')
  requireNonEmpty(params.paymentCoinType, 'paymentCoinType')
  requireNonEmpty(params.name, 'name')
  requireNonEmpty(params.profileJsonBlobId, 'profileJsonBlobId')
  requireNonEmpty(params.imageBlobId, 'imageBlobId')
  requireNonEmpty(params.imageUrl, 'imageUrl')
  if (params.recipe.length === 0) {
    throw new Error('Animacraft recipe must contain at least one slot')
  }
  if (params.recipeHashBytes.length !== 32) {
    throw new Error('Animacraft recipeHashBytes must contain exactly 32 bytes')
  }
  if (params.mintPriceAtomic < 0n) {
    throw new Error('mintPriceAtomic cannot be negative')
  }
  if (params.mintFeeEnabled !== (params.mintPriceAtomic > 0n)) {
    throw new Error('Animacraft mint fee state and price do not agree')
  }

  const recipeElements = params.recipe.map((slot, index) => {
    requireNonEmpty(slot.partKey, `recipe[${index}].partKey`)
    requireNonEmpty(slot.itemKey, `recipe[${index}].itemKey`)
    requireNonEmpty(slot.colorHex, `recipe[${index}].colorHex`)
    const renderOrder = BigInt(slot.renderOrder)
    if (renderOrder < 0n) {
      throw new Error(`recipe[${index}].renderOrder cannot be negative`)
    }
    return asTransactionObjectArgument(tx.moveCall({
      target: `${params.animacraftPackageId}::animacraft::new_recipe_slot`,
      arguments: [
        tx.pure.string(slot.partKey),
        tx.pure.string(slot.itemKey),
        tx.pure.string(slot.colorHex),
        tx.pure.u64(renderOrder),
      ],
    }))
  })
  const recipe = tx.makeMoveVec({
    type: `${params.animacraftOriginalPackageId}::animacraft::RecipeSlot`,
    elements: recipeElements,
  })
  const commonArguments = [
    tx.pure.string(params.name),
    tx.pure.string(params.profileJsonBlobId),
    tx.pure.string(params.imageBlobId),
    tx.pure.string(params.imageUrl),
    tx.pure.vector('u8', Array.from(params.recipeHashBytes)),
    recipe,
    tx.object(SUI_CLOCK_OBJECT_ID),
  ]

  if (!params.mintFeeEnabled) {
    return tx.moveCall({
      target: `${params.animacraftPackageId}::animacraft::authorize_soul_mint_with_protocol_gate`,
      arguments: [
        tx.object(params.makerObjectId),
        tx.object(params.protocolFeeConfigId),
        ...commonArguments,
      ],
    }) as unknown as TransactionArgument
  }

  requireNonEmpty(params.protocolTreasuryId ?? '', 'protocolTreasuryId')
  const paymentCoin = buildExactPaymentCoin(
    tx,
    params.paymentCoinObjectIds ?? [],
    params.mintPriceAtomic,
  )
  return tx.moveCall({
    target: `${params.animacraftPackageId}::animacraft::authorize_soul_mint_paid_with_protocol_fee`,
    typeArguments: [params.paymentCoinType],
    arguments: [
      tx.object(params.makerObjectId),
      tx.object(params.makerTreasuryObjectId),
      tx.object(params.protocolFeeConfigId),
      tx.object(params.protocolTreasuryId!),
      paymentCoin,
      ...commonArguments,
    ],
  }) as unknown as TransactionArgument
}

/**
 * Build the canonical cross-package mint PTB. Animacraft validates the Maker,
 * recipe, license, royalty snapshot, and optional primary payment; Soulidity
 * consumes that authorization and creates the only finished Soul.
 */
export async function buildMintAnimacraftSoulTx(
  params: MintAnimacraftSoulTxParams,
): Promise<Transaction> {
  if (params.description.trim().length === 0) {
    throw new Error('Soul description is required')
  }
  if (getUtf8ByteLength(params.description) > MAX_DESCRIPTION_BYTES) {
    throw new Error(`Soul description exceeds the ${MAX_DESCRIPTION_BYTES}-byte limit`)
  }
  if (typeof params.createAuthorization !== 'function') {
    throw new Error('createAuthorization is required for an Animacraft Soul mint')
  }
  validateInitialContentEntries(params.initialContent)
  validateInitialStateConfigEntries(params.initialStateConfig)

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv(
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
  )
  const kindRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })

  if (params.attachBeforeMint) {
    await params.attachBeforeMint(tx)
  }
  const authorization = await params.createAuthorization(tx)
  if (!authorization) {
    throw new Error('createAuthorization did not return a CanonicalSoulMintAuthorization')
  }

  const { initialContentVec, initialStateConfigVec } = buildInitialContentArgs(tx, packageId, {
    initialContent: params.initialContent,
    initialStateConfig: params.initialStateConfig,
  })
  const soulState = tx.moveCall({
    target: `${packageId}::market::mint_animacraft_in_personal_kiosk_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kindRegistryId),
      tx.object(kioskRegistryId),
      tx.object(transferPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      authorization,
      tx.pure.string(params.description),
      initialContentVec,
      initialStateConfigVec,
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })

  appendFinalizeSoulState(tx, packageId, soulState)
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

/**
 * Build the only valid purchase path for an Animacraft-derived Soul. Passing
 * provenance, Maker, and MakerTreasury is mandatory because the immutable
 * Maker royalty is re-quoted and deposited on chain during settlement.
 */
export function buildBuyAnimacraftSoulTx(params: BuyAnimacraftSoulTxParams): Transaction {
  requireNonEmpty(params.sellerKioskId, 'sellerKioskId')
  requireNonEmpty(params.stateObjectId, 'stateObjectId')
  requireNonEmpty(params.listingObjectId, 'listingObjectId')
  requireNonEmpty(params.provenanceObjectId, 'provenanceObjectId')
  requireNonEmpty(params.makerObjectId, 'makerObjectId')
  requireNonEmpty(params.makerTreasuryObjectId, 'makerTreasuryObjectId')

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv(
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
  )
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const buyerKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.buyerKioskId,
    buyerKioskCapOnChainId: params.buyerKioskCapOnChainId,
  })
  const paymentCoin = buildExactPaymentCoin(
    tx,
    params.paymentCoinObjectIds,
    params.totalAtomic,
  )

  tx.moveCall({
    target: params.collectionObjectId
      ? `${packageId}::market::buy_animacraft_soul_fixed_price_with_collection_v2`
      : `${packageId}::market::buy_animacraft_soul_fixed_price_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(transferPolicyId),
      tx.object(params.provenanceObjectId),
      tx.object(params.makerObjectId),
      tx.object(params.makerTreasuryObjectId),
      ...(params.collectionObjectId ? [tx.object(params.collectionObjectId)] : []),
      tx.object(params.sellerKioskId),
      buyerKiosk.buyerKiosk,
      buyerKiosk.buyerKioskCap,
      tx.object(params.stateObjectId),
      tx.object(params.listingObjectId),
      paymentCoin,
    ],
  })

  finishBuyerKioskArgs(tx, buyerKiosk)
  return tx
}
