// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import CreateGasPage from '../../web/app/create/gas/page'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

const m = vi.hoisted(() => ({ approve: null as any, resume: vi.fn(), retry: vi.fn(), retire: vi.fn(), query: vi.fn(), replace: vi.fn(),
  data: { name: '', description: '', coverImageFile: null, charFile: null, memoryFile: null, skillsFile: null,
    royalty: 500, tags: '', listOnPublish: false, listingPriceAtomic: null, collectionBindTarget: null,
    setPublishResult: vi.fn() },
  state: { status: 'idle', error: null, txDigest: null as string | null, publishData: null, recovery: {}, loadingRecovery: false,
    retryPacket: null as { bytes: string; digest: string; retired?: boolean } | null,
    suiWallet: { address: '0x' + '11'.repeat(32) } },
}))
vi.mock('../../web/node_modules/next/navigation.js', () => ({ useRouter: () => ({ replace: m.replace }) }))
vi.mock('../../web/node_modules/next/link.js', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))
vi.mock('@mysten/dapp-kit', () => ({ useCurrentWallet: () => ({ isConnecting: false }), useAutoConnectWallet: () => 'attempted' }))
vi.mock('../../web/components/providers/auth-provider', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../web/components/providers/create-soul-provider', () => ({ useCreateSoul: () => m.data }))
vi.mock('../../web/lib/hooks/use-publish', () => ({ usePublish: (approve: any) => {
  m.approve = approve; return { ...m.state, publish: vi.fn(), resume: m.resume, query: m.query, retryFailed: m.retry, retireExpired: m.retire }
} }))
vi.mock('../../web/lib/hooks/use-login', () => ({ useLogin: () => vi.fn() }))
vi.mock('../../web/components/ui/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('../../web/lib/hooks/use-wallet-balances', () => ({ MIN_SUI_BALANCE: 0.04, formatBalance: String,
  useWalletBalances: () => ({ sui: 0, loading: false, refresh: vi.fn() }) }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  m.resume.mockReset(); m.retry.mockReset(); m.retire.mockReset(); m.query.mockReset(); m.replace.mockReset(); m.state.retryPacket = null; m.state.txDigest = null
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<CreateGasPage />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
function button(text: string) {
  const value = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  if (!value) throw Error(`Missing button: ${text}`)
  return value
}
it('saved preparation with no digest or original Files offers query/resume without declaring success or redirecting', async () => {
  expect(host.textContent).toContain('Step 4 — Resume Creation')
  expect(host.textContent).not.toContain('transaction succeeded')
  expect(host.textContent).not.toContain('Start Over')
  expect(m.replace).not.toHaveBeenCalled()
  expect(button('Resume Saved Creation').disabled).toBe(false)
  await act(async () => button('Check Transaction').click())
  await act(async () => button('Resume Saved Creation').click())
  expect(m.query).toHaveBeenCalledOnce(); expect(m.resume).toHaveBeenCalledOnce()
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
  await act(async () => root.render(<CreateGasPage />))
  expect(button('Retry Failed Transaction').disabled).toBe(false)
  await act(async () => button('Retry Failed Transaction').click())
  expect(m.retry).toHaveBeenCalledOnce(); expect(m.resume).not.toHaveBeenCalled()
  expect(m.replace).not.toHaveBeenCalled()
  m.state.retryPacket = null
  await act(async () => root.render(<CreateGasPage />))
  expect(host.textContent).not.toContain('Retry Failed Transaction')
  expect(button('Resume Saved Creation').disabled).toBe(false)
})
it('expiry check is a separate non-signing action, followed by explicit retired retry', async () => {
  m.state.txDigest = 'expired-digest'
  await act(async () => root.render(<CreateGasPage />))
  await act(async () => button('Check Expiry & Retire').click())
  expect(m.retire).toHaveBeenCalledOnce(); expect(m.resume).not.toHaveBeenCalled(); expect(m.retry).not.toHaveBeenCalled()
  m.state.retryPacket = { bytes: 'saved', digest: 'expired-digest', retired: true }
  await act(async () => root.render(<CreateGasPage />))
  expect(host.textContent).not.toContain('Check Expiry & Retire')
  await act(async () => button('Retry Retired Transaction').click())
  expect(m.retry).toHaveBeenCalledOnce(); expect(m.replace).not.toHaveBeenCalled()
})
