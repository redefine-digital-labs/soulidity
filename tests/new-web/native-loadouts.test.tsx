// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NamedLoadout } from '../../web/lib/animacraft/named-loadout'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'

const m = vi.hoisted(() => ({ loadouts: null as any, params: null as any, query: null as any,
  equipmentActions: { pending: false, busy: false, canStart: false, record: null, error: null, start: vi.fn() } }))
vi.mock('../../web/lib/hooks/use-native-loadouts', () => ({ useNativeLoadouts: (params: any) => { m.params = params; return m.loadouts } }))
vi.mock('../../web/lib/hooks/use-native-equipment-actions', () => ({ useNativeEquipmentActions: () => m.equipmentActions }))
vi.mock('../../web/components/souls/native-original-preview', () => ({ NativeOriginalPreview: () => null }))
vi.mock('../../web/components/souls/native-equipment-preview', () => ({ NativeEquipmentPreview: () => null }))
// Trading has separate panel/recovery suites; this suite exercises loadouts.
vi.mock('../../web/components/souls/equipment-market-panel', () => ({ EquipmentMarketPanel: () => null }))
vi.mock('../../web/components/souls/equipment-market-recovery', () => ({ EquipmentMarketRecovery: () => null }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => m.query }))
import { NativeLoadouts } from '../../web/components/souls/native-loadouts'
import { NativeWardrobePanel } from '../../web/components/souls/native-wardrobe'

const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
let host: HTMLDivElement, root: Root, snapshot: any
const record = (): NamedLoadout => ({ id: '10000000-0000-4000-8000-000000000000', name: 'Evening', version: 1,
  selectionCount: 4, slotCount: 5, createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z',
  content: { schema: 1, soulId: id(12), stateId: id(13), rootId: id(14), rootVersion: '1', rootContentCommitment: '1'.repeat(64),
    definitionRegistryId: id(15), packRegistryId: id(16), baseRegistryId: id(17), makerAccessPassId: id(18),
    capturedOwner: id(1), capturedOwnershipEpoch: '0', capturedEquipmentId: id(19), capturedEquipmentRevision: '4',
    slots: [null, ...(['base-selection', 'pack-selection', 'base-item', 'external-item'] as const).map((kind, i) => ({
      kind, partKey: 'hat', itemKey: `item-${i}`, styleKey: `style-${i}`, swatchKey: i === 0 ? null : 'red',
      sourceDefinitionId: id(40 + i), accessSubject: id(50 + i), assetContentCommitment: '2'.repeat(64),
      protected: i === 1, sealBindingCommitment: '3'.repeat(64),
    }))] } })
