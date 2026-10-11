import { sha256 } from '@noble/hashes/sha2.js'
import { toHex } from '@mysten/sui/utils'
import type { PrivateNamedLoadoutHead } from '@soulidity/sdk'
import { NAMED_LOADOUT_LIMIT, normalizeNamedLoadoutName, validNamedLoadoutId, validateNamedLoadoutContent,
  type NamedLoadout, type NamedLoadoutContent, type NamedLoadoutSummary } from './named-loadout'

export const PRIVATE_LOADOUT_MAX_BYTES = 8 * 1024 * 1024
export interface PrivateLoadoutScope { soulId: string; stateId: string; owner: string; ownershipEpoch: string }
export interface PrivateLoadoutCapture { equipmentId: string; revision: string; commitment: string }
type IntentBase = { requestId: string; expectedRevision: string; scope: PrivateLoadoutScope; at: string }
export type PrivateLoadoutIntent = IntentBase & (
  | { action: 'save'; loadoutId: string; name: string; content: NamedLoadoutContent; capture: PrivateLoadoutCapture }
  | { action: 'rename'; loadoutId: string; name: string }
  | { action: 'delete'; loadoutId: string }
  | { action: 'renew' })
export type PrivateLoadoutResult = { revision: string } & ({ loadout: NamedLoadoutSummary } | { deletedId: string } | { renewed: true })
export interface PrivateLoadoutReceipt { requestId: string; requestHash: string; result: PrivateLoadoutResult }
/** This entire document, including the recovery intent and receipts, is private.
 * The chain head authenticates scope/revision; timestamps are owner-provided UI
 * labels, not claims about chain time. No plaintext form is durable browser state. */
