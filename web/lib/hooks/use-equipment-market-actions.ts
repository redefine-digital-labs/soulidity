'use client'

import {useEffect} from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import {useCurrentAccount,useCurrentWallet,useSignTransaction,useSuiClient} from '@mysten/dapp-kit'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {useQueryClient} from '@tanstack/react-query'
import {profileReadStep} from '@soulidity/sdk'
import {getBrowserNativeEquipmentMarketConfig,readBrowserEquipmentMarketOperation,
  type BrowserNativeEquipmentMarketConfig} from '@/lib/animacraft/browser-native-equipment-market-read'
import {confirmBrowserEquipmentMarketOperation} from '@/lib/animacraft/browser-equipment-market-readback'
import {browserEquipmentMarketOperationStore,runEquipmentMarketOperation,queryEquipmentMarketHistory} from '@/lib/animacraft/equipment-market-operation-store'
import {equipmentMarketOperationKey,terminalEquipmentMarketOperation,validateEquipmentMarketSnapshot,
  type EquipmentMarketOperationRecord,type EquipmentMarketOperationSnapshot,type EquipmentMarketAction} from '@/lib/animacraft/equipment-market-operation'
import {createEquipmentMarketOperationAdapter,equipmentMarketWritable} from '@/lib/animacraft/equipment-market-operation-adapter'
import type {EquipmentMarketReadRequest} from '@/lib/animacraft/equipment-market-operation-snapshot'
import {marketListCanonical} from '@/lib/animacraft/market-list-operation'

type HistoryResult='MISSING'|'PENDING'|'SUCCEEDED'|'FAILED'
/** The item/actor journal survives draft, listing and release changes. Recovery
 * synchronizes against its saved release, never the current UI configuration. */
