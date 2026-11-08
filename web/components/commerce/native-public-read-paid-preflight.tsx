'use client'

import React,{useCallback,useLayoutEffect,useRef,useState} from 'react'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {validateNativePublicReadPaidHostResultV2,type NativePublicReadPaidHostRequestV2,type NativePublicReadPaidHostPreflightV2} from '../../lib/soulidity/commerce/native-public-read-paid-host-preflight-v2'
import {NativePublicReadPaidHostRecoveryErrorV2,type NativePublicReadPaidRecoveryV2} from '../../lib/soulidity/native-public-read-paid-host-v2'
import {parsePurchaseRecoveryOriginal,queryPurchaseRecoveryOriginal,type PurchaseRecoveryOriginal,type PurchaseRecoveryQuery} from '../../lib/soulidity/commerce/purchase-recovery-original'
import {paidContentScopeCovers} from '../../lib/soulidity/commerce/paid-content-policy'
import {nativePublicReadPaidSettlementMatchesV2} from '../../lib/soulidity/native-public-read-paid-journal-v2'
import {NativePublicPaidContentReaderV2} from '../souls/native-public-paid-content-reader-v2'
import type {executeNativePublicReadPaidOriginalV2} from '../../lib/soulidity/native-public-read-paid-execution-v2'
import {parseSoulAccessRecord} from '../../lib/soulidity/soul-access-operation'
export type NativePublicReadPaidPreflightInputV2=Omit<NativePublicReadPaidHostRequestV2,'qualification'|'getBuyerAddress'>&{
 qualification:Omit<NativePublicReadPaidHostRequestV2['qualification'],'client'|'signal'>}
type Client=SuiGrpcClient|((signal:AbortSignal)=>SuiGrpcClient)
type ExecuteOriginal=(text:string,signal:AbortSignal)=>ReturnType<typeof executeNativePublicReadPaidOriginalV2>
type RecoveredFunding = { total: string; coinType: string; paymentId: string; gasIds: string[]; gasBudget: string }
type Validated=Awaited<ReturnType<typeof validateNativePublicReadPaidHostResultV2>>
type PaidOriginal=Extract<PurchaseRecoveryOriginal,{kind:'native-public-read-v2'}>['value']
type PaidHistory=Extract<PurchaseRecoveryQuery,{kind:'native-public-read-v2'}>['history']
type Settlement={original:PaidOriginal;history:Extract<PaidHistory,{status:'SUBSCRIPTION_RECORDED'}>}
const originalStatusMessages={
 MISSING:'本次未查到原结果，请用同一摘要继续查询。',
 PENDING:'已找到原交易，等待最终确认。',
 FAILED:'原交易已确认失败。',
 SUBSCRIPTION_RECORDED:'已核对原订阅和资金。',
}
/** Actual unsigned preflight consumer. Main owns current release activation,
 * wallet selection, current reviewed Record/funding and its durable host/lock.
 * No local persistence, direct preflight fallback, wallet signer or submitter. */
