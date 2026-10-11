import { SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toHex } from '@mysten/sui/utils'
import { WalrusClient } from '@mysten/walrus'
import { assertPrivateNamedLoadoutScope, buildPrivateNamedLoadoutSealApproval, profileReadStep,
  readPrivateNamedLoadoutHead, readPrivateNamedLoadoutCiphertext,
  type PrivateNamedLoadoutHeadSnapshot, type PrivateNamedLoadoutScope } from '@soulidity/sdk'
import { createBrowserNativeReadSession } from './browser-native-artwork'
import { getBrowserNativeReceiveTarget } from './browser-native-config'
import { attestNativeReceiveTarget, createNativeReceiveClient, readNativeReceiveTarget, type NativeReceiveTarget } from './native-receive'
import { readNativeArtworkOutput } from './native-artwork'
import { EquipmentReadSet } from './native-equipment'
import { completeReadAggregatorUrls, createNativeProtectedReadContext, readNativeProtectedReadPolicy } from './native-protected-read-authority'
import { MAINNET_GENESIS_DIGEST } from './mainnet-chain'
import { decryptPrivateLoadoutLibrary, encryptPrivateLoadoutLibrary, privateLoadoutCryptoContext,
  validatePrivateLoadoutSealPolicy, validatePrivateLoadoutEnvelope, type PrivateLoadoutCryptoContext } from './private-loadout-crypto'
import { assertPrivateLoadoutHeadDocument, emptyPrivateLoadoutLibrary, privateLoadoutCanonical, privateLoadoutCheck as check,
  type PrivateLoadoutLibrary } from './private-loadout-library'

export interface BrowserPrivateLoadoutConfig {
  target: NativeReceiveTarget
  aggregators: [string, string][]
  storage: { blobType: string; aggregatorUrl: string }
}
interface Dependencies {
  client?: (signal: AbortSignal) => SuiGrpcClient
  walrus?: (client: SuiGrpcClient) => Pick<WalrusClient, 'reset' | 'getBlobType' | 'systemState'>
}
interface ReadParams { scope: PrivateNamedLoadoutScope; config: BrowserPrivateLoadoutConfig; signal?: AbortSignal }
interface WalletParams { client: SuiGrpcClient; getAddress: () => string | null; signal: AbortSignal }
interface UnlockParams extends Omit<ReadParams, 'signal'>, WalletParams {
  sealClient: SealCompatibleClient
  signPersonalMessage: (message: Uint8Array) => Promise<string>
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const exact = (v: unknown, keys: string[]) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
/** A detached, public-only tuple safe to retain with a pending ciphertext. */
export function validateBrowserPrivateLoadoutConfig(input: BrowserPrivateLoadoutConfig): BrowserPrivateLoadoutConfig {
  const v = structuredClone(input)
  check(exact(v, ['target', 'aggregators', 'storage']), 'PRIVATE_LOADOUT_CONFIG_INVALID')
  const pin = v.target
  const target = readNativeReceiveTarget({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet',
    NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID: pin?.soulidityCallablePackageId,
    NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID: pin?.soulidityOriginalPackageId,
    NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON: JSON.stringify(pin) })
  check(Array.isArray(v.aggregators) && v.aggregators.length <= 64
    && v.aggregators.every(row => Array.isArray(row) && row.length === 2 && row.every(x => typeof x === 'string')),
  'PRIVATE_LOADOUT_SERVICES_INVALID')
  const aggregators = completeReadAggregatorUrls({ NEXT_PUBLIC_SUI_NETWORK: 'mainnet', NEXT_PUBLIC_SEAL_SERVER_CONFIGS:
    JSON.stringify(v.aggregators.map(([objectId, aggregatorUrl]) => ({ objectId, aggregatorUrl }))) })
  check(exact(v.storage, ['blobType', 'aggregatorUrl']) && typeof v.storage.blobType === 'string'
    && /^0x[0-9a-f]{64}::blob::Blob$/.test(v.storage.blobType) && !/^0x0+::/.test(v.storage.blobType)
    && typeof v.storage.aggregatorUrl === 'string', 'PRIVATE_LOADOUT_STORAGE_INVALID')
  const url = new URL(v.storage.aggregatorUrl)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.hostname !== 'localhost' && !/^\d+(?:\.\d+){3}$/.test(url.hostname) && !url.hostname.includes(':'),
  'PRIVATE_LOADOUT_STORAGE_URL_INVALID')
  return freeze({ target, aggregators: [...aggregators], storage: { blobType: v.storage.blobType, aggregatorUrl: url.href.replace(/\/$/, '') } })
}
export function getBrowserPrivateLoadoutConfig(): BrowserPrivateLoadoutConfig {
  const target = getBrowserNativeReceiveTarget()
  const aggregators = completeReadAggregatorUrls({ NEXT_PUBLIC_SUI_NETWORK: process.env.NEXT_PUBLIC_SUI_NETWORK,
    NEXT_PUBLIC_SEAL_SERVER_CONFIGS: process.env.NEXT_PUBLIC_SEAL_SERVER_CONFIGS })
  return validateBrowserPrivateLoadoutConfig({ target, aggregators: [...aggregators], storage: {
    blobType: process.env.NEXT_PUBLIC_WALRUS_BLOB_TYPE!, aggregatorUrl: process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL! } })
}
function capture(params: ReadParams) {
  const config = validateBrowserPrivateLoadoutConfig(params.config), scope = assertPrivateNamedLoadoutScope(params.scope)
  const signal = params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000)
  signal.throwIfAborted()
  const deployment = { originalPackageId: config.target.soulidityOriginalPackageId,
    callablePackageId: config.target.soulidityCallablePackageId, chainIdentifier: toHex(fromBase58(MAINNET_GENESIS_DIGEST).subarray(0, 4)) }
  return { config, scope, signal, deployment }
}
type Captured = ReturnType<typeof capture>
const logicalHead = (snapshot: Readonly<PrivateNamedLoadoutHeadSnapshot>) => privateLoadoutCanonical({
  scope: snapshot.scope, revision: snapshot.revision, head: snapshot.head, emptyReason: snapshot.emptyReason, headFieldId: snapshot.headFieldId })
