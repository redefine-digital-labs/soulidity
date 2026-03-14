'use client'

import { PrivyProvider as BasePrivyProvider } from '@privy-io/react-auth'

export function PrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <BasePrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: process.env.NEXT_PUBLIC_ENABLE_EMAIL_LOGIN === 'true'
          ? ['telegram', 'email']
          : ['telegram'],
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
