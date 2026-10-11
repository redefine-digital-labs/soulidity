import {expect,it,vi,afterEach} from 'vitest'
import {createBrowserMarketSouls} from '../../web/lib/soulidity/browser-market-souls'
import {marketSoulRawFixture,marketSoulPageFixture,id} from './fixtures/browser-market-souls'
afterEach(()=>vi.restoreAllMocks())
it.each([true,false])('reads actual authored listed=%s Soul independently of current owner',async listed=>{
  const f=marketSoulRawFixture(listed)
  const scanner=createBrowserMarketSouls({...f.params,selection:{kind:'AUTHOR',creatorAddress:f.state.creator}},{fetch:f.fetcher})
  await scanner.next();const page=await scanner.next()
  expect(page.candidateStatus).toBe('COMPLETE');expect(page.souls).toHaveLength(1)
  expect(page.souls[0].creatorAddress).toBe(f.state.creator)
})
it('does not confuse a creators purchased items with authored items, or omit sold creations',async()=>{
  const f=await marketSoulPageFixture(2),creator=id(888)
  f.assets[0].creator=creator;f.assets[0].currentOwner=id(889)
  f.details[0].creatorAddress=creator;f.details[0].currentOwnerAddress=id(889)
  f.details[0].isCreator=f.params.viewerAddress===creator;f.details[0].isOwner=f.params.viewerAddress===id(889)
  f.assets[1].creator=id(890);f.assets[1].currentOwner=creator
  const selection={kind:'AUTHOR' as const,creatorAddress:creator}
  const scanner=createBrowserMarketSouls({...f.params,selection},f.dependencies)
  selection.creatorAddress=id(999)
  await scanner.next();const page=await scanner.next()
  expect(page.verifiedSoulCandidates).toBe(2);expect(page.souls.map(row=>row.onChainId)).toEqual([f.assets[0].soulId])
  expect(f.detail).toHaveBeenCalledTimes(1)
})
it('keeps an author page pending on a detail failure and preserves its cursor for retry',async()=>{
  const f=await marketSoulPageFixture(),creator=f.assets[0].creator
  const scanner=createBrowserMarketSouls({...f.params,selection:{kind:'AUTHOR',creatorAddress:creator}},f.dependencies)
  await scanner.next();f.detail.mockRejectedValueOnce(new Error('offline'))
  await expect(scanner.next()).rejects.toThrow('offline')
  expect((await scanner.next()).souls).toHaveLength(1);expect(f.fetcher).toHaveBeenCalledTimes(2)
})
