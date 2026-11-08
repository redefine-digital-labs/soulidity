import {afterEach,expect,it,vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {toBase64} from '@mysten/sui/utils'
import {aid} from './fixtures/activity-transaction-evidence'
import {NativeInitialAuthorizationBcs} from '../../web/lib/soulidity/native-initial-children'

// Actual original receipt/money history + actual current raw qualification +
// actual callable ABI verification + Seal/AES. Transport and keyserver remain
// controlled; this is not executed-source, payment or product acceptance.
import {coherentRecovery} from './fixtures/commerce-paid-original-current'
afterEach(()=>vi.restoreAllMocks())
it.each([false,true])('opens same-Soul original-paid content with actual current raw policy/Seal/AES, compatible append=%s',async appended=>{
 const f=await coherentRecovery(appended),r=await f.run()
 expect(r).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_CONTENT_OPENED',notDurablePurchaseCompletion:true,notMainnetAcceptance:true,original:{status:'SUBSCRIPTION_RECORDED',receipt:{money:{buyerGrossDebit:'104',protocolIncome:'3'}}},delivery:{status:'CONTENT_OPENED',accessPath:'REUSE_ENTRY',qualification:{soulId:f.x.f.root.id,recordIndex:appended?2:0}}})
 if(!('delivery'in r)||r.delivery.status!=='CONTENT_OPENED')throw Error('NOT_OPENED')
 expect(r.delivery.content.bytes).toEqual(f.plaintext);expect(f.cryptoFixture.sign).toHaveBeenCalledOnce();expect(f.fetcher).toHaveBeenCalledOnce()
 const ptb=bcs.TransactionKind.parse(f.cryptoFixture.decryptCall.mock.calls[0][0].txBytes).ProgrammableTransaction!,call=ptb.commands[0].MoveCall!
 expect(call.function).toBe('seal_approve_content_paid_v2');expect(ptb.commands).toHaveLength(1);expect(ptb.inputs[call.arguments[3].Input!].Pure!.bytes).toBe(toBase64(bcs.u64().serialize(appended?2:0).toBytes()))
 expect(ptb.inputs.flatMap(i=>i.Object?.SharedObject?[i.Object.SharedObject.mutable]:[])).toEqual([false,false,false]);expect(f.cryptoFixture.unwrapped.every(v=>v.every(b=>b===0))).toBe(true)
 r.delivery.content.bytes.fill(0)
})
it.each(['expiry','generation'] as const)('original money remains confirmed but current %s loss denies actual content before signing',async variant=>{
 const f=await coherentRecovery()
 if(variant==='expiry')f.x.clock(1100)
 else{f.x.auth.generation=3;const old=f.x.f.rows.get(f.x.auth.id),owner=bcs.Object.parse(old.bcs.value).owner.ObjectOwner!;f.x.f.object(f.x.auth.id,`${f.x.params.target.content!.originalPackageId}::authorization::Authorization`,NativeInitialAuthorizationBcs.serialize(f.x.auth).toBytes(),owner)}
 // No current sale Offer: loss of authority cannot manufacture a fresh purchase.
 const r=await f.run();expect(r).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_CURRENT_ACCESS_UNAVAILABLE',original:{status:'SUBSCRIPTION_RECORDED',receipt:{money:{buyerGrossDebit:'104'}}},delivery:{status:'CURRENT_ACCESS_NOT_REUSABLE'},notPermissionToRetryPayment:true})
 expect(f.cryptoFixture.sign).not.toHaveBeenCalled();expect(f.cryptoFixture.decryptCall).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled()
})
it('clears actual decrypted bytes if current Entry expires during decryption after original history passed',async()=>{
 const f=await coherentRecovery(),decrypt=f.cryptoFixture.decryptCall.getMockImplementation()!
 f.cryptoFixture.decryptCall.mockImplementation(async(...args)=>{const r=await decrypt(...args);f.x.clock(1100);return r})
 await expect(f.run()).rejects.toThrow('QUALIFICATION_CHANGED');expect(f.opened()).toBeInstanceOf(Uint8Array);expect(f.opened()!.every(v=>v===0)).toBe(true)
})
it('missing original payment remains unknown and never enters current content access',async()=>{
 const f=await coherentRecovery();f.h.finality.client.ledgerService.getTransaction.mockRejectedValue({code:'NOT_FOUND'})
 const r=await f.run();expect(r).toMatchObject({status:'ORIGINAL_SUBSCRIPTION_NOT_CONFIRMED',original:{status:'MISSING'},notContentDelivered:true,notPermissionToRetryPayment:true})
 expect(f.client.ledgerService.getObject).not.toHaveBeenCalled();expect(f.cryptoFixture.sign).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled()
})
it('same-Soul selection is checked before original history or any current object read',async()=>{
 const f=await coherentRecovery();f.qualification.soulId=aid(8999)
 await expect(f.run()).rejects.toThrow('RECOVERY_SELECTION');expect(f.h.finality.client.ledgerService.getTransaction).not.toHaveBeenCalled();expect(f.client.ledgerService.getObject).not.toHaveBeenCalled();expect(f.cryptoFixture.sign).not.toHaveBeenCalled()
})
