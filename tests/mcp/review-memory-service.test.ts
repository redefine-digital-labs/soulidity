import { describe, expect, it, vi } from 'vitest'
import {
  findReviewMemoryCandidates,
  getReviewMemoryRecord,
  removeReviewMemoryResolution,
  recordReviewMemoryResolution,
} from '../../src/mcp/review-memory/service.js'
import { buildReviewMemoryRecord } from '../../src/mcp/review-memory/record.js'
import type { Mem9Client, Mem9Memory, Mem9SearchResult } from '../../src/mcp/review-memory/mem9-client.js'

function buildMemory(recordOverrides: Partial<ReturnType<typeof buildReviewMemoryRecord>> = {}, score = 0): Mem9Memory {
  const record = buildReviewMemoryRecord({
    repo: 'clawnews',
    batchId: 'batch-0',
    resolutionType: 'fixed',
    localRecordId: 'F-001',
    title: 'Null currentKioskId causes purchase quote failure',
    file: 'web/app/api/souls/[id]/route.ts',
    lineRef: '42',
    severity: 'medium',
    description: 'The route calls getSoulPurchaseQuote without guarding currentKioskId.',
    suggestedFix: 'Guard currentKioskId before quote lookup.',
    resolutionText: 'Added a currentKioskId guard before purchase quote lookup.',
    sourceFile: 'review/batch-0/fixed.md',
    sourceSectionId: 'F-001',
    createdAt: '2026-03-28T00:00:00.000Z',
    updatedAt: '2026-03-28T00:00:00.000Z',
    ...recordOverrides,
  })

  return {
    id: `memory-${record.uid}`,
    content: record.searchText,
    source: 'review-memory-mcp',
    tags: [
      `uid:${record.uid}`,
      `fingerprint:${record.fingerprint}`,
      `resolution:${record.resolutionType}`,
    ],
    metadata: record,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    score,
  }
}

function createMockClient(overrides: Partial<Mem9Client> = {}): Mem9Client {
  return {
    search: vi.fn<Mem9Client['search']>(),
    store: vi.fn<Mem9Client['store']>(),
    update: vi.fn<Mem9Client['update']>(),
    get: vi.fn<Mem9Client['get']>(),
    remove: vi.fn<Mem9Client['remove']>(),
    ...overrides,
  }
}

