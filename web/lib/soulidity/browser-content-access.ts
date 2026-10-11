import { bcs } from '@mysten/sui/bcs'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, fromBase58, normalizeStructTag, toBase64, toHex } from '@mysten/sui/utils'
import { WalrusClient } from '@mysten/walrus'
import { ProfileWalrusBlobBcs, profileReadStep, readSoulDetailState, readSoulPublicSnapshotBySoulId,
  type SealEnvelopeSidecar, type SoulDetailStateSnapshot } from '@soulidity/sdk'
import { createBrowserNativeReadSession } from '@/lib/animacraft/browser-native-artwork'
import { getBrowserNativeReceiveTarget } from '@/lib/animacraft/browser-native-config'
import { MAINNET_GENESIS_DIGEST } from '@/lib/animacraft/mainnet-chain'
import { attestNativeReceiveTarget, createNativeReceiveClient, readNativeReceiveTarget, receiveId, type NativeReceiveTarget } from '@/lib/animacraft/native-receive'
import { contentEnvelopeKey, decodeContentEnvelope } from './content-envelope'

export const BROWSER_CONTENT_MAX_BYTES = 64 * 1024 * 1024
export interface BrowserContentAccessConfig {
  target: NativeReceiveTarget; kindRegistryId: string
  storage: { blobType: string; aggregatorUrl: string }
}
export interface BrowserContentAccess {
  visibility: 'sealed'; soulId: string; stateId: string; contentId: string; kind: number; kindName: string; name: string
  versionIndex: string; owner: string; ownershipEpoch: string; viewerAddress: string | null
  accessKind: 'owner' | 'granted-agent' | 'paid' | 'public'
  slot: { readModeMask: string; opMask: string; grantScopeMask: string; downloadPolicy: 'public' | 'owner_only' | 'allowlist' }
  artifact: { walrusBlobUrl: string; walrusBlobId: string; blobObjectId: string; byteLength: string; endEpoch: number }
  accessPolicy: { packageId: string; sealPackageId: string; callablePackageId: string; stateObjectId: string; contentObjectId: string
    kind: number; name: string; versionIndex: string; moduleName: 'content' | 'paid_access'
    functionName: 'seal_approve_content_owner' | 'seal_approve_content_granted_agent' | 'seal_approve_content_paid_access' | 'seal_approve_content_public'
    soulGrantObjectId: string | null; paidAccessListOnChainId: string | null; documentIdHex: string }
  sealSidecar: SealEnvelopeSidecar & { sealPackageId: string }
}
export interface BrowserContentAccessResult { access: Readonly<BrowserContentAccess>; recheck: () => Promise<void> }
function check(value: unknown, code: string): asserts value { if (!value) throw new Error(`BROWSER_CONTENT_${code}`) }
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
function exact(value: unknown, keys: string[]) { check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), 'INVALID_FIELDS') }
function configOf(input: BrowserContentAccessConfig): BrowserContentAccessConfig {
  const value = structuredClone(input); exact(value, ['target', 'kindRegistryId', 'storage']); exact(value.storage, ['blobType', 'aggregatorUrl'])
  const pin = value.target, target = readNativeReceiveTarget({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: pin?.soulidityCallablePackageId, NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: pin?.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(pin) })
  receiveId(value.kindRegistryId)
  check(typeof value.storage.blobType === 'string' && /^0x[0-9a-f]{64}::blob::Blob$/.test(value.storage.blobType), 'BLOB_TYPE_INVALID')
  receiveId(value.storage.blobType.split('::')[0])
  check(typeof value.storage.aggregatorUrl === 'string' && value.storage.aggregatorUrl.length <= 2048, 'STORAGE_URL_INVALID')
  const url = new URL(value.storage.aggregatorUrl)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.hostname !== 'localhost' && !url.hostname.endsWith('.localhost') && !url.hostname.endsWith('.')
    && !/^\d+(?:\.\d+){3}$/.test(url.hostname) && !url.hostname.includes(':'), 'STORAGE_URL_INVALID')
  return freeze({ target, kindRegistryId: value.kindRegistryId, storage: { blobType: value.storage.blobType, aggregatorUrl: url.href.replace(/\/+$/, '') } })
}
export function getBrowserContentAccessConfig(): BrowserContentAccessConfig {
  return configOf({ target: getBrowserNativeReceiveTarget(), kindRegistryId: process.env.NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID!,
    storage: { blobType: process.env.NEXT_PUBLIC_WALRUS_BLOB_TYPE!, aggregatorUrl: process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL! } })
}
const BlobKey = bcs.struct('ContentBlobKey', { kind: bcs.u32(), name: bcs.string(), version_index: bcs.u64() })
const WrappedBlobKey = bcs.struct('Wrapper', { name: BlobKey })
const BlobField = bcs.struct('Field', { id: bcs.Address, name: WrappedBlobKey, value: bcs.Address })
const CLOCK = `0x${'0'.repeat(63)}6`
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Browser authority from the immutable Soul pointer and current raw tables.
 * Current Move slots are always Seal-encrypted, including READ_PUBLIC slots.
 * No market gate, SQL projection, or caller-supplied slot is authority here. */
