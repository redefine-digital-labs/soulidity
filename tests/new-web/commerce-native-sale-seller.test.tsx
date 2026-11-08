// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64, toHex } from '@mysten/sui/utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import NativeSoulSellPage from '../../web/app/souls/[id]/list/native/page'
import { bcs } from '@mysten/sui/bcs'
import { NativeOfferBcs } from '../../web/lib/soulidity/commerce/economics-bcs'
import { buildNativeSaleGraph } from '../../web/lib/soulidity/commerce/native-sale-graph'
import { decodeNativeSaleClosingPurchase, readNativeSaleClosingPacket } from '../../web/lib/soulidity/commerce/native-sale-original-graph'
import { readNativeSaleListingHistory } from '../../web/lib/soulidity/commerce/native-sale-relist'
import { readNativeSellerReview, type NativeSellerIntent } from '../../web/lib/soulidity/commerce/native-sale-seller-plan'
import { nativeSaleCheckoutFixture } from './fixtures/native-sale-checkout'
import { nativeSaleCancellationFixture } from './fixtures/commerce-sale-cancellation'
import { nativeSaleLifecycleWireFixture, objectRow } from './fixtures/commerce-native-sale-lifecycle-wire'
import { aid } from './fixtures/activity-transaction-evidence'
import type { NativeSaleCheckoutRelease } from '../../web/lib/soulidity/native-sale-checkout-config'
import { browserNativeSellerJournal, nativeSellerKey, type NativeSellerRecord } from '../../web/lib/soulidity/native-sale-seller-journal'
import { exportNativeSaleListing, verifyNativeSaleSellerSettlement } from '../../web/lib/soulidity/native-sale-seller-settlement'
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

async function settledListingFixture(withCollection = false, variant = '') {
  const f = await nativeSaleLifecycleWireFixture(variant, withCollection)
  const { review, plan, client } = f
  const { response } = await client.ledgerService.getTransaction({ digest: review.relistDigest })
  const bytes = response.transaction.transaction.bcs.value
  const tx = Transaction.from(bytes).getData()
  const shared = tx.inputs.flatMap(input => input.Object?.SharedObject ? [input.Object.SharedObject] : [])
  const account = tx.inputs[shared.length].Object!.ImmOrOwnedObject!
  const { state, creator, royalty, config_revision, generation, manifest, root_revision, ask } = NativeOfferBcs.parse(f.offer.contents.value)
  const listing: NativeSellerRecord = {
    schema: 'soulidity.native-sale-seller.v1',
    plan: { release: { target: review.target, economics: review.economics, collection: review.collection },
      intent: { kind: 'LIST', soulId: review.soulId, seller: review.seller, accountId: account.objectId,
        policyId: plan.policyId, collectionId: plan.collectionId, ask },
      kioskId: plan.sellerKioskId, account: { objectId: account.objectId, version: String(account.version), digest: account.digest },
      shared: shared.map(row => ({ objectId: row.objectId, initialSharedVersion: String(row.initialSharedVersion), mutable: row.mutable })),
      gas: { budget: String(tx.gasData.budget), price: String(tx.gasData.price), coins: tx.gasData.payment!.map(row => ({ ...row, version: String(row.version) })) },
      expirationEpoch: '6', offerDigest: null,
      snapshot: { state, creator, royalty, config_revision, generation, rootRevision: root_revision, manifestHex: toHex(manifest) } },
    packet: { bytes: toBase64(bytes), digest: review.relistDigest, expirationEpoch: '6', phase: 'PREPARED', signature: null },
  }
  client.ledgerService.getTransaction.mockClear()
  const verifyInput = { soulId: review.soulId, listingText: exportNativeSaleListing(listing), client: client as never, signal: signal() }
  return { ...f, listingObject: f.listing, listing, verifyInput, verify: () => verifyNativeSaleSellerSettlement({ ...verifyInput, purchaseText: f.purchaseText }) }
}

it.each([false, true])('verifies seller proceeds and new buyer custody with the exact original Offer and reservation (Collection %s)', async withCollection => {
  const f = await settledListingFixture(withCollection), { review } = f
  await expect(f.verify()).resolves.toMatchObject({ status: 'SETTLEMENT_CONFIRMED', listingDigest: review.relistDigest,
    purchaseDigest: review.purchaseDigest, offerId: review.purchasedOfferId, seller: review.seller, buyer: review.buyer,
    sellerReceived: '101', creator: f.creator, creatorRoyalty: '3', protocolIncome: '3', gasMist: '3',
    total: withCollection ? '113' : '107', collectionRoyalty: withCollection ? '6' : '0',
    payouts: expect.arrayContaining([{ owner: review.seller, amount: '101', coinId: expect.any(String) }]),
  })
  const queries = f.client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)
  expect(queries).toContain(review.relistDigest)
  expect(queries).toContain(review.purchaseDigest)
  expect(queries).not.toContain(review.cancelDigest)
})

