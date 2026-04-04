'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'

const SOURCES = [
  { id: 'character-ai', emoji: '💬', label: 'Character.AI', desc: 'Import from a Character.AI export file.' },
  { id: 'novel-ai', emoji: '📝', label: 'NovelAI', desc: 'Import from a NovelAI character card.' },
  { id: 'custom-json', emoji: '📋', label: 'Custom JSON', desc: 'Import from a structured JSON file.' },
  { id: 'other', emoji: '📁', label: 'Other', desc: 'Import any supported markdown or text payload.' },
]

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

export default function ImportPage() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} currentStep={0} />

      <PageContainer size="sm" className="space-y-6">
        <SectionHeader
          label="Import Soul"
          title="Step 1 — Choose Source"
          subtitle="Pick the source system. The import flow now follows the same card language and step rhythm as the prototype."
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SOURCES.map((src) => (
            <button
              key={src.id}
              type="button"
              onClick={() => setSelected(src.id)}
              className={`rounded-xl border px-5 py-5 text-left transition ${selected === src.id ? 'border-purple bg-purple/10' : 'card hover:border-purple/50'}`}
            >
              <span className="mb-3 block text-3xl">{src.emoji}</span>
              <p className="font-display text-[1.35rem] font-bold tracking-[-0.03em] text-foreground">{src.label}</p>
              <p className="mt-2 text-sm leading-7 text-muted">{src.desc}</p>
            </button>
          ))}
        </div>

        <Link
          href="/import/upload"
          aria-disabled={!selected}
          tabIndex={!selected ? -1 : undefined}
          className={`${buttonStyles({ variant: 'primary', size: 'lg', full: true })} ${!selected ? 'pointer-events-none opacity-45' : ''}`}
        >
          Next: Upload File <span aria-hidden="true">→</span>
        </Link>
      </PageContainer>
    </div>
  )
}
