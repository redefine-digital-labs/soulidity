'use client'

import { useEffect, type ReactNode } from 'react'
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import '@mysten/dapp-kit/dist/index.css'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { QueryProvider } from './query-provider'
import { AuthProvider } from './auth-provider'
import { WalletAuthBridge } from './wallet-auth-bridge'
import { WalletLoginModal } from './wallet-login-modal'
import { E2EWalletHelpers } from './e2e-wallet-helpers'
import { E2EWalletStub } from './e2e-wallet-stub'
import { ToastProvider } from '@/components/ui/toast'
import { UploadCostReviewProvider } from '@/components/upload/upload-cost-review'
import {
  createSuiGrpcCompatClient,
  getSuiGrpcFullnodeUrl,
  syncSoulidityDeploymentSession,
} from '@soulidity/sdk'
import { VisualThemeProvider } from './visual-theme-provider'
import { SOULIDITY_DAPP_KIT_THEME } from '@/lib/theme/dapp-kit-theme'

// dapp-kit v1 still types its context as SuiJsonRpcClient. The factory keeps
// that method surface while all network requests use Sui's supported gRPC API.
const suiNetworks = {
  testnet: { url: getSuiGrpcFullnodeUrl('testnet'), network: 'testnet' as const },
  mainnet: { url: getSuiGrpcFullnodeUrl('mainnet'), network: 'mainnet' as const },
}

type SuiNetwork = keyof typeof suiNetworks

function createGrpcClient(name: string) {
  return createSuiGrpcCompatClient(name as SuiNetwork)
}

export function AppProviders({ children }: { children: ReactNode }) {
  const network = (process.env.NEXT_PUBLIC_SUI_NETWORK as SuiNetwork | undefined) ?? 'testnet'
  const defaultNetwork: SuiNetwork = network in suiNetworks ? network : 'testnet'

  useEffect(() => {
    const { changed } = syncSoulidityDeploymentSession(window.sessionStorage)
    if (changed) {
      window.location.reload()
    }
  }, [])

  return (
    <VisualThemeProvider>
      <PostHogProvider client={posthog}>
        <QueryProvider>
          {process.env.NODE_ENV === 'development' &&
          process.env.NEXT_PUBLIC_E2E_TEST_MODE === '1' ? (
            <E2EWalletStub />
          ) : null}
          <SuiClientProvider
            networks={suiNetworks}
            defaultNetwork={defaultNetwork}
            createClient={createGrpcClient}
          >
            <WalletProvider autoConnect theme={SOULIDITY_DAPP_KIT_THEME}>
              <AuthProvider>
                <WalletAuthBridge />
                <ToastProvider>
                  <UploadCostReviewProvider>
                    <E2EWalletHelpers />
                    <WalletLoginModal />
                    {children}
                  </UploadCostReviewProvider>
                </ToastProvider>
              </AuthProvider>
            </WalletProvider>
          </SuiClientProvider>
        </QueryProvider>
      </PostHogProvider>
    </VisualThemeProvider>
  )
}
