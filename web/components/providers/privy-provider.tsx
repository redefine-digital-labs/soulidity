'use client'

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth'

const BUILD_FALLBACK_PRIVY_APP_ID = '0000000000000000000000000'

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() || BUILD_FALLBACK_PRIVY_APP_ID

  return (
    <BasePrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email'],
        appearance: {
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </BasePrivyProvider>
  )
}
