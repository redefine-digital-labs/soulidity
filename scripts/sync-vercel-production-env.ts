import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'dotenv'
import { pathToFileURL } from 'node:url'
import { fromBase58, toBase58 } from '@mysten/sui/utils'

export const PRODUCTION_ENV_ALLOWLIST = [
  'NEXT_PUBLIC_SUI_NETWORK',
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
  'NEXT_PUBLIC_ANIMACRAFT_APP_URL',
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
  'NEXT_PUBLIC_POSTHOG_SESSION_REPLAY',
  'POSTHOG_SERVER_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON',
  'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE',
] as const

const FORBIDDEN_ENV_KEYS = new Set([
  // The native tuple is public and has one browser-compatible name.
  'ANIMACRAFT_V8_RECEIVE_TARGET_JSON',
  // Browser uploads no longer use an owned uploader or its token issuer.
  'NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT',
  'NEXT_PUBLIC_WALRUS_UPLOADER_URL',
  'NEXT_PUBLIC_WALRUS_MANAGED_COMPLETE_CONCURRENCY',
  'WALRUS_UPLOADER_TOKEN_SECRET',
  'WALRUS_UPLOADER_TOKEN_TTL_MS',
  'WALRUS_UPLOADER_TOKEN_MAX_FILES',
  'WALRUS_UPLOADER_TOKEN_MAX_BYTES',
  'MAINNET_DEPLOYER_PRIV_KEY',
  'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID',
  'NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID',
  'NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES',
  'NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED',
  'NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_TYPE_ORIGIN_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_TREASURY_ID',
])

export const PRODUCTION_VERCEL_PROJECT_ID = 'prj_TkRy8sVX44TBPB71sDfN03vF1A7S'
/** Exact public chain projection produced by Animacraft export-config
 * --format soulidity-env. Service credentials never belong in this file. */
export const PRODUCTION_CHAIN_ENV_KEYS = [
  'NEXT_PUBLIC_SUI_NETWORK',
  'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
  'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE',
  'NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON',
] as const

export function mergeProductionChainEnv(base: Record<string, string>, source: string): Record<string, string> {
  const invalid = () => { throw new Error('Chain env file must contain exactly the complete exported public chain configuration') }
  if (typeof source !== 'string' || source.length === 0 || Buffer.byteLength(source) > 256 * 1024) return invalid()
  // Match the exporter's literal single-quoted dotenv format. Do not use the
  // permissive dotenv parser here: it silently ignores malformed/duplicate rows.
  const lines = source.endsWith('\n') ? source.slice(0, -1).split('\n') : source.split('\n')
  if (lines.length !== PRODUCTION_CHAIN_ENV_KEYS.length) return invalid()
  const chain: Record<string, string> = {}
  for (const line of lines) {
    const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n\0]*)'$/.exec(line)
    if (!match || !(PRODUCTION_CHAIN_ENV_KEYS as readonly string[]).includes(match[1])
      || Object.hasOwn(chain, match[1]) || !match[2]) return invalid()
    chain[match[1]] = match[2]
  }
  if (!PRODUCTION_CHAIN_ENV_KEYS.every(key => Object.hasOwn(chain, key))) return invalid()
  return { ...base, ...chain }
}
const REQUIRED_ID_KEYS = [
  'NEXT_PUBLIC_KIOSK_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID',
  'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID',
] as const
const REQUIRED_PRODUCTION_KEYS = [
  'NEXT_PUBLIC_SUI_NETWORK',
  ...REQUIRED_ID_KEYS,
  'NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON',
  'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE',
  'DATABASE_URL', 'DIRECT_URL', 'AUTH_SECRET', 'DEFAULT_PROVIDER', 'DEEPSEEK_API_KEY',
] as const

type CliOptions = { apply: boolean; envFile: string; project: string; chainEnvFile?: string }
export function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { apply: false, envFile: '.env', project: '' }
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!['--apply', '--dry-run', '--env-file', '--chain-env-file', '--project'].includes(arg)) {
      throw new Error('Unknown command-line argument')
    }
    const key = arg === '--apply' || arg === '--dry-run' ? 'mode' : arg
    if (seen.has(key)) throw new Error('Duplicate or conflicting command-line option')
    seen.add(key)
    if (arg === '--apply' || arg === '--dry-run') { options.apply = arg === '--apply'; continue }
    const next = argv[++index]
    if (!next || next.startsWith('--')) throw new Error('Command-line option requires a value')
    if (arg === '--env-file') options.envFile = next
    else if (arg === '--chain-env-file') options.chainEnvFile = next
    else options.project = next
  }
  if (options.project !== PRODUCTION_VERCEL_PROJECT_ID) {
    throw new Error('Explicit --project must select the verified Soulidity production project')
  }
  return options
}

