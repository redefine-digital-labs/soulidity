// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { NativeWardrobePanel } from '../../web/components/souls/native-wardrobe'
const previewWallet = vi.hoisted(() => ({ client: { grpc: {} }, signTransaction: vi.fn(), signPersonalMessage: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => null, useSuiClient: () => previewWallet.client,
  useCurrentWallet: () => ({ currentWallet: null }),
  useSignTransaction: () => ({ mutateAsync: previewWallet.signTransaction }),
  useSignPersonalMessage: () => ({ mutateAsync: previewWallet.signPersonalMessage }) }))
const direct = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../web/lib/animacraft/browser-native-equipment', () => ({ readBrowserNativeEquipment: direct.read }))
vi.mock('../../web/components/souls/native-protected-artwork', () => ({ NativeProtectedArtwork: () => null }))
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
import { nativeEquipmentSealFixture } from './fixtures/native-equipment-seal'
import { nativeEquipmentPackFixture } from './fixtures/native-equipment-pack'
const actions = vi.hoisted(() => ({ record: null as any, error: null, busy: false, pending: false, canStart: false,
  start: vi.fn(), resume: vi.fn(), check: vi.fn(), params: null as any }))
vi.mock('../../web/lib/hooks/use-native-equipment-actions', () => ({ useNativeEquipmentActions: (params: any) => { actions.params = params; return actions } }))

