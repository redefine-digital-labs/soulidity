import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase58, toBase58, toHex } from '@mysten/sui/utils'
import { sha256 } from '@noble/hashes/sha2.js'
import { parseWalrusSingleRecord, type WalrusSingleRecord } from '../upload/walrus-single-operation'
import { assertContentAppendWalrusRecord, contentAppendWalrusIntent, parseContentAppendIntent } from './content-append-operation'
import { contentAppendPreparationFingerprint, verifyContentAppendPreparation, type ContentAppendPreparation } from './content-append-preparation'

export type CompactContentAppendPreparation = Omit<ContentAppendPreparation, 'ciphertext'>
export interface ContentAppendRebaseLink {
  schema: 'soulidity.content-append-rebase.v1'
  previous: CompactContentAppendPreparation
  previousPayment: WalrusSingleRecord
  next: CompactContentAppendPreparation
  nextPayment: WalrusSingleRecord
  inspection: { blobObjectId: string; blobVersion: string; blobDigest: string; observedWalrusEpoch: number; storageEndEpoch: number
    retirement: { kind: 'NO_RECORDED_PACKET' | 'FAILED' | 'EXPIRED'; digest: string | null; observedSuiEpoch: string | null } }
}
export const MAX_CONTENT_APPEND_REBASE_DEPTH = 16
const json = (v: unknown) => JSON.stringify(v)
function check(v: unknown, code: string): asserts v { if (!v) throw new Error(`CONTENT_APPEND_REBASE_${code}`) }
export function compactContentAppendPreparation(record: ContentAppendPreparation): CompactContentAppendPreparation {
  const { ciphertext: _ciphertext, ...rest } = record
  return structuredClone(rest)
}
export function expandContentAppendPreparation(record: CompactContentAppendPreparation, ciphertext: Uint8Array): ContentAppendPreparation {
  check(!Object.hasOwn(record, 'ciphertext'), 'DUPLICATE_CIPHERTEXT')
  return { ...structuredClone(record), ciphertext }
}
/** The paid root excludes only per-attempt scope, certify gas and mutable local
 * packet status/signature. Exact register bytes/digest commit the paid action.
 * Relay/storage costs, original quote, original encoding and payload stay fixed. */
export function contentAppendStorageRootHash(input: WalrusSingleRecord) {
  const r = parseWalrusSingleRecord(input), i = r.intent
  check(r.register && r.encoding && r.approved, 'PAID_REGISTER_REQUIRED')
  return toHex(sha256(new TextEncoder().encode(json({ schema: 'soulidity.content-append-paid-root.v1',
    network: i.network, owner: i.owner, recipient: i.recipient, contentHash: i.contentHash, payloadHash: i.payloadHash,
    payloadByteLength: i.payloadByteLength, storageEpochs: i.storageEpochs, relayUrl: i.relayUrl, encoding: r.encoding,
    register: { bytes: r.register.bytes, digest: r.register.digest, expirationEpoch: r.register.expirationEpoch },
    approved: { relayTip: r.approved.relayTip, storageCost: r.approved.storageCost, writeCost: r.approved.writeCost, quoteId: r.approved.quoteId } }))))
}
/** Called only after current chain inspection. A seeded attempt can certify the
 * existing Blob; it cannot contain an old certify packet or a new registration. */
export function seedContentAppendRebasePayment(next: ContentAppendPreparation, previousPayment: WalrusSingleRecord) {
  const previous = parseWalrusSingleRecord(previousPayment), rebase = parseContentAppendIntent(next).rebase
  check(rebase && contentAppendStorageRootHash(previous) === rebase.storageRootHash && previous.register && previous.approved, 'STORAGE_ROOT_MISMATCH')
  return parseWalrusSingleRecord({ ...previous, intent: contentAppendWalrusIntent(next),
    register: { ...previous.register, phase: 'SUCCEEDED' },
    approved: { ...previous.approved, gasBudget: String(BigInt(rebase.certifyGasBudgetMist) * 2n) }, certify: null, acknowledged: false })
}
/** Offline evidence validation is not live retirement permission. Every new
 * write must requery ALL known predecessors and current Soul/Blob authority. */
