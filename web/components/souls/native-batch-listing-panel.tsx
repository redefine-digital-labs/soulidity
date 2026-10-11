'use client'

import {formatAtomicAmountForDisplay,parseDisplayAmountToAtomic} from '@soulidity/sdk'
import {useNativeMarketBatchListActions} from '@/lib/hooks/use-native-market-batch-list-actions'
import {MAX_MARKET_BATCH_LIST_ROWS} from '@/lib/animacraft/market-batch-list-types'
import type {NativeMarketListSnapshot} from '@/lib/animacraft/market-list-types'
import type {MarketBatchListRow,MarketBatchListSelection} from '@/lib/animacraft/market-batch-list-types'
import {equipmentMarketCurrency,formatEquipmentMarketAmount} from '@/lib/animacraft/equipment-market-amount'
import {equipmentOperationQuote} from '@/lib/animacraft/equipment-market-operation'
import type {SelectedSaleEquipmentPreparation} from '@/lib/animacraft/native-selected-equipment-sale'

export type NativeBatchSelection={soulId:string;stateId:string;name:string;price:string}|{
  assetType:'equipment';rootId:string;itemId:string;kind:'base'|'external';paymentCoinType:string;
  equipmentScope?:{soulId:string;stateId:string};name:string;price:string
}
export const batchSelectionId=(row:NativeBatchSelection)=>'assetType'in row?row.itemId:row.soulId
function currency(row:NativeBatchSelection){return 'assetType'in row?equipmentMarketCurrency(row.paymentCoinType):{decimals:6,label:'USDC'}}
function atomic(row:NativeBatchSelection):string|null {
  try {const value=parseDisplayAmountToAtomic(row.price,{decimals:currency(row).decimals});return value>=('assetType'in row?40n:1n)&&value<=18446744073709551615n?String(value):null}catch{return null}
}
function SavedRowReview({row,selectedEquipment=new Set<string>(),selectedSouls=new Set<string>()}:{row:MarketBatchListRow;selectedEquipment?:Set<string>;selectedSouls?:Set<string>}){
  if(row.assetType==='soul')return <RowReview {...row} selectedEquipment={selectedEquipment}/>
  const s=row.snapshot
  const quote=equipmentOperationQuote(s,row.priceAtomic)
  return <div className="min-w-0 space-y-2 break-words"><p>{s.asset.kind==='base'?'Base':'External'} instance · <span className="break-all font-mono">{s.asset.itemId}</span></p>
    <p>Gross price: {formatEquipmentMarketAmount(row.priceAtomic,s.target.paymentCoinType)} · platform fee 2.5%.</p>
    <p>Platform fee: {formatEquipmentMarketAmount(quote.protocolAtomic,s.target.paymentCoinType)} · seller receives {formatEquipmentMarketAmount(quote.sellerAtomic,s.target.paymentCoinType)}.</p>
    <p className="break-all">Payment type: {s.target.paymentCoinType}</p>
    <p>This instance is separately selected for sale, not bundled with its Soul.</p>
    {s.removal?<p>Atomically unequip from Soul <span className="break-all font-mono">{s.removal.soulId}</span>.
      {selectedSouls.has(s.removal.soulId)?' This Soul is also explicitly selected: clear its equipment and close the empty binding. Unchecked instances stay with the seller.'
        :' Keep the Soul and its binding; remove only the explicitly selected instances. Other equipment selections remain unchanged.'}</p>
      :<p>No equipment removal is included for this instance.</p>}</div>
}
function RowReview({snapshot:s,priceAtomic,equipmentOnly=false,selectedEquipment=new Set<string>()}:{snapshot:NativeMarketListSnapshot;priceAtomic:string;equipmentOnly?:boolean;selectedEquipment?:Set<string>}){
  return <div className="min-w-0 space-y-2 break-words">
    {!equipmentOnly&&<><p>Animacraft V8 Soul · <span className="break-all font-mono">{s.soulId}</span></p><p>Gross price: {formatAtomicAmountForDisplay(priceAtomic)}</p></>}
    {s.equipmentId===null?<p>No equipment binding.</p>:s.equipmentSale?<>
      <p>Equipment <span className="break-all font-mono">{s.equipmentSale.scope.equipmentId}</span> · revision {String(s.equipmentSale.scope.expectedRevision)}</p>
      <ul className="space-y-2">{s.equipmentSale.removals.map(row=><li key={row.kind==='selection'?`slot:${row.selectionIndex}`:row.itemId}>
        {row.kind==='selection'?`Clear usage selection at slot ${row.selectionIndex}; no equipment sale`
          :<>{row.kind==='base'?'Base':'External'} <span className="break-all font-mono">{row.itemId}</span>: unequip; {selectedEquipment.has(row.itemId)?'separately selected for its own listing':'stays in seller’s wallet, not sold'}</>}
      </li>)}</ul>
      <p>Close the empty binding; verify {s.equipmentSale.packs.length} attached Pack sources. No Pack/access right is sold.</p>
    </>:<p>Complete equipment removal proof unavailable.</p>}
  </div>
}
function GroupReview({groups}:{groups:SelectedSaleEquipmentPreparation[]}){
  return <div aria-label="Grouped equipment changes" className="space-y-2">{groups.filter(group=>group.equipment!==null).map(group=>{
    const e=group.equipment!
    return <div key={group.soulId} className="min-w-0 space-y-1 break-words rounded border border-border p-3">
      <p>Soul <span className="break-all font-mono">{group.soulId}</span> · equipment <span className="break-all font-mono">{e.plan.scope.equipmentId}</span></p>
      <p>One grouped change: revision {String(e.plan.scope.expectedRevision)} → {e.finalRevision}; {e.plan.removals.length} removals.</p>
      <p>{e.closeBinding?'Clear all equipment and close the empty Soul binding.':'Keep the Soul binding.'} Remaining selection slots: {e.retainedSelectionIndexes.length?e.retainedSelectionIndexes.join(', '):'none'}.</p>
    </div>
  })}</div>
}

