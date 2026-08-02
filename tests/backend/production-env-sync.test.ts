import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = 'scripts/sync-vercel-production-env.ts'
const PRODUCTION_WALRUS_UPLOADER_URL = 'https://uploader.soulidity.ai'
const VALID_PUBLIC_SEAL_CONFIG = JSON.stringify([{
  objectId: `0x${'9'.repeat(64)}`,
  weight: 1,
}])
const REQUIRED_HISTORICAL_SEAL_ROUTES = JSON.stringify([{
  sealPackageId: '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0',
  callablePackageId: '0x6680f74155dd9f1c2ae0109556e459b1259f80b7597679292a70572887cfb1c0',
}])
const ACTIVE_SOULIDITY_PACKAGE_ID =
  '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d'

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
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES: REQUIRED_HISTORICAL_SEAL_ROUTES,
    NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED: 'false',
    NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED: 'false',
    DEFAULT_PROVIDER: 'deepseek',
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    NEXT_PUBLIC_SEAL_SERVER_CONFIGS: VALID_PUBLIC_SEAL_CONFIG,
    NEXT_PUBLIC_SEAL_THRESHOLD: '1',
    ...extra,
  }
  const path = join(dir, '.env.production')
  writeFileSync(path, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'))
  return path
}

function runSync(envFile: string, deploymentHistoryFile?: string) {
  const args = ['--import', 'tsx', SCRIPT, '--dry-run', '--env-file', envFile]
  if (deploymentHistoryFile) {
    args.push('--deployment-history-file', deploymentHistoryFile)
  }
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

function writeDeploymentHistory(entries: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'soulidity-deployment-history-'))
  tempDirs.push(dir)
  const path = join(dir, 'deployment-manifest-history.json')
  writeFileSync(path, JSON.stringify(entries))
  return path
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

    expect(result.status, result.stderr).toBe(0)
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

  it('syncs only complete explicit Soulidity package routing and rejects the legacy alias', () => {
    const routed = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: '0x111',
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: '0x222',
      NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID: '0x333',
      NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: '0x444',
    }))
    expect(routed.status).toBe(0)
    expect(routed.stdout).toContain('- NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
    expect(routed.stdout).toContain('- NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
    expect(routed.stdout).toContain('- NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID')
    expect(routed.stdout).toContain('- NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID')

    const legacy = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SOULIDITY_PACKAGE_ID: '0x111',
    }))
    expect(legacy.status).toBe(1)
    expect(legacy.stderr).toContain('Refusing to sync forbidden production env keys')

    const zeroRouting = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: '0x0',
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: '0x0',
      NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID: '0x333',
      NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: '0x444',
    }))
    expect(zeroRouting.status).toBe(1)
    expect(zeroRouting.stderr).toContain('must be a valid non-zero Sui package ID')
  })

  it('requires and always selects the explicit historical Seal route payload', () => {
    const included = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
    }))
    expect(included.status).toBe(0)
    expect(included.stdout).toContain('- NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES')

    const missing = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES: '',
    }))
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain(
      'Missing required production env keys: NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES',
    )
  })

  it('requires the guarded Animacraft gates and always syncs explicit false values', () => {
    const guarded = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
    }))
    expect(guarded.status).toBe(0)
    expect(guarded.stdout).toContain('- NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED')
    expect(guarded.stdout).toContain('- NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED')

    const omitted = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED: '',
      NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED: '',
    }))
    expect(omitted.status).toBe(1)
    expect(omitted.stderr).toContain(
      'Missing required production env keys: NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED, NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED',
    )

    for (const key of [
      'NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED',
      'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED',
    ]) {
      const enabled = runSync(writeEnvFile({
        ...productionSupportEnv,
        NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
        [key]: 'true',
      }))
      expect(enabled.status).toBe(1)
      expect(enabled.stderr).toContain(
        `${key} must be exactly false for the guarded v5/v6 rollout`,
      )
    }
  })

  it('fails closed when the deployment history file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'soulidity-missing-deployment-history-'))
    tempDirs.push(dir)
    const result = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
    }), join(dir, 'missing.json'))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'is missing; production Seal routing requires an explicit deployment history file',
    )
  })

  it('allows an explicit empty canonical history for the first family', () => {
    const result = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
    }), writeDeploymentHistory([]))

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Dry run only')
  })

  it('forbids deployment-history overrides for Production apply', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
    })
    const historyFile = writeDeploymentHistory([])
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      SCRIPT,
      '--apply',
      '--env-file',
      envFile,
      '--deployment-history-file',
      historyFile,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '--apply must use the repository canonical deployment history',
    )
  })

  it('fails closed when production env omits a family archived by fresh publish', () => {
    const historyFile = writeDeploymentHistory([{
      archivedAt: '2026-08-02T00:00:00.000Z',
      network: 'mainnet',
      reason: 'break-glass fresh publish before deployment-manifest overwrite',
      deployment: {
        originalPackageId: '0x5',
        callablePackageId: '0x6',
      },
    }])
    const base = {
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: '0x1',
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: '0x2',
      NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID: '0x3',
      NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: '0x4',
    }

    const omitted = runSync(writeEnvFile(base), historyFile)
    expect(omitted.status).toBe(1)
    expect(omitted.stderr).toContain('does not preserve archived Mainnet family')

    const preserved = runSync(writeEnvFile({
      ...base,
      NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES: JSON.stringify([{
        sealPackageId: `0x${'0'.repeat(63)}5`,
        callablePackageId: '0x6',
      }]),
    }), historyFile)
    expect(preserved.status).toBe(0)
    expect(preserved.stdout).toContain('- NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES')
  })

  it('rejects historical Seal routes that conflict after Sui ID normalization', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: '0x1',
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: '0x2',
      NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID: '0x3',
      NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: '0x4',
      NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES: JSON.stringify([
        { sealPackageId: '0x5', callablePackageId: '0x6' },
        {
          sealPackageId: `0x${'0'.repeat(63)}5`,
          callablePackageId: '0x7',
        },
      ]),
    })

    const result = runSync(envFile)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('conflicts with callable')
  })

  it('rejects a historical Seal route that overrides the active package family', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: '0x1',
      NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: '0x2',
      NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID: '0x3',
      NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: '0x4',
      NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES: JSON.stringify([
        { sealPackageId: '0x2', callablePackageId: '0x8' },
      ]),
    })

    const result = runSync(envFile)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('conflicts with callable')
  })

  it('requires a usable public Seal server list that meets the threshold', () => {
    const empty = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: '[]',
    }))
    expect(empty.status).toBe(1)
    expect(empty.stderr).toContain(
      'NEXT_PUBLIC_SEAL_SERVER_CONFIGS must contain at least one usable mainnet key server',
    )

    const belowThreshold = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SEAL_THRESHOLD: '2',
    }))
    expect(belowThreshold.status).toBe(1)
    expect(belowThreshold.stderr).toContain('has weight 1, below threshold 2')

    const serverOnly = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: '',
      SEAL_SERVER_CONFIGS: VALID_PUBLIC_SEAL_CONFIG,
    }))
    expect(serverOnly.status).toBe(1)
    expect(serverOnly.stderr).toContain('browser Seal decryption requires a public mainnet key-server list')
  })

  it('enforces integer Seal weights, the u8 share limit, and weighted thresholds', () => {
    for (const weight of [0.5, 1.5]) {
      const fractional = runSync(writeEnvFile({
        ...productionSupportEnv,
        NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
        NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{
          objectId: `0x${'9'.repeat(64)}`,
          weight,
        }]),
      }))
      expect(fractional.status).toBe(1)
      expect(fractional.stderr).toContain('weight must be a positive integer')
    }

    const tooManyShares = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId: `0x${'9'.repeat(64)}`,
        weight: 255,
      }]),
    }))
    expect(tooManyShares.status).toBe(1)
    expect(tooManyShares.stderr).toContain('total weight must be less than 255')

    const weightedThreshold = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SEAL_THRESHOLD: '2',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId: `0x${'9'.repeat(64)}`,
        weight: 2,
      }]),
    }))
    expect(weightedThreshold.status).toBe(0)
  })

  it('keeps server-only Seal credentials on the public committee and preserves its weight', () => {
    const objectId = '0x9'
    const normalizedObjectId = `0x${'0'.repeat(63)}9`
    const inheritedWeight = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SEAL_THRESHOLD: '2',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId, weight: 2 }]),
      SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId: normalizedObjectId,
        aggregatorUrl: 'https://seal.example.com',
        apiKeyName: 'x-seal-key',
        apiKey: 'secret',
      }]),
    }))
    expect(inheritedWeight.status).toBe(0)

    const mismatchedWeight = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SEAL_THRESHOLD: '2',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId, weight: 2 }]),
      SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId: normalizedObjectId, weight: 1 }]),
    }))
    expect(mismatchedWeight.status).toBe(1)
    expect(mismatchedWeight.stderr).toContain('must preserve public weight 2')

    const unknownServer = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId: `0x${'8'.repeat(64)}`,
        weight: 1,
      }]),
    }))
    expect(unknownServer.status).toBe(1)
    expect(unknownServer.stderr).toContain('may only override an objectId present')

    const incompleteCredentials = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId, apiKeyName: 'x-seal-key' }]),
    }))
    expect(incompleteCredentials.status).toBe(1)
    expect(incompleteCredentials.stderr).toContain('must set apiKeyName and apiKey together')

    const exposedPublicSecret = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: 'browser',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId,
        weight: 1,
        apiKeyName: 'x-seal-key',
        apiKey: 'public-secret',
      }]),
    }))
    expect(exposedPublicSecret.status).toBe(1)
    expect(exposedPublicSecret.stderr).toContain('must not expose API credentials')
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