export async function verifyContentAppendRebaseLink(input: ContentAppendRebaseLink, ciphertext: Uint8Array, client: SuiGrpcClient) {
  const link = structuredClone(input)
  check(link && Object.keys(link).length === 6 && link.schema === 'soulidity.content-append-rebase.v1', 'LINK_SCHEMA_INVALID')
  const previous = await verifyContentAppendPreparation(expandContentAppendPreparation(link.previous, ciphertext), client)
  const next = await verifyContentAppendPreparation(expandContentAppendPreparation(link.next, ciphertext), client)
  const before = parseContentAppendIntent(previous), after = parseContentAppendIntent(next), rebase = after.rebase
  check(rebase && rebase.predecessor === contentAppendPreparationFingerprint(previous)
    && contentAppendPreparationFingerprint(previous) !== contentAppendPreparationFingerprint(next), 'PREDECESSOR_MISMATCH')
  for (const key of ['author', 'originalPackageId', 'callablePackageId', 'contentObjectId', 'kind', 'name'] as const)
    check(previous.scope[key] === next.scope[key], 'SCOPE_CHANGED')
  check(BigInt(next.scope.versionIndex) >= BigInt(previous.scope.versionIndex) && previous.contentHash === next.contentHash
    && previous.payloadHash === next.payloadHash && previous.sidecar.iv === next.sidecar.iv, 'PAID_PAYLOAD_CHANGED')
  // Only current version/epoch/grant/auto-grant observations and Seal wrapping
  // may change. Rebase does not silently change the user's content or action.
  for (const key of ['soulId', 'stateId', 'kindRegistryId', 'marketConfigId', 'readModeMask', 'downloadPolicy',
    'spriteConfigJson', 'setActive', 'contentHash', 'plaintextByteLength', 'fileName', 'mimeType', 'uploadConfig'] as const)
    check(json(before[key]) === json(after[key]), 'USER_INTENT_CHANGED')
  check((before.grantId === null) === (after.grantId === null), 'AUTHOR_ROLE_CHANGED')
  const requiredTargets = before.rebase?.autoGrantTargets ?? before.autoGrantPlan?.targets ?? []
  check(json(rebase.autoGrantTargets) === json(requiredTargets), 'ORIGINAL_AUTO_GRANT_TARGETS_CHANGED')
  const oldTargets = new Set(requiredTargets.map(t => t.address))
  check((after.autoGrantPlan?.targets ?? []).every(t => oldTargets.has(t.address)), 'AUTO_GRANT_TARGET_ADDED')
  for (const target of after.autoGrantPlan?.targets ?? []) {
    const original = requiredTargets.find(t => t.address === target.address)!
    check((target.scopeMask & original.scopeMask) === original.scopeMask, 'AUTO_GRANT_TARGET_NARROWED')
  }
  const payment = assertContentAppendWalrusRecord(previous, link.previousPayment)
  check(rebase.storageRootHash === contentAppendStorageRootHash(payment)
    && (!before.rebase || before.rebase.storageRootHash === rebase.storageRootHash), 'STORAGE_ROOT_MISMATCH')
  check(json(link.nextPayment) === json(seedContentAppendRebasePayment(next, payment)), 'SEEDED_PAYMENT_MISMATCH')
  const p = link.inspection, r = p?.retirement
  check(p && Object.keys(p).length === 6 && /^0x[0-9a-f]{64}$/.test(p.blobObjectId)
    && /^[1-9][0-9]{0,19}$/.test(p.blobVersion) && BigInt(p.blobVersion) <= 18446744073709551615n
    && typeof p.blobDigest === 'string' && fromBase58(p.blobDigest).length === 32 && toBase58(fromBase58(p.blobDigest)) === p.blobDigest
    && (!payment.uploaded || p.blobObjectId === payment.uploaded.blobObjectId)
    && Number.isSafeInteger(p.observedWalrusEpoch) && p.observedWalrusEpoch >= 0
    && Number.isSafeInteger(p.storageEndEpoch) && p.storageEndEpoch > p.observedWalrusEpoch && p.storageEndEpoch <= 0xffffffff
    && r && Object.keys(r).length === 3, 'INSPECTION_INVALID')
  if (!payment.certify) check(r.kind === 'NO_RECORDED_PACKET' && r.digest === null && r.observedSuiEpoch === null, 'RETIREMENT_MISMATCH')
  else check(r.digest === payment.certify.digest && (r.kind === 'FAILED' && (r.observedSuiEpoch === null || /^[0-9]+$/.test(r.observedSuiEpoch))
    || r.kind === 'EXPIRED' && typeof r.observedSuiEpoch === 'string' && /^[0-9]+$/.test(r.observedSuiEpoch)
      && BigInt(r.observedSuiEpoch) > BigInt(payment.certify.expirationEpoch)), 'RETIREMENT_MISMATCH')
  return { link, previous, next, previousPayment: payment }
}

export async function verifyContentAppendRebaseHistory(record: ContentAppendPreparation, input: ContentAppendRebaseLink[], client: SuiGrpcClient) {
  const links = structuredClone(input)
  record = await verifyContentAppendPreparation(record, client)
  check(Array.isArray(links) && links.length <= MAX_CONTENT_APPEND_REBASE_DEPTH, 'HISTORY_LIMIT')
  if (!parseContentAppendIntent(record).rebase) { check(links.length === 0, 'UNEXPECTED_HISTORY'); return links }
  check(links.length > 0, 'HISTORY_REQUIRED')
  let prior: string | null = null
  const seen = new Set<string>()
  for (const link of links) {
    const p = await verifyContentAppendRebaseLink(link, record.ciphertext, client)
    const before = contentAppendPreparationFingerprint(p.previous), after = contentAppendPreparationFingerprint(p.next)
    check(prior === null ? parseContentAppendIntent(p.previous).rebase === null : before === prior, 'HISTORY_GAP')
    check(!seen.has(after), 'HISTORY_CYCLE'); seen.add(after); prior = after
  }
  check(prior === contentAppendPreparationFingerprint(record), 'HISTORY_FORK')
  return links
}
