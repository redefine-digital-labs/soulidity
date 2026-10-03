// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import Configure from '../../web/app/wrap-link/personal/configure/page'
const m = vi.hoisted(() => ({ push: vi.fn(), ctx: { selectedNft: { objectId: 'source', name: 'NFT', imageUrl: null },
  charFile: null as File | null, memoryFile: null as File | null, skillsFile: null, royalty: 500,
  setSelectedNft: vi.fn(), setCharFile: vi.fn(), setMemoryFile: vi.fn(), setSkillsFile: vi.fn() } }))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ push: m.push, replace: vi.fn() }) }))
vi.mock('../../web/node_modules/next/link.js', () => ({ default: ({ children, ...p }: any) => <a {...p}>{children}</a> }))
vi.mock('../../web/components/providers/wrap-provider', () => ({ useWrap: () => m.ctx, wrapSteps: [] }))
vi.mock('../../web/lib/hooks/use-wallet-sign', () => ({ useWalletSign: () => ({ suiWallet: { address: 'creator' } }) }))
vi.mock('../../web/lib/hooks/use-kiosk-nfts', () => ({ useKioskNfts: () => ({ data: [m.ctx.selectedNft] }) }))
it('removes the corresponding stale required error once the original form receives its file', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try {
    await act(async () => root.render(<Configure />))
    const next = () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Continue'))!
    await act(async () => next().click())
    expect(host.textContent).toContain('Soul Character file is required'); expect(m.push).not.toHaveBeenCalled()
    m.ctx.charFile = new File(['soul'], 'SOUL.md')
    await act(async () => root.render(<Configure />))
    expect(host.textContent).not.toContain('Soul Character file is required')
    expect(host.textContent).toContain('Memory file (memory.md) is required')
    m.ctx.memoryFile = new File(['memory'], 'MEMORY.md')
    await act(async () => root.render(<Configure />))
    expect(host.textContent).not.toContain('Memory file (memory.md) is required')
    await act(async () => next().click())
    expect(m.push).toHaveBeenCalledWith('/wrap-link/personal/preview')
  } finally { await act(async () => root.unmount()); host.remove() }
})
