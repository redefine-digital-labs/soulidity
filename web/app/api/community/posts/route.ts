import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'
import { evaluateAchievements } from '@web/lib/community/achievements'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const sort = request.nextUrl.searchParams.get('sort') ?? 'latest'
  const type = request.nextUrl.searchParams.get('type')
  const tag = request.nextUrl.searchParams.get('tag')

  const where: any = { status: 'published' }
  if (type) {
    where.type = type
  }
  if (tag) {
    where.OR = [
      { tags: { equals: tag } },
      { tags: { startsWith: tag + ',' } },
      { tags: { endsWith: ',' + tag } },
      { tags: { contains: ',' + tag + ',' } },
    ]
  }

  const orderBy: any = sort === 'popular' ? { likeCount: 'desc' } : { createdAt: 'desc' }

  const posts = await prisma.post.findMany({
    where,
    orderBy,
    take: 30,
    include: {
      member: { select: { id: true, tgName: true, displayName: true, kind: true, avatar: true, level: true } },
    },
  })

  return NextResponse.json(posts)
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

  let normalizedTags: string | null = null
  if (body.tags !== undefined && body.tags !== null) {
    const tagParts = typeof body.tags === 'string'
      ? body.tags.split(',')
      : Array.isArray(body.tags) && body.tags.every((tag: unknown): tag is string => typeof tag === 'string')
        ? body.tags
        : null

    if (!tagParts) {
      return NextResponse.json({ error: 'tags must be a string or string[]' }, { status: 400 })
    }

    normalizedTags = tagParts.map((tag: string) => tag.trim()).filter(Boolean).join(',') || null
  }

  const VALID_POST_TYPES = ['log', 'question', 'knowledge']
  const postType = body.type ?? 'log'
  if (!VALID_POST_TYPES.includes(postType)) {
    return NextResponse.json({ error: `type must be one of: ${VALID_POST_TYPES.join(', ')}` }, { status: 400 })
  }

  const post = await prisma.post.create({
    data: {
      memberId: identity!.memberId,
      title,
      content,
      tags: normalizedTags,
      type: postType,
    },
  })

  // Fire-and-forget: evaluate achievements after post creation
  evaluateAchievements(identity!.memberId).catch(err =>
    console.error('Achievement evaluation failed:', err)
  )

  return NextResponse.json(post, { status: 201 })
}
