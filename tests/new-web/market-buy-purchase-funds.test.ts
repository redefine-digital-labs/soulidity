import { expect, it, vi } from 'vitest'
import { queryMarketBuyOperationEvidence } from '../../web/lib/animacraft/market-buy-operation-adapter'
import { createMarketBuyFundsOriginal, MARKET_BUY_FUNDS_ORIGINAL } from '../../web/lib/animacraft/market-buy-funds-original'
import { parsePurchaseRecoveryOriginal, queryPurchaseRecoveryOriginal } from '../../web/lib/soulidity/commerce/purchase-recovery-original'
import { adigest } from './fixtures/activity-transaction-evidence'
import { bid } from './fixtures/market-buy-operation'
import { marketBuyPurchaseFundsFixture as fixture } from './fixtures/market-buy-purchase-funds'
import { equipmentAddressGasEffect } from './fixtures/equipment-market-evidence'

const sui = '0x2::coin::Coin<0x2::sui::SUI>'

it.each([{},{newKiosk:true},{sameRoles:true},{tiny:true},{exact:true},{newKiosk:true,buyerRecipient:true}])('verifies actual Coin and checkpoint BCS against the SDK graph for %j',async options=>{
  const f = await fixture(options)
  const result = await f.run()
  expect(result).toMatchObject({ status:'VERIFIED', buyerDebit:options.tiny?'1':'1000000', gas:{netGasCharge:'3'}, checkpoint:'100' })
  if (result.status !== 'VERIFIED') throw Error('expected verified proof')
  expect(result.payouts.reduce((sum,p)=>sum+BigInt(p.amount)*BigInt(p.coinIds.length),0n)).toBe(BigInt(f.s.priceAtomic))
  if (!options.sameRoles && !options.tiny) expect(result.shares).toEqual([
    {role:'seller',owner:f.s.seller,amount:'875000'},
    {role:'soulCreator',owner:f.s.creator,amount:'25000'},
    {role:'makerSource',owner:f.s.makerCreator,amount:'75000'},
    {role:'service',owner:f.s.protocolFeeRecipient,amount:'25000'},
  ])
  if (options.sameRoles) expect(result.payouts).toContainEqual({ owner:f.s.seller,amount:'25000',roles:['soulCreator','service'],coinIds:[bid(211),bid(213)] })
  if (options.tiny) expect(result.payouts).toHaveLength(1)
  expect(f.getObject.mock.calls.every(([req])=>req.version!==undefined || [f.s.release.soulidityCallablePackageId,f.s.release.kioskPackageId].includes(req.objectId!))).toBe(true)
})

it.each(['checkpoint','merged','payout-amount','coin-type','fee-recipient','creator','raw-digest','payout-missing','duplicate','kiosk-cap'] as const)
('rejects %s without using latest object versions',async mode=>{
  const f = await fixture({newKiosk:mode==='kiosk-cap'})
  const e=f.e!
  if (mode==='checkpoint') { f.chain.contentsData.V2!.transactions[1].digest.effects=adigest(2);f.chain.rehashContents() }
  if (mode==='merged') {const i=e.changedObjects.findIndex(([id])=>id===bid(51));e.changedObjects.splice(i,1);f.chain.rehashEffects()}
  if (mode==='payout-amount' || mode==='coin-type') {
    const id=bid(211),i=e.changedObjects.findIndex(([key])=>key===id)
    e.changedObjects.splice(i,1)
    const row=f.coin(id,mode==='payout-amount'?'25001':'25000',f.s.creator,10,mode==='coin-type'?sui:undefined)
    f.effect(id,null,row,{AddressOwner:f.s.creator});f.chain.rehashEffects()
  }
  if (mode==='fee-recipient') f.record.snapshot.protocolFeeRecipient=bid(999)
  if (mode==='creator') f.record.snapshot.creator=bid(999)
  if (mode==='raw-digest') f.objects.get(`${bid(211)}:10`)!.bcs.value[8]^=1
  if (mode==='payout-missing') f.objects.delete(`${bid(211)}:10`)
  if (mode==='duplicate') {e.changedObjects.push(e.changedObjects[0]);f.chain.rehashEffects()}
  if (mode==='kiosk-cap') f.objects.delete(`${bid(221)}:10`)
  await expect(f.run()).rejects.toThrow()
})

