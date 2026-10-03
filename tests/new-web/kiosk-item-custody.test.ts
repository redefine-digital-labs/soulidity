import { expect, it } from 'vitest'
import { assertKioskItemField, deriveKioskItemFieldId, KioskItemFieldBcs } from '../../packages/soulidity-sdk/src/kiosk-item-custody'

// Independent golden output from real Sui VM native child-object reads of
// Soul and SoulCollectionRight (kiosk_custody_vm_tests.move), not this codec.
const kiosk = '0x034401905bebdf8c04f3cd5f04f442a39372c8dc321c29edfb4f9cb30b23ab96'
const vectors = [
  ['0x5ef2fcf809fb9535ea0aeaea421f683026f06c34569aafc42bcde652ef6dd270',
    '0x8a044a1601270f6b26a2fa59ff0af04106e5efb57598b3b1f018b4d0e33db9e4'],
  ['0xa058cccb1180e0c063232bed5fcf330614d57c74f056f8b3db0317812e129eb2',
    '0x04e917eb30c6c9733b799234c149825c7321f79347b7d65b77d8c0b5ab25e5a6'],
]
it.each(vectors)('matches independently observed VM field ID and full BCS for %s', (item, field) => {
  expect(deriveKioskItemFieldId(kiosk, item)).toBe(field)
  const bytes = Uint8Array.from(Buffer.from(field.slice(2) + item.slice(2) + item.slice(2), 'hex'))
  expect(bytes).toHaveLength(96)
  expect(assertKioskItemField(bytes, kiosk, item)).toBe(field)
  expect(KioskItemFieldBcs.serialize({ id: field, name: { name: { id: item } }, value: item }).toBytes()).toEqual(bytes)
  expect(() => assertKioskItemField(bytes.slice(1), kiosk, item)).toThrow()
  expect(() => assertKioskItemField(new Uint8Array([...bytes, 0]), kiosk, item)).toThrow()
  for (const offset of [0, 32, 64]) {
    const changed = bytes.slice(); changed[offset] ^= 1
    expect(() => assertKioskItemField(changed, kiosk, item)).toThrow()
  }
})
it.each(['0x1', '0x' + '0'.repeat(64), '0x' + 'A'.repeat(64), '0x' + 'g'.repeat(64), '', null])(
  'rejects noncanonical or zero custody identifiers %s', value => {
    expect(() => deriveKioskItemFieldId(value as string, vectors[0][0])).toThrow()
    expect(() => deriveKioskItemFieldId(kiosk, value as string)).toThrow()
  })
it('rejects aliased Kiosk and item identities', () => {
  expect(() => deriveKioskItemFieldId(kiosk, kiosk)).toThrow('OBJECT_ALIAS')
})
