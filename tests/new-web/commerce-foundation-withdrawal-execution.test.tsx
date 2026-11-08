// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { IncomeWithdrawalPreflight } from '../../web/components/commerce/income-withdrawal-preflight'
import { IncomeWithdrawalLocalRecovery } from '../../web/components/commerce/income-withdrawal-local-recovery'
import { IncomeWithdrawalResumeProvider } from '../../web/components/providers/income-withdrawal-resume-provider'
import { IncomeReceiptFieldBcs, IncomeRequestBcs } from '../../web/lib/soulidity/commerce/economics-bcs'
import { browserIncomeWithdrawalOriginalReaderV1, incomeWithdrawalFundKeyV1, incomeWithdrawalHeadCanClearV1,
  queryIncomeWithdrawalJournalOriginalV1 } from '../../web/lib/soulidity/income-withdrawal-journal-v1'
import { incomeEntryFixture } from './fixtures/income-entry'
import { activityEvidenceFixture, activityHash, aid } from './fixtures/activity-transaction-evidence'

const wallet = vi.hoisted(() => ({ address: null as string | null, sign: vi.fn() }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({
  useWalletSign: () => ({ suiWallet: wallet.address ? { address: wallet.address } : null,
    getWalletAddress: () => wallet.address, signTransaction: wallet.sign }),
}))

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  localStorage.clear()
  wallet.address = null
  wallet.sign.mockReset()
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

async function fixture(allowRetirement = false) {
  const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(42))
  const actor = signer.toSuiAddress(), x = await incomeEntryFixture(actor, allowRetirement)
  const capability = x.controller.resumeCapability()!
  const key = incomeWithdrawalFundKeyV1(x.input.target)
  const read = () => browserIncomeWithdrawalOriginalReaderV1().read(key)
  const sign = vi.fn(async (tx: Transaction) => {
    expect((await read())?.packet.phase).toBe('SIGNING')
    return signer.signTransaction(await tx.build())
  })
  const submit = vi.fn(async ({ transaction, signatures }) => {
    const saved = (await read())!
    expect(saved.packet.phase).toBe('SIGNED')
    expect(toBase64(transaction)).toBe(saved.packet.bytes)
    expect(signatures).toEqual([saved.packet.signature])
  })
  const getTransaction = x.client.ledgerService.getTransaction
  const getObject = x.client.ledgerService.getObject.bind(x.client.ledgerService)
  x.client.ledgerService.getObject = vi.fn(async (request, options) =>
    request.version === undefined ? getObject(request, options)
      : { response: { object: x.rows.get(`${request.objectId}:${request.version}`) } })
  x.client.core.executeTransaction = submit
  const publish = () => getTransaction.mockImplementation(async ({ digest }: { digest: string }) => {
    expect(digest).toBe(x.record.packet.digest)
    return { response: { transaction: structuredClone(x.f.ledger) } }
  })

  wallet.address = actor
  wallet.sign.mockImplementation(sign)
  const getActorAddress = () => wallet.address
  const observation = await x.controller.observe(x.selection, x.input.signal, getActorAddress)
  const review = x.controller.makeReview(observation, x.draft)
  const host = x.controller.createPreflight(review)
  const seed = async () => {
    await host({ ...review.request, client: x.client, signal: x.input.signal, getActorAddress })
    return (await read())!
  }
  const run = async (selected: NonNullable<Awaited<ReturnType<typeof read>>>) => capability.execute({
    selected, client: x.client, signal: x.input.signal, getActorAddress, isCurrent: () => true,
    activationKey: capability.activationKey, sourceId: capability.sourceId, sign,
  })
  return { ...x, signer, actor, read, sign, submit, getTransaction, publish, review, host, capability, seed, run }
}

async function click(label: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(node => node.textContent?.trim() === label)
    expect(button, container.textContent ?? '').toBeDefined()
    button!.click()
  })
}
async function waitForText(value: string) {
  for (let index = 0; index < 120 && !container.textContent?.includes(value); index++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
  }
  expect(container.textContent).toContain(value)
}

