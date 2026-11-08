import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, toBase58, fromBase64, toBase64 } from '@mysten/sui/utils'
import { publicMutationCanonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { sameSoulMutationScope } from '../same-soul-mutation-coordination'
import { parseOriginalSoulEnhancementSequencePlan, buildOriginalSoulEnhancementSequenceTransaction, type OriginalSoulEnhancementSequencePlan } from './original-soul-enhancement-sequence-plan'
import { validateOriginalSoulEnhancementCoinRefs, type OriginalSoulEnhancementCoinRef } from './original-soul-enhancement-plan-values'
export const ORIGINAL_SOUL_ENHANCEMENT_SCHEMA = 'soulidity.original-soul-enhancement.v1' as const
export const ORIGINAL_SOUL_ENHANCEMENT_RECORD_LIMIT = 750000
export interface OriginalSoulEnhancementOriginalPlan {
  chainIdentifier: string; soulId: string; author: string; construction: OriginalSoulEnhancementSequencePlan
  original: { genesisHash: string; applicationId: string; recipeHash: string }
  gas: { budget: string; price: string; coins: OriginalSoulEnhancementCoinRef[] }
}
export interface OriginalSoulEnhancementOriginal {
  schema: typeof ORIGINAL_SOUL_ENHANCEMENT_SCHEMA; plan: OriginalSoulEnhancementOriginalPlan; packet: PublicMutationPacket
}
function check(v: unknown, code: string): asserts v { if (!v) throw Error('SOUL_ENHANCEMENT_ORIGINAL_' + code) }
function fields(v: unknown, names: string[]) { check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join(), 'FIELDS') }
function uint(v: unknown, positive = false): asserts v is string { check(typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= (1n << 64n) - 1n && (!positive || BigInt(v) > 0n), 'U64') }
const validDigest = (v: string) => typeof v === 'string' && v.length <= 44 && fromBase58(v).length === 32 && toBase58(fromBase58(v)) === v
export function originalSoulEnhancementKey(input: { chainIdentifier: string; soulId: string; author: string }) {
  const scope = sameSoulMutationScope(input)
  return `${ORIGINAL_SOUL_ENHANCEMENT_SCHEMA}:${scope.chainIdentifier}:${scope.soulId}:${scope.author}`
}
/** Exact current head/archive syntax. Unknown versions and malformed suffixes
 * remain recovery obligations in the shared same-Soul scanner. */
