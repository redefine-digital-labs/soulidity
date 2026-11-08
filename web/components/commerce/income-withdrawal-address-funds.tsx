'use client'

import React,{useEffect,useRef,useState} from 'react'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {normalizeStructTag} from '@mysten/sui/utils'
import type {readMakerProductIncomeHistory} from '../../lib/soulidity/commerce/maker-product-income-history'
import type {readIncomeWithdrawalHistory} from '../../lib/soulidity/commerce/income-withdrawal-history'
import {commerceId} from '../../lib/soulidity/commerce/economics-read'
import {readCommerceAddressFunds} from '../../lib/soulidity/commerce/address-funds-read'
import {readCommercePayoutCoins} from '../../lib/soulidity/commerce/payout-coins'
type Original=Extract<Awaited<ReturnType<typeof readIncomeWithdrawalHistory | typeof readMakerProductIncomeHistory>>,{status:'WITHDRAWAL_EVIDENCE_CONFIRMED'}>
type Payouts=Awaited<ReturnType<typeof readCommercePayoutCoins>>
type Funds=Awaited<ReturnType<typeof readCommerceAddressFunds>>
type Client=SuiGrpcClient|((signal:AbortSignal)=>SuiGrpcClient)
const SUI=normalizeStructTag('0x2::sui::SUI')
/** Actual original receipt determines roles/currencies; no arbitrary address
 * input or metadata-based payee. Current raw balance is a separate public
 * observation, never remaining proceeds, wallet control or withdrawal rights. */
