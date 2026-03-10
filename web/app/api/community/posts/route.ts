import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const direction = request.nextUrl.searchParams.get('direction')
  const sort = request.nextUrl.searchParams.get('sort') ?? 'latest'
  const type = request.nextUrl.searchParams.get('type')
  const directionId = request.nextUrl.searchParams.get('directionId')

  const where: any = { status: 'published' }
  if (direction) {
    where.direction = { slug: direction }
  }
  if (directionId) {
    where.directionId = directionId
  }
  if (type) {
    where.type = type
  }

  const orderBy: any = sort === 'popular' ? { likeCount: 'desc' } : { createdAt: 'desc' }

  const posts = await prisma.post.findMany({
    where,
    orderBy,
    take: 30,
    include: {
      member: { select: { id: true, tgName: true, avatar: true, level: true } },
      direction: { select: { nameZh: true, icon: true, slug: true } },
    },
  })

  return NextResponse.json(posts)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  if (!body.memberId || !body.title || !body.content) {
    return NextResponse.json({ error: 'memberId, title, content required' }, { status: 400 })
  }

  const post = await prisma.post.create({
    data: {
      memberId: body.memberId,
      directionId: body.directionId ?? null,
      title: body.title,
      content: body.content,
      tags: body.tags ? JSON.stringify(body.tags) : null,
      type: body.type ?? 'log',
    },
  })

  return NextResponse.json(post, { status: 201 })
}
