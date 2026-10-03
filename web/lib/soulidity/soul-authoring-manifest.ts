import { fromBase58, fromHex, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { deriveMintContentObjectId, buildSoulPublicPreviewStateConfig, validateInitialContentEntries,
  validateInitialStateConfigEntries, getBuiltinKindDescriptor, assertSlotReadModeAllowed, MAX_COLLECTION_FLOOR_ATOMIC,
  type InitialContentEntryInput, type StateConfigEntryInput, type SoulDownloadPolicy } from '@soulidity/sdk'
import { parseCollectionBuyTarget, type CollectionBuyTarget } from '../collections/collection-buy-plan'
import { publicMutationCanonical as canonical } from '../sui/public-mutation-journal'
import { parseWalrusBatchPreparation, walrusBatchAddress, walrusBatchHash, walrusBatchKeys, walrusBatchPreparationHash,
  type WalrusBatchPreparation, type WalrusBatchScope } from '../upload/walrus-batch-preparation'
import { parseWalrusBatchSealContext, verifyWalrusBatchInitialSidecars, verifyWalrusBatchProtection, type WalrusBatchSealContext,
  type WalrusBatchInitialSidecar } from '../upload/walrus-batch-seal'
import type { BrowserContentSealConfig } from './browser-content-open'
import { CONTENT_ENVELOPE_SCHEMA, encodeContentEnvelope } from './content-envelope'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'

const utf8 = new TextEncoder(), MAX_U64 = 18446744073709551615n
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`SOUL_AUTHORING_${code}`) }
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const nonce = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)
function uint(value: unknown, positive = false, maximum = MAX_U64): asserts value is string {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(value) && BigInt(value) <= maximum
    && (!positive || BigInt(value) > 0n), 'INTEGER_INVALID')
}
function text(value: unknown, maximum: number, nonempty = true): asserts value is string {
  check(typeof value === 'string' && (!nonempty || value.trim().length > 0) && utf8.encode(value).length <= maximum
    && new TextDecoder('utf-8', { fatal: true }).decode(utf8.encode(value)) === value, 'TEXT_INVALID')
}
const fingerprint = (value: unknown) => walrusBatchHash(utf8.encode(canonical(value)))
export interface SoulAuthoringTarget extends CollectionBuyTarget {
  kindRegistryId: string; soulTransferPolicyId: string; blobBaseUrl: string
}
export type SoulAuthoringImage = { kind: 'FILE'; fileIndex: number } | { kind: 'URL'; url: string }
export interface SoulAuthoringSlot {
  fileIndex: number; kind: number; name: string; versionIndex: string
  readModeMask: number; downloadPolicy: SoulDownloadPolicy; setActive: boolean
}
export interface SoulAuthoringMint {
  kind: 'ORDINARY' | 'IMPORTED' | 'JOINED'
  mintNonce: string; contentObjectId: string
  name: string; description: string; creatorRoyaltyBps: number; image: SoulAuthoringImage
  originRef: string | null; source: { objectId: string; objectType: string } | null
  slots: SoulAuthoringSlot[]
  publicPreview: { tags: string[]; previewImages: SoulAuthoringImage[] }
  /** Public configuration only. Protected documents are upload slots above. */
  stateConfig: StateConfigEntryInput[]
  listingPriceAtomic: string | null
}
export interface SoulAuthoringRequest {
  schema: 'soulidity.soul-authoring-request.v1'
  target: SoulAuthoringTarget; author: string; operationId: string; storageEpochs: number
  collection: { name: string; description: string; image: SoulAuthoringImage; extraRoyaltyBps: number;
    tradeable: boolean; maxSupply: string | null; floorPriceAtomic: string | null; listingPriceAtomic: string | null } | null
  bindCollectionId: string | null
  mints: SoulAuthoringMint[]
}
export interface SoulAuthoringManifest {
  schema: 'soulidity.soul-authoring-manifest.v1'
  request: SoulAuthoringRequest
  preparationHash: string
  sealContext: WalrusBatchSealContext | null
  sidecars: WalrusBatchInitialSidecar[]
}
export function parseSoulAuthoringTarget(input: unknown): SoulAuthoringTarget {
  const t = structuredClone(input) as SoulAuthoringTarget
  walrusBatchKeys(t, ['chainIdentifier', 'originalPackageId', 'callablePackageId', 'callableDigest', 'marketConfigId',
    'kioskRegistryId', 'personalKioskTypePackageId', 'paymentCoinType', 'collectionTransferPolicyId', 'kioskPackageId',
    'kindRegistryId', 'soulTransferPolicyId', 'blobBaseUrl'])
  const { kindRegistryId, soulTransferPolicyId, blobBaseUrl, ...base } = t
  parseCollectionBuyTarget(base)
  check(t.chainIdentifier === toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)), 'TARGET_NETWORK_MISMATCH')
  check(walrusBatchAddress(kindRegistryId) && walrusBatchAddress(soulTransferPolicyId), 'TARGET_ID_INVALID')
  text(blobBaseUrl, 900)
  const url = new URL(blobBaseUrl)
  check(url.protocol === 'https:' && !url.search && !url.hash && !url.username && !url.password && !blobBaseUrl.endsWith('/'), 'BLOB_BASE_INVALID')
  buildSoulPublicPreviewStateConfig({ tags: [], previewImages: [`${blobBaseUrl}/v1/blobs/reference`] })
  return t
}
function parseImage(input: SoulAuthoringImage, sourceDisplay = false): void {
  if (input?.kind === 'FILE') {
    walrusBatchKeys(input, ['kind', 'fileIndex'])
    check(Number.isSafeInteger(input.fileIndex) && input.fileIndex >= 0 && input.fileIndex < 4096, 'IMAGE_FILE_INVALID')
  } else {
    walrusBatchKeys(input, ['kind', 'url']); check(input.kind === 'URL', 'IMAGE_KIND_INVALID')
    if (sourceDisplay) { text(input.url, 1024, false); return }
    buildSoulPublicPreviewStateConfig({ tags: [], previewImages: [input.url] })
    text(input.url, 1024)
  }
}
/** Pure, complete pre-upload intent. Blob references are file indices until the
 * original registration is proved; no SQL IDs, functions, Files or raw keys. */
