/**
 * W1.6 — Mainnet E2E env gate.
 *
 * Validates `.env.e2e` (already loaded into process.env via the dotenv
 * shim) so the operator finds out about a missing field BEFORE spending
 * real mainnet WAL / USDC. Refuses to print "OK" until every field the
 * test plan expects is present, non-placeholder, and consistent with
 * `packages/soulidity-sdk/src/deployment-manifest.json` mainnet segment.
 *
 * Checks:
 *   1. NEXT_PUBLIC_SUI_NETWORK must equal "mainnet"
 *   2. AUTH_SECRET ≥ 32 chars
 *   3. DATABASE_URL + DIRECT_URL look like postgres URLs (non-placeholder)
 *   4. MAINNET_DEPLOYER_PRIV_KEY decodes; address printed
 *   5. 5× E2E_*_PRIVATE_KEY decode; addresses printed; no duplicates;
 *      none equals MAINNET_DEPLOYER address
 *   6. 2× E2E_AGENT_*_API_KEY non-placeholder, ≥ 16 chars
 *   7. NEXT_PUBLIC_E2E_TEST_MODE=1
 *   8. MAINNET_WAL_COIN_TYPE looks like "0x…::module::SYM"
 *   9. NEXT_PUBLIC_SEAL_SERVER_CONFIGS is JSON list with ≥ NEXT_PUBLIC_SEAL_THRESHOLD entries
 *  10. NEXT_PUBLIC_KIOSK_PACKAGE_ID present
 *  11. NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL is https URL
 *  12. Manifest .mainnet packageId / marketConfigId / kindRegistryId / paymentCoinType
 *      consistent with what `@soulidity/sdk` resolves
 *
 * Live runtime probes (Seal `/v1/service`, Walrus relay tip-config) are
 * intentionally out of scope here — those are Phase -1.5 / -1.8 of the
 * plan and need network access. This script is the cheap pre-flight
 * that catches misconfiguration without sending any HTTP request.
 *
 * Exit code 0 iff every check passes; 1 otherwise.
 */
import './lib/dotenv'
import { loadEnvFile } from './lib/dotenv'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeEd25519SecretKey } from './lib/keypair'

loadEnvFile('.env.e2e')

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const MANIFEST_PATH = resolve(REPO_ROOT, 'packages/soulidity-sdk/src/deployment-manifest.json')

const ROLE_KEYS = [
  ['Seller', 'E2E_SELLER_PRIVATE_KEY'],
  ['Buyer', 'E2E_BUYER_PRIVATE_KEY'],
  ['Agent Alpha', 'E2E_AGENT_ALPHA_PRIVATE_KEY'],
  ['Agent Beta', 'E2E_AGENT_BETA_PRIVATE_KEY'],
  ['Dev', 'E2E_DEV_PRIVATE_KEY'],
] as const

type Failure = { check: string; reason: string }

class Validator {
  readonly failures: Failure[] = []
  readonly successes: string[] = []

  fail(check: string, reason: string) {
    this.failures.push({ check, reason })
  }

  pass(check: string) {
    this.successes.push(check)
  }

  checkPresent(check: string, name: string, opts: { minLen?: number } = {}): string | null {
    const value = process.env[name]?.trim()
    if (!value) {
      this.fail(check, `${name} is missing`)
      return null
    }
    if (value.startsWith('<') && value.endsWith('>')) {
      this.fail(check, `${name} is still a placeholder (${value})`)
      return null
    }
    if (opts.minLen && value.length < opts.minLen) {
      this.fail(check, `${name} is shorter than ${opts.minLen} chars`)
      return null
    }
    return value
  }

  done(): boolean {
    return this.failures.length === 0
  }
}

function readManifestMainnet() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`deployment-manifest.json missing at ${MANIFEST_PATH}`)
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<
    string,
    Record<string, string | undefined>
  >
  const segment = manifest.mainnet
  if (!segment) {
    throw new Error('manifest.mainnet segment is missing')
  }
  return segment
}

function validatePostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\/[^\s]+/.test(value)
}

