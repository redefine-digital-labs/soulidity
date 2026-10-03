import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { collectionCommandTestDom, type CollectionCommandTestDom } from './fixtures/collection-command-dom'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useCollectionCommands, type CollectionCommandSubject } from '../../web/lib/hooks/use-collection-commands'
import { browserCollectionCommandStore, collectionCommandKey } from '../../web/lib/collections/collection-command-journal'
import { collectionCommandFixture, cid } from './fixtures/collection-command'

const h = vi.hoisted(() => ({ target: null as any, account: null as any, wallet: {} as any, client: null as any, sign: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignTransaction: () => ({ mutateAsync: h.sign }) }))
vi.mock('../../packages/soulidity-sdk/src/index.ts', async original => ({ ...await original<any>(),
  getPersonalKioskCapTypePackageAddress: () => h.target.personalKioskTypePackageId,
  getRequiredSoulidityEnv: (key: string) => ({ NEXT_PUBLIC_SOULIDITY_MARKET_CONFIG_V2_ID: h.target.marketConfigId,
    NEXT_PUBLIC_SOULIDITY_KIOSK_REGISTRY_ID: h.target.kioskRegistryId, NEXT_PUBLIC_SOULIDITY_PAYMENT_COIN_TYPE: h.target.paymentCoinType })[key],
}))
vi.mock('../../web/lib/animacraft/browser-native-config', () => ({ getBrowserNativeReceiveTarget: () => ({
  soulidityOriginalPackageId: h.target.originalPackageId, soulidityCallablePackageId: h.target.callablePackageId,
  soulidityCallableDigest: h.target.callableDigest,
}) }))