export function parseSoulAuthoringRequest(input: unknown): SoulAuthoringRequest {
  const r = structuredClone(input) as SoulAuthoringRequest
  walrusBatchKeys(r, ['schema', 'target', 'author', 'operationId', 'storageEpochs', 'collection', 'bindCollectionId', 'mints'])
  check(r.schema === 'soulidity.soul-authoring-request.v1' && walrusBatchAddress(r.author) && nonce(r.operationId)
    && Number.isInteger(r.storageEpochs) && r.storageEpochs > 0 && r.storageEpochs <= 0xffffffff
    && Array.isArray(r.mints) && r.mints.length <= 1000, 'REQUEST_INVALID')
  r.target = parseSoulAuthoringTarget(r.target)
  if (r.bindCollectionId !== null) check(walrusBatchAddress(r.bindCollectionId), 'BIND_ID_INVALID')
  if (r.collection !== null) {
    const c = r.collection
    walrusBatchKeys(c, ['name', 'description', 'image', 'extraRoyaltyBps', 'tradeable', 'maxSupply', 'floorPriceAtomic', 'listingPriceAtomic'])
    text(c.name, 256); text(c.description, 4096); parseImage(c.image)
    check(r.bindCollectionId === null && Number.isInteger(c.extraRoyaltyBps) && c.extraRoyaltyBps >= 0
      && c.extraRoyaltyBps <= 2500 && typeof c.tradeable === 'boolean', 'COLLECTION_INVALID')
    if (c.maxSupply !== null) { uint(c.maxSupply, true, 1000000n); check(BigInt(r.mints.length) <= BigInt(c.maxSupply), 'SUPPLY_EXCEEDED') }
    if (c.floorPriceAtomic !== null) uint(c.floorPriceAtomic, false, MAX_COLLECTION_FLOOR_ATOMIC)
    if (c.listingPriceAtomic !== null) { uint(c.listingPriceAtomic, true); check(c.tradeable, 'NONTRADEABLE_LISTING') }
  } else check(r.mints.length === 1, 'SINGLE_MINT_REQUIRED')
  const contentIds = new Set<string>(), consumedFiles = new Set<number>(), externalSources = new Set<string>()
  for (const mint of r.mints) {
    walrusBatchKeys(mint, ['kind', 'mintNonce', 'contentObjectId', 'name', 'description', 'creatorRoyaltyBps', 'image',
      'originRef', 'source', 'slots', 'publicPreview', 'stateConfig', 'listingPriceAtomic'])
    check(['ORDINARY', 'IMPORTED', 'JOINED'].includes(mint.kind) && (!r.collection || mint.kind === 'ORDINARY')
      && nonce(mint.mintNonce) && walrusBatchAddress(mint.contentObjectId) && !contentIds.has(mint.contentObjectId), 'MINT_ID_INVALID')
    check(deriveMintContentObjectId({ kioskRegistryId: r.target.kioskRegistryId, originalPackageId: r.target.originalPackageId,
      author: r.author, mintNonce: fromHex(mint.mintNonce) }) === mint.contentObjectId, 'DERIVED_CONTENT_ID_MISMATCH')
    contentIds.add(mint.contentObjectId)
    text(mint.name, 256); text(mint.description, 4096, mint.kind !== 'JOINED'); parseImage(mint.image, mint.kind === 'JOINED')
    check(Number.isInteger(mint.creatorRoyaltyBps) && mint.creatorRoyaltyBps >= 0 && mint.creatorRoyaltyBps <= 2500, 'ROYALTY_INVALID')
    if (mint.kind === 'ORDINARY') check(mint.originRef === null && mint.source === null, 'ORDINARY_SOURCE_INVALID')
    else {
      text(mint.originRef, 4096)
      if (mint.kind === 'IMPORTED') check(mint.source === null, 'IMPORT_SOURCE_INVALID')
      else {
        walrusBatchKeys(mint.source, ['objectId', 'objectType'])
        check(walrusBatchAddress(mint.source.objectId) && typeof mint.source.objectType === 'string'
          && mint.source.objectType === normalizeStructTag(mint.source.objectType) && !externalSources.has(mint.source.objectId), 'JOIN_SOURCE_INVALID')
        externalSources.add(mint.source.objectId)
      }
    }
    if (mint.listingPriceAtomic !== null) uint(mint.listingPriceAtomic, true)
    check(Array.isArray(mint.slots) && mint.slots.length >= 2 && mint.slots.length <= 256, 'SLOTS_REQUIRED')
    const versions = new Map<string, bigint>(); let soulCount = 0, memoryCount = 0
    for (const slot of mint.slots) {
      walrusBatchKeys(slot, ['fileIndex', 'kind', 'name', 'versionIndex', 'readModeMask', 'downloadPolicy', 'setActive'])
      check(Number.isSafeInteger(slot.fileIndex) && slot.fileIndex >= 0 && slot.fileIndex < 4096 && !consumedFiles.has(slot.fileIndex)
        && Number.isInteger(slot.kind) && slot.kind >= 0 && slot.kind <= 0xffffffff && typeof slot.name === 'string'
        && /^[a-z0-9_-]{1,32}$/.test(slot.name) && Number.isSafeInteger(slot.readModeMask) && slot.readModeMask > 0
        && slot.readModeMask <= 15 && typeof slot.setActive === 'boolean' && ['public', 'owner_only', 'allowlist'].includes(slot.downloadPolicy), 'SLOT_INVALID')
      consumedFiles.add(slot.fileIndex); uint(slot.versionIndex)
      const key = `${slot.kind}:${slot.name}`, version = versions.get(key) ?? 0n
      check(BigInt(slot.versionIndex) === version, 'INITIAL_VERSION_GAP'); versions.set(key, version + 1n)
      if (slot.kind === 0 || slot.kind === 1) {
        check(slot.name === (slot.kind === 0 ? 'soul' : 'default') && slot.readModeMask === 3
          && slot.downloadPolicy === 'public' && !slot.setActive, 'INITIAL_INVARIANT_INVALID')
        if (slot.kind === 0) soulCount++; else memoryCount++
      } else {
        const descriptor = getBuiltinKindDescriptor(slot.kind)
        if (descriptor) {
          check((descriptor.opMask & 1) !== 0 && (!slot.setActive || descriptor.hasActiveBinding), 'KIND_APPEND_OR_ACTIVE_INVALID')
          assertSlotReadModeAllowed({ readModeMask: slot.readModeMask, kindReadModeMask: descriptor.readModeMask, downloadPolicy: slot.downloadPolicy })
          check(descriptor.requiresDownloadPolicy || slot.downloadPolicy === 'public', 'KIND_POLICY_INVALID')
        }
      }
    }
    check(soulCount === 1 && memoryCount >= 1, 'INITIAL_CONTENT_INCOMPLETE')
    walrusBatchKeys(mint.publicPreview, ['tags', 'previewImages'])
    check(Array.isArray(mint.publicPreview.tags) && Array.isArray(mint.publicPreview.previewImages)
      && mint.publicPreview.previewImages.length <= 8, 'PREVIEW_INVALID')
    const normalized = buildSoulPublicPreviewStateConfig({ tags: mint.publicPreview.tags, previewImages: [] })
    check(canonical(JSON.parse(normalized.valueUtf8).tags) === canonical(mint.publicPreview.tags), 'TAGS_NOT_NORMALIZED')
    mint.publicPreview.previewImages.forEach(image => parseImage(image))
    check(Array.isArray(mint.stateConfig) && mint.stateConfig.length <= 32, 'CONFIG_INVALID')
    mint.stateConfig.forEach(entry => { walrusBatchKeys(entry, ['key', 'valueUtf8']); text(entry.key, 256); text(entry.valueUtf8, 65536, false)
      check(entry.key !== 'soul_public_preview_v1', 'PREVIEW_CONFIG_DUPLICATE') })
    validateInitialStateConfigEntries(mint.stateConfig)
  }
  for (const id of externalSources) check(!contentIds.has(id), 'SOURCE_CONTENT_ALIAS')
  check(utf8.encode(canonical(r)).length <= 8 * 1024 * 1024, 'REQUEST_BUDGET')
  return r
}
export const soulAuthoringRequestHash = (input: SoulAuthoringRequest) => fingerprint(parseSoulAuthoringRequest(input))
export function soulAuthoringUploadScope(input: SoulAuthoringRequest): WalrusBatchScope {
  const r = parseSoulAuthoringRequest(input)
  return { network: 'mainnet', owner: r.author, releaseHash: fingerprint(r.target), operationId: r.operationId,
    intentHash: fingerprint(r) }
}
export function soulAuthoringSealContext(input: SoulAuthoringRequest, sealConfig: BrowserContentSealConfig, recoveryNonce: string) {
  const request = parseSoulAuthoringRequest(input)
  return parseWalrusBatchSealContext({ schema: 'soulidity.walrus-batch-seal.v1', scope: soulAuthoringUploadScope(request),
    originalPackageId: request.target.originalPackageId, callablePackageId: request.target.callablePackageId, sealConfig, recoveryNonce,
    slots: request.mints.flatMap(mint => mint.slots.map(slot => ({ fileIndex: slot.fileIndex, contentObjectId: mint.contentObjectId,
      kind: slot.kind, name: slot.name, versionIndex: slot.versionIndex }))).sort((a, b) => a.fileIndex - b.fileIndex) })
}
export function resolveSoulAuthoringImage(reference: SoulAuthoringImage, request: SoulAuthoringRequest, preparation: Pick<WalrusBatchPreparation, 'manifest'>) {
  parseImage(reference, reference.kind === 'URL' && request.mints.some(mint =>
    mint.kind === 'JOINED' && mint.image.kind === 'URL' && mint.image.url === reference.url))
  if (reference.kind === 'URL') return reference.url
  const file = preparation.manifest.files[reference.fileIndex]
  check(file && file.uploadType === 'public', 'PRIVATE_IMAGE_REFERENCE')
  return `${request.target.blobBaseUrl}/v1/blobs/${encodeURIComponent(file.encoding.blobId)}`
}
/** Cross-validates request, encrypted upload, every initial slot and public
 * sidecar. This does not itself prove that any transaction was signed/mined. */
