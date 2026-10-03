'use client'

import {useState} from 'react'
import {formatEquipmentMarketAmount} from '@/lib/animacraft/equipment-market-amount'
import {usePublicEquipmentMarketSource} from '@/lib/hooks/use-public-market'
import {EquipmentMarketPanel} from './equipment-market-panel'
import {EquipmentMarketRecovery} from './equipment-market-recovery'
import {equipmentMarketReadRequest} from '@/lib/animacraft/equipment-market-operation-adapter'
import type {EquipmentMarketReadRequest} from '@/lib/animacraft/equipment-market-operation-snapshot'
import type {EquipmentMarketAction} from '@/lib/animacraft/equipment-market-operation'

export function EquipmentMarketBrowser(){
  const source=usePublicEquipmentMarketSource(),[own,setOwn]=useState(false),[query,setQuery]=useState(''),[page,setPage]=useState(1)
  const [selected,setSelected]=useState<{request:EquipmentMarketReadRequest;action:EquipmentMarketAction}|null>(null)
  const rows=(source.page?.listings??[]).filter(row=>(!own||row.listing.custody.holder===source.viewerAddress)
    &&[row.rootId,row.listing.id,row.listing.custody.asset_id,row.listing.custody.holder].some(value=>value.includes(query.trim().toLowerCase())))
  const pages=Math.max(1,Math.ceil(rows.length/12)),current=Math.min(page,pages),visible=rows.slice((current-1)*12,current*12)
  return <section aria-label="Component Market" className="space-y-4">
    <h2>Components</h2><p>Independent Base and External instances. Buying a component does not buy its Soul or Pack access.</p>
    <div className="flex flex-wrap gap-3">
      <label>Search item, Maker, listing or seller <input aria-label="Search component Market" value={query}
        className="rounded border border-border bg-card p-2" onChange={e=>{setQuery(e.target.value);setPage(1)}}/></label>
      <label><input type="checkbox" checked={own} onChange={e=>{setOwn(e.target.checked);setPage(1)}}/> My listings</label>
    </div>
    <div aria-label="Component scan" className="space-y-2 rounded border border-border p-3 text-sm">
      <p>{source.coverage==='COMPLETE'?'Scan complete':source.coverage==='LIMIT_REACHED'?'Scan limit reached — results are incomplete':'Partial results'} · {source.progress.pages} pages · {source.page?.verifiedCandidates??0} verified candidates</p>
      <p>Discovery and current custody reads are non-atomic. Signing rechecks the selected listing.</p>
      {source.progress.busy&&<p role="status">Reading component listings…</p>}
      {source.error&&<p role="alert">{source.error.message}</p>}
      <button type="button" disabled={!source.progress.busy} onClick={source.pause}>Pause component scan</button>
      <button type="button" disabled={source.progress.busy||['COMPLETE','LIMIT_REACHED'].includes(source.coverage)} onClick={()=>void source.resume()}>Continue component scan</button>
      <button type="button" onClick={()=>void source.refresh()}>Refresh component Market</button>
    </div>
    {own&&!source.viewerAddress&&<p>Connect your wallet to view your listings.</p>}
    {!visible.length&&<p>{source.coverage==='COMPLETE'?'No matching open component listings.':'No matching listings verified yet. Continue or retry the scan.'}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map(row=>{
      const listing=row.listing,isOwner=listing.custody.holder===source.viewerAddress
      const choose=(action:EquipmentMarketAction)=>{if(source.viewerAddress)setSelected({action,request:{actor:source.viewerAddress,
        rootId:row.rootId,itemId:listing.custody.asset_id,kind:listing.custody.asset_kind===0?'base':'external',listingId:listing.id}})}
      return <article key={listing.id} className="min-w-0 space-y-2 break-all rounded-xl border border-border p-4 text-sm">
        <h3>{listing.custody.asset_kind===0?'Base':'External'} component</h3>
        <p>Item {listing.custody.asset_id}</p><p>Maker {row.rootId}</p><p>Seller {listing.custody.holder}</p>
        <p>{formatEquipmentMarketAmount(row.quote.grossAtomic,row.target.paymentCoinType)} · platform fee 2.5%</p>
        {isOwner?<div className="flex flex-wrap gap-3">
          <button type="button" disabled={!row.current} onClick={()=>choose('reprice')}>Review price change</button>
          <button type="button" disabled={!row.cancelAvailable} onClick={()=>choose('cancel')}>Review cancellation</button>
        </div>:<button type="button" disabled={!row.buyAvailable} onClick={()=>choose('buy')}>Review component purchase</button>}
        {row.recoverAvailable&&source.viewerAddress&&<button type="button" onClick={()=>choose('recover')}>Review component recovery</button>}
        {!source.viewerAddress&&<p>Connect a wallet to review a purchase.</p>}
      </article>
    })}</div>
    <div className="flex gap-3"><button type="button" disabled={current<=1} onClick={()=>setPage(current-1)}>Previous component page</button>
      <span>{current}/{pages}</span><button type="button" disabled={current>=pages} onClick={()=>setPage(current+1)}>Next component page</button></div>
    <EquipmentMarketRecovery onSelect={record=>setSelected({request:equipmentMarketReadRequest(record.snapshot),action:record.action})}/>
    {selected&&selected.request.actor===source.viewerAddress&&<EquipmentMarketPanel key={JSON.stringify([selected.request,selected.action])}
      {...selected} identityKey={source.identityKey}/>}
  </section>
}
