// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'
import { completePreflightFixture, installNativePaidSettlementFixture } from './fixtures/commerce-new-paid-preflight'
import { installNativeSaleGasSpends, nativeSaleGasSpendFixture } from './fixtures/native-sale-retirement'
import { activityEvidenceFixture, activityHash, aid } from './fixtures/activity-transaction-evidence'
import { NativePublicReadPaidOriginalRecoveryV2 } from '../../web/components/commerce/native-public-read-paid-original-recovery'
import { createNativePublicReadPaidHostPreflightV2 } from '../../web/lib/soulidity/native-public-read-paid-host-v2'
import { executeNativePublicReadPaidOriginalV2 } from '../../web/lib/soulidity/native-public-read-paid-execution-v2'
import { browserNativePublicReadPaidJournalV2, nativePublicReadPaidHeadCanClearV2, nativePublicReadPaidKeyV2 } from '../../web/lib/soulidity/native-public-read-paid-journal-v2'
import { discoverNativePublicReadPaidOriginalsV2, queryNativePublicReadPaidOriginalV2, retireNativePublicReadPaidOriginalV2 } from '../../web/lib/soulidity/native-public-read-paid-original-recovery-v2'
import { assertSameSoulForeignHeads, createBrowserSameSoulHeadPort } from '../../web/lib/soulidity/same-soul-mutation-heads'
import { readNativePublicReadPaidV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-read-v2'
import { NativeInitialPaidBcs } from '../../web/lib/soulidity/native-initial-children'
import { NativePaidAttemptFieldBcs, NativePaidAttemptKeyBcs } from '../../web/lib/soulidity/commerce/native-paid-content-receipt'
import type { NativePaidRetirementSourceV2 } from '../../web/lib/soulidity/commerce/native-public-read-paid-retirement-v2'

const compiled = vi.hoisted(() => ({ sources: [] as NativePaidRetirementSourceV2[] }))
vi.mock('../../web/lib/soulidity/commerce/native-public-read-paid-retirement-v2', async importOriginal => ({
  ...(await importOriginal<typeof import('../../web/lib/soulidity/commerce/native-public-read-paid-retirement-v2')>()),
  ROOT_NATIVE_PAID_RETIREMENT_SOURCES_V2: compiled.sources,
}))

const signal = () => new AbortController().signal
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  localStorage.clear()
  compiled.sources.length = 0
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (key: string, _options: unknown, work: (lock: unknown) => unknown) => {
      if (held.has(key)) return work(null)
      held.add(key)
      try { return await work({ name: key }) } finally { held.delete(key) }
    },
  } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function fixture(phase: 'SIGNED' | 'SIGNING' = 'SIGNED') {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(83))
  const x = await completePreflightFixture('', signer.toSuiAddress())
  const { client } = x
  const queries = vi.fn(async (_request: { digest: string }) => { throw { code: 'NOT_FOUND' } })
  const submit = vi.fn(async () => {})
  client.ledgerService.getTransaction = queries
  client.core.executeTransaction = submit
  const expires = await activityEvidenceFixture()
  expires.summaryData.epoch = '7'
  expires.summaryData.sequence_number = '101'
  expires.rehashSummary()
  expires.checkpoint.signature = { epoch: 7n, signature: new Uint8Array(48).fill(1), bitmap: new Uint8Array([1]) }
  client.ledgerService.getCheckpoint = vi.fn(async () => ({ response: { checkpoint: expires.checkpoint } }))
  const host = createNativePublicReadPaidHostPreflightV2()
  await host(x.input)
  const journal = browserNativePublicReadPaidJournalV2()
  const key = nativePublicReadPaidKeyV2({ chainIdentifier: '35834a8a', soulId: x.params.soulId, author: x.buyer })
  const read = () => journal.read(key)
  const prepared = (await read())!
  const sign = vi.fn(async (tx: Transaction) => {
    if (phase === 'SIGNING') throw Error('TEST_WALLET_REFUSAL')
    return signer.signTransaction(await tx.build())
  })
  const execution = { qualification: x.input.qualification, isCurrent: () => true, getBuyerAddress: () => x.buyer,
    sign, qualifySource: async () => {} }
  const run = executeNativePublicReadPaidOriginalV2({ ...execution, selected: prepared })
  if (phase === 'SIGNING') await expect(run).rejects.toThrow('TEST_WALLET_REFUSAL')
  else await run
  const selected = (await read())!
  expect(selected.packet.phase).toBe(phase)
  const admission = { target: x.params.target, economics: x.params.economics, auditSha256: 'a'.repeat(64) }
  compiled.sources.push(admission)
  const retire = () => retireNativePublicReadPaidOriginalV2({ record: selected, client, signal: signal() })
  const foreign = (port = createBrowserSameSoulHeadPort(client, localStorage, signal())) =>
    assertSameSoulForeignHeads({ scopes: [selected.plan], ownKeys: [], port, signal: signal() })
  const content = x.params.target.content!.originalPackageId
  const type = content + '::paid_access::AttemptKey', table = x.ledger.attempts.id
  const pointer = deriveDynamicFieldID(x.f.state.id, '0x2::dynamic_object_field::Wrapper<' + x.f.nativeId + '::birth::PaidKey>', new Uint8Array([0]))
  function installTable(kind: 'matching' | 'unrelated' | 'partial') {
    const name = { buyer: kind === 'matching' ? x.buyer : aid(812), attempt: x.input.attempt }
    const id = deriveDynamicFieldID(table, type, NativePaidAttemptKeyBcs.serialize(name).toBytes())
    x.ledger.attempts.size = 1
    const ledgerRow = x.f.object(x.ledger.id, content + '::paid_access::Ledger', NativeInitialPaidBcs.serialize(x.ledger).toBytes(), pointer)
    const raw = bcs.Object.parse(ledgerRow.bcs.value)
    raw.data.Move!.version = '11'
    const bytes = bcs.Object.serialize(raw).toBytes()
    Object.assign(ledgerRow, { version: 11n, digest: activityHash('Object', bytes), bcs: { value: bytes } })
    const row = x.f.object(id, '0x2::dynamic_field::Field<' + type + ',' + content + '::paid_access::Receipt>',
      NativePaidAttemptFieldBcs.serialize({ id, name, value: { kind: x.record.kind, quote: new Uint8Array(32).fill(2),
        entry_hash: new Uint8Array(32).fill(3), price: '101', total: '104', platform_fee: '3',
        fee_revision: x.cfg.revision, platform_recipient: x.cfg.recipient, beneficiary: x.owner } }).toBytes(), table)
    client.ledgerService.batchGetObjects = vi.fn(async () => ({ response: { objects: [{ result: { oneofKind: 'object', object: row } }] } }))
    client.stateService = { listDynamicFields: vi.fn(async () => ({ response: { dynamicFields: kind === 'partial' ? [] : [{ parent: table, fieldId: id }] } })) }
  }
  return { ...x, journal, key, read, selected, expires, queries, submit, sign, execution, admission, retire, foreign, installTable }
}

