import { describe, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toBase58 } from '@mysten/sui/utils'

const io = vi.hoisted(() => ({ dotenv: vi.fn(), load: vi.fn(), spawn: vi.fn() }))
vi.mock('../../scripts/lib/dotenv', () => {
  io.dotenv()
  return { loadEnvFile: io.load }
})
vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawnSync: io.spawn }))
import { runMainnetE2eEnvGate, validateMainnetE2eEnv } from '../../scripts/e2e-check-env'
import { assertProductionChainEnv, assertProductionEnv, PRODUCTION_CHAIN_ENV_KEYS } from '../../scripts/sync-vercel-production-env'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(19))
const roleKeys = ['MAINNET_DEPLOYER_PRIV_KEY', 'E2E_SELLER_PRIVATE_KEY', 'E2E_BUYER_PRIVATE_KEY',
  'E2E_AGENT_ALPHA_PRIVATE_KEY', 'E2E_AGENT_BETA_PRIVATE_KEY', 'E2E_DEV_PRIVATE_KEY']
const retired = ['NEXT_PUBLIC_SOULIDITY_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_ID',
  'NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_PACKAGE_ID',
  'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID', 'NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES',
  'NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED', 'NEXT_PUBLIC_ANIMACRAFT_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_FEE_CONFIG_ID', 'NEXT_PUBLIC_ANIMACRAFT_PROTOCOL_TREASURY_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED', 'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PACKAGE_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_TYPE_ORIGIN_PACKAGE_ID', 'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID',
  'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_TREASURY_ID']
function fixture() {
  const target = {
    protocolConfigId: id(1), coreOriginalPackageId: id(2), outputOriginalPackageId: id(3), outputCallablePackageId: id(4),
    soulidityOriginalPackageId: id(5), soulidityCallablePackageId: id(6), outputCallableDigest: digest, soulidityCallableDigest: digest,
    runtime: { originalPackageId: id(7), callablePackageId: id(8), callableDigest: digest },
    release: { originalPackageId: id(9), callablePackageId: id(10), callableDigest: digest },
    equipmentMarket: { originalPackageId: id(23), callablePackageId: id(24), callableDigest: digest, replacementId: id(25) },
    expectedNativeBinding: Object.fromEntries([
      ['soul', 'soul::Soul'], ['mintWitness', 'animacraft_v8_binding::MintBindingWitnessV8'],
      ['ownerWitness', 'animacraft_v8_binding::SoulOwnerWitnessV8'],
    ].flatMap(([key, suffix]) => ['Original', 'Defining'].map(kind => [`${key}${kind}Type`, `${id(5)}::${suffix}`]))),
    equipmentWritesEnabled: true, marketWritesEnabled: true,
  }
  const env: Record<string, string> = {
    NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_KIOSK_PACKAGE_ID: id(11), NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: id(6),
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: id(5), NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: id(5),
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: id(12), NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID: id(13),
    NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID: id(14), NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: id(15),
    NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID: id(16),
    NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(target),
    AUTH_SECRET: 'SYNTHETIC_SECRET_DO_NOT_LOG'.repeat(2), DATABASE_URL: 'postgres://user:SYNTHETIC_SECRET_DO_NOT_LOG@db.example/db',
    DIRECT_URL: 'postgres://user:SYNTHETIC_SECRET_DO_NOT_LOG@direct.example/db',
    E2E_AGENT_ALPHA_API_KEY: 'SYNTHETIC_SECRET_DO_NOT_LOG', E2E_AGENT_BETA_API_KEY: 'SYNTHETIC_SECRET_DO_NOT_LOG',
    NEXT_PUBLIC_E2E_TEST_MODE: '1', MAINNET_WAL_COIN_TYPE: `${id(21)}::wal::WAL`,
    NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId: id(22), weight: 2 }]), NEXT_PUBLIC_SEAL_THRESHOLD: '2',
    NEXT_PUBLIC_ANIMACRAFT_APP_URL: 'https://animacraft.soulidity.ai', NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL: 'https://relay.example/v1',
  }
  roleKeys.forEach((key, index) => { env[key] = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(index + 1)).getSecretKey() })
  return { env, target }
}
const errors = (env: Record<string, string>) => JSON.stringify(validateMainnetE2eEnv(env).failures)