function clientFor(p: Captured, dependencies: Dependencies) { return (dependencies.client ?? createNativeReceiveClient)(p.signal) }
async function head(p: Captured, client: SuiGrpcClient) {
  const session = createBrowserNativeReadSession(client, p.signal)
  await profileReadStep(p.signal, () => attestNativeReceiveTarget(session.client, p.config.target))
  return session.finish(await readPrivateNamedLoadoutHead({ client: session.client, ...p }))
}
/** Query needs no current equipment, Seal service contact, session or signature. */
export async function readBrowserPrivateLoadoutHead(params: ReadParams, dependencies: Dependencies = {}) {
  const p = capture(params), capturedDependencies = { ...dependencies }
  return profileReadStep(p.signal, () => head(p, clientFor(p, capturedDependencies)))
}
async function authority(p: Captured, client: SuiGrpcClient) {
  const session = createBrowserNativeReadSession(client, p.signal), reads = new EquipmentReadSet(session.client)
  return profileReadStep(p.signal, async () => {
    const snapshot = await readPrivateNamedLoadoutHead({ client: session.client, ...p })
    const { output } = await readNativeArtworkOutput(session.client, p.config.target, p.scope)
    const context = await createNativeProtectedReadContext(session.client, p.config.target, reads, p.signal)
    const proof = await readNativeProtectedReadPolicy(context, { rootId: output.root_id, makerVersion: output.maker_version,
      rootContentCommitment: output.root_content_commitment })
    check(proof.root.publication.registry_ids!.output_registry_id === output.output_registry_id, 'PRIVATE_LOADOUT_OUTPUT_REGISTRY_MISMATCH')
    const urls = new Map(p.config.aggregators)
    const policy = validatePrivateLoadoutSealPolicy({ threshold: proof.policy.threshold,
      maxPlaintextBytes: Number(proof.policy.max_plaintext_bytes), cipherSuite: proof.policy.cipher_suite,
      keyDerivation: proof.policy.key_derivation, ciphertextFormat: proof.policy.ciphertext_format,
      keyServers: proof.policy.key_servers.map(row => ({ objectId: row.key_server_id, weight: row.weight,
        ...(urls.has(row.key_server_id) ? { aggregatorUrl: urls.get(row.key_server_id)! } : {}) })) })
    const identity = privateLoadoutCanonical({ rootId: proof.root.id, catalogId: proof.catalogId,
      registryId: proof.registry.id, policyId: proof.policy.id, policyCommitment: proof.policy.commitment,
      releaseConfigId: proof.releaseConfigId, policy })
    await reads.verify()
    return session.finish({ snapshot, policy: freeze(policy), identity })
  })
}
function freshWalrus(p: Captured, client: SuiGrpcClient, dependencies: Dependencies) {
  const walrus = dependencies.walrus ? dependencies.walrus(client) : new WalrusClient({ suiClient: client, network: 'mainnet' })
  return async (signal: AbortSignal) => {
    signal.throwIfAborted(); walrus.reset()
    const blobType = await profileReadStep(signal, async () => walrus.getBlobType())
    const state = await profileReadStep(signal, () => walrus.systemState())
    return { blobType, epoch: state.committee.epoch }
  }
}
async function read(p: Captured, client: SuiGrpcClient, dependencies: Dependencies) {
  const initial = await head(p, client)
  if (!initial.head) return { snapshot: initial, ciphertext: null, endEpoch: null, policy: null }
  const session = createBrowserNativeReadSession(client, p.signal)
  const freshWalrusState = freshWalrus(p, session.client, dependencies)
  const result = await readPrivateNamedLoadoutCiphertext({ ...p, client: session.client,
    storage: p.config.storage, freshWalrusState })
  check(logicalHead(initial) === logicalHead(result.snapshot), 'PRIVATE_LOADOUT_HEAD_CHANGED')
  const proven = await authority(p, session.client)
  check(logicalHead(proven.snapshot) === logicalHead(result.snapshot), 'PRIVATE_LOADOUT_HEAD_CHANGED')
  await session.finish(undefined)
  return { snapshot: result.snapshot, ciphertext: result.ciphertext, endEpoch: result.storageEndEpoch, policy: proven.policy }
}
export async function readBrowserPrivateLoadout(params: ReadParams, dependencies: Dependencies = {}) {
  const p = capture(params), capturedDependencies = { ...dependencies }
  return profileReadStep(p.signal, () => read(p, clientFor(p, capturedDependencies), capturedDependencies))
}
function walletStep(p: Captured, getAddress: () => string | null) {
  const guard = () => { p.signal.throwIfAborted(); check(getAddress() === p.scope.owner, 'PRIVATE_LOADOUT_WALLET_CHANGED') }
  return { guard, async step<T>(run: () => Promise<T>, discard?: (v: T) => void): Promise<T> {
    guard(); const result = await profileReadStep(p.signal, run, discard)
    try { guard(); return result } catch (error) { discard?.(result); throw error }
  } }
}
/** Explicit user unlock of a same-owner/epoch paid orphan is valid even if its
 * revision is not the current head. No plaintext or session is persisted. */
