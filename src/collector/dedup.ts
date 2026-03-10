import type { PrismaClient } from '../db/database.js'
import { findDuplicateMatch, titleHash } from './simhash.js'
import type { CollectedItem } from './types.js'

const WINDOW_HOURS = 72
const DEDUP_REFERENCE_STATUSES = ['new', 'deduped', 'processing', 'produced', 'published', 'approved']

export async function isDuplicate(
  prisma: PrismaClient,
  item: Pick<CollectedItem, 'title' | 'content' | 'url'>,
  windowHours = WINDOW_HOURS,
): Promise<{ duplicate: true; hash: string; matchedId: string } | { duplicate: false; hash: string }> {
  const hash = titleHash(item.title)
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  // Fast path: exact hash match
  const exactMatch = await prisma.rawItem.findFirst({
    // Ignore expired/rejected rows so transient failures do not poison future collection.
    where: { titleHash: hash, status: { in: DEDUP_REFERENCE_STATUSES }, createdAt: { gte: since } },
    select: { id: true },
  })

  if (exactMatch) {
    return { duplicate: true, hash, matchedId: exactMatch.id }
  }

  // Slow path: Jaccard similarity on recent titles
  const rows = await prisma.rawItem.findMany({
    where: { status: { in: DEDUP_REFERENCE_STATUSES }, createdAt: { gte: since } },
    select: { id: true, title: true, content: true, url: true },
    orderBy: { createdAt: 'desc' },
  })

  const match = findDuplicateMatch(item, rows)
  if (match) {
    return { duplicate: true, hash, matchedId: match.matchedId }
  }

  return { duplicate: false, hash }
}
