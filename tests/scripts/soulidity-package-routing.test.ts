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

  it('verifies successor objects against their stable defining-package TypeOrigin', () => {
    const text = source('scripts/preflight-animacraft-market-retirement.ts')
    expect(text).toContain('`${marketConfigV2PackageId}::market::MarketConfigV2`')
    expect(text).toContain('`${marketConfigV2PackageId}::market::MarketAdminCapV2`')
    expect(text).toContain("module: 'animacraft_provenance'")
    expect(text).not.toContain("module: 'soul',\n      struct: 'AnimacraftProvenance'")
  })

  it('accepts only the v4-only canonical Animacraft authorization type', () => {
    const market = source('move/soulidity/sources/market.move')
    expect(market).toContain('CanonicalSoulMintAuthorization')
    expect(market).toContain(
      'animacraft::consume_canonical_soul_mint_authorization(authorization)',
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
