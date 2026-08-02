import { Transaction } from '@mysten/sui/transactions'
import { getRequiredSoulidityEnv } from '../env'
import {
  appendFinalizeSoulState,
  buildInitialContentArgs,
  type MintPtbInputs,
} from './mint-helpers'
import {
  buildBuyerKioskArgs,
  finishBuyerKioskArgs,
  validateInitialContentEntries,
  validateInitialStateConfigEntries,
  validateSoulPublishArgs,
} from './shared'

const SUI_CLOCK_OBJECT_ID = '0x6'

export interface PublishTxParams extends MintPtbInputs {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  name: string
  description: string
  imageUrl: string
  creatorRoyaltyBps: number
  /**
   * Optional hook to splice extra commands into the publish PTB after the
   * personal-kiosk setup and before `mint_native_in_personal_kiosk`. The
   * batch publish flow uses this to bundle N `certify_blob` calls into the
   * mint TX, so registering and certifying N blobs costs 2 wallet
   * signatures total instead of 1 + 2N.
   */
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
}

/** Per-soul slice for {@link buildBatchPublishSoulTx}. Kiosk handles + the
 *  pre-mint hook are shared at the batch level, not per soul. */
export type BatchPublishSoulItem = Omit<
  PublishTxParams,
  'currentKioskId' | 'currentKioskCapOnChainId' | 'attachBeforeMint'
>

export interface BatchPublishSoulParams {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  souls: ReadonlyArray<BatchPublishSoulItem>
  /**
   * Hook spliced once after kiosk setup and before any mint moveCall. The
   * collection-publish flow uses this to attach `certify_blob` calls for
   * every blob owned by the souls in this batch — combining certify + N
   * mints into a single wallet signature.
   */
  attachBeforeMints?: (tx: Transaction) => void | Promise<void>
}

interface PublishEnv {
  packageId: string
  marketConfigId: string
  kindRegistryId: string
  kioskRegistryId: string
  transferPolicyId: string
}

function loadPublishEnv(): PublishEnv {
  return {
    packageId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID'),
    marketConfigId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
    kindRegistryId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID'),
    kioskRegistryId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID'),
    transferPolicyId: getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID'),
  }
}

interface PersonalKioskHandles {
  buyerKiosk: ReturnType<typeof buildBuyerKioskArgs>['buyerKiosk']
  buyerKioskCap: ReturnType<typeof buildBuyerKioskArgs>['buyerKioskCap']
}

/**
 * Append a `mint_native_in_personal_kiosk` move call and return the unshared
 * `SoulState` handle. Caller must wire it through `appendFinalizeSoulState`
 * before the PTB is signed.
 */
