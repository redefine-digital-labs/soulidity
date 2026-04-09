import { NextResponse } from 'next/server'
import { isMultipleSuiWalletBindingsError } from '@web/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@web/lib/auth/sui-wallet'
import { resolveIdentity } from '@web/lib/auth/identity'
import { getAnonymousRateLimitFingerprint, getRequestIp, takeRateLimitToken } from '@web/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@/lib/soulidity/env'
import {
  OnChainVerificationError,
  quoteSoulPurchase,
} from '@/lib/soulidity/queries'
import { getCachedMarketConfig } from '@/lib/soulidity/market-config-cache'
import { findSoulAssetDetailByRouteId, toSoulAssetDetail } from '@/lib/soulidity/repository'

const SOUL_DETAIL_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const
const SOUL_DETAIL_NO_IP_RATE_LIMIT = {
  max: 120,
  windowMs: 60 * 1000,
} as const
let warnedMissingSoulDetailIp = false
export const dynamic = 'force-dynamic'

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
      console.warn('[soul-detail] Viewer wallet lookup is ambiguous; continuing without wallet-scoped fields', {
        error: walletLookup.error.message,
      })
    } else {
      console.warn('[soul-detail] Failed to resolve viewer wallets', {
        error: walletLookup.error,
      })
    }
  }

  let quote = null
  let platformFeeBps: number | null = null
  try {
    const packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')
    const marketConfigId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID')
    const config = await getCachedMarketConfig(marketConfigId, packageId)
    platformFeeBps = config.platformFeeBps
    if (soul.listingStatus === 'listed' && soul.listedPriceAtomic != null) {
      quote = quoteSoulPurchase(config, {
        priceAtomic: BigInt(soul.listedPriceAtomic.toString()),
        creatorRoyaltyBps: soul.creatorRoyaltyBps,
        collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
      })
    }
  } catch (detailError) {
    if (!(detailError instanceof OnChainVerificationError)) {
      console.warn('[soul-detail] Failed to fetch MarketConfig or compute Soulidity quote', detailError)
    }
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: identity?.memberId ?? null,
    viewerAddresses: viewerWalletAddresses,
    quote,
    platformFeeBps,
  })

  return NextResponse.json(detail)
}