it('continues the same prepared withdrawal from the normal preflight and displays proven receipt', async () => {
  const f = await fixture()
  const dispatch = f.submit.getMockImplementation()!
  f.submit.mockImplementation(async request => { await dispatch(request); f.publish() })
  await act(async () => root.render(<IncomeWithdrawalPreflight client={f.client} input={f.review.request}
    viewerAddress={f.actor} hostPreflight={f.host} activationKey={f.capability.activationKey} execution={f.capability}/>))
  await click('准备并模拟新提款')
  await waitForText('原交易预检已完成')
  const prepared = (await f.read())!
  expect(f.sign).not.toHaveBeenCalled()
  await click('核对并签名发送原提款')
  await waitForText('原提款已到账 · 检查点 100')
  expect(container.textContent).toContain(f.payoutId)
  expect(wallet.sign).toHaveBeenCalledWith(expect.anything(), { retainReturnedSignature: true })
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.submit).toHaveBeenCalledOnce()
  expect(f.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledTimes(3)
  const saved = (await f.read())!
  expect(saved.packet).toMatchObject({ phase: 'SUCCEEDED', digest: prepared.packet.digest, bytes: prepared.packet.bytes })
  expect(saved.plan.originalText).toBe(prepared.plan.originalText)
  expect(f.getTransaction.mock.calls.every(([request]) => request.digest === prepared.packet.digest)).toBe(true)
})

it('recovers a retained signature after an uncertain send without another wallet prompt', async () => {
  const f = await fixture(), prepared = await f.seed()
  const dispatch = f.submit.getMockImplementation()!
  f.submit.mockImplementationOnce(async request => { await dispatch(request); throw Error('TRANSPORT_LOST') })
  await expect(f.run(prepared)).rejects.toMatchObject({ message: 'TRANSPORT_LOST', recovery: {
    digest: prepared.packet.digest, headPhase: 'SIGNED', durability: 'CONFIRMED',
  } })
  const signed = (await f.read())!
  expect(signed.packet.phase).toBe('SIGNED')
  f.submit.mockImplementation(async request => { await dispatch(request); f.publish() })
  await act(async () => root.render(<IncomeWithdrawalResumeProvider capability={f.capability}>
    <IncomeWithdrawalLocalRecovery viewerAddress={f.actor} createReadOnlyClient={f.capability.client}/>
  </IncomeWithdrawalResumeProvider>))
  await waitForText('核对并重送同一原提款')
  await click('核对并重送同一原提款')
  await waitForText('原提款已到账 · 检查点 100')
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.submit).toHaveBeenCalledTimes(2)
  expect(f.submit.mock.calls[1][0].transaction).toEqual(f.submit.mock.calls[0][0].transaction)
  expect(f.submit.mock.calls[1][0].signatures).toEqual(f.submit.mock.calls[0][0].signatures)
  expect((await f.read())!.packet.phase).toBe('SUCCEEDED')
})

it('retains an authenticated late signature after a wallet change and stops before sending', async () => {
  const f = await fixture(), prepared = await f.seed()
  f.sign.mockImplementationOnce(async tx => {
    wallet.address = aid(999)
    return f.signer.signTransaction(await tx.build())
  })
  await expect(f.run(prepared)).rejects.toMatchObject({ message: 'COMMERCE_WITHDRAW_EXECUTION_SOURCE_OR_WALLET_CHANGED',
    recovery: { digest: prepared.packet.digest, headPhase: 'SIGNED', durability: 'CONFIRMED' } })
  const saved = (await f.read())!
  expect(saved.packet).toMatchObject({ phase: 'SIGNED', digest: prepared.packet.digest })
  expect(saved.packet.signature).toBeTruthy()
  expect(f.submit).not.toHaveBeenCalled()
})

