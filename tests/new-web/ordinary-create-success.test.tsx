// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CreateSuccessPage from '../../web/app/create/success/page'

const m = vi.hoisted(() => ({ reset: vi.fn(), replace: vi.fn(), start: vi.fn() }))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ replace: m.replace }) }))
vi.mock('../../web/node_modules/next/link.js', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('../../web/components/providers/create-soul-provider', () => ({ useCreateSoul: () => ({ isHydrated: true, reset: m.reset,
  publishResult: { txDigest: 'mint-digest', soulOnChainId: 'soul-id', listingStatus: 'unlisted', authoringCompletionKey: 'completion-key' } }) }))
vi.mock('../../web/lib/hooks/use-publish', () => ({ usePublish: () => ({ status: 'idle', loadingRecovery: false,
  suiWallet: { address: 'creator' }, error: null, startAnother: m.start }) }))
let root: ReturnType<typeof createRoot>, host: HTMLDivElement
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  m.reset.mockReset(); m.replace.mockReset(); m.start.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<CreateSuccessPage />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
it.each([false, true])('Create Another only resets the original form after confirmed archival (%s)', async accepted => {
  m.start.mockResolvedValue(accepted)
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Create Another Soul')!
  expect(button).toBeTruthy()
  await act(async () => button.click())
  expect(m.start).toHaveBeenCalledWith('mint-digest', 'completion-key')
  if (accepted) { expect(m.reset).toHaveBeenCalledOnce(); expect(m.replace).toHaveBeenCalledWith('/create') }
  else { expect(m.reset).not.toHaveBeenCalled(); expect(m.replace).not.toHaveBeenCalled() }
})
