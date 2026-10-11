import { afterEach, describe, expect, it, vi } from 'vitest'
import { staticPublicEnvironment } from '../../web/spa/public-env'
import { getBrowserNativeReceiveTarget } from '../../web/lib/animacraft/browser-native-config'
import { readNativeReceiveTarget, verifyNativeReceive } from '../../web/lib/animacraft/native-receive'
import { nativeReceiveFixture } from './fixtures/native-receive'

afterEach(() => vi.unstubAllEnvs())
describe('one public static release configuration', () => {
  it.each([{ CLAWNEWS_LOAD_ENV_LOCAL: 'false' }, { VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' }])(
    'does not read local files for a deployment: %j', flags => {
      const local = vi.fn(() => ({ NEXT_PUBLIC_SUI_NETWORK: 'testnet' }))
      expect(staticPublicEnvironment({ ...flags, NEXT_PUBLIC_SUI_NETWORK: 'mainnet', DATABASE_URL: 'private' }, local))
        .toEqual({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet' })
      expect(local).not.toHaveBeenCalled()
    },
  )
  it('local development keeps public values only, with process values taking priority', () => {
    expect(staticPublicEnvironment({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet', SECRET: 'private' }, () => ({
      NEXT_PUBLIC_SUI_NETWORK: 'testnet', NEXT_PUBLIC_ANIMACRAFT_ORIGIN: 'http://localhost:5173', KEY: 'private',
    }))).toEqual({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_ANIMACRAFT_ORIGIN: 'http://localhost:5173' })
  })
  it('reads exactly the browser tuple and rejects the retired server key', () => {
    const { target } = nativeReceiveFixture()
    const common = { NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: target.soulidityCallablePackageId,
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: target.soulidityOriginalPackageId }
    for (const [key, value] of Object.entries(common)) vi.stubEnv(key, value)
    vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', JSON.stringify(target))
    expect(getBrowserNativeReceiveTarget()).toEqual(target)
    expect(() => readNativeReceiveTarget({ ...common, ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(target) }))
      .toThrow('configuration is unavailable')
    vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', '0x' + '9'.repeat(64))
    expect(() => getBrowserNativeReceiveTarget()).toThrow('configuration is unavailable')
  })
  it('actual receive evidence decoder works with no Node Buffer', async () => {
    const fixture = nativeReceiveFixture()
    const buffer = globalThis.Buffer
    try {
      Object.defineProperty(globalThis, 'Buffer', { value: undefined, writable: true, configurable: true })
      await expect(verifyNativeReceive(fixture.client, fixture.target, fixture.input)).resolves.toMatchObject({ soulId: fixture.input.soulOnChainId })
    } finally { Object.defineProperty(globalThis, 'Buffer', { value: buffer, writable: true, configurable: true }) }
  })
})
