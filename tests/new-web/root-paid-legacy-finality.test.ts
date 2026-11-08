import {expect,it,vi} from 'vitest'
import {soulAccessTransactionFixture} from './fixtures/soul-access-transaction'
import {activityEvidenceFixture,adigest,activityHash} from './fixtures/activity-transaction-evidence'
import {bcs} from '@mysten/sui/bcs'

function fail(effects:any){effects.V2.status={$kind:'Failure',Failure:{error:{$kind:'InsufficientGas',InsufficientGas:true},command:null}}}
it('legacy terminal FAILED requires actual checkpoint membership before it may release a future payment',async()=>{
 const x=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent'});fail(x.effects)
 x.client.ledgerService.getCheckpoint.mockRejectedValue(Error('CHECKPOINT_MEMBERSHIP_UNAVAILABLE'))
 await expect(x.adapter.query(x.record)).rejects.toThrow('Ledger read failed');expect(x.client.ledgerService.getCheckpoint).toHaveBeenCalledOnce()
})
it.each(['transaction','effects','epoch'] as const)('rejects a canonical checkpoint with wrong original %s evidence',async variant=>{
 const x=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent'});fail(x.effects)
 const f=await activityEvidenceFixture();f.summaryData.sequence_number='42';f.summaryData.epoch=variant==='epoch'?'8':'9'
 f.contentsData.V2!.transactions[1].digest={transaction:variant==='transaction'?adigest(99):x.record.packet.digest,effects:variant==='effects'?adigest(98):activityHash('TransactionEffects',bcs.TransactionEffects.serialize(x.effects).toBytes())};f.rehashContents()
 x.client.ledgerService.getCheckpoint.mockImplementation(async()=>({response:{checkpoint:f.checkpoint}}))
 await expect(x.adapter.query(x.record)).rejects.toThrow('CHECKPOINT_MEMBERSHIP')
})
it('accepts actual FAILED only after checking original transaction and effects membership in the original epoch',async()=>{
 const x=await soulAccessTransactionFixture({action:'paid-purchase',entry:'absent'});fail(x.effects)
 expect(await x.adapter.query(x.record)).toEqual({status:'FAILED',checkpoint:'42'});expect(x.client.ledgerService.getCheckpoint).toHaveBeenCalledOnce()
})
