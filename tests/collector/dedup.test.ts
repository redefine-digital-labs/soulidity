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

    const result = await isDuplicate(prisma, {
      title,
      content: 'Bitcoin crosses the six-figure mark for the first time this cycle.',
      url: 'https://example.com/bitcoin-100k',
    })

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

    const result = await isDuplicate(prisma, {
      title,
      content: 'A firm warns the cycle could extend the drawdown.',
      url: 'https://example.com/cycle-risk',
    })

    expect(result).toEqual({
      duplicate: false,
      hash: titleHash(title),
    })
  })

  it('treats approved rows as dedup references', async () => {
    const { prisma, store } = createMockPrisma()
    const title = 'Solana validator revenue climbs as MEV demand rises'

    store.rawItems.push({
      id: 'raw-approved',
      title,
      titleHash: titleHash(title),
      status: 'approved',
      createdAt: new Date(),
    })

    const result = await isDuplicate(prisma, {
      title,
      content: 'Validator revenue climbs as MEV demand rises across the network.',
      url: 'https://example.com/solana-mev',
    })

    expect(result).toEqual({
      duplicate: true,
      hash: titleHash(title),
      matchedId: 'raw-approved',
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

    const result = await isDuplicate(prisma, {
      title: 'Bitcoin surges above $100K milestone',
      content: 'Fresh momentum pushes bitcoin through a key psychological threshold.',
      url: 'https://example.com/bitcoin-milestone',
    })

    expect(result).toEqual({
      duplicate: false,
      hash: titleHash('Bitcoin surges above $100K milestone'),
    })
  })

  it('matches canonical URLs even when tracking params differ', async () => {
    const { prisma, store } = createMockPrisma()

    store.rawItems.push({
      id: 'raw-url',
      title: 'Circle launches payment tool',
      titleHash: titleHash('Circle launches payment tool'),
      content: 'Circle launches a payment tool for internal treasury transfers.',
      url: 'https://example.com/story?utm_source=rss&id=1',
      status: 'produced',
      createdAt: new Date(),
    })

    const result = await isDuplicate(prisma, {
      title: 'Circle launches payment tool',
      content: 'Circle launches a payment tool for internal treasury transfers.',
      url: 'https://example.com/story?id=1&utm_medium=social',
    })

    expect(result).toEqual({
      duplicate: true,
      hash: titleHash('Circle launches payment tool'),
      matchedId: 'raw-url',
    })
  })

  it('uses content to catch medium-title-overlap duplicates', async () => {
    const { prisma, store } = createMockPrisma()

    store.rawItems.push({
      id: 'raw-content',
      title: 'Circle moves $68 million in 30 minutes using USDC for treasury payments',
      titleHash: titleHash('Circle moves $68 million in 30 minutes using USDC for treasury payments'),
      content: 'Circle moved 68 million dollars with USDC in half an hour to settle an internal treasury payment workflow.',
      url: 'https://example.com/circle-usdc',
      status: 'produced',
      createdAt: new Date(),
    })

    const result = await isDuplicate(prisma, {
      title: 'Circle settles treasury transfer with $68 million USDC payment',
      content: 'Circle moved 68 million dollars with USDC in half an hour to settle an internal treasury payment workflow.',
      url: 'https://another.example.com/circle-payment',
    })

    expect(result).toEqual({
      duplicate: true,
      hash: titleHash('Circle settles treasury transfer with $68 million USDC payment'),
      matchedId: 'raw-content',
    })
  })
})
