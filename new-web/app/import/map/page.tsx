'use client'

import { useState } from 'react'
import Link from 'next/link'

function FlowBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="bg-card2 border-b border-border px-4 sm:px-8 py-2.5 flex items-center overflow-x-auto" style={{ scrollbarWidth: "none" }}>
      {steps.map((label, i) => (
        <span key={label} className="contents">
          {i > 0 && <span className="mx-2.5 text-border text-[11px]">›</span>}
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
              i < current ? 'bg-success' : i === current ? 'bg-purple' : 'bg-border'
            }`}>{i < current ? '✓' : i + 1}</div>
            <span className={i < current ? 'text-success' : i === current ? 'text-foreground font-semibold' : 'text-muted'}>
              {label}
            </span>
          </div>
        </span>
      ))}
    </div>
  )
}

const steps = ['Choose Source', 'Upload File', 'Map Fields', 'Soul Awakened', 'Pay Gas', 'On-chain']

const TARGET_OPTIONS = [
  'Soul Name',
  'Short Description',
  'Personality Traits',
  'Memory Seed',
  'Tags',
  '— skip —',
]

const DEFAULT_MAPPINGS: Record<string, string> = {
  Name: 'Soul Name',
  Description: 'Short Description',
  Personality: 'Personality Traits',
  Memory: 'Memory Seed',
  Tags: 'Tags',
}

const PREVIEW_MAP: Record<string, string> = {
  'Soul Name': 'AlphaScout',
  'Short Description': 'On-chain signal agent for DeFi alpha detection',
  'Personality Traits': 'Analytical, data-driven',
  'Memory Seed': '(from imported memory block)',
  Tags: 'trading, defi, signals',
}

export default function ImportMapPage() {
  const [mappings, setMappings] = useState<Record<string, string>>(DEFAULT_MAPPINGS)

  function setMapping(source: string, target: string) {
    setMappings((prev) => ({ ...prev, [source]: target }))
  }

  const resolvedPreview = Object.entries(mappings)
    .filter(([, target]) => target && target !== '— skip —')
    .map(([source, target]) => ({ target, value: PREVIEW_MAP[target] ?? `(${source} value)` }))

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} current={2} />

      <div className="max-w-[600px] mx-auto px-6 py-8">
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Import Soul</p>
        <h1 className="font-display text-2xl font-bold mb-1">Step 3 — Map Fields</h1>
        <p className="text-muted text-sm mb-6">Match each source field to its Soul destination.</p>

        {/* Mapping table */}
        <div className="bg-card2 border border-border rounded-xl overflow-hidden mb-6">
          <div className="grid grid-cols-2 text-[11px] font-bold text-muted uppercase tracking-[0.08em] px-5 py-2.5 border-b border-border bg-card">
            <span>Source Field</span>
            <span>Maps To</span>
          </div>
          {Object.keys(DEFAULT_MAPPINGS).map((source, i, arr) => (
            <div
              key={source}
              className={`grid grid-cols-2 items-center px-5 py-3 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}
            >
              <span className="text-sm bg-card rounded-md px-3 py-1.5 text-muted font-mono text-xs mr-4 self-center">
                {source}
              </span>
              <select
                value={mappings[source] ?? ''}
                onChange={(e) => setMapping(source, e.target.value)}
                className="bg-card border border-border text-foreground text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-purple transition"
              >
                {TARGET_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {/* Preview card */}
        <div className="bg-card border border-border rounded-xl p-5 mb-8">
          <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-4">Mapped Preview</p>
          {resolvedPreview.length === 0 ? (
            <p className="text-muted text-sm">All fields skipped — nothing to preview.</p>
          ) : (
            <div className="flex flex-col gap-0">
              {resolvedPreview.map(({ target, value }, i) => (
                <div key={target} className={`flex justify-between text-sm py-2.5 ${i < resolvedPreview.length - 1 ? 'border-b border-border' : ''}`}>
                  <span className="text-muted">{target}</span>
                  <span className="text-right max-w-[280px]">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2.5">
          <Link
            href="/import/upload"
            className="bg-transparent text-foreground border border-border rounded-lg px-4.5 py-2 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <Link
            href="/import/preview"
            className="flex-1 text-center bg-purple text-white font-bold text-[15px] px-7 py-3 rounded-xl hover:bg-purple-deep transition"
          >
            Awaken this Soul →
          </Link>
        </div>
      </div>
    </div>
  )
}
