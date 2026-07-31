import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MARKET_SOURCE = readFileSync(
  'move/soulidity/sources/market.move',
  'utf8',
)

function functionBody(name: string, nextName: string) {
  const start = MARKET_SOURCE.indexOf(`public fun ${name}(`)
  const end = MARKET_SOURCE.indexOf(`public fun ${nextName}(`, start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return MARKET_SOURCE.slice(start, end)
}

describe('Animacraft protocol-version route isolation', () => {
  it('forces both legacy mint entrypoints to consume v4 authorizations only', () => {
    const legacyV1 = functionBody(
      'mint_animacraft_in_personal_kiosk',
      'mint_animacraft_in_personal_kiosk_v2',
    )
    const legacyV2 = functionBody(
      'mint_animacraft_in_personal_kiosk_v2',
      'mint_animacraft_v5_in_personal_kiosk_v2',
    )

    for (const source of [legacyV1, legacyV2]) {
      expect(source).toContain('ANIMACRAFT_PROTOCOL_VERSION_V4,')
      expect(source).not.toContain('\n        0,\n        clock,')
    }
  })

  it('keeps commerce-v5 mint, listing, and purchase on dedicated entrypoints', () => {
    const mintV5 = functionBody(
      'mint_animacraft_v5_in_personal_kiosk_v2',
      'list_animacraft_v5_soul_fixed_price_v2',
    )
    const listV5 = functionBody(
      'list_animacraft_v5_soul_fixed_price_v2',
      'list_animacraft_v5_soul_fixed_price_with_creator_royalty_v2',
    )
    const buyV5 = functionBody(
      'buy_animacraft_v5_soul_fixed_price_v2',
      'list_collection_right_fixed_price',
    )

    expect(mintV5).toContain('ANIMACRAFT_PROTOCOL_VERSION_V5,')
    expect(mintV5).toContain('bind_complete_output_to_soul_v5')
    expect(listV5).toContain(
      'list_animacraft_v5_soul_fixed_price_with_creator_royalty_v2',
    )
    expect(buyV5).toContain(
      'listing.version == MARKET_VERSION_ANIMACRAFT_V5',
    )
    expect(buyV5).toContain(
      'animacraft_provenance::is_v5_commerce_compatible(provenance)',
    )
  })
})
