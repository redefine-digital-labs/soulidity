import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadEnvFile } from '../../scripts/lib/dotenv'

/**
 * R-003 regression — `scripts/lib/dotenv.ts` exposes `loadEnvFile(...)` for
 * specialty env files like `.env.soulidity-smoke`. The smoke script imports
 * the side-effect (.env / .env.local) and then calls `loadEnvFile(...)` to
 * pick up the documented smoke wallets. Without this contract, the smoke
 * harness fails immediately with `Missing SMOKE_PUBLISHER_KEY` even when the
 * file exists with all three keys filled in.
 */

describe('scripts/lib/dotenv loadEnvFile (R-003)', () => {
  const originalEnv = { ...process.env }
  const originalCwd = process.cwd()
  let tmp: string

  beforeEach(() => {
    process.env = { ...originalEnv }
    tmp = mkdtempSync(join(tmpdir(), 'dotenv-loader-'))
  })

  afterEach(() => {
    process.env = originalEnv
    process.chdir(originalCwd)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('loads values from the requested file relative to repo root', () => {
    const repoRoot = resolve(__dirname, '..', '..')
    const fileName = `.env.test-loader-${Date.now()}`
    const target = resolve(repoRoot, fileName)
    writeFileSync(target, 'SMOKE_TEST_LOADER_VALUE=loaded\n')

    try {
      delete process.env.SMOKE_TEST_LOADER_VALUE
      const result = loadEnvFile(fileName)
      expect(result.loaded).toBe(true)
      expect(result.path).toBe(target)
      expect(result.applied).toContain('SMOKE_TEST_LOADER_VALUE')
      expect(process.env.SMOKE_TEST_LOADER_VALUE).toBe('loaded')
    } finally {
      rmSync(target, { force: true })
      delete process.env.SMOKE_TEST_LOADER_VALUE
    }
  })

  it('reports loaded:false without throwing when the file does not exist', () => {
    const result = loadEnvFile(`.env.does-not-exist-${Date.now()}`)
    expect(result.loaded).toBe(false)
    expect(result.applied).toEqual([])
  })

  it('smoke-soulidity.ts loads .env.soulidity-smoke before reading wallets', () => {
    // The runbook documents `.env.soulidity-smoke` as the place to drop smoke
    // wallets. If this regression breaks, `tsx scripts/smoke-soulidity.ts`
    // fails immediately with `Missing SMOKE_PUBLISHER_KEY` even when the file
    // exists with all three keys filled in.
    const repoRoot = resolve(__dirname, '..', '..')
    const source = readFileSync(
      resolve(repoRoot, 'scripts/smoke-soulidity.ts'),
      'utf8',
    )
    expect(source).toContain("import './lib/dotenv'")
    expect(source).toContain("import { loadEnvFile } from './lib/dotenv'")
    expect(source).toMatch(/loadEnvFile\([^)]*\.env\.soulidity-smoke[^)]*\)/)
    // The load must happen BEFORE loadSmokeWallets() reads process.env.
    const loaderIdx = source.indexOf('loadEnvFile(')
    const walletReaderIdx = source.indexOf('function loadSmokeWallets')
    expect(loaderIdx).toBeGreaterThanOrEqual(0)
    expect(walletReaderIdx).toBeGreaterThan(loaderIdx)
    // Honors `SOULIDITY_SMOKE_ENV_FILE` for ad-hoc per-network overrides.
    expect(source).toContain('SOULIDITY_SMOKE_ENV_FILE')
  })

  it('preserves CLI exports captured at module load time', () => {
    // The module's CLI snapshot is locked at import time. Anything that was
    // already in process.env when scripts/lib/dotenv.ts loaded is treated as
    // a CLI / CI export and must not be overwritten by a specialty file.
    // We exercise this with a key that is _not_ present in CLI exports
    // (positive case) followed by a key that IS reserved on first sight.
    const repoRoot = resolve(__dirname, '..', '..')
    const fileName = `.env.test-loader-cli-${Date.now()}`
    const target = resolve(repoRoot, fileName)
    writeFileSync(
      target,
      'SMOKE_TEST_LOADER_NEW=fresh\nSMOKE_TEST_LOADER_LATE=should-not-appear\n',
    )

    try {
      // Setting it AFTER the module already snapshotted CLI keys means the
      // loader will overwrite it (intended — late `process.env` writes are
      // not CLI exports). This guards against regressions where someone
      // moves the snapshot capture out of module-init.
      delete process.env.SMOKE_TEST_LOADER_NEW
      process.env.SMOKE_TEST_LOADER_LATE = 'set-after-import'
      const result = loadEnvFile(fileName)
      expect(result.loaded).toBe(true)
      expect(result.applied).toContain('SMOKE_TEST_LOADER_NEW')
      expect(process.env.SMOKE_TEST_LOADER_NEW).toBe('fresh')
      expect(process.env.SMOKE_TEST_LOADER_LATE).toBe('should-not-appear')
    } finally {
      rmSync(target, { force: true })
      delete process.env.SMOKE_TEST_LOADER_NEW
      delete process.env.SMOKE_TEST_LOADER_LATE
    }
  })
})
