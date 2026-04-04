'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { Textarea } from '@/components/ui/input'
import { UploadZone } from '@/components/ui/upload-zone'
import { buttonStyles } from '@/components/ui/button'

const steps = [
  { label: 'Basic Info' },
  { label: 'Living Content' },
  { label: 'Soul Awakened' },
  { label: 'Pay Gas' },
  { label: 'On-chain' },
]

export default function CreateContentPage() {
  const [memorySeed, setMemorySeed] = useState('')
  const [charFile, setCharFile] = useState<File | null>(null)
  const [skillsFile, setSkillsFile] = useState<File | null>(null)

  return (
    <div className="relative z-10">
      <FlowBar steps={steps} currentStep={1} />

      <PageContainer size="sm" className="space-y-6">
        <SectionHeader
          label="Create Soul"
          title="Step 2 — Living Content"
          subtitle="Upload the Soul character definition and write the encrypted founding memory that becomes its protected core."
        />

        <div className="space-y-5">
          {/* Soul Character File — Required */}
          <div className="space-y-2">
            <label className="page-kicker text-muted">Soul Character File *</label>
            {!charFile ? (
              <UploadZone
                icon="📄"
                label="Upload Soul Character file"
                sublabel="Markdown only. Defines appearance, personality, and skill schema."
                accept=".md"
                onFileSelect={setCharFile}
              />
            ) : (
              <div className="card flex items-center gap-4 border-success/40 bg-success/10 px-5 py-4">
                <span className="text-2xl text-success">✓</span>
                <div className="flex-1">
                  <div className="text-base font-semibold text-foreground">{charFile.name} uploaded</div>
                  <div className="text-sm text-muted">
                    {(charFile.size / 1024).toFixed(1)} KB · v1 · main
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCharFile(null)}
                  className="text-sm text-muted hover:text-foreground transition-colors"
                >
                  Replace
                </button>
              </div>
            )}
          </div>

          {/* Memory Seed — Required */}
          <div className="space-y-2">
            <label className="page-kicker text-muted">Memory Seed *</label>
            <Textarea
              className="min-h-[180px]"
              placeholder="Write the founding memory of this Soul. This becomes the encrypted core identity stored on Walrus."
              value={memorySeed}
              onChange={(e) => setMemorySeed(e.target.value)}
            />
            <div className="rounded-[10px] border border-purple/30 bg-purple/10 px-4 py-4 text-sm leading-6 text-purple">
              🔐 The Memory Seed is encrypted at rest on Walrus. Only the Soul owner or a SoulGrant-authorized agent can decrypt it.
            </div>
          </div>

          {/* Skills & Docs — Optional */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="page-kicker text-muted">Skills & Docs</label>
              <span className="text-[10px] font-bold bg-white/5 text-muted px-2 py-0.5 rounded-full">Optional</span>
            </div>
            {!skillsFile ? (
              <UploadZone
                icon="🔧"
                label="Upload Skills & Docs archive"
                sublabel=".zip format · Added as v1 skills version after mint"
                accept=".zip"
                onFileSelect={setSkillsFile}
              />
            ) : (
              <div className="card flex items-center gap-4 border-purple/40 bg-purple/10 px-5 py-4">
                <span className="text-2xl text-purple">✓</span>
                <div className="flex-1">
                  <div className="text-base font-semibold text-foreground">{skillsFile.name} uploaded</div>
                  <div className="text-sm text-muted">
                    {(skillsFile.size / 1024).toFixed(1)} KB · will become v1 skills
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSkillsFile(null)}
                  className="text-sm text-muted hover:text-foreground transition-colors"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <Link href="/create" className={buttonStyles({ variant: 'outline', size: 'lg', className: 'w-full sm:w-auto' })}>
            ← Back
          </Link>
          <Link href="/create/preview" className={buttonStyles({ variant: 'primary', size: 'lg', full: true })}>
            Awaken this Soul <span aria-hidden="true">→</span>
          </Link>
        </div>
      </PageContainer>
    </div>
  )
}
