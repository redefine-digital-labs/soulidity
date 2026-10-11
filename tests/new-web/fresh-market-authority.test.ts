import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as sdk from '@soulidity/sdk'

const read = (path: string) => readFileSync(path, 'utf8')
const market = read('move/soulidity/sources/market.move')
function functionBody(name: string) {
  const start = market.indexOf(`fun ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const open = market.indexOf('{', start)
  let end = open + 1, depth = 1
  for (; end < market.length && depth; end++) {
    if (market[end] === '{') depth++
    if (market[end] === '}') depth--
  }
  expect(depth).toBe(0)
  return market.slice(start, end)
}

describe('fresh shared V2 market authority', () => {
  it('has no V6 config, cap, migration constructor or ordinary transaction branch', () => {
    expect(market).not.toMatch(/MarketConfigV6|MarketAdminCapV6|Market\w*V6|MARKET_VERSION_ANIMACRAFT_V6|\b\w+_v6\b|retire_legacy_market|LegacyMarketRetired/)
    for (const path of ['packages/soulidity-sdk/src/deployment.ts', 'packages/soulidity-sdk/src/env.ts',
      'packages/soulidity-sdk/src/deployment-manifest.json']) {
      expect(read(path)).not.toMatch(/marketConfigV6|marketAdminCapV6|MarketConfigV6|MARKET_CONFIG_V6/)
    }
    expect(sdk).not.toHaveProperty('getSoulidityMarketConfigV6PackageId')
  })
  it('keeps ordinary secondary builders on V2 and native secondary on exact V8 targets', () => {
    for (const path of ['packages/soulidity-sdk/src/tx/list.ts', 'packages/soulidity-sdk/src/tx/update-price.ts']) {
      const source = read(path)
      expect(source).toContain('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
      expect(source).not.toContain('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')
      expect(source).toContain('native V8')
    }
    const native = read('packages/soulidity-sdk/src/tx/animacraft-market-v8.ts')
    expect(native).toContain("call(runtime.soulidityCallablePackageId, 'buy_animacraft_v8_soul_fixed_price')")
    expect(native).not.toContain('buy_animacraft_soul_fixed_price_with_collection_v6')
  })
  it('keeps fresh gates closed by default and independent under the bound V2 admin cap', () => {
    expect(functionBody('init')).toContain('init_fresh_impl(package::claim(otw, ctx), ctx.sender(), ctx)')
    const init = functionBody('init_fresh_impl')
    expect(init).toContain('primary_enabled: false')
    expect(init).toContain('secondary_enabled: false')
    expect(init).not.toContain('MarketConfig {')
    const gates = market.slice(market.indexOf('public fun update_config_v2_primary_enabled('),
      market.indexOf('public fun update_config_v2_fee_recipient('))
    expect(gates.match(/assert!\(admin_cap.config_id == object::id\(config\), EAnimacraftAuthorizationMismatch\)/g)).toHaveLength(2)
    expect(gates).toContain('config.primary_enabled = enabled')
    expect(gates).toContain('config.secondary_enabled = enabled')
    expect(market).toContain('assert!(config.secondary_enabled, ESecondaryPausedV2)')
    expect(market).not.toMatch(/#\[test_only\]\s*const EPrimaryPausedV2/)
  })
})