function index(saved: NamedLoadout[] = []) {
  return { revision: '1',
    loadouts: saved.map(({ content: _content, ...summary }) => summary) }
}
beforeEach(async () => {
  snapshot = await nativeEquipmentSourceFixture().readBase()
  m.loadouts = { index: index(), selected: null, loading: false, busy: false, error: null, pending: false,
    privacyKey: 'session', writesEnabled: true, unlocked: true, endEpoch: null, notice: null, approval: null, canExport: false,
    connected: false, historicalScopes: [], historicalResult: null, historyBusy: false, queryHistory: vi.fn(),
    unlock: vi.fn(), renew: vi.fn(), query: vi.fn(), rebase: vi.fn(), approve: vi.fn(), exportRecovery: vi.fn(), importRecovery: vi.fn(),
    canSave: true, canManage: true, save: vi.fn(), rename: vi.fn(), remove: vi.fn(), view: vi.fn(), refresh: vi.fn(), retry: vi.fn(), dismiss: vi.fn() }
  m.params = null; m.query = { data: snapshot, isPending: false, isFetching: false, isError: false, refetch: vi.fn() }
  m.equipmentActions.pending = false; m.equipmentActions.busy = false; m.equipmentActions.start.mockClear()
  m.equipmentActions.canStart = false
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
const render = async (blocked = false) => { await act(async () => root.render(<NativeLoadouts snapshot={snapshot} blocked={blocked}
  canApply={m.equipmentActions.canStart} onApply={content => m.equipmentActions.start({kind:'apply-loadout',content})} />)) }
const button = (name: string, scope: ParentNode = host) => [...scope.querySelectorAll('button')].find(b => b.textContent === name) as HTMLButtonElement
const click = async (name: string, scope: ParentNode = host) => { await act(async () => button(name, scope).click()) }
async function input(label: string, value: string) {
  const field = [...host.querySelectorAll('label')].find(x => x.textContent === label)!.querySelector('input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('saves the normalized name using current snapshot without applying equipment', async () => {
  await render(); await input('Loadout name', '  Morning  '); await click('Save current loadout')
  expect(m.loadouts.save).toHaveBeenCalledWith('Morning')
  expect(m.params).toEqual({ snapshot, blocked: false })
  expect(host.textContent).toContain('Saving does not change equipment')
  expect([...host.querySelectorAll('button')].some(b => /apply/i.test(b.textContent ?? ''))).toBe(false)
  expect(m.equipmentActions.start).not.toHaveBeenCalled()
})
it('shows a verified empty index but never treats missing or failed access as an empty library', async () => {
  await render(); expect(host.textContent).toContain('No saved loadouts yet.')
  m.loadouts.index = null; m.loadouts.loading = true; await render()
  expect(host.textContent).toContain('Loading saved loadouts'); expect(host.textContent).not.toContain('No saved loadouts yet.')
  m.loadouts.loading = false; m.loadouts.error = 'Loadouts could not be verified.'; await render()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('could not be verified')
  expect(host.textContent).not.toContain('No saved loadouts yet.')
  await click('Refresh loadouts'); expect(m.loadouts.refresh).toHaveBeenCalledOnce()
  m.loadouts.error = null; m.loadouts.index = index(); await render()
  expect(host.querySelector('[role=alert]')).toBeNull(); expect(host.textContent).toContain('No saved loadouts yet.')
})
it('keeps names and details private when not signed in as the current owner', async () => {
  m.loadouts.index = index([record()]); m.loadouts.selected = record(); m.loadouts.canManage = false; m.loadouts.canSave = false
  await render()
  expect(host.textContent).toContain("Connect the current Soul owner's wallet")
  expect(host.textContent).not.toContain('Evening'); expect(host.textContent).not.toContain('No saved loadouts yet.')
  expect(host.querySelector('input')).toBeNull(); expect(button('Delete')).toBeUndefined()
})
it('views exact saved slots including null, kinds, styles, swatches and IDs without fetching content', async () => {
  const fetched = vi.fn(); vi.stubGlobal('fetch', fetched)
  try {
    m.loadouts.index = index([record()]); await render(); await click('View')
    expect(m.loadouts.view).toHaveBeenCalledWith(record().id)
    m.loadouts.selected = record(); await render()
    const detail = host.querySelector('[aria-label="Saved loadout details"]')!
    expect(detail.querySelectorAll('li')).toHaveLength(5)
    for (const text of ['Slot 1 · Empty', 'Base selection', 'Pack selection · Protected', 'Base item', 'External item',
      'Style style-0 · Swatch none', 'Style style-1 · Swatch red', 'Saved equipment revision 4']) expect(detail.textContent).toContain(text)
    expect(detail.querySelector(`[title="${id(50)}"]`)?.textContent).toContain('0x0000…0032')
    expect(detail.querySelectorAll('img,audio,video,iframe,a')).toHaveLength(0)
    expect(fetched).not.toHaveBeenCalled()
  } finally { vi.unstubAllGlobals() }
})
it('applies the selected frozen content through the equipment action, never the metadata store',async () => {
  const saved=record();m.loadouts.index=index([saved]);m.loadouts.selected=saved;m.equipmentActions.canStart=true
  await render();await click('Apply to Soul')
  expect(m.equipmentActions.start).toHaveBeenCalledOnce()
  const operation=m.equipmentActions.start.mock.calls[0][0]
  expect(operation).toEqual({kind:'apply-loadout',content:saved.content})
  expect(operation.content).not.toBe(saved.content)
  saved.content.slots[0]={...saved.content.slots[1]!}
  expect(operation.content.slots[0]).toBeNull()
  expect(m.loadouts.save).not.toHaveBeenCalled();expect(m.loadouts.remove).not.toHaveBeenCalled()
})
it.each(['equipment-pending','metadata-pending','unaccepted','listed','no-equipment'])(
  'does not apply when %s',async state => {
    m.loadouts.index=index([record()]);m.loadouts.selected=record();m.equipmentActions.canStart=true
    if(state==='metadata-pending')m.loadouts.pending=true
    if(state==='unaccepted')m.equipmentActions.canStart=false
    if(state==='listed')snapshot.listed=true
    if(state==='no-equipment')snapshot.equipment=null
    await render(state==='equipment-pending')
    expect(button('Apply to Soul').disabled).toBe(true);await click('Apply to Soul')
    expect(m.equipmentActions.start).not.toHaveBeenCalled()
  })
it('connects the real Wardrobe Loadout apply button to its existing equipment WAL',async () => {
  m.loadouts.index=index([record()]);m.loadouts.selected=record();m.equipmentActions.canStart=true
  await act(async()=>root.render(<NativeWardrobePanel soulObjectId={snapshot.soulId} stateObjectId={snapshot.stateId}/>))
  await click('Apply to Soul')
  expect(m.equipmentActions.start).toHaveBeenCalledWith({kind:'apply-loadout',content:record().content})
})
it('renames inline only after explicit submission and deletes the exact saved row', async () => {
  m.loadouts.index = index([record()]); await render(); await click('Rename')
  expect(m.loadouts.rename).not.toHaveBeenCalled()
  await input('New name for Evening', '  Night  ')
  expect(m.loadouts.rename).not.toHaveBeenCalled()
  await click('Save name'); expect(m.loadouts.rename).toHaveBeenCalledWith(record().id, 'Night')
  await click('Cancel rename'); expect(host.querySelectorAll('input:not([type=file])')).toHaveLength(1)
  await click('Delete'); expect(m.loadouts.remove).toHaveBeenCalledWith(record().id)
})
it.each(['pending', 'busy'])('blocks new mutations while %s and retains recovery state', async flag => {
  m.loadouts.index = index([record()]); await render(); await input('Loadout name', 'Next'); await click('Rename')
  await input('New name for Evening', 'Changed'); m.loadouts[flag] = true; await render()
  for (const label of ['Save current loadout', 'Rename', 'Delete', 'Save name', 'View']) expect(button(label).disabled).toBe(true)
  if (flag === 'pending') {
    expect(button('Refresh loadouts')).toBeUndefined(); await click('Retry same request')
    expect(m.loadouts.retry).toHaveBeenCalledOnce()
  } else expect(host.textContent).toContain('Updating loadouts…')
  expect(m.loadouts.save).not.toHaveBeenCalled(); expect(m.loadouts.rename).not.toHaveBeenCalled(); expect(m.loadouts.remove).not.toHaveBeenCalled()
})
it('blocks saved mutations during an equipment operation even if stale hook flags would allow them', async () => {
  m.loadouts.index = index([record()]); await render(); await input('Loadout name', 'Next'); await render(true)
  for (const label of ['Save current loadout', 'Rename', 'Delete']) expect(button(label).disabled).toBe(true)
  expect(m.params.blocked).toBe(true); expect(host.textContent).toContain('Wait for the current equipment operation')
})
it('can query the exact pending request while equipment blocks writes', async () => {
  m.loadouts.pending = true; m.loadouts.canSave = false; m.loadouts.writesEnabled = false
  await render(true); expect(button('Retry same request').disabled).toBe(true)
  await click('Query original transactions'); expect(m.loadouts.query).toHaveBeenCalledOnce()
  expect(button('Save current loadout').disabled).toBe(true)
})
it('opens and cancels the stop-retrying explanation without dismissing or mutating anything', async () => {
  m.loadouts.pending = true
  await render()
  expect(button('Confirm stop retrying')).toBeUndefined()
  expect(m.loadouts.dismiss).not.toHaveBeenCalled()
  await click('Stop retrying request')
  expect(host.textContent).toContain('stopping retries does not delete saved loadouts or change equipment.')
  expect(m.loadouts.dismiss).not.toHaveBeenCalled()
  await click('Keep retrying')
  expect(button('Confirm stop retrying')).toBeUndefined()
  expect(m.loadouts.dismiss).not.toHaveBeenCalled()
  expect(m.loadouts.retry).not.toHaveBeenCalled()
  expect(m.loadouts.save).not.toHaveBeenCalled()
  expect(m.loadouts.remove).not.toHaveBeenCalled()
  expect(m.equipmentActions.start).not.toHaveBeenCalled()
  await click('Retry same request'); expect(m.loadouts.retry).toHaveBeenCalledOnce()
})
it('dismisses exactly once only after confirmation, even while equipment blocks new intents', async () => {
  m.loadouts.pending = true
  let finish!: () => void
  m.loadouts.dismiss.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
  await render(true)
  expect(button('Stop retrying request').disabled).toBe(false)
  await click('Stop retrying request')
  const confirm = button('Confirm stop retrying')
  expect(confirm.disabled).toBe(false)
  await act(async () => { confirm.click(); confirm.click() })
  expect(m.loadouts.dismiss).toHaveBeenCalledOnce()
  expect(button('Stop retrying request').disabled).toBe(true)
  expect(button('Retry same request').disabled).toBe(true)
  await act(async () => finish())
  expect(button('Confirm stop retrying')).toBeUndefined()
  expect(m.loadouts.save).not.toHaveBeenCalled()
  expect(m.loadouts.rename).not.toHaveBeenCalled()
  expect(m.loadouts.remove).not.toHaveBeenCalled()
  expect(m.equipmentActions.start).not.toHaveBeenCalled()
})
it.each(['busy', 'canManage'])('disables pending recovery when %s blocks owner access', async flag => {
  m.loadouts.pending = true
  await render(); await click('Stop retrying request')
  m.loadouts[flag] = flag === 'busy'
  await render()
  for (const label of ['Retry same request', 'Stop retrying request', 'Confirm stop retrying', 'Keep retrying']) {
    expect(button(label).disabled).toBe(true)
    await click(label)
  }
  expect(m.loadouts.dismiss).not.toHaveBeenCalled()
  expect(m.loadouts.retry).not.toHaveBeenCalled()
})
it('requires fresh confirmation for a later pending request', async () => {
  m.loadouts.pending = true
  await render(); await click('Stop retrying request')
  m.loadouts.pending = false; await render()
  m.loadouts.pending = true; await render()
  expect(button('Confirm stop retrying')).toBeUndefined()
  expect(m.loadouts.dismiss).not.toHaveBeenCalled()
})
it('explains absent equipment and a full saved library without pretending a new save is available', async () => {
  snapshot.equipment = null; m.loadouts.canSave = false
  await render(); expect(host.textContent).toContain('Create Soul equipment before saving')
  expect(button('Save current loadout').disabled).toBe(true)
  m.loadouts.index = index(Array.from({ length: 12 }, (_, i) => ({ ...record(), id: `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000` })))
  await render(); expect(host.textContent).toContain('You can save up to 12 loadouts.')
})
it('keeps invalid or failed names visible with an error and does not issue a mutation for invalid input', async () => {
  await render(); await input('Loadout name', 'x'.repeat(81)); await click('Save current loadout')
  expect(m.loadouts.save).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')?.textContent).toContain('1–80')
  m.loadouts.save.mockRejectedValue(new Error('Save failed safely.'))
  await input('Loadout name', 'Retry me'); await click('Save current loadout')
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Save failed safely.')
  expect((host.querySelector('input:not([type=file])') as HTMLInputElement).value).toBe('Retry me')
})
it('resets inline edits on owner/epoch scope change and hides stale selected details', async () => {
  m.loadouts.index = index([record()]); m.loadouts.selected = record(); await render(); await click('Rename')
  await input('Loadout name', 'old scope'); snapshot = { ...snapshot, owner: id(90), ownershipEpoch: '99' }
  m.loadouts.index = null; m.loadouts.selected = null; m.loadouts.canManage = false; await render()
  expect(host.textContent).not.toContain('Evening'); expect(host.querySelector('input')).toBeNull()
  m.loadouts.canManage = true; m.loadouts.index = index(); await render()
  expect((host.querySelector('input') as HTMLInputElement).value).toBe('')
})
it('requires explicit private unlock and does not show an empty library before it', async () => {
  m.loadouts.index = null; m.loadouts.unlocked = false; m.loadouts.canSave = false
  await render()
  expect(m.loadouts.unlock).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('No saved loadouts yet.')
  expect(button('Save current loadout').disabled).toBe(true)
  await click('Unlock private loadouts'); expect(m.loadouts.unlock).toHaveBeenCalledOnce()
})
it('blocks all private mutations behind the actual write gate while preserving View and query', async () => {
  m.loadouts.index = index([record()]); m.loadouts.writesEnabled = false
  await render(); await input('Loadout name', 'Forbidden')
  for (const name of ['Save current loadout', 'Rename', 'Delete', 'Renew encrypted storage']) {
    expect(button(name).disabled).toBe(true); await click(name)
  }
  await click('View'); expect(m.loadouts.view).toHaveBeenCalledWith(record().id)
  expect(m.loadouts.save).not.toHaveBeenCalled(); expect(m.loadouts.renew).not.toHaveBeenCalled()
})
it('shows exact approval copy and does not approve automatically while busy', async () => {
  m.loadouts.busy = true; m.loadouts.approval = { title: 'Approve encrypted library storage', lines: ['Two transactions, total gas 0.1 SUI.'] }
  await render()
  expect(host.querySelector('[role=dialog]')?.textContent).toContain('total gas 0.1 SUI')
  expect(m.loadouts.approve).not.toHaveBeenCalled()
  await click('Approve and continue'); expect(m.loadouts.approve).toHaveBeenCalledWith(true)
  await click('Decline'); expect(m.loadouts.approve).toHaveBeenCalledWith(false)
})
it('asks before rebase and explains that earlier paid ciphertext is retained', async () => {
  m.loadouts.pending = true; await render(); await click('Rebase on current library')
  expect(m.loadouts.rebase).not.toHaveBeenCalled(); expect(host.textContent).toContain('earlier encrypted request and paid receipts are retained')
  await click('Cancel rebase'); expect(m.loadouts.rebase).not.toHaveBeenCalled()
  await click('Rebase on current library'); await click('Confirm rebase'); expect(m.loadouts.rebase).toHaveBeenCalledOnce()
})
it('shows storage expiry and explicitly renews without touching equipment', async () => {
  m.loadouts.endEpoch = 200; await render()
  expect(host.textContent).toContain('expires at Walrus epoch 200')
  expect(m.loadouts.renew).not.toHaveBeenCalled(); await click('Renew encrypted storage')
  expect(m.loadouts.renew).toHaveBeenCalledOnce(); expect(m.equipmentActions.start).not.toHaveBeenCalled()
})
it('drops typed private names when the wallet client/session changes without changing Soul IDs', async () => {
  m.loadouts.index = index([record()]); await render(); await input('Loadout name', 'Private draft'); await click('Rename')
  await input('New name for Evening', 'Other secret'); m.loadouts.privacyKey = 'new-wallet'; await render()
  expect((host.querySelector('input:not([type=file])') as HTMLInputElement).value).toBe('')
  expect(button('Save name')).toBeUndefined()
})
it.each([false, true])('routes the encrypted file to pending import or current-backup unlock (%s)', async backupOnly => {
  await render()
  const file = { size: 50, text: vi.fn(async () => '{"encrypted":"only"}') }
  const field = host.querySelectorAll<HTMLInputElement>('input[type=file]')[backupOnly ? 1 : 0]
  Object.defineProperty(field, 'files', { configurable: true, value: [file] })
  await act(async () => field.dispatchEvent(new Event('change', { bubbles: true })))
  expect(m.loadouts.importRecovery).toHaveBeenCalledWith('{"encrypted":"only"}', backupOnly)
  expect(m.loadouts.save).not.toHaveBeenCalled()
})
it('rejects oversized encrypted imports before reading their bytes', async () => {
  await render(); const file = { size: 31 * 1024 * 1024, text: vi.fn() }, field = host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(field, 'files', { configurable: true, value: [file] })
  await act(async () => field.dispatchEvent(new Event('change', { bubbles: true })))
  expect(file.text).not.toHaveBeenCalled(); expect(m.loadouts.importRecovery).not.toHaveBeenCalled()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('too large')
})
it('retains public previous-ownership query controls for a connected former owner without exposing library names', async () => {
  m.loadouts.canManage = false; m.loadouts.connected = true; m.loadouts.index = index([record()]); m.loadouts.selected = record()
  const scope = { soulId: snapshot.soulId, stateId: snapshot.stateId, owner: id(9), ownershipEpoch: '7' }
  m.loadouts.historicalScopes = [scope]; await render()
  expect(host.textContent).not.toContain('Evening'); expect(button('Unlock private loadouts')).toBeUndefined()
  expect(m.loadouts.queryHistory).not.toHaveBeenCalled()
  await click('Query ownership epoch 7'); expect(m.loadouts.queryHistory).toHaveBeenCalledWith(scope)
  expect(m.loadouts.retry).not.toHaveBeenCalled(); expect(m.loadouts.unlock).not.toHaveBeenCalled()
})
it('historical backup selection is query-only and displays the public result', async () => {
  m.loadouts.connected = true; m.loadouts.canManage = false; m.loadouts.historicalResult = 'Library transaction: SUCCEEDED · digest'
  await render(); const file = { size: 20, text: vi.fn(async () => '{"encrypted":"history"}') }
  const field = host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(field, 'files', { configurable: true, value: [file] })
  await act(async () => field.dispatchEvent(new Event('change', { bubbles: true })))
  expect(m.loadouts.queryHistory).toHaveBeenCalledWith('{"encrypted":"history"}')
  expect(m.loadouts.importRecovery).not.toHaveBeenCalled(); expect(host.textContent).toContain('Library transaction: SUCCEEDED')
})
it('mounts inside the real verified Wardrobe and forwards its pending/busy interlock, but not on failed equipment reads', async () => {
  m.equipmentActions.pending = true
  await act(async () => root.render(<NativeWardrobePanel soulObjectId={snapshot.soulId} stateObjectId={snapshot.stateId} />))
  expect(host.querySelector('[aria-label="Named loadouts"]')).not.toBeNull()
  expect(m.params).toEqual({ snapshot, blocked: true })
  expect(host.textContent).toContain('Current equipment · revision 1')
  m.query.isError = true; m.query.error = new Error('Equipment verification failed.')
  await act(async () => root.render(<NativeWardrobePanel soulObjectId={snapshot.soulId} stateObjectId={snapshot.stateId} />))
  expect(host.querySelector('[aria-label="Named loadouts"]')).toBeNull()
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Equipment verification failed')
})
