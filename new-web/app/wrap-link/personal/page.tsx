'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'

const mockNFTs = [
  { emoji: '🤖', name: 'CyberBeast', number: '#0042', collection: 'Cyber Agents Genesis', floor: '40 USDC' },
  { emoji: '👾', name: 'PixelPunk', number: '#1337', collection: 'Neon Warriors', floor: '38 USDC' },
  { emoji: '🐉', name: 'AncientDragon', number: '#7', collection: 'Ancient Spirits', floor: '42 USDC' },
]

const steps = [
  { label: 'Select NFT' },
  { label: 'Configure' },
  { label: 'Preview' },
  { label: 'Gas' },
  { label: 'Success' },
]

export default function PersonalSelectPage() {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} currentStep={0} />

      <PageContainer size="sm" className="space-y-6">
        <SectionHeader
          label="Personal Join"
          title="Step 1 — Select NFT"
          subtitle="Choose the NFT that will be expanded into a Soul-backed asset. The selection list now matches the shared card system."
        />

        <div className="space-y-3">
          {mockNFTs.map((nft, i) => (
            <button
              key={nft.name + nft.number}
              type="button"
              onClick={() => setSelected(i)}
              className={`w-full rounded-xl border px-5 py-5 text-left transition ${selected === i ? 'border-purple bg-purple/10' : 'card hover:border-purple/50'}`}
            >
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-white/[0.04] text-3xl">
                  {nft.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[1.35rem] font-bold tracking-[-0.03em] text-foreground">
                      {nft.name} {nft.number}
                    </span>
                    {selected === i && <Tag color="purple">Selected</Tag>}
                  </div>
                  <div className="mt-1 text-sm text-muted">{nft.collection}</div>
                  <div className="mt-2 text-sm text-muted">
                    Floor <span className="font-semibold text-gold">{nft.floor}</span>
                  </div>
                </div>
                <div className={`flex h-6 w-6 shrink-0 self-end items-center justify-center rounded-full border-2 sm:self-auto ${selected === i ? 'border-purple bg-purple' : 'border-border bg-transparent'}`}>
                  {selected === i && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
                </div>
              </div>
            </button>
          ))}
        </div>

        <Link
          href="/wrap-link/personal/configure"
          className={`${buttonStyles({ variant: 'primary', size: 'lg', full: true })} ${selected === null ? 'pointer-events-none opacity-45' : ''}`}
        >
          Next Step <span aria-hidden="true">→</span>
        </Link>
      </PageContainer>
    </div>
  )
}
