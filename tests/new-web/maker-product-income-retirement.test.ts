// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { deriveDynamicFieldID, toBase64 } from '@mysten/sui/utils'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { captureMakerProductIncomeClient } from '../../web/lib/soulidity/commerce/maker-product-income-client'
import { IncomeReceiptFieldBcs, IncomeRequestBcs } from '../../web/lib/soulidity/commerce/economics-bcs'
import { createIncomeExecutionRegistryV1 } from '../../web/lib/soulidity/commerce/income-execution-source-v1'
import { createMakerProductIncomeRecoveryRecord, exportMakerProductIncomeRecoveryRecord } from '../../web/lib/soulidity/commerce/maker-product-income-recovery-record'
import { createRootMakerProductIncomeController } from '../../web/lib/soulidity/commerce/maker-product-income-controller'
import { CurrentMakerProductBcs } from '../../web/lib/animacraft/current-maker-product-bcs'
import { browserMakerProductIncomeOriginalReader, makerProductIncomeFundKey, makerProductIncomeHeadCanClear,
  makerProductIncomeOperationFromOriginal, queryMakerProductIncomeOriginal } from '../../web/lib/soulidity/maker-product-income-journal'
import { makerProductIncomeControllerFixture } from './fixtures/maker-product-income'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'

beforeEach(() => {
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  localStorage.clear()
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (key: string, _options: unknown, work: (lock: unknown) => unknown) => {
    if (held.has(key)) return work(null)
    held.add(key)
    try { return await work({ name: key }) } finally { held.delete(key) }
  } } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function setup(options: { enabled?: boolean; admitted?: boolean; phase?: 'SIGNING' | 'SIGNED'; epoch?: string } = {}) {
  const x = await makerProductIncomeControllerFixture()
  const selected = await makerProductIncomeOperationFromOriginal(x.originalText)
  selected.packet.phase = options.phase ?? 'SIGNED'
  selected.packet.signature = selected.packet.phase === 'SIGNED' ? 'AQ==' : null
  const key = makerProductIncomeFundKey(selected.plan), raw = JSON.stringify(selected)
  localStorage.setItem(key, raw)
  const { checkpoint, evidence } = marketCancelCheckpointFixture(options.epoch ?? '7')
  const getCheckpoint = vi.fn(async () => ({ response: { checkpoint } }))
  x.client.ledgerService.getCheckpoint = getCheckpoint
  const retirementSourceManifestSha256s = options.admitted === false ? [] : [x.installation.acceptedManifestSha256]
  const executionRegistry = createIncomeExecutionRegistryV1({ makerSources: [x.installation], models: x.executionModels, retirementSourceManifestSha256s })
  const controller = createRootMakerProductIncomeController({ installations: [x.installation], executionModels: x.executionModels,
    retirementEnabled: options.enabled === false ? undefined : true, retirementSourceManifestSha256s, client: () => x.client })
  return { x, key, raw, selected, evidence, getCheckpoint, controller, executionRegistry,
    retire: () => controller.retireOriginal({ selected, signal: x.signal, isCurrent: () => true }) }
}

function setTable(x: Awaited<ReturnType<typeof makerProductIncomeControllerFixture>>, size: string) {
  const product = structuredClone(x.product)
  product.income = { ...product.income, revision: '12', funds: '100', withdrawn: '50', requests: { ...product.income.requests, size } }
  x.put(x.productId, x.productType, CurrentMakerProductBcs.serialize(product).toBytes(), { Shared: { initialSharedVersion: '1' } }, 12)
  return product.income.requests.id
}

function configureReceipts(x: Awaited<ReturnType<typeof makerProductIncomeControllerFixture>>, attempts: number[], size: string, ownerOverride?: string) {
  const tableId = setTable(x, size)
  const requestType = `${x.target.foundation.originalPackageId}::revenue::Request`
  const receiptType = `${x.target.foundation.originalPackageId}::revenue::Receipt`
  const fields = attempts.map((n, index) => {
    const name = { actor: x.actor, attempt: new Uint8Array(32).fill(n) }
    const fieldId = deriveDynamicFieldID(tableId, requestType, IncomeRequestBcs.serialize(name).toBytes())
    const receipt = { root: x.productId, ...name, recipient: x.intent.recipient, amount: '25',
      before_revision: String(8 + index), after_revision: String(9 + index), balance: String(125 - 25 * index),
      total_collected: '150', total_withdrawn: String(25 * (index + 1)) }
    x.put(fieldId, `0x2::dynamic_field::Field<${requestType},${receiptType}>`, IncomeReceiptFieldBcs.serialize({ id: fieldId, name, value: receipt }).toBytes(),
      { ObjectOwner: ownerOverride ?? tableId }, 10 + index)
    return { parent: tableId, fieldId }
  })
  const list = vi.fn(async (input: { pageToken?: Uint8Array }) => {
    const index = input.pageToken?.[0] ?? 0
    return { response: { dynamicFields: fields.slice(index, index + 1),
      nextPageToken: index + 1 < fields.length ? new Uint8Array([index + 1]) : undefined } }
  })
  const batch = vi.fn(async ({ requests }: { requests: { objectId: string }[] }) => ({
    response: { objects: requests.map(({ objectId }) => ({ result: { oneofKind: 'object', object: x.rows.get(objectId) } })) },
  }))
  x.client.stateService = { listDynamicFields: list }
  x.client.ledgerService.batchGetObjects = batch
  return { tableId, fields, list, batch }
}

it.each(['SIGNING', 'SIGNED'] as const)('retires %s only after two queries of the exact original and preserves its bytes and signature', async phase => {
  const { x, key, selected, evidence, getCheckpoint, retire } = await setup({ phase })
  const { record, original } = await retire()
  expect(original.status).toBe('MISSING')
  expect(record.packet).toEqual({ ...selected.packet, phase: 'RETIRED' })
  expect(record.plan.originalText).toBe(x.originalText)
  expect(record.retirement).toMatchObject({ checkpoint: evidence, tableSize: '0', receiptFieldId: x.fieldId,
    tableId: x.product.income.requests.id, product: { version: '9', ledgerRevision: '8' } })
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(record)
  expect(x.client.ledgerService.getTransaction.mock.calls.map(([query]: any[]) => query.digest)).toEqual([x.packet.digest, x.packet.digest])
  expect(x.client.ledgerService.getTransaction.mock.invocationCallOrder[0]).toBeLessThan(getCheckpoint.mock.invocationCallOrder[0])
  expect(x.client.transactionExecutionService.simulateTransaction).not.toHaveBeenCalled()
  expect(makerProductIncomeHeadCanClear(record, original)).toBe(false)
})

it('reverifies the exact saved checkpoint, live table and old digest before allowing a fresh observation', async () => {
  const { x, key, retire, getCheckpoint, controller, executionRegistry } = await setup()
  const { record, original } = await retire()
  const query = () => queryMakerProductIncomeOriginal({ record, client: x.client, signal: x.signal, executionRegistry })
  const verified = await query()
  expect(makerProductIncomeHeadCanClear(record, verified)).toBe(true)
  expect(makerProductIncomeHeadCanClear(record, verified)).toBe(false)
  expect(makerProductIncomeHeadCanClear(record, structuredClone(verified))).toBe(false)
  expect(makerProductIncomeHeadCanClear(record, original)).toBe(false)
  expect(getCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({
    checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: 100n },
  }), expect.anything())
  const observed = await controller.observe(x.selection, x.signal, () => x.actor)
  expect(observed.previous).toMatchObject({ digest: x.packet.digest, status: 'MISSING' })
  expect(observed.preparation).not.toBeNull()
  getCheckpoint.mockResolvedValueOnce({ response: { checkpoint: undefined as any } })
  await expect(controller.observe(x.selection, x.signal, () => x.actor)).rejects.toThrow('RETIREMENT_CHECKPOINT_UNCONFIRMED')
  expect((await browserMakerProductIncomeOriginalReader().read(key))?.packet.phase).toBe('RETIRED')
})

