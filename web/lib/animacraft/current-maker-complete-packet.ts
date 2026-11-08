import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { buildCurrentMakerComplete, type CurrentCompleteInput } from './current-maker-complete'
import { assertBusinessTransactionGraph } from '../sui/business-transaction-graph'
import { parseWalrusBatchParentPacket } from '../upload/walrus-batch-store'
import { walrusBatchKeys } from '../upload/walrus-batch-shape'
import { publicMutationCanonical, runPublicMutation, type PublicMutationPacket, type PublicMutationJournal, type PublicMutationQuery } from '../sui/public-mutation-journal'

export interface CurrentCompletePacketRecord {
  schema: 'animacraft.current-complete-packet.v1'
  plan: CurrentCompleteInput
  packet: PublicMutationPacket
}
const check = (v: unknown, detail: string) => { if (!v) throw Error(`CURRENT_COMPLETE_PACKET_INVALID: ${detail}`) }
export function currentCompletePacketKey(plan: CurrentCompleteInput) {
  buildCurrentMakerComplete(plan)
  return `animacraft.current-complete-packet.v1:${plan.target.chainIdentifier}:${plan.target.runtime.originalPackageId}:${plan.actor}:${plan.maker.productId}:${plan.attempt}`
}
/** New current schema only. Exact business graph and local packet identity,
 * never live object/ABI references, signature validity or execution proof.
 * Legacy signed/paid/unknown records retain their original parser/controller. */
export function parseCurrentCompletePacket(input: unknown): CurrentCompletePacketRecord {
  const r = structuredClone(input) as CurrentCompletePacketRecord
  walrusBatchKeys(r, ['schema', 'plan', 'packet']); check(r.schema === 'animacraft.current-complete-packet.v1', 'schema')
  const expected = buildCurrentMakerComplete(r.plan), p = r.packet
  walrusBatchKeys(p, ['bytes', 'digest', 'expirationEpoch', 'phase', 'signature'])
  parseWalrusBatchParentPacket({ bytes: p.bytes, digest: p.digest }, r.plan.actor)
  const raw = bcs.TransactionData.parse(fromBase64(p.bytes)).V1!
  check(typeof p.expirationEpoch === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(p.expirationEpoch)
    && BigInt(p.expirationEpoch) <= 18446744073709551615n && String(raw.expiration.Epoch) === p.expirationEpoch, 'expiration')
  check(BigInt(raw.gasData.budget) > 0n && BigInt(raw.gasData.price) > 0n && raw.gasData.payment.length > 0, 'gas')
  check(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(p.phase), 'phase; retirement needs separate authenticated checkpoint')
  check(p.signature === null || typeof p.signature === 'string' && p.signature.length > 0 && p.signature.length <= 32768
    && toBase64(fromBase64(p.signature)) === p.signature, 'signature encoding')
  check(p.phase !== 'SIGNED' || p.signature !== null, 'signature required')
  check(!['PREPARED', 'SIGNING', 'CANCELLED'].includes(p.phase) || p.signature === null, 'unexpected signature')
  assertBusinessTransactionGraph({ actual: Transaction.from(fromBase64(p.bytes)).getData(), template: expected.getData(), excludedCommandIndices: [], errorPrefix: 'CURRENT_COMPLETE_PACKET' })
  return r
}
/** Read-only query-first recovery over the shared journal. Adapter query must
 * authenticate exact original digest/bytes and full final evidence before
 * returning terminal status. No current-state simulation on historical query. */
export async function queryCurrentCompletePacket<Q extends PublicMutationQuery>(input: {
  plan: CurrentCompleteInput; expectedPacket: { bytes: string; digest: string }
  store: PublicMutationJournal<CurrentCompletePacketRecord>
  query(record: CurrentCompletePacketRecord): Promise<Q>
}) {
  const { store, query } = input, plan = structuredClone(input.plan), expectedPacket = structuredClone(input.expectedPacket)
  const forbidden = async (): Promise<never> => { throw Error('CURRENT_COMPLETE_PACKET_READ_ONLY') }
  return runPublicMutation({ plan, expectedPacket, store, queryOnly: true, adapter: {
    query: record => { check(publicMutationCanonical(record.plan) === publicMutationCanonical(plan), 'original plan changed'); return query(record) }, prepare: forbidden, preflight: forbidden, sign: forbidden, verifySignature: forbidden, broadcast: forbidden,
  } }, { parse: parseCurrentCompletePacket, key: currentCompletePacketKey, errorPrefix: 'CURRENT_COMPLETE_PACKET' })
}
