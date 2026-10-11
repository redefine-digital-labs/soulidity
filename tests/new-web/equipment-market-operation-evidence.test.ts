import {expect,it} from 'vitest'
import {queryEquipmentMarketOperationEvidence} from '../../web/lib/animacraft/equipment-market-operation-evidence'
import {equipmentMarketEvidenceFixture as fixture} from './fixtures/equipment-market-evidence'

const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
for(const kind of ['base','external'] as const)for(const action of ['list','reprice','buy','cancel','recover'] as const){
  it(`authenticates ${kind} ${action} and returns the exact normalized listing receipt`,async()=>{
    const f=await fixture(action,kind),proof=await queryEquipmentMarketOperationEvidence(f.record,f.client)
    expect(proof.status).toBe('SUCCEEDED')
    if(proof.status==='SUCCEEDED')expect(proof.receipt).toMatchObject({action,listingId:f.listingId,assetKind:kind,
      assetId:f.record.snapshot.asset.itemId,revision:action==='list'?'0':String(BigInt(f.record.snapshot.listing!.revision)+1n),
      recipient:action==='buy'?f.record.snapshot.actor:f.record.snapshot.seller})
    expect(f.client.ledgerService.getObject.mock.calls.every(([p]:any[])=>[f.record.snapshot.release.equipmentMarket!.callablePackageId,
      f.record.snapshot.release.runtime!.callablePackageId].includes(p.objectId))).toBe(true)
  })
}
it.each(['missing','duplicate','other-action','wrong-package','wrong-module','wrong-origin','sender','generic','physical-lane','asset','seller','registry','price','quote','root','epoch','alias'])(
  'rejects substituted equipment opening: %s',async reason=>{
    const f=await fixture(),e=f.events[1]
    if(reason==='missing')f.events.pop();if(reason==='duplicate')f.events.push(e)
    if(reason==='other-action')e.type_.name='MarketListingSettledV8'
    if(reason==='wrong-package')e.package_id=id(999);if(reason==='wrong-module')e.transaction_module='market'
    if(reason==='wrong-origin')e.type_.address=id(999);if(reason==='sender')e.sender=id(999)
    if(reason==='generic')e.type_.typeParams=[{u8:true}]
    f.changeMarket(row=>{
      if(reason==='physical-lane')row.lane=2;if(reason==='asset')row.asset_id=id(999);if(reason==='seller')row.seller=id(999)
      if(reason==='registry')row.registry_id=id(999);if(reason==='price')row.gross_atomic='40';if(reason==='quote')row.quote_commitment=[1]
      if(reason==='root')row.root_id=id(999);if(reason==='epoch')row.ownership_epoch='999';if(reason==='alias')row.listing_id=f.record.snapshot.asset.itemId
    })
    await expect(queryEquipmentMarketOperationEvidence(f.record,f.client)).rejects.toThrow()
  })
it.each(['missing','duplicate','order','action','listing','asset','kind','source','holder','previous-holder','epoch','previous-epoch','commitment','origin','package','sender','runtime-digest','runtime-origin'])(
  'rejects incomplete or substituted custody: %s',async reason=>{
    const f=await fixture('buy','external')
    f.changeCustody(row=>{
      if(reason==='action')row.action=2;if(reason==='listing')row.listing_id=id(999);if(reason==='asset')row.asset_id=id(999)
      if(reason==='kind')row.asset_kind=0;if(reason==='source')row.source_id=id(999);if(reason==='holder')row.holder=f.record.snapshot.seller
      if(reason==='previous-holder')row.previous_holder=id(999);if(reason==='epoch')row.ownership_epoch='999'
      if(reason==='previous-epoch')row.previous_ownership_epoch='999';if(reason==='commitment')row.asset_commitment=[1]
    })
    if(reason==='missing')f.events.shift();if(reason==='duplicate')f.events.push(f.events[0])
    if(reason==='origin')f.events[0].type_.address=id(999);if(reason==='package')f.events[0].package_id=id(999)
    if(reason==='sender')f.events[0].sender=id(999);if(reason==='runtime-digest')f.packages[1].digest=f.record.digest
    if(reason==='runtime-origin')f.packages[1].package.typeOrigins[0].packageId=id(999)
    if(reason==='order')f.events.reverse()
    f.refresh();await expect(queryEquipmentMarketOperationEvidence(f.record,f.client)).rejects.toThrow()
  })
