// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useNativeEquipmentActions } from '../../web/lib/hooks/use-native-equipment-actions'
import type { EquipmentSnapshot } from '../../web/lib/animacraft/equipment-operation'
import { EquipmentNoChangeError } from '../../web/lib/animacraft/equipment-operation'
import { equipmentOperationFixture, eid } from './fixtures/equipment-operation'
const mocks = vi.hoisted(() => ({ client:{grpc:{}},wallet:{name:'wallet-a'},adapter:null as any,account: null as null | { address: string }, run: vi.fn(), read: vi.fn(), sign: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => mocks.account, useCurrentWallet:()=>({currentWallet:mocks.wallet}),useSuiClient: () => mocks.client,
  useSignTransaction: () => ({ mutateAsync: mocks.sign }) }))
vi.mock('../../web/lib/animacraft/equipment-operation', async original => ({
  ...await original<typeof import('../../web/lib/animacraft/equipment-operation')>(),
  browserEquipmentOperationStore: () => ({ read: mocks.read }), runEquipmentOperation: mocks.run,
}))
vi.mock('../../web/lib/animacraft/equipment-operation-adapter', () => ({ createEquipmentOperationAdapter: (params:any) => {mocks.adapter=params;return params} }))
let root: Root; let host: HTMLDivElement; let state: ReturnType<typeof useNativeEquipmentActions>
function Probe({ snapshot }: { snapshot: EquipmentSnapshot }) {
  state = useNativeEquipmentActions({ soulId: snapshot.soulId, snapshot, read: async () => snapshot, onChanged: () => {} })
  return <span>{String(state.canStart)}</span>
}
beforeEach(() => {
  Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT: true }); mocks.run.mockReset(); mocks.read.mockReset().mockReturnValue(null)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function setup() {
  const { record } = await equipmentOperationFixture(); mocks.account = { address: record.owner }
  const snapshot = { soulId: record.soulId, owner: record.owner, release: record.release, listed: false } as EquipmentSnapshot
  await act(async () => root.render(<Probe snapshot={snapshot} />))
  return { snapshot, record }
}
it('can retry a preparation failure with no pending record after refresh', async () => {
  const { snapshot } = await setup(); expect(state.canStart).toBe(true)
  mocks.run.mockRejectedValue(new Error('Equipment changed'))
  await act(async () => { await state.start({ kind: 'close' }) })
  expect(state.error).toBe('Equipment changed'); expect(state.canStart).toBe(true)
  await act(async () => root.render(<Probe snapshot={{ ...snapshot }} />))
  await act(async () => { await state.start({ kind: 'close' }) })
  expect(mocks.run).toHaveBeenCalledTimes(2)
})
it('restored SIGNING blocks new actions and remains queryable', async () => {
  const { record } = await equipmentOperationFixture()
  mocks.read.mockReturnValue({ ...record, phase: 'SIGNING' }); await setup()
  expect(state.pending).toBe(true); expect(state.canStart).toBe(false)
  mocks.run.mockResolvedValue({ ...record, phase: 'SIGNING' })
  await act(async () => { await state.check() })
  expect(mocks.run).toHaveBeenLastCalledWith(expect.objectContaining({ queryOnly: true, operation: undefined }))
})
it('shows already-equipped as an informational no-transaction result and clears it on the next action',async()=>{
  await setup();mocks.run.mockRejectedValue(new EquipmentNoChangeError())
  await act(async()=>{await state.start({kind:'close'})})
  expect(state.notice).toContain('No transaction is needed');expect(state.error).toBeNull();expect(state.pending).toBe(false)
  mocks.run.mockRejectedValue(new Error('Later preparation failed'))
  await act(async()=>{await state.start({kind:'close'})})
  expect(state.notice).toBeNull();expect(state.error).toBe('Later preparation failed')
})
it('ignores a late old-wallet result after switching the connected account', async () => {
  const { snapshot, record } = await setup(); let finish!: (value: unknown) => void
  mocks.run.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  let pending!: Promise<void>
  await act(async () => { pending = state.start({ kind: 'close' }) })
  mocks.account = { address: eid(999) }
  await act(async () => root.render(<Probe snapshot={snapshot} />))
  await act(async () => { finish({ ...record, phase: 'SIGNED' }); await pending })
  expect(state.record).toBeNull(); expect(state.canStart).toBe(false); expect(state.busy).toBe(false)
})
it.each(['account','wallet','client','ABA'])('revokes equipment capabilities after %s replacement',async change=>{
  const {snapshot,record}=await setup();mocks.run.mockResolvedValue({...record,phase:'SIGNING'})
  await act(async()=>{await state.check()});const adapter=mocks.adapter,account=mocks.account
  if(change==='account')mocks.account={...mocks.account!}
  if(change==='wallet')mocks.wallet={name:'replacement'}
  if(change==='client')mocks.client={grpc:{}}
  if(change==='ABA')mocks.account={address:eid(999)}
  await act(async()=>root.render(<Probe snapshot={snapshot}/>))
  if(change==='ABA'){mocks.account=account;await act(async()=>root.render(<Probe snapshot={snapshot}/>))}
  expect(adapter.getAddress()).toBeNull();expect(()=>adapter.sign({})).toThrow('changed')
  await expect(adapter.read()).rejects.toThrow('session changed')
  expect(mocks.sign).not.toHaveBeenCalled()
})
