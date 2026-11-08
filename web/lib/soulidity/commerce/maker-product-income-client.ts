import { captureOptionalIncomeEpoch } from './income-original-ledger'
import {isSuiGrpcClient, SuiGrpcClient, type RpcTransport} from '@mysten/sui/grpc'

const unavailable = () => { throw new Error('MAKER_INCOME_UNCAPTURED_NATIVE_TRANSPORT') }
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
  const names = ['getChainIdentifier', 'getMoveFunction', 'listOwnedObjects', 'getObjects'] as const
  let owner: object | null = null
  for (let prototype = Object.getPrototypeOf(core); prototype; prototype = Object.getPrototypeOf(prototype)) {
    if (names.every(name => typeof Object.getOwnPropertyDescriptor(prototype, name)?.value === 'function')) owner = prototype
  }
  return owner
}

/** Product-local readonly capability snapshot. Native core methods retain a
 * private SDK client with captured service leaves, preserving SDK mapping.
 * Explicit custom adapters retain their initial function/receiver only; their
 * opaque internal closures are still the caller's initial trust boundary.
 */
export function captureMakerProductIncomeClient(source: SuiGrpcClient): SuiGrpcClient {
  const core = source.core, ledger = source.ledgerService, execution = source.transactionExecutionService
  const state = source.stateService, move = source.movePackageService, resolver = core?.mvr
  const getChainIdentifier = core?.getChainIdentifier, getMoveFunction = core?.getMoveFunction, listOwnedObjects = core?.listOwnedObjects
  const resolvePackage = resolver?.resolvePackage, resolveType = resolver?.resolveType
  const captured = {
    core: {getChainIdentifier: getChainIdentifier?.bind(core), getMoveFunction: getMoveFunction?.bind(core), listOwnedObjects: listOwnedObjects?.bind(core)},
    ledgerService: {getObject: ledger.getObject.bind(ledger), getServiceInfo: ledger.getServiceInfo?.bind(ledger), getTransaction: ledger.getTransaction?.bind(ledger), getCheckpoint: ledger.getCheckpoint?.bind(ledger), batchGetObjects: ledger.batchGetObjects?.bind(ledger), getEpoch: captureOptionalIncomeEpoch(ledger)},
    stateService: {getBalance: state?.getBalance?.bind(state), listDynamicFields: state?.listDynamicFields?.bind(state)},
    transactionExecutionService: {simulateTransaction: execution?.simulateTransaction?.bind(execution)},
  }
  const owner = nativeReadOwner(source)
  const nativeChain = !!owner && getChainIdentifier === Object.getOwnPropertyDescriptor(owner, 'getChainIdentifier')?.value
  const nativeFunction = !!owner && getMoveFunction === Object.getOwnPropertyDescriptor(owner, 'getMoveFunction')?.value
  const nativeOwned = !!owner && listOwnedObjects === Object.getOwnPropertyDescriptor(owner, 'listOwnedObjects')?.value
  if (nativeChain || nativeFunction || nativeOwned) {
    // Product accepts full pinned package IDs and canonical coin types. Native
    // MVR resolves those literals locally. No fallback transport or alias URL.
    const privateClient = new SuiGrpcClient({network: source.network, transport: noTransport, mvr: {url: ''}})
    privateClient.ledgerService = {...captured.ledgerService, getServiceInfo: captured.ledgerService.getServiceInfo ?? unavailable} as SuiGrpcClient['ledgerService']
    privateClient.movePackageService = {getFunction: move?.getFunction?.bind(move) ?? unavailable} as SuiGrpcClient['movePackageService']
    privateClient.stateService = {listOwnedObjects: state?.listOwnedObjects?.bind(state) ?? unavailable} as SuiGrpcClient['stateService']
    // Preserve initial resolver operations and receivers when they differ from
    // this SDK copy, including explicit adapters and foreign native resolvers.
    // Native MVR has no late source-client leaf lookup; Product pins/types are
    // literal identities. Same-copy native resolution uses fresh local state.
    if (resolvePackage && resolvePackage !== privateClient.core.mvr.resolvePackage) privateClient.core.mvr.resolvePackage = resolvePackage.bind(resolver)
    if (resolveType && resolveType !== privateClient.core.mvr.resolveType) privateClient.core.mvr.resolveType = resolveType.bind(resolver)
    if (nativeChain) captured.core.getChainIdentifier = privateClient.core.getChainIdentifier.bind(privateClient.core)
    if (nativeFunction) captured.core.getMoveFunction = privateClient.core.getMoveFunction.bind(privateClient.core)
    if (nativeOwned) captured.core.listOwnedObjects = privateClient.core.listOwnedObjects.bind(privateClient.core)
  }
  return captured as unknown as SuiGrpcClient
}
