import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { NativeWardrobePanel } from '../../../web/components/souls/native-wardrobe'
import { appendWireReviver } from './content-append-browser-runtime'

let data:any
let steps:any[]=[]
const requestedMode=new URLSearchParams(location.search).get('mode')
const mode=requestedMode==='pack-journey'?'pack-journey':requestedMode==='attach-pack'?'attach-pack':requestedMode==='equip'?'equip':'removal'
const lostResponse=new URLSearchParams(location.search).get('fault')==='lost-response'
const ledgerKey=`s8-controlled-${mode}${lostResponse?'-lost-response':''}-landed`
const landedIndex=()=>steps.findIndex(step=>step.record.digest===localStorage.getItem(ledgerKey))
const current=()=>steps[Math.min(landedIndex()+1,steps.length-1)]
const client:any={ledgerService:{
  getServiceInfo:async()=>({response:{chainId:'4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S'}}),
  getEpoch:async()=>({response:{epoch:{epoch:9n}}}),
  getTransaction:async({digest}:any)=>{
    const index=steps.findIndex(step=>step.record.digest===digest)
    if(index<0 || index>landedIndex())throw Object.assign(Error('No controlled result'),{code:'NOT_FOUND'})
    const data=steps[index]
    const effects=bcs.TransactionEffects.serialize({V2:{status:{Success:true},executedEpoch:'9',
      gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},
      transactionDigest:digest,gasObjectIndex:null,eventsDigest:null,dependencies:[],lamportVersion:'3',
      changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}).toBytes()
    return {response:{transaction:{digest,transaction:{digest,bcs:{value:fromBase64(data.record.bytes)}},
      effects:{transactionDigest:digest,bcs:{value:effects},status:{success:true}},checkpoint:42n}}}
  }
},core:{
  resolveTransactionPlugin:()=>async(builder:TransactionDataBuilder,_options:any,next:()=>Promise<void>)=>{
    const data=current()
    const resolved=data.transaction.inputs
    builder.inputs=builder.inputs.map(input=>{
      if(!input.UnresolvedObject)return input
      const match=resolved.find((row:any)=>(row.Object?.ImmOrOwnedObject?.objectId??row.Object?.SharedObject?.objectId)===input.UnresolvedObject!.objectId)
      if(!match)throw Error('Unsupported controlled object')
      return structuredClone(match)
    })
    builder.gasData=structuredClone(data.transaction.gasData);await next()
  },
  simulateTransaction:async({transaction}:any)=>{
    const data=current()
    if(toBase64(transaction)!==data.record.bytes)throw Error('Unsupported controlled transaction')
    return {$kind:'Transaction'}
  },
  executeTransaction:async({transaction,signatures}:any)=>{
    const data=current()
    if(toBase64(transaction)!==data.record.bytes || signatures[0]!==data.signature)throw Error('Changed controlled transaction')
    localStorage.setItem(ledgerKey,data.record.digest)
    if(lostResponse)throw Error('Controlled response lost after ledger acceptance; check saved transaction.')
    return {}
  }
}}
export const useCurrentAccount=()=>({address:data.record.owner})
export const useSuiClient=()=>({grpc:client})
export const useCurrentWallet=()=>({currentWallet:null})
export const useSignPersonalMessage=()=>({mutateAsync:async()=>{throw Error('No personal signing in this fixture')}})
export const useSignTransaction=()=>({mutateAsync:async({transaction}:{transaction:Transaction})=>{
  const data=current()
  const bytes=toBase64(await transaction.build())
  if(bytes!==data.record.bytes)throw Error('No live wallet; only the exact fixture can be signed')
  return {bytes,signature:data.signature}
}})
export async function readBrowserNativeEquipment({soulId,stateId}:any){
  if(soulId!==data.record.soulId || stateId!==data.record.stateId)throw Error('Wrong fixture Soul')
  const index=landedIndex()
  return structuredClone(index<0?steps[0].before:steps[index].after)
}
export function NativeOriginalPreview(){return <p>Artwork excluded from this equipment fixture.</p>}
export function NativeLoadouts(){return <p>Named loadouts excluded from this equipment fixture.</p>}
async function main(){
  data=JSON.parse(await(await fetch(mode==='removal'?'./wardrobe.json':`./wardrobe-${mode}.json`)).text(),appendWireReviver)
  steps=data.steps??[data]
  data=steps[0]
  createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}>
    <aside>Controlled snapshots and ledger, no live wallet or network broadcast. Original Wardrobe, action hook, transaction builder, signature checks and browser recovery store. Reload replays only this local fixture.</aside>
    <NativeWardrobePanel soulObjectId={data.record.soulId} stateObjectId={data.record.stateId}/>
  </QueryClientProvider>)
}
void main()
