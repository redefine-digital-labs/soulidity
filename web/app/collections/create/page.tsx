'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Input, Textarea } from '@/components/ui/input'
import { CoverImagePicker } from '@/components/ui/cover-image-picker'
import { buttonStyles } from '@/components/ui/button'
import { parseDisplayAmountToAtomic } from '@/lib/soulidity/format'
import { MAX_COLLECTION_SUPPLY } from '@/lib/soulidity/tx/shared'
import { parseCollectionSupplyCapInput } from '@/lib/collections/supply-cap'
import { useCreateCollection, collectionSteps } from '@/components/providers/create-collection-provider'

const royaltyOptions = [
  { value: 0, label: 'Off', desc: '0%' },
  { value: 250, label: 'Low', desc: '2.5%' },
  { value: 500, label: 'Standard', desc: '5%' },
  { value: 1000, label: 'High', desc: '10%' },
] as const

function FieldLabel({ label, hint, required }: { label: string; hint?: string; required?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="page-kicker text-muted">{label}</span>
      {required && <span className="text-xs font-semibold text-danger">*</span>}
      {hint && <span className="text-[11px] font-normal text-muted/70">— {hint}</span>}
    </div>
  )
}

const memoryPolicyRules = [
  { label: 'Soul Character required', desc: 'standard soul.md template · one locked identity layer per Soul' },
  { label: 'Founding memory locked', desc: 'each mint starts with one encrypted memory seed' },
  { label: 'Grant-gated write', desc: 'only authorized agents can add later memory entries' },
  { label: 'History preserved', desc: 'new sessions add records instead of replacing the seed' },
  { label: 'Revocable access', desc: 'SoulGrant can be revoked anytime' },
]

