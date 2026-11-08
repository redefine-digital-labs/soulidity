'use client'

import React,{useEffect,useRef,useState} from 'react'
import {SuiGrpcClient} from '@mysten/sui/grpc'
import {GrpcWebFetchTransport} from '@protobuf-ts/grpcweb-transport'
import {getSuiGrpcFullnodeUrl} from '@soulidity/sdk'
import {withPackageObjectIdentity} from '@/lib/sui/package-object-client'
import {importIncomeWithdrawalRecoveryRecord,incomeWithdrawalRecoveryProps} from '@/lib/soulidity/commerce/income-withdrawal-recovery-record'
import {IncomeWithdrawalRecovery} from '@/components/commerce/income-withdrawal-recovery'

function defaultClient(signal:AbortSignal){return withPackageObjectIdentity(new SuiGrpcClient({network:'mainnet',transport:new GrpcWebFetchTransport({baseUrl:getSuiGrpcFullnodeUrl('mainnet'),abort:signal})}),signal)}
type Original=ReturnType<typeof incomeWithdrawalRecoveryProps>
/** Memory-only explicit portable record import. No journal writes or replacement operations. */
export function IncomeWithdrawalRecoveryImport({viewerAddress,createReadOnlyClient=defaultClient}:{viewerAddress:string|null;createReadOnlyClient?:(signal:AbortSignal)=>SuiGrpcClient}){
 const serial=useRef(0),[state,setState]=useState<{id:number;name:string;original:Original|null;error:string|null}>({id:0,name:'',original:null,error:null})
 useEffect(()=>()=>{serial.current++},[])
 async function select(file:File|undefined){
  const id=++serial.current;setState({id,name:file?.name??'',original:null,error:null})
  if(!file)return
  try{
   if(file.size===0||file.size>300000)throw Error('WITHDRAW_RECORD_FILE_BOUND')
   const text=await file.text()
   if(serial.current!==id)return
   if(new TextEncoder().encode(text).byteLength>300000)throw Error('WITHDRAW_RECORD_FILE_BOUND')
   const original=incomeWithdrawalRecoveryProps(importIncomeWithdrawalRecoveryRecord(text))
   if(serial.current===id)setState({id,name:file.name,original,error:null})
  }catch(error){if(serial.current===id)setState({id,name:file.name,original:null,error:error instanceof Error?error.message:'无法读取原提款文件。'})}
 }
 return <section aria-label="导入原提款记录" className="space-y-4">
  <p>选择明确的原提款恢复文件。文件仅保留在本页内存中；导入后需手动查询原交易，无需连接钱包。</p>
  <label>原提款恢复文件<input type="file" accept="application/json,.json" onChange={event=>void select(event.currentTarget.files?.[0])}/></label>
  {state.name&&<p>已选择：{state.name}</p>}
  {state.error&&<p role="alert">{state.error}</p>}
  {state.original&&<IncomeWithdrawalRecovery key={state.id} {...state.original} client={createReadOnlyClient} viewerAddress={viewerAddress}/>}
 </section>
}
