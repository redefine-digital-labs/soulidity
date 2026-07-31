/**
 * Soulidity market.move abort code catalog and runtime parser.
 *
 * The Sui SDK surfaces on-chain aborts as a string of the form:
 *   `MoveAbort(MoveLocation { module: ModuleId { address: 0x..., name: Identifier("market") }, ...`
 *   `function: <fn>, instruction: <i>, function_name: Some("<name>") }, <code>) ...`
 *
 * Some wallet integrations and the dapp-kit error class produce a different
 * shape, e.g. `Transaction resolution failed: MoveAbort in 3rd command, abort code: 14, in '<pkg>::market::<fn>'`.
 *
 * We extract `(module, function, code)` from either shape, look up the catalog,
 * and return a structured `MarketAbortInfo` so callers can surface a
 * recovery-aware message instead of the raw abort string.
 *
 * The catalog mirrors `move/soulidity/sources/market.move` constants. Keep it
 * in sync when adding or splitting error codes.
 */

import { assertSuiTxSucceeded, type SuiTxResultWithEffects } from './tx-result'

export type MarketErrorName =
  | 'EInvalidRecipient'
  | 'EInvalidPrice'
  | 'EPlatformFeeTooHigh'
  | 'EInactiveListing'
  | 'EListingKioskMismatch'
  | 'EListingSoulMismatch'
  | 'EIncorrectPaymentAmount'
  | 'EMissingPurchaseCap'
  | 'EUnauthorizedKioskAccess'
  | 'EQuoteOverflow'
  | 'ECombinedFeesTooHigh'
  | 'EMarketPaused'
  | 'EPersonalKioskAlreadyInitialized'
  | 'EPersonalKioskNotInitialized'
  | 'EPersonalKioskMismatch'
  | 'ECollectionMismatch'
  | 'ECollectionRightMismatch'
  | 'EAccessListStateMismatch'
  | 'ESourceAlreadyJoined'
  | 'EPaidAccessNotPurchasable'
  | 'EAccessListLinkageMismatch'
  | 'EListingStillActive'
  | 'EOldKioskNotEmpty'
  | 'EOldKioskMismatch'
  | 'ERebindSameKiosk'
  | 'EPaidAccessOwnerCannotPurchase'
  | 'EPersonalKioskCapMismatch'
  | 'ESoulCurrentKioskMismatch'
  | 'ESoulOwnerMismatch'
  | 'EKioskOwnerMismatch'
  | 'EListingSellerMismatch'
  | 'EListingStateMismatch'
  | 'EInitialEntryActiveNotSupported'
  | 'ENotSoulOwner'
  | 'EStateConfigKeyEmpty'
  | 'EInitialSoulDocCountMismatch'
  | 'EInitialSoulDocNameMismatch'
  | 'EInitialMemoryCountMismatch'
  | 'EInitialMemoryNameMismatch'
  | 'EInitialKindOpNotAllowedAtMint'
  | 'EPaidAccessKindMismatch'
  | 'EAnimacraftProtocolVersion'
  | 'EAnimacraftPayerMismatch'
  | 'EAnimacraftCoinTypeMismatch'
  | 'EAnimacraftAuthorizationMismatch'
  | 'EAnimacraftPurchasePathRequired'
  | 'EAnimacraftRoyaltyTooSmall'
  | 'EAnimacraftListingPathRequired'
  | 'ELegacyMarketMustBePaused'
  | 'EPrimaryPausedV2'
  | 'ESecondaryPausedV2'
  | 'EAnimacraftV5CommercePathRequired'
  | 'EAnimacraftV5ProtocolFeeMismatch'
  | 'EAnimacraftV5MakerRoyaltyMismatch'
  | 'EAnimacraftV5CreatorRoyaltyTooHigh'
  | 'EAnimacraftV5ListingMismatch'
  | 'EAnimacraftV5CreatorRoyaltyMismatch'

