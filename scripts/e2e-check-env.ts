/** Local mainnet harness preflight, not release authorization or wallet/browser
 * acceptance. Chain inputs are the explicit paired native export; no manifest
 * fallback or retired issuer flags. Importing this module performs no I/O. */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodeEd25519SecretKey } from './lib/keypair'
import { assertProductionChainEnv, parseSealServerConfigs } from './sync-vercel-production-env'

const ROLE_KEYS = [
  ['Seller', 'E2E_SELLER_PRIVATE_KEY'],
  ['Buyer', 'E2E_BUYER_PRIVATE_KEY'],
  ['Agent Alpha', 'E2E_AGENT_ALPHA_PRIVATE_KEY'],
  ['Agent Beta', 'E2E_AGENT_BETA_PRIVATE_KEY'],
  ['Dev', 'E2E_DEV_PRIVATE_KEY'],
] as const

type Failure = { check: string; reason: string }
export function validateMainnetE2eEnv(env: Record<string, string | undefined>) {
  const failures: Failure[] = []
  const successes: string[] = []
  const addresses: Array<{ label: string; envName: string; address: string }> = []
  const fail = (check: string, reason: string) => failures.push({ check, reason })
  function present(name: string, minLen = 1): string | null {
    const value = env[name]?.trim()
    if (!value) { fail(name, 'missing'); return null }
    if (value.startsWith('<') && value.endsWith('>')) { fail(name, 'still a placeholder'); return null }
    if (value.length < minLen) { fail(name, `must contain at least ${minLen} characters`); return null }
    return value
  }
  // Only public field names and fixed diagnostics may leave the validator.
  const chainEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  try {
    assertProductionChainEnv(chainEnv); successes.push('Explicit native chain configuration')
    const target = JSON.parse(chainEnv.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON)
    // The former preflight required its issuer/commerce gates to be enabled.
    // Preserve that execution prerequisite using the current gates, without
    // changing them or confusing a configured closed rollout with full E2E.
    for (const key of ['equipmentWritesEnabled', 'marketWritesEnabled']) {
      if (target[key] !== true) fail('Native E2E write gates', `${key} is disabled or absent; full funded E2E is not ready`)
    }
  }
  catch (error) { fail('Native chain configuration', (error as Error).message) }

  if (present('AUTH_SECRET', 32)) successes.push('AUTH_SECRET length')
  for (const name of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const raw = present(name)
    if (!raw) continue
    try {
      const url = new URL(raw)
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || /\s/.test(raw)) throw new Error()
      successes.push(`${name} format`)
    } catch { fail(name, 'must be a postgres URL') }
  }

  // Preserve the existing automated harness's master/role isolation checks.
  // This local credential is never projected into production configuration and
  // is not evidence of authority for the separate fixed-signer release runner.
  for (const [label, envName] of [['Master', 'MAINNET_DEPLOYER_PRIV_KEY'], ...ROLE_KEYS]) {
    const value = present(envName)
    if (!value) continue
    try {
      const address = decodeEd25519SecretKey(value, envName).toSuiAddress()
      if (addresses.some(row => row.address === address)) fail(envName, 'address collides with another harness role or master')
      addresses.push({ label, envName, address })
      successes.push(`${envName} format`)
    } catch { fail(envName, 'cannot decode a Sui Ed25519 private key') }
  }
  for (const name of ['E2E_AGENT_ALPHA_API_KEY', 'E2E_AGENT_BETA_API_KEY']) {
    if (present(name, 16)) successes.push(`${name} length`)
  }
  if (present('NEXT_PUBLIC_E2E_TEST_MODE') === '1') successes.push('Local development wallet harness selected')
  else fail('NEXT_PUBLIC_E2E_TEST_MODE', 'must be 1 for this local development harness; not a production wallet gate')
  const wal = present('MAINNET_WAL_COIN_TYPE')
  if (wal && /^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(wal)
    && !/^0x0+::/.test(wal)) successes.push('WAL coin type format')
  else if (wal) fail('MAINNET_WAL_COIN_TYPE', 'must be a non-zero Sui coin type')

  const sealErrors: string[] = []
  const seal = present('NEXT_PUBLIC_SEAL_SERVER_CONFIGS')
  const servers = parseSealServerConfigs(seal ?? undefined, 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS', sealErrors)
  const thresholdRaw = present('NEXT_PUBLIC_SEAL_THRESHOLD')
  const threshold = thresholdRaw && /^\d+$/.test(thresholdRaw) ? Number(thresholdRaw) : NaN
  const weight = servers.reduce((sum, server) => sum + server.weight, 0)
  if (!servers.length) sealErrors.push('A nonempty public mainnet key-server list is required')
  if (!Number.isInteger(threshold) || threshold <= 0 || threshold >= 255 || weight >= 255 || weight < threshold) {
    sealErrors.push('Seal threshold must be positive, within total server weight, and below 255')
  }
  for (const reason of sealErrors) fail('Seal configuration', reason)
  if (!sealErrors.length) successes.push('Public Seal server list and weighted threshold')

  const app = present('NEXT_PUBLIC_ANIMACRAFT_APP_URL')
  if (app) {
    try {
      const url = new URL(app)
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || app.replace(/\/+$/, '') !== url.origin) throw new Error()
      successes.push('Animacraft HTTPS origin')
    } catch { fail('NEXT_PUBLIC_ANIMACRAFT_APP_URL', 'must be an HTTPS origin without credentials, path, query, or fragment') }
  }
  const relay = present('NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL')
  if (relay) {
    try {
      const url = new URL(relay)
      if (!/^https:\/\/[^\s\\]+$/.test(relay) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error()
      successes.push('Walrus HTTPS relay URL')
    } catch { fail('NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL', 'must be an HTTPS URL without credentials, query, or fragment') }
  }
  return { ok: failures.length === 0, failures, successes, addresses }
}

export async function runMainnetE2eEnvGate() {
  // Preserve the established CLI > .env.e2e > .env.local > .env precedence.
  const { loadEnvFile } = await import('./lib/dotenv')
  loadEnvFile('.env.e2e')
  const result = validateMainnetE2eEnv(process.env)
  console.log('Local mainnet E2E harness configuration (no signing, funding, RPC or DB operations)')
  for (const success of result.successes) console.log(`OK: ${success}`)
  for (const row of result.addresses) console.log(`${row.label}: ${row.address}`)
  for (const failure of result.failures) console.error(`${failure.check}: ${failure.reason}`)
  if (result.ok) console.log('Local configuration passed. This is not release, real-wallet or product acceptance.')
  else console.error('Configuration failed. Do not run funded harness actions until corrected and authorized.')
  return result.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMainnetE2eEnvGate().then(code => { process.exitCode = code }).catch(() => {
    console.error('Unable to load local E2E configuration. No supplied values were logged.')
    process.exitCode = 1
  })
}
