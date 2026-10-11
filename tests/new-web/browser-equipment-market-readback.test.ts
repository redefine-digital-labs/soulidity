import {expect,it} from 'vitest'
import {equipmentMarketReadbackFixture as fixture} from './fixtures/equipment-market-readback'
import {EquipmentBaseItemBcs,EquipmentLoadoutBcs} from '../../web/lib/animacraft/native-equipment'
import {EquipmentMarketListingBcs} from '../../web/lib/animacraft/native-equipment-market-bcs'
import {EquipmentMakerBcs} from '../../web/lib/animacraft/native-equipment-source-bcs'
import {equipmentOperationQuote} from '../../web/lib/animacraft/equipment-market-operation'
import {fromHex} from '@mysten/sui/utils'
import {bcs} from '@mysten/sui/bcs'
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`

for(const kind of ['base','external'] as const)for(const action of ['list','reprice','buy','cancel','recover'] as const){
  it(`confirms ${kind} ${action} using exact effects, historical objects and current authority`,async()=>{
    const f=await fixture(action,kind)
    expect(await f.confirm()).toBe('COMPLETE')
  })
}
it.each(['owner','digest','version','transaction','bcs','holder','epoch','commitment'])(
  'rejects altered historical asset %s despite valid current data',async reason=>{
    const f=await fixture('buy'),s=f.record.snapshot,raw=f.history.get(f.historyKey(s.asset.itemId,3n))
    if(reason==='owner')raw.owner.address=id(999)
    if(reason==='digest')raw.digest=f.digest(29)
    if(reason==='version')raw.version=4n
    if(reason==='transaction')raw.previousTransaction=f.digest(28)
    if(reason==='bcs')raw.contents.value=new Uint8Array([1])
    if(['holder','epoch','commitment'].includes(reason))f.edit(s.asset.itemId,EquipmentBaseItemBcs,v=>{
      if(reason==='holder')v.holder=s.seller;if(reason==='epoch')v.ownership_epoch='99';if(reason==='commitment')v.item_payload_commitment=Array(32).fill(29)
    },true)
    await expect(f.confirm()).rejects.toThrow()
  })
it.each(['owner','digest','version','transaction','missing','revision','status','asset','price','recipient','birth'])(
  'rejects altered historical listing %s',async reason=>{
    const f=await fixture('buy'),raw=f.history.get(f.historyKey(f.listingId,3n))
    if(reason==='owner')raw.owner.kind=1;if(reason==='digest')raw.digest=f.digest(29)
    if(reason==='version')raw.version=4n;if(reason==='transaction')raw.previousTransaction=f.digest(28)
    if(reason==='missing')f.history.delete(f.historyKey(f.listingId,3n));if(reason==='birth')raw.owner.version=2n
    if(['revision','status','asset','price','recipient'].includes(reason))f.edit(f.listingId,EquipmentMarketListingBcs,v=>{
      if(reason==='revision')v.revision='99';if(reason==='status')v.status=0;if(reason==='asset')v.custody.asset_id=id(999)
      if(reason==='price')v.gross_atomic='99';if(reason==='recipient')v.terminal_recipient=id(999)
    },true)
    await expect(f.confirm()).rejects.toThrow()
  })
it.each(['missing','duplicate','prior-owner','prior-version','prior-digest','output-owner','output-digest','id-operation'])(
  'rejects asset effects %s',async reason=>{
    const f=await fixture('buy'),row=f.effects.V2.changedObjects[1][1]
    if(reason==='missing')f.effects.V2.changedObjects.pop()
    if(reason==='duplicate')f.effects.V2.changedObjects.push(f.effects.V2.changedObjects[1])
    if(reason==='prior-owner')row.inputState.Exist[1].AddressOwner=id(999)
    if(reason==='prior-version')row.inputState.Exist[0][0]='1';if(reason==='prior-digest')row.inputState.Exist[0][1]=f.digest(29)
    if(reason==='output-owner')row.outputState.ObjectWrite[1].AddressOwner=id(999)
    if(reason==='output-digest')row.outputState.ObjectWrite[0]=f.digest(29)
    if(reason==='id-operation')row.idOperation={Created:true}
    f.refresh();await expect(f.confirm()).rejects.toThrow()
  })
it('requires list to create a new shared listing',async()=>{
  const f=await fixture();f.effects.V2.changedObjects[0][1].idOperation={None:true};f.refresh()
  await expect(f.confirm()).rejects.toThrow()
})
it('requires an existing listing birth to match the saved shared input',async()=>{
  const f=await fixture('cancel'),change=f.effects.V2.changedObjects[0][1]
  change.inputState.Exist[1].Shared.initialSharedVersion='2';change.outputState.ObjectWrite[1].Shared.initialSharedVersion='2';f.refresh()
  await expect(f.confirm()).rejects.toThrow()
})
it('marks a later authenticated reprice as superseded',async()=>{
  const f=await fixture(),q=equipmentOperationQuote(f.record.snapshot,'40001')
  f.laterListing(v=>{v.revision='1';v.gross_atomic=q.grossAtomic;v.protocol_atomic=q.protocolAtomic;v.seller_atomic=q.sellerAtomic;v.quote_commitment=[...fromHex(q.commitment)]})
  expect(await f.confirm()).toBe('SUPERSEDED')
})
it.each(['base','external'] as const)('marks later %s purchase after listing as superseded',async kind=>{
  const f=await fixture('list',kind)
  f.laterListing(v=>{v.revision='1';v.status=1;v.terminal_recipient=id(999)})
  f.laterHolder(id(999),'1')
  expect(await f.confirm()).toBe('SUPERSEDED')
})
it.each(['0','1'])('rejects a later settled listing with seller still holding at epoch %s',async epoch=>{
  const f=await fixture('list','external')
  f.laterListing(v=>{v.revision='1';v.status=1;v.terminal_recipient=id(999)})
  f.laterHolder(f.record.snapshot.seller,epoch)
  await expect(f.confirm()).rejects.toThrow()
})
it('allows a later buyer to transfer the instance back to seller with another epoch advance',async()=>{
  const f=await fixture('list','external')
  f.laterListing(v=>{v.revision='1';v.status=1;v.terminal_recipient=id(999)})
  f.laterHolder(f.record.snapshot.seller,'2')
  expect(await f.confirm()).toBe('SUPERSEDED')
})
it.each(['buy','cancel','recover'] as const)('marks later holder rotation after %s as superseded',async action=>{
  const f=await fixture(action,'external');f.laterHolder(id(999),action==='buy'?'2':'1')
  expect(await f.confirm()).toBe('SUPERSEDED')
})
it.each(['buy','cancel','recover'] as const)('rejects changes to terminal %s listing',async action=>{
  const f=await fixture(action,'external');f.laterListing(v=>{v.revision=String(BigInt(v.revision)+1n)})
  await expect(f.confirm()).rejects.toThrow('Terminal')
})
it('rejects later holder change without epoch rotation',async()=>{
  const f=await fixture('buy','external');f.laterHolder(id(999),'1')
  await expect(f.confirm()).rejects.toThrow()
})
it('rejects a changed asset at the same output version',async()=>{
  const f=await fixture('buy','external');f.laterHolder(id(999),'2');f.objects.get(f.record.snapshot.asset.itemId).version=3n
  await expect(f.confirm()).rejects.toThrow()
})
it('requires the buyer Base entitlement record, not only holder bytes',async()=>{
  const f=await fixture('buy');f.moveEntitlement(f.record.snapshot.seller,'0')
  await expect(f.confirm()).rejects.toThrow()
})
it.each(['cancel','recover'] as const)('reads paused %s with disabled local write switches',async action=>{
  const f=await fixture(action);f.edit(f.rootId,EquipmentMakerBcs,v=>{v.lifecycle=2})
  f.record.snapshot.release.marketWritesEnabled=false;f.record.snapshot.release.equipmentWritesEnabled=false
  expect(await f.confirm()).toBe('COMPLETE')
})
it('rejects RPC object drift and leaves the persisted synchronization pending',async()=>{
  const f=await fixture(),original=f.get.getMockImplementation()!,target=f.record.snapshot.asset.itemId
  let count=0
  f.get.mockImplementation(async p=>{
    const answer=await original(p)
    if(p.objectId===target&&p.version===undefined&&++count===2){
      const copied=structuredClone(answer);copied.response.object.digest=f.digest(29);return copied
    }
    return answer
  })
  await expect(f.confirm()).rejects.toThrow('changed')
  expect(f.record.syncStatus).toBe('PENDING')
})
it('rejects a foreign address masquerading as current custody',async()=>{
  const f=await fixture('buy','external'),raw=f.objects.get(f.record.snapshot.asset.itemId)
  raw.version=4n;raw.digest=f.digest(29);raw.owner.address=id(999)
  await expect(f.confirm()).rejects.toThrow()
})
it.each(['base','external'] as const)('confirms atomic %s removal while retaining the unselected instance',async kind=>{
  const f=await fixture('list',kind,true),final=f.record.snapshot.removal!.equipment!
  expect(final.retainedSelectionIndexes).toEqual(kind==='base'?['1']:['0'])
  expect(await f.confirm()).toBe('COMPLETE')
})
it.each(['missing-effect','commitment','revision','selection-count'])(
  'rejects altered partial removal %s',async reason=>{
    const f=await fixture('list','base',true),loadoutId=f.record.snapshot.removal!.equipment!.plan.scope.equipmentId
    if(reason==='missing-effect'){f.effects.V2.changedObjects=f.effects.V2.changedObjects.filter(([key]:any[])=>key!==loadoutId);f.refresh()}
    else f.edit(loadoutId,EquipmentLoadoutBcs,v=>{
      if(reason==='commitment')v.commitment=Array(32).fill(29);if(reason==='revision')v.revision='99';if(reason==='selection-count')v.selection_count='99'
    },true)
    await expect(f.confirm()).rejects.toThrow()
  })
it.each(['base','external'] as const)('rejects clearing unchecked equipment alongside selected %s',async kind=>{
  const f=await fixture('list',kind,true),loadoutId=f.record.snapshot.removal!.equipment!.plan.scope.equipmentId
  f.edit(loadoutId,EquipmentLoadoutBcs,v=>{v.selections=v.selections.map(()=>null);v.selection_count='0'},true)
  await expect(f.confirm()).rejects.toThrow()
})
it.each(['same-version','version-regressed','revision-regressed'] as const)('rejects current partial-removal loadout %s',async change=>{
  const f=await fixture('list','base',true),loadoutId=f.record.snapshot.removal!.equipment!.plan.scope.equipmentId
  f.edit(loadoutId,EquipmentLoadoutBcs,v=>{v.revision=change==='revision-regressed'?'1':'3'})
  if(change!=='same-version')f.objects.get(loadoutId).version=change==='version-regressed'?2n:4n
  await expect(f.confirm()).rejects.toThrow()
})
it('marks a verified later update to the retained equipment as superseded',async()=>{
  const f=await fixture('list','base',true),loadoutId=f.record.snapshot.removal!.equipment!.plan.scope.equipmentId
  f.edit(loadoutId,EquipmentLoadoutBcs,v=>{v.revision='3'})
  f.objects.get(loadoutId).version=4n;f.objects.get(loadoutId).digest=f.digest(30)
  expect(await f.confirm()).toBe('SUPERSEDED')
})
for(const kind of ['base','external'] as const)for(const action of ['list','buy','cancel','recover','reprice'] as const){
  it(`confirms canonical V1 ${kind} ${action} outputs`,async()=>{
    const f=await fixture(action,kind);f.useV1Effects()
    const effects=bcs.TransactionEffects.parse(f.ledger.effects.bcs.value)
    expect(effects.$kind).toBe('V1')
    expect(await f.confirm()).toBe('COMPLETE')
    if(action!=='reprice')expect(f.get.mock.calls.some(([p])=>p.objectId===f.record.snapshot.asset.itemId
      &&p.version===BigInt(f.record.snapshot.reference.version))).toBe(true)
  })
}
for(const action of ['list','buy','cancel','recover'] as const){
  it.each(['missing','digest','version','owner','owner-kind','type','modified-version','missing-modified-version','duplicate-modified-version'])(
    `rejects V1 ${action} predecessor %s`,async reason=>{
      const f=await fixture(action,'external'),{v1,refreshV1}=f.useV1Effects(),s=f.record.snapshot
      const key=f.historyKey(s.asset.itemId,BigInt(s.reference.version)),previous=f.history.get(key)
      if(reason==='missing')f.history.delete(key)
      if(reason==='digest')previous.digest=f.digest(29)
      if(reason==='version')previous.version=1n
      if(reason==='owner')previous.owner.address=id(999)
      if(reason==='owner-kind')previous.owner.kind=2
      if(reason==='type')previous.objectType=`${s.release.runtime!.originalPackageId}::runtime_v8::OwnedBaseItemV8`
      if(reason==='modified-version')v1.modifiedAtVersions.find(([objectId])=>objectId===s.asset.itemId)![1]='1'
      if(reason==='missing-modified-version')v1.modifiedAtVersions=v1.modifiedAtVersions.filter(([objectId])=>objectId!==s.asset.itemId)
      if(reason==='duplicate-modified-version')v1.modifiedAtVersions.push([s.asset.itemId,s.reference.version])
      refreshV1();await expect(f.confirm()).rejects.toThrow()
    })
}
it.each(['base','external'] as const)('confirms canonical V1 partial %s removal and retained loadout',async kind=>{
  const f=await fixture('list',kind,true);f.useV1Effects()
  expect(await f.confirm()).toBe('COMPLETE')
})
it.each(['missing','duplicate','owner','version','digest'])(
  'rejects V1 asset output %s',async reason=>{
    const f=await fixture('buy'),{v1,refreshV1}=f.useV1Effects(),itemId=f.record.snapshot.asset.itemId
    const row=v1.mutated.find(([ref])=>ref.objectId===itemId)!
    if(reason==='missing')v1.mutated=v1.mutated.filter(([ref])=>ref.objectId!==itemId)
    if(reason==='duplicate')v1.mutated.push(row)
    if(reason==='owner')row[1]={$kind:'AddressOwner',AddressOwner:id(999)}
    if(reason==='version')row[0].version=f.record.snapshot.reference.version
    if(reason==='digest')row[0].digest=f.digest(29)
    refreshV1();await expect(f.confirm()).rejects.toThrow()
  })
