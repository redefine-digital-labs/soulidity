'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { useImportSoul } from '@/components/providers/import-soul-provider'

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const SOURCES = [
  {
    id: 'local-file' as const,
    icon: '📁',
    label: 'Local File',
    desc: 'Upload a .JSON, .MD, or folder export from OpenRouter, Claude Projects, Mindplug, or any custom format. Fields will be auto-detected and mapped automatically.',
    enabled: true,
  },
] as const

export default function ImportPage() {
  const router = useRouter()
  const ctx = useImportSoul()

  function handleSelect(id: 'local-file') {
    ctx.setSourceType(id)
  }

  function handleNext() {
    if (ctx.sourceType) {
      router.push('/import/upload')
    }
  }

  return (
    <div className="relative z-10 border-t border-purple/20">
      <FlowBar steps={steps} currentStep={0} />

      <PageContainer size="sm" className="space-y-6 pt-7 sm:pt-9">
        <SectionHeader
          label="Import Soul"
          title="Choose Source"
          subtitle="Select where your existing Soul data lives. It will be mapped to Basic Info, Character, Memory, and Skills layers — and minted as an imported Soul on Sui."
        />

        <div className="space-y-3">
          {SOURCES.map((src) => {
            const isSelected = ctx.sourceType === src.id
            const isDisabled = !src.enabled

            return (
              <button
                key={src.id}
                type="button"
                disabled={isDisabled}
                onClick={() => src.enabled && handleSelect(src.id as 'local-file')}
                className={`relative flex w-full items-start gap-4 rounded-2xl border px-5 py-5 text-left transition ${
                  isSelected
                    ? 'border-purple bg-purple/10 shadow-[0_8px_24px_rgba(124,58,237,0.15)]'
                    : isDisabled
                      ? 'cursor-not-allowed border-border/50 bg-card2/40 opacity-60'
                      : 'border-border bg-card2/60 hover:border-purple/50 hover:bg-card2/80'
                }`}
              >
                <span className="mt-0.5 text-2xl">{src.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-foreground">{src.label}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-6 text-muted">{src.desc}</p>
                </div>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/market"
            className={buttonStyles({
              variant: 'outline',
              size: 'lg',
              className: 'w-[112px] rounded-xl border-border bg-transparent text-foreground hover:border-purple hover:text-foreground',
            })}
          >
            ← Cancel
          </Link>
          <button
            type="button"
            disabled={!ctx.sourceType}
            onClick={handleNext}
            className={buttonStyles({
              variant: 'landing',
              size: 'lg',
              className: `min-w-0 flex-1 rounded-xl ${!ctx.sourceType ? 'pointer-events-none opacity-45' : ''}`,
            })}
          >
            Next: Upload File <span aria-hidden="true">→</span>
          </button>
        </div>
      </PageContainer>
    </div>
  )
}
