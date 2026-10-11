import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toBase58 } from '@mysten/sui/utils'

const io = vi.hoisted(() => ({ spawn: vi.fn(), read: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawnSync: io.spawn }))
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), readFileSync: io.read }))
import { assertNativeProductionTarget, assertProductionEnv, parseCliOptions, PRODUCTION_ENV_ALLOWLIST,
  PRODUCTION_VERCEL_PROJECT_ID, runProductionEnvSync } from '../../scripts/sync-vercel-production-env'
import { readNativeReceiveTarget } from '../../web/lib/animacraft/native-receive'
import { completeReadAggregatorUrls } from '../../web/lib/animacraft/native-protected-read-authority'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(19))
function fixture() {
  const target = {
    protocolConfigId: id(1), coreOriginalPackageId: id(2), outputOriginalPackageId: id(3),
    outputCallablePackageId: id(4), soulidityOriginalPackageId: id(5), soulidityCallablePackageId: id(6),
    outputCallableDigest: digest, soulidityCallableDigest: digest,
    runtime: { originalPackageId: id(7), callablePackageId: id(8), callableDigest: digest },
    release: { originalPackageId: id(9), callablePackageId: id(10), callableDigest: digest },
    equipmentMarket: { originalPackageId: id(18), callablePackageId: id(19), callableDigest: digest, replacementId: id(20) },
    expectedNativeBinding: {
      soulOriginalType: `${id(5)}::soul::Soul`, soulDefiningType: `${id(5)}::soul::Soul`,
      mintWitnessOriginalType: `${id(5)}::animacraft_v8_binding::MintBindingWitnessV8`,
      mintWitnessDefiningType: `${id(5)}::animacraft_v8_binding::MintBindingWitnessV8`,
      ownerWitnessOriginalType: `${id(5)}::animacraft_v8_binding::SoulOwnerWitnessV8`,
      ownerWitnessDefiningType: `${id(5)}::animacraft_v8_binding::SoulOwnerWitnessV8`,
    }, equipmentWritesEnabled: false, marketWritesEnabled: false,
  }
  const env: Record<string, string> = {
    NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_KIOSK_PACKAGE_ID: id(11),
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: id(6), NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: id(5),
    NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID: id(5), NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: id(12),
    NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID: id(13), NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID: id(14),
    NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID: id(15), NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID: id(16),
    NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(target),
    NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID: id(31), NEXT_PUBLIC_SOULIDITY_SOCIAL_REGISTRY_ID: id(32),
    NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID: id(33), NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID: id(34),
    NEXT_PUBLIC_WALRUS_BLOB_TYPE: '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77::blob::Blob',
    NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER: '35834a8a', NEXT_PUBLIC_WALRUS_AGGREGATOR_URL: 'https://aggregator.example',
    NEXT_PUBLIC_SOULIDITY_PROFILE_WRITES_ENABLED: 'false', NEXT_PUBLIC_SOULIDITY_SOCIAL_WRITES_ENABLED: 'false',
    NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED: 'false', NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTES_WRITES_ENABLED: 'false',
    NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
    NEXT_PUBLIC_POSTHOG_KEY: 'phc_PUBLIC_VALUE',
    NEXT_PUBLIC_SEAL_SERVER_CONFIGS: JSON.stringify([{ objectId: id(17), weight: 1 }]), NEXT_PUBLIC_SEAL_THRESHOLD: '1',
  }
  return { env, target }
}
const args = ['--project', 'prj_TkRy8sVX44TBPB71sDfN03vF1A7S', '--env-file', '/synthetic/env']
function source(env: Record<string, string>) { return Buffer.from(Object.entries(env).map(([k, v]) => `${k}='${v}'`).join('\n')) }
beforeEach(() => { vi.restoreAllMocks(); io.spawn.mockReset(); io.read.mockReset(); io.spawn.mockReturnValue({ status: 0 }) })

