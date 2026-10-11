import { beforeEach, expect, it } from 'vitest'
import { captureNamedLoadout } from '../../web/lib/animacraft/named-loadout'
import { decodePrivateLoadoutLibrary, emptyPrivateLoadoutLibrary, encodePrivateLoadoutLibrary,
  preparePrivateLoadoutMutation, validatePrivateLoadoutLibrary, type PrivateLoadoutIntent,
  type PrivateLoadoutLibrary } from '../../web/lib/animacraft/private-loadout-library'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'

const hash = (n: number) => n.toString(16).padStart(64, '0')
const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`
let empty: PrivateLoadoutLibrary, save: Extract<PrivateLoadoutIntent, { action: 'save' }>
beforeEach(async () => {
  const snapshot = await nativeEquipmentSourceFixture().readBase(), content = captureNamedLoadout(snapshot)
  const scope = { soulId: content.soulId, stateId: content.stateId, owner: content.capturedOwner, ownershipEpoch: content.capturedOwnershipEpoch }
  empty = emptyPrivateLoadoutLibrary(scope)
  save = { action: 'save', scope, requestId: hash(1), expectedRevision: '0', at: '2026-09-11T12:00:00.000Z', loadoutId: uuid(1), name: 'Private outfit',
    content, capture: { equipmentId: content.capturedEquipmentId, revision: content.capturedEquipmentRevision, commitment: hash(12) } }
})
const rename = (revision: string, request = Number(revision) + 1): PrivateLoadoutIntent => ({ action: 'rename', scope: empty.scope,
  expectedRevision: revision, requestId: hash(request), at: save.at, loadoutId: save.loadoutId, name: `Name ${request}` })
it('roundtrips the complete private document without global Buffer or Node crypto', () => {
  const before = globalThis.Buffer
  try {
    globalThis.Buffer = undefined as any
    const prepared = preparePrivateLoadoutMutation(empty, save)
    const bytes = encodePrivateLoadoutLibrary(prepared.library)
    expect(decodePrivateLoadoutLibrary(bytes, empty.scope, '1')).toEqual(prepared.library)
    expect(prepared.result).toMatchObject({ revision: '1', loadout: { name: 'Private outfit' } })
    expect(empty.entries).toHaveLength(0)
  } finally { globalThis.Buffer = before }
})
it('renames/deletes without current equipment and replays a receipt before CAS', () => {
  const first = preparePrivateLoadoutMutation(empty, save), second = preparePrivateLoadoutMutation(first.library, rename('1'))
  const deletion: PrivateLoadoutIntent = { action: 'delete', scope: empty.scope, expectedRevision: '2', requestId: hash(3), at: save.at, loadoutId: save.loadoutId }
  const third = preparePrivateLoadoutMutation(second.library, deletion)
  expect(third.library.entries).toHaveLength(0)
  expect(preparePrivateLoadoutMutation(third.library, deletion)).toMatchObject({ replay: true, result: third.result })
  expect(preparePrivateLoadoutMutation(third.library, save)).toMatchObject({ replay: true, result: first.result })
  expect(() => preparePrivateLoadoutMutation(third.library, { ...save, name: 'different' } as PrivateLoadoutIntent)).toThrow('REQUEST_CONFLICT')
})
it.each(['owner', 'ownershipEpoch', 'stateId', 'soulId'] as const)('rejects document or mutation transplanted to another %s', key => {
  const library = preparePrivateLoadoutMutation(empty, save).library
  const scope = { ...empty.scope, [key]: key === 'ownershipEpoch' ? '999' : `0x${hash(999)}` }
  expect(() => validatePrivateLoadoutLibrary(library, scope, '1')).toThrow()
  expect(() => preparePrivateLoadoutMutation(emptyPrivateLoadoutLibrary(scope), save)).toThrow()
})
it('preserves twelve entries and rejects a thirteenth instead of evicting', () => {
  let library = empty
  for (let i = 1; i <= 12; i++) library = preparePrivateLoadoutMutation(library,
    { ...save, requestId: hash(i), loadoutId: uuid(i), expectedRevision: String(i - 1) }).library
  expect(() => preparePrivateLoadoutMutation(library, { ...save, requestId: hash(13), loadoutId: uuid(13), expectedRevision: '12' })).toThrow('LOADOUT_LIMIT')
  expect(library.entries).toHaveLength(12)
})
it('keeps thirty-two receipts and cannot duplicate an evicted save', () => {
  let library = preparePrivateLoadoutMutation(empty, save).library
  for (let i = 1; i < 34; i++) library = preparePrivateLoadoutMutation(library, rename(String(i))).library
  expect(library.receipts).toHaveLength(32)
  expect(() => preparePrivateLoadoutMutation(library, save)).toThrow('REVISION_CONFLICT')
  expect(() => preparePrivateLoadoutMutation(library, { ...save, expectedRevision: '34' })).toThrow('REQUEST_CONFLICT')
})
it.each(['receipt', 'intent', 'entry', 'count', 'content', 'capture', 'extra', 'revision'])('rejects corrupted %s', kind => {
  const library: any = preparePrivateLoadoutMutation(empty, save).library
  if (kind === 'receipt') library.receipts[0].requestHash = hash(99)
  if (kind === 'intent') library.intent.name = 'Other'
  if (kind === 'entry') library.entries[0].name = 'Other'
  if (kind === 'count') library.entries[0].selectionCount = 499
  if (kind === 'content') library.entries[0].content.stateId = `0x${hash(999)}`
  if (kind === 'capture') library.intent.capture.revision = '999'
  if (kind === 'extra') library.privateKey = 'forbidden'
  if (kind === 'revision') library.revision = '2'
  expect(() => validatePrivateLoadoutLibrary(library, empty.scope, '1')).toThrow()
})
it('rejects noncanonical/trailing/duplicate JSON and malformed UTF-8', () => {
  const library = preparePrivateLoadoutMutation(empty, save).library, bytes = encodePrivateLoadoutLibrary(library)
  const json = new TextDecoder().decode(bytes)
  for (const input of [new Uint8Array([...bytes, 32]), new TextEncoder().encode(json.replace('{', '{"revision":"1",')),
    new TextEncoder().encode(JSON.stringify(library, null, 2)), new Uint8Array([0xc0, 0xaf])]) {
    expect(() => decodePrivateLoadoutLibrary(input, empty.scope, '1')).toThrow()
  }
})
it('rejects invalid revisions, exact scope keys, request IDs and entry versions', () => {
  for (const expectedRevision of ['00', '-1', '18446744073709551616', '18446744073709551615'])
    expect(() => preparePrivateLoadoutMutation(empty, { ...save, expectedRevision })).toThrow()
  for (const requestId of ['0'.repeat(64), 'ff', 'A'.repeat(64)])
    expect(() => preparePrivateLoadoutMutation(empty, { ...save, requestId })).toThrow()
  expect(() => emptyPrivateLoadoutLibrary({ ...empty.scope, extra: true } as any)).toThrow()
})
it('does not alias input or return objects to earlier libraries', () => {
  const first = preparePrivateLoadoutMutation(empty, save), second = preparePrivateLoadoutMutation(first.library, rename('1'))
  if ('loadout' in first.result) first.result.loadout.name = 'mutated result'
  first.library.entries[0].content.slots.length = 0
  expect(second.library.entries[0].content.slots.length).toBeGreaterThan(0)
  expect(second.library.receipts[0].result).toMatchObject({ loadout: { name: 'Private outfit' } })
})
it('renews storage without changing entry contents, versions, or private names', () => {
  const first = preparePrivateLoadoutMutation(empty, save).library
  const intent: PrivateLoadoutIntent = { action: 'renew', scope: empty.scope, requestId: hash(2), expectedRevision: '1', at: save.at }
  const next = preparePrivateLoadoutMutation(first, intent)
  expect(next.library.entries).toEqual(first.entries)
  expect(next.result).toEqual({ revision: '2', renewed: true })
  expect(decodePrivateLoadoutLibrary(encodePrivateLoadoutLibrary(next.library), empty.scope, '2')).toEqual(next.library)
  expect(preparePrivateLoadoutMutation(next.library, intent).replay).toBe(true)
  expect(() => preparePrivateLoadoutMutation(first, { ...intent, name: 'not allowed' } as any)).toThrow()
})