async function until(text: string) {
  for (let n = 0; n < 140 && !container.textContent?.includes(text); n++)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  expect(container.textContent).toContain(text)
}

it('reopens the signed original, retires it, verifies foreign exclusion and retains the next independent packet', async () => {
  const f = await fixture()
  f.installTable('unrelated')
  const render = () => act(async () => root.render(<NativePublicReadPaidOriginalRecoveryV2 soulId={f.params.soulId} createReadOnlyClient={() => f.client}/>))
  await render()
  await until('本机保存阶段：SIGNED')
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(row => row.textContent === '核对并退役过期原购买')
    expect(button).toBeDefined()
    button!.click()
  })
  await until('已保存退役证据 · 检查点 101')
  const retired = (await f.read())!
  expect(retired.packet).toEqual({ ...f.selected.packet, phase: 'RETIRED' })
  expect(retired.plan.originalText).toBe(f.selected.plan.originalText)
  expect(retired.retirement).toMatchObject({ tableSize: '1', checkpoint: { epoch: '7', sequenceNumber: '101' } })
  const observed = await queryNativePublicReadPaidOriginalV2({ record: retired, client: f.client, signal: signal() })
  expect(nativePublicReadPaidHeadCanClearV2(retired, observed)).toBe(false)
  await expect(f.foreign({ storage: localStorage, query: async () => ({ status: 'FAILED' }) })).rejects.toThrow('ORIGINAL_RECOVERY_REQUIRED')
  await expect(f.foreign()).resolves.toBeUndefined()
  await executeNativePublicReadPaidOriginalV2({ ...f.execution, selected: retired })

  const reviewed = await readNativePublicReadPaidV2(f.params)
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 7n, referenceGasPrice: 1n } } })
  f.client.transactionExecutionService.simulateTransaction.mockRejectedValueOnce(Error('STOP_NEW_SIMULATION'))
  const nextHost = createNativePublicReadPaidHostPreflightV2()
  await expect(nextHost({ ...f.input, reviewed, expirationEpoch: '7', attempt: new Uint8Array(32).fill(2) }))
    .rejects.toMatchObject({ message: 'STOP_NEW_SIMULATION', recovery: { durability: 'CONFIRMED' } })
  const next = (await f.read())!
  expect(next.packet).toMatchObject({ phase: 'PREPARED', signature: null })
  expect(next.packet.digest).not.toBe(retired.packet.digest)
  expect(await f.journal.history(f.key)).toEqual([retired])
  await act(async () => root.unmount())
  root = createRoot(container)
  await render()
  await until('本机保存阶段：PREPARED')
  expect(await discoverNativePublicReadPaidOriginalsV2({ ...next.plan, author: f.buyer })).toEqual([next, retired])
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.submit).toHaveBeenCalledOnce()
})