it('keeps a refused wallet operation queryable by its original digest', async () => {
  const f = await fixture(), prepared = await f.seed()
  f.sign.mockRejectedValueOnce(Error('WALLET_REFUSED'))
  await expect(f.run(prepared)).rejects.toMatchObject({ message: 'WALLET_REFUSED', recovery: {
    digest: prepared.packet.digest, headPhase: 'SIGNING', durability: 'CONFIRMED',
  } })
  const saved = (await f.read())!
  expect(saved.packet).toMatchObject({ phase: 'SIGNING', signature: null, digest: prepared.packet.digest })
  expect(f.submit).not.toHaveBeenCalled()
  expect(f.getTransaction.mock.calls.every(([request]) => request.digest === prepared.packet.digest)).toBe(true)
})

it('queries a finalized original before reaching the signer or submitter', async () => {
  const f = await fixture(), prepared = await f.seed()
  f.publish()
  const result = await f.run(prepared)
  expect(result.original).toMatchObject({ status: 'WITHDRAWAL_EVIDENCE_CONFIRMED', checkpoint: '100',
    receipt: { paymentCoinId: f.payoutId, receipt: { amount: f.input.amount, recipient: f.input.recipient } } })
  expect(result.record.packet.phase).toBe('SUCCEEDED')
  expect(f.sign).not.toHaveBeenCalled()
  expect(f.submit).not.toHaveBeenCalled()
})

it('blocks an expired original before requesting a wallet signature', async () => {
  const f = await fixture(), prepared = await f.seed()
  const epoch = f.client.ledgerService.getEpoch.getMockImplementation()!
  f.client.ledgerService.getEpoch.mockImplementation(async request => {
    const result = await epoch(request)
    if (request.epoch === undefined) result.response.epoch.epoch = 7n
    return result
  })
  await expect(f.run(prepared)).rejects.toThrow('WITHDRAW_SIM_EXPIRED')
  expect((await f.read())?.packet).toEqual(prepared.packet)
  expect(f.sign).not.toHaveBeenCalled()
  expect(f.submit).not.toHaveBeenCalled()
})

it('rejects a wallet signature over altered bytes and keeps the original digest', async () => {
  const f = await fixture(), prepared = await f.seed()
  f.sign.mockImplementationOnce(async tx => {
    tx.setGasBudget(1001)
    return f.signer.signTransaction(await tx.build())
  })
  await expect(f.run(prepared)).rejects.toThrow('WITHDRAW_EXECUTION_SIGNED_BYTES_CHANGED')
  expect((await f.read())?.packet).toMatchObject({ phase: 'SIGNING', digest: prepared.packet.digest,
    bytes: prepared.packet.bytes, signature: null })
  expect(f.submit).not.toHaveBeenCalled()
})

it('holds the shared funds lock while the original wallet prompt is outstanding', async () => {
  const f = await fixture(), prepared = await f.seed()
  let enter!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { enter = resolve })
  const hold = new Promise<void>(resolve => { release = resolve })
  const sign = f.sign.getMockImplementation()!
  f.sign.mockImplementationOnce(async tx => {
    enter()
    await hold
    return sign(tx)
  })
  const first = f.run(prepared)
  await started
  try {
    await expect(f.run(prepared)).rejects.toThrow('WITHDRAW_FUND_BUSY')
    expect(f.sign).toHaveBeenCalledOnce()
    expect(f.submit).not.toHaveBeenCalled()
  } finally {
    release()
  }
  await expect(first).resolves.toMatchObject({ original: { status: 'MISSING' },
    record: { packet: { phase: 'SIGNED', digest: prepared.packet.digest } } })
  expect(f.submit).toHaveBeenCalledOnce()
})

