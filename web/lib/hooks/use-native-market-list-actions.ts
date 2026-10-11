'use client'

import {useEffect} from 'react'
import {useCommittedSession,useSessionState,type SessionLease} from './use-committed-session'
import {useCurrentAccount,useCurrentWallet,useSignTransaction,useSuiClient} from '@mysten/dapp-kit'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {useQueryClient} from '@tanstack/react-query'
import {profileReadStep} from '@soulidity/sdk'
import {getBrowserNativeMarketConfig,getBrowserNativeMarketCancelConfig,readBrowserNativeMarketList,
  type BrowserNativeMarketConfig,type BrowserNativeMarketCancelConfig} from '@/lib/animacraft/browser-native-market-read'
import {confirmBrowserNativeMarketList} from '@/lib/animacraft/browser-native-market-readback'
import {browserMarketListOperationStore,marketListOperationKey,runMarketListOperation,queryMarketListHistory,
  terminalMarketListOperation,validateMarketListSnapshot,type MarketListOperationRecord} from '@/lib/animacraft/market-list-operation'
import type {NativeMarketListSnapshot} from '@/lib/animacraft/market-list-types'
import {createMarketListOperationAdapter} from '@/lib/animacraft/market-list-operation-adapter'

type HistoryResult='MISSING'|'PENDING'|'SUCCEEDED'|'FAILED'
type Scope={soulId:string;stateId:string;listingId:string|null}|null
type Intent='list'|'reprice'

/** Public readiness reads never authorize a wallet. LIST/REPRICE share one saved
 * Soul+owner intent, recoverable even after the listing or current owner changes. */
