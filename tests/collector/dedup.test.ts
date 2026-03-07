import { describe, it, expect } from 'vitest'
import { isDuplicate } from '../../src/collector/dedup.js'
import { titleHash } from '../../src/collector/simhash.js'
import { createMockPrisma } from '../helpers/mock-prisma.js'

describe('isDuplicate', () => {
  it('treats active rows as dedup references', async () => {
    const { prisma, store } = createMockPrisma()
    const title = 'Bitcoin surges past $100K'

    store.rawItems.push({
      id: 'raw-produced',
      title,
      titleHash: titleHash(title),
      status: 'produced',
      createdAt: new Date(),
    })

    const result = await isDuplicate(prisma, title)

    expect(result).toEqual({
      duplicate: true,
      hash: titleHash(title),
      matchedId: 'raw-produced',
    })
  })

  it('ignores rejected rows for exact-hash matches', async () => {
    const { prisma, store } = createMockPrisma()
    const title = 'Bitcoin could crash by another 30% as four-year cycle gains strength'

    store.rawItems.push({
      id: 'raw-rejected',
      title,
      titleHash: titleHash(title),
      status: 'rejected',
      createdAt: new Date(),
    })

    const result = await isDuplicate(prisma, title)

    expect(result).toEqual({
      duplicate: false,
      hash: titleHash(title),
    })
  })

  it('ignores expired rows during similarity matching', async () => {
    const { prisma, store } = createMockPrisma()

    store.rawItems.push({
      id: 'raw-expired',
      title: 'Bitcoin surges past $100K milestone',
      titleHash: titleHash('Bitcoin surges past $100K milestone'),
      status: 'expired',
      createdAt: new Date(),
    })

    const result = await isDuplicate(prisma, 'Bitcoin surges above $100K milestone')

    expect(result).toEqual({
      duplicate: false,
      hash: titleHash('Bitcoin surges above $100K milestone'),
    })
  })
})
