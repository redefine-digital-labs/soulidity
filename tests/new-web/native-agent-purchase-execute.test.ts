import { createHash } from 'node:crypto'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { quoteAnimacraftV8SoulSale } from '@soulidity/sdk'
import { marketBuyFixture, buySigner, bid } from './fixtures/market-buy-operation'
import { marketCancelCheckpointFixture } from './fixtures/market-cancel-operation'
import { marketBuyCanonical } from '../../web/lib/animacraft/market-buy-operation'
import { NativeReceiveError } from '../../web/lib/animacraft/native-receive'
import { bcs } from '@mysten/sui/bcs'
import { marketBuyEventEvidence } from './fixtures/market-buy-operation'
import { createMarketBuyOperationAdapter } from '../../web/lib/animacraft/market-buy-operation-adapter'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'
const mocks=vi.hoisted(()=>({services:vi.fn(),updateMany:vi.fn(),findUnique:vi.fn(),verify:vi.fn(),mirror:vi.fn(),grants:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:{soulPreparedPurchase:{updateMany:mocks.updateMany,findUnique:mocks.findUnique}}}))
vi.mock('../../web/lib/animacraft/native-agent-purchase-services',()=>({createNativeAgentPurchaseServices:mocks.services}))
vi.mock('../../web/lib/animacraft/native-purchase-verifier',()=>({verifyNativePurchase:mocks.verify}))
vi.mock('@/lib/soulidity/mirror/sync-helpers',()=>({syncSoulProjectionFromChain:mocks.mirror,endActiveSoulGrantProjectionsFromChain:mocks.grants}))
import { executeNativeAgentPurchase } from '../../web/lib/animacraft/native-agent-purchase-execute'

