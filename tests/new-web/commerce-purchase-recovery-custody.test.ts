import {expect,it} from 'vitest'
import {queryPurchaseRecoveryOriginal} from '../../web/lib/soulidity/commerce/purchase-recovery-original'
import {purchaseRecoveryCustodyFixture} from './fixtures/commerce-purchase-recovery-custody'
import {purchaseRecoveryFixture} from './fixtures/commerce-purchase-recovery-original'
import {aid,adigest} from './fixtures/activity-transaction-evidence'
const run=(x:Awaited<ReturnType<typeof purchaseRecoveryCustodyFixture>>,extra={})=>queryPurchaseRecoveryOriginal({text:x.text,soulId:x.soulId,client:x.client,signal:new AbortController().signal,proveSaleCustody:true,...extra})
it('composes actual original packet/finality/Sold/Paid/money/listing and custody with exact saved Account and Kiosk refs',async()=>{
 const x=await purchaseRecoveryCustodyFixture(),result=await run(x);expect(result).toMatchObject({kind:'native-sale-preparation.v1',history:{status:'SETTLEMENT_CONFIRMED',receipt:{money:{protocolIncome:'3'},custody:{soulId:x.soulId,buyerAccountInput:x.original.plan.buyerAccount,rootRevision:'2',claimedEffectIds:expect.arrayContaining([x.soulId,x.sellerLock,x.buyerLock]),notCurrentAuthority:true},notCompleteSaleProof:true,notDeliveryProof:true}}})
 const offer=(await x.client.ledgerService.getObject({objectId:x.original.plan.offerId,version:9n})).response.object
 if(result.kind!=='native-sale-preparation.v1'||result.history.status!=='SETTLEMENT_CONFIRMED')throw Error('Expected sale settlement')
 const listing=(await x.client.ledgerService.getObject({objectId:result.history.receipt.listingExit.listingId,version:9n})).response.object
 expect(result.history.receipt.listingExit).toMatchObject({
  offerInput:{version:'9',digest:offer.digest,writer:adigest(9)},listingInput:{version:'9',digest:listing.digest,writer:adigest(9)},
 })
 expect(x.client.ledgerService.getObject.mock.calls.filter(([r]:any)=>r.version===undefined).every(([r]:any)=>[x.original.context.target.native.callablePackageId,x.original.context.target.standard.callablePackageId,x.original.context.target.custody.callablePackageId,x.original.context.economics.foundation.callablePackageId].includes(r.objectId))).toBe(true)
})
it.each(['root-owner','buyer-lock','missing-lock','account-closure','account-reference','kiosk-reference'])('refuses original %s contradiction without weakening already-confirmed money-only query',async variant=>{
 const x=await purchaseRecoveryCustodyFixture(variant);await expect(run(x)).rejects.toThrow(variant==='account-reference'?'CUSTODY_ACCOUNT_REFERENCE':variant==='kiosk-reference'?'CUSTODY_KIOSK_REFERENCE':undefined)
 expect(await run(x,{proveSaleCustody:undefined})).toMatchObject({history:{status:'SETTLEMENT_CONFIRMED',receipt:{custody:null,money:{protocolIncome:'3'}}}})
})
it.each(['missing','pending'])('does not read custody success objects for original %s history',async variant=>{const x=await purchaseRecoveryCustodyFixture();if(variant==='missing')x.client.ledgerService.getTransaction.mockRejectedValue({code:'NOT_FOUND'});else delete x.finality.ledger.checkpoint;expect(await run(x)).toMatchObject({history:{status:variant==='missing'?'MISSING':'PENDING'}});expect(x.client.ledgerService.getObject).not.toHaveBeenCalled()})
it('requires saved original Custody pin before history RPC, without changing or upgrading original record',async()=>{const x=await purchaseRecoveryCustodyFixture();delete (x.original.context.target as any).custody;x.text=JSON.stringify(x.original);await expect(run(x)).rejects.toThrow('CUSTODY_PIN_REQUIRED');expect(x.client.ledgerService.getTransaction).not.toHaveBeenCalled()})
it('rejects V2 custody request and wrong Soul before history RPC',async()=>{const x=await purchaseRecoveryFixture('v2');await expect(queryPurchaseRecoveryOriginal({...x,signal:new AbortController().signal,proveSaleCustody:true})).rejects.toThrow('CUSTODY_V1_ONLY');expect(x.client.ledgerService.getTransaction).not.toHaveBeenCalled();const v1=await purchaseRecoveryCustodyFixture();await expect(run(v1,{soulId:aid(999)})).rejects.toThrow('SOUL_MISMATCH');expect(v1.client.ledgerService.getTransaction).not.toHaveBeenCalled()})
