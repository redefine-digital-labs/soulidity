import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, normalizeStructTag, toBase64 } from '@mysten/sui/utils'
import { EncryptedObject } from '../../../web/node_modules/@mysten/seal/dist/index.mjs'
import { generateContentDocumentIdHex } from '../../../packages/soulidity-sdk/src/content-document-id'
import { CONTENT_ENVELOPE_SCHEMA, contentEnvelopeKey, encodeContentEnvelope, type ContentEnvelope } from '../../../web/lib/soulidity/content-envelope'
import { NativeSoulStateBcs } from '../../../web/lib/animacraft/native-receive'
import { NATIVE_RECEIVER_SCHEMA, type NativeRequest } from '../../../web/lib/animacraft/native-handoff'
import { nativeReceiveFixture } from './native-receive'

export const envelopeId = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
export function contentEnvelopeFixture(kind = 0, name = 'soul'): ContentEnvelope {
  const documentId = generateContentDocumentIdHex({ contentObjectId: envelopeId(17), kind, name,
    versionIndex: 0, nonce: new Uint8Array(16).fill(3) })
  const encrypted = EncryptedObject.serialize({ version: 0, packageId: envelopeId(6), id: documentId,
    services: [[envelopeId(60), 1]], threshold: 1,
    encryptedShares: { BonehFranklinBLS12381: { nonce: new Uint8Array(96),
      encryptedShares: [new Uint8Array(32)], encryptedRandomness: new Uint8Array(32) } },
    ciphertext: { Aes256Gcm: { blob: new Uint8Array(80), aad: new Uint8Array() } },
  }).toBytes()
  return { schema: CONTENT_ENVELOPE_SCHEMA, contentObjectId: envelopeId(17), kind, name,
    versionIndex: '0', blobObjectId: envelopeId(22 + kind), sidecar: {
      version: 1, mode: 'seal-envelope', sealPackageId: envelopeId(6), documentId,
      encryptedDek: toBase64(encrypted), iv: toBase64(new Uint8Array(12)), cipher: 'AES-GCM-256',
      mimeType: 'text/markdown', fileName: name + '.md', contentHash: 'c'.repeat(64),
    } }
}
export const EnvelopeConfigField = bcs.struct('Field', { id: bcs.Address, name: bcs.string(), value: bcs.vector(bcs.u8()) })
export function nativeEnvelopeReceiveFixture() {
  const f = nativeReceiveFixture(), id = envelopeId
  const envelopes = [contentEnvelopeFixture(), contentEnvelopeFixture(1, 'default'), contentEnvelopeFixture(2, 'skill')]
  const ContentEvent = bcs.struct('ContentVersionAppended', { content_id: bcs.Address, soul_id: bcs.Address,
    kind: bcs.u32(), kind_name: bcs.string(), name: bcs.string(), version_index: bcs.u64(), is_public: bcs.bool(),
    download_policy: bcs.u8(), grant_scope_mask: bcs.u64(), read_mode_mask: bcs.u64(), op_mask: bcs.u64(),
    seal_encrypted: bcs.bool(), blob_object_id: bcs.Address, created_at_ms: bcs.u64() })
  f.tx.events.splice(2, 1, ...envelopes.map(e => ({ eventType: `${id(6)}::content::ContentVersionAppended`,
    bcs: ContentEvent.serialize({ content_id: id(17), soul_id: id(12), kind: e.kind, kind_name: e.name,
      name: e.name, version_index: '0', is_public: false, download_policy: 0, grant_scope_mask: '1',
      read_mode_mask: '3', op_mask: '1', seal_encrypted: true, blob_object_id: e.blobObjectId, created_at_ms: '1' }).toBytes() })))
  const request: NativeRequest = { schemaVersion: NATIVE_RECEIVER_SCHEMA, type: 'SYNC', requestId: 'b'.repeat(32),
    nonce: 'a'.repeat(32), rootId: id(10), signer: id(11), payload: { txDigest: f.input.txDigest, soulOnChainId: id(12),
      contentSidecars: envelopes.map(e => ({ kind: e.kind, name: e.name, versionIndex: 0, sidecar: e.sidecar })) } }
  const current = new Map<string, any>(), fieldIds: string[] = []
  const state = NativeSoulStateBcs.parse(f.objects.get(id(14)).contents.value)
  state.config_ext = { id: id(35), size: '3' }
  current.set(id(14), { ...structuredClone(f.objects.get(id(14))), version: 3n,
    contents: { value: NativeSoulStateBcs.serialize(state).toBytes() } })
  for (const envelope of envelopes) {
    const key = contentEnvelopeKey(envelope), text = encodeContentEnvelope(envelope, id(6))
    const fieldId = deriveDynamicFieldID(id(35), '0x1::string::String', bcs.string().serialize(key).toBytes())
    fieldIds.push(fieldId)
    current.set(fieldId, { objectId: fieldId, version: 3n, digest: f.input.txDigest,
      objectType: normalizeStructTag('0x2::dynamic_field::Field<0x1::string::String,vector<u8>>'),
      owner: { kind: 2, address: id(35) }, contents: { value: EnvelopeConfigField.serialize({
        id: fieldId, name: key, value: [...new TextEncoder().encode(text)],
      }).toBytes() } })
  }
  Object.assign(f.client.ledgerService, {
    getObject: async (input: any) => { f.calls.push(input); return { response: { object:
      input.version === undefined ? current.get(input.objectId) ?? f.objects.get(input.objectId) : f.objects.get(input.objectId) } } },
    batchGetObjects: async ({ requests }: any) => ({ response: { objects: requests.map(({ objectId }: any) => ({ result:
      current.has(objectId) ? { oneofKind: 'object', object: current.get(objectId) }
        : { oneofKind: 'error', error: { code: 5 } } })) } }),
  })
  return { ...f, current, request, envelopes, fieldIds, dependencies: { target: () => f.target, client: () => f.client } }
}
