import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MARKET_SOURCE = readFileSync(
  'move/soulidity/sources/market.move',
  'utf8',
)

function functionBody(name: string) {
  const declaration = new RegExp(`^public fun ${name}(?:<[^>]+>)?\\(`, 'm').exec(MARKET_SOURCE)
  const start = declaration?.index ?? -1
  expect(start).toBeGreaterThanOrEqual(0)
  const bodyStart = MARKET_SOURCE.indexOf('{', start)
  let depth = 1, end = bodyStart + 1
  while (depth && end < MARKET_SOURCE.length) {
    if (MARKET_SOURCE[end] === '{') depth++
    if (MARKET_SOURCE[end] === '}') depth--
    end++
  }
  expect(depth).toBe(0)
  return MARKET_SOURCE.slice(start, end)
}

describe('single native Animacraft route authority', () => {
  it('has one current kiosk registration path without a retired selector', () => {
    const shared = readFileSync('packages/soulidity-sdk/src/tx/shared.ts', 'utf8')
    expect(shared).toContain('::market::ensure_personal_kiosk_registered_v2')
    expect(shared).not.toMatch(/registrationMarket|secondary-v6|ensure_personal_kiosk_registered_v6|MARKET_CONFIG_V6/)
  })
  // VM behavior is covered by the complete native-soul graph; SDK suites
  // roundtrip the actual PTBs. This guard prevents reintroducing old issuers.
  it('has no legacy mint/list/buy/cancel entrypoints or provenance authority', () => {
    const entrypoints = [...MARKET_SOURCE.matchAll(/^public fun (\w+)/gm)].map(match => match[1])
    expect(entrypoints.filter(name => name.includes('animacraft')).sort()).toEqual([
      'buy_animacraft_v8_soul_fixed_price', 'cancel_animacraft_v8_soul_listing',
      'list_animacraft_v8_soul_fixed_price', 'mint_animacraft_v8_in_personal_kiosk',
      'quote_animacraft_v8_soul_sale',
    ])
    expect(MARKET_SOURCE).not.toMatch(/animacraft_provenance::|SoulMintAuthorizationV[4-7]\b/)
    const nativeRoutes = entrypoints.filter(name => name.includes('animacraft')).map(functionBody).join('\n')
    expect(nativeRoutes).not.toMatch(/MARKET_VERSION_ANIMACRAFT_V[4-7]\b/)
    expect(MARKET_SOURCE).not.toMatch(/MarketConfigV6|MarketAdminCapV6|MARKET_VERSION_ANIMACRAFT_V6|public fun \w+_v6\b/)
    // The only ordinary successor route must still reject native Souls.
    for (const name of ['list_soul_fixed_price_v2', 'list_soul_fixed_price_with_collection_v2']) {
      expect(functionBody(name)).toContain('assert!(!soul::has_animacraft_provenance(state), EAnimacraftListingPathRequired)')
    }
  })

  it('consumes the exact native authorization and freezes its binding at mint', () => {
    const mint = functionBody('mint_animacraft_v8_in_personal_kiosk')
    expect(mint).toContain('authorization: SoulMintAuthorizationV8')
    expect(mint).toContain('soulidity_binding_v8::assert_native_soul_v8<Soul>(protocol)')
    expect(mint).toContain('output_v8::bind_native_soul_v8(')
    expect(mint).toContain('soul::bind_animacraft_native_v8(')
    expect(mint).toContain('output_v8::freeze_native_soul_binding_v8(binding)')
  })

  it('preserves dedicated native quote, custody guard, purchase and cancellation routes', () => {
    const list = functionBody('list_animacraft_v8_soul_fixed_price')
    expect(list).toContain('provenance: &NativeSoulBindingV8')
    expect(list).toContain('quote_animacraft_v8_soul_sale(state, provenance, price)')
    expect(list.indexOf('soul::set_listed(state, true)')).toBeGreaterThan(-1)
    expect(list.indexOf('soul::set_listed(state, true)')).toBeLessThan(list.indexOf('kiosk::list_with_purchase_cap<Soul>'))
    expect(list).toContain('version: MARKET_VERSION_ANIMACRAFT_V8')
    for (const name of ['buy_animacraft_v8_soul_fixed_price', 'cancel_animacraft_v8_soul_listing']) {
      expect(functionBody(name)).toContain('assert_animacraft_native_v8_listing(state, listing)')
    }
    expect(functionBody('buy_animacraft_v8_soul_fixed_price')).toContain('finish_animacraft_soul_purchase(')
    expect(functionBody('cancel_animacraft_v8_soul_listing')).toContain('cancel_soul_listing_impl(')
  })
})
