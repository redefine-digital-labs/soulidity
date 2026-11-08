// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import NativeSoulSellPage from '../../web/app/souls/[id]/list/native/page'
import { bcs } from '@mysten/sui/bcs'
import { NativeOfferBcs } from '../../web/lib/soulidity/commerce/economics-bcs'
import { readNativeSaleListingHistory } from '../../web/lib/soulidity/commerce/native-sale-relist'
import { readNativeSellerReview, type NativeSellerIntent } from '../../web/lib/soulidity/commerce/native-sale-seller-plan'
import { nativeSaleCheckoutFixture } from './fixtures/native-sale-checkout'
import { nativeSaleLifecycleWireFixture } from './fixtures/commerce-native-sale-lifecycle-wire'
import { aid } from './fixtures/activity-transaction-evidence'
import type { NativeSaleCheckoutRelease } from '../../web/lib/soulidity/native-sale-checkout-config'
import { browserNativeSellerJournal, nativeSellerKey } from '../../web/lib/soulidity/native-sale-seller-journal'
import { executeNativeSellerOriginal, prepareNativeSellerOriginal, reconcileNativeSellerOriginal } from '../../web/lib/soulidity/native-sale-seller'
import { assertSameSoulForeignHeads, createBrowserSameSoulHeadPort } from '../../web/lib/soulidity/same-soul-mutation-heads'

