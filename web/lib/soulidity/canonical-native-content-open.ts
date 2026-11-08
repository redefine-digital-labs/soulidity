import { SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64, normalizeStructTag, normalizeSuiAddress, toHex } from '@mysten/sui/utils'
import { blobIdFromInt } from '@mysten/walrus'
import { sha256 } from '@noble/hashes/sha2.js'
import { DOWNLOAD_POLICY_PUBLIC, DOWNLOAD_POLICY_OWNER_ONLY, profileReadStep } from '@soulidity/sdk'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { readPinnedMovePackageOrigins } from '../sui/pinned-move-package'
import { fetchBrowserContentBytes, validateBrowserContentSealConfig, type BrowserContentSealConfig } from './browser-content-open'
import { parseCanonicalNativeWorkbenchTarget, readCanonicalNativeWorkbench, type CanonicalNativeWorkbenchTarget } from './canonical-native-workbench'
import { parseNativeCreationEnvelope, buildNativeCreationOwnerApproval } from './native-creation-envelope'
import { nativeContentSealNamespace } from './native-creation-transaction'

function check(value: unknown, code: string): asserts value { if (!value) throw Error(`NATIVE_CONTENT_OPEN_${code}`) }
type Signature = Awaited<ReturnType<SuiGrpcClient['core']['getMoveFunction']>>['function']['parameters'][number]
function signatureType(s: Signature): string {
  const b = s.body
  const inner = b.$kind === 'datatype' ? normalizeStructTag(b.datatype.typeName + (b.datatype.typeParameters.length ? `<${b.datatype.typeParameters.map(body => signatureType({ reference: null, body })).join(',')}>` : ''))
    : b.$kind === 'vector' ? `vector<${signatureType({ reference: null, body: b.vector })}>` : b.$kind
  return (s.reference === null ? '' : s.reference === 'mutable' ? '&mut ' : s.reference === 'immutable' ? '&' : '?') + inner
}
/** Explicit owner read only: real Seal verification + AES, no transaction
 * signing/broadcast, storage payment or plaintext/session persistence. Current
 * custody is a precondition; actual Seal policy execution remains authority.
 * Fetching verified cached bytes does not attest future Walrus availability. */
