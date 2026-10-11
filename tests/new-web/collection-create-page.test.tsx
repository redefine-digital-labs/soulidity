// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import CollectionPreview from '../../web/app/collections/create/preview/page'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

const m = vi.hoisted(() => ({ approve: null as any, login: vi.fn(), resume: vi.fn(), retry: vi.fn(), retire: vi.fn(), query: vi.fn(), replace: vi.fn(),
  data: { resolvedName: '', resolvedDescription: '', originRef: 'sha256:source', coverImageFile: null, charFile: null, memoryFile: null, skillsFile: null,
    royalty: 500, tags: '', name: '', description: '', isHydrated: true, floorPrice: '', extraRoyaltyBps: 500, tradeable: true,
    batchSouls: [], batchErrors: [], folderErrors: [], batchFile: null, soulFolders: new Map(), unlimitedSupply: true, supplyCap: '', collectionRightListingPrice: '', addSoulsMethod: 'skip', listOnPublish: false, listingPriceAtomic: null, collectionBindTarget: null,
    listCollectionRightOnLaunch: false, setPublishResult: vi.fn() },
  state: { status: 'idle', error: null, txDigest: null as string | null, syncData: null, progress: { mintedSouls: 0, boundSouls: 0, totalSouls: 0 }, recovery: { manifest: { request: { mints: [], collection: { name: 'Saved Collection', description: 'Original', extraRoyaltyBps: 500,
      tradeable: true, floorPriceAtomic: null, maxSupply: null, listingPriceAtomic: null } } } }, loadingRecovery: false,
    retryPacket: null as { bytes: string; digest: string; retired?: boolean } | null,
    suiWallet: { address: '0x' + '11'.repeat(32) } },
}))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ replace: m.replace, push: m.replace }) }))
vi.mock('../../web/node_modules/next/link.js', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentWallet: () => ({ isConnecting: false }), useAutoConnectWallet: () => 'attempted' }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../web/components/providers/create-collection-provider', () => ({ collectionSteps: [{label:'Info'},{label:'Add Souls'},{label:'Preview'},{label:'Launched'}], useCreateCollection: () => m.data }))
vi.mock('../../web/lib/hooks/use-collection-publish', () => ({ useCollectionPublish: (approve: any) => {
  m.approve = approve; return { ...m.state, publish: vi.fn(), resume: m.resume, query: m.query, retryFailed: m.retry, retireExpired: m.retire }
} }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => m.login }))
vi.mock('../../web/components/ui/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../web/lib/hooks/use-wallet-balances', () => ({ minimumSuiBalanceForWalletTransactions: () => 0.08, formatBalance: String,
  useWalletBalances: () => ({ sui: 0, loading: false, refresh: vi.fn() }) }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  m.resume.mockReset(); m.retry.mockReset(); m.retire.mockReset(); m.query.mockReset(); m.replace.mockReset(); m.state.retryPacket = null; m.state.txDigest = null
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<CollectionPreview />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
function button(text: string) {
  const value = [...host.querySelectorAll('button')].find(b => b.textContent?.replace(/ →$/, '').trim() === text)
  if (!value) throw Error(`Missing button: ${text}`)
  return value
}
it('saved preparation with no digest or original Files offers query/resume without declaring success or redirecting', async () => {
  expect(host.textContent).toContain('Saved files and paid storage are retained')
  expect(host.textContent).toContain('No initial Souls. Check Saved Collection')
  expect(host.textContent).not.toContain('0 of 0 Souls proved complete')
  expect(host.textContent).not.toContain('transaction succeeded')
  expect(host.textContent).not.toContain('Start Over')
  expect(m.replace).not.toHaveBeenCalled()
  expect(button('Resume Saved Collection').disabled).toBe(false)
  await act(async () => button('Check Saved Collection').click())
  await act(async () => button('Resume Saved Collection').click())
  expect(m.query).toHaveBeenCalledOnce(); expect(m.resume).toHaveBeenCalledOnce()
})
it('cold batch recovery distinguishes unchecked progress from proved zero', async () => {
  const saved = m.state.recovery, progress = m.state.progress
  try {
    m.state.recovery = { manifest: { request: { ...saved.manifest.request, mints: Array.from({ length: 23 }, (_, i) =>
      ({ name: `Saved Soul ${i + 1}`, description: 'Saved batch row', publicPreview: { tags: [] }, creatorRoyaltyBps: 500 })) as never[] } } }
    await act(async () => root.render(<CollectionPreview />))
    expect(host.textContent).toContain('Completed count has not been checked on this page')
    expect(host.textContent).not.toContain('0 of 23 Souls proved complete')
    expect(host.textContent).not.toContain('will mint on Launch')
    expect(host.textContent).toContain('#1 · saved; completion not checked')
    m.state.progress = { totalSouls: 23, mintedSouls: 10, boundSouls: 10 }
    await act(async () => root.render(<CollectionPreview />))
    expect(host.textContent).toContain('10 of 23 Souls proved complete')
    expect(host.textContent).toContain('#10 · already completed; will not mint again')
    expect(host.textContent).toContain('#11 · remaining in this creation')
    expect(host.textContent).toContain('13 remaining · 10 already completed')
  } finally { m.state.recovery = saved; m.state.progress = progress }
})
it('exact fee dialog can be cancelled and closes when its wallet lifetime is aborted', async () => {
  const tx = new Transaction()
  tx.setSender(m.state.suiWallet.address); tx.setGasOwner(m.state.suiWallet.address)
  tx.setGasBudget(1000); tx.setGasPrice(1); tx.setExpiration({ Epoch: '99' })
  tx.setGasPayment([{ objectId: '0x' + '77'.repeat(32), version: '1', digest: '1'.repeat(32) }])
  const bytes = TransactionDataBuilder.restore(tx.getData()).build()
  const record = { plan: { step: { kind: 'MINT' } }, packet: { bytes: toBase64(bytes),
    digest: TransactionDataBuilder.getDigestFromBytes(bytes), expirationEpoch: '99' } }
  const controller = new AbortController()
  let pending!: Promise<boolean>
  await act(async () => { pending = m.approve(record, controller.signal) })
  expect(host.querySelector('[role=dialog]')?.textContent).toContain(record.packet.digest)
  expect(host.textContent).toContain('WAL payment')
  await act(async () => button('Cancel').click())
  expect(await pending).toBe(false); expect(host.querySelector('[role=dialog]')).toBeNull()
  await act(async () => { pending = m.approve(record, controller.signal) })
  await act(async () => controller.abort())
  expect(await pending).toBe(false); expect(host.querySelector('[role=dialog]')).toBeNull()
})
it('a proved failed transaction exposes an explicit retry action, not a new creation', async () => {
  m.state.retryPacket = { bytes: 'saved-bytes', digest: 'failed-digest' }
  await act(async () => root.render(<CollectionPreview />))
  expect(button('Retry Failed Transaction').disabled).toBe(false)
  await act(async () => button('Retry Failed Transaction').click())
  expect(m.retry).toHaveBeenCalledOnce(); expect(m.resume).not.toHaveBeenCalled()
  expect(m.replace).not.toHaveBeenCalled()
  m.state.retryPacket = null
  await act(async () => root.render(<CollectionPreview />))
  expect(host.textContent).not.toContain('Retry Failed Transaction')
  expect(button('Resume Saved Collection').disabled).toBe(false)
})
it('expiry check is a separate non-signing action, followed by explicit retired retry', async () => {
  m.state.txDigest = 'expired-digest'
  await act(async () => root.render(<CollectionPreview />))
  await act(async () => button('Check Expiry & Retire').click())
  expect(m.retire).toHaveBeenCalledOnce(); expect(m.resume).not.toHaveBeenCalled(); expect(m.retry).not.toHaveBeenCalled()
  m.state.retryPacket = { bytes: 'saved', digest: 'expired-digest', retired: true }
  await act(async () => root.render(<CollectionPreview />))
  expect(host.textContent).not.toContain('Check Expiry & Retire')
  await act(async () => button('Retry Retired Transaction').click())
  expect(m.retry).toHaveBeenCalledOnce(); expect(m.replace).not.toHaveBeenCalled()
})
it('cold preview without wallet or original Files still exposes reconnect instead of a blank page', async () => {
  const savedWallet = m.state.suiWallet
  const savedRecovery = m.state.recovery
  try {
    Object.assign(m.state, { suiWallet: null, recovery: null })
    await act(async () => root.render(<CollectionPreview />))
    expect(button('Connect Sui Wallet').disabled).toBe(false)
    await act(async () => button('Connect Sui Wallet').click())
    expect(m.login).toHaveBeenCalledOnce()
    expect(m.replace).not.toHaveBeenCalled()
    Object.assign(m.state, { suiWallet: savedWallet })
    await act(async () => root.render(<CollectionPreview />))
    expect(m.replace).toHaveBeenCalledWith('/collections/create')
  } finally {
    Object.assign(m.state, { suiWallet: savedWallet, recovery: savedRecovery })
  }
})
