import type { PrismaClient } from '../db/database.js'
import type { LLMAdapter } from './llm.js'
import { getRawItemsByStatus, updateRawItemStatus, insertArticle } from '../db/database.js'

const SYSTEM_PROMPT = `You are a professional AI×Web3 content editor.
Given raw source material, produce structured bilingual (Chinese + English) content.
Always respond with valid JSON only, no markdown fences.`

function buildUserPrompt(title: string, content: string, url: string, sourceName: string): string {
  return `Raw material:
Title: ${title}
Source: ${sourceName}
Content: ${content}
URL: ${url}

Output JSON with these exact fields:
{
  "title_zh": "Chinese title (one sentence summary)",
  "title_en": "English title",
  "summary_zh": "3-5 sentence Chinese summary, professional and accurate",
  "summary_en": "3-5 sentence English summary",
  "analysis_zh": "Deep analysis: what this means for AI×Web3",
  "analysis_en": "Deep analysis in English",
  "tags": ["tag1", "tag2", "tag3"]
}`
}

interface ProducedArticle {
  title_zh: string
  title_en: string
  summary_zh: string
  summary_en: string
  analysis_zh: string
  analysis_en: string
  tags: string[]
}

function parseResponse(text: string): ProducedArticle {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)
  const required = ['title_zh', 'title_en', 'summary_zh', 'summary_en']
  for (const field of required) {
    if (!parsed[field]) throw new Error(`Missing required field: ${field}`)
  }
  return parsed as ProducedArticle
}

export async function produceArticles(prisma: PrismaClient, llm: LLMAdapter, limit = 10): Promise<{ processed: number; succeeded: number; failed: number }> {
  const items = await getRawItemsByStatus(prisma, 'deduped', limit)
  let succeeded = 0
  let failed = 0

  for (const item of items) {
    await updateRawItemStatus(prisma, item.id, 'processing')
    try {
      const prompt = buildUserPrompt(item.title, item.content ?? '', item.url, item.source_name)
      const response = await llm.generate(SYSTEM_PROMPT, prompt)
      const article = parseResponse(response)

      await insertArticle(prisma, {
        raw_item_id: item.id,
        title_zh: article.title_zh,
        title_en: article.title_en,
        summary_zh: article.summary_zh,
        summary_en: article.summary_en,
        analysis_zh: article.analysis_zh,
        analysis_en: article.analysis_en,
        tags: JSON.stringify(article.tags),
      })

      await updateRawItemStatus(prisma, item.id, 'produced')
      succeeded++
    } catch (err: any) {
      const status = err?.status
      if (status === 402 || status === 401 || status === 429) {
        console.error(`Fatal API error (${status}), stopping producer:`, err.message)
        await updateRawItemStatus(prisma, item.id, 'deduped')
        break
      }
      console.error(`Failed to produce article for ${item.id}:`, err)
      await updateRawItemStatus(prisma, item.id, 'rejected')
      failed++
    }
  }

  return { processed: items.length, succeeded, failed }
}

export { parseResponse, buildUserPrompt }
