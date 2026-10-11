import { SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { WalrusClient } from '@mysten/walrus'
import { assertPrivateWalletBookmarksDeployment, assertPrivateWalletBookmarksScope, buildPrivateWalletBookmarksSealApproval,
  profileReadStep, readPrivateWalletBookmarksHead, readPrivateWalletBookmarksCiphertext,
  type PrivateWalletBookmarksDeployment, type PrivateWalletBookmarksHeadSnapshot } from '@soulidity/sdk'
import { createNativeReceiveClient } from '../animacraft/native-receive'
import { getBrowserNativeReceiveTarget } from '../animacraft/browser-native-config'
import { MAINNET_GENESIS_DIGEST } from '../animacraft/mainnet-chain'
import { getBrowserProfileConfig } from '../profile/profile-config'
import { getBrowserContentSealConfig, validateBrowserContentSealConfig, type BrowserContentSealConfig } from '../soulidity/browser-content-open'
import { assertPrivateBookmarkHeadDocument, bookmarkCanonical, bookmarkCheck as check, bookmarkId, emptyPrivateBookmarkLibrary,
  validatePrivateBookmarkLibrary, type PrivateBookmarkLibrary } from './private-bookmark-library'
import { decryptPrivateBookmarkLibrary, encryptPrivateBookmarkLibrary, privateBookmarkCryptoContext, validatePrivateBookmarkEnvelope,
  type PrivateBookmarkCryptoContext } from './private-bookmark-crypto'

export interface BrowserPrivateBookmarkConfig {
  deployment: PrivateWalletBookmarksDeployment; registryId: string
  storage: { blobType: string; aggregatorUrl: string }; sealConfig: BrowserContentSealConfig
  /** Existing profile/account write gate, not a new hidden permission switch. */
  writesEnabled: boolean
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
const exact = (v: unknown, names: string[]) => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every(name => Object.hasOwn(v, name))
export function validateBrowserPrivateBookmarkConfig(input: BrowserPrivateBookmarkConfig): BrowserPrivateBookmarkConfig {
  const value = structuredClone(input)
  check(exact(value, ['deployment', 'registryId', 'storage', 'sealConfig', 'writesEnabled']) && bookmarkId(value.registryId)
    && typeof value.writesEnabled === 'boolean', 'CONFIG_INVALID')
  const deployment = assertPrivateWalletBookmarksDeployment(value.deployment)
  check(deployment.chainIdentifier === '35834a8a', 'MAINNET_REQUIRED')
  check(exact(value.storage, ['blobType', 'aggregatorUrl']) && typeof value.storage.blobType === 'string'
    && /^0x[0-9a-f]{64}::blob::Blob$/.test(value.storage.blobType) && !/^0x0+::/.test(value.storage.blobType), 'STORAGE_CONFIG_INVALID')
  const url = new URL(value.storage.aggregatorUrl)
  check(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search && url.hostname !== 'localhost'
    && !/^\d+(?:\.\d+){3}$/.test(url.hostname) && !url.hostname.includes(':'), 'STORAGE_URL_INVALID')
  return freeze({ deployment, registryId: value.registryId, storage: { blobType: value.storage.blobType,
    aggregatorUrl: url.href.replace(/\/+$/, '') }, sealConfig: validateBrowserContentSealConfig(value.sealConfig), writesEnabled: value.writesEnabled })
}
export function getBrowserPrivateBookmarkConfig(): BrowserPrivateBookmarkConfig {
  const profile = getBrowserProfileConfig(), d = profile.deployment, release = getBrowserNativeReceiveTarget()
  check(release.soulidityOriginalPackageId === d.originalPackageId && release.soulidityCallablePackageId === d.callablePackageId,
    'PROFILE_RELEASE_MISMATCH')
  return validateBrowserPrivateBookmarkConfig({ deployment: { originalPackageId: d.originalPackageId, callablePackageId: d.callablePackageId,
    callableDigest: release.soulidityCallableDigest, chainIdentifier: d.chainIdentifier },
  registryId: d.registryId, storage: profile.storage, sealConfig: getBrowserContentSealConfig(), writesEnabled: profile.writesEnabled })
}
type ReadParams = { owner: string; config: BrowserPrivateBookmarkConfig; signal: AbortSignal }
type Dependencies = { client?: (signal: AbortSignal) => SuiGrpcClient
  walrus?: (client: SuiGrpcClient) => Pick<WalrusClient, 'reset' | 'getBlobType' | 'systemState'> }
interface WalletParams extends ReadParams {
  client: SuiGrpcClient; getAddress: () => string | null
}
interface UnlockParams extends WalletParams {
  sealClient: SealCompatibleClient; signPersonalMessage: (message: Uint8Array) => Promise<string>
}
function capture(params: ReadParams) {
  const config = validateBrowserPrivateBookmarkConfig(params.config)
  const scope = assertPrivateWalletBookmarksScope({ registryId: config.registryId, owner: params.owner })
  const signal = AbortSignal.any([params.signal, AbortSignal.timeout(120000)])
  signal.throwIfAborted()
  return { config, scope, deployment: config.deployment, signal }
}
type Captured = ReturnType<typeof capture>
const headKey = (snapshot: PrivateWalletBookmarksHeadSnapshot) => bookmarkCanonical({ scope: snapshot.scope, revision: snapshot.revision,
  head: snapshot.head, emptyReason: snapshot.emptyReason, headFieldId: snapshot.headFieldId })
function freshWalrus(p: Captured, client: SuiGrpcClient, dependencies: Dependencies) {
  const walrus = dependencies.walrus ? dependencies.walrus(client) : new WalrusClient({ suiClient: client, network: 'mainnet' })
  return async (signal: AbortSignal) => {
    signal.throwIfAborted(); walrus.reset()
    const blobType = await profileReadStep(signal, async () => walrus.getBlobType())
    const state = await profileReadStep(signal, () => walrus.systemState())
    check(blobType === p.config.storage.blobType, 'WALRUS_NETWORK_CHANGED')
    return { blobType, epoch: state.committee.epoch }
  }
}
async function head(p: Captured, client: SuiGrpcClient) {
  return profileReadStep(p.signal, () => readPrivateWalletBookmarksHead({ client, deployment: p.deployment, scope: p.scope, signal: p.signal }))
}
/** No Seal contact or personal signature is needed to discover locked/absent. */
export function readBrowserPrivateBookmarkHead(params: ReadParams, dependencies: Dependencies = {}) {
  const p = capture(params), client = (dependencies.client ?? createNativeReceiveClient)(p.signal)
  return head(p, client)
}
function walletStep(p: Captured, getAddress: () => string | null) {
  const guard = () => { p.signal.throwIfAborted(); check(getAddress() === p.scope.owner, 'WALLET_CHANGED') }
  return { guard, async step<T>(run: () => Promise<T>, discard?: (value: T) => void): Promise<T> {
    guard(); const value = await profileReadStep(p.signal, run, discard)
    try { guard(); return value } catch (error) { discard?.(value); throw error }
  } }
}
/** Explicit unlock also permits same-wallet encrypted paid/uncommitted records.
 * It does not make their contents an authorized mutation or a current head. */
export async function decryptBrowserPrivateBookmarkCiphertext(params: UnlockParams & {
  bytes: Uint8Array; context: PrivateBookmarkCryptoContext; verify: () => Promise<void>
}) {
  const context = privateBookmarkCryptoContext(params.context), p = capture(params)
  check(context.originalPackageId === p.deployment.originalPackageId && context.chainIdentifier === p.deployment.chainIdentifier
    && bookmarkCanonical(context.scope) === bookmarkCanonical(p.scope), 'RECOVERY_SCOPE_MISMATCH')
  check(params.bytes instanceof Uint8Array && params.bytes.length <= 16 * 1024 * 1024, 'ENVELOPE_SIZE')
  const bytes = new Uint8Array(params.bytes), { client, sealClient, getAddress, signPersonalMessage, verify } = params
  const { step, guard } = walletStep(p, getAddress)
  await step(() => head(p, client))
  await step(() => validatePrivateBookmarkEnvelope({ bytes, context, sealConfig: p.config.sealConfig }))
  const unchanged = async () => {
    guard()
    check((await step(() => sealClient.core.getChainIdentifier())).chainIdentifier === MAINNET_GENESIS_DIGEST, 'SEAL_NETWORK_MISMATCH')
    // Head reader reattests the exact immutable package and registry scope.
    await step(() => head(p, client)); await step(verify); guard()
  }
  const seal = new SealClient({ suiClient: sealClient, serverConfigs: p.config.sealConfig.serverConfigs, verifyKeyServers: true, timeout: 10000 })
  await unchanged(); await step(() => seal.getKeyServers())
  const tx = await step(() => buildPrivateWalletBookmarksSealApproval({ deployment: p.deployment, scope: p.scope }))
  const txBytes = await step(() => tx.build({ client, onlyTransactionKind: true }))
  const session = await step(() => SessionKey.create({ address: p.scope.owner, packageId: p.deployment.originalPackageId,
    ttlMin: p.config.sealConfig.ttlMin, suiClient: sealClient }))
  await unchanged()
  const signature = await step(() => signPersonalMessage(session.getPersonalMessage()))
  await step(() => session.setPersonalMessageSignature(signature)); await unchanged()
  return step(() => decryptPrivateBookmarkLibrary({ bytes, context, sealConfig: p.config.sealConfig, signal: p.signal, verify: unchanged,
    unwrap: wrapped => step(() => seal.decrypt({ data: wrapped, sessionKey: session, txBytes, checkShareConsistency: true }), key => key.fill(0)) }))
}
export async function unlockBrowserPrivateBookmarks(params: UnlockParams, dependencies: Dependencies = {}) {
  const p = capture(params), { client, getAddress, sealClient, signPersonalMessage } = params
  const deps = { ...dependencies }, { step } = walletStep(p, getAddress)
  const initial = await step(() => head(p, client))
  if (!initial.head) return { snapshot: initial, library: emptyPrivateBookmarkLibrary(p.scope), endEpoch: null, ciphertext: null }
  const fresh = freshWalrus(p, client, deps)
  const result = await step(() => readPrivateWalletBookmarksCiphertext({ client, deployment: p.deployment, scope: p.scope,
    storage: p.config.storage, freshWalrusState: fresh, signal: p.signal }))
  check(headKey(initial) === headKey(result.snapshot) && result.ciphertext && result.storageEndEpoch !== null, 'HEAD_CHANGED')
  let previousEpoch: number | null = null
  const verify = async () => {
    check(headKey(await step(() => head(p, client))) === headKey(initial), 'HEAD_CHANGED')
    const now = await step(() => fresh(p.signal))
    check(Number.isInteger(now.epoch) && now.epoch >= 0 && now.epoch <= 0xffffffff && now.epoch < result.storageEndEpoch!
      && (previousEpoch === null || now.epoch >= previousEpoch), 'STORAGE_EXPIRED_OR_CHANGED')
    previousEpoch = now.epoch
  }
  const last = initial.head.receipts.at(-1)!
  const library = await step(() => decryptBrowserPrivateBookmarkCiphertext({ owner: p.scope.owner, client, getAddress, sealClient,
    signPersonalMessage, config: p.config, signal: p.signal,
    bytes: result.ciphertext!, context: { scope: p.scope, originalPackageId: p.deployment.originalPackageId, chainIdentifier: p.deployment.chainIdentifier,
      revision: initial.revision, requestId: last.requestId }, verify }))
  assertPrivateBookmarkHeadDocument(library, initial.head)
  return { snapshot: initial, library, endEpoch: result.storageEndEpoch, ciphertext: result.ciphertext }
}
/** Public-key encryption only: no signature, upload, payment or head change. */
export async function encryptBrowserPrivateBookmarks(params: WalletParams & { library: PrivateBookmarkLibrary }) {
  const p = capture(params), { client, getAddress } = params, { step } = walletStep(p, getAddress)
  const library = validatePrivateBookmarkLibrary(params.library, p.scope, params.library.revision)
  check(library.intent, 'INTENT_REQUIRED')
  const initial = await step(() => head(p, client))
  check(initial.revision === library.intent.expectedRevision, 'REVISION_CONFLICT')
  const verify = async () => check(headKey(await step(() => head(p, client))) === headKey(initial), 'HEAD_CHANGED')
  const seal = new SealClient({ suiClient: client, serverConfigs: p.config.sealConfig.serverConfigs, verifyKeyServers: true, timeout: 10000 })
  await step(() => seal.getKeyServers())
  return step(() => encryptPrivateBookmarkLibrary({ library, sealConfig: p.config.sealConfig, seal, signal: p.signal, verify,
    context: { scope: p.scope, originalPackageId: p.deployment.originalPackageId, chainIdentifier: p.deployment.chainIdentifier,
      revision: library.revision, requestId: library.intent!.requestId } }))
}
