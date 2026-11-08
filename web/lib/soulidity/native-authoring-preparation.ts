import { fromBase58, toHex } from '@mysten/sui/utils'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { parseNativeCreationTarget, deriveNativeCreationContentId, nativeCreationSealNamespace,
  parseNativeCreationIntent, type NativeCreationTarget, type NativeCreationAccount } from './native-creation-transaction'
import { nativeCreationContentFromUpload } from './native-creation-envelope'
import { parseWalrusBatchPreparation, walrusBatchKeys, walrusBatchAddress, walrusBatchDigest, walrusBatchJsonHash,
  prepareWalrusBatch, assertWalrusBatchLifetime, type WalrusBatchPreparation, type WalrusBatchScope } from '../upload/walrus-batch-preparation'
import { createNativeWalrusBatchSealProtector, parseNativeBatchSealContext, verifyNativeBatchEnvelopes,
  verifyNativeBatchProtection, type NativeBatchSealContext, type NativeBatchEnvelope } from '../upload/native-walrus-batch-seal'
import type { ContentAppendCryptoWallet } from './content-append-preparation'
import type { BrowserContentSealConfig } from './browser-content-open'

export interface NativeAuthoringRequest {
  schema: 'soulidity.native-authoring-request.v1'
  target: NativeCreationTarget
  release: { chainIdentifier: string; nativeCallableDigest: string; custodyCallableDigest: string; blobBaseUrl: string }
  author: string; operationId: string; mintNonce: string; contentId: string; storageEpochs: number
  account: NativeCreationAccount
  name: string; description: string; royaltyBps: number
  image: { kind: 'URL'; url: string } | { kind: 'FILE'; fileIndex: number }
  configuration: { key: string; value: number[] }[]
  slots: { fileIndex: number; kind: number; name: string; nonce: string; readMask: string; downloadPolicy: number; setActive: boolean }[]
}
export interface NativeAuthoringPreparation {
  schema: 'soulidity.native-authoring-preparation.v1'
  request: NativeAuthoringRequest
  context: NativeBatchSealContext
  preparation: WalrusBatchPreparation
  envelopes: NativeBatchEnvelope[]
}
function check(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(`NATIVE_AUTHORING_${code}`) }
function text(value: unknown, max: number, required = false): asserts value is string {
  check(typeof value === 'string' && (!required || value.trim().length > 0) && new TextEncoder().encode(value).length <= max
    && new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(value)) === value, 'TEXT')
}
export function parseNativeAuthoringRequest(input: unknown): NativeAuthoringRequest {
  const r = structuredClone(input) as NativeAuthoringRequest
  walrusBatchKeys(r, ['schema', 'target', 'release', 'author', 'operationId', 'mintNonce', 'contentId', 'storageEpochs', 'account', 'name', 'description', 'royaltyBps', 'image', 'configuration', 'slots'])
  check(r.schema === 'soulidity.native-authoring-request.v1', 'SCHEMA')
  r.target = parseNativeCreationTarget(r.target)
  walrusBatchKeys(r.release, ['chainIdentifier', 'nativeCallableDigest', 'custodyCallableDigest', 'blobBaseUrl'])
  check(r.release.chainIdentifier === toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4))
    && walrusBatchDigest(r.release.nativeCallableDigest) && walrusBatchDigest(r.release.custodyCallableDigest), 'RELEASE')
  const url = new URL(r.release.blobBaseUrl)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !r.release.blobBaseUrl.endsWith('/'), 'BLOB_BASE')
  check(walrusBatchAddress(r.author) && /^[0-9a-f]{32}$/.test(r.operationId)
    && r.contentId === deriveNativeCreationContentId(r.target, r.author, r.mintNonce)
    && Number.isInteger(r.storageEpochs) && r.storageEpochs > 0 && r.storageEpochs <= 4294967295, 'IDENTITY')
  check(r.account?.kind === 'NEW' || r.account?.kind === 'EXISTING', 'ACCOUNT')
  walrusBatchKeys(r.account, r.account.kind === 'NEW' ? ['kind'] : ['kind', 'kioskId', 'accountId'])
  if (r.account.kind === 'EXISTING') check(walrusBatchAddress(r.account.kioskId) && walrusBatchAddress(r.account.accountId)
    && r.account.kioskId !== r.account.accountId, 'ACCOUNT')
  text(r.name, 1024, true); text(r.description, 4096)
  check(Number.isInteger(r.royaltyBps) && r.royaltyBps >= 0 && r.royaltyBps <= 10000, 'ROYALTY')
  check(r.image?.kind === 'URL' || r.image?.kind === 'FILE', 'IMAGE')
  if (r.image.kind === 'URL') { walrusBatchKeys(r.image, ['kind', 'url']); text(r.image.url, 2048) }
  else { walrusBatchKeys(r.image, ['kind', 'fileIndex']); check(Number.isSafeInteger(r.image.fileIndex) && r.image.fileIndex >= 0 && r.image.fileIndex < 4096, 'IMAGE') }
  check(Array.isArray(r.configuration) && r.configuration.length <= 128, 'CONFIGURATION')
  for (const e of r.configuration) {
    walrusBatchKeys(e, ['key', 'value']); text(e.key, 1024, true)
    check(!e.key.startsWith('content_seal_envelope_v1:') && Array.isArray(e.value) && e.value.length <= 65536
      && e.value.every(b => Number.isInteger(b) && b >= 0 && b <= 255), 'CONFIGURATION')
  }
  check(Array.isArray(r.slots) && r.slots.length >= 2 && r.slots.length <= 128, 'SLOTS')
  const names = new Set<string>(); let previous = -1
  for (const s of r.slots) {
    walrusBatchKeys(s, ['fileIndex', 'kind', 'name', 'nonce', 'readMask', 'downloadPolicy', 'setActive'])
    nativeCreationSealNamespace(r.contentId, s.kind, s.name, s.nonce)
    check(Number.isSafeInteger(s.fileIndex) && s.fileIndex > previous && s.fileIndex < 4096
      && (r.image.kind !== 'FILE' || s.fileIndex !== r.image.fileIndex), 'FILE_MAPPING')
    const name = `${s.kind}:${s.name}`; check(!names.has(name), 'DUPLICATE_SLOT'); names.add(name); previous = s.fileIndex
    check(typeof s.readMask === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(s.readMask)
      && BigInt(s.readMask) > 0n && BigInt(s.readMask) <= 18446744073709551615n
      && Number.isInteger(s.downloadPolicy) && s.downloadPolicy >= 0 && s.downloadPolicy <= 2 && typeof s.setActive === 'boolean', 'SLOT_POLICY')
    if (s.kind === 0 || s.kind === 1) check(s.readMask === '3' && s.downloadPolicy === 0 && !s.setActive, 'FOUNDING_POLICY')
  }
  check(names.has('0:soul') && names.has('1:default'), 'FOUNDING_REQUIRED')
  return r
}
export function nativeAuthoringScope(input: NativeAuthoringRequest): WalrusBatchScope {
  const r = parseNativeAuthoringRequest(input)
  return { network: 'mainnet', owner: r.author, operationId: r.operationId, intentHash: walrusBatchJsonHash(r),
    releaseHash: walrusBatchJsonHash({ schema: r.schema, release: r.release, target: r.target }) }
}
export function nativeAuthoringStoreKey(input: NativeAuthoringRequest) {
  const r = parseNativeAuthoringRequest(input)
  return `soul-native-authoring:${r.release.chainIdentifier}:${r.target.nativeOriginalPackageId}:${r.author}`
}
export function parseNativeAuthoringPreparation(input: unknown): NativeAuthoringPreparation {
  const p = structuredClone(input) as NativeAuthoringPreparation
  walrusBatchKeys(p, ['schema', 'request', 'context', 'preparation', 'envelopes'])
  check(p.schema === 'soulidity.native-authoring-preparation.v1', 'PREPARATION_SCHEMA')
  p.request = parseNativeAuthoringRequest(p.request); p.context = parseNativeBatchSealContext(p.context)
  p.preparation = parseWalrusBatchPreparation(p.preparation)
  const r = p.request, c = p.context, scope = nativeAuthoringScope(r), hash = walrusBatchJsonHash
  check(hash(scope) === hash(p.preparation.manifest.scope) && hash(scope) === hash(c.scope)
    && c.nativeOriginalPackageId === r.target.nativeOriginalPackageId && c.nativeCallablePackageId === r.target.nativeCallablePackageId
    && c.contentId === r.contentId && hash(c.slots) === hash(r.slots.map(({ fileIndex, kind, name, nonce }) => ({ fileIndex, kind, name, nonce })))
    && p.preparation.manifest.storageEpochs === r.storageEpochs, 'PREPARATION_BINDING')
  check(p.preparation.privateRecovery, 'PRIVATE_RECOVERY')
  verifyNativeBatchProtection(c, p.preparation.manifest, p.preparation.privateRecovery)
  p.envelopes = verifyNativeBatchEnvelopes(c, p.preparation.manifest, p.envelopes)
  const publicFiles = p.preparation.manifest.files.filter(f => f.uploadType === 'public')
  check(r.image.kind === 'URL' ? publicFiles.length === 0 : publicFiles.length === 1 && publicFiles[0].index === r.image.fileIndex
    && publicFiles[0].recipient === r.author, 'IMAGE_MAPPING')
  return p
}
export function nativeAuthoringPreparationHash(p: NativeAuthoringPreparation) {
  const value = parseNativeAuthoringPreparation(p)
  return walrusBatchJsonHash({ ...value, preparation: { schema: value.preparation.schema,
    manifestHash: value.preparation.manifestHash, privateRecovery: value.preparation.privateRecovery } })
}
export interface NativeAuthoringStore {
  exclusive<T>(key: string, work: () => Promise<T>): Promise<T>
  read(key: string): Promise<NativeAuthoringPreparation | null>
  create(key: string, value: NativeAuthoringPreparation): Promise<void>
}
/** Reuses the original uploader; stores only its encrypted preparation and
 * public Native envelopes. An existing operation is read before any crypto.
 * Store implementations must atomically preserve the parent and uploader WAL. */
