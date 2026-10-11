import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = 'scripts/sync-vercel-production-env.ts'
const PRODUCTION_WALRUS_UPLOADER_URL = 'https://uploader.soulidity.ai'

const tempDirs: string[] = []
const productionSupportEnv = {
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token',
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_testprojectkey',
  NEXT_PUBLIC_POSTHOG_HOST: '/ingest',
}

function writeEnvFile(extra: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'clawnews-env-sync-'))
  tempDirs.push(dir)
  const env = {
    NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    DATABASE_URL: 'postgres://user:pass@example.com:5432/db',
    DIRECT_URL: 'postgres://user:pass@example.com:5432/db',
    AUTH_SECRET: 'test-auth-secret',
    NEXT_PUBLIC_KIOSK_PACKAGE_ID: `0x${'1'.repeat(64)}`,
    DEFAULT_PROVIDER: 'deepseek',
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    NEXT_PUBLIC_SEAL_SERVER_CONFIGS: '[]',
    NEXT_PUBLIC_SEAL_THRESHOLD: '1',
    ...extra,
  }
  const path = join(dir, '.env.production')
  writeFileSync(path, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'))
  return path
}

function runSync(envFile: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, '--dry-run', '--env-file', envFile], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('Vercel production env sync guardrails', () => {
  it('rejects production sync when shared rate limiting or frontend PostHog env is absent', () => {
    const envFile = writeEnvFile({})

    const result = runSync(envFile)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Missing shared rate limiter env pair')
    expect(result.stderr).toContain('Missing NEXT_PUBLIC_POSTHOG_KEY')
  })

  it('includes shared rate limiting and frontend PostHog env in dry-run output', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_POSTHOG_SESSION_REPLAY: 'true',
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
    })

    const result = runSync(envFile)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('- UPSTASH_REDIS_REST_URL (sensitive)')
    expect(result.stdout).toContain('- UPSTASH_REDIS_REST_TOKEN (sensitive)')
    expect(result.stdout).toContain('- NEXT_PUBLIC_POSTHOG_KEY')
    expect(result.stdout).toContain('- NEXT_PUBLIC_POSTHOG_HOST')
    expect(result.stdout).toContain('- NEXT_PUBLIC_POSTHOG_SESSION_REPLAY')
  })

  it('does not require PostHog session replay env to sync production env', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
    })

    const result = runSync(envFile)

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('NEXT_PUBLIC_POSTHOG_SESSION_REPLAY')
  })

  it('allows managed Walrus production env with the managed domain and token secret', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'managed',
      NEXT_PUBLIC_WALRUS_UPLOADER_URL: PRODUCTION_WALRUS_UPLOADER_URL,
      WALRUS_UPLOADER_TOKEN_SECRET: 'test-uploader-secret',
    })

    const result = runSync(envFile)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('- NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT')
    expect(result.stdout).toContain('- NEXT_PUBLIC_WALRUS_UPLOADER_URL')
    expect(result.stdout).toContain('- WALRUS_UPLOADER_TOKEN_SECRET (sensitive)')
  })

  it('rejects managed Walrus production env without uploader URL or token secret', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'managed',
    })

    const result = runSync(envFile)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `Managed Walrus production env requires NEXT_PUBLIC_WALRUS_UPLOADER_URL=${PRODUCTION_WALRUS_UPLOADER_URL}`,
    )
    expect(result.stderr).toContain('Managed Walrus production env requires WALRUS_UPLOADER_TOKEN_SECRET')
  })

  it.each(['browser', 'server'] as const)(
    'rejects %s Walrus rollback env when uploader credentials are still present',
    (transport) => {
      const envFile = writeEnvFile({
        ...productionSupportEnv,
        NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: transport,
        NEXT_PUBLIC_WALRUS_UPLOADER_URL: PRODUCTION_WALRUS_UPLOADER_URL,
        WALRUS_UPLOADER_TOKEN_SECRET: 'test-uploader-secret',
      })

      const result = runSync(envFile)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=${transport} must not sync NEXT_PUBLIC_WALRUS_UPLOADER_URL or WALRUS_UPLOADER_TOKEN_SECRET`,
      )
    },
  )
})
