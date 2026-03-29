import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REPO_ROOT = path.join(import.meta.dirname, '..', '..')
const ORIGINAL_CWD = process.cwd()
const ORIGINAL_ENV = { ...process.env }
const OVERRIDE_KIOSK_PACKAGE_ID = `0x${'a'.repeat(64)}`
const SECOND_OVERRIDE_KIOSK_PACKAGE_ID = `0x${'b'.repeat(64)}`

// These tests intentionally mutate process.cwd() because the helper resolves vendored Move.toml
// relative to the repo root. Keep the mutation local to this file and always restore cwd.

function readExpectedVendoredKioskAddress() {
  const moveToml = readFileSync(path.join(REPO_ROOT, 'move', 'vendor', 'kiosk', 'Move.toml'), 'utf8')
  const match = moveToml.match(/^\s*kiosk\s*=\s*"([^"]+)"\s*$/m)
  if (!match) {
    throw new Error('Vendored kiosk address missing from Move.toml')
  }
  return match[1]
}

describe('vendored kiosk package helper', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    delete process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID
    process.chdir(ORIGINAL_CWD)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    process.chdir(ORIGINAL_CWD)
  })

  it('prefers NEXT_PUBLIC_KIOSK_PACKAGE_ID over vendored Move.toml discovery', async () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = OVERRIDE_KIOSK_PACKAGE_ID

    const { getVendoredKioskPackageAddress } = await import('../../web/lib/souls/kiosk-package.ts')

    expect(getVendoredKioskPackageAddress()).toBe(OVERRIDE_KIOSK_PACKAGE_ID)
  })

  it('reads the vendored kiosk address from Move.toml when env override is absent', async () => {
    const { getVendoredKioskPackageAddress } = await import('../../web/lib/souls/kiosk-package.ts')

    expect(getVendoredKioskPackageAddress()).toBe(readExpectedVendoredKioskAddress())
  })

  it('re-reads the kiosk package source when the env override changes without a module reset', async () => {
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = OVERRIDE_KIOSK_PACKAGE_ID

    const { getVendoredKioskPackageAddress } = await import('../../web/lib/souls/kiosk-package.ts')

    expect(getVendoredKioskPackageAddress()).toBe(OVERRIDE_KIOSK_PACKAGE_ID)

    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = SECOND_OVERRIDE_KIOSK_PACKAGE_ID
    expect(getVendoredKioskPackageAddress()).toBe(SECOND_OVERRIDE_KIOSK_PACKAGE_ID)

    delete process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID
    expect(getVendoredKioskPackageAddress()).toBe(readExpectedVendoredKioskAddress())
  })

  it('throws a clear error when neither env override nor vendored Move.toml is available', async () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'kiosk-package-'))
    process.env.NEXT_PUBLIC_KIOSK_PACKAGE_ID = ''
    const previousCwd = process.cwd()
    try {
      process.chdir(emptyDir)
      vi.resetModules()

      const { getVendoredKioskPackageAddress } = await import('../../web/lib/souls/kiosk-package.ts')

      expect(() => getVendoredKioskPackageAddress()).toThrow(
        'NEXT_PUBLIC_KIOSK_PACKAGE_ID must be set when vendored Kiosk Move.toml is unavailable',
      )
    } finally {
      process.chdir(previousCwd)
    }
  })
})
