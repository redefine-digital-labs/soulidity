'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { useImportSoul } from '@/components/providers/import-soul-provider'

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Preview & Confirm' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

function truncateId(id: string) {
  if (id.length <= 12) return id
  return `${id.slice(0, 6)}…${id.slice(-4)}`
}

export default function ImportSuccessPage() {
  const router = useRouter()
  const ctx = useImportSoul()
  const network = process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet'
  const networkLabel = network === 'mainnet' ? 'Mainnet' : network.charAt(0).toUpperCase() + network.slice(1)

  useEffect(() => {
    if (ctx.isHydrated && !ctx.importResult) {
      router.replace('/import')
    }
  }, [ctx.isHydrated, ctx.importResult, router])

  if (!ctx.importResult) return null

  const { txDigest, soulOnChainId, originRef } = ctx.importResult

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={5} />

      <PageContainer size="sm" className="py-12 text-center">
        {/* Success icon */}
        <div
          className="mx-auto mb-6 flex h-[72px] w-[72px] items-center justify-center rounded-full text-4xl"
          style={{ background: 'rgba(16, 185, 129, 0.15)', border: '2px solid var(--success)' }}
        >
          🚀
        </div>

        <h1 className="mb-2 text-3xl font-bold">✦ Your Soul is Awake</h1>
        <p className="mx-auto mb-10 max-w-[380px] text-sm leading-relaxed text-muted">
          Your imported Soul is permanently anchored on Sui. It exists on-chain forever — immutable, sovereign, and ready to trade.
        </p>

        {/* Transaction details */}
        <div className="mb-8 rounded-xl border border-border bg-card2 p-5 text-left">
          <div className="flex items-center justify-between border-b border-border py-2.5 text-sm">
            <span className="text-muted">Soul Object ID</span>
            <span className="font-mono text-xs text-teal">{truncateId(soulOnChainId)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border py-2.5 text-sm">
            <span className="text-muted">Tx Hash</span>
            <span className="font-mono text-xs text-teal">{truncateId(txDigest)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border py-2.5 text-sm">
            <span className="text-muted">Source</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground">{ctx.rawFile?.name ?? 'External file'}</span>
              <span className="rounded-full border border-purple/30 bg-purple/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-action-label">
                Imported
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between border-b border-border py-2.5 text-sm">
            <span className="text-muted">Origin Ref</span>
            <span className="font-mono text-xs text-muted">{truncateId(originRef)}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 text-sm">
            <span className="text-muted">Status</span>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              Live on {networkLabel}
            </span>
          </div>
        </div>

        {/* Action cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 text-left">
          <Link
            href={`/souls/${soulOnChainId}`}
            className="group rounded-xl border-2 border-gold bg-card p-5 transition hover:bg-card2"
          >
            <span className="mb-2.5 block text-2xl">💰</span>
            <span className="block text-sm font-bold">List for Sale Now</span>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Set a price and list your Soul in the marketplace immediately.
            </p>
            <span className="mt-3 block text-xs font-semibold text-teal">
              Set Price → List →
            </span>
          </Link>

          <Link
            href="/my-souls"
            className="group rounded-xl border border-border bg-card p-5 transition hover:border-purple"
          >
            <span className="mb-2.5 block text-2xl">🔐</span>
            <span className="block text-sm font-bold">Manage in My Souls</span>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Go to your dashboard to authorize an AI agent, manage versions, or list later.
            </p>
            <span className="mt-3 block text-xs font-semibold text-muted group-hover:text-action-label">
              Go to My Souls →
            </span>
          </Link>
        </div>

        <Link
          href="/market"
          className="text-sm text-muted underline underline-offset-4 transition hover:text-action-label"
        >
          View in Market
        </Link>
      </PageContainer>
    </div>
  )
}
