import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {Inputs,Transaction} from '@mysten/sui/transactions'
import {Ed25519Keypair} from '@mysten/sui/keypairs/ed25519'
import {GrpcTypes,SuiGrpcClient} from '@mysten/sui/grpc'
import {fromBase64} from '@mysten/sui/utils'
import {equipmentMarketOperationFixture,equipmentRecordWithTransaction,emid} from './fixtures/equipment-market-operation'
import {createEquipmentMarketOperationAdapter} from '../../web/lib/animacraft/equipment-market-operation-adapter'
import {equipmentMarketInputRoles,validateEquipmentMarketOperationRecord,type EquipmentMarketAction} from '../../web/lib/animacraft/equipment-market-operation'
import {MAINNET_GENESIS_DIGEST} from '../../web/lib/animacraft/mainnet-chain'
import type {EquipmentMarketReadRequest} from '../../web/lib/animacraft/equipment-market-operation-snapshot'

const signer=Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(22))
const Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
async function fixture(action:EquipmentMarketAction='list',equipped=false,addressGas=false){
  const f=await equipmentMarketOperationFixture({action,equipped}),address=signer.toSuiAddress()
  // The read below is controlled adapter evidence. The raw mapper is separately
  // exercised by the shared fixture, not represented as a real wallet/node read.
  f.snapshot.actor=address
  if(action!=='buy')f.snapshot.seller=address
  f.record.snapshot=structuredClone(f.snapshot)
  f.tx.setSender(address);f.tx.setGasOwner(address)
  const record=validateEquipmentMarketOperationRecord(await equipmentRecordWithTransaction(f.record,f.tx))
  let wallet:string|null=address
  const coins=new Map(record.paymentCoins.map(c=>[c.objectId,{objectId:c.objectId,version:BigInt(c.version),digest:c.digest,
    owner:{kind:1,address},objectType:`0x2::coin::Coin<${f.snapshot.target.paymentCoinType}>`,
    contents:{value:Coin.serialize({id:c.objectId,balance:c.balanceAtomic}).toBytes()}}]))
  const roles=equipmentMarketInputRoles(record)
  const client:any={ledgerService:{getServiceInfo:vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}})),
    getEpoch:vi.fn(async()=>({response:{epoch:{epoch:8n}}})),
    getTransaction:vi.fn(async()=>{throw {code:'NOT_FOUND'}}),
    getObject:vi.fn(async({objectId}:{objectId:string})=>({response:{object:coins.get(objectId)}}))},
    stateService:{listOwnedObjects:vi.fn(async()=>({response:{objects:record.paymentCoins.map(c=>({objectId:c.objectId}))}}))},
    transactionExecutionService:{simulateTransaction:vi.fn(async(input)=>({response:{transaction:{
      transaction:input.transaction,effects:{status:{success:true}},
    }}}))},
    core:{executeTransaction:vi.fn(async()=>({})),resolveTransactionPlugin:()=>async(data:any,_:any,next:()=>Promise<void>)=>{
      data.inputs=data.inputs.map((i:any)=>{
        if(!i.UnresolvedObject)return i
        const objectId=i.UnresolvedObject.objectId
        return roles.owned.has(objectId)?Inputs.ObjectRef({objectId,version:'2',digest:f.target.outputCallableDigest})
          :Inputs.SharedObjectRef({objectId,initialSharedVersion:'1',mutable:roles.mutable.has(objectId)})
      });data.gasData={...f.tx.getData().gasData,...(addressGas?{payment:[]}:{})};await next()
    }}}
  const read=vi.fn(async(_request:EquipmentMarketReadRequest,_signal:AbortSignal)=>structuredClone(f.snapshot)),sign=vi.fn(async(tx:Transaction)=>signer.signTransaction(await tx.build()))
  const sync=vi.fn(async():Promise<'COMPLETE'>=> 'COMPLETE')
  const params={client,read,observed:structuredClone(f.snapshot),action,priceAtomic:record.priceAtomic,
    getAddress:()=>wallet,sign,sync}
  const adapter=createEquipmentMarketOperationAdapter(params)
  return {...f,record,client,coins,read,sign,sync,params,adapter,setWallet:(value:string|null)=>{wallet=value}}
}
afterEach(()=>vi.useRealTimers())
async function expectedBoundedBytes(f:Awaited<ReturnType<typeof fixture>>,bytes:string,addressGas=false){
  const raw=bcs.TransactionData.parse(fromBase64(bytes)).V1!
  expect(raw.expiration.ValidDuring).toMatchObject({chain:MAINNET_GENESIS_DIGEST,minEpoch:'8',maxEpoch:'9'})
  if(addressGas)f.tx.setGasPayment([])
  f.tx.setExpiration({ValidDuring:raw.expiration.ValidDuring!})
  return equipmentRecordWithTransaction(f.record,f.tx)
}
it.each(['list','buy','reprice','cancel','recover'] as const)('prepares and preflights exact saved %s bytes',async action=>{
  const f=await fixture(action),prepared=await f.adapter.prepare()
  const expected=await expectedBoundedBytes(f,prepared.bytes)
  expect(prepared.bytes).toBe(expected.bytes)
  expect(prepared.digest).toBe(expected.digest)
  await f.adapter.preflight(prepared,true);await f.adapter.preflight(prepared,false)
  expect(f.sign).not.toHaveBeenCalled()
})
it('prepares partial unequip/list without an implicit Soul sale',async()=>{
  const f=await fixture('list',true),r=await f.adapter.prepare()
  expect(r.bytes).toBe((await expectedBoundedBytes(f,r.bytes)).bytes)
  expect(f.read.mock.calls[0][0]).toMatchObject({equipmentScope:{soulId:emid(12),stateId:emid(14)}})
})
it.each(['list','buy','reprice','cancel','recover'] as const)('prepares and simulates the exact address-funded %s',async action=>{
  const f=await fixture(action,false,true),prepared=await f.adapter.prepare()
  expect(prepared.bytes).toBe((await expectedBoundedBytes(f,prepared.bytes,true)).bytes)
  expect(f.client.transactionExecutionService.simulateTransaction).toHaveBeenLastCalledWith(
    expect.objectContaining({transaction:{bcs:{value:fromBase64(prepared.bytes)}},doGasSelection:false}),expect.anything())
  await f.adapter.preflight(prepared,true)
  expect(f.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledTimes(2)
  const signed=await f.adapter.sign(prepared)
  expect(signed.bytes).toBe(prepared.bytes)
  await f.adapter.verifySignature({...prepared,phase:'SIGNED',signature:signed.signature})
  f.setWallet(null)
  await expect(f.adapter.query(prepared)).resolves.toBe('MISSING')
})
it('accepts the installed gRPC SDK resolver when simulation selects address balance',async()=>{
  const f=await fixture('buy',false,true)
  const sdk=new SuiGrpcClient({network:'mainnet',baseUrl:'https://unused.invalid'})
  const {Input_InputKind:Kind,TransactionExpiration_TransactionExpirationKind:Expiry}=GrpcTypes
  const expected=f.tx.getData()
  const select=vi.fn(async request=>{
    expect(request.doGasSelection).toBe(true)
    const transaction=request.transaction
    expect(transaction.expiration).toMatchObject({kind:Expiry.VALID_DURING,chain:MAINNET_GENESIS_DIGEST,minEpoch:8n,epoch:9n})
    const ptb=transaction.kind.data.programmableTransaction
    ptb.inputs=ptb.inputs.map((input,index)=>{
      const object=expected.inputs[index].Object
      if(!object)return input
      if(object.SharedObject){
        const {objectId,initialSharedVersion,mutable}=object.SharedObject
        return {kind:Kind.SHARED,objectId,version:BigInt(initialSharedVersion),mutable}
      }
      const ref=object.ImmOrOwnedObject??object.Receiving!
      return {kind:object.Receiving?Kind.RECEIVING:Kind.IMMUTABLE_OR_OWNED,
        objectId:ref.objectId,version:BigInt(ref.version),digest:ref.digest}
    })
    transaction.gasPayment={owner:f.record.snapshot.actor,budget:100000n,price:1n,objects:[]}
    return {response:{transaction:{transaction,effects:{status:{success:true}}}}}
  })
  sdk.transactionExecutionService.simulateTransaction=select as never
  f.client.core.resolveTransactionPlugin=sdk.core.resolveTransactionPlugin.bind(sdk.core)
  const prepared=await f.adapter.prepare()
  expect(prepared.bytes).toBe((await expectedBoundedBytes(f,prepared.bytes,true)).bytes)
  expect(select).toHaveBeenCalledTimes(1)
  expect(f.client.transactionExecutionService.simulateTransaction).toHaveBeenCalledTimes(1)
})
it('does not prepare or request a signature after exact address-gas simulation changes the bytes',async()=>{
  const f=await fixture('buy',false,true),prepared=await f.adapter.prepare()
  f.client.transactionExecutionService.simulateTransaction.mockResolvedValue({response:{transaction:{
    transaction:{bcs:{value:Uint8Array.of(1)}},effects:{status:{success:true}},
  }}})
  await expect(f.adapter.prepare()).rejects.toThrow('address-gas simulation failed')
  await expect(f.adapter.preflight(prepared,true)).rejects.toThrow('address-gas simulation failed')
  expect(f.sign).not.toHaveBeenCalled()
})
it.each(['owner','asset','price','revision','reference','release','market-switch','equipment-switch','availability','wallet'])(
  'rejects changed %s before wallet preparation or rebroadcast',async change=>{
    const f=await fixture('buy'),s=f.snapshot
    if(change==='owner')s.seller=emid(777)
    if(change==='asset')s.asset.itemId=emid(777)
    if(change==='price')s.listing!.priceAtomic='40000'
    if(change==='revision')s.listing!.revision='8'
    if(change==='reference')s.reference.version='3'
    if(change==='release')s.release.equipmentMarket!.callableDigest='1'.repeat(32)
    if(change==='market-switch')s.release.marketWritesEnabled=false
    if(change==='equipment-switch')s.release.equipmentWritesEnabled=false
    if(change==='availability')s.available.buy=false
    if(change==='wallet')f.setWallet(null)
    await expect(f.adapter.prepare()).rejects.toThrow()
    await expect(f.adapter.preflight(f.record,false)).rejects.toThrow()
    expect(f.sign).not.toHaveBeenCalled();expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  })
it('keeps seller cancellation available when the current purchase treasury gate disappears',async()=>{
  const f=await fixture('cancel');f.snapshot.protocolTreasuryId=null;f.snapshot.available.reprice=false
  await expect(f.adapter.preflight(f.record,false)).resolves.toBeUndefined()
})
it('rejects a changed verified payment coin before signature/rebroadcast',async()=>{
  const f=await fixture('buy');f.coins.get(f.record.paymentCoins[0].objectId)!.version=3n
  await expect(f.adapter.preflight(f.record,true)).rejects.toThrow('Payment coin changed')
  await expect(f.adapter.preflight(f.record,false)).rejects.toThrow('Payment coin changed')
})
it('query recovery does not need current draft, ownership or write switches',async()=>{
  const f=await fixture('buy');f.setWallet(null);f.read.mockRejectedValue(new Error('asset already transferred'))
  const adapter=createEquipmentMarketOperationAdapter({...f.params,observed:undefined,action:undefined,priceAtomic:undefined})
  await expect(adapter.query(f.record)).resolves.toBe('MISSING')
  await expect(adapter.prepare()).rejects.toThrow('Review')
  expect(f.read).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled()
})
it('verifies the actual actor signature and broadcasts only exact persisted bytes',async()=>{
  const f=await fixture('buy'),signed=await f.adapter.sign(f.record)
  expect(signed.bytes).toBe(f.record.bytes)
  const record={...f.record,phase:'SIGNED' as const,signature:signed.signature}
  await f.adapter.verifySignature(record);await f.adapter.broadcast(record)
  expect(f.client.core.executeTransaction.mock.calls[0][0].transaction).toEqual(fromBase64(f.record.bytes))
})
it('captures the observed intent before caller mutation',async()=>{
  const f=await fixture('reprice');f.params.priceAtomic='80000';f.params.action='list'
  f.params.observed.asset.itemId=emid(999)
  expect((await f.adapter.prepare()).priceAtomic).toBe(f.record.priceAtomic)
})
it('rejects expiry and terminal records before signing',async()=>{
  const f=await fixture();f.client.ledgerService.getEpoch.mockResolvedValue({response:{epoch:{epoch:10n}}})
  await expect(f.adapter.preflight(f.record,true)).rejects.toThrow('expired')
  await expect(f.adapter.sign({...f.record,phase:'CANCELLED'})).rejects.toThrow()
})
it('bounds an uncooperative fresh read and never opens a wallet for its late result',async()=>{
  const f=await fixture();vi.useFakeTimers();f.read.mockImplementation(()=>new Promise(()=>{}))
  const pending=expect(f.adapter.prepare()).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(25001);await pending
  expect(f.sign).not.toHaveBeenCalled()
})