function isSensitiveKey(key: string) {
  return !key.startsWith('NEXT_PUBLIC_')
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

function canonicalId(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)
}
function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
function packageDigest(value: unknown): boolean {
  try { return typeof value === 'string' && fromBase58(value).length === 32 && toBase58(fromBase58(value)) === value }
  catch { return false }
}
/** Local configuration consistency only: no RPC, linkage/type-origin attestation,
 * committee proof, publication acceptance or permission to enable writes. */
export function assertNativeProductionTarget(env: Record<string, string>): void {
  const invalid = () => { throw new Error('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON is invalid or differs from the explicit SDK release configuration') }
  let target: unknown
  try { target = JSON.parse(env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON ?? '') } catch { invalid() }
  const ids = ['protocolConfigId', 'coreOriginalPackageId', 'outputOriginalPackageId',
    'outputCallablePackageId', 'soulidityCallablePackageId', 'soulidityOriginalPackageId'] as const
  const switches = ['equipmentWritesEnabled', 'marketWritesEnabled'] as const
  const optional = target && typeof target === 'object'
    ? switches.filter(key => Object.hasOwn(target, key)) : []
  if (!exactObject(target, [...ids, 'outputCallableDigest', 'soulidityCallableDigest',
    'expectedNativeBinding', 'runtime', 'release', 'equipmentMarket', ...optional])) return invalid()
  if (!ids.every(key => canonicalId(target[key]))
    || !['outputCallableDigest', 'soulidityCallableDigest'].every(key => packageDigest(target[key]))
    || !optional.every(key => typeof target[key] === 'boolean')) return invalid()
  const packageRoles = [
    [target.coreOriginalPackageId],
    [target.outputOriginalPackageId, target.outputCallablePackageId],
    [target.soulidityOriginalPackageId, target.soulidityCallablePackageId],
  ]
  for (const key of ['runtime', 'release', 'equipmentMarket']) {
    const pin = target[key]
    const keys = ['originalPackageId', 'callablePackageId', 'callableDigest', ...(key === 'equipmentMarket' ? ['replacementId'] : [])]
    if (!exactObject(pin, keys)
      || !canonicalId(pin.originalPackageId) || !canonicalId(pin.callablePackageId)
      || !packageDigest(pin.callableDigest)) return invalid()
    packageRoles.push([pin.originalPackageId, pin.callablePackageId])
  }
  // Fresh packages may use one identity for both original/callable within a role,
  // but no identity can serve two distinct package roles.
  const packageIds = packageRoles.flatMap(role => [...new Set(role)])
  if (new Set(packageIds).size !== packageIds.length) return invalid()
  const market = target.equipmentMarket as Record<string, unknown>
  if (!canonicalId(market.replacementId) || market.replacementId === target.protocolConfigId
    || packageIds.includes(market.replacementId)) return invalid()
  const names = target.expectedNativeBinding
  const typeKeys = ['soulOriginalType', 'soulDefiningType', 'mintWitnessOriginalType',
    'mintWitnessDefiningType', 'ownerWitnessOriginalType', 'ownerWitnessDefiningType']
  if (!exactObject(names, typeKeys)) return invalid()
  const suffixes = ['soul::Soul', 'animacraft_v8_binding::MintBindingWitnessV8', 'animacraft_v8_binding::SoulOwnerWitnessV8']
  for (const [index, prefix] of ['soul', 'mintWitness', 'ownerWitness'].entries()) {
    const original = names[prefix + 'OriginalType'], defining = names[prefix + 'DefiningType']
    if (original !== target.soulidityOriginalPackageId + '::' + suffixes[index]
      || typeof defining !== 'string' || !canonicalId(defining.split('::')[0])
      || defining !== defining.split('::')[0] + '::' + suffixes[index]) return invalid()
  }
  if ((names.mintWitnessDefiningType as string).split('::')[0] !== (names.ownerWitnessDefiningType as string).split('::')[0]
    || target.soulidityOriginalPackageId !== env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID
    || target.soulidityCallablePackageId !== env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID
    || target.soulidityOriginalPackageId !== env.NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID) return invalid()
}

type ValidatedSealServerConfig = {
  objectId: string
  weight: number
  weightWasProvided: boolean
}

