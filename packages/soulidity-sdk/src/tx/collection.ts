import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import { buildBuyerKioskArgs, finishBuyerKioskArgs, validateCollectionArgs } from './shared'

type CreateCollectionTxParams = {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  name: string
  description: string
  imageUrl: string
  extraRoyaltyBps: number
  tradeable: boolean
  // null/undefined = unlimited supply (Move Option<u64>::none).
  // Positive integer = on-chain supply cap. Soft Web limit lives in
  // validateCollectionArgs (MAX_COLLECTION_SUPPLY).
  maxSupply?: number | null
  /**
   * Optional hook to splice extra commands into the create-collection PTB
   * after personal-kiosk setup and before `create_collection_in_personal_kiosk`.
   * The collection-publish flow uses this to bundle `certify_blob(cover)`
   * into the same TX as collection creation, dropping one wallet signature.
   */
  attachBeforeCreate?: (tx: Transaction) => void | Promise<void>
}

type AddSoulToCollectionTxParams = {
  collectionObjectId: string
  stateObjectId: string
}

type BatchAddSoulToCollectionTxParams = {
  collectionObjectId: string
  binds: ReadonlyArray<{ stateObjectId: string }>
}

type MoveCallResult = ReturnType<Transaction['moveCall']>

interface PersonalKioskHandles {
  buyerKiosk: ReturnType<typeof buildBuyerKioskArgs>['buyerKiosk']
  buyerKioskCap: ReturnType<typeof buildBuyerKioskArgs>['buyerKioskCap']
}

