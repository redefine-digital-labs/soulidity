import { describe, it, expect } from 'vitest'
import { buildApprovedTweetUpdate, parseTweetMeta } from '../../web/lib/admin-tweet-review.js'

describe('admin tweet review helpers', () => {
  it('adds review metadata without overwriting the raw tweet fields', () => {
    const rawData = JSON.stringify({
      tweet_id: '123',
      author: 'openclaw',
      like_count: 10,
    })

    const update = buildApprovedTweetUpdate(rawData, {
      title: '审核标题',
      summary: '审核摘要',
      reviewedAt: '2026-03-08T08:00:00.000Z',
    })

    expect(update).toEqual({
      status: 'approved',
      rawData: expect.any(String),
    })
    expect(update).not.toHaveProperty('title')
    expect(update).not.toHaveProperty('content')

    expect(parseTweetMeta(update.rawData)).toMatchObject({
      tweet_id: '123',
      author: 'openclaw',
      like_count: 10,
      review: {
        title: '审核标题',
        summary: '审核摘要',
        reviewedAt: '2026-03-08T08:00:00.000Z',
      },
    })
  })
})
