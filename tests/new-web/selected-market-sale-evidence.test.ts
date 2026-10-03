import {expect,it} from 'vitest'
import {querySelectedMarketSaleEvidence,SelectedSoulListedBcs} from '../../web/lib/animacraft/selected-market-sale-evidence'
import {EquipmentMarketOpenedEventBcs,EquipmentMarketCustodyEventBcs} from '../../web/lib/animacraft/equipment-market-operation-evidence'
import {selectedMarketSaleEvidenceFixture as fixture} from './fixtures/selected-market-sale-evidence'
import {emid} from './fixtures/equipment-market-operation'

it.each([true,false])('authenticates one complete selected packet with Soul included=%s',async includeSoul=>{
  const f=await fixture(includeSoul),p=await querySelectedMarketSaleEvidence(f.record,f.client)
  expect(p.status).toBe('SUCCEEDED')
  if(p.status==='SUCCEEDED'){
    expect(p.receipts.map(row=>row.assetType)).toEqual(includeSoul?['soul','equipment','equipment']:['equipment','equipment'])
    expect(p.receipts.filter(row=>row.assetType==='equipment').map(row=>row.receipt.grossAtomic)).toEqual(['10001','20001'])
  }
  expect(f.client.ledgerService.getObject).toHaveBeenCalledTimes(includeSoul?3:2)
  expect(f.client.ledgerService.getTransaction.mock.calls.every(([p]:any[])=>p.digest===f.record.digest)).toBe(true)
})
it.each(['missing sale','extra sale','missing custody','extra custody','sale order','custody order','custody before prior sale',
  'wrong module','wrong origin','wrong sender','wrong price','wrong asset','duplicate listing','input alias','runtime origin','native digest'])(
  'rejects incomplete/substituted mixed evidence: %s',async reason=>{
    const f=await fixture(),e=f.events
    if(reason==='missing sale')e.pop();if(reason==='extra sale')e.push(e[0])
    if(reason==='missing custody')e.splice(1,1);if(reason==='extra custody')e.push(e[1])
    if(reason==='sale order')[e[2],e[4]]=[e[4],e[2]]
    if(reason==='custody order')[e[1],e[3]]=[e[3],e[1]]
    if(reason==='custody before prior sale')[e[0],e[1]]=[e[1],e[0]]
    if(reason==='wrong module')e[0].transaction_module='other'
    if(reason==='wrong origin')e[0].type_.address=emid(999)
    if(reason==='wrong sender')e[0].sender=emid(999)
    if(reason==='wrong price'||reason==='wrong asset'){
      const row=SelectedSoulListedBcs.parse(Uint8Array.from(e[0].contents))
      if(reason==='wrong price')row.price='30002';else row.soul_id=emid(999)
      e[0].contents=[...SelectedSoulListedBcs.serialize(row).toBytes()]
    }
    if(reason==='duplicate listing'||reason==='input alias'){
      const listing=reason==='duplicate listing'?emid(900):f.itemId
      const row=EquipmentMarketOpenedEventBcs.parse(Uint8Array.from(e[2].contents));row.listing_id=listing
      const custody=EquipmentMarketCustodyEventBcs.parse(Uint8Array.from(e[1].contents));custody.listing_id=listing
      e[2].contents=[...EquipmentMarketOpenedEventBcs.serialize(row).toBytes()];e[1].contents=[...EquipmentMarketCustodyEventBcs.serialize(custody).toBytes()]
    }
    if(reason==='runtime origin')f.packages[1].package.typeOrigins[0].packageId=emid(999)
    if(reason==='native digest')f.packages[2].digest=f.record.digest
    f.refresh();await expect(querySelectedMarketSaleEvidence(f.record,f.client)).rejects.toThrow()
  })
it('rejects packet changes between independently authenticated historical packages',async()=>{
  const f=await fixture()
  f.client.ledgerService.getTransaction.mockResolvedValueOnce({response:{transaction:structuredClone(f.ledger)}})
    .mockImplementationOnce(async()=>{f.ledger.checkpoint=21n;return {response:{transaction:f.ledger}}})
  await expect(querySelectedMarketSaleEvidence(f.record,f.client)).rejects.toThrow('packet changed')
})
it('never degrades a partially authenticated success to missing',async()=>{
  const f=await fixture()
  f.client.ledgerService.getTransaction.mockResolvedValueOnce({response:{transaction:structuredClone(f.ledger)}}).mockRejectedValueOnce({code:'NOT_FOUND'})
  await expect(querySelectedMarketSaleEvidence(f.record,f.client)).rejects.toThrow('packet changed')
})
it('queries no history for an altered selection or command graph',async()=>{
  const f=await fixture();f.record.snapshot.rows[0].priceAtomic='30002'
  await expect(querySelectedMarketSaleEvidence(f.record,f.client)).rejects.toThrow()
  expect(f.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})
it('returns nonfinal or failed status before reading package or asset objects',async()=>{
  const f=await fixture()
  f.client.ledgerService.getTransaction.mockRejectedValueOnce({code:'NOT_FOUND'})
  expect(await querySelectedMarketSaleEvidence(f.record,f.client)).toEqual({status:'MISSING'})
  delete f.ledger.checkpoint
  expect(await querySelectedMarketSaleEvidence(f.record,f.client)).toEqual({status:'PENDING'})
  f.ledger.checkpoint=20n;f.effects.V2.status={Failure:{error:{InsufficientGas:true},command:0}};f.ledger.effects.status.success=false;f.refresh()
  expect(await querySelectedMarketSaleEvidence(f.record,f.client)).toEqual({status:'FAILED'})
  expect(f.client.ledgerService.getObject).not.toHaveBeenCalled()
})
