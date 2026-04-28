import Parser from 'rss-parser'
import type { CollectedItem } from './types.js'
import { captureBackendException } from '../observability/posthog.js'

export const RSS_FEEDS = [
  { name: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'theblock', url: 'https://www.theblock.co/rss.xml' },
  { name: 'decrypt', url: 'https://decrypt.co/feed' },
]

const parser = new Parser({ timeout: 10000 })

const MAX_AGE_MS = 24 * 60 * 60 * 1000

export async function collectRss(): Promise<CollectedItem[]> {
  const cutoff = Date.now() - MAX_AGE_MS

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      const result = await parser.parseURL(feed.url)
      const items: CollectedItem[] = []
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
      return items
    }),
  )

  const items: CollectedItem[] = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled') {
      items.push(...r.value)
    } else {
      console.error(`Failed to fetch RSS from ${RSS_FEEDS[i].name}:`, r.reason)
      captureBackendException(r.reason, {
        scope: 'collector',
        collector: 'rss',
        source: RSS_FEEDS[i].name,
      })
    }
  }
  return items
}
