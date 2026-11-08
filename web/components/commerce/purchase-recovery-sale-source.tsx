'use client'

import React,{useEffect,useRef,useState} from 'react'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {queryPurchaseRecoveryOriginal,type PurchaseRecoveryOriginal,type PurchaseRecoveryQuery} from '../../lib/soulidity/commerce/purchase-recovery-original'
import {PurchaseRecoveryFunds} from './purchase-recovery-funds'
function saleMoney(result:PurchaseRecoveryQuery|null){
 if(result?.kind!=='native-sale-preparation.v1'||!('receipt'in result.history))return null
 const money=result.history.receipt.money
 return money&&'seller'in money?money:null
}
function boundSource(result:PurchaseRecoveryQuery|null,soulId:string){const money=saleMoney(result);return Boolean(money&&!money.requiresOriginalSourceBindingProof&&money.sourceBinding?.requiresOriginalSoulModuleBinding===false&&money.sourceBinding.soulBinding?.soulId===soulId)}
/** Optional stronger ORIGINAL V1 proof. Failure never replaces the original
 * payment or current funds observations. Saved pins only; no current fallback,
 * V2 authorship inference, wallet control or withdrawal authorization. */
export function PurchaseRecoverySaleSource({text,soulId,record,original,client}:{text:string;soulId:string;record:Extract<PurchaseRecoveryOriginal,{kind:'native-sale-preparation.v1'}>;original:PurchaseRecoveryQuery;client:SuiGrpcClient}){
 const scope=JSON.stringify([text,soulId,original],(_k,v)=>typeof v==='bigint'?{bigint:String(v)}:v),current=useRef({scope,client});current.current={scope,client}
 const serial=useRef(0),active=useRef<AbortController|null>(null)
 const empty=()=>({scope,client,pending:false,result:null as PurchaseRecoveryQuery|null,error:null as string|null,stopped:false,unconfirmed:false})
 const [state,setState]=useState(empty)
 useEffect(()=>{serial.current++;active.current?.abort();setState(empty());return()=>{serial.current++;active.current?.abort()}},[scope,client])
 const valid=(id:number)=>serial.current===id&&current.current.scope===scope&&current.current.client===client
 const view=state.scope===scope&&state.client===client?state:empty(),money=saleMoney(view.result)
 const verified=boundSource(view.result,soulId)
 async function query(){
  const id=++serial.current,controller=new AbortController();active.current?.abort();active.current=controller
  setState(s=>valid(id)&&s.scope===scope&&s.client===client?{...s,pending:true,error:null,stopped:false,unconfirmed:false}:s)
  const matches=()=>valid(id)&&!controller.signal.aborted
  try{const result=await queryPurchaseRecoveryOriginal({text,soulId,client,signal:controller.signal,proveSaleSource:true});if(matches())setState(s=>matches()&&s.scope===scope&&s.client===client?{...s,pending:false,result:boundSource(result,soulId)?result:s.result,unconfirmed:!boundSource(result,soulId)}:s)}
  catch(e){if(matches())setState(s=>matches()&&s.scope===scope&&s.client===client?{...s,pending:false,error:e instanceof Error?e.message:'原作者来源查询未完成。'}:s)}
 }
 function stop(){const id=++serial.current;active.current?.abort();setState(s=>valid(id)&&s.scope===scope&&s.client===client?{...s,pending:false,stopped:true}:s)}
 return <>
  <section aria-label="原 Soul 作者与分账来源" className="space-y-3 rounded-xl border p-4">
   <h3 className="font-medium">核对原 Soul 作者与分账</h3>
   <p>原挂牌的作者收款地址还需与原 Soul 作者身份、原生状态和来源绑定核对。仅有付款回执不能完成这项核验。</p>
   <button type="button" disabled={view.pending} onClick={()=>void query()} className="rounded border px-3 py-1">核对原作者身份与来源</button>
   {view.pending&&<><p role="status">正在核对原作者、Soul 来源和分账…</p><button type="button" onClick={stop}>停止作者来源查询</button></>}
   {view.stopped&&<p role="status">作者来源查询已停止；原付款历史仍保留，不代表可以重新付款。</p>}
   {view.error&&<p role="alert">原作者来源核验未完成：{view.error}。原付款历史与已查询资金仍保留，请保留原文件。</p>}
   {view.unconfirmed&&<p role="status">本次未取得完整的原作者身份绑定；先前已核验的原历史与资金观察仍保留，不能据此重新付款。</p>}
   {verified&&money&&<article aria-label="已绑定原作者分账" className="space-y-2 break-all">
    <p>原 Soul 作者身份、原挂牌作者与版税分账已核对。</p><p>原作者地址：{money.creator}</p>
    <p>原标价（最小单位）：{String(money.quote.ask)} · 协议费用：{String(money.quote.platform)} · 作者版税：{String(money.quote.creator)} · 合集分账：{String(money.quote.collection)}</p>
    <p>原总价（最小单位）：{String(money.quote.total)} · 币种：{money.coinType}</p>
    <p>{money.creator===money.seller?'作者同时是卖方，作者版税合并在卖方收款中；合并金额不全是版税。':'作者版税与卖方收款分别转入各自地址。'}</p>
    <p>原作者收款 Coin：{money.payouts.filter(p=>p.owner===money.creator).map(p=>`${p.coinId} · ${p.amount}`).join('；')||'本笔没有非零作者直收'}</p>
    <p>这项核验不证明完整资产交接、当前权限或源码发布资格。请选择下方地址查询当前资金；余额不能归因为本笔剩余收益。</p>
   </article>}
  </section>
  <PurchaseRecoveryFunds original={verified&&view.result?view.result:original} record={record} client={client}/>
 </>
}
