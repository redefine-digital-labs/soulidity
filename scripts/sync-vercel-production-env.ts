import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'

const PRODUCTION_ENV_ALLOWLIST = [
  'NEXT_PUBLIC_SUI_NETWORK',
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID',
  'NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES',
  'NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED',
  'NEXT_PUBLIC_ANIMACRAFT_APP_URL',
  'NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_TYPE_ORIGIN_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_TREASURY_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_ENABLED',
  'NEXT_PUBLIC_ANIMACRAFT_V7_CALLABLE_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_V7_TYPE_ORIGIN_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_REGISTRY_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_CONFIG_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMPOSITION_V6_CONFIG_ID',
  'NEXT_PUBLIC_SEAL_SERVER_CONFIGS',
  'SEAL_SERVER_CONFIGS',
  'NEXT_PUBLIC_SEAL_THRESHOLD',
  'NEXT_PUBLIC_SEAL_VERIFY_KEY_SERVERS',
  'NEXT_PUBLIC_SEAL_SESSION_TTL_MIN',
  'NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL',
  'NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT',
  'NEXT_PUBLIC_WALRUS_UPLOADER_URL',
  'NEXT_PUBLIC_WALRUS_AGGREGATOR_URL',
  'NEXT_PUBLIC_WALRUS_WASM_URL',
  'WALRUS_AGGREGATOR_URL',
  'WALRUS_UPLOADER_TOKEN_SECRET',
  'WALRUS_UPLOADER_TOKEN_TTL_MS',
  'WALRUS_UPLOADER_TOKEN_MAX_FILES',
  'WALRUS_UPLOADER_TOKEN_MAX_BYTES',
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
  'NEXT_PUBLIC_POSTHOG_SESSION_REPLAY',
  'POSTHOG_SERVER_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
] as const

const FORBIDDEN_ENV_KEYS = new Set([
  'MAINNET_DEPLOYER_PRIV_KEY',
  'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID',
])

const REQUIRED_PRODUCTION_KEYS = [
  'NEXT_PUBLIC_SUI_NETWORK',
  // Always write this key, including the explicit empty value `[]` for the
  // first package family. Omitting it during a later fresh-family rollout can
  // make historical Souls undecryptable after the active package IDs change.
  'NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES',
  // Guarded v5/v6/v7 rollout: these flags must be written explicitly so an old
  // Vercel value of `true` cannot survive merely because a local env omitted
  // the key.
  'NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED',
  // Physical v7 is a separate release gate, but its complete identity is
  // required even while false so the sync can clear stale Vercel state and a
  // later reviewed activation cannot inherit preview IDs.
  'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_ENABLED',
  'NEXT_PUBLIC_ANIMACRAFT_V7_CALLABLE_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_V7_TYPE_ORIGIN_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_REGISTRY_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_CONFIG_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMPOSITION_V6_CONFIG_ID',
  'DATABASE_URL',
  'DIRECT_URL',
  'AUTH_SECRET',
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID',
  'DEFAULT_PROVIDER',
  'DEEPSEEK_API_KEY',
] as const

const PRODUCTION_WALRUS_UPLOADER_URL = 'https://uploader.soulidity.ai'
const WALRUS_UPLOAD_TRANSPORTS = ['managed', 'browser', 'server'] as const

type CliOptions = {
  apply: boolean
  envFile: string
  deploymentHistoryFile: string
  deploymentHistoryOverridden: boolean
}

const CANONICAL_DEPLOYMENT_HISTORY_FILE =
  'packages/soulidity-sdk/src/deployment-manifest-history.json'

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    envFile: '.env',
    deploymentHistoryFile: CANONICAL_DEPLOYMENT_HISTORY_FILE,
    deploymentHistoryOverridden: false,
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
    if (arg === '--deployment-history-file') {
      const next = argv[index + 1]
      if (!next) throw new Error('--deployment-history-file requires a path')
      options.deploymentHistoryFile = next
      options.deploymentHistoryOverridden = true
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.apply && options.deploymentHistoryOverridden) {
    throw new Error(
      '--apply must use the repository canonical deployment history; '
        + '--deployment-history-file is dry-run/test only',
    )
  }

  return options
}

function isSensitiveKey(key: string) {
  return !key.startsWith('NEXT_PUBLIC_')
}

function normalizeBaseUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, '') ?? ''
}

