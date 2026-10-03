// @vitest-environment jsdom
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import {EquipmentMarketRecovery} from '../../web/components/souls/equipment-market-recovery'
import {equipmentMarketOperationFixture,emid} from './fixtures/equipment-market-operation'
const m=vi.hoisted(()=>({account:null as any,read:vi.fn()}))
vi.mock('@mysten/dapp-kit',()=>({useCurrentAccount:()=>m.account}))
vi.mock('../../web/lib/animacraft/equipment-market-operation-store',()=>({readBrowserEquipmentMarketJournals:m.read}))
let root:Root,host:HTMLDivElement,f:Awaited<ReturnType<typeof equipmentMarketOperationFixture>>
const select=vi.fn(),render=()=>act(async()=>root.render(<EquipmentMarketRecovery onSelect={select}/>))
beforeEach(async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});f=await equipmentMarketOperationFixture()
  m.account={address:f.actor};m.read.mockReset().mockReturnValue([f.record]);select.mockClear()
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
it('opens a saved item explicitly without requiring current chain inventory',async()=>{
  await render();expect(m.read).not.toHaveBeenCalled()
  await act(async()=>host.querySelector('button')!.click());expect(m.read).toHaveBeenCalledWith(f.actor)
  expect(select).not.toHaveBeenCalled();await act(async()=>host.querySelectorAll('button')[1].click())
  expect(select).toHaveBeenCalledWith(f.record)
})
it('hides another wallet’s cached journals after account changes',async()=>{
  await render();await act(async()=>host.querySelector('button')!.click());m.account={address:emid(999)};await render()
  expect(host.textContent).not.toContain(f.itemId);expect(host.querySelectorAll('button')).toHaveLength(1)
})
it('shows storage damage as an error rather than an empty successful search',async()=>{
  m.read.mockImplementation(()=>{throw new Error('Damaged journal')});await render();await act(async()=>host.querySelector('button')!.click())
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Damaged journal')
  expect(host.textContent).not.toContain('No component transactions saved')
})
