// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { toHex } from '@mysten/sui/utils'
import { NativeEquipmentPreview } from '../../web/components/souls/native-equipment-preview'
import { nativeEquipmentSourceFixture } from './fixtures/native-equipment-source'
const m = vi.hoisted(() => ({ account: { address: '' }, client: { grpc: {} }, wallet: {},
  read: vi.fn(), render: vi.fn(), protectedConfig: vi.fn(), layer: vi.fn(), sign: vi.fn() }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentAccount: () => m.account, useSuiClient: () => m.client,
  useCurrentWallet: () => ({ currentWallet: m.wallet }), useSignPersonalMessage: () => ({ mutateAsync: m.sign }) }))
vi.mock('../../web/lib/animacraft/browser-native-artwork', () => ({ getBrowserNativeArtworkConfig: () => ({ target: {} }),
  getBrowserNativeProtectedArtworkConfig: m.protectedConfig, readBrowserNativeEquipmentRenderTarget: m.read,
  readBrowserNativeEquipmentReadTarget: m.layer }))
vi.mock('../../web/lib/animacraft/native-equipment-render-client', () => ({ renderNativeEquipmentScene: m.render }))
let root: Root, host: HTMLDivElement, snapshot: any, scene: any
const revoke = vi.fn(), create = vi.fn()
beforeEach(async () => {
  vi.clearAllMocks(); snapshot = await nativeEquipmentSourceFixture().readSource()
  m.account = { address: snapshot.owner }
  const loadout = snapshot.equipment.loadout
  scene = { status: 'AVAILABLE', soulId: snapshot.soulId, stateId: snapshot.stateId, owner: snapshot.owner,
    ownershipEpoch: snapshot.ownershipEpoch, snapshot: { loadoutId: loadout.id, loadoutRevision: loadout.revision,
      loadoutCommitment: toHex(new Uint8Array(loadout.commitment)) } }
  m.read.mockResolvedValue(scene); m.render.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  create.mockReturnValue('blob:equipment'); class PreviewURL extends URL { static createObjectURL = create; static revokeObjectURL = revoke }
  vi.stubGlobal('URL', PreviewURL); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function show() { await act(async () => root.render(<NativeEquipmentPreview snapshot={snapshot} />)) }
async function click(label = 'View current appearance') { await act(async () => {
  [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click()
}) }
it('renders current equipment on request without loading historical artwork or Seal config for public layers', async () => {
  await show(); expect(m.read).not.toHaveBeenCalled(); await click()
  expect(host.querySelector('img')?.alt).toBe('Current equipped Soul appearance')
  expect(m.render).toHaveBeenCalledWith(scene, expect.objectContaining({ owner: snapshot.owner }))
  expect(m.protectedConfig).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled()
})
it('clears an old image on equipment revision change and keeps an empty loadout empty', async () => {
  await show(); await click(); expect(host.querySelector('img')).not.toBeNull()
  snapshot = structuredClone(snapshot); snapshot.equipment.loadout.revision = '99'
  await show(); expect(host.querySelector('img')).toBeNull(); expect(revoke).toHaveBeenCalledWith('blob:equipment')
  m.read.mockResolvedValue({ ...scene, status: 'EMPTY', snapshot: { ...scene.snapshot, loadoutRevision: '99' } })
  await click(); expect(host.textContent).toContain('current appearance is empty')
  expect(host.querySelector('img')).toBeNull(); expect(m.render).toHaveBeenCalledTimes(1)
})
it.each(['owner', 'stateId', 'ownershipEpoch'])('rejects a mismatched %s without rendering', async key => {
  m.read.mockResolvedValue({ ...scene, [key]: 'changed' }); await show(); await click()
  expect(host.textContent).toContain('Equipment changed'); expect(m.render).not.toHaveBeenCalled()
})
it('rejects a different loadout commitment', async () => {
  m.read.mockResolvedValue({ ...scene, snapshot: { ...scene.snapshot, loadoutCommitment: 'bad' } })
  await show(); await click(); expect(m.render).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')).not.toBeNull()
})
it('cancels a stalled render and ignores its late image', async () => {
  let resolve!: (blob: Blob) => void
  m.render.mockReturnValueOnce(new Promise<Blob>(yes => { resolve = yes }))
  await show(); await click(); await click('Cancel equipment preview')
  await act(async () => resolve(new Blob(['late'], { type: 'image/png' })))
  expect(create).not.toHaveBeenCalled(); expect(host.textContent).toContain('Read cancelled')
})
it('clears a rendered image when the wallet changes without silently requesting another signature', async () => {
  await show(); await click(); m.account = { address: 'other' }; await show()
  expect(host.querySelector('img')).toBeNull(); expect(revoke).toHaveBeenCalled()
  m.account = { address: snapshot.owner }; await show(); expect(host.querySelector('img')).toBeNull()
  expect(m.read).toHaveBeenCalledTimes(1); expect(m.sign).not.toHaveBeenCalled()
})
