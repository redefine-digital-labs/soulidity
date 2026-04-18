import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { buildSoulsWhere } from './query'
import { NextRequest } from 'next/server'

const mockedFindMany = vi.hoisted(() => vi.fn())
const mockedCount = vi.hoisted(() => vi.fn())
const mockedQueryRaw = vi.hoisted(() => vi.fn())
const mockedToSoulAssetSummaryList = vi.hoisted(() => vi.fn())

vi.mock('@web/lib/prisma', () => ({
  prisma: {
    soulAsset: {
      findMany: mockedFindMany,
      count: mockedCount,
    },
    $queryRaw: mockedQueryRaw,
  },
}))

vi.mock('@/lib/soulidity/repository', () => ({
  soulAssetSummarySelect: { id: true },
  toSoulAssetSummaryList: mockedToSoulAssetSummaryList,
}))

describe('buildSoulsWhere', () => {
  it('combines search and creator filters with AND semantics', () => {
    expect(
      buildSoulsWhere({
        q: 'trading',
        tag: '',
        minPriceRaw: '',
        maxPriceRaw: '',
        creator: 'alice',
      }),
    ).toEqual({
      listingStatus: 'listed',
      AND: [
        {
          OR: [
            { name: { contains: 'trading', mode: 'insensitive' } },
            { description: { contains: 'trading', mode: 'insensitive' } },
            { tags: { has: 'trading' } },
          ],
        },
        {
          OR: [
            { creatorAddress: { contains: 'alice', mode: 'insensitive' } },
            {
              creatorMember: {
                OR: [
                  { displayName: { contains: 'alice', mode: 'insensitive' } },
                  { handle: { contains: 'alice', mode: 'insensitive' } },
                ],
              },
            },
          ],
        },
      ],
    })
  })
})

describe('GET /api/souls', () => {
  beforeEach(() => {
    mockedFindMany.mockReset()
    mockedCount.mockReset()
    mockedQueryRaw.mockReset()
    mockedToSoulAssetSummaryList.mockReset()
  })

  it('passes the composed AND filters to both list and count queries', async () => {
    mockedFindMany.mockResolvedValueOnce([])
    mockedCount.mockResolvedValueOnce(0)
    mockedToSoulAssetSummaryList.mockReturnValueOnce([])

    const response = await GET(
      new NextRequest('http://localhost/api/souls?q=trading&creator=alice&page=2&pageSize=5'),
    )

    expect(mockedFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        listingStatus: 'listed',
        AND: [
          {
            OR: [
              { name: { contains: 'trading', mode: 'insensitive' } },
              { description: { contains: 'trading', mode: 'insensitive' } },
              { tags: { has: 'trading' } },
            ],
          },
          {
            OR: [
              { creatorAddress: { contains: 'alice', mode: 'insensitive' } },
              {
                creatorMember: {
                  OR: [
                    { displayName: { contains: 'alice', mode: 'insensitive' } },
                    { handle: { contains: 'alice', mode: 'insensitive' } },
                  ],
                },
              },
            ],
          },
        ],
      },
      skip: 5,
      take: 5,
    }))
    expect(mockedCount).toHaveBeenCalledWith({
      where: {
        listingStatus: 'listed',
        AND: [
          {
            OR: [
              { name: { contains: 'trading', mode: 'insensitive' } },
              { description: { contains: 'trading', mode: 'insensitive' } },
              { tags: { has: 'trading' } },
            ],
          },
          {
            OR: [
              { creatorAddress: { contains: 'alice', mode: 'insensitive' } },
              {
                creatorMember: {
                  OR: [
                    { displayName: { contains: 'alice', mode: 'insensitive' } },
                    { handle: { contains: 'alice', mode: 'insensitive' } },
                  ],
                },
              },
            ],
          },
        ],
      },
    })
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      page: 2,
      totalPages: 1,
    })
  })

  it('pre-filters by persona-matching IDs before pagination when persona=agents', async () => {
    mockedQueryRaw.mockResolvedValueOnce([{ id: 'soul-a' }, { id: 'soul-b' }])
    mockedFindMany.mockResolvedValueOnce([])
    mockedCount.mockResolvedValueOnce(0)
    mockedToSoulAssetSummaryList.mockReturnValueOnce([])

    await GET(new NextRequest('http://localhost/api/souls?persona=agents'))

    expect(mockedQueryRaw).toHaveBeenCalledTimes(1)
    expect(mockedFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        listingStatus: 'listed',
        id: { in: ['soul-a', 'soul-b'] },
      }),
    }))
  })

  it('short-circuits to an empty response when no persona matches exist', async () => {
    mockedQueryRaw.mockResolvedValueOnce([])

    const response = await GET(new NextRequest('http://localhost/api/souls?persona=characters'))

    expect(mockedFindMany).not.toHaveBeenCalled()
    expect(mockedCount).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      totalPages: 1,
    })
  })

  it('skips the persona pre-query when persona is absent', async () => {
    mockedFindMany.mockResolvedValueOnce([])
    mockedCount.mockResolvedValueOnce(0)
    mockedToSoulAssetSummaryList.mockReturnValueOnce([])

    await GET(new NextRequest('http://localhost/api/souls'))

    expect(mockedQueryRaw).not.toHaveBeenCalled()
    expect(mockedFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { listingStatus: 'listed' },
    }))
  })
})