const id = (n: number) => `0x${n.toString(16).padStart(64,'0')}`
let root: Root; let host: HTMLDivElement; let client: QueryClient
const fetched = vi.fn()
let verified: any
const snapshot = () => structuredClone(verified)
const ok = (data: unknown) => ({ ok: true, json: async () => data })
beforeEach(async () => {
  previewWallet.signTransaction.mockReset().mockRejectedValue(new Error('Unexpected wallet transaction request'))
  previewWallet.signPersonalMessage.mockReset().mockRejectedValue(new Error('Unexpected wallet message request'))
  verified = await nativeEquipmentSourceFixture().readBase()
  verified.source.stylePage = { total: 51, start: 0, next: 50 }
  verified.inventory.hasNextPage = true; verified.inventory.cursor = 'bmV4dA=='
  actions.record = null; actions.canStart = false; actions.pending = false; actions.start.mockClear(); actions.check.mockClear()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  fetched.mockReset().mockImplementation(async () => ok(snapshot()))
  direct.read.mockReset().mockImplementation(async (params: any) => {
    const response = await fetched(`https://fixture.invalid/?${params.query}`)
    const value = await response.json()
    if (!response.ok) throw Object.assign(new Error(value.code), { code: value.code })
    return value
  })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Owned API fetch is not available') }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals()
  expect(previewWallet.signTransaction).not.toHaveBeenCalled()
  expect(previewWallet.signPersonalMessage).not.toHaveBeenCalled()
})
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) }) }
const render = async (soulId = id(12)) => {
  await act(async () => root.render(<QueryClientProvider client={client}><NativeWardrobePanel key={soulId} soulObjectId={soulId} stateObjectId={id(14)} /></QueryClientProvider>))
  await settle(); await settle()
}
const click = async (text: string) => { await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === text)!.click()); await settle() }
it('opens a single explicit component sale without replacing existing equipment controls',async()=>{
  await render();expect(host.querySelector('[aria-label="Selected component sale"]')).toBeNull()
  await click('Review component sale')
  const panel=host.querySelector('[aria-label="Selected component sale"]')!
  expect(panel.textContent).toContain('Only this component is traded')
  expect(panel.textContent).toContain('No Soul, Pack access or unchecked component is included')
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Unequip component')).toBe(true)
  expect(actions.start).not.toHaveBeenCalled()
})
const select = async (label: string, value: string) => {
  await act(async () => {
    const field = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
    field.value = value; field.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
it('displays the native Soul equipment and paginated source without any legacy or signing action', async () => {
  await render()
  expect(host.textContent).toContain('Current equipment · revision 1')
  expect(host.textContent).toContain('Equipped here'); expect(host.textContent).toContain('Red hat')
  expect(host.textContent).toContain('Signing rechecks ownership and eligibility')
  expect(direct.read.mock.calls.every(([params]) => params.soulId === id(12) && params.stateId === id(14))).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  expect(host.querySelector('img')).toBeNull() // No unchecked Walrus thumbnail download.
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Unequip component')?.disabled).toBe(true)
})
it('wallet and style pagination use separate chain cursors and preserve the Soul', async () => {
  await render(); await click('Next wallet page')
  expect(fetched.mock.calls.at(-1)?.[0]).toContain('cursor=bmV4dA%3D%3D')
  await click('External items')
  expect(fetched.mock.calls.at(-1)?.[0]).toContain('inventory=external')
  expect(fetched.mock.calls.at(-1)?.[0]).not.toContain('cursor=')
  await click('Next styles'); expect(fetched.mock.calls.at(-1)?.[0]).toContain('styleStart=50')
})
it.each([
  ['Next wallet page', 'cursor=', 'First page'],
  ['Next styles', 'styleStart=50', 'First styles'],
])('can leave a permanently failed page after %s without losing current equipment', async (next, failedQuery, first) => {
  fetched.mockImplementation(async (url: string) => url.includes(failedQuery)
    ? { ok: false, json: async () => ({ code: 'NATIVE_EQUIPMENT_UNAVAILABLE' }) } : ok(snapshot()))
  await render(); await click(next)
  expect(host.querySelector('[role=alert]')).not.toBeNull()
  expect(host.textContent).toContain('Current equipment · revision 1')
  await click(first)
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(host.textContent).toContain('Red hat')
  expect(fetched.mock.calls.at(-1)?.[0]).not.toContain(failedQuery)
})
it('shows missing configuration as an error, not an empty wardrobe; refresh can recover', async () => {
  fetched.mockResolvedValue({ ok: false, json: async () => ({ code: 'NATIVE_RECEIVE_TARGET_UNAVAILABLE' }) })
  await render(); expect(host.querySelector('[role=alert]')?.textContent).toContain('configuration')
  expect(host.textContent).not.toContain('No persistent equipment')
  fetched.mockImplementation(async () => ok(snapshot())); await click('Refresh'); await settle()
  expect(host.textContent).toContain('Current equipment')
})
it('source failure does not hide already read equipment or invent available choices', async () => {
  fetched.mockImplementation(async (url: string) => url.includes('source=1')
    ? { ok: false, json: async () => ({ code: 'NATIVE_EQUIPMENT_SOURCE_INVALID' }) } : ok(snapshot()))
  await render(); expect(host.textContent).toContain('Current equipment · revision 1')
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Maker source')
  expect(host.textContent).not.toContain('Red hat')
})
it('routes removal for the exact equipped instance even when source lookup fails', async () => {
  actions.canStart = true
  fetched.mockImplementation(async (url: string) => url.includes('source=1')
    ? { ok: false, json: async () => ({ code: 'NATIVE_EQUIPMENT_SOURCE_INVALID' }) } : ok(snapshot()))
  await render(); await click('Unequip component')
  expect(actions.start).toHaveBeenCalledWith({ kind: 'unequip-base', itemId: id(84) })
  await actions.params.read({ kind: 'unequip-base', itemId: id(84) })
  expect(Object.fromEntries(new URL(String(fetched.mock.calls.at(-1)![0])).searchParams)).toEqual({ update: '1' })
})
it('offers close only for an empty equipment and exposes saved-transaction recovery', async () => {
  actions.canStart = true; actions.record = { phase: 'SIGNED', digest: 'saved-digest' }; actions.pending = true
  fetched.mockImplementation(async () => {
    const data = snapshot(); data.equipment.loadout.selection_count = '0'; data.equipment.loadout.selections = []; data.equipment.instances = []
    return ok(data)
  })
  await render(); await click('Close empty equipment binding')
  expect(actions.start).toHaveBeenCalledWith({ kind: 'close' })
  await actions.params.read({ kind: 'close' })
  expect(Object.fromEntries(new URL(String(fetched.mock.calls.at(-1)![0])).searchParams)).toEqual({})
  await click('Check saved transaction'); expect(actions.check).toHaveBeenCalled()
  expect(host.textContent).toContain('Retry same transaction')
})
it('does not merge a new revision source snapshot into an old equipment view', async () => {
  fetched.mockImplementation(async (url: string) => {
    const value = snapshot(); if (url.includes('source=1')) value.equipment.loadout.revision = '2'
    return ok(value)
  })
  await render(); expect(host.querySelector('[role=alert]')?.textContent).toContain('changed while loading')
  expect(host.textContent).not.toContain('Red hat')
})
it('new Soul navigation cannot display a late previous-Soul response', async () => {
  let finish!: (value: unknown) => void
  fetched.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await render(); fetched.mockResolvedValue({ ok: false, json: async () => ({ code: 'NATIVE_EQUIPMENT_INVALID' }) })
  await render(id(99)); await act(async () => finish(ok(snapshot()))); await settle()
  expect(host.textContent).not.toContain('Current equipment')
  expect(host.querySelector('[role=alert]')?.textContent).toContain('could not be verified')
})
it('requires explicit style/color and routes same-instance atomic replacement with the exact selected source page', async () => {
  actions.canStart = true; await render()
  await select(`Style for ${id(84)}`, 'red')
  expect(host.querySelector(`select[aria-label="Replacement for ${id(84)}"]`)).toBeNull()
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Replace component atomically')!.disabled).toBe(true)
  await select(`Color for ${id(84)}`, 'red')
  expect(host.textContent).toContain('Ready for slot 1 with atomic replacement')
  await click('Replace component atomically')
  const operation = { kind: 'equip', styleStart: 0, item: { kind: 'base', itemId: id(84), baseRegistryId: id(85), styleKey: 'red', swatchKey: 'red' },
    replaces: { kind: 'base', itemId: id(84) } }
  expect(actions.start).toHaveBeenCalledWith(operation)
  await actions.params.read(operation)
  expect(fetched.mock.calls.at(-1)![0]).toContain(`item=${id(84)}`)
  expect(fetched.mock.calls.at(-1)![0]).not.toContain('cursor=')
  await actions.params.read({ kind: 'unequip-base', itemId: id(84) })
  expect(fetched.mock.calls.at(-1)![0]).not.toContain('source=')
})
it('enables creation only for a source with current protocol, not merely a wallet connection', async () => {
  verified.equipment = null; verified.status = 'NOT_CREATED'; actions.canStart = true
  await render(); await click('Create Soul equipment')
  expect(actions.start).toHaveBeenCalledWith({ kind: 'create' })
  await actions.params.read({ kind: 'create' })
  expect(fetched.mock.calls.at(-1)![0]).toContain('source=1')
  verified.source.currentProtocol = false
  await click('Refresh'); await settle()
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Create Soul equipment')!.disabled).toBe(true)
  expect(host.textContent).toContain('current protocol and pricing snapshot')
})
it('equips an unlocked Base component into the first free slot through the original panel', async () => {
  actions.canStart = true
  verified.equipment.loadout.selections = [null]; verified.equipment.loadout.selection_count = '0'; verified.equipment.instances = []
  verified.inventory.objects[0].item.equip_lock = null; verified.inventory.objects[0].occupancy = 'UNLOCKED'
  await render(); await select(`Style for ${id(84)}`, 'red'); await select(`Color for ${id(84)}`, 'red')
  await click('Equip component')
  expect(actions.start).toHaveBeenCalledWith({ kind: 'equip', styleStart: 0,
    item: { kind: 'base', itemId: id(84), baseRegistryId: id(85), styleKey: 'red', swatchKey: 'red' } })
})
it('equips an admitted external instance without inventing a swatch input', async () => {
  actions.canStart = true
  const f = nativeEquipmentSourceFixture(); const e = f.addExternal()
  f.editLoadout(v => { v.selections = [null]; v.selection_count = '0' })
  verified = await e.read()
  await render(); await click('External items'); await click('Equip component')
  expect(host.querySelector(`select[aria-label="Color for ${e.itemId}"]`)).toBeNull()
  expect(actions.start).toHaveBeenCalledWith({ kind: 'equip', styleStart: 0,
    item: { kind: 'external', itemId: e.itemId, productId: e.productId } })
})
it('keeps a protected style unavailable instead of converting it to a public asset', async () => {
  actions.canStart = true; verified.source.styles[0].protected = true; await render()
  await select(`Style for ${id(84)}`, 'red')
  await select(`Color for ${id(84)}`, 'red')
  expect(host.textContent).toContain('protected-content equipment proof')
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Replace component atomically')!.disabled).toBe(true)
  expect(actions.start).not.toHaveBeenCalled()
})
it.each(['owned','selection'] as const)('uses verified protected %s proof in the original Wardrobe without claiming a decrypted preview', async kind => {
  actions.canStart = true; verified = await nativeEquipmentSealFixture().readBase()
  const protection = structuredClone(verified.source.protectedBase.entries[0].proof)
  verified.equipment.loadout.selections = [null]; verified.equipment.loadout.selection_count = '0'; verified.equipment.instances = []
  verified.inventory.objects[0].item.equip_lock = null; verified.inventory.objects[0].occupancy = 'UNLOCKED'
  if (kind === 'selection') { verified.source.definitions.item_assetization = false; verified.inventory.objects = [] }
  await render()
  if (kind === 'owned') {
    await select(`Style for ${id(84)}`,'red'); await select(`Color for ${id(84)}`,'red'); await click('Equip component')
    expect(actions.start).toHaveBeenCalledWith({ kind: 'equip',styleStart: 0,
      item: { kind: 'base',itemId: id(84),baseRegistryId: id(85),styleKey: 'red',swatchKey: 'red',protection } })
  } else {
    await select('Selection color for body/hat/red','red'); await click('Use Maker style')
    expect(actions.start).toHaveBeenCalledWith({ kind: 'select-base',styleStart: 0,
      selection: { baseRegistryId: id(85),partKey: 'body',itemKey: 'hat',styleKey: 'red',swatchKey: 'red',protection } })
  }
  expect(host.textContent).toContain('does not grant a decrypted preview'); expect(host.querySelector('img')).toBeNull()
})
it('does not merge source choices from a changed release', async () => {
  fetched.mockImplementation(async (url: string) => {
    const value = snapshot(); if (url.includes('source=1')) value.release.runtimeCallableDigest = 'other-release'
    return ok(value)
  })
  await render(); expect(host.textContent).toContain('changed while loading choices')
  expect(host.textContent).not.toContain('Red hat')
})
it('selects included Maker content without wallet inventory and requests the exact style page before signing', async () => {
  actions.canStart = true; verified.source.definitions.item_assetization = false
  verified.equipment.loadout.selections = [null]; verified.equipment.loadout.selection_count = '0'; verified.equipment.instances = []
  verified.inventory.objects = []
  await render(); expect(host.textContent).toContain('no independent wallet item required')
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Use Maker style')!.disabled).toBe(true)
  await select('Selection color for body/hat/red','red'); await click('Use Maker style')
  const operation = { kind: 'select-base', styleStart: 0,
    selection: { baseRegistryId: id(85), partKey: 'body', itemKey: 'hat', styleKey: 'red', swatchKey: 'red' } }
  expect(actions.start).toHaveBeenCalledWith(operation)
  await actions.params.read(operation)
  expect(fetched.mock.calls.at(-1)![0]).toContain('source=1&styleStart=0')
  expect(fetched.mock.calls.at(-1)![0]).not.toContain('inventory=')
})
it.each([0,1])('clears source class %s entitlement even when its Maker source cannot load', async sourceClass => {
  actions.canStart = true; verified.equipment.instances = []
  verified.equipment.loadout.selections[0].source_class = sourceClass
  verified.equipment.loadout.selections[0].access_subject = id(83)
  fetched.mockImplementation(async (url: string) => url.includes('source=1')
    ? { ok: false, json: async () => ({ code: 'NATIVE_EQUIPMENT_SOURCE_INVALID' }) } : ok(snapshot()))
  await render(); await click('Clear selection')
  expect(actions.start).toHaveBeenCalledWith({ kind: 'clear-selection', selectionIndex: '0' })
  await actions.params.read({ kind: 'clear-selection', selectionIndex: '0' })
  expect(fetched.mock.calls.at(-1)![0]).not.toContain('source=')
})
it('atomically replaces a Pack entitlement with included Maker content', async () => {
  actions.canStart = true; verified.source.definitions.item_assetization = false; verified.inventory.objects = []
  verified.equipment.instances = []; verified.equipment.loadout.selections[0].source_class = 1
  await render(); await select('Selection color for body/hat/red','red')
  expect(host.querySelector('select[aria-label="Selection replacement for body/hat/red"]')).toBeNull()
  await click('Replace with Maker style')
  expect(actions.start).toHaveBeenCalledWith({ kind: 'select-base', styleStart: 0,
    selection: { baseRegistryId: id(85), partKey: 'body', itemKey: 'hat', styleKey: 'red', swatchKey: 'red' },
    replaces: { kind: 'selection', selectionIndex: '0' } })
})
async function setupPack(empty = true) {
  const f = nativeEquipmentPackFixture()
  if (empty) f.editLoadout(v => {v.selections = [null];v.selection_count = '0'})
  verified = await f.readPack(); actions.canStart = true
  return f
}
const openPack = async () => { await click('Browse Pack access'); await click(`Open Pack 0x0000…00ca`) }
it.each([false, true])('exposes explicit attachment and prevents duplicate attachment: %s', async attached => {
  const f = await setupPack(); f.addOwnedColor(attached); verified = await f.readPack()
  await render(); await openPack()
  const button = [...host.querySelectorAll('button')].find(row => row.textContent === 'Attach Pack')!
  expect(button.disabled).toBe(attached)
  if (!attached) {
    await click('Attach Pack')
    expect(actions.start).toHaveBeenCalledWith({ kind: 'attach-pack', pack: { releaseId: id(202), passId: id(201) } })
    await actions.params.read({ kind: 'attach-pack', pack: { releaseId: id(202), passId: id(201) } })
    const query = new URL(String(fetched.mock.calls.at(-1)![0]), 'https://fixture.invalid').searchParams
    expect(Object.fromEntries(query)).toEqual({ update: '1', source: '1', pack: '1', packPass: id(201) })
  } else expect(actions.start).not.toHaveBeenCalled()
})
it('offers only Release-owned swatches for a Pack-self channel despite a same-key Base channel', async () => {
  const f = await setupPack(); f.addOwnedColor(true); verified = await f.readPack()
  await render(); await openPack()
  const label = `Pack color for ${id(202)}/body/pack-hat/snow`
  const control = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
  expect([...control.options].map(option => option.value)).toEqual(['', 'violet'])
  await select(label, 'violet'); await click('Use Pack style')
  expect(actions.start).toHaveBeenCalledWith({ kind: 'select-pack', selection: {
    baseRegistryId: id(85), releaseId: id(202), passId: id(201),
    partKey: 'body', itemKey: 'pack-hat', styleKey: 'snow', swatchKey: 'violet',
  } })
})
it('filters replacement controls by committed Part namespace instead of matching Part name alone', async () => {
  await setupPack(false)
  const pack = verified.source.pack.selected
  pack.styles[0].definition_sources.part = 2
  pack.definitionCommitment = Array(32).fill(7)
  verified.equipment.loadout.attached_pack_definitions = [{ release_id: id(202), definition_commitment: pack.definitionCommitment }]
  verified.equipment.loadout.definition_slots.push({ source_definition_id: id(202), part_key: 'body',
    profile_commitment: Array(32).fill(1), start: '1', capacity: '1' })
  verified.source.slots.push({ ...verified.source.slots[0], source_definition_id: id(202), slotStart: 1 })
  verified.equipment.loadout.selections.push({ ...verified.equipment.loadout.selections[0], selection_index: '1',
    source_class: 1, source_definition_id: id(202), access_subject: id(201) })
  await render(); await openPack()
  const control = host.querySelector(`select[aria-label="Pack replacement for ${id(202)}/body/pack-hat/snow"]`) as HTMLSelectElement
  expect(control).toBeNull()
  await select(`Pack color for ${id(202)}/body/pack-hat/snow`, 'gold')
  await click('Replace with Pack style')
  expect(actions.start).toHaveBeenCalledWith(expect.objectContaining({ kind: 'select-pack',
    replaces: { kind: 'selection', selectionIndex: '1' } }))
})
it.each([false,true])('selects Pack protected=%s using its own swatch, exact pass and style, without buying or decrypting', async protectedStyle => {
  await setupPack(); verified.source.pack.selected.styles[0].protected = protectedStyle
  await render(); await openPack()
  const use = [...host.querySelectorAll('button')].find(b => b.textContent === 'Use Pack style')!
  expect(use.disabled).toBe(true)
  await select(`Pack color for ${id(202)}/body/pack-hat/snow`,'gold'); expect(use.disabled).toBe(false)
  await click('Use Pack style')
  const operation = {kind:'select-pack',selection:{baseRegistryId:id(85),releaseId:id(202),passId:id(201),
    partKey:'body',itemKey:'pack-hat',styleKey:'snow',swatchKey:'gold'}}
  expect(actions.start).toHaveBeenCalledWith(operation)
  await actions.params.read(operation)
  const query = new URL(String(fetched.mock.calls.at(-1)![0]),'https://fixture.invalid').searchParams
  expect(Object.fromEntries(query)).toEqual({update:'1',source:'1',pack:'1',packPass:id(201),packPart:'body',packItem:'pack-hat',packStyle:'snow'})
  expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain('does not buy access or spend a completion quota')
})
it('atomically replaces an owned component with a Pack style in the same Soul', async () => {
  await setupPack(false); await render(); await openPack()
  await select(`Pack color for ${id(202)}/body/pack-hat/snow`,'snow')
  expect(host.querySelector(`select[aria-label="Pack replacement for ${id(202)}/body/pack-hat/snow"]`)).toBeNull()
  await click('Replace with Pack style')
  expect(actions.start).toHaveBeenCalledWith({kind:'select-pack',selection:{baseRegistryId:id(85),releaseId:id(202),passId:id(201),
    partKey:'body',itemKey:'pack-hat',styleKey:'snow',swatchKey:'snow'},replaces:{kind:'base',itemId:id(84)}})
})
it('keeps clear/removal available and refuses a revoked Pack selection', async () => {
  await setupPack(false); verified.source.pack.selected.admission.admission_state = 1
  await render(); await openPack(); await select(`Pack color for ${id(202)}/body/pack-hat/snow`,'snow')
  expect(host.textContent).toContain('not admitted to this Maker')
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Replace with Pack style')!.disabled).toBe(true)
  await click('Unequip component'); expect(actions.start).toHaveBeenCalledWith({kind:'unequip-base',itemId:id(84)})
})
it('preserves Pack page escapes after errors and does not mix cursors into exact pre-sign reads', async () => {
  await setupPack(); verified.source.pack.hasNextPage = true;verified.source.pack.cursor = 'cGFzcw=='
  verified.source.pack.selected.hasNextPage = true;verified.source.pack.selected.cursor = 'c3R5bGU='
  fetched.mockImplementation(async (url:string) => url.includes('packCursor=') || url.includes('packStyleCursor=')
    ? {ok:false,json:async()=>({code:'NATIVE_EQUIPMENT_PACK_INVALID'})} : ok(snapshot()))
  await render(); await click('Browse Pack access'); await click('Next Pack access page')
  expect(host.textContent).toContain('Pack source could not be verified'); await click('First Pack access page')
  await click('Open Pack 0x0000…00ca'); await click('Next Pack styles')
  expect(host.textContent).toContain('Pack source could not be verified'); expect(host.textContent).toContain('Current equipment')
  await click('First Pack styles'); expect(host.textContent).toContain('pack-hat')
  await click('Back to Pack access')
  expect(fetched.mock.calls.at(-1)![0]).not.toContain('packPass=')
  expect(fetched.mock.calls.at(-1)![0]).not.toContain('packStyleCursor=')
})
it.each(['release', 'soul'])('does not show a Pack choice from a different %s snapshot', async mismatch => {
  await setupPack()
  fetched.mockImplementation(async (url:string) => {
    const s = snapshot(); if(url.includes('pack=1')) {
      if (mismatch === 'soul') s.soulId = id(99)
      else s.release.runtimeCallableDigest = 'different'
    }
    return ok(s)
  })
  await render(); await click('Browse Pack access')
  expect(host.textContent).toContain('changed while loading Pack choices')
  expect(host.textContent).not.toContain('Open Pack');expect(actions.start).not.toHaveBeenCalled()
})
