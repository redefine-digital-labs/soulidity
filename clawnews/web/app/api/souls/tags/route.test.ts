import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { resetSoulTagsCacheForTests } from './cache'

const mockedQueryRaw = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: mockedQueryRaw,
  },
}))

describe('GET /api/souls/tags', () => {
  beforeEach(() => {
    mockedQueryRaw.mockReset()
    resetSoulTagsCacheForTests()
  })

  it('serves repeated calls from the short server cache', async () => {
    mockedQueryRaw.mockResolvedValueOnce([{ tag: 'ai', count: 2n }])

    const first = await GET()
    const second = await GET()

    await expect(first.json()).resolves.toEqual({ tags: [{ tag: 'ai', count: 2 }] })
    await expect(second.json()).resolves.toEqual({ tags: [{ tag: 'ai', count: 2 }] })
    expect(mockedQueryRaw).toHaveBeenCalledTimes(1)
  })
})
