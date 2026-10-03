import { afterEach, expect, it, vi } from 'vitest'
import { getBrowserCommunityPublishReadConfig, getBrowserCommunityPublishWritesEnabled } from '../../web/lib/community/publish-config'
const read = vi.hoisted(() => vi.fn(() => ({ deployment: 'read-only' })))
vi.mock('../../web/lib/community/public-post-read', () => ({ getBrowserCommunityReadConfig: read }))
afterEach(() => vi.unstubAllEnvs())
it.each(['true', 'false'])('requires explicit write switch %s', value => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED', value)
  expect(getBrowserCommunityPublishWritesEnabled()).toBe(value === 'true')
})
it('fails closed on missing configuration while inspection remains available', () => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED', undefined)
  expect(getBrowserCommunityPublishReadConfig()).toEqual({ deployment: 'read-only' })
  expect(getBrowserCommunityPublishWritesEnabled).toThrow('WRITE_CONFIGURATION_REQUIRED')
})
