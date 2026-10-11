// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth, useAuthInternal } from '../../web/components/providers/auth-provider'
import { WalletAuthBridge } from '../../web/components/providers/wallet-auth-bridge'

const f = vi.hoisted(() => ({
  read: vi.fn(), metadata: vi.fn(), disconnect: vi.fn(), fetch: vi.fn(),
  address: null as string | null, client: { core: {} },
}))
vi.mock('@soulidity/sdk', () => ({ readMyWalletProfile: f.read, readPublicProfileMetadata: f.metadata }))
vi.mock('../../web/lib/profile/profile-config', () => ({ getBrowserProfileConfig: () => ({ deployment: {}, storage: {}, writesEnabled: true }) }))
vi.mock('@mysten/dapp-kit', () => ({
  useCurrentAccount: () => f.address ? { address: f.address } : null,
  useSuiClient: () => f.client,
  useDisconnectWallet: () => ({ mutateAsync: f.disconnect }),
}))
let root: Root, host: HTMLDivElement
let auth: ReturnType<typeof useAuth>, internal: ReturnType<typeof useAuthInternal>
const metadata = { schema: 'soulidity.public-profile.v1', displayName: 'Alice', avatar: '🦊', bio: null,
  coverImageUrl: null, twitterUrl: null, websiteUrl: null }
function Probe() { auth = useAuth(); internal = useAuthInternal(); return <p>{auth.user?.displayName ?? auth.walletAddress ?? 'disconnected'}</p> }
async function render() {
  await act(async () => root.render(<AuthProvider><WalletAuthBridge /><Probe /></AuthProvider>))
}
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('fetch', f.fetch)
  f.address = null
  f.read.mockReset().mockResolvedValue(null)
  f.metadata.mockReset().mockResolvedValue({ metadata })
  f.disconnect.mockReset().mockResolvedValue(undefined); f.fetch.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('connects an unregistered wallet without login API, personal signature or automatic profile creation', async () => {
  await render(); expect(auth.user).toBeNull()
  f.address = 'wallet-a'; await render()
  expect(auth.user).toMatchObject({ id: 'wallet-a', primarySuiAddress: 'wallet-a', isAdmin: false })
  expect(auth.profile).toBeNull(); expect(auth.authenticated).toBe(true)
  expect(f.read).toHaveBeenCalledOnce(); expect(f.fetch).not.toHaveBeenCalled()
})
it('uses the verified profile object identity and explicitly public metadata', async () => {
  f.address = 'wallet-a'
  f.read.mockResolvedValue({ id: 'profile-a', handle: 'alice', metadata: { blobObjectId: 'blob-a' } })
  await render()
  expect(auth.user).toMatchObject({ id: 'profile-a', primarySuiAddress: 'wallet-a', displayName: 'Alice', handle: 'alice', isAdmin: false })
  expect(f.metadata).toHaveBeenCalledOnce(); expect(f.fetch).not.toHaveBeenCalled()
})
it('drops late old-wallet metadata after wallet switch even if a reader ignores cancellation', async () => {
  let resolve!: (value: unknown) => void
  f.address = 'wallet-a'
  f.read.mockResolvedValueOnce({ id: 'profile-a', handle: 'alice', metadata: {} })
  f.metadata.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  await render()
  f.address = 'wallet-b'; await render()
  expect(auth.walletAddress).toBe('wallet-b')
  await act(async () => resolve({ metadata }))
  expect(auth.user?.id).toBe('wallet-b'); expect(auth.user?.displayName).toBeNull()
  expect(auth.profile).toBeNull(); expect(auth.loading).toBe(false)
})
it('shows profile read errors without disconnecting the wallet or inventing a new registered profile', async () => {
  f.address = 'wallet-a'; f.read.mockRejectedValue(new Error('Chain unavailable'))
  await render()
  expect(auth.profileError).toBe('Chain unavailable')
  expect(auth.walletAddress).toBe('wallet-a'); expect(auth.profile).toBeNull()
  expect(f.disconnect).not.toHaveBeenCalled()
  await expect(auth.getAuthHeaders()).rejects.toThrow('Owned account API retired')
})
it('disconnects without server logout and clears wallet-scoped reads', async () => {
  f.address = 'wallet-a'; await render()
  await act(async () => auth.logout())
  expect(f.disconnect).toHaveBeenCalledOnce(); expect(auth.user).toBeNull()
  expect(f.fetch).not.toHaveBeenCalled()
})
it('keeps wallet identity if the actual disconnect fails instead of silently pretending logout', async () => {
  f.address = 'wallet-a'; await render()
  f.disconnect.mockRejectedValue(new Error('Wallet disconnect failed'))
  await act(async () => { await expect(auth.logout()).rejects.toThrow('Wallet disconnect failed') })
  expect(auth.walletAddress).toBe('wallet-a')
})