function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && value.replace(/\/+$/, '') === url.origin
    )
  } catch {
    return false
  }
}

function isNonZeroSuiId(value: string): boolean {
  return (
    /^0x[0-9a-fA-F]{1,64}$/.test(value)
    && /[1-9a-fA-F]/.test(value.slice(2))
  )
}

function normalizeNonZeroSuiId(value: string): string | null {
  const trimmed = value.trim()
  if (!isNonZeroSuiId(trimmed)) return null
  return `0x${trimmed.slice(2).toLowerCase().padStart(64, '0')}`
}

type HistoricalSealRoute = {
  sealPackageId: string
  callablePackageId: string
}

function loadRequiredHistoricalSealRoutes(path: string): HistoricalSealRoute[] {
  if (!existsSync(path)) {
    throw new Error(
      `${path} is missing; production Seal routing requires an explicit deployment history file`,
    )
  }

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON array`)
  }

  const callableByNamespace = new Map<string, string>()
  for (const [index, entry] of parsed.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${path} entry ${index} must be an object`)
    }
    const record = entry as Record<string, unknown>
    if (record.network !== 'mainnet') continue
    if (!record.deployment || typeof record.deployment !== 'object') {
      throw new Error(`${path} entry ${index}.deployment must be an object`)
    }
    const deployment = record.deployment as Record<string, unknown>
    const originalRaw = typeof deployment.originalPackageId === 'string'
      ? deployment.originalPackageId
      : (typeof deployment.packageId === 'string' ? deployment.packageId : '')
    const callableRaw = typeof deployment.callablePackageId === 'string'
      ? deployment.callablePackageId
      : (typeof deployment.packageId === 'string' ? deployment.packageId : '')
    const sealPackageId = normalizeNonZeroSuiId(originalRaw)
    const callablePackageId = normalizeNonZeroSuiId(callableRaw)
    if (!sealPackageId || !callablePackageId) {
      throw new Error(
        `${path} entry ${index} must contain valid non-zero original/callable package IDs`,
      )
    }
    const existingCallable = callableByNamespace.get(sealPackageId)
    if (existingCallable && existingCallable !== callablePackageId) {
      throw new Error(
        `${path} entry ${index} conflicts with callable ${existingCallable} for namespace ${sealPackageId}`,
      )
    }
    callableByNamespace.set(sealPackageId, callablePackageId)
  }

  return Array.from(callableByNamespace, ([sealPackageId, callablePackageId]) => ({
    sealPackageId,
    callablePackageId,
  }))
}

type ValidatedSealServerConfig = {
  objectId: string
  weight: number
  weightWasProvided: boolean
}

function parseSealServerConfigs(
  raw: string | undefined,
  envName: 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' | 'SEAL_SERVER_CONFIGS',
  errors: string[],
): ValidatedSealServerConfig[] {
  const configured = raw?.trim()
  if (!configured) return []

  try {
    const parsed = JSON.parse(configured) as unknown
    if (!Array.isArray(parsed)) {
      throw new Error('must be a JSON array')
    }

    const seenObjectIds = new Set<string>()
    return parsed.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`server ${index} must be an object`)
      }
      const value = entry as Record<string, unknown>
      const objectId = typeof value.objectId === 'string'
        ? normalizeNonZeroSuiId(value.objectId)
        : null
      if (!objectId) {
        throw new Error(`server ${index}.objectId must be a non-zero Sui object ID`)
      }
      if (seenObjectIds.has(objectId)) {
        throw new Error(`server ${index}.objectId duplicates ${objectId}`)
      }
      seenObjectIds.add(objectId)

      const weight = value.weight == null ? 1 : value.weight
      if (typeof weight !== 'number' || !Number.isInteger(weight) || weight <= 0) {
        throw new Error(`server ${index}.weight must be a positive integer`)
      }

      const hasApiKeyName = typeof value.apiKeyName === 'string'
        && value.apiKeyName.trim().length > 0
      const hasApiKey = typeof value.apiKey === 'string'
        && value.apiKey.trim().length > 0
      if (envName === 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' && (hasApiKeyName || hasApiKey)) {
        throw new Error(`server ${index} must not expose API credentials in a NEXT_PUBLIC env`)
      }
      if (envName === 'SEAL_SERVER_CONFIGS' && hasApiKeyName !== hasApiKey) {
        throw new Error(`server ${index} must set apiKeyName and apiKey together`)
      }
      if (value.aggregatorUrl != null) {
        if (typeof value.aggregatorUrl !== 'string') {
          throw new Error(`server ${index}.aggregatorUrl must be an HTTPS URL`)
        }
        try {
          const aggregatorUrl = new URL(value.aggregatorUrl)
          if (aggregatorUrl.protocol !== 'https:' || aggregatorUrl.username || aggregatorUrl.password) {
            throw new Error('invalid')
          }
        } catch {
          throw new Error(`server ${index}.aggregatorUrl must be an HTTPS URL without credentials`)
        }
      }

      return {
        objectId,
        weight,
        weightWasProvided: value.weight != null,
      }
    })
  } catch (error) {
    errors.push(`${envName} is invalid: ${(error as Error).message}`)
    return []
  }
}

