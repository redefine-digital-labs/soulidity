import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {Inputs,Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {fromBase64,toBase64} from '@mysten/sui/utils'
import {verifyTransactionSignature} from '@mysten/sui/verify'
import {MAINNET_GENESIS_DIGEST} from './mainnet-chain'
import {marketListCheck as check,marketListCanonical as canonical} from './market-list-operation'
import {validateMarketCancelCheckpoint} from './market-cancel-checkpoint'
import {selectMarketPaymentCoins,recheckMarketPaymentCoins} from './market-payment-coins'
import {validateEquipmentMarketSnapshot,validateEquipmentMarketOperationRecord,buildEquipmentMarketOperationTransaction,
  type EquipmentMarketOperationSnapshot,type EquipmentMarketOperationRecord,type EquipmentMarketAction} from './equipment-market-operation'
import {queryEquipmentMarketOperationEvidence} from './equipment-market-operation-evidence'
import type {EquipmentMarketReadRequest} from './equipment-market-operation-snapshot'
import type {EquipmentMarketOperationAdapter} from './equipment-market-operation-store'

const TIMEOUT_MS=25_000
async function bounded<T>(work:(signal:AbortSignal)=>PromiseLike<T>,timeoutMs=TIMEOUT_MS):Promise<T>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('Equipment request timed out; recover the saved transaction'))},timeoutMs)
  })])}finally{clearTimeout(timer)}
}
export function equipmentMarketReadRequest(snapshot:EquipmentMarketOperationSnapshot):EquipmentMarketReadRequest{
  return {actor:snapshot.actor,rootId:snapshot.target.rootId,itemId:snapshot.asset.itemId,kind:snapshot.asset.kind,
    ...(snapshot.listing?{listingId:snapshot.listing.id}:{}),
    ...(snapshot.removal?{equipmentScope:{soulId:snapshot.removal.soulId,stateId:snapshot.removal.stateId}}:{})}
}
export function equipmentMarketWritable(s:EquipmentMarketOperationSnapshot,action:EquipmentMarketAction,address:string|null){
  return address===s.actor&&s.release.marketWritesEnabled===true&&s.release.equipmentWritesEnabled===true&&s.available[action]
}
/** One exact-byte adapter for all equipment intents. A missing observed draft
 * prevents preparation, never ledger-only recovery of an already saved packet. */
