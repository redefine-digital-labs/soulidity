import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'

const PRODUCTION_ENV_ALLOWLIST = [
  'NEXT_PUBLIC_SUI_NETWORK',
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID',
  'NEXT_PUBLIC_SEAL_SERVER_CONFIGS',
  'SEAL_SERVER_CONFIGS',
  'NEXT_PUBLIC_SEAL_THRESHOLD',
  'NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS',
  'NEXT_PUBLIC_SEAL_SESSION_TTL_MIN',
  'NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL',
  'NEXT_PUBLIC_WALRUS_AGGREGATOR_URL',
  'NEXT_PUBLIC_WALRUS_WASM_URL',
  'WALRUS_AGGREGATOR_URL',
  'DATABASE_URL',
  'DIRECT_URL',
  'AUTH_SECRET',
  'ADMIN_EMAILS',
  'ADMIN_WALLET_ADDRESSES',
  'TG_BOT_TOKEN',
  'TG_CHANNEL_ID',
  'TG_GROUP_ID',
  'TG_BOT_USERNAME',
  'X_DATABASE_URL',
  'DEFAULT_PROVIDER',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_BASE_URL',
  'NEXT_PUBLIC_BASE_URL',
  'APP_DOMAIN',
  'SOULIDITY_WEB_URL',
  'TRUST_PROXY_HEADERS',
  'DESKTOP_MANIFEST_URL',
  'NEXT_PUBLIC_DESKTOP_MAC_ARM64_URL',
  'NEXT_PUBLIC_DESKTOP_VERSION',
  'POSTHOG_API_KEY',
  'NEXT_PUBLIC_POSTHOG_KEY',
  'NEXT_PUBLIC_POSTHOG_HOST',
  'POSTHOG_SERVER_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
] as const

const FORBIDDEN_ENV_KEYS = new Set([
  'MAINNET_DEPLOYER_PRIV_KEY',
])

const REQUIRED_PRODUCTION_KEYS = [
  'NEXT_PUBLIC_SUI_NETWORK',
  'DATABASE_URL',
  'DIRECT_URL',
  'AUTH_SECRET',
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID',
  'DEFAULT_PROVIDER',
  'DEEPSEEK_API_KEY',
] as const

type CliOptions = {
  apply: boolean
  envFile: string
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    envFile: '.env',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      options.apply = true
      continue
    }
    if (arg === '--dry-run') {
      options.apply = false
      continue
    }
    if (arg === '--env-file') {
      const next = argv[index + 1]
      if (!next) throw new Error('--env-file requires a path')
      options.envFile = next
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function isSensitiveKey(key: string) {
  return !key.startsWith('NEXT_PUBLIC_')
}

function assertProductionEnv(env: Record<string, string>) {
  const errors: string[] = []

  const forbiddenWithValues = Array.from(FORBIDDEN_ENV_KEYS)
    .filter((key) => env[key]?.trim())
  if (forbiddenWithValues.length > 0) {
    errors.push(`Refusing to sync forbidden production env keys: ${forbiddenWithValues.join(', ')}`)
  }

  const missingRequired = REQUIRED_PRODUCTION_KEYS
    .filter((key) => !env[key]?.trim())
  if (missingRequired.length > 0) {
    errors.push(`Missing required production env keys: ${missingRequired.join(', ')}`)
  }

  if (env.NEXT_PUBLIC_SUI_NETWORK?.trim() !== 'mainnet') {
    errors.push('NEXT_PUBLIC_SUI_NETWORK must be mainnet before syncing Vercel Production env')
  }

  const hasUpstashRateLimit = Boolean(env.UPSTASH_REDIS_REST_URL?.trim())
    && Boolean(env.UPSTASH_REDIS_REST_TOKEN?.trim())
  const hasKvRateLimit = Boolean(env.KV_REST_API_URL?.trim())
    && Boolean(env.KV_REST_API_TOKEN?.trim())
  if (!hasUpstashRateLimit && !hasKvRateLimit) {
    errors.push('Missing shared rate limiter env pair: set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN')
  }

  const publicPostHogKey = env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
  if (!publicPostHogKey) {
    errors.push('Missing NEXT_PUBLIC_POSTHOG_KEY for browser analytics ingestion')
  } else if (!publicPostHogKey.startsWith('phc_')) {
    errors.push('NEXT_PUBLIC_POSTHOG_KEY must be a PostHog project API key that starts with phc_')
  }

  const adminDefaultProvider = env.DEFAULT_PROVIDER?.trim()
  if (adminDefaultProvider !== 'deepseek' && !adminDefaultProvider?.startsWith('deepseek-')) {
    errors.push('DEFAULT_PROVIDER must be deepseek or a DeepSeek model id for Vercel Production admin LLM')
  }

  const hasPublicSealConfig = Boolean(env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS?.trim())
  const hasServerSealConfig = Boolean(env.SEAL_SERVER_CONFIGS?.trim())
  if (!hasPublicSealConfig && !hasServerSealConfig) {
    errors.push('Missing Seal key server config for mainnet: set NEXT_PUBLIC_SEAL_SERVER_CONFIGS or SEAL_SERVER_CONFIGS')
  }

  const threshold = Number.parseInt(env.NEXT_PUBLIC_SEAL_THRESHOLD ?? '', 10)
  if (!Number.isFinite(threshold) || threshold <= 0) {
    errors.push('NEXT_PUBLIC_SEAL_THRESHOLD must be a positive integer for mainnet')
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
}

function syncEnvVar(key: string, value: string) {
  const args = [
    'vercel',
    'env',
    'add',
    key,
    'production',
    '--force',
    '--yes',
    ...(isSensitiveKey(key) ? ['--sensitive'] : []),
  ]
  const result = spawnSync('npx', args, {
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
  })

  if (result.status !== 0) {
    throw new Error(`vercel env add failed for ${key} with exit code ${result.status ?? 'unknown'}`)
  }
}

function main() {
  const options = parseCliOptions(process.argv.slice(2))
  const envPath = resolve(process.cwd(), options.envFile)
  const env = parse(readFileSync(envPath))

  assertProductionEnv(env)

  const selectedEntries = PRODUCTION_ENV_ALLOWLIST
    .map((key) => [key, env[key]] as const)
    .filter((entry): entry is readonly [typeof PRODUCTION_ENV_ALLOWLIST[number], string] => Boolean(entry[1]?.trim()))

  const skippedKeys = Object.keys(env)
    .filter((key) => !PRODUCTION_ENV_ALLOWLIST.includes(key as typeof PRODUCTION_ENV_ALLOWLIST[number]))
    .sort()

  console.log(`${options.apply ? 'Syncing' : 'Dry run for'} ${selectedEntries.length} production env vars from ${options.envFile}`)
  for (const [key] of selectedEntries) {
    console.log(`- ${key}${isSensitiveKey(key) ? ' (sensitive)' : ''}`)
  }

  if (skippedKeys.length > 0) {
    console.log(`Skipped non-allowlisted keys: ${skippedKeys.join(', ')}`)
  }

  if (!options.apply) {
    console.log('Dry run only. Re-run with --apply to update Vercel Production env.')
    return
  }

  for (const [key, value] of selectedEntries) {
    syncEnvVar(key, value)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