export function useNativeMarketListActions(scope:Scope) {
  const account=useCurrentAccount(),client=useSuiClient()
  const {currentWallet}=useCurrentWallet(),{mutateAsync:signTransaction}=useSignTransaction()
  const queryClient=useQueryClient(),address=account?.address??null
  let releaseConfig:BrowserNativeMarketConfig|null=null,configError:unknown
  try {if(scope)releaseConfig=getBrowserNativeMarketConfig()}catch(cause){configError=cause}
  let readbackConfig:BrowserNativeMarketCancelConfig|null=null,readbackError:unknown
  try {if(scope)readbackConfig=getBrowserNativeMarketCancelConfig()}catch(cause){readbackError=cause}
  const key=JSON.stringify([scope?.soulId,scope?.stateId,scope?.listingId,address,
    releaseConfig??message(configError),readbackConfig??message(readbackError)])
  const session=useCommittedSession(key,account,client,currentWallet),matches=session.matches
  const [snapshot,setSnapshot]=useSessionState<NativeMarketListSnapshot|null>(session,null)
  const [record,setRecord]=useSessionState<MarketListOperationRecord|null>(session,null)
  const [confirmedResult,setConfirmedResult]=useSessionState<MarketListOperationRecord|null>(session,null)
  const [history,setHistory]=useSessionState<MarketListOperationRecord[]>(session,[])
  const [historyResults,setHistoryResults]=useSessionState<Record<string,HistoryResult>>(session,{})
  const [error,setError]=useSessionState<string|null>(session,null),[loading,setLoading]=useSessionState(session,Boolean(scope)),[busy,setBusy]=useSessionState(session,false)
  const [refreshIndex,setRefreshIndex]=useSessionState(session,0)
  function readRecovery() {
    if(!scope || !address || !matches())return
    const store=browserMarketListOperationStore(),storageKey=marketListOperationKey(scope.soulId,address)
    const saved=store.read(storageKey),archived=store.history(storageKey)
    setRecord(saved);setHistory(archived)
  }
  useEffect(()=>{
    try {readRecovery()}catch(cause){setError(message(cause))}
    const changed=(event:StorageEvent)=>{
      if(!scope || !address)return
      const storageKey=marketListOperationKey(scope.soulId,address)
      if(event.key!==null && event.key!==storageKey && !event.key.startsWith(`${storageKey}:retired:`))return
      // Even an identical cached digest is not fresh proof of the current listing.
      setConfirmedResult(null)
      try {readRecovery()}catch(cause){setError(message(cause))}
    }
    window.addEventListener('storage',changed)
    return ()=>{
      window.removeEventListener('storage',changed)
    }
  },[session])

  async function read(listingId=scope?.listingId??undefined,capId?:string,lease:SessionLease|null=session.capture()) {
    const matches=()=>lease?.matches()===true
    if(!scope || !matches())throw new Error('Soul or wallet session changed; reopen listing')
    if(!releaseConfig)throw configError??new Error('Native market configuration unavailable')
    const controller=new AbortController();lease!.requests.add(controller)
    try {
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])
      const value=await profileReadStep(signal,()=>readBrowserNativeMarketList({soulId:scope.soulId,
        stateId:scope.stateId,listingId,kioskCapId:capId,config:releaseConfig!,signal}))
      const verified=validateMarketListSnapshot(value)
      if(!matches() || verified.soulId!==scope.soulId || verified.stateId!==scope.stateId)
        throw new Error('Listing snapshot does not match this Soul')
      return verified
    } finally {lease!.requests.delete(controller)}
  }
  useEffect(()=>{
    if(!scope)return
    let current=true
    void read().then(value=>{if(current && matches()){setSnapshot(value)}})
      .catch(cause=>{if(current && matches())setError(message(cause))})
      .finally(()=>{if(current && matches())setLoading(false)})
    return ()=>{current=false}
  },[session,refreshIndex])

  const ownedRecord=(value:MarketListOperationRecord|null)=>value?.snapshot.soulId===scope?.soulId
    && value?.snapshot.stateId===scope?.stateId && value?.snapshot.owner===address
  const visibleRecord=ownedRecord(record)?record:null
  const visibleHistory=history.filter(value=>ownedRecord(value))
  const visibleSnapshot=snapshot?.soulId===scope?.soulId && snapshot?.stateId===scope?.stateId?snapshot:null
  const visibleConfirmed=confirmedResult?.digest===visibleRecord?.digest
    && confirmedResult?.kind===visibleRecord?.kind && confirmedResult?.priceAtomic===visibleRecord?.priceAtomic
    && confirmedResult?.snapshot.listingId===visibleRecord?.snapshot.listingId?confirmedResult:null
  const pending=Boolean(visibleRecord && !terminalMarketListOperation(visibleRecord))
  const needsRecovery=pending || visibleRecord?.phase==='RETIRED' || visibleRecord?.phase==='SUCCEEDED'
    && (!visibleConfirmed || visibleRecord.syncStatus==='PENDING')
  const ready=Boolean(scope && account && currentWallet && visibleSnapshot?.owner===address
    && visibleSnapshot.release.writesEnabled
    && (visibleSnapshot.equipmentId===null || visibleSnapshot.equipmentSale?.writesEnabled===true)
    && !busy && !loading && !pending)
  const canList=ready && visibleSnapshot?.listAvailable===true,canReprice=ready && visibleSnapshot?.repriceAvailable===true

  function createAdapter(intent:Intent|undefined,priceAtomic:bigint|undefined,lease:SessionLease) {
    const matches=lease.matches
    const grpc=(client as unknown as {grpc?:SuiGrpcClient}).grpc
    if(!grpc)throw new Error('The verified gRPC wallet client is required')
    return createMarketListOperationAdapter({client:grpc,read:(listingId,capId)=>read(listingId,capId,lease),observed:intent?visibleSnapshot??undefined:undefined,intent,priceAtomic,
      getAddress:()=>matches()?address:null,
      sign:transaction=>{
        if(!matches() || !account)throw new Error('Wallet or network client changed before signature')
        return Promise.resolve(signTransaction({transaction,account,chain:'sui:mainnet'})).then(result=>{
          if(!matches())throw new Error('Wallet or network client changed during signature')
          return result
        })
      },
      sync:async value=>{
        if(!matches())throw new Error('Wallet changed; check the saved listing after reconnecting')
        if(!readbackConfig)throw readbackError??new Error('Native release configuration unavailable; saved transaction remains queryable')
        const controller=new AbortController();lease!.requests.add(controller)
        try {
          const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])
          const result=await profileReadStep(signal,()=>confirmBrowserNativeMarketList(value,
            {target:readbackConfig!.target,signal},{client:grpc}))
          if(!matches())throw new Error('Wallet changed during listing readback')
          return result
        } finally {lease!.requests.delete(controller)}
      },
    })
  }
  async function run(intent?:Intent,priceAtomic?:bigint,queryOnly=false,cancelUnsigned=false,retireExpired=false) {
    const lease=session.capture(),matches=()=>lease?.matches()===true
    const start=intent!==undefined
    if(!scope || !address || !account || !currentWallet || !matches() || lease!.isRunning()
      || (start && !(intent==='list'?canList:canReprice)))return null
    lease!.setRunning(true);setBusy(true);setError(null);setConfirmedResult(null)
    try {
      const result=await runMarketListOperation({soulId:scope.soulId,owner:address,start,queryOnly,cancelUnsigned,retireExpired,
        store:browserMarketListOperationStore(),adapter:createAdapter(intent,priceAtomic,lease!),
        onRecord:value=>{if(matches()){setRecord(value)}},
      })
      if(!matches())return null
      readRecovery();setRecord(result)
      if(result.phase==='RETIRED' && retireExpired){setSnapshot(null);setLoading(Boolean(scope));setRefreshIndex(value=>value+1)}
      if(result.phase==='SUCCEEDED') {
        setConfirmedResult(result)
        void queryClient.invalidateQueries({queryKey:['soul']});void queryClient.invalidateQueries({queryKey:['my-souls']})
        void queryClient.invalidateQueries({queryKey:['souls']})
      }
      return result
    } catch(cause) {
      if(matches()){
        setError(message(cause));try {readRecovery()}catch {/* Keep the original error and unknown transaction. */}
      }
      return null
    } finally {lease!.setRunning(false);if(matches())setBusy(false)}
  }
  async function checkHistory(digest:string):Promise<HistoryResult|null> {
    const lease=session.capture(),matches=()=>lease?.matches()===true
    if(!scope || !address || !account || !currentWallet || !matches() || lease!.isRunning())return null
    lease!.setRunning(true);setBusy(true);setError(null)
    try {
      const result=await queryMarketListHistory({soulId:scope.soulId,owner:address,digest,
        store:browserMarketListOperationStore(),adapter:createAdapter(undefined,undefined,lease!)})
      if(!matches())return null
      setHistoryResults(previous=>({...previous,[digest]:result}));return result
    } catch(cause){if(matches())setError(message(cause));return null}
    finally {lease!.setRunning(false);if(matches())setBusy(false)}
  }
  return {snapshot:visibleSnapshot,record:visibleRecord,confirmedResult:visibleConfirmed,history:visibleHistory,
    historyResults,error,loading,busy,pending,needsRecovery,
    wallet:account?{address:account.address}:null,canList,canReprice,
    refresh:()=>{setError(null);setConfirmedResult(null);setSnapshot(null);setLoading(Boolean(scope));setRefreshIndex(value=>value+1)},checkHistory,
    start:(priceAtomic:bigint,intent:Intent)=>run(intent,priceAtomic),resume:()=>run(),check:()=>run(undefined,undefined,true),
    cancelUnsigned:()=>run(undefined,undefined,false,true),retireExpired:()=>run(undefined,undefined,false,false,true)}
}
function message(cause:unknown) {
  return cause instanceof Error?cause.message:'Listing result is unknown. Check the saved transaction before retrying.'
}
