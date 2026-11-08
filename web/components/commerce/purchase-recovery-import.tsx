'use client'

import {MARKET_BUY_FUNDS_ORIGINAL} from '../../lib/animacraft/market-buy-funds-original'
import {PurchaseRecoveryPaidContent} from './purchase-recovery-paid-content'
import {PurchaseRecoveryFunds} from './purchase-recovery-funds'
import {PurchaseRecoveryMarketHandoff} from './purchase-recovery-market-handoff'
import {PurchaseRecoverySaleSource} from './purchase-recovery-sale-source'
import {PurchaseRecoverySaleCustody} from './purchase-recovery-sale-custody'
import React,{useEffect,useRef,useState} from 'react'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {SuiGrpcClient as ReadClient} from '@mysten/sui/grpc'
import {GrpcWebFetchTransport} from '@protobuf-ts/grpcweb-transport'
import {getSuiGrpcFullnodeUrl} from '@soulidity/sdk'
import {withPackageObjectIdentity} from '../../lib/sui/package-object-client'
import {parsePurchaseRecoveryOriginal,queryPurchaseRecoveryOriginal,PURCHASE_ORIGINAL_MAX_BYTES,type PurchaseRecoveryOriginal,type PurchaseRecoveryQuery} from '../../lib/soulidity/commerce/purchase-recovery-original'

