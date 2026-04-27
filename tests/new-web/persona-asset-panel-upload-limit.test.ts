import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('PersonaAssetPanel upload limit copy', () => {
  it('derives the sprite-sheet hint from the shared upload byte limit', () => {
    const source = readSource('web/components/souls/persona-asset-panel.tsx')

    expect(source).toContain("import { MAX_SOUL_UPLOAD_BYTES } from '@/lib/soulidity/upload-validation'")
    expect(source).toContain('Math.ceil(MAX_SOUL_UPLOAD_BYTES / (1024 * 1024))')
    expect(source).toContain('SPRITE_SHEET_UPLOAD_HINT')
    expect(source).not.toContain('up to 50 MB')
  })
})