const rootInstallations = vi.hoisted(() => [] as NativeSaleCheckoutRelease[])
vi.mock('../../web/lib/soulidity/native-sale-checkout-config', async original => {
  const actual = await original<typeof import('../../web/lib/soulidity/native-sale-checkout-config')>()
  return { ...actual, nativeSaleCheckoutInstalled: (release: NativeSaleCheckoutRelease) => rootInstallations.includes(release)
    || rootInstallations.some(row => JSON.stringify(row) === JSON.stringify(release)),
  resolveNativeSaleCheckout: () => rootInstallations[0] ?? null }
})
const wallet = vi.hoisted(() => ({ address: null as string | null, client: null as any, signTransaction: vi.fn() }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({
  suiWallet: wallet.address ? { address: wallet.address } : null,
  getWalletAddress: () => wallet.address, suiGrpcClient: wallet.client, signTransaction: wallet.signTransaction,
}) }))
vi.mock('../../web/lib/sui/package-object-client', () => ({ withPackageObjectIdentity: (client: unknown) => client }))
vi.mock('../../web/lib/soulidity/native-public-read-paid-original-client-v2', () => ({ createNativePublicReadPaidOriginalClientV2: () => wallet.client }))
const signal = () => new AbortController().signal
let mount: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  localStorage.clear(); rootInstallations.length = 0; wallet.address = null; wallet.signTransaction.mockReset()
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (key: string, _options: unknown, work: (lock: unknown) => unknown) => {
      if (held.has(key)) return work(null)
      held.add(key)
      try { return await work({ name: key }) } finally { held.delete(key) }
    },
  } })
  mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount)
})
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function click(label: string) {
  await act(async () => {
    const button = [...mount.querySelectorAll('button')].find(node => node.textContent === label)
    expect(button, mount.textContent ?? '').toBeDefined()
    expect(button!.disabled).toBe(false)
    button!.click()
  })
}
async function text(value: string) {
  for (let n = 0; n < 120 && !mount.textContent?.includes(value); n++)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(mount.textContent).toContain(value)
}
async function type(label: string, value: string) {
  await act(async () => {
    const input = [...mount.querySelectorAll('label')].find(node => node.textContent === label)?.querySelector('input')
    expect(input).toBeDefined()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function setup(kind: NativeSellerIntent['kind'] = 'LIST') {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(43))
  const f = await nativeSaleCheckoutFixture(aid(990), signer.toSuiAddress())
  rootInstallations.push(f.release)
  wallet.address = f.seller; wallet.client = f.client
  const scope = { chainIdentifier: '35834a8a', soulId: f.soulId, author: f.seller }, key = nativeSellerKey(scope)
  const read = () => browserNativeSellerJournal(true).read(key)
  const sign = vi.fn(async (tx: Transaction) => {
    expect((await read())?.packet.phase).toBe('SIGNING')
    return signer.signTransaction(await tx.build())
  })
  wallet.signTransaction.mockImplementation(sign)
  const selection = { seller: f.seller, soulId: f.soulId, accountId: f.sellerAccountId }
  const intent: NativeSellerIntent = kind === 'CANCEL'
    ? { ...selection, kind, offerId: f.offerId }
    : { ...selection, kind, policyId: f.policyId, ask: '101', collectionId: null }
  const input = { intent, client: f.client, release: f.release, getSellerAddress: () => wallet.address }
  if (kind === 'CANCEL') f.reserveForCancellation()
  const review = () => readNativeSellerReview({ ...input, signal: signal() })
  const prepare = async () => prepareNativeSellerOriginal({ ...input, reviewedIdentity: (await review()).identity,
    gasCoinIds: [f.sellerGas], gasBudget: '1000', signal: signal() })
  const execute = async () => executeNativeSellerOriginal({ ...input, activeRelease: f.release, record: (await read())!, sign, signal: signal() })
  return { ...f, read, key, scope, sign, prepare, execute, review, input }
}

it('uses the real sell route to review, save, simulate and submit the same listing packet', async () => {
  const f = await setup()
  const route = Promise.resolve({ id: f.soulId })
  const render = () => act(async () => root.render(<NativeSoulSellPage params={route} />))
  const simulate = f.client.transactionExecutionService.simulateTransaction.getMockImplementation()!
  f.client.transactionExecutionService.simulateTransaction.mockImplementation(async request => {
    expect(request.checks).toBe(0); expect(request.doGasSelection).toBe(false)
    expect(toBase64(request.transaction.bcs.value)).toBe((await f.read())?.packet.bytes)
    return simulate(request)
  })
  f.client.core.executeTransaction.mockImplementation(async request => {
    const saved = (await f.read())!
    expect(saved.packet.phase).toBe('SIGNED')
    expect(toBase64(request.transaction)).toBe(saved.packet.bytes)
    expect(request.signatures).toEqual([saved.packet.signature])
  })
  await render()
  await type('卖方 Account ', f.sellerAccountId)
  await type('TransferPolicy ID ', f.policyId)
  await type('标价（最小单位） ', '101')
  await click('核对挂牌条件')
  await text('当前买家总价 107')
  await type('SUI Gas Coin IDs ', f.sellerGas)
  await type('Gas 预算（MIST） ', '1000')
  await click('保留原件并模拟')
  await text('原件已保存并通过模拟。')
  const prepared = (await f.read())!
  const call = bcs.TransactionData.fromBase64(prepared.packet.bytes).V1?.kind.ProgrammableTransaction?.commands[0].MoveCall
  expect(call).toMatchObject({ module: 'market', function: 'list' })
  await click('复核并签名原操作')
  await text('本次未查到原摘要。')
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.client.core.executeTransaction).toHaveBeenCalledOnce()
  expect((await f.read())?.packet.phase).toBe('SIGNED')

  await act(async () => root.unmount())
  root = createRoot(mount)
  wallet.address = null
  rootInstallations.length = 0
  await render()
  await click('读取本机挂牌和取消原件')
  await text(prepared.packet.digest)
  await click('查询原摘要')
  await text('本次未查到原摘要。')
  expect((await f.read())?.packet.phase).toBe('SIGNED')
})

it('cancels the exact active Offer without reading the live Config and holds the signed original on an unknown result', async () => {
  const f = await setup('CANCEL')
  f.rows.delete(f.release.target.configId)
  expect((await f.review()).total).toBeNull()
  const { record } = await f.prepare()
  const tx = bcs.TransactionData.fromBase64(record.packet.bytes).V1?.kind.ProgrammableTransaction
  expect(tx?.commands[0].MoveCall).toMatchObject({ module: 'market', function: 'cancel', typeArguments: [] })
  expect(tx?.inputs).toHaveLength(3)
  const getObject = f.client.ledgerService.getObject
  await expect(f.execute()).resolves.toMatchObject({ record: { packet: { phase: 'SIGNED' } }, result: { status: 'MISSING' } })
  expect(getObject.mock.calls.map(([request]) => request.objectId)).not.toContain(f.release.target.configId)
  await expect(f.prepare()).resolves.toMatchObject({ record: { packet: { digest: record.packet.digest, phase: 'SIGNED' } }, prepared: false })
  await expect(reconcileNativeSellerOriginal({ record: (await f.read())!, client: f.client, signal: signal(), cancelUnsigned: true }))
    .rejects.toThrow('SELLER_UNSIGNED_ONLY')
  const port = createBrowserSameSoulHeadPort(f.client)
  await expect(assertSameSoulForeignHeads({ scopes: [f.scope], ownKeys: [], signal: signal(), port })).rejects.toThrow('ORIGINAL_RECOVERY_REQUIRED')
})

it('retains the late signature after a wallet switch and retries only that same original', async () => {
  const f = await setup('CANCEL'), sign = f.sign.getMockImplementation()!
  const { record } = await f.prepare()
  f.sign.mockImplementationOnce(async tx => { const signed = await sign(tx); wallet.address = aid(991); return signed })
  await expect(f.execute()).rejects.toThrow('SELLER_WALLET_OR_SOURCE_CHANGED')
  expect((await f.read())?.packet).toMatchObject({ phase: 'SIGNED', digest: record.packet.digest, bytes: record.packet.bytes })
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  wallet.address = f.seller
  await expect(f.execute()).resolves.toMatchObject({ record: { packet: { digest: record.packet.digest } }, result: { status: 'MISSING' } })
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.client.core.executeTransaction).toHaveBeenCalledOnce()
})

