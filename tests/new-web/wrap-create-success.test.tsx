// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import WrapSuccessPage from '../../web/app/wrap-link/personal/success/page'

const m = vi.hoisted(() => ({ reset: vi.fn(), replace: vi.fn(), start: vi.fn() }))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ replace: m.replace, push: m.replace }) }))
vi.mock('../../web/node_modules/next/link.js', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('../../web/components/providers/wrap-provider', () => ({ wrapSteps: [{label:'Select NFT'}, {label:'Soul Layers'}, {label:'Preview & Sign'}, {label:'Done'}], useWrap: () => ({ isHydrated: true, reset: m.reset,
  publishResult: { txDigest: 'mint-digest', soulOnChainId: 'soul-id', originRef: 'sha256:source', provenanceKind: 'personal-join', authoringCompletionKey: 'completion-key' } }) }))
vi.mock('../../web/lib/hooks/use-wrap-publish', () => ({ useWrapPublish: () => ({ status: 'idle', loadingRecovery: false,
  suiWallet: { address: 'creator' }, error: null, startAnother: m.start }) }))
let root: ReturnType<typeof createRoot>, host: HTMLDivElement
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  m.reset.mockReset(); m.replace.mockReset(); m.start.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<WrapSuccessPage />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
it.each([false, true])('Create Another only resets the original form after confirmed archival (%s)', async accepted => {
  m.start.mockResolvedValue(accepted)
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Wrap Another NFT')!
  expect(button).toBeTruthy()
  await act(async () => button.click())
  expect(m.start).toHaveBeenCalledWith('mint-digest', 'completion-key')
  if (accepted) { expect(m.reset).toHaveBeenCalledOnce(); expect(m.replace).toHaveBeenCalledWith('/wrap-link/personal') }
  else { expect(m.reset).not.toHaveBeenCalled(); expect(m.replace).not.toHaveBeenCalled() }
})