function appendCreateCollectionPrimitive(
  tx: Transaction,
  packageId: string,
  marketConfigId: string,
  kioskRegistryId: string,
  collectionPolicyId: string,
  personalKiosk: PersonalKioskHandles,
  params: CreateCollectionTxParams,
): MoveCallResult {
  const maxSupplyArg = params.maxSupply == null
    ? tx.pure.option('u64', null)
    : tx.pure.option('u64', params.maxSupply)
  return tx.moveCall({
    target: `${packageId}::market::create_collection_in_personal_kiosk_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(collectionPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.string(params.name),
      tx.pure.string(params.description),
      tx.pure.string(params.imageUrl),
      tx.pure.u16(params.extraRoyaltyBps),
      tx.pure.bool(params.tradeable),
      maxSupplyArg,
    ],
  })
}

function appendFinalizeCollectionCall(
  tx: Transaction,
  packageId: string,
  collection: MoveCallResult,
) {
  tx.moveCall({
    target: `${packageId}::market::finalize_collection`,
    arguments: [collection],
  })
}

function appendFinalizeCollectionListingCall(
  tx: Transaction,
  packageId: string,
  listing: MoveCallResult,
) {
  tx.moveCall({
    target: `${packageId}::market::finalize_collection_listing`,
    arguments: [listing],
  })
}

function appendListCollectionRightCall(
  tx: Transaction,
  packageId: string,
  marketConfigId: string,
  kioskRegistryId: string,
  personalKiosk: PersonalKioskHandles,
  collection: MoveCallResult,
  priceAtomic: bigint | number,
): MoveCallResult {
  return tx.moveCall({
    target: `${packageId}::market::list_collection_right_fixed_price_v2`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      collection,
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.u64(priceAtomic),
    ],
  })
}

function loadCreateCollectionEnv() {
  return {
    packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'),
    marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
    kioskRegistryId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID'),
    collectionPolicyId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID'),
  }
}

/**
 * PTB1 fragment composer used by the collection-publish fast path: append
 * the personal-kiosk setup and `create_collection_in_personal_kiosk` move
 * call to the caller's `Transaction`, returning the unshared
 * `SoulCollection` handle so the caller can compose downstream calls
 * (e.g. list_collection_right) before finalizing.
 *
 * Caller MUST call `appendFinalizeCollectionCall` on the returned handle
 * before signing the PTB.
 */
export function appendCreateCollectionMoveCalls(
  tx: Transaction,
  params: CreateCollectionTxParams,
): { collection: MoveCallResult; personalKiosk: PersonalKioskHandles; finalizePersonalKiosk: () => void; finalizeCollection: () => void } {
  validateCollectionArgs(params)
  const env = loadCreateCollectionEnv()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  const collection = appendCreateCollectionPrimitive(
    tx,
    env.packageId,
    env.marketConfigId,
    env.kioskRegistryId,
    env.collectionPolicyId,
    personalKiosk,
    params,
  )
  return {
    collection,
    personalKiosk,
    finalizePersonalKiosk: () => finishBuyerKioskArgs(tx, personalKiosk),
    finalizeCollection: () => appendFinalizeCollectionCall(tx, env.packageId, collection),
  }
}

export async function buildCreateCollectionTx(params: CreateCollectionTxParams): Promise<Transaction> {
  validateCollectionArgs(params)

  const env = loadCreateCollectionEnv()
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  if (params.attachBeforeCreate) {
    await params.attachBeforeCreate(tx)
  }
  const collection = appendCreateCollectionPrimitive(
    tx,
    env.packageId,
    env.marketConfigId,
    env.kioskRegistryId,
    env.collectionPolicyId,
    personalKiosk,
    params,
  )
  appendFinalizeCollectionCall(tx, env.packageId, collection)
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

export type CreateCollectionWithListParams = CreateCollectionTxParams & {
  /** USDC atomic price for the collection-right listing. Must be > 0. */
  collectionRightListingPriceAtomic: bigint | number
}

export async function buildCreateCollectionWithListTx(
  params: CreateCollectionWithListParams,
): Promise<Transaction> {
  validateCollectionArgs(params)
  if (!(BigInt(params.collectionRightListingPriceAtomic) > 0n)) {
    throw new Error('buildCreateCollectionWithListTx requires collectionRightListingPriceAtomic > 0')
  }
  if (!params.tradeable) {
    throw new Error('Cannot list a non-tradeable collection right')
  }

  const env = loadCreateCollectionEnv()
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  if (params.attachBeforeCreate) {
    await params.attachBeforeCreate(tx)
  }
  const collection = appendCreateCollectionPrimitive(
    tx,
    env.packageId,
    env.marketConfigId,
    env.kioskRegistryId,
    env.collectionPolicyId,
    personalKiosk,
    params,
  )
  const listing = appendListCollectionRightCall(
    tx,
    env.packageId,
    env.marketConfigId,
    env.kioskRegistryId,
    personalKiosk,
    collection,
    params.collectionRightListingPriceAtomic,
  )
  appendFinalizeCollectionListingCall(tx, env.packageId, listing)
  appendFinalizeCollectionCall(tx, env.packageId, collection)
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

/**
 * PTB2 builder for the empty-collection launch (no souls): attach only the
 * cover blob certificate and sign once. No Soulidity Move calls beyond the
 * caller-provided certify_blob hook — the cover lands on chain so the
 * already-shared `SoulCollection` image_url resolves.
 */
export async function buildCollectionCoverCertifyTx(params: {
  attachCertifyCalls: (tx: Transaction) => void | Promise<void>
}): Promise<Transaction> {
  const tx = new Transaction()
  await params.attachCertifyCalls(tx)
  return tx
}

export function buildAddSoulToCollectionTx(params: AddSoulToCollectionTxParams) {
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::collection::add_soul`,
    arguments: [
      tx.object(params.collectionObjectId),
      tx.object(params.stateObjectId),
    ],
  })
  return tx
}

/**
 * Builds one PTB that binds N souls to the same collection in a single
 * wallet signature. The collection is shared, so all `add_soul` calls share
 * the same `&mut SoulCollection` reference; each `SoulState` is shared and
 * referenced by id. Move enforces ownership via `SoulCollection.owner`,
 * which must match the kiosk-held SoulCollectionRight — the caller (owner)
 * is implicit from the signing wallet, so no kiosk handles are needed.
 */
export function buildBatchAddSoulToCollectionTx(params: BatchAddSoulToCollectionTxParams) {
  if (params.binds.length === 0) {
    throw new Error('buildBatchAddSoulToCollectionTx requires at least one bind')
  }
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const tx = new Transaction()
  for (const bind of params.binds) {
    tx.moveCall({
      target: `${packageId}::collection::add_soul`,
      arguments: [
        tx.object(params.collectionObjectId),
        tx.object(bind.stateObjectId),
      ],
    })
  }
  return tx
}
