import { NextResponse } from 'next/server'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { resolveIdentity } from '@web/lib/auth/identity'
import { getAnonymousRateLimitFingerprint, getRequestIp, takeRateLimitToken } from '@web/lib/rate-limit'
import { OnChainVerificationError } from '@web/lib/souls/on-chain-verification'
import { getSoulPurchaseQuote } from '@web/lib/souls/purchase-quote'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@web/lib/souls/repository'
import { toSafeErrorDetails } from '@web/lib/souls/route-safety'

const SOUL_DETAIL_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const
const SOUL_DETAIL_NO_IP_RATE_LIMIT = {
  max: 120,
  windowMs: 60 * 1000,
} as const
const SOUL_DETAIL_QUOTE_CACHE_TTL_MS = 30_000
let warnedMissingSoulDetailIp = false
const soulDetailQuoteCache = new Map<string, {
  expiresAt: number
  promise: ReturnType<typeof getSoulPurchaseQuote>
}>()

const QUOTE_CACHE_MAX_SIZE = 500
let lastQuoteCachePrune = 0
const QUOTE_CACHE_PRUNE_INTERVAL_MS = 60_000

function pruneQuoteCacheIfNeeded() {
  const now = Date.now()
  if (now - lastQuoteCachePrune < QUOTE_CACHE_PRUNE_INTERVAL_MS && soulDetailQuoteCache.size < QUOTE_CACHE_MAX_SIZE) return
  lastQuoteCachePrune = now
  for (const [key, entry] of soulDetailQuoteCache) {
    if (entry.expiresAt <= now) soulDetailQuoteCache.delete(key)
  }
}

function getCachedSoulPurchaseQuote(listingObjectId: string) {
  const now = Date.now()
  pruneQuoteCacheIfNeeded()

  const cachedQuote = soulDetailQuoteCache.get(listingObjectId)
  if (cachedQuote && cachedQuote.expiresAt > now) {
    return cachedQuote.promise
  }

  soulDetailQuoteCache.delete(listingObjectId)

  let quotePromise: ReturnType<typeof getSoulPurchaseQuote>
  quotePromise = getSoulPurchaseQuote({ listingObjectId }).catch((error) => {
    if (soulDetailQuoteCache.get(listingObjectId)?.promise === quotePromise) {
      soulDetailQuoteCache.delete(listingObjectId)
    }
    throw error
  })

  soulDetailQuoteCache.set(listingObjectId, {
    expiresAt: now + SOUL_DETAIL_QUOTE_CACHE_TTL_MS,
    promise: quotePromise,
  })

  return quotePromise
}

function resolveSoulDetailRateLimit(headers: Headers, memberId: string | null) {
  const requestIp = getRequestIp(headers)
  if (requestIp) {
    return {
      key: `soul-detail:${requestIp}`,
      options: SOUL_DETAIL_RATE_LIMIT,
    }
  }

  if (memberId) {
    return {
      key: `soul-detail:member:${memberId}`,
      options: SOUL_DETAIL_RATE_LIMIT,
    }
  }

  const fingerprint = getAnonymousRateLimitFingerprint(headers)
  if (fingerprint) {
    if (!warnedMissingSoulDetailIp) {
      warnedMissingSoulDetailIp = true
      console.warn('[soul-detail] Client IP unavailable; falling back to an anonymous header fingerprint bucket')
    }

    return {
      key: `soul-detail:anon:${fingerprint}`,
      options: SOUL_DETAIL_NO_IP_RATE_LIMIT,
    }
  }

  if (!warnedMissingSoulDetailIp) {
    warnedMissingSoulDetailIp = true
    console.warn('[soul-detail] Client IP unavailable and anonymous fingerprint missing; rejecting request')
  }

  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const identity = await resolveIdentity()
  const rateLimitConfig = resolveSoulDetailRateLimit(request.headers, identity?.memberId ?? null)
  if (!rateLimitConfig) {
    return NextResponse.json(
      { error: 'Unable to determine client identity for rate limiting' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(SOUL_DETAIL_NO_IP_RATE_LIMIT.windowMs / 1000)) } },
    )
  }
  const rateLimit = await takeRateLimitToken(rateLimitConfig.key, rateLimitConfig.options)
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many soul detail requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const viewerWalletLookupPromise = identity
    ? getMemberSuiWalletAddresses(identity.memberId)
        .then((addresses) => ({ addresses, error: null as unknown }))
        .catch((error) => ({ addresses: [] as string[], error }))
    : Promise.resolve({ addresses: [] as string[], error: null as unknown })
  const soul = await findSoulAssetDetailByRouteId(id)

  if (!soul) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const walletLookup = await viewerWalletLookupPromise
  const viewerWalletAddresses = walletLookup.addresses
  if (walletLookup.error) {
    if (isMultipleSuiWalletBindingsError(walletLookup.error)) {
      console.warn('[soul-detail] Viewer wallet lookup is ambiguous; continuing without wallet-scoped fields', toSafeErrorDetails(walletLookup.error))
    } else {
      console.warn('[soul-detail] Failed to resolve viewer wallets', toSafeErrorDetails(walletLookup.error))
    }
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: identity?.memberId ?? null,
    viewerWalletAddresses,
  })

  if (soul.listingStatus === 'listed' && soul.listedPriceAtomic != null && soul.listingObjectOnChainId) {
    try {
      const quote = await getCachedSoulPurchaseQuote(soul.listingObjectOnChainId)
      detail.purchasePlatformFeeAtomic = quote.platformFeeAtomic.toString()
      detail.purchaseCreatorRoyaltyAtomic = quote.creatorRoyaltyAtomic.toString()
      detail.purchaseTotalAtomic = quote.totalAtomic.toString()
      detail.quotedPriceAtomic = quote.priceAtomic.toString()
    } catch (detailError) {
      if (!(detailError instanceof OnChainVerificationError)) {
        console.warn('[soul-detail] Failed to compute purchase fee', detailError)
      }
    }
  }

  return NextResponse.json(detail)
}
