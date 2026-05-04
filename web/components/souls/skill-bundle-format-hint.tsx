'use client'

import { strToU8, zipSync } from 'fflate'
import { cn } from '@/lib/utils/cn'
import {
  SKILL_BUNDLE_FORMAT_SUMMARY,
  SKILL_BUNDLE_FRONTMATTER_EXAMPLE,
} from '@soulidity/sdk'

function downloadSkillBundleTemplate() {
  const zipBytes = zipSync({
    'SKILL.md': strToU8(SKILL_BUNDLE_FRONTMATTER_EXAMPLE),
  })
  const blob = new Blob([Uint8Array.from(zipBytes)], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = 'skills-template.zip'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function SkillBundleFormatHint({
  error,
  className,
}: {
  error?: string | null
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-[12px] border px-3.5 py-3 text-[11px] leading-5',
        error
          ? 'border-danger/35 bg-danger/8'
          : 'border-border/70 bg-black/10',
        className,
      )}
    >
      <p className={cn('font-semibold', error ? 'text-danger' : 'text-foreground')}>
        {error ?? 'Skills bundle format'}
      </p>
      <p className="mt-1 text-muted">{SKILL_BUNDLE_FORMAT_SUMMARY}</p>
      <button
        type="button"
        onClick={downloadSkillBundleTemplate}
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-teal transition hover:text-foreground"
      >
        <span aria-hidden="true">↓</span>
        <span>Download template</span>
      </button>
      <pre className="mt-2 overflow-x-auto rounded-lg border border-border/60 bg-black/20 px-3 py-2 text-[10px] leading-5 text-foreground/90">
        <code>{SKILL_BUNDLE_FRONTMATTER_EXAMPLE}</code>
      </pre>
    </div>
  )
}