export function NativePublicReadPaidPreflightV2({client,input,viewerAddress,activationKey,disabledReason,hostPreflight,releaseJson,sourceKey,executeOriginal=null}:{
 client:Client;input:NativePublicReadPaidPreflightInputV2;viewerAddress:string|null;activationKey:string;disabledReason:string|null;hostPreflight:NativePublicReadPaidHostPreflightV2|null;executeOriginal?:ExecuteOriginal|null
 releaseJson:string;sourceKey:string
}){
 const scope=JSON.stringify([input,viewerAddress,activationKey,disabledReason,releaseJson,sourceKey],(_k,v)=>typeof v==='bigint'?{bigint:String(v)}:v)
 const current=useRef({scope,client,hostPreflight,viewerAddress,executeOriginal})
 const serial=useRef(0),active=useRef<AbortController|null>(null)
 const executing=useRef<AbortController|null>(null)
 const emptyDispatch=useCallback(()=>({scope,client,executeOriginal,pending:null as 'execute'|'read'|null,message:'',
  attempted:false,seenOnChain:false,terminal:false,settlement:null as Settlement|null}),[scope,client,executeOriginal])
 const [dispatch,setDispatch]=useState(emptyDispatch)
 const outcome=dispatch.scope===scope&&dispatch.client===client&&dispatch.executeOriginal===executeOriginal?dispatch:emptyDispatch()
 const dispatchClaim=useRef<{scope:string;client:Client;executeOriginal:ExecuteOriginal}|null>(null)
 // React may batch multiple clicks before committing pending/attempted state.
 // Claim the attempt synchronously; stop/error/success never release it.
 const attempt=useRef<{scope:string;client:Client;host:NativePublicReadPaidHostPreflightV2}|null>(null)
 const empty=useCallback(()=>({scope,client,hostPreflight,pending:false,attempted:false,stopped:false,result:null as Validated|null,error:null as string|null,recovery:null as NativePublicReadPaidRecoveryV2|null,recoveredFunding:null as RecoveredFunding|null}),[scope,client,hostPreflight])
 const [state,setState]=useState(empty)
 useLayoutEffect(()=>{
  current.current={scope,client,hostPreflight,viewerAddress,executeOriginal}
  serial.current++;active.current?.abort()
  // Drop old confirmation state before the new wallet or host can act.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setState(empty());setDispatch(emptyDispatch())
  return()=>{active.current?.abort();executing.current?.abort();executing.current=null}
 },[scope,client,hostPreflight,viewerAddress,executeOriginal,empty,emptyDispatch])
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
 const recoveryText=view.recovery?.format==='native-public-read-v2'?view.recovery.text:null
 const originalText=view.result?.text??recoveryText
 const originalDigest=view.result?.digest??(recoveryText?view.recovery?.digest:null)
 const executableText=view.result?.text??(view.recovery?.durability==='CONFIRMED'?recoveryText:null)
 async function observeOriginal(mode:'execute'|'read'){
  const text=mode==='execute'?executableText:originalText
  if(!text||!originalDigest||executing.current||outcome.terminal)return
  if(current.current.scope!==scope||current.current.client!==client||current.current.executeOriginal!==executeOriginal)return
  if(mode==='execute'){
   if(!executeOriginal||unavailable||outcome.seenOnChain||outcome.attempted)return
   if(dispatchClaim.current?.scope===scope&&dispatchClaim.current.client===client&&dispatchClaim.current.executeOriginal===executeOriginal)return
   dispatchClaim.current={scope,client,executeOriginal}
  }
  const request=new AbortController();executing.current=request
  const valid=()=>!request.signal.aborted&&executing.current===request&&current.current.scope===scope
   &&current.current.client===client&&current.current.executeOriginal===executeOriginal
  const started={...outcome,attempted:mode==='execute'||outcome.attempted}
  setDispatch({...started,pending:mode,message:''})
  try{
   const {soulId,buyer}=input.qualification
   const parsed=await parsePurchaseRecoveryOriginal(text,soulId)
   if(!valid())return
   if(parsed.kind!=='native-public-read-v2'||parsed.value.packet.digest!==originalDigest||parsed.value.intent.buyer!==buyer)throw Error('原购买与本次交易摘要或买家不一致。')
   const original=parsed.value
   let history:PaidHistory
   if(mode==='execute'&&executeOriginal){
    const result=await executeOriginal(text,request.signal)
    if(result.record.packet.digest!==originalDigest)throw Error('原购买返回了不同的交易摘要。')
    history=result.original
   }else{
    const reader=typeof client==='function'?client(request.signal):client
    const result=await queryPurchaseRecoveryOriginal({text,soulId,client:reader,signal:request.signal})
    if(result.kind!=='native-public-read-v2')throw Error('原购买格式不一致。')
    history=result.history
   }
   let settlement:Settlement|null=null
   if(history.status==='SUBSCRIPTION_RECORDED'){
    if(!nativePublicReadPaidSettlementMatchesV2({packet:original.packet,plan:{author:buyer}},history))throw Error('原付款回执与本次交易摘要或买家不一致。')
    settlement={original,history}
   }
   if(valid())setDispatch({...started,pending:null,message:originalStatusMessages[history.status],
    seenOnChain:outcome.seenOnChain||history.status!=='MISSING',terminal:history.status==='FAILED'||settlement!==null,settlement})
  }catch(error){
   if(valid())setDispatch({...started,pending:null,message:error instanceof Error?error.message:'原购买未能确认，请核对原记录。'})
  }finally{if(executing.current===request)executing.current=null}
 }
 const settlement=outcome.settlement
 const purchased=settlement?.original.intent.recordGuard
 const selection=input.qualification
 const matchesPurchasedVersion=settlement&&purchased?.index===selection.recordIndex&&purchased.namespace===input.reviewed.namespace
  &&settlement.original.intent.kind===selection.kind&&paidContentScopeCovers(BigInt(settlement.history.receipt.entry.scope),selection.requiredScope)
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
  {originalText&&<section aria-label="原购买执行与结果" className="space-y-2">
   {executeOriginal&&executableText&&<button type="button"
    disabled={Boolean(unavailable)||Boolean(outcome.pending)||outcome.attempted||outcome.seenOnChain} onClick={()=>void observeOriginal('execute')}>
    核对并签名发送原购买
   </button>}
   {!outcome.terminal&&<button type="button" disabled={Boolean(outcome.pending)} onClick={()=>void observeOriginal('read')}>查询原购买结果</button>}
   {(outcome.pending||outcome.message)&&<p role="status">{outcome.pending==='execute'?'正在核对并继续原购买…':outcome.pending==='read'?'正在按原摘要查询…':outcome.message}</p>}
  </section>}
  {settlement&&<article aria-label="已核验原内容付款" className="space-y-2 break-all">
   <p>原交易 {settlement.original.packet.digest} · 确认检查点 {settlement.history.checkpoint}</p>
   {settlement.history.receipt.money&&<p>原总价 {settlement.history.receipt.money.buyerGrossDebit} · 发行方收款 {settlement.history.receipt.money.payout.amount}
    {' · '}协议入账 {settlement.history.receipt.money.protocolIncome} · SUI Gas {settlement.history.receipt.money.gas.netGasCharge} MIST</p>}
   {matchesPurchasedVersion?<NativePublicPaidContentReaderV2 soulId={selection.soulId} index={selection.recordIndex} releaseJson={releaseJson}
     sourceKey={sourceKey} paidRecovery={{original:settlement.original,kind:selection.kind,scope:String(selection.requiredScope),exactRecord:true}}/>
    :<p>可在原购买恢复页选择该订阅覆盖的当前版本。</p>}
  </article>}
  <a href={`/souls/${input.qualification.soulId}/purchase/recovery`}>查询本 Soul 的原购买记录</a>
 </section>
}