it.each([['matching', 'RECEIPT_EXISTS'], ['partial', 'TABLE_INCOMPLETE']] as const)('preserves the signed reservation with a %s attempt table', async (kind, message) => {
  const f = await fixture()
  f.installTable(kind)
  await expect(f.retire()).rejects.toThrow('PAID_V2_RETIREMENT_' + message)
  expect(await f.read()).toEqual(f.selected)
})

it('rechecks the stored proof and retains the retired head when the matching receipt appears later', async () => {
  const f = await fixture()
  const { record } = await f.retire()
  f.installTable('matching')
  await expect(f.foreign()).rejects.toMatchObject({ reason: 'ORIGINAL_QUERY_UNAVAILABLE' })
  const nextHost = createNativePublicReadPaidHostPreflightV2()
  await expect(nextHost(f.input)).rejects.toThrow('PAID_V2_RETIREMENT_RECEIPT_EXISTS')
  expect(await f.read()).toEqual(record)
  expect(await f.journal.history(f.key)).toEqual([])
})

it('retires a refused signing original only after strict epoch expiry and exact source admission', async () => {
  const f = await fixture('SIGNING')
  compiled.sources.length = 0
  await expect(f.retire()).rejects.toThrow('PAID_V2_RETIREMENT_SOURCE_NOT_INSTALLED')
  compiled.sources.push(f.admission)
  f.expires.summaryData.epoch = '6'
  f.expires.rehashSummary()
  f.expires.checkpoint.signature.epoch = 6n
  await expect(f.retire()).rejects.toThrow('strictly later executed checkpoint epoch')
  expect(await f.read()).toEqual(f.selected)
  f.expires.summaryData.epoch = '7'
  f.expires.rehashSummary()
  f.expires.checkpoint.signature.epoch = 7n
  expect((await f.retire()).record.packet).toEqual({ ...f.selected.packet, phase: 'RETIRED' })
  expect(f.submit).not.toHaveBeenCalled()
})

it('keeps the original if the exact digest appears after the receipt scan', async () => {
  const f = await fixture(), found = await installNativePaidSettlementFixture(f, f.selected.packet.digest)
  const pending = { ...found.ledger }
  delete pending.checkpoint
  f.client.ledgerService.getCheckpoint.mockResolvedValue({ response: { checkpoint: f.expires.checkpoint } })
  f.queries.mockRejectedValueOnce({ code: 'NOT_FOUND' })
  f.queries.mockResolvedValueOnce({ response: { transaction: pending } } as never)
  await expect(f.retire()).rejects.toThrow('PAID_V2_RETIREMENT_ORIGINAL_FOUND')
  expect(await f.read()).toEqual(f.selected)
})

