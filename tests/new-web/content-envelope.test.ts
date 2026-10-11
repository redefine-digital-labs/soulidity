import { describe, expect, it } from 'vitest'
import { CONTENT_ENVELOPE_MAX_BYTES, contentEnvelopeKey, decodeContentEnvelope, encodeContentEnvelope } from '../../web/lib/soulidity/content-envelope'
import { contentEnvelopeFixture, envelopeId as id } from './fixtures/content-envelope'

describe('public encrypted Soul content envelopes', () => {
  it('roundtrips an actual Seal EncryptedObject and binds its complete content tuple', () => {
    const input = contentEnvelopeFixture(), text = encodeContentEnvelope(input, id(6))
    expect(decodeContentEnvelope(text, input, id(6))).toEqual(input)
    expect(contentEnvelopeKey(input)).toMatch(/^content_seal_envelope_v1:[0-9a-f]{64}$/)
    expect(contentEnvelopeKey({ ...input, blobObjectId: id(91) })).toBe(contentEnvelopeKey(input))
    expect(() => decodeContentEnvelope(text, { ...input, blobObjectId: id(91) }, id(6))).toThrow()
  })
  it.each(['contentObjectId', 'kind', 'name', 'versionIndex'] as const)('uses a distinct key for %s', field => {
    const input = contentEnvelopeFixture(), changed = { ...input,
      [field]: field === 'contentObjectId' ? id(90) : field === 'kind' ? 2 : field === 'name' ? 'other' : '1' }
    expect(contentEnvelopeKey(changed)).not.toBe(contentEnvelopeKey(input))
  })
  it.each(['raw-dek', 'unknown', 'namespace', 'document', 'encrypted-object', 'invalid-iv', 'hash', 'tuple', 'oversize'])(
    'rejects invalid %s without serializing a public record', variant => {
      const input = contentEnvelopeFixture()
      if (variant === 'raw-dek') Object.assign(input.sidecar, { dek: 'PRIVATE' })
      if (variant === 'unknown') Object.assign(input, { material: { dek: 'PRIVATE' } })
      if (variant === 'namespace') input.sidecar.sealPackageId = id(99)
      if (variant === 'document') input.sidecar.documentId = contentEnvelopeFixture(2, 'other').sidecar.documentId
      if (variant === 'encrypted-object') input.sidecar.encryptedDek = 'AAAA'
      if (variant === 'invalid-iv') input.sidecar.iv = 'AAAA'
      if (variant === 'hash') input.sidecar.contentHash = 'not-a-hash'
      if (variant === 'tuple') input.name = 'other'
      if (variant === 'oversize') input.sidecar.fileName = 'a'.repeat(CONTENT_ENVELOPE_MAX_BYTES)
      expect(() => encodeContentEnvelope(input, id(6))).toThrow()
    },
  )
  it.each(['duplicate-key', 'whitespace', 'unknown-field'])( 'rejects noncanonical stored JSON: %s', variant => {
    const input = contentEnvelopeFixture(), text = encodeContentEnvelope(input, id(6))
    const changed = variant === 'whitespace' ? ' ' + text : variant === 'unknown-field' ? text.slice(0, -1) + ',"extra":true}'
      : text.replace('"kind":0', '"kind":0,"kind":0')
    expect(() => decodeContentEnvelope(changed, input, id(6))).toThrow()
  })
})
