// Real hook, browser journal, run/import state machines, React and React Query.
// Raw domain parsing/preparation/adapter and current-root RPC are controlled:
// this isolates UI lifecycle/recovery and is NOT purchase authority evidence.
import React, { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useCollectionBuy, getCollectionBuyTarget } from '../../web/lib/hooks/use-collection-buy'
import { CollectionPurchasePanel } from '../../web/components/collections/collection-purchase-panel'
import type { CollectionCommandSubject } from '../../web/lib/hooks/use-collection-commands'
import type { CollectionBuyPlan, CollectionBuyRecord, CollectionBuyQuery, CollectionBuyTarget } from '../../web/lib/collections/collection-buy-plan'
import type { createCollectionBuyAdapter } from '../../web/lib/collections/collection-buy-operation'
import { browserCollectionBuyStore, collectionBuyKey, COLLECTION_BUY_CHANGED } from '../../web/lib/collections/collection-buy-journal'
import { publicMutationCanonical } from '../../web/lib/sui/public-mutation-journal'
import { collectionBuyUIRecord, buyTarget, buyDeferred, buyId } from './fixtures/newcollection-buy-ui'
import { collectionCommandTestDom, type CollectionCommandTestDom } from './fixtures/collection-command-dom'

type AdapterOptions = Parameters<typeof createCollectionBuyAdapter>[0]
type PlanOptions = Parameters<typeof import('../../web/lib/collections/collection-buy-state').prepareCollectionBuyPlan>[0]
const h = vi.hoisted(() => ({ account: null as { address: string } | null, wallet: null as object | null,
  client: {} as { grpc?: object }, target: null as CollectionBuyTarget | null, configError: false,
  sign: vi.fn<AdapterOptions['sign']>(), query: vi.fn<(record: CollectionBuyRecord) => Promise<CollectionBuyQuery>>(),
  raw: vi.fn(), preparePlan: vi.fn<(options: PlanOptions) => Promise<CollectionBuyPlan>>(),
  preparePacket: vi.fn<(plan: CollectionBuyPlan) => Promise<CollectionBuyRecord>>(), broadcast: vi.fn(), verify: vi.fn(),
  adapters: [] as AdapterOptions[], parser: vi.fn<(input: unknown) => CollectionBuyRecord>(),
}))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignTransaction: () => ({ mutateAsync: (options: { transaction: Transaction }) => h.sign(options.transaction) }) }))
vi.mock('../../web/lib/hooks/use-collection-commands', () => ({ getCollectionCommandTarget: () => {
  if (h.configError) throw Error('CONTROLLED_RELEASE_UNAVAILABLE')
  const { kioskPackageId: _kiosk, collectionTransferPolicyId: _policy, ...target } = h.target!; return target
} }))
vi.mock('@soulidity/sdk', async original => ({ ...await original<typeof import('@soulidity/sdk')>(),
  getKioskPackageAddress: () => h.target!.kioskPackageId,
  getRequiredSoulidityEnv: (name: string) => { if (name !== 'NEXT_PUBLIC_SOULIDITY_COLLECTION_TRANSFER_POLICY_ID') throw Error('Unexpected env request'); return h.target!.collectionTransferPolicyId },
  readCollectionPublicRoot: (...args: unknown[]) => h.raw(...args),
}))
vi.mock('../../web/lib/collections/collection-buy-plan', async original => ({ ...await original<typeof import('../../web/lib/collections/collection-buy-plan')>(),
  parseCollectionBuyPlan: (input: CollectionBuyPlan) => structuredClone(input),
}))
vi.mock('../../web/lib/collections/collection-buy-state', () => ({ prepareCollectionBuyPlan: (options: PlanOptions) => h.preparePlan(options) }))
vi.mock('../../web/lib/collections/collection-buy-operation', () => ({ parseCollectionBuyRecord: (input: unknown) => h.parser(input),
  createCollectionBuyAdapter: (options: AdapterOptions) => {
    h.adapters.push(options)
    const guard = async (record: CollectionBuyRecord, signing: boolean) => {
      if (options.getAddress() !== record.plan.author) throw Error('CONTROLLED_BUYER_OR_LIFECYCLE_CHANGED')
      await options.preflight?.(record.plan, signing)
    }
    return { prepare: async (plan: CollectionBuyPlan) => { await options.preflight?.(plan, true); return h.preparePacket(plan) },
      preflight: guard, sign: async (record: CollectionBuyRecord) => options.sign(Transaction.from(fromBase64(record.packet.bytes))),
      verifySignature: (record: CollectionBuyRecord) => h.verify(record),
      broadcast: (record: CollectionBuyRecord) => h.broadcast(record), query: (record: CollectionBuyRecord) => h.query(record) }
  },
}))

