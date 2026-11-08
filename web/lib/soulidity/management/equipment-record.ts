import { bcs } from '@mysten/sui/bcs'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase58, fromBase64, toBase58, toBase64 } from '@mysten/sui/utils'
import { assertBusinessTransactionGraph } from '../../sui/business-transaction-graph'
import type { PublicMutationPacket } from '../../sui/public-mutation-journal'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { parseEquipmentManagementPlan, buildEquipmentManagementTransaction, type EquipmentManagementPlan } from './equipment-plan'

export interface EquipmentManagementRecord {
  schema: 'soulidity.equipment-account-mutation.v1'; plan: EquipmentManagementPlan; packet: PublicMutationPacket
}
function check(v: unknown, code: string): asserts v { if (!v) throw Error(`MANAGEMENT_EQUIPMENT_RECORD_${code}`) }
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === [...keys].sort().join(), 'FIELDS')
}
function uint(v: unknown, positive = false): asserts v is string {
  check(typeof v === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= (1n << 64n) - 1n && (!positive || BigInt(v) > 0n), 'U64')
}
function digest(v: unknown): asserts v is string {
  check(typeof v === 'string' && v.length <= 44 && fromBase58(v).length === 32 && toBase58(fromBase58(v)) === v, 'DIGEST')
}
function bytes(v: unknown, max: number) {
  check(typeof v === 'string' && v.length <= Math.ceil(max / 3) * 4, 'BYTE_BOUND')
  const result = fromBase64(v); check(result.length > 0 && result.length <= max && toBase64(result) === v, 'BYTES'); return result
}
/** Structural original-packet validation. No ABI rebinding, signature authority,
 * finality or current ownership is inferred. Historical records of another
 * schema are never migrated/rebuilt through this parser. Previous Item metadata
 * additionally needs original historical state proof before a business outcome
 * can be claimed; this parser alone does not authenticate that old state. */
export function parseEquipmentManagementRecord(input: unknown): EquipmentManagementRecord {
  const r = structuredClone(input) as EquipmentManagementRecord
  exact(r, ['schema', 'plan', 'packet']); check(r.schema === 'soulidity.equipment-account-mutation.v1', 'SCHEMA')
  r.plan = parseEquipmentManagementPlan(r.plan); const p = r.plan, packet = r.packet
  exact(packet, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature']); uint(packet.expirationEpoch); digest(packet.digest)
  check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(packet.phase), 'PHASE')
  if (packet.signature !== null) bytes(packet.signature, 24576)
  check(packet.phase !== 'SIGNED' || packet.signature !== null, 'SIGNATURE_REQUIRED')
  check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(packet.phase) || packet.signature === null, 'UNEXPECTED_SIGNATURE')
  const encoded = bytes(packet.bytes, 128 * 1024), raw = bcs.TransactionData.parse(encoded)
  check(toBase64(bcs.TransactionData.serialize(raw).toBytes()) === packet.bytes
    && TransactionDataBuilder.getDigestFromBytes(encoded) === packet.digest, 'PACKET_BYTES')
  const actual = Transaction.from(encoded).getData()
  check(actual.sender === p.author && actual.gasData.owner === p.author && raw.V1
    && String(raw.V1.expiration.Epoch) === packet.expirationEpoch, 'PACKET_SCOPE')
  uint(actual.gasData.budget, true); uint(actual.gasData.price, true)
  assertBusinessTransactionGraph({ actual, template: buildEquipmentManagementTransaction(p).transaction.getData(),
    excludedCommandIndices: [], errorPrefix: 'MANAGEMENT_EQUIPMENT_GRAPH' })
  const owned = new Set([p.accountId, ...(p.action.kind !== 'REMOVE' ? [p.action.itemId] : [])])
  for (const input of actual.inputs) {
    if (input.Pure) continue
    const object = input.Object
    if (object?.ImmOrOwnedObject) {
      check(owned.has(object.ImmOrOwnedObject.objectId), 'OWNED_ROLE'); uint(object.ImmOrOwnedObject.version, true); digest(object.ImmOrOwnedObject.digest)
    } else {
      const shared = object?.SharedObject
      check(shared && shared.objectId === p.kioskId && shared.mutable, 'SHARED_ROLE'); uint(shared.initialSharedVersion, true)
    }
  }
  const gas = actual.gasData.payment
  check(gas && gas.length > 0 && gas.length <= 256 && new Set(gas.map(row => row.objectId)).size === gas.length, 'GAS')
  const forbidden = new Set([p.soulId, p.applicationId, p.accountId, p.kioskId, p.author, ...(p.previous.kind === 'ITEM' ? [p.previous.itemId] : []),
    ...owned, ...[p.target.application, p.target.model].flatMap(pin => [pin.originalPackageId, pin.callablePackageId])])
  for (const coin of gas) {
    check(/^0x[0-9a-f]{64}$/.test(coin.objectId) && !/^0x0+$/.test(coin.objectId) && !forbidden.has(coin.objectId), 'GAS_ALIAS')
    uint(coin.version, true); digest(coin.digest)
  }
  return r
}
/** Upgrade/action-independent slot: an unresolved original signed intent cannot
 * be bypassed by changing equipment action/part or upgrading callable code. */
export function equipmentManagementKey(input: EquipmentManagementPlan) {
  const p = parseEquipmentManagementPlan(input)
  return `soulidity.equipment-account-mutation.v1:${p.target.chainIdentifier}:${p.target.application.originalPackageId}:${p.soulId}:${p.author}`
}
/** Cryptographic original-byte signature check, independent of current ABI so
 * historical recovery can verify its old packet. Not proof of current custody,
 * execution/finality or a successful business outcome. */
export async function verifyEquipmentManagementSignature(input: EquipmentManagementRecord, client?: SuiGrpcClient) {
  const record = parseEquipmentManagementRecord(input)
  check(record.packet.signature, 'SIGNATURE_REQUIRED')
  await verifyTransactionSignature(fromBase64(record.packet.bytes), record.packet.signature, { address: record.plan.author, client })
  return { digest: record.packet.digest, author: record.plan.author, signatureVerified: true as const, finalizedBusinessReceipt: false as const }
}
