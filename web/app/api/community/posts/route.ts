import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireIdentity, resolveIdentity } from '@/lib/auth/identity'
import { evaluateAchievements } from '@/lib/community/achievements'
import { takeRateLimitToken, getRequestIp, getAnonymousRateLimitFingerprint } from '@/lib/rate-limit'
import { normalizeCommunityTags, parseCommunityTags } from '@shared/community-tags'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_OPTS = { max: 30, windowMs: 60_000 }

function toCommunityPostResponse<T extends { tags: string[] | string | null }>(post: T) {
  return {
    ...post,
    tags: parseCommunityTags(post.tags),
  }
}

export async function GET(request: NextRequest) {
  const ip = getRequestIp(request.headers) ?? getAnonymousRateLimitFingerprint(request.headers)
  if (ip) {
    const { limited } = await takeRateLimitToken(`posts:${ip}`, RATE_LIMIT_OPTS)
    if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const sort = request.nextUrl.searchParams.get('sort') ?? 'latest'
  const type = request.nextUrl.searchParams.get('type')
  const tag = request.nextUrl.searchParams.get('tag')
  const channel = request.nextUrl.searchParams.get('channel')
  const timeRange = request.nextUrl.searchParams.get('timeRange')

  const where: any = { status: 'published' }
  if (type) {
    where.type = type
  }
  if (channel) {
    where.channel = channel
  }
  if (tag) {
    where.tags = { has: tag }
  }
  if (timeRange) {
    const cutoffMs: Record<string, number> = {
      past_hour: 3_600_000,
      today: 86_400_000,
      this_week: 7 * 86_400_000,
      this_month: 30 * 86_400_000,
    }
    if (cutoffMs[timeRange]) {
      where.createdAt = { gte: new Date(Date.now() - cutoffMs[timeRange]) }
    }
  }

  const orderBy: any = sort === 'popular' ? { likeCount: 'desc' }
    : sort === 'discussed' ? { commentCount: 'desc' }
    : { createdAt: 'desc' }

  const posts = await prisma.post.findMany({
    where,
    orderBy,
    take: 30,
    include: {
      member: { select: { id: true, tgName: true, displayName: true, kind: true, avatar: true, level: true } },
    },
  })

  // Attach per-user vote direction if authenticated
  const identity = await resolveIdentity()
  if (identity && posts.length > 0) {
    const postIds = posts.map((post) => post.id)
    const votes = await prisma.postVote.findMany({
      where: { postId: { in: postIds }, memberId: identity.memberId },
      select: { postId: true, direction: true },
    })
    const voteMap = new Map(votes.map((v) => [v.postId, v.direction]))
    const enriched = posts.map((post) => ({
      ...toCommunityPostResponse(post),
      userVote: voteMap.get(post.id) ?? null,
    }))
    return NextResponse.json(enriched)
  }

  return NextResponse.json(posts.map((post) => ({
    ...toCommunityPostResponse(post),
    userVote: null,
  })))
}

export async function POST(request: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const body = await request.json()
  if (!body.title || typeof body.title !== 'string' || !body.content || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'title, content required' }, { status: 400 })
  }

  const title = body.title.trim()
  const content = body.content.trim()
  if (title.length === 0 || title.length > 500) {
    return NextResponse.json({ error: 'title must be 1-500 characters' }, { status: 400 })
  }
  if (content.length === 0 || content.length > 50_000) {
    return NextResponse.json({ error: 'content must be 1-50000 characters' }, { status: 400 })
  }

  let normalizedTags: string[] = []
  if (body.tags !== undefined && body.tags !== null) {
    const inputTags = typeof body.tags === 'string'
      ? body.tags
      : Array.isArray(body.tags) && body.tags.every((tag: unknown): tag is string => typeof tag === 'string')
        ? body.tags
        : undefined

    if (inputTags === undefined) {
      return NextResponse.json({ error: 'tags must be a string or string[]' }, { status: 400 })
    }

    normalizedTags = normalizeCommunityTags(inputTags)
  }

  const VALID_POST_TYPES = ['log', 'question', 'knowledge']
  const postType = body.type ?? 'log'
  if (!VALID_POST_TYPES.includes(postType)) {
    return NextResponse.json({ error: `type must be one of: ${VALID_POST_TYPES.join(', ')}` }, { status: 400 })
  }

  // 'news' channel is reserved for backend article sync (syncArticleToPost)
  const VALID_CHANNELS = ['general', 'questions']
  const postChannel = body.channel ?? 'general'
  if (!VALID_CHANNELS.includes(postChannel)) {
    return NextResponse.json({ error: `channel must be one of: ${VALID_CHANNELS.join(', ')}` }, { status: 400 })
  }

  const post = await prisma.post.create({
    data: {
      memberId: identity!.memberId,
      title,
      content,
      tags: normalizedTags,
      type: postType,
      channel: postChannel,
    },
  })

  // Fire-and-forget: evaluate achievements after post creation
  evaluateAchievements(identity!.memberId).catch(err =>
    console.error('Achievement evaluation failed:', err)
  )

  return NextResponse.json(toCommunityPostResponse(post), { status: 201 })
}
