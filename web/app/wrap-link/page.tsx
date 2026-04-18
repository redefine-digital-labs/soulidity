'use client'

import { useRouter } from 'next/navigation'
import { useRequireAuth } from '@/lib/hooks/use-require-auth'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'

export default function WrapLinkPage() {
  const router = useRouter()
  const { requireAuth } = useRequireAuth()

  return (
    <PageContainer size="sm" className="py-12 relative z-10 space-y-6">
      <SectionHeader
        label="Personal Join"
        title="Expand to Soul"
        subtitle="Wrap an existing NFT into a Soul layer — the original NFT stays unchanged. You add identity, memory, and skills on top, making it a Soul without changing ownership."
      />

      <div className="grid grid-cols-1 gap-4">
        <button
          type="button"
          onClick={() => requireAuth(
            () => router.push('/wrap-link/personal'),
            { path: '/wrap-link/personal', label: 'Resuming Personal Join.' },
          )}
          className="bg-card border border-border rounded-xl p-6 hover:border-purple hover:-translate-y-0.5 transition block group text-left"
        >
          <div className="text-3xl mb-4">🔗</div>
          <h2 className="font-display font-bold text-lg mb-2 group-hover:text-purple transition">Personal Join</h2>
          <p className="text-muted text-sm leading-relaxed mb-4">
            You hold an NFT and want to add a Soul layer. Your NFT contract and token ID are unchanged — you gain Soul-layer capabilities.
          </p>
          <div className="flex items-center gap-1.5 text-purple text-sm font-semibold">
            <span>Start →</span>
          </div>
        </button>
      </div>

      <div className="bg-card2 border border-border rounded-xl px-5 py-4 text-xs text-muted leading-relaxed">
        <span className="font-bold text-foreground">How it works: </span>
        Wrap + Link anchors a Soul object on Sui to an existing NFT reference. The original NFT is never transferred or locked — the Soul layer is additive. Ownership and access are enforced on-chain.
      </div>
    </PageContainer>
  )
}
