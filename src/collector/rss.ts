import Parser from 'rss-parser'
import type { CollectedItem } from './types.js'

export const RSS_FEEDS = [
  { name: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'theblock', url: 'https://www.theblock.co/rss.xml' },
  { name: 'decrypt', url: 'https://decrypt.co/feed' },
]

const parser = new Parser({ timeout: 10000 })

const MAX_AGE_MS = 24 * 60 * 60 * 1000

export async function collectRss(): Promise<CollectedItem[]> {
  const items: CollectedItem[] = []
  const cutoff = Date.now() - MAX_AGE_MS

  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url)
      for (const entry of result.items ?? []) {
        if (!entry.title || !entry.link) continue
        if (!entry.isoDate) continue
        if (new Date(entry.isoDate).getTime() < cutoff) continue
        items.push({
          source_type: 'rss',
          source_name: feed.name,
          title: entry.title,
          url: entry.link,
          content: entry.contentSnippet ?? entry.content ?? '',
          language: 'en',
          raw_data: entry,
        })
      }
    } catch (err) {
      console.error(`Failed to fetch RSS from ${feed.name}:`, err)
    }
  }

  return items
}
