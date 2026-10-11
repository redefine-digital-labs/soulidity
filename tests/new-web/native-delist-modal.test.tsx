// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NativeDelistModal } from '../../web/components/souls/native-delist-modal'
const m = vi.hoisted(() => ({ params: null as any, actions: {} as any, toast: vi.fn(), close: vi.fn() }))
vi.mock('../../web/lib/hooks/use-native-market-cancel-actions', () => ({ useNativeMarketCancelActions: (params:any) => { m.params=params; return m.actions } }))
vi.mock('../../web/components/ui/toast', () => ({ useToast: () => ({showToast:m.toast}) }))
let host:HTMLDivElement, root:Root, client:QueryClient
const id=(n:number)=>`0x${n.toString(16).padStart(64,'0')}`
const soul:any={onChainId:id(12),stateOnChainId:id(14),name:'Maker Soul',listingObjectOnChainId:id(30),
  currentKioskCapOnChainId:id(31),listedPriceAtomic:'1000000',provenanceKind:'animacraft',isOwner:true,listingStatus:'listed'}
const render=async(open=true,details=soul)=>act(async()=>root.render(<QueryClientProvider client={client}>
  <NativeDelistModal soul={details} open={open} onClose={m.close}/></QueryClientProvider>))
const button=(text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!
const click=async(text:string)=>act(async()=>button(text).click())
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); vi.clearAllMocks()
  m.actions={record:null,snapshot:{owner:id(11),listed:true,listingActive:true,release:{writesEnabled:true}},
    error:null,loading:false,busy:false,pending:false,needsRecovery:false,canStart:true,start:vi.fn().mockResolvedValue(null),
    resume:vi.fn().mockResolvedValue(null),check:vi.fn().mockResolvedValue(null),cancelUnsigned:vi.fn(),refresh:vi.fn(),
    history:[],historyResults:{},checkHistory:vi.fn(),retireExpired:vi.fn().mockResolvedValue(null)}
  client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();client.clear()})
