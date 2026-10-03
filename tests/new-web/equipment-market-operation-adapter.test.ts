import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {Inputs,Transaction} from '@mysten/sui/transactions'
import {Ed25519Keypair} from '@mysten/sui/keypairs/ed25519'
import {fromBase64} from '@mysten/sui/utils'
import {equipmentMarketOperationFixture,equipmentRecordWithTransaction,emid} from './fixtures/equipment-market-operation'
import {createEquipmentMarketOperationAdapter} from '../../web/lib/animacraft/equipment-market-operation-adapter'
import {equipmentMarketInputRoles,validateEquipmentMarketOperationRecord,type EquipmentMarketAction} from '../../web/lib/animacraft/equipment-market-operation'
import {MAINNET_GENESIS_DIGEST} from '../../web/lib/animacraft/mainnet-chain'
import type {EquipmentMarketReadRequest} from '../../web/lib/animacraft/equipment-market-operation-snapshot'

const signer=Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(22))
const Coin=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()})
async function fixture(action:EquipmentMarketAction='list',equipped=false){
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
    core:{executeTransaction:vi.fn(async()=>({})),resolveTransactionPlugin:()=>async(data:any,_:any,next:()=>Promise<void>)=>{
      data.inputs=data.inputs.map((i:any)=>{
        if(!i.UnresolvedObject)return i
        const objectId=i.UnresolvedObject.objectId
        return roles.owned.has(objectId)?Inputs.ObjectRef({objectId,version:'2',digest:f.target.outputCallableDigest})
          :Inputs.SharedObjectRef({objectId,initialSharedVersion:'1',mutable:roles.mutable.has(objectId)})
      });data.gasData=f.tx.getData().gasData;await next()
    }}}
  const read=vi.fn(async(_request:EquipmentMarketReadRequest,_signal:AbortSignal)=>structuredClone(f.snapshot)),sign=vi.fn(async(tx:Transaction)=>signer.signTransaction(await tx.build()))
  const sync=vi.fn(async():Promise<'COMPLETE'>=> 'COMPLETE')
  const params={client,read,observed:structuredClone(f.snapshot),action,priceAtomic:record.priceAtomic,
    getAddress:()=>wallet,sign,sync}
  const adapter=createEquipmentMarketOperationAdapter(params)
  return {...f,record,client,coins,read,sign,sync,params,adapter,setWallet:(value:string|null)=>{wallet=value}}
}
afterEach(()=>vi.useRealTimers())
it.each(['list','buy','reprice','cancel','recover'] as const)('prepares and preflights exact saved %s bytes',async action=>{
  const f=await fixture(action),prepared=await f.adapter.prepare()
  expect(prepared.bytes).toBe(f.record.bytes)
  expect(prepared.digest).toBe(f.record.digest)
  await f.adapter.preflight(prepared,true);await f.adapter.preflight(prepared,false)
  expect(f.sign).not.toHaveBeenCalled()
})
it('prepares partial unequip/list without an implicit Soul sale',async()=>{
  const f=await fixture('list',true),r=await f.adapter.prepare()
  expect(r.bytes).toBe(f.record.bytes)
  expect(f.read.mock.calls[0][0]).toMatchObject({equipmentScope:{soulId:emid(12),stateId:emid(14)}})
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