it('refuses a purchase whose historical reservation output does not come from the selected listing', async () => {
  const f = await settledListingFixture(false, 'substituted-listing')
  await expect(f.verify()).rejects.toThrow('NATIVE_SELLER_SETTLEMENT_LISTING_INPUT')
})

async function choose(label: string, content: string) {
  const file = { name: 'original.json', size: new TextEncoder().encode(content).length, text: async () => content }
  await act(async () => {
    const input = [...mount.querySelectorAll('label')].find(node => node.textContent === label)?.querySelector('input')
    expect(input).toBeDefined()
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input!.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

it('links the verified Offer and reopens settlement without either wallet or browser storage on the real seller route', async () => {
  const f = await settledListingFixture(true), { review, listing } = f
  wallet.client = f.client
  showLatestOffer(f, f.purchaseRows.get(`${review.purchasedOfferId}:10`))
  const key = nativeSellerKey({ chainIdentifier: '35834a8a', soulId: review.soulId, author: review.seller }), journal = browserNativeSellerJournal()
  await journal.exclusive(key, () => journal.write(key, listing))
  const route = Promise.resolve({ id: review.soulId })
  const render = () => act(async () => root.render(<NativeSoulSellPage params={route} />))
  await render()
  await click('读取本机挂牌和取消原件')
  await text(review.relistDigest)
  await click('查询原摘要')
  await text('已确认原挂牌')
  expect(mount.querySelector('a[href*="/buy/native?offer="]')?.getAttribute('href'))
    .toBe(`/souls/${review.soulId}/buy/native?offer=${review.purchasedOfferId}`)
  const href = mount.querySelector('a[download]')?.getAttribute('href')!
  const original = decodeURIComponent(href.slice(href.indexOf(',') + 1))
  expect(JSON.parse(original).packet).toMatchObject({ phase: 'PREPARED', signature: null, digest: review.relistDigest })

  await act(async () => root.unmount()); root = createRoot(mount)
  localStorage.clear()
  await render()
  await choose('原挂牌 JSON ', original)
  await click('核对原挂牌与成交')
  await text('已核对原挂牌、成交分账和买方托管交接。')
  await choose('买方原购买 JSON ', f.purchaseText)
  await click('核对原挂牌与成交')
  await text('已核对原挂牌、成交分账和买方托管交接。')
  await text('合集版税 6')
  await text('总价 113')
  expect(wallet.signTransaction).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
})

type SettledFixture = Awaited<ReturnType<typeof settledListingFixture>>
function showLatestOffer(f: SettledFixture, row: SettledFixture['offer'] | undefined) {
  const read = f.client.ledgerService.getObject.getMockImplementation()!
  f.client.ledgerService.getObject.mockImplementation(async request => {
    if (request.version === undefined && request.objectId === f.plan.offerId) {
      if (!row) throw { code: 'NOT_FOUND' }
      return { response: { object: row } }
    }
    return read(request)
  })
}

it.each([false, true])('locates the closing transaction from Offer BCS and proves the full purchase without a buyer file (Collection %s)', async withCollection => {
  const f = await settledListingFixture(withCollection)
  const { review, plan } = f
  showLatestOffer(f, f.purchaseRows.get(`${plan.offerId}:10`))
  await expect(verifyNativeSaleSellerSettlement(f.verifyInput)).resolves.toMatchObject({ status: 'SETTLEMENT_CONFIRMED',
    listingDigest: review.relistDigest, purchaseDigest: review.purchaseDigest, buyer: plan.buyer, offerId: plan.offerId,
    total: withCollection ? '113' : '107', collectionRoyalty: withCollection ? '6' : '0', sellerReceived: '101' })
})

it('accepts an exact closing digest after the current Offer is unavailable and refuses a different listing', async () => {
  const f = await settledListingFixture()
  showLatestOffer(f, undefined)
  await expect(verifyNativeSaleSellerSettlement(f.verifyInput)).resolves.toEqual({ status: 'OFFER_UNAVAILABLE', offerId: f.plan.offerId })
  await expect(verifyNativeSaleSellerSettlement({ ...f.verifyInput, closingDigest: f.review.purchaseDigest }))
    .resolves.toMatchObject({ status: 'SETTLEMENT_CONFIRMED', purchaseDigest: f.review.purchaseDigest })
  await expect(verifyNativeSaleSellerSettlement({ ...f.verifyInput, closingDigest: f.review.cancelDigest }))
    .rejects.toThrow('CANCEL_GRAPH')
})

it('reports the original Offer as active without treating it as a completed purchase', async () => {
  const f = await settledListingFixture()
  showLatestOffer(f, f.offer)
  await expect(verifyNativeSaleSellerSettlement(f.verifyInput)).resolves.toEqual({ status: 'OFFER_ACTIVE', offerId: f.plan.offerId })
  expect(f.client.ledgerService.getTransaction.mock.calls.every(([request]) => request.digest === f.review.relistDigest)).toBe(true)
})

it('authenticates the cancellation of the same listing from its Offer writer and full reservation evidence', async () => {
  const f = await settledListingFixture(), { review, plan, client } = f
  const terms = NativeOfferBcs.parse(f.offer.contents.value)
  const closure = await nativeSaleCancellationFixture(plan.configId, {
    terms, registryId: plan.registryId, native: review.target.native, custody: review.target.custody,
    checkpoint: '110', outputVersion: Number(f.offer.version) + 1,
    intent: { soulId: plan.soulId, offerId: plan.offerId, seller: review.seller, kioskId: plan.sellerKioskId, accountId: f.listing.plan.intent.accountId },
    priorListing: { digest: review.relistDigest, offerBirth: Number(f.offer.version), purchaseCapId: terms.purchase!.id },
  })
  const digest = closure.f.ledger.digest
  const active = closure.rows.get(`${plan.offerId}:${closure.inputVersion}`)
  expect(active.digest).toBe(f.offer.digest)
  expect(closure.rows.get(`${closure.listingId}:${closure.inputVersion}`).digest).toBe(f.listingObject.digest)

  const getTransaction = client.ledgerService.getTransaction.getMockImplementation()!
  client.ledgerService.getTransaction.mockImplementation(request => request.digest === digest
    ? Promise.resolve({ response: { transaction: closure.f.ledger } }) : getTransaction(request))
  const getCheckpoint = client.ledgerService.getCheckpoint.getMockImplementation()!
  client.ledgerService.getCheckpoint.mockImplementation(request => request.checkpointId.sequenceNumber === 110n
    ? Promise.resolve({ response: { checkpoint: closure.f.checkpoint } }) : getCheckpoint(request))
  const getObject = client.ledgerService.getObject.getMockImplementation()!
  client.ledgerService.getObject.mockImplementation(async request => {
    const { objectId, version } = request
    const row = version === undefined ? undefined : closure.rows.get(`${objectId}:${version}`)
    return row ? { response: { object: row } } : getObject(request)
  })
  showLatestOffer(f, closure.rows.get(`${plan.offerId}:${closure.outputVersion}`))
  await expect(verifyNativeSaleSellerSettlement(f.verifyInput)).resolves.toEqual({
    status: 'CANCELLATION_CONFIRMED', offerId: plan.offerId, digest, checkpoint: '110',
  })
  expect(client.ledgerService.getTransaction.mock.calls.map(([request]) => request.digest)).not.toContain(review.purchaseDigest)
})

it('requires an Offer writer to prove the exact terminal object returned by automatic discovery', async () => {
  const f = await settledListingFixture()
  const actual = f.purchaseRows.get(`${f.plan.offerId}:10`)!
  const raw = bcs.Object.parse(actual.bcs.value)
  raw.data.Move!.version = '11'
  showLatestOffer(f, objectRow(actual.objectId, actual.objectType, raw))
  await expect(verifyNativeSaleSellerSettlement(f.verifyInput)).rejects.toThrow('NATIVE_CLOSURE_OFFER_OUTPUT')
  await expect(verifyNativeSaleSellerSettlement({ ...f.verifyInput, closingDigest: f.review.purchaseDigest }))
    .resolves.toMatchObject({ status: 'SETTLEMENT_CONFIRMED' })
})

it('extracts ordered merged payment refs and rejects an extra call in a recovered transaction', async () => {
  const f = await settledListingFixture(true), { plan, client } = f
  const merged = structuredClone(plan)
  const second = { objectId: aid(989), version: '1', digest: merged.paymentCoins[0].digest, balance: '10' }
  merged.paymentCoins.push(second)
  const { soulId, offerId, callablePackageId, coinType, registryId, configId, policyId, sellerKioskId, collectionId } = plan
  const expected = { soulId, offerId, callablePackageId, coinType, registryId, configId, policyId, sellerKioskId, collectionId }
  async function observe(transaction: Transaction) {
    const value = await transaction.build(), digest = TransactionDataBuilder.getDigestFromBytes(value)
    client.ledgerService.getTransaction.mockResolvedValueOnce({ response: { transaction: {
      digest, transaction: { digest, bcs: { value } },
    } } } as never)
    return readNativeSaleClosingPacket(client as never, digest, signal())
  }
  const original = await observe(buildNativeSaleGraph(merged))
  expect(decodeNativeSaleClosingPurchase(original!, expected).shape.paymentCoins)
    .toEqual(merged.paymentCoins.map(row => ({ ...row, balance: '1' })))
  const extra = buildNativeSaleGraph(merged)
  extra.moveCall({ target: `${plan.callablePackageId}::market::total` })
  const changed = await observe(extra)
  expect(() => decodeNativeSaleClosingPurchase(changed!, expected)).toThrow('NATIVE_CLOSURE_BUY_GRAPH')
})
