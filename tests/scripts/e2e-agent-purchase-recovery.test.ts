import { afterEach, describe, expect, it, vi } from 'vitest'
import { executePreparedAgentPurchase } from '../../web/scripts/e2e-agent-purchase'
const native={preparedPurchaseId:'saved-purchase',txBytes:Buffer.from('test-bytes').toString('base64'),
  context:{soulOnChainId:'soul',agentAddress:'buyer',royaltySource:'animacraft-maker',digest:'saved-digest',phase:'SIGNING',recoveryRequired:false}}
const complete={digest:'saved-digest',soulOnChainId:'soul',currentOwnerAddress:'buyer',listingStatus:'held',phase:'SUCCEEDED',outcome:'SUCCEEDED',onChainSuccess:true,syncStatus:'COMPLETE',dbSynced:true}
function fixture(responses:Array<[number,Record<string,unknown>]>,ordinary=false){
  const fetcher=vi.fn();for(const [status,body]of responses)fetcher.mockResolvedValueOnce(new Response(JSON.stringify(body),{status}))
  const sign=vi.fn(async()=>({signature:'test-signature'}));const sleep=vi.fn(async()=>{})
  const prepared=ordinary?{...native,context:{soulOnChainId:'soul'}}:structuredClone(native)
  const params={prepared,agentAddress:'buyer',baseUrl:'http://local.invalid',headers:{Authorization:'Bearer isolated-test'},sign,fetcher,sleep,maxChecks:2}
  return{params,fetcher,sign,sleep,run:()=>executePreparedAgentPurchase(params)}
}
afterEach(()=>vi.useRealTimers())
describe('isolated agent E2E purchase confirmation',()=>{
  it('accepts exact native final success without inventing currentKioskId',async()=>{const f=fixture([[200,complete]]);expect(await f.run()).toEqual(complete);expect(f.sign).toHaveBeenCalledTimes(1)})
  it('preserves ordinary response contract',async()=>{const body={digest:'ordinary',soulOnChainId:'soul',currentOwnerAddress:'buyer',currentKioskId:'kiosk',listingStatus:'held'};const f=fixture([[200,body]],true);expect(await f.run()).toEqual(body)})
  it('202 then 207 only checks saved packet and never repeats signing',async()=>{
    const f=fixture([[202,{digest:'saved-digest',phase:'SIGNED'}],[207,{digest:'saved-digest',onChainSuccess:true,dbSynced:false}],[200,complete]])
    expect(await f.run()).toEqual(complete);expect(f.sign).toHaveBeenCalledTimes(1)
    expect(f.fetcher.mock.calls.map(c=>JSON.parse(c[1].body))).toEqual([
      {preparedPurchaseId:'saved-purchase',action:'execute',signature:'test-signature'},
      {preparedPurchaseId:'saved-purchase',action:'check'},{preparedPurchaseId:'saved-purchase',action:'check'}])
  })
  it('prepare recoveryRequired does not sign again',async()=>{
    const f=fixture([[202,{digest:'saved-digest',phase:'SIGNED'}],[200,complete]]);f.params.prepared.context={...native.context,recoveryRequired:true}
    await f.run();expect(f.sign).not.toHaveBeenCalled();expect(f.fetcher.mock.calls.every(c=>JSON.parse(c[1].body).action==='check')).toBe(true)
  })
  it.each([202,207])('bounded %s never prints/returns confirmation',async status=>{
    const f=fixture(Array.from({length:3},()=>[status,{digest:'saved-digest',phase:'SIGNED'}]))
    await expect(f.run()).rejects.toThrow('not confirmed');expect(f.sign).toHaveBeenCalledTimes(1);expect(f.fetcher).toHaveBeenCalledTimes(3)
  })
  it.each(['phase','outcome','onChainSuccess','syncStatus','dbSynced','digest','soulOnChainId','currentOwnerAddress','listingStatus'])('rejects malformed native200 %s',async field=>{
    const f=fixture([[200,{...complete,[field]:'wrong'}]]);await expect(f.run()).rejects.toThrow('not confirmed');expect(f.fetcher).toHaveBeenCalledTimes(1)
  })
  it('cannot treat native200 as ordinary success',async()=>{const f=fixture([[200,{digest:'saved-digest',soulOnChainId:'soul',currentOwnerAddress:'buyer',currentKioskId:'kiosk',listingStatus:'held'}]]);await expect(f.run()).rejects.toThrow('not confirmed')})
  it('rejects substituted recovery digest without polling',async()=>{const f=fixture([[202,{digest:'different'}]]);await expect(f.run()).rejects.toThrow('saved transaction digest');expect(f.fetcher).toHaveBeenCalledTimes(1)})
  it.each([409,422,503])('does not equate HTTP%s with success or rebuild',async status=>{const f=fixture([[status,{...complete,syncStatus:'SUPERSEDED'}]]);await expect(f.run()).rejects.toThrow('not confirmed');expect(f.fetcher).toHaveBeenCalledTimes(1)})
  it('ordinary207 is explicitly incomplete, not a native check request',async()=>{const f=fixture([[207,{onChainSuccess:true,dbSynced:false}]],true);await expect(f.run()).rejects.toThrow('not confirmed');expect(f.fetcher).toHaveBeenCalledTimes(1)})
  it('unknown timeout aborts request without signing/submitting again or accepting late success',async()=>{
    vi.useFakeTimers();const f=fixture([]);let resolve!:(r:Response)=>void;f.fetcher.mockImplementation(()=>new Promise(r=>{resolve=r}))
    const pending=f.run();const assertion=expect(pending).rejects.toThrow('response unknown');await vi.advanceTimersByTimeAsync(25001);await assertion
    expect(f.fetcher.mock.calls[0][1].signal.aborted).toBe(true);resolve(new Response(JSON.stringify(complete)));await Promise.resolve()
    expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.sign).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0)
  })
})
