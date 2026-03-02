import type Database from 'better-sqlite3'
import { titleHash, jaccardSimilarity, SIMILARITY_THRESHOLD } from './simhash.js'

const WINDOW_HOURS = 72

interface TitleRow {
  id: string
  title: string
  title_hash: string
}

export function isDuplicate(
  db: Database.Database,
  title: string,
  windowHours = WINDOW_HOURS,
): { duplicate: true; hash: string; matchedId: string } | { duplicate: false; hash: string } {
  const hash = titleHash(title)

  // Fast path: exact hash match
  const exactMatch = db
    .prepare(
      `SELECT id FROM raw_items
       WHERE title_hash = ?
         AND created_at >= datetime('now', ?)
       LIMIT 1`,
    )
    .get(hash, `-${windowHours} hours`) as { id: string } | undefined

  if (exactMatch) {
    return { duplicate: true, hash, matchedId: exactMatch.id }
  }

  // Slow path: Jaccard similarity check on recent titles
  const rows = db
    .prepare(
      `SELECT id, title FROM raw_items
       WHERE created_at >= datetime('now', ?)
       ORDER BY created_at DESC`,
    )
    .all(`-${windowHours} hours`) as TitleRow[]

  for (const row of rows) {
    if (jaccardSimilarity(title, row.title) >= SIMILARITY_THRESHOLD) {
      return { duplicate: true, hash, matchedId: row.id }
    }
  }

  return { duplicate: false, hash }
}
