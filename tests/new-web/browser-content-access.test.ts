import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { toBase58 } from '@mysten/sui/utils'
import { readBrowserContentAccess, getBrowserContentAccessConfig, BROWSER_CONTENT_MAX_BYTES } from '../../web/lib/soulidity/browser-content-access'
import { browserContentAccessFixture as fixture } from './fixtures/browser-content-access-raw'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
it.each(['https://localhost', 'https://x.localhost', 'https://localhost.', 'https://127.0.0.1', 'https://2130706433',
  'https://[::1]', 'https://user:secret@storage.example', 'http://storage.example', 'https://storage.example/?token=secret',
  'https://storage.example/#secret'])('rejects non-public storage URL %s before I/O', async aggregatorUrl => {
  const f = fixture(); f.config.storage.aggregatorUrl = aggregatorUrl
  await expect(f.read()).rejects.toThrow('STORAGE_URL_INVALID'); expect(f.get).not.toHaveBeenCalled()
})
it.each(['雪', 'Main', 'a/b', 'a'.repeat(33)])('rejects name %s forbidden by actual Move ASCII/32-byte rules', async name => {
  const f = fixture(); await expect(f.read({ name })).rejects.toThrow('SLOT_IDENTITY_INVALID'); expect(f.get).not.toHaveBeenCalled()
})
it('reads actual raw owner authority, exact per-version envelope and contained certified Blob', async () => {
  const f = fixture(), result = await f.read()
  expect(result.access.accessKind).toBe('owner')
  expect(result.access.accessPolicy.versionIndex).toBe('0')
  expect(result.access.sealSidecar).toEqual(f.envelope.sidecar)
  await result.recheck()
  expect(f.execute).not.toHaveBeenCalled()
})
it.each(['granted-agent', 'paid', 'public'] as const)('uses actual raw %s authority without SQL or a custody/listing lookup', async kind => {
  const f = fixture(); let viewer: string | null = f.grant.grantee
  if (kind === 'paid') viewer = `0x${(1052).toString(16).padStart(64, '0')}`
  if (kind === 'public') { viewer = null; f.slots[0].read_mode_mask = '15'; f.slots[0].is_public = true; f.slots[0].download_policy = 0; f.putSlots() }
  const fetcher = vi.fn(() => { throw new Error('No HTTP API expected') }); vi.stubGlobal('fetch', fetcher)
  const result = await f.read({ viewerAddress: viewer })
  expect(result.access.accessKind).toBe(kind); expect(result.access.visibility).toBe('sealed')
  expect(result.access.accessPolicy.moduleName).toBe(kind === 'paid' ? 'paid_access' : 'content')
  expect(result.access.accessPolicy.soulGrantObjectId).toBe(kind === 'granted-agent' ? f.grant.id : null)
  expect(fetcher).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled()
})
it.each([0, 1, 2])('download policy %s is not an extra denial of the actual scoped grant', async policy => {
  const f = fixture(); f.slots[0].download_policy = policy; f.putSlots()
  expect((await f.read({ viewerAddress: f.grant.grantee })).access.accessKind).toBe('granted-agent')
})
it('no-policy/public value zero alone does not create READ_PUBLIC permission', async () => {
  const f = fixture(); f.slots[0].download_policy = 0; f.putSlots()
  await expect(f.read({ viewerAddress: null })).rejects.toThrow('ACCESS_DENIED')
})
it('deprecated descriptors keep valid historical access and wallet grants do not require holder custody', async () => {
  const f = fixture(); f.descriptor.deprecated = true; f.putDescriptor(); f.putGrant({ kind: 1, address: `0x${'0'.repeat(64)}` })
  expect((await f.read({ viewerAddress: f.grant.grantee })).access.accessKind).toBe('granted-agent')
})
it.each(['grant expiry', 'paid expiry', 'epoch', 'scope'] as const)('denies stale or noncovering %s from raw objects', async mutation => {
  const f = fixture(); let viewer = f.grant.grantee
  if (mutation === 'grant expiry') { f.grantSlot.expires_at_ms = '1000'; f.grant.expires_at_ms = '1000'; f.putGrantSlot(); f.putGrant()
    f.slots[0].read_mode_mask = '3'; f.putSlots() }
  if (mutation === 'paid expiry') { viewer = `0x${(1052).toString(16).padStart(64, '0')}`; f.entry.expires_at_ms = '1000'; f.putEntry(`0x${(1063).toString(16).padStart(64, '0')}`) }
  if (mutation === 'epoch') { f.state.ownership_epoch = '3'; f.state.active_grant_count = '0'; f.putState() }
  if (mutation === 'scope') { f.grant.scope_mask = '1'; f.grantSlot.scope_mask = '1'; f.putGrantSlot(); f.putGrant(); f.slots[0].read_mode_mask = '3'; f.putSlots() }
  await expect(f.read({ viewerAddress: viewer })).rejects.toThrow('ACCESS_DENIED')
})
it.each(['deleted', 'purged'])('does not open a %s slot', async flag => {
  const f = fixture(); f.slots[0].deleted = true; if (flag === 'purged') f.slots[0].purged = true; f.putSlots()
  await expect(f.read()).rejects.toThrow('VERSION_DELETED_OR_PURGED')
})
it.each(['1', '9007199254740993', '18446744073709551615'])('version %s stays a string and cannot select version zero or a missing envelope', async versionIndex => {
  const f = fixture(); await expect(f.read({ versionIndex })).rejects.toThrow(versionIndex === '1' ? 'ENVELOPE_MISSING' : 'VERSION_NOT_FOUND')
})
it.each(['01', '-1', '18446744073709551616', 0, null])('rejects malformed version %s before chain I/O', async versionIndex => {
  const f = fixture(); await expect(f.read({ versionIndex })).rejects.toThrow('VERSION_INVALID'); expect(f.get).not.toHaveBeenCalled()
})
it.each(['stateId', 'contentId', 'soulId'] as const)('does not trust caller %s hints', async field => {
  const f = fixture(); await expect(f.read({ [field]: `0x${'99'.repeat(32)}` })).rejects.toThrow()
})
it.each(['missing', 'wrong blob', 'bad UTF8', 'extra plaintext'] as const)('requires exact per-version envelope %s', async mutation => {
  const f = fixture()
  if (mutation === 'missing') { f.rows.delete(f.envelopeFieldId) }
  else {
    const row = f.rows.get(f.envelopeFieldId), codec = bcs.struct('Field', { id: bcs.Address, name: bcs.string(), value: bcs.vector(bcs.u8()) })
    const value = codec.parse(row.contents.value)
    if (mutation === 'bad UTF8') value.value = [255]
    else { const data = JSON.parse(new TextDecoder().decode(new Uint8Array(value.value)))
      if (mutation === 'wrong blob') data.blobObjectId = `0x${'99'.repeat(32)}`
      else data.sidecar.rawDek = 'DO NOT ACCEPT'
      value.value = [...new TextEncoder().encode(JSON.stringify(data))] }
    row.contents.value = codec.serialize(value).toBytes()
  }
  await expect(f.read()).rejects.toThrow()
})
it.each(['not certified', 'expired', 'future certificate', 'zero storage', 'wrong encoding', 'too small', 'too large', 'wrong owner', 'missing wrapper', 'bad wrapper UID', 'tail'] as const)('rejects invalid Walrus %s proof', async mutation => {
  const f = fixture()
  if (mutation === 'not certified') f.blob.certified_epoch = null
  if (mutation === 'expired') f.blob.storage.end_epoch = 3
  if (mutation === 'future certificate') f.blob.certified_epoch = 4
  if (mutation === 'zero storage') f.blob.storage.storage_size = '0'
  if (mutation === 'wrong encoding') f.blob.encoding_type = 0
  if (mutation === 'too small') f.blob.size = '15'
  if (mutation === 'too large') f.blob.size = String(BROWSER_CONTENT_MAX_BYTES + 1)
  f.putBlob()
  if (mutation === 'wrong owner') f.rows.get(f.blob.id).owner.address = f.content.id
  if (mutation === 'missing wrapper') f.rows.delete(f.blobFieldId)
  if (mutation === 'bad wrapper UID') f.rows.get(f.blobFieldId).contents.value[0] ^= 1
  if (mutation === 'tail') f.rows.get(f.blob.id).contents.value = new Uint8Array([...f.rows.get(f.blob.id).contents.value, 0])
  await expect(f.read()).rejects.toThrow()
})
it('Clock may tick across download/Seal, but expiry equality fails on a fresh recheck', async () => {
  const f = fixture(); f.slots[0].read_mode_mask = '3'; f.putSlots()
  const result = await f.read({ viewerAddress: f.grant.grantee })
  f.putClock('1500'); await result.recheck()
  f.putClock('2000'); await expect(result.recheck()).rejects.toThrow('ACCESS_DENIED')
})
it('Walrus epoch advances without freezing its system BCS, but expired storage fails on recheck', async () => {
  const f = fixture(), result = await f.read()
  f.system.mockResolvedValue({ committee: { epoch: 4 }, mutableUnrelatedField: 7 } as any); await result.recheck()
  f.system.mockResolvedValue({ committee: { epoch: 10 } } as any); await expect(result.recheck()).rejects.toThrow('STORAGE_EXPIRED')
})
it.each(['transfer', 'config bytes', 'blob bytes', 'package', 'deletion'])('recheck rejects changed %s evidence after download', async mutation => {
  const f = fixture(), result = await f.read()
  if (mutation === 'transfer') { f.state.current_owner = `0x${'99'.repeat(32)}`; f.putState() }
  if (mutation === 'config bytes') f.rows.get(f.configId).contents.value[50] ^= 1
  if (mutation === 'blob bytes') { f.blob.deletable = false; f.putBlob() }
  if (mutation === 'package') f.rows.get(f.target.soulidityCallablePackageId).package.modules[0].contents[0] ^= 1
  if (mutation === 'deletion') { f.slots[0].deleted = true; f.putSlots() }
  await expect(result.recheck()).rejects.toThrow()
})
it('captures public config and request before awaits and returns frozen access data', async () => {
  const f = fixture(), pending = f.read()
  f.params.name = 'different'; f.config.storage.aggregatorUrl = 'https://different.example'
  const result = await pending
  expect(result.access.name).toBe('main'); expect(result.access.artifact.walrusBlobUrl).toContain('https://walrus.example.com/')
  expect(Object.isFrozen(result.access.accessPolicy)).toBe(true)
})
it('wrong chain/package pin fails before an access object is published', async () => {
  const f = fixture(); f.chain.mockResolvedValue({ chainIdentifier: toBase58(new Uint8Array(32).fill(1)) })
  await expect(f.read()).rejects.toThrow()
})
it('pre-abort and later cancellation do not fetch/sign or publish stale access', async () => {
  const f = fixture(), abort = new AbortController(); abort.abort(new Error('cancelled'))
  await expect(f.read({ signal: abort.signal })).rejects.toThrow('cancelled'); expect(f.get).not.toHaveBeenCalled()
  const live = new AbortController(), result = await f.read({ signal: live.signal }); live.abort(new Error('wallet changed'))
  await expect(result.recheck()).rejects.toThrow('wallet changed'); expect(f.execute).not.toHaveBeenCalled()
})
it('raw reader works without Buffer and never reads server env as fallback', async () => {
  const f = fixture(); vi.stubGlobal('Buffer', undefined)
  expect((await f.read()).access.visibility).toBe('sealed')
  vi.stubEnv('NEXT_PUBLIC_SOULIDITY_KIND_REGISTRY_ID', undefined)
  vi.stubEnv('SOULIDITY_KIND_REGISTRY_ID', f.registry.id)
  expect(() => getBrowserContentAccessConfig()).toThrow()
})
it('bounds an uncooperative chain read and invalidates the proof session', async () => {
  const f = fixture(); vi.useFakeTimers()
  const aborts: AbortController[] = []
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const c = new AbortController(); aborts.push(c); setTimeout(() => c.abort(new Error('read deadline')), ms); return c.signal })
  f.chain.mockImplementation(() => new Promise(() => {}))
  const pending = expect(f.read()).rejects.toThrow('read deadline'); await vi.advanceTimersByTimeAsync(45001); await pending
  expect(aborts.some(c => c.signal.aborted)).toBe(true)
})
