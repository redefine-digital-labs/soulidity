import { afterEach, expect, it, vi } from 'vitest'
import { toBase64 } from '@mysten/sui/utils'
import { exportContentAppendRecovery, importContentAppendRecovery, verifyContentAppendRecoveryBundle } from '../../web/lib/soulidity/content-append-recovery'
import { contentAppendWalrusIntent, parseContentAppendIntent } from '../../web/lib/soulidity/content-append-operation'
import { walrusSingleKey } from '../../web/lib/upload/walrus-single-operation'
import { contentAppendRebaseFixture } from './fixtures/content-append-rebase'

// Real local author signatures and encrypted wrappers. Payment/retirement are
// offline public evidence; export/import cannot establish live chain outcomes.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function fixture() {
  const f = await contentAppendRebaseFixture(), pending = await f.advance()
  const history = [f.link], transitions = { history, pending: pending.link }
  const readPayment = vi.fn(key => key === walrusSingleKey(contentAppendWalrusIntent(f.next)) ? f.link.nextPayment : null), readTransitions = vi.fn(async () => transitions)
  const encode = () => exportContentAppendRecovery(f.next, f.client, readPayment, readTransitions)
  return { ...f, pending, history, transitions, readPayment, readTransitions, encode }
}
it('cold-exports/imports the complete history and prepared transition with only one ciphertext copy', async () => {
  const f = await fixture(), signCount = f.sign.mock.calls.length, decryptCount = f.decryptCall.mock.calls.length
  const text = await f.encode(), encoded = JSON.parse(text)
  expect(f.readPayment).toHaveBeenCalledWith(walrusSingleKey(contentAppendWalrusIntent(f.next)))
  expect(f.readTransitions).toHaveBeenCalledWith(f.next)
  expect(encoded.history).toEqual(f.history); expect(encoded.pending).toEqual(f.pending.link)
  expect((text.match(/"ciphertext":/g) ?? [])).toHaveLength(1)
  expect(encoded.preparation.ciphertext).toBe(toBase64(f.next.ciphertext))
  for (const link of [...encoded.history, encoded.pending]) {
    expect(Object.hasOwn(link.previous, 'ciphertext')).toBe(false)
    expect(Object.hasOwn(link.next, 'ciphertext')).toBe(false)
  }
  expect(text).not.toContain('private memory:'); expect(text).not.toContain('"dek":')
  vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined); vi.stubGlobal('indexedDB', undefined)
  const imported = await importContentAppendRecovery(text, f.client)
  expect(imported).toEqual({ record: f.next, payment: f.link.nextPayment, history: f.history, pending: f.pending.link, additionalPayments: [] })
  expect(f.sign).toHaveBeenCalledTimes(signCount); expect(f.decryptCall).toHaveBeenCalledTimes(decryptCount)
  expect(f.readPayment).toHaveBeenCalledTimes(3); expect(f.readTransitions).toHaveBeenCalledOnce()
})
it('imports without touching storage, locks, fetch, signing, decryption or adopting the pending next record', async () => {
  const f = await fixture(), text = await f.encode()
  const forbidden = vi.fn(() => { throw Error('No write or network allowed') })
  vi.stubGlobal('window', { localStorage: { getItem: forbidden, setItem: forbidden } })
  vi.stubGlobal('navigator', { locks: { request: forbidden } })
  vi.stubGlobal('indexedDB', { open: forbidden }); vi.stubGlobal('fetch', forbidden)
  f.sign.mockClear(); f.decryptCall.mockClear()
  const result = await importContentAppendRecovery(text, f.client)
  expect(result.record).toEqual(f.next); expect(result.record.authorSignature).not.toBe(f.pending.record.authorSignature)
  expect(result.pending!.next.authorSignature).toBe(f.pending.record.authorSignature)
  expect(forbidden).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled()
})
it('preserves an explicit null payment alongside valid history and pending evidence', async () => {
  const f = await fixture(), text = await exportContentAppendRecovery(f.next, f.client, () => null, f.readTransitions)
  const imported = await importContentAppendRecovery(text, f.client)
  expect(imported.payment).toBeNull(); expect(imported.history).toEqual(f.history); expect(imported.pending).toEqual(f.pending.link)
})
it.each([false, true])('exports a first preparation with no history and optional pending=%s', async pending => {
  const f = await contentAppendRebaseFixture(), transitions = { history: [], pending: pending ? f.link : null }
  const text = await exportContentAppendRecovery(f.previous, f.client,
    key => key === walrusSingleKey(contentAppendWalrusIntent(f.previous)) ? f.previousPayment : null, async () => transitions)
  const imported = await importContentAppendRecovery(text, f.client)
  expect(imported.record).toEqual(f.previous); expect(imported.history).toEqual([]); expect(imported.pending).toEqual(transitions.pending)
})
it('exports a committed rebased head with complete history and no pending transition', async () => {
  const f = await fixture(), text = await exportContentAppendRecovery(f.next, f.client, f.readPayment,
    async () => ({ history: f.history, pending: null }))
  const imported = await importContentAppendRecovery(text, f.client)
  expect(imported.history).toEqual(f.history); expect(imported.pending).toBeNull()
})
it.each(['missingHistory', 'missingPending', 'missingAdditionalPayments', 'oldSchema', 'extra', 'wrongSchema', 'noncanonical'])(
  'rejects malformed recovery envelope %s', async mode => {
    const f = await fixture(), text = await f.encode(), value = JSON.parse(text)
    if (mode === 'missingHistory') delete value.history
    if (mode === 'missingPending') delete value.pending
    if (mode === 'missingAdditionalPayments') delete value.additionalPayments
    if (mode === 'oldSchema') value.schema = 'soulidity.content-append-recovery.v1'
    if (mode === 'extra') value.extra = true
    if (mode === 'wrongSchema') value.schema = 'old-format'
    await expect(importContentAppendRecovery(mode === 'noncanonical' ? `${text}\n` : JSON.stringify(value), f.client)).rejects.toThrow()
  })