export function validateSoulAuthoringManifest(input: unknown, uploadInput: WalrusBatchPreparation): SoulAuthoringManifest {
  const m = structuredClone(input) as SoulAuthoringManifest, preparation = parseWalrusBatchPreparation(uploadInput)
  walrusBatchKeys(m, ['schema', 'request', 'preparationHash', 'sealContext', 'sidecars'])
  check(m.schema === 'soulidity.soul-authoring-manifest.v1' && hash(m.preparationHash), 'MANIFEST_INVALID')
  m.request = parseSoulAuthoringRequest(m.request)
  check(canonical(soulAuthoringUploadScope(m.request)) === canonical(preparation.manifest.scope)
    && m.request.storageEpochs === preparation.manifest.storageEpochs
    && m.preparationHash === walrusBatchPreparationHash(preparation), 'UPLOAD_COMMITMENT_MISMATCH')
  const used = new Set<number>()
  const image = (ref: SoulAuthoringImage) => { resolveSoulAuthoringImage(ref, m.request, preparation); if (ref.kind === 'FILE') used.add(ref.fileIndex) }
  if (m.request.collection) image(m.request.collection.image)
  m.request.mints.forEach(mint => { image(mint.image); mint.publicPreview.previewImages.forEach(image); mint.slots.forEach(slot => used.add(slot.fileIndex)) })
  check(used.size === preparation.manifest.files.length && preparation.manifest.files.every(file => used.has(file.index)
    && file.recipient === m.request.author), 'UNMAPPED_UPLOAD_OR_RECIPIENT')
  if (m.request.mints.length === 0) check(m.sealContext === null && Array.isArray(m.sidecars) && m.sidecars.length === 0 && !preparation.privateRecovery, 'EMPTY_COLLECTION_PRIVATE_DATA')
  else {
    check(m.sealContext, 'SEAL_CONTEXT_REQUIRED')
    const expected = soulAuthoringSealContext(m.request, m.sealContext.sealConfig, m.sealContext.recoveryNonce)
    check(canonical(expected) === canonical(m.sealContext), 'SEAL_CONTEXT_MISMATCH')
    check(preparation.privateRecovery, 'PRIVATE_RECOVERY_REQUIRED')
    verifyWalrusBatchProtection(expected, preparation.manifest, preparation.privateRecovery)
    m.sidecars = [...verifyWalrusBatchInitialSidecars(expected, preparation.manifest, m.sidecars)]
    m.sealContext = expected
  }
  return m
}
export const soulAuthoringManifestHash = (input: SoulAuthoringManifest, preparation: WalrusBatchPreparation) =>
  fingerprint(validateSoulAuthoringManifest(input, preparation))

