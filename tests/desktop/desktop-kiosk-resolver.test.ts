import { afterEach, describe, expect, it } from 'vitest'

import {
  getKioskPackageAddress,
  OFFICIAL_MAINNET_KIOSK_PACKAGE_ID,
  OFFICIAL_TESTNET_KIOSK_PACKAGE_ID,
} from '@soulidity/sdk'

const ORIGINAL_NETWORK = process.env.NEXT_PUBLIC_SUI_NETWORK
const ORIGINAL_KIOSK_PACKAGE_ID = process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID

describe('desktop kiosk package resolver (SDK)', () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUI_NETWORK = ORIGINAL_NETWORK
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = ORIGINAL_KIOSK_PACKAGE_ID
  })

  it('returns the vendored testnet kiosk package when env is empty and network is testnet', () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = ''
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'testnet'

    expect(getKioskPackageAddress()).toBe(OFFICIAL_TESTNET_KIOSK_PACKAGE_ID)
  })

  it('returns the official mainnet kiosk package when env is empty and network is mainnet', () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = ''
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'mainnet'

    expect(getKioskPackageAddress()).toBe(OFFICIAL_MAINNET_KIOSK_PACKAGE_ID)
  })

  it('honours an explicit env override regardless of network', () => {
    const override = `0x${'ab'.repeat(32)}`
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = override
    process.env.NEXT_PUBLIC_SUI_NETWORK = 'testnet'

    expect(getKioskPackageAddress()).toBe(override)
  })

  it('never falls back to 0x2 — SDK kiosk.ts carries no 0x2 fallback', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('packages/soulidity-sdk/src/kiosk.ts', 'utf8')
    expect(source).not.toMatch(/['"]0x2['"]/)
    expect(source).toContain('OFFICIAL_MAINNET_KIOSK_PACKAGE_ID')
    expect(source).toContain('OFFICIAL_TESTNET_KIOSK_PACKAGE_ID')
  })
})
