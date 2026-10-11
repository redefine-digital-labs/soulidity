import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('web create basic info regression guards', () => {
  it('keeps the step aligned to the screenshot field set instead of the old price/listing layout', () => {
    const source = readSource('web/app/create/page.tsx')

    expect(source).not.toContain("import { FlowBar } from '@/components/nav/flow-bar'")
    expect(source).not.toContain('FieldLabel label="Category"')
    expect(source).toContain('FieldLabel label="Tags (comma-separated)"')
    expect(source).toContain('FieldLabel label="Preview Image" required')
    expect(source).toContain('FieldLabel label="Creator Royalty" optional')
    expect(source).toContain('Next: Living Content')
    expect(source).toContain('Basic Info is locked on-chain after minting')
    expect(source).not.toContain('Starting Price (USDC)')
    expect(source).not.toContain('List immediately')
  })

  it('keeps the preview image control wired to CoverImagePicker with context-driven preview state', () => {
    const source = readSource('web/app/create/page.tsx')

    // CoverImagePicker replaced UploadZone + inline preview block per design-review C7
    // (crop-to-1:1 + WebP compression is now part of the upload experience).
    expect(source).toContain("import { CoverImagePicker } from '@/components/ui/cover-image-picker'")
    expect(source).toContain('<CoverImagePicker')
    expect(source).toContain('file={ctx.coverImageFile}')
    expect(source).toContain('previewUrl={ctx.coverImagePreviewUrl}')
    expect(source).toContain('ctx.setCoverImage')
    expect(source).not.toContain("import { UploadZone } from '@/components/ui/upload-zone'")
  })

  it('keeps royalty options limited to the 4-card screenshot layout with a recommended standard tier', () => {
    const source = readSource('web/app/create/page.tsx')

    expect(source).toContain("desc: '2.5%'")
    expect(source).toContain("desc: '5%', recommended: true")
    expect(source).toContain('grid grid-cols-4 gap-2.5')
    expect(source).toContain('Recommended')
    expect(source).toContain('aria-pressed={ctx.royalty === opt.value}')
    expect(source).not.toContain("label: 'Max'")
  })
})
