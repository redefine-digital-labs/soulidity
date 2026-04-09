import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('success effect loop regression guards', () => {
  it('guards create gas success writes against provider rerenders', () => {
    const source = readSource('new-web/app/create/gas/page.tsx')

    expect(source).toContain('const completedDigestRef = useRef<string | null>(null)')
    expect(source).toContain('if (completedDigestRef.current === publishData.txDigest) return')
    expect(source).not.toContain('[status, publishData, ctx, router, showToast]')
    expect(source).toContain('[status, publishData, setPublishResult, router, showToast]')
  })

  it('guards import gas success writes against provider rerenders', () => {
    const source = readSource('new-web/app/import/gas/page.tsx')

    expect(source).toContain('const completedDigestRef = useRef<string | null>(null)')
    expect(source).toContain('if (completedDigestRef.current === importData.txDigest) return')
    expect(source).not.toContain('[status, importData, ctx, router]')
    expect(source).toContain('[status, importData, setImportResult, router]')
  })

  it('guards wrap preview success writes against provider rerenders', () => {
    const source = readSource('new-web/app/wrap-link/personal/preview/page.tsx')

    expect(source).toContain('const completedDigestRef = useRef<string | null>(null)')
    expect(source).toContain('if (completedDigestRef.current === result.txDigest) return')
    expect(source).not.toContain('[status, result, ctx, router]')
    expect(source).toContain('[status, result, setPublishResult, router]')
  })
})