function main() {
  const v = new Validator()

  // 1. Network
  const network = v.checkPresent('NEXT_PUBLIC_SUI_NETWORK', 'NEXT_PUBLIC_SUI_NETWORK')
  if (network && network !== 'mainnet') {
    v.fail('NEXT_PUBLIC_SUI_NETWORK', `expected "mainnet", got "${network}"`)
  } else if (network) {
    v.pass('NEXT_PUBLIC_SUI_NETWORK = mainnet')
  }

  // 2. AUTH_SECRET
  v.checkPresent('AUTH_SECRET', 'AUTH_SECRET', { minLen: 32 }) && v.pass('AUTH_SECRET (≥ 32 chars)')

  // 3. DB URLs
  for (const name of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const url = v.checkPresent(name, name)
    if (url && !validatePostgresUrl(url)) {
      v.fail(name, `${name} is not a postgres URL`)
    } else if (url) {
      v.pass(`${name} (postgres URL)`)
    }
  }

  // 4. Master keypair
  let masterAddress: string | null = null
  const masterKey = v.checkPresent('MAINNET_DEPLOYER_PRIV_KEY', 'MAINNET_DEPLOYER_PRIV_KEY')
  if (masterKey) {
    try {
      masterAddress = decodeEd25519SecretKey(masterKey, 'MAINNET_DEPLOYER_PRIV_KEY').toSuiAddress()
      v.pass(`MAINNET_DEPLOYER_PRIV_KEY → ${masterAddress}`)
    } catch (err) {
      v.fail('MAINNET_DEPLOYER_PRIV_KEY', `cannot decode: ${(err as Error).message}`)
    }
  }

  // 5. Role keypairs
  const roleAddresses: Array<{ label: string; envName: string; address: string }> = []
  for (const [label, envName] of ROLE_KEYS) {
    const value = v.checkPresent(`${label} keypair`, envName)
    if (!value) continue
    try {
      const address = decodeEd25519SecretKey(value, envName).toSuiAddress()
      roleAddresses.push({ label, envName, address })
      v.pass(`${envName} → ${address}`)
    } catch (err) {
      v.fail(envName, `cannot decode: ${(err as Error).message}`)
    }
  }
  // Uniqueness
  const uniq = new Set<string>()
  for (const r of roleAddresses) {
    if (uniq.has(r.address)) {
      v.fail('Role uniqueness', `${r.envName} address ${r.address} collides with another role`)
    }
    uniq.add(r.address)
  }
  if (masterAddress && uniq.has(masterAddress)) {
    v.fail(
      'Master vs role isolation',
      `Master address ${masterAddress} also appears among E2E role keys — they must be distinct`,
    )
  }

  // 6. Agent API keys
  for (const name of ['E2E_AGENT_ALPHA_API_KEY', 'E2E_AGENT_BETA_API_KEY'] as const) {
    const value = v.checkPresent(name, name, { minLen: 16 })
    if (value) v.pass(`${name} (≥ 16 chars)`)
  }

  // 7. E2E test mode flag
  const testMode = v.checkPresent('NEXT_PUBLIC_E2E_TEST_MODE', 'NEXT_PUBLIC_E2E_TEST_MODE')
  if (testMode && testMode !== '1') {
    v.fail('NEXT_PUBLIC_E2E_TEST_MODE', `expected "1", got "${testMode}"`)
  } else if (testMode) {
    v.pass('NEXT_PUBLIC_E2E_TEST_MODE = 1')
  }

  // 8. WAL coin type
  const walType = v.checkPresent('MAINNET_WAL_COIN_TYPE', 'MAINNET_WAL_COIN_TYPE')
  if (walType && !/^0x[0-9a-fA-F]+::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(walType)) {
    v.fail('MAINNET_WAL_COIN_TYPE', `not a valid coin type ("${walType}")`)
  } else if (walType) {
    v.pass(`MAINNET_WAL_COIN_TYPE = ${walType}`)
  }

  // 9. Seal config
  const sealConfigs = v.checkPresent('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS')
  const sealThresholdRaw = v.checkPresent('NEXT_PUBLIC_SEAL_THRESHOLD', 'NEXT_PUBLIC_SEAL_THRESHOLD')
  const sealThreshold = sealThresholdRaw ? Number(sealThresholdRaw) : NaN
  if (sealThresholdRaw && (!Number.isInteger(sealThreshold) || sealThreshold <= 0)) {
    v.fail('NEXT_PUBLIC_SEAL_THRESHOLD', `must be a positive integer, got "${sealThresholdRaw}"`)
  }
  if (sealConfigs) {
    let parsed: unknown
    try {
      parsed = JSON.parse(sealConfigs)
    } catch {
      // Allow comma-separated URLs as fallback (matches plan's probe code).
      parsed = sealConfigs.split(',').map((s) => ({ url: s.trim() })).filter((e) => e.url)
    }
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { servers?: unknown[] })?.servers ?? []
    if (!Array.isArray(list) || list.length === 0) {
      v.fail('NEXT_PUBLIC_SEAL_SERVER_CONFIGS', 'no servers parsed')
    } else if (Number.isInteger(sealThreshold) && list.length < sealThreshold) {
      v.fail('Seal threshold', `${list.length} server(s) < threshold ${sealThreshold}`)
    } else {
      v.pass(`NEXT_PUBLIC_SEAL_SERVER_CONFIGS (${list.length} server(s); threshold ${sealThreshold})`)
    }
  }

  // 10. Kiosk package
  const kioskPkg = v.checkPresent('NEXT_PUBLIC_KIOSK_PACKAGE_ID', 'NEXT_PUBLIC_KIOSK_PACKAGE_ID')
  if (kioskPkg && !/^0x[0-9a-fA-F]{1,64}$/.test(kioskPkg)) {
    v.fail('NEXT_PUBLIC_KIOSK_PACKAGE_ID', `not a valid object id ("${kioskPkg}")`)
  } else if (kioskPkg) {
    v.pass(`NEXT_PUBLIC_KIOSK_PACKAGE_ID = ${kioskPkg}`)
  }

  // 11. Walrus relay
  const walrusRelay = v.checkPresent(
    'NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL',
    'NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL',
  )
  if (walrusRelay && !/^https?:\/\/[^\s]+/.test(walrusRelay)) {
    v.fail('NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL', `not an http(s) URL ("${walrusRelay}")`)
  } else if (walrusRelay) {
    v.pass(`NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL = ${walrusRelay}`)
  }

  // 12. Manifest consistency. The SDK env helper falls back to manifest
  // when NEXT_PUBLIC_SOULIDITY_* is unset; verify that the manifest mainnet
  // segment has the canonical fields the plan depends on.
  let manifest: Record<string, string | undefined> | null = null
  try {
    manifest = readManifestMainnet()
  } catch (err) {
    v.fail('Manifest mainnet', (err as Error).message)
  }
  if (manifest) {
    const required = [
      'packageId',
      'marketConfigId',
      'kioskRegistryId',
      'kindRegistryId',
      'soulTransferPolicyId',
      'collectionTransferPolicyId',
      'paymentCoinType',
      'kindAdminCapId',
      'marketAdminCapId',
    ] as const
    for (const key of required) {
      const value = manifest[key]
      if (!value) {
        v.fail('Manifest mainnet', `manifest.mainnet.${key} is missing`)
      } else if (key !== 'paymentCoinType' && !/^0x[0-9a-fA-F]+$/.test(value)) {
        v.fail('Manifest mainnet', `manifest.mainnet.${key} is not an object id ("${value}")`)
      }
    }
    if (manifest.paymentCoinType && !manifest.paymentCoinType.includes('::usdc::USDC')) {
      v.fail('Manifest mainnet paymentCoinType', `expected "...::usdc::USDC", got "${manifest.paymentCoinType}"`)
    }
    // Cross-check: if any NEXT_PUBLIC_SOULIDITY_* env var is set, it must
    // match the manifest. Drift here would silently bypass the manifest
    // and is the exact failure mode this gate is designed to catch.
    const overrides: Array<[string, keyof typeof manifest]> = [
      ['NEXT_PUBLIC_SOULIDITY_PACKAGE_ID', 'packageId'],
      ['NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID', 'marketConfigId'],
      ['NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID', 'kioskRegistryId'],
      ['NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', 'kindRegistryId'],
      ['NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE', 'paymentCoinType'],
    ]
    for (const [envName, key] of overrides) {
      const envVal = process.env[envName]?.trim()
      if (envVal && envVal !== manifest[key]) {
        v.fail(
          `${envName} drift`,
          `env ${envName}=${envVal} but manifest.mainnet.${key}=${manifest[key]}`,
        )
      }
    }
    if (v.failures.length === 0) {
      v.pass(`Manifest mainnet OK (packageId=${manifest.packageId})`)
    }
  }

  // ── Output ───────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('E2E mainnet env gate')
  console.log('═══════════════════════════════════════════════════════════════')
  for (const s of v.successes) {
    console.log(`  ✓ ${s}`)
  }
  if (v.failures.length > 0) {
    console.log()
    console.error(`Found ${v.failures.length} problem(s):`)
    for (const f of v.failures) {
      console.error(`  ✗ ${f.check}: ${f.reason}`)
    }
    console.error('\nFix the items above and re-run. Do not start dev server or fund roles until this passes.')
    process.exit(1)
  }
  console.log()
  console.log('Address summary:')
  if (masterAddress) console.log(`  master       ${masterAddress}`)
  for (const r of roleAddresses) {
    console.log(`  ${r.label.padEnd(12)} ${r.address}`)
  }
  console.log()
  console.log('Env gate OK: mainnet e2e prerequisites present.')
}

try {
  main()
} catch (err) {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
}
