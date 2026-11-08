'use client'

import React,{useEffect,useRef,useState} from 'react'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {MARKET_BUY_FUNDS_ORIGINAL} from '../../lib/animacraft/market-buy-funds-original'
import type {PurchaseRecoveryQuery,PurchaseRecoveryOriginal} from '../../lib/soulidity/commerce/purchase-recovery-original'
import {readCommerceAddressFunds} from '../../lib/soulidity/commerce/address-funds-read'
import {readCommercePayoutCoins} from '../../lib/soulidity/commerce/payout-coins'
import {readCommerceOwnedCoinInventory} from '../../lib/soulidity/commerce/owned-coin-inventory'
import {readEconomicsIncome} from '../../lib/soulidity/commerce/economics-read'

type Funds=Awaited<ReturnType<typeof readCommerceAddressFunds>>
type Payout=Awaited<ReturnType<typeof readCommercePayoutCoins>>
type Inventory=Awaited<ReturnType<typeof readCommerceOwnedCoinInventory>>
type Income=Awaited<ReturnType<typeof readEconomicsIncome>>
type Observation<T>={pending:boolean;value:T|null;error:string|null}
const empty=<T,>():Observation<T>=>({pending:false,value:null,error:null})
type Recipient = {owner:string;amount:string;roles:string[];payouts:Array<{coinId:string;amount:string}>}
const checkoutRole = {seller:'卖方',soulCreator:'Soul 作者',makerSource:'Maker 来源方',service:'服务方'}
function recipients(original:PurchaseRecoveryQuery):{coinType:string;rows:Recipient[]}{
 if(original.kind===MARKET_BUY_FUNDS_ORIGINAL){
  const proof=original.history
  if(proof.status!=='VERIFIED')return {coinType:'',rows:[]}
  const rows=new Map<string,Recipient>()
  for(const group of proof.payouts){
   const row=rows.get(group.owner)??{owner:group.owner,amount:'0',roles:[],payouts:[]}
   row.amount=String(BigInt(row.amount)+BigInt(group.amount)*BigInt(group.coinIds.length))
   row.roles.push(...group.roles.map(role=>checkoutRole[role]))
   row.payouts.push(...group.coinIds.map(coinId=>({coinId,amount:group.amount})))
   rows.set(group.owner,row)
  }
  return {coinType:proof.coinType,rows:[...rows.values()]}
 }
 const h=original.history,money='receipt'in h?h.receipt.money:null
 if(!money)return {coinType:'',rows:[]}
 const payouts='payouts'in money?money.payouts:[money.payout],owners=[...new Set(payouts.map(p=>p.owner))]
 return {coinType:money.coinType,rows:owners.map(owner=>{const own=payouts.filter(p=>p.owner===owner);return {owner,amount:String(own.reduce((s,p)=>s+BigInt(p.amount),0n)),roles:'seller'in money?[...(money.seller===owner?['卖方']:[]),...(money.creator===owner?[money.sourceBinding?.soulBinding&&!money.requiresOriginalSourceBindingProof?'原 Soul 作者':'原挂牌作者']:[]),...(money.collectionSnapshot&&money.collectionHolder===owner?['合集持有人']:[])]:['内容受款方'],payouts:own.map(({coinId,amount})=>({coinId,amount}))}})}
}
/** Receives only an actual parent history result. No recipient input, current
 * environment fallback, automatic reads, wallet operations or journal writes. */
