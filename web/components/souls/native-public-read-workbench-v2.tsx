'use client'
import {use,useState} from 'react'
import Link from 'next/link'
import {useQuery} from '@tanstack/react-query'
import {SuiGrpcClient} from '@mysten/sui/grpc'
import {GrpcWebFetchTransport} from '@protobuf-ts/grpcweb-transport'
import {getSuiGrpcFullnodeUrl} from '@soulidity/sdk'
import {withPackageObjectIdentity} from '@/lib/sui/package-object-client'
import {parseCanonicalNativeWorkbenchTarget} from '@/lib/soulidity/canonical-native-workbench'
import {nativePublicOwnerSourceKeyV2,readNativePublicReadOverviewV2} from '@/lib/soulidity/native-public-read-record-v2'
import {ManagementNativeGrantReaderV1} from './management-native-grant-reader-v1'
import {NativePublicPaidContentReaderV2} from './native-public-paid-content-reader-v2'
import {resolveNativePaidCheckoutV2} from '@/lib/soulidity/native-public-read-paid-checkout-config-v2'
import {NativePublicReadPaidCheckoutV2} from './native-public-read-paid-checkout-v2'
import {NativePublicReadPaidPurchaseV2,type NativePublicReadPaidPurchaseSelectionV2} from './native-public-read-paid-purchase-v2'
import {PageContainer} from '@/components/layout/page-container'
import {Button,buttonStyles} from '@/components/ui/button'
/** Explicit release-configured shared Host consumer. Failed proofs never try a
 * v1 ABI. The separate purchase flow requires an approved Root installation. */
export function NativePublicReadWorkbenchV2({params,releaseJson,paidEconomicsJson,paidPurchase=null}:{params:Promise<{id:string}>;releaseJson:string;paidEconomicsJson?:string;paidPurchase?:NativePublicReadPaidPurchaseSelectionV2|null}){
 const {id}=use(params),scope=JSON.stringify([id,releaseJson])
 const [page,setPage]=useState({scope,start:0}),start=page.scope===scope?page.start:0
 const query=useQuery({queryKey:['native-public-read-v2',scope,start],gcTime:0,retry:false,refetchOnWindowFocus:false,
  queryFn:({signal})=>{
   const target=parseCanonicalNativeWorkbenchTarget(JSON.parse(releaseJson))
   const client=withPackageObjectIdentity(new SuiGrpcClient({network:'mainnet',transport:new GrpcWebFetchTransport({baseUrl:getSuiGrpcFullnodeUrl('mainnet'),abort:signal})}),signal)
   return readNativePublicReadOverviewV2({client,target,soulId:id,recordStart:start,signal})
  }})
 const installation=resolveNativePaidCheckoutV2(releaseJson,paidEconomicsJson)
 const view=query.data&&!query.isError&&!query.isFetching?query.data:null
 return <PageContainer>
  <div className="my-5 flex flex-wrap justify-between gap-3"><Link href="/my-souls" className={buttonStyles({variant:'outline'})}>My Souls</Link><Link href={`/souls/${encodeURIComponent(id)}/purchase/recovery`} className={buttonStyles({variant:'outline'})}>Recover original purchase</Link><Button disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh content library</Button></div>
  {query.isFetching&&<p role="status">Verifying this Soul and its recorded content…</p>}
  {query.isError&&<div role="alert"><p>The content library could not be verified. Keep this Soul and retry the read.</p><p>{query.error.message}</p></div>}
  {view&&<article className="space-y-4 rounded-xl border border-border p-5">
   <h1 className="text-2xl font-bold">{view.reception.name}</h1><h2>Content library</h2>
   <p className="break-all" aria-label="Verified Soul ID">Soul ID: {view.soulId}</p>
   <p>{view.recordIndices.length} recorded versions</p>
   {view.recordSummaries.map(record=>{
    const sourceKey=JSON.stringify([scope,view.hostReference,view.kioskReference,view.libraryReference,record])
    const expectedSourceKey=nativePublicOwnerSourceKeyV2(view,record)
    const paidRead=(BigInt(record.readMask)&4n)!==0n&&BigInt(record.scope)>0n
    const purchaseProps={soulId:id,index:record.index,kind:record.kind,contentScope:record.scope,releaseJson,sourceKey}
    const selection=paidPurchase?.input.qualification.recordIndex===record.index?paidPurchase:null
    return <section key={record.index} className="rounded-lg border border-border p-3">
    <h3>{record.name} · version {record.version}</h3><p>{record.kind===0?'Soul document':record.kind===1?'Memory':`Content kind ${record.kind}`}</p>
    {record.deleted||record.purged?<p>This version is no longer available for reading.</p>:
     ((BigInt(record.readMask)&1n)!==0n||paidRead)?<NativePublicPaidContentReaderV2 soulId={id} index={record.index} releaseJson={releaseJson} ownerAddress={view.ownerAddress} ownerRead={(BigInt(record.readMask)&1n)!==0n} paidRead={paidRead}
      expectedOwnerSourceKey={expectedSourceKey}
      paidPreview={paidRead?{kind:record.kind,scope:record.scope,economicsJson:paidEconomicsJson}:undefined}
      sourceKey={sourceKey}/>:(BigInt(record.readMask)&2n)!==0n?<p>Read this version with a current grant below.</p>:<p>Protected reading is not connected for this content type.</p>}
    {!record.deleted&&!record.purged&&(BigInt(record.readMask)&2n)!==0n&&<ManagementNativeGrantReaderV1 soulId={id} index={record.index} releaseJson={releaseJson} sourceKey={sourceKey}/>}
    {!record.deleted&&!record.purged&&paidRead&&(installation&&!selection
     ?<NativePublicReadPaidCheckoutV2 {...purchaseProps} installation={installation} expectedSourceKey={expectedSourceKey}/>
     :<NativePublicReadPaidPurchaseV2 {...purchaseProps} selection={selection}/>)}
   </section>})}
   {!view.recordSummaries.length&&<p>No content versions on this page.</p>}
   <nav aria-label="Content version pages" className="flex gap-2"><Button variant="outline" disabled={start===0} onClick={()=>setPage({scope,start:Math.max(0,start-25)})}>Previous versions</Button><Button variant="outline" disabled={view.nextRecordStart===null} onClick={()=>{if(view.nextRecordStart!==null)setPage({scope,start:view.nextRecordStart})}}>Next versions</Button></nav>
  </article>}
 </PageContainer>
}