it.each(['missing', 'fork', 'reverse', 'signature', 'duplicateCiphertext', 'tooLong'])(
  'rejects tampered imported history %s', async mode => {
    const f = await fixture(), value = JSON.parse(await f.encode())
    if (mode === 'missing') value.history = []
    if (mode === 'fork') value.history = [f.link, f.pending.link]
    if (mode === 'reverse') value.history = [f.pending.link, f.link]
    if (mode === 'signature') value.history[0].next.authorSignature = f.previous.authorSignature
    if (mode === 'duplicateCiphertext') value.history[0].previous.ciphertext = value.preparation.ciphertext
    if (mode === 'tooLong') value.history = Array(17).fill(f.link)
    await expect(importContentAppendRecovery(JSON.stringify(value), f.client)).rejects.toThrow()
  })
it.each(['wrongPredecessor', 'signature', 'storageRoot', 'seed', 'inspection', 'duplicateCiphertext'])(
  'rejects tampered imported pending transition %s', async mode => {
    const f = await fixture(), value = JSON.parse(await f.encode())
    if (mode === 'wrongPredecessor') value.pending = f.link
    if (mode === 'signature') value.pending.next.authorSignature = f.previous.authorSignature
    if (mode === 'storageRoot') value.pending.previousPayment.approved.storageCost = '999'
    if (mode === 'seed') value.pending.nextPayment.approved.gasBudget = '999'
    if (mode === 'inspection') value.pending.inspection.blobObjectId = `0x${'ff'.repeat(32)}`
    if (mode === 'duplicateCiphertext') value.pending.next.ciphertext = value.preparation.ciphertext
    await expect(importContentAppendRecovery(JSON.stringify(value), f.client)).rejects.toThrow()
  })
it('rejects current payment intent substitution even when history and pending remain valid', async () => {
  const f = await fixture(), value = JSON.parse(await f.encode())
  value.payment.intent.payloadHash = 'ff'.repeat(32)
  await expect(importContentAppendRecovery(JSON.stringify(value), f.client)).rejects.toThrow('WALRUS_PREPARATION_MISMATCH')
})
it.each(['historyMissing', 'historyFork', 'pendingWrongHead', 'pendingSignature'])(
  'does not export inconsistent transition store evidence %s', async mode => {
    const f = await fixture()
    if (mode === 'historyMissing') f.transitions.history = []
    if (mode === 'historyFork') f.transitions.history = [f.link, f.pending.link]
    if (mode === 'pendingWrongHead') f.transitions.pending = f.link
    if (mode === 'pendingSignature') f.transitions.pending.next.authorSignature = f.previous.authorSignature
    await expect(f.encode()).rejects.toThrow()
  })
