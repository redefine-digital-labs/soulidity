/**
 * Shared listing-price validation for the single-Soul publish flow.
 *
 * The same parser is used in three places so the form, the gas-page
 * preflight, and the publish hook all reject the same set of values
 * before any paid Walrus register PTB is signed:
 *
 *  - `web/app/create/preview/page.tsx` blocks the "Next: Pay Gas"
 *    transition when `listOnPublish` is true and the typed price would
 *    fail this parser.
 *  - `web/app/create/gas/page.tsx` calls this in its preflight, before
 *    `prepareSoulBlobsForBatchPublish(...)`, so a back-buttoned or
 *    direct-navigation user still cannot pay PTB1 with an invalid price.
 *  - `web/lib/hooks/use-publish.ts` keeps the same parser as the final
 *    server-bound contract — same accepted shape, same error messages.
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
 * `assertListingPriceAtomic`. Used by the preview page to decide whether
 * to enable "Next: Pay Gas" without rendering thrown exceptions.
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
