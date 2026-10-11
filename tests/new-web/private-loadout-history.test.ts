import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Inputs, Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase58, toBase64 } from '@mysten/sui/utils'
import { buildSavePrivateNamedLoadoutTx } from '@soulidity/sdk'
import { parsePrivateLoadoutHistoricalExport, queryPrivateLoadoutHistory, type PrivateLoadoutHistoricalStorageStatus } from '../../web/lib/animacraft/private-loadout-history'
import { parsePrivateLoadoutRecovery, type PrivateLoadoutRecovery } from '../../web/lib/animacraft/private-loadout-recovery'
import type { PrivateLoadoutTransactionStatus } from '../../web/lib/animacraft/private-loadout-transaction'
import { privateLoadoutRecoveryFixture } from './fixtures/private-loadout-recovery'

let base: Awaited<ReturnType<typeof privateLoadoutRecoveryFixture>>
let head: PrivateLoadoutRecovery
beforeAll(async () => {
  base = await privateLoadoutRecoveryFixture()
  const r = base.paid, plan = { deployment: { originalPackageId: r.context.originalPackageId,
    callablePackageId: r.config.target.soulidityCallablePackageId, chainIdentifier: '35834a8a' },
    scope: r.context.scope, expectedRevision: '0', requestId: r.context.requestId, ciphertext: r.storage!.reference,
    capture: r.capture!, protocolId: r.config.target.protocolConfigId }
  const data = buildSavePrivateNamedLoadoutTx(plan).getData()
  data.inputs = data.inputs.map(input => input.UnresolvedObject ? Inputs.SharedObjectRef({ objectId: input.UnresolvedObject.objectId,
    initialSharedVersion: '1', mutable: input.UnresolvedObject.objectId === plan.scope.stateId }) : input)
  const tx = Transaction.from(JSON.stringify(data)); tx.setSender(plan.scope.owner); tx.setGasOwner(plan.scope.owner)
  tx.setGasPayment([{ objectId: `0x${'98'.repeat(32)}`, version: '1', digest: toBase58(new Uint8Array(32).fill(4)) }])
  tx.setGasBudget('1000000'); tx.setGasPrice('1000'); tx.setExpiration({ Epoch: '10' })
  const bytes = await tx.build()
  head = parsePrivateLoadoutRecovery({ ...r, transaction: { plan, packet: { bytes: toBase64(bytes),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '10', phase: 'PREPARED', signature: null } } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const expected = () => ({ originalPackageId: base.record.context.originalPackageId, soulId: base.record.context.scope.soulId,
  stateId: base.record.context.scope.stateId, owner: base.record.context.scope.owner })
function wire(record = base.paid) {
  return { schema: 'soulidity.private-loadout-recovery-export.v1', record: { ...structuredClone(record), ciphertext: toBase64(record.ciphertext) },
    walrus: structuredClone(base.walrus) }
}
function queries(record = head) {
  return { record: structuredClone(record), config: structuredClone(record.config),
    transactions: { query: vi.fn(async (): Promise<PrivateLoadoutTransactionStatus> => 'SUCCEEDED') },
    recoverStorage: vi.fn(async (): Promise<{ status: PrivateLoadoutHistoricalStorageStatus }> => ({ status: 'CERTIFIED' })) }
}

it.each(['ACTIVE', 'COMPLETE', 'ARCHIVED'] as const)('parses the full encrypted %s export for its original owner without a current epoch or store', status => {
  vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined)
  const record = { ...base.paid, status }, encoded = JSON.stringify(wire(record))
  const result = parsePrivateLoadoutHistoricalExport(encoded, expected())
  expect(result.record).toEqual(record); expect(result.record).not.toBe(record)
  expect(result.walrus).toEqual(base.walrus); expect(result.walrus).not.toBe(base.walrus)
  expect(result.record.context.scope.ownershipEpoch).toBe(base.record.context.scope.ownershipEpoch)
  expect(encoded).not.toContain(base.secretName)
})
it.each(['originalPackageId', 'soulId', 'stateId', 'owner'] as const)('rejects historical expected %s mismatch', field => {
  expect(() => parsePrivateLoadoutHistoricalExport(JSON.stringify(wire()), { ...expected(), [field]: `0x${'99'.repeat(32)}` })).toThrow()
})
it.each(['01', '-1', '18446744073709551616', 1, null])('rejects noncanonical imported ownership epoch %s', epoch => {
  const value = wire(); (value.record.context.scope as any).ownershipEpoch = epoch
  expect(() => parsePrivateLoadoutHistoricalExport(JSON.stringify(value), expected())).toThrow('SCOPE_INVALID')
})
it('does not accept additional current-owner/epoch expectations or malformed identities', () => {
  for (const identity of [{ ...expected(), ownershipEpoch: '7' }, { ...expected(), owner: '0x0' }, null])
    expect(() => parsePrivateLoadoutHistoricalExport(JSON.stringify(wire()), identity as any)).toThrow('HISTORY_IDENTITY_INVALID')
})
it.each(['extra', 'cipher hash', 'payment digest', 'foreign payment', 'missing paid WAL'] as const)('preserves full export validation for %s', mutation => {
  const value: any = wire()
  if (mutation === 'extra') value.secret = 'not permitted'
  if (mutation === 'cipher hash') value.record.cipherSha256 = '99'.repeat(32)
  if (mutation === 'payment digest') value.walrus.certify.digest = toBase58(new Uint8Array(32).fill(9))
  if (mutation === 'foreign payment') value.walrus.intent.recipient = `0x${'99'.repeat(32)}`
  if (mutation === 'missing paid WAL') value.walrus = null
  expect(() => parsePrivateLoadoutHistoricalExport(JSON.stringify(value), expected())).toThrow()
})
it('retains the bounded export parser without storage, decryption or JSON fallbacks', () => {
  for (const value of ['', '{', 'x'.repeat(30 * 1024 * 1024 + 1)])
    expect(() => parsePrivateLoadoutHistoricalExport(value, expected())).toThrow()
})

it.each(['MISSING', 'PENDING', 'SUCCEEDED', 'FAILED'] as const)('delegates exact historical head packet and preserves status %s with writes off', async status => {
  const q = queries(); q.record.status = 'ARCHIVED'; q.config.target.equipmentWritesEnabled = false
  q.transactions.query.mockResolvedValue(status)
  expect(await queryPrivateLoadoutHistory(q)).toEqual({ kind: 'HEAD', status, digest: head.transaction!.packet.digest })
  expect(q.transactions.query).toHaveBeenCalledExactlyOnceWith(head.transaction!.plan, head.transaction!.packet)
  expect(q.recoverStorage).not.toHaveBeenCalled()
})
it('queries even a locally CANCELLED head packet rather than inferring its chain result', async () => {
  const q = queries(); q.record.transaction!.packet.phase = 'CANCELLED'
  expect((await queryPrivateLoadoutHistory(q)).kind).toBe('HEAD'); expect(q.recoverStorage).not.toHaveBeenCalled()
})
it.each(['NONE', 'SOURCE_REQUIRED', 'UNKNOWN', 'FAILED', 'CERTIFIED'] as const)('uses only storage recovery for status %s without a head packet', async status => {
  const q = queries(base.paid); q.recoverStorage.mockResolvedValue({ status })
  expect(await queryPrivateLoadoutHistory(q)).toEqual({ kind: 'STORAGE', status, digest: base.paid.storage!.certifyTxDigest })
  expect(q.transactions.query).not.toHaveBeenCalled(); expect(q.recoverStorage).toHaveBeenCalledExactlyOnceWith(base.paid, undefined)
})
it('an unregistered encrypted record has no invented transaction digest', async () => {
  const q = queries(base.record); q.recoverStorage.mockResolvedValue({ status: 'NONE' })
  expect(await queryPrivateLoadoutHistory(q)).toEqual({ kind: 'STORAGE', status: 'NONE', digest: null })
})
it.each(['package', 'protocol', 'aggregator', 'blob type', 'storage URL'] as const)('rejects non-gate config identity change %s before querying', async mutation => {
  const q = queries()
  if (mutation === 'package') q.config.target.soulidityCallablePackageId = `0x${'99'.repeat(32)}`
  if (mutation === 'protocol') q.config.target.protocolConfigId = `0x${'99'.repeat(32)}`
  if (mutation === 'aggregator') q.config.aggregators[0][1] = 'https://different.example'
  if (mutation === 'blob type') q.config.storage.blobType = `0x${'99'.repeat(32)}::blob::Blob`
  if (mutation === 'storage URL') q.config.storage.aggregatorUrl = 'https://different.example'
  await expect(queryPrivateLoadoutHistory(q)).rejects.toThrow()
  expect(q.transactions.query).not.toHaveBeenCalled(); expect(q.recoverStorage).not.toHaveBeenCalled()
})
it('fully validates cached public packet bytes before querying, without believing status COMPLETE', async () => {
  const q = queries(); q.record.status = 'COMPLETE'; q.record.transaction!.packet.digest = toBase58(new Uint8Array(32).fill(9))
  await expect(queryPrivateLoadoutHistory(q)).rejects.toThrow(); expect(q.transactions.query).not.toHaveBeenCalled()
})
it.each(['HEAD', 'STORAGE'] as const)('propagates %s transport errors, not an empty or successful fallback', async branch => {
  const q = queries(branch === 'HEAD' ? head : base.paid), error = new Error('network unavailable')
  q.transactions.query.mockRejectedValue(error); q.recoverStorage.mockRejectedValue(error)
  await expect(queryPrivateLoadoutHistory(q)).rejects.toBe(error)
})
it.each(['HEAD', 'STORAGE'] as const)('rejects arbitrary runtime %s status strings', async branch => {
  const q = queries(branch === 'HEAD' ? head : base.paid)
  q.transactions.query.mockResolvedValue('COMPLETE' as any); q.recoverStorage.mockResolvedValue({ status: 'SUCCEEDED' as any })
  await expect(queryPrivateLoadoutHistory(q)).rejects.toThrow('HISTORY_STATUS_INVALID')
})
it('captures exact head inputs and digest before await, even if caller and reader mutate their copies', async () => {
  const q = queries(); let done!: () => void
  q.transactions.query.mockImplementationOnce(async (plan: any, packet: any) => {
    plan.scope.owner = `0x${'99'.repeat(32)}`; packet.digest = 'changed'
    await new Promise<void>(resolve => { done = resolve }); return 'PENDING'
  })
  const pending = queryPrivateLoadoutHistory(q)
  q.record.transaction!.packet.digest = 'changed by caller'; q.config.storage.aggregatorUrl = 'https://changed.example'; done()
  const result = await pending
  expect(result).toEqual({ kind: 'HEAD', status: 'PENDING', digest: head.transaction!.packet.digest }); expect(Object.isFrozen(result)).toBe(true)
  expect(head.transaction!.plan.scope.owner).toBe(base.record.context.scope.owner)
})
it('captures storage digest and passes detached record to recovery', async () => {
  const q = queries(base.paid)
  q.recoverStorage.mockImplementationOnce(async (record: any) => { record.storage.certifyTxDigest = 'changed'; record.ciphertext.fill(0); return { status: 'CERTIFIED' } })
  expect((await queryPrivateLoadoutHistory(q)).digest).toBe(base.paid.storage!.certifyTxDigest)
  expect(q.record.ciphertext).toEqual(base.paid.ciphertext)
})

it('passes the full imported paid/no-head bundle to read-only recovery on a new device', async () => {
  vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined); vi.stubGlobal('indexedDB', undefined)
  const bundle = parsePrivateLoadoutHistoricalExport(JSON.stringify(wire({ ...base.paid, status: 'ARCHIVED' })), expected())
  const q = queries(bundle.record)
  const result = await queryPrivateLoadoutHistory({ ...q, walrus: bundle.walrus })
  expect(result).toEqual({ kind: 'STORAGE', status: 'CERTIFIED', digest: base.walrus.certify!.digest })
  expect(q.recoverStorage).toHaveBeenCalledExactlyOnceWith(bundle.record, bundle.walrus)
  expect(q.transactions.query).not.toHaveBeenCalled()
})
it.each(['paid', 'head'] as const)('rejects explicit missing payment WAL for %s independently of export parsing', async kind => {
  const q = queries(kind === 'head' ? head : base.paid)
  await expect(queryPrivateLoadoutHistory({ ...q, walrus: null })).rejects.toThrow('PAYMENT_RECOVERY_MISSING')
  expect(q.recoverStorage).not.toHaveBeenCalled(); expect(q.transactions.query).not.toHaveBeenCalled()
})
it('keeps explicit null distinct from local recovery for an unpaid bundle', async () => {
  const q = queries(base.record); q.recoverStorage.mockResolvedValue({ status: 'NONE' })
  expect(await queryPrivateLoadoutHistory({ ...q, walrus: null })).toEqual({ kind: 'STORAGE', status: 'NONE', digest: null })
  expect(q.recoverStorage).toHaveBeenCalledExactlyOnceWith(base.record, null)
  const value = { ...wire(base.record), walrus: null }
  expect(parsePrivateLoadoutHistoricalExport(JSON.stringify(value), expected()).walrus).toBeNull()
})
it.each([false, 0, 'invalid', []])('does not treat malformed inline WAL %s as explicit null or local recovery', async walrus => {
  const q = queries(base.record)
  await expect(queryPrivateLoadoutHistory({ ...q, walrus: walrus as any })).rejects.toThrow()
  expect(q.recoverStorage).not.toHaveBeenCalled(); expect(q.transactions.query).not.toHaveBeenCalled()
})
it('preserves inline registration digest when storage certification and head have not completed', async () => {
  const record = { ...base.record, paymentStarted: true }, walrus = structuredClone(base.walrus)
  walrus.certify = null; walrus.uploaded = null
  const q = queries(record); q.recoverStorage.mockResolvedValue({ status: 'SOURCE_REQUIRED' })
  expect(await queryPrivateLoadoutHistory({ ...q, walrus })).toEqual({ kind: 'STORAGE', status: 'SOURCE_REQUIRED', digest: walrus.register!.digest })
  expect(q.recoverStorage).toHaveBeenCalledExactlyOnceWith(record, walrus)
})
it.each(['recipient', 'payload', 'scope', 'relay', 'epochs', 'digest', 'unknown fields'] as const)('validates inline WAL %s before any historical query', async field => {
  const q = queries(base.paid), walrus = structuredClone(base.walrus)
  if (field === 'recipient') walrus.intent.recipient = `0x${'99'.repeat(32)}`
  if (field === 'payload') walrus.intent.payloadHash = '99'.repeat(32)
  if (field === 'scope') walrus.intent.operationScope += ':different'
  if (field === 'relay') walrus.intent.relayUrl = 'https://different.example'
  if (field === 'epochs') walrus.intent.storageEpochs += 1
  if (field === 'digest') walrus.certify!.digest = toBase58(new Uint8Array(32).fill(9))
  if (field === 'unknown fields') Object.assign(walrus, { plaintext: 'forbidden' })
  await expect(queryPrivateLoadoutHistory({ ...q, walrus })).rejects.toThrow()
  expect(q.recoverStorage).not.toHaveBeenCalled(); expect(q.transactions.query).not.toHaveBeenCalled()
})
it('captures inline WAL before await and isolates recovery callback mutation', async () => {
  const record = { ...base.record, paymentStarted: true }, walrus = structuredClone(base.walrus), q = queries(record)
  let done!: () => void
  q.recoverStorage.mockImplementationOnce(async (_record: any, selected: any) => {
    expect(selected).toEqual(base.walrus); selected.certify.digest = 'callback mutation'
    await new Promise<void>(resolve => { done = resolve }); return { status: 'CERTIFIED' }
  })
  const pending = queryPrivateLoadoutHistory({ ...q, walrus })
  walrus.certify!.digest = 'caller mutation'; done()
  expect((await pending).digest).toBe(base.walrus.certify!.digest)
})