function appendMintNativeMoveCall(
  tx: Transaction,
  personalKiosk: PersonalKioskHandles,
  env: PublishEnv,
  soul: BatchPublishSoulItem,
) {
  const { initialContentVec, initialStateConfigVec } = buildInitialContentArgs(tx, env.packageId, {
    initialContent: soul.initialContent,
    initialStateConfig: soul.initialStateConfig,
  })
  return tx.moveCall({
    target: `${env.packageId}::market::mint_native_in_personal_kiosk_v2`,
    arguments: [
      tx.object(env.marketConfigId),
      tx.object(env.kindRegistryId),
      tx.object(env.kioskRegistryId),
      tx.object(env.transferPolicyId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      tx.pure.string(soul.name),
      tx.pure.string(soul.description),
      tx.pure.string(soul.imageUrl),
      initialContentVec,
      initialStateConfigVec,
      tx.pure.u16(soul.creatorRoyaltyBps),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  })
}

function appendListSoulFixedPriceCall(
  tx: Transaction,
  env: PublishEnv,
  personalKiosk: PersonalKioskHandles,
  state: ReturnType<Transaction['moveCall']>,
  priceAtomic: bigint | number,
) {
  return tx.moveCall({
    target: `${env.packageId}::market::list_soul_fixed_price_v6`,
    arguments: [
      tx.object(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')),
      tx.object(env.kioskRegistryId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      state,
      tx.pure.u64(BigInt(priceAtomic)),
    ],
  })
}

function appendListSoulFixedPriceWithCollectionCall(
  tx: Transaction,
  env: PublishEnv,
  collectionId: string,
  personalKiosk: PersonalKioskHandles,
  state: ReturnType<Transaction['moveCall']>,
  priceAtomic: bigint | number,
) {
  return tx.moveCall({
    target: `${env.packageId}::market::list_soul_fixed_price_with_collection_v6`,
    arguments: [
      tx.object(getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')),
      tx.object(env.kioskRegistryId),
      tx.object(collectionId),
      personalKiosk.buyerKiosk,
      personalKiosk.buyerKioskCap,
      state,
      tx.pure.u64(BigInt(priceAtomic)),
    ],
  })
}

function appendAddSoulToCollectionCall(
  tx: Transaction,
  env: PublishEnv,
  collectionId: string,
  state: ReturnType<Transaction['moveCall']>,
) {
  tx.moveCall({
    target: `${env.packageId}::collection::add_soul`,
    arguments: [tx.object(collectionId), state],
  })
}

function appendFinalizeSoulListingCall(
  tx: Transaction,
  env: PublishEnv,
  listing: ReturnType<Transaction['moveCall']>,
) {
  tx.moveCall({
    target: `${env.packageId}::market::finalize_soul_listing`,
    arguments: [listing],
  })
}

// ── Single-soul mint flows ──────────────────────────────────────────────

export async function buildPublishSoulTx(params: PublishTxParams): Promise<Transaction> {
  validateSoulPublishArgs(params)
  validateInitialContentEntries(params.initialContent)
  validateInitialStateConfigEntries(params.initialStateConfig)

  const env = loadPublishEnv()
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  if (params.attachBeforeMint) {
    await params.attachBeforeMint(tx)
  }
  const state = appendMintNativeMoveCall(tx, personalKiosk, env, params)
  appendFinalizeSoulState(tx, env.packageId, state)
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

export type PublishSoulWithBindParams = PublishTxParams & {
  /** On-chain id of the existing collection to bind the new soul to. */
  collectionOnChainId: string
}

export async function buildPublishSoulWithBindTx(
  params: PublishSoulWithBindParams,
): Promise<Transaction> {
  validateSoulPublishArgs(params)
  validateInitialContentEntries(params.initialContent)
  validateInitialStateConfigEntries(params.initialStateConfig)
  if (!params.collectionOnChainId) {
    throw new Error('buildPublishSoulWithBindTx requires collectionOnChainId')
  }

  const env = loadPublishEnv()
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  if (params.attachBeforeMint) {
    await params.attachBeforeMint(tx)
  }
  const state = appendMintNativeMoveCall(tx, personalKiosk, env, params)
  appendAddSoulToCollectionCall(tx, env, params.collectionOnChainId, state)
  appendFinalizeSoulState(tx, env.packageId, state)
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

export type PublishSoulWithListParams = PublishTxParams & {
  listingPriceAtomic: bigint | number
}

export async function buildPublishSoulWithListTx(
  params: PublishSoulWithListParams,
): Promise<Transaction> {
  validateSoulPublishArgs(params)
  validateInitialContentEntries(params.initialContent)
  validateInitialStateConfigEntries(params.initialStateConfig)
  if (!(BigInt(params.listingPriceAtomic) > 0n)) {
    throw new Error('buildPublishSoulWithListTx requires listingPriceAtomic > 0')
  }

  const env = loadPublishEnv()
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  if (params.attachBeforeMint) {
    await params.attachBeforeMint(tx)
  }
  const state = appendMintNativeMoveCall(tx, personalKiosk, env, params)
  const listing = appendListSoulFixedPriceCall(tx, env, personalKiosk, state, params.listingPriceAtomic)
  appendFinalizeSoulListingCall(tx, env, listing)
  appendFinalizeSoulState(tx, env.packageId, state)
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

export type PublishSoulWithCollectionAndListParams = PublishTxParams & {
  collectionOnChainId: string
  listingPriceAtomic: bigint | number
}

export async function buildPublishSoulWithCollectionAndListTx(
  params: PublishSoulWithCollectionAndListParams,
): Promise<Transaction> {
  validateSoulPublishArgs(params)
  validateInitialContentEntries(params.initialContent)
  validateInitialStateConfigEntries(params.initialStateConfig)
  if (!params.collectionOnChainId) {
    throw new Error('buildPublishSoulWithCollectionAndListTx requires collectionOnChainId')
  }
  if (!(BigInt(params.listingPriceAtomic) > 0n)) {
    throw new Error('buildPublishSoulWithCollectionAndListTx requires listingPriceAtomic > 0')
  }

  const env = loadPublishEnv()
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  if (params.attachBeforeMint) {
    await params.attachBeforeMint(tx)
  }
  const state = appendMintNativeMoveCall(tx, personalKiosk, env, params)
  appendAddSoulToCollectionCall(tx, env, params.collectionOnChainId, state)
  const listing = appendListSoulFixedPriceWithCollectionCall(
    tx,
    env,
    params.collectionOnChainId,
    personalKiosk,
    state,
    params.listingPriceAtomic,
  )
  appendFinalizeSoulListingCall(tx, env, listing)
  appendFinalizeSoulState(tx, env.packageId, state)
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

// ── Batch mint (N souls in one TX) ──────────────────────────────────────

/**
 * Builds one PTB that mints N souls into the same personal kiosk in a
 * single wallet signature. All souls share the same kiosk handles, so the
 * `buildBuyerKioskArgs` / `finishBuyerKioskArgs` boilerplate runs once;
 * each mint is followed by `finalize_soul_state` to share the SoulState.
 *
 * Mint events (`SoulMintedToKiosk`, `ContentVersionAppended`) are emitted in
 * moveCall order — callers should use `extractAllSoulMintedToKioskEvents`
 * and pair by `soul_id`.
 */
export async function buildBatchPublishSoulTx(
  params: BatchPublishSoulParams,
): Promise<Transaction> {
  if (params.souls.length === 0) {
    throw new Error('buildBatchPublishSoulTx requires at least one soul')
  }
  for (const soul of params.souls) {
    validateSoulPublishArgs(soul)
    validateInitialContentEntries(soul.initialContent)
    validateInitialStateConfigEntries(soul.initialStateConfig)
  }
  const env = loadPublishEnv()
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  if (params.attachBeforeMints) {
    await params.attachBeforeMints(tx)
  }
  for (const soul of params.souls) {
    const state = appendMintNativeMoveCall(tx, personalKiosk, env, soul)
    appendFinalizeSoulState(tx, env.packageId, state)
  }
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}

export interface CollectionFastPathPtb2Params {
  /** On-chain id of the SoulCollection produced by PTB1. */
  collectionOnChainId: string
  /** Personal kiosk to mint into; same kiosk that owns the collection right. */
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  /** Per-soul publish params (one mint+bind+finalize per item). */
  souls: ReadonlyArray<BatchPublishSoulItem>
  /**
   * Splices certify_blob calls (cover + every soul) into PTB2. Required —
   * the fast path certifies all blobs in one signature alongside mint+bind.
   */
  attachCertifyCalls: (tx: Transaction) => void | Promise<void>
}

/**
 * Builds PTB2 of the collection-publish fast path: certify cover + soul
 * blobs and mint+bind every soul to the collection in one wallet
 * signature. PTB1 (register + create_collection [+ optionally
 * list_collection_right]) must have already been signed and finalized
 * on-chain — this PTB takes the resulting `SoulCollection` shared object
 * by id.
 */
export async function buildCollectionFastPathPtb2Tx(
  params: CollectionFastPathPtb2Params,
): Promise<Transaction> {
  if (params.souls.length === 0) {
    throw new Error('buildCollectionFastPathPtb2Tx requires at least one soul (use buildCollectionCoverCertifyTx for empty collections)')
  }
  if (!params.collectionOnChainId) {
    throw new Error('buildCollectionFastPathPtb2Tx requires collectionOnChainId from PTB1')
  }
  for (const soul of params.souls) {
    validateSoulPublishArgs(soul)
    validateInitialContentEntries(soul.initialContent)
    validateInitialStateConfigEntries(soul.initialStateConfig)
  }

  const env = loadPublishEnv()
  const tx = new Transaction()
  const personalKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.currentKioskId,
    buyerKioskCapOnChainId: params.currentKioskCapOnChainId,
  })
  // Certify cover + every soul blob first so the certificate calls own the
  // top of PTB2 (before any mint moves the kiosk slot). The caller is
  // responsible for ordering: cover index first, then one cert per soul in
  // the same order as `params.souls`.
  await params.attachCertifyCalls(tx)
  for (const soul of params.souls) {
    const state = appendMintNativeMoveCall(tx, personalKiosk, env, soul)
    appendAddSoulToCollectionCall(tx, env, params.collectionOnChainId, state)
    appendFinalizeSoulState(tx, env.packageId, state)
  }
  finishBuyerKioskArgs(tx, personalKiosk)
  return tx
}
