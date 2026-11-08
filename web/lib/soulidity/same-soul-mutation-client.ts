import { captureAccountOriginalReadClientV155 } from './management/account-original-readers-v155'
import {isSuiGrpcClient, SuiGrpcClient, type RpcTransport} from '@mysten/sui/grpc'

const unavailable = () => { throw new Error('SAME_SOUL_UNCAPTURED_NATIVE_TRANSPORT') }
const noTransport: RpcTransport = {
  mergeOptions: options => options ?? {},
  unary: unavailable, serverStreaming: unavailable, clientStreaming: unavailable, duplex: unavailable,
}

/** Find the inherited SDK read-method owner in this branded client's own
 * prototype chain. A second physical SDK has different function identities.
 * The deepest owner keeps explicit instance/subclass overrides as adapters.
 * This is capability routing, never source/ledger/business qualification. */
function nativeReadOwner(source: SuiGrpcClient) {
  const core = source.core
  if (!isSuiGrpcClient(source) || !isSuiGrpcClient(core?.base) || core.base.core !== core || core?.core !== core) return null
  const names = ['getChainIdentifier', 'getMoveFunction', 'getProtocolConfig', 'getObjects'] as const
  let owner: object | null = null
  for (let prototype = Object.getPrototypeOf(core); prototype; prototype = Object.getPrototypeOf(prototype)) {
    if (names.every(name => typeof Object.getOwnPropertyDescriptor(prototype, name)?.value === 'function')) owner = prototype
  }
  return owner
}

/** Shared mutation readonly capability snapshot. Native core methods retain a
 * private SDK client with captured service leaves, preserving SDK mapping.
 * Explicit custom adapters retain their initial function/receiver only; their
 * opaque internal closures are still the caller's initial trust boundary.
 */
