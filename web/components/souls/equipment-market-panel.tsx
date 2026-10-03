'use client'

import {useState} from 'react'
import {formatAtomicAmountForDisplay,parseDisplayAmountToAtomic} from '@soulidity/sdk'
import {useEquipmentMarketActions} from '@/lib/hooks/use-equipment-market-actions'
import {equipmentOperationQuote,type EquipmentMarketAction} from '@/lib/animacraft/equipment-market-operation'
import type {EquipmentMarketReadRequest} from '@/lib/animacraft/equipment-market-operation-snapshot'
import {equipmentMarketCurrency,formatEquipmentMarketAmount} from '@/lib/animacraft/equipment-market-amount'

function price(value:string,decimals:number){
  try{const n=parseDisplayAmountToAtomic(value,{decimals});return n>=40n&&n<=18446744073709551615n?String(n):undefined}catch{return undefined}
}
const labels:Record<EquipmentMarketAction,string>={list:'List selected component',buy:'Buy selected component',reprice:'Update component price',cancel:'Cancel component listing',recover:'Recover component'}
/** Selection is explicit; this review never enumerates or adds wallet assets. */
export function EquipmentMarketPanel({request,identityKey,action='list',blocked=false}:{
  request:EquipmentMarketReadRequest;identityKey:string;action?:EquipmentMarketAction;blocked?:boolean
}){
  const [amount,setAmount]=useState(''),[coin,setCoin]=useState<string|null>(null),currency=equipmentMarketCurrency(coin),priceAtomic=price(amount,currency.decimals)
  const actions=useEquipmentMarketActions({request,identityKey,action,priceAtomic})
  const s=actions.snapshot,r=actions.record,editable=action==='list'||action==='reprice'
  if(s&&s.target.paymentCoinType!==coin){setCoin(s.target.paymentCoinType);setAmount('')}
  const gross=editable?priceAtomic:s?.listing?.priceAtomic
  let quote:ReturnType<typeof equipmentOperationQuote>|null=null
  try{if(s&&gross)quote=equipmentOperationQuote(s,gross)}catch{/* Incomplete review cannot sign. */}
  const exact=Boolean(s&&s.actor===request.actor&&s.asset.itemId===request.itemId&&s.asset.kind===request.kind
    &&s.target.rootId===request.rootId&&s.listing?.id===request.listingId)
  const canStart=exact&&coin===s?.target.paymentCoinType&&Boolean(quote)&&actions.canStart&&!actions.busy&&!actions.pending&&!blocked
  const act=(work:()=>Promise<unknown>)=>{void work().catch(()=>{})}
  return <section aria-label="Selected component sale" className="space-y-3 rounded-xl border border-border p-4 text-sm">
    <h3>{labels[action]}</h3>
    <p className="break-all">{request.kind==='base'?'Base':'External'} component · <span className="font-mono">{request.itemId}</span></p>
    <p>Only this component is traded. No Soul, Pack access or unchecked component is included.</p>
    {editable&&<label className="block">Gross price ({currency.label})
      <input aria-label="Component gross price" type="text" inputMode="decimal" value={amount}
        className="mt-1 block w-full rounded border border-border bg-card p-2" onChange={event=>setAmount(event.target.value)}/>
      {!priceAtomic&&<span>Enter at least {formatAtomicAmountForDisplay('40',{decimals:currency.decimals,symbol:currency.label})}, with up to {currency.decimals} decimal places.</span>}
    </label>}
    {actions.loading&&<p role="status">Verifying selected component, custody and quote…</p>}
    {actions.error&&<p role="alert">{actions.error}</p>}
    {exact&&s&&<div aria-label="Verified component review" className="space-y-2 break-all">
      <p>Maker <span className="font-mono">{s.target.rootId}</span></p>
      <p>Payment type <span className="font-mono">{s.target.paymentCoinType}</span></p>
      {quote&&<><p>Gross {formatEquipmentMarketAmount(quote.grossAtomic,s.target.paymentCoinType)}</p>
        <p>Platform fee (2.5%): {formatEquipmentMarketAmount(quote.protocolAtomic,s.target.paymentCoinType)} · seller receives {formatEquipmentMarketAmount(quote.sellerAtomic,s.target.paymentCoinType)}</p></>}
      {s.removal?<p>Atomically unequip this component from Soul {s.removal.soulId}. Other selections and the Soul binding remain unchanged. A failed transaction leaves the equipment unchanged.</p>
        :s.lock?<p>Locked component: verified removal is unavailable. Nothing can be listed.</p>:<p>No equipment removal is included.</p>}
    </div>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={actions.busy||actions.loading} onClick={()=>act(actions.refresh)}>Refresh selected component</button>
      <button type="button" disabled={!canStart} onClick={()=>{if(canStart)act(actions.start)}}>Sign · {labels[action]}</button>
    </div>
    {blocked&&<p>Finish or recover the pending equipment change before starting another action.</p>}
    <div aria-label="Component transaction recovery" className="space-y-2 border-t border-border pt-3">
      <h4>Saved component transaction</h4>
      {!r&&<p>No saved transaction loaded for this item and wallet.</p>}
      {r&&<><p className="break-all">{r.action} · {r.phase} · {r.digest} · expires after epoch {r.expirationEpoch}</p>
        <p>Saved gross price: {formatEquipmentMarketAmount(r.priceAtomic,r.snapshot.target.paymentCoinType)}. Recovery uses the saved transaction, not the current price field.</p>
        {r.phase==='SUCCEEDED'&&<p>Transaction recorded; readback: {r.syncStatus??'PENDING'}. Historical success does not prove current ownership.</p>}
        <button type="button" disabled={actions.busy} onClick={()=>act(actions.check)}>Check saved component transaction</button>
        {['PREPARED','SIGNING','SIGNED'].includes(r.phase)&&<button type="button" disabled={actions.busy} onClick={()=>act(actions.resume)}>Resume saved component transaction</button>}
        {r.phase==='PREPARED'&&<button type="button" disabled={actions.busy} onClick={()=>act(actions.cancelUnsigned)}>Discard unsigned component transaction</button>}
        {['SIGNING','SIGNED'].includes(r.phase)&&<button type="button" disabled={actions.busy} onClick={()=>act(actions.retireExpired)}>Check expiry and archive component transaction</button>}
      </>}
      {actions.history.map(saved=><div key={saved.digest} className="break-all">
        <p>Archived {saved.digest}: {actions.historyResults[saved.digest]??'Not checked'}. Historical result only.</p>
        <button type="button" disabled={actions.busy} onClick={()=>act(()=>actions.checkHistory(saved.digest))}>Check archived component transaction</button>
      </div>)}
    </div>
  </section>
}
