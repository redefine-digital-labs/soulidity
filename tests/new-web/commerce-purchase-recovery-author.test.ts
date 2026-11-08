import {afterEach,expect,it,vi} from 'vitest'
import {purchaseRecoveryAuthorFixture} from './fixtures/commerce-purchase-recovery-author'
import {purchaseRecoveryFixture} from './fixtures/commerce-purchase-recovery-original'
import {queryPurchaseRecoveryOriginal} from '../../web/lib/soulidity/commerce/purchase-recovery-original'
afterEach(()=>vi.restoreAllMocks())
it('composes original events, actual money, original Soul author/State/Registry/directory and transfer policy through the recovery entry',async()=>{
 const x=await purchaseRecoveryAuthorFixture(),run=(strong=false)=>queryPurchaseRecoveryOriginal({text:x.text,soulId:x.soulId,client:x.client,signal:new AbortController().signal,...strong?{proveSaleSource:true as const}:{}})
 expect(await run()).toMatchObject({history:{status:'SETTLEMENT_CONFIRMED',receipt:{money:{requiresOriginalSourceBindingProof:true,notCompleteSaleProof:true}}}})
 const proof=await run(true);expect(proof).toMatchObject({history:{status:'SETTLEMENT_CONFIRMED',receipt:{money:{requiresOriginalSourceBindingProof:false,requiresOriginalTransferPolicyProof:false,sourceBinding:{requiresOriginalSoulModuleBinding:false,soulBinding:{soulId:x.soulId}},quote:{ask:101n,creator:3n,platform:3n,total:107n}}}}})
})
it.each(['module-minter','module-body','module-owner','module-manifest','module-origin-source'])('matching payment remains independent of invalid original author/source %s',async variant=>{
 const x=await purchaseRecoveryAuthorFixture(variant),input={text:x.text,soulId:x.soulId,client:x.client,signal:new AbortController().signal}
 expect(await queryPurchaseRecoveryOriginal(input)).toMatchObject({history:{status:'SETTLEMENT_CONFIRMED'}})
 await expect(queryPurchaseRecoveryOriginal({...input,proveSaleSource:true})).rejects.toThrow(/SALE_ORIGINAL_SOURCE_/)
})
it('V2 has a content beneficiary, not a V1 Soul author proof; rejects source query before RPC',async()=>{
 const x=await purchaseRecoveryFixture('v2'),get=x.finality.client.ledgerService.getTransaction;get.mockClear()
 await expect(queryPurchaseRecoveryOriginal({text:x.text,soulId:x.soulId,client:x.client,signal:new AbortController().signal,proveSaleSource:true})).rejects.toThrow('SOURCE_V1_ONLY');expect(get).not.toHaveBeenCalled()
})
