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

import { assertSuiTxSucceeded, type SuiTxResultWithEffects } from '@/lib/sui/tx-result'

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
  | 'EStateMismatch'
  | 'EAccessListStateMismatch'
  | 'EUpgradeCapNotTracked'
  | 'EUpgradeCapMismatch'
  | 'EUpgradesImmutable'
  | 'EUpgradeAlreadyPending'
  | 'EUpgradeNotPending'
  | 'ESourceAlreadyJoined'
  | 'EInvalidMetadataBinding'
  | 'EMetadataAssetsMissing'
  | 'EContentAccessNotPurchasable'
  | 'EAccessListLinkageMismatch'
  | 'EListingStillActive'
  | 'EOldKioskNotEmpty'
  | 'EOldKioskMismatch'
  | 'ERebindSameKiosk'
  | 'EAssetsRootAlreadyExists'
  | 'EContentAccessOwnerCannotPurchase'
  | 'ESkillsRootAlreadyExists'
  | 'EPersonalKioskCapMismatch'
  | 'ESoulCurrentKioskMismatch'
  | 'ESoulOwnerMismatch'
  | 'EKioskOwnerMismatch'
  | 'EListingSellerMismatch'
  | 'EListingStateMismatch'

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
    recoveryHint: 'Use the kiosk recorded in the registry, or rebind via /settings if the old kiosk is empty.',
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
  18: {
    name: 'EStateMismatch',
    summary: 'Soul state object does not match the Soul ID you passed in.',
    recoveryHint: 'Refresh the page; the Soul state may have been updated by another transaction.',
  },
  19: {
    name: 'EAccessListStateMismatch',
    summary: 'ContentAccessList does not belong to this Soul state.',
    recoveryHint: 'Refresh the page.',
  },
  20: {
    name: 'EUpgradeCapNotTracked',
    summary: 'Market upgrade cap is not tracked.',
    recoveryHint: 'Admin-only path; not user-actionable.',
  },
  21: {
    name: 'EUpgradeCapMismatch',
    summary: 'Provided upgrade cap does not match the tracked one.',
    recoveryHint: 'Admin-only path; not user-actionable.',
  },
  22: {
    name: 'EUpgradesImmutable',
    summary: 'Market upgrades are frozen.',
    recoveryHint: 'Admin-only path; not user-actionable.',
  },
  23: {
    name: 'EUpgradeAlreadyPending',
    summary: 'A market upgrade is already pending.',
    recoveryHint: 'Admin-only path; not user-actionable.',
  },
  24: {
    name: 'EUpgradeNotPending',
    summary: 'No market upgrade is currently pending.',
    recoveryHint: 'Admin-only path; not user-actionable.',
  },
  25: {
    name: 'ESourceAlreadyJoined',
    summary: 'This Soul has already been joined into the target.',
    recoveryHint: 'No action needed — the join already happened.',
  },
  26: {
    name: 'EInvalidMetadataBinding',
    summary: 'Metadata binding parameters are invalid.',
    recoveryHint: 'Refresh and verify the asset/version selection.',
  },
  27: {
    name: 'EMetadataAssetsMissing',
    summary: 'Required metadata assets are missing.',
    recoveryHint: 'Upload the required sprite/voice assets before binding.',
  },
  28: {
    name: 'EContentAccessNotPurchasable',
    summary: 'This Soul’s content access cannot be purchased (price not set or list mismatch).',
    recoveryHint: 'Verify the Soul has an active access price and refresh.',
  },
  29: {
    name: 'EAccessListLinkageMismatch',
    summary: 'ContentAccessList linkage does not match the Soul state.',
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
  34: {
    name: 'EAssetsRootAlreadyExists',
    summary: 'Soul already has an assets root.',
    recoveryHint: 'No action needed; assets are already initialized.',
  },
  35: {
    name: 'EContentAccessOwnerCannotPurchase',
    summary: 'You already own this Soul; no need to purchase access.',
    recoveryHint: 'Use your owner privileges instead of purchasing.',
  },
  36: {
    name: 'ESkillsRootAlreadyExists',
    summary: 'Soul already has a skills root.',
    recoveryHint: 'No action needed; skills are already initialized.',
  },
  37: {
    name: 'EPersonalKioskCapMismatch',
    summary: 'A new PersonalKioskCap was created, but the registry still points at the original cap.',
    recoveryHint: 'Use the original cap recorded in the registry, or rebind to the new kiosk via /settings (only allowed when the old kiosk is empty).',
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

export function assertSoulidityTxSucceeded(
  result: unknown,
  label: string,
): SuiTxResultWithEffects {
  try {
    return assertSuiTxSucceeded(result, label)
  } catch (error) {
    throw enhanceMarketError(error)
  }
}
