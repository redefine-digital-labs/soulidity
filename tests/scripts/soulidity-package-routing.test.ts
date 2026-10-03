import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(path, 'utf8')
}

function productionTransactionSources(): string {
  const files = execFileSync(
    'rg',
    [
      '--files',
      'packages/soulidity-sdk/src/tx',
      'web/app',
      'web/lib',
      '-g',
      '*.ts',
      '-g',
      '*.tsx',
      '-g',
      '!*.test.ts',
      '-g',
      '!*.test.tsx',
    ],
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  return files.map((path) => source(join(path))).join('\n')
}

describe('Soulidity operational script package routing', () => {
  it.each([
    ['web/lib/hooks/use-import.ts', 'IMPORTED'],
    ['web/lib/hooks/use-wrap-publish.ts', 'JOINED'],
    ['web/lib/hooks/use-collection-publish.ts', 'COLLECTION'],
  ])('%s delegates initial content to the shared durable authoring flow', (path, kind) => {
    const text = source(path)
    expect(text).toContain(`useSingleSoulAuthoring(approve, '${kind}')`)
    expect(text).not.toContain('buildContentSidecarsForVersionsWithSuiClient')
    expect(text).not.toContain('/api/')
  })

  it('keeps Living Content encryption/session identity separate from approval routing', () => {
    const actions = source('web/lib/hooks/use-soul-content-actions.ts')
    expect(actions).toContain('useSoulContentRead(soul,')
    expect(actions).toContain('useSoulContentAppend(soul,')
    expect(source('web/lib/hooks/use-soul-content-read.ts')).toContain('await openBrowserSoulContent(')
    expect(source('web/lib/hooks/use-soul-content-append.ts')).toContain('await prepareContentAppend(')
    for (const path of ['web/lib/soulidity/content-append-preparation.ts', 'web/lib/upload/walrus-batch-seal.ts']) {
      expect(source(path)).toContain('await encryptContentKeyEnvelope(')
    }
    const envelope = source('web/lib/soulidity/content-key-envelope.ts')
    expect(envelope).toContain('encrypt({ packageId: originalPackageId,')
    expect(envelope).not.toContain('callablePackageId')
    const open = source('web/lib/soulidity/browser-content-open.ts')
    expect(open).toContain('packageId: access.accessPolicy.sealPackageId')
    expect(open).toContain('`${p.callablePackageId}::${p.moduleName}::${p.functionName}`')
  })

  it('routes native Complete approval through the attested Release callable, not the retired Soulidity entry', () => {
    const builder = source('packages/soulidity-sdk/src/tx/animacraft-native-read-v8.ts')
    expect(builder).toContain('p.releaseCallablePackageId')
    expect(builder).toContain('::release_v8::seal_approve_complete_v8')
    expect(builder).not.toContain('::animacraft_output_seal::')
    expect(builder).not.toContain('getRequiredSoulidityEnv')
  })

  it('keeps paid-access dev-inspect calls and event mirroring on separate package roles', () => {
    const text = source('web/scripts/e2e-paid-access-lifecycle.ts')
    expect(text).toContain('packageId: env.callablePackageId')
    expect(text).toContain('packageId: env.originalPackageId')
    expect(text).not.toMatch(/process\.env\.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID\s*=/)
    expect(text).toContain('PACKAGE_ID is ambiguous after upgrades')
  })

  it('requires explicit callable/original routing for the relist workflow', () => {
    const text = source('web/scripts/e2e-relist-soul.ts')
    expect(text).toContain(
      'process.env.NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID = callablePackageId',
    )
    expect(text).toContain(
      'process.env.NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID = originalPackageId',
    )
    expect(text).toContain('extractSoulListedEvent(result, originalPackageId)')
    expect(text).toContain('packageId: originalPackageId')
  })

  it('does not let the Vercel sync utility deploy the ambiguous legacy alias', () => {
    const text = source('scripts/sync-vercel-production-env.ts')
    expect(text).toContain("'NEXT_PUBLIC_SOULIDITY_PACKAGE_ID',")
    expect(text).toContain("'NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID',")
    expect(text).toContain("'NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID',")
    expect(text).toContain("'NEXT_PUBLIC_SOULIDITY_ANIMACRAFT_PROVENANCE_PACKAGE_ID',")
    expect(text).toContain("'NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID',")
  })

  it('uses one explicit native chain validator for production and the local E2E harness', () => {
    const sync = source('scripts/sync-vercel-production-env.ts')
    const e2e = source('scripts/e2e-check-env.ts')
    for (const key of [
      'NEXT_PUBLIC_ANIMACRAFT_APP_URL',
      'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED',
      'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PACKAGE_ID',
      'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_TYPE_ORIGIN_PACKAGE_ID',
      'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_CONFIG_ID',
      'NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_PROTOCOL_TREASURY_ID',
    ]) {
      expect(sync).toContain(`'${key}',`)
    }
    expect(sync).toContain("url.protocol === 'https:'")
    expect(sync).toContain('value.replace(/\\/+$/, \'\') === url.origin')
    expect(sync).toContain("'NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON',")
    expect(sync).toContain('assertNativeProductionTarget(env)')
    expect(sync).toContain("'NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID',")
    expect(sync).toContain("'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID',")
    expect(sync).not.toContain('Commerce v5 requires NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED=true')
    expect(sync).toContain('function isNonZeroSuiId(value: string)')
    expect(sync).toContain('&& /[1-9a-fA-F]/.test(value.slice(2))')
    expect(sync).toContain('Refusing to sync forbidden production env keys')
    expect(sync).toContain('assertProductionChainEnv(env)')
    expect(e2e).toContain('assertProductionChainEnv(chainEnv)')
    expect(e2e).not.toContain('readManifestMainnet')
    expect(e2e).not.toContain('expected "true" for mainnet E2E')
    expect(e2e).not.toContain('NEXT_PUBLIC_ANIMACRAFT_COMMERCE_V5_ENABLED')
  })

  it('uses only the native Complete authorization and frozen Maker rights for Animacraft mint', () => {
    const market = source('move/soulidity/sources/market.move')
    const native = market.slice(market.indexOf('public fun mint_animacraft_v8_in_personal_kiosk<'),
      market.indexOf('public fun mint_native_in_personal_kiosk_v2('))
    expect(native.includes('authorization: SoulMintAuthorizationV8')).toBe(true)
    expect(native.includes('output_v8::bind_native_soul_v8(')).toBe(true)
    expect(native.includes('maker_v8::rights_soul_creator_royalty_bps_v2(&rights)')).toBe(true)
    expect(native.includes('soul::bind_animacraft_native_v8(')).toBe(true)
    expect(market.match(/public fun mint_animacraft_[A-Za-z0-9_]+/g)).toEqual([
      'public fun mint_animacraft_v8_in_personal_kiosk',
    ])
    expect(market.includes('CanonicalSoulMintAuthorization')).toBe(false)
    expect(market.includes('CommerceV5SoulMintAuthorization')).toBe(false)
  })

  it.each([
    'web/app/api/agent/souls/[id]/route.ts',
    'web/app/api/agent/souls/[id]/purchase/route.ts',
  ])('%s uses the fresh V2 defining-package type origin and native authority', (path) => {
    const text = source(path)
    const configRead = text.slice(
      text.indexOf('getMarketConfigV2('),
      text.indexOf('getMarketConfigV2(') + 300,
    )
    expect(configRead).toContain(
      "getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID')",
    )
    expect(text.includes('getMarketConfigV6')).toBe(false)
    expect(text.includes(path.includes('/purchase/') ? 'prepareNativeAgentPurchase({' : 'readNativeMarketSnapshot(')).toBe(true)
  })

  it('has no production transaction target that accepts the retired MarketConfig', () => {
    const marketMove = source('move/soulidity/sources/market.move')
    const legacyConfigFunctions = new Set(
      [...marketMove.matchAll(
        /public fun\s+([A-Za-z0-9_]+)(?:<[^{}]*>)?\s*\(([\s\S]*?)\)\s*(?::[^{]+)?\{/g,
      )]
        .filter((match) =>
          /\bconfig:\s*&(?:mut\s+)?MarketConfig\b/.test(match[2])
          && !/\bMarketConfigV2\b/.test(match[2]),
        )
        .map((match) => match[1]),
    )
    expect(legacyConfigFunctions.size).toBeGreaterThan(0)

    const production = productionTransactionSources()
    const routedLegacyFunctions = [...legacyConfigFunctions]
      .filter((functionName) =>
        new RegExp(`::market::${functionName}(?![A-Za-z0-9_])`).test(production),
      )
    expect(routedLegacyFunctions).toEqual([])
  })
})
