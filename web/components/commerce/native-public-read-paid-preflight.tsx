'use client'

import React,{useLayoutEffect,useRef,useState} from 'react'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {validateNativePublicReadPaidHostResultV2,type NativePublicReadPaidHostRequestV2,type NativePublicReadPaidHostPreflightV2} from '../../lib/soulidity/commerce/native-public-read-paid-host-preflight-v2'
import {NativePublicReadPaidHostRecoveryErrorV2,type NativePublicReadPaidRecoveryV2} from '../../lib/soulidity/native-public-read-paid-host-v2'
import {parsePurchaseRecoveryOriginal} from '../../lib/soulidity/commerce/purchase-recovery-original'
import type {executeNativePublicReadPaidOriginalV2} from '../../lib/soulidity/native-public-read-paid-execution-v2'
import {parseSoulAccessRecord} from '../../lib/soulidity/soul-access-operation'
export type NativePublicReadPaidPreflightInputV2=Omit<NativePublicReadPaidHostRequestV2,'qualification'|'getBuyerAddress'>&{
 qualification:Omit<NativePublicReadPaidHostRequestV2['qualification'],'client'|'signal'>}
type Client=SuiGrpcClient|((signal:AbortSignal)=>SuiGrpcClient)
type ExecuteOriginal=(text:string,signal:AbortSignal)=>ReturnType<typeof executeNativePublicReadPaidOriginalV2>
type RecoveredFunding = { total: string; coinType: string; paymentId: string; gasIds: string[]; gasBudget: string }
type Validated=Awaited<ReturnType<typeof validateNativePublicReadPaidHostResultV2>>
/** Actual unsigned preflight consumer. Main owns current release activation,
 * wallet selection, current reviewed Record/funding and its durable host/lock.
 * No local persistence, direct preflight fallback, wallet signer or submitter. */
