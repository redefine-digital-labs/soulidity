'use client'

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth'

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <BasePrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ['telegram', 'email'],
        appearance: {
          showWalletLoginFirst: false,
        },
      }}
    >
      {children}
    </BasePrivyProvider>
  )
}
