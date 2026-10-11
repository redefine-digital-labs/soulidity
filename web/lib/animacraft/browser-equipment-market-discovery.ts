import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {normalizeStructTag,fromBase58,toHex} from '@mysten/sui/utils'
import {createChainObjectDiscovery,profileReadStep,type ChainObjectDiscoveryPage,type ChainObjectDiscoveryOptions} from '@soulidity/sdk'
import {EquipmentReadSet} from './native-equipment'
import {EquipmentMarketListingBcs} from './native-equipment-market-bcs'
import {readEquipmentMarketListingSnapshot} from './native-equipment-market-read'
import {boundedNativeMarketClient} from './browser-native-market-read'
import {decodeNativeBcs,receiveId} from './native-receive'
import {MAINNET_GENESIS_DIGEST} from './mainnet-chain'
import type {BrowserNativeEquipmentMarketConfig} from './browser-native-equipment-market-read'

export type EquipmentMarketListingSnapshot=Awaited<ReturnType<typeof readEquipmentMarketListingSnapshot>>
export interface EquipmentMarketDiscoveryPage {
  listings:readonly EquipmentMarketListingSnapshot[]
  candidateStatus:ChainObjectDiscoveryPage['page']['status']
  source:ChainObjectDiscoveryPage['source'];verifiedCandidates:number
  readConsistency:'NON_ATOMIC_CURRENT_READSET';notAuthorization:true
}
function check(value:unknown,message:string):asserts value {if(!value)throw new Error(`Equipment Market discovery: ${message}`)}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}

/** Public shared-listing discovery, never wallet inventory. GraphQL supplies IDs
 * only; each candidate is authenticated through the exact release and raw custody
 * reader before it can appear. Failed pages retain their cursor for retry. */
