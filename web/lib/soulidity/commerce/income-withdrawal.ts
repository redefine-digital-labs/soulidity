import { Transaction } from '@mysten/sui/transactions'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { deriveDynamicFieldID, normalizeStructTag } from '@mysten/sui/utils'
import { commerceCheck, commerceId, decodeCommerce, readCommerceObject, type readEconomicsIncome } from './economics-read'
import { IncomeReceiptFieldBcs, IncomeRequestBcs } from './economics-bcs'
import { readPinnedMovePackageOrigins } from '../../sui/pinned-move-package'

type IncomeSnapshot = Awaited<ReturnType<typeof readEconomicsIncome>>
function attemptBytes(attempt: Uint8Array) {
  commerceCheck(attempt instanceof Uint8Array && attempt.length === 32 && attempt.some(v => v !== 0), 'WITHDRAW_ATTEMPT')
}

/** Only constructs an unsigned transaction. Re-read Admin, original saved
 * bytes/digest and chain before signing. Unknown attempts query their original
 * transaction and receipt; never rebuild against a newer ledger revision.
 * No enabled/paused gate: economics::withdraw_income is a recovery exit.
 */
export function buildIncomeWithdrawal(snapshot: IncomeSnapshot, input: {
  actor: string; recipient: string; amount: bigint; attempt: Uint8Array; configInitialSharedVersion?: string
}) {
  const s = structuredClone(snapshot), request = structuredClone(input)
  attemptBytes(request.attempt)
  commerceCheck(s.authority?.actor === request.actor && commerceId(request.actor) && commerceId(request.recipient), 'WITHDRAW_AUTHORITY')
  commerceCheck(typeof request.amount === 'bigint' && request.amount > 0n && request.amount <= BigInt(s.ledger.balance)
    && request.amount <= 18446744073709551615n, 'WITHDRAW_AMOUNT')
  commerceCheck(request.configInitialSharedVersion === undefined || /^[1-9][0-9]{0,19}$/.test(request.configInitialSharedVersion) && BigInt(request.configInitialSharedVersion) <= 18446744073709551615n, 'WITHDRAW_CONFIG_BIRTH')
  const tx = new Transaction()
  tx.setSender(request.actor)
  tx.moveCall({ target: `${s.target.foundation.callablePackageId}::economics::withdraw_income`, typeArguments: [s.coinType], arguments: [
    (request.configInitialSharedVersion === undefined ? tx.object(s.target.configId) : tx.sharedObjectRef({ objectId: s.target.configId, initialSharedVersion: request.configInitialSharedVersion, mutable: true })), tx.objectRef({ objectId: s.authority.objectId, version: s.authority.version, digest: s.authority.digest }),
    tx.pure.u64(s.ledger.revision), tx.pure.u64(request.amount), tx.pure.address(request.recipient), tx.pure.vector('u8', Array.from(request.attempt)),
  ] })
  return tx
}

/** Ledger request lookup is durable duplicate-withdrawal evidence, not a
 * substitute for authenticating the saved transaction effects/finality.
 * A transport failure never means the receipt is absent.
 */
export async function readIncomeWithdrawalReceipt(input: { client: SuiGrpcClient; snapshot: IncomeSnapshot;
  actor: string; attempt: Uint8Array; signal: AbortSignal }) {
  const s = structuredClone(input.snapshot), attempt = input.attempt.slice(), actor = input.actor, signal = input.signal
  const ledger = input.client.ledgerService
  const client = { ledgerService: { getObject: ledger.getObject.bind(ledger) } } as unknown as SuiGrpcClient
  attemptBytes(attempt); commerceCheck(commerceId(actor), 'WITHDRAW_ACTOR')
  const origins = await readPinnedMovePackageOrigins(client, s.target.foundation, signal)
  const requestOrigin = origins.get('revenue::Request'), receiptOrigin = origins.get('revenue::Receipt')
  commerceCheck(requestOrigin && receiptOrigin, 'REVENUE_ORIGIN')
  const keyType = `${requestOrigin}::revenue::Request`, valueType = `${receiptOrigin}::revenue::Receipt`
  const key = { actor, attempt }, table = s.ledger.requestsTableId
  const id = deriveDynamicFieldID(table, keyType, IncomeRequestBcs.serialize(key).toBytes())
  let object
  try { object = await readCommerceObject(client, id,
    normalizeStructTag(`0x2::dynamic_field::Field<${keyType},${valueType}>`), signal) }
  catch (error) {
    signal.throwIfAborted()
    if (error && typeof error === 'object' && 'code' in error && error.code === 'NOT_FOUND') return { status: 'MISSING' as const }
    throw error
  }
  commerceCheck(object.owner.ObjectOwner === table, 'RECEIPT_PARENT')
  const row = decodeCommerce(IncomeReceiptFieldBcs, object.contents), r = row.value
  commerceCheck(row.id === id && row.name.actor === actor && row.name.attempt.length === attempt.length
    && row.name.attempt.every((v, i) => v === attempt[i]) && r.root === s.target.configId && r.actor === actor
    && r.attempt.length === attempt.length && r.attempt.every((v, i) => v === attempt[i])
    && commerceId(r.recipient) && BigInt(r.amount) > 0n && BigInt(r.after_revision) === BigInt(r.before_revision) + 1n
    && BigInt(r.total_withdrawn) >= BigInt(r.amount)
    && BigInt(r.total_collected) - BigInt(r.total_withdrawn) === BigInt(r.balance), 'WITHDRAW_RECEIPT')
  return { status: 'FOUND' as const, receipt: r, object: { id, version: object.version, digest: object.digest },
    notTransactionProof: true as const }
}
