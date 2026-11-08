// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { bcs } from '@mysten/sui/bcs'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toBase64 } from '@mysten/sui/utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SoulContentReadPage from '../../web/app/souls/[id]/read/page'
import type { NativePaidCheckoutInstallationV2 } from '../../web/lib/soulidity/native-public-read-paid-checkout-config-v2'
import { browserNativePublicReadPaidJournalV2, nativePublicReadPaidKeyV2 } from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import { PaidContentOfferBcs } from '../../web/lib/soulidity/commerce/paid-content-policy'
import { completePreflightFixture } from './fixtures/commerce-new-paid-preflight'
import { fixture as currentContentFixture } from './fixtures/commerce-recovery-current-content'
import { aid } from './fixtures/activity-transaction-evidence'

const transport = vi.hoisted(() => ({
  client: null as any, wallet: null as any, installed: [] as NativePaidCheckoutInstallationV2[], useWallet: vi.fn(),
}))

vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({
  useWalletSign: () => { transport.useWallet(); return transport.wallet },
}))
vi.mock('../../web/lib/sui/package-object-client', () => ({
  withPackageObjectIdentity: (client: unknown) => client,
}))
vi.mock('../../web/lib/soulidity/native-public-read-record-v2', async importOriginal => {
  const original = await importOriginal<typeof import('../../web/lib/soulidity/native-public-read-record-v2')>()
  return { ...original, readNativePublicReadOverviewV2: (input: Parameters<typeof original.readNativePublicReadOverviewV2>[0]) =>
    original.readNativePublicReadOverviewV2({ ...input, client: transport.client }) }
})
vi.mock('../../web/lib/soulidity/native-public-read-paid-checkout-config-v2', async importOriginal => {
  const original = await importOriginal<typeof import('../../web/lib/soulidity/native-public-read-paid-checkout-config-v2')>()
  return { ...original, resolveNativePaidCheckoutV2: (release: string, economics?: string) =>
    original.resolveNativePaidCheckoutV2(release, economics, transport.installed) }
})
vi.mock('../../web/components/souls/native-public-paid-content-reader-v2', () => ({
  NativePublicPaidContentReaderV2: () => <p>Protected reader</p>,
}))
vi.mock('../../web/components/souls/management-native-grant-reader-v1', () => ({
  ManagementNativeGrantReaderV1: () => <p>Grant reader</p>,
}))
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))

