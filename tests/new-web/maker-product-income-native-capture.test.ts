import { observeOperation } from './fixtures/observed-operation'
// @vitest-environment jsdom
import {beforeEach, afterEach, it, expect, vi} from 'vitest'
import {SuiGrpcClient} from '@mysten/sui/grpc'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {makerProductIncomeControllerFixture, makerProductIncomeWitness} from './fixtures/maker-product-income'
import {captureMakerProductIncomeClient, createMakerProductIncomeHost} from '../../web/lib/soulidity/maker-product-income-host'
import {createRootMakerProductIncomeController} from '../../web/lib/soulidity/commerce/maker-product-income-controller'
import {preflightMakerProductIncomeWithdrawal} from '../../web/lib/soulidity/commerce/maker-product-income-preflight'
import {recheckMakerProductIncomePrepared} from '../../web/lib/soulidity/commerce/maker-product-income-resume'
import {readMakerProductIncome} from '../../web/lib/soulidity/commerce/maker-product-income-read'
import {verifyMakerProductIncomeInterface} from '../../web/lib/soulidity/commerce/maker-product-income-interface'
const {UnaryCall} = createRequire(resolve(process.cwd(), 'web/package.json'))('@protobuf-ts/runtime-rpc')
beforeEach(() => {
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor); localStorage.clear()
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', {configurable: true, value: {request: async (key: string, _options: unknown, work: (lock: unknown) => unknown) => {
    if (held.has(key)) return work(null); held.add(key); try { return await work({name: key}) } finally { held.delete(key) }
  }}})
  vi.stubGlobal('fetch', vi.fn(() => {throw Error('UNEXPECTED_NETWORK')}))
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})
function deferred() {let release!: () => void; const promise = new Promise<void>(r => release = r); return {promise, release}}
function unary(request: unknown, response: unknown) {return new UnaryCall({name: 'ControlledCapturedProductLedger'}, {}, request, Promise.resolve({}), Promise.resolve(response), Promise.resolve({code: 'OK', detail: ''}), Promise.resolve({}))}
function native(x: Awaited<ReturnType<typeof makerProductIncomeWitness>>) {
  const sdk = new SuiGrpcClient({network: 'mainnet', baseUrl: 'http://127.0.0.1:1'})
  for (const name of ['getObject', 'getServiceInfo', 'getTransaction', 'getCheckpoint', 'getEpoch'] as const) {
    const read = x.client.ledgerService[name].bind(x.client.ledgerService)
    sdk.ledgerService[name] = ((request: any, ...rest: any[]) => unary(request, (async () => (await read(request, ...rest)).response)())) as any
  }
  sdk.transactionExecutionService.simulateTransaction = x.client.transactionExecutionService.simulateTransaction.bind(x.client.transactionExecutionService)
  const primitive = (type: number) => ({type, typeParameterInstantiation: []})
  const data = (typeName: string, args: unknown[] = []) => ({reference: 2, body: {type: 10, typeName, typeParameterInstantiation: args}})
  const fn = {name: 'withdraw_income', visibility: 2, isEntry: false, typeParameters: [{constraints: []}], returns: [], parameters: [
    data(x.target.manufacturing.originalPackageId + '::maker_catalog::Product', [{type: 11, typeParameter: 0, typeParameterInstantiation: []}]),
    data(x.target.manufacturing.originalPackageId + '::maker_catalog::Control'), {body: primitive(6)}, {body: primitive(6)}, {body: primitive(1)},
    {body: {type: 9, typeParameterInstantiation: [primitive(3)]}}, data('0x2::tx_context::TxContext'),
  ]}
  const move = sdk.movePackageService, state = sdk.stateService
  const initialFunction = vi.fn(function(this: unknown, request: unknown) {expect(this).toBe(move); return unary(request, {function: fn})})
  const initialOwned = vi.fn(function(this: unknown, request: any) {expect(this).toBe(state); return unary(request, {objects: [{objectId: x.gasId, version: 2n, digest: 'controlled-discovery-hint', objectType: '0x2::coin::Coin<0x2::sui::SUI>'}]})})
  const initialBalance = vi.fn(function(this: unknown, request: any) {
    expect(this).toBe(state)
    expect(request.owner).toBe(x.actor)
    return unary(request, {balance: {coinType: request.coinType, balance: 1075n, coinBalance: 1000n, addressBalance: 75n}})
  })
  move.getFunction = initialFunction as any; state.listOwnedObjects = initialOwned as any; state.getBalance = initialBalance as any
  const replacement = vi.fn(() => {throw Error('REPLACED_INITIAL_PRODUCT_LEAF')})
  function replace() {
    sdk.movePackageService = {...sdk.movePackageService, getFunction: replacement} as any
    sdk.stateService = {...sdk.stateService, listOwnedObjects: replacement, getBalance: replacement} as any
    sdk.ledgerService = {...sdk.ledgerService, getServiceInfo: replacement} as any
  }
  function gateObject() {
    const entered = deferred(), gate = deferred(), initial = sdk.ledgerService.getObject.bind(sdk.ledgerService); let once = false
    sdk.ledgerService.getObject = ((request: any, ...rest: any[]) => unary(request, (async () => {if (!once) {once = true; entered.release(); await gate.promise} return (await initial(request, ...rest)).response})())) as any
    return {started: entered.promise, release: gate.release}
  }
  return {sdk, initialFunction, initialOwned, initialBalance, replacement, replace, gateObject}
}
function request(x: Awaited<ReturnType<typeof makerProductIncomeWitness>>, client: SuiGrpcClient) {
  return {kind: 'NEW_MAKER_PRODUCT_INCOME_WITHDRAWAL' as const, executionRegistry:x.executionRegistry, client, target: x.target, ...x.intent, reviewed: x.snapshot, gas: x.input.gas, expirationEpoch: '6', signal: x.signal, getActorAddress: () => x.actor}
}
it('Host captures the real SDK leaves before its asynchronous Root beforePrepare boundary', async () => {
  const x = await makerProductIncomeWitness(), n = native(x), entered = deferred(), gate = deferred()
  const host = createMakerProductIncomeHost({executionRegistry:x.executionRegistry,beforePrepare: async () => {entered.release(); await gate.promise}})
  const operation=observeOperation(host(request(x,n.sdk)))
  try{await operation.waitForGate(entered.promise);n.replace();gate.release();const result=await operation.result();expect(result.retainedText).toBe(x.originalText);expect(n.initialFunction).toHaveBeenCalled();expect(n.replacement).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()}finally{gate.release();await operation.settled}
}, 120000)
it.each(['preflight', 'resume'] as const)('direct %s keeps native ABI/chain captures through its first object await', async mode => {
  const x = await makerProductIncomeWitness(), n = native(x), gate = n.gateObject(), before = JSON.stringify(x.record)
  const pending = mode === 'preflight' ? preflightMakerProductIncomeWithdrawal(request(x, n.sdk)) : recheckMakerProductIncomePrepared({client: n.sdk, record: x.record, reviewed: x.snapshot, reviewedGas: x.input.gas, executionRegistry:x.executionRegistry, getActorAddress: () => x.actor, signal: x.signal})
  const operation=observeOperation(pending)
  try{await operation.waitForGate(gate.started);n.replace();gate.release();const result=await operation.result();expect(result).toBeDefined();expect(n.initialFunction).toHaveBeenCalled();expect(n.replacement).not.toHaveBeenCalled();expect(JSON.stringify(x.record)).toBe(before);expect(fetch).not.toHaveBeenCalled()}finally{gate.release();await operation.settled}
}, 120000)
it('controller captures actual SDK ABI, owned discovery and address balance leaves before its first historical object await', async () => {
  const x = await makerProductIncomeControllerFixture(), n = native(x), gate = n.gateObject()
  const controller = createRootMakerProductIncomeController({installations: [x.installation], executionModels:x.executionModels, client: () => n.sdk})
  const operation=observeOperation(controller.observe(x.selection,x.signal,()=>x.actor))
  try{await operation.waitForGate(gate.started);n.replace();gate.release();const result=await operation.result();expect(result.preparation?.interfaceProof.interfaceVerified).toBe(true);expect(result.preparation?.inventory.coins.map(r=>r.objectId)).toEqual([x.gasId]);expect(n.initialFunction).toHaveBeenCalled();expect(n.initialOwned).toHaveBeenCalled();expect(result.preparation?.addressGasBalance).toBe('75');expect(n.initialBalance).toHaveBeenCalledOnce();expect(n.replacement).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()}finally{gate.release();await operation.settled}
}, 120000)
it('repeated capture retains its private native client and native chain uses initial ledger receiver', async () => {
  const sdk = new SuiGrpcClient({network: 'mainnet', baseUrl: 'http://127.0.0.1:1'}), ledger = sdk.ledgerService, initial = vi.fn(function(this: unknown, request: unknown) {expect(this).toBe(ledger); return unary(request, {chainId: 'initial-chain'})})
  ledger.getServiceInfo = initial as any
  const captured = captureMakerProductIncomeClient(captureMakerProductIncomeClient(sdk)), replacement = vi.fn(() => {throw Error('LATE_CHAIN')})
  sdk.ledgerService = {...ledger, getServiceInfo: replacement} as any
  expect(await captured.core.getChainIdentifier()).toEqual({chainIdentifier: 'initial-chain'}); expect(initial).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})