it('retains verified USDC settlement if SUI gas objects are unavailable',async()=>{
  const f=await fixture();f.objects.delete(`${bid(200)}:10`)
  await expect(f.run()).resolves.toMatchObject({status:'VERIFIED',buyerDebit:'1000000',gas:null})
})
it.each([false,true])('restores address-funded Soul purchase and all role payouts from the portable original (new Kiosk=%s)',async newKiosk=>{
  const f=await fixture({addressGas:true,newKiosk})
  const text=JSON.stringify(createMarketBuyFundsOriginal(f.record))
  const result=await queryPurchaseRecoveryOriginal({text,soulId:f.s.soulId,client:f.client,signal:new AbortController().signal})
  expect(result).toMatchObject({kind:MARKET_BUY_FUNDS_ORIGINAL,history:{
    status:'VERIFIED',checkpoint:'100',buyerDebit:'1000000',
    gas:{owner:f.s.buyer,netGasCharge:'3',proof:'original-address-balance-effects-only'},
    shares:[
      {role:'seller',owner:f.s.seller,amount:'875000'},
      {role:'soulCreator',owner:f.s.creator,amount:'25000'},
      {role:'makerSource',owner:f.s.makerCreator,amount:'75000'},
      {role:'service',owner:f.s.protocolFeeRecipient,amount:'25000'},
    ],
  }})
  expect(f.client.ledgerService.getCheckpoint).toHaveBeenCalledTimes(1)
  expect(f.getObject.mock.calls.some(([request])=>request.objectId===bid(200))).toBe(false)
})
it.each(['wrong gas','extra balance','checkpoint','epoch'] as const)('rejects contradictory %s for an address-funded original',async variant=>{
  const f=await fixture({addressGas:true}),e=f.e!
  if(variant==='wrong gas')e.changedObjects[0]=equipmentAddressGasEffect(f.s.buyer,-4n) as unknown as typeof e.changedObjects[number]
  if(variant==='extra balance')e.changedObjects.push(equipmentAddressGasEffect(f.s.seller,1n) as unknown as typeof e.changedObjects[number])
  if(variant==='epoch')e.executedEpoch='4'
  f.chain.rehashEffects()
  if(variant==='checkpoint'){
    f.chain.contentsData.V2!.transactions[1].digest.effects=adigest(11)
    f.chain.rehashContents()
  }
  await expect(f.run()).rejects.toThrow(variant==='epoch'?'outside its gas epoch window':
    variant==='checkpoint'?'missing from original checkpoint':variant==='extra balance'?'EXTRA_ACCUMULATOR':'WRITE_MISMATCH')
})
it('requires exact checkpoint membership before an address-funded original can be marked failed',async()=>{
  const f=await fixture({addressGas:true}),e=f.e!
  e.status={ $kind:'Failure',Failure:{error:{$kind:'InsufficientGas',InsufficientGas:true},command:null} }
  e.eventsDigest=null;delete f.chain.ledger.events;f.chain.rehashEffects()
  const entry=f.chain.contentsData.V2!.transactions[1].digest,original=entry.effects
  entry.effects=adigest(10);f.chain.rehashContents()
  await expect(f.run()).rejects.toThrow('missing from original checkpoint')
  entry.effects=original;f.chain.rehashContents()
  await expect(f.run()).resolves.toMatchObject({status:'FAILED',transactionDigest:f.record.digest})
})
it('recovers the native Soul receipt on direct gRPC without the Market package identity projection',async()=>{
  const f=await fixture({addressGas:true}),pkg=f.chain.pkg
  const identity=structuredClone(pkg.package)
  pkg.package={...pkg.package,storageId:undefined,originalId:undefined,version:undefined}
  vi.mocked(f.client.movePackageService.getPackage).mockImplementation(req=>f.rpc(req,{package:identity}))
  const result=await queryMarketBuyOperationEvidence(f.record,f.client)
  expect(result).toMatchObject({status:'SUCCEEDED',checkpoint:'100',addressGas:{netGasCharge:'3'}})
  expect(f.client.movePackageService.getPackage).toHaveBeenCalledWith(
    {packageId:f.s.release.soulidityCallablePackageId},expect.anything())
})
it('retains ordinary historical checkout recovery for Effects V1',async()=>{
  const f=await fixture({legacy:true})
  await expect(f.run()).resolves.toMatchObject({status:'LEGACY_EFFECTS'})
  const {withPackageObjectIdentity}=await import('../../web/lib/sui/package-object-client')
  await expect(queryMarketBuyOperationEvidence(f.record,withPackageObjectIdentity(f.client))).resolves.toMatchObject({status:'SUCCEEDED'})
  expect(f.client.ledgerService.getCheckpoint).not.toHaveBeenCalled()
})


