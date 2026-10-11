// @vitest-environment jsdom
import React, { act, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SoulDetailPage from '../../web/app/souls/[id]/page'
import SellSuccessPage from '../../web/app/souls/[id]/sell/success/page'
import { createBrowserSoulDetailModel, detailId } from './fixtures/browser-soul-detail-fixture'
import type { ChainSoulDetail } from '../../web/lib/soulidity/soul-detail-model'

const f = vi.hoisted(() => ({ soul: null as ChainSoulDetail | null, error: null as Error | null,
  refetch: vi.fn(), actions: {} as any, auth: {} as any, append: {} as any, mutations: {} as any, access: {} as any, grants: {} as any }))
vi.mock('../../web/lib/hooks/use-souls', () => ({ useSoulDetail: () => ({ data: f.soul, isLoading: false, error: f.error, refetch: f.refetch }) }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => f.auth }))
vi.mock('../../web/lib/hooks/use-require-auth', () => ({ useRequireAuth: () => ({ requireAuth: vi.fn() }) }))
vi.mock('../../web/lib/hooks/use-grant', () => ({ useGrant: () => f.grants }))
vi.mock('../../web/lib/hooks/use-paid-access', () => ({ usePaidAccess: () => f.access }))
vi.mock('../../web/lib/hooks/use-soul-access-mutations', () => ({ useSoulAccessMutations: () => ({ ...f.access, pending: f.access.pending !== null }) }))
vi.mock('../../web/lib/hooks/use-list-soul', () => ({ useListSoul: () => ({ native: null }) }))
vi.mock('../../web/lib/hooks/use-soul-content-actions', () => ({ useSoulContentActions: () => f.actions }))
vi.mock('../../web/lib/hooks/use-soul-content-append', () => ({ useSoulContentAppend: () => f.append }))
vi.mock('../../web/lib/hooks/use-soul-content-mutations', () => ({ useSoulContentMutations: () => f.mutations }))
vi.mock('../../web/components/souls/agent-grant-recommendations', () => ({ AgentGrantRecommendations: () => null }))
vi.mock('../../web/components/souls/native-wardrobe', () => ({ NativeWardrobePanel: () => null }))
vi.mock('../../web/components/shared/report-modal', () => ({ ReportModal: () => null }))
vi.mock('../../web/components/souls/soul-cover-image', () => ({ SoulCoverImage: () => <div>Cover</div> }))
vi.mock('../../web/components/souls/listing-modals', () => ({
  UpdatePriceModal: ({ open }: { open: boolean }) => open ? <div role="dialog">Update price dialog</div> : null,
  DelistModal: ({ open }: { open: boolean }) => open ? <div role="dialog">Delist dialog</div> : null,
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ push: vi.fn() }) }))