export interface MarketErrorEntry {
  readonly name: MarketErrorName
  /** One-line summary the UI can show as the toast title or main message. */
  readonly summary: string
  /** Optional recovery action the user can take. Empty string when none. */
  readonly recoveryHint: string
}

export const MARKET_ERROR_CATALOG: { readonly [code: number]: MarketErrorEntry } = {
  0: {
    name: 'EInvalidRecipient',
    summary: 'Invalid address (zero address not allowed).',
    recoveryHint: 'Refresh and retry; contact support if it persists.',
  },
  1: {
    name: 'EInvalidPrice',
    summary: 'Listing price must be greater than zero.',
    recoveryHint: 'Enter a positive price and retry.',
  },
  2: {
    name: 'EPlatformFeeTooHigh',
    summary: 'Platform fee exceeds the protocol cap.',
    recoveryHint: 'This is a protocol-level configuration error; contact support.',
  },
  3: {
    name: 'EInactiveListing',
    summary: 'This listing is no longer active.',
    recoveryHint: 'Refresh the marketplace — the Soul may have been sold or unlisted.',
  },
  4: {
    name: 'EListingKioskMismatch',
    summary: 'The kiosk you supplied is not the one this listing was created from.',
    recoveryHint: 'Use the seller’s original personal kiosk to cancel or update this listing.',
  },
  5: {
    name: 'EListingSoulMismatch',
    summary: 'Soul object does not match this listing.',
    recoveryHint: 'Refresh the page; the listing may reference a different Soul state.',
  },
  6: {
    name: 'EIncorrectPaymentAmount',
    summary: 'Payment amount does not match the listed price.',
    recoveryHint: 'Refresh the listing — the price may have changed since you opened it.',
  },
  7: {
    name: 'EMissingPurchaseCap',
    summary: 'Listing has no PurchaseCap (already cancelled or consumed).',
    recoveryHint: 'Refresh the marketplace.',
  },
  8: {
    name: 'EUnauthorizedKioskAccess',
    summary: 'Your PersonalKioskCap does not unlock the kiosk you passed in.',
    recoveryHint: 'Make sure the cap and kiosk belong to the same personal kiosk.',
  },
  9: {
    name: 'EQuoteOverflow',
    summary: 'Numeric overflow while computing fees.',
    recoveryHint: 'Lower the listing price; this is hit at extreme amounts.',
  },
  10: {
    name: 'ECombinedFeesTooHigh',
    summary: 'Combined platform + creator + collection royalty exceeds 100%.',
    recoveryHint: 'Lower one of the royalty parameters and retry.',
  },
  11: {
    name: 'EMarketPaused',
    summary: 'The marketplace is paused.',
    recoveryHint: 'Try again after the team resumes the market.',
  },
  12: {
    name: 'EPersonalKioskAlreadyInitialized',
    summary: 'A personal kiosk is already registered for this wallet.',
    recoveryHint: 'Use the existing kiosk; do not create another one.',
  },
  13: {
    name: 'EPersonalKioskNotInitialized',
    summary: 'No personal kiosk is registered for this wallet yet.',
    recoveryHint: 'Initialize a personal kiosk first.',
  },
  14: {
    name: 'EPersonalKioskMismatch',
    summary: 'Your wallet is registered with a different personal kiosk.',
    recoveryHint: 'Use the kiosk recorded in the registry. Contact support if you cannot recover the original cap.',
  },
  15: {
    name: 'ECollectionMismatch',
    summary: 'Soul does not belong to the supplied collection (or already does, depending on call).',
    recoveryHint: 'Refresh the page and verify the collection binding before retrying.',
  },
  16: {
    name: 'ECollectionRightMismatch',
    summary: 'Collection right object does not match this collection.',
    recoveryHint: 'Refresh and use the correct CollectionRight.',
  },
  19: {
    name: 'EAccessListStateMismatch',
    summary: 'Paid access list does not belong to this Soul state.',
    recoveryHint: 'Refresh the page.',
  },
  25: {
    name: 'ESourceAlreadyJoined',
    summary: 'This Soul has already been joined into the target.',
    recoveryHint: 'No action needed — the join already happened.',
  },
  28: {
    name: 'EPaidAccessNotPurchasable',
    summary: 'This paid access entry cannot be purchased because its price is not set.',
    recoveryHint: 'Refresh and verify the Soul has paid access configured.',
  },
  29: {
    name: 'EAccessListLinkageMismatch',
    summary: 'Paid access list linkage does not match the Soul state.',
    recoveryHint: 'Refresh the page.',
  },
  30: {
    name: 'EListingStillActive',
    summary: 'Cannot delete a listing while it is still active.',
    recoveryHint: 'Cancel the listing first, then delete.',
  },
  31: {
    name: 'EOldKioskNotEmpty',
    summary: 'Cannot rebind: the old kiosk still holds items.',
    recoveryHint: 'Move all Souls out of the old kiosk before rebinding to a new one.',
  },
  32: {
    name: 'EOldKioskMismatch',
    summary: 'The kiosk you passed as "old" is not the currently registered kiosk.',
    recoveryHint: 'Pass the kiosk recorded in the on-chain registry as the old kiosk.',
  },
  33: {
    name: 'ERebindSameKiosk',
    summary: 'Cannot rebind to the same kiosk you are already on.',
    recoveryHint: 'Provide a different personal kiosk to rebind to.',
  },
  35: {
    name: 'EPaidAccessOwnerCannotPurchase',
    summary: 'You already own this Soul; no need to purchase access.',
    recoveryHint: 'Use your owner privileges instead of purchasing.',
  },
  37: {
    name: 'EPersonalKioskCapMismatch',
    summary: 'A new PersonalKioskCap was created, but the registry still points at the original cap.',
    recoveryHint: 'Use the original cap recorded in the registry. Contact support if you cannot recover it.',
  },
  38: {
    name: 'ESoulCurrentKioskMismatch',
    summary: 'The Soul is not currently held in the kiosk you supplied.',
    recoveryHint: 'Refresh the page; the Soul may have been moved to a different kiosk.',
  },
  39: {
    name: 'ESoulOwnerMismatch',
    summary: 'You are not the current owner of this Soul or collection.',
    recoveryHint: 'It may have been sold or transferred. Refresh the page.',
  },
  40: {
    name: 'EKioskOwnerMismatch',
    summary: 'The personal kiosk you provided is not owned by the expected wallet.',
    recoveryHint: 'Ensure you are signed in with the wallet that owns the kiosk.',
  },
  41: {
    name: 'EListingSellerMismatch',
    summary: 'The seller wallet behind the kiosk has changed since the listing was created.',
    recoveryHint: 'The original seller must cancel or update this listing from their kiosk.',
  },
  42: {
    name: 'EListingStateMismatch',
    summary: 'The Soul state referenced by this listing has changed.',
    recoveryHint: 'Refresh the page; the listing may need to be recreated.',
  },
  43: {
    name: 'EInitialEntryActiveNotSupported',
    summary: 'This content kind cannot be marked active during mint.',
    recoveryHint: 'Refresh and retry with a supported active content kind.',
  },
  44: {
    name: 'ENotSoulOwner',
    summary: 'Only the current Soul owner can perform this action.',
    recoveryHint: 'Refresh and sign with the current owner wallet.',
  },
  45: {
    name: 'EStateConfigKeyEmpty',
    summary: 'State config key cannot be empty.',
    recoveryHint: 'Provide a non-empty config key and retry.',
  },
  46: {
    name: 'EInitialSoulDocCountMismatch',
    summary: 'Mint must include exactly one soul document entry.',
    recoveryHint: 'Refresh and retry the mint flow.',
  },
  47: {
    name: 'EInitialSoulDocNameMismatch',
    summary: 'Initial soul document entry uses the wrong canonical name.',
    recoveryHint: 'Refresh and retry the mint flow.',
  },
  48: {
    name: 'EInitialMemoryCountMismatch',
    summary: 'Mint must include at least one memory entry.',
    recoveryHint: 'Refresh and retry the mint flow.',
  },
  49: {
    name: 'EInitialMemoryNameMismatch',
    summary: 'Initial memory entry uses the wrong canonical name.',
    recoveryHint: 'Refresh and retry the mint flow.',
  },
  50: {
    name: 'EInitialKindOpNotAllowedAtMint',
    summary: 'Initial content entry is not allowed for this kind.',
    recoveryHint: 'Remove the unsupported entry and retry.',
  },
  51: {
    name: 'EPaidAccessKindMismatch',
    summary: 'Paid access is not configured for this content kind.',
    recoveryHint: 'Refresh and verify the selected paid access kind.',
  },
  52: {
    name: 'EAnimacraftProtocolVersion',
    summary: 'This Animacraft authorization uses an unsupported protocol version.',
    recoveryHint: 'Return to Animacraft and rebuild the Soul mint with the current Maker version.',
  },
  53: {
    name: 'EAnimacraftPayerMismatch',
    summary: 'The connected wallet did not create this Animacraft mint authorization.',
    recoveryHint: 'Reconnect the wallet used in Animacraft and restart the Soul mint.',
  },
  54: {
    name: 'EAnimacraftCoinTypeMismatch',
    summary: 'The Animacraft Maker is configured for a different payment coin.',
    recoveryHint: 'Refresh the Maker from Animacraft and retry with its configured USDC coin type.',
  },
  55: {
    name: 'EAnimacraftAuthorizationMismatch',
    summary: 'Animacraft provenance does not match this Soul, Maker, or treasury.',
    recoveryHint: 'Refresh the Soul and use the immutable provenance objects shown on its detail page.',
  },
  56: {
    name: 'EAnimacraftPurchasePathRequired',
    summary: 'Animacraft Souls must use the Maker royalty-aware purchase path.',
    recoveryHint: 'Refresh the listing and retry through the Soulidity marketplace.',
  },
  57: {
    name: 'EAnimacraftRoyaltyTooSmall',
    summary: 'The listing price is too small to settle the configured Maker royalty.',
    recoveryHint: 'Increase the listing price until the Maker royalty is at least one atomic USDC unit.',
  },
  58: {
    name: 'EAnimacraftListingPathRequired',
    summary: 'Animacraft Souls must use the provenance-aware listing path.',
    recoveryHint: 'Refresh the Soul detail page and list it again from Soulidity.',
  },
  59: {
    name: 'ELegacyMarketMustBePaused',
    summary: 'The legacy market must be paused before it can be retired.',
    recoveryHint: 'Pause the legacy market first, then retry the one-way retirement transaction.',
  },
  60: {
    name: 'EPrimaryPausedV2',
    summary: 'Primary Soul issuance is paused in the successor market.',
    recoveryHint: 'Wait for the protocol operator to enable primary issuance.',
  },
  61: {
    name: 'ESecondaryPausedV2',
    summary: 'Secondary Soul trading is paused in the successor market.',
    recoveryHint: 'Wait for the protocol operator to enable secondary trading.',
  },
  62: {
    name: 'EAnimacraftV5CommercePathRequired',
    summary: 'This Animacraft Soul must use the marketplace path matching its protocol version.',
    recoveryHint: 'Refresh the Soul and list or buy it through the current Animacraft v5 flow.',
  },
  63: {
    name: 'EAnimacraftV5ProtocolFeeMismatch',
    summary: 'Soulidity is not configured with the required 2.5% Animacraft v5 protocol fee.',
    recoveryHint: 'Pause the purchase and ask the protocol operator to verify the active market config.',
  },
  64: {
    name: 'EAnimacraftV5MakerRoyaltyMismatch',
    summary: 'The immutable Maker-source royalty is outside the supported 0–5% range or 0.5% steps.',
    recoveryHint: 'Return to the originating Maker version and verify its published royalty snapshot.',
  },
  65: {
    name: 'EAnimacraftV5CreatorRoyaltyTooHigh',
    summary: 'The Soul creator royalty is outside the supported 0–5% range or 0.5% steps.',
    recoveryHint: 'Choose a Soul creator royalty from 0% through 5% in 0.5% steps.',
  },
  66: {
    name: 'EAnimacraftV5ListingMismatch',
    summary: 'This listing was not created by the isolated Animacraft v5 market path.',
    recoveryHint: 'Cancel or refresh the listing, then create a new Animacraft v5 listing.',
  },
  67: {
    name: 'EAnimacraftV5CreatorRoyaltyMismatch',
    summary: 'The listing tried to change the Soul creator royalty frozen at the original v5 mint.',
    recoveryHint: 'Refresh the Soul and use its immutable creator royalty snapshot.',
  },
}

