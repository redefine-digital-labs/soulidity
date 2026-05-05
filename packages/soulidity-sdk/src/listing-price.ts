/**
 * Shared listing-price validation for the single-Soul publish flow.
 *
 * The create preview form accepts decimal USDC input via
 * `parseDisplayAmountToAtomic(...)`, then mirrors the parsed positive atomic
 * string into create context. This validator owns the downstream atomic-string
 * contract that must hold before any paid Walrus register PTB is signed:
 *
 *  - `web/app/create/gas/page.tsx` calls this in its preflight, before
 *    `prepareSoulBlobsForBatchPublish(...)`, so a back-buttoned or
 *    direct-navigation user still cannot pay PTB1 with a missing, zero, or
 *    non-bigint atomic price.
 *  - `web/lib/hooks/use-publish.ts` keeps the same atomic parser as the final
 *    server-bound contract, preserving the same accepted shape and error
 *    messages for non-form callers.
 *
 * The preview form intentionally has a narrower input surface than this helper:
 * values that pass the decimal form parser become positive bigint strings, so
 * they remain safe for the gas-page and publish-hook assertions.
 */
export function assertListingPriceAtomic(value: string | null | undefined): bigint {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    throw new Error('listingPriceAtomic is required when listOnPublish is true')
  }
  let parsed: bigint
  try {
    parsed = BigInt(trimmed)
  } catch {
    throw new Error('listingPriceAtomic must be a bigint-compatible string of atomic USDC units')
  }
  if (parsed <= 0n) {
    throw new Error('listingPriceAtomic must be > 0')
  }
  return parsed
}

/**
 * Non-throwing form for UI gating. Returns the parsed bigint when valid,
 * or an error message string when the value would fail
 * `assertListingPriceAtomic`. Retained as a public SDK helper for callers that
 * already deal in atomic-unit strings and need a non-throwing check.
 */
export function validateListingPriceAtomic(value: string | null | undefined):
  | { ok: true, value: bigint }
  | { ok: false, error: string } {
  try {
    return { ok: true, value: assertListingPriceAtomic(value) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'listingPriceAtomic is invalid' }
  }
}