function defaultClient(signal:AbortSignal){return withPackageObjectIdentity(new ReadClient({network:'mainnet',transport:new GrpcWebFetchTransport({baseUrl:getSuiGrpcFullnodeUrl('mainnet'),abort:signal})}),signal)}
type ClientFactory=(signal:AbortSignal)=>SuiGrpcClient
type View={reader:SuiGrpcClient|null;soulId:string;client:ClientFactory;text:string;name:string;original:PurchaseRecoveryOriginal|null;result:PurchaseRecoveryQuery|null;pending:boolean;error:string|null;stopped:boolean}
/** Explicit memory-only import; original formats retain their meaning. */
export function PurchaseRecoveryImport({soulId,nativeReleaseJson,publicReadReleaseJson,createReadOnlyClient=defaultClient}:{soulId:string;nativeReleaseJson?:string;publicReadReleaseJson?:string;createReadOnlyClient?:ClientFactory}){
 const serial=useRef(0),active=useRef<AbortController|null>(null),current=useRef({soulId,client:createReadOnlyClient});current.current={soulId,client:createReadOnlyClient}
 const empty=():View=>({reader:null,soulId,client:createReadOnlyClient,text:'',name:'',original:null,result:null,pending:false,error:null,stopped:false})
 const [state,setState]=useState<View>(empty)
 useEffect(()=>{serial.current++;active.current?.abort();setState(empty());return()=>{serial.current++;active.current?.abort()}},[soulId,createReadOnlyClient])
 const view=state.soulId===soulId&&state.client===createReadOnlyClient?state:empty()
 const valid=(id:number)=>serial.current===id&&current.current.soulId===soulId&&current.current.client===createReadOnlyClient
 async function select(file:File|undefined){
  const id=++serial.current;active.current?.abort();setState({...empty(),name:file?.name??''})
  if(!file)return
  try{
   if(file.size===0||file.size>PURCHASE_ORIGINAL_MAX_BYTES)throw Error('PURCHASE_ORIGINAL_FILE_BOUND')
   const text=await file.text();if(!valid(id))return
   const original=await parsePurchaseRecoveryOriginal(text,soulId);if(valid(id))setState({...empty(),text,name:file.name,original})
  }catch(e){if(valid(id))setState({...empty(),name:file.name,error:message(e)})}
 }
 async function query(){
  if(!view.original)return
  const text=view.text,id=++serial.current,controller=new AbortController();active.current?.abort();active.current=controller
  setState({...view,pending:true,result:null,error:null,stopped:false})
  try{const reader=createReadOnlyClient(controller.signal),result=await queryPurchaseRecoveryOriginal({text,soulId,client:reader,signal:controller.signal});if(valid(id)&&!controller.signal.aborted)setState({...view,reader,result,pending:false,error:null,stopped:false})}
  catch(e){if(valid(id)&&!controller.signal.aborted)setState({...view,result:null,pending:false,error:message(e),stopped:false})}
 }
 function stop(){serial.current++;active.current?.abort();setState({...view,pending:false,stopped:true})}
 const checkout=view.result?.kind===MARKET_BUY_FUNDS_ORIGINAL?view.result:null
 const legacy=view.result?.kind!==MARKET_BUY_FUNDS_ORIGINAL?view.result:null
 const paidHistory=legacy?.kind==='native-public-read-v2'&&legacy.history.status==='SUBSCRIPTION_RECORDED'?legacy.history:null
 const paidOriginal=view.original?.kind==='native-public-read-v2'?view.original.value:null
 const h=legacy?.history,money=h&&'receipt'in h?h.receipt.money:null
 return <section aria-label="原购买恢复" className="space-y-4">
  <p>导入原购买文件后，手动核对原字节、身份与链上历史。无需连接钱包；文件仅保留在本页内存中。</p>
  <p>支持 Native V1 原成交、Native V2 原付费内容购买，以及 Soul 结账页下载的只读成交 JSON。</p>
  <label>原购买文件<input type="file" accept="application/json,.json" onChange={e=>void select(e.currentTarget.files?.[0])}/></label>
  {view.name&&<p>已选择：{view.name}</p>}
  {view.error&&<p role="alert">{view.error}</p>}
  {view.original&&<article className="space-y-3 break-all">
   <p>已核对本地原包：{view.original.kind}</p><p>原交易：{view.original.value.packet.digest}</p>
   {view.original.kind===MARKET_BUY_FUNDS_ORIGINAL?<p>只读成交文件包含原交易数据及核验所需的引用。请选择查询，取得链上证据。</p>:<p>保存的阶段和签名字段仅是原记录元数据，不证明原交易成功或签名有效。</p>}
   <a download={`purchase-${view.original.value.packet.digest}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(view.text)}`}>下载导入的原购买 JSON</a>
   <p>下载仅包含导入文本，不包含本次查询结果、当前余额或新付款授权。</p>
   <button type="button" disabled={view.pending} onClick={()=>void query()} className="rounded border px-3 py-1">查询原购买历史</button>
   {view.pending&&<><p role="status">正在核对原交易…</p><button type="button" onClick={stop}>停止本次查询</button></>}
   {view.stopped&&<p role="status">本次查询已停止；没有取消链上交易。原付款结果仍需查询，不能据此重新付款。</p>}
  </article>}
  {h&&<article aria-label="原付款历史" className="space-y-2">
   <p role="status">{h.status==='MISSING'?'本次未查到原交易；付款结果仍未知，不能据此重新付款。':h.status==='PENDING'?'已找到原交易，最终确认仍待查询。':h.status==='FAILED'?'原交易已在链上确认失败；不据此推断 Gas 为零。':h.status==='SUBSCRIPTION_RECORDED'?'原订阅回执、事件及资金变化已核验；尚未证明当前内容可用。':'原成交事件、资金变化及挂牌退出已核验；完整资产交接仍待验证。'}</p>
   {'checkpoint'in h&&<p>原确认检查点：{h.checkpoint}</p>}
   {money&&<><p>原购买总额（最小单位）：{money.buyerGrossDebit}</p><p>原协议收入（最小单位）：{money.protocolIncome}</p><p>原 Gas 净费用（最小单位）：{money.gas.netGasCharge}</p></>}
  </article>}
  {checkout&&<article aria-label="原 Soul 结账资金" className="space-y-2">
   <p role="status">{checkout.history.status==='VERIFIED'?'原 Soul 结账的 USDC 扣款和直接分账已核验。'
    :checkout.history.status==='LEGACY_EFFECTS'?'此旧回执格式暂不支持逐项核验收款 Coin。'
    :checkout.history.status==='FAILED'?'链上查询返回原交易失败。'
    :checkout.history.status==='PENDING'?'已找到原交易，等待检查点确认。':'本次未查到原交易，付款结果仍未知。'}</p>
   {checkout.history.status==='VERIFIED'&&<>
    <p>原确认检查点：{checkout.history.checkpoint} · 原购买总额（最小单位）：{checkout.history.buyerDebit}</p>
    <p>{checkout.history.gas?`原 SUI Gas（MIST）：${checkout.history.gas.netGasCharge}`:'原 SUI Gas 证据暂不可用。'}</p>
   </>}
  </article>}
  {checkout?.history.status==='VERIFIED'&&view.original?.kind===MARKET_BUY_FUNDS_ORIGINAL&&view.reader&&
   <>
    <PurchaseRecoveryFunds original={checkout} record={view.original} client={view.reader}/>
    <PurchaseRecoveryMarketHandoff key={view.original.value.packet.digest} file={view.original.value}
     soulId={soulId} settlement={checkout.history.checkpointProof} client={view.reader}/>
   </>}
  {legacy&&view.original&&view.original.kind!==MARKET_BUY_FUNDS_ORIGINAL&&view.reader&&money&&(view.original.kind==='native-sale-preparation.v1'?<PurchaseRecoverySaleSource text={view.text} soulId={soulId} original={legacy} record={view.original} client={view.reader}/>:<PurchaseRecoveryFunds original={legacy} record={view.original} client={view.reader}/>)}
  {legacy&&view.original?.kind==='native-sale-preparation.v1'&&view.reader&&money&&<PurchaseRecoverySaleCustody nativeReleaseJson={nativeReleaseJson} text={view.text} soulId={soulId} record={view.original} original={legacy} client={view.reader}/>}
  {paidOriginal&&paidHistory&&view.reader&&<PurchaseRecoveryPaidContent
    original={paidOriginal} history={paidHistory} releaseJson={publicReadReleaseJson} client={view.reader}/>}
  <article aria-label="当前交付与余额" className="space-y-2"><h2 className="font-semibold">当前交付与余额</h2>
   <p>{publicReadReleaseJson&&paidHistory
    ? '原付款和当前内容交付分别核对。可在上方选择原订阅覆盖的当前版本。'
    : '本页尚未核验内容权限、Seal 解密和实际内容交付。请在对应的内容入口单独核对。'}</p>
   <p>历史查询使用原文件内的配置身份。当前内容入口单独核对已配置的发布版本。</p>
   {view.original?.kind==='native-public-read-v2'&&<>
    <a href={`/souls/${soulId}/read`}>打开本 Soul 的当前内容</a>
    <p>内容页会独立核对当前发布配置、所选内容及钱包资格。原购买文件不会授权读取；已过期或失效的资格不能继续使用。</p>
   </>}
   <a href={`/souls/${soulId}`}>返回本 Soul 核对当前权限与内容</a>
  </article>
 </section>
}
function message(e:unknown){const s=e instanceof Error?e.message:'原购买查询未完成。';return s.endsWith('PURCHASE_ORIGINAL_SOUL_MISMATCH')?'原购买不属于本页 Soul；已拒绝查询，请打开原 Soul 的恢复入口。':s==='PURCHASE_ORIGINAL_UNSUPPORTED_FORMAT'?'原购买格式不受本入口支持；请保留原文件并使用其原版本恢复入口。':s}
