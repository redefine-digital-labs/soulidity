'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { strToU8, zipSync } from 'fflate'
import { FlowBar } from '@/components/nav/flow-bar'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { buttonStyles } from '@/components/ui/button'
import { useImportSoul } from '@/components/providers/import-soul-provider'
import { parseImportFile } from '@/lib/import/file-parser'

const steps = [
  { label: 'Choose Source' },
  { label: 'Upload File' },
  { label: 'Map Fields' },
  { label: 'Preview & Confirm' },
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
  {
    id: 'animacraft' as const,
    icon: '✦',
    label: 'Animacraft Maker',
    desc: 'Continue from a published Animacraft OC. Its rendered PNG, Living Content, Maker id, and recipe provenance are carried into the canonical Soul mint.',
    enabled: false,
  },
] as const

const MAX_PROFILE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

interface AnimacraftOcPackage {
  schemaVersion?: string
  profile?: { name?: unknown; description?: unknown; tags?: unknown }
  recipe?: unknown
  livingContent?: { content?: { soulMd?: unknown; memoryMd?: unknown; skillMd?: unknown } }
  integrity?: { recipeHash?: unknown }
}

function handoffUrl(value: string, label: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} is not a valid URL.`)
  }
  if (url.protocol !== 'https:') throw new Error(`${label} must use HTTPS.`)
  return url
}

async function responseBlobWithinLimit(response: Response, limit: number, label: string): Promise<Blob> {
  if (!response.ok) throw new Error(`${label} returned ${response.status}.`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > limit) throw new Error(`${label} exceeds the ${(limit / 1024 / 1024).toFixed(0)} MB limit.`)
  const blob = await response.blob()
  if (blob.size > limit) throw new Error(`${label} exceeds the ${(limit / 1024 / 1024).toFixed(0)} MB limit.`)
  return blob
}

function safeFileStem(value: unknown): string {
  const normalized = String(value || 'animacraft-oc').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized.slice(0, 64) || 'animacraft-oc'
}

export default function ImportPage() {
  const router = useRouter()
  const ctx = useImportSoul()
  const handoffStarted = useRef(false)
  const [handoffStatus, setHandoffStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [handoffError, setHandoffError] = useState('')

  useEffect(() => {
    if (handoffStarted.current) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('source') !== 'animacraft') return
    handoffStarted.current = true

    const prepare = async () => {
      await Promise.resolve()
      setHandoffStatus('loading')
      ctx.setSourceType('animacraft')
      const makerId = String(params.get('maker') || '').trim()
      if (!/^0x[0-9a-f]+$/i.test(makerId)) throw new Error('The Animacraft Maker id is missing or invalid.')
      const profileUrl = handoffUrl(String(params.get('profile') || ''), 'Animacraft profile URL')
      const imageUrl = handoffUrl(String(params.get('image') || ''), 'Animacraft image URL')
      const [profileBlob, imageBlob] = await Promise.all([
        fetch(profileUrl, { cache: 'no-store', credentials: 'omit' }).then((response) => responseBlobWithinLimit(response, MAX_PROFILE_BYTES, 'Animacraft profile')),
        fetch(imageUrl, { cache: 'no-store', credentials: 'omit' }).then((response) => responseBlobWithinLimit(response, MAX_IMAGE_BYTES, 'Animacraft image')),
      ])
      let ocPackage: AnimacraftOcPackage
      try {
        ocPackage = JSON.parse(await profileBlob.text()) as AnimacraftOcPackage
      } catch {
        throw new Error('The Animacraft profile is not valid JSON.')
      }
      if (ocPackage?.schemaVersion !== 'animacraft.oc-package.v1' || !ocPackage.profile || !Array.isArray(ocPackage.recipe)) {
        throw new Error('The Animacraft profile uses an unsupported package format.')
      }
      const living = ocPackage.livingContent?.content
      if (!living?.soulMd || !living?.memoryMd) throw new Error('The Animacraft package is missing mint-required Living Content.')
      const name = String(ocPackage.profile.name || '').trim()
      const description = String(ocPackage.profile.description || '').trim()
      if (!name || !description) throw new Error('The Animacraft package must include an OC name and description.')
      const recipeHash = String(ocPackage.integrity?.recipeHash || '').replace(/^0x/, '')
      const importPayload = {
        name,
        description,
        avatar: imageUrl.toString(),
        tags: Array.isArray(ocPackage.profile.tags)
          ? ocPackage.profile.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
        animacraft: {
          makerId,
          recipeHash,
          schemaVersion: ocPackage.schemaVersion,
          profileUrl: profileUrl.toString(),
        },
      }
      const stem = safeFileStem(name)
      const rawFile = new File([JSON.stringify(importPayload, null, 2)], `${stem}-animacraft.json`, { type: 'application/json' })
      const parsed = await parseImportFile(rawFile)
      const coverType = imageBlob.type === 'image/png' ? 'image/png' : imageBlob.type || 'image/png'
      const coverFile = new File([imageBlob], `${stem}-cover.png`, { type: coverType })
      const charFile = new File([String(living.soulMd)], 'soul.md', { type: 'text/markdown' })
      const memoryFile = new File([String(living.memoryMd)], 'memory.md', { type: 'text/markdown' })
      const skillMd = String(living.skillMd || '').trim()
      const skillArchive = skillMd
        ? Uint8Array.from(zipSync({ 'SKILL.md': strToU8(skillMd) }, { level: 6 })).buffer
        : null
      const skillsFile = skillMd
        ? new File([skillArchive!], 'skills.zip', { type: 'application/zip' })
        : null

      ctx.setRawFile(rawFile)
      ctx.setParsedFields(parsed.fields)
      ctx.setParseStats(parsed.stats)
      ctx.setFieldMappings(parsed.suggestedMappings)
      ctx.setOriginRef(`animacraft:${makerId}:${recipeHash || 'unhashed-recipe'}`)
      ctx.setCharFile(charFile)
      ctx.setMemoryFile(memoryFile)
      ctx.setSkillsFile(skillsFile)
      ctx.setCoverImage(coverFile)
      ctx.setTags(importPayload.tags.join(', '))
      router.replace('/import/map')
    }

    prepare().catch((error) => {
      ctx.setSourceType(null)
      setHandoffStatus('error')
      setHandoffError(error instanceof Error ? error.message : 'Animacraft handoff failed.')
    })
  }, [ctx, router])

  function handleSelect(id: 'local-file' | 'animacraft') {
    if (id !== 'local-file') return
    ctx.setSourceType(id)
  }

  function handleNext() {
    if (ctx.sourceType) {
      if (ctx.sourceType === 'local-file') router.push('/import/upload')
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
            const isHandoff = src.id === 'animacraft' && handoffStatus === 'loading'
            const isDisabled = !src.enabled && !isHandoff

            return (
              <button
                key={src.id}
                type="button"
                disabled={isDisabled}
                onClick={() => src.enabled && handleSelect(src.id)}
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
                    {isHandoff && <span className="text-[10px] font-semibold text-teal">Preparing handoff…</span>}
                  </div>
                  <p className="mt-1.5 text-[13px] leading-6 text-muted">{src.desc}</p>
                </div>
              </button>
            )
          })}
        </div>

        {handoffStatus === 'error' && (
          <div className="rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
            {handoffError} Download the Animacraft Import Kit and use Local File if the remote handoff has expired.
          </div>
        )}

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
            disabled={ctx.sourceType !== 'local-file'}
            onClick={handleNext}
            className={buttonStyles({
              variant: 'landing',
              size: 'lg',
              className: `min-w-0 flex-1 rounded-xl ${ctx.sourceType !== 'local-file' ? 'pointer-events-none opacity-45' : ''}`,
            })}
          >
            Next: Upload File <span aria-hidden="true">→</span>
          </button>
        </div>
      </PageContainer>
    </div>
  )
}
