'use client'

import { useEffect, type ReactNode } from 'react'
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
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
import { syncSoulidityDeploymentSession } from '@soulidity/sdk'

// SuiJsonRpcClientOptions requires both `url` and `network` in dapp-kit v1 / @mysten/sui v2
const suiNetworks = {
  testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' as const },
  mainnet: { url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' as const },
}

type SuiNetwork = keyof typeof suiNetworks

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
    <PostHogProvider client={posthog}>
      <QueryProvider>
        {process.env.NODE_ENV === 'development' &&
        process.env.NEXT_PUBLIC_E2E_TEST_MODE === '1' ? (
          <E2EWalletStub />
        ) : null}
        <SuiClientProvider networks={suiNetworks} defaultNetwork={defaultNetwork}>
          <WalletProvider autoConnect>
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
  )
}
