import { bcs } from '@mysten/sui/bcs'
import { toBase64 } from '@mysten/sui/utils'
import { expect, it } from 'vitest'
import { activityHash, aid, adigest } from './fixtures/activity-transaction-evidence'
import { nativeSaleCancellationFixture as fixture } from './fixtures/commerce-sale-cancellation'
import { buildNativeSaleCancellation, NativeExclusiveListingFieldBcs, readNativeSaleCancellationByDigest, readNativeSaleCancellationHistory } from '../../web/lib/soulidity/commerce/native-sale-cancellation'

it('builds cancellation without adding Config, fee, currency or pause gates', async () => {
  const { intent } = await fixture(), data = buildNativeSaleCancellation({ ...intent, callablePackageId: aid(43) }).getData()
  expect(data.commands.length).toBe(1); expect(data.commands[0].MoveCall?.function).toBe('cancel')
  expect(data.inputs.length).toBe(3)
})
it('proves the original cancellation transition without declaring an unlocked Soul', async () => {
  const { params } = await fixture()
  expect(await readNativeSaleCancellationHistory(params)).toMatchObject({ status: 'CANCELLATION_CONFIRMED',
    receipt: { sourceAssertsSoulStillLocked: true, notIndependentUntouchedLockProof: true, effectsReconciliation: 'exact-cancel-objects-and-gas' } })
})
it.each(['extra-object', 'account-write', 'soul-write', 'cap-missing', 'cap-wrapped', 'duplicate', 'readonly-shared'])('rejects unexplained or incorrect %s effects even with a valid cancel event', async variant => {
  const { f, params, intent } = await fixture(), e = f.effectsData.V2!
  const extra = () => structuredClone(e.changedObjects[1])
  if (variant === 'extra-object') { const row = extra(); row[0] = aid(99); e.changedObjects.push(row) }
  if (variant === 'account-write') { const row = extra(); row[0] = intent.accountId; e.changedObjects.push(row) }
  if (variant === 'soul-write') { const row = extra(); row[0] = intent.soulId; e.changedObjects.push(row) }
  if (variant === 'cap-missing') e.changedObjects = e.changedObjects.filter(([id]) => id !== aid(75))
  if (variant === 'cap-wrapped') e.changedObjects.find(([id]) => id === aid(75))![1].idOperation = { $kind: 'None', None: true }
  if (variant === 'duplicate') e.changedObjects.push(extra())
  if (variant === 'readonly-shared') e.unchangedConsensusObjects.push([aid(99), { $kind: 'ReadOnlyRoot', ReadOnlyRoot: ['9', adigest(99)] }])
  f.rehashEffects()
  await expect(readNativeSaleCancellationHistory(params)).rejects.toThrow()
})
it.each(['account-digest', 'listing-missing', 'receipt', 'extra-call'] as const)('refuses %s contradictory cancellation evidence', async variant => {
  const { f, params, rows, listingId, intent } = await fixture()
  if (variant === 'account-digest') rows.get(`${intent.accountId}:9`).digest = adigest(99)
  if (variant === 'listing-missing') { f.effectsData.V2!.changedObjects = f.effectsData.V2!.changedObjects.filter(([id]) => id !== listingId); f.effectsData.V2!.gasObjectIndex = 2; f.rehashEffects() }
  if (variant === 'receipt') { f.eventsData.data[0].sender = aid(99); f.rehashEvents() }
  if (variant === 'extra-call') { f.transactionData.V1.kind.ProgrammableTransaction!.commands.push(f.transactionData.V1.kind.ProgrammableTransaction!.commands[0]); f.rehashTransaction()
    params.packet.bytes = toBase64(f.ledger.transaction.bcs.value); params.packet.digest = f.ledger.digest }
  await expect(readNativeSaleCancellationHistory(params)).rejects.toThrow()
})
it.each(['method','service'])('captures cancel history RPC before async %s replacement',async variant=>{
 const {params}=await fixture(),ledger=params.client.ledgerService,info=ledger.getServiceInfo.bind(ledger)
 ledger.getServiceInfo=async(...args:any[])=>{await Promise.resolve()
  if(variant==='method')ledger.getObject=()=>{throw Error('REPLACED_CANCEL_READER')}
  else params.client.ledgerService={...ledger,getObject:()=>{throw Error('REPLACED_CANCEL_SERVICE')}}
  return info(...args)
 }
 expect(await readNativeSaleCancellationHistory(params)).toMatchObject({status:'CANCELLATION_CONFIRMED',receipt:{notCurrentAuthority:true}})
})
async function relistedFixture(){
 const x=await fixture(),source=x.params.client.ledgerService,read=source.getObject.bind(source),raw=bcs.Object.parse(x.rows.get(`${x.listingId}:9`).bcs.value)
 raw.data.Move!.version='20';raw.previousTransaction=adigest(200)
 const field=NativeExclusiveListingFieldBcs.parse(raw.data.Move!.contents);field.value='999';raw.data.Move!.contents=NativeExclusiveListingFieldBcs.serialize(field).toBytes()
 const bytes=bcs.Object.serialize(raw).toBytes(),current={objectId:x.listingId,version:20n,digest:activityHash('Object',bytes),bcs:{value:bytes}},latestBusinessReads:string[]=[]
 source.getObject=async(r:any)=>{if(r.version===undefined&&[x.listingId,x.intent.offerId,x.intent.accountId,x.intent.kioskId].includes(r.objectId)){latestBusinessReads.push(r.objectId);return {response:{object:current}}}return read(r)}
 return {...x,current,latestBusinessReads}
}
it('confirms original cancellation despite a later same-Kiosk listing field, without claiming current absence or repeat-cancel authority',async()=>{
 const x=await relistedFixture();expect(bcs.Object.parse(x.current.bcs.value).data.Move!.version).toBe('20')
 expect(await readNativeSaleCancellationHistory(x.params)).toMatchObject({status:'CANCELLATION_CONFIRMED',receipt:{notCurrentListingAbsenceProof:true,notPermissionToRetryCancellation:true,notCurrentAuthority:true,effectsReconciliation:'exact-cancel-objects-and-gas'}})
 expect(x.latestBusinessReads).toEqual([])
})
it.each(['offer','listing','account'])('does not substitute the current listing for missing original %s evidence',async role=>{
 const x=await relistedFixture(),id=role==='offer'?x.intent.offerId:role==='listing'?x.listingId:x.intent.accountId
 x.rows.delete(`${id}:9`)
 await expect(readNativeSaleCancellationHistory(x.params)).rejects.toThrow();expect(x.latestBusinessReads).toEqual([])
})

