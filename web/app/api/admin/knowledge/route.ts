import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { requireAdmin } from '@web/lib/auth/admin'

const VALID_CATEGORIES = ['MCP', 'Mac', 'Windows', 'Linux', 'Prompt', 'Agent调试', '其他']
const VALID_CONTENT_TYPES = ['教程', '踩坑记录', '最佳实践', '工具推荐']

export async function POST(req: NextRequest) {
  const { error: authError } = await requireAdmin()
  if (authError) return authError

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

    if (rawItem.status === 'kb_saved') {
      return NextResponse.json({ error: '该推文已保存为知识库条目' }, { status: 409 })
    }

    const systemMember = await prisma.member.findUnique({ where: { tgId: 'SYSTEM_KB_BOT' } })
    if (!systemMember) {
      return NextResponse.json({ error: '系统成员不存在' }, { status: 500 })
    }

    const post = await prisma.$transaction(async (tx) => {
      // Atomic claim: only succeeds if status is not yet 'kb_saved'
      const claimed = await tx.rawItem.updateMany({
        where: { id: rawItemId, status: { not: 'kb_saved' } },
        data: { status: 'kb_saved' },
      })
      if (claimed.count === 0) {
        throw new Error('ALREADY_SAVED')
      }

      return tx.post.create({
        data: {
          memberId: systemMember.id,
          title,
          content: rawItem.content ?? rawItem.title,
          tags: `${category},${contentType}`,
          type: 'knowledge',
          status: 'published',
          sourceUrl: rawItem.url,
        },
      })
    })

    return NextResponse.json({ success: true, id: post.id })
  } catch (err: any) {
    if (err?.message === 'ALREADY_SAVED') {
      return NextResponse.json({ error: '该推文已保存为知识库条目' }, { status: 409 })
    }
    console.error('Failed to save knowledge post:', err)
    return NextResponse.json({ error: '保存失败，请稍后重试' }, { status: 500 })
  }
}
