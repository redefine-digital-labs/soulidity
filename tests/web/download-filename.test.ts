import { describe, expect, it } from 'vitest'
import { buildDownloadFileName } from '../../web/lib/download-filename.ts'

describe('buildDownloadFileName', () => {
  it('returns a .zip filename for a normal name', () => {
    expect(buildDownloadFileName('Research Agent')).toBe('Research Agent.zip')
  })

  it('normalizes full-width characters via NFKC', () => {
    // Full-width Latin letters map to their ASCII equivalents under NFKC.
    expect(buildDownloadFileName('Ｒｅｓｅａｒｃｈ')).toBe('Research.zip')
  })

  it('removes path-traversal characters and collapses whitespace', () => {
    // '/' is not in the allowed set, so '../Research/Agent' becomes
    // '.. Research Agent' after replacement, then leading dots are stripped.
    expect(buildDownloadFileName('../Research/Agent')).toBe('Research Agent.zip')
  })

  it('strips leading dots from the sanitized base', () => {
    expect(buildDownloadFileName('...hidden')).toBe('hidden.zip')
  })

  it('falls back to "bundle" when the sanitized base is empty', () => {
    // All characters are slashes; after sanitization the base collapses to ''.
    expect(buildDownloadFileName('////')).toBe('bundle.zip')
  })

  it('truncates the base to 80 characters before appending .zip', () => {
    const long = 'a'.repeat(100)
    const result = buildDownloadFileName(long)
    // Base must be exactly 80 chars; the .zip suffix comes on top.
    expect(result).toBe('a'.repeat(80) + '.zip')
    expect(result.length).toBe(84)
  })

  it('uses the custom fallback when provided and name sanitizes to empty', () => {
    expect(buildDownloadFileName('////', 'download')).toBe('download.zip')
  })
})
