'use client'

import {useEffect,useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {readBrowserOwnedEquipmentPage} from '@/lib/animacraft/browser-owned-equipment'
import {MAX_MARKET_BATCH_LIST_ROWS} from '@/lib/animacraft/market-batch-list-types'
import {equipmentMarketCurrency} from '@/lib/animacraft/equipment-market-amount'
import {batchSelectionId,type NativeBatchSelection} from './native-batch-listing-panel'

/** Kept separate from the draft: paging, retrying and switching Base/External
 * never selects or drops an asset. Parent keys this view by wallet identity. */
export function OwnedEquipmentSelection({owner,identityKey,selection,onChange,onVisibleIds}:{
  owner:string;identityKey:string;selection:NativeBatchSelection[];onChange:(rows:NativeBatchSelection[])=>void;onVisibleIds:(ids:string[])=>void
}){
  const [kind,setKind]=useState<'base'|'external'>('base'),[cursors,setCursors]=useState<string[]>([])
  const cursor=cursors.at(-1)
  const source=useQuery({queryKey:['owned-equipment',owner,identityKey,kind,cursor??null],retry:false,staleTime:0,
    queryFn:({signal})=>readBrowserOwnedEquipmentPage({owner,kind,cursor,signal})})
  const page=source.data?.owner===owner&&source.data.kind===kind&&!source.isError&&!source.isFetching?source.data:null
  const visible=page?.rows.map(row=>row.snapshot.asset.itemId)??[],visibleKey=visible.join(',')
  useEffect(()=>{onVisibleIds(visible);return()=>onVisibleIds([])},[visibleKey,onVisibleIds])
  const repeated=Boolean(page?.hasNextPage&&page.cursor&&cursors.includes(page.cursor))
  return <section aria-label="Wallet components" className="my-5 space-y-3 rounded-xl border border-border p-4 text-sm">
    <h2>Wallet components</h2>
    <p>Base and External instances owned by this wallet, even without a Soul. Choose each component separately; no Soul or Pack access is selected with it.</p>
    <div className="flex flex-wrap gap-3">
      <label>Component type <select aria-label="Wallet component type" value={kind} onChange={e=>{setKind(e.target.value as 'base'|'external');setCursors([])}}
        className="rounded border border-border bg-card p-2"><option value="base">Base</option><option value="external">External</option></select></label>
      <button type="button" disabled={source.isFetching} onClick={()=>void source.refetch()}>Refresh component page</button>
    </div>
    <p>Page {cursors.length+1}. Pages are read independently, not a complete atomic wallet snapshot. Signing rechecks every selected asset.</p>
    {source.isFetching&&<p role="status">Verifying wallet component ownership, source and equipment locks…</p>}
    {source.isError&&<p role="alert">{source.error.message} Retry this page; your sale selection is unchanged.</p>}
    {page&&!page.rows.length&&<p>No {kind==='base'?'Base':'External'} instances on this page.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{page?.rows.map(({request,snapshot:s})=>{
      const selected=selection.some(row=>batchSelectionId(row)===s.asset.itemId),full=selection.length>=MAX_MARKET_BATCH_LIST_ROWS
      const available=s.available.list
      const toggle=()=>{
        if(selected){onChange(selection.filter(row=>batchSelectionId(row)!==s.asset.itemId));return}
        if(!available||full)return
        onChange([...selection,{assetType:'equipment',rootId:request.rootId,itemId:request.itemId,kind:request.kind,
          ...(request.equipmentScope?{equipmentScope:request.equipmentScope}:{}),paymentCoinType:s.target.paymentCoinType,
          name:`${request.kind==='base'?'Base':'External'} ${request.itemId.slice(0,8)}…${request.itemId.slice(-4)}`,price:''}])
      }
      return <article key={s.asset.itemId} className="min-w-0 space-y-2 rounded border border-border p-3">
        <label className="flex items-start gap-2"><input type="checkbox" aria-label={`Select component ${s.asset.itemId}`} checked={selected}
          disabled={!selected&&(!available||full)} onChange={toggle}/><span>{request.kind==='base'?'Base':'External'} instance</span></label>
        <p className="break-all font-mono text-xs">{s.asset.itemId}</p><p className="break-all">Maker {request.rootId}</p>
        <p>Price currency: {equipmentMarketCurrency(s.target.paymentCoinType).label} · platform fee 2.5%</p>
        <p className="break-all">Payment type: {s.target.paymentCoinType}</p>
        {s.removal?<p className="break-all">Equipped on Soul {s.removal.soulId}. Selecting this component will include its atomic removal, not sale of the Soul.</p>
          :s.lock?<p>Locked instance has no verified sale-removal plan or its transfer rights prohibit sale. Unavailable for sale here.</p>:<p>Not equipped.</p>}
        {!available&&!s.lock&&<p>Current source or transfer rights do not permit listing this instance.</p>}
        {!s.release.marketWritesEnabled||!s.release.equipmentWritesEnabled?<p>Signing is disabled for this release. Existing recovery remains available.</p>:null}
      </article>
    })}</div>
    {repeated&&<p role="alert">Component scan stopped before completion: the cursor repeated. Refresh from the first page.</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={!cursors.length||source.isFetching} onClick={()=>setCursors([])}>First component page</button>
      <button type="button" disabled={!cursors.length||source.isFetching} onClick={()=>setCursors(previous=>previous.slice(0,-1))}>Previous component page</button>
      <button type="button" disabled={!page?.hasNextPage||!page.cursor||source.isFetching||repeated}
        onClick={()=>{if(page?.cursor&&page.hasNextPage&&!repeated)setCursors(previous=>[...previous,page.cursor!])}}>Next component page</button>
    </div>
    {page&&!page.hasNextPage&&<p>Last page of this component type at read time; the other type is a separate view.</p>}
  </section>
}
