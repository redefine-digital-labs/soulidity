'use client'
import {useCallback,useMemo} from 'react'
import {useCommittedSession} from '@/lib/hooks/use-committed-session'
import type {executeNativePublicReadPaidOriginalV2} from '@/lib/soulidity/native-public-read-paid-execution-v2'
import {browserNativePublicReadPaidOriginalReaderV2,nativePublicReadPaidKeyV2} from '@/lib/soulidity/native-public-read-paid-journal-v2'
import {useWalletSign} from '@/lib/hooks/use-wallet-sign'
import {withPackageObjectIdentity} from '@/lib/sui/package-object-client'
import {publicMutationCanonical} from '@/lib/sui/public-mutation-journal'
import {parseCanonicalNativeWorkbenchTarget} from '@/lib/soulidity/canonical-native-workbench'
import {createNativePublicReadPaidHostPreflightV2} from '@/lib/soulidity/native-public-read-paid-host-v2'
import {reviewNativePublicReadPaidInputsV2} from '@/lib/soulidity/commerce/native-public-read-paid-input-provider-v2'
import type {NativePublicReadPaidHostRequestV2} from '@/lib/soulidity/commerce/native-public-read-paid-host-preflight-v2'
import {NativePublicReadPaidPreflightV2,type NativePublicReadPaidPreflightInputV2} from '@/components/commerce/native-public-read-paid-preflight'

/** Explicit Root source/release approval and selected resources use this contract. The
 * read release alone cannot construct economics, funding or source approval. */
export interface NativePublicReadPaidPurchaseSelectionV2 {
 sourceKey:string
 activationKey:string
 disabledReason:string|null
 input:NativePublicReadPaidPreflightInputV2
 execution?:Pick<Parameters<typeof executeNativePublicReadPaidOriginalV2>[0],'isCurrent'|'qualifySource'>
}
interface PurchaseProps {
 soulId:string;index:number;kind:number;contentScope:string;releaseJson:string;sourceKey:string;selection:NativePublicReadPaidPurchaseSelectionV2|null
}
export function NativePublicReadPaidPurchaseV2(props:PurchaseProps){
 if(!props.selection)return <p>内容购买预检尚未开放。</p>
 return <SelectedNativePublicReadPaidPurchaseV2 {...props} selection={props.selection}/>
}
function SelectedNativePublicReadPaidPurchaseV2({soulId,index,kind,contentScope,releaseJson,sourceKey,selection}:Omit<PurchaseProps,'selection'>&{selection:NativePublicReadPaidPurchaseSelectionV2}){
 const wallet=useWalletSign(),host=useMemo(()=>createNativePublicReadPaidHostPreflightV2({inputReviewer:reviewNativePublicReadPaidInputsV2}),[])
 const source=wallet.suiGrpcClient
 const buyer=wallet.suiWallet?.address??null
 const authority=useMemo(()=>({wallet:wallet.currentWallet,execution:selection.execution}),[wallet.currentWallet,selection.execution])
 const session=useCommittedSession(JSON.stringify([sourceKey,selection.activationKey,selection.disabledReason,selection.input],
  (_key,value)=>typeof value==='bigint'?String(value):value),wallet.walletAccount??buyer,source,authority)
 const client=useCallback((signal:AbortSignal)=>withPackageObjectIdentity(source,signal),[source])
 const hostPreflight=useCallback((request:NativePublicReadPaidHostRequestV2)=>{
  const execution=selection.execution
  if(!execution)return host(request)
  const lease=session.capture()
  return host({...request,getBuyerAddress:()=>lease?.matches()===true&&execution.isCurrent()
   &&wallet.getWalletAddress()===request.qualification.buyer?request.getBuyerAddress():null})
 },[host,selection.execution,session,wallet.getWalletAddress])
 const executeOriginal=useCallback(async(text:string,signal:AbortSignal)=>{
  const lease=session.capture(),execution=selection.execution,q=selection.input.qualification
  const current=()=>!signal.aborted&&lease?.matches()===true&&execution?.isCurrent()===true&&wallet.getWalletAddress()===q.buyer
  if(!execution||!current())throw Error('购买会话或发布资格已变更。')
  const key=nativePublicReadPaidKeyV2({chainIdentifier:q.economics.chainIdentifier,soulId:q.soulId,author:q.buyer})
  const selected=await browserNativePublicReadPaidOriginalReaderV2().read(key)
  if(!selected||selected.plan.originalText!==text||!current())throw Error('原购买记录或当前钱包已变更。')
  const {executeNativePublicReadPaidOriginalV2:execute}=await import('@/lib/soulidity/native-public-read-paid-execution-v2')
  if(!current())throw Error('购买会话或发布资格已变更。')
  return execute({selected,qualification:{...q,client:client(signal),signal},isCurrent:current,getBuyerAddress:wallet.getWalletAddress,
   qualifySource:proof=>execution.qualifySource(proof),sign:tx=>wallet.signTransaction(tx,{retainReturnedSignature:true})})
 },[selection,session,client,wallet.getWalletAddress,wallet.signTransaction])
 if(!source)return <p>请连接本次购买的钱包。</p>
 let mismatch=false
 try{
  const q=selection.input.qualification
  mismatch=selection.sourceKey!==sourceKey||q.soulId!==soulId||q.recordIndex!==index||q.kind!==kind||q.requiredScope!==BigInt(contentScope)
   ||publicMutationCanonical(q.target)!==publicMutationCanonical(parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson)))
 }catch{mismatch=true}
 const releaseUnavailable=selection.execution&&!selection.execution.isCurrent()?'此发布的内容购买暂不可用。':null
 return <NativePublicReadPaidPreflightV2 client={client} input={selection.input} viewerAddress={wallet.suiWallet?.address??null}
  activationKey={selection.activationKey} releaseJson={releaseJson} sourceKey={sourceKey} disabledReason={selection.disabledReason||releaseUnavailable||(mismatch?'购买输入与当前内容版本不一致。':null)} hostPreflight={hostPreflight} executeOriginal={selection.execution?executeOriginal:null}/>
}