describe('fresh native production configuration (local, not chain acceptance)', () => {
  it('accepts a static deployment without business backend credentials', () => {
    const { env } = fixture()
    for (const key of Object.keys(env)) if (!key.startsWith('NEXT_PUBLIC_')) delete env[key]
    expect(() => assertProductionEnv(env)).not.toThrow()
    expect(PRODUCTION_ENV_ALLOWLIST.every(key => key.startsWith('NEXT_PUBLIC_'))).toBe(true)
  })
  it.each(['SEAL_SERVER_CONFIGS', 'WALRUS_AGGREGATOR_URL', 'DATABASE_URL', 'DIRECT_URL',
    'AUTH_SECRET', 'ADMIN_EMAILS', 'ADMIN_WALLET_ADDRESSES', 'TG_BOT_TOKEN', 'TG_CHANNEL_ID',
    'TG_GROUP_ID', 'TG_BOT_USERNAME', 'X_DATABASE_URL', 'DEFAULT_PROVIDER', 'DEEPSEEK_API_KEY',
    'DEEPSEEK_MODEL', 'DEEPSEEK_BASE_URL', 'APP_DOMAIN', 'SOULIDITY_WEB_URL', 'TRUST_PROXY_HEADERS',
    'DESKTOP_MANIFEST_URL', 'POSTHOG_API_KEY', 'POSTHOG_SERVER_KEY', 'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'])('rejects retired backend %s before writes without leaking its value', key => {
    const { env } = fixture(); env[key] = 'PRIVATE_SENTINEL_DO_NOT_PRINT'
    io.read.mockReturnValue(source(env))
    let message = ''; try { runProductionEnvSync([...args, '--apply']) } catch (error) { message = (error as Error).message }
    expect(message).toContain(`forbidden production env keys: ${key}`)
    expect(message).not.toContain(env[key])
    expect(PRODUCTION_ENV_ALLOWLIST).not.toContain(key)
    expect(io.spawn).not.toHaveBeenCalled()
  })
  it.each(['NEXT_PUBLIC_SOULIDITY_PROFILE_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_SOCIAL_REGISTRY_ID',
    'NEXT_PUBLIC_SOULIDITY_COMMUNITY_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTE_REGISTRY_ID'])('requires canonical new registry %s', key => {
    for (const value of ['', '0x1', id(0), id(44).toUpperCase(), `${id(44)} `]) {
      const { env } = fixture(); env[key] = value
      expect(() => assertProductionEnv(env)).toThrow(key)
    }
  })
  it.each(['', `${id(31)}::blob::Blob`, `${id(31)}::blob::Wrong`])('rejects wrong Walrus original type %s', value => {
    const { env } = fixture(); env.NEXT_PUBLIC_WALRUS_BLOB_TYPE = value
    expect(() => assertProductionEnv(env)).toThrow('NEXT_PUBLIC_WALRUS_BLOB_TYPE')
  })
  it.each(['NEXT_PUBLIC_SOULIDITY_PROFILE_WRITES_ENABLED', 'NEXT_PUBLIC_SOULIDITY_SOCIAL_WRITES_ENABLED',
    'NEXT_PUBLIC_SOULIDITY_COMMUNITY_WRITES_ENABLED', 'NEXT_PUBLIC_SOULIDITY_COMMUNITY_VOTES_WRITES_ENABLED'])('validates explicit %s without choosing or changing its value', key => {
    const { env } = fixture()
    for (const value of ['true', 'false']) {
      env[key] = value; const before = { ...env }
      expect(() => assertProductionEnv(env)).not.toThrow(); expect(env).toEqual(before)
    }
    for (const value of ['', '1', 'TRUE', ' false ']) {
      env[key] = value; expect(() => assertProductionEnv(env)).toThrow(key)
    }
  })
  it('retains actual static integrations, not private metadata or build-injected WASM version', () => {
    for (const key of ['NEXT_PUBLIC_DESKTOP_MANIFEST_URL', 'NEXT_PUBLIC_SUI_GRAPHQL_URL',
      'NEXT_PUBLIC_ANIMACRAFT_ORIGIN', 'NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL']) expect(PRODUCTION_ENV_ALLOWLIST).toContain(key)
    for (const key of ['VERCEL_ENV', 'CLAWNEWS_LOAD_ENV_LOCAL', 'NEXT_PUBLIC_WALRUS_WASM_VERSION',
      'NEXT_PUBLIC_E2E_TEST_MODE']) expect(PRODUCTION_ENV_ALLOWLIST).not.toContain(key)
  })
  it.each(['NEXT_PUBLIC_WALRUS_AGGREGATOR_URL', 'NEXT_PUBLIC_WALRUS_UPLOAD_RELAY_URL',
    'NEXT_PUBLIC_SUI_GRAPHQL_URL', 'NEXT_PUBLIC_POSTHOG_HOST'])('rejects backend-relative or credential-bearing %s', key => {
    for (const value of ['/ingest', 'http://service.example', 'https://PRIVATE_SENTINEL@service.example', 'https://service.example?token=PRIVATE_SENTINEL']) {
      const { env } = fixture(); env[key] = value
      let message = ''; try { assertProductionEnv(env) } catch (error) { message = (error as Error).message }
      expect(message).toContain(key); expect(message).not.toContain('PRIVATE_SENTINEL')
    }
  })
  it('accepts the complete current tuple without historical routes or V5/V6 flags and does not enable writes', () => {
    const { env } = fixture(), before = structuredClone(env)
    expect(() => assertProductionEnv(env)).not.toThrow()
    expect(() => readNativeReceiveTarget(env)).not.toThrow()
    expect(() => completeReadAggregatorUrls(env)).not.toThrow()
    expect(env).toEqual(before)
    expect(io.spawn).not.toHaveBeenCalled()
  })
  it.each(['runtime', 'release', 'equipmentMarket', 'expectedNativeBinding', 'outputCallableDigest', 'protocolConfigId'])('requires native %s', key => {
    const { env, target } = fixture(); delete (target as any)[key]
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertProductionEnv(env)).toThrow('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON')
  })
  it.each(['NEXT_PUBLIC_KIOSK_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',
    'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID', 'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID',
    'NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', 'NEXT_PUBLIC_SOULIDITY_SOUL_TRANSFER_POLICY_ID',
    'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID', 'NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE',
    'NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', 'NEXT_PUBLIC_SUI_CHAIN_IDENTIFIER', 'NEXT_PUBLIC_WALRUS_AGGREGATOR_URL'])('requires explicit %s, never SDK fallback', key => {
    const { env } = fixture(); delete env[key]
    expect(() => assertProductionEnv(env)).toThrow(key)
    expect(PRODUCTION_ENV_ALLOWLIST).toContain(key)
  })
  it.each(['NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID'])('rejects %s differing from native tuple', key => {
    const { env } = fixture(); env[key] = id(99)
    expect(() => assertProductionEnv(env)).toThrow('explicit SDK release configuration')
  })
  it.each(['0x1', id(0), id(26).toUpperCase(), 'not-an-id', `${id(2)} `])('rejects noncanonical native ID %s', value => {
    const { env, target } = fixture(); target.protocolConfigId = value
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertProductionEnv(env)).toThrow('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON')
  })
  it.each(['soulOriginalType', 'soulDefiningType', 'mintWitnessOriginalType', 'mintWitnessDefiningType',
    'ownerWitnessOriginalType', 'ownerWitnessDefiningType'])('rejects wrong native type %s', key => {
    const { env, target } = fixture(); (target.expectedNativeBinding as any)[key] = `${id(5)}::soul::Wrong`
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertNativeProductionTarget(env)).toThrow('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON')
  })
  it.each(['output', 'soulidity', 'runtime', 'release', 'equipmentMarket'])('rejects malformed %s digest', key => {
    const { env, target } = fixture()
    if (key === 'runtime' || key === 'release' || key === 'equipmentMarket') target[key].callableDigest = toBase58(new Uint8Array(31))
    else (target as any)[`${key}CallableDigest`] = 'SECRET_BAD_DIGEST'
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertProductionEnv(env)).toThrow('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON')
  })
  it.each(['top', 'runtime', 'release', 'equipmentMarket', 'expectedNativeBinding'])('rejects unexpected %s fields', key => {
    const { env, target } = fixture(); (key === 'top' ? target : (target as any)[key]).unapproved = 'SECRET'
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertProductionEnv(env)).toThrow('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON')
  })
  it('rejects duplicate package roles and split mint/owner defining origins', () => {
    const { env, target } = fixture()
    target.release.originalPackageId = target.runtime.originalPackageId
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertProductionEnv(env)).toThrow()
    target.release.originalPackageId = id(9)
    target.expectedNativeBinding.ownerWitnessDefiningType = `${id(66)}::animacraft_v8_binding::SoulOwnerWitnessV8`
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertProductionEnv(env)).toThrow()
  })
  it.each(['originalPackageId', 'callablePackageId', 'callableDigest', 'replacementId'])('requires equipment market %s', key => {
    const { env, target } = fixture(); delete (target.equipmentMarket as any)[key]
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertNativeProductionTarget(env)).toThrow()
  })
  it.each(['originalPackageId', 'callablePackageId', 'replacementId'] as const)('rejects noncanonical equipment market %s', key => {
    for (const value of ['0x1', id(0), id(26).toUpperCase(), 'not-an-id', `${id(2)} `]) {
      const { env, target } = fixture(); target.equipmentMarket[key] = value
      env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
      expect(() => assertNativeProductionTarget(env)).toThrow()
    }
  })
  it('rejects cross-role original/callable aliases in either direction', () => {
    for (const key of ['originalPackageId', 'callablePackageId'] as const) {
      for (const alias of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const { env, target } = fixture(); target.equipmentMarket[key] = id(alias)
        env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
        expect(() => assertNativeProductionTarget(env)).toThrow()
      }
    }
    const { env, target } = fixture(); target.release.originalPackageId = target.runtime.callablePackageId
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertNativeProductionTarget(env)).toThrow()
  })
  it('rejects replacement aliases with every package identity and protocol config', () => {
    for (const alias of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 18, 19]) {
      const { env, target } = fixture(); target.equipmentMarket.replacementId = id(alias)
      env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
      expect(() => assertNativeProductionTarget(env)).toThrow()
    }
  })
  it('accepts fresh original/callable identity within each role', () => {
    const { env, target } = fixture()
    target.outputCallablePackageId = target.outputOriginalPackageId
    for (const key of ['runtime', 'release', 'equipmentMarket'] as const) target[key].callablePackageId = target[key].originalPackageId
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertNativeProductionTarget(env)).not.toThrow()
  })
  it.each([true, false, undefined])('preserves an explicitly supplied switch %s without policy inference', flag => {
    const { env, target } = fixture(); (target as any).marketWritesEnabled = flag
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    const before = env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON
    expect(() => assertProductionEnv(env)).not.toThrow(); expect(env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON).toBe(before)
  })
  it.each(['equipmentWritesEnabled', 'marketWritesEnabled'])('rejects string switch %s', key => {
    const { env, target } = fixture(); (target as any)[key] = 'false'
    env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON = JSON.stringify(target)
    expect(() => assertProductionEnv(env)).toThrow()
  })
  it.each(['NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID',
    'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_PACKAGE_ID', 'NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES',
    'NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED', 'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED',
    'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PACKAGE_ID', 'MAINNET_DEPLOYER_PRIV_KEY', 'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID'])('rejects retired/forbidden %s even when disabled', key => {
    const { env } = fixture(); env[key] = 'false'
    expect(() => assertProductionEnv(env)).toThrow('forbidden production env keys')
    expect(PRODUCTION_ENV_ALLOWLIST).not.toContain(key)
  })
  it.each(['testnet', 'devnet', ' mainnet '])('rejects %s', network => {
    const { env } = fixture(); env.NEXT_PUBLIC_SUI_NETWORK = network
    expect(() => assertProductionEnv(env)).toThrow('mainnet')
  })
  it('rejects any alternate payment type', () => {
    const { env } = fixture(); env.NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE = '0x2::sui::SUI'
    expect(() => assertProductionEnv(env)).toThrow('native mainnet USDC')
  })
  it.each([
    { apiKey: 123 }, { apiKeyName: '' }, { secret: 'SECRET_NESTED_VALUE' },
    { aggregatorUrl: 'https://key.example/api?token=SECRET_QUERY_VALUE' },
    { aggregatorUrl: 'https://SECRET_USER:SECRET_PASSWORD@key.example' },
    { aggregatorUrl: 'https://key.example/#SECRET_FRAGMENT_VALUE' },
  ])('rejects public Seal credential-shaped or unsupported configuration without exposing it', extra => {
    const { env } = fixture()
    env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify([{ objectId: id(17), weight: 1, ...extra }])
    let message = ''; try { assertProductionEnv(env) } catch (error) { message = (error as Error).message }
    expect(message).toContain('NEXT_PUBLIC_SEAL_SERVER_CONFIGS is invalid')
    expect(message).not.toContain('SECRET_')
  })
  it('retains origin validation without old issuer configuration', () => {
    const { env } = fixture(); env.NEXT_PUBLIC_ANIMACRAFT_APP_URL = 'https://animacraft.soulidity.ai'
    expect(() => assertProductionEnv(env)).not.toThrow()
    env.NEXT_PUBLIC_ANIMACRAFT_APP_URL = 'https://SECRET_USER:SECRET_PASSWORD@animacraft.soulidity.ai/path'
    expect(() => assertProductionEnv(env)).toThrow('HTTPS origin')
  })
  it.each([
    [{ objectId: '0x9', weight: 1 }],
    [{ objectId: id(26).toUpperCase(), weight: 1 }],
    Array.from({ length: 65 }, (_, n) => ({ objectId: id(n + 1), weight: 1 })),
    [{ objectId: id(17), weight: 1, aggregatorUrl: null }],
    [{ objectId: id(17), weight: 1, aggregatorUrl: 'https://localhost/' }],
    [{ objectId: id(17), weight: 1, aggregatorUrl: 'https://127.0.0.1/' }],
    [{ objectId: id(17), weight: 1, aggregatorUrl: 'https://[::1]/' }],
  ])('rejects the same malformed public service evidence as the actual native reader', rows => {
    const { env } = fixture(); env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify(rows)
    expect(() => assertProductionEnv(env)).toThrow('NEXT_PUBLIC_SEAL_SERVER_CONFIGS is invalid')
    expect(() => completeReadAggregatorUrls(env)).toThrow('Explicit public Seal services are invalid')
  })
  it('accepts a credential-free public path and all 64 explicit services in both parsers', () => {
    const { env } = fixture()
    env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS = JSON.stringify(Array.from({ length: 64 }, (_, n) => ({
      objectId: id(n + 1), weight: 1, aggregatorUrl: `https://seal${n}.example.com/service`,
    })))
    expect(() => assertProductionEnv(env)).not.toThrow(); expect(completeReadAggregatorUrls(env).size).toBe(64)
  })
})