export function useEquipmentMarketActions(params:{request:EquipmentMarketReadRequest|null;identityKey:string;
  action:EquipmentMarketAction;priceAtomic?:string}){
  const {identityKey,action,priceAtomic}=params,account=useCurrentAccount(),client=useSuiClient(),address=account?.address??null
  const {currentWallet}=useCurrentWallet(),{mutateAsync:signTransaction}=useSignTransaction(),queryClient=useQueryClient()
  const request=params.request?structuredClone(params.request):null
  let config:BrowserNativeEquipmentMarketConfig|null=null,configError:unknown
  try{if(request)config=getBrowserNativeEquipmentMarketConfig()}catch(cause){configError=cause}
  const key=marketListCanonical([request,identityKey,address,action,priceAtomic??null,config??message(configError)])
  const session=useCommittedSession(key,account,client,currentWallet),matches=session.matches
  const [snapshot,setSnapshot]=useSessionState<EquipmentMarketOperationSnapshot|null>(session,null)
  const [record,setRecord]=useSessionState<EquipmentMarketOperationRecord|null>(session,null)
  const [history,setHistory]=useSessionState<EquipmentMarketOperationRecord[]>(session,[]),[historyResults,setHistoryResults]=useSessionState<Record<string,HistoryResult>>(session,{})
  const [error,setError]=useSessionState<string|null>(session,null),[loading,setLoading]=useSessionState(session,Boolean(request&&request.actor===address)),[busy,setBusy]=useSessionState(session,false),[refreshIndex,setRefreshIndex]=useSessionState(session,0)
  const activeActor=Boolean(request&&request.actor===address)
  function readRecovery(){
    if(!request||!activeActor||!matches())return
    const store=browserEquipmentMarketOperationStore(),storageKey=equipmentMarketOperationKey(request.itemId,request.actor)
    const saved=store.read(storageKey),archived=store.history(storageKey)
    setRecord(saved);setHistory(archived)
  }
  useEffect(()=>{
    try{readRecovery()}catch(cause){setError(message(cause))}
    const changed=(event:StorageEvent)=>{
      if(!request||!activeActor)return
      const storageKey=equipmentMarketOperationKey(request.itemId,request.actor)
      if(event.key!==null&&event.key!==storageKey&&!event.key.startsWith(`${storageKey}:retired:`))return
      try{readRecovery()}catch(cause){setError(message(cause))}
    }
    window.addEventListener('storage',changed)
    return()=>{window.removeEventListener('storage',changed)}
  },[session])
  async function read(input:EquipmentMarketReadRequest,callerSignal?:AbortSignal,lease:SessionLease|null=session.capture()) {
    const matches=()=>lease?.matches()===true
    if(!request||!activeActor||!matches())throw new Error('Wallet or equipment session changed; reopen this item')
    if(!config)throw configError??new Error('Equipment Market configuration unavailable')
    if(input.actor!==request.actor||input.itemId!==request.itemId)throw new Error('Equipment recovery scope mismatch')
    const captured=structuredClone(input),controller=new AbortController();lease!.requests.add(controller)
    try{
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25000),...(callerSignal?[callerSignal]:[])])
      const value=validateEquipmentMarketSnapshot(await profileReadStep(signal,()=>readBrowserEquipmentMarketOperation({...captured,config:config!,signal})))
      if(!matches()||value.actor!==captured.actor||value.asset.itemId!==captured.itemId||value.asset.kind!==captured.kind
        ||value.target.rootId!==captured.rootId||value.listing?.id!==captured.listingId)
        throw new Error('Verified equipment does not match the selected item')
      return value
    }finally{lease!.requests.delete(controller)}
  }
  useEffect(()=>{
    if(!request||!activeActor)return
    const controller=new AbortController();let current=true
    void read(request,controller.signal).then(value=>{if(current&&matches()){setSnapshot(value)}})
      .catch(cause=>{if(current&&matches())setError(message(cause))}).finally(()=>{if(current&&matches())setLoading(false)})
    return()=>{current=false;controller.abort()}
  },[session,refreshIndex])
  const visibleSnapshot=snapshot
  const visibleRecord=record
  const visibleHistory=history
  const pending=Boolean(visibleRecord&&!terminalEquipmentMarketOperation(visibleRecord))
  const validPrice=!['list','reprice'].includes(action)||typeof priceAtomic==='string'&&/^[1-9][0-9]{0,19}$/.test(priceAtomic)
    &&BigInt(priceAtomic)>=40n&&BigInt(priceAtomic)<=18446744073709551615n
  const canStart=Boolean(activeActor&&account&&currentWallet&&visibleSnapshot&&equipmentMarketWritable(visibleSnapshot,action,address)
    &&validPrice&&!busy&&!loading&&!pending)
  function adapter(start=false,lease:SessionLease) {
    const matches=lease.matches
    const grpc=(client as unknown as {grpc?:SuiGrpcClient}).grpc
    if(!grpc)throw new Error('The verified gRPC wallet client is required')
    return createEquipmentMarketOperationAdapter({client:grpc,read:(input,signal)=>read(input,signal,lease),observed:start?visibleSnapshot??undefined:undefined,action,priceAtomic,
      getAddress:()=>matches()&&activeActor?address:null,
      sign:transaction=>{if(!matches()||!account||!activeActor)throw new Error('Wallet changed before equipment signature')
        return Promise.resolve(signTransaction({transaction,account,chain:'sui:mainnet'})).then(result=>{
          if(!matches())throw new Error('Wallet or network client changed during signature')
          return result
        })},
      sync:async value=>{
        if(!matches())throw new Error('Wallet changed; recover the saved equipment transaction after reconnecting')
        const controller=new AbortController();lease!.requests.add(controller)
        try{const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])
          const result=await profileReadStep(signal,()=>confirmBrowserEquipmentMarketOperation(value,{signal},{client:grpc}))
          if(!matches())throw new Error('Wallet changed during equipment readback');return result
        }finally{lease!.requests.delete(controller)}
      }})
  }
  async function run(start=false,queryOnly=false,cancelUnsigned=false,retireExpired=false){
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if(!request||!activeActor||!account||!currentWallet||!matches()||lease!.isRunning()||start&&!canStart)return null
    lease!.setRunning(true);setBusy(true);setError(null)
    try{
      const result=await runEquipmentMarketOperation({itemId:request.itemId,actor:request.actor,start,queryOnly,cancelUnsigned,retireExpired,
        store:browserEquipmentMarketOperationStore(),adapter:adapter(start,lease!),onRecord:value=>{if(matches()){setRecord(value)}}})
      if(!matches())return null
      readRecovery();setRecord(result)
      if(result.phase==='RETIRED'&&retireExpired){setSnapshot(null);setLoading(Boolean(request&&request.actor===address));setRefreshIndex(n=>n+1)}
      if(result.phase==='SUCCEEDED'){
        setSnapshot(null)
        for(const prefix of ['soul','my-souls','souls','owned-equipment','native-equipment','native-equipment-source','native-equipment-pack'])
          void queryClient.invalidateQueries({queryKey:[prefix]})
      }
      return result
    }catch(cause){if(matches()){setError(message(cause));try{readRecovery()}catch{/* Preserve original uncertainty. */}}return null}
    finally{lease!.setRunning(false);if(matches())setBusy(false)}
  }
  async function checkHistory(digest:string):Promise<HistoryResult|null>{
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if(!request||!activeActor||!account||!currentWallet||!matches()||lease!.isRunning())return null
    lease!.setRunning(true);setBusy(true);setError(null)
    try{const result=await queryEquipmentMarketHistory({itemId:request.itemId,actor:request.actor,digest,
      store:browserEquipmentMarketOperationStore(),adapter:adapter(false,lease!)})
      if(!matches())return null;setHistoryResults(prev=>({...prev,[digest]:result}));return result
    }catch(cause){if(matches())setError(message(cause));return null}
    finally{lease!.setRunning(false);if(matches())setBusy(false)}
  }
  return {snapshot:visibleSnapshot,record:visibleRecord,history:visibleHistory,historyResults,
    error,loading,busy,pending,canStart,checkHistory,start:()=>run(true),resume:()=>run(),check:()=>run(false,true),
    cancelUnsigned:()=>run(false,false,true),retireExpired:()=>run(false,false,false,true),
    refresh:async()=>{if(matches()){setError(null);setSnapshot(null);setLoading(Boolean(request&&request.actor===address));setRefreshIndex(n=>n+1)}}}
}
function message(cause:unknown){return cause instanceof Error?cause.message:cause===undefined?'':'Equipment result is unknown. Query the saved transaction before retrying.'}
