'use client'

import { createNetworkConfig, SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
import { clusterApiUrl } from '@solana/web3.js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import '@mysten/dapp-kit/dist/index.css'
import '@solana/wallet-adapter-react-ui/styles.css'

const { networkConfig } = createNetworkConfig({
  testnet: { url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' },
  mainnet: { url: getJsonRpcFullnodeUrl('mainnet'), network: 'mainnet' },
})

const defaultNetwork = (process.env.NEXT_PUBLIC_SUI_NETWORK || 'testnet') as keyof typeof networkConfig

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())
  const [solanaWallets] = useState(() => [new PhantomWalletAdapter()])
  const solanaNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet'
  const solanaRpcUrl = clusterApiUrl(
    (solanaNetwork === 'mainnet-beta' || solanaNetwork === 'testnet' || solanaNetwork === 'devnet'
      ? solanaNetwork
      : 'devnet') as 'mainnet-beta' | 'testnet' | 'devnet',
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={solanaRpcUrl}>
        <SolanaWalletProvider wallets={solanaWallets} autoConnect>
          <WalletModalProvider>
            <SuiClientProvider networks={networkConfig} defaultNetwork={defaultNetwork}>
              <WalletProvider autoConnect>
                {children}
              </WalletProvider>
            </SuiClientProvider>
          </WalletModalProvider>
        </SolanaWalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  )
}
