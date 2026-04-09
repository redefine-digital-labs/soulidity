import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }
const OVERRIDE_KIOSK_PACKAGE_ID = `0x${'a'.repeat(64)}`
const SECOND_OVERRIDE_KIOSK_PACKAGE_ID = `0x${'b'.repeat(64)}`

describe('vendored kiosk package helper', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns the normalized env override address', async () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = OVERRIDE_KIOSK_PACKAGE_ID

    const { getVendoredKioskPackageAddress } = await import('../../web/lib/souls/kiosk-package.ts')

    expect(getVendoredKioskPackageAddress()).toBe(OVERRIDE_KIOSK_PACKAGE_ID)
  })

  it('re-reads the kiosk package source when the env override changes without a module reset', async () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = OVERRIDE_KIOSK_PACKAGE_ID

    const { getVendoredKioskPackageAddress } = await import('../../web/lib/souls/kiosk-package.ts')

    expect(getVendoredKioskPackageAddress()).toBe(OVERRIDE_KIOSK_PACKAGE_ID)

    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = SECOND_OVERRIDE_KIOSK_PACKAGE_ID
    expect(getVendoredKioskPackageAddress()).toBe(SECOND_OVERRIDE_KIOSK_PACKAGE_ID)
  })

  it('throws when env override is absent', async () => {
    vi.resetModules()

    const { getVendoredKioskPackageAddress } = await import('../../web/lib/souls/kiosk-package.ts')

    expect(() => getVendoredKioskPackageAddress()).toThrow(
      'NEXT_PUBLIC_KIOSK_PACKAGE_ID must be set',
    )
  })

  it('throws when env override is invalid', async () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = 'not-a-sui-address'
    vi.resetModules()

    const { getVendoredKioskPackageAddress } = await import('../../web/lib/souls/kiosk-package.ts')

    expect(() => getVendoredKioskPackageAddress()).toThrow(
      'NEXT_PUBLIC_KIOSK_PACKAGE_ID contains an invalid kiosk package address',
    )
  })
})
