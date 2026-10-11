import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { toBase58 } from '@mysten/sui/utils'
import { readSoulDetailState, SoulDetailStateBcs } from '@soulidity/sdk'
import { readBrowserContentWriteState, getBrowserContentWriteConfig } from '../../web/lib/soulidity/browser-content-write-state'
import { browserContentAccessFixture } from './fixtures/browser-content-access-raw'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })
function fixture() {
  const f = browserContentAccessFixture()
  const config = { target: f.config.target, kindRegistryId: f.registry.id }
  const params = { soulId: f.soul.id, stateId: f.state.id, contentId: f.content.id, viewerAddress: f.state.current_owner as string | null, config }
  const read = (extra = {}) => readBrowserContentWriteState({ ...params, ...extra }, { client: () => f.client })
  return { ...f, config, params, read }
}
function addKind(f: ReturnType<typeof fixture>, kind = 2) {
  const pkg = f.deployment.originalPackageId
  const descriptor = { version: '1', kind, name: 'new_skill', op_mask: '7', read_mode_mask: '3',
    has_active_binding: false, requires_download_policy: false, default_grant_scope_mask: '4', deprecated: false }
  const fieldId = f.field(f.registry.kinds.id, 'u32', bcs.u32(), kind, `${pkg}::kind_registry::KindDescriptor`, SoulDetailStateBcs.Descriptor, descriptor)
  f.field(f.registry.name_to_kind.id, '0x1::string::String', bcs.string(), descriptor.name, 'u32', bcs.u32(), kind)
  return { descriptor, fieldId }
}
it('returns the complete raw domain snapshot without requiring an existing target name/version or Blob download', async () => {
  const f = fixture(); f.rows.delete(f.blob.id); f.rows.delete(f.blobFieldId)
  const fetcher = vi.fn(() => { throw new Error('No API') }); vi.stubGlobal('fetch', fetcher)
  const result = await f.read()
  expect(result).toMatchObject({ soulId: f.soul.id, stateId: f.state.id, contentId: f.content.id,
    originalPackageId: f.config.target.soulidityOriginalPackageId, callablePackageId: f.config.target.soulidityCallablePackageId,
    kindRegistryId: f.registry.id, snapshot: { notAuthorization: true, observedAtMs: '1000', ownershipEpoch: '2' } })
  expect(result.snapshot.contentVersions.filter(v => v.kind === 3).map(v => v.versionIndex)).toEqual(['0', '1'])
  expect(result.snapshot.contentVersions.filter(v => v.name === 'not-yet-appended')).toEqual([])
  expect(result.snapshot.kindDescriptors.find(d => d.kind === 3)).toEqual(f.descriptor)
  expect(result.snapshot.activeBindings).toEqual([f.active])
  expect(result.snapshot.config.find(c => c.key === 'sprite_config_json')?.valueUtf8).toBe('{"frames":2}')
  expect(result.snapshot.config.find(c => c.key.startsWith('content_seal_envelope_v1:'))).toBeDefined()
  expect(f.system).not.toHaveBeenCalled(); expect(f.reset).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
})
it('explicitly reads a current registered kind with no content or paid entry', async () => {
  const f = fixture(), { descriptor } = addKind(f)
  expect((await f.read()).snapshot.kindDescriptors.some(d => d.kind === 2)).toBe(false)
  const result = await f.read({ kind: 2 })
  expect(result.snapshot.kindDescriptors.find(d => d.kind === 2)).toEqual(descriptor)
  expect(result.snapshot.contentVersions.some(v => v.kind === 2)).toBe(false)
})
it('requested but nonexistent kind fails visibly rather than returning an empty descriptor', async () => {
  const f = fixture(); await expect(f.read({ kind: 2 })).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it('requested descriptor and reverse index must both bind the actual kind', async () => {
  const f = fixture(), { descriptor } = addKind(f)
  f.field(f.registry.name_to_kind.id, '0x1::string::String', bcs.string(), descriptor.name, 'u32', bcs.u32(), 3)
  await expect(f.read({ kind: 2 })).rejects.toThrow('KIND_NAME_MISMATCH')
})
it.each([null, -1, 1.5, '2', NaN, Infinity, 4294967296])('rejects malformed optional kind %s before I/O', async kind => {
  const f = fixture(); await expect(f.read({ kind })).rejects.toThrow('KIND_INVALID'); expect(f.get).not.toHaveBeenCalled()
})
it.each(['owner', 'grantee', 'anonymous'] as const)('viewer %s selects only display scope, never manufactures write permission', async viewer => {
  const f = fixture(), viewerAddress = viewer === 'owner' ? f.state.current_owner : viewer === 'grantee' ? f.grant.grantee : null
  const result = await f.read({ viewerAddress })
  expect(result.snapshot.notAuthorization).toBe(true)
  expect(result.snapshot.currentOwner).toBe(f.state.current_owner)
  expect(result.snapshot.grants[0].grant?.grantee).toBe(f.grant.grantee)
  expect(result.snapshot.paidEntriesScope).toBe(viewer === 'owner' ? 'ALL_BUYERS' : 'VIEWER_ADDRESSES_ONLY')
  expect(result.snapshot.paidAccessEntries).toHaveLength(viewer === 'owner' ? 2 : viewer === 'grantee' ? 1 : 0)
})
it('fresh calls observe actual Clock expiry without dropping the expired grant record', async () => {
  const f = fixture()
  expect((await f.read({ viewerAddress: f.grant.grantee })).snapshot.grants[0].unexpiredAtObservation).toBe(true)
  f.putClock('2000')
  const expired = await f.read({ viewerAddress: f.grant.grantee })
  expect(expired.snapshot.observedAtMs).toBe('2000'); expect(expired.snapshot.grants[0].unexpiredAtObservation).toBe(false)
  expect(expired.snapshot.paidAccessEntries[0].unexpiredAtObservation).toBe(false)
})
it('keeps deleted/purged slots and current deprecated descriptors for the mutation controller to judge', async () => {
  const f = fixture(); f.slots[0].deleted = true; f.slots[0].purged = true; f.putSlots(); f.descriptor.deprecated = true; f.putDescriptor()
  const result = await f.read()
  expect(result.snapshot.contentVersions.find(v => v.kind === 3 && v.versionIndex === '0')?.slot).toMatchObject({ deleted: true, purged: true, op_mask: '15' })
  expect(result.snapshot.kindDescriptors.find(d => d.kind === 3)?.deprecated).toBe(true)
})
it('preserves full u64 observation/epoch values as strings', async () => {
  const f = fixture(); f.putClock('18446744073709551615'); f.state.ownership_epoch = '9007199254740993'; f.state.active_grant_count = '0'; f.putState()
  const result = await f.read()
  expect(result.snapshot.observedAtMs).toBe('18446744073709551615'); expect(result.snapshot.ownershipEpoch).toBe('9007199254740993')
})
it.each(['soulId', 'stateId', 'contentId'] as const)('refuses false %s hint', async field => {
  const f = fixture(); await expect(f.read({ [field]: '0x' + '99'.repeat(32) })).rejects.toThrow()
})
it('refuses a wrong chain before returning any preflight state', async () => {
  const f = fixture(); f.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(1)) })
  await expect(f.read()).rejects.toThrow()
})
it.each(['extra storage', 'missing registry', 'zero registry', 'wrong target', 'secret'] as const)('rejects invalid config %s before I/O', async variant => {
  const f = fixture(), config: any = structuredClone(f.config)
  if (variant === 'extra storage') config.storage = f.blob
  if (variant === 'missing registry') delete config.kindRegistryId
  if (variant === 'zero registry') config.kindRegistryId = '0x' + '0'.repeat(64)
  if (variant === 'wrong target') config.target.soulidityOriginalPackageId = '0x1'
  if (variant === 'secret') config.target.token = 'secret'
  await expect(f.read({ config })).rejects.toThrow(); expect(f.get).not.toHaveBeenCalled()
})
it('captures caller values before awaits and returns a detached deeply frozen snapshot', async () => {
  const f = fixture(), pending = f.read()
  f.config.kindRegistryId = '0x' + '99'.repeat(32); f.params.viewerAddress = null; f.params.stateId = '0x' + '88'.repeat(32)
  const result = await pending
  expect(result.kindRegistryId).toBe(f.registry.id); expect(result.snapshot.paidEntriesScope).toBe('ALL_BUYERS')
  expect(Object.isFrozen(result.snapshot.grants[0].slot)).toBe(true)
  expect(Object.isFrozen(result.snapshot.config[0].valueBytes)).toBe(true)
  f.slots[0].deleted = true; f.putSlots()
  expect(result.snapshot.contentVersions.find(v => v.kind === 3 && v.versionIndex === '0')?.slot.deleted).toBe(false)
})
it('works without Buffer, uses only captured public config and needs no storage URL', async () => {
  const f = fixture(); vi.stubGlobal('Buffer', undefined)
  vi.stubEnv('NEXT_PUBLIC_SUI_NETWORK', 'mainnet'); vi.stubEnv('NEXT_PUBLIC_SOULIDITY_CALLABLE_PACKAGE_ID', f.config.target.soulidityCallablePackageId)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_ORIGINAL_PACKAGE_ID', f.config.target.soulidityOriginalPackageId)
  vi.stubEnv('NEXT_PUBLIC_ANIMACRAFT_V8_RECEIVE_TARGET_JSON', JSON.stringify(f.config.target))
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', f.registry.id); vi.stubEnv('NEXT_PUBLIC_WALRUS_AGGREGATOR_URL', undefined)
  expect(getBrowserContentWriteConfig()).toEqual(f.config); expect((await f.read()).snapshot.contentId).toBe(f.content.id)
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', undefined); vi.stubEnv('SOULIDITY_KIND_REGISTRY_ID', f.registry.id)
  expect(() => getBrowserContentWriteConfig()).toThrow()
})
it('pre-abort and cancellation of non-cooperative transport cannot return state', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort(new Error('wallet changed'))
  await expect(f.read({ signal: abort.signal })).rejects.toThrow('wallet changed'); expect(f.get).not.toHaveBeenCalled()
  const live = new AbortController(); f.chain.mockImplementation(() => new Promise(() => {}))
  const result = expect(f.read({ signal: live.signal })).rejects.toThrow('cancel read'); live.abort(new Error('cancel read')); await result
})
it('enforces the 45-second outer deadline against an uncooperative transport', async () => {
  const f = fixture(); vi.useFakeTimers()
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const c = new AbortController(); setTimeout(() => c.abort(new Error('deadline')), ms); return c.signal })
  f.chain.mockImplementation(() => new Promise(() => {}))
  const result = expect(f.read()).rejects.toThrow('deadline'); await vi.advanceTimersByTimeAsync(45001); await result
})