export async function prepareNativeAuthoring(input: {
  request: NativeAuthoringRequest; files: Parameters<typeof prepareWalrusBatch>[0]['files']
  client: Parameters<typeof prepareWalrusBatch>[0]['client']; lifetime: Parameters<typeof prepareWalrusBatch>[0]['lifetime']
  wallet: ContentAppendCryptoWallet; sealConfig: BrowserContentSealConfig; recoveryNonce: string; store: NativeAuthoringStore
}) {
  const r = parseNativeAuthoringRequest(input.request), scope = nativeAuthoringScope(r), key = nativeAuthoringStoreKey(r)
  const store = input.store, life = { ...input.lifetime }, files = input.files.map(f => ({ ...f })), client = input.client
  const wallet = { ...input.wallet }, sealConfig = structuredClone(input.sealConfig), recoveryNonce = input.recoveryNonce
  async function step<T>(run: () => Promise<T>) {
    assertWalrusBatchLifetime(scope, life); const value = await run(); assertWalrusBatchLifetime(scope, life); return value
  }
  return store.exclusive(key, async () => {
    const prior = await step(() => store.read(key))
    if (prior) {
      const saved = parseNativeAuthoringPreparation(prior)
      check(walrusBatchJsonHash(saved.request) === walrusBatchJsonHash(r), 'RESUME_ORIGINAL_OPERATION')
      return saved
    }
    const context = parseNativeBatchSealContext({ schema: 'soulidity.native-batch-seal.v1', scope,
      nativeOriginalPackageId: r.target.nativeOriginalPackageId, nativeCallablePackageId: r.target.nativeCallablePackageId,
      contentId: r.contentId, recoveryNonce, sealConfig,
      slots: r.slots.map(({ fileIndex, kind, name, nonce }) => ({ fileIndex, kind, name, nonce })) })
    const crypto = createNativeWalrusBatchSealProtector({ context, wallet, lifetime: life })
    const preparation = await step(() => prepareWalrusBatch({ scope, files, client, lifetime: life, protector: crypto.protector, storageEpochs: r.storageEpochs, persistence: 'permanent' }))
    const value = parseNativeAuthoringPreparation({ schema: 'soulidity.native-authoring-preparation.v1', request: r,
      context, preparation, envelopes: crypto.envelopes(preparation.manifestHash) })
    const hash = nativeAuthoringPreparationHash(value)
    await step(() => store.create(key, value))
    const saved = await step(() => store.read(key))
    check(saved && nativeAuthoringPreparationHash(saved) === hash, 'DURABLE_READBACK')
    return parseNativeAuthoringPreparation(saved)
  })
}
/** Pure conversion only, after the parent proves actual registration. */
export function materializeNativeAuthoring(input: NativeAuthoringPreparation, registeredBlobIds: readonly string[]) {
  const p = parseNativeAuthoringPreparation(input), r = p.request, files = p.preparation.manifest.files
  check(registeredBlobIds.length === files.length && registeredBlobIds.every(walrusBatchAddress)
    && new Set(registeredBlobIds).size === registeredBlobIds.length, 'REGISTERED_BLOBS')
  const image = r.image.kind === 'URL' ? r.image.url : `${r.release.blobBaseUrl}/v1/blobs/${files[r.image.fileIndex].encoding.blobId}`
  return parseNativeCreationIntent({ schema: 'soulidity.native-creation.v1', target: r.target, author: r.author,
    mintNonce: r.mintNonce, expectedContentId: r.contentId, account: r.account, name: r.name, description: r.description,
    image, royaltyBps: r.royaltyBps, configuration: r.configuration,
    content: r.slots.map((slot, i) => nativeCreationContentFromUpload({ file: files[slot.fileIndex],
      registeredBlobObjectId: registeredBlobIds[slot.fileIndex], envelope: p.envelopes[i].envelope,
      config: p.context.sealConfig, readMask: slot.readMask, downloadPolicy: slot.downloadPolicy, setActive: slot.setActive })) })
}