export function parseSealServerConfigs(
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
    if (envName === 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' && parsed.length > 64) {
      throw new Error('must contain at most 64 public services')
    }

    const seenObjectIds = new Set<string>()
    return parsed.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`server ${index} must be an object`)
      }
      const value = entry as Record<string, unknown>
      const publicKeys = ['objectId', 'weight', 'aggregatorUrl']
      const allowedKeys = envName === 'SEAL_SERVER_CONFIGS' ? [...publicKeys, 'apiKeyName', 'apiKey'] : publicKeys
      if (envName === 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' && (Object.hasOwn(value, 'apiKeyName') || Object.hasOwn(value, 'apiKey'))) {
        throw new Error(`server ${index} must not expose API credentials in a NEXT_PUBLIC env`)
      }
      if (Object.keys(value).some(key => !allowedKeys.includes(key))) {
        throw new Error(`server ${index} has unsupported fields`)
      }
      const objectId = typeof value.objectId === 'string'
        ? normalizeNonZeroSuiId(value.objectId)
        : null
      if (!objectId || (envName === 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' && !canonicalId(value.objectId))) {
        throw new Error(`server ${index}.objectId must be a non-zero Sui object ID`)
      }
      if (seenObjectIds.has(objectId)) {
        throw new Error(`server ${index}.objectId duplicates another configured objectId`)
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
      if (envName === 'SEAL_SERVER_CONFIGS' && (Object.hasOwn(value, 'apiKeyName') || Object.hasOwn(value, 'apiKey'))
        && (!hasApiKeyName || !hasApiKey)) {
        throw new Error(`server ${index} must set apiKeyName and apiKey together`)
      }
      if (value.aggregatorUrl !== undefined && (envName === 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' || value.aggregatorUrl !== null)) {
        if (typeof value.aggregatorUrl !== 'string') {
          throw new Error(`server ${index}.aggregatorUrl must be an HTTPS URL`)
        }
        try {
          const aggregatorUrl = new URL(value.aggregatorUrl)
          if (aggregatorUrl.protocol !== 'https:' || aggregatorUrl.username || aggregatorUrl.password || aggregatorUrl.search || aggregatorUrl.hash) {
            throw new Error('invalid')
          }
          if (envName === 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS' && (aggregatorUrl.hostname === 'localhost'
            || /^\d+(?:\.\d+){3}$/.test(aggregatorUrl.hostname) || aggregatorUrl.hostname.includes(':'))) {
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
    errors.push(`${envName} is invalid: ${error instanceof SyntaxError ? 'must be valid JSON' : (error as Error).message}`)
    return []
  }
}

/** Shared explicit chain gate. Local E2E harness credentials are not production
 * env inputs; this check neither requires nor authorizes a signing key. */
export function assertProductionChainEnv(env: Record<string, string>) {
  const errors: string[] = []

  const forbiddenWithValues = Array.from(FORBIDDEN_ENV_KEYS)
    .filter((key) => key !== 'MAINNET_DEPLOYER_PRIV_KEY' && env[key]?.trim())
  if (forbiddenWithValues.length > 0) {
    errors.push(`Refusing to sync forbidden production env keys: ${forbiddenWithValues.join(', ')}`)
  }

  const missingRequired = PRODUCTION_CHAIN_ENV_KEYS
    .filter((key) => !env[key]?.trim())
  if (missingRequired.length > 0) {
    errors.push(`Missing required production env keys: ${missingRequired.join(', ')}`)
  }

  if (env.NEXT_PUBLIC_SUI_NETWORK !== 'mainnet') {
    errors.push('NEXT_PUBLIC_SUI_NETWORK must be mainnet before syncing Vercel Production env')
  }

  for (const key of REQUIRED_ID_KEYS) {
    if (!canonicalId(env[key])) errors.push(`${key} must be a canonical non-zero Sui ID`)
  }
  if (env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE !== '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC') {
    errors.push('NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE must be the native mainnet USDC type')
  }
  try { assertNativeProductionTarget(env) } catch {
    errors.push('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON is invalid or differs from the explicit SDK release configuration')
  }

  if (errors.length > 0) throw new Error(errors.join('\n'))
}

export function assertProductionEnv(env: Record<string, string>) {
  const errors: string[] = []
  if (env.MAINNET_DEPLOYER_PRIV_KEY?.trim()) {
    errors.push('Refusing to sync forbidden production env keys: MAINNET_DEPLOYER_PRIV_KEY')
  }
  const missingRequired = REQUIRED_PRODUCTION_KEYS
    .filter(key => !(PRODUCTION_CHAIN_ENV_KEYS as readonly string[]).includes(key) && !env[key]?.trim())
  if (missingRequired.length > 0) errors.push(`Missing required production env keys: ${missingRequired.join(', ')}`)
  try { assertProductionChainEnv(env) } catch (error) { errors.push((error as Error).message) }

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
        `SEAL_SERVER_CONFIGS may only override an objectId present in NEXT_PUBLIC_SEAL_SERVER_CONFIGS`,
      )
      continue
    }
    if (config.weightWasProvided && config.weight !== publicConfig.weight) {
      errors.push(
        `SEAL_SERVER_CONFIGS must preserve public weight`,
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
      `NEXT_PUBLIC_SEAL_SERVER_CONFIGS total weight must be less than 255`,
    )
  }
  if (mergedSealWeight >= 255) {
    errors.push(`Merged Seal key-server weight must be less than 255`)
  }

  const thresholdRaw = env.NEXT_PUBLIC_SEAL_THRESHOLD?.trim() ?? ''
  const threshold = /^\d+$/.test(thresholdRaw) ? Number.parseInt(thresholdRaw, 10) : Number.NaN
  if (!Number.isFinite(threshold) || threshold <= 0) {
    errors.push('NEXT_PUBLIC_SEAL_THRESHOLD must be a positive integer for mainnet')
  } else if (publicSealWeight > 0 && publicSealWeight < threshold) {
    errors.push(
      `NEXT_PUBLIC_SEAL_SERVER_CONFIGS has weight below threshold`,
    )
  } else if (mergedSealWeight > 0 && mergedSealWeight < threshold) {
    errors.push(`Merged Seal key-server weight is below threshold`)
  }

  const animacraftAppUrl = env.NEXT_PUBLIC_ANIMACRAFT_APP_URL?.trim()
  if (animacraftAppUrl && !isHttpsOrigin(animacraftAppUrl)) {
    errors.push('NEXT_PUBLIC_ANIMACRAFT_APP_URL must be an HTTPS origin without credentials, path, query, or fragment')
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
}

function syncEnvVar(key: string, value: string, project: string) {
  const args = [
    'vercel',
    'env',
    'add',
    key,
    'production',
    '--project',
    project,
    '--force',
    '--yes',
    // Vercel CLI 56 defaults non-interactive env writes to Sensitive. Public
    // browser configuration must opt out explicitly or later pull/readback is
    // impossible. Server-only values stay explicitly sensitive.
    ...(isSensitiveKey(key) ? ['--sensitive'] : ['--no-sensitive']),
  ]
  const result = spawnSync('npx', args, {
    input: value,
    // CLI errors may echo stdin, so never forward its output to deployment logs.
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 25_000,
  })

  if (result.status !== 0) {
    throw new Error(`vercel env add failed for ${key} with exit code ${result.status ?? 'unknown'}`)
  }
}

export function runProductionEnvSync(argv: string[]) {
  const options = parseCliOptions(argv)
  let env: Record<string, string>
  try { env = parse(readFileSync(resolve(process.cwd(), options.envFile))) }
  catch { throw new Error('Unable to read the requested env file') }
  if (options.chainEnvFile !== undefined) {
    let chainSource: string
    try { chainSource = readFileSync(resolve(process.cwd(), options.chainEnvFile), 'utf8') }
    catch { throw new Error('Unable to read the requested chain env file') }
    env = mergeProductionChainEnv(env, chainSource)
  }
  assertProductionEnv(env)
  const selectedEntries = PRODUCTION_ENV_ALLOWLIST
    .map(key => [key, env[key]] as const)
    .filter((entry): entry is readonly [typeof PRODUCTION_ENV_ALLOWLIST[number], string] => Boolean(entry[1]?.trim()))
  console.log(`${options.apply ? 'Syncing' : 'Dry run for'} ${selectedEntries.length} production env keys; project ${PRODUCTION_VERCEL_PROJECT_ID}`)
  for (const [key] of selectedEntries) console.log(`- ${key}${isSensitiveKey(key) ? ' (sensitive)' : ''}`)
  console.log('Retired remote-key removal plan (if present; not inspected or deleted by this script):')
  for (const key of FORBIDDEN_ENV_KEYS) console.log(`- remove ${key}`)
  console.log('Remove retired remote keys only together with the matching runtime configuration cutover.')
  console.log('Local configuration validation only; not chain publication, release acceptance or write-gate authorization.')
  if (!options.apply) { console.log('Dry run only. No network operation performed.'); return }
  for (const [key, value] of selectedEntries) syncEnvVar(key, value, options.project)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { runProductionEnvSync(process.argv.slice(2)) }
  catch (error) {
    console.error(error instanceof Error ? error.message : 'Production env sync failed')
    process.exitCode = 1
  }
}
