import { createManagementContainedHistorySession, type ManagementContainedHistoryInput } from './application-contained-history-session'
/** Bounded compatibility entry. Domain code must authenticate the original
 * tree and qualify parent-committed child writes; no generic recursive proof.
 * Long callers can explicitly retain a private session and advance in chunks. */
export async function readApplicationContainedHistoricalChild(input:ManagementContainedHistoryInput & {maxHops?:number}){
 const maxHops=input.maxHops??64
 if(!Number.isSafeInteger(maxHops)||maxHops<1||maxHops>256)throw Error('APPLICATION_CONTAINED_HISTORY_BOUND')
 const session=await createManagementContainedHistorySession(input)
 try{
  const result=await session.advance({maxHops})
  if(result.status==='PROVEN')return result.proof
  throw Error('APPLICATION_CONTAINED_HISTORY_HOP_BOUND')
 }finally{session.dispose()}
}
