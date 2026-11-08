import {vi} from 'vitest'
import {bcs} from '@mysten/sui/bcs'
import {normalizeStructTag} from '@mysten/sui/utils'
import {aid,adigest} from './activity-transaction-evidence'
import {integratedProtectedFixture} from './commerce-recovery-current-content'
import {publicReadPurchaseFixture} from './commerce-purchase-recovery-v2'
import {recoverNativePublicReadPaidContentV2} from '../../../web/lib/soulidity/commerce/native-public-read-paid-recovery-delivery-v2'
import {openNativePublicPaidContentV2} from '../../../web/lib/soulidity/native-public-paid-content-open-v2'
import {NativeInitialPaidBcs} from '../../../web/lib/soulidity/native-initial-children'

export async function coherentRecovery(appended=false){
 const protectedFixture=await integratedProtectedFixture(false,appended),x=protectedFixture.x,t=x.params.target
 const ids:Record<number,string>={40:t.native.originalPackageId,41:t.native.callablePackageId,42:t.content!.originalPackageId,43:t.content!.callablePackageId,
  44:x.params.economics.foundation.originalPackageId,45:x.params.economics.foundation.callablePackageId,46:t.standard.originalPackageId,47:t.standard.callablePackageId,
  70:x.owner,72:x.f.root.id,73:x.host.state.id,74:x.ledger.id,75:x.cfg.id,76:x.cfg.recipient,77:x.cfg.income.requests.id,78:t.registryId,80:x.f.kiosk!.id,
  81:aid(8801),82:aid(8802),83:x.ledger.offers.id,84:x.ledger.entries.id,85:x.ledger.attempts.id,86:aid(8806),90:x.f.library.id,94:x.host.id}
 if(new Set(Object.values(ids)).size!==Object.values(ids).length)throw Error('FIXTURE_ID_ALIAS')
 const h=await publicReadPurchaseFixture('money',x.buyer,x.record.kind,{ids,state:x.host.state,hostBirth:'5',kioskBirth:'5'}),p=h.params
 p.native=t.native as typeof p.native;p.content=t.content! as typeof p.content;p.foundation=x.params.economics.foundation
 const historyGet=p.client.ledgerService.getObject.bind(p.client.ledgerService),currentGet=x.f.client.ledgerService.getObject.getMockImplementation()!
 // Keep each shared ID/version byte-identical to the original after state.
 for(const id of [x.host.id,x.ledger.id,x.entryId,x.cfg.id]){
  const row=h.history.base.rows.get(`${id}:10`);if(!row)throw Error('COHERENT_AFTER_ROW_REQUIRED');x.f.rows.set(id,structuredClone(row))
 }
 // A controlled later Offer-removal state has a distinct version from the
 // historical purchase after row; original Entry remains byte-identical.
 const paidAfter=h.history.base.rows.get(`${x.ledger.id}:10`)!,paid=NativeInitialPaidBcs.parse(paidAfter.contents.value)
 paid.revision='5';paid.offers.size='0'
 const latest=h.history.base.object(x.ledger.id,11,paidAfter.objectType,NativeInitialPaidBcs.serialize(paid).toBytes(),{ObjectOwner:bcs.Object.parse(paidAfter.bcs.value).owner.ObjectOwner!},adigest(8811))
 x.f.rows.set(x.ledger.id,latest)
 x.clock(1001)
 const getObject=vi.fn((r:any,o:any)=>r.version===undefined?currentGet(r,o):historyGet(r,o))
 const client:any={...x.f.client,core:x.f.client.core,ledgerService:{...p.client.ledgerService,getObject}}
 const history={...p,client,signal:x.params.signal},qualification={...x.params,client}
 let opened:Uint8Array|undefined
 const run=()=>recoverNativePublicReadPaidContentV2({history,delivery:{qualification,protected:{sealClient:protectedFixture.cryptoFixture.client,blobBaseUrl:'https://walrus.example.com',sealConfig:protectedFixture.cryptoFixture.params.sealConfig,getAddress:protectedFixture.cryptoFixture.params.wallet.getAddress,signPersonalMessage:protectedFixture.cryptoFixture.sign}}},
  {openPaid:async input=>{const result=await openNativePublicPaidContentV2(input,{fetcher:protectedFixture.fetcher});opened=result.bytes;return result},openOwner:async()=>{throw Error('WRONG_OWNER_POLICY')}})
 const pin=({originalPackageId,callablePackageId,callableDigest}:typeof t.native)=>({originalPackageId,callablePackageId,callableDigest})
 const intent={...p.intent,coinType:normalizeStructTag(p.intent.coinType)}
 const originalText=JSON.stringify({format:'native-public-read-v2',intent,packet:{...p.packet,phase:'PREPARED',signature:null},reviewedGas:p.gas,
  context:{target:t,economics:{...x.params.economics,foundation:pin(p.foundation)},originalQuotedOffer:p.offer,originalOfferReference:{objectId:x.offerId,version:'9',digest:adigest(888)},
   originalReceiptContext:{soulId:p.soulId,ledgerId:p.ledgerId,native:pin(t.native),content:pin(t.content!),foundation:pin(p.foundation),offer:p.offer}}})
 return {...protectedFixture,history,qualification,h,client,originalText,run,opened:()=>opened}
}
