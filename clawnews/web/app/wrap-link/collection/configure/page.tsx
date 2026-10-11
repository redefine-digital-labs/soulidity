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

const activationPolicies = [
  { value: 'public', label: 'Public', desc: 'Anyone can interact with the collection Soul', icon: '🌐' },
  { value: 'holder', label: 'Holder-only', desc: 'Only current NFT holders can activate', icon: '🔑' },
  { value: 'creator', label: 'Creator-only', desc: 'Controlled by the collection creator', icon: '🛡️' },
]

export default function CollectionConfigurePage() {
  const [fileName, setFileName] = useState('')
  const [templateDesc, setTemplateDesc] = useState('')
  const [policy, setPolicy] = useState('holder')

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setFileName(file.name)
  }

  return (
    <div className="relative z-10">
      <FlowBar steps={['Collection Info', 'Configure', 'Preview', 'Gas', 'Success']} current={1} />

      <div className="max-w-[540px] mx-auto px-6 py-8">
        <p className="text-[11px] font-bold text-purple uppercase tracking-[0.1em] mb-1.5">Collection Expand</p>
        <h1 className="font-display text-2xl font-bold mb-1">Step 2 — Configure</h1>
        <p className="text-muted text-sm mb-6">Set the collection-level Soul template and shared activation rules.</p>

        {/* Template Upload */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">
            Collection Soul Template <span className="text-danger">*</span>
          </label>
          <label className="block border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-purple hover:bg-purple/5 transition">
            <input type="file" accept=".md,.txt" className="hidden" onChange={handleFileChange} />
            <div className="text-2xl mb-2">📦</div>
            {fileName ? (
              <div>
                <div className="font-semibold text-sm text-purple">{fileName}</div>
                <div className="text-muted text-xs mt-1">Click to replace</div>
              </div>
            ) : (
              <div>
                <div className="font-semibold text-sm mb-1">Upload Collection-Level Soul Template (.md)</div>
                <div className="text-muted text-xs">Shared character base for all NFTs in the collection. Max 2MB.</div>
              </div>
            )}
          </label>
        </div>

        {/* Template Description */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-1.5">
            Template Description
          </label>
          <textarea
            className="w-full bg-card2 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-purple placeholder:text-border resize-y min-h-24"
            placeholder="Describe the shared Soul archetype — lore, personality traits, behavioral patterns shared by all holders..."
            value={templateDesc}
            onChange={(e) => setTemplateDesc(e.target.value)}
          />
          <div className="text-right text-[11px] text-muted mt-1">{templateDesc.length} chars</div>
        </div>

        {/* Activation Policy */}
        <div className="mb-6">
          <label className="block text-xs font-semibold text-muted uppercase tracking-[0.08em] mb-2">
            Collection Activation Policy
          </label>
          <div className="flex flex-col gap-2">
            {activationPolicies.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPolicy(opt.value)}
                className={`w-full text-left border rounded-xl px-4 py-3 transition flex items-center gap-3 ${
                  policy === opt.value
                    ? 'border-purple bg-purple/10'
                    : 'border-border hover:border-purple/50'
                }`}
              >
                <div className="text-xl shrink-0">{opt.icon}</div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">{opt.label}</div>
                  <div className="text-xs text-muted">{opt.desc}</div>
                </div>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  policy === opt.value ? 'border-purple bg-purple' : 'border-border'
                }`}>
                  {policy === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2.5">
          <Link
            href="/wrap-link/collection"
            className="bg-transparent text-foreground border border-border rounded-lg px-4 py-2 text-sm font-semibold hover:border-purple transition"
          >
            ← Back
          </Link>
          <Link
            href="/wrap-link/collection/preview"
            className="flex-1 block bg-purple text-white font-bold text-[15px] text-center px-7 py-3 rounded-xl hover:opacity-90 transition"
          >
            Next Step →
          </Link>
        </div>
      </div>
    </div>
  )
}
