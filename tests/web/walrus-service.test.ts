import { describe, expect, it } from 'vitest'

import {
  getBlobUrl,
  materializeWalrusBlobUrls,
  normalizeWalrusBlobId,
} from '../../web/lib/services/walrus.ts'

describe('Walrus blob validation', () => {
  it('accepts bare blob ids and aggregator URLs', () => {
    expect(normalizeWalrusBlobId('blob-123')).toBe('blob-123')
    expect(
      normalizeWalrusBlobId('https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-123'),
    ).toBe('blob-123')
  })

  it('rejects malformed blob ids', () => {
    expect(normalizeWalrusBlobId('../escape')).toBeNull()
    expect(normalizeWalrusBlobId('https://example.com/v1/blobs/blob-123')).toBeNull()
    expect(normalizeWalrusBlobId('blob-123?evil=1')).toBeNull()
  })

  it('materializes safe Walrus URLs only', () => {
    expect(
      materializeWalrusBlobUrls([
        'blob-123',
        'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-456',
        'https://tracker.example/pixel.png',
      ]),
    ).toEqual([
      'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-123',
      'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob-456',
    ])
  })

  it('URL-encodes validated blob ids when building download URLs', () => {
    expect(getBlobUrl('blob_id-123')).toBe(
      'https://aggregator.walrus-testnet.walrus.space/v1/blobs/blob_id-123',
    )
  })
})
