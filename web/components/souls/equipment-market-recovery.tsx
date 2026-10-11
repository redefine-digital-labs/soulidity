'use client'

import {useState} from 'react'
import {useCurrentAccount} from '@mysten/dapp-kit'
import {readBrowserEquipmentMarketJournals} from '@/lib/animacraft/equipment-market-operation-store'
import type {EquipmentMarketOperationRecord} from '@/lib/animacraft/equipment-market-operation'

/** Available even when chain inventory is unavailable or the listed item left it. */
export function EquipmentMarketRecovery({onSelect}:{onSelect:(record:EquipmentMarketOperationRecord)=>void}){
  const account=useCurrentAccount(),actor=account?.address??null
  const [result,setResult]=useState<{actor:string;rows:EquipmentMarketOperationRecord[];error:string|null}|null>(null)
  const current=result?.actor===actor?result:null
  return <section aria-label="Saved component transactions" className="space-y-2 text-sm">
    <button type="button" disabled={!actor} onClick={()=>{
      if(!actor)return
      try{setResult({actor,rows:readBrowserEquipmentMarketJournals(actor),error:null})}
      catch(cause){setResult({actor,rows:[],error:cause instanceof Error?cause.message:'Saved transactions could not be read'})}
    }}>Find saved component transactions</button>
    {!actor&&<p>Connect your wallet to find its saved component transactions.</p>}
    {current?.error&&<p role="alert">{current.error}</p>}
    {current&&!current.error&&!current.rows.length&&<p>No component transactions saved for this wallet.</p>}
    {current?.rows.map(row=><div key={row.snapshot.asset.itemId} className="break-all">
      <p>{row.action} · {row.phase} · {row.snapshot.asset.itemId}</p>
      <button type="button" onClick={()=>{if(actor===row.snapshot.actor)onSelect(row)}}>Open saved component {row.snapshot.asset.itemId}</button>
    </div>)}
  </section>
}
