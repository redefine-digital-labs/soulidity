import { Transaction } from '@mysten/sui/transactions'
import { fromBase64, normalizeStructTag, toHex } from '@mysten/sui/utils'
import { publicMutationCanonical, type PublicMutationPacket } from '../../sui/public-mutation-journal'
import { commerceCheck } from './economics-read'
import { importMakerProductIncomeRecoveryRecord } from './maker-product-income-recovery-record'
import { assertMakerProductIncomeSimulationInputs } from './maker-product-income-simulation'
import type { MakerProductIncomeHostRequest, MakerProductIncomeHostResult, MakerProductIncomeRecovery } from '../maker-product-income-host'
export { MakerProductIncomeRecoveryError } from '../maker-product-income-host'
import { makerProductIncomeFundKey } from '../maker-product-income-journal'

/** Exact returned original + request + enabled simulation, not a proof that a
 * caller-supplied Host really owns the Root lock/journal or source activation.
 */
export function validateMakerProductIncomeHostResult(request: MakerProductIncomeHostRequest, result: MakerProductIncomeHostResult) {
  const original = importMakerProductIncomeRecoveryRecord(result.retainedText), p = result.preflight?.prepared
  commerceCheck(p && result.preflight.notSignedOrExecuted === true && result.preflight.postSimulationInputsRechecked === true
    && original.packet.phase === 'PREPARED' && original.packet.signature === null, 'MAKER_INCOME_HOST_UNSIGNED_RESULT')
  commerceCheck(publicMutationCanonical(original) === publicMutationCanonical(p.record)
    && publicMutationCanonical(original.packet) === publicMutationCanonical(p.packet), 'MAKER_INCOME_HOST_ORIGINAL_MISMATCH')
  commerceCheck(publicMutationCanonical(original.target) === publicMutationCanonical(request.target)
    && original.intent.actor === request.actor && original.intent.controlId === request.controlId
    && original.intent.recipient === request.recipient && original.intent.amount === request.amount
    && original.intent.revision === request.reviewed.ledger.revision && original.intent.attemptHex === toHex(request.attempt)
    && original.packet.expirationEpoch === request.expirationEpoch
    && publicMutationCanonical(p.reviewedGas) === publicMutationCanonical(request.gas)
    && publicMutationCanonical(p.reviewed) === publicMutationCanonical(request.reviewed), 'MAKER_INCOME_HOST_SELECTION_MISMATCH')
  const gas = Transaction.from(fromBase64(original.packet.bytes)).getData().gasData
  commerceCheck(gas.owner === request.actor && gas.budget === request.gas.budget && gas.price === request.gas.price
    && publicMutationCanonical(gas.payment) === publicMutationCanonical(request.gas.coins), 'MAKER_INCOME_HOST_GAS_MISMATCH')
  const simulation = result.preflight.simulation
  commerceCheck(simulation.checksRequested === 'ENABLED' && simulation.gasReselection === false
    && simulation.transactionDigest === original.packet.digest, 'MAKER_INCOME_HOST_SIMULATION_MISMATCH')
  assertMakerProductIncomeSimulationInputs(simulation, request.reviewed)
  return { text: result.retainedText, digest: original.packet.digest, amount: original.intent.amount,
    recipient: original.intent.recipient, coinType: normalizeStructTag(original.target.coinType),
    notSignedOrExecuted: true as const, notPersistenceProof: true as const, notWithdrawalEvidence: true as const }
}
/** A previous actor/Control/recipient/package remains recoverable in the same
 * shared funds scope. Never reinterpret it as the requested new withdrawal.
 */
export function validateMakerProductIncomeHostRecovery(target: MakerProductIncomeHostRequest['target'], recovery: MakerProductIncomeRecovery) {
  const saved = structuredClone(recovery), original = importMakerProductIncomeRecoveryRecord(saved.text)
  commerceCheck(saved.digest === original.packet.digest && ['CONFIRMED', 'UNCONFIRMED'].includes(saved.durability)
    && ['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RETIRED'].includes(saved.headPhase)
    && makerProductIncomeFundKey(original.target) === makerProductIncomeFundKey(target), 'MAKER_INCOME_HOST_RECOVERY_SCOPE')
  return { ...saved, actor: original.intent.actor, recipient: original.intent.recipient, amount: original.intent.amount }
}
