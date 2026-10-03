'use client'

import {useEffect} from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import {useCurrentAccount,useCurrentWallet,useSignTransaction,useSuiClient} from '@mysten/dapp-kit'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {useQueryClient} from '@tanstack/react-query'
import {profileReadStep} from '@soulidity/sdk'
import {getBrowserNativeMarketConfig,getBrowserNativeMarketCancelConfig,readBrowserNativeMarketBatchList,
  type BrowserNativeMarketConfig,type BrowserNativeMarketCancelConfig} from '@/lib/animacraft/browser-native-market-read'
import {confirmBrowserNativeMarketBatchList} from '@/lib/animacraft/browser-native-market-readback'
import {confirmBrowserSelectedMarketSale} from '@/lib/animacraft/browser-selected-market-sale-readback'
import {selectedBatchRecord} from '@/lib/animacraft/market-batch-list-operation'
import {browserMarketBatchListOperationStore,marketBatchListOperationKey,runMarketBatchListOperation,queryMarketBatchListHistory,
  terminalMarketBatchListOperation,validateMarketBatchListSnapshot,validateMarketBatchListSelection} from '@/lib/animacraft/market-batch-list-operation'
import {createMarketBatchListOperationAdapter,batchListingSelection,batchListingWritable} from '@/lib/animacraft/market-batch-list-operation-adapter'
import {marketListCanonical} from '@/lib/animacraft/market-list-operation'
import type {NativeMarketBatchListSnapshot,BatchMarketListOperationRecord,MarketBatchListSelection} from '@/lib/animacraft/market-batch-list-types'

type HistoryResult='MISSING'|'PENDING'|'SUCCEEDED'|'FAILED'
/** Selection edits revoke only new intent. The owner-scoped saved batch remains
 * recoverable without current inventory, current selection or public write gates. */
