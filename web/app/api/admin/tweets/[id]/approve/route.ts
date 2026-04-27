import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/require-admin'
import { buildApprovedTweetUpdate, parseTweetMeta } from '@/lib/admin-tweet-review'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `你是一名专业的 AI×Web3 新闻编辑。
根据一条推文，生成一条结构化的中文新闻。
必须只返回合法 JSON，不要 markdown 代码块。`

function buildPrompt(content: string, meta: {
  author?: string
  display_name?: string
  like_count?: number
  view_count?: number
  posted_at?: string
}): string {
  return `推文内容：${content}
作者：${meta.author ?? 'unknown'}${meta.display_name ? ` (${meta.display_name})` : ''}
互动：${meta.like_count ?? 0} likes, ${meta.view_count ?? 0} views
发布时间：${meta.posted_at ?? 'unknown'}

输出 JSON：
{
  "title": "中文新闻标题（20-40字）",
  "summary": "中文新闻摘要（50-150字），保持客观新闻语气，不要添加推文没有的信息"
}

如果推文信息量太少无法扩写为新闻，返回 {"title": null, "summary": null}`
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authError } = await requireAdmin({ mutation: req })
  if (authError) return authError

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const tags: string[] = Array.isArray(body.tags)
    ? body.tags.map((t: unknown) => typeof t === 'string' ? t.trim() : '').filter(Boolean)
    : []

  try {
    if (tags.length === 0) {
      return NextResponse.json({ error: '请至少填写一个标签' }, { status: 400 })
    }

    const item = await prisma.rawItem.findUnique({ where: { id } })
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (item.status !== 'pending_review') {
      return NextResponse.json({ error: `Invalid status: ${item.status}` }, { status: 400 })
    }

    // Atomically claim the item to prevent concurrent approve/reject races.
    // The non-atomic precheck above is kept for fast UX feedback; the real
    // guard is this CAS update which succeeds only once.
    const claimed = await prisma.rawItem.updateMany({
      where: { id, status: 'pending_review' },
      data: { status: 'reviewing' },
    })
    if (claimed.count === 0) {
      return NextResponse.json({ error: 'Item already claimed by another action' }, { status: 409 })
    }

    const geminiKey = process.env.GEMINI_API_KEY
    const zaiKey = process.env.ZAI_API_KEY
    const apiKey = geminiKey ?? zaiKey
    if (!apiKey) {
      await prisma.rawItem.updateMany({
        where: { id, status: 'reviewing' },
        data: { status: 'pending_review' },
      }).catch(() => {})
      return NextResponse.json({ error: 'LLM API key not configured' }, { status: 500 })
    }

    const useGemini = !!geminiKey
    const meta = parseTweetMeta(item.rawData) ?? {}

    const client = new OpenAI({
      baseURL: useGemini
        ? 'https://generativelanguage.googleapis.com/v1beta/openai'
        : 'https://open.bigmodel.cn/api/paas/v4',
      apiKey,
    })

    const response = await client.chat.completions.create({
      model: useGemini ? 'gemini-2.5-flash' : 'glm-4.7',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(item.content ?? '', meta) },
      ],
    })

    const text = response.choices[0]?.message?.content
    if (!text) {
      await prisma.rawItem.updateMany({
        where: { id, status: 'reviewing' },
        data: { status: 'pending_review' },
      }).catch(() => {})
      return NextResponse.json({ error: 'Empty LLM response' }, { status: 500 })
    }

    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const result = JSON.parse(cleaned)

    if (!result.title || !result.summary) {
      await prisma.rawItem.updateMany({
        where: { id, status: 'reviewing' },
        data: { status: 'pending_review' },
      }).catch(() => {})
      return NextResponse.json({ error: 'LLM determined content too thin to expand' }, { status: 422 })
    }

    // Finalize the RawItem and create Article atomically
    const [, article] = await prisma.$transaction([
      prisma.rawItem.update({
        where: { id },
        data: buildApprovedTweetUpdate(item.rawData, {
          title: result.title,
          summary: result.summary,
          reviewedAt: new Date().toISOString(),
        }),
      }),
      prisma.article.create({
        data: {
          rawItemId: id,
          titleZh: result.title,
          titleEn: item.title,
          summaryZh: result.summary,
          summaryEn: item.content ?? '',
          tags: tags.length > 0 ? JSON.stringify(tags) : null,
          status: 'draft',
          pipelineStatus: 'completed',
        },
      }),
    ])

    return NextResponse.json({ success: true, title: result.title, summary: result.summary, articleId: article.id })
  } catch (err: unknown) {
    console.error('Approve error:', err)
    // Revert the CAS claim so the item can be retried
    await prisma.rawItem.updateMany({
      where: { id, status: 'reviewing' },
      data: { status: 'pending_review' },
    }).catch(() => {})
    return NextResponse.json({ error: '审核通过失败，请稍后重试' }, { status: 500 })
  }
}
