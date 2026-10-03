import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'

/** A byte/resource limit, not a product quota or permission to truncate entries. */
export const PRIVATE_BOOKMARK_MAX_BYTES = 8 * 1024 * 1024
const MAX_U64 = 18446744073709551615n
export interface PrivateBookmarkScope { registryId: string; owner: string }
export interface PrivateBookmarkEntry { soulId: string; createdAt: string }
type BaseIntent = { scope: PrivateBookmarkScope; requestId: string; expectedRevision: string; at: string }
export type PrivateBookmarkIntent = BaseIntent & ({ action: 'set'; soulId: string; bookmarked: boolean } | { action: 'renew' })
export type PrivateBookmarkResult = { revision: string } & ({ action: 'set'; soulId: string; bookmarked: boolean } | { action: 'renew' })
export interface PrivateBookmarkReceipt { requestId: string; requestHash: string; result: PrivateBookmarkResult }
/** All of this document is private, including its intent, receipts and timestamps.
 * Times are wallet-supplied labels, not claims of chain/consensus time. */
export interface PrivateBookmarkLibrary {
  schema: 'soulidity.private-bookmarks.v1'; scope: PrivateBookmarkScope; revision: string
  entries: PrivateBookmarkEntry[]; receipts: PrivateBookmarkReceipt[]; intent: PrivateBookmarkIntent | null
}
export function bookmarkCheck(value: unknown, code: string): asserts value {
  if (!value) throw new Error(`PRIVATE_BOOKMARK_${code}`)
}
export const bookmarkId = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
export const bookmarkHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) && !/^0+$/.test(v)
export const bookmarkU64 = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= MAX_U64
function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key))
}
const iso = (v: unknown): v is string => typeof v === 'string' && v.length <= 32 && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
export function bookmarkCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(bookmarkCanonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${bookmarkCanonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  bookmarkCheck(value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value), 'JSON_INVALID')
  return JSON.stringify(value)
}
const same = (a: unknown, b: unknown) => bookmarkCanonical(a) === bookmarkCanonical(b)
export function validatePrivateBookmarkScope(value: unknown): PrivateBookmarkScope {
  bookmarkCheck(exact(value, ['registryId', 'owner']) && bookmarkId(value.registryId) && bookmarkId(value.owner), 'SCOPE_INVALID')
  return { registryId: value.registryId, owner: value.owner }
}
export function validatePrivateBookmarkIntent(input: unknown, scopeInput: PrivateBookmarkScope): PrivateBookmarkIntent {
  const scope = validatePrivateBookmarkScope(scopeInput), value = input as PrivateBookmarkIntent
  bookmarkCheck(value && ['set', 'renew'].includes(value.action) && exact(value, ['scope', 'requestId', 'expectedRevision', 'at', 'action',
    ...(value.action === 'set' ? ['soulId', 'bookmarked'] : [])]) && bookmarkHash(value.requestId)
    && bookmarkU64(value.expectedRevision) && BigInt(value.expectedRevision) < MAX_U64 && iso(value.at)
    && same(validatePrivateBookmarkScope(value.scope), scope), 'INTENT_INVALID')
  if (value.action === 'set') bookmarkCheck(bookmarkId(value.soulId) && typeof value.bookmarked === 'boolean', 'INTENT_INVALID')
  return structuredClone(value)
}
export function privateBookmarkIntentHash(value: PrivateBookmarkIntent) {
  const intent = validatePrivateBookmarkIntent(value, value.scope)
  return toHex(sha256(new TextEncoder().encode(bookmarkCanonical(intent))))
}
function validateResult(value: unknown): asserts value is PrivateBookmarkResult {
  const v = value as PrivateBookmarkResult
  bookmarkCheck(v && ['set', 'renew'].includes(v.action) && exact(v, ['revision', 'action', ...(v.action === 'set' ? ['soulId', 'bookmarked'] : [])])
    && bookmarkU64(v.revision) && v.revision !== '0' && (v.action !== 'set' || bookmarkId(v.soulId) && typeof v.bookmarked === 'boolean'), 'RECEIPT_INVALID')
}
export function emptyPrivateBookmarkLibrary(scope: PrivateBookmarkScope): PrivateBookmarkLibrary {
  return { schema: 'soulidity.private-bookmarks.v1', scope: validatePrivateBookmarkScope(scope), revision: '0', entries: [], receipts: [], intent: null }
}
export function validatePrivateBookmarkLibrary(input: unknown, scopeInput: PrivateBookmarkScope, revision: string): PrivateBookmarkLibrary {
  const scope = validatePrivateBookmarkScope(scopeInput), value = input as PrivateBookmarkLibrary
  bookmarkCheck(bookmarkU64(revision) && exact(value, ['schema', 'scope', 'revision', 'entries', 'receipts', 'intent'])
    && value.schema === 'soulidity.private-bookmarks.v1' && value.revision === revision && same(validatePrivateBookmarkScope(value.scope), scope)
    && Array.isArray(value.entries) && Array.isArray(value.receipts) && value.receipts.length <= 32, 'LIBRARY_INVALID')
  // Even the smallest valid entry occupies more than 66 encoded bytes. Reject
  // impossible in-memory inputs before traversing or cloning a huge array.
  bookmarkCheck(value.entries.length <= Math.floor(PRIVATE_BOOKMARK_MAX_BYTES / 66), 'DOCUMENT_TOO_LARGE')
  const ids = new Set<string>()
  for (const entry of value.entries) {
    bookmarkCheck(exact(entry, ['soulId', 'createdAt']) && bookmarkId(entry.soulId) && iso(entry.createdAt) && !ids.has(entry.soulId), 'ENTRY_INVALID')
    ids.add(entry.soulId)
  }
  const requests = new Set<string>()
  for (const [i, receipt] of value.receipts.entries()) {
    bookmarkCheck(exact(receipt, ['requestId', 'requestHash', 'result']) && bookmarkHash(receipt.requestId)
      && bookmarkHash(receipt.requestHash) && !requests.has(receipt.requestId), 'RECEIPT_INVALID')
    validateResult(receipt.result)
    bookmarkCheck(BigInt(receipt.result.revision) === BigInt(revision) - BigInt(value.receipts.length - i - 1), 'RECEIPT_SEQUENCE_INVALID')
    requests.add(receipt.requestId)
  }
  if (revision === '0') bookmarkCheck(value.entries.length === 0 && value.receipts.length === 0 && value.intent === null, 'EMPTY_LIBRARY_INVALID')
  else {
    bookmarkCheck(value.receipts.length === Number(BigInt(revision) > 32n ? 32n : BigInt(revision)), 'RECEIPT_WINDOW_INVALID')
    const intent = validatePrivateBookmarkIntent(value.intent, scope), last = value.receipts.at(-1)!
    bookmarkCheck(BigInt(intent.expectedRevision) + 1n === BigInt(revision) && last.requestId === intent.requestId
      && last.requestHash === privateBookmarkIntentHash(intent) && last.result.action === intent.action, 'INTENT_RECEIPT_MISMATCH')
    if (intent.action === 'set') {
      bookmarkCheck(last.result.action === 'set' && last.result.soulId === intent.soulId && last.result.bookmarked === intent.bookmarked, 'RESULT_MISMATCH')
      const entry = value.entries.find(row => row.soulId === intent.soulId)
      bookmarkCheck(intent.bookmarked ? entry?.createdAt === intent.at && value.entries[0] === entry : !entry, 'RESULT_MISMATCH')
    }
  }
  bookmarkCheck(new TextEncoder().encode(bookmarkCanonical(value)).length <= PRIVATE_BOOKMARK_MAX_BYTES, 'DOCUMENT_TOO_LARGE')
  return structuredClone(value)
}
export function encodePrivateBookmarkLibrary(value: PrivateBookmarkLibrary): Uint8Array<ArrayBuffer> {
  const valid = validatePrivateBookmarkLibrary(value, value.scope, value.revision)
  return new TextEncoder().encode(bookmarkCanonical(valid))
}
export function decodePrivateBookmarkLibrary(bytes: Uint8Array, scope: PrivateBookmarkScope, revision: string): PrivateBookmarkLibrary {
  bookmarkCheck(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= PRIVATE_BOOKMARK_MAX_BYTES, 'DOCUMENT_TOO_LARGE')
  let input: unknown
  try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('PRIVATE_BOOKMARK_DOCUMENT_INVALID') }
  const library = validatePrivateBookmarkLibrary(input, scope, revision), canonical = encodePrivateBookmarkLibrary(library)
  try { bookmarkCheck(canonical.length === bytes.length && canonical.every((v, i) => v === bytes[i]), 'DOCUMENT_NONCANONICAL') }
  finally { canonical.fill(0) }
  return library
}
/** The desired state is frozen, not a toggle to re-evaluate after retry. Receipt
 * lookup precedes CAS. Noop sets incur no new storage or chain write. */
