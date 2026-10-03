import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeProductionChainEnv, parseCliOptions, PRODUCTION_CHAIN_ENV_KEYS } from '../../scripts/sync-vercel-production-env'

const SCRIPT = 'scripts/sync-vercel-production-env.ts'
const VALID_PUBLIC_SEAL_CONFIG = JSON.stringify([{
  objectId: `0x${'9'.repeat(64)}`,
  weight: 1,
}])
const PROJECT = 'prj_TkRy8sVX44TBPB71sDfN03vF1A7S'
const ACTIVE_SOULIDITY_PACKAGE_ID =
  '0xa43cc9a94caa904a97316d97c08804369ee8fbe3335d2ddae154022d7d6e5d5d'

const tempDirs: string[] = []
const productionSupportEnv = {
  NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER: '35834a8a', NEXT_PUBLIC_WALRUS_AGGREGATOR_URL: 'https://aggregator.example',
  NEXT_PUBLIC_SOULIDITY_PROFILE_WRITES_ENABLED: 'false', NEXT_PUBLIC_SOULIDITY_SOCIAL_WRITES_ENABLED: 'false',
  NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED: 'false', NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTES_WRITES_ENABLED: 'false',
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_testprojectkey',
  NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
}

function nativeConfig() {
  const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
  const original = ACTIVE_SOULIDITY_PACKAGE_ID
  const digest = '11111111111111111111111111111111'
  return {
    NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID: id(31), NEXT_PUBLIC_SOULIDITY_SOCIAL_REGISTRY_ID: id(32),
    NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID: id(33), NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID: id(34),
    NEXT_PUBLIC_WALRUS_BLOB_TYPE: '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77::blob::Blob',
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: id(20),
    NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID: id(21),
    NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID: id(22),
    NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: id(23),
    NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID: id(24),
    NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify({
      protocolConfigId: id(1), coreOriginalPackageId: id(2),
      outputOriginalPackageId: id(3), outputCallablePackageId: id(3), outputCallableDigest: digest,
      soulidityOriginalPackageId: original, soulidityCallablePackageId: original, soulidityCallableDigest: digest,
      runtime: { originalPackageId: id(4), callablePackageId: id(4), callableDigest: digest },
      release: { originalPackageId: id(5), callablePackageId: id(5), callableDigest: digest },
      equipmentMarket: { originalPackageId: id(6), callablePackageId: id(6), callableDigest: digest, replacementId: id(7) },
      expectedNativeBinding: {
        soulOriginalType: `${original}::soul::Soul`, soulDefiningType: `${original}::soul::Soul`,
        mintWitnessOriginalType: `${original}::animacraft_v8_binding::MintBindingWitnessV8`,
        mintWitnessDefiningType: `${original}::animacraft_v8_binding::MintBindingWitnessV8`,
        ownerWitnessOriginalType: `${original}::animacraft_v8_binding::SoulOwnerWitnessV8`,
        ownerWitnessDefiningType: `${original}::animacraft_v8_binding::SoulOwnerWitnessV8`,
      }, equipmentWritesEnabled: false, marketWritesEnabled: false,
    }),
  }
}

function writeEnvFile(extra: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'clawnews-env-sync-'))
  tempDirs.push(dir)
  const env = {
    NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_KIOSK_PACKAGE_ID: `0x${'1'.repeat(64)}`,
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SEAL_SERVER_CONFIGS: VALID_PUBLIC_SEAL_CONFIG,
    NEXT_PUBLIC_SEAL_THRESHOLD: '1',
    ...nativeConfig(),
    ...productionSupportEnv,
    ...extra,
  }
  const path = join(dir, '.env.production')
  writeFileSync(path, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'))
  return path
}

function runSync(envFile: string, extra: string[] = []) {
  return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, '--dry-run', '--project', PROJECT, '--env-file', envFile, ...extra], {
    cwd: process.cwd(), encoding: 'utf8',
  })
}