describe('review-memory service', () => {
  it('ranks same-fingerprint candidates ahead of looser semantic matches', async () => {
    const exact = buildMemory()
    const looser = buildMemory({
      localRecordId: 'N-002',
      resolutionType: 'not_issue',
      title: 'Purchase quote failure on detail route',
      description: 'The route can fail when the quote lookup throws unexpectedly.',
      suggestedFix: 'Catch the quote failure and degrade gracefully.',
      resolutionText: 'False positive — stale quote failures are already ignored.',
      sourceFile: 'review/batch-0/not-issue.md',
      sourceSectionId: 'N-002',
    }, 0.95)

    const search = vi.fn<Mem9Client['search']>()
      .mockResolvedValueOnce({
        data: [exact],
        total: 1,
        limit: 5,
        offset: 0,
      } satisfies Mem9SearchResult)
      .mockResolvedValueOnce({
        data: [looser, exact],
        total: 2,
        limit: 10,
        offset: 0,
      } satisfies Mem9SearchResult)

    const client = createMockClient({ search })

    const result = await findReviewMemoryCandidates({
      client,
      repo: 'clawnews',
      title: 'Null currentKioskId causes purchase quote failure',
      file: 'web/app/api/souls/[id]/route.ts',
      description: 'The route calls getSoulPurchaseQuote without guarding currentKioskId.',
      limit: 2,
    })

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      uid: exact.metadata?.uid,
      matchTier: 'fingerprint',
    })
    expect(result[1]).toMatchObject({
      uid: looser.metadata?.uid,
    })
    expect(search.mock.calls[0]?.[0]).toMatchObject({
      tags: expect.stringMatching(/^fingerprint:/),
      limit: 10,
    })
    expect(search.mock.calls[0]?.[0]).not.toHaveProperty('source')
    expect(search.mock.calls[1]?.[0]).toMatchObject({
      q: expect.stringContaining('currentKioskId'),
      limit: 10,
    })
    expect(search.mock.calls[1]?.[0]).not.toHaveProperty('source')
  })

  it('upserts by uid tag when recording a resolution', async () => {
    const existing = buildMemory()
    const client = createMockClient({
      search: vi.fn().mockResolvedValue({
        data: [existing],
        total: 1,
        limit: 1,
        offset: 0,
      }),
      update: vi.fn().mockResolvedValue({
        ...existing,
        updated_at: '2026-03-29T00:00:00.000Z',
      }),
      store: vi.fn(),
    })

    const result = await recordReviewMemoryResolution({
      client,
      record: buildReviewMemoryRecord({
        repo: 'clawnews',
        batchId: 'batch-0',
        resolutionType: 'fixed',
        localRecordId: 'F-500',
        title: 'Null currentKioskId causes purchase quote failure',
        file: 'web/app/api/souls/[id]/route.ts',
        lineRef: '42',
        severity: 'medium',
        description: 'The route calls getSoulPurchaseQuote without guarding currentKioskId.',
        suggestedFix: 'Guard currentKioskId before quote lookup.',
        resolutionText: 'Added a currentKioskId guard before purchase quote lookup.',
        sourceFile: 'review/batch-0/fixed.md',
        sourceSectionId: 'F-500',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-29T00:00:00.000Z',
      }),
    })

    expect(result.operation).toBe('updated')
    expect(client.update).toHaveBeenCalledTimes(1)
    expect(client.store).not.toHaveBeenCalled()
  })

  it('retrieves full records by uid tag', async () => {
    const existing = buildMemory()
    const client = createMockClient({
      search: vi.fn().mockResolvedValue({
        data: [existing],
        total: 1,
        limit: 1,
        offset: 0,
      }),
    })

    const record = await getReviewMemoryRecord({
      client,
      repo: 'clawnews',
      uid: existing.metadata!.uid as string,
    })

    expect(record?.uid).toBe(existing.metadata?.uid)
  })

  it('ignores same-uid memories that belong to a different repo', async () => {
    const existing = buildMemory()
    const otherRepo = buildMemory({
      repo: 'other-repo',
    })
    const client = createMockClient({
      search: vi.fn().mockResolvedValue({
        data: [otherRepo, existing],
        total: 2,
        limit: 25,
        offset: 0,
      }),
      update: vi.fn().mockResolvedValue(existing),
      store: vi.fn(),
    })

    const result = await recordReviewMemoryResolution({
      client,
      record: buildReviewMemoryRecord({
        repo: 'clawnews',
        batchId: 'batch-0',
        resolutionType: 'fixed',
        localRecordId: 'F-500',
        title: 'Null currentKioskId causes purchase quote failure',
        file: 'web/app/api/souls/[id]/route.ts',
        lineRef: '42',
        severity: 'medium',
        description: 'The route calls getSoulPurchaseQuote without guarding currentKioskId.',
        suggestedFix: 'Guard currentKioskId before quote lookup.',
        resolutionText: 'Added a currentKioskId guard before purchase quote lookup.',
        sourceFile: 'review/batch-0/fixed.md',
        sourceSectionId: 'F-500',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-29T00:00:00.000Z',
      }),
    })

    expect(result.operation).toBe('updated')
    expect(client.update).toHaveBeenCalledTimes(1)
    expect(client.store).not.toHaveBeenCalled()
  })

  it('throws when mem9 update fails during resolution upsert', async () => {
    const existing = buildMemory()
    const client = createMockClient({
      search: vi.fn().mockResolvedValue({
        data: [existing],
        total: 1,
        limit: 1,
        offset: 0,
      }),
      update: vi.fn().mockResolvedValue(null),
      store: vi.fn(),
    })

    await expect(recordReviewMemoryResolution({
      client,
      record: existing.metadata as ReturnType<typeof buildReviewMemoryRecord>,
    })).rejects.toThrow(/Failed to update review-memory record/)
  })

  it('removes all matching closed records when a finding is reopened', async () => {
    const existing = buildMemory()
    const duplicate = buildMemory({
      updatedAt: '2026-03-29T00:00:00.000Z',
      localRecordId: 'F-099',
      sourceSectionId: 'F-099',
    })
    const otherRepo = buildMemory({
      repo: 'other-repo',
    })
    const client = createMockClient({
      search: vi.fn().mockResolvedValue({
        data: [existing, duplicate, otherRepo],
        total: 3,
        limit: 25,
        offset: 0,
      }),
      remove: vi.fn().mockResolvedValue(true),
    })

    const result = await removeReviewMemoryResolution({
      client,
      repo: 'clawnews',
      uid: existing.metadata!.uid as string,
    })

    expect(result).toEqual({
      uid: existing.metadata!.uid,
      operation: 'removed',
      removedCount: 2,
    })
    expect(client.remove).toHaveBeenCalledTimes(2)
  })

  it('returns not_found when a reopened finding has no stored closed record', async () => {
    const client = createMockClient({
      search: vi.fn().mockResolvedValue({
        data: [],
        total: 0,
        limit: 25,
        offset: 0,
      }),
      remove: vi.fn(),
    })

    const result = await removeReviewMemoryResolution({
      client,
      repo: 'clawnews',
      uid: 'missing-uid',
    })

    expect(result).toEqual({
      uid: 'missing-uid',
      operation: 'not_found',
      removedCount: 0,
    })
    expect(client.remove).not.toHaveBeenCalled()
  })
})