it('rejects a different valid signed sibling pending edge on export and import', async () => {
  const f = await fixture(), sibling = await f.advance(f.previous, f.previousPayment)
  const siblingNext = await f.advance(sibling.record, sibling.payment)
  await expect(exportContentAppendRecovery(f.next, f.client, f.readPayment,
    async () => ({ history: f.history, pending: siblingNext.link }))).rejects.toThrow('PENDING_MISMATCH')
  const value = JSON.parse(await f.encode()); value.pending = siblingNext.link
  await expect(importContentAppendRecovery(JSON.stringify(value), f.client)).rejects.toThrow('PENDING_MISMATCH')
})
it('cold recovery retains original auto-grant requirements across omission and a prepared restoration', async () => {
  const f = await contentAppendRebaseFixture({ autoGrant: true, autoGrantScopeMask: 9 })
  const omitted = await f.advance(f.next, f.link.nextPayment, { autoGrantPlan: null })
  const targets = parseContentAppendIntent(f.next).rebase!.autoGrantTargets
  const restored = await f.advance(omitted.record, omitted.payment, { autoGrantPlan: {
    capacityBefore: '2', capacityAfter: '2', targets: structuredClone(targets) } })
  const text = await exportContentAppendRecovery(omitted.record, f.client,
    key => key === walrusSingleKey(contentAppendWalrusIntent(omitted.record)) ? omitted.payment : null,
    async () => ({ history: [f.link, omitted.link], pending: restored.link }))
  vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined); vi.stubGlobal('indexedDB', undefined)
  f.sign.mockClear(); f.decryptCall.mockClear()
  const imported = await importContentAppendRecovery(text, f.client)
  expect(parseContentAppendIntent(imported.record).autoGrantPlan).toBeNull()
  expect(parseContentAppendIntent(imported.record).rebase!.autoGrantTargets).toEqual(targets)
  const pendingIntent = JSON.parse(imported.pending!.next.scope.intentJson)
  expect(pendingIntent.rebase.autoGrantTargets).toEqual(targets)
  expect(pendingIntent.autoGrantPlan.targets).toEqual(targets)
  expect(imported.pending!.nextPayment.register).toEqual(f.previousPayment.register)
  expect((text.match(/"ciphertext":/g) ?? [])).toHaveLength(1)
  expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled()
})
it('rejects target-metadata erasure in a cold exported pending preparation', async () => {
  const f = await contentAppendRebaseFixture({ autoGrant: true })
  const text = await exportContentAppendRecovery(f.previous, f.client,
    key => key === walrusSingleKey(contentAppendWalrusIntent(f.previous)) ? f.previousPayment : null,
    async () => ({ history: [], pending: f.link }))
  const value = JSON.parse(text), intent = JSON.parse(value.pending.next.scope.intentJson)
  intent.rebase.autoGrantTargets = []; value.pending.next.scope.intentJson = JSON.stringify(intent)
  await expect(importContentAppendRecovery(JSON.stringify(value), f.client)).rejects.toThrow()
})

it('exports exact extra ancestor and pending-next packets beyond immutable history snapshots', async () => {
  const f = await fixture()
  const ancestor = { ...f.previousPayment, certify: { ...await f.packet(31), phase: 'SIGNED' as const } }
  const pending = { ...f.pending.payment, certify: { ...await f.packet(32), phase: 'SIGNED' as const } }
  const records = new Map([f.previous, f.next, f.pending.record].map((record, n) => [
    walrusSingleKey(contentAppendWalrusIntent(record)), [ancestor, f.link.nextPayment, pending][n],
  ]))
  const read = vi.fn(key => records.get(key) ?? null)
  const text = await exportContentAppendRecovery(f.next, f.client, read, f.readTransitions)
  expect(read).toHaveBeenCalledTimes(3)
  expect(new Set(read.mock.calls.map(([key]) => key)).size).toBe(3)
  const wire = JSON.parse(text)
  expect(wire.schema).toBe('soulidity.content-append-recovery.v2')
  expect(wire.additionalPayments).toEqual([ancestor, pending])
  expect(wire.history[0].previousPayment.certify).toBeNull()
  expect(wire.pending.nextPayment.certify).toBeNull()
  const forbidden = vi.fn(() => { throw Error('Detached import cannot read the old device') })
  vi.stubGlobal('window', { localStorage: { getItem: forbidden, setItem: forbidden } })
  vi.stubGlobal('navigator', { locks: { request: forbidden } }); vi.stubGlobal('indexedDB', { open: forbidden })
  const cold = await importContentAppendRecovery(text, f.client)
  expect(cold.additionalPayments).toEqual([ancestor, pending]); expect(forbidden).not.toHaveBeenCalled()
  expect((text.match(/"ciphertext":/g) ?? [])).toHaveLength(1)
})

