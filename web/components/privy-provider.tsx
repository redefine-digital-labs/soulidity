'use client'

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth'

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  if (!appId) {
    // During SSG or when env var is missing, render children without Privy
    return <>{children}</>
  }

  return (
    <BasePrivyProvider
      appId={appId}
      config={{
        loginMethods: ['telegram'],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </BasePrivyProvider>
  )
}
