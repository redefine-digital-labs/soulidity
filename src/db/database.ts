import { PrismaClient } from '../../generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import type { RawItem, Article, RawItemStatus, ArticleStatus, CollectorState } from '../shared/types.js'
import { normalizeUrl } from '../shared/dedup.js'
import { isTransientPrismaConnectionError } from '../shared/prisma-errors.js'

export type { PrismaClient }

function buildPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

function isModelDelegate(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false

  return [
    'findUnique',
    'findFirst',
    'findMany',
    'create',
    'update',
    'updateMany',
    'upsert',
    'count',
    'delete',
  ].some((method) => typeof (value as Record<string, unknown>)[method] === 'function')
}

export function createPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  let current = buildPrismaClient(connectionString)
  let disconnected = false
  const delegateCache = new Map<PropertyKey, object>()

  const IDEMPOTENT_METHODS = new Set([
    'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
    'findMany', 'count', 'aggregate', 'groupBy',
  ])

  const reconnect = async (stale: PrismaClient): Promise<void> => {
    if (disconnected || current !== stale) return

    current = buildPrismaClient(connectionString)
    await stale.$disconnect().catch(() => {})
    console.warn('Prisma connection closed; recreated PrismaClient.')
  }

  const runWithReconnect = async <T>(operation: (client: PrismaClient) => Promise<T>, canRetry: boolean): Promise<T> => {
    const initialClient = current

    try {
      return await operation(initialClient)
    } catch (error) {
      if (disconnected || !isTransientPrismaConnectionError(error)) throw error

      await reconnect(initialClient)
      if (!canRetry) throw error
      return operation(current)
    }
  }

  const wrapDelegate = (delegateName: PropertyKey): object => new Proxy({}, {
    get(_target, methodName) {
      const delegate = Reflect.get(current as object, delegateName)
      const value = Reflect.get(delegate as object, methodName)

      if (typeof value !== 'function') return value

      const canRetry = typeof methodName === 'string' && IDEMPOTENT_METHODS.has(methodName)
      return (...args: unknown[]) => runWithReconnect(async (client) => {
        const liveDelegate = Reflect.get(client as object, delegateName)
        const liveMethod = Reflect.get(liveDelegate as object, methodName)

        return Reflect.apply(liveMethod as (...methodArgs: unknown[]) => unknown, liveDelegate, args) as Promise<unknown>
      }, canRetry)
    },
  })

  return new Proxy(current as PrismaClient, {
    get(_target, property) {
      if (property === '$disconnect') {
        return async (...args: unknown[]) => {
          disconnected = true
          const disconnect = Reflect.get(current as object, '$disconnect') as (...disconnectArgs: unknown[]) => Promise<unknown>
          return Reflect.apply(disconnect, current, args)
        }
      }

      const value = Reflect.get(current as object, property)

      if (typeof value === 'function') {
        const canRetry = typeof property === 'string' && property.startsWith('$')
        return (...args: unknown[]) => runWithReconnect(async (client) => {
          const liveMethod = Reflect.get(client as object, property) as (...methodArgs: unknown[]) => Promise<unknown>
          return Reflect.apply(liveMethod, client, args)
        }, canRetry)
      }

      if (isModelDelegate(value)) {
        const cached = delegateCache.get(property)
        if (cached) return cached

        const wrapped = wrapDelegate(property)
        delegateCache.set(property, wrapped)
        return wrapped
      }

      return value
    },
  }) as PrismaClient
}

// --- raw_items ---

export async function insertRawItem(
  prisma: PrismaClient,
  item: Omit<RawItem, 'id' | 'created_at' | 'status'>
): Promise<string | null> {
  const normalizedUrl = normalizeUrl(item.url)

  try {
    const row = await prisma.rawItem.create({
      data: {
        sourceType: item.source_type,
        sourceName: item.source_name,
        title: item.title,
        url: normalizedUrl,
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
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const rows = await prisma.rawItem.findMany({
    where: { status, createdAt: { gte: cutoff } },
    orderBy: { score: 'desc' },
    take: limit,
  })
  return rows.map(toRawItem)
}

export async function expireOldRawItems(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const result = await prisma.rawItem.updateMany({
    where: {
      status: { in: ['new', 'deduped'] },
      createdAt: { lt: cutoff },
    },
    data: { status: 'expired' },
  })
  return result.count
}

export async function updateRawItemStatus(prisma: PrismaClient, id: string, status: RawItemStatus): Promise<void> {
  await prisma.rawItem.update({ where: { id }, data: { status } })
}

// --- collector_states ---

export async function getCollectorState(prisma: PrismaClient, source: string): Promise<CollectorState | undefined> {
  const row = await prisma.collectorState.findUnique({ where: { source } })
  return row ? toCollectorState(row) : undefined
}

export async function upsertCollectorState(
  prisma: PrismaClient,
  source: string,
  cursor: { last_posted_at: Date | null; last_tweet_id: string | null },
): Promise<void> {
  await prisma.collectorState.upsert({
    where: { source },
    create: {
      source,
      lastPostedAt: cursor.last_posted_at,
      lastTweetId: cursor.last_tweet_id,
    },
    update: {
      lastPostedAt: cursor.last_posted_at,
      lastTweetId: cursor.last_tweet_id,
    },
  })
}

// --- articles ---

export async function insertArticle(
  prisma: PrismaClient,
  article: Omit<Article, 'id' | 'created_at' | 'status' | 'pipeline_status'>
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

// --- companies ---

export function toSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export async function upsertCompany(
  prisma: PrismaClient,
  company: { name: string; category: string; description?: string }
): Promise<string> {
  const slug = toSlug(company.name)
  const row = await prisma.company.upsert({
    where: { slug },
    create: {
      name: company.name,
      slug,
      category: company.category,
      description: company.description ?? null,
      mentionCount: 1,
    },
    update: {
      mentionCount: { increment: 1 },
    },
  })
  return row.id
}

export async function linkArticleCompany(
  prisma: PrismaClient,
  articleId: string,
  companyId: string
): Promise<void> {
  await prisma.articleCompany.create({
    data: { articleId, companyId },
  }).catch((err: any) => {
    if (err?.code === 'P2002') return // already linked
    throw err
  })
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
  articles_draft: number; articles_rejected: number; published_today: number
}> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [raw_new, raw_deduped, raw_duplicate, articles_draft, articles_rejected, published_today] = await Promise.all([
    prisma.rawItem.count({ where: { status: 'new' } }),
    prisma.rawItem.count({ where: { status: 'deduped' } }),
    prisma.rawItem.count({ where: { status: 'duplicate' } }),
    prisma.article.count({ where: { status: 'draft' } }),
    prisma.article.count({ where: { status: 'rejected' } }),
    prisma.publication.count({ where: { publishedAt: { gte: today } } }),
  ])
  return { raw_new, raw_deduped, raw_duplicate, articles_draft, articles_rejected, published_today }
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

function toCollectorState(row: any): CollectorState {
  return {
    source: row.source,
    last_posted_at: row.lastPostedAt instanceof Date ? row.lastPostedAt.toISOString() : row.lastPostedAt,
    last_tweet_id: row.lastTweetId,
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
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
    pipeline_status: row.pipelineStatus ?? 'pending',
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}
