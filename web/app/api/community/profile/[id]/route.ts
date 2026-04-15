import { NextResponse } from 'next/server'
import { resolveIdentity } from '@web/lib/auth/identity'
import { prisma } from '@web/lib/prisma'
import { getAnonymousRateLimitFingerprint, getRequestIp, takeRateLimitToken } from '@web/lib/rate-limit'
import { serializeSoulPreviewImageList } from '@/lib/soulidity/serialization'
import { parseCommunityTags } from '@shared/community-tags'

export const dynamic = 'force-dynamic'

const COMMUNITY_PROFILE_RATE_LIMIT = {
  max: 60,
  windowMs: 60 * 1000,
} as const
const COMMUNITY_PROFILE_NO_IP_RATE_LIMIT = {
  max: 120,
  windowMs: 60 * 1000,
} as const
let warnedMissingCommunityProfileIp = false

function resolveCommunityProfileRateLimit(headers: Headers, memberId: string | null) {
  const requestIp = getRequestIp(headers)
  if (requestIp) {
    return {
      key: `community-profile:${requestIp}`,
      options: COMMUNITY_PROFILE_RATE_LIMIT,
    }
  }

  if (memberId) {
    return {
      key: `community-profile:member:${memberId}`,
      options: COMMUNITY_PROFILE_RATE_LIMIT,
    }
  }

  const fingerprint = getAnonymousRateLimitFingerprint(headers)
  if (fingerprint) {
    if (!warnedMissingCommunityProfileIp) {
      warnedMissingCommunityProfileIp = true
      console.warn('[community-profile] Client IP unavailable; falling back to an anonymous header fingerprint bucket')
    }
    return {
      key: `community-profile:anon:${fingerprint}`,
      options: COMMUNITY_PROFILE_NO_IP_RATE_LIMIT,
    }
  }

  if (!warnedMissingCommunityProfileIp) {
    warnedMissingCommunityProfileIp = true
    console.warn('[community-profile] Client IP unavailable and anonymous fingerprint missing; rejecting request')
  }

  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await resolveIdentity()
  const rateLimitConfig = resolveCommunityProfileRateLimit(request.headers, identity?.memberId ?? null)
  if (!rateLimitConfig) {
    return NextResponse.json(
      { error: 'Unable to determine client identity for rate limiting' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(COMMUNITY_PROFILE_NO_IP_RATE_LIMIT.windowMs / 1000)) } },
    )
  }
  const rateLimit = await takeRateLimitToken(
    rateLimitConfig.key,
    rateLimitConfig.options,
  )
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: 'Too many community profile requests, try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const isOwnProfile = identity?.memberId === id

  const member = await prisma.member.findUnique({
    where: { id },
    select: {
      id: true,
      tgName: true,
      displayName: true,
      kind: true,
      avatar: true,
      bio: true,
      level: true,
      exp: true,
      joinedAt: true,
      posts: {
        where: { status: 'published' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, title: true, content: true, tags: true, likeCount: true, commentCount: true, createdAt: true,
        },
      },
      achievements: {
        include: {
          achievement: true,
        },
      },
      walletBindings: {
        where: { chain: 'sui' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { address: true },
      },
      authoredSoulAssets: {
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          onChainId: true,
          name: true,
          description: true,
          imageUrl: true,
          tags: true,
          previewImages: true,
          creatorRoyaltyBps: true,
          listingObjectOnChainId: true,
          listedPriceAtomic: true,
          listingStatus: true,
          creatorAddress: true,
          currentOwnerAddress: true,
          currentKioskId: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  if (!member) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { walletBindings, authoredSoulAssets, ...rest } = member

  return NextResponse.json({
    ...rest,
    posts: rest.posts.map((post) => ({
      ...post,
      tags: parseCommunityTags(post.tags),
    })),
    primarySuiAddress: isOwnProfile ? (walletBindings[0]?.address ?? null) : null,
    uploadedSouls: serializeSoulPreviewImageList(authoredSoulAssets.map((soul) => {
      const serializedSoul = {
        ...soul,
        listedPriceAtomic: soul.listedPriceAtomic?.toString() ?? null,
        createdAt: soul.createdAt.toISOString(),
        updatedAt: soul.updatedAt.toISOString(),
      }
      if (isOwnProfile) {
        return serializedSoul
      }
      const { currentOwnerAddress: _currentOwnerAddress, currentKioskId: _currentKioskId, ...publicSoul } = serializedSoul
      return publicSoul
    })),
  })
}
