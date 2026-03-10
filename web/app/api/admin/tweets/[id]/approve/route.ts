import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import { buildApprovedTweetUpdate, parseTweetMeta } from '@web/lib/admin-tweet-review'
import OpenAI from 'openai'

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
  const { id } = await params

  try {
    // Parse body for directionId (required)
    const body = await req.json().catch(() => ({}))
    const { directionId } = body as { directionId?: string }
    if (!directionId) {
      return NextResponse.json({ error: '必须选择关联方向' }, { status: 400 })
    }

    const item = await prisma.rawItem.findUnique({ where: { id } })
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (item.status !== 'pending_review') {
      return NextResponse.json({ error: `Invalid status: ${item.status}` }, { status: 400 })
    }

    const meta = parseTweetMeta(item.rawData) ?? {}

    // LLM expand
    const apiKey = process.env.ZAI_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'LLM API key not configured' }, { status: 500 })

    const client = new OpenAI({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey,
    })

    const response = await client.chat.completions.create({
      model: 'glm-4.7',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(item.content ?? '', meta) },
      ],
    })

    const text = response.choices[0]?.message?.content
    if (!text) return NextResponse.json({ error: 'Empty LLM response' }, { status: 500 })

    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const result = JSON.parse(cleaned)

    if (!result.title || !result.summary) {
      return NextResponse.json({ error: 'LLM determined content too thin to expand' }, { status: 422 })
    }

    // Update RawItem and create Article in a transaction
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
          status: 'published',
          pipelineStatus: 'completed',
          directionId,
        },
      }),
    ])

    return NextResponse.json({ success: true, title: result.title, summary: result.summary, articleId: article.id })
  } catch (err: any) {
    console.error('Approve error:', err)
    const message = err?.meta?.cause || err?.message || 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
