'use client'

import { AuthGate } from '@/components/auth/auth-gate'

export default function CollectionWrapLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate
      icon="📦"
      label="Sign in to expand a collection"
      sublabel="Collection-level wrapping and the downstream configure or gas steps all require your authenticated session."
      className="max-w-[680px]"
    >
      {children}
    </AuthGate>
  )
}