export async function openCanonicalNativeContent(input: {
  client: SuiGrpcClient; sealClient: SealCompatibleClient; target: CanonicalNativeWorkbenchTarget; soulId: string; recordIndex: number
  expectedRecord?: { version: string; ciphertextHash: string }
  viewerAddress: string; blobBaseUrl: string; sealConfig: BrowserContentSealConfig; signal: AbortSignal
  getAddress: () => string | null; signPersonalMessage: (message: Uint8Array) => Promise<string>
}, dependencies: { read?: typeof readCanonicalNativeWorkbench; fetcher?: typeof fetch } = {}) {
  const target = parseCanonicalNativeWorkbenchTarget(input.target), config = validateBrowserContentSealConfig(input.sealConfig)
  const { client, sealClient, signal, getAddress, signPersonalMessage } = input, viewer = input.viewerAddress, soulId = input.soulId, index = input.recordIndex
  const deps = { ...dependencies }, base = new URL(input.blobBaseUrl)
  check(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash, 'AGGREGATOR_INVALID')
  check(target.content && target.custody && Number.isSafeInteger(index) && index >= 0 && index < 4096, 'READ_CONFIGURATION_REQUIRED')
  const guard = () => { signal.throwIfAborted(); check(viewer && getAddress() === viewer, 'WALLET_CHANGED') }
  const step = async <T>(work: () => Promise<T>, discard?: (value: T) => void): Promise<T> => {
    guard(); const value = await profileReadStep(signal, work, discard)
    try { guard(); return value } catch (error) { discard?.(value); throw error }
  }
  const read = () => step(() => (deps.read ?? readCanonicalNativeWorkbench)({ client, target, soulId, signal,
    viewerAddress: viewer, contentStart: Math.floor(index / 25) * 25 }))
  const snapshot = await read(), custody = snapshot.custody, record = snapshot.contentDirectory?.records.find(r => r.index === String(index))
  check(snapshot.soulId === soulId && custody?.ownerReadCandidate && custody.viewerMatchesOwner && custody.ownerAddress === viewer
    && custody.accountId && record && !record.deleted && !record.purged && (BigInt(record.readMask) & 1n) !== 0n, 'OWNER_RECORD_REQUIRED')
  const expectedRecord = input.expectedRecord
  check(!expectedRecord || (record.version === expectedRecord.version && record.ciphertextHash === expectedRecord.ciphertextHash), 'SELECTED_RECORD_CHANGED')
  const envelope = parseNativeCreationEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(record.envelopeB64))), config, record.version)
  const namespace = nativeContentSealNamespace(snapshot.contentId, record.kind, record.name, record.nonce, record.version)
  check(envelope.contentId === snapshot.contentId && envelope.kind === record.kind && envelope.name === record.name && envelope.nonce === record.nonce
    && envelope.sealPackageId === target.native.originalPackageId && envelope.documentId === toHex(namespace)
    && (record.sealNamespaceB64 === null || toHex(fromBase64(record.sealNamespaceB64)) === toHex(namespace)), 'ENVELOPE_RECORD_BINDING')
  // Verify the selected callable's exact policy ABI before session construction
  // or any personal-message prompt. An unactivated candidate cannot be guessed.
  const origins = await step(() => readPinnedMovePackageOrigins(client, target.custody!, signal)), accountOrigin = origins.get('account::Account')
  check(accountOrigin, 'ACCOUNT_ORIGIN_REQUIRED')
  const fn = (await step(() => client.core.getMoveFunction({ packageId: target.native.callablePackageId, moduleName: 'birth', name: 'seal_approve_content_owner', signal }))).function
  const expected = ['vector<u8>', `&mut ${normalizeStructTag('0x2::kiosk::Kiosk')}`, `&${accountOrigin}::account::Account`,
    normalizeStructTag('0x2::object::ID'), 'u64', `&${normalizeStructTag('0x2::tx_context::TxContext')}`]
  check(normalizeSuiAddress(fn.packageId) === target.native.callablePackageId && fn.moduleName === 'birth' && fn.name === 'seal_approve_content_owner'
    && fn.visibility === 'public' && fn.typeParameters.length === 0 && fn.returns.length === 0
    && JSON.stringify(fn.parameters.map(signatureType)) === JSON.stringify(expected), 'APPROVAL_INTERFACE_UNAVAILABLE')
  const verify = async () => {
    check(JSON.stringify(await read()) === JSON.stringify(snapshot), 'SOURCE_CHANGED')
    check((await step(() => sealClient.core.getChainIdentifier())).chainIdentifier === MAINNET_GENESIS_DIGEST, 'SEAL_WRONG_CHAIN')
  }
  const blobId = blobIdFromInt(BigInt(record.blobIdInteger)), artifact = { walrusBlobId: blobId, blobObjectId: record.blobObjectId,
    byteLength: record.byteLength, endEpoch: record.originalEndEpoch, walrusBlobUrl: `${base.href.replace(/\/$/, '')}/v1/blobs/${blobId}` }
  let ciphertext: Uint8Array | undefined, material: Uint8Array | undefined, plaintext: Uint8Array | undefined
  const wrapped = fromBase64(envelope.encryptedDek)
  try {
    ciphertext = await step(() => fetchBrowserContentBytes({ artifact }, signal, deps.fetcher), bytes => bytes.fill(0))
    check(toHex(sha256(ciphertext)) === record.ciphertextHash, 'CIPHERTEXT_HASH')
    await verify()
    const seal = new SealClient({ suiClient: sealClient, serverConfigs: config.serverConfigs, verifyKeyServers: true, timeout: 10000 })
    await step(() => seal.getKeyServers())
    const tx = buildNativeCreationOwnerApproval({ envelope, config, nativeCallablePackageId: target.native.callablePackageId,
      kioskId: custody.kioskId, accountId: custody.accountId, rootId: soulId, recordIndex: record.index, recordVersion: record.version })
    tx.setSender(viewer)
    const txBytes = await step(() => tx.build({ client, onlyTransactionKind: true }))
    const session = await step(() => SessionKey.create({ address: viewer, packageId: envelope.sealPackageId, ttlMin: config.ttlMin, suiClient: sealClient }))
    await verify()
    const signature = await step(() => signPersonalMessage(session.getPersonalMessage()))
    await step(() => session.setPersonalMessageSignature(signature)); await verify()
    material = await step(() => seal.decrypt({ data: wrapped, sessionKey: session, txBytes, checkShareConsistency: true }), bytes => bytes.fill(0))
    check(material.length === 64 && toHex(material.subarray(32)) === envelope.contentHash, 'KEY_HASH_BINDING')
    const key = await step(() => crypto.subtle.importKey('raw', new Uint8Array(material!.subarray(0, 32)), { name: 'AES-GCM' }, false, ['decrypt']))
    plaintext = await step(async () => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(fromBase64(envelope.iv)) }, key, new Uint8Array(ciphertext!))), bytes => bytes.fill(0))
    check(toHex(sha256(plaintext)) === envelope.contentHash, 'PLAINTEXT_HASH'); await verify(); guard()
    const result = { bytes: plaintext, fileName: envelope.fileName, mimeType: envelope.mimeType,
      downloadAllowed: record.downloadPolicy === DOWNLOAD_POLICY_PUBLIC || record.downloadPolicy === DOWNLOAD_POLICY_OWNER_ONLY }; plaintext = undefined; return result
  } finally { ciphertext?.fill(0); material?.fill(0); plaintext?.fill(0); wrapped.fill(0) }
}
