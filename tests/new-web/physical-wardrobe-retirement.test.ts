import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(path), 'utf8')

// This suite verifies removal and evidence retention, NOT gift/deposit/emergency
// capability acceptance. The complete retired test source is deliberately kept
// as non-executable evidence until those product abilities are mapped.
describe('retired V7 SDK surface', () => {
  it('has no wardrobe or renderer module/export and no old SoulState getters', () => {
    for (const name of ['physical-wardrobe-v7.ts', 'physical-renderer-v7.ts', 'tx/physical-wardrobe-v7.ts']) {
      expect(existsSync(resolve('packages/soulidity-sdk/src', name))).toBe(false)
    }
    const index = source('packages/soulidity-sdk/src/index.ts')
    expect(index).not.toContain("from './physical-wardrobe-v7'")
    expect(index).not.toContain("from './physical-renderer-v7'")
    expect(index).not.toContain("from './tx/physical-wardrobe-v7'")
    const queries = source('packages/soulidity-sdk/src/queries.ts')
    for (const name of ['getAnimacraftAppearanceV6Id', 'getAnimacraftWardrobeV7Id', 'getAnimacraftPhysicalProfileV7Id', 'getSoulStateBoundObjectId']) expect(queries).not.toContain(name)
  })
  it('has removed the entire retired mint builder instead of forwarding V7 arguments to another issuer', () => {
    expect(existsSync(resolve('packages/soulidity-sdk/src/tx/animacraft.ts'))).toBe(false)
    expect(source('packages/soulidity-sdk/src/index.ts')).not.toContain("from './tx/animacraft'")
  })
  it('retains the original gift, custody and renderer evidence, without claiming the removed suite passes', () => {
    const evidence = source('tests/new-web/fixtures/retired-physical-wardrobe-v7.test.ts.txt')
    expect(evidence).toContain('builds only the reviewed direct gift ABI')
    expect(evidence).toContain('rejects zero-address gift recipients')
    expect(evidence).toContain('derives equipped/loadout state by joining equipped_asset_ids to child assets')
    expect(evidence).toContain('fails closed when the immutable PNG bytes are substituted')
  })
  it('maps the replaced lock/source/renderer claims to executable native regressions, not to V7 ABI compatibility', () => {
    expect(source('tests/new-web/animacraft-native-equipment.test.ts')).toContain('reads external item locks and does not reinterpret usage rights as owned instances')
    expect(source('tests/new-web/native-render-source.test.ts')).toContain('reads exact Base, Pack and External content without inventory pages')
    expect(source('tests/new-web/native-render-client.test.ts')).toContain('runs the real shared asset hash gate and renderer')
  })
})
