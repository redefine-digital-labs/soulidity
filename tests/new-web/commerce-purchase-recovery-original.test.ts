import {expect,it} from 'vitest'
import {purchaseRecoveryFixture} from './fixtures/commerce-purchase-recovery-original'
import {aid} from './fixtures/activity-transaction-evidence'
import {parsePurchaseRecoveryOriginal,queryPurchaseRecoveryOriginal} from '../../web/lib/soulidity/commerce/purchase-recovery-original'

const query=(x:Awaited<ReturnType<typeof purchaseRecoveryFixture>>,text=x.text,soulId=x.soulId)=>queryPurchaseRecoveryOriginal({text,soulId,client:x.client,signal:new AbortController().signal})
it.each(['v1','v2'] as const)('queries %s original SDK bytes through actual finality and original money readers',async kind=>{
 const x=await purchaseRecoveryFixture(kind),saved=x.text,result=await query(x)
 expect(result.history).toMatchObject({status:kind==='v1'?'SETTLEMENT_CONFIRMED':'SUBSCRIPTION_RECORDED',checkpoint:'100',receipt:{money:{protocolIncome:'3'}}})
 expect(x.text).toBe(saved);expect(JSON.parse(x.text).packet).toEqual(x.original.packet)
 expect(x.finality.client.ledgerService.getTransaction.mock.calls.every(([p]:any)=>p.digest===x.original.packet.digest)).toBe(true)
})
it.each(['v1','v2'] as const)('rejects wrong route Soul before %s original RPC',async kind=>{
 const x=await purchaseRecoveryFixture(kind);await expect(query(x,x.text,aid(999))).rejects.toThrow('SOUL_MISMATCH');expect(x.finality.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})
it.each(['v1','v2'] as const)('preserves %s missing/pending as unknown original result',async kind=>{
 const x=await purchaseRecoveryFixture(kind);delete x.finality.ledger.checkpoint
 expect((await query(x)).history).toEqual({status:'PENDING'})
 x.finality.client.ledgerService.getTransaction.mockRejectedValue({code:'NOT_FOUND'});expect((await query(x)).history).toEqual({status:'MISSING'})
})
it.each(['v1','v2'] as const)('rejects changed %s bytes/digest or foreign context before RPC',async kind=>{
 const x=await purchaseRecoveryFixture(kind),r=JSON.parse(x.text);r.packet.digest=aid(999)
 await expect(query(x,JSON.stringify(r))).rejects.toThrow()
 const c=JSON.parse(x.text);if(kind==='v1')c.context.target.configId=aid(999);else c.context.originalReceiptContext.native.callablePackageId=aid(999)
 await expect(query(x,JSON.stringify(c))).rejects.toThrow('CONTEXT');expect(x.finality.client.ledgerService.getTransaction).not.toHaveBeenCalled()
})
it.each(['format','extra','v1-fields','bytes-array','sparse-bytes','different-offer'])('does not migrate or loosen V2 original %s',async variant=>{
 const x=await purchaseRecoveryFixture('v2'),r=JSON.parse(x.text)
 if(variant==='format')r.format='native-paid-service-v1'
 if(variant==='extra')r.newSchema='future'
 if(variant==='v1-fields')r.intent.service={objectId:aid(999),initialSharedVersion:'1'}
 if(variant==='bytes-array')r.intent.attempt=Object.values(r.intent.attempt)
 if(variant==='sparse-bytes')delete r.intent.attempt[0]
 if(variant==='different-offer')r.context.originalQuotedOffer.scope='2'
 await expect(parsePurchaseRecoveryOriginal(JSON.stringify(r),x.soulId)).rejects.toThrow()
})
it('never accepts a v1 event-only lie over authenticated original money',async()=>{
 const x=await purchaseRecoveryFixture('v1','payout');await expect(query(x)).rejects.toThrow('SALE_MONEY_PAYOUT_DISTRIBUTION')
})
it('rejects checkpoint absence before reading historical V1 success objects',async()=>{
 const x=await purchaseRecoveryFixture('v1');x.finality.contentsData.V2!.transactions.pop();x.finality.rehashContents();await expect(query(x)).rejects.toThrow('CHECKPOINT_MEMBERSHIP');expect(x.finality.client.ledgerService.getObject).not.toHaveBeenCalled()
})
it('rejects unknown schema, zero Soul and file bounds',async()=>{
 await expect(parsePurchaseRecoveryOriginal('{}',aid(72))).rejects.toThrow('UNSUPPORTED_FORMAT')
 await expect(parsePurchaseRecoveryOriginal('{}',aid(0))).rejects.toThrow('RECOVERY_SOUL')
 await expect(parsePurchaseRecoveryOriginal(' '.repeat(500001),aid(72))).rejects.toThrow('FILE_BOUND')
})
it.each(['v1','v2'] as const)('propagates %s RPC errors instead of fabricating missing/failure',async kind=>{
 const x=await purchaseRecoveryFixture(kind);x.finality.client.ledgerService.getTransaction.mockRejectedValue(Error('RPC_UNAVAILABLE'))
 await expect(query(x)).rejects.toThrow('RPC_UNAVAILABLE')
})
it('restores an original V2 previous Entry hash without converting its format',async()=>{
 const x=await purchaseRecoveryFixture('v2','renew'),parsed=await parsePurchaseRecoveryOriginal(x.text,x.soulId)
 expect(parsed.kind).toBe('native-public-read-v2');if(parsed.kind!=='native-public-read-v2')throw Error('V2_REQUIRED')
 expect(parsed.value.intent.entryHash).toBeInstanceOf(Uint8Array);expect(parsed.value.intent.entryHash).toEqual((x.original as any).intent.entryHash)
})