export async function readBrowserContentAccess(params: {
  soulId: string; stateId: string; contentId: string; kind: number; name: string; versionIndex: string
  viewerAddress: string | null; config: BrowserContentAccessConfig; signal?: AbortSignal
}, dependencies: { client?: (signal: AbortSignal) => SuiGrpcClient } = {}): Promise<BrowserContentAccessResult> {
  const p = structuredClone({ soulId: params.soulId, stateId: params.stateId, contentId: params.contentId, kind: params.kind,
    name: params.name, versionIndex: params.versionIndex, viewerAddress: params.viewerAddress }), config = configOf(params.config)
  for (const id of [p.soulId, p.stateId, p.contentId]) receiveId(id)
  if (p.viewerAddress !== null) receiveId(p.viewerAddress)
  check(new Set([p.soulId, p.stateId, p.contentId]).size === 3, 'OBJECT_ALIAS')
  check(Number.isInteger(p.kind) && p.kind >= 0 && p.kind <= 0xffff_ffff && typeof p.name === 'string'
    && /^[a-z0-9_-]{1,32}$/.test(p.name) && (p.kind !== 0 || p.name === 'soul') && (p.kind !== 1 || p.name === 'default'), 'SLOT_IDENTITY_INVALID')
  check(typeof p.versionIndex === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(p.versionIndex)
    && BigInt(p.versionIndex) <= 18446744073709551615n, 'VERSION_INVALID')
  const lifetime = new AbortController(), signal = params.signal ? AbortSignal.any([params.signal, lifetime.signal]) : lifetime.signal
  signal.throwIfAborted()
  const original = (dependencies.client ?? createNativeReceiveClient)(signal), session = createBrowserNativeReadSession(original, signal)
  // Clock ticks are not business-state mutations. Only this exact single-object
  // read bypasses the byte-stable session; readSoulDetailState validates its BCS
  // and every recheck reevaluates grants/paid expiry against the fresh chain time.
  const ledger = new Proxy(session.client.ledgerService, { get(target, key) {
    const member = Reflect.get(target, key, target)
    if (key !== 'getObject' && key !== 'batchGetObjects') return typeof member === 'function' ? member.bind(target) : member
    return (request: any, options?: any) => {
      const clock = key === 'getObject' ? request.objectId === CLOCK : request.requests?.length === 1 && request.requests[0].objectId === CLOCK
      const source = clock ? original.ledgerService : target
      return Reflect.apply(Reflect.get(source, key, source), source, [request, { ...options, abort: signal }])
    }
  } })
  const client = new Proxy(session.client, { get(target, key) { return key === 'ledgerService' ? ledger : Reflect.get(target, key, target) } })
  const walrus = new WalrusClient({ suiClient: original, network: 'mainnet' })
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted(); const deadline = AbortSignal.any([signal, AbortSignal.timeout(45000)])
    try { return await profileReadStep(deadline, work) }
    catch (error) { lifetime.abort(error); throw error }
  }
  const pkg = config.target.soulidityOriginalPackageId, deployment = { originalPackageId: pkg,
    chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)) }
  const asset = await run(async () => {
    const types = await attestNativeReceiveTarget(client, config.target)
    check(types.stateType === `${pkg}::soul::SoulState` && types.contentObjectType === `${pkg}::content::SoulContent`
      && types.soulType === `${pkg}::soul::Soul`, 'RELEASE_TYPE_ORIGIN_MISMATCH')
    const value = await readSoulPublicSnapshotBySoulId({ client, deployment, soulId: p.soulId, signal })
    check(value.stateId === p.stateId && value.contentId === p.contentId, 'SOUL_POINTER_MISMATCH'); return value
  })
  const detail = () => readSoulDetailState({ client, deployment: { ...deployment, kindRegistryId: config.kindRegistryId }, stateId: p.stateId,
    expectedState: { version: asset.stateVersion, digest: asset.stateDigest }, viewerAddresses: p.viewerAddress === null ? [] : [p.viewerAddress], signal })
  function authority(state: SoulDetailStateSnapshot) {
    check(state.soulId === p.soulId && state.contentId === p.contentId, 'CONTENT_BINDING_MISMATCH')
    const version = state.contentVersions.find(v => v.kind === p.kind && v.name === p.name && v.versionIndex === p.versionIndex)
    check(version, 'VERSION_NOT_FOUND'); const slot = version.slot
    check(!slot.deleted && !slot.purged, 'VERSION_DELETED_OR_PURGED'); check(slot.seal_encrypted, 'CURRENT_SCHEMA_REQUIRES_SEAL')
    const mask = BigInt(slot.read_mode_mask), scope = BigInt(slot.grant_scope_mask)
    let accessKind: BrowserContentAccess['accessKind'], grantId: string | null = null
    if (p.viewerAddress === state.currentOwner && (mask & 1n)) accessKind = 'owner'
    else {
      const grant = mask & 2n && scope ? state.grants.find(g => g.currentEpoch && g.unexpiredAtObservation
        && g.grant && g.slot.grantee === p.viewerAddress && (BigInt(g.slot.scope_mask) & scope) === scope) : null
      const paid = mask & 4n && scope ? state.paidAccessEntries.find(e => e.currentEpoch && e.unexpiredAtObservation
        && e.buyerAddress === p.viewerAddress && e.kind === p.kind && (BigInt(e.entry.scope_mask) & scope) === scope) : null
      if (grant) { accessKind = 'granted-agent'; grantId = grant.slot.grant_id }
      else if (paid) accessKind = 'paid'
      else { check(mask & 8n, 'ACCESS_DENIED'); accessKind = 'public' }
    }
    const identity = { contentObjectId: p.contentId, kind: p.kind, name: p.name, versionIndex: p.versionIndex, blobObjectId: slot.blob_object_id }
    const envelope = state.config.find(c => c.key === contentEnvelopeKey(identity))
    check(envelope?.valueUtf8, 'ENVELOPE_MISSING')
    const sidecar = decodeContentEnvelope(envelope.valueUtf8, identity, pkg).sidecar
    return { version, slot, accessKind, grantId, sidecar }
  }
  async function blob(blobObjectId: string) {
    walrus.reset(); const blobType = await walrus.getBlobType(), system = await walrus.systemState(), epoch = system.committee.epoch
    check(blobType === config.storage.blobType && Number.isInteger(epoch) && epoch >= 0 && epoch <= 0xffff_ffff, 'WALRUS_STATE_MISMATCH')
    const wrapped = { name: { kind: p.kind, name: p.name, version_index: p.versionIndex } }
    const keyType = `0x2::dynamic_object_field::Wrapper<${pkg}::content::ContentBlobKey>`
    const fieldId = deriveDynamicFieldID(p.contentId, keyType, WrappedBlobKey.serialize(wrapped).toBytes())
    const read = async (id: string, type: string, parent: string, max: number) => {
      const { response } = await client.ledgerService.getObject({ objectId: id })
      const raw = response.object
      check(raw?.objectId === id && raw.objectType === normalizeStructTag(type) && raw.owner?.kind === 2 && raw.owner.address === parent
        && raw.contents?.value instanceof Uint8Array && raw.contents.value.length > 0 && raw.contents.value.length <= max, 'BLOB_CONTAINMENT_MISMATCH')
      return raw.contents.value
    }
    const fieldBytes = await read(fieldId, `0x2::dynamic_field::Field<${keyType},0x2::object::ID>`, p.contentId, 512)
    const field = BlobField.parse(fieldBytes)
    check(toBase64(BlobField.serialize(field).toBytes()) === toBase64(fieldBytes) && field.id === fieldId
      && same(field.name, wrapped) && field.value === blobObjectId, 'BLOB_FIELD_MISMATCH')
    const bytes = await read(blobObjectId, blobType, fieldId, 256), value = ProfileWalrusBlobBcs.parse(bytes)
    check(toBase64(ProfileWalrusBlobBcs.serialize(value).toBytes()) === toBase64(bytes) && value.id === blobObjectId
      && value.encoding_type === 1, 'BLOB_BCS_MISMATCH')
    receiveId(value.storage.id)
    check(BigInt(value.size) >= 16n && BigInt(value.size) <= BigInt(BROWSER_CONTENT_MAX_BYTES), 'BLOB_BYTE_BUDGET')
    check(value.storage.id !== value.id && BigInt(value.storage.storage_size) > 0n && value.storage.start_epoch <= value.registered_epoch
      && value.registered_epoch <= epoch && value.storage.start_epoch < value.storage.end_epoch, 'BLOB_STORAGE_MISMATCH')
    check(value.certified_epoch !== null && value.certified_epoch >= value.registered_epoch && value.certified_epoch >= value.storage.start_epoch
      && value.certified_epoch <= epoch && value.certified_epoch < value.storage.end_epoch, 'BLOB_NOT_CERTIFIED')
    check(epoch < value.storage.end_epoch, 'BLOB_STORAGE_EXPIRED')
    const blobId = toBase64(bcs.u256().serialize(value.blob_id).toBytes()).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    check(/^[A-Za-z0-9_-]{43}$/.test(blobId), 'BLOB_ID_INVALID')
    return { walrusBlobId: blobId, blobObjectId, byteLength: value.size, endEpoch: value.storage.end_epoch,
      walrusBlobUrl: `${config.storage.aggregatorUrl}/v1/blobs/${blobId}` }
  }
  const state = await run(detail), chosen = authority(state)
  const artifact = await run(() => blob(chosen.slot.blob_object_id))
  const functionName = { owner: 'seal_approve_content_owner', 'granted-agent': 'seal_approve_content_granted_agent',
    paid: 'seal_approve_content_paid_access', public: 'seal_approve_content_public' } as const
  const access: BrowserContentAccess = { visibility: 'sealed', ...p, kindName: chosen.version.kindName, owner: state.currentOwner,
    ownershipEpoch: state.ownershipEpoch, accessKind: chosen.accessKind,
    slot: { readModeMask: chosen.slot.read_mode_mask, opMask: chosen.slot.op_mask, grantScopeMask: chosen.slot.grant_scope_mask,
      downloadPolicy: (['public', 'owner_only', 'allowlist'] as const)[chosen.slot.download_policy] }, artifact,
    accessPolicy: { packageId: pkg, sealPackageId: pkg, callablePackageId: config.target.soulidityCallablePackageId,
      stateObjectId: p.stateId, contentObjectId: p.contentId, kind: p.kind, name: p.name, versionIndex: p.versionIndex,
      moduleName: chosen.accessKind === 'paid' ? 'paid_access' : 'content', functionName: functionName[chosen.accessKind],
      soulGrantObjectId: chosen.grantId, paidAccessListOnChainId: chosen.accessKind === 'paid' ? state.paidAccessListId : null,
      documentIdHex: chosen.sidecar.documentId }, sealSidecar: chosen.sidecar }
  const recheck = () => run(async () => {
    const fresh = authority(await detail())
    check(same(fresh, chosen), 'ACCESS_CHANGED_RETRY')
    check(same(await blob(chosen.slot.blob_object_id), artifact), 'BLOB_CHANGED_RETRY')
    await session.finish(undefined)
  })
  await recheck()
  return Object.freeze({ access: freeze(access), recheck })
}
