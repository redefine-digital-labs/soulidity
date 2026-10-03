import { afterEach, describe, expect, it, vi } from 'vitest'
import { contentAppendRebaseFixture } from './fixtures/content-append-rebase'
import { contentAppendPreparationFingerprint, type ContentAppendPreparation } from '../../web/lib/soulidity/content-append-preparation'
import { contentAppendWalrusIntent, queryContentAppend } from '../../web/lib/soulidity/content-append-operation'
import { contentAppendStoreKey, type ContentAppendStore } from '../../web/lib/soulidity/content-append-store'
import { walrusSingleKey, type WalrusSingleRecord } from '../../web/lib/upload/walrus-single-operation'
import { verifyContentAppendRecoveryBundle, exportContentAppendRecovery, importContentAppendRecovery } from '../../web/lib/soulidity/content-append-recovery'
import { queryContentAppendCompletion, queryLocalContentAppendCompletion, finishContentAppendCompletion,
  describeContentAppendCompletion } from '../../web/lib/soulidity/content-append-completion'

// Real AES/Seal preparations, rewrapped signed ancestry and canonical signed Sui
// packet evidence. Query finality and archive I/O are explicit controlled seams;
// this coordinator suite does not prove Move, Walrus quorum or IDB durability.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
type QueryResult = Awaited<ReturnType<typeof queryContentAppend>>
type Outcome = 'success' | 'failed' | 'unknown' | 'error'
const fingerprint = contentAppendPreparationFingerprint
const walKey = (record: ContentAppendPreparation) => walrusSingleKey(contentAppendWalrusIntent(record))