describe('explicit production target and secret-safe process boundary', () => {
  it.each([[], ['--project', 'clawnews'], ['--project', 'prj_wrong'], ['--project'],
    [...args, '--project', PRODUCTION_VERCEL_PROJECT_ID], [...args, '--apply', '--dry-run'],
    [...args, '--deployment-history-file', '/old.json']])('rejects ambiguous CLI input %j', input => {
    expect(() => parseCliOptions(input)).toThrow(); expect(io.spawn).not.toHaveBeenCalled()
  })
  it('default and explicit dry-run validate locally with zero spawned commands and print only keys', () => {
    const { env } = fixture(); io.read.mockReturnValue(source(env)); const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    runProductionEnvSync(args); runProductionEnvSync([...args, '--dry-run'])
    expect(io.spawn).not.toHaveBeenCalled()
    const text = log.mock.calls.flat().join('\n')
    expect(text).toContain(PRODUCTION_VERCEL_PROJECT_ID); expect(text).toContain('not chain publication')
    expect(text).toContain('remove NEXT_PUBLIC_SOULIDITY_SEAL_PACKAGE_ROUTES')
    expect(text).toContain('remove NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')
    expect(text).toContain('not inspected or deleted')
    for (const value of [env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON, env.NEXT_PUBLIC_POSTHOG_KEY]) expect(text).not.toContain(value)
  })
  it('mocked apply pins every command to the exact project and sends values only through stdin', () => {
    const { env } = fixture(); io.read.mockReturnValue(source(env)); const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    io.spawn.mockReturnValue({ status: 0, stdout: 'SECRET_TOOL_OUTPUT', stderr: 'SECRET_TOOL_OUTPUT' })
    runProductionEnvSync([...args, '--apply'])
    expect(io.spawn).toHaveBeenCalled()
    for (const [command, commandArgs, options] of io.spawn.mock.calls) {
      expect(command).toBe('npx'); expect(commandArgs.slice(0, 3)).toEqual(['vercel', 'env', 'add'])
      expect(commandArgs[commandArgs.indexOf('--project') + 1]).toBe(PRODUCTION_VERCEL_PROJECT_ID)
      const key = commandArgs[3]; expect(options.input).toBe(env[key]); expect(commandArgs).not.toContain(env[key])
      expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']); expect(options.timeout).toBe(25_000)
      expect(commandArgs).toContain(key.startsWith('NEXT_PUBLIC_') ? '--no-sensitive' : '--sensitive')
    }
    expect(log.mock.calls.flat().join('\n')).not.toContain('SECRET_TOOL_OUTPUT')
  })
  it('stops on uncertain CLI failure without printing tool output or later writes', () => {
    io.read.mockReturnValue(source(fixture().env)); vi.spyOn(console, 'log').mockImplementation(() => {})
    io.spawn.mockReturnValue({ status: null, error: new Error('SECRET_TOOL_OUTPUT'), stderr: 'SECRET_TOOL_OUTPUT' })
    expect(() => runProductionEnvSync([...args, '--apply'])).toThrow('exit code unknown')
    expect(io.spawn).toHaveBeenCalledTimes(1)
  })
  it.each(['NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', 'NEXT_PUBLIC_SEAL_SERVER_CONFIGS', 'SEAL_SERVER_CONFIGS'])('does not echo invalid JSON in %s', key => {
    const { env } = fixture(); env[key] = '{"SECRET_JSON_VALUE"'
    let message = ''; try { assertProductionEnv(env) } catch (error) { message = (error as Error).message }
    expect(message).toContain(key); expect(message).not.toContain('SECRET_JSON_VALUE')
  })
  it('does not echo the failed env file path or filesystem exception', () => {
    io.read.mockImplementation(() => { throw new Error('SECRET_FS_VALUE') })
    expect(() => runProductionEnvSync(args)).toThrow('Unable to read the requested env file')
    expect(io.spawn).not.toHaveBeenCalled()
  })
  it('never starts mocked apply when validation fails', () => {
    const { env } = fixture(); delete env.NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON
    io.read.mockReturnValue(source(env))
    expect(() => runProductionEnvSync([...args, '--apply'])).toThrow('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON')
    expect(io.spawn).not.toHaveBeenCalled()
  })
})