function assertProductionEnv(
  env: Record<string, string>,
  requiredHistoricalSealRoutes: HistoricalSealRoute[],
) {
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

  for (const key of [
    'NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED',
    'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED',
    'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_ENABLED',
  ] as const) {
    if (env[key]?.trim() !== 'false') {
      errors.push(`${key} must be exactly false for the guarded v5/v6/v7 rollout`)
    }
  }

  const soulidityRoutingKeys = [
    'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
    'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
    'NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID',
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_PACKAGE_ID',
  ] as const
  const configuredSoulidityRouting = soulidityRoutingKeys
    .filter((key) => Boolean(env[key]?.trim()))
  if (
    configuredSoulidityRouting.length > 0
    && configuredSoulidityRouting.length !== soulidityRoutingKeys.length
  ) {
    errors.push(
      `Soulidity package routing overrides must set all of: ${soulidityRoutingKeys.join(', ')}`,
    )
  }
  for (const key of configuredSoulidityRouting) {
    if (!normalizeNonZeroSuiId(env[key]!.trim())) {
      errors.push(`${key} must be a valid non-zero Sui package ID`)
    }
  }
  const v6ConfigPackage = env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_PACKAGE_ID?.trim()
  const v6ConfigId = env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID?.trim()
  if (Boolean(v6ConfigPackage) !== Boolean(v6ConfigId)) {
    errors.push(
      'V6 secondary-market routing must set both '
        + 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_PACKAGE_ID and '
        + 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID',
    )
  }
  if (v6ConfigId && !normalizeNonZeroSuiId(v6ConfigId)) {
    errors.push('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID must be a valid non-zero Sui object ID')
  }

  const sealRoutesRaw = env.NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES?.trim()
  if (sealRoutesRaw) {
    try {
      const routes = JSON.parse(sealRoutesRaw) as unknown
      if (!Array.isArray(routes)) throw new Error('must be a JSON array')
      const activeOriginal = normalizeNonZeroSuiId(
        env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID ?? '',
      )
      const activeCallable = normalizeNonZeroSuiId(
        env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID ?? '',
      )
      if (routes.length > 0 && (!activeOriginal || !activeCallable)) {
        throw new Error(
          'requires active NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID and NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
        )
      }
      const callableByNamespace = new Map<string, string>()
      const configuredHistoricalRoutes = new Map<string, string>()
      if (activeOriginal && activeCallable) {
        callableByNamespace.set(activeOriginal, activeCallable)
      }
      for (const [index, route] of routes.entries()) {
        if (!route || typeof route !== 'object') {
          throw new Error(`route ${index} must be an object`)
        }
        const value = route as Record<string, unknown>
        const sealPackageId = typeof value.sealPackageId === 'string'
          ? normalizeNonZeroSuiId(value.sealPackageId)
          : null
        const callablePackageId = typeof value.callablePackageId === 'string'
          ? normalizeNonZeroSuiId(value.callablePackageId)
          : null
        if (!sealPackageId) {
          throw new Error(`route ${index}.sealPackageId must be a non-zero Sui package ID`)
        }
        if (!callablePackageId) {
          throw new Error(`route ${index}.callablePackageId must be a non-zero Sui package ID`)
        }
        const existingCallable = callableByNamespace.get(sealPackageId)
        if (existingCallable && existingCallable !== callablePackageId) {
          throw new Error(
            `route ${index} conflicts with callable ${existingCallable} for namespace ${sealPackageId}`,
          )
        }
        callableByNamespace.set(sealPackageId, callablePackageId)
        configuredHistoricalRoutes.set(sealPackageId, callablePackageId)
      }
      for (const required of requiredHistoricalSealRoutes) {
        if (configuredHistoricalRoutes.get(required.sealPackageId) !== required.callablePackageId) {
          throw new Error(
            `does not preserve archived Mainnet family ${required.sealPackageId} -> ${required.callablePackageId}`,
          )
        }
      }
    } catch (error) {
      errors.push(
        `NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES is invalid: ${(error as Error).message}`,
      )
    }
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

  const publicSealConfigs = parseSealServerConfigs(
    env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS,
    'NEXT_PUBLIC_SEAL_SERVER_CONFIGS',
    errors,
  )
  const serverSealConfigs = parseSealServerConfigs(
    env.SEAL_SERVER_CONFIGS,
    'SEAL_SERVER_CONFIGS',
    errors,
  )
  if (!env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS?.trim()) {
    errors.push(
      'Missing NEXT_PUBLIC_SEAL_SERVER_CONFIGS: browser Seal decryption requires a public mainnet key-server list',
    )
  } else if (publicSealConfigs.length === 0) {
    errors.push(
      'NEXT_PUBLIC_SEAL_SERVER_CONFIGS must contain at least one usable mainnet key server',
    )
  }

  const walrusTransport = env.NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT?.trim() || 'managed'
  const walrusUploaderUrl = normalizeBaseUrl(env.NEXT_PUBLIC_WALRUS_UPLOADER_URL)
  const hasWalrusUploaderUrl = Boolean(walrusUploaderUrl)
  const hasWalrusUploaderTokenSecret = Boolean(env.WALRUS_UPLOADER_TOKEN_SECRET?.trim())
  if (!WALRUS_UPLOAD_TRANSPORTS.includes(walrusTransport as typeof WALRUS_UPLOAD_TRANSPORTS[number])) {
    errors.push('NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT must be managed, browser, or server')
  } else if (walrusTransport === 'managed') {
    if (walrusUploaderUrl !== PRODUCTION_WALRUS_UPLOADER_URL) {
      errors.push(`Managed Walrus production env requires NEXT_PUBLIC_WALRUS_UPLOADER_URL=${PRODUCTION_WALRUS_UPLOADER_URL}`)
    }
    if (!hasWalrusUploaderTokenSecret) {
      errors.push('Managed Walrus production env requires WALRUS_UPLOADER_TOKEN_SECRET')
    }
  } else if (hasWalrusUploaderUrl || hasWalrusUploaderTokenSecret) {
    errors.push(`NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=${walrusTransport} must not sync NEXT_PUBLIC_WALRUS_UPLOADER_URL or WALRUS_UPLOADER_TOKEN_SECRET`)
  }
  const publicSealWeight = publicSealConfigs.reduce(
    (total, config) => total + config.weight,
    0,
  )
  const mergedSealConfigs = new Map(
    publicSealConfigs.map((config) => [config.objectId, config] as const),
  )
  for (const config of serverSealConfigs) {
    const publicConfig = mergedSealConfigs.get(config.objectId)
    if (!publicConfig) {
      errors.push(
        `SEAL_SERVER_CONFIGS may only override an objectId present in NEXT_PUBLIC_SEAL_SERVER_CONFIGS: ${config.objectId}`,
      )
      continue
    }
    if (config.weightWasProvided && config.weight !== publicConfig.weight) {
      errors.push(
        `SEAL_SERVER_CONFIGS must preserve public weight ${publicConfig.weight} for ${config.objectId}`,
      )
    }
    mergedSealConfigs.set(config.objectId, publicConfig)
  }
  const mergedSealWeight = Array.from(mergedSealConfigs.values()).reduce(
    (total, config) => total + config.weight,
    0,
  )
  if (publicSealWeight >= 255) {
    errors.push(
      `NEXT_PUBLIC_SEAL_SERVER_CONFIGS total weight must be less than 255; received ${publicSealWeight}`,
    )
  }
  if (mergedSealWeight >= 255) {
    errors.push(`Merged Seal key-server weight must be less than 255; received ${mergedSealWeight}`)
  }

  const thresholdRaw = env.NEXT_PUBLIC_SEAL_THRESHOLD?.trim() ?? ''
  const threshold = /^\d+$/.test(thresholdRaw) ? Number.parseInt(thresholdRaw, 10) : Number.NaN
  if (!Number.isFinite(threshold) || threshold <= 0) {
    errors.push('NEXT_PUBLIC_SEAL_THRESHOLD must be a positive integer for mainnet')
  } else if (publicSealWeight > 0 && publicSealWeight < threshold) {
    errors.push(
      `NEXT_PUBLIC_SEAL_SERVER_CONFIGS has weight ${publicSealWeight}, below threshold ${threshold}`,
    )
  } else if (mergedSealWeight > 0 && mergedSealWeight < threshold) {
    errors.push(`Merged Seal key-server weight ${mergedSealWeight} is below threshold ${threshold}`)
  }

  const animacraftEnabled = env.NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED?.trim() === 'true'
  const animacraftAppUrl = env.NEXT_PUBLIC_ANIMACRAFT_APP_URL?.trim() ?? ''
  if (animacraftAppUrl && !isHttpsOrigin(animacraftAppUrl)) {
    errors.push(
      'NEXT_PUBLIC_ANIMACRAFT_APP_URL must be an HTTPS origin without credentials, path, query, or fragment',
    )
  }
  for (const key of [
    'NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID',
    'NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID',
    'NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID',
  ] as const) {
    const value = env[key]?.trim() ?? ''
    if (value && !isNonZeroSuiId(value)) {
      errors.push(`${key} must be a valid non-zero Sui object ID when configured`)
    } else if (animacraftEnabled && !value) {
      errors.push(`${key} is required when canonical Animacraft minting is enabled`)
    }
  }
  const animacraftCommerceV5Enabled =
    env.NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED?.trim() === 'true'
  if (animacraftCommerceV5Enabled) {
    if (!animacraftEnabled) {
      errors.push('Commerce v5 requires NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED=true')
    }
    if (!animacraftAppUrl) {
      errors.push('Commerce v5 requires NEXT_PUBLIC_ANIMACRAFT_APP_URL')
    }
  }
  for (const key of [
    'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PACKAGE_ID',
    'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_TYPE_ORIGIN_PACKAGE_ID',
    'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID',
    'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_TREASURY_ID',
  ] as const) {
    const value = env[key]?.trim() ?? ''
    if (value && !isNonZeroSuiId(value)) {
      errors.push(`${key} must be a valid non-zero Sui object ID when configured`)
    } else if (animacraftCommerceV5Enabled && !value) {
      errors.push(`${key} is required when Animacraft commerce v5 is enabled`)
    }
  }

  const animacraftPhysicalV7Enabled =
    env.NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_ENABLED?.trim() === 'true'
  if (animacraftPhysicalV7Enabled && !animacraftCommerceV5Enabled) {
    errors.push('Physical v7 requires NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED=true')
  }
  for (const key of [
    'NEXT_PUBLIC_ANIMACRAFT_V7_CALLABLE_PACKAGE_ID',
    'NEXT_PUBLIC_ANIMACRAFT_V7_TYPE_ORIGIN_PACKAGE_ID',
    'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_REGISTRY_ID',
    'NEXT_PUBLIC_ANIMACRAFT_PHYSICAL_V7_CONFIG_ID',
    'NEXT_PUBLIC_ANIMACRAFT_COMPOSITION_V6_CONFIG_ID',
  ] as const) {
    const value = env[key]?.trim() ?? ''
    if (value && !isNonZeroSuiId(value)) {
      errors.push(`${key} must be a valid non-zero Sui object ID when configured`)
    } else if (animacraftPhysicalV7Enabled && !value) {
      errors.push(`${key} is required when Animacraft Physical v7 is enabled`)
    }
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
    // Vercel CLI 56 defaults non-interactive env writes to Sensitive. Public
    // browser configuration must opt out explicitly or later pull/readback is
    // impossible. Server-only values stay explicitly sensitive.
    ...(isSensitiveKey(key) ? ['--sensitive'] : ['--no-sensitive']),
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
  const deploymentHistoryPath = resolve(process.cwd(), options.deploymentHistoryFile)
  const env = parse(readFileSync(envPath))
  const requiredHistoricalSealRoutes = loadRequiredHistoricalSealRoutes(
    deploymentHistoryPath,
  )

  assertProductionEnv(env, requiredHistoricalSealRoutes)

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
