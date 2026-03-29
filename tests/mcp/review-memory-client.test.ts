import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpMem9Client } from '../../src/mcp/review-memory/mem9-client.js'

describe('HttpMem9Client', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('uses the mem9 v1alpha2 memories endpoint with API key headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        memories: [],
        total: 0,
        limit: 5,
        offset: 0,
      }),
    })
    globalThis.fetch = fetchMock as typeof fetch

    const client = new HttpMem9Client({
      apiUrl: 'http://localhost:8080/',
      apiKey: 'tenant-key',
      agentName: 'review-memory-mcp',
    })

    await client.search({ q: 'currentKioskId', source: 'review-memory:clawnews', limit: 5 })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/v1alpha2/mem9s/memories?q=currentKioskId&source=review-memory%3Aclawnews&limit=5',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-API-Key': 'tenant-key',
          'X-Mnemo-Agent-Id': 'review-memory-mcp',
        }),
      }),
    )
  })

  it('stores structured metadata as a normal mem9 memory payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        id: 'memory-1',
        content: 'stored memory',
        source: 'review-memory:clawnews',
        tags: ['uid:test'],
        metadata: { uid: 'test' },
        created_at: '2026-03-28T00:00:00.000Z',
        updated_at: '2026-03-28T00:00:00.000Z',
      }),
    })
    globalThis.fetch = fetchMock as typeof fetch

    const client = new HttpMem9Client({
      apiUrl: 'http://localhost:8080',
      apiKey: 'tenant-key',
      agentName: 'review-memory-mcp',
    })

    await client.store({
      content: 'stored memory',
      source: 'review-memory:clawnews',
      tags: ['uid:test'],
      metadata: { uid: 'test' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/v1alpha2/mem9s/memories',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          content: 'stored memory',
          source: 'review-memory:clawnews',
          tags: ['uid:test'],
          metadata: { uid: 'test' },
        }),
      }),
    )
  })
})