export function useNativeMarketBatchListActions(params:{owner:string|null;identityKey:string;selection:MarketBatchListSelection[]}){
  const {owner,identityKey}=params,account=useCurrentAccount(),client=useSuiClient(),address=account?.address??null
  const {currentWallet}=useCurrentWallet(),{mutateAsync:signTransaction}=useSignTransaction(),queryClient=useQueryClient()
  let selection:MarketBatchListSelection[]=[],selectionError:unknown
  try{if(params.selection.length)selection=validateMarketBatchListSelection(params.selection)}catch(cause){selectionError=cause}
  let config:BrowserNativeMarketConfig|null=null,configError:unknown,readback:BrowserNativeMarketCancelConfig|null=null,readbackError:unknown
  try{if(owner)config=getBrowserNativeMarketConfig()}catch(cause){configError=cause}
  try{if(owner)readback=getBrowserNativeMarketCancelConfig()}catch(cause){readbackError=cause}
  const key=marketListCanonical([owner,identityKey,address,selection,message(selectionError),config??message(configError),readback??message(readbackError)])
  const session=useCommittedSession(key,account,client,currentWallet),matches=session.matches
  const [snapshot,setSnapshot]=useSessionState<NativeMarketBatchListSnapshot|null>(session,null)
  const [record,setRecord]=useSessionState<BatchMarketListOperationRecord|null>(session,null)
  const [history,setHistory]=useSessionState<BatchMarketListOperationRecord[]>(session,[]),[historyResults,setHistoryResults]=useSessionState<Record<string,HistoryResult>>(session,{})
  const [error,setError]=useSessionState<string|null>(session,selectionError?message(selectionError):null),[loading,setLoading]=useSessionState(session,Boolean(owner!==null&&owner===address&&selection.length)),[busy,setBusy]=useSessionState(session,false),[refreshIndex,setRefreshIndex]=useSessionState(session,0)
  const activeOwner=owner!==null&&owner===address
  function readRecovery(){
    if(!activeOwner||!matches())return
    const store=browserMarketBatchListOperationStore(),storageKey=marketBatchListOperationKey(owner!)
    const saved=store.read(storageKey),archived=store.history(storageKey)
    setRecord(saved);setHistory(archived)
  }
  useEffect(()=>{
    try{readRecovery()}catch(cause){setError(message(cause))}
    const changed=(event:StorageEvent)=>{
      if(!activeOwner)return
      const storageKey=marketBatchListOperationKey(owner!)
      if(event.key!==null&&event.key!==storageKey&&!event.key.startsWith(`${storageKey}:retired:`))return
      try{readRecovery()}catch(cause){setError(message(cause))}
    }
    window.addEventListener('storage',changed)
    return()=>{window.removeEventListener('storage',changed)}
  },[session])
  async function read(rows:MarketBatchListSelection[],callerSignal?:AbortSignal,lease:SessionLease|null=session.capture()) {
    const matches=()=>lease?.matches()===true
    if(!activeOwner||!matches())throw new Error('Wallet or selection session changed; reopen selected sale')
    if(!config)throw configError??new Error('Native market configuration unavailable')
    const captured=validateMarketBatchListSelection(rows),controller=new AbortController();lease!.requests.add(controller)
    try{
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25000),...(callerSignal?[callerSignal]:[])])
      const value=validateMarketBatchListSnapshot(await profileReadStep(signal,()=>readBrowserNativeMarketBatchList({owner:owner!,selection:captured,config:config!,signal})))
      if(!matches()||value.owner!==owner||marketListCanonical(batchListingSelection(value))!==marketListCanonical(captured))
        throw new Error('Verified batch does not match the exact selected assets and prices')
      return value
    }finally{lease!.requests.delete(controller)}
  }
  useEffect(()=>{
    if(!activeOwner||!selection.length)return
    const controller=new AbortController();let current=true
    void read(selection,controller.signal).then(value=>{if(current&&matches()){setSnapshot(value)}})
      .catch(cause=>{if(current&&matches())setError(message(cause))}).finally(()=>{if(current&&matches())setLoading(false)})
    return()=>{current=false;controller.abort()}
  },[session,refreshIndex])
  const visibleSnapshot=snapshot?.owner===owner?snapshot:null
  const visibleRecord=record?.owner===owner?record:null
  const visibleHistory=history.filter(row=>row.owner===owner)
  const pending=Boolean(visibleRecord&&!terminalMarketBatchListOperation(visibleRecord))
  const canStart=Boolean(activeOwner&&account&&currentWallet&&visibleSnapshot&&batchListingWritable(visibleSnapshot,address)&&!busy&&!loading&&!pending)
  function adapter(start=false,lease:SessionLease) {
    const matches=lease.matches
    const grpc=(client as unknown as {grpc?:SuiGrpcClient}).grpc
    if(!grpc)throw new Error('The verified gRPC wallet client is required')
    return createMarketBatchListOperationAdapter({client:grpc,read:(rows,signal)=>read(rows,signal,lease),observed:start?visibleSnapshot??undefined:undefined,
      getAddress:()=>matches()&&activeOwner?address:null,
      sign:transaction=>{if(!matches()||!account||!activeOwner)throw new Error('Wallet changed before batch signature')
        return Promise.resolve(signTransaction({transaction,account,chain:'sui:mainnet'})).then(result=>{
          if(!matches())throw new Error('Wallet or network client changed during signature')
          return result
        })},
      sync:async value=>{
        if(!matches())throw new Error('Wallet changed; recover the saved batch after reconnecting')
        if(!readback)throw readbackError??new Error('Native release configuration unavailable; saved batch remains queryable')
        const controller=new AbortController();lease!.requests.add(controller)
        try{const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(120000)])
          const result=await profileReadStep(signal,()=>value.equipment!==undefined
            ?confirmBrowserSelectedMarketSale(selectedBatchRecord(value),{target:readback!.target,signal},{client:grpc})
            :confirmBrowserNativeMarketBatchList(value,{target:readback!.target,signal},{client:grpc}))
          if(!matches())throw new Error('Wallet changed during batch readback');return result
        }finally{lease!.requests.delete(controller)}
      }})
  }
  async function run(start=false,queryOnly=false,cancelUnsigned=false,retireExpired=false){
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if(!activeOwner||!account||!currentWallet||!matches()||lease!.isRunning()||start&&!canStart)return null
    lease!.setRunning(true);setBusy(true);setError(null)
    try{
      const result=await runMarketBatchListOperation({owner:owner!,start,queryOnly,cancelUnsigned,retireExpired,
        store:browserMarketBatchListOperationStore(),adapter:adapter(start,lease!),onRecord:value=>{if(matches()){setRecord(value)}}})
      if(!matches())return null
      readRecovery();setRecord(result)
      if(result.phase==='RETIRED'&&retireExpired){setSnapshot(null);setLoading(Boolean(owner!==null&&owner===address&&selection.length));setRefreshIndex(n=>n+1)}
      if(result.phase==='SUCCEEDED'){
        setSnapshot(null)
        void queryClient.invalidateQueries({queryKey:['soul']});void queryClient.invalidateQueries({queryKey:['my-souls']});void queryClient.invalidateQueries({queryKey:['souls']})
        for(const prefix of ['owned-equipment','native-equipment','native-equipment-source','native-equipment-pack'])
          void queryClient.invalidateQueries({queryKey:[prefix]})
      }
      return result
    }catch(cause){if(matches()){setError(message(cause));try{readRecovery()}catch{/* Keep original uncertainty. */}}return null}
    finally{lease!.setRunning(false);if(matches())setBusy(false)}
  }
  async function checkHistory(digest:string):Promise<HistoryResult|null>{
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if(!activeOwner||!account||!currentWallet||!matches()||lease!.isRunning())return null
    lease!.setRunning(true);setBusy(true);setError(null)
    try{const result=await queryMarketBatchListHistory({owner:owner!,digest,store:browserMarketBatchListOperationStore(),adapter:adapter(false,lease!)})
      if(!matches())return null;setHistoryResults(prev=>({...prev,[digest]:result}));return result
    }catch(cause){if(matches())setError(message(cause));return null}
    finally{lease!.setRunning(false);if(matches())setBusy(false)}
  }
  return {snapshot:visibleSnapshot,record:visibleRecord,history:visibleHistory,historyResults,
    error,loading,busy,pending,canStart,checkHistory,start:()=>run(true),resume:()=>run(),check:()=>run(false,true),
    cancelUnsigned:()=>run(false,false,true),retireExpired:()=>run(false,false,false,true),
    refresh:async()=>{if(matches()){setError(null);setSnapshot(null);setLoading(Boolean(owner!==null&&owner===address&&selection.length));setRefreshIndex(n=>n+1)}}}
}
function message(cause:unknown){return cause instanceof Error?cause.message:cause===undefined?'':'Batch result is unknown. Check the saved transaction before retrying.'}
