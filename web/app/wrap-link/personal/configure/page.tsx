'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { SkillBundleFormatHint } from '@/components/souls/skill-bundle-format-hint'
import { Tag } from '@/components/ui/tag'
import { buttonStyles } from '@/components/ui/button'
import { useWrap, wrapSteps } from '@/components/providers/wrap-provider'
import { useKioskNfts } from '@/lib/hooks/use-kiosk-nfts'
import { useWalletSign } from '@/lib/hooks/use-wallet-sign'
import { validateSelectedSkillBundle } from '@soulidity/sdk'

function FileUploadCard({
  label,
  required,
  file,
  accept,
  acceptLabel,
  onSelect,
  onClear,
  tone,
}: {
  label: string
  required?: boolean
  file: File | null
  accept: string
  acceptLabel?: string
  onSelect: (f: File) => void
  onClear: () => void
  tone: 'amber' | 'violet' | 'teal'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const toneMap = {
    amber: { border: 'border-[#7b5a1e]', bg: 'bg-[rgba(107,69,18,0.12)]', text: 'text-[#f4c36c]', accent: 'text-[#ddae5a]' },
    violet: { border: 'border-[#4f2d84]', bg: 'bg-[rgba(92,47,162,0.1)]', text: 'text-[#cfb0ff]', accent: 'text-[#b889ff]' },
    teal: { border: 'border-[#165c65]', bg: 'bg-[rgba(19,102,108,0.1)]', text: 'text-[#8ceae0]', accent: 'text-[#58d3c7]' },
  }
  const t = toneMap[tone]

  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} px-4 py-4`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-sm font-bold ${t.text}`}>{label}</span>
        {required && <Tag color="danger">Required</Tag>}
        {!required && <Tag color="muted">Optional</Tag>}
      </div>

      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) onSelect(f)
        e.target.value = ''
      }} />

      {!file ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`w-full rounded-lg border border-dashed ${t.border} px-4 py-6 text-center transition hover:border-purple`}
        >
          <p className="text-sm font-semibold text-foreground">Click to upload</p>
          <p className="mt-1 text-xs text-muted">{acceptLabel ?? `${accept} format`}</p>
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-teal/30 bg-teal/8 px-3 py-2.5">
          <span className="text-teal">✓</span>
          <span className={`text-sm font-semibold ${t.text} flex-1 truncate`}>{file.name}</span>
          <button onClick={onClear} className="text-xs text-muted hover:text-foreground transition">✕</button>
        </div>
      )}
    </div>
  )
}

export default function ConfigurePage() {
  const router = useRouter()
  const ctx = useWrap()
  const { suiWallet } = useWalletSign()
  const { data: nfts } = useKioskNfts(suiWallet?.address)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [skillBundleError, setSkillBundleError] = useState<string | null>(null)
  const [skillBundleName, setSkillBundleName] = useState<string | null>(null)
  const selectedNftAvailable = !!ctx.selectedNft && (!nfts || nfts.some((nft) => nft.objectId === ctx.selectedNft?.objectId))

  // Guard: redirect if no NFT selected
  useEffect(() => {
    if (ctx.selectedNft && nfts && !selectedNftAvailable) {
      ctx.setSelectedNft(null)
      router.replace('/wrap-link/personal')
      return
    }

    if (!ctx.selectedNft) {
      router.replace('/wrap-link/personal')
    }
  }, [ctx, ctx.selectedNft, nfts, selectedNftAvailable, router])

  if (!ctx.selectedNft || (nfts && !selectedNftAvailable)) return null

  function handleNext() {
    const nextErrors: Record<string, string> = {}
    if (!ctx.charFile) nextErrors.charFile = 'Soul Character file is required'
    if (!ctx.memoryFile) nextErrors.memoryFile = 'Memory file (memory.md) is required'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setErrors({})
    router.push('/wrap-link/personal/preview')
  }

  async function handleSkillsFileSelect(file: File) {
    const result = await validateSelectedSkillBundle(file)
    if (!result.ok) {
      ctx.setSkillsFile(null)
      setSkillBundleName(null)
      setSkillBundleError(result.error)
      return
    }

    setSkillBundleError(null)
    setSkillBundleName(result.skillName)
    ctx.setSkillsFile(file)
  }

  return (
    <>
      <FlowBar steps={wrapSteps} currentStep={1} />
      <div className="relative z-10 border-t border-purple/20">
        <PageContainer size="sm" className="space-y-5 pt-7 sm:pt-9">
          <SectionHeader
            label="Personal Join"
            title="Add Soul Layers"
            subtitle="Upload the character definition and memory for this Soul."
            className="mb-1"
          />

          {/* Selected NFT banner */}
          <div className="flex items-center gap-3 rounded-xl border border-purple/30 bg-card2/75 px-4 py-3">
            {ctx.selectedNft.imageUrl ? (
              <Image src={ctx.selectedNft.imageUrl} alt={ctx.selectedNft.name} width={40} height={40} unoptimized className="h-10 w-10 shrink-0 rounded-lg border border-border/50 object-cover" />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple/20 text-sm font-bold text-action-label">
                {ctx.selectedNft.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-foreground">{ctx.selectedNft.name}</div>
              <div className="text-xs text-muted">Wrapping...</div>
            </div>
          </div>

          <div className="space-y-3">
            <FileUploadCard
              label="Soul Character"
              required
              file={ctx.charFile}
              accept=".md,text/markdown"
              acceptLabel=".md only"
              onSelect={ctx.setCharFile}
              onClear={() => ctx.setCharFile(null)}
              tone="amber"
            />
            {errors.charFile && <p className="text-[11px] font-medium text-danger">{errors.charFile}</p>}

            <FileUploadCard
              label="Memory"
              required
              file={ctx.memoryFile}
              accept=".md,text/markdown"
              acceptLabel=".md only"
              onSelect={ctx.setMemoryFile}
              onClear={() => ctx.setMemoryFile(null)}
              tone="violet"
            />
            {errors.memoryFile && <p className="text-[11px] font-medium text-danger">{errors.memoryFile}</p>}

            <FileUploadCard
              label="Skills & Docs"
              file={ctx.skillsFile}
              accept=".zip,application/zip,application/x-zip-compressed"
              acceptLabel={ctx.skillsFile && skillBundleName ? `.zip only · Skill: ${skillBundleName}` : '.zip only'}
              onSelect={(file) => {
                void handleSkillsFileSelect(file)
              }}
              onClear={() => {
                ctx.setSkillsFile(null)
                setSkillBundleName(null)
                setSkillBundleError(null)
              }}
              tone="teal"
            />
            {(!ctx.skillsFile || skillBundleError) && (
              <SkillBundleFormatHint error={skillBundleError} />
            )}

          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/wrap-link/personal"
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
