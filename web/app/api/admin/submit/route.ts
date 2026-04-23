import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { prisma } from '@/lib/prisma'
import { scrapeUrl } from '@/lib/scraper'
import { requireAdmin } from '@/lib/auth/require-admin'

export const dynamic = 'force-dynamic'

// --- Score (inline from src/collector/score.ts) ---

const KEYWORDS: { pattern: RegExp; weight: number }[] = [
  { pattern: /ai\s*agent/i, weight: 3 },
  { pattern: /web3\s*ai|ai\s*web3/i, weight: 3 },
  { pattern: /defi\s*ai|ai\s*defi/i, weight: 3 },
  { pattern: /on-?chain\s*ai/i, weight: 3 },
  { pattern: /llm\s*blockchain/i, weight: 3 },
  { pattern: /artificial\s*intelligence/i, weight: 1 },
  { pattern: /smart\s*contract/i, weight: 1 },
  { pattern: /defi/i, weight: 1 },
  { pattern: /machine\s*learning/i, weight: 1 },
  { pattern: /crypto/i, weight: 0.5 },
  { pattern: /blockchain/i, weight: 0.5 },
  { pattern: /nft/i, weight: 0.5 },
]

function scoreItem(title: string, content: string): number {
  const text = `${title} ${content}`.toLowerCase()
  let score = 0
  for (const { pattern, weight } of KEYWORDS) {
    if (pattern.test(text)) score += weight
  }
  return score
}

// --- LLM Produce (inline from src/producer/) ---

const SYSTEM_PROMPT = `你是一名专业的 AI×Web3 内容编辑。
根据原始素材，产出结构化的中文新闻内容。
必须只返回合法 JSON，不要 markdown 代码块。`

function buildUserPrompt(title: string, content: string, url: string, sourceName: string): string {
  return `原始素材：
标题：${title}
来源：${sourceName}
内容：${content}
链接：${url}

输出 JSON，字段如下：
{
  "title_zh": "中文标题，一句话概括",
  "summary_zh": "3-5句中文摘要，专业准确",
  "analysis_zh": "深度解读：这对 AI×Web3 意味着什么",
  "tags": ["tag1", "tag2", "tag3"],
  "companies": [
    {"name": "公司官方英文名称", "category": "赛道分类", "description": "一句中文简介"}
  ]
}

companies 规则：
- 只提取新闻中明确提及的公司或项目，不要推测
- name 必须是公司官方名称（如 "OpenAI" 而非 "Open AI"）
- category 只能是：AI、DeFi、Infrastructure、L1/L2、Gaming、NFT、DAO、Exchange、Wallet、Other
- 没有提及公司则返回空数组 []`
}

interface ProducedArticle {
  title_zh: string
  summary_zh: string
  analysis_zh: string | null
  tags: string[]
  companies?: { name: string; category: string; description?: string }[]
}

function parseResponse(text: string): ProducedArticle {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  for (const field of ['title_zh', 'summary_zh']) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`)
  }
  return parsed as ProducedArticle
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

// --- API Route ---

const llmClient = new OpenAI({
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: process.env.ZAI_API_KEY ?? '',
})

export async function POST(req: NextRequest) {
  let rawItemId: string | undefined
  try {
    const { error: authError } = await requireAdmin()
    if (authError) return authError

    const body = await req.json()
    const url: string | undefined = body.url
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 })

    let title: string = body.title || ''
    let content: string = body.content || ''

    // If no title/content provided, scrape the URL
    if (!title || !content) {
      try {
        const scraped = await scrapeUrl(url)
        title = title || scraped.title
        content = content || scraped.content
      } catch (err: unknown) {
        const msg = err instanceof Error && (err.message?.includes('HTTPS') || err.message?.includes('private'))
          ? err.message
          : 'Failed to scrape URL'
        return NextResponse.json({ error: msg }, { status: 422 })
      }
    }

    // Score
    const score = scoreItem(title, content)

    // Insert raw_item (status='deduped' to skip dedup step)
    try {
      const row = await prisma.rawItem.create({
        data: {
          sourceType: 'manual',
          sourceName: 'Manual',
          title,
          url,
          content,
          language: 'en',
          score,
          status: 'deduped',
        },
      })
      rawItemId = row.id
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'P2002') {
        return NextResponse.json({ error: 'URL already submitted' }, { status: 409 })
      }
      throw err
    }

    // LLM produce
    if (!process.env.ZAI_API_KEY) {
      // Clean up the orphaned raw_items row so the same URL can be retried
      if (rawItemId) {
        await prisma.rawItem.delete({ where: { id: rawItemId } }).catch(() => {})
      }
      return NextResponse.json({ error: 'LLM API key not configured' }, { status: 500 })
    }

    await prisma.rawItem.update({ where: { id: rawItemId }, data: { status: 'processing' } })

    const prompt = buildUserPrompt(title, content, url, 'Manual')
    const response = await llmClient.chat.completions.create({
      model: 'glm-4.7',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    })

    const llmText = response.choices[0]?.message?.content
    if (!llmText) throw new Error('Empty response from LLM')

    const article = parseResponse(llmText)

    // Insert article
    const articleRow = await prisma.article.create({
      data: {
        rawItemId,
        titleZh: article.title_zh,
        titleEn: article.title_zh,
        summaryZh: article.summary_zh,
        summaryEn: article.summary_zh,
        analysisZh: article.analysis_zh ?? null,
        analysisEn: null,
        tags: JSON.stringify(article.tags),
      },
    })

    // Link companies (best-effort)
    if (article.companies?.length) {
      try {
        for (const c of article.companies) {
          const slug = toSlug(c.name)
          const company = await prisma.company.upsert({
            where: { slug },
            create: { name: c.name, slug, category: c.category, description: c.description ?? null, mentionCount: 1 },
            update: { mentionCount: { increment: 1 } },
          })
          await prisma.articleCompany.create({
            data: { articleId: articleRow.id, companyId: company.id },
          }).catch(() => {}) // ignore if already linked
        }
      } catch (err) {
        console.error('Failed to link companies:', err)
      }
    }

    await prisma.rawItem.update({ where: { id: rawItemId }, data: { status: 'produced' } })

    return NextResponse.json({
      success: true,
      articleId: articleRow.id,
      title: article.title_zh,
    })
  } catch (err: unknown) {
    console.error('Submit error:', err)
    // Clean up the orphaned raw_items row so the same URL can be retried
    if (rawItemId) {
      await prisma.rawItem.delete({ where: { id: rawItemId } }).catch(() => {})
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
