'use client'

import { AuthGate } from '@/components/auth/auth-gate'

export default function CreateCollectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate
      icon="📦"
      label="Sign in to create a Collection"
      sublabel="Creating a Collection uses authenticated routes plus a wallet signature before the on-chain mirror can settle."
      className="max-w-[680px]"
    >
      {children}
    </AuthGate>
  )
}
