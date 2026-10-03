// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({native:null as any,hook:vi.fn(),sign:vi.fn(),build:vi.fn(),assert:vi.fn(),auth:vi.fn(),wallet:{address:'seller'}}))
vi.mock('../../web/lib/hooks/use-native-market-list-actions',()=>({useNativeMarketListActions:(scope:unknown)=>{m.hook(scope);return m.native}}))
vi.mock('../../web/lib/hooks/use-wallet-sign',()=>({useWalletSign:()=>({suiWallet:m.wallet,signAndExecute:m.sign,suiClient:{}})}))
vi.mock('../../web/components/providers/auth-provider',()=>({useAuth:()=>({getAuthHeaders:m.auth})}))
vi.mock('@soulidity/sdk',async original=>({...await original<typeof import('@soulidity/sdk')>(),buildListSoulTx:m.build,assertObjectInputsExist:m.assert}))
import {useListSoul,nativeListingStatus} from '../../web/lib/hooks/use-list-soul'
let root:Root,host:HTMLDivElement,result:ReturnType<typeof useListSoul>
function Probe({soul}:{soul:any}){result=useListSoul(soul);return <p>{result.status}</p>}
const soul={onChainId:'soul',stateOnChainId:'state',provenanceKind:'animacraft',listingObjectOnChainId:'listing',
  currentKioskId:'kiosk',currentKioskCapOnChainId:'cap',collectionOnChainId:null,collection:null}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks()
  m.native={record:null,confirmedResult:null,snapshot:null,busy:false,pending:false,error:null,wallet:{address:'seller'},start:vi.fn()}
  m.auth.mockResolvedValue({Authorization:'fixture'});m.sign.mockResolvedValue({digest:'ordinary-digest'});m.build.mockReturnValue({ordinary:true})
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({})}))
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('native facade selects one durable LIST path, never legacy or ordinary builder',async()=>{
  await act(async()=>root.render(<Probe soul={{...soul,animacraftProvenance:{animacraftVersion:5}}}/>))
  expect(m.hook).toHaveBeenCalledWith({soulId:'soul',stateId:'state',listingId:'listing'})
  await act(async()=>{await result.listSoul(123456789n)})
  expect(m.native.start).toHaveBeenCalledWith(123456789n,'list');expect(m.build).not.toHaveBeenCalled();expect(m.sign).not.toHaveBeenCalled()
})
it('ordinary Soul uses its existing kiosk and floor without any native request',async()=>{
  await act(async()=>root.render(<Probe soul={{...soul,provenanceKind:'native'}}/>))
  expect(m.hook).toHaveBeenCalledWith(null);expect(result.native).toBeNull()
  await act(async()=>{await result.listSoul(1000000n)})
  expect(m.build).toHaveBeenCalledWith({currentKioskId:'kiosk',currentKioskCapOnChainId:'cap',stateObjectId:'state',priceAtomic:1000000n,collectionObjectId:null})
  expect(m.sign).toHaveBeenCalledWith({ordinary:true});expect(m.native.start).not.toHaveBeenCalled();expect(result.status).toBe('done')
})
it('ordinary floor still prevents a signature',async()=>{
  await act(async()=>root.render(<Probe soul={{...soul,provenanceKind:'native',collection:{floorPriceAtomic:'2000000'}}}/>))
  await act(async()=>{await result.listSoul(1000000n)})
  expect(result.status).toBe('error');expect(m.sign).not.toHaveBeenCalled()
})
it.each(['COMPLETE','SUPERSEDED','PENDING'])('persisted success %s is not a fresh confirmed UI status',syncStatus=>{
  expect(nativeListingStatus({...m.native,record:{phase:'SUCCEEDED',digest:'old',syncStatus}})).toBe('unknown')
})
it.each([['COMPLETE','done'],['SUPERSEDED','superseded'],['PENDING','unknown']])('explicit verified %s becomes %s', (syncStatus,status)=>{
  const record={phase:'SUCCEEDED',digest:'verified',syncStatus}
  expect(nativeListingStatus({...m.native,record,confirmedResult:record})).toBe(status)
})
it('a different old confirmed digest cannot describe the current journal',()=>{
  expect(nativeListingStatus({...m.native,record:{phase:'SIGNED',digest:'new'},pending:true,
    confirmedResult:{phase:'SUCCEEDED',digest:'old',syncStatus:'COMPLETE'}})).toBe('unknown')
})
it('retired intent stays retired, not a failed transaction',()=>{
  expect(nativeListingStatus({...m.native,record:{phase:'RETIRED',digest:'old'}})).toBe('retired')
})
