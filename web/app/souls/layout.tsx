'use client'

import { createNetworkConfig, SuiClientProvider } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { PublicNav } from '@web/components/public-nav'
import { resolveSuiNetwork } from '@web/lib/sui-network'

const { networkConfig } = createNetworkConfig({
  testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' },
  mainnet: { url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' },
})

const defaultNetwork = resolveSuiNetwork(process.env.NEXT_PUBLIC_SUI_NETWORK) as keyof typeof networkConfig

export default function SoulsLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork={defaultNetwork}>
        <PublicNav />
        {children}
      </SuiClientProvider>
    </QueryClientProvider>
  )
}
