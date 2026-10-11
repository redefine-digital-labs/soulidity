import {afterEach,expect,it,vi} from 'vitest'
import {Transaction,TransactionDataBuilder} from '@mysten/sui/transactions'
import {SuiGrpcClient} from '@mysten/sui/grpc'
import {bcs} from '@mysten/sui/bcs'
import {fromBase64,toBase64} from '@mysten/sui/utils'
import {profileId as id,profileSigner as signer,profileDigest as digest} from './fixtures/public-profile-operation'
import {buildSetPublicCommunityVoteTx} from '../../packages/soulidity-sdk/src/community-votes'
import {createPublicCommunityVoteIntent,runPublicCommunityVoteOperation,publicCommunityVoteOperationKey,type PublicCommunityVoteOperation} from '../../packages/soulidity-sdk/src/community-vote-operation'
import {createPublicCommunityVoteOperationClient,browserPublicCommunityVoteOperationStore} from '../../web/lib/community/vote-operation-client'
const mocks=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('@soulidity/sdk',async original=>({...await original<any>(),readPublicCommunityVotes:mocks.read}))
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();mocks.read.mockReset()})
async function fixture(){
  const intent=createPublicCommunityVoteIntent({deployment:{community:{profile:{originalPackageId:id(1),callablePackageId:id(2),registryId:id(3),chainIdentifier:'01010101'},registryId:id(4)},registryId:id(5)},owner:signer.toSuiAddress(),actorId:id(7),postId:id(8),expectedRevision:'0',desired:1})
  const resolve=(tx:Transaction)=>{
    const data=tx.getData(),result=Transaction.from(JSON.stringify({...data,inputs:data.inputs.map(input=>input.UnresolvedObject?
      {Object:{SharedObject:{objectId:input.UnresolvedObject.objectId,initialSharedVersion:'1',mutable:input.UnresolvedObject.objectId===intent.deployment.registryId}}}:input)}))
    result.setGasOwner(intent.owner);result.setGasBudget('10000000');result.setGasPrice('1000');result.setGasPayment([{objectId:id(60),version:'1',digest}]);return result
  }
  const tx=resolve(buildSetPublicCommunityVoteTx(intent));tx.setExpiration({Epoch:'10'});const bytes=await tx.build()
  const record={schema:'soulidity.community-vote-operation.v1' as const,intent,bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes),expirationEpoch:'10',phase:'PREPARED' as const,signature:null}
  const client=new SuiGrpcClient({network:'mainnet',baseUrl:'https://not-called.invalid'})
  vi.spyOn(client.core,'getChainIdentifier').mockResolvedValue({chainIdentifier:digest})
  const epoch=vi.spyOn(client.ledgerService,'getEpoch').mockResolvedValue({response:{epoch:{epoch:9n}}} as any)
  const execute=vi.spyOn(client.core,'executeTransaction').mockResolvedValue({} as any)
  const effects=bcs.TransactionEffects.serialize({V2:{status:{Success:true},executedEpoch:'9',gasUsed:{computationCost:'1',storageCost:'0',storageRebate:'0',nonRefundableStorageFee:'0'},transactionDigest:record.digest,gasObjectIndex:null,eventsDigest:null,dependencies:[],lamportVersion:'3',changedObjects:[],unchangedConsensusObjects:[],auxDataDigest:null}}).toBytes()
  const ledger={digest:record.digest,transaction:{digest:record.digest,bcs:{value:bytes}},effects:{transactionDigest:record.digest,bcs:{value:effects},status:{success:true}},checkpoint:0n as bigint|undefined}
  const query=vi.spyOn(client.ledgerService,'getTransaction').mockResolvedValue({response:{transaction:ledger}} as any)
  const original=Transaction.prototype.build
  vi.spyOn(Transaction.prototype,'build').mockImplementation(async function(this:Transaction,options){return options?.client===client?original.call(resolve(this)):original.call(this,options)})
  const state={viewer:{id:intent.actorId,owner:intent.owner},post:{id:intent.postId},state:0,revision:'0'}
  mocks.read.mockImplementation(async()=>structuredClone(state))
  let enabled=true,address:string|null=intent.owner
  const sign=vi.fn(async(tx:Transaction)=>signer.signTransaction(await tx.build()))
  const real=createPublicCommunityVoteOperationClient({client,deployment:intent.deployment,writesEnabled:()=>enabled,getAddress:()=>address,sign})
  return {intent,record,client,real,state,sign,query,ledger,epoch,execute,disable:()=>{enabled=false;address=null}}
}
// Reader proof is tested separately against raw ABI fixtures; this suite isolates
// browser lifecycle with genuine PTB serialization, keys and raw transaction effects.
it('prepares the exact immutable desired state without prompting a wallet',async()=>{
  const f=await fixture();expect(await f.real.prepare(f.intent)).toEqual(f.record)
  expect(f.sign).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled()
})
it.each(['revision','state','viewer','post'])('rejects changed %s before signing',async field=>{
  const f=await fixture()
  if(field==='revision')f.state.revision='1'
  if(field==='state')f.state.state=1
  if(field==='viewer')f.state.viewer.id=id(99)
  if(field==='post')f.state.post.id=id(99)
  await expect(f.real.prepare(f.intent)).rejects.toThrow();expect(f.sign).not.toHaveBeenCalled()
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
  const f=await fixture();let saved:PublicCommunityVoteOperation|null=null,submitted=false
  f.query.mockImplementation(async()=>{
    if(!submitted)throw Object.assign(new Error('missing'),{code:'NOT_FOUND'})
    return {response:{transaction:f.ledger}} as any
  })
  f.execute.mockImplementation(async()=>{submitted=true;throw new Error('connection lost after submit')})
  const store={exclusive:async(_key:string,work:()=>Promise<any>)=>work(),read:()=>structuredClone(saved),write:(_key:string,record:PublicCommunityVoteOperation)=>{saved=structuredClone(record)}}
  await expect(runPublicCommunityVoteOperation({intent:f.intent,prepared:f.record,store,adapter:f.real.adapter})).rejects.toThrow('connection lost')
  expect(saved!.phase).toBe('SIGNED')
  f.disable()
  expect((await runPublicCommunityVoteOperation({intent:f.intent,store,adapter:f.real.adapter,queryOnly:true})).phase).toBe('SUCCEEDED')
  expect(f.sign).toHaveBeenCalledTimes(1);expect(f.execute).toHaveBeenCalledTimes(1)
})
it('browser store verifies scope, round-trip persistence and cross-tab lock ownership',async()=>{
  const f=await fixture(),rows=new Map<string,string>()
  const setItem=vi.fn((key:string,value:string)=>{rows.set(key,value)})
  vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>rows.get(key)??null,setItem}})
  const request=vi.fn(async(_key:string,_options:any,work:any)=>work({name:'lock'}))
  vi.stubGlobal('navigator',{locks:{request}})
  const store=browserPublicCommunityVoteOperationStore(),key=publicCommunityVoteOperationKey(f.intent)
  await store.exclusive(key,async()=>{store.write(key,f.record)})
  expect(store.read(key)).toEqual(f.record)
  expect(()=>store.write(key+'wrong',f.record)).toThrow('SCOPE_MISMATCH')
  request.mockImplementation(async(_key,_options,work)=>work(null))
  await expect(store.exclusive(key,async()=>undefined)).rejects.toThrow('BUSY_IN_ANOTHER_TAB')
  setItem.mockImplementation(()=>{})
  expect(()=>store.write(key,{...f.record,phase:'SIGNING'})).toThrow('PERSISTENCE_FAILED')
})