it('proves absence over every page of a nonempty, typed table', async () => {
  const { x, retire } = await setup()
  const { tableId, list, batch } = configureReceipts(x, [2, 3], '2')
  const { record } = await retire()
  expect(record.retirement).toMatchObject({ tableId, tableSize: '2', receiptFieldId: x.fieldId })
  expect(list).toHaveBeenCalledTimes(2)
  expect(batch).toHaveBeenCalledTimes(2)
})

it.each([
  ['target receipt', [1], '1', 'RETIREMENT_RECEIPT_EXISTS'],
  ['partial table', [2], '2', 'RETIREMENT_TABLE_INCOMPLETE'],
  ['beyond scan bound', [], '2049', 'RETIREMENT_EVIDENCE'],
] as const)('keeps the signed head on %s', async (_mode, attempts, size, error) => {
  const { x, key, raw, retire } = await setup()
  configureReceipts(x, [...attempts], size)
  await expect(retire()).rejects.toThrow(error)
  expect(localStorage.getItem(key)).toBe(raw)
  expect(x.client.ledgerService.getTransaction).toHaveBeenCalledOnce()
})

it('rejects a validly encoded field that is owned by another object', async () => {
  const { x, key, raw, retire } = await setup()
  configureReceipts(x, [2], '1', x.productId)
  await expect(retire()).rejects.toThrow('RETIREMENT_TABLE_TYPE')
  expect(localStorage.getItem(key)).toBe(raw)
})

