import { beforeEach, expect, it, vi } from 'vitest'
const source = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('../../web/lib/prisma', () => ({ prisma: { soulAsset: { findUnique: source.findUnique } } }))
import { generateMetadata } from '../../web/app/souls/[id]/layout'

beforeEach(() => source.findUnique.mockReset())
it.each(['walrus://ciphertext', `soulidity-artwork:0x${'1'.repeat(64)}`])(
  'does not advertise browser-only or protected content as a public social image: %s', async imageUrl => {
    source.findUnique.mockResolvedValue({ name: 'Native Soul', description: '', imageUrl, listingStatus: 'unlisted', tags: [] })
    const metadata = await generateMetadata({ params: Promise.resolve({ id: `0x${'1'.repeat(64)}` }) })
    expect(metadata.openGraph?.images).toBeUndefined(); expect(metadata.twitter?.images).toBeUndefined()
    expect(metadata.title).toBe('Native Soul')
  },
)
it('preserves an ordinary public HTTPS image in social metadata', async () => {
  source.findUnique.mockResolvedValue({ name: 'Ordinary Soul', description: '', imageUrl: 'https://art.example/cover.png', listingStatus: 'unlisted', tags: [] })
  const metadata = await generateMetadata({ params: Promise.resolve({ id: `0x${'1'.repeat(64)}` }) })
  expect(metadata.openGraph?.images).toEqual([{ url: 'https://art.example/cover.png' }])
  expect(metadata.twitter?.images).toEqual(['https://art.example/cover.png'])
})
