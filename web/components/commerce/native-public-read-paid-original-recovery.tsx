'use client'
import React,{useEffect,useRef,useState} from 'react'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import type {NativePublicReadPaidRecordV2} from '../../lib/soulidity/native-public-read-paid-journal-v2'
import {nativePublicReadPaidOriginalIdV2,discoverNativePublicReadPaidOriginalsV2,queryNativePublicReadPaidOriginalV2,cancelNativePublicReadPaidOriginalV2,retireNativePublicReadPaidOriginalV2} from '../../lib/soulidity/native-public-read-paid-original-recovery-v2'
import {createNativePublicReadPaidOriginalClientV2} from '../../lib/soulidity/native-public-read-paid-original-client-v2'
import {ROOT_NATIVE_PAID_RETIREMENT_SOURCES_V2} from '../../lib/soulidity/commerce/native-public-read-paid-retirement-v2'
import {marketListDigest} from '../../lib/animacraft/market-list-operation'
import {publicMutationCanonical} from '../../lib/sui/public-mutation-journal'
import {NativePublicReadPaidOriginalOutcomeV2} from './native-public-read-paid-original-outcome-v2'
type ClientFactory=(signal:AbortSignal)=>SuiGrpcClient
type OriginalResult=Awaited<ReturnType<typeof queryNativePublicReadPaidOriginalV2>>
type View={scope:string;client:ClientFactory;records:NativePublicReadPaidRecordV2[];selected:string|null;result:OriginalResult|null;reader:SuiGrpcClient|null;pending:boolean;stopped:boolean;error:string|null}
/** Independent original recovery; no wallet/new Host/config/quote/funding.
 * Public local bytes are parsed before export; query never promotes phase. */