export function NativePublicReadPaidPreflightV2({client,input,viewerAddress,activationKey,disabledReason,hostPreflight,executeOriginal=null}:{
 client:Client;input:NativePublicReadPaidPreflightInputV2;viewerAddress:string|null;activationKey:string;disabledReason:string|null;hostPreflight:NativePublicReadPaidHostPreflightV2|null;executeOriginal?:ExecuteOriginal|null
}){
 const scope=JSON.stringify([input,viewerAddress,activationKey,disabledReason],(_k,v)=>typeof v==='bigint'?{bigint:String(v)}:v)
 const current=useRef({scope,client,hostPreflight,viewerAddress,executeOriginal});current.current={scope,client,hostPreflight,viewerAddress,executeOriginal}
 const serial=useRef(0),active=useRef<AbortController|null>(null)
 const executing=useRef<AbortController|null>(null)
 const [dispatch,setDispatch]=useState({scope,pending:false,message:''})
 // React may batch multiple clicks before committing pending/attempted state.
 // Claim the attempt synchronously; stop/error/success never release it.
 const attempt=useRef<{scope:string;client:Client;host:NativePublicReadPaidHostPreflightV2}|null>(null)
 const empty=()=>({scope,client,hostPreflight,pending:false,attempted:false,stopped:false,result:null as Validated|null,error:null as string|null,recovery:null as NativePublicReadPaidRecoveryV2|null,recoveredFunding:null as RecoveredFunding|null})
 const [state,setState]=useState(empty)
 useLayoutEffect(()=>{serial.current++;active.current?.abort();setState(empty());setDispatch({scope,pending:false,message:''});return()=>{serial.current++;active.current?.abort();executing.current?.abort();executing.current=null}},[scope,client,hostPreflight,executeOriginal])
 const view=state.scope===scope&&state.client===client&&state.hostPreflight===hostPreflight?state:empty()
 const decision=input.reviewed.decision.action
 const eligibility=decision==='REUSE_OWNER'||decision==='REUSE_ENTRY'?'已有内容资格可复用，无需重复购买。':decision!=='PURCHASE_REQUIRED'||!input.reviewed.quote||input.reviewed.purchaseBlockers.length?'当前内容购买条件尚未满足。':null
 const unavailable=disabledReason||eligibility||(!activationKey?'此发布尚未开放内容购买预检。':!hostPreflight?'原购买恢复服务尚未就绪。':viewerAddress!==input.qualification.buyer?'请连接本次购买的钱包。':null)
 async function prepare(){
  if(unavailable||!hostPreflight||view.pending||view.attempted)return
  const host=hostPreflight
  if(current.current.scope!==scope||current.current.client!==client||current.current.hostPreflight!==host)return
  if(attempt.current?.scope===scope&&attempt.current.client===client&&attempt.current.host===host)return
  attempt.current={scope,client,host}
  const id=++serial.current,controller=new AbortController();active.current?.abort();active.current=controller
  const valid=()=>serial.current===id&&!controller.signal.aborted&&current.current.scope===scope&&current.current.client===client&&current.current.hostPreflight===host
  setState({...empty(),pending:true,attempted:true})
  try{
   const values=structuredClone(input)
   const reader=typeof client==='function'?client(controller.signal):client
   const request:NativePublicReadPaidHostRequestV2={...values,qualification:{...values.qualification,client:reader,signal:controller.signal},getBuyerAddress:()=>valid()?current.current.viewerAddress:null}
   // Validation uses an independent snapshot: a host callback must not rewrite
   // the reviewed selection while the asynchronous operation is in progress.
   const checked={...structuredClone(values),qualification:{...structuredClone(values.qualification),client:reader,signal:controller.signal},getBuyerAddress:request.getBuyerAddress}
   const result=await host(request);if(!valid())return
   const verified=await validateNativePublicReadPaidHostResultV2(checked,result);if(valid())setState(s=>valid()&&s.scope===scope&&s.client===client&&s.hostPreflight===host?{...s,pending:false,result:verified}:s)
  }catch(error){
   let recovery:NativePublicReadPaidRecoveryV2|null=null
   let recoveredFunding:RecoveredFunding|null=null
   if(valid()&&error instanceof NativePublicReadPaidHostRecoveryErrorV2){
    try{
     const value=structuredClone(error.recovery)
     if(value.soulId!==input.qualification.soulId||!['CONFIRMED','UNCONFIRMED'].includes(value.durability))throw Error('RECOVERY_SCOPE')
     if(value.format==='native-public-read-v2'){
      const original=await parsePurchaseRecoveryOriginal(value.text,value.soulId)
      if(original.kind!=='native-public-read-v2'||original.value.intent.buyer!==input.qualification.buyer||original.value.packet.digest!==value.digest)throw Error('RECOVERY_ORIGINAL')
      const {intent,reviewedGas}=original.value
      recoveredFunding={total:intent.quote.total,coinType:intent.coinType,paymentId:intent.paymentCoin.objectId,
       gasIds:reviewedGas.coins.map(coin=>coin.objectId),gasBudget:reviewedGas.budget}
     }else if(value.format==='soulidity.soul-access.v1'){
      const original=parseSoulAccessRecord(JSON.parse(value.text))
      if(original.plan.soulId!==value.soulId||original.plan.author!==input.qualification.buyer||original.packet.digest!==value.digest)throw Error('RECOVERY_ORIGINAL')
     }else throw Error('RECOVERY_FORMAT')
     recovery=value
    }catch{/* An invalid recovery payload never becomes a downloadable original. */}
   }
   const message=error instanceof Error?error.message:'购买预检未完成。'
   if(valid())setState(s=>valid()&&s.scope===scope&&s.client===client&&s.hostPreflight===host?{...s,pending:false,recovery,recoveredFunding,error:message}:s)
  }
 }
 const executableText=view.result?.text??(view.recovery?.format==='native-public-read-v2'&&view.recovery.durability==='CONFIRMED'?view.recovery.text:null)
 async function dispatchOriginal(){
  if(!executableText||!executeOriginal||unavailable||executing.current)return
  const request=new AbortController();executing.current=request
  const valid=()=>!request.signal.aborted&&executing.current===request&&current.current.scope===scope&&current.current.executeOriginal===executeOriginal
  setDispatch({scope,pending:true,message:''})
  try{
   const result=await executeOriginal(executableText,request.signal)
   const messages={MISSING:'本次未查到原结果，请先查询原购买记录。',PENDING:'已找到原交易，等待最终确认。',
    FAILED:'原交易已确认失败。',SUBSCRIPTION_RECORDED:'已核对原订阅和资金。请打开原购买恢复页，检查当前内容交付。'}
   if(valid())setDispatch({scope,pending:false,message:messages[result.original.status]})
  }catch(error){
   if(valid())setDispatch({scope,pending:false,message:error instanceof Error?error.message:'原购买未能确认，请核对原记录。'})
  }finally{if(executing.current===request)executing.current=null}
 }
 function stop(){serial.current++;active.current?.abort();setState(s=>({...s,pending:false,attempted:true,stopped:true,result:null,error:null,recovery:null,recoveredFunding:null}))}
 return <section aria-label="新增内容购买预检" className="space-y-3 rounded-xl border p-4">
  <h3 className="font-medium">核对新增内容购买</h3>
  <p>{input.reviewed.contentName} · 版本 {input.reviewed.contentVersion}</p>
  <p>所选范围：{String(input.qualification.requiredScope)} · 参考总价（最小单位）：{input.reviewed.quote?.total??'尚未核对'}</p>
  <p>保留原购买记录后核对所选内容、总价、付款 Coin、Gas 和模拟结果。本步骤不会签名或付款。</p>
  {unavailable&&<p role="status">{unavailable}</p>}
  <button type="button" disabled={Boolean(unavailable)||view.pending||view.attempted} onClick={()=>void prepare()} className="rounded border px-3 py-1">准备并模拟内容购买</button>
  {view.pending&&<><p role="status">正在核对购买条件并保留原记录…</p><button type="button" onClick={stop}>停止本页预检</button></>}
  {view.stopped&&<p role="status">本页预检已停止；原购买记录可能已保留。请先查询原记录，不能据此重新付款。</p>}
  {view.error==='NATIVE_PUBLIC_READ_PAID_HOST_V2_INPUT_REVIEW_QUOTE_CHANGED'
   ?<p role="alert">报价或购买条件已变化，请重新核对付款选项。</p>
   :view.error&&<p role="alert">预检未完成：{view.error}。原记录可能已保留，请先查询原记录；本页不会自动重试。</p>}
  {view.recovery&&<article aria-label="需恢复的原操作"><p>{view.recovery.durability==='CONFIRMED'?'已读回原操作记录，请先恢复原操作。':'原操作记录尚未确认保存，请下载并查询原记录。'}</p><p className="break-all">原交易：{view.recovery.digest}</p>
   {view.recoveredFunding&&<div className="break-all">
    <p>原总价 {view.recoveredFunding.total}（最小单位） · {view.recoveredFunding.coinType}</p>
    <p>原付款 Coin {view.recoveredFunding.paymentId}</p>
    <p>原 Gas 预算 {view.recoveredFunding.gasBudget} MIST</p>
    <ul aria-label="原 Gas Coins">{view.recoveredFunding.gasIds.map(id=><li key={id}>{id}</li>)}</ul>
   </div>}
   <a download={`${view.recovery.format==='native-public-read-v2'?'purchase':'soul-access'}-${view.recovery.digest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(view.recovery.text)}`}>{view.recovery.format==='native-public-read-v2'?'下载原购买 JSON':'下载原访问操作 JSON'}</a>
   {view.recovery.format==='soulidity.soul-access.v1'&&<p><a href={`/souls/${view.recovery.soulId}`}>打开原访问操作恢复</a></p>}
  </article>}
  {view.result&&<article aria-label="未签名内容购买原记录"><p>原记录返回核对与模拟已完成；交易尚未签名或执行，内容尚未交付。</p><p className="break-all">原交易：{view.result.digest}</p>
   <a download={`purchase-${view.result.digest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(view.result.text)}`}>下载本次未签名原购买 JSON</a>
   <p>原文件与本次所选内容、价格和资金引用已核对。实际购买仍需核对当前发布、权限和最终钱包条件。</p>
  </article>}
  {executeOriginal&&executableText&&<section aria-label="执行已保存的原购买">
   <button type="button" disabled={Boolean(unavailable)||dispatch.scope===scope&&(dispatch.pending||Boolean(dispatch.message))} onClick={()=>void dispatchOriginal()}>
    核对并签名发送原购买
   </button>
   {dispatch.scope===scope&&(dispatch.pending||dispatch.message)&&<p role="status">{dispatch.pending?'正在核对并继续原购买…':dispatch.message}</p>}
  </section>}
  <a href={`/souls/${input.qualification.soulId}/purchase/recovery`}>查询本 Soul 的原购买记录</a>
 </section>
}
