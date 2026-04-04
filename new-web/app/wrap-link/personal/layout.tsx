'use client'

import { AuthGate } from '@/components/auth/auth-gate'

export default function PersonalWrapLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate
      icon="🔗"
      label="Sign in to start Personal Join"
      sublabel="Selecting an NFT, configuring the Soul layer, and signing the wrap transaction require your authenticated wallet session."
      className="max-w-[680px]"
    >
      {children}
    </AuthGate>
  )
}
