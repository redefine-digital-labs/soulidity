import { afterEach, expect, it, vi } from 'vitest'
import { getBrowserCommunityAcceptDeployment, getBrowserCommunityAcceptWritesEnabled } from '../../web/lib/community/accept-config'
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
afterEach(() => vi.unstubAllEnvs())
it('needs only chain/registry configuration to inspect acceptance', () => {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', id(1)); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', id(2))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID', id(3)); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID', id(4))
  vi.stubEnv('NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER', '01010101'); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED', '')
  expect(getBrowserCommunityAcceptDeployment()).toEqual({ profile: { originalPackageId: id(1), callablePackageId: id(2), registryId: id(3), chainIdentifier: '01010101' }, registryId: id(4) })
  expect(getBrowserCommunityAcceptWritesEnabled).toThrow('WRITE_CONFIGURATION_REQUIRED')
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED', 'false'); expect(getBrowserCommunityAcceptWritesEnabled()).toBe(false)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED', 'true'); expect(getBrowserCommunityAcceptWritesEnabled()).toBe(true)
})
