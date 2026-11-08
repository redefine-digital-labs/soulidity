import {expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {toBase58,toBase64} from '@mysten/sui/utils'
import {blake2b} from '@noble/hashes/blake2.js'
import {queryExactListingPacketEvidence} from '../../web/lib/animacraft/listing-operation-evidence'
import {MAINNET_GENESIS_DIGEST} from '../../web/lib/animacraft/mainnet-chain'
import {activityHash,adigest} from './fixtures/activity-transaction-evidence'
import {captureSameSoulMarketExecutionClient} from '../../web/lib/soulidity/same-soul-mutation-client'

const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const Events=bcs.struct('TransactionEvents',{data:bcs.vector(bcs.struct('Event',{
  package_id:bcs.Address,transaction_module:bcs.string(),sender:bcs.Address,type_:bcs.StructTag,contents:bcs.vector(bcs.u8()),
}))})
async function fixture(initial=false){
  const packagePin={originalPackageId:id(40),callablePackageId:id(41),callableDigest:toBase58(new Uint8Array(32).fill(6))}
  if(initial)packagePin.originalPackageId=packagePin.callablePackageId
  const tx=new Transaction();tx.setSender(id(1));tx.setGasOwner(id(1));tx.setGasPrice(1000);tx.setGasBudget(1000000)
  tx.setGasPayment([{objectId:id(2),version:'1',digest:packagePin.callableDigest}]);tx.setExpiration({Epoch:'10'})
  tx.moveCall({target:`${packagePin.callablePackageId}::market_v8::list_item`,arguments:[tx.pure.u64(123)]})
  const bytes=await tx.build(),digest=TransactionDataBuilder.getDigestFromBytes(bytes)
  // An event introduced by a later package can have an origin distinct from the original package.
  const origin=initial?packagePin.callablePackageId:id(42)
  const requiredEventOrigins=[{moduleName:'market_v8',datatypeName:'ItemListed',packageId:origin}]
  const eventBytes=Events.serialize({data:[{package_id:packagePin.callablePackageId,transaction_module:'market_v8',sender:id(1),
    type_:{address:origin,module:'market_v8',name:'ItemListed',typeParams:[]},contents:[1,2,3]}]}).toBytes()
  const eventDigest=toBase58(blake2b(new Uint8Array([...new TextEncoder().encode('TransactionEvents::'),...eventBytes]),{dkLen:32}))
  const effects:any={V2:{status:{Success:true},executedEpoch:'9',gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},
    transactionDigest:digest,gasObjectIndex:null,eventsDigest:eventDigest,dependencies:[],lamportVersion:'3',changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}
  const ledger:any={digest,transaction:{digest,bcs:{value:bytes}},effects:{transactionDigest:digest,bcs:{value:bcs.TransactionEffects.serialize(effects).toBytes()},
    status:{success:true}},checkpoint:12n,events:{digest:eventDigest,bcs:{value:eventBytes}}}
  const pkg:any={objectId:packagePin.callablePackageId,version:2n,digest:packagePin.callableDigest,owner:{kind:4},package:{
    storageId:packagePin.callablePackageId,originalId:packagePin.originalPackageId,version:2n,typeOrigins:structuredClone(requiredEventOrigins)}}
  const client:any={ledgerService:{getServiceInfo:vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}})),
    getTransaction:vi.fn(async()=>({response:{transaction:ledger}})),getObject:vi.fn(async()=>({response:{object:pkg}}))}}
  function directWire() {
    const version=initial?1n:2n
    const raw=bcs.Object.serialize({data:{Package:{
      id:packagePin.callablePackageId,version,moduleMap:new Map([['market_v8',Uint8Array.of(4,5)]]),linkageTable:new Map(),
      typeOriginTable:requiredEventOrigins.map(({moduleName,datatypeName,packageId})=>({moduleName,datatypeName,package:packageId})),
    }},owner:{Immutable:true},previousTransaction:adigest(8),storageRebate:'0'}).toBytes()
    packagePin.callableDigest=activityHash('Object',raw)
    const {typeOrigins}=pkg.package
    Object.assign(pkg,{version,digest:packagePin.callableDigest,bcs:{value:raw},package:{typeOrigins}})
    const identity={storageId:packagePin.callablePackageId,originalId:packagePin.originalPackageId,version}
    client.movePackageService={getPackage:vi.fn(async()=>({response:{package:identity}}))}
    return identity
  }
  return {value:{bytes:toBase64(bytes),digest,packagePin,requiredEventOrigins},client,ledger,pkg,effects,
    directWire,updateEffects(){ledger.effects.bcs.value=bcs.TransactionEffects.serialize(effects).toBytes()}}
}
it.each([false,true])('recovers from raw package evidence when the ledger omits identity fields (initial %s)',async initial=>{
  const f=await fixture(initial);f.directWire()
  const proof=await queryExactListingPacketEvidence(f.value,f.client)
  expect(proof).toMatchObject({status:'SUCCEEDED',checkpoint:'12',originalPackageId:f.value.packagePin.originalPackageId,
    typeOrigins:f.value.requiredEventOrigins})
  expect(f.client.ledgerService.getObject.mock.calls[0][0].readMask.paths).toContain('bcs')
  if(initial)expect(f.client.movePackageService.getPackage).not.toHaveBeenCalled()
  else expect(f.client.movePackageService.getPackage).toHaveBeenCalledWith({packageId:f.value.packagePin.callablePackageId},expect.anything())
})
it('retains the initial package lookup when recovering under the same-Soul wallet coordinator',async()=>{
  const f=await fixture();f.directWire()
  const initial=f.client.movePackageService.getPackage
  const captured=captureSameSoulMarketExecutionClient(f.client)
  const replacement=vi.fn(async()=>{throw Error('late replacement')})
  f.client.movePackageService={getPackage:replacement}
  await expect(queryExactListingPacketEvidence(f.value,captured)).resolves.toMatchObject({status:'SUCCEEDED'})
  expect(initial).toHaveBeenCalledTimes(1)
  expect(replacement).not.toHaveBeenCalled()
})
it.each(['wrong family','wrong storage','wrong version','wrong raw digest','no raw','wrong supplied origin','wrong supplied family',
  'wrong first package family','missing origins projection'])('validates partial ledger package evidence: %s',async kind=>{
  const f=await fixture(kind==='wrong first package family'),identity=f.directWire()
  if(kind==='wrong family')identity.originalId=id(80)
  if(kind==='wrong storage')identity.storageId=id(80)
  if(kind==='wrong version')identity.version++
  if(kind==='wrong raw digest')f.pkg.bcs.value=bcs.Object.serialize({
    ...bcs.Object.parse(f.pkg.bcs.value),previousTransaction:adigest(16),
  }).toBytes()
  if(kind==='no raw')delete f.pkg.bcs
  if(kind==='wrong supplied origin')f.pkg.package.typeOrigins[0].packageId=id(80)
  if(kind==='wrong supplied family')f.pkg.package.originalId=id(80)
  if(kind==='wrong first package family')f.value.packagePin.originalPackageId=id(80)
  if(kind==='missing origins projection'){
    delete f.pkg.package
    await expect(queryExactListingPacketEvidence(f.value,f.client)).resolves.toMatchObject({status:'SUCCEEDED'})
  }else await expect(queryExactListingPacketEvidence(f.value,f.client)).rejects.toThrow()
})
it('authenticates exact equipment market BCS with historical origins and only the pinned package read',async()=>{
  const f=await fixture(),proof=await queryExactListingPacketEvidence(f.value,f.client)
  expect(proof.status).toBe('SUCCEEDED')
  if(proof.status==='SUCCEEDED'){
    expect(proof.checkpoint).toBe('12');expect(proof.originalPackageId).toBe(f.value.packagePin.originalPackageId)
    expect(proof.events.data[0].type_.module).toBe('market_v8');expect(proof.typeOrigins).toEqual(f.value.requiredEventOrigins)
  }
  expect(f.client.ledgerService.getObject).toHaveBeenCalledTimes(1)
  expect(f.client.ledgerService.getObject.mock.calls[0][0].objectId).toBe(f.value.packagePin.callablePackageId)
})
it('captures package pins and required event origins before the first async call',async()=>{
  const f=await fixture(),original=f.value.packagePin.callablePackageId
  const result=queryExactListingPacketEvidence(f.value,f.client)
  f.value.packagePin.callablePackageId=id(999);f.value.requiredEventOrigins[0].packageId=id(998)
  expect((await result).status).toBe('SUCCEEDED')
  expect(f.client.ledgerService.getObject.mock.calls[0][0].objectId).toBe(original)
})
it.each(['original','callable','package-digest','storage','owner','version','origin','module','name','duplicate-origin','missing-origin','no-required-origin',
  'saved-bytes','digest','inner-digest','effects-digest','effects-status','event-bytes','event-digest','effects-events-digest','missing-events','oversize-events','checkpoint','chain'])(
  'rejects substituted equipment packet evidence: %s',async reason=>{
    const f=await fixture()
    if(reason==='original')f.pkg.package.originalId=id(99)
    if(reason==='callable')f.pkg.objectId=id(99)
    if(reason==='package-digest')f.pkg.digest=f.value.digest
    if(reason==='storage')f.pkg.package.storageId=id(99)
    if(reason==='owner')f.pkg.owner.kind=1
    if(reason==='version')f.pkg.package.version=3n
    if(reason==='origin')f.pkg.package.typeOrigins[0].packageId=id(99)
    if(reason==='module')f.pkg.package.typeOrigins[0].moduleName='market'
    if(reason==='name')f.pkg.package.typeOrigins[0].datatypeName='SoulListed'
    if(reason==='duplicate-origin')f.pkg.package.typeOrigins.push(f.pkg.package.typeOrigins[0])
    if(reason==='missing-origin')f.pkg.package.typeOrigins=[]
    if(reason==='no-required-origin')f.value.requiredEventOrigins=[]
    if(reason==='saved-bytes')f.ledger.transaction.bcs.value=new Uint8Array([1])
    if(reason==='digest')f.ledger.digest=id(99)
    if(reason==='inner-digest')f.ledger.transaction.digest=id(99)
    if(reason==='effects-digest'){f.effects.V2.transactionDigest=f.value.packagePin.callableDigest;f.updateEffects()}
    if(reason==='effects-status')f.ledger.effects.status.success=false
    if(reason==='event-bytes')f.ledger.events.bcs.value=Events.serialize({data:[]}).toBytes()
    if(reason==='event-digest')f.ledger.events.digest=f.value.digest
    if(reason==='effects-events-digest'){f.effects.V2.eventsDigest=f.value.digest;f.updateEffects()}
    if(reason==='missing-events')delete f.ledger.events
    if(reason==='oversize-events')f.ledger.events.bcs.value=new Uint8Array(65537)
    if(reason==='checkpoint')f.ledger.checkpoint=-1n
    if(reason==='chain')f.client.ledgerService.getServiceInfo.mockResolvedValue({response:{chainId:'testnet'}})
    await expect(queryExactListingPacketEvidence(f.value,f.client)).rejects.toThrow()
  })
it('keeps missing, pending and failed separate without package or current asset reads',async()=>{
  const f=await fixture()
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({code:'NOT_FOUND'})
  expect(await queryExactListingPacketEvidence(f.value,f.client)).toEqual({status:'MISSING'})
  delete f.ledger.checkpoint
  expect(await queryExactListingPacketEvidence(f.value,f.client)).toEqual({status:'PENDING'})
  f.ledger.checkpoint=13n;f.effects.V2.status={Failure:{error:{InsufficientGas:true},command:0}}
  f.effects.V2.eventsDigest=null;f.updateEffects();f.ledger.effects.status.success=false;delete f.ledger.events
  expect(await queryExactListingPacketEvidence(f.value,f.client)).toEqual({status:'FAILED'})
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})
it('propagates unavailable RPC instead of claiming the packet is missing',async()=>{
  const f=await fixture();f.client.ledgerService.getTransaction.mockRejectedValueOnce(new Error('offline'))
  await expect(queryExactListingPacketEvidence(f.value,f.client)).rejects.toThrow('offline')
})