async function retirementFixture() {
  const f = await fixture(true)
  await f.run(await f.seed())
  const signed = (await f.read())!
  expect(signed.packet.phase).toBe('SIGNED')
  const expiry = await activityEvidenceFixture()
  expiry.summaryData.epoch = '7'
  expiry.summaryData.sequence_number = '101'
  expiry.rehashSummary()
  expiry.checkpoint.signature = { epoch: 7n, signature: new Uint8Array(48).fill(1), bitmap: new Uint8Array([1]) }
  const getCheckpoint = f.client.ledgerService.getCheckpoint.getMockImplementation()!
  f.client.ledgerService.getCheckpoint.mockImplementation(async (request, options) =>
    request.checkpointId?.oneofKind === undefined || request.checkpointId.sequenceNumber === 101n
      ? { response: { checkpoint: expiry.checkpoint } } : getCheckpoint(request, options))
  const retire = () => f.capability.retirement!.retire({ selected: signed, signal: f.input.signal, isCurrent: () => true })

  function currentReceipt(kind: 'matching' | 'unrelated' | 'incomplete') {
    const config = f.rows.get(`${f.input.target.configId}:10`)
    const getObject = f.client.ledgerService.getObject.getMockImplementation()!
    f.client.ledgerService.getObject.mockImplementation(async (request, options) =>
      request.version === undefined && request.objectId === config.objectId ? { response: { object: config } } : getObject(request, options))
    let row = [...f.rows.values()].find(value => value.objectType.includes('::revenue::Receipt>'))
    const tableId = row.owner.address
    if (kind === 'unrelated') {
      const raw = bcs.Object.parse(row.bcs.value), field = IncomeReceiptFieldBcs.parse(raw.data.Move!.contents)
      field.name.actor = aid(778)
      field.value.actor = field.name.actor
      const requestType = `${f.input.target.foundation.originalPackageId}::revenue::Request`
      field.id = deriveDynamicFieldID(tableId, requestType, IncomeRequestBcs.serialize(field.name).toBytes())
      raw.data.Move!.contents = IncomeReceiptFieldBcs.serialize(field).toBytes()
      const bytes = bcs.Object.serialize(raw).toBytes()
      row = { ...row, objectId: field.id, digest: activityHash('Object', bytes), bcs: { value: bytes } }
    }
    f.client.stateService = { listDynamicFields: vi.fn(async () => ({
      response: { dynamicFields: kind === 'incomplete' ? [] : [{ parent: tableId, fieldId: row.objectId }] },
    })) }
    f.client.ledgerService.batchGetObjects = vi.fn(async () => ({
      response: { objects: [{ result: { oneofKind: 'object', object: row } }] },
    }))
  }
  return { ...f, signed, expiry, retire, currentReceipt }
}

it('retires the same signed head and archives it before a new Foundation original is retained', async () => {
  const f = await retirementFixture()
  f.currentReceipt('unrelated')
  await act(async () => root.render(<IncomeWithdrawalResumeProvider capability={f.capability}>
    <IncomeWithdrawalLocalRecovery viewerAddress={null} createReadOnlyClient={f.capability.client}/>
  </IncomeWithdrawalResumeProvider>))
  await waitForText('核对并退役过期原提款')
  await click('核对并退役过期原提款')
  await waitForText('已保存退役证据 · 检查点 101 · Epoch 7')
  const retired = (await f.read())!
  expect(retired.packet).toEqual({ ...f.signed.packet, phase: 'RETIRED' })
  expect(retired.plan.originalText).toBe(f.signed.plan.originalText)
  expect(retired.retirement).toMatchObject({ checkpoint: { sequenceNumber: '101', epoch: '7' },
    tableSize: '1', config: { version: '10', ledgerRevision: '9' },
    sourceManifestSha256: f.installation.acceptedManifestSha256 })
  expect(incomeWithdrawalHeadCanClearV1(retired, { status: 'MISSING' })).toBe(false)

  const epoch = f.client.ledgerService.getEpoch.getMockImplementation()!
  f.client.ledgerService.getEpoch.mockImplementation(async request => {
    const result = await epoch(request)
    if (request.epoch === undefined) result.response.epoch.epoch = 7n
    return result
  })
  const getActorAddress = () => f.actor
  const observation = await f.controller.observe(f.selection, f.input.signal, getActorAddress)
  expect(observation.previous).toMatchObject({ digest: retired.packet.digest, status: 'MISSING' })
  const review = f.controller.makeReview(observation, { ...f.draft, expirationEpoch: '7', attemptHex: '02'.repeat(32) })
  const prepare = f.controller.createPreflight(review)
  // Stop at simulation of the next packet. The real Host has to verify the
  // retired proof again and archive it before it can persist a new original.
  f.client.transactionExecutionService.simulateTransaction.mockRejectedValueOnce(Error('STOP_NEW_SIMULATION'))
  await expect(prepare({ ...review.request, client: f.client, signal: f.input.signal, getActorAddress }))
    .rejects.toMatchObject({ message: 'STOP_NEW_SIMULATION', recovery: { headPhase: 'PREPARED', durability: 'CONFIRMED' } })
  const next = (await f.read())!
  expect(next.packet.digest).not.toBe(retired.packet.digest)
  expect(next.packet.phase).toBe('PREPARED')
  expect(await browserIncomeWithdrawalOriginalReaderV1().history(incomeWithdrawalFundKeyV1(retired.plan))).toEqual([retired])
  expect(f.sign).toHaveBeenCalledOnce()
  expect(f.submit).toHaveBeenCalledOnce()
})

