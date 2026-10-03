import {afterEach,expect,it,vi} from 'vitest'
import {browserNativeMarketReadbackFixture} from './fixtures/browser-native-market-readback'
import {confirmBrowserSelectedMarketSale} from '../../web/lib/animacraft/browser-selected-market-sale-readback'
import type {SelectedMarketSaleOperationRecord} from '../../web/lib/animacraft/selected-market-sale-operation'
import {lid} from './fixtures/market-list-operation'

afterEach(()=>vi.restoreAllMocks())
async function fixture(){
  const f=await browserNativeMarketReadbackFixture()
  if(f.record.kind!=='list')throw new Error('Expected list fixture')
  const r:SelectedMarketSaleOperationRecord={...f.record,kind:'batch-list',snapshot:{schema:'selected-market-sale-v1',owner:f.record.snapshot.owner,
    rows:[{assetType:'soul',snapshot:f.record.snapshot,priceAtomic:f.record.priceAtomic}],equipment:[]}}
  return {...f,record:r,confirm:()=>confirmBrowserSelectedMarketSale(r,{target:f.target},{client:f.client})}
}
it('retains the real native Soul-only subset through the unified selected-sale readback',async()=>{
  const f=await fixture();expect(await f.confirm()).toBe('COMPLETE');expect(f.execute).not.toHaveBeenCalled()
})
it('reports later native cancellation as superseded after proving the original sale',async()=>{
  const f=await fixture();f.later(state=>{state.is_listed=false});expect(await f.confirm()).toBe('SUPERSEDED')
})
it.each([lid(14),lid(23)])('missing native historical %s keeps the selected sale pending',async id=>{
  const f=await fixture();f.history.delete(id);await expect(f.confirm()).rejects.toThrow()
  expect(f.record.syncStatus).toBe('PENDING')
})
it('rejects a changed target before network queries',async()=>{
  const f=await fixture();f.target.protocolConfigId=lid(999)
  await expect(f.confirm()).rejects.toThrow('release mismatch');expect(f.transaction).not.toHaveBeenCalled()
})
it('honors an already cancelled read without network queries',async()=>{
  const f=await fixture(),abort=new AbortController();abort.abort()
  await expect(confirmBrowserSelectedMarketSale(f.record,{target:f.target,signal:abort.signal},{client:f.client})).rejects.toThrow()
  expect(f.transaction).not.toHaveBeenCalled()
})