function captureClient(source: SuiGrpcClient, signal?: AbortSignal, marketExecution = false): SuiGrpcClient {
  const core = source.core, ledger = source.ledgerService, execution = source.transactionExecutionService
  const state = source.stateService, move = source.movePackageService, resolver = core?.mvr
  const getChainIdentifier = core?.getChainIdentifier, getMoveFunction = core?.getMoveFunction, getProtocolConfig = core?.getProtocolConfig, listDynamicFields = core?.listDynamicFields, listOwnedObjects = core?.listOwnedObjects
  const extraNames = ['getObjects', 'getDynamicField', 'getTransaction', 'simulateTransaction', 'executeTransaction', 'resolveTransactionPlugin'] as const
  const extra = Object.fromEntries(extraNames.map(name => [name, core?.[name]]))
  const resolvePackage = resolver?.resolvePackage, resolveType = resolver?.resolveType
  const captured = {
    core: {getChainIdentifier: getChainIdentifier?.bind(core), getMoveFunction: getMoveFunction?.bind(core), listOwnedObjects: listOwnedObjects?.bind(core), getProtocolConfig: getProtocolConfig?.bind(core), listDynamicFields: listDynamicFields?.bind(core)},
    ledgerService: {getObject: ledger.getObject.bind(ledger), getServiceInfo: ledger.getServiceInfo?.bind(ledger), getTransaction: ledger.getTransaction?.bind(ledger), getCheckpoint: ledger.getCheckpoint?.bind(ledger), getEpoch: ledger.getEpoch?.bind(ledger), batchGetObjects: ledger.batchGetObjects?.bind(ledger)},
    transactionExecutionService: {simulateTransaction: execution?.simulateTransaction?.bind(execution)},
    stateService: {listOwnedObjects: state?.listOwnedObjects?.bind(state), listDynamicFields: state?.listDynamicFields?.bind(state)},
    ...(marketExecution && move?.getPackage ? {movePackageService: Object.freeze({getPackage: move.getPackage.bind(move)})} : {}),
  }
  const owner = nativeReadOwner(source)
  const nativeExtra = (name: typeof extraNames[number]) => {
    if (!owner || typeof extra[name] !== 'function') return false
    let last: unknown
    for (let p = Object.getPrototypeOf(core); p; p = Object.getPrototypeOf(p)) { const value = Object.getOwnPropertyDescriptor(p, name)?.value; if (typeof value === 'function') last = value }
    return extra[name] === last
  }
  const extras: Record<string, unknown> = {}
  for (const name of extraNames) if (marketExecution || !['executeTransaction', 'resolveTransactionPlugin'].includes(name)) {
    if (typeof extra[name] === 'function') extras[name] = extra[name].bind(core)
  }
  const nativeChain = !!owner && getChainIdentifier === Object.getOwnPropertyDescriptor(owner, 'getChainIdentifier')?.value
  const nativeFunction = !!owner && getMoveFunction === Object.getOwnPropertyDescriptor(owner, 'getMoveFunction')?.value
  const nativeProtocol = !!owner && getProtocolConfig === Object.getOwnPropertyDescriptor(owner, 'getProtocolConfig')?.value
  const nativeDynamic = !!owner && listDynamicFields === Object.getOwnPropertyDescriptor(owner, 'listDynamicFields')?.value
  const nativeOwned = !!owner && listOwnedObjects === Object.getOwnPropertyDescriptor(owner, 'listOwnedObjects')?.value
  if (nativeChain || nativeFunction || nativeProtocol || nativeDynamic || nativeOwned || extraNames.some(nativeExtra)) {
    // The caller validates full pinned package IDs and canonical coin types. Native
    // MVR resolves those literals locally. No fallback transport or alias URL.
    const privateClient = new SuiGrpcClient({network: source.network, transport: noTransport, mvr: {url: ''}})
    privateClient.transactionExecutionService = {simulateTransaction: captured.transactionExecutionService.simulateTransaction ?? unavailable, executeTransaction: marketExecution ? execution?.executeTransaction?.bind(execution) ?? unavailable : unavailable} as SuiGrpcClient['transactionExecutionService']
    privateClient.ledgerService = {...captured.ledgerService, getServiceInfo: captured.ledgerService.getServiceInfo ?? unavailable} as SuiGrpcClient['ledgerService']
    privateClient.movePackageService = {getFunction: move?.getFunction?.bind(move) ?? unavailable} as SuiGrpcClient['movePackageService']
    privateClient.stateService = {listOwnedObjects: state?.listOwnedObjects?.bind(state) ?? unavailable, listDynamicFields: state?.listDynamicFields?.bind(state) ?? unavailable} as SuiGrpcClient['stateService']
    // Preserve initial resolver operations and receivers when they differ from
    // this SDK copy, including explicit adapters and foreign native resolvers.
    // Native MVR has no late source-client leaf lookup; Product pins/types are
    // literal identities. Same-copy native resolution uses fresh local state.
    if (resolvePackage && resolvePackage !== privateClient.core.mvr.resolvePackage) privateClient.core.mvr.resolvePackage = resolvePackage.bind(resolver)
    if (resolveType && resolveType !== privateClient.core.mvr.resolveType) privateClient.core.mvr.resolveType = resolveType.bind(resolver)
    for (const name of extraNames) if (nativeExtra(name) && (marketExecution || !['executeTransaction', 'resolveTransactionPlugin'].includes(name))) extras[name] = privateClient.core[name].bind(privateClient.core)
    if (nativeChain) captured.core.getChainIdentifier = privateClient.core.getChainIdentifier.bind(privateClient.core)
    if (nativeFunction) captured.core.getMoveFunction = privateClient.core.getMoveFunction.bind(privateClient.core)
    let inheritedDynamic: unknown
    for (let p = Object.getPrototypeOf(source); p; p = Object.getPrototypeOf(p)) { const value = Object.getOwnPropertyDescriptor(p, 'listDynamicFields')?.value; if (typeof value === 'function') inheritedDynamic = value }
    const sourceDynamic = source.listDynamicFields
    if (typeof sourceDynamic === 'function' && sourceDynamic !== inheritedDynamic) privateClient.listDynamicFields = sourceDynamic.bind(source)
    if (typeof extra.getObjects === 'function' && !nativeExtra('getObjects')) privateClient.core.getObjects = (extra.getObjects as SuiGrpcClient['core']['getObjects']).bind(core)
    if (nativeDynamic) captured.core.listDynamicFields = privateClient.core.listDynamicFields.bind(privateClient.core)
    if (nativeProtocol) captured.core.getProtocolConfig = privateClient.core.getProtocolConfig.bind(privateClient.core)
    if (nativeOwned) captured.core.listOwnedObjects = privateClient.core.listOwnedObjects.bind(privateClient.core)
  }
  const readonly = [ledger.getServiceInfo, ledger.getObject, ledger.getTransaction, ledger.getCheckpoint].every(m => typeof m === 'function') ? captureAccountOriginalReadClientV155(source, signal) : null
  return Object.freeze({ ...captured, ledgerService: Object.freeze(captured.ledgerService), transactionExecutionService: Object.freeze(captured.transactionExecutionService), stateService: Object.freeze(captured.stateService), core: Object.freeze({ ...captured.core, ...extras, verifyZkLoginSignature: readonly?.core.verifyZkLoginSignature.bind(readonly.core) ?? core?.verifyZkLoginSignature?.bind(core) }) }) as unknown as SuiGrpcClient
}

export function captureSameSoulMutationClient(source: SuiGrpcClient, signal?: AbortSignal): SuiGrpcClient { return captureClient(source, signal) }
/** Retains only pre-existing market execution capability, never a signer or new permission. */
export function captureSameSoulMarketExecutionClient(source: SuiGrpcClient, signal?: AbortSignal): SuiGrpcClient { return captureClient(source, signal, true) }
/** Private mutable port for the existing bounded-reader Proxy; original functions remain bound. */
export function sameSoulMarketReadPort(source: SuiGrpcClient): SuiGrpcClient { return { ...source, core: { ...source.core }, ledgerService: { ...source.ledgerService }, stateService: { ...source.stateService } } as SuiGrpcClient }