it('preserves distinct exact certify packets for the same known preparation without merging them', async () => {
  const f = await fixture(), wire = JSON.parse(await f.encode())
  const first = { ...f.previousPayment, certify: { ...await f.packet(41), phase: 'SIGNED' as const } }
  const second = { ...f.previousPayment, certify: { ...await f.packet(42), phase: 'SIGNED' as const } }
  wire.additionalPayments = [first, second]
  const cold = await importContentAppendRecovery(JSON.stringify(wire), f.client)
  expect(cold.additionalPayments).toEqual([first, second])
  expect(cold.additionalPayments[0].certify!.digest).not.toBe(cold.additionalPayments[1].certify!.digest)
  expect(cold.history[0].previousPayment.certify).toBeNull()
})

it('does not duplicate local WALs already present in head, history or pending snapshots', async () => {
  const f = await fixture()
  const records = new Map([[f.previous, f.previousPayment], [f.next, f.link.nextPayment], [f.pending.record, f.pending.payment]]
    .map(([record, payment]) => [walrusSingleKey(contentAppendWalrusIntent(record as typeof f.next)), payment as typeof f.previousPayment]))
  const text = await exportContentAppendRecovery(f.next, f.client, key => records.get(key) ?? null, f.readTransitions)
  expect((await importContentAppendRecovery(text, f.client)).additionalPayments).toEqual([])
})

it.each(['missing', 'null', 'tooMany', 'unknownPreparation', 'wrongPayload', 'wrongPaidRoot', 'wrongRebaseGas',
  'duplicateSnapshot', 'duplicateExtra', 'packetDigest'] as const)('rejects %s additional payment evidence', async mode => {
  const f = await fixture(), wire = JSON.parse(await f.encode())
  const extra = { ...structuredClone(f.previousPayment), certify: { ...await f.packet(51), phase: 'SIGNED' as const } }
  wire.additionalPayments = [extra]
  if (mode === 'missing') delete wire.additionalPayments
  if (mode === 'null') wire.additionalPayments = null
  if (mode === 'tooMany') wire.additionalPayments = Array(129).fill(extra)
  if (mode === 'unknownPreparation') extra.intent.operationScope += ':foreign'
  if (mode === 'wrongPayload') extra.intent.payloadHash = 'ff'.repeat(32)
  if (mode === 'wrongPaidRoot') extra.approved!.storageCost = '999'
  if (mode === 'wrongRebaseGas') { wire.additionalPayments = [structuredClone(f.link.nextPayment)]; wire.additionalPayments[0].approved.gasBudget = '999' }
  if (mode === 'duplicateSnapshot') wire.additionalPayments = [f.previousPayment]
  if (mode === 'duplicateExtra') wire.additionalPayments.push(structuredClone(extra))
  if (mode === 'packetDigest') extra.certify.digest = f.previousPayment.register!.digest
  const errors = { missing: 'IMPORT_SCHEMA_INVALID', null: 'ADDITIONAL_PAYMENTS_LIMIT', tooMany: 'ADDITIONAL_PAYMENTS_LIMIT',
    unknownPreparation: 'ADDITIONAL_PAYMENT_UNKNOWN_PREPARATION', wrongPayload: 'WALRUS_PREPARATION_MISMATCH',
    wrongPaidRoot: 'PAYMENT_ROOT_MISMATCH', wrongRebaseGas: 'PAYMENT_ROOT_MISMATCH', duplicateSnapshot: 'ADDITIONAL_PAYMENT_DUPLICATE',
    duplicateExtra: 'ADDITIONAL_PAYMENT_DUPLICATE', packetDigest: 'WALRUS_PACKET_BYTES_MISMATCH' }
  await expect(importContentAppendRecovery(JSON.stringify(wire), f.client)).rejects.toThrow(errors[mode])
})

it('rejects a swapped ancestor WAL before export instead of silently omitting it', async () => {
  const f = await fixture()
  await expect(exportContentAppendRecovery(f.next, f.client, () => f.link.nextPayment, f.readTransitions))
    .rejects.toThrow('WALRUS_PREPARATION_MISMATCH')
})

it('snapshots additional payments before asynchronous signature verification', async () => {
  const f = await fixture(), bundle = await importContentAppendRecovery(await f.encode(), f.client)
  bundle.additionalPayments.push({ ...f.previousPayment, certify: { ...await f.packet(61), phase: 'SIGNED' } })
  const expected = structuredClone(bundle.additionalPayments), pending = verifyContentAppendRecoveryBundle(bundle, f.client)
  bundle.additionalPayments[0].certify!.digest = 'caller mutation'; bundle.additionalPayments.length = 0
  expect((await pending).additionalPayments).toEqual(expected)
})
