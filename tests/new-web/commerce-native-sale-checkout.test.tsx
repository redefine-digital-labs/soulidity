// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifyNativeSaleRetirement } from '../../web/lib/soulidity/commerce/native-sale-original-retirement'
import { PurchaseRecoveryImport } from '../../web/components/commerce/purchase-recovery-import'
import { parsePurchaseRecoveryOriginal } from '../../web/lib/soulidity/commerce/purchase-recovery-original'
import NativeSoulBuyPage from '../../web/app/souls/[id]/buy/native/page'
import { installNativeSaleGasSpends, nativeSaleGasSpendFixture, nativeSaleRetirementFixture } from './fixtures/native-sale-retirement'
import { nativeSaleCheckoutFixture } from './fixtures/native-sale-checkout'
import { nativeSaleLifecycleWireFixture } from './fixtures/commerce-native-sale-lifecycle-wire'
import { aid } from './fixtures/activity-transaction-evidence'
import type { NativeSaleCheckoutRelease } from '../../web/lib/soulidity/native-sale-checkout-config'
import { browserNativeSaleCheckoutJournal, nativeSaleCheckoutKey } from '../../web/lib/soulidity/native-sale-checkout-journal'
import { executeNativeSaleCheckout, prepareNativeSaleCheckout, recoverNativeSaleCheckout, reviewNativeSaleCheckout } from '../../web/lib/soulidity/native-sale-checkout'
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

async function setup() {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(42))
  const f = await nativeSaleCheckoutFixture(signer.toSuiAddress())
  rootInstallations.push(f.release)
  wallet.address = f.buyer; wallet.client = f.client
  const scope = { chainIdentifier: '35834a8a', soulId: f.soulId, author: f.buyer }, key = nativeSaleCheckoutKey(scope)
  const read = () => browserNativeSaleCheckoutJournal(true).read(key)
  const sign = vi.fn(async (tx: Transaction) => {
    expect((await read())?.packet.phase).toBe('SIGNING')
    return signer.signTransaction(await tx.build())
  })
  wallet.signTransaction.mockImplementation(sign)
  const getBuyerAddress = () => wallet.address
  const review = await reviewNativeSaleCheckout({ client: f.client, release: f.release, soulId: f.soulId, offerId: f.offerId, signal: signal() })
  const prepare = () => prepareNativeSaleCheckout({ client: f.client, release: f.release, review, buyer: f.buyer,
    buyerAccountId: f.buyerAccountId, paymentCoinIds: [f.payment], gasCoinIds: [f.gas], gasBudget: '1000', signal: signal(), getBuyerAddress })
  const execute = async (offerId = f.offerId) => executeNativeSaleCheckout({ record: (await read())!, client: f.client,
    activeOfferId: offerId, activeRelease: f.release, sign, signal: signal(), getBuyerAddress })
  return { ...f, review, read, key, scope, sign, prepare, execute }
}
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

it('uses the real buy route to quote, save, sign and submit only its original packet, then rediscovers it', async () => {
  const f = await setup()
  const route = Promise.resolve({ id: f.soulId })
  const render = () => act(async () => root.render(<NativeSoulBuyPage params={route} />))
  const simulate = f.client.transactionExecutionService.simulateTransaction.getMockImplementation()
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
  await type('Offer 对象 ID ', f.offerId)
  await click('核对 Offer 和总价')
  await text('总价 107')
  await type('买方 Account ', f.buyerAccountId)
  await type('付款 Coin IDs ', f.payment)
  await type('SUI Gas Coin IDs ', f.gas)
  await type('Gas 预算（MIST） ', '1000')
  await click('保留原件并模拟')
  await text('原件已保存并通过模拟。')
  await click('复核并签名原购买')
  await text('本次未查到原摘要。')
  const signed = (await f.read())!
  expect(signed.packet.phase).toBe('SIGNED')
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.client.core.executeTransaction).toHaveBeenCalledOnce()
  await act(async () => root.unmount()); root = createRoot(mount)
  await render()
  await click('读取本机原购买')
  await text(signed.packet.digest)
  expect(mount.querySelector('a[download]')?.getAttribute('href')).toContain(encodeURIComponent(signed.plan.originalText))
})

it('holds a locally retained packet on simulation failure and never lets a foreign head skip it', async () => {
  const f = await setup()
  f.client.transactionExecutionService.simulateTransaction.mockRejectedValueOnce(Error('SIMULATION_UNAVAILABLE'))
  await expect(f.prepare()).rejects.toThrow('SIMULATION_UNAVAILABLE')
  const old = (await f.read())!
  expect(old.packet.phase).toBe('PREPARED')
  await expect(f.prepare()).resolves.toMatchObject({ record: old, prepared: false })
  const port = createBrowserSameSoulHeadPort(f.client)
  await expect(assertSameSoulForeignHeads({ scopes: [f.scope], ownKeys: [], signal: signal(), port })).rejects.toThrow('ORIGINAL_RECOVERY_REQUIRED')
  const cancelled = await recoverNativeSaleCheckout({ record: old, client: f.client, signal: signal(), cancelUnsigned: true })
  expect(cancelled.record.packet.phase).toBe('CANCELLED')
  await expect(assertSameSoulForeignHeads({ scopes: [f.scope], ownKeys: [], signal: signal(), port })).resolves.toBeUndefined()
  expect((await f.prepare()).record.packet.digest).not.toBe(old.packet.digest)
  expect(await browserNativeSaleCheckoutJournal(true).history(f.key)).toEqual([cancelled.record])
  expect(f.sign).not.toHaveBeenCalled()
})

