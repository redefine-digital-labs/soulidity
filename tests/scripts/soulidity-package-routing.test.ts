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
    'scripts/phase2-smoke.ts',
    'scripts/phase2-mainnet-execute-rest.ts',
    'scripts/phase2-retry-failed.ts',
    'scripts/phase2-finish-skipped.ts',
  ])('%s wires SDK transactions with explicit callable and original ids', (path) => {
    const text = source(path)
    expect(text).toContain('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID')
    expect(text).toContain('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')
    expect(text).not.toMatch(/process\.env\.NEXT_PUBLIC_SOULIDITY_PACKAGE_ID\s*=/)
  })

  it('uses original package identity for smoke event extraction', () => {
    const text = source('scripts/smoke-soulidity.ts')
    expect(text).toContain(
      "getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID')",
    )
    expect(text).not.toContain(
      "getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_PACKAGE_ID')",
    )
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

  it('routes commerce-v5 production env and accepts only an HTTPS Animacraft origin', () => {
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
      expect(e2e).toContain(`'${key}'`)
    }
    expect(sync).toContain("url.protocol === 'https:'")
    expect(sync).toContain('value.replace(/\\/+$/, \'\') === url.origin')
    expect(sync).toContain('Commerce v5 requires NEXT_PUBLIC_ANIMACRAFT_CANONICAL_MINT_ENABLED=true')
    expect(sync).toContain('function isNonZeroSuiId(value: string)')
    expect(sync).toContain('&& /[1-9a-fA-F]/.test(value.slice(2))')
    expect(sync).toContain('if (value && !isNonZeroSuiId(value))')
    expect(sync).toContain('else if (animacraftEnabled && !value)')
    expect(sync).toContain('else if (animacraftCommerceV5Enabled && !value)')
    expect(e2e).toContain("url.protocol === 'https:'")
    expect(e2e).toContain('expected "true" for mainnet E2E')
    expect(e2e).toContain('function isNonZeroSuiId(value: string)')
    expect(e2e).toContain('&& /[1-9a-fA-F]/.test(value.slice(2))')
    expect(e2e).toContain('if (value && !isNonZeroSuiId(value))')
  })

  it('verifies successor objects against their stable defining-package TypeOrigin', () => {
    const text = source('scripts/preflight-animacraft-market-retirement.ts')
    expect(text).toContain('`${marketConfigV2PackageId}::market::MarketConfigV2`')
    expect(text).toContain('`${marketConfigV2PackageId}::market::MarketAdminCapV2`')
    expect(text).toContain("module: 'animacraft_provenance'")
    expect(text).not.toContain("module: 'soul',\n      struct: 'AnimacraftProvenance'")
  })

  it('keeps v4 canonical mint compatible and requires authenticated commerce-v5 royalty', () => {
    const market = source('move/soulidity/sources/market.move')
    expect(market).toContain('CanonicalSoulMintAuthorization')
    expect(market).toContain('CommerceV5SoulMintAuthorization')
    expect(market).toContain(
      'animacraft::consume_canonical_soul_mint_authorization(authorization)',
    )
    expect(market).toContain(
      'animacraft_commerce_v5::consume_commerce_v5_soul_mint_authorization',
    )
    expect(market).toMatch(
      /public fun mint_animacraft_v5_in_personal_kiosk_v2\([\s\S]*?authorization:\s*CommerceV5SoulMintAuthorization,[\s\S]*?\): SoulState/,
    )
    expect(market).not.toContain(
      'public fun mint_animacraft_v5_in_personal_kiosk_with_creator_royalty_v2',
    )
    expect(market).not.toMatch(/^\s*SoulMintAuthorization,\s*$/m)
    expect(market).not.toMatch(/authorization:\s*SoulMintAuthorization/)
  })

  it.each([
    'web/app/api/souls/[id]/route.ts',
    'web/app/api/agent/souls/[id]/route.ts',
    'web/app/api/agent/souls/[id]/purchase/route.ts',
  ])('%s reads MarketConfigV2 using its defining-package type origin', (path) => {
    const text = source(path)
    const configRead = text.slice(
      text.indexOf('getMarketConfigV2('),
      text.indexOf('getMarketConfigV2(') + 300,
    )
    expect(configRead).toContain(
      "getRequiredSoulidityEnv('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_PACKAGE_ID')",
    )
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