it('keeps the original when the paid ledger changes while the table is read', async () => {
  const f = await fixture()
  const before = f.f.rows.get(f.ledger.id)
  f.installTable('unrelated')
  const list = f.client.stateService.listDynamicFields.getMockImplementation()!
  f.client.stateService.listDynamicFields.mockImplementationOnce(async request => {
    const result = await list(request)
    f.f.rows.set(f.ledger.id, before)
    return result
  })
  await expect(f.retire()).rejects.toThrow('PAID_V2_RETIREMENT_LEDGER_CHANGED')
  expect(await f.read()).toEqual(f.selected)
})

it('retires a paid original through the real recovery panel when the attempt index is incomplete', async () => {
  const f = await fixture()
  f.installTable('partial')
  await expect(f.retire()).rejects.toThrow('PAID_V2_RETIREMENT_TABLE_INCOMPLETE')
  const gasId = f.input.gas.coins[0].objectId
  const gas = { ...(await f.client.ledgerService.getObject({ objectId: gasId })).response.object, objectType: '0x2::coin::Coin<0x2::sui::SUI>' }
  const spend = await nativeSaleGasSpendFixture(gas, 98, { failure: true })
  const later = await nativeSaleGasSpendFixture(spend.output, 99)
  installNativeSaleGasSpends(f.client, [spend, later], later.output)
  const retire = (conflictDigest: string) =>
    retireNativePublicReadPaidOriginalV2({ record: f.selected, client: f.client, signal: signal(), conflictDigest })
  await expect(retire(later.digest)).rejects.toThrow('PAID_V2_RETIREMENT_CONFLICT_INPUT')
  expect(await f.read()).toEqual(f.selected)

  await act(async () => root.render(<NativePublicReadPaidOriginalRecoveryV2 soulId={f.params.soulId} createReadOnlyClient={() => f.client}/>))
  await until('本机保存阶段：SIGNED')
  await act(async () => {
    const input = [...container.querySelectorAll('label')].find(node => node.textContent?.includes('冲突交易摘要'))!.querySelector('input')!
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, spend.digest)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => [...container.querySelectorAll('button')].find(row => row.textContent === '核对并退役过期原购买')!.click())
  await until('冲突交易 ' + spend.digest)
  const retired = (await f.read())!
  expect(retired).toMatchObject({ packet: { ...f.selected.packet, phase: 'RETIRED' }, plan: f.selected.plan,
    retirement: { auditSha256: f.admission.auditSha256, conflict: { digest: spend.digest, checkpoint: '98', coinId: gasId } } })
  expect(container.textContent).not.toContain('付款结果仍未知')
  expect(nativePublicReadPaidHeadCanClearV2(retired, await queryNativePublicReadPaidOriginalV2({ record: retired, client: f.client, signal: signal() }))).toBe(false)
  await expect(f.foreign()).resolves.toBeUndefined()
  f.f.rows.set(gasId, later.output)
  const reviewed = await readNativePublicReadPaidV2(f.params)
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 7n, referenceGasPrice: 1n } } })
  f.client.transactionExecutionService.simulateTransaction.mockRejectedValueOnce(Error('STOP_NEW_SIMULATION'))
  const gasRef = { objectId: gasId, digest: later.output.digest, version: String(later.output.version) }
  await expect(createNativePublicReadPaidHostPreflightV2()({ ...f.input, reviewed, expirationEpoch: '7',
    gas: { ...f.input.gas, coins: [gasRef] }, attempt: new Uint8Array(32).fill(2) }))
    .rejects.toMatchObject({ message: 'STOP_NEW_SIMULATION', recovery: { durability: 'CONFIRMED' } })
  expect((await f.read())!.packet).toMatchObject({ phase: 'PREPARED', signature: null })
  expect(await f.journal.history(f.key)).toEqual([retired])
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.submit).toHaveBeenCalledOnce()
})
