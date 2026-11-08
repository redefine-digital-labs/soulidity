// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Page from '../../web/app/income/maker/page'
import RecoveryPage from '../../web/app/income/maker/recovery/page'
import { makerProductIncomeControllerFixture } from './fixtures/maker-product-income'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
import { createRootMakerProductIncomeController } from '../../web/lib/soulidity/commerce/maker-product-income-controller'
import { makerProductIncomeOperationFromOriginal } from '../../web/lib/soulidity/maker-product-income-journal'
import { makerProductIncomeFundKey } from '../../web/lib/soulidity/maker-product-income-journal'
const controlled = vi.hoisted(() => ({ account: null as string | null, controller: null as any, wallet: {}, suiClient: {}, sign: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => {
  let cached: { address: string } | null = null
  return { useCurrentAccount: () => {
    if (!controlled.account) return cached = null
    if (cached?.address !== controlled.account) cached = { address: controlled.account }
    return cached
  }, useCurrentWallet: () => ({ currentWallet: controlled.wallet }), useSuiClient: () => controlled.suiClient,
  useSignTransaction: () => ({ mutateAsync: controlled.sign }) }
})
vi.mock('../../web/lib/soulidity/configured-maker-product-income', () => ({ createConfiguredMakerProductIncomeController: () => controlled.controller }))
let root: Root, node: HTMLDivElement, x: Awaited<ReturnType<typeof makerProductIncomeControllerFixture>>
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor); window.localStorage.clear(); controlled.sign.mockReset()
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, _options: unknown, work: (lock: unknown) => unknown) => {
    if (held.has(name)) return work(null); held.add(name); try { return await work({ name }) } finally { held.delete(name) }
  } } })
  x = await makerProductIncomeControllerFixture(); controlled.account = x.actor; controlled.controller = x.controller
  node = document.createElement('div'); document.body.append(node); root = createRoot(node)
})
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const render = async () => { await act(async () => root.render(<Page/>)) }
const wait = async (test: string | (() => boolean)) => { for (let i = 0; i < 150; i++) { if (typeof test === 'string' ? node.textContent?.includes(test) : test()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) }) } throw Error('UI_EXPECTED ' + test + ' ' + node.textContent) }
const element = (label: string) => [...node.querySelectorAll('input,select')].find(el => el.getAttribute('aria-label') === label) as HTMLInputElement | HTMLSelectElement
async function input(label: string, value: string) {
  await act(async () => { const target = element(label); const proto = target.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(target, value); target.dispatchEvent(new Event(target.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}
const click = async (text: string, twice = false) => { await act(async () => { const button = [...node.querySelectorAll('button')].find(el => el.textContent === text)!; button.click(); if (twice) button.click(); await new Promise(resolve => setTimeout(resolve, 20)) }) }
async function selectInstalled() { await input('Root 已安装来源', x.installation.acceptedManifestSha256); await input('Product ID', x.productId); await input('Control 对象', x.controlId) }
async function fillDraft(addressGas = false) {
  await input('提款金额', x.draft.amount); await input('收款地址', x.draft.recipient); await input('Gas 预算', x.draft.gasBudget); await input('Gas 价格', x.draft.gasPrice)
  const gasLabel = addressGas ? '使用 SUI 地址余额支付 Gas' : '选择 Gas ' + x.gasId
  await act(async () => (element(gasLabel) as HTMLInputElement).click())
  await input('到期 Epoch', x.draft.expirationEpoch); await input('操作标识', x.draft.attemptHex)
  await act(async () => (element('确认本次审阅') as HTMLInputElement).click()); await click('锁定本次审阅')
}
it.each([false, true])('reviews and retains an exact withdrawal through the actual Maker Product page (address Gas %s)', async addressGas => {
  if (addressGas) {
    x = await makerProductIncomeControllerFixture(1, undefined, true)
    controlled.account = x.actor
    controlled.controller = x.controller
    const random = crypto.getRandomValues.bind(crypto)
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
      if (array instanceof Uint32Array && array.length === 1) { array[0] = 73; return array }
      return random(array)
    })
  }
  await render(); await selectInstalled(); await click('读取 Product 收益与当前资格'); await wait('账本余额（最小单位）：150')
  expect(node.querySelector('[aria-label="新提款预检"]')).toBeNull()
  if (addressGas) expect(node.textContent).toContain('没有已核验的可选 SUI Coin 对象')
  await fillDraft(addressGas)
  await click('准备并模拟新提款', true); await wait('提款尚未签名或执行')
  const key = makerProductIncomeFundKey(x.target), raw = JSON.parse(window.localStorage.getItem(key)!)
  expect(raw.packet.phase).toBe('PREPARED'); expect(raw.packet.signature).toBeNull()
  expect(raw.packet.bytes).toBe(x.packet.bytes); expect(raw.packet.digest).toBe(x.packet.digest)
  expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ checks:0, doGasSelection:false }), expect.anything())
  expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledOnce()
  expect(node.querySelector('[aria-label="原提款恢复文件"] a[download]')).not.toBeNull()
  await act(async () => root.render(<RecoveryPage/>)); await wait('载入时本机阶段：PREPARED')
  expect(node.querySelector('[aria-label="选定 Product 原件"] a[download]')?.getAttribute('href')).toContain(encodeURIComponent(x.originalText))
  await click('查询 Product 原提款'); await wait('原交易核对状态：MISSING')
  await click('重新模拟 Product 原字节'); await wait('原字节模拟核对完成')
  expect(x.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledTimes(2)
})
it('without Root installations the actual page reads public income but cannot produce a new preflight entry', async () => {
  controlled.controller = createRootMakerProductIncomeController({ installations: [], client: () => x.client }); await render()
  await input('协议 ID', x.target.protocolId); await input('Product ID', x.productId); await input('币种类型', x.target.coinType)
  await input('Foundation 原始包', x.target.foundation.originalPackageId); await input('Foundation 当前包', x.target.foundation.callablePackageId); await input('包对象 Digest', x.target.foundation.callableDigest)
  await input('制造 原始包', x.target.manufacturing.originalPackageId); await input('制造 当前包', x.target.manufacturing.callablePackageId); await input('制造包对象 Digest', x.target.manufacturing.callableDigest)
  await input('Control 对象', x.controlId); await click('读取 Product 收益与当前资格'); await wait('账本余额（最小单位）：150')
  expect(node.textContent).toContain('当前没有已安装的真实部署资格'); expect(node.querySelector('[aria-label="明确审阅提款"]')).toBeNull()
  expect(x.client.core.listOwnedObjects).not.toHaveBeenCalled(); expect(window.localStorage.length).toBe(0)
})
it('old unknown with wrong new package pin is recovered first in actual page, with no new source/ABI/Gas reads', async () => {
  localStorage.setItem(makerProductIncomeFundKey(x.target), JSON.stringify(await makerProductIncomeOperationFromOriginal(x.originalText))); const original = { retainedText: x.originalText }; vi.clearAllMocks()
  await render(); await selectInstalled(); await input('包对象 Digest', 'wrong-new-pin'); await click('读取 Product 收益与当前资格'); await wait('MAKER_INCOME_ORIGINAL_RECOVERY_REQUIRED')
  expect(node.querySelector('[aria-label="先处理原提款"] a[download]')?.getAttribute('href')).toContain(encodeURIComponent(original.retainedText))
  expect(x.client.ledgerService.getObject).not.toHaveBeenCalled(); expect(x.client.core.getMoveFunction).not.toHaveBeenCalled(); expect(x.client.core.listOwnedObjects).not.toHaveBeenCalled()
})
it('editing draft or withdrawing confirmation removes the locked preflight instead of silently updating its inputs', async () => {
  await render(); await selectInstalled(); await click('读取 Product 收益与当前资格'); await wait(() => Boolean(node.querySelector('[aria-label="\u660e\u786e\u5ba1\u9605\u63d0\u6b3e"]'))); await fillDraft()
  expect(node.querySelector('[aria-label="新提款预检"]')).not.toBeNull()
  await act(async () => (element('确认本次审阅') as HTMLInputElement).click())
  expect(node.querySelector('[aria-label="新提款预检"]')).toBeNull(); expect(window.localStorage.length).toBe(0)
  await input('提款金额', '51'); expect(node.querySelector('[aria-label="新提款预检"]')).toBeNull()
})
it('explicit refresh clears selected Gas refs and requires a new review', async () => {
  await render(); await selectInstalled(); await click('读取 Product 收益与当前资格'); await wait(() => Boolean(node.querySelector('[aria-label="\u660e\u786e\u5ba1\u9605\u63d0\u6b3e"]'))); await fillDraft()
  await click('读取 Product 收益与当前资格'); await wait(() => Boolean(node.querySelector('[aria-label="\u660e\u786e\u5ba1\u9605\u63d0\u6b3e"]')))
  expect((element(`选择 Gas ${x.gasId}`) as HTMLInputElement).checked).toBe(false)
  expect(node.querySelector('[aria-label="新提款预检"]')).toBeNull()
})
it.each(['wallet-aba', 'source', 'stop'])('late verified observation after %s cannot restore an obsolete review', async mode => {
  let release!: () => void, entered = false, current = true
  const actual = createRootMakerProductIncomeController({ installations: [x.installation], client: () => x.client, isCurrent: () => current })
  const gate = new Promise<void>(resolve => { release = resolve })
  controlled.controller = { ...actual, observe: async (...args: Parameters<typeof actual.observe>) => { const value = await actual.observe(...args); entered = true; await gate; return value } }
  await render(); await selectInstalled(); await click('读取 Product 收益与当前资格'); await wait(() => entered)
  if (mode === 'wallet-aba') { controlled.account = `0x${'9'.repeat(64)}`; await render(); controlled.account = x.actor; await render() }
  if (mode === 'source') { current = false; await render() }
  if (mode === 'stop') await click('停止收益观察')
  await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 30)) })
  expect(node.querySelector('[aria-label="明确审阅提款"]')).toBeNull(); expect(window.localStorage.length).toBe(0)
})