it.each([
  ['matching', 'WITHDRAW_RETIREMENT_RECEIPT_EXISTS'],
  ['incomplete', 'WITHDRAW_RETIREMENT_TABLE_INCOMPLETE'],
] as const)('keeps the signed head when the receipt table is %s despite the missing digest', async (kind, reason) => {
  const f = await retirementFixture()
  f.currentReceipt(kind)
  await expect(f.retire()).rejects.toThrow(reason)
  expect(await f.read()).toEqual(f.signed)
})

it('rejects a post-scan original that becomes visible', async () => {
  const f = await retirementFixture()
  f.publish()
  f.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' })
  await expect(f.retire()).rejects.toThrow('WITHDRAW_RETIREMENT_ORIGINAL_FOUND')
  expect(await f.read()).toEqual(f.signed)
})

it('requires an executed checkpoint strictly later than the expiry epoch', async () => {
  const f = await retirementFixture()
  f.expiry.summaryData.epoch = '6'
  f.expiry.rehashSummary()
  f.expiry.checkpoint.signature.epoch = 6n
  await expect(f.retire()).rejects.toThrow('strictly later executed checkpoint epoch')
  expect(await f.read()).toEqual(f.signed)
})

it('rechecks stored retirement and rejects a later contradictory receipt table', async () => {
  const f = await retirementFixture()
  const { record } = await f.retire()
  const { executionRegistry } = f
  await expect(queryIncomeWithdrawalJournalOriginalV1({ record, client: f.client, signal: f.input.signal, executionRegistry }))
    .rejects.toThrow('WITHDRAW_RETIREMENT_SOURCE_NOT_INSTALLED')
  f.currentReceipt('matching')
  await expect(f.controller.observe(f.selection, f.input.signal, () => f.actor)).rejects.toThrow('WITHDRAW_RETIREMENT_RECEIPT_EXISTS')
  expect(await f.read()).toEqual(record)
})

it('rejects a changed Config during receipt enumeration', async () => {
  const f = await retirementFixture()
  f.currentReceipt('unrelated')
  const list = f.client.stateService.listDynamicFields.getMockImplementation()!
  f.client.stateService.listDynamicFields.mockImplementationOnce(async request => {
    const result = await list(request)
    const config = f.rows.get(`${f.input.target.configId}:10`)
    Object.assign(config, f.rows.get(`${f.input.target.configId}:9`))
    return result
  })
  await expect(f.retire()).rejects.toThrow('WITHDRAW_RETIREMENT_CONFIG_CHANGED')
  expect(await f.read()).toEqual(f.signed)
})
