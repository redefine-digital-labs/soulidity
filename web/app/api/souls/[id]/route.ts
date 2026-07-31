import { NextResponse } from 'next/server'
import { isMultipleSuiWalletBindingsError } from '@/lib/auth/sui-wallet-errors'
import { getMemberSuiWalletAddresses } from '@/lib/auth/sui-wallet'
import { resolveIdentity } from '@/lib/auth/identity'
import { getAnonymousRateLimitFingerprint, getRequestIp, takeRateLimitToken } from '@/lib/rate-limit'
import { getRequiredSoulidityEnv } from '@soulidity/sdk'
import {
  getMarketConfigV2,
  getSoulListingObject,
  getSoulStateObject,
  getAnimacraftProvenanceForState,
  ANIMACRAFT_V5_PROTOCOL_FEE_BPS,
  OnChainVerificationError,
  quoteAnimacraftSoulPurchase,
  quoteAnimacraftV5SoulSale,
  quoteSoulPurchase,
  sameSuiValue,
} from '@soulidity/sdk'
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
  let currentOwnershipEpoch: number | null = null
  let packageId: string | null = null
  let animacraftProvenance = null
  try {
    packageId = getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
  } catch (detailError) {
    if (!(detailError instanceof OnChainVerificationError)) {
      console.warn('[soul-detail] Failed to resolve Soulidity package id', detailError)
    }
  }

  if (packageId) {
    try {
      const state = await getSoulStateObject(soul.stateOnChainId, packageId, {
        includeActiveGrants: false,
      })
      currentOwnershipEpoch = state.ownershipEpoch
    } catch (detailError) {
      if (!(detailError instanceof OnChainVerificationError)) {
        console.warn('[soul-detail] Failed to fetch SoulState ownership epoch', detailError)
      }
    }
    if (soul.provenanceKind === 'animacraft') {
      try {
        animacraftProvenance = await getAnimacraftProvenanceForState(
          soul.stateOnChainId,
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID'),
        )
      } catch (detailError) {
        console.warn('[soul-detail] Failed to resolve Animacraft provenance', detailError)
      }
    }
  }

  try {
    const listedPrice = soul.listedPriceAtomic != null ? BigInt(soul.listedPriceAtomic.toString()) : null
    if (soul.listingStatus === 'listed' && listedPrice != null && listedPrice > 0n) {
      if (soul.provenanceKind === 'animacraft') {
        if (!animacraftProvenance) {
          throw new OnChainVerificationError('Animacraft provenance is unavailable; checkout is disabled')
        }
        const config = await getMarketConfigV2(
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID'),
        )
        platformFeeBps = config.platformFeeBps
        if (animacraftProvenance.animacraftVersion === 5) {
          if (!config.secondaryEnabled || config.platformFeeBps !== ANIMACRAFT_V5_PROTOCOL_FEE_BPS) {
            throw new OnChainVerificationError('Animacraft v5 secondary trading is not enabled')
          }
          if (!soul.listingObjectOnChainId) {
            throw new OnChainVerificationError('Animacraft v5 listing object is unavailable')
          }
          const listing = await getSoulListingObject(
            soul.listingObjectOnChainId,
            getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID'),
          )
          if (
            listing.version !== 5
            || !listing.active
            || !sameSuiValue(listing.soulId, soul.onChainId)
            || !sameSuiValue(listing.stateId, soul.stateOnChainId)
            || listing.priceAtomic !== listedPrice
            || listing.collectionId !== null
          ) {
            throw new OnChainVerificationError('Animacraft v5 listing does not match the Soul')
          }
          const makerQuote = quoteAnimacraftV5SoulSale(listedPrice, {
            makerSourceRoyaltyBps: animacraftProvenance.makerRoyaltyBps,
            soulCreatorRoyaltyBps: listing.creatorRoyaltyBps,
          })
          quote = {
            priceAtomic: makerQuote.priceAtomic.toString(),
            platformFeeAtomic: makerQuote.protocolFeeAtomic.toString(),
            creatorRoyaltyAtomic: makerQuote.soulCreatorRoyaltyAtomic.toString(),
            collectionRoyaltyAtomic: '0',
            totalAtomic: makerQuote.priceAtomic.toString(),
            makerRoyaltyAtomic: makerQuote.makerSourceRoyaltyAtomic.toString(),
            makerRoyaltyBps: makerQuote.makerSourceRoyaltyBps,
            soulCreatorRoyaltyBps: makerQuote.soulCreatorRoyaltyBps,
            royaltySource: 'animacraft-maker' as const,
          }
        } else {
          const makerQuote = quoteAnimacraftSoulPurchase(config, {
            priceAtomic: listedPrice,
            makerRoyaltyBps: animacraftProvenance.makerRoyaltyBps,
            collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
          })
          quote = {
            ...makerQuote,
            creatorRoyaltyAtomic: makerQuote.makerRoyaltyAtomic,
            makerRoyaltyBps: animacraftProvenance.makerRoyaltyBps,
            royaltySource: 'animacraft-maker' as const,
          }
        }
      } else {
        const config = await getMarketConfigV2(
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID'),
          getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID'),
        )
        platformFeeBps = config.platformFeeBps
        quote = {
          ...quoteSoulPurchase(config, {
            priceAtomic: listedPrice,
            creatorRoyaltyBps: soul.creatorRoyaltyBps,
            collectionRoyaltyBps: soul.collection?.extraRoyaltyBps ?? 0,
          }),
          royaltySource: 'soul-creator' as const,
        }
      }
    }
  } catch (detailError) {
    if (!(detailError instanceof OnChainVerificationError)) {
      console.warn('[soul-detail] Failed to fetch MarketConfig or compute Soulidity quote', detailError)
    }
  }

  const detail = toSoulAssetDetail(soul, {
    viewerMemberId: identity?.memberId ?? null,
    viewerAddresses: viewerWalletAddresses,
    currentOwnershipEpoch,
    quote,
    platformFeeBps,
    animacraftProvenance,
  })

  return NextResponse.json(detail)
}
