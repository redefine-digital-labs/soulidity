import { expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag, toBase58 } from '@mysten/sui/utils'
import { createBrowserSoulListingDiscovery, readBrowserSoulCustody } from '../../web/lib/soulidity/browser-soul-custody'
import { SoulPublicBcs, SoulStatePublicBcs, SoulStatePointerFieldV1Bcs, SoulStatePointerKeyV1Bcs } from '../../packages/soulidity-sdk/src/soul-public-read'
import { SoulPublicKioskBcs, SoulPublicListingBcs } from '../../packages/soulidity-sdk/src/soul-public-listing'
import { deriveKioskItemFieldId, KioskItemFieldBcs, KIOSK_ITEM_FIELD_TYPE } from '../../packages/soulidity-sdk/src/kiosk-item-custody'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const digest = toBase58(new Uint8Array(32).fill(1)), A = bcs.Address, U = bcs.u64()
const Registry = bcs.struct('KioskRegistry', { id: A, version: U })
const OwnerKey = bcs.struct('PersonalKioskOwnerKey', { owner: A })
const RegField = bcs.struct('Field', { id: A, name: OwnerKey, value: bcs.struct('PersonalKioskRegistration', {
  version: U, kiosk_id: A, kiosk_cap_id: A }) })
// Current pinned personal_kiosk.move wraps an Option, not a bare KioskOwnerCap.
const Cap = bcs.struct('PersonalKioskCap', { id: A, cap: bcs.option(bcs.struct('KioskOwnerCap', { id: A, for: A })) })
function fixture(listed = true, owner = true) {
  const deployment = { originalPackageId: id(1), chainIdentifier: '01010101', kioskRegistryId: id(12), personalKioskTypePackageId: id(13) }
  const pkg = deployment.originalPackageId
  const snapshot = { soulId: id(2), stateId: id(3), currentOwner: id(4), kioskId: id(5), stateVersion: '1', stateDigest: digest, listedIndividually: listed }
  const state = { id: snapshot.stateId, version: '1', soul_id: snapshot.soulId, creator: id(6), creator_royalty_bps: 500,
    current_owner: snapshot.currentOwner, current_kiosk_id: snapshot.kioskId, ownership_epoch: '2', grant_capacity: '3',
    active_grants: { id: id(7), size: '0' }, active_grant_ids: { id: id(8), size: '0' }, active_grant_count: '0',
    content_id: id(9), config_ext: { id: id(10), size: '0' }, collection_id: null, access_list_id: id(11), is_listed: listed }
  const soul = { id: snapshot.soulId, version: '1', name: 'Example', description: 'Description', image_url: '',
    provenance_kind: 0, origin_ref: null, creator: state.creator }
  const kiosk = { id: snapshot.kioskId, profits: '0', owner: snapshot.currentOwner, item_count: 1, allow_extensions: false }
  const listing = { id: id(14), version: '2', soul_id: snapshot.soulId, state_id: snapshot.stateId,
    seller: snapshot.currentOwner, seller_kiosk_id: snapshot.kioskId, price: '1000000', creator: state.creator,
    creator_royalty_bps: 500, collection_id: null, purchase_cap: { id: id(15), kiosk_id: snapshot.kioskId, item_id: snapshot.soulId, min_price: '0' }, is_active: true }
  const regKeyType = `${pkg}::market::PersonalKioskOwnerKey`
  const regId = deriveDynamicFieldID(deployment.kioskRegistryId, regKeyType, OwnerKey.serialize({ owner: snapshot.currentOwner }).toBytes())
  const registration = { id: regId, name: { owner: snapshot.currentOwner }, value: { version: '1', kiosk_id: snapshot.kioskId, kiosk_cap_id: id(16) } }
  const cap = { id: id(16), cap: { id: id(17), for: snapshot.kioskId } as { id: string; for: string } | null }
  const stateKeyType = `${pkg}::soul::SoulStatePointerKeyV1`
  const pointerId = deriveDynamicFieldID(snapshot.soulId, stateKeyType, SoulStatePointerKeyV1Bcs.serialize({ version: 1 }).toBytes())
  const pointer = { id: pointerId, name: { version: 1 }, value: state.id }
  const rows = new Map<string, any>()
  function put(objectId: string, type: string, bytes: Uint8Array, custody: any = { kind: 3, version: 1n }) {
    rows.set(objectId, { objectId, objectType: normalizeStructTag(type), version: 1n, digest, owner: structuredClone(custody), contents: { value: bytes } })
  }
  const putState = () => put(state.id, `${pkg}::soul::SoulState`, SoulStatePublicBcs.serialize(state).toBytes())
  const putSoul = () => {
    const fieldId = deriveKioskItemFieldId(kiosk.id, soul.id)
    put(fieldId, KIOSK_ITEM_FIELD_TYPE, KioskItemFieldBcs.serialize({ id: fieldId, name: { name: { id: soul.id } }, value: soul.id }).toBytes(),
      { kind: 2, address: kiosk.id })
    put(soul.id, `${pkg}::soul::Soul`, SoulPublicBcs.serialize(soul).toBytes(), { kind: 2, address: fieldId })
  }
  const putPointer = () => put(pointerId, `0x2::dynamic_field::Field<${stateKeyType},0x2::object::ID>`, SoulStatePointerFieldV1Bcs.serialize(pointer).toBytes(), { kind: 2, address: soul.id })
  const putKiosk = () => put(kiosk.id, '0x2::kiosk::Kiosk', SoulPublicKioskBcs.serialize(kiosk).toBytes())
  const putListing = (value = listing) => put(value.id, `${pkg}::market::SoulListing`, SoulPublicListingBcs.serialize(value).toBytes())
  const putReg = () => put(regId, `0x2::dynamic_field::Field<${regKeyType},${pkg}::market::PersonalKioskRegistration>`, RegField.serialize(registration).toBytes(), { kind: 2, address: deployment.kioskRegistryId })
  const putCap = () => put(cap.id, `${deployment.personalKioskTypePackageId}::personal_kiosk::PersonalKioskCap`, Cap.serialize(cap).toBytes(), { kind: 1, address: snapshot.currentOwner })
  putState(); putSoul(); putPointer(); putKiosk(); putListing(); putReg(); putCap()
  put(deployment.kioskRegistryId, `${pkg}::market::KioskRegistry`, Registry.serialize({ id: deployment.kioskRegistryId, version: '1' }).toBytes())
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://grpc.example.com' })
  const chain = vi.spyOn(client.core, 'getChainIdentifier').mockResolvedValue({ chainIdentifier: digest })
  const batch = vi.spyOn(client.ledgerService, 'batchGetObjects').mockImplementation(((args: any) => Promise.resolve({ response: {
    objects: args.requests.map((r: any) => ({ result: rows.has(r.objectId) ? { oneofKind: 'object', object: structuredClone(rows.get(r.objectId)) }
      : { oneofKind: 'error', error: { code: 5 } } })) } })) as any)
  const pages: string[][] = [[listing.id]]
  const fetcher = vi.fn(async (_url: unknown, options: any) => {
    const request = JSON.parse(options.body), page = request.variables.after === null ? 0 : Number(request.variables.after.slice(1))
    const ids = pages[page] ?? []
    return new Response(JSON.stringify({ data: { chainIdentifier: digest, checkpoint: { sequenceNumber: 100,
      query: { objects: { nodes: ids.map(address => ({ address })), pageInfo: {
        hasNextPage: page + 1 < pages.length, endCursor: ids.length ? `c${page + 1}` : null } } } } } }))
  })
  const input = { client, deployment, snapshot, viewer: owner ? snapshot.currentOwner : id(99),
    discovery: { endpoint: 'https://graphql.example.com/', pageSize: 50, maxPages: 5, maxObjects: 100 } }
  const read = (overrides: Partial<Parameters<typeof readBrowserSoulCustody>[0]> = {}) => readBrowserSoulCustody({ ...input, ...overrides }, { fetch: fetcher as typeof fetch })
  return { input, state, soul, kiosk, listing, registration, cap, pointer, pointerId, regId, rows, pages, batch, chain, fetcher,
    put, putState, putSoul, putPointer, putKiosk, putListing, putReg, putCap, read }
}
function listingScanner(f: ReturnType<typeof fixture>, lifetime = new AbortController()) {
  return { lifetime, scanner: createBrowserSoulListingDiscovery({ client: f.input.client, deployment: f.input.deployment,
    discovery: { ...f.input.discovery, timeoutMs: 25000 }, signal: lifetime.signal }, { fetch: f.fetcher as typeof fetch }) }
}
it('one opaque complete Listing scan raw-verifies every candidate twice and detail rereads only its matching Listing', async () => {
  const f = fixture(), foreign = { ...f.listing, id: id(40), soul_id: id(41), state_id: id(42),
    purchase_cap: { ...f.listing.purchase_cap, item_id: id(41) } }
  f.putListing(foreign); f.pages.splice(0, 1, [id(44), foreign.id], [f.listing.id])
  const { scanner } = listingScanner(f), partial = await scanner.next(), complete = await scanner.next()
  expect(partial).toMatchObject({ candidateStatus: 'PARTIAL', verifiedListingCandidates: 2, scan: null })
  expect(complete).toMatchObject({ candidateStatus: 'COMPLETE', verifiedListingCandidates: 3 })
  expect(complete.scan?.candidateIds).toEqual([id(44), foreign.id, f.listing.id]); expect(complete.scan?.observations).toHaveLength(2)
  expect(Object.isFrozen(complete.scan?.observations[0].listing)).toBe(true)
  expect((await f.read({ listingScan: complete.scan!, discovery: undefined })).listingId).toBe(f.listing.id)
  expect(f.fetcher).toHaveBeenCalledTimes(2)
  for (const [objectId, times] of [[foreign.id, 2], [id(44), 2], [f.listing.id, 4]] as const)
    expect(f.batch.mock.calls.filter(([args]) => args.requests?.[0]?.objectId === objectId)).toHaveLength(times)
})
it.each(['clone', 'forged', 'client', 'package', 'chain', 'expired'] as const)('rejects %s opaque Listing scan reuse', async mode => {
  const f = fixture(), { scanner, lifetime } = listingScanner(f), page = await scanner.next()
  let scan = page.scan!; const overrides: Partial<Parameters<typeof readBrowserSoulCustody>[0]> = {}
  if (mode === 'clone') scan = structuredClone(scan)
  if (mode === 'forged') scan = { ...scan, candidateIds: [f.listing.id] }
  if (mode === 'client') overrides.client = fixture().input.client
  if (mode === 'package' || mode === 'chain') overrides.deployment = { ...f.input.deployment,
    ...(mode === 'package' ? { originalPackageId: id(80) } : { chainIdentifier: '02020202' }) }
  if (mode === 'expired') lifetime.abort()
  f.batch.mockClear()
  await expect(f.read({ ...overrides, listingScan: scan })).rejects.toThrow(/VERIFIED_LISTING_SCAN_REQUIRED|LISTING_SCAN_SCOPE/)
  expect(f.batch).not.toHaveBeenCalled()
})
it('Listing raw failure retries the same pending terminal discovery page without skipping its cursor', async () => {
  const f = fixture(), { scanner } = listingScanner(f), saved = f.rows.get(f.listing.id).contents.value
  f.rows.get(f.listing.id).contents.value = new Uint8Array([...saved, 0])
  await expect(scanner.next()).rejects.toThrow('NONCANONICAL_BCS')
  f.rows.get(f.listing.id).contents.value = saved
  expect(await scanner.next()).toMatchObject({ candidateStatus: 'COMPLETE', verifiedListingCandidates: 1 })
  expect(f.fetcher).toHaveBeenCalledTimes(1); await expect(scanner.next()).rejects.toThrow('LISTING_SCAN_ENDED')
})
it('LIMIT_REACHED never mints a complete token even with a verified matching Listing', async () => {
  const f = fixture(); f.pages.push([id(50)]); f.input.discovery.maxPages = 1
  expect(await listingScanner(f).scanner.next()).toMatchObject({ candidateStatus: 'LIMIT_REACHED', verifiedListingCandidates: 1, scan: null })
})
it('two active matching Listings remain ambiguous with the shared scan', async () => {
  const f = fixture(); f.putListing({ ...f.listing, id: id(50) }); f.pages.push([id(50)])
  const { scanner } = listingScanner(f); await scanner.next(); const page = await scanner.next()
  await expect(f.read({ listingScan: page.scan! })).rejects.toThrow('LISTING_AMBIGUOUS')
})
it('completed scan without a current match reports restart rather than an empty result', async () => {
  const f = fixture(); f.pages[0] = []
  const page = await listingScanner(f).scanner.next()
  await expect(f.read({ listingScan: page.scan! })).rejects.toThrow('LISTING_SCAN_CHANGED_RESTART')
})
it('Listing changing between the two scan reads rejects the entire page then permits a stable retry', async () => {
  const f = fixture(), original = f.batch.getMockImplementation()!; let reads = 0
  f.batch.mockImplementation(((args: any, opts: any) => {
    if (args.requests[0].objectId === f.listing.id && ++reads === 2) { f.listing.price = '2000000'; f.putListing() }
    return original(args, opts)
  }) as any)
  const { scanner } = listingScanner(f); await expect(scanner.next()).rejects.toThrow('CHANGED_RETRY')
  const result = await scanner.next(); expect(result.scan?.observations[0].listing.price).toBe('2000000')
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
it('issuer cancellation during detail read invalidates the shared token and bounds uncooperative raw work', async () => {
  const f = fixture(), { scanner, lifetime } = listingScanner(f), page = await scanner.next()
  f.batch.mockClear(); f.batch.mockImplementationOnce(() => new Promise(() => {}) as any)
  const read = f.read({ listingScan: page.scan! }); await vi.waitFor(() => expect(f.batch).toHaveBeenCalledTimes(1))
  lifetime.abort(new Error('issuer replaced')); await expect(read).rejects.toThrow('issuer replaced')
})
it('actual gRPC client + checkpoint GraphQL discover one listing and exact registered owned Option cap', async () => {
  const f = fixture(), result = await f.read()
  expect(result).toEqual({ listingId: f.listing.id, personalKioskCapId: f.cap.id, stateVersion: '1', stateDigest: digest })
  expect(Object.isFrozen(result)).toBe(true)
  const request = JSON.parse(f.fetcher.mock.calls[0][1].body)
  expect(request.variables.filter).toEqual({ type: `${f.input.deployment.originalPackageId}::market::SoulListing`, ownerKind: 'SHARED' })
  expect(f.fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' })
  for (const objectId of f.rows.keys()) expect(f.batch.mock.calls.filter(([args]) => args.requests?.[0]?.objectId === objectId)).toHaveLength(2)
})
it.each(['missing', 'direct-kiosk', 'wrong-parent', 'changed'] as const)('rejects invalid item field custody: %s', async problem => {
  const f = fixture(), fieldId = deriveKioskItemFieldId(f.kiosk.id, f.soul.id)
  if (problem === 'missing') f.rows.delete(fieldId)
  if (problem === 'direct-kiosk') f.rows.get(f.soul.id).owner.address = f.kiosk.id
  if (problem === 'wrong-parent') f.rows.get(fieldId).owner.address = id(99)
  if (problem === 'changed') {
    const original = f.batch.getMockImplementation()!; let reads = 0
    f.batch.mockImplementation(((args: any, opts: any) => {
      if (args.requests[0].objectId === fieldId && ++reads === 2) f.rows.get(fieldId).version = 2n
      return original(args, opts)
    }) as any)
  }
  await expect(f.read()).rejects.toThrow()
})
it('visitor never resolves registry/cap and HELD never requires or calls discovery', async () => {
  const f = fixture(false, false)
  const result = await f.read({ discovery: undefined, viewer: null })
  expect(result.listingId).toBeNull(); expect(result.personalKioskCapId).toBeNull(); expect(f.fetcher).not.toHaveBeenCalled()
  expect(f.batch.mock.calls.some(([args]) => [f.regId, f.cap.id, f.input.deployment.kioskRegistryId].includes(args.requests?.[0]?.objectId ?? ''))).toBe(false)
})
it('owner of held Soul receives the actual registered cap without discovery', async () => {
  const f = fixture(false); expect((await f.read({ discovery: undefined })).personalKioskCapId).toBe(f.cap.id)
  expect(f.fetcher).not.toHaveBeenCalled()
})
it('destroyed, inactive and other-Soul candidates are skipped only after complete discovery and valid raw data', async () => {
  const f = fixture(), foreign = { ...f.listing, id: id(40), soul_id: id(41), state_id: id(42),
    purchase_cap: { ...f.listing.purchase_cap, item_id: id(41) } }
  f.putListing(foreign); f.putListing({ ...f.listing, id: id(43), is_active: false })
  f.pages.splice(0, 1, [id(44), foreign.id, id(43)], [f.listing.id])
  expect((await f.read()).listingId).toBe(f.listing.id); expect(f.fetcher).toHaveBeenCalledTimes(2)
  expect(JSON.parse(f.fetcher.mock.calls[1][1].body).variables).toMatchObject({ checkpoint: 100, after: 'c1' })
})
it.each(['empty', 'only-stale'])('completed %s discovery cannot relabel a listed State as held', async mode => {
  const f = fixture(); f.pages[0] = mode === 'empty' ? [] : [id(40)]
  await expect(f.read()).rejects.toThrow('LISTING_NOT_FOUND')
})
it('matching first page does not hide a later duplicate active listing', async () => {
  const f = fixture(); f.putListing({ ...f.listing, id: id(40) }); f.pages.push([id(40)])
  await expect(f.read()).rejects.toThrow('LISTING_AMBIGUOUS')
})
it('partial scan cannot succeed even after finding the exact active listing', async () => {
  const f = fixture(); f.pages.push([id(40)]); f.input.discovery.maxPages = 1
  await expect(f.read()).rejects.toThrow('DISCOVERY_INCOMPLETE')
})
it.each(['graphql', 'http', 'transport'])('later discovery %s error cannot return an earlier match', async kind => {
  const f = fixture(); f.pages.push([id(40)]); const original = f.fetcher.getMockImplementation()!; let calls = 0
  f.fetcher.mockImplementation(async (...args) => {
    if (++calls === 1) return original(...args)
    if (kind === 'transport') throw new Error('offline')
    return kind === 'http' ? new Response('', { status: 503 }) : new Response(JSON.stringify({ errors: [{ message: 'expired cursor' }] }))
  })
  await expect(f.read()).rejects.toThrow()
})
it.each(['http://graphql.example.com/', 'https://user:secret@graphql.example.com/', 'https://graphql.example.com/?key=secret'])('rejects non-public credential-free endpoint %s', async endpoint => {
  const f = fixture(); f.input.discovery.endpoint = endpoint; await expect(f.read()).rejects.toThrow(); expect(f.fetcher).not.toHaveBeenCalled()
})
it.each(['state', 'soul', 'owner', 'kiosk', 'version', 'royalty', 'cap'])('same-Soul candidate %s mismatch is not silently skipped', async key => {
  const f = fixture()
  if (key === 'state') f.listing.state_id = id(40)
  if (key === 'soul') f.listing.soul_id = id(40)
  if (key === 'owner') f.listing.seller = id(40)
  if (key === 'kiosk') f.listing.seller_kiosk_id = id(40)
  if (key === 'version') f.listing.version = '8'
  if (key === 'royalty') f.listing.creator_royalty_bps = 550
  if (key === 'cap') f.listing.purchase_cap.item_id = id(40)
  f.putListing(); await expect(f.read()).rejects.toThrow(/LISTING_MISMATCH|PURCHASE_CAP_MISMATCH/)
})
it('Native matching listing requires actual Native version', async () => {
  const f = fixture(); f.soul.provenance_kind = 3; f.putSoul(); f.listing.version = '8'; f.putListing()
  expect((await f.read()).listingId).toBe(f.listing.id)
})
it.each(['type', 'owner', 'suffix', 'identity', 'digest', 'shared-birth'])('raw candidate %s corruption is an error, not a stale candidate', async key => {
  const f = fixture(), row = f.rows.get(f.listing.id)
  if (key === 'type') row.objectType = `${id(40)}::market::SoulListing`
  if (key === 'owner') row.owner = { kind: 1, address: id(40) }
  if (key === 'suffix') row.contents.value = new Uint8Array([...row.contents.value, 0])
  if (key === 'identity') row.objectId = id(40)
  if (key === 'digest') row.digest = 'invalid'
  if (key === 'shared-birth') row.owner.version = 2n
  await expect(f.read()).rejects.toThrow()
})
it.each([7, 13, 14])('candidate gRPC error %s cannot be called absent', async code => {
  const f = fixture(), original = f.batch.getMockImplementation()!
  f.batch.mockImplementation(((args: any) => args.requests[0].objectId === f.listing.id
    ? Promise.resolve({ response: { objects: [{ result: { oneofKind: 'error', error: { code } } }] } }) : original(args)) as any)
  await expect(f.read()).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it.each(['field-owner', 'field-key', 'field-version', 'registered-kiosk', 'cap-type', 'cap-owner', 'cap-id', 'cap-none', 'cap-kiosk'])('registered personal cap %s must be exact', async key => {
  const f = fixture(false)
  if (key === 'field-owner') f.rows.get(f.regId).owner.address = id(40)
  if (key === 'field-key') { f.registration.name.owner = id(40); f.putReg() }
  if (key === 'field-version') { f.registration.value.version = '2'; f.putReg() }
  if (key === 'registered-kiosk') { f.registration.value.kiosk_id = id(40); f.putReg() }
  if (key === 'cap-type') f.rows.get(f.cap.id).objectType = `${id(40)}::personal_kiosk::PersonalKioskCap`
  if (key === 'cap-owner') f.rows.get(f.cap.id).owner.address = id(40)
  if (key === 'cap-id') f.rows.get(f.cap.id).contents.value = Cap.serialize({ ...f.cap, id: id(40) }).toBytes()
  if (key === 'cap-none') { f.cap.cap = null; f.putCap() }
  if (key === 'cap-kiosk') { f.cap.cap!.for = id(40); f.putCap() }
  await expect(f.read()).rejects.toThrow()
})
it('missing registered cap returns null rather than a fake registered ID; missing registration fails', async () => {
  const f = fixture(false); f.rows.delete(f.cap.id)
  expect((await f.read()).personalKioskCapId).toBeNull()
  f.rows.delete(f.regId); await expect(f.read()).rejects.toThrow('OBJECT_UNAVAILABLE')
})
it.each(['state', 'soul', 'kiosk', 'pointer', 'registry', 'registration', 'cap', 'listing', 'absent-candidate'])('stable read rejects %s change before returning IDs', async key => {
  const f = fixture(), original = f.batch.getMockImplementation()!
  const targets = { state: f.state.id, soul: f.soul.id, kiosk: f.kiosk.id, pointer: f.pointerId,
    registry: f.input.deployment.kioskRegistryId, registration: f.regId, cap: f.cap.id, listing: f.listing.id, 'absent-candidate': id(40) }
  const target = targets[key as keyof typeof targets]; if (key === 'absent-candidate') f.pages[0].push(id(40))
  let count = 0
  f.batch.mockImplementation(((args: any) => {
    if (args.requests[0].objectId === target && ++count === 2) {
      if (key === 'absent-candidate') f.putListing({ ...f.listing, id: id(40), is_active: false })
      else f.rows.get(target).digest = toBase58(new Uint8Array(32).fill(2))
    }
    return original(args)
  }) as any)
  await expect(f.read()).rejects.toThrow('CHANGED_RETRY')
})
it.each(['version', 'digest'])('exact composer State %s cannot silently become newer', async key => {
  const f = fixture(); if (key === 'version') f.input.snapshot.stateVersion = '2'; else f.input.snapshot.stateDigest = toBase58(new Uint8Array(32).fill(2))
  await expect(f.read()).rejects.toThrow('STALE_METADATA'); expect(f.fetcher).not.toHaveBeenCalled()
})
it('forged Soul-to-State pointer fails independently of passed snapshot', async () => {
  const f = fixture(); f.pointer.value = id(40); f.putPointer(); await expect(f.read()).rejects.toThrow('STATE_POINTER_MISMATCH')
})
it('input mutations during first async read cannot redirect owner or release', async () => {
  const f = fixture(); const promise = f.read(); f.input.viewer = id(40); f.input.deployment.kioskRegistryId = id(41)
  f.input.snapshot.currentOwner = id(42); expect((await promise).personalKioskCapId).toBe(f.cap.id)
})
it('cancellation bounds an uncooperative gRPC request and never advances late', async () => {
  const f = fixture(); let resolve!: (value: any) => void
  f.batch.mockImplementationOnce(() => new Promise(r => { resolve = r }) as any)
  const controller = new AbortController(), promise = f.read({ signal: controller.signal })
  await vi.waitFor(() => expect(f.batch).toHaveBeenCalledTimes(1)); controller.abort(new Error('cancelled'))
  await expect(promise).rejects.toThrow('cancelled'); resolve({ response: { objects: [] } })
  await Promise.resolve(); expect(f.batch).toHaveBeenCalledTimes(1); expect(f.fetcher).not.toHaveBeenCalled()
})
