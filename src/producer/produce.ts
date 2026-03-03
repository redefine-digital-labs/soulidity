import pLimit from 'p-limit'
import type { PrismaClient } from '../db/database.js'
import type { LLMAdapter } from './llm.js'
import { getRawItemsByStatus, updateRawItemStatus, insertArticle, upsertCompany, linkArticleCompany } from '../db/database.js'

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

interface CompanyMention {
  name: string
  category: string
  description?: string
}

interface ProducedArticle {
  title_zh: string
  summary_zh: string
  analysis_zh: string | null
  tags: string[]
  companies?: CompanyMention[]
}

function parseResponse(text: string): ProducedArticle {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  const required = ['title_zh', 'summary_zh']
  for (const field of required) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`)
  }
  return parsed as ProducedArticle
}

export async function produceArticles(prisma: PrismaClient, llm: LLMAdapter, limit = 10, concurrency = 10): Promise<{ processed: number; succeeded: number; failed: number; fatalError: boolean }> {
  const items = await getRawItemsByStatus(prisma, 'deduped', limit)
  let succeeded = 0
  let failed = 0
  let fatalError = false

  // Mark all as processing upfront
  await Promise.all(items.map(item => updateRawItemStatus(prisma, item.id, 'processing')))

  const limit_ = pLimit(concurrency)
  await Promise.all(items.map(item => limit_(async () => {
    if (fatalError) {
      await updateRawItemStatus(prisma, item.id, 'deduped')
      return
    }
    try {
      const prompt = buildUserPrompt(item.title, item.content ?? '', item.url, item.source_name)
      const response = await llm.generate(SYSTEM_PROMPT, prompt)
      const article = parseResponse(response)

      const articleId = await insertArticle(prisma, {
        raw_item_id: item.id,
        title_zh: article.title_zh,
        title_en: article.title_zh,
        summary_zh: article.summary_zh,
        summary_en: article.summary_zh,
        analysis_zh: article.analysis_zh ?? null,
        analysis_en: null,
        tags: JSON.stringify(article.tags),
      })

      // Link companies (best-effort, don't fail the article)
      if (article.companies?.length) {
        try {
          for (const c of article.companies) {
            const companyId = await upsertCompany(prisma, c)
            await linkArticleCompany(prisma, articleId, companyId)
          }
        } catch (err) {
          console.error(`Failed to link companies for article ${articleId}:`, err)
        }
      }

      await updateRawItemStatus(prisma, item.id, 'produced')
      succeeded++
    } catch (err: any) {
      const status = err?.status
      if (status === 402 || status === 401 || status === 429) {
        console.error(`Fatal API error (${status}), stopping producer:`, err.message)
        await updateRawItemStatus(prisma, item.id, 'deduped')
        fatalError = true
        return
      }
      console.error(`Failed to produce article for ${item.id}:`, err)
      await updateRawItemStatus(prisma, item.id, 'rejected')
      failed++
    }
  })))

  return { processed: items.length, succeeded, failed, fatalError }
}

export { parseResponse, buildUserPrompt }