it('refuses a changed Offer or reviewed terms before signing', async () => {
  const f = await setup()
  const { record } = await f.prepare()
  await expect(f.execute(aid(999))).rejects.toThrow('SALE_CHECKOUT_SELECTED_OFFER_CHANGED')
  f.terms.ask += 1; f.updateOffer()
  await expect(f.execute()).rejects.toThrow('SALE_PREPARE_REVIEW_CHANGED')
  expect(await f.read()).toEqual(record)
  expect(f.sign).not.toHaveBeenCalled()
})

it('keeps an authenticated late signature through a wallet switch without sending it', async () => {
  const f = await setup(), sign = f.sign.getMockImplementation()!
  await f.prepare()
  f.sign.mockImplementationOnce(async tx => { const signed = await sign(tx); wallet.address = aid(999); return signed })
  await expect(f.execute()).rejects.toThrow('SALE_CHECKOUT_WALLET_OR_SOURCE_CHANGED')
  expect((await f.read())?.packet.phase).toBe('SIGNED')
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  wallet.address = f.buyer
  await expect(f.execute()).resolves.toMatchObject({ record: { packet: { phase: 'SIGNED' } }, result: { status: 'MISSING' } })
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.client.core.executeTransaction).toHaveBeenCalledOnce()
})

it('promotes an actual retained sale proof through the original settlement, custody and cleanup verifier', async () => {
  const f = await nativeSaleLifecycleWireFixture()
  const original = await parsePurchaseRecoveryOriginal(f.purchaseText, f.plan.soulId)
  if (original.kind !== 'native-sale-preparation.v1') throw Error('TEST_ORIGINAL_SCOPE')
  const { plan, packet } = original.value
  const scope = { chainIdentifier: '35834a8a', soulId: plan.soulId, author: plan.buyer }
  const key = nativeSaleCheckoutKey(scope), journal = browserNativeSaleCheckoutJournal()
  const record = { schema: 'soulidity.native-sale-checkout.v1' as const, plan: { ...scope, originalText: f.purchaseText, reviewedQuoteIdentity: 'saved' }, packet }
  await journal.exclusive(key, () => journal.write(key, record))
  const observed = await recoverNativeSaleCheckout({ record, client: f.client, signal: signal() })
  expect(observed).toMatchObject({ record: { packet: { phase: 'SUCCEEDED' } }, result: { status: 'SUCCEEDED' } })
  expect((await journal.read(key))?.packet.digest).toBe(packet.digest)
})

it('keeps the exact signed packet if live terms change before dispatch', async () => {
  const f = await setup(), sign = f.sign.getMockImplementation()!
  await f.prepare()
  f.sign.mockImplementationOnce(async tx => {
    const signed = await sign(tx)
    f.terms.ask += 1; f.updateOffer()
    return signed
  })
  await expect(f.execute()).rejects.toThrow('SALE_PREPARE_REVIEW_CHANGED')
  expect((await f.read())?.packet.phase).toBe('SIGNED')
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})

it('cold-discovers the original on the existing recovery page without the buyer wallet or a file', async () => {
  const f = await setup(), { record } = await f.prepare()
  wallet.address = null
  await act(async () => root.render(<PurchaseRecoveryImport soulId={f.soulId} createReadOnlyClient={() => f.client}/>))
  await click('读取本机独立 Native 原购买')
  await text(record.packet.digest)
  await click(record.packet.digest + ' · PREPARED')
  await click('查询原购买历史')
  await text('本次未查到原交易')
  expect(mount.querySelector('a[download]')?.getAttribute('href')).toContain(encodeURIComponent(record.plan.originalText))
  expect(await f.read()).toEqual(record)
  expect(f.sign).not.toHaveBeenCalled()
})

