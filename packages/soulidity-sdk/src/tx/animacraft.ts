import {
  Transaction,
  type TransactionArgument,
  type TransactionObjectArgument,
} from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { getRequiredSoulidityEnv } from '../env'
import {
  equalAnimacraftRecipeHash,
  hashAnimacraftCompleteSelectionV5,
} from '../animacraft-recipe'
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

/**
 * Animacraft v4 and Commerce v5 use distinct non-droppable authorization
 * types. Soulidity selects the version-specific mint boundary, and the v5
 * boundary extracts its creator royalty from the authenticated value.
 */
export type AnimacraftAuthorizationProtocolVersion = 4 | 5

export const ANIMACRAFT_V5_PROTOCOL_FEE_BPS = 250
export const DEFAULT_ANIMACRAFT_V5_SOUL_CREATOR_ROYALTY_BPS = 250
export const MAX_ANIMACRAFT_V5_SOUL_CREATOR_ROYALTY_BPS = 500
export const MAX_ANIMACRAFT_V5_MAKER_SOURCE_ROYALTY_BPS = 500
export const ANIMACRAFT_V5_SOUL_CREATOR_ROYALTY_STEP_BPS = 50
export const ANIMACRAFT_V5_MAKER_SOURCE_ROYALTY_STEP_BPS = 50
export const MAX_ANIMACRAFT_V5_RIGHTS_POOL_BPS = 1_000
export const MAX_ANIMACRAFT_V5_ADD_ON_BPS = 1_250

/**
 * The v5 sale price is gross: protocol, Soul creator, and Maker-source
 * shares are taken from it. `makerSourceRoyaltyBps` must be copied from the
 * verified Animacraft provenance object for pre-signature quoting; the Move
 * entrypoint independently re-reads that immutable snapshot.
 */
export interface AnimacraftV5CommerceTerms {
  soulCreatorRoyaltyBps?: number
  makerSourceRoyaltyBps: number
}

export interface AnimacraftV5SoulSaleQuote {
  priceAtomic: bigint
  sellerPayoutAtomic: bigint
  protocolFeeAtomic: bigint
  soulCreatorRoyaltyBps: number
  soulCreatorRoyaltyAtomic: bigint
  makerSourceRoyaltyBps: number
  makerSourceRoyaltyAtomic: bigint
}

export type AnimacraftAuthorizationFactory = (
  tx: Transaction,
) => TransactionArgument | Promise<TransactionArgument>

export interface MintAnimacraftSoulTxParams extends MintPtbInputs {
  currentKioskId?: string | null
  currentKioskCapOnChainId?: string | null
  /**
   * Required for commerce v5. Soulidity consumes the Complete output binding
   * and binds its record to the newly created Soul in this same PTB.
   */
  makerRootV5ObjectId?: string | null
  /**
   * Required for commerce v5. Animacraft verifies that this protocol config
   * has governance-pinned Soulidity's exact private binding-proof TypeName.
   */
  commerceV5ProtocolConfigObjectId?: string | null
  /**
   * Defaults to v4 for existing callers. Commerce v5 must opt in explicitly so
   * a v5 authorization can never be consumed through the legacy mint path.
   */
  animacraftProtocolVersion?: AnimacraftAuthorizationProtocolVersion
  description: string
  /**
   * Appends the version-matched Animacraft authorization call to this exact
   * PTB. v4 returns `CanonicalSoulMintAuthorization`; commerce v5 returns
   * `CommerceV5SoulMintAuthorization`, which authenticates the MakerRootV5
   * creator royalty. Neither value can be dropped or reused.
   */
  createAuthorization: AnimacraftAuthorizationFactory
  /**
   * Optional Walrus certification hook. It runs before authorization and mint
   * so the initial content Blob objects can be consumed in the same signature.
   */
  attachBeforeMint?: (tx: Transaction) => void | Promise<void>
}