it('keeps the original if it appears during retirement even without final receipt evidence', async () => {
  const { x, key, raw, retire } = await setup()
  const result = structuredClone(x.f.ledger)
  delete result.checkpoint
  x.client.ledgerService.getTransaction.mockImplementationOnce(async () => { throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' }) })
    .mockResolvedValueOnce({ response: { transaction: result } })
  await expect(retire()).rejects.toThrow('RETIREMENT_ORIGINAL_FOUND')
  expect(localStorage.getItem(key)).toBe(raw)
})

it('keeps a signed head when the Product changes after the completed table scan', async () => {
  const { x, key, raw, retire } = await setup()
  const { batch } = configureReceipts(x, [2], '1')
  const read = batch.getMockImplementation()!
  batch.mockImplementationOnce(async input => {
    const result = await read(input)
    const product = structuredClone(x.product)
    product.income = { ...product.income, revision: '13', funds: '125', withdrawn: '25', requests: { ...product.income.requests, size: '1' } }
    x.put(x.productId, x.productType, CurrentMakerProductBcs.serialize(product).toBytes(), { Shared: { initialSharedVersion: '1' } }, 13)
    return result
  })
  await expect(retire()).rejects.toThrow('RETIREMENT_PRODUCT_CHANGED')
  expect(localStorage.getItem(key)).toBe(raw)
})

it('does not retire in the original expiration epoch or while the Root capability is off', async () => {
  const expiry = await setup({ epoch: '6' })
  await expect(expiry.retire()).rejects.toThrow('strictly later executed checkpoint epoch')
  expect(localStorage.getItem(expiry.key)).toBe(expiry.raw)
  const disabled = await setup({ enabled: false })
  await expect(disabled.retire()).rejects.toThrow('RETIREMENT_NOT_ENABLED')
  expect(localStorage.getItem(disabled.key)).toBe(disabled.raw)
  expect(disabled.getCheckpoint).not.toHaveBeenCalled()
})

it('requires separate retirement admission for the exact installed source', async () => {
  const { x, key, raw, getCheckpoint, controller, retire } = await setup({ admitted: false })
  expect(controller.canResumeTarget(x.target)).toBe(true)
  expect(controller.canRetireTarget(x.target)).toBe(false)
  await expect(retire()).rejects.toThrow('RETIREMENT_NOT_ENABLED')
  expect(getCheckpoint).not.toHaveBeenCalled()
  expect(localStorage.getItem(key)).toBe(raw)
})

it('archives the old original on a fresh preflight at the later epoch', async () => {
  const next = await makerProductIncomeControllerFixture(2), old = await makerProductIncomeControllerFixture()
  const tx = Transaction.from(old.packet.bytes)
  tx.setExpiration({ Epoch: 4 })
  const bytes = await tx.build()
  const packet = { ...old.packet, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '4' }
  const original = createMakerProductIncomeRecoveryRecord({ target: old.target, packet, intent: old.intent })
  const selected = await makerProductIncomeOperationFromOriginal(exportMakerProductIncomeRecoveryRecord(original))
  selected.packet.phase = 'SIGNED'
  selected.packet.signature = 'AQ=='
  const key = makerProductIncomeFundKey(selected.plan)
  localStorage.setItem(key, JSON.stringify(selected))

  const { checkpoint } = marketCancelCheckpointFixture('5')
  next.client.ledgerService.getCheckpoint = vi.fn(async () => ({ response: { checkpoint } }))
  const controller = createRootMakerProductIncomeController({ installations: [next.installation], executionModels: next.executionModels,
    retirementEnabled: true, retirementSourceManifestSha256s: [next.installation.acceptedManifestSha256], client: () => next.client })
  const { record: retired } = await controller.retireOriginal({ selected, signal: next.signal, isCurrent: () => true })
  const observed = await controller.observe(next.selection, next.signal, () => next.actor)
  expect(observed.preparation?.epoch).toBe('5')
  const review = controller.makeReview(observed, next.draft)
  const prepared = await controller.createPreflight(review)({ ...review.request, client: next.client, signal: next.signal, getActorAddress: () => next.actor })
  expect(prepared.retainedText).toBe(next.originalText)
  expect(await browserMakerProductIncomeOriginalReader().history(key)).toEqual([retired])
  expect((await browserMakerProductIncomeOriginalReader().read(key))?.packet.digest).toBe(next.packet.digest)
})

it('preserves the native list and batch service receivers through nested Product captures', async () => {
  const sdk = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'http://127.0.0.1:1' })
  const ledger = sdk.ledgerService, state = sdk.stateService
  const fields = { response: { dynamicFields: [] } }, objects = { response: { objects: [] } }
  const list = vi.fn(function (this: unknown) { expect(this).toBe(state); return fields })
  const batch = vi.fn(function (this: unknown) { expect(this).toBe(ledger); return objects })
  state.listDynamicFields = list as any
  ledger.batchGetObjects = batch as any
  const captured = captureMakerProductIncomeClient(captureMakerProductIncomeClient(sdk))
  const replacement = vi.fn(() => { throw Error('REPLACED_PRODUCT_TABLE_LEAF') })
  state.listDynamicFields = replacement as any
  ledger.batchGetObjects = replacement as any
  expect(await captured.stateService.listDynamicFields({})).toBe(fields)
  expect(await captured.ledgerService.batchGetObjects({ requests: [] })).toBe(objects)
  expect(replacement).not.toHaveBeenCalled()
})

it('uses the same Product exclusion for simultaneous recovery requests', async () => {
  const { x, retire, key } = await setup()
  const [first, second] = await Promise.allSettled([retire(), retire()])
  expect(first.status).toBe('fulfilled')
  expect(second).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: expect.stringContaining('BUSY') }) })
  expect(x.client.ledgerService.getTransaction).toHaveBeenCalledTimes(2)
  expect((await browserMakerProductIncomeOriginalReader().read(key))?.packet.phase).toBe('RETIRED')
})
