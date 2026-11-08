import { toBase64 } from '@mysten/sui/utils'
import type { WalrusClient } from '@mysten/walrus'
import type { PendingSealMaterial } from './client-seal'
import { preparePayload, readAndHashUploadFile, type BatchSoulUploadFile, type PreparedFile } from './client-upload'
import { WALRUS_BATCH_MAX_FILES, WALRUS_BATCH_MAX_BYTES, walrusBatchCheck as check, walrusBatchHash,
  walrusBatchJsonHash, walrusBatchKeys, walrusBatchBase64, parseWalrusBatchScope, parseWalrusBatchManifest,
  parseWalrusBatchPreparation, assertWalrusBatchLifetime, walrusBatchStep,
  type WalrusBatchScope, type WalrusBatchLifetime, type WalrusBatchManifest, type WalrusBatchProtection,
  type WalrusBatchPreparation, type WalrusBatchProtector } from './walrus-batch-shape'
export * from './walrus-batch-shape'

// Private active-upload UTF-8 encoding; validators/codecs remain single-source.
const utf8 = new TextEncoder()
function clearPrepared(file: PreparedFile) {
  file.plaintext.fill(0); file.payload.fill(0)
  if (file.encrypted) { file.encrypted.material.dek = ''; file.encrypted.material.iv = '' }
}
export async function prepareWalrusBatch(params: {
  scope: WalrusBatchScope; files: readonly BatchSoulUploadFile[]; storageEpochs: number
  client: Pick<WalrusClient, 'encodeBlob' | 'systemState' | 'reset'>
  lifetime: WalrusBatchLifetime; protector: WalrusBatchProtector | null
  persistence?: 'permanent'
}): Promise<WalrusBatchPreparation> {
  const scope = parseWalrusBatchScope(params.scope), life = { ...params.lifetime }, client = params.client, protector = params.protector && { ...params.protector }
  const files = params.files.map(file => ({ ...file })), epochs = params.storageEpochs
  const permanent = params.persistence === 'permanent'
  check(params.persistence === undefined || permanent, 'PERSISTENCE_INVALID')
  check(files.length <= WALRUS_BATCH_MAX_FILES && Number.isInteger(epochs) && epochs > 0 && epochs <= 0xffffffff,
    'PREPARATION_INPUT_INVALID')
  check(files.every(file => file.file instanceof File) && files.reduce((sum, file) => sum + file.file.size + 16, 0) <= WALRUS_BATCH_MAX_BYTES,
    'SOURCE_BUDGET')
  check(!files.some(file => file.uploadType === 'encrypted') || protector, 'PROTECTOR_REQUIRED')
  assertWalrusBatchLifetime(scope, life)
  // An empty Collection may reference an existing public image URL. It still
  // needs the parent's committed create journal, but no Walrus query/payment.
  if (!files.length) {
    const manifest: WalrusBatchManifest = { schema: permanent ? 'soulidity.walrus-batch-manifest.v2' : 'soulidity.walrus-batch-manifest.v1',
      ...(permanent ? { deletable: false as const } : {}), scope, storageEpochs: epochs, files: [] }
    return parseWalrusBatchPreparation({ schema: 'soulidity.walrus-batch-preparation.v1', manifest,
      manifestHash: walrusBatchJsonHash(manifest), payloads: [], privateRecovery: null })
  }
  client.reset()
  const system = await walrusBatchStep(scope, life, () => client.systemState())
  const nShards = system.committee.n_shards, epoch = system.committee.epoch
  const manifest: WalrusBatchManifest = { schema: permanent ? 'soulidity.walrus-batch-manifest.v2' : 'soulidity.walrus-batch-manifest.v1',
    ...(permanent ? { deletable: false as const } : {}), scope, storageEpochs: epochs, files: [] }
  const payloads: Uint8Array[] = [], secrets: Array<{ index: number; material: PendingSealMaterial }> = []
  let rawSecrets: Uint8Array | undefined
  try {
    for (const [index, item] of files.entries()) {
      const base = await walrusBatchStep(scope, life, () => readAndHashUploadFile(item), value => value.plaintext.fill(0))
      let prepared: PreparedFile | undefined
      try {
        prepared = await walrusBatchStep(scope, life, () => preparePayload(item, index, base), clearPrepared)
        const encoded = await walrusBatchStep(scope, life, () => client.encodeBlob(new Uint8Array(prepared!.payload)))
        const bytes = new Uint8Array(prepared.payload)
        payloads.push(bytes)
        manifest.files.push({ index, recipient: item.sendObjectTo?.trim() || scope.owner, kind: item.kind, uploadType: item.uploadType,
          fileName: prepared.normalizedFile.name || 'bundle', mimeType: prepared.contentType,
          plaintextByteLength: prepared.plaintext.length, payloadByteLength: bytes.length,
          contentHash: prepared.contentHash, payloadHash: walrusBatchHash(bytes), skillName: prepared.skillBundleMetadata?.skillName ?? null,
          encoding: { blobId: encoded.blobId, rootHash: toBase64(encoded.rootHash), encodingType: 'RS2', nShards } })
        check(Number(encoded.metadata.V1.unencoded_length) === bytes.length
          && (encoded.metadata.V1.encoding_type === 'RS2' || typeof encoded.metadata.V1.encoding_type === 'object'
            && 'RS2' in encoded.metadata.V1.encoding_type), 'SDK_ENCODING_MISMATCH')
        if (prepared.encrypted) secrets.push({ index, material: { ...prepared.encrypted.material } })
      } finally { base.plaintext.fill(0); if (prepared) clearPrepared(prepared) }
    }
    client.reset()
    const current = await walrusBatchStep(scope, life, () => client.systemState())
    check(current.committee.epoch === epoch && current.committee.n_shards === nShards, 'COMMITTEE_CHANGED_BEFORE_PAYMENT')
    const validated = parseWalrusBatchManifest(manifest), manifestHash = walrusBatchJsonHash(validated)
    let privateRecovery: WalrusBatchProtection | null = null
    if (secrets.length) {
      rawSecrets = utf8.encode(JSON.stringify({ schema: 'soulidity.walrus-batch-private.v1', manifestHash, materials: secrets }))
      const callbackInput = new Uint8Array(rawSecrets)
      try {
        const wrapped = await walrusBatchStep(scope, life, signal => protector!.protect({ manifest: structuredClone(validated),
          contextHash: manifestHash, plaintext: callbackInput, signal }), value => value.fill(0))
        try { privateRecovery = { contextHash: manifestHash, encrypted: toBase64(wrapped) } } finally { wrapped.fill(0) }
      } finally { callbackInput.fill(0) }
      await walrusBatchStep(scope, life, signal => protector!.verify({ manifest: structuredClone(validated), protection: { ...privateRecovery! }, signal }))
    }
    const result = parseWalrusBatchPreparation({ schema: 'soulidity.walrus-batch-preparation.v1', manifest: validated, manifestHash, payloads, privateRecovery })
    return result
  } finally {
    rawSecrets?.fill(0)
    for (const entry of secrets) { entry.material.dek = ''; entry.material.iv = '' }
    // parse returns independent buffers. Keep no second durable-source copy.
    for (const bytes of payloads) bytes.fill(0)
  }
}
/** Caller performs one explicit Seal unlock. The returned keys are transient;
 * decoding never re-encrypts payloads and cannot authorize payment or minting. */
