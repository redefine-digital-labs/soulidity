// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { contentAppendOperationFixture } from './fixtures/content-append-operation'
import { useSoulContentAppend } from '../../web/lib/hooks/use-soul-content-append'
import { contentEnvelopeKey, decodeContentEnvelope } from '../../web/lib/soulidity/content-envelope'

const h = vi.hoisted(() => ({ fixture: null as any, account: null as any, wallet: {}, client: null as any,
  saved: null as any, archived: null as any, prepared: null as any, events: [] as string[], personal: vi.fn(), sign: vi.fn(), success: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => h.account, useCurrentWallet: () => ({ currentWallet: h.wallet }),
  useSuiClient: () => h.client, useSignPersonalMessage: () => ({ mutateAsync: h.personal }), useSignTransaction: () => ({ mutateAsync: h.sign }) }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ getAuthHeaders: async () => ({}) }) }))
vi.mock('../../web/lib/soulidity/browser-content-write-state', async original => ({ ...await original<any>(),
  getBrowserContentWriteConfig: () => h.fixture.config }))
vi.mock('../../web/lib/soulidity/content-append-preparation', async original => {
  const actual = await original<any>()
  return { ...actual, prepareContentAppend: async (params: any) => {
    // Fixture initialization already supplies its own crypto client. Only the
    // hook's wallet transport needs the local key/server-capable client.
    const input = h.fixture ? { ...params, wallet: { ...params.wallet,
      client: h.fixture.crypto.client, sealClient: h.fixture.crypto.client } } : params
    const record = await actual.prepareContentAppend(input)
    if (h.fixture) { h.prepared = record; h.events.push('prepared') }
    return record
  } }
})
vi.mock('../../web/lib/soulidity/content-append-operation', async original => {
  const actual = await original<any>()
  return { ...actual, runContentAppend: async (params: any) => {
    expect(params.record).toBe(h.saved)
    h.events.push('run'); h.fixture.bindPreparedRecord(params.record)
    const result = await actual.runContentAppend(params, { read: h.fixture.read,
      upload: h.fixture.upload, acknowledge: h.fixture.acknowledge })
    h.events.push('proved'); return result
  } }
})
vi.mock('../../web/lib/soulidity/content-append-store', async original => ({ ...await original<any>(),
  browserContentAppendStore: () => ({
    list: async () => h.saved ? [h.saved] : [], listArchived: async () => h.archived ? [h.archived] : [],
    read: async () => h.saved, exclusive: async (_key: string, work: () => Promise<unknown>) => work(),
    create: async (_key: string, record: any) => { h.saved = record; h.events.push('stored') },
    archive: async (_key: string, record: any) => {
      expect(h.events.at(-1)).toBe('proved'); expect(record).toBe(h.saved)
      h.archived = record; h.saved = null; h.events.push('archived')
    },
  }) }))
vi.mock('../../web/lib/soulidity/content-append-restore-store', () => ({
  browserContentAppendRestoreStore: () => ({ read: async () => null, list: async () => [] }) }))
vi.mock('../../web/lib/soulidity/content-append-rebase-store', () => ({
  browserContentAppendRebaseStore: () => ({ pending: async () => null }) }))

afterEach(() => { h.fixture = null; vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

// The hook, preparation, runner, attachment validation and BCS reader are real.
// Wallet/key transport, upload-induced ledger rows and local store are controlled;
// this is neither browser/IDB persistence nor broadcast/new-deployment evidence.
it('connects Memory append hook preparation to the same encrypted upload and proved v1 before archive', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('Uint8Array', structuredClone(new Uint8Array()).constructor)
  vi.stubGlobal('crypto', webcrypto)
  const f = await contentAppendOperationFixture({ memory: true }), initialRecord = f.record
  h.fixture = f; h.account = { address: f.scope.author }; h.client = { grpc: f.raw.client }
  h.saved = null; h.archived = null; h.events = []
  h.personal.mockImplementation(async ({ message }) => f.crypto.signer.signPersonalMessage(message))
  h.sign.mockImplementation(async () => { throw new Error('No chain signature expected in controlled upload') })
  h.success.mockImplementation(() => h.events.push('success'))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ targets: [] }) })))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const soul = { originalPackageId: f.scope.originalPackageId, onChainId: f.raw.soul.id,
    stateOnChainId: f.raw.state.id, contentOnChainId: f.raw.content.id, currentOwnershipEpoch: f.raw.state.ownership_epoch }
  let current!: ReturnType<typeof useSoulContentAppend>
  function Probe() { current = useSoulContentAppend(soul as any, 'owner', false, h.success); return null }
  const host = document.createElement('div'), root = createRoot(host)
  const source = new TextEncoder().encode('New Memory from the connected hook, not the fixture preparation.')
  const file = new File([source], 'memory.txt', { type: 'text/plain' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(source).buffer })
  try {
    await act(async () => root.render(<Probe />))
    expect(h.personal).not.toHaveBeenCalled()
    let version: any
    await act(async () => { version = await current.append({ kind: 1, name: 'default', file,
      uploadType: 'encrypted', slotReadModeMask: 3, downloadPolicy: 'public' }) })
    expect(current.error).toBeNull(); expect(current.pending).toBe(false)
    expect(h.events).toEqual(['prepared', 'stored', 'run', 'proved', 'archived', 'success'])
    expect(h.archived).toBe(h.prepared); expect(f.record).toBe(h.prepared)
    expect(f.record.ciphertext).not.toEqual(initialRecord.ciphertext)
    expect(f.upload.mock.calls[0][0].payload).toEqual(h.prepared.ciphertext)
    expect(f.record.plaintextByteLength).toBe(source.length)
    expect(new TextDecoder().decode(f.record.ciphertext)).not.toContain('New Memory')
    expect(version).toMatchObject({ kind: 1, name: 'default', versionIndex: '1', slot: { blob_object_id: f.result.blobObjectId } })
    const after = (await f.read()).snapshot, before = f.proof.snapshot
    expect(after.contentVersions.find(v => v.kind === 1 && v.versionIndex === '0'))
      .toEqual(before.contentVersions.find(v => v.kind === 1 && v.versionIndex === '0'))
    expect(after.contentVersions.find(v => v.kind === 1 && v.versionIndex === '1')).toEqual(version)
    expect(after.activeBindings).toEqual(before.activeBindings)
    const identity = { contentObjectId: f.scope.contentObjectId, kind: 1, name: 'default', versionIndex: '1', blobObjectId: f.result.blobObjectId }
    const stored = after.config.find(c => c.key === contentEnvelopeKey(identity))!
    expect(decodeContentEnvelope(stored.valueUtf8, identity, f.scope.originalPackageId).sidecar).toEqual(h.prepared.sidecar)
    expect(h.personal).toHaveBeenCalledOnce(); expect(h.sign).not.toHaveBeenCalled(); expect(h.success).toHaveBeenCalledOnce()
  } finally { await act(async () => root.unmount()); host.remove() }
})
