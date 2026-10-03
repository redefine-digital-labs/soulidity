import { afterEach, expect, it, vi } from 'vitest'
import { contentAppendRebaseFixture } from './fixtures/content-append-rebase'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'
import { restoreContentAppend, mergeContentAppendRestorePayment } from '../../web/lib/soulidity/content-append-restore'
import { assertWalrusSingleChain, walrusSingleKey, type WalrusSinglePacket, type WalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { exportContentAppendRecovery, importContentAppendRecovery, type ContentAppendRecoveryBundle } from '../../web/lib/soulidity/content-append-recovery'

// Real Seal/AES records, Ed25519 stamps and canonical Sui packet BCS. Query
// outcomes and local storage are injected boundaries, not chain finality or
// browser IndexedDB durability. No signer/uploader/broadcaster is available.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function fixture() {
  const f = await contentAppendRebaseFixture(), pending = await f.advance()
  const oldCert = await f.packet(2), currentCert = await f.packet(3)
  const bundle: ContentAppendRecoveryBundle = { record: f.next,
    payment: { ...f.link.nextPayment, certify: { ...currentCert, phase: 'SIGNED' } }, history: [structuredClone(f.link)], pending: pending.link, additionalPayments: [] }
  bundle.history[0].previousPayment.certify = { ...oldCert, phase: 'SIGNED' }
  bundle.history[0].inspection.retirement = { kind: 'FAILED', digest: oldCert.digest, observedSuiEpoch: null }
  const originals = new Map([bundle.history[0].previousPayment, bundle.payment!, pending.payment].map(p => [walrusSingleKey(p.intent), structuredClone(p)]))
  const keys = [...originals.keys()].sort((a, b) => a.localeCompare(b)), wal = new Map<string, WalrusSingleRecord>()
  let marker: ContentAppendRecoveryBundle | null = null, active: ContentAppendRecoveryBundle['record'] | null = null
  let installedHistory: ContentAppendRecoveryBundle['history'] = [], installedPending: ContentAppendRecoveryBundle['pending'] = null
  const events: string[] = [], held = new Set<string>(); let failure: string | null = null
  function event(name: string) { events.push(name); if (failure === name) { failure = null; throw Error(`interrupted:${name}`) } }
  const read = vi.fn((key: string) => { event(`read:${keys.indexOf(key)}`); return structuredClone(wal.get(key) ?? null) })
  const write = vi.fn((key: string, payment: WalrusSingleRecord) => {
    wal.set(key, structuredClone(payment)); event(`write:${keys.indexOf(key)}`); return key
  })
  const lock = vi.fn(async (key: string, work: () => Promise<any>) => {
    event(`lock:${keys.indexOf(key)}`); held.add(key)
    try { return await work() } finally { held.delete(key); events.push(`unlock:${keys.indexOf(key)}`) }
  })
  const exclusive = vi.fn(async (_key: string, work: () => Promise<any>) => work())
  const stage = vi.fn(async (input: ContentAppendRecoveryBundle) => {
    if (marker) expect(input).toEqual(marker)
    marker = structuredClone(input); event('marker')
  })
  const complete = vi.fn(async (input: ContentAppendRecoveryBundle) => {
    expect(held.size).toBe(keys.length); event('before-activation')
    active = structuredClone(input.record); installedHistory = structuredClone(input.history); installedPending = structuredClone(input.pending)
    marker = null; event('activation')
  })
  const stageRead = vi.fn(async () => { event('active-read'); return active })
  const chain = vi.fn(async (execution: Parameters<typeof assertWalrusSingleChain>[0], network: Parameters<typeof assertWalrusSingleChain>[1]) => {
    event('chain'); return assertWalrusSingleChain(execution, network)
  })
  const query = vi.fn(async (execution: any, packet: WalrusSinglePacket) => {
    expect(held.size).toBe(keys.length); event(`query:${packet.digest}`)
    await expect(execution.sign()).rejects.toThrow('RESTORE_CANNOT_SIGN')
    return { status: packet.digest === oldCert.digest ? 'FAILED' : 'SUCCEEDED' } as any
  })
  const deps = { read, write, lock, chain, query,
    store: () => ({ exclusive, read: stageRead }) as any, restores: () => ({ stage, complete }) as any }
  const params = { bundle, client: f.client, getAddress: f.params.wallet.getAddress, signal: f.controller.signal }
  const run = () => restoreContentAppend(params, deps)
  f.sign.mockClear(); f.decryptCall.mockClear()
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No network in restore test') }))
  return { ...f, bundle, pending, oldCert, currentCert, originals, keys, wal, events, held, read, write, lock, exclusive,
    stage, complete, stageRead, chain, query, params, deps, run, interrupt: (name: string) => { failure = name },
    state: () => ({ marker, active, history: installedHistory, pending: installedPending }) }
}
function noCryptoWrites(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.sign).not.toHaveBeenCalled(); expect(f.decryptCall).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
}
it('restores every history/current/pending key with query-all → marker → WAL/readback → activation under all locks', async () => {
  const f = await fixture(), active = await f.run()
  expect(active).toEqual(f.bundle.record); expect([...f.wal.keys()].sort()).toEqual([...f.keys].sort())
  expect(f.state()).toEqual({ marker: null, active: f.bundle.record, history: f.bundle.history, pending: f.bundle.pending })
  expect(f.lock.mock.calls.map(([key]) => key)).toEqual(f.keys); expect(f.held.size).toBe(0)
  expect(f.events.indexOf('chain')).toBeLessThan(f.events.indexOf('marker'))
  const queryPositions = f.events.map((name, n) => name.startsWith('query:') ? n : -1).filter(n => n >= 0)
  const writePositions = f.events.map((name, n) => name.startsWith('write:') ? n : -1).filter(n => n >= 0)
  expect(Math.max(...queryPositions)).toBeLessThan(Math.min(...writePositions))
  expect(Math.max(...queryPositions)).toBeLessThan(f.events.indexOf('marker'))
  expect(f.events.indexOf('marker')).toBeLessThan(Math.min(...writePositions))
  const lastWrite = Math.max(...writePositions), activate = f.events.indexOf('before-activation')
  expect(f.events.slice(lastWrite + 1, activate)).toEqual(f.keys.map((_, n) => `read:${n}`))
  expect(activate).toBeLessThan(f.events.indexOf('active-read'))
  expect(f.query.mock.calls.map(([, p]) => p.digest).filter(d => d === f.previousPayment.register!.digest)).toHaveLength(3)
  expect(f.wal.get(walrusSingleKey(f.bundle.history[0].previousPayment.intent))!.certify!.phase).toBe('FAILED')
  expect(f.wal.get(walrusSingleKey(f.bundle.payment!.intent))!.certify!.phase).toBe('SUCCEEDED')
  noCryptoWrites(f)
})
it.each(['marker', 'write:0', 'write:1', 'before-activation', 'activation', 'active-read'])('retries the same verified bundle after interruption at %s without losing packet evidence', async point => {
  const f = await fixture(); f.interrupt(point)
  await expect(f.run()).rejects.toThrow(`interrupted:${point}`)
  const written = structuredClone([...f.wal.entries()])
  await f.run()
  expect(f.state().active).toEqual(f.bundle.record); expect(f.state().marker).toBeNull(); expect(f.wal.size).toBe(3)
  for (const [key, payment] of written) expect(f.wal.get(key)).toEqual(payment)
  expect(f.stage.mock.calls.every(([bundle]) => JSON.stringify(bundle) === JSON.stringify(f.bundle))).toBe(true)
  noCryptoWrites(f)
})
it('refuses a lost WAL readback before activation and repairs that exact key on retry', async () => {
  const f = await fixture(); f.write.mockImplementationOnce(key => key)
  await expect(f.run()).rejects.toThrow('PAYMENT_READBACK_MISMATCH')
  expect(f.complete).not.toHaveBeenCalled(); expect(f.state().marker).toEqual(f.bundle); expect(f.state().active).toBeNull()
  await f.run(); expect(f.wal.size).toBe(3); expect(f.state().marker).toBeNull(); noCryptoWrites(f)
})
it.each(['register', 'certify'])('does not overwrite a local %s packet with a different imported digest', async stage => {
  const f = await fixture(), key = walrusSingleKey(f.bundle.payment!.intent), different = await f.packet(9)
  const local = { ...f.bundle.payment!, [stage]: { ...different, phase: stage === 'register' ? 'SUCCEEDED' as const : 'SIGNED' as const } }
  f.wal.set(key, structuredClone(local)); f.sign.mockClear()
  await expect(f.run()).rejects.toThrow('PACKET_CONFLICT')
  expect(f.wal.get(key)).toEqual(local); expect(f.stage).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it('preserves an advanced locally signed packet over the identical imported unsigned packet', async () => {
  const f = await fixture(), key = walrusSingleKey(f.bundle.payment!.intent), local = structuredClone(f.bundle.payment!)
  f.bundle.payment!.certify = { ...f.currentCert, phase: 'SIGNING', signature: null }
  f.wal.set(key, local)
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (execution, packet) => packet.digest === f.currentCert.digest ? { status: 'MISSING' } : original(execution, packet))
  await f.run()
  expect(f.wal.get(key)!.certify).toEqual(local.certify)
  expect(f.query.mock.calls.find(([, packet]) => packet.digest === f.currentCert.digest)![1].signature).toBe(f.currentCert.signature)
  noCryptoWrites(f)
})
it('restores an advanced additional ancestor packet and retains it in a subsequent cold export', async () => {
  const f = await fixture(), incoming = structuredClone(f.bundle.history[0].previousPayment)
  f.bundle.history[0].previousPayment.certify = { ...f.oldCert, phase: 'SIGNING', signature: null }
  f.bundle.additionalPayments = [incoming]
  const original = f.query.getMockImplementation()!
  f.query.mockImplementation(async (execution, packet) => packet.digest === f.oldCert.digest ? { status: 'MISSING' } : original(execution, packet))
  await f.run()
  const key = walrusSingleKey(incoming.intent)
  expect(f.wal.get(key)!.certify).toEqual(incoming.certify)
  expect(f.stage.mock.calls[0][0].additionalPayments).toEqual([incoming])
  const text = await exportContentAppendRecovery(f.bundle.record, f.client, f.read,
    async () => ({ history: f.state().history, pending: f.state().pending }))
  const cold = await importContentAppendRecovery(text, f.client)
  expect(cold.additionalPayments).toContainEqual(incoming)
  expect(cold.history[0].previousPayment.certify!.signature).toBeNull()
  noCryptoWrites(f)
})
it('rejects contradictory additional certify packets before marker, chain queries or WAL writes', async () => {
  const f = await fixture(), different = await f.packet(59)
  f.bundle.additionalPayments = [{ ...f.bundle.payment!, certify: { ...different, phase: 'SIGNED' } }]
  f.sign.mockClear()
  await expect(f.run()).rejects.toThrow('PACKET_CONFLICT')
  expect(f.stage).not.toHaveBeenCalled(); expect(f.chain).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled(); expect(f.wal.size).toBe(0)
  noCryptoWrites(f)
})
it.each(['MISSING', 'PENDING', 'FAILED'])('does not strand a marker or write WAL for an unconfirmed register (%s)', async status => {
  const f = await fixture(); f.query.mockResolvedValueOnce({ status })
  await expect(f.run()).rejects.toThrow('REGISTER_NOT_CONFIRMED_PAID')
  expect(f.state().marker).toBeNull(); expect(f.stage).not.toHaveBeenCalled()
  expect(f.write).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it('finishes all later queries before any WAL write even when an earlier packet was confirmed', async () => {
  const f = await fixture(), original = f.query.getMockImplementation()!; let calls = 0
  f.query.mockImplementation(async (execution, packet) => { if (++calls === 3) throw Error('RPC unavailable'); return original(execution, packet) })
  await expect(f.run()).rejects.toThrow('RPC unavailable')
  expect(f.query).toHaveBeenCalledTimes(3); expect(f.write).not.toHaveBeenCalled(); expect(f.complete).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it('rejects another chain before staging, queries or payment adoption', async () => {
  const f = await fixture(); vi.mocked(f.client.core.getChainIdentifier).mockResolvedValue({ chainIdentifier: 'wrong-chain' })
  await expect(f.run()).rejects.toThrow()
  expect(f.stage).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it.each(['author', 'cancelled'])('rejects %s before creating a restore marker', async reason => {
  const f = await fixture(); if (reason === 'author') f.setAddress(id(99)); else f.controller.abort()
  await expect(f.run()).rejects.toThrow()
  expect(f.stage).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it.each(['author', 'cancelled'])('stops a %s change during marker persistence before any WAL writes', async reason => {
  const f = await fixture(), original = f.stage.getMockImplementation()!
  f.stage.mockImplementationOnce(async bundle => { await original(bundle); if (reason === 'author') f.setAddress(null); else f.controller.abort() })
  await expect(f.run()).rejects.toThrow()
  expect(f.state().marker).toEqual(f.bundle); expect(f.query).toHaveBeenCalledTimes(5); expect(f.write).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it('requires a current paid packet even when history and pending include paid ancestors', async () => {
  const f = await fixture(); f.bundle.payment = null
  await expect(f.run()).rejects.toThrow('CURRENT_PAID_PACKET_REQUIRED')
  expect(f.stage).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it('rejects an unpaid first preparation whose otherwise valid WAL has no register packet', async () => {
  const f = await fixture()
  f.params.bundle = { record: f.previous, history: [], pending: null, additionalPayments: [],
    payment: { ...f.previousPayment, register: null, certify: null, uploaded: null, acknowledged: false } }
  await expect(f.run()).rejects.toThrow('CURRENT_PAID_PACKET_REQUIRED')
  expect(f.stage).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it('rejects an invalid author stamp before locks, queries or local adoption', async () => {
  const f = await fixture(); f.bundle.record.authorSignature = f.previous.authorSignature
  await expect(f.run()).rejects.toThrow()
  expect(f.exclusive).not.toHaveBeenCalled(); expect(f.stage).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled(); noCryptoWrites(f)
})
it('captures the verified input bundle and wallet callback before asynchronous chain checks', async () => {
  const f = await fixture(), expected = structuredClone(f.bundle), original = f.chain.getMockImplementation()!
  f.chain.mockImplementationOnce(async (execution, network) => {
    f.params.bundle = { ...f.bundle, payment: null, history: [], pending: null }
    f.params.getAddress = () => null
    return original(execution, network)
  })
  expect(await f.run()).toEqual(expected.record)
  expect(f.stage.mock.calls[0][0]).toEqual(expected); expect(f.state().history).toEqual(expected.history); noCryptoWrites(f)
})
it('refuses a missing active readback even after all WAL writes and retries the unchanged marker', async () => {
  const f = await fixture(); f.complete.mockImplementationOnce(async () => {})
  await expect(f.run()).rejects.toThrow('ACTIVE_READBACK_MISMATCH')
  expect(f.wal.size).toBe(3); expect(f.state().marker).toEqual(f.bundle); expect(f.state().active).toBeNull()
  await f.run(); expect(f.state().active).toEqual(f.bundle.record); noCryptoWrites(f)
})
it('rejects contradictory same-key certificates inside a verified bundle before marker staging', async () => {
  const f = await fixture(), other = await f.packet(10)
  f.bundle.pending!.previousPayment.certify = { ...other, phase: 'SIGNED' }
  // The signed pending edge retains its own predecessor evidence; neither
  // packet may silently replace the current bundle payment for this same key.
  f.bundle.pending!.inspection.retirement = { kind: 'FAILED', digest: other.digest, observedSuiEpoch: null }
  await expect(f.run()).rejects.toThrow('PACKET_CONFLICT')
  expect(f.stage).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled()
})
it('merges same-packet progress without mutating either source and never loses acknowledged success', async () => {
  const f = await fixture(), imported = structuredClone(f.bundle.payment!), local = structuredClone(imported)
  imported.certify = { ...f.currentCert, phase: 'SIGNING', signature: null }
  local.certify = { ...f.currentCert, phase: 'SUCCEEDED' }; local.acknowledged = true
  const before = structuredClone([imported, local]), merged = mergeContentAppendRestorePayment(imported, local)
  expect(merged.certify).toEqual(local.certify); expect(merged.acknowledged).toBe(true)
  expect([imported, local]).toEqual(before); expect(mergeContentAppendRestorePayment(local, imported)).toEqual(merged)
})
it.each(['signature', 'result', 'approval', 'upload'])('rejects conflicting same-key %s evidence during pure merge', async field => {
  const f = await fixture(), a = structuredClone(f.bundle.payment!), b = structuredClone(a)
  if (field === 'signature') b.certify!.signature = 'another serialized signature'
  if (field === 'result') { a.certify!.phase = 'SUCCEEDED'; b.certify!.phase = 'FAILED' }
  if (field === 'approval') b.approved!.quoteId = 'different payment'
  if (field === 'upload') b.uploaded!.certificate = 'different certificate'
  expect(() => mergeContentAppendRestorePayment(a, b)).toThrow(field === 'signature' ? 'SIGNATURE_CONFLICT' : field === 'result' ? 'RESULT_CONFLICT'
    : field === 'approval' ? 'PAYMENT_CONFLICT' : 'UPLOAD_CONFLICT')
})
it.each([true, false])('advances a matching local pre-register journal without losing the paid import (approval present=%s)', async approved => {
  const f = await fixture(), key = walrusSingleKey(f.bundle.payment!.intent), payment = f.bundle.payment!
  f.wal.set(key, { ...payment, encoding: null, approved: approved ? payment.approved : null,
    uploaded: null, register: null, certify: null, acknowledged: false })
  await f.run()
  expect(f.wal.get(key)!.encoding).toEqual(payment.encoding)
  expect(f.wal.get(key)!.approved).toEqual(payment.approved)
  expect(f.wal.get(key)!.register!.bytes).toBe(payment.register!.bytes)
  expect(f.wal.get(key)!.certify!.signature).toBe(payment.certify!.signature)
  noCryptoWrites(f)
})