async function selectOriginalFile(text: string) {
  await act(async () => {
    const field = element('选择 Product 原文件')
    Object.defineProperty(field, 'files', { configurable: true, value: [{
      name: 'product-original.json', size: new TextEncoder().encode(text).length, text: async () => text,
    }] })
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await wait('文件导入')
}
async function finalizedProduct() {
  const { fixture } = await import('./fixtures/income-execution-frame')
  const f = await fixture('Product')
  const { makerProductIncomeWitness } = await import('./fixtures/maker-product-income')
  return { ...f, x: f.x as Awaited<ReturnType<typeof makerProductIncomeWitness>> }
}

it('uses the actual Product route and qualified original proof to separate original payout, current ledger and wallet funds', async () => {
  const f = await finalizedProduct(), original = f.x
  const { bcs } = await import('@mysten/sui/bcs')
  const { CurrentMakerProductBcs } = await import('../../web/lib/animacraft/current-maker-product-bcs')
  const { aid, adigest } = await import('./fixtures/activity-transaction-evidence')
  const live = CurrentMakerProductBcs.parse(original.allRows.get(`${original.productId}:10`).contents.value)
  live.income = { ...live.income, revision: '10', funds: '130', collected: '180' }
  original.put(original.productId, original.productType, CurrentMakerProductBcs.serialize(live).toBytes(),
    { Shared: { initialSharedVersion: '1' } }, 11, adigest(21))
  const Coin = bcs.struct('Coin', { id: bcs.Address, balance: bcs.u64() })
  const type = `0x2::coin::Coin<${original.target.coinType}>`
  original.put(original.payoutId, type, Coin.serialize({ id: original.payoutId, balance: '23' }).toBytes(),
    { AddressOwner: original.intent.recipient }, 11, adigest(22))
  const getBalance = vi.fn(async () => ({ response: { balance: {
    coinType: original.target.coinType, balance: 27n, coinBalance: 23n, addressBalance: 4n,
  } } }))
  Object.assign(original.client, { stateService: { getBalance } })
  controlled.account = original.intent.recipient
  controlled.controller = createRootMakerProductIncomeController({ installations: [f.source], executionModels: f.models, client: () => original.client as any })
  await act(async () => root.render(<RecoveryPage/>))
  await selectOriginalFile(original.originalText)
  expect(node.querySelector('[aria-label="原 Product 提款资金证据"]')).toBeNull()
  vi.mocked(original.client.ledgerService.getTransaction).mockClear()
  await click('读取当前 Product 账本')
  await wait('当前账本余额（最小单位）：130')
  expect(original.client.ledgerService.getTransaction).not.toHaveBeenCalled()
  expect(getBalance).not.toHaveBeenCalled()
  await click('查询 Product 原提款')
  await wait('已核验原 Product 提款')
  const proof = node.querySelector('[aria-label="原 Product 提款资金证据"]')!
  expect(proof.textContent).toContain(original.packet.digest)
  expect(proof.textContent).toContain(original.payoutId)
  expect(proof.textContent).toContain('实收金额（最小单位）：50')
  expect(proof.textContent).toContain('原交易后账本余额：100')
  expect(proof.textContent).toContain('原 Gas 净费用（MIST）：3')
  expect(node.textContent).toContain('当前账本余额（最小单位）：130')
  await input('提款后观察币种', original.target.coinType)
  await click('查询本钱包当前单币种资金')
  await wait('当前该币种合计（最小单位）：27')
  expect(getBalance).toHaveBeenCalledWith({owner:original.intent.recipient,coinType:original.target.coinType},expect.anything())
  expect(node.querySelector('[aria-label="原 Product 收款 Coin 现状"]')?.textContent).toContain('当前 Coin 余额（最小单位）：23')
  original.put(original.payoutId, type, Coin.serialize({ id: original.payoutId, balance: '23' }).toBytes(),
    { AddressOwner: aid(999) }, 12, adigest(23))
  getBalance.mockResolvedValueOnce({response:{balance:{coinType:original.target.coinType,balance:0n,coinBalance:0n} as any}})
  await click('查询本钱包当前单币种资金')
  await wait('ADDRESS_FUNDS_RAW_BALANCE_REQUIRED')
  expect(node.querySelector('[aria-label="原 Product 收款 Coin 现状"]')?.textContent).toContain('当前持有人已变更')
  expect(node.querySelector('[aria-label="已核对提款后当前余额"]')).toBeNull()
  vi.mocked(original.client.ledgerService.getTransaction).mockImplementationOnce(async () => { throw Error('controlled original transport loss') })
  await click('查询 Product 原提款')
  await wait('controlled original transport loss')
  expect(node.querySelector('[aria-label="原 Product 提款资金证据"]')?.textContent).toContain(original.payoutId)
  expect(node.querySelector('[aria-label="已读取当前 Product 账本"]')).not.toBeNull()
  expect(original.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
  expect(window.localStorage.length).toBe(0)
})

it('keeps public Product ledger available for an unqualified original without mounting recipient funds', async () => {
  const f = await finalizedProduct(), original = f.x
  controlled.account = null
  controlled.controller = createRootMakerProductIncomeController({ installations: [], executionModels: [], client: () => original.client as any })
  await act(async () => root.render(<RecoveryPage/>))
  await selectOriginalFile(original.originalText)
  await click('查询 Product 原提款')
  await wait('原交易已终局执行成功')
  expect(node.querySelector('[aria-label="原 Product 提款资金证据"]')).toBeNull()
  expect(element('提款后观察币种')).toBeUndefined()
  await click('读取当前 Product 账本')
  await wait('当前账本余额（最小单位）：150')
  expect(node.querySelector('[aria-label="原 Product 提款资金证据"]')).toBeNull()
})

it('ignores a late public Product ledger result after the original file is replaced', async () => {
  controlled.controller = x.controller
  await act(async () => root.render(<RecoveryPage/>))
  await selectOriginalFile(x.originalText)
  const read = vi.mocked(x.client.ledgerService.getObject).getMockImplementation()!
  let release!: () => void, seen = false
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.mocked(x.client.ledgerService.getObject).mockImplementation(async (request: any, options?: any) => {
    if (request.objectId === x.productId && request.version === undefined) { seen = true; await gate }
    return read(request, options)
  })
  await click('读取当前 Product 账本')
  await wait(() => seen)
  const field = element('选择 Product 原文件')
  await act(async () => { Object.defineProperty(field, 'files', { configurable:true,value:[] }); field.dispatchEvent(new Event('change',{bubbles:true})) })
  expect(node.querySelector('[aria-label="当前 Product 账本"]')).toBeNull()
  await act(async () => { release(); await gate })
  expect(node.querySelector('[aria-label="已读取当前 Product 账本"]')).toBeNull()
  expect(window.localStorage.length).toBe(0)
})

it.each([false,true])('routes the original withdrawal through the actual wallet and cold import (address Gas %s)', async addressGas => {
  const {Ed25519Keypair}=await import('@mysten/sui/keypairs/ed25519')
  const {toBase64}=await import('@mysten/sui/utils')
  const signer=Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(83))
  const original=await makerProductIncomeControllerFixture(1,signer.toSuiAddress(),addressGas)
  const selected=await makerProductIncomeOperationFromOriginal(original.originalText),key=makerProductIncomeFundKey(selected.plan)
  window.localStorage.setItem(key,JSON.stringify(selected))
  controlled.account=original.actor
  controlled.controller=createRootMakerProductIncomeController({installations:[original.installation],
    executionModels:original.executionModels,executionEnabled:true,client:()=>original.client})
  controlled.sign.mockImplementation(async ({transaction,account,chain})=>{
    expect(chain).toBe('sui:mainnet')
    expect(account.address).toBe(original.actor)
    expect(JSON.parse(window.localStorage.getItem(key)!).packet.phase).toBe('SIGNING')
    return signer.signTransaction(await transaction.build())
  })
  const submit=vi.fn(async request=>{
    const stored=JSON.parse(window.localStorage.getItem(key)!)
    expect(stored.packet.phase).toBe('SIGNED')
    expect(stored.plan.originalText).toBe(original.originalText)
    expect(toBase64(request.transaction)).toBe(original.packet.bytes)
    expect(request.signatures).toEqual([stored.packet.signature])
    vi.mocked(original.client.ledgerService.getTransaction).mockResolvedValue({response:{transaction:structuredClone(original.f.ledger)}})
  })
  Object.assign(original.client.core,{executeTransaction:submit})
  await act(async()=>root.render(<RecoveryPage/>))
  await wait('载入时本机阶段：PREPARED')
  expect(controlled.sign).not.toHaveBeenCalled()
  await click('核对并签名提交 Product 原提款',true)
  await wait('已核验原 Product 提款')
  expect(controlled.sign).toHaveBeenCalledOnce()
  expect(submit).toHaveBeenCalledOnce()
  expect(JSON.parse(window.localStorage.getItem(key)!).packet.phase).toBe('SUCCEEDED')
  expect(node.querySelector('[aria-label="原 Product 提款资金证据"]')?.textContent).toContain(original.payoutId)
  await act(async()=>root.render(<Page/>))
  localStorage.clear()
  await act(async()=>root.render(<RecoveryPage/>))
  await selectOriginalFile(original.originalText)
  expect([...node.querySelectorAll('button')].some(button=>button.textContent?.includes('签名提交 Product'))).toBe(false)
  await click('查询 Product 原提款')
  await wait('已核验原 Product 提款')
  expect(node.querySelector('[aria-label="原 Product 提款资金证据"]')?.textContent).toContain('3')
  expect(localStorage.length).toBe(0)
  expect(submit).toHaveBeenCalledOnce()
})

it('archives a selected expired local Product original without a wallet and keeps imported originals query-only', async () => {
  const key = makerProductIncomeFundKey(x.target), selected = await makerProductIncomeOperationFromOriginal(x.originalText)
  selected.packet.phase = 'SIGNED'
  selected.packet.signature = 'AQ=='
  localStorage.setItem(key, JSON.stringify(selected))
  const { checkpoint } = marketCancelCheckpointFixture('7')
  x.client.ledgerService.getCheckpoint = vi.fn(async () => ({ response: { checkpoint } }))
  controlled.controller = createRootMakerProductIncomeController({ installations: [x.installation], executionModels: x.executionModels,
    retirementEnabled: true, retirementSourceManifestSha256s: [x.installation.acceptedManifestSha256], client: () => x.client })
  controlled.account = null
  const action = '核对并归档过期 Product 原提款'
  const hasRetirementAction = () => [...node.querySelectorAll('button')].some(button => button.textContent === action)
  await act(async () => root.render(<RecoveryPage/>))
  await wait('载入时本机阶段：SIGNED')
  await selectOriginalFile(x.originalText)
  expect(hasRetirementAction()).toBe(false)
  await click('查询 Product 原提款')
  await wait('原交易核对状态：MISSING')
  await click('刷新本机 Product 原件')
  await wait('载入时本机阶段：SIGNED')
  expect(hasRetirementAction()).toBe(true)
  await click(action)
  await wait('原提款已归档')
  expect(JSON.parse(localStorage.getItem(key)!).packet).toEqual({ ...selected.packet, phase: 'RETIRED' })
  await click('刷新本机 Product 原件')
  await wait('归档证据：检查点 100 · Epoch 7')
  expect(hasRetirementAction()).toBe(false)
  expect(controlled.sign).not.toHaveBeenCalled()
  expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
})

it('the actual wallet route saves the exact late signature after a wallet switch and suppresses dispatch', async () => {
  const {Ed25519Keypair}=await import('@mysten/sui/keypairs/ed25519')
  const {fromBase64}=await import('@mysten/sui/utils')
  const signer=Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(83))
  const original=await makerProductIncomeControllerFixture(1,signer.toSuiAddress(),true)
  const selected=await makerProductIncomeOperationFromOriginal(original.originalText), key=makerProductIncomeFundKey(selected.plan)
  localStorage.setItem(key,JSON.stringify(selected))
  controlled.account=original.actor
  controlled.controller=createRootMakerProductIncomeController({installations:[original.installation],
    executionModels:original.executionModels,executionEnabled:true,client:()=>original.client})
  const signature=await signer.signTransaction(fromBase64(original.packet.bytes))
  let release!: () => void
  const prompt = new Promise<void>(resolve => {release=resolve})
  controlled.sign.mockImplementation(async () => { await prompt; return signature })
  const submit=vi.fn()
  Object.assign(original.client.core,{executeTransaction:submit})
  await act(async()=>root.render(<RecoveryPage/>))
  await wait('载入时本机阶段：PREPARED')
  await click('核对并签名提交 Product 原提款')
  await wait(()=>controlled.sign.mock.calls.length===1)
  expect(JSON.parse(localStorage.getItem(key)!).packet.phase).toBe('SIGNING')
  controlled.account=x.actor
  await act(async()=>root.render(<RecoveryPage/>))
  await act(async()=>release())
  await wait(()=>JSON.parse(localStorage.getItem(key)!).packet.phase==='SIGNED')
  expect(JSON.parse(localStorage.getItem(key)!).packet).toEqual({
    ...original.packet, phase:'SIGNED', signature:signature.signature,
  })
  expect(submit).not.toHaveBeenCalled()
  expect(node.textContent).not.toContain('已核验原 Product 提款')
})
