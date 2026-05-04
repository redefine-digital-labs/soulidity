import type { PrismaClient } from '../db/database.js'
import { getRawItemsByStatus, updateRawItemStatus } from '../db/database.js'
import type { RawItem } from '../shared/types.js'
import { findDuplicateMatch } from '../shared/dedup.js'
import { captureBackendEvent } from '../observability/posthog.js'
import { logger } from '../shared/logger.js'

const log = logger.child('dedup')

const WINDOW_HOURS = 72
const DEDUP_REFERENCE_STATUSES = ['deduped', 'processing', 'produced', 'published', 'kb_saved']

type DedupReference = Pick<RawItem, 'id' | 'title' | 'content' | 'url'>

export function dedup(items: RawItem[], historical: DedupReference[] = []): { keep: string[]; duplicate: string[] } {
  if (items.length === 0) return { keep: [], duplicate: [] }

  const keep: string[] = []
  const duplicate: string[] = []
  const references = [...historical]
  const candidates = [...items].sort((a, b) => b.score - a.score)

  for (const item of candidates) {
    const match = findDuplicateMatch(item, references)
    if (match) {
      duplicate.push(item.id)
      continue
    }

    keep.push(item.id)
    references.unshift({
      id: item.id,
      title: item.title,
      content: item.content,
      url: item.url,
    })
  }

  return { keep, duplicate }
}

export async function runDedup(prisma: PrismaClient, limit = 200): Promise<{ total: number; kept: number; duplicates: number }> {
  const items = await getRawItemsByStatus(prisma, 'new', limit)
  if (items.length === 0) {
    return { total: 0, kept: 0, duplicates: 0 }
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000)
  const historical = await prisma.rawItem.findMany({
    where: {
      status: { in: DEDUP_REFERENCE_STATUSES },
      createdAt: { gte: since },
    },
    select: { id: true, title: true, content: true, url: true },
    orderBy: { createdAt: 'desc' },
  })

  const { keep, duplicate } = dedup(items, historical)

  // Batch update statuses
  await Promise.all([
    keep.length > 0
      ? prisma.rawItem.updateMany({ where: { id: { in: keep } }, data: { status: 'deduped' } })
      : Promise.resolve(),
    duplicate.length > 0
      ? prisma.rawItem.updateMany({ where: { id: { in: duplicate } }, data: { status: 'duplicate' } })
      : Promise.resolve(),
  ])

  log.info(`Dedup: ${items.length} items → ${keep.length} kept, ${duplicate.length} duplicates`)
  captureBackendEvent('dedup_completed', { total: items.length, kept: keep.length, duplicates: duplicate.length })
  return { total: items.length, kept: keep.length, duplicates: duplicate.length }
}