it.each(['buyer','gross_atomic','protocol_atomic','creator_atomic','source_atomic','seller_atomic'])(
  'rejects incorrect settlement %s',async field=>{
    const f=await fixture('buy');f.changeMarket(row=>{row[field]=field==='buyer'?id(999):'1'})
    await expect(queryEquipmentMarketOperationEvidence(f.record,f.client)).rejects.toThrow()
  })
it.each(['previous_revision','revision','previous_gross_atomic','gross_atomic','quote_commitment','listing_id'])(
  'rejects incorrect reprice %s',async field=>{
    const f=await fixture('reprice');f.changeMarket(row=>{row[field]=field==='quote_commitment'?[1]:field==='listing_id'?id(999):'999'})
    await expect(queryEquipmentMarketOperationEvidence(f.record,f.client)).rejects.toThrow()
  })
it.each(['cancel','recover'] as const)('cannot swap %s with another close action',async action=>{
  const f=await fixture(action);f.changeMarket(row=>{row.recovered=!row.recovered})
  await expect(queryEquipmentMarketOperationEvidence(f.record,f.client)).rejects.toThrow()
})
it('accepts the exact atomic partial-unequip packet with its post-removal custody commitment',async()=>{
  const f=await fixture('list','base',true)
  expect(f.record.snapshot.removal).not.toBeNull()
  expect((await queryEquipmentMarketOperationEvidence(f.record,f.client)).status).toBe('SUCCEEDED')
})
it('rejects a custody transition during a reprice',async()=>{
  const f=await fixture('reprice')
  f.events.push({...f.events[0],type_:{...f.events[0].type_,module:'runtime_v8',name:'EquipmentMarketCustodyTransitionV8'},transaction_module:'runtime_v8'})
  f.refresh();await expect(queryEquipmentMarketOperationEvidence(f.record,f.client)).rejects.toThrow('custody')
})
it('rejects altered evidence between Market and Runtime authentication',async()=>{
  const f=await fixture()
  f.client.ledgerService.getTransaction.mockResolvedValueOnce({response:{transaction:structuredClone(f.ledger)}})
    .mockImplementationOnce(async()=>{f.ledger.checkpoint=21n;return {response:{transaction:f.ledger}}})
  await expect(queryEquipmentMarketOperationEvidence(f.record,f.client)).rejects.toThrow('packet changed')
})
it('returns missing, pending and failed without reading historical packages or live assets',async()=>{
  const f=await fixture()
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({code:'NOT_FOUND'})
  expect(await queryEquipmentMarketOperationEvidence(f.record,f.client)).toEqual({status:'MISSING'})
  delete f.ledger.checkpoint
  expect(await queryEquipmentMarketOperationEvidence(f.record,f.client)).toEqual({status:'PENDING'})
  f.ledger.checkpoint=20n;f.effects.V2.status={Failure:{error:{InsufficientGas:true},command:0}}
  f.ledger.effects.status.success=false;f.refresh()
  expect(await queryEquipmentMarketOperationEvidence(f.record,f.client)).toEqual({status:'FAILED'})
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})
it('validates the saved command graph before querying any historical evidence',async()=>{
  const f=await fixture();f.record.priceAtomic='4000'
  await expect(queryEquipmentMarketOperationEvidence(f.record,f.client)).rejects.toThrow()
  expect(f.client.ledgerService.getServiceInfo).not.toHaveBeenCalled()
})
