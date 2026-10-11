import {expect,it} from 'vitest'
import {fromHex} from '@mysten/sui/utils'
import {selectedMarketSaleEvidenceFixture} from './fixtures/selected-market-sale-evidence'
import {equipmentMarketReadbackFixture} from './fixtures/equipment-market-readback'
import {querySelectedMarketSaleEvidence} from '../../web/lib/animacraft/selected-market-sale-evidence'
import {confirmAuthenticatedEquipmentMarketRow,confirmAuthenticatedPartialEquipmentRemoval} from '../../web/lib/animacraft/browser-equipment-market-readback'
import {createNativeMarketReadbackSession} from '../../web/lib/animacraft/browser-native-market-readback'
import {EquipmentReadSet,EquipmentLoadoutBcs} from '../../web/lib/animacraft/native-equipment'
import {EquipmentMarketListingBcs} from '../../web/lib/animacraft/native-equipment-market-bcs'
import {emid} from './fixtures/equipment-market-operation'
import {equipmentOperationQuote} from '../../web/lib/animacraft/equipment-market-operation'
import {confirmBrowserSelectedMarketSale} from '../../web/lib/animacraft/browser-selected-market-sale-readback'

async function fixture(){
  const selected=await selectedMarketSaleEvidenceFixture(false),base=await equipmentMarketReadbackFixture('list','base',true),
    external=await equipmentMarketReadbackFixture('list','external',true),r=selected.record
  r.phase='SUCCEEDED';r.syncStatus='PENDING'
  selected.effects.V2.changedObjects=[]
  for(const [index,f] of [base,external].entries()){
    const row=r.snapshot.rows[index];if(row.assetType!=='equipment')throw new Error('Equipment fixture expected')
    const listingId=emid(900+index),listing=structuredClone(f.listing),item=structuredClone(f.item)
    const post=EquipmentMarketListingBcs.parse(listing.contents.value)
    post.id=listingId;post.custody.listing_id=listingId
    const quote=equipmentOperationQuote(row.snapshot,row.priceAtomic)
    Object.assign(post,{gross_atomic:quote.grossAtomic,protocol_atomic:quote.protocolAtomic,seller_atomic:quote.sellerAtomic,
      quote_commitment:[...fromHex(quote.commitment)]})
    listing.objectId=listingId;listing.previousTransaction=r.digest;listing.contents.value=EquipmentMarketListingBcs.serialize(post).toBytes()
    item.previousTransaction=r.digest;item.owner.address=listingId
    for(const raw of [listing,item]){base.objects.set(raw.objectId,raw);base.history.set(base.historyKey(raw.objectId,3n),structuredClone(raw))}
    const effects=structuredClone(f.effects.V2.changedObjects.slice(0,2))
    effects[0][0]=listingId;effects[1][1].outputState.ObjectWrite[1].AddressOwner=listingId
    selected.effects.V2.changedObjects.push(...effects)
  }
  const group=r.snapshot.equipment[0],final=group.equipment!,raw=base.objects.get(final.plan.scope.equipmentId)
  const loadout=EquipmentLoadoutBcs.parse(raw.contents.value)
  loadout.revision=final.finalRevision;loadout.selection_count=final.finalSelectionCount;loadout.commitment=[...fromHex(final.finalCommitment)]
  loadout.selections=loadout.selections.map(()=>null)
  raw.previousTransaction=r.digest;raw.contents.value=EquipmentLoadoutBcs.serialize(loadout).toBytes()
  base.history.set(base.historyKey(raw.objectId,3n),structuredClone(raw))
  selected.effects.V2.changedObjects.push(base.effects.V2.changedObjects[2]);selected.refresh()
  const client={...base.client,ledgerService:{...base.client.ledgerService,getTransaction:selected.client.ledgerService.getTransaction}}
  async function confirm(afterEvaluators?:()=>void){
    const signal=AbortSignal.timeout(25000),session=createNativeMarketReadbackSession(client,signal,2),
      context={client:session.client,signal,reads:new EquipmentReadSet(session.client,true),historyReads:new EquipmentReadSet(session.client)}
    const proof=await querySelectedMarketSaleEvidence(r,session.client)
    if(proof.status!=='SUCCEEDED')throw new Error('Receipt unavailable')
    const results=[]
    for(const [index,row] of r.snapshot.rows.entries()){
      const receipt=proof.receipts[index]
      if(row.assetType!=='equipment'||receipt.assetType!=='equipment')throw new Error('Equipment fixture expected')
      results.push(await confirmAuthenticatedEquipmentMarketRow({snapshot:row.snapshot,action:'list',bytes:r.bytes,digest:r.digest},
        {effects:proof.effects,receipt:receipt.receipt},context))
    }
    results.push(await confirmAuthenticatedPartialEquipmentRemoval({actor:r.snapshot.owner,rootId:selected.rootId,target:selected.target,
      preparation:group,bytes:r.bytes,digest:r.digest,effects:proof.effects},context))
    afterEvaluators?.()
    await context.reads.verify();await session.verify();return results
  }
  return {...selected,base,group,confirm,
    confirmBatch:()=>confirmBrowserSelectedMarketSale(r,{target:selected.target},{client})}
}
it('confirms two listings and exactly one grouped removal while retaining the unselected Soul binding',async()=>{
  const f=await fixture()
  expect(f.group.equipment).toMatchObject({closeBinding:false,finalRevision:'3',finalSelectionCount:'0'})
  expect(await f.confirm()).toEqual(['COMPLETE','COMPLETE','COMPLETE'])
})
it.each(['first','second'])('requires the historical asset for the %s selected row',async which=>{
  const f=await fixture(),row=f.record.snapshot.rows[which==='first'?0:1]
  if(row.assetType!=='equipment')throw new Error('Equipment fixture expected')
  f.base.history.delete(f.base.historyKey(row.snapshot.asset.itemId,3n))
  await expect(f.confirm()).rejects.toThrow()
})
it('rejects the old per-item partial result when the saved whole packet removed both items',async()=>{
  const f=await fixture(),row=f.record.snapshot.rows[0]
  if(row.assetType!=='equipment')throw new Error('Equipment fixture expected')
  const old=row.snapshot.removal!.equipment!,raw=f.base.history.get(f.base.historyKey(f.group.equipment!.plan.scope.equipmentId,3n))
  const value=EquipmentLoadoutBcs.parse(raw.contents.value);value.revision=old.finalRevision;value.commitment=[...fromHex(old.finalCommitment)]
  raw.contents.value=EquipmentLoadoutBcs.serialize(value).toBytes()
  await expect(f.confirm()).rejects.toThrow('Historical partial removal')
})
it('rejects a substituted full-close plan in the partial-only evaluator',async()=>{
  const f=await fixture();f.group.sellSoul=true;f.group.equipment!.closeBinding=true
  // Packet validation catches this before any per-row readback.
  await expect(f.confirm()).rejects.toThrow()
})
it('classifies a later authenticated group update separately from both successful listing outputs',async()=>{
  const f=await fixture(),id=f.group.equipment!.plan.scope.equipmentId
  f.base.edit(id,EquipmentLoadoutBcs,row=>{row.revision='4'})
  const raw=f.base.objects.get(id);raw.version=4n;raw.digest=f.base.digest(30)
  expect(await f.confirm()).toEqual(['COMPLETE','COMPLETE','SUPERSEDED'])
})
it('rechecks the shared read session after all selected row and group checks',async()=>{
  const f=await fixture(),id=f.group.equipment!.plan.scope.equipmentId,original=f.base.get.getMockImplementation()!
  let finished=false,changed=false
  await expect(f.confirm(()=>{
    finished=true
    f.base.get.mockImplementation(async request=>{
      const answer=await original(request)
      if(request.objectId===id&&request.version===undefined){
        changed=true;const different=structuredClone(answer);different.response.object.digest=f.base.digest(31);return different
      }
      return answer
    })
  })).rejects.toThrow('changed')
  expect(finished&&changed).toBe(true)
  expect(f.record.syncStatus).toBe('PENDING')
})
it('synchronizes the complete equipment-selected packet through the public mixed readback entry',async()=>{
  const f=await fixture();expect(await f.confirmBatch()).toBe('COMPLETE')
  expect(f.record.syncStatus).toBe('PENDING') // Only the lifecycle owns durable status writes.
})
it('public mixed readback propagates a later group update as whole-transaction superseded',async()=>{
  const f=await fixture(),id=f.group.equipment!.plan.scope.equipmentId
  f.base.edit(id,EquipmentLoadoutBcs,row=>{row.revision='4'})
  const raw=f.base.objects.get(id);raw.version=4n;raw.digest=f.base.digest(30)
  expect(await f.confirmBatch()).toBe('SUPERSEDED')
})
it.each(['second item','group'])('public mixed readback never completes without historical %s',async kind=>{
  const f=await fixture(),id=kind==='group'?f.group.equipment!.plan.scope.equipmentId:emid(102)
  f.base.history.delete(f.base.historyKey(id,3n))
  await expect(f.confirmBatch()).rejects.toThrow();expect(f.record.syncStatus).toBe('PENDING')
})
it('public mixed readback rejects nonfinal records before querying',async()=>{
  const f=await fixture();f.record.phase='PREPARED';delete f.record.syncStatus
  await expect(f.confirmBatch()).rejects.toThrow('finalized')
  expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})
