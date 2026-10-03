import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import type {SuiGrpcClient} from '@mysten/sui/grpc'
import {toBase58} from '@mysten/sui/utils'
import {readMarketPaymentCoin,selectMarketPaymentCoins,recheckMarketPaymentCoins} from '../../web/lib/animacraft/market-payment-coins'

const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
const scope={owner:id(1),paymentCoinType:`${id(2)}::sui::SUI`}
const digest=toBase58(new Uint8Array(32).fill(7))
function fixture(balances:string[]=['40','60']){
  const objects=new Map(balances.map((balance,index)=>{const objectId=id(index+100)
    return [objectId,{objectId,version:2n,digest,owner:{kind:1,address:scope.owner},
      objectType:`0x2::coin::Coin<${scope.paymentCoinType}>`,contents:{value:Coin.serialize({id:objectId,balance}).toBytes()}}]}))
  const pages:Array<{objects:Array<{objectId:string}>;nextPageToken?:Uint8Array}>=[]
  const hints=[...objects.keys()].map(objectId=>({objectId}))
  for(let i=0;i<hints.length;i+=20)pages.push({objects:hints.slice(i,i+20),...(i+20<hints.length?{nextPageToken:new Uint8Array([pages.length+1])}:{})})
  const getObject=vi.fn(async(request:{objectId:string},_options?:{abort:AbortSignal;timeout:number})=>({response:{object:objects.get(request.objectId)}}))
  const listOwnedObjects=vi.fn(async(request:{pageToken?:Uint8Array},_options?:{abort:AbortSignal;timeout:number})=>({response:pages[request.pageToken?.[0]??0]}))
  const client={ledgerService:{getObject},stateService:{listOwnedObjects}} as unknown as SuiGrpcClient
  return {client,objects,pages,getObject,listOwnedObjects}
}
afterEach(()=>vi.useRealTimers())
it('selects exact raw address-owned balances for the authenticated non-USDC payment type',async()=>{
  const f=fixture();const selected=await selectMarketPaymentCoins(f.client,{...scope,priceAtomic:'100'})
  expect(selected).toEqual([{objectId:id(101),version:'2',digest,balanceAtomic:'60'},{objectId:id(100),version:'2',digest,balanceAtomic:'40'}])
  expect(f.listOwnedObjects.mock.calls[0][0]).toMatchObject({owner:scope.owner,objectType:`0x2::coin::Coin<${scope.paymentCoinType}>`,pageSize:20})
  expect(f.getObject.mock.calls[0][1]).toMatchObject({timeout:25000,abort:expect.any(AbortSignal)})
  await expect(recheckMarketPaymentCoins(f.client,scope,selected)).resolves.toBeUndefined()
})
it.each(['owner','shared','type','id','bcs-id','trailing','version','digest'] as const)('rejects invalid exact Coin evidence: %s',async reason=>{
  const f=fixture(),coin=f.objects.get(id(100))!
  if(reason==='owner')coin.owner.address=id(9)
  if(reason==='shared')coin.owner.kind=3
  if(reason==='type')coin.objectType=`0x2::coin::Coin<${id(2)}::other::OTHER>`
  if(reason==='id')coin.objectId=id(9)
  if(reason==='bcs-id')coin.contents.value=Coin.serialize({id:id(9),balance:'100'}).toBytes()
  if(reason==='trailing')coin.contents.value=new Uint8Array([...coin.contents.value,0])
  if(reason==='version')coin.version=0n
  if(reason==='digest')coin.digest='bad'
  await expect(readMarketPaymentCoin(f.client,scope,id(100))).rejects.toThrow('Payment coin')
})
it('keeps at most 32 largest candidates and finds sufficient later coins beyond early dust',async()=>{
  const f=fixture([...Array(40).fill('1'),'100'])
  expect(await selectMarketPaymentCoins(f.client,{...scope,priceAtomic:'100'})).toEqual([
    {objectId:id(140),version:'2',digest,balanceAtomic:'100'}])
  expect(f.listOwnedObjects).toHaveBeenCalledTimes(3)
  const dust=fixture(Array(33).fill('1'))
  await expect(selectMarketPaymentCoins(dust.client,{...scope,priceAtomic:'33'})).rejects.toThrow('Insufficient verified')
})
it('skips zero balances and stops after ten pages even when more discovery is offered',async()=>{
  const f=fixture([...Array(200).fill('0'),'100'])
  await expect(selectMarketPaymentCoins(f.client,{...scope,priceAtomic:'100'})).rejects.toThrow('bounded payment discovery')
  expect(f.listOwnedObjects).toHaveBeenCalledTimes(10);expect(f.getObject).toHaveBeenCalledTimes(200)
})
it.each(['duplicate','cursor-repeat','cursor-empty','cursor-large','page-bound'] as const)('rejects malformed pagination: %s',async reason=>{
  const f=fixture(['1','1'])
  if(reason==='duplicate')f.pages[0].objects=[{objectId:id(100)},{objectId:id(100)}]
  if(reason==='page-bound')f.pages[0].objects=Array(21).fill({objectId:id(100)})
  if(reason==='cursor-empty')f.pages[0].nextPageToken=new Uint8Array()
  if(reason==='cursor-large')f.pages[0].nextPageToken=new Uint8Array(1025)
  if(reason==='cursor-repeat'){
    f.pages.splice(0,1,{objects:[{objectId:id(100)}],nextPageToken:new Uint8Array([1])},
      {objects:[{objectId:id(101)}],nextPageToken:new Uint8Array([1])})
  }
  await expect(selectMarketPaymentCoins(f.client,{...scope,priceAtomic:'100'})).rejects.toThrow(/discovery/)
})
it('rejects u64 overflow before attempting to use a merged payment',async()=>{
  const f=fixture(['9223372036854775808','9223372036854775808'])
  await expect(selectMarketPaymentCoins(f.client,{...scope,priceAtomic:'18446744073709551615'})).rejects.toThrow('merge exceeds u64')
})
it.each(['version','digest','balance'] as const)('rechecks the entire saved payment reference: %s',async reason=>{
  const f=fixture(),saved=await readMarketPaymentCoin(f.client,scope,id(100)),coin=f.objects.get(id(100))!
  if(reason==='version')coin.version=3n
  if(reason==='digest')coin.digest=toBase58(new Uint8Array(32).fill(9))
  if(reason==='balance')coin.contents.value=Coin.serialize({id:id(100),balance:'41'}).toBytes()
  await expect(recheckMarketPaymentCoins(f.client,scope,[saved])).rejects.toThrow('Payment coin changed')
})
it.each(['read','discovery'] as const)('bounds and aborts stalled %s RPC',async operation=>{
  vi.useFakeTimers();const f=fixture(),pending=new Promise<never>(()=>{})
  if(operation==='read')f.getObject.mockReturnValue(pending);else f.listOwnedObjects.mockReturnValue(pending)
  const work=operation==='read'?readMarketPaymentCoin(f.client,scope,id(100)):
    selectMarketPaymentCoins(f.client,{...scope,priceAtomic:'100'})
  const assertion=expect(work).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(25000);await assertion
  const call=operation==='read'?f.getObject.mock.calls[0]:f.listOwnedObjects.mock.calls[0]
  expect(call[1]?.abort.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0)
})