export function PurchaseRecoveryFunds({original,record,client}:{original:PurchaseRecoveryQuery;record:PurchaseRecoveryOriginal;client:SuiGrpcClient}){
 const derived=recipients(original),scope=JSON.stringify([record,original],(_k,v)=>typeof v==='bigint'?{bigint:String(v)}:v),current=useRef({scope,client});current.current={scope,client}
 type View={scope:string;client:SuiGrpcClient;owner:string;payout:Observation<Payout>;inventory:Observation<Inventory>;funds:Observation<Funds>;income:Observation<Income>;stopped:boolean;incomeStopped:boolean}
 const fresh=():View=>({scope,client,owner:'',payout:empty(),inventory:empty(),funds:empty(),income:empty(),stopped:false,incomeStopped:false})
 const [state,setState]=useState<View>(fresh),serial=useRef(0),incomeSerial=useRef(0),active=useRef<AbortController|null>(null),incomeActive=useRef<AbortController|null>(null)
 useEffect(()=>{serial.current++;incomeSerial.current++;active.current?.abort();incomeActive.current?.abort();setState(fresh());return()=>{serial.current++;incomeSerial.current++;active.current?.abort();incomeActive.current?.abort()}},[scope,client])
 const view=state.scope===scope&&state.client===client?state:fresh(),selected=derived.rows.find(r=>r.owner===view.owner),pending=view.payout.pending||view.inventory.pending||view.funds.pending
 const valid=(id:number)=>serial.current===id&&current.current.scope===scope&&current.current.client===client
 function choose(owner:string){serial.current++;active.current?.abort();setState(s=>({...s,owner:derived.rows.some(r=>r.owner===owner)?owner:'',payout:empty(),inventory:empty(),funds:empty(),stopped:false}))}
 async function query(){
  if(!selected)return
  const id=++serial.current,owner=selected.owner,controller=new AbortController();active.current?.abort();active.current=controller
  setState(s=>({...s,payout:{...empty<Payout>(),pending:true},inventory:{...empty<Inventory>(),pending:true},funds:{...empty<Funds>(),pending:true},stopped:false}))
  const getObservedAddress=()=>valid(id)&&!controller.signal.aborted?owner:null
  const update=<K extends 'payout'|'inventory'|'funds'>(key:K,value:View[K])=>{if(valid(id)&&!controller.signal.aborted)setState(s=>valid(id)&&!controller.signal.aborted&&s.scope===scope&&s.client===client&&s.owner===owner?{...s,[key]:value}:s)}
  async function observe<K extends 'payout'|'inventory'|'funds'>(key:K,read:()=>Promise<NonNullable<View[K]['value']>>){try{update(key,{pending:false,value:await read(),error:null} as View[K])}catch(e){update(key,{pending:false,value:null,error:e instanceof Error?e.message:'当前资金查询未完成。'} as View[K])}}
  const signal=controller.signal
  await Promise.allSettled([
   observe('payout',()=>readCommercePayoutCoins({client,owner,coinType:derived.coinType,payouts:structuredClone(selected.payouts),getViewerAddress:getObservedAddress,signal})),
   observe('inventory',()=>readCommerceOwnedCoinInventory({client,owner,coinType:derived.coinType,getViewerAddress:getObservedAddress,signal})),
   observe('funds',()=>readCommerceAddressFunds({client,owner,coinType:derived.coinType,getObservedAddress,signal})),
  ])
 }
 function stop(){serial.current++;active.current?.abort();setState(s=>({...s,payout:{...s.payout,pending:false},inventory:{...s.inventory,pending:false},funds:{...s.funds,pending:false},stopped:true}))}
 async function queryIncome(){
  if(record.kind===MARKET_BUY_FUNDS_ORIGINAL)return
  const id=++incomeSerial.current,controller=new AbortController();incomeActive.current?.abort();incomeActive.current=controller
  const validIncome=()=>incomeSerial.current===id&&!controller.signal.aborted&&current.current.scope===scope&&current.current.client===client
  setState(s=>({...s,income:{...empty<Income>(),pending:true},incomeStopped:false}))
  try{const value=await readEconomicsIncome({client,target:structuredClone(record.value.context.economics),signal:controller.signal});if(validIncome())setState(s=>validIncome()&&s.scope===scope&&s.client===client?{...s,income:{pending:false,value,error:null}}:s)}
  catch(e){if(validIncome())setState(s=>validIncome()&&s.scope===scope&&s.client===client?{...s,income:{pending:false,value:null,error:e instanceof Error?e.message:'当前协议收入查询未完成。'}}:s)}
 }
 function stopIncome(){incomeSerial.current++;incomeActive.current?.abort();setState(s=>({...s,income:{...s.income,pending:false},incomeStopped:true}))}
 return <section aria-label="原收款地址当前资金" className="space-y-3">
  <h2 className="font-semibold">原收款地址当前资金</h2>
  <p>地址仅来自已核验的原直接收款证据。无需连接钱包；公开观察不证明你控制该地址。</p>
  <label>原收款地址<select className="block w-full max-w-full" value={view.owner} onChange={e=>choose(e.currentTarget.value)}><option value="">选择原收款地址</option>{derived.rows.map(r=><option key={r.owner} value={r.owner}>{r.roles.join('、')} · {r.owner} · 原收款 {r.amount}</option>)}</select></label>
  {selected&&<><p>原受款角色：{selected.roles.join('、')}</p><p className="break-all">观察地址：{selected.owner}</p><p className="break-all">币种：{derived.coinType} · 原直接收款金额（最小单位）：{selected.amount}</p>
   <button type="button" className="rounded border px-3 py-1" disabled={pending} onClick={()=>void query()}>查询所选地址当前资金</button>{pending&&<button type="button" className="rounded border px-3 py-1" onClick={stop}>停止当前资金查询</button>}
  </>}
  {view.stopped&&<p role="status">当前资金查询已停止，保留已显示的观察；未完成的部分不表示余额为零。原付款证据保持不变。</p>}
  {view.payout.pending&&<p role="status">正在核对原收款 Coin 现状…</p>}
  {view.payout.error&&<p role="alert">原收款 Coin 现状查询未完成：{view.payout.error}。不据此认定原付款失败。</p>}
  {view.payout.value&&<article aria-label="原收款 Coin 现状">{view.payout.value.observations.map(p=><p key={p.coinId} className="break-all">{p.coinId} · 原支付 {p.originalAmount} · {p.status==='CURRENTLY_OWNED'?`当前仍由所选地址持有，此 Coin 当前余额 ${p.currentCoinBalance}`:p.status==='OTHER_OWNER'?'当前已不属于所选地址':'当前不可查询；不代表余额为零或原付款失败'}</p>)}</article>}
  {view.inventory.pending&&<p role="status">正在核对当前 Coin 对象…</p>}
  {view.inventory.error&&<p role="alert">当前 Coin 对象查询未完成：{view.inventory.error}。不表示余额为零。</p>}
  {view.inventory.value&&<p aria-label="当前 Coin 对象合计">当前 Coin 对象合计（最小单位）：{view.inventory.value.observedCoinBalance} · 对象数 {view.inventory.value.coins.length}</p>}
  {view.funds.pending&&<p role="status">正在查询 Coin 与地址余额…</p>}
  {view.funds.error&&<p role="alert">Coin 与地址余额查询未完成：{view.funds.error}。缺失字段不会按零处理。</p>}
  {view.funds.value&&<article aria-label="当前单币种余额"><p>当前 Coin 余额（最小单位）：{view.funds.value.coinBalance}</p><p>当前地址余额（最小单位）：{view.funds.value.addressBalance}</p><p>当前该币种合计（最小单位）：{view.funds.value.balance}</p></article>}
  {view.funds.value&&view.inventory.value&&view.funds.value.coinBalance!==view.inventory.value.observedCoinBalance&&<p role="status">两次 Coin 观察不一致，查询期间资金可能变化；请重新查询，不能合并为同一时刻的资金证明。</p>}
  <p>各项来自独立观察，不是同一检查点快照，也不说明原收入还剩多少、其他币种余额、可签名金额或提款权限。</p>
  {record.kind!==MARKET_BUY_FUNDS_ORIGINAL&&<article aria-label="当前协议收入" className="space-y-2"><h2 className="font-semibold">当前协议收入</h2>
   <p>协议账本与作者、卖方、服务方地址资金分开。只读取原文件固定的配置，不证明 Admin 或提款权限。</p>
   <button type="button" className="rounded border px-3 py-1" disabled={view.income.pending} onClick={()=>void queryIncome()}>查询当前协议收入</button>{view.income.pending&&<button type="button" className="rounded border px-3 py-1" onClick={stopIncome}>停止协议收入查询</button>}
   {view.incomeStopped&&<p role="status">本次协议收入查询已停止；没有取消链上操作。</p>}
   {view.income.error&&<p role="alert">当前协议收入查询未完成：{view.income.error}。不表示账本余额为零。</p>}
   {view.income.value&&<><p>当前协议账本余额（最小单位）：{view.income.value.ledger.balance}</p><p>累计收取：{view.income.value.ledger.collected} · 累计提取：{view.income.value.ledger.withdrawn} · 账本修订：{view.income.value.ledger.revision}</p><p>协议{view.income.value.config.enabled?'已启用':'已禁用'}，{view.income.value.config.paused?'已暂停':'未暂停'}；这些标记不替代提款资格检查。</p></>}
  </article>}
 </section>
}
