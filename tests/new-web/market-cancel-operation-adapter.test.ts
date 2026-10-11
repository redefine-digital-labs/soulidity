import { afterEach, expect, it, vi } from 'vitest'
import { bcs } from '@mysten/sui/bcs'
import { Inputs } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { createMarketCancelOperationAdapter } from '../../web/lib/animacraft/market-cancel-operation-adapter'
import { marketCancelFixture, marketCancelCheckpointFixture, cancelSigner, cid, cancelEventEvidence, cancelEventBcs } from './fixtures/market-cancel-operation'
import { runMarketCancelOperation, type MarketCancelOperationRecord } from '../../web/lib/animacraft/market-cancel-operation'
import { MAINNET_GENESIS_DIGEST } from '../../web/lib/animacraft/mainnet-chain'

async function fixture() {
  const { snapshot, record, tx } = await marketCancelFixture()
  const receipt = cancelEventEvidence(record)
  const checkpoint=marketCancelCheckpointFixture()
  let address: string | null = record.owner
  function effects(success = true, digest = record.digest) {
    return bcs.TransactionEffects.serialize({ V2: {
      status: success ? { Success: true } : { Failure: { error: { InsufficientGas: true }, command: 0 } },
      executedEpoch: '9', gasUsed: { computationCost: '1', storageCost: '0', storageRebate: '0', nonRefundableStorageFee: '0' },
      transactionDigest: digest, gasObjectIndex: null, eventsDigest: success ? receipt.digest : null, dependencies: [], lamportVersion: '3',
      changedObjects: [], unchangedConsensusObjects: [], auxDataDigest: null,
    } }).toBytes()
  }
  const ledger = { digest: record.digest, transaction: { digest: record.digest, bcs: { value: fromBase64(record.bytes) } },
    effects: { transactionDigest: record.digest, bcs: { value: effects() }, status: { success: true } }, events: receipt, checkpoint: 0n as bigint | undefined }
  const pkg = { objectId: record.release.soulidityCallablePackageId, digest: record.release.soulidityCallableDigest, version: 2n, owner: {kind:4},
    package: { storageId: record.release.soulidityCallablePackageId, originalId: cid(4), version: 2n,
      typeOrigins: [{moduleName:'market',datatypeName:'SoulListingCancelled',packageId:cid(4)}] } }
  const client = {
    ledgerService: {
      getServiceInfo: vi.fn(async () => ({ response: { chainId: MAINNET_GENESIS_DIGEST } })),
      getEpoch: vi.fn(async () => ({ response: { epoch: { epoch: 9n } } })),
      getTransaction: vi.fn(async () => ({ response: { transaction: ledger } })),
      getObject: vi.fn(async () => ({response:{object:pkg}})),
      getCheckpoint: vi.fn(async () => ({response:{checkpoint:checkpoint.checkpoint}})),
    },
    core: {
      executeTransaction: vi.fn(async () => ({})),
      // Actual SDK builder, deterministic object/gas resolver; not live RPC acceptance.
      resolveTransactionPlugin: () => async (data: any, _options: any, next: () => Promise<void>) => {
        data.inputs = data.inputs.map((input: any) => {
          if (!input.UnresolvedObject) return input
          const objectId = input.UnresolvedObject.objectId
          return objectId === record.kioskCapId ? Inputs.ObjectRef({ objectId, version: '2', digest: record.release.soulidityCallableDigest })
            : Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: true })
        })
        data.gasData = tx.getData().gasData; await next()
      },
    },
  }
  const read = vi.fn(async (_listingId?: string, _capId?: string) => snapshot)
  const sign = vi.fn(async () => cancelSigner.signTransaction(fromBase64(record.bytes)))
  const sync = vi.fn(async () => 'COMPLETE' as const)
  const observed = structuredClone(snapshot)
  const params = { client: client as any, read, observed, getAddress: () => address, sign, sync }
  const adapter = createMarketCancelOperationAdapter(params)
  return { adapter, client, snapshot, record, ledger, effects, receipt, pkg, checkpoint, read, sign, sync, observed, params,
    setAddress: (value: string | null) => { address = value } }
}
afterEach(() => vi.useRealTimers())
it.each(['35834a8a','4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6T'])('rejects non-mainnet full gRPC genesis identity %s', async chainId => {
  const f=await fixture();f.client.ledgerService.getServiceInfo.mockResolvedValue({response:{chainId}})
  await expect(f.adapter.prepare()).rejects.toThrow('Mainnet')
  await expect(f.adapter.query(f.record)).rejects.toThrow('Mainnet')
  await expect(f.adapter.expiryCheckpoint(f.record)).rejects.toThrow('Mainnet')
  expect(f.client.ledgerService.getCheckpoint).not.toHaveBeenCalled();expect(f.sign).not.toHaveBeenCalled()
})
it('prepares exact four-Input native SDK cancellation without fee/Root/payment input', async () => {
  const f = await fixture(); const prepared = await f.adapter.prepare()
  expect(prepared.bytes).toBe(f.record.bytes); expect(prepared.digest).toBe(f.record.digest)
  expect(prepared.phase).toBe('PREPARED'); expect(f.sign).not.toHaveBeenCalled()
  await f.adapter.preflight(prepared,true); await f.adapter.preflight(prepared,false)
  expect(f.read.mock.calls).toEqual(Array(3).fill([f.record.listingId,f.record.kioskCapId]))
})
it.each(['writes','wallet','owner','epoch','listing','cap','kiosk','binding','state','soul','release','protocol','digest','listed','inactive','network'])
  ('rejects changed %s before prepare and both preflight modes', async problem => {
    const f = await fixture()
    if (problem === 'writes') f.snapshot.release.writesEnabled = false
    if (problem === 'wallet') f.setAddress(cid(999))
    if (problem === 'owner') f.snapshot.owner = cid(999)
    if (problem === 'epoch') f.snapshot.ownershipEpoch = '4'
    if (problem === 'listing') f.snapshot.listingId = cid(999)
    if (problem === 'cap') f.snapshot.kioskCapId = cid(999)
    if (problem === 'kiosk') f.snapshot.kioskId = cid(999)
    if (problem === 'binding') f.snapshot.bindingId = cid(999)
    if (problem === 'state') f.snapshot.stateId = cid(999)
    if (problem === 'soul') f.snapshot.soulId = cid(999)
    if (problem === 'release') f.snapshot.release.soulidityCallablePackageId = cid(999)
    if (problem === 'protocol') f.snapshot.release.protocolConfigId = cid(999)
    if (problem === 'digest') f.snapshot.release.soulidityCallableDigest = f.record.digest
    if (problem === 'listed') f.snapshot.listed = false
    if (problem === 'inactive') f.snapshot.listingActive = false
    if (problem === 'network') f.client.ledgerService.getServiceInfo.mockResolvedValue({ response: { chainId: 'testnet' } })
    await expect(f.adapter.prepare()).rejects.toThrow()
    await expect(f.adapter.preflight(f.record,true)).rejects.toThrow()
    await expect(f.adapter.preflight(f.record,false)).rejects.toThrow()
    expect(f.sign).not.toHaveBeenCalled(); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  })