let host: HTMLDivElement
let root: Root
let query: QueryClient

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  window.localStorage.clear()
  transport.installed = []
  transport.useWallet.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (name: string, _options: unknown, work: (lock: unknown) => unknown) => {
      if (held.has(name)) return work(null)
      held.add(name)
      try { return await work({ name }) } finally { held.delete(name) }
    },
  } })
})
afterEach(async () => {
  await act(async () => root.unmount())
  query.clear()
  host.remove()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function install(params: Awaited<ReturnType<typeof completePreflightFixture>>['params']) {
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_PUBLIC_READ_V2_TARGET_JSON', JSON.stringify(params.target))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_ECONOMICS_TARGET_JSON', JSON.stringify(params.economics))
  const qualifySource = vi.fn(async () => {})
  transport.installed = [{ activationKey: 'offline-test', target: params.target, economics: params.economics,
    execution: { isCurrent: () => true, qualifySource } }]
  return qualifySource
}

async function render(soulId: string) {
  const params = Promise.resolve({ id: soulId })
  const rerender = async () => act(async () => root.render(
    <QueryClientProvider client={query}><SoulContentReadPage params={params}/></QueryClientProvider>,
  ))
  await rerender()
  return rerender
}
async function visible(content: string) {
  for (let i = 0; i < 100 && !host.textContent?.includes(content); i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  }
  expect(host.textContent).toContain(content)
}
function button(label: string) {
  const value = [...host.querySelectorAll('button')].find(element => element.textContent === label)
  expect(value, label).toBeDefined()
  return value!
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function chooseFunds(paymentId: string, gasId: string) {
  const payment = host.querySelector('select')!
  expect([...payment.options].map(option => option.value)).toEqual(['', paymentId])
  const firstGas = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
    .find(coin => coin.parentElement!.textContent!.includes(paymentId))!
  await act(async () => firstGas.click())
  await act(async () => {
    payment.value = paymentId
    payment.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const gasChoices = [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
  expect(gasChoices).toHaveLength(1)
  expect(gasChoices[0].parentElement?.textContent).toContain(gasId)
  expect(gasChoices[0].checked).toBe(false)
  await act(async () => gasChoices[0].click())
  const budget = host.querySelector<HTMLInputElement>('input[inputmode=numeric]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  const setBudget = async (value: string) => act(async () => {
    setValue.call(budget, value)
    budget.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await setBudget('101')
  expect(button('确认所选付款 Coin 和 Gas').disabled).toBe(true)
  await setBudget('10')
  expect(button('确认所选付款 Coin 和 Gas').disabled).toBe(false)
  await click('确认所选付款 Coin 和 Gas')
}

async function buyerFixture() {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(83))
  const x = await completePreflightFixture('', signer.toSuiAddress())
  const ids = [x.input.paymentCoin.objectId, x.input.gas.coins[0].objectId]
  x.client.core.listOwnedObjects = vi.fn(async () => ({
    objects: ids.map(objectId => ({ objectId })), hasNextPage: false,
  }))
  x.client.ledgerService.getTransaction = vi.fn(async () => { throw { code: 'NOT_FOUND' } })
  x.client.ledgerService.getCheckpoint = vi.fn(async () => { throw Error('UNEXPECTED_CHECKPOINT') })
  const read = () => browserNativePublicReadPaidJournalV2().read(nativePublicReadPaidKeyV2({
    chainIdentifier: x.params.target.chainIdentifier, soulId: x.params.soulId, author: x.buyer,
  }))
  x.client.core.executeTransaction = vi.fn(async (request: any) => {
    const retained = await read()
    expect(retained?.packet.phase).toBe('SIGNED')
    expect(toBase64(request.transaction)).toBe(retained?.packet.bytes)
    expect(request.signatures).toEqual([retained?.packet.signature])
  })
  transport.client = x.client
  transport.wallet = { suiWallet: { address: x.buyer }, suiGrpcClient: x.client,
    getWalletAddress: () => transport.wallet.suiWallet.address,
    signTransaction: vi.fn(async tx => signer.signTransaction(await tx.build())) }
  return { x, ids, read, qualifySource: install(x.params) }
}

it('selects verified funds on the real route, sends the retained bytes, and recovers the same digest on a cold entry', async () => {
  const { x, ids, read, qualifySource } = await buyerFixture()
  await render(x.params.soulId)
  await visible('核对内容总价和付款选项')
  await click('核对内容总价和付款选项')
  await visible('总价 104（最小单位）')
  expect(host.textContent).toContain('直接收入 101 · 协议费用 3')
  expect(x.client.core.listOwnedObjects).toHaveBeenCalledTimes(2)
  await chooseFunds(ids[0], ids[1])
  expect(await read()).toBeNull()
  await click('准备并模拟内容购买')
  await visible('原记录返回核对与模拟已完成')
  const prepared = (await read())!
  const original = JSON.parse(prepared.plan.originalText)
  expect(original.intent.paymentCoin.objectId).toBe(ids[0])
  expect(original.reviewedGas).toMatchObject({ budget: '10', price: '1', coins: [{ objectId: ids[1] }] })
  expect(transport.wallet.signTransaction).not.toHaveBeenCalled()
  expect(x.client.core.executeTransaction).not.toHaveBeenCalled()

  await click('核对并签名发送原购买')
  await visible('本次未查到原结果')
  expect(transport.wallet.signTransaction).toHaveBeenCalledOnce()
  expect(qualifySource).toHaveBeenCalledTimes(2)
  expect(x.client.core.executeTransaction).toHaveBeenCalledOnce()
  const simulationCount = x.client.transactionExecutionService.simulateTransaction.mock.calls.length

  await act(async () => root.unmount())
  query.clear()
  root = createRoot(host)
  await render(x.params.soulId)
  await visible('核对内容总价和付款选项')
  await click('核对内容总价和付款选项')
  await visible('总价 104（最小单位）')
  await chooseFunds(ids[0], ids[1])
  await click('准备并模拟内容购买')
  await visible('已读回原操作记录')
  expect(host.textContent).toContain(prepared.packet.digest)
  expect(host.textContent).toContain('原总价 104（最小单位）')
  expect(x.client.ledgerService.getTransaction.mock.calls.some(([request]: any) => request.digest === prepared.packet.digest)).toBe(true)
  expect((await read())?.plan.originalText).toBe(prepared.plan.originalText)
  expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledTimes(simulationCount)
  expect(x.client.core.executeTransaction).toHaveBeenCalledOnce()
})

it('reuses a live Entry even when the offer has been removed, before any funding lookup', async () => {
  const x = await currentContentFixture()
  const { chainIdentifier: _, ...foundation } = x.params.economics.foundation
  const params = { ...x.params, economics: { ...x.params.economics, foundation } }
  const listOwnedObjects = vi.fn()
  transport.client = x.f.client
  transport.wallet = { suiWallet: { address: x.buyer }, suiGrpcClient: { ...x.f.client, core: { ...x.f.client.core, listOwnedObjects } },
    getWalletAddress: () => x.buyer }
  install(params)
  await render(x.params.soulId)
  await visible('核对内容总价和付款选项')
  await click('核对内容总价和付款选项')
  await visible('已有内容资格，请直接读取当前版本。')
  expect(listOwnedObjects).not.toHaveBeenCalled()
  expect(host.querySelector('select')).toBeNull()
  expect(window.localStorage.length).toBe(0)
})

it('revokes a reviewed selection on a wallet change and keeps an unmatched release disabled', async () => {
  const { x, ids, read } = await buyerFixture()
  const rerender = await render(x.params.soulId)
  await visible('核对内容总价和付款选项')
  await click('核对内容总价和付款选项')
  await visible('总价 104（最小单位）')
  await chooseFunds(ids[0], ids[1])
  transport.wallet = { ...transport.wallet, suiWallet: { address: aid(999) } }
  await rerender()
  expect(host.textContent).not.toContain('准备并模拟内容购买')
  expect(await read()).toBeNull()
  expect(x.client.core.executeTransaction).not.toHaveBeenCalled()
  transport.useWallet.mockClear()
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_NATIVE_ECONOMICS_TARGET_JSON', JSON.stringify({
    ...x.params.economics, foundation: { ...x.params.economics.foundation, callablePackageId: aid(555) },
  }))
  await rerender()
  await visible('内容购买预检尚未开放。')
  expect(transport.useWallet).not.toHaveBeenCalled()
})

it('requires a new review when the contract total changes before saving any original', async () => {
  const { x, ids, read } = await buyerFixture()
  await render(x.params.soulId)
  await visible('核对内容总价和付款选项')
  await click('核对内容总价和付款选项')
  await visible('总价 104（最小单位）')
  await chooseFunds(ids[0], ids[1])

  const type = `0x2::dynamic_field::Field<u32,${x.params.target.content!.originalPackageId}::paid_access::Offer>`
  const field = bcs.struct('Field', { id: bcs.Address, name: bcs.u32(), value: PaidContentOfferBcs })
  x.f.object(x.offerId, type, field.serialize({ id: x.offerId, name: x.record.kind,
    value: { ...x.input.reviewed.offer!, price: 110, revision: 3 } }).toBytes(), x.ledger.offers.id)

  await click('准备并模拟内容购买')
  await visible('报价或购买条件已变化，请重新核对付款选项。')
  expect(await read()).toBeNull()
  expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
  expect(transport.wallet.signTransaction).not.toHaveBeenCalled()
})
