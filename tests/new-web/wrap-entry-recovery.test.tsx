// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Select from '../../web/app/wrap-link/personal/page'
vi.mock('../../web/components/souls/authoring-recovery-import', () => ({ AuthoringRecoveryImport: () => null }))
const m = vi.hoisted(() => ({ push: vi.fn(), state: { suiWallet: { address: 'creator' }, loadingRecovery: false,
  error: null as string | null, recovery: { manifest: { request: { collection: null, mints: [{ kind: 'JOINED' }] } } } as any },
  ctx: { selectedNft: null, setSelectedNft: vi.fn() } }))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ push: m.push }) }))
vi.mock('../../web/node_modules/next/link.js', () => ({ default: ({ children, ...p }: any) => <a {...p}>{children}</a> }))
vi.mock('../../web/components/providers/wrap-provider', () => ({ useWrap: () => m.ctx, wrapSteps: [] }))
vi.mock('../../web/lib/hooks/use-wrap-publish', () => ({ useWrapPublish: () => m.state }))
vi.mock('../../web/lib/hooks/use-kiosk-nfts', () => ({ useKioskNfts: () => ({ data: [], isLoading: false }) }))
let root: ReturnType<typeof createRoot>, host: HTMLDivElement
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  m.push.mockReset(); m.state.loadingRecovery = false; m.state.error = null
  m.state.recovery = { manifest: { request: { collection: null, mints: [{ kind: 'JOINED' }] } } }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<Select />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const next = () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Continue'))!
it('offers saved Wrap despite empty wallet discovery and no source/files selected', async () => {
  expect(host.querySelector('a[href="/wrap-link/personal/preview"]')?.textContent).toBe('Open Saved Wrap')
  await act(async () => next().click())
  expect(m.push).toHaveBeenCalledWith('/wrap-link/personal/preview')
  expect(host.textContent).not.toContain('Please select an NFT')
})
it.each(['loading', 'read-error'])('does not start another selection while recovery is %s', async state => {
  m.state.loadingRecovery = state === 'loading'; m.state.error = state === 'read-error' ? 'Storage unavailable' : null
  await act(async () => root.render(<Select />))
  expect(next().disabled).toBe(true)
  await act(async () => next().click()); expect(m.push).not.toHaveBeenCalled()
})
it.each([['ORDINARY', '/create/gas'], ['IMPORTED', '/import/gas']])('routes %s recovery to its own entry', async (kind, href) => {
  m.state.recovery.manifest.request.mints[0].kind = kind
  await act(async () => root.render(<Select />))
  expect(host.querySelector(`a[href="${href}"]`)?.textContent).toBe('Open Saved Creation')
})
