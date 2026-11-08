'use client'

import React,{useEffect,useRef,useState} from 'react'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {queryPurchaseRecoveryOriginal,type PurchaseRecoveryOriginal,type PurchaseRecoveryQuery} from '../../lib/soulidity/commerce/purchase-recovery-original'
import {PurchaseRecoverySaleEffects} from './purchase-recovery-sale-effects'
import {PurchaseRecoverySaleDelivery} from './purchase-recovery-sale-delivery'
function cleanup(result:PurchaseRecoveryQuery|null){return result?.kind==='native-sale-preparation.v1'&&'receipt'in result.history?result.history.receipt.cleanup:null}
function custody(result:PurchaseRecoveryQuery|null){return result?.kind==='native-sale-preparation.v1'&&'receipt'in result.history?result.history.receipt.custody:null}
/** Saved V1 pins/graph only. Historical handoff cannot grant current access.
 * A later unavailable observation never erases an authenticated original fact. */
export function PurchaseRecoverySaleCustody({text,soulId,record,original,client,nativeReleaseJson}:{text:string;soulId:string;nativeReleaseJson?:string;record:Extract<PurchaseRecoveryOriginal,{kind:'native-sale-preparation.v1'}>;original:PurchaseRecoveryQuery;client:SuiGrpcClient}){
 const scope=JSON.stringify([text,soulId,original],(_k,v)=>typeof v==='bigint'?{bigint:String(v)}:v),current=useRef({scope,client});current.current={scope,client}
 const serial=useRef(0),active=useRef<AbortController|null>(null)
 const empty=()=>({scope,client,pending:false,requestCleanup:false,result:null as PurchaseRecoveryQuery|null,error:null as string|null,stopped:false,unconfirmed:false})
 const [state,setState]=useState(empty)
 useEffect(()=>{serial.current++;active.current?.abort();setState(empty());return()=>{serial.current++;active.current?.abort()}},[scope,client])
 const valid=(id:number)=>serial.current===id&&current.current.scope===scope&&current.current.client===client
 const view=state.scope===scope&&state.client===client?state:empty(),proof=custody(view.result),tree=cleanup(view.result),selectedResult=view.result??original,inventory=selectedResult.kind==='native-sale-preparation.v1'&&'receipt'in selectedResult.history?selectedResult.history.receipt.effectsReconciliation:null,savedPin=Boolean(record.value.context.target.custody),savedContent=Boolean(record.value.context.target.content)
 async function query(includeCleanup=false){
  if(includeCleanup?!savedContent:!savedPin)return
  const id=++serial.current,controller=new AbortController();active.current?.abort();active.current=controller
  const matches=()=>valid(id)&&!controller.signal.aborted
  setState(s=>matches()&&s.scope===scope&&s.client===client?{...s,pending:true,requestCleanup:includeCleanup,error:null,stopped:false,unconfirmed:false}:s)
  try{const result=await queryPurchaseRecoveryOriginal({text,soulId,client,signal:controller.signal,...(savedPin?{proveSaleCustody:true as const}:{}),...(includeCleanup?{proveSaleCleanup:true as const}:{})});const verified=Boolean(includeCleanup?cleanup(result):custody(result));if(matches())setState(s=>matches()&&s.scope===scope&&s.client===client?{...s,pending:false,result:verified?(includeCleanup||!cleanup(s.result)?result:s.result):s.result,unconfirmed:!verified}:s)}
  catch(e){if(matches())setState(s=>matches()&&s.scope===scope&&s.client===client?{...s,pending:false,error:e instanceof Error?e.message:'原资产交接查询未完成。'}:s)}
 }
 function stop(){const id=++serial.current;active.current?.abort();setState(s=>valid(id)&&s.scope===scope&&s.client===client?{...s,pending:false,stopped:true}:s)}
 return <section aria-label="原成交资产交接" className="space-y-3 rounded-xl border p-4">
  <h3 className="font-medium">核对原成交资产交接</h3>
  <p>独立核对原 Soul 转入买方 Kiosk、原卖方项目与锁退出、买方锁建立以及原买方 Account 闭合。原文件中的精确对象引用和包身份必须匹配。</p>
  {!savedPin&&<p>原文件未保存托管包身份，无法从本入口核对原交接。请保留原文件；不会补用当前部署配置。</p>}
  <button type="button" disabled={!savedPin||view.pending} onClick={()=>void query()} className="rounded border px-3 py-1">核对原资产交接</button>
  <button type="button" disabled={!savedContent||view.pending} onClick={()=>void query(true)} className="rounded border px-3 py-1">核对原模块与授权清理</button>
  {savedContent&&<p>模块与授权清理查询会对账本次原交易的对象变动；原托管包身份齐备时一并核对原交接。</p>}
  {!savedContent&&<p>原文件未保存内容包身份，无法从本入口核对原模块与授权清理；不会补用当前配置。</p>}
  {view.pending&&<><p role="status">{view.requestCleanup?'正在核对原交接、模块版本与授权代际…':'正在核对原 Soul、Kiosk、锁和 Account…'}</p><button type="button" onClick={stop}>停止原交接查询</button></>}
  {view.error&&<p role="alert">原资产交接核验未完成：{view.error}。已核验的原付款与资金观察仍保留。</p>}
  {view.stopped&&<p role="status">本次原交接查询已停止；原交易结果仍需查询，不能据此重新付款。</p>}
  {view.unconfirmed&&<p role="status">本次未取得原交接证明；先前已核验的原历史仍保留，不能据此重新付款。</p>}
  {proof&&<article aria-label="已核验原资产交接" className="space-y-1 break-all text-sm">
   <p>原 Soul、买卖双方 Kiosk 与锁的交接及买方 Account 闭合已核验。</p><p>原 Soul：{proof.soulId}</p><p>原交易：{proof.transactionDigest}</p>
   <p>原买方 Kiosk：{proof.buyerKioskId}</p><p>原买方 Account：{proof.buyerAccountId}</p><p>原交接后 Soul 修订：{proof.rootRevision}</p>
   <p>原卖方退出锁：{proof.sellerLockId}</p><p>原买方建立锁：{proof.buyerLockId}</p>
   <p>这只证明原交易中的资产交接；不证明当前持有人、内容可用、全部模块清理或完整购买完成，也不授予当前权限。</p>
  </article>}
  {proof?.transactionDigest===record.value.packet.digest&&proof.soulId===soulId&&
   <PurchaseRecoverySaleDelivery key={scope} releaseJson={nativeReleaseJson} savedTarget={record.value.context.target}
    soulId={soulId} buyer={record.value.plan.buyer} digest={proof.transactionDigest}/>}
  {tree&&<article aria-label="已核验原模块与授权清理" className="space-y-2 break-all text-sm"><p>已核对原 Soul 树的模块版本、原生状态、授权代际变化及匹配事件。Soul 节点数：{tree.nodes.length}</p>{tree.nodes.map(node=><div key={node.soulId}><p>原 Soul：{node.soulId}</p>{node.nativeVersion&&<p>原模块安装修订：{node.nativeVersion.installed} · 更新修订：{node.nativeVersion.beforeUpdated} → {node.nativeVersion.afterUpdated}</p>}{node.authorization&&<p>原授权代际：{node.authorization.oldGeneration} → {node.authorization.newGeneration} · 保留的物理授权记录数：{node.authorization.retainedPhysicalGrantCount}</p>}</div>)}<p>保留的物理记录不代表旧授权继续有效；当前所有权、资格复用和内容读取需独立核对。</p></article>}
  {inventory&&<PurchaseRecoverySaleEffects inventory={inventory}/>}
 </section>
}