type Purchase = ReturnType<typeof useCollectionBuy>
let host: HTMLDivElement, root: Root, query: QueryClient, record: CollectionBuyRecord, current: Purchase, dom: CollectionCommandTestDom
let subject: CollectionCommandSubject, unmounted: boolean, remountKey: number, invalidateOnSuccess: boolean, showPanel: boolean
const onSuccess = vi.fn(), renders: Purchase[] = []
function Probe() { current = useCollectionBuy(subject, () => { onSuccess(); if (invalidateOnSuccess) void query.invalidateQueries({ queryKey: ['collections'] }) })
  renders.push(current); return showPanel
    ? <CollectionPurchasePanel purchase={current} offered={!!subject.listingObjectOnChainId} expanded onExpand={() => {}} />
    : <div>{current.status}{current.error}{current.currentObservation}</div> }
async function render(strict = false) { await act(async () => root.render(<QueryClientProvider client={query}>
  {strict ? <StrictMode><Probe key={remountKey} /></StrictMode> : <Probe key={remountKey} />}
</QueryClientProvider>)) }
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function save(r: CollectionBuyRecord) { await act(async () => {
  const store = browserCollectionBuyStore(), key = collectionBuyKey(r.plan); await store.exclusive(key, async () => store.write(key, r, true))
}) }
const stored = () => browserCollectionBuyStore().read(collectionBuyKey(record.plan))
async function prepared() { let r!: CollectionBuyRecord; await act(async () => { r = await current.prepare() }); return r }
beforeEach(async () => {
  dom = collectionCommandTestDom('https://collection-buy-ui.example.test')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement); vi.stubGlobal('Storage', dom.window.Storage); vi.stubGlobal('Event', dom.window.Event)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor)
  window.localStorage.clear(); const locks = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (key: string, _options: unknown, work: (lock: unknown) => Promise<unknown>) => {
    if (locks.has(key)) return work(null); locks.add(key); try { return await work({ name: key }) } finally { locks.delete(key) }
  } } })
  record = await collectionBuyUIRecord(); h.target = buyTarget(); h.account = { address: record.plan.author }; h.wallet = {}; h.client = { grpc: {} }; h.configError = false
  h.adapters.length = 0; h.sign.mockReset().mockResolvedValue({ bytes: record.packet.bytes, signature: 'CONTROLLED_PUBLIC_SIGNATURE' })
  h.query.mockReset().mockResolvedValue({ status: 'MISSING' }); h.verify.mockReset().mockResolvedValue(undefined); h.broadcast.mockReset().mockResolvedValue(undefined)
  h.raw.mockReset().mockResolvedValue({ collection: { current_holder: record.plan.author } })
  h.parser.mockReset().mockImplementation(input => structuredClone(input) as CollectionBuyRecord)
  h.preparePlan.mockReset().mockImplementation(async options => ({ ...structuredClone(record.plan), target: options.target, author: options.author, request: options.request }))
  h.preparePacket.mockReset().mockImplementation(async plan => ({ ...structuredClone(record), plan, packet: { ...record.packet, phase: 'PREPARED', signature: null } }))
  subject = { onChainId: record.plan.request.collectionId, name: 'Collection', listedPriceAtomic: '1000001', listingObjectOnChainId: record.plan.request.listingId }
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } }); onSuccess.mockReset(); renders.length = 0
  remountKey = 0; invalidateOnSuccess = false; unmounted = false; showPanel = false
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); query.clear(); host.remove(); dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('Review stores fixed bytes and quote through the real journal, without signing/broadcast or success', async () => {
  await render(); const result = await prepared()
  expect(result.packet.phase).toBe('PREPARED'); expect(stored()).toEqual(result); expect(current.records).toEqual([result])
  expect(h.preparePlan).toHaveBeenCalledWith(expect.objectContaining({ client: h.client.grpc, target: getCollectionBuyTarget(), author: record.plan.author,
    request: { collectionId: subject.onChainId, listingId: subject.listingObjectOnChainId }, signal: expect.any(AbortSignal) }))
  expect(current.status).toContain('Review the full USDC quote'); expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled()
})
it('actual panel Review→Sign controls drive the real hook/journal without combining review and payment', async () => {
  showPanel = true; await render()
  const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)
  await act(async () => button('Review purchase transaction')!.click())
  expect(stored()?.packet.phase).toBe('PREPARED'); expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled()
  expect(host.textContent).toContain('Total USDC payment: 1.025002 USDC'); expect(host.textContent).toContain('0.001000001 SUI')
  await act(async () => button('Sign and buy')!.click())
  expect(stored()?.packet.phase).toBe('SIGNED'); expect(h.sign).toHaveBeenCalledOnce(); expect(h.broadcast).toHaveBeenCalledOnce()
  expect(button('Review purchase transaction')).toBeUndefined(); expect(button('Cancel unsigned purchase')).toBeUndefined()
  expect(button('Resume same purchase')).toBeTruthy(); expect(onSuccess).not.toHaveBeenCalled()
})
it('actual panel recovers a disappeared listing publicly without exposing another payment', async () => {
  record.packet.phase = 'SIGNED'; record.packet.signature = 'CONTROLLED_PUBLIC_SIGNATURE'; await save(record)
  subject.listingObjectOnChainId = null; h.account = null; h.wallet = null; showPanel = true; await render()
  const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === name)
  expect(button('Review purchase transaction')).toBeUndefined(); expect(button('Resume same purchase')?.disabled).toBe(true)
  await act(async () => button('Query purchase')!.click()); expect(h.query).toHaveBeenCalledTimes(2)
  await act(async () => button('Export purchase recovery')!.click())
  expect(JSON.parse(host.querySelector<HTMLTextAreaElement>('#collection-purchase-export')!.value)).toEqual(record)
  expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled()
})
it('explicit resume signs and broadcasts only the exact saved transaction, keeping an unknown result recoverable', async () => {
  await render(); const result = await prepared(); await act(async () => { await current.run(result, 'resume') })
  expect(h.sign).toHaveBeenCalledOnce(); expect(h.broadcast).toHaveBeenCalledOnce()
  expect(stored()?.packet).toMatchObject({ phase: 'SIGNED', bytes: result.packet.bytes, digest: result.packet.digest, signature: 'CONTROLLED_PUBLIC_SIGNATURE' })
  expect(current.status).toContain('does not prove failure'); expect(onSuccess).not.toHaveBeenCalled()
})
it.each(['SIGNING', 'SIGNED'] as const)('cold %s unknown receipt remains query-only and blocks a replacement intent even after listing/release changes', async phase => {
  record.packet.phase = phase; record.packet.signature = phase === 'SIGNED' ? 'CONTROLLED_PUBLIC_SIGNATURE' : null
  await save(record); subject.listingObjectOnChainId = buyId(999); h.target = { ...h.target!, callablePackageId: buyId(998) }; await render()
  expect(current.records).toEqual([record]); expect(h.query).toHaveBeenCalledWith(record)
  await act(async () => { await expect(current.prepare()).rejects.toThrow('RECOVERY_REQUIRED') })
  expect(stored()).toEqual(record); expect(h.preparePacket).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled()
})
it('cold disconnected discovery and manual query do not require a signing wallet', async () => {
  record.packet.phase = 'SIGNED'; record.packet.signature = 'CONTROLLED_PUBLIC_SIGNATURE'; await save(record); h.account = null; h.wallet = null
  await render(); expect(current.currentAddress).toBeNull(); expect(current.records).toEqual([record])
  await act(async () => { await current.run(record, 'query') })
  expect(h.query).toHaveBeenCalledTimes(2); expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled()
  await expect(current.run(record, 'resume')).rejects.toThrow('CONNECT_PURCHASING_WALLET')
})
it.each(['wallet', 'release'] as const)('%s replacement still permits query but fails closed before resume/sign', async kind => {
  await render(); const result = await prepared()
  if (kind === 'wallet') h.account = { address: buyId(800) }; else h.target = { ...h.target!, collectionTransferPolicyId: buyId(801) }
  await render(); await act(async () => { await current.run(result, 'query') })
  await act(async () => { await expect(current.run(result, 'resume')).rejects.toThrow(kind === 'wallet' ? 'BUYER_OR_LIFECYCLE_CHANGED' : 'RELEASE_CHANGED_QUERY_ONLY') })
  expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled(); expect(stored()?.packet.phase).toBe('PREPARED')
})
it('canonical release field reordering leaves identity and preflight usable', async () => {
  await render(); const identity = current.identityKey, old = current, result = await prepared()
  h.target = Object.fromEntries(Object.entries(h.target!).reverse()) as CollectionBuyTarget; await render()
  expect(current.identityKey).toBe(identity); expect(current.targetKey).toBe(publicMutationCanonical(record.plan.target))
  await act(async () => { await old.run(result, 'resume') }); expect(h.sign).toHaveBeenCalledOnce()
})
it('explicit unsigned cancellation retains bytes without signature/broadcast', async () => {
  await render(); const result = await prepared(); h.account = null; h.wallet = null; await render()
  await act(async () => { await current.run(result, 'cancel-unsigned') })
  expect(stored()?.packet).toEqual({ ...result.packet, phase: 'CANCELLED' }); expect(current.status).toContain('Cancelled before')
  expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled()
})
it.each(['SIGNING', 'SIGNED'] as const)('cannot cancel %s as an unsigned packet', async phase => {
  record.packet.phase = phase; record.packet.signature = phase === 'SIGNED' ? 'CONTROLLED_PUBLIC_SIGNATURE' : null
  await save(record); await render(); await act(async () => { await expect(current.run(record, 'cancel-unsigned')).rejects.toThrow('CANNOT_CANCEL_UNKNOWN_SIGNATURE') })
  expect(stored()?.packet.phase).toBe(phase); expect(h.sign).not.toHaveBeenCalled()
})
it('public import queries and saves before explicit resume; export reparses the exact saved packet', async () => {
  h.account = null; h.wallet = null; await render()
  await act(async () => { await current.importRecord(JSON.stringify(record)) })
  expect(stored()).toEqual(record); expect(h.query).toHaveBeenCalledWith(record); expect(current.status).toContain('before explicitly resuming')
  h.parser.mockClear(); expect(JSON.parse(current.exportRecord(record))).toEqual(record); expect(h.parser).toHaveBeenCalledWith(record)
  expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled()
})
it.each(['', '{broken', ' '.repeat(3 * 1024 * 1024 + 1)])('rejects empty, malformed or over-budget import without journal write', async input => {
  await render(); await act(async () => { await expect(current.importRecord(input)).rejects.toThrow() })
  expect(stored()).toBeNull(); expect(h.query).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled(); expect(current.error).toBeTruthy()
})
it('rejects imported/selected records for another Collection without querying them', async () => {
  await render(); const other = structuredClone(record); other.plan.request.collectionId = buyId(900)
  await act(async () => { await expect(current.importRecord(JSON.stringify(other))).rejects.toThrow('IMPORT_COLLECTION_MISMATCH')
    await expect(current.run(other, 'query')).rejects.toThrow('SELECTED_COLLECTION_CHANGED') })
  expect(h.query).not.toHaveBeenCalled(); expect(stored()).toBeNull()
})
it.each(['account', 'same-address-account', 'wallet', 'client', 'release', 'collection', 'listing'] as const)('%s A→B→A does not reactivate old callbacks or adapter wallet authority', async kind => {
  await render(); const stale = current, old = { account: h.account, wallet: h.wallet, client: h.client, target: h.target, subject }
  const packet = await prepared(), oldAdapter = h.adapters.at(-1)!
  if (kind === 'account') h.account = { address: buyId(80) }
  if (kind === 'same-address-account') h.account = { address: record.plan.author }
  if (kind === 'wallet') h.wallet = {}
  if (kind === 'client') h.client = { grpc: {} }
  if (kind === 'release') h.target = { ...h.target!, callableDigest: 'other-release' }
  if (kind === 'collection') subject = { ...subject, onChainId: buyId(81) }
  if (kind === 'listing') subject = { ...subject, listingObjectOnChainId: buyId(82) }
  await render(); h.account = old.account; h.wallet = old.wallet; h.client = old.client; h.target = old.target; subject = old.subject; await render()
  h.preparePlan.mockClear(); h.query.mockClear()
  for (const work of [() => stale.prepare(), () => stale.run(packet, 'query'), () => stale.importRecord(JSON.stringify(packet))])
    await expect(work()).rejects.toThrow('CONNECT_PURCHASING_WALLET')
  expect(oldAdapter.getAddress()).toBeNull(); await expect(oldAdapter.sign(Transaction.from(fromBase64(packet.packet.bytes)))).rejects.toThrow()
  expect(h.preparePlan).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  expect(current.identityKey).not.toBe(stale.identityKey)
})
it('stale callbacks cannot start work after actual unmount', async () => {
  await render(); const stale = current; await act(async () => root.unmount()); unmounted = true
  await expect(stale.prepare()).rejects.toThrow('CONNECT_PURCHASING_WALLET')
  await expect(stale.run(record, 'query')).rejects.toThrow('CONNECT_PURCHASING_WALLET')
  await expect(stale.importRecord(JSON.stringify(record))).rejects.toThrow('CONNECT_PURCHASING_WALLET')
  expect(h.preparePlan).not.toHaveBeenCalled(); expect(h.query).not.toHaveBeenCalled()
})
it.each(['unmount', 'wallet', 'release'] as const)('%s during raw preparation aborts before saving late bytes or status', async kind => {
  await render(); const gate = buyDeferred<CollectionBuyPlan>(); h.preparePlan.mockReturnValueOnce(gate.promise)
  let work!: Promise<unknown>; await act(async () => { work = current.prepare(); void work.catch(() => {}) })
  const signal = h.preparePlan.mock.calls.at(-1)![0].signal!
  if (kind === 'unmount') { await act(async () => root.unmount()); unmounted = true }
  else { if (kind === 'wallet') h.wallet = {}; else h.target = { ...h.target!, marketConfigId: buyId(99) }; await render() }
  expect(signal.aborted).toBe(true)
  await act(async () => { gate.resolve(record.plan); await expect(work).rejects.toThrow() })
  expect(stored()).toBeNull(); expect(h.preparePacket).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
  if (!unmounted) { expect(current.pending).toBe(false); expect(current.error).toBeNull(); expect(current.status).toBeNull() }
})
it('a late wallet signature survives wallet ABA in the real journal but cannot broadcast or publish stale success', async () => {
  await render(); const packet = await prepared(), wallet = h.wallet, gate = buyDeferred<{ bytes: string; signature: string }>()
  h.sign.mockReturnValueOnce(gate.promise); let work!: Promise<unknown>
  await act(async () => { work = current.run(packet, 'resume'); void work.catch(() => {}); await Promise.resolve() }); await settle()
  expect(h.sign).toHaveBeenCalledOnce(); expect(stored()?.packet.phase).toBe('SIGNING')
  h.wallet = {}; await render(); h.wallet = wallet; await render()
  await act(async () => { gate.resolve({ bytes: packet.packet.bytes, signature: 'CONTROLLED_LATE_SIGNATURE' }); await expect(work).rejects.toThrow() })
  expect(stored()?.packet).toMatchObject({ bytes: packet.packet.bytes, phase: 'SIGNED', signature: 'CONTROLLED_LATE_SIGNATURE' })
  expect(h.broadcast).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled(); expect(current.status ?? '').not.toContain('confirmed')
})
it('local exclusivity rejects parallel prepare/query/import before a second domain operation', async () => {
  await render(); const gate = buyDeferred<CollectionBuyPlan>(); h.preparePlan.mockReturnValueOnce(gate.promise)
  let work!: Promise<unknown>; await act(async () => { work = current.prepare(); void work.catch(() => {}) })
  await expect(current.prepare()).rejects.toThrow('LOCAL_OPERATION_BUSY'); await expect(current.run(record, 'query')).rejects.toThrow('LOCAL_OPERATION_BUSY')
  await expect(current.importRecord(JSON.stringify(record))).rejects.toThrow('LOCAL_OPERATION_BUSY')
  expect(h.preparePlan).toHaveBeenCalledOnce(); expect(h.query).not.toHaveBeenCalled()
  await act(async () => { gate.resolve(record.plan); await work }); expect(current.pending).toBe(false)
})
it('successful historical result reads current custody with exactly the six public deployment keys and refreshes once', async () => {
  await render(); const packet = await prepared(); h.query.mockResolvedValue({ status: 'SUCCEEDED', checkpoint: '42' })
  await act(async () => { await current.run(packet, 'query') })
  expect(h.raw).toHaveBeenCalledOnce(); const args = h.raw.mock.calls[0][0]
  expect(Object.keys(args.deployment).sort()).toEqual(['chainIdentifier', 'originalPackageId', 'marketConfigId', 'paymentCoinType', 'kioskRegistryId', 'personalKioskTypePackageId'].sort())
  expect(args).toMatchObject({ client: h.client.grpc, collectionId: subject.onChainId, signal: expect.any(AbortSignal) })
  expect(current.currentObservation).toContain('purchasing wallet'); expect(current.status).toContain('checkpoint 42'); expect(onSuccess).toHaveBeenCalledOnce()
  expect(h.sign).not.toHaveBeenCalled(); expect(h.broadcast).not.toHaveBeenCalled()
})
it.each(['changed', 'unavailable'] as const)('current custody %s does not erase historical confirmation', async kind => {
  await render(); const packet = await prepared(); h.query.mockResolvedValue({ status: 'SUCCEEDED', checkpoint: '42' })
  if (kind === 'changed') h.raw.mockResolvedValue({ collection: { current_holder: buyId(400) } }); else h.raw.mockRejectedValue(Error('RPC offline'))
  await act(async () => { await current.run(packet, 'query') })
  expect(stored()?.packet.phase).toBe('SUCCEEDED'); expect(current.status).toContain('confirmed')
  expect(current.currentObservation).toContain(kind === 'changed' ? 'custody has changed' : 'Historical purchase confirmation is unchanged')
  expect(onSuccess).toHaveBeenCalledOnce()
})
it.each(['wallet', 'collection', 'unmount'] as const)('%s during current observation cannot publish a late result or invoke onSuccess', async kind => {
  await render(); const packet = await prepared(), gate = buyDeferred<unknown>(); h.raw.mockReturnValueOnce(gate.promise)
  h.query.mockResolvedValue({ status: 'SUCCEEDED', checkpoint: '42' }); let work!: Promise<unknown>
  await act(async () => { work = current.run(packet, 'query'); void work.catch(() => {}); await Promise.resolve() }); await settle()
  expect(h.raw).toHaveBeenCalledOnce(); expect(stored()?.packet.phase).toBe('SUCCEEDED')
  const signal = h.raw.mock.calls[0][0].signal as AbortSignal
  if (kind === 'unmount') { await act(async () => root.unmount()); unmounted = true }
  else { if (kind === 'wallet') h.wallet = {}; else subject = { ...subject, onChainId: buyId(901) }; await render() }
  expect(signal.aborted).toBe(true)
  await act(async () => { gate.resolve({ collection: { current_holder: record.plan.author } }); await expect(work).rejects.toThrow() })
  expect(stored()?.packet.phase).toBe('SUCCEEDED'); expect(onSuccess).not.toHaveBeenCalled()
  if (kind === 'collection') expect(current.currentObservation).toBeNull()
})
it('cold confirmed receipts do not invoke onSuccess/invalidate forever across refresh, remount and StrictMode replay', async () => {
  record.packet.phase = 'SUCCEEDED'; await save(record); h.query.mockResolvedValue({ status: 'SUCCEEDED', checkpoint: '42' })
  invalidateOnSuccess = true; const invalidate = vi.spyOn(query, 'invalidateQueries')
  await render(true); await settle(); expect(current.status).toContain('confirmed')
  for (let i = 0; i < 3; i++) { remountKey++; await render(true); await settle() }
  expect(onSuccess).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled()
  await act(async () => { await current.run(current.records[0], 'query') })
  expect(onSuccess).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('root StrictMode retires a failed preparation without overwriting the replayed session', async () => {
  const first = buyDeferred<CollectionBuyPlan>()
  h.preparePlan.mockReturnValueOnce(first.promise).mockResolvedValue(record.plan)
  function PrepareOnCommit() {
    const purchase = useCollectionBuy(subject)
    current = purchase
    React.useLayoutEffect(() => { void purchase.prepare().catch(() => {}) }, [])
    return <div>{purchase.error}</div>
  }
  // StrictMode must wrap the root: nesting it inside a non-strict provider does
  // not replay initial effects in React 19, leaving the retired lease untested.
  await act(async () => root.render(<StrictMode><QueryClientProvider client={query}><PrepareOnCommit /></QueryClientProvider></StrictMode>))
  await settle()
  expect(h.preparePlan).toHaveBeenCalledTimes(2)
  expect(current.error).toBeNull()
  await act(async () => first.reject(new Error('RETIRED_FIRST_LEASE_FAILURE')))
  await settle()
  expect(current.error).toBeNull()
  expect(host.textContent).not.toContain('RETIRED_FIRST_LEASE_FAILURE')
  expect(h.sign).not.toHaveBeenCalled()
  expect(h.broadcast).not.toHaveBeenCalled()
})
it('cold newly confirmed receipt invokes success once, and subsequent remount reads the retained terminal phase', async () => {
  record.packet.phase = 'SIGNED'; record.packet.signature = 'CONTROLLED_PUBLIC_SIGNATURE'; await save(record)
  h.query.mockResolvedValue({ status: 'SUCCEEDED', checkpoint: '42' }); await render(); expect(onSuccess).toHaveBeenCalledOnce()
  expect(stored()?.packet.phase).toBe('SUCCEEDED'); remountKey++; await render(); expect(onSuccess).toHaveBeenCalledOnce()
})
it.each(['PENDING', 'FAILED'] as const)('%s is surfaced without an invented success or custody claim', async status => {
  await save(record); h.query.mockResolvedValue({ status, checkpoint: '42' }); await render()
  expect(current.status).toContain(status === 'PENDING' ? 'Final checkpoint pending' : 'failed on chain')
  expect(h.raw).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('storage notification refreshes visible records without signing, and storage failure is visible', async () => {
  await render(); await save(record); expect(current.records).toEqual([record]); expect(h.query).not.toHaveBeenCalled()
  await act(async () => window.dispatchEvent(new Event('storage'))); expect(current.records).toEqual([record])
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('Storage unavailable') })
  await act(async () => window.dispatchEvent(new Event(COLLECTION_BUY_CHANGED)))
  expect(current.error).toBe('Storage unavailable'); expect(h.sign).not.toHaveBeenCalled(); read.mockRestore()
})
it('missing wallet, raw reader, listing or release cannot silently prepare a new payment', async () => {
  await render(); h.wallet = null; await render(); await expect(current.prepare()).rejects.toThrow('CONNECT_PURCHASING_WALLET')
  h.wallet = {}; h.client = {}; await render(); await expect(current.prepare()).rejects.toThrow('CONNECT_PURCHASING_WALLET')
  h.client = { grpc: {} }; subject.listingObjectOnChainId = null; await render()
  await act(async () => { await expect(current.prepare()).rejects.toThrow('NO_VERIFIED_LISTING') })
  subject.listingObjectOnChainId = record.plan.request.listingId; h.configError = true; await render()
  await act(async () => { await expect(current.prepare()).rejects.toThrow('CONTROLLED_RELEASE_UNAVAILABLE') })
  expect(h.preparePlan).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
