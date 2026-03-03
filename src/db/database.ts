import { PrismaClient } from '../../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import type { RawItem, Article, RawItemStatus, ArticleStatus } from '../shared/types.js'

export type { PrismaClient }

export function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

// --- raw_items ---

export async function insertRawItem(
  prisma: PrismaClient,
  item: Omit<RawItem, 'id' | 'created_at' | 'status'>
): Promise<string | null> {
  try {
    const row = await prisma.rawItem.create({
      data: {
        sourceType: item.source_type,
        sourceName: item.source_name,
        title: item.title,
        url: item.url,
        titleHash: item.title_hash ?? null,
        content: item.content,
        language: item.language,
        score: item.score,
        rawData: item.raw_data,
      },
    })
    return row.id
  } catch (err: any) {
    if (err?.code === 'P2002') return null  // Unique constraint (URL duplicate)
    throw err
  }
}

export async function getRawItemsByStatus(prisma: PrismaClient, status: RawItemStatus, limit = 10): Promise<RawItem[]> {
  const rows = await prisma.rawItem.findMany({
    where: { status },
    orderBy: { score: 'desc' },
    take: limit,
  })
  return rows.map(toRawItem)
}

export async function updateRawItemStatus(prisma: PrismaClient, id: string, status: RawItemStatus): Promise<void> {
  await prisma.rawItem.update({ where: { id }, data: { status } })
}

// --- articles ---

export async function insertArticle(
  prisma: PrismaClient,
  article: Omit<Article, 'id' | 'created_at' | 'status'>
): Promise<string> {
  const row = await prisma.article.create({
    data: {
      rawItemId: article.raw_item_id,
      titleZh: article.title_zh,
      titleEn: article.title_en,
      summaryZh: article.summary_zh,
      summaryEn: article.summary_en,
      analysisZh: article.analysis_zh,
      analysisEn: article.analysis_en,
      tags: article.tags,
    },
  })
  return row.id
}

export async function getArticlesByStatus(prisma: PrismaClient, status: ArticleStatus, limit = 20): Promise<Article[]> {
  const rows = await prisma.article.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.map(toArticle)
}

export async function getArticleById(prisma: PrismaClient, id: string): Promise<Article | undefined> {
  const row = await prisma.article.findUnique({ where: { id } })
  return row ? toArticle(row) : undefined
}

export async function updateArticle(
  prisma: PrismaClient,
  id: string,
  fields: Partial<Pick<Article, 'title_zh' | 'title_en' | 'summary_zh' | 'summary_en' | 'analysis_zh' | 'analysis_en' | 'tags' | 'status'>>
): Promise<void> {
  if (Object.keys(fields).length === 0) return
  // Map snake_case keys from Article type to camelCase Prisma fields
  const data: Record<string, unknown> = {}
  if ('title_zh' in fields) data.titleZh = fields.title_zh
  if ('title_en' in fields) data.titleEn = fields.title_en
  if ('summary_zh' in fields) data.summaryZh = fields.summary_zh
  if ('summary_en' in fields) data.summaryEn = fields.summary_en
  if ('analysis_zh' in fields) data.analysisZh = fields.analysis_zh
  if ('analysis_en' in fields) data.analysisEn = fields.analysis_en
  if ('tags' in fields) data.tags = fields.tags
  if ('status' in fields) data.status = fields.status
  await prisma.article.update({ where: { id }, data })
}

// --- publications ---

export async function insertPublication(prisma: PrismaClient, articleId: string, channel: string, messageId: string): Promise<string> {
  const row = await prisma.publication.create({
    data: { articleId, channel, messageId, publishedAt: new Date() },
  })
  return row.id
}

// --- stats ---

export async function getStats(prisma: PrismaClient): Promise<{
  raw_new: number; raw_deduped: number; raw_duplicate: number;
  articles_draft: number; articles_reviewed: number; published_today: number
}> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [raw_new, raw_deduped, raw_duplicate, articles_draft, articles_reviewed, published_today] = await Promise.all([
    prisma.rawItem.count({ where: { status: 'new' } }),
    prisma.rawItem.count({ where: { status: 'deduped' } }),
    prisma.rawItem.count({ where: { status: 'duplicate' } }),
    prisma.article.count({ where: { status: 'draft' } }),
    prisma.article.count({ where: { status: 'reviewed' } }),
    prisma.publication.count({ where: { publishedAt: { gte: today } } }),
  ])
  return { raw_new, raw_deduped, raw_duplicate, articles_draft, articles_reviewed, published_today }
}

// --- Mappers: Prisma model → legacy snake_case types ---

function toRawItem(row: any): RawItem {
  return {
    id: row.id,
    source_type: row.sourceType,
    source_name: row.sourceName,
    title: row.title,
    url: row.url,
    title_hash: row.titleHash,
    content: row.content,
    language: row.language,
    score: row.score,
    status: row.status,
    raw_data: row.rawData,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}

function toArticle(row: any): Article {
  return {
    id: row.id,
    raw_item_id: row.rawItemId,
    title_zh: row.titleZh,
    title_en: row.titleEn,
    summary_zh: row.summaryZh,
    summary_en: row.summaryEn,
    analysis_zh: row.analysisZh,
    analysis_en: row.analysisEn,
    tags: row.tags,
    status: row.status,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}
