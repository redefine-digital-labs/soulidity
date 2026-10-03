// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthoringRecoveryImport } from '../../web/components/souls/authoring-recovery-import'
const m = vi.hoisted(() => ({ restore: vi.fn(), login: vi.fn(), decode: vi.fn(), wallet: { address: 'author' } as any,
  bundle: { manifest: { request: { author: 'author', collection: null, mints: [{ name: 'Recovered Soul' }] } }, history: [], head: null } }))
vi.mock('../../web/lib/hooks/use-publish', () => ({ usePublish: () => ({ importRecovery: m.restore,
  suiWallet: m.wallet, loadingRecovery: false, status: 'idle', error: null }) }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => m.login }))
vi.mock('../../web/lib/soulidity/soul-authoring-recovery', () => ({ importSoulAuthoringRecovery: m.decode, SOUL_AUTHORING_RECOVERY_MAX_TEXT: 1000 }))
vi.mock('../../web/node_modules/next/link.js', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  m.wallet = { address: 'author' }; m.restore.mockReset(); m.decode.mockReset().mockReturnValue(m.bundle)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<AuthoringRecoveryImport />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function select() {
  const input = host.querySelector('input')!
  Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 2, text: async () => '{}' }] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
function button(name: string) { return [...host.querySelectorAll('button')].find(b => b.textContent === name)! }
it('stages without restoring, then explicitly checks/restores and links to the original flow', async () => {
  await select(); expect(m.restore).not.toHaveBeenCalled(); expect(host.textContent).toContain('Recovered Soul')
  m.restore.mockResolvedValue({ href: '/create/gas', isCurrent: () => true })
  await act(async () => button('Check & Restore Creation').click())
  expect(m.restore).toHaveBeenCalledWith(m.bundle)
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/create/gas')
  expect(host.textContent).toContain('No transaction was submitted')
})
it('invalid files do not reach restore and disconnected users must connect their original wallet', async () => {
  m.decode.mockImplementationOnce(() => { throw Error('Invalid encrypted recovery') })
  await select(); expect(host.textContent).toContain('Invalid encrypted recovery'); expect(m.restore).not.toHaveBeenCalled()
  m.wallet = null; await act(async () => root.render(<AuthoringRecoveryImport />)); await select()
  expect(button('Connect Original Wallet')).toBeTruthy()
  expect(button('Check & Restore Creation')).toBeUndefined()
})
it('a wallet change while restoring cannot reveal a late success link', async () => {
  await select(); let finish!: (value: any) => void
  m.restore.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  await act(async () => button('Check & Restore Creation').click())
  await act(async () => finish({ href: '/create/gas', isCurrent: () => false }))
  expect(host.querySelector('a')).toBeNull()
})
