'use client'

import { AuthGate } from '@/components/auth/auth-gate'

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate
      icon="📥"
      label="Sign in to import a Soul"
      sublabel="Importing content, mapping fields, and submitting the on-chain import all require your authenticated session."
      className="max-w-[680px]"
    >
      {children}
    </AuthGate>
  )
}
