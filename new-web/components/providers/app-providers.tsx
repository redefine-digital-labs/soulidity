'use client'

import { useEffect, type ReactNode } from 'react'
import { SuiClientProvider } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { ThemeProvider } from './theme-provider'
import { PrivyProvider } from './privy-provider'
import { QueryProvider } from './query-provider'
import { AuthProvider } from './auth-provider'
import { syncSoulidityDeploymentSession } from '@/lib/soulidity/client-session'

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
    <ThemeProvider>
      <PrivyProvider>
        <QueryProvider>
          <SuiClientProvider networks={suiNetworks} defaultNetwork={defaultNetwork}>
            <AuthProvider>
              {children}
            </AuthProvider>
          </SuiClientProvider>
        </QueryProvider>
      </PrivyProvider>
    </ThemeProvider>
  )
}