export interface AnimacraftCompleteOutputSealApprovalTxParams {
  /** The exact 32-byte Complete output Seal ID frozen by Animacraft. */
  completeOutputSealId: Uint8Array
  makerRootV5ObjectId: string
  baseProvenanceObjectId: string
  outputProvenanceObjectId: string
  soulStateObjectId: string
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

export interface ListAnimacraftV5SoulTxParams {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  provenanceObjectId: string
  /** Gross USDC atomic price. It must be positive. */
  priceAtomic: bigint
  /** Read-only snapshot loaded from SoulState; never supplied to Move listing. */
  frozenSoulCreatorRoyaltyBps: number
  /** Read-only immutable source share loaded from Animacraft provenance. */
  makerSourceRoyaltyBps: number
}

export interface BuyAnimacraftV5SoulTxParams {
  sellerKioskId: string
  stateObjectId: string
  listingObjectId: string
  provenanceObjectId: string
  /** Must exactly equal the v5 listing's gross price; no add-on is charged. */
  priceAtomic: bigint
  paymentCoinObjectIds: string[]
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
}

/** Canonical Animacraft v6 loadout row revalidated during list and buy. */
export interface AnimacraftV6LoadoutSelectionInput {
  productId: string
  slotKey: string
  /** 0 = wallet, 1 = Soul, 2 = embedded. */
  subjectKind: 0 | 1 | 2
  /** Required only for independently wallet-owned selections. */
  ownedInstanceId?: string | null
}

/**
 * Exact cross-package identities needed to revalidate an Animacraft v6
 * appearance. These are authoritative object IDs loaded from the published
 * Maker/appearance manifest, never wallet-selected substitutes.
 */
export interface AnimacraftV6SecondaryContext {
  animacraftCallablePackageId: string
  animacraftCompositionTypeOriginPackageId: string
  compositionRegistryObjectId: string
  compositionConfigObjectId: string
  commerceConfigObjectId: string
  makerProfileObjectId: string
  makerRootObjectId: string
  appearanceObjectId: string
  selections: ReadonlyArray<AnimacraftV6LoadoutSelectionInput>
}

export interface ListAnimacraftV6SoulTxParams {
  currentKioskId: string
  currentKioskCapOnChainId: string
  stateObjectId: string
  provenanceObjectId: string
  priceAtomic: bigint
  v6: AnimacraftV6SecondaryContext
}

export interface BuyAnimacraftV6SoulTxParams {
  sellerKioskId: string
  stateObjectId: string
  listingObjectId: string
  provenanceObjectId: string
  priceAtomic: bigint
  paymentCoinObjectIds: string[]
  buyerKioskId?: string | null
  buyerKioskCapOnChainId?: string | null
  v6: AnimacraftV6SecondaryContext
}

export interface AnimacraftRecipeSlotInput {
  partKey: string
  itemKey: string
  colorHex: string
  renderOrder: number | bigint
}

export interface AnimacraftStyleSelectionV5Input {
  partKey: string
  itemKey: string
  styleKey: string
}

export interface AnimacraftCommerceV5Runtime {
  callablePackageId: string
  typeOriginPackageId: string
  originalPackageId: string
  paymentCoinType: string
}

export interface AnimacraftCommerceV5QuoteContext {
  rootObjectId: string
  rootOwnershipEpoch: bigint
  legacyMakerObjectId: string
  makerTreasuryObjectId: string
  protocolConfigObjectId: string
  protocolTreasuryObjectId: string
  protocolFixedCompleteFeeAtomic: bigint
  wallet: string
}

export interface AnimacraftCompleteQuoteV5 extends AnimacraftCommerceV5QuoteContext {
  creatorChargeAtomic: bigint
  protocolPercentageAtomic: bigint
  fixedProtocolFeeAtomic: bigint
  makerReceivesAtomic: bigint
  totalDueAtomic: bigint
  usedPackCount: bigint
  recipeHashBytes: Uint8Array
  quotedAtMs: number
}

export interface QuoteAnimacraftCompleteV5Params extends AnimacraftCommerceV5QuoteContext {
  runtime: AnimacraftCommerceV5Runtime
  recipe: ReadonlyArray<AnimacraftRecipeSlotInput>
  styleSelections: ReadonlyArray<AnimacraftStyleSelectionV5Input>
}

export interface AppendAnimacraftCommerceV5AuthorizationParams
  extends QuoteAnimacraftCompleteV5Params {
  quote: AnimacraftCompleteQuoteV5
  paymentCoinObjectIds?: string[]
  name: string
  profileJsonBlobId: string
  imageBlobId: string
  imageUrl: string
  /** Exact Seal identity for this encrypted final PNG. */
  outputSealId: Uint8Array | ReadonlyArray<number>
  /** Fresh 32-byte nonce; permits intentional repeats of the same Recipe. */
  outputNonce: Uint8Array | ReadonlyArray<number>
  /** SHA-256 digest of the exact plaintext final PNG. */
  outputDigest: Uint8Array | ReadonlyArray<number>
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

const completeQuoteV5Bcs = bcs.struct('CompleteQuoteV5', {
  creator_charge_atomic: bcs.u64(),
  protocol_percentage_atomic: bcs.u64(),
  fixed_protocol_fee_atomic: bcs.u64(),
  maker_receives_atomic: bcs.u64(),
  total_due_atomic: bcs.u64(),
  used_pack_count: bcs.u64(),
})

function sameObjectId(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/^0x0*/, '0x')
  return normalize(left) === normalize(right)
}

function requireU64(value: bigint, label: string): bigint {
  const max = (1n << 64n) - 1n
  if (value < 0n || value > max) throw new Error(`${label} is outside the u64 range`)
  return value
}

function validateCommerceV5Runtime(runtime: AnimacraftCommerceV5Runtime): void {
  requireNonEmpty(runtime.callablePackageId, 'commerce v5 callablePackageId')
  requireNonEmpty(runtime.typeOriginPackageId, 'commerce v5 typeOriginPackageId')
  requireNonEmpty(runtime.originalPackageId, 'commerce v5 originalPackageId')
  requireNonEmpty(runtime.paymentCoinType, 'commerce v5 paymentCoinType')
}

function appendCommerceV5SelectionValues(
  tx: Transaction,
  params: Pick<
    QuoteAnimacraftCompleteV5Params,
    'runtime' | 'recipe' | 'styleSelections'
  >,
): {
  recipe: TransactionObjectArgument
  styleSelections: TransactionObjectArgument
} {
  validateCommerceV5Runtime(params.runtime)
  if (params.recipe.length === 0) {
    throw new Error('Animacraft v5 recipe must contain at least one slot')
  }
  if (params.styleSelections.length !== params.recipe.length) {
    throw new Error('Every Animacraft v5 Recipe slot must have exactly one Style selection')
  }
  const recipeElements = params.recipe.map((slot, index) => {
    requireNonEmpty(slot.partKey, `recipe[${index}].partKey`)
    requireNonEmpty(slot.itemKey, `recipe[${index}].itemKey`)
    requireNonEmpty(slot.colorHex, `recipe[${index}].colorHex`)
    const renderOrder = requireU64(BigInt(slot.renderOrder), `recipe[${index}].renderOrder`)
    return asTransactionObjectArgument(tx.moveCall({
      target: `${params.runtime.callablePackageId}::animacraft::new_recipe_slot`,
      arguments: [
        tx.pure.string(slot.partKey),
        tx.pure.string(slot.itemKey),
        tx.pure.string(slot.colorHex),
        tx.pure.u64(renderOrder),
      ],
    }))
  })
  const styleElements = params.styleSelections.map((selection, index) => {
    requireNonEmpty(selection.partKey, `styleSelections[${index}].partKey`)
    requireNonEmpty(selection.itemKey, `styleSelections[${index}].itemKey`)
    requireNonEmpty(selection.styleKey, `styleSelections[${index}].styleKey`)
    if (
      selection.partKey !== params.recipe[index]?.partKey
      || selection.itemKey !== params.recipe[index]?.itemKey
    ) {
      throw new Error(`styleSelections[${index}] does not match its Recipe Part and Item`)
    }
    return asTransactionObjectArgument(tx.moveCall({
      target: `${params.runtime.callablePackageId}::commerce_v5::new_style_selection_v5`,
      arguments: [
        tx.pure.string(selection.partKey),
        tx.pure.string(selection.itemKey),
        tx.pure.string(selection.styleKey),
      ],
    }))
  })
  return {
    recipe: tx.makeMoveVec({
      type: `${params.runtime.originalPackageId}::animacraft::RecipeSlot`,
      elements: recipeElements,
    }),
    styleSelections: tx.makeMoveVec({
      type: `${params.runtime.typeOriginPackageId}::commerce_v5::StyleSelectionV5`,
      elements: styleElements,
    }),
  }
}

function devInspectReturnBytes(value: unknown): Uint8Array {
  const candidate = (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && 'bcs' in value
  )
    ? (value as { bcs?: unknown }).bcs
    : value
  if (candidate instanceof Uint8Array) return candidate
  if (typeof candidate === 'string') {
    const decoded = globalThis.atob(candidate)
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
  }
  if (Array.isArray(candidate)) {
    const payload = Array.isArray(candidate[0]) ? candidate[0] : candidate
    if (payload.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return Uint8Array.from(payload as number[])
    }
  }
  throw new Error('Sui did not return a readable Animacraft Complete quote')
}

/**
 * Executes the read-only commerce_v5::quote_complete_v5 Move function. Its
 * result authoritatively checks Base access, Pack activation, wallet-bound
 * Passes, per-wallet quota, total cap, and exact Style provenance.
 */
export async function simulateAnimacraftCompleteQuoteV5(
  client: {
    devInspectTransactionBlock(input: {
      sender: string
      transactionBlock: Transaction
    }): Promise<unknown>
  },
  params: QuoteAnimacraftCompleteV5Params,
): Promise<AnimacraftCompleteQuoteV5> {
  validateCommerceV5Runtime(params.runtime)
  requireNonEmpty(params.rootObjectId, 'MakerRootV5 object id')
  requireNonEmpty(params.legacyMakerObjectId, 'Legacy OCMaker object id')
  requireNonEmpty(params.protocolConfigObjectId, 'CommerceProtocolConfigV5 object id')
  requireNonEmpty(params.wallet, 'Complete wallet')
  const recipeHashBytes = await hashAnimacraftCompleteSelectionV5(
    params.recipe,
    params.styleSelections,
  )
  const tx = new Transaction()
  tx.setSender(params.wallet)
  const values = appendCommerceV5SelectionValues(tx, params)
  tx.moveCall({
    target: `${params.runtime.callablePackageId}::commerce_v5::quote_complete_v5`,
    arguments: [
      tx.object(params.rootObjectId),
      tx.object(params.legacyMakerObjectId),
      tx.object(params.protocolConfigObjectId),
      values.recipe,
      values.styleSelections,
      tx.pure.address(params.wallet),
    ],
  })
  const response = await client.devInspectTransactionBlock({
    sender: params.wallet,
    transactionBlock: tx,
  }) as {
    effects?: { status?: { status?: string; error?: string } }
    results?: Array<{ returnValues?: unknown[] }>
    error?: string
  }
  if (response.effects?.status?.status !== 'success') {
    throw new Error(
      response.effects?.status?.error
      || response.error
      || 'Animacraft v5 Complete quote failed on chain',
    )
  }
  // RecipeSlot and StyleSelection constructors precede quote_complete_v5;
  // dev-inspect returns one result entry per command, so the quote is the
  // final command result rather than index zero.
  const rawQuote = response.results?.at(-1)?.returnValues?.[0]
  const parsed = completeQuoteV5Bcs.parse(devInspectReturnBytes(rawQuote))
  const creatorChargeAtomic = BigInt(parsed.creator_charge_atomic)
  const protocolPercentageAtomic = BigInt(parsed.protocol_percentage_atomic)
  const fixedProtocolFeeAtomic = BigInt(parsed.fixed_protocol_fee_atomic)
  const makerReceivesAtomic = BigInt(parsed.maker_receives_atomic)
  const totalDueAtomic = BigInt(parsed.total_due_atomic)
  const expectedProtocolPercentage = (creatorChargeAtomic * 1_000n) / 10_000n
  if (
    fixedProtocolFeeAtomic !== params.protocolFixedCompleteFeeAtomic
    || protocolPercentageAtomic !== expectedProtocolPercentage
    || makerReceivesAtomic !== creatorChargeAtomic - protocolPercentageAtomic
    || totalDueAtomic !== creatorChargeAtomic + fixedProtocolFeeAtomic
  ) {
    throw new Error('Animacraft v5 Complete quote does not match the verified protocol policy')
  }
  return {
    rootObjectId: params.rootObjectId,
    rootOwnershipEpoch: params.rootOwnershipEpoch,
    legacyMakerObjectId: params.legacyMakerObjectId,
    makerTreasuryObjectId: params.makerTreasuryObjectId,
    protocolConfigObjectId: params.protocolConfigObjectId,
    protocolTreasuryObjectId: params.protocolTreasuryObjectId,
    protocolFixedCompleteFeeAtomic: params.protocolFixedCompleteFeeAtomic,
    wallet: params.wallet,
    creatorChargeAtomic,
    protocolPercentageAtomic,
    fixedProtocolFeeAtomic,
    makerReceivesAtomic,
    totalDueAtomic,
    usedPackCount: BigInt(parsed.used_pack_count),
    recipeHashBytes,
    quotedAtMs: Date.now(),
  }
}

/**
 * Appends Commerce v5 authorization to the caller's Soulidity mint PTB. The
 * non-drop authorization is returned and must be consumed immediately by
 * Soulidity's version-matched Animacraft v5 mint boundary in this exact
 * transaction.
 */
export async function appendAnimacraftCommerceV5Authorization(
  tx: Transaction,
  params: AppendAnimacraftCommerceV5AuthorizationParams,
): Promise<TransactionArgument> {
  validateCommerceV5Runtime(params.runtime)
  const quote = params.quote
  const contextPairs: Array<[string, string, string]> = [
    ['MakerRootV5', quote.rootObjectId, params.rootObjectId],
    ['legacy OCMaker', quote.legacyMakerObjectId, params.legacyMakerObjectId],
    ['MakerTreasuryV5', quote.makerTreasuryObjectId, params.makerTreasuryObjectId],
    ['CommerceProtocolConfigV5', quote.protocolConfigObjectId, params.protocolConfigObjectId],
    ['CommerceProtocolTreasuryV5', quote.protocolTreasuryObjectId, params.protocolTreasuryObjectId],
    ['wallet', quote.wallet, params.wallet],
  ]
  for (const [label, quoted, current] of contextPairs) {
    if (!sameObjectId(quoted, current)) {
      throw new Error(`Animacraft v5 ${label} changed after the Complete quote`)
    }
  }
  if (
    quote.rootOwnershipEpoch !== params.rootOwnershipEpoch
    || quote.protocolFixedCompleteFeeAtomic !== params.protocolFixedCompleteFeeAtomic
    || quote.fixedProtocolFeeAtomic !== params.protocolFixedCompleteFeeAtomic
  ) {
    throw new Error('Animacraft v5 Maker ownership or protocol fee changed after the quote')
  }
  const recipeHashBytes = await hashAnimacraftCompleteSelectionV5(
    params.recipe,
    params.styleSelections,
  )
  if (!equalAnimacraftRecipeHash(recipeHashBytes, quote.recipeHashBytes)) {
    throw new Error('Animacraft v5 Recipe or exact Style selection changed after the quote')
  }
  const txSender = tx.getData().sender
  if (txSender && !sameObjectId(txSender, params.wallet)) {
    throw new Error('Animacraft v5 quote wallet does not match the Soulidity transaction sender')
  }
  if (!txSender) tx.setSender(params.wallet)
  requireNonEmpty(params.name, 'name')
  requireNonEmpty(params.profileJsonBlobId, 'profileJsonBlobId')
  requireNonEmpty(params.imageBlobId, 'imageBlobId')
  requireNonEmpty(params.imageUrl, 'imageUrl')
  for (const [label, value] of [
    ['outputSealId', params.outputSealId],
    ['outputNonce', params.outputNonce],
    ['outputDigest', params.outputDigest],
  ] as const) {
    if (value.length !== 32) {
      throw new Error(`Animacraft v5 ${label} must contain exactly 32 bytes`)
    }
  }
  const values = appendCommerceV5SelectionValues(tx, params)
  const commonTail = [
    tx.pure.string(params.name),
    tx.pure.string(params.profileJsonBlobId),
    tx.pure.string(params.imageBlobId),
    tx.pure.string(params.imageUrl),
    tx.pure.vector('u8', Array.from(params.outputSealId)),
    tx.pure.vector('u8', Array.from(params.outputNonce)),
    tx.pure.vector('u8', Array.from(params.outputDigest)),
    tx.pure.vector('u8', Array.from(recipeHashBytes)),
    values.recipe,
    values.styleSelections,
    tx.object(SUI_CLOCK_OBJECT_ID),
  ]
  if (quote.totalDueAtomic === 0n) {
    return tx.moveCall({
      target: `${params.runtime.callablePackageId}::commerce_v5::authorize_complete_free_v5`,
      arguments: [
        tx.object(params.rootObjectId),
        tx.object(params.legacyMakerObjectId),
        tx.object(params.protocolConfigObjectId),
        ...commonTail,
      ],
    }) as unknown as TransactionArgument
  }
  requireU64(quote.totalDueAtomic, 'Complete quote total')
  const payment = buildExactPaymentCoin(
    tx,
    params.paymentCoinObjectIds ?? [],
    quote.totalDueAtomic,
  )
  return tx.moveCall({
    target: `${params.runtime.callablePackageId}::commerce_v5::authorize_complete_paid_v5`,
    typeArguments: [params.runtime.paymentCoinType],
    arguments: [
      tx.object(params.rootObjectId),
      tx.object(params.legacyMakerObjectId),
      tx.object(params.makerTreasuryObjectId),
      tx.object(params.protocolConfigObjectId),
      tx.object(params.protocolTreasuryObjectId),
      payment,
      ...commonTail,
    ],
  }) as unknown as TransactionArgument
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

function resolveAnimacraftV5SoulCreatorRoyaltyBps(
  terms: AnimacraftV5CommerceTerms,
): number {
  const soulCreatorRoyaltyBps = terms.soulCreatorRoyaltyBps
    ?? DEFAULT_ANIMACRAFT_V5_SOUL_CREATOR_ROYALTY_BPS
  if (
    !Number.isInteger(soulCreatorRoyaltyBps)
    || soulCreatorRoyaltyBps < 0
    || soulCreatorRoyaltyBps > MAX_ANIMACRAFT_V5_SOUL_CREATOR_ROYALTY_BPS
    || soulCreatorRoyaltyBps % ANIMACRAFT_V5_SOUL_CREATOR_ROYALTY_STEP_BPS !== 0
  ) {
    throw new Error(
      `soulCreatorRoyaltyBps must be between 0 and ${MAX_ANIMACRAFT_V5_SOUL_CREATOR_ROYALTY_BPS} `
        + `in ${ANIMACRAFT_V5_SOUL_CREATOR_ROYALTY_STEP_BPS} bps steps`,
    )
  }
  return soulCreatorRoyaltyBps
}

function resolveAnimacraftV5MakerSourceRoyaltyBps(
  terms: AnimacraftV5CommerceTerms,
): number {
  const makerSourceRoyaltyBps = terms.makerSourceRoyaltyBps
  if (
    !Number.isInteger(makerSourceRoyaltyBps)
    || makerSourceRoyaltyBps < 0
    || makerSourceRoyaltyBps > MAX_ANIMACRAFT_V5_MAKER_SOURCE_ROYALTY_BPS
    || makerSourceRoyaltyBps % ANIMACRAFT_V5_MAKER_SOURCE_ROYALTY_STEP_BPS !== 0
  ) {
    throw new Error(
      `makerSourceRoyaltyBps must be between 0 and ${MAX_ANIMACRAFT_V5_MAKER_SOURCE_ROYALTY_BPS} `
        + `in ${ANIMACRAFT_V5_MAKER_SOURCE_ROYALTY_STEP_BPS} bps steps`,
    )
  }
  return makerSourceRoyaltyBps
}

/** Mirror the exact floor-bps arithmetic used by the v5 Move quote. */
export function quoteAnimacraftV5SoulSale(
  priceAtomic: bigint,
  terms: AnimacraftV5CommerceTerms,
): AnimacraftV5SoulSaleQuote {
  if (priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }
  const soulCreatorRoyaltyBps = resolveAnimacraftV5SoulCreatorRoyaltyBps(terms)
  const makerSourceRoyaltyBps = resolveAnimacraftV5MakerSourceRoyaltyBps(terms)
  const totalAddOnBps = ANIMACRAFT_V5_PROTOCOL_FEE_BPS
    + makerSourceRoyaltyBps
    + soulCreatorRoyaltyBps
  if (
    makerSourceRoyaltyBps + soulCreatorRoyaltyBps
    > MAX_ANIMACRAFT_V5_RIGHTS_POOL_BPS
  ) {
    throw new Error(
      `Animacraft v5 rights royalties must not exceed `
        + `${MAX_ANIMACRAFT_V5_RIGHTS_POOL_BPS} bps`,
    )
  }
  if (totalAddOnBps > MAX_ANIMACRAFT_V5_ADD_ON_BPS) {
    throw new Error(`Animacraft v5 add-ons must not exceed ${MAX_ANIMACRAFT_V5_ADD_ON_BPS} bps`)
  }
  const bpsAmount = (bps: number) => (
    priceAtomic * BigInt(bps)
  ) / 10_000n
  const protocolFeeAtomic = bpsAmount(ANIMACRAFT_V5_PROTOCOL_FEE_BPS)
  const soulCreatorRoyaltyAtomic = bpsAmount(soulCreatorRoyaltyBps)
  const makerSourceRoyaltyAtomic = bpsAmount(makerSourceRoyaltyBps)
  return {
    priceAtomic,
    sellerPayoutAtomic: priceAtomic
      - protocolFeeAtomic
      - soulCreatorRoyaltyAtomic
      - makerSourceRoyaltyAtomic,
    protocolFeeAtomic,
    soulCreatorRoyaltyBps,
    soulCreatorRoyaltyAtomic,
    makerSourceRoyaltyBps,
    makerSourceRoyaltyAtomic,
  }
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
  const animacraftProtocolVersion = params.animacraftProtocolVersion ?? 4
  if (animacraftProtocolVersion !== 4 && animacraftProtocolVersion !== 5) {
    throw new Error('animacraftProtocolVersion must be 4 or 5')
  }
  if (animacraftProtocolVersion === 5) {
    requireNonEmpty(
      params.makerRootV5ObjectId ?? '',
      'commerce v5 MakerRootV5 object id',
    )
    requireNonEmpty(
      params.commerceV5ProtocolConfigObjectId ?? '',
      'commerce v5 protocol config object id',
    )
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
    throw new Error('createAuthorization did not return an Animacraft mint authorization')
  }

  const { initialContentVec, initialStateConfigVec } = buildInitialContentArgs(tx, packageId, {
    initialContent: params.initialContent,
    initialStateConfig: params.initialStateConfig,
  })
  const mintPrefix = [
    tx.object(marketConfigId),
    tx.object(kindRegistryId),
    tx.object(kioskRegistryId),
    tx.object(transferPolicyId),
    personalKiosk.buyerKiosk,
    personalKiosk.buyerKioskCap,
  ]
  const soulState = tx.moveCall({
    target: animacraftProtocolVersion === 5
      ? `${packageId}::market::mint_animacraft_v5_in_personal_kiosk_v2`
      : `${packageId}::market::mint_animacraft_in_personal_kiosk_v2`,
    arguments: animacraftProtocolVersion === 5
      ? [
          ...mintPrefix,
          tx.object(params.makerRootV5ObjectId!),
          tx.object(params.commerceV5ProtocolConfigObjectId!),
          authorization,
          tx.pure.string(params.description),
          initialContentVec,
          initialStateConfigVec,
          tx.object(SUI_CLOCK_OBJECT_ID),
        ]
      : [
          ...mintPrefix,
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
 * Build the transaction kind evaluated by Seal key servers for a protected
 * commerce-v5 Complete output. Move revalidates the immutable Root record,
 * both provenance objects, the Soul binding, and `SoulState.current_owner`.
 */
export function buildAnimacraftCompleteOutputSealApprovalTx(
  params: AnimacraftCompleteOutputSealApprovalTxParams,
): Transaction {
  if (params.completeOutputSealId.length !== 32) {
    throw new Error('Animacraft Complete output Seal ID must be exactly 32 bytes')
  }
  requireNonEmpty(params.makerRootV5ObjectId, 'makerRootV5ObjectId')
  requireNonEmpty(params.baseProvenanceObjectId, 'baseProvenanceObjectId')
  requireNonEmpty(params.outputProvenanceObjectId, 'outputProvenanceObjectId')
  requireNonEmpty(params.soulStateObjectId, 'soulStateObjectId')

  const packageId = getRequiredSoulidityEnv(
    'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
  )
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::animacraft_output_seal::seal_approve_animacraft_complete_output_v5`,
    arguments: [
      tx.pure.vector('u8', Array.from(params.completeOutputSealId)),
      tx.object(params.makerRootV5ObjectId),
      tx.object(params.baseProvenanceObjectId),
      tx.object(params.outputProvenanceObjectId),
      tx.object(params.soulStateObjectId),
    ],
  })
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
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID',
  )
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const buyerKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.buyerKioskId,
    buyerKioskCapOnChainId: params.buyerKioskCapOnChainId,
    registrationMarket: 'secondary-v6',
  })
  const paymentCoin = buildExactPaymentCoin(
    tx,
    params.paymentCoinObjectIds,
    params.totalAtomic,
  )

  tx.moveCall({
    target: params.collectionObjectId
      ? `${packageId}::market::buy_animacraft_soul_fixed_price_with_collection_v6`
      : `${packageId}::market::buy_animacraft_soul_fixed_price_v6`,
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

/**
 * Build the only supported v5 secondary-listing PTB. This deliberately uses
 * a distinct Move target from v4 and the generic listing builder; on chain it
 * requires provenance version 5, a valid dynamic Maker-source policy, and a
 * 2.5% protocol fee configuration before a purchase cap can be created.
 */
export function buildListAnimacraftV5SoulTx(
  params: ListAnimacraftV5SoulTxParams,
): Transaction {
  requireNonEmpty(params.currentKioskId, 'currentKioskId')
  requireNonEmpty(params.currentKioskCapOnChainId, 'currentKioskCapOnChainId')
  requireNonEmpty(params.stateObjectId, 'stateObjectId')
  requireNonEmpty(params.provenanceObjectId, 'provenanceObjectId')
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }
  // Validate the two immutable read-only snapshots before asking the wallet
  // to sign. Move independently re-reads both values from SoulState and
  // provenance; neither value is accepted as a listing argument.
  quoteAnimacraftV5SoulSale(params.priceAtomic, {
    soulCreatorRoyaltyBps: params.frozenSoulCreatorRoyaltyBps,
    makerSourceRoyaltyBps: params.makerSourceRoyaltyBps,
  })
  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered_v6`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })
  const listing = tx.moveCall({
    target: `${packageId}::market::list_animacraft_v5_soul_fixed_price_v6`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.provenanceObjectId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.stateObjectId),
      tx.pure.u64(params.priceAtomic),
    ],
  })
  tx.moveCall({
    target: `${packageId}::market::finalize_soul_listing`,
    arguments: [listing],
  })
  return tx
}

/**
 * Build the matching v5 gross-price purchase PTB. No mutable Maker or
 * Treasury object is accepted: Move reads both the source bps and original
 * Maker recipient from immutable provenance.
 */
export function buildBuyAnimacraftV5SoulTx(
  params: BuyAnimacraftV5SoulTxParams,
): Transaction {
  requireNonEmpty(params.sellerKioskId, 'sellerKioskId')
  requireNonEmpty(params.stateObjectId, 'stateObjectId')
  requireNonEmpty(params.listingObjectId, 'listingObjectId')
  requireNonEmpty(params.provenanceObjectId, 'provenanceObjectId')
  if (params.priceAtomic <= 0n) {
    throw new Error('priceAtomic must be positive')
  }

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const buyerKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.buyerKioskId,
    buyerKioskCapOnChainId: params.buyerKioskCapOnChainId,
    registrationMarket: 'secondary-v6',
  })
  const paymentCoin = buildExactPaymentCoin(tx, params.paymentCoinObjectIds, params.priceAtomic)
  tx.moveCall({
    target: `${packageId}::market::buy_animacraft_v5_soul_fixed_price_v6`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(transferPolicyId),
      tx.object(params.provenanceObjectId),
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

function appendAnimacraftV6Selections(
  tx: Transaction,
  context: AnimacraftV6SecondaryContext,
): TransactionArgument {
  requireNonEmpty(context.animacraftCallablePackageId, 'v6 Animacraft callable package id')
  requireNonEmpty(context.animacraftCompositionTypeOriginPackageId, 'v6 composition TypeOrigin package id')
  if (context.selections.length === 0) {
    throw new Error('Animacraft v6 secondary transfer requires at least one canonical loadout selection')
  }
  const elements = context.selections.map((selection, index) => {
    requireNonEmpty(selection.productId, `v6 selections[${index}].productId`)
    requireNonEmpty(selection.slotKey, `v6 selections[${index}].slotKey`)
    if (selection.subjectKind !== 1 && selection.subjectKind !== 2) {
      throw new Error('Animacraft v6 secondary transfer accepts only Soul-bound or embedded selections')
    }
    if (selection.ownedInstanceId) {
      throw new Error('Animacraft v6 secondary transfer rejects wallet-owned selection instances')
    }
    return asTransactionObjectArgument(tx.moveCall({
      target: `${context.animacraftCallablePackageId}::composition_v6::new_loadout_selection_v6`,
      arguments: [
        tx.pure.id(selection.productId),
        tx.pure.string(selection.slotKey),
        tx.pure.u8(selection.subjectKind),
        tx.pure.option('address', null),
      ],
    }))
  })
  return tx.makeMoveVec({
    type: `${context.animacraftCompositionTypeOriginPackageId}::composition_v6::LoadoutSelectionV6`,
    elements,
  })
}

function validateAnimacraftV6SecondaryContext(context: AnimacraftV6SecondaryContext): void {
  requireNonEmpty(context.compositionRegistryObjectId, 'v6 composition registry object id')
  requireNonEmpty(context.compositionConfigObjectId, 'v6 composition config object id')
  requireNonEmpty(context.commerceConfigObjectId, 'v6 commerce config object id')
  requireNonEmpty(context.makerProfileObjectId, 'v6 Maker profile object id')
  requireNonEmpty(context.makerRootObjectId, 'v6 Maker root object id')
  requireNonEmpty(context.appearanceObjectId, 'v6 appearance object id')
}

/** Build the only transfer-safe listing path for a Soul with dynamic field key 3. */
export function buildListAnimacraftV6SoulTx(
  params: ListAnimacraftV6SoulTxParams,
): Transaction {
  requireNonEmpty(params.currentKioskId, 'currentKioskId')
  requireNonEmpty(params.currentKioskCapOnChainId, 'currentKioskCapOnChainId')
  requireNonEmpty(params.stateObjectId, 'stateObjectId')
  requireNonEmpty(params.provenanceObjectId, 'provenanceObjectId')
  if (params.priceAtomic <= 0n) throw new Error('priceAtomic must be positive')
  validateAnimacraftV6SecondaryContext(params.v6)

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const tx = new Transaction()
  tx.moveCall({
    target: `${packageId}::market::ensure_personal_kiosk_registered_v6`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.currentKioskCapOnChainId),
    ],
  })
  const selections = appendAnimacraftV6Selections(tx, params.v6)
  const listing = tx.moveCall({
    target: `${packageId}::market::list_animacraft_v6_soul_fixed_price_v6`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(params.provenanceObjectId),
      tx.object(params.v6.compositionRegistryObjectId),
      tx.object(params.v6.compositionConfigObjectId),
      tx.object(params.v6.commerceConfigObjectId),
      tx.object(params.v6.makerProfileObjectId),
      tx.object(params.v6.makerRootObjectId),
      tx.object(params.currentKioskId),
      tx.object(params.currentKioskCapOnChainId),
      tx.object(params.stateObjectId),
      tx.object(params.v6.appearanceObjectId),
      selections,
      tx.pure.u64(params.priceAtomic),
    ],
  })
  tx.moveCall({
    target: `${packageId}::market::finalize_animacraft_v6_soul_listing`,
    arguments: [listing],
  })
  return tx
}

