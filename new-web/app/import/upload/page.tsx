'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

const PARSED_FIELDS = [
  { label: 'Name', value: 'AlphaScout' },
  { label: 'Description', value: 'On-chain signal agent for DeFi alpha detection' },
  { label: 'Personality', value: 'Analytical, data-driven' },
  { label: 'Tags', value: 'trading, defi, signals' },
]

export default function ImportUploadPage() {
  const [uploaded, setUploaded] = useState(false)
  const [dragging, setDragging] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    setUploaded(true)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave() {
    setDragging(false)
  }

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} currentStep={1} />

      <PageContainer size="sm" className="space-y-6">
        <SectionHeader
          label="Import Soul"
          title="Step 2 — Upload File"
          subtitle="Drop your export file and preview the parsed fields before you continue into the Soul creation flow."
        />

        <button
          type="button"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => setUploaded((v) => !v)}
          className={`flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragging
              ? 'border-purple bg-purple/10'
              : uploaded
              ? 'border-success bg-success/10'
              : 'card hover:border-purple/60'
          }`}
        >
          {uploaded ? (
            <>
              <span className="text-4xl">✅</span>
              <p className="text-base font-semibold text-success">alphascout_export.json</p>
              <p className="text-sm text-muted">Click to reset the selected file</p>
            </>
          ) : (
            <>
              <span className="text-4xl text-muted">📂</span>
              <p className="text-base font-semibold text-foreground">Drop your file here</p>
              <p className="text-sm text-muted">Accepts .json, .md, .txt or click to choose a local export.</p>
            </>
          )}
        </button>

        {uploaded && (
          <div className="card px-5 py-5">
            <div className="page-kicker mb-4">Parsed Fields</div>
            <div className="space-y-3">
              {PARSED_FIELDS.map((field) => (
                <div key={field.label} className="flex flex-col items-start gap-2 rounded-xl border border-border/70 bg-white/[0.03] px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <span className="text-sm font-semibold text-muted">{field.label}</span>
                  <span className="max-w-[280px] text-left text-sm leading-6 text-foreground sm:text-right">{field.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <Link href="/import" className={buttonStyles({ variant: 'outline', size: 'lg', className: 'w-full sm:w-auto' })}>
            ← Back
          </Link>
          <Link
            href="/import/map"
            aria-disabled={!uploaded}
            tabIndex={!uploaded ? -1 : undefined}
            className={`${buttonStyles({ variant: 'primary', size: 'lg', full: true })} ${!uploaded ? 'pointer-events-none opacity-45' : ''}`}
          >
            Next: Map Fields <span aria-hidden="true">→</span>
          </Link>
        </div>
      </PageContainer>
    </div>
  )
}