it('preserves an unsigned original after simulation failure and archives only after proven local cancellation', async () => {
  const f = await setup('CANCEL')
  f.client.transactionExecutionService.simulateTransaction.mockRejectedValueOnce(Error('SIMULATION_UNAVAILABLE'))
  await expect(f.prepare()).rejects.toThrow('SIMULATION_UNAVAILABLE')
  const original = (await f.read())!
  expect(original.packet.phase).toBe('PREPARED')
  const cancelled = await reconcileNativeSellerOriginal({ record: original, client: f.client, signal: signal(), cancelUnsigned: true })
  expect(cancelled.record.packet.phase).toBe('CANCELLED')
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 6n, referenceGasPrice: 1n } } })
  const next = await f.prepare()
  expect(next.record.packet.digest).not.toBe(original.packet.digest)
  expect(await browserNativeSellerJournal(true).history(f.key)).toEqual([cancelled.record])
  expect(f.sign).not.toHaveBeenCalled()
})

it.each([false, true])('proves the created Offer and reservation without a known Offer or later purchase (Collection %s)', async withCollection => {
  const f = await nativeSaleLifecycleWireFixture('', withCollection), { plan, review, client } = f
  const digest = review.relistDigest
  const { response } = await client.ledgerService.getTransaction({ digest })
  const bytes = response.transaction.transaction.bcs.value
  const expirationEpoch = String(bcs.TransactionData.parse(bytes).V1?.expiration.Epoch)
  client.ledgerService.getTransaction.mockClear()
  const { state, creator, royalty, manifest, config_revision, root_revision, ask, generation } = NativeOfferBcs.parse(f.offer.contents.value)
  const binding = { ...plan, offerId: undefined, seller: review.seller, sellerAccountId: aid(211), ask, rootRevision: root_revision,
    reviewSnapshot: { state, creator, royalty, manifest, config_revision, generation } }
  const packet = { bytes: toBase64(bytes), digest, expirationEpoch, phase: 'PREPARED' as const, signature: null }
  const input = { client, native: review.target.native, packet, signal: signal() }
  await expect(readNativeSaleListingHistory({ ...input, plan: binding }))
    .resolves.toMatchObject({ status: 'RELIST_CONFIRMED', receipt: { offerId: review.purchasedOfferId, reviewChanged: false } })
  expect(client.ledgerService.getTransaction.mock.calls.every(([request]) => request.digest === digest)).toBe(true)
  await expect(readNativeSaleListingHistory({ ...input, plan: { ...binding, ask: '1' } })).rejects.toThrow('RELIST_TERMS')
  await expect(readNativeSaleListingHistory({ ...input, plan: { ...binding, reviewSnapshot: { ...binding.reviewSnapshot, config_revision: '1' } } }))
    .resolves.toMatchObject({ status: 'RELIST_CONFIRMED', receipt: { offerId: review.purchasedOfferId, reviewChanged: true } })
})