export function createBrowserEquipmentMarketDiscovery(params:{client:SuiGrpcClient;config:BrowserNativeEquipmentMarketConfig;
  endpoint:string;chainIdentifier:string;paymentCoinType:string;actor:string|null;signal:AbortSignal},dependencies:{
    fetch?:typeof globalThis.fetch;limits?:Pick<ChainObjectDiscoveryOptions,'pageSize'|'maxPages'|'maxObjects'>
  }={}){
  const {client,signal:lifetime}=params,config=structuredClone(params.config),pin=config.target.equipmentMarket
  const endpoint=params.endpoint,coin=normalizeStructTag(params.paymentCoinType),actor=params.actor===null?null:receiveId(params.actor)
  const chainIdentifier=toHex(fromBase58(MAINNET_GENESIS_DIGEST).slice(0,4))
  check(params.chainIdentifier===chainIdentifier,'mainnet identity required')
  const settings={endpoint,pageSize:50,maxPages:200,maxObjects:10000,...structuredClone(dependencies.limits??{}),timeoutMs:25000}
  let discovery:ReturnType<typeof createChainObjectDiscovery>|null=null,type='',origin=''
  let pending:ChainObjectDiscoveryPage|null=null,page:ChainObjectDiscoveryPage|null=null
  let flight:Promise<ChainObjectDiscoveryPage>|null=null,busy=false,terminal=false
  const candidates=new Set<string>(),listings=new Map<string,EquipmentMarketListingSnapshot>()
  async function initialize(signal:AbortSignal){
    if(discovery)return
    const bounded=boundedNativeMarketClient(client,signal)
    const {response}=await bounded.ledgerService.getObject({objectId:pin.callablePackageId,
      readMask:{paths:['object_id','version','digest','owner','package']}})
    const object=response.object,pkg=object?.package
    check(object?.objectId===pin.callablePackageId&&object.digest===pin.callableDigest&&object.owner?.kind===4
      &&object.version&&pkg?.storageId===pin.callablePackageId&&pkg.originalId===pin.originalPackageId
      &&pkg.version===object.version,'package pin mismatch')
    const origins=pkg.typeOrigins.filter(row=>row.moduleName==='market_v8'&&row.datatypeName==='EquipmentListingV8')
    check(origins.length===1,'listing type origin unavailable')
    origin=receiveId(origins[0].packageId);type=`${origin}::market_v8::EquipmentListingV8<${coin}>`
    discovery=createChainObjectDiscovery({...settings,expectedChainIdentifier:chainIdentifier,
      scope:{packageId:origin,type,owner:{kind:'SHARED'}},fetch:dependencies.fetch})
  }
  return Object.freeze({async next({signal:caller}:{signal?:AbortSignal}={}):Promise<EquipmentMarketDiscoveryPage>{
    lifetime.throwIfAborted();caller?.throwIfAborted();check(!busy,'scan busy');check(!terminal,'scan ended');busy=true
    const controller=new AbortController(),signal=AbortSignal.any([lifetime,controller.signal,AbortSignal.timeout(120000),...(caller?[caller]:[])])
    try{
      await profileReadStep(signal,()=>initialize(signal))
      if(!pending)await profileReadStep(signal,()=>{
        flight??=discovery!.next({signal}).then(value=>{if(!lifetime.aborted)pending=value;return value}).finally(()=>{flight=null})
        return flight
      })
      signal.throwIfAborted();const next=pending;check(next,'candidate page unavailable')
      const source=next.source
      check(source.chainIdentifier===chainIdentifier&&source.endpoint===endpoint&&source.authority==='CANDIDATE_IDS_ONLY'
        &&source.scope.packageId===origin&&source.scope.type===type&&source.scope.owner?.kind==='SHARED'
        &&Object.keys(source.scope.owner).length===1&&(!page||JSON.stringify(source)===JSON.stringify(page.source)),'candidate scope changed')
      check(next.page.pagesRead===(page?.page.pagesRead??0)+1&&next.page.objectsRead===candidates.size+next.ids.length
        &&next.ids.length<=settings.pageSize&&next.page.objectsRead<=settings.maxObjects,'candidate count mismatch')
      const staged=new Set(candidates)
      for(const id of next.ids){receiveId(id);check(!staged.has(id),'duplicate candidate');staged.add(id)}
      const verified:EquipmentMarketListingSnapshot[]=[];let position=0
      await Promise.all(Array.from({length:Math.min(4,next.ids.length)},async()=>{
        while(position<next.ids.length){
          signal.throwIfAborted();const index=position++,listingId=next.ids[index]
          const itemSignal=AbortSignal.any([signal,AbortSignal.timeout(25000)])
          const bounded=boundedNativeMarketClient(client,itemSignal),reads=new EquipmentReadSet(bounded,true)
          const hint=decodeNativeBcs(EquipmentMarketListingBcs,await profileReadStep(itemSignal,()=>reads.read(listingId,type,3)))
          check(hint.id===listingId,'listing identity mismatch');receiveId(hint.root_id)
          const value=await profileReadStep(itemSignal,()=>readEquipmentMarketListingSnapshot(bounded,config.target,pin,
            {listingId,rootId:hint.root_id,...(actor?{actor}:{})},itemSignal,reads))
          check(value.listing.id===listingId&&value.rootId===hint.root_id&&value.target.paymentCoinType===coin,'authenticated listing scope mismatch')
          verified[index]=value
        }
      }))
      signal.throwIfAborted()
      for(const value of verified)if(value.listing.status===0)listings.set(value.listing.id,value)
      for(const id of next.ids)candidates.add(id)
      page=next;pending=null;terminal=next.page.status!=='PARTIAL'
      return freeze({listings:structuredClone([...listings.values()].sort((a,b)=>a.listing.id.localeCompare(b.listing.id))),
        candidateStatus:next.page.status,source:structuredClone(source),verifiedCandidates:candidates.size,
        readConsistency:'NON_ATOMIC_CURRENT_READSET',notAuthorization:true})
    }finally{controller.abort();busy=false}
  }})
}
