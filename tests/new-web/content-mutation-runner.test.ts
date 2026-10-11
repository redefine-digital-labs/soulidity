import { expect, it, vi } from 'vitest'
// Deliberately isolate coordinator ordering from chain/BCS validation, which is
// exercised by content-mutation-transaction tests with real transaction bytes.
vi.mock('../../web/lib/soulidity/content-mutation-transaction', () => ({
  contentMutationKey: (p: any) => `soulidity.content-mutation:${['chainIdentifier', 'originalPackageId', 'callablePackageId', 'marketConfigId', 'kindRegistryId'].map(key => p.deployment[key]).join(':')}:${p.soulId}:${p.author}`,
  parseContentMutationRecord: (input: any) => {
    const r = structuredClone(input), p = r?.packet
    if (r?.schema !== 'soulidity.content-mutation.v1' || !r.plan || !p || !p.bytes || !p.digest
      || !['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(p.phase)
      || p.phase === 'SIGNED' && !p.signature
      || ['PREPARED', 'SIGNING', 'CANCELLED'].includes(p.phase) && p.signature !== null) throw new Error('invalid record')
    return r
  },
}))
import { runContentMutation, type ContentMutationAdapter } from '../../web/lib/soulidity/content-mutation-runner'
import { type ContentMutationStore } from '../../web/lib/soulidity/content-mutation-store'
import { type ContentMutationRecord } from '../../web/lib/soulidity/content-mutation-transaction'

function fixture() {
  const record = { schema: 'soulidity.content-mutation.v1', plan: {
    deployment: { chainIdentifier: 'chain', originalPackageId: 'original', callablePackageId: 'callable', marketConfigId: 'market', kindRegistryId: 'registry' },
    soulId: 'soul', stateId: 'state', contentId: 'content', author: 'alice', ownershipEpoch: '1', kind: 3,
    action: 'delete', target: { name: 'sprite', versionIndex: '9007199254740993' }, expectedActive: null, grantId: null, expectedSlot: 'AA==',
  }, packet: { bytes: 'exact bytes', digest: 'digest-one', expirationEpoch: '4', phase: 'PREPARED', signature: null } } as ContentMutationRecord
  const events: string[] = []
  let saved: ContentMutationRecord | null = null, locked = false, executed = false
  const store: ContentMutationStore = {
    exclusive: async (_key, work) => {
      if (locked) throw new Error('busy')
      locked = true
      try { return await work() } finally { locked = false }
    },
    read: () => structuredClone(saved),
    write: (_key, r) => { events.push(`persist:${r.packet.phase}`); saved = structuredClone(r) },
    list: () => saved ? [structuredClone(saved)] : [], discover: () => saved ? [structuredClone(saved)] : [], history: () => [],
  }
  const adapter: ContentMutationAdapter = {
    prepare: vi.fn(async plan => { events.push('prepare'); return { ...structuredClone(record), plan } }),
    query: vi.fn(async () => { events.push('query'); return { status: executed ? 'SUCCEEDED' : 'MISSING' } }),
    preflight: vi.fn(async () => { events.push('preflight') }),
    sign: vi.fn(async r => { events.push('sign'); return { bytes: r.packet.bytes, signature: 'valid signature' } }),
    verifySignature: vi.fn(async r => { events.push('verify'); if (r.packet.signature !== 'valid signature') throw new Error('invalid signature') }),
    broadcast: vi.fn(async () => { events.push('broadcast'); executed = true }),
  }
  const run = (options: Partial<Parameters<typeof runContentMutation>[0]> = {}) => runContentMutation({ plan: record.plan, store, adapter, ...options })
  return { record, events, store, adapter, run, saved: () => saved,
    install: (r: ContentMutationRecord) => { saved = structuredClone(r) }, execute: () => { executed = true } }
}
it('persists preparation before signing and verified signature before broadcast', async () => {
  const f = fixture()
  expect((await f.run()).status).toBe('SUCCEEDED')
  expect(f.events).toEqual(['prepare', 'persist:PREPARED', 'query', 'preflight', 'persist:SIGNING', 'sign', 'verify', 'persist:SIGNED', 'preflight', 'verify', 'broadcast', 'query', 'persist:SUCCEEDED'])
})
it.each(['resume', 'cancel'])('checks the selected %s packet inside the lock before touching a newer same-plan head', async mode => {
  const f = fixture(); f.install(f.record)
  const original = f.store.exclusive
  f.store.exclusive = (key, work) => {
    f.install({ ...f.record, packet: { ...f.record.packet, bytes: 'new gas refs bytes', digest: 'new-gas-digest' } })
    return original(key, work)
  }
  await expect(f.run({ expectedPacket: { bytes: f.record.packet.bytes, digest: f.record.packet.digest },
    ...(mode === 'cancel' ? { cancelUnsigned: true } : {}) })).rejects.toThrow('SELECTED_PACKET_CHANGED')
  expect(f.saved()?.packet.phase).toBe('PREPARED'); expect(f.saved()?.packet.digest).toBe('new-gas-digest')
  expect(f.events).toEqual([]); expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each(['PREPARED', 'SIGNING', 'SIGNED'])('stops on %s persistence failure and preserves the last committed bytes', async phase => {
  const f = fixture(), write = f.store.write
  f.store.write = (key, r) => { if (r.packet.phase === phase) throw new Error('quota'); write(key, r) }
  await expect(f.run()).rejects.toThrow('quota')
  expect(f.adapter.broadcast).not.toHaveBeenCalled()
  if (phase !== 'SIGNED') expect(f.adapter.sign).not.toHaveBeenCalled()
  else {
    expect(f.saved()?.packet.phase).toBe('SIGNING')
    f.store.write = write
    expect((await f.run()).status).toBe('SUCCEEDED')
    expect(f.adapter.prepare).toHaveBeenCalledOnce()
    expect(f.saved()?.packet.bytes).toBe(f.record.packet.bytes)
  }
})
it('independently verifies durable readback even with an adapter store silently dropping a write', async () => {
  const f = fixture(); f.store.write = () => {}
  await expect(f.run()).rejects.toThrow('PERSISTENCE_FAILED')
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('unknown broadcast retains SIGNED and retry queries the same digest without preparing/signing again', async () => {
  const f = fixture()
  vi.mocked(f.adapter.broadcast).mockImplementationOnce(async () => { f.execute(); throw new Error('lost response') })
  await expect(f.run()).rejects.toThrow('lost response')
  expect(f.saved()?.packet.phase).toBe('SIGNED')
  f.events.length = 0
  expect((await f.run()).status).toBe('SUCCEEDED')
  expect(f.events).toEqual(['query', 'persist:SUCCEEDED'])
  expect(f.adapter.prepare).toHaveBeenCalledOnce(); expect(f.adapter.sign).toHaveBeenCalledOnce()
})
it('unknown signing is recoverable with identical bytes and cannot be cancelled or replaced', async () => {
  const f = fixture(); vi.mocked(f.adapter.sign).mockRejectedValueOnce(new Error('unknown signing'))
  await expect(f.run()).rejects.toThrow('unknown signing')
  expect(f.saved()?.packet.phase).toBe('SIGNING')
  await expect(f.run({ cancelUnsigned: true })).rejects.toThrow('CANNOT_CANCEL_SIGNING')
  await expect(f.run({ plan: { ...f.record.plan, action: 'purge' } })).rejects.toThrow('RECOVERY_REQUIRED')
  expect((await f.run()).status).toBe('SUCCEEDED'); expect(f.adapter.prepare).toHaveBeenCalledOnce()
  expect(vi.mocked(f.adapter.sign).mock.calls.map(([r]) => r.packet.bytes)).toEqual(['exact bytes', 'exact bytes'])
})
it.each(['changed bytes', 'wrong signature'])('rejects %s before persistence or broadcast', async mutation => {
  const f = fixture()
  vi.mocked(f.adapter.sign).mockResolvedValue({ bytes: mutation === 'changed bytes' ? 'tampered' : f.record.packet.bytes,
    signature: mutation === 'wrong signature' ? 'invalid signature' : 'valid signature' })
  await expect(f.run()).rejects.toThrow()
  expect(f.saved()?.packet.phase).toBe('SIGNING'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each(['outage', 'pending'])('never signs or broadcasts through query %s', async condition => {
  const f = fixture(); f.install(f.record)
  if (condition === 'outage') vi.mocked(f.adapter.query).mockRejectedValue(new Error('offline'))
  else vi.mocked(f.adapter.query).mockResolvedValue({ status: 'PENDING' })
  if (condition === 'outage') await expect(f.run()).rejects.toThrow('offline')
  else expect((await f.run()).status).toBe('PENDING')
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  expect(f.events.some(event => event.startsWith('persist:'))).toBe(false)
})
it('query-only never changes local state, even when cached phase differs from actual final evidence', async () => {
  const f = fixture(); f.install(f.record); f.execute()
  const result = await f.run({ queryOnly: true })
  expect(result.status).toBe('SUCCEEDED'); expect(result.record.packet.phase).toBe('PREPARED')
  expect(f.saved()).toEqual(f.record); expect(f.events).toEqual(['query'])
  expect(f.adapter.preflight).not.toHaveBeenCalled()
})
it('unknown locally forged terminal is not trusted as execution evidence', async () => {
  const f = fixture(); f.install({ ...f.record, packet: { ...f.record.packet, phase: 'SUCCEEDED' } })
  await expect(f.run()).rejects.toThrow('RESULT_UNCONFIRMED')
  expect((await f.run({ queryOnly: true })).status).toBe('MISSING')
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('cancels only stored PREPARED and queries CANCELLED before replacing it with a new intent', async () => {
  const f = fixture(); f.install(f.record)
  expect((await f.run({ cancelUnsigned: true })).record.packet.phase).toBe('CANCELLED')
  expect(f.adapter.sign).not.toHaveBeenCalled()
  const next = { ...f.record.plan, action: 'purge' as const }
  expect((await f.run({ plan: next, startNew: true })).status).toBe('SUCCEEDED')
  expect(f.events.slice(0, 4)).toEqual(['query', 'persist:CANCELLED', 'query', 'prepare'])
})
it('rechecks prior terminal before preparing a different intent and preserves it on query failure', async () => {
  const f = fixture(); await f.run(); const before = f.saved()
  vi.mocked(f.adapter.query).mockRejectedValueOnce(new Error('history unavailable'))
  await expect(f.run({ plan: { ...f.record.plan, action: 'purge' } })).rejects.toThrow('history unavailable')
  expect(f.saved()).toEqual(before); expect(f.adapter.prepare).toHaveBeenCalledOnce()
})
it('holds its scope lock throughout the wallet request', async () => {
  const f = fixture(); let release!: () => void
  vi.mocked(f.adapter.sign).mockImplementationOnce(async r => {
    await new Promise<void>(resolve => { release = resolve }); return { bytes: r.packet.bytes, signature: 'valid signature' }
  })
  const first = f.run()
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  await expect(f.run()).rejects.toThrow('busy')
  release(); await first
})
it('requires Resume for an unfinished matching intent instead of preparing on repeated UI clicks', async () => {
  const f = fixture(); f.install(f.record)
  await expect(f.run({ startNew: true })).rejects.toThrow('RECOVERY_REQUIRED')
  expect(f.adapter.prepare).not.toHaveBeenCalled(); expect(f.adapter.sign).not.toHaveBeenCalled()
  expect((await f.run()).status).toBe('SUCCEEDED')
})
it('explicitly retries a cancelled matching intent without treating cancellation as chain evidence', async () => {
  const f = fixture(); f.install(f.record)
  await f.run({ cancelUnsigned: true })
  expect((await f.run()).record.packet.phase).toBe('CANCELLED')
  expect(f.adapter.prepare).not.toHaveBeenCalled()
  expect((await f.run({ startNew: true })).status).toBe('SUCCEEDED')
  expect(f.adapter.prepare).toHaveBeenCalledOnce()
})
it('captures plan before asynchronous preparation and rejects a mismatched prepared intent', async () => {
  const f = fixture(), plan = structuredClone(f.record.plan)
  const promise = f.run({ plan }); plan.action = 'purge'
  expect((await promise).record.plan.action).toBe('delete')
  const other = fixture()
  vi.mocked(other.adapter.prepare).mockResolvedValue({ ...other.record, plan: { ...other.record.plan, action: 'purge' } })
  await expect(other.run()).rejects.toThrow('PREPARATION_MISMATCH'); expect(other.saved()).toBeNull()
})