export interface MarketAbortInfo {
  readonly code: number
  readonly module: 'market'
  readonly functionName: string | null
  readonly entry: MarketErrorEntry
  /** Original raw message preserved for logging. */
  readonly raw: string
}

const MOVE_ABORT_PATTERN_FUNCTION =
  /MoveAbort.*?function_name:\s*Some\("([^"]+)"\).*?\}[,)\s]*([0-9]+)/s
const MOVE_ABORT_PATTERN_INSTRUCTION =
  /abort code:\s*(\d+)(?:[^']*'(?:0x)?[0-9a-f]*::([a-z_]+)::([a-z_0-9]+)')?/i

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * Best-effort extraction of `(module, function, code)` from a Sui MoveAbort error.
 * Returns `null` if the error does not look like a market-module abort.
 */
export function parseMarketAbort(error: unknown): MarketAbortInfo | null {
  const raw = getErrorMessage(error)
  if (!raw) return null

  let code: number | null = null
  let functionName: string | null = null
  let isMarketModule = false

  // Path 1: full SDK MoveAbort with structured `MoveLocation { module: ..., function_name: Some("...") }`.
  const matchFull = raw.match(MOVE_ABORT_PATTERN_FUNCTION)
  if (matchFull) {
    functionName = matchFull[1] ?? null
    const parsedCode = Number.parseInt(matchFull[2] ?? '', 10)
    if (Number.isFinite(parsedCode)) {
      code = parsedCode
    }
    // Confirm it is actually the market module.
    isMarketModule = /name:\s*Identifier\("market"\)/.test(raw)
      || /::market::/.test(raw)
  }

  // Path 2: dapp-kit "Transaction resolution failed: MoveAbort in Nth command, abort code: X, in '<pkg>::<mod>::<fn>'"
  if (code === null) {
    const matchShort = raw.match(MOVE_ABORT_PATTERN_INSTRUCTION)
    if (matchShort) {
      const parsedCode = Number.parseInt(matchShort[1] ?? '', 10)
      if (Number.isFinite(parsedCode)) {
        code = parsedCode
      }
      const moduleName = matchShort[2]
      const fn = matchShort[3]
      if (moduleName === 'market') {
        isMarketModule = true
        functionName = fn ?? null
      }
    }
  }

  if (code === null || !isMarketModule) return null

  const entry = MARKET_ERROR_CATALOG[code]
  if (!entry) return null

  return {
    code,
    module: 'market',
    functionName,
    entry,
    raw,
  }
}

function readEnhancedMarketAbortInfo(error: unknown): MarketAbortInfo | null {
  if (!error || typeof error !== 'object' || !('marketAbort' in error)) return null
  const marketAbort = (error as { marketAbort?: unknown }).marketAbort
  if (!marketAbort || typeof marketAbort !== 'object') return null

  const candidate = marketAbort as Partial<MarketAbortInfo>
  if (candidate.module !== 'market' || typeof candidate.code !== 'number') return null

  const entry = MARKET_ERROR_CATALOG[candidate.code]
  if (!entry) return null

  return {
    code: candidate.code,
    module: 'market',
    functionName: typeof candidate.functionName === 'string' ? candidate.functionName : null,
    entry,
    raw: typeof candidate.raw === 'string' ? candidate.raw : getErrorMessage(error),
  }
}

export function getMarketAbortInfo(error: unknown): MarketAbortInfo | null {
  const enhanced = readEnhancedMarketAbortInfo(error)
  if (enhanced) return enhanced
  const parsed = parseMarketAbort(error)
  if (parsed) return parsed
  if (error instanceof Error && error.cause && error.cause !== error) {
    return getMarketAbortInfo(error.cause)
  }
  return null
}

/** Render a user-facing message for an abort, including the recovery hint if any. */
export function formatMarketAbortMessage(info: MarketAbortInfo): string {
  const head = `${info.entry.summary} (market::${info.entry.name}, code ${info.code})`
  if (info.entry.recoveryHint) {
    return `${head} ${info.entry.recoveryHint}`
  }
  return head
}

/**
 * Wrap an error so its `message` carries the catalog summary. The original
 * error is preserved on `cause` for logs/debugging.
 *
 * Non-market or unrecognized errors are returned unchanged.
 */
export function enhanceMarketError(error: unknown): unknown {
  const info = parseMarketAbort(error)
  if (!info) return error
  const enhanced = new Error(formatMarketAbortMessage(info), { cause: error })
  enhanced.name = 'SoulidityMarketAbortError'
  // Attach structured info so UI layers can branch on the code if needed.
  Object.defineProperty(enhanced, 'marketAbort', {
    value: info,
    enumerable: false,
    writable: false,
  })
  return enhanced
}

export function enhanceSoulidityError(error: unknown): unknown {
  return enhanceCollectionError(enhanceMarketError(error))
}

export function assertSoulidityTxSucceeded(
  result: unknown,
  label: string,
): SuiTxResultWithEffects {
  try {
    return assertSuiTxSucceeded(result, label)
  } catch (error) {
    throw enhanceSoulidityError(error)
  }
}

// ── Collection module aborts ─────────────────────────────────────────────────
// Mirrors `move/soulidity/sources/collection.move` constants. Keep in sync
// when adding or splitting error codes. The HTTP status is what API routes
// should return; UI hooks read `code` / `entry.name` for localized copy.

export type CollectionErrorName =
  | 'EExtraRoyaltyTooHigh'
  | 'ENotCollectionCreator'
  | 'ECollectionLocked'
  | 'ECreatorMismatch'
  | 'ECollectionSupplyExceeded'
  | 'ESupplyCapInvalid'
  | 'ESoulCurrentlyListed'

export interface CollectionErrorEntry {
  readonly name: CollectionErrorName
  readonly summary: string
  readonly recoveryHint: string
  readonly httpStatus: number
}

export const COLLECTION_ERROR_CATALOG: { readonly [code: number]: CollectionErrorEntry } = {
  0: {
    name: 'EExtraRoyaltyTooHigh',
    summary: 'Collection extra royalty exceeds the protocol cap.',
    recoveryHint: 'Lower the collection royalty to within the cap (≤ 25%) and retry.',
    httpStatus: 400,
  },
  1: {
    name: 'ENotCollectionCreator',
    summary: 'Only the collection creator can perform this action.',
    recoveryHint: 'Sign in with the wallet that created this collection.',
    httpStatus: 403,
  },
  2: {
    name: 'ECollectionLocked',
    summary: 'This collection is locked and not tradeable.',
    recoveryHint: 'Locked collections cannot be re-listed or transferred.',
    httpStatus: 409,
  },
  3: {
    name: 'ECreatorMismatch',
    summary: 'Soul creator does not match the collection creator.',
    recoveryHint: 'Add a Soul minted by the same wallet that owns the collection.',
    httpStatus: 400,
  },
  4: {
    name: 'ECollectionSupplyExceeded',
    summary: 'Collection at maximum capacity',
    recoveryHint: 'This collection has reached its supply cap; no more Souls can be added.',
    httpStatus: 409,
  },
  5: {
    name: 'ESupplyCapInvalid',
    summary: 'Collection supply cap is invalid',
    recoveryHint: 'Supply cap must be at least 1, or unset for unlimited.',
    httpStatus: 400,
  },
  6: {
    name: 'ESoulCurrentlyListed',
    summary: 'This Soul is currently listed for sale.',
    recoveryHint: 'Cancel the active listing first, then bind the Soul into a collection.',
    httpStatus: 409,
  },
}

export interface CollectionAbortInfo {
  readonly code: number
  readonly module: 'collection'
  readonly functionName: string | null
  readonly entry: CollectionErrorEntry
  readonly raw: string
}

export function parseCollectionAbort(error: unknown): CollectionAbortInfo | null {
  const raw = getErrorMessage(error)
  if (!raw) return null

  let code: number | null = null
  let functionName: string | null = null
  let isCollectionModule = false

  const matchFull = raw.match(MOVE_ABORT_PATTERN_FUNCTION)
  if (matchFull) {
    functionName = matchFull[1] ?? null
    const parsedCode = Number.parseInt(matchFull[2] ?? '', 10)
    if (Number.isFinite(parsedCode)) {
      code = parsedCode
    }
    isCollectionModule = /name:\s*Identifier\("collection"\)/.test(raw)
      || /::collection::/.test(raw)
  }

  if (code === null) {
    const matchShort = raw.match(MOVE_ABORT_PATTERN_INSTRUCTION)
    if (matchShort) {
      const parsedCode = Number.parseInt(matchShort[1] ?? '', 10)
      if (Number.isFinite(parsedCode)) {
        code = parsedCode
      }
      const moduleName = matchShort[2]
      const fn = matchShort[3]
      if (moduleName === 'collection') {
        isCollectionModule = true
        functionName = fn ?? null
      }
    }
  }

  if (code === null || !isCollectionModule) return null

  const entry = COLLECTION_ERROR_CATALOG[code]
  if (!entry) return null

  return {
    code,
    module: 'collection',
    functionName,
    entry,
    raw,
  }
}

function readEnhancedCollectionAbortInfo(error: unknown): CollectionAbortInfo | null {
  if (!error || typeof error !== 'object' || !('collectionAbort' in error)) return null
  const abort = (error as { collectionAbort?: unknown }).collectionAbort
  if (!abort || typeof abort !== 'object') return null

  const candidate = abort as Partial<CollectionAbortInfo>
  if (candidate.module !== 'collection' || typeof candidate.code !== 'number') return null

  const entry = COLLECTION_ERROR_CATALOG[candidate.code]
  if (!entry) return null

  return {
    code: candidate.code,
    module: 'collection',
    functionName: typeof candidate.functionName === 'string' ? candidate.functionName : null,
    entry,
    raw: typeof candidate.raw === 'string' ? candidate.raw : getErrorMessage(error),
  }
}

export function getCollectionAbortInfo(error: unknown): CollectionAbortInfo | null {
  const enhanced = readEnhancedCollectionAbortInfo(error)
  if (enhanced) return enhanced
  const parsed = parseCollectionAbort(error)
  if (parsed) return parsed
  if (error instanceof Error && error.cause && error.cause !== error) {
    return getCollectionAbortInfo(error.cause)
  }
  return null
}

export function formatCollectionAbortMessage(info: CollectionAbortInfo): string {
  const head = `${info.entry.summary} (collection::${info.entry.name}, code ${info.code})`
  if (info.entry.recoveryHint) {
    return `${head} ${info.entry.recoveryHint}`
  }
  return head
}

export function enhanceCollectionError(error: unknown): unknown {
  const info = parseCollectionAbort(error)
  if (!info) return error
  const enhanced = new Error(formatCollectionAbortMessage(info), { cause: error })
  enhanced.name = 'SoulidityCollectionAbortError'
  Object.defineProperty(enhanced, 'collectionAbort', {
    value: info,
    enumerable: false,
    writable: false,
  })
  return enhanced
}
