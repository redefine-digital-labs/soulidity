'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Input } from '@/components/ui/input'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useWrap, wrapSteps } from '@/components/providers/wrap-provider'
import { useKioskNfts, type KioskNft } from '@/lib/hooks/use-kiosk-nfts'
import { usePrivySuiSign } from '@/lib/hooks/use-privy-sui'

function NftCard({ nft, selected, onSelect }: { nft: KioskNft; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition ${
        selected
          ? 'border-purple bg-purple/12 shadow-[0_4px_16px_rgba(124,58,237,0.2)]'
          : 'border-border bg-card2/40 hover:border-purple/40'
      }`}
    >
      {nft.imageUrl ? (
        <img src={nft.imageUrl} alt={nft.name} className="h-12 w-12 shrink-0 rounded-lg border border-border/50 object-cover" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-purple/20 text-lg font-bold text-purple">
          {nft.name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-foreground">{nft.name}</div>
        <div className="mt-0.5 truncate text-xs text-muted font-mono">{nft.objectType.split('::').slice(-1)[0]}</div>
      </div>
      <Tag color={selected ? 'purple' : 'muted'}>{selected ? 'Selected' : 'Not Soul'}</Tag>
    </button>
  )
}

export default function SelectNftPage() {
  const router = useRouter()
  const ctx = useWrap()
  const { suiWallet } = usePrivySuiSign()
  const { data: nfts, isLoading } = useKioskNfts(suiWallet?.address)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filteredNfts = useMemo(() => {
    if (!nfts) return []
    if (!search.trim()) return nfts
    const q = search.toLowerCase()
    return nfts.filter((n) =>
      n.name.toLowerCase().includes(q)
      || n.objectType.toLowerCase().includes(q)
      || n.objectId.toLowerCase().includes(q),
    )
  }, [nfts, search])

  function handleNext() {
    if (!ctx.selectedNft) {
      setError('Please select an NFT to wrap.')
      return
    }
    setError(null)
    router.push('/wrap-link/personal/configure')
  }

  return (
    <>
      <FlowBar steps={wrapSteps} currentStep={0} />
      <div className="relative z-10 border-t border-purple/20">
        <PageContainer size="sm" className="space-y-6 pt-7 sm:pt-9">
          <SectionHeader
            label="Personal Join"
            title="Select Your NFT"
            subtitle="Detected from your connected wallet — select one to expand."
            className="mb-2"
          />

          {/* NFT Platform tabs */}
          <div className="flex gap-2">
            <Tag color="purple">Sui (Connected)</Tag>
            <Tag color="muted">Ethereum</Tag>
            <Tag color="muted">Solana</Tag>
          </div>

          {/* NFT list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                Your NFTs {nfts && nfts.length > 0 ? `(${nfts.length})` : ''}
              </p>
            </div>

            {/* Search */}
            {nfts && nfts.length > 0 && (
              <div className="relative">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" strokeLinecap="round" />
                </svg>
                <Input
                  type="text"
                  placeholder="Search by name, type, or ID..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9"
                />
              </div>
            )}

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-[72px] rounded-xl bg-card2 animate-pulse" />
                ))}
              </div>
            ) : !nfts || nfts.length === 0 ? (
              <EmptyState
                icon="🖼"
                label="No NFTs found"
                sublabel="Your wallet doesn't hold any NFTs with Display metadata on Sui."
              />
            ) : filteredNfts.length === 0 ? (
              <p className="rounded-xl border border-border/50 bg-card2/40 px-4 py-6 text-center text-xs text-muted">
                No NFTs matching &quot;{search}&quot;
              </p>
            ) : (
              <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
                {filteredNfts.map((nft) => (
                  <NftCard
                    key={nft.objectId}
                    nft={nft}
                    selected={ctx.selectedNft?.objectId === nft.objectId}
                    onSelect={() => ctx.setSelectedNft(nft)}
                  />
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3">
              <p className="text-[13px] font-medium text-danger">{error}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Link
              href="/wrap-link"
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className: 'w-[112px] rounded-xl border-border bg-transparent text-foreground hover:border-purple',
              })}
            >
              ← Back
            </Link>
            <button
              type="button"
              onClick={handleNext}
              className={buttonStyles({
                variant: 'landing',
                size: 'lg',
                className: 'min-w-0 flex-1 rounded-xl',
              })}
            >
              Continue <span aria-hidden="true">→</span>
            </button>
          </div>
        </PageContainer>
      </div>
    </>
  )
}