export async function decryptBrowserPrivateLoadoutCiphertext(params: WalletParams & {
  bytes: Uint8Array; context: PrivateLoadoutCryptoContext; config: BrowserPrivateLoadoutConfig;
  sealClient: SealCompatibleClient; signPersonalMessage: (message: Uint8Array) => Promise<string>; verify?: () => Promise<void>
}, dependencies: Dependencies = {}) {
  const context = privateLoadoutCryptoContext(params.context), bytes = new Uint8Array(params.bytes)
  const p = capture({ ...params, scope: context.scope }), { client, sealClient, getAddress, signPersonalMessage, verify } = params
  check(context.originalPackageId === p.deployment.originalPackageId, 'PRIVATE_LOADOUT_PACKAGE_MISMATCH')
  const { step, guard } = walletStep(p, getAddress)
  const initial = await step(() => authority(p, client))
  await step(() => validatePrivateLoadoutEnvelope({ bytes, context, policy: initial.policy }))
  const unchanged = async () => {
    guard()
    check((await step(() => sealClient.core.getChainIdentifier())).chainIdentifier === MAINNET_GENESIS_DIGEST, 'PRIVATE_LOADOUT_SEAL_CHAIN_MISMATCH')
    const current = await step(() => authority(p, client))
    check(current.identity === initial.identity, 'PRIVATE_LOADOUT_POLICY_CHANGED')
    if (verify) await step(verify)
    guard()
  }
  const seal = new SealClient({ suiClient: sealClient, serverConfigs: initial.policy.keyServers, verifyKeyServers: true, timeout: 10000 })
  await unchanged(); await step(() => seal.getKeyServers())
  const tx = await step(() => buildPrivateNamedLoadoutSealApproval({ deployment: p.deployment, scope: p.scope }))
  const txBytes = await step(() => tx.build({ client, onlyTransactionKind: true }))
  const session = await step(() => SessionKey.create({ address: p.scope.owner, packageId: p.deployment.originalPackageId,
    ttlMin: 10, suiClient: sealClient }))
  await unchanged()
  const signature = await step(() => signPersonalMessage(session.getPersonalMessage()))
  await step(() => session.setPersonalMessageSignature(signature))
  await unchanged()
  const library = await step(() => decryptPrivateLoadoutLibrary({ bytes, context, policy: initial.policy, signal: p.signal,
    unwrap: wrapped => step(() => seal.decrypt({ data: wrapped, sessionKey: session, txBytes, checkShareConsistency: true }), key => key.fill(0)),
    verify: unchanged }))
  return { library, policy: initial.policy }
}
export async function unlockBrowserPrivateLoadout(params: UnlockParams, dependencies: Dependencies = {}) {
  const p = capture(params), { sealClient, getAddress, signPersonalMessage, client: originalClient } = params
  dependencies = { ...dependencies }
  const session = createBrowserNativeReadSession(originalClient, p.signal), client = session.client
  const { step } = walletStep(p, getAddress)
  const result = await step(() => read(p, client, dependencies))
  if (!result.snapshot.head) return step(() => session.finish({ snapshot: result.snapshot, library: emptyPrivateLoadoutLibrary(p.scope), policy: null, endEpoch: null }))
  const row = result.snapshot.head.receipts.at(-1)!
  const fresh = freshWalrus(p, client, dependencies)
  let previousEpoch: number | undefined
  const verify = async () => {
    check(logicalHead(await head(p, originalClient)) === logicalHead(result.snapshot), 'PRIVATE_LOADOUT_HEAD_CHANGED')
    const current = await step(() => fresh(p.signal))
    check(current.blobType === p.config.storage.blobType && Number.isInteger(current.epoch) && current.epoch >= 0
      && current.epoch <= 0xffff_ffff && (previousEpoch === undefined || current.epoch >= previousEpoch)
      && result.endEpoch !== null && current.epoch < result.endEpoch, 'PRIVATE_LOADOUT_STORAGE_EXPIRED_OR_CHANGED')
    previousEpoch = current.epoch
    await session.finish(undefined)
  }
  const unlocked = await decryptBrowserPrivateLoadoutCiphertext({ bytes: result.ciphertext!, config: p.config,
    context: { scope: p.scope, revision: result.snapshot.revision, requestId: row.requestId, originalPackageId: p.deployment.originalPackageId },
    client: originalClient, sealClient, getAddress, signPersonalMessage, signal: p.signal, verify }, dependencies)
  assertPrivateLoadoutHeadDocument(unlocked.library, result.snapshot.head)
  return step(() => session.finish({ snapshot: result.snapshot, library: unlocked.library, policy: unlocked.policy, endEpoch: result.endEpoch }))
}
/** Encryption performs no wallet signature, upload, payment or head mutation. */
export async function encryptBrowserPrivateLoadout(params: WalletParams & {
  library: PrivateLoadoutLibrary; config: BrowserPrivateLoadoutConfig; verifyCapture?: () => Promise<void>
}, dependencies: Dependencies = {}) {
  const library = structuredClone(params.library), p = capture({ ...params, scope: library.scope })
  const { client, getAddress, verifyCapture } = params, { step, guard } = walletStep(p, getAddress)
  check(library.intent, 'PRIVATE_LOADOUT_INTENT_REQUIRED')
  const initial = await step(() => authority(p, client))
  check(initial.snapshot.revision === library.intent.expectedRevision, 'PRIVATE_LOADOUT_REVISION_CONFLICT')
  const verify = async () => {
    const current = await step(() => authority(p, client))
    check(current.identity === initial.identity && logicalHead(current.snapshot) === logicalHead(initial.snapshot), 'PRIVATE_LOADOUT_HEAD_CHANGED')
    if (verifyCapture) await step(verifyCapture)
    guard()
  }
  const seal = new SealClient({ suiClient: client, serverConfigs: initial.policy.keyServers, verifyKeyServers: true, timeout: 10000 })
  const ciphertext = await step(() => encryptPrivateLoadoutLibrary({ library,
    context: { scope: p.scope, revision: library.revision, requestId: library.intent!.requestId, originalPackageId: p.deployment.originalPackageId },
    policy: initial.policy, seal, signal: p.signal, verify }))
  return { ciphertext, policy: initial.policy }
}
