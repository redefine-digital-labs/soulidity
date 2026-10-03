import { expect, it, vi } from 'vitest'
vi.mock('../../web/lib/hooks/use-wallet-sign',()=>({useWalletSign:vi.fn()}))
vi.mock('../../web/lib/hooks/use-native-market-buy-actions',()=>({useNativeMarketBuyActions:vi.fn()}))
vi.mock('../../web/components/providers/auth-provider',()=>({useAuth:vi.fn()}))
import { nativePurchaseStatus } from '../../web/lib/hooks/use-purchase'
import { marketBuyFixture, bid } from './fixtures/market-buy-operation'

it.each(['COMPLETE','SUPERSEDED'] as const)('a restored %s journal is not current ownership proof or a checkout blocker', async syncStatus => {
  const f=await marketBuyFixture(),record={...f.record,phase:'SUCCEEDED' as const,syncStatus}
  expect(nativePurchaseStatus({record,confirmedResult:null,snapshot:null,busy:false,pending:false,error:null})).toBe('idle')
})
it.each(['COMPLETE','SUPERSEDED'] as const)('a fresh resale listing stays purchasable after a checked prior %s purchase', async syncStatus => {
  const f=await marketBuyFixture(),record={...f.record,phase:'SUCCEEDED' as const,syncStatus}
  expect(nativePurchaseStatus({record,confirmedResult:record,snapshot:{...f.snapshot,listingId:bid(999)},busy:false,pending:false,error:null})).toBe('idle')
})
it.each([['COMPLETE','done'],['SUPERSEDED','superseded'],['PENDING','unknown']] as const)('uses an explicit current %s verification for %s display',async(syncStatus,status)=>{
  const f=await marketBuyFixture(),record={...f.record,phase:'SUCCEEDED' as const,syncStatus}
  expect(nativePurchaseStatus({record,confirmedResult:record,snapshot:null,busy:false,pending:false,error:null})).toBe(status)
})
it('a confirmation for an older digest never describes a new active transaction',async()=>{
  const f=await marketBuyFixture(),confirmedResult={...f.record,phase:'SUCCEEDED' as const,syncStatus:'COMPLETE' as const}
  expect(nativePurchaseStatus({record:{...f.record,phase:'SIGNING',digest:'new'},confirmedResult,snapshot:f.snapshot,busy:false,pending:true,error:null})).toBe('unknown')
})
it('a later paused listing still supersedes the old acquired screen',async()=>{
  const f=await marketBuyFixture(),record={...f.record,phase:'SUCCEEDED' as const,syncStatus:'COMPLETE' as const}
  expect(nativePurchaseStatus({record,confirmedResult:record,snapshot:{...f.snapshot,listingId:bid(999),purchaseAvailable:false},busy:false,pending:false,error:null})).toBe('idle')
})