it('requires an observed identity and copies caller snapshots before awaits', async () => {
  const f = await fixture()
  await expect(createMarketCancelOperationAdapter({ ...f.params, observed: undefined }).prepare()).rejects.toThrow('Refresh')
  f.observed.listingId = cid(999)
  expect((await f.adapter.prepare()).listingId).toBe(f.record.listingId)
  f.client.ledgerService.getEpoch.mockImplementation(async () => {
    f.snapshot.listingId = cid(888); f.snapshot.release.soulidityCallablePackageId = cid(888)
    return { response: { epoch: { epoch: 9n } } }
  })
  expect((await f.adapter.prepare()).bytes).toBe(f.record.bytes)
})
it('checks wallet after asynchronous preparation and preflight', async () => {
  const f = await fixture()
  f.client.ledgerService.getEpoch.mockImplementation(async () => { f.setAddress(null); return { response: { epoch: { epoch: 9n } } } })
  await expect(f.adapter.prepare()).rejects.toThrow('Wallet changed')
  f.setAddress(f.record.owner); await expect(f.adapter.preflight(f.record,false)).rejects.toThrow('Wallet changed')
})
it('reads canonical finalized success/failure and checkpoint zero, without read or wallet/write gate', async () => {
  const f = await fixture(); f.setAddress(null); f.snapshot.release.writesEnabled = false
  f.read.mockRejectedValue(new Error('read service unavailable'))
  expect(await f.adapter.query(f.record)).toBe('SUCCEEDED')
  const succeeded = { ...f.record, phase: 'SUCCEEDED' as const, syncStatus: 'PENDING' as const }
  expect(await f.adapter.sync(succeeded)).toBe('COMPLETE'); expect(f.read).not.toHaveBeenCalled()
  f.ledger.effects.bcs.value = f.effects(false); f.ledger.effects.status.success = false
  expect(await f.adapter.query(f.record)).toBe('FAILED')
  f.ledger.checkpoint = undefined; expect(await f.adapter.query(f.record)).toBe('PENDING')
})
it.each(['outer-digest','digest','bytes','effects-field','effects-digest','effects-status','trailing-effects','checkpoint'])
  ('rejects inconsistent ledger %s', async problem => {
    const f = await fixture()
    if (problem === 'outer-digest') f.ledger.digest = 'wrong'
    if (problem === 'digest') f.ledger.transaction.digest = 'wrong'
    if (problem === 'bytes') f.ledger.transaction.bcs.value = new Uint8Array([1])
    if (problem === 'effects-field') f.ledger.effects.transactionDigest = 'wrong'
    if (problem === 'effects-digest') f.ledger.effects.bcs.value = f.effects(true,f.record.release.soulidityCallableDigest)
    if (problem === 'effects-status') f.ledger.effects.status.success = false
    if (problem === 'trailing-effects') f.ledger.effects.bcs.value = new Uint8Array([...f.effects(),0])
    if (problem === 'checkpoint') f.ledger.checkpoint = -1n
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
it('treats only exact NOT_FOUND as missing; expiry never prevents querying a saved transaction', async () => {
  const f = await fixture()
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({ code: 'NOT_FOUND' })
  expect(await f.adapter.query(f.record)).toBe('MISSING')
  for (const error of [{ code: 'UNAVAILABLE' },new Error('NOT_FOUND')]) {
    f.client.ledgerService.getTransaction.mockRejectedValueOnce(error)
    await expect(f.adapter.query(f.record)).rejects.toEqual(error)
  }
  f.client.ledgerService.getEpoch.mockResolvedValue({ response: { epoch: { epoch: 11n } } })
  await expect(f.adapter.preflight(f.record,false)).rejects.toThrow('expired')
  expect(await f.adapter.query(f.record)).toBe('SUCCEEDED')
})
it('verifies actual signatures and broadcasts exactly saved bytes and signature', async () => {
  const f = await fixture(); const signed = await f.adapter.sign(f.record)
  const record = { ...f.record, phase: 'SIGNED' as const, signature: signed.signature }
  await f.adapter.verifySignature(record); await f.adapter.broadcast(record)
  expect(f.client.core.executeTransaction).toHaveBeenCalledWith({ transaction: fromBase64(record.bytes), signatures: [record.signature], signal: expect.any(AbortSignal) })
  await expect(f.adapter.verifySignature({ ...record, signature: 'wrong' })).rejects.toThrow()
  f.setAddress(null); await expect(f.adapter.sign(f.record)).rejects.toThrow('Wallet changed')
  await expect(f.adapter.broadcast(record)).rejects.toThrow('Wallet changed')
})
it('copies saved records before an asynchronous query and sync callback', async () => {
  const f = await fixture(); const copy = structuredClone(f.record)
  f.client.ledgerService.getServiceInfo.mockImplementation(async () => {
    copy.bytes = 'corrupted'; return { response: { chainId: MAINNET_GENESIS_DIGEST } }
  })
  expect(await f.adapter.query(copy)).toBe('SUCCEEDED')
  const terminal = { ...f.record, phase: 'SUCCEEDED' as const, syncStatus: 'PENDING' as const }
  f.sync.mockImplementation(async (...args: any[]) => { args[0].owner = cid(999); return 'COMPLETE' })
  await f.adapter.sync(terminal); expect(terminal.owner).toBe(f.record.owner)
})
it.each(['package-id','package-digest','package-owner','storage-id','version','type-origin','duplicate-origin','missing-event','duplicate-event',
  'event-package','event-module','event-sender','event-type','event-contents','event-soul','event-listing','event-seller','event-digest'])
  ('rejects unauthenticated successful cancellation %s', async problem => {
    const f = await fixture()
    if (problem === 'package-id') f.pkg.objectId = cid(999)
    if (problem === 'package-digest') f.pkg.digest = f.record.digest
    if (problem === 'package-owner') f.pkg.owner.kind = 1
    if (problem === 'storage-id') f.pkg.package.storageId = cid(999)
    if (problem === 'version') f.pkg.package.version = 3n
    if (problem === 'type-origin') f.pkg.package.typeOrigins[0].packageId = cid(999)
    if (problem === 'duplicate-origin') f.pkg.package.typeOrigins.push(f.pkg.package.typeOrigins[0])
    if (problem.startsWith('event-') || problem.endsWith('-event')) {
      const events = cancelEventEvidence(f.record, data => {
        const event = data.data[0]
        if (problem === 'missing-event') data.data = []
        if (problem === 'duplicate-event') data.data.push(structuredClone(event))
        if (problem === 'event-package') event.package_id = cid(999)
        if (problem === 'event-module') event.transaction_module = 'other'
        if (problem === 'event-sender') event.sender = cid(999)
        if (problem === 'event-type') event.type_.address = cid(999)
        if (problem === 'event-contents') event.contents.push(0)
        if (['event-soul','event-listing','event-seller'].includes(problem)) event.contents = Array.from(cancelEventBcs.serialize({
          listing_id: problem === 'event-listing' ? cid(999) : f.record.listingId,
          soul_id: problem === 'event-soul' ? cid(999) : f.record.soulId,
          seller: problem === 'event-seller' ? cid(999) : f.record.owner,
        }).toBytes())
      })
      Object.assign(f.receipt, events); f.ledger.effects.bcs.value = f.effects()
      if (problem === 'event-digest') f.receipt.digest = f.record.digest
    }
    await expect(f.adapter.query(f.record)).rejects.toThrow()
  })
it('rejects forged saved success/COMPLETE whose Soul metadata is absent from the real four-Input transaction', async () => {
  const f = await fixture(); const forged = { ...f.record, soulId: cid(999), phase: 'SUCCEEDED' as const, syncStatus: 'COMPLETE' as const }
  await expect(f.adapter.query(forged)).rejects.toThrow('receipt identity')
  expect(f.read).not.toHaveBeenCalled(); expect(f.sync).not.toHaveBeenCalled()
})
it.each(['chain','query','package','read','epoch','build','sign','execute','sync'] as const)
  ('bounds never-settling %s, clears timers, and does not use a late response to broadcast', async operation => {
    const f = await fixture(); vi.useFakeTimers()
    let resolve!: (value:any) => void
    const pending = new Promise<any>(done => {resolve=done})
    let work: Promise<unknown>
    if (operation === 'chain') { f.client.ledgerService.getServiceInfo.mockReturnValue(pending); work=f.adapter.query(f.record) }
    else if (operation === 'query') { f.client.ledgerService.getTransaction.mockReturnValue(pending); work=f.adapter.query(f.record) }
    else if (operation === 'package') { f.client.ledgerService.getObject.mockReturnValue(pending); work=f.adapter.query(f.record) }
    else if (operation === 'read') { f.read.mockReturnValue(pending); work=f.adapter.prepare() }
    else if (operation === 'epoch') { f.client.ledgerService.getEpoch.mockReturnValue(pending); work=f.adapter.prepare() }
    else if (operation === 'build') { f.client.core.resolveTransactionPlugin = () => async () => pending; work=f.adapter.prepare() }
    else if (operation === 'sign') { f.sign.mockReturnValue(pending); work=f.adapter.sign(f.record) }
    else if (operation === 'execute') {
      f.client.core.executeTransaction.mockReturnValue(pending)
      const signed = await cancelSigner.signTransaction(fromBase64(f.record.bytes))
      work=f.adapter.broadcast({...f.record,phase:'SIGNED',signature:signed.signature})
    } else { f.sync.mockReturnValue(pending); work=f.adapter.sync({...f.record,phase:'SUCCEEDED',syncStatus:'PENDING'}) }
    const assertion = expect(work).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(operation === 'sign' ? 120_001 : 25_001); await assertion
    expect(vi.getTimerCount()).toBe(0)
    resolve({response:{chainId:MAINNET_GENESIS_DIGEST}}); await vi.advanceTimersByTimeAsync(0)
    expect(f.client.core.executeTransaction).toHaveBeenCalledTimes(operation === 'execute' ? 1 : 0)
  })
it('wallet timeout releases durable lock, retains SIGNING, and drops a late valid signature', async () => {
  const f = await fixture(); let saved: MarketCancelOperationRecord | null = null; let locked = false
  let resolve!: (value:any) => void
  f.sign.mockReturnValue(new Promise(done => {resolve=done}))
  f.client.ledgerService.getTransaction.mockRejectedValue({code:'NOT_FOUND'})
  const store = { read: () => saved, write: (_key:string,value:MarketCancelOperationRecord) => {saved=structuredClone(value)},
    archive:vi.fn(),history:()=>[],
    async exclusive<T>(_key:string,work:()=>Promise<T>) { if(locked) throw new Error('locked'); locked=true; try{return await work()}finally{locked=false} } }
  vi.useFakeTimers()
  const work = runMarketCancelOperation({soulId:f.record.soulId,owner:f.record.owner,start:true,store,adapter:f.adapter})
  const assertion=expect(work).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(25_001)
  expect(locked).toBe(true); expect((saved as MarketCancelOperationRecord | null)?.phase).toBe('SIGNING')
  await vi.advanceTimersByTimeAsync(95_000); await assertion
  expect(locked).toBe(false); expect((saved as MarketCancelOperationRecord | null)?.phase).toBe('SIGNING')
  resolve(await cancelSigner.signTransaction(fromBase64(f.record.bytes)))
  await vi.advanceTimersByTimeAsync(0); expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it.each(['execute','sync'] as const)('%s timeout releases the lock and recovery queries finalized bytes without signing again', async operation => {
  const f = await fixture(); let saved: MarketCancelOperationRecord | null = null; let locked=false
  const store = { read:()=>saved, write:(_key:string,value:MarketCancelOperationRecord)=>{saved=structuredClone(value)},
    archive:vi.fn(),history:()=>[],
    async exclusive<T>(_key:string,work:()=>Promise<T>) { if(locked)throw new Error('locked'); locked=true; try{return await work()}finally{locked=false} } }
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({code:'NOT_FOUND'})
  if(operation==='execute') f.client.core.executeTransaction.mockReturnValueOnce(new Promise(()=>{}))
  else f.sync.mockReturnValueOnce(new Promise(()=>{}))
  vi.useFakeTimers()
  const params={soulId:f.record.soulId,owner:f.record.owner,store,adapter:f.adapter}
  const work=runMarketCancelOperation({...params,start:true})
  const assertion=expect(work).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(25_001); await assertion
  expect(locked).toBe(false)
  expect((saved as MarketCancelOperationRecord|null)?.phase).toBe(operation==='execute'?'SIGNED':'SUCCEEDED')
  const originalBytes=(saved as MarketCancelOperationRecord|null)?.bytes
  expect(await runMarketCancelOperation({...params,queryOnly:true})).toMatchObject({phase:'SUCCEEDED',syncStatus:'COMPLETE',bytes:originalBytes})
  expect(f.sign).toHaveBeenCalledTimes(1); expect(f.client.core.executeTransaction).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
it('uses Mainnet latest executed checkpoint BCS, not current epoch, wallet, write config or wall time', async () => {
  const f=await fixture();f.setAddress(null);f.snapshot.release.writesEnabled=false
  f.read.mockRejectedValue(new Error('unavailable'))
  f.client.ledgerService.getEpoch.mockRejectedValue(new Error('not finality'))
  expect(await f.adapter.expiryCheckpoint(f.record)).toEqual(f.checkpoint.evidence)
  expect(f.client.ledgerService.getCheckpoint).toHaveBeenCalledWith({checkpointId:{oneofKind:undefined},
    readMask:{paths:['sequence_number','digest','summary','signature']}},{abort:expect.any(AbortSignal),timeout:25000})
  expect(f.read).not.toHaveBeenCalled();expect(f.client.ledgerService.getEpoch).not.toHaveBeenCalled()
})
it.each(['network','equal','earlier','outer-digest','summary-digest','outer-sequence','summary-sequence','epoch','signature-epoch','signature-size','bitmap','bytes'])
  ('rejects latest checkpoint %s inconsistency', async problem => {
    const f=await fixture();const checkpoint=f.checkpoint.checkpoint
    if(problem==='network')f.client.ledgerService.getServiceInfo.mockResolvedValue({response:{chainId:'testnet'}})
    if(problem==='equal'||problem==='earlier')f.client.ledgerService.getCheckpoint.mockResolvedValue({response:{checkpoint:marketCancelCheckpointFixture(problem==='equal'?'10':'9').checkpoint}})
    if(problem==='outer-digest')checkpoint.digest=f.record.digest
    if(problem==='summary-digest')checkpoint.summary.digest=f.record.digest
    if(problem==='outer-sequence')checkpoint.sequenceNumber=101n
    if(problem==='summary-sequence'){checkpoint.sequenceNumber=101n;checkpoint.summary.sequenceNumber=101n}
    if(problem==='epoch'){checkpoint.summary.epoch=12n;checkpoint.signature.epoch=12n}
    if(problem==='signature-epoch')checkpoint.signature.epoch=12n
    if(problem==='signature-size')checkpoint.signature.signature=new Uint8Array(47)
    if(problem==='bitmap')checkpoint.signature.bitmap=new Uint8Array()
    if(problem==='bytes')checkpoint.summary.bcs.value=new Uint8Array([0])
    await expect(f.adapter.expiryCheckpoint(f.record)).rejects.toThrow()
  })
it('checkpoint timeout aborts transport and cannot unlock or mutate an unknown operation', async () => {
  const f=await fixture();vi.useFakeTimers()
  f.client.ledgerService.getCheckpoint.mockReturnValue(new Promise(()=>{}))
  const record={...f.record,phase:'SIGNING' as const};const previous=structuredClone(record)
  const work=f.adapter.expiryCheckpoint(record);const assertion=expect(work).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(25001);await assertion
  const options=(f.client.ledgerService.getCheckpoint.mock.calls as unknown as Array<[unknown,{abort:AbortSignal}]>)[0][1]
  expect(options.abort.aborted).toBe(true);expect(record).toEqual(previous);expect(vi.getTimerCount()).toBe(0)
})
it('retired records cannot sign, preflight or broadcast even through direct adapter methods', async () => {
  const f=await fixture();const signature=(await cancelSigner.signTransaction(fromBase64(f.record.bytes))).signature
  const retired={...f.record,phase:'RETIRED' as const,signature,retirement:{priorPhase:'SIGNED' as const,checkpoint:f.checkpoint.evidence}}
  await expect(f.adapter.sign(retired)).rejects.toThrow('cannot request')
  await expect(f.adapter.preflight(retired,false)).rejects.toThrow('Terminal')
  await expect(f.adapter.broadcast(retired)).rejects.toThrow('Only an active')
  expect(f.sign).not.toHaveBeenCalled();expect(f.client.core.executeTransaction).not.toHaveBeenCalled()
  expect(await f.adapter.query(retired)).toBe('SUCCEEDED')
})