export function NativePublicReadPaidOriginalRecoveryV2({soulId,chainIdentifier='35834a8a',publicReadReleaseJson,createReadOnlyClient=createNativePublicReadPaidOriginalClientV2}:{soulId:string;chainIdentifier?:string;publicReadReleaseJson?:string;createReadOnlyClient?:ClientFactory}){
 const scope=JSON.stringify([chainIdentifier,soulId]),serial=useRef(0),busy=useRef(false),active=useRef<AbortController|null>(null)
 const current=useRef({scope,client:createReadOnlyClient});current.current={scope,client:createReadOnlyClient}
 const [actor,setActor]=useState(''),[locks,setLocks]=useState(false)
 const [conflictInput,setConflictInput]=useState<{id:string;value:string}|null>(null)
 const empty=():View=>({scope,client:createReadOnlyClient,records:[],selected:null,result:null,reader:null,pending:false,stopped:false,error:null})
 const [state,setState]=useState<View>(empty),view=state.scope===scope&&state.client===createReadOnlyClient?state:empty()
 const record=view.records.find(r=>nativePublicReadPaidOriginalIdV2(r)===view.selected)??null
 const conflictDigest=conflictInput&&conflictInput.id===view.selected?conflictInput.value.trim():''
 const invalidConflict=Boolean(conflictDigest&&!marketListDigest(conflictDigest))
 const sameSource=()=>current.current.scope===scope&&current.current.client===createReadOnlyClient
 const valid=(id:number)=>serial.current===id&&sameSource()
 // A pre-enqueue check alone cannot revoke an already queued React update.
 // Recheck its lease inside the updater against the actual preceding state.
 function publish(id:number,update:(previous:View)=>View,signal?:AbortSignal,selected?:NativePublicReadPaidRecordV2){
  setState(previous=>{
   if(!valid(id)||signal?.aborted)return previous
   const base=previous.scope===scope&&previous.client===createReadOnlyClient?previous:empty()
   if(selected){const visible=base.records.find(r=>nativePublicReadPaidOriginalIdV2(r)===base.selected)
    if(!visible||publicMutationCanonical(visible)!==publicMutationCanonical(selected))return previous}
   return update(base)
  })
 }
 useEffect(()=>{setActor('');setLocks(typeof navigator!=='undefined'&&Boolean(navigator.locks?.request));void discover(null);return()=>{serial.current++;busy.current=false;active.current?.abort()}},[scope,createReadOnlyClient])
 async function discover(author:string|null){
  if(!sameSource())return
  const id=++serial.current;active.current?.abort();busy.current=true;publish(id,()=>({...empty(),pending:true}))
  try{const records=await discoverNativePublicReadPaidOriginalsV2({chainIdentifier,soulId,author});publish(id,()=>({...empty(),records,selected:records[0]?nativePublicReadPaidOriginalIdV2(records[0]):null}))}
  catch(error){publish(id,()=>({...empty(),error:error instanceof Error?error.message:'本机原记录无法核对；请保留已有记录。'}))}
  finally{if(valid(id))busy.current=false}
 }
 function select(key:string){if(!sameSource())return;const id=++serial.current;active.current?.abort();busy.current=false;publish(id,previous=>({...previous,selected:key,result:null,reader:null,error:null,pending:false,stopped:false}))}
 const canRetire=Boolean(locks&&ROOT_NATIVE_PAID_RETIREMENT_SOURCES_V2.length&&record&&['SIGNING','SIGNED'].includes(record.packet.phase))
 async function run(action:'query'|'cancel'|'retire'){
  if(!sameSource()||!record||busy.current||action==='cancel'&&(!locks||record.packet.phase!=='PREPARED'||record.packet.signature!==null)
    ||action==='retire'&&(!canRetire||invalidConflict))return
  const selected=structuredClone(record),id=++serial.current,controller=new AbortController();busy.current=true;active.current?.abort();active.current=controller
  publish(id,previous=>({...previous,pending:true,result:null,reader:null,error:null,stopped:false}),controller.signal,selected)
  try{
   const client=createReadOnlyClient(controller.signal)
   if(action!=='query'){
    const options={record:selected,client,signal:controller.signal}
    const result=action==='cancel'?await cancelNativePublicReadPaidOriginalV2(options)
     :await retireNativePublicReadPaidOriginalV2({...options,conflictDigest:conflictDigest||undefined})
    publish(id,previous=>({...previous,pending:false,result:action==='cancel'?result.original:null,
     records:previous.records.map(r=>nativePublicReadPaidOriginalIdV2(r)===nativePublicReadPaidOriginalIdV2(result.record)?result.record:r)}),controller.signal,selected)
   }else{
    const result=await queryNativePublicReadPaidOriginalV2({record:selected,client,signal:controller.signal})
    publish(id,previous=>({...previous,pending:false,result,reader:client}),controller.signal,selected)
   }
  }catch(error){publish(id,previous=>({...previous,pending:false,error:error instanceof Error?error.message:'原操作查询未完成。'}),controller.signal,selected)}
  finally{if(valid(id))busy.current=false}
 }
 function stop(){if(!sameSource())return;const id=++serial.current;active.current?.abort();busy.current=false;publish(id,previous=>({...previous,pending:false,stopped:true,result:null,reader:null,error:null}))}
 const status=view.result?.status
 return <section aria-label="本机 V2 原购买记录" className="space-y-3 rounded-xl border p-4">
  <h2 className="font-semibold">本机原购买记录</h2>
  <p>无需原文件、连接钱包或当前购买配置。本页可读取本机保留的当前和已归档 V2 原操作。跨设备接续请先下载原文件。</p>
  <label>原操作地址（可留空）<input value={actor} onChange={e=>setActor(e.currentTarget.value)} placeholder="0x…" className="block w-full rounded border p-2"/></label>
  <button type="button" disabled={view.pending} onClick={()=>void discover(actor.trim()||null)}>重新发现本机原记录</button>
  {view.error&&<p role="alert">{view.error}。请保留原记录；本页不会重建付款或删除记录。</p>}
  {!view.pending&&!view.error&&!view.records.length&&<p>本机未发现本页 Soul 的已核验 V2 原记录。可继续使用下面的原文件导入；这不表示原付款未发生。</p>}
  {view.records.length>0&&<label>所选原操作<select value={view.selected??''} onChange={e=>select(e.currentTarget.value)}>{view.records.map(r=><option key={nativePublicReadPaidOriginalIdV2(r)} value={nativePublicReadPaidOriginalIdV2(r)}>{r.plan.author} · {r.packet.digest}</option>)}</select></label>}
  {record&&<article aria-label="已核验本机原操作" className="space-y-2 break-all">
   <p>原操作地址：{record.plan.author}</p><p>原交易：{record.packet.digest}</p><p>本机保存阶段：{record.packet.phase}。请查询原摘要核验链上结果和实收。{record.packet.phase==='SUCCEEDED'&&'本机阶段记录付款结算。当前内容权限由买家钱包单独核验。'}</p>
   <a download={`purchase-${record.packet.digest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(record.plan.originalText)}`}>下载本机保留的原购买 JSON</a>
   <div className="flex gap-2"><button type="button" disabled={view.pending} onClick={()=>void run('query')}>查询本机原操作历史</button><button type="button" disabled={view.pending||!locks||record.packet.phase!=='PREPARED'||record.packet.signature!==null} onClick={()=>void run('cancel')}>核对并取消本机未签名准备</button></div>
   {canRetire&&<><label>冲突交易摘要（可选） <input value={conflictDigest} disabled={view.pending}
    onChange={event=>setConflictInput({id:nativePublicReadPaidOriginalIdV2(record),value:event.currentTarget.value})}/></label>
    <button type="button" disabled={view.pending||view.stopped||Boolean(view.error)||invalidConflict} onClick={()=>void run('retire')}>核对并退役过期原购买</button></>}
   {record.retirement&&<p>已保存退役证据 · 检查点 {record.retirement.checkpoint.sequenceNumber}
    {' · '}{'conflict' in record.retirement?<>冲突交易 {record.retirement.conflict.digest}</>:<>核对回执 {record.retirement.tableSize} 项</>}。下一次操作会重新核对这笔原购买。</p>}
   <p>取消只保留本机 CANCELLED 阶段，不撤销链上交易；仅在原结果 MISSING、原记录仍完整且未进入签名时允许。不会生成新原包或自动重新付款。</p>
   {!locks&&<p>当前环境缺少操作锁；仍可查看、导出和查询原记录，不能修改本机阶段。</p>}
   <div className="space-y-1"><a href={`/souls/${encodeURIComponent(soulId)}/read`}>读取此原 Soul 的当前内容</a><p>当前内容页会重新核对发布配置、所选内容和钱包资格。原付款记录不授予当前读取权限。</p><a href={`/souls/${encodeURIComponent(soulId)}`}>管理此原 Soul</a></div>
  </article>}
  {view.pending&&<><p role="status">正在核对原记录…</p><button type="button" onClick={stop}>停止本次原记录操作</button></>}
  {view.stopped&&<p role="status">已停止本页等待。已开始的写入仍会保留操作锁直到结束；请重新发现原记录，不据此发起新付款。</p>}
  {status&&<p role="status">{status==='MISSING'?'本次未查到原交易；付款结果仍未知。':status==='PENDING'?'已找到原交易，最终结果仍待确认。':status==='FAILED'?'原交易已确认失败；不能据此推断 Gas 为零。':'原订阅回执、事件及资金变化已记录；尚未证明完整业务成功或当前内容可读。'}</p>}
  {view.result&&'checkpoint'in view.result&&<p>原确认检查点：{view.result.checkpoint}</p>}
  {record&&view.reader&&view.result?.status==='SUBSCRIPTION_RECORDED'&&<NativePublicReadPaidOriginalOutcomeV2 key={record.packet.digest} record={record} history={view.result} client={view.reader} publicReadReleaseJson={publicReadReleaseJson}/>}
 </section>
}
