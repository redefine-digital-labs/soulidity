import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { toBase58 } from '@mysten/sui/utils'
import { blake2b } from '@noble/hashes/blake2.js'
import { SuiGrpcJsonRpcCompatClient, getSuiGrpcFullnodeUrl } from '@soulidity/sdk'
import type { UnaryCall as RpcUnaryCall } from '@protobuf-ts/runtime-rpc'
import { createBrowserSuiClient } from '../../web/lib/sui/browser-client'

const { UnaryCall } = createRequire(new URL('../../web/package.json', import.meta.url))('@protobuf-ts/runtime-rpc') as typeof import('@protobuf-ts/runtime-rpc')
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const asCompat = (value: ReturnType<typeof createBrowserSuiClient>) => value as unknown as SuiGrpcJsonRpcCompatClient
function call<I extends object, O extends object>(request: I, response: O) {
  return new UnaryCall({ name: 'Fixture' } as RpcUnaryCall<I, O>['method'], {}, request,
    Promise.resolve({}), Promise.resolve(response), Promise.resolve({ code: 'OK', detail: '' }), Promise.resolve({}))
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('wires the provider to the browser factory without changing networks or wallet props', () => {
  const source = readFileSync('web/components/providers/app-providers.tsx', 'utf8')
  expect(source).toContain("import { createBrowserSuiClient } from '@/lib/sui/browser-client'")
  expect(source).toContain('return createBrowserSuiClient(name as SuiNetwork)')
  expect(source).toContain('createClient={createGrpcClient}')
  expect(source).toContain('defaultNetwork={defaultNetwork}')
  expect(source).toContain('<WalletProvider autoConnect theme={SOULIDITY_DAPP_KIT_THEME}>')
  expect(source).not.toContain('createSuiGrpcCompatClient')
})

it.each(['mainnet', 'testnet', 'devnet'] as const)('constructs the actual compat surface on the exact %s transport', async network => {
  const client = asCompat(createBrowserSuiClient(network))
  expect(client).toBeInstanceOf(SuiGrpcJsonRpcCompatClient)
  expect(client.network).toBe(network)
  expect(client.core).toBe(client.grpc.core); expect(client.cache).toBe(client.grpc.cache); expect(client.base).toBe(client.grpc.base)
  const failed = new Error('controlled transport stop')
  const fetcher = vi.fn().mockRejectedValue(failed); vi.stubGlobal('fetch', fetcher)
  await expect(client.grpc.ledgerService.getObject({ objectId: id(40) })).rejects.toThrow()
  expect(String(fetcher.mock.calls[0][0])).toBe(`${getSuiGrpcFullnodeUrl(network)}/sui.rpc.v2.LedgerService/GetObject`)
  expect(client.signAndExecuteTransaction).toBe(SuiGrpcJsonRpcCompatClient.prototype.signAndExecuteTransaction)
  expect(client.executeTransactionBlock).toBe(SuiGrpcJsonRpcCompatClient.prototype.executeTransactionBlock)
})

it('exposes normalized authenticated packages through the actual provider client .grpc', async () => {
  const client = asCompat(createBrowserSuiClient('mainnet'))
  const bytes = bcs.Object.serialize({ data: { Package: { id: id(40), version: '2',
    moduleMap: new Map([['sample', new Uint8Array([1, 2, 3])]]),
    typeOriginTable: [{ moduleName: 'sample', datatypeName: 'Item', package: id(30) }], linkageTable: new Map() } },
  owner: { Immutable: true }, previousTransaction: toBase58(new Uint8Array(32).fill(1)), storageRebate: '0' }).toBytes()
  const digest = toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('Object::'), ...bytes]), { dkLen: 32 }))
  // Intercept the actual generated service prototype, below the adapter proxy;
  // the factory, SuiGrpcClient, compat class and identity adapter remain real.
  const ledgerPrototype = Object.getPrototypeOf(client.grpc.ledgerService) as typeof client.grpc.ledgerService
  const get = vi.spyOn(ledgerPrototype, 'getObject').mockImplementation(request => call(request, {
    object: { objectId: id(40), version: 2n, digest, bcs: { value: bytes }, owner: { kind: 4 },
      package: { modules: [], typeOrigins: [], linkage: [] } } }))
  const identity = vi.spyOn(client.grpc.movePackageService, 'getPackage').mockImplementation(request => call(request, {
    package: { storageId: id(40), originalId: id(30), version: 2n, modules: [], typeOrigins: [], linkage: [] } }))
  const { response } = await client.grpc.ledgerService.getObject({ objectId: id(40), readMask: { paths: ['package'] } })
  expect(response.object?.package).toMatchObject({ storageId: id(40), originalId: id(30), version: 2n,
    modules: [{ name: 'sample', contents: new Uint8Array([1, 2, 3]) }],
    typeOrigins: [{ moduleName: 'sample', datatypeName: 'Item', packageId: id(30) }] })
  expect(get.mock.calls[0][0].readMask?.paths).toContain('bcs')
  expect(identity).toHaveBeenCalledTimes(1); expect(identity.mock.calls[0][0]).toEqual({ packageId: id(40) })
  const balance = vi.spyOn(client.grpc.core, 'getBalance').mockResolvedValue({ balance: {
    coinType: '0x2::sui::SUI', balance: '17', coinBalance: '17', addressBalance: '0' } })
  expect(await client.getBalance({ owner: id(9) })).toMatchObject({ totalBalance: '17', coinType: '0x2::sui::SUI' })
  expect(balance).toHaveBeenCalledExactlyOnceWith({ owner: id(9) })
})