export function createEquipmentMarketOperationAdapter(params:{client:SuiGrpcClient;
  read:(request:EquipmentMarketReadRequest,signal:AbortSignal)=>Promise<EquipmentMarketOperationSnapshot>;
  observed?:EquipmentMarketOperationSnapshot;action?:EquipmentMarketAction;priceAtomic?:string;
  getAddress:()=>string|null;sign:(tx:Transaction)=>Promise<{bytes:string;signature:string}>;
  sync:(record:EquipmentMarketOperationRecord)=>Promise<'COMPLETE'|'SUPERSEDED'>}):EquipmentMarketOperationAdapter{
  const {client,read,getAddress,sign,sync,action,priceAtomic}=params
  const observed=params.observed?validateEquipmentMarketSnapshot(params.observed):undefined
  async function chain(){
    const {response}=await bounded(abort=>client.ledgerService.getServiceInfo({},{abort,timeout:TIMEOUT_MS}))
    check(response.chainId===MAINNET_GENESIS_DIGEST,'Mainnet equipment RPC required')
  }
  async function epoch(){
    const {response}=await bounded(abort=>client.ledgerService.getEpoch({readMask:{paths:['epoch']}},{abort,timeout:TIMEOUT_MS}))
    const n=response.epoch?.epoch;check(typeof n==='bigint'&&n>=0n&&n<18446744073709551615n,'Current epoch unavailable');return n
  }
  async function fresh(s:EquipmentMarketOperationSnapshot){
    await chain();return validateEquipmentMarketSnapshot(await bounded(signal=>read(equipmentMarketReadRequest(s),signal)))
  }
  function same(current:EquipmentMarketOperationSnapshot,saved:EquipmentMarketOperationSnapshot,intent:EquipmentMarketAction){
    const fixed=(s:EquipmentMarketOperationSnapshot)=>canonical({...s,available:undefined,
      // This purchase-only object may disappear from the current authority gate
      // while paused. It must not prevent a structurally valid seller return.
      protocolTreasuryId:intent==='buy'?s.protocolTreasuryId:undefined,
      release:{...s.release,marketWritesEnabled:undefined,equipmentWritesEnabled:undefined}})
    check(fixed(current)===fixed(saved),'Equipment selection, quote, lock, custody or release changed')
  }
  const paymentScope=(s:EquipmentMarketOperationSnapshot)=>({owner:s.actor,paymentCoinType:s.target.paymentCoinType})
  function writable(s:EquipmentMarketOperationSnapshot,intent:EquipmentMarketAction){
    check(equipmentMarketWritable(s,intent,getAddress()),'Equipment action unavailable, signing disabled or wallet changed')
  }
  return {
    async prepare(){
      check(observed&&action&&['list','buy','reprice','cancel','recover'].includes(action),'Review the exact equipment action first')
      const current=await fresh(observed);same(current,observed,action);writable(current,action)
      const exactPrice=['list','reprice'].includes(action)?priceAtomic:current.listing?.priceAtomic
      check(typeof exactPrice==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(exactPrice)
        &&BigInt(exactPrice)>=40n&&BigInt(exactPrice)<=18446744073709551615n,'Exact equipment price required')
      const paymentCoins=action==='buy'?await selectMarketPaymentCoins(client,{...paymentScope(current),priceAtomic:exactPrice}):[]
      const expirationEpoch=String(await epoch()+1n)
      const draft={schema:1 as const,kind:'equipment-market' as const,action,snapshot:current,priceAtomic:exactPrice,paymentCoins}
      const data=buildEquipmentMarketOperationTransaction(draft).getData()
      const refs=[...paymentCoins,...(action==='list'?[current.reference]:[])]
      data.inputs=data.inputs.map(input=>{
        const ref=refs.find(r=>r.objectId===input.UnresolvedObject?.objectId)
        return ref?Inputs.ObjectRef({objectId:ref.objectId,version:ref.version,digest:ref.digest}):input
      })
      const tx=Transaction.from(JSON.stringify(data));tx.setSender(current.actor);tx.setExpiration({Epoch:expirationEpoch})
      const bytes=await bounded(()=>tx.build({client}))
      const record=validateEquipmentMarketOperationRecord({...draft,bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),
        expirationEpoch,phase:'PREPARED',signature:null})
      if(action==='buy')await recheckMarketPaymentCoins(client,paymentScope(current),paymentCoins)
      check(getAddress()===current.actor,'Wallet changed while preparing equipment action')
      return record
    },
    async preflight(value){
      const r=validateEquipmentMarketOperationRecord(value)
      check(['PREPARED','SIGNING','SIGNED'].includes(r.phase),'Terminal equipment operation cannot sign or rebroadcast')
      const current=await fresh(r.snapshot);same(current,r.snapshot,r.action);writable(current,r.action)
      if(r.action==='buy')await recheckMarketPaymentCoins(client,paymentScope(current),r.paymentCoins)
      check(await epoch()<=BigInt(r.expirationEpoch),'Saved equipment operation expired; query or retire without rebuilding it')
      check(getAddress()===r.snapshot.actor,'Wallet changed during equipment preflight')
    },
    async sign(value){
      const r=validateEquipmentMarketOperationRecord(value)
      check(['PREPARED','SIGNING'].includes(r.phase)&&getAddress()===r.snapshot.actor,'Wallet changed or equipment operation cannot request signature')
      return bounded(()=>sign(Transaction.from(fromBase64(r.bytes))),120_000)
    },
    async verifySignature(value){
      const r=validateEquipmentMarketOperationRecord(value);check(r.signature,'Equipment signature missing')
      await bounded(()=>verifyTransactionSignature(fromBase64(r.bytes),r.signature!,{address:r.snapshot.actor,client}))
    },
    async broadcast(value){
      const r=validateEquipmentMarketOperationRecord(value)
      check(r.phase==='SIGNED'&&r.signature&&getAddress()===r.snapshot.actor,'Only the saved signed equipment transaction may broadcast')
      await bounded(signal=>client.core.executeTransaction({transaction:fromBase64(r.bytes),signatures:[r.signature!],signal}))
    },
    async query(value){return (await queryEquipmentMarketOperationEvidence(value,client)).status},
    async sync(value){return bounded(()=>sync(validateEquipmentMarketOperationRecord(value)))},
    async expiryCheckpoint(value){
      const r=validateEquipmentMarketOperationRecord(value);await chain()
      const {response}=await bounded(abort=>client.ledgerService.getCheckpoint({checkpointId:{oneofKind:undefined},
        readMask:{paths:['sequence_number','digest','summary','signature']}},{abort,timeout:TIMEOUT_MS}))
      const c=response.checkpoint,s=c?.summary
      check(c&&s?.bcs?.value&&c.digest===s.digest&&typeof s.epoch==='bigint'&&typeof s.sequenceNumber==='bigint'
        &&c.sequenceNumber===s.sequenceNumber&&c.signature?.epoch===s.epoch&&c.signature.signature?.length===48&&c.signature.bitmap?.length,
      'Executed equipment checkpoint evidence unavailable or inconsistent')
      return validateMarketCancelCheckpoint({bytes:toBase64(s.bcs.value),digest:c.digest,epoch:String(s.epoch),sequenceNumber:String(s.sequenceNumber)},r.expirationEpoch)
    },
  }
}