describe('current native local E2E preflight', () => {
  it('imports without loading env or executing any process', () => {
    expect(io.dotenv).not.toHaveBeenCalled(); expect(io.load).not.toHaveBeenCalled(); expect(io.spawn).not.toHaveBeenCalled()
  })
  it('accepts the paired native tuple without historical manifest or issuer gates; never enables writes', () => {
    const { env } = fixture(), before = structuredClone(env)
    const result = validateMainnetE2eEnv(env)
    expect(result.failures).toEqual([]); expect(result.ok).toBe(true)
    expect(new Set(result.addresses.map(row => row.address)).size).toBe(6)
    expect(env).toEqual(before)
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET_DO_NOT_LOG')
    for (const key of roleKeys) expect(JSON.stringify(result)).not.toContain(env[key])
    expect(io.spawn).not.toHaveBeenCalled()
  })
  it.each(PRODUCTION_CHAIN_ENV_KEYS)('rejects omitted %s through the same production validator', key => {
    const { env } = fixture(); delete env[key]
    expect(errors(env)).toContain(key); expect(() => assertProductionChainEnv(env)).toThrow(key)
  })
  it.each(PRODUCTION_CHAIN_ENV_KEYS)('rejects malformed %s without echoing its value', key => {
    const { env } = fixture(); env[key] = 'SYNTHETIC_SECRET_DO_NOT_LOG'
    expect(validateMainnetE2eEnv(env).ok).toBe(false)
    expect(errors(env)).toContain(key); expect(errors(env)).not.toContain(env[key])
  })
  it.each(retired)('rejects retired %s even when all native fields exist', key => {
    const { env } = fixture(); env[key] = 'SYNTHETIC_SECRET_DO_NOT_LOG'
    expect(errors(env)).toContain(key); expect(errors(env)).not.toContain(env[key])
  })
  it.each(['NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID'])('rejects a different %s', key => {
    const { env } = fixture(); env[key] = id(99)
    expect(errors(env)).toContain('differs from the explicit SDK release configuration')
  })
  it('rejects unknown native target fields and missing pin/type bindings', () => {
    const { env, target } = fixture()
    for (const key of ['runtime', 'release', 'expectedNativeBinding', 'outputCallableDigest']) {
      const changed: Record<string, unknown> = structuredClone(target); delete changed[key]
      env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(changed)
      expect(validateMainnetE2eEnv(env).ok).toBe(false)
    }
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify({ ...target, secret: 'SYNTHETIC_SECRET_DO_NOT_LOG' })
    expect(errors(env)).toContain('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON')
    expect(errors(env)).not.toContain('SYNTHETIC_SECRET_DO_NOT_LOG')
  })
  it.each(roleKeys)('requires a decodable local harness %s without echoing input', key => {
    const { env } = fixture(); delete env[key]; expect(errors(env)).toContain(key)
    env[key] = '<SYNTHETIC_SECRET_DO_NOT_LOG>'; expect(errors(env)).toContain('placeholder')
    env[key] = 'SYNTHETIC_SECRET_DO_NOT_LOG'; expect(errors(env)).toContain('cannot decode')
    expect(errors(env)).not.toContain(env[key])
  })
  it('rejects role/role and master/role collisions', () => {
    for (const source of ['MAINNET_DEPLOYER_PRIV_KEY', 'E2E_SELLER_PRIVATE_KEY']) {
      const { env } = fixture(); env.E2E_BUYER_PRIVATE_KEY = env[source]
      expect(errors(env)).toContain('address collides')
    }
  })
  it('still forbids a local harness master key from production sync', () => {
    const { env } = fixture()
    expect(() => assertProductionChainEnv(env)).not.toThrow()
    expect(() => assertProductionEnv(env)).toThrow('MAINNET_DEPLOYER_PRIV_KEY')
  })
  it.each(['equipmentWritesEnabled', 'marketWritesEnabled'])('does not treat closed or missing %s as executable full E2E', key => {
    for (const value of [false, undefined]) {
      const { env, target } = fixture()
      env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify({ ...target, [key]: value })
      const before = structuredClone(env)
      expect(() => assertProductionChainEnv(env)).not.toThrow()
      expect(validateMainnetE2eEnv(env).ok).toBe(false)
      expect(errors(env)).toContain(`${key} is disabled or absent`)
      expect(env).toEqual(before)
    }
  })
  it.each(['AUTH_SECRET', 'DATABASE_URL', 'DIRECT_URL', 'E2E_AGENT_ALPHA_API_KEY', 'E2E_AGENT_BETA_API_KEY',
    'MAINNET_WAL_COIN_TYPE', 'NEXT_PUBLIC_E2E_TEST_MODE', 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS',
    'NEXT_PUBLIC_SEAL_THRESHOLD', 'NEXT_PUBLIC_ANIMACRAFT_APP_URL', 'NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL'])('retains required %s', key => {
    const { env } = fixture(); delete env[key]
    expect(errors(env)).toContain(key); expect(validateMainnetE2eEnv(env).ok).toBe(false)
  })
  it.each(['AUTH_SECRET', 'DATABASE_URL', 'DIRECT_URL', 'E2E_AGENT_ALPHA_API_KEY', 'E2E_AGENT_BETA_API_KEY'])('rejects placeholder %s without printing it', key => {
    const { env } = fixture(); env[key] = '<SYNTHETIC_SECRET_DO_NOT_LOG>'
    expect(errors(env)).toContain('placeholder'); expect(errors(env)).not.toContain(env[key])
  })
  it.each(['http://relay.example', 'https:relay.example', 'https:/relay.example', 'https://relay.example/white space',
    'https://relay.example\\path', 'https://user:SECRET@relay.example', 'https://relay.example?token=SECRET'])('requires safe HTTPS relay %s', value => {
    const { env } = fixture(); env.NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL = value
    expect(errors(env)).toContain('must be an HTTPS URL'); expect(errors(env)).not.toContain('SECRET')
  })
  it.each(['http://app.example', 'https:app.example', 'https:/app.example', 'https://app.example/ignored/..',
    'https://app.example/path', 'https://user:SECRET@app.example', 'https://app.example/#SECRET'])('requires safe app origin %s', value => {
    const { env } = fixture(); env.NEXT_PUBLIC_ANIMACRAFT_APP_URL = value
    expect(errors(env)).toContain('must be an HTTPS origin'); expect(errors(env)).not.toContain('SECRET')
  })
  it.each(['https://seal.example', '{"secret":"SYNTHETIC_SECRET_DO_NOT_LOG"}', '[', '[]',
    JSON.stringify([{ objectId: id(22), weight: 2, apiKey: 'SYNTHETIC_SECRET_DO_NOT_LOG' }]),
    JSON.stringify([{ objectId: id(22), weight: 2 }, { objectId: id(22), weight: 2 }])])('rejects malformed/unsafe Seal list %#', raw => {
    const { env } = fixture(); env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = raw
    expect(errors(env)).toContain('Seal configuration'); expect(errors(env)).not.toContain('SYNTHETIC_SECRET_DO_NOT_LOG')
  })
  it.each(['0', '-1', '2.5', '3', '255', 'SYNTHETIC_SECRET_DO_NOT_LOG'])('rejects invalid/underfunded Seal threshold %s', threshold => {
    const { env } = fixture(); env.NEXT_PUBLIC_SEAL_THRESHOLD = threshold
    expect(errors(env)).toContain('Seal threshold'); expect(errors(env)).not.toContain('SYNTHETIC_SECRET_DO_NOT_LOG')
  })
  it('runs the actual CLI body with synthetic env only, returns failure/success codes and never prints values', async () => {
    const originalEnv = process.env, { env } = fixture()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      process.env = env
      expect(await runMainnetE2eEnvGate()).toBe(0)
      expect(io.load).toHaveBeenCalledWith('.env.e2e')
      delete env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON
      env.DATABASE_URL = '<SYNTHETIC_SECRET_DO_NOT_LOG>'
      expect(await runMainnetE2eEnvGate()).toBe(1)
      const output = JSON.stringify([log.mock.calls, error.mock.calls])
      expect(output).toContain('not release, real-wallet or product acceptance')
      expect(output).not.toContain('SYNTHETIC_SECRET_DO_NOT_LOG')
      for (const key of roleKeys) expect(output).not.toContain(env[key])
      expect(io.spawn).not.toHaveBeenCalled()
    } finally { process.env = originalEnv; log.mockRestore(); error.mockRestore() }
  })
})