function runApplyWithFakeVercel(envFile: string) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-vercel-cli-'))
  tempDirs.push(dir)
  const capturePath = join(dir, 'calls.jsonl')
  const npxPath = join(dir, 'npx')
  writeFileSync(npxPath, `#!/usr/bin/env node
const fs = require('node:fs')
fs.readFileSync(0, 'utf8')
fs.appendFileSync(process.env.VERCEL_CALL_CAPTURE, JSON.stringify(process.argv.slice(2)) + '\\n')
`)
  chmodSync(npxPath, 0o755)
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    SCRIPT,
    '--apply',
    '--project', PROJECT,
    '--env-file',
    envFile,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      VERCEL_CALL_CAPTURE: capturePath,
    },
  })
  const calls = result.status === 0
    ? readFileSync(capturePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])
    : []
  return { result, calls }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

// Independent literal17 projection matching export-config --format soulidity-env.
// Valid local configuration is not an attestation of a real deployment/WAL.
const CHAIN_KEYS = [
  'NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_SOCIAL_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID',
  'NEXT_PUBLIC_WALRUS_BLOB_TYPE',
  'NEXT_PUBLIC_SUI_NETWORK', 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', 'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID',
  'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
  'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID', 'NEXT_PUBLIC_KIOSK_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE', 'NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON',
]
function chainConfig(): Record<string, string> {
  return { NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: ACTIVE_SOULIDITY_PACKAGE_ID,
    NEXT_PUBLIC_KIOSK_PACKAGE_ID: `0x${'1'.repeat(64)}`, ...nativeConfig() }
}
function chainSource(config = chainConfig()) {
  return Object.entries(config).map(([key, value]) => `${key}='${value}'`).join('\n') + '\n'
}
function chainFile(source: string) {
  const dir = mkdtempSync(join(tmpdir(), 'native-chain-env-')); tempDirs.push(dir)
  const file = join(dir, 'chain.env'); writeFileSync(file, source); return file
}
describe('explicit native chain env overlay', () => {
  it('accepts optional CLI path without changing default dry-run or explicit project enforcement', () => {
    expect(parseCliOptions(['--project', PROJECT, '--chain-env-file', '/synthetic/chain.env'])).toEqual({
      apply: false, envFile: '.env', project: PROJECT, chainEnvFile: '/synthetic/chain.env',
    })
    for (const args of [ ['--chain-env-file'], ['--chain-env-file', '--apply'],
      ['--chain-env-file', 'a', '--chain-env-file', 'b'], ['--chain-env-file', 'a', '--project', 'wrong'] ]) {
      expect(() => parseCliOptions(args)).toThrow()
    }
  })
  it('overlays all17 chain keys, retains static configuration and preserves actual single-quoted JSON', () => {
    expect([...PRODUCTION_CHAIN_ENV_KEYS].sort()).toEqual([...CHAIN_KEYS].sort())
    const base = { ...Object.fromEntries(CHAIN_KEYS.map(k => [k, 'OLD_CHAIN_VALUE'])),
      NEXT_PUBLIC_BASE_URL: 'https://unchanged.example' }
    const before = { ...base }, expected = chainConfig()
    const merged = mergeProductionChainEnv(base, chainSource(expected))
    for (const key of CHAIN_KEYS) expect(merged[key]).toBe(expected[key])
    expect(merged.NEXT_PUBLIC_BASE_URL).toBe(base.NEXT_PUBLIC_BASE_URL)
    expect(merged.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON).toBe(expected.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON)
    expect(JSON.parse(merged.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON).marketWritesEnabled).toBe(false)
    expect(base).toEqual(before)
  })
  it.each(CHAIN_KEYS)('rejects missing chain field %s instead of retaining its old base value', key => {
    const config = chainConfig(); delete config[key]
    expect(() => mergeProductionChainEnv(chainConfig(), chainSource(config))).toThrow('complete exported public chain configuration')
  })
  it.each(['AUTH_SECRET', 'DATABASE_URL', 'SEAL_SERVER_CONFIGS', 'NEXT_PUBLIC_BASE_URL',
    'MAINNET_DEPLOYER_PRIV_KEY', 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID', 'UNKNOWN'])('rejects extra service/secret/retired key %s without echoing content', key => {
    const source = chainSource() + `${key}='DO_NOT_PRINT_SECRET'\n`
    let message = ''; try { mergeProductionChainEnv({}, source) } catch (error) { message = (error as Error).message }
    expect(message).toContain('complete exported public chain configuration')
    expect(message).not.toContain('DO_NOT_PRINT_SECRET'); expect(message).not.toContain(key)
  })
  it.each([
    (s: string) => s.replace("NEXT_PUBLIC_SUI_NETWORK='mainnet'", "AUTH_SECRET='DO_NOT_PRINT_SECRET'"),
    (s: string) => s.replace("NEXT_PUBLIC_SUI_NETWORK='mainnet'", "NEXT_PUBLIC_KIOSK_PACKAGE_ID='DO_NOT_PRINT_SECRET'"),
    (s: string) => s.replace("NEXT_PUBLIC_SUI_NETWORK='mainnet'", "NEXT_PUBLIC_SUI_NETWORK=''"),
    (s: string) => s.replace("NEXT_PUBLIC_SUI_NETWORK='mainnet'", 'INVALID DO_NOT_PRINT_SECRET'),
    (s: string) => s.replace("NEXT_PUBLIC_SUI_NETWORK='mainnet'", "NEXT_PUBLIC_SUI_NETWORK='mainnet' # DO_NOT_PRINT_SECRET"),
    (s: string) => s.replace(/\n/g, '\r\n'),
    (s: string) => s + '\n',
    (s: string) => s.replace('mainnet', 'main\0net'),
  ])('rejects malformed, duplicate or hidden dotenv input rather than silently ignoring rows', mutate => {
    expect(() => mergeProductionChainEnv({}, mutate(chainSource()))).toThrow('complete exported public chain configuration')
  })
  it('actual dry-run reads the overlay before full validation, replacing obsolete chain values only', () => {
    const base = writeEnvFile({ ...productionSupportEnv,
      ...Object.fromEntries(CHAIN_KEYS.map(key => [key, 'OLD_CHAIN_VALUE'])) })
    const overlay = chainFile(chainSource()), result = runSync(base, ['--chain-env-file', overlay])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Dry run only. No network operation performed.')
    expect(result.stdout).toContain(PROJECT)
    for (const key of CHAIN_KEYS) expect(result.stdout).toContain(`- ${key}`)
    for (const value of [ACTIVE_SOULIDITY_PACKAGE_ID, chainConfig().NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON,
      'OLD_CHAIN_VALUE', 'test-auth-secret', 'test-upstash-token']) {
      expect(result.stdout + result.stderr).not.toContain(value)
    }
  })
  it('overlay does not hide retired base keys or missing static configuration', () => {
    const overlay = chainFile(chainSource())
    const legacy = runSync(writeEnvFile({ ...productionSupportEnv,
      NEXT_PUBLIC_SOULIDITY_PACKAGE_ID: 'DO_NOT_PRINT_SECRET' }), ['--chain-env-file', overlay])
    expect(legacy.status).toBe(1); expect(legacy.stderr).toContain('forbidden production env keys')
    expect(legacy.stderr).not.toContain('DO_NOT_PRINT_SECRET')
    const missing = runSync(writeEnvFile({ ...productionSupportEnv, NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER: '' }), ['--chain-env-file', overlay])
    expect(missing.status).toBe(1); expect(missing.stderr).toContain('Missing required production env keys: NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER')
  })
  it('merged chain values still undergo exact mainnet/native-target validation', () => {
    const config = chainConfig(); config.NEXT_PUBLIC_SUI_NETWORK = 'testnet'
    const result = runSync(writeEnvFile({ ...productionSupportEnv }),
      ['--chain-env-file', chainFile(chainSource(config))])
    expect(result.status).toBe(1); expect(result.stderr).toContain('must be mainnet')
  })
  it('actual parser/read failures never reveal chain contents or a secret-looking path', () => {
    const base = writeEnvFile({ ...productionSupportEnv })
    const bad = runSync(base, ['--chain-env-file', chainFile(chainSource() + "AUTH_SECRET='DO_NOT_PRINT_SECRET'\n")])
    expect(bad.status).toBe(1); expect(bad.stderr).toContain('complete exported public chain configuration')
    expect(bad.stdout + bad.stderr).not.toContain('DO_NOT_PRINT_SECRET')
    const missing = runSync(base, ['--chain-env-file', '/nonexistent/DO_NOT_PRINT_SECRET'])
    expect(missing.status).toBe(1); expect(missing.stderr).toContain('Unable to read the requested chain env file')
    expect(missing.stdout + missing.stderr).not.toContain('DO_NOT_PRINT_SECRET')
  })
})