async function fixture() {
  const f = await contentAppendRebaseFixture()
  const signed = async (n: number) => ({ ...await f.packet(n), phase: 'SIGNED' as const })
  const ancestor = { ...structuredClone(f.previousPayment), certify: await signed(2) }
  f.link.previousPayment = structuredClone(ancestor)
  f.link.inspection.retirement = { kind: 'FAILED', digest: ancestor.certify.digest, observedSuiEpoch: null }
  const headAtTransition = { ...structuredClone(f.link.nextPayment), certify: await signed(3) }
  const pending = await f.advance(f.next, headAtTransition)
  pending.link.inspection.retirement = { kind: 'EXPIRED', digest: headAtTransition.certify.digest, observedSuiEpoch: '13' }
  const headPayment = { ...structuredClone(f.link.nextPayment), certify: await signed(4) }
  const bundle = await verifyContentAppendRecoveryBundle({ record: f.next, payment: headPayment, history: [f.link], pending: pending.link,
    additionalPayments: [] }, f.client)
  const local = new Map<string, WalrusSingleRecord>([
    [walKey(f.previous), { ...structuredClone(ancestor), certify: await signed(10) }],
    [walKey(f.next), { ...structuredClone(headPayment), certify: await signed(5) }],
    [walKey(pending.record), { ...structuredClone(pending.payment), certify: await signed(6) }],
  ])
  const slotKey = contentAppendStoreKey(f.next.scope), walKeys = [...local.keys()].sort()
  const held = new Set<string>(), events: string[] = [], archived = new Map<string, ContentAppendPreparation>()
  let active: ContentAppendPreparation | null = structuredClone(f.next), wallet: string | null = f.next.scope.author
  let restore: unknown = null, archiveFailure: 'before' | 'after' | null = null, requireLocks = false
  const outcomes = new Map<string, Outcome>()
  const snapshot = () => ({ local: structuredClone(local), bundle: structuredClone(bundle) })
  const original = snapshot(), signCount = f.sign.mock.calls.length, decryptCount = f.decryptCall.mock.calls.length
  function allHeld() {
    expect(held).toEqual(new Set([`scope:${slotKey}`, ...walKeys]))
  }
  const store: ContentAppendStore = {
    exclusive: vi.fn(async (key, work) => {
      const scope = `scope:${key}`; expect(held.has(scope)).toBe(false)
      held.add(scope); events.push('scope:enter')
      try { return await work() } finally { held.delete(scope); events.push('scope:exit') }
    }),
    read: vi.fn(async key => { expect(key).toBe(slotKey); expect(held.has(`scope:${slotKey}`)).toBe(true); return structuredClone(active) }),
    archive: vi.fn(async (key, record) => {
      allHeld(); expect(key).toBe(slotKey); expect(fingerprint(record)).toBe(fingerprint(f.next)); events.push('archive')
      if (archiveFailure === 'before') { archiveFailure = null; throw new Error('archive interrupted before commit') }
      const fp = fingerprint(record)
      if (active && fingerprint(active) !== fp || !active && !archived.has(fp)) throw new Error('fixture archive CAS mismatch')
      archived.set(fp, structuredClone(record)); active = null
      if (archiveFailure === 'after') { archiveFailure = null; throw new Error('archive readback interrupted') }
    }),
    create: vi.fn(async () => { throw new Error('Completion cannot create a preparation') }),
    list: vi.fn(async () => []), listArchived: vi.fn(async () => [...archived.values()]),
  }
  const read = vi.fn((key: string) => {
    if (requireLocks) allHeld()
    events.push(`read:${key}`); return structuredClone(local.get(key) ?? null)
  })
  const lock = vi.fn(async <T>(key: string, work: () => Promise<T>) => {
    expect(held.has(`scope:${slotKey}`)).toBe(true); expect(held.has(key)).toBe(false)
    held.add(key); events.push(`lock:${key}`)
    try { return await work() } finally { held.delete(key); events.push(`unlock:${key}`) }
  })
  const query = vi.fn(async (params: Parameters<typeof queryContentAppend>[0]): Promise<QueryResult> => {
    if (requireLocks) allHeld()
    expect(params.execution.getAddress()).toBeNull(); expect(params.execution.beforeWrite).toBeUndefined()
    const payment = params.payment ?? null, digest = payment?.certify?.digest ?? null
    events.push(`query:${fingerprint(params.record)}:${digest}`)
    const outcome = digest ? outcomes.get(digest) ?? 'unknown' : 'unknown'
    if (outcome === 'error') throw new Error(`historical RPC unavailable: ${digest}`)
    const recoveryKey = walKey(params.record)
    if (outcome === 'success') return {
      recovery: { status: 'CERTIFIED', recoveryKey, record: payment, result: {
        blobObjectId: payment!.uploaded!.blobObjectId, blobId: payment!.uploaded!.blobId,
        blobUrl: 'https://offline.example/blobs/proved', contentHash: params.record.contentHash,
        storageTxDigest: payment!.register!.digest, certifyTxDigest: digest!, recoveryKey,
      } },
      historical: { preparationFingerprint: fingerprint(params.record), certifyDigest: digest!, versionIndex: params.record.scope.versionIndex,
        blobObjectId: payment!.uploaded!.blobObjectId, blobWrapperId: `0x${'99'.repeat(32)}`, stateVersion: '12', contentVersion: '12', slot: {} },
      current: null, currentStatus: 'CHANGED', currentReason: 'Later transfer',
    } as QueryResult
    return { recovery: { status: payment === null ? 'NONE' : outcome === 'failed' ? 'FAILED' : 'UNKNOWN', recoveryKey, record: payment },
      historical: null, current: null, currentStatus: 'NOT_CONFIRMED', currentReason: null } as QueryResult
  })
  const readBundle = vi.fn(async (record: ContentAppendPreparation) => {
    expect(fingerprint(record)).toBe(fingerprint(f.next)); return structuredClone(bundle)
  })
  const restoreRead = vi.fn(async () => structuredClone(restore))
  const deps = { query, read, lock, store: () => store, restores: () => ({ read: restoreRead }) as never, bundle: readBundle }
  const queryImported = () => queryContentAppendCompletion({ bundle, client: f.client, signal: f.controller.signal }, deps)
  const queryLocal = () => queryLocalContentAppendCompletion({ record: f.next, client: f.client, signal: f.controller.signal }, deps)
  const finish = () => {
    requireLocks = true
    return finishContentAppendCompletion({ record: f.next, client: f.client, signal: f.controller.signal, getAddress: () => wallet }, deps)
  }
  const evidenceUnchanged = () => {
    expect(snapshot()).toEqual(original); expect(f.sign).toHaveBeenCalledTimes(signCount); expect(f.decryptCall).toHaveBeenCalledTimes(decryptCount)
    expect(store.create).not.toHaveBeenCalled()
  }
  return { ...f, bundle, pending, ancestor, headAtTransition, headPayment, local, slotKey, walKeys, held, events, archived,
    outcomes, store, query, read, lock, readBundle, restoreRead, deps, queryImported, queryLocal, finish, evidenceUnchanged,
    active: () => active, setActive: (value: ContentAppendPreparation | null) => { active = value },
    setWallet: (value: string | null) => { wallet = value }, setRestore: (value: unknown) => { restore = value },
    failArchive: (when: 'before' | 'after') => { archiveFailure = when } }
}