export async function unlockWalrusBatchMaterials(params: {
  preparation: WalrusBatchPreparation; lifetime: WalrusBatchLifetime
  unlock: (input: { manifest: WalrusBatchManifest; protection: WalrusBatchProtection; signal: AbortSignal }) => Promise<Uint8Array>
}): Promise<Array<{ index: number; material: PendingSealMaterial }>> {
  const p = parseWalrusBatchPreparation(params.preparation), scope = p.manifest.scope, life = { ...params.lifetime }, unlock = params.unlock
  check(p.privateRecovery, 'NO_PRIVATE_MATERIAL')
  const raw = await walrusBatchStep(scope, life, signal => unlock({ manifest: structuredClone(p.manifest), protection: { ...p.privateRecovery! }, signal }), value => value.fill(0))
  const result: Array<{ index: number; material: PendingSealMaterial }> = []
  try {
    check(raw.length <= 4 * 1024 * 1024, 'PRIVATE_MATERIAL_BUDGET')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw), value = JSON.parse(text)
    walrusBatchKeys(value, ['schema', 'manifestHash', 'materials'])
    const expected = p.manifest.files.filter(file => file.uploadType === 'encrypted')
    check(text === JSON.stringify(value) && value.schema === 'soulidity.walrus-batch-private.v1' && value.manifestHash === p.manifestHash
      && Array.isArray(value.materials) && value.materials.length === expected.length, 'PRIVATE_MATERIAL_BINDING')
    for (const [position, entry] of (value.materials as Array<{ index: number; material: PendingSealMaterial }>).entries()) {
      walrusBatchKeys(entry, ['index', 'material'])
      const file = expected[position], m = entry.material
      walrusBatchKeys(m, ['version', 'dek', 'iv', 'contentHash', 'mimeType', 'fileName'])
      check(entry.index === file.index && m.version === 1 && m.contentHash === file.contentHash && m.mimeType === file.mimeType
        && m.fileName === file.fileName, 'PRIVATE_FILE_BINDING')
      let dek: Uint8Array | undefined, iv: Uint8Array | undefined, plaintext: Uint8Array | undefined
      try {
        dek = walrusBatchBase64(m.dek, 32); iv = walrusBatchBase64(m.iv, 12)
        check(dek.length === 32 && iv.length === 12, 'PRIVATE_KEY_INVALID')
        const key = await walrusBatchStep(scope, life, () => crypto.subtle.importKey('raw', new Uint8Array(dek!), 'AES-GCM', false, ['decrypt']))
        plaintext = await walrusBatchStep(scope, life, async () => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv!) }, key,
          new Uint8Array(p.payloads[file.index]))), value => value.fill(0))
        check(plaintext.length === file.plaintextByteLength && walrusBatchHash(plaintext) === file.contentHash, 'PRIVATE_SOURCE_MISMATCH')
        result.push({ index: entry.index, material: { ...m } })
      } finally { dek?.fill(0); iv?.fill(0); plaintext?.fill(0) }
    }
    return result
  } catch (error) {
    for (const entry of result) { entry.material.dek = ''; entry.material.iv = '' }
    throw error
  } finally { raw.fill(0); p.payloads.forEach(bytes => bytes.fill(0)) }
}
