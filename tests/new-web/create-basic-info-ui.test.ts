import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('new-web create basic info regression guards', () => {
  it('keeps the step aligned to the screenshot field set instead of the old price/listing layout', () => {
    const source = readSource('new-web/app/create/page.tsx')

    expect(source).not.toContain("import { FlowBar } from '@/components/nav/flow-bar'")
    expect(source).toContain('FieldLabel label="Category" required')
    expect(source).toContain('FieldLabel label="Tags (comma-separated)"')
    expect(source).toContain('FieldLabel label="Preview Image" required')
    expect(source).toContain('FieldLabel label="Creator Royalty" optional')
    expect(source).toContain('Next: Living Content')
    expect(source).toContain('Basic Info is locked on-chain after minting')
    expect(source).not.toContain('Starting Price (USDC)')
    expect(source).not.toContain('List immediately')
  })

  it('keeps the preview image control wired to UploadZone with local preview state', () => {
    const source = readSource('new-web/app/create/page.tsx')

    expect(source).toContain("import { UploadZone } from '@/components/ui/upload-zone'")
    expect(source).toContain('const [coverImageFile, setCoverImageFile] = useState<File | null>(null)')
    expect(source).toContain('<UploadZone')
    expect(source).toContain('onFileSelect={handleCoverImageSelect}')
    expect(source).toContain('alt="Cover preview"')
    expect(source).toContain('Click to upload cover image')
  })

  it('keeps royalty options limited to the 4-card screenshot layout with a recommended standard tier', () => {
    const source = readSource('new-web/app/create/page.tsx')

    expect(source).toContain("desc: '2.5%'")
    expect(source).toContain("desc: '5%', recommended: true")
    expect(source).toContain('grid grid-cols-4 gap-2.5')
    expect(source).toContain('Recommended')
    expect(source).not.toContain("label: 'Max'")
  })
})