describe('completion queries retain every known attempt', () => {
  it('queries ancestors, pending predecessors and detached head without consulting any local state', async () => {
    const f = await fixture(), result = await f.queryImported()
    expect(result.completed).toBeNull(); expect(result.attempts).toHaveLength(5)
    expect(f.query.mock.calls.map(([p]) => p.payment?.certify?.digest ?? null)).toEqual([
      f.ancestor.certify.digest, null, f.headAtTransition.certify.digest, null, f.headPayment.certify.digest,
    ])
    expect(f.read).not.toHaveBeenCalled(); expect(f.lock).not.toHaveBeenCalled(); expect(f.readBundle).not.toHaveBeenCalled()
    expect(f.store.exclusive).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled(); f.evidenceUnchanged()
  })
  it('queries all distinct local certify packets as well as snapshots without merging different packets for one preparation', async () => {
    const f = await fixture(), result = await f.queryLocal()
    expect(result.attempts).toHaveLength(8)
    const queried = f.query.mock.calls.map(([p]) => p.payment?.certify?.digest).filter(Boolean)
    expect(queried).toEqual(expect.arrayContaining([f.ancestor.certify.digest, f.headAtTransition.certify.digest,
      f.headPayment.certify.digest, ...[...f.local.values()].map(wal => wal.certify!.digest)]))
    expect(new Set(queried).size).toBe(6)
    expect(f.query.mock.calls.filter(([p]) => fingerprint(p.record) === fingerprint(f.next))).toHaveLength(4)
    expect(f.readBundle).toHaveBeenCalledOnce(); expect(f.store.archive).not.toHaveBeenCalled(); f.evidenceUnchanged()
  })
  it('preserves an explicit imported null WAL and never falls through to the local paid head', async () => {
    const f = await fixture(); f.bundle.payment = null
    await f.queryImported()
    expect(f.query.mock.calls.at(-1)![0].payment).toBeNull()
    expect(f.read).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled()
  })
  it('deduplicates identical local snapshots while retaining distinct history packets', async () => {
    const f = await fixture()
    f.local.set(walKey(f.previous), structuredClone(f.ancestor)); f.local.set(walKey(f.next), structuredClone(f.headPayment))
    f.local.set(walKey(f.pending.record), structuredClone(f.pending.payment))
    expect((await f.queryLocal()).attempts).toHaveLength(5)
  })
  it.each(['failed', 'unknown', 'error'] as const)('retains a successful ancestor while newer attempts are %s and queries all later packets', async outcome => {
    const f = await fixture()
    for (const payment of [...f.local.values(), f.headAtTransition, f.headPayment]) f.outcomes.set(payment.certify!.digest, outcome)
    f.outcomes.set(f.ancestor.certify.digest, 'success')
    const result = await f.queryLocal()
    expect(result.completed?.record).toEqual(f.previous); expect(result.completed?.result?.historical?.certifyDigest).toBe(f.ancestor.certify.digest)
    expect(result.attempts).toHaveLength(8); expect(f.query).toHaveBeenCalledTimes(8)
    expect(describeContentAppendCompletion(result)).toContain(`Original append v2 verified (${f.ancestor.certify.digest})`)
    expect(describeContentAppendCompletion(result)).toContain('Current state has since changed.')
    expect(f.store.archive).not.toHaveBeenCalled(); f.evidenceUnchanged()
  })
  it('finds a success known only in the pending local WAL', async () => {
    const f = await fixture(), digest = f.local.get(walKey(f.pending.record))!.certify!.digest
    f.outcomes.set(digest, 'success')
    expect((await f.queryLocal()).completed?.record).toEqual(f.pending.record)
    expect((await f.queryImported()).completed).toBeNull()
  })
  it('queries every distinct exported additional packet on a detached device without reading any local WAL', async () => {
    const f = await fixture(); f.bundle.additionalPayments = structuredClone([...f.local.values()])
    const extra = f.local.get(walKey(f.previous))!
    f.outcomes.set(extra.certify!.digest, 'success')
    const result = await f.queryImported()
    expect(result.attempts).toHaveLength(8)
    expect(result.completed?.result?.historical?.certifyDigest).toBe(extra.certify!.digest)
    expect(f.read).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled()
  })
  it('real cold export/import retains an ancestor local extra certificate and makes its successful outcome queryable', async () => {
    const f = await fixture(), extra = f.local.get(walKey(f.previous))!
    const text = await exportContentAppendRecovery(f.next, f.client, key => structuredClone(f.local.get(key) ?? null),
      async () => ({ history: f.bundle.history, pending: f.bundle.pending }))
    const imported = await importContentAppendRecovery(text, f.client)
    expect(imported.additionalPayments.map(payment => payment.certify!.digest)).toContain(extra.certify!.digest)
    f.outcomes.set(extra.certify!.digest, 'success')
    vi.stubGlobal('window', undefined); vi.stubGlobal('navigator', undefined); vi.stubGlobal('indexedDB', undefined)
    const result = await queryContentAppendCompletion({ bundle: imported, client: f.client, signal: f.controller.signal }, f.deps)
    expect(result.attempts).toHaveLength(7)
    expect(result.completed?.record).toEqual(f.previous)
    expect(result.completed?.result?.historical?.certifyDigest).toBe(extra.certify!.digest)
    expect(f.read).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled(); f.evidenceUnchanged()
  })
  it('does not interpret claimed CERTIFIED status without historical proof as completion', async () => {
    const f = await fixture()
    f.query.mockImplementation(async p => ({ recovery: { status: 'CERTIFIED', record: p.payment }, historical: null,
      current: null, currentStatus: 'NOT_CONFIRMED', currentReason: null }) as QueryResult)
    const result = await f.queryImported()
    expect(result.completed).toBeNull(); expect(describeContentAppendCompletion(result)).toContain('Original completion is not proved.')
  })
  it('verifies ancestry and exact payment intent before querying any packet', async () => {
    const f = await fixture(); f.bundle.history[0].previous.scope.intentJson = '{}'
    await expect(f.queryImported()).rejects.toThrow(); expect(f.query).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled()
  })
  it('rejects a conflicting local payment intent before any query or archive', async () => {
    const f = await fixture(); f.local.get(walKey(f.previous))!.intent.payloadHash = 'ff'.repeat(32)
    await expect(f.finish()).rejects.toThrow('WALRUS_PREPARATION_MISMATCH')
    expect(f.query).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled(); expect(f.held.size).toBe(0)
  })
  it('passes an unsigned execution context and preserves cancellation rather than recording it as an RPC error', async () => {
    const f = await fixture()
    f.query.mockImplementationOnce(async p => {
      await expect(p.execution.sign(undefined as never)).rejects.toThrow('CONTENT_APPEND_COMPLETION_CANNOT_SIGN')
      f.controller.abort(new Error('query cancelled'))
      throw new Error('underlying cancelled transport')
    })
    await expect(f.queryImported()).rejects.toThrow('query cancelled'); expect(f.query).toHaveBeenCalledOnce()
    expect(f.store.archive).not.toHaveBeenCalled(); f.evidenceUnchanged()
  })
})