describe('Vercel production env sync guardrails', () => {
  it('accepts a static deployment without backend or analytics credentials', () => {
    const envFile = writeEnvFile({ NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_PUBLIC_POSTHOG_HOST: '' })

    const result = runSync(envFile)

    expect(result.status, result.stderr).toBe(0)
  })

  it('includes public static configuration and optional frontend PostHog env in dry-run output', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_POSTHOG_SESSION_REPLAY: 'true',
    })

    const result = runSync(envFile)

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('- NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER')
    expect(result.stdout).toContain('- NEXT_PUBLIC_SOULIDITY_PROFILE_WRITES_ENABLED')
    expect(result.stdout).toContain('- NEXT_PUBLIC_POSTHOG_KEY')
    expect(result.stdout).toContain('- NEXT_PUBLIC_POSTHOG_HOST')
    expect(result.stdout).toContain('- NEXT_PUBLIC_POSTHOG_SESSION_REPLAY')
  })

  it('does not require PostHog session replay env to sync production env', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
    })

    const result = runSync(envFile)

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('NEXT_PUBLIC_POSTHOG_SESSION_REPLAY')
  })

  it('syncs complete native routing and rejects the ambiguous alias or noncanonical IDs', () => {
    const base = { ...productionSupportEnv }
    const routed = runSync(writeEnvFile(base))
    expect(routed.status, routed.stderr).toBe(0)
    for (const key of ['NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
      'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID', 'NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON']) {
      expect(routed.stdout).toContain('- ' + key)
    }
    const legacy = runSync(writeEnvFile({ ...base, NEXT_PUBLIC_SOULIDITY_PACKAGE_ID: '0x111' }))
    expect(legacy.status).toBe(1)
    expect(legacy.stderr).toContain('Refusing to sync forbidden production env keys')
    const zero = runSync(writeEnvFile({ ...base, NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: '0x0' }))
    expect(zero.status).toBe(1)
    expect(zero.stderr).toContain('must be a canonical non-zero Sui ID')
  })

  it('rejects retired issuance and history keys instead of preserving a second release route', () => {
    for (const key of ['NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES', 'NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED',
      'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID']) {
      const result = runSync(writeEnvFile({ ...productionSupportEnv, [key]: 'false' }))
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('forbidden production env keys')
    }
  })

  it('works without any deployment history file or compatibility route', () => {
    const result = runSync(writeEnvFile({ ...productionSupportEnv }))
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Dry run only')
    expect(result.stdout).toContain('not chain publication')
  })

  it('requires a usable public Seal server list that meets the threshold', () => {
    const empty = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: '[]',
    }))
    expect(empty.status).toBe(1)
    expect(empty.stderr).toContain(
      'NEXT_PUBLIC_SEAL_SERVER_CONFIGS must contain at least one usable mainnet key server',
    )

    const belowThreshold = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_SEAL_THRESHOLD: '2',
    }))
    expect(belowThreshold.status).toBe(1)
    expect(belowThreshold.stderr).toContain('has weight below threshold')

    const serverOnly = runSync(writeEnvFile({
      ...productionSupportEnv,
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
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId: `0x${'9'.repeat(64)}`,
        weight: 255,
      }]),
    }))
    expect(tooManyShares.status).toBe(1)
    expect(tooManyShares.stderr).toContain('total weight must be less than 255')

    const weightedThreshold = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_SEAL_THRESHOLD: '2',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId: `0x${'9'.repeat(64)}`,
        weight: 2,
      }]),
    }))
    expect(weightedThreshold.status).toBe(0)
  })

  it('rejects all server-only Seal overrides and public credential leakage', () => {
    const objectId = `0x${'0'.repeat(63)}9`
    const normalizedObjectId = `0x${'0'.repeat(63)}9`
    const inheritedWeight = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_SEAL_THRESHOLD: '2',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId, weight: 2 }]),
      SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId: normalizedObjectId,
        aggregatorUrl: 'https://seal.example.com',
        apiKeyName: 'x-seal-key',
        apiKey: 'secret',
      }]),
    }))
    expect(inheritedWeight.status).toBe(1)
    expect(inheritedWeight.stderr).toContain('forbidden production env keys: SEAL_SERVER_CONFIGS')

    const mismatchedWeight = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_SEAL_THRESHOLD: '2',
      NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId, weight: 2 }]),
      SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId: normalizedObjectId, weight: 1 }]),
    }))
    expect(mismatchedWeight.status).toBe(1)
    expect(mismatchedWeight.stderr).toContain('forbidden production env keys: SEAL_SERVER_CONFIGS')

    const unknownServer = runSync(writeEnvFile({
      ...productionSupportEnv,
      SEAL_SERVER_CONFIGS: JSON.stringify([{
        objectId: `0x${'8'.repeat(64)}`,
        weight: 1,
      }]),
    }))
    expect(unknownServer.status).toBe(1)
    expect(unknownServer.stderr).toContain('forbidden production env keys: SEAL_SERVER_CONFIGS')

    const incompleteCredentials = runSync(writeEnvFile({
      ...productionSupportEnv,
      SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId, apiKeyName: 'x-seal-key' }]),
    }))
    expect(incompleteCredentials.status).toBe(1)
    expect(incompleteCredentials.stderr).toContain('forbidden production env keys: SEAL_SERVER_CONFIGS')

    const exposedPublicSecret = runSync(writeEnvFile({
      ...productionSupportEnv,
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

  it('accepts browser Walrus configuration with no owned uploader or token requirement', () => {
    const result = runSync(writeEnvFile({
      ...productionSupportEnv,
      NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL: 'https://upload-relay.mainnet.walrus.space',
      NEXT_PUBLIC_WALRUS_AGGREGATOR_URL: 'https://aggregator.walrus.mirai.cloud',
      NEXT_PUBLIC_WALRUS_WASM_URL: '/walrus/current.wasm',
    }))
    expect(result.status, result.stderr).toBe(0)
    for (const key of ['NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL', 'NEXT_PUBLIC_WALRUS_AGGREGATOR_URL',
      'NEXT_PUBLIC_WALRUS_WASM_URL']) {
      expect(result.stdout).toContain('- ' + key)
    }
    expect(result.stdout).toContain('- remove WALRUS_UPLOADER_TOKEN_SECRET')
    expect(result.stdout).not.toContain('https://upload-relay.mainnet.walrus.space')
  })

  it.each([
    'NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT', 'NEXT_PUBLIC_WALRUS_UPLOADER_URL',
    'NEXT_PUBLIC_WALRUS_MANAGED_COMPLETE_CONCURRENCY', 'WALRUS_UPLOADER_TOKEN_SECRET',
    'WALRUS_UPLOADER_TOKEN_TTL_MS', 'WALRUS_UPLOADER_TOKEN_MAX_FILES', 'WALRUS_UPLOADER_TOKEN_MAX_BYTES',
  ])('rejects retired upload key %s before any environment write without printing its value', key => {
    const { result, calls } = runApplyWithFakeVercel(writeEnvFile({
      ...productionSupportEnv, [key]: 'RETIRED_PRIVATE_SENTINEL',
    }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('forbidden production env keys')
    expect(result.stderr).toContain(key)
    expect(result.stderr + result.stdout).not.toContain('RETIRED_PRIVATE_SENTINEL')
    expect(calls).toHaveLength(0)
  })

  it.each(['managed', 'browser', 'server'])('does not retain the retired transport selector even for %s', transport => {
    const result = runSync(writeEnvFile({ ...productionSupportEnv, NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT: transport }))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('forbidden production env keys')
  })

  it('writes only public keys with explicit no-sensitive flags', () => {
    const envFile = writeEnvFile({
      ...productionSupportEnv,
    })
    const { result, calls } = runApplyWithFakeVercel(envFile)
    expect(result.status, result.stderr).toBe(0)

    const publicCall = calls.find((args) =>
      args.slice(0, 4).join(' ') === 'vercel env add NEXT_PUBLIC_SUI_NETWORK')
    for (const call of calls) expect(call[call.indexOf('--project') + 1]).toBe(PROJECT)
    expect(publicCall).toContain('--no-sensitive')
    expect(publicCall).not.toContain('--sensitive')

    expect(calls.length).toBeGreaterThan(17)
    for (const call of calls) {
      expect(call[3]).toMatch(/^NEXT_PUBLIC_/)
      expect(call).toContain('--no-sensitive')
      expect(call).not.toContain('--sensitive')
    }
  })
})
