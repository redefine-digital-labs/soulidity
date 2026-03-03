import type { PrismaClient } from '../db/database.js'
import { getRawItemsByStatus, updateRawItemStatus } from '../db/database.js'
import type { RawItem } from '../shared/types.js'

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
  'it', 'its', 'as', 'not', 'no', 'so', 'if', 'than', 'too', 'very',
  'just', 'about', 'up', 'out', 'how', 'what', 'which', 'who', 'whom',
  'when', 'where', 'why', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'into', 'over', 'after', 'before',
])

const JACCARD_THRESHOLD = 0.3

export function normalize(title: string): string[] {
  const lower = title.toLowerCase().replace(/[^\w\s]/g, ' ')
  return lower.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w))
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const w of setA) {
    if (setB.has(w)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function dedup(items: RawItem[]): { keep: string[]; duplicate: string[] } {
  if (items.length === 0) return { keep: [], duplicate: [] }

  const normalized = items.map(item => ({
    id: item.id,
    score: item.score,
    words: normalize(item.title),
  }))

  // Union-Find for grouping
  const parent = new Map<number, number>()
  function find(i: number): number {
    if (!parent.has(i)) parent.set(i, i)
    if (parent.get(i) !== i) parent.set(i, find(parent.get(i)!))
    return parent.get(i)!
  }
  function union(i: number, j: number) {
    parent.set(find(i), find(j))
  }

  // Compare all pairs
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (jaccard(normalized[i].words, normalized[j].words) >= JACCARD_THRESHOLD) {
        union(i, j)
      }
    }
  }

  // Group by root
  const groups = new Map<number, number[]>()
  for (let i = 0; i < normalized.length; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(i)
  }

  const keep: string[] = []
  const duplicate: string[] = []

  for (const indices of groups.values()) {
    // Pick the one with highest score
    indices.sort((a, b) => normalized[b].score - normalized[a].score)
    keep.push(normalized[indices[0]].id)
    for (let k = 1; k < indices.length; k++) {
      duplicate.push(normalized[indices[k]].id)
    }
  }

  return { keep, duplicate }
}

export async function runDedup(prisma: PrismaClient, limit = 200): Promise<{ total: number; kept: number; duplicates: number }> {
  const items = await getRawItemsByStatus(prisma, 'new', limit)
  if (items.length === 0) {
    return { total: 0, kept: 0, duplicates: 0 }
  }

  const { keep, duplicate } = dedup(items)

  // Batch update statuses
  await Promise.all([
    ...keep.map(id => updateRawItemStatus(prisma, id, 'deduped')),
    ...duplicate.map(id => updateRawItemStatus(prisma, id, 'duplicate')),
  ])

  console.log(`Dedup: ${items.length} items → ${keep.length} kept, ${duplicate.length} duplicates`)
  return { total: items.length, kept: keep.length, duplicates: duplicate.length }
}
