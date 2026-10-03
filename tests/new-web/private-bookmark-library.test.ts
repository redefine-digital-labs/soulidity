import { expect, it } from 'vitest'
import { assertPrivateBookmarkHeadDocument, assertPrivateBookmarkPreparedDocument, bookmarkCanonical,
  decodePrivateBookmarkLibrary, emptyPrivateBookmarkLibrary, encodePrivateBookmarkLibrary, preparePrivateBookmarkMutation,
  privateBookmarkIntentHash, validatePrivateBookmarkIntent, validatePrivateBookmarkLibrary,
  type PrivateBookmarkIntent, type PrivateBookmarkLibrary } from '../../web/lib/bookmarks/private-bookmark-library'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`, hash = (n: number) => n.toString(16).padStart(64, '0')
const scope = { registryId: id(1), owner: id(2) }, first = id(3), second = id(4), at = '2026-09-15T12:00:00.000Z'
function intent(n = 1, expectedRevision = '0', soulId = first, bookmarked = true): PrivateBookmarkIntent {
  return { scope: { ...scope }, requestId: hash(n), expectedRevision, at, action: 'set', soulId, bookmarked }
}
const empty = () => emptyPrivateBookmarkLibrary(scope)
const add = () => preparePrivateBookmarkMutation(empty(), intent()).library
const remove = () => preparePrivateBookmarkMutation(add(), intent(2, '1', first, false)).library
const valid = (library: PrivateBookmarkLibrary) => validatePrivateBookmarkLibrary(library, scope, library.revision)

it('keeps new wallets empty without requiring a public Profile or persistent browser authority', () => {
  expect(empty()).toEqual({ schema: 'soulidity.private-bookmarks.v1', scope, revision: '0', entries: [], receipts: [], intent: null })
  expect(() => assertPrivateBookmarkHeadDocument(empty(), null)).not.toThrow()
})
it('adds and removes a frozen desired state; unrelated unavailable Souls do not block removal', () => {
  const saved = add(), removed = remove()
  expect(saved.entries).toEqual([{ soulId: first, createdAt: at }]); expect(removed.entries).toEqual([])
  expect(removed.revision).toBe('2'); expect(removed.intent).toMatchObject({ action: 'set', soulId: first, bookmarked: false })
  expect(removed.receipts).toHaveLength(2)
})
it('preserves newest operation first even if a device clock goes backward; re-add returns to front', () => {
  const backwards = { ...intent(2, '1', second), at: '2026-01-01T00:00:00.000Z' }
  let library = preparePrivateBookmarkMutation(add(), backwards).library
  expect(library.entries.map(v => v.soulId)).toEqual([second, first])
  library = preparePrivateBookmarkMutation(library, intent(3, '2', first, false)).library
  library = preparePrivateBookmarkMutation(library, intent(4, '3', first, true)).library
  expect(library.entries.map(v => v.soulId)).toEqual([first, second])
})
it.each([true, false])('noops an already desired bookmarked=%s without allocating a new revision', bookmarked => {
  const previous = bookmarked ? add() : empty()
  const result = preparePrivateBookmarkMutation(previous, intent(2, previous.revision, first, bookmarked))
  expect(result).toMatchObject({ unchanged: true, replay: false, library: previous })
  expect(result.result.revision).toBe(previous.revision)
})
it('rejects stale desired state even when it is now a no-op', () => {
  expect(() => preparePrivateBookmarkMutation(add(), intent(2))).toThrow('REVISION_CONFLICT')
})
it('replays a prior exact request before CAS, without re-toggling or recreating a removed bookmark', () => {
  const removed = remove(), replay = preparePrivateBookmarkMutation(removed, intent())
  expect(replay).toMatchObject({ replay: true, unchanged: false, library: removed, result: { revision: '1', bookmarked: true } })
  expect(replay.library.entries).toEqual([])
})
it.each(['bookmarked', 'soulId', 'at', 'expectedRevision'] as const)('rejects reused request ID with changed %s', field => {
  const changed = intent() as any
  changed[field] = field === 'bookmarked' ? false : field === 'soulId' ? second : field === 'at' ? '2026-09-16T12:00:00.000Z' : '1'
  expect(() => preparePrivateBookmarkMutation(add(), changed)).toThrow('REQUEST_CONFLICT')
})
it('retains all entries while keeping exactly the last32 contiguous request receipts', () => {
  let library = empty()
  for (let i = 1; i <= 60; i++) library = preparePrivateBookmarkMutation(library, intent(i, String(i - 1), id(100 + i))).library
  expect(library.entries).toHaveLength(60); expect(library.receipts).toHaveLength(32)
  expect(library.receipts[0].result.revision).toBe('29'); expect(library.receipts[31].result.revision).toBe('60')
  expect(() => preparePrivateBookmarkMutation(library, intent(1, '0', id(101)))).toThrow('REVISION_CONFLICT')
})
it('renews storage without losing entries or resetting revision, including an intentionally emptied library', () => {
  for (const previous of [add(), remove()]) {
    const renewal: PrivateBookmarkIntent = { scope, requestId: hash(90), expectedRevision: previous.revision, at, action: 'renew' }
    const result = preparePrivateBookmarkMutation(previous, renewal)
    expect(result.library.entries).toEqual(previous.entries); expect(result.result.action).toBe('renew')
    expect(result.library.revision).toBe(String(BigInt(previous.revision) + 1n))
  }
})
it('roundtrips exact canonical private bytes and includes no external SQL member identity', () => {
  const library = add(), bytes = encodePrivateBookmarkLibrary(library)
  expect(decodePrivateBookmarkLibrary(bytes, scope, '1')).toEqual(library)
  expect(new TextDecoder().decode(bytes)).not.toMatch(/member|profileId|agentId/)
})
it.each(['padding', 'unknown-field', 'duplicate-key', 'invalid-utf8'] as const)('rejects %s document bytes', kind => {
  let text = bookmarkCanonical(add())
  if (kind === 'padding') text += ' '
  else if (kind === 'unknown-field') text = text.slice(0, -1) + ',"other":0}'
  else if (kind === 'duplicate-key') text = text.replace('"revision":"1"', '"revision":"1","revision":"1"')
  const bytes = kind === 'invalid-utf8' ? new Uint8Array([0xff]) : new TextEncoder().encode(text)
  expect(() => decodePrivateBookmarkLibrary(bytes, scope, '1')).toThrow()
})
it.each(['duplicate-entry', 'wrong-owner', 'wrong-registry', 'sql-soul-id', 'extra-entry-field', 'missing-receipt', 'duplicate-receipt',
  'receipt-gap', 'wrong-request-hash', 'wrong-intent-result', 'wrong-entry-date', 'empty-nonzero', 'nonempty-zero'] as const)(
  'rejects inconsistent document %s', fault => {
    let library = add()
    if (fault === 'duplicate-entry') library.entries.push({ ...library.entries[0] })
    if (fault === 'wrong-owner') library.scope.owner = id(999)
    if (fault === 'wrong-registry') library.scope.registryId = id(999)
    if (fault === 'sql-soul-id') library.entries[0].soulId = 'a99a2fd9-e2ab-419b-8cc2-5968d8242d58'
    if (fault === 'extra-entry-field') Object.assign(library.entries[0], { name: 'Unapproved private field' })
    if (fault === 'missing-receipt') library.receipts = []
    if (fault === 'duplicate-receipt') library.receipts.push({ ...library.receipts[0] })
    if (fault === 'receipt-gap') library.receipts[0].result.revision = '2'
    if (fault === 'wrong-request-hash') library.receipts[0].requestHash = hash(999)
    if (fault === 'wrong-intent-result') (library.receipts[0].result as any).bookmarked = false
    if (fault === 'wrong-entry-date') library.entries[0].createdAt = '2025-01-01T00:00:00.000Z'
    if (fault === 'empty-nonzero') library = { ...empty(), revision: '1' }
    if (fault === 'nonempty-zero') library = { ...empty(), entries: add().entries }
    expect(() => valid(library)).toThrow()
  })
it.each(['scope', 'requestId', 'expectedRevision', 'at', 'action', 'bookmarked'] as const)('rejects malformed intent %s', field => {
  const value = intent() as any
  value[field] = field === 'scope' ? { ...scope, owner: id(0) } : field === 'requestId' ? '0'.repeat(64)
    : field === 'expectedRevision' ? '18446744073709551615' : field === 'at' ? '2026-09-15' : field === 'action' ? 'toggle' : 1
  expect(() => validatePrivateBookmarkIntent(value, scope)).toThrow()
})
it('cannot claim an empty or mismatched chain head after a nonempty revision', () => {
  const library = add(), head = { scope, revision: '1', receipts: [{ requestId: hash(1), revision: '1' }] }
  expect(() => assertPrivateBookmarkHeadDocument(library, head)).not.toThrow()
  expect(() => assertPrivateBookmarkHeadDocument(library, null)).toThrow('HEAD_DOCUMENT_MISMATCH')
  expect(() => assertPrivateBookmarkHeadDocument(library, { ...head, receipts: [{ requestId: hash(2), revision: '1' }] })).toThrow('HEAD_DOCUMENT_MISMATCH')
})
it('rejects a validly encoded imported document which smuggles an unrelated bookmark through one valid intent', () => {
  const next = add(); next.entries.push({ soulId: second, createdAt: at })
  expect(valid(next)).toEqual(next)
  expect(() => assertPrivateBookmarkPreparedDocument(empty(), next)).toThrow('PREPARED_DOCUMENT_MISMATCH')
  expect(() => assertPrivateBookmarkPreparedDocument(empty(), add())).not.toThrow()
})
it('rebase uses latest decrypted state and a fresh request rather than overwriting another device', () => {
  const current = preparePrivateBookmarkMutation(add(), intent(2, '1', second)).library
  expect(() => preparePrivateBookmarkMutation(current, intent(3, '1', first, false))).toThrow('REVISION_CONFLICT')
  const rebased = preparePrivateBookmarkMutation(current, intent(4, '2', first, false)).library
  expect(rebased.entries).toEqual([{ soulId: second, createdAt: at }])
})
it('captures inputs so callers cannot mutate the accepted library, result or hashed intent afterward', () => {
  const source = empty(), requested = intent(), hashBefore = privateBookmarkIntentHash(requested)
  const result = preparePrivateBookmarkMutation(source, requested)
  requested.scope.owner = id(999); source.scope.owner = id(999)
  result.result.revision = '99'
  expect(result.library.scope).toEqual(scope); expect(result.library.receipts[0].result.revision).toBe('1')
  expect(result.library.receipts[0].requestHash).toBe(hashBefore)
})
