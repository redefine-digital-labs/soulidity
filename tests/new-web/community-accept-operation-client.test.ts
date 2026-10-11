import {afterEach,expect,it,vi} from 'vitest'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {SuiGrpcClient} from '@mysten/sui/grpc'
import {bcs} from '@mysten/sui/bcs'
import {fromBase64,toBase64} from '@mysten/sui/utils'
import {profileId as id,profileSigner as signer,profileDigest as digest} from './fixtures/public-profile-operation'
import {buildAcceptPublicCommunityAnswerTx} from '../../packages/soulidity-sdk/src/community-posts-write'
import {createPublicCommunityAcceptIntent,runPublicCommunityAcceptOperation,publicCommunityAcceptOperationKey,type PublicCommunityAcceptOperation} from '../../packages/soulidity-sdk/src/community-accept-operation'
import {createPublicCommunityAcceptOperationClient,browserPublicCommunityAcceptOperationStore} from '../../web/lib/community/accept-operation-client'
const mocks=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('../../web/lib/community/accept-preflight',()=>({assertCommunityAcceptanceReady:mocks.read}))
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();mocks.read.mockReset()})
async function fixture(){
  const intent=createPublicCommunityAcceptIntent({deployment:{profile:{originalPackageId:id(1),callablePackageId:id(2),registryId:id(3),chainIdentifier:'01010101'},registryId:id(4)},owner:signer.toSuiAddress(),authorId:id(7),postId:id(8),expectedRevision:'0',commentId:id(9)})
  const resolve=(tx:Transaction)=>{
    const data=tx.getData(),result=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>input.UnresolvedObject?
      input.UnresolvedObject.objectId===intent.commentId?{Object:{ImmOrOwnedObject:{objectId:intent.commentId,version:'1',digest}}}:
      {Object:{SharedObject:{objectId:input.UnresolvedObject.objectId,initialSharedVersion:'1',mutable:input.UnresolvedObject.objectId===intent.postId}}}:input)}))
    result.setGasOwner(intent.owner);result.setGasBudget('10000000');result.setGasPrice('1000');result.setGasPayment([{objectId:id(60),version:'1',digest}]);return result
  }
  const tx=resolve(buildAcceptPublicCommunityAnswerTx(intent));tx.setExpiration({Epoch:'10'});const bytes=await tx.build()
  const record={schema:'soulidity.community-accept-operation.v1' as const,intent,bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'10',phase:'PREPARED' as const,signature:null}
  const client=new SuiGrpcClient({network:'mainnet',baseUrl:'https://not-called.invalid'})
  vi.spyOn(client.core,'getChainIdentifier').mockResolvedValue({chainIdentifier:digest})
  const epoch=vi.spyOn(client.ledgerService,'getEpoch').mockResolvedValue({response:{epoch:{epoch:9n}}} as any)
  const execute=vi.spyOn(client.core,'executeTransaction').mockResolvedValue({} as any)
  const effects=bcs.TransactionEffects.serialize({V2:{status:{Success:true},executedEpoch:'9',gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},transactionDigest:record.digest,gasObjectIndex:null,eventsDigest:null,dependencies:[],lamportVersion:'3',changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}).toBytes()
  const ledger={digest:record.digest,transaction:{digest:record.digest,bcs:{value:bytes}},effects:{transactionDigest:record.digest,bcs:{value:effects},status:{success:true}},checkpoint:0n as bigint|undefined}
  const query=vi.spyOn(client.ledgerService,'getTransaction').mockResolvedValue({response:{transaction:ledger}} as any)
  const original=Transaction.prototype.build
  vi.spyOn(Transaction.prototype,'build').mockImplementation(async function(this:Transaction,options){return options?.client===client?original.call(resolve(this)):original.call(this,options)})
  mocks.read.mockResolvedValue({})
  let enabled=true,address:string|null=intent.owner
  const sign=vi.fn(async(tx:Transaction)=>signer.signTransaction(await tx.build()))
  const real=createPublicCommunityAcceptOperationClient({client,deployment:intent.deployment,writesEnabled:()=>enabled,getAddress:()=>address,sign})
  return {intent,record,client,real,sign,query,ledger,epoch,execute,disable:()=>{enabled=false;address=null}}
}
// Reader proof is tested separately against raw ABI fixtures; this suite isolates
// browser lifecycle with genuine PTB serialization, keys and raw transaction effects.
it('prepares the exact immutable accepted-answer intent without prompting a wallet',async()=>{
  const f=await fixture();expect(await f.real.prepare(f.intent)).toEqual(f.record)
  expect(f.sign).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled()
})
it('uses authority/CAS preflight for preparation and signing, and authority-only preflight for replay',async()=>{
  const f=await fixture()
  await f.real.prepare(f.intent)
  expect(mocks.read).toHaveBeenLastCalledWith({client:f.client,intent:f.intent,signing:true})
  await f.real.adapter.preflight(f.record,true)
  expect(mocks.read).toHaveBeenLastCalledWith({client:f.client,intent:f.intent,signing:true})
  const signed={...f.record,phase:'SIGNED' as const,signature:(await signer.signTransaction(fromBase64(f.record.bytes))).signature}
  await f.real.adapter.preflight(signed,false)
  expect(mocks.read).toHaveBeenLastCalledWith({client:f.client,intent:f.intent,signing:false})
})
it.each(['AUTHOR_CHANGED','REVISION_CHANGED_RELOAD_REQUIRED','PARENT_MISMATCH'])('propagates preflight failure %s before any wallet prompt',async error=>{
  const f=await fixture();mocks.read.mockRejectedValue(new Error('COMMUNITY_ACCEPT_'+error))
  await expect(f.real.prepare(f.intent)).rejects.toThrow(error)
  await expect(f.real.adapter.preflight(f.record,true)).rejects.toThrow(error)
  expect(f.sign).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled()
})
it('queries exact saved results even while disconnected and writes disabled',async()=>{
  const f=await fixture();f.disable()
  expect(await f.real.adapter.query(f.record)).toBe('SUCCEEDED')
  await expect(f.real.prepare(f.intent)).rejects.toThrow('WRITES_DISABLED')
})
it.each(['bytes','digest','status','checkpoint','effects'])('rejects substituted query evidence %s',async field=>{
  const f=await fixture()
  if(field==='bytes')f.ledger.transaction.bcs.value=new Uint8Array([0])
  if(field==='digest')f.ledger.digest=digest
  if(field==='status')f.ledger.effects.status.success=false
  if(field==='checkpoint')f.ledger.checkpoint=-1n
  if(field==='effects')f.ledger.effects.bcs.value=new Uint8Array([...f.ledger.effects.bcs.value,0])
  await expect(f.real.adapter.query(f.record)).rejects.toThrow()
})
it('distinguishes missing, pending and unavailable query evidence',async()=>{
  const f=await fixture();f.ledger.checkpoint=undefined
  expect(await f.real.adapter.query(f.record)).toBe('PENDING')
  f.query.mockRejectedValueOnce(Object.assign(new Error('missing'),{code:'NOT_FOUND'}))
  expect(await f.real.adapter.query(f.record)).toBe('MISSING')
  f.query.mockRejectedValueOnce(new Error('NOT_FOUND'))
  await expect(f.real.adapter.query(f.record)).rejects.toThrow('NOT_FOUND')
})
it('verifies actual owner signature and broadcasts only the saved bytes',async()=>{
  const f=await fixture(),signed={...f.record,phase:'SIGNED' as const,signature:(await signer.signTransaction(fromBase64(f.record.bytes))).signature}
  await f.real.adapter.verifySignature(signed);await f.real.adapter.broadcast(signed)
  expect(f.execute).toHaveBeenCalledWith({transaction:fromBase64(signed.bytes),signatures:[signed.signature]})
  f.epoch.mockResolvedValue({response:{epoch:{epoch:11n}}} as any)
  await expect(f.real.adapter.preflight(signed,false)).rejects.toThrow('EXPIRED_QUERY_ONLY')
})
it('recovers an unknown broadcast by saved digest without signing or sending a replacement',async()=>{
  const f=await fixture();let saved:PublicCommunityAcceptOperation|null=null,submitted=false
  f.query.mockImplementation(async()=>{
    if(!submitted)throw Object.assign(new Error('missing'),{code:'NOT_FOUND'})
    return {response:{transaction:f.ledger}} as any
  })
  f.execute.mockImplementation(async()=>{submitted=true;throw new Error('connection lost after submit')})
  const store={exclusive:async(_key:string,work:()=>Promise<any>)=>work(),read:()=>structuredClone(saved),write:(_key:string,record:PublicCommunityAcceptOperation)=>{saved=structuredClone(record)}}
  await expect(runPublicCommunityAcceptOperation({intent:f.intent,prepared:f.record,store,adapter:f.real.adapter})).rejects.toThrow('connection lost')
  expect(saved!.phase).toBe('SIGNED')
  f.disable()
  expect((await runPublicCommunityAcceptOperation({intent:f.intent,store,adapter:f.real.adapter,queryOnly:true})).phase).toBe('SUCCEEDED')
  expect(f.sign).toHaveBeenCalledTimes(1);expect(f.execute).toHaveBeenCalledTimes(1)
})
it('browser store verifies scope, round-trip persistence and cross-tab lock ownership',async()=>{
  const f=await fixture(),rows=new Map<string,string>()
  const setItem=vi.fn((key:string,value:string)=>{rows.set(key,value)})
  vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>rows.get(key)??null,setItem}})
  const request=vi.fn(async(_key:string,_options:any,work:any)=>work({name:'lock'}))
  vi.stubGlobal('navigator',{locks:{request}})
  const store=browserPublicCommunityAcceptOperationStore(),key=publicCommunityAcceptOperationKey(f.intent)
  await store.exclusive(key,async()=>{store.write(key,f.record)})
  expect(store.read(key)).toEqual(f.record)
  expect(()=>store.write(key+'wrong',f.record)).toThrow('SCOPE_MISMATCH')
  request.mockImplementation(async(_key,_options,work)=>work(null))
  await expect(store.exclusive(key,async()=>undefined)).rejects.toThrow('BUSY_IN_ANOTHER_TAB')
  setItem.mockImplementation(()=>{})
  expect(()=>store.write(key,{...f.record,phase:'SIGNING'})).toThrow('PERSISTENCE_FAILED')
})
it.each(['sign','broadcast'] as const)('bounds a stalled %s and retains the exact unknown operation for query',async step=>{
  const f=await fixture();vi.useFakeTimers()
  f.query.mockRejectedValue(Object.assign(new Error('missing'),{code:'NOT_FOUND'}))
  let saved:PublicCommunityAcceptOperation|null=null,complete!:()=>void
  if(step==='sign')f.sign.mockImplementation(()=>new Promise(resolve=>{complete=()=>{void signer.signTransaction(fromBase64(f.record.bytes)).then(resolve)}}))
  else f.execute.mockImplementation(()=>new Promise(resolve=>{complete=()=>resolve({} as any)}))
  const store={exclusive:async(_key:string,work:()=>Promise<any>)=>work(),read:()=>structuredClone(saved),write:(_key:string,record:PublicCommunityAcceptOperation)=>{saved=structuredClone(record)}}
  const pending=runPublicCommunityAcceptOperation({intent:f.intent,prepared:f.record,store,adapter:f.real.adapter}).catch(error=>error)
  await vi.advanceTimersByTimeAsync(step==='sign'?120001:30001)
  expect((await pending).message).toContain(step==='sign'?'SIGNING_TIMEOUT':'BROADCAST_TIMEOUT')
  expect(saved!.phase).toBe(step==='sign'?'SIGNING':'SIGNED');expect(saved!.bytes).toBe(f.record.bytes)
  complete();await vi.advanceTimersByTimeAsync(1)
  expect(saved!.phase).toBe(step==='sign'?'SIGNING':'SIGNED')
  expect(f.execute).toHaveBeenCalledTimes(step==='sign'?0:1)
})
it.each([undefined,-1n,18446744073709551615n,9])('rejects invalid current epoch %s before preparing bytes',async value=>{
  const f=await fixture();f.epoch.mockResolvedValue({response:{epoch:{epoch:value}}} as any)
  await expect(f.real.prepare(f.intent)).rejects.toThrow('CURRENT_EPOCH_UNAVAILABLE')
  expect(f.sign).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled()
})
it('rejects a mismatched chain during query even with disconnected wallet and disabled writes',async()=>{
  const f=await fixture();f.disable()
  vi.mocked(f.client.core.getChainIdentifier).mockResolvedValue({chainIdentifier:'11111111111111111111111111111111'})
  await expect(f.real.adapter.query(f.record)).rejects.toThrow('WRONG_CHAIN')
  expect(f.query).not.toHaveBeenCalled()
})
it('never treats late execution or mismatched nested digest as confirmation',async()=>{
  const f=await fixture(),decoded=bcs.TransactionEffects.parse(f.ledger.effects.bcs.value)
  decoded.V2!.executedEpoch='11'
  f.ledger.effects.bcs.value=bcs.TransactionEffects.serialize(decoded).toBytes()
  await expect(f.real.adapter.query(f.record)).rejects.toThrow('STATUS_MISMATCH')
  f.ledger.transaction.digest=digest
  await expect(f.real.adapter.query(f.record)).rejects.toThrow('EVIDENCE_MISMATCH')
})
it('rejects corrupt, oversized and incorrectly keyed stored records',async()=>{
  const f=await fixture();let raw:string|null=null
  vi.stubGlobal('window',{localStorage:{getItem:()=>raw,setItem:vi.fn()}})
  vi.stubGlobal('navigator',{locks:{request:vi.fn()}})
  const store=browserPublicCommunityAcceptOperationStore(),key=publicCommunityAcceptOperationKey(f.intent)
  expect(store.read(key)).toBeNull()
  raw='x'.repeat(65537);expect(()=>store.read(key)).toThrow('RECORD_TOO_LARGE')
  raw='{';expect(()=>store.read(key)).toThrow()
  raw=JSON.stringify(f.record);expect(()=>store.read(key+'wrong')).toThrow('SCOPE_MISMATCH')
})
