// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useCurrentAccount, useWallets } from '@mysten/dapp-kit'

// Use the shipped SDK bundle (precompiled styles), not Vitest's source alias.
vi.mock('@mysten/dapp-kit', async () => import('../../web/node_modules/@mysten/dapp-kit/dist/index.mjs'))
vi.mock('@mysten/dapp-kit/dist/index.css', () => ({}))

vi.mock('posthog-js', () => ({ default: {} }))
vi.mock('posthog-js/react', () => ({ PostHogProvider: ({ children }: React.PropsWithChildren) => children }))
vi.mock('@/components/providers/visual-theme-provider', () => ({ VisualThemeProvider: ({ children }: React.PropsWithChildren) => children }))
vi.mock('@/components/providers/auth-provider', () => ({ AuthProvider: ({ children }: React.PropsWithChildren) => children }))
vi.mock('@/components/providers/wallet-auth-bridge', () => ({ WalletAuthBridge: () => null }))
vi.mock('@/components/providers/wallet-login-modal', () => ({ WalletLoginModal: () => null }))
vi.mock('@/components/providers/e2e-wallet-helpers', () => ({ E2EWalletHelpers: () => null }))
vi.mock('@/components/providers/e2e-wallet-stub', () => ({ E2EWalletStub: () => null }))
vi.mock('@/components/ui/toast', () => ({ ToastProvider: ({ children }: React.PropsWithChildren) => children }))
vi.mock('@/components/upload/upload-cost-review', () => ({ UploadCostReviewProvider: ({ children }: React.PropsWithChildren) => children }))
vi.mock('@/lib/hooks/use-private-bookmarks', () => ({ PrivateBookmarksProvider: ({ children }: React.PropsWithChildren) => children }))

import { AppProviders } from '../../web/components/providers/app-providers'

it('registers the real SDK Slush web wallet without extension or authentication and cleans up on unmount', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // The real SDK fetches public wallet metadata at registration, not auth or chain data.
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'com.mystenlabs.suiwallet.web', walletName: 'Slush', description: 'Test wallet metadata', icon: 'data:image/svg+xml;base64,', enabled: true }) }))
  vi.stubGlobal('fetch', fetcher)
  const popup = vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('No login popup during registration') })
  const container = document.createElement('div')
  const root = createRoot(container)
  let wallets: ReturnType<typeof useWallets> = []
  let account: ReturnType<typeof useCurrentAccount> = null
  function Probe() { wallets = useWallets(); account = useCurrentAccount(); return null }
  try {
    await act(async () => { root.render(<AppProviders><Probe /></AppProviders>) })
    const slush = wallets.find(wallet => wallet.name.includes('Slush'))
    expect(slush, 'production provider must opt into the SDK web wallet').toBeDefined()
    expect(slush?.accounts).toEqual([])
    expect(account).toBeNull()
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.slush.app/api/wallet/metadata')
    expect(await slush!.features['standard:connect'].connect({ silent: true })).toEqual({ accounts: [] })
    expect(popup).not.toHaveBeenCalled()
    await act(async () => { root.unmount() })
    // A new unconfigured real SDK provider must not see the unmounted web wallet.
    const { WalletProvider, SuiClientProvider } = await import('@mysten/dapp-kit')
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
    const second = createRoot(container)
    await act(async () => { second.render(<QueryClientProvider client={new QueryClient()}><SuiClientProvider networks={{ testnet: { url: 'https://example.invalid' } }} defaultNetwork="testnet"><WalletProvider><Probe /></WalletProvider></SuiClientProvider></QueryClientProvider>) })
    expect(wallets.some(wallet => wallet.name.includes('Slush'))).toBe(false)
    await act(async () => { second.unmount() })
    // The SDK must retain an installed extension, not replace it with a web wallet.
    const { getWallets } = await import('../../web/node_modules/@mysten/wallet-standard/dist/index.mjs')
    const extension = { id: 'com.mystenlabs.suiwallet', name: 'Slush extension', version: slush!.version,
      icon: slush!.icon, chains: slush!.chains, accounts: [], features: slush!.features }
    const unregister = getWallets().register(extension)
    const third = createRoot(container)
    try {
      await act(async () => { third.render(<AppProviders><Probe /></AppProviders>) })
      expect(wallets).toContain(extension)
      expect(wallets.some(wallet => wallet.id === 'com.mystenlabs.suiwallet.web')).toBe(false)
      expect(account).toBeNull()
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(popup).not.toHaveBeenCalled()
    } finally {
      await act(async () => { third.unmount() })
      unregister()
    }
  } finally {
    await act(async () => { root.unmount() })
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