export interface PrivateLoadoutLibrary {
  schema: 'soulidity.private-loadouts.v1'; scope: PrivateLoadoutScope; revision: string
  entries: NamedLoadout[]; receipts: PrivateLoadoutReceipt[]; intent: PrivateLoadoutIntent | null
}
export function privateLoadoutCheck(value: unknown, code: string): asserts value {
  if (!value) throw Object.assign(new Error(code), { code })
}
const check: typeof privateLoadoutCheck = privateLoadoutCheck
export const privateLoadoutId = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v)
export const privateLoadoutHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) && !/^0+$/.test(v)
export const privateLoadoutU64 = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k))
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
const version = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647
export function privateLoadoutCanonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(privateLoadoutCanonical).join(',')}]`
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${privateLoadoutCanonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  check(v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)), 'PRIVATE_LOADOUT_JSON_INVALID')
  return JSON.stringify(v)
}
export function validatePrivateLoadoutScope(value: unknown): PrivateLoadoutScope {
  check(exact(value, ['soulId', 'stateId', 'owner', 'ownershipEpoch']) && [value.soulId, value.stateId, value.owner].every(privateLoadoutId)
    && privateLoadoutU64(value.ownershipEpoch), 'PRIVATE_LOADOUT_SCOPE_INVALID')
  return { ...value } as unknown as PrivateLoadoutScope
}
function scopedContent(value: unknown, scope: PrivateLoadoutScope) {
  const c = validateNamedLoadoutContent(value)
  check(c.soulId === scope.soulId && c.stateId === scope.stateId && c.capturedOwner === scope.owner
    && c.capturedOwnershipEpoch === scope.ownershipEpoch, 'PRIVATE_LOADOUT_CONTENT_SCOPE_MISMATCH')
  return c
}
export function privateLoadoutSummary({ content: _content, ...summary }: NamedLoadout): NamedLoadoutSummary { return summary }
function validateSummary(value: unknown): asserts value is NamedLoadoutSummary {
  check(exact(value, ['id', 'name', 'version', 'selectionCount', 'slotCount', 'createdAt', 'updatedAt'])
    && validNamedLoadoutId(value.id) && normalizeNamedLoadoutName(value.name) === value.name && version(value.version)
    && Number.isInteger(value.slotCount) && Number(value.slotCount) > 0 && Number(value.slotCount) <= 500
    && Number.isInteger(value.selectionCount) && Number(value.selectionCount) >= 0 && Number(value.selectionCount) <= Number(value.slotCount)
    && iso(value.createdAt) && iso(value.updatedAt), 'PRIVATE_LOADOUT_SUMMARY_INVALID')
}
export function validatePrivateLoadoutIntent(value: unknown, scopeInput: PrivateLoadoutScope): PrivateLoadoutIntent {
  const scope = validatePrivateLoadoutScope(scopeInput), v = structuredClone(value) as PrivateLoadoutIntent
  check(v && ['save', 'rename', 'delete', 'renew'].includes(v.action) && exact(v, ['action', 'requestId', 'expectedRevision', 'scope', 'at',
    ...(v.action !== 'renew' ? ['loadoutId'] : []), ...(['save', 'rename'].includes(v.action) ? ['name'] : []), ...(v.action === 'save' ? ['content', 'capture'] : [])])
    && privateLoadoutHash(v.requestId) && privateLoadoutU64(v.expectedRevision) && BigInt(v.expectedRevision) < 18446744073709551615n
    && privateLoadoutCanonical(validatePrivateLoadoutScope(v.scope)) === privateLoadoutCanonical(scope)
    && iso(v.at) && (v.action === 'renew' || validNamedLoadoutId(v.loadoutId)), 'PRIVATE_LOADOUT_INTENT_INVALID')
  if (v.action === 'save' || v.action === 'rename') check(normalizeNamedLoadoutName(v.name) === v.name, 'PRIVATE_LOADOUT_NAME_INVALID')
  if (v.action === 'save') {
    const c = scopedContent(v.content, scope)
    check(exact(v.capture, ['equipmentId', 'revision', 'commitment']) && privateLoadoutId(v.capture.equipmentId)
      && privateLoadoutU64(v.capture.revision) && privateLoadoutHash(v.capture.commitment)
      && c.capturedEquipmentId === v.capture.equipmentId && c.capturedEquipmentRevision === v.capture.revision,
    'PRIVATE_LOADOUT_CAPTURE_MISMATCH')
  }
  return v
}
export function privateLoadoutIntentHash(intent: PrivateLoadoutIntent) {
  return toHex(sha256(new TextEncoder().encode(privateLoadoutCanonical(intent))))
}
export function emptyPrivateLoadoutLibrary(scope: PrivateLoadoutScope): PrivateLoadoutLibrary {
  return { schema: 'soulidity.private-loadouts.v1', scope: validatePrivateLoadoutScope(scope), revision: '0', entries: [], receipts: [], intent: null }
}
/** Relate the decrypted document to an independently proven current head.
 * Orphan recovery deliberately does not use this current-head-only assertion. */
export function assertPrivateLoadoutHeadDocument(library: PrivateLoadoutLibrary, head: Readonly<PrivateNamedLoadoutHead> | null) {
  const valid = validatePrivateLoadoutLibrary(library, library.scope, library.revision)
  if (head === null) { check(valid.revision === '0', 'PRIVATE_LOADOUT_HEAD_DOCUMENT_MISMATCH'); return }
  check(privateLoadoutCanonical(head.scope) === privateLoadoutCanonical(valid.scope) && head.revision === valid.revision
    && head.receipts.length === valid.receipts.length && head.receipts.every((r, i) => r.requestId === valid.receipts[i].requestId
      && r.revision === valid.receipts[i].result.revision), 'PRIVATE_LOADOUT_HEAD_DOCUMENT_MISMATCH')
  check(privateLoadoutCanonical(head.receipts.at(-1)!.capture) === privateLoadoutCanonical(valid.intent?.action === 'save' ? valid.intent.capture : null),
    'PRIVATE_LOADOUT_HEAD_CAPTURE_MISMATCH')
}
export function validatePrivateLoadoutLibrary(value: unknown, scopeInput: PrivateLoadoutScope, revision: string): PrivateLoadoutLibrary {
  const scope = validatePrivateLoadoutScope(scopeInput)
  check(privateLoadoutU64(revision), 'PRIVATE_LOADOUT_REVISION_INVALID')
  const v = structuredClone(value) as PrivateLoadoutLibrary
  check(exact(v, ['schema', 'scope', 'revision', 'entries', 'receipts', 'intent']) && v.schema === 'soulidity.private-loadouts.v1'
    && v.revision === revision && privateLoadoutCanonical(validatePrivateLoadoutScope(v.scope)) === privateLoadoutCanonical(scope)
    && Array.isArray(v.entries) && v.entries.length <= NAMED_LOADOUT_LIMIT && Array.isArray(v.receipts) && v.receipts.length <= 32,
  'PRIVATE_LOADOUT_LIBRARY_INVALID')
  const ids = new Set<string>(), requests = new Set<string>()
  for (const entry of v.entries) {
    check(exact(entry, ['id', 'name', 'version', 'selectionCount', 'slotCount', 'createdAt', 'updatedAt', 'content']), 'PRIVATE_LOADOUT_ENTRY_INVALID')
    validateSummary(privateLoadoutSummary(entry))
    const c = scopedContent(entry.content, scope)
    check(!ids.has(entry.id) && c.slots.length === entry.slotCount && c.slots.filter(Boolean).length === entry.selectionCount, 'PRIVATE_LOADOUT_ENTRY_MISMATCH')
    ids.add(entry.id)
  }
  let previous = 0n
  for (const r of v.receipts) {
    check(exact(r, ['requestId', 'requestHash', 'result']) && privateLoadoutHash(r.requestId) && privateLoadoutHash(r.requestHash)
      && !requests.has(r.requestId) && r.result && exact(r.result, ['revision', ...('loadout' in r.result ? ['loadout'] : 'deletedId' in r.result ? ['deletedId'] : ['renewed'])])
      && privateLoadoutU64(r.result.revision) && BigInt(r.result.revision) > previous && BigInt(r.result.revision) <= BigInt(revision),
    'PRIVATE_LOADOUT_RECEIPT_INVALID')
    if ('loadout' in r.result) validateSummary(r.result.loadout)
    else if ('deletedId' in r.result) check(validNamedLoadoutId(r.result.deletedId), 'PRIVATE_LOADOUT_RECEIPT_INVALID')
    else check(r.result.renewed === true, 'PRIVATE_LOADOUT_RECEIPT_INVALID')
    previous = BigInt(r.result.revision); requests.add(r.requestId)
  }
  if (revision === '0') check(v.entries.length === 0 && v.receipts.length === 0 && v.intent === null, 'PRIVATE_LOADOUT_EMPTY_SCOPE_INVALID')
  else {
    const intent = validatePrivateLoadoutIntent(v.intent, scope), last = v.receipts.at(-1)
    check(BigInt(intent.expectedRevision) + 1n === BigInt(revision) && last?.result.revision === revision
      && last.requestId === intent.requestId && last.requestHash === privateLoadoutIntentHash(intent), 'PRIVATE_LOADOUT_RECOVERY_INTENT_MISMATCH')
    const entry = intent.action === 'renew' ? undefined : v.entries.find(e => e.id === intent.loadoutId)
    if (intent.action === 'delete') check(!entry && 'deletedId' in last.result && last.result.deletedId === intent.loadoutId, 'PRIVATE_LOADOUT_RESULT_MISMATCH')
    else if (intent.action === 'renew') check('renewed' in last.result && last.result.renewed, 'PRIVATE_LOADOUT_RESULT_MISMATCH')
    else {
      check(entry && entry.name === intent.name && entry.updatedAt === intent.at && 'loadout' in last.result
        && privateLoadoutCanonical(privateLoadoutSummary(entry)) === privateLoadoutCanonical(last.result.loadout), 'PRIVATE_LOADOUT_RESULT_MISMATCH')
      if (intent.action === 'save') check(entry.version === 1 && entry.createdAt === intent.at
        && privateLoadoutCanonical(entry.content) === privateLoadoutCanonical(intent.content), 'PRIVATE_LOADOUT_CAPTURE_MISMATCH')
    }
  }
  check(new TextEncoder().encode(privateLoadoutCanonical(v)).length <= PRIVATE_LOADOUT_MAX_BYTES, 'PRIVATE_LOADOUT_LIBRARY_TOO_LARGE')
  return v
}
export function encodePrivateLoadoutLibrary(value: PrivateLoadoutLibrary) {
  const valid = validatePrivateLoadoutLibrary(value, value.scope, value.revision)
  return new TextEncoder().encode(privateLoadoutCanonical(valid))
}
export function decodePrivateLoadoutLibrary(bytes: Uint8Array, scope: PrivateLoadoutScope, revision: string) {
  check(bytes.length > 0 && bytes.length <= PRIVATE_LOADOUT_MAX_BYTES, 'PRIVATE_LOADOUT_LIBRARY_TOO_LARGE')
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { throw new Error('PRIVATE_LOADOUT_DOCUMENT_INVALID') }
  const library = validatePrivateLoadoutLibrary(value, scope, revision)
  const encoded = encodePrivateLoadoutLibrary(library)
  try { check(bytes.length === encoded.length && bytes.every((b, i) => b === encoded[i]), 'PRIVATE_LOADOUT_DOCUMENT_NONCANONICAL') }
  finally { encoded.fill(0) }
  return library
}
/** Pure private preparation. It does not commit, pay, sign, or substitute for
 * fresh chain capture/readback. Replay precedes CAS; rebase is a separate action. */
export function preparePrivateLoadoutMutation(current: PrivateLoadoutLibrary, value: PrivateLoadoutIntent) {
  const library = validatePrivateLoadoutLibrary(current, current.scope, current.revision)
  const intent = validatePrivateLoadoutIntent(value, library.scope), requestHash = privateLoadoutIntentHash(intent)
  const prior = library.receipts.find(r => r.requestId === intent.requestId)
  if (prior) {
    check(prior.requestHash === requestHash, 'PRIVATE_LOADOUT_REQUEST_CONFLICT')
    return { library, result: structuredClone(prior.result), replay: true }
  }
  check(library.revision === intent.expectedRevision, 'PRIVATE_LOADOUT_REVISION_CONFLICT')
  const index = intent.action === 'renew' ? -1 : library.entries.findIndex(e => e.id === intent.loadoutId)
  let result: PrivateLoadoutResult
  const revision = String(BigInt(library.revision) + 1n)
  if (intent.action === 'renew') {
    result = { revision, renewed: true }
  } else if (intent.action === 'delete') {
    check(index >= 0, 'PRIVATE_LOADOUT_NOT_FOUND'); library.entries.splice(index, 1)
    result = { revision, deletedId: intent.loadoutId }
  } else {
    let entry: NamedLoadout
    if (intent.action === 'save') {
      check(index < 0, 'PRIVATE_LOADOUT_REQUEST_CONFLICT'); check(library.entries.length < NAMED_LOADOUT_LIMIT, 'PRIVATE_LOADOUT_LIMIT')
      entry = { id: intent.loadoutId, name: intent.name, version: 1, content: intent.content,
        selectionCount: intent.content.slots.filter(Boolean).length, slotCount: intent.content.slots.length, createdAt: intent.at, updatedAt: intent.at }
      library.entries.push(entry)
    } else {
      check(index >= 0, 'PRIVATE_LOADOUT_NOT_FOUND'); check(library.entries[index].version < 2147483647, 'PRIVATE_LOADOUT_VERSION_EXHAUSTED')
      entry = { ...library.entries[index], name: intent.name, version: library.entries[index].version + 1, updatedAt: intent.at }
      library.entries[index] = entry
    }
    result = { revision, loadout: privateLoadoutSummary(entry) }
  }
  library.revision = revision; library.intent = intent
  library.receipts = [...library.receipts, { requestId: intent.requestId, requestHash, result }].slice(-32)
  return { library: validatePrivateLoadoutLibrary(library, library.scope, revision), result: structuredClone(result), replay: false }
}