it('keeps an uncheckpointed purchase pending before attempting original funds reads',async()=>{
  const f=await fixture();delete f.chain.ledger.checkpoint
  await expect(f.run()).resolves.toMatchObject({status:'PENDING',transactionDigest:f.record.digest})
  expect(f.client.ledgerService.getCheckpoint).not.toHaveBeenCalled()
  expect(f.getObject).not.toHaveBeenCalled()
})

it('round trips only public original data and re-verifies the exact purchase without the checkout journal',async()=>{
  const f=await fixture({sameRoles:true})
  const signed={...f.record,phase:'SIGNED' as const,signature:'private-signed-state',
    snapshot:{...f.s,unknownSnapshotField:'private-snapshot',release:{...f.s.release,unlistedReleaseField:'private-release'}},
    paymentCoins:f.record.paymentCoins.map(coin=>({...coin,extra:'private-funding'})),
    extra:'private-journal',
  }
  const file=createMarketBuyFundsOriginal(signed)
  const text=JSON.stringify(file)
  expect(text).not.toMatch(/private-|signature|phase|syncStatus|payouts/)
  expect(file.packet).toEqual({bytes:f.record.bytes,digest:f.record.digest,expirationEpoch:f.record.expirationEpoch})
  const parsed=await parsePurchaseRecoveryOriginal(text,f.s.soulId)
  expect(parsed).toEqual({kind:MARKET_BUY_FUNDS_ORIGINAL,value:file})
  expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
  const result=await queryPurchaseRecoveryOriginal({text,soulId:f.s.soulId,client:f.client,signal:new AbortController().signal})
  expect(result).toMatchObject({kind:MARKET_BUY_FUNDS_ORIGINAL,history:{
    status:'VERIFIED',transactionDigest:f.record.digest,buyerDebit:'1000000',
    payouts:expect.arrayContaining([expect.objectContaining({roles:['soulCreator','service'],coinIds:[bid(211),bid(213)]})]),
  }})
  expect(f.client.ledgerService.getTransaction).toHaveBeenCalledWith(expect.objectContaining({digest:f.record.digest}),expect.anything())
})

it.each(['other-soul','digest','extra-payout','extra-signature','extra-funding','wrong-balance'] as const)
('validates portable original input %s at the correct boundary',async mode=>{
  const f=await fixture(),file=createMarketBuyFundsOriginal(f.record)
  let soulId=f.s.soulId
  if(mode==='other-soul')soulId=bid(999)
  if(mode==='digest')file.packet.digest=adigest(19)
  if(mode==='extra-payout')Object.assign(file,{payouts:[{owner:bid(999),amount:'1'}]})
  if(mode==='extra-signature')Object.assign(file.packet,{signature:'encoded'})
  if(mode==='extra-funding')Object.assign(file.paymentCoins[0],{signature:'encoded'})
  if(mode==='wrong-balance')file.paymentCoins[0].balanceAtomic='650000'
  const text=JSON.stringify(file),read=()=>queryPurchaseRecoveryOriginal({text,soulId,client:f.client,signal:new AbortController().signal})
  await expect(read()).rejects.toThrow()
  expect(f.client.ledgerService.getTransaction).toHaveBeenCalledTimes(mode==='wrong-balance'?1:0)
})
