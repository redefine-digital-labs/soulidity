import { afterEach, describe, expect, it } from 'vitest'

import { resolveKioskPackageId } from '../../desktop/apps/desktop/src/renderer/lib/soulidity/tx/shared'

const ORIGINAL_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK
const ORIGINAL_KIOSK_PACKAGE_ID = process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID

const OFFICIAL_MAINNET_KIOSK_PACKAGE_ID =
  '0xdfb4f1d4e43e0c3ad834dcd369f0d39005c872e118c9dc1c5da9765bb93ee5f3'
const OFFICIAL_TESTNET_KIOSK_PACKAGE_ID =
  '0xc9f6a531d5f4e11ef38dd782c9ab5403fb3c011595384c429285952ff6b31839'

describe('desktop kiosk package resolver', () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = ORIGINAL_NETWORK
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = ORIGINAL_KIOSK_PACKAGE_ID
  })

  it('returns the vendored testnet kiosk package when env is empty and network is testnet', () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = ''
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'testnet'

    expect(resolveKioskPackageId()).toBe(OFFICIAL_TESTNET_KIOSK_PACKAGE_ID)
  })

  it('returns the official mainnet kiosk package when env is empty and network is mainnet', () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = ''
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'

    expect(resolveKioskPackageId()).toBe(OFFICIAL_MAINNET_KIOSK_PACKAGE_ID)
  })

  it('honours an explicit env override regardless of network', () => {
    const override = `0x${'ab'.repeat(32)}`
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = override
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'testnet'

    expect(resolveKioskPackageId()).toBe(override)
  })

  it('never falls back to 0x2 — desktop renderer source carries no 0x2 kiosk fallback', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(
      'desktop/apps/desktop/src/renderer/lib/soulidity/tx/shared.ts',
      'utf8',
    )
    expect(source).not.toMatch(/NEXT_PUBLIC_KIOSK_PACKAGE_ID\?\.trim\(\)\s*\|\|\s*['"]0x2['"]/)
    expect(source).toContain('resolveKioskPackageId')
  })
})
