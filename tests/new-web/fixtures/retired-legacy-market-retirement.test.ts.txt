import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..')
const marketMove = readFileSync(
  join(repoRoot, 'move/soulidity/sources/market.move'),
  'utf8',
)
const animacraftSdk = readFileSync(
  join(repoRoot, 'packages/soulidity-sdk/src/tx/animacraft.ts'),
  'utf8',
)
const listSdk = readFileSync(
  join(repoRoot, 'packages/soulidity-sdk/src/tx/list.ts'),
  'utf8',
)
const updatePriceSdk = readFileSync(
  join(repoRoot, 'packages/soulidity-sdk/src/tx/update-price.ts'),
  'utf8',
)

describe('legacy market retirement security boundary', () => {
  it('consumes and deletes the only legacy admin cap after requiring pause', () => {
    const retirement = marketMove.slice(
      marketMove.indexOf('public fun retire_legacy_market('),
      marketMove.indexOf('public fun update_config_v2_primary_enabled('),
    )
    expect(retirement).toContain('admin_cap: MarketAdminCap')
    expect(retirement).toContain('assert!(config.paused, ELegacyMarketMustBePaused)')
    expect(retirement).toContain('let MarketAdminCap { id: legacy_admin_uid } = admin_cap')
    expect(retirement).toContain('legacy_admin_uid.delete()')
    expect(retirement).toContain('primary_enabled: false')
    expect(retirement).toContain('secondary_enabled: false')
  })

  it('keeps primary mint on V2 and every secondary SDK path on isolated V6', () => {
    expect(animacraftSdk).toContain('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID')
    expect(animacraftSdk).toContain('mint_animacraft_in_personal_kiosk_v2')
    for (const source of [animacraftSdk, listSdk, updatePriceSdk]) {
      expect(source).toContain('NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V6_ID')
    }
    expect(animacraftSdk).toContain('buy_animacraft_soul_fixed_price_v6')
    expect(animacraftSdk).toContain('buy_animacraft_soul_fixed_price_with_collection_v6')
    expect(listSdk).toContain('list_animacraft_soul_fixed_price_v6')
    expect(listSdk).toContain('list_animacraft_soul_fixed_price_with_collection_v6')
    expect(updatePriceSdk).toContain('list_animacraft_soul_fixed_price_v6')
    expect(updatePriceSdk).toContain('list_animacraft_soul_fixed_price_with_collection_v6')
    expect(listSdk).not.toContain('list_animacraft_soul_fixed_price_v2')
    expect(updatePriceSdk).not.toContain('list_animacraft_soul_fixed_price_v2')
  })

  it('does not mistake application routing for the old-bytecode security control', () => {
    expect(marketMove).toContain(
      'Old package bytecode remains callable forever on Sui',
    )
    expect(marketMove).toContain('public struct MarketConfigV2 has key')
    expect(marketMove).toContain('assert!(config.secondary_enabled, ESecondaryPausedV2)')
  })
})
