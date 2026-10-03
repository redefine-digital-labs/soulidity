import { afterEach, expect, it, vi } from 'vitest'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { fromBase64, toBase64 } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { browserMarketCancelOperationStore, marketCancelOperationKey, runMarketCancelOperation,
  terminalMarketCancelOperation, validateMarketCancelOperationRecord,
  queryMarketCancelHistory,
  type MarketCancelOperationRecord, type MarketCancelOperationStore } from '../../web/lib/animacraft/market-cancel-operation'
import { marketCancelFixture, marketCancelCheckpointFixture, cancelSigner, cid } from './fixtures/market-cancel-operation'

async function fixture() {
  const f = await marketCancelFixture(); let saved: MarketCancelOperationRecord | null = null
  let submitted = false; let locked = false
  const events: string[] = []
  const archive = new Map<string,MarketCancelOperationRecord>()
  const store: MarketCancelOperationStore = {
    async exclusive(_key, work) { if (locked) throw new Error('locked'); locked = true; try { return await work() } finally { locked = false } },
    read: () => structuredClone(saved),
    write: vi.fn((_key, record) => { events.push(`save:${record.phase}:${record.syncStatus ?? ''}`); saved = structuredClone(record) }),
    archive: vi.fn((_key,record) => {
      events.push('archive')
      if(archive.has(record.digest)) expect(archive.get(record.digest)).toEqual(record)
      else archive.set(record.digest,structuredClone(record))
    }),
    history: vi.fn(() => [...archive.values()].map(record=>structuredClone(record))),
  }
  const adapter = {
    prepare: vi.fn(async () => { events.push('prepare'); return structuredClone(f.record) }),
    query: vi.fn(async (_record: MarketCancelOperationRecord): Promise<'MISSING'|'PENDING'|'SUCCEEDED'|'FAILED'> => { events.push('query'); return submitted ? 'SUCCEEDED' : 'MISSING' }),
    preflight: vi.fn(async (_record: MarketCancelOperationRecord, signing: boolean) => { events.push(`preflight:${signing}`) }),
    sign: vi.fn(async (record: MarketCancelOperationRecord) => { events.push('sign'); return cancelSigner.signTransaction(fromBase64(record.bytes)) }),
    verifySignature: vi.fn(async (record: MarketCancelOperationRecord) => {
      await verifyTransactionSignature(fromBase64(record.bytes), record.signature!, { address: record.owner })
    }),
    broadcast: vi.fn(async (_record: MarketCancelOperationRecord) => { events.push('broadcast'); submitted = true }),
    sync: vi.fn(async (_record: MarketCancelOperationRecord): Promise<'COMPLETE'|'SUPERSEDED'> => { events.push('sync'); return 'COMPLETE' }),
    expiryCheckpoint: vi.fn(async (_record:MarketCancelOperationRecord) => { events.push('checkpoint'); return marketCancelCheckpointFixture().evidence }),
  }
  const params = { soulId: f.record.soulId, owner: f.record.owner, store, adapter }
  return { ...f, events, store, archive, adapter, params, saved: () => structuredClone(saved),
    setSaved: (value: MarketCancelOperationRecord) => { saved = structuredClone(value) },
    setSubmitted: (value: boolean) => { submitted = value } }
}
afterEach(() => vi.unstubAllGlobals())
it('persists before wallet, before broadcast, and finalized success before receipt sync', async () => {
  const f = await fixture(); const result = await runMarketCancelOperation({ ...f.params, start: true })
  expect(result).toMatchObject({ phase: 'SUCCEEDED', syncStatus: 'COMPLETE', bytes: f.record.bytes })
  expect(f.events).toEqual(['prepare','save:PREPARED:','query','preflight:true','save:SIGNING:','sign',
    'save:SIGNED:','preflight:false','broadcast','query','save:SUCCEEDED:PENDING','sync','save:SUCCEEDED:COMPLETE'])
  expect(terminalMarketCancelOperation(result)).toBe(true)
})
it('never opens wallet when initial durable storage fails', async () => {
  const f = await fixture(); vi.mocked(f.store.write).mockImplementation(() => { throw new Error('quota') })
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow('quota')
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('cannot broadcast an unpersisted signature; unknown SIGNING cannot be discarded', async () => {
  const f = await fixture(); const write = f.store.write
  f.store.write = (key, record) => { if (record.phase === 'SIGNED') throw new Error('quota'); write(key,record) }
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow('quota')
  expect(f.saved()?.phase).toBe('SIGNING'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  await expect(runMarketCancelOperation({ ...f.params, cancelUnsigned: true })).rejects.toThrow('cannot be discarded')
  f.store.write = write
  await runMarketCancelOperation(f.params)
  expect(f.adapter.sign.mock.calls.map(([record]) => record.bytes)).toEqual([f.record.bytes,f.record.bytes])
})
it('unknown broadcast resumes by query with identical bytes and no new signature or preparation', async () => {
  const f = await fixture()
  f.adapter.broadcast.mockImplementationOnce(async () => { f.setSubmitted(true); throw new Error('timeout') })
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow('timeout')
  expect(f.saved()?.phase).toBe('SIGNED')
  const result = await runMarketCancelOperation(f.params)
  expect(result.phase).toBe('SUCCEEDED'); expect(f.adapter.sign).toHaveBeenCalledTimes(1)
  expect(f.adapter.prepare).toHaveBeenCalledTimes(1); expect(f.adapter.broadcast).toHaveBeenCalledTimes(1)
})
it('missing signed transaction rebroadcasts its same verified signature without another prompt', async () => {
  const f = await fixture(); const signed = await cancelSigner.signTransaction(f.bytes)
  f.setSaved({ ...f.record, phase: 'SIGNED', signature: signed.signature })
  await runMarketCancelOperation(f.params)
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.prepare).not.toHaveBeenCalled()
  expect(f.adapter.broadcast.mock.calls[0][0]).toMatchObject({ bytes: f.record.bytes, signature: signed.signature })
  expect(f.events[0]).toBe('query')
})
function walletRejection() {
  return Object.assign(new Error('Rejected'), { name: 'WalletStandardError', context: { __code: 4001000 } })
}
it('only explicit WalletStandard rejection resets the initial unsigned attempt', async () => {
  const f = await fixture(); f.adapter.sign.mockRejectedValueOnce(walletRejection())
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow('Rejected')
  expect(f.saved()?.phase).toBe('PREPARED')
  expect((await runMarketCancelOperation({ ...f.params, cancelUnsigned: true })).phase).toBe('CANCELLED')
})
it.each([new Error('User rejected'),Object.assign(new Error('Rejected'),{code:4001}),Object.assign(new Error('Rejected'),{context:{__code:4001000}})])
  ('ambiguous wallet failure remains SIGNING', async error => {
    const f = await fixture(); f.adapter.sign.mockRejectedValueOnce(error)
    await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow()
    expect(f.saved()?.phase).toBe('SIGNING')
    f.adapter.sign.mockRejectedValueOnce(walletRejection())
    await expect(runMarketCancelOperation(f.params)).rejects.toThrow()
    expect(f.saved()?.phase).toBe('SIGNING')
  })
it.each(['bytes','signature'])('rejects wallet substitution of %s without broadcast', async problem => {
  const f = await fixture()
  f.adapter.sign.mockImplementationOnce(async () => problem === 'bytes'
    ? { bytes: 'wrong', signature: 'wrong' }
    : Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(29)).signTransaction(f.bytes))
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow()
  expect(f.saved()?.phase).toBe('SIGNING'); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('sync outage preserves finalized success; relisted lifecycle can supersede sync and cancel the new listing', async () => {
  const f = await fixture(); f.adapter.sync.mockRejectedValueOnce(new Error('sync outage'))
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow('sync outage')
  expect(f.saved()).toMatchObject({ phase: 'SUCCEEDED', syncStatus: 'PENDING' })
  f.adapter.sync.mockResolvedValueOnce('SUPERSEDED')
  expect(await runMarketCancelOperation({ ...f.params, queryOnly: true })).toMatchObject({ phase: 'SUCCEEDED', syncStatus: 'SUPERSEDED' })
  // Build real different listing bytes, not a forged metadata-only new intent.
  const data = f.tx.getData(); const listing = data.inputs.find(row => row.Object?.SharedObject?.objectId === f.record.listingId)!
  listing.Object!.SharedObject!.objectId = cid(90)
  const bytes = await Transaction.from(JSON.stringify(data)).build()
  const next = { ...f.record, listingId: cid(90), bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) }
  f.adapter.prepare.mockImplementationOnce(async () => { f.setSubmitted(false); return next })
  expect(await runMarketCancelOperation({ ...f.params, start: true })).toMatchObject({ listingId: cid(90), phase: 'SUCCEEDED', syncStatus: 'COMPLETE' })
  expect(f.adapter.sign).toHaveBeenCalledTimes(2)
})
it('new intent needs confirmed old ledger result but not old held-state sync', async () => {
  const f = await fixture(); f.setSaved({ ...f.record, phase: 'SUCCEEDED', syncStatus: 'PENDING' }); f.setSubmitted(true)
  f.adapter.sync.mockRejectedValue(new Error('obsolete sync'))
  f.adapter.prepare.mockRejectedValueOnce(new Error('fresh listing unavailable'))
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow('fresh listing unavailable')
  expect(f.adapter.sync).not.toHaveBeenCalled(); expect(f.saved()?.phase).toBe('SUCCEEDED')
})
it.each(['COMPLETE', 'SUPERSEDED'] as const)('cold %s success is rechecked against current chain state on each explicit query', async previous => {
  const f = await fixture(); f.setSaved({ ...f.record, phase: 'SUCCEEDED', syncStatus: previous }); f.setSubmitted(true)
  f.adapter.sync.mockImplementationOnce(async () => { f.events.push('sync'); return 'SUPERSEDED' })
  expect(await runMarketCancelOperation({ ...f.params, queryOnly: true })).toMatchObject({
    digest: f.record.digest, bytes: f.record.bytes, phase: 'SUCCEEDED', syncStatus: 'SUPERSEDED' })
  expect(f.events).toEqual(['query', 'save:SUCCEEDED:PENDING', 'sync', 'save:SUCCEEDED:SUPERSEDED'])
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.prepare).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each(['COMPLETE', 'SUPERSEDED'] as const)('failed current readback clears a cached %s confirmation without losing successful transaction evidence', async previous => {
  const f = await fixture(); f.setSaved({ ...f.record, phase: 'SUCCEEDED', syncStatus: previous }); f.setSubmitted(true)
  f.adapter.sync.mockRejectedValueOnce(new Error('Current custody unavailable'))
  await expect(runMarketCancelOperation({ ...f.params, queryOnly: true })).rejects.toThrow('Current custody unavailable')
  expect(f.saved()).toMatchObject({ digest: f.record.digest, bytes: f.record.bytes, phase: 'SUCCEEDED', syncStatus: 'PENDING' })
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each(['MISSING','PENDING'] as const)('query-only %s never prepares, preflights, prompts or broadcasts', async status => {
  const f = await fixture(); f.setSaved(f.record); f.adapter.query.mockResolvedValue(status)
  expect(await runMarketCancelOperation({ ...f.params, queryOnly: true })).toEqual(f.record)
  expect(f.adapter.preflight).not.toHaveBeenCalled(); expect(f.adapter.sign).not.toHaveBeenCalled()
  expect(f.adapter.prepare).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('network failure does not become absence, failure or deletion', async () => {
  const f = await fixture(); f.setSaved(f.record); f.adapter.query.mockRejectedValue(new Error('offline'))
  await expect(runMarketCancelOperation(f.params)).rejects.toThrow('offline')
  expect(f.saved()).toEqual(f.record); expect(f.adapter.preflight).not.toHaveBeenCalled()
})
it.each(['SUCCEEDED','FAILED'] as const)('forged %s is not accepted without exact ledger evidence', async phase => {
  const f = await fixture(); f.setSaved({ ...f.record, phase, ...(phase === 'SUCCEEDED' ? {syncStatus:'COMPLETE' as const} : {}) })
  await expect(runMarketCancelOperation({ ...f.params, queryOnly: true })).rejects.toThrow('cannot be confirmed')
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow('must be confirmed')
  expect(f.adapter.prepare).not.toHaveBeenCalled()
})
it('finalized failure is terminal without success sync', async () => {
  const f = await fixture(); f.setSaved(f.record); f.adapter.query.mockResolvedValue('FAILED')
  expect(await runMarketCancelOperation(f.params)).toMatchObject({ phase: 'FAILED' })
  expect(f.adapter.sync).not.toHaveBeenCalled(); expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('preflight expiry leaves the pending journal indefinitely available for query', async () => {
  const f = await fixture(); f.setSaved(f.record); f.adapter.preflight.mockRejectedValue(new Error('expired'))
  await expect(runMarketCancelOperation(f.params)).rejects.toThrow('expired')
  expect(f.saved()).toEqual(f.record)
  expect(await runMarketCancelOperation({ ...f.params, queryOnly: true })).toEqual(f.record)
})
it('pending operations cannot be replaced and lock contention cannot open another wallet prompt', async () => {
  const f = await fixture(); f.setSaved(f.record)
  await expect(runMarketCancelOperation({ ...f.params, start: true })).rejects.toThrow('pending')
  let unlock!: () => void
  const lock = f.store.exclusive('key', () => new Promise<void>(resolve => { unlock = resolve }))
  await expect(runMarketCancelOperation(f.params)).rejects.toThrow('locked'); unlock(); await lock
  expect(f.adapter.sign).not.toHaveBeenCalled()
})
it('onRecord and adapter input mutations cannot change persisted bytes or identities', async () => {
  const f = await fixture()
  f.adapter.preflight.mockImplementation(async record => { record.owner = cid(999); record.bytes = 'wrong' })
  const result = await runMarketCancelOperation({ ...f.params, start: true,
    onRecord: record => { record.bytes = 'wrong'; record.release.soulidityCallablePackageId = cid(999) } })
  expect(result.bytes).toBe(f.record.bytes); expect(f.saved()?.bytes).toBe(f.record.bytes)
  result.owner = cid(999); expect(f.saved()?.owner).toBe(f.record.owner)
})
it.each(['scope','phase','sync-status','kind','signature','epoch','release-digest','digest','trailing-bytes'])
  ('rejects malformed recovery %s', async problem => {
    const f = await fixture(); const record = structuredClone(f.record) as any
    if (problem === 'scope') record.owner = '0x1'
    if (problem === 'phase') record.phase = 'UNKNOWN'
    if (problem === 'sync-status') record.phase = 'SUCCEEDED'
    if (problem === 'kind') record.kind = 'buy'
    if (problem === 'signature') record.signature = 'unexpected'
    if (problem === 'epoch') record.expirationEpoch = '01'
    if (problem === 'release-digest') record.release.soulidityCallableDigest = 'bad'
    if (problem === 'digest') record.digest = record.release.soulidityCallableDigest
    if (problem === 'trailing-bytes') { const bytes = new Uint8Array([...f.bytes,0]); record.bytes = toBase64(bytes); record.digest = TransactionDataBuilder.getDigestFromBytes(bytes) }
    expect(() => validateMarketCancelOperationRecord(record)).toThrow()
  })
it.each(['function','package','extra-command','shared-cap','owned-state','immutable-kiosk','input-swap','gas-owner','gas-overlap','expiration'])
  ('rejects valid BCS with unsafe %s', async problem => {
    const f = await fixture(); const data = f.tx.getData() as any
    if (problem === 'function') data.commands[0].MoveCall.function = 'buy_animacraft_v8_soul'
    if (problem === 'package') data.commands[0].MoveCall.package = cid(999)
    if (problem === 'extra-command') data.commands.push(structuredClone(data.commands[0]))
    if (problem === 'shared-cap') data.inputs[1] = { Object: { SharedObject: { objectId: f.record.kioskCapId, initialSharedVersion: '1', mutable: true } } }
    if (problem === 'owned-state') data.inputs[2] = { Object: { ImmOrOwnedObject: { objectId: f.record.stateId, version: '1', digest: f.record.digest } } }
    if (problem === 'immutable-kiosk') data.inputs[0].Object.SharedObject.mutable = false
    if (problem === 'input-swap') data.commands[0].MoveCall.arguments[2].Input = 0
    if (problem === 'gas-owner') data.gasData.owner = cid(999)
    if (problem === 'gas-overlap') data.gasData.payment[0].objectId = f.record.kioskCapId
    if (problem === 'expiration') data.expiration = { None: true }
    const bytes = await Transaction.from(JSON.stringify(data)).build()
    expect(() => validateMarketCancelOperationRecord({ ...f.record, bytes: toBase64(bytes), digest: TransactionDataBuilder.getDigestFromBytes(bytes) })).toThrow()
  })
it('scopes storage to exact canonical Soul and owner and never falls back without Web Locks', () => {
  expect(marketCancelOperationKey(cid(1),cid(2))).toContain(`${cid(1)}:${cid(2)}`)
  expect(() => marketCancelOperationKey('0x1',cid(2))).toThrow()
  vi.stubGlobal('window', {localStorage:{}}); vi.stubGlobal('navigator', {})
  expect(() => browserMarketCancelOperationStore()).toThrow('Web Locks')
})
it('browser journal persists, verifies writes, propagates quota and denies held Web Locks', async () => {
  const f = await fixture(); const values = new Map<string,string>()
  const storage = { get length(){return values.size}, key:(index:number)=>[...values.keys()][index]??null,
    getItem: vi.fn((key:string) => values.get(key) ?? null), setItem: vi.fn((key:string,value:string) => {values.set(key,value)}) }
  const request = vi.fn(async (_key:string,_options:unknown,work:(lock:object|null)=>Promise<unknown>) => work({}))
  vi.stubGlobal('window',{localStorage:storage}); vi.stubGlobal('navigator',{locks:{request}})
  const store = browserMarketCancelOperationStore(); const key = marketCancelOperationKey(f.record.soulId,f.record.owner)
  store.write(key,f.record); expect(store.read(key)).toEqual(f.record)
  await store.exclusive(key, async () => 'ok'); expect(request.mock.calls[0][1]).toEqual({mode:'exclusive',ifAvailable:true})
  request.mockImplementationOnce(async (_k,_o,work) => work(null))
  await expect(store.exclusive(key,async () => 'bad')).rejects.toThrow('another tab')
  storage.setItem.mockImplementationOnce(() => {throw new Error('quota')})
  expect(() => store.write(key,f.record)).toThrow('quota')
  storage.getItem.mockReturnValueOnce(null)
  expect(() => store.write(key,f.record)).toThrow('could not be persisted')
  values.set(key,'{broken'); expect(() => store.read(key)).toThrow()
})
it.each(['SIGNING','SIGNED'] as const)('retires missing %s only after later executed checkpoint, archiving the complete packet before active state', async phase => {
  const f=await fixture(); const signed=await cancelSigner.signTransaction(f.bytes)
  const previous={...f.record,phase,signature:phase==='SIGNED'?signed.signature:null}
  f.setSaved(previous)
  const retired=await runMarketCancelOperation({...f.params,retireExpired:true})
  expect(retired).toMatchObject({...previous,phase:'RETIRED',retirement:{priorPhase:phase,checkpoint:marketCancelCheckpointFixture().evidence}})
  expect(f.events).toEqual(['query','checkpoint','archive','save:RETIRED:'])
  expect(f.archive.get(retired.digest)).toEqual(retired)
  expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
  expect(terminalMarketCancelOperation(retired)).toBe(true)
  expect(await runMarketCancelOperation(f.params)).toEqual(retired)
  expect(f.adapter.preflight).not.toHaveBeenCalled()
})
it.each(['PENDING','SUCCEEDED','FAILED'] as const)('does not retire %s or request checkpoint evidence', async status => {
  const f=await fixture(); f.setSaved({...f.record,phase:'SIGNING'}); f.adapter.query.mockResolvedValue(status)
  const result=await runMarketCancelOperation({...f.params,retireExpired:true})
  expect(result.phase).toBe(status==='PENDING'?'SIGNING':status)
  expect(f.adapter.expiryCheckpoint).not.toHaveBeenCalled(); expect(f.store.archive).not.toHaveBeenCalled()
})
it.each(['query','checkpoint','equal-epoch','earlier-epoch','bad-hash','archive','readback','active-write'])
  ('retirement %s failure retains unknown active packet without prompting', async failure => {
    const f=await fixture(); const previous={...f.record,phase:'SIGNING' as const}; f.setSaved(previous)
    if(failure==='query') f.adapter.query.mockRejectedValue(new Error('network'))
    if(failure==='checkpoint') f.adapter.expiryCheckpoint.mockRejectedValue(new Error('timeout'))
    if(failure==='equal-epoch'||failure==='earlier-epoch') f.adapter.expiryCheckpoint.mockResolvedValue(marketCancelCheckpointFixture(failure==='equal-epoch'?'10':'9').evidence)
    if(failure==='bad-hash') f.adapter.expiryCheckpoint.mockResolvedValue({...marketCancelCheckpointFixture().evidence,digest:f.record.digest})
    if(failure==='archive') vi.mocked(f.store.archive).mockImplementation(()=>{throw new Error('quota')})
    if(failure==='readback') vi.mocked(f.store.history).mockReturnValue([])
    if(failure==='active-write') vi.mocked(f.store.write).mockImplementation(()=>{throw new Error('quota')})
    await expect(runMarketCancelOperation({...f.params,retireExpired:true})).rejects.toThrow()
    expect(f.saved()).toEqual(previous); expect(f.adapter.sign).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
    expect(f.archive.size).toBe(['readback','active-write'].includes(failure)?1:0)
  })
it('restarts after archive succeeded/active failed, retaining original immutable checkpoint despite a newer checkpoint', async () => {
  const f=await fixture(); f.setSaved({...f.record,phase:'SIGNING'})
  const write=f.store.write
  f.store.write=()=>{throw new Error('quota')}
  await expect(runMarketCancelOperation({...f.params,retireExpired:true})).rejects.toThrow('quota')
  const archived=structuredClone(f.archive.get(f.record.digest))
  f.store.write=write; f.adapter.expiryCheckpoint.mockResolvedValue(marketCancelCheckpointFixture('12','200').evidence)
  const retired=await runMarketCancelOperation({...f.params,retireExpired:true})
  expect(retired).toEqual(archived); expect(f.archive.get(f.record.digest)).toEqual(archived)
})
it.each([false,true])('restores archive after pointer failure before ordinary resume/query-only=%s can sign or rebroadcast', async queryOnly => {
  const f=await fixture();const signature=(await cancelSigner.signTransaction(f.bytes)).signature
  f.setSaved({...f.record,phase:'SIGNED',signature})
  const write=f.store.write;f.store.write=()=>{throw new Error('quota')}
  await expect(runMarketCancelOperation({...f.params,retireExpired:true})).rejects.toThrow('quota')
  f.store.write=write;f.adapter.expiryCheckpoint.mockRejectedValue(new Error('lagging frontier'))
  const result=await runMarketCancelOperation({...f.params,queryOnly})
  expect(result).toEqual(f.archive.get(f.record.digest));expect(result.phase).toBe('RETIRED')
  expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.broadcast).not.toHaveBeenCalled();expect(f.adapter.preflight).not.toHaveBeenCalled()
  await expect(runMarketCancelOperation({...f.params,start:true})).rejects.toThrow('lagging frontier')
  expect(f.adapter.prepare).not.toHaveBeenCalled()
})
it.each(['query','pending','checkpoint','archive'] as const)('forged RETIRED marker cannot replace an active intent through %s failure', async failure => {
  const f=await fixture(); f.setSaved({...f.record,phase:'RETIRED',retirement:{priorPhase:'SIGNING',checkpoint:marketCancelCheckpointFixture().evidence}})
  if(failure==='query')f.adapter.query.mockRejectedValue(new Error('offline'))
  if(failure==='pending')f.adapter.query.mockResolvedValue('PENDING')
  if(failure==='checkpoint')f.adapter.expiryCheckpoint.mockResolvedValue(marketCancelCheckpointFixture('10').evidence)
  if(failure==='archive')vi.mocked(f.store.archive).mockImplementation(()=>{throw new Error('quota')})
  await expect(runMarketCancelOperation({...f.params,start:true})).rejects.toThrow()
  expect(f.adapter.prepare).not.toHaveBeenCalled(); expect(f.saved()?.phase).toBe('RETIRED')
})
it('revalidates missing retired intent and ensures archive before preparing a fresh operation', async () => {
  const f=await fixture(); f.setSaved({...f.record,phase:'RETIRED',retirement:{priorPhase:'SIGNING',checkpoint:marketCancelCheckpointFixture().evidence}})
  f.adapter.prepare.mockRejectedValue(new Error('fresh active listing required'))
  await expect(runMarketCancelOperation({...f.params,start:true})).rejects.toThrow('fresh active listing required')
  expect(f.events).toEqual(['query','checkpoint','archive']); expect(f.archive.size).toBe(1)
})
it('never prepares archived bytes again if lagging epoch/gas resolution reproduces the same digest', async () => {
  const f=await fixture();f.setSaved({...f.record,phase:'SIGNING'})
  const retired=await runMarketCancelOperation({...f.params,retireExpired:true})
  await expect(runMarketCancelOperation({...f.params,start:true})).rejects.toThrow('cannot be prepared')
  expect(f.saved()).toEqual(retired);expect(f.adapter.sign).not.toHaveBeenCalled();expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it('later archived success is a read-only observation isolated from a new active intent', async () => {
  const f=await fixture(); f.setSaved({...f.record,phase:'SIGNING'})
  const retired=await runMarketCancelOperation({...f.params,retireExpired:true})
  const data=f.tx.getData(); data.inputs[3].Object!.SharedObject!.objectId=cid(90)
  const bytes=await Transaction.from(JSON.stringify(data)).build()
  const next={...f.record,listingId:cid(90),bytes:toBase64(bytes),digest:TransactionDataBuilder.getDigestFromBytes(bytes)}
  f.adapter.prepare.mockResolvedValue(next); f.adapter.sign.mockRejectedValue(new Error('wallet unknown'))
  await expect(runMarketCancelOperation({...f.params,start:true})).rejects.toThrow('wallet unknown')
  const active=f.saved(); const writes=vi.mocked(f.store.write).mock.calls.length
  f.adapter.query.mockResolvedValue('SUCCEEDED')
  expect(await queryMarketCancelHistory({...f.params,digest:retired.digest})).toBe('SUCCEEDED')
  expect(f.archive.get(retired.digest)).toEqual(retired); expect(f.saved()).toEqual(active)
  expect(vi.mocked(f.store.write).mock.calls).toHaveLength(writes)
  expect(f.adapter.sync).not.toHaveBeenCalled(); expect(f.adapter.broadcast).not.toHaveBeenCalled()
})
it.each(['SUCCEEDED','FAILED'] as const)('preserves retirement/full packet when active retired transaction later resolves %s', async outcome => {
  const f=await fixture(); const signature=(await cancelSigner.signTransaction(f.bytes)).signature
  f.setSaved({...f.record,phase:'SIGNED',signature})
  const retired=await runMarketCancelOperation({...f.params,retireExpired:true})
  f.adapter.query.mockResolvedValue(outcome)
  const resolved=await runMarketCancelOperation({...f.params,queryOnly:true})
  expect(resolved).toMatchObject({phase:outcome,retirement:retired.retirement,signature,bytes:retired.bytes})
  expect(f.archive.get(retired.digest)).toEqual(retired)
})
it('history validates exact digest, owner, retirement packet and cannot mutate stored data', async () => {
  const f=await fixture(); f.setSaved({...f.record,phase:'SIGNING'})
  await runMarketCancelOperation({...f.params,retireExpired:true})
  await expect(queryMarketCancelHistory({...f.params,digest:f.record.release.soulidityCallableDigest})).rejects.toThrow('Exact')
  await expect(queryMarketCancelHistory({...f.params,owner:cid(999),digest:f.record.digest})).rejects.toThrow('scope')
  f.adapter.query.mockImplementation(async value=>{value.bytes='wrong';return 'MISSING'})
  expect(await queryMarketCancelHistory({...f.params,digest:f.record.digest})).toBe('MISSING')
  expect(f.archive.get(f.record.digest)?.bytes).toBe(f.record.bytes)
})
it('disallows retirement of unsigned records and all conflicting actions', async () => {
  const f=await fixture(); f.setSaved(f.record)
  await expect(runMarketCancelOperation({...f.params,retireExpired:true})).rejects.toThrow('Only an unknown')
  for(const action of ['start','queryOnly','cancelUnsigned'] as const)
    await expect(runMarketCancelOperation({...f.params,retireExpired:true,[action]:true})).rejects.toThrow('mutually exclusive')
  expect(f.adapter.expiryCheckpoint).not.toHaveBeenCalled()
})
it('browser retired archives are immutable per digest, independent of the active pointer and visible after restart', async () => {
  const f=await fixture(); const values=new Map<string,string>()
  const storage={get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,
    setItem:vi.fn((key:string,value:string)=>{values.set(key,value)})}
  vi.stubGlobal('window',{localStorage:storage});vi.stubGlobal('navigator',{locks:{request:vi.fn()}})
  const key=marketCancelOperationKey(f.record.soulId,f.record.owner)
  const retired=validateMarketCancelOperationRecord({...f.record,phase:'RETIRED',retirement:{priorPhase:'SIGNING',checkpoint:marketCancelCheckpointFixture().evidence}})
  const store=browserMarketCancelOperationStore();store.archive(key,retired);store.archive(key,structuredClone(retired))
  expect(storage.setItem).toHaveBeenCalledTimes(1)
  expect(()=>store.archive(key,{...retired,ownershipEpoch:'99'})).toThrow('immutable')
  store.write(key,f.record)
  expect(browserMarketCancelOperationStore().history(key)).toEqual([retired])
  expect(store.read(key)).toEqual(f.record)
  const archivedKey=`${key}:retired:${retired.digest}`
  values.set(archivedKey,JSON.stringify({...retired,digest:f.record.release.soulidityCallableDigest}))
  expect(()=>store.history(key)).toThrow()
})
