'use client'

import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit'

export function WalletConnect() {
  const suiAccount = useCurrentAccount()

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Sui Wallet</p>
        {suiAccount ? (
          <p className="text-sm" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {suiAccount.address.slice(0, 6)}...{suiAccount.address.slice(-4)}
          </p>
        ) : (
          <ConnectButton />
        )}
      </div>
    </div>
  )
}
