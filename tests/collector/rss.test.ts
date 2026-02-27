import { describe, it, expect } from 'vitest'
import { RSS_FEEDS } from '../../src/collector/rss.js'

describe('RSS config', () => {
  it('has at least 3 feeds configured', () => {
    expect(RSS_FEEDS.length).toBeGreaterThanOrEqual(3)
  })

  it('each feed has name and url', () => {
    for (const feed of RSS_FEEDS) {
      expect(feed.name).toBeTruthy()
      expect(feed.url).toMatch(/^https?:\/\//)
    }
  })
})