/** Build v6 settlement; the live canonical selections are rechecked on chain. */
export function buildBuyAnimacraftV6SoulTx(
  params: BuyAnimacraftV6SoulTxParams,
): Transaction {
  requireNonEmpty(params.sellerKioskId, 'sellerKioskId')
  requireNonEmpty(params.stateObjectId, 'stateObjectId')
  requireNonEmpty(params.listingObjectId, 'listingObjectId')
  requireNonEmpty(params.provenanceObjectId, 'provenanceObjectId')
  if (params.priceAtomic <= 0n) throw new Error('priceAtomic must be positive')
  validateAnimacraftV6SecondaryContext(params.v6)

  const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
  const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')
  const kioskRegistryId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID')
  const transferPolicyId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID')
  const tx = new Transaction()
  const buyerKiosk = buildBuyerKioskArgs(tx, {
    buyerKioskId: params.buyerKioskId,
    buyerKioskCapOnChainId: params.buyerKioskCapOnChainId,
    registrationMarket: 'secondary-v6',
  })
  const selections = appendAnimacraftV6Selections(tx, params.v6)
  const payment = buildExactPaymentCoin(tx, params.paymentCoinObjectIds, params.priceAtomic)
  tx.moveCall({
    target: `${packageId}::market::buy_animacraft_v6_soul_fixed_price_v6`,
    arguments: [
      tx.object(marketConfigId),
      tx.object(kioskRegistryId),
      tx.object(transferPolicyId),
      tx.object(params.provenanceObjectId),
      tx.object(params.v6.compositionRegistryObjectId),
      tx.object(params.v6.compositionConfigObjectId),
      tx.object(params.v6.commerceConfigObjectId),
      tx.object(params.v6.makerProfileObjectId),
      tx.object(params.v6.makerRootObjectId),
      tx.object(params.sellerKioskId),
      buyerKiosk.buyerKiosk,
      buyerKiosk.buyerKioskCap,
      tx.object(params.stateObjectId),
      tx.object(params.v6.appearanceObjectId),
      tx.object(params.listingObjectId),
      selections,
      payment,
    ],
  })
  finishBuyerKioskArgs(tx, buyerKiosk)
  return tx
}
