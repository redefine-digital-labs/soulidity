import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {NativeBatchListingPanel,type NativeBatchSelection} from '../../../web/components/souls/native-batch-listing-panel'
import {marketBatchListFixture} from './market-batch-list-operation'
import {validateMarketBatchListSnapshot} from '../../../web/lib/animacraft/market-batch-list-operation'

// Controlled visual/interaction fixture only. The real panel is bundled, but
// its hook is replaced here. No wallet, RPC, signature or execution is wired.
let sample:Awaited<ReturnType<typeof marketBatchListFixture>>
export function useNativeMarketBatchListActions(input:any){
  const [record,setRecord]=useState<any>(null),[error,setError]=useState<string|null>(null)
  const rows=input.selection.map((row:any)=>({assetType:'soul',snapshot:sample.snapshot.rows.find(v=>v.snapshot.soulId===row.soulId)!.snapshot,priceAtomic:row.priceAtomic}))
  const snapshot=rows.length?validateMarketBatchListSnapshot({schema:'native-market-batch-list-v1',owner:input.owner,rows}):null
  return {snapshot,record,history:[],historyResults:{},error,loading:false,busy:false,pending:record?.phase==='PREPARED',canStart:!!snapshot&&!record,
    start:async()=>{setRecord({...sample.record,rows});setError('CONTROLLED FIXTURE: prepared display only. No wallet or transaction was submitted.')},
    refresh:async()=>setError(null),resume:async()=>setError('CONTROLLED FIXTURE: no wallet connected.'),
    check:async()=>setError('CONTROLLED FIXTURE: saved packet retained; no network query.'),cancelUnsigned:async()=>{setRecord(null);setError(null)},
    retireExpired:async()=>{},checkHistory:async()=>null}
}
function App(){
  const [selection,setSelection]=useState<NativeBatchSelection[]>([]),[visible,setVisible]=useState(true)
  return <main className="mx-auto max-w-5xl p-4">
    <p className="rounded border border-gold p-3 text-gold">S10 controlled browser fixture — real batch panel, mocked wallet/readiness. Not live acceptance.</p>
    <div className="my-3 flex gap-4"><button onClick={()=>setVisible(!visible)}>Toggle candidate visibility</button><button onClick={()=>setSelection([])}>Clear draft selection</button></div>
    {visible&&sample.snapshot.rows.map(({snapshot:s},index)=><label key={s.soulId} className="mr-4 inline-flex gap-2">
      <input type="checkbox" checked={selection.some(row=>row.soulId===s.soulId)} onChange={event=>setSelection(event.target.checked?
        [...selection,{soulId:s.soulId,stateId:s.stateId,name:`Fixture Soul ${index+1}`,price:''}]:selection.filter(row=>row.soulId!==s.soulId))}/>
      Fixture Soul {index+1}
    </label>)}
    <NativeBatchListingPanel owner={sample.snapshot.owner} identityKey="controlled-fixture" selection={selection}
      visibleIds={visible?sample.snapshot.rows.map(row=>row.snapshot.soulId):[]} onChange={setSelection}/>
  </main>
}
void marketBatchListFixture().then(value=>{sample=value;createRoot(document.getElementById('root')!).render(<App/>)})