export function classifyOriginalSoulEnhancementStorageKey(name: string) {
  const pieces = name.split(':'), headKey = pieces.slice(0, 4).join(':')
  check(pieces[0] === ORIGINAL_SOUL_ENHANCEMENT_SCHEMA && originalSoulEnhancementKey({ chainIdentifier: pieces[1], soulId: pieces[2], author: pieces[3] }) === headKey, 'STORAGE_KEY')
  if (pieces.length === 4) return { headKey, archived: false }
  check(pieces.length === 7 && pieces[4] === 'history' && validDigest(pieces[5]) && ['SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(pieces[6]), 'STORAGE_KEY')
  return { headKey, archived: true }
}
/** Offline ORIGINAL-schema validator. Independent full TransactionData rebuild
 * is from compact domain intent, never from the packet's own command graph.
 * Historical Genesis/recipe/Item metadata and source/authority/finality still
 * need their own proofs; a structurally valid import grants no mutation power. */
export async function parseOriginalSoulEnhancementOriginal(input: unknown): Promise<OriginalSoulEnhancementOriginal> {
  const r = structuredClone(input) as OriginalSoulEnhancementOriginal
  fields(r, ['schema', 'plan', 'packet']); check(r.schema === ORIGINAL_SOUL_ENHANCEMENT_SCHEMA, 'SCHEMA')
  const p = r.plan; fields(p, ['chainIdentifier', 'soulId', 'author', 'construction', 'original', 'gas'])
  originalSoulEnhancementKey(p); p.construction = parseOriginalSoulEnhancementSequencePlan(p.construction)
  const c = p.construction.context
  check(p.chainIdentifier === c.target.chainIdentifier && p.soulId === c.soul.objectId && p.author === c.actor, 'SCOPE')
  fields(p.original, ['genesisHash', 'applicationId', 'recipeHash'])
  check(/^[0-9a-f]{64}$/.test(p.original.genesisHash) && /^[0-9a-f]{64}$/.test(p.original.recipeHash)
    && /^0x[0-9a-f]{64}$/.test(p.original.applicationId) && !/^0x0+$/.test(p.original.applicationId), 'ORIGINAL_METADATA')
  fields(p.gas, ['budget', 'price', 'coins']); uint(p.gas.budget, true); uint(p.gas.price, true)
  const business = [p.author, p.soulId, p.original.applicationId, c.maker.objectId, c.config.objectId, c.system.objectId, c.custody.account.objectId, c.custody.kiosk.objectId,
    ...p.construction.fundingCoins.map(coin => coin.objectId), ...p.construction.accessPlans.map(row => row.product.objectId),
    ...p.construction.steps.flatMap(row => row.kind === 'CONTRIBUTE' ? [...row.returnedItemIds, ...(row.contribution.kind === 'PACK' ? [row.contribution.pack.objectId] : [])] : row.kind === 'CLEAR_SLOT' && row.returnedItemId ? [row.returnedItemId] : []),
    ...[c.target.adapter, c.target.manufacturing, c.target.application, c.target.model].flatMap(pin => [pin.originalPackageId, pin.callablePackageId]), `0x${'0'.repeat(63)}6`]
  validateOriginalSoulEnhancementCoinRefs(p.gas.coins, business); check(p.gas.coins.length > 0, 'GAS_REQUIRED')
  const packet = r.packet; fields(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])
  uint(packet.expirationEpoch); check(Number.isSafeInteger(Number(packet.expirationEpoch)) && validDigest(packet.digest), 'PACKET_IDENTITY')
  check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(packet.phase), 'PHASE')
  if (packet.signature !== null) { check(typeof packet.signature === 'string' && packet.signature.length <= 32768, 'SIGNATURE'); const raw = fromBase64(packet.signature); check(raw.length > 0 && raw.length <= 24576 && toBase64(raw) === packet.signature, 'SIGNATURE') }
  check(packet.phase !== 'SIGNED' || packet.signature !== null, 'SIGNATURE_REQUIRED')
  check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'UNEXPECTED_SIGNATURE')
  check(typeof packet.bytes === 'string' && packet.bytes.length <= 174764, 'PACKET_SIZE')
  const encoded = fromBase64(packet.bytes); check(encoded.length > 0 && encoded.length <= 131072 && toBase64(encoded) === packet.bytes, 'PACKET_BYTES')
  const raw = bcs.TransactionData.parse(encoded)
  check(toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes && TransactionDataBuilder.getDigestFromBytes(encoded) === packet.digest, 'PACKET_IDENTITY')
  const actual = Transaction.from(encoded).getData()
  check(actual.sender === p.author && actual.gasData.owner === p.author && raw.V1 && String(raw.V1.expiration.Epoch) === packet.expirationEpoch, 'PACKET_SCOPE')
  const expected = buildOriginalSoulEnhancementSequenceTransaction(p.construction)
  expected.setGasOwner(p.author); expected.setGasBudget(p.gas.budget); expected.setGasPrice(p.gas.price); expected.setGasPayment(p.gas.coins); expected.setExpiration({ Epoch: packet.expirationEpoch })
  check(toBase64(await expected.build()) === packet.bytes, 'FROZEN_GRAPH_OR_GAS_CHANGED')
  check(new TextEncoder().encode(publicMutationCanonical(r)).byteLength <= ORIGINAL_SOUL_ENHANCEMENT_RECORD_LIMIT, 'RECORD_SIZE')
  return r
}
export async function importOriginalSoulEnhancementOriginal(text: string) {
  check(typeof text === 'string' && text.length > 0 && new TextEncoder().encode(text).byteLength <= ORIGINAL_SOUL_ENHANCEMENT_RECORD_LIMIT, 'RECORD_SIZE')
  const record = await parseOriginalSoulEnhancementOriginal(JSON.parse(text)); return { originalText: text, record, signingQualified: false as const, requiresOriginalOutcomeQuery: true as const }
}
export async function exportOriginalSoulEnhancementOriginal(input: OriginalSoulEnhancementOriginal) { return publicMutationCanonical(await parseOriginalSoulEnhancementOriginal(input)) }
