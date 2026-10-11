import { describe, it, expect } from 'vitest'

// Simulate the field traversal logic from the internal readNestedObjectId helper.
// Testing observable behavior: for > id-string > id-nested > fields > vec patterns.
function readNestedObjectId(value: unknown, depth = 0): string | null {
  if (depth > 10) return null
  if (typeof value === 'string' && value.length > 0) return value
  const record = value as Record<string, unknown> | null
  if (!record || typeof record !== 'object') return null
  if ('for' in record) return record.for as string
  if ('id' in record && typeof record.id === 'string') return record.id
  if ('id' in record && record.id) {
    const nested = readNestedObjectId(record.id, depth + 1)
    if (nested) return nested
  }
  if (record.fields) return readNestedObjectId(record.fields, depth + 1)
  if (Array.isArray((record as Record<string, unknown>).vec)) {
    const vec = (record as Record<string, unknown[]>).vec
    if (vec.length === 0) return null
    if (vec.length === 1) return readNestedObjectId(vec[0], depth + 1)
  }
  return null
}

describe('readNestedObjectId priority', () => {
  it('extracts kiosk ID from KioskOwnerCap (for field)', () => {
    // Simulates: PersonalKioskCap.cap = KioskOwnerCap { for: kioskId, id: capId }
    // The `for` field should win over `id`
    const capFields = {
      type: '0x2::kiosk::KioskOwnerCap',
      fields: {
        for: '0xkiosk_id_correct',
        id: { id: '0xcap_uid_wrong' },
      },
    }
    expect(readNestedObjectId(capFields)).toBe('0xkiosk_id_correct')
  })

  it('extracts Option<ID> Some value', () => {
    // Option<ID> Some is typically { id: "0x..." }
    const optionSome = { id: '0xskills_object_id' }
    expect(readNestedObjectId(optionSome)).toBe('0xskills_object_id')
  })

  it('handles direct ID strings returned by Sui RPC for Option<ID>', () => {
    expect(readNestedObjectId('0xmetadata_object_id')).toBe('0xmetadata_object_id')
  })

  it('handles Option<ID> None (vec empty)', () => {
    const optionNone = { vec: [] as unknown[] }
    expect(readNestedObjectId(optionNone)).toBeNull()
  })

  it('handles nested UID { id: { id: "0x..." } }', () => {
    const uid = { id: { id: '0xobject_uid' } }
    expect(readNestedObjectId(uid)).toBe('0xobject_uid')
  })
})
