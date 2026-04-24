import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function readRendererCsp() {
  const html = readFileSync(
    resolve(process.cwd(), 'desktop/apps/desktop/src/renderer/index.html'),
    'utf8',
  )
  const match = html.match(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
  )

  if (!match) {
    throw new Error('Desktop renderer CSP meta tag is missing')
  }

  return match[1]
}

describe('desktop renderer CSP', () => {
  it('allows the image sources used by the packaged desktop library', () => {
    const csp = readRendererCsp()

    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("img-src 'self' data: blob: file: https:")
  })
})