describe('explicit completion archive coordinator', () => {
  it('holds the scope and every ancestor/pending WAL through querying all attempts and archiving the exact active head', async () => {
    const f = await fixture(); f.outcomes.set(f.ancestor.certify.digest, 'success')
    const result = await f.finish()
    expect(result.completed?.record).toEqual(f.previous); expect(f.query).toHaveBeenCalledTimes(8)
    expect(f.store.archive).toHaveBeenCalledExactlyOnceWith(f.slotKey, f.next)
    expect(f.archived.get(fingerprint(f.next))).toEqual(f.next); expect(f.archived.has(fingerprint(f.previous))).toBe(false)
    expect(f.active()).toBeNull(); expect(f.lock.mock.calls.map(([key]) => key)).toEqual(f.walKeys)
    expect(f.events.indexOf('archive')).toBeGreaterThan(f.events.findLastIndex(e => e.startsWith('query:')))
    expect(f.events.at(-1)).toBe('scope:exit'); expect(f.held.size).toBe(0); f.evidenceUnchanged()
  })
  it.each(['unknown', 'failed', 'error'] as const)('does not archive without success when all known packets are %s', async outcome => {
    const f = await fixture()
    for (const payment of [f.ancestor, f.headAtTransition, f.headPayment, ...f.local.values()]) f.outcomes.set(payment.certify!.digest, outcome)
    await expect(f.finish()).rejects.toThrow('CONTENT_APPEND_COMPLETION_ORIGINAL_SUCCESS_NOT_PROVED')
    expect(f.query).toHaveBeenCalledTimes(8); expect(f.store.archive).not.toHaveBeenCalled(); expect(f.active()).toEqual(f.next)
    expect(f.held.size).toBe(0); f.evidenceUnchanged()
  })
  it.each(['before', 'after'] as const)('retries an archive interrupted %s commit without rewriting any payment phase or history', async when => {
    const f = await fixture(); f.outcomes.set(f.ancestor.certify.digest, 'success'); f.failArchive(when)
    await expect(f.finish()).rejects.toThrow(when === 'before' ? 'archive interrupted before commit' : 'archive readback interrupted')
    expect(f.active()).toEqual(when === 'before' ? f.next : null); expect(f.held.size).toBe(0); f.evidenceUnchanged()
    await expect(f.finish()).resolves.toMatchObject({ completed: { record: f.previous } })
    expect(f.store.archive).toHaveBeenCalledTimes(2); expect(f.query).toHaveBeenCalledTimes(16)
    expect(f.archived.size).toBe(1); expect(f.active()).toBeNull(); expect(f.held.size).toBe(0); f.evidenceUnchanged()
  })
  it('allows an idempotent explicit retry only for the same archived head', async () => {
    const f = await fixture(); f.outcomes.set(f.ancestor.certify.digest, 'success')
    await f.finish(); await f.finish()
    expect(f.archived.size).toBe(1); expect(f.query).toHaveBeenCalledTimes(16); f.evidenceUnchanged()
  })
  it('rejects a different active preparation before querying or acquiring WAL locks', async () => {
    const f = await fixture(); f.setActive(f.pending.record)
    await expect(f.finish()).rejects.toThrow('CONTENT_APPEND_COMPLETION_ACTIVE_CHANGED')
    expect(f.readBundle).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled(); expect(f.lock).not.toHaveBeenCalled()
    expect(f.store.archive).not.toHaveBeenCalled(); expect(f.active()).toEqual(f.pending.record); f.evidenceUnchanged()
  })
  it('does not finish while a restore marker is pending', async () => {
    const f = await fixture(); f.setRestore({ unfinished: true })
    await expect(f.finish()).rejects.toThrow('CONTENT_APPEND_COMPLETION_RESTORE_UNFINISHED')
    expect(f.readBundle).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled()
    expect(f.held.size).toBe(0); f.evidenceUnchanged()
  })
  it.each([null, `0x${'99'.repeat(32)}`])('rejects wallet %s before accessing local storage', async wallet => {
    const f = await fixture(); f.setWallet(wallet)
    await expect(f.finish()).rejects.toThrow('CONTENT_APPEND_COMPLETION_RECONNECT_AUTHOR_WALLET')
    expect(f.store.exclusive).not.toHaveBeenCalled(); expect(f.store.read).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled()
    expect(f.store.archive).not.toHaveBeenCalled(); f.evidenceUnchanged()
  })
  it.each(['wallet', 'abort'] as const)('does not archive after %s changes during a successful historical query', async reason => {
    const f = await fixture(); f.outcomes.set(f.ancestor.certify.digest, 'success')
    const query = f.query.getMockImplementation()!
    f.query.mockImplementationOnce(async p => {
      const result = await query(p)
      if (reason === 'wallet') f.setWallet(null)
      else f.controller.abort(new Error('finish cancelled'))
      return result
    })
    await expect(f.finish()).rejects.toThrow(reason === 'wallet' ? 'RECONNECT_AUTHOR_WALLET' : 'finish cancelled')
    expect(f.store.archive).not.toHaveBeenCalled(); expect(f.active()).toEqual(f.next); expect(f.held.size).toBe(0); f.evidenceUnchanged()
  })
  it('releases the slot and previously acquired WAL locks when another WAL is busy', async () => {
    const f = await fixture(), original = f.lock.getMockImplementation()!
    f.lock.mockImplementation(async (key, work) => {
      if (key === f.walKeys[1]) throw new Error('WAL busy in another tab')
      return original(key, work)
    })
    await expect(f.finish()).rejects.toThrow('WAL busy in another tab')
    expect(f.query).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled(); expect(f.held.size).toBe(0); f.evidenceUnchanged()
  })
  it('captures the exportable receipt again under every WAL lock before proving and archiving', async () => {
    const f = await fixture(); f.outcomes.set(f.ancestor.certify.digest, 'success')
    f.readBundle.mockImplementation(async () => {
      expect(f.held).toEqual(new Set(f.readBundle.mock.calls.length === 1 ? [`scope:${f.slotKey}`] : [`scope:${f.slotKey}`, ...f.walKeys]))
      return structuredClone(f.bundle)
    })
    await f.finish(); expect(f.readBundle).toHaveBeenCalledTimes(2); expect(f.store.archive).toHaveBeenCalledOnce(); f.evidenceUnchanged()
  })
  it('retains active recovery when its newly advanced locked receipt cannot be exported', async () => {
    const f = await fixture(); f.outcomes.set(f.ancestor.certify.digest, 'success')
    f.readBundle.mockResolvedValueOnce(structuredClone(f.bundle)).mockRejectedValueOnce(Error('CONTENT_APPEND_RECOVERY_EXPORT_SIZE_INVALID'))
    await expect(f.finish()).rejects.toThrow('EXPORT_SIZE_INVALID')
    expect(f.query).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled(); expect(f.active()).toEqual(f.next)
    expect(f.held.size).toBe(0); f.evidenceUnchanged()
  })
})
