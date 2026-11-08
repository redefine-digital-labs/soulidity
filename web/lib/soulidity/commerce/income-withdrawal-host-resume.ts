import { publicMutationCanonical } from '../../sui/public-mutation-journal'
import { commerceCheck, type EconomicsTarget } from './economics-read'
import { importIncomeWithdrawalRecoveryRecord } from './income-withdrawal-recovery-record'
import { assertIncomeWithdrawalSimulationInputs } from './income-withdrawal-simulation'
import { parseIncomeWithdrawalJournalRecordV1, type IncomeWithdrawalJournalRecordV1 } from '../income-withdrawal-journal-v1'
import type { executeIncomeWithdrawalOriginalV1 } from '../income-withdrawal-execution'
import type { recheckSelectedIncomeWithdrawalOriginalV1, retireIncomeWithdrawalOriginalV1 } from '../income-withdrawal-original-recovery'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

export interface IncomeWithdrawalResumeRequest {
  selected: IncomeWithdrawalJournalRecordV1; client: SuiGrpcClient; signal: AbortSignal
  getActorAddress: () => string | null; isCurrent: () => boolean; activationKey: string; sourceId: string
}
export type IncomeWithdrawalResumeResult = Awaited<ReturnType<typeof recheckSelectedIncomeWithdrawalOriginalV1>>
export type IncomeWithdrawalResumeHost = (input: IncomeWithdrawalResumeRequest) => Promise<IncomeWithdrawalResumeResult>
export type IncomeWithdrawalExecutionHost = (input: IncomeWithdrawalResumeRequest & Pick<Parameters<typeof executeIncomeWithdrawalOriginalV1>[0], 'sign'>) => ReturnType<typeof executeIncomeWithdrawalOriginalV1>
export interface IncomeWithdrawalResumeCapability {
  activationKey: string; sourceId: string; isActive: () => boolean
  client: (signal: AbortSignal) => SuiGrpcClient; host: IncomeWithdrawalResumeHost; execute?: IncomeWithdrawalExecutionHost
  retirement?: {
    canRetire: (target: EconomicsTarget) => boolean
    retire: (input: { selected: IncomeWithdrawalJournalRecordV1; signal: AbortSignal; isCurrent: () => boolean }) => ReturnType<typeof retireIncomeWithdrawalOriginalV1>
  }
}

/** Bind a trusted Root Host result to this exact selected original. Equality
 * is an internal consumer boundary, not independent source/signing proof.
 */
export async function validateIncomeWithdrawalResumeResult(selected: IncomeWithdrawalJournalRecordV1, result: IncomeWithdrawalResumeResult) {
  const expected = await parseIncomeWithdrawalJournalRecordV1(structuredClone(selected)), response = structuredClone(result)
  const original = importIncomeWithdrawalRecoveryRecord(expected.plan.originalText), checked = response.recheck, simulation = checked?.simulation
  commerceCheck(publicMutationCanonical(response.selected) === publicMutationCanonical(expected)
    && response.originalText === expected.plan.originalText && expected.packet.phase === 'PREPARED' && expected.packet.signature === null
    && publicMutationCanonical(checked?.record) === publicMutationCanonical(original) && checked.originalBytesUnchanged === true
    && checked.notSigningQualification === true && checked.notWithdrawalEvidence === true, 'WITHDRAW_RESUME_RETURN_ORIGINAL')
  commerceCheck(simulation?.transactionDigest === original.packet.digest && simulation.checksRequested === 'ENABLED'
    && simulation.gasReselection === false && simulation.notPaid === true && simulation.notFinalizedWithdrawalEvidence === true
    && simulation.notSigningQualification === true, 'WITHDRAW_RESUME_RETURN_SIMULATION')
  assertIncomeWithdrawalSimulationInputs(simulation, response.reviewed)
  return { digest: original.packet.digest, text: expected.plan.originalText, originalBytesUnchanged: true as const }
}