it('retires a refused Native purchase from its real checkout and archives before preparing a new packet', async () => {
  const f = await setup()
  await f.prepare()
  f.sign.mockRejectedValueOnce(Error('WALLET_REFUSED'))
  await expect(f.execute()).rejects.toThrow('WALLET_REFUSED')
  const original = (await f.read())!
  expect(original.packet.phase).toBe('SIGNING')
  const witness = await nativeSaleRetirementFixture(f.client, original.packet, f.gas)
  const route = Promise.resolve({ id: f.soulId })
  const search = Promise.resolve({ offer: f.offerId })
  await act(async () => root.render(<NativeSoulBuyPage params={route} searchParams={search} />))
  await click('读取本机原购买')
  await text(original.packet.digest)
  await click('核对过期并归档原购买')
  await text('已核对原购买过期且未执行')
  const retired = (await f.read())!
  expect(retired.packet).toEqual({ ...original.packet, phase: 'RETIRED' })
  expect(retired.retirement).toEqual(witness.recorded)
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()

  await expect(f.execute()).resolves.toMatchObject({ result: { status: 'RETIRED', retiredOriginalDigest: original.packet.digest } })
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 7n, referenceGasPrice: 1n } } })
  const next = await f.prepare()
  expect(next.prepared).toBe(true)
  expect(next.record.packet.digest).not.toBe(original.packet.digest)
  expect(await browserNativeSaleCheckoutJournal(true).history(f.key)).toEqual([retired])
  expect(witness.fetch).toHaveBeenCalledTimes(3)
  expect(f.sign).toHaveBeenCalledOnce()
  wallet.address = null
  await act(async () => root.render(<PurchaseRecoveryImport soulId={f.soulId} createReadOnlyClient={() => f.client} />))
  await click('读取本机独立 Native 原购买')
  await text(original.packet.digest)
  await click(original.packet.digest + ' · RETIRED')
  await click('查询原购买历史')
  await text('已重新核对原购买过期且未执行。证据检查点 812')
  expect(witness.fetch).toHaveBeenCalledTimes(4)
})

it.each([
  [{ epoch: 6 }, 'RETIREMENT_INDEX_CHECKPOINT'],
  [{ gasChanged: true }, 'RETIREMENT_GAS_CHANGED'],
  [{ originalFound: true }, 'RETIREMENT_INDEX_ORIGINAL_FOUND'],
  [{ differentCheckpoint: true }, 'RETIREMENT_CHECKPOINT_MISMATCH'],
] as const)('keeps the original reserved when the checkpoint or Coin witness disagrees (%j)', async (options, reason) => {
  const f = await setup(), { record } = await f.prepare()
  await nativeSaleRetirementFixture(f.client, record.packet, f.gas, options)
  await expect(recoverNativeSaleCheckout({ record, client: f.client, signal: signal(), retireExpired: true })).rejects.toThrow(reason)
  expect(await f.read()).toEqual(record)
  expect(f.sign).not.toHaveBeenCalled()
  expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
})

it('requires the exact digest query to remain missing after the checkpoint witness', async () => {
  const f = await setup(), { record } = await f.prepare()
  const witness = await nativeSaleRetirementFixture(f.client, record.packet, f.gas)
  const queryOriginal = vi.fn(async () => ({ status: 'PENDING' }))
  await expect(verifyNativeSaleRetirement({ client: f.client, packet: record.packet, author: f.buyer,
    signal: signal(), queryOriginal })).rejects.toThrow('RETIREMENT_ORIGINAL_FOUND')
  expect(queryOriginal).toHaveBeenCalledAfter(witness.getCheckpoint)
  await expect(verifyNativeSaleRetirement({ client: f.client, packet: { ...record.packet, digest: witness.recorded.digest }, author: f.buyer,
    signal: signal(), queryOriginal })).rejects.toThrow('RETIREMENT_PACKET')
  expect(witness.fetch).toHaveBeenCalledOnce()
  expect(await f.read()).toEqual(record)
})

it('walks two Gas Coin versions to a charged failed transaction that spent the exact original ref', async () => {
  const f = await setup()
  await f.prepare()
  await f.execute()
  const original = (await f.read())!
  const gas = { ...(await f.client.ledgerService.getObject({ objectId: f.gas })).response.object, objectType: '0x2::coin::Coin<0x2::sui::SUI>' }
  const first = await nativeSaleGasSpendFixture(gas, 702, { failure: true })
  const last = await nativeSaleGasSpendFixture(first.output, 703)
  const witness = await nativeSaleRetirementFixture(f.client, original.packet, f.gas, { observedGas: last.output })
  installNativeSaleGasSpends(f.client, [first, last], last.output)

  const recover = (conflictDigest?: string) => recoverNativeSaleCheckout({ record: original, client: f.client, signal: signal(),
    retireExpired: true, conflictDigest })
  await expect(recover(last.digest)).rejects.toThrow('NATIVE_SALE_CONFLICT_INPUT')
  expect(await f.read()).toEqual(original)
  await expect(recover()).resolves.toMatchObject({ result: { status: 'RETIRED' }, record: {
    packet: { ...original.packet, phase: 'RETIRED' },
    retirement: { ...witness.recorded, conflict: { digest: first.digest, checkpoint: '702', coinId: f.gas } },
  } })
  const retired = (await f.read())!
  expect(witness.fetch).toHaveBeenCalledOnce()
  // The authenticated spender rechecks through gRPC after the indexed Coin has moved again.
  witness.fetch.mockRejectedValue(Error('INDEX_UNAVAILABLE'))
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 7n, referenceGasPrice: 1n } } })
  const replacement = await f.prepare()
  expect(replacement.prepared).toBe(true)
  expect(await browserNativeSaleCheckoutJournal(true).history(f.key)).toEqual([retired])
  expect(witness.fetch).toHaveBeenCalledOnce()
  expect(f.sign).toHaveBeenCalledOnce()
})