/** Always mounted: draft selection is independent from the owner’s saved packet. */
export function NativeBatchListingPanel({owner,identityKey,selection,visibleIds,onChange}:{
  owner:string|null;identityKey:string;selection:NativeBatchSelection[];visibleIds:string[];onChange:(rows:NativeBatchSelection[])=>void
}){
  const priced=selection.map(row=>({...row,priceAtomic:atomic(row)}))
  const complete=priced.length>0&&priced.length<=MAX_MARKET_BATCH_LIST_ROWS&&priced.every(row=>row.priceAtomic!==null)
  const request:MarketBatchListSelection[]=complete?priced.map(row=>'assetType'in row
    ?{assetType:'equipment',rootId:row.rootId,itemId:row.itemId,kind:row.kind,priceAtomic:row.priceAtomic!,...(row.equipmentScope?{equipmentScope:row.equipmentScope}:{})}
    :{soulId:row.soulId,stateId:row.stateId,priceAtomic:row.priceAtomic!}):[]
  const actions=useNativeMarketBatchListActions({owner,identityKey,selection:request})
  const rows=actions.snapshot?.rows,soulOnly=selection.every(row=>!('assetType'in row))
  const exact=complete&&rows?.length===request.length&&rows.every((row,index)=>{
    const wanted=request[index]
    if(row.priceAtomic!==wanted.priceAtomic)return false
    if('assetType'in wanted){
      if(row.assetType!=='equipment')return false
      const s=row.snapshot,draft=selection[index]
      return s.actor===owner&&s.seller===owner&&s.asset.itemId===wanted.itemId&&s.asset.kind===wanted.kind&&s.target.rootId===wanted.rootId
        &&'assetType'in draft&&s.target.paymentCoinType===draft.paymentCoinType
        &&s.removal?.soulId===wanted.equipmentScope?.soulId&&s.removal?.stateId===wanted.equipmentScope?.stateId
        &&s.listing===null&&s.available.list&&s.release.marketWritesEnabled&&s.release.equipmentWritesEnabled
    }
    if(row.assetType!=='soul')return false
    const s=row.snapshot
    return s.owner===owner&&s.soulId===wanted.soulId&&s.stateId===wanted.stateId
      &&s.listAvailable&&!s.listed&&s.release.writesEnabled&&(s.equipmentId===null||s.equipmentSale?.writesEnabled===true)
  })
  const selectedEquipment=new Set(request.flatMap(row=>'assetType'in row?[row.itemId]:[])),selectedSouls=new Set(request.flatMap(row=>'assetType'in row?[]:[row.soulId]))
  const act=(work:()=>Promise<unknown>)=>{void work().catch(()=>{})}
  const record=actions.record
  return <section aria-label="Selected asset batch listing" className="my-5 space-y-3 rounded-xl border border-border bg-card2 p-4 text-sm">
    <h2 className="font-semibold">List selected assets · {selection.length}/{MAX_MARKET_BATCH_LIST_ROWS}</h2>
    <p>Explicit selection only. Selecting a Soul never selects its equipment for sale. At most {MAX_MARKET_BATCH_LIST_ROWS} assets per transaction.</p>
    <p>One atomic transaction, not separate signatures. Unchecked equipped instances removed from a selected Soul stay in the seller’s wallet; separately checked instances get their own listings. A failed step rolls back the whole transaction. Cancelling a listing does not re-equip anything.</p>
    {!selection.length&&<p>Select unlisted Animacraft Souls or wallet components in Owned. Nothing is selected automatically.</p>}
    {selection.map(row=><div key={batchSelectionId(row)} className="space-y-1 rounded border border-border p-3">
      <p>{row.name} · {'assetType'in row?`${row.kind==='base'?'Base':'External'} instance`:'Soul only'}</p><p className="break-all font-mono text-xs">{batchSelectionId(row)}</p>
      {!visibleIds.includes(batchSelectionId(row))&&<p>Selected {'assetType'in row?'component':'Soul'} is hidden by the current view or not in the current portfolio page. It remains selected until you remove it.</p>}
      <label className="block">{currency(row).label} price for {row.name}
        <input aria-label={`${currency(row).label} price ${batchSelectionId(row)}`} type="text" inputMode="decimal" value={row.price}
          onChange={event=>onChange(selection.map(value=>batchSelectionId(value)===batchSelectionId(row)?{...value,price:event.target.value}:value))}
          className="mt-1 w-full min-w-0 rounded border border-border bg-card p-2 sm:ml-2 sm:mt-0 sm:w-auto"/>
      </label>
      {atomic(row)===null&&<p>Enter an exact {currency(row).label} price (up to {currency(row).decimals} decimal places){'assetType'in row?'; at least 40 atomic units':'; greater than zero'}.</p>}
      <button type="button" onClick={()=>onChange(selection.filter(value=>batchSelectionId(value)!==batchSelectionId(row)))}>Remove selected {'assetType'in row?'component':'Soul'} {row.name}</button>
    </div>)}
    {selection.length>0&&!complete&&<p>No batch is readied until every selected asset has a valid price.</p>}
    {actions.loading&&<p role="status">Verifying the exact selected assets and equipment…</p>}
    {actions.error&&<p role="alert">{actions.error}</p>}
    {exact&&<div aria-label="Verified batch review" className="space-y-3">
      <h3>Confirm exactly these {rows!.length} {soulOnly?'Souls':'assets'}</h3>
      <div aria-label={soulOnly?'Mobile selected Soul review':'Mobile selected asset review'} className="space-y-3 sm:hidden">
        {rows!.map((row,index)=><article key={saleRowId(row)} aria-label={`Selected ${soulOnly?'Soul':'asset'} ${index+1}`}
          className="min-w-0 space-y-3 rounded border border-border p-3">
          <dl className="space-y-2">
            <div><dt className="text-muted">Asset ID</dt><dd className="break-all font-mono text-xs">{saleRowId(row)}</dd></div>
            <div><dt className="text-muted">Asset type</dt><dd>{saleRowType(row)}</dd></div>
            <div><dt className="text-muted">Gross price</dt><dd>{saleRowPrice(row)}</dd></div>
          </dl>
          <h4 className="font-medium">{soulOnly?'Equipment retained, not sold':'Equipment and separate sale effects'}</h4>
          {row.assetType==='soul'?<RowReview {...row} equipmentOnly selectedEquipment={selectedEquipment}/>
            :<SavedRowReview row={row} selectedEquipment={selectedEquipment} selectedSouls={selectedSouls}/>}
        </article>)}
      </div>
      <div aria-label={soulOnly?'Desktop selected Soul review':'Desktop selected asset review'} className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[640px] text-left text-xs">
        <thead><tr><th className="p-2">Asset ID</th><th className="p-2">Asset type</th><th className="p-2">Gross price</th><th className="p-2">Equipment and sale effects</th></tr></thead>
        <tbody>{rows!.map(row=><tr key={saleRowId(row)} className="border-t border-border align-top">
          <td className="p-2 break-all font-mono">{saleRowId(row)}</td><td className="p-2">{saleRowType(row)}</td>
          <td className="p-2 whitespace-nowrap">{saleRowPrice(row)}</td>
          <td className="p-2">{row.assetType==='soul'?<RowReview {...row} equipmentOnly selectedEquipment={selectedEquipment}/>
            :<SavedRowReview row={row} selectedEquipment={selectedEquipment} selectedSouls={selectedSouls}/>}</td>
        </tr>)}</tbody>
      </table></div>
      {actions.snapshot?.equipment&&<GroupReview groups={actions.snapshot.equipment}/>}
    </div>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={!complete||actions.loading||actions.busy} onClick={()=>act(actions.refresh)}>Refresh selected batch</button>
      <button type="button" disabled={!exact||!actions.canStart||actions.loading||actions.busy||actions.pending}
        onClick={()=>{if(exact&&actions.canStart&&!actions.pending&&!actions.busy&&!actions.loading)act(actions.start)}}>Sign & list selected {soulOnly?'Souls':'assets'} atomically</button>
    </div>
    <div aria-label="Batch listing recovery" className="space-y-2 border-t border-border pt-3">
      <h3>Saved batch listing recovery</h3>
      {!owner&&<p>Connect the owner wallet to load its saved batch.</p>}
      {!record&&<p>No saved batch loaded. Draft selection does not replace saved transactions.</p>}
      {record&&<>
        <p>Saved {record.phase} · {record.digest} · expires after epoch {record.expirationEpoch}</p>
        {record.rows.map(row=><SavedRowReview key={saleRowId(row)} row={row}
          selectedEquipment={new Set(record.rows.flatMap(value=>value.assetType==='equipment'?[value.snapshot.asset.itemId]:[]))}
          selectedSouls={new Set(record.rows.flatMap(value=>value.assetType==='soul'?[value.snapshot.soulId]:[]))}/>)}
        {record.equipment&&<GroupReview groups={record.equipment}/>}
        {record.phase==='SUCCEEDED'&&<p>Recorded transaction success; {record.syncStatus??'PENDING'} readback. This alone does not prove current ownership.</p>}
        <button type="button" disabled={actions.busy} onClick={()=>act(actions.check)}>Check saved batch</button>
        {['PREPARED','SIGNING','SIGNED'].includes(record.phase)&&<button type="button" disabled={actions.busy} onClick={()=>act(actions.resume)}>Resume saved batch</button>}
        {record.phase==='PREPARED'&&<button type="button" disabled={actions.busy} onClick={()=>act(actions.cancelUnsigned)}>Discard unsigned batch</button>}
        {['SIGNING','SIGNED'].includes(record.phase)&&<button type="button" disabled={actions.busy} onClick={()=>act(actions.retireExpired)}>Check expiry and archive batch</button>}
      </>}
      {actions.history.map(saved=><div key={saved.digest} className="break-all">
        <p>Archived batch {saved.digest}: {actions.historyResults[saved.digest]??'Not checked'}. Historical result, not current ownership.</p>
        <button type="button" disabled={actions.busy} onClick={()=>act(()=>actions.checkHistory(saved.digest))}>Check archived batch</button>
      </div>)}
    </div>
  </section>
}
function saleRowId(row:MarketBatchListRow){return row.assetType==='soul'?row.snapshot.soulId:row.snapshot.asset.itemId}
function saleRowType(row:MarketBatchListRow){return row.assetType==='soul'?'Animacraft V8 Soul':`${row.snapshot.asset.kind==='base'?'Base':'External'} instance`}
function saleRowPrice(row:MarketBatchListRow){return row.assetType==='soul'?formatAtomicAmountForDisplay(row.priceAtomic):formatEquipmentMarketAmount(row.priceAtomic,row.snapshot.target.paymentCoinType)}
