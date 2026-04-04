'use client'

import { useRouter } from 'next/navigation'
import { useRequireAuth } from '@/lib/hooks/use-require-auth'

export default function WrapLinkPage() {
  const router = useRouter()
  const { requireAuth } = useRequireAuth()

  return (
    <div className="max-w-[680px] mx-auto px-6 py-12 relative z-10">
      <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Wrap + Link</p>
      <h1 className="font-display text-2xl font-bold mb-1">Wrap + Link</h1>
      <p className="text-muted text-sm mb-8">Add a Soul layer on top of existing NFTs</p>

      <div className="grid grid-cols-2 gap-4">
        {/* Personal Join */}
        <button
          type="button"
          onClick={() => {
            requireAuth(() => {
              router.push('/wrap-link/personal')
            })
          }}
          className="bg-card border border-border rounded-xl p-6 hover:border-purple hover:-translate-y-0.5 transition block group"
        >
          <div className="text-3xl mb-4">🔗</div>
          <h2 className="font-display font-bold text-lg mb-2 group-hover:text-purple transition">Personal Join</h2>
          <p className="text-muted text-sm leading-relaxed mb-4">
            Wrap a Soul layer onto your own NFT. Bind memories, personality, and skills directly to a token you hold.
          </p>
          <div className="flex items-center gap-1.5 text-purple text-sm font-semibold">
            <span>Start wrapping</span>
            <span>→</span>
          </div>
        </button>

        {/* Collection Expand */}
        <button
          type="button"
          onClick={() => {
            requireAuth(() => {
              router.push('/wrap-link/collection')
            })
          }}
          className="bg-card border border-border rounded-xl p-6 hover:border-purple hover:-translate-y-0.5 transition block group"
        >
          <div className="text-3xl mb-4">📦</div>
          <h2 className="font-display font-bold text-lg mb-2 group-hover:text-purple transition">Collection Expand</h2>
          <p className="text-muted text-sm leading-relaxed mb-4">
            Attach a collection-level Soul template to an entire NFT contract. Every holder gets access to the shared Soul layer.
          </p>
          <div className="flex items-center gap-1.5 text-purple text-sm font-semibold">
            <span>Expand collection</span>
            <span>→</span>
          </div>
        </button>
      </div>

      <div className="mt-8 bg-card2 border border-border rounded-xl px-5 py-4 text-xs text-muted leading-relaxed">
        <span className="font-bold text-foreground">How it works: </span>
        Wrap + Link anchors a Soul object on Sui to an existing NFT reference. The original NFT is never transferred or locked — the Soul layer is additive. Ownership and access are enforced on-chain via the SoulFactory contract.
      </div>
    </div>
  )
}