export function IncomeWithdrawalAddressFunds({original,client,viewerAddress,observePayoutCoin=false}:{original:Original;client:Client;viewerAddress:string|null;observePayoutCoin?:boolean}){
 const receipt=original.receipt.receipt,rows:Array<{coinType:string;roles:string[]}>=[]
 function add(coinType:string,role:string){try{const type=normalizeStructTag(coinType),row=rows.find(r=>r.coinType===type);if(row)row.roles.push(role);else rows.push({coinType:type,roles:[role]})}catch{/* Invalid proof currency cannot start a read. Original proof remains visible. */}}
 if(viewerAddress&&commerceId(viewerAddress)){
  if(viewerAddress===receipt.recipient)add(original.receipt.coinType,'原提款收款人')
  if(viewerAddress===receipt.actor)add(SUI,'原操作钱包（SUI）')
 }
 const scope=JSON.stringify([original,viewerAddress,observePayoutCoin],(_k,v)=>typeof v==='bigint'?{bigint:String(v)}:v),current=useRef({scope,client,viewerAddress});current.current={scope,client,viewerAddress}
 const serial=useRef(0),active=useRef<AbortController|null>(null)
 const observations=()=>({funds:null as Funds|null,error:null as string|null,payouts:null as Payouts|null,payoutError:null as string|null})
 const empty=()=>({scope,client,coinType:'',pending:false,...observations(),stopped:false})
 const [state,setState]=useState(empty)
 useEffect(()=>{serial.current++;active.current?.abort();setState(empty());return()=>{serial.current++;active.current?.abort()}},[scope,client])
 const view=state.scope===scope&&state.client===client?state:empty(),selected=rows.find(r=>r.coinType===view.coinType)
 const valid=(id:number)=>serial.current===id&&current.current.scope===scope&&current.current.client===client&&current.current.viewerAddress===viewerAddress
 function choose(coinType:string){const id=++serial.current;active.current?.abort();setState(s=>valid(id)&&s.scope===scope&&s.client===client?{...s,coinType:rows.some(r=>r.coinType===coinType)?coinType:'',pending:false,...observations(),stopped:false}:s)}
 async function query(){
  if(!selected||!viewerAddress)return
  const id=++serial.current,controller=new AbortController(),owner=viewerAddress,coinType=selected.coinType;active.current?.abort();active.current=controller
  const matches=()=>valid(id)&&!controller.signal.aborted
  const update=(patch:Partial<ReturnType<typeof empty>>)=>{if(matches())setState(s=>matches()&&s.scope===scope&&s.client===client&&s.coinType===coinType?{...s,...patch}:s)}
  update({pending:true,...observations(),stopped:false})
  const signal=controller.signal
  try{
   const reader=typeof client==='function'?client(signal):client
   const getObservedAddress=()=>matches()?current.current.viewerAddress:null
   const balance=readCommerceAddressFunds({client:reader,owner,coinType,getObservedAddress,signal})
    .then(funds=>update({funds}),e=>update({error:e instanceof Error?e.message:'当前余额查询未完成。'}))
   const payout=observePayoutCoin&&owner===receipt.recipient&&coinType===normalizeStructTag(original.receipt.coinType)
    ?readCommercePayoutCoins({client:reader,owner,coinType,getViewerAddress:getObservedAddress,signal,
      payouts:[{coinId:original.receipt.paymentCoinId,amount:receipt.amount}]})
      .then(payouts=>update({payouts}),e=>update({payoutError:e instanceof Error?e.message:'原收款 Coin 查询未完成。'}))
    :null
   await Promise.all([balance,payout])
  }catch(e){update({error:e instanceof Error?e.message:'当前余额查询未完成。'})}
  finally{update({pending:false})}
 }
 function stop(){const id=++serial.current;active.current?.abort();setState(s=>valid(id)&&s.scope===scope&&s.client===client?{...s,pending:false,stopped:true}:s)}
 return <section aria-label="提款后当前单币种资金" className="space-y-3 rounded-xl border p-4">
  <h3 className="font-medium">核对本钱包当前资金</h3>
  {!rows.length?<p>连接原提款收款人或原操作钱包后，可选择对应币种查询当前资金。原提款查询无需连接钱包。</p>:<>
   <p className="break-all">观察地址：{viewerAddress}</p>
   <label>观察币种<select aria-label="提款后观察币种" value={view.coinType} onChange={e=>choose(e.currentTarget.value)} className="block w-full max-w-full rounded border px-2 py-1"><option value="">请选择本次要核对的币种</option>{rows.map(r=><option key={r.coinType} value={r.coinType}>{r.roles.join('、')} · {r.coinType}</option>)}</select></label>
   {selected&&<p>原记录角色：{selected.roles.join('、')}</p>}
   <button type="button" disabled={!selected||view.pending} onClick={()=>void query()} className="rounded border px-3 py-1">查询本钱包当前单币种资金</button>
  </>}
  {view.pending&&<><p role="status">正在核对当前 Coin 与地址余额…</p><button type="button" onClick={stop}>停止本钱包资金查询</button></>}
  {view.stopped&&<p role="status">本次余额查询已停止；原提款结果仍保留，不能据此认定余额为零或重新提款。</p>}
  {view.error&&<p role="alert">当前单币种资金查询未完成：{view.error}。不表示余额为零或原提款失败。</p>}
  {view.payoutError&&<p role="alert">原收款 Coin 现状查询未完成：{view.payoutError}</p>}
  {view.payouts&&<article aria-label="原 Product 收款 Coin 现状" className="space-y-1 break-all text-sm">
   {view.payouts.observations.map(coin=><p key={coin.coinId}>{coin.coinId} · {coin.status==='CURRENTLY_OWNED'
    ?`仍由原收款钱包持有，当前 Coin 余额（最小单位）：${coin.currentCoinBalance}`
    :coin.status==='OTHER_OWNER'?'当前持有人已变更。':'当前 Coin 暂不可查询，原付款证据仍保留。'}</p>)}
  </article>}
  {view.funds&&<article aria-label="已核对提款后当前余额" className="space-y-1 break-all text-sm"><p>币种：{view.funds.coinType}</p><p>当前 Coin 余额（最小单位）：{view.funds.coinBalance}</p><p>当前地址余额（最小单位）：{view.funds.addressBalance}</p><p>当前该币种合计（最小单位）：{view.funds.balance}</p></article>}
  <p>这项公开资金观察与原提款、{observePayoutCoin?'Product 账本':'协议余额'}和 Coin 对象查询分别读取，不是同一检查点快照。不追踪本笔提款还剩多少，也不证明钱包控制权或再次提款权限。</p>
 </section>
}
