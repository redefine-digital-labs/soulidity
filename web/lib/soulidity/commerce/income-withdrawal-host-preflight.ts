import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { publicMutationCanonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck } from './economics-read'
import { importIncomeWithdrawalRecoveryRecord } from './income-withdrawal-recovery-record'
import { assertIncomeWithdrawalSimulationInputs } from './income-withdrawal-simulation'
import type { preflightNewIncomeWithdrawal } from './income-withdrawal-preflight'

export type IncomeWithdrawalHostRequest = Omit<Parameters<typeof preflightNewIncomeWithdrawal>[0], 'onPreparedOriginal' | 'executionRegistry'>
export type IncomeWithdrawalHostResult = { preflight: Awaited<ReturnType<typeof preflightNewIncomeWithdrawal>>; retainedText: string }
export type IncomeWithdrawalHostPreflight = (input: IncomeWithdrawalHostRequest) => Promise<IncomeWithdrawalHostResult>
export interface IncomeWithdrawalHostRecovery { text: string; digest: string; headPhase: PublicMutationPacket['phase']; durability: 'CONFIRMED' | 'UNCONFIRMED' }
export class IncomeWithdrawalHostRecoveryError extends Error {
  constructor(message: string, readonly recovery: IncomeWithdrawalHostRecovery, options?: ErrorOptions) {
    super(message, options); this.name = 'IncomeWithdrawalHostRecoveryError'
  }
}
/** Exact returned original + request + enabled simulation, not a proof that a
 * caller-supplied Host really owns the Root lock/journal or source activation.
 */
export function validateIncomeWithdrawalHostResult(request: IncomeWithdrawalHostRequest, result: IncomeWithdrawalHostResult) {
  const original = importIncomeWithdrawalRecoveryRecord(result.retainedText), p = result.preflight?.prepared
  commerceCheck(p && result.preflight.notSignedOrExecuted === true && result.preflight.postSimulationInputsRechecked === true
    && original.packet.phase === 'PREPARED' && original.packet.signature === null, 'WITHDRAW_HOST_UNSIGNED_RESULT')
  commerceCheck(publicMutationCanonical(original) === publicMutationCanonical(p.record)
    && publicMutationCanonical(original.packet) === publicMutationCanonical(p.packet), 'WITHDRAW_HOST_ORIGINAL_MISMATCH')
  commerceCheck(publicMutationCanonical(original.target) === publicMutationCanonical(request.target)
    && original.intent.actor === request.actor && original.intent.adminId === request.adminId
    && original.intent.recipient === request.recipient && original.intent.amount === request.amount
    && original.intent.revision === request.reviewed.ledger.revision && original.intent.attemptHex === toHex(request.attempt)
    && original.packet.expirationEpoch === request.expirationEpoch
    && publicMutationCanonical(p.reviewedGas) === publicMutationCanonical(request.gas)
    && publicMutationCanonical(p.reviewed) === publicMutationCanonical(request.reviewed), 'WITHDRAW_HOST_SELECTION_MISMATCH')
  const gas = Transaction.from(fromBase64(original.packet.bytes)).getData().gasData
  commerceCheck(gas.owner === request.actor && gas.budget === request.gas.budget && gas.price === request.gas.price
    && publicMutationCanonical(gas.payment) === publicMutationCanonical(request.gas.coins), 'WITHDRAW_HOST_GAS_MISMATCH')
  const simulation = result.preflight.simulation
  commerceCheck(simulation.checksRequested === 'ENABLED' && simulation.gasReselection === false
    && simulation.transactionDigest === original.packet.digest, 'WITHDRAW_HOST_SIMULATION_MISMATCH')
  assertIncomeWithdrawalSimulationInputs(simulation, request.reviewed)
  return { text: result.retainedText, digest: original.packet.digest, amount: original.intent.amount,
    recipient: original.intent.recipient, coinType: normalizeStructTag(original.target.coinType),
    notSignedOrExecuted: true as const, notPersistenceProof: true as const, notWithdrawalEvidence: true as const }
}
/** A previous actor/Admin/recipient/package remains recoverable in the same
 * shared funds scope. Never reinterpret it as the requested new withdrawal.
 */
export function validateIncomeWithdrawalHostRecovery(target: IncomeWithdrawalHostRequest['target'], recovery: IncomeWithdrawalHostRecovery) {
  const saved = structuredClone(recovery), original = importIncomeWithdrawalRecoveryRecord(saved.text)
  commerceCheck(saved.digest === original.packet.digest && ['CONFIRMED', 'UNCONFIRMED'].includes(saved.durability)
    && ['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(saved.headPhase)
    && original.target.chainIdentifier === target.chainIdentifier && original.target.configId === target.configId
    && normalizeStructTag(original.target.coinType) === normalizeStructTag(target.coinType), 'WITHDRAW_HOST_RECOVERY_SCOPE')
  return { ...saved, actor: original.intent.actor, recipient: original.intent.recipient, amount: original.intent.amount }
}