it('keeps original modal/confirmation and starts only on deliberate Delist click',async()=>{
  await render();expect(host.querySelector('[role=dialog]')).not.toBeNull()
  expect(host.textContent).toContain('Are you sure you want to remove this Soul from the marketplace?')
  expect(m.actions.start).not.toHaveBeenCalled();expect(m.params).toMatchObject({soulId:id(12),stateId:id(14),listingId:id(30),kioskCapId:id(31),enabled:true})
  await click('Delist Soul');expect(m.actions.start).toHaveBeenCalledOnce();expect(m.close).not.toHaveBeenCalled()
})
it('invalidates cached public market rows on confirmed cancellation change',async()=>{
  const key=['souls','public-market-v1','fixture']
  client.setQueryDefaults(key,{gcTime:Infinity})
  client.setQueryData(key,{listed:true});await render()
  expect(client.getQueryState(key)?.isInvalidated).toBe(false)
  await act(async()=>m.params.onChanged())
  expect(client.getQueryState(key)?.isInvalidated).toBe(true)
})
it('never reports a saved or unknown signature as cancellation success',async()=>{
  m.actions.start.mockResolvedValue({phase:'SIGNED'});await render();await click('Delist Soul')
  expect(m.toast).not.toHaveBeenCalled();expect(m.close).not.toHaveBeenCalled()
})
it('closes and reports success only after the operation verifies ledger and current chain state',async()=>{
  m.actions.start.mockResolvedValue({phase:'SUCCEEDED',syncStatus:'COMPLETE'});await render();await click('Delist Soul')
  expect(m.toast).toHaveBeenCalledWith('Soul delisted successfully','success');expect(m.close).toHaveBeenCalledOnce()
})
it('keeps recovery mounted when modal is closed and ownership/listing has changed',async()=>{
  m.actions.record={phase:'SIGNED',digest:'saved-digest',signature:'signature'};m.actions.pending=true;m.actions.needsRecovery=true;m.actions.canStart=false
  await render(false,{...soul,isOwner:false,listingStatus:'held',listingObjectOnChainId:null})
  expect(host.querySelector('[role=dialog]')).toBeNull();expect(host.textContent).toContain('saved-digest')
  await click('Check saved transaction');expect(m.actions.check).toHaveBeenCalledOnce()
  await click('Resume saved cancellation');expect(m.actions.resume).toHaveBeenCalledOnce()
  expect(button('Discard unsigned request')).toBeUndefined();expect(m.actions.start).not.toHaveBeenCalled()
})
it.each(['PREPARED','SIGNING','SIGNED'])('permits unsigned discard only for PREPARED: %s',async phase=>{
  m.actions.record={phase,digest:'saved-digest',signature:phase==='SIGNED'?'signature':null};m.actions.pending=true;m.actions.needsRecovery=true
  await render();expect(Boolean(button('Discard unsigned request'))).toBe(phase==='PREPARED')
  if(phase==='PREPARED'){await click('Discard unsigned request');expect(m.actions.cancelUnsigned).toHaveBeenCalledOnce()}
})
it('disabled candidate write gate still exposes query recovery',async()=>{
  m.actions.snapshot.release.writesEnabled=false;m.actions.canStart=false
  m.actions.pending=true;m.actions.needsRecovery=true;m.actions.record={phase:'SIGNED',digest:'saved',signature:'sig'}
  await render();expect(button('Delist Soul').disabled).toBe(true)
  expect(host.textContent).toContain('Saved transaction checks remain available')
  await click('Check saved transaction');expect(m.actions.check).toHaveBeenCalledOnce()
})
it('errors and refresh do not erase saved recovery or trigger signing',async()=>{
  m.actions.error='RPC unavailable';m.actions.pending=true;m.actions.needsRecovery=true;m.actions.record={phase:'SIGNING',digest:'saved',signature:null}
  await render();expect(host.querySelector('[role=alert]')?.textContent).toBe('RPC unavailable')
  await click('Refresh listing');expect(m.actions.refresh).toHaveBeenCalledOnce();expect(m.actions.start).not.toHaveBeenCalled()
})
it('prevents modal close and duplicate actions while a signing/recovery operation is busy',async()=>{
  m.actions.busy=true;m.actions.canStart=false;await render()
  await act(async()=>{(host.querySelector('[aria-label="Close modal"]') as HTMLButtonElement).click()})
  expect(m.close).not.toHaveBeenCalled();expect(button('Cancel').disabled).toBe(true);expect(button('Recovering…').disabled).toBe(true)
})
it('keeps confirmed cancellation recoverable while current chain-state verification is pending',async()=>{
  m.actions.record={phase:'SUCCEEDED',syncStatus:'PENDING',digest:'saved'};m.actions.needsRecovery=true
  m.actions.check.mockResolvedValue({...m.actions.record});await render(false)
  expect(host.textContent).toContain('Confirmed on chain. Current chain-state verification is still pending.')
  await click('Check saved transaction');expect(m.toast).not.toHaveBeenCalled();expect(m.close).not.toHaveBeenCalled()
})
it('explains a confirmed cancellation superseded by a later relist or ownership change',async()=>{
  m.actions.record={phase:'SUCCEEDED',syncStatus:'PENDING',digest:'saved'};m.actions.needsRecovery=true
  m.actions.check.mockResolvedValue({...m.actions.record,syncStatus:'SUPERSEDED'});await render(false)
  await click('Check saved transaction');expect(m.toast.mock.calls[0][0]).toContain('current state was preserved')
})
it.each(['SIGNING','SIGNED'])('allows checking expiry of %s but never claims retirement is on-chain failure',async phase=>{
  m.actions.record={phase,digest:'saved',signature:phase==='SIGNED'?'sig':null};m.actions.needsRecovery=true
  m.actions.retireExpired.mockResolvedValue({...m.actions.record,phase:'RETIRED'});await render(false)
  expect(host.textContent).toContain('does not mean the cancellation failed')
  await click('Check expiry and archive');expect(m.actions.retireExpired).toHaveBeenCalledOnce()
  expect(m.toast).not.toHaveBeenCalled();expect(m.close).not.toHaveBeenCalled();expect(m.actions.start).not.toHaveBeenCalled()
})
it('retired requests remain visible and queryable without offering signing or another retirement',async()=>{
  m.actions.record={phase:'RETIRED',digest:'old'};m.actions.needsRecovery=true;m.actions.history=[m.actions.record]
  await render(false);expect(host.textContent).toContain('past result is still unknown')
  expect(button('Resume saved cancellation')).toBeUndefined();expect(button('Check expiry and archive')).toBeUndefined()
  expect(button('Discard unsigned request')).toBeUndefined();await click('Check saved transaction')
  expect(m.actions.check).toHaveBeenCalledOnce()
})
it('keeps history available after a new operation and ownership/listing changes',async()=>{
  m.actions.record={phase:'SIGNED',digest:'new'};m.actions.needsRecovery=true;m.actions.history=[{phase:'RETIRED',digest:'old'}]
  await render(false,{...soul,isOwner:false,listingStatus:'held'})
  expect(host.textContent).toContain('Cancellation history (1)')
  await click('Check archived transaction');expect(m.actions.checkHistory).toHaveBeenCalledWith('old')
  expect(m.actions.resume).not.toHaveBeenCalled();expect(m.toast).not.toHaveBeenCalled()
})
it.each([
  ['MISSING','past result remains unknown, not failed'],
  ['PENDING','final confirmation is not yet available'],
  ['SUCCEEDED','does not describe the current listing'],
  ['FAILED','failed on chain'],
])('explains historical %s without a current cancellation success toast',async(status,description)=>{
  m.actions.history=[{phase:'RETIRED',digest:'old'}];m.actions.historyResults={old:status}
  await render(false);expect(host.textContent).toContain(description);expect(m.toast).not.toHaveBeenCalled()
  expect(host.querySelector('[role=dialog]')).toBeNull()
})
it('disables history and expiry checks during any other recovery operation',async()=>{
  m.actions.record={phase:'SIGNING',digest:'new'};m.actions.needsRecovery=true;m.actions.history=[{phase:'RETIRED',digest:'old'}];m.actions.busy=true
  await render(false);expect(button('Check archived transaction').disabled).toBe(true)
  expect(button('Check expiry and archive').disabled).toBe(true)
})