it('native owned-object conversion retains the initial state leaf/receiver across a custom type resolver await', async () => {
  const x = await makerProductIncomeWitness(), n = native(x), entered = deferred(), gate = deferred()
  n.sdk.core.mvr.resolveType = vi.fn(async ({type}) => {entered.release(); await gate.promise; return {type}})
  const captured = captureMakerProductIncomeClient(captureMakerProductIncomeClient(n.sdk))
  const pending = captured.core.listOwnedObjects({owner: x.actor, type: '0x2::coin::Coin<0x2::sui::SUI>', limit: 50})
  await entered.promise; n.replace(); n.sdk.core.mvr.resolveType = vi.fn(() => {throw Error('LATE_RESOLVER')}); gate.release()
  expect((await pending).objects.map(r => r.objectId)).toEqual([x.gasId]); expect(n.initialOwned).toHaveBeenCalledOnce(); expect(n.replacement).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})
it('missing captured native leaf rejects locally and cannot use a default network transport', async () => {
  const sdk = new SuiGrpcClient({network: 'mainnet', baseUrl: 'http://127.0.0.1:1'}); sdk.movePackageService.getFunction = undefined as any
  await expect(captureMakerProductIncomeClient(sdk).core.getMoveFunction({packageId: '0x' + '1'.repeat(64), moduleName: 'maker_catalog', name: 'withdraw_income'})).rejects.toThrow('MAKER_INCOME_UNCAPTURED_NATIVE_TRANSPORT')
  expect(fetch).not.toHaveBeenCalled()
})
it('literal Product package/type uses native ABI/owned mapping without external MVR', async () => {
  const x = await makerProductIncomeWitness(), n = native(x), captured = captureMakerProductIncomeClient(n.sdk)
  expect((await captured.core.getMoveFunction({packageId: x.target.manufacturing.callablePackageId, moduleName: 'maker_catalog', name: 'withdraw_income'})).function.name).toBe('withdraw_income')
  expect((await captured.core.listOwnedObjects({owner: x.actor, type: x.target.coinType})).objects.map(row => row.objectId)).toEqual([x.gasId])
  expect(n.initialFunction).toHaveBeenCalledOnce(); expect(n.initialOwned).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
})
it.each(['read', 'interface', 'preflight', 'host'] as const)('the actual Product %s entry rejects a named package before any object/ABI/resolver/fund operation', async mode => {
  const x = await makerProductIncomeWitness(), n = native(x)
  const target = {...x.target, manufacturing: {...x.target.manufacturing, callablePackageId: '@uninstalled/alias'}}
  const chain = vi.spyOn(n.sdk.core, 'getChainIdentifier'), object = vi.spyOn(n.sdk.ledgerService, 'getObject'), epoch = vi.spyOn(n.sdk.ledgerService, 'getEpoch')
  const resolvePackage = vi.spyOn(n.sdk.core.mvr, 'resolvePackage'), resolveType = vi.spyOn(n.sdk.core.mvr, 'resolveType')
  const simulate = vi.spyOn(n.sdk.transactionExecutionService, 'simulateTransaction'), write = vi.spyOn(Storage.prototype, 'setItem')
  const beforePrepare = vi.fn(async () => {})
  const pending = mode === 'read' ? readMakerProductIncome({client: n.sdk, signal: x.signal, target})
    : mode === 'interface' ? verifyMakerProductIncomeInterface({client: n.sdk, manufacturing: target.manufacturing, signal: x.signal})
    : mode === 'preflight' ? preflightMakerProductIncomeWithdrawal({...request(x, n.sdk), target})
    : createMakerProductIncomeHost({executionRegistry:x.executionRegistry,beforePrepare})({...request(x, n.sdk), target})
  await expect(pending).rejects.toThrow(mode==='interface'?'PINNED_PACKAGE_CONFIG_INVALID':'CURRENT_MAKER_INVALID: canonical nonzero ID required')
  // The standalone interface reader may inspect chain identity before the
  // pinned-package reader rejects. No package/object/ABI or fund action starts.
  if (mode !== 'interface') expect(chain).not.toHaveBeenCalled()
  expect(object).not.toHaveBeenCalled(); expect(epoch).not.toHaveBeenCalled()
  expect(resolvePackage).not.toHaveBeenCalled(); expect(resolveType).not.toHaveBeenCalled()
  expect(simulate).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
  expect(n.initialFunction).not.toHaveBeenCalled(); expect(n.initialOwned).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
