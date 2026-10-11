import { afterEach, expect, it, vi } from 'vitest'
import { soulAuthoringHistoryFixture } from './fixtures/soul-authoring-history'
import { proveSoulAuthoringBusinessHistory } from '../../web/lib/soulidity/soul-authoring-history'
import { contentAppendFixtureId as id } from './fixtures/content-append-preparation'

afterEach(() => vi.restoreAllMocks())
it('does not attempt to clone the live AbortSignal in browser history recovery', async () => {
  const f = await soulAuthoringHistoryFixture({ register: 'none' }), clone = globalThis.structuredClone
  vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
    if (value?.signal instanceof AbortSignal) throw new DOMException('AbortSignal object could not be cloned.', 'DataCloneError')
    return clone(value)
  })
  expect((await f.prove()).stage).toBe('REGISTER')
})
it('requires the same re-proved registration Collection when consuming a later mint chunk', async () => {
  const f = await soulAuthoringHistoryFixture({ createdCollection: true, list: true })
  expect((await f.prove()).mints[0].soulId).toBe(f.ids.soul)
  const input = f.build(); input.registrationReceipt!.collection!.collectionId = id(999)
  await expect(proveSoulAuthoringBusinessHistory(input)).rejects.toThrow('CREATED_COLLECTION_HISTORY_REQUIRED')
  input.registrationReceipt = null
  await expect(proveSoulAuthoringBusinessHistory(input)).rejects.toThrow('CREATED_COLLECTION_HISTORY_REQUIRED')
})
it.each(['hash', 'author', 'extra'] as const)('rejects %s in register-only manifest commitment', async mode => {
  const f = await soulAuthoringHistoryFixture({ register: 'none' }), e = f.events[0]
  if (mode === 'hash') e.value.manifest_hash[0] ^= 1
  if (mode === 'author') e.value.author = id(999)
  if (mode === 'extra') f.events.push(structuredClone(e))
  await expect(f.prove()).rejects.toThrow(/MANIFEST_EVENT_HASH|BUSINESS_EVENT_VALUE|EXTRA_BUSINESS_EVENTS/)
  expect(f.getObject).not.toHaveBeenCalled()
})
it.each(['gas', 'coin', 'staked'] as const)('preserves legal joined %s source with compact MoveObjectType', async sourceType => {
  const f = await soulAuthoringHistoryFixture({ kind: 'JOINED', sourceType })
  expect((await f.prove()).mints[0].soulId).toBe(f.ids.soul)
})
it.each(['gas', 'coin', 'staked'] as const)('rejects changed joined %s source contents', async sourceType => {
  const f = await soulAuthoringHistoryFixture({ kind: 'JOINED', sourceType })
  f.specs.get('source')!.value[sourceType === 'staked' ? 'principal' : 'balance'] = '124'
  await expect(f.prove()).rejects.toThrow('JOINED_SOURCE_INPUT')
})
it.each([
  { register: 'none' as const }, { register: 'none' as const, newKiosk: true },
  { register: 'collection' as const }, { register: 'collection' as const, list: true },
  { register: 'collection' as const, list: true, newKiosk: true },
])('proves registration manifest and optional Collection outputs %j', async options => {
  const f = await soulAuthoringHistoryFixture(options), receipt = await f.prove()
  expect(receipt.stage).toBe('REGISTER'); expect(receipt.mints).toEqual([])
  expect(receipt.collection?.collectionId ?? null).toBe(options.register === 'collection' ? f.ids.collection : null)
  if (options.register === 'none') { expect(receipt.kiosk).toBeNull(); expect(f.getObject).not.toHaveBeenCalled() }
})
it.each(['right', 'floor', 'listing', 'collection'] as const)('rejects wrong created Collection %s', async label => {
  const f = await soulAuthoringHistoryFixture({ register: 'collection', list: true }), value = f.specs.get(label)!.value
  if (label === 'right') value.description = 'wrong'
  if (label === 'floor') value.value = '43'
  if (label === 'listing') value.version = '2'
  if (label === 'collection') value.current_supply = '1'
  await expect(f.prove()).rejects.toThrow(/CREATED_/)
})
it.each([
  {}, { kind: 'IMPORTED' as const }, { kind: 'JOINED' as const }, { list: true }, { bind: true, list: true },
  { newKiosk: true }, { kind: 'JOINED' as const, newKiosk: true, bind: true, list: true },
])('proves complete controlled business outputs/events %j', async options => {
  const f = await soulAuthoringHistoryFixture(options), receipt = await f.prove()
  expect(receipt.mints).toEqual([{ mintIndex: 0, soulId: f.ids.soul, stateId: f.ids.state, contentId: f.ids.content,
    accessListId: f.ids.paid, listingId: options.list ? f.ids.listing : null }])
  expect(receipt.kiosk).toEqual({ kioskId: f.ids.kiosk, capId: f.ids.cap })
})
it.each([
  ['soul', 'name', 'wrong', 'MINT_SOUL_METADATA'], ['state', 'current_owner', id(999), 'MINT_STATE'],
  ['state', 'ownership_epoch', '1', 'MINT_STATE'], ['paid', 'creator', id(999), 'MINT_PAID_ACCESS'],
  ['listing', 'version', '1', 'CREATED_LISTING'], ['listing', 'price', '124', 'CREATED_LISTING'],
  ['collection', 'current_supply', '6', 'BOUND_COLLECTION'], ['source', 'label', 'replaced source', 'JOINED_SOURCE_INPUT'],
  ['kiosk', 'item_count', 9, 'KIOSK_CHANGE'], ['kiosk', 'profits', '1', 'KIOSK_CHANGE'],
] as const)('rejects rehashed %s.%s mismatch', async (label, field, value, error) => {
  const f = await soulAuthoringHistoryFixture({ kind: 'JOINED', list: true, bind: true })
  f.specs.get(label)!.value[field] = value; await expect(f.prove()).rejects.toThrow(error)
})
it.each(['soul-item', 'soul-lock', 'listing-marker', 'joined-marker', 'pointer'] as const)('requires exact %s custody/link output', async label => {
  const f = await soulAuthoringHistoryFixture({ kind: 'JOINED', list: true })
  f.specs.get(label)!.owner = { ObjectOwner: id(999) }; await expect(f.prove()).rejects.toThrow('HISTORY_FIELD_IDENTITY')
})
it.each(['source-header', 'reorder', 'missing-envelope', 'extra', 'paid-soul', 'listing-price'] as const)('rejects %s in complete business event stream', async mode => {
  const f = await soulAuthoringHistoryFixture({ list: true })
  if (mode === 'source-header') f.events.find(e => e.name === 'SoulCreated')!.header = 'soul'
  if (mode === 'reorder') [f.events[0], f.events[1]] = [f.events[1], f.events[0]]
  if (mode === 'missing-envelope') f.events.splice(f.events.findIndex(e => e.name === 'SoulStateConfigUpserted' && e.value.key.startsWith('content_')), 1)
  if (mode === 'extra') f.events.push(structuredClone(f.events.at(-1)!))
  if (mode === 'paid-soul') f.events.find(e => e.name === 'SoulPaidAccessListCreated')!.value.soul_id = id(999)
  if (mode === 'listing-price') f.events.find(e => e.name === 'SoulListed')!.value.price = '999'
  await expect(f.prove()).rejects.toThrow(/EVENT/)
})
it('rejects parent-context substitution before historical object reads', async () => {
  const f = await soulAuthoringHistoryFixture(), input = f.build()
  input.context.indices = [1]
  await expect(proveSoulAuthoringBusinessHistory(input)).rejects.toThrow('BUSINESS_CONTEXT_MISMATCH')
  expect(f.getObject).not.toHaveBeenCalled()
})