export default function CreateCollectionPage() {
  const router = useRouter()
  const ctx = useCreateCollection()
  const [errors, setErrors] = useState<Record<string, string>>({})

  function handleNext() {
    const nextErrors: Record<string, string> = {}
    if (!ctx.name.trim()) nextErrors.name = 'Required'
    if (!ctx.coverImageFile) nextErrors.coverImage = 'Required'
    if (!ctx.description.trim()) nextErrors.description = 'Required'
    if (!ctx.floorPrice.trim()) {
      nextErrors.floorPrice = 'Required'
    } else if (isNaN(Number(ctx.floorPrice)) || Number(ctx.floorPrice) < 0) {
      nextErrors.floorPrice = 'Must be a non-negative number'
    } else {
      try {
        const atomic = parseDisplayAmountToAtomic(ctx.floorPrice)
        // DECIMAL(20,0) max: 20 digits
        if (atomic > 99_999_999_999_999_999_999n) {
          nextErrors.floorPrice = 'Floor price is too large'
        }
      } catch (e) {
        nextErrors.floorPrice = e instanceof Error ? e.message : 'Invalid amount'
      }
    }
    if (!ctx.unlimitedSupply) {
      try {
        parseCollectionSupplyCapInput(ctx.supplyCap)
      } catch (e) {
        nextErrors.supplyCap = e instanceof Error ? e.message : 'Invalid supply cap'
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    router.push('/collections/create/souls')
  }

  return (
    <>
      <FlowBar steps={collectionSteps} currentStep={0} />

      <div className="relative z-10 border-t border-purple/20">
        <PageContainer size="sm" className="space-y-6 pt-7 sm:pt-9">
          <SectionHeader
            label="Create Soul Collection"
            title="Step 1 — Collection Info"
            subtitle="Define your collection's identity. All metadata can be edited until Launch — after that it's locked on-chain."
            className="mb-2"
          />

          <div className="space-y-5">
            {/* Collection Name */}
            <div className="space-y-2">
              <FieldLabel label="Collection Name" required />
              <Input
                value={ctx.name}
                placeholder="e.g. Cyber Sentinels, Wild Fern Spirits..."
                className="h-11 rounded-xl border-purple/35 bg-card2/90 px-4 placeholder:text-[#5f4f90] focus:border-purple"
                onChange={(e) => ctx.setName(e.target.value)}
              />
              {errors.name && <p className="text-[11px] font-medium text-danger">{errors.name}</p>}
            </div>

            {/* Cover Image */}
            <div className="space-y-2">
              <FieldLabel label="Cover Image" required />
              <CoverImagePicker
                file={ctx.coverImageFile}
                previewUrl={ctx.coverImagePreviewUrl}
                onChange={(file) => ctx.setCoverImage(file)}
                label="Upload cover image"
                className="rounded-[20px] border-purple/40 bg-[rgba(20,11,44,0.72)] px-6 py-10 text-center hover:border-purple hover:bg-purple/6"
              />
              {errors.coverImage && <p className="text-[11px] font-medium text-danger">{errors.coverImage}</p>}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <FieldLabel label="Description" required />
              <Textarea
                value={ctx.description}
                placeholder="What is this Collection about? Why does it exist?"
                className="min-h-[104px] resize-none rounded-xl border-purple/35 bg-card2/90 px-4 py-3 placeholder:text-[#5f4f90] focus:border-purple"
                onChange={(e) => ctx.setDescription(e.target.value)}
              />
              {errors.description && <p className="text-[11px] font-medium text-danger">{errors.description}</p>}
            </div>

            {/* Total Supply Cap */}
            <div className="space-y-2">
              <FieldLabel label="Total Supply Cap" required={!ctx.unlimitedSupply} />
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  max={MAX_COLLECTION_SUPPLY}
                  step={1}
                  value={ctx.unlimitedSupply ? '' : ctx.supplyCap}
                  placeholder="10000"
                  disabled={ctx.unlimitedSupply}
                  className={`h-11 w-32 rounded-xl border-purple/35 bg-card2/90 px-4 placeholder:text-[#5f4f90] focus:border-purple [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                    ctx.unlimitedSupply ? 'opacity-50' : ''
                  }`}
                  onChange={(e) => ctx.setSupplyCap(e.target.value)}
                />
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={ctx.unlimitedSupply}
                    onChange={(e) => ctx.setUnlimitedSupply(e.target.checked)}
                    className="h-4 w-4 rounded border-purple/40 bg-card2/80 text-purple focus:ring-purple"
                  />
                  Unlimited (no on-chain cap)
                </label>
              </div>
              <p className="text-xs text-muted">Enforced on-chain. Created after launch and locked — no later edits.</p>
              {errors.supplyCap && <p className="text-[11px] font-medium text-danger">{errors.supplyCap}</p>}
            </div>

            {/* Floor Price */}
            <div className="space-y-2">
              <FieldLabel label="Floor Price (USDC)" hint="minimum listing price per Soul" required />
              <Input
                type="number"
                min={0}
                step="any"
                value={ctx.floorPrice}
                placeholder="e.g. 10"
                className="h-11 w-40 rounded-xl border-purple/35 bg-card2/90 px-4 placeholder:text-[#5f4f90] focus:border-purple [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onChange={(e) => ctx.setFloorPrice(e.target.value)}
              />
              <p className="text-xs text-muted">App-enforced minimum — listings below this price are blocked in the marketplace UI and mirror API.</p>
              {errors.floorPrice && <p className="text-[11px] font-medium text-danger">{errors.floorPrice}</p>}
            </div>

            {/* Creator Royalty on Resale */}
            <div className="space-y-2">
              <FieldLabel label="Creator Royalty on Resale" />
              <div className="grid grid-cols-4 gap-2.5">
                {royaltyOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => ctx.setExtraRoyaltyBps(opt.value)}
                    className={`relative flex min-h-[72px] min-w-0 flex-col items-center justify-center rounded-2xl border px-2 pb-3 pt-3 text-center transition ${
                      ctx.extraRoyaltyBps === opt.value
                        ? 'border-purple bg-purple/12 shadow-[0_10px_24px_rgba(124,58,237,0.18)]'
                        : 'border-border bg-card2/40 hover:border-purple/40 hover:bg-purple/6'
                    }`}
                  >
                    <div className="font-display text-[13px] font-bold tracking-[-0.02em] text-foreground">
                      {opt.label}
                    </div>
                    <div className="mt-1 text-[11px] leading-4 text-muted">{opt.desc}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs leading-5 text-muted">
                Applies to all Souls in this Collection. Locked at Launch. Royalty goes to whoever holds the Soul Collection.
              </p>
            </div>

            {/* Soul Collection + Resale */}
            <div className="space-y-2">
              <FieldLabel label="Soul Collection + Resale" />
              <div className={`card rounded-2xl border px-5 py-5 ${ctx.tradeable ? 'border-purple/40 bg-purple/8' : 'border-border bg-card2/55'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {ctx.tradeable ? 'Tradeable — open market resale enabled' : 'Non-tradeable — resale disabled'}
                    </div>
                    <p className="mt-1 text-[13px] leading-6 text-muted">
                      Whoever holds this Soul Collection earns the royalty. You can list it for sale from My Collections after Launch.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => ctx.setTradeable(!ctx.tradeable)}
                    className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors ${ctx.tradeable ? 'bg-[linear-gradient(135deg,var(--purple),var(--purple-deep))]' : 'bg-muted/30'}`}
                    aria-pressed={ctx.tradeable}
                    aria-label="Toggle whether the Collection right is tradeable"
                  >
                    <span className={`absolute left-0 top-1 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${ctx.tradeable ? 'translate-x-7' : 'translate-x-1'}`} />
                  </button>
                </div>
                {ctx.tradeable && (
                  <div className="mt-4 space-y-2 rounded-xl border border-purple/20 bg-card2/60 px-4 py-3 text-[13px] leading-6 text-muted">
                    <p>
                      <span className="mr-1.5 text-purple">✦</span>
                      After Launch you can list the Soul Collection on the open market — buyers acquire the royalty stream.
                    </p>
                    <p>
                      <span className="mr-1.5 text-gold">💡</span>
                      Listing price is set when you choose to sell, not now. You keep the royalty as long as you hold the NFT.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Collection-Level Memory Policy */}
            <div className="space-y-2">
              <FieldLabel label="Collection-Level Memory Policy" />
              <div className="card rounded-2xl border-border bg-card2/55 px-5 py-5">
                <p className="text-[13px] leading-6 text-muted">
                  All Souls in this collection inherit these rules. These are protocol-level — not configurable.
                </p>
                <div className="mt-4 space-y-3">
                  {memoryPolicyRules.map((rule) => (
                    <div key={rule.label} className="flex items-start gap-2.5">
                      <span className="mt-0.5 shrink-0 text-sm text-purple">✓</span>
                      <p className="text-[13px] leading-5 text-muted">
                        <span className="font-semibold text-foreground">{rule.label}</span>
                        {'  '}— {rule.desc}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <Link
              href="/market"
              className={buttonStyles({
                variant: 'outline',
                size: 'lg',
                className: 'w-[112px] rounded-xl border-border bg-transparent text-foreground hover:border-purple hover:text-foreground',
              })}
            >
              Cancel
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
              Next: Add Souls <span aria-hidden="true">→</span>
            </button>
          </div>
        </PageContainer>
      </div>
    </>
  )
}