async function fixture(){
  const f=await marketBuyFixture(); const q=quoteAnimacraftV8SoulSale(BigInt(f.snapshot.priceAtomic),f.snapshot)
  const record={...f.record,phase:'SIGNING' as const}
  const signed=await buySigner.signTransaction(f.bytes)
  const row:any={id:'prepared-1',agentMemberId:'member-1',soulOnChainId:f.snapshot.soulId,listingObjectId:f.snapshot.listingId,
    sellerKioskId:f.snapshot.sellerKioskId,agentAddress:f.snapshot.buyer,priceAtomic:f.snapshot.priceAtomic,totalAtomic:f.snapshot.priceAtomic,
    platformFeeAtomic:String(q.protocolFeeAtomic),creatorRoyaltyAtomic:String(q.soulCreatorRoyaltyAtomic),txBytesBase64:record.bytes,
    txBytesHash:createHash('sha256').update(f.bytes).digest('hex'),nativeOperation:record,operationRevision:0,
    expiresAt:new Date(0),resultBody:{dbSynced:true},resultStatusCode:200,executedAt:new Date(0)}
  const events:string[]=[]
  const adapter={query:vi.fn(async()=>{events.push('query');return 'MISSING'}),verifySignature:vi.fn(async(r:any)=>{
    events.push('verify');await verifyTransactionSignature(Buffer.from(r.bytes,'base64'),r.signature,{address:r.snapshot.buyer})}),
    preflight:vi.fn(async()=>{events.push('preflight')}),broadcast:vi.fn(async(r:any)=>{
      expect(row.nativeOperation.phase).toBe('SIGNED');expect(row.nativeOperation.signature).toBe(r.signature);events.push('broadcast')}),
    sync:vi.fn(),expiryCheckpoint:vi.fn(async()=>marketCancelCheckpointFixture().evidence)}
  mocks.services.mockImplementation((_scope,_signal,_observed,sync)=>{adapter.sync.mockImplementation(sync);return{adapter}})
  mocks.updateMany.mockImplementation(async({where,data})=>{
    events.push('save')
    if(where.id!==row.id||where.operationRevision!==row.operationRevision||marketBuyCanonical(where.nativeOperation.equals)!==marketBuyCanonical(row.nativeOperation))return{count:0}
    row.nativeOperation=structuredClone(data.nativeOperation);row.operationRevision++;row.executionTxDigest=data.executionTxDigest
    return{count:1}
  })
  mocks.findUnique.mockImplementation(async()=>{events.push('readback');return structuredClone(row)})
  mocks.verify.mockResolvedValue({ownerAddress:f.snapshot.buyer,kioskId:bid(30),ownershipEpoch:'4',verifyReadSet:vi.fn()})
  mocks.mirror.mockResolvedValue({onChainId:f.snapshot.soulId});mocks.grants.mockResolvedValue(undefined)
  const soul={onChainId:f.snapshot.soulId,stateOnChainId:f.snapshot.stateId,provenanceKind:'animacraft',tags:[],previewImages:[],readme:null,creatorMemberId:null}
  const input:any={request:new Request('http://localhost/execute'),body:{signature:signed.signature},prepared:row,soul,agentMemberId:'member-1',walletAddresses:[f.snapshot.buyer]}
  const run=(body?:any)=>executeNativeAgentPurchase({...input,prepared:structuredClone(row),...(body?{body}:{})})
  return{...f,row,record,signature:signed.signature,adapter,events,input,run}
}
beforeEach(()=>vi.resetAllMocks());afterEach(()=>vi.useRealTimers())
describe('native agent purchase durable execution',()=>{
  it('validates actual SDK bytes and signature; saves SIGNED and reads it back before broadcast despite old TTL',async()=>{
    const f=await fixture();expect((await f.run()).status).toBe(202)
    expect(f.events).toEqual(['query','verify','preflight','save','readback','broadcast','query'])
    expect(f.row.nativeOperation).toMatchObject({phase:'SIGNED',bytes:f.record.bytes,signature:f.signature})
  })
  it.each(['PREPARED','SIGNING'])('accepts an externally signed %s packet without TTL assumptions',async phase=>{
    const f=await fixture();f.row.nativeOperation.phase=phase;expect((await f.run()).status).toBe(202)
  })
  it.each(['MISSING','PENDING'])('check %s never asks for signature or broadcasts',async status=>{
    const f=await fixture();f.adapter.query.mockResolvedValue(status);expect((await f.run({action:'check'})).status).toBe(202)
    expect(f.adapter.preflight).not.toHaveBeenCalled();expect(f.adapter.broadcast).not.toHaveBeenCalled()
  })
  it('pending query blocks supplied valid signature',async()=>{
    const f=await fixture();f.adapter.query.mockResolvedValue('PENDING');await f.run();expect(f.adapter.verifySignature).not.toHaveBeenCalled()
  })
  it.each(['soulOnChainId','listingObjectId','sellerKioskId','agentAddress','priceAtomic','totalAtomic','platformFeeAtomic','creatorRoyaltyAtomic','txBytesBase64','txBytesHash','executionTxDigest'])('rejects substituted row %s before querying',async field=>{
    const f=await fixture();f.row[field]='wrong';expect((await f.run()).status).toBe(422);expect(f.adapter.query).not.toHaveBeenCalled()
  })
  it.each(['member','wallet','soul','state'])('rejects wrong authenticated %s scope',async kind=>{
    const f=await fixture();if(kind==='member')f.input.agentMemberId='other';if(kind==='wallet')f.input.walletAddresses=[bid(999)]
    if(kind==='soul')f.input.soul.onChainId=bid(999);if(kind==='state')f.input.soul.stateOnChainId=bid(999)
    expect([403,422]).toContain((await f.run()).status);expect(f.adapter.broadcast).not.toHaveBeenCalled()
  })
  it('requires an actual native packet and never rebuilds it',async()=>{const f=await fixture();f.row.nativeOperation=null;expect((await f.run()).status).toBe(422);expect(mocks.services).not.toHaveBeenCalled()})
  it('rejects invalid crypto signature before persistence',async()=>{const f=await fixture();await f.run({signature:'not-a-signature'});expect(mocks.updateMany).not.toHaveBeenCalled();expect(f.adapter.broadcast).not.toHaveBeenCalled()})
  it('requires signature only when missing and no finalized evidence exists',async()=>{const f=await fixture();expect((await f.run({action:'execute'})).status).toBe(400);expect(f.adapter.query).toHaveBeenCalledTimes(1)})
  it('retries SIGNED with exactly the saved signature and bytes',async()=>{
    const f=await fixture();f.row.nativeOperation={...f.record,phase:'SIGNED',signature:f.signature};expect((await f.run({action:'execute'})).status).toBe(202)
    expect(f.adapter.broadcast.mock.calls[0][0]).toMatchObject({bytes:f.record.bytes,signature:f.signature});expect(f.adapter.preflight).toHaveBeenCalledWith(expect.anything(),false)
  })
  it('cannot replace a saved signature',async()=>{const f=await fixture();f.row.nativeOperation={...f.record,phase:'SIGNED',signature:f.signature};expect((await f.run({signature:'other'})).status).toBe(422);expect(f.adapter.query).not.toHaveBeenCalled()})
  it.each(['query','preflight','broadcast'])('unknown %s failure never marks FAILED or rebuilds',async method=>{
    const f=await fixture();f.adapter[method as 'query'].mockRejectedValue(new Error('RPC unavailable'));expect((await f.run()).status).toBe(503)
    expect(f.row.nativeOperation.phase).toBe(method==='broadcast'?'SIGNED':'SIGNING');expect(f.row.nativeOperation.bytes).toBe(f.record.bytes)
  })
  it.each(['conflict','readback'])('CAS %s prevents broadcast',async failure=>{
    const f=await fixture();if(failure==='conflict')mocks.updateMany.mockResolvedValue({count:0});else mocks.findUnique.mockResolvedValue(null)
    expect((await f.run()).status).toBe(409);expect(f.adapter.broadcast).not.toHaveBeenCalled()
  })
  it('concurrent attempts only allow the successful CAS claimant to broadcast',async()=>{
    const f=await fixture();const responses=await Promise.all([f.run(),f.run()]);expect(responses.map(r=>r.status).sort()).toEqual([202,409]);expect(f.adapter.broadcast).toHaveBeenCalledTimes(1)
  })
  it('only exact finalized FAILED permits failure state',async()=>{const f=await fixture();f.adapter.query.mockResolvedValue('FAILED');expect((await f.run({action:'check'})).status).toBe(422);expect(f.row.nativeOperation.phase).toBe('FAILED');expect(f.adapter.broadcast).not.toHaveBeenCalled()})
  it.each(['SIGNING','SUCCEEDED'])('finalized %s receipt always rechecks live held proof instead of cached200',async phase=>{
    const f=await fixture();if(phase==='SUCCEEDED')f.row.nativeOperation={...f.record,phase,syncStatus:'COMPLETE'}
    f.adapter.query.mockResolvedValue('SUCCEEDED');expect((await f.run({action:'check'})).status).toBe(200)
    expect(mocks.verify).toHaveBeenCalledTimes(1);expect(mocks.mirror).toHaveBeenCalledWith(expect.objectContaining({expectedNativeHeldState:expect.objectContaining({ownerAddress:f.snapshot.buyer}),listingStatus:'held'}))
    expect(f.row.nativeOperation.syncStatus).toBe('COMPLETE');expect(f.adapter.broadcast).not.toHaveBeenCalled()
  })
  it('saved success after transfer returns SUPERSEDED without overwriting the mirror',async()=>{
    const f=await fixture();f.row.nativeOperation={...f.record,phase:'SUCCEEDED',syncStatus:'COMPLETE'};f.adapter.query.mockResolvedValue('SUCCEEDED')
    mocks.verify.mockRejectedValue(new NativeReceiveError('NATIVE_PURCHASE_OWNER_CHANGED','changed',409))
    expect((await f.run({action:'check'})).status).toBe(409);expect(f.row.nativeOperation.syncStatus).toBe('SUPERSEDED');expect(mocks.mirror).not.toHaveBeenCalled()
  })
  it.each(['verify','mirror','grants'])('success with unknown %s failure remains durably PENDING and retryable',async step=>{
    const f=await fixture();f.adapter.query.mockResolvedValue('SUCCEEDED');mocks[step as 'verify'].mockRejectedValue(new Error('offline'))
    expect((await f.run({action:'check'})).status).toBe(207);expect(f.row.nativeOperation).toMatchObject({phase:'SUCCEEDED',syncStatus:'PENDING'})
  })
  it.each(['SUCCEEDED','FAILED'])('unconfirmed stored %s is not trusted',async phase=>{
    const f=await fixture();f.row.nativeOperation={...f.record,phase,...(phase==='SUCCEEDED'?{syncStatus:'COMPLETE'}:{})}
    expect((await f.run({action:'check'})).status).toBe(503);expect(mocks.mirror).not.toHaveBeenCalled()
  })
  it.each(['PREPARED','SIGNING','SIGNED'])('retires exposed %s only after missing query and strict later checkpoint; keeps full packet',async phase=>{
    const f=await fixture();f.row.nativeOperation={...f.record,phase,signature:phase==='SIGNED'?f.signature:null}
    expect((await f.run({action:'retire'})).status).toBe(200);expect(f.row.nativeOperation).toMatchObject({phase:'RETIRED',bytes:f.record.bytes,digest:f.record.digest,retirement:{priorPhase:phase==='SIGNED'?'SIGNED':'SIGNING'}})
    expect(f.adapter.broadcast).not.toHaveBeenCalled()
  })
  it.each(['equal','malformed','timeout','pending'])('does not retire on %s checkpoint evidence',async mode=>{
    const f=await fixture();if(mode==='pending')f.adapter.query.mockResolvedValue('PENDING')
    else if(mode==='timeout')f.adapter.expiryCheckpoint.mockRejectedValue(new Error('timeout'))
    else f.adapter.expiryCheckpoint.mockResolvedValue(mode==='equal'?marketCancelCheckpointFixture('10').evidence:{...marketCancelCheckpointFixture().evidence,digest:'bad'})
    await f.run({action:'retire'});expect(f.row.nativeOperation.phase).toBe('SIGNING');expect(mocks.updateMany).not.toHaveBeenCalled()
  })
  it('RETIRED is query-only and can later reconcile a past success',async()=>{
    const f=await fixture();await f.run({action:'retire'});expect((await f.run({action:'execute'})).status).toBe(409)
    f.adapter.query.mockResolvedValue('SUCCEEDED');expect((await f.run({action:'check'})).status).toBe(200);expect(f.row.nativeOperation.retirement).toBeDefined();expect(f.adapter.broadcast).not.toHaveBeenCalled()
  })
  it('expiration makes retry unavailable, never failed',async()=>{
    const f=await fixture();f.adapter.preflight.mockRejectedValue(new Error('Saved purchase expired; query or retire without rebuilding it'))
    expect((await f.run()).status).toBe(409);expect(f.row.nativeOperation.phase).toBe('SIGNING');expect(f.adapter.broadcast).not.toHaveBeenCalled()
  })
  it('persistence timeout cannot continue into a late broadcast',async()=>{
    const f=await fixture();vi.useFakeTimers();let resolve!:(value:any)=>void;mocks.updateMany.mockImplementation(()=>new Promise(r=>{resolve=r}))
    const pending=f.run();await vi.advanceTimersByTimeAsync(25001);expect((await pending).status).toBe(503)
    resolve({count:1});await Promise.resolve();expect(f.adapter.broadcast).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['valid','receipt','effects','historical-package'])('uses real adapter finalized proof: %s',async mode=>{
    const f=await fixture()
    const event=marketBuyEventEvidence(f.record,mode==='receipt'?r=>{r.provenance_id=bid(999)}:undefined)
    const effects=bcs.TransactionEffects.serialize({V2:{status:{Success:true},executedEpoch:'9',
      gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},
      transactionDigest:mode==='effects'?f.snapshot.release.soulidityCallableDigest:f.record.digest,
      gasObjectIndex:null,eventsDigest:event.digest,dependencies:[],lamportVersion:'3',changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}).toBytes()
    const client:any={ledgerService:{getServiceInfo:vi.fn(async()=>({response:{chainId:MAINNET_GENESIS_DIGEST}})),
      getTransaction:vi.fn(async()=>({response:{transaction:{digest:f.record.digest,transaction:{digest:f.record.digest,bcs:{value:f.bytes}},
        effects:{transactionDigest:f.record.digest,bcs:{value:effects},status:{success:true}},events:event,checkpoint:1n}}})),
      getObject:vi.fn(async()=>({response:{object:{objectId:f.snapshot.release.soulidityCallablePackageId,version:2n,
        digest:mode==='historical-package'?f.record.digest:f.snapshot.release.soulidityCallableDigest,owner:{kind:4},
        package:{storageId:f.snapshot.release.soulidityCallablePackageId,originalId:f.snapshot.release.soulidityOriginalPackageId,version:2n,
          typeOrigins:[{moduleName:'market',datatypeName:'AnimacraftV8SoulPurchased',packageId:f.snapshot.release.soulidityOriginalPackageId}]}}}}))},core:{executeTransaction:vi.fn()}}
    const read=vi.fn(async()=>{throw new Error('current configuration offline')});const sign=vi.fn(async()=>{throw new Error('server must not sign')})
    mocks.services.mockImplementation((_scope,_signal,_observed,sync)=>({adapter:createMarketBuyOperationAdapter({client,read,getAddress:()=>f.snapshot.buyer,sign,sync})}))
    expect((await f.run({action:'check'})).status).toBe(mode==='valid'?200:503)
    expect(mocks.mirror).toHaveBeenCalledTimes(mode==='valid'?1:0);expect(read).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();expect(client.core.executeTransaction).not.toHaveBeenCalled()
  })
})
