import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'

const VALID_CATEGORIES = ['MCP', 'Mac', 'Windows', 'Linux', 'Prompt', 'Agent调试', '其他']
const VALID_CONTENT_TYPES = ['教程', '踩坑记录', '最佳实践', '工具推荐']

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const contentType = searchParams.get('contentType')
  const q = searchParams.get('q')

  const where: any = { status: 'raw' }
  if (category) where.category = category
  if (contentType) where.contentType = contentType
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { content: { contains: q, mode: 'insensitive' } },
    ]
  }

  const entries = await prisma.knowledgeEntry.findMany({
    where,
    include: {
      sources: {
        include: {
          rawItem: { select: { url: true, sourceName: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { rawItemId, category, contentType, title } = body

    if (!rawItemId || !category || !contentType || !title) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 })
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: '无效的分类' }, { status: 400 })
    }

    if (!VALID_CONTENT_TYPES.includes(contentType)) {
      return NextResponse.json({ error: '无效的内容类型' }, { status: 400 })
    }

    const rawItem = await prisma.rawItem.findUnique({ where: { id: rawItemId } })
    if (!rawItem) {
      return NextResponse.json({ error: '推文不存在' }, { status: 404 })
    }

    const entry = await prisma.knowledgeEntry.create({
      data: {
        title,
        content: rawItem.content ?? rawItem.title,
        category,
        contentType,
        sources: {
          create: { rawItemId },
        },
      },
    })

    await prisma.rawItem.update({
      where: { id: rawItemId },
      data: { status: 'kb_saved' },
    })

    return NextResponse.json({ success: true, id: entry.id })
  } catch (err: any) {
    console.error('Failed to save knowledge entry:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