export function preparePrivateBookmarkMutation(input: PrivateBookmarkLibrary, requested: PrivateBookmarkIntent) {
  const library = validatePrivateBookmarkLibrary(input, input.scope, input.revision), intent = validatePrivateBookmarkIntent(requested, library.scope)
  const hash = privateBookmarkIntentHash(intent), prior = library.receipts.find(row => row.requestId === intent.requestId)
  if (prior) {
    bookmarkCheck(prior.requestHash === hash, 'REQUEST_CONFLICT')
    return { library, result: structuredClone(prior.result), replay: true, unchanged: false }
  }
  bookmarkCheck(intent.expectedRevision === library.revision, 'REVISION_CONFLICT')
  const index = intent.action === 'set' ? library.entries.findIndex(row => row.soulId === intent.soulId) : -1
  if (intent.action === 'set' && (index !== -1) === intent.bookmarked) return { library,
    result: { action: 'set', revision: library.revision, soulId: intent.soulId, bookmarked: intent.bookmarked } as PrivateBookmarkResult,
    replay: false, unchanged: true }
  const revision = String(BigInt(library.revision) + 1n)
  const result: PrivateBookmarkResult = intent.action === 'renew' ? { action: 'renew', revision }
    : { action: 'set', revision, soulId: intent.soulId, bookmarked: intent.bookmarked }
  if (intent.action === 'set') {
    if (intent.bookmarked) library.entries.unshift({ soulId: intent.soulId, createdAt: intent.at })
    else library.entries.splice(index, 1)
  }
  library.revision = revision; library.intent = intent
  library.receipts = [...library.receipts.slice(-31), { requestId: intent.requestId, requestHash: hash, result }]
  return { library: validatePrivateBookmarkLibrary(library, library.scope, revision), result: structuredClone(result), replay: false, unchanged: false }
}
/** An imported envelope can be valid public-key ciphertext but contain unrelated
 * changes. Recompute the whole private reducer against the proven predecessor. */
