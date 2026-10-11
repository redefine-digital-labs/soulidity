// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { GrantModal } from '../../web/components/souls/grant-modal'

const h = vi.hoisted(() => ({ pending: null as string | null, error: null as string | null, identity: 'wallet-1',
  issue: vi.fn(), revoke: vi.fn(), invalidate: vi.fn(), toast: vi.fn(), close: vi.fn(), recovery: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: h.invalidate }) }))
vi.mock('../../web/lib/hooks/use-grant', () => ({ useGrant: () => ({ pending: h.pending, error: h.error, identityKey: h.identity, issueGrant: h.issue, revokeGrant: h.revoke }) }))
vi.mock('../../web/components/ui/toast', () => ({ useToast: () => ({ showToast: h.toast }) }))
vi.mock('../../web/components/ui/modal', () => ({ Modal: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null }))
vi.mock('../../web/components/ui/button', () => ({ Button: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button> }))
vi.mock('../../web/components/souls/soul-artwork-image', () => ({ SoulArtworkImage: ({ src, alt }: any) => <img src={src} alt={alt} /> }))
vi.mock('../../web/components/souls/soul-access-recovery', () => ({ SoulAccessRecoveryPanel: ({ soul }: any) => {
  h.recovery(soul); return <section data-recovery-soul={soul.onChainId}>Exact access transaction recovery</section>
} }))
const id = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
let root: Root, host: HTMLDivElement, soul: any
const render = () => act(async () => { root.render(<GrantModal soul={soul} open onClose={h.close} />) })
const authorize = () => [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Authorize Agent'))!
const revoke = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Revoke')!
const click = (button: HTMLElement) => act(async () => { button.click() })
async function address(value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function select(value: string) {
  await act(async () => { const control = host.querySelector('select')!; control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })) })
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); h.pending = null; h.error = null; h.identity = 'wallet-1'
  h.issue.mockReset().mockResolvedValue(undefined); h.revoke.mockReset().mockResolvedValue(undefined)
  soul = { onChainId: id(1), stateOnChainId: id(2), name: 'Soul fixture', imageUrl: null, effectiveGrantCount: '2',
    activeGrantDetails: [{ granteeAddress: id(5) }, { granteeAddress: id(6) }] }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('adds a new grantee without arbitrarily revoking the first existing grant', async () => {
  await render(); await address(id(7)); await click(authorize())
  expect(h.issue).toHaveBeenCalledWith(id(7)); expect(h.revoke).not.toHaveBeenCalled()
  expect(h.invalidate).toHaveBeenCalledWith({ queryKey: ['my-souls'] }); expect(h.close).toHaveBeenCalledOnce()
})
it('requires explicit selected replacement and waits for revoke before issuing the new grant', async () => {
  let release!: () => void; h.revoke.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  await render(); await select(id(6)); await click(host.querySelector('input[type="checkbox"]')!); await address(id(7)); await click(authorize())
  expect(h.revoke).toHaveBeenCalledWith(id(6)); expect(h.issue).not.toHaveBeenCalled()
  await act(async () => { release() })
  expect(h.issue).toHaveBeenCalledWith(id(7)); expect(h.revoke.mock.invocationCallOrder[0]).toBeLessThan(h.issue.mock.invocationCallOrder[0])
})
it.each(['revoke', 'issue-success', 'issue-failure'])('identity change during replacement %s cannot advance or update the new modal', async stage => {
  let resolve!: () => void, reject!: (error: Error) => void
  const delayed = () => new Promise<void>((yes, no) => { resolve = yes; reject = no })
  if (stage === 'revoke') h.revoke.mockImplementationOnce(delayed)
  else h.issue.mockImplementationOnce(delayed)
  await render(); await click(host.querySelector('input[type="checkbox"]')!); await address(id(7)); await click(authorize())
  h.identity = 'wallet-2'; await render(); await address(id(8))
  await act(async () => { if (stage === 'issue-failure') reject(Error('old issue failed')); else resolve() })
  if (stage === 'revoke') expect(h.issue).not.toHaveBeenCalled()
  expect(h.close).not.toHaveBeenCalled(); expect(h.toast).not.toHaveBeenCalled(); expect(h.invalidate).not.toHaveBeenCalled()
  expect(host.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe(id(8))
  expect(host.textContent).not.toContain('Current grant was revoked.')
})
it('updating the selected same address does not revoke it even with replacement checked', async () => {
  await render(); await select(id(6)); await click(host.querySelector('input[type="checkbox"]')!); await address(id(6)); await click(authorize())
  expect(h.issue).toHaveBeenCalledWith(id(6)); expect(h.revoke).not.toHaveBeenCalled()
})
it('keeps the replacement failure notice and recovery available after a successful revoke', async () => {
  h.issue.mockRejectedValue(Error('new issue failed'))
  await render(); await select(id(6)); await click(host.querySelector('input[type="checkbox"]')!); await address(id(7)); await click(authorize())
  expect(h.revoke).toHaveBeenCalledWith(id(6)); expect(host.textContent).toContain('Current grant was revoked. Issue a new grant to complete reassignment.')
  expect(h.toast).toHaveBeenCalledWith('Grant reassignment failed — previous grant revoked', 'danger'); expect(h.close).not.toHaveBeenCalled()
  expect(host.querySelector('[data-recovery-soul]')?.getAttribute('data-recovery-soul')).toBe(id(1))
})
it('does not issue a replacement when the selected revoke itself fails or is uncertain', async () => {
  h.revoke.mockRejectedValue(Error('original revoke pending'))
  await render(); await click(host.querySelector('input[type="checkbox"]')!); await address(id(7)); await click(authorize())
  expect(h.issue).not.toHaveBeenCalled(); expect(h.close).not.toHaveBeenCalled(); expect(host.textContent).not.toContain('Current grant was revoked.')
})
it('revokes the explicitly selected address, not the first grant in the list', async () => {
  await render(); await select(id(6)); await click(revoke())
  expect(h.revoke).toHaveBeenCalledWith(id(6)); expect(h.issue).not.toHaveBeenCalled(); expect(h.close).toHaveBeenCalledOnce()
})
it('shows actual Sui address controls and keeps public exact-transaction recovery in the modal', async () => {
  await render(); expect(host.textContent).toContain('Grantee Sui Address'); expect(host.textContent).toContain('Grants are scoped to each address.')
  expect([...host.querySelectorAll('option')].map(option => option.value)).toEqual([id(5), id(6)])
  expect(host.textContent).toContain('Exact access transaction recovery'); expect(h.recovery).toHaveBeenCalledWith(soul)
  expect(host.textContent).not.toContain('One active grant at a time')
})
it.each(['issue', 'revoke'])('disables authorize, revoke and replacement while %s is pending', async pending => {
  h.pending = pending; await render()
  expect([...host.querySelectorAll('button')].every(button => button.disabled)).toBe(true)
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
})