it.each([null, '2', [2, 2], [-1], [4294967296], [1.5], ['2'], new Array(1), Array.from({ length: 257 }, (_, i) => i)])(
  'SDK rejects malformed/duplicate/over-budget requested kind collection before transport', async kindIds => {
    const f = fixture(), raw = f.rows.get(f.state.id)
    await expect(readSoulDetailState({ client: f.client, deployment: f.deployment, stateId: f.state.id,
      expectedState: { version: String(raw.version), digest: raw.digest }, viewerAddresses: [], kindIds: kindIds as never }))
      .rejects.toThrow('INVALID_REQUESTED_KINDS')
    expect(f.chain).not.toHaveBeenCalled()
  })
it('SDK captures requested kinds before await and rechecks their complete raw bytes', async () => {
  const f = fixture(), { descriptor, fieldId } = addKind(f), raw = f.rows.get(f.state.id), kindIds = [2]
  const pending = readSoulDetailState({ client: f.client, deployment: f.deployment, stateId: f.state.id,
    expectedState: { version: String(raw.version), digest: raw.digest }, viewerAddresses: [], kindIds })
  kindIds[0] = 999
  expect((await pending).kindDescriptors.find(d => d.kind === 2)).toEqual(descriptor)
  let reads = 0, original = f.batch.getMockImplementation()!
  f.batch.mockImplementation((async (...args: any[]) => {
    if (args[0].requests.some((r: any) => r.objectId === fieldId) && ++reads === 2) {
      const row = f.rows.get(fieldId); row.digest = toBase58(new Uint8Array(32).fill(2))
    }
    return Reflect.apply(original, f.client.ledgerService, args)
  }) as any)
  await expect(f.read({ kind: 2 })).rejects.toThrow(/changed|CHANGED/i)
})