export function assertPrivateBookmarkPreparedDocument(previous: PrivateBookmarkLibrary, nextInput: PrivateBookmarkLibrary) {
  const next = validatePrivateBookmarkLibrary(nextInput, previous.scope, nextInput.revision)
  bookmarkCheck(next.intent, 'INTENT_REQUIRED')
  const expected = preparePrivateBookmarkMutation(previous, next.intent)
  bookmarkCheck(!expected.replay && !expected.unchanged && same(expected.library, next), 'PREPARED_DOCUMENT_MISMATCH')
}
export function assertPrivateBookmarkHeadDocument(library: PrivateBookmarkLibrary, head: Readonly<{
  scope: PrivateBookmarkScope; revision: string; receipts: readonly Readonly<{ requestId: string; revision: string }>[]
}> | null) {
  const value = validatePrivateBookmarkLibrary(library, library.scope, library.revision)
  if (!head) { bookmarkCheck(value.revision === '0', 'HEAD_DOCUMENT_MISMATCH'); return }
  bookmarkCheck(same(head.scope, value.scope) && head.revision === value.revision && head.receipts.length === value.receipts.length
    && head.receipts.every((row, i) => row.requestId === value.receipts[i].requestId && row.revision === value.receipts[i].result.revision), 'HEAD_DOCUMENT_MISMATCH')
}