let host: HTMLDivElement, root: Root, query: QueryClient, params: Promise<{ id: string }>
async function render(success = false) {
  await act(async () => root.render(<QueryClientProvider client={query}><Suspense fallback="Loading">
    {success ? <SellSuccessPage params={params} /> : <SoulDetailPage params={params} />}
  </Suspense></QueryClientProvider>))
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(value => value.textContent?.trim() === label || value.getAttribute('role') === 'tab' && value.textContent?.startsWith(label))
  expect(button, `Missing button ${label}`).toBeTruthy()
  await act(async () => button!.click())
}
beforeEach(async () => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // Node's structuredClone returns Node-realm typed arrays. The browser has
  // one realm; align jsdom's global constructor for the raw-wire fixture.
  vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer.prototype).constructor)
  const { compose } = await createBrowserSoulDetailModel()
  f.soul = structuredClone(compose()); f.error = null; f.refetch.mockReset()
  f.auth = { user: { id: detailId(5), primarySuiAddress: detailId(5) }, getAuthHeaders: vi.fn(() => { throw new Error('Retired account API') }) }
  f.actions = { privacyKey: 1, pendingAction: null, contentActionError: null, canonicalMemoryName: 'default', noDownloadPolicy: 'none',
    openContentVersion: vi.fn(async () => {}),
    decryptContentVersion: vi.fn(async () => new TextEncoder().encode('PRIVATE MEMORY FIXTURE')), setStateConfig: vi.fn() }
  f.append = { recoveries: [], archivedRecoveries: [], pendingRestores: [], importedRecovery: null, pending: false, error: null, queryStatus: null,
    refresh: vi.fn(async () => {}), query: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    restore: vi.fn(async () => {}), rebase: vi.fn(async () => {}), queryImported: vi.fn(async () => {}), finish: vi.fn(async () => {}),
    exportRecovery: vi.fn(async () => {}), importRecovery: vi.fn(async () => {}) }
  f.actions.contentAppend = f.append
  f.mutations = { records: [], history: [], pending: false, author: detailId(5), error: null, status: null,
    refresh: vi.fn(async () => {}), query: vi.fn(async () => {}), exportRecord: vi.fn(),
    resume: vi.fn(async () => ({ status: 'SUCCEEDED' })), cancel: vi.fn(async () => {}) }
  f.grants = { pending: null, error: null, identityKey: 'first-wallet', issueGrant: vi.fn(async () => {}), revokeGrant: vi.fn(async () => {}), revokeGrantScope: vi.fn(async () => {}) }
  f.access = { records: [], history: [], pending: null, pendingAction: null, author: detailId(5), identityKey: 'first-wallet', error: null, status: null,
    refresh: vi.fn(async () => {}), query: vi.fn(async () => {}), exportRecord: vi.fn(),
    resume: vi.fn(async () => ({ status: 'SUCCEEDED' })), cancel: vi.fn(async () => {}),
    configurePaidAccess: vi.fn(async () => {}), deletePaidAccess: vi.fn(async () => {}), revokePaidAccess: vi.fn(async () => {}),
    preparePurchase: vi.fn(async () => purchasePlan()), execute: vi.fn(async () => ({ status: 'SUCCEEDED' })) }
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Page render must not use an owned HTTP API') }))
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  params = Promise.resolve({ id: detailId(3) })
})