/** Supplied Blob IDs must come from the parent historical registration proof.
 * This pure conversion neither accepts a digest hint nor queries current Blob
 * ownership as a substitute for that proof. */
export function materializeSoulAuthoringMint(manifestInput: SoulAuthoringManifest, preparation: WalrusBatchPreparation,
  mintIndex: number, registeredBlobIds: readonly string[]) {
  return createSoulAuthoringMaterializer(manifestInput, preparation, registeredBlobIds)(mintIndex)
}
/** Validate/hash the large upload only once per batch. The returned converter
 * retains public metadata, not hundreds of MB of ciphertext, and snapshots all
 * caller-owned inputs. Registration history is still the parent's obligation. */
export function createSoulAuthoringMaterializer(manifestInput: SoulAuthoringManifest, preparation: WalrusBatchPreparation,
  registeredBlobIds: readonly string[]) {
  const manifest = validateSoulAuthoringManifest(manifestInput, preparation)
  const metadata = { manifest: structuredClone(preparation.manifest) }, blobIds = [...registeredBlobIds]
  check(blobIds.length === metadata.manifest.files.length
    && blobIds.every(walrusBatchAddress) && new Set(blobIds).size === blobIds.length, 'REGISTERED_BLOBS_INVALID')
  return (mintIndex: number) => materializeValidatedMint(manifest, metadata, mintIndex, blobIds)
}
function materializeValidatedMint(manifest: SoulAuthoringManifest, preparation: Pick<WalrusBatchPreparation, 'manifest'>,
  mintIndex: number, registeredBlobIds: readonly string[]) {
  const r = manifest.request, mint = r.mints[mintIndex]
  check(Number.isSafeInteger(mintIndex) && mint && registeredBlobIds.length === preparation.manifest.files.length
    && registeredBlobIds.every(walrusBatchAddress) && new Set(registeredBlobIds).size === registeredBlobIds.length, 'REGISTERED_BLOBS_INVALID')
  const sidecars = new Map(manifest.sidecars.map(row => [row.fileIndex, row.sidecar]))
  const initialContent: InitialContentEntryInput[] = mint.slots.map(slot => {
    const blobObjectId = registeredBlobIds[slot.fileIndex], sidecar = sidecars.get(slot.fileIndex)
    check(sidecar, 'INITIAL_SIDECAR_REQUIRED')
    return { kind: slot.kind, name: slot.name, slotReadModeMask: slot.readModeMask, downloadPolicy: slot.downloadPolicy,
      setActive: slot.setActive, blobObjectId, expectedVersionIndex: slot.versionIndex,
      encryptedEnvelope: utf8.encode(encodeContentEnvelope({ schema: CONTENT_ENVELOPE_SCHEMA, contentObjectId: mint.contentObjectId,
        kind: slot.kind, name: slot.name, versionIndex: slot.versionIndex, blobObjectId, sidecar }, r.target.originalPackageId)) }
  })
  const initialStateConfig = [buildSoulPublicPreviewStateConfig({ tags: mint.publicPreview.tags,
    previewImages: mint.publicPreview.previewImages.map(ref => resolveSoulAuthoringImage(ref, r, preparation)) }), ...mint.stateConfig]
  validateInitialContentEntries(initialContent); validateInitialStateConfigEntries(initialStateConfig)
  return { name: mint.name, description: mint.description, creatorRoyaltyBps: mint.creatorRoyaltyBps,
    imageUrl: resolveSoulAuthoringImage(mint.image, r, preparation), mintNonce: fromHex(mint.mintNonce), expectedContentObjectId: mint.contentObjectId,
    initialContent, initialStateConfig: structuredClone(initialStateConfig) }
}
