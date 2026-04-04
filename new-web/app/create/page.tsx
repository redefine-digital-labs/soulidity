'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Input, Textarea } from '@/components/ui/input'
import { buttonStyles } from '@/components/ui/button'

const royaltyOptions = [
  { value: 0, label: 'Off', desc: '0% royalty' },
  { value: 3, label: 'Low', desc: '3% on resale' },
  { value: 5, label: 'Standard', desc: '5% on resale' },
  { value: 7, label: 'High', desc: '7% on resale' },
  { value: 10, label: 'Max', desc: '10% on resale' },
]

const steps = [
  { label: 'Basic Info' },
  { label: 'Living Content' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

export default function CreateSoulPage() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [listNow, setListNow] = useState(true)
  const [royalty, setRoyalty] = useState(5)

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} currentStep={0} />

      <PageContainer size="sm" className="space-y-6">
        <SectionHeader
          label="Create Soul"
          title="Step 1 — Basic Info"
          subtitle="Define your Soul's identity, cover, and initial market listing from the same design language as the prototype flow."
        />

        <div className="space-y-5">
          <div className="space-y-2">
            <label className="page-kicker text-muted">Soul Name *</label>
            <Input
              placeholder="e.g. AlphaScout"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="page-kicker text-muted">Short Description *</label>
            <Textarea
              placeholder="What does this Soul do? Keep it concise but legible on the market card."
              maxLength={280}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="text-right text-xs text-muted">{description.length}/280</div>
          </div>

          <div className="space-y-2">
            <label className="page-kicker text-muted">Cover Image</label>
            <button className="card card-hover flex w-full flex-col items-center justify-center gap-2 border-dashed px-6 py-10 text-center">
              <span className="text-4xl">📷</span>
              <span className="text-base font-semibold text-foreground">Upload cover image</span>
              <span className="text-sm text-muted">PNG, JPG, or WebP. Max 5MB.</span>
            </button>
          </div>

          <div className="space-y-2">
            <label className="page-kicker text-muted">Starting Price (USDC) *</label>
            <Input
              placeholder="0.00"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>

          <div className="card flex flex-col items-start gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-base font-semibold text-foreground">List immediately</div>
              <div className="mt-1 text-sm leading-6 text-muted">Make this Soul available in the market right away after minting.</div>
            </div>
            <button
              type="button"
              onClick={() => setListNow(!listNow)}
              className={`relative h-8 w-14 rounded-full transition-colors ${listNow ? 'bg-[linear-gradient(135deg,var(--purple),var(--purple-deep))]' : 'bg-border'}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-transform ${listNow ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </div>

          <div className="space-y-2">
            <label className="page-kicker text-muted">Royalty on Secondary Resales</label>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              {royaltyOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRoyalty(opt.value)}
                  className={`rounded-xl border px-4 py-4 text-left transition ${royalty === opt.value ? 'border-purple bg-purple/10' : 'border-border bg-white/[0.03] hover:border-purple/55'}`}
                >
                  <div className="font-display text-lg font-bold tracking-[-0.03em] text-foreground">{opt.label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <Link href="/create/content" className={buttonStyles({ variant: 'primary', size: 'lg', full: true })}>
          Next Step <span aria-hidden="true">→</span>
        </Link>
      </PageContainer>
    </div>
  )
}