let dom: CollectionCommandTestDom, root: Root, host: HTMLDivElement, f: Awaited<ReturnType<typeof collectionCommandFixture>>
let current: ReturnType<typeof useCollectionCommands>, subject: CollectionCommandSubject | null, unmounted = false
const onSuccess = vi.fn()
function Probe() { current = useCollectionCommands(subject, onSuccess); return <div>{current.status}</div> }
const render = () => act(async () => root.render(<Probe />))
beforeEach(async () => {
  dom = collectionCommandTestDom('https://collection-hook.example.test')
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('navigator', dom.window.navigator)
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const locks = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (key: string, _options: unknown, fn: (lock: unknown) => Promise<unknown>) => {
    if (locks.has(key)) return fn(null); locks.add(key); try { return await fn({ name: key }) } finally { locks.delete(key) }
  } } })
  f = await collectionCommandFixture(); h.target = f.target; h.account = { address: f.author }; h.wallet = {}; h.client = { grpc: f.client }
  h.sign.mockReset(); h.sign.mockImplementation(async ({ transaction }) => f.signer.signTransaction(await transaction.build()))
  f.client.ledgerService.getTransaction.mockRejectedValue({ code: 'NOT_FOUND' })
  subject = { onChainId: f.c.id, name: 'Collection', listedPriceAtomic: null, listingObjectOnChainId: null }
  onSuccess.mockClear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); unmounted = false
  await render()
})
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); host.remove(); dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('mount/reconnect only discovers and queries; quote preparation persists bytes without opening wallet', async () => {
  expect(current.currentAddress).toBe(f.author); expect(current.targetKey).not.toBe('unavailable')
  expect(h.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  let record!: Awaited<ReturnType<typeof current.prepare>>
  await act(async () => { record = await current.prepare({ action: 'list', priceAtomic: '2000001' }) })
  expect(record.packet.phase).toBe('PREPARED'); expect(current.records[0]).toEqual(record)
  expect(browserCollectionCommandStore().read(collectionCommandKey(record.plan))).toEqual(record)
  expect(h.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
it.each(['prepare', 'run', 'importRecord'] as const)('retained %s callback is inert after actual unmount', async mode => {
  const stale = current; f.client.ledgerService.batchGetObjects.mockClear()
  await act(async () => root.unmount()); unmounted = true
  const work = mode === 'prepare' ? () => stale.prepare({ action: 'list', priceAtomic: '2000001' })
    : mode === 'run' ? () => stale.run(f.record, 'resume') : () => stale.importRecord(JSON.stringify(f.record))
  await expect(work()).rejects.toThrow('CONNECT_PREPARING_WALLET')
  expect(f.client.ledgerService.batchGetObjects).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it.each(['account', 'wallet', 'client', 'release', 'collection'] as const)('retained callback cannot reactivate after %s ABA', async kind => {
  const stale = current, account = h.account, wallet = h.wallet, client = h.client, target = h.target, originalSubject = subject
  if (kind === 'account') h.account = { address: cid(777) }
  if (kind === 'wallet') h.wallet = {}
  if (kind === 'client') h.client = { grpc: f.client }
  if (kind === 'release') h.target = { ...h.target, callablePackageId: cid(777) }
  if (kind === 'collection') subject = { ...subject!, onChainId: cid(777) }
  await render(); h.account = account; h.wallet = wallet; h.client = client; h.target = target; subject = originalSubject; await render()
  f.client.ledgerService.batchGetObjects.mockClear()
  await expect(stale.prepare({ action: 'list', priceAtomic: '2000001' })).rejects.toThrow('CONNECT_PREPARING_WALLET')
  expect(f.client.ledgerService.batchGetObjects).not.toHaveBeenCalled(); expect(h.sign).not.toHaveBeenCalled()
})
it('cold signed record is restored and only queried, including while disconnected', async () => {
  const store = browserCollectionCommandStore(), key = collectionCommandKey(f.plan)
  // The WAL write dispatches the live hook's discovery event; await its React updates too.
  await act(async () => { await store.exclusive(key, async () => store.write(key, f.record, true)) })
  h.account = null; h.wallet = null; await render()
  expect(current.records[0]).toEqual(f.record); expect(current.status).toContain('does not prove failure')
  expect(current.pending).toBe(false)
  expect(h.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(store.read(key)).toEqual(f.record)
})
it('unmount during raw preparation aborts before persisting a transaction', async () => {
  let release!: (value: any) => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const original = f.client.ledgerService.batchGetObjects.getMockImplementation()!
  f.client.ledgerService.batchGetObjects.mockImplementationOnce(async request => {
    entered(); return new Promise(resolve => { release = async () => resolve(await original(request)) })
  })
  let work!: Promise<unknown>
  await act(async () => { work = current.prepare({ action: 'list', priceAtomic: '2000001' }); void work.catch(() => {}); await started })
  await act(async () => root.unmount()); unmounted = true; release(undefined)
  await expect(work).rejects.toThrow()
  expect(browserCollectionCommandStore().read(collectionCommandKey(f.plan))).toBeNull(); expect(h.sign).not.toHaveBeenCalled()
})
it('late wallet result survives account ABA in the actual WAL without broadcasting or stale success UI', async () => {
  let prepared!: Awaited<ReturnType<typeof current.prepare>>
  await act(async () => { prepared = await current.prepare({ action: 'list', priceAtomic: '2000001' }) })
  let release!: (value: { bytes: string; signature: string }) => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  h.sign.mockImplementationOnce(async () => { entered(); return new Promise(resolve => { release = resolve }) })
  let work!: Promise<unknown>
  await act(async () => { work = current.run(prepared, 'resume'); void work.catch(() => {}); await started })
  const account = h.account; h.account = { address: cid(777) }; await render(); h.account = account; await render()
  await act(async () => { release({ bytes: prepared.packet.bytes, signature: f.record.packet.signature! }); await expect(work).rejects.toThrow() })
  const stored = browserCollectionCommandStore().read(collectionCommandKey(f.plan))!
  expect(stored.packet.phase).toBe('SIGNED'); expect(stored.packet.signature).toBe(f.record.packet.signature)
  expect(stored.packet.bytes).toBe(prepared.packet.bytes); expect(h.sign).toHaveBeenCalledTimes(1)
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled(); expect(onSuccess).not.toHaveBeenCalled()
})
it.each(['wallet', 'unmount'] as const)('confirmed history remains durable but a %s change during current refresh cannot return stale success to the modal', async mode => {
  const store = browserCollectionCommandStore(), key = collectionCommandKey(f.plan)
  await act(async () => { await store.exclusive(key, async () => store.write(key, f.record, true)) })
  f.client.ledgerService.getTransaction.mockImplementation(async () => ({ response: { transaction: structuredClone(f.evidence.ledger) } }))
  let release!: () => void, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve }), original = f.client.ledgerService.batchGetObjects.getMockImplementation()!
  f.client.ledgerService.batchGetObjects.mockImplementationOnce(async request => {
    entered(); return new Promise(resolve => { release = async () => resolve(await original(request)) })
  })
  let work!: Promise<unknown>; const staleModalSuccess = vi.fn()
  await act(async () => { work = current.run(f.record, 'resume'); void work.then(staleModalSuccess, () => {}); await started })
  expect(store.read(key)?.packet.phase).toBe('SUCCEEDED'); expect(onSuccess).toHaveBeenCalled()
  if (mode === 'wallet') { h.account = { address: cid(777) }; await render() }
  else { await act(async () => root.unmount()); unmounted = true }
  release(); await expect(work).rejects.toThrow()
  expect(store.read(key)?.packet.phase).toBe('SUCCEEDED'); expect(staleModalSuccess).not.toHaveBeenCalled()
  expect(h.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})
