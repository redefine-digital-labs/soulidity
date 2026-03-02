import type { PrismaClient } from '../db/database.js'
import { titleHash, jaccardSimilarity, SIMILARITY_THRESHOLD } from './simhash.js'

const WINDOW_HOURS = 72

export async function isDuplicate(
  prisma: PrismaClient,
  title: string,
  windowHours = WINDOW_HOURS,
): Promise<{ duplicate: true; hash: string; matchedId: string } | { duplicate: false; hash: string }> {
  const hash = titleHash(title)
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  // Fast path: exact hash match
  const exactMatch = await prisma.rawItem.findFirst({
    where: { titleHash: hash, createdAt: { gte: since } },
    select: { id: true },
  })

  if (exactMatch) {
    return { duplicate: true, hash, matchedId: exactMatch.id }
  }

  // Slow path: Jaccard similarity on recent titles
  const rows = await prisma.rawItem.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, title: true },
    orderBy: { createdAt: 'desc' },
  })

  for (const row of rows) {
    if (jaccardSimilarity(title, row.title) >= SIMILARITY_THRESHOLD) {
      return { duplicate: true, hash, matchedId: row.id }
    }
  }

  return { duplicate: false, hash }
}