function purchasePlan() {
  return { action: 'paid-purchase', kind: 3, soulId: detailId(3), author: detailId(5), currentOwner: detailId(7),
    input: { renew: false }, quote: { priceAtomic: '9007199254740993', feeAtomic: '7', totalAtomic: '9007199254741000',
      durationMs: '9007199254740993', feeRecipient: detailId(8) } }
}
async function field(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector); expect(input, selector).toBeTruthy()
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input!.dispatchEvent(new Event('input', { bubbles: true })); input!.dispatchEvent(new Event('change', { bubbles: true })) })
}
it('manual grant uses selected scopes and expiry; no mirror preflight or arbitrary revoke', async () => {
  await render(); await click('Grants')
  await field('input[placeholder="0x…"]', detailId(40))
  const scope = [...host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].find(b => b.textContent?.includes('Sprite & Audio'))!
  await act(async () => scope.click()); await click('+ Authorize')
  expect(f.grants.issueGrant).toHaveBeenCalledExactlyOnceWith(detailId(40), null, 13)
  expect(f.grants.revokeGrant).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
})
it.each(['resolve', 'reject'])('a late grant %s cannot clear or show errors in the replacement wallet form', async mode => {
  let resolve!: () => void, reject!: (error: Error) => void
  f.grants.issueGrant.mockImplementationOnce(() => new Promise<void>((yes, no) => { resolve = yes; reject = no }))
  await render(); await click('Grants'); await field('input[placeholder="0x…"]', detailId(40)); await click('+ Authorize')
  f.grants = { ...f.grants, identityKey: 'replacement-wallet' }; await render()
  await field('input[placeholder="0x…"]', detailId(41))
  await act(async () => { if (mode === 'resolve') resolve(); else reject(Error('old wallet RPC error')) })
  expect(host.querySelector<HTMLInputElement>('input[placeholder="0x…"]')!.value).toBe(detailId(41))
  expect(host.textContent).not.toContain('old wallet RPC error')
})
it.each([true,false])('finishing an earlier grant preserves a changed draft (%s) on the same wallet', async changed => {
  let finish!: () => void
  f.grants.issueGrant.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  await render(); await click('Grants'); await field('input[placeholder="0x…"]', detailId(40)); await click('+ Authorize')
  if(changed) await field('input[placeholder="0x…"]', detailId(41))
  await act(async () => finish())
  expect(f.grants.issueGrant).toHaveBeenCalledExactlyOnceWith(detailId(40),null,5)
  expect(host.querySelector<HTMLInputElement>('input[placeholder="0x…"]')!.value).toBe(changed ? detailId(41) : '')
})
it('the original grant row exposes partial scope revocation and full revocation separately', async () => {
  const grant = f.soul!.activeGrants[0]; grant.scopeMask = 13
  await render(); await click('Grants'); await click('Revoke Assets')
  expect(f.grants.revokeGrantScope).toHaveBeenCalledExactlyOnceWith(grant.granteeAddress, 8)
  expect(f.grants.revokeGrant).not.toHaveBeenCalled()
  await click('Revoke all'); expect(f.grants.revokeGrant).toHaveBeenCalledWith(grant.granteeAddress)
})
it('owner pricing preserves exact USDC decimals and u64 duration, including explicit zero', async () => {
  await render(); await click('Grants')
  await field('[aria-label="Paid content kind"]', '4294967295')
  await field('[aria-label="Paid price USDC"]', '9007199254.740993')
  await field('[aria-label="Paid duration milliseconds"]', '9007199254740993')
  await click('Save pricing')
  expect(f.access.configurePaidAccess).toHaveBeenCalledWith(4294967295, '9007199254740993', '9007199254740993', false)
  await field('[aria-label="Paid duration milliseconds"]', '0'); await click('Save pricing')
  expect(f.access.configurePaidAccess).toHaveBeenLastCalledWith(4294967295, '9007199254740993', '0', false)
})
it.each(['1.0000001', '18446744073709.551616', '-1', '1e6'])('invalid pricing %s never reaches a transaction', async price => {
  await render(); await click('Grants'); await field('[aria-label="Paid price USDC"]', price); await click('Save pricing')
  expect(f.access.configurePaidAccess).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).toBeTruthy()
})
it('visitor sees the frozen complete quote before execute, and confirms that same plan', async () => {
  f.soul!.isOwner = false; f.soul!.isGrantedAgent = false; f.soul!.currentKioskCapOnChainId = null; f.soul!.paidAccessEntries = []
  await render(); await click('Grants'); await click('Review purchase')
  expect(f.access.preparePurchase).toHaveBeenCalledWith(f.soul!.paidAccessKindConfigs[0].kind, false)
  expect(f.access.execute).not.toHaveBeenCalled()
  const dialog = host.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('9007199254.741 USDC'); expect(dialog.textContent).toContain('0.000007 USDC')
  expect(dialog.textContent).toContain('without an on-chain refund'); expect(dialog.textContent).toContain('9007199254740993 ms')
  await click('Confirm 9007199254.741 USDC'); expect(f.access.execute).toHaveBeenCalledWith(purchasePlan())
})
it.each(['finite', 'expired', 'lifetime', 'old-epoch'])('paid %s entry selects explicit renewal or a new purchase correctly', async mode => {
  const entry = f.soul!.paidAccessEntries[0]
  f.soul!.isOwner = false; f.soul!.isGrantedAgent = false; f.soul!.currentKioskCapOnChainId = null
  f.access.author = entry.buyerAddress
  entry.expiresAtMs = mode === 'lifetime' ? null : '2000'; entry.currentEpoch = mode !== 'old-epoch'
  entry.unexpiredAtObservation = mode !== 'expired'
  await render(); await click('Grants')
  if (mode === 'lifetime') {
    expect([...host.querySelectorAll('button')].find(b => b.textContent === 'No-expiry access held')?.disabled).toBe(true)
    expect(f.access.preparePurchase).not.toHaveBeenCalled()
  } else {
    await click(mode === 'old-epoch' ? 'Review purchase' : 'Review renewal')
    expect(f.access.preparePurchase).toHaveBeenCalledWith(entry.kind, mode !== 'old-epoch')
  }
})
it('access recovery survives content-tab changes and purchase Resume asks for the recorded quote', async () => {
  const receipt = { plan: { ...purchasePlan(), granteeAddress: detailId(5), paidAccessListId: detailId(9) },
    packet: { digest: 'recorded-access-digest', bytes: 'exact bytes', phase: 'SIGNED', signature: 'signed' } }
  f.access.records = [receipt]
  await render(); await click('Memory')
  expect(host.querySelector('[data-soul-access-recovery]')?.textContent).toContain('recorded-access-digest')
  await click('Resume exact transaction'); expect(f.access.resume).not.toHaveBeenCalled()
  await click('Resume exact purchase'); expect(f.access.resume).toHaveBeenCalledExactlyOnceWith(receipt)
  expect(f.access.preparePurchase).not.toHaveBeenCalled(); expect(f.access.execute).not.toHaveBeenCalled()
})
it('delayed quote failure after wallet identity change cannot appear on the new viewer', async () => {
  f.soul!.isOwner = false; f.soul!.isGrantedAgent = false; f.soul!.currentKioskCapOnChainId = null; f.soul!.paidAccessEntries = []
  let reject!: (error: Error) => void
  f.access.preparePurchase.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
  await render(); await click('Grants'); await click('Review purchase')
  f.access.identityKey = 'second-wallet'; await render()
  await act(async () => { reject(Error('OLD WALLET QUOTE FAILED')); await Promise.resolve() })
  expect(host.textContent).not.toContain('OLD WALLET QUOTE FAILED'); expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(f.access.execute).not.toHaveBeenCalled()
})
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); query?.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('original detail renders chain-only dates/counts without fictitious grant history or invalid Date', async () => {
  f.soul!.createdAtMs = '18446744073709551615'; f.soul!.createdAt = null
  f.soul!.grantCapacity = '18446744073709551615'; f.soul!.activeGrantCount = '9007199254740993'
  await render()
  expect(host.textContent).toContain('18446744073709551615 ms (outside calendar range)')
  expect(host.textContent).toContain('9007199254740993')
  expect(host.textContent).toContain('Not recorded on chain')
  expect(host.textContent).not.toContain('Invalid Date'); expect(host.textContent).not.toContain('Grant issued')
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
function mutationReceipt(phase = 'PREPARED', action = 'delete') {
  return { schema: 'soulidity.content-mutation.v1', plan: { author: detailId(5), action, kind: 3,
    target: { name: 'sprite', versionIndex: '9007199254740993' }, deployment: { callablePackageId: detailId(7) } },
    packet: { digest: 'recorded-mutation-digest', bytes: 'frozen bytes', phase, signature: phase === 'SIGNED' ? 'signature' : null } }
}
it('content recovery stays visible across tabs and checks/exports the original receipt with no connected wallet', async () => {
  const receipt = mutationReceipt('SIGNED'); f.mutations.records = [receipt]; f.mutations.author = null
  await render(); expect(host.querySelector('[data-content-mutation-recovery]')?.textContent).toContain('9007199254740993')
  await click('Memory'); expect(host.querySelector('[data-content-mutation-recovery]')).toBeTruthy()
  await click('Check original transaction'); await click('Export public receipt')
  expect(f.mutations.query).toHaveBeenCalledExactlyOnceWith(receipt); expect(f.mutations.exportRecord).toHaveBeenCalledExactlyOnceWith(receipt)
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Resume exact transaction')?.disabled).toBe(true)
  expect(host.textContent).not.toContain('Cancel unsigned preparation'); expect(globalThis.fetch).not.toHaveBeenCalled()
})
it.each(['PREPARED', 'SIGNING', 'SIGNED', 'SUCCEEDED', 'FAILED', 'CANCELLED'])('content recovery limits %s to its valid explicit controls', async phase => {
  f.mutations.records = [mutationReceipt(phase)]; await render()
  const panel = host.querySelector('[data-content-mutation-recovery]')!
  expect(panel.textContent?.includes('Cancel unsigned preparation')).toBe(phase === 'PREPARED')
  expect(panel.textContent?.includes('Resume exact transaction')).toBe(['PREPARED', 'SIGNING', 'SIGNED'].includes(phase))
  if (phase === 'PREPARED') { await click('Cancel unsigned preparation'); expect(f.mutations.cancel).toHaveBeenCalledWith(f.mutations.records[0]) }
})
it('purge recovery requires the original destructive confirmation and leaves failures available to retry', async () => {
  const receipt = mutationReceipt('SIGNED', 'purge'); f.mutations.records = [receipt]
  f.mutations.resume.mockRejectedValueOnce(Error('original purge is still unknown'))
  await render(); await click('Resume exact transaction')
  expect(f.mutations.resume).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"]')?.textContent).toContain('irreversible')
  await click('Purge permanently')
  expect(f.mutations.resume).toHaveBeenCalledWith(receipt)
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('original purge is still unknown')
  await click('Purge permanently'); expect(host.querySelector('[role="dialog"]')).toBeNull()
})
it('purge recovery does not close the confirmation when the adapter returns a pending checkpoint', async () => {
  f.mutations.records = [mutationReceipt('SIGNED', 'purge')]; f.mutations.resume.mockResolvedValueOnce({ status: 'PENDING' })
  await render(); await click('Resume exact transaction'); await click('Purge permanently')
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Purge is not confirmed')
})
it('retained receipts expose query/export but never a new write or cancellation', async () => {
  f.mutations.history = [mutationReceipt('SUCCEEDED')]; await render()
  const panel = host.querySelector('[data-content-mutation-recovery]')!
  expect(panel.textContent).toContain('retained receipt'); expect(panel.textContent).not.toContain('Resume exact transaction')
  expect(panel.textContent).not.toContain('Cancel unsigned preparation')
})
it('below-floor owner can actually open both reprice and delist modals', async () => {
  f.soul!.listingStatus = 'floor-violation'; f.soul!.chainListingStatus = 'LISTED'
  await render(); await click('Update price')
  expect([...host.querySelectorAll('[role="dialog"]')].some(value => value.textContent?.includes('Update price'))).toBe(true)
  await click('Delist')
  expect([...host.querySelectorAll('[role="dialog"]')].some(value => value.textContent?.includes('Delist'))).toBe(true)
})
it('transient chain errors show verification failure and retry rather than asset absence', async () => {
  f.soul = null; f.error = new Error('SOUL_PUBLIC_CHANGED_RETRY')
  await render()
  expect(host.textContent).toContain('Soul data unavailable'); expect(host.textContent).toContain('SOUL_PUBLIC_CHANGED_RETRY')
  expect(host.textContent).not.toContain('Soul not found'); expect(host.textContent).not.toContain('projection')
  await click('Retry chain read'); expect(f.refetch).toHaveBeenCalledOnce()
})
it.each([true, false])('listed visitor gets a Buy action only when verified checkout is available=%s', async available => {
  f.soul!.isOwner = false; f.soul!.isGrantedAgent = false; f.soul!.viewerAddress = null
  f.soul!.currentKioskCapOnChainId = null; f.soul!.purchaseAvailable = available
  f.soul!.market.secondaryEnabled = available
  await render()
  expect([...host.querySelectorAll('button')].some(button => button.textContent?.startsWith('Buy for'))).toBe(available)
  if (!available) expect(host.textContent).toContain('The displayed listing price is an observation, not purchase approval.')
  expect(host.textContent).toContain('1.075 USDC')
})
it('paid rows use chain-observation expiry and do not label unknown price as free/comp', async () => {
  // The fixture's Clock is1000 and expiry2000. The host's current date is years
  // later; that local clock must not override the verified chain observation.
  expect(f.soul!.paidAccessEntries[0].unexpiredAtObservation).toBe(true)
  f.soul!.activeGrants[0].status = 'expired'
  await render(); await click('Grants')
  expect([...host.querySelectorAll('span')].some(span => span.textContent === 'active')).toBe(true)
  expect(host.textContent).toContain('Price paidNot recorded on chain')
  expect(host.textContent).toContain('PurchasedNot recorded on chain')
  expect([...host.querySelectorAll('span')].some(span => span.textContent === 'comp')).toBe(false)
  expect(host.textContent).toContain('0 secs')
})
it('opens the initial Soul document from Info without offering immutable body mutations', async () => {
  await render()
  expect(host.textContent).toContain('Soul document')
  await click('Open')
  expect(f.actions.openContentVersion).toHaveBeenCalledWith(f.soul!.contentVersions.find(v => v.kind === 0))
  expect([...host.querySelectorAll('button')].some(b => ['Delete', 'Purge', 'Set active'].includes(b.textContent?.trim() ?? ''))).toBe(false)
  f.soul = { ...f.soul!, viewerAddress: detailId(99), isOwner: false, isCreator: false, isGrantedAgent: false, currentKioskCapOnChainId: null }
  await render()
  expect([...host.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Open')).toBe(false)
  expect(host.textContent).toContain('Metadata only')
})
it.each([false, true])('shows partial append availability on Memory, empty=%s', async empty => {
  if (empty) f.soul!.contentVersions = f.soul!.contentVersions.filter(v => v.kind !== 1)
  f.append.notice = 'Automatic account-agent grants are unavailable. This upload can continue; existing grants are preserved.'
  await render(); await click('Memory')
  expect([...host.querySelectorAll('[role="status"]')].some(el => el.textContent === f.append.notice)).toBe(true)
})
it.each([false, true])('retains a cancelled memory draft and clears only confirmed success: %s', async success => {
  f.actions.appendContentVersion = vi.fn(async () => success ? { versionIndex: '1' } : undefined)
  await render(); await click('Memory')
  const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Memory entry"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Keep on cancel')
    input.dispatchEvent(new Event('input', { bubbles: true })) })
  await click('Append memory')
  expect(input.value).toBe(success ? '' : 'Keep on cancel')
})
it('preserves the next memory draft typed while the previous append completes', async () => {
  let finish!: () => void
  f.actions.appendContentVersion = vi.fn(() => new Promise(resolve => { finish = () => resolve({ versionIndex: '1' }) }))
  await render(); await click('Memory')
  const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Memory entry"]')!
  async function type(value: string) {
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  await type('First entry'); await click('Append memory')
  await type('Next draft')
  await act(async () => { finish(); await Promise.resolve() })
  expect(input.value).toBe('Next draft')
  expect(f.actions.appendContentVersion).toHaveBeenCalledOnce()
})
it('shows successful empty memory only after reading it', async () => {
  f.actions.decryptContentVersion.mockResolvedValue(new Uint8Array(0))
  await render(); await click('Memory')
  const expand = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Memory @'))!
  await act(async () => expand.click())
  expect(host.textContent).not.toContain('Memory read successfully. This entry is empty.')
  await click('Read')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Memory read successfully. This entry is empty.')
  f.actions = { ...f.actions, privacyKey: 2 }; await render()
  expect(host.textContent).not.toContain('Memory read successfully. This entry is empty.')
})
it('cached wallet changes dispose decrypted memory without requiring an intervening loading render', async () => {
  await render(); await click('Memory')
  const expand = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Memory @'))!
  await act(async () => expand.click()); await click('Read')
  expect(host.textContent).toContain('PRIVATE MEMORY FIXTURE')
  f.soul = { ...f.soul!, viewerAddress: detailId(99), isOwner: false, isCreator: false, isGrantedAgent: false, currentKioskCapOnChainId: null }
  // Auth can lag behind the wallet bridge; viewer scope comes from the reader,
  // not the old profile principal kept in f.auth.
  await render(); await click('Memory')
  expect(host.textContent).not.toContain('PRIVATE MEMORY FIXTURE')
})
it.each(['delete', 'set-active', 'clear-active', 'memory-delete'])('original %s control handles a rejected mutation without losing the version', async action => {
  const failure = Error('Wallet rejected the content change')
  // Rejection tracking avoids an unhandled promise in the test process while
  // proving the original event handler attaches its rejection boundary.
  const caught = vi.fn((handler: (reason: Error) => unknown) => Promise.reject(failure).catch(handler))
  const operation = vi.fn(() => ({ catch: caught }))
  f.actions.deleteContentVersion = operation
  f.actions.setActiveContent = operation
  f.actions.clearActiveContent = operation
  await render(); await click(action === 'memory-delete' ? 'Memory' : 'Persona Sprite')
  if (action === 'memory-delete') {
    const row = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Memory @'))!
    await act(async () => row.click())
  }
  if (action === 'delete') {
    const inactive = f.soul!.contentVersions.find(v => v.kind === 3)!
    f.soul = { ...f.soul!, activeSpriteName: null, activeSpriteVersionIndex: null }
    expect(inactive.deleted).toBe(false); await render()
  }
  if (action === 'set-active') {
    f.soul = { ...f.soul!, activeSpriteName: null, activeSpriteVersionIndex: null }; await render()
  }
  await click(action.endsWith('delete') ? 'Delete' : action === 'set-active' ? 'Set active' : 'Clear active')
  expect(operation).toHaveBeenCalledOnce()
  expect(caught).toHaveBeenCalledOnce()
  f.actions.contentActionError = failure.message; await render()
  expect(host.textContent).toContain(failure.message)
  expect(f.soul!.contentVersions.every(v => !v.deleted)).toBe(true)
})
it('missing encrypted envelopes are visibly pending and never suggest reminting', async () => {
  await render(); await click('Persona Sprite')
  expect(host.querySelector('[role="status"]')?.textContent).toContain('do not mint it again')
  expect(host.textContent).toContain('pending finalization')
})
it.each(['public', 'paid'])('shows the original Open action for %s sealed content without treating the hint as authority', async kind => {
  const slot = f.soul!.contentVersions.find(v => v.kind === 3)!
  slot.readModeMask = kind === 'public' ? 8 : 4; slot.sealEncrypted = true; slot.deleted = false; slot.purged = false
  slot.isPublic = kind === 'public'; slot.grantScopeMask = 8
  const viewer = kind === 'public' ? detailId(99) : f.soul!.paidAccessEntries[0].buyerAddress
  f.soul!.viewerAddress = viewer; f.soul!.isOwner = false; f.soul!.isCreator = false; f.soul!.isGrantedAgent = false
  f.soul!.activeGrants = []; f.soul!.currentKioskCapOnChainId = null
  await render(); await click('Persona Sprite'); await click('Open')
  expect(f.actions.openContentVersion).toHaveBeenCalledWith(slot)
  expect(f.actions.decryptContentVersion).not.toHaveBeenCalled()
})
it('same-address read-session changes immediately dispose plaintext rows', async () => {
  await render(); await click('Memory')
  const expand = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Memory @'))!
  await act(async () => expand.click()); await click('Read')
  expect(host.textContent).toContain('PRIVATE MEMORY FIXTURE')
  f.actions = { ...f.actions, privacyKey: 2 }; await render()
  expect(host.textContent).not.toContain('PRIVATE MEMORY FIXTURE')
})
it('discarded MemoryRow cannot publish a late response and wipes its bytes', async () => {
  let resolve!: (bytes: Uint8Array) => void
  f.actions.decryptContentVersion.mockImplementation(() => new Promise(r => { resolve = r }))
  await render(); await click('Memory')
  const expand = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Memory @'))!
  await act(async () => expand.click()); await click('Read')
  f.actions = { ...f.actions, privacyKey: 2 }; await render()
  const bytes = new TextEncoder().encode('LATE PRIVATE MEMORY')
  await act(async () => { resolve(bytes); await Promise.resolve() })
  expect(host.textContent).not.toContain('LATE PRIVATE MEMORY'); expect(bytes.every(v => v === 0)).toBe(true)
})
it('ordinary success URL cannot turn an unlisted chain asset into a listed success', async () => {
  f.soul = structuredClone((await createBrowserSoulDetailModel(false)).compose())
  window.history.replaceState(null, '', '/souls/example/sell/success?price=99999999')
  await render(true)
  expect(host.textContent).toContain('Listing is not active'); expect(host.textContent).not.toContain('Soul Listed!')
  expect(host.textContent).not.toContain('99999999'); await click('Refresh chain state'); expect(f.refetch).toHaveBeenCalledOnce()
})
it('ordinary listing receipt uses verified price, with an explicit below-floor caveat', async () => {
  f.soul!.listingStatus = 'floor-violation'
  window.history.replaceState(null, '', '/souls/example/sell/success?price=99999999')
  await render(true)
  expect(host.textContent).toContain('Listed below collection floor')
  expect(host.textContent).toContain('hidden by the collection floor policy')
  expect(host.textContent).not.toContain('99999999')
})
it('renders separate import query, local restore and unfinished restore controls without invoking them on mount', async () => {
  const record = { scope: { name: 'memory-recovery', versionIndex: '2' }, authorSignature: 'current', sidecar: { fileName: 'memory.txt' } }
  const imported = { record, payment: { register: 'recorded' }, history: [], pending: null }
  const pending = { ...imported, record: { ...record, authorSignature: 'pending' } }
  f.append.importedRecovery = imported; f.append.pendingRestores = [pending]; f.append.recoveries = [record]
  f.append.archivedRecoveries = [{ ...record, authorSignature: 'archived' }]
  await render()
  expect(f.append.restore).not.toHaveBeenCalled(); expect(f.append.query).not.toHaveBeenCalled()
  expect(f.append.resume).not.toHaveBeenCalled(); expect(f.append.rebase).not.toHaveBeenCalled()
  await click('Check imported transaction'); expect(f.append.queryImported).toHaveBeenCalledWith(imported)
  await click('Restore to this device'); expect(f.append.restore).toHaveBeenLastCalledWith(imported)
  await click('Finish restoring to this device'); expect(f.append.restore).toHaveBeenLastCalledWith(pending)
  await click('Finish completed upload'); expect(f.append.finish).toHaveBeenCalledWith(record)
  await click('Check archived transaction'); expect(f.append.query).toHaveBeenCalledWith(f.append.archivedRecoveries[0])
  await click('Export archived recovery'); expect(f.append.exportRecovery).toHaveBeenCalledWith(f.append.archivedRecoveries[0])
  expect(f.append.resume).not.toHaveBeenCalled(); expect(f.append.rebase).not.toHaveBeenCalled()
  f.append.pending = true; await render()
  const controls = [...host.querySelectorAll('button')].filter(button => ['Restore to this device', 'Finish restoring to this device'].includes(button.textContent!))
  expect(controls).toHaveLength(2); expect(controls.every(button => button.disabled)).toBe(true)
})