it('recovers the same bytes and full original cancellation proof from the digest after a relist', async () => {
 const x = await relistedFixture()
 const result = await readNativeSaleCancellationByDigest({ ...x.params, digest: x.params.packet.digest, soulId: x.intent.soulId })
 expect(result).toMatchObject({ status: 'CANCELLATION_CONFIRMED', checkpoint: '100',
  receipt: { receipt: { root: x.intent.soulId, offer: x.intent.offerId }, gas: { netGasCharge: '3' } } })
 expect(x.f.client.ledgerService.getTransaction.mock.calls.map(([r]) => r)).toEqual([
  expect.objectContaining({ digest: x.params.packet.digest }), expect.objectContaining({ digest: x.params.packet.digest }),
 ])
 expect(x.latestBusinessReads).toEqual([])
})
it.each(['soul', 'package', 'raw', 'different chain'])('rejects mismatched original %s through digest recovery', async variant => {
 const x = await fixture()
 if (variant === 'package') x.params.native.callablePackageId = aid(99)
 if (variant === 'raw') x.f.ledger.transaction.bcs.value = new Uint8Array([1, 2, 3])
 if (variant === 'different chain') x.f.client.ledgerService.getServiceInfo.mockResolvedValue({ response: { chainId: adigest(99) } })
 await expect(readNativeSaleCancellationByDigest({ ...x.params, digest: x.params.packet.digest,
  soulId: variant === 'soul' ? aid(99) : x.intent.soulId })).rejects.toThrow()
 if (variant === 'different chain') expect(x.f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})
it.each(['MISSING', 'PENDING', 'FAILED'] as const)('returns %s without treating it as a verified cancellation', async status => {
 const x = await fixture(), reader = x.f.client.ledgerService
 if (status === 'MISSING') reader.getTransaction.mockRejectedValue({ code: 'NOT_FOUND' })
 if (status === 'PENDING') reader.getTransaction.mockResolvedValue({ response: { transaction: { ...x.f.ledger, checkpoint: undefined } } })
 if (status === 'FAILED') {
  const failure = bcs.TransactionEffects.parse(bcs.TransactionEffects.serialize({ V2: {
   ...x.f.effectsData.V2!, status: { Failure: { error: { InsufficientGas: true }, command: null } },
  } }).toBytes()).V2!
  x.f.effectsData.V2!.status = failure.status
  x.f.rehashEffects()
 }
 await expect(readNativeSaleCancellationByDigest({ ...x.params, digest: x.params.packet.digest, soulId: x.intent.soulId })).resolves.toMatchObject({ status })
 expect(reader.getObject).not.toHaveBeenCalled()
})
