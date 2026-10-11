import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('PostHog lifecycle flushing', () => {
  it('provides bounded shutdown helpers for backend and web PostHog clients', () => {
    for (const path of [
      'src/observability/posthog.ts',
      'web/lib/observability/posthog-server.ts',
    ]) {
      const source = readSource(path)
      expect(source).toContain('const POSTHOG_SHUTDOWN_TIMEOUT_MS = 5_000')
      expect(source).toContain('export async function shutdownPostHogWithTimeout')
      expect(source).toContain('Promise.race')
      expect(source).toContain('posthog shutdown timed out after')
    }
  })

  it('flushes backend telemetry before one-shot CLI entry points exit', () => {
    for (const path of [
      'src/collector/run.ts',
      'src/producer/run.ts',
      'src/publisher/run.ts',
    ]) {
      const source = readSource(path)
      const disconnectIndex = source.indexOf('await prisma.$disconnect()')
      const shutdownIndex = source.indexOf('await shutdownPostHogWithTimeout()')

      expect(source).toContain("from '../observability/posthog.js'")
      expect(disconnectIndex).toBeGreaterThan(-1)
      expect(shutdownIndex).toBeGreaterThan(disconnectIndex)
      expect(source.indexOf('finally')).toBeGreaterThan(-1)
    }
  })

  it('flushes wallet-login telemetry before returning the API response', () => {
    const route = readSource('web/app/api/auth/wallet-login/route.ts')
    const helperIndex = route.indexOf('async function flushWalletLoginTelemetry')
    const flushIndex = route.indexOf('await flushWalletLoginTelemetry()')
    const returnIndex = route.indexOf('return response', flushIndex)

    expect(route).toContain("from '@/lib/observability/posthog-server'")
    expect(helperIndex).toBeGreaterThan(-1)
    expect(flushIndex).toBeGreaterThan(helperIndex)
    expect(returnIndex).toBeGreaterThan(flushIndex)
  })
})
