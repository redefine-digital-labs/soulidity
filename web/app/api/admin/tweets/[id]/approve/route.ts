import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@web/lib/prisma'
import OpenAI from 'openai'

const SYSTEM_PROMPT = `你是一名专业的 AI×Web3 新闻编辑。
根据一条推文，生成一条结构化的中文新闻。
必须只返回合法 JSON，不要 markdown 代码块。`

function buildPrompt(content: string, meta: { author: string; display_name?: string; like_count: number; view_count: number; posted_at: string }): string {
  return `推文内容：${content}
作者：${meta.author}${meta.display_name ? ` (${meta.display_name})` : ''}
互动：${meta.like_count} likes, ${meta.view_count} views
发布时间：${meta.posted_at}

输出 JSON：
{
  "title": "中文新闻标题（20-40字）",
  "summary": "中文新闻摘要（50-150字），保持客观新闻语气，不要添加推文没有的信息"
}

如果推文信息量太少无法扩写为新闻，返回 {"title": null, "summary": null}`
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const item = await prisma.rawItem.findUnique({ where: { id } })
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (item.status !== 'pending_review') {
      return NextResponse.json({ error: `Invalid status: ${item.status}` }, { status: 400 })
    }

    const meta = item.rawData ? JSON.parse(item.rawData) : {}

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

    // Update RawItem with expanded content and move to 'new'
    await prisma.rawItem.update({
      where: { id },
      data: {
        title: result.title,
        content: result.summary,
        status: 'new',
      },
    })

    return NextResponse.json({ success: true, title: result.title, summary: result.summary })
  } catch (err: any) {
    console.error('Approve error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
