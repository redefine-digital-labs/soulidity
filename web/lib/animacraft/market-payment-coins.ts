import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {normalizeStructTag,toBase64} from '@mysten/sui/utils'
import {marketBuyCheck as check,marketBuyId,marketBuyDigest} from './market-buy-operation'
import type {MarketBuyPaymentCoin} from './market-buy-types'

const TIMEOUT_MS=25_000
const CoinBcs=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
type PaymentScope={owner:string;paymentCoinType:string}
async function bounded<T>(work:(signal:AbortSignal)=>PromiseLike<T>):Promise<T>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error('Purchase request timed out; recover the saved transaction'))},TIMEOUT_MS)
  })])}finally{clearTimeout(timer)}
}
/** Discovery hints never establish balance or custody. Authenticate each exact
 * raw address-owned Coin against the payment type of the verified snapshot. */
export async function readMarketPaymentCoin(client:SuiGrpcClient,scope:PaymentScope,objectId:string):Promise<MarketBuyPaymentCoin>{
  const {owner,paymentCoinType}=scope
  check(marketBuyId(objectId),'Invalid payment discovery ID')
  const {response}=await bounded(abort=>client.ledgerService.getObject({objectId,
    readMask:{paths:['object_id','version','digest','owner','object_type','contents']}},{abort,timeout:TIMEOUT_MS}))
  const object=response.object,bytes=object?.contents?.value
  check(object?.objectId===objectId&&typeof object.version==='bigint'&&object.version>0n&&marketBuyDigest(object.digest)
    &&object.owner?.kind===1&&object.owner.address===owner&&object.objectType
    &&normalizeStructTag(object.objectType)===normalizeStructTag(`0x2::coin::Coin<${paymentCoinType}>`)
    &&bytes?.length===40,'Payment coin identity, custody or type mismatch')
  const value=CoinBcs.parse(bytes)
  check(value.id===objectId&&toBase64(CoinBcs.serialize(value).toBytes())===toBase64(bytes),'Payment coin BCS mismatch')
  return {objectId,version:String(object.version),digest:object.digest!,balanceAtomic:value.balance}
}
/** At most ten pages of twenty hints, keeping the largest thirty-two verified
 * candidates so early dust cannot hide an adequate coin on a later page. */
export async function selectMarketPaymentCoins(client:SuiGrpcClient,scope:PaymentScope&{priceAtomic:string}):Promise<MarketBuyPaymentCoin[]>{
  const {owner,paymentCoinType,priceAtomic}=scope
  const selected:MarketBuyPaymentCoin[]=[],seen=new Set<string>(),cursors=new Set<string>()
  let pageToken:Uint8Array|undefined
  for(let page=0;page<10;page++){
    const {response}=await bounded(abort=>client.stateService.listOwnedObjects({owner,
      objectType:`0x2::coin::Coin<${paymentCoinType}>`,pageSize:20,pageToken,readMask:{paths:['object_id']}},{abort,timeout:TIMEOUT_MS}))
    check(response.objects.length<=20,'Payment discovery exceeded page bound')
    for(const hint of response.objects){
      check(marketBuyId(hint.objectId)&&!seen.has(hint.objectId!),'Duplicate or malformed payment discovery')
      seen.add(hint.objectId!);const verified=await readMarketPaymentCoin(client,{owner,paymentCoinType},hint.objectId!)
      if(BigInt(verified.balanceAtomic)===0n)continue
      selected.push(verified)
      selected.sort((a,b)=>BigInt(a.balanceAtomic)>BigInt(b.balanceAtomic)?-1:BigInt(a.balanceAtomic)<BigInt(b.balanceAtomic)?1:0)
      if(selected.length>32)selected.pop()
      let balance=0n
      for(let count=0;count<selected.length;count++){
        balance+=BigInt(selected[count].balanceAtomic)
        check(balance<=18446744073709551615n,'Payment coin merge exceeds u64')
        if(balance>=BigInt(priceAtomic))return selected.slice(0,count+1)
      }
    }
    if(response.nextPageToken===undefined)break
    const next=response.nextPageToken
    check(next.length>0&&next.length<=1024&&!cursors.has(toBase64(next)),'Invalid payment discovery cursor')
    cursors.add(toBase64(next));pageToken=next.slice()
  }
  throw new Error('Insufficient verified payment coins within bounded payment discovery')
}
/** Preserve the complete prepared reference and balance before signing/resend. */
export async function recheckMarketPaymentCoins(client:SuiGrpcClient,scope:PaymentScope,paymentCoins:MarketBuyPaymentCoin[]):Promise<void>{
  const frozenScope={...scope},frozenCoins=structuredClone(paymentCoins)
  for(const expected of frozenCoins){const current=await readMarketPaymentCoin(client,frozenScope,expected.objectId)
    check(current.objectId===expected.objectId&&current.version===expected.version&&current.digest===expected.digest
      &&current.balanceAtomic===expected.balanceAtomic,'Payment coin changed; query the saved purchase before retrying')}
}
