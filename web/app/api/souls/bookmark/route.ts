import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireIdentity } from '@web/lib/auth/identity'
import { soulAssetSummarySelect, toSoulAssetSummaryList } from '@/lib/soulidity/repository'

export const dynamic = 'force-dynamic'

// GET /api/souls/bookmark
// Returns all bookmarked souls for the current authenticated user
export async function GET(_request: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const bookmarks = await prisma.bookmark.findMany({
    where: { memberId: identity!.memberId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      soulId: true,
      createdAt: true,
      soul: { select: soulAssetSummarySelect },
    },
  })

  const souls = toSoulAssetSummaryList(bookmarks.map((b) => b.soul))

  return NextResponse.json({ bookmarks: souls })
}

// POST /api/souls/bookmark
// Body: { soulId: string }
// Toggles bookmark. Returns { bookmarked: boolean }
export async function POST(request: NextRequest) {
  const { error, identity } = await requireIdentity()
  if (error) return error

  const body = await request.json()
  const soulId: string | undefined = body.soulId
  if (!soulId || typeof soulId !== 'string') {
    return NextResponse.json({ error: 'soulId required' }, { status: 400 })
  }

  // Verify soul exists
  const soul = await prisma.soulAsset.findUnique({
    where: { id: soulId },
    select: { id: true },
  })
  if (!soul) {
    return NextResponse.json({ error: 'Soul not found' }, { status: 404 })
  }

  const existing = await prisma.bookmark.findUnique({
    where: {
      memberId_soulId: {
        memberId: identity!.memberId,
        soulId,
      },
    },
  })

  let bookmarked: boolean
  if (existing) {
    try {
      await prisma.bookmark.delete({ where: { id: existing.id } })
    } catch (e: any) {
      if (e?.code !== 'P2025') throw e // already deleted by concurrent request
    }
    bookmarked = false
  } else {
    try {
      await prisma.bookmark.create({
        data: {
          memberId: identity!.memberId,
          soulId,
        },
      })
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e // already created by concurrent request
    }
    bookmarked = true
  }

  return NextResponse.json({ bookmarked })
}
