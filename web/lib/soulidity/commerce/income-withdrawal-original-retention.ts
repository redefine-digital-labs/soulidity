import {publicMutationCanonical} from '../../sui/public-mutation-journal'
import {commerceCheck} from './economics-read'
import {parseIncomeWithdrawalRecoveryRecord,type IncomeWithdrawalRecoveryRecord} from './income-withdrawal-recovery-record'
/** A single original-record slot in the MAIN-OWNED journal. Caller must hold
 * its existing operation lock throughout this function and readback. No key,
 * lock, store, history replacement or signing lifecycle is created here. */
export interface IncomeWithdrawalOriginalSlot{
 read():unknown|Promise<unknown>
 write(record:IncomeWithdrawalRecoveryRecord):void|Promise<void>
}
/** Retain only this exact original. Never overwrite a different or advanced
 * record. Matching readback is local storage evidence, not exclusion of other
 * slots, external signatures, unknown broadcasts, authorization or finality. */
export async function retainPreparedIncomeWithdrawalOriginal(input:{slot:IncomeWithdrawalOriginalSlot;record:unknown;signal:AbortSignal}){
 const record=parseIncomeWithdrawalRecoveryRecord(input.record),canonical=publicMutationCanonical(record),read=input.slot.read.bind(input.slot),write=input.slot.write.bind(input.slot),signal=input.signal
 commerceCheck(record.packet.phase==='PREPARED'&&record.packet.signature===null,'WITHDRAW_RETAIN_PREPARED_ONLY');signal.throwIfAborted()
 const before=await read();signal.throwIfAborted()
 if(before!==null){const existing=parseIncomeWithdrawalRecoveryRecord(before);commerceCheck(publicMutationCanonical(existing)===canonical,'WITHDRAW_RETAIN_ORIGINAL_CONFLICT')}
 else{
  // No abort race or early lock release: an in-flight write must settle.
  await write(structuredClone(record))
 }
 // Complete readback even when canceled during a settled write. A readback
 // failure never permits an automatic replacement original or a repeat write.
 const after=parseIncomeWithdrawalRecoveryRecord(await read())
 commerceCheck(publicMutationCanonical(after)===canonical,'WITHDRAW_RETAIN_READBACK_MISMATCH');signal.throwIfAborted()
 return {record,retention:'HOST_ORIGINAL_SLOT_READBACK_MATCHED' as const,alreadyPresent:before!==null,
  requiresHostOriginalOperationLock:true as const,notUnknownOperationExclusion:true as const,notSigningQualification:true as const,notWithdrawalEvidence:true as const}
}
